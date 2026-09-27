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

/**
 * An op's color: a PALETTE index (compact — the usual case) or a free
 * `#rrggbb` from the color picker / eyedropper. `normalizeColor` turns a hex
 * that equals a palette entry back into its index, so picking a palette color
 * with the eyedropper doesn't grow the payload.
 */
export type ColorRef = number | string;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

export function isColorRef(value: unknown): value is ColorRef {
  return (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < PALETTE.length) || (typeof value === "string" && HEX_COLOR.test(value));
}

export function colorHex(color: ColorRef): string {
  return typeof color === "number" ? (PALETTE[color] ?? PALETTE[INK_COLOR]) : color;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeColor(color: ColorRef): ColorRef {
  if (typeof color === "number") return color;
  const hex = color.toLowerCase();
  const index = PALETTE.indexOf(hex);
  return index >= 0 ? index : hex;
}

/** Closest palette entry by RGB distance — lets palette-keyed logic (bot guesses, blank check) understand free colors. */
export function nearestPaletteIndex(color: ColorRef): number {
  if (typeof color === "number") return color;
  const [r, g, b] = hexToRgb(color);
  let best = 0;
  let bestDist = Infinity;
  PALETTE.forEach((hex, i) => {
    const [pr, pg, pb] = hexToRgb(hex);
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Brush diameters in logical px, smallest to largest. */
export const BRUSH_SIZES: readonly number[] = [2, 5, 10, 18, 30];

/**
 * Upper bound on one serialized drawing. Supabase Realtime's broadcast
 * payload limit is 256KB on the free tier; one drawing rides alone in a
 * `game-action`, so 48KB leaves plenty of headroom. The editor shows this as
 * an "ink" gauge.
 */
export const MAX_DRAWING_CHARS = 48_000;

/** Opacity range for `a` (percent). Omitted `a` means fully opaque, which keeps old drawings and payloads unchanged. */
export const MIN_OPACITY = 10;
export const MAX_OPACITY = 100;

export type ShapeKind = "l" | "r" | "e";

/**
 * - `s` stroke: `p` is [x0, y0, dx1, dy1, dx2, dy2, …] — the first point is
 *   absolute, the rest are deltas from the previous point (small numbers →
 *   short JSON).
 * - `f` flood fill at (x, y).
 * - `l` / `r` / `e` straight line / rectangle / ellipse: `p` is
 *   [x1, y1, x2, y2] (line ends, or the drag box for rect/ellipse); `f: 1`
 *   fills the shape instead of outlining it.
 * - `x` clear the whole canvas to paper color.
 *
 * `a` (10–100, percent) is the "연하게/짙게" opacity; the eraser never uses it.
 */
export type DrawOp =
  | { readonly k: "s"; readonly c: ColorRef; readonly w: number; readonly p: readonly number[]; readonly a?: number }
  | { readonly k: "f"; readonly c: ColorRef; readonly x: number; readonly y: number; readonly a?: number }
  | { readonly k: ShapeKind; readonly c: ColorRef; readonly w: number; readonly p: readonly number[]; readonly a?: number; readonly f?: 1 }
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

/** Only stores `a` when it isn't fully opaque. */
function withOpacity<T extends object>(op: T, opacity: number): T & { a?: number } {
  const a = Math.round(Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, opacity)));
  return a >= MAX_OPACITY ? op : { ...op, a };
}

export function strokeOp(color: ColorRef, sizeIndex: number, points: readonly Point[], opacity = MAX_OPACITY): DrawOp {
  return withOpacity({ k: "s" as const, c: normalizeColor(color), w: sizeIndex, p: encodePoints(points) }, opacity);
}

export function fillOp(color: ColorRef, at: Point, opacity = MAX_OPACITY): DrawOp {
  const p = clampToCanvas(at);
  return withOpacity({ k: "f" as const, c: normalizeColor(color), x: p.x, y: p.y }, opacity);
}

export function shapeOp(kind: ShapeKind, color: ColorRef, sizeIndex: number, from: Point, to: Point, opts: { opacity?: number; filled?: boolean } = {}): DrawOp {
  const a = clampToCanvas(from);
  const b = clampToCanvas(to);
  const op = { k: kind, c: normalizeColor(color), w: sizeIndex, p: [a.x, a.y, b.x, b.y], ...(opts.filled && kind !== "l" ? { f: 1 as const } : {}) };
  return withOpacity(op, opts.opacity ?? MAX_OPACITY);
}

export function isShapeOp(op: DrawOp): op is Extract<DrawOp, { k: ShapeKind }> {
  return op.k === "l" || op.k === "r" || op.k === "e";
}

/** 0..1 alpha of an op (1 when `a` is omitted). */
export function opAlpha(op: DrawOp): number {
  return "a" in op && op.a !== undefined ? op.a / 100 : 1;
}

export function serializedLength(drawing: Drawing): number {
  return JSON.stringify(drawing).length;
}

/** Number of stroke points — the unit the showcase replay animates over. */
export function pointCount(drawing: Drawing): number {
  let n = 0;
  for (const op of drawing.ops) n += opCost(op);
  return n;
}

/** Replay steps a shape is spread over, so the showcase draws it progressively like a stroke. */
export const SHAPE_REPLAY_STEPS = 24;

/** Replay cost of one op in "points": a stroke costs its points, a shape SHAPE_REPLAY_STEPS, fills/clears one step. */
export function opCost(op: DrawOp): number {
  if (op.k === "s") return op.p.length / 2;
  return isShapeOp(op) ? SHAPE_REPLAY_STEPS : 1;
}

/** True when nothing visible was drawn (only erasing/clearing or no ops). */
export function isBlankDrawing(drawing: Drawing): boolean {
  return drawing.ops.every((op) => op.k === "x" || colorHex(op.c) === PALETTE[PAPER_COLOR]);
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
    if (!isColorRef(o.c)) return false;
    if (o.a !== undefined && !isInt(o.a, MIN_OPACITY, MAX_OPACITY)) return false;
    if (o.k === "f") {
      if (!isInt(o.x, 0, CANVAS_W) || !isInt(o.y, 0, CANVAS_H)) return false;
      continue;
    }
    if (!isInt(o.w, 0, BRUSH_SIZES.length - 1) || !Array.isArray(o.p)) return false;
    if (o.k === "l" || o.k === "r" || o.k === "e") {
      if (o.p.length !== 4 || !isInt(o.p[0], 0, CANVAS_W) || !isInt(o.p[1], 0, CANVAS_H) || !isInt(o.p[2], 0, CANVAS_W) || !isInt(o.p[3], 0, CANVAS_H)) return false;
      if (o.f !== undefined && o.f !== 1) return false;
      continue;
    }
    if (o.k !== "s" || o.p.length < 2 || o.p.length % 2 !== 0) return false;
    if (!o.p.every((n) => isInt(n, -CANVAS_W, CANVAS_W))) return false;
  }
  return serializedLength(value as Drawing) <= MAX_DRAWING_CHARS;
}
