import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { REGIONS } from "./data";
import {
  applyAction,
  controlledCount,
  legalActions,
  otherFaction,
  raceSymbols,
  techProduction,
  unitsOf,
  type EngineAction,
  type Faction,
  type LotrDuelState,
} from "./engine";

/**
 * Heuristic bot for 반지의 제왕: 가운데땅에서의 대결. Every candidate action is
 * applied, the rest of the bot's own turn (pending choices) is resolved
 * greedily, and the resulting position is scored. Levels 6+ also subtract the
 * opponent's best immediate reply, which is what stops the bot from
 * uncovering a winning blue/green card for the other side.
 *
 * The three instant victories are all "distance to goal" races, so each is
 * scored as `k / distance` — the closer anyone gets, the louder it shouts.
 */

const WIN = 1_000_000;

function sideScore(state: LotrDuelState, f: Faction): number {
  const p = state.players[f];
  const races = raceSymbols(p).size;
  const regions = controlledCount(state, f);
  const { fixed, choices, wild } = techProduction(p);
  const techCount = Object.values(fixed).reduce((a, b) => a + b, 0) + choices.length + wild * 1.5;
  const units = REGIONS.reduce((n, r) => n + unitsOf(state.boardRegions[r], f), 0);
  const persistent = p.allianceTokens.filter((t) => !t.isOneShot).length;
  const chains = p.tableauCards.filter((c) => c.providesChain && c.chapter < 3).length;
  const chapterWeight = state.chapter === 3 ? 2.2 : state.chapter === 2 ? 1.4 : 1;
  return (
    36 / Math.max(1, 6 - races) +
    (32 / Math.max(1, 7 - regions)) +
    regions * 3 * chapterWeight +
    units * 0.9 +
    Math.min(p.coins, 12) * 0.55 +
    techCount * (state.chapter === 3 ? 0.6 : 1.6) +
    persistent * 2.5 +
    chains * (state.chapter === 1 ? 1.2 : 0.5)
  );
}

/** Position value from `me`'s point of view. */
export function evaluate(state: LotrDuelState, me: Faction): number {
  if (state.phase === "GAME_OVER") return state.winner === me ? WIN : -WIN;
  const { frodoPosition: fr, nazgulPosition: nz, trackLength: L } = state.ringTrack;
  const ringForFellowship = 60 / Math.max(1, L - fr) - 60 / Math.max(1, fr - nz);
  const ring = me === "FELLOWSHIP" ? ringForFellowship : -ringForFellowship;
  return ring + sideScore(state, me) - sideScore(state, otherFaction(me));
}

/** Finishes `f`'s pending choices greedily (one-step lookahead each). */
function settleOwnTurn(state: LotrDuelState, f: Faction): LotrDuelState {
  let s = state;
  for (let guard = 0; guard < 12 && s.phase === "PLAYING" && s.turn === f && s.pending.length > 0; guard++) {
    let best: LotrDuelState | null = null;
    let bestV = -Infinity;
    for (const a of legalActions(s)) {
      const n = applyAction(s, a);
      if (n === s) continue;
      const v = evaluate(n, f);
      if (v > bestV) {
        bestV = v;
        best = n;
      }
    }
    if (!best) break;
    s = best;
  }
  return s;
}

function afterAction(state: LotrDuelState, a: EngineAction, f: Faction): LotrDuelState | null {
  const n = applyAction(state, a);
  if (n === state) return null;
  return settleOwnTurn(n, f);
}

/** The opponent's best reply value (from `me`'s view: lowest). */
function worstReply(state: LotrDuelState, me: Faction): number {
  if (state.phase !== "PLAYING" || state.turn === me) return evaluate(state, me);
  const opp = state.turn;
  let worst = Infinity;
  for (const a of legalActions(state)) {
    if (a.type === "TAKE_CARD" && a.mode === "DISCARD") continue;
    const n = afterAction(state, a, opp);
    if (!n) continue;
    worst = Math.min(worst, evaluate(n, me));
    if (worst <= -WIN) break;
  }
  return worst === Infinity ? evaluate(state, me) : worst;
}

export function chooseBotAction(state: LotrDuelState, faction: Faction, level: BotLevel): EngineAction | null {
  if (state.phase !== "PLAYING" || state.turn !== faction) return null;
  const actions = legalActions(state);
  if (actions.length === 0) return null;
  const deep = level >= 6;
  const scored: { a: EngineAction; v: number }[] = [];
  for (const a of actions) {
    const n = afterAction(state, a, faction);
    if (!n) continue;
    let v = evaluate(n, faction);
    if (deep && v < WIN && state.pending.length === 0) v = Math.min(v, worstReply(n, faction));
    scored.push({ a, v });
  }
  if (scored.length === 0) return actions[0];
  scored.sort((x, y) => y.v - x.v);
  // Lower levels sometimes settle for a random pick among the top few.
  const sloppiness = (10 - level) * 0.07;
  if (Math.random() < sloppiness) {
    const pool = scored.slice(0, Math.min(scored.length, 2 + Math.floor((10 - level) / 3)));
    return pool[Math.floor(Math.random() * pool.length)].a;
  }
  return scored[0].a;
}
