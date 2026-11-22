/**
 * 낙서 결투 — "draw X, get X" accuracy over synthetic hand-drawn doodles.
 * Each generator imitates how people actually draw a shape on the pad:
 * shaky hand, rounded / overshot corners, circles that don't quite close (or
 * loop past the start), polygons drawn as one line or as separate sides,
 * random size / rotation / start point. The bar is per intended weapon.
 */

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { analyzeWeapon, PAD_SIZE, WEAPON_LABEL, type Stroke, type WeaponKind } from "./analyze";
import { GUIDE_EXAMPLES } from "./guideExamples";

type Rng = () => number;
type Pt = [number, number];

const between = (r: Rng, a: number, b: number) => a + (b - a) * r();
const gauss = (r: Rng) => (r() + r() + r() - 1.5) * 1.15;

/** Densify a polyline at ~`step` px and add hand jitter + slow drift. */
function hand(r: Rng, pts: Pt[], step = 4, shake = 1.1): number[] {
  const out: number[] = [];
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    if (i === pts.length - 1) {
      out.push(x0 + dx + gauss(r) * shake, y0 + dy + gauss(r) * shake);
      break;
    }
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      dx = dx * 0.92 + gauss(r) * 0.35;
      dy = dy * 0.92 + gauss(r) * 0.35;
      out.push(x0 + (x1 - x0) * t + dx + gauss(r) * shake, y0 + (y1 - y0) * t + dy + gauss(r) * shake);
    }
  }
  return out.map((v) => Math.max(0, Math.min(PAD_SIZE, Math.round(v))));
}

/** Corner list → path with each corner rounded by `round` px (hand-drawn corners are never sharp). */
function roundCorners(corners: Pt[], round: number, closed: boolean): Pt[] {
  if (round <= 0) return closed ? [...corners, corners[0]] : corners;
  const out: Pt[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const p = corners[i];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(p);
      continue;
    }
    const a = corners[(i - 1 + n) % n];
    const b = corners[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(round, la * 0.3) / la;
    const rb = Math.min(round, lb * 0.3) / lb;
    const s: Pt = [p[0] + (a[0] - p[0]) * ra, p[1] + (a[1] - p[1]) * ra];
    const e: Pt = [p[0] + (b[0] - p[0]) * rb, p[1] + (b[1] - p[1]) * rb];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      // Quadratic bezier through the corner.
      out.push([(1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * p[0] + t * t * e[0], (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * p[1] + t * t * e[1]]);
    }
  }
  if (closed) out.push(out[0]);
  return out;
}

function rotateStart(pts: Pt[], k: number): Pt[] {
  // pts is closed (last == first): restart the loop at vertex k.
  const ring = pts.slice(0, -1);
  const r = [...ring.slice(k), ...ring.slice(0, k)];
  return [...r, r[0]];
}

/** End a closed path a bit early (gap) or a bit late (overshoot) like a real pen does. */
function densify(pts: Pt[], step = 3): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function sloppyClose(r: Rng, raw: Pt[]): Pt[] {
  // Evenly spaced first, so "drop 5% of the points" means 5% of the outline.
  const pts = densify(raw);
  const roll = r();
  if (roll < 0.35) return pts; // clean
  const n = pts.length;
  if (roll < 0.7) {
    // Gap: drop the last few points.
    const drop = Math.max(1, Math.round(n * between(r, 0.02, 0.07)));
    return pts.slice(0, n - drop);
  }
  // Overshoot: keep going past the start.
  const extra = Math.max(1, Math.round(n * between(r, 0.03, 0.12)));
  return [...pts, ...pts.slice(1, 1 + extra)];
}

function placed(r: Rng, size: number): { cx: number; cy: number } {
  const m = size / 2 + 6;
  return { cx: between(r, m, PAD_SIZE - m), cy: between(r, m, PAD_SIZE - m) };
}

function polygon(r: Rng, corners: number, sizeLo: number, sizeHi: number, aspect = 1): Pt[] {
  const size = between(r, sizeLo, sizeHi);
  const rot = between(r, 0, Math.PI * 2);
  const { cx, cy } = placed(r, size * Math.max(1, aspect));
  const rad = size / 2;
  const out: Pt[] = [];
  for (let i = 0; i < corners; i++) {
    const a = rot + (i / corners) * Math.PI * 2 + between(r, -0.12, 0.12);
    const rr = rad * between(r, 0.88, 1.08);
    out.push([cx + Math.cos(a) * rr * aspect, cy + Math.sin(a) * rr]);
  }
  return out;
}

function closedPolyStrokes(r: Rng, corners: Pt[], allowSides: boolean): Stroke[] {
  const roundPx = between(r, 0, 9);
  if (allowSides && r() < 0.35) {
    // One stroke per side, ends landing near (not exactly on) each other.
    const out: Stroke[] = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      const j = () => between(r, -5, 5);
      out.push({ c: 0, p: hand(r, [[a[0] + j(), a[1] + j()], [b[0] + j(), b[1] + j()]]) });
    }
    return out;
  }
  let path = roundCorners(corners, roundPx, true);
  path = rotateStart(path, Math.floor(r() * corners.length) * 5);
  path = sloppyClose(r, path);
  return [{ c: 0, p: hand(r, path) }];
}

const GEN: Partial<Record<WeaponKind, (r: Rng) => Stroke[]>> = {
  spear: (r) => {
    const len = between(r, 80, 185);
    const a = between(r, 0, Math.PI * 2);
    const cx = PAD_SIZE / 2 + between(r, -10, 10);
    const cy = PAD_SIZE / 2 + between(r, -10, 10);
    const ux = Math.cos(a) * len * 0.5;
    const uy = Math.sin(a) * len * 0.5;
    // Slight bow in the middle (nobody draws a perfectly straight line).
    const bow = between(r, -5, 5);
    return [{ c: 0, p: hand(r, [[cx - ux, cy - uy], [cx - uy * bow * 0.02, cy + ux * bow * 0.02], [cx + ux, cy + uy]]) }];
  },
  bomb: (r) => {
    const rad = between(r, 28, 80);
    const aspect = between(r, 0.72, 1.3);
    const { cx, cy } = placed(r, rad * 2 * Math.max(1, aspect));
    const start = between(r, 0, Math.PI * 2);
    const dir = r() < 0.5 ? 1 : -1;
    const wob = between(r, 0, 0.05);
    const ph = between(r, 0, 6);
    const n = 40;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = start + dir * (i / n) * Math.PI * 2;
      const rr = rad * (1 + wob * Math.sin(a * 3 + ph));
      pts.push([cx + Math.cos(a) * rr * aspect, cy + Math.sin(a) * rr]);
    }
    if (r() < 0.2) {
      // Two half-circles.
      return [
        { c: 0, p: hand(r, pts.slice(0, n / 2 + 1)) },
        { c: 0, p: hand(r, pts.slice(n / 2)) },
      ];
    }
    return [{ c: 0, p: hand(r, sloppyClose(r, pts)) }];
  },
  rocket: (r) => {
    // Equilateral-ish or tall isoceles triangle.
    if (r() < 0.5) return closedPolyStrokes(r, polygon(r, 3, 70, 170), true);
    const w = between(r, 50, 110);
    const h = between(r, 80, 170);
    const rot = between(r, 0, Math.PI * 2);
    const { cx, cy } = placed(r, Math.max(w, h));
    const local: Pt[] = [
      [0, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ];
    const corners = local.map(([x, y]) => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)] as Pt);
    return closedPolyStrokes(r, corners, true);
  },
  anvil: (r) => {
    if (r() < 0.2) return closedPolyStrokes(r, polygon(r, 5, 90, 170), false);
    const w = between(r, 60, 170);
    const h = w * between(r, 0.55, 1.4);
    const rot = between(r, -0.3, 0.3) + (r() < 0.15 ? Math.PI / 4 : 0);
    const { cx, cy } = placed(r, Math.max(w, h) * 1.1);
    const local: Pt[] = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ];
    const corners = local.map(([x, y]) => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)] as Pt);
    return closedPolyStrokes(r, corners, true);
  },
  shuriken: (r) => {
    const roll = r();
    if (roll < 0.5) {
      // One-line 5-point star (pentagram) or outline star.
      const size = between(r, 100, 180);
      const { cx, cy } = placed(r, size);
      const rot = between(r, 0, Math.PI * 2);
      const pts: Pt[] = [];
      if (r() < 0.5) {
        for (let i = 0; i <= 5; i++) {
          const a = rot + ((i * 2) % 5) * ((Math.PI * 2) / 5);
          pts.push([cx + (Math.cos(a) * size) / 2, cy + (Math.sin(a) * size) / 2]);
        }
      } else {
        for (let i = 0; i <= 10; i++) {
          const a = rot + (i / 10) * Math.PI * 2;
          const rr = i % 2 === 0 ? size / 2 : size * between(r, 0.18, 0.26);
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
        }
      }
      return [{ c: 0, p: hand(r, roundCorners(pts, between(r, 0, 4), false)) }];
    }
    // Crossed straight lines: X, +, or 3-4 lines through the middle.
    const lines = roll < 0.85 ? 2 : 3 + Math.floor(r() * 2);
    const len = between(r, 90, 180);
    const { cx, cy } = placed(r, len);
    const rot = between(r, 0, Math.PI);
    const out: Stroke[] = [];
    for (let i = 0; i < lines; i++) {
      const a = rot + (i / lines) * Math.PI + between(r, -0.1, 0.1);
      const ux = (Math.cos(a) * len) / 2;
      const uy = (Math.sin(a) * len) / 2;
      out.push({ c: 0, p: hand(r, [[cx - ux, cy - uy], [cx + ux, cy + uy]]) });
    }
    return out;
  },
  lightning: (r) => {
    const segs = 4 + Math.floor(r() * 4);
    const len = between(r, 110, 180);
    const rot = between(r, 0, Math.PI * 2);
    const amp = between(r, 18, 40);
    const pts: Pt[] = [];
    for (let i = 0; i <= segs; i++) {
      const along = -len / 2 + (len * i) / segs + between(r, -4, 4);
      const side = (i % 2 === 0 ? -1 : 1) * amp * between(r, 0.7, 1.2);
      pts.push([PAD_SIZE / 2 + along * Math.cos(rot) - side * Math.sin(rot), PAD_SIZE / 2 + along * Math.sin(rot) + side * Math.cos(rot)]);
    }
    return [{ c: 0, p: hand(r, roundCorners(pts, between(r, 0, 3), false)) }];
  },
  boomerang: (r) => {
    const rad = between(r, 35, 80);
    const sweep = between(r, Math.PI * 0.9, Math.PI * 1.55);
    const start = between(r, 0, Math.PI * 2);
    const { cx, cy } = placed(r, rad * 2);
    const dir = r() < 0.5 ? 1 : -1;
    const pts: Pt[] = [];
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const a = start + dir * (i / n) * sweep;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    return [{ c: 0, p: hand(r, pts) }];
  },
  drill: (r) => {
    const turns = between(r, 2, 3.5);
    const r0 = between(r, 3, 10);
    const r1 = between(r, 50, 85);
    const start = between(r, 0, Math.PI * 2);
    const dir = r() < 0.5 ? 1 : -1;
    const inward = r() < 0.4;
    const n = Math.round(turns * 28);
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const tt = inward ? 1 - t : t;
      const a = start + dir * t * turns * Math.PI * 2;
      const rr = r0 + (r1 - r0) * tt;
      pts.push([PAD_SIZE / 2 + Math.cos(a) * rr, PAD_SIZE / 2 + Math.sin(a) * rr]);
    }
    return [{ c: 0, p: hand(r, pts) }];
  },
  wave: (r) => {
    // A wave, not a zigzag: the crests stay round (radius ≥ 12px).
    const periods = between(r, 1, 2);
    const len = between(r, 120, 185);
    const lambda = len / periods;
    const amp = Math.min(between(r, 16, 36), (lambda * lambda) / (4 * Math.PI * Math.PI * 12));
    const rot = between(r, -0.5, 0.5) + (r() < 0.3 ? Math.PI / 2 : 0);
    const pts: Pt[] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const along = -len / 2 + len * t;
      const side = Math.sin(t * periods * Math.PI * 2) * amp;
      pts.push([PAD_SIZE / 2 + along * Math.cos(rot) - side * Math.sin(rot), PAD_SIZE / 2 + along * Math.sin(rot) + side * Math.cos(rot)]);
    }
    return [{ c: 0, p: hand(r, pts) }];
  },
  cluster: (r) => {
    const count = 4 + Math.floor(r() * 4);
    const out: Stroke[] = [];
    for (let i = 0; i < count; i++) {
      const cx = between(r, 20, 180);
      const cy = between(r, 20, 180);
      const s = between(r, 2, 14);
      const kind = r();
      const pts: Pt[] =
        kind < 0.4
          ? [
              [cx, cy],
              [cx + 1, cy + 1],
            ]
          : kind < 0.7
            ? [
                [cx - s / 2, cy],
                [cx + s / 2, cy + between(r, -3, 3)],
              ]
            : Array.from({ length: 9 }, (_, k) => [cx + (Math.cos((k / 8) * Math.PI * 2) * s) / 2, cy + (Math.sin((k / 8) * Math.PI * 2) * s) / 2] as Pt);
      out.push({ c: 0, p: hand(r, pts, 3, 0.6) });
    }
    return out;
  },
};

export const SHAPE_KINDS = Object.keys(GEN) as WeaponKind[];
const SAMPLES = 300;

export function accuracyTable(samples = SAMPLES): Record<string, { hit: number; got: Record<string, number> }> {
  const table: Record<string, { hit: number; got: Record<string, number> }> = {};
  for (const kind of SHAPE_KINDS) {
    const rng = seededRng(1000 + SHAPE_KINDS.indexOf(kind) * 77);
    const row = { hit: 0, got: {} as Record<string, number> };
    for (let i = 0; i < samples; i++) {
      const strokes = GEN[kind]!(rng);
      const got = analyzeWeapon(strokes).kind;
      row.got[got] = (row.got[got] ?? 0) + 1;
      if (got === kind) row.hit++;
    }
    table[kind] = row;
  }
  return table;
}

describe("draw X → get X", () => {
  it("each hand-drawn shape reads as its intended weapon most of the time", () => {
    const table = accuracyTable();
    const lines = Object.entries(table).map(
      ([k, v]) =>
        `${k.padEnd(10)} ${String(Math.round((v.hit / SAMPLES) * 100)).padStart(3)}%  ${Object.entries(v.got)
          .sort((a, b) => b[1] - a[1])
          .map(([g, n]) => `${g}:${n}`)
          .join(" ")}`,
    );
    if (process.env.INK_ACC) writeFileSync(process.env.INK_ACC, lines.join("\n"));
    for (const [kind, v] of Object.entries(table)) expect([kind, v.hit / SAMPLES >= 0.9]).toEqual([kind, true]);
  });
});

describe("📖 shape guide examples", () => {
  it("every example drawing reads as the weapon it illustrates", () => {
    for (const kind of Object.keys(WEAPON_LABEL) as WeaponKind[]) expect([kind, analyzeWeapon(GUIDE_EXAMPLES[kind]).kind]).toEqual([kind, kind]);
  });
});
