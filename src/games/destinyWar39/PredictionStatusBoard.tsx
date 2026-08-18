"use client";

import { PLAYER_COUNT, visibleCurrentPrediction, type DestinyWar39State, type SeatIndex } from "./engine";

export interface PredictionStatusBoardProps {
  state: DestinyWar39State;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
}

/**
 * Right-side "at a glance" panel shown during predicting/playing: everyone's
 * this-round prediction vs actual tricks won so far, plus cumulative score
 * and lifetime hidden-token status. Purely a read-projection over the same
 * state `DestinyWar39Board` already renders — reuses `visibleCurrentPrediction`
 * so a hidden prediction never leaks here either.
 */
export default function PredictionStatusBoard({ state, viewerSeat, names, connectedSeats }: PredictionStatusBoardProps) {
  const round = state.round;
  return (
    <aside className="flex w-full shrink-0 flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:w-64">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-white/50 uppercase">예측 현황</h3>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: PLAYER_COUNT }, (_, seat) => {
          const isMe = seat === viewerSeat;
          const player = state.players.find((p) => p.seat === seat)!;
          const total = player.scores.reduce((sum: number, v) => sum + (v ?? 0), 0);
          const predicted = round.predictions[seat];
          const visible = visibleCurrentPrediction(state, viewerSeat, seat);
          const current = round.winsThisRound[seat] ?? 0;
          const submitted = predicted !== null;
          // "Doomed"/"on target" are only ever provable mid-round in one
          // direction: actual wins can only go up, so once it passes the
          // prediction that prediction can never come true again this
          // round. Landing exactly on it is promising but not final until
          // the round actually ends (more turns could still push it past).
          const exceeded = submitted && current > predicted;
          const onTarget = submitted && current === predicted;
          return (
            <div
              key={seat}
              className={`flex flex-col gap-1 rounded-xl border px-2.5 py-2 text-xs transition ${
                isMe ? "border-fuchsia-400/40 bg-fuchsia-500/10" : "border-white/10 bg-white/[0.02]"
              } ${!connectedSeats.has(seat) ? "opacity-40" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate font-semibold ${isMe ? "text-fuchsia-200" : "text-white/85"}`}>
                  {names[seat]}
                  {isMe ? " (나)" : ""}
                </span>
                {player.hiddenUsed && (
                  <span title={player.hiddenRound === round.roundNumber ? "이번 라운드 히든 사용 중" : "히든 사용 완료"}>🙈</span>
                )}
              </div>
              <div className="flex items-center justify-between text-white/60">
                <span>
                  예측 {submitted ? (visible === "hidden" ? "🙈" : `${visible}승`) : "…"} / 현재{" "}
                  <b className={onTarget ? "text-emerald-300" : exceeded ? "text-rose-300" : "text-white/80"}>{current}승</b>
                </span>
                {state.phase === "playing" && submitted && (
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      onTarget ? "bg-emerald-400/20 text-emerald-200" : exceeded ? "bg-rose-400/20 text-rose-200" : "bg-white/10 text-white/50"
                    }`}
                  >
                    {onTarget ? "적중 중" : exceeded ? "초과" : "진행 중"}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-white/50">
                <span>누적 점수</span>
                <b className="text-white/90">{total}</b>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
