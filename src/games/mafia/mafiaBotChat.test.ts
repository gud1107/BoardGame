import { describe, expect, it } from "vitest";
import { startGame, DEFAULT_MAFIA_CONFIG, type MafiaState } from "./engine";
import { chooseDiscussionLine, chooseSelfDefenseLine } from "./mafiaBotChat";

function namesFor(state: MafiaState): Record<number, string> {
  const map: Record<number, string> = {};
  for (const p of state.players) map[p.seat] = `플레이어${p.seat}`;
  return map;
}

describe("chooseDiscussionLine", () => {
  it("always returns a non-empty string for every alive seat, regardless of role or team", () => {
    const state = startGame(8, 7, { ...DEFAULT_MAFIA_CONFIG, mode: "expansion" }, 1000);
    const names = namesFor(state);
    for (const p of state.players) {
      const line = chooseDiscussionLine(state, p.seat, names, () => 0.5);
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it("never has a mafia-aligned seat accuse one of its own known teammates", () => {
    // Run many rng samples across the full [0,1) range to exercise every branch.
    const state = startGame(8, 7, { ...DEFAULT_MAFIA_CONFIG, mode: "expansion" }, 1000);
    const names = namesFor(state);
    const mafiaSeat = state.players.find((p) => p.role === "mafia")!.seat;
    const teammateNames = state.players.filter((p) => p.role === "mafia" && p.seat !== mafiaSeat).map((p) => names[p.seat]);
    for (let i = 0; i < 50; i++) {
      const r = i / 50;
      const line = chooseDiscussionLine(state, mafiaSeat, names, () => r);
      for (const teammateName of teammateNames) {
        expect(line.includes(`${teammateName}님이 좀 수상`)).toBe(false);
      }
    }
  });

  it("is deterministic for a fixed rng function", () => {
    const state = startGame(6, 1, DEFAULT_MAFIA_CONFIG, 1000);
    const names = namesFor(state);
    const a = chooseDiscussionLine(state, 0, names, () => 0.42);
    const b = chooseDiscussionLine(state, 0, names, () => 0.42);
    expect(a).toBe(b);
  });
});

describe("chooseSelfDefenseLine", () => {
  it("always returns a non-empty string", () => {
    const state = startGame(9, 3, { ...DEFAULT_MAFIA_CONFIG, mode: "expansion" }, 1000);
    for (const p of state.players) {
      const line = chooseSelfDefenseLine(state, p.seat, () => 0.9);
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it("can produce terrorist-flavored lines only for the terrorist role", () => {
    const state = startGame(8, 2, { ...DEFAULT_MAFIA_CONFIG, mode: "expansion" }, 1000);
    const terrorist = state.players.find((p) => p.role === "terrorist");
    if (!terrorist) return; // this seed's 8p roll may not include one — role-pool coverage is asserted in Mafia.test.ts
    const nonTerrorist = state.players.find((p) => p.role !== "terrorist")!;
    const terroristLine = chooseSelfDefenseLine(state, terrorist.seat, () => 0.1);
    const otherLine = chooseSelfDefenseLine(state, nonTerrorist.seat, () => 0.1);
    expect(terroristLine).toContain("후회");
    expect(otherLine).not.toContain("후회");
  });
});
