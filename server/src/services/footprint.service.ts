import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent, OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  FootprintRegionDetailResponseDto,
  FootprintRegionDto,
  FootprintShapesResponseDto,
  FootprintsResponseDto,
} from 'src/dtos/footprint.dto';
import { DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName, SystemMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import {
  FootprintCountry,
  FootprintFeature,
  FootprintIndex,
  FootprintRegions,
  findFootprintRegions,
} from 'src/utils/footprint';
import { getPreferences } from 'src/utils/preferences';

type RegionFileRow = {
  id: string;
  level: string;
  countryId: string;
  provinceId: string | null;
  countryCode: string;
  name: string;
  nameZh: string | null;
  center: [number, number];
};

type FeatureCollection<T> = { features: FootprintFeature<T>[] };

type RegionRow = Awaited<ReturnType<BaseService['footprintRepository']['getRegions']>>[number];
type Visit = {
  firstVisitAt: Date | string | null;
  lastVisitAt: Date | string | null;
  assetCount: number | string;
  dayCount: number | string;
};
type Shape = FootprintShapesResponseDto['features'][number];

const BATCH_SIZE = 1000;
/** Photos shown in a region's drawer. */
const SAMPLE_SIZE = 48;

/** Picks `count` items spread evenly over `items`, keeping their order. */
export const sampleEvenly = <T>(items: T[], count: number) => {
  if (items.length <= count) {
    return items;
  }
  return Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]);
};

@Injectable()
export class FootprintService extends BaseService {
  private shapes?: { version: string; byId: Map<string, Shape> };

  async getAll(auth: AuthDto): Promise<FootprintsResponseDto> {
    const version = await this.getVersion();
    if (!version) {
      return { regions: [], pendingCount: 0 };
    }

    const [visits, pendingCount, hidden] = await Promise.all([
      this.footprintRepository.getRegionVisits(auth.user.id),
      this.footprintRepository.countPending(auth.user.id, version),
      this.getHiddenRegionIds(auth),
    ]);
    const regions = await this.getRegionRows(visits.map(({ id }) => id));
    const rows = visits
      .map((visit) => {
        const region = regions.get(visit.id);
        return region && this.toRegionDto(region, regions, visit, hidden);
      })
      .filter((row) => row !== undefined)
      .toSorted((a, b) => a.firstVisitAt.getTime() - b.firstVisitAt.getTime());

    return { regions: rows, pendingCount };
  }

  async getShapes(auth: AuthDto): Promise<FootprintShapesResponseDto> {
    const version = await this.getVersion();
    if (!version) {
      return { type: 'FeatureCollection', features: [] };
    }

    if (this.shapes?.version !== version) {
      const { display } = this.configRepository.getEnv().resourcePaths.footprints;
      const { features } = await this.footprintRepository.readJson<{ features: Shape[] }>(display);
      this.shapes = { version, byId: new Map(features.map((feature) => [feature.properties.id, feature])) };
    }

    const visits = await this.footprintRepository.getRegionVisits(auth.user.id);
    const features = visits
      .map(({ id }) => this.shapes!.byId.get(id))
      .filter((feature) => feature !== undefined)
      .toSorted((a, b) => a.properties.id.localeCompare(b.properties.id));
    return { type: 'FeatureCollection', features };
  }

  async getRegion(auth: AuthDto, id: string): Promise<FootprintRegionDetailResponseDto> {
    const [visit, assetIds, hidden] = await Promise.all([
      this.footprintRepository.getVisit(auth.user.id, id),
      this.footprintRepository.getAssetIds(auth.user.id, id),
      this.getHiddenRegionIds(auth),
    ]);
    const regions = await this.getRegionRows([id]);
    const region = regions.get(id);
    if (!region || assetIds.length === 0) {
      throw new NotFoundException('No photos taken in this region');
    }

    return { region: this.toRegionDto(region, regions, visit, hidden), assetIds: sampleEvenly(assetIds, SAMPLE_SIZE) };
  }

  private async getHiddenRegionIds(auth: AuthDto) {
    const metadata = await this.userRepository.getMetadata(auth.user.id);
    return new Set(getPreferences(metadata).footprints.hiddenRegionIds);
  }

  /** The regions with these ids, and their provinces and countries. */
  private async getRegionRows(ids: string[]) {
    const regions = await this.footprintRepository.getRegions(ids);
    const parents = new Set(regions.flatMap(({ provinceId, countryId }) => [provinceId, countryId]));
    for (const { id } of regions) {
      parents.delete(id);
    }
    parents.delete(null);
    const parentRows = await this.footprintRepository.getRegions([...parents] as string[]);
    return new Map([...regions, ...parentRows].map((row) => [row.id, row]));
  }

  private toRegionDto(
    region: RegionRow,
    regions: Map<string, RegionRow>,
    visit: Visit,
    hidden: Set<string>,
  ): FootprintRegionDto {
    const country = regions.get(region.countryId) ?? region;
    // a municipality such as Shanghai, and abroad a first-level region, is its own province
    const province = region.provinceId
      ? regions.get(region.provinceId)
      : region.level === 'province'
        ? region
        : undefined;
    // abroad that says nothing new, so show no province there
    const showProvince = province && (country.countryCode === 'CN' || province.id !== region.id);
    return {
      id: region.id,
      name: region.name,
      nameZh: region.nameZh,
      province: showProvince ? { id: province.id, name: province.name, nameZh: province.nameZh } : null,
      country: { id: country.id, name: country.name, nameZh: country.nameZh, code: country.countryCode },
      latitude: region.latitude,
      longitude: region.longitude,
      firstVisitAt: new Date(visit.firstVisitAt!),
      lastVisitAt: new Date(visit.lastVisitAt!),
      assetCount: Number(visit.assetCount),
      dayCount: Number(visit.dayCount),
      hidden: hidden.has(region.id),
    };
  }

  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    const version = await this.getVersion();
    if (!version) {
      this.logger.warn('Footprint region files not found, footprints are disabled');
      return;
    }

    await this.databaseRepository.withLock(DatabaseLock.FootprintImport, () => this.importRegions(version));
    await this.jobRepository.queue({ name: JobName.FootprintAssign });
  }

  @OnEvent({ name: 'AssetMetadataExtracted' })
  async onAssetMetadataExtracted() {
    await this.jobRepository.queue({ name: JobName.FootprintAssign });
  }

  @OnJob({ name: JobName.FootprintAssign, queue: QueueName.BackgroundTask })
  async handleAssign(): Promise<JobStatus> {
    const version = await this.getVersion();
    if (!version) {
      return JobStatus.Skipped;
    }

    await this.databaseRepository.withLock(DatabaseLock.FootprintAssign, () => this.assign(version));
    return JobStatus.Success;
  }

  private async getVersion() {
    const { versionFile } = this.configRepository.getEnv().resourcePaths.footprints;
    if (!(await this.storageRepository.checkFileExists(versionFile))) {
      return;
    }
    return this.footprintRepository.readVersion(versionFile);
  }

  private async importRegions(version: string) {
    const state = await this.systemMetadataRepository.get(SystemMetadataKey.FootprintRegionsState);
    if (state?.version === version) {
      return;
    }

    const { regions } = this.configRepository.getEnv().resourcePaths.footprints;
    const rows = await this.footprintRepository.readJson<RegionFileRow[]>(regions);
    await this.footprintRepository.replaceRegions(
      rows.map(({ center: [longitude, latitude], ...row }) => ({ ...row, latitude, longitude })),
    );
    await this.systemMetadataRepository.set(SystemMetadataKey.FootprintRegionsState, { version });
    this.logger.log(`Imported ${rows.length} footprint regions (${version})`);
  }

  private async assign(version: string) {
    await this.footprintRepository.deleteUnlocated();

    let assets = await this.footprintRepository.getAssetsToAssign(version, BATCH_SIZE);
    if (assets.length === 0) {
      return;
    }

    // the outlines take a few hundred MB once parsed, so they are only loaded while there is work
    const paths = this.configRepository.getEnv().resourcePaths.footprints;
    const leafFile = await this.footprintRepository.readJson<FeatureCollection<FootprintRegions>>(paths.leaves);
    const countryFile = await this.footprintRepository.readJson<FeatureCollection<FootprintCountry>>(paths.countries);
    const leaves = new FootprintIndex(leafFile.features);
    const countries = new FootprintIndex(countryFile.features);

    let count = 0;
    while (assets.length > 0) {
      await this.footprintRepository.upsertAssetRegions(
        assets.map(({ assetId, latitude, longitude }) => ({
          assetId,
          ...findFootprintRegions(leaves, countries, { latitude, longitude }),
          latitude,
          longitude,
          version,
        })),
      );
      count += assets.length;
      assets = await this.footprintRepository.getAssetsToAssign(version, BATCH_SIZE);
    }

    this.logger.log(`Found the footprint regions of ${count} assets`);
  }
}
