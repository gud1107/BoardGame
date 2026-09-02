/**
 * 진실의 고개 — 순수 규칙 엔진.
 *
 * ARCHITECTURE.md §1 계약: React/네트워크/`Date.now()`/`Math.random()`을
 * 직접 호출하지 않는다. 벽시계 시간이 필요한 곳(쿨타임)은 액션에 `atMs`를
 * 실어 전달한다(§1 예시로 언급된 틀린 그림 찾기의 오답 페널티 잠금과 동일한
 * 패턴). `getValidMoves`도 쿨타임 판정을 위해 `nowMs`를 명시적으로 받는다 —
 * 호출자(주로 `chooseBotAction`, 기본값 `Date.now()`)가 시간을 주입하며,
 * `applyAction` 자체는 여전히 벽시계를 직접 읽지 않는다. 딜러는 사람이
 * 아니라 이 엔진 자체다 — `scenarios.ts`의 `questionBank` 데이터만으로
 * 신호등을 순수 함수로 판정한다(외부 API 호출 0).
 *
 * 2026-09-02 세션 확정 규칙(구버전 룰북과의 차이, AskUserQuestion으로 확인):
 *  - 오답 즉시 패배 폐지 → 오답 시 20초 쿨타임(정답 선언 버튼만 잠김, 질문은 계속 가능).
 *  - 선착순 정답 적중 승리제(여러 플레이어가 여러 턴에 걸쳐 시도 가능, 첫 정답이 즉시 승리).
 *  - 다인 플레이(2~8인), 순번제(라운드 로빈)지만 자기 턴에 패스 가능.
 *  - 히든 질문은 플레이어당 최대 7회, 질문자+엔진(딜러)만 원문을 알고 판정 색상만 공개.
 */

import { seededRng } from "@/lib/rng";
import { clampBotLevel, pickByLevel, type BotLevel, type ScoredCandidate } from "../shared/bot/botDifficulty";
import { SCENARIOS, getScenario, correctAnswerTextFor, type Scenario, type SemaphoreColor } from "./scenarios";

export const MAX_HIDDEN_QUESTIONS = 7;
export const ANSWER_COOLDOWN_MS = 20_000;
/** 봇이 정답을 선언하기 전 최소로 쌓아야 하는 "본인이 직접 확인한 초록불" 개수(레벨 무관 공통 페이싱). */
const BOT_MIN_GREEN_BEFORE_GUESS = 2;

export type Seat = number;

export type QuestionMode = "public" | "hidden";

export interface QuestionLogEntry {
  readonly id: string;
  readonly seat: Seat;
  readonly mode: QuestionMode;
  readonly text: string;
  readonly triggerId: string | null;
  readonly verdict: SemaphoreColor;
  readonly yellowDetail?: string;
  readonly turnNumber: number;
}

export interface AnswerAttemptEntry {
  readonly id: string;
  readonly seat: Seat;
  readonly text: string;
  readonly correct: boolean;
  readonly turnNumber: number;
  /** 오답일 때만 채워짐(정답이면 null) — §7 복기 리포트의 "오답 사유 분석" 문구. */
  readonly failureReason: string | null;
}

export interface PlayerState {
  readonly seat: Seat;
  readonly hiddenQuestionsUsed: number;
  /** null이면 쿨타임 없음. 실제 제출 시점의 atMs가 이 값보다 작으면 정답 선언이 막힌다. */
  readonly cooldownUntilMs: number | null;
}

export type Phase = "playing" | "ended";

export interface GameState {
  readonly phase: Phase;
  readonly scenarioId: string;
  readonly seatCount: number;
  readonly players: readonly PlayerState[];
  readonly turnOrder: readonly Seat[];
  readonly turnIndex: number;
  readonly turnNumber: number;
  readonly questionLog: readonly QuestionLogEntry[];
  readonly answerLog: readonly AnswerAttemptEntry[];
  readonly winnerSeat: Seat | null;
  readonly nextLogId: number;
}

export type EngineAction =
  | { type: "ASK_QUESTION"; seat: Seat; mode: QuestionMode; text: string; atMs: number }
  | { type: "SUBMIT_ANSWER"; seat: Seat; text: string; atMs: number }
  | { type: "PASS_TURN"; seat: Seat; atMs: number };

function pickScenario(rng: () => number): Scenario {
  const idx = Math.min(Math.floor(rng() * SCENARIOS.length), SCENARIOS.length - 1);
  return SCENARIOS[idx];
}

export function startGame(seatCount: number, seed: number): GameState {
  // seed로 시나리오를 결정론적으로 롤링(락스텝 계약 — 모든 클라이언트가 같은 시드로
  // 같은 시나리오를 뽑는다). 시드는 여기서만 소비한다.
  const rng = seededRng(seed);
  const scenario = pickScenario(rng);
  const turnOrder = Array.from({ length: seatCount }, (_, i) => i);
  return {
    phase: "playing",
    scenarioId: scenario.id,
    seatCount,
    players: turnOrder.map((seat) => ({ seat, hiddenQuestionsUsed: 0, cooldownUntilMs: null })),
    turnOrder,
    turnIndex: 0,
    turnNumber: 1,
    questionLog: [],
    answerLog: [],
    winnerSeat: null,
    nextLogId: 1,
  };
}

function currentSeat(state: GameState): Seat {
  return state.turnOrder[state.turnIndex];
}

function isSeatTurn(state: GameState, seat: Seat): boolean {
  return state.phase === "playing" && currentSeat(state) === seat;
}

function getPlayer(state: GameState, seat: Seat): PlayerState {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) throw new Error(`Unknown seat: ${seat}`);
  return player;
}

function advanceTurn(state: GameState): { turnIndex: number; turnNumber: number } {
  const turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
  return { turnIndex, turnNumber: state.turnNumber + 1 };
}

function matchTrigger(scenario: Scenario, text: string): Scenario["questionBank"][number] | null {
  const normalized = text.trim();
  if (!normalized) return null;
  // 저장 순서를 우선순위로 취급 — 더 구체적인 트리거를 앞에 배치해 데이터를 작성한다.
  for (const trigger of scenario.questionBank) {
    if (trigger.keywords.some((k) => normalized.includes(k))) return trigger;
  }
  return null;
}

/** 정답 판정: 모든 그룹에서 최소 1개 키워드가 텍스트에 포함돼야 한다. */
export function isCorrectAnswer(scenario: Scenario, text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return scenario.answerRequiredKeywordGroups.every((group) =>
    group.keywords.some((k) => normalized.includes(k)),
  );
}

/**
 * 오답 사유 자동 생성 — 정답 선언 히스토리 복기 리포트용(2026-09-03 세션,
 * AskUserQuestion으로 "키워드 그룹 결여 비교" 방식 확정, 시나리오별 오답 유형 DB는
 * 채택하지 않음). `isCorrectAnswer`와 동일한 `answerRequiredKeywordGroups` 판정
 * 기준을 그대로 재사용해, 어느 라벨(범인/트릭/동기 등)이 통과했고 어느 라벨이
 * 결여됐는지를 순수 함수로 비교한다 — 외부 LLM 호출도, 시나리오별 신규 저작도
 * 필요 없다. 정답인 경우(모든 그룹 통과) null을 반환한다.
 */
export function computeFailureReason(scenario: Scenario, text: string): string | null {
  const normalized = text.trim();
  const matchedLabels: string[] = [];
  const missingLabels: string[] = [];
  for (const group of scenario.answerRequiredKeywordGroups) {
    const hit = normalized.length > 0 && group.keywords.some((k) => normalized.includes(k));
    (hit ? matchedLabels : missingLabels).push(group.label);
  }
  if (missingLabels.length === 0) return null;
  if (matchedLabels.length === 0) {
    return `제출하신 내용은 사건의 핵심 요소(${scenario.answerRequiredKeywordGroups.map((g) => g.label).join("·")}) 중 어느 것과도 일치하지 않았습니다.`;
  }
  return `${matchedLabels.join("·")} 항목은 맞았으나, ${missingLabels.join("·")} 항목이 결여되었거나 일치하지 않았습니다.`;
}

/** seat가 지금 볼 수 있는 질문 텍스트. 판정 색상(verdict)은 히든이라도 항상 전원에게
 * 공개되므로 항상 그대로 두되(로그 자체는 렌더링 여부와 무관하게 모든 클라이언트가
 * 동일하게 계산), `text`만 비참여자에게 마스킹한다 — 아발론 역할 공개와 동일한 "state엔
 * 있지만 UI가 가린다" 패턴(ARCHITECTURE.md 기존 관례). 게임 종료 후에는 전부 공개된다
 * (노란불 복기 리포트 요구사항 — "해당 판에 발생했던 모든 노란불 판정", 2026-09-02
 * 세션에서 "게임 종료 후에는 비밀 유지 의미가 없다"고 판단해 전면 공개로 설계). */
export function visibleQuestionText(entry: QuestionLogEntry, viewerSeat: Seat, phase: Phase): string {
  if (phase === "ended") return entry.text;
  if (entry.mode === "public") return entry.text;
  return entry.seat === viewerSeat ? entry.text : "";
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "ASK_QUESTION": {
      if (!isSeatTurn(state, action.seat)) return state;
      const player = getPlayer(state, action.seat);
      if (action.mode === "hidden" && player.hiddenQuestionsUsed >= MAX_HIDDEN_QUESTIONS) return state;
      const text = action.text.trim();
      if (!text) return state;

      const scenario = getScenario(state.scenarioId);
      const trigger = matchTrigger(scenario, text);
      const verdict: SemaphoreColor = trigger?.verdict ?? "red";

      const entry: QuestionLogEntry = {
        id: `q${state.nextLogId}`,
        seat: action.seat,
        mode: action.mode,
        text,
        triggerId: trigger?.id ?? null,
        verdict,
        yellowDetail: trigger?.yellowDetail,
        turnNumber: state.turnNumber,
      };

      const { turnIndex, turnNumber } = advanceTurn(state);
      return {
        ...state,
        players: state.players.map((p) =>
          p.seat === action.seat && action.mode === "hidden"
            ? { ...p, hiddenQuestionsUsed: p.hiddenQuestionsUsed + 1 }
            : p,
        ),
        questionLog: [...state.questionLog, entry],
        turnIndex,
        turnNumber,
        nextLogId: state.nextLogId + 1,
      };
    }
    case "SUBMIT_ANSWER": {
      if (!isSeatTurn(state, action.seat)) return state;
      const player = getPlayer(state, action.seat);
      if (player.cooldownUntilMs !== null && action.atMs < player.cooldownUntilMs) return state;
      const text = action.text.trim();
      if (!text) return state;

      const scenario = getScenario(state.scenarioId);
      const correct = isCorrectAnswer(scenario, text);
      const attempt: AnswerAttemptEntry = {
        id: `a${state.nextLogId}`,
        seat: action.seat,
        text,
        correct,
        turnNumber: state.turnNumber,
        failureReason: correct ? null : computeFailureReason(scenario, text),
      };

      if (correct) {
        return {
          ...state,
          phase: "ended",
          winnerSeat: action.seat,
          answerLog: [...state.answerLog, attempt],
          nextLogId: state.nextLogId + 1,
        };
      }

      const { turnIndex, turnNumber } = advanceTurn(state);
      return {
        ...state,
        players: state.players.map((p) =>
          p.seat === action.seat ? { ...p, cooldownUntilMs: action.atMs + ANSWER_COOLDOWN_MS } : p,
        ),
        answerLog: [...state.answerLog, attempt],
        turnIndex,
        turnNumber,
        nextLogId: state.nextLogId + 1,
      };
    }
    case "PASS_TURN": {
      if (!isSeatTurn(state, action.seat)) return state;
      const { turnIndex, turnNumber } = advanceTurn(state);
      return { ...state, turnIndex, turnNumber };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// §7 계약: AI 플레이어 지원 (ARCHITECTURE.md)
// ---------------------------------------------------------------------------

/**
 * seat가 지금 제출할 수 있는 대표 합법 액션. `nowMs`는 오직 정답 선언 쿨타임 판정에만
 * 쓰인다(이 함수 자체는 여전히 순수 — 같은 `state`/`seat`/`nowMs` 입력엔 항상 같은
 * 출력). SUBMIT_ANSWER/ASK_QUESTION의 `text`는 자유 텍스트라 전체 열거가 불가능하므로
 * (무한 집합), 여기서는 "봇이 실제로 고를 만한" 대표 후보만 제공한다 — 사람 플레이어는
 * 이 목록에 얽매이지 않고 자체 입력 폼 + `canAskQuestion`/`canSubmitAnswer`로 별도
 * 검증한다. 여기서 만든 액션은 전부 `applyAction`의 가드를 그대로 통과한다(no-op으로
 * 거부되지 않음 — 쿨타임 중엔 SUBMIT_ANSWER 후보 자체를 아예 만들지 않는 것으로 보장).
 */
export function getValidMoves(state: GameState, seat: Seat, nowMs: number): EngineAction[] {
  if (!isSeatTurn(state, seat)) return [];
  const scenario = getScenario(state.scenarioId);
  const player = getPlayer(state, seat);
  const askedTriggerIds = new Set(
    state.questionLog.filter((e) => e.seat === seat && e.triggerId).map((e) => e.triggerId as string),
  );
  const unused = scenario.questionBank.filter((t) => !askedTriggerIds.has(t.id));

  const moves: EngineAction[] = [];
  for (const trigger of unused) {
    moves.push({ type: "ASK_QUESTION", seat, mode: "public", text: trigger.sampleQuestion, atMs: 0 });
    if (player.hiddenQuestionsUsed < MAX_HIDDEN_QUESTIONS) {
      moves.push({ type: "ASK_QUESTION", seat, mode: "hidden", text: trigger.sampleQuestion, atMs: 0 });
    }
  }

  if (canSubmitAnswer(state, seat, nowMs)) {
    moves.push({ type: "SUBMIT_ANSWER", seat, text: correctAnswerTextFor(scenario), atMs: 0 });
  }

  moves.push({ type: "PASS_TURN", seat, atMs: 0 });
  return moves;
}

/** UI 버튼 활성화 판정 헬퍼(사람 플레이어 자유 텍스트 입력용). */
export function canAskQuestion(state: GameState, seat: Seat, mode: QuestionMode): boolean {
  if (!isSeatTurn(state, seat)) return false;
  if (mode === "hidden") return getPlayer(state, seat).hiddenQuestionsUsed < MAX_HIDDEN_QUESTIONS;
  return true;
}

export function canSubmitAnswer(state: GameState, seat: Seat, nowMs: number): boolean {
  if (!isSeatTurn(state, seat)) return false;
  const cooldownUntil = getPlayer(state, seat).cooldownUntilMs;
  return cooldownUntil === null || nowMs >= cooldownUntil;
}

export function cooldownRemainingMs(state: GameState, seat: Seat, nowMs: number): number {
  const cooldownUntil = getPlayer(state, seat).cooldownUntilMs;
  if (cooldownUntil === null) return 0;
  return Math.max(0, cooldownUntil - nowMs);
}

function scoreBotMove(state: GameState, seat: Seat, move: EngineAction, scenario: Scenario, level: BotLevel): number {
  if (move.type === "PASS_TURN") return -100; // 봇은 정말 할 게 없을 때만 패스
  if (move.type === "SUBMIT_ANSWER") {
    const myGreenCount = state.questionLog.filter((e) => e.seat === seat && e.verdict === "green").length;
    // 초록불을 많이 모을수록, 레벨이 높을수록 더 빨리 확신하고 정답을 시도한다.
    // BOT_MIN_GREEN_BEFORE_GUESS 미만이면 점수를 크게 낮춰 무턱대고 찍지 않게 한다.
    const readiness = myGreenCount >= BOT_MIN_GREEN_BEFORE_GUESS ? 0 : -50;
    return readiness + myGreenCount * 20 + level * 3;
  }
  // ASK_QUESTION: 아직 안 물어본 것 중 importance가 높은 트리거를 우선.
  const trigger = scenario.questionBank.find((t) => t.sampleQuestion === move.text);
  const importance = trigger?.importance ?? 1;
  const hiddenBonus = move.mode === "hidden" ? (level >= 6 ? 2 : -1) : 0; // 고레벨은 히든 질문으로 정보 우위를 노림
  return importance * 10 + hiddenBonus;
}

/**
 * getValidMoves 중 최고점 액션을 고른다(동점은 rng로 타이브레이크). seat가 지금 할 게
 * 없으면 null. `nowMs`는 기본 `Date.now()` — 봇 판단은 로컬 UX일 뿐 엔진 결정론
 * 계약(§1) 밖이라는 ARCHITECTURE.md §7.1 원칙을 그대로 따른다(rng와 동일한 취급).
 */
export function chooseBotAction(
  state: GameState,
  seat: Seat,
  level: BotLevel,
  rng: () => number = Math.random,
  nowMs: number = Date.now(),
): EngineAction | null {
  const moves = getValidMoves(state, seat, nowMs);
  if (moves.length === 0) return null;
  const scenario = getScenario(state.scenarioId);
  const lvl = clampBotLevel(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({
    move,
    score: scoreBotMove(state, seat, move, scenario, lvl),
  }));
  return pickByLevel(candidates, lvl, rng);
}

export function isGameOver(state: GameState): boolean {
  return state.phase === "ended";
}

/** 순위 계산 — 승자 1위, 나머지는 초록불 획득 수 내림차순(동률은 좌석 순서, 결정론적). */
export function computeRankings(state: GameState): { seat: Seat; rank: number }[] {
  const greenCounts = new Map<Seat, number>();
  for (const seat of state.turnOrder) greenCounts.set(seat, 0);
  for (const entry of state.questionLog) {
    if (entry.verdict === "green") greenCounts.set(entry.seat, (greenCounts.get(entry.seat) ?? 0) + 1);
  }
  const others = state.turnOrder
    .filter((seat) => seat !== state.winnerSeat)
    .sort((a, b) => (greenCounts.get(b) ?? 0) - (greenCounts.get(a) ?? 0) || a - b);

  const ranked: { seat: Seat; rank: number }[] = [];
  if (state.winnerSeat !== null) ranked.push({ seat: state.winnerSeat, rank: 1 });
  others.forEach((seat, i) => ranked.push({ seat, rank: (state.winnerSeat !== null ? 2 : 1) + i }));
  return ranked;
}
