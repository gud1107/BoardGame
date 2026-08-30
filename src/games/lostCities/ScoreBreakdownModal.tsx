"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import { COLORS, EXPEDITION_THEME, type ExpeditionScoreBreakdown, type Seat } from "./engine";

/**
 * Post-game "색상별 점수 상세 브레이크다운" screen (platform-common result
 * requirement) + a `[⏩ 결과 스킵]` button, matching the spirit of grid-poker's
 * `RoundResultOverlay` skip affordance but scoped to this single-round game's
 * shape: there's no multi-round auto-advance timer to race against here, only
 * a short local reveal animation (colors fade in one at a time) purely so the
 * result doesn't just slam onto the screen — skip just finishes that reveal
 * instantly. Nothing here is network-synced; every viewer's reveal pacing is
 * its own local cosmetic state, since the actual score data is already
 * identical and fully known on every client the instant `gameOver` is
 * reached (engine.ts's `finishGame`).
 */
export interface ScoreBreakdownModalProps {
  names: Record<Seat, string>;
  breakdowns: Record<Seat, ExpeditionScoreBreakdown[]>;
  totals: Record<Seat, number>;
  winner: Seat | null;
  isDraw: boolean;
  viewerSeat: Seat;
  onLeave: () => void;
  onRematch: () => void;
}

const REVEAL_STEP_MS = 350;

function ScoreTable({ name, isViewer, breakdown, total, isWinner }: { name: string; isViewer: boolean; breakdown: ExpeditionScoreBreakdown[]; total: number; isWinner: boolean }) {
  return (
    <div className={`flex flex-1 flex-col gap-2 rounded-xl border p-3 ${isWinner ? "border-amber-400/60 bg-amber-400/10" : "border-white/10 bg-white/[0.04]"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-white">
          <Avatar size={22} />
          <span className="truncate">
            {name}
            {isViewer && <span className="ml-1 text-xs font-normal text-emerald-300">(나)</span>}
          </span>
          {isWinner && <span aria-hidden>👑</span>}
        </span>
        <span className={`shrink-0 text-lg font-extrabold ${total >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{total >= 0 ? `+${total}` : total}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-xs text-white/70">
          <thead>
            <tr className="text-white/40">
              <th className="py-1 text-left font-medium">원정로</th>
              <th className="text-right font-medium">카드</th>
              <th className="text-right font-medium">투자</th>
              <th className="text-right font-medium">숫자합</th>
              <th className="text-right font-medium">배수</th>
              <th className="text-right font-medium">보너스</th>
              <th className="text-right font-medium">소계</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((b) => {
              const theme = EXPEDITION_THEME[b.color];
              return (
                <tr key={b.color} className="border-t border-white/5">
                  <td className="py-1 text-left">
                    {theme.emoji} {theme.name}
                  </td>
                  <td className="text-right">{b.cardCount}</td>
                  <td className="text-right">{b.investCount}</td>
                  <td className="text-right">{b.numberSum}</td>
                  <td className="text-right">×{b.multiplier}</td>
                  <td className="text-right">{b.bonus > 0 ? `+${b.bonus}` : "-"}</td>
                  <td className={`text-right font-semibold ${b.total >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{b.cardCount === 0 ? "0" : b.total >= 0 ? `+${b.total}` : b.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScoreBreakdownModal({ names, breakdowns, totals, winner, isDraw, viewerSeat, onLeave, onRematch }: ScoreBreakdownModalProps) {
  const [revealedCount, setRevealedCount] = useState(0);
  const hasSkippedRef = useRef(false);

  useEffect(() => {
    if (revealedCount >= COLORS.length) return;
    const timer = window.setTimeout(() => setRevealedCount((n) => n + 1), REVEAL_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [revealedCount]);

  function skip() {
    if (hasSkippedRef.current) return;
    hasSkippedRef.current = true;
    setRevealedCount(COLORS.length);
  }

  const revealing = revealedCount < COLORS.length;
  const visibleBreakdown = (seat: Seat) => breakdowns[seat].slice(0, revealedCount);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#0c1b1a] via-[#0a1513] to-black p-5 text-center sm:p-8">
      <span className="text-4xl">🏆</span>
      <h2 className="text-lg font-bold text-white">
        {isDraw ? "무승부!" : `${winner ? names[winner] : ""}님 승리!`}
      </h2>
      <p className="text-xs text-white/40">색상별 원정로 점수 상세</p>

      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <ScoreTable name={names.p1} isViewer={viewerSeat === "p1"} breakdown={visibleBreakdown("p1")} total={revealing ? 0 : totals.p1} isWinner={winner === "p1"} />
        <ScoreTable name={names.p2} isViewer={viewerSeat === "p2"} breakdown={visibleBreakdown("p2")} total={revealing ? 0 : totals.p2} isWinner={winner === "p2"} />
      </div>

      {revealing ? (
        <button
          type="button"
          onClick={skip}
          className="mt-1 flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-black/30 px-6 py-2.5 text-sm font-semibold text-white/90 transition hover:border-emerald-300 active:scale-95"
        >
          ⏩ 결과 스킵
        </button>
      ) : (
        <div className="mt-1 flex gap-2">
          <button onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30">
            나가기
          </button>
          <button onClick={onRematch} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400">
            다시하기
          </button>
        </div>
      )}
    </div>
  );
}
