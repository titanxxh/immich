import { basename, dirname, extname, join } from 'node:path';

export type ReorganizePreset = 'year-month' | 'day' | 'year-day';

export type ReorganizeSkipReason =
  | 'internal'
  | 'not-owner'
  | 'offline'
  | 'trashed'
  | 'unreliable-date'
  | 'library-excluded'
  | 'other-owner-library'
  | 'identical'
  | 'shared-sidecar';

export type ReorganizeConflict = 'target-exists' | 'same-target';

/** What the plan says about one photo. A photo that moves under a new name has `renamed` set. */
export type ReorganizeAction = 'move' | 'in-place' | 'conflict' | 'skip';

export interface ReorganizeAsset {
  id: string;
  ownerId: string;
  libraryId: string | null;
  libraryOwnerId: string | null;
  originalPath: string;
  /** The photo's date as shown on the timeline: local time stored as if it were UTC. */
  localDateTime: Date;
  dateFromExif: boolean | null;
  isOffline: boolean;
  isTrashed: boolean;
  sidecarPath: string | null;
  /** The separate video file of a live photo, which follows the photo. */
  liveVideo: { id: string; originalPath: string } | null;
}

export interface ReorganizeOptions {
  userId: string;
  targetPath: string;
  targetLibraryId: string;
  preset: ReorganizePreset;
  /** Label per day (`YYYY-MM-DD`); a day without an entry gets no label. Ignored by the monthly preset. */
  labels: Record<string, string>;
  autoRename: boolean;
  /** Source libraries the user turned off. */
  excludedLibraryIds: string[];
  /** Paths that already exist in the date folders of the target. */
  occupied: Set<string>;
  /** Photos known to have the same content as the file standing in their way. */
  identicalIds: Set<string>;
}

export interface ReorganizeFile {
  from: string;
  to: string;
}

export interface ReorganizeItem {
  assetId: string;
  action: ReorganizeAction;
  reason?: ReorganizeSkipReason;
  conflict?: ReorganizeConflict;
  /** `YYYY-MM-DD`, absent for photos skipped before a date was needed. */
  day?: string;
  /** The date folder, absolute. */
  folder?: string;
  fromLibraryId: string | null;
  original: ReorganizeFile;
  sidecar?: ReorganizeFile;
  liveVideo?: ReorganizeFile & { assetId: string };
  renamed: boolean;
}

const LABEL_MAX_LENGTH = 60;
// eslint-disable-next-line no-control-regex
const LABEL_FORBIDDEN = /[/\\\u{0}-\u{1F}\u{7F}]/u;
const DATE_FOLDER = /^(\d{4}-\d{2}-\d{2})(?: (.+))?$/;

/** The label as it goes into a folder name, or an error for one that cannot. */
export const normalizeLabel = (label: string): string => {
  const trimmed = label.trim();
  if (LABEL_FORBIDDEN.test(trimmed)) {
    throw new Error('A label cannot contain slashes or control characters');
  }
  if (trimmed.endsWith('.')) {
    throw new Error('A label cannot end with a dot');
  }
  if ([...trimmed].length > LABEL_MAX_LENGTH) {
    throw new Error(`A label cannot be longer than ${LABEL_MAX_LENGTH} characters`);
  }
  return trimmed;
};

/** The day of a photo, from its local time. */
export const getLocalDay = (localDateTime: Date): string => localDateTime.toISOString().slice(0, 10);

/** The date folder of a day, relative to the target. */
export const getDateFolder = (preset: ReorganizePreset, day: string, label: string): string => {
  const [year, month] = day.split('-', 2);
  const name = label ? `${day} ${label}` : day;
  switch (preset) {
    case 'year-month': {
      return join(year, month);
    }
    case 'year-day': {
      return join(year, name);
    }
    default: {
      return name;
    }
  }
};

/** Where the day folders of a day live, relative to the target; undefined for the monthly preset. */
export const getDayFolderParent = (preset: ReorganizePreset, day: string): string | undefined => {
  if (preset === 'year-month') {
    return;
  }
  return preset === 'year-day' ? day.slice(0, 4) : '';
};

/** The day and label of a folder named like a day folder. */
export const parseDayFolder = (name: string): { day: string; label: string } | undefined => {
  const match = DATE_FOLDER.exec(name);
  return match ? { day: match[1], label: match[2] ?? '' } : undefined;
};

/** `name-2.ext`, `name-3.ext`, … */
const withSuffix = (fileName: string, index: number): string => {
  const extension = extname(fileName);
  return `${fileName.slice(0, fileName.length - extension.length)}-${index}${extension}`;
};

/** The sidecar's new name, keeping whichever way it was named after the photo. */
const getSidecarName = (sidecarPath: string, fileName: string, newFileName: string): string => {
  const sidecarName = basename(sidecarPath);
  const extension = extname(sidecarName);
  const stem = (name: string) => name.slice(0, name.length - extname(name).length);
  if (sidecarName.slice(0, sidecarName.length - extension.length) === fileName) {
    return newFileName + extension;
  }
  if (stem(sidecarName) === stem(fileName)) {
    return stem(newFileName) + extension;
  }
  return sidecarName;
};

interface Candidate {
  asset: ReorganizeAsset;
  day: string;
  folder: string;
}

/**
 * Plans one reorganization: where each photo goes by its date, and which photos stay where they are and why.
 * Nothing is ever overwritten: a photo whose place is taken stays, or moves under a new name with `autoRename`.
 */
export const planReorganization = (assets: ReorganizeAsset[], options: ReorganizeOptions): ReorganizeItem[] => {
  const { userId, targetPath, targetLibraryId, preset, labels, autoRename, occupied, identicalIds } = options;
  const excluded = new Set(options.excludedLibraryIds);
  const items = new Map<string, ReorganizeItem>();
  const candidates: Candidate[] = [];

  const sidecarUsers = new Map<string, number>();
  for (const asset of assets) {
    if (asset.sidecarPath) {
      sidecarUsers.set(asset.sidecarPath, (sidecarUsers.get(asset.sidecarPath) ?? 0) + 1);
    }
  }

  const getSkipReason = (asset: ReorganizeAsset): ReorganizeSkipReason | undefined => {
    if (asset.ownerId !== userId) {
      return 'not-owner';
    }
    if (!asset.libraryId) {
      return 'internal';
    }
    if (asset.libraryOwnerId !== userId) {
      return 'other-owner-library';
    }
    if (asset.isTrashed && !asset.isOffline) {
      return 'trashed';
    }
    if (asset.isOffline) {
      return 'offline';
    }
    if (excluded.has(asset.libraryId)) {
      return 'library-excluded';
    }
    if (asset.dateFromExif !== true) {
      return 'unreliable-date';
    }
    if (asset.sidecarPath && sidecarUsers.get(asset.sidecarPath)! > 1) {
      return 'shared-sidecar';
    }
  };

  /** The files of a photo in its date folder, under their own names or all with the same `-index` suffix. */
  const getFiles = (asset: ReorganizeAsset, folder: string, index = 0) => {
    const currentName = basename(asset.originalPath);
    const rename = (name: string) => (index ? withSuffix(name, index) : name);
    const files: Pick<ReorganizeItem, 'original' | 'sidecar' | 'liveVideo'> = {
      original: { from: asset.originalPath, to: join(folder, rename(currentName)) },
    };
    if (asset.sidecarPath) {
      files.sidecar = {
        from: asset.sidecarPath,
        to: join(folder, getSidecarName(asset.sidecarPath, currentName, rename(currentName))),
      };
    }
    if (asset.liveVideo) {
      files.liveVideo = {
        assetId: asset.liveVideo.id,
        from: asset.liveVideo.originalPath,
        to: join(folder, rename(basename(asset.liveVideo.originalPath))),
      };
    }
    return files;
  };
  const destinations = (files: ReturnType<typeof getFiles>) =>
    [files.original, files.sidecar, files.liveVideo].filter((file) => file !== undefined);

  for (const asset of assets) {
    const base = { assetId: asset.id, fromLibraryId: asset.libraryId, renamed: false };
    const reason = getSkipReason(asset);
    if (reason) {
      items.set(asset.id, {
        ...base,
        action: 'skip',
        reason,
        original: { from: asset.originalPath, to: asset.originalPath },
      });
      continue;
    }

    const day = getLocalDay(asset.localDateTime);
    const folder = join(targetPath, getDateFolder(preset, day, preset === 'year-month' ? '' : (labels[day] ?? '')));
    if (dirname(asset.originalPath) === folder && asset.libraryId === targetLibraryId) {
      items.set(asset.id, {
        ...base,
        action: 'in-place',
        day,
        folder,
        ...getFiles(asset, folder),
      });
      continue;
    }
    candidates.push({ asset, day, folder });
  }

  // photos heading for the same place, in a fixed order so that the same one keeps its name every time
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates.toSorted((a, b) => a.asset.originalPath.localeCompare(b.asset.originalPath))) {
    const key = join(candidate.folder, basename(candidate.asset.originalPath));
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  // every path given away so far, so that two photos never get the same one
  const taken = new Set<string>();
  const isFree = (files: ReturnType<typeof getFiles>) =>
    destinations(files).every((file) => !occupied.has(file.to) && !taken.has(file.to));

  for (const group of groups.values()) {
    for (const { asset, day, folder } of group) {
      const base = { assetId: asset.id, fromLibraryId: asset.libraryId, day, folder };
      const files = getFiles(asset, folder);
      const conflict: ReorganizeConflict | undefined = isFree(files)
        ? undefined
        : group.length > 1 && destinations(files).every((file) => !occupied.has(file.to))
          ? 'same-target'
          : 'target-exists';
      const isCrowded = group.length > 1 && !autoRename;

      if (!conflict && !isCrowded) {
        for (const file of destinations(files)) {
          taken.add(file.to);
        }
        items.set(asset.id, { ...base, action: 'move', renamed: false, ...files });
        continue;
      }

      if (identicalIds.has(asset.id)) {
        items.set(asset.id, { ...base, action: 'skip', reason: 'identical', renamed: false, ...files });
        continue;
      }

      if (!autoRename) {
        items.set(asset.id, {
          ...base,
          action: 'conflict',
          conflict: conflict ?? 'same-target',
          renamed: false,
          ...files,
        });
        continue;
      }

      for (let index = 2; ; index++) {
        const renamedFiles = getFiles(asset, folder, index);
        if (isFree(renamedFiles)) {
          for (const file of destinations(renamedFiles)) {
            taken.add(file.to);
          }
          items.set(asset.id, {
            ...base,
            action: 'move',
            conflict: conflict ?? 'same-target',
            renamed: true,
            ...renamedFiles,
          });
          break;
        }
      }
    }
  }

  return assets.map((asset) => items.get(asset.id)!);
};

/** The photos whose content must be compared with what stands in their way, and what that is. */
export const getContentChecks = (
  items: ReorganizeItem[],
  occupied: Set<string>,
): Array<{ assetId: string; path: string; otherPath: string }> => {
  const checks: Array<{ assetId: string; path: string; otherPath: string }> = [];
  const keepers = new Map<string, string>();
  for (const item of items) {
    if (item.action === 'move' && !item.renamed) {
      keepers.set(item.original.to, item.original.from);
    }
  }

  for (const item of items) {
    if (!item.folder || item.action === 'in-place' || item.action === 'skip') {
      continue;
    }
    const wanted = join(item.folder, basename(item.original.from));
    if (occupied.has(wanted)) {
      checks.push({ assetId: item.assetId, path: item.original.from, otherPath: wanted });
    } else if (keepers.has(wanted) && keepers.get(wanted) !== item.original.from) {
      checks.push({ assetId: item.assetId, path: item.original.from, otherPath: keepers.get(wanted)! });
    }
  }
  return checks;
};
