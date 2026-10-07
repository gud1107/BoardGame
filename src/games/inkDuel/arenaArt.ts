/**
 * 낙서 결투 — arena artwork (client-only rendering, no game rules).
 *
 * Style: a crayon / watercolor sketchbook page. Static layers (paper +
 * scenery, terrain) are pre-rendered to offscreen canvases; characters,
 * projectiles and particles are drawn every frame. Math.random is fine here —
 * nothing in this file feeds back into the lockstep engine.
 */

import { INK_COLORS, type Element } from "./analyze";
import { STATUS_INFO, type StatusId } from "./status";
import type { MapId } from "./maps";
import { surfaceY, WORLD_H, WORLD_W, type Wall } from "./physics";

// ---------------------------------------------------------------------------
// Palette / characters
// ---------------------------------------------------------------------------

export interface CharacterArt {
  name: string;
  base: string;
  light: string;
  dark: string;
  belly: string;
  kind: "wizard" | "cat" | "frog" | "bunny" | "chick" | "penguin";
}

export const CHARACTERS: CharacterArt[] = [
  { name: "보라 마법사", base: "#8b5cf6", light: "#c4b5fd", dark: "#4c1d95", belly: "#ede9fe", kind: "wizard" },
  { name: "귤 고양이", base: "#fb923c", light: "#fed7aa", dark: "#9a3412", belly: "#fff7ed", kind: "cat" },
  { name: "민트 개구리", base: "#14b8a6", light: "#99f6e4", dark: "#115e59", belly: "#f0fdfa", kind: "frog" },
  { name: "딸기 토끼", base: "#f472b6", light: "#fbcfe8", dark: "#9d174d", belly: "#fdf2f8", kind: "bunny" },
  { name: "레몬 병아리", base: "#facc15", light: "#fef08a", dark: "#a16207", belly: "#fefce8", kind: "chick" },
  { name: "바다 펭귄", base: "#2563eb", light: "#93c5fd", dark: "#172554", belly: "#ffffff", kind: "penguin" },
];

export function characterFor(seat: number): CharacterArt {
  return CHARACTERS[seat % CHARACTERS.length];
}

export const ELEMENT_GLOW: Record<Element, string> = {
  none: "#64748b",
  fire: "#f97316",
  ice: "#38bdf8",
  poison: "#22c55e",
  shock: "#facc15",
  slow: "#22d3ee",
  stun: "#b45309",
  curse: "#a855f7",
  crush: "#fb923c",
  vampire: "#f472b6",
  chaos: "#cbd5e1",
  dark: "#4338ca",
};

const FONT = "'Gaegu', 'Jua', 'Comic Sans MS', sans-serif";

// Small deterministic RNG so pre-rendered layers look the same every rebuild.
function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number, dpr: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, ctx];
}

/** Crayon stroke: a solid pass plus jittered, translucent passes for wax texture. */
export function crayon(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string, width: number, rng: () => number = Math.random, alpha = 1) {
  if (pts.length < 4) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  const passes: [number, number][] = [
    [width, alpha],
    [width * 0.55, alpha * 0.45],
    [width * 0.35, alpha * 0.35],
  ];
  passes.forEach(([w, a], k) => {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    const j = k === 0 ? 0 : width * 0.35;
    ctx.moveTo(pts[0] + (rng() - 0.5) * j, pts[1] + (rng() - 0.5) * j);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + (rng() - 0.5) * j, pts[i + 1] + (rng() - 0.5) * j);
    ctx.stroke();
  });
  ctx.restore();
}

/** Soft watercolor blob: several low-alpha jittered fills. */
function wash(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string, rng: () => number, alpha = 0.18) {
  ctx.save();
  ctx.fillStyle = color;
  for (let k = 0; k < 4; k++) {
    ctx.globalAlpha = alpha * (1 - k * 0.15);
    ctx.beginPath();
    ctx.moveTo(pts[0] + (rng() - 0.5) * 8, pts[1] + (rng() - 0.5) * 8);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + (rng() - 0.5) * 8, pts[i + 1] + (rng() - 0.5) * 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Background (paper + scenery) — rendered once
// ---------------------------------------------------------------------------

export function renderBackground(dpr: number, map: MapId = "meadow"): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(WORLD_W, WORLD_H, dpr);
  const rng = mulberry(7);

  // Paper + sky wash in the map's palette.
  ctx.fillStyle = "#fbf7ec";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  const skyStops: Record<MapId, [string, string]> = {
    meadow: ["rgba(125, 196, 245, 0.38)", "rgba(186, 225, 250, 0.18)"],
    desert: ["rgba(251, 146, 60, 0.42)", "rgba(253, 224, 71, 0.2)"],
    snow: ["rgba(148, 163, 184, 0.45)", "rgba(203, 213, 225, 0.22)"],
    volcano: ["rgba(127, 29, 29, 0.85)", "rgba(68, 64, 60, 0.55)"],
  };
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H * 0.8);
  sky.addColorStop(0, skyStops[map][0]);
  sky.addColorStop(0.55, skyStops[map][1]);
  sky.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Paper grain.
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rng() < 0.5 ? "rgba(120, 100, 70, 0.05)" : "rgba(255, 255, 255, 0.2)";
    ctx.fillRect(rng() * WORLD_W, rng() * WORLD_H, 1 + rng() * 1.5, 1 + rng());
  }

  // Ruled lines + margin.
  ctx.strokeStyle = map === "volcano" ? "rgba(253, 186, 116, 0.14)" : "rgba(96, 140, 210, 0.22)";
  ctx.lineWidth = 1;
  for (let y = 46; y < WORLD_H; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(230, 110, 110, 0.4)";
  for (const x of [62, 66]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_H);
    ctx.stroke();
  }
  // Binder holes.
  for (let y = 70; y < WORLD_H; y += 135) {
    const g = ctx.createRadialGradient(26, y - 2, 2, 26, y, 11);
    g.addColorStop(0, "#d6d0c2");
    g.addColorStop(1, "#ebe5d6");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(26, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.stroke();
  }

  const circle = (x: number, y: number, r: number, n = 28) => {
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    return pts;
  };
  const sunWithFace = (sx: number, sy: number, r: number, fill: string, line: string, rays: boolean) => {
    const glow = ctx.createRadialGradient(sx, sy, 6, sx, sy, r * 2.2);
    glow.addColorStop(0, fill.replace("1)", "0.55)"));
    glow.addColorStop(1, fill.replace("1)", "0)"));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    const ring = circle(sx, sy, r);
    wash(ctx, ring, fill, rng, 0.4);
    crayon(ctx, ring, line, 3, rng);
    if (rays) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.2;
        crayon(ctx, [sx + Math.cos(a) * (r + 8), sy + Math.sin(a) * (r + 8), sx + Math.cos(a) * (r + 18 + (i % 2) * 7), sy + Math.sin(a) * (r + 18 + (i % 2) * 7)], line, 2.6, rng);
      }
    }
    ctx.fillStyle = "#92400e";
    ctx.beginPath();
    ctx.arc(sx - r * 0.33, sy - r * 0.16, 2.4, 0, Math.PI * 2);
    ctx.arc(sx + r * 0.33, sy - r * 0.16, 2.4, 0, Math.PI * 2);
    ctx.fill();
    crayon(ctx, [sx - r * 0.38, sy + r * 0.25, sx - r * 0.16, sy + r * 0.42, sx + r * 0.16, sy + r * 0.42, sx + r * 0.38, sy + r * 0.25], "#92400e", 2, rng);
  };
  const cloud = (cx: number, cy: number, s: number, fill: string, line: string) => {
    const pts: number[] = [];
    const bumps = [
      [-1.6, 0.25, 0.7],
      [-0.8, -0.35, 0.9],
      [0.2, -0.55, 1.05],
      [1.1, -0.2, 0.85],
      [1.7, 0.3, 0.6],
    ];
    for (const [bx, by, br] of bumps) {
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        pts.push(cx + (bx + Math.cos(a) * br * 0.6) * s * 20, cy + (by + Math.sin(a) * br * 0.6) * s * 20);
      }
    }
    pts.push(cx + 2.1 * s * 20, cy + 0.55 * s * 20, cx - 2.1 * s * 20, cy + 0.55 * s * 20);
    ctx.save();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    crayon(ctx, [...pts, pts[0], pts[1]], line, 2.2, rng);
  };
  const hills = (base: number, amp: number, freq: number, phase: number, color: string, alpha: number) => {
    const pts: number[] = [0, WORLD_H];
    for (let x = 0; x <= WORLD_W; x += 16) pts.push(x, base - Math.sin(x * freq + phase) * amp - Math.sin(x * freq * 2.7 + phase * 2) * amp * 0.35);
    pts.push(WORLD_W, WORLD_H);
    wash(ctx, pts, color, rng, alpha);
  };
  const bird = (bx: number, by: number, color: string) => crayon(ctx, [bx - 8, by - 3, bx - 3, by, bx, by - 4, bx + 3, by, bx + 8, by - 3], color, 1.8, rng);
  const star = (stx: number, sty: number, color: string, r = 9) => {
    const st: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      st.push(stx + Math.cos(a) * (i % 2 === 0 ? r : r * 0.45), sty + Math.sin(a) * (i % 2 === 0 ? r : r * 0.45));
    }
    crayon(ctx, st, color, 1.8, rng, 0.85);
  };

  if (map === "meadow") {
    sunWithFace(WORLD_W - 110, 82, 24, "rgba(253, 224, 71, 1)", "#f59e0b", true);
    cloud(220, 92, 1.1, "rgba(255,255,255,0.85)", "#7dd3fc");
    cloud(520, 60, 0.85, "rgba(255,255,255,0.85)", "#7dd3fc");
    cloud(700, 140, 0.7, "rgba(255,255,255,0.85)", "#7dd3fc");
    bird(360, 120, "#475569");
    bird(385, 108, "#475569");
    bird(600, 190, "#475569");
    star(130, 190, "#fbbf24");
    star(860, 210, "#fbbf24");
    hills(300, 34, 0.007, 1.2, "#a5b4fc", 0.16);
    hills(340, 26, 0.011, 3.1, "#86efac", 0.16);
  } else if (map === "desert") {
    sunWithFace(WORLD_W - 150, 100, 34, "rgba(251, 146, 60, 1)", "#c2410c", true);
    // Mesas + pyramids on the horizon.
    hills(330, 18, 0.006, 0.4, "#fb923c", 0.14);
    for (const [px, base, w] of [
      [250, 320, 120],
      [360, 330, 80],
    ]) {
      const tri = [px - w / 2, base, px, base - w * 0.62, px + w / 2, base, px - w / 2, base];
      wash(ctx, tri, "#f59e0b", rng, 0.22);
      crayon(ctx, tri, "#b45309", 2, rng, 0.7);
      crayon(ctx, [px, base - w * 0.62, px + w * 0.12, base], "#b45309", 1.4, rng, 0.5);
    }
    const mesa = [620, 330, 640, 280, 760, 280, 790, 330];
    wash(ctx, mesa, "#ea580c", rng, 0.18);
    crayon(ctx, mesa, "#9a3412", 2, rng, 0.6);
    // Distant cactus silhouettes.
    for (const cx of [140, 500, 880]) {
      crayon(ctx, [cx, 345, cx, 300], "#65a30d", 7, rng, 0.45);
      crayon(ctx, [cx, 322, cx - 10, 322, cx - 10, 308], "#65a30d", 5, rng, 0.45);
      crayon(ctx, [cx, 316, cx + 10, 316, cx + 10, 302], "#65a30d", 5, rng, 0.45);
    }
    bird(430, 140, "#7c2d12");
    bird(455, 150, "#7c2d12");
    // Heat shimmer lines.
    for (let i = 0; i < 6; i++) {
      const y = 200 + i * 22;
      const x = 100 + rng() * 700;
      crayon(ctx, [x, y, x + 15, y - 3, x + 30, y, x + 45, y - 3], "rgba(234, 88, 12, 0.35)", 1.4, rng);
    }
  } else if (map === "snow") {
    // Pale winter sun behind haze.
    const sx = WORLD_W - 140;
    const sy = 90;
    const ring = circle(sx, sy, 26);
    wash(ctx, ring, "#fef9c3", rng, 0.5);
    crayon(ctx, ring, "#e2e8f0", 2.4, rng);
    cloud(240, 80, 1.2, "rgba(241,245,249,0.9)", "#94a3b8");
    cloud(560, 110, 0.9, "rgba(241,245,249,0.9)", "#94a3b8");
    // Snowy peaks.
    for (const [px, base, w, h] of [
      [180, 360, 300, 170],
      [470, 360, 360, 210],
      [800, 360, 300, 160],
    ]) {
      const peak = [px - w / 2, base, px, base - h, px + w / 2, base];
      wash(ctx, [...peak, px - w / 2, base], "#64748b", rng, 0.22);
      const cap = [px - w * 0.18, base - h * 0.64, px, base - h, px + w * 0.18, base - h * 0.64, px + w * 0.08, base - h * 0.58, px - w * 0.04, base - h * 0.66, px - w * 0.12, base - h * 0.58];
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.moveTo(cap[0], cap[1]);
      for (let i = 2; i < cap.length; i += 2) ctx.lineTo(cap[i], cap[i + 1]);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      crayon(ctx, peak, "#475569", 2, rng, 0.55);
    }
    // Pine trees.
    for (const tx of [120, 300, 560, 700, 880]) {
      const base = 372;
      for (let k = 0; k < 3; k++) {
        const w = 22 - k * 5;
        const y = base - k * 12;
        const tri = [tx - w, y, tx, y - 18, tx + w, y, tx - w, y];
        wash(ctx, tri, "#166534", rng, 0.35);
        crayon(ctx, [tx - w * 0.6, y - 6, tx, y - 18, tx + w * 0.6, y - 6], "#ffffff", 2.2, rng, 0.85);
      }
      crayon(ctx, [tx, base, tx, base + 8], "#78350f", 3, rng, 0.5);
    }
  } else {
    // Volcano: glowing crater, smoke plumes, lava streaks, ember stars.
    const vx = 620;
    const base = 360;
    const cone = [vx - 230, base, vx - 46, base - 190, vx + 46, base - 190, vx + 230, base];
    wash(ctx, [...cone, vx - 230, base], "#1c1917", rng, 0.55);
    crayon(ctx, cone, "#0c0a09", 2.4, rng, 0.8);
    const glow = ctx.createRadialGradient(vx, base - 190, 4, vx, base - 190, 90);
    glow.addColorStop(0, "rgba(251, 146, 60, 0.9)");
    glow.addColorStop(1, "rgba(251, 146, 60, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(vx, base - 190, 90, 0, Math.PI * 2);
    ctx.fill();
    for (const off of [-30, 0, 26]) {
      crayon(ctx, [vx + off * 0.4, base - 188, vx + off, base - 140, vx + off * 1.6, base - 80, vx + off * 2.1, base - 20], "#f97316", 3, rng, 0.75);
    }
    for (let k = 0; k < 4; k++) {
      cloud(vx - 30 + k * 26, base - 230 - k * 40, 0.7 + k * 0.25, "rgba(87, 83, 78, 0.55)", "rgba(41, 37, 36, 0.6)");
    }
    hills(345, 22, 0.009, 2.2, "#292524", 0.4);
    // Crescent moon.
    const mx = 170;
    const my = 90;
    wash(ctx, circle(mx, my, 22), "#fde68a", rng, 0.55);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(mx + 10, my - 6, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 9; i++) star(100 + rng() * 760, 40 + rng() * 150, "#fdba74", 4 + rng() * 3);
  }

  // Masking tape on the top corners.
  const tape = (x: number, y: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = "rgba(245, 222, 160, 0.7)";
    ctx.fillRect(-46, -12, 92, 24);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(-46, -12, 92, 5);
    ctx.restore();
  };
  tape(40, 14, -0.6);
  tape(WORLD_W - 40, 14, 0.6);

  // Vignette.
  const v = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.45, WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.7);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, map === "volcano" ? "rgba(20, 5, 5, 0.4)" : "rgba(80, 60, 30, 0.16)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  return c;
}

// ---------------------------------------------------------------------------
// Terrain — re-rendered only when the height array changes (craters)
// ---------------------------------------------------------------------------

interface TerrainPalette {
  soil: [string, string, string];
  hatch: string;
  strata: [string, string, string];
  pebbles: [string, string];
}

const TERRAIN_PALETTE: Record<MapId, TerrainPalette> = {
  meadow: {
    soil: ["#d9b27c", "#b9834d", "#7c4a24"],
    hatch: "rgba(92, 52, 20, 0.16)",
    strata: ["rgba(120, 72, 32, 0.35)", "rgba(110, 64, 28, 0.3)", "rgba(90, 50, 20, 0.3)"],
    pebbles: ["rgba(120, 113, 108, 0.55)", "rgba(168, 162, 158, 0.6)"],
  },
  desert: {
    soil: ["#fde68a", "#fbbf24", "#b45309"],
    hatch: "rgba(180, 83, 9, 0.12)",
    strata: ["rgba(217, 119, 6, 0.35)", "rgba(194, 65, 12, 0.25)", "rgba(154, 52, 18, 0.25)"],
    pebbles: ["rgba(180, 83, 9, 0.35)", "rgba(254, 243, 199, 0.6)"],
  },
  snow: {
    soil: ["#cbd5e1", "#64748b", "#1e293b"],
    hatch: "rgba(30, 41, 59, 0.14)",
    strata: ["rgba(125, 211, 252, 0.45)", "rgba(56, 189, 248, 0.3)", "rgba(14, 116, 144, 0.3)"],
    pebbles: ["rgba(71, 85, 105, 0.55)", "rgba(226, 232, 240, 0.6)"],
  },
  volcano: {
    soil: ["#57534e", "#292524", "#0c0a09"],
    hatch: "rgba(0, 0, 0, 0.25)",
    strata: ["rgba(249, 115, 22, 0.55)", "rgba(234, 88, 12, 0.45)", "rgba(194, 65, 12, 0.4)"],
    pebbles: ["rgba(28, 25, 23, 0.8)", "rgba(120, 113, 108, 0.5)"],
  },
};

export function renderTerrain(terrain: readonly number[], dpr: number, map: MapId = "meadow"): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(WORLD_W, WORLD_H, dpr);
  const rng = mulberry(31);
  const pal = TERRAIN_PALETTE[map];
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(0, WORLD_H);
    for (let x = 0; x <= WORLD_W; x += 4) ctx.lineTo(x, surfaceY(terrain, x));
    ctx.lineTo(WORLD_W, WORLD_H);
    ctx.closePath();
  };

  ctx.save();
  outline();
  const soil = ctx.createLinearGradient(0, 300, 0, WORLD_H);
  soil.addColorStop(0, pal.soil[0]);
  soil.addColorStop(0.45, pal.soil[1]);
  soil.addColorStop(1, pal.soil[2]);
  ctx.fillStyle = soil;
  ctx.fill();
  ctx.clip();

  // Colored-pencil hatching.
  ctx.strokeStyle = pal.hatch;
  ctx.lineWidth = 1.3;
  for (let x = -WORLD_H; x < WORLD_W; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, WORLD_H);
    ctx.lineTo(x + WORLD_H * 0.8, 0);
    ctx.stroke();
  }
  // Strata following the surface (sand ripples / ice seams / lava veins).
  const offsets = map === "desert" ? [14, 30, 48, 70, 96, 128] : [26, 62, 108];
  offsets.forEach((off, k) => {
    const pts: number[] = [];
    for (let x = 0; x <= WORLD_W; x += 10) pts.push(x, surfaceY(terrain, x) + off + Math.sin(x * (map === "desert" ? 0.09 : 0.05) + off) * (map === "volcano" ? 9 : 4));
    if (map === "volcano") {
      ctx.save();
      ctx.shadowColor = "#f97316";
      ctx.shadowBlur = 10;
      crayon(ctx, pts, pal.strata[k % 3], 2.6, rng);
      ctx.restore();
    } else {
      crayon(ctx, pts, pal.strata[k % 3], map === "desert" ? 1.8 : 3, rng);
    }
  });
  // Pebbles.
  for (let i = 0; i < (map === "desert" ? 30 : 90); i++) {
    const x = rng() * WORLD_W;
    const top = surfaceY(terrain, x) + 14;
    const y = top + rng() * (WORLD_H - top);
    const r = 2 + rng() * 4;
    ctx.fillStyle = rng() < 0.5 ? pal.pebbles[0] : pal.pebbles[1];
    ctx.beginPath();
    if (map === "volcano") {
      // Sharp obsidian shards.
      ctx.moveTo(x, y - r * 1.4);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r * 0.6);
      ctx.closePath();
    } else {
      ctx.ellipse(x, y, r * 1.3, r, rng() * 3, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  const top: number[] = [];
  for (let x = 0; x <= WORLD_W; x += 6) top.push(x, surfaceY(terrain, x));

  if (map === "meadow") {
    crayon(ctx, top, "#4d7c0f", 9, rng);
    crayon(ctx, top, "#84cc16", 5, rng);
    for (let x = 2; x < WORLD_W; x += 5 + rng() * 4) {
      const y = surfaceY(terrain, x);
      const h = 4 + rng() * 6;
      const lean = (rng() - 0.5) * 5;
      crayon(ctx, [x, y + 1, x + lean, y - h], rng() < 0.5 ? "#65a30d" : "#3f6212", 1.6, rng);
    }
    for (let i = 0; i < 14; i++) {
      const x = 80 + rng() * (WORLD_W - 160);
      const y = surfaceY(terrain, x);
      crayon(ctx, [x, y, x + 1, y - 10], "#3f6212", 1.4, rng);
      const col = ["#f472b6", "#facc15", "#ffffff", "#a78bfa"][i % 4];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x + 1 + Math.cos(a) * 2.6, y - 11 + Math.sin(a) * 2.6, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(x + 1, y - 11, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (map === "desert") {
    crayon(ctx, top, "#d97706", 7, rng);
    crayon(ctx, top, "#fde68a", 3, rng);
    // Little cacti + a skull doodle.
    for (let i = 0; i < 7; i++) {
      const x = 90 + rng() * (WORLD_W - 180);
      const y = surfaceY(terrain, x);
      const h = 14 + rng() * 10;
      crayon(ctx, [x, y + 2, x, y - h], "#166534", 7, rng);
      crayon(ctx, [x, y + 2, x, y - h], "#4ade80", 4, rng);
      crayon(ctx, [x, y - h * 0.5, x - 7, y - h * 0.5, x - 7, y - h * 0.8], "#166534", 4.5, rng);
      crayon(ctx, [x, y - h * 0.65, x + 7, y - h * 0.65, x + 7, y - h * 0.95], "#166534", 4.5, rng);
      if (i % 3 === 0) {
        ctx.fillStyle = "#f472b6";
        ctx.beginPath();
        ctx.arc(x, y - h - 2, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (map === "snow") {
    // Thick snow cap with a blue shadow underneath, plus icicles.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, surfaceY(terrain, 0) - 3);
    for (let x = 0; x <= WORLD_W; x += 6) ctx.lineTo(x, surfaceY(terrain, x) - 3);
    for (let x = WORLD_W; x >= 0; x -= 6) ctx.lineTo(x, surfaceY(terrain, x) + 10 + Math.sin(x * 0.11) * 3);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
    const under: number[] = [];
    for (let x = 0; x <= WORLD_W; x += 6) under.push(x, surfaceY(terrain, x) + 10 + Math.sin(x * 0.11) * 3);
    crayon(ctx, under, "#7dd3fc", 2.4, rng);
    crayon(ctx, top, "#e2e8f0", 3, rng);
    for (let x = 12; x < WORLD_W; x += 18 + rng() * 26) {
      const y = surfaceY(terrain, x) + 10 + Math.sin(x * 0.11) * 3;
      const h = 4 + rng() * 9;
      ctx.fillStyle = "rgba(224, 242, 254, 0.95)";
      ctx.beginPath();
      ctx.moveTo(x - 2.5, y);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + 2.5, y);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Volcanic crust with a hot glowing rim.
    crayon(ctx, top, "#0c0a09", 8, rng);
    ctx.save();
    ctx.shadowColor = "#fb923c";
    ctx.shadowBlur = 12;
    crayon(ctx, top, "#f97316", 2.2, rng);
    ctx.restore();
    for (let i = 0; i < 10; i++) {
      const x = 80 + rng() * (WORLD_W - 160);
      const y = surfaceY(terrain, x);
      crayon(ctx, [x - 6, y - 1, x - 2, y - 7, x + 3, y - 4, x + 6, y - 1], "#292524", 3, rng);
    }
  }
  return c;
}

/** Map weather drawn every frame: snowfall, drifting sand, rising embers, floating petals. */
export class Ambient {
  private bits: { x: number; y: number; v: number; s: number; p: number }[];
  private last = 0;

  constructor(private map: MapId) {
    const n = map === "snow" ? 70 : map === "volcano" ? 40 : map === "desert" ? 36 : 10;
    this.bits = Array.from({ length: n }, () => ({ x: Math.random() * WORLD_W, y: Math.random() * WORLD_H, v: 0.5 + Math.random(), s: 1 + Math.random() * 2.2, p: Math.random() * 6 }));
  }

  draw(ctx: CanvasRenderingContext2D, wind: number, now: number) {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    const drift = wind * 2500;
    ctx.save();
    for (const b of this.bits) {
      switch (this.map) {
        case "snow":
          b.y += (18 + b.v * 22) * dt;
          b.x += (drift + Math.sin(now / 700 + b.p) * 12) * dt;
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.s, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        case "desert":
          b.x += (40 + drift * 2 + b.v * 40) * dt * (wind < 0 ? -1 : 1);
          b.y += Math.sin(now / 300 + b.p) * 6 * dt;
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = "#d97706";
          ctx.fillRect(b.x, b.y, b.s * 1.6, b.s * 0.7);
          break;
        case "volcano": {
          b.y -= (24 + b.v * 30) * dt;
          b.x += (drift + Math.sin(now / 400 + b.p) * 10) * dt;
          const flicker = 0.5 + 0.5 * Math.sin(now / 90 + b.p * 3);
          ctx.globalAlpha = 0.5 + flicker * 0.5;
          ctx.fillStyle = flicker > 0.5 ? "#fb923c" : "#fde047";
          ctx.shadowColor = "#f97316";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.s * 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          break;
        }
        default:
          b.y += (8 + b.v * 8) * dt;
          b.x += (drift + 14 + Math.sin(now / 500 + b.p) * 20) * dt;
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = b.p > 3 ? "#f9a8d4" : "#fde68a";
          ctx.beginPath();
          ctx.ellipse(b.x, b.y, b.s * 1.6, b.s * 0.9, now / 600 + b.p, 0, Math.PI * 2);
          ctx.fill();
      }
      if (b.y > WORLD_H + 10) b.y = -10;
      if (b.y < -10) b.y = WORLD_H + 10;
      if (b.x > WORLD_W + 10) b.x = -10;
      if (b.x < -10) b.x = WORLD_W + 10;
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export interface CharacterPose {
  seat: number;
  x: number;
  /** Ground level under the feet. */
  y: number;
  now: number;
  facing: 1 | -1;
  /** World point the eyes follow. */
  look?: { x: number; y: number } | null;
  /** 0..1 — white flash, squash and X eyes. */
  hurt?: number;
  /** Crayon-weapon angle in degrees (0 = right, 90 = up). */
  holdAngle?: number | null;
  active?: boolean;
  frozen?: boolean;
  burn?: boolean;
  poison?: boolean;
  /** Every active status (drives stun stars, blindfold, slime and the icon row). */
  statuses?: readonly StatusId[];
  /** Seat-specific blink offset so characters don't blink in sync. */
  blinkSeed?: number;
  /** Size multiplier around the feet (default CHAR_SCALE; avatars pass 1). */
  scale?: number;
  /** Character art index (defaults to the seat). */
  char?: number;
}

/** Characters are drawn larger than their 15px hitbox so they read at phone size. */
export const CHAR_SCALE = 1.4;

function aroundFeet(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, draw: () => void) {
  if (k === 1) {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(-x, -y);
  draw();
  ctx.restore();
}

function heldCrayon(ctx: CanvasRenderingContext2D, hx: number, hy: number, angleDeg: number, art: CharacterArt) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate((-angleDeg * Math.PI) / 180);
  // Body.
  ctx.fillStyle = art.base;
  ctx.strokeStyle = art.dark;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-4, -3.2, 20, 6.4, 1.5);
  ctx.fill();
  ctx.stroke();
  // Paper wrapper.
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(1, -3.2, 9, 6.4);
  ctx.strokeStyle = art.dark;
  ctx.beginPath();
  ctx.moveTo(1, -3.2);
  ctx.lineTo(1, 3.2);
  ctx.moveTo(10, -3.2);
  ctx.lineTo(10, 3.2);
  ctx.stroke();
  // Tip.
  ctx.fillStyle = art.dark;
  ctx.beginPath();
  ctx.moveTo(16, -3.2);
  ctx.lineTo(23, 0);
  ctx.lineTo(16, 3.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawCharacter(ctx: CanvasRenderingContext2D, pose: CharacterPose) {
  aroundFeet(ctx, pose.x, pose.y, pose.scale ?? CHAR_SCALE, () => drawCharacterBody(ctx, pose));
}

function drawCharacterBody(ctx: CanvasRenderingContext2D, pose: CharacterPose) {
  const art = characterFor(pose.char ?? pose.seat);
  const beaked = art.kind === "chick" || art.kind === "penguin";
  const { x, y, now } = pose;
  const hurt = pose.hurt ?? 0;
  const breathe = Math.sin(now / 420 + pose.seat) * 0.8;
  const bounce = pose.active ? Math.abs(Math.sin(now / 230)) * 2.4 : 0;
  const squash = 1 + hurt * 0.18;
  const rx = 15 * squash;
  const ry = (16 + breathe * 0.6) / squash;
  const cx = x + (hurt > 0 ? Math.sin(now / 18) * 2.5 * hurt : 0);
  const cy = y - 17 - bounce;
  const f = pose.facing;

  // Ground shadow.
  ctx.save();
  ctx.fillStyle = "rgba(40, 30, 20, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 14 - bounce, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Ears / accessories behind the body.
  if (art.kind === "bunny") {
    for (const s of [-1, 1]) {
      const tilt = s * 0.18 + Math.sin(now / 600 + s) * 0.05;
      ctx.save();
      ctx.translate(cx + s * 6, cy - ry + 4);
      ctx.rotate(tilt);
      ctx.fillStyle = art.base;
      ctx.strokeStyle = art.dark;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, -13, 4.6, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = art.light;
      ctx.beginPath();
      ctx.ellipse(0, -12, 2.2, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  if (art.kind === "cat") {
    // Tail on the side away from the target.
    const sway = Math.sin(now / 300) * 4;
    crayon(ctx, [cx - f * 12, cy + 8, cx - f * 22, cy + 2, cx - f * 24 + sway, cy - 10], art.dark, 6.5, () => 0.5);
    crayon(ctx, [cx - f * 12, cy + 8, cx - f * 22, cy + 2, cx - f * 24 + sway, cy - 10], art.base, 4, () => 0.5);
    for (const s of [-1, 1]) {
      ctx.fillStyle = art.base;
      ctx.strokeStyle = art.dark;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx + s * 4, cy - ry + 3);
      ctx.lineTo(cx + s * 12, cy - ry - 9);
      ctx.lineTo(cx + s * 13.5, cy - ry + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fda4af";
      ctx.beginPath();
      ctx.moveTo(cx + s * 7, cy - ry + 3);
      ctx.lineTo(cx + s * 11.5, cy - ry - 4);
      ctx.lineTo(cx + s * 12, cy - ry + 4);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Feet.
  for (const s of [-1, 1]) {
    ctx.fillStyle = beaked ? "#f59e0b" : art.dark;
    ctx.beginPath();
    ctx.ellipse(cx + s * 6, y - 2, 5.5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body with shading.
  const g = ctx.createRadialGradient(cx - 5, cy - 7, 2, cx, cy, rx + 4);
  g.addColorStop(0, art.light);
  g.addColorStop(0.45, art.base);
  g.addColorStop(1, art.dark);
  ctx.fillStyle = g;
  ctx.strokeStyle = art.dark;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Belly.
  ctx.fillStyle = art.belly;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 6, rx * 0.55, ry * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Gloss.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(cx - 7, cy - 9, 3.2, 2, -0.6, 0, Math.PI * 2);
  ctx.fill();

  if (art.kind === "penguin") {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, rx * 0.72, ry * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (art.kind === "chick") {
    for (const [dx, h] of [
      [-3, 7],
      [0, 10],
      [3, 7],
    ] as const) {
      crayon(ctx, [cx + dx, cy - ry + 1, cx + dx * 1.6 + Math.sin(now / 300) * 1.2, cy - ry - h], art.dark, 2, () => 0.5);
    }
  }

  // Frog eye bumps sit on top of the head.
  const eyeY = art.kind === "frog" ? cy - ry + 2 : cy - 3;
  const eyeDX = art.kind === "frog" ? 7.5 : 5.6;
  if (art.kind === "frog") {
    for (const s of [-1, 1]) {
      ctx.fillStyle = art.base;
      ctx.strokeStyle = art.dark;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cx + s * eyeDX, eyeY, 6.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Eyes.
  let lx = f * 1.6;
  let ly = 0;
  if (pose.look) {
    const dx = pose.look.x - cx;
    const dy = pose.look.y - eyeY;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    lx = (dx / d) * 1.9;
    ly = (dy / d) * 1.6;
  }
  const blinkPhase = (now + (pose.blinkSeed ?? pose.seat * 977)) % 3600;
  const blinking = blinkPhase < 130;
  for (const s of [-1, 1]) {
    const ex = cx + s * eyeDX;
    if (hurt > 0.15) {
      crayon(ctx, [ex - 2.6, eyeY - 2.6, ex + 2.6, eyeY + 2.6], "#1f2937", 2, () => 0.5);
      crayon(ctx, [ex + 2.6, eyeY - 2.6, ex - 2.6, eyeY + 2.6], "#1f2937", 2, () => 0.5);
      continue;
    }
    if (blinking) {
      crayon(ctx, [ex - 3, eyeY, ex + 3, eyeY], "#1f2937", 2, () => 0.5);
      continue;
    }
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 3.9, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(ex + lx, eyeY + ly, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex + lx - 0.8, eyeY + ly - 0.9, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Blush + mouth.
  ctx.fillStyle = "rgba(244, 114, 182, 0.45)";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * 9.5, cy + 3, 3, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const my = art.kind === "frog" ? cy + 1 : cy + 4;
  if (beaked) {
    const bx = cx + f * 1.5;
    const open = hurt > 0.15 ? 2.5 : 0;
    ctx.fillStyle = "#f59e0b";
    ctx.strokeStyle = "#b45309";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bx - 4, my - 1 - open);
    ctx.lineTo(bx + f * 6, my + 0.5);
    ctx.lineTo(bx + 4, my - 1 - open);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx - 3.5, my + open);
    ctx.lineTo(bx + f * 5, my + 1.2 + open);
    ctx.lineTo(bx + 3.5, my + open);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (hurt > 0.15) {
    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.ellipse(cx, my + 1.5, 2.6, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (art.kind === "frog") {
    crayon(ctx, [cx - 7, my, cx - 3, my + 3, cx + 3, my + 3, cx + 7, my], "#1f2937", 1.8, () => 0.5);
  } else {
    crayon(ctx, [cx - 3, my, cx - 1.5, my + 1.8, cx, my + 0.6, cx + 1.5, my + 1.8, cx + 3, my], "#1f2937", 1.6, () => 0.5);
  }
  if (art.kind === "cat") {
    for (const s of [-1, 1]) {
      crayon(ctx, [cx + s * 9, cy + 1, cx + s * 17, cy - 1], "rgba(31,41,55,0.6)", 1, () => 0.5);
      crayon(ctx, [cx + s * 9, cy + 3.5, cx + s * 17, cy + 4.5], "rgba(31,41,55,0.6)", 1, () => 0.5);
    }
  }

  // Hats / bows in front.
  if (art.kind === "wizard") {
    const hy = cy - ry + 3;
    const sway = Math.sin(now / 500) * 1.5;
    ctx.fillStyle = "#4c1d95";
    ctx.strokeStyle = "#2e1065";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - 14, hy);
    ctx.quadraticCurveTo(cx - 2, hy - 8, cx + 2 + sway, hy - 26);
    ctx.quadraticCurveTo(cx + 6, hy - 10, cx + 14, hy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#6d28d9";
    ctx.beginPath();
    ctx.ellipse(cx, hy, 16, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#facc15";
    ctx.font = `bold 9px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("★", cx + 1, hy - 7);
  }
  if (art.kind === "bunny") {
    const by = cy - ry + 4;
    ctx.fillStyle = "#e11d48";
    ctx.strokeStyle = "#881337";
    ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + 9, by);
      ctx.lineTo(cx + 9 + s * 6, by - 4);
      ctx.lineTo(cx + 9 + s * 6, by + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx + 9, by, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hands + the crayon weapon.
  const holdAngle = pose.holdAngle ?? (f > 0 ? 35 : 145);
  const hx = cx + f * 12;
  const hy = cy + 3;
  heldCrayon(ctx, hx, hy, holdAngle, art);
  for (const s of [-1, 1]) {
    const px = s === f ? hx : cx - f * 13;
    const py = s === f ? hy : cy + 5;
    ctx.fillStyle = art.base;
    ctx.strokeStyle = art.dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Hit flash.
  if (hurt > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = Math.min(0.75, hurt);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx - 30, cy - 40, 60, 60);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Status visuals.
  const sts = pose.statuses ?? [];
  if (sts.includes("blind")) {
    // Blindfold across the eyes.
    ctx.save();
    ctx.fillStyle = "#1e1b4b";
    ctx.beginPath();
    ctx.roundRect(cx - rx, cy - 7, rx * 2, 7, 3);
    ctx.fill();
    ctx.restore();
  }
  if (sts.includes("stun")) {
    // Stars circling the head.
    for (let k = 0; k < 3; k++) {
      const a = now / 260 + (k * Math.PI * 2) / 3;
      const sx = cx + Math.cos(a) * 14;
      const sy = cy - ry - 6 + Math.sin(a) * 4;
      ctx.save();
      ctx.fillStyle = "#facc15";
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 4 : 1.8;
        const b = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i === 0) ctx.moveTo(sx + Math.cos(b) * r, sy + Math.sin(b) * r);
        else ctx.lineTo(sx + Math.cos(b) * r, sy + Math.sin(b) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  if (sts.includes("slow")) {
    // Sticky slime puddle at the feet.
    ctx.save();
    ctx.fillStyle = "rgba(34, 211, 238, 0.45)";
    ctx.beginPath();
    ctx.ellipse(x, y, 17, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.ellipse(x + k * 9, y - 2 + Math.sin(now / 300 + k) * 1.5, 2.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  if (sts.includes("confuse")) {
    ctx.save();
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#64748b";
    ctx.fillText("?", cx + Math.sin(now / 200) * 9, cy - ry - 6);
    ctx.fillText("?", cx - Math.sin(now / 200) * 9, cy - ry - 12);
    ctx.restore();
  }
  if (sts.includes("weaken") || sts.includes("vulnerable")) {
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.1 * Math.sin(now / 200);
    ctx.fillStyle = sts.includes("vulnerable") ? "#f97316" : "#a855f7";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 5, ry + 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (pose.frozen) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    const ice = ctx.createLinearGradient(cx - 18, cy - 24, cx + 18, cy + 18);
    ice.addColorStop(0, "#e0f2fe");
    ice.addColorStop(1, "#7dd3fc");
    ctx.fillStyle = ice;
    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 19, y);
    ctx.lineTo(cx - 21, cy - 14);
    ctx.lineTo(cx - 8, cy - 26);
    ctx.lineTo(cx + 12, cy - 24);
    ctx.lineTo(cx + 21, cy - 8);
    ctx.lineTo(cx + 18, y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - 14);
    ctx.lineTo(cx - 6, cy - 21);
    ctx.stroke();
    ctx.restore();
  }
  if (pose.burn) {
    for (let k = 0; k < 3; k++) {
      const fx = cx - 8 + k * 8;
      const fl = 6 + Math.sin(now / 90 + k * 2) * 2.5;
      ctx.save();
      ctx.fillStyle = "rgba(249, 115, 22, 0.85)";
      ctx.beginPath();
      ctx.moveTo(fx - 3.5, cy - ry - 2);
      ctx.quadraticCurveTo(fx, cy - ry - 2 - fl * 2, fx + 3.5, cy - ry - 2);
      ctx.fill();
      ctx.fillStyle = "rgba(253, 224, 71, 0.9)";
      ctx.beginPath();
      ctx.moveTo(fx - 1.6, cy - ry - 2);
      ctx.quadraticCurveTo(fx, cy - ry - 2 - fl, fx + 1.6, cy - ry - 2);
      ctx.fill();
      ctx.restore();
    }
  }
  if (pose.poison) {
    for (let k = 0; k < 3; k++) {
      const t = ((now / 900 + k / 3) % 1 + 1) % 1;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = "#16a34a";
      ctx.fillStyle = "rgba(134, 239, 172, 0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx - 10 + k * 10 + Math.sin(t * 6 + k) * 2, cy - ry - t * 18, 2 + k * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

export function drawTombstone(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number, now: number) {
  aroundFeet(ctx, x, y, CHAR_SCALE, () => drawTombstoneBody(ctx, x, y, seat, now));
}

function drawTombstoneBody(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number, now: number) {
  const art = characterFor(seat);
  ctx.save();
  ctx.fillStyle = "rgba(40,30,20,0.2)";
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 15, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(x - 13, 0, x + 13, 0);
  g.addColorStop(0, "#9ca3af");
  g.addColorStop(1, "#6b7280");
  ctx.fillStyle = g;
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x - 13, y);
  ctx.lineTo(x - 13, y - 20);
  ctx.quadraticCurveTo(x - 13, y - 33, x, y - 33);
  ctx.quadraticCurveTo(x + 13, y - 33, x + 13, y - 20);
  ctx.lineTo(x + 13, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f3f4f6";
  ctx.font = `bold 9px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("RIP", x, y - 16);
  // Little ghost in the character's color.
  const gy = y - 48 + Math.sin(now / 380 + seat) * 3;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = art.light;
  ctx.beginPath();
  ctx.arc(x + 10, gy, 7, Math.PI, 0);
  ctx.lineTo(x + 17, gy + 8);
  ctx.lineTo(x + 13, gy + 5);
  ctx.lineTo(x + 10, gy + 8);
  ctx.lineTo(x + 7, gy + 5);
  ctx.lineTo(x + 3, gy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(x + 8, gy - 1, 1.1, 0, Math.PI * 2);
  ctx.arc(x + 12, gy - 1, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Name pill + HP bar with a trailing "ghost" chunk for recent damage. */
export function drawNameplate(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number, name: string, hp: number, ghostHp: number, statuses: readonly StatusId[] = []) {
  const art = characterFor(seat);
  ctx.save();
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = name.length > 9 ? `${name.slice(0, 8)}…` : name;
  const w = Math.max(48, ctx.measureText(label).width + 16);
  const top = y - 94;
  ctx.fillStyle = art.base;
  ctx.strokeStyle = art.dark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, top, w, 18, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x, top + 9.5);
  if (statuses.length > 0) {
    // Status icon row above the name pill.
    ctx.font = "12px sans-serif";
    const icons = statuses.map((s) => STATUS_INFO[s].emoji);
    const w2 = icons.length * 15;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(x - w2 / 2 - 3, top - 18, w2 + 6, 16, 8);
    ctx.fill();
    icons.forEach((ic, i) => ctx.fillText(ic, x - w2 / 2 + 7.5 + i * 15, top - 9.5));
  }

  const bw = 46;
  const by = top + 22;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, by, bw, 7, 3.5);
  ctx.fill();
  if (ghostHp > hp) {
    ctx.fillStyle = "#fca5a5";
    ctx.beginPath();
    ctx.roundRect(x - bw / 2, by, (bw * Math.min(100, ghostHp)) / 100, 7, 3.5);
    ctx.fill();
  }
  const hg = ctx.createLinearGradient(0, by, 0, by + 7);
  const [c1, c2] = hp > 50 ? ["#86efac", "#16a34a"] : hp > 25 ? ["#fde68a", "#d97706"] : ["#fca5a5", "#dc2626"];
  hg.addColorStop(0, c1);
  hg.addColorStop(1, c2);
  ctx.fillStyle = hg;
  if (hp > 0) {
    ctx.beginPath();
    ctx.roundRect(x - bw / 2, by, Math.max(3, (bw * hp) / 100), 7, 3.5);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, by, bw, 7, 3.5);
  ctx.stroke();
  ctx.restore();
}

/** Bouncing "your turn" arrow. */
export function drawTurnMarker(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, lift = 0) {
  const b = Math.sin(now / 160) * 3 - lift;
  ctx.save();
  ctx.fillStyle = "#fbbf24";
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 114 + b);
  ctx.lineTo(x + 9, y - 114 + b);
  ctx.lineTo(x, y - 101 + b);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Walls & projectile
// ---------------------------------------------------------------------------

/** 🛡️ Shield: glassy bubble glow around the drawn outline, flickering as it weakens. */
export function drawShieldArt(ctx: CanvasRenderingContext2D, w: Wall, ratio: number, preview = false, now = 0) {
  const color = INK_COLORS[w.color] ?? INK_COLORS[0];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const flicker = ratio < 0.4 ? 0.6 + 0.4 * Math.abs(Math.sin(now / 70)) : 1;
  ctx.globalAlpha = (preview ? 0.55 : 0.5 + 0.5 * ratio) * flicker;
  for (const s of w.strokes) {
    if (s.length < 4) continue;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]);
    };
    ctx.shadowColor = "#38bdf8";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "rgba(186, 230, 253, 0.85)";
    ctx.lineWidth = 11;
    if (preview) ctx.setLineDash([10, 7]);
    path();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    path();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.4;
    path();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawWallArt(ctx: CanvasRenderingContext2D, walls: readonly Wall[], now = 0) {
  for (const w of walls) {
    const ratio = Math.max(0.2, Math.min(1, w.hp / w.maxHp));
    const color = INK_COLORS[w.color] ?? INK_COLORS[0];
    if (w.shieldOf !== undefined) {
      drawShieldArt(ctx, w, ratio, false, now);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.6 * ratio;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of w.strokes) {
      if (s.length < 4) continue;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]);
        for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]);
      };
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowOffsetY = 2;
      ctx.shadowBlur = 3;
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 10;
      path();
      ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = color;
      ctx.lineWidth = 7;
      path();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s[0] - 1.5, s[1] - 1.5);
      for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i] - 1.5, s[i + 1] - 1.5);
      ctx.stroke();
      // Cracks when damaged.
      if (ratio < 0.7) {
        ctx.strokeStyle = "#fbf7ec";
        ctx.lineWidth = 1.4;
        const cracks = ratio < 0.4 ? 3 : 1;
        for (let k = 0; k < cracks; k++) {
          const i = Math.floor(((k + 1) / (cracks + 1)) * (s.length / 2)) * 2;
          const px = s[i];
          const py = s[i + 1];
          ctx.beginPath();
          ctx.moveTo(px - 4, py - 3);
          ctx.lineTo(px, py + 1);
          ctx.lineTo(px + 3, py - 2);
          ctx.lineTo(px + 5, py + 3);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  shape: readonly { c: number; p: number[] }[],
  element: Element,
  x: number,
  y: number,
  c: number,
  s: number,
  alpha = 1,
  glow = true,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pass = (width: number, color: string) => {
    for (const st of shape) {
      ctx.strokeStyle = color === "ink" ? INK_COLORS[st.c] : color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < st.p.length; i += 2) {
        const px = x + st.p[i] * c - st.p[i + 1] * s;
        const py = y + st.p[i] * s + st.p[i + 1] * c;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  };
  if (glow) {
    ctx.shadowColor = ELEMENT_GLOW[element];
    ctx.shadowBlur = 16;
    pass(7, "rgba(255,255,255,0.9)");
    ctx.shadowBlur = 0;
  }
  pass(4.5, "ink");
  if (glow) pass(1.3, "rgba(255,255,255,0.65)");
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Particles / FX
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: "drop" | "smoke" | "spark" | "ember" | "bubble" | "shard" | "chunk";
  g: number;
  rot: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  color: string;
}

interface Splat {
  x: number;
  y: number;
  blobs: [number, number, number][];
  color: string;
}

export class Fx {
  particles: Particle[] = [];
  rings: Ring[] = [];
  splats: Splat[] = [];
  shake = 0;
  flash = 0;
  private last = 0;

  emit(p: Partial<Particle> & { x: number; y: number }) {
    if (this.particles.length > 420) return;
    this.particles.push({ vx: 0, vy: 0, life: 0, max: 600, size: 3, color: "#111827", kind: "drop", g: 0, rot: Math.random() * 6, ...p });
  }

  /** Element-flavored trail bits behind a flying doodle. */
  trail(x: number, y: number, element: Element, ink: string) {
    const r = Math.random;
    switch (element) {
      case "fire":
        this.emit({ x, y, vx: (r() - 0.5) * 30, vy: -20 - r() * 30, max: 500, size: 2 + r() * 2.5, color: r() < 0.5 ? "#f97316" : "#facc15", kind: "ember" });
        break;
      case "ice":
        this.emit({ x, y, vx: (r() - 0.5) * 20, vy: (r() - 0.5) * 20, max: 600, size: 2 + r() * 2, color: "#bae6fd", kind: "shard" });
        break;
      case "poison":
        this.emit({ x, y, vx: (r() - 0.5) * 15, vy: -10 - r() * 15, max: 700, size: 1.5 + r() * 2.5, color: "#86efac", kind: "bubble" });
        break;
      case "shock":
        this.emit({ x, y, vx: (r() - 0.5) * 120, vy: (r() - 0.5) * 120, max: 220, size: 1.5, color: "#fde047", kind: "spark" });
        break;
      default:
        this.emit({ x, y, vx: (r() - 0.5) * 10, vy: (r() - 0.5) * 10, max: 420, size: 1.2 + r() * 1.5, color: ink, kind: "drop" });
    }
  }

  /** Impact burst: ink droplets, dirt chunks, smoke, shockwave, flash, shake, lasting splat. */
  explode(x: number, y: number, radius: number, element: Element, ink: string, opts: { dirt: boolean; power: number }) {
    const r = Math.random;
    const glow = ELEMENT_GLOW[element];
    const n = 26 + Math.round(radius * 0.5);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const sp = 80 + r() * (160 + radius * 3);
      this.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, max: 600 + r() * 500, size: 2 + r() * 3.5, color: r() < 0.65 ? ink : glow, kind: "drop", g: 520 });
    }
    if (opts.dirt) {
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
        const sp = 120 + r() * 220;
        this.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 900, size: 2.5 + r() * 3.5, color: r() < 0.5 ? "#a16207" : "#78350f", kind: "chunk", g: 650 });
      }
    }
    for (let i = 0; i < 8; i++) {
      this.emit({ x: x + (r() - 0.5) * radius, y: y + (r() - 0.5) * radius * 0.6, vx: (r() - 0.5) * 30, vy: -20 - r() * 25, max: 1100, size: 8 + r() * 10, color: "rgba(120,113,108,0.35)", kind: "smoke" });
    }
    for (let i = 0; i < 10; i++) this.trail(x + (r() - 0.5) * radius, y + (r() - 0.5) * radius, element, ink);
    this.rings.push({ x, y, r: 6, max: Math.max(30, radius * 1.5), life: 0, color: glow });
    const blobs: [number, number, number][] = [];
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * Math.max(10, radius * 0.45);
      blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.5, 2 + r() * 6]);
    }
    this.splats.push({ x, y, blobs, color: ink });
    if (this.splats.length > 28) this.splats.shift();
    this.shake = Math.min(16, 4 + opts.power / 3);
    this.flash = 0.35;
  }

  update(now: number) {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    for (const p of this.particles) {
      p.life += dt * 1000;
      p.vy += p.g * dt;
      if (p.kind === "smoke") {
        p.size += dt * 14;
        p.vx *= 0.98;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += dt * 6;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const ring of this.rings) ring.life += dt * 1000;
    this.rings = this.rings.filter((ring) => ring.life < 450);
    this.shake *= Math.pow(0.002, dt);
    if (this.shake < 0.2) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  /** Lasting ink splats (drawn under characters). */
  drawSplats(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const s of this.splats) {
      ctx.fillStyle = s.color;
      ctx.globalAlpha = 0.28;
      for (const [dx, dy, r] of s.blobs) {
        ctx.beginPath();
        ctx.arc(s.x + dx, s.y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const ring of this.rings) {
      const k = ring.life / 450;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r + (ring.max - ring.r) * Math.sqrt(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = p.kind === "smoke" ? (1 - k) * 0.9 : 1 - k * k;
      ctx.fillStyle = p.color;
      switch (p.kind) {
        case "spark":
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
          break;
        case "shard":
        case "chunk":
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * (p.kind === "shard" ? 1.8 : 1));
          ctx.restore();
          break;
        case "bubble":
          ctx.strokeStyle = "#16a34a";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        default:
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (p.kind === "ember" ? 1 - k * 0.6 : 1), 0, Math.PI * 2);
          ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Misc overlays
// ---------------------------------------------------------------------------

/** Flickering lightning bolt between two points. */
export function drawBolt(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, alpha: number) {
  const pts: number[] = [ax, ay];
  const segs = 8;
  for (let j = 1; j < segs; j++) {
    const t = j / segs;
    const nx = -(by - ay);
    const ny = bx - ax;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    const off = (Math.random() - 0.5) * 22;
    pts.push(ax + (bx - ax) * t + (nx / nl) * off, ay + (by - ay) * t + (ny / nl) * off);
  }
  pts.push(bx, by);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const stroke = (w: number, color: string, blur: number) => {
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  };
  stroke(7, "rgba(250, 204, 21, 0.55)", 18);
  stroke(2.4, "#fffbe6", 0);
  ctx.restore();
}

/** Comic-book onomatopoeia that pops in with an elastic scale. */
export function drawComicText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: number, color: string, size = 30) {
  const k = Math.min(1, t / 260);
  const scale = k < 1 ? 0.3 + 1.0 * k + Math.sin(k * Math.PI) * 0.35 : 1;
  const alpha = 1 - Math.max(0, (t - 900) / 450);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.scale(scale, scale);
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 7;
  ctx.strokeText(text, 0, 0);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Floating damage number with outline. */
export function drawDamageNumber(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: number, crit: boolean) {
  const rise = Math.min(1, t / 900) * 34;
  const alpha = 1 - Math.max(0, (t - 950) / 450);
  if (alpha <= 0) return;
  const pop = t < 160 ? 0.6 + (t / 160) * 0.6 : 1.2 - Math.min(0.2, (t - 160) / 800);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - rise);
  ctx.scale(pop, pop);
  ctx.font = `900 ${crit ? 26 : 21}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = crit ? "#d97706" : "#dc2626";
  ctx.fillText(text, 0, 0);
  if (crit) {
    ctx.font = `900 11px ${FONT}`;
    ctx.strokeText("치명타!", 0, -20);
    ctx.fillStyle = "#b45309";
    ctx.fillText("치명타!", 0, -20);
  }
  ctx.restore();
}

/** Aim arrow from the muzzle; length tracks power. */
export function drawAimArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angleDeg: number, power: number, color: string, now: number) {
  const a = (angleDeg * Math.PI) / 180;
  const len = 26 + power * 0.75;
  const ex = x + Math.cos(a) * len;
  const ey = y - Math.sin(a) * len;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(17,24,39,0.35)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const g = ctx.createLinearGradient(x, y, ex, ey);
  g.addColorStop(0, color);
  g.addColorStop(1, "#fbbf24");
  ctx.strokeStyle = g;
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 5]);
  ctx.lineDashOffset = -now / 40;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#fbbf24";
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ex + Math.cos(a) * 10, ey - Math.sin(a) * 10);
  ctx.lineTo(ex + Math.cos(a + 2.4) * 9, ey - Math.sin(a + 2.4) * 9);
  ctx.lineTo(ex + Math.cos(a - 2.4) * 9, ey - Math.sin(a - 2.4) * 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Power ring.
  ctx.strokeStyle = "rgba(17,24,39,0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y + 17, 25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = power > 75 ? "#ef4444" : power > 45 ? "#f59e0b" : "#22c55e";
  ctx.beginPath();
  ctx.arc(x, y + 17, 25, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * power) / 100);
  ctx.stroke();
  ctx.restore();
}

/** Drifting wind streaks across the sky. */
export class WindStreaks {
  private streaks = Array.from({ length: 12 }, () => ({ x: Math.random() * WORLD_W, y: 40 + Math.random() * 260, len: 20 + Math.random() * 40, phase: Math.random() * 6 }));
  private last = 0;

  draw(ctx: CanvasRenderingContext2D, wind: number, now: number) {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    const speed = wind * 9000;
    const strength = Math.min(1, Math.abs(wind) / 0.04);
    if (strength < 0.05) return;
    ctx.save();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
    ctx.lineCap = "round";
    ctx.lineWidth = 1.6;
    for (const s of this.streaks) {
      s.x += speed * dt * (0.7 + s.len / 80);
      if (s.x > WORLD_W + 60) s.x = -60;
      if (s.x < -60) s.x = WORLD_W + 60;
      ctx.globalAlpha = 0.25 + 0.5 * strength;
      const wob = Math.sin(now / 400 + s.phase) * 3;
      const dir = wind > 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + wob);
      ctx.quadraticCurveTo(s.x - dir * s.len * 0.5, s.y + wob - 4, s.x - dir * s.len * strength, s.y + wob);
      ctx.stroke();
    }
    ctx.restore();
  }
}

