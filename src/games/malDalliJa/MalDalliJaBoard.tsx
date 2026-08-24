"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AnimatedHorse, MoveParticleLayer, buildMoveAnim, type MoveAnim, type MoveEvent, type MoveParticle } from "./MoveEffects";
import RulebookModal from "./RulebookModal";
import {
  BOARD_SIZE,
  OASIS,
  getLegalMoves,
  isOasisZoneCell,
  otherSeat,
  positionsEqual,
  type EngineAction,
  type LegalMove,
  type MalDalliJaState,
  type Seat,
} from "./engine";

/**
 * Pure game UI + rules driver — knows nothing about betting, IndexedDB, or
 * networking. State is fully controlled by the caller (`MalDalliJaGame`,
 * which owns the Supabase Realtime sync): this component only ever emits
 * intent via `onAction`/`onGameEnd`, never mutates state itself.
 *
 * `turnTimerSec` is the room's optional §5 "착수 시간 제한" house rule
 * setting (null = disabled) — see the timer effect below and the trust-model
 * note in `engine.ts`'s module doc for why the countdown lives here instead
 * of in the engine.
 *
 * **2026-08-14 session (image-based redesign, see engine.ts's module doc)**:
 * each seat now has 10 horses across two diagonal corners instead of 1, so a
 * move is a two-tap gesture — tap one of your own horses to select it
 * (highlighting *that* horse's legal destinations), then tap a highlighted
 * cell to move it. `selectedHorseIndex` below is purely local UI state; the
 * engine has no notion of "selection", only of completed `move` actions
 * carrying a `horseIndex`. The oasis renders as a diamond-shaped zone
 * (pixel-matched to `말달리자판.png`): a large pulsing blue circle on the
 * dead-center cell, ringed by 12 green-circle cells — knight (L자) moves are
 * blocked anywhere in that 13-cell zone (`isOasisZoneCell`), only slide
 * moves work there.
 *
 * **2026-08-18 session (rulebook piece-photo swap)**: on-board horse tokens
 * render `SEAT_THEME[seat].pieceImage` (the real knight-chess-piece photos
 * from `boardGameRule/말달리자/`) instead of a bare 🐴/🐎 emoji — see
 * `SEAT_THEME`'s doc comment for the asset path and why the tile is
 * rectangular (`object-contain`) rather than a circular crop.
 *
 * **2026-08-24 session (gallop motion + particle effects, see
 * MoveEffects.tsx's module doc for the full design rationale and the
 * user-confirmed answers behind it)**: a completed move no longer just
 * teleports a horse token to its new cell — the `moveHistory`-diffing effect
 * below detects each freshly-appended `MoveRecord` (for *both* the local
 * player's own move and a synced opponent move, since both arrive the same
 * way: a new `state` prop with a longer `moveHistory`) and hands it to
 * `buildMoveAnim`, which the `animations` array renders as a flying
 * `AnimatedHorse` overlaid on the board — hop-by-hop for slides, a single
 * arc for knight jumps — while the *static* grid-cell token for that horse
 * is hidden for the animation's duration (`animatingKeys`, its
 * `state.positions` is already at the final cell the whole time). Dust,
 * impact-ring, speed-trail, and LEAD-badge particles spawn into the
 * `particles` array via the same event callback. The game-over overlay is
 * gated on `animations.length === 0` so a winning move's flight/impact
 * finishes playing before WINNER/ELIMINATED takes over the screen.
 */
export interface MalDalliJaBoardProps {
  state: MalDalliJaState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  ids: Record<Seat, string>;
  opponentConnected: boolean;
  turnTimerSec: number | null;
  onAction: (action: EngineAction) => void;
  onGameEnd: (winnerId: string) => void;
}

// `pieceImage` files are synced from `boardGameRule/말달리자/{검정색말,하얀색말}.jpg`
// (see MalDalliJaBoard.tsx's module doc, 2026-08-18 asset-swap session) into
// `public/images/mal-dallija/`, following the same
// rulebook-photo-to-`public/images/<kebab-game>/` convention as loveLetter's
// `CardArt.tsx`. Both source photos are knight-chess-piece line art on a
// plain white background (not transparent), so the on-board token wraps them
// in a small cream-colored tile (`object-contain`, not `-cover`, to avoid
// cropping the mane/ears) rather than the tighter circular badge used when
// the piece was a bare emoji — a circle crop of a knight silhouette loses
// too much of the art. The emoji is kept for the compact HUD turn indicator,
// where a photo tile would be too small to read.
const SEAT_THEME: Record<Seat, { name: string; emoji: string; pieceImage: string; glow: string; ring: string; text: string }> = {
  p1: {
    name: "흑마",
    emoji: "🐴",
    pieceImage: "/images/mal-dallija/black-horse.jpg",
    glow: "shadow-[0_0_18px_4px_rgba(244,63,94,0.55)]",
    ring: "border-rose-400",
    text: "text-rose-300",
  },
  p2: {
    name: "백마",
    emoji: "🐎",
    pieceImage: "/images/mal-dallija/white-horse.jpg",
    glow: "shadow-[0_0_18px_4px_rgba(34,211,238,0.55)]",
    ring: "border-cyan-300",
    text: "text-cyan-200",
  },
};

function cellKey(row: number, col: number) {
  return `${row}-${col}`;
}

export default function MalDalliJaBoard({
  state,
  viewerSeat,
  names,
  ids,
  opponentConnected,
  turnTimerSec,
  onAction,
  onGameEnd,
}: MalDalliJaBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const opponentSeat = otherSeat(viewerSeat);
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;

  // ---- Horse selection (local UI-only state) — reset the instant a new
  // turn begins, via the same "adjust state while rendering" pattern used
  // for the turn-timer reset below (avoids an extra render from a
  // setState-in-effect).
  const [selectedHorseIndex, setSelectedHorseIndex] = useState<number | null>(null);
  const [trackedSelectionTurn, setTrackedSelectionTurn] = useState(state.turnNumber);
  if (trackedSelectionTurn !== state.turnNumber) {
    setTrackedSelectionTurn(state.turnNumber);
    setSelectedHorseIndex(null);
  }

  const allLegalMoves: LegalMove[] = isMyTurn ? getLegalMoves(state) : [];
  const legalByCell = new Map<string, LegalMove>();
  if (selectedHorseIndex !== null) {
    for (const move of allLegalMoves) {
      if (move.horseIndex === selectedHorseIndex) legalByCell.set(cellKey(move.to.row, move.to.col), move);
    }
  }
  const movableHorseIndices = new Set(allLegalMoves.map((m) => m.horseIndex));

  const horseByCell = new Map<string, { seat: Seat; horseIndex: number }>();
  (["p1", "p2"] as const).forEach((seat) => {
    state.positions[seat].forEach((p, horseIndex) => {
      horseByCell.set(cellKey(p.row, p.col), { seat, horseIndex });
    });
  });

  // ---- Move animations (gallop hop / knight arc + dust/impact/speed-trail
  // /LEAD particles) — see this component's 2026-08-24 module-doc paragraph
  // and MoveEffects.tsx for the full design. `trackedMoveCount` starts at
  // the *current* length on mount (not 0) so joining mid-game or a
  // `state-sync` resync never replays the whole match's move history.
  //
  // Deliberately the same "adjust state while rendering" pattern as
  // `trackedSelectionTurn`/`trackedTurn` below (compare-and-setState
  // in-render, not a `useEffect`) rather than the pattern used by every
  // other `<Game>Effects.tsx` in this project — and not just for
  // consistency with this file's own two other trackers: an effect only
  // commits `setAnimations` *after* the "gameOver" render has already
  // painted, so the `animations.length === 0` game-over-overlay gate below
  // would flash the overlay on for one frame before the flying horse even
  // appears. Doing it in-render instead means React folds both state
  // updates into the same paint — see React's docs on "storing information
  // from previous renders".
  const [trackedMoveCount, setTrackedMoveCount] = useState(state.moveHistory.length);
  const [animations, setAnimations] = useState<MoveAnim[]>([]);
  const [particles, setParticles] = useState<MoveParticle[]>([]);
  const particleIdRef = useRef(0);
  if (trackedMoveCount !== state.moveHistory.length) {
    const nextCount = state.moveHistory.length;
    // Only animate a normal single-move increment — a resync/catch-up that
    // jumps by more than one move at once snaps positions instantly instead
    // (no animation queued), same reasoning as skipping the flood on mount.
    if (nextCount === trackedMoveCount + 1) {
      const record = state.moveHistory[nextCount - 1];
      const gameEndedByThisMove = state.phase === "gameOver" && state.winner === record.seat;
      const anim = buildMoveAnim(record, gameEndedByThisMove);
      if (anim) setAnimations((prev) => [...prev, anim]);
    }
    setTrackedMoveCount(nextCount);
  }

  const animatingKeys = new Set(animations.map((a) => `${a.seat}-${a.horseIndex}`));

  function handleAnimEvent(anim: MoveAnim, evt: MoveEvent) {
    const id = particleIdRef.current++;
    let particle: MoveParticle;
    switch (evt.type) {
      case "dust":
        particle = { id, kind: "dust", row: evt.row, col: evt.col };
        break;
      case "impact":
        particle = { id, kind: "impact", row: evt.row, col: evt.col, seat: anim.seat };
        break;
      case "streak":
        particle = { id, kind: "streak", row: evt.row, col: evt.col, angleDeg: evt.angleDeg, seat: anim.seat };
        break;
      case "knightTrail":
        particle = { id, kind: "knightTrail", row: evt.row, col: evt.col, liftPct: evt.liftPct };
        break;
      case "lead":
        particle = { id, kind: "lead", row: evt.row, col: evt.col, seat: anim.seat };
        break;
    }
    setParticles((prev) => [...prev, particle]);
  }
  function handleAnimDone(animId: number) {
    setAnimations((prev) => prev.filter((a) => a.id !== animId));
  }
  function handleParticleExpire(particleId: number) {
    setParticles((prev) => prev.filter((p) => p.id !== particleId));
  }

  // ---- §5 optional turn timer: a plain local countdown, reset every time
  // it becomes a new turn. Only the seat whose turn it actually is sends
  // the resulting `pass` — see engine.ts's module doc for the trust model.
  const [remainingSec, setRemainingSec] = useState<number | null>(turnTimerSec);
  const [trackedTurn, setTrackedTurn] = useState(state.turnNumber);
  // Reset the countdown the instant a new turn begins, via React's
  // documented "adjust state while rendering" pattern (comparing against a
  // tracked previous value and calling setState conditionally) rather than
  // a synchronous setState at the top of an effect — the latter trips the
  // set-state-in-effect lint rule and causes an extra unnecessary render.
  if (trackedTurn !== state.turnNumber) {
    setTrackedTurn(state.turnNumber);
    setRemainingSec(turnTimerSec);
  }
  useEffect(() => {
    if (turnTimerSec === null || state.phase !== "playing") return;
    const interval = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev === null) return prev;
        const next = prev - 1;
        // Fire `pass` exactly once, on the prev>0 -> next<=0 transition —
        // once remainingSec is clamped to 0 this guard never re-triggers,
        // so no separate "already passed" ref is needed.
        if (prev > 0 && next <= 0 && state.activeSeat === viewerSeat) {
          onAction({ type: "pass" });
        }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(interval);
    // Deliberately keyed on turnNumber (not just phase/turnTimerSec) so the
    // interval restarts fresh every turn instead of drifting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.turnNumber, state.phase, turnTimerSec]);

  function handleCellClick(row: number, col: number) {
    if (!isMyTurn) return;
    const key = cellKey(row, col);

    const move = legalByCell.get(key);
    if (move) {
      onAction({ type: "move", horseIndex: move.horseIndex, moveKind: move.moveKind, dr: move.dr, dc: move.dc });
      setSelectedHorseIndex(null);
      return;
    }

    const occupant = horseByCell.get(key);
    if (occupant && occupant.seat === viewerSeat && movableHorseIndices.has(occupant.horseIndex)) {
      setSelectedHorseIndex((prev) => (prev === occupant.horseIndex ? null : occupant.horseIndex));
    }
  }

  const cells = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const key = cellKey(row, col);
      const pos = { row, col };
      const isOasisCenter = positionsEqual(pos, OASIS);
      const isOasisRing = !isOasisCenter && isOasisZoneCell(pos);
      const move = legalByCell.get(key);
      const occupant = horseByCell.get(key);
      const isSelectableHorse =
        isMyTurn && occupant?.seat === viewerSeat && movableHorseIndices.has(occupant.horseIndex);
      const isSelected = isSelectableHorse && occupant!.horseIndex === selectedHorseIndex;

      cells.push(
        <button
          key={key}
          type="button"
          disabled={!move && !isSelectableHorse}
          onClick={() => handleCellClick(row, col)}
          className={`relative aspect-square border border-white/[0.06] transition ${
            (row + col) % 2 === 0 ? "bg-white/[0.02]" : "bg-black/20"
          } ${move || isSelectableHorse ? "cursor-pointer" : "cursor-default"}`}
        >
          {/* 말달리자판.png 기준 오아시스 다이아몬드 존 — 중앙 파란 원 + 초록 원 12개 */}
          {isOasisCenter && (
            <span
              className="absolute inset-[15%] rounded-full border-2 border-sky-200/80 bg-sky-400/60"
              style={{ animation: "maldallija-oasis-pulse 2.2s ease-in-out infinite" }}
            />
          )}
          {isOasisRing && <span className="absolute inset-[28%] rounded-full bg-emerald-400/50 ring-1 ring-emerald-300/60" />}
          {!isOasisCenter && !isOasisRing && (
            <span className="absolute inset-[40%] rounded-full bg-amber-200/20" />
          )}
          {move && (
            <span
              className={`absolute inset-[18%] rounded-full ${
                move.moveKind === "slide"
                  ? "bg-cyan-400/25 ring-1 ring-cyan-300/70"
                  : "bg-fuchsia-400/25 ring-1 ring-fuchsia-300/70"
              }`}
            />
          )}
          {/* Suppressed while this exact horse is mid-flight in the
              `AnimatedHorse` overlay above the grid — its `state.positions`
              is already at this final cell the whole time (see this
              component's 2026-08-24 module-doc paragraph), so rendering
              both here would show it twice. */}
          {occupant && !animatingKeys.has(`${occupant.seat}-${occupant.horseIndex}`) && (
            <span
              key={`${occupant.seat}-${occupant.horseIndex}-${row}-${col}`}
              className={`absolute inset-[10%] overflow-hidden rounded-lg border-2 bg-[#f5f0e6] shadow-[0_3px_8px_-1px_rgba(0,0,0,0.65)] transition ${SEAT_THEME[occupant.seat].ring} ${
                isSelected ? `${SEAT_THEME[occupant.seat].glow} scale-110` : ""
              }`}
              style={{ animation: "maldallija-horse-land 0.35s ease-out" }}
            >
              <Image
                src={SEAT_THEME[occupant.seat].pieceImage}
                alt={`${SEAT_THEME[occupant.seat].name} 말`}
                width={64}
                height={64}
                className="h-full w-full object-contain p-[8%]"
              />
            </span>
          )}
        </button>,
      );
    }
  }

  return (
    <div className="relative flex flex-col gap-4">
      {/* ---- HUD ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-[#050203] p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐎</span>
          <div>
            <p className="text-sm font-bold text-white">말달리자</p>
            <p className="text-[11px] text-white/40">단판 승부 · 데스게임 하우스 룰</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["p1", "p2"] as const).map((seat) => (
            <div
              key={seat}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                state.phase === "playing" && state.activeSeat === seat
                  ? `${SEAT_THEME[seat].ring} bg-white/10 ${SEAT_THEME[seat].text}`
                  : "border-white/10 text-white/40"
              }`}
            >
              <span>{SEAT_THEME[seat].emoji}</span>
              <span>{names[seat]}</span>
              {seat === viewerSeat && <span className="text-white/30">(나)</span>}
              {state.phase === "playing" && state.activeSeat === seat && (
                <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              )}
            </div>
          ))}
          {!opponentConnected && (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">
              상대 연결 대기중…
            </span>
          )}
          <button
            onClick={() => setRulebookOpen(true)}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/30"
          >
            📖 룰북
          </button>
        </div>
      </div>

      {/* ---- Turn timer bar (§5 optional house rule) ---- */}
      {turnTimerSec !== null && state.phase === "playing" && remainingSec !== null && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
          style={remainingSec <= 5 ? { animation: "maldallija-timer-warn 0.6s ease-in-out infinite" } : undefined}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
              remainingSec <= 5 ? "bg-rose-500" : "bg-amber-400"
            }`}
            style={{ width: `${Math.max(0, (remainingSec / turnTimerSec) * 100)}%` }}
          />
        </div>
      )}

      {/* ---- Board ---- */}
      <div className="relative mx-auto w-full max-w-xl">
        <div className="grid w-full grid-cols-11 overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_0_60px_-15px_rgba(244,63,94,0.35)]">
          {cells}
        </div>
        {/* ---- Move-animation overlay: flying horses + their dust/impact/
            speed-trail/LEAD particles, positioned in the same board-percent
            coordinate system as the grid beneath it (see MoveEffects.tsx's
            module doc for why no pixel measurement is needed). */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
          <MoveParticleLayer particles={particles} onExpire={handleParticleExpire} />
          {animations.map((anim) => (
            <AnimatedHorse
              key={anim.id}
              anim={anim}
              pieceImage={SEAT_THEME[anim.seat].pieceImage}
              altName={`${SEAT_THEME[anim.seat].name} 말`}
              ringClass={SEAT_THEME[anim.seat].ring}
              onEvent={(evt) => handleAnimEvent(anim, evt)}
              onDone={() => handleAnimDone(anim.id)}
            />
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-white/40">
        {isMyTurn
          ? selectedHorseIndex === null
            ? "내 차례입니다 — 이동 가능한 말을 선택하세요 (🔵 = 오아시스, 도착하면 즉시 승리 · 🟢 오아시스 구역에서는 나이트 이동 불가)"
            : "하이라이트된 칸으로 이동하세요 (파랑=슬라이드, 자홍=나이트 · 다시 탭하면 선택 해제)"
          : `${names[opponentSeat]}의 차례를 기다리는 중…`}
      </p>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* `animations.length === 0` gate: let the winning move's flight +
          landing impact finish playing before this full-screen overlay
          takes over (see this component's 2026-08-24 module-doc paragraph). */}
      {state.phase === "gameOver" && state.winner && animations.length === 0 && (
        <GameOverOverlay
          amIWinner={state.winner === viewerSeat}
          winnerName={names[state.winner]}
          onConfirm={() => onGameEnd(ids[state.winner as Seat])}
        />
      )}
    </div>
  );
}

function GameOverOverlay({
  amIWinner,
  winnerName,
  onConfirm,
}: {
  amIWinner: boolean;
  winnerName: string;
  onConfirm: () => void;
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6 text-center ${
        amIWinner ? "bg-gradient-to-b from-amber-950/95 via-black/95 to-black/95" : "bg-gradient-to-b from-rose-950/95 via-black/95 to-black/95"
      }`}
      style={{ animation: "maldallija-elim-flash 0.5s ease-out" }}
    >
      <div style={{ animation: "maldallija-result-burst 0.6s ease-out" }}>
        {amIWinner ? (
          <>
            <p className="text-5xl">🏆</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-amber-300 sm:text-5xl">WINNER</h2>
            <p className="mt-2 text-sm text-amber-100/80">오아시스에 먼저 입성해 생존했습니다.</p>
          </>
        ) : (
          <>
            <p className="text-5xl">💀</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-rose-400 sm:text-5xl">ELIMINATED</h2>
            <p className="mt-2 text-sm text-rose-100/70">{winnerName}님이 먼저 오아시스에 입성했습니다.</p>
          </>
        )}
      </div>
      <button
        onClick={onConfirm}
        className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition hover:bg-white/85"
      >
        결과 확정하고 계속하기
      </button>
    </div>
  );
}
