/**
 * Coarse software rasterizer for the bot's eyes (bot.ts guessing). Paints a
 * drawing's ops onto a low-resolution grid of palette indices — strokes,
 * shapes and real 4-connected flood fills — so the bot can see where the
 * colored areas are instead of just counting ink per color. Pure, no DOM.
 *
 * Lines are 8-connected, so a 4-connected fill never leaks through a closed
 * outline even at this resolution.
 */

import { BRUSH_SIZES, CANVAS_H, CANVAS_W, PAPER_COLOR, decodePoints, isShapeOp, nearestPaletteIndex, type DrawOp, type Drawing, type Point } from "./drawing";

/** Logical px per grid cell. */
export const RASTER_CELL = 5;
export const RASTER_W = Math.ceil(CANVAS_W / RASTER_CELL);
export const RASTER_H = Math.ceil(CANVAS_H / RASTER_CELL);

/** Row-major palette indices, PAPER_COLOR where nothing was drawn. */
export type Raster = Uint8Array;

class Painter {
  readonly cells: Raster = new Uint8Array(RASTER_W * RASTER_H);

  private dot(cx: number, cy: number, r: number, color: number): void {
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= RASTER_H) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= RASTER_W || (x - cx) ** 2 + (y - cy) ** 2 > r * r + r) continue;
        this.cells[y * RASTER_W + x] = color;
      }
    }
  }

  /** Bresenham between two logical points. */
  segment(a: Point, b: Point, r: number, color: number): void {
    let x0 = Math.floor(a.x / RASTER_CELL);
    let y0 = Math.floor(a.y / RASTER_CELL);
    const x1 = Math.floor(b.x / RASTER_CELL);
    const y1 = Math.floor(b.y / RASTER_CELL);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.dot(x0, y0, r, color);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  polyline(points: readonly Point[], r: number, color: number): void {
    if (points.length === 1) this.segment(points[0], points[0], r, color);
    for (let i = 1; i < points.length; i++) this.segment(points[i - 1], points[i], r, color);
  }

  /** Every cell whose centre lies inside the box / ellipse. */
  solid(kind: "r" | "e", x1: number, y1: number, x2: number, y2: number, color: number): void {
    const [minX, maxX] = [Math.min(x1, x2), Math.max(x1, x2)];
    const [minY, maxY] = [Math.min(y1, y2), Math.max(y1, y2)];
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = Math.max(1, (maxX - minX) / 2);
    const ry = Math.max(1, (maxY - minY) / 2);
    for (let gy = Math.floor(minY / RASTER_CELL); gy <= Math.floor(maxY / RASTER_CELL) && gy < RASTER_H; gy++) {
      for (let gx = Math.floor(minX / RASTER_CELL); gx <= Math.floor(maxX / RASTER_CELL) && gx < RASTER_W; gx++) {
        const px = (gx + 0.5) * RASTER_CELL;
        const py = (gy + 0.5) * RASTER_CELL;
        if (kind === "e" && ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 > 1) continue;
        if (gx >= 0 && gy >= 0) this.cells[gy * RASTER_W + gx] = color;
      }
    }
  }

  flood(x: number, y: number, color: number): void {
    const gx = Math.min(RASTER_W - 1, Math.max(0, Math.floor(x / RASTER_CELL)));
    const gy = Math.min(RASTER_H - 1, Math.max(0, Math.floor(y / RASTER_CELL)));
    const target = this.cells[gy * RASTER_W + gx];
    if (target === color) return;
    const stack = [gy * RASTER_W + gx];
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (this.cells[i] !== target) continue;
      this.cells[i] = color;
      const cx = i % RASTER_W;
      if (cx > 0) stack.push(i - 1);
      if (cx < RASTER_W - 1) stack.push(i + 1);
      if (i >= RASTER_W) stack.push(i - RASTER_W);
      if (i < RASTER_W * (RASTER_H - 1)) stack.push(i + RASTER_W);
    }
  }
}

/** Brush radius in cells: hairlines and thin pens stay one cell wide. */
function radiusFor(sizeIndex: number): number {
  return Math.floor((BRUSH_SIZES[sizeIndex] ?? BRUSH_SIZES[1]) / (2 * RASTER_CELL) + 0.25);
}

function ellipseOutline(x1: number, y1: number, x2: number, y2: number): Point[] {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2;
  const ry = Math.abs(y2 - y1) / 2;
  return Array.from({ length: 33 }, (_, i) => ({ x: cx + Math.cos((i / 32) * Math.PI * 2) * rx, y: cy + Math.sin((i / 32) * Math.PI * 2) * ry }));
}

/** Paints `ops` (or the whole drawing) in order; `skip` leaves some ops out (e.g. animation scenery). */
export function rasterize(drawing: Drawing, skip: (op: DrawOp) => boolean = () => false): Raster {
  let painter = new Painter();
  for (const op of drawing.ops) {
    if (op.k === "x") {
      painter = new Painter();
      continue;
    }
    if (skip(op)) continue;
    const color = nearestPaletteIndex(op.c);
    if (op.k === "f") painter.flood(op.x, op.y, color);
    else if (op.k === "s") painter.polyline(decodePoints(op.p), radiusFor(op.w), color);
    else if (isShapeOp(op)) {
      const [x1, y1, x2, y2] = op.p;
      if (op.k === "l") painter.segment({ x: x1, y: y1 }, { x: x2, y: y2 }, radiusFor(op.w), color);
      else if (op.f === 1) painter.solid(op.k, x1, y1, x2, y2, color);
      else if (op.k === "e") painter.polyline(ellipseOutline(x1, y1, x2, y2), radiusFor(op.w), color);
      else painter.polyline([{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 }], radiusFor(op.w), color);
    }
  }
  return painter.cells;
}

export function isInk(color: number): boolean {
  return color !== PAPER_COLOR;
}
