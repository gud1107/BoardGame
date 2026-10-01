"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { GameSelfResult } from "@/games/types";
import type { StatTotalsRecord } from "@/lib/db/types";
import { matchSummaryLines } from "@/lib/stats/presentation";
import { useSubscriptionStore } from "@/store/subscriptionStore";

export interface MatchRecord {
  /** Changes per finished match so a rematch re-opens the card. */
  id: string;
  gameId: string;
  self: GameSelfResult;
  totals: StatTotalsRecord | null;
}

const AUTO_HIDE_MS = 20_000;

/**
 * "이번 판 기록" — floating card shown over a game's own post-game screen
 * right after `recordMatchStat`. Floats (rather than replacing the stage)
 * because online games own their post-game screen inside the room and
 * unmounting it would tear the Realtime channel down. Dismissable, and hides
 * itself after AUTO_HIDE_MS so it never sits on the rematch/leave buttons.
 */
export default function MatchRecordCard({ record, onClose }: { record: MatchRecord; onClose: () => void }) {
  const userId = useSubscriptionStore((s) => s.userId);
  const hydrated = useSubscriptionStore((s) => s.hydrated);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(onClose, AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [record.id, onClose]);

  const { self, totals } = record;
  const won = self.rank === 1;
  const lines = matchSummaryLines(record.gameId, self.details);
  const winRate = totals && totals.played > 0 ? Math.round((totals.wins / totals.played) * 100) : null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 top-16 z-[60] mx-auto max-w-sm rounded-2xl border border-white/15 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-80 light:border-slate-200 light:bg-white/95"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-white/50 light:text-slate-500">이번 판 기록</p>
          <p className={`text-lg font-bold ${won ? "text-amber-300 light:text-amber-600" : "text-white light:text-slate-900"}`}>
            {won ? "🏆 승리" : "패배"} · {self.rank}위 / {self.playerCount}명
          </p>
        </div>
        <div className="flex gap-1">
          {lines.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="rounded-lg px-2 py-1 text-xs text-white/50 hover:bg-white/10 light:text-slate-500 light:hover:bg-slate-100"
              aria-label={expanded ? "접기" : "펼치기"}
            >
              {expanded ? "▲" : "▼"}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-white/50 hover:bg-white/10 light:text-slate-500 light:hover:bg-slate-100"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && lines.length > 0 && (
        <dl className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2 light:border-slate-200">
          {lines.map((l) => (
            <div key={l.label} className="flex justify-between gap-3 text-xs">
              <dt className="text-white/55 light:text-slate-500">{l.label}</dt>
              <dd className="tabular-nums font-semibold text-white light:text-slate-900">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {totals && (
        <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/60 light:border-slate-200 light:text-slate-500">
          누적 {totals.played}판 {totals.wins}승 {totals.losses}패{winRate !== null && ` · 승률 ${winRate}%`}{" "}
          <Link href="/stats" className="ml-1 text-rose-300 underline light:text-rose-600">
            전적 보기
          </Link>
        </p>
      )}

      {hydrated && !userId && (
        <p className="mt-2 rounded-lg border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200 light:text-amber-800">
          ⚠️ 로그인하지 않은 기록은 이 브라우저에만 있어 언제든 사라질 수 있어요.{" "}
          <Link href="/login?next=/stats" className="font-bold underline">
            로그인하고 지키기
          </Link>
        </p>
      )}
    </div>
  );
}
