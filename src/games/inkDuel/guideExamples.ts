/**
 * 낙서 결투 — example doodles for the 📖 shape guide (ShapeGuide.tsx), in pad
 * space (0..200). InkDuel shape tests check each one reads as its own weapon,
 * so the guide can never show a drawing that gives something else.
 */

import type { Stroke, WeaponKind } from "./analyze";

type Pt = [number, number];

function poly(pts: Pt[], step = 6): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) out.push(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n));
  }
  const [lx, ly] = pts[pts.length - 1];
  out.push(Math.round(lx), Math.round(ly));
  return out;
}

function curve(n: number, f: (t: number) => Pt): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => f(i / n));
}

const one = (pts: Pt[]): Stroke[] => [{ c: 0, p: poly(pts) }];

export const GUIDE_EXAMPLES: Record<WeaponKind, Stroke[]> = {
  spear: one([
    [30, 160],
    [170, 40],
  ]),
  bomb: one(curve(32, (t) => [100 + Math.cos(t * Math.PI * 2) * 62, 100 + Math.sin(t * Math.PI * 2) * 62])),
  rocket: one([
    [100, 28],
    [168, 164],
    [32, 164],
    [100, 28],
  ]),
  anvil: one([
    [42, 52],
    [158, 52],
    [158, 150],
    [42, 150],
    [42, 52],
  ]),
  shuriken: one(curve(10, (t) => {
    const a = -Math.PI / 2 + t * Math.PI * 2;
    const r = Math.round(t * 10) % 2 === 0 ? 80 : 30;
    return [100 + Math.cos(a) * r, 104 + Math.sin(a) * r];
  })),
  lightning: one([
    [40, 30],
    [120, 62],
    [70, 96],
    [146, 128],
    [96, 170],
  ]),
  boomerang: one(curve(24, (t) => {
    const a = Math.PI * 0.35 + t * Math.PI * 1.3;
    return [112 + Math.cos(a) * 62, 100 + Math.sin(a) * 62];
  })),
  drill: one(curve(80, (t) => {
    const a = t * Math.PI * 2 * 2.6;
    const r = 6 + 70 * t;
    return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r];
  })),
  wave: one(curve(40, (t) => [22 + 156 * t, 100 - Math.sin(t * Math.PI * 3) * 26])),
  cluster: [
    [40, 50],
    [120, 36],
    [160, 100],
    [70, 120],
    [110, 160],
  ].map(([x, y]) => ({ c: 0 as const, p: [x, y, x + 9, y + 3] })),
  club: one([
    [40, 50],
    [150, 50],
    [150, 162],
  ]),
};
