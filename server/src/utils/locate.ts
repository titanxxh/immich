/** Photos further apart in time than this belong to different location groups. */
export const LOCATE_GROUP_GAP_HOURS = 3;
/** Smaller runs are not worth a group of their own and are listed as scattered photos instead. */
export const LOCATE_MIN_GROUP_SIZE = 3;
/** How far around a group to look for a located photo to suggest its position. */
export const LOCATE_SUGGESTION_WINDOW_DAYS = 3;
/** Located photos are counted per cell of this size (in degrees, about 1 km) to find where a folder was shot. */
const GRID_DEGREES = 0.01;

const HOUR = 60 * 60 * 1000;

export type UnlocatedAsset = { id: string; localDateTime: Date };

export type LocateGroup = { startAt: Date; endAt: Date; assetIds: string[] };

/**
 * Splits photos without a location into groups of photos taken close together in time, which were most likely taken
 * at the same place. Runs too small for a group are returned as scattered photos.
 */
export const groupUnlocated = (assets: UnlocatedAsset[]) => {
  const runs: UnlocatedAsset[][] = [];
  const sorted = assets.toSorted(
    (a, b) => a.localDateTime.getTime() - b.localDateTime.getTime() || a.id.localeCompare(b.id),
  );
  for (const asset of sorted) {
    const run = runs.at(-1);
    if (run && asset.localDateTime.getTime() - run.at(-1)!.localDateTime.getTime() <= LOCATE_GROUP_GAP_HOURS * HOUR) {
      run.push(asset);
    } else {
      runs.push([asset]);
    }
  }

  const toGroup = (run: UnlocatedAsset[]): LocateGroup => ({
    startAt: run[0].localDateTime,
    endAt: run.at(-1)!.localDateTime,
    assetIds: run.map(({ id }) => id),
  });

  return {
    groups: runs.filter((run) => run.length >= LOCATE_MIN_GROUP_SIZE).map((run) => toGroup(run)),
    scattered: runs.filter((run) => run.length < LOCATE_MIN_GROUP_SIZE).flat(),
  };
};

export type LocatePoint = { latitude: number; longitude: number };

/** Where most of the points are: the centre of the densest grid cell. */
export const findDensestPoint = (points: LocatePoint[]): LocatePoint | undefined => {
  const cells = new Map<string, LocatePoint[]>();
  for (const point of points) {
    const key = `${Math.floor(point.latitude / GRID_DEGREES)}:${Math.floor(point.longitude / GRID_DEGREES)}`;
    cells.set(key, [...(cells.get(key) ?? []), point]);
  }

  let densest: LocatePoint[] | undefined;
  for (const cell of cells.values()) {
    if (!densest || cell.length > densest.length) {
      densest = cell;
    }
  }

  if (!densest) {
    return;
  }

  let latitude = 0;
  let longitude = 0;
  for (const point of densest) {
    latitude += point.latitude;
    longitude += point.longitude;
  }
  return { latitude: latitude / densest.length, longitude: longitude / densest.length };
};

/** The folder of a file path, e.g. `/external/Photos/2024/a.jpg` → `/external/Photos/2024`. */
export const getDirectory = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
