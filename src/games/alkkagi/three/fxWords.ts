/**
 * Collision word tiers (rulebook §13), shared by the 3D effects and the 2D
 * fallback — kept free of three.js so the 2D path does not load it.
 */

export type WordTier = 0 | 1 | 2;
export const WORDS: Record<WordTier, { word: string; fill: string; /** Min sprite height on screen (px). */ minPx: number; /** Design height (world units). */ world: number }> = {
  0: { word: "탁!", fill: "#fff6dc", minPx: 40, world: 1.2 },
  1: { word: "딱!", fill: "#ffd34d", minPx: 54, world: 1.6 },
  2: { word: "쾅!", fill: "#ff6b3d", minPx: 76, world: 2.4 },
};

/** Which word a hit gets: the knock-off hit is always 쾅, others top out at 딱. */
export function wordTier(k: number, fatal: boolean): WordTier | null {
  if (fatal) return 2;
  if (k > 0.55) return 1;
  if (k > 0.3) return 0;
  return null;
}
