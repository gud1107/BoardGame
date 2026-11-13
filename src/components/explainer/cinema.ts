import { clamp01, easeInOut, hash01 } from "./anim";
import type { Timeline } from "./timeline";

/**
 * "Production value" layer for explainer videos — pure functions of the
 * timeline clock, so seeking/scrubbing always lands on the exact frame:
 * scene transitions (crossfade inside a chapter, iris wipe between chapters),
 * a slow Ken Burns camera drift per scene, and the YouTube speed list.
 */

/** YouTube's speed presets. */
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 2;

export function clampSpeed(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, s)) * 100) / 100;
}

/** "보통" / "1.5×" / "0.25×". */
export function speedLabel(s: number): string {
  return s === 1 ? "보통" : `${clampSpeed(s)}×`;
}

/** Next preset up/down from `s` (Shift+> / Shift+<, like YouTube). */
export function stepSpeed(s: number, dir: 1 | -1): number {
  if (dir === 1) return SPEED_PRESETS.find((p) => p > s + 1e-6) ?? MAX_SPEED;
  return [...SPEED_PRESETS].reverse().find((p) => p < s - 1e-6) ?? MIN_SPEED;
}

/** Seconds the incoming scene takes to replace the outgoing one. */
export const CROSSFADE = 0.45;
export const IRIS = 0.7;

export interface Transition {
  /** Outgoing scene index (rendered frozen on its last frame underneath). */
  from: number;
  /** 0 → 1 reveal progress of the incoming scene. */
  p: number;
  kind: "fade" | "iris";
}

/** The transition in progress at timeline time `t`, if any. */
export function transitionAt(tl: Timeline, sceneIndex: number, local: number): Transition | null {
  if (sceneIndex <= 0) return null;
  const sc = tl.scenes[sceneIndex];
  const prev = tl.scenes[sceneIndex - 1];
  const kind = sc.chapterIndex !== prev.chapterIndex ? "iris" : "fade";
  const d = kind === "iris" ? IRIS : CROSSFADE;
  if (local >= d) return null;
  return { from: sceneIndex - 1, p: easeInOut(clamp01(local / d)), kind };
}

export interface Camera {
  scale: number;
  x: number;
  y: number;
}

/**
 * Slow push-in with a gentle drift, alternating direction per scene. Kept
 * tiny (≤2.5% zoom, ≤14px drift on the 1600×900 stage) so nothing placed
 * near the frame edge gets cropped.
 */
export function cameraAt(sceneIndex: number, local: number, dur: number): Camera {
  const p = easeInOut(clamp01(local / Math.max(dur, 0.001)));
  const dirX = hash01(sceneIndex * 3 + 1) < 0.5 ? -1 : 1;
  const dirY = hash01(sceneIndex * 7 + 2) < 0.5 ? -1 : 1;
  return { scale: 1 + 0.025 * p, x: dirX * 14 * p, y: dirY * 7 * p };
}

/** Floating light motes for the ambient layer: deterministic per index. */
export function moteAt(i: number, t: number): { x: number; y: number; r: number; o: number } {
  const speed = 8 + hash01(i * 13) * 18; // px/s upward
  const span = 900 + 200;
  const y = 1000 - ((hash01(i * 5) * span + t * speed) % span);
  const x = hash01(i * 11) * 1600 + Math.sin(t * 0.35 + i) * 30;
  const r = 6 + hash01(i * 17) * 22;
  const o = 0.05 + hash01(i * 19) * 0.1;
  return { x, y, r, o };
}
