"use client";

import { COLOR_ACCENT, DuelToken, TOKEN_LABEL, TokenCount } from "./DuelToken";
import { AbilityJewel, cardFrameStyle, CrownRow, GemWindow, GoldNumeral, royalFrameStyle, WaxSeal } from "./LuxuryArt";
import CardScene, { sceneFor } from "./CardScene";
import RoyalPortrait from "./RoyalPortrait";
import { crownsOf, GEM_ORDER, ROYAL_CROWN_THRESHOLDS, type CardAbility, type DuelCard, type Level, type PlayerState, type RoyalCard, type SplendorDuelState } from "./engine";

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
  const scene = sceneFor(card);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={cardFrameStyle(card.level, affordable)}
      className={`group relative flex aspect-[5/7] w-full flex-col overflow-hidden rounded-lg text-left transition ${
        affordable ? "shadow-[0_0_14px_rgba(252,211,77,0.45)]" : "shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
      } ${onClick ? "hover:-translate-y-0.5 hover:brightness-110" : ""}`}
    >
      <div className="flex items-start justify-between px-1 pt-0.5" style={{ background: `linear-gradient(90deg, ${cardFace(color)}66, transparent 85%)` }}>
        {card.points > 0 ? <GoldNumeral value={card.points} className={compact ? "text-xs" : "text-base"} /> : <span />}
        <span className="flex flex-col items-end gap-px leading-none">
          <CrownRow count={card.crowns} className={compact ? "h-2 w-2.5" : "h-3 w-3.5"} />
          {card.ability && <AbilityJewel ability={card.ability} title={ABILITY_META[card.ability].label} className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />}
        </span>
      </div>
      <div className={`relative flex flex-1 overflow-hidden ${compact ? "min-h-0 items-end justify-between gap-0.5 px-0.5 pb-0.5" : "min-h-0 px-1 py-0.5"}`}>
        {/* Phone cards: the scene fills the whole middle band behind the cost column. */}
        {compact && <CardScene card={card} color={color} className="opacity-80 transition-transform duration-500 group-hover:scale-110" />}
        {/* Phone cards: costs stack down the left edge (like the printed card) so they never wrap and get clipped. */}
        {compact && (
          <div className="relative flex flex-col gap-px">
            {costEntries.map((c) => (
              <span key={c} className="inline-flex items-center gap-px rounded-sm bg-black/70 pr-0.5 font-mono text-[9px] leading-none font-bold text-amber-50 ring-1 ring-amber-300/25">
                <DuelToken color={c} className="h-2.5 w-2.5" />
                {card.cost[c]}
              </span>
            ))}
          </div>
        )}
        <span
          className={`relative inline-flex ${compact ? "self-end" : "flex-1 items-end justify-end overflow-hidden rounded-md border border-amber-200/30 shadow-[inset_0_0_10px_rgba(0,0,0,0.7)]"}`}
          title={`${scene.label} · ${color ? `${TOKEN_LABEL[color]} 보너스 ×${card.bonus}` : card.bonus > 0 ? "복사 보너스" : "보너스 없음"}`}
        >
          {!compact && <CardScene card={card} color={color} className="transition-transform duration-500 group-hover:scale-110" />}
          <GemWindow color={color} stoneClass={compact ? "h-4 w-4" : "h-6 w-6"} className={compact ? "p-0.5" : "m-0.5 p-0.5"} />
          {card.bonus > 1 && <span className="absolute -right-0.5 bottom-0 rounded bg-black/70 px-0.5 text-[9px] font-bold text-amber-100">×{card.bonus}</span>}
        </span>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-x-1 gap-y-0.5 border-t border-amber-200/20 bg-black/50 px-0.5 pb-0.5">
          {costEntries.map((c) => (
            <TokenCount key={c} color={c} count={card.cost[c]!} size="h-3 w-3" />
          ))}
        </div>
      )}
    </button>
  );
}

export function CardBack({ level, count, onClick, compact = false }: { level: Level; count?: number; onClick?: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={cardFrameStyle(level, true)}
      className={`relative flex aspect-[5/7] w-full flex-col items-center justify-center rounded-lg bg-gradient-to-br ${LEVEL_FRAME[level]} ${onClick ? "hover:brightness-125" : ""}`}
    >
      <span className={`flex items-center justify-center rounded-full border border-amber-300/60 bg-black/40 ${compact ? "h-6 w-6" : "h-9 w-9"}`}>
        <span className={`font-serif font-black text-amber-300 ${compact ? "text-[10px]" : "text-lg"}`}>{"Ⅰ Ⅱ Ⅲ".split(" ")[level - 1]}</span>
      </span>
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
      title={`${royal.name} · ${royal.points}점${royal.ability ? ` · ${ABILITY_META[royal.ability].label}` : ""}`}
      style={royalFrameStyle()}
      className={`relative flex aspect-[5/6] w-full flex-col overflow-hidden rounded-lg text-center shadow-[0_0_10px_rgba(251,191,36,0.25)] ${
        onClick ? "ring-2 ring-amber-300/70 hover:brightness-110" : ""
      }`}
    >
      <RoyalPortrait royalId={royal.id} className="absolute inset-0 h-full w-full" />
      {/* Gilded inner filet */}
      <span className="pointer-events-none absolute inset-[2px] rounded-md border border-amber-200/40" />
      <span className="relative flex items-start justify-between p-0.5">
        <span className="rounded bg-black/60 px-1 leading-tight">
          <GoldNumeral value={royal.points} className={compact ? "text-[10px]" : "text-sm"} />
        </span>
        {royal.ability && <AbilityJewel ability={royal.ability} title={ABILITY_META[royal.ability].label} className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />}
      </span>
      <WaxSeal royalId={royal.id} className={`absolute ${compact ? "right-0 bottom-0 h-3.5 w-3.5" : "right-1 bottom-6 h-7 w-7"}`} />
      {!compact && (
        <span className="relative mt-auto border-t border-amber-300/50 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-1 pt-1 pb-1 font-serif text-[10px] font-bold tracking-wide text-amber-100">
          {royal.name}
        </span>
      )}
    </button>
  );
}

/**
 * Crown track under the royal cards (rulebook §5): a royal card is claimed
 * the moment the viewer's crowns reach 3, then again at 6 — every multiple
 * of 3, max 2. Marked at the bottom-left ("3") and bottom-right ("6") ends.
 */
function CrownTrack({ viewer }: { viewer: PlayerState }) {
  const crowns = crownsOf(viewer);
  const claimed = viewer.royals.length;
  const pct = Math.min(100, (crowns / ROYAL_CROWN_THRESHOLDS[1]) * 100);
  const mark = (n: number, i: number) => {
    const done = claimed > i;
    const ready = !done && crowns >= n;
    return (
      <span
        className={`flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-black ${
          done ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200" : ready ? "border-amber-200 bg-amber-400 text-black" : "border-amber-400/40 bg-black/50 text-amber-200"
        }`}
        title={`왕관 ${n}개 달성 시 왕실 카드 1장`}
      >
        👑{n}
        {done && "✓"}
      </span>
    );
  };
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        {mark(ROYAL_CROWN_THRESHOLDS[0], 0)}
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-200 transition-all duration-500" style={{ width: `${pct}%` }} />
          <span className="absolute top-0 left-1/2 h-full w-px bg-amber-200/80" />
        </div>
        {mark(ROYAL_CROWN_THRESHOLDS[1], 1)}
      </div>
      <p className="hidden text-center text-[9px] text-amber-100/60 md:block">
        내 왕관 {crowns}개 · 3의 배수(3개·6개)가 될 때마다 1장씩, 최대 2장
      </p>
    </div>
  );
}

/** Level 3 → 1 rows, each with its deck tile, plus the royal cards strip on top. */
export default function CardMarket({
  state,
  compact,
  isAffordable,
  onCardClick,
  onDeckClick,
  viewer,
}: {
  state: SplendorDuelState;
  viewer: PlayerState;
  compact: boolean;
  isAffordable: (card: DuelCard) => boolean;
  onCardClick?: (card: DuelCard, level: Level, index: number) => void;
  onDeckClick?: (level: Level) => void;
}) {
  return (
    <div className="flex flex-col gap-1 md:gap-1.5">
      <div className="flex items-start gap-1.5">
        <span className="w-10 shrink-0 pt-3 text-[9px] font-bold tracking-widest text-amber-300/80">ROYAL</span>
        <div className="grid flex-1 grid-cols-6 gap-1 md:grid-cols-5">
          {state.royals.map((r) => (
            <RoyalCardView key={r.id} royal={r} compact />
          ))}
          {state.royals.length === 0 && <p className="col-span-4 py-2 text-center text-[10px] text-white/40">왕실 카드가 모두 주인을 찾았습니다</p>}
          <div className="col-span-6 md:col-span-4">
            <CrownTrack viewer={viewer} />
          </div>
        </div>
      </div>
      {([3, 2, 1] as Level[]).map((level) => (
        <div key={level} className="flex items-center gap-1.5">
          <div className="w-10 shrink-0">
            <CardBack level={level} count={state.decks[level].length} compact onClick={onDeckClick && state.decks[level].length > 0 ? () => onDeckClick(level) : undefined} />
          </div>
          <div className="grid flex-1 grid-cols-6 gap-1 md:grid-cols-5">
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
