import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  centerOf,
  CENTER,
  exposedOf,
  legalPlacements,
  passCost,
  previewBallast,
  previewPlace,
  remainingTurns,
  resolveSpill,
  WAVE,
  type CargoState,
  type EngineAction,
  type Outcome,
  type Placed,
  type Seat,
} from "./engine";

/**
 * 화물선 쌓기 AI (rulebook §14). Every option (each dock crate × column,
 * ballast left/right, pass) is scored by a 1-ply simulation with the
 * engine's own `previewPlace`/`previewBallast`:
 *
 *   value = my score change
 *         + aggression × what the others lose
 *         − risk × my exposed points on the low side (squashed by the margin left)
 *         − departure awareness × what the forecast wave would throw off now
 *
 * Lv.8+ also checks the next player's greedy reply against it (how much of
 * mine they'd knock off). Low levels look only at the crate's face value,
 * add noise, and sometimes just drop something anywhere legal.
 */

interface Params {
  noise: number;
  blunder: number;
  naive: boolean;
  risk: number;
  aggression: number;
  depart: number;
  reply: boolean;
}

export function paramsFor(level: BotLevel): Params {
  const l = Math.max(1, Math.min(10, level));
  return {
    noise: (10 - l) * 1.1,
    blunder: l <= 3 ? 0.42 - 0.12 * l : 0,
    naive: l <= 2,
    risk: 0.15 + 0.085 * l,
    aggression: l >= 5 ? 0.25 + 0.06 * (l - 5) : 0,
    depart: l <= 2 ? 0 : l / 10,
    reply: l >= 8,
  };
}

type Option = { action: EngineAction; o: Outcome; naivePts: number };

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-z));
}

/** My points sitting exposed on the side the ship leans to — what the next tilt would cost me. */
function exposure(deck: readonly Placed[], T: number, seat: Seat): number {
  if (Math.abs(T) < 0.5) return 0;
  const side = T > 0 ? 1 : -1;
  let sum = 0;
  for (const p of exposedOf(deck)) if (p.owner === seat && side * (centerOf(p) - CENTER) > 0) sum += p.pts;
  return sum;
}

function optionsFor(state: CargoState, seat: Seat): Option[] {
  const out: Option[] = [];
  for (const m of legalPlacements(state)) {
    const o = previewPlace(state, seat, m.slot, m.x);
    if (o.ok) out.push({ action: { type: "place", seat, slot: m.slot, x: m.x }, o, naivePts: o.placed?.pts ?? 0 });
  }
  for (const dir of [-1, 1] as const) {
    const o = previewBallast(state, seat, dir);
    if (o.ok) out.push({ action: { type: "ballast", seat, dir }, o, naivePts: 0 });
  }
  return out;
}

function evaluate(state: CargoState, seat: Seat, opt: Option, p: Params): number {
  const { o } = opt;
  if (p.naive) return opt.naivePts - (o.capsized ? 8 : 0);
  const n = state.playerCount;
  let v = o.deltas[seat];
  if (n > 1 && p.aggression > 0) {
    let others = 0;
    for (let s = 0; s < n; s++) if (s !== seat) others -= o.deltas[s];
    v += (p.aggression * others) / (n - 1);
  }
  if (o.capsized) return v - 30;
  const margin = o.lim - Math.abs(o.T);
  // turns left after this one (all seats)
  const left = remainingTurns(state) - 1;
  if (left > 0) v -= p.risk * exposure(o.deck, o.T, seat) * sigmoid((5 - margin) / 1.4);
  // §7 — what the forecast wave would throw off if we sailed now, weighted by how close the end is
  const wave = WAVE[state.forecasts[state.voyage] ?? "calm"];
  if (wave > 0 && p.depart > 0) {
    const res = resolveSpill(o.deck, o.ballast, wave, 4);
    let mine = 0;
    for (const s of res.spilled) if (s.owner === seat) mine += s.pts;
    const nearEnd = 1 / (1 + Math.max(0, left) / Math.max(1, n));
    v -= p.depart * mine * nearEnd;
  }
  // a little preference for a low, wide (forgiving) stack
  v += 0.04 * margin;
  return v;
}

/** The next player's greedy reply: how much of my score it would wipe off. */
function replyDamage(state: CargoState, seat: Seat, after: Outcome): number {
  const n = state.playerCount;
  if (n < 2) return 0;
  const nextSeat = (() => {
    for (let k = 1; k <= n; k++) {
      const s = (seat + k) % n;
      const left = state.turnsLeft[s] - (s === seat ? 1 : 0);
      if (left > 0) return s;
    }
    return null;
  })();
  if (nextSeat === null || nextSeat === seat) return 0;
  const sim: CargoState = { ...state, deck: after.deck, ballast: after.ballast, active: nextSeat };
  let worst = 0;
  let bestForThem = -Infinity;
  for (const m of legalPlacements(sim)) {
    const o = previewPlace(sim, nextSeat, m.slot, m.x);
    if (!o.ok) continue;
    const theirs = o.deltas[nextSeat] - (o.capsized ? 30 : 0);
    if (theirs > bestForThem) {
      bestForThem = theirs;
      worst = Math.max(0, -o.deltas[seat]);
    }
  }
  return worst;
}

export function chooseBotAction(state: CargoState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction {
  if (state.phase === "depart") return { type: "sail", seat };
  const p = paramsFor(level);
  const opts = optionsFor(state, seat);
  const places = opts.filter((o) => o.action.type === "place");
  if (places.length === 0) {
    // nothing fits: ballast if it helps, else pass
    const bal = opts.filter((o) => o.action.type === "ballast" && !o.o.capsized && o.o.spilled.length === 0);
    if (bal.length > 0 && !p.naive) return bal[0].action;
    return { type: "pass", seat };
  }
  if (p.blunder > 0 && rng() < p.blunder) return places[Math.floor(rng() * places.length)].action;
  const scored = opts.map((opt) => ({ opt, v: evaluate(state, seat, opt, p) + (rng() - 0.5) * 2 * p.noise }));
  if (p.reply) {
    scored.sort((a, b) => b.v - a.v);
    for (const s of scored.slice(0, 6)) s.v -= 0.8 * replyDamage(state, seat, s.opt.o);
  }
  scored.sort((a, b) => b.v - a.v);
  const best = scored[0];
  const passV = -passCost(state, seat);
  if (best.v < passV - 3 && !p.naive) return { type: "pass", seat };
  return best.opt.action;
}
