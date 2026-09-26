// PROTOTYPE: trip list page, variants via ?variant=A|B|C. Throwaway.
import { getAllAlbums } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const albums = await getAllAlbums({});
  // prototype stand-in for "albums that belong to a trip": the trip albums are named `YYYY-MM-DD <place>`
  const trips = albums
    .filter((album) => /^\d{4}-\d{2}-\d{2} /.test(album.albumName))
    .map((album) => {
      const start = album.albumName.slice(0, 10);
      const end = album.endDate?.slice(0, 10) ?? start;
      const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
      return { album, start, end, days, place: album.albumName.slice(11), year: start.slice(0, 4) };
    })
    .toSorted((a, b) => b.start.localeCompare(a.start));
  return { trips, meta: { title: '旅行' } };
}) satisfies PageLoad;
