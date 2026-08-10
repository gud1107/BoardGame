"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { CoyoteState } from "./engine";

/**
 * Purely cosmetic flourishes — no game logic lives here. Task brief §2
 * "'코요테!' 외침 애니메이션": a desert/Indian-themed wolf-howl overlay the
 * instant the showdown triggers, plus a per-card 3D flip so every forehead
 * card visibly turns face-up together. Both play identically for every
 * connected client off the shared lockstep state transition (not a local
 * click) — same "diff two consecutive snapshots, portal a fixed overlay,
 * drive it with a globals.css keyframe" technique as every other
 * `<Game>Effects.tsx` in this project (dalmuti/DalmutiEffects.tsx,
 * five-cucumbers/CardEffects.tsx, lasVegas/DiceEffects.tsx, ...).
 */

/** True exactly the render where the showdown just fired (phase left "playing" for "reveal"/"gameOver"). */
export function detectCoyoteCallEvent(prev: CoyoteState, next: CoyoteState): boolean {
  return prev !== next && prev.phase === "playing" && next.phase !== "playing";
}

export function CoyoteHowlBanner({ callerName, onDone }: { callerName: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see DalmutiEffects.tsx's RevolutionBanner for the same pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-b from-orange-950/70 via-black/60 to-black/90"
        style={{ animation: "coyote-desert-flash 2s ease-out forwards" }}
      />
      <div
        className="relative flex flex-col items-center gap-2 rounded-3xl border-4 border-orange-300 bg-gradient-to-b from-orange-950/95 to-black/95 px-10 py-8 text-center shadow-[0_0_90px_-10px_rgba(251,146,60,0.7)]"
        style={{ animation: "coyote-howl-burst 2s ease-out forwards" }}
      >
        <span className="text-6xl">🐺</span>
        <h2 className="text-3xl font-black tracking-wide text-orange-200">코요테!!!</h2>
        <p className="text-sm text-white/70">{callerName}님이 울부짖었습니다 — 모두의 이마 카드가 공개됩니다!</p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Wraps a forehead `CardFace` so it plays a single 3D flip the moment it
 * becomes visible (round moves to "reveal"/"gameOver"). `flipKey` should
 * change once per new reveal (e.g. `${seat}-${roundNumber}-${phase}`) so the
 * remount — and therefore the animation — fires exactly once per showdown,
 * never replaying on every unrelated re-render.
 */
export function CardFlipWrapper({ flipKey, revealed, children }: { flipKey: string; revealed: boolean; children: React.ReactNode }) {
  return (
    <div key={flipKey} style={revealed ? { animation: "coyote-card-flip 0.6s ease-out" } : undefined} className="[transform-style:preserve-3d]">
      {children}
    </div>
  );
}
