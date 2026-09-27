/**
 * Canvas rendering for the vector drawing model in drawing.ts. Shared by the
 * editor (DoodleCanvas), the static/animated viewer (DrawingView) and the
 * PNG export, so a drawing looks the same everywhere it appears.
 *
 * Every function takes a context whose transform already maps logical
 * canvas units (CANVAS_W × CANVAS_H) to device pixels — see `prepareContext`.
 */

import {
  BRUSH_SIZES,
  CANVAS_H,
  CANVAS_W,
  PALETTE,
  PAPER_COLOR,
  SHAPE_REPLAY_STEPS,
  colorHex,
  decodePoints,
  hexToRgb,
  isShapeOp,
  opAlpha,
  opCost,
  pointCount,
  type ColorRef,
  type DrawOp,
  type Drawing,
  type Point,
} from "./drawing";

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

/**
 * Draws a polyline (or a dot, for a single point) with round caps. The whole
 * path is stroked once, so a translucent stroke stays even — drawing it
 * segment by segment would darken every joint where the caps overlap.
 */
export function strokePath(ctx: CanvasRenderingContext2D, color: ColorRef, sizeIndex: number, points: readonly Point[], alpha = 1): void {
  if (points.length === 0) return;
  const width = BRUSH_SIZES[sizeIndex] ?? BRUSH_SIZES[1];
  ctx.save();
  ctx.globalAlpha = alpha;
  drawPolyline(ctx, color, width, points);
  ctx.restore();
}

function drawPolyline(ctx: CanvasRenderingContext2D, color: ColorRef, width: number, points: readonly Point[]): void {
  ctx.strokeStyle = colorHex(color);
  ctx.fillStyle = colorHex(color);
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

/** Points along a polyline, cut off after `fraction` of its total length. */
function partialPolyline(points: readonly Point[], fraction: number): Point[] {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((sum, l) => sum + l, 0) * fraction;
  const out: Point[] = [points[0]];
  for (let i = 0; i < lengths.length; i++) {
    const next = points[i + 1];
    if (remaining >= lengths[i]) {
      out.push(next);
      remaining -= lengths[i];
      continue;
    }
    const t = lengths[i] === 0 ? 0 : remaining / lengths[i];
    out.push({ x: points[i].x + (next.x - points[i].x) * t, y: points[i].y + (next.y - points[i].y) * t });
    break;
  }
  return out;
}

/**
 * Line / rectangle / ellipse from a `ShapeKind` op; `f: 1` fills instead of
 * outlining. `fraction` < 1 (showcase replay) draws it being drawn: the line
 * grows, the rectangle's outline runs around its perimeter, the ellipse's arc
 * sweeps from 12 o'clock — and a filled shape is filled only once complete.
 */
function drawShape(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: "l" | "r" | "e" }>, fraction = 1): void {
  const [x1, y1, x2, y2] = op.p;
  const done = fraction >= 1;
  ctx.save();
  ctx.globalAlpha = opAlpha(op);
  ctx.strokeStyle = colorHex(op.c);
  ctx.fillStyle = colorHex(op.c);
  ctx.lineWidth = BRUSH_SIZES[op.w] ?? BRUSH_SIZES[1];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (op.k === "l") {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + (x2 - x1) * Math.min(1, fraction), y1 + (y2 - y1) * Math.min(1, fraction));
  } else if (op.k === "r") {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const right = Math.max(x1, x2);
    const bottom = Math.max(y1, y2);
    if (done) ctx.rect(left, top, right - left, bottom - top);
    else {
      const trace = partialPolyline(
        [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
          { x: left, y: top },
        ],
        fraction,
      );
      ctx.moveTo(trace[0].x, trace[0].y);
      for (const pt of trace.slice(1)) ctx.lineTo(pt.x, pt.y);
    }
  } else {
    const start = -Math.PI / 2;
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, start, start + Math.PI * 2 * Math.min(1, fraction));
  }
  if (done && op.f === 1 && op.k !== "l") ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

/**
 * Scanline flood fill in device pixels. The tolerance swallows the
 * anti-aliased fringe around strokes, otherwise a fill would leave a halo of
 * unfilled pixels along every line. With `alpha` < 1 the color is blended
 * over what was there ("연하게" fill), matching the region on its original
 * colors so the blend never feeds back into the match.
 */
export function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, color: ColorRef, alpha = 1, tolerance = 48): void {
  const { width, height } = ctx.canvas;
  const scale = ctx.getTransform().a || 1;
  const sx = Math.min(width - 1, Math.max(0, Math.floor(x * scale)));
  const sy = Math.min(height - 1, Math.max(0, Math.floor(y * scale)));
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const start = (sy * width + sx) * 4;
  const target = [data[start], data[start + 1], data[start + 2]];
  const [r, g, b] = hexToRgb(colorHex(color));
  if (alpha >= 1 && Math.abs(target[0] - r) + Math.abs(target[1] - g) + Math.abs(target[2] - b) === 0) return;
  const blend = (from: number, to: number) => Math.round(from + (to - from) * alpha);

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
      data[idx * 4] = blend(data[idx * 4], r);
      data[idx * 4 + 1] = blend(data[idx * 4 + 1], g);
      data[idx * 4 + 2] = blend(data[idx * 4 + 2], b);
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
  else if (op.k === "f") floodFill(ctx, op.x, op.y, op.c, opAlpha(op));
  else if (isShapeOp(op)) drawShape(ctx, op, Math.min(1, pointLimit / SHAPE_REPLAY_STEPS));
  else strokePath(ctx, op.c, op.w, decodePoints(op.p).slice(0, pointLimit), opAlpha(op));
}

/** Replays a whole drawing from blank paper. */
export function renderDrawing(ctx: CanvasRenderingContext2D, drawing: Drawing): void {
  clearToPaper(ctx);
  for (const op of drawing.ops) renderOp(ctx, op);
}

/**
 * Progressive replay for animation (progress 0–1, measured in `opCost` units
 * like `pointCount`). Finished ops are painted once onto an offscreen
 * snapshot; each frame shows the snapshot plus the op currently being drawn.
 * Repainting only the in-progress op on the visible canvas would stack it on
 * itself frame after frame and darken anything translucent.
 */
export function createDrawingAnimator(ctx: CanvasRenderingContext2D, drawing: Drawing): (progress: number) => void {
  const total = pointCount(drawing);
  const scale = ctx.getTransform().a || 1;
  const snapshotCanvas = document.createElement("canvas");
  const snapshot = prepareContext(snapshotCanvas, scale) ?? ctx;
  clearToPaper(snapshot);
  let opIndex = 0;
  let consumed = 0;
  return (progress) => {
    const budget = progress >= 1 ? Infinity : progress * total;
    while (opIndex < drawing.ops.length && consumed + opCost(drawing.ops[opIndex]) <= budget) {
      consumed += opCost(drawing.ops[opIndex]);
      renderOp(snapshot, drawing.ops[opIndex]);
      opIndex++;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(snapshotCanvas, 0, 0);
    ctx.restore();
    const current = drawing.ops[opIndex];
    if (current && current.k !== "f" && current.k !== "x") renderOp(ctx, current, Math.max(1, Math.floor(budget - consumed)));
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
