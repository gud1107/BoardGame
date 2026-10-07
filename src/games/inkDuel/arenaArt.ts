/**
 * 낙서 결투 — arena artwork (client-only rendering, no game rules).
 *
 * Style: a crayon / watercolor sketchbook page. Static layers (paper +
 * scenery, terrain) are pre-rendered to offscreen canvases; characters,
 * projectiles and particles are drawn every frame. Math.random is fine here —
 * nothing in this file feeds back into the lockstep engine.
 */

import { INK_COLORS, type Element } from "./analyze";
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
  kind: "wizard" | "cat" | "frog" | "bunny";
}

export const CHARACTERS: CharacterArt[] = [
  { name: "보라 마법사", base: "#8b5cf6", light: "#c4b5fd", dark: "#4c1d95", belly: "#ede9fe", kind: "wizard" },
  { name: "귤 고양이", base: "#fb923c", light: "#fed7aa", dark: "#9a3412", belly: "#fff7ed", kind: "cat" },
  { name: "민트 개구리", base: "#14b8a6", light: "#99f6e4", dark: "#115e59", belly: "#f0fdfa", kind: "frog" },
  { name: "딸기 토끼", base: "#f472b6", light: "#fbcfe8", dark: "#9d174d", belly: "#fdf2f8", kind: "bunny" },
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

export function renderBackground(dpr: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(WORLD_W, WORLD_H, dpr);
  const rng = mulberry(7);

  // Paper + soft sky wash.
  ctx.fillStyle = "#fbf7ec";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H * 0.75);
  sky.addColorStop(0, "rgba(125, 196, 245, 0.38)");
  sky.addColorStop(0.55, "rgba(186, 225, 250, 0.18)");
  sky.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Paper grain.
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rng() < 0.5 ? "rgba(120, 100, 70, 0.05)" : "rgba(255, 255, 255, 0.25)";
    ctx.fillRect(rng() * WORLD_W, rng() * WORLD_H, 1 + rng() * 1.5, 1 + rng());
  }

  // Ruled lines + margin.
  ctx.strokeStyle = "rgba(96, 140, 210, 0.22)";
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

  // Sun with a smiley.
  const sx = WORLD_W - 110;
  const sy = 82;
  const sun = ctx.createRadialGradient(sx, sy, 6, sx, sy, 52);
  sun.addColorStop(0, "rgba(253, 224, 71, 0.55)");
  sun.addColorStop(1, "rgba(253, 224, 71, 0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sx, sy, 52, 0, Math.PI * 2);
  ctx.fill();
  const ring: number[] = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    ring.push(sx + Math.cos(a) * 24, sy + Math.sin(a) * 24);
  }
  wash(ctx, ring, "#fde047", rng, 0.35);
  crayon(ctx, ring, "#f59e0b", 3, rng);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    crayon(ctx, [sx + Math.cos(a) * 32, sy + Math.sin(a) * 32, sx + Math.cos(a) * (42 + (i % 2) * 7), sy + Math.sin(a) * (42 + (i % 2) * 7)], "#f59e0b", 2.6, rng);
  }
  ctx.fillStyle = "#92400e";
  ctx.beginPath();
  ctx.arc(sx - 8, sy - 4, 2.4, 0, Math.PI * 2);
  ctx.arc(sx + 8, sy - 4, 2.4, 0, Math.PI * 2);
  ctx.fill();
  crayon(ctx, [sx - 9, sy + 6, sx - 4, sy + 10, sx + 4, sy + 10, sx + 9, sy + 6], "#92400e", 2, rng);

  // Clouds.
  const cloud = (cx: number, cy: number, s: number) => {
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
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    crayon(ctx, [...pts, pts[0], pts[1]], "#7dd3fc", 2.2, rng);
  };
  cloud(220, 92, 1.1);
  cloud(520, 60, 0.85);
  cloud(700, 140, 0.7);

  // Birds + doodle stars.
  for (const [bx, by] of [
    [360, 120],
    [385, 108],
    [600, 190],
  ]) {
    crayon(ctx, [bx - 8, by - 3, bx - 3, by, bx, by - 4, bx + 3, by, bx + 8, by - 3], "#475569", 1.8, rng);
  }
  for (const [stx, sty] of [
    [130, 190],
    [860, 210],
  ]) {
    const st: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const r = i % 2 === 0 ? 9 : 4;
      st.push(stx + Math.cos(a) * r, sty + Math.sin(a) * r);
    }
    crayon(ctx, st, "#fbbf24", 1.8, rng, 0.8);
  }

  // Distant watercolor hills (two layers).
  const hills = (base: number, amp: number, freq: number, phase: number, color: string, alpha: number) => {
    const pts: number[] = [0, WORLD_H];
    for (let x = 0; x <= WORLD_W; x += 16) pts.push(x, base - Math.sin(x * freq + phase) * amp - Math.sin(x * freq * 2.7 + phase * 2) * amp * 0.35);
    pts.push(WORLD_W, WORLD_H);
    wash(ctx, pts, color, rng, alpha);
  };
  hills(300, 34, 0.007, 1.2, "#a5b4fc", 0.16);
  hills(340, 26, 0.011, 3.1, "#86efac", 0.16);

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
  v.addColorStop(1, "rgba(80, 60, 30, 0.16)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  return c;
}

// ---------------------------------------------------------------------------
// Terrain — re-rendered only when the height array changes (craters)
// ---------------------------------------------------------------------------

export function renderTerrain(terrain: readonly number[], dpr: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(WORLD_W, WORLD_H, dpr);
  const rng = mulberry(31);
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
  soil.addColorStop(0, "#d9b27c");
  soil.addColorStop(0.45, "#b9834d");
  soil.addColorStop(1, "#7c4a24");
  ctx.fillStyle = soil;
  ctx.fill();
  ctx.clip();

  // Colored-pencil hatching.
  ctx.strokeStyle = "rgba(92, 52, 20, 0.16)";
  ctx.lineWidth = 1.3;
  for (let x = -WORLD_H; x < WORLD_W; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, WORLD_H);
    ctx.lineTo(x + WORLD_H * 0.8, 0);
    ctx.stroke();
  }
  // Strata following the surface.
  for (const [off, col] of [
    [26, "rgba(120, 72, 32, 0.35)"],
    [62, "rgba(110, 64, 28, 0.3)"],
    [108, "rgba(90, 50, 20, 0.3)"],
  ] as const) {
    const pts: number[] = [];
    for (let x = 0; x <= WORLD_W; x += 10) pts.push(x, surfaceY(terrain, x) + off + Math.sin(x * 0.05 + off) * 4);
    crayon(ctx, pts, col, 3, rng);
  }
  // Pebbles + fossils.
  for (let i = 0; i < 90; i++) {
    const x = rng() * WORLD_W;
    const top = surfaceY(terrain, x) + 14;
    const y = top + rng() * (WORLD_H - top);
    const r = 2 + rng() * 4;
    ctx.fillStyle = rng() < 0.5 ? "rgba(120, 113, 108, 0.55)" : "rgba(168, 162, 158, 0.6)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.3, r, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(68, 64, 60, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  // Grass band + tufts along the surface.
  const top: number[] = [];
  for (let x = 0; x <= WORLD_W; x += 6) top.push(x, surfaceY(terrain, x));
  crayon(ctx, top, "#4d7c0f", 9, rng);
  crayon(ctx, top, "#84cc16", 5, rng);
  for (let x = 2; x < WORLD_W; x += 5 + rng() * 4) {
    const y = surfaceY(terrain, x);
    const h = 4 + rng() * 6;
    const lean = (rng() - 0.5) * 5;
    crayon(ctx, [x, y + 1, x + lean, y - h], rng() < 0.5 ? "#65a30d" : "#3f6212", 1.6, rng);
  }
  // Occasional flowers.
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
  return c;
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
  /** Seat-specific blink offset so characters don't blink in sync. */
  blinkSeed?: number;
  /** Size multiplier around the feet (default CHAR_SCALE; avatars pass 1). */
  scale?: number;
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
  const art = characterFor(pose.seat);
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
    ctx.fillStyle = art.dark;
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
  if (hurt > 0.15) {
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
export function drawNameplate(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number, name: string, hp: number, ghostHp: number) {
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
export function drawTurnMarker(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  const b = Math.sin(now / 160) * 3;
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

export function drawWallArt(ctx: CanvasRenderingContext2D, walls: readonly Wall[]) {
  for (const w of walls) {
    const ratio = Math.max(0.2, Math.min(1, w.hp / w.maxHp));
    const color = INK_COLORS[w.color] ?? INK_COLORS[0];
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

