"use client";

import { CardChip } from "./cardDisplay";
import type { Card } from "./engine";

/**
 * Replaces the old plain "공통 카드" text+chip with a small dealer-style
 * reveal: a fanned deck stack on the left, and the drawn card sliding out
 * and flipping face-up into a reveal slot on the right. Pure CSS (no new
 * animation library) — `key={drawCount}` remounts the flipping card every
 * round so the `deal-flip` keyframe (see globals.css) always replays from
 * the start instead of only firing once on first mount.
 */
export default function DealerReveal({ card, drawCount, caption }: { card: Card | null; drawCount: number; caption: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-20 items-center justify-center gap-4 sm:h-24">
        {/* Deck stack: a few slightly fanned card backs, purely decorative. */}
        <div className="relative h-14 w-10 shrink-0 sm:h-16 sm:w-12">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="absolute inset-0 rounded-md border border-white/15 bg-gradient-to-br from-indigo-950 via-slate-900 to-black shadow-md"
              style={{ transform: `rotate(${(i - 1) * 5}deg) translate(${(i - 1) * 2}px, ${-i}px)` }}
            />
          ))}
          <span className="absolute inset-0 flex items-center justify-center text-sm text-white/25">🂠</span>
        </div>

        <span className="text-lg text-white/20">→</span>

        <div className="[perspective:700px]">
          {card ? (
            <div key={drawCount} className="[backface-visibility:hidden] animate-[deal-flip_0.5s_ease-out]">
              <CardChip card={card} size="lg" />
            </div>
          ) : (
            <div className="flex h-16 w-12 items-center justify-center rounded-md border border-dashed border-white/15 text-white/20 sm:h-20 sm:w-14">
              ⋯
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-white/50">{caption}</p>
    </div>
  );
}
