/**
 * Shared shape of the three "one shot" physics puzzle books in 묘수 도장
 * (🎱 당구, 🥏 알까기, 🥌 컬링). Each book supplies an adapter: how to run a
 * shot through its game's deterministic physics, what the controls are, and
 * how to draw it. AimScreen.tsx does the rest (controls, playback, stars).
 *
 * Coordinates are the source game's own world units; the screen maps
 * `view` onto the canvas with +y pointing down.
 */

export interface Body {
  id: number;
  x: number;
  y: number;
  r: number;
  /** Fill colour. */
  color: string;
  /** Small label drawn on the body ("1", "8", "👑"). */
  label?: string;
  /** Outline colour (team marker / cue ball ring). */
  ring?: string;
  /** Can be picked as the shooter. */
  pickable?: boolean;
}

/** One kept frame: x, y per body in `bodies` order (NaN = gone). */
export type Frame = Float32Array;

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  /** Finest step (fine-tune buttons and rounding). */
  step: number;
  /** Coarse step (big buttons). */
  coarse: number;
  /** Wraps around (angles). */
  wrap?: boolean;
  unit?: string;
  /** Display formatter. */
  fmt?: (v: number) => string;
  /** Rendered as two buttons (−1 / +1) instead of a slider. */
  toggle?: [string, string];
}

export type Params = Record<string, number>;

export interface CondResult {
  label: string;
  ok: boolean;
}

export interface ShotOutcome {
  /** 0–3 stars earned by this shot. */
  stars: number;
  /** Per star tier: what was asked and whether it held. */
  tiers: CondResult[][];
  /** One-line summary for the result banner. */
  summary: string;
}

export interface ShotRun {
  frames: Frame[];
  /** Seconds per frame on playback. */
  frameDt: number;
  outcome: ShotOutcome;
  /** (frame index, kind, strength 0..1) — click sounds during playback. */
  hits: { f: number; kind: "ball" | "rail" | "fall" | "pot"; power: number }[];
}

export interface AimStage {
  id: string;
  title: string;
  /** One-line goal shown above the canvas. */
  goal: string;
  /** Star tiers in words (also drawn as the checklist). */
  tierText: [string, string, string];
  hint: string;
  /** A reference shot that earns ⭐⭐⭐ (tests prove it; "정답 보기" shows it). */
  solution: Params;
}

export interface AimAdapter<S extends AimStage> {
  /** World rect shown on the canvas. */
  view: { minX: number; maxX: number; minY: number; maxY: number };
  params: ParamSpec[];
  defaults(stage: S): Params;
  bodies(stage: S, params: Params): Body[];
  run(stage: S, params: Params): ShotRun;
  drawTable(ctx: CanvasRenderingContext2D, stage: S, px: (x: number, y: number) => [number, number], scale: number): void;
  /** Aim guide polyline(s) in world units for the current params. */
  guide(stage: S, params: Params): { pts: [number, number][]; dashed?: boolean; color?: string }[];
  /** Pointer drag on the table → new params (aim follows the pointer). */
  dragTo(stage: S, params: Params, wx: number, wy: number): Params;
  /** Picking a body (alkkagi shooter); return null when not pickable. */
  pick?(stage: S, params: Params, id: number): Params | null;
}

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

/** Stars = how many consecutive tiers (from the first) all hold. */
export function starsFrom(tiers: CondResult[][]): number {
  let s = 0;
  for (const t of tiers) {
    if (t.every((c) => c.ok)) s++;
    else break;
  }
  return s;
}

/** Snap to `step` and clamp/wrap into the spec's range. */
export function normParam(spec: ParamSpec, v: number): number {
  let x = Math.round(v / spec.step) * spec.step;
  if (spec.wrap) {
    const span = spec.max - spec.min;
    x = ((((x - spec.min) % span) + span) % span) + spec.min;
  } else x = Math.max(spec.min, Math.min(spec.max, x));
  return Number(x.toFixed(6));
}
