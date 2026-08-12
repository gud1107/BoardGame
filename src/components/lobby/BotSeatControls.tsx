"use client";

import { BOT_BADGE } from "@/games/shared/bot/botNaming";

/**
 * Shared presentational bits every `<Game>Game.tsx` waiting room uses to let
 * the host add/remove AI bot seats (see ARCHITECTURE.md §7). Deliberately
 * unstyled beyond a neutral pill so each game's own accent color (rose,
 * emerald, amber, violet, ...) stays visually dominant — these just need to
 * read as "a control", not compete with the game's palette.
 */

export function BotSeatBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-200">
      {BOT_BADGE} {label}
    </span>
  );
}

export function AddBotButton({ onClick, label = "봇 추가" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-dashed border-white/20 px-2.5 py-1 text-[11px] text-white/50 transition hover:border-sky-400/50 hover:text-sky-200"
    >
      {BOT_BADGE} {label}
    </button>
  );
}

export function RemoveBotButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/40 transition hover:border-rose-400/50 hover:text-rose-300"
    >
      ✕ 제거
    </button>
  );
}
