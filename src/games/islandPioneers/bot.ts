/**
 * 섬 개척자 AI (Lv.1~10). Every legal (harbour tile × spot × rotation) is
 * simulated with the real engine and the resulting position is valued:
 *
 *   my score + Σ(regions I lead: chance-to-close × complete value +
 *   (1 − chance) × unfinished value) + resources/sets + pioneers in supply,
 *   minus the same for my rivals.
 *
 * "Chance to close" looks at every empty cell the region still touches and
 * counts how many of the remaining tiles could ever fill it (a cell no tile
 * fits = the region is dead). Stronger bots use that exact count, weaker ones
 * a crude "fewer open edges = better" guess, and `pickByLevel` adds the usual
 * mistakes / tie noise. Pioneer spots are only tried on the best placements
 * to keep a turn under ~50 ms.
 */
import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  analyze,
  applyAction,
  COMPLETE_POINTS,
  currentActor,
  frontier,
  INCOMPLETE_POINTS,
  legalPlacements,
  majority,
  neighbor,
  SET_BONUS,
  settlerOptions,
  supplyOf,
  terrainAt,
  tilesLeft,
  type EngineAction,
  type IslandState,
  type Placed,
  type SeatIndex,
} from "./engine";
import { distinctRotations, quadTerrain } from "./tiles";

type Board = readonly (Placed | null)[];

/** How many of `pool` could fill `cell` in some rotation (cached by the cell's edge constraints). */
function makeFillCounter(pool: readonly number[]) {
  const cache = new Map<string, number>();
  return (board: Board, cell: number): number => {
    const need: number[] = [];
    for (let d = 0; d < 4; d++) {
      const n = neighbor(cell, d);
      need.push(n >= 0 && board[n] ? terrainAt(board, n, (d + 2) % 4) : -1);
    }
    const key = need.join(",");
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let count = 0;
    for (const t of pool) {
      if (distinctRotations(t).some((rot) => need.every((want, d) => want < 0 || quadTerrain(t, rot, d) === want))) count++;
    }
    cache.set(key, count);
    return count;
  };
}

interface Valuer {
  (state: IslandState, me: SeatIndex): number;
}

function makeValuer(level: BotLevel, pool: readonly number[]): Valuer {
  const fill = makeFillCounter(pool);
  const exact = level >= 5;
  return (state, me) => {
    const n = state.playerCount;
    const left = tilesLeft(state);
    const an = analyze(state.board, state.settlers);
    const potential = Array.from({ length: n }, () => 0);
    for (const r of an.regions) {
      if (r.settlers.length === 0) continue;
      let p: number;
      if (r.ocean) p = 0;
      else if (r.open === 0) p = 1;
      else if (exact) {
        p = Math.min(1, left / (r.openCells.length * 2.5));
        for (const c of r.openCells) {
          const f = fill(state.board, c);
          if (f === 0) {
            p = 0;
            break;
          }
          p *= Math.min(0.95, 0.45 + f / 18);
        }
      } else p = Math.pow(0.62, r.openCells.length) * Math.min(1, left / 8);
      const full = r.cells.length * COMPLETE_POINTS[r.terrain] + r.resources * 1.6;
      const part = r.cells.length * INCOMPLETE_POINTS;
      // growth: an open land region usually gets bigger before it closes
      const grow = r.ocean ? 0 : Math.min(r.openCells.length, 3) * 0.6 * p;
      const v = p * full + (1 - p) * part + grow;
      for (const o of majority(r.settlers)) potential[o] += v;
    }
    const value = (seat: SeatIndex) => {
      const res = state.resources[seat];
      const total = res.reduce((a, b) => a + b, 0);
      const kinds = res.filter((x) => x > 0).length;
      const resVal = total + Math.min(...res) * SET_BONUS + kinds * 0.7;
      const supply = state.phase === "gameOver" ? 0 : supplyOf(state, seat) * 2.2 * Math.min(1, left / (n * 4));
      return state.scores[seat] + (state.phase === "gameOver" ? 0 : potential[seat] + resVal) + supply;
    };
    const mine = value(me);
    let others = 0;
    let best = -Infinity;
    for (let s = 0; s < n; s++) {
      if (s === me) continue;
      const v = value(s);
      others += v;
      best = Math.max(best, v);
    }
    const avg = others / Math.max(1, n - 1);
    return mine - (level >= 8 ? 0.55 * avg + 0.45 * best : avg);
  };
}

export function chooseBotAction(state: IslandState, seat: SeatIndex, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (currentActor(state) !== seat) return null;
  const pool = [...state.bag, ...state.market];
  const value = makeValuer(level, pool);
  const fr = frontier(state.board);
  type Cand = { move: EngineAction; score: number };
  const plain: Cand[] = [];
  state.market.forEach((tile, pick) => {
    for (const p of legalPlacements(state.board, tile, fr)) {
      const move: EngineAction = { type: "place", seat, turn: state.turn, pick, cell: p.cell, rot: p.rot, settler: null };
      const next = applyAction(state, move);
      if (next === state) continue;
      plain.push({ move, score: value(next, seat) });
    }
  });
  if (plain.length === 0) return { type: "timeout", seat, turn: state.turn };
  const all: Cand[] = [...plain];
  if (supplyOf(state, seat) > 0) {
    const top = [...plain].sort((a, b) => b.score - a.score).slice(0, level >= 7 ? 16 : 10);
    for (const c of top) {
      const m = c.move as Extract<EngineAction, { type: "place" }>;
      const board = state.board.slice();
      board[m.cell] = { tile: state.market[m.pick], rot: m.rot, by: seat };
      for (const q of settlerOptions(board, state.settlers, m.cell)) {
        const move: EngineAction = { ...m, settler: q };
        const next = applyAction(state, move);
        if (next === state) continue;
        all.push({ move, score: value(next, seat) });
      }
    }
  }
  return pickByLevel(all, level, rng);
}
