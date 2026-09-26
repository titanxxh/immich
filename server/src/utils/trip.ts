import { DateTime } from 'luxon';

/** Two away photos further apart than this belong to different trips. */
export const TRIP_MAX_GAP_HOURS = 36;
/** Being home for at least this long ends a trip; a single photo taken at home does not. */
export const TRIP_HOME_BREAK_HOURS = 12;
/** A trip also claims photos taken this long before its first or after its last away photo. */
export const TRIP_WINDOW_PADDING_HOURS = 12;

const HOUR = 60 * 60 * 1000;

export type TripHome = {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** first day (YYYY-MM-DD, inclusive) this home applies to */
  from?: string | null;
  /** last day (YYYY-MM-DD, inclusive) this home applies to */
  to?: string | null;
};

export type TripOptions = {
  homes: TripHome[];
  minAssets: number;
  includeDayTrips: boolean;
};

export type TripAsset = {
  id: string;
  /** the wall-clock time the photo was taken, stored as if it were UTC */
  localDateTime: Date;
  createdAt: Date;
  latitude: number | null;
  longitude: number | null;
  make: string | null;
  originalFileName: string;
};

export type TripWindow = { startAt: Date; endAt: Date };

export type ExistingTrip = TripWindow & { id: string };

export type PlannedTrip = TripWindow & {
  /** the away photos that located the trip, used for naming */
  locatedAssets: TripAsset[];
  /** every photo that belongs to the trip in this run */
  assets: TripAsset[];
};

export type TripPlan = {
  existing: Array<PlannedTrip & { id: string }>;
  created: PlannedTrip[];
};

const toLocalDate = (date: Date) => date.toISOString().slice(0, 10);

export const distanceKm = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

export const isHomeActive = (home: TripHome, localDate: string) =>
  (!home.from || home.from <= localDate) && (!home.to || localDate <= home.to);

type Located = TripAsset & { latitude: number; longitude: number };

const isLocated = (asset: TripAsset): asset is Located => asset.latitude !== null && asset.longitude !== null;

/** Photos without a location that still count: camera originals, not screenshots or saved images. */
const isCameraOriginal = (asset: TripAsset) =>
  !isLocated(asset) && !!asset.make && !/screenshot/i.test(asset.originalFileName);

/**
 * Splits the away photos into runs. A run ends when two away photos are more than the max gap apart, or when the
 * user has been home for the home-break duration. Photos taken when no home applies are ignored.
 */
export const splitIntoRuns = (assets: TripAsset[], homes: TripHome[]): Located[][] => {
  const runs: Located[][] = [];
  let current: Located[] = [];
  let homeSince: Date | undefined;

  // photos taken in the same second are ordered by id, so the same photos are always sampled for naming
  const located = assets
    .filter(isLocated)
    .toSorted((a, b) => a.localDateTime.getTime() - b.localDateTime.getTime() || a.id.localeCompare(b.id));
  for (const asset of located) {
    const localDate = toLocalDate(asset.localDateTime);
    const activeHomes = homes.filter((home) => isHomeActive(home, localDate));
    if (activeHomes.length === 0) {
      continue;
    }

    const isHome = activeHomes.some((home) => distanceKm(home, asset) <= home.radiusKm);
    if (isHome) {
      if (current.length > 0) {
        homeSince ??= asset.localDateTime;
        if (asset.localDateTime.getTime() - homeSince.getTime() >= TRIP_HOME_BREAK_HOURS * HOUR) {
          runs.push(current);
          current = [];
          homeSince = undefined;
        }
      }
      continue;
    }

    homeSince = undefined;
    const previous = current.at(-1);
    if (previous && asset.localDateTime.getTime() - previous.localDateTime.getTime() > TRIP_MAX_GAP_HOURS * HOUR) {
      runs.push(current);
      current = [];
    }
    current.push(asset);
  }

  if (current.length > 0) {
    runs.push(current);
  }

  return runs;
};

const isQualifyingRun = (run: Located[], options: TripOptions) => {
  if (run.length < options.minAssets) {
    return false;
  }

  const days = new Set(run.map((asset) => toLocalDate(asset.localDateTime))).size;
  return options.includeDayTrips || days >= 2;
};

const paddedContains = (window: TripWindow, date: Date) =>
  window.startAt.getTime() - TRIP_WINDOW_PADDING_HOURS * HOUR <= date.getTime() &&
  date.getTime() <= window.endAt.getTime() + TRIP_WINDOW_PADDING_HOURS * HOUR;

const paddedOverlaps = (window: TripWindow, run: Located[]) =>
  run[0].localDateTime.getTime() <= window.endAt.getTime() + TRIP_WINDOW_PADDING_HOURS * HOUR &&
  run.at(-1)!.localDateTime.getTime() >= window.startAt.getTime() - TRIP_WINDOW_PADDING_HOURS * HOUR;

const distanceToWindow = (window: TripWindow, date: Date) =>
  Math.max(window.startAt.getTime() - date.getTime(), date.getTime() - window.endAt.getTime(), 0);

const extend = (trip: PlannedTrip, asset: Located) => {
  if (asset.localDateTime < trip.startAt) {
    trip.startAt = asset.localDateTime;
  }
  if (asset.localDateTime > trip.endAt) {
    trip.endAt = asset.localDateTime;
  }
  trip.locatedAssets.push(asset);
};

/**
 * Clusters all of a user's photos into trips and matches them to the trips already known. Existing trips are never
 * merged or split: a run touching one or more of them extends them instead of becoming a new trip.
 */
export const planTrips = (assets: TripAsset[], options: TripOptions, existingTrips: ExistingTrip[]): TripPlan => {
  const existing = existingTrips.map((trip) => ({
    id: trip.id,
    startAt: trip.startAt,
    endAt: trip.endAt,
    locatedAssets: [] as TripAsset[],
    assets: [] as TripAsset[],
  }));
  const created: PlannedTrip[] = [];

  for (const run of splitIntoRuns(assets, options.homes)) {
    const overlapping = existing.filter((trip) => paddedOverlaps(trip, run));
    if (overlapping.length === 0) {
      if (isQualifyingRun(run, options)) {
        created.push({
          startAt: run[0].localDateTime,
          endAt: run.at(-1)!.localDateTime,
          locatedAssets: [...run],
          assets: [],
        });
      }
      continue;
    }

    // decide against the windows as they were before this run touched them, so the order of assets does not matter
    const windows = overlapping.map((trip) => ({ trip, startAt: trip.startAt, endAt: trip.endAt }));
    for (const asset of run) {
      const target =
        windows.find((window) => paddedContains(window, asset.localDateTime)) ??
        windows.toSorted(
          (a, b) => distanceToWindow(a, asset.localDateTime) - distanceToWindow(b, asset.localDateTime),
        )[0];
      extend(target.trip, asset);
    }
  }

  const trips = [...existing, ...created];
  for (const trip of trips) {
    trip.assets.push(...trip.locatedAssets);
  }

  for (const asset of assets) {
    if (!isCameraOriginal(asset)) {
      continue;
    }

    const trip = trips.find((trip) => paddedContains(trip, asset.localDateTime));
    trip?.assets.push(asset);
  }

  return { existing, created };
};

export type TripPlace = {
  countryCode: string;
  /** the prefecture-level city in the user's language, or undefined when unknown */
  city?: string;
};

/**
 * Names a trip `YYYY-MM-DD <place>`: abroad it is the country with the most photos, at home the one or two cities
 * with the most photos.
 */
export const buildTripName = (
  startAt: Date,
  places: TripPlace[],
  homeCountryCode: string | undefined,
  getCountryName: (countryCode: string) => string,
) => {
  const date = DateTime.fromJSDate(startAt, { zone: 'utc' }).toISODate();
  const countries = countBy(places.map((place) => place.countryCode));
  const topCountry = countries[0]?.[0];
  if (!topCountry) {
    return date!;
  }

  if (topCountry !== homeCountryCode) {
    return `${date} ${getCountryName(topCountry)}`;
  }

  const cities = countBy(
    places.filter((place) => place.countryCode === topCountry && place.city).map((place) => place.city!),
  );
  if (cities.length === 0) {
    return `${date} ${getCountryName(topCountry)}`;
  }

  const total = cities.reduce((sum, [, count]) => sum + count, 0);
  // a second city is only named when it is a real part of the trip, not a stopover on the way
  const named = cities.slice(0, 2).filter(([, count], index) => index === 0 || count / total >= 0.1);
  return `${date} ${named.map(([city]) => city).join('·')}`;
};

const countBy = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

let simplifiedChinese: Set<string> | undefined;

/** The characters of GB2312, which has the simplified forms only (not traditional or Japanese ones). */
const getSimplifiedChinese = () => {
  if (!simplifiedChinese) {
    simplifiedChinese = new Set<string>();
    const decoder = new TextDecoder('gbk');
    for (let high = 0xb0; high <= 0xf7; high++) {
      for (let low = 0xa1; low <= 0xfe; low++) {
        simplifiedChinese.add(decoder.decode(new Uint8Array([high, low])));
      }
    }
  }
  return simplifiedChinese;
};

/**
 * Picks the simplified Chinese name of a city from its GeoNames alternate names, which mix simplified, traditional
 * and Japanese spellings as well as the names of the districts the city is seated in. The city's own name is the one
 * that also appears with the `市` (city) suffix.
 */
export const pickChineseName = (alternateNames: string | null) => {
  const chinese = (alternateNames ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => /^[\u{4E00}-\u{9FFF}]+$/u.test(name));
  const simplified = chinese.filter((name) => [...name].every((character) => getSimplifiedChinese().has(character)));
  const names = (simplified.length > 0 ? simplified : chinese).toSorted((a, b) => a.length - b.length);

  const cities = names.filter((name) => name.length > 1 && name.endsWith('市')).map((name) => name.slice(0, -1));
  return cities.find((city) => names.includes(city)) ?? cities[0] ?? names[0];
};

/** The English city name without its administrative suffix, e.g. `Hangzhou Shi` → `Hangzhou`. */
export const stripAdmin2Suffix = (admin2Name: string) =>
  admin2Name.replace(/ (Shi|Diqu|Zizhizhou|Meng|Shiqu|Zizhixian|Linqu|Municipality|Prefecture|City)$/, '');
