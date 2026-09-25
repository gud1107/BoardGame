"use client";

import { CardBackArt, CardIllustration } from "./CardArt";
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

export const FRAME_TINT: Record<CardColor, { inner: string; band: string; label: string }> = {
  GRAY: { inner: "from-[#1e2330] to-[#0b0d13]", band: "from-slate-500/80 to-slate-800/90", label: "기술" },
  GREEN: { inner: "from-[#0f2a20] to-[#05100b]", band: "from-emerald-600/80 to-emerald-900/90", label: "종족" },
  RED: { inner: "from-[#2d0d14] to-[#0f0306]", band: "from-rose-600/85 to-rose-950/90", label: "군사" },
  YELLOW: { inner: "from-[#2b1d06] to-[#0e0802]", band: "from-amber-500/85 to-amber-900/90", label: "재정" },
  BLUE: { inner: "from-[#0a1f33] to-[#030812]", band: "from-cyan-600/80 to-blue-950/90", label: "반지" },
  PURPLE: { inner: "from-[#231036] to-[#08030f]", band: "from-fuchsia-600/80 to-violet-950/90", label: "전술" },
};

/** Stepped art-deco corner ornaments + inner hairline, drawn over the card in its own box. */
function DecoFrame() {
  const corner = "M0 7 V2 Q0 0 2 0 H7 M3 9 V4 Q3 3 4 3 H9";
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 60 80" preserveAspectRatio="none" aria-hidden>
      <g fill="none" stroke="#f2c14e" strokeOpacity=".85" strokeWidth="1" vectorEffect="non-scaling-stroke">
        <path d={corner} transform="translate(2 2)" />
        <path d={corner} transform="translate(58 2) scale(-1 1)" />
        <path d={corner} transform="translate(2 78) scale(1 -1)" />
        <path d={corner} transform="translate(58 78) scale(-1 -1)" />
        <rect x="4.5" y="4.5" width="51" height="71" rx="2" strokeOpacity=".22" />
      </g>
    </svg>
  );
}

/**
 * Art-deco pyramid card: embossed gold frame, header (chain symbol left, the
 * viewer's real cost right), SVG illustration window, effect badge + name.
 * The parent sets the box size (3:4); every inner size scales with it.
 *
 * States: `available` (uncovered, my turn) glows with a gold rim light;
 * `locked` (face-up but still covered) is dimmed behind a faint hologram
 * seal; face-down cards show the rune-seal back.
 */
export function CardFace({
  card,
  faceDown,
  chapter,
  available,
  affordable,
  selected,
  locked,
  costInCoins,
  viaChain,
  onClick,
}: {
  card: LotrDuelCard | null;
  faceDown?: boolean;
  chapter?: number;
  available?: boolean;
  affordable?: boolean;
  selected?: boolean;
  locked?: boolean;
  costInCoins?: number;
  viaChain?: boolean;
  onClick?: () => void;
}) {
  if (faceDown || !card) {
    return (
      <div className="h-full w-full rounded-[7%] bg-gradient-to-br from-[#8a6421] via-[#3b2a12] to-[#8a6421] p-[3%] shadow-[0_4px_10px_rgba(0,0,0,.6)]">
        <div className="h-full w-full overflow-hidden rounded-[6%]">
          <CardBackArt chapter={chapter ?? 1} />
        </div>
      </div>
    );
  }
  const tint = FRAME_TINT[card.color];
  const cost = costInCoins ?? (card.cost.coins ?? 0) + (card.cost.tech?.length ?? 0);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!available}
      title={`${card.name} — ${describeCard(card)}`}
      className={`group relative block h-full w-full rounded-[7%] p-[3%] text-left transition duration-300 ${
        selected
          ? "z-20 -translate-y-[6%] bg-gradient-to-b from-[#fff2c2] via-[#f2c14e] to-[#a8741f] shadow-[0_0_18px_rgba(251,191,36,.85)]"
          : available
            ? `lotrd-rim bg-gradient-to-b from-[#f7dc8c] via-[#a8741f] to-[#f2c14e] hover:-translate-y-[4%] ${affordable ? "" : "saturate-[.7]"}`
            : "bg-gradient-to-b from-[#6b5424] via-[#3a2d14] to-[#6b5424]"
      } shadow-[0_4px_10px_rgba(0,0,0,.55)]`}
    >
      <div className={`relative flex h-full w-full flex-col overflow-hidden rounded-[6%] bg-gradient-to-b ${tint.inner}`}>
        {/* header: chain symbol + cost gem */}
        <div className="flex h-[17%] shrink-0 items-center justify-between px-[6%] text-[clamp(6px,1.35vw,11px)] leading-none">
          <span className={card.cost.chainSymbol ? "text-amber-200" : "font-serif text-amber-200/50"} title={card.cost.chainSymbol ? "연계 기호 — 보유 시 무료" : undefined}>
            {card.cost.chainSymbol ? `🔗${CHAIN_INFO[card.cost.chainSymbol]}` : ["Ⅰ", "Ⅱ", "Ⅲ"][card.chapter - 1]}
          </span>
          <span
            className={`rounded-full px-[0.35em] py-[0.1em] font-black ring-1 ${
              viaChain || cost === 0
                ? "bg-emerald-500/25 text-emerald-200 ring-emerald-300/50"
                : affordable === false
                  ? "bg-rose-600/30 text-rose-200 ring-rose-300/50"
                  : "bg-amber-400/25 text-amber-100 ring-amber-300/60"
            }`}
          >
            {viaChain ? "🔗무료" : cost === 0 ? "무료" : `🪙${cost}`}
          </span>
        </div>
        {/* illustration window */}
        <div className="relative mx-[5%] min-h-0 flex-1 overflow-hidden rounded-[8%] ring-1 ring-amber-300/40">
          <CardIllustration card={card} />
          {card.providesChain && (
            <span className="absolute right-[4%] bottom-[4%] rounded bg-black/65 px-[0.25em] text-[clamp(6px,1.2vw,10px)] leading-tight ring-1 ring-amber-300/50" title="이 카드가 제공하는 연계 기호">
              {CHAIN_INFO[card.providesChain]}
            </span>
          )}
        </div>
        {/* footer: effect badge + name */}
        <div className={`mt-[4%] flex h-[21%] shrink-0 flex-col items-center justify-center bg-gradient-to-b ${tint.band} px-[4%] text-center`}>
          <span className="text-[clamp(7px,1.45vw,12px)] leading-none font-black text-white drop-shadow">{cardGlyph(card)}</span>
          <span className="w-full truncate font-serif text-[clamp(5.5px,1.1vw,9px)] leading-tight text-amber-50/90">{card.name}</span>
        </div>
        <DecoFrame />
        {locked && (
          <span className="pointer-events-none absolute inset-0 flex items-start justify-center bg-[repeating-linear-gradient(0deg,rgba(148,163,184,.08)_0_2px,transparent_2px_4px)] bg-black/30 pt-[26%]">
            <span className="rounded-full bg-black/60 px-[0.35em] text-[clamp(8px,1.6vw,13px)] opacity-80 ring-1 ring-sky-300/40">🔒</span>
          </span>
        )}
        {available && <span className="pointer-events-none absolute inset-0 rounded-[6%] bg-gradient-to-tr from-transparent via-white/10 to-transparent opacity-0 transition group-hover:opacity-100" />}
      </div>
    </button>
  );
}
