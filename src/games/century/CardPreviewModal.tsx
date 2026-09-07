import { MerchantCardFace } from "./MerchantMarket";
import { ModalShell } from "./CenturyModals";
import { PointCardFace } from "./PointCardsMarket";
import type { MerchantCard, PointCard } from "./cards";

/**
 * Tap-to-preview detail popup for a market card — added per the brief's
 * explicit ask ("카드 탭 시 세부 정보 확대 팝업 제공"). Every point/merchant
 * market card is now clickable regardless of affordability (see
 * PointCardsMarket.tsx/MerchantMarket.tsx — previously an unaffordable
 * card's button was simply `disabled`, a dead end with no way to inspect
 * it); this modal shows it enlarged with a plain-language description and,
 * only when it's actually the viewer's turn and they can afford it, a
 * primary action button. For a point card the primary action dispatches the
 * claim directly (nothing more to choose — this subsumes the old
 * `confirmingClaim` confirm-only modal). For a merchant card at market index
 * 0 it dispatches the free acquire directly; at any other index it hands off
 * to the existing `AcquireModal` payment-staking flow instead, since which
 * resources to stake is a real choice this modal doesn't try to replace.
 */
export type CardPreviewTarget =
  | { kind: "point"; index: number; card: PointCard; affordable: boolean }
  | { kind: "merchant"; index: number; card: MerchantCard; affordable: boolean };

function effectDescription(card: MerchantCard): string {
  if (card.effect.kind === "production") return "이 카드를 사용하면 향신료 보울에서 위 자원을 즉시 수레로 가져옵니다.";
  if (card.effect.kind === "upgrade") return `이 카드를 사용하면 수레의 향신료를 최대 ${card.effect.upgrades}회 상위 등급으로 업그레이드할 수 있습니다.`;
  return "이 카드를 사용하면 왼쪽 자원을 내고 오른쪽 자원을 가져옵니다 — 자원이 충분하면 한 턴에 여러 번 반복할 수 있습니다.";
}

export function CardPreviewModal({
  target,
  isMyTurn,
  onCancel,
  onClaimPoint,
  onAcquireFreeMerchant,
  onStartAcquireMerchant,
}: {
  target: CardPreviewTarget;
  isMyTurn: boolean;
  onCancel: () => void;
  onClaimPoint: (index: number) => void;
  onAcquireFreeMerchant: (index: number) => void;
  onStartAcquireMerchant: (index: number) => void;
}) {
  const canAct = isMyTurn && target.affordable;

  return (
    <ModalShell title={target.kind === "point" ? "점수 카드 미리보기" : "상인 카드 미리보기"}>
      <div className="mx-auto mb-3 w-32 sm:w-36">
        {target.kind === "point" ? (
          <PointCardFace card={target.card} affordable={target.affordable} slotBonus={null} goldSupply={0} silverSupply={0} coinCapacity={1} />
        ) : (
          <MerchantCardFace card={target.card} />
        )}
      </div>

      <p className="mb-3 text-center text-xs text-white/60">
        {target.kind === "point"
          ? `이 카드를 완성하면 +${target.card.points}점을 얻습니다. 위에 표시된 향신료를 지불해야 합니다.`
          : effectDescription(target.card)}
      </p>

      {target.kind === "merchant" && (
        <p className="mb-3 text-center text-[11px] text-white/40">{target.index === 0 ? "가장 왼쪽 카드 — 무료로 가져올 수 있습니다." : `가져오려면 앞의 ${target.index}장 위에 자원을 1개씩 올려야 합니다.`}</p>
      )}

      {!isMyTurn && <p className="mb-3 text-center text-[11px] text-amber-300/80">내 차례가 아니라 지금은 가져올 수 없어요 — 카드만 미리 볼 수 있습니다.</p>}
      {isMyTurn && !target.affordable && <p className="mb-3 text-center text-[11px] text-rose-300/80">지금은 자원이 부족해 가져올 수 없어요.</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          닫기
        </button>
        {target.kind === "point" ? (
          <button
            onClick={() => onClaimPoint(target.index)}
            disabled={!canAct}
            className="flex-1 rounded-xl bg-orange-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            획득하기
          </button>
        ) : (
          <button
            onClick={() => (target.index === 0 ? onAcquireFreeMerchant(target.index) : onStartAcquireMerchant(target.index))}
            disabled={!canAct}
            className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            {target.index === 0 ? "무료로 가져오기" : "가져오기"}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
