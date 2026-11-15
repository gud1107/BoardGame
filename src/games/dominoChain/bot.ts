/**
 * 도미노 연쇄 AI (rulebook §9). Every legal placement (open end × facing ×
 * domino/split, plus walls in front of rivals' chains) is tried on a copy
 * of the board and judged by
 *   (my points − best rival's points if everything fell now) × 10
 *   + reach: unclaimed bells my open ends could still get to first
 *   − the same reach for rivals (blocking them is worth something).
 * Higher levels count more of the board (bomb/steal awareness, rival
 * reach) and pick with less noise.
 */

import { clampBotLevel, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  allowedDirs,
  applyAction,
  canWall,
  DIRS,
  frontier,
  isEmpty,
  previewTopple,
  stepCell,
  ticksFor,
  type DominoState,
  type EngineAction,
  type Seat,
} from "./engine";

interface Params {
  /** Weight of rivals' reach (blocking / racing awareness). */
  rival: number;
  /** Look at walls at all. */
  walls: boolean;
  /** Use the split piece smartly (else only randomly). */
  splits: boolean;
  /** Score noise (points). */
  noise: number;
}

export function botParams(level: BotLevel): Params {
  const l = clampBotLevel(level);
  return {
    rival: l <= 2 ? 0 : l <= 5 ? 0.5 : 1,
    walls: l >= 4,
    splits: l >= 3,
    noise: [9, 7, 5, 3.5, 2.5, 1.8, 1.2, 0.7, 0.35, 0.1][l - 1],
  };
}

/**
 * Shortest "chain time" (in ticks) from a seat's open ends to every cell,
 * walking only through empty cells — how soon that seat could plausibly
 * reach each bell with more dominoes.
 */
export function reachTicks(state: DominoState, seat: Seat): Int32Array {
  const INF = 1 << 29;
  const dist = new Int32Array(state.cells.length).fill(INF);
  const open = frontier(state, seat);
  // simple Dijkstra on a small grid (≤ 169 cells): repeated min scan
  const done = new Uint8Array(state.cells.length);
  for (const [cell] of open) dist[cell] = 0;
  for (;;) {
    let u = -1;
    let best = INF;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < best) {
      best = dist[i];
      u = i;
    }
    if (u < 0) break;
    done[u] = 1;
    if (!isEmpty(state.cells[u]) && !open.has(u)) continue;
    for (let d = 0; d < 8; d++) {
      const v = stepCell(state.size, u, d);
      if (v < 0 || done[v]) continue;
      const cell = state.cells[v];
      const passable = isEmpty(cell) || cell.feature?.kind === "bell";
      if (!passable) continue;
      const nd = best + ticksFor(d);
      if (nd < dist[v]) dist[v] = nd;
    }
  }
  return dist;
}

function bellReach(state: DominoState, seat: Seat, rung: Set<number>): number {
  const dist = reachTicks(state, seat);
  let v = 0;
  state.cells.forEach((c, i) => {
    if (c.feature?.kind !== "bell" || rung.has(i)) return;
    const d = dist[i];
    if (d >= 1 << 28) return;
    v += c.feature.value / (1 + d / 4);
  });
  return v;
}

export function evaluate(state: DominoState, seat: Seat, p: Params): number {
  const res = previewTopple(state);
  const mine = res.points[seat];
  let rival = -1e9;
  for (let s = 0; s < state.playerCount; s++) if (s !== seat) rival = Math.max(rival, res.points[s]);
  const rung = new Set(res.events.filter((e) => e.kind === "ring").map((e) => e.cell));
  const myReach = bellReach(state, seat, rung);
  let rivalReach = 0;
  if (p.rival > 0) for (let s = 0; s < state.playerCount; s++) if (s !== seat) rivalReach = Math.max(rivalReach, bellReach(state, s, rung));
  // keeping open ends alive matters until the last turn
  const ends = frontier(state, seat).size;
  return (mine - rival) * 10 + myReach * 4 - rivalReach * 4 * p.rival + Math.min(ends, 3) * 1.5;
}

interface Move {
  cell: number;
  kind: "domino" | "split" | "wall";
  dir: number;
}

export function candidateMoves(state: DominoState, seat: Seat, p: Params): Move[] {
  const out: Move[] = [];
  const open = frontier(state, seat);
  for (const [cell] of open) {
    for (const dir of allowedDirs(state, seat, cell)) {
      out.push({ cell, kind: "domino", dir });
      if (state.splitsLeft[seat] > 0 && p.splits) out.push({ cell, kind: "split", dir });
    }
  }
  if (p.walls && state.wallsLeft[seat] > 0) {
    // walls right in front of rivals' open ends (and the cells after them)
    const seen = new Set<number>();
    for (let s = 0; s < state.playerCount; s++) {
      if (s === seat) continue;
      for (const [cell, arr] of frontier(state, s)) {
        for (const c of [cell, ...arr.map((d) => stepCell(state.size, cell, d))]) {
          if (c >= 0 && !seen.has(c) && canWall(state, c) && !open.has(c)) {
            seen.add(c);
            out.push({ cell: c, kind: "wall", dir: 0 });
          }
        }
      }
    }
  }
  return out;
}

export function chooseBotAction(state: DominoState, seat: Seat, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "build" || state.activeSeat !== seat) return null;
  const p = botParams(level);
  let moves = candidateMoves(state, seat, p);
  if (moves.length === 0) {
    // a weak bot that skipped walls still uses one rather than passing with nothing to do
    if (state.wallsLeft[seat] > 0) {
      const free = state.cells.map((_, i) => i).filter((i) => canWall(state, i));
      if (free.length) moves = [{ cell: free[Math.floor(rng() * free.length)], kind: "wall", dir: 0 }];
    }
    if (moves.length === 0) return { type: "pass", seat };
  }
  // a stray split is fine for weak bots too, just not chosen on purpose
  if (!p.splits && state.splitsLeft[seat] > 0 && rng() < 0.15) {
    const m = moves.find((x) => x.kind === "domino");
    if (m) moves.push({ ...m, kind: "split" });
  }
  const base = evaluate(state, seat, p);
  const scored = moves.map((m) => {
    const next = applyAction(state, { type: "place", seat, cell: m.cell, kind: m.kind, dir: m.dir });
    let score = evaluate({ ...next, phase: "build" }, seat, p) - base;
    // the split is a one-off: only worth it when it clearly beats a plain domino
    if (m.kind === "split") score -= 2;
    if (m.kind === "wall") score -= 1.5;
    score += (rng() - 0.5) * 2 * p.noise;
    return { move: m, score };
  });
  const pick = pickByLevel(scored, level, rng);
  return { type: "place", seat, cell: pick.cell, kind: pick.kind, dir: pick.dir };
}

export const _internals = { DIRS };
