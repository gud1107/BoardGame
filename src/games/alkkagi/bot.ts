/**
 * 알까기 대전 AI (rulebook §12). Candidate shots (own stone × nearby enemy
 * stone × cut angle × speed) are rolled through the real physics and scored;
 * higher levels look at more of them, judge top picks under their own hand
 * tremor (Lv.7+), and shake less when they finally flick.
 *
 * The bot may use trig and Math.random freely — only the resulting integer
 * velocity goes into the action, and the outcome is re-simulated by everyone.
 */

import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { aliveSeats, edgeDistance, maxChain, quantizeShot, resolveShot, type AlkkagiState, type EngineAction, type Seat, type Stone } from "./engine";
import { V_MAX } from "./physics";

interface Params {
  ownStones: number;
  targetsPerStone: number;
  cuts: number[];
  speeds: number[];
  /** Hand tremor: direction (radians, 1σ) and speed (fraction, 1σ). */
  angleSd: number;
  speedSd: number;
  robust: boolean;
}

const ANGLE_SD = [0.105, 0.085, 0.066, 0.05, 0.038, 0.028, 0.02, 0.013, 0.008, 0.005];
const SPEED_SD = [0.14, 0.12, 0.1, 0.085, 0.07, 0.055, 0.045, 0.035, 0.027, 0.02];

export function botParams(level: BotLevel): Params {
  const l = clampBotLevel(level);
  return {
    ownStones: l <= 2 ? 2 : l <= 4 ? 3 : l <= 6 ? 5 : 99,
    targetsPerStone: l <= 2 ? 1 : l <= 4 ? 2 : l <= 6 ? 3 : l <= 8 ? 4 : 5,
    cuts: l <= 3 ? [0] : l <= 6 ? [-0.35, 0, 0.35] : [-0.6, -0.3, 0, 0.3, 0.6],
    speeds: l <= 2 ? [9, 14] : l <= 5 ? [6, 9, 12.5, 16] : [5, 7.5, 10, 13, 16],
    angleSd: ANGLE_SD[l - 1],
    speedSd: SPEED_SD[l - 1],
    robust: l >= 7,
  };
}

interface Candidate {
  stone: number;
  vx: number;
  vy: number;
}

/** How good a shot's aftermath is for `seat` (§12). */
export function evaluateShot(state: AlkkagiState, seat: Seat, c: Candidate): number {
  const before = state.stones;
  const q = quantizeShot(c.vx, c.vy);
  const out = resolveShot(before, c.stone, q.vx, q.vy, state.options.king);
  const byId = new Map(before.map((s) => [s.id, s]));
  let score = 0;
  let knocked = 0;
  const gone = [...out.falls.map((f) => f.id), ...out.surrendered];
  for (const id of gone) {
    const s = byId.get(id)!;
    if (s.owner === seat) score -= s.king ? 60 : 14;
    else {
      score += s.king ? 45 : 10;
      knocked++;
    }
  }
  const shooterFell = out.falls.some((f) => f.id === c.stone);
  if (shooterFell) score -= 3;
  else if (knocked > 0 && state.chain + 1 < maxChain(state.options)) score += 3;
  const was = aliveSeats(state);
  const now = new Set(aliveSeats({ stones: out.stones, playerCount: state.playerCount }));
  for (const s of was) if (!now.has(s)) score += s === seat ? -40 : 8;
  for (const s of out.stones) {
    const risk = Math.max(0, 2.6 - edgeDistance(s.x, s.y));
    if (s.owner === seat) score -= 1.4 * risk * (s.king ? 3 : 1);
    else score += 0.6 * risk * (s.king ? 2 : 1);
  }
  return score;
}

function dist2(a: Stone, b: Stone) {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

export function candidateShots(state: AlkkagiState, seat: Seat, p: Params, rng: () => number): Candidate[] {
  let own = state.stones.filter((s) => s.owner === seat);
  const foes = state.stones.filter((s) => s.owner !== seat);
  if (own.length > p.ownStones) {
    // weaker bots only think about a few stones — the ones closest to an enemy
    own = own
      .map((s) => ({ s, d: Math.min(...foes.map((f) => dist2(s, f))) + rng() * 4 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, p.ownStones)
      .map((x) => x.s);
  }
  const out: Candidate[] = [];
  for (const s of own) {
    const near = [...foes].sort((a, b) => dist2(s, a) - dist2(s, b)).slice(0, p.targetsPerStone);
    for (const t of near) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const px = -dy / d;
      const py = dx / d;
      for (const cut of p.cuts) {
        const reach = (s.king ? 0.62 : 0.46) + (t.king ? 0.62 : 0.46);
        const ax = t.x + px * cut * reach - s.x;
        const ay = t.y + py * cut * reach - s.y;
        const al = Math.hypot(ax, ay) || 1;
        for (const sp of p.speeds) out.push({ stone: s.id, vx: (ax / al) * sp, vy: (ay / al) * sp });
      }
    }
    // a stone near the edge can also just slide back toward the middle
    if (edgeDistance(s.x, s.y) < 2.6) {
      const d = Math.hypot(s.x, s.y) || 1;
      for (const sp of [2.5, 3.6]) out.push({ stone: s.id, vx: (-s.x / d) * sp, vy: (-s.y / d) * sp });
    }
  }
  return out;
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The shot a hand with this tremor actually plays when aiming at `c`. */
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
  return { stone: c.stone, vx, vy };
}

export function chooseBotAction(state: AlkkagiState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "aim" || state.activeSeat !== seat) return null;
  const p = botParams(level);
  const cands = candidateShots(state, seat, p, rng);
  if (cands.length === 0) return null;
  let scored = cands.map((c) => ({ move: c, score: evaluateShot(state, seat, c) }));
  if (p.robust) {
    // judge the best few by how they turn out with my own shaky hand
    scored = [...scored].sort((a, b) => b.score - a.score).slice(0, 6);
    for (const t of scored) {
      let sum = t.score;
      for (let i = 0; i < 4; i++) sum += evaluateShot(state, seat, tremble(t.move, p, rng));
      t.score = sum / 5;
    }
  }
  const pick = pickByLevel(scored, level, rng);
  const shot = tremble(pick, p, rng);
  const q = quantizeShot(shot.vx, shot.vy);
  if (q.vx === 0 && q.vy === 0) return null;
  return { type: "flick", seat, stone: shot.stone, vx: q.vx, vy: q.vy };
}
