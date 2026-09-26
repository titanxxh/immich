import { Kysely } from 'kysely';
import { AssetOrder, TripSource, UserMetadataKey } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { TripRepository } from 'src/repositories/trip.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { TripService } from 'src/services/trip.service';
import { TripHome } from 'src/utils/trip';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const home: TripHome = { name: 'Home', latitude: 30, longitude: 120, radiusKm: 50 };
// ~110km north of home
const hangzhou = { latitude: 31, longitude: 120 };
// ~95km east of hangzhou
const suzhou = { latitude: 31, longitude: 121 };

const setup = (db?: Kysely<DB>) => {
  return newMediumService(TripService, {
    database: db || defaultDatabase,
    real: [AccessRepository, AlbumRepository, AssetRepository, DatabaseRepository, TripRepository, UserRepository],
    mock: [LoggingRepository],
  });
};

type Context = ReturnType<typeof setup>['ctx'];

const enableTrips = async (ctx: Context, userId: string, overrides: Record<string, unknown> = {}) => {
  await ctx.get(UserRepository).upsertMetadata(userId, {
    key: UserMetadataKey.Preferences,
    value: { trips: { enabled: true, homes: [home], minAssets: 3, ...overrides } },
  });
};

/** `count` photos at `location`, one every 12 hours from `start`. */
const newPhotos = async (
  ctx: Context,
  ownerId: string,
  start: string,
  count: number,
  location: { latitude: number; longitude: number },
) => {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const localDateTime = new Date(new Date(`${start}Z`).getTime() + index * 12 * 3_600_000);
    const { asset } = await ctx.newAsset({ ownerId, localDateTime, fileCreatedAt: localDateTime });
    await ctx.newExif({ assetId: asset.id, ...location, make: 'Canon' });
    ids.push(asset.id);
  }
  return ids;
};

const newAlbum = async (ctx: Context, ownerId: string, assetIds: string[]) => {
  const { album } = await ctx.newAlbum({ ownerId, albumName: 'My trip' }, assetIds);
  return album;
};

const getTrips = (ctx: Context, ownerId: string) => ctx.get(TripRepository).getByOwnerId(ownerId);

const getAlbumAssetIds = async (ctx: Context, albumId: string) => {
  const rows = await ctx.database.selectFrom('album_asset').select('assetId').where('albumId', '=', albumId).execute();
  return rows.map(({ assetId }) => assetId).toSorted();
};

describe(TripService.name, () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
    await defaultDatabase
      .insertInto('geodata_places')
      .values(
        [
          {
            name: 'Home',
            admin2Name: 'Home Shi',
            alternateNames: 'Home',
            latitude: home.latitude,
            longitude: home.longitude,
          },
          { name: 'Hangzhou', admin2Name: 'Hangzhou Shi', alternateNames: 'Hangzhou,杭州,杭州市', ...hangzhou },
          { name: 'Suzhou', admin2Name: 'Suzhou Shi', alternateNames: 'Suzhou,苏州', ...suzhou },
        ].map(({ name, admin2Name, alternateNames, latitude, longitude }, index) => ({
          id: 900_000_000 + index,
          name,
          admin1Name: 'Zhejiang',
          admin2Name,
          alternateNames,
          countryCode: 'CN',
          latitude,
          longitude,
          modificationDate: new Date().toISOString(),
        })),
      )
      .execute();
  });

  describe('handleTripDetection', () => {
    it('should do nothing while trips are disabled', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);

      await sut.handleTripDetection({ userId: user.id });

      await expect(getTrips(ctx, user.id)).resolves.toEqual([]);
    });

    it('should create an album for a trip', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      const photoIds = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await newPhotos(ctx, user.id, '2025-05-10T08:00:00', 4, { latitude: home.latitude, longitude: home.longitude });

      await sut.handleTripDetection({ userId: user.id });

      const [trip, ...others] = await getTrips(ctx, user.id);
      expect(others).toEqual([]);
      expect(trip).toEqual(expect.objectContaining({ albumName: '2025-05-01 杭州', generatedName: '2025-05-01 杭州' }));
      await expect(getAlbumAssetIds(ctx, trip.albumId!)).resolves.toEqual(photoIds.toSorted());
    });

    it('should not recreate a trip when run again', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);

      await sut.handleTripDetection({ userId: user.id });
      await sut.handleTripDetection({ userId: user.id });

      await expect(getTrips(ctx, user.id)).resolves.toHaveLength(1);
    });

    it('should add new photos but not the ones the user removed', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      const [removedId, ...keptIds] = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [trip] = await getTrips(ctx, user.id);
      await ctx.get(AlbumRepository).removeAssetIds(trip.albumId!, [removedId]);

      // e.g. photos imported from the camera after the trip
      const lateIds = await newPhotos(ctx, user.id, '2025-05-02T20:00:00', 2, hangzhou);
      await sut.handleTripDetection({ userId: user.id });

      await expect(getAlbumAssetIds(ctx, trip.albumId!)).resolves.toEqual([...keptIds, ...lateIds].toSorted());
      const [updated] = await getTrips(ctx, user.id);
      expect(updated.endAt).toEqual(new Date('2025-05-03T08:00:00Z'));
    });

    it('should rename the album when the trip reaches another city', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });

      await newPhotos(ctx, user.id, '2025-05-03T08:00:00', 4, suzhou);
      await sut.handleTripDetection({ userId: user.id });

      const [trip] = await getTrips(ctx, user.id);
      expect(trip).toEqual(expect.objectContaining({ albumName: '2025-05-01 杭州·苏州' }));
    });

    it('should keep the name the user gave the album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [trip] = await getTrips(ctx, user.id);
      await ctx.get(AlbumRepository).update(trip.albumId!, { albumName: 'Spring break' }, user.id);

      await newPhotos(ctx, user.id, '2025-05-03T08:00:00', 4, suzhou);
      await sut.handleTripDetection({ userId: user.id });

      await expect(getTrips(ctx, user.id)).resolves.toEqual([
        expect.objectContaining({ albumName: 'Spring break', generatedName: '2025-05-01 杭州' }),
      ]);
    });

    it('should not recreate a trip whose album the user deleted', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [trip] = await getTrips(ctx, user.id);
      await ctx.get(AlbumRepository).delete(trip.albumId!);

      await newPhotos(ctx, user.id, '2025-05-03T08:00:00', 2, hangzhou);
      await sut.handleTripDetection({ userId: user.id });

      await expect(getTrips(ctx, user.id)).resolves.toEqual([
        expect.objectContaining({ id: trip.id, albumId: null, endAt: new Date('2025-05-03T20:00:00Z') }),
      ]);
    });
  });

  describe('preview', () => {
    it('should list the trips for the given settings without creating albums', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await newPhotos(ctx, user.id, '2025-06-01T08:00:00', 2, suzhou);

      const trips = await sut.preview(factory.auth({ user }), { homes: [home], minAssets: 3, includeDayTrips: false });

      expect(trips).toEqual([
        {
          name: '2025-05-01 杭州',
          startAt: new Date('2025-05-01T08:00:00Z'),
          endAt: new Date('2025-05-02T20:00:00Z'),
          days: 2,
          assetCount: 4,
        },
      ]);
      await expect(getTrips(ctx, user.id)).resolves.toEqual([]);
    });

    it('should find nothing without a home', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);

      await expect(
        sut.preview(factory.auth({ user }), { homes: [], minAssets: 3, includeDayTrips: false }),
      ).resolves.toEqual([]);
    });
  });

  describe('trip list and summary', () => {
    it('should list trips with their summary and set the cover and order', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      const photoIds = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });

      const trips = await sut.getAll(factory.auth({ user }), {});

      expect(trips).toEqual([
        expect.objectContaining({
          source: TripSource.Auto,
          name: '2025-05-01 杭州',
          dayCount: 2,
          assetCount: 4,
          point: { latitude: hangzhou.latitude, longitude: hangzhou.longitude },
          // every photo is its own stop, 12 hours apart, so the first stop wins and its only photo is the cover
          thumbnailAssetId: photoIds[0],
        }),
      ]);
      const album = await ctx.get(AlbumRepository).getById(trips[0].albumId, { withAssets: false });
      expect(album?.order).toBe(AssetOrder.Asc);
    });

    it('should keep a cover the user picked', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      const photoIds = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [trip] = await getTrips(ctx, user.id);
      await ctx.get(AlbumRepository).update(trip.albumId!, { albumThumbnailAssetId: photoIds[3] }, user.id);

      await sut.handleTripDetection({ userId: user.id });

      const [updated] = await getTrips(ctx, user.id);
      expect(updated.albumThumbnailAssetId).toBe(photoIds[3]);
    });

    it('should filter by album and leave out dismissed trips', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      await enableTrips(ctx, user.id);
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await newPhotos(ctx, user.id, '2025-06-01T08:00:00', 4, suzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [first, second] = await sut.getAll(auth, {});

      await sut.remove(auth, first.id);

      await expect(sut.getAll(auth, {})).resolves.toEqual([expect.objectContaining({ id: second.id })]);
      await expect(sut.getAll(auth, { albumId: first.albumId })).resolves.toEqual([]);
    });
  });

  describe('get', () => {
    it('should describe the days, stops and legs of a trip', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      await enableTrips(ctx, user.id);
      const photoIds = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 2, hangzhou);
      await newPhotos(ctx, user.id, '2025-05-02T08:00:00', 2, suzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [trip] = await sut.getAll(auth, {});

      const detail = await sut.get(auth, trip.id);

      expect(detail.places).toEqual(['杭州', '苏州']);
      expect(detail.farthestKm).toBeGreaterThan(100);
      expect(detail.days).toEqual([
        { index: 1, date: '2025-05-01', place: '杭州', assetCount: 2, firstAssetId: photoIds[0], stops: [0, 1] },
        expect.objectContaining({ index: 2, date: '2025-05-02', place: '苏州', assetCount: 2, stops: [2, 3] }),
      ]);
      expect(detail.stops).toHaveLength(4);
      expect(detail.legs).toHaveLength(3);
    });

    it('should not show the trip of another user', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      await enableTrips(ctx, user.id);
      await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [trip] = await getTrips(ctx, user.id);

      await expect(sut.get(factory.auth({ user: other }), trip.id)).rejects.toThrow('Trip not found');
    });
  });

  describe('create', () => {
    it('should mark an album as a manual trip that detection leaves alone', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      await enableTrips(ctx, user.id);
      const photoIds = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      const album = await newAlbum(ctx, user.id, photoIds.slice(0, 2));

      const trip = await sut.create(auth, { albumId: album.id });
      await newPhotos(ctx, user.id, '2025-05-01T09:00:00', 2, hangzhou);
      await sut.handleTripDetection({ userId: user.id });

      expect(trip).toEqual(expect.objectContaining({ source: TripSource.Manual, name: 'My trip', assetCount: 2 }));
      // no photos added, and no detected trip created over the same days
      await expect(getAlbumAssetIds(ctx, album.id)).resolves.toEqual(photoIds.slice(0, 2).toSorted());
      await expect(sut.getAll(auth, {})).resolves.toEqual([expect.objectContaining({ id: trip.id })]);
    });

    it('should refuse to overlap a detected trip unless asked to replace it', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      await enableTrips(ctx, user.id);
      const photoIds = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 4, hangzhou);
      await sut.handleTripDetection({ userId: user.id });
      const [detected] = await sut.getAll(auth, {});
      const album = await newAlbum(ctx, user.id, photoIds);

      await expect(sut.create(auth, { albumId: album.id })).rejects.toThrow('Album overlaps other trips');
      const manual = await sut.create(auth, { albumId: album.id, replaceTripIds: [detected.id] });

      await expect(sut.getAll(auth, {})).resolves.toEqual([expect.objectContaining({ id: manual.id })]);
      // the replaced trip keeps its album as an ordinary album
      await expect(ctx.get(AlbumRepository).getById(detected.albumId, { withAssets: false })).resolves.toBeDefined();
    });

    it('should not mark an album twice', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const [photoId] = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 1, hangzhou);
      const album = await newAlbum(ctx, user.id, [photoId]);
      await sut.create(auth, { albumId: album.id });

      await expect(sut.create(auth, { albumId: album.id })).rejects.toThrow('Album is already a trip');
    });

    it('should forget a manual trip when it is unmarked', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const [photoId] = await newPhotos(ctx, user.id, '2025-05-01T08:00:00', 1, hangzhou);
      const album = await newAlbum(ctx, user.id, [photoId]);
      const trip = await sut.create(auth, { albumId: album.id });

      await sut.remove(auth, trip.id);

      await expect(getTrips(ctx, user.id)).resolves.toEqual([]);
    });
  });
});
