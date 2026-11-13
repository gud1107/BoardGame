import type { ExplainerScript } from "../types";
import { coyoteScript } from "./coyote";
import { dalmutiScript } from "./dalmuti";
import { noThanksScript } from "./noThanks";
import { perudoScript } from "./perudo";
import { buildSummaryScript } from "./summary";

/**
 * Hand-animated explainers (real card art, scripted example plays). Every
 * other game falls back to the auto-built 30초 룰북 version. To add one: write
 * `scripts/<game>.tsx` exporting an `ExplainerScript` and list it here.
 */
export const ANIMATED_EXPLAINERS: Record<string, ExplainerScript> = {
  dalmuti: dalmutiScript,
  coyote: coyoteScript,
  perudo: perudoScript,
  "no-thanks": noThanksScript,
};

const cache = new Map<string, ExplainerScript | null>();

export function getExplainerScript(gameId: string): ExplainerScript | null {
  if (ANIMATED_EXPLAINERS[gameId]) return ANIMATED_EXPLAINERS[gameId];
  if (!cache.has(gameId)) cache.set(gameId, buildSummaryScript(gameId));
  return cache.get(gameId) ?? null;
}
