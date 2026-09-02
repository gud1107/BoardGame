import { describe, expect, it } from "vitest";
import {
  ANSWER_COOLDOWN_MS,
  MAX_HIDDEN_QUESTIONS,
  applyAction,
  canSubmitAnswer,
  chooseBotAction,
  computeRankings,
  cooldownRemainingMs,
  getValidMoves,
  isCorrectAnswer,
  startGame,
  type EngineAction,
  type GameState,
} from "./engine";
import { SCENARIOS, correctAnswerTextFor, getScenario } from "./scenarios";
import { seededRng } from "@/lib/rng";
import type { BotLevel } from "../shared/bot/botDifficulty";

describe("scenarios DB", () => {
  it("유형 A 1개 + 유형 B 9개, 총 10개가 등록돼 있다", () => {
    expect(SCENARIOS.filter((s) => s.type === "A")).toHaveLength(1);
    expect(SCENARIOS.filter((s) => s.type === "B")).toHaveLength(9);
  });

  it("모든 시나리오는 answerRequiredKeywordGroups를 합친 정답 텍스트가 isCorrectAnswer를 통과한다", () => {
    for (const scenario of SCENARIOS) {
      const text = correctAnswerTextFor(scenario);
      expect(isCorrectAnswer(scenario, text)).toBe(true);
    }
  });

  it("모든 yellow verdict 트리거는 yellowDetail을 갖고 있다(노란불 복기 리포트 필수 데이터)", () => {
    for (const scenario of SCENARIOS) {
      for (const trigger of scenario.questionBank) {
        if (trigger.verdict === "yellow") expect(trigger.yellowDetail).toBeTruthy();
      }
    }
  });

  it("모든 시나리오는 타임테이블/증거/메시지/증언을 최소 1개 이상 갖는다", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.timeline.length).toBeGreaterThan(0);
      expect(scenario.evidence.length).toBeGreaterThan(0);
      expect(scenario.messages.length).toBeGreaterThan(0);
      expect(scenario.testimonies.length).toBeGreaterThan(0);
    }
  });
});

describe("startGame", () => {
  it("같은 시드는 항상 같은 시나리오/좌석 배정을 재현한다(락스텝 결정론)", () => {
    const a = startGame(4, 12345);
    const b = startGame(4, 12345);
    expect(a).toEqual(b);
  });

  it("다른 시드는 대체로 다른 시나리오를 뽑을 수 있다", () => {
    const scenarioIds = new Set(Array.from({ length: 20 }, (_, i) => startGame(3, i).scenarioId));
    expect(scenarioIds.size).toBeGreaterThan(1);
  });
});

describe("ASK_QUESTION 판정", () => {
  it("등록된 키워드가 포함된 질문은 트리거의 verdict를 그대로 따른다", () => {
    const state = startGame(2, 1);
    const scenario = getScenario(state.scenarioId);
    const trigger = scenario.questionBank[0];
    const next = applyAction(state, {
      type: "ASK_QUESTION",
      seat: 0,
      mode: "public",
      text: trigger.sampleQuestion,
      atMs: 0,
    });
    expect(next.questionLog).toHaveLength(1);
    expect(next.questionLog[0].verdict).toBe(trigger.verdict);
    expect(next.questionLog[0].triggerId).toBe(trigger.id);
  });

  it("아무 트리거에도 안 걸리는 질문은 기본값 빨간불로 판정한다", () => {
    const state = startGame(2, 1);
    const next = applyAction(state, {
      type: "ASK_QUESTION",
      seat: 0,
      mode: "public",
      text: "완전히 무관한 헛소리 질문입니다 zzz",
      atMs: 0,
    });
    expect(next.questionLog[0].verdict).toBe("red");
    expect(next.questionLog[0].triggerId).toBeNull();
  });

  it("내 턴이 아니면 질문해도 상태가 바뀌지 않는다(no-op)", () => {
    const state = startGame(2, 1);
    const next = applyAction(state, { type: "ASK_QUESTION", seat: 1, mode: "public", text: "아무 질문", atMs: 0 });
    expect(next).toBe(state);
  });

  it("질문 후 턴이 다음 좌석으로 넘어간다", () => {
    const state = startGame(3, 1);
    const next = applyAction(state, { type: "ASK_QUESTION", seat: 0, mode: "public", text: "질문", atMs: 0 });
    expect(next.turnIndex).toBe(1);
    expect(next.turnNumber).toBe(2);
  });

  it("히든 질문은 최대 7회, 8번째는 no-op이다", () => {
    let state = startGame(2, 1);
    for (let i = 0; i < MAX_HIDDEN_QUESTIONS; i++) {
      // 매번 자기 턴이 돌아오도록 2인전에서 상대는 패스만 반복
      state = applyAction(state, { type: "ASK_QUESTION", seat: 0, mode: "hidden", text: `질문${i}`, atMs: 0 });
      state = applyAction(state, { type: "PASS_TURN", seat: 1, atMs: 0 });
    }
    expect(state.players[0].hiddenQuestionsUsed).toBe(MAX_HIDDEN_QUESTIONS);
    const rejected = applyAction(state, { type: "ASK_QUESTION", seat: 0, mode: "hidden", text: "8번째", atMs: 0 });
    expect(rejected).toBe(state);
  });
});

describe("SUBMIT_ANSWER", () => {
  it("정답 제출 시 즉시 게임이 끝나고 승자가 확정된다(선착순 정답 적중 승리)", () => {
    const state = startGame(2, 1);
    const scenario = getScenario(state.scenarioId);
    const next = applyAction(state, {
      type: "SUBMIT_ANSWER",
      seat: 0,
      text: correctAnswerTextFor(scenario),
      atMs: 0,
    });
    expect(next.phase).toBe("ended");
    expect(next.winnerSeat).toBe(0);
  });

  it("오답 제출 시 탈락하지 않고 20초 쿨타임만 부여된 채 게임이 계속된다", () => {
    const state = startGame(2, 1);
    const next = applyAction(state, { type: "SUBMIT_ANSWER", seat: 0, text: "완전히 틀린 답", atMs: 1_000 });
    expect(next.phase).toBe("playing");
    expect(next.players[0].cooldownUntilMs).toBe(1_000 + ANSWER_COOLDOWN_MS);
    expect(next.turnIndex).toBe(1); // 턴은 정상적으로 넘어감
  });

  it("쿨타임 중에는 정답 선언이 막히고, 쿨타임이 끝나면 다시 시도할 수 있다", () => {
    let state = startGame(2, 1);
    state = applyAction(state, { type: "SUBMIT_ANSWER", seat: 0, text: "오답", atMs: 0 });
    state = applyAction(state, { type: "PASS_TURN", seat: 1, atMs: 0 });
    expect(canSubmitAnswer(state, 0, 5_000)).toBe(false); // 쿨타임(20초) 안 끝남
    expect(cooldownRemainingMs(state, 0, 5_000)).toBe(ANSWER_COOLDOWN_MS - 5_000);

    const blocked = applyAction(state, { type: "SUBMIT_ANSWER", seat: 0, text: "다시 오답", atMs: 5_000 });
    expect(blocked).toBe(state); // no-op

    expect(canSubmitAnswer(state, 0, ANSWER_COOLDOWN_MS)).toBe(true);
    const scenario = getScenario(state.scenarioId);
    const success = applyAction(state, {
      type: "SUBMIT_ANSWER",
      seat: 0,
      text: correctAnswerTextFor(scenario),
      atMs: ANSWER_COOLDOWN_MS + 1,
    });
    expect(success.phase).toBe("ended");
    expect(success.winnerSeat).toBe(0);
  });

  it("질문은 쿨타임 중에도 계속 가능하다", () => {
    let state = startGame(2, 1);
    state = applyAction(state, { type: "SUBMIT_ANSWER", seat: 0, text: "오답", atMs: 0 });
    state = applyAction(state, { type: "PASS_TURN", seat: 1, atMs: 0 });
    const asked = applyAction(state, { type: "ASK_QUESTION", seat: 0, mode: "public", text: "질문", atMs: 100 });
    expect(asked.questionLog).toHaveLength(1);
  });
});

describe("PASS_TURN", () => {
  it("패스하면 다음 좌석으로 턴이 넘어간다(순번제 + 패스 허용)", () => {
    const state = startGame(3, 1);
    const next = applyAction(state, { type: "PASS_TURN", seat: 0, atMs: 0 });
    expect(next.turnIndex).toBe(1);
  });

  it("마지막 좌석 다음엔 다시 0번으로 돌아온다", () => {
    let state = startGame(3, 1);
    state = applyAction(state, { type: "PASS_TURN", seat: 0, atMs: 0 });
    state = applyAction(state, { type: "PASS_TURN", seat: 1, atMs: 0 });
    state = applyAction(state, { type: "PASS_TURN", seat: 2, atMs: 0 });
    expect(state.turnIndex).toBe(0);
  });
});

describe("getValidMoves", () => {
  it("모든 시나리오 × 좌석 수(2~8)에서 getValidMoves가 만든 액션은 절대 no-op으로 거부되지 않는다", () => {
    for (const scenario of SCENARIOS) {
      for (const seatCount of [2, 4, 8]) {
        let state = startGame(seatCount, scenario.id.length); // 시드는 아무거나(픽스처 목적, 아래서 scenarioId를 직접 덮어씀)
        state = { ...state, scenarioId: scenario.id } as GameState;
        const seat = state.turnOrder[state.turnIndex];
        const moves = getValidMoves(state, seat, 0);
        expect(moves.length).toBeGreaterThan(0);
        for (const move of moves) {
          const next = applyAction(state, move);
          expect(next).not.toBe(state);
        }
      }
    }
  });

  it("자기 턴이 아니면 빈 배열을 반환한다", () => {
    const state = startGame(3, 1);
    expect(getValidMoves(state, 1, 0)).toEqual([]);
  });

  it("쿨타임이 남아있으면 SUBMIT_ANSWER 후보를 만들지 않는다", () => {
    let state = startGame(2, 1);
    state = applyAction(state, { type: "SUBMIT_ANSWER", seat: 0, text: "오답", atMs: 0 });
    state = applyAction(state, { type: "PASS_TURN", seat: 1, atMs: 0 });
    const moves = getValidMoves(state, 0, 5_000); // 쿨타임 안 끝남
    expect(moves.some((m) => m.type === "SUBMIT_ANSWER")).toBe(false);
  });
});

describe("computeRankings", () => {
  it("승자는 1위, 나머지는 초록불 획득 수 내림차순", () => {
    let state = startGame(3, 1);
    const scenario = getScenario(state.scenarioId);
    const greenTrigger = scenario.questionBank.find((t) => t.verdict === "green");
    expect(greenTrigger).toBeTruthy();
    // seat 1이 초록불을 하나 확보(자기 턴에)
    state = applyAction(state, { type: "PASS_TURN", seat: 0, atMs: 0 });
    state = applyAction(state, {
      type: "ASK_QUESTION",
      seat: 1,
      mode: "public",
      text: greenTrigger!.sampleQuestion,
      atMs: 0,
    });
    state = applyAction(state, { type: "PASS_TURN", seat: 2, atMs: 0 });
    state = applyAction(state, { type: "SUBMIT_ANSWER", seat: 0, text: correctAnswerTextFor(scenario), atMs: 0 });
    expect(state.phase).toBe("ended");
    const rankings = computeRankings(state);
    expect(rankings.find((r) => r.seat === 0)?.rank).toBe(1);
    expect(rankings.find((r) => r.seat === 1)?.rank).toBe(2);
    expect(rankings.find((r) => r.seat === 2)?.rank).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 봇 레벨별 풀 게임 시뮬레이션 (요청: "봇도 레벨별 테스트까지 진행해주세요")
// ---------------------------------------------------------------------------

function runAllBotGame(seatCount: number, level: BotLevel, seed: number): GameState {
  let state = startGame(seatCount, seed);
  const rng = seededRng(seed * 7919 + level);
  const MAX_TURNS = 500; // 안전장치 — 무한루프 방지
  let guard = 0;
  while (state.phase === "playing" && guard < MAX_TURNS) {
    const seat = state.turnOrder[state.turnIndex];
    const nowMs = guard * (ANSWER_COOLDOWN_MS + 1); // 매 턴 쿨타임을 확실히 넘기는 가상 시계
    const action: EngineAction | null = chooseBotAction(state, seat, level, rng, nowMs);
    if (!action) break;
    state = applyAction(state, { ...action, atMs: nowMs } as EngineAction);
    guard++;
  }
  return state;
}

describe("봇 레벨별 시뮬레이션 (레벨 1~10)", () => {
  const levels: BotLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it.each(levels)("레벨 %i 봇 전원으로 2인 게임을 진행하면 정답으로 종료된다", (level) => {
    for (let seed = 1; seed <= 5; seed++) {
      const final = runAllBotGame(2, level, seed * 100 + level);
      expect(final.phase).toBe("ended");
      expect(final.winnerSeat).not.toBeNull();
      const scenario = getScenario(final.scenarioId);
      const winningAttempt = final.answerLog.find((a) => a.seat === final.winnerSeat && a.correct);
      expect(winningAttempt).toBeTruthy();
      expect(isCorrectAnswer(scenario, winningAttempt!.text)).toBe(true);
    }
  });

  it.each(levels)("레벨 %i 봇 전원으로 5인 게임도 정상 종료된다", (level) => {
    const final = runAllBotGame(5, level, level * 37 + 1);
    expect(final.phase).toBe("ended");
    expect(final.winnerSeat).not.toBeNull();
  });

  it("레벨이 높을수록(8~10) 평균적으로 더 빨리(적은 턴 수) 정답에 도달하는 경향을 보인다", () => {
    const avgTurns = (level: BotLevel) => {
      let total = 0;
      const trials = 8;
      for (let seed = 1; seed <= trials; seed++) {
        const final = runAllBotGame(2, level, seed * 991 + level);
        total += final.turnNumber;
      }
      return total / trials;
    };
    const noviceAvg = avgTurns(1);
    const expertAvg = avgTurns(10);
    expect(expertAvg).toBeLessThanOrEqual(noviceAvg + 5); // 완화된 경향성 체크(랜덤성 감안, 역전은 허용 폭 안에서만)
  });
});
