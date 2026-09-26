import {
  buildTripName,
  pickChineseName,
  planTrips,
  splitIntoRuns,
  stripAdmin2Suffix,
  TripAsset,
  TripHome,
  TripOptions,
} from 'src/utils/trip';
import { describe, expect, it } from 'vitest';

const home: TripHome = { name: 'Home', latitude: 30, longitude: 120, radiusKm: 50 };
// ~110km north of home
const away = { latitude: 31, longitude: 120 };
// ~1100km north of home
const farAway = { latitude: 40, longitude: 120 };

let nextId = 0;
const asset = (
  localDateTime: string,
  location: { latitude: number; longitude: number } | null,
  overrides: Partial<TripAsset> = {},
): TripAsset => ({
  id: `asset-${nextId++}`,
  localDateTime: new Date(`${localDateTime}Z`),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  latitude: location?.latitude ?? null,
  longitude: location?.longitude ?? null,
  make: 'Canon',
  originalFileName: 'IMG_0001.JPG',
  ...overrides,
});

/** `count` photos at `location`, one every `everyHours` hours from `start`. */
const series = (start: string, count: number, location: { latitude: number; longitude: number }, everyHours = 1) =>
  Array.from({ length: count }, (_, index) =>
    asset(
      new Date(new Date(`${start}Z`).getTime() + index * everyHours * 3_600_000).toISOString().slice(0, 19),
      location,
    ),
  );

const options = (overrides: Partial<TripOptions> = {}): TripOptions => ({
  homes: [home],
  minAssets: 3,
  includeDayTrips: false,
  ...overrides,
});

describe(splitIntoRuns.name, () => {
  it('should ignore photos taken at home', () => {
    expect(splitIntoRuns(series('2025-05-01T08:00:00', 5, home), [home])).toEqual([]);
  });

  it('should not end a trip for a single photo taken at home', () => {
    // e.g. a photo sent from home by family while the user is away
    const assets = [
      ...series('2025-05-01T08:00:00', 3, away),
      asset('2025-05-01T12:00:00', home),
      ...series('2025-05-01T14:00:00', 3, away),
    ];

    expect(splitIntoRuns(assets, [home])).toHaveLength(1);
  });

  it('should end a trip after being home for 12 hours', () => {
    const assets = [
      ...series('2025-05-01T08:00:00', 3, away),
      asset('2025-05-01T20:00:00', home),
      asset('2025-05-02T08:00:00', home),
      ...series('2025-05-02T10:00:00', 3, away),
    ];

    expect(splitIntoRuns(assets, [home])).toHaveLength(2);
  });

  it('should end a trip when photos are more than 36 hours apart', () => {
    const assets = [...series('2025-05-01T08:00:00', 3, away), ...series('2025-05-03T00:00:00', 3, away)];

    expect(splitIntoRuns(assets, [home])).toHaveLength(2);
  });

  it('should use the home that applies on the day the photo was taken', () => {
    const oldHome = { ...home, ...away, name: 'Old home', to: '2024-12-31' };
    const newHome = { ...home, from: '2025-01-01' };
    const assets = [...series('2024-06-01T08:00:00', 3, away), ...series('2025-06-01T08:00:00', 3, away)];

    const runs = splitIntoRuns(assets, [oldHome, newHome]);

    expect(runs).toHaveLength(1);
    expect(runs[0][0].localDateTime.toISOString()).toBe('2025-06-01T08:00:00.000Z');
  });

  it('should ignore photos taken when no home applies', () => {
    const assets = series('2024-06-01T08:00:00', 3, away);

    expect(splitIntoRuns(assets, [{ ...home, from: '2025-01-01' }])).toEqual([]);
  });
});

describe(planTrips.name, () => {
  it('should create a trip spanning several days', () => {
    const assets = series('2025-05-01T20:00:00', 6, away, 2);

    const { created, existing } = planTrips(assets, options(), []);

    expect(existing).toEqual([]);
    expect(created).toHaveLength(1);
    expect(created[0].startAt.toISOString()).toBe('2025-05-01T20:00:00.000Z');
    expect(created[0].endAt.toISOString()).toBe('2025-05-02T06:00:00.000Z');
    expect(created[0].assets).toHaveLength(6);
  });

  it('should skip trips with too few photos', () => {
    const assets = series('2025-05-01T20:00:00', 2, away, 12);

    expect(planTrips(assets, options(), []).created).toEqual([]);
  });

  it('should only create day trips when enabled', () => {
    const assets = series('2025-05-01T08:00:00', 5, away);

    expect(planTrips(assets, options(), []).created).toEqual([]);
    expect(planTrips(assets, options({ includeDayTrips: true }), []).created).toHaveLength(1);
  });

  it('should add camera originals without a location taken during the trip', () => {
    const assets = [
      ...series('2025-05-01T20:00:00', 3, away, 12),
      asset('2025-05-01T10:00:00', null), // 10 hours before the first located photo
      asset('2025-05-02T12:00:00', null, { make: null }), // e.g. an image saved from a chat app
      asset('2025-05-02T12:00:00', null, { originalFileName: 'Screenshot_20250502.png' }),
      asset('2025-05-04T12:00:00', null), // long after the trip
    ];

    const [trip] = planTrips(assets, options(), []).created;

    expect(trip.assets).toHaveLength(4);
    expect(trip.assets.map(({ localDateTime }) => localDateTime.toISOString())).toContain('2025-05-01T10:00:00.000Z');
  });

  it('should extend an existing trip instead of creating a new one', () => {
    const assets = series('2025-05-01T20:00:00', 6, away, 12);
    const existingTrip = {
      id: 'trip-1',
      startAt: new Date('2025-05-01T20:00:00Z'),
      endAt: new Date('2025-05-02T20:00:00Z'),
    };

    const { created, existing } = planTrips(assets, options(), [existingTrip]);

    expect(created).toEqual([]);
    expect(existing).toHaveLength(1);
    expect(existing[0].endAt.toISOString()).toBe('2025-05-04T08:00:00.000Z');
    expect(existing[0].assets).toHaveLength(6);
  });

  it('should keep existing trips apart when new photos fill the gap between them', () => {
    const assets = series('2025-05-01T00:00:00', 9, away, 12);
    const first = { id: 'first', startAt: new Date('2025-05-01T00:00:00Z'), endAt: new Date('2025-05-02T00:00:00Z') };
    const second = { id: 'second', startAt: new Date('2025-05-04T00:00:00Z'), endAt: new Date('2025-05-05T00:00:00Z') };

    const { created, existing } = planTrips(assets, options(), [first, second]);

    expect(created).toEqual([]);
    expect(existing.map(({ assets }) => assets.length)).toEqual([5, 4]);
    expect(existing[0].endAt.toISOString()).toBe('2025-05-03T00:00:00.000Z');
    expect(existing[1].startAt.toISOString()).toBe('2025-05-03T12:00:00.000Z');
  });

  it('should leave existing trips without photos untouched', () => {
    const existingTrip = { id: 'trip-1', startAt: new Date('2020-01-01Z'), endAt: new Date('2020-01-03Z') };

    const { existing } = planTrips([], options(), [existingTrip]);

    expect(existing).toEqual([expect.objectContaining({ ...existingTrip, assets: [] })]);
  });

  it('should find the same trips when run again', () => {
    const assets = [...series('2025-05-01T20:00:00', 6, away, 12), ...series('2025-06-01T08:00:00', 6, farAway, 12)];
    const first = planTrips(assets, options(), []);

    const second = planTrips(
      assets,
      options(),
      first.created.map((trip, index) => ({ id: String(index), startAt: trip.startAt, endAt: trip.endAt })),
    );

    expect(second.created).toEqual([]);
    expect(second.existing.map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual(
      first.created.map(({ startAt, endAt }) => ({ startAt, endAt })),
    );
  });
});

const countryName = (code: string) => ({ CN: '中国', JP: '日本' })[code] ?? code;

/** `count` photos taken in `city` of `countryCode`. */
const places = (count: number, countryCode: string, city: string) =>
  Array.from({ length: count }, () => ({ countryCode, city }));

describe(buildTripName.name, () => {
  const startAt = new Date('2025-05-01T20:00:00Z');

  it('should name a trip abroad after the country', () => {
    const tripPlaces = [...places(9, 'JP', '京都'), { countryCode: 'CN', city: '上海' }];

    expect(buildTripName(startAt, tripPlaces, 'CN', countryName)).toBe('2025-05-01 日本');
  });

  it('should name a domestic trip after the cities with the most photos', () => {
    const tripPlaces = [...places(6, 'CN', '厦门'), ...places(3, 'CN', '漳州'), { countryCode: 'CN', city: '泉州' }];

    expect(buildTripName(startAt, tripPlaces, 'CN', countryName)).toBe('2025-05-01 厦门·漳州');
  });

  it('should leave out a second city with few photos', () => {
    const tripPlaces = [...places(19, 'CN', '杭州'), { countryCode: 'CN', city: '嘉兴' }];

    expect(buildTripName(startAt, tripPlaces, 'CN', countryName)).toBe('2025-05-01 杭州');
  });

  it('should fall back to the country without any known city', () => {
    expect(buildTripName(startAt, [{ countryCode: 'CN' }], 'CN', countryName)).toBe('2025-05-01 中国');
  });

  it('should fall back to the date without any known place', () => {
    expect(buildTripName(startAt, [], 'CN', countryName)).toBe('2025-05-01');
  });
});

describe(pickChineseName.name, () => {
  it('should pick the name of the city rather than of its seat district', () => {
    expect(pickChineseName('Huzhou,Huzhou Shi,Wuxing,Wuxing Qu,hu zhou,吴兴,吴兴区,湖州,湖州市')).toBe('湖州');
    expect(pickChineseName('Zhoushan,Dinghai Qu,定海,定海区,舟山,舟山市')).toBe('舟山');
  });

  it('should prefer the simplified spelling', () => {
    expect(pickChineseName('Jingdezhen,景徳鎮,景德镇,景德镇市')).toBe('景德镇');
    expect(pickChineseName('Shangrao,上饒,上饒市,上饶,上饶市')).toBe('上饶');
  });

  it('should fall back to the shortest Chinese name', () => {
    expect(pickChineseName('Badaling,Badaling Zhen,八达岭,八达岭镇')).toBe('八达岭');
    expect(pickChineseName('Chongqing,長沙')).toBe('長沙');
  });

  it('should return undefined without a Chinese name', () => {
    expect(pickChineseName('Lobuche')).toBeUndefined();
    expect(pickChineseName(null)).toBeUndefined();
  });
});

describe(stripAdmin2Suffix.name, () => {
  it('should strip the administrative suffix', () => {
    expect(stripAdmin2Suffix('Hangzhou Shi')).toBe('Hangzhou');
    expect(stripAdmin2Suffix('Dali Baizu Zizhizhou')).toBe('Dali Baizu');
    expect(stripAdmin2Suffix('Shanghai Municipality')).toBe('Shanghai');
    expect(stripAdmin2Suffix('Maricopa County')).toBe('Maricopa County');
  });
});
