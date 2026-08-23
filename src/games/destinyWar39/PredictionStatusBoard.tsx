"use client";

import { useState } from "react";
import { HiddenActivationBadge } from "./DestinyWar39Effects";
import { visibleCurrentPrediction, type DestinyWar39State, type EngineAction, type SeatIndex } from "./engine";

export interface PredictionStatusBoardProps {
  state: DestinyWar39State;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
}

/**
 * Right-side "prediction only" panel content — shared by the desktop
 * `<aside>` and the mobile drawer. Score has been split out entirely into
 * `RankedLeaderboard` (left); this panel is scoped purely to the active
 * round's win-count prediction: submitting your own, and everyone's
 * prediction vs. actual tricks won so far. When it's the predicting phase
 * and the viewer hasn't submitted yet, the picker itself lives here (moved
 * out of `DestinyWar39Board`'s center column) so the prediction action and
 * its status live in the same place.
 */
function PredictionContent({ state, viewerSeat, names, connectedSeats, onAction }: PredictionStatusBoardProps) {
  const round = state.round;
  const R = round.roundNumber;
  const myPlayer = state.players.find((p) => p.seat === viewerSeat)!;
  const alreadySubmitted = round.predictions[viewerSeat] !== null;
  const hiddenAvailable = !myPlayer.hiddenUsed;
  const submittedCount = Object.values(round.predictions).filter((v) => v !== null).length;

  const [predictionChoice, setPredictionChoice] = useState<number | null>(null);
  const [useHidden, setUseHidden] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {state.phase === "predicting" &&
        (!alreadySubmitted ? (
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[11px] text-white/50">이번 라운드 몇 승을 예측하시나요? (0~{R})</p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: R + 1 }, (_, v) => v).map((v) => (
                <button
                  key={v}
                  onClick={() => setPredictionChoice(v)}
                  className={`h-9 min-w-9 rounded-lg border px-2.5 text-xs font-semibold transition ${
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
              <label className="flex items-center gap-2 text-[11px] text-white/60">
                <input
                  type="checkbox"
                  checked={useHidden}
                  onChange={(e) => setUseHidden(e.target.checked)}
                  className="h-3.5 w-3.5 accent-fuchsia-500"
                />
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
              className="rounded-lg bg-fuchsia-600 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              예측 확정
            </button>
          </div>
        ) : (
          <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
            예측을 확정했습니다. 다른 플레이어들을 기다리는 중… ({submittedCount}/{state.playerCount})
          </p>
        ))}

      <div className="flex flex-col gap-1.5">
        {Array.from({ length: state.playerCount }, (_, seat) => {
          const isMe = seat === viewerSeat;
          const player = state.players.find((p) => p.seat === seat)!;
          const visible = visibleCurrentPrediction(state, viewerSeat, seat);
          const current = round.winsThisRound[seat] ?? 0;
          const submitted = visible !== "pending";
          // Revealed-to-me numeric value, or null while it's still blind
          // ("submitted"/"hidden") — "doomed"/"on target" would themselves
          // leak a masked prediction's progress toward its (still-secret)
          // target, so both stay unset until `visible` is an actual number
          // (own row, or an opponent's once their non-hidden prediction
          // reveals at the round's first trick — see engine.ts's
          // `visibleCurrentPrediction` doc). "Doomed"/"on target" are only
          // ever provable mid-round in one direction: actual wins can only
          // go up, so once it passes the prediction that prediction can
          // never come true again this round. Landing exactly on it is
          // promising but not final until the round actually ends (more
          // turns could still push it past).
          const revealedValue = typeof visible === "number" ? visible : null;
          const exceeded = revealedValue !== null && current > revealedValue;
          const onTarget = revealedValue !== null && current === revealedValue;
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
                {/* Round-scoped, NOT `player.hiddenUsed` alone (2026-08-23 confirmed answer) — the lifetime
                    once-per-game token itself never resets (engine.ts), but this badge is a one-round
                    spotlight on which round it was spent, not a running "already used" scoreboard: it
                    shows only while `round.roundNumber` still matches `hiddenRound`, and disappears the
                    moment `nextRound` advances past it, never to reappear this game. */}
                {player.hiddenRound === round.roundNumber && <HiddenActivationBadge title="이번 라운드 히든 사용 중" />}
              </div>
              <div className="flex items-center justify-between text-white/60">
                <span>
                  예측 {visible === "pending" ? "?" : visible === "submitted" ? "완료" : visible === "hidden" ? "🙈" : `${visible}승`} / 현재{" "}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PredictionStatusBoard(props: PredictionStatusBoardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Desktop: always-visible fixed column beside the board. */}
      <aside className="hidden max-h-[70vh] w-64 shrink-0 flex-col gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:flex">
        <h3 className="px-1 text-xs font-semibold tracking-wide text-white/50 uppercase">🎯 승수 예측</h3>
        <PredictionContent {...props} />
      </aside>

      {/* Mobile/tablet: collapsed edge tab that opens a slide-in drawer. */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="승수 예측 패널 열기"
        className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-fuchsia-400/30 bg-[#1c0f28] px-1.5 py-3 text-[10px] font-semibold text-fuchsia-200 shadow-lg lg:hidden"
      >
        <span className="text-base">🎯</span>
        <span className="[writing-mode:vertical-rl]">예측</span>
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <div className="relative flex h-full w-[85vw] max-w-sm flex-col gap-2 overflow-y-auto border-l border-white/10 bg-[#1c0f28] p-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-white/50 uppercase">🎯 승수 예측</h3>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="닫기"
                className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30 hover:text-white"
              >
                ✕
              </button>
            </div>
            <PredictionContent {...props} />
          </div>
        </div>
      )}
    </>
  );
}
