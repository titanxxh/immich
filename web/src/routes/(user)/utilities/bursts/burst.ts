import type { BurstDto } from '@immich/sdk';

export type BurstAction = 'trash' | 'stack';

/** What to do with a burst: the photos to keep (the first one is the stack cover) and what to do with the rest. */
export type BurstDecision = { keep: string[]; action: BurstAction; isChanged: boolean };

export const getDefaultDecision = (burst: BurstDto): BurstDecision => ({
  keep: [burst.recommendedAssetId],
  action: 'trash',
  isChanged: false,
});

/** Keeps only this photo, or with `isAdding` also keeps it (or stops keeping it, but never the last one). */
export const pickPhoto = (decision: BurstDecision, assetId: string, isAdding: boolean): BurstDecision => {
  let keep = [assetId];
  if (isAdding) {
    keep = decision.keep.includes(assetId) ? decision.keep.filter((id) => id !== assetId) : [...decision.keep, assetId];
  }
  return { ...decision, keep: keep.length > 0 ? keep : decision.keep, isChanged: true };
};

/** Sharpness of each photo relative to the sharpest of the burst, 0–100. */
export const getRelativeSharpness = (burst: BurstDto, assetId: string) => {
  const top = Math.max(...burst.assets.map((asset) => asset.sharpness ?? 0));
  const sharpness = burst.assets.find((asset) => asset.id === assetId)?.sharpness ?? 0;
  return top > 0 ? Math.round((sharpness / top) * 100) : 0;
};

export const getSummary = (bursts: BurstDto[], decisions: Record<string, BurstDecision>) => {
  let trash = 0;
  let stacks = 0;
  for (const burst of bursts) {
    const decision = decisions[burst.duplicateId] ?? getDefaultDecision(burst);
    if (decision.action === 'trash') {
      trash += burst.assets.length - decision.keep.length;
    } else {
      stacks++;
    }
  }
  return { trash, stacks };
};
