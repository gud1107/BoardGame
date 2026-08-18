"use client";

import { useEffect, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import PredictionStatusBoard from "./PredictionStatusBoard";
import LastRoundHistoryModal from "./LastRoundHistoryModal";
import { CardFace } from "./CardFace";
import {
  PLAYER_COUNT,
  TOTAL_ROUNDS,
  visibleCurrentPrediction,
  visiblePastPrediction,
  type DestinyWar39State,
  type EngineAction,
  type SeatIndex,
  type TurnRecord,
} from "./engine";

/**
 * Minimum time a just-finished trick stays on screen (winner glowing) before
 * the board moves on to the next turn / round-end summary. Pure UI pacing —
 * NOT part of `DestinyWar39State`. Folding this into the shared engine state
 * would break the lockstep replay model every client relies on (see
 * engine.ts's module doc): wall-clock timers differ per client, so a
 * "resolving" flag computed from `Date.now()` would desync immediately.
 * Instead this is tracked as purely local component state, keyed off
 * `round.turnRecords` growing — see the effect below.
 */
const TRICK_REVEAL_MS = 2800;

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state per this project's
 * lockstep trust model; hidden-prediction secrecy is enforced only here, at
 * render time, via `visibleCurrentPrediction`/`visiblePastPrediction`.
 */
export interface DestinyWar39BoardProps {
  state: DestinyWar39State;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function DestinyWar39Board({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: DestinyWar39BoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [predictionChoice, setPredictionChoice] = useState<number | null>(null);
  const [useHidden, setUseHidden] = useState(false);

  const round = state.round;
  const R = round.roundNumber;

  // Freeze-frame the trick that just resolved (winner glowing) for
  // TRICK_REVEAL_MS before letting the next turn / round-end summary render
  // — fixes tricks flashing by unseen the instant the 5th card lands. Fires
  // whenever `round.turnRecords` grows *within the same round*; a round
  // change resets turnRecords to a shorter array and must NOT be mistaken
  // for a resolved trick.
  const [resolvingTurn, setResolvingTurn] = useState<TurnRecord | null>(null);
  const prevRoundNumberRef = useRef(round.roundNumber);
  const prevTurnCountRef = useRef(round.turnRecords.length);
  useEffect(() => {
    const roundChanged = round.roundNumber !== prevRoundNumberRef.current;
    const turnCountGrew = !roundChanged && round.turnRecords.length > prevTurnCountRef.current;
    prevRoundNumberRef.current = round.roundNumber;
    prevTurnCountRef.current = round.turnRecords.length;
    if (!turnCountGrew) return;
    setResolvingTurn(round.turnRecords[round.turnRecords.length - 1]);
    const timer = setTimeout(() => setResolvingTurn(null), TRICK_REVEAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.roundNumber, round.turnRecords.length]);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 운명전쟁39 룰북
    </button>
  );
  const historyButton = (
    <button
      onClick={() => setHistoryOpen(true)}
      disabled={!state.lastCompletedRound}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
    >
      🕓 직전 라운드 보기
    </button>
  );
  const historyModal = historyOpen && <LastRoundHistoryModal state={state} viewerSeat={viewerSeat} names={names} onClose={() => setHistoryOpen(false)} />;

  const seatLabel = (seat: SeatIndex) => (seat === viewerSeat ? `${names[seat]} (나)` : names[seat]);
  const scoreboard = state.players.map((p) => ({
    seat: p.seat,
    total: p.scores.reduce((sum: number, v) => sum + (v ?? 0), 0),
  }));

  // ---------------------------------------------------------------------
  // Trick just resolved — freeze-frame it (winner glowing) before showing
  // whatever comes next (next turn, round-end summary, or final results).
  // Pre-empts every phase branch below on purpose.
  // ---------------------------------------------------------------------
  if (resolvingTurn) {
    const t = resolvingTurn;
    return (
      <div className="flex flex-col gap-5 rounded-2xl border border-amber-400/25 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">
            ROUND {round.roundNumber} — 턴 {t.turnNumber} 결과
          </h2>
          {t.reverseActive && (
            <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] text-fuchsia-200">🔄 리버스 발동</span>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-4 py-2">
          {Array.from({ length: PLAYER_COUNT }, (_, seat) => {
            const p = t.plays.find((x) => x.seat === seat);
            if (!p) return null;
            const isWinner = seat === t.winnerSeat;
            return (
              <div key={seat} className="flex flex-col items-center gap-1.5">
                <span className={`text-xs ${isWinner ? "font-bold text-amber-200" : "text-white/50"}`}>
                  {seatLabel(seat)}
                  {isWinner ? " 🏆" : ""}
                </span>
                <CardFace
                  card={p.card}
                  size="lg"
                  className={isWinner ? "scale-110 ring-4 ring-amber-300/70 shadow-[0_0_25px_rgba(252,211,77,0.55)]" : ""}
                />
              </div>
            );
          })}
        </div>
        <p className="text-center text-sm font-semibold text-amber-200">{seatLabel(t.winnerSeat)}님이 이 턴을 가져갔습니다!</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const winners = state.finalRankings!.filter((r) => r.rank === 1).map((r) => names[r.seat]);
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#241033 0%,#160a20 55%,#0a0510 100%)" }}
      >
        <span className="text-5xl">🔮</span>
        <h2 className="text-2xl font-bold text-fuchsia-100">
          {winners.length > 1 ? `${winners.join(", ")}님 공동 우승!` : `${winners[0]}님이 운명전쟁39에서 승리했습니다!`}
        </h2>
        <div className="flex justify-center">{historyButton}</div>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="px-2 py-1.5 text-left">플레이어</th>
                {Array.from({ length: TOTAL_ROUNDS }, (_, i) => (
                  <th key={i} className="px-1.5 py-1.5 text-center">
                    R{i + 1}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right">총점</th>
                <th className="px-2 py-1.5 text-right">순위</th>
              </tr>
            </thead>
            <tbody>
              {state.finalRankings!
                .slice()
                .sort((a, b) => a.rank - b.rank || a.seat - b.seat)
                .map(({ seat, rank }) => {
                  const player = state.players.find((p) => p.seat === seat)!;
                  return (
                    <tr key={seat} className="border-t border-white/10">
                      <td className="px-2 py-1.5 font-medium text-white/90">{seatLabel(seat)}</td>
                      {Array.from({ length: TOTAL_ROUNDS }, (_, i) => (
                        <td key={i} className="px-1.5 py-1.5 text-center text-white/70">
                          {player.predictions[i]}→{player.actualWins[i]}
                          <span className="ml-1 text-white/40">({(player.scores[i] ?? 0) >= 0 ? "+" : ""}{player.scores[i]})</span>
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-bold text-fuchsia-200">{state.finalScores![seat]}</td>
                      <td className="px-2 py-1.5 text-right text-white/60">{rank}위</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500">
          결과 확인 완료
        </button>
        {historyModal}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Round-end summary
  // ---------------------------------------------------------------------
  if (state.phase === "roundEnd") {
    return (
      <div className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">ROUND {round.roundNumber} 결과</h2>
          <div className="flex gap-2">
            {historyButton}
            {rulebookButton}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="bg-white/5 text-white/50">
                <th className="px-2 py-1.5 text-left">플레이어</th>
                <th className="px-2 py-1.5 text-center">예측</th>
                <th className="px-2 py-1.5 text-center">실제</th>
                <th className="px-2 py-1.5 text-center">결과</th>
                <th className="px-2 py-1.5 text-right">점수</th>
              </tr>
            </thead>
            <tbody>
              {state.players.map((p) => {
                const idx = round.roundNumber - 1;
                const visible = visiblePastPrediction(state, viewerSeat, p.seat, round.roundNumber);
                const isHiddenFromMe = visible === "hidden";
                const success = p.predictions[idx] === p.actualWins[idx];
                return (
                  <tr key={p.seat} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-medium text-white/90">{seatLabel(p.seat)}</td>
                    <td className="px-2 py-1.5 text-center text-white/70">{isHiddenFromMe ? "🙈" : p.predictions[idx]}</td>
                    <td className="px-2 py-1.5 text-center text-white/70">{p.actualWins[idx]}</td>
                    <td className={`px-2 py-1.5 text-center font-semibold ${isHiddenFromMe ? "text-white/40" : success ? "text-emerald-400" : "text-rose-400"}`}>
                      {isHiddenFromMe ? "비공개" : success ? "성공" : "실패"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-white/80">
                      {isHiddenFromMe ? "?" : `${(p.scores[idx] ?? 0) >= 0 ? "+" : ""}${p.scores[idx]}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>누적 점수</span>
          <span className="flex flex-wrap gap-3">
            {scoreboard.map((s) => (
              <span key={s.seat} className="text-white/70">
                {seatLabel(s.seat)}: <b className="text-white">{s.total}</b>
              </span>
            ))}
          </span>
        </div>
        <button
          onClick={() => onAction({ type: "nextRound", seed: randomSeed() })}
          className="w-full rounded-xl bg-fuchsia-600 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
        >
          {round.roundNumber < TOTAL_ROUNDS ? `ROUND ${round.roundNumber + 1} 시작` : "최종 결과 보기"}
        </button>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
        {historyModal}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Predicting phase
  // ---------------------------------------------------------------------
  if (state.phase === "predicting") {
    const myPlayer = state.players.find((p) => p.seat === viewerSeat)!;
    const alreadySubmitted = round.predictions[viewerSeat] !== null;
    const hiddenAvailable = !myPlayer.hiddenUsed;
    const submittedCount = Object.values(round.predictions).filter((v) => v !== null).length;

    return (
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex flex-1 flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">ROUND {R} — 예측</h2>
            <div className="flex gap-2">
              {historyButton}
              {rulebookButton}
            </div>
          </div>
          <p className="text-xs text-white/50">
            이번 라운드는 {R}턴 진행됩니다. 손패 {R}장을 확인하고 이번 라운드에서 몇 번 이길지 예측하세요 (0~{R}).
          </p>
          <div className="flex flex-wrap gap-2">
            {round.hands[viewerSeat].map((c) => (
              <CardFace key={c.id} card={c} size="sm" />
            ))}
          </div>

          {!alreadySubmitted ? (
            <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: R + 1 }, (_, v) => v).map((v) => (
                  <button
                    key={v}
                    onClick={() => setPredictionChoice(v)}
                    className={`h-10 min-w-10 rounded-lg border px-3 text-sm font-semibold transition ${
                      predictionChoice === v
                        ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-200"
                        : "border-white/15 text-white/70 hover:border-white/30"
                    }`}
                  >
                    {v}승
                  </button>
                ))}
              </div>
              {hiddenAvailable && (
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input type="checkbox" checked={useHidden} onChange={(e) => setUseHidden(e.target.checked)} className="h-4 w-4 accent-fuchsia-500" />
                  🙈 히든으로 제출 (게임당 1회, 9라운드 종료까지 비공개)
                </label>
              )}
              <button
                disabled={predictionChoice === null}
                onClick={() => {
                  if (predictionChoice === null) return;
                  onAction({ type: "predict", seat: viewerSeat, value: predictionChoice, hidden: useHidden });
                  setPredictionChoice(null);
                  setUseHidden(false);
                }}
                className="rounded-xl bg-fuchsia-600 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                예측 확정
              </button>
            </div>
          ) : (
            <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
              예측을 확정했습니다. 다른 플레이어들의 예측을 기다리는 중… ({submittedCount}/{PLAYER_COUNT})
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            {Array.from({ length: PLAYER_COUNT }, (_, seat) => {
              const visible = visibleCurrentPrediction(state, viewerSeat, seat);
              const submitted = round.predictions[seat] !== null;
              return (
                <span
                  key={seat}
                  className={`rounded-full border px-3 py-1 ${
                    submitted ? "border-white/20 text-white/70" : "border-white/10 text-white/30"
                  } ${!connectedSeats.has(seat) ? "opacity-40" : ""}`}
                >
                  {seatLabel(seat)}: {submitted ? (visible === "hidden" ? "🙈 히든" : `${visible}승`) : "예측 중…"}
                </span>
              );
            })}
          </div>
          {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
          {historyModal}
        </div>
        <PredictionStatusBoard state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} />
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing phase — one turn's card reveal
  // ---------------------------------------------------------------------
  const played = new Set(round.playsThisTurn.map((p) => p.seat));
  const myHand = round.hands[viewerSeat] ?? [];
  const myPlayed = played.has(viewerSeat);
  const isSimultaneous = round.roundNumber === 1;
  let actingSeat: SeatIndex | null = null;
  if (!isSimultaneous) {
    const startIdx = state.seatOrder.indexOf(round.turnLeader);
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const candidate = state.seatOrder[(startIdx + i) % PLAYER_COUNT];
      if (!played.has(candidate)) {
        actingSeat = candidate;
        break;
      }
    }
  }
  const myTurnToAct = isSimultaneous ? !myPlayed : actingSeat === viewerSeat;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="flex flex-1 flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">
            ROUND {R} — 턴 {round.turnNumber} / {R}
          </h2>
          <div className="flex gap-2">
            {historyButton}
            {rulebookButton}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
          <span>{isSimultaneous ? "전원 동시 공개" : `선공: ${seatLabel(round.turnLeader)}`}</span>
          <span className="flex flex-wrap gap-3">
            {Array.from({ length: PLAYER_COUNT }, (_, seat) => (
              <span key={seat} className="text-white/70">
                {seatLabel(seat)}: {round.winsThisRound[seat] ?? 0}승
              </span>
            ))}
          </span>
        </div>

        <div className="flex flex-wrap gap-3">
          {Array.from({ length: PLAYER_COUNT }, (_, seat) => {
            const p = round.playsThisTurn.find((x) => x.seat === seat);
            return (
              <div key={seat} className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-white/50">{seatLabel(seat)}</span>
                {p ? (
                  <CardFace card={p.card} size="md" />
                ) : (
                  <span className="grid h-14 w-10 place-items-center rounded-lg border border-dashed border-white/15 text-white/20">?</span>
                )}
              </div>
            );
          })}
        </div>

        {myTurnToAct ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-white/50">낼 카드를 선택하세요 (남은 손패 {myHand.length}장)</p>
            <div className="flex flex-wrap gap-2">
              {myHand.map((c) => (
                <CardFace key={c.id} card={c} size="md" interactive onClick={() => onAction({ type: "play", seat: viewerSeat, cardId: c.id })} className="hover:-translate-y-1" />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-white/40">{myPlayed ? "카드를 공개했습니다. 다른 플레이어를 기다리는 중…" : `${seatLabel(actingSeat!)}님의 차례를 기다리는 중…`}</p>
        )}

        {round.turnRecords.length > 0 && (
          <details className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/60">
            <summary className="cursor-pointer select-none text-white/70">이전 턴 기록 ({round.turnRecords.length}턴)</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {round.turnRecords.map((t) => (
                <li key={t.turnNumber}>
                  턴 {t.turnNumber}: {seatLabel(t.winnerSeat)} 승리 {t.reverseActive ? "(리버스 발동)" : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
        {historyModal}
      </div>
      <PredictionStatusBoard state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} />
    </div>
  );
}
