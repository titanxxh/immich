import { BadRequestException, Injectable } from '@nestjs/common';
import { constants } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import picomatch from 'picomatch';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  ReorganizationItemDto,
  ReorganizationItemsQueryDto,
  ReorganizationResponseDto,
  ReorganizeDto,
  ReorganizeFolderQueryDto,
  ReorganizeFoldersResponseDto,
  ReorganizeItemsDto,
  ReorganizeItemsResponseDto,
  ReorganizePreviewResponseDto,
  ReorganizeReason,
} from 'src/dtos/reorganize.dto';
import { JobName, Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { MetadataService } from 'src/services/metadata.service';
import {
  getContentChecks,
  getDateFolder,
  getDayFolderParent,
  getLocalDay,
  normalizeLabel,
  parseDayFolder,
  planReorganization,
  ReorganizationItemStatus,
  ReorganizationStatus,
  ReorganizeAsset,
  ReorganizeItem,
} from 'src/utils/reorganize';

const IO_CONCURRENCY = 8;

type Library = { id: string; name: string; ownerId: string; importPaths: string[]; exclusionPatterns: string[] };

export interface ReorganizePlan {
  targetPath: string;
  targetLibrary: Library;
  /** The source folder, for a folder source. */
  sourcePath?: string;
  libraries: Library[];
  assets: ReorganizeAsset[];
  items: ReorganizeItem[];
  /** The label of each day of the plan. */
  labels: Record<string, string>;
  /** Labels of the day folders already in the target. */
  existingLabels: Map<string, string[]>;
  /** Date folders of the plan that already exist. */
  existingFolders: Set<string>;
}

const cleanPath = (path: string) => {
  const normalized = normalize(path);
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
};

const isWithin = (path: string, folder: string) => path === folder || path.startsWith(folder + '/');

const reasonOf = (item: ReorganizeItem) => item.reason ?? item.conflict ?? null;

/** Runs the tasks a few at a time, so that a slow network share is not flooded. */
const mapLimited = async <T, R>(values: T[], task: (value: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += IO_CONCURRENCY) {
    results.push(...(await Promise.all(values.slice(index, index + IO_CONCURRENCY).map((value) => task(value)))));
  }
  return results;
};

@Injectable()
export class ReorganizeService extends BaseService {
  /** Lists the folders a reorganization can start from or go to: the user's libraries and what is inside. */
  async getFolders(auth: AuthDto, dto: ReorganizeFolderQueryDto): Promise<ReorganizeFoldersResponseDto> {
    const libraries = await this.getLibraries(auth);
    if (!dto.path) {
      const folders = libraries.flatMap((library) => library.importPaths.map((path) => cleanPath(path)));
      return { path: null, parent: null, libraryId: null, folders: folders.toSorted() };
    }

    const path = cleanPath(dto.path);
    const library = this.requireLibrary(libraries, path);
    const entries = await this.storageRepository.readdirWithTypes(path).catch(() => []);
    const folders = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(path, entry.name))
      .filter((folder) => !this.isExcluded(library, folder))
      .toSorted();
    const parent = dirname(path);

    return {
      path,
      parent: libraries.some((item) => this.findImportPath(item, parent)) ? parent : null,
      libraryId: library.id,
      folders,
    };
  }

  async preview(auth: AuthDto, dto: ReorganizeDto): Promise<ReorganizePreviewResponseDto> {
    const plan = await this.plan(auth, dto);
    const { items, targetPath } = plan;

    const moving = items.filter((item) => item.action === 'move');
    const folders = new Map<string, { day: string; moveCount: number; renameCount: number; inPlaceCount: number }>();
    for (const item of items) {
      if (item.action !== 'move' && item.action !== 'in-place') {
        continue;
      }
      const folder = folders.get(item.folder!) ?? { day: item.day!, moveCount: 0, renameCount: 0, inPlaceCount: 0 };
      folder.moveCount += item.action === 'move' ? 1 : 0;
      folder.renameCount += item.renamed ? 1 : 0;
      folder.inPlaceCount += item.action === 'in-place' ? 1 : 0;
      folders.set(item.folder!, folder);
    }

    const staying = new Map<string, { action: 'conflict' | 'skip'; reason: ReorganizeReason; count: number }>();
    for (const item of items) {
      if (item.action !== 'conflict' && item.action !== 'skip') {
        continue;
      }
      const reason = (item.action === 'conflict' ? item.conflict : item.reason)!;
      const entry = staying.get(reason) ?? { action: item.action, reason, count: 0 };
      entry.count++;
      staying.set(reason, entry);
    }

    const isMonthly = dto.preset === 'year-month';
    const { otherFileCount, emptyFolderCount } = await this.getLeftovers(plan, dto.includeSubfolders);

    return {
      targetLibraryId: plan.targetLibrary.id,
      total: items.length,
      moveCount: moving.length,
      renameCount: moving.filter((item) => item.renamed).length,
      inPlaceCount: items.filter((item) => item.action === 'in-place').length,
      conflictCount: items.filter((item) => item.action === 'conflict').length,
      skipCount: items.filter((item) => item.action === 'skip').length,
      sidecarCount: moving.filter((item) => item.sidecar).length,
      newFolderCount: [...folders].filter(
        ([folder, { moveCount }]) => moveCount > 0 && !plan.existingFolders.has(folder),
      ).length,
      otherFileCount,
      emptyFolderCount,
      folders: [...folders]
        .map(([folder, counts]) => ({
          ...counts,
          day: isMonthly ? null : counts.day,
          folder: relative(targetPath, folder),
          label: isMonthly ? '' : (plan.labels[counts.day] ?? ''),
          existingLabels: isMonthly ? [] : (plan.existingLabels.get(counts.day) ?? []),
          exists: plan.existingFolders.has(folder),
        }))
        .toSorted((a, b) => a.folder.localeCompare(b.folder)),
      staying: staying
        .values()
        .toArray()
        .toSorted((a, b) => b.count - a.count),
      libraries: plan.libraries
        .map((library) => ({
          id: library.id,
          name: library.name,
          count: plan.assets.filter((asset) => asset.libraryId === library.id).length,
          isTarget: library.id === plan.targetLibrary.id,
          isExcluded: dto.excludedLibraryIds.includes(library.id),
        }))
        .filter((library) => library.count > 0),
    };
  }

  /** The photos of one date folder, or the ones staying for one reason, for the detailed list of the preview. */
  async previewItems(auth: AuthDto, dto: ReorganizeItemsDto): Promise<ReorganizeItemsResponseDto> {
    const { items, targetPath } = await this.plan(auth, dto);
    const folder = dto.folder === undefined ? undefined : join(targetPath, dto.folder);

    const matching = items.filter(
      (item) =>
        (folder === undefined || (item.folder === folder && (item.action === 'move' || item.action === 'in-place'))) &&
        (!dto.action || item.action === dto.action) &&
        (!dto.reason || reasonOf(item) === dto.reason),
    );

    return {
      total: matching.length,
      items: matching.slice(0, dto.limit).map((item) => ({
        assetId: item.assetId,
        action: item.action,
        reason: reasonOf(item),
        fromPath: item.original.from,
        toPath: item.action === 'move' || item.action === 'in-place' ? item.original.to : null,
        isRenamed: item.renamed,
        hasSidecar: !!item.sidecar,
      })),
    };
  }

  /** Works out where every photo of the source goes. Reads the disk but changes nothing on it. */
  async plan(auth: AuthDto, dto: ReorganizeDto): Promise<ReorganizePlan> {
    const libraries = await this.getLibraries(auth);
    const targetPath = cleanPath(dto.targetPath);
    const targetLibrary = this.requireLibrary(libraries, targetPath);
    if (this.isExcluded(targetLibrary, targetPath)) {
      throw new BadRequestException('The target folder is excluded from its library');
    }

    const requested: Record<string, string> = {};
    for (const [day, label] of Object.entries(dto.labels)) {
      try {
        requested[day] = normalizeLabel(label);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
    }

    let sourcePath: string | undefined;
    const load = async () => {
      if (dto.sourceType === 'album') {
        if (!dto.sourceAlbumId) {
          throw new BadRequestException('An album source needs an album');
        }
        await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.sourceAlbumId] });
        return this.reorganizeRepository.getAlbumAssets(dto.sourceAlbumId);
      }

      if (!dto.sourcePath) {
        throw new BadRequestException('A folder source needs a folder');
      }
      const folder = (sourcePath = cleanPath(dto.sourcePath));
      this.requireLibrary(libraries, folder);
      const rows = await this.reorganizeRepository.getFolderAssets(folder);
      return dto.includeSubfolders ? rows : rows.filter((row) => dirname(row.originalPath) === folder);
    };

    let rows = await load();
    const undated = rows.filter(
      (row) => row.dateFromExif === null && row.ownerId === auth.user.id && row.libraryId && !row.deletedAt,
    );
    if (undated.length > 0) {
      await BaseService.create(MetadataService, this).backfillDateSources(undated.map((row) => row.id));
      rows = await load();
    }

    const assets: ReorganizeAsset[] = rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      libraryId: row.libraryId,
      libraryOwnerId: row.libraryOwnerId,
      originalPath: row.originalPath,
      localDateTime: new Date(row.localDateTime),
      dateFromExif: row.dateFromExif,
      isOffline: row.isOffline,
      isTrashed: !!row.deletedAt,
      sidecarPath: row.sidecarPath,
      liveVideo:
        row.videoId && row.videoPath && row.videoIsExternal ? { id: row.videoId, originalPath: row.videoPath } : null,
    }));

    const days = [...new Set(assets.map((asset) => getLocalDay(asset.localDateTime)))];
    const existingLabels = await this.getExistingLabels(targetPath, dto.preset, days);
    const labels: Record<string, string> = {};
    for (const day of days) {
      labels[day] = Object.hasOwn(requested, day) ? requested[day] : (existingLabels.get(day)?.[0] ?? '');
    }

    const folders = [
      ...new Set(
        days.map((day) =>
          join(targetPath, getDateFolder(dto.preset, day, dto.preset === 'year-month' ? '' : labels[day])),
        ),
      ),
    ];
    const excludedFolder = folders.find((folder) => this.isExcluded(targetLibrary, folder));
    if (excludedFolder) {
      throw new BadRequestException(`${excludedFolder} is excluded from its library`);
    }

    const occupied = new Set<string>();
    const existingFolders = new Set<string>();
    await mapLimited(folders, async (folder) => {
      const names = await this.storageRepository.readdir(folder).catch(() => null);
      if (names) {
        existingFolders.add(folder);
        for (const name of names) {
          occupied.add(join(folder, name));
        }
      }
    });

    const options = {
      userId: auth.user.id,
      targetPath,
      targetLibraryId: targetLibrary.id,
      preset: dto.preset,
      labels,
      autoRename: dto.autoRename,
      excludedLibraryIds: dto.excludedLibraryIds,
      occupied,
    };
    let items = planReorganization(assets, { ...options, identicalIds: new Set() });
    const checks = getContentChecks(items, occupied);
    if (checks.length > 0) {
      const identical = await mapLimited(checks, async (check) =>
        (await this.hasSameContent(check.path, check.otherPath)) ? check.assetId : undefined,
      );
      const identicalIds = new Set(identical.filter((id) => id !== undefined));
      if (identicalIds.size > 0) {
        items = planReorganization(assets, { ...options, identicalIds });
      }
    }

    return { targetPath, targetLibrary, sourcePath, libraries, assets, items, labels, existingLabels, existingFolders };
  }

  /** Starts a reorganization: stores where every photo goes, then moves them in the background. */
  async create(auth: AuthDto, dto: ReorganizeDto): Promise<ReorganizationResponseDto> {
    await this.requireReady();
    const plan = await this.plan(auth, dto);
    const moving = plan.items.filter((item) => item.action === 'move');
    if (moving.length === 0) {
      throw new BadRequestException('There is nothing to move');
    }
    await this.requireWritable(plan, moving);

    let sourceName = plan.sourcePath;
    if (dto.sourceType === 'album') {
      const album = await this.albumRepository.getById(dto.sourceAlbumId!, { withAssets: false });
      sourceName = album?.albumName;
    }

    const record = await this.reorganizeRepository.create(
      {
        ownerId: auth.user.id,
        sourceType: dto.sourceType,
        sourcePath: plan.sourcePath ?? null,
        sourceAlbumId: dto.sourceType === 'album' ? dto.sourceAlbumId : null,
        sourceName: sourceName ?? '',
        targetPath: plan.targetPath,
        preset: dto.preset,
        autoRename: dto.autoRename,
        status: 'queued' satisfies ReorganizationStatus,
        inPlaceCount: plan.items.filter((item) => item.action === 'in-place').length,
      },
      plan.items
        .filter((item) => item.action !== 'in-place')
        .map((item) => {
          const isMoving = item.action === 'move';
          return {
            assetId: item.assetId,
            status: (isMoving ? 'pending' : 'stayed') satisfies ReorganizationItemStatus,
            reason: reasonOf(item),
            fromPath: item.original.from,
            toPath: isMoving ? item.original.to : null,
            fromLibraryId: item.fromLibraryId,
            toLibraryId: isMoving ? plan.targetLibrary.id : null,
            sidecarFromPath: isMoving ? (item.sidecar?.from ?? null) : null,
            sidecarToPath: isMoving ? (item.sidecar?.to ?? null) : null,
            videoAssetId: isMoving ? (item.liveVideo?.assetId ?? null) : null,
            videoFromPath: isMoving ? (item.liveVideo?.from ?? null) : null,
            videoToPath: isMoving ? (item.liveVideo?.to ?? null) : null,
          };
        }),
    );
    await this.jobRepository.queue({ name: JobName.Reorganize, data: { id: record.id } });

    return this.get(auth, record.id);
  }

  async getAll(auth: AuthDto): Promise<ReorganizationResponseDto[]> {
    const records = await this.reorganizeRepository.getAll(auth.user.id);
    const counts = await this.reorganizeRepository.getItemCounts(records.map((record) => record.id));

    return records.map((record) => {
      const count = (...statuses: ReorganizationItemStatus[]) =>
        counts
          .filter(
            (row) => row.reorganizationId === record.id && statuses.includes(row.status as ReorganizationItemStatus),
          )
          .reduce((sum, row) => sum + Number(row.count), 0);

      return {
        id: record.id,
        createdAt: new Date(record.createdAt),
        finishedAt: record.finishedAt ? new Date(record.finishedAt) : null,
        sourceType: record.sourceType as ReorganizeDto['sourceType'],
        sourceName: record.sourceName,
        targetPath: record.targetPath,
        preset: record.preset as ReorganizeDto['preset'],
        autoRename: record.autoRename,
        status: record.status as ReorganizationStatus,
        isUndo: record.isUndo,
        error: record.error,
        pendingCount: count('pending', 'moving'),
        movedCount: count('moved', 'undoing'),
        failedCount: count('failed', 'undo-failed'),
        stayedCount: count('stayed'),
        undoneCount: count('undone'),
        undoSkippedCount: count('undo-skipped'),
        inPlaceCount: record.inPlaceCount,
        removedFolderCount: record.removedFolders.length,
      };
    });
  }

  async get(auth: AuthDto, id: string): Promise<ReorganizationResponseDto> {
    const records = await this.getAll(auth);
    const record = records.find((record) => record.id === id);
    if (!record) {
      throw new BadRequestException('Reorganization not found');
    }
    return record;
  }

  async getItems(auth: AuthDto, id: string, dto: ReorganizationItemsQueryDto): Promise<ReorganizationItemDto[]> {
    await this.requireRecord(auth, id);
    const items = await this.reorganizeRepository.getItems(id, {
      statuses: dto.status ? [dto.status] : undefined,
      limit: dto.limit,
    });

    return items.map((item) => ({
      id: item.id,
      assetId: item.assetId,
      status: item.status as ReorganizationItemStatus,
      reason: item.reason,
      error: item.error,
      fromPath: item.fromPath,
      toPath: item.toPath,
      hasSidecar: !!item.sidecarFromPath,
    }));
  }

  /**
   * Stops a reorganization after the photo it is busy with. What already moved stays where it is. A run that has
   * not started yet (or whose job got lost) is cancelled on the spot.
   */
  async cancel(auth: AuthDto, id: string): Promise<ReorganizationResponseDto> {
    const record = await this.requireRecord(auth, id);
    if (record.status !== 'queued' && record.status !== 'running') {
      throw new BadRequestException('The reorganization is not running');
    }
    if (!(await this.reorganizeRepository.transition(id, 'queued', 'cancelled'))) {
      await this.reorganizeRepository.update(id, { cancelRequested: true });
    }
    return this.get(auth, id);
  }

  /**
   * Picks up a reorganization (or its undo) that stopped early. Photos that failed are tried again, and so are the
   * ones that stayed for a reason found while running, such as a place that was taken.
   */
  async resume(auth: AuthDto, id: string): Promise<ReorganizationResponseDto> {
    const record = await this.requireRecord(auth, id);
    await this.requireReady();
    await (record.isUndo
      ? this.reorganizeRepository.retryStayed(id, 'undo-skipped', 'moved')
      : this.reorganizeRepository.retryStayed(id, 'stayed', 'pending'));
    await this.reorganizeRepository.update(id, { status: 'queued', cancelRequested: false, error: null });
    await this.jobRepository.queue({ name: JobName.Reorganize, data: { id: record.id } });
    return this.get(auth, id);
  }

  /**
   * Moves the photos of a reorganization back to where they were, as far as that is still possible. Undoing again
   * retries the photos an earlier undo had to leave.
   */
  async undo(auth: AuthDto, id: string): Promise<ReorganizationResponseDto> {
    const record = await this.requireRecord(auth, id);
    await this.requireReady();
    await this.reorganizeRepository.retryStayed(id, 'undo-skipped', 'moved');
    const { movedCount, failedCount } = await this.get(auth, id);
    if (movedCount + failedCount === 0) {
      throw new BadRequestException('There is nothing to undo');
    }
    await this.reorganizeRepository.update(id, { status: 'queued', isUndo: true, cancelRequested: false, error: null });
    await this.jobRepository.queue({ name: JobName.Reorganize, data: { id: record.id } });
    return this.get(auth, id);
  }

  /** Forgets a reorganization. The photos stay where they are, and it can no longer be undone. */
  async delete(auth: AuthDto, id: string): Promise<void> {
    const record = await this.requireRecord(auth, id);
    if (record.status === 'queued' || record.status === 'running') {
      throw new BadRequestException('The reorganization is still running');
    }
    await this.reorganizeRepository.delete(id);
  }

  private async requireRecord(auth: AuthDto, id: string) {
    const record = await this.reorganizeRepository.get(id);
    if (!record || record.ownerId !== auth.user.id) {
      throw new BadRequestException('Reorganization not found');
    }
    return record;
  }

  /**
   * Only one reorganization runs at a time, across all users, and none while the library watcher is on: the
   * watcher answers every file that loses its name by deleting the asset at that path.
   */
  private async requireReady() {
    if (await this.reorganizeRepository.getActive()) {
      throw new BadRequestException('Another reorganization is still running');
    }
    const { library } = await this.getConfig({ withCache: false });
    if (library.watch.enabled) {
      throw new BadRequestException('Turn off library watching before reorganizing');
    }
  }

  /** Makes sure files can be created in the target and removed from where the photos are now. */
  private async requireWritable(plan: ReorganizePlan, moving: ReorganizeItem[]) {
    let target = plan.targetPath;
    while (
      !(await this.storageRepository.checkFileExists(target)) &&
      this.findImportPath(plan.targetLibrary, dirname(target))
    ) {
      target = dirname(target);
    }

    const folders = [...new Set([target, ...moving.map((item) => dirname(item.original.from))])];
    const writable = await mapLimited(folders, (folder) =>
      this.storageRepository.checkFileExists(folder, constants.W_OK),
    );
    const index = writable.indexOf(false);
    if (index !== -1) {
      throw new BadRequestException(`${folders[index]} is not writable`);
    }
  }

  private async getLibraries(auth: AuthDto): Promise<Library[]> {
    const libraries = await this.libraryRepository.getAll();
    return libraries.filter((library) => library.ownerId === auth.user.id);
  }

  private findImportPath(library: Library, path: string) {
    return library.importPaths
      .map((importPath) => cleanPath(importPath))
      .find((importPath) => isWithin(path, importPath));
  }

  private requireLibrary(libraries: Library[], path: string): Library {
    const library = libraries.find((library) => this.findImportPath(library, path));
    if (!library) {
      throw new BadRequestException(`${path} is not inside an import path of one of your libraries`);
    }
    return library;
  }

  /** Whether the library scan would leave out the photos of a folder. */
  private isExcluded(library: Library, folder: string) {
    return library.exclusionPatterns.some((pattern) => picomatch.isMatch(join(folder, 'photo.jpg'), pattern));
  }

  /** The labels of the day folders that already exist in the target, per day. */
  private async getExistingLabels(targetPath: string, preset: ReorganizeDto['preset'], days: string[]) {
    const labels = new Map<string, string[]>();
    const parents = [
      ...new Set(days.map((day) => getDayFolderParent(preset, day)).filter((parent) => parent !== undefined)),
    ];
    await mapLimited(parents, async (parent) => {
      const entries = await this.storageRepository.readdirWithTypes(join(targetPath, parent)).catch(() => []);
      for (const entry of entries) {
        const parsed = entry.isDirectory() ? parseDayFolder(entry.name) : undefined;
        if (parsed) {
          labels.set(parsed.day, [...(labels.get(parsed.day) ?? []), parsed.label].toSorted());
        }
      }
    });
    return labels;
  }

  private async hasSameContent(path: string, otherPath: string): Promise<boolean> {
    try {
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
    } catch (error) {
      this.logger.warn(`Unable to compare ${path} with ${otherPath}: ${error}`);
      return false;
    }
  }

  /**
   * For a folder source: how many files in it are not photos of the library and so stay, and how many of its
   * subfolders will have nothing left in them.
   */
  private async getLeftovers(plan: ReorganizePlan, includeSubfolders: boolean) {
    if (!plan.sourcePath) {
      return { otherFileCount: 0, emptyFolderCount: 0 };
    }

    const known = new Set<string>();
    for (const asset of plan.assets) {
      known.add(asset.originalPath);
      if (asset.sidecarPath) {
        known.add(asset.sidecarPath);
      }
      if (asset.liveVideo) {
        known.add(asset.liveVideo.originalPath);
      }
    }
    const leaving = new Set<string>();
    const receiving: string[] = [];
    for (const item of plan.items) {
      if (item.action !== 'move') {
        continue;
      }

      for (const file of [item.original, item.sidecar, item.liveVideo]) {
        if (file) {
          leaving.add(file.from);
        }
      }
      receiving.push(item.folder!);
    }

    let otherFileCount = 0;
    let emptyFolderCount = 0;
    /** Whether the folder loses files and has nothing left afterwards. */
    const walk = async (folder: string, isRoot: boolean): Promise<{ isEmptied: boolean; isLosing: boolean }> => {
      const entries = await this.storageRepository.readdirWithTypes(folder).catch(() => []);
      let isEmptied = receiving.every((target) => !isWithin(target, folder));
      let isLosing = false;
      for (const entry of entries) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
          const child = includeSubfolders ? await walk(path, false) : { isEmptied: false, isLosing: false };
          isEmptied &&= child.isEmptied;
          isLosing ||= child.isLosing;
          continue;
        }
        if (!known.has(path)) {
          otherFileCount++;
        }
        if (leaving.has(path)) {
          isLosing = true;
        } else {
          isEmptied = false;
        }
      }
      if (isEmptied && isLosing && !isRoot) {
        emptyFolderCount++;
      }
      return { isEmptied, isLosing };
    };
    await walk(plan.sourcePath, true);

    return { otherFileCount, emptyFolderCount };
  }
}
