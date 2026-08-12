"use client";

import { useState } from "react";
import { BOT_BADGE } from "@/games/shared/bot/botNaming";
import { BOT_LEVELS, DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";

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

/**
 * `onAddWithLevel` is the newer, level-aware contract (games with a Level
 * 1–10 difficulty system — see ARCHITECTURE.md §7.5) — passing it renders a
 * Lv.1–10 `<select>` next to the button and calls back with the chosen
 * level. `onClick` is the original level-less contract, kept so the 4 pilot
 * games (hanamikoji/no-thanks/perudo/splendor) don't need to change.
 */
export function AddBotButton({
  onClick,
  onAddWithLevel,
  label = "봇 추가",
  defaultLevel = DEFAULT_BOT_LEVEL,
}: {
  onClick?: () => void;
  onAddWithLevel?: (level: BotLevel) => void;
  label?: string;
  defaultLevel?: BotLevel;
}) {
  const [level, setLevel] = useState<BotLevel>(defaultLevel);

  if (onAddWithLevel) {
    return (
      <span className="inline-flex items-center gap-1">
        <select
          value={level}
          onChange={(e) => setLevel(Number(e.target.value) as BotLevel)}
          aria-label="봇 난이도"
          className="rounded-full border border-white/15 bg-black/30 px-1.5 py-1 text-[11px] text-white/70"
        >
          {BOT_LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              Lv.{lv}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onAddWithLevel(level)}
          className="rounded-full border border-dashed border-white/20 px-2.5 py-1 text-[11px] text-white/50 transition hover:border-sky-400/50 hover:text-sky-200"
        >
          {BOT_BADGE} {label}
        </button>
      </span>
    );
  }

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
