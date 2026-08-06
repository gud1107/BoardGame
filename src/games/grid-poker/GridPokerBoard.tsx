"use client";

import { useEffect, useState } from "react";
import RulebookModal from "./RulebookModal";
import DealerReveal from "./DealerReveal";
import { CardChip } from "./cardDisplay";
import { useCountdown } from "./useCountdown";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import {
  BOARD_SIZE,
  LINES,
  evaluateHand,
  opponentLiveCell,
  visibleOpponentBoard,
  type Card,
  type EngineAction,
  type GridPokerState,
  type SeatIndex,
} from "./engine";

const PLACING_SECONDS = 20;
const SUBMITTING_SECONDS = 15;
const URGENT_THRESHOLD = 5;

function randomFrom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

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

const CELL_DIMS = {
  main: "h-14 w-10 sm:h-16 sm:w-12",
  mini: "h-11 w-8 sm:h-12 sm:w-9",
};

/**
 * `hiddenOccupied` is the "opponent already placed something here but we
 * can't see what" state — visually distinct from a genuinely empty cell so
 * the board reads as progressively darkening/filling in, not as if nothing
 * happened there. Every client holds the opponent's full board in memory
 * (see engine.ts's trust-trade-off note); this is purely a rendering choice
 * to *not* show it.
 */
function Cell({
  card,
  hiddenOccupied = false,
  highlight,
  onClick,
  size = "main",
}: {
  card: Card | null;
  hiddenOccupied?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  size?: "main" | "mini";
}) {
  const dims = CELL_DIMS[size];
  if (hiddenOccupied) {
    return (
      <span
        title="상대가 이미 카드를 놓은 칸 (공개 전)"
        className={`inline-flex ${dims} items-center justify-center rounded-md border border-white/5 bg-black/75 text-white/15 shadow-[inset_0_0_8px_rgba(0,0,0,0.8)] ${
          highlight ? "ring-2 ring-amber-400/80" : ""
        }`}
      >
        <span className="text-xs">🂠</span>
      </span>
    );
  }
  if (!card) {
    return (
      <button
        onClick={onClick}
        disabled={!onClick}
        className={`${dims} rounded-md border border-dashed transition ${
          onClick ? "border-white/25 bg-white/[0.03] hover:border-emerald-400/60 hover:bg-emerald-400/10" : "border-white/10 bg-white/[0.02]"
        } ${highlight ? "ring-2 ring-amber-400/70" : ""}`}
      />
    );
  }
  return (
    <span className={`inline-block rounded-md ${highlight ? "ring-2 ring-amber-400/80" : ""}`}>
      <CardChip card={card} size={size === "main" ? "md" : "sm"} dim={false} />
    </span>
  );
}

/** Numeric countdown bar, red-hot once inside the urgent threshold. */
function CountdownBar({ timeLeft, total }: { timeLeft: number; total: number }) {
  const urgent = timeLeft <= URGENT_THRESHOLD;
  const pct = Math.max(0, Math.min(100, (timeLeft / total) * 100));
  return (
    <div className="flex w-full max-w-[220px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
            urgent ? "bg-rose-500" : "bg-emerald-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-6 text-right text-xs font-bold tabular-nums ${urgent ? "animate-pulse text-rose-300" : "text-white/60"}`}>
        {timeLeft}
      </span>
    </div>
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

  // All hooks (countdowns, the SFX effect, the mute-toggle state) must run
  // unconditionally on every render, so this whole block lives above the
  // early `game-end` return below rather than after it.
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

  // Per-viewer countdowns (see useCountdown.ts) — each client only ever
  // auto-acts for its own seat on expiry, matching the lockstep model.
  // `resetKey` ties each timer to "this specific draw/round" so a rerender
  // mid-countdown never restarts it early, and a fresh draw/round always does.
  const { timeLeft: placingTimeLeft } = useCountdown(PLACING_SECONDS, state.drawCount, myTurnToPlace, () => {
    const emptyCells = viewer.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    const cell = randomFrom(emptyCells);
    if (cell !== undefined) placeAt(cell);
  });
  const submittingActive = state.phase === "submitting" && mySubmission === null;
  const { timeLeft: submittingTimeLeft } = useCountdown(SUBMITTING_SECONDS, state.roundNumber, submittingActive, () => {
    const unused = LINES.map((_, i) => i).filter((i) => !viewer.usedLines[i]);
    const line = randomFrom(unused);
    if (line !== undefined) submitLine(line);
  });

  const urgentTimeLeft = myTurnToPlace ? placingTimeLeft : submittingActive ? submittingTimeLeft : null;
  const isUrgent = urgentTimeLeft !== null && urgentTimeLeft <= URGENT_THRESHOLD && urgentTimeLeft > 0;
  useEffect(() => {
    const engine = getSoundEngine();
    if (isUrgent) engine.startFuseCrackle();
    else engine.stopFuseCrackle();
    return () => engine.stopFuseCrackle();
  }, [isUrgent]);

  const [muted, setMuted] = useState(() => getSoundEngine().isMuted());
  const soundToggle = (
    <button
      onClick={() => {
        const engine = getSoundEngine();
        engine.unlock();
        engine.setMuted(!muted);
        setMuted(!muted);
      }}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
      aria-label={muted ? "소리 켜기" : "소리 끄기"}
    >
      {muted ? "🔇" : "🔊"}
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

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-4 p-3 sm:p-4`}>
      <div className="relative z-10 flex items-center justify-between text-xs text-white/60">
        <span>
          {state.phase === "placing"
            ? `배치 중 · ${filledCells}/${BOARD_SIZE}칸`
            : `제출 라운드 ${Math.min(state.roundNumber, state.totalScoringRounds)}/${state.totalScoringRounds}`}
        </span>
        <div className="flex items-center gap-1.5">
          {soundToggle}
          {rulebookButton}
        </div>
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
          <DealerReveal
            card={state.currentCard}
            drawCount={state.drawCount}
            caption={
              !state.currentCard
                ? "다음 카드를 뽑는 중..."
                : myTurnToPlace
                  ? "빈 칸을 눌러 배치하세요"
                  : "배치 완료 · 다른 플레이어를 기다리는 중..."
            }
          />
          {myTurnToPlace && <CountdownBar timeLeft={placingTimeLeft} total={PLACING_SECONDS} />}
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <p className="text-xs text-white/50">내 보드판</p>
        <div className="grid grid-cols-5 gap-1.5 rounded-2xl border border-white/10 bg-black/20 p-2.5 sm:gap-2 sm:p-3">
          {viewer.board.map((card, i) => (
            <Cell key={i} card={card} onClick={myTurnToPlace && card === null ? () => placeAt(i) : undefined} />
          ))}
        </div>
      </div>

      {state.phase === "submitting" && (
        <div className="relative z-10 flex flex-col items-center gap-2">
          <p className="text-center text-xs text-white/50">
            {mySubmission !== null ? "제출 완료 · 다른 플레이어를 기다리는 중..." : "제출할 라인을 하나 고르세요"}
          </p>
          {submittingActive && <CountdownBar timeLeft={submittingTimeLeft} total={SUBMITTING_SECONDS} />}
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
                  <div className="grid grid-cols-5 gap-1">
                    {board.map((card, i) => {
                      const isLive = i === liveCell;
                      const displayCard = isLive ? p.board[i] : card;
                      // Revealed-null but actually filled (per the full
                      // state every client holds) = they placed here in an
                      // earlier round and it's still hidden — render dark,
                      // not empty, and it accumulates automatically as more
                      // cells fill in (p.board never clears).
                      const hiddenOccupied = !isLive && displayCard === null && p.board[i] !== null;
                      return (
                        <Cell
                          key={i}
                          card={displayCard}
                          hiddenOccupied={hiddenOccupied}
                          highlight={isLive}
                          size="mini"
                        />
                      );
                    })}
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
