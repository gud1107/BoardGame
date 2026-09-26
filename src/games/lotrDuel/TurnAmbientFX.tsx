"use client";

import type { Faction } from "./types";

/**
 * Turn clarity FX for 반지의 제왕: 가운데땅에서의 대결.
 *
 * - `TurnRimLight`: a breathing rim of light around the whole viewport in the
 *   colour of the faction whose turn it is (Fellowship = elven gold/emerald,
 *   Sauron = crimson). Strong on my turn, faint while the opponent thinks.
 * - `OpponentFocusAura`: sits inside a pyramid slot while the opponent is
 *   hovering / has opened that card (their `card-focus` broadcast) — a misty
 *   aura in their colour, falling rune dust and a "검토 중…" chip.
 *
 * Everything is pointer-events: none and respects prefers-reduced-motion
 * (`lotrturn-anim` loses its animation).
 */

export const AURA: Record<Faction, { rgb: string; alt: string; hex: string; dust: string; label: string }> = {
  FELLOWSHIP: { rgb: "251,191,36", alt: "52,211,153", hex: "#fbbf24", dust: "#fde68a", label: "💍 원정대" },
  SAURON: { rgb: "225,29,72", alt: "127,29,29", hex: "#e11d48", dust: "#fda4af", label: "👁️ 사우론" },
};

export const TURN_KEYFRAMES = `
@keyframes lotrturn-rim { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
@keyframes lotrturn-breathe { 0%,100% { box-shadow: 0 0 14px rgba(var(--aura),.35), inset 0 0 10px rgba(var(--aura),.15) } 50% { box-shadow: 0 0 34px rgba(var(--aura),.8), inset 0 0 22px rgba(var(--aura),.35) } }
@keyframes lotrturn-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
@keyframes lotrturn-dust { 0% { transform: translateY(0) scale(1); opacity: 0 } 15% { opacity: 1 } 60% { transform: translateY(26px) scale(1.3); opacity: .8 } 100% { transform: translateY(58px) scale(.2); opacity: 0 } }
@keyframes lotrturn-mist { 0%,100% { opacity: .55; transform: scale(1) } 50% { opacity: 1; transform: scale(1.04) } }
@keyframes lotrturn-dots { 0%,20% { opacity: .2 } 50% { opacity: 1 } 80%,100% { opacity: .2 } }
.lotrturn-breathe { animation: lotrturn-breathe 2.5s ease-in-out infinite }
.lotrturn-float { animation: lotrturn-float 3s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .lotrturn-anim, .lotrturn-breathe, .lotrturn-float { animation: none !important } }
`;

export function TurnRimLight({ faction, mine }: { faction: Faction; mine: boolean }) {
  const a = AURA[faction];
  return (
    <div
      aria-hidden
      className="lotrturn-anim pointer-events-none fixed inset-0 z-[34] transition-[box-shadow] duration-700"
      style={{
        boxShadow: mine
          ? `inset 0 0 0 3px rgba(${a.rgb},.75), inset 0 0 44px rgba(${a.rgb},.32), inset 0 0 90px rgba(${a.alt},.14)`
          : `inset 0 0 0 2px rgba(${a.rgb},.35), inset 0 0 36px rgba(${a.rgb},.16)`,
        animation: `lotrturn-rim ${mine ? 2.5 : 3.4}s ease-in-out infinite`,
      }}
    />
  );
}

/** Deterministic dust layout (no Math.random in render). */
const DUST = Array.from({ length: 9 }, (_, i) => ({ left: 8 + ((i * 37) % 84), top: 10 + ((i * 23) % 35), delay: i * 170, size: i % 3 === 0 ? 5 : 3 }));

export function OpponentFocusAura({ faction }: { faction: Faction }) {
  const a = AURA[faction];
  return (
    <span aria-hidden className="pointer-events-none absolute -inset-1.5 z-20">
      <span
        className="lotrturn-anim absolute inset-0 rounded-xl"
        style={{
          border: `2px solid ${a.hex}`,
          boxShadow: `0 0 25px rgba(${a.rgb},.9), inset 0 0 15px rgba(${a.rgb},.55)`,
          animation: "lotrturn-mist 1.6s ease-in-out infinite",
        }}
      />
      <span className="absolute inset-0 overflow-hidden rounded-xl">
        {DUST.map((d, i) => (
          <span
            key={i}
            className="lotrturn-anim absolute rounded-full"
            style={{
              left: `${d.left}%`,
              top: `${d.top}%`,
              width: d.size,
              height: d.size,
              background: a.dust,
              boxShadow: `0 0 6px ${a.hex}`,
              animation: `lotrturn-dust 1.4s ease-out ${d.delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span className="absolute -top-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black/90 px-2 py-0.5 font-mono text-[9px] font-black whitespace-nowrap text-white shadow-lg">
        <span>{a.label}</span>
        <span className="text-amber-300">검토 중</span>
        <span className="lotrturn-anim text-amber-300" style={{ animation: "lotrturn-dots 1.2s ease-in-out infinite" }}>
          …
        </span>
      </span>
    </span>
  );
}
