import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyAction, mulberry32, pendingSeats, startGame, type GameState } from "./engine";
import { botHasWork, chooseBotAction } from "./bot";

/**
 * 셀프플레이 밸런스 (규칙서 §13). 숫자를 바꾸면 `FOG_SIM_LOG=1`로 돌려 분포를 다시 본다.
 * 여기 단언은 "무너지지 않았는지"만 본다 — 정확한 수치는 규칙서 측정 기록.
 */

function play(seed: number, levels: number[]): GameState {
  let s = startGame(levels.length, seed);
  const rng = mulberry32(seed * 7 + 3);
  for (let i = 0; i < 5000 && s.phase !== "ended"; i++) {
    const seat = pendingSeats(s).find((p) => botHasWork(s, p))!;
    s = applyAction(s, chooseBotAction(s, seat, levels[seat], rng)!);
  }
  return s;
}

interface Stats {
  games: number;
  solvedEarly: number;
  dawnWin: number;
  noWinner: number;
  solveRounds: number[];
  wins: number[];
  wrong: number;
  firstSeatWins: number;
}

function run(n: number, levels: number[], games: number, seed0 = 1): Stats {
  const st: Stats = { games, solvedEarly: 0, dawnWin: 0, noWinner: 0, solveRounds: [], wins: Array(n).fill(0), wrong: 0, firstSeatWins: 0 };
  for (let g = 0; g < games; g++) {
    const s = play(seed0 + g * 101, levels);
    const o = s.outcome!;
    if (o.reason === "accused") {
      st.solvedEarly++;
      st.solveRounds.push(o.solvedRound / s.maxRounds);
    } else if (o.winners.length > 0) st.dawnWin++;
    else st.noWinner++;
    for (const w of o.winners) st.wins[w] += 1 / o.winners.length;
    if (o.winners.includes(s.firstSeat)) st.firstSeatWins += 1 / o.winners.length;
    st.wrong += s.wrong.filter(Boolean).length;
  }
  return st;
}

const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);

function report(label: string, st: Stats) {
  if (!process.env.FOG_SIM_LOG) return;
  appendFileSync(process.env.FOG_SIM_LOG, 
    `${label}: 조기해결 ${pct(st.solvedEarly, st.games)} · 새벽승 ${pct(st.dawnWin, st.games)} · 무승 ${pct(st.noWinner, st.games)} · 해결시점 중앙 ${median(st.solveRounds).toFixed(2)} · 오답/판 ${(st.wrong / st.games).toFixed(2)} · 선 ${pct(st.firstSeatWins, st.games)} · 좌석승 ${st.wins.map((w) => Math.round(w)).join("/")}
`,
  );
}

describe("fog manor balance (self-play)", () => {
  const GAMES = process.env.FOG_SIM_LOG ? 300 : 40;

  it.each([2, 3, 4, 5, 6])("%d players, all Lv.8: mostly solved before dawn, not too early", (n) => {
    const st = run(n, Array(n).fill(8), GAMES);
    report(`${n}인 Lv8`, st);
    expect(st.solvedEarly / st.games).toBeGreaterThan(0.45);
    expect(median(st.solveRounds)).toBeLessThan(1.01);
    expect(median(st.solveRounds)).toBeGreaterThan(0.4);
  });

  it.each([2, 4, 6])("%d players, all Lv.5 (default bot) finish", (n) => {
    const st = run(n, Array(n).fill(5), GAMES, 21);
    report(`${n}인 Lv5`, st);
    expect(st.solvedEarly + st.dawnWin).toBeGreaterThan(0);
  });

  it("Lv.10 beats Lv.1 clearly (4p: one Lv10 vs three Lv1)", () => {
    const st = run(4, [10, 1, 1, 1], GAMES, 9);
    report("Lv10 vs 3×Lv1", st);
    expect(st.wins[0] / st.games).toBeGreaterThan(0.45);
  });

  it("Lv.7 beats Lv.3 head to head", () => {
    const a = run(2, [7, 3], GAMES, 3);
    const b = run(2, [3, 7], GAMES, 5);
    report("Lv7 vs Lv3", a);
    report("Lv3 vs Lv7", b);
    expect(a.wins[0] + b.wins[1]).toBeGreaterThan(a.wins[1] + b.wins[0]);
  });

  it("level ladder (3p 1 vs 5 vs 10)", () => {
    const st = run(3, [1, 5, 10], GAMES, 13);
    report("Lv1/5/10", st);
    expect(st.wins[2]).toBeGreaterThan(st.wins[0]);
  });
});
