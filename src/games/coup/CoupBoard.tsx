"use client";

import { useState } from "react";
import RulebookModal from "./RulebookModal";
import TargetModal from "./TargetModal";
import ResponseModal from "./ResponseModal";
import ExchangeModal from "./ExchangeModal";
import LoseInfluenceModal from "./LoseInfluenceModal";
import { CardBack, CharacterCardFace, CoinStack } from "./CardArt";
import { CardFlipWrapper, detectGameJustEnded, detectNewlyEliminated, EliminationToast, GameOverBanner } from "./CoupEffects";
import {
  ACTION_NAMES,
  aliveSeats,
  ASSASSINATE_COST,
  CHARACTER_NAMES,
  computeRankings,
  COUP_COST,
  currentResponders,
  getPlayerView,
  mustCoup,
  needsDeclareTarget,
  type ActionKind,
  type CoupState,
  type EngineAction,
  type LastEvent,
  type SeatIndex,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's actual
 * influence cards) per this project's lockstep trust model; hidden-hand
 * secrecy is enforced only here, at render time, via `getPlayerView`. The 5
 * decision-driving popups (target/response/exchange/lose-influence, plus the
 * rulebook) each live in their own file per ARCHITECTURE.md's 3-layer split.
 */
export interface CoupBoardProps {
  state: CoupState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const ACTION_EMOJI: Record<ActionKind, string> = {
  income: "💰",
  foreignAid: "💸",
  coup: "⚔️",
  tax: "👑",
  assassinate: "🗡️",
  steal: "⚓",
  exchange: "🕊️",
};

function describeLastEvent(event: LastEvent | null, names: Record<SeatIndex, string>): string | null {
  if (!event) return null;
  const who = (seat: SeatIndex) => names[seat] ?? "상대";
  switch (event.type) {
    case "declare":
      return `${who(event.seat)}님이 ${ACTION_NAMES[event.action]}${event.targetSeat !== null ? ` → ${who(event.targetSeat)}` : ""}을(를) 선언했습니다.`;
    case "challengeAction":
      return event.actorHadCard
        ? `${who(event.challengerSeat)}님의 의심 실패 — ${who(event.actorSeat)}님은 진짜 ${CHARACTER_NAMES[event.character]}를 갖고 있었습니다!`
        : `${who(event.challengerSeat)}님의 의심 적중! ${who(event.actorSeat)}님에게는 ${CHARACTER_NAMES[event.character]}가 없었습니다.`;
    case "block":
      return `${who(event.blockerSeat)}님이 ${CHARACTER_NAMES[event.character]}(으)로 방어를 선언했습니다.`;
    case "challengeBlock":
      return event.blockerHadCard
        ? `${who(event.challengerSeat)}님의 의심 실패 — ${who(event.blockerSeat)}님의 방어는 진짜였습니다!`
        : `${who(event.challengerSeat)}님의 의심 적중! ${who(event.blockerSeat)}님의 방어는 거짓이었습니다.`;
    case "actionResolved":
      if (event.blocked) return `${ACTION_NAMES[event.action]}이(가) 방어당해 무효화되었습니다.`;
      if (event.action === "steal") return `${who(event.actorSeat)}님이 ${who(event.targetSeat!)}님의 코인 ${event.amount}개를 갈취했습니다.`;
      if (event.action === "tax") return `${who(event.actorSeat)}님이 세금으로 3코인을 징수했습니다.`;
      if (event.action === "foreignAid") return `${who(event.actorSeat)}님이 외화 도입으로 2코인을 얻었습니다.`;
      return null;
    case "influenceLost":
      return `💀 ${who(event.seat)}님이 ${CHARACTER_NAMES[event.character]} 카드를 공개하며 잃었습니다.`;
    case "cardReplaced":
      return `${who(event.seat)}님이 증명한 카드를 새 카드로 교체했습니다.`;
    case "exchangeStarted":
      return `${who(event.seat)}님이 교환할 카드를 고르는 중입니다.`;
    case "exchangeResolved":
      return `${who(event.seat)}님이 카드 교환을 마쳤습니다.`;
    default:
      return null;
  }
}

export default function CoupBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: CoupBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [pendingTargetAction, setPendingTargetAction] = useState<ActionKind | null>(null);

  const [trackedState, setTrackedState] = useState(state);
  const [eliminationToast, setEliminationToast] = useState<{ id: number; names: string[] } | null>(null);
  const [gameOverBanner, setGameOverBanner] = useState(false);
  if (trackedState !== state) {
    const newlyEliminated = detectNewlyEliminated(trackedState, state);
    const justEnded = detectGameJustEnded(trackedState, state);
    setTrackedState(state);
    if (newlyEliminated.length > 0) setEliminationToast({ id: state.eliminationOrder.length, names: newlyEliminated.map((s) => names[s] ?? "상대") });
    if (justEnded) setGameOverBanner(true);
  }

  const view = getPlayerView(state, viewerSeat);
  const narration = describeLastEvent(state.lastEvent, names);

  const fx = (
    <>
      {eliminationToast && <EliminationToast key={eliminationToast.id} names={eliminationToast.names} onDone={() => setEliminationToast(null)} />}
      {gameOverBanner && state.winnerSeat !== null && (
        <GameOverBanner winnerName={names[state.winnerSeat] ?? "상대"} onDone={() => setGameOverBanner(false)} />
      )}
    </>
  );

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 쿠 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#2a1a08 0%,#180f04 55%,#0a0602 100%)" }}
      >
        <span className="text-5xl">👑</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[state.winnerSeat!] ?? "상대"}님이 최후의 생존자로 승리했습니다!</h2>
        <p className="text-xs text-white/50">단판 승부 — 마지막까지 영향력을 지킨 단 1명이 즉시 최종 승자가 됩니다.</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {state.players.map((p) => {
            const revealedHand = view.players.find((v) => v.seat === p.seat)!.influence;
            return (
              <div key={p.seat} className="flex flex-col items-center gap-1">
                <div className="flex gap-1">
                  {revealedHand && revealedHand.length > 0 ? (
                    revealedHand.map((c) => (
                      <CardFlipWrapper key={c.id} flipKey={`${p.seat}-${c.id}-gameOver`} revealed>
                        <CharacterCardFace card={c} size="sm" />
                      </CardFlipWrapper>
                    ))
                  ) : (
                    <div className="flex h-16 w-12 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-lg opacity-50">💀</div>
                  )}
                </div>
                <span className="text-[10px] text-white/60">{names[p.seat] ?? "상대"}</span>
              </div>
            );
          })}
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">코인</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => {
                const p = state.players.find((pl) => pl.seat === seat)!;
                return (
                  <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "👑 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      {names[seat] ?? "상대"}
                      {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white/60">{p.coins}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400">
          결과 확정하고 계속하기
        </button>
        {fx}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const myView = view.players.find((v) => v.seat === viewerSeat)!;
  const isMyTurn = state.phase === "action" && state.activeSeat === viewerSeat;
  const forced = mustCoup(me.coins);
  const responders = currentResponders(state);
  const iAmResponding = responders.includes(viewerSeat) && state.phase !== "action" && state.phase !== "loseInfluence" && state.phase !== "exchange";
  const iAmLosingInfluence = state.phase === "loseInfluence" && state.pendingLoseInfluence?.seat === viewerSeat;
  const iAmExchanging = state.phase === "exchange" && view.pendingExchangeOptions !== null;

  function declare(action: ActionKind, targetSeat?: SeatIndex) {
    onAction({ type: "declareAction", seat: viewerSeat, action, targetSeat });
  }

  function handleActionClick(action: ActionKind) {
    if (needsDeclareTarget(action)) {
      setPendingTargetAction(action);
      return;
    }
    declare(action);
  }

  const availableTargets = pendingTargetAction ? aliveSeats(state).filter((s) => s !== viewerSeat) : [];

  const ACTIONS: ActionKind[] = ["income", "foreignAid", "coup", "tax", "assassinate", "steal", "exchange"];

  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#201408 0%,#140c04 45%,#0a0602 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-amber-100/70">
        <span>
          {state.playerCount}인 · 단판 승부 · 턴 {state.turnNumber}
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      {narration && <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-center text-xs text-white/70">💬 {narration}</div>}

      {/* Seats */}
      <section className="flex flex-col gap-1.5">
        {state.players.map((p) => {
          const v = view.players.find((x) => x.seat === p.seat)!;
          const isActive = state.activeSeat === p.seat;
          const isSelf = p.seat === viewerSeat;
          const isEliminated = v.influenceCount === 0;
          return (
            <div
              key={p.seat}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                isEliminated ? "border-white/5 bg-black/10 opacity-50" : isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white/90">
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(p.seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                {names[p.seat] ?? "상대"}
                {isSelf && <span className="text-amber-200">(나)</span>}
                {isEliminated && <span className="text-white/40">💀 탈락</span>}
                {!isEliminated && mustCoup(p.coins) && <span title="쿠데타 필수" className="text-rose-300">⚠️쿠필수</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <CoinStack coins={p.coins} />
                <span className="flex gap-1">
                  {v.influence
                    ? v.influence.map((c) => <CharacterCardFace key={c.id} card={c} size="xs" />)
                    : Array.from({ length: v.influenceCount }, (_, i) => <CardBack key={i} size="xs" />)}
                  {v.revealed.map((c) => (
                    <CharacterCardFace key={c.id} card={c} size="xs" dead />
                  ))}
                </span>
              </span>
            </div>
          );
        })}
      </section>

      {/* My hand */}
      <section
        className="rounded-2xl border border-amber-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#2a1a08 0%,#180f04 55%,#0a0602 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-amber-200/90 uppercase">
          내 영향력 ({myView.influenceCount}장) · 🪙 {me.coins}코인
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          {myView.influence?.map((c) => <CharacterCardFace key={c.id} card={c} size="md" />)}
          {me.revealed.map((c) => (
            <CharacterCardFace key={c.id} card={c} size="md" dead />
          ))}
        </div>

        {isMyTurn && (
          <div className="mt-3 flex flex-col gap-2">
            {forced && <p className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-center text-[11px] text-rose-300">⚠️ 코인 10개 이상 — 쿠데타만 사용할 수 있습니다.</p>}
            <div className="flex flex-wrap gap-1.5">
              {ACTIONS.map((action) => {
                const cost = action === "coup" ? COUP_COST : action === "assassinate" ? ASSASSINATE_COST : 0;
                const disabled = (forced && action !== "coup") || me.coins < cost || (needsDeclareTarget(action) && aliveSeats(state).filter((s) => s !== viewerSeat).length === 0);
                return (
                  <button
                    key={action}
                    disabled={disabled}
                    onClick={() => handleActionClick(action)}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      disabled ? "cursor-not-allowed border-white/10 text-white/25" : "border-amber-300/30 text-amber-100 hover:bg-amber-400/10"
                    }`}
                  >
                    {ACTION_EMOJI[action]} {ACTION_NAMES[action]}
                    {cost > 0 && <span className="ml-1 opacity-60">({cost})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!isMyTurn && state.phase === "action" && <p className="mt-2 text-center text-[11px] text-white/40">{names[state.activeSeat] ?? "상대"}님의 차례를 기다리는 중...</p>}
        {!isMyTurn && !iAmResponding && state.phase !== "action" && state.phase !== "loseInfluence" && state.phase !== "exchange" && (
          <p className="mt-2 text-center text-[11px] text-white/40">다른 플레이어의 판단을 기다리는 중...</p>
        )}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {pendingTargetAction && (
        <TargetModal
          action={pendingTargetAction}
          targets={availableTargets}
          names={names}
          onConfirm={(targetSeat) => {
            declare(pendingTargetAction, targetSeat);
            setPendingTargetAction(null);
          }}
          onCancel={() => setPendingTargetAction(null)}
        />
      )}

      {iAmResponding && <ResponseModal state={state} viewerSeat={viewerSeat} names={names} onAction={onAction} />}

      {iAmLosingInfluence && myView.influence && (
        <LoseInfluenceModal
          options={myView.influence}
          reason={state.pendingLoseInfluence!.reason}
          onReveal={(cardId) => onAction({ type: "revealInfluence", seat: viewerSeat, cardId, seed: Math.floor(Math.random() * 1_000_000_000) })}
        />
      )}

      {iAmExchanging && view.pendingExchangeOptions && (
        <ExchangeModal
          options={view.pendingExchangeOptions}
          keepCount={view.pendingExchangeKeepCount!}
          onConfirm={(keepCardIds) => onAction({ type: "resolveExchange", seat: viewerSeat, keepCardIds })}
        />
      )}

      {fx}
    </div>
  );
}
