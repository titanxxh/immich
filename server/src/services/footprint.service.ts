import { Injectable } from '@nestjs/common';
import { OnEvent, OnJob } from 'src/decorators';
import { DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName, SystemMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import {
  FootprintCountry,
  FootprintFeature,
  FootprintIndex,
  FootprintRegions,
  findFootprintRegions,
} from 'src/utils/footprint';

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

const BATCH_SIZE = 1000;

@Injectable()
export class FootprintService extends BaseService {
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
