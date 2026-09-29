import type { BurstDto } from '@immich/sdk';
import { getDefaultDecision, getRelativeSharpness, getSummary, pickPhoto } from './burst';

const burst = (duplicateId: string, sharpness: Array<number | null>): BurstDto => ({
  duplicateId,
  assets: sharpness.map((value, index) => ({
    id: `${duplicateId}-${index}`,
    localDateTime: '2024-05-01T10:00:00.000Z',
    sharpness: value,
  })),
  recommendedAssetId: `${duplicateId}-0`,
});

describe('pickPhoto', () => {
  const decision = getDefaultDecision(burst('a', [30, 10, 20]));

  it('should keep only the picked photo', () => {
    expect(pickPhoto(decision, 'a-2', false)).toEqual({ keep: ['a-2'], action: 'trash', isChanged: true });
  });

  it('should keep one more photo when adding', () => {
    expect(pickPhoto(decision, 'a-1', true).keep).toEqual(['a-0', 'a-1']);
  });

  it('should stop keeping a photo when adding it again', () => {
    expect(pickPhoto({ ...decision, keep: ['a-0', 'a-1'] }, 'a-0', true).keep).toEqual(['a-1']);
  });

  it('should never keep no photo', () => {
    expect(pickPhoto(decision, 'a-0', true).keep).toEqual(['a-0']);
  });
});

describe('getRelativeSharpness', () => {
  it('should compare to the sharpest photo', () => {
    const value = burst('a', [40, 10, null]);
    expect(value.assets.map(({ id }) => getRelativeSharpness(value, id))).toEqual([100, 25, 0]);
  });

  it('should be zero while no photo has a score', () => {
    expect(getRelativeSharpness(burst('a', [null, null]), 'a-0')).toBe(0);
  });
});

describe('getSummary', () => {
  it('should count the photos to trash and the bursts to stack', () => {
    const bursts = [burst('a', [1, 2, 3]), burst('b', [1, 2]), burst('c', [1, 2, 3, 4])];
    const summary = getSummary(bursts, {
      b: { keep: ['b-0'], action: 'stack', isChanged: true },
      c: { keep: ['c-0', 'c-1'], action: 'trash', isChanged: true },
    });
    expect(summary).toEqual({ trash: 2 + 2, stacks: 1 });
  });
});
