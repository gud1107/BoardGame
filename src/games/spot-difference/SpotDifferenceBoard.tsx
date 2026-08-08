"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import PhotoStageCanvas from "./PhotoStageCanvas";
import SpotDifferenceScene from "./SpotDifferenceScene";
import { applySceneDiffs, BUILTIN_SCENES } from "./scenes";
import {
  computeTeamRankings,
  computeTeamScores,
  foundSpotCount,
  totalSpotCount,
  type EngineAction,
  type PhotoDiffSpot,
  type SeatIndex,
  type SpotDifferenceState,
  type TeamId,
} from "./engine";

export interface SpotDifferenceBoardProps {
  state: SpotDifferenceState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const TEAM_STYLE: Record<TeamId, { label: string; accent: string; bg: string; ring: string }> = {
  A: { label: "팀 A", accent: "text-sky-300", bg: "bg-sky-500/15 border-sky-400/40", ring: "ring-sky-400" },
  B: { label: "팀 B", accent: "text-rose-300", bg: "bg-rose-500/15 border-rose-400/40", ring: "ring-rose-400" },
};

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other board in this project (AvalonBoard/NoThanksBoard/GridPokerBoard):
 * state comes entirely from props, every click only ever emits an
 * `EngineAction` via `onAction`. The wrong-click lockout countdown and the
 * match timer are the only genuinely local (non-authoritative) bits of
 * state, matching the useCountdown.ts convention documented in engine.ts.
 */
export default function SpotDifferenceBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: SpotDifferenceBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(state.timerSeconds);
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const timeUpSentRef = useRef(false);
  const prevPenaltyRef = useRef<number | undefined>(state.penalties[viewerSeat]);
  const prevFoundIdsRef = useRef<Set<string>>(new Set());

  const myTeam = state.teamOf[viewerSeat];
  const stage = state.stages[state.currentStageIndex];

  // Local match clock — ticks down independently on every device (small
  // drift is harmless UX, not a consensus mechanism) and, on expiry, emits
  // one `timeUp` action. Idempotent on the engine side, so it's safe even
  // if several clients' clocks cross zero within the same second.
  useEffect(() => {
    if (state.phase !== "playing") return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 0) return 0;
        if (t === 1 && !timeUpSentRef.current) {
          timeUpSentRef.current = true;
          onAction({ type: "timeUp" });
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state.phase, onAction]);

  // Redraws the "locked out" countdown on the viewer's own click smoothly.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Detects a *new* penalty landing on this seat (vs. the click that caused
  // it) to fire the wrong-answer flash/buzz exactly once per miss.
  useEffect(() => {
    const current = state.penalties[viewerSeat];
    if (current !== undefined && current !== prevPenaltyRef.current) {
      getSoundEngine().playWrongBuzz();
      setFlash("wrong");
      const id = setTimeout(() => setFlash(null), 400);
      prevPenaltyRef.current = current;
      return () => clearTimeout(id);
    }
    prevPenaltyRef.current = current;
  }, [state.penalties, viewerSeat]);

  // Detects any newly-found spot (by any team) to play the correct-answer
  // chime — a shared match event everyone should hear, not just the finder.
  useEffect(() => {
    if (!stage) return;
    const currentIds = new Set(Object.keys(stage.foundBy));
    let isNew = false;
    for (const id of currentIds) if (!prevFoundIdsRef.current.has(id)) isNew = true;
    if (isNew && prevFoundIdsRef.current.size > 0) {
      getSoundEngine().playCorrectDing();
      setFlash("correct");
      setTimeout(() => setFlash(null), 350);
    }
    prevFoundIdsRef.current = currentIds;
  }, [stage]);

  if (!stage || !myTeam) return null;

  const scores = computeTeamScores(state);
  const remaining = totalSpotCount(state) - foundSpotCount(state);
  const lockedUntil = state.penalties[viewerSeat];
  const isLocked = lockedUntil !== undefined && now < lockedUntil;
  const lockSecondsLeft = isLocked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (state.phase !== "playing" || isLocked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    getSoundEngine().unlock();
    onAction({ type: "click", seat: viewerSeat, xPct, yPct, atMs: Date.now() });
  }

  function handleUseHint() {
    if (!myTeam || state.hints[myTeam] <= 0) return;
    onAction({ type: "useHint", team: myTeam, atMs: Date.now() });
  }

  const activeHintSpot =
    state.activeHint && state.activeHint.team === myTeam
      ? stage.spots.find((s) => s.id === state.activeHint!.spotId)
      : undefined;

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const ranked = computeTeamRankings(state);
    const winners = ranked.filter((r) => r.rank === 1);
    const tied = winners.length > 1;
    return (
      <div className="flex flex-col items-center gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">{tied ? "🤝" : "🏆"}</span>
        <h2 className="text-lg font-bold text-white">
          {tied ? "무승부! 두 팀 모두 잘 찾았어요" : `${TEAM_STYLE[winners[0].team].label} 승리!`}
        </h2>
        <p className="text-sm text-white/50">
          {state.timeUp ? "제한 시간 종료" : "모든 틀린 곳을 다 찾았어요"} · 총 {totalSpotCount(state)}개 중{" "}
          {foundSpotCount(state)}개 발견
        </p>
        <div className="grid w-full max-w-sm grid-cols-2 gap-3">
          {(["A", "B"] as TeamId[]).map((team) => (
            <div
              key={team}
              className={`rounded-2xl border p-4 ${TEAM_STYLE[team].bg} ${winners.some((w) => w.team === team) ? "ring-2 " + TEAM_STYLE[team].ring : ""}`}
            >
              <p className={`text-xs font-semibold ${TEAM_STYLE[team].accent}`}>{TEAM_STYLE[team].label}</p>
              <p className="mt-1 text-3xl font-bold text-white">{scores[team]}</p>
              <p className="mt-1 text-[11px] text-white/40">
                {Object.entries(state.teamOf)
                  .filter(([, t]) => t === team)
                  .map(([seat]) => names[Number(seat)] ?? `${Number(seat) + 1}번`)
                  .join(", ")}
              </p>
            </div>
          ))}
        </div>
        <button
          onClick={onGameEnd}
          className="rounded-full bg-fuchsia-500 px-8 py-3 font-medium text-white transition hover:bg-fuchsia-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex gap-2">
          {(["A", "B"] as TeamId[]).map((team) => (
            <div
              key={team}
              className={`rounded-xl border px-3 py-1.5 ${TEAM_STYLE[team].bg} ${team === myTeam ? "ring-1 " + TEAM_STYLE[team].ring : ""}`}
            >
              <p className={`text-[10px] font-semibold ${TEAM_STYLE[team].accent}`}>
                {TEAM_STYLE[team].label}
                {team === myTeam && " (나)"}
              </p>
              <p className="text-lg font-bold text-white leading-tight">{scores[team]}</p>
            </div>
          ))}
        </div>
        <div className="text-center">
          <p className="text-[10px] text-white/40">남은 차이</p>
          <p className="text-lg font-bold text-white">{remaining}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-white/40">남은 시간</p>
          <p className={`text-lg font-bold tabular-nums ${timeLeft <= 10 ? "text-rose-400" : "text-white"}`}>
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
          </p>
        </div>
        <button
          onClick={() => setRulebookOpen(true)}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:border-white/30"
        >
          📖 룰북
        </button>
      </div>

      {state.stages.length > 1 && (
        <p className="text-center text-xs text-white/40">
          스테이지 {state.currentStageIndex + 1} / {state.stages.length}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-white/50">
          {isLocked ? (
            <span className="text-rose-300">🔒 오답! {lockSecondsLeft}초 후 다시 클릭할 수 있어요</span>
          ) : (
            "양쪽 그림에서 다른 부분을 찾아 클릭하세요"
          )}
        </p>
        <button
          onClick={handleUseHint}
          disabled={state.hints[myTeam] <= 0}
          className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:border-amber-400/70 disabled:cursor-not-allowed disabled:opacity-30"
        >
          💡 힌트 ({state.hints[myTeam]}남음)
        </button>
      </div>

      <div
        className={`grid grid-cols-1 gap-3 sm:grid-cols-2 transition ${
          flash === "wrong" ? "ring-2 ring-rose-500" : flash === "correct" ? "ring-2 ring-emerald-400" : ""
        } rounded-2xl`}
      >
        <StagePanel
          state={state}
          stage={stage}
          variant="original"
          onClick={handleClick}
          activeHintSpot={activeHintSpot}
          isLocked={isLocked}
        />
        <StagePanel
          state={state}
          stage={stage}
          variant="modified"
          onClick={handleClick}
          activeHintSpot={activeHintSpot}
          isLocked={isLocked}
        />
      </div>

      <p className="text-center text-[11px] text-white/30">
        {Array.from({ length: state.playerCount }, (_, seat) => seat)
          .map((seat) => `${names[seat] ?? `${seat + 1}번`}${connectedSeats.has(seat) ? "" : "(연결끊김)"}`)
          .join(" · ")}
      </p>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

function StagePanel({
  state,
  stage,
  variant,
  onClick,
  activeHintSpot,
  isLocked,
}: {
  state: SpotDifferenceState;
  stage: SpotDifferenceState["stages"][number];
  variant: "original" | "modified";
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  activeHintSpot: { xPct: number; yPct: number; rPct: number } | undefined;
  isLocked: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 ${
        isLocked ? "cursor-not-allowed" : "cursor-crosshair"
      }`}
    >
      {state.source.kind === "photo" ? (
        <PhotoStageCanvas
          imageDataUrl={state.source.imageDataUrl}
          spots={stage.spots as PhotoDiffSpot[]}
          variant={variant}
          className="h-full w-full object-contain"
        />
      ) : (
        <BuiltinStagePanel sceneId={sceneIdForStage(state)} variant={variant} className="h-full w-full" />
      )}

      {/* Found-spot markers */}
      {stage.spots
        .filter((s) => stage.foundBy[s.id])
        .map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)] animate-[spot-diff-pop_0.35s_ease-out]"
            style={{
              left: `${s.xPct}%`,
              top: `${s.yPct}%`,
              width: `${s.rPct * 2}%`,
              height: `${s.rPct * 2}%`,
            }}
          />
        ))}

      {/* Active team hint wiggle */}
      {activeHintSpot && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-amber-300 animate-[spot-diff-wiggle_0.6s_ease-in-out_infinite]"
          style={{
            left: `${activeHintSpot.xPct}%`,
            top: `${activeHintSpot.yPct}%`,
            width: `${activeHintSpot.rPct * 2.4}%`,
            height: `${activeHintSpot.rPct * 2.4}%`,
          }}
        />
      )}
    </div>
  );
}

function sceneIdForStage(state: SpotDifferenceState): string {
  return state.builtinSceneIds[state.currentStageIndex] ?? state.builtinSceneIds[0];
}

function BuiltinStagePanel({ sceneId, variant, className }: { sceneId: string; variant: "original" | "modified"; className?: string }) {
  const scene = BUILTIN_SCENES.find((s) => s.id === sceneId);
  if (!scene) return null;
  const shapes = variant === "original" ? scene.shapes : applySceneDiffs(scene.shapes, scene.diffs);
  return <SpotDifferenceScene shapes={shapes} background={scene.background} className={className} />;
}
