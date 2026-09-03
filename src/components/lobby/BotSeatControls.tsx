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

/**
 * `variant: "takeover"` renders the distinct look for a seat an originally-
 * human player left mid-game (see `botTakeover.ts` / HANDOFF.md's bot
 * takeover session) — semi-transparent to read as "temporarily standing in",
 * as opposed to the solid sky badge a host deliberately added in the lobby.
 * Existing call sites all omit this prop and keep the original look
 * unchanged.
 */
export function BotSeatBadge({ label, variant = "lobby" }: { label: string; variant?: "lobby" | "takeover" }) {
  if (variant === "takeover") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/60 opacity-70">
        {BOT_BADGE} BOT · {label}
      </span>
    );
  }
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

/**
 * Host-only "일괄 채우기" (batch fill) control: picks a Level 1–10 and, on
 * click, fills every currently-empty seat at once via `onFill(level)`. Sits
 * next to the per-seat `AddBotButton`s (§7.3) rather than replacing them —
 * it's a shortcut for "fill the rest of the room", not a new roster model.
 * Only ever offered when at least one seat is empty (`emptyCount > 0`);
 * callers gate this by `isHost` themselves, same as `AddBotButton`. Existing
 * bot seats and their levels are left untouched — this only ever claims
 * seats that are neither a connected human nor an already-placed bot.
 */
export function FillEmptySeatsButton({
  onFill,
  emptyCount,
  label = "일괄 채우기",
  defaultLevel = DEFAULT_BOT_LEVEL,
}: {
  onFill: (level: BotLevel) => void;
  emptyCount: number;
  label?: string;
  defaultLevel?: BotLevel;
}) {
  const [level, setLevel] = useState<BotLevel>(defaultLevel);

  if (emptyCount <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-sky-400/30 bg-sky-400/5 px-2 py-1">
      <select
        value={level}
        onChange={(e) => setLevel(Number(e.target.value) as BotLevel)}
        aria-label="일괄 채우기 난이도"
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
        onClick={() => onFill(level)}
        className="rounded-full border border-dashed border-sky-400/40 px-2.5 py-1 text-[11px] font-semibold text-sky-200 transition hover:border-sky-400/70 hover:bg-sky-400/10"
      >
        {BOT_BADGE} {label} ({emptyCount}명)
      </button>
    </span>
  );
}
