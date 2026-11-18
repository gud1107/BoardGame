import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAFIA_CONFIG, applyAction, chooseBotAction, currentActor, startGame, type MafiaGameConfig, type MafiaState } from "./engine";

/**
 * 셀프플레이 밸런스 (2026-11-19 추가). 예전 테스트는 직업 구성·규칙·완주만 봤다 — 여기서는 끝까지 둔 판의 승률을 본다.
 * 숫자를 다시 보려면 `MAFIA_SIM_LOG=<파일>`로 돌린다(판 수가 늘어남). 단언은 "무너지지 않았는지"만 본다.
 * 참고: 마피아 봇은 레벨을 쓰지 않는다(chooseBotAction의 `_level`) — 그래서 레벨 사다리는 재지 않는다.
 */

function rngOf(seed: number): () => number {
  let x = seed % 2147483647 || 1;
  return () => {
    x = (x * 48271) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

function playMafia(n: number, seed: number, config: MafiaGameConfig): { s: MafiaState; days: number } {
  let s = startGame(n, seed, config, 1000);
  const rng = rngOf(seed * 17 + 3);
  let clock = 2000;
  for (let guard = 0; guard < 400 && s.phase !== "gameOver"; guard++) {
    let actor = currentActor(s);
    for (let k = 0; actor !== null && k < 500; k++) {
      const a = chooseBotAction(s, actor, 5, rng);
      if (!a) break;
      s = applyAction(s, a);
      actor = currentActor(s);
    }
    if (s.phase !== "gameOver") {
      clock += s.phaseDurationMs + 1;
      s = applyAction(s, { type: "forceAdvance", expectedPhase: s.phase, atMs: clock });
    }
  }
  return { s, days: s.dayNumber };
}

const LOG = process.env.MAFIA_SIM_LOG;
const GAMES = LOG ? 300 : 40;
const log = (line: string) => LOG && appendFileSync(LOG, line + "\n");

function run(mode: "classic" | "expansion", n: number) {
  let citizen = 0;
  let days = 0;
  let stuck = 0;
  for (let g = 0; g < GAMES; g++) {
    const r = playMafia(n, 500 + g * 61 + n, { ...DEFAULT_MAFIA_CONFIG, mode });
    if (r.s.phase !== "gameOver") {
      // 알려진 약점: 확장판에서 밤에 죽일 수 없는 스파이만 남으면 봇끼리 지목 동률이 매일 되풀이돼 안 끝날 수 있다
      stuck++;
      log(`STUCK ${mode} ${n} seed ${500 + g * 61 + n} phase ${r.s.phase} day ${r.s.dayNumber} alive ${r.s.players.filter((p) => p.alive).map((p) => p.role).join(",")}`);
      continue;
    }
    if (r.s.winner === "citizen") citizen++;
    days += r.days;
  }
  const done = GAMES - stuck;
  log(`${mode} ${n}인: 시민 승률 ${Math.round((citizen / done) * 100)}% · 평균 ${(days / done).toFixed(1)}일${stuck ? ` · 안 끝난 판 ${stuck}` : ""}`);
  expect(stuck / GAMES).toBeLessThanOrEqual(0.05);
  return citizen / done;
}

describe("mafia balance (self-play)", () => {
  // 2026-11-19: 시민 봇이 "의심도 60 이상"일 때만 찬성해 처형이 거의 안 났다(클래식 4인 6% · 7인 0%).
  // 지목 수·남은 인원 압박을 넣은 뒤 마피아 1명 판(4~6인)은 시민 30~45%.
  it.each([4, 5, 6])("classic %d players (1 mafia): both sides win", (n) => {
    const c = run("classic", n);
    expect(c).toBeGreaterThan(0.15);
    expect(c).toBeLessThan(0.85);
  });

  // 알려진 약점: 마피아가 2명 이상이면 봇끼리는 아직 시민이 거의 못 이긴다(0~7%). 사람은 대화로 경찰 결과를
  // 나누지만 봇 시민은 그걸 못 쓴다. 여기서는 끝까지 가는지만 본다.
  it.each([7, 8])("classic %d players (2 mafia): games finish", (n) => {
    run("classic", n);
  });

  it.each([6, 8, 10, 12])("expansion %d players: games finish", (n) => {
    run("expansion", n);
  });
});
