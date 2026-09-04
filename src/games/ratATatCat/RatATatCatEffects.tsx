"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Avatar from "@/components/common/Avatar";
import CardSlot from "./CardSlot";
import { computeRankings, SLOTS, type RatATatCatState, type SeatIndex } from "./engine";

/**
 * Game-over reveal — the platform-common "전원 카드 동시 오픈 + 점수
 * 하이라이트" requirement. Every viewer sees the identical, already-final
 * `state` (finishGame already flipped every `isRevealed`, and scoring is a
 * pure read via `computeRankings`) — this component only adds a local,
 * per-viewer pacing animation on top, same split as every other
 * `<Game>Effects.tsx`/`ScoreBreakdownModal.tsx` in this project: a fixed
 * `REVEAL_HOLD_MS` minimum hold plus a `[⏩ 스킵]` button (and a backdrop
 * double-tap) that ends the wait early. `onDone` is purely local UI — it
 * doesn't touch the (already-final) engine state.
 *
 * 2026-09-04 (user request, "등수가 나오게해주세요 1등, 2등, 3등, 4등, 1등에게는
 * 축하이팩트 꼴등에게는 우울한 이팩트 추가해주세요"): every seat's card now
 * carries an explicit rank badge (🥇/🥈/🥉/N등, via `computeRankings`'
 * existing standard-competition `rank` — ties already share a number, same
 * as any real scoreboard), plus a celebration spark burst on 1st place and a
 * gloomy raindrop droop on LAST place. "Last place" is generic (whatever
 * `state.playerCount` is, not hardcoded to 4) and is only ever applied when
 * `lastRank > 1` — a full N-way tie for 1st has no "loser" to single out.
 */

const REVEAL_HOLD_MS = 3000;
const DOUBLE_TAP_SKIP_MS = 350;

function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

/** 🥇/🥈/🥉 for the podium, plain "N등" beyond that (up to `MAX_PLAYERS`=6). */
function rankLabel(rank: number): string {
  if (rank === 1) return "🥇 1등";
  if (rank === 2) return "🥈 2등";
  if (rank === 3) return "🥉 3등";
  return `${rank}등`;
}

/** Card border/background accent per rank tier — independent of (and layered under) the winner/last-place effects below. */
function rankAccentClass(rank: number): string {
  if (rank === 1) return "border-amber-400/60 bg-amber-400/10";
  if (rank === 2) return "border-slate-300/50 bg-slate-300/10";
  if (rank === 3) return "border-orange-400/45 bg-orange-700/10";
  return "border-white/10 bg-white/[0.04]";
}

/** Fixed deterministic offsets (no Math.random, same convention as
 * AvalonEffects.tsx's CONFETTI_OFFSETS) for the 1등 card's celebration
 * sparks — position on the card (`leftPct`/`topPct`) plus the CSS-variable
 * travel vector each one animates outward along. */
const CELEBRATE_SPARKS: { emoji: string; leftPct: number; topPct: number; dx: number; dy: number; rot: number; delayMs: number }[] = [
  { emoji: "🎉", leftPct: 6, topPct: 15, dx: -20, dy: -26, rot: -18, delayMs: 0 },
  { emoji: "✨", leftPct: 88, topPct: 8, dx: 22, dy: -24, rot: 16, delayMs: 260 },
  { emoji: "⭐", leftPct: 48, topPct: -4, dx: 4, dy: -30, rot: 6, delayMs: 500 },
  { emoji: "🎊", leftPct: 94, topPct: 62, dx: 24, dy: -18, rot: 28, delayMs: 130 },
  { emoji: "✨", leftPct: 2, topPct: 68, dx: -24, dy: -16, rot: -28, delayMs: 380 },
];

/** Same convention as `CELEBRATE_SPARKS` above, for the 꼴등 card's droop. */
const GLOOM_DRIPS: { emoji: string; leftPct: number; dx: number; delayMs: number }[] = [
  { emoji: "💧", leftPct: 22, dx: -3, delayMs: 0 },
  { emoji: "😢", leftPct: 50, dx: 2, delayMs: 400 },
  { emoji: "💧", leftPct: 76, dx: 5, delayMs: 200 },
];

/** 1등 카드에 얹는 반복 스파클 버스트 — `relative` 부모 안에서 절대 위치. */
function CelebrateBurst() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
      {CELEBRATE_SPARKS.map((s, i) => (
        <span
          key={i}
          className="absolute text-sm"
          style={
            {
              left: `${s.leftPct}%`,
              top: `${s.topPct}%`,
              "--ratc-spark-x": `${s.dx}px`,
              "--ratc-spark-y": `${s.dy}px`,
              "--ratc-spark-rot": `${s.rot}deg`,
              animation: `ratc-rank-celebrate-spark 1.3s ease-out ${s.delayMs}ms infinite`,
            } as CSSProperties
          }
        >
          {s.emoji}
        </span>
      ))}
    </div>
  );
}

/** 꼴등 카드 아래로 흘러내리는 반복 빗방울/눈물. */
function GloomDrip() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1 overflow-visible">
      {GLOOM_DRIPS.map((d, i) => (
        <span
          key={i}
          className="absolute text-xs opacity-90"
          style={
            {
              left: `${d.leftPct}%`,
              "--ratc-drip-x": `${d.dx}px`,
              animation: `ratc-rank-gloom-drip 1.8s ease-in ${d.delayMs}ms infinite`,
            } as CSSProperties
          }
        >
          {d.emoji}
        </span>
      ))}
    </div>
  );
}

export interface GameOverRevealProps {
  state: RatATatCatState;
  names: Record<SeatIndex, string>;
  viewerSeat: SeatIndex;
  onDone: () => void;
}

export default function GameOverReveal({ state, names, viewerSeat, onDone }: GameOverRevealProps) {
  const [holding, setHolding] = useState(true);
  const doneRef = useRef(false);
  const lastTapRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setHolding(false), REVEAL_HOLD_MS);
    return () => clearTimeout(t);
  }, []);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }

  function skip() {
    setHolding(false);
  }

  function handleBackdropTap() {
    const now = Date.now();
    if (isDoubleTap(lastTapRef.current, now)) {
      lastTapRef.current = 0;
      skip();
    } else {
      lastTapRef.current = now;
    }
  }

  const rankings = computeRankings(state);
  const rankBySeat = new Map(rankings.map((r) => [r.seat, r]));
  // 2026-09-04 (user request, "점수결과를 1등 오름차순으로 표시해주세요"): the
  // reveal grid now orders by standing (1st → last) instead of seat position
  // relative to the viewer. `computeRankings` already returns its entries
  // sorted ascending by `rank` (engine.ts), so this is just reading that
  // order directly — ties keep computeRankings' own stable seat-ascending
  // order, same as every client computes independently.
  const order = rankings.map((r) => r.seat);
  const winnerSeats = rankings.filter((r) => r.rank === 1).map((r) => r.seat);
  // "꼴등" = whoever holds the highest rank number. Only meaningful when it's
  // actually distinct from 1st (a full N-way tie for the win has nobody to
  // single out as a loser) — see module docstring.
  const lastRank = Math.max(...rankings.map((r) => r.rank));
  const hasDistinctLastPlace = lastRank > 1;

  return (
    <div
      className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#141018] via-[#0f0c14] to-black p-5 text-center sm:p-8"
      style={{ animation: "ratc-overlay-in 0.35s ease-out both" }}
      onClick={handleBackdropTap}
    >
      <span className="text-4xl" style={{ animation: winnerSeats.length ? "ratc-winner-pop 0.5s ease-out both" : undefined }}>
        🏆
      </span>
      <h2 className="text-lg font-bold text-white">
        {winnerSeats.length > 1 ? `${winnerSeats.map((s) => names[s]).join(", ")}님 공동 우승!` : `${names[winnerSeats[0]]}님 승리!`}
      </h2>
      <p className="text-xs text-white/40">카드 합이 가장 낮은 플레이어가 승리 (점수는 낮을수록 좋아요)</p>

      <div className="flex w-full flex-wrap justify-center gap-3">
        {order.map((seat) => {
          const ranked = rankBySeat.get(seat)!;
          const isWinner = ranked.rank === 1;
          const isLastPlace = hasDistinctLastPlace && ranked.rank === lastRank;
          return (
            <div
              key={seat}
              className={`relative flex flex-col items-center gap-2 rounded-xl border p-3 ${rankAccentClass(ranked.rank)} ${
                isWinner ? "ratc-rank-celebrate-glow" : ""
              } ${isLastPlace ? "ratc-rank-gloom-slump grayscale-[35%]" : ""}`}
            >
              {isWinner && <CelebrateBurst />}
              {isLastPlace && <GloomDrip />}
              <span
                className={`absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  isWinner
                    ? "border-amber-300/70 bg-amber-500/90 text-amber-950"
                    : isLastPlace
                      ? "border-slate-500/50 bg-slate-800/90 text-slate-300"
                      : "border-white/15 bg-black/70 text-white/70"
                }`}
              >
                {rankLabel(ranked.rank)}
              </span>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Avatar size={22} />
                <span className="max-w-[7rem] truncate text-xs font-semibold text-white">
                  {names[seat]}
                  {seat === viewerSeat && <span className="ml-1 text-emerald-300">(나)</span>}
                </span>
                {isWinner && <span aria-hidden>👑</span>}
                {isLastPlace && <span aria-hidden>☔</span>}
              </div>
              <div className="flex gap-1">
                {SLOTS.map((slot) => {
                  const slotScore = ranked.score.slots[slot];
                  return (
                    <div key={slot} className="flex flex-col items-center gap-0.5">
                      <CardSlot size="sm" handCard={state.hands[seat][slot]} revealed label={`${names[seat]}의 카드 ${slot + 1}번`} />
                      {slotScore.substituted && <span className="text-[9px] text-sky-300">대체값 {slotScore.value}</span>}
                    </div>
                  );
                })}
              </div>
              <span
                className={`text-lg font-extrabold ${isWinner ? "text-amber-300" : isLastPlace ? "text-slate-400" : "text-white/70"}`}
              >
                {ranked.score.total}점
              </span>
            </div>
          );
        })}
      </div>

      {holding ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            skip();
          }}
          className="mt-1 flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-black/30 px-6 py-2.5 text-sm font-semibold text-white/90 transition hover:border-emerald-300 active:scale-95"
          style={{ animation: "ratc-skip-pulse-glow 1.8s ease-in-out infinite" }}
        >
          ⏩ 결과 스킵
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            finish();
          }}
          className="mt-1 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          확인
        </button>
      )}
    </div>
  );
}
