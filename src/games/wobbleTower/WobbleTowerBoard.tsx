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
import { predictionPoints, REACTION_EMOJI, REACTION_TTL_MS, REACTIONS, type Prediction, type PredictionBoard, type Reaction, type ReactionKind } from "./reactions";

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
  /** Spectator layer (reactions.ts). */
  reactions: Reaction[];
  predictions: PredictionBoard;
  /** The current pull has visibly started — no more calls. */
  predictLocked: boolean;
  seer: Record<number, number>;
  /** Bumped on every 💨 — the 3D tower takes a puff of wind. */
  gust: MutableRefObject<number>;
  onReact: (kind: ReactionKind) => void;
  onPredict: (pick: Prediction) => void;
}

function loadQuality(): "high" | "low" {
  try {
    return window.localStorage.getItem(QUALITY_KEY) === "low" ? "low" : "high";
  } catch {
    return "high";
  }
}

/* ── 빼기: 3D에서 블록을 직접 잡아 끌기 (WebGL 없으면 막대) ─────────── */

interface PullView {
  hand: number;
  progress: number;
  strain: number;
  stuck: boolean;
  jerked: boolean;
  done: boolean;
}

/** Where my finger is — written by the board from the 3D drag (or the 2D slider), read by the pull loop. */
export interface HandState {
  hand: number;
  sign: number;
}

function PullControl({
  turn,
  coord,
  difficulty,
  seed,
  handRef,
  grabbed,
  slider,
  onSliderHand,
  onLive,
  onDone,
}: {
  turn: number;
  coord: Coord;
  difficulty: number;
  seed: number;
  handRef: MutableRefObject<HandState>;
  /** The 3D block has been grabbed — start the pull clock. */
  grabbed: boolean;
  /** No WebGL: show the drag bar instead of grabbing the block. */
  slider: boolean;
  onSliderHand: (hand: number) => void;
  onLive: (l: LivePull) => void;
  onDone: (quality: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const tracker = useRef<PullTracker | null>(null);
  const dragging = useRef(false);
  const lastT = useRef(0);
  const lastScrape = useRef(0);
  const wasStuck = useRef(false);
  const sentDone = useRef(false);
  const [view, setView] = useState<PullView>({ hand: 0, progress: 0, strain: 0, stuck: false, jerked: false, done: false });
  const [sliderStarted, setSliderStarted] = useState(false);
  const running = grabbed || sliderStarted;

  const onLiveRef = useRef(onLive);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onLiveRef.current = onLive;
    onDoneRef.current = onDone;
  }, [onLive, onDone]);

  // rAF loop once the block is held (keeps running while the finger rests, so a catch can release)
  useEffect(() => {
    if (!running) return;
    tracker.current ??= new PullTracker(pullFeel(difficulty, seed));
    let id = 0;
    lastT.current = performance.now();
    const frame = () => {
      const tr = tracker.current;
      if (!tr || tr.done) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT.current) / 1000);
      lastT.current = now;
      const before = tr.progress;
      const h = handRef.current;
      tr.step(h.hand, dt);
      const sound = getWobbleSound();
      if (tr.stuck && !wasStuck.current) sound.play("stuck");
      wasStuck.current = tr.stuck;
      if (tr.progress > before + 0.002 && now - lastScrape.current > 90) {
        lastScrape.current = now;
        sound.play("scrape", tr.strain);
      }
      onLiveRef.current({ turn, level: coord.level, slot: coord.slot, progress: tr.progress, strain: tr.strain, stuck: tr.stuck, jerked: tr.jerked, sign: h.sign, hand: h.hand, at: now });
      setView({ hand: h.hand, progress: tr.progress, strain: tr.strain, stuck: tr.stuck, jerked: tr.jerked, done: tr.done });
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
  }, [running, turn, coord.level, coord.slot, difficulty, seed, handRef]);

  const handFrom = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSliderHand(Math.min(1, Math.max(0, (clientX - r.left - 18) / Math.max(1, r.width - 36))));
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
            : slider
              ? "손잡이를 끝까지 천천히 끌어 빼요"
              : "👆 반짝이는 블록을 꾹 잡고, 빼고 싶은 쪽으로 천천히 끌어요";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={`font-bold break-keep ${view.stuck ? "animate-pulse text-rose-300 light:text-rose-600" : "text-amber-100 light:text-amber-800"}`}>{hint}</span>
        <span className="shrink-0 tabular-nums text-white/50 light:text-slate-500">{Math.round(view.progress * 100)}%</span>
      </div>
      {!slider && view.progress === 0 && !view.done && (
        <p className="text-[11px] break-keep text-white/45 light:text-slate-500">내 쪽으로 끌면 끝을 집어 당기고, 반대쪽으로 밀면 손가락으로 밀어내요. 손을 떼었다가 다시 잡아도 이어져요.</p>
      )}
      {slider && (
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
            setSliderStarted(true);
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
              setSliderStarted(true);
              onSliderHand(Math.min(1, view.hand + 0.03));
            }
          }}
        >
          <div className="pointer-events-none absolute inset-y-3 left-[18px] rounded-md bg-gradient-to-r from-amber-300 to-amber-500 opacity-80 transition-[width] duration-75" style={{ width: `calc((100% - 36px) * ${view.progress})` }} />
          <div
            className={`pointer-events-none absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-lg shadow-lg ${view.stuck ? "border-rose-400 bg-rose-500/80" : "border-amber-200 bg-amber-500"}`}
            style={{ left: `calc(18px + (100% - 36px) * ${view.hand})` }}
          >
            {view.stuck ? "🔒" : "✋"}
          </div>
        </div>
      )}
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

/* ── 관전: 예측 · 리액션 ──────────────────────────────────────── */

function SpectatorPanel({
  state,
  viewerSeat,
  names,
  activeName,
  activeIsBot,
  predictions,
  predictLocked,
  onPredict,
  onReact,
}: {
  state: WobbleTowerState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  activeName: string;
  activeIsBot: boolean;
  predictions: PredictionBoard;
  predictLocked: boolean;
  onPredict: (pick: Prediction) => void;
  onReact: (kind: ReactionKind) => void;
}) {
  const board = predictions.turn === state.turn ? predictions.picks : {};
  const mine = board[viewerSeat];
  const count = (pick: Prediction) => Object.values(board).filter((v) => v === pick).length;
  const who = (pick: Prediction) =>
    Object.entries(board)
      .filter(([, v]) => v === pick)
      .map(([seat]) => (Number(seat) === viewerSeat ? "나" : (names[Number(seat)] ?? "")))
      .join(", ");
  const canCall = state.phase === "pull" && !predictLocked;
  const btn = (pick: Prediction, label: string, tone: string) => (
    <button
      type="button"
      disabled={!canCall && mine !== pick}
      onClick={() => onPredict(pick)}
      title={who(pick)}
      className={`flex min-w-0 flex-1 flex-col items-center rounded-xl border px-2 py-1.5 text-sm font-bold transition disabled:opacity-40 ${mine === pick ? tone : "border-white/15 text-white/75 hover:border-white/30 light:border-slate-300 light:text-slate-700"}`}
    >
      <span>{label}</span>
      <span className="text-[11px] font-normal opacity-80">{count(pick)}명{mine === pick ? " · 내 예측" : ""}</span>
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-xs text-white/60 light:text-slate-500">
        {activeIsBot ? "🤖 " : ""}
        {activeName}님이 {state.phase === "pull" ? "블록을 빼고" : state.phase === "place" ? "블록을 올리고" : "기다리고"} 있어요
      </p>
      {state.phase === "pull" && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-violet-200 light:text-violet-700">🔮 이번 빼기는? {predictLocked ? "(당기기 시작 — 마감)" : "맞히면 +1, 무너짐을 맞히면 +2"}</span>
          <div className="flex gap-2">
            {btn("stand", "🙂 버틴다", "border-emerald-400 bg-emerald-500/20 text-emerald-100 light:text-emerald-800")}
            {btn("fall", "💥 무너진다", "border-rose-400 bg-rose-500/20 text-rose-100 light:text-rose-800")}
          </div>
        </div>
      )}
      <ReactionBar onReact={onReact} allowBlow={state.phase === "pull" && state.activeSeat !== viewerSeat} />
    </div>
  );
}

function ReactionBar({ onReact, allowBlow }: { onReact: (kind: ReactionKind) => void; allowBlow: boolean }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {REACTIONS.filter((r) => r.kind !== "blow" || allowBlow).map((r) => (
        <button
          key={r.kind}
          type="button"
          onClick={() => onReact(r.kind)}
          aria-label={r.label}
          title={r.kind === "blow" ? "입김 — 차례마다 한 번, 모두의 화면에서 탑이 살짝 흔들려요(판정엔 영향 없음)" : r.label}
          className="flex h-10 min-w-10 items-center justify-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 text-lg transition hover:scale-110 hover:border-white/30 active:scale-95 light:border-slate-300 light:bg-white"
        >
          {r.emoji}
          {r.kind === "blow" && <span className="text-[11px] text-white/60 light:text-slate-500">입김</span>}
        </button>
      ))}
    </div>
  );
}

/** Reactions float up over the stage from each sender's column. */
function ReactionLayer({ reactions, names, playerCount, viewerSeat, nowMs }: { reactions: Reaction[]; names: Record<Seat, string>; playerCount: number; viewerSeat: Seat; nowMs: number }) {
  const shown = reactions.filter((r) => nowMs - r.at < REACTION_TTL_MS);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`@keyframes wbt-float{0%{transform:translate(-50%,0) scale(.6);opacity:0}12%{transform:translate(-50%,-14px) scale(1.15);opacity:1}75%{opacity:1}100%{transform:translate(-50%,-150px) scale(1);opacity:0}}`}</style>
      {shown.map((r) => {
        const x = 10 + (playerCount > 1 ? r.seat / (playerCount - 1) : 0.5) * 80;
        return (
          <div key={r.id} className="absolute bottom-6 flex flex-col items-center" style={{ left: `${x}%`, animation: `wbt-float ${REACTION_TTL_MS}ms ease-out forwards` }}>
            <span className="text-4xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">{REACTION_EMOJI[r.kind]}</span>
            <span className="max-w-24 truncate rounded-full bg-black/60 px-2 text-[10px] font-bold text-white">{r.seat === viewerSeat ? "나" : (names[r.seat] ?? "")}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── 보드 ─────────────────────────────────────────────────── */

export default function WobbleTowerBoard({
  state,
  viewerSeat,
  names,
  connectedSeats,
  botSeats,
  canDrive,
  deadlineMs,
  nowMs,
  live,
  onLive,
  onAction,
  onGameEnd,
  reactions,
  predictions,
  predictLocked,
  seer,
  gust,
  onReact,
  onPredict,
}: Props) {
  const [canWebgl] = useState(webglAvailable);
  const [quality, setQuality] = useState<"high" | "low">(loadQuality);
  const [rules, setRules] = useState(false);
  const [pick, setPick] = useState<{ turn: number; coord: Coord } | null>(null);
  const [pulling, setPulling] = useState<number | null>(null);
  /** Turn on which I grabbed the selected block in 3D (starts the pull clock). */
  const [grabbedTurn, setGrabbedTurn] = useState<number | null>(null);
  const hand = useRef<HandState>({ hand: 0, sign: 0 });

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
      setGrabbedTurn(null);
      hand.current = { hand: 0, sign: 0 };
      getWobbleSound().play("select");
      window.setTimeout(() => getWobbleSound().play("wiggle"), 120);
      onLive({ turn: state.turn, level: c.level, slot: c.slot, progress: 0, strain: 0, stuck: false, jerked: false, sign: 0, hand: 0, at: performance.now() });
    },
    [pulling, state.turn, onLive],
  );

  const onGrab = useCallback(() => setGrabbedTurn(state.turn), [state.turn]);
  const onHand = useCallback((h: number, sign: number) => {
    hand.current = { hand: Math.max(hand.current.hand, h), sign };
  }, []);
  const onSliderHand = useCallback((h: number) => {
    hand.current = { hand: Math.max(hand.current.hand, h), sign: hand.current.sign };
  }, []);

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
  // 🔮 my call on the pull that just landed
  const lastPull = state.lastEvent?.kind === "pull" ? state.lastEvent : null;
  const myCall = lastPull && predictions.turn === lastPull.turn ? predictions.picks[viewerSeat] : undefined;
  const myCallPts = myCall && lastPull ? predictionPoints(myCall, lastPull.collapsed) : 0;
  const topSeer = Object.entries(seer).sort((a, b) => b[1] - a[1])[0];
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
            grabbable={myTurn && state.phase === "pull" && !!selected}
            onGrab={onGrab}
            onHand={onHand}
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
            gust={gust}
          />
        ) : (
          <Tower2D state={state} legal={legal} selected={selected} onSelect={select} />
        )}
        <ReactionLayer reactions={reactions} names={names} playerCount={state.playerCount} viewerSeat={viewerSeat} nowMs={nowMs} />
        {myCall && lastPull && state.turn === lastPull.turn + 1 && (
          <span className={`pointer-events-none absolute top-11 left-2 rounded-full px-3 py-1 text-xs font-black ${myCallPts > 0 ? "bg-violet-500/90 text-white" : "bg-black/60 text-white/70"}`}>
            🔮 {myCallPts > 0 ? `예측 적중 +${myCallPts}` : "예측 빗나감"}
          </span>
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
                handRef={hand}
                grabbed={grabbedTurn === state.turn}
                slider={!canWebgl}
                onSliderHand={onSliderHand}
                onLive={(l) => {
                  if (l.progress > 0 && pulling !== state.turn) setPulling(state.turn);
                  onLive(l);
                }}
                onDone={finishPull}
              />
            </div>
          ) : (
            <p className="text-center text-sm text-white/70 light:text-slate-600">🫵 뺄 블록을 탑에서 눌러 고르세요. 어두운 블록은 뺄 수 없어요. 빈 곳을 끌면 탑을 돌려볼 수 있어요.</p>
          )}
        </div>
      )}
      {myTurn && state.phase === "place" && (
        <div className={PANEL}>
          <PlacePicker state={state} onPlace={place} />
        </div>
      )}
      {!myTurn && (state.phase === "pull" || state.phase === "place") && (
        <div className={PANEL}>
          <SpectatorPanel
            state={state}
            viewerSeat={viewerSeat}
            names={names}
            activeName={activeName}
            activeIsBot={activeIsBot}
            predictions={predictions}
            predictLocked={predictLocked}
            onPredict={onPredict}
            onReact={onReact}
          />
        </div>
      )}
      {state.phase === "collapsed" && (
        <div className={`${PANEL} flex flex-col gap-2`}>
          <div className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
            <span>{state.round + 1 >= state.options.rounds ? "곧 최종 결과가 나와요" : "곧 새 탑으로 다음 판을 시작해요"}</span>
            <button type="button" onClick={() => onAction({ type: "next" })} className={PRIMARY}>
              {state.round + 1 >= state.options.rounds ? "결과 보기" : "다음 판"}
            </button>
          </div>
          <ReactionBar onReact={onReact} allowBlow={false} />
        </div>
      )}
      {state.phase === "ended" && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} seer={seer} onGameEnd={onGameEnd} />}

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
              {(seer[s] ?? 0) > 0 && <span className="text-violet-300 light:text-violet-700">🔮{seer[s]}</span>}
            </div>
          ))}
        </div>
      )}

      {state.levels.length > START_LEVELS + 6 && state.phase === "pull" && <p className="text-center text-[11px] text-white/40 light:text-slate-400">탑이 {state.levels.length}층까지 올라갔어요 — 높을수록 조금씩 더 위험해요.</p>}

      {topSeer && topSeer[1] > 0 && state.phase !== "ended" && (
        <p className="text-center text-[11px] text-violet-200/70 light:text-violet-700">🔮 지금 최고의 예언가: {Number(topSeer[0]) === viewerSeat ? "나" : names[Number(topSeer[0])]} ({topSeer[1]}점) — 남의 차례엔 버틴다/무너진다를 찍어 보세요</p>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, seer, onGameEnd }: { state: WobbleTowerState; viewerSeat: Seat; names: Record<Seat, string>; seer: Record<number, number>; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  const best = Object.entries(seer).sort((a, b) => b[1] - a[1])[0];
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
      {best && best[1] > 0 && (
        <p className="text-center text-sm text-violet-200 light:text-violet-700">
          🔮 최고의 예언가 <b>{Number(best[0]) === viewerSeat ? "나" : names[Number(best[0])]}</b> ({best[1]}점)
        </p>
      )}
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
