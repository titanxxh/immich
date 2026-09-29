import {
  FootprintCountry,
  FootprintFeature,
  FootprintIndex,
  FootprintRegions,
  findFootprintRegions,
} from 'src/utils/footprint';
import { describe, expect, it } from 'vitest';

const square = (minX: number, minY: number, maxX: number, maxY: number) => [
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
  [minX, minY],
];

const leaf = (regionId: string, ...rings: number[][][]): FootprintFeature<FootprintRegions> => ({
  properties: { regionId, provinceId: 'province', countryId: 'country' },
  geometry: { type: 'Polygon', coordinates: rings },
});

const regionAt = (features: FootprintFeature<FootprintRegions>[], latitude: number, longitude: number) =>
  findFootprintRegions(new FootprintIndex(features), new FootprintIndex<FootprintCountry>([]), { latitude, longitude })
    .regionId;

describe('findFootprintRegions', () => {
  it('finds the region a photo falls in', () => {
    const leaves = [leaf('west', square(0, 0, 1, 1)), leaf('east', square(1, 0, 2, 1))];

    expect(regionAt(leaves, 0.5, 0.5)).toBe('west');
    expect(regionAt(leaves, 0.5, 1.5)).toBe('east');
  });

  it('works for polygons that span several grid cells', () => {
    const leaves = [leaf('big', square(-5.5, -3.2, 7.8, 4.1))];

    expect(regionAt(leaves, 3.9, 7.7)).toBe('big');
    expect(regionAt(leaves, -3.1, -5.4)).toBe('big');
  });

  it('leaves out the holes of a polygon', () => {
    const leaves = [leaf('ring', square(0, 0, 1, 1), square(0.4, 0.4, 0.6, 0.6))];

    expect(regionAt(leaves, 0.2, 0.2)).toBe('ring');
    expect(regionAt(leaves, 0.5, 0.5)).toBeNull();
  });

  it('prefers the smallest region when regions overlap', () => {
    const leaves = [leaf('outer', square(0, 0, 1, 1)), leaf('enclave', square(0.4, 0.4, 0.6, 0.6))];

    expect(regionAt(leaves, 0.5, 0.5)).toBe('enclave');
    expect(regionAt(leaves, 0.2, 0.2)).toBe('outer');
  });

  it('takes the nearest region within 10 km, for photos taken at sea', () => {
    // 0.05° of longitude at the equator is about 5.6 km
    const leaves = [leaf('coast', square(0, 0, 1, 1)), leaf('far', square(1.2, 0, 2, 1))];

    expect(regionAt(leaves, 0.5, 1.05)).toBe('coast');
    expect(regionAt(leaves, 0.5, 1.15)).toBe('far');
  });

  it('falls back to the country when no region is within 10 km', () => {
    const leaves = new FootprintIndex([leaf('coast', square(0, 0, 1, 1))]);
    const countries = new FootprintIndex<FootprintCountry>([
      {
        properties: { countryId: 'country', provinceId: null },
        geometry: { type: 'Polygon', coordinates: [square(0, 0, 1.5, 1)] },
      },
    ]);

    expect(findFootprintRegions(leaves, countries, { latitude: 0.5, longitude: 1.2 })).toEqual({
      countryId: 'country',
      provinceId: null,
      regionId: null,
    });
    expect(findFootprintRegions(leaves, countries, { latitude: 0.5, longitude: 3 })).toEqual({
      countryId: null,
      provinceId: null,
      regionId: null,
    });
  });

  it('reads multipolygons', () => {
    const leaves: FootprintFeature<FootprintRegions>[] = [
      {
        properties: { regionId: 'islands', provinceId: null, countryId: 'country' },
        geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 1, 1)], [square(3, 3, 4, 4)]] },
      },
    ];

    expect(regionAt(leaves, 3.5, 3.5)).toBe('islands');
    expect(regionAt(leaves, 2, 2)).toBeNull();
  });

  it('skips features without a geometry', () => {
    expect(regionAt([{ properties: leaf('none').properties, geometry: null }], 0, 0)).toBeNull();
  });
});
