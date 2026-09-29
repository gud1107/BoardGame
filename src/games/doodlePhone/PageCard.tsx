"use client";

import type { ReactNode } from "react";
import DrawingView from "./DrawingView";
import { isBlankDrawing } from "./drawing";
import type { Page } from "./engine";

export function pageRoleLabel(turn: number): string {
  if (turn === 1) return "제시어";
  return turn % 2 === 0 ? "그림" : "추측";
}

/** One album page as shown in the showcase and the results browser. */
export default function PageCard({
  page,
  turn,
  authorName,
  animateMs = 0,
  footer,
}: {
  page: Page | null;
  turn: number;
  authorName: string;
  animateMs?: number;
  footer?: ReactNode;
}) {
  // Parity alone is wrong in the all-drawing modes (turn 3 of 애니메이션 is a drawing, not a guess).
  const role = page === null ? pageRoleLabel(turn) : page.kind === "drawing" ? "그림" : turn === 1 ? "제시어" : "추측";
  // shownPageAt fills a timed-out 애니메이션/보완 page with the previous drawing.
  const repeated = page?.auto === true && page.kind === "drawing" && !isBlankDrawing(page.drawing);
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm">
      <header className="flex items-center gap-2 text-xs text-white/60 light:text-slate-500">
        <span className="rounded-full bg-fuchsia-500/20 px-2 py-0.5 font-semibold text-fuchsia-200 light:bg-fuchsia-100 light:text-fuchsia-700">
          {turn}. {role}
        </span>
        <span className="font-semibold text-white/85 light:text-slate-800">{authorName}</span>
        {page?.auto && (
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200 light:bg-amber-100 light:text-amber-700" title="시간 안에 제출되지 않아 자동으로 채워졌어요">
            ⏰ 자동
          </span>
        )}
        {repeated && (
          <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-semibold text-sky-200 light:bg-sky-100 light:text-sky-700" title="시간 안에 그리지 못해 앞 그림을 그대로 이어받았어요">
            🔁 앞 프레임 반복
          </span>
        )}
      </header>
      {page === null ? (
        <p className="py-6 text-center text-sm text-white/40 light:text-slate-400">불러오는 중…</p>
      ) : page.kind === "text" ? (
        <p className="rounded-xl bg-white/5 px-4 py-3 text-center text-lg font-bold break-keep text-white light:bg-slate-50 light:text-slate-900">“{page.text}”</p>
      ) : (
        <DrawingView drawing={page.drawing} animateMs={animateMs} label={`${authorName}의 그림`} />
      )}
      {footer}
    </article>
  );
}
