"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/common/Avatar";
import Overlay from "@/components/Overlay";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { champions, fetchGameBoard, type BoardPeriod, type GameBoardRow } from "@/lib/stats/gameChampions";

const PERIOD_LABEL: Record<BoardPeriod, string> = { month: "이번 달", all: "전체" };

/**
 * Under the game title: this game's champion of the KST month, with their
 * character portrait ("이 게임은 내가 이번 달 1위!" when it's the viewer).
 * Tapping opens the game's board — 이번 달 / 전체. Renders nothing until
 * supabase/game_champions.sql is installed, or when Supabase is off.
 */
export default function GameChampionChip({ gameId, gameName }: { gameId: string; gameName: string }) {
  const [month, setMonth] = useState<GameBoardRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchGameBoard(gameId, "month").then((r) => {
      if (!cancelled) setMonth(Array.isArray(r) ? r : null);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (!month) return null;
  const top = champions(month);
  const mine = top.some((r) => r.isMe);
  const first = top.find((r) => r.isMe) ?? top[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-1.5 flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[11px] transition sm:text-xs ${
          mine
            ? "border-amber-300/70 bg-amber-400/15 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.35)] hover:bg-amber-400/25 light:border-amber-400 light:bg-amber-50 light:text-amber-800"
            : "border-white/15 bg-white/5 text-white/75 hover:border-amber-400/50 hover:text-white light:border-slate-200 light:bg-slate-50 light:text-slate-600 light:hover:border-amber-400"
        }`}
        aria-label={`${gameName} 이번 달 랭킹 보기`}
      >
        {first ? (
          <Avatar src={first.portrait} alt="" size={22} className="shrink-0" />
        ) : (
          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center">🏆</span>
        )}
        <span className="truncate">
          {mine ? (
            <b>👑 이 게임은 내가 이번 달 1위!</b>
          ) : first ? (
            <>
              👑 이번 달 1위 <b className="text-amber-200 light:text-amber-700">{first.nickname}</b>
              {top.length > 1 && <span className="opacity-60"> 외 {top.length - 1}명</span>}
            </>
          ) : (
            "👑 이번 달 1위 자리가 비어 있어요"
          )}
        </span>
        <span className="shrink-0 opacity-50">· 랭킹 ›</span>
      </button>
      {open && <GameBoardModal gameId={gameId} gameName={gameName} month={month} onClose={() => setOpen(false)} />}
    </>
  );
}

function GameBoardModal({
  gameId,
  gameName,
  month,
  onClose,
}: {
  gameId: string;
  gameName: string;
  month: GameBoardRow[];
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<BoardPeriod>("month");
  const [all, setAll] = useState<GameBoardRow[] | "loading" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    void fetchGameBoard(gameId, "all").then((r) => {
      if (!cancelled) setAll(Array.isArray(r) ? r : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const rows = period === "month" ? month : all;
  const userId = useSubscriptionStore((s) => s.userId);
  const authHydrated = useSubscriptionStore((s) => s.hydrated);

  return (
    <Overlay title={`🏆 ${gameName} 랭킹`} onClose={onClose}>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 light:bg-slate-100" role="tablist">
        {(["month", "all"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={`min-h-10 rounded-lg text-sm font-semibold transition ${
              period === p
                ? "bg-amber-400 text-black"
                : "text-white/60 hover:text-white light:text-slate-500 light:hover:text-slate-800"
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {rows === "loading" ? (
        <p className="py-8 text-center text-sm text-white/50 light:text-slate-500">불러오는 중…</p>
      ) : rows === "failed" ? (
        <p className="py-8 text-center text-sm text-white/50 light:text-slate-500">랭킹을 불러오지 못했어요.</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/50 light:text-slate-500">
          {period === "month" ? "이번 달" : "아직"} 기록이 없어요. 첫 1위가 되어 보세요!
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={`${r.rank}-${r.nickname}`}
              className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${
                r.isMe
                  ? "bg-amber-400/15 ring-1 ring-amber-300/60 light:bg-amber-50 light:ring-amber-400"
                  : "bg-white/[0.03] light:bg-slate-50"
              }`}
            >
              <span
                className={`w-7 shrink-0 text-center text-sm font-bold tabular-nums ${
                  r.rank === 1 && r.wins > 0 ? "text-amber-300 light:text-amber-600" : "text-white/60 light:text-slate-500"
                }`}
              >
                {r.rank === 1 && r.wins > 0 ? "👑" : r.rank}
              </span>
              <Avatar src={r.portrait} alt="" size={36} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white light:text-slate-900">
                  {r.nickname}
                  {r.isMe && <span className="ml-1 text-xs text-amber-300 light:text-amber-600">(나)</span>}
                </span>
                <span className="block text-[11px] text-white/50 light:text-slate-500">
                  {r.played}판 · 승률 {r.winRate ?? 0}%
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-white/85 light:text-slate-800">{r.wins}승</span>
            </li>
          ))}
        </ol>
      )}

      {authHydrated && !userId && (
        <div
          role="alert"
          className="mt-4 rounded-xl border-2 border-amber-400/70 bg-amber-400/15 p-3 text-xs leading-relaxed text-amber-100 light:border-amber-500 light:bg-amber-50 light:text-amber-900"
        >
          <p className="font-bold">⚠️ 로그인하지 않으면 랭킹에 오르지 않고, 기록은 언제 사라질지 몰라요</p>
          <p className="mt-1">
            비로그인 기록은 이 브라우저에만 저장돼요. <b>다른 브라우저에서 로그인하면 이 브라우저의 기록은 넘어가지 않고 사라집니다.</b>{" "}
            이 브라우저에서 로그인해야 지금까지의 기록이 계정에 합쳐져요.
          </p>
          <Link
            href={`/login?next=/games/${gameId}`}
            className="mt-2 inline-block rounded-lg bg-amber-400 px-3 py-1.5 font-bold text-zinc-900 hover:bg-amber-300"
          >
            이 브라우저에서 로그인하기
          </Link>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-white/40 light:text-slate-500">
        승리 수 순(같으면 승률 순) · 로그인한 판만 집계 · 이번 달은 한국 시간 기준이에요. 이미지는 각자 고른 3D 캐릭터예요.
      </p>
      <Link
        href="/stats"
        className="mt-3 block rounded-xl border border-white/10 py-2.5 text-center text-sm text-white/70 hover:border-amber-400/50 hover:text-white light:border-slate-200 light:text-slate-600"
      >
        전체 게임 전적·랭킹 보기 ›
      </Link>
    </Overlay>
  );
}
