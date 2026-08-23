"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CardFace, type CardFaceSize } from "./CardFace";
import { deckModeConfig, isReverseCard, type Card, type PlayerCount } from "./engine";

/**
 * 운명전쟁39's cosmetic flourishes — same `<Game>Effects.tsx` convention as
 * every other game in this project (see e.g. bang/BangEffects.tsx,
 * grid-poker/GridPokerEffects.tsx). Covers the 2026-08-22 "히든 발동, 카드
 * 제출, 예측 성공/초과/미달 결과" effects session (see HANDOFF.md):
 *
 *  - `PlayedCardSlot` — every card's table-slot entrance (slide & drop) plus
 *    a "massive impact" landing pass (2026-08-22 turn-order/impact session):
 *    a generic shockwave ring + spark burst on every card, a continuous
 *    gold glow scaled by number value, and per-type escalations (Death's
 *    own dark-red ring on top of its existing glitch+smoke, a reverse card's
 *    gold->fuchsia swirl gated on that turn's FINAL resolved parity). Used
 *    by DestinyWar39Board.tsx in both the live "playing" phase slots and the
 *    post-turn freeze-frame.
 *  - `TurnOrderBadge` — the ①②③… reveal-order badge shown above each seat's
 *    slot from round 2 on (round 1 is a simultaneous reveal with no lead
 *    player at all, so it never gets one — see DestinyWar39Board.tsx's
 *    `turnOrderBySeat`), pulsing gold while it's that seat's turn and
 *    dimming with a ✓ once they've played.
 *  - `ReverseSwishOverlay` — the screen-wide border swish tied to a turn's
 *    FINAL reverse-parity result (not to any individual reverse card
 *    landing — see globals.css's `destinywar39-reverse-swish` doc). Kept
 *    alongside `PlayedCardSlot`'s own per-card swirl above — the screen-wide
 *    sweep reads as "something big just happened", the per-card swirl marks
 *    exactly which card(s) caused it.
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

// Landing spark fan (2026-08-22 impact escalation) — bursts from the card's
// bottom edge outward ("카드 하단에서... 사방으로"), reusing the same
// --dx/--dy/--rot `destinywar39-particle-burst` keyframe every other burst
// in this file already uses; only the offsets/color/timing differ per card.
// Matches the slide-drop's own 0.35s duration — every impact below starts
// exactly when the card settles at its identity transform (see
// `PlayedCardSlot`'s doc), so nothing fights over `transform` mid-flight.
const LANDING_IMPACT_DELAY_MS = 350;

const LANDING_SPARK_OFFSETS: { dx: number; dy: number; rot: number; delayMs: number }[] = [
  { dx: -26, dy: 16, rot: -30, delayMs: 0 },
  { dx: 22, dy: 18, rot: 40, delayMs: 20 },
  { dx: -14, dy: 24, rot: -60, delayMs: 40 },
  { dx: 16, dy: 26, rot: 60, delayMs: 10 },
  { dx: -30, dy: 6, rot: -15, delayMs: 60 },
  { dx: 30, dy: 8, rot: 15, delayMs: 30 },
];

export interface PlayedCardSlotProps {
  card: Card;
  playerCount: PlayerCount;
  size?: CardFaceSize;
  className?: string;
  /**
   * Pass `true` ONLY once the containing turn's reverse parity has actually
   * resolved active (`TurnRecord.reverseActive`) — e.g. from the post-turn
   * freeze-frame, never from a live "playing"-phase slot where the turn
   * hasn't finished yet. Two reverse cards landing the same turn cancel each
   * other out (rulebook §6.1), so animating this at play() time could show a
   * reverse swirl on a card that turns out not to have activated anything —
   * this session's confirmed answer was to gate it on the resolved result
   * instead, same timing `ReverseSwishOverlay` already uses.
   */
  reverseActiveThisTurn?: boolean;
}

/**
 * A single played card's table-slot entrance — slide & drop into place (see
 * globals.css's `destinywar39-card-slide-drop` doc for why this is a fixed
 * relative-offset entrance rather than a real hand->table coordinate
 * flight), plus every landing impact layered onto the SAME wrapper so none
 * of them fight over the `transform`/`box-shadow` properties: the slide-drop
 * finishes at 0.35s already settled at its identity transform, and every
 * impact below is either delayed to start exactly then (Death's glitch, the
 * shockwave rings, the number glow) or drawn as a separate absolutely
 * positioned child (the spark dots, Death's smoke, the reverse swirl) so it
 * never has to share a `transform`/`box-shadow` with the slide-drop itself.
 *
 * Every card gets the generic landing shockwave ring + spark burst (2026-
 * 08-22 "massive impact" escalation); number cards additionally get a
 * gold glow scaled continuously by `value / maxNumber` ("숫자의 위력에
 * 비례"); Death gets its own bigger dark-red ring on top of the pre-existing
 * glitch+smoke; a reverse card gets its per-card gold→fuchsia swirl only
 * when `reverseActiveThisTurn` says so (see that prop's doc).
 *
 * Callers must remount this per card (`key={card.id}`) for the entrance to
 * replay — same "key remount to replay a mount-only keyframe" convention
 * documented in grid-poker/GridPokerEffects.tsx's module doc.
 */
export function PlayedCardSlot({ card, playerCount, size = "md", className = "", reverseActiveThisTurn = false }: PlayedCardSlotProps) {
  const isZero = card.kind === "number" && card.value === 0;
  const isDeath = card.kind === "death";
  const isReverse = isReverseCard(card, playerCount);
  // Continuous "power" ratio for the gold glow — every ordinary number > 0
  // gets some glow, scaling up toward the deck's strongest card, rather than
  // an arbitrary "high number" cutoff.
  const numberRatio = card.kind === "number" && card.value > 0 ? card.value / deckModeConfig(playerCount).maxNumber : 0;

  let animation = "destinywar39-card-slide-drop 0.35s ease-out both";
  if (isZero) animation += ", destinywar39-zero-pulse 0.7s ease-out";
  if (isDeath) animation += ", destinywar39-death-glitch 0.5s ease-in-out 0.35s both, destinywar39-land-shockwave-death 0.6s ease-out 0.35s both";
  else animation += ", destinywar39-land-shockwave 0.5s ease-out 0.35s both";
  if (numberRatio > 0) animation += ", destinywar39-number-glow-burst 0.55s ease-out 0.35s both";
  if (isReverse && reverseActiveThisTurn) animation += ", destinywar39-reverse-card-swirl 0.6s ease-out 0.35s both";

  const sparkClass = isDeath ? "text-red-400" : isZero ? "text-sky-300" : "text-white/80";

  return (
    <span
      className="relative inline-block rounded-lg"
      style={
        {
          animation,
          ...(numberRatio > 0 ? { "--glow-alpha": String(0.2 + numberRatio * 0.45), "--glow-blur": `${10 + numberRatio * 16}px` } : {}),
        } as CSSProperties
      }
    >
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
      {LANDING_SPARK_OFFSETS.map((s, i) => (
        <span
          key={i}
          aria-hidden
          className={`pointer-events-none absolute bottom-0 left-1/2 text-[9px] ${sparkClass}`}
          style={
            {
              "--dx": `${s.dx}px`,
              "--dy": `${s.dy}px`,
              "--rot": `${s.rot}deg`,
              animation: `destinywar39-particle-burst 0.5s ease-out ${LANDING_IMPACT_DELAY_MS + s.delayMs}ms both`,
            } as CSSProperties
          }
        >
          •
        </span>
      ))}
      <CardFace card={card} playerCount={playerCount} size={size} className={className} />
    </span>
  );
}

export interface TurnOrderBadgeProps {
  /** 1-indexed reveal position within the current turn, clockwise from that round's turnLeader (see DestinyWar39Board.tsx's `turnOrderBySeat`). */
  order: number;
  /** This seat is the one currently expected to act. */
  isActive: boolean;
  /** This seat has already played its card this turn. */
  isDone: boolean;
}

/**
 * The ①②③… reveal-order badge shown above each seat's slot during the
 * "playing" phase, from round 2 on (round 1 is a simultaneous reveal with no
 * lead player at all — engine.ts's `nextToActInTurn` doc — so
 * DestinyWar39Board.tsx never computes an order for it and this never
 * mounts there, per this session's confirmed answer). Doubles as the "이미
 * 제출 완료" indicator: a done seat's badge dims and gets a ✓ overlay
 * instead of glowing, so who's left to act reads at a glance without having
 * to scan every slot for a face-up card.
 */
export function TurnOrderBadge({ order, isActive, isDone }: TurnOrderBadgeProps) {
  return (
    <span
      className={`relative grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
        isDone
          ? "border-white/15 bg-white/5 text-white/40 opacity-60"
          : isActive
            ? "border-amber-300 bg-amber-500/25 text-amber-100"
            : "border-white/25 bg-white/10 text-white/70"
      }`}
      style={isActive ? { animation: "destinywar39-turn-badge-pulse 1.1s ease-in-out infinite" } : undefined}
    >
      {order}
      {isDone && (
        <span aria-hidden className="absolute -top-1.5 -right-1.5 grid h-3 w-3 place-items-center rounded-full bg-emerald-500 text-[7px] leading-none text-white">
          ✓
        </span>
      )}
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
 * `hiddenUsed`/`hiddenRound` is ordinary lockstep state everyone sees flip
 * at once. Scoped to the round it was spent on (2026-08-23 confirmed
 * answer): PredictionStatusBoard.tsx only mounts this while
 * `round.roundNumber === player.hiddenRound`, so it disappears once
 * `nextRound` advances past that round and never reappears (the lifetime
 * token itself stays spent — this is purely a "which round" spotlight, not
 * a running "already used" indicator). Relies on this element only ever
 * mounting once per game for the "plays once" read — no extra "just
 * activated" tracking needed, a plain re-render of an already-mounted
 * element does not restart its CSS `animation`.
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
