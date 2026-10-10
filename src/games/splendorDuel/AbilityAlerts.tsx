"use client";

import { ABILITY_META, RoyalCardView } from "./CardMarket";
import type { CardAbility, RoyalCard } from "./engine";

const CSS = `
@keyframes sd-rc-life{0%{opacity:0}8%{opacity:1}86%{opacity:1}100%{opacity:0}}
@keyframes sd-rc-rays{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes sd-rc-card{0%{opacity:0;transform:translateY(-60px) scale(.4) rotate(-14deg)}45%{opacity:1;transform:translateY(6px) scale(1.12) rotate(3deg)}65%{transform:translateY(0) scale(.97) rotate(-1deg)}100%{opacity:1;transform:none}}
@keyframes sd-rc-title{0%{opacity:0;transform:scale(2.2);letter-spacing:.5em}40%{opacity:1;transform:scale(1);letter-spacing:.08em}100%{opacity:1;transform:none;letter-spacing:.08em}}
@keyframes sd-rc-spark{0%{opacity:0;transform:translate(-50%,-50%) rotate(var(--a)) translateY(0) scale(.4)}15%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) rotate(var(--a)) translateY(var(--d)) scale(1)}}
@keyframes sd-rc-stamp{0%{opacity:0;transform:scale(2.6) rotate(-8deg)}60%{opacity:1;transform:scale(.92) rotate(-3deg)}100%{opacity:1;transform:scale(1) rotate(-3deg)}}
@keyframes sd-ab-toast{0%{opacity:0;transform:translate(-50%,-14px) scale(.85)}10%{opacity:1;transform:translate(-50%,0) scale(1.06)}18%{transform:translate(-50%,0) scale(1)}85%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-8px)}}
.sd-rc-life{animation:sd-rc-life 3.6s ease-out forwards}
.sd-rc-rays{animation:sd-rc-rays 9s linear infinite}
.sd-rc-card{animation:sd-rc-card .9s cubic-bezier(.2,.9,.3,1.2) both}
.sd-rc-title{animation:sd-rc-title .7s ease-out .15s both}
.sd-rc-spark{animation:sd-rc-spark 1.4s ease-out both}
.sd-rc-stamp{animation:sd-rc-stamp .5s cubic-bezier(.2,.9,.3,1.3) .85s both}
.sd-ab-toast{animation:sd-ab-toast 2.6s ease-out forwards}
@media (prefers-reduced-motion:reduce){.sd-rc-rays,.sd-rc-card,.sd-rc-title,.sd-rc-stamp{animation:none}.sd-rc-spark{display:none}}
`;

// 18 sparks fanned around the card: angle, travel distance, delay, color.
const SPARKS = Array.from({ length: 18 }, (_, i) => ({
  a: `${i * 20 + (i % 2 ? 7 : 0)}deg`,
  d: `${-(120 + (i % 3) * 45)}px`,
  delay: `${0.35 + (i % 4) * 0.12}s`,
  color: ["#fde68a", "#fbbf24", "#f0abfc", "#fff7ed"][i % 4],
}));

/** What the royal's ability does right now, from this viewer's side. */
function royalAbilityLine(ability: CardAbility, isMe: boolean): string {
  switch (ability) {
    case "stealToken":
      return isMe ? "상대의 보석/진주 1개를 골라 빼앗으세요!" : "내 보석/진주 1개를 빼앗아 갑니다!";
    case "extraTurn":
      return isMe ? "이 턴이 끝나면 한 턴 더!" : "상대가 한 턴 더 진행합니다!";
    case "gainPrivilege":
      return isMe ? "특권 스크롤 1개를 받았어요!" : "상대가 특권 스크롤 1개를 받았습니다!";
    default:
      return ABILITY_META[ability].desc;
  }
}

/**
 * Full-screen celebration when anyone claims a royal card — portrait drops in
 * over rotating gold rays with a spark burst, then the ability "발동!" stamp.
 * Auto-closes after ~3.6s (or on tap); never blocks the follow-up choice for long.
 */
export function RoyalCeremony({ royal, who, isMe, onDone }: { royal: RoyalCard; who: string; isMe: boolean; onDone: () => void }) {
  const meta = royal.ability ? ABILITY_META[royal.ability] : null;
  return (
    <div
      className="sd-rc-life fixed inset-0 z-[70] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(76,29,149,0.55)_0%,rgba(0,0,0,0.88)_65%)] px-4 text-white"
      onClick={onDone}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onDone();
      }}
      role="status"
      aria-live="polite"
    >
      <style>{CSS}</style>
      <div
        aria-hidden="true"
        className="sd-rc-rays pointer-events-none absolute top-1/2 left-1/2 h-[160vmax] w-[160vmax] opacity-50"
        style={{ background: "repeating-conic-gradient(from 0deg, rgba(253,224,71,0.35) 0deg 6deg, transparent 6deg 18deg)", maskImage: "radial-gradient(circle, black 0%, transparent 45%)", WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 45%)" }}
      />
      <p className="sd-rc-title relative mb-3 font-serif text-2xl font-black text-amber-200 drop-shadow-[0_0_12px_rgba(251,191,36,0.9)] sm:text-3xl">👑 왕실 카드 획득!</p>
      <div className="relative">
        {SPARKS.map((sp, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="sd-rc-spark pointer-events-none absolute top-1/2 left-1/2 h-2 w-2 rounded-full"
            style={{ ["--a" as string]: sp.a, ["--d" as string]: sp.d, animationDelay: sp.delay, background: sp.color, boxShadow: `0 0 8px ${sp.color}` }}
          />
        ))}
        <div className="sd-rc-card relative w-36 drop-shadow-[0_0_28px_rgba(251,191,36,0.75)] sm:w-44">
          <RoyalCardView royal={royal} />
        </div>
      </div>
      <p className="relative mt-3 text-center text-sm font-bold text-amber-50">
        {isMe ? "내가" : `${who}님이`} <span className="text-amber-300">{royal.name}</span>의 인정을 받았습니다 · <span className="text-amber-300">+{royal.points}점</span>
      </p>
      {meta && royal.ability && (
        <div className="sd-rc-stamp relative mt-3 flex flex-col items-center rounded-2xl border-2 border-amber-300 bg-gradient-to-b from-fuchsia-900/90 to-stone-950/95 px-4 py-2 shadow-[0_0_24px_rgba(232,121,249,0.6)]">
          <span className="text-lg font-black text-amber-200">
            {meta.icon} {meta.label} 발동!
          </span>
          <span className="text-xs text-amber-50/90">{royalAbilityLine(royal.ability, isMe)}</span>
        </div>
      )}
      <p className="relative mt-4 text-[10px] text-white/50">탭하면 닫혀요</p>
    </div>
  );
}

/** Short banner over the board when a card/royal ability fires (steal, extra turn, …). Keyed by the caller so each event replays. */
export function AbilityToast({ icon, title, detail, mine, onDone }: { icon: string; title: string; detail: string; mine: boolean; onDone: () => void }) {
  return (
    <div
      className={`sd-ab-toast pointer-events-none absolute top-2 left-1/2 z-40 flex max-w-[92%] items-center gap-2 rounded-2xl border-2 px-3 py-1.5 shadow-2xl ${
        mine ? "border-amber-300 bg-gradient-to-r from-amber-600/95 to-yellow-500/95 text-stone-950" : "border-rose-300 bg-gradient-to-r from-rose-800/95 to-fuchsia-800/95 text-white"
      }`}
      onAnimationEnd={onDone}
      role="status"
      aria-live="polite"
    >
      <style>{CSS}</style>
      <span className="text-2xl leading-none font-black">{icon}</span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-black whitespace-nowrap">{title}</span>
        <span className="text-[11px] font-semibold opacity-90">{detail}</span>
      </span>
    </div>
  );
}
