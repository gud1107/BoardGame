import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { applyAction, computeRankings, moveHash, startGame, type NightState, type RoundCount } from "./engine";
import { chooseBotMove } from "./bot";

/**
 * Self-play balance (rulebook §9). `HUSH_SIM_LOG=<file>` appends the numbers
 * quoted in the rulebook / HANDOFF.
 */

export function playOut(levels: BotLevel[], seed: number, rounds: RoundCount = 14): NightState {
  const rng = seededRng(seed * 13 + 1);
  let s = startGame(levels.length, seed, { rounds, helper: true });
  for (let guard = 0; guard < 500 && s.phase !== "ended"; guard++) {
    if (s.phase === "choose") {
      const plans = levels.map((lv, seat) => ({ move: chooseBotMove(s, seat, lv, rng), salt: `s${seat}r${s.round}` }));
      for (let seat = 0; seat < levels.length; seat++) s = applyAction(s, { type: "commit", seat, step: s.step, hash: moveHash(plans[seat].move, plans[seat].salt) });
      for (let seat = 0; seat < levels.length && s.phase === "reveal"; seat++) s = applyAction(s, { type: "reveal", seat, step: s.step, ...plans[seat] });
    } else s = applyAction(s, { type: "advance", step: s.step });
  }
  return s;
}

function stats(levels: BotLevel[], games: number, rounds: RoundCount = 14) {
  const n = levels.length;
  const wins = Array(n).fill(0);
  const seatWins = Array(n).fill(0);
  let caught = 0;
  let banked = 0;
  let keysTotal = 0;
  let zero = 0;
  for (let g = 0; g < games; g++) {
    const rot = g % n;
    const lv = levels.map((_, i) => levels[(i + rot) % n]);
    const s = playOut(lv, Number(process.env.HUSH_SEED_BASE ?? 500) + g, rounds);
    const r = computeRankings(s);
    const top = r.filter((y) => y.rank === 1);
    for (const x of top) {
      wins[(x.seat - rot + n) % n] += 1 / top.length;
      seatWins[x.seat] += 1 / top.length;
    }
    caught += s.seats.reduce((a, x) => a + x.caught, 0);
    banked += s.seats.reduce((a, x) => a + x.banked, 0);
    keysTotal += 3 * n;
    zero += s.seats.filter((x) => x.banked === 0).length;
  }
  return { winRate: wins.map((w) => +(w / games).toFixed(3)), seatRate: seatWins.map((w) => +(w / games).toFixed(3)), caughtPerGame: +(caught / games).toFixed(2), bankedShare: +(banked / keysTotal).toFixed(3), zeroShare: +(zero / (games * n)).toFixed(3) };
}

const log = (...a: unknown[]) => {
  if (process.env.HUSH_SIM_LOG) appendFileSync(process.env.HUSH_SIM_LOG, a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
};

describe("숨죽인 밤 self-play", { timeout: 120_000 }, () => {
  it("Lv.10 beats Lv.1", () => {
    const r = stats([10, 1], 200);
    log("10v1", r);
    expect(r.winRate[0]).toBeGreaterThan(0.7);
  });

  it("Lv.7 beats Lv.3", () => {
    const r = stats([7, 3], 200);
    log("7v3", r);
    expect(r.winRate[0]).toBeGreaterThan(0.55);
  });

  it("the monster matters but the night is winnable (4 players)", () => {
    const r = stats([6, 6, 6, 6], 400);
    log("6x4", r);
    for (const w of r.seatRate) expect(w).toBeGreaterThan(0.19);
    expect(r.caughtPerGame).toBeGreaterThan(1);
    expect(r.bankedShare).toBeGreaterThan(0.35);
    expect(r.zeroShare).toBeLessThan(0.45);
  });

  it("3 players and the short night stay fair", () => {
    const r = stats([5, 5, 5], 300, 10);
    log("5x3 short", r);
    expect(r.bankedShare).toBeGreaterThan(0.2);
    for (const w of r.seatRate) expect(w).toBeGreaterThan(0.22);
  });
});
