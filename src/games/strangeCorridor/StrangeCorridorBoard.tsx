"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { Loading3D, preferLowDetail, useBoardView, ViewToggle } from "@/games/shared/three/viewPref";
import {
  ANOMALY_TEXT,
  computeRankings,
  correctPick,
  currentAnomaly,
  KIND_LABEL,
  LOOK_MS,
  phaseMs,
  shownProps,
  type Anomaly,
  type CorridorState,
  type EngineAction,
  type Prop,
  type Seat,
} from "./engine";
import Corridor2D from "./Corridor2D";
import { corridorIntensity, getStrangeCorridorSound, strangeCorridorCues } from "./strangeCorridorSound";
import RulebookModal from "./RulebookModal";

const CorridorScene = dynamic(() => import("./three/CorridorScene"), { ssr: false, loading: () => <Loading3D label="🚪 복도 불을 켜는 중…" /> });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const DANGER = "rounded-xl bg-rose-700 px-3 py-3 text-sm font-black text-white transition hover:bg-rose-600 disabled:opacity-40";
const CALM = "rounded-xl bg-emerald-700 px-3 py-3 text-sm font-black text-white transition hover:bg-emerald-600 disabled:opacity-40";

export const SEAT_COLORS = ["#f87171", "#60a5fa", "#a3e635", "#fbbf24", "#c084fc", "#f472b6", "#2dd4bf", "#fb923c"];
export const SEAT_MARKS = ["●", "◆", "▲", "■", "★", "✚", "⬟", "✦"];

function SeatChip({ seat }: { seat: Seat }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ background: SEAT_COLORS[seat % 8], textShadow: "0 1px 1px rgba(0,0,0,.6)" }}>
      {SEAT_MARKS[seat % 8]}
    </span>
  );
}

function propName(layout: Prop[], a: Anomaly): string {
  const p = a.extra ?? layout.find((x) => x.id === a.target);
  if (!p) return "무언가";
  return p.kind === "door" ? `${p.label}호 문` : KIND_LABEL[p.kind];
}

export function anomalyText(layout: Prop[], a: Anomaly | null): string {
  if (!a) return "✅ 이상 없는 복도였어요";
  return `🚨 ${propName(layout, a)} — ${ANOMALY_TEXT[a.kind]}`;
}

interface Props {
  state: CorridorState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  /** Date.now() when this client saw the current phase begin. */
  phaseStart: number;
  nowMs: number;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
}

export default function StrangeCorridorBoard({ state, viewerSeat, names, connectedSeats, botSeats, phaseStart, nowMs, onAction, onGameEnd }: Props) {
  const board = useBoardView("strange-corridor-view");
  const [lowDetail] = useState(preferLowDetail);
  const [rules, setRules] = useState(false);
  const [selRaw, setSel] = useState<{ step: number; id: string } | null>(null);
  const sel = selRaw && selRaw.step === state.step ? selRaw.id : null;
  const name = useCallback((s: Seat) => (s === viewerSeat ? "나" : (names[s] ?? `${s + 1}번`)), [names, viewerSeat]);

  useSuiteBgm(getStrangeCorridorSound, state.phase !== "ended", corridorIntensity(state));
  const classify = useMemo(() => strangeCorridorCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getStrangeCorridorSound, classify);

  const playing = viewerSeat >= 0 && viewerSeat < state.playerCount;
  const myAnswer = playing ? state.answers[viewerSeat] : null;
  const canAnswer = playing && state.phase === "look" && !myAnswer;
  const anomaly = currentAnomaly(state);
  // during the look phase nobody sees the answer; the reveal shows it
  const shown = useMemo(() => shownProps(state.layout, state.phase === "study" ? null : anomaly), [state.layout, state.phase, anomaly]);
  const lastResult = state.phase === "reveal" || state.phase === "ended" ? state.results[state.results.length - 1] : null;
  const revealId = state.phase === "reveal" && lastResult?.anomaly ? lastResult.anomaly.target : null;
  const selectedProp = sel ? shown.find((p) => p.id === sel) : null;

  const answer = useCallback(
    (pick: string) => {
      if (!canAnswer) return;
      getStrangeCorridorSound().play("confirm");
      onAction({ type: "answer", seat: viewerSeat, step: state.step, pick, ms: Math.min(LOOK_MS, Date.now() - phaseStart) });
    },
    [canAnswer, onAction, viewerSeat, state.step, phaseStart],
  );
  const pick = useCallback(
    (id: string) => {
      if (!canAnswer) return;
      getStrangeCorridorSound().play("select");
      setSel({ step: state.step, id });
    },
    [canAnswer, state.step],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "n" || e.key === "N") && canAnswer) answer("none");
      else if (e.key === "Enter" && canAnswer && sel) answer(sel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAnswer, sel, answer]);

  const left = state.phase === "ended" ? null : Math.max(0, Math.ceil((phaseStart + phaseMs(state) - nowMs) / 1000));
  useEffect(() => {
    if (left !== null && left > 0 && left <= 5 && canAnswer) getStrangeCorridorSound().play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const ended = state.phase === "ended";
  const rankings = computeRankings(state);
  const dread = state.options.rounds > 0 ? state.round / state.options.rounds : 0;
  const myLast = lastResult && playing ? lastResult.answers[viewerSeat] : null;
  const myRight = lastResult && myLast ? myLast.pick === correctPick(lastResult.anomaly) : false;
  const flash = state.phase === "reveal" && state.options.scare && playing && !myRight;
  const hint = state.phase === "study" ? "👀 평범한 복도예요 — 잘 기억하세요" : state.phase === "look" ? (canAnswer ? "이상한 곳을 눌러 고르거나, 이상 없음!" : "답을 냈어요 · 다른 사람을 기다리는 중") : state.phase === "reveal" ? anomalyText(state.layout, lastResult?.anomaly ?? null) : "끝";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-950/70 px-2.5 py-1 text-xs font-black text-emerald-100 light:bg-emerald-100 light:text-emerald-800">🚪 이상한 복도</span>
        <span className="text-xs text-white/60 light:text-slate-500">
          {state.phase === "study" ? "기억하기" : `${state.round} / ${state.options.rounds}번째 복도`}
          {left !== null && state.phase !== "reveal" && <b className={`ml-1 tabular-nums ${left <= 5 ? "text-rose-300 light:text-rose-600" : ""}`}>⏱ {left}초</b>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getStrangeCorridorSound} icon="💡" label="Fluorescent Hum" preview="flicker" />
          <ViewToggle board={board} />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </div>
      </div>

      <div className="relative z-10 h-[360px] w-full overflow-hidden rounded-2xl border border-black/50 bg-black sm:h-[480px]">
        {board.view === "3d" ? (
          <CorridorScene
            props={shown}
            selectedId={sel}
            revealId={revealId}
            walkStart={phaseStart}
            walkMs={state.phase === "reveal" ? 1 : phaseMs(state) * 0.85}
            dread={dread}
            lowDetail={lowDetail}
            onPick={canAnswer ? pick : null}
          />
        ) : (
          <Corridor2D props={shown} selectedId={sel} revealId={revealId} onPick={canAnswer ? pick : null} />
        )}
        {flash && <div key={state.step} className="pointer-events-none absolute inset-0 animate-pulse bg-rose-700/25" />}
        <span className={`pointer-events-none absolute top-2 left-1/2 max-w-[94%] -translate-x-1/2 truncate rounded-full px-3 py-1 text-xs font-bold ${state.phase === "reveal" && lastResult?.anomaly ? "bg-rose-900/85 text-rose-50" : "bg-black/60 text-white/85"}`}>{hint}</span>
        {board.view === "3d" && state.phase !== "reveal" && <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] whitespace-nowrap text-white/70">드래그로 둘러보기 · 눌러서 고르기</span>}
      </div>

      <div className={`${PANEL} flex flex-col gap-3`}>
        {state.phase === "study" && playing && (
          <button className={CALM} onClick={() => onAction({ type: "ready", seat: viewerSeat, step: state.step })} disabled={state.ready[viewerSeat]}>
            {state.ready[viewerSeat] ? "다른 사람을 기다리는 중…" : "👀 다 외웠어요"}
          </button>
        )}
        {state.phase === "look" && playing && (
          <>
            <p className="text-center text-xs text-white/60 light:text-slate-500">
              {myAnswer ? (myAnswer.pick === "none" ? "✅ 이상 없음이라고 답했어요" : "🚨 이상한 곳을 골랐어요") : selectedProp ? `선택: ${selectedProp.kind === "door" ? `${selectedProp.label}호 문` : KIND_LABEL[selectedProp.kind]}` : "아무것도 고르지 않았어요"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button className={DANGER} onClick={() => sel && answer(sel)} disabled={!canAnswer || !sel}>
                🚨 여기가 이상해요
              </button>
              <button className={CALM} onClick={() => answer("none")} disabled={!canAnswer}>
                ✅ 이상 없음 (N)
              </button>
            </div>
          </>
        )}
        {state.phase === "reveal" && lastResult && (
          <p className={`rounded-xl px-3 py-2 text-center text-sm font-bold ${myRight ? "bg-emerald-600/20 text-emerald-100 light:text-emerald-800" : "bg-rose-600/20 text-rose-100 light:text-rose-800"}`} aria-live="polite">
            {!playing ? anomalyText(state.layout, lastResult.anomaly) : myRight ? `⭕ 맞았어요! +${lastResult.points[viewerSeat]}` : myLast ? "❌ 틀렸어요 — 연속 기록이 끊겼어요" : "⏰ 시간 안에 답하지 못했어요"}
          </p>
        )}

        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {rankings.map((r) => {
            const a = state.answers[r.seat];
            const res = lastResult && (state.phase === "reveal" || ended) ? lastResult.points[r.seat] : null;
            return (
              <li key={r.seat} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${r.seat === viewerSeat ? "border-sky-400/50" : "border-white/10 light:border-slate-200"}`}>
                <SeatChip seat={r.seat} />
                <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">
                  {name(r.seat)}
                  {!connectedSeats.has(r.seat) && !botSeats.has(r.seat) && " 📡"}
                </span>
                <span className="text-[11px]">{state.phase === "study" ? (state.ready[r.seat] ? "👀" : "…") : state.phase === "look" ? (a ? "✋" : "…") : res !== null ? (res > 0 ? `+${res}` : "✗") : ""}</span>
                {state.streaks[r.seat] >= 2 && <span title="연속 정답">🔥{state.streaks[r.seat]}</span>}
                <b className="tabular-nums text-emerald-100 light:text-emerald-700">{r.score}</b>
              </li>
            );
          })}
        </ul>
      </div>

      {ended && (
        <div className={`${PANEL} flex flex-col gap-3 text-center`}>
          <h3 className="text-lg font-black text-white light:text-slate-900">🚪 복도를 빠져나왔어요</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {rankings.map((r) => (
              <li key={r.seat} className="flex items-center justify-center gap-2">
                <b className="w-8 text-right">{r.rank === 1 ? "👑" : `${r.rank}위`}</b>
                <SeatChip seat={r.seat} />
                <span className="w-28 truncate text-left text-white light:text-slate-900">{name(r.seat)}</span>
                <span className="w-14 text-right text-xs text-white/50 light:text-slate-500">{state.results.filter((x) => x.points[r.seat] > 0).length}/{state.options.rounds}</span>
                <b className="w-12 text-right tabular-nums">{r.score}</b>
              </li>
            ))}
          </ol>
          <button className={CALM} onClick={onGameEnd}>
            🏁 결과 저장하고 마치기
          </button>
        </div>
      )}

      {state.results.length > 0 && (
        <details className={`${PANEL} text-xs text-white/60 light:text-slate-600`}>
          <summary className="cursor-pointer font-bold">🗂️ 지난 복도</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {state.results.map((r) => (
              <li key={r.round}>
                {r.round}. {anomalyText(state.layout, r.anomaly)} · 맞힌 사람 {r.points.filter((p) => p > 0).length}명
              </li>
            ))}
          </ul>
        </details>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}
