import { findDensestPoint, getDirectory, groupUnlocated } from 'src/utils/locate';
import { describe, expect, it } from 'vitest';

const asset = (id: string, time: string) => ({ id, localDateTime: new Date(`${time}Z`) });

describe(groupUnlocated.name, () => {
  it('should group photos taken within 3 hours of each other', () => {
    const { groups, scattered } = groupUnlocated([
      asset('a', '2025-05-01T09:00:00'),
      asset('b', '2025-05-01T11:00:00'),
      asset('c', '2025-05-01T13:30:00'),
      asset('d', '2025-05-01T20:00:00'),
      asset('e', '2025-05-01T20:10:00'),
      asset('f', '2025-05-01T20:20:00'),
    ]);

    expect(groups.map((group) => group.assetIds)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    expect(groups[0].startAt.toISOString()).toBe('2025-05-01T09:00:00.000Z');
    expect(groups[0].endAt.toISOString()).toBe('2025-05-01T13:30:00.000Z');
    expect(scattered).toEqual([]);
  });

  it('should keep groups across midnight together', () => {
    const { groups } = groupUnlocated([
      asset('a', '2025-05-01T23:00:00'),
      asset('b', '2025-05-02T00:30:00'),
      asset('c', '2025-05-02T01:00:00'),
    ]);

    expect(groups).toHaveLength(1);
  });

  it('should list runs of fewer than 3 photos as scattered', () => {
    const { groups, scattered } = groupUnlocated([
      asset('b', '2025-05-02T09:00:00'),
      asset('a', '2025-05-01T09:00:00'),
      asset('c', '2025-05-02T09:10:00'),
    ]);

    expect(groups).toEqual([]);
    expect(scattered.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });
});

describe(findDensestPoint.name, () => {
  it('should pick the centre of the grid cell with the most points', () => {
    const point = findDensestPoint([
      { latitude: 31.2001, longitude: 121.5001 },
      { latitude: 31.2003, longitude: 121.5003 },
      { latitude: 30.1, longitude: 120.1 },
    ]);

    expect(point?.latitude).toBeCloseTo(31.2002, 4);
    expect(point?.longitude).toBeCloseTo(121.5002, 4);
  });

  it('should find nothing without points', () => {
    expect(findDensestPoint([])).toBeUndefined();
  });
});

describe(getDirectory.name, () => {
  it('should return the folder of a path', () => {
    expect(getDirectory('/external/Photos/2024/a.jpg')).toBe('/external/Photos/2024');
    expect(getDirectory('a.jpg')).toBe('');
  });
});
