/**
 * 볼링 난장판 AI (rulebook §10). For a handful of release spots × spins ×
 * speeds the bot solves the aim that brings the ball to a target (the pocket
 * on a full rack, a standing pin on a spare), rolls each candidate through
 * the real physics and scores the pinfall. Higher levels try more lines,
 * judge the best few under their own hand tremor (Lv.7+), and shake less
 * when they finally let go. Items (§8): a bot slips its sabotage onto the
 * leader (weaker bots pick at random) and puts up a 🍀 bumper for itself.
 *
 * The bot may use Math.random and trig freely — only the resulting integer
 * release goes into the action, and every client re-simulates it.
 */

import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { canUseItem, currentSetup, ITEMS, quantizeRoll, releaseOf, totalOf, type BowlingState, type EngineAction, type ItemKind, type Seat } from "./engine";
import { ballPathX, HALF_W, HEAD_Y, MAX_SLOPE, simulate, type LaneSetup, type RollInput } from "./physics";

interface Params {
  spins: number[];
  speeds: number[];
  xs: number[];
  /** Offsets (m) tried around each target entry point. */
  offsets: number[];
  /** Hand tremor (1σ): release spot (m), sideways speed (m/s), speed (m/s), spin. */
  xSd: number;
  vxSd: number;
  speedSd: number;
  spinSd: number;
  robust: boolean;
  /** Picks the leader as the sabotage target (else random). */
  smartTarget: boolean;
}

const VX_SD = [0.095, 0.075, 0.058, 0.045, 0.034, 0.026, 0.019, 0.014, 0.01, 0.007];
const SPEED_SD = [0.7, 0.6, 0.5, 0.4, 0.32, 0.25, 0.19, 0.14, 0.1, 0.07];
const SPIN_SD = [0.25, 0.2, 0.16, 0.13, 0.1, 0.08, 0.06, 0.045, 0.03, 0.02];
const X_SD = [0.05, 0.04, 0.032, 0.026, 0.02, 0.016, 0.012, 0.009, 0.006, 0.004];

export function botParams(level: BotLevel): Params {
  const l = clampBotLevel(level);
  return {
    spins: l <= 2 ? [0] : l <= 4 ? [0, -0.5] : l <= 6 ? [-0.6, 0, 0.6] : [-0.75, -0.4, 0, 0.4, 0.75],
    speeds: l <= 3 ? [7.5] : l <= 6 ? [7, 8.5] : [7, 8.2, 9.3],
    xs: l <= 4 ? [0] : l <= 7 ? [-0.15, 0.15] : [-0.22, 0, 0.22],
    offsets: l <= 2 ? [0] : l <= 5 ? [-0.03, 0.03] : [-0.04, -0.015, 0.015, 0.04],
    xSd: X_SD[l - 1],
    vxSd: VX_SD[l - 1],
    speedSd: SPEED_SD[l - 1],
    spinSd: SPIN_SD[l - 1],
    robust: l >= 7,
    smartTarget: l >= 4,
  };
}

/** Entry points (x, y on the deck) worth rolling at for these standing pins. */
export function targetsFor(setup: LaneSetup, spin: number): { x: number; y: number }[] {
  const pins = setup.pins;
  if (pins.length === 0) return [{ x: 0, y: HEAD_Y }];
  if (pins.length === 10) {
    // the pocket: just beside the head pin, on the side the ball hooks in from
    const side = spin < -0.1 ? 1 : spin > 0.1 ? -1 : 1;
    const head = pins.find((p) => p.id === 0) ?? pins[0];
    return [{ x: head.x + side * 0.065, y: head.y }];
  }
  // spares: the front pin of what's left, each pin, and the middle of the cluster
  const out: { x: number; y: number }[] = [];
  const front = [...pins].sort((a, b) => a.y - b.y)[0];
  out.push({ x: front.x, y: front.y });
  const cx = pins.reduce((a, p) => a + p.x, 0) / pins.length;
  out.push({ x: cx, y: front.y });
  for (const p of pins.slice(0, 4)) if (p !== front) out.push({ x: p.x, y: p.y });
  return out;
}

/** Sideways release speed that brings the ball to `tx` at `ty` (bisection on the ball-only path). */
export function solveAim(setup: LaneSetup, x: number, vy: number, spin: number, tx: number, ty: number): number {
  let lo = -vy * MAX_SLOPE;
  let hi = vy * MAX_SLOPE;
  const at = (vx: number) => ballPathX(setup, { x, vx, vy, spin }, ty - 0.12).x;
  if (at(lo) > tx) return lo;
  if (at(hi) < tx) return hi;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < tx) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** How good a roll's pinfall is (more pins, clearing the rack is worth extra). */
export function evaluateRoll(setup: LaneSetup, input: RollInput): number {
  const q = quantizeRoll(input.x, input.vx, input.vy, input.spin);
  const res = simulate(setup, releaseOf(q));
  const n = res.down.length;
  let score = n;
  if (n === setup.pins.length) score += setup.pins.length === 10 ? 4 : 3;
  if (res.gutterStep !== null && n === 0) score -= 1;
  return score;
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The release a hand with this tremor actually lets go of when aiming at `c`. */
export function tremble(c: RollInput, p: Pick<Params, "xSd" | "vxSd" | "speedSd" | "spinSd">, rng: () => number): RollInput {
  const lim = HALF_W - 0.06;
  return {
    x: Math.max(-lim, Math.min(lim, c.x + gaussian(rng) * p.xSd)),
    vx: c.vx + gaussian(rng) * p.vxSd,
    vy: c.vy + gaussian(rng) * p.speedSd,
    spin: Math.max(-1, Math.min(1, c.spin + gaussian(rng) * p.spinSd)),
  };
}

export function candidateRolls(state: BowlingState, p: Params): RollInput[] {
  const setup = currentSetup(state);
  const lim = HALF_W - setup.ballR - 0.02;
  const out: RollInput[] = [];
  for (const spin of p.spins) {
    const targets = targetsFor(setup, spin);
    for (const vy of p.speeds) {
      for (const x0 of p.xs) {
        // hook bowlers start on the side they hook away from
        const x = Math.max(-lim, Math.min(lim, x0 + -spin * 0.18));
        for (const t of targets) {
          for (const off of p.offsets) {
            const vx = solveAim(setup, x, vy, spin, t.x + off, t.y);
            out.push({ x, vx, vy, spin });
          }
        }
      }
    }
  }
  return out;
}

function leaderAmong(state: BowlingState, seats: Seat[]): Seat {
  return [...seats].sort((a, b) => totalOf(state, b) - totalOf(state, a) || a - b)[0];
}

/** §8 — an item to use before the first ball of this frame, or null. */
export function chooseBotItem(state: BowlingState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (!state.options.items || state.ball !== 0 || state.itemUsed) return null;
  const held = state.items[seat] ?? [];
  if (held.length === 0) return null;
  const p = botParams(level);
  const last = state.frame === state.options.frames - 1;
  // always spend what's left in the last two frames
  const late = state.frame >= state.options.frames - 2;
  // the bumper: on a twist that can gutter, under sabotage, late, or now and then
  if (held.includes("bumper") && canUseItem(state, seat, "bumper", seat)) {
    const mod = state.laneMods[state.frame];
    if (last || late || mod === "wind" || mod === "ice" || state.active.length > 0 || rng() < 0.35) return { type: "item", seat, kind: "bumper", target: seat };
  }
  const sabotage = held.filter((k): k is ItemKind => !ITEMS[k].self);
  if (sabotage.length === 0) return null;
  // hold sabotage a little (weaker bots fire it off right away)
  if (!late && rng() < (p.smartTarget ? 0.45 : 0.15)) return null;
  const others = Array.from({ length: state.playerCount }, (_, s) => s).filter((s) => s !== seat);
  // a target still to bowl this frame gets hit this frame; others next frame
  const order = p.smartTarget ? [leaderAmong(state, others), ...others] : others.sort(() => rng() - 0.5);
  for (const target of order) {
    for (const kind of sabotage) if (canUseItem(state, seat, kind, target)) return { type: "item", seat, kind, target };
  }
  return null;
}

export function chooseBotRoll(state: BowlingState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "aim" || state.activeSeat !== seat) return null;
  const p = botParams(level);
  const setup = currentSetup(state);
  const cands = candidateRolls(state, p);
  if (cands.length === 0) return null;
  let scored = cands.map((c) => ({ move: c, score: evaluateRoll(setup, c) }));
  if (p.robust) {
    scored = [...scored].sort((a, b) => b.score - a.score).slice(0, 6);
    for (const t of scored) {
      let sum = t.score;
      for (let i = 0; i < 4; i++) sum += evaluateRoll(setup, tremble(t.move, p, rng));
      t.score = sum / 5;
    }
  }
  const pick = pickByLevel(scored, level, rng);
  const shot = tremble(pick, p, rng);
  const q = quantizeRoll(shot.x, shot.vx, shot.vy, shot.spin);
  return { type: "roll", seat, ...q };
}

export function chooseBotAction(state: BowlingState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "aim" || state.activeSeat !== seat) return null;
  return chooseBotItem(state, seat, level, rng) ?? chooseBotRoll(state, seat, level, rng);
}
