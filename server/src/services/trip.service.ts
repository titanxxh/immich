import { Injectable } from '@nestjs/common';
import { getName } from 'i18n-iso-countries';
import { OnJob } from 'src/decorators';
import { AlbumUserRole, DatabaseLock, JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobOf, UserPreferences } from 'src/types';
import { getPreferences } from 'src/utils/preferences';
import {
  buildTripName,
  isHomeActive,
  pickChineseName,
  PlannedTrip,
  planTrips,
  stripAdmin2Suffix,
  TripAsset,
  TripHome,
  TripPlace,
} from 'src/utils/trip';

/** How many located photos of a trip are geocoded to name it. */
const NAMING_SAMPLE_SIZE = 200;
/** Trip names are written for a Chinese-speaking household. */
const NAME_LANGUAGE = 'zh';

const toDate = (value: Date | string) => new Date(value);

const keyOf = ({ name, admin1Name }: { name: string; admin1Name: string }) => `${name}|${admin1Name}`;

@Injectable()
export class TripService extends BaseService {
  @OnJob({ name: JobName.TripDetection, queue: QueueName.BackgroundTask })
  async handleTripDetection({ userId }: JobOf<JobName.TripDetection> = {}): Promise<JobStatus> {
    let userIds = userId ? [userId] : [];
    if (!userId) {
      const users = await this.userRepository.getList({ withDeleted: false });
      userIds = users.map((user) => user.id);
    }

    await this.databaseRepository.withLock(DatabaseLock.TripDetection, async () => {
      for (const id of userIds) {
        try {
          await this.detectTrips(id);
        } catch (error) {
          this.logger.error(`Failed to detect trips for user ${id}: ${error}`);
        }
      }
    });

    return JobStatus.Success;
  }

  private async detectTrips(ownerId: string) {
    const preferences = getPreferences(await this.userRepository.getMetadata(ownerId));
    const { trips: options } = preferences;
    if (!options.enabled || options.homes.length === 0) {
      return;
    }

    // photos uploaded while this run is in progress are picked up by the next run
    const runStartedAt = new Date();
    const [assets, trips] = await Promise.all([
      this.tripRepository.getAssets(ownerId),
      this.tripRepository.getByOwnerId(ownerId),
    ]);

    const plan = planTrips(
      assets.map((asset) => ({
        ...asset,
        localDateTime: toDate(asset.localDateTime),
        createdAt: toDate(asset.createdAt),
      })),
      options,
      trips.map((trip) => ({ id: trip.id, startAt: toDate(trip.startAt), endAt: toDate(trip.endAt) })),
    );

    for (const planned of plan.existing) {
      const trip = trips.find(({ id }) => id === planned.id)!;
      const lastSyncedAt = toDate(trip.lastSyncedAt);
      const newAssetIds = planned.assets.filter((asset) => asset.createdAt > lastSyncedAt).map(({ id }) => id);
      const isExtended =
        planned.startAt.getTime() !== toDate(trip.startAt).getTime() ||
        planned.endAt.getTime() !== toDate(trip.endAt).getTime();

      let generatedName = trip.generatedName;
      if (trip.albumId) {
        await this.albumRepository.addAssetIds(trip.albumId, newAssetIds);

        const isRenamedByUser = trip.albumName !== trip.generatedName;
        if ((newAssetIds.length > 0 || isExtended) && !isRenamedByUser && planned.locatedAssets.length > 0) {
          const name = await this.getTripName(planned, options.homes);
          if (name !== trip.generatedName) {
            await this.albumRepository.update(trip.albumId, { albumName: name }, ownerId);
            generatedName = name;
          }
        }
      }

      if (newAssetIds.length > 0 || isExtended || generatedName !== trip.generatedName) {
        this.logger.log(`Trip ${trip.id} of user ${ownerId}: ${newAssetIds.length} new asset(s)`);
      }

      await this.tripRepository.update(trip.id, {
        startAt: planned.startAt,
        endAt: planned.endAt,
        generatedName,
        lastSyncedAt: runStartedAt,
      });
    }

    for (const planned of plan.created) {
      await this.createTrip(ownerId, planned, preferences, runStartedAt);
    }
  }

  private async createTrip(ownerId: string, planned: PlannedTrip, preferences: UserPreferences, syncedAt: Date) {
    const name = await this.getTripName(planned, preferences.trips.homes);
    const assetIds = [...new Set(planned.assets.map(({ id }) => id))];
    const album = await this.albumRepository.create(
      {
        albumName: name,
        albumThumbnailAssetId: planned.locatedAssets[0]?.id ?? null,
        order: preferences.albums.defaultAssetOrder,
      },
      assetIds,
      [{ userId: ownerId, role: AlbumUserRole.Owner }],
      ownerId,
    );

    await this.tripRepository.create({
      ownerId,
      albumId: album.id,
      startAt: planned.startAt,
      endAt: planned.endAt,
      generatedName: name,
      lastSyncedAt: syncedAt,
    });

    this.logger.log(`Created trip "${name}" with ${assetIds.length} asset(s) for user ${ownerId}`);
  }

  private async getTripName(trip: PlannedTrip, homes: TripHome[]) {
    const sample = sampleEvenly(trip.locatedAssets, NAMING_SAMPLE_SIZE) as Array<
      TripAsset & { latitude: number; longitude: number }
    >;
    const home = homes.find((home) => isHomeActive(home, trip.startAt.toISOString().slice(0, 10))) ?? homes[0];
    const [homePlace, ...places] = await this.tripRepository.getPlaces([home, ...sample]);

    // city names repeat across provinces (e.g. Taizhou in Zhejiang and in Jiangsu), so they are looked up per province
    const cities = places.map((place) =>
      place?.admin2Name && place.admin1Name
        ? { name: stripAdmin2Suffix(place.admin2Name), admin1Name: place.admin1Name }
        : undefined,
    );
    const uniqueCities = new Map(cities.filter((city) => city !== undefined).map((city) => [keyOf(city), city]));
    const alternateNames = await this.tripRepository.getAlternateNames(uniqueCities.values().toArray());

    const tripPlaces: TripPlace[] = [];
    for (const [index, place] of places.entries()) {
      if (!place) {
        continue;
      }

      const city = cities[index];
      tripPlaces.push({
        countryCode: place.countryCode,
        city: city && (pickChineseName(alternateNames.get(keyOf(city)) ?? null) ?? city.name),
      });
    }

    return buildTripName(
      trip.startAt,
      tripPlaces,
      homePlace?.countryCode,
      (countryCode) => getName(countryCode, NAME_LANGUAGE) ?? countryCode,
    );
  }
}

const sampleEvenly = <T>(items: T[], size: number) => {
  if (items.length <= size) {
    return items;
  }

  const step = items.length / size;
  return Array.from({ length: size }, (_, index) => items[Math.floor(index * step)]);
};
