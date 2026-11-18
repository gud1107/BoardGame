import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyAction, contradictionsOf, mulberry32, pendingSeats, startGame, type GameOptions, type GameState } from "./engine";
import { botHasWork, chooseBotAction } from "./bot";
import { opportunitySeats } from "./deduce";

/**
 * 셀프플레이 밸런스 (규칙서 §9). 숫자를 바꾸면 `CCTV_SIM_LOG=<파일>`로 돌려 분포를 다시 본다.
 * 여기 단언은 "무너지지 않았는지"만 본다 — 정확한 수치는 규칙서 측정 기록.
 */

function play(seed: number, levels: number[], options: Partial<GameOptions> = {}): GameState {
  let s = startGame(levels.length, seed, options);
  const rng = mulberry32(seed * 7 + 3);
  for (let i = 0; i < 5000 && s.phase !== "ended"; i++) {
    const seat = pendingSeats(s).find((p) => botHasWork(s, p))!;
    s = applyAction(s, chooseBotAction(s, seat, levels[seat], rng)!);
  }
  return s;
}

interface Stats {
  games: number;
  caught: number;
  witness: number;
  suspects: number;
  hits: number;
  checks: number;
  testimonies: number;
  rightVotes: number;
  guestVotes: number;
  culpritWinsBySeat: number[];
  wins: number[];
}

function run(levels: number[], games: number, seed0 = 1, culpritLevel?: number): Stats {
  const n = levels.length;
  const st: Stats = { games, caught: 0, witness: 0, suspects: 0, hits: 0, checks: 0, testimonies: 0, rightVotes: 0, guestVotes: 0, culpritWinsBySeat: Array(n).fill(0), wins: Array(n).fill(0) };
  for (let g = 0; g < games; g++) {
    const seed = seed0 + g * 101;
    let lv = levels;
    if (culpritLevel !== undefined) {
      const c = startGame(n, seed).culprit;
      lv = levels.map((l, s) => (s === c ? culpritLevel : l));
    }
    const s = play(seed, lv);
    const c = s.cases[0];
    if (c.caught) st.caught++;
    else st.culpritWinsBySeat[c.culprit]++;
    // 밤이 끝난 직후의 상태를 다시 만들 수는 없으므로, 끝난 상태에서 목격 여부를 본다
    let seen = false;
    for (let x = 0; x < n; x++) if (x !== c.culprit && contradictionsOf(s, x).length > 0) seen = true;
    if (seen) st.witness++;
    st.suspects += opportunitySeats(s).length;
    for (const t of s.tally) {
      st.hits += t.hits;
      st.checks += t.checks;
      st.testimonies += t.testimonies;
    }
    c.votes.forEach((v, seat) => {
      if (seat === c.culprit) return;
      st.guestVotes++;
      if (v === c.culprit) st.rightVotes++;
    });
    for (const w of s.outcome!.winners) st.wins[w] += 1 / s.outcome!.winners.length;
  }
  return st;
}

const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

function report(label: string, st: Stats) {
  if (!process.env.CCTV_SIM_LOG) return;
  appendFileSync(
    process.env.CCTV_SIM_LOG,
    `${label}: 검거 ${pct(st.caught, st.games)} · 손님 정답표 ${pct(st.rightVotes, st.guestVotes)} · 목격자 있는 판 ${pct(st.witness, st.games)} · 용의선상 ${(st.suspects / st.games).toFixed(2)}명 · 대조 ${(st.checks / st.games).toFixed(1)}(적중 ${(st.hits / st.games).toFixed(2)}) · 증언 ${(st.testimonies / st.games).toFixed(2)} · 좌석승 ${st.wins.map((w) => Math.round(w)).join("/")}\n`,
  );
}

describe("cctv alibi balance (self-play)", () => {
  const GAMES = process.env.CCTV_SIM_LOG ? 400 : 40;

  it.each([3, 4, 5, 6])("%d players, all Lv.8: culprit neither always caught nor always free", (n) => {
    const st = run(Array(n).fill(8), GAMES);
    report(`${n}인 Lv8`, st);
    expect(st.caught / st.games).toBeGreaterThan(0.25);
    expect(st.caught / st.games).toBeLessThan(0.85);
  });

  // 2026-11-19: 기본 봇 범인이 조작을 길게 잡아 검거 82~84%였다 → 계획 6번 비교 + 맞증언 후 66~70%
  it.each([3, 4, 6])("%d players, all Lv.5 (default bot): guests are not a lock", (n) => {
    const st = run(Array(n).fill(5), GAMES, 21);
    report(`${n}인 Lv5`, st);
    expect(st.games).toBe(GAMES);
    expect(st.caught / st.games).toBeGreaterThan(0.4);
    expect(st.caught / st.games).toBeLessThan(0.8);
  });

  it.each([3, 5])("%d players, all Lv.1", (n) => {
    const st = run(Array(n).fill(1), GAMES, 33);
    report(`${n}인 Lv1`, st);
    expect(st.games).toBe(GAMES);
  });

  it("smart guests catch more than clumsy guests (4p, culprit Lv.5)", () => {
    const hi = run([9, 9, 9, 9], GAMES, 5, 5);
    const lo = run([1, 1, 1, 1], GAMES, 5, 5);
    report("손님 Lv9 vs 범인 Lv5", hi);
    report("손님 Lv1 vs 범인 Lv5", lo);
    expect(hi.caught).toBeGreaterThan(lo.caught);
  });

  it("smart culprit escapes more than clumsy culprit (4p, guests Lv.6)", () => {
    const hi = run([6, 6, 6, 6], GAMES, 9, 10);
    const lo = run([6, 6, 6, 6], GAMES, 9, 1);
    report("범인 Lv10 vs 손님 Lv6", hi);
    report("범인 Lv1 vs 손님 Lv6", lo);
    expect(hi.caught).toBeLessThan(lo.caught);
  });
});
