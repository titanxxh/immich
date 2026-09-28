import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LocateRepository } from 'src/repositories/locate.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { LocateService } from 'src/services/locate.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(LocateService, {
    database: db || defaultDatabase,
    real: [AccessRepository, AssetRepository, LocateRepository],
    mock: [LoggingRepository],
  });
};

type Context = ReturnType<typeof setup>['ctx'];

const newPhoto = async (
  ctx: Context,
  ownerId: string,
  time: string,
  options: { location?: { latitude: number; longitude: number }; make?: string | null; path?: string } = {},
) => {
  const localDateTime = new Date(`${time}Z`);
  const { asset } = await ctx.newAsset({
    ownerId,
    localDateTime,
    fileCreatedAt: localDateTime,
    ...(options.path && { originalPath: options.path }),
  });
  await ctx.newExif({
    assetId: asset.id,
    make: options.make === undefined ? 'Canon' : options.make,
    ...options.location,
  });
  return asset.id;
};

describe(LocateService.name, () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
  });

  describe('getGroups', () => {
    it('should group camera photos without a location, largest group first', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const small = [];
      for (const minute of ['00', '10', '20']) {
        small.push(await newPhoto(ctx, user.id, `2025-05-01T09:${minute}:00`));
      }
      const large = [];
      for (const minute of ['00', '10', '20', '30']) {
        large.push(await newPhoto(ctx, user.id, `2025-06-01T09:${minute}:00`));
      }
      const scattered = await newPhoto(ctx, user.id, '2025-07-01T09:00:00');
      // not offered: located, not from a camera, or someone else's
      await newPhoto(ctx, user.id, '2025-05-01T09:05:00', { location: { latitude: 31, longitude: 121 } });
      await newPhoto(ctx, user.id, '2025-05-01T09:06:00', { make: null });
      const { user: other } = await ctx.newUser();
      await newPhoto(ctx, other.id, '2025-05-01T09:07:00');

      const result = await sut.getGroups(factory.auth({ user }));

      expect(result.groups.map((group) => group.assetIds)).toEqual([large, small]);
      expect(result.scattered).toEqual([scattered]);
    });

    it('should leave out ignored photos', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const ids = [];
      for (const minute of ['00', '10', '20']) {
        ids.push(await newPhoto(ctx, user.id, `2025-05-01T09:${minute}:00`));
      }

      await sut.ignore(auth, { assetIds: [ids[0]] });

      await expect(sut.getGroups(auth)).resolves.toEqual({ groups: [], scattered: ids.slice(1) });
    });

    it('should not ignore photos of another user', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const id = await newPhoto(ctx, other.id, '2025-05-01T09:00:00');

      await expect(sut.ignore(factory.auth({ user }), { assetIds: [id] })).rejects.toThrow();
    });
  });

  describe('getSuggestion', () => {
    it('should suggest where located photos of the same folder were taken', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const folder = `/photos/${factory.uuid()}`;
      const id = await newPhoto(ctx, user.id, '2025-05-01T09:00:00', { path: `${folder}/a.jpg` });
      await newPhoto(ctx, user.id, '2020-01-01T09:00:00', {
        path: `${folder}/b.jpg`,
        location: { latitude: 31.2, longitude: 121.5 },
      });

      const { suggestion } = await sut.getSuggestion(factory.auth({ user }), { assetIds: [id] });

      expect(suggestion).toEqual({ latitude: 31.2, longitude: 121.5, source: 'directory' });
    });

    it('should fall back to the located photo nearest in time', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const id = await newPhoto(ctx, user.id, '2025-05-01T09:00:00', { path: `/photos/${factory.uuid()}/a.jpg` });
      await newPhoto(ctx, user.id, '2025-05-02T09:00:00', { location: { latitude: 30, longitude: 120 } });
      await newPhoto(ctx, user.id, '2025-05-03T09:00:00', { location: { latitude: 40, longitude: 116 } });
      await newPhoto(ctx, user.id, '2025-06-01T09:00:00', { location: { latitude: 22, longitude: 114 } });

      const { suggestion } = await sut.getSuggestion(factory.auth({ user }), { assetIds: [id] });

      expect(suggestion).toEqual({ latitude: 30, longitude: 120, source: 'time' });
    });

    it('should suggest nothing without clues', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const id = await newPhoto(ctx, user.id, '2025-05-01T09:00:00', { path: `/photos/${factory.uuid()}/a.jpg` });

      await expect(sut.getSuggestion(factory.auth({ user }), { assetIds: [id] })).resolves.toEqual({
        suggestion: null,
      });
    });
  });
});
