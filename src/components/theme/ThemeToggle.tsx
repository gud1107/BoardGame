"use client";

import { useTheme } from "@/contexts/ThemeContext";

/**
 * Compact one-touch dark/light switch — shared by SiteHeader (present on
 * every page, lobby and in-game alike, see layout.tsx) so a single component
 * covers both placements the brief asked for. Pure client-side attribute
 * flip (see ThemeContext.tsx); never touches socket/game state, so toggling
 * mid-turn is always safe.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? "화이트 모드로 전환" : "블랙 모드로 전환"}
      aria-label={isDark ? "화이트 모드로 전환" : "블랙 모드로 전환"}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-neutral-900/60 text-sm transition hover:border-amber-400/70 hover:shadow-[0_0_12px_rgba(245,158,11,0.3)] light:border-slate-300 light:bg-white light:shadow-sm light:hover:border-slate-400 light:hover:shadow-md ${className}`}
    >
      <span aria-hidden="true">{isDark ? "🌙" : "☀️"}</span>
    </button>
  );
}
