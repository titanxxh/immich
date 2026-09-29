import { Kysely } from 'kysely';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AssetVisibility, SystemMetadataKey, UserMetadataKey } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FootprintRepository } from 'src/repositories/footprint.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { FootprintService } from 'src/services/footprint.service';
import { newMediumService } from 'test/medium.factory';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

const square = (minX: number, minY: number, maxX: number, maxY: number) => [
  [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ],
];

// two prefectures side by side, and a country around them reaching further out to sea
const west = { latitude: 30.5, longitude: 120.5 };
const east = { latitude: 30.5, longitude: 121.5 };
const nearCoast = { latitude: 30.5, longitude: 122.05 };
const farAtSea = { latitude: 30.5, longitude: 122.8 };

const regions = [
  { id: 'cn', level: 'country', countryId: 'cn', provinceId: null, countryCode: 'CN', name: 'China', nameZh: '中国' },
  {
    id: 'zj',
    level: 'province',
    countryId: 'cn',
    provinceId: null,
    countryCode: 'CN',
    name: 'Zhejiang',
    nameZh: '浙江省',
  },
  {
    id: 'hz',
    level: 'region',
    countryId: 'cn',
    provinceId: 'zj',
    countryCode: 'CN',
    name: 'Hangzhou',
    nameZh: '杭州市',
  },
  { id: 'nb', level: 'region', countryId: 'cn', provinceId: 'zj', countryCode: 'CN', name: 'Ningbo', nameZh: '宁波市' },
].map((region) => ({ ...region, center: [120.5, 30.5] }));

const writeFiles = (version: string) => {
  const folder = mkdtempSync(join(tmpdir(), 'footprints-'));
  const gz = (name: string, data: unknown) => writeFileSync(join(folder, name), gzipSync(JSON.stringify(data)));
  writeFileSync(join(folder, 'footprint-version.txt'), `${version}\n`);
  gz('footprint-regions.json.gz', regions);
  gz('footprint-leaves.geojson.gz', {
    type: 'FeatureCollection',
    features: [
      {
        properties: { regionId: 'hz', provinceId: 'zj', countryId: 'cn' },
        geometry: { type: 'Polygon', coordinates: square(120, 30, 121, 31) },
      },
      {
        properties: { regionId: 'nb', provinceId: 'zj', countryId: 'cn' },
        geometry: { type: 'Polygon', coordinates: square(121, 30, 122, 31) },
      },
    ],
  });
  gz('footprint-countries.geojson.gz', {
    type: 'FeatureCollection',
    features: [
      {
        properties: { countryId: 'cn', provinceId: null },
        geometry: { type: 'Polygon', coordinates: square(119, 29, 123, 32) },
      },
    ],
  });
  gz('footprint-display.geojson.gz', {
    type: 'FeatureCollection',
    features: ['hz', 'nb'].map((id, index) => ({
      type: 'Feature',
      properties: { id },
      geometry: { type: 'Polygon', coordinates: square(120 + index, 30, 121 + index, 31) },
    })),
  });
  return {
    versionFile: join(folder, 'footprint-version.txt'),
    regions: join(folder, 'footprint-regions.json.gz'),
    leaves: join(folder, 'footprint-leaves.geojson.gz'),
    countries: join(folder, 'footprint-countries.geojson.gz'),
    display: join(folder, 'footprint-display.geojson.gz'),
  };
};

const setup = async (db?: Kysely<DB>, version = 'test-1') => {
  const result = newMediumService(FootprintService, {
    database: db || (await getKyselyDB()),
    real: [AssetRepository, DatabaseRepository, FootprintRepository, SystemMetadataRepository, UserRepository],
    mock: [ConfigRepository, JobRepository, LoggingRepository, StorageRepository],
  });
  const env = mockEnvData({});
  const footprints = writeFiles(version);
  result.ctx.getMock(ConfigRepository).getEnv.mockReturnValue({
    ...env,
    resourcePaths: { ...env.resourcePaths, footprints },
  });
  result.ctx.getMock(StorageRepository).checkFileExists.mockResolvedValue(true);
  result.ctx.getMock(JobRepository).queue.mockResolvedValue();
  return result;
};

type Context = Awaited<ReturnType<typeof setup>>['ctx'];

const newPhoto = async (
  ctx: Context,
  ownerId: string,
  location: { latitude: number; longitude: number } | null,
  { make = 'Canon', localDateTime = '2025-05-01T08:00:00Z', visibility = AssetVisibility.Timeline } = {},
) => {
  const date = new Date(localDateTime);
  const { asset } = await ctx.newAsset({ ownerId, localDateTime: date, fileCreatedAt: date, visibility });
  await ctx.newExif({
    assetId: asset.id,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    make: make || null,
  });
  return asset.id;
};

const getAssetRegions = async (ctx: Context) => {
  const rows = await ctx.database
    .selectFrom('asset_region')
    .select(['assetId', 'countryId', 'provinceId', 'regionId', 'version'])
    .execute();
  return Object.fromEntries(rows.map(({ assetId, ...row }) => [assetId, row]));
};

const moveTo = (ctx: Context, assetId: string, location: { latitude: number | null; longitude: number | null }) =>
  ctx.database.updateTable('asset_exif').set(location).where('assetId', '=', assetId).execute();

describe(FootprintService.name, () => {
  describe('onBootstrap', () => {
    it('should import the regions and queue an assignment', async () => {
      const { sut, ctx } = await setup();

      await sut.onBootstrap();

      const rows = await ctx.database.selectFrom('region').selectAll().orderBy('id').execute();
      expect(rows.map(({ id, nameZh }) => [id, nameZh])).toEqual([
        ['cn', '中国'],
        ['hz', '杭州市'],
        ['nb', '宁波市'],
        ['zj', '浙江省'],
      ]);
      expect(rows[0]).toMatchObject({ latitude: 30.5, longitude: 120.5 });
      await expect(ctx.get(SystemMetadataRepository).get(SystemMetadataKey.FootprintRegionsState)).resolves.toEqual({
        version: 'test-1',
      });
      expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledWith({ name: 'FootprintAssign' });
    });

    it('should not import the same version twice', async () => {
      const { sut, ctx } = await setup();
      await sut.onBootstrap();
      await ctx.database.deleteFrom('region').where('id', '=', 'nb').execute();

      await sut.onBootstrap();

      await expect(ctx.database.selectFrom('region').select('id').execute()).resolves.toHaveLength(3);
    });

    it('should do nothing without the region files', async () => {
      const { sut, ctx } = await setup();
      ctx.getMock(StorageRepository).checkFileExists.mockResolvedValue(false);

      await sut.onBootstrap();

      await expect(ctx.database.selectFrom('region').select('id').execute()).resolves.toEqual([]);
      expect(ctx.getMock(JobRepository).queue).not.toHaveBeenCalled();
    });
  });

  describe('handleAssign', () => {
    it('should find the regions of located photos', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      const inWest = await newPhoto(ctx, user.id, west);
      const inEast = await newPhoto(ctx, user.id, east);
      const offCoast = await newPhoto(ctx, user.id, nearCoast);
      const atSea = await newPhoto(ctx, user.id, farAtSea);
      const unlocated = await newPhoto(ctx, user.id, null);

      await sut.handleAssign();

      const assigned = await getAssetRegions(ctx);
      expect(assigned).toEqual({
        [inWest]: { countryId: 'cn', provinceId: 'zj', regionId: 'hz', version: 'test-1' },
        [inEast]: { countryId: 'cn', provinceId: 'zj', regionId: 'nb', version: 'test-1' },
        [offCoast]: { countryId: 'cn', provinceId: 'zj', regionId: 'nb', version: 'test-1' },
        [atSea]: { countryId: 'cn', provinceId: null, regionId: null, version: 'test-1' },
      });
      expect(assigned[unlocated]).toBeUndefined();
    });

    it('should only assign photos again once their location changes', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      const moved = await newPhoto(ctx, user.id, west);
      const kept = await newPhoto(ctx, user.id, west);
      await sut.handleAssign();
      const spy = vitest.spyOn(ctx.get(FootprintRepository), 'upsertAssetRegions');

      await moveTo(ctx, moved, east);
      await sut.handleAssign();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].map(({ assetId }) => assetId)).toEqual([moved]);
      const assigned = await getAssetRegions(ctx);
      expect(assigned[moved].regionId).toBe('nb');
      expect(assigned[kept].regionId).toBe('hz');
    });

    it('should not read the region files when nothing changed', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      await newPhoto(ctx, user.id, west);
      await sut.handleAssign();
      const spy = vitest.spyOn(ctx.get(FootprintRepository), 'readJson');

      await sut.handleAssign();

      expect(spy).not.toHaveBeenCalled();
    });

    it('should forget the regions of photos whose location was removed', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      const cleared = await newPhoto(ctx, user.id, west);
      const kept = await newPhoto(ctx, user.id, east);
      await sut.handleAssign();

      await moveTo(ctx, cleared, { latitude: null, longitude: null });
      await sut.handleAssign();

      await expect(getAssetRegions(ctx)).resolves.toEqual({
        [kept]: { countryId: 'cn', provinceId: 'zj', regionId: 'nb', version: 'test-1' },
      });
    });

    it('should assign every photo again when the region files change', async () => {
      const database = await getKyselyDB();
      const { sut, ctx } = await setup(database);
      const { user } = await ctx.newUser();
      const photo = await newPhoto(ctx, user.id, west);
      await sut.handleAssign();

      const { sut: updated } = await setup(database, 'test-2');
      await updated.handleAssign();

      const assigned = await getAssetRegions(ctx);
      expect(assigned[photo]).toEqual({ countryId: 'cn', provinceId: 'zj', regionId: 'hz', version: 'test-2' });
    });
  });

  describe('getAll', () => {
    it('should list the regions of camera photos with their visits', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      await sut.onBootstrap();
      await newPhoto(ctx, user.id, west, { localDateTime: '2024-03-01T23:30:00Z' });
      await newPhoto(ctx, user.id, west, { localDateTime: '2024-03-02T08:00:00Z' });
      await newPhoto(ctx, user.id, west, {
        localDateTime: '2024-03-02T09:00:00Z',
        visibility: AssetVisibility.Archive,
      });
      await newPhoto(ctx, user.id, east, { localDateTime: '2025-06-01T10:00:00Z' });
      // not counted: forwarded (no camera make), hidden, locked, trashed, or someone else's
      await newPhoto(ctx, user.id, west, { make: '', localDateTime: '2020-01-01T00:00:00Z' });
      await newPhoto(ctx, user.id, west, { localDateTime: '2020-01-01T00:00:00Z', visibility: AssetVisibility.Hidden });
      await newPhoto(ctx, user.id, west, { localDateTime: '2020-01-01T00:00:00Z', visibility: AssetVisibility.Locked });
      const trashed = await newPhoto(ctx, user.id, west, { localDateTime: '2020-01-01T00:00:00Z' });
      await ctx.database.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', trashed).execute();
      const { user: other } = await ctx.newUser();
      await newPhoto(ctx, other.id, west, { localDateTime: '2020-01-01T00:00:00Z' });

      await expect(sut.getAll(auth)).resolves.toMatchObject({ pendingCount: 4, regions: [] });
      await sut.handleAssign();
      const { regions, pendingCount } = await sut.getAll(auth);

      expect(pendingCount).toBe(0);
      expect(regions).toEqual([
        {
          id: 'hz',
          name: 'Hangzhou',
          nameZh: '杭州市',
          province: { id: 'zj', name: 'Zhejiang', nameZh: '浙江省' },
          country: { id: 'cn', name: 'China', nameZh: '中国', code: 'CN' },
          latitude: 30.5,
          longitude: 120.5,
          firstVisitAt: new Date('2024-03-01T23:30:00Z'),
          lastVisitAt: new Date('2024-03-02T09:00:00Z'),
          assetCount: 3,
          dayCount: 2,
          hidden: false,
        },
        expect.objectContaining({
          id: 'nb',
          assetCount: 1,
          dayCount: 1,
          firstVisitAt: new Date('2025-06-01T10:00:00Z'),
        }),
      ]);
    });

    it('should flag hidden regions', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      await sut.onBootstrap();
      await newPhoto(ctx, user.id, west);
      await newPhoto(ctx, user.id, east);
      await sut.handleAssign();
      await ctx.get(UserRepository).upsertMetadata(user.id, {
        key: UserMetadataKey.Preferences,
        value: { footprints: { hiddenRegionIds: ['nb'] } },
      });

      const { regions } = await sut.getAll(factory.auth({ user }));

      expect(regions.map(({ id, hidden }) => [id, hidden])).toEqual([
        ['hz', false],
        ['nb', true],
      ]);
    });
  });

  describe('getShapes', () => {
    it('should return the outlines of visited regions only', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      await sut.onBootstrap();
      await newPhoto(ctx, user.id, east);
      await sut.handleAssign();

      const { features } = await sut.getShapes(factory.auth({ user }));

      expect(features).toEqual([expect.objectContaining({ properties: { id: 'nb' } })]);
    });
  });

  describe('getRegion', () => {
    it('should return a region with photos spread over time', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      await sut.onBootstrap();
      const ids = [];
      for (let index = 0; index < 60; index++) {
        ids.push(await newPhoto(ctx, user.id, west, { localDateTime: `2024-01-01T08:00:00Z` }));
      }
      await sut.handleAssign();

      const { region, assetIds } = await sut.getRegion(factory.auth({ user }), 'hz');

      expect(region).toMatchObject({ id: 'hz', assetCount: 60 });
      expect(assetIds).toHaveLength(48);
      expect(ids).toEqual(expect.arrayContaining(assetIds));
    });

    it('should accept a province or country', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      await sut.onBootstrap();
      await newPhoto(ctx, user.id, west);
      await newPhoto(ctx, user.id, east);
      await sut.handleAssign();

      const { region, assetIds } = await sut.getRegion(factory.auth({ user }), 'zj');

      expect(region).toMatchObject({ id: 'zj', nameZh: '浙江省', assetCount: 2, province: { id: 'zj' } });
      expect(assetIds).toHaveLength(2);
    });

    it('should fail for a region without photos', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      await sut.onBootstrap();

      await expect(sut.getRegion(factory.auth({ user }), 'hz')).rejects.toThrow('No photos taken in this region');
    });
  });

  describe('timeline', () => {
    it('should filter time buckets by region, province or country', async () => {
      const { sut, ctx } = await setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      await newPhoto(ctx, user.id, west, { localDateTime: '2024-03-01T08:00:00Z' });
      await newPhoto(ctx, user.id, east, { localDateTime: '2024-04-01T08:00:00Z' });
      await newPhoto(ctx, user.id, null, { localDateTime: '2024-05-01T08:00:00Z' });
      await sut.handleAssign();
      const assets = ctx.get(AssetRepository);

      await expect(assets.getTimeBuckets({ userIds: [user.id], regionId: 'nb' }, auth)).resolves.toEqual([
        { timeBucket: '2024-04-01', count: 1 },
      ]);
      await expect(assets.getTimeBuckets({ userIds: [user.id], regionId: 'cn' }, auth)).resolves.toHaveLength(2);
      const bucket = await assets.getTimeBucket('2024-03-01', { userIds: [user.id], regionId: 'hz' }, auth);
      expect(JSON.parse(bucket.assets).id).toHaveLength(1);
    });
  });
});
