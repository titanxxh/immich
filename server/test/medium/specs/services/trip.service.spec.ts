import { Kysely } from 'kysely';
import { UserMetadataKey } from 'src/enum';
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
    real: [AlbumRepository, AssetRepository, DatabaseRepository, TripRepository, UserRepository],
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
});
