import type { TripResponseDto } from '@immich/sdk';

const YEAR_COLORS = [
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

export const getYearColor = (years: string[], year: string) => YEAR_COLORS[years.indexOf(year) % YEAR_COLORS.length];

export const groupByYear = (trips: TripResponseDto[]) => {
  const years = new Map<string, TripResponseDto[]>();
  for (const trip of trips) {
    const year = trip.startAt.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), trip]);
  }
  return [...years];
};

/** The first and, when different, the last day, e.g. ["6月7日", "6月23日"]; trip times are local times stored as UTC. */
export const formatTripDates = (trip: TripResponseDto, locale: string | undefined) => {
  const format = (date: string) =>
    new Date(date).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const start = format(trip.startAt);
  const end = format(trip.endAt);
  return start === end ? [start] : [start, end];
};
