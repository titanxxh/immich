// PROTOTYPE: in-memory state shared by the trip settings variants. No persistence. Wipe me.
import { sampleTrips } from './prototype-data';

export type Home = { id: number; name: string; lat: number; lng: number; radiusKm: number; from?: string; to?: string };

let nextId = 2;

export const tripState = $state({
  enabled: true,
  includeDayTrips: false,
  gapHours: 36,
  minAssets: 10,
  homes: [{ id: 1, name: '家', lat: 30, lng: 120, radiusKm: 50, from: '', to: '' }] as Home[],
  lastRun: '2026-09-25 03:00',
});

export const addHome = (point?: { lat: number; lng: number }) => {
  tripState.homes.push({
    id: nextId++,
    name: `家 ${tripState.homes.length + 1}`,
    lat: point?.lat ?? 0,
    lng: point?.lng ?? 0,
    radiusKm: 50,
    from: '',
    to: '',
  });
};

export const removeHome = (id: number) => {
  tripState.homes = tripState.homes.filter((home) => home.id !== id);
};

// Fake preview: filters synthetic trips by the first home's radius, N and the day-trip switch.
export const previewTrips = () => {
  const radius = tripState.homes[0]?.radiusKm ?? 50;
  return sampleTrips.filter(
    (trip) => trip.farKm > radius && trip.count >= tripState.minAssets && (tripState.includeDayTrips || !trip.dayTrip),
  );
};
