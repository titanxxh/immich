/**
 * Version of the sharpness score stored with each photo. Bump it when the algorithm changes, so stored
 * scores from the old algorithm are recomputed the next time they are shown.
 */
export const SHARPNESS_VERSION = 1;

/**
 * How sharp a greyscale image is: the variance of its 3×3 Laplacian. Only meaningful to compare frames
 * of the same scene, like the photos of a burst.
 */
export const getLaplacianVariance = (data: Uint8Array, width: number, height: number) => {
  let count = 0;
  let sum = 0;
  let sumOfSquares = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian = data[i - 1] + data[i + 1] + data[i - width] + data[i + width] - 4 * data[i];
      sum += laplacian;
      sumOfSquares += laplacian * laplacian;
      count++;
    }
  }

  if (count === 0) {
    return 0;
  }

  const mean = sum / count;
  return sumOfSquares / count - mean * mean;
};

/** The sharpest photo of a burst, or the first one while none has a score. */
export const getRecommendedAssetId = (assets: Array<{ id: string; sharpness: number | null }>) => {
  let best = assets[0];
  for (const asset of assets) {
    if ((asset.sharpness ?? -1) > (best.sharpness ?? -1)) {
      best = asset;
    }
  }
  return best.id;
};
