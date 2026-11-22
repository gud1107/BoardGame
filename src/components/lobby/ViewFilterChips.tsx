"use client";

import { VIEW_FILTER_CHIPS, type ViewFilter } from "@/games/viewModes";

/**
 * 2D·3D / 🧊 3D / 🖼️ 2D segmented chips for the 보드게임허브 lobby — see
 * `src/games/viewModes.ts` for how each game is classified. Sky-tinted so it
 * reads as its own axis next to the amber player-count chips.
 */
export default function ViewFilterChips({
  value,
  onChange,
  compact = false,
}: {
  value: ViewFilter;
  onChange: (next: ViewFilter) => void;
  /** Desktop header's smaller chip size. */
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="화면 방식 필터"
      className="flex shrink-0 overflow-hidden rounded-full border border-white/10 light:border-slate-200"
    >
      {VIEW_FILTER_CHIPS.map((chip) => {
        const active = value === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onChange(chip.value)}
            aria-pressed={active}
            title={chip.title}
            className={`font-medium whitespace-nowrap transition ${
              compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs"
            } ${
              active
                ? "bg-sky-500/20 text-sky-100 light:bg-sky-100 light:text-sky-900"
                : "text-white/70 hover:bg-white/5 hover:text-white light:text-slate-600 light:hover:bg-slate-50 light:hover:text-slate-900"
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
