import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { applyAction, computeRankings, currentActor, startGame, type CandleCount, type TalesState } from "./engine";
import { chooseBotAction } from "./bot";

/**
 * Self-play balance checks (rulebook §9). `TALES_SIM_LOG=<file>` appends the
 * numbers quoted in the rulebook / HANDOFF.
 */

export function playOut(levels: BotLevel[], seed: number, candles: CandleCount = 100): TalesState {
  const rng = seededRng(seed * 31 + 7);
  let s = startGame(levels.length, seed, { candles, helper: true });
  for (let i = 0; i < 5000 && s.phase !== "ended"; i++) {
    const a = currentActor(s)!;
    const next = applyAction(s, chooseBotAction(s, a, levels[a], rng));
    if (next === s) throw new Error(`illegal bot move at ${s.turn}`);
    s = next;
  }
  return s;
}

function stats(levels: BotLevel[], games: number, candles: CandleCount = 100) {
  const n = levels.length;
  const wins = Array(n).fill(0);
  const seatWins = Array(n).fill(0);
  let turns = 0;
  let curseWinner = 0;
  let cursedLast = 0;
  let busts = 0;
  for (let g = 0; g < games; g++) {
    const rot = g % n;
    const lv = levels.map((_, i) => levels[(i + rot) % n]);
    const s = playOut(lv, 1000 + g, candles);
    const r = computeRankings(s);
    const win = r.find((x) => x.rank === 1)!.seat;
    wins[(win - rot + n) % n]++;
    // seat order relative to the first player
    const first = startGame(n, 1000 + g).seat;
    seatWins[(win - first + n) % n]++;
    turns += s.log.length ? s.turn : 0;
    if (s.cursedSeat === win) curseWinner++;
    if (r.find((x) => x.seat === s.cursedSeat)!.rank === n) cursedLast++;
    busts += s.busts.reduce((a, b) => a + b, 0);
  }
  return { winRate: wins.map((w) => w / games), seatRate: seatWins.map((w) => w / games), turns: turns / games, curseWinner: curseWinner / games, cursedLast: cursedLast / games, busts: busts / games };
}

const log = (...a: unknown[]) => {
  if (process.env.TALES_SIM_LOG) appendFileSync(process.env.TALES_SIM_LOG, a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
};

describe("백 개의 괴담 self-play", () => {
  it("Lv.10 beats Lv.1 clearly heads-up", () => {
    const r = stats([10, 1], 300);
    log("10 vs 1", r);
    expect(r.winRate[0]).toBeGreaterThan(0.62);
  });

  it("levels are ordered: Lv.7 beats Lv.3", () => {
    const r = stats([7, 3], 300);
    log("7 vs 3", r);
    expect(r.winRate[0]).toBeGreaterThan(0.55);
  });

  it("seat order is fair in a 4-player mirror match", () => {
    const r = stats([6, 6, 6, 6], 400);
    log("6x4", r);
    for (const w of r.seatRate) expect(w).toBeGreaterThan(0.19);
    for (const w of r.seatRate) expect(w).toBeLessThan(0.31);
  });

  it("the curse matters: the cursed seat rarely wins", () => {
    const r = stats([6, 6, 6, 6], 400);
    log("curse", r);
    expect(r.curseWinner).toBeLessThan(0.05);
    expect(r.cursedLast).toBeGreaterThan(0.8);
  });

  it("game length: 100 candles is a ~10 minute game for 4", () => {
    const r = stats([5, 5, 5, 5], 200);
    const short = stats([5, 5, 5, 5], 200, 60);
    log("length", r.turns, short.turns, "busts", r.busts);
    expect(r.turns).toBeGreaterThan(35);
    expect(r.turns).toBeLessThan(110);
    expect(short.turns).toBeLessThan(r.turns);
  });
});
