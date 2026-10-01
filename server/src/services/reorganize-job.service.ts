import { Injectable } from '@nestjs/common';
import { basename, dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { OnEvent, OnJob } from 'src/decorators';
import { DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum';
import { ReorganizeMove } from 'src/repositories/reorganize.repository';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { ReorganizationItemStatus, ReorganizationStatus } from 'src/utils/reorganize';

type Reorganization = NonNullable<Awaited<ReturnType<ReorganizeJobService['reorganizeRepository']['get']>>>;
type Item = Awaited<ReturnType<ReorganizeJobService['reorganizeRepository']['getItems']>>[number];

/** One file changing place on disk. */
interface FileMove {
  from: string;
  to: string;
}

/** A photo with everything that goes with it, in the direction it is travelling. */
interface Transfer {
  itemId: string;
  assetId: string;
  original: FileMove;
  sidecar?: FileMove;
  video?: FileMove & { assetId: string };
  libraryId: string;
}

const BATCH_SIZE = 100;
const LIBRARY_QUEUE_WAIT_MS = 5 * 60 * 1000;
const LIBRARY_QUEUE_POLL_MS = 1000;

/** Errors that mean the storage itself is gone, so trying the next photo is pointless. */
const STORAGE_GONE = new Set(['ENOTCONN', 'EIO', 'EHOSTDOWN', 'EHOSTUNREACH', 'ESTALE', 'ETIMEDOUT', 'ENXIO']);
/** Errors of `link` that mean the two paths are on different file systems, so the file must be copied. */
const CROSS_DEVICE = new Set(['EXDEV', 'EPERM']);
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
   * to continue or undo. The library queue it had paused is let go.
   */
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    const count = await this.reorganizeRepository.interruptRunning();
    if (count > 0) {
      this.logger.warn(`Marked ${count} reorganization(s) as interrupted by the restart`);
      await this.jobRepository.resume(QueueName.Library);
    }
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

      const wasPaused = await this.jobRepository.isPaused(QueueName.Library);
      try {
        // library scans and reorganizing must not see each other's half-done work; watch events queue up behind
        // the pause and find a consistent database when they run
        await this.jobRepository.pause(QueueName.Library);
        if (!(await this.waitForLibraryQueue())) {
          await finish('paused', 'A library scan is still running');
          return JobStatus.Failed;
        }

        await this.reconcile(record);
        const status = await this.run(record);
        await finish(status.status, status.error);
        return JobStatus.Success;
      } catch (error) {
        this.logger.error(`Reorganization ${id} stopped: ${error}`, (error as Error)?.stack);
        await finish('paused', String(error));
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
    const emptied = new Set<string>();

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
          const transfer = this.toTransfer(item, isUndo);
          const created = await this.transfer(transfer);
          await this.reorganizeRepository.updateItem(item.id, { status: done });
          if (!isUndo) {
            await this.reorganizeRepository.addFolders(id, 'createdFolders', created);
          }
          emptied.add(dirname(transfer.original.from));
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

    await (isUndo ? this.removeCreatedFolders(record) : this.removeEmptiedFolders(record, emptied));

    return { status: 'completed', error: null };
  }

  private toTransfer(item: Item, isUndo: boolean): Transfer {
    const flip = (from: string, to: string): FileMove => (isUndo ? { from: to, to: from } : { from, to });
    return {
      itemId: item.id,
      assetId: item.assetId!,
      original: flip(item.fromPath, item.toPath!),
      sidecar: item.sidecarFromPath ? flip(item.sidecarFromPath, item.sidecarToPath!) : undefined,
      video: item.videoAssetId
        ? { assetId: item.videoAssetId, ...flip(item.videoFromPath!, item.videoToPath!) }
        : undefined,
      libraryId: (isUndo ? item.fromLibraryId : item.toLibraryId)!,
    };
  }

  private filesOf(transfer: Transfer): FileMove[] {
    return [transfer.original, transfer.sidecar, transfer.video].filter((file) => file !== undefined);
  }

  /**
   * Moves one photo with its sidecar and live video, and points the database at the new place. Every file gets its
   * new name before the database changes and loses its old name after, so that whatever goes wrong in between, the
   * database points at a complete photo. Returns the folders it had to create.
   */
  private async transfer(transfer: Transfer): Promise<string[]> {
    if (!transfer.assetId) {
      throw new Stay('deleted');
    }
    const state = await this.reorganizeRepository.getAssetState(transfer.assetId);
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

    const files = this.filesOf(transfer);
    const created: string[] = [];
    const placed: Array<FileMove & { isRenamed: boolean }> = [];
    const unplace = async () => {
      for (const file of placed.toReversed()) {
        await (file.isRenamed
          ? this.storageRepository.rename(file.to, file.from)
          : this.storageRepository.unlink(file.to));
      }
    };

    try {
      for (const file of files) {
        if (!(await this.storageRepository.checkFileExists(file.from))) {
          throw new Stay('missing');
        }
      }

      for (const [index, file] of files.entries()) {
        const folder = await this.storageRepository.mkdir(dirname(file.to));
        if (folder) {
          created.push(...this.foldersBetween(folder, dirname(file.to)));
        }
        const isRenamed = await this.place(file, `${transfer.itemId}-${index}`);
        placed.push({ ...file, isRenamed });
      }
    } catch (error) {
      await unplace().catch((unplaceError) =>
        this.logger.error(`Unable to take back ${transfer.original.to}: ${unplaceError}`),
      );
      throw this.classify(error);
    }

    try {
      await this.reorganizeRepository.applyMove(
        this.toMove(transfer),
        state.livePhotoVideoId && !transfer.video && state.libraryId !== transfer.libraryId
          ? state.livePhotoVideoId
          : undefined,
      );
    } catch (error) {
      await unplace().catch((unplaceError) =>
        this.logger.error(`Unable to take back ${transfer.original.to}: ${unplaceError}`),
      );
      throw error;
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

    return created;
  }

  private toMove(transfer: Transfer): ReorganizeMove {
    const asset = (assetId: string, file: FileMove) => ({
      assetId,
      fromPath: file.from,
      toPath: file.to,
      checksum: this.cryptoRepository.hashSha1(`path:${file.to}`),
      fileName: basename(file.from) === basename(file.to) ? undefined : basename(file.to),
      libraryId: transfer.libraryId,
    });

    return {
      original: asset(transfer.assetId, transfer.original),
      sidecar: transfer.sidecar && { fromPath: transfer.sidecar.from, toPath: transfer.sidecar.to },
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
      if (CROSS_DEVICE.has(code!)) {
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
    if (await this.storageRepository.checkFileExists(to)) {
      throw new Stay('target-exists');
    }
    await this.storageRepository.rename(from, to);
  }

  /**
   * Copies a file to another file system: into a hidden temporary file that library scans do not see, verified
   * against the source, and only then given its real name. The source is left for the caller to remove.
   */
  private async copy(file: FileMove, tag: string) {
    const temporary = join(dirname(file.to), `.immich-reorganize-${tag}.tmp`);
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
        if (codeOf(error) === 'EEXIST') {
          throw new Stay('target-exists');
        }
        if (!NO_HARD_LINKS.has(codeOf(error)!)) {
          throw error;
        }
        await this.renameCarefully(temporary, file.to);
        return;
      }
    } finally {
      await this.remove(temporary).catch(() => {});
    }
  }

  /** Removes a file that may not be there. */
  private async remove(path: string) {
    if (await this.storageRepository.checkFileExists(path)) {
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
   * Sorts out the photos a previous run left half-done or failed, so that this run can simply try them again:
   * finishes what the database already points at, and takes back what it does not.
   */
  private async reconcile(record: Reorganization) {
    const { id, isUndo } = record;
    // an undo also looks at what a cut-short run left behind, so that it knows which photos did move
    const statuses: ReorganizationItemStatus[] = isUndo
      ? ['moving', 'failed', 'undoing', 'undo-failed']
      : ['moving', 'failed'];

    const items = await this.reorganizeRepository.getItems(id, { statuses, limit: 1_000_000 });
    for (const item of items) {
      const wasUndoing = item.status === 'undoing' || item.status === 'undo-failed';
      const transfer = this.toTransfer(item, wasUndoing);
      try {
        const arrived = await this.settle(transfer);
        const status: ReorganizationItemStatus = wasUndoing
          ? arrived
            ? 'undone'
            : 'moved'
          : arrived
            ? 'moved'
            : 'pending';
        await this.reorganizeRepository.updateItem(item.id, { status, error: null });
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
        this.logger.warn(`Unable to sort out ${item.fromPath} of reorganization ${id}: ${error}`);
      }
    }
  }

  /**
   * Brings the files of one photo in line with the database. Returns whether the photo is at its destination.
   */
  private async settle(transfer: Transfer): Promise<boolean> {
    const state = transfer.assetId ? await this.reorganizeRepository.getAssetState(transfer.assetId) : undefined;
    if (!state) {
      throw new Stay('deleted');
    }

    const files = this.filesOf(transfer);
    if (state.originalPath === transfer.original.to) {
      for (const file of files) {
        if (await this.storageRepository.checkFileExists(file.to)) {
          await this.remove(file.from);
        }
      }
      return true;
    }

    if (state.originalPath !== transfer.original.from) {
      throw new Stay('changed');
    }

    for (const [index, file] of files.entries()) {
      await this.remove(join(dirname(file.to), `.immich-reorganize-${transfer.itemId}-${index}.tmp`));
      const [hasOld, hasNew] = await Promise.all([
        this.storageRepository.checkFileExists(file.from),
        this.storageRepository.checkFileExists(file.to),
      ]);
      if (!hasNew) {
        continue;
      }
      if (!hasOld) {
        // only a plain rename leaves this behind: put the file back where the database says it is
        await this.storageRepository.mkdir(dirname(file.from));
        await this.storageRepository.rename(file.to, file.from);
        continue;
      }
      // both names exist: the new one is ours only if it is the same file, otherwise it was always someone else's
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

  /** Removes the subfolders of a source folder that the reorganization emptied, and their emptied parents. */
  private async removeEmptiedFolders(record: Reorganization, emptied: Set<string>) {
    const root = record.sourcePath;
    if (!root) {
      return;
    }

    const removed: string[] = [];
    const isInside = (folder: string) => folder.startsWith(root + '/');
    // deepest first, so that a parent is tried after its children are gone
    for (const start of [...emptied].filter((folder) => isInside(folder)).toSorted((a, b) => b.length - a.length)) {
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
    for (const folder of record.createdFolders.toSorted((a, b) => b.length - a.length)) {
      await this.storageRepository.rmdir(folder).catch(() => {});
    }
  }
}
