import { Injectable } from '@nestjs/common';
import { basename, dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { OnEvent, OnJob } from 'src/decorators';
import { DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum';
import { ReorganizeMove } from 'src/repositories/reorganize.repository';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { getSidecarName, ReorganizationItemStatus, ReorganizationStatus } from 'src/utils/reorganize';

type Reorganization = NonNullable<Awaited<ReturnType<ReorganizeJobService['reorganizeRepository']['get']>>>;
type Item = Awaited<ReturnType<ReorganizeJobService['reorganizeRepository']['getItems']>>[number];
type AssetState = NonNullable<Awaited<ReturnType<ReorganizeJobService['reorganizeRepository']['getAssetState']>>>;

/** One file changing place on disk. */
interface FileMove {
  from: string;
  to: string;
}

/** A photo with everything that goes with it, in the direction it is travelling. */
interface Transfer {
  itemId: string;
  assetId: string | null;
  original: FileMove;
  /** the sidecar as it was when the reorganization was planned */
  sidecar?: FileMove;
  video?: FileMove & { assetId: string };
  libraryId: string;
}

const BATCH_SIZE = 100;
const ALL = 1_000_000;
const LIBRARY_QUEUE_WAIT_MS = 5 * 60 * 1000;
const LIBRARY_QUEUE_POLL_MS = 1000;

/** Errors that mean the storage itself is gone, so trying the next photo is pointless. */
const STORAGE_GONE = new Set(['ENOTCONN', 'EIO', 'EHOSTDOWN', 'EHOSTUNREACH', 'ESTALE', 'ETIMEDOUT', 'ENXIO']);
/** Errors of `link` that mean the file system has no hard links. */
const NO_HARD_LINKS = new Set(['ENOSYS', 'EOPNOTSUPP', 'ENOTSUP', 'EMLINK']);

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/** A photo that is left where it is, which is not a failure. */
class Stay extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/** The storage went away: the run stops and waits for the user. */
class StorageGone extends Error {}

@Injectable()
export class ReorganizeJobService extends BaseService {
  /**
   * A reorganization that was running when the server stopped does not pick up by itself: the user decides whether
   * to continue or undo. The photo it was busy with is brought back in line with the database first, so that the
   * library scans it had been holding back do not find a file under two names.
   */
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    const records = await this.reorganizeRepository.interruptRunning();
    if (records.length === 0) {
      return;
    }

    this.logger.warn(`Marked ${records.length} reorganization(s) as interrupted by the restart`);
    for (const record of records) {
      try {
        await this.reconcile(record, ['moving', 'undoing']);
      } catch (error) {
        this.logger.error(`Unable to sort out reorganization ${record.id} after the restart: ${error}`);
      }
    }
    await this.jobRepository.resume(QueueName.Library);
  }

  @OnJob({ name: JobName.Reorganize, queue: QueueName.BackgroundTask })
  async handleReorganize({ id }: JobOf<JobName.Reorganize>): Promise<JobStatus> {
    return this.databaseRepository.withLock(DatabaseLock.Reorganize, async () => {
      // a job retried after a crash finds the record no longer queued and leaves it alone
      const record = await this.reorganizeRepository.transition(id, 'queued', 'running');
      if (!record) {
        return JobStatus.Skipped;
      }

      const finish = (status: ReorganizationStatus, error: string | null = null) =>
        this.reorganizeRepository.update(id, { status, error, cancelRequested: false, finishedAt: new Date() });

      // a watcher turns every file that loses its name into a job that deletes the asset at that path
      const { library } = await this.getConfig({ withCache: false });
      if (library.watch.enabled) {
        await finish('paused', 'Library watching is on; turn it off to reorganize');
        return JobStatus.Failed;
      }

      const wasPaused = await this.jobRepository.isPaused(QueueName.Library);
      try {
        // library scans and reorganizing must not see each other's half-done work
        await this.jobRepository.pause(QueueName.Library);
        if (!(await this.waitForLibraryQueue())) {
          await finish('paused', 'A library scan is still running');
          return JobStatus.Failed;
        }

        await this.reconcile(
          record,
          record.isUndo ? ['moving', 'failed', 'undoing', 'undo-failed'] : ['moving', 'failed'],
        );
        const status = await this.run(record);
        await finish(status.status, status.error);
        return JobStatus.Success;
      } catch (error) {
        if (!(error instanceof StorageGone)) {
          this.logger.error(`Reorganization ${id} stopped: ${error}`, (error as Error)?.stack);
        }
        await finish('paused', error instanceof Error ? error.message : String(error));
        return JobStatus.Failed;
      } finally {
        if (!wasPaused) {
          await this.jobRepository.resume(QueueName.Library);
        }
      }
    });
  }

  private async waitForLibraryQueue() {
    for (let waited = 0; waited <= LIBRARY_QUEUE_WAIT_MS; waited += LIBRARY_QUEUE_POLL_MS) {
      if (!(await this.jobRepository.isActive(QueueName.Library))) {
        return true;
      }
      await setTimeout(LIBRARY_QUEUE_POLL_MS);
    }
    return false;
  }

  /** Moves the photos that are due, one at a time, until done, cancelled or the storage goes away. */
  private async run(record: Reorganization): Promise<{ status: ReorganizationStatus; error: string | null }> {
    const { id, isUndo } = record;
    const due: ReorganizationItemStatus = isUndo ? 'moved' : 'pending';
    const busy: ReorganizationItemStatus = isUndo ? 'undoing' : 'moving';
    const done: ReorganizationItemStatus = isUndo ? 'undone' : 'moved';
    const failed: ReorganizationItemStatus = isUndo ? 'undo-failed' : 'failed';
    const stayed: ReorganizationItemStatus = isUndo ? 'undo-skipped' : 'stayed';
    // folders are recorded as they are created, so that an undo finds them whatever happens to the photo
    const onFoldersCreated = (folders: string[]) =>
      isUndo ? Promise.resolve() : this.reorganizeRepository.addFolders(id, 'createdFolders', folders);

    for (;;) {
      const items = await this.reorganizeRepository.getItems(id, {
        statuses: [due],
        limit: BATCH_SIZE,
        reverse: isUndo,
      });
      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        const current = await this.reorganizeRepository.get(id);
        if (!current || current.cancelRequested) {
          return { status: 'cancelled', error: null };
        }

        await this.reorganizeRepository.updateItem(item.id, { status: busy, error: null });
        try {
          await this.transfer(this.toTransfer(item, isUndo), onFoldersCreated);
          await this.reorganizeRepository.updateItem(item.id, { status: done });
          await this.syncAlbum(record, item, isUndo);
        } catch (error) {
          if (error instanceof StorageGone) {
            // the photo stays marked as busy; continuing sorts out how far it got
            return { status: 'paused', error: error.message };
          }
          if (error instanceof Stay) {
            await this.reorganizeRepository.updateItem(item.id, { status: stayed, reason: error.reason });
            continue;
          }
          this.logger.warn(`Unable to move ${item.fromPath} for reorganization ${id}: ${error}`);
          await this.reorganizeRepository.updateItem(item.id, { status: failed, error: String(error) });
        }
      }
    }

    await (isUndo ? this.removeCreatedFolders(record) : this.removeEmptiedFolders(record));

    return { status: 'completed', error: null };
  }

  /**
   * Keeps the album of a reorganization in step with a photo that just arrived: a photo that moved is added to the
   * album, and one that an undo moved back is taken out again if the reorganization is what put it there. An album
   * that is gone, or a photo already in it, is simply left alone.
   */
  private async syncAlbum(record: Reorganization, item: Item, isUndo: boolean) {
    const { albumId } = record;
    if (!albumId || !item.assetId) {
      return;
    }

    try {
      if (isUndo) {
        if (item.addedToAlbum) {
          await this.albumRepository.removeAssetIds(albumId, [item.assetId]);
          await this.reorganizeRepository.updateItem(item.id, { addedToAlbum: false });
        }
        return;
      }

      const album = await this.albumRepository.getById(albumId, { withAssets: false });
      const present = await this.albumRepository.getAssetIds(albumId, [item.assetId]);
      if (!album || present.has(item.assetId)) {
        return;
      }
      await this.albumRepository.addAssetIds(albumId, [item.assetId]);
      await this.reorganizeRepository.updateItem(item.id, { addedToAlbum: true });
      await this.albumRepository.update(
        albumId,
        { id: albumId, updatedAt: new Date(), albumThumbnailAssetId: album.albumThumbnailAssetId ?? item.assetId },
        record.ownerId,
      );
    } catch (error) {
      // the photo is where it should be; its album can be fixed by hand
      this.logger.warn(`Unable to update album ${albumId} for asset ${item.assetId}: ${error}`);
    }
  }

  private toTransfer(item: Item, isUndo: boolean): Transfer {
    const flip = (from: string, to: string): FileMove => (isUndo ? { from: to, to: from } : { from, to });
    return {
      itemId: item.id,
      assetId: item.assetId,
      original: flip(item.fromPath, item.toPath!),
      sidecar: item.sidecarFromPath ? flip(item.sidecarFromPath, item.sidecarToPath!) : undefined,
      video: item.videoAssetId
        ? { assetId: item.videoAssetId, ...flip(item.videoFromPath!, item.videoToPath!) }
        : undefined,
      libraryId: (isUndo ? item.fromLibraryId : item.toLibraryId)!,
    };
  }

  /**
   * The sidecar of a photo as the database has it now, with where it belongs at the other end. A sidecar written
   * after the reorganization was planned (by editing the photo's date or location) travels with its photo too.
   */
  private sidecarOf(transfer: Transfer, state: AssetState): FileMove | undefined {
    const current = state.sidecarPath;
    if (!current) {
      return transfer.sidecar;
    }

    const counterpart = (here: string, there: string) =>
      join(dirname(there), getSidecarName(current, basename(here), basename(there)));
    if (state.originalPath === transfer.original.to) {
      return transfer.sidecar?.to === current
        ? transfer.sidecar
        : { from: counterpart(transfer.original.to, transfer.original.from), to: current };
    }
    return transfer.sidecar?.from === current
      ? transfer.sidecar
      : { from: current, to: counterpart(transfer.original.from, transfer.original.to) };
  }

  private filesOf(transfer: Transfer, state: AssetState): FileMove[] {
    return [transfer.original, this.sidecarOf(transfer, state), transfer.video].filter((file) => file !== undefined);
  }

  /**
   * Moves one photo with its sidecar and live video, and points the database at the new place. Every file gets its
   * new name before the database changes and loses its old name after, so that whatever goes wrong in between, the
   * database points at a complete photo.
   */
  private async transfer(transfer: Transfer, onFoldersCreated: (folders: string[]) => Promise<void>) {
    const state = transfer.assetId ? await this.reorganizeRepository.getAssetState(transfer.assetId) : undefined;
    if (!state) {
      throw new Stay('deleted');
    }
    if (state.originalPath !== transfer.original.from) {
      throw new Stay('changed');
    }
    if (state.isOffline) {
      throw new Stay('offline');
    }
    if (state.deletedAt) {
      throw new Stay('trashed');
    }
    // a separate video the photo was linked to after the plan was made is not accounted for
    if (state.livePhotoVideoId && state.videoIsExternal && !transfer.video) {
      throw new Stay('changed');
    }

    const files = this.filesOf(transfer, state);
    const placed: Array<FileMove & { isRenamed: boolean }> = [];
    const takeBack = async () => {
      try {
        for (const file of placed.toReversed()) {
          await (file.isRenamed
            ? this.storageRepository.rename(file.to, file.from)
            : this.storageRepository.unlink(file.to));
        }
      } catch (error) {
        this.logger.error(`Unable to take back ${transfer.original.to}: ${error}`);
      }
    };

    try {
      for (const file of files) {
        if (!(await this.exists(file.from))) {
          throw new Stay('missing');
        }
      }

      for (const [index, file] of files.entries()) {
        const folder = await this.storageRepository.mkdir(dirname(file.to));
        if (folder) {
          await onFoldersCreated(this.foldersBetween(folder, dirname(file.to)));
        }
        const isRenamed = await this.place(file, `${transfer.itemId}-${index}`);
        placed.push({ ...file, isRenamed });
      }
    } catch (error) {
      await takeBack();
      throw this.classify(error);
    }

    try {
      await this.reorganizeRepository.applyMove(
        this.toMove(transfer, state),
        // a video extracted from the photo's own file has nothing to move, but follows its photo to another library
        state.livePhotoVideoId && !transfer.video && state.libraryId !== transfer.libraryId
          ? state.livePhotoVideoId
          : undefined,
      );
    } catch (error) {
      // an error does not always mean nothing changed: only take the files back if the database still says so
      const after = await this.reorganizeRepository.getAssetState(state.id).catch(() => null);
      if (after?.originalPath !== transfer.original.to) {
        await takeBack();
        throw error;
      }
    }

    try {
      for (const file of placed) {
        if (!file.isRenamed) {
          await this.storageRepository.unlink(file.from);
        }
      }
    } catch (error) {
      // the photo is in its new place; its old file is still there and a retry removes it
      throw this.classify(new Error(`Moved, but the old file could not be removed: ${error}`, { cause: error }));
    }
  }

  private toMove(transfer: Transfer, state: AssetState): ReorganizeMove {
    const asset = (assetId: string, file: FileMove) => ({
      assetId,
      fromPath: file.from,
      toPath: file.to,
      checksum: this.cryptoRepository.hashSha1(`path:${file.to}`),
      fileName: basename(file.from) === basename(file.to) ? undefined : basename(file.to),
      libraryId: transfer.libraryId,
    });
    const sidecar = this.sidecarOf(transfer, state);

    return {
      original: asset(state.id, transfer.original),
      sidecar: sidecar && { fromPath: sidecar.from, toPath: sidecar.to },
      video: transfer.video && asset(transfer.video.assetId, transfer.video),
    };
  }

  /**
   * Gives a file its new name without ever replacing a file that is already there. Returns whether the old name
   * is gone already (a plain rename, on a file system without hard links).
   */
  private async place(file: FileMove, tag: string): Promise<boolean> {
    try {
      await this.storageRepository.link(file.from, file.to);
      return false;
    } catch (error) {
      const code = codeOf(error);
      if (code === 'EEXIST') {
        throw new Stay('target-exists');
      }
      // EPERM is what sshfs reports between two file systems of the server, and also what a file system without
      // hard links reports; copying works for both
      if (code === 'EXDEV' || code === 'EPERM') {
        await this.copy(file, tag);
        return false;
      }
      if (NO_HARD_LINKS.has(code!)) {
        await this.renameCarefully(file.from, file.to);
        return true;
      }
      throw error;
    }
  }

  /** A rename replaces what is at the target, so look first. Only used where hard links are not available. */
  private async renameCarefully(from: string, to: string) {
    if (await this.exists(to)) {
      throw new Stay('target-exists');
    }
    await this.storageRepository.rename(from, to);
  }

  /**
   * Copies a file to another file system: into a hidden temporary file that library scans do not see, verified
   * against the source, and only then given its real name. The source is left for the caller to remove.
   */
  private async copy(file: FileMove, tag: string) {
    const temporary = this.temporaryOf(file, tag);
    try {
      await this.remove(temporary);
      await this.storageRepository.copyFileExclusive(file.from, temporary);
      await this.storageRepository.sync(temporary);

      const [stat, copyStat] = await Promise.all([
        this.storageRepository.stat(file.from),
        this.storageRepository.stat(temporary),
      ]);
      const [hash, copyHash] = await Promise.all([
        this.cryptoRepository.hashFile(file.from),
        this.cryptoRepository.hashFile(temporary),
      ]);
      if (stat.size !== copyStat.size || !hash.equals(copyHash)) {
        throw new Error(`The copy of ${file.from} does not match the original`);
      }
      // keep the modification time, or the next library scan extracts the metadata all over again
      await this.storageRepository.utimes(temporary, stat.atime, stat.mtime);

      try {
        await this.storageRepository.link(temporary, file.to);
      } catch (error) {
        const code = codeOf(error);
        if (code === 'EEXIST') {
          throw new Stay('target-exists');
        }
        if (code !== 'EPERM' && !NO_HARD_LINKS.has(code!)) {
          throw error;
        }
        await this.renameCarefully(temporary, file.to);
      }
    } finally {
      await this.remove(temporary).catch(() => {});
    }
  }

  private temporaryOf(file: FileMove, tag: string) {
    return join(dirname(file.to), `.immich-reorganize-${tag}.tmp`);
  }

  /**
   * Whether a file is there. A share that dropped is not the same as a missing file: treating it as one would
   * write off every remaining photo instead of pausing.
   */
  private async exists(path: string): Promise<boolean> {
    try {
      await this.storageRepository.stat(path);
      return true;
    } catch (error) {
      if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR') {
        return false;
      }
      throw this.classify(error);
    }
  }

  /** Removes a file that may not be there. */
  private async remove(path: string) {
    if (await this.exists(path)) {
      await this.storageRepository.unlink(path);
    }
  }

  private classify(error: unknown): Error {
    const cause = (error as Error)?.cause ?? error;
    if (STORAGE_GONE.has(codeOf(cause)!) || STORAGE_GONE.has(codeOf(error)!)) {
      return new StorageGone(`The storage is not reachable: ${error}`);
    }
    return error as Error;
  }

  /** The folders from `top` down to `bottom`, which a recursive mkdir created in one go. */
  private foldersBetween(top: string, bottom: string): string[] {
    const folders = [bottom];
    while (folders[0] !== top && folders[0].length > top.length) {
      folders.unshift(dirname(folders[0]));
    }
    return folders;
  }

  /**
   * Sorts out the photos a previous run left half-done or failed, so that a run can simply try them again:
   * finishes what the database already points at, and takes back what it does not. An undo also looks at what a
   * cut-short run left behind, so that it knows which photos did move.
   */
  private async reconcile(record: Reorganization, statuses: ReorganizationItemStatus[]) {
    const items = await this.reorganizeRepository.getItems(record.id, { statuses, limit: ALL });
    for (const item of items) {
      const wasUndoing = item.status === 'undoing' || item.status === 'undo-failed';
      try {
        const arrived = await this.settle(this.toTransfer(item, wasUndoing));
        const status: ReorganizationItemStatus = wasUndoing
          ? arrived
            ? 'undone'
            : 'moved'
          : arrived
            ? 'moved'
            : 'pending';
        await this.reorganizeRepository.updateItem(item.id, { status, error: null });
        if (arrived) {
          await this.syncAlbum(record, item, wasUndoing);
        }
      } catch (error) {
        const classified = this.classify(error);
        if (classified instanceof StorageGone) {
          throw classified;
        }
        if (error instanceof Stay) {
          await this.reorganizeRepository.updateItem(item.id, {
            status: wasUndoing ? 'undo-skipped' : 'stayed',
            reason: error.reason,
          });
          continue;
        }
        this.logger.warn(`Unable to sort out ${item.fromPath} of reorganization ${record.id}: ${error}`);
        await this.reorganizeRepository.updateItem(item.id, {
          status: wasUndoing ? 'undo-failed' : 'failed',
          error: String(error),
        });
      }
    }
  }

  /**
   * Brings the files of one photo in line with the database. Returns whether the photo is at its destination.
   * It only ever removes a file whose content it can still find under the photo's other name, and never touches
   * a path that belongs to another asset.
   */
  private async settle(transfer: Transfer): Promise<boolean> {
    const state = transfer.assetId ? await this.reorganizeRepository.getAssetState(transfer.assetId) : undefined;
    if (!state) {
      throw new Stay('deleted');
    }

    const files = this.filesOf(transfer, state);
    const isOurs = async (path: string) => !(await this.reorganizeRepository.isUsedByAnother(path, state.id));

    if (state.originalPath === transfer.original.to) {
      // the database points at the new place: an old name still around is a leftover
      for (const file of files) {
        const [hasOld, hasNew] = await Promise.all([this.exists(file.from), this.exists(file.to)]);
        if (hasOld && hasNew && (await isOurs(file.from)) && (await this.hasSameContent(file.from, file.to))) {
          await this.storageRepository.unlink(file.from);
        }
      }
      return true;
    }

    if (state.originalPath !== transfer.original.from) {
      throw new Stay('changed');
    }

    for (const [index, file] of files.entries()) {
      await this.remove(this.temporaryOf(file, `${transfer.itemId}-${index}`));
      const [hasOld, hasNew] = await Promise.all([this.exists(file.from), this.exists(file.to)]);
      if (!hasNew || !(await isOurs(file.to))) {
        continue;
      }
      if (!hasOld) {
        // only a plain rename leaves this behind: put the file back where the database says it is
        await this.storageRepository.mkdir(dirname(file.from));
        await this.storageRepository.rename(file.to, file.from);
        continue;
      }
      // both names exist: the new one is ours only if it is the same file
      if (await this.hasSameContent(file.from, file.to)) {
        await this.storageRepository.unlink(file.to);
      }
    }
    return false;
  }

  private async hasSameContent(path: string, otherPath: string): Promise<boolean> {
    const [stat, otherStat] = await Promise.all([
      this.storageRepository.stat(path),
      this.storageRepository.stat(otherPath),
    ]);
    if (stat.size !== otherStat.size) {
      return false;
    }
    const [hash, otherHash] = await Promise.all([
      this.cryptoRepository.hashFile(path),
      this.cryptoRepository.hashFile(otherPath),
    ]);
    return hash.equals(otherHash);
  }

  /**
   * Removes the subfolders of a source folder that the reorganization emptied, and their emptied parents. It goes
   * by the photos that moved, in this run or an earlier one, and only removes folders that are really empty.
   */
  private async removeEmptiedFolders(record: Reorganization) {
    const root = record.sourcePath;
    if (!root) {
      return;
    }

    const moved = await this.reorganizeRepository.getItems(record.id, { statuses: ['moved'], limit: ALL });
    const isInside = (folder: string) => folder.startsWith(root + '/');
    const emptied = [...new Set(moved.map((item) => dirname(item.fromPath)))].filter((folder) => isInside(folder));
    const removed: string[] = [];
    // deepest first, so that a parent is tried after its children are gone
    for (const start of emptied.toSorted((a, b) => b.length - a.length)) {
      for (let folder = start; isInside(folder); folder = dirname(folder)) {
        try {
          await this.storageRepository.rmdir(folder);
          removed.push(folder);
        } catch {
          // not empty, or already gone
          break;
        }
      }
    }
    await this.reorganizeRepository.addFolders(record.id, 'removedFolders', removed);
  }

  /** After an undo: removes the date folders the reorganization created, where they are empty again. */
  private async removeCreatedFolders(record: Reorganization) {
    const current = await this.reorganizeRepository.get(record.id);
    for (const folder of (current?.createdFolders ?? []).toSorted((a, b) => b.length - a.length)) {
      await this.storageRepository.rmdir(folder).catch(() => {});
    }
  }
}
