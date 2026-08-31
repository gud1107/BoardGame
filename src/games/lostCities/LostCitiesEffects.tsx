"use client";

import { useEffect, useState } from "react";

/**
 * Global overlay for the "게임 액션 풀 이펙트" work order ask — one
 * `LostCitiesBoard.tsx`-owned array of already-resolved motion events, each
 * rendered as a `from`→`to` flight between two `getBoundingClientRect()`
 * points measured at the moment its state change was diffed. Same
 * measure-in-the-caller / pure-presentation-here split as
 * `ratATatCat/CardFlightEffect.tsx` (this project's established pattern for
 * this kind of "who did what, where" cross-viewer eye candy).
 *
 * Three `kind`s, matching the task brief's 3 requested action effects:
 *  - `place`  (탐험로 배치): golden light trail + a landing "slam" spark burst
 *    at the destination lane.
 *  - `discard` (버림 칸 버리기): the flying card spins and fades to smoke
 *    instead of landing solid, plus a small smoke-puff at the pile.
 *  - `draw` (덱/버림더미 → 손패): a bright light-trail streak toward the
 *    drawing seat's hand, labeled with its source.
 */
export const LC_FLIGHT_DURATION_MS = 600;

export interface LostCitiesEffect {
  id: string;
  kind: "place" | "discard" | "draw";
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** `draw` only — which pile the card came from, shown as a small badge. */
  drawSource?: "deck" | "discard";
}

const KIND_ICON: Record<LostCitiesEffect["kind"], string> = { place: "🗺️", discard: "🗑️", draw: "🃏" };
const DRAW_BADGE: Record<NonNullable<LostCitiesEffect["drawSource"]>, string> = { deck: "📦 덱 드로우", discard: "♻️ 버림더미 픽업" };

const KIND_CARD_CLASS: Record<LostCitiesEffect["kind"], string> = {
  place: "border-amber-300 bg-gradient-to-br from-amber-200 to-amber-500 text-amber-950 shadow-[0_0_20px_rgba(252,211,77,0.9)]",
  discard: "border-slate-300 bg-gradient-to-br from-slate-300 to-slate-500 text-slate-900 shadow-[0_0_14px_rgba(203,213,225,0.6)]",
  draw: "border-cyan-200 bg-gradient-to-br from-cyan-100 to-sky-400 text-sky-950 shadow-[0_0_20px_rgba(103,232,249,0.9)]",
};

const KIND_TRAIL_ANIMATION: Record<LostCitiesEffect["kind"], string> = {
  place: "lc-flight-arc",
  discard: "lc-discard-flutter",
  draw: "lc-flight-arc",
};

function EffectItem({ effect, onDone }: { effect: LostCitiesEffect; onDone: (id: string) => void }) {
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    // Double-rAF so the browser commits the initial (unmoved) position
    // before the transform transition kicks in — see ratATatCat's
    // CardFlightEffect for why a single rAF isn't reliably enough.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMoved(true));
    });
    const t = setTimeout(() => onDone(effect.id), LC_FLIGHT_DURATION_MS + 200);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect.id identifies this instance; from/to/kind are fixed for its lifetime.
  }, [effect.id]);

  const dx = effect.to.x - effect.from.x;
  const dy = effect.to.y - effect.from.y;
  const arriveDelayMs = LC_FLIGHT_DURATION_MS * 0.85;

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-[70]"
      style={{
        transform: `translate(${effect.from.x}px, ${effect.from.y}px) translate(${moved ? dx : 0}px, ${moved ? dy : 0}px)`,
        transition: `transform ${LC_FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.7, 0.3, 1)`,
      }}
    >
      <div className="relative -translate-x-1/2 -translate-y-1/2">
        {/* Comet-tail ghost copies for the light-trail look (place/draw); harmless on discard too. */}
        <span aria-hidden className="absolute inset-0 flex h-9 w-9 items-center justify-center text-lg" style={{ animation: "lc-flight-trail-fade 0.5s ease-out 0.04s both" }}>
          {KIND_ICON[effect.kind]}
        </span>
        <span aria-hidden className="absolute inset-0 flex h-9 w-9 items-center justify-center text-lg" style={{ animation: "lc-flight-trail-fade 0.5s ease-out 0.11s both" }}>
          {KIND_ICON[effect.kind]}
        </span>
        <span
          aria-hidden
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg border-2 text-base ${KIND_CARD_CLASS[effect.kind]}`}
          style={{ animation: `${KIND_TRAIL_ANIMATION[effect.kind]} ${LC_FLIGHT_DURATION_MS / 1000}s ease-out both` }}
        >
          {KIND_ICON[effect.kind]}
        </span>

        {effect.kind === "draw" && effect.drawSource && (
          <span
            className="absolute left-1/2 top-full whitespace-nowrap rounded-full border border-cyan-200/70 bg-black/80 px-2 py-0.5 text-[10px] font-bold text-cyan-200 shadow"
            style={{ animation: "lc-flight-trail-fade 0.6s ease-out both" }}
          >
            {DRAW_BADGE[effect.drawSource]}
          </span>
        )}

        {/* Landing impact — golden slam+spark burst for a placement, a soft smoke puff for a discard. Timed to appear only once the flight has essentially arrived. */}
        {effect.kind === "place" && (
          <span
            aria-hidden
            className="lc-place-slam absolute inset-0 -z-10 flex items-center justify-center text-3xl opacity-0"
            style={{ animationDelay: `${arriveDelayMs}ms` }}
          >
            ✨
          </span>
        )}
        {effect.kind === "discard" && (
          <span
            aria-hidden
            className="lc-discard-smoke absolute inset-0 -z-10 flex items-center justify-center text-2xl opacity-0"
            style={{ animationDelay: `${arriveDelayMs}ms` }}
          >
            💨
          </span>
        )}
      </div>
    </div>
  );
}

export default function LostCitiesEffects({ effects, onEffectDone }: { effects: LostCitiesEffect[]; onEffectDone: (id: string) => void }) {
  if (effects.length === 0) return null;
  return (
    <>
      {effects.map((effect) => (
        <EffectItem key={effect.id} effect={effect} onDone={onEffectDone} />
      ))}
    </>
  );
}
