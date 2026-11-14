import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  blockedSet,
  CARRY_MAX,
  distances,
  EXIT,
  legalTargets,
  MONSTER_SPEED,
  monsterWalk,
  NOISE,
  pickTarget,
  RAGE_SPEED,
  rageFrom,
  WAKE_ROUND,
  type Cell,
  type Move,
  type NightState,
  type NoiseEvent,
  type Seat,
} from "./engine";

/**
 * 숨죽인 밤 AI (rulebook §9). Every legal move is scored by a one-round
 * simulation with the engine's own `pickTarget`:
 *
 *   value = key / bank gain + progress toward the goal (nearest key, or the
 *           door when carrying) − danger (the monster's predicted sweep)
 *
 * Danger assumes the rivals each make a walk-sized noise where they stand
 * (Lv.6+) or nothing (below). Lv.8+ throws pebbles to drag the monster onto
 * a rival who is carrying keys. The final pick goes through the shared
 * `pickByLevel` curve, so low levels blunder.
 */

function monsterSweep(s: NightState, noises: NoiseEvent[]): Set<Cell> {
  const bs = blockedSet(s);
  const target = pickTarget(s.monster, noises, bs);
  const goal = target ? target.at : s.lastHeard;
  const speed = s.round < WAKE_ROUND ? 0 : s.round >= rageFrom(s.options.rounds) ? RAGE_SPEED : MONSTER_SPEED;
  const path = speed > 0 && goal !== null && goal !== s.monster ? monsterWalk(s, goal, speed) : [];
  return new Set([s.monster, ...path]);
}

export function candidateMoves(s: NightState, seat: Seat): Move[] {
  const out: Move[] = [{ kind: "hush" }];
  for (const to of legalTargets(s, seat, "walk")) out.push({ kind: "walk", to });
  for (const to of legalTargets(s, seat, "run")) out.push({ kind: "run", to });
  for (const to of legalTargets(s, seat, "throw")) out.push({ kind: "throw", to });
  return out;
}

export function chooseBotMove(s: NightState, seat: Seat, level: BotLevel, rng: () => number = Math.random): Move {
  const l = clampBotLevel(level);
  const me = s.seats[seat];
  const bs = blockedSet(s);
  const keyDist = (c: Cell) => {
    const d = distances(c, bs);
    return s.keys.length ? Math.min(...s.keys.map((k) => d[k])) : 99;
  };
  const toExit = distances(EXIT, bs);
  const roundsLeft = s.options.rounds - s.round;
  // head home when full, when the night is ending, or with 2 keys and the door near
  const goHome = me.carry > 0 && (me.carry >= CARRY_MAX || toExit[me.at] >= roundsLeft || (me.carry >= 2 && toExit[me.at] <= 4) || s.keys.length === 0);
  const progress = (c: Cell) => (goHome ? toExit[c] : keyDist(c));
  const rivals: NoiseEvent[] = l >= 6 ? s.seats.flatMap((x, i) => (i === seat ? [] : [{ at: x.at, level: NOISE.walk, seat: i, why: "walk" as const }])) : [];
  const caution = l <= 3 ? 0.4 : l <= 6 ? 0.8 : 1.1;

  const scored = candidateMoves(s, seat).map((m) => {
    const at = m.kind === "walk" || m.kind === "run" ? m.to : me.at;
    const noises: NoiseEvent[] = [...rivals];
    if (m.kind === "walk" || m.kind === "run") noises.push({ at, level: NOISE[m.kind], seat, why: m.kind });
    if (m.kind === "throw") noises.push({ at: m.to, level: NOISE.throw, seat, why: "throw" });
    let value = 0;
    let carry = me.carry;
    if (s.keys.includes(at) && carry < CARRY_MAX) {
      value += 6;
      carry += 1;
      noises.push({ at, level: NOISE.key, seat, why: "key" });
    }
    if (at === EXIT && carry > 0) value += 10 * carry;
    value += (progress(me.at) - progress(at)) * 1.6;
    const sweep = monsterSweep(s, noises);
    if (sweep.has(at)) value -= caution * (carry * 9 + 6);
    else {
      const near = Math.min(...[...sweep].map((c) => distances(c, bs)[at]));
      if (near <= 1) value -= caution * (carry * 2 + 1.5);
    }
    if (m.kind === "throw") {
      value -= 1.5;
      if (l >= 8) {
        const hitsRival = s.seats.some((x, i) => i !== seat && x.carry > 0 && sweep.has(x.at));
        if (hitsRival) value += 4;
      }
    }
    if (m.kind === "run") value -= l >= 4 ? 0.4 : 0;
    return { move: m, score: value };
  });
  return pickByLevel(scored, l, rng);
}
