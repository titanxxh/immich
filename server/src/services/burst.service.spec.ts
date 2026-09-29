import { BurstService } from 'src/services/burst.service';
import { SHARPNESS_VERSION } from 'src/utils/burst';
import { authStub } from 'test/fixtures/auth.stub';
import { newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it } from 'vitest';

const photo = (id: string, sharpness: number | null, sharpnessVersion: number | null, previewPath: string | null) => ({
  id,
  localDateTime: new Date('2024-05-01T10:00:00.000Z'),
  sharpness,
  sharpnessVersion,
  previewPath,
});

describe(BurstService.name, () => {
  let sut: BurstService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BurstService));
  });

  describe('getBursts', () => {
    it('should return the stored scores and recommend the sharpest photo', async () => {
      mocks.duplicateRepository.getBurstCount.mockResolvedValue(7);
      mocks.duplicateRepository.getBursts.mockResolvedValue([
        {
          duplicateId: 'burst-1',
          assets: [photo('a', 10, SHARPNESS_VERSION, '/a.jpeg'), photo('b', 40, SHARPNESS_VERSION, '/b.jpeg')],
        },
      ] as any);

      const result = await sut.getBursts(authStub.admin, { offset: 0, limit: 40 });

      expect(result.total).toBe(7);
      expect(result.bursts).toEqual([
        {
          duplicateId: 'burst-1',
          assets: [
            { id: 'a', localDateTime: new Date('2024-05-01T10:00:00.000Z'), sharpness: 10 },
            { id: 'b', localDateTime: new Date('2024-05-01T10:00:00.000Z'), sharpness: 40 },
          ],
          recommendedAssetId: 'b',
        },
      ]);
      expect(mocks.duplicateRepository.getBursts).toHaveBeenCalledWith(authStub.admin.user.id, 0, 40);
      expect(mocks.media.getSharpness).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith();
    });

    it('should score and store photos without a score or with an outdated one', async () => {
      mocks.duplicateRepository.getBurstCount.mockResolvedValue(1);
      mocks.duplicateRepository.getBursts.mockResolvedValue([
        {
          duplicateId: 'burst-1',
          assets: [
            photo('a', null, null, '/a.jpeg'),
            photo('b', 99, SHARPNESS_VERSION - 1, '/b.jpeg'),
            photo('c', 50, SHARPNESS_VERSION, '/c.jpeg'),
          ],
        },
      ] as any);
      mocks.media.getSharpness.mockImplementation((path) => Promise.resolve(path === '/a.jpeg' ? 60 : 20));

      const result = await sut.getBursts(authStub.admin, { offset: 0, limit: 40 });

      expect(mocks.media.getSharpness).toHaveBeenCalledTimes(2);
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        { assetId: 'a', sharpness: 60, sharpnessVersion: SHARPNESS_VERSION },
        { assetId: 'b', sharpness: 20, sharpnessVersion: SHARPNESS_VERSION },
      );
      expect(result.bursts[0].assets.map((asset) => asset.sharpness)).toEqual([60, 20, 50]);
      expect(result.bursts[0].recommendedAssetId).toBe('a');
    });

    it('should leave photos without a preview unscored', async () => {
      mocks.duplicateRepository.getBurstCount.mockResolvedValue(1);
      mocks.duplicateRepository.getBursts.mockResolvedValue([
        { duplicateId: 'burst-1', assets: [photo('a', null, null, null), photo('b', null, null, null)] },
      ] as any);

      const result = await sut.getBursts(authStub.admin, { offset: 0, limit: 40 });

      expect(mocks.media.getSharpness).not.toHaveBeenCalled();
      expect(result.bursts[0].recommendedAssetId).toBe('a');
    });

    it('should store the lowest score when a preview cannot be read', async () => {
      mocks.duplicateRepository.getBurstCount.mockResolvedValue(1);
      mocks.duplicateRepository.getBursts.mockResolvedValue([
        { duplicateId: 'burst-1', assets: [photo('a', null, null, '/a.jpeg'), photo('b', 5, SHARPNESS_VERSION, '/b.jpeg')] },
      ] as any);
      mocks.media.getSharpness.mockRejectedValue(new Error('broken'));

      const result = await sut.getBursts(authStub.admin, { offset: 0, limit: 40 });

      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: 'a',
        sharpness: 0,
        sharpnessVersion: SHARPNESS_VERSION,
      });
      expect(result.bursts[0].recommendedAssetId).toBe('b');
    });
  });
});
