/** Rings of [longitude, latitude]; the first ring is the outline, the others are holes. */
type Polygon = number[][][];

export type FootprintGeometry =
  { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };

export type FootprintFeature<T> = { properties: T; geometry: FootprintGeometry | null };

export type FootprintRegions = { countryId: string | null; provinceId: string | null; regionId: string | null };

type Shape<T> = { polygons: Polygon[]; bbox: [number, number, number, number]; area: number; value: T };

/** How far a photo may be from a region (at sea, or just outside a coarse outline) and still count for it. */
export const FOOTPRINT_NEAREST_KM = 10;

const KM_PER_DEGREE = 111.32;
const CELL_DEGREES = 1;

const ringArea = (ring: number[][]) => {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
};

const inRing = (x: number, y: number, ring: number[][]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

/** Distance in km from a point to a ring's outline, measured on a plane around the point. */
const distanceToRing = (x: number, y: number, ring: number[][], kmPerLon: number) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - x) * kmPerLon;
    const ay = (ring[j][1] - y) * KM_PER_DEGREE;
    const bx = (ring[i][0] - x) * kmPerLon;
    const by = (ring[i][1] - y) * KM_PER_DEGREE;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
};

/** Finds which polygon of a layer a point falls in, using a grid of one-degree cells. */
export class FootprintIndex<T> {
  private shapes: Shape<T>[] = [];
  private cells = new Map<string, number[]>();

  constructor(features: FootprintFeature<T>[]) {
    for (const { properties, geometry } of features) {
      if (!geometry) {
        continue;
      }

      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const bbox: Shape<T>['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
      let area = 0;
      for (const [outline, ...holes] of polygons) {
        for (const [x, y] of outline) {
          bbox[0] = Math.min(bbox[0], x);
          bbox[1] = Math.min(bbox[1], y);
          bbox[2] = Math.max(bbox[2], x);
          bbox[3] = Math.max(bbox[3], y);
        }
        area += ringArea(outline) - holes.reduce((sum, hole) => sum + ringArea(hole), 0);
      }

      const index = this.shapes.length;
      this.shapes.push({ polygons, bbox, area, value: properties });
      for (const key of this.cellKeys(bbox)) {
        const cell = this.cells.get(key);
        if (cell) {
          cell.push(index);
        } else {
          this.cells.set(key, [index]);
        }
      }
    }
  }

  /** The smallest polygon containing the point. */
  find(latitude: number, longitude: number): T | undefined {
    let found: Shape<T> | undefined;
    for (const index of this.cells.get(this.cellKey(longitude, latitude)) ?? []) {
      const shape = this.shapes[index];
      const [minX, minY, maxX, maxY] = shape.bbox;
      if (longitude < minX || longitude > maxX || latitude < minY || latitude > maxY) {
        continue;
      }
      if (found && found.area <= shape.area) {
        continue;
      }
      const inside = shape.polygons.some(
        ([outline, ...holes]) =>
          inRing(longitude, latitude, outline) && holes.every((hole) => !inRing(longitude, latitude, hole)),
      );
      if (inside) {
        found = shape;
      }
    }
    return found?.value;
  }

  /** The polygon whose outline is closest to the point, if it is within `maxKm`. */
  nearest(latitude: number, longitude: number, maxKm: number): T | undefined {
    const kmPerLon = KM_PER_DEGREE * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
    const dx = maxKm / kmPerLon;
    const dy = maxKm / KM_PER_DEGREE;
    const candidates = new Set<number>();
    for (const key of this.cellKeys([longitude - dx, latitude - dy, longitude + dx, latitude + dy])) {
      for (const index of this.cells.get(key) ?? []) {
        candidates.add(index);
      }
    }

    let best: { distance: number; shape?: Shape<T> } = { distance: maxKm };
    for (const index of candidates) {
      const shape = this.shapes[index];
      const [minX, minY, maxX, maxY] = shape.bbox;
      if (longitude < minX - dx || longitude > maxX + dx || latitude < minY - dy || latitude > maxY + dy) {
        continue;
      }
      for (const polygon of shape.polygons) {
        for (const ring of polygon) {
          const distance = distanceToRing(longitude, latitude, ring, kmPerLon);
          if (distance <= best.distance) {
            best = { distance, shape };
          }
        }
      }
    }
    return best.shape?.value;
  }

  private cellKey(x: number, y: number) {
    return `${Math.floor(x / CELL_DEGREES)},${Math.floor(y / CELL_DEGREES)}`;
  }

  private *cellKeys([minX, minY, maxX, maxY]: Shape<T>['bbox']) {
    for (let x = Math.floor(minX / CELL_DEGREES); x <= Math.floor(maxX / CELL_DEGREES); x++) {
      for (let y = Math.floor(minY / CELL_DEGREES); y <= Math.floor(maxY / CELL_DEGREES); y++) {
        yield `${x},${y}`;
      }
    }
  }
}

export type FootprintCountry = { countryId: string; provinceId: string | null };

/**
 * The regions a photo was taken in. Leaves carry their region, province and country; a photo in no
 * leaf (usually at sea, where county outlines stop at the coast) takes the nearest leaf within
 * {@link FOOTPRINT_NEAREST_KM}, and failing that only the country it is in, if any.
 */
export const findFootprintRegions = (
  leaves: FootprintIndex<FootprintRegions>,
  countries: FootprintIndex<FootprintCountry>,
  { latitude, longitude }: { latitude: number; longitude: number },
): FootprintRegions => {
  const leaf = leaves.find(latitude, longitude) ?? leaves.nearest(latitude, longitude, FOOTPRINT_NEAREST_KM);
  if (leaf) {
    return leaf;
  }

  const country = countries.find(latitude, longitude);
  return { countryId: country?.countryId ?? null, provinceId: country?.provinceId ?? null, regionId: null };
};
