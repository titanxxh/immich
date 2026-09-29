import { getLaplacianVariance, getRecommendedAssetId } from 'src/utils/burst';
import { describe, expect, it } from 'vitest';

const image = (width: number, height: number, pixel: (x: number, y: number) => number) => {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = pixel(x, y);
    }
  }
  return data;
};

describe('getLaplacianVariance', () => {
  it('should be zero for a flat image', () => {
    expect(
      getLaplacianVariance(
        image(8, 8, () => 128),
        8,
        8,
      ),
    ).toBe(0);
  });

  it('should be zero for a linear gradient', () => {
    expect(
      getLaplacianVariance(
        image(8, 8, (x) => x * 10),
        8,
        8,
      ),
    ).toBe(0);
  });

  it('should score hard edges above soft ones', () => {
    const sharp = image(16, 16, (x) => (x < 8 ? 0 : 255));
    const soft = image(16, 16, (x) => Math.max(0, Math.min(255, (x - 4) * 32)));
    expect(getLaplacianVariance(sharp, 16, 16)).toBeGreaterThan(getLaplacianVariance(soft, 16, 16));
  });

  it('should be zero for an image too small to have an inside', () => {
    expect(
      getLaplacianVariance(
        image(2, 2, (x) => x * 255),
        2,
        2,
      ),
    ).toBe(0);
  });
});

describe('getRecommendedAssetId', () => {
  it('should pick the sharpest photo', () => {
    expect(
      getRecommendedAssetId([
        { id: 'a', sharpness: 10 },
        { id: 'b', sharpness: 30 },
        { id: 'c', sharpness: 20 },
      ]),
    ).toBe('b');
  });

  it('should keep the earliest photo on a tie', () => {
    expect(
      getRecommendedAssetId([
        { id: 'a', sharpness: 30 },
        { id: 'b', sharpness: 30 },
      ]),
    ).toBe('a');
  });

  it('should pick the first photo while none has a score', () => {
    expect(
      getRecommendedAssetId([
        { id: 'a', sharpness: null },
        { id: 'b', sharpness: null },
      ]),
    ).toBe('a');
  });

  it('should prefer a scored photo over an unscored one', () => {
    expect(
      getRecommendedAssetId([
        { id: 'a', sharpness: null },
        { id: 'b', sharpness: 0 },
      ]),
    ).toBe('b');
  });
});
