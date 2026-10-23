"use client";

import { paintedTexture } from "./tableKit";
import type { EyeShape } from "@/lib/character/avatar";

/**
 * Painted anime-style eye for the cartoon rig (SeatedPerson), in the spirit of
 * K-pop avatar apps: a tall glossy iris with a gradient, a big + a small
 * catchlight, a bold upper lash line (winged with lashes for the women, a
 * soft double-lid crease for the men) and a light lower line. One canvas per
 * (gender, iris) — the left eye is the same texture mirrored by the mesh.
 * Drawn for the RIGHT eye of the face (outer corner on the canvas' right).
 */
export const EYE_TEX = { w: 256, h: 200 };

/**
 * How each 눈매 bends the almond: `lift` raises (+) or drops (−) the outer
 * corner, `open` scales the height, `crease` draws the double-lid line.
 */
const SHAPES: Record<EyeShape, { lift: number; open: number; crease: boolean; liner: number; iris: number }> = {
  round: { lift: 0.05, open: 1.18, crease: true, liner: 1, iris: 1.05 },
  fox: { lift: 0.75, open: 0.86, crease: true, liner: 1.15, iris: 0.95 },
  puppy: { lift: -0.45, open: 1.05, crease: true, liner: 0.95, iris: 1.05 },
  sharp: { lift: 0.4, open: 0.74, crease: false, liner: 1.1, iris: 0.92 },
};

export function kpopEyeTexture(gender: "f" | "m", iris: string, shape: EyeShape = "round") {
  return paintedTexture(`kpop-eye:${gender}:${iris}:${shape}`, EYE_TEX.w, EYE_TEX.h, (ctx, W, H) => {
    const fem = gender === "f";
    const sh = SHAPES[shape];
    const cx = W * 0.5;
    const cy = H * 0.56;
    const ew = W * 0.4;
    const eh = H * (fem ? 0.3 : 0.25) * sh.open;
    // outer corner (right) height: lifted for fox/sharp, dropped for puppy
    const oy = cy - eh * (0.25 + sh.lift);
    const iy = cy + eh * 0.15;
    const upper = () => {
      ctx.moveTo(cx - ew, iy);
      ctx.bezierCurveTo(cx - ew * 0.55, cy - eh * 1.15, cx + ew * 0.55, cy - eh * (1.2 + sh.lift * 0.3), cx + ew, oy);
    };
    const almond = () => {
      ctx.beginPath();
      upper();
      ctx.bezierCurveTo(cx + ew * 0.6, cy + eh * (0.95 - sh.lift * 0.3), cx - ew * 0.5, cy + eh * 1.0, cx - ew, iy);
      ctx.closePath();
    };
    ctx.save();
    almond();
    ctx.clip();
    ctx.fillStyle = "#fbf7f2";
    ctx.fillRect(0, 0, W, H);
    // tall iris with a dark rim and a warm, lighter lower half
    const ir = H * (fem ? 0.3 : 0.25) * sh.iris * 1.05;
    const icy = cy + eh * 0.05;
    const g = ctx.createLinearGradient(0, icy - ir, 0, icy + ir);
    g.addColorStop(0, "#0d0806");
    g.addColorStop(0.45, iris);
    g.addColorStop(1, lighten(iris, 0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, icy, ir * 0.82, ir, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(10,6,4,0.9)";
    ctx.stroke();
    ctx.fillStyle = "#070403";
    ctx.beginPath();
    ctx.ellipse(cx, icy, ir * 0.36, ir * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    // lid shadow across the top of the eye
    const lg = ctx.createLinearGradient(0, cy - eh, 0, cy - eh * 0.2);
    lg.addColorStop(0, "rgba(40,20,14,0.6)");
    lg.addColorStop(1, "rgba(40,20,14,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, cy);
    // catchlights: the big glossy one and a small bounce
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(cx + ir * 0.3, icy - ir * 0.4, ir * 0.24, ir * 0.2, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(cx - ir * 0.28, icy + ir * 0.37, ir * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // upper lash line, heavier toward the outer corner
    ctx.strokeStyle = "#0e0705";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = (fem ? 13 : 10) * sh.liner;
    ctx.beginPath();
    upper();
    if (fem) ctx.lineTo(cx + ew * 1.2, oy - eh * (0.5 + Math.max(0, sh.lift) * 0.4)); // wing
    else if (shape === "puppy") ctx.lineTo(cx + ew * 1.1, oy + eh * 0.2);
    ctx.stroke();
    if (fem) {
      ctx.lineWidth = 4.5;
      for (const t of [0.6, 0.75, 0.9]) {
        const x = cx - ew + 2 * ew * t;
        const y = cy - eh * (1.05 - (t - 0.5) * 0.9) - sh.lift * eh * (t - 0.5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 10, y - 15);
        ctx.stroke();
      }
    }
    if (sh.crease) {
      // double-lid crease following the lash line
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(90,46,32,0.6)";
      ctx.beginPath();
      ctx.moveTo(cx - ew * 0.5, cy - eh * 1.2);
      ctx.quadraticCurveTo(cx + ew * 0.1, cy - eh * (1.8 + sh.lift * 0.3), cx + ew * 0.88, oy - eh * 0.6);
      ctx.stroke();
    }
    // lower line toward the outer corner
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "rgba(60,30,22,0.65)";
    ctx.beginPath();
    ctx.moveTo(cx - ew * 0.2, cy + eh * 0.95);
    ctx.quadraticCurveTo(cx + ew * 0.55, cy + eh * (0.85 - sh.lift * 0.3), cx + ew * 0.95, oy + eh * 0.1);
    ctx.stroke();
  });
}

function lighten(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
