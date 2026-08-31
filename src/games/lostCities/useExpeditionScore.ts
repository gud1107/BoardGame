"use client";

import { useMemo } from "react";
import { calculateExpeditionBreakdown, type Card, type Color, type ExpeditionScoreBreakdown } from "./engine";

/**
 * Thin memoized wrapper over `engine.ts`'s pure `calculateExpeditionBreakdown`
 * for the real-time per-lane score HUD (`ExpeditionLane.tsx`). Kept as its
 * own hook (rather than calling the engine function inline) per the task
 * brief's explicit `useExpeditionScore.ts` file — the actual arithmetic
 * stays in the single source of truth (`engine.ts`), this just gives the UI
 * a React-idiomatic memoized entry point onto it.
 *
 * Per the confirmed answer to "8-card bonus HUD timing" (AskUserQuestion,
 * this session): `breakdown.bonus` is already `20` the instant `cards`
 * reaches 8 (mid-round, before the lane/game ends) — there is no separate
 * "final only" gate here, `calculateExpeditionBreakdown` is unconditionally
 * live.
 */
export function useExpeditionScore(color: Color, cards: readonly Card[]): ExpeditionScoreBreakdown {
  return useMemo(() => calculateExpeditionBreakdown(color, cards), [color, cards]);
}
