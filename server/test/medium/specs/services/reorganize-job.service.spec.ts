import { Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ReorganizeDto } from 'src/dtos/reorganize.dto';
import { AssetFileType, JobStatus, QueueName } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LibraryRepository } from 'src/repositories/library.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ReorganizeRepository } from 'src/repositories/reorganize.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { ReorganizeJobService } from 'src/services/reorganize-job.service';
import { ReorganizeService } from 'src/services/reorganize.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async () => {
  const { sut, ctx } = newMediumService(ReorganizeService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetRepository,
      AssetJobRepository,
      ConfigRepository,
      CryptoRepository,
      DatabaseRepository,
      LibraryRepository,
      ReorganizeRepository,
      StorageRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  const job = BaseService.create(ReorganizeJobService, sut);
  const jobs = ctx.getMock(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.pause.mockResolvedValue();
  jobs.resume.mockResolvedValue();
  jobs.isPaused.mockResolvedValue(false);
  jobs.isActive.mockResolvedValue(false);
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });
  const root = await mkdtemp(join(tmpdir(), 'immich-reorganize-'));
  roots.push(root);

  const newLibrary = async (name: string) => {
    await mkdir(join(root, name), { recursive: true });
    const library = await ctx.database
      .insertInto('library')
      .values({ ownerId: user.id, name, importPaths: [join(root, name)], exclusionPatterns: ['**/.*'] })
      .returningAll()
      .executeTakeFirstOrThrow();
    return library.id;
  };

  /** A photo on disk and in the database, optionally with a sidecar next to it. */
  const newPhoto = async (
    libraryId: string,
    path: string,
    options: { day?: string; content?: string; sidecar?: boolean } = {},
  ) => {
    const localDateTime = new Date(`${options.day ?? '2026-03-15'}T10:00:00Z`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, options.content ?? `content of ${path}`);
    const { asset } = await ctx.newAsset({
      ownerId: user.id,
      libraryId,
      isExternal: true,
      originalPath: path,
      originalFileName: path.split('/').at(-1),
      localDateTime,
      fileCreatedAt: localDateTime,
    });
    await ctx.get(AssetRepository).upsertJobStatus({ assetId: asset.id, dateFromExif: true });
    if (options.sidecar) {
      await writeFile(`${path}.xmp`, `sidecar of ${path}`);
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Sidecar, path: `${path}.xmp` });
    }
    return asset.id;
  };

  const getAsset = (id: string) =>
    ctx.database.selectFrom('asset').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const getSidecar = (assetId: string) =>
    ctx.database
      .selectFrom('asset_file')
      .select('path')
      .where('assetId', '=', assetId)
      .where('type', '=', AssetFileType.Sidecar)
      .executeTakeFirst();
  const getItems = (id: string) =>
    ctx.database
      .selectFrom('reorganization_item')
      .selectAll()
      .where('reorganizationId', '=', id)
      .orderBy('position')
      .execute();

  return { sut, job, ctx, auth, user, root, newLibrary, newPhoto, getAsset, getSidecar, getItems, dto };
};

const dto = (folder: string, extra: Partial<ReorganizeDto> = {}): ReorganizeDto => ({
  sourceType: 'folder',
  sourcePath: folder,
  includeSubfolders: true,
  targetPath: folder,
  preset: 'day',
  labels: {},
  autoRename: false,
  excludedLibraryIds: [],
  ...extra,
});

/** Makes hard links fail between the two libraries, as they do between two mounts. */
const splitMounts = (storage: StorageRepository, root: string) => {
  const link = storage.link.bind(storage);
  const mountOf = (path: string) => path.slice(root.length + 1).split('/', 1)[0];
  return vitest.spyOn(storage, 'link').mockImplementation((from, to) => {
    if (mountOf(from) !== mountOf(to)) {
      return Promise.reject(error('EXDEV'));
    }
    return link(from, to);
  });
};

const roots: string[] = [];
const pathChecksum = (path: string) => createHash('sha1').update(`path:${path}`).digest();
/** Every file under a folder, relative to it. */
const tree = async (folder: string): Promise<string[]> => {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
    .toSorted((a, b) => a.localeCompare(b));
};
const error = (code: string) => Object.assign(new Error(code), { code });

describe(ReorganizeJobService.name, () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
  });

  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  it('should move the photos of a folder into the folders of their days, keeping the assets', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getSidecar, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/IMG_1.CR2`, { sidecar: true });
    const b = await newPhoto(libraryId, `${team}/phone/IMG_2.jpg`, { day: '2026-03-14' });
    const c = await newPhoto(libraryId, `${team}/2026-03-14/IMG_3.jpg`, { day: '2026-03-14' });
    await writeFile(`${team}/notes.txt`, 'not a photo');
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id }, [a]);

    const created = await sut.create(auth, dto(team));
    expect(created).toMatchObject({ status: 'queued', pendingCount: 2, inPlaceCount: 1 });
    expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledWith({ name: 'Reorganize', data: { id: created.id } });

    await expect(job.handleReorganize({ id: created.id })).resolves.toBe(JobStatus.Success);

    await expect(tree(team)).resolves.toEqual([
      '2026-03-14/IMG_2.jpg',
      '2026-03-14/IMG_3.jpg',
      '2026-03-15/IMG_1.CR2',
      '2026-03-15/IMG_1.CR2.xmp',
      'notes.txt',
    ]);
    // the subfolder the reorganization emptied is gone
    expect(existsSync(`${team}/phone`)).toBe(false);

    const asset = await getAsset(a);
    expect(asset.originalPath).toBe(`${team}/2026-03-15/IMG_1.CR2`);
    expect(asset.checksum).toEqual(pathChecksum(`${team}/2026-03-15/IMG_1.CR2`));
    expect(asset.originalFileName).toBe('IMG_1.CR2');
    expect(asset.libraryId).toBe(libraryId);
    await expect(getSidecar(a)).resolves.toEqual({ path: `${team}/2026-03-15/IMG_1.CR2.xmp` });
    await expect(getAsset(b)).resolves.toMatchObject({ originalPath: `${team}/2026-03-14/IMG_2.jpg` });
    await expect(getAsset(c)).resolves.toMatchObject({ originalPath: `${team}/2026-03-14/IMG_3.jpg` });
    await expect(readFile(`${team}/2026-03-15/IMG_1.CR2`, 'utf8')).resolves.toBe(`content of ${team}/IMG_1.CR2`);

    // what hangs off the asset is untouched
    const albumAssets = await ctx.database
      .selectFrom('album_asset')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(albumAssets.map((row) => row.assetId)).toEqual([a]);

    await expect(sut.get(auth, created.id)).resolves.toMatchObject({
      status: 'completed',
      isUndo: false,
      pendingCount: 0,
      movedCount: 2,
      failedCount: 0,
      removedFolderCount: 1,
    });
    // the library queue was paused for the run and let go afterwards
    expect(ctx.getMock(JobRepository).pause).toHaveBeenCalledWith(QueueName.Library);
    expect(ctx.getMock(JobRepository).resume).toHaveBeenCalledWith(QueueName.Library);
  });

  it('should never replace a file that turned up at the target after the preview', async () => {
    const { sut, job, auth, root, newLibrary, newPhoto, getAsset, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/a.jpg`, { sidecar: true });
    const b = await newPhoto(libraryId, `${team}/b.jpg`, { sidecar: true });

    const created = await sut.create(auth, dto(team));
    await mkdir(`${team}/2026-03-15`, { recursive: true });
    await writeFile(`${team}/2026-03-15/a.jpg`, 'someone else');
    await writeFile(`${team}/2026-03-15/b.jpg.xmp`, 'someone else');
    await job.handleReorganize({ id: created.id });

    await expect(readFile(`${team}/2026-03-15/a.jpg`, 'utf8')).resolves.toBe('someone else');
    await expect(readFile(`${team}/2026-03-15/b.jpg.xmp`, 'utf8')).resolves.toBe('someone else');
    // the photo whose sidecar could not go is taken back as a whole
    await expect(tree(team)).resolves.toEqual([
      '2026-03-15/a.jpg',
      '2026-03-15/b.jpg.xmp',
      'a.jpg',
      'a.jpg.xmp',
      'b.jpg',
      'b.jpg.xmp',
    ]);
    await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/a.jpg` });
    await expect(getAsset(b)).resolves.toMatchObject({ originalPath: `${team}/b.jpg` });
    const items = await getItems(created.id);
    expect(items.map((item) => [item.status, item.reason])).toEqual([
      ['stayed', 'target-exists'],
      ['stayed', 'target-exists'],
    ]);
  });

  it('should rename a photo whose name is taken, and give it its name back on undo', async () => {
    const { sut, job, auth, root, newLibrary, newPhoto, getAsset, getSidecar, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const camera = await newPhoto(libraryId, `${team}/camera/a.jpg`, { sidecar: true });
    const phone = await newPhoto(libraryId, `${team}/phone/a.jpg`, { sidecar: true });

    const created = await sut.create(auth, dto(team, { autoRename: true }));
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual([
      '2026-03-15/a-2.jpg',
      '2026-03-15/a-2.jpg.xmp',
      '2026-03-15/a.jpg',
      '2026-03-15/a.jpg.xmp',
    ]);
    await expect(getAsset(phone)).resolves.toMatchObject({
      originalPath: `${team}/2026-03-15/a-2.jpg`,
      originalFileName: 'a-2.jpg',
    });
    await expect(getSidecar(phone)).resolves.toEqual({ path: `${team}/2026-03-15/a-2.jpg.xmp` });

    await expect(sut.undo(auth, created.id)).resolves.toMatchObject({ status: 'queued', isUndo: true });
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['camera/a.jpg', 'camera/a.jpg.xmp', 'phone/a.jpg', 'phone/a.jpg.xmp']);
    // the date folder the reorganization created is gone again
    expect(existsSync(`${team}/2026-03-15`)).toBe(false);
    const asset = await getAsset(phone);
    expect(asset).toMatchObject({ originalPath: `${team}/phone/a.jpg`, originalFileName: 'a.jpg' });
    expect(asset.checksum).toEqual(pathChecksum(`${team}/phone/a.jpg`));
    await expect(getSidecar(phone)).resolves.toEqual({ path: `${team}/phone/a.jpg.xmp` });
    await expect(getAsset(camera)).resolves.toMatchObject({ originalPath: `${team}/camera/a.jpg` });
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({
      status: 'completed',
      isUndo: true,
      movedCount: 0,
      undoneCount: 2,
    });
    await expect(sut.undo(auth, created.id)).rejects.toThrow('nothing to undo');
  });

  it('should leave a photo on undo when its old place is taken or it moved again', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/a.jpg`);
    const b = await newPhoto(libraryId, `${team}/b.jpg`);
    const c = await newPhoto(libraryId, `${team}/c.jpg`);

    const created = await sut.create(auth, dto(team));
    await job.handleReorganize({ id: created.id });
    await writeFile(`${team}/a.jpg`, 'a new file with the old name');
    await ctx.database
      .updateTable('asset')
      .set({ originalPath: `${team}/elsewhere/b.jpg` })
      .where('id', '=', b)
      .execute();

    await sut.undo(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(readFile(`${team}/a.jpg`, 'utf8')).resolves.toBe('a new file with the old name');
    await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/2026-03-15/a.jpg` });
    await expect(getAsset(c)).resolves.toMatchObject({ originalPath: `${team}/c.jpg` });
    const items = await getItems(created.id);
    expect(items.map((item) => [item.status, item.reason])).toEqual([
      ['undo-skipped', 'target-exists'],
      ['undo-skipped', 'changed'],
      ['undone', null],
    ]);
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({ undoneCount: 1, undoSkippedCount: 2 });
  });

  describe('across file systems', () => {
    it('should copy, verify and then remove the original, and move the asset to the target library', async () => {
      const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getSidecar, dto } = await setup();
      const mine = await newLibrary('mine');
      const family = await newLibrary('family');
      const a = await newPhoto(family, `${root}/family/in/a.jpg`, { sidecar: true });
      await utimes(`${root}/family/in/a.jpg`, new Date('2026-03-15T10:00:00Z'), new Date('2026-03-15T10:00:00Z'));
      splitMounts(ctx.get(StorageRepository), root);

      const created = await sut.create(
        auth,
        dto(`${root}/family/in`, { targetPath: `${root}/mine/trip`, preset: 'year-month' }),
      );
      await job.handleReorganize({ id: created.id });

      await expect(tree(root)).resolves.toEqual(['mine/trip/2026/03/a.jpg', 'mine/trip/2026/03/a.jpg.xmp']);
      await expect(readFile(`${root}/mine/trip/2026/03/a.jpg`, 'utf8')).resolves.toBe(
        `content of ${root}/family/in/a.jpg`,
      );
      // the modification time survives the copy, so that the next scan does not extract the metadata again
      const stats = await stat(`${root}/mine/trip/2026/03/a.jpg`);
      expect(stats.mtime).toEqual(new Date('2026-03-15T10:00:00Z'));
      await expect(getAsset(a)).resolves.toMatchObject({
        originalPath: `${root}/mine/trip/2026/03/a.jpg`,
        libraryId: mine,
      });
      await expect(getSidecar(a)).resolves.toEqual({ path: `${root}/mine/trip/2026/03/a.jpg.xmp` });

      await sut.undo(auth, created.id);
      await job.handleReorganize({ id: created.id });

      await expect(tree(root)).resolves.toEqual(['family/in/a.jpg', 'family/in/a.jpg.xmp']);
      await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${root}/family/in/a.jpg`, libraryId: family });
    });

    it('should keep the original when the copy does not match it', async () => {
      const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getItems, dto } = await setup();
      await newLibrary('mine');
      const family = await newLibrary('family');
      const a = await newPhoto(family, `${root}/family/in/a.jpg`);
      splitMounts(ctx.get(StorageRepository), root);
      const crypto = ctx.get(CryptoRepository);
      const hashFile = crypto.hashFile.bind(crypto);
      vitest
        .spyOn(crypto, 'hashFile')
        .mockImplementation((path) =>
          String(path).endsWith('.tmp') ? Promise.resolve(Buffer.from('corrupted')) : hashFile(path),
        );

      const created = await sut.create(auth, dto(`${root}/family/in`, { targetPath: `${root}/mine/trip` }));
      await job.handleReorganize({ id: created.id });

      await expect(tree(root)).resolves.toEqual(['family/in/a.jpg']);
      await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${root}/family/in/a.jpg`, libraryId: family });
      const [item] = await getItems(created.id);
      expect(item.status).toBe('failed');
      expect(item.error).toContain('does not match');
      await expect(sut.get(auth, created.id)).resolves.toMatchObject({ status: 'completed', failedCount: 1 });
    });
  });

  it('should take the files back when the database cannot be updated, and move them on a retry', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/a.jpg`, { sidecar: true });
    const repository = ctx.get(ReorganizeRepository);
    const applyMove = vitest.spyOn(repository, 'applyMove').mockRejectedValueOnce(new Error('duplicate key'));

    const created = await sut.create(auth, dto(team));
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['a.jpg', 'a.jpg.xmp']);
    await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/a.jpg` });
    const [item] = await getItems(created.id);
    expect(item).toMatchObject({ status: 'failed', error: 'Error: duplicate key' });

    applyMove.mockRestore();
    await expect(sut.resume(auth, created.id)).resolves.toMatchObject({ status: 'queued' });
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', '2026-03-15/a.jpg.xmp']);
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({
      status: 'completed',
      movedCount: 1,
      failedCount: 0,
    });
  });

  it('should stop after the photo it is busy with when cancelled, and continue later', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    await newPhoto(libraryId, `${team}/a.jpg`);
    await newPhoto(libraryId, `${team}/b.jpg`);
    await newPhoto(libraryId, `${team}/c.jpg`);

    const created = await sut.create(auth, dto(team));
    const repository = ctx.get(ReorganizeRepository);
    const applyMove = repository.applyMove.bind(repository);
    const spy = vitest.spyOn(repository, 'applyMove').mockImplementation(async (...args) => {
      await applyMove(...args);
      await sut.cancel(auth, created.id);
    });
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', 'b.jpg', 'c.jpg']);
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({
      status: 'cancelled',
      movedCount: 1,
      pendingCount: 2,
    });

    spy.mockRestore();
    await sut.resume(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', '2026-03-15/b.jpg', '2026-03-15/c.jpg']);
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({ status: 'completed', movedCount: 3 });
  });

  it('should pause when the storage goes away, and sort out the half-moved photo when continued', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    await newPhoto(libraryId, `${team}/a.jpg`, { sidecar: true });
    await newPhoto(libraryId, `${team}/b.jpg`);
    const storage = ctx.get(StorageRepository);
    const link = storage.link.bind(storage);
    // the photo gets its new name, then the share drops while its sidecar is linked
    const spy = vitest
      .spyOn(storage, 'link')
      .mockImplementation((from, to) => (from.endsWith('.xmp') ? Promise.reject(error('ENOTCONN')) : link(from, to)));
    const unlink = vitest.spyOn(storage, 'unlink').mockRejectedValue(error('ENOTCONN'));

    const created = await sut.create(auth, dto(team));
    await expect(job.handleReorganize({ id: created.id })).resolves.toBe(JobStatus.Success);

    const paused = await sut.get(auth, created.id);
    expect(paused).toMatchObject({ status: 'paused', movedCount: 0 });
    expect(paused.error).toContain('not reachable');
    await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'moving' }, { status: 'pending' }]);
    // the half-done link is still there, next to the original
    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', 'a.jpg', 'a.jpg.xmp', 'b.jpg']);

    spy.mockRestore();
    unlink.mockRestore();
    await sut.resume(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', '2026-03-15/a.jpg.xmp', '2026-03-15/b.jpg']);
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({ status: 'completed', movedCount: 2, error: null });
  });

  describe('a restart in the middle', () => {
    it('should mark the run as interrupted, let the library queue go and not continue by itself', async () => {
      const { sut, job, ctx, auth, root, newLibrary, newPhoto, dto } = await setup();
      const libraryId = await newLibrary('photos');
      const team = join(root, 'photos/team');
      await newPhoto(libraryId, `${team}/a.jpg`);
      const created = await sut.create(auth, dto(team));
      await ctx.database
        .updateTable('reorganization')
        .set({ status: 'running' })
        .where('id', '=', created.id)
        .execute();

      await job.onBootstrap();

      await expect(sut.get(auth, created.id)).resolves.toMatchObject({ status: 'interrupted' });
      expect(ctx.getMock(JobRepository).resume).toHaveBeenCalledWith(QueueName.Library);
      // the job the queue retries after the crash does nothing
      await expect(job.handleReorganize({ id: created.id })).resolves.toBe(JobStatus.Skipped);
      await expect(tree(team)).resolves.toEqual(['a.jpg']);
    });

    it('should finish a photo the database already points at, and take back one it does not', async () => {
      const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getItems, dto } = await setup();
      const libraryId = await newLibrary('photos');
      const team = join(root, 'photos/team');
      const a = await newPhoto(libraryId, `${team}/a.jpg`);
      const b = await newPhoto(libraryId, `${team}/b.jpg`);
      const created = await sut.create(auth, dto(team));

      // a: linked and in the database, old name not removed yet; b: linked only
      const storage = ctx.get(StorageRepository);
      await mkdir(`${team}/2026-03-15`);
      await storage.link(`${team}/a.jpg`, `${team}/2026-03-15/a.jpg`);
      await storage.link(`${team}/b.jpg`, `${team}/2026-03-15/b.jpg`);
      await ctx.database
        .updateTable('asset')
        .set({ originalPath: `${team}/2026-03-15/a.jpg`, checksum: pathChecksum(`${team}/2026-03-15/a.jpg`) })
        .where('id', '=', a)
        .execute();
      await ctx.database
        .updateTable('reorganization_item')
        .set({ status: 'moving' })
        .where('reorganizationId', '=', created.id)
        .execute();
      await ctx.database
        .updateTable('reorganization')
        .set({ status: 'running' })
        .where('id', '=', created.id)
        .execute();
      await job.onBootstrap();

      // the photo it was busy with is sorted out right away, before library scans run again:
      // a is finished (its old name goes), b is taken back (its stray new name goes)
      await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', 'b.jpg']);
      await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'moved' }, { status: 'pending' }]);

      await sut.undo(auth, created.id);
      await job.handleReorganize({ id: created.id });

      await expect(tree(team)).resolves.toEqual(['a.jpg', 'b.jpg']);
      await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/a.jpg` });
      await expect(getAsset(b)).resolves.toMatchObject({ originalPath: `${team}/b.jpg` });
      const items = await getItems(created.id);
      expect(items.map((item) => item.status)).toEqual(['undone', 'pending']);
    });
  });

  it('should pause, not write the photos off, when the storage is gone before the first file is touched', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    await newPhoto(libraryId, `${team}/a.jpg`);
    await newPhoto(libraryId, `${team}/b.jpg`);
    const created = await sut.create(auth, dto(team));
    const stat = vitest.spyOn(ctx.get(StorageRepository), 'stat').mockRejectedValue(error('ENOTCONN'));

    await job.handleReorganize({ id: created.id });

    await expect(sut.get(auth, created.id)).resolves.toMatchObject({
      status: 'paused',
      stayedCount: 0,
      pendingCount: 2,
    });
    await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'moving' }, { status: 'pending' }]);

    stat.mockRestore();
    await sut.resume(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', '2026-03-15/b.jpg']);
  });

  it('should take a photo and its place again when the user continues after freeing the place', async () => {
    const { sut, job, auth, root, newLibrary, newPhoto, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    await newPhoto(libraryId, `${team}/a.jpg`);
    const created = await sut.create(auth, dto(team));
    await mkdir(`${team}/2026-03-15`, { recursive: true });
    await writeFile(`${team}/2026-03-15/a.jpg`, 'in the way');
    await job.handleReorganize({ id: created.id });
    await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'stayed', reason: 'target-exists' }]);

    await rm(`${team}/2026-03-15/a.jpg`);
    await sut.resume(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg']);
    await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'moved', reason: null }]);
  });

  it('should move back, on a second undo, a photo whose old place was taken the first time', async () => {
    const { sut, job, auth, root, newLibrary, newPhoto, getAsset, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/a.jpg`);
    const created = await sut.create(auth, dto(team));
    await job.handleReorganize({ id: created.id });
    await writeFile(`${team}/a.jpg`, 'in the way');

    await sut.undo(auth, created.id);
    await job.handleReorganize({ id: created.id });
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({ isUndo: true, undoSkippedCount: 1 });

    await rm(`${team}/a.jpg`);
    await sut.undo(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['a.jpg']);
    await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/a.jpg` });
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({ undoneCount: 1, undoSkippedCount: 0 });
    await expect(sut.undo(auth, created.id)).rejects.toThrow('nothing to undo');
  });

  it('should take along, on undo, a sidecar that was written after the reorganization', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getSidecar, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/in/a.jpg`);
    const created = await sut.create(auth, dto(team));
    await job.handleReorganize({ id: created.id });

    // the user edits the photo's location: a sidecar appears next to the photo in its date folder
    await writeFile(`${team}/2026-03-15/a.jpg.xmp`, 'new sidecar');
    await ctx.newAssetFile({ assetId: a, type: AssetFileType.Sidecar, path: `${team}/2026-03-15/a.jpg.xmp` });

    await sut.undo(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['in/a.jpg', 'in/a.jpg.xmp']);
    await expect(readFile(`${team}/in/a.jpg.xmp`, 'utf8')).resolves.toBe('new sidecar');
    await expect(getSidecar(a)).resolves.toEqual({ path: `${team}/in/a.jpg.xmp` });
    expect(existsSync(`${team}/2026-03-15`)).toBe(false);
  });

  it('should keep the files in place when the database reports an error but did change', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/a.jpg`);
    const repository = ctx.get(ReorganizeRepository);
    const applyMove = repository.applyMove.bind(repository);
    vitest.spyOn(repository, 'applyMove').mockImplementationOnce(async (...args) => {
      await applyMove(...args);
      throw new Error('connection lost while committing');
    });

    const created = await sut.create(auth, dto(team));
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg']);
    await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/2026-03-15/a.jpg` });
    await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'moved' }]);
  });

  it('should not touch a file at the target that belongs to another photo when sorting out a failed one', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, getItems, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/in/a.jpg`, { content: 'same bytes' });
    const repository = ctx.get(ReorganizeRepository);
    const applyMove = vitest.spyOn(repository, 'applyMove').mockRejectedValueOnce(new Error('duplicate key'));
    const created = await sut.create(auth, dto(`${team}/in`, { targetPath: team }));
    await job.handleReorganize({ id: created.id });
    applyMove.mockRestore();
    await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'failed' }]);

    // before the user retries, an identical copy lands at the target and is imported as its own photo
    const other = await newPhoto(libraryId, `${team}/2026-03-15/a.jpg`, { content: 'same bytes' });

    await sut.resume(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', 'in/a.jpg']);
    await expect(getAsset(other)).resolves.toMatchObject({ originalPath: `${team}/2026-03-15/a.jpg` });
    await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/in/a.jpg` });
    await expect(getItems(created.id)).resolves.toMatchObject([{ status: 'stayed', reason: 'target-exists' }]);
  });

  it('should copy and rename on a file system without hard links', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, getAsset, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    const a = await newPhoto(libraryId, `${team}/a.jpg`, { sidecar: true });
    vitest.spyOn(ctx.get(StorageRepository), 'link').mockRejectedValue(error('EPERM'));

    const created = await sut.create(auth, dto(team));
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['2026-03-15/a.jpg', '2026-03-15/a.jpg.xmp']);
    await expect(readFile(`${team}/2026-03-15/a.jpg`, 'utf8')).resolves.toBe(`content of ${team}/a.jpg`);
    await expect(getAsset(a)).resolves.toMatchObject({ originalPath: `${team}/2026-03-15/a.jpg` });

    await sut.undo(auth, created.id);
    await job.handleReorganize({ id: created.id });

    await expect(tree(team)).resolves.toEqual(['a.jpg', 'a.jpg.xmp']);
  });

  it('should remove the folders it emptied even when the run was cancelled half-way and continued', async () => {
    const { sut, job, ctx, auth, root, newLibrary, newPhoto, dto } = await setup();
    const libraryId = await newLibrary('photos');
    const team = join(root, 'photos/team');
    await newPhoto(libraryId, `${team}/camera/a.jpg`);
    await newPhoto(libraryId, `${team}/phone/b.jpg`);
    const created = await sut.create(auth, dto(team));
    const repository = ctx.get(ReorganizeRepository);
    const applyMove = repository.applyMove.bind(repository);
    const spy = vitest.spyOn(repository, 'applyMove').mockImplementation(async (...args) => {
      await applyMove(...args);
      await sut.cancel(auth, created.id);
    });
    await job.handleReorganize({ id: created.id });
    spy.mockRestore();
    expect(existsSync(`${team}/camera`)).toBe(true);

    await sut.resume(auth, created.id);
    await job.handleReorganize({ id: created.id });

    expect(existsSync(`${team}/camera`)).toBe(false);
    expect(existsSync(`${team}/phone`)).toBe(false);
    await expect(sut.get(auth, created.id)).resolves.toMatchObject({ removedFolderCount: 2 });
  });

  it('should only run one reorganization at a time', async () => {
    const { sut, job, auth, root, newLibrary, newPhoto, dto } = await setup();
    const libraryId = await newLibrary('photos');
    await newPhoto(libraryId, `${root}/photos/one/a.jpg`);
    await newPhoto(libraryId, `${root}/photos/two/b.jpg`);

    const first = await sut.create(auth, dto(`${root}/photos/one`));

    await expect(sut.create(auth, dto(`${root}/photos/two`))).rejects.toThrow('Another reorganization');
    await expect(sut.delete(auth, first.id)).rejects.toThrow('still running');

    // a run that has not started is cancelled on the spot, and its job then does nothing
    await expect(sut.cancel(auth, first.id)).resolves.toMatchObject({ status: 'cancelled', pendingCount: 1 });
    await expect(job.handleReorganize({ id: first.id })).resolves.toBe(JobStatus.Skipped);
    await expect(sut.delete(auth, first.id)).resolves.toBeUndefined();
  });
});
