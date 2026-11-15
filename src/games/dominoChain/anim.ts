import { TICK_MS, type RoundResult, type ToppleEvent } from "./engine";

/**
 * Topple playback (rulebook §5, §11): the engine already decided every event
 * and its tick; the board just walks a clock through them. A piece takes
 * `FALL_TICKS` to lie down; a bell rings for a while; a bomb flashes.
 */

export const FALL_TICKS = 1.8;
/** Pause before the pushers go (s) — a drum roll. */
export const LEAD_IN_MS = 900;
/** Lingering after the last event before the round score shows. */
export const TAIL_MS = 1400;

export interface CellAnim {
  /** 0 standing … 1 flat (pieces). */
  fall: number;
  /** Owner colour to draw now (a steal flips when the hit lands). */
  owner: number;
  dir: number;
  /** Ticks since a bell rang / bomb went off (−1 = not yet). */
  since: number;
  kind: ToppleEvent["kind"] | null;
  owners: number[];
}

export function toppleLengthMs(result: RoundResult): number {
  return LEAD_IN_MS + (result.ticks + FALL_TICKS) * TICK_MS + TAIL_MS;
}

/** State of every animated cell `ms` after the topple started. */
export function toppleAt(result: RoundResult, ms: number): Map<number, CellAnim> {
  const tick = (ms - LEAD_IN_MS) / TICK_MS;
  const out = new Map<number, CellAnim>();
  for (const e of result.events) {
    if (tick < e.t) continue;
    const since = tick - e.t;
    if (e.kind === "fall") out.set(e.cell, { fall: Math.min(1, since / FALL_TICKS), owner: e.owner, dir: e.dir, since, kind: "fall", owners: e.owners });
    else out.set(e.cell, { fall: 0, owner: e.owner, dir: 0, since, kind: e.kind, owners: e.owners });
  }
  return out;
}

/** Running score per seat at `ms` (bells/bombs as they happen, the chain bonus at the very end). */
export function scoreAt(result: RoundResult, ms: number, cellsValue: (cell: number) => number, playerCount: number): number[] {
  const tick = (ms - LEAD_IN_MS) / TICK_MS;
  const pts = Array(playerCount).fill(0);
  for (const e of result.events) {
    if (tick < e.t) continue;
    if (e.kind === "ring") for (const o of e.owners) pts[o] += cellsValue(e.cell);
    if (e.kind === "boom") pts[e.owner] -= 2;
  }
  if (tick >= result.ticks + FALL_TICKS) for (const s of result.longest) pts[s] += result.longest.length === 1 ? 2 : 1;
  return pts;
}
