/**
 * Pure presentation data + inline visuals for 코요테 — no game logic. Shared
 * between `CoyoteBoard.tsx` and `CoyoteEffects.tsx` so both render the same
 * card identity (same split as dalmuti/summonersRift's `CardArt.tsx`/
 * `assets.ts` pairs). This game has no provided card photography at all
 * (see HANDOFF.md), so every card face here is drawn purely with CSS/emoji.
 */
import type { Card } from "./engine";

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case "number":
      return card.value > 0 ? `+${card.value}` : `${card.value}`;
    case "night":
      return "0";
    case "question":
      return "?";
    case "maxZero":
      return "MAX→0";
    case "double":
      return "×2";
  }
}

export function cardCaption(card: Card): string {
  switch (card.kind) {
    case "number":
      if (card.value < 0) return card.value === -10 ? "몬스터" : "도둑";
      if (card.value === 0) return "인디언 소년";
      return "코요테 카드";
    case "night":
      return "밤 · 선 교체";
    case "question":
      return "보물상자";
    case "maxZero":
      return "인디언 소녀";
    case "double":
      return "인디언 추장";
  }
}

export function cardEmoji(card: Card): string {
  switch (card.kind) {
    case "number":
      if (card.value < 0) return card.value === -10 ? "👹" : "🥷";
      if (card.value === 0) return "🧒";
      return "🐺";
    case "night":
      return "🌙";
    case "question":
      return "🎁";
    case "maxZero":
      return "👧";
    case "double":
      return "🪶";
  }
}

/** Background gradient by card family — warm desert tones for plain numbers, cool/distinct tones for each special so they read instantly on a crowded table. */
export function cardTierBg(card: Card): string {
  if (card.kind === "night") return "linear-gradient(160deg,#1b2a4a 0%,#0d1526 55%,#05070f 100%)";
  if (card.kind === "question") return "linear-gradient(160deg,#4a3312 0%,#241a08 55%,#100b03 100%)";
  if (card.kind === "maxZero") return "linear-gradient(160deg,#4a1030 0%,#240818 55%,#10030c 100%)";
  if (card.kind === "double") return "linear-gradient(160deg,#123a2e 0%,#0a2118 55%,#04120c 100%)";
  if (card.value < 0) return "linear-gradient(160deg,#4a1010 0%,#240808 55%,#100303 100%)";
  if (card.value === 0) return "linear-gradient(160deg,#3a3a1a 0%,#1c1c0d 55%,#0e0e06 100%)";
  return "linear-gradient(160deg,#4a3010 0%,#241808 55%,#100c03 100%)";
}

export function cardTierBorder(card: Card): string {
  if (card.kind === "night") return "border-indigo-300/50";
  if (card.kind === "question") return "border-amber-300/50";
  if (card.kind === "maxZero") return "border-rose-300/50";
  if (card.kind === "double") return "border-emerald-300/50";
  if (card.value < 0) return "border-red-400/50";
  return "border-amber-200/40";
}

/**
 * A forehead card face. `card === null` renders the "이마 밴드" mystery back
 * (this is *my own* card while the round is live — see engine.ts's
 * `getPlayerView`), never a real value the viewer isn't entitled to see.
 */
export function CardFace({
  card,
  className = "",
  highlight = false,
  size = "md",
}: {
  card: Card | null;
  className?: string;
  highlight?: boolean;
  size?: "sm" | "md";
}) {
  const dims = size === "sm" ? "h-14 w-10" : "h-20 w-14";
  if (!card) {
    return (
      <div
        className={`relative flex ${dims} shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/25 bg-black/50 ${className}`}
        title="내 이마 위 카드 (나에게는 숨겨져 있어요)"
      >
        <span className="text-xl">❓</span>
      </div>
    );
  }
  return (
    <div
      className={`relative flex ${dims} shrink-0 flex-col items-center justify-between rounded-lg border p-1 transition ${cardTierBorder(card)} ${
        highlight ? "shadow-[0_0_14px_-2px_rgba(251,191,36,0.85)] ring-2 ring-amber-300/70" : ""
      } ${className}`}
      style={{ background: cardTierBg(card) }}
    >
      <span className="text-sm leading-none">{cardEmoji(card)}</span>
      <span className={`leading-none font-black text-white ${size === "sm" ? "text-base" : "text-lg"}`}>{cardLabel(card)}</span>
      <span className="max-w-full truncate text-center text-[7px] leading-tight text-white/60">{cardCaption(card)}</span>
    </div>
  );
}

/** Heart (life) pips — "하트(목숨)" framing, backed by the rulebook's "벌점 토큰 = 탈락" (see engine.ts module doc #5 for the 3→2 house-rule count). */
export function HeartPips({ hearts, max }: { hearts: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < hearts ? "text-rose-400" : "text-white/15"}>
          {i < hearts ? "❤️" : "🤍"}
        </span>
      ))}
    </span>
  );
}
