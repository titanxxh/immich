import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { getName } from 'i18n-iso-countries';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  TripCreateDto,
  TripDetailResponseDto,
  TripPreviewDto,
  TripPreviewResponseDto,
  TripResponseDto,
  TripSearchDto,
} from 'src/dtos/trip.dto';
import {
  AlbumUserRole,
  AssetOrder,
  DatabaseLock,
  JobName,
  JobStatus,
  Permission,
  QueueName,
  TripSource,
} from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobOf, UserPreferences } from 'src/types';
import { getPreferences } from 'src/utils/preferences';
import {
  buildDays,
  buildLegs,
  buildStops,
  buildTripName,
  countDays,
  describeDay,
  getCoverAssetId,
  getFarthestKm,
  getMainStop,
  isHomeActive,
  pickChineseName,
  PlannedTrip,
  planTrips,
  stripAdmin2Suffix,
  TripAsset,
  TripHome,
} from 'src/utils/trip';

/** How many located photos of a trip are geocoded to name it. */
const NAMING_SAMPLE_SIZE = 200;
/** Trip names are written for a Chinese-speaking household. */
const NAME_LANGUAGE = 'zh';

const toDate = (value: Date | string) => new Date(value);

const toTripAssets = (
  assets: Array<
    Omit<TripAsset, 'localDateTime' | 'createdAt'> & { localDateTime: Date | string; createdAt: Date | string }
  >,
) =>
  assets.map((asset) => ({
    ...asset,
    localDateTime: toDate(asset.localDateTime),
    createdAt: toDate(asset.createdAt),
  }));

type TripRow = Awaited<ReturnType<TripService['tripRepository']['getByOwnerId']>>[number];

/** A place resolved for display: the prefecture-level city for domestic trips, the locality abroad. */
type ResolvedPlace = { countryCode: string; city?: string; locality: string };

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

  async preview(auth: AuthDto, dto: TripPreviewDto): Promise<TripPreviewResponseDto[]> {
    if (dto.homes.length === 0) {
      return [];
    }

    const assets = await this.tripRepository.getAssets(auth.user.id);
    const { created } = planTrips(toTripAssets(assets), dto, []);

    const trips: TripPreviewResponseDto[] = [];
    for (const trip of created) {
      trips.push({
        name: await this.getTripName(trip, dto.homes),
        startAt: trip.startAt,
        endAt: trip.endAt,
        days: countDays(trip.locatedAssets),
        assetCount: trip.assets.length,
      });
    }
    return trips;
  }

  async detect(auth: AuthDto) {
    await this.jobRepository.queue({ name: JobName.TripDetection, data: { userId: auth.user.id } });
  }

  async getAll(auth: AuthDto, dto: TripSearchDto): Promise<TripResponseDto[]> {
    const trips = await this.tripRepository.getByOwnerId(auth.user.id);
    return trips
      .filter((trip) => trip.albumId !== null && (!dto.albumId || trip.albumId === dto.albumId))
      .map((trip) => mapTrip(trip));
  }

  async get(auth: AuthDto, id: string): Promise<TripDetailResponseDto> {
    const trip = await this.findTrip(auth, id);
    const preferences = getPreferences(await this.userRepository.getMetadata(auth.user.id));
    const assets = toTripAssets(await this.tripRepository.getAlbumAssets(trip.albumId!));
    const stops = buildStops(assets);
    const days = buildDays(assets, stops);

    // stops in the home country are named after their city, those abroad after their locality
    const { homes } = preferences.trips;
    const startDate = toDate(trip.startAt).toISOString().slice(0, 10);
    const home = homes.find((home) => isHomeActive(home, startDate)) ?? homes[0];
    const resolved = await this.resolvePlaces(home ? [home, ...stops] : stops);
    const homeCountryCode = home ? resolved[0]?.countryCode : undefined;
    const stopPlaces = (home ? resolved.slice(1) : resolved).map((place) =>
      place && place.countryCode === homeCountryCode ? (place.city ?? place.locality) : place?.locality,
    );

    const dayPlaces = days.map((day) =>
      describeDay(day.stops.map((index) => ({ place: stopPlaces[index], count: stops[index].assetIds.length }))),
    );
    const farthestKm = getFarthestKm(stops, preferences.trips.homes);

    return {
      ...mapTrip(trip),
      places: [...new Set(dayPlaces.flatMap((place) => place.split(' → ')).filter(Boolean))],
      farthestKm: farthestKm === undefined ? null : Math.round(farthestKm),
      days: days.map((day, index) => ({ ...day, place: dayPlaces[index] })),
      stops: stops.map((stop, index) => ({
        latitude: stop.latitude,
        longitude: stop.longitude,
        date: stop.date,
        assetCount: stop.assetIds.length,
        place: stopPlaces[index] ?? null,
      })),
      legs: buildLegs(stops),
    };
  }

  async create(auth: AuthDto, dto: TripCreateDto): Promise<TripResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumDelete, ids: [dto.albumId] });
    if (await this.tripRepository.getByAlbumId(dto.albumId)) {
      throw new BadRequestException('Album is already a trip');
    }

    const assets = toTripAssets(await this.tripRepository.getAlbumAssets(dto.albumId));
    if (assets.length === 0) {
      throw new BadRequestException('Album has no photos');
    }

    const startAt = assets[0].localDateTime;
    const endAt = assets.at(-1)!.localDateTime;
    const trips = await this.tripRepository.getByOwnerId(auth.user.id);
    const overlapping = trips.filter(
      (trip) => trip.albumId !== null && toDate(trip.startAt) <= endAt && toDate(trip.endAt) >= startAt,
    );
    const replaced = new Set(dto.replaceTripIds);
    const conflicts = overlapping.filter((trip) => !replaced.has(trip.id));
    if (conflicts.length > 0) {
      throw new ConflictException({
        message: 'Album overlaps other trips',
        trips: conflicts.map((trip) => mapTrip(trip)),
      });
    }

    for (const trip of overlapping) {
      await this.dismissOrDelete(trip);
    }

    const album = await this.albumRepository.getById(dto.albumId, { withAssets: false });
    const created = await this.tripRepository.create({
      ownerId: auth.user.id,
      albumId: dto.albumId,
      source: TripSource.Manual,
      startAt,
      endAt,
      generatedName: album?.albumName ?? '',
      lastSyncedAt: new Date(),
    });
    await this.refreshSummary({ ...created, albumName: album?.albumName ?? '', albumThumbnailAssetId: null });

    return mapTrip((await this.tripRepository.getById(created.id))!);
  }

  async remove(auth: AuthDto, id: string) {
    await this.dismissOrDelete(await this.findTrip(auth, id));
  }

  private async findTrip(auth: AuthDto, id: string) {
    const trip = await this.tripRepository.getById(id);
    if (!trip || trip.ownerId !== auth.user.id || trip.albumId === null) {
      throw new BadRequestException('Trip not found');
    }
    return trip;
  }

  /** A manual trip is simply forgotten; a detected one is dismissed, keeping its album, so it is not found again. */
  private async dismissOrDelete(trip: { id: string; source: TripSource }) {
    await (trip.source === TripSource.Manual
      ? this.tripRepository.delete(trip.id)
      : this.tripRepository.update(trip.id, { albumId: null }));
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

    // a manual trip spans whatever its album holds, which the user may have changed since the last run
    for (const trip of trips) {
      if (trip.source !== TripSource.Manual || !trip.albumId) {
        continue;
      }

      const albumAssets = await this.tripRepository.getAlbumAssets(trip.albumId!);
      if (albumAssets.length > 0) {
        trip.startAt = albumAssets[0].localDateTime;
        trip.endAt = albumAssets.at(-1)!.localDateTime;
      }
    }

    const plan = planTrips(
      toTripAssets(assets),
      options,
      trips.map((trip) => ({ id: trip.id, startAt: toDate(trip.startAt), endAt: toDate(trip.endAt) })),
    );

    for (const planned of plan.existing) {
      const trip = trips.find(({ id }) => id === planned.id)!;
      if (trip.source === TripSource.Manual) {
        // manual trips only hold their time span, so detection does not create a trip over them
        await this.tripRepository.update(trip.id, { startAt: toDate(trip.startAt), endAt: toDate(trip.endAt) });
        continue;
      }

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

    for (const trip of await this.tripRepository.getByOwnerId(ownerId)) {
      if (trip.albumId) {
        await this.refreshSummary(trip);
      }
    }
  }

  /** Updates what the trip list shows without loading every photo: position, size and, for detected trips, cover. */
  private async refreshSummary(trip: TripRow) {
    const assets = toTripAssets(await this.tripRepository.getAlbumAssets(trip.albumId!));
    const stops = buildStops(assets);
    const mainStop = getMainStop(stops);
    const update: Parameters<typeof this.tripRepository.update>[1] = {
      pointLatitude: mainStop?.latitude ?? null,
      pointLongitude: mainStop?.longitude ?? null,
      dayCount: countDays(assets),
      assetCount: assets.length,
    };

    // the cover is only replaced while it is still the one trip detection picked (or none at all)
    const cover = getCoverAssetId(stops);
    const isCoverGenerated =
      !trip.albumThumbnailAssetId ||
      trip.generatedThumbnailAssetId === null ||
      trip.albumThumbnailAssetId === trip.generatedThumbnailAssetId;
    if (trip.source === TripSource.Auto && cover && isCoverGenerated) {
      if (cover !== trip.albumThumbnailAssetId) {
        await this.albumRepository.update(trip.albumId!, { albumThumbnailAssetId: cover }, trip.ownerId);
      }
      update.generatedThumbnailAssetId = cover;
    }

    await this.tripRepository.update(trip.id, update);
  }

  private async createTrip(ownerId: string, planned: PlannedTrip, preferences: UserPreferences, syncedAt: Date) {
    const name = await this.getTripName(planned, preferences.trips.homes);
    const assetIds = [...new Set(planned.assets.map(({ id }) => id))];
    const album = await this.albumRepository.create(
      {
        albumName: name,
        albumThumbnailAssetId: planned.locatedAssets[0]?.id ?? null,
        // a trip reads from its first day on
        order: AssetOrder.Asc,
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
    const [homePlace, ...places] = await this.resolvePlaces([home, ...sample]);

    return buildTripName(
      trip.startAt,
      places.filter((place) => place !== undefined),
      homePlace?.countryCode,
      (countryCode) => getName(countryCode, NAME_LANGUAGE) ?? countryCode,
    );
  }

  /** Geocodes the points to the Chinese names of their prefecture-level city and nearest locality. */
  private async resolvePlaces(points: Array<{ latitude: number; longitude: number }>) {
    const places = await this.tripRepository.getPlaces(points);

    // city names repeat across provinces (e.g. Taizhou in Zhejiang and in Jiangsu), so they are looked up per province
    const cities = places.map((place) =>
      place?.admin2Name && place.admin1Name
        ? { name: stripAdmin2Suffix(place.admin2Name), admin1Name: place.admin1Name }
        : undefined,
    );
    const uniqueCities = new Map(cities.filter((city) => city !== undefined).map((city) => [keyOf(city), city]));
    const alternateNames = await this.tripRepository.getAlternateNames(uniqueCities.values().toArray());

    return places.map((place, index): ResolvedPlace | undefined => {
      if (!place) {
        return;
      }

      const city = cities[index];
      return {
        countryCode: place.countryCode,
        city: city && (pickChineseName(alternateNames.get(keyOf(city)) ?? null) ?? city.name),
        locality: pickChineseName(place.alternateNames) ?? place.name,
      };
    });
  }
}

const mapTrip = (trip: TripRow): TripResponseDto => ({
  id: trip.id,
  albumId: trip.albumId!,
  source: trip.source,
  name: trip.albumName ?? trip.generatedName,
  startAt: toDate(trip.startAt),
  endAt: toDate(trip.endAt),
  dayCount: trip.dayCount,
  assetCount: trip.assetCount,
  thumbnailAssetId: trip.albumThumbnailAssetId ?? null,
  point:
    trip.pointLatitude === null || trip.pointLongitude === null
      ? null
      : { latitude: trip.pointLatitude, longitude: trip.pointLongitude },
});

const sampleEvenly = <T>(items: T[], size: number) => {
  if (items.length <= size) {
    return items;
  }

  const step = items.length / size;
  return Array.from({ length: size }, (_, index) => items[Math.floor(index * step)]);
};
