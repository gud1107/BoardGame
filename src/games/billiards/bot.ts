/**
 * 당구 파티 AI (rulebook §11). Candidate shots — ghost-ball aims at every
 * pocket (럭키 포켓) or cut angles on both reds plus cushion-first banks
 * (캐롬) — are rolled through the real physics and scored; higher levels
 * look at more of them, judge their top picks under their own hand tremor
 * (Lv.7+), pick a smarter cue-ball spot when the ball is in hand and shake
 * less when they finally cue.
 *
 * The bot may use trig and Math.random freely — only the resulting integer
 * shot goes into the action, and the outcome is re-simulated by everyone.
 */

import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  CUE_ID,
  FOOT_X,
  HEAD_X,
  judge,
  lowestBall,
  quantizeShot,
  quantizeSpin,
  RED_A,
  RED_B,
  runShot,
  YELLOW,
  type Ball,
  type BilliardsState,
  type EngineAction,
  type Seat,
} from "./engine";
import { firstContact, HALF_H, HALF_W, POCKETS, R, rollDistance, spotFree, V_MAX } from "./physics";

interface Params {
  speeds: number[];
  spins: number[];
  cuts: number[];
  banks: number;
  angleSd: number;
  speedSd: number;
  robust: boolean;
  smartPlace: boolean;
  /** Weight of "what the next player is left with" (0 = ignore). */
  leave: number;
}

const ANGLE_SD = [0.034, 0.027, 0.021, 0.017, 0.0135, 0.0105, 0.008, 0.0055, 0.0035, 0.002];
const SPEED_SD = [0.16, 0.13, 0.11, 0.09, 0.075, 0.06, 0.05, 0.04, 0.03, 0.022];

export function botParams(level: BotLevel): Params {
  const l = clampBotLevel(level);
  return {
    speeds: l <= 2 ? [9, 15] : l <= 5 ? [6, 10, 15, 21] : [5, 8, 11.5, 16, 22],
    spins: l <= 3 ? [0] : l <= 6 ? [-0.6, 0, 0.6] : [-0.8, -0.35, 0, 0.35, 0.8],
    cuts: l <= 3 ? [-0.6, -0.3, 0, 0.3, 0.6] : l <= 6 ? [-0.8, -0.45, -0.15, 0.15, 0.45, 0.8] : [-0.9, -0.7, -0.5, -0.3, -0.12, 0.12, 0.3, 0.5, 0.7, 0.9],
    banks: l <= 3 ? 4 : l <= 6 ? 8 : 18,
    angleSd: ANGLE_SD[l - 1],
    speedSd: SPEED_SD[l - 1],
    robust: l >= 7,
    smartPlace: l >= 4,
    leave: l <= 4 ? 0 : l <= 7 ? 0.5 : 1,
  };
}

interface Candidate {
  vx: number;
  vy: number;
  spin: number;
  side: number;
  place: { x: number; y: number } | null;
}

function cueOf(balls: readonly Ball[]): Ball {
  return balls.find((b) => b.id === CUE_ID) ?? { id: CUE_ID, x: HEAD_X, y: 0 };
}

/** How good the aftermath of `c` is for the shooter. */
export function evaluate(state: BilliardsState, c: Candidate, p: Params): number {
  let balls: Ball[] = state.balls;
  if (c.place) balls = balls.map((b) => (b.id === CUE_ID ? { ...b, x: c.place!.x, y: c.place!.y } : b));
  const q = quantizeShot(c.vx, c.vy);
  const sim = runShot(balls, state.options.mode, q.vx, q.vy, quantizeSpin(c.spin), quantizeSpin(c.side));
  const j = judge(state, balls, sim);
  let score = j.points * 10;
  if (j.foul) score -= state.options.mode === "pocket" ? 8 : 4;
  if (j.again) score += 4;
  if (state.options.mode === "pocket" && !j.foul) {
    // gold 9 off the table early is worth chasing a little extra
    if (j.scored.some((s) => s.id === 9)) score += 2;
  }
  if (p.leave > 0) {
    const rest = new Map(sim.rest.map((r) => [r.id, r]));
    const cue = rest.get(CUE_ID);
    if (state.options.mode === "pocket") {
      // next lowest ball: easy for whoever shoots next (me if I keep the cue, else a rival)
      const left = balls.filter((b) => rest.has(b.id)).map((b) => ({ ...b, ...rest.get(b.id)! }));
      const low = lowestBall(left);
      const tb = left.find((b) => b.id === low);
      if (cue && tb && !j.foul) {
        const ease = potEase(left, cue, tb);
        score += (j.again ? 1 : -1) * ease * 3 * p.leave;
      }
    } else if (cue) {
      const a = rest.get(RED_A);
      const b = rest.get(RED_B);
      if (a && b) {
        const spread = Math.hypot(a.x - b.x, a.y - b.y);
        // two reds close together = an easy next carom
        const ease = Math.max(0, 1 - spread / 10);
        score += (j.again ? 1 : -1) * ease * 2 * p.leave;
      }
    }
  }
  return score;
}

/** 0..1 — how straightforward a pot of `t` is from the cue's spot (straight, short, pocket in view). */
function potEase(balls: readonly Ball[], cue: { x: number; y: number }, t: Ball): number {
  let best = 0;
  for (const pk of POCKETS) {
    const px = pk.x - t.x;
    const py = pk.y - t.y;
    const pl = Math.hypot(px, py) || 1;
    const gx = t.x - (px / pl) * 2 * R;
    const gy = t.y - (py / pl) * 2 * R;
    const ax = gx - cue.x;
    const ay = gy - cue.y;
    const al = Math.hypot(ax, ay) || 1;
    const cos = (ax * px + ay * py) / (al * pl);
    if (cos < 0.25) continue;
    if (blocked(balls, cue, { x: gx, y: gy }, [CUE_ID, t.id]) || blocked(balls, t, pk, [t.id])) continue;
    const e = cos * Math.max(0, 1 - (al + pl) / 40);
    best = Math.max(best, e);
  }
  return best;
}

function blocked(balls: readonly Ball[], from: { x: number; y: number }, to: { x: number; y: number }, ignore: number[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  for (const b of balls) {
    if (ignore.includes(b.id)) continue;
    const ox = b.x - from.x;
    const oy = b.y - from.y;
    const along = ox * ux + oy * uy;
    if (along <= 0 || along >= L) continue;
    const perp = Math.abs(ox * uy - oy * ux);
    if (perp < 2 * R * 0.98) return true;
  }
  return false;
}

function aimAt(from: { x: number; y: number }, to: { x: number; y: number }, speed: number, spin: number, place: Candidate["place"]): Candidate {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  return { vx: (dx / l) * speed, vy: (dy / l) * speed, spin, side: 0, place };
}

/** Ball-in-hand: a few spots worth trying (straight-in lines to the target ball). */
function placeSpots(state: BilliardsState, p: Params, rng: () => number): ({ x: number; y: number } | null)[] {
  if (!state.ballInHand) return [null];
  const sims = state.balls.map((b) => ({ id: b.id, x: b.x, y: b.y }));
  const out: { x: number; y: number }[] = [];
  const tryAdd = (x: number, y: number) => {
    if (spotFree(sims, x, y, CUE_ID)) out.push({ x, y });
  };
  if (state.options.mode === "pocket" && p.smartPlace) {
    const low = lowestBall(state.balls);
    const t = state.balls.find((b) => b.id === low);
    if (t) {
      for (const pk of POCKETS) {
        const px = pk.x - t.x;
        const py = pk.y - t.y;
        const pl = Math.hypot(px, py) || 1;
        for (const back of [3.2, 5.5]) tryAdd(t.x - (px / pl) * (2 * R + back), t.y - (py / pl) * (2 * R + back));
      }
    }
  }
  for (let i = 0; i < 3; i++) tryAdd(HEAD_X + (rng() - 0.5) * 6, (rng() - 0.5) * (HALF_H * 1.4));
  tryAdd(HEAD_X, 0);
  return out.length ? out.slice(0, p.smartPlace ? 8 : 2) : [null];
}

export function candidateShots(state: BilliardsState, p: Params, rng: () => number): Candidate[] {
  const out: Candidate[] = [];
  for (const place of placeSpots(state, p, rng)) {
    const cue = place ?? cueOf(state.balls);
    if (state.options.mode === "pocket") {
      const low = lowestBall(state.balls);
      const t = state.balls.find((b) => b.id === low);
      if (!t) continue;
      // ghost ball at each pocket line
      for (const pk of POCKETS) {
        const px = pk.x - t.x;
        const py = pk.y - t.y;
        const pl = Math.hypot(px, py) || 1;
        const g = { x: t.x - (px / pl) * 2 * R, y: t.y - (py / pl) * 2 * R };
        const ax = g.x - cue.x;
        const ay = g.y - cue.y;
        const cos = (ax * px + ay * py) / ((Math.hypot(ax, ay) || 1) * pl);
        if (cos < 0.12) continue;
        for (const sp of p.speeds) for (const spin of p.spins) out.push(aimAt(cue, g, sp, spin, place));
      }
      // plain contact / safety: just hit the target thin or full, softly
      for (const cut of [-0.7, 0, 0.7]) {
        const dx = t.x - cue.x;
        const dy = t.y - cue.y;
        const l = Math.hypot(dx, dy) || 1;
        const tgt = { x: t.x + (-dy / l) * cut * 2 * R, y: t.y + (dx / l) * cut * 2 * R };
        for (const sp of [4, 7]) out.push(aimAt(cue, tgt, sp, 0, place));
      }
    } else {
      for (const id of [RED_A, RED_B]) {
        const t = state.balls.find((b) => b.id === id);
        if (!t) continue;
        const dx = t.x - cue.x;
        const dy = t.y - cue.y;
        const l = Math.hypot(dx, dy) || 1;
        for (const cut of p.cuts) {
          const tgt = { x: t.x + (-dy / l) * cut * 2 * R, y: t.y + (dx / l) * cut * 2 * R };
          for (const sp of p.speeds) {
            if (rollDistance(sp) < l + 5) continue;
            for (const spin of p.spins) out.push(aimAt(cue, tgt, sp, spin, place));
          }
        }
      }
    }
    // cushion-first banks in random directions (caroms love them; in pocket mode only as kick shots, see below)
    for (let i = 0; i < (state.options.mode === "pocket" ? 0 : p.banks); i++) {
      const a = rng() * Math.PI * 2;
      const sp = 9 + rng() * 12;
      out.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, spin: (rng() - 0.5) * 1.2, side: (rng() - 0.5) * 1.4, place });
    }
  }
  return out;
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The shot a hand with this tremor actually plays when aiming `c`. */
export function tremble(c: Candidate, p: Pick<Params, "angleSd" | "speedSd">, rng: () => number): Candidate {
  const a = gaussian(rng) * p.angleSd;
  const k = Math.max(0.3, 1 + gaussian(rng) * p.speedSd);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let vx = (c.vx * cos - c.vy * sin) * k;
  let vy = (c.vx * sin + c.vy * cos) * k;
  const s = Math.hypot(vx, vy);
  if (s > V_MAX) {
    vx *= V_MAX / s;
    vy *= V_MAX / s;
  }
  return { ...c, vx, vy, spin: Math.max(-1, Math.min(1, c.spin + gaussian(rng) * p.speedSd)) };
}

export function chooseBotAction(state: BilliardsState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "aim" || state.activeSeat !== seat) return null;
  const p = botParams(level);
  let cands = candidateShots(state, p, rng);
  if (state.options.mode === "pocket") {
    // only shots whose straight line meets the lowest ball first (a hand-placed cue counts from its spot)
    const low = lowestBall(state.balls);
    const direct = cands.filter((c) => {
      const balls = c.place ? state.balls.map((b) => (b.id === CUE_ID ? { ...b, ...c.place! } : b)) : state.balls;
      const l = Math.hypot(c.vx, c.vy) || 1;
      const hit = firstContact(balls, CUE_ID, c.vx / l, c.vy / l);
      // must reach the ball with some pace left (a shot that dies short is a free foul)
      return hit?.id === low && rollDistance(l) > hit.t + 2.5;
    });
    if (direct.length > 0) cands = direct;
    else {
      // snookered: kick off a cushion
      for (let i = 0; i < Math.max(8, p.banks); i++) {
        const a = rng() * Math.PI * 2;
        const sp = 8 + rng() * 10;
        cands.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, spin: 0, side: (rng() - 0.5) * 1.4, place: null });
      }
    }
  }
  if (cands.length === 0) {
    const cue = cueOf(state.balls);
    cands.push(aimAt(cue, { x: FOOT_X, y: 0 }, 10, 0, null));
  }
  let scored = cands.map((c) => ({ move: c, score: evaluate(state, c, p) }));
  if (p.robust) {
    scored = [...scored].sort((a, b) => b.score - a.score).slice(0, 6);
    for (const t of scored) {
      let sum = t.score;
      for (let i = 0; i < 3; i++) sum += evaluate(state, tremble(t.move, p, rng), p);
      t.score = sum / 4;
    }
  }
  const pick = pickByLevel(scored, level, rng);
  const shot = tremble(pick, p, rng);
  const q = quantizeShot(shot.vx, shot.vy);
  if (q.vx === 0 && q.vy === 0) return null;
  const place = shot.place ? { x: Math.round(shot.place.x * 1000), y: Math.round(shot.place.y * 1000) } : null;
  return { type: "shoot", seat, vx: q.vx, vy: q.vy, spin: quantizeSpin(shot.spin), side: quantizeSpin(shot.side), place };
}

/** Exported for tests: sanity of a straight-in pot. */
export const _internals = { potEase, blocked, HALF_W, YELLOW };
