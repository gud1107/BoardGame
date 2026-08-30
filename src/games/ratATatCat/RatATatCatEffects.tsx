"use client";

import { useEffect, useRef, useState } from "react";
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
 */

const REVEAL_HOLD_MS = 3000;
const DOUBLE_TAP_SKIP_MS = 350;

function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

function seatOrderFrom(viewerSeat: SeatIndex, playerCount: number): SeatIndex[] {
  const order = [viewerSeat];
  for (let i = 1; i < playerCount; i++) order.push((viewerSeat + i) % playerCount);
  return order;
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
  const order = seatOrderFrom(viewerSeat, state.playerCount);
  const winnerSeats = rankings.filter((r) => r.rank === 1).map((r) => r.seat);

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
          return (
            <div
              key={seat}
              className={`flex flex-col items-center gap-2 rounded-xl border p-3 ${
                isWinner ? "border-amber-400/60 bg-amber-400/10" : "border-white/10 bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Avatar size={22} />
                <span className="max-w-[7rem] truncate text-xs font-semibold text-white">
                  {names[seat]}
                  {seat === viewerSeat && <span className="ml-1 text-emerald-300">(나)</span>}
                </span>
                {isWinner && <span aria-hidden>👑</span>}
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
              <span className={`text-lg font-extrabold ${isWinner ? "text-amber-300" : "text-white/70"}`}>{ranked.score.total}점</span>
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
