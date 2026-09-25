"use client";

import { useEffect, type CSSProperties } from "react";
import type { Faction } from "./types";

/**
 * Full-screen, click-through cinematic overlays for 반지의 제왕: 가운데땅에서의 대결.
 *
 * `ActionCinematicFX` — one short banner per notable action (clash, ring
 * advance, fortress, alliance, new chapter): coloured rim light around the
 * viewport, a slam-in emblem card, and a CSS-only particle burst (radial
 * sparks, plus a shockwave ring / crossed blades / rising keep depending on
 * the type). Pure CSS transforms/opacity, so it stays cheap on phones.
 *
 * `EndingFX` — the game-over backdrop: a blackout, then either a burst of
 * light with rays (Fellowship) or falling ash and rising embers (Sauron).
 *
 * Particle positions come from the index (no `Math.random()` during render).
 */

export type ActionFXType = "COMBAT" | "RING_PULSE" | "LANDMARK_RISE" | "ALLIANCE_SPARK" | "CHAPTER";
export type FXColor = "GOLD" | "RED" | "BLUE" | "EMERALD";

export interface ActionFX {
  id: number;
  type: ActionFXType;
  title: string;
  subText: string;
  color: FXColor;
  emblem: string;
}

export const FX_KEYFRAMES = `
@keyframes lotrfx-rim { 0% { opacity: 0 } 15% { opacity: 1 } 70% { opacity: .8 } 100% { opacity: 0 } }
@keyframes lotrfx-slam { 0% { transform: scale(2.4); opacity: 0; filter: blur(6px) } 22% { transform: scale(.94); opacity: 1; filter: none } 32% { transform: scale(1.03) } 42%,82% { transform: scale(1); opacity: 1 } 100% { transform: scale(.96) translateY(-8px); opacity: 0 } }
@keyframes lotrfx-spark { 0% { transform: rotate(var(--a)) translateY(0) scale(1); opacity: 1 } 100% { transform: rotate(var(--a)) translateY(calc(var(--d) * -1)) scale(.2); opacity: 0 } }
@keyframes lotrfx-wave { 0% { transform: scale(.2); opacity: .9; border-width: 10px } 100% { transform: scale(3.2); opacity: 0; border-width: 1px } }
@keyframes lotrfx-blade-l { 0% { transform: translateX(-70px) rotate(-45deg); opacity: 0 } 30% { transform: translateX(0) rotate(-45deg); opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }
@keyframes lotrfx-blade-r { 0% { transform: translateX(70px) rotate(45deg); opacity: 0 } 30% { transform: translateX(0) rotate(45deg); opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }
@keyframes lotrfx-flash { 0% { opacity: 0 } 28% { opacity: 0 } 32% { opacity: .85 } 100% { opacity: 0 } }
@keyframes lotrfx-rise { 0% { transform: translateY(60px) scaleY(.2); opacity: 0 } 45% { transform: translateY(-6px) scaleY(1.05); opacity: 1 } 60%,85% { transform: none; opacity: 1 } 100% { opacity: 0 } }
@keyframes lotrfx-dust { 0% { transform: translateX(0) scale(.6); opacity: .8 } 100% { transform: translateX(var(--dx)) translateY(-14px) scale(1.6); opacity: 0 } }
@keyframes lotrfx-glow { 0%,100% { box-shadow: 0 0 20px 4px var(--c) } 50% { box-shadow: 0 0 60px 18px var(--c) } }
@keyframes lotrfx-black { 0% { opacity: 0 } 30%,100% { opacity: .82 } }
@keyframes lotrfx-burst { 0%,30% { transform: scale(0); opacity: 0 } 45% { opacity: 1 } 100% { transform: scale(4); opacity: 0 } }
@keyframes lotrfx-rays { 0%,35% { opacity: 0; transform: rotate(0) scale(.6) } 55% { opacity: .75 } 100% { opacity: .35; transform: rotate(40deg) scale(1.3) } }
@keyframes lotrfx-ash { 0% { transform: translate(0,-10vh) rotate(0); opacity: 0 } 10% { opacity: .8 } 100% { transform: translate(var(--dx),110vh) rotate(360deg); opacity: .2 } }
@keyframes lotrfx-ember { 0% { transform: translate(0,0) scale(1); opacity: 0 } 10% { opacity: 1 } 100% { transform: translate(var(--dx),-100vh) scale(.3); opacity: 0 } }
@keyframes lotrfx-shake { 0%,100% { transform: none } 15% { transform: translate(-6px,2px) rotate(-.4deg) } 30% { transform: translate(5px,-3px) rotate(.4deg) } 45% { transform: translate(-4px,1px) } 60% { transform: translate(3px,2px) } 80% { transform: translate(-2px,-1px) } }
.lotrfx-shake { animation: lotrfx-shake .55s cubic-bezier(.36,.07,.19,.97) both }
@keyframes lotrfx-card-rise { 0% { transform: translateY(0) scale(1); opacity: 1; filter: brightness(1) } 60% { transform: translateY(-38%) scale(1.12); opacity: 1; filter: brightness(1.6) drop-shadow(0 0 10px gold) } 100% { transform: translateY(-70%) scale(.9); opacity: 0 } }
.lotrfx-card-rise { animation: lotrfx-card-rise .95s ease-out both }
@keyframes lotrfx-pillar { 0% { transform: scaleY(0); opacity: 0 } 30% { transform: scaleY(1); opacity: .9 } 100% { transform: scaleY(1.2); opacity: 0 } }
.lotrfx-pillar { transform-origin: bottom; animation: lotrfx-pillar .95s ease-out both }
@keyframes lotrfx-flip { 0% { transform: perspective(500px) rotateY(90deg); filter: brightness(2) } 100% { transform: perspective(500px) rotateY(0); filter: none } }
.lotrfx-flip { animation: lotrfx-flip .6s cubic-bezier(.2,.8,.2,1) both }
@keyframes lotrfx-flip-spark { 0% { transform: rotate(var(--a)) translateY(0); opacity: 1 } 100% { transform: rotate(var(--a)) translateY(-26px); opacity: 0 } }
@keyframes lotrfx-trail-blue { 0% { background: rgba(56,189,248,.85); box-shadow: 0 0 14px rgba(56,189,248,.9) } 100% { background: rgba(56,189,248,.12); box-shadow: 0 0 4px rgba(56,189,248,.3) } }
@keyframes lotrfx-trail-red { 0% { background: rgba(239,68,68,.9); box-shadow: 0 0 14px rgba(249,115,22,.9) } 100% { background: rgba(127,29,29,.25); box-shadow: 0 0 4px rgba(239,68,68,.3) } }
.lotrfx-trail-blue { animation: lotrfx-trail-blue 1.6s ease-out both }
.lotrfx-trail-red { animation: lotrfx-trail-red 1.6s ease-out both }
@keyframes lotrfx-keep { 0% { transform: translateY(14px) scale(.3); opacity: 0 } 55% { transform: translateY(-3px) scale(1.25); opacity: 1 } 100% { transform: none; opacity: 1 } }
.lotrfx-keep { display: inline-block; animation: lotrfx-keep .8s cubic-bezier(.2,.9,.2,1) both }
@media (prefers-reduced-motion: reduce) { [class*="lotrfx-"] { animation-duration: .01ms !important } }
`;

const COLOR: Record<FXColor, { rim: string; glow: string; text: string; spark: string }> = {
  GOLD: { rim: "rgba(251,191,36,.55)", glow: "rgba(251,191,36,.55)", text: "from-amber-100 via-yellow-300 to-amber-500", spark: "#fcd34d" },
  RED: { rim: "rgba(225,29,72,.6)", glow: "rgba(244,63,94,.55)", text: "from-rose-100 via-rose-300 to-orange-400", spark: "#fb7185" },
  BLUE: { rim: "rgba(6,182,212,.55)", glow: "rgba(56,189,248,.55)", text: "from-cyan-100 via-sky-300 to-blue-400", spark: "#7dd3fc" },
  EMERALD: { rim: "rgba(16,185,129,.55)", glow: "rgba(52,211,153,.55)", text: "from-emerald-100 via-emerald-300 to-teal-400", spark: "#6ee7b7" },
};

const DURATION_MS = 1900;

export function ActionCinematicFX({ fx, onDismiss }: { fx: ActionFX | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!fx) return;
    const timer = window.setTimeout(onDismiss, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [fx, onDismiss]);

  if (!fx) return null;
  const c = COLOR[fx.color];
  const sparks = Array.from({ length: 18 }, (_, i) => ({ a: (i * 360) / 18 + (i % 3) * 7, d: 90 + ((i * 37) % 70), s: 4 + (i % 3) * 2 }));

  return (
    <div key={fx.id} className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center select-none" aria-live="polite">
      {/* 1. rim light */}
      <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 90px 10px ${c.rim}`, animation: `lotrfx-rim ${DURATION_MS}ms ease-out both` }} />

      <div className="relative flex items-center justify-center">
        {/* 2. type-specific layer */}
        {fx.type === "COMBAT" && (
          <>
            <div className="absolute h-[140px] w-[140px] rounded-full bg-rose-500/40 blur-2xl" style={{ animation: `lotrfx-flash 900ms ease-out both` }} />
            <span className="absolute text-6xl" style={{ animation: "lotrfx-blade-l 1100ms ease-out both" }}>
              🗡️
            </span>
            <span className="absolute text-6xl" style={{ animation: "lotrfx-blade-r 1100ms ease-out both" }}>
              🗡️
            </span>
          </>
        )}
        {(fx.type === "ALLIANCE_SPARK" || fx.type === "RING_PULSE" || fx.type === "CHAPTER") && (
          <>
            <div className="absolute h-28 w-28 rounded-full border-solid" style={{ borderColor: c.spark, animation: "lotrfx-wave 1100ms ease-out both" }} />
            <div className="absolute h-28 w-28 rounded-full border-solid" style={{ borderColor: c.spark, animation: "lotrfx-wave 1100ms ease-out 250ms both" }} />
          </>
        )}
        {fx.type === "LANDMARK_RISE" &&
          Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              className="absolute top-14 h-5 w-5 rounded-full bg-amber-200/40 blur-[2px]"
              style={{ ["--dx" as string]: `${(i - 3.5) * 26}px`, animation: `lotrfx-dust 900ms ease-out ${300 + i * 20}ms both` } as CSSProperties}
            />
          ))}
        {sparks.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={
              {
                width: s.s,
                height: s.s,
                background: c.spark,
                boxShadow: `0 0 8px ${c.spark}`,
                ["--a" as string]: `${s.a}deg`,
                ["--d" as string]: `${s.d}px`,
                animation: `lotrfx-spark 900ms cubic-bezier(.1,.8,.3,1) ${fx.type === "LANDMARK_RISE" ? 350 : 120}ms both`,
              } as React.CSSProperties
            }
          />
        ))}

        {/* 3. emblem card */}
        <div
          className="relative flex flex-col items-center rounded-3xl border border-amber-400/50 bg-neutral-950/90 px-8 py-5 backdrop-blur-md"
          style={{ ["--c" as string]: c.glow, animation: `lotrfx-slam ${DURATION_MS}ms cubic-bezier(.2,.9,.2,1) both, lotrfx-glow 1.2s ease-in-out infinite` } as CSSProperties}
        >
          <span className="mb-1 text-5xl" style={fx.type === "LANDMARK_RISE" ? { animation: "lotrfx-rise 1500ms cubic-bezier(.2,.9,.2,1) both", display: "inline-block" } : undefined}>
            {fx.emblem}
          </span>
          <h2 className={`bg-gradient-to-r ${c.text} bg-clip-text font-serif text-2xl font-black tracking-widest text-transparent drop-shadow-md sm:text-3xl`}>{fx.title}</h2>
          <p className="mt-1 text-center text-xs font-bold text-neutral-300 sm:text-sm">{fx.subText}</p>
        </div>
      </div>
    </div>
  );
}

export function EndingFX({ winner }: { winner: Faction }) {
  const light = winner === "FELLOWSHIP";
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      <div className="absolute inset-0 bg-black" style={{ animation: "lotrfx-black 900ms ease-out both" }} />
      {light ? (
        <>
          <div
            className="absolute top-1/2 left-1/2 -mt-[20vmax] -ml-[20vmax] h-[40vmax] w-[40vmax] opacity-0"
            style={{ background: "repeating-conic-gradient(from 0deg, rgba(253,230,138,.28) 0deg 6deg, transparent 6deg 18deg)", animation: "lotrfx-rays 3s ease-out 0.2s both" }}
          />
          <div
            className="absolute top-1/2 left-1/2 -mt-[12vmax] -ml-[12vmax] h-[24vmax] w-[24vmax] rounded-full"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,.95), rgba(253,224,71,.6) 40%, transparent 70%)", animation: "lotrfx-burst 2.2s ease-out both" }}
          />
          {Array.from({ length: 26 }, (_, i) => (
            <span
              key={i}
              className="absolute bottom-0 h-1.5 w-1.5 rounded-full bg-amber-100 shadow-[0_0_8px_#fde68a]"
              style={{ left: `${(i * 37) % 100}%`, ["--dx" as string]: `${((i * 53) % 60) - 30}px`, animation: `lotrfx-ember ${3 + (i % 5) * 0.6}s ease-out ${0.8 + (i % 9) * 0.25}s infinite` } as CSSProperties}
            />
          ))}
        </>
      ) : (
        <>
          <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: "linear-gradient(to top, rgba(234,88,12,.45), rgba(127,29,29,.2) 50%, transparent)", animation: "lotrfx-rim 4s ease-in-out infinite" }} />
          {Array.from({ length: 30 }, (_, i) => (
            <span
              key={`ash${i}`}
              className="absolute top-0 h-2 w-2 rounded-[2px] bg-zinc-400/70"
              style={{ left: `${(i * 29) % 100}%`, ["--dx" as string]: `${((i * 41) % 80) - 40}px`, animation: `lotrfx-ash ${4 + (i % 6) * 0.7}s linear ${(i % 10) * 0.35}s infinite` } as CSSProperties}
            />
          ))}
          {Array.from({ length: 24 }, (_, i) => (
            <span
              key={`emb${i}`}
              className="absolute bottom-0 h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_8px_#f97316]"
              style={{ left: `${(i * 43) % 100}%`, ["--dx" as string]: `${((i * 31) % 70) - 35}px`, animation: `lotrfx-ember ${2.6 + (i % 5) * 0.5}s ease-out ${0.6 + (i % 8) * 0.3}s infinite` } as CSSProperties}
            />
          ))}
        </>
      )}
    </div>
  );
}
