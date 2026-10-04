"use client";

import { useTheme } from "@/contexts/ThemeContext";

/**
 * Compact one-touch dark/light switch — shared by SiteHeader (present on
 * every page, lobby and in-game alike, see layout.tsx) so a single component
 * covers both placements the brief asked for. Pure client-side attribute
 * flip (see ThemeContext.tsx); never touches socket/game state, so toggling
 * mid-turn is always safe.
 *
 * 2026-10-04: one button, three states — tap cycles 🌙 다크 → ☀️ 라이트 →
 * 🖥️ 시스템(OS 설정 따름). Kept as a single cycling icon so the header
 * doesn't grow a dropdown.
 */
const LABEL = { dark: "다크 모드", light: "라이트 모드", system: "시스템 설정 따름" } as const;
const ICON = { dark: "🌙", light: "☀️", system: "🖥️" } as const;
const NEXT = { dark: "light", light: "system", system: "dark" } as const;

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, preference, cyclePreference } = useTheme();
  const now =
    preference === "system" ? `${LABEL.system} (지금: ${theme === "light" ? "라이트" : "다크"})` : LABEL[preference];
  const label = `테마: ${now} — 눌러서 ${LABEL[NEXT[preference]]}로 전환`;

  return (
    <button
      onClick={cyclePreference}
      title={label}
      aria-label={label}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-neutral-900/60 text-sm transition hover:border-amber-400/70 hover:shadow-[0_0_12px_rgba(245,158,11,0.3)] light:border-slate-300 light:bg-white light:shadow-sm light:hover:border-slate-400 light:hover:shadow-md ${className}`}
    >
      <span aria-hidden="true">{ICON[preference]}</span>
    </button>
  );
}
