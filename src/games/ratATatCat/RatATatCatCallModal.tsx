"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { SeatIndex } from "./engine";

/**
 * "랫어탯켓(콜)" 초대형 중앙 포커싱 연출 — the work order's "화면 전체를
 * 압도하는 대형 중앙 포커싱 연출" ask. Shown identically to every seat
 * (caller included, per `AskUserQuestion` 2026-08-31 "전원 동일하게 표시,
 * 기존 배너 대체") the instant `state.callerId` first becomes non-null;
 * `RatATatCatBoard.tsx` owns the one-shot "have we shown this call yet"
 * gate (`callerId` only ever gets set once per round, so this component
 * itself has no engine-state awareness — it's purely a local, dismissible
 * overlay, same split as `RatATatCatEffects.tsx`'s `GameOverReveal`).
 *
 * Same holding/skip pattern as `GameOverReveal` (confirmed via
 * `AskUserQuestion` 2026-08-31: 2.5s minimum hold, then the skip button
 * turns into a "확인" button that needs an explicit press; double-tap the
 * backdrop to skip early too) — `onDismiss` is purely local UI, it never
 * touches engine state.
 */

const MIN_HOLD_MS = 2500;
const DOUBLE_TAP_SKIP_MS = 350;

export interface RatATatCatCallModalProps {
  callerSeat: SeatIndex;
  callerName: string;
  viewerSeat: SeatIndex;
  onDismiss: () => void;
}

export default function RatATatCatCallModal({ callerSeat, callerName, viewerSeat, onDismiss }: RatATatCatCallModalProps) {
  const [holding, setHolding] = useState(true);
  const doneRef = useRef(false);
  const lastTapRef = useRef(0);

  useEffect(() => {
    getSoundEngine().playRatCallSiren();
    const t = setTimeout(() => setHolding(false), MIN_HOLD_MS);
    return () => clearTimeout(t);
  }, []);

  function skip() {
    setHolding(false);
  }

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    onDismiss();
  }

  function handleBackdropTap() {
    const now = Date.now();
    if (lastTapRef.current !== 0 && now - lastTapRef.current < DOUBLE_TAP_SKIP_MS) {
      lastTapRef.current = 0;
      skip();
    } else {
      lastTapRef.current = now;
    }
  }

  const isMe = callerSeat === viewerSeat;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-5 bg-black/75 px-6 text-center backdrop-blur-sm"
      style={{ animation: "ratc-call-backdrop-in 0.3s ease-out both" }}
      onClick={handleBackdropTap}
    >
      <div
        className="flex flex-col items-center gap-3 rounded-full border-4 border-amber-300/80 bg-gradient-to-b from-amber-900/40 to-black/40 p-6 shadow-[0_0_60px_rgba(252,211,77,0.5)]"
        style={{ animation: "ratc-call-slam 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.4) both" }}
      >
        <Avatar size={96} className="border-4 border-amber-300 shadow-[0_0_30px_rgba(252,211,77,0.7)]" />
        <span className="text-sm font-bold text-amber-100">
          {callerName}
          {isMe && <span className="ml-1 text-emerald-300">(나)</span>}
        </span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-3xl" aria-hidden>
          🐱
        </span>
        <h2
          className="text-2xl font-black tracking-wide text-amber-300 sm:text-4xl"
          style={{ animation: "ratc-call-emblem-glow 1.4s ease-in-out infinite" }}
        >
          RAT-A-TAT CAT!
        </h2>
        <p className="text-sm font-bold text-white/90 sm:text-base">
          {isMe ? "내가" : `${callerName}님이`} &ldquo;랫어탯캣!&rdquo;을 외쳤습니다
        </p>
      </div>

      <div className="rounded-xl border border-red-400/50 bg-red-500/15 px-4 py-2 text-sm font-extrabold text-red-200 sm:text-base">
        ⚠️ 마지막 1턴 시작!
      </div>

      {holding ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            skip();
          }}
          className="mt-2 flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-black/40 px-6 py-2.5 text-sm font-semibold text-white/90 transition hover:border-amber-300 active:scale-95"
          style={{ animation: "ratc-skip-pulse-glow 1.8s ease-in-out infinite" }}
        >
          ⏩ 스킵
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            finish();
          }}
          className="mt-2 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-400"
        >
          확인
        </button>
      )}
    </div>
  );
}
