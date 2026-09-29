import { Kysely } from 'kysely';
import { AssetFileType, AssetType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DuplicateRepository } from 'src/repositories/duplicate.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { DB } from 'src/schema';
import { BurstService } from 'src/services/burst.service';
import { SHARPNESS_VERSION } from 'src/utils/burst';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(BurstService, {
    database: db || defaultDatabase,
    real: [AccessRepository, AssetRepository, DuplicateRepository],
    mock: [LoggingRepository, MediaRepository],
  });
};

type Context = ReturnType<typeof setup>['ctx'];

const newPhoto = async (
  ctx: Context,
  ownerId: string,
  duplicateId: string | null,
  time: string,
  options: { type?: AssetType; hasJobStatus?: boolean } = {},
) => {
  const localDateTime = new Date(`${time}Z`);
  const { asset } = await ctx.newAsset({
    ownerId,
    duplicateId,
    localDateTime,
    fileCreatedAt: localDateTime,
    type: options.type ?? AssetType.Image,
  });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/previews/${asset.id}.jpeg` });
  if (options.hasJobStatus ?? true) {
    await ctx.newJobStatus({ assetId: asset.id });
  }
  return asset.id;
};

describe(BurstService.name, () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
  });

  describe('getBursts', () => {
    it('should page through bursts oldest first, score them and store the scores', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const later = factory.uuid();
      const earlier = factory.uuid();
      const laterIds = [
        await newPhoto(ctx, user.id, later, '2025-06-01T09:00:00'),
        await newPhoto(ctx, user.id, later, '2025-06-01T09:00:01'),
      ];
      const earlierIds = [
        await newPhoto(ctx, user.id, earlier, '2025-05-01T09:00:00'),
        // a photo without a job status row yet is scored too
        await newPhoto(ctx, user.id, earlier, '2025-05-01T09:00:02', { hasJobStatus: false }),
        await newPhoto(ctx, user.id, earlier, '2025-05-01T09:00:01'),
      ];
      // not bursts: a single photo, videos, and someone else's photos
      await newPhoto(ctx, user.id, factory.uuid(), '2025-05-02T09:00:00');
      const videos = factory.uuid();
      await newPhoto(ctx, user.id, videos, '2025-05-03T09:00:00', { type: AssetType.Video });
      await newPhoto(ctx, user.id, videos, '2025-05-03T09:00:01', { type: AssetType.Video });
      const { user: other } = await ctx.newUser();
      const theirs = factory.uuid();
      await newPhoto(ctx, other.id, theirs, '2025-05-01T09:00:00');
      await newPhoto(ctx, other.id, theirs, '2025-05-01T09:00:01');

      const scores: Record<string, number> = { [earlierIds[1]]: 50, [earlierIds[2]]: 90 };
      ctx.getMock(MediaRepository).getSharpness.mockImplementation((path) => {
        const id = path.slice('/previews/'.length, -'.jpeg'.length);
        return Promise.resolve(scores[id] ?? 10);
      });

      const first = await sut.getBursts(auth, { offset: 0, limit: 1 });

      expect(first.total).toBe(2);
      expect(first.bursts).toHaveLength(1);
      expect(first.bursts[0].duplicateId).toBe(earlier);
      expect(first.bursts[0].assets.map((asset) => asset.id)).toEqual([earlierIds[0], earlierIds[2], earlierIds[1]]);
      expect(first.bursts[0].assets.map((asset) => asset.sharpness)).toEqual([10, 90, 50]);
      expect(first.bursts[0].recommendedAssetId).toBe(earlierIds[2]);

      const stored = await ctx.database
        .selectFrom('asset_job_status')
        .select(['assetId', 'sharpness', 'sharpnessVersion', 'duplicatesDetectedAt'])
        .where('assetId', 'in', earlierIds)
        .execute();
      expect(stored).toHaveLength(3);
      for (const row of stored) {
        expect(row.sharpnessVersion).toBe(SHARPNESS_VERSION);
        expect(row.sharpness).toBe(scores[row.assetId] ?? 10);
      }
      // other job statuses are left alone
      expect(stored.find((row) => row.assetId === earlierIds[0])?.duplicatesDetectedAt).not.toBeNull();

      const second = await sut.getBursts(auth, { offset: 1, limit: 1 });
      expect(second.bursts.map((burst) => burst.duplicateId)).toEqual([later]);
      expect(second.bursts[0].assets.map((asset) => asset.id)).toEqual(laterIds);
    });

    it('should not score photos again once scored', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const duplicateId = factory.uuid();
      await newPhoto(ctx, user.id, duplicateId, '2025-05-01T09:00:00');
      await newPhoto(ctx, user.id, duplicateId, '2025-05-01T09:00:01');
      const getSharpness = ctx.getMock(MediaRepository).getSharpness.mockResolvedValue(5);

      await sut.getBursts(auth, { offset: 0, limit: 40 });
      await sut.getBursts(auth, { offset: 0, limit: 40 });

      expect(getSharpness).toHaveBeenCalledTimes(2);
    });
  });
});
