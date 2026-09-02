"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QuestionLogEntry } from "./engine";

/**
 * 게임 종료 시 "노란불 복기 리포트" — 판 전체에서 나온 모든 🟡 노란불 판정을 모아,
 * 각각 "어느 구절이 맞았고 어떤 부분이 틀렸는지"(트리거의 `yellowDetail`)를 짚어준다.
 * 요청서의 "3초 유지 + 직하단 스킵 버튼" 컨벤션을 `TaxHighlightModal.tsx`(2026-09-01
 * 세션에서 확립된 이 프로젝트의 표준 하이라이트 팝업 패턴)와 동일하게 그대로 재사용:
 * `HOLD_MS` 후 자동 닫힘, 스킵 버튼은 언제든 즉시 닫힘. 노란불이 여러 건이면 3초 만에
 * 다 읽기 어려울 수 있어(리스트형 리포트라 단발성 팝업과 성격이 다름), 게임오버 화면에
 * "복기 리포트 다시보기" 버튼으로 재오픈할 수 있게 했다(HillOfTruthBoard.tsx) — 스펙에
 * 없는 추가지만 3초 제한과 모순되지 않는 최소한의 보완이라 판단해 포함했다.
 *
 * 히든 질문이었던 항목도 게임이 끝난 뒤엔 전면 공개한다(`engine.ts`의
 * `visibleQuestionText` — phase가 "ended"면 항상 원문 반환 — 참고).
 */
const HOLD_MS = 3000;

export interface YellowReviewItem {
  entry: QuestionLogEntry;
  askerName: string;
}

export default function YellowLightReviewModal({
  items,
  onDone,
}: {
  items: YellowReviewItem[];
  onDone: () => void;
}) {
  const hasClosedRef = useRef(false);
  const [holdElapsed, setHoldElapsed] = useState(false);

  function close() {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;
    onDone();
  }

  useEffect(() => {
    const holdTimer = setTimeout(() => setHoldElapsed(true), HOLD_MS);
    const closeTimer = setTimeout(close, HOLD_MS);
    return () => {
      clearTimeout(holdTimer);
      clearTimeout(closeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만(TaxHighlightModal.tsx와 동일한 패턴)
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      style={{ animation: "hill-of-truth-modal-in 0.3s ease-out both" }}
      onClick={holdElapsed ? close : undefined}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-hidden rounded-3xl border-2 border-amber-400/60 bg-slate-950 px-5 py-6 shadow-[0_0_80px_-10px_rgba(0,0,0,0.9)] sm:px-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-3xl">🟡📋🟡</span>
          <h2 className="break-keep text-lg font-black text-amber-100 sm:text-xl">노란불 복기 리포트</h2>
          <p className="break-keep text-xs text-white/50">이번 판에서 나온 모든 노란불 판정을 되짚어봅니다.</p>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <p className="break-keep py-6 text-center text-sm text-white/40">이번 판에는 노란불 판정이 없었습니다.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {items.map(({ entry, askerName }, i) => (
                <li key={entry.id} className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
                  <p className="flex items-center gap-2 text-xs text-amber-200/70">
                    <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-bold">#{i + 1}</span>
                    <span className="break-keep font-semibold">{askerName}</span>
                    {entry.mode === "hidden" && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">🔒 히든 질문이었음</span>}
                  </p>
                  <p className="mt-1.5 break-keep text-sm text-white/90">&ldquo;{entry.text}&rdquo;</p>
                  <p className="mt-2 break-keep rounded-lg bg-black/30 px-2.5 py-2 text-xs leading-relaxed text-amber-100/85">
                    🟡 {entry.yellowDetail}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          className="relative z-10 mx-auto flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-slate-900/85 px-6 py-2.5 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:border-amber-300/70 hover:bg-slate-900 active:scale-95"
          aria-label="노란불 복기 리포트 스킵"
        >
          ⏩ 스킵
        </button>
      </div>
    </div>,
    document.body,
  );
}
