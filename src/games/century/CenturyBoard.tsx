"use client";

import { useCallback, useRef, useState } from "react";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import RulebookModal from "./RulebookModal";
import { RESOURCE_ORDER, bundleTotal, type MerchantCard, type Resource, type ResourceBundle } from "./cards";
import { detectAcquireEvent, FlyingResourceBurst, type AcquireAnimEvent } from "./MerchantEffects";
import { BundleRow, FELT, FELT_STYLE, MAT, MAT_STYLE, SpiceBowl } from "./boardChrome";
import { PointCardsMarket } from "./PointCardsMarket";
import { MerchantMarket } from "./MerchantMarket";
import { MyCaravan, MyCaravanCompact } from "./MyCaravan";
import { MyHandCards } from "./MyHandCards";
import { OpponentsSummary, OpponentsSummaryCompact } from "./OpponentsSummary";
import { CardPreviewModal, type CardPreviewTarget } from "./CardPreviewModal";
import { AcquireModal, ConfirmActionModal, DiscardModal, TradeModal, UpgradeModal } from "./CenturyModals";
import { useIsMobile } from "./useIsMobile";
import {
  canAcquireMerchant,
  canClaimPoint,
  computeRankings,
  HAND_LIMIT,
  type CenturyState,
  type EngineAction,
  type SeatIndex,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's hand and
 * resources) in memory per this project's lockstep trust model; hands here
 * are visible market cards rather than secret roles, so this component never
 * hides another seat's hand/resources the way NoThanks hides chips or Bang
 * hides roles — see docs/architecture.md §2.
 *
 * As of the 2026-09 art/mobile-dashboard pass this file is an orchestrator
 * only — all interaction *state* still lives here (staged
 * upgrade/trade/acquire/discard choices, the tap-to-preview target, the
 * acquire-flourish animation refs), but every visual section is a component
 * from a sibling file (boardChrome.tsx, PointCardsMarket.tsx,
 * MerchantMarket.tsx, MyCaravan.tsx, MyHandCards.tsx, OpponentsSummary.tsx,
 * CardPreviewModal.tsx, CenturyModals.tsx) so the desktop mat layout and the
 * mobile compact dashboard below can both assemble the same pieces into two
 * very different arrangements without duplicating card-rendering logic.
 * `useIsMobile` renders ONLY ONE of those two arrangements at a time — see
 * its doc comment for why (a DOM-ref collision in the flying-resource
 * animation if both were mounted with only one CSS-hidden).
 */
export interface CenturyBoardProps {
  state: CenturyState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

export default function CenturyBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: CenturyBoardProps) {
  const isMobile = useIsMobile();
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [acquiring, setAcquiring] = useState<{ index: number; payment: Resource[] } | null>(null);
  const [upgrading, setUpgrading] = useState<{ cardId: string; steps: Resource[] } | null>(null);
  const [trading, setTrading] = useState<{ cardId: string; repeats: number } | null>(null);
  const [discardPick, setDiscardPick] = useState<ResourceBundle>({});
  // Production-card plays used to dispatch straight off a single click with
  // no way to back out of a misclick — unlike upgrade/trade/acquire, which
  // already stage their choice in local state behind a modal's "취소"/"확정"
  // pair. This mirrors that same stage-then-confirm shape (see
  // ConfirmActionModal) purely so a misclick can be cancelled before
  // anything reaches `onAction` — nothing is ever sent to the engine (and
  // thus the network) until "확정".
  const [confirmingProduction, setConfirmingProduction] = useState<MerchantCard | null>(null);
  // Tap-to-preview target for a point/merchant market card — see
  // CardPreviewModal.tsx. Subsumes what used to be a claim-only
  // `confirmingClaim` index, since every market card (affordable or not) is
  // now previewable.
  const [previewing, setPreviewing] = useState<CardPreviewTarget | null>(null);

  // Whenever the state prop changes (my own action resolved, or an
  // opponent's action arrived over the network), any in-progress local
  // selection is now stale — clear it. Adjusting state during render off a
  // prop-identity diff (not inside a useEffect) mirrors the pattern already
  // used by NoThanksBoard/AvalonBoard in this project. This is also where we
  // notice "a merchant card was just acquired" (see MerchantEffects.tsx) —
  // the same diff-two-snapshots technique NoThanksBoard uses for its
  // coin-toss/card-collect flourishes, so every connected client (not just
  // whoever clicked "확정") renders the same collection effect.
  const [trackedState, setTrackedState] = useState(state);
  const [effects, setEffects] = useState<AcquireAnimEvent[]>([]);
  if (trackedState !== state) {
    const detected = detectAcquireEvent(trackedState, state);
    setTrackedState(state);
    setAcquiring(null);
    setUpgrading(null);
    setTrading(null);
    setDiscardPick({});
    setConfirmingProduction(null);
    setPreviewing(null);
    if (detected) {
      setEffects((prev) => [...prev, { ...detected, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    }
  }
  const handleEffectDone = useCallback((id: number) => {
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Slot-index-keyed (not card-id-keyed — see MerchantEffects.tsx's doc
  // comment) refs so a flying-resource animation can read "where the
  // acquired card used to sit" even after the market has already shifted.
  const merchantSlotRefs = useRef(new Map<number, HTMLElement>());
  function setMerchantSlotRef(index: number) {
    return (el: HTMLDivElement | null) => {
      if (el) merchantSlotRefs.current.set(index, el);
      else merchantSlotRefs.current.delete(index);
    };
  }
  const cartRef = useRef<HTMLDivElement | null>(null);
  const playerSummaryRefs = useRef(new Map<SeatIndex, HTMLElement>());
  function setPlayerSummaryRef(seat: SeatIndex) {
    return (el: HTMLDivElement | null) => {
      if (el) playerSummaryRefs.current.set(seat, el);
      else playerSummaryRefs.current.delete(seat);
    };
  }
  // The card that just landed in a hand via an in-flight collection effect —
  // used to give it a brief highlight ring so "the resources you saw fly in
  // became this card" reads clearly.
  const highlightedCardId = effects.find((e) => e.seat === viewerSeat)?.cardId ?? null;

  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const mustDiscard = state.phase === "discarding" && state.awaitingDiscardSeat === viewerSeat;

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 센추리 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div className={`${MAT} flex flex-col items-center gap-5 text-center sm:p-8`} style={MAT_STYLE}>
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[rankings[0].seat]}님 승리!</h2>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">점수 카드</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">금화</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">은화</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">잔여 자원</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">총점</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, score }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "🏆 1" : rank}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.pointCardScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.goldScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.silverScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.resourceScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-bold text-white">{score.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400">
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------
  function playCard(card: MerchantCard) {
    if (!isMyTurn) return;
    if (card.effect.kind === "production") {
      setConfirmingProduction(card);
    } else if (card.effect.kind === "upgrade") {
      setUpgrading({ cardId: card.id, steps: [] });
    } else {
      setTrading({ cardId: card.id, repeats: 1 });
    }
  }

  function startAcquire(index: number) {
    if (!isMyTurn || !state.merchantMarket[index]) return;
    if (index > 0 && !canAcquireMerchant(me, index)) return;
    setAcquiring({ index, payment: [] });
  }

  function dispatchClaimPoint(index: number) {
    const card = state.pointMarket[index];
    if (!isMyTurn || !card || !canClaimPoint(me, card)) return;
    onAction({ type: "claimPoint", seat: viewerSeat, index });
  }

  function dispatchAcquireFree(index: number) {
    if (!isMyTurn || index !== 0 || !state.merchantMarket[0]) return;
    onAction({ type: "acquireMerchant", seat: viewerSeat, index: 0, payment: [] });
  }

  function previewPoint(index: number) {
    const card = state.pointMarket[index];
    if (!card) return;
    setPreviewing({ kind: "point", index, card, affordable: isMyTurn && canClaimPoint(me, card) });
  }

  function previewMerchant(index: number) {
    const card = state.merchantMarket[index];
    if (!card) return;
    setPreviewing({ kind: "merchant", index, card, affordable: isMyTurn && (index === 0 || canAcquireMerchant(me, index)) });
  }

  function toggleDiscard(resource: Resource) {
    setDiscardPick((prev) => {
      const have = me.resources[resource] ?? 0;
      const picked = prev[resource] ?? 0;
      if (picked >= have) return prev;
      return { ...prev, [resource]: picked + 1 };
    });
  }
  function undoDiscard(resource: Resource) {
    setDiscardPick((prev) => {
      const picked = prev[resource] ?? 0;
      if (picked <= 0) return prev;
      const next = { ...prev, [resource]: picked - 1 };
      if (next[resource] === 0) delete next[resource];
      return next;
    });
  }
  const discardRemaining = bundleTotal(me.resources) - bundleTotal(discardPick) - HAND_LIMIT;

  function statusBar(compact: boolean) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-amber-100/70">
          <span>
            {state.playerCount}인 · {state.pointCardGoal}장 달성 시 게임 종료
            {state.endTriggered && <span className="ml-1 text-rose-300">· 마지막 라운드</span>}
          </span>
          <div className="flex gap-1.5">{rulebookButton}</div>
        </div>
        {/* Compact (mobile) phrasing stays on one line — the desktop
            sentence wraps to two on a narrow viewport, which is exactly the
            vertical space the no-scroll dashboard can't spare. */}
        <p className={`text-center text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
          {mustDiscard
            ? "⚠️ 자원 10개 초과 — 버릴 자원을 선택하세요."
            : isMyTurn
              ? compact
                ? "🫵 당신 차례! 카드사용 · 획득 · 휴식 · 완성 중 선택"
                : "🫵 당신 차례입니다! 카드 사용 / 카드 획득 / 휴식 / 점수 카드 완성 중 하나를 고르세요."
              : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
        </p>
      </>
    );
  }

  const flyingEffects = effects.map((e) => (
    <FlyingResourceBurst
      key={e.id}
      event={e}
      getSourceEl={() => merchantSlotRefs.current.get(e.fromIndex) ?? null}
      getTargetEl={() => (e.seat === viewerSeat ? cartRef.current : (playerSummaryRefs.current.get(e.seat) ?? null))}
      onDone={handleEffectDone}
    />
  ));

  const otherPlayers = state.players.filter((p) => p.seat !== viewerSeat);

  // ---------------------------------------------------------------------
  // Render — mobile compact single-screen dashboard vs. desktop mat layout.
  // See useIsMobile.ts's doc comment for why only one of these two trees is
  // ever mounted.
  // ---------------------------------------------------------------------
  const body = isMobile ? (
    // Mobile compact dashboard, per the brief's ②: point-card strip /
    // merchant market + spice bowls / my caravan / my hand + opponents,
    // stacked so all four are visible without scrolling. Deliberately
    // content-sized rather than pinned to `100dvh` — this component renders
    // *inside* the shared `/games/[gameId]` page template (site header +
    // game-title block + page padding all sit above it, see that route's
    // `pageMaxWidth`/`py-8` wrapper), so a hard 100dvh here would overflow
    // past the actual viewport by however tall that surrounding chrome is,
    // clipping the bottom sections right out of view instead of fitting the
    // screen. Every section below is tuned to a small fixed/compact size so
    // the whole stack comfortably fits the space left under that chrome on
    // a typical phone viewport.
    <div className="flex w-full flex-col gap-1.5 rounded-2xl border border-amber-900/30 bg-slate-950 p-2 select-none">
      <div className="space-y-1">{statusBar(true)}</div>

      <section className="overflow-hidden">
        <PointCardsMarket state={state} isMyTurn={isMyTurn} me={me} onSelect={previewPoint} compact />
      </section>

      <section className="overflow-hidden">
        <div className="mb-1 flex items-center justify-center gap-1.5">
          {RESOURCE_ORDER.map((r) => (
            <SpiceBowl key={r} resource={r} compact />
          ))}
        </div>
        <MerchantMarket state={state} isMyTurn={isMyTurn} me={me} onSelect={previewMerchant} merchantSlotRef={setMerchantSlotRef} compact />
      </section>

      <MyCaravanCompact me={me} forwardedRef={cartRef} />

      <div className="space-y-1">
        <OpponentsSummaryCompact players={otherPlayers} names={names} activeSeat={state.activeSeat} connectedSeats={connectedSeats} setRef={setPlayerSummaryRef} />
        <MyHandCards hand={me.hand} playedCards={me.playedCards} isMyTurn={isMyTurn} highlightedCardId={highlightedCardId} onPlayCard={playCard} onRest={() => onAction({ type: "rest", seat: viewerSeat })} compact />
      </div>

      {flyingEffects}
    </div>
  ) : (
    <div className={`${MAT} flex flex-col gap-3`} style={MAT_STYLE}>
      {statusBar(false)}

      {/* Central market board — a felt/carpet surface holding the spice
          bowls, the point-card market, and the merchant-card market. */}
      <section className={FELT} style={FELT_STYLE}>
        <div className="mb-2.5 flex items-center justify-center gap-2.5 sm:gap-5">
          {RESOURCE_ORDER.map((r) => (
            <SpiceBowl key={r} resource={r} />
          ))}
        </div>
        <div className="mb-3">
          <PointCardsMarket state={state} isMyTurn={isMyTurn} me={me} onSelect={previewPoint} />
        </div>
        <MerchantMarket state={state} isMyTurn={isMyTurn} me={me} onSelect={previewMerchant} merchantSlotRef={setMerchantSlotRef} />
      </section>

      {/* My caravan board — a carved wooden cart holding my 10 resource
          wells, gold/silver/point totals, my fanned-out hand, and my
          discard pile (recovered by "휴식"). */}
      <MyCaravan me={me} forwardedRef={cartRef} />
      <MyHandCards hand={me.hand} playedCards={me.playedCards} isMyTurn={isMyTurn} highlightedCardId={highlightedCardId} onPlayCard={playCard} onRest={() => onAction({ type: "rest", seat: viewerSeat })} />

      <OpponentsSummary players={otherPlayers} names={names} activeSeat={state.activeSeat} connectedSeats={connectedSeats} setRef={setPlayerSummaryRef} />

      {flyingEffects}
    </div>
  );

  return (
    <>
      {body}
      <MyTurnOverlay isMyTurn={isMyTurn} />

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {upgrading && (
        <UpgradeModal
          me={me}
          cardId={upgrading.cardId}
          steps={upgrading.steps}
          onChangeSteps={(steps) => setUpgrading({ cardId: upgrading.cardId, steps })}
          onCancel={() => setUpgrading(null)}
          onConfirm={() => {
            onAction({ type: "playUpgrade", seat: viewerSeat, cardId: upgrading.cardId, upgrades: upgrading.steps });
            setUpgrading(null);
          }}
        />
      )}

      {trading && (
        <TradeModal
          me={me}
          cardId={trading.cardId}
          repeats={trading.repeats}
          onChangeRepeats={(repeats) => setTrading({ cardId: trading.cardId, repeats })}
          onCancel={() => setTrading(null)}
          onConfirm={() => {
            onAction({ type: "playTrade", seat: viewerSeat, cardId: trading.cardId, repeats: trading.repeats });
            setTrading(null);
          }}
        />
      )}

      {acquiring && (
        <AcquireModal
          me={me}
          index={acquiring.index}
          payment={acquiring.payment}
          onChangePayment={(payment) => setAcquiring({ index: acquiring.index, payment })}
          onCancel={() => setAcquiring(null)}
          onConfirm={() => {
            onAction({ type: "acquireMerchant", seat: viewerSeat, index: acquiring.index, payment: acquiring.payment });
            setAcquiring(null);
          }}
        />
      )}

      {mustDiscard && (
        <DiscardModal
          me={me}
          discardPick={discardPick}
          remaining={discardRemaining}
          onPick={toggleDiscard}
          onUndo={undoDiscard}
          onReset={() => setDiscardPick({})}
          onConfirm={() => onAction({ type: "discardToLimit", seat: viewerSeat, discard: discardPick })}
        />
      )}

      {confirmingProduction && (
        <ConfirmActionModal
          title="생산 카드 사용"
          description="이 카드를 사용해 아래 자원을 수레에 획득합니다. 잘못 눌렀다면 취소할 수 있습니다."
          preview={<BundleRow bundle={confirmingProduction.effect.kind === "production" ? confirmingProduction.effect.gain : {}} size="h-5 w-5" />}
          confirmColorClass="bg-sky-600"
          onCancel={() => setConfirmingProduction(null)}
          onConfirm={() => {
            onAction({ type: "playProduction", seat: viewerSeat, cardId: confirmingProduction.id });
            setConfirmingProduction(null);
          }}
        />
      )}

      {previewing && (
        <CardPreviewModal
          target={previewing}
          isMyTurn={isMyTurn}
          onCancel={() => setPreviewing(null)}
          onClaimPoint={(index) => {
            dispatchClaimPoint(index);
            setPreviewing(null);
          }}
          onAcquireFreeMerchant={(index) => {
            dispatchAcquireFree(index);
            setPreviewing(null);
          }}
          onStartAcquireMerchant={(index) => {
            setPreviewing(null);
            startAcquire(index);
          }}
        />
      )}
    </>
  );
}
