import { BadRequestException } from '@nestjs/common';
import { Dirent, Stats } from 'node:fs';
import { ReorganizeDto } from 'src/dtos/reorganize.dto';
import { ReorganizeService } from 'src/services/reorganize.service';
import { authStub } from 'test/fixtures/auth.stub';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it } from 'vitest';

const USER = authStub.admin.user.id;
const ROOT = '/external/photos';
const TEAM = `${ROOT}/team`;

const library = (id: string, importPath: string, ownerId = USER) =>
  ({ id, name: id, ownerId, importPaths: [importPath], exclusionPatterns: ['**/.*/**', '**/@eaDir/**'] }) as any;

const row = (path: string, day = '2026-03-15', extra: Record<string, unknown> = {}) => ({
  id: path,
  ownerId: USER,
  libraryId: 'library-1',
  libraryOwnerId: USER,
  originalPath: path,
  localDateTime: new Date(`${day}T10:00:00Z`),
  isOffline: false,
  deletedAt: null,
  dateFromExif: true,
  videoId: null,
  videoPath: null,
  videoIsExternal: null,
  sidecarPath: null,
  ...extra,
});

const dirent = (name: string, isDirectory = false) => ({ name, isDirectory: () => isDirectory }) as Dirent;

const dto = (extra: Partial<ReorganizeDto> = {}): ReorganizeDto => ({
  sourceType: 'folder',
  sourcePath: TEAM,
  includeSubfolders: true,
  targetPath: TEAM,
  preset: 'day',
  labels: {},
  autoRename: false,
  excludedLibraryIds: [],
  ...extra,
});

describe(ReorganizeService.name, () => {
  let sut: ReorganizeService;
  let mocks: ServiceMocks;
  /** What is on disk: folder → entries. A folder left out does not exist. */
  let disk: Record<string, Dirent[]>;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ReorganizeService));
    disk = {};
    mocks.library.getAll.mockResolvedValue([library('library-1', ROOT), library('library-2', '/external/family')]);
    mocks.storage.readdirWithTypes.mockImplementation((folder) =>
      disk[folder] ? Promise.resolve(disk[folder]) : Promise.reject(new Error('ENOENT')),
    );
    mocks.storage.readdir.mockImplementation((folder) =>
      disk[folder] ? Promise.resolve(disk[folder].map((entry) => entry.name)) : Promise.reject(new Error('ENOENT')),
    );
    mocks.reorganize.getFolderAssets.mockResolvedValue([]);
  });

  describe('getFolders', () => {
    it('should list the import paths of the libraries of the user', async () => {
      mocks.library.getAll.mockResolvedValue([
        library('library-1', `${ROOT}/`),
        library('other', '/external/other', 'x'),
      ]);

      await expect(sut.getFolders(authStub.admin, {})).resolves.toEqual({
        path: null,
        parent: null,
        libraryId: null,
        folders: [ROOT],
      });
    });

    it('should list the folders inside a folder, without hidden and excluded ones', async () => {
      disk[ROOT] = [dirent('team', true), dirent('.trash', true), dirent('@eaDir', true), dirent('a.jpg')];

      await expect(sut.getFolders(authStub.admin, { path: ROOT })).resolves.toEqual({
        path: ROOT,
        parent: null,
        libraryId: 'library-1',
        folders: [TEAM],
      });
    });

    it('should offer the parent while it is still inside the library', async () => {
      disk[TEAM] = [];

      await expect(sut.getFolders(authStub.admin, { path: TEAM })).resolves.toMatchObject({ parent: ROOT });
    });

    it('should refuse a folder outside the libraries of the user', async () => {
      await expect(sut.getFolders(authStub.admin, { path: '/etc' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.getFolders(authStub.admin, { path: '/external/photos-2' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('preview', () => {
    it('should refuse a target outside the libraries of the user', async () => {
      await expect(sut.preview(authStub.admin, dto({ targetPath: '/tmp/out' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should refuse a target the library scan would exclude', async () => {
      await expect(sut.preview(authStub.admin, dto({ targetPath: `${ROOT}/.hidden` }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should refuse a label that cannot be a folder name', async () => {
      await expect(sut.preview(authStub.admin, dto({ labels: { '2026-03-15': 'a/b' } }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should refuse a source folder outside the libraries of the user', async () => {
      await expect(sut.preview(authStub.admin, dto({ sourcePath: '/etc' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should summarize a folder reorganized in place', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([
        row(`${TEAM}/IMG_1.CR2`, '2026-03-15', { sidecarPath: `${TEAM}/IMG_1.CR2.xmp` }),
        row(`${TEAM}/IMG_2.CR2`, '2026-03-14'),
        row(`${TEAM}/2026-03-14/IMG_3.CR2`, '2026-03-14'),
        row(`${TEAM}/wechat.jpg`, '2026-03-15', { dateFromExif: false }),
      ]);
      disk[TEAM] = [
        dirent('IMG_1.CR2'),
        dirent('IMG_1.CR2.xmp'),
        dirent('IMG_2.CR2'),
        dirent('wechat.jpg'),
        dirent('notes.txt'),
        dirent('2026-03-14', true),
      ];
      disk[`${TEAM}/2026-03-14`] = [dirent('IMG_3.CR2')];

      const result = await sut.preview(authStub.admin, dto());

      expect(result).toMatchObject({
        targetLibraryId: 'library-1',
        total: 4,
        moveCount: 2,
        renameCount: 0,
        inPlaceCount: 1,
        conflictCount: 0,
        skipCount: 1,
        sidecarCount: 1,
        newFolderCount: 1,
        otherFileCount: 1,
        emptyFolderCount: 0,
        staying: [{ action: 'skip', reason: 'unreliable-date', count: 1 }],
        libraries: [{ id: 'library-1', count: 4, isTarget: true, isExcluded: false }],
      });
      expect(result.folders).toEqual([
        {
          day: '2026-03-14',
          folder: '2026-03-14',
          label: '',
          existingLabels: [''],
          exists: true,
          moveCount: 1,
          renameCount: 0,
          inPlaceCount: 1,
        },
        {
          day: '2026-03-15',
          folder: '2026-03-15',
          label: '',
          existingLabels: [],
          exists: false,
          moveCount: 1,
          renameCount: 0,
          inPlaceCount: 0,
        },
      ]);
    });

    it('should only take the photos directly in the folder without subfolders', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`), row(`${TEAM}/phone/b.jpg`)]);

      await expect(sut.preview(authStub.admin, dto({ includeSubfolders: false }))).resolves.toMatchObject({ total: 1 });
    });

    it('should join the folder of the day that already has a label', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);
      disk[TEAM] = [dirent('a.jpg'), dirent('2026-03-15 match', true)];
      disk[`${TEAM}/2026-03-15 match`] = [];

      const result = await sut.preview(authStub.admin, dto());

      expect(result.folders).toEqual([
        expect.objectContaining({
          folder: '2026-03-15 match',
          label: 'match',
          existingLabels: ['match'],
          exists: true,
        }),
      ]);
      expect(result.newFolderCount).toBe(0);
    });

    it('should let the user drop the label of an existing folder', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);
      disk[TEAM] = [dirent('a.jpg'), dirent('2026-03-15 match', true)];
      disk[`${TEAM}/2026-03-15 match`] = [];

      const result = await sut.preview(authStub.admin, dto({ labels: { '2026-03-15': '' } }));

      expect(result.folders).toEqual([
        expect.objectContaining({ folder: '2026-03-15', label: '', existingLabels: ['match'], exists: false }),
      ]);
    });

    it('should look for existing day folders under the year with the year-day preset', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);
      disk[`${TEAM}/2026`] = [dirent('2026-03-15 match', true)];

      const result = await sut.preview(authStub.admin, dto({ preset: 'year-day' }));

      expect(result.folders[0]).toMatchObject({ folder: '2026/2026-03-15 match', label: 'match' });
    });

    it('should not label month folders', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);

      const result = await sut.preview(authStub.admin, dto({ preset: 'year-month', labels: { '2026-03-15': 'x' } }));

      expect(result.folders).toEqual([expect.objectContaining({ day: null, folder: '2026/03', label: '' })]);
    });

    it('should report a photo whose name is taken at the target', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);
      disk[`${TEAM}/2026-03-15`] = [dirent('a.jpg')];
      mocks.storage.stat.mockResolvedValueOnce({ size: 1 } as Stats).mockResolvedValueOnce({ size: 2 } as Stats);

      const result = await sut.preview(authStub.admin, dto());

      expect(result).toMatchObject({
        moveCount: 0,
        conflictCount: 1,
        staying: [{ action: 'conflict', reason: 'target-exists', count: 1 }],
      });
      expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
    });

    it('should rename it with auto rename', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);
      disk[`${TEAM}/2026-03-15`] = [dirent('a.jpg')];
      mocks.storage.stat.mockResolvedValueOnce({ size: 1 } as Stats).mockResolvedValueOnce({ size: 2 } as Stats);

      const result = await sut.preview(authStub.admin, dto({ autoRename: true }));

      expect(result).toMatchObject({ moveCount: 1, renameCount: 1, conflictCount: 0 });
    });

    it('should skip a photo whose copy is already at the target, even with auto rename', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);
      disk[`${TEAM}/2026-03-15`] = [dirent('a.jpg')];
      mocks.storage.stat.mockResolvedValue({ size: 1 } as Stats);
      mocks.crypto.hashFile.mockResolvedValue(Buffer.from('same'));

      const result = await sut.preview(authStub.admin, dto({ autoRename: true }));

      expect(result).toMatchObject({
        moveCount: 0,
        skipCount: 1,
        staying: [{ action: 'skip', reason: 'identical', count: 1 }],
      });
    });

    it('should count the subfolders that end up empty', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([
        row(`${TEAM}/phone/a.jpg`),
        row(`${TEAM}/camera/b.jpg`),
        row(`${TEAM}/camera/raw/c.CR2`),
      ]);
      disk[TEAM] = [dirent('phone', true), dirent('camera', true), dirent('old', true)];
      disk[`${TEAM}/phone`] = [dirent('a.jpg'), dirent('Thumbs.db')];
      disk[`${TEAM}/camera`] = [dirent('b.jpg'), dirent('raw', true)];
      disk[`${TEAM}/camera/raw`] = [dirent('c.CR2')];
      disk[`${TEAM}/old`] = [];

      const result = await sut.preview(authStub.admin, dto());

      // camera and camera/raw are emptied; phone keeps a file; old was empty before and is left alone
      expect(result).toMatchObject({ otherFileCount: 1, emptyFolderCount: 2 });
    });

    it('should record where the dates of older photos come from before planning', async () => {
      mocks.reorganize.getFolderAssets
        .mockResolvedValueOnce([row(`${TEAM}/a.jpg`, '2026-03-15', { dateFromExif: null })])
        .mockResolvedValueOnce([row(`${TEAM}/a.jpg`)]);
      mocks.assetJob.getForDateSource.mockResolvedValue([]);

      const result = await sut.preview(authStub.admin, dto());

      expect(mocks.assetJob.getForDateSource).toHaveBeenCalledWith([`${TEAM}/a.jpg`]);
      expect(result.moveCount).toBe(1);
    });

    describe('an album', () => {
      const album = dto({ sourceType: 'album', sourcePath: undefined, sourceAlbumId: 'album-1' });

      it('should require access to the album', async () => {
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
        mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());

        await expect(sut.preview(authStub.admin, album)).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.reorganize.getAlbumAssets).not.toHaveBeenCalled();
      });

      it('should count the photos per library and leave out the ones turned off', async () => {
        mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-1']));
        mocks.reorganize.getAlbumAssets.mockResolvedValue([
          row(`${ROOT}/a.jpg`),
          row('/external/family/b.jpg', '2026-03-15', { libraryId: 'library-2' }),
          row('/upload/c.jpg', '2026-03-15', { libraryId: null, libraryOwnerId: null }),
          row('/external/other/d.jpg', '2026-03-15', { ownerId: 'someone-else' }),
        ]);

        const result = await sut.preview(authStub.admin, { ...album, excludedLibraryIds: ['library-2'] });

        expect(result).toMatchObject({ total: 4, moveCount: 1, skipCount: 3, otherFileCount: 0, emptyFolderCount: 0 });
        expect(result.libraries).toEqual([
          { id: 'library-1', name: 'library-1', count: 2, isTarget: true, isExcluded: false },
          { id: 'library-2', name: 'library-2', count: 1, isTarget: false, isExcluded: true },
        ]);
        expect(result.staying.map((entry) => entry.reason).toSorted()).toEqual([
          'internal',
          'library-excluded',
          'not-owner',
        ]);
      });
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mocks.reorganize.getActive.mockResolvedValue(void 0);
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/a.jpg`)]);
      mocks.storage.checkFileExists.mockResolvedValue(true);
    });

    it('should refuse while another reorganization is running', async () => {
      mocks.reorganize.getActive.mockResolvedValue({ id: 'other' } as any);

      await expect(sut.create(authStub.admin, dto())).rejects.toThrow('Another reorganization');
      expect(mocks.reorganize.create).not.toHaveBeenCalled();
    });

    it('should refuse when nothing would move', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([row(`${TEAM}/2026-03-15/a.jpg`)]);

      await expect(sut.create(authStub.admin, dto())).rejects.toThrow('nothing to move');
      expect(mocks.reorganize.create).not.toHaveBeenCalled();
    });

    it('should refuse when a folder it has to change is not writable', async () => {
      mocks.storage.checkFileExists.mockImplementation((_path, mode) => Promise.resolve(mode === undefined));

      await expect(sut.create(authStub.admin, dto())).rejects.toThrow(`${TEAM} is not writable`);
      expect(mocks.reorganize.create).not.toHaveBeenCalled();
    });

    it('should store the plan and queue the run', async () => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([
        row(`${TEAM}/a.jpg`, '2026-03-15', { sidecarPath: `${TEAM}/a.jpg.xmp` }),
        row(`${TEAM}/2026-03-15/b.jpg`),
        row(`${TEAM}/c.jpg`, '2026-03-15', { dateFromExif: false }),
      ]);
      mocks.reorganize.create.mockResolvedValue({ id: 'reorganization-1' } as any);
      mocks.reorganize.getAll.mockResolvedValue([
        {
          id: 'reorganization-1',
          createdAt: new Date(),
          finishedAt: null,
          sourceType: 'folder',
          sourceName: TEAM,
          targetPath: TEAM,
          preset: 'day',
          autoRename: false,
          status: 'queued',
          isUndo: false,
          error: null,
          inPlaceCount: 1,
          removedFolders: [],
        } as any,
      ]);
      mocks.reorganize.getItemCounts.mockResolvedValue([
        { reorganizationId: 'reorganization-1', status: 'pending', reason: null, count: 1 },
        { reorganizationId: 'reorganization-1', status: 'stayed', reason: 'unreliable-date', count: 1 },
      ]);

      const result = await sut.create(authStub.admin, dto());

      expect(mocks.reorganize.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: USER,
          sourceType: 'folder',
          sourcePath: TEAM,
          sourceName: TEAM,
          targetPath: TEAM,
          status: 'queued',
          inPlaceCount: 1,
        }),
        [
          expect.objectContaining({
            status: 'pending',
            reason: null,
            fromPath: `${TEAM}/a.jpg`,
            toPath: `${TEAM}/2026-03-15/a.jpg`,
            toLibraryId: 'library-1',
            sidecarFromPath: `${TEAM}/a.jpg.xmp`,
            sidecarToPath: `${TEAM}/2026-03-15/a.jpg.xmp`,
          }),
          expect.objectContaining({ status: 'stayed', reason: 'unreliable-date', toPath: null, sidecarToPath: null }),
        ],
      );
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: 'Reorganize', data: { id: 'reorganization-1' } });
      expect(result).toMatchObject({ status: 'queued', pendingCount: 1, stayedCount: 1, inPlaceCount: 1 });
    });
  });

  describe('previewItems', () => {
    beforeEach(() => {
      mocks.reorganize.getFolderAssets.mockResolvedValue([
        row(`${TEAM}/a.jpg`, '2026-03-15', { sidecarPath: `${TEAM}/a.jpg.xmp` }),
        row(`${TEAM}/b.jpg`, '2026-03-14'),
        row(`${TEAM}/c.jpg`, '2026-03-14', { isOffline: true, deletedAt: new Date() }),
      ]);
    });

    it('should list the photos of one date folder', async () => {
      const result = await sut.previewItems(authStub.admin, { ...dto(), folder: '2026-03-15', limit: 200 });

      expect(result).toEqual({
        total: 1,
        items: [
          {
            assetId: `${TEAM}/a.jpg`,
            action: 'move',
            reason: null,
            fromPath: `${TEAM}/a.jpg`,
            toPath: `${TEAM}/2026-03-15/a.jpg`,
            isRenamed: false,
            hasSidecar: true,
          },
        ],
      });
    });

    it('should list the photos that stay for one reason', async () => {
      const result = await sut.previewItems(authStub.admin, { ...dto(), reason: 'offline', limit: 200 });

      expect(result.items).toEqual([expect.objectContaining({ action: 'skip', reason: 'offline', toPath: null })]);
    });

    it('should cap the list and still say how many there are', async () => {
      const result = await sut.previewItems(authStub.admin, { ...dto(), limit: 1 });

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(1);
    });
  });
});
