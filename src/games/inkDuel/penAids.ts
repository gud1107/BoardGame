import { strokeLength, type Stroke } from "./analyze";

/**
 * Drawing aids shared by the weapon pad and the arena wall pen: a brush
 * cursor, snapping a new line onto a nearby line end, and rings that show
 * where a line can be continued from. All sizes are in the caller's canvas
 * units (pad px or world units) via `scale`.
 */

/** Brush-shaped mouse cursor dipped in the current ink; the hotspot is the bristle tip. */
export function brushCursor(ink: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M25 3 14.5 13.5" stroke="#6b4423" stroke-width="4" stroke-linecap="round"/><path d="M25 3 14.5 13.5" stroke="#a8743f" stroke-width="2" stroke-linecap="round"/><path d="m12.2 12.6 3.2 3.2-1.6 1.6-3.2-3.2z" fill="#c9ccd3" stroke="#555" stroke-width=".8"/><path d="M10.6 14.2c-3 .4-5 2.6-5.6 5.6L3 25l5.2-2c3-.6 5.2-2.6 5.6-5.6z" fill="${ink}" stroke="#222" stroke-width="1"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 25, crosshair`;
}

/** Ends of lines long enough to be continued (dots don't count). */
function lineEnds(strokes: readonly Stroke[], scale: number): [number, number][] {
  const out: [number, number][] = [];
  for (const s of strokes) {
    if (strokeLength(s) < 6 * scale) continue;
    out.push([s.p[0], s.p[1]], [s.p[s.p.length - 2], s.p[s.p.length - 1]]);
  }
  return out;
}

/** The closest line end within `dist`, or null. */
export function nearLineEnd(strokes: readonly Stroke[], x: number, y: number, dist: number, scale = 1): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = dist * dist;
  for (const [ex, ey] of lineEnds(strokes, scale)) {
    const d = (ex - x) ** 2 + (ey - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = [ex, ey];
    }
  }
  return best;
}

/**
 * Rings on line ends: a bold one on `hover` (the end a new stroke will snap
 * to), and — for touch screens, which have no hover — faint ones on every
 * end so you can see where to put your finger.
 */
export function drawJoinMarks(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], ink: string, scale: number, hover: [number, number] | null, showAll: boolean) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  if (showAll) {
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([2.5 * scale, 2 * scale]);
    for (const [x, y] of lineEnds(strokes, scale)) {
      ctx.beginPath();
      ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (hover) {
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([3 * scale, 2 * scale]);
    ctx.beginPath();
    ctx.arc(hover[0], hover[1], 8 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(hover[0], hover[1], 3 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** True on phones/tablets (no hover), so the faint all-ends rings show up front. */
export function prefersTouch(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
}
