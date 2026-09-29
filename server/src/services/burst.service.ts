import { Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { BurstSearchDto, BurstsResponseDto } from 'src/dtos/burst.dto';
import { BaseService } from 'src/services/base.service';
import { getRecommendedAssetId, SHARPNESS_VERSION } from 'src/utils/burst';

const SHARPNESS_CONCURRENCY = 4;

@Injectable()
export class BurstService extends BaseService {
  /** A page of bursts, scoring on the way the photos without an up-to-date sharpness. */
  async getBursts(auth: AuthDto, dto: BurstSearchDto): Promise<BurstsResponseDto> {
    const [total, bursts] = await Promise.all([
      this.duplicateRepository.getBurstCount(auth.user.id),
      this.duplicateRepository.getBursts(auth.user.id, dto.order, dto.offset, dto.limit),
    ]);

    const unscored = bursts
      .flatMap((burst) => burst.assets)
      .filter((asset) => asset.sharpnessVersion !== SHARPNESS_VERSION && asset.previewPath);
    await this.score(unscored);

    return {
      total,
      bursts: bursts.map((burst) => {
        const assets = burst.assets.map((asset) => ({
          id: asset.id,
          localDateTime: new Date(asset.localDateTime),
          sharpness: asset.sharpness,
        }));
        return { duplicateId: burst.duplicateId, assets, recommendedAssetId: getRecommendedAssetId(assets) };
      }),
    };
  }

  /** Scores the photos in place and stores the scores. */
  private async score(assets: Array<{ id: string; previewPath: string | null; sharpness: number | null }>) {
    const queue = [...assets];
    const worker = async () => {
      for (let asset = queue.shift(); asset; asset = queue.shift()) {
        try {
          asset.sharpness = await this.mediaRepository.getSharpness(asset.previewPath!);
        } catch (error) {
          // a broken preview scores lowest rather than being retried on every page
          this.logger.warn(`Unable to score the sharpness of asset ${asset.id}: ${error}`);
          asset.sharpness = 0;
        }
      }
    };
    await Promise.all(Array.from({ length: SHARPNESS_CONCURRENCY }, worker));

    await this.assetRepository.upsertJobStatus(
      ...assets.map((asset) => ({
        assetId: asset.id,
        sharpness: asset.sharpness,
        sharpnessVersion: SHARPNESS_VERSION,
      })),
    );
  }
}
