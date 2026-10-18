"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  PLACE_TIMEOUT_MS,
  PULL_TIMEOUT_MS,
  START_LEVELS,
  blockCount,
  computeRankings,
  instability,
  legalPulls,
  looseLabel,
  placeTarget,
  pullDifficulty,
  towerLean,
  type Coord,
  type EngineAction,
  type Seat,
  type WobbleTowerState,
} from "./engine";
import { PullTracker, pullFeel } from "./pull";
import RulebookModal from "./RulebookModal";
import { webglAvailable } from "./three/webgl";
import type { LivePull } from "./three/Tower3D";
import { getWobbleSound, wobbleCues } from "./wobbleSound";

const Loading3D = () => <div className="flex h-full items-center justify-center bg-[#160f0a] text-xs text-amber-200/60">🪵 탑 세우는 중…</div>;
const Tower3D = dynamic(() => import("./three/Tower3D"), { ssr: false, loading: Loading3D });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-500 disabled:opacity-40";
const QUALITY_KEY = "wobble-tower-quality";

interface Props {
  state: WobbleTowerState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  /** This client drives bots/timeouts/next-round. */
  canDrive: boolean;
  deadlineMs: number | null;
  nowMs: number;
  /** Shared live-pull slot, owned by the room (remote drags and mine both land here). Read-only here. */
  live: MutableRefObject<LivePull | null>;
  /** Report my drag every frame — the room stores it in `live` and throttles the broadcast. */
  onLive: (l: LivePull) => void;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
}

function loadQuality(): "high" | "low" {
  try {
    return window.localStorage.getItem(QUALITY_KEY) === "low" ? "low" : "high";
  } catch {
    return "high";
  }
}

/* ── 당기기 막대 ───────────────────────────────────────────── */

interface PullView {
  hand: number;
  progress: number;
  strain: number;
  stuck: boolean;
  jerked: boolean;
  done: boolean;
}

function PullControl({
  turn,
  coord,
  difficulty,
  seed,
  onLive,
  onDone,
}: {
  turn: number;
  coord: Coord;
  difficulty: number;
  seed: number;
  onLive: (l: LivePull) => void;
  onDone: (quality: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const tracker = useRef<PullTracker | null>(null);
  const hand = useRef(0);
  const dragging = useRef(false);
  const lastT = useRef(0);
  const lastScrape = useRef(0);
  const wasStuck = useRef(false);
  const sentDone = useRef(false);
  const [view, setView] = useState<PullView>({ hand: 0, progress: 0, strain: 0, stuck: false, jerked: false, done: false });

  const [running, setRunning] = useState(false);
  const onLiveRef = useRef(onLive);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onLiveRef.current = onLive;
    onDoneRef.current = onDone;
  }, [onLive, onDone]);

  // rAF loop while the pull is in progress (also runs while the hand rests, so a catch can release)
  useEffect(() => {
    if (!running) return;
    let id = 0;
    lastT.current = performance.now();
    const frame = () => {
      const tr = tracker.current;
      if (!tr) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT.current) / 1000);
      lastT.current = now;
      const before = tr.progress;
      tr.step(hand.current, dt);
      const sound = getWobbleSound();
      if (tr.stuck && !wasStuck.current) sound.play("stuck");
      wasStuck.current = tr.stuck;
      if (tr.progress > before + 0.002 && now - lastScrape.current > 90) {
        lastScrape.current = now;
        sound.play("scrape", tr.strain);
      }
      onLiveRef.current({ turn, level: coord.level, slot: coord.slot, progress: tr.progress, strain: tr.strain, stuck: tr.stuck, jerked: tr.jerked, at: now });
      setView({ hand: hand.current, progress: tr.progress, strain: tr.strain, stuck: tr.stuck, jerked: tr.jerked, done: tr.done });
      if (tr.done) {
        if (!sentDone.current) {
          sentDone.current = true;
          onDoneRef.current(tr.quality);
        }
        return;
      }
      id = window.requestAnimationFrame(frame);
    };
    id = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(id);
  }, [running, turn, coord.level, coord.slot]);

  const handFrom = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    hand.current = Math.max(hand.current, Math.min(1, Math.max(0, (clientX - r.left - 18) / Math.max(1, r.width - 36))));
  };
  const start = () => {
    if (!tracker.current) tracker.current = new PullTracker(pullFeel(difficulty, seed));
    if (!tracker.current.done) setRunning(true);
  };

  const strainColor = view.strain > 0.7 ? "bg-rose-500" : view.strain > 0.4 ? "bg-amber-400" : "bg-emerald-400";
  const hint = view.jerked
    ? "덜컥! 손을 놓쳤어요…"
    : view.done
      ? "쑥 빠졌어요!"
      : view.stuck
        ? "🔒 걸렸어요! 손을 멈추고 기다려요"
        : view.strain > 0.6
          ? "너무 빨라요! 천천히…"
          : view.progress > 0
            ? "좋아요, 그대로 천천히"
            : "손잡이를 끝까지 천천히 끌어 빼요";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-bold ${view.stuck ? "animate-pulse text-rose-300 light:text-rose-600" : "text-amber-100 light:text-amber-800"}`}>{hint}</span>
        <span className="tabular-nums text-white/50 light:text-slate-500">{Math.round(view.progress * 100)}%</span>
      </div>
      <div
        ref={track}
        role="slider"
        aria-label="블록 당기기"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(view.progress * 100)}
        tabIndex={0}
        className="relative h-14 touch-none rounded-2xl border border-amber-900/40 bg-gradient-to-r from-amber-950/60 to-stone-900/60 select-none light:border-amber-300 light:from-amber-100 light:to-stone-100"
        onPointerDown={(e) => {
          if (view.done) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          dragging.current = true;
          start();
        }}
        onPointerMove={(e) => {
          if (dragging.current) handFrom(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (view.done) return;
          if (e.key === "ArrowRight" || e.key === " ") {
            e.preventDefault();
            start();
            hand.current = Math.min(1, hand.current + 0.03);
          }
        }}
      >
        {/* block coming out */}
        <div className="pointer-events-none absolute inset-y-3 left-[18px] rounded-md bg-gradient-to-r from-amber-300 to-amber-500 opacity-80 transition-[width] duration-75" style={{ width: `calc((100% - 36px) * ${view.progress})` }} />
        {/* hand */}
        <div
          className={`pointer-events-none absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-lg shadow-lg ${view.stuck ? "border-rose-400 bg-rose-500/80" : "border-amber-200 bg-amber-500"}`}
          style={{ left: `calc(18px + (100% - 36px) * ${view.hand})` }}
        >
          {view.stuck ? "🔒" : "✋"}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-white/50 light:text-slate-500">
        긴장도
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full ${strainColor} transition-[width] duration-75`} style={{ width: `${Math.round(view.strain * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

/* ── 올리기 칸 (위에서 본 꼭대기 층) ───────────────────────────── */

function PlacePicker({ state, onPlace }: { state: WobbleTowerState; onPlace: (slot: number) => void }) {
  const target = placeTarget(state.levels);
  const lv = state.levels[target.level];
  const even = target.level % 2 === 0;
  return (
    <div className="flex items-center gap-3">
      <div className={`grid h-24 w-24 shrink-0 gap-1 rounded-lg bg-black/20 p-1 light:bg-slate-100 ${even ? "grid-rows-3" : "grid-cols-3"}`}>
        {[0, 1, 2].map((s) => {
          const filled = !!lv?.slots[s];
          const open = target.slots.includes(s);
          return (
            <button
              key={s}
              type="button"
              disabled={!open}
              onClick={() => onPlace(s)}
              aria-label={`${s + 1}번 칸에 올리기`}
              className={`rounded ${filled ? "bg-amber-700/80" : open ? "animate-pulse border-2 border-dashed border-amber-300 bg-amber-400/25 hover:bg-amber-400/50" : "bg-white/5"}`}
            />
          );
        })}
      </div>
      <p className="text-xs break-keep text-white/60 light:text-slate-600">
        꼭대기 {target.level + 1}층 — 빈칸을 눌러 올려요(탑의 반짝이는 자리도 눌러져요). <b>가운데</b>는 균형이 좋고, 한쪽에 몰면 탑이 기울어요.
      </p>
    </div>
  );
}

/* ── 2D 대체 화면 (WebGL 없음) ───────────────────────────────── */

function Tower2D({ state, legal, selected, onSelect }: { state: WobbleTowerState; legal: Set<string> | null; selected: Coord | null; onSelect: (c: Coord) => void }) {
  const rows = state.levels.map((lv, i) => ({ lv, i })).reverse();
  return (
    <div className="flex h-full flex-col items-center gap-[3px] overflow-y-auto bg-[#160f0a] p-3">
      {rows.map(({ lv, i }) => (
        <div key={i} className="flex items-center gap-1">
          <span className="w-6 text-right text-[10px] text-white/30 tabular-nums">{i + 1}</span>
          <div className={`flex gap-[3px] ${i % 2 === 0 ? "w-36 flex-col" : "w-36"}`}>
            {lv.slots.map((b, s) => {
              const key = `${i}:${s}`;
              const ok = legal?.has(key);
              const sel = selected?.level === i && selected.slot === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!ok}
                  onClick={() => onSelect({ level: i, slot: s })}
                  className={`${i % 2 === 0 ? "h-2.5 w-full" : "h-8 flex-1"} rounded-sm ${!b ? "bg-transparent" : sel ? "bg-amber-300" : ok ? "bg-amber-600 hover:bg-amber-400" : "bg-amber-800/70"}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 보드 ─────────────────────────────────────────────────── */

export default function WobbleTowerBoard({ state, viewerSeat, names, connectedSeats, botSeats, canDrive, deadlineMs, nowMs, live, onLive, onAction, onGameEnd }: Props) {
  const [canWebgl] = useState(webglAvailable);
  const [quality, setQuality] = useState<"high" | "low">(loadQuality);
  const [rules, setRules] = useState(false);
  const [pick, setPick] = useState<{ turn: number; coord: Coord } | null>(null);
  const [pulling, setPulling] = useState<number | null>(null);

  const myTurn = state.activeSeat === viewerSeat && (state.phase === "pull" || state.phase === "place");
  const selected = pick && pick.turn === state.turn && state.phase === "pull" ? pick.coord : null;
  const pullStarted = pulling === state.turn;

  const fragility = useMemo(() => instability(state.levels, state.sway), [state.levels, state.sway]);
  const lean = useMemo(() => towerLean(state.levels), [state.levels]);
  const legal = useMemo(() => {
    if (!myTurn || state.phase !== "pull" || pullStarted) return null;
    return new Set(legalPulls(state).map((c) => `${c.level}:${c.slot}`));
  }, [myTurn, state, pullStarted]);
  const target = placeTarget(state.levels);
  const placeSlots = myTurn && state.phase === "place" ? target.slots : null;

  useSuiteBgm(getWobbleSound, state.phase !== "ended", fragility > 0.75 ? 1 : 0);
  const classify = useMemo(() => wobbleCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getWobbleSound, classify);

  const select = useCallback(
    (c: Coord) => {
      if (pulling === state.turn) return;
      setPick({ turn: state.turn, coord: c });
      getWobbleSound().play("select");
      window.setTimeout(() => getWobbleSound().play("wiggle"), 120);
      onLive({ turn: state.turn, level: c.level, slot: c.slot, progress: 0, strain: 0, stuck: false, jerked: false, at: performance.now() });
    },
    [pulling, state.turn, onLive],
  );

  const finishPull = useCallback(
    (quality: number) => {
      if (!selected) return;
      onAction({ type: "pull", seat: viewerSeat, level: selected.level, slot: selected.slot, quality });
    },
    [selected, onAction, viewerSeat],
  );

  const place = useCallback(
    (slot: number) => {
      if (!placeSlots?.includes(slot)) return;
      onAction({ type: "place", seat: viewerSeat, slot });
    },
    [placeSlots, onAction, viewerSeat],
  );

  // auto next round (driver only)
  useEffect(() => {
    if (!canDrive || state.phase !== "collapsed") return;
    const id = window.setTimeout(() => onAction({ type: "next" }), 6500);
    return () => window.clearTimeout(id);
  }, [canDrive, state.phase, state.turn, onAction]);

  const onFps = useCallback((fps: number) => {
    if (fps < 28) {
      setQuality((q) => {
        if (q === "low") return q;
        try {
          window.localStorage.setItem(QUALITY_KEY, "low");
        } catch {
          /* ignore */
        }
        return "low";
      });
    }
  }, []);
  const lastClack = useRef(0);
  const onImpact = useCallback((k: number) => {
    const now = performance.now();
    if (now - lastClack.current < 60) return;
    lastClack.current = now;
    getWobbleSound().play("clack", k);
  }, []);
  const onCreak = useCallback((k: number) => getWobbleSound().play("creak", k), []);

  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const limit = state.phase === "place" ? PLACE_TIMEOUT_MS : PULL_TIMEOUT_MS;
  const activeName = names[state.activeSeat] ?? `${state.activeSeat + 1}번`;
  const activeIsBot = botSeats.has(state.activeSeat);
  const rec = state.history[state.history.length - 1];
  const fragileLabel = fragility > 1 ? "💀 아슬아슬" : fragility > 0.6 ? "😰 불안해요" : fragility > 0.3 ? "😬 조금 흔들려요" : "😌 튼튼해요";

  const selectedBlock = selected ? state.levels[selected.level]?.slots[selected.slot] : null;
  const difficulty = selected ? pullDifficulty(state.levels, selected.level, selected.slot) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          {state.options.rounds > 1 ? `${state.round + 1}/${state.options.rounds}판` : "단판"} · {state.levels.length}층 · 빼기 {state.roundPulls}번
        </span>
        <span className="text-xs text-white/60 light:text-slate-500">{fragileLabel}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {canWebgl && (
            <button
              type="button"
              onClick={() => {
                const next = quality === "high" ? "low" : "high";
                setQuality(next);
                try {
                  window.localStorage.setItem(QUALITY_KEY, next);
                } catch {
                  /* ignore */
                }
              }}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600"
            >
              {quality === "high" ? "✨ 고화질" : "⚡ 가볍게"}
            </button>
          )}
          <SuiteSoundHud suite={getWobbleSound} icon="🪵" label="Timber Hush" preview="place" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {/* 무대 */}
      <div className="relative h-[56vh] max-h-[640px] min-h-[300px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {canWebgl ? (
          <Tower3D
            levels={state.levels}
            held={state.held}
            lastEvent={state.lastEvent}
            collapse={state.collapse}
            round={state.round}
            legal={legal}
            selected={selected}
            onSelect={select}
            placeSlots={placeSlots}
            placeLevel={target.level}
            onPlace={place}
            live={live}
            fragility={fragility}
            lean={lean}
            quality={quality}
            onImpact={onImpact}
            onCreak={onCreak}
            onFps={onFps}
          />
        ) : (
          <Tower2D state={state} legal={legal} selected={selected} onSelect={select} />
        )}
        {/* 차례 띠 */}
        {(state.phase === "pull" || state.phase === "place") && (
          <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white">
            {myTurn ? "🫵 내 차례" : `${activeIsBot ? "🤖 " : ""}${activeName}`}
            <span className="font-normal text-white/70">{state.phase === "pull" ? (myTurn ? (selected ? "당겨서 빼기" : "뺄 블록 고르기") : "빼는 중") : "올리는 중"}</span>
            {remaining !== null && <span className={`tabular-nums ${remaining <= 10 ? "text-rose-300" : "text-white/60"}`}>{remaining}s</span>}
          </div>
        )}
        {state.phase === "collapsed" && rec && (
          <div className="pointer-events-none absolute inset-x-0 top-1/4 flex flex-col items-center gap-1 text-center">
            <span className="animate-bounce text-5xl">💥</span>
            <span className="rounded-xl bg-black/65 px-4 py-2 text-lg font-black text-white">{rec.loser === viewerSeat ? "내가 무너뜨렸어요…" : `${names[rec.loser] ?? "누군가"}님이 무너뜨렸어요!`}</span>
            {rec.lastBuilder !== null && <span className="rounded-full bg-amber-500/90 px-3 py-1 text-sm font-bold text-slate-900">🏅 마지막 건축가 {rec.lastBuilder === viewerSeat ? "나" : names[rec.lastBuilder]}</span>}
            <span className="text-xs text-white/70">{rec.pulls}번 빼고 {rec.levels}층에서 무너짐</span>
          </div>
        )}
      </div>

      {remaining !== null && (state.phase === "pull" || state.phase === "place") && (
        <div className="-mt-1 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full transition-[width] duration-300 ${remaining <= 10 ? "bg-rose-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, ((remaining * 1000) / limit) * 100)}%` }} />
        </div>
      )}

      {/* 조작 패널 */}
      {myTurn && state.phase === "pull" && (
        <div className={PANEL}>
          {selected && selectedBlock ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs text-white/70 light:text-slate-600">
                <b className="text-white light:text-slate-900">{selected.level + 1}층 {selected.slot === 1 ? "가운데" : "가장자리"}</b>
                <span className="rounded-full bg-white/10 px-2 py-0.5 light:bg-slate-100">{looseLabel(selectedBlock.loose)}</span>
                <span>· 위에 {state.levels.length - 1 - selected.level}층</span>
                {blockCount(state.levels[selected.level]) < 3 && <span className="text-rose-300 light:text-rose-600">· 빈칸 있는 층</span>}
                {!pullStarted && <span className="ml-auto text-white/40 light:text-slate-400">다른 블록을 눌러 바꿀 수 있어요</span>}
              </div>
              <PullControl
                key={`${state.turn}:${selected.level}:${selected.slot}`}
                turn={state.turn}
                coord={selected}
                difficulty={difficulty}
                seed={(state.seed ^ Math.imul(state.turn + 1, 2654435761)) | 0}
                onLive={(l) => {
                  if (l.progress > 0 && pulling !== state.turn) setPulling(state.turn);
                  onLive(l);
                }}
                onDone={finishPull}
              />
            </div>
          ) : (
            <p className="text-center text-sm text-white/70 light:text-slate-600">🫵 뺄 블록을 탑에서 눌러 고르세요. 어두운 블록은 뺄 수 없어요. 화면을 끌면 탑을 돌려볼 수 있어요.</p>
          )}
        </div>
      )}
      {myTurn && state.phase === "place" && (
        <div className={PANEL}>
          <PlacePicker state={state} onPlace={place} />
        </div>
      )}
      {!myTurn && (state.phase === "pull" || state.phase === "place") && (
        <div className={`${PANEL} text-center text-sm text-white/60 light:text-slate-500`}>
          {activeIsBot ? "🤖 " : ""}
          {activeName}님이 {state.phase === "pull" ? "블록을 빼고" : "블록을 올리고"} 있어요… 숨죽이고 지켜보세요.
        </div>
      )}
      {state.phase === "collapsed" && (
        <div className={`${PANEL} flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600`}>
          <span>{state.round + 1 >= state.options.rounds ? "곧 최종 결과가 나와요" : "곧 새 탑으로 다음 판을 시작해요"}</span>
          <button type="button" onClick={() => onAction({ type: "next" })} className={PRIMARY}>
            {state.round + 1 >= state.options.rounds ? "결과 보기" : "다음 판"}
          </button>
        </div>
      )}
      {state.phase === "ended" && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      {/* 점수판 */}
      {state.phase !== "ended" && (
        <div className={`${PANEL} grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3`}>
          {Array.from({ length: state.playerCount }, (_, s) => s).map((s) => (
            <div key={s} className={`flex min-w-0 items-center gap-1.5 text-xs ${s === state.activeSeat && state.phase !== "collapsed" ? "rounded-md bg-amber-500/15 px-1" : "px-1"}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${connectedSeats.has(s) ? "bg-emerald-400" : "bg-white/20"}`} />
              <span className={`min-w-0 flex-1 truncate ${s === viewerSeat ? "font-black text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>
                {botSeats.has(s) ? "🤖 " : ""}
                {names[s] ?? `${s + 1}번`}
                {s === viewerSeat ? " (나)" : ""}
              </span>
              <span className="font-bold text-amber-200 tabular-nums light:text-amber-700">{state.scores[s]}점</span>
              {state.collapses[s] > 0 && <span className="text-rose-300 light:text-rose-600">💥{state.collapses[s]}</span>}
            </div>
          ))}
        </div>
      )}

      {state.levels.length > START_LEVELS + 6 && state.phase === "pull" && <p className="text-center text-[11px] text-white/40 light:text-slate-400">탑이 {state.levels.length}층까지 올라갔어요 — 높을수록 조금씩 더 위험해요.</p>}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: WobbleTowerState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">🪵 최종 결과</h3>
      <ol className="flex flex-col gap-1.5">
        {rankings.map((r) => (
          <li key={r.seat} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${r.seat === viewerSeat ? "bg-amber-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-8 font-black text-amber-200 light:text-amber-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
            <span className="min-w-0 flex-1 truncate text-white/85 light:text-slate-700">{names[r.seat] ?? `${r.seat + 1}번`}</span>
            <span className="tabular-nums text-white/70 light:text-slate-600">{state.scores[r.seat]}점</span>
            <span className="text-xs text-rose-300 light:text-rose-600">💥{state.collapses[r.seat]}</span>
            <span className="text-xs text-white/50 light:text-slate-500">빼기 {state.pulls[r.seat]}</span>
          </li>
        ))}
      </ol>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
