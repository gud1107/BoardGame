"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HERO_BY_ID } from "./units";

/**
 * 최후의 4인 / 최후의 결투(2인) 연출 — 전투 재생이 끝나고 상점 단계가 시작될 때 한 번.
 * 붉은 번개 줄기 + 화면 테두리 불꽃 + 거대한 제목이 내려찍히고, 살아남은 손님 이름표가 차례로 쾅쾅 박힌다.
 * 2인은 양쪽에서 이름표가 날아와 가운데 VS에서 부딪힌다. 화면을 막지 않는다(pointer-events-none).
 * 배치는 결정적(Math.random 없음).
 */

export const FINAL_STAND_MS = 3800;

export interface FinalStandPlayer {
  seat: number;
  name: string;
  hero: string | null;
  hp: number;
  me: boolean;
}

const BOLTS = Array.from({ length: 9 }, (_, i) => ({ left: 6 + i * 11 + ((i * 7) % 5), delay: 0.05 + ((i * 3) % 7) * 0.07, tilt: ((i * 37) % 30) - 15, h: 55 + ((i * 13) % 4) * 10 }));
const EMBERS = Array.from({ length: 36 }, (_, i) => ({ left: (i * 29) % 100, delay: ((i * 11) % 18) / 10, dur: 1.6 + ((i * 7) % 6) / 5, size: 4 + ((i * 5) % 4) * 2 }));
const SPARKS = Array.from({ length: 30 }, (_, i) => {
  const a = (i / 30) * Math.PI * 2;
  const r = 180 + ((i * 41) % 5) * 30;
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r * 0.6, size: 5 + ((i * 13) % 3) * 3 };
});

const CSS = `
@keyframes fs-out { 0%,86%{opacity:1} 100%{opacity:0} }
@keyframes fs-dim { 0%{opacity:0} 8%{opacity:1} 100%{opacity:1} }
@keyframes fs-flash { 0%{opacity:0} 6%{opacity:.9} 30%{opacity:0} 34%{opacity:.5} 50%{opacity:0} 100%{opacity:0} }
@keyframes fs-bolt { 0%{opacity:0; transform:scaleY(0)} 8%{opacity:1; transform:scaleY(1)} 20%{opacity:.2} 26%{opacity:1} 45%{opacity:0} 100%{opacity:0} }
@keyframes fs-ember { 0%{opacity:0; transform:translateY(0) scale(1)} 15%{opacity:1} 100%{opacity:0; transform:translateY(-70vh) scale(.3)} }
@keyframes fs-title { 0%{opacity:0; transform:scale(3.2) translateY(-20px); filter:blur(8px)} 35%{opacity:1; transform:scale(.92); filter:blur(0)} 45%{transform:scale(1.06)} 55%,100%{opacity:1; transform:scale(1)} }
@keyframes fs-shake { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-8px,4px)} 40%{transform:translate(7px,-5px)} 60%{transform:translate(-5px,-3px)} 80%{transform:translate(4px,3px)} }
@keyframes fs-sub { 0%,40%{opacity:0; transform:translateY(10px)} 60%,100%{opacity:1; transform:translateY(0)} }
@keyframes fs-plate { 0%{opacity:0; transform:translateY(-60px) scale(1.6)} 60%{opacity:1; transform:translateY(4px) scale(.96)} 100%{opacity:1; transform:translateY(0) scale(1)} }
@keyframes fs-left { 0%{opacity:0; transform:translateX(-60vw) rotate(-8deg)} 70%{opacity:1; transform:translateX(14px) rotate(2deg)} 100%{opacity:1; transform:translateX(0) rotate(0)} }
@keyframes fs-right { 0%{opacity:0; transform:translateX(60vw) rotate(8deg)} 70%{opacity:1; transform:translateX(-14px) rotate(-2deg)} 100%{opacity:1; transform:translateX(0) rotate(0)} }
@keyframes fs-vs { 0%,45%{opacity:0; transform:scale(4) rotate(-30deg)} 60%{opacity:1; transform:scale(.85) rotate(4deg)} 70%,100%{opacity:1; transform:scale(1) rotate(0)} }
@keyframes fs-ring { 0%{width:30px;height:30px;opacity:1;border-width:12px} 100%{width:900px;height:900px;opacity:0;border-width:1px} }
@keyframes fs-spark { 0%{opacity:1; transform:translate(-50%,-50%) scale(1.5)} 100%{opacity:0; transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.2)} }
@keyframes fs-sheen { 0%{background-position:-150% 0} 100%{background-position:250% 0} }
@keyframes fs-pulse { 0%,100%{box-shadow:inset 0 0 90px 20px var(--fs-c)} 50%{box-shadow:inset 0 0 160px 50px var(--fs-c)} }
.fs-root { animation: fs-out ${FINAL_STAND_MS}ms ease-in forwards; }
.fs-title { background: linear-gradient(100deg, #fff7ed 0%, #fde047 30%, #fff 50%, #f97316 70%, #fde047 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: fs-title .9s cubic-bezier(.2,1.4,.4,1) .15s both, fs-sheen 1.4s ease-in-out 1s 2; }
@media (prefers-reduced-motion: reduce) {
  .fs-root *, .fs-root { animation-duration: 1ms !important; animation-delay: 0ms !important; }
}
`;

function Plate({ p, style, big }: { p: FinalStandPlayer; style: React.CSSProperties; big?: boolean }) {
  const h = p.hero ? HERO_BY_ID[p.hero] : null;
  return (
    <div
      style={style}
      className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-2 shadow-[0_0_24px_rgba(250,204,21,0.45)] ${
        p.me ? "border-yellow-200 bg-gradient-to-b from-amber-500/95 to-amber-800/95" : "border-white/30 bg-gradient-to-b from-stone-700/95 to-stone-900/95"
      } ${big ? "px-5 py-3" : ""}`}
    >
      <span className={big ? "text-5xl" : "text-3xl"}>{h?.emoji ?? "🍺"}</span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={`max-w-[9rem] truncate font-black text-white ${big ? "text-xl" : "text-base"}`}>
          {p.name}
          {p.me && <span className="ml-1 text-xs text-yellow-100">(나)</span>}
        </span>
        <span className="text-xs font-bold text-rose-200">❤ {p.hp}</span>
      </span>
    </div>
  );
}

export default function FinalStandFX({ count, players, onDone }: { count: 4 | 2; players: FinalStandPlayer[]; onDone: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t0 = window.setTimeout(() => setMounted(true), 0);
    const t1 = window.setTimeout(onDone, FINAL_STAND_MS);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [onDone]);
  if (!mounted) return null;
  const duel = count === 2;
  const color = duel ? "rgba(220,38,38,0.75)" : "rgba(234,88,12,0.6)";
  return createPortal(
    <div className="fs-root pointer-events-none fixed inset-0 z-[120] overflow-hidden" aria-live="polite">
      <style>{CSS}</style>
      {/* 어둡게 + 테두리 불길 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,8,4,0.7),rgba(0,0,0,0.94))]" style={{ animation: "fs-dim .4s ease-out both" }} />
      <div className="absolute inset-0" style={{ ["--fs-c" as string]: color, animation: "fs-pulse 1.1s ease-in-out infinite" }} />
      <div className="absolute inset-0 bg-white" style={{ animation: "fs-flash 1.2s ease-out both" }} />
      {/* 번개 줄기 */}
      {BOLTS.map((b, i) => (
        <div
          key={i}
          className="absolute top-0 w-[3px] origin-top"
          style={{
            left: `${b.left}%`,
            height: `${b.h}vh`,
            rotate: `${b.tilt}deg`,
            background: duel ? "linear-gradient(#fff, #f87171 40%, transparent)" : "linear-gradient(#fff, #fdba74 40%, transparent)",
            boxShadow: duel ? "0 0 14px 4px #ef4444" : "0 0 14px 4px #f97316",
            animation: `fs-bolt .9s ease-out ${b.delay}s both`,
          }}
        />
      ))}
      {/* 솟아오르는 불씨 */}
      {EMBERS.map((e, i) => (
        <span
          key={i}
          className="absolute bottom-0 rounded-full"
          style={{ left: `${e.left}%`, width: e.size, height: e.size, background: i % 3 ? "#fb923c" : "#fde047", boxShadow: "0 0 8px #f97316", animation: `fs-ember ${e.dur}s ease-out ${e.delay}s both` }}
        />
      ))}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4" style={{ animation: "fs-shake .35s ease-in-out .45s 2" }}>
        {/* 충격파 + 파편 */}
        <div className="absolute left-1/2 top-[42%]">
          <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-yellow-200" style={{ animation: "fs-ring .9s ease-out .4s both", borderStyle: "solid" }} />
          {SPARKS.map((s, i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{ width: s.size, height: s.size, background: i % 2 ? "#fde047" : "#f97316", ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px`, animation: `fs-spark 1s ease-out .42s both` }}
            />
          ))}
        </div>
        <p className="text-sm font-black tracking-[0.4em] text-rose-200 drop-shadow" style={{ animation: "fs-sub .9s ease-out both" }}>
          {duel ? "⚔️ FINAL DUEL ⚔️" : "🔥 FINAL FOUR 🔥"}
        </p>
        <h2 className="fs-title text-center text-6xl font-black drop-shadow-[0_6px_0_rgba(0,0,0,0.6)] sm:text-8xl">{duel ? "최후의 결투" : "최후의 4인"}</h2>
        <p className="text-center text-sm font-bold text-amber-100/90" style={{ animation: "fs-sub 1.1s ease-out both" }}>
          {duel ? "이기는 한 명이 여관의 챔피언!" : "여관에 남은 손님은 단 네 명"}
        </p>
        {duel ? (
          <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row sm:gap-6">
            {players[0] && <Plate p={players[0]} big style={{ animation: "fs-left .7s cubic-bezier(.2,1.2,.4,1) .55s both" }} />}
            <span className="text-5xl font-black text-red-500 drop-shadow-[0_0_18px_#ef4444] sm:text-7xl" style={{ animation: "fs-vs .9s ease-out .6s both" }}>
              VS
            </span>
            {players[1] && <Plate p={players[1]} big style={{ animation: "fs-right .7s cubic-bezier(.2,1.2,.4,1) .55s both" }} />}
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            {players.map((p, i) => (
              <Plate key={p.seat} p={p} style={{ animation: `fs-plate .5s cubic-bezier(.2,1.4,.4,1) ${0.7 + i * 0.22}s both` }} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
