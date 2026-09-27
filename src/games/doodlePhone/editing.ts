/**
 * Geometry for the editor's select/move tool — pure, no DOM, so it's unit
 * tested. Works on the vector ops from drawing.ts:
 *
 * - Selectable: strokes and shapes (line/rect/ellipse). Fills and clears are
 *   pixel-level results of the ops before them, so they have no shape of
 *   their own to grab.
 * - Move: any selectable op. Resize: shapes only, by dragging a handle —
 *   the two endpoints of a line, the four corners of a rect/ellipse box.
 */

import { CANVAS_H, CANVAS_W, BRUSH_SIZES, decodePoints, isShapeOp, type DrawOp, type Point } from "./drawing";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Extra grab distance (logical px) around thin strokes and outlines. */
export const HIT_TOLERANCE = 8;
/** Handles are grabbed within this radius (logical px). */
export const HANDLE_RADIUS = 10;

export type Handle = "p1" | "p2" | "nw" | "ne" | "sw" | "se";

export function isSelectable(op: DrawOp): boolean {
  return op.k === "s" || isShapeOp(op);
}

function halfWidth(op: DrawOp): number {
  return "w" in op ? (BRUSH_SIZES[op.w] ?? BRUSH_SIZES[1]) / 2 : 0;
}

export function opBounds(op: DrawOp): Bounds | null {
  if (isShapeOp(op)) {
    const [x1, y1, x2, y2] = op.p;
    return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
  }
  if (op.k !== "s") return null;
  const points = decodePoints(op.p);
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether `p` lands on the visible ink of `op` (inside a filled shape, or near a line/outline/stroke). */
export function hitsOp(op: DrawOp, p: Point, tolerance = HIT_TOLERANCE): boolean {
  const reach = halfWidth(op) + tolerance;
  if (op.k === "s") {
    const pts = decodePoints(op.p);
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach;
    return pts.slice(1).some((pt, i) => distanceToSegment(p, pts[i], pt) <= reach);
  }
  if (!isShapeOp(op)) return false;
  const [x1, y1, x2, y2] = op.p;
  if (op.k === "l") return distanceToSegment(p, { x: x1, y: y1 }, { x: x2, y: y2 }) <= reach;
  const b = opBounds(op)!;
  if (op.k === "r") {
    const inside = p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
    if (op.f === 1) return inside || nearRectEdge(p, b, reach);
    return nearRectEdge(p, b, reach);
  }
  // Ellipse: compare the normalized radius with 1 (inside < 1 < outside).
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rx = Math.max(1, (b.maxX - b.minX) / 2);
  const ry = Math.max(1, (b.maxY - b.minY) / 2);
  const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
  if (op.f === 1 && r <= 1) return true;
  return Math.abs(r - 1) * Math.min(rx, ry) <= reach;
}

function nearRectEdge(p: Point, b: Bounds, reach: number): boolean {
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  return corners.some((c, i) => distanceToSegment(p, c, corners[(i + 1) % 4]) <= reach);
}

/** Index of the topmost selectable op under `p`, searching only `ops[from..]` (the base layer is off-limits), or -1. */
export function hitTest(ops: readonly DrawOp[], p: Point, from = 0): number {
  for (let i = ops.length - 1; i >= from; i--) {
    if (isSelectable(ops[i]) && hitsOp(ops[i], p)) return i;
  }
  return -1;
}

export function handlesFor(op: DrawOp): { id: Handle; at: Point }[] {
  if (!isShapeOp(op)) return [];
  const [x1, y1, x2, y2] = op.p;
  if (op.k === "l") {
    return [
      { id: "p1", at: { x: x1, y: y1 } },
      { id: "p2", at: { x: x2, y: y2 } },
    ];
  }
  const b = opBounds(op)!;
  return [
    { id: "nw", at: { x: b.minX, y: b.minY } },
    { id: "ne", at: { x: b.maxX, y: b.minY } },
    { id: "sw", at: { x: b.minX, y: b.maxY } },
    { id: "se", at: { x: b.maxX, y: b.maxY } },
  ];
}

export function handleAt(op: DrawOp, p: Point): Handle | null {
  return handlesFor(op).find((h) => Math.hypot(h.at.x - p.x, h.at.y - p.y) <= HANDLE_RADIUS)?.id ?? null;
}

/**
 * `op` shifted by (dx, dy). Shapes are clamped so their box stays on the
 * sheet (shape corners must be on-canvas to validate); a stroke only needs
 * its absolute first point shifted, since the rest are deltas.
 */
export function translateOp(op: DrawOp, dx: number, dy: number): DrawOp {
  const b = opBounds(op);
  if (!b) return op;
  const cdx = Math.round(Math.min(CANVAS_W - b.maxX, Math.max(-b.minX, dx)));
  const cdy = Math.round(Math.min(CANVAS_H - b.maxY, Math.max(-b.minY, dy)));
  if (op.k === "s") return { ...op, p: [op.p[0] + cdx, op.p[1] + cdy, ...op.p.slice(2)] };
  if (isShapeOp(op)) {
    const [x1, y1, x2, y2] = op.p;
    return { ...op, p: [x1 + cdx, y1 + cdy, x2 + cdx, y2 + cdy] };
  }
  return op;
}

/** A shape with one handle dragged to `to` (clamped to the sheet). Non-shapes are returned unchanged. */
export function resizeShape(op: DrawOp, handle: Handle, to: Point): DrawOp {
  if (!isShapeOp(op)) return op;
  const x = Math.round(Math.min(CANVAS_W, Math.max(0, to.x)));
  const y = Math.round(Math.min(CANVAS_H, Math.max(0, to.y)));
  const [x1, y1, x2, y2] = op.p;
  if (op.k === "l") return { ...op, p: handle === "p1" ? [x, y, x2, y2] : [x1, y1, x, y] };
  const b = opBounds(op)!;
  // Keep the opposite corner fixed.
  const fixed = { nw: { x: b.maxX, y: b.maxY }, ne: { x: b.minX, y: b.maxY }, sw: { x: b.maxX, y: b.minY }, se: { x: b.minX, y: b.minY } }[handle as "nw" | "ne" | "sw" | "se"];
  if (!fixed) return op;
  return { ...op, p: [fixed.x, fixed.y, x, y] };
}

// ---------------------------------------------------------------------------
// Multi-selection
// ---------------------------------------------------------------------------

export function unionBounds(ops: readonly DrawOp[]): Bounds | null {
  const all = ops.map(opBounds).filter((b): b is Bounds => b !== null);
  if (all.length === 0) return null;
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
}

/** Normalized box from two drag corners. */
export function boxFrom(a: Point, b: Point): Bounds {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/** Indices of selectable ops in `ops[from..]` whose bounds touch `box` — the marquee (drag-to-select) rule. */
export function opsInBox(ops: readonly DrawOp[], box: Bounds, from = 0): number[] {
  const hits: number[] = [];
  for (let i = from; i < ops.length; i++) {
    const b = isSelectable(ops[i]) ? opBounds(ops[i]) : null;
    if (b && b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY) hits.push(i);
  }
  return hits;
}

/**
 * `ops` with every op at `indices` shifted by the same (dx, dy). The shift is
 * clamped on the group's combined bounds, so the whole selection stops at the
 * sheet edge together instead of each piece clamping on its own and the
 * arrangement getting squashed.
 */
export function translateGroup(ops: readonly DrawOp[], indices: readonly number[], dx: number, dy: number): DrawOp[] {
  const chosen = new Set(indices);
  const b = unionBounds(ops.filter((_, i) => chosen.has(i)));
  if (!b) return [...ops];
  const cdx = Math.round(Math.min(CANVAS_W - b.maxX, Math.max(-b.minX, dx)));
  const cdy = Math.round(Math.min(CANVAS_H - b.maxY, Math.max(-b.minY, dy)));
  return ops.map((op, i) => (chosen.has(i) ? translateOp(op, cdx, cdy) : op));
}
