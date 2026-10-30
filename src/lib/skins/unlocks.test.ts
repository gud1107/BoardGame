import { describe, expect, it } from "vitest";
import type { StatTotalsRecord } from "@/lib/db/types";
import { isUnlocked, progressFrom } from "./unlocks";

const row = (gameId: string, played: number, wins: number, noBot?: { played: number; wins: number }): StatTotalsRecord => ({
  gameId,
  played,
  wins,
  losses: played - wins,
  bestRank: wins ? 1 : null,
  updatedAt: "2026-10-31T00:00:00Z",
  ...(noBot ? { noBot: { ...noBot, losses: noBot.played - noBot.wins, bestRank: null } } : {}),
});

describe("skin unlocks", () => {
  it("counts only games with no bot at the table toward plays and wins", () => {
    // 40 games vs bots, only 3 with people
    const p = progressFrom([row("dalmuti", 40, 30, { played: 3, wins: 2 })]);
    expect(p.humanPlays).toBe(3);
    expect(p.humanWins).toBe(2);
    expect(isUnlocked("humanPlays5", p)).toBe(false);
  });

  it("treats rows from before the bot flag as no human games", () => {
    const p = progressFrom([row("coup", 12, 6)]);
    expect(p.humanPlays).toBe(0);
    expect(p.gamesPlayed).toBe(1);
  });

  it("counts distinct games played and unlocks at the goal", () => {
    const rows = ["dalmuti", "coup", "perudo", "love-letter", "bang", "hanamikoji", "no-thanks", "lost-cities"].map((g) => row(g, 1, 0, { played: 1, wins: 0 }));
    const p = progressFrom(rows);
    expect(p.gamesPlayed).toBe(8);
    expect(isUnlocked("games8", p)).toBe(true);
    expect(isUnlocked("humanPlays5", p)).toBe(true);
    expect(isUnlocked(undefined, p)).toBe(true);
  });
});
