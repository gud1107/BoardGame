import { describe, expect, it } from "vitest";
import {
  activeVoteFor,
  INITIAL_BOT_TAKEOVER_STATE,
  isSeatTakenOver,
  reduceBotTakeover,
  voteThresholdMet,
  voteYesCount,
  type BotTakeoverEvent,
  type BotTakeoverState,
} from "./botTakeover";

function run(state: BotTakeoverState, events: BotTakeoverEvent[]): BotTakeoverState {
  let s = state;
  for (const e of events) s = reduceBotTakeover(s, e);
  return s;
}

describe("voteThresholdMet", () => {
  it("passes on a strict majority, not a tie", () => {
    expect(voteThresholdMet(2, 3)).toBe(true); // 4-player game, 1 left, 2 of 3 yes
    expect(voteThresholdMet(1, 3)).toBe(false);
  });

  it("requires MORE than half, so an exact half does not pass", () => {
    expect(voteThresholdMet(2, 4)).toBe(false);
    expect(voteThresholdMet(3, 4)).toBe(true);
  });

  it("a single eligible voter (2-player game, e.g. malDalliJa) converts on their own yes", () => {
    expect(voteThresholdMet(1, 1)).toBe(true);
    expect(voteThresholdMet(0, 1)).toBe(false);
  });

  it("zero eligible voters never passes (nobody left to vote)", () => {
    expect(voteThresholdMet(0, 0)).toBe(false);
  });
});

describe("reduceBotTakeover", () => {
  it("vote-start opens a fresh vote with no yes votes yet", () => {
    const s = reduceBotTakeover(INITIAL_BOT_TAKEOVER_STATE, {
      type: "vote-start",
      seatKey: "2",
      reason: "disconnected",
      startedAt: 1000,
      originalUserId: "user-2",
      originalName: "하늘",
    });
    expect(activeVoteFor(s, "2")).toEqual({
      seatKey: "2",
      reason: "disconnected",
      startedAt: 1000,
      originalUserId: "user-2",
      originalName: "하늘",
      yesVoterDeviceIds: [],
    });
    expect(voteYesCount(s, "2")).toBe(0);
    expect(isSeatTakenOver(s, "2")).toBe(false);
  });

  it("a second vote-start for the same seat is a no-op (two clients racing to notice the same disconnect)", () => {
    const s = run(INITIAL_BOT_TAKEOVER_STATE, [
      { type: "vote-start", seatKey: "1", reason: "disconnected", startedAt: 100, originalUserId: "user-1", originalName: "민준" },
      { type: "vote-cast", seatKey: "1", voterDeviceId: "dev-a" },
      { type: "vote-start", seatKey: "1", reason: "idle", startedAt: 999, originalUserId: "user-1", originalName: "민준" },
    ]);
    // startedAt/reason and the existing yes vote are all preserved — the
    // second vote-start did not reset anything.
    expect(activeVoteFor(s, "1")).toEqual({
      seatKey: "1",
      reason: "disconnected",
      startedAt: 100,
      originalUserId: "user-1",
      originalName: "민준",
      yesVoterDeviceIds: ["dev-a"],
    });
  });

  it("vote-cast tallies distinct devices and dedupes a repeated cast from the same device", () => {
    const s = run(INITIAL_BOT_TAKEOVER_STATE, [
      { type: "vote-start", seatKey: "0", reason: "idle", startedAt: 0, originalUserId: "user-0", originalName: "도윤" },
      { type: "vote-cast", seatKey: "0", voterDeviceId: "dev-a" },
      { type: "vote-cast", seatKey: "0", voterDeviceId: "dev-b" },
      { type: "vote-cast", seatKey: "0", voterDeviceId: "dev-a" }, // repeat, ignored
    ]);
    expect(voteYesCount(s, "0")).toBe(2);
  });

  it("vote-cast against a seat with no active vote is a no-op", () => {
    const s = reduceBotTakeover(INITIAL_BOT_TAKEOVER_STATE, {
      type: "vote-cast",
      seatKey: "3",
      voterDeviceId: "dev-a",
    });
    expect(s).toBe(INITIAL_BOT_TAKEOVER_STATE);
  });

  it("vote-cancel (target proves presence: '저 있어요') removes the pending vote entirely", () => {
    const s = run(INITIAL_BOT_TAKEOVER_STATE, [
      { type: "vote-start", seatKey: "1", reason: "idle", startedAt: 0, originalUserId: "user-1", originalName: "민준" },
      { type: "vote-cast", seatKey: "1", voterDeviceId: "dev-a" },
      { type: "vote-cancel", seatKey: "1" },
    ]);
    expect(activeVoteFor(s, "1")).toBeNull();
    expect(isSeatTakenOver(s, "1")).toBe(false);
  });

  it("convert clears the vote and records takeover info (pulled from the vote itself) for reward/ranking mapping", () => {
    const s = run(INITIAL_BOT_TAKEOVER_STATE, [
      { type: "vote-start", seatKey: "2", reason: "disconnected", startedAt: 0, originalUserId: "user-42", originalName: "지수" },
      { type: "vote-cast", seatKey: "2", voterDeviceId: "dev-a" },
      { type: "vote-cast", seatKey: "2", voterDeviceId: "dev-b" },
      { type: "convert", seatKey: "2", at: 5000 },
    ]);
    expect(activeVoteFor(s, "2")).toBeNull();
    expect(isSeatTakenOver(s, "2")).toBe(true);
    expect(s.takeovers["2"]).toEqual({ originalUserId: "user-42", originalName: "지수", convertedAt: 5000 });
  });

  it("convert with no matching in-progress vote is a no-op (defensive against a stale/duplicate broadcast)", () => {
    const s = reduceBotTakeover(INITIAL_BOT_TAKEOVER_STATE, { type: "convert", seatKey: "2", at: 5000 });
    expect(s).toBe(INITIAL_BOT_TAKEOVER_STATE);
  });

  it("reclaim (original player returns and takes back control) clears the takeover", () => {
    const converted = run(INITIAL_BOT_TAKEOVER_STATE, [
      { type: "vote-start", seatKey: "2", reason: "disconnected", startedAt: 0, originalUserId: "user-42", originalName: "지수" },
      { type: "convert", seatKey: "2", at: 5000 },
    ]);
    const reclaimed = reduceBotTakeover(converted, { type: "reclaim", seatKey: "2" });
    expect(isSeatTakenOver(reclaimed, "2")).toBe(false);
    expect(activeVoteFor(reclaimed, "2")).toBeNull();
  });

  it("reclaim on a seat that was never taken over is a no-op", () => {
    const s = reduceBotTakeover(INITIAL_BOT_TAKEOVER_STATE, { type: "reclaim", seatKey: "3" });
    expect(s).toBe(INITIAL_BOT_TAKEOVER_STATE);
  });

  it("two seats converting independently (4-player room, 2 simultaneous disconnects) don't interfere with each other", () => {
    const s = run(INITIAL_BOT_TAKEOVER_STATE, [
      { type: "vote-start", seatKey: "1", reason: "disconnected", startedAt: 0, originalUserId: "user-1", originalName: "민준" },
      { type: "vote-start", seatKey: "3", reason: "disconnected", startedAt: 0, originalUserId: "user-3", originalName: "서연" },
      { type: "vote-cast", seatKey: "1", voterDeviceId: "dev-a" },
      { type: "vote-cast", seatKey: "1", voterDeviceId: "dev-c" },
      { type: "convert", seatKey: "1", at: 10 },
      { type: "vote-cast", seatKey: "3", voterDeviceId: "dev-a" },
    ]);
    expect(isSeatTakenOver(s, "1")).toBe(true);
    expect(isSeatTakenOver(s, "3")).toBe(false);
    expect(voteYesCount(s, "3")).toBe(1);
    expect(activeVoteFor(s, "1")).toBeNull(); // converted seat's vote is gone
  });

  it("vote-start on an already-converted seat is a no-op (e.g. a stale/duplicate broadcast after conversion)", () => {
    const converted = run(INITIAL_BOT_TAKEOVER_STATE, [
      { type: "vote-start", seatKey: "0", reason: "disconnected", startedAt: 0, originalUserId: "user-9", originalName: "서연" },
      { type: "convert", seatKey: "0", at: 10 },
    ]);
    const s = reduceBotTakeover(converted, {
      type: "vote-start",
      seatKey: "0",
      reason: "idle",
      startedAt: 999,
      originalUserId: "user-9",
      originalName: "서연",
    });
    expect(activeVoteFor(s, "0")).toBeNull();
    expect(isSeatTakenOver(s, "0")).toBe(true);
  });
});
