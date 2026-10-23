/**
 * Local profile for 섬광전대 프리즘파이브 (browser-only): last hero/difficulty,
 * stage unlocks and per-stage best records. Corrupt saves fall back to fresh.
 */

import { HERO_ORDER, STAGES, type Difficulty, type HeroId } from "./data";
import type { StageSummary } from "./engine";

export interface StageBest {
  score: number;
  grade: "S" | "A" | "B" | "C";
  timeSec: number;
  hero: HeroId;
}

export interface PrismSave {
  version: 1;
  hero: HeroId;
  diff: Difficulty;
  /** Highest stage id the player may start (1..5). */
  unlocked: number;
  /** Key `${stage}-${diff}`. */
  best: Record<string, StageBest>;
  runs: number;
  clears: number;
  maxCombo: number;
  muted: boolean;
  noShake: boolean;
  reduceFlash: boolean;
  tipsDismissed: boolean;
}

const KEY = "prism-five-save-v1";

export function freshSave(): PrismSave {
  const calm = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return { version: 1, hero: "red", diff: "normal", unlocked: 1, best: {}, runs: 0, clears: 0, maxCombo: 0, muted: false, noShake: calm, reduceFlash: calm, tipsDismissed: false };
}

export function loadSave(): PrismSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const s = { ...freshSave(), ...(JSON.parse(raw) as Partial<PrismSave>) };
    if (!HERO_ORDER.includes(s.hero)) s.hero = "red";
    if (!["easy", "normal", "hard"].includes(s.diff)) s.diff = "normal";
    s.unlocked = Math.max(1, Math.min(STAGES.length, Math.floor(Number(s.unlocked) || 1)));
    if (typeof s.best !== "object" || !s.best) s.best = {};
    return s;
  } catch {
    return freshSave();
  }
}

export function writeSave(s: PrismSave) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / private mode */
  }
}

export const bestKey = (stage: number, diff: Difficulty) => `${stage}-${diff}`;

const GRADE_RANK = { S: 4, A: 3, B: 2, C: 1 } as const;

/** Folds one finished stage into the profile. */
export function applySummary(s: PrismSave, sum: StageSummary): { next: PrismSave; newBest: boolean; unlockedStage: number | null } {
  const key = bestKey(sum.stage, sum.diff);
  const prev = s.best[key];
  let newBest = false;
  const best = { ...s.best };
  if (sum.cleared && sum.grade !== "-") {
    if (!prev || sum.score > prev.score) {
      newBest = true;
      best[key] = { score: sum.score, grade: prev && GRADE_RANK[prev.grade] > GRADE_RANK[sum.grade] ? prev.grade : sum.grade, timeSec: prev ? Math.min(prev.timeSec, sum.timeSec) : sum.timeSec, hero: sum.hero };
    } else if (GRADE_RANK[sum.grade] > GRADE_RANK[prev.grade] || sum.timeSec < prev.timeSec) {
      best[key] = { ...prev, grade: GRADE_RANK[sum.grade] > GRADE_RANK[prev.grade] ? sum.grade : prev.grade, timeSec: Math.min(prev.timeSec, sum.timeSec) };
    }
  }
  const unlockTo = sum.cleared ? Math.min(STAGES.length, sum.stage + 1) : s.unlocked;
  const unlockedStage = unlockTo > s.unlocked ? unlockTo : null;
  return {
    next: { ...s, best, unlocked: Math.max(s.unlocked, unlockTo), runs: s.runs + 1, clears: s.clears + (sum.cleared ? 1 : 0), maxCombo: Math.max(s.maxCombo, sum.maxCombo) },
    newBest,
    unlockedStage,
  };
}
