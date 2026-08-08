import * as THREE from "three";
import type { DiceColorway } from "./colorways";

/**
 * Draws one die face onto a small offscreen `<canvas>` and hands it back as
 * a `THREE.CanvasTexture` — this project's perudo game deliberately ships
 * with **no external image assets** (see `PerudoFaceIcon.tsx`'s header
 * comment: "순수 인라인 SVG 아이콘"), and that constraint carries over here:
 * every die face is procedurally drawn, not loaded from a PNG/GLB. The
 * skull-mark path data below is a 1:1 port of `PerudoFaceIcon.tsx`'s SVG
 * paths (same 100x100 coordinate space) so the WebGL die's face-1 mark and
 * the flat 2D icon used elsewhere (face picker, rulebook, badges) stay
 * visually identical.
 *
 * Textures are cached per `(colorway, face)` pair at module scope — a full
 * 8-player table can have dozens of simultaneous `DiceMesh` instances, and
 * without this cache every one of them would repaint and re-upload its own
 * canvas to the GPU.
 */

const TEX_SIZE = 256;
const cache = new Map<string, THREE.CanvasTexture>();

const PIP_LAYOUT: Record<number, [number, number][]> = {
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

function drawPips(ctx: CanvasRenderingContext2D, value: number, ink: string) {
  const cells = PIP_LAYOUT[value];
  if (!cells) return;
  const pad = TEX_SIZE * 0.2;
  const span = TEX_SIZE - pad * 2;
  const r = TEX_SIZE * 0.09;
  ctx.fillStyle = ink;
  for (const [col, row] of cells) {
    const cx = pad + (span * col) / 2;
    const cy = pad + (span * row) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Port of `PerudoFaceIcon.tsx`'s skull-mark SVG paths onto a 2D canvas context (same 0-100 coordinate space, scaled by `s`). */
function drawPerudoMark(ctx: CanvasRenderingContext2D, ink: string) {
  const s = TEX_SIZE / 100;
  ctx.save();
  ctx.scale(s, s);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // outer ring
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(50, 50, 45, 0, Math.PI * 2);
  ctx.stroke();

  // eye sockets
  ctx.beginPath();
  ctx.arc(33, 41, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(67, 41, 12, 0, Math.PI * 2);
  ctx.fill();

  // nose
  ctx.beginPath();
  ctx.moveTo(50, 50);
  ctx.lineTo(44, 62);
  ctx.lineTo(56, 62);
  ctx.closePath();
  ctx.fill();

  // jagged grin
  ctx.lineWidth = 7.5;
  ctx.beginPath();
  const grin: [number, number][] = [
    [22, 72],
    [30, 82],
    [38, 72],
    [46, 82],
    [54, 72],
    [62, 82],
    [70, 72],
    [78, 82],
  ];
  ctx.moveTo(grin[0][0], grin[0][1]);
  for (const [x, y] of grin.slice(1)) ctx.lineTo(x, y);
  ctx.stroke();

  ctx.restore();
}

function paint(colorway: DiceColorway, face: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;

  // body fill + a very soft vignette so the flat texture reads as a lacquered surface rather than a flat sticker
  ctx.fillStyle = colorway.body;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  const vignette = ctx.createRadialGradient(
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.2,
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.72,
  );
  vignette.addColorStop(0, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  if (face === 1) {
    drawPerudoMark(ctx, colorway.ink);
  } else {
    drawPips(ctx, face, colorway.ink);
  }
  return canvas;
}

/** Cached `(colorway, face)` → `CanvasTexture`. `face` may be 1-6 (a real die value) or 0 for a plain/blank body (used for the hidden dice-back cube, which shows no pips on any face). */
export function getDiceFaceTexture(colorway: DiceColorway, face: 0 | 1 | 2 | 3 | 4 | 5 | 6): THREE.CanvasTexture {
  const key = `${colorway.id}:${face}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = face === 0 ? paintBlank(colorway) : paint(colorway, face);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

function paintBlank(colorway: DiceColorway): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colorway.body;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  return canvas;
}
