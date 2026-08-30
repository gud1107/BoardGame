"use client";

import { useEffect, useState } from "react";

/**
 * Global overlay for the "카드 획득/드로우 전역 궤적 이펙트" work order ask —
 * a light-trail card icon flying from the deck/discard pile to whichever
 * seat's hand just drew, so every viewer can tell at a glance who took a
 * card and from where. `RatATatCatBoard.tsx` owns the actual trigger logic
 * (diffing consecutive `state` snapshots) and coordinate measurement
 * (`getBoundingClientRect` on the deck/discard/hand-row refs at the moment
 * a draw is detected) — this component is pure presentation over an array
 * of already-resolved flights.
 *
 * Purely local, per-viewer eye candy: every flight is derived from state
 * that already changed (the draw already happened in the engine), so it
 * never gates or delays any real action, and a client that missed a flight
 * (e.g. just reconnected) loses nothing but the animation.
 */

export const FLIGHT_DURATION_MS = 650;

export interface CardFlight {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  source: "deck" | "discard";
}

const SOURCE_BADGE: Record<CardFlight["source"], string> = {
  deck: "📦 덱 드로우",
  discard: "♻️ 버림 더미 픽업",
};

function FlightItem({ flight, onDone }: { flight: CardFlight; onDone: (id: string) => void }) {
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    // Double-rAF so the browser commits the initial (unmoved) position
    // before the transform transition kicks in — a single rAF can still
    // land in the same paint frame as the initial render on some browsers.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMoved(true));
    });
    const t = setTimeout(() => onDone(flight.id), FLIGHT_DURATION_MS + 120);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flight.id identifies this instance; from/to/source are fixed for its lifetime.
  }, [flight.id]);

  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-[70]"
      style={{
        transform: `translate(${flight.from.x}px, ${flight.from.y}px) translate(${moved ? dx : 0}px, ${moved ? dy : 0}px)`,
        transition: `transform ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 0.7, 0.3, 1)`,
      }}
    >
      <div className="relative -translate-x-1/2 -translate-y-1/2">
        {/* Comet-tail ghost copies, staggered behind the lead card. */}
        <span
          aria-hidden
          className="absolute inset-0 flex h-10 w-10 items-center justify-center text-2xl"
          style={{ animation: "ratc-flight-trail-fade 0.5s ease-out 0.04s both" }}
        >
          🃏
        </span>
        <span
          aria-hidden
          className="absolute inset-0 flex h-10 w-10 items-center justify-center text-2xl"
          style={{ animation: "ratc-flight-trail-fade 0.5s ease-out 0.11s both" }}
        >
          🃏
        </span>
        <span
          aria-hidden
          className="relative flex h-10 w-10 items-center justify-center rounded-lg border-2 border-amber-300 bg-gradient-to-br from-amber-200 to-amber-400 text-xl text-amber-950 shadow-[0_0_18px_rgba(252,211,77,0.85)]"
          style={{ animation: "ratc-flight-arc 0.65s ease-out both" }}
        >
          🃏
        </span>
        <span
          className="absolute left-1/2 top-full whitespace-nowrap rounded-full border border-amber-300/70 bg-black/80 px-2 py-0.5 text-[10px] font-bold text-amber-200 shadow"
          style={{ animation: "ratc-flight-badge-fade 0.65s ease-out both" }}
        >
          {SOURCE_BADGE[flight.source]}
        </span>
      </div>
    </div>
  );
}

export default function CardFlightEffect({ flights, onFlightDone }: { flights: CardFlight[]; onFlightDone: (id: string) => void }) {
  if (flights.length === 0) return null;
  return (
    <>
      {flights.map((flight) => (
        <FlightItem key={flight.id} flight={flight} onDone={onFlightDone} />
      ))}
    </>
  );
}
