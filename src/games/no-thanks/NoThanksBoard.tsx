"use client";

import { useState } from "react";
import RulebookModal from "./RulebookModal";
import {
  computeGroups,
  computeRankings,
  type EngineAction,
  type NoThanksState,
  type ScoreGroup,
  type SeatIndex,
} from "./engine";

/**
 * Pure game UI + rules driver — mirrors AvalonBoard/BangBoard/GridPokerBoard's
 * contract: state is fully controlled by the caller (NoThanksGame, which owns
 * the Supabase Realtime sync); this component only ever emits intent via
 * `onAction`, never mutates state itself. Every client holds the FULL state
 * (every seat's private chip count) in memory — this component only ever
 * *renders* the viewer's own chip count as a number and every other seat's
 * as "?". Acquired cards are NOT secret in No Thanks (the rulebook requires
 * them face-up in front of their owner), so those are always shown for real.
 * See engine.ts and README for the accepted trust trade-off.
 */
export interface NoThanksBoardProps {
  state: NoThanksState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

// A felt-green "auction table" panel — distinct from the other games' navy /
// wood / purple boards, fitting No Thanks's casino-chip theme.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/50 bg-gradient-to-b from-[#123326] via-[#0d251c] to-[#071310] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

function TableTexture() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.05]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 1px, transparent 1px, transparent 10px)",
      }}
    />
  );
}

/** One consecutive run rendered as a single fused pill — only the smallest (leftmost) number counts, the rest are visually "cancelled". */
function CardGroupBadge({ group, size = "sm" }: { group: ScoreGroup; size?: "sm" | "lg" }) {
  const cell = size === "lg" ? "h-11 w-11 text-sm" : "h-8 w-8 text-xs";
  return (
    <div className="flex overflow-hidden rounded-lg border border-emerald-400/40 bg-black/30 shadow-sm">
      {group.cards.map((card, i) => (
        <div
          key={card}
          className={`flex items-center justify-center font-bold ${cell} ${
            i === 0 ? "bg-emerald-500/30 text-emerald-100" : "bg-white/5 text-white/30 line-through decoration-white/25"
          } ${i > 0 ? "border-l border-dashed border-white/10" : ""}`}
          title={i === 0 ? `${card}점 벌점` : `${card} — 연속이라 상쇄됨`}
        >
          {card}
        </div>
      ))}
    </div>
  );
}

export default function NoThanksBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: NoThanksBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 노땡스 룰북
    </button>
  );

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-5 p-4 text-center sm:p-8`}>
        <TableTexture />
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100">
          {names[rankings[0].seat]}
          {rankings.filter((r) => r.rank === 1).length > 1 ? " 외 공동 1위!" : "님 승리!"}
        </h2>
        <p className="relative z-10 text-xs text-white/50">벌점이 가장 낮은 사람이 이기는 게임입니다.</p>

        <div className="relative z-10 w-full overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">보유 카드 (그룹화)</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">카드 벌점</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">칩</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">최종 점수</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, score }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">
                    {rank === 1 ? "🏆 1" : rank}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left">
                    {score.groups.length === 0 ? (
                      <span className="text-white/30">없음</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {score.groups.map((g) => (
                          <CardGroupBadge key={g.cards[0]} group={g} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-rose-300">−{score.cardPenalty}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-emerald-300">+{score.chips}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-bold text-white">{score.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------
  const isMyTurn = state.activeSeat === viewerSeat;
  const me = state.players[viewerSeat];
  const cardsRemaining = state.deck.length + (state.currentCard !== null ? 1 : 0);
  const canPass = isMyTurn && me.chips > 0;

  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
      <TableTexture />
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-1.5 text-xs text-emerald-100/60">
        <span>
          {state.playerCount}인 · 남은 카드 {cardsRemaining}장
        </span>
        {rulebookButton}
      </div>

      {/* Central auction area */}
      <div className="relative z-10 flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-6">
        <p className={`text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
          {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
        </p>

        <div className="relative flex h-28 w-20 items-center justify-center rounded-2xl border-2 border-white/20 bg-gradient-to-b from-white to-neutral-200 text-4xl font-black text-neutral-900 shadow-lg sm:h-36 sm:w-24 sm:text-5xl">
          {state.currentCard}
          {state.chipsOnCard > 0 && (
            <div className="absolute -bottom-3 flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-500/90 px-2.5 py-1 text-xs font-bold text-black shadow">
              🪙 {state.chipsOnCard}
            </div>
          )}
        </div>

        <div className="mt-2 flex w-full max-w-xs gap-2">
          <button
            disabled={!canPass}
            onClick={() => onAction({ type: "pass", seat: viewerSeat })}
            className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            🙅 노 땡스! (칩 1개)
          </button>
          <button
            disabled={!isMyTurn}
            onClick={() => onAction({ type: "take", seat: viewerSeat })}
            className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            ✅ 가져오기
          </button>
        </div>
        {isMyTurn && me.chips === 0 && (
          <p className="text-[11px] text-amber-300/80">칩이 없어서 무조건 가져와야 해요!</p>
        )}
      </div>

      {/* Player strip */}
      <div className="relative z-10 flex flex-col gap-2">
        {seatOrder.map((seat) => {
          const player = state.players[seat];
          const isSelf = seat === viewerSeat;
          const isActive = state.activeSeat === seat;
          const groups = computeGroups(player.cards);
          return (
            <div
              key={seat}
              className={`flex flex-col gap-1.5 rounded-xl border p-2.5 transition ${
                isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-white/90">
                  <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                  {isActive && <span title="차례">👉</span>}
                  {names[seat]}
                  {isSelf && <span className="text-amber-200">(나)</span>}
                </span>
                <span className="flex items-center gap-1 font-bold text-amber-200">
                  🪙 {isSelf ? player.chips : "?"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {groups.length === 0 ? (
                  <span className="text-[11px] text-white/25">아직 가져온 카드 없음</span>
                ) : (
                  groups.map((g) => <CardGroupBadge key={g.cards[0]} group={g} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
