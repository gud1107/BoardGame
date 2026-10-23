/**
 * Canvas 2D renderer for 섬광전대 프리즘파이브. Everything is drawn in a
 * 640×360 logical space (scaled by the host). Characters are a jointed
 * skeleton posed per state — attack wind-up/strike/recover keyframes, and
 * distinct hit reactions (high/low flinch, stagger, bind, launch arch, spin,
 * knockdown, get-up) — then skinned as sentai suits, grunts, bosses or robots.
 */

import {
  BOSSES,
  DODGE_TICKS,
  ENEMIES,
  HEROES,
  HERO_ORDER,
  MECHA,
  PRISM_MAX,
  STYLE_RANKS,
  VIEW_W,
  Z_MAX,
  styleRank,
  type AnimKind,
  type BossId,
  type HeroDef,
  type HeroId,
  type Theme,
} from "./data";
import { ventXs, type Actor, type Fx, type Proj, type World } from "./engine";

export const VIEW_H = 360;
const GROUND_TOP = 196;
const GROUND_H = 150;

export const groundY = (z: number) => GROUND_TOP + (z / Z_MAX) * GROUND_H;
const depthScale = (z: number) => 0.88 + (z / Z_MAX) * 0.16;

export interface RenderOpts {
  noShake: boolean;
  calm: boolean;
  touch: boolean;
}

/** Per-session smoothing (HP lag bars) kept outside the deterministic world. */
export interface RenderMemo {
  hpLag: number;
  bossLag: number;
  bossId: number;
}
export const newMemo = (): RenderMemo => ({ hpLag: 1, bossLag: 1, bossId: -1 });

// ---------------------------------------------------------------- pose

interface Pose {
  lean: number;
  thN: number;
  shN: number;
  thF: number;
  shF: number;
  arN: number;
  foN: number;
  arF: number;
  foF: number;
  head: number;
  /** Whole-body rotation around the hip. */
  rot: number;
  /** Extra hip lift (air) in px. */
  lift: number;
}

const P = (o: Partial<Pose>): Pose => ({ lean: 0.06, thN: 0.18, shN: 0.15, thF: -0.12, shF: 0.2, arN: 0.55, foN: 1.3, arF: 0.4, foF: 1.4, head: 0, rot: 0, lift: 0, ...o });
const IDLE = P({});
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(a: Pose, b: Pose, t: number): Pose {
  const o = {} as Pose;
  for (const k of Object.keys(a) as (keyof Pose)[]) o[k] = lerp(a[k], b[k], t);
  return o;
}
const ease = (t: number) => 1 - (1 - t) * (1 - t);

/** [wind-up, strike] keyframes per attack animation. */
const ATTACK: Record<AnimKind, [Pose, Pose]> = {
  jab: [P({ arN: 0.9, foN: 1.9, lean: 0.05 }), P({ arN: 1.62, foN: 0.05, lean: 0.18, thN: 0.45, shN: 0.1 })],
  straight: [P({ arN: 0.6, foN: 2.0, lean: -0.05 }), P({ arN: 1.6, foN: 0, lean: 0.3, thN: 0.6, shN: 0, thF: -0.4 })],
  hook: [P({ arN: 0.3, foN: 1.6, lean: -0.1 }), P({ arN: 1.4, foN: 1.0, lean: 0.25, head: 0.1 })],
  kick: [P({ thN: 1.0, shN: 1.7, lean: -0.1 }), P({ thN: 1.65, shN: 0, lean: -0.35, arN: 0.2, arF: 0.9 })],
  spinKick: [P({ thN: 0.6, shN: 1.4, rot: -0.4 }), P({ thN: 1.75, shN: 0.05, lean: -0.45, rot: 0.2, arF: 1.4, foF: 0.2 })],
  uppercut: [P({ arN: 0.25, foN: 2.4, lean: 0.3, thN: 0.6, shN: 1.2, thF: -0.5, shF: 0.9 }), P({ arN: 2.95, foN: 0.2, lean: -0.15, thN: 0.2, shN: 0.1 })],
  slashH: [P({ arN: -0.7, foN: 0.6, lean: -0.1 }), P({ arN: 1.75, foN: 0.1, lean: 0.25, thN: 0.5 })],
  slashB: [P({ arN: 2.0, foN: 0.4, lean: 0.2 }), P({ arN: 0.1, foN: 0.3, lean: 0.05 })],
  slashUp: [P({ arN: 0.15, foN: 0.4, lean: 0.35, thN: 0.6, shN: 1.2, thF: -0.4, shF: 0.8 }), P({ arN: 3.0, foN: 0.2, lean: -0.2 })],
  slashDown: [P({ arN: 3.1, foN: 0.3, lean: -0.2, arF: 2.8, foF: 0.3 }), P({ arN: 1.0, foN: 0.1, lean: 0.45, thN: 0.7, shN: 0.4, thF: -0.5, arF: 0.9, foF: 0.2 })],
  thrust: [P({ arN: 0.9, foN: 1.7, lean: -0.05 }), P({ arN: 1.57, foN: 0, lean: 0.4, thN: 0.8, shN: 0.2, thF: -0.6, shF: 0.1 })],
  spin: [P({ arN: -0.5, foN: 0.2, rot: -0.3 }), P({ arN: 1.6, foN: 0, arF: 1.6, foF: 0, rot: 0.3, lean: 0.15 })],
  shoot: [P({ arN: 1.5, foN: 0.1, arF: 1.4, foF: 0.4 }), P({ arN: 1.55, foN: 0.05, arF: 1.45, foF: 0.35, lean: -0.08 })],
  shootUp: [P({ arN: 2.3, foN: 0.1, arF: 2.2, foF: 0.3 }), P({ arN: 2.6, foN: 0.05, arF: 2.5, foF: 0.2, lean: -0.2 })],
  throw: [P({ arN: -0.4, foN: 1.8, lean: -0.2 }), P({ arN: 2.1, foN: 0.2, lean: 0.35, thN: 0.5 })],
  slam: [P({ arN: 3.1, foN: 0.2, arF: 3.0, foF: 0.2, lean: -0.25 }), P({ arN: 1.0, foN: 0.1, arF: 0.9, foF: 0.1, lean: 0.55, thN: 0.8, shN: 0.9, thF: -0.6, shF: 0.9 })],
  dive: [P({ thN: 0.5, shN: 1.5, lean: 0.3 }), P({ thN: 0.9, shN: 0, thF: 0.3, shF: 1.6, lean: 0.6, rot: 0.5, arN: 2.4, arF: 2.6 })],
  rise: [P({ arN: 0.6, foN: 1.5, thN: 0.6, shN: 1.2 }), P({ arN: 3.05, foN: 0, arF: 0.4, thN: 0.3, shN: 1.4, thF: -0.2, shF: 0.4, lean: -0.1 })],
  dash: [P({ lean: 0.5, arN: 0.2, foN: 1 }), P({ lean: 0.7, arN: 1.55, foN: 0, arF: -0.6, thN: 0.9, shN: 0.3, thF: -0.8, shF: 0.4 })],
  whip: [P({ arN: -0.8, foN: 1.2, lean: -0.15 }), P({ arN: 1.7, foN: 0, lean: 0.3, thN: 0.5 })],
  heal: [P({ arN: 1.2, foN: 1.2, arF: 1.2, foF: 1.2 }), P({ arN: 2.6, foN: 0.2, arF: 2.6, foF: 0.2, lean: -0.15, head: -0.2 })],
  guard: [P({ arN: 1.0, foN: 2.0, arF: 1.1, foF: 2.0 }), P({ arN: 1.25, foN: 1.9, arF: 1.3, foF: 1.9, lean: 0.12, thN: 0.4, shN: 0.5, thF: -0.4, shF: 0.5 })],
  roar: [P({ arN: 0.5, foN: 1.4, arF: 0.5, foF: 1.4, lean: 0.3 }), P({ arN: 2.3, foN: 0.4, arF: 2.2, foF: 0.4, lean: -0.35, head: -0.35, thN: 0.4, thF: -0.4 })],
  charge: [P({ lean: 0.45, arN: 0.2, arF: 0.2, thN: 0.5, shN: 1.0 }), P({ lean: 0.85, arN: -0.4, foN: 0.4, arF: -0.5, head: 0.2, thN: 1.0, shN: 0.4, thF: -0.9, shF: 0.6 })],
  cast: [P({ arN: 0.9, foN: 1.6, arF: 0.9, foF: 1.6 }), P({ arN: 1.6, foN: 0, arF: 1.5, foF: 0.2, lean: 0.1 })],
  pose: [P({ arN: 1.4, foN: 1.6, arF: 1.3, foF: 1.6 }), P({ arN: 2.55, foN: -0.15, arF: 0.55, foF: 2.1, thN: 0.45, shN: 0.1, thF: -0.45, shF: 0.1, head: -0.12 })],
  grab: [P({ arN: 1.2, foN: 1.0, arF: 1.1, foF: 1.0, lean: 0.2 }), P({ arN: 1.55, foN: 0.1, arF: 1.5, foF: 0.2, lean: 0.35, thN: 0.5 })],
};

function walkPose(t: number, run: boolean): Pose {
  const s = Math.sin(t * (run ? 0.42 : 0.24));
  const a = run ? 0.75 : 0.45;
  return P({
    lean: run ? 0.35 : 0.1,
    thN: s * a,
    shN: Math.max(0, -s) * (run ? 1.4 : 0.7) + 0.1,
    thF: -s * a,
    shF: Math.max(0, s) * (run ? 1.4 : 0.7) + 0.1,
    arN: run ? 0.5 - s * 0.9 : 0.6 - s * 0.35,
    foN: run ? 1.6 : 1.2,
    arF: run ? 0.5 + s * 0.9 : 0.45 + s * 0.35,
    foF: run ? 1.6 : 1.3,
  });
}

function attackPose(a: Actor): Pose {
  const m = a.move ?? a.next;
  if (!m) return IDLE;
  const [wind, strike] = ATTACK[m.anim];
  if (a.state === "tell") {
    // Telegraph: hold the wind-up and tremble.
    const k = Math.min(1, a.t / 10);
    const p = mix(IDLE, wind, ease(k));
    p.lean += Math.sin(a.t * 1.7) * 0.03;
    return p;
  }
  const first = m.hits[0]?.at ?? m.proj?.[0]?.at ?? Math.round(m.total * 0.3);
  const t = a.moveT;
  let p: Pose;
  if (m.anim === "spin" || m.anim === "spinKick") {
    p = mix(wind, strike, ease(Math.min(1, t / Math.max(1, first))));
    if (m.anim === "spin" && t > first) p.rot = Math.sin(t * 0.6) * 0.25;
    return p;
  }
  if (t < first) p = mix(IDLE, wind, ease(t / Math.max(1, first)));
  else if (t < first + 6) p = mix(wind, strike, ease(Math.min(1, (t - first + 1) / 3)));
  else {
    const rec = Math.min(1, (t - first - 6) / Math.max(1, m.total - first - 6));
    p = mix(strike, IDLE, rec * rec * 0.85);
  }
  // Multi-hit rushes keep re-striking.
  if (m.hits.length > 3 && t > first && t < (m.hits[m.hits.length - 1].at ?? 0)) {
    const k = (Math.sin(t * 1.4) + 1) / 2;
    p = mix(wind, strike, 0.4 + k * 0.6);
  }
  return p;
}

function poseFor(a: Actor): Pose {
  const t = a.t;
  switch (a.state) {
    case "walk":
      return walkPose(a.x * 0.6 + a.z * 0.3, false);
    case "run":
      return walkPose(a.x * 0.45, true);
    case "jump":
      return P({ thN: 0.9, shN: 1.4, thF: 0.1, shF: 0.9, arN: a.vy > 0 ? 2.4 : 1.2, foN: 0.5, arF: a.vy > 0 ? 2.1 : 0.9, foF: 0.6, lean: 0.1 });
    case "attack":
    case "tell":
      return attackPose(a);
    case "hit":
      if (a.reaction === "bind") return P({ arN: 0.12, foN: 0.1, arF: 0.1, foF: 0.1, thN: 0.05, thF: -0.05, lean: Math.sin(t * 0.9) * 0.08 });
      if (a.reaction === "stagger") return P({ lean: -0.55 + Math.min(1, t / 20) * 0.3, head: -0.35, arN: -0.6, foN: 0.6, arF: 2.2, foF: 0.4, thN: 0.4, shN: 0.2, thF: -0.7, shF: 0.6 });
      if (a.reaction === "low") return P({ lean: 0.75, head: 0.35, arN: 0.7, foN: 1.8, arF: 0.6, foF: 1.9, thN: 0.45, shN: 0.9, thF: -0.3, shF: 0.7 });
      return P({ lean: -0.4, head: -0.5, arN: -0.45, foN: 0.4, arF: -0.25, foF: 0.6, thN: 0.25, thF: -0.35 });
    case "air": {
      if (a.reaction === "spin") return P({ rot: t * 0.38, lean: -0.2, arN: 2.4, foN: 0.2, arF: -0.6, thN: 0.6, shN: 0.4, thF: -0.6, shF: 0.4 });
      const arch = Math.max(-1.2, Math.min(0.5, -a.vy * 0.12));
      return P({ rot: -0.6 + arch, lean: -0.5, head: -0.6, arN: 2.6, foN: 0.4, arF: 2.2, foF: 0.6, thN: 0.6, shN: 1.0, thF: -0.4, shF: 0.8, lift: 6 });
    }
    case "down":
    case "dead":
      return P({ rot: -1.5, lean: -0.05, head: -0.15, arN: 2.6, foN: 0.3, arF: 2.9, foF: 0.4, thN: 0.15, shN: 0.4, thF: -0.1, shF: 0.1, lift: -24 });
    case "getup": {
      const k = Math.min(1, t / 20);
      return mix(P({ rot: -1.4, arN: 2.4, arF: 2.6, lift: -22 }), P({ lean: 0.4, thN: 0.9, shN: 1.8, thF: -0.4, shF: 1.6, arN: 0.8, arF: 0.2 }), ease(k));
    }
    case "dodge":
      return P({ rot: (t / DODGE_TICKS) * Math.PI * 2, thN: 1.6, shN: 2.4, thF: 1.4, shF: 2.4, arN: 1.4, foN: 1.8, arF: 1.4, foF: 1.8, lean: 0.6, lift: 8 });
    case "grabbed":
    case "held":
      return P({ lean: -0.3, head: -0.4, arN: 2.4 + Math.sin(t * 0.8) * 0.4, foN: 0.6, arF: 2.0 - Math.sin(t * 0.8) * 0.4, thN: 0.4 + Math.sin(t) * 0.4, shN: 0.6, thF: -0.4, shF: 0.6, rot: a.state === "held" ? t * 0.3 : 0 });
    case "stunned":
      return P({ lean: Math.sin(t * 0.12) * 0.25, head: Math.sin(t * 0.12 + 1) * 0.3, arN: 0.3, foN: 0.4, arF: 0.25, foF: 0.4, thN: 0.3, shN: 0.5, thF: -0.3, shF: 0.5 });
    case "pose": {
      const k = Math.min(1, t / 16);
      return mix(IDLE, ATTACK.pose[1], ease(k));
    }
    default: {
      const b = Math.sin(t * 0.08) * 0.04;
      return P({ lean: 0.08 + b, arN: 0.55 + b, arF: 0.4 - b });
    }
  }
}

// ---------------------------------------------------------------- skeleton

type Pt = [number, number];
const add = (p: Pt, ang: number, len: number): Pt => [p[0] + Math.sin(ang) * len, p[1] + Math.cos(ang) * len];
const up = (p: Pt, ang: number, len: number): Pt => [p[0] + Math.sin(ang) * len, p[1] - Math.cos(ang) * len];

interface Skel {
  hip: Pt;
  sh: Pt;
  neck: Pt;
  head: Pt;
  kneeN: Pt;
  footN: Pt;
  kneeF: Pt;
  footF: Pt;
  elbN: Pt;
  handN: Pt;
  elbF: Pt;
  handF: Pt;
  foreN: number;
  foreF: number;
}

function skeleton(p: Pose, bulk = 1): Skel {
  const L = 15 * bulk;
  const T = 22 * bulk;
  const A = 12 * bulk;
  const hip: Pt = [0, 0];
  const kneeN = add(hip, p.thN, L);
  const footN = add(kneeN, p.thN - p.shN, L);
  const kneeF = add(hip, p.thF, L);
  const footF = add(kneeF, p.thF - p.shF, L);
  const sh = up(hip, p.lean, T - 3);
  const neck = up(hip, p.lean, T);
  const head = up(neck, p.lean + p.head, 9.5 * bulk);
  const elbN = add(sh, p.arN, A);
  const foreN = p.arN + p.foN;
  const handN = add(elbN, foreN, A);
  const elbF = add(sh, p.arF, A);
  const foreF = p.arF + p.foF;
  const handF = add(elbF, foreF, A);
  return { hip, sh, neck, head, kneeN, footN, kneeF, footF, elbN, handN, elbF, handF, foreN, foreF };
}

function limb(ctx: CanvasRenderingContext2D, pts: Pt[], w: number, color: string, outline = "#0b0b12") {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = outline;
  ctx.lineWidth = w + 2.4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, p: Pt, r: number, fill: string, outline = "#0b0b12") {
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------- skins

interface Skin {
  suit: string;
  suitDark: string;
  glove: string;
  boot: string;
  bulk: number;
  head: (ctx: CanvasRenderingContext2D, s: Skel, p: Pose) => void;
  chest?: (ctx: CanvasRenderingContext2D, s: Skel, p: Pose) => void;
  weapon?: (ctx: CanvasRenderingContext2D, s: Skel, p: Pose, a: Actor | null) => void;
  back?: (ctx: CanvasRenderingContext2D, s: Skel, p: Pose) => void;
}

function torso(ctx: CanvasRenderingContext2D, s: Skel, p: Pose, color: string, wTop: number, wHip: number) {
  const nx = Math.cos(p.lean);
  const ny = Math.sin(p.lean);
  ctx.beginPath();
  ctx.moveTo(s.neck[0] - nx * wTop * 0.5, s.neck[1] - ny * wTop * 0.5);
  ctx.lineTo(s.neck[0] + nx * wTop * 0.5, s.neck[1] + ny * wTop * 0.5);
  ctx.lineTo(s.hip[0] + nx * wHip * 0.5, s.hip[1] + ny * wHip * 0.5);
  ctx.lineTo(s.hip[0] - nx * wHip * 0.5, s.hip[1] - ny * wHip * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#0b0b12";
  ctx.stroke();
}

function helmet(ctx: CanvasRenderingContext2D, s: Skel, p: Pose, color: string, visor: HeroDef["visor"]) {
  const [hx, hy] = s.head;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(p.lean + p.head);
  // Helmet shell.
  ctx.beginPath();
  ctx.ellipse(0, 0, 8.6, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#0b0b12";
  ctx.stroke();
  // Shine.
  ctx.beginPath();
  ctx.ellipse(-2.5, -4.5, 3, 2, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fill();
  // Visor (front = +x).
  ctx.fillStyle = "#0b0b12";
  ctx.beginPath();
  switch (visor) {
    case "v":
      ctx.moveTo(0.5, -3.5);
      ctx.lineTo(8.6, -1);
      ctx.lineTo(8.6, 3);
      ctx.lineTo(3.5, 0.5);
      ctx.lineTo(1, 4.2);
      ctx.closePath();
      break;
    case "diamond":
      ctx.moveTo(1.5, 0);
      ctx.lineTo(5.5, -4.5);
      ctx.lineTo(9, 0);
      ctx.lineTo(5.5, 4.5);
      ctx.closePath();
      break;
    case "bar":
      ctx.rect(1, -3, 8, 5);
      break;
    case "arch":
      ctx.moveTo(1, 3);
      ctx.quadraticCurveTo(5, -7, 9, 3);
      ctx.lineTo(9, 4);
      ctx.lineTo(1, 4);
      ctx.closePath();
      break;
    case "heart":
      ctx.moveTo(5, 4.5);
      ctx.bezierCurveTo(-1, 0, 2, -6, 5, -2);
      ctx.bezierCurveTo(8, -6, 11, 0, 5, 4.5);
      break;
  }
  ctx.fill();
  // Mouth plate.
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(3.5, 5, 4.5, 3);
  ctx.restore();
}

function heroSkin(h: HeroDef): Skin {
  return {
    suit: h.color,
    suitDark: shade(h.color, 0.62),
    glove: "#f8fafc",
    boot: "#f8fafc",
    bulk: h.id === "green" ? 1.06 : 1,
    head: (ctx, s, p) => helmet(ctx, s, p, h.color, h.visor),
    chest: (ctx, s, p) => {
      // White shoulder stripes + prism emblem + belt.
      const mid: Pt = [(s.neck[0] + s.hip[0]) / 2, (s.neck[1] + s.hip[1]) / 2];
      ctx.save();
      ctx.translate(mid[0], mid[1]);
      ctx.rotate(p.lean);
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.moveTo(-1, -6);
      ctx.lineTo(5, -6);
      ctx.lineTo(2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(-7, -11, 14, 2.2);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(-6.5, 8, 13, 3.4);
      const g = ctx.createLinearGradient(-3, 7, 3, 12);
      g.addColorStop(0, "#f472b6");
      g.addColorStop(0.5, "#facc15");
      g.addColorStop(1, "#38bdf8");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(1.5, 9.7, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    weapon: (ctx, s, p, a) => heroWeapon(ctx, s, p, a, h),
  };
}

function heroWeapon(ctx: CanvasRenderingContext2D, s: Skel, p: Pose, a: Actor | null, h: HeroDef) {
  const ang = s.foreN;
  const anim = a?.move?.anim ?? a?.next?.anim;
  const hand = s.handN;
  switch (h.id) {
    case "red": {
      const tip = add(hand, ang, 34);
      limb(ctx, [hand, tip], 3.2, "#e2e8f0");
      ctx.strokeStyle = "rgba(255,120,120,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(...add(hand, ang, 4));
      ctx.lineTo(...tip);
      ctx.stroke();
      limb(ctx, [add(hand, ang + 1.57, 4), add(hand, ang - 1.57, 4)], 2.2, "#facc15");
      break;
    }
    case "blue":
      dot(ctx, hand, 4.4, "#60a5fa");
      dot(ctx, s.handF, 3.8, "#3b82f6");
      if (a?.state === "attack") {
        ctx.fillStyle = "rgba(147,197,253,0.35)";
        ctx.beginPath();
        ctx.arc(hand[0], hand[1], 8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "yellow": {
      const muzzle = add(hand, ang, 16);
      limb(ctx, [add(hand, ang, -2), muzzle], 5, "#334155");
      limb(ctx, [add(hand, ang, 2), add(hand, ang, 12)], 2, "#facc15", "#334155");
      if (anim === "shoot" && a && a.moveT < 8 && a.state === "attack") dot(ctx, add(muzzle, ang, 3), 4, "#fef08a", "#facc15");
      break;
    }
    case "green": {
      const top = add(hand, ang, 24);
      limb(ctx, [add(hand, ang, -5), top], 2.8, "#a16207");
      ctx.save();
      ctx.translate(top[0], top[1]);
      ctx.rotate(-ang);
      ctx.fillStyle = "#94a3b8";
      ctx.strokeStyle = "#0b0b12";
      ctx.lineWidth = 1.5;
      ctx.fillRect(-10, -6, 20, 12);
      ctx.strokeRect(-10, -6, 20, 12);
      ctx.fillStyle = "#16a34a";
      ctx.fillRect(-10, -2, 20, 4);
      ctx.restore();
      break;
    }
    case "pink":
      if (anim === "whip" && a?.state === "attack") {
        const m = a.move;
        const reach = m ? Math.max(...m.hits.map((x) => x.x[1]), 80) : 80;
        const k = Math.min(1, a.moveT / 9);
        ctx.strokeStyle = "#f9a8d4";
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(hand[0], hand[1]);
        const n = 14;
        for (let i = 1; i <= n; i++) {
          const f = i / n;
          ctx.lineTo(hand[0] + f * reach * k, hand[1] + Math.sin(f * 9 + a.moveT * 0.8) * 5 * (1 - f * 0.4) - f * 6);
        }
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#f9a8d4";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(hand[0] + 2, hand[1], 11, -1.2, 1.2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(hand[0] + 6.5, hand[1] - 10);
        ctx.lineTo(hand[0] + 6.5, hand[1] + 10);
        ctx.stroke();
      }
      break;
  }
}

function gruntSkin(a: Actor): Skin {
  const def = ENEMIES[a.enemyId!];
  const elite = def.id === "elite";
  return {
    suit: def.color,
    suitDark: shade(def.color, 0.65),
    glove: elite ? "#facc15" : "#18181b",
    boot: "#18181b",
    bulk: elite ? 1.12 : def.id === "drone" ? 0.92 : 1,
    head: (ctx, s, p) => {
      ctx.save();
      ctx.translate(s.head[0], s.head[1]);
      ctx.rotate(p.lean + p.head);
      ctx.beginPath();
      ctx.ellipse(0, 0, 8.4, 9.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = def.id === "drone" ? "#b91c1c" : elite ? "#581c87" : "#18181b";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0b0b12";
      ctx.stroke();
      // Skull-mask markings + glowing eye.
      ctx.fillStyle = "#d4d4d8";
      ctx.fillRect(-1, -8, 2, 16);
      ctx.fillStyle = def.id === "sniper" ? "#38bdf8" : "#ef4444";
      ctx.beginPath();
      ctx.ellipse(4.8, -1.5, 2.6, 1.4, 0.2, 0, Math.PI * 2);
      ctx.fill();
      if (elite) {
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.moveTo(-3, -8);
        ctx.lineTo(-8, -17);
        ctx.lineTo(1, -9);
        ctx.fill();
      }
      if (def.id === "drone") {
        ctx.strokeStyle = "#0b0b12";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(-2, -16);
        ctx.stroke();
        dot(ctx, [-2, -17], 2.2, a.fuse > 0 && Math.floor(a.fuse / 4) % 2 === 0 ? "#fde047" : "#ef4444");
      }
      ctx.restore();
    },
    chest: (ctx, s, p) => {
      ctx.save();
      ctx.translate((s.neck[0] + s.hip[0]) / 2, (s.neck[1] + s.hip[1]) / 2);
      ctx.rotate(p.lean);
      ctx.strokeStyle = "rgba(212,212,216,0.7)";
      ctx.lineWidth = 1.1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-5, i * 4);
        ctx.lineTo(5, i * 4);
        ctx.stroke();
      }
      if (elite) {
        ctx.fillStyle = "#facc15";
        ctx.fillRect(-6, 8, 12, 3);
      }
      ctx.restore();
    },
    back: elite
      ? (ctx, s, p) => {
          ctx.fillStyle = "#3b0764";
          ctx.beginPath();
          ctx.moveTo(s.sh[0] - 3, s.sh[1]);
          ctx.lineTo(s.hip[0] - 16 - Math.sin(p.lean) * 6, s.hip[1] + 18);
          ctx.lineTo(s.hip[0] - 2, s.hip[1] + 14);
          ctx.closePath();
          ctx.fill();
        }
      : undefined,
    weapon: (ctx, s) => {
      const ang = s.foreN;
      const hand = s.handN;
      if (def.id === "lancer") {
        limb(ctx, [add(hand, ang, -26), add(hand, ang, 44)], 2.4, "#a16207");
        ctx.fillStyle = "#cbd5e1";
        const tip = add(hand, ang, 44);
        const tip2 = add(hand, ang, 56);
        ctx.beginPath();
        ctx.moveTo(...add(tip, ang + 1.57, 3.5));
        ctx.lineTo(...tip2);
        ctx.lineTo(...add(tip, ang - 1.57, 3.5));
        ctx.fill();
      } else if (def.id === "shield") {
        const c = add(s.handN, ang, 2);
        const broken = a.guardBroken > 0;
        ctx.beginPath();
        ctx.ellipse(c[0] + 3, c[1], 6, 15, 0, 0, Math.PI * 2);
        ctx.fillStyle = broken ? "rgba(148,163,184,0.25)" : "#71717a";
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = broken ? "rgba(0,0,0,0.3)" : "#0b0b12";
        ctx.stroke();
        if (!broken) {
          ctx.fillStyle = "#ef4444";
          ctx.beginPath();
          ctx.arc(c[0] + 4, c[1], 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (def.id === "bomber" && (a.state === "tell" || a.state === "attack")) {
        dot(ctx, hand, 5, "#18181b");
        dot(ctx, [hand[0] + 2, hand[1] - 6], 1.8, "#f97316", "#f97316");
      } else if (def.id === "sniper") {
        limb(ctx, [add(hand, ang, -8), add(hand, ang, 30)], 3, "#1e293b");
      } else dot(ctx, hand, 3.6, elite ? "#facc15" : "#27272a");
    },
  };
}

function bossSkin(id: BossId, a: Actor | null): Skin {
  const d = BOSSES[id];
  const base: Skin = {
    suit: d.color,
    suitDark: shade(d.color, 0.6),
    glove: d.accent,
    boot: shade(d.color, 0.5),
    bulk: id === "hornbuster" || id === "crabton" ? 1.15 : 1.02,
    head: (ctx, s, p) => {
      ctx.save();
      ctx.translate(s.head[0], s.head[1]);
      ctx.rotate(p.lean + p.head);
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = shade(d.color, 0.8);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#0b0b12";
      ctx.stroke();
      ctx.fillStyle = d.accent;
      if (id === "hornbuster") {
        ctx.beginPath();
        ctx.moveTo(6, -2);
        ctx.quadraticCurveTo(20, -6, 22, -20);
        ctx.quadraticCurveTo(14, -10, 7, -7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fde047";
        ctx.fillRect(3, -2, 5, 2.5);
      } else if (id === "mirage") {
        const g = ctx.createRadialGradient(2, 0, 1, 2, 0, 9);
        g.addColorStop(0, "#fff");
        g.addColorStop(1, "#a78bfa");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(3, 0, 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (id === "crabton") {
        ctx.fillRect(2, -4, 7, 3);
        dot(ctx, [3, -10], 2.4, "#fde047");
        dot(ctx, [-2, -11], 2.4, "#fde047");
      } else if (id === "darkshadow") {
        ctx.fillStyle = "#0b0b12";
        ctx.fillRect(-9, -3, 18, 4);
        ctx.fillStyle = "#818cf8";
        ctx.fillRect(1, -2.5, 8, 2);
        ctx.fillStyle = "#3f3f46";
        ctx.beginPath();
        ctx.moveTo(-4, -9);
        ctx.lineTo(-12, -16);
        ctx.lineTo(-1, -10);
        ctx.fill();
      } else {
        // Emperor crown.
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.moveTo(-8, -6);
        ctx.lineTo(-7, -16);
        ctx.lineTo(-3, -10);
        ctx.lineTo(0, -18);
        ctx.lineTo(3, -10);
        ctx.lineTo(7, -16);
        ctx.lineTo(8, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(2, -2, 6, 2.4);
      }
      ctx.restore();
    },
    chest: (ctx, s, p) => {
      ctx.save();
      ctx.translate((s.neck[0] + s.hip[0]) / 2, (s.neck[1] + s.hip[1]) / 2);
      ctx.rotate(p.lean);
      ctx.fillStyle = d.accent;
      ctx.globalAlpha = 0.9;
      if (id === "crabton") {
        ctx.beginPath();
        ctx.ellipse(1, -2, 8, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (id === "nemesis" || id === "darkshadow") {
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(5, 0);
        ctx.lineTo(0, 9);
        ctx.lineTo(-5, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-6, -8, 12, 3);
        ctx.fillRect(-6, 0, 12, 3);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
    back:
      id === "nemesis" || id === "darkshadow" || id === "mirage"
        ? (ctx, s, p) => {
            ctx.fillStyle = id === "nemesis" ? "#7f1d1d" : id === "mirage" ? "rgba(196,181,253,0.65)" : "#18181b";
            ctx.beginPath();
            ctx.moveTo(s.sh[0] - 4, s.sh[1] - 2);
            const sway = Math.sin((a?.t ?? 0) * 0.1) * 4;
            ctx.quadraticCurveTo(s.hip[0] - 22 - Math.sin(p.lean) * 10, s.hip[1], s.hip[0] - 18 + sway, s.hip[1] + 30);
            ctx.lineTo(s.hip[0] + 2, s.hip[1] + 26);
            ctx.closePath();
            ctx.fill();
            if (id === "mirage") {
              ctx.fillStyle = "rgba(255,255,255,0.6)";
              for (let i = 0; i < 3; i++) ctx.fillRect(s.hip[0] - 14 + i * 4, s.hip[1] + 4 + i * 7, 3, 4);
            }
          }
        : undefined,
    weapon: (ctx, s) => {
      const ang = s.foreN;
      const hand = s.handN;
      if (id === "crabton") {
        for (const [h, an] of [[s.handF, s.foreF], [hand, ang]] as [Pt, number][]) {
          ctx.save();
          ctx.translate(h[0], h[1]);
          ctx.rotate(-an);
          ctx.fillStyle = d.color;
          ctx.strokeStyle = "#0b0b12";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.ellipse(0, 9, 8, 11, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = d.accent;
          ctx.beginPath();
          ctx.moveTo(-6, 14);
          ctx.lineTo(-2, 26);
          ctx.lineTo(1, 15);
          ctx.moveTo(6, 14);
          ctx.lineTo(3, 24);
          ctx.lineTo(1, 15);
          ctx.fill();
          ctx.restore();
        }
      } else if (id === "darkshadow") {
        const tip = add(hand, ang, 40);
        limb(ctx, [hand, tip], 3.6, "#312e81");
        ctx.strokeStyle = "#a5b4fc";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(...add(hand, ang, 5));
        ctx.lineTo(...tip);
        ctx.stroke();
      } else if (id === "nemesis") {
        limb(ctx, [add(hand, ang, -10), add(hand, ang, 34)], 2.6, "#facc15");
        dot(ctx, add(hand, ang, 37), 5, "#a855f7", "#facc15");
      } else if (id === "hornbuster") {
        dot(ctx, hand, 5.5, d.accent);
        dot(ctx, s.handF, 5, d.accent);
      } else dot(ctx, hand, 4, d.accent);
    },
  };
  return base;
}

const mechaSkin: Skin = {
  suit: "#e2e8f0",
  suitDark: "#94a3b8",
  glove: "#ef4444",
  boot: "#1d4ed8",
  bulk: 1.12,
  head: (ctx, s, p) => {
    ctx.save();
    ctx.translate(s.head[0], s.head[1]);
    ctx.rotate(p.lean + p.head);
    ctx.fillStyle = "#e2e8f0";
    ctx.strokeStyle = "#0b0b12";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-8, -9, 16, 17);
    ctx.fill();
    ctx.stroke();
    // V-fin + eyes.
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(10, -17);
    ctx.lineTo(3, -6);
    ctx.lineTo(-4, -17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(2, -3, 6, 2.6);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(-8, 3, 16, 3);
    ctx.restore();
  },
  chest: (ctx, s, p) => {
    ctx.save();
    ctx.translate((s.neck[0] + s.hip[0]) / 2, (s.neck[1] + s.hip[1]) / 2);
    ctx.rotate(p.lean);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(-8, -9, 16, 9);
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, -1);
    ctx.lineTo(-5, -1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(-8, 6, 16, 4);
    ctx.restore();
  },
  weapon: (ctx, s, _p, a) => {
    const ang = s.foreN;
    const hand = s.handN;
    const anim = a?.move?.anim;
    if (anim === "straight" && a && a.moveT >= 12) return; // the fist flew off (rocket punch)
    if (anim && anim.startsWith("slash")) {
      const tip = add(hand, ang, 46);
      limb(ctx, [hand, tip], 4.5, "#f1f5f9");
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(...add(hand, ang, 6));
      ctx.lineTo(...tip);
      ctx.stroke();
    }
    dot(ctx, hand, 4.5, "#ef4444");
  },
};

function skinFor(a: Actor): Skin {
  if (a.kind === "hero" || a.kind === "assist") return heroSkin(HEROES[a.heroId!]);
  if (a.kind === "mecha") return mechaSkin;
  if (a.kind === "boss" || a.kind === "giant" || a.kind === "clone") return bossSkin(a.bossId!, a);
  return gruntSkin(a);
}

function drawBody(ctx: CanvasRenderingContext2D, skin: Skin, p: Pose, a: Actor | null) {
  const s = skeleton(p, skin.bulk);
  const k = skin.bulk;
  skin.back?.(ctx, s, p);
  // Far side first (shaded). Limbs are thick suit tubes, not sticks.
  limb(ctx, [s.sh, s.elbF, s.handF], 7 * k, skin.suitDark);
  dot(ctx, s.handF, 4.2 * k, skin.glove === "#f8fafc" ? "#cbd5e1" : skin.glove);
  limb(ctx, [s.hip, s.kneeF, s.footF], 9 * k, skin.suitDark);
  limb(ctx, [s.kneeF, s.footF], 9.4 * k, shade(skin.boot === "#f8fafc" ? "#cbd5e1" : skin.boot, 1));
  torso(ctx, s, p, skin.suit, 21 * k, 15 * k);
  skin.chest?.(ctx, s, p);
  limb(ctx, [s.hip, s.kneeN, s.footN], 9.6 * k, skin.suit);
  limb(ctx, [s.kneeN, s.footN], 10 * k, skin.boot);
  skin.head(ctx, s, p);
  // Shoulder pad + near arm.
  dot(ctx, s.sh, 5.2 * k, skin.suit);
  limb(ctx, [s.sh, s.elbN, s.handN], 7.4 * k, skin.suit);
  limb(ctx, [s.elbN, s.handN], 7.8 * k, skin.glove);
  dot(ctx, s.handN, 4.4 * k, skin.glove);
  skin.weapon?.(ctx, s, p, a);
}

/** Draws a figure standing at (sx, sy) (feet). */
function drawFigure(ctx: CanvasRenderingContext2D, skin: Skin, p: Pose, sx: number, sy: number, scale: number, face: number, a: Actor | null) {
  const s = skeleton(p, skin.bulk);
  const baseline = Math.max(s.footN[1], s.footF[1]);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(face * scale, scale);
  const rotated = Math.abs(p.rot) > 0.05;
  if (rotated) {
    ctx.translate(0, -30 * skin.bulk - p.lift);
    ctx.rotate(p.rot);
  } else ctx.translate(0, -baseline - p.lift);
  drawBody(ctx, skin, p, a);
  ctx.restore();
}

// ---------------------------------------------------------------- actors

function drawActor(ctx: CanvasRenderingContext2D, w: World, a: Actor, camX: number, opts: RenderOpts) {
  if (a.state === "gone") return;
  const sx = a.x - camX;
  const gy = groundY(a.z);
  const ds = depthScale(a.z) * a.scale * (a.kind === "mecha" || a.kind === "giant" ? 1 : 1.18);
  // Shadow.
  const shAlpha = Math.max(0.12, 0.38 - a.y / 300);
  ctx.fillStyle = a.kind === "clone" ? `rgba(0,0,0,${shAlpha * 0.35})` : `rgba(0,0,0,${shAlpha})`;
  ctx.beginPath();
  ctx.ellipse(sx, gy, 15 * ds, 4.5 * ds, 0, 0, Math.PI * 2);
  ctx.fill();
  if (a.kind === "crate") {
    drawCrate(ctx, sx, gy, ds);
    return;
  }
  if (a.hidden > 0) {
    ctx.globalAlpha = 0.15;
  }
  if (a.state === "dead") ctx.globalAlpha = Math.max(0, 1 - a.t / 60);
  if (a.invuln > 0 && a.invuln < 900 && (a.kind === "hero" || a.kind === "mecha") && a.state !== "dodge" && Math.floor(a.t / 3) % 2 === 0 && !opts.calm) ctx.globalAlpha *= 0.55;
  if (a.kind === "clone") ctx.globalAlpha *= 0.82;
  const skin = skinFor(a);
  const pose = poseFor(a);
  const sy = gy - a.y;
  // Afterimages on dodges, dashes and ultimates.
  if ((a.state === "dodge" || (a.state === "attack" && (a.move?.anim === "dash" || a.move?.id === "ult" || a.move?.invuln))) && !opts.calm) {
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * 0.25;
    drawFigure(ctx, skin, pose, sx - a.vx * 3, sy, ds, a.face, a);
    ctx.globalAlpha = ga * 0.12;
    drawFigure(ctx, skin, pose, sx - a.vx * 6, sy, ds, a.face, a);
    ctx.globalAlpha = ga;
  }
  // Aura for armor / iron wall / broken.
  if (a.ironWall > 0 || (a.state === "attack" && a.move?.armor)) {
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.strokeStyle = a.ironWall > 0 ? "#4ade80" : "#fbbf24";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 34 * ds, 22 * ds, 40 * ds, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (a.guardStance > 0) {
    ctx.save();
    ctx.globalAlpha = 0.45 + Math.sin(w.tick * 0.3) * 0.15;
    ctx.fillStyle = "#fda4af";
    ctx.beginPath();
    ctx.ellipse(sx + a.face * 26 * ds, sy - 36 * ds, 8 * ds, 36 * ds, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (a.parry > 0) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(w.tick * 0.5) * 0.3;
    ctx.strokeStyle = "#a5b4fc";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy - 40 * ds, 30 * ds, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawFigure(ctx, skin, pose, sx, sy, ds, a.face, a);
  // White hit flash.
  if (a.flash > 0 && !opts.calm) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = (a.flash / 6) * 0.55;
    drawFigure(ctx, { ...skin, suit: "#fff", suitDark: "#fff", glove: "#fff", boot: "#fff" }, pose, sx, sy, ds, a.face, null);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // Bind ribbons.
  if (a.state === "hit" && a.reaction === "bind") {
    ctx.strokeStyle = "#f9a8d4";
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(sx, sy - (20 + i * 12) * ds, 14 * ds, 4 * ds, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Dizzy stars.
  if (a.state === "stunned") {
    for (let i = 0; i < 3; i++) {
      const ang = w.tick * 0.12 + (i * Math.PI * 2) / 3;
      star(ctx, sx + Math.cos(ang) * 16 * ds, sy - 78 * ds + Math.sin(ang) * 4, 4 * Math.min(ds, 1.6), "#fde047");
    }
  }
  // Telegraph "!".
  if (a.state === "tell" && a.team === 1) {
    const blink = opts.calm || Math.floor(a.t / 4) % 2 === 0;
    const top = sy - 84 * ds - 6;
    if (blink) {
      ctx.fillStyle = a.kind === "enemy" ? "#ef4444" : "#f97316";
      ctx.beginPath();
      ctx.moveTo(sx, top - 16);
      ctx.lineTo(sx + 9, top + 2);
      ctx.lineTo(sx - 9, top + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", sx, top);
    }
    if (a.enemyId === "sniper") {
      ctx.strokeStyle = `rgba(239,68,68,${a.stun > 24 ? 0.35 : 0.85})`;
      ctx.lineWidth = a.stun > 24 ? 1 : 2;
      ctx.beginPath();
      ctx.moveTo(sx + a.face * 20, gy - 40);
      ctx.lineTo(a.face > 0 ? VIEW_W : 0, gy - 40);
      ctx.stroke();
    }
    if (a.next?.special === "charge") {
      ctx.fillStyle = "rgba(239,68,68,0.18)";
      const x0 = a.face > 0 ? sx : 0;
      ctx.fillRect(x0, gy - 8, a.face > 0 ? VIEW_W - sx : sx, 16);
    }
  }
  // Drone fuse ring.
  if (a.enemyId === "drone" && a.fuse > 0) {
    ctx.strokeStyle = `rgba(249,115,22,${0.4 + (1 - a.fuse / 54) * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, gy, 60, 16, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Grunt HP pips (only after being hurt).
  if (a.kind === "enemy" && a.hp < a.maxHp && a.hp > 0) {
    const bw = 28 * Math.min(1.4, ds);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(sx - bw / 2, sy - 86 * ds - 2, bw, 4);
    ctx.fillStyle = a.enemyId === "elite" ? "#c084fc" : "#f87171";
    ctx.fillRect(sx - bw / 2, sy - 86 * ds - 2, (bw * a.hp) / a.maxHp, 4);
    if (a.breakMax > 0) {
      ctx.fillStyle = "#fde047";
      ctx.fillRect(sx - bw / 2, sy - 86 * ds + 3, (bw * a.breakG) / a.breakMax, 2);
    }
  }
}

function drawCrate(ctx: CanvasRenderingContext2D, sx: number, gy: number, s: number) {
  const w = 30 * s;
  const h = 26 * s;
  ctx.fillStyle = "#a16207";
  ctx.strokeStyle = "#3f2a05";
  ctx.lineWidth = 2;
  ctx.fillRect(sx - w / 2, gy - h, w, h);
  ctx.strokeRect(sx - w / 2, gy - h, w, h);
  ctx.beginPath();
  ctx.moveTo(sx - w / 2, gy - h);
  ctx.lineTo(sx + w / 2, gy);
  ctx.moveTo(sx + w / 2, gy - h);
  ctx.lineTo(sx - w / 2, gy);
  ctx.stroke();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const an = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------- projectiles / fx

function drawProj(ctx: CanvasRenderingContext2D, w: World, p: Proj, camX: number, opts: RenderOpts) {
  const sx = p.x - camX;
  const gy = groundY(p.z);
  const sy = gy - p.y;
  const giant = w.mode === "giant";
  switch (p.kind) {
    case "shot":
    case "laser": {
      const col = p.kind === "laser" ? "#ef4444" : p.team === 0 ? "#fde047" : "#f87171";
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = opts.calm ? 0 : 10;
      ctx.beginPath();
      ctx.ellipse(sx, sy, p.kind === "laser" ? 22 : 10 + p.hit.r * 0.3, p.hit.r * 0.35 + 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(sx, sy, 5, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "arrow": {
      const d = p.vx >= 0 ? 1 : -1;
      ctx.strokeStyle = "#fbcfe8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - d * 16, sy);
      ctx.lineTo(sx + d * 6, sy);
      ctx.stroke();
      ctx.fillStyle = "#ec4899";
      ctx.beginPath();
      ctx.moveTo(sx + d * 12, sy);
      ctx.bezierCurveTo(sx + d * 6, sy - 6, sx + d * 2, sy - 2, sx + d * 6, sy);
      ctx.bezierCurveTo(sx + d * 2, sy + 2, sx + d * 6, sy + 6, sx + d * 12, sy);
      ctx.fill();
      break;
    }
    case "bomb":
    case "grenade":
    case "rock": {
      // Landing marker.
      if (p.kind === "rock") {
        const k = Math.min(1, p.t / Math.max(1, p.warn + 20));
        ctx.fillStyle = `rgba(0,0,0,${0.15 + k * 0.35})`;
        ctx.beginPath();
        ctx.ellipse(sx, gy, 24 * (0.4 + k * 0.6), 7 * (0.4 + k * 0.6), 0, 0, Math.PI * 2);
        ctx.fill();
        if (p.t < p.warn) break;
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(sx, gy, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const r = p.kind === "rock" ? 14 : 6;
      dot(ctx, [sx, sy], r, p.kind === "rock" ? "#78716c" : p.kind === "grenade" ? "#4d7c0f" : "#18181b");
      if (p.kind !== "rock" && Math.floor(p.t / 3) % 2 === 0) dot(ctx, [sx + 3, sy - r], 2, "#fde047", "#f97316");
      break;
    }
    case "orb":
    case "bubble": {
      const col = p.kind === "bubble" ? "rgba(253,164,175,0.55)" : p.home ? "#a855f7" : "#c4b5fd";
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = opts.calm ? 0 : 12;
      ctx.beginPath();
      ctx.arc(sx, sy, p.hit.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(sx - 3, sy - 3, p.hit.r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "pillar": {
      const col = p.color ?? "#facc15";
      if (p.t < p.warn) {
        const k = p.t / p.warn;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.35 + k * 0.5;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, gy, p.hit.r, p.hit.r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (p.hit.z > 40) {
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.12 + k * 0.15;
          ctx.fillRect(sx - p.hit.r, GROUND_TOP, p.hit.r * 2, GROUND_H);
        }
        ctx.globalAlpha = 1;
      } else {
        const g = ctx.createLinearGradient(sx - p.hit.r, 0, sx + p.hit.r, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, opts.calm ? col : "#fff");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - p.hit.r, 0, p.hit.r * 2, gy);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(sx - p.hit.r * 0.5, 0, p.hit.r, gy);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "wave": {
      ctx.fillStyle = p.team === 0 ? "rgba(134,239,172,0.7)" : "rgba(214,211,209,0.85)";
      ctx.beginPath();
      ctx.moveTo(sx - 20, gy);
      ctx.quadraticCurveTo(sx, gy - 26 - Math.sin(p.t) * 4, sx + 20, gy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "beam": {
      const from = p.dir > 0 ? sx : sx - p.len;
      const hgt = (p.hit.r * 2 + 6) * (giant ? 1.2 : 1);
      const col = p.team === 0 ? "#fde047" : p.owner >= 0 ? "#c084fc" : "#f87171";
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55 + Math.sin(p.t * 0.9) * 0.15;
      ctx.fillRect(from, sy - hgt / 2, p.len, hgt);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#fff";
      ctx.fillRect(from, sy - hgt / 6, p.len, hgt / 3);
      ctx.globalAlpha = 1;
      break;
    }
    case "fist": {
      const d = p.vx >= 0 ? 1 : -1;
      ctx.fillStyle = "#ef4444";
      ctx.strokeStyle = "#0b0b12";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(sx - 18, sy - 14, 36, 28, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fb923c";
      ctx.beginPath();
      ctx.moveTo(sx - d * 18, sy - 8);
      ctx.lineTo(sx - d * (34 + Math.sin(p.t * 2) * 6), sy);
      ctx.lineTo(sx - d * 18, sy + 8);
      ctx.fill();
      break;
    }
    default:
      dot(ctx, [sx, sy], 6, "#fff");
  }
}

function drawFx(ctx: CanvasRenderingContext2D, f: Fx, camX: number, opts: RenderOpts) {
  const sx = f.x - camX;
  const sy = groundY(f.z) - f.y;
  const k = f.t / f.life;
  ctx.save();
  switch (f.kind) {
    case "spark":
    case "heavySpark": {
      const big = f.kind === "heavySpark";
      const n = big ? 10 : 7;
      const r = (big ? 26 : 16) * f.size * (0.4 + k);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = big ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * Math.PI * 2 + f.x * 0.01;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(an) * r * 0.3, sy + Math.sin(an) * r * 0.3);
        ctx.lineTo(sx + Math.cos(an) * r, sy + Math.sin(an) * r);
        ctx.stroke();
      }
      if (!opts.calm) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx, sy, (big ? 9 : 5) * f.size * (1 - k), 0, Math.PI * 2);
        ctx.fill();
      }
      if (big) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 1.15, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "slash": {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(sx - f.dir * 6, sy, 26 * f.size, -1.1, 1.1, f.dir < 0);
      ctx.stroke();
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx - f.dir * 8, sy, 30 * f.size, -1.0, 1.0, f.dir < 0);
      ctx.stroke();
      break;
    }
    case "ring":
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 10 + k * 40 * f.size, (10 + k * 40 * f.size) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "dust":
      ctx.globalAlpha = (1 - k) * 0.6;
      ctx.fillStyle = "#d6d3d1";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(sx + i * 9 * f.size * (0.5 + k), sy - 4 - k * 8, 5 * f.size * (1 - k * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "boom":
    case "bigBoom": {
      const big = f.kind === "bigBoom";
      const r = (big ? 46 : 26) * f.size * (0.35 + ease(k));
      ctx.globalAlpha = 1 - k * 0.9;
      const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, r);
      g.addColorStop(0, opts.calm ? f.color : "#fff");
      g.addColorStop(0.35, f.color);
      g.addColorStop(1, "rgba(60,20,10,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(68,64,60,${0.5 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(sx, sy - r * 0.6 - k * 20, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "num": {
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const size = Math.round(12 * f.size * (k < 0.12 ? 1.4 - k * 3 : 1));
      ctx.font = `900 ${size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#0b0b12";
      const y = sy - k * 26;
      ctx.strokeText(f.text ?? "", sx, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text ?? "", sx, y);
      break;
    }
    case "text": {
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.font = `900 ${Math.round(13 * f.size)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#0b0b12";
      const y = sy - k * 18;
      ctx.strokeText(f.text ?? "", sx, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text ?? "", sx, y);
      break;
    }
    case "guard":
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const an = (i / 6) * Math.PI * 2;
        ctx.lineTo(sx + Math.cos(an) * 14 * f.size, sy + Math.sin(an) * 14 * f.size);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    case "heal":
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      for (let i = 0; i < 6; i++) {
        const px = sx + Math.sin(i * 2.1) * 18;
        const py = sy - k * 40 - i * 6;
        ctx.fillRect(px - 1.5, py - 5, 3, 10);
        ctx.fillRect(px - 5, py - 1.5, 10, 3);
      }
      if (f.text) {
        ctx.font = "900 14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(f.text, sx, sy - 50 - k * 20);
      }
      break;
    case "flashLine":
      if (opts.calm) break;
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const an = (i / 14) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(an) * 30, sy + Math.sin(an) * 30);
        ctx.lineTo(sx + Math.cos(an) * (60 + k * 200), sy + Math.sin(an) * (60 + k * 200));
        ctx.stroke();
      }
      break;
    case "smoke":
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.fillStyle = f.color;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(sx + Math.cos(i * 1.3) * 14 * f.size * (0.5 + k), sy + Math.sin(i * 1.3) * 10 - k * 10, 9 * f.size, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "speed":
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(sx - 40 - i * 4, sy - 50 + i * 12);
        ctx.lineTo(sx + 10, sy - 50 + i * 12);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- backgrounds

const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

function drawBackground(ctx: CanvasRenderingContext2D, w: World, camX: number) {
  const theme: Theme | "giant" = w.mode === "giant" ? "giant" : w.stage.theme;
  const sky: Record<string, [string, string]> = {
    quarry: ["#fb923c", "#fde68a"],
    city: ["#0b1024", "#312e81"],
    factory: ["#1c0a05", "#7c2d12"],
    fortress: ["#0f0a1a", "#3b0764"],
    throne: ["#12001f", "#4c0519"],
    giant: ["#f97316", "#fde047"],
  };
  const [s0, s1] = sky[theme];
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_TOP);
  g.addColorStop(0, s0);
  g.addColorStop(1, s1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, GROUND_TOP + 2);
  if (theme === "city" || theme === "fortress" || theme === "throne") {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 40; i++) ctx.fillRect((hash(i) * VIEW_W * 2 - camX * 0.05) % VIEW_W, hash(i + 99) * 120, 1.2, 1.2);
  }
  if (theme === "giant") {
    ctx.fillStyle = "rgba(255,247,200,0.8)";
    ctx.beginPath();
    ctx.arc(480, 110, 40, 0, Math.PI * 2);
    ctx.fill();
  }
  const layer = (par: number, every: number, draw: (x: number, i: number) => void) => {
    const off = camX * par;
    const first = Math.floor(off / every) - 1;
    for (let i = first; i < first + Math.ceil(VIEW_W / every) + 3; i++) draw(i * every - off, i);
  };
  switch (theme) {
    case "quarry":
      layer(0.15, 220, (x, i) => {
        ctx.fillStyle = "#c2410c";
        ctx.beginPath();
        ctx.moveTo(x, GROUND_TOP);
        ctx.lineTo(x + 60, 70 + hash(i) * 40);
        ctx.lineTo(x + 130, 90 + hash(i + 3) * 40);
        ctx.lineTo(x + 220, GROUND_TOP);
        ctx.fill();
      });
      layer(0.45, 160, (x, i) => {
        ctx.fillStyle = "#9a3412";
        ctx.beginPath();
        ctx.moveTo(x, GROUND_TOP);
        ctx.lineTo(x + 30, 140 + hash(i + 7) * 30);
        ctx.lineTo(x + 90, 130 + hash(i + 9) * 30);
        ctx.lineTo(x + 140, GROUND_TOP);
        ctx.fill();
      });
      break;
    case "city":
      layer(0.2, 70, (x, i) => {
        const h = 60 + hash(i) * 90;
        ctx.fillStyle = "#1e1b4b";
        ctx.fillRect(x, GROUND_TOP - h, 60, h);
      });
      layer(0.5, 110, (x, i) => {
        const h = 50 + hash(i + 50) * 80;
        ctx.fillStyle = "#111827";
        ctx.fillRect(x, GROUND_TOP - h, 90, h);
        for (let r = 0; r < Math.floor(h / 14); r++)
          for (let c = 0; c < 5; c++) {
            if (hash(i * 31 + r * 7 + c) < 0.45) continue;
            ctx.fillStyle = hash(i + r + c) < 0.5 ? "#fde68a" : "#93c5fd";
            ctx.fillRect(x + 8 + c * 16, GROUND_TOP - h + 8 + r * 14, 8, 6);
          }
      });
      break;
    case "factory":
      layer(0.25, 200, (x, i) => {
        ctx.fillStyle = "#292524";
        ctx.fillRect(x + 20, 50 + hash(i) * 30, 26, GROUND_TOP);
        ctx.fillRect(x + 70, 110, 120, GROUND_TOP);
        ctx.fillStyle = "rgba(168,162,158,0.25)";
        ctx.beginPath();
        ctx.arc(x + 33, 40 + hash(i) * 30 - ((w.tick * 0.3) % 30), 16, 0, Math.PI * 2);
        ctx.fill();
      });
      layer(0.6, 140, (x) => {
        ctx.strokeStyle = "#57534e";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x, 150);
        ctx.lineTo(x + 140, 150);
        ctx.moveTo(x + 40, 150);
        ctx.lineTo(x + 40, GROUND_TOP);
        ctx.stroke();
      });
      break;
    case "fortress":
      layer(0.4, 120, (x, i) => {
        ctx.fillStyle = "#1c1917";
        ctx.fillRect(x, 60, 120, GROUND_TOP - 60);
        ctx.strokeStyle = "#292524";
        ctx.lineWidth = 1;
        for (let r = 0; r < 8; r++) {
          ctx.beginPath();
          ctx.moveTo(x, 60 + r * 17);
          ctx.lineTo(x + 120, 60 + r * 17);
          ctx.stroke();
        }
        ctx.fillStyle = "#7f1d1d";
        ctx.fillRect(x + 40, 70, 30, 60);
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.arc(x + 55, 95, 6, 0, Math.PI * 2);
        ctx.fill();
        // Torch.
        const fl = 4 + Math.sin(w.tick * 0.3 + i) * 2;
        ctx.fillStyle = "#a855f7";
        ctx.beginPath();
        ctx.ellipse(x + 10, 120, 4, fl + 4, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    case "throne":
      layer(0.35, 160, (x) => {
        ctx.fillStyle = "#2e1065";
        ctx.fillRect(x + 20, 20, 30, GROUND_TOP);
        ctx.fillStyle = "#facc15";
        ctx.fillRect(x + 16, 20, 38, 6);
        ctx.fillRect(x + 16, GROUND_TOP - 8, 38, 6);
      });
      break;
    case "giant":
      layer(0.3, 90, (x, i) => {
        ctx.fillStyle = "#57534e";
        ctx.beginPath();
        ctx.moveTo(x, GROUND_TOP);
        ctx.lineTo(x + 45, 120 + hash(i) * 30);
        ctx.lineTo(x + 90, GROUND_TOP);
        ctx.fill();
      });
      break;
  }
  // Ground.
  const gg = ctx.createLinearGradient(0, GROUND_TOP, 0, VIEW_H);
  const ground: Record<string, [string, string]> = {
    quarry: ["#d6a56b", "#a16207"],
    city: ["#3f3f46", "#27272a"],
    factory: ["#44403c", "#292524"],
    fortress: ["#3f3f46", "#1c1917"],
    throne: ["#3b0764", "#1e0538"],
    giant: ["#78716c", "#44403c"],
  };
  gg.addColorStop(0, ground[theme][0]);
  gg.addColorStop(1, ground[theme][1]);
  ctx.fillStyle = gg;
  ctx.fillRect(0, GROUND_TOP, VIEW_W, VIEW_H - GROUND_TOP);
  if (theme === "city") {
    ctx.fillStyle = "#fde047";
    const off = camX % 60;
    for (let x = -off; x < VIEW_W; x += 60) ctx.fillRect(x, groundY(Z_MAX * 0.5), 30, 3);
  } else if (theme === "throne") {
    ctx.fillStyle = "#991b1b";
    ctx.fillRect(0, groundY(Z_MAX * 0.32), VIEW_W, groundY(Z_MAX * 0.68) - groundY(Z_MAX * 0.32));
  } else if (theme === "giant") {
    // Tiny buildings at the robots' feet sell the scale.
    const off = camX * 1;
    for (let i = 0; i < 16; i++) {
      const x = ((i * 47 - off) % (VIEW_W + 60)) - 30;
      const h = 8 + hash(i) * 16;
      ctx.fillStyle = "#a8a29e";
      ctx.fillRect(x, GROUND_TOP + 6 - h, 14, h);
      ctx.fillStyle = "#fde68a";
      ctx.fillRect(x + 3, GROUND_TOP + 8 - h, 3, 2);
    }
  } else {
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    const off = camX % 80;
    for (let x = -off; x < VIEW_W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_TOP);
      ctx.lineTo(x - 30, VIEW_H);
      ctx.stroke();
    }
  }
  // 제철소 vents.
  if (w.stage.vents && w.mode === "stage") {
    for (const vx of ventXs(w)) {
      const sx = vx - camX;
      if (sx < -40 || sx > VIEW_W + 40) continue;
      ctx.fillStyle = "#1c1917";
      ctx.fillRect(sx - 20, GROUND_TOP, 40, GROUND_H);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 20, GROUND_TOP, 40, GROUND_H);
      const t = w.ventT;
      if (t >= 30 && t < 60) {
        ctx.fillStyle = `rgba(249,115,22,${0.2 + ((t - 30) / 30) * 0.35})`;
        ctx.fillRect(sx - 20, GROUND_TOP, 40, GROUND_H);
      } else if (t >= 60 && t <= 100) {
        const k = (t - 60) / 40;
        ctx.fillStyle = `rgba(241,245,249,${0.65 - k * 0.3})`;
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.arc(sx + Math.sin(i + t * 0.2) * 8, VIEW_H - i * 40 - k * 30, 18 + i * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

// ---------------------------------------------------------------- HUD

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, lag?: number) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  if (lag !== undefined && lag > frac) {
    ctx.fillStyle = "#fca5a5";
    ctx.fillRect(x, y, w * lag, h);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, frac), h);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(x, y, w * Math.max(0, frac), h / 3);
}

function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = "left", stroke = 3) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.lineWidth = stroke;
  ctx.strokeStyle = "#0b0b12";
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawHud(ctx: CanvasRenderingContext2D, w: World, memo: RenderMemo, opts: RenderOpts) {
  const h = w.actors.find((a) => a.kind === "hero" || a.kind === "mecha");
  const hd = w.hero;
  if (!h) return;
  // Portrait.
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(6, 6, 196, 52);
  ctx.save();
  ctx.beginPath();
  ctx.rect(8, 8, 40, 48);
  ctx.clip();
  ctx.fillStyle = hd.dark;
  ctx.fillRect(8, 8, 40, 48);
  drawFigure(ctx, w.mode === "giant" ? mechaSkin : heroSkin(hd), IDLE, 30, 96, 1.25, 1, null);
  ctx.restore();
  const frac = h.hp / h.maxHp;
  memo.hpLag = Math.max(frac, memo.hpLag - 0.006);
  if (memo.hpLag < frac) memo.hpLag = frac;
  outlinedText(ctx, w.mode === "giant" ? MECHA.name : hd.name, 52, 18, "800 10px system-ui, sans-serif", "#fff");
  bar(ctx, 52, 22, 146, 8, frac, frac < 0.25 ? "#ef4444" : "#4ade80", memo.hpLag);
  bar(ctx, 52, 33, 100, 4, w.en / 100, "#38bdf8");
  // Prism gauge (rainbow).
  const pf = w.prism / PRISM_MAX;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(51, 40, 102, 7);
  const rg = ctx.createLinearGradient(52, 0, 152, 0);
  ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ec4899"].forEach((c, i) => rg.addColorStop(i / 4, c));
  ctx.fillStyle = rg;
  ctx.fillRect(52, 41, 100 * pf, 5);
  if (pf >= 1 && w.mode === "stage") outlinedText(ctx, opts.touch ? "필살 OK!" : "필살 OK! [F]", 156, 47, "900 9px system-ui, sans-serif", Math.floor(w.tick / 8) % 2 ? "#fde047" : "#fff");
  // Lives + assist stocks.
  for (let i = 0; i < w.lives; i++) {
    ctx.fillStyle = hd.color;
    ctx.beginPath();
    ctx.arc(160 + i * 9, 34, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (w.mode === "stage")
    for (let i = 0; i < 3; i++) {
      const on = i < w.assistStock;
      ctx.fillStyle = on ? ["#ef4444", "#3b82f6", "#facc15", "#22c55e", "#ec4899"][(i + 1) % 5] : "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.moveTo(165 + i * 12, 44);
      ctx.lineTo(170 + i * 12, 50);
      ctx.lineTo(165 + i * 12, 56);
      ctx.lineTo(160 + i * 12, 50);
      ctx.closePath();
      ctx.fill();
    }
  // Score, time, style.
  outlinedText(ctx, w.score.toLocaleString(), VIEW_W - 10, 22, "900 16px system-ui, sans-serif", "#fff", "right");
  const sec = Math.floor(w.time / 60);
  outlinedText(ctx, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`, VIEW_W - 10, 36, "700 10px system-ui, sans-serif", "#cbd5e1", "right");
  if (w.style > 0) {
    const r = styleRank(w.style);
    const idx = STYLE_RANKS.findIndex((x) => x.id === r.id);
    const next = STYLE_RANKS[idx + 1];
    outlinedText(ctx, r.id, VIEW_W - 12, 74, `italic 900 ${24 + idx * 2}px system-ui, sans-serif`, r.color, "right", 4);
    outlinedText(ctx, r.word, VIEW_W - 12, 86, "800 9px system-ui, sans-serif", r.color, "right");
    const nf = next ? (w.style - r.at) / (next.at - r.at) : 1;
    bar(ctx, VIEW_W - 72, 90, 60, 3, nf, r.color);
  }
  // Combo.
  if (w.combo >= 2) {
    const pulse = opts.calm ? 1 : 1 + Math.max(0, 0.25 - (COMBO_PULSE - w.comboT) * 0.03);
    ctx.save();
    ctx.translate(VIEW_W - 14, 128);
    ctx.scale(pulse, pulse);
    outlinedText(ctx, String(w.combo), 0, 0, "italic 900 30px system-ui, sans-serif", w.combo >= 30 ? "#e879f9" : w.combo >= 15 ? "#fb923c" : "#fde047", "right", 4);
    outlinedText(ctx, "HITS", 0, 13, "italic 900 10px system-ui, sans-serif", "#fff", "right");
    ctx.restore();
    bar(ctx, VIEW_W - 60, 146, 46, 2, w.comboT / 90, "#fde047");
  }
  // Boss bar.
  const b = w.actors.find((a) => a.id === w.bossActor && a.state !== "gone");
  if (b && (b.kind === "boss" || b.kind === "giant") && w.phase !== "bossIntro") {
    if (memo.bossId !== b.id) {
      memo.bossId = b.id;
      memo.bossLag = 1;
    }
    const bf = b.hp / b.maxHp;
    memo.bossLag = Math.max(bf, memo.bossLag - 0.004);
    const bx = 120;
    const by = VIEW_H - 26;
    const bw = VIEW_W - 240;
    const def = BOSSES[b.bossId!];
    outlinedText(ctx, `${b.kind === "giant" ? "거대 " : def.title + " "}${def.name}`, bx, by - 4, "900 11px system-ui, sans-serif", def.accent);
    if (b.kind === "boss") for (let i = 0; i < 3; i++) outlinedText(ctx, i < b.phase ? "◆" : "◇", bx + bw - i * 11, by - 4, "900 10px system-ui, sans-serif", "#f43f5e", "right");
    bar(ctx, bx, by, bw, 8, bf, bf < 0.33 ? "#f43f5e" : "#f97316", memo.bossLag);
    if (b.kind === "giant") {
      ctx.fillStyle = "#fde047";
      ctx.fillRect(bx + bw * 0.25 - 1, by - 2, 2, 12);
    }
    bar(ctx, bx, by + 11, bw, 3, b.breakMax ? b.breakG / b.breakMax : 0, b.broken > 0 ? "#fff" : "#fde047");
    if (b.charge > 0) {
      outlinedText(ctx, "다크 블래스트", bx + bw / 2, by - 18, "900 11px system-ui, sans-serif", "#c084fc", "center");
      bar(ctx, bx + bw * 0.2, by - 14, bw * 0.6, 5, b.charge, "#a855f7");
    }
  }
  // Skill bar (desktop).
  if (!opts.touch) {
    const skills = w.mode === "giant" ? [{ name: MECHA.rocket.name, key: "U", cd: w.cds[0], max: MECHA.rocket.cd ?? 1, en: MECHA.rocket.en ?? 0 }] : hd.skills.map((s, i) => ({ name: s.name, key: "UIO"[i], cd: w.cds[i], max: s.cd ?? 1, en: s.en ?? 0 }));
    skills.forEach((s, i) => {
      const x = 8 + i * 74;
      const y = VIEW_H - 22;
      const ok = s.cd <= 0 && w.en >= s.en;
      ctx.fillStyle = ok ? "rgba(15,23,42,0.75)" : "rgba(15,23,42,0.5)";
      ctx.fillRect(x, y, 70, 16);
      if (s.cd > 0) {
        ctx.fillStyle = "rgba(148,163,184,0.35)";
        ctx.fillRect(x, y, 70 * (s.cd / s.max), 16);
      }
      outlinedText(ctx, `${s.key}`, x + 4, y + 12, "900 10px system-ui, sans-serif", ok ? "#fde047" : "#64748b");
      outlinedText(ctx, s.name.length > 6 ? s.name.slice(0, 6) : s.name, x + 15, y + 12, "700 9px system-ui, sans-serif", ok ? "#fff" : "#94a3b8", "left", 2);
    });
  }
  // GO arrow.
  if (w.goT > 0 && w.lockX === null && Math.floor(w.goT / 15) % 2 === 0) outlinedText(ctx, "GO ▶", VIEW_W - 16, 190, "italic 900 26px system-ui, sans-serif", "#fde047", "right", 4);
  // Low HP vignette.
  if (frac < 0.25 && h.hp > 0 && !opts.calm) {
    const a = 0.25 + Math.sin(w.tick * 0.15) * 0.1;
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 140, VIEW_W / 2, VIEW_H / 2, 380);
    vg.addColorStop(0, "rgba(220,38,38,0)");
    vg.addColorStop(1, `rgba(220,38,38,${a})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}
const COMBO_PULSE = 90;

function drawBanner(ctx: CanvasRenderingContext2D, w: World) {
  const b = w.banner;
  if (!b) return;
  const inK = Math.min(1, (b.t > 0 ? 1 : 0) * 1);
  ctx.save();
  ctx.globalAlpha = Math.min(1, b.t / 12) * inK;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 118, VIEW_W, b.sub ? 54 : 38);
  ctx.fillStyle = b.color;
  ctx.fillRect(0, 118, VIEW_W, 2);
  ctx.fillRect(0, (b.sub ? 170 : 154), VIEW_W, 2);
  outlinedText(ctx, b.text, VIEW_W / 2, 145, "italic 900 22px system-ui, sans-serif", b.color, "center", 4);
  if (b.sub) outlinedText(ctx, b.sub, VIEW_W / 2, 163, "700 11px system-ui, sans-serif", "#f1f5f9", "center");
  ctx.restore();
}

function drawCutIn(ctx: CanvasRenderingContext2D, w: World, opts: RenderOpts) {
  const c = w.cutin;
  if (!c) return;
  const k = c.t / c.total;
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.55 * Math.min(1, c.t / 6)})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // Diagonal band sliding in.
  const slide = Math.min(1, c.t / 10);
  ctx.translate((1 - slide) * -VIEW_W, 0);
  ctx.beginPath();
  ctx.moveTo(0, 110);
  ctx.lineTo(VIEW_W, 80);
  ctx.lineTo(VIEW_W, 250);
  ctx.lineTo(0, 280);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 80, 0, 280);
  g.addColorStop(0, c.color);
  g.addColorStop(1, shade(c.color === "#f8fafc" ? "#a855f7" : c.color, 0.45));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  if (!opts.calm)
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      const y = 90 + hash(i) * 180;
      const x = ((hash(i + 5) * VIEW_W + c.t * 30) % (VIEW_W + 200)) - 100;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 120, y + 6);
      ctx.stroke();
    }
  // Close-up figure(s).
  if (c.heroId === "team") {
    HERO_ORDER.forEach((id, i) => drawFigure(ctx, heroSkin(HEROES[id]), ATTACK.pose[1], 120 + i * 90, 300 + Math.abs(i - 2) * 10, 2.4, 1, null));
  } else if (c.heroId === "mecha") {
    drawFigure(ctx, mechaSkin, ATTACK.slashUp[1], 170, 330, 3.2, 1, null);
  } else {
    drawFigure(ctx, heroSkin(HEROES[c.heroId]), ATTACK.pose[1], 160, 360, 4.2, 1, null);
  }
  ctx.restore();
  const tk = Math.min(1, Math.max(0, (c.t - 6) / 8));
  ctx.save();
  ctx.globalAlpha = tk * (k > 0.9 ? (1 - k) * 10 : 1);
  outlinedText(ctx, c.name, VIEW_W - 24, 200, "italic 900 28px system-ui, sans-serif", "#fff", "right", 5);
  ctx.restore();
}

function drawIntro(ctx: CanvasRenderingContext2D, w: World, opts: RenderOpts) {
  if (w.phase !== "intro" && !(w.phase === "giantIntro")) return;
  const t = w.phaseT;
  if (w.phase === "giantIntro") {
    // 합체 sequence: five coloured vehicles converge into the robot.
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 0.6 - t / 200)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (t < 90) {
      HERO_ORDER.forEach((id, i) => {
        const k = Math.min(1, t / 80);
        const sx = lerp(i % 2 ? VIEW_W + 60 : -60, 170, ease(k));
        const sy = lerp(40 + i * 50, 200, ease(k));
        ctx.fillStyle = HEROES[id].color;
        ctx.beginPath();
        ctx.roundRect(sx - 18, sy - 9, 36, 18, 5);
        ctx.fill();
        ctx.strokeStyle = "#0b0b12";
        ctx.stroke();
      });
    }
    if (t >= 80 && t < 100 && !opts.calm) {
      ctx.fillStyle = `rgba(255,255,255,${1 - (t - 80) / 20})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (t >= 90) outlinedText(ctx, "프리즘 킹로보 — 합체 완료!", VIEW_W / 2, 70, "italic 900 22px system-ui, sans-serif", "#fde047", "center", 4);
    ctx.restore();
    return;
  }
  const h = w.actors.find((a) => a.kind === "hero");
  if (!h) return;
  ctx.save();
  if (t < 60) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    outlinedText(ctx, "프리즘 체인지!", VIEW_W / 2, 90, "italic 900 26px system-ui, sans-serif", w.hero.color, "center", 5);
    // Civilian silhouette with a glowing brace.
    const sx = h.x - w.camX;
    const sy = groundY(h.z);
    ctx.fillStyle = `rgba(255,255,255,${0.2 + (t / 60) * 0.6})`;
    ctx.beginPath();
    ctx.arc(sx, sy - 40, 20 + t * 0.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (t < 100) {
    const k = (t - 60) / 40;
    const cols = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ec4899"];
    if (!opts.calm) {
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.fillRect(0, (i * VIEW_H) / 5, VIEW_W, VIEW_H / 5);
      });
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  } else {
    // Name call + coloured sentai explosion behind the pose.
    const k = (t - 100) / 50;
    const sx = h.x - w.camX;
    const sy = groundY(h.z);
    if (!opts.calm)
      ["#ef4444", "#3b82f6", "#facc15", "#22c55e", "#ec4899"].forEach((c, i) => {
        ctx.globalAlpha = 0.7 * (1 - k);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(sx - 80 + i * 40, sy - 70 - Math.abs(i - 2) * 6, 20 + k * 40, 0, Math.PI * 2);
        ctx.fill();
      });
    ctx.globalAlpha = 1;
    outlinedText(ctx, `${w.hero.name}!`, VIEW_W / 2, 90, "italic 900 26px system-ui, sans-serif", w.hero.color, "center", 5);
    outlinedText(ctx, "섬광전대 — 프리즘파이브!", VIEW_W / 2, 112, "900 13px system-ui, sans-serif", "#fff", "center", 4);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- main

export function drawWorld(ctx: CanvasRenderingContext2D, w: World, memo: RenderMemo, opts: RenderOpts) {
  ctx.save();
  const shake = opts.noShake ? 0 : w.shake;
  const sx = shake ? (hash(w.tick) - 0.5) * shake : 0;
  const sy = shake ? (hash(w.tick + 33) - 0.5) * shake * 0.6 : 0;
  ctx.translate(sx, sy);
  const camX = w.camX;
  drawBackground(ctx, w, camX);
  // Pickups.
  for (const p of w.pickups) {
    const px = p.x - camX;
    const py = groundY(p.z) - 8 - Math.abs(Math.sin(p.t * 0.08)) * 4;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(px, groundY(p.z), 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (p.t > 60 * 21 && Math.floor(p.t / 6) % 2 === 0) continue;
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(PICKUP_EMOJI[p.kind], px, py);
  }
  // Depth-sorted actors + projectiles.
  const items: { z: number; draw: () => void }[] = [];
  for (const a of w.actors) items.push({ z: a.z + (a.kind === "assist" ? 0.1 : 0), draw: () => drawActor(ctx, w, a, camX, opts) });
  for (const p of w.projs) items.push({ z: p.kind === "pillar" || p.kind === "beam" ? p.z + 0.2 : p.z, draw: () => drawProj(ctx, w, p, camX, opts) });
  items.sort((a, b) => a.z - b.z);
  for (const it of items) it.draw();
  for (const f of w.fx) drawFx(ctx, f, camX, opts);
  ctx.restore();
  // Screen-space overlays.
  if (w.slow > 0 && !opts.calm) {
    ctx.fillStyle = "rgba(125,211,252,0.12)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  const boss = w.actors.find((a) => a.id === w.bossActor);
  if (boss?.charge && !opts.calm) {
    ctx.fillStyle = `rgba(88,28,135,${boss.charge * 0.35})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  drawHud(ctx, w, memo, opts);
  drawBanner(ctx, w);
  drawIntro(ctx, w, opts);
  drawCutIn(ctx, w, opts);
  if (w.phase === "finish") {
    const k = Math.min(1, w.phaseT / 60);
    outlinedText(ctx, "정의는 반드시 이긴다!", VIEW_W / 2, 80, "italic 900 26px system-ui, sans-serif", "#fde047", "center", 5);
    if (!opts.calm && w.phaseT < 20) {
      ctx.fillStyle = `rgba(255,255,255,${1 - k * 3})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }
}

const PICKUP_EMOJI: Record<string, string> = { riceball: "🍙", meat: "🍖", crystal: "🔷", prism: "💎", star: "⭐" };

/** Lobby preview: one hero (or the robot) in an idle/pose loop. */
export function drawPreview(ctx: CanvasRenderingContext2D, who: HeroId | "mecha" | BossId, t: number, w: number, h: number, anim: AnimKind | "idle" = "idle") {
  ctx.clearRect(0, 0, w, h);
  const skin = who === "mecha" ? mechaSkin : who in HEROES ? heroSkin(HEROES[who as HeroId]) : bossSkin(who as BossId, null);
  let p: Pose;
  if (anim === "idle") p = P({ lean: 0.08 + Math.sin(t * 0.08) * 0.04, arN: 0.55 + Math.sin(t * 0.08) * 0.04 });
  else {
    const k = (t % 60) / 60;
    p = k < 0.4 ? mix(IDLE, ATTACK[anim][0], ease(k / 0.4)) : k < 0.55 ? mix(ATTACK[anim][0], ATTACK[anim][1], ease((k - 0.4) / 0.15)) : mix(ATTACK[anim][1], IDLE, (k - 0.55) / 0.45);
  }
  const scale = h / 95;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(w / 2, h - 8, 18 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  drawFigure(ctx, skin, p, w / 2, h - 8, scale, 1, null);
}
