"use client";

import { useRef, useState } from "react";
import type { GameMeta } from "@/games/types";
import type { LobbySection } from "./buildLobbySections";

/**
 * Per-layout grid + "two rows" cut-off. The cut-off is pure CSS (children
 * past the 2nd row get `display:none` per breakpoint), so the section never
 * has to measure its own column count.
 *
 * - `hub`: the phone/tablet layout in `page.tsx` (`xl:hidden`) — 2 cols,
 *   3 from `md`, 4 from `lg`.
 * - `dashboard`: the xl+ desktop dashboard — 5 cols, 6 from `2xl`.
 */
const LAYOUTS = {
  hub: {
    grid: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
    collapsed:
      "max-md:[&>*:nth-child(n+5)]:hidden md:max-lg:[&>*:nth-child(n+7)]:hidden lg:[&>*:nth-child(n+9)]:hidden",
    /** Hide the "더 보기" button where everything already fits in two rows. */
    moreHidden: (n: number) =>
      `${n > 4 ? "" : "max-md:hidden"} ${n > 6 ? "" : "md:max-lg:hidden"} ${n > 8 ? "" : "lg:hidden"}`,
  },
  dashboard: {
    grid: "grid grid-cols-5 gap-4 2xl:grid-cols-6",
    collapsed: "max-2xl:[&>*:nth-child(n+11)]:hidden 2xl:[&>*:nth-child(n+13)]:hidden",
    moreHidden: (n: number) => `${n > 10 ? "" : "max-2xl:hidden"} ${n > 12 ? "" : "2xl:hidden"}`,
  },
} as const;

/**
 * 보드게임허브 browse view (2026-11-22): the catalog split into titled
 * sections (`buildLobbySections`) instead of one 81-card wall. Each section
 * shows two rows; "더 보기" expands it in place.
 */
export default function LobbySections({
  sections,
  layout,
  renderCard,
}: {
  sections: LobbySection[];
  layout: keyof typeof LAYOUTS;
  renderCard: (game: GameMeta) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-10 xl:gap-8">
      {sections.map((section) => (
        <Section key={section.id} section={section} layout={layout} renderCard={renderCard} />
      ))}
    </div>
  );
}

function Section({
  section,
  layout,
  renderCard,
}: {
  section: LobbySection;
  layout: keyof typeof LAYOUTS;
  renderCard: (game: GameMeta) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const spec = LAYOUTS[layout];
  const count = section.games.length;

  const toggle = () => {
    if (expanded) {
      // Folding a long section back up would otherwise leave the reader far
      // below it — bring its header back on screen (no-op if it's visible).
      headerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    setExpanded(!expanded);
  };

  return (
    <section aria-labelledby={`lobby-section-${layout}-${section.id}`}>
      {/* scroll-mt clears the phone layout's sticky header + search bar. */}
      <header ref={headerRef} className="mb-3 flex scroll-mt-64 items-start gap-3 xl:scroll-mt-4">
        <span
          aria-hidden
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ backgroundColor: `${section.accent}24`, boxShadow: `inset 0 0 0 1px ${section.accent}55` }}
        >
          {section.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={`lobby-section-${layout}-${section.id}`}
            className="flex items-baseline gap-2 font-display text-lg leading-tight font-bold text-white break-keep sm:text-xl light:text-slate-900"
          >
            {section.title}
            <span className="font-sans text-sm font-semibold text-white/55 tabular-nums light:text-slate-500">{count}</span>
          </h2>
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-white/65 break-keep sm:text-sm light:text-slate-600">
            {section.description}
          </p>
        </div>
      </header>

      <div className={`${spec.grid} ${expanded ? "" : spec.collapsed}`}>
        {section.games.map((game) => (
          <div key={game.id} className="min-w-0">
            {renderCard(game)}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/25 hover:bg-white/[0.06] hover:text-white light:border-slate-200 light:bg-white light:text-slate-700 light:hover:border-slate-300 ${
          expanded ? "" : spec.moreHidden(count)
        }`}
      >
        {expanded ? "▴ 접기" : `▾ ${section.title} ${count}개 모두 보기`}
      </button>
    </section>
  );
}
