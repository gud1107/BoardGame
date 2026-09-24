"use client";

import { COLOR_ACCENT, DuelToken, TOKEN_LABEL, TokenCount } from "./DuelToken";
import { GEM_ORDER, type CardAbility, type DuelCard, type Level, type RoyalCard, type SplendorDuelState } from "./engine";

export const ABILITY_META: Record<CardAbility, { icon: string; label: string; desc: string }> = {
  extraTurn: { icon: "↻", label: "추가 턴", desc: "이번 턴이 끝나면 즉시 한 턴 더 진행" },
  copyBonus: { icon: "?", label: "보너스 복사", desc: "내 보석 카드 1장의 색을 복사해 그 색 보너스로 등록" },
  takeToken: { icon: "⬇", label: "토큰 획득", desc: "보드에서 이 카드와 같은 색 토큰 1개 획득" },
  gainPrivilege: { icon: "📜", label: "특권 획득", desc: "특권 스크롤 1개 획득(공용에 없으면 상대에게서)" },
  stealToken: { icon: "✋", label: "토큰 강탈", desc: "상대의 진주/기본 보석 1개를 빼앗음" },
};

const LEVEL_FRAME: Record<Level, string> = {
  1: "from-emerald-900/70 to-stone-950",
  2: "from-amber-800/60 to-stone-950",
  3: "from-sky-900/70 to-stone-950",
};

function cardFace(color: DuelCard["color"]) {
  return color ? COLOR_ACCENT[color] : "#a8a29e";
}

/** One development card. `compact` shrinks everything for the phone market rows. */
export function DuelCardView({
  card,
  compact = false,
  affordable = false,
  onClick,
  boundColor,
}: {
  card: DuelCard;
  compact?: boolean;
  affordable?: boolean;
  onClick?: () => void;
  boundColor?: DuelCard["color"];
}) {
  const color = boundColor ?? card.color;
  const costEntries = ([...GEM_ORDER, "pearl"] as const).filter((c) => (card.cost[c] ?? 0) > 0);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`relative flex aspect-[5/7] w-full flex-col overflow-hidden rounded-lg border bg-gradient-to-b text-left transition ${LEVEL_FRAME[card.level]} ${
        affordable ? "border-amber-300/80 shadow-[0_0_12px_rgba(252,211,77,0.35)]" : "border-white/10"
      } ${onClick ? "hover:-translate-y-0.5 hover:border-amber-200" : ""}`}
    >
      <div className="flex items-start justify-between px-1 pt-0.5" style={{ background: `linear-gradient(90deg, ${cardFace(color)}55, transparent)` }}>
        <span className={`font-serif font-black text-white drop-shadow ${compact ? "text-xs" : "text-base"}`}>{card.points > 0 ? card.points : ""}</span>
        <span className="flex flex-col items-end leading-none">
          {card.crowns > 0 && <span className={compact ? "text-[8px]" : "text-[11px]"}>{"👑".repeat(card.crowns)}</span>}
          {card.ability && (
            <span className={`mt-0.5 rounded bg-black/60 px-0.5 font-bold text-amber-200 ${compact ? "text-[8px]" : "text-[10px]"}`} title={ABILITY_META[card.ability].label}>
              {ABILITY_META[card.ability].icon}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center">
        {color ? (
          <span title={`${TOKEN_LABEL[color]} 보너스 ×${card.bonus}`} className="inline-flex">
            <DuelToken color={color} className={compact ? "h-4 w-4" : "h-7 w-7"} />
          </span>
        ) : (
          <span
            className={`rounded-full border border-white/40 ${compact ? "h-3 w-3" : "h-5 w-5"}`}
            style={{ background: "conic-gradient(#c9e2fb, #1f6fe5, #0e9f6e, #e0194a, #3b3847, #dfe9f3)" }}
            title={card.bonus > 0 ? "복사 보너스" : "보너스 없음"}
          />
        )}
        {card.bonus > 1 && <span className="ml-0.5 text-[9px] font-bold text-white/80">×{card.bonus}</span>}
      </div>
      <div className={`flex flex-wrap gap-x-1 bg-black/40 px-0.5 pb-0.5 ${compact ? "gap-y-0" : "gap-y-0.5"}`}>
        {costEntries.map((c) => (
          <TokenCount key={c} color={c} count={card.cost[c]!} size={compact ? "h-2 w-2" : "h-3 w-3"} />
        ))}
      </div>
    </button>
  );
}

export function CardBack({ level, count, onClick, compact = false }: { level: Level; count?: number; onClick?: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`relative flex aspect-[5/7] w-full flex-col items-center justify-center rounded-lg border border-amber-500/30 bg-gradient-to-br ${LEVEL_FRAME[level]} ${onClick ? "hover:border-amber-300" : ""}`}
    >
      <span className={`font-serif font-black text-amber-300/80 ${compact ? "text-xs" : "text-lg"}`}>{"Ⅰ Ⅱ Ⅲ".split(" ")[level - 1]}</span>
      {count !== undefined && <span className="text-[9px] text-white/50">{count}장</span>}
    </button>
  );
}

export function RoyalCardView({ royal, onClick, compact = false }: { royal: RoyalCard; onClick?: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex aspect-[5/6] w-full flex-col items-center justify-center rounded-lg border border-amber-300/50 bg-gradient-to-b from-amber-700/50 via-stone-900 to-black text-center ${
        onClick ? "animate-pulse hover:border-amber-200" : ""
      }`}
    >
      <span className={compact ? "text-xs" : "text-lg"}>👑</span>
      <span className={`font-serif font-black text-amber-200 ${compact ? "text-xs" : "text-base"}`}>{royal.points}점</span>
      {royal.ability && <span className="text-[9px] text-amber-100/70">{ABILITY_META[royal.ability].icon} {!compact && ABILITY_META[royal.ability].label}</span>}
    </button>
  );
}

/** Level 3 → 1 rows, each with its deck tile, plus the royal cards strip on top. */
export default function CardMarket({
  state,
  compact,
  isAffordable,
  onCardClick,
  onDeckClick,
}: {
  state: SplendorDuelState;
  compact: boolean;
  isAffordable: (card: DuelCard) => boolean;
  onCardClick?: (card: DuelCard, level: Level, index: number) => void;
  onDeckClick?: (level: Level) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[9px] font-bold tracking-widest text-amber-300/80">ROYAL</span>
        <div className="grid flex-1 grid-cols-6 gap-1">
          {state.royals.map((r) => (
            <RoyalCardView key={r.id} royal={r} compact />
          ))}
        </div>
      </div>
      {([3, 2, 1] as Level[]).map((level) => (
        <div key={level} className="flex items-center gap-1.5">
          <div className="w-10 shrink-0">
            <CardBack level={level} count={state.decks[level].length} compact onClick={onDeckClick && state.decks[level].length > 0 ? () => onDeckClick(level) : undefined} />
          </div>
          <div className="grid flex-1 grid-cols-6 gap-1">
            {state.market[level].map((card, i) =>
              card ? (
                <DuelCardView key={card.id} card={card} compact={compact} affordable={isAffordable(card)} onClick={onCardClick ? () => onCardClick(card, level, i) : undefined} />
              ) : (
                <div key={`empty-${level}-${i}`} className="aspect-[5/7] rounded-lg border border-dashed border-white/10" />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
