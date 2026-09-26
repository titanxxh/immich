// PROTOTYPE: client-side trip data for the album page layout prototype. Throwaway — the real version is decided
// in "旅行视图的数据接口与计算". Day city here is the exif city (town level), not the prefecture used for album names.
import { searchAssets, type TripHome } from '@immich/sdk';

export type TripPhoto = {
  id: string;
  time: Date;
  date: string;
  lat?: number;
  lon?: number;
  city?: string;
  country?: string;
};
export type TripStop = { lat: number; lon: number; start: Date; end: Date; count: number; date: string };
export type TripDay = {
  index: number;
  date: string;
  label: string;
  place: string;
  photos: TripPhoto[];
  stops: TripStop[];
  color: string;
};
export type TripSegment = { from: TripStop; to: TripStop; long: boolean; color: string };
export type TripData = {
  days: TripDay[];
  stops: TripStop[];
  segments: TripSegment[];
  cities: string[];
  farthestKm?: number;
  photoCount: number;
};

const COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#9a6324',
  '#469990',
  '#800000',
];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const distanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

const cache = new Map<string, Promise<TripData>>();

/** Loads once per album, so switching variants does not refetch. */
export const getTrip = (albumId: string, homes: TripHome[]) => {
  if (!cache.has(albumId)) {
    cache.set(albumId, loadTrip(albumId, homes));
  }
  return cache.get(albumId)!;
};

const loadTrip = async (albumId: string, homes: TripHome[]): Promise<TripData> => {
  const photos: TripPhoto[] = [];
  let page: number | undefined = 1;
  while (page) {
    const { assets } = await searchAssets({
      metadataSearchDto: { albumIds: [albumId], size: 1000, page, withExif: true },
    });
    for (const asset of assets.items) {
      const exif = asset.exifInfo;
      photos.push({
        id: asset.id,
        time: new Date(asset.localDateTime),
        date: asset.localDateTime.slice(0, 10),
        lat: exif?.latitude ?? undefined,
        lon: exif?.longitude ?? undefined,
        city: exif?.city ?? exif?.state ?? undefined,
        country: exif?.country ?? undefined,
      });
    }
    page = assets.nextPage ? Number(assets.nextPage) : undefined;
  }
  photos.sort((a, b) => a.time.getTime() - b.time.getTime());

  // stops: consecutive located photos within an hour and 2 km of each other
  const stops: TripStop[] = [];
  for (const photo of photos) {
    if (photo.lat === undefined || photo.lon === undefined) {
      continue;
    }
    const last = stops.at(-1);
    const point = { lat: photo.lat, lon: photo.lon };
    if (
      last &&
      last.date === photo.date &&
      photo.time.getTime() - last.end.getTime() <= 3_600_000 &&
      distanceKm(last, point) <= 2
    ) {
      last.lat = (last.lat * last.count + point.lat) / (last.count + 1);
      last.lon = (last.lon * last.count + point.lon) / (last.count + 1);
      last.count++;
      last.end = photo.time;
    } else {
      stops.push({ ...point, start: photo.time, end: photo.time, count: 1, date: photo.date });
    }
  }

  const dates = [...new Set(photos.map((photo) => photo.date))];
  const days: TripDay[] = dates.map((date, index) => {
    const dayPhotos = photos.filter((photo) => photo.date === date);
    const counts = new Map<string, { count: number; first: number }>();
    dayPhotos.forEach((photo, i) => {
      if (photo.city) {
        const entry = counts.get(photo.city) ?? { count: 0, first: i };
        entry.count++;
        counts.set(photo.city, entry);
      }
    });
    const total = [...counts.values()].reduce((sum, { count }) => sum + count, 0);
    const places = [...counts.entries()]
      .filter(([, { count }]) => count / total >= 0.2)
      .toSorted((a, b) => a[1].first - b[1].first)
      .map(([city]) => city);
    const d = new Date(`${date}T00:00:00Z`);
    return {
      index: index + 1,
      date,
      label: `第 ${index + 1} 天 · ${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${WEEKDAYS[d.getUTCDay()]}`,
      place: places.slice(0, 3).join(' → '),
      photos: dayPhotos,
      stops: stops.filter((stop) => stop.date === date),
      color: COLORS[index % COLORS.length],
    };
  });

  const colorOf = (date: string) => days.find((day) => day.date === date)?.color ?? '#888';
  const segments = stops.slice(1).map((to, i) => {
    const from = stops[i];
    return { from, to, long: distanceKm(from, to) > 300, color: colorOf(to.date) };
  });

  const farthestKm =
    homes.length > 0 && stops.length > 0
      ? Math.round(
          Math.max(
            ...stops.map((stop) =>
              Math.min(...homes.map((home) => distanceKm(stop, { lat: home.latitude, lon: home.longitude }))),
            ),
          ),
        )
      : undefined;

  const cities = [...new Set(days.flatMap((day) => day.place.split(' → ')).filter(Boolean))];
  return { days, stops, segments, cities, farthestKm, photoCount: photos.length };
};
