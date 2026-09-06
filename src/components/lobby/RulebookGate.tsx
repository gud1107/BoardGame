"use client";

import { useState } from "react";
import RulebookSummaryCard from "./RulebookSummaryCard";

/**
 * Wraps a game's room-creation "choose" screen (방만들기/참여하기 선택
 * 화면 — see e.g. `DalmutiGame.tsx`'s `phase === "choose"` block) so a
 * player can preview the game's core rules *before* creating or joining a
 * room, without ever losing access to the action buttons.
 *
 * `description` is the game's existing icon/title-adjacent blurb (shown in
 * the ⚙️ 방 설정 tab); `actions` is the existing 방만들기/참여하기 button
 * group — kept in its own slot so it renders identically regardless of
 * which tab/accordion state is active (never hidden behind the rulebook).
 *
 * Layout differs by breakpoint per this feature's spec, not by game:
 * - md+: a persistent ⚙️/📖 tab switcher swaps the body between
 *   `description` and the rulebook card.
 * - <md: `description` always stays visible; a collapsible "📖 30초 핵심
 *   룰 보기" toggle reveals the same rulebook card inline above it, so the
 *   settings form never gets displaced on small screens.
 */
export default function RulebookGate({
  gameId,
  icon,
  title,
  description,
  actions,
  containerClassName = "border-white/10 bg-white/[0.03]",
}: {
  gameId: string;
  icon: string;
  title: string;
  description: React.ReactNode;
  actions: React.ReactNode;
  /**
   * Border/background classes for the outer card — several games (mostly
   * the "넷플릭스 데스게임" collection) had a bespoke dark gradient here
   * before this component existed. Pass that original className through so
   * the game keeps its look; only the neutral default above changes for
   * everyone else.
   */
  containerClassName?: string;
}) {
  const [tab, setTab] = useState<"settings" | "rulebook">("settings");
  const [mobileRulebookOpen, setMobileRulebookOpen] = useState(false);

  return (
    <div className={`flex w-full flex-col items-center gap-4 rounded-2xl border p-6 text-center md:p-8 ${containerClassName}`}>
      <span className="text-4xl">{icon}</span>
      <h2 className="text-lg font-bold break-keep text-white">{title}</h2>

      {/* Desktop / tablet: persistent tab switcher */}
      <div className="hidden w-full max-w-sm flex-col items-center gap-3 md:flex">
        <div className="flex w-full gap-1 rounded-full border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setTab("settings")}
            aria-pressed={tab === "settings"}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold break-keep transition ${
              tab === "settings" ? "bg-sky-500 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            ⚙️ 방 설정
          </button>
          <button
            type="button"
            onClick={() => setTab("rulebook")}
            aria-pressed={tab === "rulebook"}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold break-keep transition ${
              tab === "rulebook" ? "bg-sky-500 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            📖 룰북 / 게임 규칙
          </button>
        </div>
        <div className="w-full">{tab === "settings" ? description : <RulebookSummaryCard gameId={gameId} />}</div>
      </div>

      {/* Mobile: settings form always visible, rulebook collapses above it */}
      <div className="flex w-full flex-col items-center gap-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileRulebookOpen((o) => !o)}
          aria-expanded={mobileRulebookOpen}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-xs font-semibold break-keep text-sky-200"
        >
          📖 30초 핵심 룰 보기 {mobileRulebookOpen ? "▲" : "▼"}
        </button>
        {mobileRulebookOpen && <RulebookSummaryCard gameId={gameId} />}
        {description}
      </div>

      {/* Always accessible regardless of tab/accordion state */}
      {actions}
    </div>
  );
}
