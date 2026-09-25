"use client";

import { CHAIN_INFO, RACE_INFO, REGION_INFO, TECH_INFO } from "./data";
import type { CardColor, LotrDuelCard, TechSymbol } from "./types";

export const COLOR_STYLE: Record<CardColor, { band: string; ring: string; text: string; chip: string }> = {
  GRAY: { band: "from-slate-400 to-slate-600", ring: "ring-slate-300/60", text: "text-slate-100", chip: "bg-slate-500/30 text-slate-100" },
  GREEN: { band: "from-emerald-400 to-emerald-700", ring: "ring-emerald-300/60", text: "text-emerald-100", chip: "bg-emerald-500/25 text-emerald-100" },
  RED: { band: "from-rose-400 to-rose-700", ring: "ring-rose-300/60", text: "text-rose-100", chip: "bg-rose-500/25 text-rose-100" },
  YELLOW: { band: "from-amber-300 to-amber-600", ring: "ring-amber-300/60", text: "text-amber-100", chip: "bg-amber-500/25 text-amber-100" },
  BLUE: { band: "from-sky-400 to-blue-700", ring: "ring-sky-300/60", text: "text-sky-100", chip: "bg-sky-500/25 text-sky-100" },
  PURPLE: { band: "from-fuchsia-400 to-violet-700", ring: "ring-violet-300/60", text: "text-violet-100", chip: "bg-violet-500/25 text-violet-100" },
};

export function techEmoji(list: TechSymbol[] = []): string {
  return list.map((s) => TECH_INFO[s].emoji).join("");
}

/** Big glyph shown in the middle of a card face. */
export function cardGlyph(card: LotrDuelCard): string {
  switch (card.color) {
    case "GRAY":
      return card.selectTechChoice ? card.selectTechChoice.map((s) => TECH_INFO[s].emoji).join("/") : techEmoji(card.providesTech);
    case "GREEN":
      return RACE_INFO[card.race!].emoji;
    case "RED":
      return `🪖×${card.militaryUnits!.count}`;
    case "YELLOW":
      return `🪙${card.coinsReward}`;
    case "BLUE":
      return `💍+${card.ringAdvance}`;
    case "PURPLE":
      return card.tacticsType === "MULTI_MOVE" ? `👣×${card.tacticsAmount}` : card.tacticsType === "SNIPE_UNIT" ? `🎯×${card.tacticsAmount}` : `💸${card.tacticsAmount}`;
  }
}

export function describeCard(card: LotrDuelCard): string {
  switch (card.color) {
    case "GRAY":
      return card.selectTechChoice
        ? `매 턴 ${card.selectTechChoice.map((s) => TECH_INFO[s].name).join(" 또는 ")} 기호 1개 생산`
        : `매 턴 ${card.providesTech!.map((s) => TECH_INFO[s].name).join("·")} 기호 영구 생산`;
    case "GREEN":
      return `${RACE_INFO[card.race!].name} 종족 기호 — 같은 종족 2장 / 서로 다른 3종족이면 동맹 토큰`;
    case "RED":
      return `${card.militaryUnits!.allowedRegions.map((r) => REGION_INFO[r].name).join(" 또는 ")}에 유닛 ${card.militaryUnits!.count}개 배치`;
    case "YELLOW":
      return `즉시 ${card.coinsReward}주화 획득`;
    case "BLUE":
      return `원정 트랙에서 내 말 ${card.ringAdvance}칸 전진`;
    case "PURPLE":
      return card.tacticsType === "MULTI_MOVE"
        ? `아군 유닛 ${card.tacticsAmount}회 이동 (매 이동마다 교전)`
        : card.tacticsType === "SNIPE_UNIT"
          ? `적 유닛 ${card.tacticsAmount}개 즉시 제거`
          : `상대 주화 ${card.tacticsAmount}개를 은행에 반납`;
  }
}

export function CostChips({ card, className = "" }: { card: LotrDuelCard; className?: string }) {
  const { coins, tech, chainSymbol } = card.cost;
  const free = !coins && !tech?.length;
  return (
    <span className={`inline-flex flex-wrap items-center gap-0.5 ${className}`}>
      {chainSymbol && <span className="rounded bg-white/15 px-0.5" title="연계 기호 — 보유 시 무료">🔗{CHAIN_INFO[chainSymbol]}</span>}
      {coins ? <span>🪙{coins}</span> : null}
      {tech?.map((s, i) => (
        <span key={i}>{TECH_INFO[s].emoji}</span>
      ))}
      {free && !chainSymbol && <span className="opacity-70">무료</span>}
    </span>
  );
}

/** Compact pyramid card. Width is set by the parent; the face scales with it. */
export function CardFace({
  card,
  faceDown,
  chapter,
  available,
  affordable,
  selected,
  onClick,
}: {
  card: LotrDuelCard | null;
  faceDown?: boolean;
  chapter?: number;
  available?: boolean;
  affordable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  if (faceDown || !card) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border border-amber-900/50 bg-[radial-gradient(circle_at_50%_40%,#3b2a12,#120d07)] text-[clamp(10px,2.4vw,18px)] font-bold text-amber-500/60 shadow-md">
        {"Ⅰ Ⅱ Ⅲ".split(" ")[(chapter ?? 1) - 1]}
      </div>
    );
  }
  const st = COLOR_STYLE[card.color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!available}
      className={`group relative flex h-full w-full flex-col overflow-hidden rounded-md border bg-[#16131c] text-left shadow-md transition ${
        selected ? "z-20 -translate-y-1 border-amber-300 ring-2 ring-amber-300" : available ? `border-white/30 hover:-translate-y-0.5 hover:ring-2 ${st.ring}` : "border-white/10 brightness-[.55]"
      } ${available && !affordable ? "opacity-90" : ""}`}
      title={`${card.name} — ${describeCard(card)}`}
    >
      <div className={`h-[18%] w-full bg-gradient-to-r ${st.band}`} />
      {card.providesChain && <span className="absolute top-0 right-0.5 text-[clamp(7px,1.4vw,11px)] leading-tight">{CHAIN_INFO[card.providesChain]}</span>}
      <div className="flex flex-1 items-center justify-center px-0.5 text-center text-[clamp(9px,2vw,16px)] leading-none font-bold text-white">{cardGlyph(card)}</div>
      <p className="truncate px-0.5 text-center text-[clamp(6px,1.25vw,10px)] leading-tight text-white/80">{card.name}</p>
      <div className="flex min-h-[18%] items-center justify-center bg-black/40 px-0.5 text-[clamp(6px,1.3vw,10px)] leading-none text-white/85">
        <CostChips card={card} />
      </div>
      {available && (
        <span className={`absolute top-[20%] left-0.5 h-1.5 w-1.5 rounded-full ${affordable ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-rose-400"}`} />
      )}
    </button>
  );
}
