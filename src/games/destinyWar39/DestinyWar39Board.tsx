"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import RulebookModal from "./RulebookModal";
import PredictionStatusBoard from "./PredictionStatusBoard";
import RankedLeaderboard from "./RankedLeaderboard";
import LastRoundHistoryModal from "./LastRoundHistoryModal";
import { CardFace } from "./CardFace";
import { HiddenRevealCell, PlayedCardSlot, ReverseSwishOverlay, RoundResultBadge, TurnOrderBadge, type RoundOutcome } from "./DestinyWar39Effects";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { TOTAL_ROUNDS, type DestinyWar39State, type EngineAction, type SeatIndex, type TurnRecord } from "./engine";

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

/** Duration of the global screen judder a Death card triggers on landing (see `screenShake` below) — 8px/200ms, this session's confirmed answer, matched against `destinywar39-death-impact-shake` in globals.css. */
const DEATH_SHAKE_MS = 200;

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state per this project's
 * lockstep trust model; hidden-prediction secrecy for the round STILL in
 * progress is enforced only here, at render time, via
 * `visibleCurrentPrediction` (PredictionStatusBoard.tsx). Once a round ends
 * its hidden predictions are public (rulebook §8, updated 2026-09-03) — the
 * roundEnd table below shows every seat's real prediction unmasked, wrapped
 * in `HiddenRevealCell` purely for the unveil flourish, not for redaction.
 *
 * Layout is a persistent 3-column shell: `RankedLeaderboard` (left) is
 * mounted across every phase — it owns cumulative score exclusively, with
 * its own count-up/floating-delta/rank-reorder effects reacting whenever the
 * underlying totals change. The center column below is phase-specific
 * (`centerContent`). `PredictionStatusBoard` (right) is scoped to the active
 * round like before and owns the prediction picker itself now, so it only
 * mounts during predicting/playing (`showPredictionPanel`).
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

  const round = state.round;
  const R = round.roundNumber;
  const playerCount = state.playerCount;

  // Freeze-frame the trick that just resolved (winner glowing) for
  // TRICK_REVEAL_MS before letting the next turn / round-end summary render
  // — fixes tricks flashing by unseen the instant the 5th card lands. Fires
  // whenever `round.turnRecords` grows *within the same round*; a round
  // change resets turnRecords to a shorter array and must NOT be mistaken
  // for a resolved trick.
  const [resolvingTurn, setResolvingTurn] = useState<TurnRecord | null>(null);
  // Screen-wide border swish the instant a turn resolves with reverse active
  // (see DestinyWar39Effects.tsx's `ReverseSwishOverlay` doc) — tied to the
  // SAME "a turn just resolved" signal as `resolvingTurn` below, not to any
  // individual reverse card landing, since reverse parity is a whole-turn
  // property (two reverse cards in one turn cancel out, rulebook §6.1).
  const [reverseSwish, setReverseSwish] = useState(false);
  const prevRoundNumberRef = useRef(round.roundNumber);
  const prevTurnCountRef = useRef(round.turnRecords.length);
  // `useLayoutEffect`, NOT `useEffect` — this is the fix for played cards
  // appearing to vanish the instant the turn's last card lands (2026-08-22
  // "필드 카드 유지" bug report). The state update that clears
  // `round.playsThisTurn` and grows `turnRecords` (engine.ts's
  // `resolveTurnAndAdvance`) arrives as a single prop change, so THIS
  // component's very first render of it already has an empty
  // `playsThisTurn` — with a plain `useEffect`, that empty-table frame gets
  // painted to the screen before the effect (which runs after paint) has a
  // chance to set `resolvingTurn` and show the freeze-frame, i.e. every
  // submitted card genuinely flashes to blank for one frame. `useLayoutEffect`
  // fires synchronously after the DOM update but before the browser paints,
  // so the corrective `setResolvingTurn` re-render is flushed into the SAME
  // paint — the user only ever sees the freeze-frame, never the empty
  // in-between state. Same convention this game's own `RankedLeaderboard.tsx`
  // already uses for its count-up/reorder effects.
  useLayoutEffect(() => {
    const roundChanged = round.roundNumber !== prevRoundNumberRef.current;
    const turnCountGrew = !roundChanged && round.turnRecords.length > prevTurnCountRef.current;
    prevRoundNumberRef.current = round.roundNumber;
    prevTurnCountRef.current = round.turnRecords.length;
    // 카드 드로우 휙 소리 — 새 라운드가 시작되어 예측 카드가 새로 돌아가는 순간 (2026-08-26 세션).
    if (roundChanged) getSoundEngine().playCardDrawWhoosh();
    if (!turnCountGrew) return;
    const justResolved = round.turnRecords[round.turnRecords.length - 1];
    setResolvingTurn(justResolved);
    setReverseSwish(justResolved.reverseActive);
    // 리버스 역재생 스파크 — 이 턴에 리버스가 실제로 발동했을 때만.
    if (justResolved.reverseActive) getSoundEngine().playReverseSpark();
    const timer = setTimeout(() => setResolvingTurn(null), TRICK_REVEAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.roundNumber, round.turnRecords.length]);

  // Global screen judder the instant ANY seat reveals a Death card in the
  // live "playing" phase (see globals.css's `destinywar39-death-impact-shake`
  // doc) — fires on the reveal itself, not on turn resolution, since playing
  // a Death card is never cancelled/undone by anything else landing the same
  // turn (unlike the reverse swirl below, which does wait for resolution).
  const [screenShake, setScreenShake] = useState(false);
  const prevPlaysCountRef = useRef(round.playsThisTurn.length);
  useEffect(() => {
    const grew = round.playsThisTurn.length > prevPlaysCountRef.current;
    prevPlaysCountRef.current = round.playsThisTurn.length;
    const justPlayedDeath = grew && round.playsThisTurn[round.playsThisTurn.length - 1].card.kind === "death";
    // Unconditional setState (not `if (justPlayedDeath) setScreenShake(true)`)
    // — same react-hooks/set-state-in-effect fix the reverseSwish effect
    // above already needed (see HANDOFF.md's destinyWar39 session).
    setScreenShake(justPlayedDeath);
    if (!justPlayedDeath) return;
    // 데스 카드 페널티음(STATUS_EFFECT 매핑 — AskUserQuestion으로 확정, 2026-08-27 세션 오후) — 화면 흔들림과 같은 타이밍.
    getSoundEngine().playDeathCardSting();
    const timer = setTimeout(() => setScreenShake(false), DEATH_SHAKE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.playsThisTurn.length]);

  // 라운드 승리/패배음 — `roundEnd` 진입 시점에 1회, 뷰어 본인의 이번 라운드
  // 점수 부호(+/-)로 판정(AskUserQuestion으로 확정, 2026-08-27 세션 오후).
  // 이 게임은 트릭마다의 승패가 아니라 예측 적중률 기반 점수제이므로, 0점
  // 이하(예측=0 실패 포함)는 LOSE로 취급.
  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const enteredRoundEnd = state.phase === "roundEnd" && prevPhaseRef.current !== "roundEnd";
    prevPhaseRef.current = state.phase;
    if (!enteredRoundEnd) return;
    const idx = round.roundNumber - 1;
    const myScore = state.players.find((p) => p.seat === viewerSeat)?.scores[idx] ?? 0;
    if (myScore > 0) getSoundEngine().playPredictionWin();
    else getSoundEngine().playPredictionLose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

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

  let centerContent: ReactNode;
  let showPredictionPanel = false;
  // "카드 배틀/트릭 제출" 턴 전환 시에만 <MyTurnOverlay>를 띄운다(예측 단계는
  // 턴 순서 없이 각자 알아서 예측하므로 대상 아님, 요청 범위 그대로). 아래
  // "playing phase" 분기에서만 실제 값으로 갱신.
  let isMyBattleTurn = false;

  // ---------------------------------------------------------------------
  // Trick just resolved — freeze-frame it (winner glowing) before showing
  // whatever comes next (next turn, round-end summary, or final results).
  // Pre-empts every phase branch below on purpose.
  // ---------------------------------------------------------------------
  if (resolvingTurn) {
    const t = resolvingTurn;
    centerContent = (
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
          {Array.from({ length: playerCount }, (_, seat) => {
            const p = t.plays.find((x) => x.seat === seat);
            if (!p) return null;
            const isWinner = seat === t.winnerSeat;
            return (
              <div key={seat} className="flex flex-col items-center gap-1.5">
                <span className={`text-xs ${isWinner ? "font-bold text-amber-200" : "text-white/50"}`}>
                  {seatLabel(seat)}
                  {isWinner ? " 🏆" : ""}
                </span>
                <PlayedCardSlot
                  key={p.card.id}
                  card={p.card}
                  playerCount={playerCount}
                  size="lg"
                  reverseActiveThisTurn={t.reverseActive}
                  className={isWinner ? "scale-110 ring-4 ring-amber-300/70 shadow-[0_0_25px_rgba(252,211,77,0.55)]" : ""}
                />
              </div>
            );
          })}
        </div>
        <p className="text-center text-sm font-semibold text-amber-200">{seatLabel(t.winnerSeat)}님이 이 턴을 가져갔습니다!</p>
      </div>
    );
  } else if (state.phase === "gameOver") {
    // ---------------------------------------------------------------------
    // Game over
    // ---------------------------------------------------------------------
    const winners = state.finalRankings!.filter((r) => r.rank === 1).map((r) => names[r.seat]);
    centerContent = (
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
                          {player.hidden[i] ? <HiddenRevealCell>{player.predictions[i]}</HiddenRevealCell> : player.predictions[i]}→{player.actualWins[i]}
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
  } else if (state.phase === "roundEnd") {
    // ---------------------------------------------------------------------
    // Round-end summary
    // ---------------------------------------------------------------------
    centerContent = (
      // Keyed by round number so every round-end visit remounts fresh —
      // required for RoundResultBadge's mount-only confetti/stamp to replay
      // each round instead of only ever firing once for round 1's table.
      <div key={`round-end-${round.roundNumber}`} className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
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
                const wasHidden = p.hidden[idx];
                const predicted = p.predictions[idx]!;
                const actual = p.actualWins[idx]!;
                const success = predicted === actual;
                const outcome: RoundOutcome = success ? "success" : actual > predicted ? "over" : "under";
                const outcomeLabel = success ? "성공" : outcome === "over" ? "초과" : "미달";
                const outcomeClass = success ? "text-emerald-400" : outcome === "over" ? "text-orange-300" : "text-sky-300";
                return (
                  <tr key={p.seat} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-medium text-white/90">{seatLabel(p.seat)}</td>
                    <td className="px-2 py-1.5 text-center text-white/70">
                      {wasHidden ? <HiddenRevealCell>{predicted}</HiddenRevealCell> : predicted}
                    </td>
                    <td className="px-2 py-1.5 text-center text-white/70">{actual}</td>
                    <td className={`px-2 py-1.5 text-center font-semibold ${outcomeClass}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {outcomeLabel}
                        <RoundResultBadge outcome={outcome} />
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-white/80">
                      {(p.scores[idx] ?? 0) >= 0 ? "+" : ""}
                      {p.scores[idx]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-center text-[11px] text-white/40">누적 순위는 좌측 랭킹판에서 실시간으로 확인할 수 있어요.</p>
        <button
          onClick={() => onAction({ type: "nextRound", seed: randomSeed() })}
          className="w-full rounded-xl bg-fuchsia-600 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
        >
          {round.roundNumber < TOTAL_ROUNDS ? `ROUND ${round.roundNumber + 1} 시작` : "최종 결과 보기"}
        </button>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} playerCount={playerCount} />}
        {historyModal}
      </div>
    );
  } else if (state.phase === "predicting") {
    // ---------------------------------------------------------------------
    // Predicting phase — hand only; the picker itself now lives in the
    // right-side PredictionStatusBoard panel (see module doc above).
    // ---------------------------------------------------------------------
    showPredictionPanel = true;
    centerContent = (
      <div className="flex flex-1 flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">ROUND {R} — 예측</h2>
          <div className="flex gap-2">
            {historyButton}
            {rulebookButton}
          </div>
        </div>
        <p className="text-xs text-white/50">
          이번 라운드는 {R}턴 진행됩니다. 손패 {R}장을 확인하고, 우측 예측 패널에서 이번 라운드에 몇 번 이길지 예측하세요 (0~{R}).
        </p>
        <div className="flex flex-wrap gap-2.5">
          {round.hands[viewerSeat].map((c) => (
            <CardFace key={c.id} card={c} playerCount={playerCount} size="md" />
          ))}
        </div>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} playerCount={playerCount} />}
        {historyModal}
      </div>
    );
  } else {
    // ---------------------------------------------------------------------
    // Playing phase — one turn's card reveal
    // ---------------------------------------------------------------------
    showPredictionPanel = true;
    const played = new Set(round.playsThisTurn.map((p) => p.seat));
    const myHand = round.hands[viewerSeat] ?? [];
    const myPlayed = played.has(viewerSeat);
    const isSimultaneous = round.roundNumber === 1;
    // Turn-order badges (①②③…) and the currently-acting seat, both derived
    // from the same clockwise-from-turnLeader rotation — round 1 gets
    // neither: it's a simultaneous reveal with no lead player at all
    // (engine.ts's `nextToActInTurn` doc), so a numbered sequence would
    // contradict the rule itself (this session's confirmed answer).
    let actingSeat: SeatIndex | null = null;
    let turnOrderBySeat: Record<SeatIndex, number> | null = null;
    if (!isSimultaneous) {
      const startIdx = state.seatOrder.indexOf(round.turnLeader);
      turnOrderBySeat = {};
      for (let i = 0; i < playerCount; i++) {
        const seat = state.seatOrder[(startIdx + i) % playerCount];
        turnOrderBySeat[seat] = i + 1;
        if (actingSeat === null && !played.has(seat)) actingSeat = seat;
      }
    }
    const myTurnToAct = isSimultaneous ? !myPlayed : actingSeat === viewerSeat;
    isMyBattleTurn = myTurnToAct;

    centerContent = (
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
            {Array.from({ length: playerCount }, (_, seat) => (
              <span key={seat} className="text-white/70">
                {seatLabel(seat)}: {round.winsThisRound[seat] ?? 0}승
              </span>
            ))}
          </span>
        </div>

        <div className="flex flex-wrap gap-3">
          {Array.from({ length: playerCount }, (_, seat) => {
            const p = round.playsThisTurn.find((x) => x.seat === seat);
            const order = turnOrderBySeat?.[seat] ?? null;
            const isActingSeat = actingSeat === seat;
            return (
              <div key={seat} className="flex flex-col items-center gap-1">
                {order !== null && <TurnOrderBadge order={order} isActive={isActingSeat} isDone={!!p} />}
                <span className="text-[11px] text-white/50">{seatLabel(seat)}</span>
                {p ? (
                  <PlayedCardSlot key={p.card.id} card={p.card} playerCount={playerCount} size="sm" />
                ) : (
                  <span
                    className={`grid h-[84px] w-[60px] place-items-center rounded-lg border border-dashed text-2xl text-white/20 ${isActingSeat ? "border-amber-300/70" : "border-white/15"}`}
                    style={isActingSeat ? { animation: "destinywar39-turn-badge-pulse 1.1s ease-in-out infinite" } : undefined}
                  >
                    ?
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {myTurnToAct ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-white/50">낼 카드를 선택하세요 (남은 손패 {myHand.length}장)</p>
            <div className="flex flex-wrap gap-2.5">
              {myHand.map((c) => (
                <CardFace
                  key={c.id}
                  card={c}
                  playerCount={playerCount}
                  size="md"
                  interactive
                  onClick={() => {
                    const engine = getSoundEngine();
                    engine.unlock();
                    engine.playCardSubmitImpact();
                    onAction({ type: "play", seat: viewerSeat, cardId: c.id });
                  }}
                  // Pop-up scale on touch/hover/keyboard-focus instead of fan-out
                  // overlap (this session's confirmed answer) — cards stay laid
                  // out in a plain wrapping row, but the one under the
                  // finger/cursor jumps up and grows so it's easy to confirm
                  // which card is about to be played on small touch screens.
                  className="hover:z-20 hover:-translate-y-3 hover:scale-125 active:z-20 active:-translate-y-3 active:scale-125 focus-visible:z-20 focus-visible:-translate-y-3 focus-visible:scale-125"
                />
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
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} playerCount={playerCount} />}
        {historyModal}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4"
      style={screenShake ? { animation: "destinywar39-death-impact-shake 200ms ease-in-out" } : undefined}
    >
      <MyTurnOverlay isMyTurn={isMyBattleTurn} />
      <RankedLeaderboard state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} />
      <div className="flex min-w-0 flex-1 flex-col gap-5">{centerContent}</div>
      {showPredictionPanel && (
        <PredictionStatusBoard state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} onAction={onAction} />
      )}
      {reverseSwish && <ReverseSwishOverlay onDone={() => setReverseSwish(false)} />}
    </div>
  );
}
