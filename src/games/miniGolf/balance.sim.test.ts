import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { HOLES } from "./course";
import { applyAction, currentActor, startGame, totalOf } from "./engine";
import { chooseBotAction } from "./bot";

/**
 * Self-play balance check (rulebook §15): 3-hole games (holes 1·4·9, par 9)
 * per bot level, with and without obstacles. Higher levels must take
 * clearly fewer strokes, and obstacles must not blow the scores up. Run with
 * `--reporter=verbose` to see the table.
 */
function avgStrokes(level: number, obstacles: boolean, games: number): number {
  let sum = 0;
  let n = 0;
  for (let g = 0; g < games; g++) {
    const rng = seededRng(5000 + g * 31 + level);
    let s = startGame(2, 700 + g, { holes: 3, obstacles });
    let guard = 0;
    while (s.phase !== "ended" && guard++ < 120) {
      const a = chooseBotAction(s, currentActor(s)!, level, rng);
      if (!a) throw new Error("bot returned no action");
      s = applyAction(s, a);
    }
    expect(s.phase).toBe("ended");
    sum += totalOf(s, 0) + totalOf(s, 1);
    n += 2;
  }
  return sum / n;
}

describe("mini golf balance (§15)", () => {
  it("strokes drop with the bot level; obstacles keep them in range", () => {
    const par = [0, 3, 8].reduce((a, id) => a + HOLES[id].par, 0);
    const rows: string[] = [];
    const plain: Record<number, number> = {};
    const obst: Record<number, number> = {};
    for (const level of [1, 5, 10]) {
      plain[level] = avgStrokes(level, false, 2);
      obst[level] = avgStrokes(level, true, 2);
      rows.push(`Lv.${level}: plain ${plain[level].toFixed(1)} · obstacles ${obst[level].toFixed(1)} (par ${par})`);
    }
    console.log(rows.join("\n"));
    expect(plain[5]).toBeLessThan(plain[1]);
    expect(plain[10]).toBeLessThan(plain[5]);
    expect(obst[10]).toBeLessThan(obst[1]);
    expect(plain[10]).toBeLessThanOrEqual(par + 1);
    for (const level of [1, 5, 10]) expect(Math.abs(obst[level] - plain[level])).toBeLessThan(6);
  }, 120_000);
});
