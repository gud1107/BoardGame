/**
 * Pure presentation data + inline visuals for 달무티 — no game logic. Shared
 * between `DalmutiBoard.tsx` and `DalmutiEffects.tsx` so both render the same
 * card/role identity (same split as summonersRift's `assets.ts`/`CardArt.tsx`
 * pair, minus the external image files — this game's only asset is the
 * composite reference photo used for the hub thumbnail, see HANDOFF.md, so
 * card faces here are drawn purely with CSS/inline SVG like most other games
 * in this project).
 */
import type { Card } from "./engine";
import { JOKER_RANK } from "./engine";

/** Rulebook §1's official card-rank titles (1 = 위대한 달무티 .. 12 = 농노), plus the joker. */
export const CARD_RANK_INFO: Record<number, { title: string; short: string; emoji: string }> = {
  1: { title: "위대한 달무티", short: "달무티", emoji: "👑" },
  2: { title: "총리", short: "총리", emoji: "⛪" },
  3: { title: "대시종", short: "대시종", emoji: "🎖️" },
  4: { title: "남작", short: "남작", emoji: "🏰" },
  5: { title: "여관주인", short: "여관주인", emoji: "🍺" },
  6: { title: "재봉사", short: "재봉사", emoji: "🧵" },
  7: { title: "석공", short: "석공", emoji: "🧱" },
  8: { title: "농부", short: "농부", emoji: "🌾" },
  9: { title: "광대", short: "광대", emoji: "🤹" },
  10: { title: "양치기", short: "양치기", emoji: "🐑" },
  11: { title: "광부", short: "광부", emoji: "⛏️" },
  12: { title: "농노", short: "농노", emoji: "🧑‍🌾" },
  [JOKER_RANK]: { title: "어릿광대", short: "조커", emoji: "🃏" },
};

/** Background gradient tier by card rank — the smaller the number (higher class), the richer/more royal the color; the joker gets its own wild black/crimson treatment. */
export function cardTierBg(rank: number): string {
  if (rank === JOKER_RANK) return "linear-gradient(160deg,#3a0a12 0%,#1a0308 55%,#0a0104 100%)";
  if (rank <= 2) return "linear-gradient(160deg,#4c2a7a 0%,#2c1652 55%,#160b2e 100%)";
  if (rank <= 5) return "linear-gradient(160deg,#1e3a6b 0%,#122347 55%,#0a1328 100%)";
  if (rank <= 9) return "linear-gradient(160deg,#2f5a34 0%,#1c3820 55%,#0e1e10 100%)";
  return "linear-gradient(160deg,#5a4326 0%,#382a18 55%,#1c150c 100%)";
}
export function cardTierBorder(rank: number): string {
  if (rank === JOKER_RANK) return "border-rose-400/60";
  if (rank <= 2) return "border-fuchsia-300/50";
  if (rank <= 5) return "border-sky-300/45";
  if (rank <= 9) return "border-emerald-300/40";
  return "border-amber-200/35";
}

export function CardFace({
  card,
  className = "",
  highlight = false,
}: {
  card: Card;
  className?: string;
  highlight?: boolean;
}) {
  const info = CARD_RANK_INFO[card.rank];
  return (
    <div
      className={`relative flex h-24 w-16 shrink-0 flex-col items-center justify-between rounded-lg border p-1 transition ${cardTierBorder(card.rank)} ${
        highlight ? "shadow-[0_0_14px_-2px_rgba(251,191,36,0.85)] ring-2 ring-amber-300/70" : ""
      } ${className}`}
      style={{ background: cardTierBg(card.rank) }}
    >
      <span className="text-base leading-none">{info.emoji}</span>
      <span className="text-2xl leading-none font-black text-white">{card.isJoker ? "★" : card.rank}</span>
      <span className="max-w-full truncate text-center text-[8px] leading-tight text-white/70">{info.short}</span>
    </div>
  );
}

/** Small role badge next to a seat's name — task brief §2 "계급별 좌석 시각화". */
export const ROLE_BADGE: Record<string, { emoji: string; color: string }> = {
  달무티: { emoji: "👑", color: "text-amber-200" },
  총리: { emoji: "🎗️", color: "text-sky-200" },
  중농: { emoji: "🧑‍🌾", color: "text-emerald-200" },
  소농노: { emoji: "🧺", color: "text-lime-200" },
  대농노: { emoji: "🧹", color: "text-white/60" },
};

export function RoleBadge({ title, className = "" }: { title: string; className?: string }) {
  const info = ROLE_BADGE[title] ?? ROLE_BADGE["중농"];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold ${info.color} ${className}`}
    >
      <span>{info.emoji}</span>
      {title}
    </span>
  );
}
