"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import type { AnswerAttemptEntry, QuestionLogEntry } from "./engine";

/**
 * 게임 종료 시 종합 복기 모달 — 2개 탭.
 *  - 🟡 노란불 복기: 판 전체에서 나온 모든 노란불 판정을 모아 "어느 구절이 맞았고
 *    어떤 부분이 틀렸는지"(트리거의 `yellowDetail`)를 짚어준다(기존 기능, 파일만
 *    이 컴포넌트로 흡수 — `git mv YellowLightReviewModal.tsx GameReviewModal.tsx`).
 *  - 🎯 정답 히스토리(신규, 2026-09-03 세션): 판 전체의 모든 "정답 선언(정답
 *    도전)" 시도를 시간순 타임라인 카드로 모아, 오답이면 왜 틀렸는지
 *    (`AnswerAttemptEntry.failureReason` — `engine.ts`의 `computeFailureReason`,
 *    `answerRequiredKeywordGroups` 라벨 결여 비교 방식으로 자동 생성 — 시나리오별
 *    오답 유형 DB를 새로 쓰지 않기로 AskUserQuestion에서 확정), 최종 정답 시도는
 *    사건의 진실 전문(`scenario.truth`)을 보여준다.
 *
 * 두 탭을 별도 모달로 쪼개지 않고 하나로 묶은 것도 AskUserQuestion으로 확정한
 * 결정이다 — 요청서 문구("기존 노란불 복기와 함께 탭/섹션 노출")와 일치하고, 정답
 * 시도가 있으면(항상 최소 1건 — 승리 시도 — 존재) 그 탭을 기본으로 연다.
 *
 * 2026-09-10 세션 수정 — 종료 후 분석이 안 된다는 실사용자 피드백으로, 예전의
 * `TaxHighlightModal.tsx` 스타일 "HOLD_MS 후 자동 닫힘"을 이 모달에서는 완전히
 * 제거했다(자동 닫힘 타이머, 배경 클릭 닫힘 전부 삭제). 오직 사용자가 우측 상단
 * `✕` 또는 하단 "복기 종료 및 로비로 이동" 버튼을 직접 눌러야만 닫힌다 — `✕`는
 * 모달만 닫고(종료 화면에 남아 "결과 확정하고 계속하기"를 따로 누를 수 있음),
 * 하단 버튼은 모달을 닫으면서 곧장 로비 이동(`onExitToLobby`)까지 이어준다.
 *
 * 히든 질문 내용은 게임이 끝난 뒤엔 전면 공개한다(`engine.ts`의
 * `visibleQuestionText` — phase가 "ended"면 항상 원문 반환). 정답 시도(`answerLog`)
 * 텍스트는 애초에 히든 마스킹 대상이 아니었으므로 그대로 노출한다.
 */

export interface YellowReviewItem {
  entry: QuestionLogEntry;
  askerName: string;
}

export interface AnswerReviewItem {
  entry: AnswerAttemptEntry;
  name: string;
  avatar?: string | null;
}

type Tab = "yellow" | "answers";

export default function GameReviewModal({
  yellowItems,
  answerItems,
  scenarioTruth,
  onDone,
  onExitToLobby,
}: {
  yellowItems: YellowReviewItem[];
  answerItems: AnswerReviewItem[];
  /** 최종 정답 카드에 노출할 사건의 진실 전문(scenario.truth). */
  scenarioTruth: string;
  /** 모달만 닫는다(종료 화면에는 그대로 남는다) — 우측 상단 ✕ 전용. */
  onDone: () => void;
  /** 하단 "복기 종료 및 로비로 이동" 전용 — 모달을 닫으면서 곧장 로비로 나간다. */
  onExitToLobby: () => void;
}) {
  const hasClosedRef = useRef(false);
  const [tab, setTab] = useState<Tab>(answerItems.length > 0 ? "answers" : "yellow");

  function close() {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;
    onDone();
  }

  function exitToLobby() {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;
    onExitToLobby();
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    // 2026-09-10 세션: 자동 닫힘 타이머·배경 클릭 닫힘 전부 제거 — 아래 두 버튼을
    // 직접 눌러야만 닫힌다(실사용자 피드백: 복기 분석이 끝나기 전에 저절로 닫혔음).
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      style={{ animation: "hill-of-truth-modal-in 0.3s ease-out both" }}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-hidden rounded-3xl border-2 border-amber-400/60 bg-slate-950 px-5 py-6 shadow-[0_0_80px_-10px_rgba(0,0,0,0.9)] sm:px-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="복기 리포트 닫기"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-sm text-white/60 transition hover:border-white/30 hover:text-white"
        >
          ✕
        </button>

        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-3xl">🔍📋👑</span>
          <h2 className="break-keep text-lg font-black text-amber-100 sm:text-xl">종합 복기 리포트</h2>
          <p className="break-keep text-xs text-white/50">이번 판의 판정과 정답 선언 히스토리를 되짚어봅니다.</p>
        </div>

        <div className="flex gap-1.5 rounded-full border border-white/10 bg-white/[0.03] p-1 text-xs">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTab("answers");
            }}
            className={`flex-1 rounded-full px-3 py-1.5 font-bold transition ${
              tab === "answers" ? "bg-amber-400 text-slate-950" : "text-white/60 hover:text-white/80"
            }`}
          >
            🎯 정답 히스토리 ({answerItems.length})
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTab("yellow");
            }}
            className={`flex-1 rounded-full px-3 py-1.5 font-bold transition ${
              tab === "yellow" ? "bg-amber-400 text-slate-950" : "text-white/60 hover:text-white/80"
            }`}
          >
            🟡 노란불 복기 ({yellowItems.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {tab === "yellow" ? (
            yellowItems.length === 0 ? (
              <p className="break-keep py-6 text-center text-sm text-white/40">이번 판에는 노란불 판정이 없었습니다.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {yellowItems.map(({ entry, askerName }, i) => (
                  <li key={entry.id} className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
                    <p className="flex items-center gap-2 text-xs text-amber-200/70">
                      <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-bold">#{i + 1}</span>
                      <span className="break-keep font-semibold">{askerName}</span>
                      {entry.mode === "hidden" && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">🔒 히든 질문이었음</span>
                      )}
                    </p>
                    <p className="mt-1.5 break-keep text-sm text-white/90">&ldquo;{entry.text}&rdquo;</p>
                    <p className="mt-2 break-keep rounded-lg bg-black/30 px-2.5 py-2 text-xs leading-relaxed text-amber-100/85">
                      🟡 {entry.yellowDetail}
                    </p>
                  </li>
                ))}
              </ol>
            )
          ) : answerItems.length === 0 ? (
            <p className="break-keep py-6 text-center text-sm text-white/40">이번 판에는 정답 선언 시도가 없었습니다.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {answerItems.map(({ entry, name, avatar }, i) => (
                <li
                  key={entry.id}
                  className={
                    entry.correct
                      ? "rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-400/15 via-amber-300/5 to-transparent p-3 shadow-[0_0_36px_-6px_rgba(250,204,21,0.65)]"
                      : "rounded-2xl border-2 border-rose-500/50 bg-rose-500/[0.06] p-3"
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        entry.correct ? "bg-amber-300 text-slate-950" : "bg-rose-500/20 text-rose-200"
                      }`}
                    >
                      {entry.correct ? "👑 정답 적중 / 최종 승리" : "❌ 오답"}
                    </span>
                    <span className="break-keep text-[11px] text-white/40">
                      #{i + 1} · {entry.turnNumber}턴째
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Avatar src={avatar} size={20} />
                    <span className="break-keep text-xs font-semibold text-white/70">{name}</span>
                  </div>
                  <p className="mt-1.5 break-keep text-sm text-white/90">&ldquo;{entry.text}&rdquo;</p>
                  {entry.correct ? (
                    <div className="mt-2 rounded-lg bg-black/30 px-2.5 py-2">
                      <p className="text-[10px] font-bold text-amber-300/90">📖 사건의 진실</p>
                      <p className="mt-1 break-keep text-xs leading-relaxed text-amber-100/90">{scenarioTruth}</p>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-lg bg-black/30 px-2.5 py-2">
                      <p className="text-[10px] font-bold text-rose-300/90">🔍 오답 사유 분석</p>
                      <p className="mt-1 break-keep text-xs leading-relaxed text-rose-100/85">{entry.failureReason}</p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            exitToLobby();
          }}
          className="relative z-10 mx-auto flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-slate-900/85 px-6 py-2.5 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:border-amber-300/70 hover:bg-slate-900 active:scale-95"
        >
          🏠 복기 종료 및 로비로 이동
        </button>
      </div>
    </div>,
    document.body,
  );
}
