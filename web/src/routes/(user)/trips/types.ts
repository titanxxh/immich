// PROTOTYPE
import type { AlbumResponseDto } from '@immich/sdk';

export type TripItem = {
  album: AlbumResponseDto;
  start: string;
  end: string;
  days: number;
  place: string;
  year: string;
};
export const formatRange = (trip: TripItem) =>
  trip.start === trip.end
    ? trip.start.slice(5).replace('-', '月') + '日'
    : `${trip.start.slice(5).replace('-', '月')}日 – ${trip.end.slice(5).replace('-', '月')}日`;
export const groupByYear = (trips: TripItem[]) => {
  const years = new Map<string, TripItem[]>();
  for (const trip of trips) {
    years.set(trip.year, [...(years.get(trip.year) ?? []), trip]);
  }
  return [...years.entries()];
};
