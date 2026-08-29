"use client";

import { useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CardChip, SUIT_SYMBOL } from "./cardDisplay";
import {
  LINE_LABELS,
  LINES,
  formatHandLabel,
  type PlayerState,
  type RoundResult,
  type SeatIndex,
  type Suit,
} from "./engine";
import { isDoubleTap } from "./skipGesture";

/**
 * The round-win celebration overlay — a full-screen portal shown while
 * `state.phase === "round-result"` (engine.ts's module doc "Flow" section
 * and `advanceRoundResult`). Otherwise a pure rendering layer — the host's
 * own fixed timer (GridPokerGame.tsx) is what actually advances the phase
 * once `ROUND_RESULT_SECONDS` elapses, and `timeLeft`/`secondsTotal` here
 * only feed the "다음 라운드 준비" countdown bar every client renders
 * locally so it finishes in step with that timer — except for `onSkip`
 * (see the "Skip" section below), the one action this overlay does dispatch.
 *
 * Two branches, per the confirmed design (Strict-No-Assumption Q&A,
 * 2026-08-24 session): a genuine winner gets the full epic treatment (gold
 * sunburst + confetti + a stamped "ROUND N WIN!" emblem with a brief screen
 * shake + the winning line's 5 cards pulsing gold on a mini board diagram);
 * a tie gets one deliberately subdued recap card and nothing else — no
 * particles, no shake, no stamp. Every viewer (winner and losers alike)
 * sees the exact same content — there is no separate "you lost" framing,
 * matching requirement 3's "losers should still get to watch the winner's
 * play, not a blank wait".
 *
 * Skip (Strict-No-Assumption Q&A, 2026-08-29 session): every field already
 * renders the round's fully-resolved final state the instant this overlay
 * mounts — there's no partial/in-progress reveal to fast-forward through,
 * only the fixed `ROUND_RESULT_SECONDS` wait itself. `onSkip` (top-right
 * button, or a double-tap anywhere on the backdrop) calls straight through
 * to the same `{ type: "advance-round-result" }` engine action the host's
 * own timer fires (see GridPokerGame.tsx) — any single viewer's skip ends
 * the wait for *everyone* immediately, since that action is a plain
 * broadcast Realtime action like any other (not host-gated) and a no-op
 * once the phase has already moved on (engine.ts's `advanceRoundResult`),
 * so a near-simultaneous skip from more than one viewer is always safe.
 */
export interface RoundResultOverlayProps {
  result: RoundResult;
  players: PlayerState[];
  names: Record<SeatIndex, string>;
  winThreshold: number;
  viewerSeat: SeatIndex;
  timeLeft: number;
  secondsTotal: number;
  /** Ends the round-result wait immediately for every connected viewer — see the module doc's "Skip" section. */
  onSkip: () => void;
}

/** One badge look per seat (up to 8, this game's max player count) — deterministic by seat index, no naming/photo system exists elsewhere in this game to draw from. */
const SEAT_PALETTE = [
  { ring: "ring-amber-300/80", chip: "bg-amber-400/25 text-amber-100", solid: "bg-amber-400" },
  { ring: "ring-sky-300/80", chip: "bg-sky-400/25 text-sky-100", solid: "bg-sky-400" },
  { ring: "ring-rose-300/80", chip: "bg-rose-400/25 text-rose-100", solid: "bg-rose-400" },
  { ring: "ring-emerald-300/80", chip: "bg-emerald-400/25 text-emerald-100", solid: "bg-emerald-400" },
  { ring: "ring-violet-300/80", chip: "bg-violet-400/25 text-violet-100", solid: "bg-violet-400" },
  { ring: "ring-cyan-300/80", chip: "bg-cyan-400/25 text-cyan-100", solid: "bg-cyan-400" },
  { ring: "ring-orange-300/80", chip: "bg-orange-400/25 text-orange-100", solid: "bg-orange-400" },
  { ring: "ring-lime-300/80", chip: "bg-lime-400/25 text-lime-100", solid: "bg-lime-400" },
];
function seatPalette(seat: SeatIndex) {
  return SEAT_PALETTE[seat % SEAT_PALETTE.length];
}

const SUIT_OVERLAY_CLASS: Record<Suit, string> = {
  S: "text-slate-100",
  C: "text-slate-100",
  D: "text-rose-300",
  H: "text-rose-300",
};

/** Purely decorative flavor for the headline's suit glyph (e.g. "♠ 풀 하우스") — the most frequent suit among the winning hand's 5 resolved cards, ties broken by first-card order. Not a rules concept; `evaluateHand`'s own category/rank comparison is untouched by this. */
function dominantSuit(cards: { suit: Suit }[]): Suit {
  const counts = new Map<Suit, number>();
  for (const c of cards) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  let best = cards[0].suit;
  let bestCount = 0;
  for (const [suit, count] of counts) {
    if (count > bestCount) {
      best = suit;
      bestCount = count;
    }
  }
  return best;
}

/** Fixed deterministic confetti scatter (24 pieces) — index-driven pseudo-variety via distinct small-prime multipliers, never `Math.random()`, so a server-rendered first paint can never mismatch a client hydration pass (same rationale as GridPokerEffects.tsx's SPARKLE_OFFSETS, scaled up for a screen-filling burst instead of a small badge). */
const CONFETTI_COLORS = ["#fbbf24", "#f59e0b", "#fde68a", "#ffffff", "#fca5a5"];
const CONFETTI_COUNT = 24;
const CONFETTI_PIECES = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
  leftPct: (i * 37) % 100,
  driftStart: ((i * 53) % 60) - 30,
  driftEnd: ((i * 71) % 160) - 80,
  delayMs: (i * 83) % 700,
  durationMs: 2200 + ((i * 47) % 900),
  size: 6 + (i % 4) * 2,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  rounded: i % 3 === 0,
}));

function ConfettiBurst() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI_PIECES.map((p, i) => (
        <span
          key={i}
          className="absolute top-0"
          style={
            {
              left: `${p.leftPct}%`,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.rounded ? "9999px" : "2px",
              "--confetti-drift-start": `${p.driftStart}px`,
              "--confetti-drift-end": `${p.driftEnd}px`,
              animation: `gp-confetti-fall ${p.durationMs}ms ${p.delayMs}ms ease-in forwards`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function GoldSunburst() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-70"
      style={{
        background: "repeating-conic-gradient(from 0deg, rgba(251,191,36,0.4) 0deg 5deg, transparent 5deg 22deg)",
        maskImage: "radial-gradient(circle, black 0%, black 28%, transparent 66%)",
        WebkitMaskImage: "radial-gradient(circle, black 0%, black 28%, transparent 66%)",
        animation: "gp-sunburst-spin 16s linear infinite",
      }}
    />
  );
}

function VictoryStamp({ roundNumber }: { roundNumber: number }) {
  return (
    <div
      aria-hidden
      className="relative z-10 rounded-2xl border-4 border-amber-300/90 bg-gradient-to-b from-rose-600/95 to-rose-800/95 px-5 py-1.5 text-center shadow-[0_10px_40px_-8px_rgba(0,0,0,0.85)]"
      style={{ animation: "gp-victory-stamp-in 0.55s cubic-bezier(0.34,1.56,0.64,1) both" }}
    >
      <span className="block text-lg font-black tracking-wider text-amber-50 sm:text-xl">[ ROUND {roundNumber} WIN! ]</span>
    </div>
  );
}

/**
 * Mini 5x5 diagram of the winner's board with only the winning line's 5
 * cells lit up — read from `winner.board` directly (not `result`'s own
 * `hand.cards`, which `evaluateHand` may have reordered/resolved jokers
 * into a different sequence than the physical board positions — see
 * engine.ts's `evaluateHand`). Safe to read the winner's raw board here
 * regardless of viewer identity: submitting a line always publicly reveals
 * it via `usedLines` (see `visibleOpponentBoard`), and by "round-result"
 * this particular line already has been.
 */
function WinningLineGrid({ winner, lineIndex }: { winner: PlayerState; lineIndex: number }) {
  const cellSet = new Set(LINES[lineIndex]);
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl border border-amber-400/20 bg-black/30 p-2">
      {Array.from({ length: 25 }, (_, cell) => {
        if (!cellSet.has(cell)) {
          return <span key={cell} aria-hidden className="h-8 w-6 rounded-sm bg-white/[0.03] sm:h-9 sm:w-7" />;
        }
        const posInLine = LINES[lineIndex].indexOf(cell);
        const card = winner.board[cell];
        if (!card) return <span key={cell} aria-hidden className="h-8 w-6 sm:h-9 sm:w-7" />;
        return (
          <span
            key={cell}
            className="inline-block rounded-md"
            style={{ animation: `gp-winline-pulse-in 0.6s ease-out ${posInLine * 90}ms both, gp-winline-float 2.4s ease-in-out ${0.6 + posInLine * 0.09}s infinite` }}
          >
            <CardChip card={card} size="sm" />
          </span>
        );
      })}
    </div>
  );
}

/** Score-progress dots, same visual language as GridPokerBoard.tsx's own leaderboard `WinDots` — kept as its own small copy here rather than imported, so this overlay doesn't reach back into GridPokerBoard.tsx (which is the file that renders this overlay) and create a import cycle. */
function ProgressDots({ wins, threshold }: { wins: number; threshold: number }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: threshold }, (_, i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${i < wins ? "bg-amber-300" : "border border-white/25 bg-transparent"}`} />
      ))}
    </span>
  );
}

function NextRoundCountdown({ timeLeft, secondsTotal }: { timeLeft: number; secondsTotal: number }) {
  const pct = Math.max(0, Math.min(100, (timeLeft / secondsTotal) * 100));
  return (
    <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-white/50 uppercase">다음 라운드 준비</span>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Fixed top-right skip affordance (confirmed placement, 2026-08-29
 * Strict-No-Assumption Q&A) — `stopPropagation` keeps a tap on the button
 * itself from also bubbling up into the backdrop's double-tap counter
 * below, so a single button press never risks being read as "tap 1 of 2".
 */
function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSkip();
      }}
      className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-full border border-white/25 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur transition hover:border-white/50 hover:bg-black/70 hover:text-white active:scale-95"
      aria-label="연출 스킵하고 다음 라운드로 바로 넘어가기"
    >
      ⏩ 연출 스킵
    </button>
  );
}

export default function RoundResultOverlay({
  result,
  players,
  names,
  winThreshold,
  viewerSeat,
  timeLeft,
  secondsTotal,
  onSkip,
}: RoundResultOverlayProps) {
  // Guards against firing `onSkip` more than once per mount — a fast double
  // press on the button, or a button press right after a backdrop
  // double-tap, would otherwise re-broadcast `advance-round-result`
  // needlessly (harmless — the action is idempotent — but wasteful). Reset
  // is automatic: this overlay only ever mounts fresh per round (the parent
  // renders it solely while `state.phase === "round-result"`), so a stale
  // `true` from a previous round can never leak into the next one.
  const hasSkippedRef = useRef(false);
  const lastTapRef = useRef(0);

  function triggerSkip() {
    if (hasSkippedRef.current) return;
    hasSkippedRef.current = true;
    onSkip();
  }

  /** Backdrop double-tap (mobile "그냥 화면 아무 곳이나 두 번" fast-forward) — a plain onClick, not onDoubleClick: React normalizes a touch tap into a click event reliably across mobile browsers, while native `dblclick` synthesis from touch is inconsistent, so a manual timestamp comparison (see skipGesture.ts's `isDoubleTap`) is the more robust choice here. */
  function handleBackdropTap() {
    const now = Date.now();
    if (isDoubleTap(lastTapRef.current, now)) {
      lastTapRef.current = 0;
      triggerSkip();
    } else {
      lastTapRef.current = now;
    }
  }

  if (typeof document === "undefined") return null;

  const winnerSeat = result.winnerSeat;
  const winner = winnerSeat !== null ? players.find((p) => p.seat === winnerSeat) : undefined;
  const winnerSubmission = winnerSeat !== null ? result.submissions.find((s) => s.seat === winnerSeat) : undefined;

  const body =
    winnerSeat !== null && winner && winnerSubmission ? (
      <div
        className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/80 p-4"
        style={{ animation: "gp-round-overlay-in 0.35s ease-out both, gp-round-overlay-shake 0.5s ease-out 0.15s both" }}
        onClick={handleBackdropTap}
      >
        <SkipButton onSkip={triggerSkip} />
        <GoldSunburst />
        <ConfettiBurst />
        <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 py-6 text-center">
          <VictoryStamp roundNumber={result.roundNumber} />

          <h2 className="text-2xl font-extrabold text-amber-200 drop-shadow-[0_0_18px_rgba(251,191,36,0.85)] sm:text-3xl">
            👑 ROUND WINNER
          </h2>
          <div className="flex items-center gap-2">
            <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ring-2 ${seatPalette(winnerSeat).ring} ${seatPalette(winnerSeat).chip}`}>
              {names[winnerSeat]?.slice(0, 1) ?? "?"}
            </span>
            <span className="text-xl font-bold text-white">
              {names[winnerSeat]}
              {winnerSeat === viewerSeat && <span className="ml-1 text-sm font-normal text-emerald-300">(나)</span>}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-lg font-bold">
            <span className={SUIT_OVERLAY_CLASS[dominantSuit(winnerSubmission.hand.cards)]}>
              {SUIT_SYMBOL[dominantSuit(winnerSubmission.hand.cards)]}
            </span>
            <span className="text-amber-100">{formatHandLabel(winnerSubmission.hand)}</span>
            <span className="text-xs font-normal text-white/40">({LINE_LABELS[winnerSubmission.lineIndex]})</span>
          </div>

          <WinningLineGrid winner={winner} lineIndex={winnerSubmission.lineIndex} />

          <div className="flex items-center gap-2 text-sm text-amber-100">
            <span>🏆 {winner.score}승 달성 ({winner.score}/{winThreshold})</span>
            <ProgressDots wins={winner.score} threshold={winThreshold} />
          </div>

          <NextRoundCountdown timeLeft={timeLeft} secondsTotal={secondsTotal} />
        </div>
      </div>
    ) : (
      // Genuine tie — deliberately subdued: no sunburst/confetti/stamp/shake,
      // just a plain recap of everyone's hand this round (confirmed design,
      // Q3 of the Strict-No-Assumption pass).
      <div
        className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
        style={{ animation: "gp-round-overlay-in 0.35s ease-out both" }}
        onClick={handleBackdropTap}
      >
        <SkipButton onSkip={triggerSkip} />
        <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-center">
          <span className="text-3xl">🤝</span>
          <h2 className="text-lg font-bold text-white/80">{result.roundNumber}라운드 · 무승부</h2>
          <div className="flex w-full flex-col gap-1">
            {result.submissions.map((sub) => (
              <div key={sub.seat} className="flex items-center justify-between gap-2 text-xs text-white/60">
                <span className="truncate">{names[sub.seat]}</span>
                <span>{formatHandLabel(sub.hand)}</span>
              </div>
            ))}
          </div>
          <NextRoundCountdown timeLeft={timeLeft} secondsTotal={secondsTotal} />
        </div>
      </div>
    );

  return createPortal(body, document.body);
}
