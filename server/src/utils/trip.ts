import { DateTime } from 'luxon';

/** Two away photos further apart than this belong to different trips. */
export const TRIP_MAX_GAP_HOURS = 36;
/** Being home for at least this long ends a trip; a single photo taken at home does not. */
export const TRIP_HOME_BREAK_HOURS = 12;
/** A trip also claims photos taken this long before its first or after its last away photo. */
export const TRIP_WINDOW_PADDING_HOURS = 12;

/** A photo in a trip's album widens the trip only this close to it; one further away most likely has a wrong date. */
export const TRIP_ALBUM_MAX_GAP_DAYS = 7;

/** Photos by two devices this close in time but this far apart show two groups apart, e.g. a family split up. */
export const TRIP_APART_MINUTES = 15;
export const TRIP_APART_KM = 30;
/** Two groups are only told apart when seen apart in this many different hours, each with this many photos. */
export const TRIP_APART_MIN_HOURS = 2;
export const TRIP_APART_MIN_ASSETS = 3;
/** Two groups met when they took photos this close in time and within the apart distance of each other. */
export const TRIP_MEET_HOURS = 3;

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
  /** when the photo was taken, used to tell photos taken at the same moment in different time zones */
  takenAt: Date;
  make: string | null;
  model: string | null;
  originalFileName: string;
};

export type TripWindow = { startAt: Date; endAt: Date };

export type TripPoint = { latitude: number; longitude: number };

/** `points` are where the trip went, used to tell apart trips that overlap in time. */
export type ExistingTrip = TripWindow & { id: string; points?: TripPoint[] };

export type PlannedTrip = TripWindow & {
  /** the away photos that located the trip, used for naming */
  locatedAssets: TripAsset[];
  /** every photo that belongs to the trip in this run */
  assets: TripAsset[];
};

/** A photo whose location contradicts a photo taken at the same moment, most likely placed wrong. */
export type TripSuspect = { assetId: string; otherAssetId: string };

export type TripPlan = {
  existing: Array<PlannedTrip & { id: string }>;
  created: PlannedTrip[];
  suspects: TripSuspect[];
};

const toLocalDate = (date: Date) => date.toISOString().slice(0, 10);

const distanceToPoints = (points: TripPoint[] | undefined, point: TripPoint) =>
  points && points.length > 0 ? Math.min(...points.map((other) => distanceKm(other, point))) : Infinity;

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

/** The number of calendar days the photos were taken on. */
export const countDays = (assets: TripAsset[]) => new Set(assets.map((asset) => toLocalDate(asset.localDateTime))).size;

const isQualifyingRun = (run: Located[], options: TripOptions) =>
  run.length >= options.minAssets && (options.includeDayTrips || countDays(run) >= 2);

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
 * Widens a trip to the photos the user added to its album, stepping outwards from photo to photo while each is at
 * most the album gap away. It never narrows the trip.
 */
export const widenToAlbum = (window: TripWindow, dates: Date[]): TripWindow => {
  const maxGap = TRIP_ALBUM_MAX_GAP_DAYS * 24 * HOUR;
  let startAt = window.startAt.getTime();
  let endAt = window.endAt.getTime();
  const times = dates.map((date) => date.getTime());
  for (const time of times.filter((time) => time < startAt).toSorted((a, b) => b - a)) {
    if (startAt - time > maxGap) {
      break;
    }
    startAt = time;
  }
  for (const time of times.filter((time) => time > endAt).toSorted((a, b) => a - b)) {
    if (time - endAt > maxGap) {
      break;
    }
    endAt = time;
  }
  return { startAt: new Date(startAt), endAt: new Date(endAt) };
};

/** The device a photo was taken with, or undefined for images without one such as those saved from a chat app. */
export const getDevice = (asset: TripAsset) => (asset.make ? `${asset.make} ${asset.model ?? ''}`.trim() : undefined);

const APART_MS = TRIP_APART_MINUTES * 60 * 1000;
const MEET_MS = TRIP_MEET_HOURS * HOUR;

/** Every pair of photos taken within `ms` of each other, earlier photo first. */
const pairsWithin = <T extends { takenAt: Date }>(sorted: T[], ms: number, visit: (a: T, b: T) => void) => {
  let start = 0;
  for (let index = 0; index < sorted.length; index++) {
    const b = sorted[index];
    while (b.takenAt.getTime() - sorted[start].takenAt.getTime() > ms) {
      start++;
    }
    for (let other = start; other < index; other++) {
      visit(sorted[other], b);
    }
  }
};

const byTakenAt = (a: { takenAt: Date }, b: { takenAt: Date }) => a.takenAt.getTime() - b.takenAt.getTime();

/** Whether two sets of photos were ever taken together: close in time and in place. */
export const wereTogether = (a: TripAsset[], b: TripAsset[]) => {
  const tagged = [
    ...a.filter(isLocated).map((asset) => ({ asset, side: 0, takenAt: asset.takenAt })),
    ...b.filter(isLocated).map((asset) => ({ asset, side: 1, takenAt: asset.takenAt })),
  ].toSorted(byTakenAt);
  let met = false;
  pairsWithin(tagged, MEET_MS, (x, y) => {
    met ||= x.side !== y.side && distanceKm(x.asset, y.asset) <= TRIP_APART_KM;
  });
  return met;
};

/**
 * Splits a run into the groups that took it when two groups were apart at the same time, e.g. family members on
 * separate trips. Devices seen apart are two-coloured into two groups; the other devices join the group they were
 * with. The run stays whole when the groups met, when they were apart too little to be sure, or when the devices
 * cannot be told into two groups; the photos behind a doubt are returned as suspects.
 */
export const splitIntoGroups = (run: Located[]): { groups: Located[][]; suspects: TripSuspect[] } => {
  const sorted = run.filter((asset) => getDevice(asset)).toSorted(byTakenAt);
  const apart: Array<[Located, Located]> = [];
  pairsWithin(sorted, APART_MS, (a, b) => {
    if (getDevice(a) !== getDevice(b) && distanceKm(a, b) > TRIP_APART_KM) {
      apart.push([a, b]);
    }
  });
  if (apart.length === 0) {
    return { groups: [run], suspects: [] };
  }

  const flagPairs = () =>
    apart.flatMap(([a, b]) => [
      { assetId: a.id, otherAssetId: b.id },
      { assetId: b.id, otherAssetId: a.id },
    ]);

  // two-colour the devices seen apart
  const neighbours = new Map<string, Set<string>>();
  for (const [a, b] of apart) {
    const [deviceA, deviceB] = [getDevice(a)!, getDevice(b)!];
    neighbours.set(deviceA, (neighbours.get(deviceA) ?? new Set()).add(deviceB));
    neighbours.set(deviceB, (neighbours.get(deviceB) ?? new Set()).add(deviceA));
  }
  const color = new Map<string, number>();
  for (const start of neighbours.keys()) {
    if (color.has(start)) {
      continue;
    }
    color.set(start, 0);
    const stack = [start];
    while (stack.length > 0) {
      const device = stack.pop()!;
      for (const other of neighbours.get(device)!) {
        if (!color.has(other)) {
          color.set(other, 1 - color.get(device)!);
          stack.push(other);
        } else if (color.get(other) === color.get(device)) {
          return { groups: [run], suspects: flagPairs() };
        }
      }
    }
  }

  // a device never seen apart joins the group it took photos with
  const votes = new Map<string, [number, number]>();
  pairsWithin(sorted, MEET_MS, (a, b) => {
    for (const [asset, other] of [
      [a, b],
      [b, a],
    ]) {
      const device = getDevice(asset)!;
      const otherColor = color.get(getDevice(other)!);
      if (!neighbours.has(device) && otherColor !== undefined && distanceKm(asset, other) <= TRIP_APART_KM) {
        const vote = votes.get(device) ?? [0, 0];
        vote[otherColor]++;
        votes.set(device, vote);
      }
    }
  });
  for (const [device, [zero, one]] of votes) {
    color.set(device, zero >= one ? 0 : 1);
  }

  // the rest, e.g. images without a device, go with the group they were placed next to around that time,
  // or else with the coloured photo nearest in time
  const coloured = sorted.filter((asset) => color.has(getDevice(asset)!));
  const sideOf = (asset: Located) => {
    const device = getDevice(asset);
    if (device && color.has(device)) {
      return color.get(device)!;
    }
    const gap = (other: Located) => Math.abs(other.takenAt.getTime() - asset.takenAt.getTime());
    let nearest = coloured[0];
    for (const other of coloured) {
      const isCloser =
        gap(other) <= MEET_MS && gap(nearest) <= MEET_MS
          ? distanceKm(other, asset) < distanceKm(nearest, asset)
          : gap(other) < gap(nearest);
      if (isCloser) {
        nearest = other;
      }
    }
    return color.get(getDevice(nearest)!)!;
  };

  // a photo far from its own group and next to the other one at the same moment was most likely placed wrong
  const suspects = new Map<string, TripSuspect>();
  const farFromOwn = new Set<string>();
  pairsWithin(sorted, APART_MS, (a, b) => {
    if (sideOf(a) === sideOf(b) && distanceKm(a, b) > TRIP_APART_KM) {
      farFromOwn.add(a.id).add(b.id);
    }
  });
  pairsWithin(sorted, APART_MS, (a, b) => {
    for (const [asset, other] of [
      [a, b],
      [b, a],
    ]) {
      if (farFromOwn.has(asset.id) && sideOf(asset) !== sideOf(other) && distanceKm(asset, other) <= TRIP_APART_KM) {
        suspects.set(asset.id, { assetId: asset.id, otherAssetId: other.id });
      }
    }
  });

  const sides: Located[][] = [[], []];
  for (const asset of run) {
    sides[sideOf(asset)].push(asset);
  }
  // only photos with a device tell whether the groups met; an image without one proves nothing
  const trusted = sides.map((side) => side.filter((asset) => getDevice(asset) && !suspects.has(asset.id)));
  const hours = new Set(apart.map(([a]) => Math.floor(a.takenAt.getTime() / HOUR))).size;
  const isSure = hours >= TRIP_APART_MIN_HOURS && trusted.every((side) => side.length >= TRIP_APART_MIN_ASSETS);
  if (!isSure) {
    return { groups: [run], suspects: [...flagPairs(), ...suspects.values()] };
  }
  if (wereTogether(trusted[0], trusted[1])) {
    return { groups: [run], suspects: [] };
  }

  return { groups: sides, suspects: suspects.values().toArray() };
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
    points: trip.points,
    locatedAssets: [] as TripAsset[],
    assets: [] as TripAsset[],
  }));
  const created: PlannedTrip[] = [];
  const suspects = new Map<string, TripSuspect>();

  for (const run of splitIntoRuns(assets, options.homes)) {
    const split = splitIntoGroups(run);
    for (const suspect of split.suspects) {
      suspects.set(suspect.assetId, suspect);
    }

    // existing trips are never split: only a new stretch becomes a trip per group
    const overlapping = existing.filter((trip) => paddedOverlaps(trip, run));
    if (overlapping.length === 0) {
      for (const group of split.groups) {
        if (isQualifyingRun(group, options)) {
          created.push({
            startAt: group[0].localDateTime,
            endAt: group.at(-1)!.localDateTime,
            locatedAssets: [...group],
            assets: [],
          });
        }
      }
      continue;
    }

    // decide against the windows as they were before this run touched them, so the order of assets does not matter
    const windows = overlapping.map((trip) => ({ trip, startAt: trip.startAt, endAt: trip.endAt }));
    for (const asset of run) {
      // trips at the same time in different places each take the photos nearest to them
      const containing = windows
        .filter((window) => paddedContains(window, asset.localDateTime))
        .toSorted((a, b) => distanceToPoints(a.trip.points, asset) - distanceToPoints(b.trip.points, asset));
      const target =
        containing[0] ??
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

  const locatedByDevice = new Map<string, Located[]>();
  for (const asset of assets) {
    const device = getDevice(asset);
    if (device && isLocated(asset)) {
      locatedByDevice.set(device, [...(locatedByDevice.get(device) ?? []), asset]);
    }
  }

  for (const asset of assets) {
    if (!isCameraOriginal(asset)) {
      continue;
    }

    const candidates = trips.filter((trip) => paddedContains(trip, asset.localDateTime));
    if (candidates.length === 0) {
      continue;
    }

    // a photo goes with the trip its device was on; a device located elsewhere meanwhile, e.g. at home, was not on it
    const device = getDevice(asset);
    const onTrip = candidates.filter((trip) => trip.locatedAssets.some((located) => getDevice(located) === device));
    const wasElsewhere = (locatedByDevice.get(device!) ?? []).some((located) =>
      candidates.some((trip) => paddedContains(trip, located.localDateTime)),
    );
    if (onTrip.length === 0 && wasElsewhere) {
      continue;
    }

    // otherwise it goes where the located photo nearest in time went
    const nearestInTime = (trip: PlannedTrip) =>
      Math.min(
        ...trip.locatedAssets.map((located) =>
          Math.abs(located.localDateTime.getTime() - asset.localDateTime.getTime()),
        ),
      );
    const pool = onTrip.length > 0 ? onTrip : candidates;
    pool.toSorted((a, b) => nearestInTime(a) - nearestInTime(b))[0].assets.push(asset);
  }

  return { existing, created, suspects: suspects.values().toArray() };
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

/** Photos taken within this long of the previous one, on the same day, can belong to the same stop. */
export const STOP_MAX_GAP_MINUTES = 60;
/** Photos within this distance of a stop's centre belong to it. */
export const STOP_RADIUS_KM = 2;
/** A leg between stops longer than this is travelled by plane or train, not walked or driven. */
export const LONG_JUMP_KM = 300;

export type TripStop = {
  latitude: number;
  longitude: number;
  /** local date (YYYY-MM-DD) of the stop */
  date: string;
  startAt: Date;
  endAt: Date;
  assetIds: string[];
};

export type TripLeg = { from: number; to: number; isLongJump: boolean };

export type TripDay = {
  /** 1 for the first day of the trip */
  index: number;
  /** local date (YYYY-MM-DD) */
  date: string;
  assetCount: number;
  /** the first photo of the day, to scroll the timeline to */
  firstAssetId: string;
  /** indexes into the trip's stops */
  stops: number[];
};

const byTime = (a: TripAsset, b: TripAsset) =>
  a.localDateTime.getTime() - b.localDateTime.getTime() || a.id.localeCompare(b.id);

/** Groups the located photos into stops: places the user stayed at for a while, in the order they were visited. */
export const buildStops = (assets: TripAsset[]): TripStop[] => {
  const stops: TripStop[] = [];
  for (const asset of assets.filter(isLocated).toSorted(byTime)) {
    const date = toLocalDate(asset.localDateTime);
    const stop = stops.at(-1);
    if (
      stop &&
      stop.date === date &&
      asset.localDateTime.getTime() - stop.endAt.getTime() <= STOP_MAX_GAP_MINUTES * 60 * 1000 &&
      distanceKm(stop, asset) <= STOP_RADIUS_KM
    ) {
      const count = stop.assetIds.length;
      stop.latitude = (stop.latitude * count + asset.latitude) / (count + 1);
      stop.longitude = (stop.longitude * count + asset.longitude) / (count + 1);
      stop.endAt = asset.localDateTime;
      stop.assetIds.push(asset.id);
      continue;
    }

    stops.push({
      latitude: asset.latitude,
      longitude: asset.longitude,
      date,
      startAt: asset.localDateTime,
      endAt: asset.localDateTime,
      assetIds: [asset.id],
    });
  }

  return stops;
};

/** The legs between consecutive stops. */
export const buildLegs = (stops: TripStop[]): TripLeg[] =>
  stops.slice(1).map((stop, index) => ({
    from: index,
    to: index + 1,
    isLongJump: distanceKm(stops[index], stop) > LONG_JUMP_KM,
  }));

/** Splits all photos of a trip, located or not, into calendar days. */
export const buildDays = (assets: TripAsset[], stops: TripStop[]): TripDay[] => {
  const days = new Map<string, TripAsset[]>();
  for (const asset of assets.toSorted(byTime)) {
    const date = toLocalDate(asset.localDateTime);
    days.set(date, [...(days.get(date) ?? []), asset]);
  }

  return [...days].map(([date, dayAssets], index) => ({
    index: index + 1,
    date,
    assetCount: dayAssets.length,
    firstAssetId: dayAssets[0].id,
    stops: stops.flatMap((stop, stopIndex) => (stop.date === date ? [stopIndex] : [])),
  }));
};

/** The stop with the most photos, which stands for the whole trip on a map and provides its cover. */
/** The located photos taken away from every home. */
export const getAwayAssets = (assets: TripAsset[], homes: TripHome[]) =>
  assets
    .filter(isLocated)
    .filter((asset) =>
      homes.every(
        (home) => !isHomeActive(home, toLocalDate(asset.localDateTime)) || distanceKm(home, asset) > home.radiusKm,
      ),
    );

/** Where a trip went: the centres of its stops, leaving out those at a home. */
export const getAwayPoints = (assets: TripAsset[], homes: TripHome[]): TripPoint[] =>
  buildStops(assets)
    .filter((stop) => homes.every((home) => !isHomeActive(home, stop.date) || distanceKm(home, stop) > home.radiusKm))
    .map(({ latitude, longitude }) => ({ latitude, longitude }));

export const getMainStop = (stops: TripStop[]) => {
  let main: TripStop | undefined;
  for (const stop of stops) {
    if (!main || stop.assetIds.length > main.assetIds.length) {
      main = stop;
    }
  }
  return main;
};

/** A photo from the middle of the main stop, which is less likely to be a blurry first or last shot. */
export const getCoverAssetId = (stops: TripStop[]) => {
  const stop = getMainStop(stops);
  return stop?.assetIds[Math.floor(stop.assetIds.length / 2)];
};

/**
 * Describes where a day was spent: the places with at least a fifth of its located photos, in the order they were
 * first visited, e.g. `丽江 → 大理`.
 */
export const describeDay = (stops: Array<{ place?: string; count: number }>) => {
  const places = new Map<string, number>();
  for (const { place, count } of stops) {
    if (place) {
      places.set(place, (places.get(place) ?? 0) + count);
    }
  }

  let total = 0;
  for (const count of places.values()) {
    total += count;
  }

  return [...places]
    .filter(([, count]) => count / total >= 0.2)
    .slice(0, 3)
    .map(([place]) => place)
    .join(' → ');
};

/** How far from home the trip went: the largest distance from a stop to the nearest home that applied that day. */
export const getFarthestKm = (stops: TripStop[], homes: TripHome[]) => {
  if (stops.length === 0 || homes.length === 0) {
    return;
  }

  return Math.max(
    ...stops.map((stop) => {
      const active = homes.filter((home) => isHomeActive(home, stop.date));
      return Math.min(...(active.length > 0 ? active : homes).map((home) => distanceKm(home, stop)));
    }),
  );
};
