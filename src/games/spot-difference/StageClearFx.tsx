"use client";

import type { CSSProperties } from "react";

/** Total on-screen time; the board unmounts this after it (keyframes in globals.css). */
export const STAGE_CLEAR_FX_MS = 1800;

const SPARKLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const dist = 120 + (i % 3) * 28;
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist * 0.8),
    glyph: i % 2 === 0 ? "✦" : "✨",
    delayMs: (i % 3) * 60,
    size: i % 2 === 0 ? 22 : 18,
  };
});

/**
 * Full-screen stage-clear flourish, played together with `playStageClear`:
 * golden glow, a sparkle burst from the center and a banner. `final` is the
 * last stage (match solved) — different wording, the game-over panel shows
 * underneath. Purely decorative and click-through.
 */
export default function StageClearFx({ final }: { final: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(251,191,36,0.35), rgba(251,191,36,0.08) 45%, transparent 70%)",
          animation: `spot-diff-clear-glow ${STAGE_CLEAR_FX_MS}ms ease-out forwards`,
        }}
      />
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="spot-diff-clear-sparkle absolute left-1/2 top-1/2 text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.9)]"
          style={
            {
              "--dx": `${s.dx}px`,
              "--dy": `${s.dy}px`,
              fontSize: s.size,
              opacity: 0,
              animation: `spot-diff-clear-burst 900ms ${s.delayMs}ms ease-out forwards`,
            } as CSSProperties
          }
        >
          {s.glyph}
        </span>
      ))}
      <div
        className="relative rounded-2xl border border-amber-300/70 bg-slate-950/85 px-6 py-3 text-center shadow-[0_0_30px_rgba(251,191,36,0.45)] light:bg-white/95"
        style={{ opacity: 0, animation: `spot-diff-clear-banner ${STAGE_CLEAR_FX_MS}ms ease-out forwards` }}
      >
        <p className="text-2xl font-black text-amber-300 light:text-amber-600">{final ? "🏆 사건 해결!" : "🔍 스테이지 클리어!"}</p>
        <p className="mt-0.5 text-xs text-amber-100/80 light:text-amber-800/80">{final ? "모든 틀린 곳을 찾았어요" : "다음 그림으로 넘어갑니다"}</p>
      </div>
    </div>
  );
}
