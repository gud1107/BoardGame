import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyAction, chooseBotAction, getValidMoves, startGame, type AvalonState } from "./engine";

/**
 * 셀프플레이 밸런스 (2026-11-19 추가). 예전 테스트는 셋업·규칙·완주만 봤다 — 여기서는 승률을 본다.
 * 숫자를 다시 보려면 `AVALON_SIM_LOG=<파일>`로 돌린다(판 수가 늘어남). 단언은 "무너지지 않았는지"만 본다.
 */

function rngOf(seed: number): () => number {
  let x = seed % 2147483647 || 1;
  return () => {
    x = (x * 48271) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

/** goodLv/evilLv: 팀별 봇 레벨 */
function playAvalon(n: number, seed: number, goodLv: number, evilLv: number): AvalonState {
  let s = startGame(n, seed);
  const rng = rngOf(seed * 31 + 7);
  for (let guard = 0; guard < 3000 && s.phase !== "gameOver"; guard++) {
    const seat = s.players.findIndex((p) => getValidMoves(s, p.seat).length > 0);
    if (seat < 0) break;
    const lv = s.players[seat].team === "good" ? goodLv : evilLv;
    s = applyAction(s, chooseBotAction(s, seat, lv as never, rng)!);
  }
  return s;
}

function goodRate(n: number, goodLv: number, evilLv: number, games: number, seed0: number) {
  let good = 0;
  let assassin = 0;
  for (let g = 0; g < games; g++) {
    const s = playAvalon(n, seed0 + g * 97, goodLv, evilLv);
    expect(s.phase).toBe("gameOver");
    if (s.winner === "good") good++;
    if (s.winReason === "assassin-correct") assassin++;
  }
  return { good: good / games, assassin: assassin / games };
}

const LOG = process.env.AVALON_SIM_LOG;
const GAMES = LOG ? 400 : 60;
const log = (line: string) => LOG && appendFileSync(LOG, line + "\n");

describe("avalon balance (self-play)", () => {
  it.each([5, 6, 7, 8, 9, 10])("%d players, all Lv.5: both teams win often enough", (n) => {
    const r = goodRate(n, 5, 5, GAMES, 1000 + n);
    log(`${n}인 Lv5: 선 승률 ${Math.round(r.good * 100)}% · 암살 성공 ${Math.round(r.assassin * 100)}%`);
    expect(r.good).toBeGreaterThan(0.15);
    expect(r.good).toBeLessThan(0.85);
  });

  // 고수끼리는 아직 악 쪽으로 기운다(선 10~50%, 인원별 들쭉날쭉 — 남은 약점, 2026-11-19 기록). 여기선 "선도 이길 수 있다"만 본다.
  it.each([5, 6, 7, 8, 9, 10])("%d players, all Lv.9: expert mirror, good can still win", (n) => {
    const r = goodRate(n, 9, 9, GAMES, 7000 + n);
    log(`${n}인 Lv9 거울: 선 승률 ${Math.round(r.good * 100)}% · 암살 성공 ${Math.round(r.assassin * 100)}%`);
    expect(r.good).toBeGreaterThan(0.03);
  });

  it.each([5, 7, 10])("%d players: smarter good team wins more", (n) => {
    const hi = goodRate(n, 9, 5, GAMES, 3000 + n);
    const lo = goodRate(n, 1, 5, GAMES, 3000 + n);
    log(`${n}인 선 Lv9 vs 악 Lv5: ${Math.round(hi.good * 100)}% / 선 Lv1 vs 악 Lv5: ${Math.round(lo.good * 100)}%`);
    expect(hi.good).toBeGreaterThan(lo.good);
  });

  it.each([5, 7, 10])("%d players: smarter evil team wins more", (n) => {
    const hi = goodRate(n, 5, 9, GAMES, 5000 + n);
    const lo = goodRate(n, 5, 1, GAMES, 5000 + n);
    log(`${n}인 악 Lv9 vs 선 Lv5: 선 ${Math.round(hi.good * 100)}% / 악 Lv1 vs 선 Lv5: 선 ${Math.round(lo.good * 100)}%`);
    expect(hi.good).toBeLessThan(lo.good);
  });
});
