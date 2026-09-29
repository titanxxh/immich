import type { FootprintRegion } from '@immich/sdk';

type Named = { name: string; nameZh: string | null };

/** Chinese names for a Chinese interface, falling back to the local name; local names otherwise. */
export const placeName = (place: Named, language: string | undefined) =>
  language?.startsWith('zh') ? (place.nameZh ?? place.name) : place.name;

export const visitYear = (region: FootprintRegion) => region.firstVisitAt.slice(0, 4);

/** Regions first visited in or before `year`, or all of them without one. */
export const visitedBy = (regions: FootprintRegion[], year?: string) =>
  year ? regions.filter((region) => visitYear(region) <= year) : regions;

export const countPlaces = (regions: FootprintRegion[]) => ({
  countries: new Set(regions.map((region) => region.country.id)).size,
  provinces: new Set(
    regions.filter((region) => region.country.code === 'CN' && region.province).map((region) => region.province!.id),
  ).size,
  regions: regions.length,
});

/** Every year from the first visit to the last, with the regions first visited that year. */
export const newRegionsByYear = (regions: FootprintRegion[]) => {
  if (regions.length === 0) {
    return [];
  }

  const years = regions.map((region) => Number(visitYear(region)));
  const result: Array<{ year: string; count: number }> = [];
  for (let year = Math.min(...years); year <= Math.max(...years); year++) {
    result.push({ year: String(year), count: years.filter((visit) => visit === year).length });
  }
  return result;
};

export type SortKey = 'firstVisit' | 'assetCount' | 'name';

export const sortRegions = (regions: FootprintRegion[], key: SortKey, locale: string | undefined) =>
  regions.toSorted((a, b) => {
    switch (key) {
      case 'assetCount': {
        return b.assetCount - a.assetCount;
      }
      case 'name': {
        return placeName(a, locale).localeCompare(placeName(b, locale), locale);
      }
      default: {
        return a.firstVisitAt.localeCompare(b.firstVisitAt);
      }
    }
  });

export const formatVisitDate = (date: string, locale: string | undefined) =>
  new Date(date).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
