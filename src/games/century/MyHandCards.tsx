import { MerchantCardFace } from "./MerchantMarket";
import type { MerchantCard } from "./cards";

/**
 * My hand + discard pile + the "휴식" button that recovers it. Desktop keeps
 * the original fanned, overlapping-card hand; the mobile compact dashboard
 * (`compact`) instead lays hand cards out as a horizontal swipe strip
 * (`overflow-x-auto`) — a fan needs room to spread that the mobile
 * dashboard's bottom 25% cell doesn't have, per the brief's "가로 아코디언형
 * 스와이프 뷰" ask.
 */
export function MyHandCards({
  hand,
  playedCards,
  isMyTurn,
  highlightedCardId,
  onPlayCard,
  onRest,
  compact = false,
}: {
  hand: MerchantCard[];
  playedCards: MerchantCard[];
  isMyTurn: boolean;
  highlightedCardId: string | null;
  onPlayCard: (card: MerchantCard) => void;
  onRest: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "rounded-xl border border-black/30 bg-black/20 p-1.5" : "mt-3 rounded-xl border border-black/30 bg-black/20 p-2 sm:p-2.5"}>
      {!compact && <h4 className="mb-1 text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">내 손패 (Hand)</h4>}

      {compact ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {hand.length === 0 && <span className="px-1 py-2 text-[11px] whitespace-nowrap text-white/30">손패 없음</span>}
          {hand.map((card) => (
            <button
              key={card.id}
              disabled={!isMyTurn}
              onClick={() => onPlayCard(card)}
              className={`shrink-0 rounded-lg border p-1 transition ${
                isMyTurn ? "cursor-pointer border-sky-300/40 bg-sky-400/10 active:brightness-110" : "cursor-not-allowed border-white/10 bg-black/20 opacity-70"
              } ${card.id === highlightedCardId ? "ring-2 ring-amber-300" : ""}`}
              style={{ width: 56 }}
            >
              <MerchantCardFace card={card} />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-center gap-y-2 py-1.5">
          {hand.length === 0 && <span className="text-[11px] text-white/30">손패 없음</span>}
          {hand.map((card, i) => {
            const mid = (hand.length - 1) / 2;
            const offset = i - mid;
            return (
              <button
                key={card.id}
                disabled={!isMyTurn}
                onClick={() => onPlayCard(card)}
                style={{
                  transform: `rotate(${offset * 4}deg) translateY(${Math.abs(offset) * 5}px)`,
                  marginLeft: i === 0 ? 0 : -14,
                  zIndex: i,
                }}
                className={`relative rounded-xl border p-2 transition ${
                  isMyTurn
                    ? "cursor-pointer border-sky-300/40 bg-sky-400/10 hover:z-20 hover:brightness-110"
                    : "cursor-not-allowed border-white/10 bg-black/20 opacity-70"
                } ${card.id === highlightedCardId ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#1c1208]" : ""}`}
              >
                <MerchantCardFace card={card} />
              </button>
            );
          })}
        </div>
      )}

      {!compact && playedCards.length > 0 && (
        <>
          <h4 className="mt-2 mb-1 text-[10px] font-semibold tracking-wide text-white/40 uppercase">버린 카드 더미 (Discarded — 휴식 시 회수)</h4>
          <div className="flex flex-wrap items-center py-1 pl-3">
            {playedCards.map((card, i) => (
              <div
                key={card.id}
                style={{ marginLeft: i === 0 ? 0 : -26, transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (3 + (i % 4))}deg)`, zIndex: i }}
                className="rounded-xl border border-white/10 bg-black/30 p-2 opacity-60 grayscale"
              >
                <MerchantCardFace card={card} />
              </div>
            ))}
          </div>
        </>
      )}

      <button
        disabled={!isMyTurn || playedCards.length === 0}
        onClick={onRest}
        className={`w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 ${compact ? "mt-1.5 py-1.5 text-xs" : "mt-2.5 py-2"}`}
      >
        😴 휴식 (사용한 카드 전부 회수{compact ? ` · ${playedCards.length}` : ""})
      </button>
    </div>
  );
}
