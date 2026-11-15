"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { STAGE_KIND_META } from "./bonusRounds";
import { getSpotSound } from "./spotSound";
import SpotSoundHud from "./SpotSoundHud";
import StageClearFx, { STAGE_CLEAR_FX_MS } from "./StageClearFx";
import RulebookModal from "./RulebookModal";
import PhotoStageCanvas from "./PhotoStageCanvas";
import DiffRevealPanel from "./DiffRevealPanel";
import ThemeSceneArt from "./ThemeSceneArt";
import { activeThemeMutationIds } from "./themeScenes";
import {
  computeTeamRankings,
  computeTeamScores,
  FADE_FULL_MS,
  foundSpotCount,
  MEMORY_PREVIEW_MS,
  stageKind,
  totalSpotCount,
  type StageResult,
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
  A: {
    label: "팀 A",
    accent: "text-sky-300 light:text-sky-600",
    bg: "bg-sky-500/15 border-sky-400/40 light:bg-sky-50 light:border-sky-300",
    ring: "ring-sky-400",
  },
  B: {
    label: "팀 B",
    accent: "text-rose-300 light:text-rose-600",
    bg: "bg-rose-500/15 border-rose-400/40 light:bg-rose-50 light:border-rose-300",
    ring: "ring-rose-400",
  },
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
  const prevFoundRef = useRef<{ total: number; stageIndex: number; mine: number } | null>({
    total: foundSpotCount(state),
    stageIndex: state.currentStageIndex,
    mine: state.teamOf[viewerSeat] ? computeTeamScores(state)[state.teamOf[viewerSeat]] : 0,
  });
  // Other seats' (bots included) wrong clicks, shown as a brief ❌ where they
  // landed. Keyed off local arrival time, not the clicker's clock, so device
  // clock skew can't hide or linger the marker.
  const [missMarks, setMissMarks] = useState<{ key: string; seat: SeatIndex; xPct: number; yPct: number }[]>([]);
  const prevMissRef = useRef(state.lastMiss);

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

  // Last 10 seconds: the detective waltz hurries (104 → 132 BPM).
  const urgent = state.phase === "playing" && timeLeft > 0 && timeLeft <= 10;
  useEffect(() => {
    getSpotSound().setUrgent(urgent);
    return () => getSpotSound().setUrgent(false);
  }, [urgent]);

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
      getSpotSound().playMissClick();
      setFlash("wrong");
      const id = setTimeout(() => setFlash(null), 400);
      prevPenaltyRef.current = current;
      return () => clearTimeout(id);
    }
    prevPenaltyRef.current = current;
  }, [state.penalties, viewerSeat]);

  useEffect(() => {
    const prev = prevMissRef.current;
    prevMissRef.current = state.lastMiss;
    if (!state.lastMiss || state.lastMiss === prev) return;
    const fresh = Object.entries(state.lastMiss)
      .map(([seat, m]) => ({ seat: Number(seat), ...m }))
      .filter((m) => m.seat !== viewerSeat && prev?.[m.seat]?.atMs !== m.atMs)
      .map((m) => ({ key: `${m.seat}:${m.atMs}`, seat: m.seat, xPct: m.xPct, yPct: m.yPct }));
    if (fresh.length === 0) return;
    getSpotSound().playMissClick(true); // soft "통" — one per update, however many seats missed at once
    setMissMarks((marks) => [...marks, ...fresh]);
    const keys = new Set(fresh.map((m) => m.key));
    setTimeout(() => setMissMarks((marks) => marks.filter((m) => !keys.has(m.key))), 900);
  }, [state.lastMiss, viewerSeat]);

  // Detects any newly-found spot (by any team) — a shared match event
  // everyone should hear, not just the finder. Counted across all stages
  // because a stage's last find switches `currentStageIndex` (or ends the
  // match) in the same update; that case gets the stage-clear fanfare.
  const foundTotal = foundSpotCount(state);
  const [clearFx, setClearFx] = useState<{ n: number; final: boolean } | null>(null);
  const clearFxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clearFxTimerRef.current) clearTimeout(clearFxTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    const prev = prevFoundRef.current;
    const mine = myTeam ? computeTeamScores(state)[myTeam] : 0;
    prevFoundRef.current = { total: foundTotal, stageIndex: state.currentStageIndex, mine };
    if (!prev || foundTotal <= prev.total) return;
    // Mine if my team's score rose in this update (ties in one batched update go to "mine").
    const byMyTeam = mine > prev.mine;
    const cleared = state.currentStageIndex > prev.stageIndex || (state.phase === "gameOver" && foundTotal === totalSpotCount(state));
    if (cleared) {
      getSpotSound().playStageClear();
      // Own timer ref: this effect re-runs (and cleans up) on every state change, e.g. a bot click mid-flourish.
      setClearFx({ n: foundTotal, final: state.phase === "gameOver" });
      if (clearFxTimerRef.current) clearTimeout(clearFxTimerRef.current);
      clearFxTimerRef.current = setTimeout(() => setClearFx(null), STAGE_CLEAR_FX_MS);
    } else if (byMyTeam) getSpotSound().playFindSuccess();
    else getSpotSound().playRivalFind();
    setFlash("correct");
    const id = setTimeout(() => setFlash(null), 350);
    return () => clearTimeout(id);
  }, [foundTotal, state, myTeam]);

  if (!stage || !myTeam) return null;

  const clearOverlay = clearFx && <StageClearFx key={clearFx.n} final={clearFx.final} />;

  const scores = computeTeamScores(state);
  const remaining = totalSpotCount(state) - foundSpotCount(state);
  const lockedUntil = state.penalties[viewerSeat];
  const isLocked = lockedUntil !== undefined && now < lockedUntil;
  const lockSecondsLeft = isLocked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  function handleClick(xPct: number, yPct: number) {
    if (state.phase !== "playing" || isLocked) return;
    getSpotSound().unlock();
    onAction({ type: "click", seat: viewerSeat, xPct, yPct, atMs: Date.now() });
  }

  function handlePick(index: number) {
    if (state.phase !== "playing" || isLocked) return;
    getSpotSound().unlock();
    onAction({ type: "pick", seat: viewerSeat, index, atMs: Date.now() });
  }

  const kind = stageKind(stage);
  const kindMeta = STAGE_KIND_META[kind];

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
      <div className="flex flex-col items-center gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
        {clearOverlay}
        <span className="text-4xl">{tied ? "🤝" : "🏆"}</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">
          {tied ? "무승부! 두 팀 모두 잘 찾았어요" : `${TEAM_STYLE[winners[0].team].label} 승리!`}
        </h2>
        <p className="text-sm text-white/50 light:text-slate-500">
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
              <p className="mt-1 text-3xl font-bold text-white light:text-slate-900">{scores[team]}</p>
              <p className="mt-1 text-[11px] text-white/40 light:text-slate-500">
                {Object.entries(state.teamOf)
                  .filter(([, t]) => t === team)
                  .map(([seat]) => names[Number(seat)] ?? `${Number(seat) + 1}번`)
                  .join(", ")}
              </p>
            </div>
          ))}
        </div>
        <DiffRevealPanel state={state} />
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
      {clearOverlay}
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3 light:border-slate-200 light:bg-white light:shadow-sm">
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
              <p className="text-lg font-bold text-white leading-tight light:text-slate-900">{scores[team]}</p>
            </div>
          ))}
        </div>
        <div className="text-center">
          <p className="text-[10px] text-white/40 light:text-slate-500">남은 차이</p>
          <p className="text-lg font-bold text-white light:text-slate-900">{remaining}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-white/40 light:text-slate-500">남은 시간</p>
          <p className={`text-lg font-bold tabular-nums ${timeLeft <= 10 ? "text-rose-400" : "text-white light:text-slate-900"}`}>
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
          <SpotSoundHud />
          <button
            onClick={() => setRulebookOpen(true)}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500 light:hover:border-slate-400"
          >
            📖 룰북
          </button>
        </div>
      </div>

      {state.stages.length > 1 && (
        <p className="text-center text-xs text-white/40 light:text-slate-500">
          스테이지 {state.currentStageIndex + 1} / {state.stages.length}
        </p>
      )}

      {kind !== "classic" && (
        <div
          key={state.currentStageIndex}
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-400/15 via-fuchsia-400/10 to-amber-400/15 px-3 py-2 text-center animate-[spot-diff-pop_0.35s_ease-out] light:border-amber-300 light:from-amber-50 light:via-fuchsia-50 light:to-amber-50"
        >
          <span className="text-sm font-black text-amber-200 light:text-amber-700">
            🎁 보너스 라운드 · {kindMeta.emoji} {kindMeta.label}
          </span>
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold text-amber-100 light:bg-amber-100 light:text-amber-800">{kindMeta.points}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-white/50 light:text-slate-500">
          {isLocked ? (
            <span className="text-rose-300 light:text-rose-600">🔒 오답! {lockSecondsLeft}초 후 다시 {kind === "same" ? "고를" : "클릭할"} 수 있어요</span>
          ) : (
            kindMeta.howTo
          )}
        </p>
        <button
          onClick={handleUseHint}
          disabled={state.hints[myTeam] <= 0 || kind === "same"}
          title={kind === "same" ? "같은 그림 찾기에서는 힌트를 쓸 수 없어요" : undefined}
          className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:border-amber-400/70 disabled:cursor-not-allowed disabled:opacity-30 light:border-amber-400/60 light:bg-amber-50 light:text-amber-700"
        >
          💡 힌트 ({state.hints[myTeam]}남음)
        </button>
      </div>

      <StageArea
        key={state.currentStageIndex}
        state={state}
        stage={stage}
        now={now}
        flash={flash}
        onClick={handleClick}
        onPick={handlePick}
        activeHintSpot={activeHintSpot}
        isLocked={isLocked}
        missMarks={missMarks}
        names={names}
      />

      <p className="text-center text-[11px] text-white/30 light:text-slate-400">
        {Array.from({ length: state.playerCount }, (_, seat) => seat)
          .map((seat) => `${names[seat] ?? `${seat + 1}번`}${connectedSeats.has(seat) ? "" : "(연결끊김)"}`)
          .join(" · ")}
      </p>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

type MissMark = { key: string; seat: SeatIndex; xPct: number; yPct: number };
type HintSpot = { xPct: number; yPct: number; rPct: number } | undefined;

/** Max CSS blur (px) a 🌫️ fade round reaches at FADE_FULL_MS — still readable up close, hard at a glance. */
const FADE_MAX_BLUR_PX = 5;

/**
 * One stage's play area. Keyed by stage index in the parent, so `arrivedAt`
 * (lazy-initialised on mount) is this device's own arrival time at the
 * stage — the memory preview and the fade blur both run off it locally,
 * like the match clock (engine.ts bonus-round doc).
 */
function StageArea({
  state,
  stage,
  now,
  flash,
  onClick,
  onPick,
  activeHintSpot,
  isLocked,
  missMarks,
  names,
}: {
  state: SpotDifferenceState;
  stage: StageResult;
  now: number;
  flash: "correct" | "wrong" | null;
  onClick: (xPct: number, yPct: number) => void;
  onPick: (index: number) => void;
  activeHintSpot: HintSpot;
  isLocked: boolean;
  missMarks: MissMark[];
  names: Record<number, string>;
}) {
  const [arrivedAt] = useState(() => Date.now());
  const elapsed = Math.max(0, now - arrivedAt);
  const kind = stageKind(stage);
  const ring = flash === "wrong" ? "ring-2 ring-rose-500" : flash === "correct" ? "ring-2 ring-emerald-400" : "";

  if (kind === "same") {
    return (
      <div className={`rounded-2xl transition ${ring}`}>
        <SamePanel state={state} stage={stage} onPick={onPick} isLocked={isLocked} names={names} />
      </div>
    );
  }

  const previewing = kind === "memory" && elapsed < MEMORY_PREVIEW_MS;
  const previewLeft = Math.ceil((MEMORY_PREVIEW_MS - elapsed) / 1000);
  const blurPx = kind === "fade" ? Math.min(1, elapsed / FADE_FULL_MS) * FADE_MAX_BLUR_PX : 0;
  const artStyle: CSSProperties | undefined = blurPx > 0 ? { filter: `blur(${blurPx.toFixed(2)}px) saturate(${(1 - blurPx / 12).toFixed(2)})`, transition: "filter 0.25s linear" } : undefined;
  const common = { state, stage, activeHintSpot, isLocked, missMarks, names, artStyle };

  return (
    <div className="flex flex-col gap-2">
      {kind === "fade" && (
        <div className="flex items-center gap-2 text-[11px] text-white/50 light:text-slate-500">
          <span>🌫️ 선명도</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-300 to-fuchsia-400 transition-[width] duration-200" style={{ width: `${Math.round((1 - blurPx / FADE_MAX_BLUR_PX) * 100)}%` }} />
          </div>
        </div>
      )}
      <div className={`grid grid-cols-1 gap-3 rounded-2xl transition sm:grid-cols-2 ${ring}`}>
        <StagePanel
          {...common}
          variant="original"
          onClick={previewing || kind === "memory" ? undefined : onClick}
          cover={
            kind === "memory" && !previewing ? (
              <>
                <span className="text-4xl">🧠</span>
                <span className="text-sm font-bold">기억나나요?</span>
                <span className="text-[11px] opacity-70">오른쪽 그림에서 바뀐 곳을 클릭하세요</span>
              </>
            ) : undefined
          }
          badge={previewing ? `🧠 외우세요! ${previewLeft}` : undefined}
        />
        <StagePanel
          {...common}
          variant="modified"
          mirrored={kind === "mirror"}
          onClick={previewing ? undefined : onClick}
          cover={
            previewing ? (
              <>
                <span className="text-4xl tabular-nums">{previewLeft}</span>
                <span className="text-sm font-bold">왼쪽 원본을 기억하세요</span>
                <span className="text-[11px] opacity-70">원본이 숨겨지면 바뀐 그림이 나타나요</span>
              </>
            ) : undefined
          }
          badge={kind === "mirror" ? "🪞 거울" : undefined}
        />
      </div>
    </div>
  );
}

function StagePanel({
  state,
  stage,
  variant,
  mirrored = false,
  onClick,
  activeHintSpot,
  isLocked,
  missMarks,
  names,
  artStyle,
  cover,
  badge,
}: {
  state: SpotDifferenceState;
  stage: StageResult;
  variant: "original" | "modified";
  /** 🪞 mirror round: art + every marker drawn flipped; clicks converted back to unflipped coordinates. */
  mirrored?: boolean;
  /** Omitted = panel not clickable right now (memory preview / hidden original). */
  onClick?: (xPct: number, yPct: number) => void;
  activeHintSpot: HintSpot;
  isLocked: boolean;
  missMarks: MissMark[];
  names: Record<number, string>;
  artStyle?: CSSProperties;
  /** Replaces the picture entirely (memory round) — the art isn't rendered underneath. */
  cover?: ReactNode;
  badge?: string;
}) {
  const fx = (x: number) => (mirrored ? 100 - x : x);
  function handle(e: MouseEvent<HTMLDivElement>) {
    if (!onClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    onClick(fx(xPct), yPct);
  }
  const clickable = !!onClick && !cover;
  return (
    <div
      onClick={clickable ? handle : undefined}
      className={`relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300 light:shadow-sm ${
        !clickable ? "cursor-default" : isLocked ? "cursor-not-allowed" : "cursor-crosshair"
      }`}
    >
      {cover ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-indigo-950 via-slate-900 to-fuchsia-950 text-center text-white/90 light:from-indigo-100 light:via-white light:to-fuchsia-100 light:text-slate-800">
          {cover}
        </div>
      ) : (
        <>
          <div className="h-full w-full" style={{ ...artStyle, ...(mirrored ? { transform: "scaleX(-1)" } : undefined) }}>
            {state.source.kind === "photo" ? (
              <PhotoStageCanvas
                imageDataUrl={state.source.imageDataUrl}
                spots={stage.spots as PhotoDiffSpot[]}
                variant={variant}
                className="h-full w-full object-contain"
              />
            ) : (
              <BuiltinStagePanel sceneId={sceneIdForStage(state)} spotIds={stage.spots.map((s) => s.id)} variant={variant} className="h-full w-full" />
            )}
          </div>

          {/* Found-spot markers */}
          {stage.spots
            .filter((s) => stage.foundBy[s.id])
            .map((s) => (
              <div
                key={s.id}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)] animate-[spot-diff-pop_0.35s_ease-out]"
                style={{
                  left: `${fx(s.xPct)}%`,
                  top: `${s.yPct}%`,
                  width: `${s.rPct * 2}%`,
                  height: `${s.rPct * 2}%`,
                }}
              />
            ))}

          {/* Other seats' wrong clicks */}
          {missMarks.map((m) => (
            <div
              key={m.key}
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center animate-[spot-diff-pop_0.35s_ease-out]"
              style={{ left: `${fx(m.xPct)}%`, top: `${m.yPct}%` }}
            >
              <span className="text-lg font-black leading-none text-rose-500 drop-shadow">❌</span>
              <span className="mt-0.5 whitespace-nowrap rounded bg-black/70 px-1 text-[10px] font-bold text-rose-200">
                {names[m.seat] ?? `${m.seat + 1}번`}
              </span>
            </div>
          ))}

          {/* Active team hint wiggle */}
          {activeHintSpot && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-amber-300 animate-[spot-diff-wiggle_0.6s_ease-in-out_infinite]"
              style={{
                left: `${fx(activeHintSpot.xPct)}%`,
                top: `${activeHintSpot.yPct}%`,
                width: `${activeHintSpot.rPct * 2.4}%`,
                height: `${activeHintSpot.rPct * 2.4}%`,
              }}
            />
          )}
        </>
      )}
      {badge && (
        <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-amber-200">{badge}</span>
      )}
    </div>
  );
}

/** 🔍 같은 그림 찾기: the reference picture + SAME_CANDIDATES look-alike cards, exactly one identical. */
function SamePanel({
  state,
  stage,
  onPick,
  isLocked,
  names,
}: {
  state: SpotDifferenceState;
  stage: StageResult;
  onPick: (index: number) => void;
  isLocked: boolean;
  names: Record<number, string>;
}) {
  const sceneId = sceneIdForStage(state);
  const candidates = stage.candidates ?? [];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border-2 border-amber-300/70 light:border-amber-400">
        <ThemeSceneArt themeId={sceneId} active={new Set()} className="h-full w-full" />
        <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-bold text-amber-200">⭐ 원본</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {candidates.map((mutations, index) => {
          const wrongBy = stage.wrongPicks?.[index];
          const crossed = wrongBy !== undefined;
          return (
            <button
              key={index}
              type="button"
              disabled={crossed || isLocked}
              onClick={() => onPick(index)}
              aria-label={`${index + 1}번 그림 고르기`}
              className={`relative aspect-[4/3] overflow-hidden rounded-xl border-2 transition ${
                crossed
                  ? "cursor-not-allowed border-rose-500/60 opacity-50"
                  : isLocked
                    ? "cursor-not-allowed border-white/15 light:border-slate-300"
                    : "border-white/15 hover:scale-[1.03] hover:border-fuchsia-300 light:border-slate-300 light:hover:border-fuchsia-500"
              }`}
            >
              <ThemeSceneArt themeId={sceneId} active={new Set(mutations)} className="h-full w-full" />
              <span className="pointer-events-none absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-[11px] font-bold text-white">{index + 1}</span>
              {crossed && (
                <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                  <span className="text-3xl font-black leading-none text-rose-500 drop-shadow">❌</span>
                  <span className="mt-1 rounded bg-black/70 px-1 text-[10px] font-bold text-rose-200">{names[wrongBy] ?? `${wrongBy + 1}번`}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function sceneIdForStage(state: SpotDifferenceState): string {
  return state.builtinSceneIds[state.currentStageIndex] ?? state.builtinSceneIds[0];
}

function BuiltinStagePanel({
  sceneId,
  spotIds,
  variant,
  className,
}: {
  sceneId: string;
  spotIds: string[];
  variant: "original" | "modified";
  className?: string;
}) {
  // Unknown ids (e.g. a pre-2026-09-30 snapshot naming a retired classic scene) just render ThemeSceneArt's empty frame.
  const active = variant === "modified" ? activeThemeMutationIds(sceneId, spotIds) : new Set<string>();
  return <ThemeSceneArt themeId={sceneId} active={active} className={className} />;
}
