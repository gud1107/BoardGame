"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import { BOARD_SIZE, isOasisZoneCell, type MoveKind, type MoveRecord, type Position, type Seat } from "./engine";

/**
 * Purely cosmetic move-animation layer for 말달리자 — no game logic lives
 * here, same "diff two consecutive snapshots, drive a portal/overlay off the
 * shared state transition" boundary as every other `<Game>Effects.tsx` in
 * this project (coyote/CoyoteEffects.tsx, dalmuti/DalmutiEffects.tsx, ...).
 * The one deliberate deviation: the horse's position interpolation itself is
 * driven imperatively via `requestAnimationFrame` writing straight to
 * `style.transform` refs, not a declarative CSS `@keyframes` — a slide move
 * can span 1 to 10 cells (`resolveSlide` walks until blocked), so the path
 * length is dynamic and can't be encoded as a fixed keyframe percentage
 * list. Every frame only ever touches `transform` (translate3d + scale) on
 * `will-change: transform` elements, so this stays GPU-composited and cheap
 * even though it re-renders every ~16ms — none of it goes through React
 * state, so it never triggers a React re-render of the board.
 *
 * 2026-08-24 session — added per explicit user confirmation
 * (`AskUserQuestion`, 4 answers, Strict No-Assumption Rule in the request):
 * 1) 250ms per-cell gallop hop on slide moves (step-by-step "통-통-통").
 * 2) Speed-line/motion-trail streaks only fire on slides of 2+ cells — this
 *    game has no dice-roll/boost-card mechanic to key a "boosted move" off
 *    of, so multi-cell slide distance is the stand-in signal the user chose.
 * 3) The "선두 추월(LEAD)" request doesn't map to this game (no laps, no
 *    1st-place concept — it's a race to a single center cell) — the user
 *    chose to fire a "🔥 질주" badge on *entering the oasis diamond zone*
 *    instead, suppressed on the move that actually wins the game (that's the
 *    WINNER/ELIMINATED overlay's moment, not this badge's).
 * 4) Knight (L자) jumps get a distinct treatment from slides — a parabolic
 *    arc (higher hop peak, single bound, no intermediate cells since there's
 *    nothing to step through) plus a magenta trail of fading dots sampled
 *    along the arc.
 *
 * **2026-08-25 session — slide hop accelerated**: per explicit user
 * confirmation (`AskUserQuestion`, Strict No-Assumption Rule in the
 * request), the per-cell hop dropped from 250ms to 130ms (roughly 2x
 * faster) for a snappier "질주감", and the per-hop easing switched from a
 * plain quadratic ease-out to a `cubic-bezier(0.25, 1, 0.5, 1)`-equivalent
 * curve (`cubicBezierEase` below) for a more natural accelerate/decelerate
 * feel — both requested explicitly in the same message, no ambiguity to
 * confirm there. `KNIGHT_JUMP_MS` was explicitly confirmed to stay at 380ms
 * (kept feeling like "one deliberate bigger leap" rather than scaling down
 * with the slide hop).
 */

export const HOP_MS = 130;
/** Single-bound duration for knight moves. Not `steps * HOP_MS` — a knight
 * move has no intermediate cells to step through (`buildPath` below returns
 * just `[from, to]`), so this is a fixed, feel-tuned duration: longer than
 * one slide hop (reads as a bigger leap) but shorter than two (stays
 * snappy, doesn't drag). Deliberately left at its original value in the
 * 2026-08-25 slide-acceleration session (user confirmed via
 * `AskUserQuestion`) rather than scaling down with `HOP_MS`. */
export const KNIGHT_JUMP_MS = 380;

/**
 * Evaluates a CSS-style `cubic-bezier(x1, y1, x2, y2)` timing function at
 * time-fraction `t` (0..1) — same semantics as the CSS property, just
 * computed in JS since the per-hop position here is driven imperatively via
 * `requestAnimationFrame` (see this file's module doc), not a declarative
 * CSS `transition`. `x1`/`x2` are the curve's horizontal control points
 * (must keep the curve x-monotonic, as any valid CSS easing does) and
 * `y1`/`y2` are the vertical ones; solved via a few Newton-Raphson
 * iterations against the cubic Bézier's `x(s) = t` (cheap enough for a
 * once-per-frame call — at most a couple of horses animate at once).
 * 2026-08-25 session: replaces the previous plain `1 - (1-t)^2` quadratic
 * ease-out with the exact curve the user asked for
 * (`cubic-bezier(0.25, 1, 0.5, 1)`, confirmed unambiguous in the request —
 * no `AskUserQuestion` needed for this part).
 */
function cubicBezierEase(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const bezierComponent = (a: number, b: number, s: number) => {
    const s1 = 1 - s;
    return 3 * s1 * s1 * s * a + 3 * s1 * s * s * b + s * s * s;
  };
  const bezierDerivative = (a: number, b: number, s: number) => {
    const s1 = 1 - s;
    return 3 * s1 * s1 * a + 6 * s1 * s * (b - a) + 3 * s * s * (1 - b);
  };
  let s = t;
  for (let i = 0; i < 6; i++) {
    const dx = bezierComponent(x1, x2, s) - t;
    const slope = bezierDerivative(x1, x2, s);
    if (Math.abs(slope) < 1e-6) break;
    s -= dx / slope;
  }
  return bezierComponent(y1, y2, s);
}

/** One board cell as a percentage of the (square) board's own width/height —
 * every position in this file is expressed in this unit so nothing needs a
 * pixel measurement / `ResizeObserver` to stay correct at any board size. */
export const CELL_PCT = 100 / BOARD_SIZE;

const KNIGHT_TRAIL_CHECKPOINTS = [0.25, 0.5, 0.75] as const;

const AURA: Record<Seat, { solid: string }> = {
  p1: { solid: "bg-rose-400" },
  p2: { solid: "bg-cyan-300" },
};

export interface MoveAnim {
  id: number;
  seat: Seat;
  horseIndex: number;
  moveKind: MoveKind;
  /** Includes the starting cell at index 0 — `path.length - 1` is the hop count. */
  path: Position[];
  totalMs: number;
  /** Slide of 2+ cells only (user's confirmed "다중 칸 슬라이드만" answer). */
  showSpeedTrail: boolean;
  /** Landed cell newly entered the oasis diamond zone from outside it, and
   * this particular move didn't also win the game (that overlay takes over
   * instead — see this file's module doc, point 3). */
  showLeadBadge: boolean;
}

let animIdCounter = 0;

function buildPath(record: MoveRecord): Position[] {
  if (record.moveKind === "knight") return [record.from, record.to];
  const stepRow = Math.sign(record.to.row - record.from.row);
  const stepCol = Math.sign(record.to.col - record.from.col);
  const steps = Math.max(Math.abs(record.to.row - record.from.row), Math.abs(record.to.col - record.from.col));
  const path: Position[] = [record.from];
  for (let i = 1; i <= steps; i++) {
    path.push({ row: record.from.row + stepRow * i, col: record.from.col + stepCol * i });
  }
  return path;
}

/**
 * Converts exactly one freshly-appended `MoveRecord` into a `MoveAnim`, or
 * `null` if there's nothing worth animating (a zero-length path shouldn't
 * happen for a legal move, but costs nothing to guard). `gameEndedByThisMove`
 * suppresses the LEAD badge — see module doc point 3.
 */
export function buildMoveAnim(record: MoveRecord, gameEndedByThisMove: boolean): MoveAnim | null {
  const path = buildPath(record);
  if (path.length < 2) return null;
  const steps = path.length - 1;
  const enteredZone = !isOasisZoneCell(record.from) && isOasisZoneCell(record.to);
  return {
    id: animIdCounter++,
    seat: record.seat,
    horseIndex: record.horseIndex,
    moveKind: record.moveKind,
    path,
    totalMs: record.moveKind === "knight" ? KNIGHT_JUMP_MS : steps * HOP_MS,
    showSpeedTrail: record.moveKind === "slide" && steps >= 2,
    showLeadBadge: record.moveKind === "slide" && enteredZone && !gameEndedByThisMove,
  };
}

export type MoveEvent =
  | { type: "dust"; row: number; col: number }
  | { type: "impact"; row: number; col: number }
  | { type: "streak"; row: number; col: number; angleDeg: number }
  | { type: "knightTrail"; row: number; col: number; liftPct: number }
  | { type: "lead"; row: number; col: number };

export type MoveParticle =
  | { id: number; kind: "dust"; row: number; col: number }
  | { id: number; kind: "impact"; row: number; col: number; seat: Seat }
  | { id: number; kind: "streak"; row: number; col: number; angleDeg: number; seat: Seat }
  | { id: number; kind: "knightTrail"; row: number; col: number; liftPct: number }
  | { id: number; kind: "lead"; row: number; col: number; seat: Seat };

/** Shared token art — used by both the static grid-cell render
 * (`MalDalliJaBoard`'s cell loop) and this file's flying `AnimatedHorse`, so
 * the two never look different at the handoff moment. */
export function HorseTokenVisual({
  pieceImage,
  altName,
  ringClass,
  extraClass = "",
}: {
  pieceImage: string;
  altName: string;
  ringClass: string;
  extraClass?: string;
}) {
  return (
    <span
      className={`absolute inset-[10%] overflow-hidden rounded-lg border-2 bg-[#f5f0e6] shadow-[0_3px_8px_-1px_rgba(0,0,0,0.65)] ${ringClass} ${extraClass}`}
    >
      <Image src={pieceImage} alt={altName} width={64} height={64} className="h-full w-full object-contain p-[8%]" />
    </span>
  );
}

/**
 * One in-flight horse: mounted fresh per move (caller keys it by
 * `anim.id`), runs a self-contained rAF loop for `anim.totalMs`, then calls
 * `onDone` exactly once so the caller can drop it back to the static grid
 * render (whose `state.positions` already reflects the final cell by the
 * time this even mounts — see MalDalliJaBoard.tsx's diff effect).
 */
export function AnimatedHorse({
  anim,
  pieceImage,
  altName,
  ringClass,
  onEvent,
  onDone,
}: {
  anim: MoveAnim;
  pieceImage: string;
  altName: string;
  ringClass: string;
  onEvent: (evt: MoveEvent) => void;
  onDone: () => void;
}) {
  const moverRef = useRef<HTMLDivElement | null>(null);
  const bounceRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest callbacks in refs so the rAF loop (started once on
  // mount, see the effect's empty dep array below) never closes over a
  // stale `onEvent`/`onDone` without needing to restart the loop. Written
  // from an effect, not during render — react-hooks/refs forbids mutating a
  // ref while rendering.
  const onEventRef = useRef(onEvent);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onEventRef.current = onEvent;
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const segCount = anim.path.length - 1;
    const segMs = anim.totalMs / segCount;
    const isKnight = anim.moveKind === "knight";
    const hopPeakPct = isKnight ? 55 : 30;
    const landedSegments = new Set<number>();
    const startedSegments = new Set<number>();
    const firedTrailCheckpoints = new Set<number>();

    function frame(now: number) {
      const elapsed = now - start;
      const clampedElapsed = Math.min(elapsed, anim.totalMs);
      const segIndex = Math.min(segCount - 1, Math.floor(clampedElapsed / segMs));
      const segT = Math.min(1, (clampedElapsed - segIndex * segMs) / segMs);

      const from = anim.path[segIndex];
      const to = anim.path[segIndex + 1];
      const eased = cubicBezierEase(segT, 0.25, 1, 0.5, 1); // snappy accelerate/decelerate, not floaty
      const row = from.row + (to.row - from.row) * eased;
      const col = from.col + (to.col - from.col) * eased;
      const hopPct = Math.sin(Math.PI * segT) * hopPeakPct;
      // Squash & stretch: stretch a touch at the apex (mid-flight), squash
      // hard right at touchdown (last ~18% of the segment) — cheap
      // approximation of a gallop stride, not physically exact.
      const stretch = Math.sin(Math.PI * segT);
      const scaleY = 1 + stretch * 0.14 - (segT > 0.82 ? ((segT - 0.82) / 0.18) * 0.22 : 0);
      const scaleX = 1 - (scaleY - 1) * 0.6;

      if (moverRef.current) moverRef.current.style.transform = `translate3d(${col * 100}%, ${row * 100}%, 0)`;
      if (bounceRef.current) bounceRef.current.style.transform = `translate3d(0, ${-hopPct}%, 0) scale(${scaleX}, ${scaleY})`;

      if (anim.showSpeedTrail && !startedSegments.has(segIndex)) {
        startedSegments.add(segIndex);
        const angleDeg = (Math.atan2(to.row - from.row, to.col - from.col) * 180) / Math.PI;
        onEventRef.current({ type: "streak", row: from.row, col: from.col, angleDeg });
      }

      if (isKnight) {
        for (const cp of KNIGHT_TRAIL_CHECKPOINTS) {
          if (segT >= cp && !firedTrailCheckpoints.has(cp)) {
            firedTrailCheckpoints.add(cp);
            const cpEased = 1 - (1 - cp) * (1 - cp);
            onEventRef.current({
              type: "knightTrail",
              row: from.row + (to.row - from.row) * cpEased,
              col: from.col + (to.col - from.col) * cpEased,
              liftPct: Math.sin(Math.PI * cp) * hopPeakPct,
            });
          }
        }
      }

      if (segT >= 1 && !landedSegments.has(segIndex)) {
        landedSegments.add(segIndex);
        onEventRef.current({ type: "dust", row: to.row, col: to.col });
        if (segIndex === segCount - 1) {
          onEventRef.current({ type: "impact", row: to.row, col: to.col });
          if (anim.showLeadBadge) onEventRef.current({ type: "lead", row: to.row, col: to.col });
        }
      }

      if (elapsed < anim.totalMs) {
        raf = requestAnimationFrame(frame);
      } else {
        onDoneRef.current();
      }
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Deliberately mount-once: `anim` is immutable for this component's
    // whole lifetime (the caller mounts a fresh `AnimatedHorse` keyed by
    // `anim.id` per move, see MalDalliJaBoard.tsx), and callbacks are read
    // through the refs above so they can't go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={moverRef}
      className="pointer-events-none absolute left-0 top-0 z-20"
      style={{ width: `${CELL_PCT}%`, height: `${CELL_PCT}%`, willChange: "transform" }}
    >
      <div ref={bounceRef} className="h-full w-full" style={{ willChange: "transform" }}>
        <HorseTokenVisual pieceImage={pieceImage} altName={altName} ringClass={ringClass} />
      </div>
    </div>
  );
}

function renderParticle(p: MoveParticle, onExpire: (id: number) => void) {
  switch (p.kind) {
    case "dust":
      return (
        <span
          key={p.id}
          className="pointer-events-none absolute z-10 rounded-full bg-amber-100/70 blur-[1px]"
          style={{
            left: `${p.col * CELL_PCT + CELL_PCT * 0.25}%`,
            top: `${p.row * CELL_PCT + CELL_PCT * 0.25}%`,
            width: `${CELL_PCT * 0.5}%`,
            height: `${CELL_PCT * 0.5}%`,
            animation: "maldallija-dust-puff 0.4s ease-out forwards",
          }}
          onAnimationEnd={() => onExpire(p.id)}
        />
      );
    case "impact":
      return (
        <span
          key={p.id}
          className={`pointer-events-none absolute z-10 rounded-full border-2 ${
            p.seat === "p1" ? "border-rose-300/80" : "border-cyan-200/80"
          }`}
          style={{
            left: `${p.col * CELL_PCT}%`,
            top: `${p.row * CELL_PCT}%`,
            width: `${CELL_PCT}%`,
            height: `${CELL_PCT}%`,
            animation: "maldallija-impact-ripple 0.45s ease-out forwards",
          }}
          onAnimationEnd={() => onExpire(p.id)}
        />
      );
    case "streak": {
      const lengthPct = CELL_PCT * 0.95;
      const thicknessPct = CELL_PCT * 0.22;
      return (
        <span
          key={p.id}
          className={`pointer-events-none absolute z-10 rounded-full ${AURA[p.seat].solid}`}
          style={
            {
              left: `${p.col * CELL_PCT + CELL_PCT / 2}%`,
              top: `${p.row * CELL_PCT + CELL_PCT / 2}%`,
              width: `${lengthPct}%`,
              height: `${thicknessPct}%`,
              transformOrigin: "left center",
              opacity: 0.75,
              // The keyframe itself reads this angle (`var(--streak-angle)`)
              // for every one of its `transform` steps — setting a plain
              // static `transform` here would just get clobbered the
              // instant the animation starts, since they animate the same
              // property.
              "--streak-angle": `${p.angleDeg}deg`,
              // 2026-08-25: shortened from 0.32s alongside the HOP_MS cut
              // (250ms -> 130ms) so a multi-hop slide's per-segment streaks
              // stay crisp, individually-readable flashes instead of piling
              // up into one blurred smear across several hops.
              animation: "maldallija-speed-streak 0.18s ease-out forwards",
            } as CSSProperties
          }
          onAnimationEnd={() => onExpire(p.id)}
        />
      );
    }
    case "knightTrail": {
      const dotPct = CELL_PCT * 0.28;
      const liftBoardPct = (p.liftPct / 100) * CELL_PCT;
      return (
        <span
          key={p.id}
          className="pointer-events-none absolute z-10 rounded-full bg-fuchsia-400/85 shadow-[0_0_6px_1px_rgba(232,121,249,0.8)]"
          style={{
            left: `${p.col * CELL_PCT + (CELL_PCT - dotPct) / 2}%`,
            top: `${p.row * CELL_PCT + (CELL_PCT - dotPct) / 2 - liftBoardPct}%`,
            width: `${dotPct}%`,
            height: `${dotPct}%`,
            animation: "maldallija-knight-trail 0.3s ease-out forwards",
          }}
          onAnimationEnd={() => onExpire(p.id)}
        />
      );
    }
    case "lead":
      return (
        <span
          key={p.id}
          className={`pointer-events-none absolute z-30 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${
            p.seat === "p1" ? "border-rose-300 bg-rose-950/90 text-rose-200" : "border-cyan-200 bg-cyan-950/90 text-cyan-100"
          }`}
          style={{
            left: `${p.col * CELL_PCT + CELL_PCT / 2}%`,
            top: `${p.row * CELL_PCT}%`,
            transform: "translate(-50%, -100%)",
            animation: "maldallija-lead-badge-pop 1.1s ease-out forwards",
          }}
          onAnimationEnd={() => onExpire(p.id)}
        >
          🔥 질주
        </span>
      );
    default:
      return null;
  }
}

export function MoveParticleLayer({ particles, onExpire }: { particles: MoveParticle[]; onExpire: (id: number) => void }) {
  return <>{particles.map((p) => renderParticle(p, onExpire))}</>;
}
