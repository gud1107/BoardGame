"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { LoveLetterState, SeatIndex } from "./engine";

/**
 * Purely cosmetic flourishes — no game logic lives here. Same "diff two
 * consecutive lockstep snapshots, portal a fixed overlay, drive it with a
 * globals.css keyframe" technique as every other `<Game>Effects.tsx` in this
 * project (coyote/CoyoteEffects.tsx, dalmuti/DalmutiEffects.tsx, ...).
 */

/** Seats newly added to `eliminationOrder` by this state transition (0 or 1 in every real play, see engine.ts — but returns a list defensively). */
export function detectNewlyEliminated(prev: LoveLetterState, next: LoveLetterState): SeatIndex[] {
  if (prev === next) return [];
  return next.eliminationOrder.slice(prev.eliminationOrder.length);
}

/** True exactly the render where the round just ended (phase left "playing" for "gameOver"). */
export function detectGameJustEnded(prev: LoveLetterState, next: LoveLetterState): boolean {
  return prev !== next && prev.phase === "playing" && next.phase === "gameOver";
}

export function EliminationToast({ names, onDone }: { names: string[]; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, same pattern as CoyoteHowlBanner
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[75] flex items-start justify-center pt-20">
      <div
        className="flex flex-col items-center gap-1 rounded-2xl border-2 border-rose-300/70 bg-gradient-to-b from-rose-950/95 to-black/95 px-6 py-4 text-center shadow-[0_0_60px_-10px_rgba(244,63,94,0.6)]"
        style={{ animation: "loveletter-eliminate-pop 2.2s ease-out forwards" }}
      >
        <span className="text-3xl">💔</span>
        {names.map((name) => (
          <p key={name} className="text-sm font-bold text-rose-100">
            {name}님이 탈락했습니다
          </p>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function GameOverBanner({ winnerNames, onDone }: { winnerNames: string[]; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-b from-rose-950/70 via-black/60 to-black/90"
        style={{ animation: "loveletter-glow-flash 2.4s ease-out forwards" }}
      />
      <div
        className="relative flex flex-col items-center gap-2 rounded-3xl border-4 border-rose-300 bg-gradient-to-b from-rose-950/95 to-black/95 px-10 py-8 text-center shadow-[0_0_90px_-10px_rgba(244,63,94,0.7)]"
        style={{ animation: "loveletter-letter-burst 2.4s ease-out forwards" }}
      >
        <span className="text-6xl">💌</span>
        <h2 className="text-3xl font-black tracking-wide text-rose-100">공주의 마음을 얻었습니다!</h2>
        <p className="text-sm text-white/70">{winnerNames.join(", ")}님, 축하합니다!</p>
      </div>
    </div>,
    document.body,
  );
}

/** Wraps a card so it plays a single 3D flip the moment it becomes revealed — same technique as coyote/CoyoteEffects.tsx's `CardFlipWrapper`. */
export function CardFlipWrapper({ flipKey, revealed, children }: { flipKey: string; revealed: boolean; children: React.ReactNode }) {
  return (
    <div key={flipKey} style={revealed ? { animation: "loveletter-card-flip 0.6s ease-out" } : undefined} className="[transform-style:preserve-3d]">
      {children}
    </div>
  );
}
