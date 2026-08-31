"use client";

import type { Seat } from "./engine";

/**
 * Color-coded chess pawn piece — replaces the old plain circular
 * `Avatar`-photo marker that used to sit on a player's current tile.
 *
 * Confirmed via `AskUserQuestion` (2026-09-01, same session as the
 * `canPlaceMine` occupied-tile reversal — see `engine.ts`):
 *  - **No player photo.** This game is 2-player-only (`Seat = "p1" | "p2"`,
 *    see `engine.ts` module doc), so only P1/P2 themes are defined here —
 *    the request's "P3/P4" palette was explicitly descoped, not omitted by
 *    oversight.
 *  - The hovering/bounce cue (`isActive`) plays on whichever seat's turn it
 *    currently is, not on the piece that just landed.
 *
 * One SVG shared by both seats; only the gradient/glow/ring colors differ,
 * so a new seat theme is a one-line addition to `SEAT_THEME` if this game
 * is ever revisited for a real 3–4 player mode (out of scope today).
 */

const SEAT_THEME: Record<Seat, { gradientId: string; bodyTop: string; bodyBottom: string; glow: string; ring: string; label: string }> = {
  // P1 — "네온 시안 광원 테두리 + 메탈릭 블루 체스 폰"
  p1: { gradientId: "moo-pawn-grad-p1", bodyTop: "#7dd3fc", bodyBottom: "#0c4a6e", glow: "#22d3ee", ring: "#a5f3fc", label: "P1" },
  // P2 — "네온 레드 광원 테두리 + 다크 크림슨 체스 폰"
  p2: { gradientId: "moo-pawn-grad-p2", bodyTop: "#fb7185", bodyBottom: "#5b0f18", glow: "#f43f5e", ring: "#fecdd3", label: "P2" },
};

export interface ChessPawnProps {
  seat: Seat;
  /** True while it is currently this seat's turn — plays the hovering/bounce cue ("이동 턴 시" per spec). */
  isActive?: boolean;
  /** True when this piece belongs to the viewer — renders a brighter glow so a player can spot their own pawn at a glance. */
  isViewer?: boolean;
  /** Pixel size of the (square) piece. Defaults to a size that reads clearly inside an 11×11 board cell at zoom 1. */
  size?: number;
  className?: string;
}

/** One color-coded chess-pawn glyph. `aspect-square`/`shrink-0` per the platform's mobile-grid standard so it never squishes inside a flex/grid cell. */
export default function ChessPawn({ seat, isActive = false, isViewer = false, size = 20, className }: ChessPawnProps) {
  const theme = SEAT_THEME[seat];
  return (
    <div
      className={`aspect-square shrink-0 ${isActive ? "moo-pawn-bounce" : ""} ${className ?? ""}`}
      style={{ width: size, height: size, filter: `drop-shadow(0 0 ${isViewer ? 5 : 2.5}px ${theme.glow})` }}
      title={`${theme.label}${isViewer ? " (나)" : ""}`}
    >
      <svg viewBox="0 0 24 34" className="h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={theme.gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.bodyTop} />
            <stop offset="100%" stopColor={theme.bodyBottom} />
          </linearGradient>
        </defs>

        {/* base flare */}
        <path d="M4 27.5 Q12 23.5 20 27.5 L18.3 24 Q12 21.7 5.7 24 Z" fill={`url(#${theme.gradientId})`} stroke={theme.ring} strokeWidth="0.7" />
        <ellipse cx="12" cy="28" rx="8.5" ry="2.2" fill={theme.bodyBottom} />
        {/* neck/body */}
        <path d="M8.3 22.5 Q7.2 16 10.2 12.8 Q7.4 10.6 7.4 7.8 Q7.4 5 12 5 Q16.6 5 16.6 7.8 Q16.6 10.6 13.8 12.8 Q16.8 16 15.7 22.5 Z" fill={`url(#${theme.gradientId})`} stroke={theme.ring} strokeWidth="0.7" />
        {/* head */}
        <circle cx="12" cy="6.2" r="4.6" fill={`url(#${theme.gradientId})`} stroke={theme.ring} strokeWidth="0.8" />

        {/* seat identity badge, fused into the base */}
        <circle cx="12" cy="31.5" r="2.3" fill={theme.ring} />
        <text x="12" y="32.6" textAnchor="middle" fontSize="3" fontWeight="900" fill="#0a0a0a">
          {seat === "p1" ? "1" : "2"}
        </text>
      </svg>
    </div>
  );
}
