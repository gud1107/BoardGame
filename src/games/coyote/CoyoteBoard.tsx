"use client";

import { type CSSProperties, useState } from "react";
import RulebookModal from "./RulebookModal";
import { CardFace, FeatherPips } from "./CardArt";
import { CardFlipWrapper, CoyoteHowlBanner, detectCoyoteCallEvent } from "./CoyoteEffects";
import { computeRankings, getPlayerView, STARTING_FEATHERS, type CoyoteState, type EngineAction, type SeatIndex } from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's forehead
 * card) per this project's lockstep trust model; the "이마 카드" secrecy is
 * enforced only here, purely at render time, via `getPlayerView` (see
 * engine.ts's module doc).
 */
export interface CoyoteBoardProps {
  state: CoyoteState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Position of a seat around the round table, relative to the viewer always sitting at the bottom — same technique as avalon/AvalonBoard.tsx's `seatPosition`. */
function seatPosition(relativeIndex: number, total: number): CSSProperties {
  const angleDeg = 90 + (relativeIndex / total) * 360;
  const angleRad = (angleDeg * Math.PI) / 180;
  const x = 50 + 42 * Math.cos(angleRad);
  const y = 50 + 38 * Math.sin(angleRad);
  return { left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" };
}

export default function CoyoteBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: CoyoteBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  // Same "diff consecutive lockstep snapshots on render" pattern every other
  // Board in this project uses to drive purely cosmetic flourishes — see
  // CoyoteEffects.tsx's module doc.
  const [trackedState, setTrackedState] = useState(state);
  const [howl, setHowl] = useState<{ callerName: string } | null>(null);
  if (trackedState !== state) {
    if (detectCoyoteCallEvent(trackedState, state) && state.lastResolution) {
      setHowl({ callerName: names[state.lastResolution.callerSeat] });
    }
    setTrackedState(state);
  }

  // The declare-number stepper resets to "one more than the current bid"
  // every time it becomes a fresh decision point (a new active seat or a
  // new bid to beat) — adjusted directly during render (React's recommended
  // "state adjustment" pattern), same as dalmuti's selection-reset.
  const turnKey = `${state.activeSeat}-${state.currentBid?.number ?? "none"}-${state.roundNumber}-${state.phase}`;
  const [trackedTurnKey, setTrackedTurnKey] = useState(turnKey);
  const [declareValue, setDeclareValue] = useState((state.currentBid?.number ?? 0) + 1);
  if (trackedTurnKey !== turnKey) {
    setTrackedTurnKey(turnKey);
    setDeclareValue((state.currentBid?.number ?? 0) + 1);
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 코요테 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#2e1a0d 0%,#1a0f08 55%,#0a0704 100%)" }}
      >
        <span className="text-5xl">🐺</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[winner.seat]}님이 최후까지 살아남아 승리했습니다!</h2>
        <p className="text-xs text-white/50">깃털을 모두 잃은 다른 플레이어들은 탈락했습니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[360px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">남은 깃털</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => {
                const player = state.players.find((p) => p.seat === seat)!;
                return (
                  <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "🐺 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      {names[seat]}
                      {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-left">
                      <FeatherPips feathers={player.feathers} max={STARTING_FEATHERS} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400">
          결과 확정하고 계속하기
        </button>
        {howl && <CoyoteHowlBanner callerName={howl.callerName} onDone={() => setHowl(null)} />}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing / reveal
  // ---------------------------------------------------------------------
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => (viewerSeat + i) % state.playerCount);
  const otherSeats = seatOrder.slice(1);
  const view = getPlayerView(state, viewerSeat);
  const cardBySeat = new Map(view.map((v) => [v.seat, v.card]));
  const revealed = state.phase !== "playing";
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const minDeclare = (state.currentBid?.number ?? -Infinity) + 1;
  const canDeclare = isMyTurn && Number.isInteger(declareValue) && declareValue > (state.currentBid?.number ?? -Infinity);
  const canCoyote = isMyTurn && state.currentBid !== null;
  const res = state.lastResolution;

  function renderSeat(seat: SeatIndex, style: CSSProperties, isSelf: boolean) {
    const player = state.players.find((p) => p.seat === seat)!;
    const isActive = state.phase === "playing" && state.activeSeat === seat;
    const card = cardBySeat.get(seat) ?? null;
    return (
      <div key={seat} className="absolute flex flex-col items-center gap-1" style={style}>
        <CardFlipWrapper flipKey={`${seat}-${state.roundNumber}-${revealed}`} revealed={revealed}>
          <CardFace card={card} highlight={isActive} size="sm" />
        </CardFlipWrapper>
        <div
          className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-1 text-center text-[10px] ${
            isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/30"
          }`}
        >
          <span className="flex items-center gap-1 font-semibold text-white/90">
            <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
            {isActive && <span title="차례">👉</span>}
            {names[seat]}
            {isSelf && <span className="text-amber-200">(나)</span>}
          </span>
          <FeatherPips feathers={player.feathers} max={STARTING_FEATHERS} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#3a2410 0%,#20140a 45%,#0d0805 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-orange-100/70">
        <span>
          {state.playerCount}인 · {state.roundNumber}라운드 · 깃털 {STARTING_FEATHERS}개 탈락
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      {/* Round table: every seat's forehead card placed around an ellipse, viewer at the bottom. */}
      <div className="relative z-10 mx-auto h-[280px] w-full max-w-md sm:h-[320px]">
        <div className="absolute inset-[10%] rounded-[50%] border-4 border-orange-900/50 bg-gradient-to-b from-orange-950/50 to-black/70 shadow-inner" />
        {renderSeat(viewerSeat, seatPosition(0, state.playerCount), true)}
        {otherSeats.map((seat, i) => renderSeat(seat, seatPosition(i + 1, state.playerCount), false))}
      </div>

      {/* Bidding phase */}
      {state.phase === "playing" && (
        <div className="relative z-10 flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-center">
          <p className="text-xs text-orange-100/80">
            {state.currentBid ? (
              <>
                현재 선언: <span className="text-lg font-bold text-amber-300">{state.currentBid.number}</span> ({names[state.currentBid.seat]}
                님)
              </>
            ) : (
              <>아직 선언이 없습니다 — {names[state.activeSeat]}님이 첫 선언을 합니다.</>
            )}
          </p>
          {isMyTurn ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-medium text-amber-200">🫵 당신 차례입니다!</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDeclareValue((n) => Math.max(minDeclare, n - 1))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
                >
                  −
                </button>
                <input
                  type="number"
                  value={declareValue}
                  onChange={(e) => setDeclareValue(Number(e.target.value))}
                  className="w-20 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-center text-lg font-bold text-white focus:border-amber-400 focus:outline-none"
                />
                <button onClick={() => setDeclareValue((n) => n + 1)} className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30">
                  +
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={!canDeclare}
                  onClick={() => onAction({ type: "declare", seat: viewerSeat, number: declareValue })}
                  className="rounded-full bg-amber-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  📢 선언하기
                </button>
                <button
                  disabled={!canCoyote}
                  onClick={() => onAction({ type: "coyote", seat: viewerSeat })}
                  className="rounded-full bg-rose-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  🐺 코요테!
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/50">{names[state.activeSeat]}님의 차례를 기다리는 중...</p>
          )}
        </div>
      )}

      {/* Reveal / showdown */}
      {state.phase === "reveal" && res && (
        <div className="relative z-10 flex flex-col gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-center text-xs">
          <p className="font-semibold text-rose-200">🐺 {names[res.callerSeat]}님이 &quot;코요테!&quot;를 외쳤습니다</p>
          <p className="text-white/70">
            직전 선언: <b className="text-amber-300">{res.bid.number}</b> ({names[res.bid.seat]}) · 실제 총합:{" "}
            <b className="text-emerald-300">{res.finalTotal}</b>
          </p>
          {res.extraDrawnCards.length > 0 && (
            <p className="text-white/60">🎁 ? 카드로 {res.extraDrawnCards.length}장 추가 공개됨</p>
          )}
          {res.maxZeroTarget.card && <p className="text-white/60">👧 최고값 카드({res.maxZeroTarget.card.value})가 0으로 무효화됨</p>}
          {res.doubled && <p className="text-white/60">🪶 최종 합산이 2배 적용됨</p>}
          {res.nightCardHolderSeat !== null && <p className="text-white/60">🌙 {names[res.nightCardHolderSeat]}님이 다음 라운드의 선이 됩니다</p>}
          <p className="font-semibold text-white">
            {res.loserWasBidder
              ? `${names[res.bid.seat]}님이 오버 배팅으로 깃털 1개를 잃었습니다.`
              : `${names[res.callerSeat]}님이 잘못된 코요테 외침으로 깃털 1개를 잃었습니다.`}
          </p>
          <button
            onClick={() => onAction({ type: "continue", seed: randomSeed() })}
            className="mx-auto mt-1 rounded-full bg-amber-500 px-6 py-2 text-xs font-bold text-black transition hover:bg-amber-400"
          >
            ▶️ 다음 라운드
          </button>
        </div>
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      {howl && <CoyoteHowlBanner callerName={howl.callerName} onDone={() => setHowl(null)} />}
    </div>
  );
}
