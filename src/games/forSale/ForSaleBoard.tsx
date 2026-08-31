"use client";

import { useCallback, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import { CheckCard, CoinChip, coinBreakdown, formatDollars, PropertyCard } from "./CardArt";
import {
  AuctionWinToast,
  CardFlipWrapper,
  detectAuctionWinEvent,
  detectBidEvent,
  detectPassEvent,
  detectSaleRevealEvent,
  FlyingBidCoin,
  FlyingPassCard,
  type BidFlyEvent,
  type PassFlyEvent,
} from "./ForSaleEffects";
import { BID_INCREMENT, computeRankings, getPlayerView, type EngineAction, type ForSaleState, type SeatIndex } from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state per this project's
 * lockstep trust model, but two things are meant to stay secret from
 * *opponents* by the physical rules and are enforced only here (UI layer):
 * (1) cash on hand (rulebook §3 "자신의 동전은... 비공개") — only the
 * viewer's own cash total is ever rendered; every other seat shows a locked
 * badge. (2) unplayed property cards (rulebook §4-1 "뒷면(비공개)") — only
 * the viewer's own hand is shown face-up; other seats show a card-back stack
 * with just a count. Phase-2's blind submissions have their own dedicated
 * `getPlayerView` helper in engine.ts (mirrors Coyote's forehead-card
 * redaction) since that secrecy resolves automatically once everyone submits.
 */
export interface ForSaleBoardProps {
  state: ForSaleState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

export default function ForSaleBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: ForSaleBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  // Same "diff consecutive lockstep snapshots on render" pattern every other
  // Board in this project uses to drive purely cosmetic flourishes — see
  // ForSaleEffects.tsx's module doc.
  const [trackedState, setTrackedState] = useState(state);
  const [passEvents, setPassEvents] = useState<PassFlyEvent[]>([]);
  const [bidEvents, setBidEvents] = useState<BidFlyEvent[]>([]);
  const [winToast, setWinToast] = useState<{ winnerName: string; card: number; paid: number } | null>(null);
  const [flipRound, setFlipRound] = useState(0);
  if (trackedState !== state) {
    const newPass = detectPassEvent(trackedState, state);
    const newBid = detectBidEvent(trackedState, state);
    const newWin = detectAuctionWinEvent(trackedState, state);
    const newReveal = detectSaleRevealEvent(trackedState, state);
    setTrackedState(state);
    if (newPass) {
      setPassEvents((prev) => [...prev, { ...newPass, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    }
    if (newBid) {
      setBidEvents((prev) => [...prev, { ...newBid, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    }
    if (newWin && state.lastAuctionResult) {
      setWinToast({ winnerName: names[state.lastAuctionResult.winnerSeat], card: state.lastAuctionResult.winnerCard, paid: state.lastAuctionResult.winnerPaid });
    }
    if (newReveal) setFlipRound((n) => n + 1);
  }
  const handlePassDone = useCallback((id: number) => {
    setPassEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const handleBidDone = useCallback((id: number) => {
    setBidEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // The bid stepper resets to "one increment above the current bid" every
  // time it becomes a fresh decision point — adjusted directly during
  // render (React's recommended "state adjustment" pattern), same as
  // coyote/dalmuti's selection-reset.
  const bidKey = `${state.auction?.activeSeat ?? "-"}-${state.auction?.currentBid ?? 0}`;
  const [trackedBidKey, setTrackedBidKey] = useState(bidKey);
  const [bidAmount, setBidAmount] = useState((state.auction?.currentBid ?? 0) + BID_INCREMENT);
  if (trackedBidKey !== bidKey) {
    setTrackedBidKey(bidKey);
    setBidAmount((state.auction?.currentBid ?? 0) + BID_INCREMENT);
  }

  const seatRowRefs = useRef(new Map<SeatIndex, HTMLElement>());
  function setSeatRowRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) seatRowRefs.current.set(seat, el);
      else seatRowRefs.current.delete(seat);
    };
  }
  const auctionRowRef = useRef<HTMLElement | null>(null);
  const potRef = useRef<HTMLDivElement | null>(null);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 포세일 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.filter((r) => r.rank === 1);
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#0c2b3a 0%,#081c26 55%,#040d12 100%)" }}
      >
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold text-sky-100">
          {winner.map((w) => names[w.seat]).join(", ")}
          {winner.length > 1 ? "님이 공동 승리했습니다!" : "님이 최고 부동산 중개인이 되었습니다!"}
        </h2>
        <p className="text-xs text-white/50">수표 총액 + 남은 동전 합산이 가장 높은 사람이 승리합니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">수표 합계</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">남은 동전</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">총점</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, total }) => {
                const p = state.players.find((pl) => pl.seat === seat)!;
                const checksSum = p.checks.reduce((s, c) => s + c, 0);
                return (
                  <tr key={seat} className={rank === 1 ? "bg-sky-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-sky-200">{rank === 1 ? "🏆 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      {names[seat]}
                      {seat === viewerSeat && <span className="ml-1 text-sky-200">(나)</span>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-right text-emerald-300">{formatDollars(checksSum)}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-right text-amber-300">{formatDollars(p.cash)}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-right font-bold text-white">{formatDollars(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-sky-500 px-8 py-3 font-medium text-black transition hover:bg-sky-400">
          결과 확정하고 계속하기
        </button>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Buying / selling
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyBidTurn = state.phase === "buying" && state.auction?.activeSeat === viewerSeat;
  const maxBid = me.cash;
  const minBid = (state.auction?.currentBid ?? 0) + BID_INCREMENT;
  const canBid = isMyBidTurn && bidAmount >= minBid && bidAmount <= maxBid && bidAmount % BID_INCREMENT === 0;
  const canPass = isMyBidTurn;

  const saleView = state.phase === "selling" ? getPlayerView(state, viewerSeat) : [];
  const mySubmission = state.sale?.submissions[viewerSeat];
  const canSubmit = state.phase === "selling" && !state.sale?.revealed && mySubmission === undefined;

  return (
    <div
      className="relative flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#0f2532 0%,#0a1922 45%,#050d12 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-sky-100/70">
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="whitespace-nowrap">
            {state.playerCount}인 · {state.phase === "buying" ? "1단계: 부동산 경매" : "2단계: 수표 판매"} · 남은 현금
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-semibold whitespace-nowrap text-amber-200">
            {coinBreakdown(me.cash).map(({ value, count }) => (
              <span key={value} className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap">
                <CoinChip value={value} size="sm" />×{count}
              </span>
            ))}
            {formatDollars(me.cash)}
          </span>
          <span className="whitespace-nowrap">· 수표 누적</span>
          <span className="shrink-0 font-semibold whitespace-nowrap text-emerald-300">{formatDollars(me.checks.reduce((s, c) => s + c, 0))}</span>
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      {/* Phase 1 — auction */}
      {state.phase === "buying" && state.auction && (
        <>
          <section ref={auctionRowRef} className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-3">
            <h3 className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">🏘️ 이번 라운드 매물</h3>
            <div className="flex flex-wrap justify-center gap-2">
              {state.auction.openCards.map((c) => (
                <PropertyCard key={c} value={c} size="lg" />
              ))}
            </div>
            <div ref={potRef} className="flex flex-col items-center gap-1 rounded-xl border border-amber-300/25 bg-amber-400/5 px-4 py-2">
              <span className="text-[10px] tracking-wide text-amber-200/70 uppercase">💰 입찰 팟</span>
              <div className="flex min-h-[2.25rem] flex-wrap items-center justify-center gap-1">
                {state.auction.currentBid > 0 ? (
                  coinBreakdown(state.auction.currentBid).flatMap(({ value, count }) =>
                    Array.from({ length: Math.min(count, 8) }, (_, i) => <CoinChip key={`${value}-${i}`} value={value} size="md" />),
                  )
                ) : (
                  <span className="text-[10px] text-white/30">아직 입찰 없음</span>
                )}
              </div>
              <p className="text-xs text-white/70">
                현재 입찰가:{" "}
                <span className="font-bold text-sky-300">{formatDollars(state.auction.currentBid)}</span>
                {state.auction.highBidderSeat !== null && <> ({names[state.auction.highBidderSeat]}님)</>}
              </p>
            </div>
            <p className="text-xs text-white/50">
              {isMyBidTurn ? "🫵 당신 차례입니다!" : `${names[state.auction.activeSeat]}님의 차례를 기다리는 중...`}
            </p>
            {isMyBidTurn && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBidAmount((n) => Math.max(minBid, n - BID_INCREMENT))}
                    className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
                  >
                    −
                  </button>
                  <span className="w-24 shrink-0 text-center text-lg font-bold whitespace-nowrap text-white">{formatDollars(bidAmount)}</span>
                  <button
                    onClick={() => setBidAmount((n) => Math.min(maxBid, n + BID_INCREMENT))}
                    className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
                  >
                    +
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={!canBid}
                    onClick={() => onAction({ type: "bid", seat: viewerSeat, amount: bidAmount })}
                    className="rounded-full bg-sky-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    💰 입찰하기
                  </button>
                  <button
                    disabled={!canPass}
                    onClick={() => onAction({ type: "pass", seat: viewerSeat })}
                    className="rounded-full bg-rose-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    🙅 포기 (환불 {formatDollars(Math.floor((state.auction.bidsBySeat[viewerSeat] ?? 0) / 2000) * 1000)})
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-1.5">
            {Array.from({ length: state.playerCount }, (_, s) => s).map((seat) => {
              const p = state.players.find((pl) => pl.seat === seat)!;
              const isActive = state.auction!.activeSeats.includes(seat) && state.auction!.activeSeat === seat;
              const isOut = !state.auction!.activeSeats.includes(seat);
              const isSelf = seat === viewerSeat;
              const seatBid = state.auction!.bidsBySeat[seat] ?? 0;
              const isHighBidder = state.auction!.highBidderSeat === seat;
              return (
                <div
                  key={seat}
                  ref={setSeatRowRef(seat)}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                    isActive ? "border-sky-300/60 bg-sky-400/10" : isOut ? "border-white/5 bg-black/10 opacity-60" : "border-white/10 bg-black/20"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-semibold text-white/90">
                    <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                    {isActive && <span title="차례">👉</span>}
                    {names[seat]}
                    {isSelf && <span className="text-sky-200">(나)</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-white/70">
                    {seatBid > 0 && (
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                          isHighBidder ? "border-amber-300/70 bg-amber-400/20 text-amber-200" : "border-white/15 bg-white/5 text-white/50"
                        }`}
                      >
                        {isHighBidder ? "👑" : "🎫"} {formatDollars(seatBid)}
                      </span>
                    )}
                    <span title="현금" className="shrink-0 whitespace-nowrap">
                      {isSelf ? formatDollars(p.cash) : "🔒 비공개"}
                    </span>
                    <span title="보유 부동산 카드" className="shrink-0 whitespace-nowrap">
                      🏠 {p.properties.length}장
                    </span>
                  </span>
                </div>
              );
            })}
          </section>

          <section className="rounded-2xl border border-sky-300/20 p-2.5 sm:p-3" style={{ background: "linear-gradient(160deg,#0c2b3a 0%,#081c26 55%,#040d12 100%)" }}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-sky-200/90 uppercase">🏠 내 부동산 ({me.properties.length}장)</h3>
            {me.properties.length === 0 ? (
              <p className="text-xs text-white/30">아직 낙찰받은 부동산이 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...me.properties]
                  .sort((a, b) => a - b)
                  .map((c) => (
                    <PropertyCard key={c} value={c} />
                  ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Phase 2 — selling */}
      {state.phase === "selling" && state.sale && (
        <>
          <section className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-3">
            <h3 className="text-[11px] font-semibold tracking-wide text-emerald-200/80 uppercase">🧾 이번 라운드 수표</h3>
            <div className="flex flex-wrap justify-center gap-2">
              {state.sale.openChecks.map((c, i) => (
                <CheckCard key={i} value={c} size="lg" />
              ))}
            </div>

            <div className="mt-2 flex flex-wrap justify-center gap-3">
              {saleView.map(({ seat, property }) => {
                const submitted = state.sale!.submissions[seat] !== undefined;
                return (
                  <div key={seat} className="flex flex-col items-center gap-1">
                    <CardFlipWrapper flipKey={`${seat}-${flipRound}`} revealed={state.sale!.revealed}>
                      <PropertyCard value={property} highlight={seat === viewerSeat} />
                    </CardFlipWrapper>
                    <span className="text-[10px] text-white/60">
                      {names[seat]}
                      {seat === viewerSeat && " (나)"} {submitted ? (state.sale!.revealed ? "" : "✅") : "⏳"}
                    </span>
                  </div>
                );
              })}
            </div>

            {state.sale.revealed && state.lastSaleResult && (
              <div className="mt-1 flex flex-col items-center gap-1.5 text-xs text-white/70">
                <p className="font-semibold text-emerald-200">정산 결과</p>
                {[...state.lastSaleResult.assignments]
                  .sort((a, b) => b.property - a.property)
                  .map((a) => {
                    const isMine = a.seat === viewerSeat;
                    return isMine ? (
                      <p
                        key={a.seat}
                        style={{ animation: "forsale-check-earn-pop 0.5s ease-out" }}
                        className="flex items-center gap-1.5 rounded-full border border-emerald-300/50 bg-emerald-400/15 px-3 py-1 text-sm font-bold text-emerald-200"
                      >
                        🎉 {a.property}번 부동산 판매 → <span className="text-base text-emerald-300">+{formatDollars(a.check)}</span>
                      </p>
                    ) : (
                      <p key={a.seat} className="text-white/60">
                        {names[a.seat]}: {a.property}번 부동산 → {formatDollars(a.check)}
                      </p>
                    );
                  })}
                <button
                  onClick={() => onAction({ type: "continueSale" })}
                  className="mt-1 rounded-full bg-emerald-500 px-6 py-2 text-xs font-bold text-black transition hover:bg-emerald-400"
                >
                  ▶️ 다음 라운드
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-emerald-300/20 p-2.5 sm:p-3" style={{ background: "linear-gradient(160deg,#0c2b3a 0%,#081c26 55%,#040d12 100%)" }}>
            <h3 className="mb-2 flex flex-wrap items-center justify-between gap-1 text-[11px] font-semibold tracking-wide text-emerald-200/90 uppercase">
              <span className="whitespace-nowrap">🧾 내 수표 ({me.checks.length}장)</span>
              <span className="shrink-0 whitespace-nowrap text-emerald-300">누적 합계 {formatDollars(me.checks.reduce((s, c) => s + c, 0))}</span>
            </h3>
            {me.checks.length === 0 ? (
              <p className="text-xs text-white/30">아직 판매한 수표가 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...me.checks]
                  .sort((a, b) => b - a)
                  .map((c, i) => (
                    <CheckCard key={i} value={c} size="sm" />
                  ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-emerald-300/20 p-2.5 sm:p-3" style={{ background: "linear-gradient(160deg,#0c2b3a 0%,#081c26 55%,#040d12 100%)" }}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-emerald-200/90 uppercase">
              🏠 내 부동산 ({me.properties.length}장) — 1장을 뒷면으로 제출하세요
            </h3>
            {me.properties.length === 0 ? (
              <p className="text-xs text-white/30">제출할 부동산이 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...me.properties]
                  .sort((a, b) => a - b)
                  .map((c) => (
                    <button
                      key={c}
                      disabled={!canSubmit}
                      onClick={() => onAction({ type: "submitCard", seat: viewerSeat, property: c })}
                      className={`transition ${canSubmit ? "cursor-pointer hover:-translate-y-1" : "cursor-not-allowed opacity-40"}`}
                    >
                      <PropertyCard value={c} />
                    </button>
                  ))}
              </div>
            )}
            {mySubmission !== undefined && !state.sale.revealed && <p className="mt-2 text-center text-xs text-emerald-300">✅ 제출 완료 — 다른 플레이어를 기다리는 중...</p>}
          </section>
        </>
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* Phase 1 FX */}
      {passEvents.map((event) => (
        <FlyingPassCard
          key={event.id}
          event={event}
          getAuctionEl={() => auctionRowRef.current}
          getSeatEl={(seat) => seatRowRefs.current.get(seat) ?? null}
          onDone={handlePassDone}
        />
      ))}
      {bidEvents.map((event) => (
        <FlyingBidCoin key={event.id} event={event} getSeatEl={(seat) => seatRowRefs.current.get(seat) ?? null} getPotEl={() => potRef.current} onDone={handleBidDone} />
      ))}
      {winToast && <AuctionWinToast winnerName={winToast.winnerName} card={winToast.card} paid={winToast.paid} onDone={() => setWinToast(null)} />}
    </div>
  );
}
