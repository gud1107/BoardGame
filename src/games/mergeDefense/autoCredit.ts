import { unitDamage, unitInterval, type Action, type Board } from "./engine";

/**
 * "자동 덕분에 막은 몬스터" — an estimate, since the engine doesn't record
 * which tower landed each kill. We remember which pads hold a unit that
 * 🤖 자동 built (summon / gamble / merge result) and credit 자동 with each
 * new kill in proportion to those units' share of the board's damage per
 * tick. Client-only bookkeeping; never touches the simulation.
 */
export interface AutoCredit {
  /** Pads whose current unit 자동 made. */
  slots: Set<number>;
  /** Kills credited to 자동 so far (fractional). */
  kills: number;
  /** Board kill count at the last sample. */
  lastKills: number;
}

export function newAutoCredit(): AutoCredit {
  return { slots: new Set(), kills: 0, lastKills: 0 };
}

/** Updates which pads hold 자동-made units after `action` (sent by 자동 or by the player). */
export function trackAction(c: AutoCredit, a: Action, byAuto: boolean) {
  const mark = (slot: number) => (byAuto ? c.slots.add(slot) : c.slots.delete(slot));
  switch (a.type) {
    case "summon":
    case "gamble":
      if (a.slot !== undefined) mark(a.slot);
      break;
    case "merge":
      c.slots.delete(a.a);
      mark(a.b);
      break;
    case "move": {
      const fromAuto = c.slots.has(a.a);
      const toAuto = c.slots.has(a.b);
      c.slots.delete(a.a);
      c.slots.delete(a.b);
      if (fromAuto) c.slots.add(a.b);
      if (toAuto) c.slots.add(a.a);
      break;
    }
    case "send":
    case "sell":
      c.slots.delete(a.slot);
      break;
  }
}

/** Share (0..1) of the board's damage per tick that comes from 자동-made units. */
export function autoPowerShare(board: Board, slots: ReadonlySet<number>): number {
  let all = 0;
  let auto = 0;
  board.units.forEach((u, i) => {
    if (!u) return;
    const dpt = unitDamage(u, board) / unitInterval(u);
    all += dpt;
    if (slots.has(i)) auto += dpt;
  });
  return all > 0 ? auto / all : 0;
}

/** Credits the kills made since the last sample at the current power share. */
export function sampleCredit(c: AutoCredit, board: Board) {
  const fresh = board.kills - c.lastKills;
  if (fresh > 0) c.kills += fresh * autoPowerShare(board, c.slots);
  c.lastKills = board.kills;
}
