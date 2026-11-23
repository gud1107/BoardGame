"use client";

import { useEffect, useState } from "react";
import type { Scenario } from "./sim";
import type { ForecastItem } from "./forecast";

/**
 * 멍냥 방어선 overlays: disaster forecast, round intro banner, CLEAR / FAIL
 * burst and the final victory screen. CSS keyframes only (no canvas/WebGL);
 * reduced-motion turns the shake/confetti off.
 */

const CSS = `
@keyframes pg-pop { 0% { transform: scale(.3) rotate(-8deg); opacity: 0 } 55% { transform: scale(1.18) rotate(3deg); opacity: 1 } 75% { transform: scale(.95) rotate(-1deg) } 100% { transform: scale(1) rotate(0) } }
@keyframes pg-fade { 0% { opacity: 0 } 12% { opacity: 1 } 82% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pg-rays { to { transform: rotate(360deg) } }
@keyframes pg-confetti { 0% { transform: translate(0,0) rotate(0); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0 } }
@keyframes pg-shake { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-9px,4px) } 30% { transform: translate(8px,-5px) } 45% { transform: translate(-6px,-3px) } 60% { transform: translate(5px,4px) } 75% { transform: translate(-3px,2px) } }
@keyframes pg-slam { 0% { transform: scale(2.6); opacity: 0; filter: blur(6px) } 60% { transform: scale(.92); opacity: 1; filter: blur(0) } 100% { transform: scale(1) } }
@keyframes pg-crack { from { stroke-dashoffset: 300 } to { stroke-dashoffset: 0 } }
@keyframes pg-glow { 0%,100% { text-shadow: 0 0 18px rgba(253,224,71,.9), 0 0 42px rgba(251,191,36,.6) } 50% { text-shadow: 0 0 28px rgba(254,240,138,1), 0 0 70px rgba(251,191,36,.8) } }
@keyframes pg-slide { 0% { transform: translateY(-30px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
@keyframes pg-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
@keyframes pg-float { 0% { transform: translateY(0) } 100% { transform: translateY(-120%) ; opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .pg-motion { animation: none !important } }
`;

export function PetFxStyles() {
  return <style>{CSS}</style>;
}

const CONFETTI_COLORS = ["#facc15", "#f472b6", "#34d399", "#60a5fa", "#fb923c", "#c084fc"];

function Confetti({ n = 36 }: { n?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {Array.from({ length: n }, (_, k) => {
        const ang = (k / n) * Math.PI * 2 + (k % 3) * 0.3;
        const dist = 120 + ((k * 53) % 90);
        return (
          <span
            key={k}
            className="pg-motion absolute left-1/2 top-1/2 block"
            style={
              {
                width: 6 + (k % 3) * 3,
                height: 10 + (k % 4) * 3,
                background: CONFETTI_COLORS[k % CONFETTI_COLORS.length],
                borderRadius: k % 2 ? 2 : 999,
                "--dx": `${Math.cos(ang) * dist}px`,
                "--dy": `${Math.sin(ang) * dist + 60}px`,
                "--rot": `${(k % 2 ? 1 : -1) * (360 + k * 20)}deg`,
                animation: `pg-confetti ${1.3 + (k % 5) * 0.15}s cubic-bezier(.15,.7,.4,1) ${(k % 6) * 0.04}s forwards`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

/** Big CLEAR / FAIL stamp over the player's own board. */
export function OutcomeBurst({ survived, title, sub, score }: { survived: boolean; title?: string; sub: string; score: number }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden rounded-xl ${survived ? "bg-gradient-to-b from-amber-300/25 via-black/30 to-emerald-500/25" : "bg-gradient-to-b from-rose-900/55 via-black/45 to-rose-950/60"}`}
      style={{ animation: survived ? undefined : "pg-shake .55s ease-out" }}
    >
      {survived ? (
        <>
          <div
            className="pg-motion absolute left-1/2 top-1/2 h-[180%] w-[180%] -translate-x-1/2 -translate-y-1/2 opacity-60"
            style={{ background: "repeating-conic-gradient(from 0deg, rgba(253,224,71,.38) 0deg 10deg, transparent 10deg 24deg)", animation: "pg-rays 9s linear infinite" }}
          />
          <Confetti />
        </>
      ) : (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {[
            "M50 48 L38 30 L30 8",
            "M50 48 L66 34 L80 12",
            "M50 48 L30 60 L6 70",
            "M50 48 L72 64 L96 78",
            "M50 48 L48 74 L56 98",
          ].map((d, k) => (
            <path key={k} d={d} fill="none" stroke="rgba(254,202,202,.85)" strokeWidth=".8" strokeDasharray="300" style={{ animation: `pg-crack .45s ease-out ${0.08 * k}s both` }} />
          ))}
        </svg>
      )}
      <div className="relative flex flex-col items-center" style={{ animation: survived ? "pg-pop .7s cubic-bezier(.2,1.4,.4,1) both" : "pg-slam .5s cubic-bezier(.2,.9,.3,1) both" }}>
        <span className="text-5xl drop-shadow-lg sm:text-6xl">{survived ? "🛡️" : "💥"}</span>
        <span
          className={`mt-1 text-4xl font-black tracking-wider sm:text-5xl ${survived ? "text-amber-200" : "text-rose-200"}`}
          style={{
            WebkitTextStroke: survived ? "1.5px #92400e" : "1.5px #7f1d1d",
            animation: survived ? "pg-glow 1.4s ease-in-out infinite" : undefined,
            textShadow: survived ? undefined : "0 0 20px rgba(239,68,68,.9), 0 4px 0 #450a0a",
          }}
        >
          {title ?? (survived ? "CLEAR!" : "FAIL...")}
        </span>
        <span className={`mt-1 rounded-full px-3 py-1 text-sm font-bold ${survived ? "bg-emerald-500/85 text-white" : "bg-rose-600/85 text-white"}`}>{sub}</span>
        <span className="mt-1.5 text-lg font-black text-white drop-shadow" style={{ animation: "pg-pulse 1s ease-in-out infinite" }}>
          +{score}점
        </span>
      </div>
    </div>
  );
}

/** Small stamp for the other players' mini boards. */
export function MiniStamp({ survived }: { survived: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl">
      <span
        className={`rounded-lg px-2 py-0.5 text-sm font-black ${survived ? "bg-emerald-500/90 text-white" : "bg-rose-600/90 text-white"}`}
        style={{ animation: "pg-pop .5s cubic-bezier(.2,1.4,.4,1) both", transform: "rotate(-8deg)" }}
      >
        {survived ? "🛡️ CLEAR" : "💥 FAIL"}
      </span>
    </div>
  );
}

/** Round start: "🚨 재난 경보" banner over the board for ~3.2 s. */
export function RoundIntro({ sc, round, rounds, items }: { sc: Scenario; round: number; rounds: number; items: ForecastItem[] }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setShow(false), 3200);
    return () => window.clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <div
      className="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-black/65 p-3 text-center"
      style={{ animation: "pg-fade 3.2s ease-in-out both" }}
      onClick={() => setShow(false)}
    >
      <span className="rounded-full bg-rose-600 px-3 py-0.5 text-xs font-black tracking-widest text-white" style={{ animation: "pg-pulse .6s ease-in-out infinite" }}>
        🚨 재난 경보 · 라운드 {round}/{rounds}
      </span>
      <span className="text-6xl" style={{ animation: "pg-pop .7s cubic-bezier(.2,1.4,.4,1) both" }}>
        {sc.emoji}
      </span>
      <span className="text-2xl font-black text-white">{sc.name}</span>
      <div className="flex flex-wrap justify-center gap-1.5">
        {items.map((it, k) => (
          <span key={k} className="rounded-full border px-2.5 py-1 text-xs font-bold text-white" style={{ borderColor: it.color, background: `${it.color}33`, animation: `pg-slide .35s ease-out ${0.35 + k * 0.12}s both` }}>
            {it.icon} {it.what} {it.amount}
          </span>
        ))}
      </div>
      <span className="text-[11px] text-white/60">눌러서 닫기</span>
    </div>
  );
}

/** Forecast card: one row per hazard + a tick timeline. */
export function ForecastPanel({ items, ticks, extra }: { items: ForecastItem[]; ticks: number; extra?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-rose-400/30 bg-gradient-to-br from-rose-500/15 to-orange-500/5 p-2.5 light:bg-rose-50">
      <p className="mb-1.5 text-xs font-black text-rose-200 light:text-rose-700">🚨 이번 라운드 재난 예보</p>
      <div className="flex flex-col gap-1">
        {items.map((it, k) => (
          <div key={k} className="flex items-center gap-2 rounded-lg bg-black/25 px-2 py-1 light:bg-white">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg" style={{ background: `${it.color}40`, boxShadow: `0 0 0 2px ${it.color}` }}>
              {it.icon}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-xs font-bold text-white light:text-slate-900">
                {it.what} <span className="text-amber-300 light:text-amber-600">{it.amount}</span>
              </p>
              <p className="truncate text-[10px] text-white/65 light:text-slate-500">
                {it.where} · ⏱ {it.when}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="relative mt-2 h-4 overflow-hidden rounded-full bg-black/35 light:bg-slate-200" title="언제 무엇이 오는지 (왼쪽 = 시작)">
        {items.map((it, k) => (
          <div
            key={k}
            className="absolute rounded-full"
            style={{
              left: `${(Math.min(ticks, it.from) / ticks) * 100}%`,
              width: `${Math.max(2, ((Math.min(ticks, it.to) - Math.min(ticks, it.from)) / ticks) * 100)}%`,
              top: `${(k / Math.max(1, items.length)) * 100}%`,
              height: `${100 / Math.max(1, items.length)}%`,
              background: it.color,
              opacity: 0.85,
            }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-white/45 light:text-slate-500">
        <span>0틱</span>
        <span>버티기 {ticks}틱 🏁</span>
      </div>
      {extra}
    </div>
  );
}

/** Game over: full-width victory / placement banner. */
export function FinalBanner({ rank, name, total }: { rank: number; name: string; total: number }) {
  const win = rank === 1;
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 text-center ${win ? "bg-gradient-to-b from-amber-400/40 via-amber-500/15 to-transparent" : "bg-gradient-to-b from-slate-500/35 to-transparent"}`}>
      {win && (
        <>
          <div
            className="pg-motion absolute left-1/2 top-1/2 h-[300%] w-[200%] -translate-x-1/2 -translate-y-1/2 opacity-50"
            style={{ background: "repeating-conic-gradient(from 0deg, rgba(253,224,71,.4) 0deg 8deg, transparent 8deg 20deg)", animation: "pg-rays 12s linear infinite" }}
          />
          <Confetti n={48} />
        </>
      )}
      <div className="relative" style={{ animation: "pg-pop .8s cubic-bezier(.2,1.4,.4,1) both" }}>
        <div className="text-6xl">{win ? "🏆" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🐾"}</div>
        <div
          className={`text-4xl font-black ${win ? "text-amber-200" : "text-white light:text-slate-800"}`}
          style={win ? { WebkitTextStroke: "1.5px #92400e", animation: "pg-glow 1.4s ease-in-out infinite" } : undefined}
        >
          {win ? "VICTORY!" : `${rank}위`}
        </div>
        <div className="mt-1 text-sm font-bold text-white/85 light:text-slate-700">
          {win ? `${name} 승리! 최고의 방어선` : `${name} · 다음엔 꼭 지켜내요`} · {total}점
        </div>
      </div>
    </div>
  );
}
