"use client";

import type { Seat } from "./engine";

/**
 * Color-coded chess pawn piece — duplicated from 1편's `ChessPawn.tsx`
 * verbatim (zero cross-game coupling, see `engine.ts`'s module doc) rather
 * than imported. Same P1/P2-only theme (this game is 2-player-exclusive,
 * `Seat = "p1" | "p2"`); the hovering/bounce cue plays on whichever seat's
 * turn it currently is.
 */

const SEAT_THEME: Record<Seat, { gradientId: string; bodyTop: string; bodyBottom: string; glow: string; ring: string; label: string }> = {
  p1: { gradientId: "moo2-pawn-grad-p1", bodyTop: "#7dd3fc", bodyBottom: "#0c4a6e", glow: "#22d3ee", ring: "#a5f3fc", label: "P1" },
  p2: { gradientId: "moo2-pawn-grad-p2", bodyTop: "#fb7185", bodyBottom: "#5b0f18", glow: "#f43f5e", ring: "#fecdd3", label: "P2" },
};

export interface ChessPawnProps {
  seat: Seat;
  isActive?: boolean;
  isViewer?: boolean;
  size?: number;
  className?: string;
}

export default function ChessPawn({ seat, isActive = false, isViewer = false, size = 20, className }: ChessPawnProps) {
  const theme = SEAT_THEME[seat];
  return (
    <div
      className={`aspect-square shrink-0 ${isActive ? "moo2-pawn-bounce" : ""} ${className ?? ""}`}
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
        <path d="M4 27.5 Q12 23.5 20 27.5 L18.3 24 Q12 21.7 5.7 24 Z" fill={`url(#${theme.gradientId})`} stroke={theme.ring} strokeWidth="0.7" />
        <ellipse cx="12" cy="28" rx="8.5" ry="2.2" fill={theme.bodyBottom} />
        <path d="M8.3 22.5 Q7.2 16 10.2 12.8 Q7.4 10.6 7.4 7.8 Q7.4 5 12 5 Q16.6 5 16.6 7.8 Q16.6 10.6 13.8 12.8 Q16.8 16 15.7 22.5 Z" fill={`url(#${theme.gradientId})`} stroke={theme.ring} strokeWidth="0.7" />
        <circle cx="12" cy="6.2" r="4.6" fill={`url(#${theme.gradientId})`} stroke={theme.ring} strokeWidth="0.8" />
        <circle cx="12" cy="31.5" r="2.3" fill={theme.ring} />
        <text x="12" y="32.6" textAnchor="middle" fontSize="3" fontWeight="900" fill="#0a0a0a">
          {seat === "p1" ? "1" : "2"}
        </text>
      </svg>
    </div>
  );
}
