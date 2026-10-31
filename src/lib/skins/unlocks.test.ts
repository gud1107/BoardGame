import { describe, expect, it } from "vitest";
import type { StatTotalsRecord } from "@/lib/db/types";
import { TIER_ORDER, UNLOCKS, UNLOCK_IDS, isUnlocked, nextGoals, progressFrom, rewardsFor } from "./unlocks";

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

  it("keeps 1-player runs out of plays and wins (each run is a bot-free 1st) and counts them as their own track", () => {
    const p = progressFrom([row("hungry-shark", 40, 40, { played: 40, wins: 40 }), row("coup", 2, 1, { played: 2, wins: 1 })]);
    expect(p.soloRuns).toBe(40);
    expect(p.plays).toBe(2);
    expect(p.humanPlays).toBe(2);
    expect(p.humanWins).toBe(1);
    expect(p.mastery).toBe(1);
    expect(p.gamesWon).toBe(1);
    expect(p.gamesPlayed).toBe(2);
    expect(isUnlocked("humanWins30", p)).toBe(false);
    expect(isUnlocked("solo10", p)).toBe(true);
  });

  it("counts wins at Lv.8+ and Lv.10 bot tables", () => {
    const r: StatTotalsRecord = {
      ...row("dalmuti", 20, 9),
      byBotLevel: { "3": { played: 5, wins: 4, losses: 1, bestRank: 1 }, "8": { played: 5, wins: 2, losses: 3, bestRank: 1 }, "10": { played: 10, wins: 3, losses: 7, bestRank: 1 } },
    };
    const p = progressFrom([r]);
    expect(p.bot8Wins).toBe(5);
    expect(p.bot10Wins).toBe(3);
    expect(p.plays).toBe(20);
  });

  it("gives every goal at least one prize and every tier at least one goal", () => {
    for (const id of UNLOCK_IDS) expect(rewardsFor(id).length).toBeGreaterThan(0);
    for (const t of TIER_ORDER) expect(UNLOCK_IDS.some((id) => UNLOCKS[id].tier === t)).toBe(true);
    // a higher goal on the same track is never a lower tier
    for (const a of UNLOCK_IDS)
      for (const b of UNLOCK_IDS)
        if (UNLOCKS[a].of === UNLOCKS[b].of && UNLOCKS[a].goal < UNLOCKS[b].goal) expect(TIER_ORDER.indexOf(UNLOCKS[a].tier)).toBeLessThanOrEqual(TIER_ORDER.indexOf(UNLOCKS[b].tier));
  });

  it("suggests the closest locked goals first", () => {
    const p = progressFrom([row("coup", 9, 0, { played: 4, wins: 0 })]);
    const next = nextGoals(p);
    expect(next[0]).toBe("plays10"); // 9/10
    expect(next[1]).toBe("humanPlays5"); // 4/5
    expect(next).not.toContain(undefined);
  });

  it("keeps every track a tight ladder of many steps", () => {
    expect(UNLOCK_IDS.length).toBeGreaterThanOrEqual(60);
    const tracks = new Set(UNLOCK_IDS.map((id) => UNLOCKS[id].of));
    for (const of of tracks) {
      const goals = UNLOCK_IDS.filter((id) => UNLOCKS[id].of === of).map((id) => UNLOCKS[id].goal).sort((a, b) => a - b);
      expect(goals.length).toBeGreaterThanOrEqual(4);
      // after the first step, the next goal is never more than 2.5x away
      for (let i = 2; i < goals.length; i++) expect(goals[i] / goals[i - 1]).toBeLessThanOrEqual(2.5);
    }
  });
});
