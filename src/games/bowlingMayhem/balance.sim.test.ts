import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, startGame, totalOf } from "./engine";
import { chooseBotAction } from "./bot";

/**
 * Self-play balance check (rulebook §15): bot games per level on plain and
 * mayhem lanes. Lower levels must score clearly less than higher ones, and
 * the mayhem lanes + items must not swing the average wildly. Run with
 * `--reporter=verbose` to see the table.
 */
function avgScore(level: number, chaos: boolean, games: number, frames: 5 | 10): number {
  let sum = 0;
  let n = 0;
  for (let g = 0; g < games; g++) {
    const rng = seededRng(7000 + g * 31 + level);
    let s = startGame(2, 900 + g, { frames, chaos, items: chaos });
    let guard = 0;
    while (s.phase !== "ended" && guard++ < 200) {
      const a = chooseBotAction(s, s.activeSeat, level, rng);
      if (!a) throw new Error("bot returned no action");
      s = applyAction(s, a);
    }
    expect(s.phase).toBe("ended");
    sum += totalOf(s, 0) + totalOf(s, 1);
    n += 2;
  }
  return sum / n;
}

describe("bowling mayhem balance (§15)", () => {
  it("scores climb with the bot level, mayhem keeps them in range", () => {
    const rows: string[] = [];
    const plain: Record<number, number> = {};
    const chaos: Record<number, number> = {};
    for (const level of [1, 5, 10]) {
      plain[level] = avgScore(level, false, 3, 5);
      chaos[level] = avgScore(level, true, 3, 5);
      rows.push(`Lv.${level}: plain ${plain[level].toFixed(1)} · mayhem ${chaos[level].toFixed(1)} (5 frames)`);
    }
    console.log(rows.join("\n"));
    expect(plain[5]).toBeGreaterThan(plain[1]);
    expect(plain[10]).toBeGreaterThan(plain[5] + 10);
    expect(chaos[10]).toBeGreaterThan(chaos[1] + 20);
    for (const level of [1, 5, 10]) expect(Math.abs(chaos[level] - plain[level])).toBeLessThan(35);
  }, 120_000);
});
