import { describe, expect, it } from "vitest";
import {
  computeLatestNames,
  computeRoomBettingTotals,
  INITIAL_ROOM_BETTING_STATE,
  reduceRoomBetting,
  type RoomBettingEvent,
  type RoomBettingState,
} from "./roomBetting";

function run(state: RoomBettingState, events: RoomBettingEvent[]): RoomBettingState {
  let s = state;
  for (const e of events) s = reduceRoomBetting(s, e);
  return s;
}

describe("reduceRoomBetting", () => {
  it("session-start resets to a fresh active session with the given payout table", () => {
    const s = reduceRoomBetting(INITIAL_ROOM_BETTING_STATE, {
      type: "session-start",
      payoutTable: [1000, -1000],
    });
    expect(s.active).toBe(true);
    expect(s.payoutTable).toEqual([1000, -1000]);
    expect(s.rounds).toEqual([]);
  });

  it("round-recorded appends a round and is idempotent for a duplicate round number", () => {
    let s = run(INITIAL_ROOM_BETTING_STATE, [
      { type: "session-start", payoutTable: [1000, -1000] },
      {
        type: "round-recorded",
        round: 1,
        deltas: { "0": 1000, "1": -1000 },
        namesAtRound: { "0": "기택", "1": "건열" },
        rankedSeats: ["0", "1"],
        playedAt: "2026-08-29T00:00:00.000Z",
      },
    ]);
    expect(s.rounds).toHaveLength(1);
    // Duplicate broadcast of the same round number (e.g. a race) must not double-count.
    s = reduceRoomBetting(s, {
      type: "round-recorded",
      round: 1,
      deltas: { "0": 9999, "1": -9999 },
      namesAtRound: { "0": "기택", "1": "건열" },
      rankedSeats: ["0", "1"],
      playedAt: "2026-08-29T00:01:00.000Z",
    });
    expect(s.rounds).toHaveLength(1);
    expect(computeRoomBettingTotals(s)).toEqual({ "0": 1000, "1": -1000 });
  });

  it("preserves every round of a seat renamed 3 times across rounds (no nickname-key collision)", () => {
    const s = run(INITIAL_ROOM_BETTING_STATE, [
      { type: "session-start", payoutTable: [1000, -1000] },
      {
        type: "round-recorded",
        round: 1,
        deltas: { "0": 1000, "1": -1000 },
        namesAtRound: { "0": "기택", "1": "건열" },
        rankedSeats: ["0", "1"],
        playedAt: "t1",
      },
      {
        type: "round-recorded",
        round: 2,
        deltas: { "0": -1000, "1": 1000 },
        namesAtRound: { "0": "기탁", "1": "건열" },
        rankedSeats: ["1", "0"],
        playedAt: "t2",
      },
      {
        type: "round-recorded",
        round: 3,
        deltas: { "0": 1000, "1": -1000 },
        namesAtRound: { "0": "기태기", "1": "건열" },
        rankedSeats: ["0", "1"],
        playedAt: "t3",
      },
    ]);
    expect(s.rounds).toHaveLength(3);
    expect(computeRoomBettingTotals(s)).toEqual({ "0": 1000, "1": -1000 });
    expect(computeLatestNames(s)["0"]).toBe("기태기"); // last-seen nickname
  });

  it("manual-adjustment layers an out-of-band delta onto the seat's total", () => {
    const s = run(INITIAL_ROOM_BETTING_STATE, [
      { type: "session-start", payoutTable: [1000, -1000] },
      {
        type: "round-recorded",
        round: 1,
        deltas: { "0": 1000, "1": -1000 },
        namesAtRound: { "0": "A", "1": "B" },
        rankedSeats: ["0", "1"],
        playedAt: "t1",
      },
      { type: "manual-adjustment", seatKey: "1", amount: 500, note: "현금 정산 오차 보정", at: "t2" },
    ]);
    expect(computeRoomBettingTotals(s)).toEqual({ "0": 1000, "1": -500 });
  });

  it("merge folds two seats' totals into one row's math (via computeRoomBettingTotals + mergedGroups)", () => {
    const s = run(INITIAL_ROOM_BETTING_STATE, [
      { type: "session-start", payoutTable: [1000, -1000] },
      {
        type: "round-recorded",
        round: 1,
        deltas: { "0": 1000, "1": -1000 },
        namesAtRound: { "0": "A", "1": "B" },
        rankedSeats: ["0", "1"],
        playedAt: "t1",
      },
      { type: "merge", canonicalSeat: "0", memberSeats: ["1"] },
    ]);
    expect(s.mergedGroups).toEqual([{ canonicalId: "0", memberIds: expect.arrayContaining(["0", "1"]) }]);
    const totals = computeRoomBettingTotals(s);
    const mergedTotal = s.mergedGroups[0].memberIds.reduce((sum, id) => sum + (totals[id] ?? 0), 0);
    expect(mergedTotal).toBe(0); // zero-sum round folded into one row still nets to 0

    const unmerged = reduceRoomBetting(s, { type: "unmerge", canonicalSeat: "0" });
    expect(unmerged.mergedGroups).toEqual([]);
    // Unmerge is lossless — the raw per-seat totals are unchanged, only the grouping is gone.
    expect(computeRoomBettingTotals(unmerged)).toEqual(totals);
  });

  it("session-end flips active off without touching recorded history", () => {
    const s = run(INITIAL_ROOM_BETTING_STATE, [
      { type: "session-start", payoutTable: [1000, -1000] },
      {
        type: "round-recorded",
        round: 1,
        deltas: { "0": 1000, "1": -1000 },
        namesAtRound: { "0": "A", "1": "B" },
        rankedSeats: ["0", "1"],
        playedAt: "t1",
      },
      { type: "session-end" },
    ]);
    expect(s.active).toBe(false);
    expect(s.rounds).toHaveLength(1);
  });
});
