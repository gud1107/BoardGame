import { describe, expect, it } from "vitest";
import { champions, type GameBoardRow } from "./gameChampions";

const row = (rank: number, wins: number, isMe = false): GameBoardRow => ({
  rank,
  nickname: `p${rank}-${wins}`,
  portrait: null,
  played: wins + 1,
  wins,
  winRate: null,
  isMe,
});

describe("champions", () => {
  it("returns every row tied at rank 1", () => {
    expect(champions([row(1, 3), row(1, 3, true), row(3, 1)]).map((r) => r.isMe)).toEqual([false, true]);
  });
  it("has no champion while nobody has won this month", () => {
    expect(champions([row(1, 0), row(1, 0)])).toEqual([]);
  });
});
