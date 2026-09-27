"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { COLLECTION_BONUS } from "./constants";
import { collectionTitle, type CollectionRef } from "./synergy";

// Deterministic confetti layout (no Math.random in render) — 28 gold flecks.
const CONFETTI = Array.from({ length: 28 }, (_, i) => {
  const angle = (i / 28) * Math.PI * 2 + (i % 3) * 0.17;
  const dist = 180 + ((i * 53) % 160);
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist * 0.75 - 40,
    rot: (i * 97) % 360,
    delay: (i % 5) * 0.04,
    w: 6 + (i % 3) * 3,
    color: ["#fff3c0", "#f2c94c", "#d4a032", "#fffbe8"][i % 4],
  };
});

/**
 * Collection-complete (or broken) moment.
 * - `mine`: full-screen takeover — dimmed backdrop, rotating gold rays, a
 *   "SYNERGY" medallion with +3 and a confetti burst (~2.6s).
 * - otherwise: a slide-down banner at the top ("상대가 시너지 완성", ~2.4s)
 *   so a rival's completion is noticed without blocking the board.
 * `variant="break"` (상장폐지/강제반대매매 destroyed a finished collection):
 *   mine → red full-screen warning (pulsing red vignette, shaking cracked
 *   "−3" medal, "시너지 붕괴!"); rival → green "상대 시너지 붕괴" banner.
 * Portaled to <body> so no transformed/overflow-hidden ancestor clips it.
 * Purely decorative (pointer-events-none); `onDone` advances the queue.
 */
export default function SynergyCompleteFX({
  collection,
  playerName,
  mine,
  variant = "complete",
  onDone,
}: {
  collection: CollectionRef;
  playerName: string;
  mine: boolean;
  variant?: "complete" | "break";
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, mine ? 2600 : 2400);
    return () => clearTimeout(t);
  }, [mine, onDone]);

  if (typeof document === "undefined") return null;
  const title = collectionTitle(collection);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[90]" role="status" aria-live="polite">
      <style>{`
        @keyframes glSynBackdrop { 0% { opacity: 0; } 12% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes glSynRays { from { transform: translate(-50%,-50%) rotate(0deg) scale(.6); } to { transform: translate(-50%,-50%) rotate(40deg) scale(1.15); } }
        @keyframes glSynMedal { 0% { transform: scale(.2) rotate(-25deg); opacity: 0; } 22% { transform: scale(1.18) rotate(4deg); opacity: 1; } 32% { transform: scale(1) rotate(0); } 82% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.08); opacity: 0; } }
        @keyframes glSynText { 0%,18% { transform: translateY(14px); opacity: 0; } 32% { transform: none; opacity: 1; } 82% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes glSynFleck { 0% { transform: translate(-50%,-50%) translate(0,0) rotate(0); opacity: 0; } 15% { opacity: 1; } 100% { transform: translate(-50%,-50%) translate(var(--dx), calc(var(--dy) + 120px)) rotate(var(--rot)); opacity: 0; } }
        @keyframes glSynRedPulse { 0% { opacity: 0; } 10% { opacity: 1; } 22% { opacity: .55; } 34% { opacity: 1; } 46% { opacity: .6; } 80% { opacity: .9; } 100% { opacity: 0; } }
        @keyframes glSynShake { 0%,18% { transform: scale(.3); opacity: 0; } 24% { transform: scale(1.12); opacity: 1; } 30%,40%,50% { transform: translateX(-9px) rotate(-4deg); } 35%,45%,55% { transform: translateX(9px) rotate(4deg); } 60% { transform: none; } 82% { opacity: 1; } 100% { transform: translateY(24px) scale(.95); opacity: 0; } }
        @keyframes glSynCrack { 0%,30% { stroke-dashoffset: 260; } 42% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 0; } }
        @keyframes glSynBanner { 0% { transform: translate(-50%,-120%); } 14% { transform: translate(-50%,0); } 84% { transform: translate(-50%,0); opacity: 1; } 100% { transform: translate(-50%,-120%); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .gl-syn-anim { animation-duration: 0.01s !important; animation-delay: 0s !important; }
        }
      `}</style>

      {variant === "break" && mine ? (
        <>
          <div
            className="gl-syn-anim absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(60,0,8,0.55),rgba(120,0,16,0.85))] shadow-[inset_0_0_160px_40px_rgba(255,30,60,0.55)]"
            style={{ animation: "glSynRedPulse 2.6s ease-out both" }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div
              className="gl-syn-anim relative flex h-36 w-36 flex-col items-center justify-center rounded-full bg-gradient-to-br from-[#5a5a60] via-[#2a2a2e] to-[#101012] shadow-[0_0_80px_10px_rgba(255,40,70,0.5)] ring-4 ring-rose-400/70 sm:h-44 sm:w-44"
              style={{ animation: "glSynShake 2.6s ease-out both" }}
            >
              <span className="font-serif text-[11px] font-bold tracking-[0.3em] text-rose-200/80">SYNERGY</span>
              <span className="font-serif text-5xl font-black text-rose-300 sm:text-6xl">−{COLLECTION_BONUS}</span>
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
                <path
                  d="M46 2 L54 22 L42 38 L58 52 L44 68 L56 84 L50 98"
                  fill="none"
                  stroke="#ffe4e6"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                  strokeDasharray="260"
                  className="gl-syn-anim"
                  style={{ animation: "glSynCrack 2.6s ease-out both" }}
                />
              </svg>
            </div>
            <div className="gl-syn-anim flex flex-col gap-1" style={{ animation: "glSynText 2.6s ease-out both" }}>
              <p className="font-serif text-3xl font-black text-rose-200 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] sm:text-4xl">⚠️ 시너지 붕괴!</p>
              <p className="text-base font-semibold text-white/90 sm:text-lg">{title}</p>
            </div>
          </div>
        </>
      ) : variant === "break" ? (
        <div
          className="gl-syn-anim absolute top-3 left-1/2 flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl border border-emerald-300/60 bg-gradient-to-r from-[#062a1a] to-[#0a1b12] px-4 py-3 shadow-[0_10px_40px_-8px_rgba(16,185,129,0.55)]"
          style={{ animation: "glSynBanner 2.4s cubic-bezier(.2,.8,.2,1) both" }}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6b6b72] to-[#1f1f23] font-serif text-sm font-black text-rose-300 line-through">
            +{COLLECTION_BONUS}
          </span>
          <div className="min-w-0 text-left">
            <p className="text-[11px] font-semibold tracking-wide text-emerald-200">🎯 상대 시너지 붕괴</p>
            <p className="truncate text-sm font-bold text-white">
              {playerName} · {title}
            </p>
          </div>
        </div>
      ) : mine ? (
        <>
          <div
            className="gl-syn-anim absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(40,26,6,0.72),rgba(0,0,0,0.88))]"
            style={{ animation: "glSynBackdrop 2.6s ease-out both" }}
          />
          <div
            className="gl-syn-anim absolute top-1/2 left-1/2 h-[140vmax] w-[140vmax] opacity-60"
            style={{
              background: "repeating-conic-gradient(from 0deg, rgba(242,201,76,0.28) 0deg 6deg, transparent 6deg 18deg)",
              maskImage: "radial-gradient(circle, black 0%, transparent 45%)",
              WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 45%)",
              animation: "glSynRays 2.6s ease-out both, glSynBackdrop 2.6s ease-out both",
            }}
          />
          {CONFETTI.map((c, i) => (
            <span
              key={i}
              className="gl-syn-anim absolute top-1/2 left-1/2 rounded-[1px]"
              style={
                {
                  width: c.w,
                  height: c.w * 0.45,
                  background: c.color,
                  "--dx": `${c.x}px`,
                  "--dy": `${c.y}px`,
                  "--rot": `${c.rot + 360}deg`,
                  animation: `glSynFleck 1.8s ${0.35 + c.delay}s cubic-bezier(.15,.7,.3,1) both`,
                } as React.CSSProperties
              }
            />
          ))}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div
              className="gl-syn-anim flex h-36 w-36 flex-col items-center justify-center rounded-full bg-gradient-to-br from-[#fff3c0] via-[#d4a032] to-[#7a5212] shadow-[0_0_80px_10px_rgba(242,201,76,0.55)] ring-4 ring-[#fff3c0]/70 sm:h-44 sm:w-44"
              style={{ animation: "glSynMedal 2.6s cubic-bezier(.2,.9,.3,1.2) both" }}
            >
              <span className="font-serif text-[11px] font-bold tracking-[0.3em] text-[#4a3108]">SYNERGY</span>
              <span className="font-serif text-5xl font-black text-[#2a1a04] drop-shadow-[0_2px_0_rgba(255,243,192,0.8)] sm:text-6xl">+{COLLECTION_BONUS}</span>
            </div>
            <div className="gl-syn-anim flex flex-col gap-1" style={{ animation: "glSynText 2.6s ease-out both" }}>
              <p className="font-serif text-3xl font-black text-[#fbe7a6] drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] sm:text-4xl">시너지 완성!</p>
              <p className="text-base font-semibold text-white/90 sm:text-lg">{title}</p>
            </div>
          </div>
        </>
      ) : (
        <div
          className="gl-syn-anim absolute top-3 left-1/2 flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl border border-rose-300/60 bg-gradient-to-r from-[#2a0c14] to-[#1b0a10] px-4 py-3 shadow-[0_10px_40px_-8px_rgba(244,63,94,0.6)]"
          style={{ animation: "glSynBanner 2.4s cubic-bezier(.2,.8,.2,1) both" }}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f7e3a1] to-[#8a5f1a] font-serif text-sm font-black text-[#2a1a04]">
            +{COLLECTION_BONUS}
          </span>
          <div className="min-w-0 text-left">
            <p className="text-[11px] font-semibold tracking-wide text-rose-200">⚠️ 상대 시너지 완성</p>
            <p className="truncate text-sm font-bold text-white">
              {playerName} · {title}
            </p>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
