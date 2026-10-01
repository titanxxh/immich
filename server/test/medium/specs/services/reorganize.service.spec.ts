import { Kysely } from 'kysely';
import { AssetFileType, AssetVisibility } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LibraryRepository } from 'src/repositories/library.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ReorganizeRepository } from 'src/repositories/reorganize.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { DB } from 'src/schema';
import { ReorganizeService } from 'src/services/reorganize.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(ReorganizeService, {
    database: db || defaultDatabase,
    real: [AccessRepository, AssetRepository, AssetJobRepository, LibraryRepository, ReorganizeRepository],
    mock: [LoggingRepository, StorageRepository],
  });
};

type Context = ReturnType<typeof setup>['ctx'];

const newLibrary = async (ctx: Context, ownerId: string, importPath: string) => {
  const library = await ctx.database
    .insertInto('library')
    .values({ ownerId, name: importPath, importPaths: [importPath], exclusionPatterns: [] })
    .returningAll()
    .executeTakeFirstOrThrow();
  return library.id;
};

const newPhoto = async (
  ctx: Context,
  dto: { ownerId: string; libraryId: string; path: string; day?: string; dateFromExif?: boolean },
) => {
  const localDateTime = new Date(`${dto.day ?? '2026-03-15'}T10:00:00Z`);
  const { asset } = await ctx.newAsset({
    ownerId: dto.ownerId,
    libraryId: dto.libraryId,
    isExternal: true,
    originalPath: dto.path,
    localDateTime,
    fileCreatedAt: localDateTime,
  });
  await ctx.get(AssetRepository).upsertJobStatus({ assetId: asset.id, dateFromExif: dto.dateFromExif ?? true });
  return asset.id;
};

describe(ReorganizeService.name, () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
  });

  describe('previewItems', () => {
    it('should plan the photos under the folder, with their sidecars and without the folders next to it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const root = `/external/${user.id}`;
      const libraryId = await newLibrary(ctx, user.id, root);
      ctx.getMock(StorageRepository).readdir.mockRejectedValue(new Error('ENOENT'));
      ctx.getMock(StorageRepository).readdirWithTypes.mockRejectedValue(new Error('ENOENT'));

      const a = await newPhoto(ctx, { ownerId: user.id, libraryId, path: `${root}/team/a.CR2` });
      await ctx.newAssetFile({ assetId: a, type: AssetFileType.Sidecar, path: `${root}/team/a.CR2.xmp` });
      const b = await newPhoto(ctx, {
        ownerId: user.id,
        libraryId,
        path: `${root}/team/phone/b.jpg`,
        day: '2026-03-14',
      });
      await newPhoto(ctx, { ownerId: user.id, libraryId, path: `${root}/team2/c.jpg` });
      await newPhoto(ctx, { ownerId: user.id, libraryId, path: `${root}/team_%/d.jpg` });

      const result = await sut.previewItems(auth, {
        sourceType: 'folder',
        sourcePath: `${root}/team`,
        includeSubfolders: true,
        targetPath: `${root}/team`,
        preset: 'day',
        labels: {},
        autoRename: false,
        excludedLibraryIds: [],
        limit: 200,
      });

      expect(result.items).toEqual([
        {
          assetId: a,
          action: 'move',
          reason: null,
          fromPath: `${root}/team/a.CR2`,
          toPath: `${root}/team/2026-03-15/a.CR2`,
          isRenamed: false,
          hasSidecar: true,
        },
        {
          assetId: b,
          action: 'move',
          reason: null,
          fromPath: `${root}/team/phone/b.jpg`,
          toPath: `${root}/team/2026-03-14/b.jpg`,
          isRenamed: false,
          hasSidecar: false,
        },
      ]);
    });

    it('should explain the photos it leaves out, and plan the video of a live photo with its photo', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const auth = factory.auth({ user });
      const root = `/external/${user.id}`;
      const libraryId = await newLibrary(ctx, user.id, root);
      const otherLibraryId = await newLibrary(ctx, other.id, `${root}/shared`);
      ctx.getMock(StorageRepository).readdir.mockRejectedValue(new Error('ENOENT'));
      ctx.getMock(StorageRepository).readdirWithTypes.mockRejectedValue(new Error('ENOENT'));

      const undated = await newPhoto(ctx, {
        ownerId: user.id,
        libraryId,
        path: `${root}/in/wechat.jpg`,
        dateFromExif: false,
      });
      const foreign = await newPhoto(ctx, {
        ownerId: other.id,
        libraryId: otherLibraryId,
        path: `${root}/in/theirs.jpg`,
      });
      const video = await newPhoto(ctx, { ownerId: user.id, libraryId, path: `${root}/in/live.MOV` });
      const live = await newPhoto(ctx, { ownerId: user.id, libraryId, path: `${root}/in/live.HEIC` });
      await ctx.database
        .updateTable('asset')
        .set({ visibility: AssetVisibility.Hidden })
        .where('id', '=', video)
        .execute();
      await ctx.database.updateTable('asset').set({ livePhotoVideoId: video }).where('id', '=', live).execute();

      const result = await sut.previewItems(auth, {
        sourceType: 'folder',
        sourcePath: `${root}/in`,
        includeSubfolders: true,
        targetPath: `${root}/out`,
        preset: 'year-month',
        labels: {},
        autoRename: false,
        excludedLibraryIds: [],
        limit: 200,
      });

      expect(result.items.map((item) => [item.assetId, item.action, item.reason, item.toPath])).toEqual([
        [live, 'move', null, `${root}/out/2026/03/live.HEIC`],
        [foreign, 'skip', 'not-owner', null],
        [undated, 'skip', 'unreliable-date', null],
      ]);
    });

    it('should plan the photos of an album across libraries', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const root = `/external/${user.id}`;
      const libraryId = await newLibrary(ctx, user.id, `${root}/mine`);
      const familyLibraryId = await newLibrary(ctx, user.id, `${root}/family`);
      ctx.getMock(StorageRepository).readdir.mockRejectedValue(new Error('ENOENT'));
      ctx.getMock(StorageRepository).readdirWithTypes.mockRejectedValue(new Error('ENOENT'));

      const a = await newPhoto(ctx, { ownerId: user.id, libraryId, path: `${root}/mine/a.jpg` });
      const b = await newPhoto(ctx, { ownerId: user.id, libraryId: familyLibraryId, path: `${root}/family/b.jpg` });
      await newPhoto(ctx, { ownerId: user.id, libraryId, path: `${root}/mine/not-in-album.jpg` });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [a, b]);

      const result = await sut.preview(auth, {
        sourceType: 'album',
        sourceAlbumId: album.id,
        includeSubfolders: true,
        targetPath: `${root}/mine/trip`,
        preset: 'day',
        labels: {},
        autoRename: false,
        excludedLibraryIds: [],
      });

      expect(result).toMatchObject({ targetLibraryId: libraryId, total: 2, moveCount: 2 });
      expect(
        Object.fromEntries(result.libraries.map((library) => [library.id, [library.count, library.isTarget]])),
      ).toEqual({ [libraryId]: [1, true], [familyLibraryId]: [1, false] });
    });
  });
});
