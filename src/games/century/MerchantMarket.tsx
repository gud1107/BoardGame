import { ArrowGlyph, CARD_FRAME_STYLE, CubeStack, DeckStack, UpgradeGlyph } from "./boardChrome";
import { CardWatermark, MarketBanner } from "./CardArt";
import { ResourceCube } from "./ResourceIcon";
import { RESOURCE_ORDER, type MerchantCard } from "./cards";
import { canAcquireMerchant, MERCHANT_MARKET_SIZE, type CenturyState, type PlayerState } from "./engine";

export function MerchantCardFace({ card, compact = false }: { card: MerchantCard; compact?: boolean }) {
  const frameClass = `relative flex w-full flex-col items-center overflow-hidden rounded-md border border-[#7a5a2e] ${compact ? "gap-0.5 px-1 py-1" : "gap-1 px-1.5 py-2"}`;
  const labelClass = `relative z-10 font-bold uppercase tracking-widest ${compact ? "text-[6px]" : "text-[8px]"}`;
  const cubeSize = compact ? "h-2.5 w-2.5" : "h-4 w-4";
  const arrowSize = compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  if (card.effect.kind === "production") {
    return (
      <div className={frameClass} style={CARD_FRAME_STYLE}>
        <CardWatermark kind="jug" />
        <span className={`${labelClass} text-emerald-800`}>생산</span>
        <ArrowGlyph className={`relative z-10 ${arrowSize} text-emerald-700`} />
        <span className="relative z-10">
          <CubeStack bundle={card.effect.gain} size={cubeSize} />
        </span>
      </div>
    );
  }
  if (card.effect.kind === "upgrade") {
    return (
      <div className={frameClass} style={CARD_FRAME_STYLE}>
        <CardWatermark kind="jug" />
        <span className={`${labelClass} text-sky-800`}>업그레이드</span>
        <span className="relative z-10">
          <UpgradeGlyph compact={compact} />
        </span>
        <span className={`relative z-10 font-black text-sky-900 ${compact ? "text-[10px]" : "text-sm"}`}>×{card.effect.upgrades}</span>
      </div>
    );
  }
  return (
    <div className={frameClass} style={CARD_FRAME_STYLE}>
      <CardWatermark kind="jug" />
      <span className={`${labelClass} text-amber-900`}>교환</span>
      <span className="relative z-10">
        <CubeStack bundle={card.effect.cost} size={cubeSize} />
      </span>
      {/* Gold/neon exchange arrow — the brief's "교환 화살표(A ➔ B)를 가독성 높은
          네온/골드 프레임으로" ask; every other card glyph stays its existing
          color (emerald production, sky upgrade), this is the one that's
          specifically an A→B conversion glyph. */}
      <ArrowGlyph className={`relative z-10 ${compact ? "h-3 w-3" : "h-4 w-4"} text-amber-500`} style={{ filter: "drop-shadow(0 0 3px rgba(251,191,36,0.85))" }} />
      <span className="relative z-10">
        <CubeStack bundle={card.effect.gain} size={cubeSize} />
      </span>
    </div>
  );
}

/**
 * The merchant-card market panel — 6 face-up cards, each with any resources
 * staked onto it by earlier "가져오기" attempts floating above it, + its draw
 * pile. `merchantSlotRef` is threaded through from CenturyBoard so
 * MerchantEffects.tsx's flying-resource animation can still find each slot's
 * on-screen rect (see useIsMobile.ts's doc comment for why only one of the
 * desktop/mobile layouts is ever mounted at a time — this ref would
 * otherwise collide between them).
 */
export function MerchantMarket({
  state,
  isMyTurn,
  me,
  onSelect,
  merchantSlotRef,
  compact = false,
}: {
  state: CenturyState;
  isMyTurn: boolean;
  me: PlayerState;
  onSelect: (index: number) => void;
  merchantSlotRef: (index: number) => (el: HTMLDivElement | null) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start gap-1.5 sm:gap-2.5">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/25 p-2 sm:p-2.5">
        <MarketBanner variant="caravan" />
        <h3 className={`relative z-10 text-[11px] font-semibold tracking-wide text-emerald-200/70 uppercase ${compact ? "mb-0.5" : "mb-2"}`}>상인 카드</h3>
        <div className={`relative z-10 grid ${compact ? "grid-cols-6 gap-1 pt-1.5" : "grid-cols-3 gap-2 pt-2.5 sm:grid-cols-6"}`}>
          {Array.from({ length: MERCHANT_MARKET_SIZE }, (_, i) => {
            const card = state.merchantMarket[i];
            const staked = state.merchantMarketResources[i] ?? {};
            const stakedEntries = RESOURCE_ORDER.flatMap((r) => Array.from({ length: staked[r] ?? 0 }, () => r));
            if (!card) return <div key={i} ref={merchantSlotRef(i)} className="rounded-xl border border-dashed border-white/10" />;
            const affordable = isMyTurn && canAcquireMerchant(me, i);
            return (
              <div key={card.id} ref={merchantSlotRef(i)} className="relative">
                {stakedEntries.length > 0 && (
                  <div className="pointer-events-none absolute -top-2.5 right-0 left-0 z-10 flex flex-wrap items-end justify-center gap-0.5">
                    {stakedEntries.map((r, idx) => (
                      <span
                        key={idx}
                        className="inline-block drop-shadow-[0_2px_2px_rgba(0,0,0,0.6)]"
                        style={{ transform: `rotate(${(idx % 2 === 0 ? -1 : 1) * (8 + idx * 3)}deg) translateY(${idx % 2}px)` }}
                      >
                        <ResourceCube resource={r} className={compact ? "h-3 w-3" : "h-4 w-4"} />
                      </span>
                    ))}
                  </div>
                )}
                {/* Always clickable, same tap-to-preview reasoning as
                    PointCardsMarket — see its comment. */}
                <button
                  onClick={() => onSelect(i)}
                  className={`flex w-full flex-col items-center rounded-xl border transition ${compact ? "gap-0.5 p-1" : "gap-1 p-1.5"} ${
                    affordable ? "cursor-pointer border-emerald-300/50 bg-emerald-400/10 hover:scale-[1.03]" : "cursor-pointer border-white/10 bg-black/20 opacity-90 hover:opacity-100"
                  }`}
                >
                  {!compact && <span className="text-[9px] text-white/40">{i === 0 ? "무료" : `자원 ${i}개`}</span>}
                  <MerchantCardFace card={card} compact={compact} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {!compact && <DeckStack label="상인 덱" count={state.merchantDeck.length} accent="#065f46" />}
    </div>
  );
}
