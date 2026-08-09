"use client";

import { useMemo, useState } from "react";
import RulebookModal from "./RulebookModal";
import { GemChip, GemCountBadge } from "./GemToken";
import { GEM_ORDER, type DevelopmentCard, type GemColor, type Noble, type TokenColor, type Tier } from "./cards";
import {
  canAffordCard,
  canReserve,
  canTakeTwoSame,
  computeAutoPayment,
  computeBonusCounts,
  computeEffectiveCost,
  computePlayerScore,
  computeQualifyingNobles,
  computeRankings,
  MARKET_SIZE,
  RESERVE_LIMIT,
  TOKEN_COLORS,
  TOKEN_LIMIT,
  WIN_SCORE,
  type EngineAction,
  type PlayerState,
  type SeatIndex,
  type SplendorState,
  type TokenBundle,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's tokens,
 * purchased cards, AND reserved cards) per this project's lockstep trust
 * model — but reserved cards are meant to be secret from opponents by the
 * physical rules, so this component (unlike CenturyBoard, whose "hands" are
 * public market-knowledge) deliberately renders *other* seats' reserved
 * cards as face-down backs, only ever showing the viewer their own full face
 * (see `ReservedCardStack`). See engine.ts's module doc / docs/architecture.md §2.
 */
export interface SplendorBoardProps {
  state: SplendorState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const TIER_STYLE: Record<Tier, { border: string; bg: string; label: string }> = {
  1: { border: "border-emerald-400/50", bg: "linear-gradient(160deg,#0d3324 0%,#0a2018 60%,#061309 100%)", label: "1단계" },
  2: { border: "border-amber-400/50", bg: "linear-gradient(160deg,#3a2c0a 0%,#241b06 60%,#140f03 100%)", label: "2단계" },
  3: { border: "border-sky-400/50", bg: "linear-gradient(160deg,#0d2a3a 0%,#081a24 60%,#050f15 100%)", label: "3단계" },
};

function DevelopmentCardFace({ card, affordable = false }: { card: DevelopmentCard; affordable?: boolean }) {
  const style = TIER_STYLE[card.tier];
  const costEntries = GEM_ORDER.filter((c) => (card.cost[c] ?? 0) > 0);
  return (
    <div
      className={`relative flex w-full flex-col gap-1.5 rounded-lg border p-1.5 transition ${style.border} ${
        affordable ? "shadow-[0_0_14px_-2px_rgba(196,181,253,0.8)]" : ""
      }`}
      style={{ background: style.bg }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm leading-none font-black text-white">{card.points > 0 ? card.points : ""}</span>
        <GemChip color={card.bonus} className="h-5 w-5" />
      </div>
      <div className="flex min-h-[1.25rem] flex-col gap-0.5">
        {costEntries.length === 0 && <span className="text-[10px] text-white/30">무료</span>}
        {costEntries.map((c) => (
          <GemCountBadge key={c} color={c} count={card.cost[c]!} size="h-3.5 w-3.5" />
        ))}
      </div>
    </div>
  );
}

/** Other players' reserved cards render as these opaque backs — never their identity (see module doc). */
function ReservedCardBack({ tier }: { tier: Tier }) {
  const style = TIER_STYLE[tier];
  return (
    <div className={`flex h-[52px] w-9 items-center justify-center rounded-md border text-[9px] text-white/40 ${style.border}`} style={{ background: style.bg }}>
      🂠
    </div>
  );
}

function NobleTile({ noble, qualifies }: { noble: Noble; qualifies: boolean }) {
  const entries = GEM_ORDER.filter((c) => (noble.cost[c] ?? 0) > 0);
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${
        qualifies ? "border-amber-300 shadow-[0_0_16px_-2px_rgba(251,191,36,0.85)]" : "border-white/15"
      }`}
      style={{ background: "linear-gradient(160deg,#3b2d55 0%,#241a38 60%,#160f22 100%)" }}
    >
      <span className="text-lg font-black text-amber-200">{noble.points}</span>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {entries.map((c) => (
          <GemCountBadge key={c} color={c} count={noble.cost[c]!} size="h-3.5 w-3.5" />
        ))}
      </div>
    </div>
  );
}

function DeckBack({ tier, count, disabled, onReserve }: { tier: Tier; count: number; disabled: boolean; onReserve: () => void }) {
  const style = TIER_STYLE[tier];
  const inactive = disabled || count === 0;
  return (
    <button
      disabled={inactive}
      onClick={onReserve}
      title="맨 위 카드를 비공개로 예약"
      className={`flex min-h-[74px] w-12 flex-col items-center justify-center gap-0.5 rounded-lg border text-[9px] transition ${style.border} ${
        inactive ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:scale-105"
      }`}
      style={{ background: style.bg }}
    >
      <span className="font-bold text-white/70">{style.label}</span>
      <span className="text-white/40">{count}장</span>
      <span className="text-violet-300">예약</span>
    </button>
  );
}

function TierMarketRow({
  tier,
  market,
  deckCount,
  isMyTurn,
  canReserveMore,
  affordableIds,
  onCardClick,
  onReserveBlind,
}: {
  tier: Tier;
  market: (DevelopmentCard | null)[];
  deckCount: number;
  isMyTurn: boolean;
  canReserveMore: boolean;
  affordableIds: Set<string>;
  onCardClick: (card: DevelopmentCard) => void;
  onReserveBlind: () => void;
}) {
  return (
    <div className="flex items-stretch gap-1.5">
      <DeckBack tier={tier} count={deckCount} disabled={!isMyTurn || !canReserveMore} onReserve={onReserveBlind} />
      <div className="grid flex-1 grid-cols-4 gap-1.5">
        {Array.from({ length: MARKET_SIZE }, (_, i) => {
          const card = market[i];
          if (!card) return <div key={i} className="rounded-lg border border-dashed border-white/10" />;
          return (
            <button key={card.id} disabled={!isMyTurn} onClick={() => onCardClick(card)} className="text-left transition disabled:cursor-not-allowed disabled:opacity-90">
              <DevelopmentCardFace card={card} affordable={isMyTurn && affordableIds.has(card.id)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TokenBank({
  state,
  isMyTurn,
  pick,
  onClickToken,
  onConfirm,
  onClear,
}: {
  state: SplendorState;
  isMyTurn: boolean;
  pick: GemColor[];
  onClickToken: (c: GemColor) => void;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const canConfirm = (pick.length === 3 && new Set(pick).size === 3) || (pick.length === 2 && pick[0] === pick[1]);
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2.5">
        {GEM_ORDER.map((c) => {
          const doubled = pick.filter((p) => p === c).length === 2;
          return (
            <button
              key={c}
              disabled={!isMyTurn}
              onClick={() => onClickToken(c)}
              className="flex flex-col items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className={`relative inline-flex rounded-full ${pick.includes(c) ? "ring-2 ring-violet-300 ring-offset-2 ring-offset-[#160f22]" : ""}`}>
                <GemChip color={c} className="h-9 w-9" />
                {doubled && (
                  <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[9px] font-bold text-white">
                    2
                  </span>
                )}
              </span>
              <span className="text-[11px] font-semibold text-white/70">{state.tokenSupply[c] ?? 0}</span>
            </button>
          );
        })}
        <div className="mx-1 h-8 w-px bg-white/10" />
        <div className="flex flex-col items-center gap-1">
          <GemChip color="gold" className="h-9 w-9" />
          <span className="text-[11px] font-semibold text-white/70">{state.tokenSupply.gold ?? 0}</span>
        </div>
      </div>
      {isMyTurn && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-[11px] text-white/50">
            {pick.length === 0 ? "다른 보석 3개 또는 같은 보석 2개(4개 이상 남은 경우)를 고르세요" : `${pick.length}개 선택됨`}
          </span>
          {pick.length > 0 && (
            <button onClick={onClear} className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:border-white/30">
              다시 선택
            </button>
          )}
          <button
            disabled={!canConfirm}
            onClick={onConfirm}
            className="rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            토큰 가져오기 확정
          </button>
        </div>
      )}
    </div>
  );
}

function BonusShelf({ purchasedCards, compact = false }: { purchasedCards: DevelopmentCard[]; compact?: boolean }) {
  const bonus = computeBonusCounts(purchasedCards);
  const entries = GEM_ORDER.filter((c) => (bonus[c] ?? 0) > 0);
  if (entries.length === 0) return <span className="text-[11px] text-white/30">보너스 없음</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map((c) => (
        <GemCountBadge key={c} color={c} count={bonus[c]!} size={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      ))}
    </div>
  );
}

function TokenRow({ tokens, compact = false }: { tokens: TokenBundle; compact?: boolean }) {
  const entries = TOKEN_COLORS.filter((c) => (tokens[c] ?? 0) > 0);
  if (entries.length === 0) return <span className="text-[11px] text-white/30">없음</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map((c) => (
        <GemCountBadge key={c} color={c} count={tokens[c]!} size={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      ))}
    </div>
  );
}

export default function SplendorBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: SplendorBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [tokenPick, setTokenPick] = useState<GemColor[]>([]);
  const [selectedCard, setSelectedCard] = useState<{ card: DevelopmentCard; source: "market" | "reserved" } | null>(null);
  const [discardPick, setDiscardPick] = useState<TokenBundle>({});

  // Whenever the state prop changes (my own action resolved, or an
  // opponent's action arrived over the network), any in-progress local
  // selection is now stale — clear it (same pattern as CenturyBoard/NoThanksBoard).
  const [trackedState, setTrackedState] = useState(state);
  if (trackedState !== state) {
    setTrackedState(state);
    setTokenPick([]);
    setSelectedCard(null);
    setDiscardPick({});
  }

  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const mustDiscard = state.phase === "discarding" && state.awaitingDiscardSeat === viewerSeat;
  const mustChooseNoble = state.phase === "choosingNoble" && state.awaitingNobleSeat === viewerSeat;

  const affordableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tier of [1, 2, 3] as Tier[]) {
      for (const card of state.markets[tier]) {
        if (card && canAffordCard(me, card)) ids.add(card.id);
      }
    }
    for (const card of me.reservedCards) {
      if (canAffordCard(me, card)) ids.add(card.id);
    }
    return ids;
  }, [state.markets, me]);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 스플렌더 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winnerSeat = rankings.find((r) => r.rank === 1)!.seat;
    return (
      <div className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8" style={{ background: "linear-gradient(160deg,#241a38 0%,#160f22 55%,#0a0712 100%)" }}>
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold text-violet-100">
          {rankings.filter((r) => r.rank === 1).length > 1 ? "공동 승리!" : `${names[winnerSeat]}님 승리!`}
        </h2>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">구매 카드</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">총점</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, score, cardCount }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "🏆 1" : rank}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{cardCount}장</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-bold text-white">{score}</td>
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
  function clickToken(color: GemColor) {
    if (!isMyTurn) return;
    setTokenPick((prev) => {
      const isDoubled = prev.length === 2 && prev[0] === prev[1];
      if (!isDoubled && prev.includes(color)) return prev.filter((c) => c !== color);
      if (prev.length === 0) return [color];
      if (prev.length === 1) {
        if (prev[0] === color) return canTakeTwoSame(state, color) ? [color, color] : prev;
        return [...prev, color];
      }
      if (prev.length === 2 && !isDoubled && !prev.includes(color)) return [...prev, color];
      return prev;
    });
  }

  function confirmTokenPick() {
    if (tokenPick.length === 3 && new Set(tokenPick).size === 3) {
      onAction({ type: "takeThreeDifferent", seat: viewerSeat, colors: tokenPick });
    } else if (tokenPick.length === 2 && tokenPick[0] === tokenPick[1]) {
      onAction({ type: "takeTwoSame", seat: viewerSeat, color: tokenPick[0] });
    }
    setTokenPick([]);
  }

  function reserveBlind(tier: Tier) {
    if (!isMyTurn || !canReserve(me)) return;
    onAction({ type: "reserveCard", seat: viewerSeat, tier });
  }

  function toggleDiscard(color: TokenColor) {
    setDiscardPick((prev) => {
      const have = me.tokens[color] ?? 0;
      const picked = prev[color] ?? 0;
      if (picked >= have) return prev;
      return { ...prev, [color]: picked + 1 };
    });
  }
  function undoDiscard(color: TokenColor) {
    setDiscardPick((prev) => {
      const picked = prev[color] ?? 0;
      if (picked <= 0) return prev;
      const next = { ...prev, [color]: picked - 1 };
      if (next[color] === 0) delete next[color];
      return next;
    });
  }
  const discardPickTotal = TOKEN_COLORS.reduce((sum, c) => sum + (discardPick[c] ?? 0), 0);
  const heldTotal = TOKEN_COLORS.reduce((sum, c) => sum + (me.tokens[c] ?? 0), 0);
  const discardRemaining = heldTotal - discardPickTotal - TOKEN_LIMIT;

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#1c1230 0%,#120b1c 45%,#08050d 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-violet-100/70">
        <span>
          {state.playerCount}인 · 위신 점수 {WIN_SCORE}점 달성 시 게임 종료
          {state.endTriggered && <span className="ml-1 text-rose-300">· 마지막 라운드 진행 중</span>}
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      <p className={`text-center text-xs font-medium ${isMyTurn ? "text-violet-200" : "text-white/50"}`}>
        {mustDiscard
          ? "⚠️ 토큰이 10개를 초과했습니다 — 반납할 토큰을 선택하세요."
          : mustChooseNoble
            ? "👑 여러 귀족이 동시에 방문 조건을 만족했습니다 — 한 명을 선택하세요."
            : isMyTurn
              ? "🫵 당신 차례입니다! 토큰 가져오기 / 카드 예약 / 카드 구매 중 하나를 고르세요."
              : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      {/* Nobles row */}
      <section className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
        {state.nobles.map((n) => (
          <NobleTile key={n.id} noble={n} qualifies={computeQualifyingNobles(state, viewerSeat).some((q) => q.id === n.id)} />
        ))}
      </section>

      {/* Development card markets — tier III (top) down to tier I (bottom), mirroring the physical board's vertical layout. */}
      <section className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-black/25 p-2 sm:p-2.5">
        {([3, 2, 1] as Tier[]).map((tier) => (
          <TierMarketRow
            key={tier}
            tier={tier}
            market={state.markets[tier]}
            deckCount={state.decks[tier].length}
            isMyTurn={isMyTurn}
            canReserveMore={canReserve(me)}
            affordableIds={affordableIds}
            onCardClick={(card) => setSelectedCard({ card, source: "market" })}
            onReserveBlind={() => reserveBlind(tier)}
          />
        ))}
      </section>

      {/* Token bank + take-tokens picker */}
      <TokenBank state={state} isMyTurn={isMyTurn} pick={tokenPick} onClickToken={clickToken} onConfirm={confirmTokenPick} onClear={() => setTokenPick([])} />

      {/* My panel */}
      <section className="rounded-2xl border border-violet-300/20 p-2.5 sm:p-3" style={{ background: "linear-gradient(160deg,#2a1f42 0%,#1a1329 55%,#0e0a17 100%)" }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
          <h3 className="text-[11px] font-semibold tracking-wide text-violet-200/90 uppercase">💎 내 보석상 (나: {names[viewerSeat]})</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-200/30 px-2 py-0.5 text-[11px] font-bold text-amber-100/80">🏆 {computePlayerScore(me)}점</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${heldTotal > TOKEN_LIMIT ? "border-rose-400/60 text-rose-300" : "border-violet-200/30 text-violet-100/80"}`}>
              {heldTotal} / {TOKEN_LIMIT} 토큰
            </span>
          </div>
        </div>
        <TokenRow tokens={me.tokens} />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-violet-50/80">
          <span>보너스:</span>
          <BonusShelf purchasedCards={me.purchasedCards} />
          <span>👑 귀족 {me.nobles.length}명</span>
        </div>

        {me.reservedCards.length > 0 && (
          <div className="mt-2.5 rounded-xl border border-black/30 bg-black/20 p-2">
            <h4 className="mb-1 text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">예약한 카드 ({me.reservedCards.length}/{RESERVE_LIMIT})</h4>
            <div className="flex flex-wrap gap-1.5">
              {me.reservedCards.map((card) => (
                <button key={card.id} disabled={!isMyTurn} onClick={() => setSelectedCard({ card, source: "reserved" })} className="w-16 text-left transition disabled:cursor-not-allowed">
                  <DevelopmentCardFace card={card} affordable={isMyTurn && affordableIds.has(card.id)} />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Other players */}
      <section className="flex flex-col gap-1.5">
        {state.players
          .filter((p) => p.seat !== viewerSeat)
          .map((p) => (
            <PlayerSummaryRow key={p.seat} player={p} name={names[p.seat]} isActive={state.activeSeat === p.seat} connected={connectedSeats.has(p.seat)} />
          ))}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {selectedCard && (
        <CardActionModal
          me={me}
          card={selectedCard.card}
          source={selectedCard.source}
          onCancel={() => setSelectedCard(null)}
          onBuy={() => {
            onAction({ type: "purchaseCard", seat: viewerSeat, cardId: selectedCard.card.id, source: selectedCard.source });
            setSelectedCard(null);
          }}
          onReserve={
            selectedCard.source === "market" && canReserve(me)
              ? () => {
                  const idx = state.markets[selectedCard.card.tier].findIndex((c) => c?.id === selectedCard.card.id);
                  onAction({ type: "reserveCard", seat: viewerSeat, tier: selectedCard.card.tier, marketIndex: idx });
                  setSelectedCard(null);
                }
              : undefined
          }
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
          onConfirm={() => onAction({ type: "discardTokens", seat: viewerSeat, discard: discardPick })}
        />
      )}

      {mustChooseNoble && (
        <ChooseNobleModal
          nobles={computeQualifyingNobles(state, viewerSeat)}
          onChoose={(nobleId) => onAction({ type: "chooseNoble", seat: viewerSeat, nobleId })}
        />
      )}
    </div>
  );
}

function PlayerSummaryRow({ player, name, isActive, connected }: { player: PlayerState; name: string; isActive: boolean; connected: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs ${isActive ? "border-violet-300/60 bg-violet-400/10" : "border-white/10 bg-black/20"}`}>
      <span className="flex items-center gap-1.5 font-semibold text-white/90">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/20"}`} />
        {isActive && <span title="차례">👉</span>}
        {name}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-white/70">
        <TokenRow tokens={player.tokens} compact />
        <BonusShelf purchasedCards={player.purchasedCards} compact />
        <span title="예약한 카드" className="flex items-center gap-0.5">
          {Array.from({ length: player.reservedCards.length }, (_, i) => (
            <ReservedCardBack key={i} tier={player.reservedCards[i].tier} />
          ))}
          {player.reservedCards.length === 0 && "예약 없음"}
        </span>
        <span>👑{player.nobles.length}</span>
        <span>🏆{computePlayerScore(player)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function ModalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border p-5 shadow-2xl sm:rounded-2xl"
        style={{ background: "linear-gradient(165deg, #241a38 0%, #160f22 55%, #0a0712 100%)", borderColor: "rgba(196,181,253,0.25)" }}
      >
        <h3 className="mb-3 text-sm font-bold text-violet-50">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function CardActionModal({
  me,
  card,
  source,
  onCancel,
  onBuy,
  onReserve,
}: {
  me: PlayerState;
  card: DevelopmentCard;
  source: "market" | "reserved";
  onCancel: () => void;
  onBuy: () => void;
  onReserve?: () => void;
}) {
  const affordable = canAffordCard(me, card);
  const effectiveCost = computeEffectiveCost(card, me.purchasedCards);
  const payment = computeAutoPayment(me, card);
  const costEntries = GEM_ORDER.filter((c) => (card.cost[c] ?? 0) > 0);
  const paymentEntries = TOKEN_COLORS.filter((c) => (payment[c] ?? 0) > 0);
  return (
    <ModalShell title={source === "reserved" ? "예약한 카드" : "카드 구매 / 예약"}>
      <div className="mb-3 flex items-start gap-3">
        <div className="w-24 shrink-0">
          <DevelopmentCardFace card={card} affordable={affordable} />
        </div>
        <div className="flex-1 text-xs text-white/70">
          <p className="mb-1 text-white/50">원래 비용</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {costEntries.map((c) => (
              <GemCountBadge key={c} color={c} count={card.cost[c]!} size="h-4 w-4" />
            ))}
          </div>
          <p className="mb-1 text-white/50">보너스 할인 후 실제 지불 {effectiveCost && Object.keys(effectiveCost).length === 0 ? "(무료)" : ""}</p>
          <div className="flex flex-wrap gap-1">
            {paymentEntries.length === 0 && <span className="text-emerald-300">보유 카드 보너스만으로 충분해요</span>}
            {paymentEntries.map((c) => (
              <GemCountBadge key={c} color={c} count={payment[c]!} size="h-4 w-4" />
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        {onReserve && (
          <button onClick={onReserve} className="flex-1 rounded-xl bg-sky-600 py-2 text-sm font-semibold text-white hover:bg-sky-500">
            🗂️ 예약
          </button>
        )}
        <button
          onClick={onBuy}
          disabled={!affordable}
          className="flex-1 rounded-xl bg-violet-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          🛍️ 구매
        </button>
      </div>
    </ModalShell>
  );
}

function DiscardModal({
  me,
  discardPick,
  remaining,
  onPick,
  onUndo,
  onReset,
  onConfirm,
}: {
  me: PlayerState;
  discardPick: TokenBundle;
  remaining: number;
  onPick: (c: TokenColor) => void;
  onUndo: (c: TokenColor) => void;
  onReset: () => void;
  onConfirm: () => void;
}) {
  const hasPicks = TOKEN_COLORS.some((c) => (discardPick[c] ?? 0) > 0);
  return (
    <ModalShell title="토큰 10개 초과 — 반납할 토큰 선택">
      <p className="mb-2 text-xs text-white/60">{remaining > 0 ? `${remaining}개 더 반납해야 합니다.` : "정확히 10개가 되었습니다."}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TOKEN_COLORS.filter((c) => (me.tokens[c] ?? 0) > 0).map((c) => (
          <div key={c} className="flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-400/10 px-2 py-1">
            <GemChip color={c} className="h-4 w-4" />
            <button onClick={() => onUndo(c)} className="px-1 text-white/70 hover:text-white">
              −
            </button>
            <span className="w-4 text-center text-xs text-white">{discardPick[c] ?? 0}</span>
            <button onClick={() => onPick(c)} disabled={(discardPick[c] ?? 0) >= (me.tokens[c] ?? 0)} className="px-1 text-white/70 hover:text-white disabled:opacity-30">
              +
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {hasPicks && (
          <button onClick={onReset} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
            선택 해제
          </button>
        )}
        <button
          onClick={onConfirm}
          disabled={remaining !== 0}
          className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          반납 확정
        </button>
      </div>
    </ModalShell>
  );
}

function ChooseNobleModal({ nobles, onChoose }: { nobles: Noble[]; onChoose: (nobleId: string) => void }) {
  return (
    <ModalShell title="👑 어느 귀족을 맞이할까요?">
      <p className="mb-2 text-xs text-white/60">동시에 조건을 만족한 귀족이 여럿입니다. 한 분만 선택할 수 있어요 (나머지는 다음 차례 종료 시 다시 확인합니다).</p>
      <div className="flex flex-wrap justify-center gap-2">
        {nobles.map((n) => (
          <button key={n.id} onClick={() => onChoose(n.id)} className="transition hover:scale-105">
            <NobleTile noble={n} qualifies />
          </button>
        ))}
      </div>
    </ModalShell>
  );
}
