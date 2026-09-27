/**
 * Vector drawing model for 그림 전화기 — pure data + validation, no DOM.
 *
 * A drawing travels over Supabase Realtime as a list of operations instead
 * of a PNG data URL: a 480×360 PNG is easily 30–150KB and a full album
 * state-sync would blow past the broadcast payload limit, while the same
 * picture as quantized stroke points is a few KB. It also lets the showcase
 * replay the drawing stroke by stroke (drawingRenderer.ts).
 *
 * Coordinates are integers on a fixed logical canvas (CANVAS_W × CANVAS_H);
 * each device renders that at whatever pixel size fits its screen.
 */

export const CANVAS_W = 480;
export const CANVAS_H = 360;

/** Index 0 is the paper color — the eraser is just a stroke in color 0. */
export const PALETTE: readonly string[] = [
  "#ffffff", "#000000", "#6b7280", "#d1d5db",
  "#7f1d1d", "#ef4444", "#f97316", "#fbbf24",
  "#fde68a", "#84cc16", "#16a34a", "#065f46",
  "#22d3ee", "#3b82f6", "#1e3a8a", "#8b5cf6",
  "#ec4899", "#f9a8d4", "#92400e", "#d6a77a",
];
export const PAPER_COLOR = 0;
export const INK_COLOR = 1;

/** Brush diameters in logical px, smallest to largest. */
export const BRUSH_SIZES: readonly number[] = [2, 5, 10, 18, 30];

/**
 * Upper bound on one serialized drawing. Supabase Realtime's broadcast
 * payload limit is 256KB on the free tier; one drawing rides alone in a
 * `game-action`, so 48KB leaves plenty of headroom. The editor shows this as
 * an "ink" gauge.
 */
export const MAX_DRAWING_CHARS = 48_000;

/**
 * - `s` stroke: `p` is [x0, y0, dx1, dy1, dx2, dy2, …] — the first point is
 *   absolute, the rest are deltas from the previous point (small numbers →
 *   short JSON).
 * - `f` flood fill at (x, y).
 * - `x` clear the whole canvas to paper color.
 */
export type DrawOp =
  | { readonly k: "s"; readonly c: number; readonly w: number; readonly p: readonly number[] }
  | { readonly k: "f"; readonly c: number; readonly x: number; readonly y: number }
  | { readonly k: "x" };

export interface Drawing {
  readonly v: 1;
  readonly ops: readonly DrawOp[];
}

export interface Point {
  x: number;
  y: number;
}

export const EMPTY_DRAWING: Drawing = { v: 1, ops: [] };

export function clampToCanvas(p: Point): Point {
  return {
    x: Math.min(CANVAS_W, Math.max(0, Math.round(p.x))),
    y: Math.min(CANVAS_H, Math.max(0, Math.round(p.y))),
  };
}

export function encodePoints(points: readonly Point[]): number[] {
  const out: number[] = [];
  let prev: Point | null = null;
  for (const raw of points) {
    const pt = clampToCanvas(raw);
    if (prev === null) out.push(pt.x, pt.y);
    else out.push(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
  }
  return out;
}

export function decodePoints(encoded: readonly number[]): Point[] {
  const points: Point[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    if (i === 0) {
      x = encoded[0];
      y = encoded[1];
    } else {
      x += encoded[i];
      y += encoded[i + 1];
    }
    points.push({ x, y });
  }
  return points;
}

export function strokeOp(color: number, sizeIndex: number, points: readonly Point[]): DrawOp {
  return { k: "s", c: color, w: sizeIndex, p: encodePoints(points) };
}

export function serializedLength(drawing: Drawing): number {
  return JSON.stringify(drawing).length;
}

/** Number of stroke points — the unit the showcase replay animates over. */
export function pointCount(drawing: Drawing): number {
  let n = 0;
  for (const op of drawing.ops) n += op.k === "s" ? op.p.length / 2 : 1;
  return n;
}

/** True when nothing visible was drawn (only erasing/clearing or no ops). */
export function isBlankDrawing(drawing: Drawing): boolean {
  return drawing.ops.every((op) => op.k === "x" || op.c === PAPER_COLOR);
}

function isInt(n: unknown, min: number, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
}

/**
 * Structural validation for a drawing received from the network. The engine
 * rejects anything that fails this, so a malformed or oversized payload from
 * one client can never desync or crash the others' renderers.
 */
export function isValidDrawing(value: unknown): value is Drawing {
  if (typeof value !== "object" || value === null) return false;
  const d = value as { v?: unknown; ops?: unknown };
  if (d.v !== 1 || !Array.isArray(d.ops)) return false;
  for (const op of d.ops as unknown[]) {
    if (typeof op !== "object" || op === null) return false;
    const o = op as Record<string, unknown>;
    if (o.k === "x") continue;
    if (!isInt(o.c, 0, PALETTE.length - 1)) return false;
    if (o.k === "f") {
      if (!isInt(o.x, 0, CANVAS_W) || !isInt(o.y, 0, CANVAS_H)) return false;
      continue;
    }
    if (o.k !== "s" || !isInt(o.w, 0, BRUSH_SIZES.length - 1)) return false;
    if (!Array.isArray(o.p) || o.p.length < 2 || o.p.length % 2 !== 0) return false;
    if (!o.p.every((n) => isInt(n, -CANVAS_W, CANVAS_W))) return false;
  }
  return serializedLength(value as Drawing) <= MAX_DRAWING_CHARS;
}
