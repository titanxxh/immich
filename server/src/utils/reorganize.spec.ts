import {
  getContentChecks,
  getDateFolder,
  getDayFolderParent,
  normalizeLabel,
  parseDayFolder,
  planReorganization,
  ReorganizeAsset,
  ReorganizeOptions,
} from 'src/utils/reorganize';
import { describe, expect, it } from 'vitest';

const USER = 'user-1';
const LIBRARY = 'library-1';
const TARGET = '/external/photos/team';

const photo = (path: string, day = '2026-03-15', extra: Partial<ReorganizeAsset> = {}): ReorganizeAsset => ({
  id: path,
  ownerId: USER,
  libraryId: LIBRARY,
  libraryOwnerId: USER,
  originalPath: path,
  localDateTime: new Date(`${day}T10:00:00Z`),
  dateFromExif: true,
  isOffline: false,
  isTrashed: false,
  sidecarPath: null,
  liveVideo: null,
  ...extra,
});

const plan = (assets: ReorganizeAsset[], options: Partial<ReorganizeOptions> = {}) =>
  planReorganization(assets, {
    userId: USER,
    targetPath: TARGET,
    targetLibraryId: LIBRARY,
    preset: 'day',
    labels: {},
    autoRename: false,
    excludedLibraryIds: [],
    occupied: new Set(),
    identicalIds: new Set(),
    ...options,
  });

describe(normalizeLabel.name, () => {
  it('should trim a label', () => {
    expect(normalizeLabel('  match ')).toBe('match');
  });

  it.each(['a/b', String.raw`a\b`, 'a\nb', 'match.', 'x'.repeat(61)])('should refuse %j', (label) => {
    expect(() => normalizeLabel(label)).toThrow();
  });

  it('should count characters rather than bytes', () => {
    expect(normalizeLabel('比'.repeat(60))).toHaveLength(60);
  });
});

describe(getDateFolder.name, () => {
  it('should name the folder of each preset', () => {
    expect(getDateFolder('year-month', '2026-09-27', '')).toBe('2026/09');
    expect(getDateFolder('day', '2026-09-27', '')).toBe('2026-09-27');
    expect(getDateFolder('year-day', '2026-09-27', '')).toBe('2026/2026-09-27');
  });

  it('should add the label to a day folder', () => {
    expect(getDateFolder('day', '2026-09-27', 'match')).toBe('2026-09-27 match');
    expect(getDateFolder('year-day', '2026-09-27', 'match')).toBe('2026/2026-09-27 match');
  });
});

describe(getDayFolderParent.name, () => {
  it('should say where day folders live', () => {
    expect(getDayFolderParent('day', '2026-09-27')).toBe('');
    expect(getDayFolderParent('year-day', '2026-09-27')).toBe('2026');
    expect(getDayFolderParent('year-month', '2026-09-27')).toBeUndefined();
  });
});

describe(parseDayFolder.name, () => {
  it('should read the day and label of a folder', () => {
    expect(parseDayFolder('2026-09-27')).toEqual({ day: '2026-09-27', label: '' });
    expect(parseDayFolder('2026-09-27 match day')).toEqual({ day: '2026-09-27', label: 'match day' });
    expect(parseDayFolder('holiday')).toBeUndefined();
    expect(parseDayFolder('2026-09')).toBeUndefined();
  });
});

describe(planReorganization.name, () => {
  it('should move photos into the folder of their day', () => {
    const [a, b] = plan([photo(`${TARGET}/IMG_1.CR2`), photo(`${TARGET}/IMG_2.CR2`, '2026-03-14')]);

    expect(a).toMatchObject({ action: 'move', day: '2026-03-15', original: { to: `${TARGET}/2026-03-15/IMG_1.CR2` } });
    expect(b).toMatchObject({ action: 'move', day: '2026-03-14', original: { to: `${TARGET}/2026-03-14/IMG_2.CR2` } });
  });

  it('should use the local day, not the UTC day of the moment', () => {
    const [item] = plan([photo(`${TARGET}/a.jpg`, '2026-03-15', { localDateTime: new Date('2026-03-15T23:59:00Z') })]);

    expect(item.day).toBe('2026-03-15');
  });

  it('should put the label in the folder name, except for the monthly preset', () => {
    const asset = photo(`${TARGET}/a.jpg`);

    expect(plan([asset], { labels: { '2026-03-15': 'match' } })[0].folder).toBe(`${TARGET}/2026-03-15 match`);
    expect(plan([asset], { preset: 'year-day', labels: { '2026-03-15': 'match' } })[0].folder).toBe(
      `${TARGET}/2026/2026-03-15 match`,
    );
    expect(plan([asset], { preset: 'year-month', labels: { '2026-03-15': 'match' } })[0].folder).toBe(
      `${TARGET}/2026/03`,
    );
  });

  it('should leave a photo already in its folder', () => {
    const [item] = plan([photo(`${TARGET}/2026-03-15/a.jpg`)]);

    expect(item.action).toBe('in-place');
  });

  it('should move a photo in the right folder of another library', () => {
    const [item] = plan([photo(`${TARGET}/2026-03-15/a.jpg`, '2026-03-15', { libraryId: 'library-2' })]);

    expect(item.action).toBe('move');
  });

  it('should take the sidecar along, keeping how it is named', () => {
    const [a, b, c] = plan([
      photo('/external/in/a.CR2', '2026-03-15', { sidecarPath: '/external/in/a.CR2.xmp' }),
      photo('/external/in/b.CR2', '2026-03-15', { sidecarPath: '/external/in/b.xmp' }),
      photo('/external/in/c.CR2', '2026-03-15', { sidecarPath: '/external/in/notes.xmp' }),
    ]);

    expect(a.sidecar).toEqual({ from: '/external/in/a.CR2.xmp', to: `${TARGET}/2026-03-15/a.CR2.xmp` });
    expect(b.sidecar?.to).toBe(`${TARGET}/2026-03-15/b.xmp`);
    expect(c.sidecar?.to).toBe(`${TARGET}/2026-03-15/notes.xmp`);
  });

  it('should take the video of a live photo into the folder of the photo', () => {
    const [item] = plan([
      photo('/external/in/a.HEIC', '2026-03-15', { liveVideo: { id: 'video', originalPath: '/external/in/a.MOV' } }),
    ]);

    expect(item.liveVideo).toEqual({ assetId: 'video', from: '/external/in/a.MOV', to: `${TARGET}/2026-03-15/a.MOV` });
  });

  describe('skipped photos', () => {
    it.each([
      ['not-owner', { ownerId: 'user-2' }],
      ['internal', { libraryId: null, libraryOwnerId: null }],
      ['other-owner-library', { libraryOwnerId: 'user-2' }],
      ['offline', { isOffline: true, isTrashed: true }],
      ['trashed', { isTrashed: true }],
      ['unreliable-date', { dateFromExif: false }],
      ['unreliable-date', { dateFromExif: null }],
    ] as const)('should skip a photo that is %s', (reason, extra) => {
      const [item] = plan([photo('/external/in/a.jpg', '2026-03-15', extra)]);

      expect(item).toMatchObject({ action: 'skip', reason });
    });

    it('should skip the photos of a library that was turned off', () => {
      const [item] = plan([photo('/external/in/a.jpg')], { excludedLibraryIds: [LIBRARY] });

      expect(item).toMatchObject({ action: 'skip', reason: 'library-excluded' });
    });

    it('should skip photos that share one sidecar', () => {
      const items = plan([
        photo('/external/in/a.CR2', '2026-03-15', { sidecarPath: '/external/in/a.xmp' }),
        photo('/external/in/a.JPG', '2026-03-15', { sidecarPath: '/external/in/a.xmp' }),
      ]);

      expect(items.map((item) => item.reason)).toEqual(['shared-sidecar', 'shared-sidecar']);
    });
  });

  describe('a file already at the target', () => {
    const occupied = new Set([`${TARGET}/2026-03-15/a.jpg`]);

    it('should leave the photo where it is', () => {
      const [item] = plan([photo('/external/in/a.jpg')], { occupied });

      expect(item).toMatchObject({ action: 'conflict', conflict: 'target-exists', renamed: false });
    });

    it('should move the photo under a new name with auto rename', () => {
      const [item] = plan([photo('/external/in/a.jpg')], { occupied, autoRename: true });

      expect(item).toMatchObject({
        action: 'move',
        renamed: true,
        conflict: 'target-exists',
        original: { to: `${TARGET}/2026-03-15/a-2.jpg` },
      });
    });

    it('should take the first name that is free', () => {
      const [item] = plan([photo('/external/in/a.jpg')], {
        occupied: new Set([...occupied, `${TARGET}/2026-03-15/a-2.jpg`]),
        autoRename: true,
      });

      expect(item.original.to).toBe(`${TARGET}/2026-03-15/a-3.jpg`);
    });

    it('should skip a photo with the same content even with auto rename', () => {
      const [item] = plan([photo('/external/in/a.jpg')], {
        occupied,
        autoRename: true,
        identicalIds: new Set(['/external/in/a.jpg']),
      });

      expect(item).toMatchObject({ action: 'skip', reason: 'identical' });
    });

    it('should treat a sidecar in the way as a conflict of the photo', () => {
      const [item] = plan([photo('/external/in/b.CR2', '2026-03-15', { sidecarPath: '/external/in/b.CR2.xmp' })], {
        occupied: new Set([`${TARGET}/2026-03-15/b.CR2.xmp`]),
      });

      expect(item).toMatchObject({ action: 'conflict', conflict: 'target-exists' });
    });

    it('should rename the photo and its sidecar together', () => {
      const [a, b] = plan(
        [
          photo('/external/in/a.CR2', '2026-03-15', { sidecarPath: '/external/in/a.CR2.xmp' }),
          photo('/external/in/b.CR2', '2026-03-15', { sidecarPath: '/external/in/b.xmp' }),
        ],
        { occupied: new Set([`${TARGET}/2026-03-15/a.CR2`, `${TARGET}/2026-03-15/b.CR2`]), autoRename: true },
      );

      expect(a).toMatchObject({ original: { to: `${TARGET}/2026-03-15/a-2.CR2` } });
      expect(a.sidecar?.to).toBe(`${TARGET}/2026-03-15/a-2.CR2.xmp`);
      expect(b.sidecar?.to).toBe(`${TARGET}/2026-03-15/b-2.xmp`);
    });

    it('should keep the name of the photo already in place and rename the one coming in', () => {
      const inPlace = photo(`${TARGET}/2026-03-15/a.jpg`);
      const [first, second] = plan([inPlace, photo('/external/in/a.jpg')], { occupied, autoRename: true });

      expect(first.action).toBe('in-place');
      expect(second.original.to).toBe(`${TARGET}/2026-03-15/a-2.jpg`);
    });
  });

  describe('photos heading for the same place', () => {
    const assets = [photo('/external/in/phone/a.jpg'), photo('/external/in/camera/a.jpg')];

    it('should leave all of them where they are', () => {
      const items = plan(assets);

      expect(items.map((item) => [item.action, item.conflict])).toEqual([
        ['conflict', 'same-target'],
        ['conflict', 'same-target'],
      ]);
    });

    it('should keep the name of the first by path and rename the others with auto rename', () => {
      const [phone, camera] = plan(assets, { autoRename: true });

      expect(camera).toMatchObject({ action: 'move', renamed: false, original: { to: `${TARGET}/2026-03-15/a.jpg` } });
      expect(phone).toMatchObject({
        action: 'move',
        renamed: true,
        conflict: 'same-target',
        original: { to: `${TARGET}/2026-03-15/a-2.jpg` },
      });
    });

    it('should skip a copy of the one that keeps its name', () => {
      const [phone] = plan(assets, { autoRename: true, identicalIds: new Set(['/external/in/phone/a.jpg']) });

      expect(phone).toMatchObject({ action: 'skip', reason: 'identical' });
    });

    it('should not hand out the same new name twice', () => {
      const items = plan([...assets, photo('/external/in/tablet/a.jpg')], {
        autoRename: true,
        occupied: new Set([`${TARGET}/2026-03-15/a.jpg`]),
      });

      expect(items.map((item) => item.original.to).toSorted()).toEqual([
        `${TARGET}/2026-03-15/a-2.jpg`,
        `${TARGET}/2026-03-15/a-3.jpg`,
        `${TARGET}/2026-03-15/a-4.jpg`,
      ]);
    });

    it('should not mix up photos of different days with the same name', () => {
      const items = plan([photo('/external/in/1/a.jpg', '2026-03-14'), photo('/external/in/2/a.jpg', '2026-03-15')]);

      expect(items.map((item) => item.action)).toEqual(['move', 'move']);
    });
  });

  it('should return the items in the order of the photos', () => {
    const assets = [photo('/external/in/b.jpg'), photo('/external/in/a.jpg', '2026-03-15', { isOffline: true })];

    expect(plan(assets).map((item) => item.assetId)).toEqual(['/external/in/b.jpg', '/external/in/a.jpg']);
  });
});

describe(getContentChecks.name, () => {
  it('should compare a photo with the file at the target', () => {
    const occupied = new Set([`${TARGET}/2026-03-15/a.jpg`]);
    const items = plan([photo('/external/in/a.jpg'), photo('/external/in/b.jpg')], { occupied });

    expect(getContentChecks(items, occupied)).toEqual([
      { assetId: '/external/in/a.jpg', path: '/external/in/a.jpg', otherPath: `${TARGET}/2026-03-15/a.jpg` },
    ]);
  });

  it('should compare a renamed photo with the one that kept the name', () => {
    const items = plan([photo('/external/in/phone/a.jpg'), photo('/external/in/camera/a.jpg')], { autoRename: true });

    expect(getContentChecks(items, new Set())).toEqual([
      { assetId: '/external/in/phone/a.jpg', path: '/external/in/phone/a.jpg', otherPath: '/external/in/camera/a.jpg' },
    ]);
  });

  it('should have nothing to compare without conflicts', () => {
    expect(getContentChecks(plan([photo('/external/in/a.jpg')]), new Set())).toEqual([]);
  });
});
