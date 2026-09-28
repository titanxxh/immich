import { Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { LocateAssetIdsDto, LocateGroupsResponseDto, LocateSuggestionResponseDto } from 'src/dtos/locate.dto';
import { Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { findDensestPoint, getDirectory, groupUnlocated, LOCATE_SUGGESTION_WINDOW_DAYS } from 'src/utils/locate';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class LocateService extends BaseService {
  async getGroups(auth: AuthDto): Promise<LocateGroupsResponseDto> {
    const assets = await this.locateRepository.getUnlocatedAssets(auth.user.id);
    const { groups, scattered } = groupUnlocated(
      assets.map((asset) => ({ id: asset.id, localDateTime: new Date(asset.localDateTime) })),
    );

    return {
      groups: groups
        .toSorted((a, b) => b.assetIds.length - a.assetIds.length)
        .map((group) => ({ id: group.assetIds[0], ...group })),
      scattered: scattered.map(({ id }) => id),
    };
  }

  /** Suggests where photos were taken from located photos in the same folders, or else nearby in time. */
  async getSuggestion(auth: AuthDto, dto: LocateAssetIdsDto): Promise<LocateSuggestionResponseDto> {
    const assets = await this.locateRepository.getAssets(auth.user.id, dto.assetIds);
    if (assets.length === 0) {
      return { suggestion: null };
    }

    const directories = [...new Set(assets.map((asset) => getDirectory(asset.originalPath)))];
    const byDirectory = findDensestPoint(
      await this.locateRepository.getLocatedInDirectories(auth.user.id, directories),
    );
    if (byDirectory) {
      return { suggestion: { ...byDirectory, source: 'directory' } };
    }

    const times = assets.map((asset) => new Date(asset.localDateTime).getTime());
    const start = Math.min(...times);
    const end = Math.max(...times);
    const nearest = await this.locateRepository.getNearestLocated(
      auth.user.id,
      new Date((start + end) / 2),
      new Date(start - LOCATE_SUGGESTION_WINDOW_DAYS * DAY),
      new Date(end + LOCATE_SUGGESTION_WINDOW_DAYS * DAY),
    );
    return { suggestion: nearest ? { ...nearest, source: 'time' } : null };
  }

  async ignore(auth: AuthDto, dto: LocateAssetIdsDto) {
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: dto.assetIds });
    await this.locateRepository.ignore(dto.assetIds);
  }
}
