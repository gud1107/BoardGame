"use client";

import * as THREE from "three";
import { paintedTexture } from "./tableKit";

/**
 * Painted "portrait" face layers for `RealisticPerson` — almond eyes with
 * gradient irises, catchlights and lash lines (wing + lashes + shadow for
 * the feminine look), cheek blush / contour, and full lips with a cupid's
 * bow and gloss in five expression shapes. Each layer is a transparent
 * canvas wrapped onto a slice of the head sphere, so expressions just swap
 * cached textures. Everything is keyed by the person's palette.
 */

export type Gender = "f" | "m";
export type EyeState = "open" | "closed" | "wide";
export type MouthShape = "flat" | "smile" | "grin" | "frown" | "o";

export interface FaceSpec {
  id: string;
  gender: Gender;
  skin: string;
  iris: string;
  lip: string;
  liner: string;
  shadow: string;
  blush: string;
}

/**
 * Eye band layout (canvas fractions), measured against RealisticPerson's slice
 * (phi ±0.55 rad on a ~0.1 m head, y −0.005…0.045): pupils ±0.031 m apart → ±0.286,
 * a 3 cm eye → 0.27 of the width, eye line at y 0.02 → halfway down.
 */
export const EYE_BAND = { w: 512, h: 256, eyeY: 0.5, eyeDX: 0.29, eyeW: 0.31 };

function shade(hex: string, k: number) {
  return "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();
}

function almond(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, outer: number) {
  // outer corner (temple side) sits a touch higher — the "lifted" almond
  const ox = cx + outer * w * 0.5;
  const ix = cx - outer * w * 0.5;
  ctx.beginPath();
  ctx.moveTo(ix, cy + h * 0.06);
  ctx.bezierCurveTo(ix + w * 0.18, cy - h * 0.62, ox - w * 0.28, cy - h * 0.66, ox, cy - h * 0.12);
  ctx.bezierCurveTo(ox - w * 0.22, cy + h * 0.5, ix + w * 0.24, cy + h * 0.52, ix, cy + h * 0.06);
  ctx.closePath();
}

function drawEye(ctx: CanvasRenderingContext2D, f: FaceSpec, cx: number, cy: number, side: 1 | -1, state: EyeState) {
  const W = EYE_BAND.w * EYE_BAND.eyeW;
  const H = W * (state === "wide" ? 0.6 : 0.5);
  const fem = f.gender === "f";
  // soft socket shadow + (feminine) eyeshadow above the lid
  const g = ctx.createRadialGradient(cx, cy - H * 0.35, H * 0.2, cx, cy - H * 0.2, W * 0.7);
  g.addColorStop(0, fem ? f.shadow : shade(f.skin, 0.8));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = fem ? 0.55 : 0.35;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy - H * 0.35, W * 0.62, H * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // lid crease
  ctx.strokeStyle = shade(f.skin, 0.66);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx + side * W * 0.04, cy - H * 0.18, W * 0.5, H * 0.95, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  if (state === "closed") {
    ctx.strokeStyle = "#1a120e";
    ctx.lineWidth = fem ? 7 : 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.5, cy);
    ctx.quadraticCurveTo(cx, cy + H * 0.42, cx + W * 0.5, cy - H * 0.05);
    ctx.stroke();
    if (fem)
      for (let i = 0; i < 7; i++) {
        const t = 0.15 + i * 0.12;
        const x = cx - W * 0.5 + W * t;
        const y = cy + Math.sin(Math.PI * t) * H * 0.2;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + side * 3, y + 10);
        ctx.stroke();
      }
    return;
  }

  ctx.save();
  almond(ctx, cx, cy, W, H, side);
  ctx.clip();
  // sclera with corner shading
  const sg = ctx.createRadialGradient(cx, cy, 2, cx, cy, W * 0.55);
  sg.addColorStop(0, "#fbf8f4");
  sg.addColorStop(1, "#d9cfc6");
  ctx.fillStyle = sg;
  ctx.fillRect(cx - W, cy - H, W * 2, H * 2);
  // iris: dark limbal ring → bright mid → warm centre
  const ir = H * (state === "wide" ? 0.42 : 0.5);
  const ig = ctx.createRadialGradient(cx, cy, ir * 0.15, cx, cy, ir);
  ig.addColorStop(0, shade(f.iris, 1.8));
  ig.addColorStop(0.55, f.iris);
  ig.addColorStop(0.9, shade(f.iris, 0.55));
  ig.addColorStop(1, "#120c08");
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(cx, cy + H * 0.04, ir, 0, Math.PI * 2);
  ctx.fill();
  // iris fibres
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * ir * 0.35, cy + H * 0.04 + Math.sin(a) * ir * 0.35);
    ctx.lineTo(cx + Math.cos(a) * ir * 0.85, cy + H * 0.04 + Math.sin(a) * ir * 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = "#0a0706";
  ctx.beginPath();
  ctx.arc(cx, cy + H * 0.04, ir * 0.38, 0, Math.PI * 2);
  ctx.fill();
  // upper-lid shadow falling on the eye
  const lg = ctx.createLinearGradient(0, cy - H * 0.6, 0, cy);
  lg.addColorStop(0, "rgba(40,20,10,0.55)");
  lg.addColorStop(1, "rgba(40,20,10,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(cx - W, cy - H, W * 2, H);
  // catchlights
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.ellipse(cx + ir * 0.32, cy - ir * 0.28, ir * 0.22, ir * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.arc(cx - ir * 0.3, cy + ir * 0.35, ir * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // lash line (thicker toward the outer corner) + feminine wing and lashes
  const ox = cx + side * W * 0.5;
  ctx.strokeStyle = f.liner;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = fem ? 8 : 5;
  ctx.beginPath();
  ctx.moveTo(cx - side * W * 0.5, cy + H * 0.06);
  ctx.bezierCurveTo(cx - side * W * 0.32, cy - H * 0.62, ox - side * W * 0.28, cy - H * 0.66, ox, cy - H * 0.12);
  if (fem) ctx.lineTo(ox + side * W * 0.16, cy - H * 0.5);
  ctx.stroke();
  if (fem) {
    ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const t = 0.25 + i * 0.085;
      const x = cx - side * W * 0.5 + side * W * t;
      const y = cy - Math.sin(Math.PI * Math.min(1, t)) * H * 0.58;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + side * 4, y - 9, x + side * (6 + i), y - 14 - i * 0.6);
      ctx.stroke();
    }
  }
  // lower lash line, soft
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - side * W * 0.4, cy + H * 0.2);
  ctx.quadraticCurveTo(cx, cy + H * 0.55, ox, cy - H * 0.05);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The eye band (eyes, shadow, blush/contour) for one eye state. */
export function eyeBandTexture(f: FaceSpec, state: EyeState): THREE.CanvasTexture {
  return paintedTexture(`glam:eyes:${f.id}:${state}`, EYE_BAND.w, EYE_BAND.h, (ctx, W, H) => {
    const cy = H * EYE_BAND.eyeY;
    drawEye(ctx, f, W * (0.5 - EYE_BAND.eyeDX), cy, -1, state);
    drawEye(ctx, f, W * (0.5 + EYE_BAND.eyeDX), cy, 1, state);
  });
}

/** The lower face (y −0.095…−0.005): cheek blush / contour, nose shading and full lips in one expression shape. */
export function mouthTexture(f: FaceSpec, shape: MouthShape): THREE.CanvasTexture {
  return paintedTexture(`glam:lower:${f.id}:${shape}`, 512, 384, (ctx, W, H) => {
    const fem = f.gender === "f";
    // soft blush high on the cheeks (feminine only — on the masculine face it read as spots)
    if (fem)
      for (const s of [-1, 1]) {
        const x = W * (0.5 + s * 0.36);
        const y = H * 0.14;
        const g = ctx.createRadialGradient(x, y, 2, x, y, W * 0.17);
        g.addColorStop(0, f.blush);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = g;
        ctx.fillRect(x - W * 0.18, y - H * 0.16, W * 0.36, H * 0.32);
      }
    ctx.globalAlpha = 1;
    // soft shadow under the nose and in the philtrum
    const ng = ctx.createRadialGradient(W / 2, H * 0.36, 2, W / 2, H * 0.36, W * 0.08);
    ng.addColorStop(0, "rgba(80,40,25,0.22)");
    ng.addColorStop(1, "rgba(80,40,25,0)");
    ctx.fillStyle = ng;
    ctx.fillRect(W * 0.4, H * 0.28, W * 0.2, H * 0.18);
    const cx = W / 2;
    const cy = H * 0.59;
    const w = W * (shape === "smile" || shape === "grin" ? (fem ? 0.56 : 0.52) : shape === "o" ? 0.3 : fem ? 0.5 : 0.46);
    const up = shape === "smile" || shape === "grin" ? -14 : shape === "frown" ? 12 : 0;
    const upper = fem ? 26 : 16;
    const lower = fem ? 34 : 21;
    const lipGrad = (y0: number, y1: number) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, shade(f.lip, 0.82));
      g.addColorStop(0.5, f.lip);
      g.addColorStop(1, shade(f.lip, 0.7));
      return g;
    };
    if (shape === "grin" || shape === "o") {
      const oh = shape === "o" ? 30 : 24;
      ctx.fillStyle = "#3a0d10";
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, w * 0.46, oh, 0, 0, Math.PI * 2);
      ctx.fill();
      if (shape === "grin") {
        ctx.fillStyle = "#f6f3ee";
        ctx.beginPath();
        ctx.roundRect(cx - w * 0.36, cy - oh * 0.78, w * 0.72, oh * 0.72, 8);
        ctx.fill();
      }
      ctx.lineWidth = upper * 0.8;
      ctx.strokeStyle = lipGrad(cy - oh - 8, cy + oh + 8);
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, w * 0.48, oh + 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = lipGrad(cy - upper - 4, cy);
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + up);
    ctx.bezierCurveTo(cx - w * 0.32, cy - upper * 0.7 + up * 0.4, cx - w * 0.16, cy - upper - 3, cx - w * 0.06, cy - upper + 1);
    ctx.quadraticCurveTo(cx, cy - upper + 7, cx + w * 0.06, cy - upper + 1);
    ctx.bezierCurveTo(cx + w * 0.16, cy - upper - 3, cx + w * 0.32, cy - upper * 0.7 + up * 0.4, cx + w / 2, cy + up);
    ctx.quadraticCurveTo(cx, cy + 4, cx - w / 2, cy + up);
    ctx.fill();
    ctx.fillStyle = lipGrad(cy, cy + lower + 4);
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + up);
    ctx.quadraticCurveTo(cx, cy + 4, cx + w / 2, cy + up);
    ctx.bezierCurveTo(cx + w * 0.3, cy + lower + up * 0.3, cx - w * 0.3, cy + lower + up * 0.3, cx - w / 2, cy + up);
    ctx.fill();
    ctx.strokeStyle = shade(f.lip, 0.45);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + up);
    ctx.quadraticCurveTo(cx, cy + 5, cx + w / 2, cy + up);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${fem ? 0.45 : 0.2})`;
    ctx.beginPath();
    ctx.ellipse(cx + 8, cy + lower * 0.45, w * 0.12, 4.5, -0.1, 0, Math.PI * 2);
    ctx.fill();
    if (shape === "smile") {
      ctx.strokeStyle = shade(f.skin, 0.7);
      ctx.lineWidth = 2.5;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + s * (w / 2 + 3), cy + up + 3, 8, s < 0 ? Math.PI * 0.6 : Math.PI * 1.9, s < 0 ? Math.PI * 1.1 : Math.PI * 0.4);
        ctx.stroke();
      }
    }
  });
}
