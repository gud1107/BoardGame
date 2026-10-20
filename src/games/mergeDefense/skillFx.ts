/**
 * Tower-skill visual effects (canvas, vector only — no emoji on the board).
 *
 * Proc skills (counted "every Nth shot" in the engine: 처형·빙결·감전·충격파·
 * 마력 증폭·속사·정전기) get big, layered bursts. Always-on skills (출혈·약점
 * 사격·화상·중력장·얼음 파편·한파·과부하·전염·부식) get lighter per-hit
 * accents that MergeDefenseBoard throttles per tower. `big` = 신화 (scaled up,
 * gold trim).
 */
import type { SkillId } from "./engine";

type Ctx = CanvasRenderingContext2D;

export interface SkillFx {
  type: "skill";
  skill: SkillId;
  /** Main target (first hit). */
  x: number;
  y: number;
  /** All hit positions [x0, y0, x1, y1, …] (chains, splashes). */
  pts: number[];
  /** The tower that fired. */
  from: { x: number; y: number };
  big: boolean;
  t0: number;
  dur: number;
  seed: number;
}

/** How long each skill's effect plays (ms). */
export const SKILL_FX_MS: Partial<Record<SkillId, number>> = {
  execute: 900,
  freeze: 950,
  shock: 650,
  shockwave: 700,
  amplify: 750,
  rapid: 420,
  static: 380,
  bleed: 520,
  weakspot: 480,
  burn: 650,
  gravity: 700,
  shards: 420,
  blizzard: 800,
  overload: 520,
  plague: 800,
  corrode: 600,
  concuss: 800,
  chainblast: 900,
  judgment: 900,
  tornado: 900,
  whirl: 520,
  gust: 420,
  radiance: 420,
  apshell: 420,
  shrapnel: 500,
  torchlight: 650,
  beacon: 560,
  freedom: 950,
  ponder: 600,
  insight: 420,
  epiphany: 900,
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** Deterministic per-effect pseudo-random in [0, 1). */
function rnd(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function glow(ctx: Ctx, color: string, blur: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function jagged(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, segs: number, amp: number, seed: number) {
  ctx.moveTo(x0, y0);
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const nx = -(y1 - y0);
    const ny = x1 - x0;
    const len = Math.hypot(nx, ny) || 1;
    const off = (rnd(seed, i) - 0.5) * 2 * amp;
    ctx.lineTo(x0 + (x1 - x0) * t + (nx / len) * off, y0 + (y1 - y0) * t + (ny / len) * off);
  }
  ctx.lineTo(x1, y1);
}

function burstDots(ctx: Ctx, x: number, y: number, k: number, n: number, dist: number, r: number, color: string, seed: number, gravity = 0) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(seed, i) * 0.8;
    const d = dist * easeOut(k) * (0.6 + rnd(seed, i + 40) * 0.6);
    ctx.globalAlpha = (1 - k) * 0.95;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d + gravity * k * k, r * (1 - k * 0.7), 0, Math.PI * 2);
    ctx.fill();
  }
}

function pointsOf(f: SkillFx): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < f.pts.length; i += 2) out.push({ x: f.pts[i], y: f.pts[i + 1] - 4 });
  if (out.length === 0) out.push({ x: f.x, y: f.y });
  return out;
}

// ---------------------------------------------------------------------------
// Proc skills — the big ones.
// ---------------------------------------------------------------------------

/** 처형: blood-red X slash, a vector skull stamp, crimson shockwave and gore sparks. */
function drawExecute(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.35 : 1;
  const { x, y } = f;
  // Dark pulse behind everything.
  ctx.globalAlpha = 0.5 * (1 - k);
  const vg = ctx.createRadialGradient(x, y, 0, x, y, 60 * s);
  vg.addColorStop(0, "rgba(127,29,29,0.9)");
  vg.addColorStop(1, "rgba(127,29,29,0)");
  ctx.fillStyle = vg;
  ctx.beginPath();
  ctx.arc(x, y, 60 * s, 0, Math.PI * 2);
  ctx.fill();
  // X slash drawn in over the first 22%.
  const draw = clamp01(k / 0.22);
  const fade = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
  const L = 26 * s;
  ctx.globalAlpha = fade;
  ctx.lineCap = "round";
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
  ]) {
    glow(ctx, "#ef4444", 14);
    ctx.strokeStyle = "#fecaca";
    ctx.lineWidth = 4.5 * s * (1 - k * 0.6);
    ctx.beginPath();
    ctx.moveTo(x - dx * L, y - dy * L);
    ctx.lineTo(x - dx * L + dx * 2 * L * draw, y - dy * L + dy * 2 * L * draw);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.4 * s;
    ctx.stroke();
  }
  // Skull stamp: pops in with overshoot, rises and fades.
  const pop = k < 0.18 ? 0 : clamp01((k - 0.18) / 0.2);
  const scale = (pop < 1 ? pop * 1.25 : 1.25 - 0.25 * clamp01((k - 0.38) / 0.15)) * s;
  if (scale > 0) {
    ctx.save();
    ctx.translate(x, y - 18 * s - k * 14);
    ctx.scale(scale, scale);
    ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    glow(ctx, f.big ? "#fbbf24" : "#ef4444", 12);
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(0, -2, 9, Math.PI, 0);
    ctx.lineTo(9, 3);
    ctx.quadraticCurveTo(6, 6, 5, 9);
    ctx.lineTo(-5, 9);
    ctx.quadraticCurveTo(-6, 6, -9, 3);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.ellipse(-3.6, 0, 2.6, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(3.6, 0, 2.6, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(-1.4, 5.5);
    ctx.lineTo(1.4, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-4, 7.5, 1.2, 2);
    ctx.fillRect(-1, 7.5, 1.2, 2);
    ctx.fillRect(2, 7.5, 1.2, 2);
    if (f.big) {
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, -2, 11, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Crimson shock ring + sparks.
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 3 * (1 - k) + 0.5;
  ctx.beginPath();
  ctx.arc(x, y, 8 + easeOut(k) * 46 * s, 0, Math.PI * 2);
  ctx.stroke();
  burstDots(ctx, x, y, k, 14, 40 * s, 2.4, "#f87171", f.seed, 18);
}

/** 빙결: an ice block crystallises around the target, spikes flare out, then it shatters. */
function drawFreeze(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const { x, y } = f;
  const form = easeOut(clamp01(k / 0.3));
  const shatter = clamp01((k - 0.72) / 0.28);
  // Cold flash.
  ctx.globalAlpha = 0.55 * (1 - clamp01(k / 0.4));
  const g = ctx.createRadialGradient(x, y, 0, x, y, 44 * s);
  g.addColorStop(0, "rgba(240,249,255,0.95)");
  g.addColorStop(1, "rgba(125,211,252,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 44 * s, 0, Math.PI * 2);
  ctx.fill();
  // Radial ice spikes.
  ctx.globalAlpha = (1 - shatter) * 0.95;
  glow(ctx, "#7dd3fc", 10);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const len = (14 + rnd(f.seed, i) * 10) * s * form;
    ctx.fillStyle = i % 2 ? "#e0f2fe" : "#bae6fd";
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a - 0.22) * 9 * s, y + Math.sin(a - 0.22) * 9 * s);
    ctx.lineTo(x + Math.cos(a) * (9 * s + len), y + Math.sin(a) * (9 * s + len));
    ctx.lineTo(x + Math.cos(a + 0.22) * 9 * s, y + Math.sin(a + 0.22) * 9 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  // Hexagonal ice block.
  if (shatter < 1) {
    const r = 12 * s * (form < 1 ? form * 1.15 : 1);
    ctx.globalAlpha = 0.75 * (1 - shatter);
    ctx.fillStyle = "rgba(186,230,253,0.55)";
    ctx.strokeStyle = "#f0f9ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Glint sweeping across.
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    const gl = clamp01((k - 0.2) / 0.3);
    ctx.beginPath();
    ctx.moveTo(x - r + gl * r * 2 - 4, y - r * 0.6);
    ctx.lineTo(x - r + gl * r * 2 + 2, y + r * 0.6);
    ctx.stroke();
  }
  // Shatter shards.
  if (shatter > 0) {
    ctx.fillStyle = "#e0f2fe";
    for (let i = 0; i < 10; i++) {
      const a = rnd(f.seed, i + 10) * Math.PI * 2;
      const d = 6 + shatter * (28 + rnd(f.seed, i + 20) * 18) * s;
      ctx.globalAlpha = 1 - shatter;
      ctx.save();
      ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d + shatter * shatter * 10);
      ctx.rotate(a + shatter * 6);
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(1.6, 0);
      ctx.lineTo(0, 3);
      ctx.lineTo(-1.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  // Snowflake sparkles.
  ctx.strokeStyle = f.big ? "#fde68a" : "#ffffff";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + k * 2;
    const d = 22 * s;
    const sx = x + Math.cos(a) * d;
    const sy = y + Math.sin(a) * d;
    ctx.globalAlpha = Math.sin(k * Math.PI);
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      const b = (j / 3) * Math.PI;
      ctx.moveTo(sx - Math.cos(b) * 3, sy - Math.sin(b) * 3);
      ctx.lineTo(sx + Math.cos(b) * 3, sy + Math.sin(b) * 3);
    }
    ctx.stroke();
  }
}

/** 감전: sky bolts strike every chained monster, a crackling dome and arcs between them. */
function drawShock(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const pts = pointsOf(f);
  const flick = Math.floor(k * 14); // re-roll the jitter ~14 times over the effect
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  pts.forEach((p, i) => {
    // Bolt from the sky in the first 40%.
    if (k < 0.45) {
      ctx.globalAlpha = 1 - k / 0.45;
      glow(ctx, "#facc15", 16);
      ctx.strokeStyle = "#fef9c3";
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      jagged(ctx, p.x + (rnd(f.seed, i) - 0.5) * 20, p.y - 70, p.x, p.y, 7, 7, f.seed + i * 7 + flick);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // Dome.
    ctx.globalAlpha = 0.7 * (1 - k);
    const r = (10 + easeOut(k) * 16) * s;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, "rgba(254,249,195,0.85)");
    g.addColorStop(0.7, "rgba(250,204,21,0.35)");
    g.addColorStop(1, "rgba(250,204,21,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Crackle spikes around it.
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    for (let j = 0; j < 5; j++) {
      const a = rnd(f.seed + flick, j + i * 5) * Math.PI * 2;
      jagged(ctx, p.x + Math.cos(a) * 5, p.y + Math.sin(a) * 5, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 3, 3, f.seed + j + flick);
    }
    ctx.stroke();
  });
  // Arcs linking the chain.
  if (pts.length > 1) {
    ctx.globalAlpha = 1 - k;
    glow(ctx, "#fde047", 10);
    ctx.strokeStyle = "#fffbeb";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    for (let i = 1; i < pts.length; i++) jagged(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, 6, 6, f.seed + i * 3 + flick);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/** 정전기: a small crackle burst. */
function drawStatic(ctx: Ctx, f: SkillFx, k: number) {
  ctx.globalAlpha = 1 - k;
  glow(ctx, "#fde047", 8);
  ctx.strokeStyle = "#fef08a";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let j = 0; j < 6; j++) {
    const a = (j / 6) * Math.PI * 2 + rnd(f.seed, j);
    const r = 6 + easeOut(k) * 14;
    jagged(ctx, f.x, f.y, f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 3, 2.5, f.seed + j + Math.floor(k * 8));
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** 충격파: stacked shock rings, radial speed lines and kicked-up dust. */
function drawShockwave(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.35 : 1;
  const { x, y } = f;
  for (let i = 0; i < 3; i++) {
    const t = clamp01((k - i * 0.12) / 0.75);
    if (t <= 0 || t >= 1) continue;
    ctx.globalAlpha = (1 - t) * (i === 0 ? 1 : 0.6);
    glow(ctx, "#c4b5fd", 12);
    ctx.strokeStyle = i === 0 ? "#f5f3ff" : "#a78bfa";
    ctx.lineWidth = (5 - i * 1.4) * (1 - t) + 0.6;
    ctx.beginPath();
    ctx.ellipse(x, y, (10 + easeOut(t) * 58) * s, (7 + easeOut(t) * 34) * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Radial speed lines.
  ctx.strokeStyle = "rgba(237,233,254,0.9)";
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 1 - k;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rnd(f.seed, i) * 0.3;
    const r0 = (14 + easeOut(k) * 30) * s;
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.6);
    ctx.lineTo(x + Math.cos(a) * (r0 + 10), y + Math.sin(a) * (r0 + 10) * 0.6);
  }
  ctx.stroke();
  burstDots(ctx, x, y + 4, k, 12, 34 * s, 2.2, "rgba(214,188,140,0.9)", f.seed, 10);
}

/** 마력 증폭: a rotating arcane circle (ring + hexagram + rune ticks) over a deeper explosion. */
function drawAmplify(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const { x, y } = f;
  const r = (16 + easeOut(clamp01(k / 0.4)) * 22) * s;
  const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.62);
  ctx.rotate(k * 2.4);
  ctx.globalAlpha = fade;
  glow(ctx, "#a855f7", 14);
  ctx.strokeStyle = "#e9d5ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let t = 0; t < 2; t++) {
    for (let i = 0; i <= 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (t * Math.PI) / 3 - Math.PI / 2;
      const px = Math.cos(a) * r * 0.78;
      const py = Math.sin(a) * r * 0.78;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.moveTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
    ctx.lineTo(Math.cos(a) * r * (i % 2 ? 0.94 : 0.98), Math.sin(a) * r * (i % 2 ? 0.94 : 0.98));
  }
  ctx.stroke();
  ctx.restore();
  ctx.shadowBlur = 0;
  // Amplified core burst.
  const t = clamp01((k - 0.15) / 0.6);
  if (t > 0 && t < 1) {
    ctx.globalAlpha = 1 - t;
    const R = (14 + t * 34) * s;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.4, "rgba(216,180,254,0.7)");
    g.addColorStop(1, "rgba(126,34,206,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  }
  // Rising motes.
  ctx.fillStyle = f.big ? "#fde68a" : "#f5d0fe";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.55 - k * 22, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 속사: a muzzle flare at the tower and twin afterimage streaks to the target. */
function drawRapid(ctx: Ctx, f: SkillFx, k: number) {
  const { x, y, from } = f;
  const ang = Math.atan2(y - from.y, x - from.x);
  ctx.globalAlpha = 1 - k;
  glow(ctx, "#fb923c", 10);
  ctx.strokeStyle = "#fed7aa";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const off of [-4, 4]) {
    const ox = Math.cos(ang + Math.PI / 2) * off;
    const oy = Math.sin(ang + Math.PI / 2) * off;
    const t0 = clamp01(k * 1.6 - 0.2);
    const t1 = clamp01(k * 1.6);
    ctx.moveTo(from.x + (x - from.x) * t0 + ox, from.y + (y - from.y) * t0 + oy);
    ctx.lineTo(from.x + (x - from.x) * t1 + ox, from.y + (y - from.y) * t1 + oy);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Flare ring at the tower.
  ctx.strokeStyle = "#fdba74";
  ctx.lineWidth = 2 * (1 - k) + 0.4;
  ctx.beginPath();
  ctx.arc(from.x, from.y, 6 + k * 16, 0, Math.PI * 2);
  ctx.stroke();
  // Chevrons pointing along the shot.
  ctx.save();
  ctx.translate(from.x, from.y);
  ctx.rotate(ang);
  ctx.strokeStyle = "#fb923c";
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 3; i++) {
    const d = 10 + i * 6 + k * 14;
    ctx.globalAlpha = (1 - k) * (1 - i * 0.25);
    ctx.beginPath();
    ctx.moveTo(d - 3, -4);
    ctx.lineTo(d + 1, 0);
    ctx.lineTo(d - 3, 4);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Always-on accents — lighter.
// ---------------------------------------------------------------------------

/** 출혈: a red spatter arc with falling droplets. */
function drawBleed(ctx: Ctx, f: SkillFx, k: number) {
  for (const p of pointsOf(f).slice(0, 2)) {
    ctx.fillStyle = "#b91c1c";
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (rnd(f.seed, i) - 0.5) * 2.4;
      const d = (6 + rnd(f.seed, i + 9) * 12) * easeOut(k);
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d + k * k * 16, 1.6, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(239,68,68,0.9)";
    ctx.lineWidth = 2 * (1 - k);
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 + k * 9, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
}

/** 약점 사격: four corner brackets snapping onto the target, then a blink. */
function drawWeakspot(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.25 : 1;
  const close = easeOut(clamp01(k / 0.4));
  const r = (24 - close * 13) * s;
  ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
  ctx.strokeStyle = f.big ? "#fbbf24" : "#fb7185";
  ctx.lineWidth = 1.8;
  glow(ctx, "#f43f5e", 6);
  ctx.beginPath();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const cx = f.x + sx * r;
    const cy = f.y + sy * r;
    ctx.moveTo(cx, cy - sy * 5);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - sx * 5, cy);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (close >= 1 && Math.floor(k * 12) % 2 === 0) {
    ctx.fillStyle = "#fb7185";
    ctx.beginPath();
    ctx.arc(f.x, f.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 화상: flame tongues bursting up from the blast plus drifting embers. */
function drawBurn(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  for (const [pi, p] of pointsOf(f).slice(0, 4).entries()) {
    for (let i = 0; i < 5; i++) {
      const ox = (i - 2) * 4 * s + (rnd(f.seed, i + pi * 5) - 0.5) * 3;
      const h = (10 + rnd(f.seed, i + 30 + pi) * 10) * s * Math.sin(Math.min(1, k * 1.4) * Math.PI);
      if (h <= 0) continue;
      const g = ctx.createLinearGradient(p.x + ox, p.y, p.x + ox, p.y - h);
      g.addColorStop(0, "rgba(234,88,12,0.95)");
      g.addColorStop(0.5, "rgba(251,146,60,0.85)");
      g.addColorStop(1, "rgba(254,240,138,0)");
      ctx.fillStyle = g;
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.beginPath();
      ctx.moveTo(p.x + ox - 2.6, p.y);
      ctx.quadraticCurveTo(p.x + ox - 3, p.y - h * 0.6, p.x + ox + Math.sin(k * 20 + i) * 1.5, p.y - h);
      ctx.quadraticCurveTo(p.x + ox + 3, p.y - h * 0.6, p.x + ox + 2.6, p.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = f.big ? "#fde68a" : "#fdba74";
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(p.x + (rnd(f.seed, i + 60 + pi) - 0.5) * 18, p.y - k * (16 + rnd(f.seed, i + 70) * 14), 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 중력장: an indigo vortex with spiral arms pulling inward. */
function drawGravity(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const { x, y } = f;
  const R = 26 * s * (1 - k * 0.5);
  ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9;
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, "rgba(30,27,75,0.75)");
  g.addColorStop(0.6, "rgba(99,102,241,0.3)");
  g.addColorStop(1, "rgba(99,102,241,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, R, R * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a5b4fc";
  ctx.lineWidth = 1.3;
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = arm * ((Math.PI * 2) / 3) + t * 4 + k * 6;
      const r = R * (1 - t);
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.6;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

/** 얼음 파편: ice shards spinning from the target to the splashed neighbour. */
function drawShards(ctx: Ctx, f: SkillFx, k: number) {
  const pts = pointsOf(f);
  if (pts.length < 2) return;
  const a = pts[0];
  ctx.fillStyle = "#cffafe";
  glow(ctx, "#22d3ee", 8);
  for (const b of pts.slice(1, 2)) {
    for (let i = 0; i < 3; i++) {
      const t = clamp01(k * 1.5 - i * 0.12);
      if (t <= 0 || t >= 1) continue;
      const px = a.x + (b.x - a.x) * t + (i - 1) * 3;
      const py = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 10;
      ctx.globalAlpha = 1 - t * 0.5;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(t * 10 + i);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(3, 0);
      ctx.lineTo(0, 6);
      ctx.lineTo(-3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (k > 0.6) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = (1 - k) / 0.4;
      ctx.strokeStyle = "#a5f3fc";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4 + (k - 0.6) * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
}

/** 한파: a swirling snowstorm disc around the target. */
function drawBlizzard(ctx: Ctx, f: SkillFx, k: number) {
  const R = f.big ? 70 : 45;
  const { x, y } = f;
  const fade = Math.sin(k * Math.PI);
  ctx.globalAlpha = 0.35 * fade;
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, "rgba(224,242,254,0.7)");
  g.addColorStop(1, "rgba(186,230,253,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, R, R * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(240,249,255,0.8)";
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = fade;
  for (let i = 0; i < 3; i++) {
    const r = R * (0.45 + i * 0.22);
    const a0 = k * 5 + i * 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, a0, a0 + 1.4);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 14; i++) {
    const a = rnd(f.seed, i) * Math.PI * 2 + k * 4;
    const r = R * (0.2 + rnd(f.seed, i + 20) * 0.8);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 과부하: gold-white overcharged halos on every chained monster. */
function drawOverload(ctx: Ctx, f: SkillFx, k: number) {
  for (const p of pointsOf(f)) {
    ctx.globalAlpha = 1 - k;
    glow(ctx, "#f59e0b", 12);
    ctx.strokeStyle = f.big ? "#fef3c7" : "#fcd34d";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8 + easeOut(k) * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      const a = rnd(f.seed + Math.floor(k * 10), j) * Math.PI * 2;
      jagged(ctx, p.x, p.y, p.x + Math.cos(a) * 15, p.y + Math.sin(a) * 15, 3, 3, f.seed + j);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/** 전염: green miasma puffs and curling tendrils to each infected neighbour. */
function drawPlague(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const pts = pointsOf(f);
  const a = pts[0];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + rnd(f.seed, i);
    const d = easeOut(k) * 14 * s;
    const r = (6 + rnd(f.seed, i + 5) * 5) * s * (0.6 + k * 0.6);
    ctx.globalAlpha = 0.45 * (1 - k);
    ctx.fillStyle = i % 2 ? "rgba(74,222,128,0.9)" : "rgba(22,163,74,0.9)";
    ctx.beginPath();
    ctx.arc(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d - k * 6, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#86efac";
  ctx.lineWidth = 1.6;
  glow(ctx, "#22c55e", 6);
  for (const b of pts.slice(1)) {
    const t = easeOut(clamp01(k / 0.6));
    const mx = (a.x + b.x) / 2 + (rnd(f.seed, b.x) - 0.5) * 20;
    const my = (a.y + b.y) / 2 - 12;
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    // Partial quadratic: sample the curve up to t.
    for (let i = 1; i <= 10; i++) {
      const u = (i / 10) * t;
      const px = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x;
      const py = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    if (t >= 1) {
      ctx.fillStyle = "#4ade80";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3 + (1 - k) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
}

/** 부식: sizzling acid bubbles and dripping splash. */
function drawCorrode(ctx: Ctx, f: SkillFx, k: number) {
  const { x, y } = f;
  for (let i = 0; i < 6; i++) {
    const ox = (rnd(f.seed, i) - 0.5) * 16;
    const rise = k * (8 + rnd(f.seed, i + 6) * 10);
    const r = 1.5 + rnd(f.seed, i + 12) * 2 * (1 - k);
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = "#bef264";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + ox, y - rise, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  burstDots(ctx, x, y, k, 8, 16, 1.6, "#a3e635", f.seed, 14);
}


// ---------------------------------------------------------------------------
// 대포 · 성기사 · 바람
// ---------------------------------------------------------------------------

/** 기절탄: a heavy blast — fireball, black smoke ring, stun stars spinning over every victim. */
function drawConcuss(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const { x, y } = f;
  const R = (14 + easeOut(k) * 40) * s;
  ctx.globalAlpha = 1 - k;
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.3, "rgba(253,186,116,0.9)");
  g.addColorStop(0.65, "rgba(194,65,12,0.55)");
  g.addColorStop(1, "rgba(41,37,36,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(68,64,60,0.85)";
  ctx.lineWidth = 6 * (1 - k);
  ctx.beginPath();
  ctx.ellipse(x, y + 4, R * 1.1, R * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (const p of pointsOf(f)) {
    for (let i = 0; i < 3; i++) {
      const a = k * 9 + (i * Math.PI * 2) / 3;
      ctx.globalAlpha = Math.sin(Math.min(1, k * 1.2) * Math.PI);
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      const sx = p.x + Math.cos(a) * 9;
      const sy = p.y - 14 + Math.sin(a) * 3;
      for (let j = 0; j < 10; j++) {
        const b = (j / 10) * Math.PI * 2 - Math.PI / 2;
        const r = j % 2 ? 1.3 : 3;
        if (j === 0) ctx.moveTo(sx + Math.cos(b) * r, sy + Math.sin(b) * r);
        else ctx.lineTo(sx + Math.cos(b) * r, sy + Math.sin(b) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  burstDots(ctx, x, y, k, 16, 46 * s, 2.4, "#fb923c", f.seed, 20);
}

/** 연쇄 폭발: staggered secondary explosions popping across the splash. */
function drawChainblast(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const pts = pointsOf(f);
  pts.forEach((p, i) => {
    const t = clamp01((k - i * 0.1) / 0.6);
    if (t <= 0 || t >= 1) return;
    const R = (8 + easeOut(t) * 34) * s;
    ctx.globalAlpha = 1 - t;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, "rgba(254,252,232,1)");
    g.addColorStop(0.35, "rgba(250,204,21,0.9)");
    g.addColorStop(0.7, "rgba(220,38,38,0.6)");
    g.addColorStop(1, "rgba(127,29,29,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 2.5 * (1 - t);
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2 + rnd(f.seed, j + i);
      ctx.moveTo(p.x + Math.cos(a) * R * 0.5, p.y + Math.sin(a) * R * 0.5);
      ctx.lineTo(p.x + Math.cos(a) * R * 1.15, p.y + Math.sin(a) * R * 1.15);
    }
    ctx.stroke();
    burstDots(ctx, p.x, p.y, t, 10, 30 * s, 2, "#facc15", f.seed + i, 16);
  });
}

/** 심판: a pillar of light slams down on the target with a golden rune ring and feathers. */
function drawJudgment(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.35 : 1;
  const { x, y } = f;
  const w = 10 * s * (k < 0.15 ? k / 0.15 : 1 - Math.max(0, k - 0.5) / 0.5);
  ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
  const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, "rgba(253,224,71,0)");
  g.addColorStop(0.5, "rgba(255,251,235,0.95)");
  g.addColorStop(1, "rgba(253,224,71,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - w, y - 140, w * 2, 140);
  ctx.globalAlpha = 1 - k;
  glow(ctx, "#fbbf24", 16);
  ctx.strokeStyle = "#fde68a";
  ctx.lineWidth = 2.2;
  const r = (12 + easeOut(k) * 28) * s;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + k * 2;
    ctx.moveTo(x + Math.cos(a) * r * 0.8, y + 2 + Math.sin(a) * r * 0.36);
    ctx.lineTo(x + Math.cos(a) * r * 0.95, y + 2 + Math.sin(a) * r * 0.43);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fffbeb";
  for (let i = 0; i < 5; i++) {
    const t = clamp01((k - 0.15) / 0.85);
    const px = x + (rnd(f.seed, i) - 0.5) * 40 + Math.sin(t * 6 + i) * 4;
    const py = y - 30 + t * 34 + rnd(f.seed, i + 5) * 10;
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.sin(t * 5 + i) * 0.8);
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.4, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** 토네이도: a twisting funnel of wind rings lifting dust and leaves. */
function drawTornado(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.3 : 1;
  const { x, y } = f;
  const grow = easeOut(clamp01(k / 0.25));
  const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
  for (let i = 0; i < 9; i++) {
    const h = i / 8;
    const r = (6 + h * 26) * s * grow;
    const cy = y - h * 56 * s * grow;
    const sway = Math.sin(k * 10 + h * 4) * 6 * h;
    ctx.globalAlpha = fade * (0.35 + 0.5 * (1 - h));
    ctx.strokeStyle = i % 2 ? "rgba(204,251,241,0.9)" : "rgba(94,234,212,0.8)";
    ctx.lineWidth = 2;
    const a0 = k * 18 + i;
    ctx.beginPath();
    ctx.ellipse(x + sway, cy, Math.max(0.1, r), Math.max(0.1, r * 0.28), 0, a0, a0 + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.fillStyle = "#86efac";
  for (let i = 0; i < 10; i++) {
    const h = rnd(f.seed, i);
    const a = k * 14 + i * 1.7;
    const r = (6 + h * 24) * s;
    ctx.globalAlpha = fade;
    ctx.save();
    ctx.translate(x + Math.cos(a) * r, y - h * 50 * s * grow + Math.sin(a) * r * 0.28);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.2, 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  burstDots(ctx, x, y + 4, k, 10, 30 * s, 2, "rgba(214,188,140,0.85)", f.seed, 4);
}

/** 회오리: a spinning ring of air blades sweeping the neighbours. */
function drawWhirl(ctx: Ctx, f: SkillFx, k: number) {
  const { x, y } = f;
  const r = 10 + easeOut(k) * 26;
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = "#99f6e4";
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = k * 12 + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, a, a + 0.9);
    ctx.stroke();
  }
  for (const p of pointsOf(f).slice(1)) {
    ctx.strokeStyle = "#ccfbf1";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y - 6);
    ctx.lineTo(p.x + 6, p.y + 6);
    ctx.stroke();
  }
}

/** 돌풍: a quick pushing gust — streak lines across the target. */
function drawGust(ctx: Ctx, f: SkillFx, k: number) {
  const ang = Math.atan2(f.y - f.from.y, f.x - f.from.x);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(ang);
  ctx.strokeStyle = "rgba(204,251,241,0.9)";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1 - k;
  for (let i = 0; i < 4; i++) {
    const off = (i - 1.5) * 4;
    const d = -10 + k * 22;
    ctx.beginPath();
    ctx.moveTo(d - 10, off);
    ctx.lineTo(d + 4, off);
    ctx.stroke();
  }
  ctx.restore();
}

/** 성광 관통 / 철갑탄: a bright pierce spark at the main hit. */
function drawPierce(ctx: Ctx, f: SkillFx, k: number) {
  const color = f.skill === "radiance" ? "#fef08a" : "#e7e5e4";
  ctx.globalAlpha = 1 - k;
  glow(ctx, color, 8);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const r = 4 + k * 12;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.moveTo(f.x + Math.cos(a) * r * 0.3, f.y + Math.sin(a) * r * 0.3);
    ctx.lineTo(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** 등불: lantern sparks hop from the target to each monster the flame spreads to. */
function drawBeacon(ctx: Ctx, f: SkillFx, k: number) {
  const pts = pointsOf(f);
  const [a] = pts;
  glow(ctx, "#fb923c", 10);
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    const t = easeOut(clamp01(k * 1.6));
    const mx = (a.x + b.x) / 2;
    const my = Math.min(a.y, b.y) - 14;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
    const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = "#fdba74";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    burstDots(ctx, b.x, b.y, clamp01((k - 0.4) / 0.6), 6, 12, 1.6, "#fed7aa", f.seed + i);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = "#fb923c";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(a.x, a.y, 6 + easeOut(k) * 14, 0, Math.PI * 2);
  ctx.stroke();
}

/** 자유의 불꽃: a flame pillar rises from the target, then a teal-and-gold ring sweeps the area. */
function drawFreedom(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.35 : 1;
  const { x, y } = f;
  const rise = clamp01(k / 0.35);
  ctx.globalAlpha = Math.min(1, (1 - k) * 1.8);
  const h = 70 * s * easeOut(rise);
  const g = ctx.createLinearGradient(0, y, 0, y - h);
  g.addColorStop(0, "rgba(255,247,237,0.95)");
  g.addColorStop(0.4, "rgba(251,146,60,0.8)");
  g.addColorStop(1, "rgba(234,88,12,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 9 * s, y);
  ctx.quadraticCurveTo(x - 4 * s, y - h * 0.6, x, y - h);
  ctx.quadraticCurveTo(x + 4 * s, y - h * 0.6, x + 9 * s, y);
  ctx.closePath();
  ctx.fill();
  const r = (10 + easeOut(clamp01((k - 0.15) / 0.85)) * 46) * s;
  glow(ctx, "#2dd4bf", 14);
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#fdba74";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, r * 0.82, r * 0.41, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  burstDots(ctx, x, y - 10, k, 12, 34 * s, 1.8, "#fed7aa", f.seed, 30);
}

/** 사색: a thought bubble pops above the target as the heavy hit lands. */
function drawPonder(ctx: Ctx, f: SkillFx, k: number) {
  const { x, y } = f;
  const t = easeOut(clamp01(k / 0.5));
  ctx.globalAlpha = 1 - Math.max(0, k - 0.5) / 0.5;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#4338ca";
  ctx.lineWidth = 1.2;
  for (const [dx, dy, r] of [
    [-6, -10, 1.6],
    [-3, -16, 2.4],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy - t * 4, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(x + 4, y - 27 - t * 6, 9 * t + 1, 6 * t + 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#6366f1";
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(x + 4 + i * 3.4 * t, y - 27 - t * 6, 1.1 * t, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 깨달음: a flash of insight — golden rays burst from a lightbulb glint over the target. */
function drawEpiphany(ctx: Ctx, f: SkillFx, k: number) {
  const s = f.big ? 1.35 : 1;
  const { x, y } = f;
  const cy = y - 22 * s;
  ctx.globalAlpha = 1 - k;
  glow(ctx, "#fde047", 18);
  ctx.strokeStyle = "#fde68a";
  ctx.lineWidth = 2.2;
  const len = (10 + easeOut(k) * 26) * s;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    ctx.moveTo(x + Math.cos(a) * len * 0.45, cy + Math.sin(a) * len * 0.45);
    ctx.lineTo(x + Math.cos(a) * len, cy + Math.sin(a) * len);
  }
  ctx.stroke();
  // Bulb
  ctx.fillStyle = "#fffbeb";
  ctx.beginPath();
  ctx.arc(x, cy, 5 * s * (k < 0.2 ? k / 0.2 : 1), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#a16207";
  ctx.fillRect(x - 2.4 * s, cy + 4 * s, 4.8 * s, 3 * s);
  ctx.shadowBlur = 0;
  // Ground crack ring under the target
  ctx.strokeStyle = "#b45309";
  ctx.lineWidth = 2;
  const r = (6 + easeOut(k) * 22) * s;
  ctx.beginPath();
  ctx.ellipse(x, y + 3, r, r * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();
}

const DRAW: Partial<Record<SkillId, (ctx: Ctx, f: SkillFx, k: number) => void>> = {
  torchlight: drawBurn,
  beacon: drawBeacon,
  freedom: drawFreedom,
  ponder: drawPonder,
  insight: drawPierce,
  epiphany: drawEpiphany,
  concuss: drawConcuss,
  chainblast: drawChainblast,
  judgment: drawJudgment,
  tornado: drawTornado,
  whirl: drawWhirl,
  gust: drawGust,
  radiance: drawPierce,
  apshell: drawPierce,
  shrapnel: drawBleed,
  execute: drawExecute,
  freeze: drawFreeze,
  shock: drawShock,
  static: drawStatic,
  shockwave: drawShockwave,
  amplify: drawAmplify,
  rapid: drawRapid,
  bleed: drawBleed,
  weakspot: drawWeakspot,
  burn: drawBurn,
  gravity: drawGravity,
  shards: drawShards,
  blizzard: drawBlizzard,
  overload: drawOverload,
  plague: drawPlague,
  corrode: drawCorrode,
};

export function drawSkillFx(ctx: Ctx, f: SkillFx, k: number) {
  DRAW[f.skill]?.(ctx, f, k);
}
