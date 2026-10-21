"use client";

import { paintedTexture } from "./tableKit";

/**
 * Painted anime-style eye for the cartoon rig (SeatedPerson), in the spirit of
 * K-pop avatar apps: a tall glossy iris with a gradient, a big + a small
 * catchlight, a bold upper lash line (winged with lashes for the women, a
 * soft double-lid crease for the men) and a light lower line. One canvas per
 * (gender, iris) — the left eye is the same texture mirrored by the mesh.
 * Drawn for the RIGHT eye of the face (outer corner on the canvas' right).
 */
export const EYE_TEX = { w: 256, h: 200 };

export function kpopEyeTexture(gender: "f" | "m", iris: string) {
  return paintedTexture(`kpop-eye:${gender}:${iris}`, EYE_TEX.w, EYE_TEX.h, (ctx, W, H) => {
    const fem = gender === "f";
    const cx = W * 0.5;
    const cy = H * 0.55;
    const ew = W * 0.4;
    const eh = H * (fem ? 0.3 : 0.25);
    // almond: inner corner low-left, lifted outer corner right
    const almond = () => {
      ctx.beginPath();
      ctx.moveTo(cx - ew, cy + eh * 0.15);
      ctx.bezierCurveTo(cx - ew * 0.55, cy - eh * 1.15, cx + ew * 0.55, cy - eh * 1.2, cx + ew, cy - eh * 0.25);
      ctx.bezierCurveTo(cx + ew * 0.6, cy + eh * 0.95, cx - ew * 0.5, cy + eh * 1.0, cx - ew, cy + eh * 0.15);
      ctx.closePath();
    };
    ctx.save();
    almond();
    ctx.clip();
    ctx.fillStyle = "#fbf7f2";
    ctx.fillRect(0, 0, W, H);
    // tall iris with a dark rim and a warm, lighter lower half
    const ir = eh * 1.05;
    const g = ctx.createLinearGradient(0, cy - ir, 0, cy + ir);
    g.addColorStop(0, "#0d0806");
    g.addColorStop(0.45, iris);
    g.addColorStop(1, lighten(iris, 0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy + eh * 0.05, ir * 0.82, ir, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(10,6,4,0.8)";
    ctx.stroke();
    ctx.fillStyle = "#070403";
    ctx.beginPath();
    ctx.ellipse(cx, cy + eh * 0.05, ir * 0.36, ir * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    // lid shadow across the top of the eye
    const lg = ctx.createLinearGradient(0, cy - eh, 0, cy - eh * 0.2);
    lg.addColorStop(0, "rgba(40,20,14,0.55)");
    lg.addColorStop(1, "rgba(40,20,14,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, cy);
    // catchlights: the big glossy one and a small bounce
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(cx + ir * 0.3, cy - ir * 0.35, ir * 0.24, ir * 0.2, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(cx - ir * 0.28, cy + ir * 0.42, ir * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // upper lash line, heavier toward the outer corner
    ctx.strokeStyle = "#140b08";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = fem ? 11 : 8;
    ctx.beginPath();
    ctx.moveTo(cx - ew, cy + eh * 0.15);
    ctx.bezierCurveTo(cx - ew * 0.55, cy - eh * 1.15, cx + ew * 0.55, cy - eh * 1.2, cx + ew, cy - eh * 0.25);
    if (fem) ctx.lineTo(cx + ew * 1.2, cy - eh * 0.75); // wing
    ctx.stroke();
    if (fem) {
      ctx.lineWidth = 4;
      for (const t of [0.6, 0.75, 0.9]) {
        const x = cx - ew + 2 * ew * t;
        const y = cy - eh * (1.05 - (t - 0.5) * 0.9);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 10, y - 14);
        ctx.stroke();
      }
    } else {
      // soft double-lid crease
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(90,50,36,0.55)";
      ctx.beginPath();
      ctx.moveTo(cx - ew * 0.55, cy - eh * 1.15);
      ctx.quadraticCurveTo(cx + ew * 0.1, cy - eh * 1.75, cx + ew * 0.85, cy - eh * 0.85);
      ctx.stroke();
    }
    // light lower line toward the outer corner
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(60,30,22,0.55)";
    ctx.beginPath();
    ctx.moveTo(cx - ew * 0.2, cy + eh * 0.95);
    ctx.quadraticCurveTo(cx + ew * 0.55, cy + eh * 0.85, cx + ew * 0.95, cy - eh * 0.15);
    ctx.stroke();
  });
}

function lighten(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
