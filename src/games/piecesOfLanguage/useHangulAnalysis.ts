"use client";

import { useMemo } from "react";
import { analyzeJamoUsage, type JamoUsage } from "./hangul";

/**
 * Memoized live jamo-usage breakdown for `text` (`WordInput.tsx`'s piece
 * counter) — thin `useMemo` wrapper around `hangul.ts`'s pure
 * `analyzeJamoUsage`, recomputed only when `text` itself changes so the
 * counter doesn't re-decompose the whole string on every unrelated re-render.
 */
export function useHangulAnalysis(text: string): JamoUsage {
  return useMemo(() => analyzeJamoUsage(text), [text]);
}
