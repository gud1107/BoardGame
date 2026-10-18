/**
 * 컬링 파티 AI (rulebook §13). Two jobs:
 *
 * 1. `planBotThrow` — picks aim / weight / spin / party stone by brute force:
 *    simulate every candidate on the real physics (physics.ts) against the
 *    real stones, score the resulting board with `evaluate`, then pick by
 *    level (shared botDifficulty curve) and add level-scaled execution noise.
 *    Lv.6+ re-checks its favourites under its own noise so it prefers shots
 *    that still work when slightly missed.
 * 2. `botWantsSweep` — during a live throw, each 0.1 s frame: "if we swept
 *    from here vs. didn't, which board is better for my side?" Rivals only
 *    once the stone is past the tee line (§6). Lower levels react late and
 *    sometimes guess wrong.
 */

import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { distToButton, inFreeGuardZone, inHouse, runThrow, ThrowSim, TEE_Y, TICKS_PER_FRAME, weightForTravel, type PartyKind, type Stone, type ThrowParams } from "./physics";
import { currentSide, measure, resolveStones, type CurlingState } from "./engine";

export interface BotPlan {
  aim: number;
  weight: number;
  spin: 1 | -1;
  useCard: boolean;
}

/** A rival stone sits in front of `s` on its line in (a stone "behind cover" is hard to remove). */
function guarded(s: Stone, stones: readonly Stone[]): boolean {
  return stones.some((o) => o.id !== s.id && o.y > s.y + 0.4 && o.y < s.y + 7 && Math.abs(o.x - s.x) < 0.3);
}

/**
 * Board value for `side` after the current throw (higher = better).
 * `throwsAfter` = throws left in the end after this one.
 */
export function evaluate(state: CurlingState, stones: readonly Stone[], side: number, throwsAfter: number): number {
  const ffa = state.options.mode === "ffa";
  const rivalW = ffa ? 0.7 : 1;
  const m = measure(stones);
  let v = 0;
  if (m.scorer !== null) v = m.scorer === side ? m.points : -m.points * rivalW;
  if (throwsAfter <= 0) return v;
  v *= 0.7;
  const hammerSide = state.order[state.order.length - 1];
  for (const s of stones) {
    const own = s.side === side;
    if (inHouse(s)) {
      const near = Math.max(0, 1 - distToButton(s.x, s.y) / 1.9);
      const cover = guarded(s, stones) ? 0.25 : 0;
      v += own ? 0.1 + 0.2 * near + cover : -(0.1 + 0.2 * near + cover) * rivalW;
    } else if (inFreeGuardZone(s) && Math.abs(s.x) < 1.3 && s.y < 5.6) {
      const gv = s.side === hammerSide ? 0.16 : 0.06;
      v += own ? gv : -gv * 0.6 * rivalW;
    }
  }
  return v;
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  // Box–Muller via Math (bots run on one client and send the result — no lockstep concern)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Execution noise (aim m, weight units) for a level. */
export function botNoise(level: BotLevel): { aim: number; weight: number } {
  const l = clampBotLevel(level);
  return { aim: 0.16 - 0.014 * l, weight: 0.028 - 0.0024 * l };
}

function throwsAfterNow(state: CurlingState): number {
  return state.order.length - state.throwIndex - 1;
}

function scoreParams(state: CurlingState, side: number, params: ThrowParams): number {
  const before = state.stones;
  const sim = runThrow(before, params, side, state.nextStoneId);
  const { stones } = resolveStones(state, side, before, sim);
  return evaluate(state, stones, side, throwsAfterNow(state));
}

interface Cand {
  aim: number;
  weight: number;
  spin: 1 | -1;
  kind: PartyKind | null;
  score: number;
}

function grid(level: BotLevel): { aims: number[]; weights: number[] } {
  const l = clampBotLevel(level);
  const aimStep = l <= 3 ? 0.16 : l <= 6 ? 0.1 : 0.07;
  const drawStep = l <= 3 ? 1 : l <= 6 ? 0.6 : 0.4;
  const aims: number[] = [];
  for (let a = -2; a <= 2.0001; a += aimStep) aims.push(Math.round(a * 1000) / 1000);
  const weights: number[] = [];
  for (let t = 23.4; t <= 30.6; t += drawStep) weights.push(weightForTravel(t));
  for (const t of [32.5, 35.5, 39.5]) weights.push(weightForTravel(t));
  return { aims, weights };
}

/** Synchronous plan (tests, sims). `intent` = the shot it means to play, without execution noise. */
export function planBotThrow(state: CurlingState, level: BotLevel, rng: () => number = Math.random, intent = false): BotPlan {
  const it = planSteps(state, level, rng, intent);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Same plan, yielding to the browser every few hundred simulations so the sheet keeps animating. */
export async function planBotThrowAsync(state: CurlingState, level: BotLevel, rng: () => number = Math.random, intent = false): Promise<BotPlan> {
  const it = planSteps(state, level, rng, intent);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const BATCH = 160;

function* planSteps(state: CurlingState, level: BotLevel, rng: () => number, intent = false): Generator<void, BotPlan> {
  const l = clampBotLevel(level);
  const side = currentSide(state);
  const card = state.options.party ? state.cards[side] : null;
  const lastOwnStone = state.order.lastIndexOf(side) === state.throwIndex;
  const { aims, weights } = grid(l);
  const cands: Cand[] = [];
  for (const spin of [1, -1] as const)
    for (const aim of aims)
      for (const weight of weights) {
        cands.push({ aim, weight, spin, kind: null, score: scoreParams(state, side, { aim, weight, spin, kind: null }) });
        if (cands.length % BATCH === 0) yield;
      }

  // party stone (§7): Lv.4+ weigh it properly, novices just fling it sometimes
  if (card) {
    if (l >= 4) {
      const coarse = cands.filter((_, i) => i % 2 === 0);
      for (const [i, c] of coarse.entries()) {
        cands.push({ ...c, kind: card, score: scoreParams(state, side, { aim: c.aim, weight: c.weight, spin: c.spin, kind: card }) });
        if (i % BATCH === BATCH - 1) yield;
      }
    } else if (rng() < 0.3 || lastOwnStone) {
      for (const c of cands) c.kind = card;
    }
  }

  const bestPlain = Math.max(...cands.filter((c) => c.kind === null).map((c) => c.score), -Infinity);
  const bestCard = Math.max(...cands.filter((c) => c.kind !== null).map((c) => c.score), -Infinity);
  // a card is worth spending only for a clear gain — unless it's now or never
  const cardEdge = lastOwnStone ? 0 : 0.35;
  const pool = l >= 4 && card ? cands.filter((c) => (bestCard > bestPlain + cardEdge ? c.kind !== null : c.kind === null)) : cands;

  // keep the sensible quarter so even Lv.1's "random" picks are curling shots
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  let shortlist = sorted.slice(0, Math.max(4, Math.ceil(sorted.length / 4)));

  // robustness (Lv.6+): favour shots that still work when slightly missed
  if (l >= 6) {
    const noise = botNoise(l);
    yield;
    const top = sorted.slice(0, l >= 9 ? 14 : 8).map((c) => {
      let sum = c.score;
      const samples = l >= 9 ? 4 : 3;
      for (let k = 0; k < samples; k++) {
        const aim = c.aim + gaussian(rng) * noise.aim;
        const weight = Math.max(0, Math.min(1, c.weight + gaussian(rng) * noise.weight));
        sum += scoreParams(state, side, { aim, weight, spin: c.spin, kind: c.kind });
      }
      return { ...c, score: sum / (samples + 1) };
    });
    shortlist = top;
  }

  const pick = pickByLevel(
    shortlist.map((c) => ({ move: c, score: c.score })),
    l,
    rng,
  );
  // a skip call (§17) shows the intended shot — judgment varies by level, the hand doesn't shake
  if (intent) return { aim: pick.aim, weight: pick.weight, spin: pick.spin, useCard: pick.kind !== null };
  const noise = botNoise(l);
  return {
    aim: Math.max(-2.2, Math.min(2.2, pick.aim + gaussian(rng) * noise.aim)),
    weight: Math.max(0, Math.min(1, pick.weight + gaussian(rng) * noise.weight)),
    spin: pick.spin,
    useCard: pick.kind !== null,
  };
}

/**
 * Should a bot on `botSide` sweep the delivered stone this frame? `others`
 * = the sweep (0..1) everyone else is putting in on each role right now.
 */
export function botWantsSweep(state: CurlingState, sim: ThrowSim, botSide: number, level: BotLevel, rng: () => number = Math.random, others: { own: number; opp: number } = { own: 0, opp: 0 }): boolean {
  if (sim.done) return false;
  const throwerSide = currentSide(state);
  const ownRole = botSide === throwerSide;
  const d = sim.deliveredStone();
  if (d.out !== null) return false;
  if (!ownRole && d.y >= TEE_Y) return false;
  const l = clampBotLevel(level);
  const finish = (sweep: number) => {
    const c = sim.clone();
    while (!c.done) c.step(ownRole ? sweep : others.own, ownRole ? others.opp : sweep);
    const { stones } = resolveStones(state, throwerSide, state.stones, c);
    return evaluate(state, stones, botSide, state.order.length - state.throwIndex - 1);
  };
  const yes = finish(1);
  const no = finish(ownRole ? others.own : others.opp);
  const want = yes > no + 0.05;
  // novices misjudge now and then
  return rng() < 0.18 - 0.017 * l ? !want : want;
}

/** How often (frames) a bot of this level re-thinks its sweep — novices react late. */
export function botSweepEvery(level: BotLevel): number {
  const l = clampBotLevel(level);
  return l >= 8 ? 1 : l >= 5 ? 2 : l >= 3 ? 3 : 4;
}

/**
 * Offline version of a whole bot-driven throw (tests and the balance sim):
 * steps the sim frame by frame, letting the given bot levels sweep for each
 * role, and returns the recorded sweep arrays for the `throw` action.
 */
export function recordBotSweeps(
  state: CurlingState,
  params: ThrowParams,
  sweepers: { own: BotLevel | null; opp: BotLevel | null; oppSide?: number },
  rng: () => number = Math.random,
): { own: number[]; opp: number[] } {
  const side = currentSide(state);
  const sim = new ThrowSim(state.stones, params, side, state.nextStoneId);
  const own: number[] = [];
  const opp: number[] = [];
  let o = 0;
  let p = 0;
  const oppSide = sweepers.oppSide ?? (state.options.mode === "team" ? 1 - side : (side + 1) % state.sides);
  while (!sim.done) {
    const f = sim.frame;
    if (sim.tick % TICKS_PER_FRAME === 0) {
      if (sweepers.own !== null && f % botSweepEvery(sweepers.own) === 0) o = botWantsSweep(state, sim, side, sweepers.own, rng, { own: 0, opp: p }) ? 10 : 0;
      if (sweepers.opp !== null && f % botSweepEvery(sweepers.opp) === 0) p = botWantsSweep(state, sim, oppSide, sweepers.opp, rng, { own: o / 10, opp: 0 }) ? 10 : 0;
      own[f] = o;
      opp[f] = p;
    }
    sim.step(o / 10, p / 10);
  }
  while (own.length && own[own.length - 1] === 0) own.pop();
  while (opp.length && opp[opp.length - 1] === 0) opp.pop();
  return { own: Array.from(own, (x) => x ?? 0), opp: Array.from(opp, (x) => x ?? 0) };
}
