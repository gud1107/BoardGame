import { CARD_FRAME_STYLE, CoinStack, DeckStack } from "./boardChrome";
import { CardWatermark, MarketBanner } from "./CardArt";
import ResourceIcon from "./ResourceIcon";
import { RESOURCE_ORDER, type PointCard } from "./cards";
import { canClaimPoint, POINT_MARKET_SIZE, type CenturyState, type PlayerState } from "./engine";

export function PointCardFace({
  card,
  affordable,
  slotBonus,
  goldSupply,
  silverSupply,
  coinCapacity,
  compact = false,
}: {
  card: PointCard;
  affordable: boolean;
  slotBonus: "gold" | "silver" | null;
  goldSupply: number;
  silverSupply: number;
  coinCapacity: number;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center overflow-hidden rounded-lg border transition ${
        compact ? "gap-0.5 px-1 pt-1 pb-1" : "gap-1 px-1.5 pt-2 pb-1.5"
      } ${affordable ? "border-amber-300 shadow-[0_0_16px_-2px_rgba(251,191,36,0.75)]" : "border-[#8a6d3b]"}`}
      style={CARD_FRAME_STYLE}
    >
      <CardWatermark kind="ship" />
      {slotBonus &&
        (compact ? (
          // A full floating coin stack (see the non-compact branch) needs
          // top clearance reserved on the whole market row above every
          // card, not just this one — a real cost on the mobile compact
          // dashboard's tight vertical budget. A small in-card corner badge
          // instead needs none.
          <span
            className={`absolute top-0.5 right-0.5 z-20 rounded-full border px-1 text-[8px] font-black ${
              slotBonus === "gold" ? "border-amber-700 bg-amber-300 text-amber-900" : "border-slate-500 bg-slate-200 text-slate-700"
            }`}
          >
            {slotBonus === "gold" ? goldSupply : silverSupply}
          </span>
        ) : (
          // z-20 (plus pointer-events-none, since this is decorative) forces
          // this coin stack to always paint above the card's own content —
          // without it, whether this ends up above or partly clipped behind
          // the card depended on the card's own conditional classes (its
          // `affordable` glow/opacity), which was never a property this stack
          // should have had to care about.
          <div className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2">
            <CoinStack kind={slotBonus} count={slotBonus === "gold" ? goldSupply : silverSupply} capacity={coinCapacity} />
          </div>
        ))}
      <span
        className={`relative z-10 leading-none font-black ${compact ? "text-base" : "text-2xl"}`}
        style={{ color: "#5c3a12", fontFamily: "Georgia, 'Times New Roman', serif", textShadow: "0 1px 0 rgba(255,255,255,0.5)" }}
      >
        {card.points}
      </span>
      <div className={`relative z-10 flex flex-wrap items-center justify-center rounded-md border border-black/10 bg-black/5 ${compact ? "gap-0.5 px-0.5 py-0.5" : "mt-1 gap-1 px-1.5 py-1"}`}>
        {RESOURCE_ORDER.filter((r) => (card.cost[r] ?? 0) > 0).map((r) => (
          <span key={r} className="flex items-center gap-0.5">
            <ResourceIcon resource={r} className={compact ? "h-2.5 w-2.5" : "h-4 w-4"} />
            <span className={compact ? "text-[8px] font-bold" : "text-[10px] font-bold"} style={{ color: "#3f2408" }}>
              ×{card.cost[r]}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The point-card market panel — 5 face-up score cards (gold/silver bonus
 * coins riding the first two slots) + its draw pile. `onSelect` both claims
 * a card (desktop) and opens the tap-to-preview modal (mobile compact
 * dashboard passes a preview opener instead — see CardPreviewModal.tsx).
 */
export function PointCardsMarket({
  state,
  isMyTurn,
  me,
  onSelect,
  compact = false,
}: {
  state: CenturyState;
  isMyTurn: boolean;
  me: PlayerState;
  onSelect: (index: number) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start gap-1.5 sm:gap-2.5">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/25 p-2 sm:p-2.5">
        <MarketBanner variant="bazaar" />
        <h3 className={`relative z-10 text-[11px] font-semibold tracking-wide text-orange-200/70 uppercase ${compact ? "mb-0.5" : "mb-2"}`}>점수 카드</h3>
        <div className={`relative z-10 grid grid-cols-5 gap-1 ${compact ? "pt-0.5" : "gap-1.5 pt-9"}`}>
          {Array.from({ length: POINT_MARKET_SIZE }, (_, i) => {
            const card = state.pointMarket[i];
            const bonus: "gold" | "silver" | null = i === 0 ? "gold" : i === 1 ? "silver" : null;
            if (!card) return <div key={i} className="rounded-xl border border-dashed border-white/10" />;
            const affordable = isMyTurn && canClaimPoint(me, card);
            return (
              // Always clickable — even a card the viewer can't currently
              // afford opens the tap-to-preview detail modal (see
              // CardPreviewModal.tsx); only the modal's own claim button is
              // gated on `affordable`. Previously an unaffordable card's
              // `disabled` button was a dead end with no way to inspect it.
              <button
                key={card.id}
                onClick={() => onSelect(i)}
                className={`text-left transition ${affordable ? "cursor-pointer hover:scale-[1.03]" : "cursor-pointer opacity-90 hover:opacity-100"}`}
              >
                <PointCardFace
                  card={card}
                  affordable={affordable}
                  slotBonus={bonus}
                  goldSupply={state.goldSupply}
                  silverSupply={state.silverSupply}
                  coinCapacity={state.playerCount * 2}
                  compact={compact}
                />
              </button>
            );
          })}
        </div>
      </div>
      {!compact && <DeckStack label="점수 덱" count={state.pointDeck.length} accent="#92400e" />}
    </div>
  );
}
