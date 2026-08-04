"use client";

import { useState } from "react";
import RulebookModal from "./RulebookModal";
import { CardChip } from "./cardDisplay";
import {
  BOARD_SIZE,
  LINES,
  evaluateHand,
  opponentLiveCell,
  visibleOpponentBoard,
  type EngineAction,
  type GridPokerState,
  type SeatIndex,
} from "./engine";

/**
 * Pure game UI + rules driver — same contract as HanamikojiBoard/BangBoard:
 * state is fully controlled by the caller (GridPokerGame, which owns the
 * Supabase Realtime sync); this component only ever emits intent via
 * `onAction`. Every client holds the FULL state (every player's entire
 * board); this component only *renders* a filtered view of opponents via
 * `visibleOpponentBoard` — see engine.ts and README for the accepted trust
 * trade-off (no server authority).
 */
export interface GridPokerBoardProps {
  state: GridPokerState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/50 bg-gradient-to-b from-[#151a2e] via-[#0f1322] to-[#0a0d17] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

const LINE_LABELS = [
  ...Array.from({ length: 5 }, (_, i) => `가로 ${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `세로 ${i + 1}`),
  "대각선 ↘",
  "대각선 ↙",
];

function Cell({ card, highlight, onClick }: { card: { kind: "std"; rank: number; suit: "S" | "D" | "H" | "C" } | { kind: "joker" } | null; highlight?: boolean; onClick?: () => void }) {
  if (!card) {
    return (
      <button
        onClick={onClick}
        disabled={!onClick}
        className={`h-12 w-9 rounded-md border border-dashed transition sm:h-14 sm:w-10 ${
          onClick ? "border-white/25 bg-white/[0.03] hover:border-emerald-400/60 hover:bg-emerald-400/10" : "border-white/10 bg-white/[0.02]"
        } ${highlight ? "ring-2 ring-amber-400/70" : ""}`}
      />
    );
  }
  return (
    <span className={`inline-block rounded-md ${highlight ? "ring-2 ring-amber-400/80" : ""}`}>
      <CardChip card={card} size="sm" dim={false} />
    </span>
  );
}

export default function GridPokerBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: GridPokerBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const viewer = state.players[viewerSeat];
  const opponents = state.players.filter((p) => p.seat !== viewerSeat);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 족보 · 룰북
    </button>
  );

  if (state.phase === "game-end") {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-5 p-8 text-center`}>
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100">
          {state.winner && state.winner.length === 1
            ? `${names[state.winner[0]]}님 승리!`
            : "동점으로 무승부"}
        </h2>
        <div className="relative z-10 flex flex-wrap justify-center gap-2">
          {sorted.map((p) => (
            <div
              key={p.seat}
              className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs ${
                state.winner?.includes(p.seat) ? "border-amber-400/50 bg-amber-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <span className="text-white/80">{names[p.seat]}</span>
              <span className="text-lg font-bold text-white">{p.score}승</span>
            </div>
          ))}
        </div>
        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  const filledCells = viewer.board.filter((c) => c !== null).length;
  const myTurnToPlace = state.phase === "placing" && state.currentCard !== null && !state.placedThisRound[viewerSeat];
  const mySubmission = state.submissions[viewerSeat];

  function placeAt(cellIndex: number) {
    if (!myTurnToPlace || viewer.board[cellIndex] !== null) return;
    onAction({ type: "place", seat: viewerSeat, cellIndex });
  }

  function submitLine(lineIndex: number) {
    if (state.phase !== "submitting" || mySubmission !== null || viewer.usedLines[lineIndex]) return;
    onAction({ type: "submit-line", seat: viewerSeat, lineIndex });
  }

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-4 p-3 sm:p-4`}>
      <div className="relative z-10 flex items-center justify-between text-xs text-white/60">
        <span>
          {state.phase === "placing"
            ? `배치 중 · ${filledCells}/${BOARD_SIZE}칸`
            : `제출 라운드 ${Math.min(state.roundNumber, state.totalScoringRounds)}/${state.totalScoringRounds}`}
        </span>
        {rulebookButton}
      </div>

      <div className="relative z-10 flex flex-wrap gap-2">
        {state.players.map((p) => (
          <div
            key={p.seat}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
              p.seat === viewerSeat ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-white/60"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(p.seat) ? "bg-emerald-400" : "bg-white/20"}`} />
            {names[p.seat]} · {p.score}승
          </div>
        ))}
      </div>

      {state.phase === "placing" && (
        <div className="relative z-10 flex flex-col items-center gap-2">
          <p className="text-xs text-white/50">공통 카드</p>
          {state.currentCard ? (
            <div className="flex flex-col items-center gap-2">
              <CardChip card={state.currentCard} />
              <p className="text-xs text-white/50">
                {myTurnToPlace ? "빈 칸을 눌러 배치하세요" : "배치 완료 · 다른 플레이어를 기다리는 중..."}
              </p>
            </div>
          ) : (
            <p className="text-xs text-white/40">다음 카드를 뽑는 중...</p>
          )}
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center gap-1">
        <p className="text-xs text-white/50">내 보드판</p>
        <div className="grid grid-cols-5 gap-1 rounded-2xl border border-white/10 bg-black/20 p-2">
          {viewer.board.map((card, i) => (
            <Cell key={i} card={card} onClick={myTurnToPlace && card === null ? () => placeAt(i) : undefined} />
          ))}
        </div>
      </div>

      {state.phase === "submitting" && (
        <div className="relative z-10 flex flex-col gap-2">
          <p className="text-center text-xs text-white/50">
            {mySubmission !== null ? "제출 완료 · 다른 플레이어를 기다리는 중..." : "제출할 라인을 하나 고르세요"}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {LINES.map((cells, lineIndex) => {
              const used = viewer.usedLines[lineIndex];
              const cards = cells.map((c) => viewer.board[c]!);
              // Every cell in the line is filled by this point (submitting
              // only starts once the whole board is full), so the hand for
              // an unused line is always fully resolved and safe to preview.
              const hand = evaluateHand(cards);
              return (
                <button
                  key={lineIndex}
                  onClick={() => submitLine(lineIndex)}
                  disabled={used || mySubmission !== null}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${
                    used
                      ? "border-white/5 bg-white/[0.02] opacity-40"
                      : mySubmission === lineIndex
                        ? "border-amber-400/60 bg-amber-400/10"
                        : "border-white/10 bg-white/5 hover:border-emerald-400/50 hover:bg-emerald-400/10"
                  }`}
                >
                  <span className="text-[10px] text-white/50">{LINE_LABELS[lineIndex]}</span>
                  <div className="flex gap-0.5">
                    {cards.map((c) => (
                      <CardChip key={c.id} card={c} size="sm" />
                    ))}
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-300">
                    {hand.categoryName}
                    <span className="ml-1 font-normal text-white/40">({hand.category + 1}/9)</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {state.lastRoundResult && (
        <div className="relative z-10 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-xs text-white/50">
            {state.lastRoundResult.roundNumber}라운드 결과
            {state.lastRoundResult.winnerSeat !== null
              ? ` · ${names[state.lastRoundResult.winnerSeat]} 승!`
              : " · 무승부"}
          </p>
          <div className="flex flex-col gap-1.5">
            {state.lastRoundResult.submissions.map((sub) => (
              <div key={sub.seat} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-16 shrink-0 truncate ${sub.seat === state.lastRoundResult!.winnerSeat ? "font-semibold text-amber-300" : "text-white/60"}`}
                >
                  {names[sub.seat]}
                </span>
                <div className="flex gap-0.5">
                  {sub.hand.cards.map((c, i) => (
                    <span key={i} className="relative">
                      <CardChip card={{ kind: "std", rank: c.rank, suit: c.suit }} size="sm" />
                      {c.fromJoker && (
                        <span className="absolute -top-1 -right-1 text-[8px]" title="조커로 대체됨">
                          🃏
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <span className="text-white/50">{sub.hand.categoryName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {opponents.length > 0 && (
        <div className="relative z-10 flex flex-col gap-1.5">
          <p className="text-xs text-white/50">상대 보드판 (처음 배치한 칸 + 공개된 라인 + 이번 카드 배치 위치만 보임)</p>
          <div className="flex flex-wrap gap-2">
            {opponents.map((p) => {
              const board = visibleOpponentBoard(p);
              const liveCell = opponentLiveCell(state, p);
              return (
                <div key={p.seat} className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-2">
                  <span className="flex items-center gap-1 text-[11px] text-white/60">
                    {names[p.seat]}
                    {liveCell !== null && <span className="text-[10px] text-amber-300">· 배치 중</span>}
                  </span>
                  <div className="grid grid-cols-5 gap-0.5">
                    {board.map((card, i) => (
                      <Cell key={i} card={i === liveCell ? p.board[i] : card} highlight={i === liveCell} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
