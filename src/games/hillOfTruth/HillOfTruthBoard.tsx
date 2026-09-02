"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import {
  ANSWER_COOLDOWN_MS,
  MAX_HIDDEN_QUESTIONS,
  canAskQuestion,
  canSubmitAnswer,
  cooldownRemainingMs,
  visibleQuestionText,
  type EngineAction,
  type GameState,
  type QuestionMode,
  type Seat,
} from "./engine";
import { getScenario } from "./scenarios";
import InvestigationPanel from "./InvestigationPanel";
import GameReviewModal, { type AnswerReviewItem, type YellowReviewItem } from "./GameReviewModal";
import RulebookModal from "./RulebookModal";

const VERDICT_META = {
  green: { label: "초록불", ring: "shadow-[0_0_28px_8px_rgba(52,211,153,0.55)]", dot: "bg-emerald-400" },
  yellow: { label: "노란불", ring: "shadow-[0_0_28px_8px_rgba(250,204,21,0.55)]", dot: "bg-amber-400" },
  red: { label: "빨간불", ring: "shadow-[0_0_28px_8px_rgba(244,63,94,0.55)]", dot: "bg-rose-500" },
} as const;

function SignalLight({ verdict, flashKey }: { verdict: "green" | "yellow" | "red" | null; flashKey: number }) {
  const lights: ("red" | "yellow" | "green")[] = ["red", "yellow", "green"];
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-slate-900/80 px-5 py-4">
        {lights.map((color) => {
          const isLit = verdict === color;
          return (
            <span
              key={`${color}-${flashKey}`}
              className={`h-9 w-9 rounded-full border-2 border-white/10 transition-all ${
                isLit ? `${VERDICT_META[color].dot} ${VERDICT_META[color].ring} hill-of-truth-light-flash` : "bg-white/5"
              }`}
            />
          );
        })}
      </div>
      <p className="break-keep text-xs font-semibold text-white/50">{verdict ? `딜러 판정: ${VERDICT_META[verdict].label}` : "딜러 대기 중"}</p>
    </div>
  );
}

export interface HillOfTruthBoardProps {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  avatars?: Record<Seat, string | null | undefined>;
  connectedSeats: Set<Seat>;
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

export default function HillOfTruthBoard({
  state,
  viewerSeat,
  names,
  avatars,
  connectedSeats,
  nowMs,
  onAction,
  onGameEnd,
}: HillOfTruthBoardProps) {
  const scenario = getScenario(state.scenarioId);
  const [askText, setAskText] = useState("");
  const [askMode, setAskMode] = useState<QuestionMode>("public");
  const [answerText, setAnswerText] = useState("");
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewAutoShownRef = useRef(false);

  const isMyTurn = state.phase === "playing" && state.turnOrder[state.turnIndex] === viewerSeat;
  const myPlayer = state.players.find((p) => p.seat === viewerSeat)!;
  const hiddenRemaining = MAX_HIDDEN_QUESTIONS - myPlayer.hiddenQuestionsUsed;
  const cooldownMs = cooldownRemainingMs(state, viewerSeat, nowMs);
  const cooldownSeconds = Math.ceil(cooldownMs / 1000);
  const canSubmit = canSubmitAnswer(state, viewerSeat, nowMs);
  const canAskPublic = canAskQuestion(state, viewerSeat, "public");
  const canAskHidden = canAskQuestion(state, viewerSeat, "hidden");

  const latestEntry = state.questionLog[state.questionLog.length - 1] ?? null;

  // 판정 색상이 새로 나올 때마다(로그 길이 변화) 전원의 화면에서 동일하게 사운드 재생 —
  // dalmuti의 "상태 변화 자체를 감지해 재생" 컨벤션과 동일(본인 dispatch에만 의존하지 않음).
  const lastPlayedLenRef = useRef(state.questionLog.length);
  useEffect(() => {
    if (state.questionLog.length <= lastPlayedLenRef.current) {
      lastPlayedLenRef.current = state.questionLog.length;
      return;
    }
    lastPlayedLenRef.current = state.questionLog.length;
    const verdict = latestEntry?.verdict;
    const engine = getSoundEngine();
    if (verdict === "green") engine.playCorrectDing();
    else if (verdict === "red") engine.playWrongBuzz();
    else if (verdict === "yellow") engine.playTieSpark();
  }, [state.questionLog.length, latestEntry]);

  // 게임이 끝나면 노란불 복기 리포트를 자동으로 1회만 연다.
  useEffect(() => {
    if (state.phase === "ended" && !reviewAutoShownRef.current) {
      reviewAutoShownRef.current = true;
      setReviewOpen(true);
    }
  }, [state.phase]);

  function submitAsk() {
    const text = askText.trim();
    if (!text) return;
    onAction({ type: "ASK_QUESTION", seat: viewerSeat, mode: askMode, text, atMs: 0 });
    setAskText("");
  }

  function submitAnswer() {
    const text = answerText.trim();
    if (!text) return;
    onAction({ type: "SUBMIT_ANSWER", seat: viewerSeat, text, atMs: 0 });
    setAnswerText("");
  }

  function pass() {
    onAction({ type: "PASS_TURN", seat: viewerSeat, atMs: 0 });
  }

  const reviewItems: YellowReviewItem[] = state.questionLog
    .filter((e) => e.verdict === "yellow")
    .map((entry) => ({ entry, askerName: names[entry.seat] ?? `${entry.seat + 1}번` }));

  // 🎯 정답 선언 히스토리 — 종합 복기 모달의 두 번째 탭(GameReviewModal.tsx)에 그대로 전달.
  const answerReviewItems: AnswerReviewItem[] = state.answerLog.map((entry) => ({
    entry,
    name: names[entry.seat] ?? `${entry.seat + 1}번`,
    avatar: avatars?.[entry.seat],
  }));

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/60">
          {scenario.type === "A" ? "🎬 유형 A · 원작 헌정" : "📚 유형 B · 검증 시나리오"}
        </span>
        <button
          onClick={() => setRulebookOpen(true)}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/30"
        >
          📖 룰북
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="break-keep text-lg font-black text-white">{scenario.title}</h2>
        <p className="mt-1.5 break-keep text-sm leading-relaxed text-white/60">{scenario.synopsis}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {state.turnOrder.map((seat) => {
          const player = state.players.find((p) => p.seat === seat)!;
          const active = state.phase === "playing" && state.turnOrder[state.turnIndex] === seat;
          const connected = connectedSeats.has(seat);
          return (
            <div
              key={seat}
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs ${
                active ? "border-cyan-400/60 bg-cyan-400/10" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <div className="relative">
                <Avatar src={avatars?.[seat]} size={26} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-950 ${connected ? "bg-emerald-400" : "bg-white/20"}`}
                />
              </div>
              <span className={`break-keep font-semibold ${active ? "text-cyan-200" : "text-white/70"}`}>
                {seat === viewerSeat ? `나 (${names[seat]})` : names[seat]}
              </span>
              {seat === viewerSeat && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">🔒{player.hiddenQuestionsUsed}/{MAX_HIDDEN_QUESTIONS}</span>
              )}
            </div>
          );
        })}
      </div>

      <SignalLight verdict={latestEntry?.verdict ?? null} flashKey={state.questionLog.length} />

      <div className="flex max-h-64 flex-col-reverse gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-3">
        {state.questionLog.length === 0 && <p className="break-keep text-center text-xs text-white/30">아직 나온 질문이 없습니다.</p>}
        {[...state.questionLog].reverse().map((entry) => {
          const text = visibleQuestionText(entry, viewerSeat, state.phase);
          const masked = entry.mode === "hidden" && !text;
          const meta = VERDICT_META[entry.verdict];
          return (
            <div key={entry.id} className="flex items-start gap-2 rounded-xl bg-white/[0.02] px-3 py-2">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/40">
                  <span className="break-keep font-semibold text-white/60">{names[entry.seat] ?? `${entry.seat + 1}번`}</span>
                  {entry.mode === "hidden" && <span className="rounded bg-white/10 px-1.5 py-0.5">🔒 히든</span>}
                  <span>{meta.label}</span>
                </p>
                <p className="break-keep text-sm text-white/85">{masked ? "🔒 비공개 질문입니다 (판정 색상만 공개)" : text}</p>
                {state.phase === "ended" && entry.verdict === "yellow" && entry.yellowDetail && (
                  <p className="mt-1 break-keep rounded bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200/80">🟡 {entry.yellowDetail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {state.phase === "playing" && (
        <div className={`flex flex-col gap-3 rounded-2xl border p-4 ${isMyTurn ? "border-cyan-400/40 bg-cyan-400/[0.04]" : "border-white/10 bg-white/[0.02]"}`}>
          <p className="break-keep text-sm font-bold text-white">
            {isMyTurn ? "🎯 당신의 차례입니다" : `⏳ ${names[state.turnOrder[state.turnIndex]] ?? "상대"}님의 차례를 기다리는 중...`}
          </p>

          {isMyTurn && (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex overflow-hidden rounded-full border border-white/15 text-xs">
                    <button
                      onClick={() => setAskMode("public")}
                      className={`px-3 py-1.5 font-semibold ${askMode === "public" ? "bg-cyan-500 text-slate-950" : "text-white/60"}`}
                    >
                      🌐 공개
                    </button>
                    <button
                      onClick={() => setAskMode("hidden")}
                      disabled={!canAskHidden}
                      className={`px-3 py-1.5 font-semibold disabled:opacity-30 ${askMode === "hidden" ? "bg-fuchsia-500 text-slate-950" : "text-white/60"}`}
                    >
                      🔒 히든
                    </button>
                  </div>
                  <span className="break-keep text-[11px] text-white/50">히든 질문 {hiddenRemaining}/{MAX_HIDDEN_QUESTIONS}회 남음</span>
                </div>
                <div className="flex gap-2">
                  <input
                    value={askText}
                    onChange={(e) => setAskText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) submitAsk();
                    }}
                    placeholder="예: 범인은 OO입니까?"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    onClick={submitAsk}
                    disabled={(askMode === "public" ? !canAskPublic : !canAskHidden) || !askText.trim()}
                    className="shrink-0 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-30"
                  >
                    질문하기
                  </button>
                </div>
              </div>

              <div className="flex gap-2 border-t border-white/10 pt-3">
                <input
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) submitAnswer();
                  }}
                  placeholder="사건의 진상을 문장으로 제출하세요"
                  className="min-w-0 flex-1 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-amber-400 focus:outline-none"
                />
                <button
                  onClick={submitAnswer}
                  disabled={!canSubmit || !answerText.trim()}
                  className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
                >
                  {canSubmit ? "🙋 정답 선언" : (
                    <span className="hill-of-truth-cooldown-pulse">⏳ {cooldownSeconds}초</span>
                  )}
                </button>
              </div>
              {!canSubmit && cooldownSeconds > 0 && (
                <p className="break-keep text-[11px] text-amber-300/70">
                  직전 오답으로 {ANSWER_COOLDOWN_MS / 1000}초 쿨타임이 적용 중입니다 — 질문은 계속 할 수 있어요.
                </p>
              )}

              <button onClick={pass} className="self-start rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/60 hover:border-white/30">
                ⏭️ 이번 턴 패스
              </button>
            </>
          )}
        </div>
      )}

      {state.phase === "ended" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-5 text-center">
          <span className="text-3xl">🏆</span>
          <p className="break-keep text-base font-bold text-white">
            {state.winnerSeat !== null ? `${names[state.winnerSeat]}님이 진실을 밝혀냈습니다!` : "게임 종료"}
          </p>
          <div className="w-full rounded-xl bg-black/20 p-3 text-left">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-white/40 uppercase">사건의 진실</p>
            <p className="break-keep text-sm leading-relaxed text-white/80">{scenario.truth}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setReviewOpen(true)}
              className="rounded-xl border border-amber-400/40 px-4 py-2 text-sm text-amber-200 hover:border-amber-300/60"
            >
              🔍 복기 리포트 다시보기
            </button>
            <button onClick={onGameEnd} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
              결과 확정하고 계속하기
            </button>
          </div>
        </div>
      )}

      <InvestigationPanel scenario={scenario} />
      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      {reviewOpen && (
        <GameReviewModal
          yellowItems={reviewItems}
          answerItems={answerReviewItems}
          scenarioTruth={scenario.truth}
          onDone={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
