/**
 * Cross-device shared betting ledger for an online-room game, shared by
 * every game that opts in (currently: dalmuti, lasVegas, grid-poker,
 * malDalliJa, no-thanks, destinyWar39 — the same six games `botTakeover.ts`
 * covers; see HANDOFF.md for the session that added this).
 *
 * Same lockstep philosophy as `botTakeover.ts`: there is no server and no
 * single arbiter. Every connected client independently replays the exact
 * same sequence of `RoomBettingEvent`s (broadcast over the game's existing
 * Supabase Realtime channel) through `reduceRoomBetting` and arrives at the
 * same `RoomBettingState`. The host is the one expected to *drive* the UI
 * (toggle betting on, set the payout table, merge/unmerge participants) —
 * everyone else's client just replays the same events and shows a read-only
 * view — but nothing here enforces that; it's a UI-level convention, the same
 * trust model this whole app already uses everywhere else.
 *
 * `seatKey` is a plain string, same convention as `botTakeover.ts`: numeric
 * `SeatIndex` (stringified) for five games, malDalliJa's `"p1"`/`"p2"`
 * unchanged.
 *
 * Identity note: unlike the local device-bound betting tool (keyed by a
 * `PlayerRecord.id` that lives in one browser's IndexedDB), an online room
 * has no cross-device player identity to key off of — each participant is on
 * their own device with their own local storage. `seatKey` is what's
 * actually stable across a room's lifetime (reconnects restore the same
 * seat), so it's the identity anchor here instead. `namesAtRound` snapshots
 * whatever nickname was showing for that seat at the moment a round settled,
 * so a nickname change mid-room-lifetime is preserved instead of silently
 * overwritten — the same reason `PlayerRecord.aliases` exists for the local
 * tool. Known limitation: if a seat is vacated and a *different* real person
 * takes it over in a later rematch, this ledger doesn't detect that seam —
 * both people's rounds land in the same seat row (organizer can still
 * manually adjust via `manual-adjustment`, but there's no automatic split).
 */

import { computeRoundDeltas, mergeDeltasIntoTotals } from "@/lib/betting/ledger";
import { type MergedGroup, mergeParticipants, unmergeParticipants } from "@/lib/betting/mergeGroups";

export interface RoomBettingRound {
  round: number;
  deltas: Readonly<Record<string, number>>;
  namesAtRound: Readonly<Record<string, string>>;
  rankedSeats: readonly string[];
  playedAt: string;
}

export interface RoomManualAdjustment {
  seatKey: string;
  amount: number;
  note?: string;
  at: string;
}

export interface RoomBettingState {
  readonly active: boolean;
  readonly payoutTable: readonly number[];
  readonly rounds: readonly RoomBettingRound[];
  readonly manualAdjustments: readonly RoomManualAdjustment[];
  readonly mergedGroups: readonly MergedGroup[];
}

export const INITIAL_ROOM_BETTING_STATE: RoomBettingState = {
  active: false,
  payoutTable: [],
  rounds: [],
  manualAdjustments: [],
  mergedGroups: [],
};

export type RoomBettingEvent =
  | { type: "session-start"; payoutTable: number[] }
  | { type: "payout-set"; payoutTable: number[] }
  | {
      type: "round-recorded";
      round: number;
      deltas: Record<string, number>;
      namesAtRound: Record<string, string>;
      rankedSeats: string[];
      playedAt: string;
    }
  | { type: "manual-adjustment"; seatKey: string; amount: number; note?: string; at: string }
  | { type: "merge"; canonicalSeat: string; memberSeats: string[] }
  | { type: "unmerge"; canonicalSeat: string }
  | { type: "session-end" };

/**
 * Pure state transition — call once per received/sent `RoomBettingEvent`,
 * same shape as `reduceBotTakeover`. Idempotent against duplicate
 * broadcasts: a `round-recorded` for a round number already on record is a
 * no-op (guards against a re-render or a race re-sending the same round).
 */
export function reduceRoomBetting(state: RoomBettingState, event: RoomBettingEvent): RoomBettingState {
  switch (event.type) {
    case "session-start":
      return { ...INITIAL_ROOM_BETTING_STATE, active: true, payoutTable: event.payoutTable };
    case "payout-set":
      return { ...state, payoutTable: event.payoutTable };
    case "round-recorded": {
      if (state.rounds.some((r) => r.round === event.round)) return state;
      return {
        ...state,
        rounds: [
          ...state.rounds,
          {
            round: event.round,
            deltas: event.deltas,
            namesAtRound: event.namesAtRound,
            rankedSeats: event.rankedSeats,
            playedAt: event.playedAt,
          },
        ],
      };
    }
    case "manual-adjustment":
      return {
        ...state,
        manualAdjustments: [
          ...state.manualAdjustments,
          { seatKey: event.seatKey, amount: event.amount, note: event.note, at: event.at },
        ],
      };
    case "merge":
      return { ...state, mergedGroups: mergeParticipants([...state.mergedGroups], event.canonicalSeat, event.memberSeats) };
    case "unmerge":
      return { ...state, mergedGroups: unmergeParticipants([...state.mergedGroups], event.canonicalSeat) };
    case "session-end":
      return { ...state, active: false };
    default:
      return state;
  }
}

/**
 * Cumulative totals per raw seat key, folding every recorded round and
 * manual adjustment — always recomputed from the raw event log rather than
 * cached, so it's guaranteed consistent with `state.rounds` by construction
 * (and stays zero-sum per round, per `ledger.ts`'s own guarantee; manual
 * adjustments are the one intentional exception, same as the local tool).
 */
export function computeRoomBettingTotals(state: RoomBettingState): Record<string, number> {
  let totals: Record<string, number> = {};
  for (const round of state.rounds) totals = mergeDeltasIntoTotals(totals, round.deltas);
  for (const adj of state.manualAdjustments) {
    totals[adj.seatKey] = (totals[adj.seatKey] ?? 0) + adj.amount;
  }
  return totals;
}

/** Latest known display name per seat, from the most recent round it appeared in. */
export function computeLatestNames(state: RoomBettingState): Record<string, string> {
  const names: Record<string, string> = {};
  for (const round of state.rounds) Object.assign(names, round.namesAtRound);
  return names;
}

export { computeRoundDeltas };
