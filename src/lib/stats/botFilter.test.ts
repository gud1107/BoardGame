import { describe, expect, it } from "vitest";
import type { StatTotalsRecord } from "@/lib/db/types";
import { botLevelRows, pickSlice, unclassifiedCount } from "./botFilter";

const slice = (played: number, wins: number) => ({ played, wins, losses: played - wins, bestRank: 1 });
const perudo: StatTotalsRecord = {
  gameId: "perudo",
  ...slice(6, 3),
  updatedAt: "",
  classified: 4,
  noBot: slice(1, 1),
  byBotLevel: { "0": slice(1, 0), "3": slice(1, 1), "10": slice(2, 0) },
};
const coup: StatTotalsRecord = { gameId: "coup", ...slice(2, 1), updatedAt: "", byBotLevel: { "10": slice(1, 1) }, classified: 1 };

describe("botFilter", () => {
  it("counts matches from before the bot flag", () => {
    expect(unclassifiedCount([perudo, coup])).toBe(3);
    expect(unclassifiedCount([{ gameId: "x", ...slice(5, 2), updatedAt: "" }])).toBe(5);
  });

  it("builds 사람끼리 + Lv.1-10 rows, combined or per game", () => {
    const all = botLevelRows([perudo, coup], null);
    expect(all).toHaveLength(12);
    expect(all[0]).toEqual({ level: null, played: 1, wins: 1, losses: 0 });
    expect(all[1]).toEqual({ level: 0, played: 1, wins: 0, losses: 1 });
    expect(all[11]).toEqual({ level: 10, played: 3, wins: 1, losses: 2 });
    expect(all[5].played).toBe(0);
    expect(botLevelRows([perudo, coup], "coup")[11]).toEqual({ level: 10, played: 1, wins: 1, losses: 0 });
  });

  it("picks the filtered slice", () => {
    expect(pickSlice(perudo, { includeBots: false, botLevel: null })?.played).toBe(1);
    expect(pickSlice(perudo, { includeBots: true, botLevel: 10 })?.played).toBe(2);
    expect(pickSlice(perudo, { includeBots: true, botLevel: 7 })).toBeNull();
    expect(pickSlice(perudo, { includeBots: true, botLevel: 0 })?.played).toBe(1);
  });
});
