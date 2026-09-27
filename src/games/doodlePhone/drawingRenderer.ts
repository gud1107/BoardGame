/**
 * Canvas rendering for the vector drawing model in drawing.ts. Shared by the
 * editor (DoodleCanvas), the static/animated viewer (DrawingView) and the
 * PNG export, so a drawing looks the same everywhere it appears.
 *
 * Every function takes a context whose transform already maps logical
 * canvas units (CANVAS_W × CANVAS_H) to device pixels — see `prepareContext`.
 */

import { BRUSH_SIZES, CANVAS_H, CANVAS_W, PALETTE, PAPER_COLOR, decodePoints, pointCount, type DrawOp, type Drawing, type Point } from "./drawing";

/** Sizes the canvas backing store for crisp output and installs the logical→device transform. */
export function prepareContext(canvas: HTMLCanvasElement, pixelScale: number): CanvasRenderingContext2D | null {
  const width = Math.round(CANVAS_W * pixelScale);
  const height = Math.round(CANVAS_H * pixelScale);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  return ctx;
}

export function clearToPaper(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = PALETTE[PAPER_COLOR];
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/** Draws a polyline (or a dot, for a single point) with round caps. */
export function strokePath(ctx: CanvasRenderingContext2D, color: number, sizeIndex: number, points: readonly Point[]): void {
  if (points.length === 0) return;
  const width = BRUSH_SIZES[sizeIndex] ?? BRUSH_SIZES[1];
  ctx.strokeStyle = PALETTE[color];
  ctx.fillStyle = PALETTE[color];
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Scanline flood fill in device pixels. The tolerance swallows the
 * anti-aliased fringe around strokes, otherwise a fill would leave a halo of
 * unfilled pixels along every line.
 */
export function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, color: number, tolerance = 48): void {
  const { width, height } = ctx.canvas;
  const scale = ctx.getTransform().a || 1;
  const sx = Math.min(width - 1, Math.max(0, Math.floor(x * scale)));
  const sy = Math.min(height - 1, Math.max(0, Math.floor(y * scale)));
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const start = (sy * width + sx) * 4;
  const target = [data[start], data[start + 1], data[start + 2]];
  const [r, g, b] = hexToRgb(PALETTE[color]);
  if (Math.abs(target[0] - r) + Math.abs(target[1] - g) + Math.abs(target[2] - b) === 0) return;

  const matches = (i: number) =>
    Math.abs(data[i] - target[0]) <= tolerance && Math.abs(data[i + 1] - target[1]) <= tolerance && Math.abs(data[i + 2] - target[2]) <= tolerance;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    if (visited[py * width + px]) continue;
    let left = px;
    while (left > 0 && !visited[py * width + left - 1] && matches((py * width + left - 1) * 4)) left--;
    let spanUp = false;
    let spanDown = false;
    for (let cx = left; cx < width; cx++) {
      const idx = py * width + cx;
      if (visited[idx] || !matches(idx * 4)) break;
      visited[idx] = 1;
      data[idx * 4] = r;
      data[idx * 4 + 1] = g;
      data[idx * 4 + 2] = b;
      data[idx * 4 + 3] = 255;
      for (const [ny, flagIsUp] of [
        [py - 1, true],
        [py + 1, false],
      ] as const) {
        if (ny < 0 || ny >= height) continue;
        const nIdx = ny * width + cx;
        const open = !visited[nIdx] && matches(nIdx * 4);
        const span = flagIsUp ? spanUp : spanDown;
        if (open && !span) stack.push(cx, ny);
        if (flagIsUp) spanUp = open;
        else spanDown = open;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function renderOp(ctx: CanvasRenderingContext2D, op: DrawOp, pointLimit = Infinity): void {
  if (op.k === "x") clearToPaper(ctx);
  else if (op.k === "f") floodFill(ctx, op.x, op.y, op.c);
  else strokePath(ctx, op.c, op.w, decodePoints(op.p).slice(0, pointLimit));
}

/** Replays a whole drawing from blank paper. */
export function renderDrawing(ctx: CanvasRenderingContext2D, drawing: Drawing): void {
  clearToPaper(ctx);
  for (const op of drawing.ops) renderOp(ctx, op);
}

/**
 * Progressive replay for animation (progress 0–1, measured in stroke points
 * like `pointCount`): finished ops are drawn once and never repainted, so a drawing
 * with many flood fills doesn't redo them every frame. Only the stroke that
 * is currently "being drawn" is repainted (over itself) as it grows.
 */
export function createDrawingAnimator(ctx: CanvasRenderingContext2D, drawing: Drawing): (progress: number) => void {
  const total = pointCount(drawing);
  let opIndex = 0;
  let consumed = 0;
  clearToPaper(ctx);
  return (progress) => {
    const budget = progress >= 1 ? Infinity : progress * total;
    while (opIndex < drawing.ops.length) {
      const op = drawing.ops[opIndex];
      const cost = op.k === "s" ? op.p.length / 2 : 1;
      if (consumed + cost <= budget) {
        renderOp(ctx, op);
        consumed += cost;
        opIndex++;
        continue;
      }
      if (op.k === "s") renderOp(ctx, op, Math.max(1, Math.floor(budget - consumed)));
      return;
    }
  };
}

/** PNG data URL of a drawing at `pixelScale` — used by the results screen's save button. */
export function drawingToPngDataUrl(drawing: Drawing, pixelScale = 2): string {
  const canvas = document.createElement("canvas");
  const ctx = prepareContext(canvas, pixelScale);
  if (!ctx) return "";
  renderDrawing(ctx, drawing);
  return canvas.toDataURL("image/png");
}
