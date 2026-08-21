"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CardFace, type CardFaceSize } from "./CardFace";
import type { Card, PlayerCount } from "./engine";

/**
 * 운명전쟁39's cosmetic flourishes — same `<Game>Effects.tsx` convention as
 * every other game in this project (see e.g. bang/BangEffects.tsx,
 * grid-poker/GridPokerEffects.tsx). Covers the 2026-08-22 "히든 발동, 카드
 * 제출, 예측 성공/초과/미달 결과" effects session (see HANDOFF.md):
 *
 *  - `PlayedCardSlot` — every card's table-slot entrance (slide & drop) plus
 *    the 0/Death special-card impacts, used by DestinyWar39Board.tsx in both
 *    the live "playing" phase slots and the post-turn freeze-frame.
 *  - `ReverseSwishOverlay` — the screen-wide border swish tied to a turn's
 *    FINAL reverse-parity result (not to any individual reverse card
 *    landing — see globals.css's `destinywar39-reverse-swish` doc).
 *  - `HiddenActivationBadge` — the 🙈 badge's flip-in glow+sparkle the
 *    instant a seat spends their lifetime hidden token.
 *  - `HiddenRevealCell` — the game-over flip+shatter reveal of a previously
 *    hidden prediction, once all 9 rounds are done (rulebook §8).
 *  - `RoundResultBadge` — the round-end summary table's per-row Exact
 *    Hit/Over/Under flourish.
 *
 * None of this needs a state-diffing detector like Bang/CoupEffects' —
 * every trigger here is either a plain "does this element exist yet" mount
 * (hidden badge, hidden reveal, round result) or an externally-owned
 * boolean flag the caller flips (reverse swish), so no extra event queue is
 * needed on top of what DestinyWar39Board.tsx already tracks.
 */

const DEATH_SMOKE_OFFSETS: { leftPct: number; delayMs: number }[] = [
  { leftPct: 28, delayMs: 0 },
  { leftPct: 50, delayMs: 90 },
  { leftPct: 72, delayMs: 180 },
];

export interface PlayedCardSlotProps {
  card: Card;
  playerCount: PlayerCount;
  size?: CardFaceSize;
  className?: string;
}

/**
 * A single played card's table-slot entrance — slide & drop into place (see
 * globals.css's `destinywar39-card-slide-drop` doc for why this is a fixed
 * relative-offset entrance rather than a real hand->table coordinate
 * flight), plus a special-card impact layered onto the SAME wrapper so both
 * animations can run without fighting over the `transform` property: the
 * slide-drop finishes at 0.35s already settled at its identity transform,
 * then Death's glitch jitter (delayed to start exactly then) takes over
 * cleanly. Reverse cards get no local impact here — their swish is a
 * screen-wide effect tied to the turn's FINAL parity result, not to any one
 * card landing (see `ReverseSwishOverlay`).
 *
 * Callers must remount this per card (`key={card.id}`) for the entrance to
 * replay — same "key remount to replay a mount-only keyframe" convention
 * documented in grid-poker/GridPokerEffects.tsx's module doc.
 */
export function PlayedCardSlot({ card, playerCount, size = "md", className = "" }: PlayedCardSlotProps) {
  const isZero = card.kind === "number" && card.value === 0;
  const isDeath = card.kind === "death";

  let animation = "destinywar39-card-slide-drop 0.35s ease-out both";
  if (isZero) animation += ", destinywar39-zero-pulse 0.7s ease-out";
  if (isDeath) animation += ", destinywar39-death-glitch 0.5s ease-in-out 0.35s both";

  return (
    <span className="relative inline-block rounded-lg" style={{ animation }}>
      {isDeath &&
        DEATH_SMOKE_OFFSETS.map((o, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute text-sm"
            style={{ left: `${o.leftPct}%`, top: "50%", animation: `destinywar39-death-smoke-puff 0.8s ease-out ${o.delayMs}ms both` }}
          >
            💨
          </span>
        ))}
      <CardFace card={card} playerCount={playerCount} size={size} className={className} />
    </span>
  );
}

const REVERSE_SWISH_MS = 700;

/**
 * Full-screen border swish the instant a turn resolves with reverse active.
 * Caller owns the trigger (mounts this exactly when it wants the swish to
 * play, e.g. `resolvingTurn.reverseActive`) and gets `onDone` back to clear
 * its flag — same portal-toast pattern as bang/BangEffects.tsx's
 * `CenterPlayBanner`.
 */
export function ReverseSwishOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, REVERSE_SWISH_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, same pattern as every other <Game>Effects.tsx toast
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70]" style={{ animation: "destinywar39-reverse-swish 0.7s ease-out" }} />,
    document.body,
  );
}

const HIDDEN_SPARKLE_OFFSETS: { x: number; y: number; delayMs: number }[] = [
  { x: -12, y: -10, delayMs: 0 },
  { x: 12, y: -12, delayMs: 60 },
  { x: 0, y: 12, delayMs: 30 },
];

/**
 * The 🙈 badge a seat's row gets the instant they spend their lifetime
 * hidden token (see PredictionStatusBoard.tsx) — a purple glow ring +
 * a few sparkle twinkles, shared by every connected client since
 * `hiddenUsed` is ordinary lockstep state everyone sees flip at once.
 * Relies on this element only ever mounting once (`hiddenUsed` never resets
 * back to false) for the "plays once" read — no extra "just activated"
 * tracking needed, a plain re-render of an already-mounted element does not
 * restart its CSS `animation`.
 */
export function HiddenActivationBadge({ title }: { title: string }) {
  return (
    <span className="relative inline-flex" title={title}>
      {HIDDEN_SPARKLE_OFFSETS.map((s, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-[9px] text-fuchsia-300"
          style={{ left: `calc(50% + ${s.x}px)`, top: `calc(50% + ${s.y}px)`, animation: `destinywar39-hidden-sparkle 0.7s ease-out ${s.delayMs}ms both` }}
        >
          ✨
        </span>
      ))}
      <span className="rounded-full" style={{ animation: "destinywar39-hidden-activate-glow 0.6s ease-out both" }}>
        🙈
      </span>
    </span>
  );
}

const SHATTER_FRAGMENTS: { dx: number; dy: number; rot: number; delayMs: number }[] = [
  { dx: 0, dy: -22, rot: 40, delayMs: 0 },
  { dx: 19, dy: -12, rot: -50, delayMs: 20 },
  { dx: 20, dy: 10, rot: 70, delayMs: 40 },
  { dx: 0, dy: 22, rot: -30, delayMs: 10 },
  { dx: -20, dy: 10, rot: 60, delayMs: 30 },
  { dx: -19, dy: -12, rot: -70, delayMs: 50 },
];

/**
 * Wraps a previously-hidden prediction's value in the game-over final
 * results table — flips into view with a bright flash + "?" fragment shards
 * flying outward, the moment all 9 rounds' hidden predictions are revealed
 * at once (rulebook §8, §12). Relies on the game-over table only ever
 * mounting fresh on the `roundEnd` -> `gameOver` phase transition (a
 * different JSX branch entirely — see DestinyWar39Board.tsx) for the "plays
 * once" read.
 */
export function HiddenRevealCell({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center [transform-style:preserve-3d]" style={{ animation: "destinywar39-card-flip 0.6s ease-out" }}>
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-2 rounded-full bg-fuchsia-400/50 blur-sm"
        style={{ animation: "destinywar39-hidden-shatter-flash 0.5s ease-out" }}
      />
      {SHATTER_FRAGMENTS.map((f, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 text-[8px] text-fuchsia-200"
          style={
            {
              "--dx": `${f.dx}px`,
              "--dy": `${f.dy}px`,
              "--rot": `${f.rot}deg`,
              animation: `destinywar39-hidden-shatter-fragment 0.6s ease-out ${f.delayMs}ms both`,
            } as CSSProperties
          }
        >
          ▪
        </span>
      ))}
      <span className="relative z-10">{children}</span>
    </span>
  );
}

export type RoundOutcome = "success" | "over" | "under";

const RESULT_PARTICLE_OFFSETS: { dx: number; dy: number; rot: number; delayMs: number }[] = [
  { dx: -30, dy: -22, rot: 30, delayMs: 0 },
  { dx: 26, dy: -26, rot: -40, delayMs: 40 },
  { dx: -34, dy: 6, rot: 60, delayMs: 80 },
  { dx: 32, dy: 10, rot: -60, delayMs: 20 },
  { dx: -14, dy: -34, rot: 20, delayMs: 100 },
  { dx: 16, dy: 30, rot: -20, delayMs: 60 },
];

const RESULT_META: Record<
  RoundOutcome,
  { badgeLabel: string; particleEmoji: string; badgeClass: string; particleClass: string; stampAnimation: string }
> = {
  success: {
    badgeLabel: "🎉 PERFECT",
    particleEmoji: "✨",
    badgeClass: "border-amber-300/70 bg-gradient-to-r from-amber-500/25 to-emerald-500/20 text-amber-100 shadow-[0_0_16px_-2px_rgba(252,211,77,0.6)]",
    particleClass: "text-amber-300",
    stampAnimation: "destinywar39-stamp-bounce 0.5s ease-out both",
  },
  over: {
    badgeLabel: "⚠️ OVER",
    particleEmoji: "🔥",
    badgeClass: "border-orange-400/70 bg-orange-500/15 text-orange-200",
    particleClass: "text-orange-300",
    stampAnimation: "destinywar39-badge-shake 0.5s ease-in-out 0.15s 2",
  },
  under: {
    badgeLabel: "🥶 MISS",
    particleEmoji: "❄️",
    badgeClass: "border-sky-400/50 bg-sky-500/10 text-sky-200",
    particleClass: "text-sky-300",
    stampAnimation: "destinywar39-badge-drop-fade 0.8s ease-out both",
  },
};

/**
 * Round-end summary table's per-row outcome flourish (see
 * DestinyWar39Board.tsx's roundEnd table) — gold/green confetti + a
 * bouncing "PERFECT" stamp on an exact hit, orange embers + a shaking
 * "OVER" badge on an over-prediction, blue frost flecks + a drooping "MISS"
 * badge on an under-prediction.
 *
 * Never render this for a row whose prediction is hidden from the viewer
 * (see engine.ts's `visiblePastPrediction`) — a distinct outcome badge would
 * leak exactly what that redaction is meant to hide, the same reason that
 * row's score cell is already masked to "?".
 *
 * Relies on the round-end block remounting fresh each round
 * (`key={round.roundNumber}` on the containing element in
 * DestinyWar39Board.tsx) for the "plays once per round" read.
 */
export function RoundResultBadge({ outcome }: { outcome: RoundOutcome }) {
  const meta = RESULT_META[outcome];
  return (
    <span className="relative inline-flex items-center justify-center">
      {RESULT_PARTICLE_OFFSETS.map((p, i) => (
        <span
          key={i}
          aria-hidden
          className={`pointer-events-none absolute left-1/2 top-1/2 text-xs ${meta.particleClass}`}
          style={
            {
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--rot": `${p.rot}deg`,
              animation: `destinywar39-particle-burst 1.3s ease-out ${p.delayMs}ms both`,
            } as CSSProperties
          }
        >
          {meta.particleEmoji}
        </span>
      ))}
      <span
        className={`relative z-10 rounded-full border px-2 py-0.5 text-[10px] font-extrabold whitespace-nowrap tracking-wide ${meta.badgeClass}`}
        style={{ animation: meta.stampAnimation }}
      >
        {meta.badgeLabel}
      </span>
    </span>
  );
}
