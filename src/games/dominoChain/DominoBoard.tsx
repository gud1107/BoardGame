"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  allowedDirs,
  BOMB_PENALTY,
  canWall,
  colOf,
  computeRankings,
  DIR_ARROWS,
  DIRS,
  frontier,
  LONGEST_BONUS,
  previewTopple,
  rowOf,
  TICK_MS,
  TURN_TIMEOUT_MS,
  totals,
  type DominoState,
  type EngineAction,
  type RoundResult,
  type Seat,
} from "./engine";
import { LEAD_IN_MS, scoreAt, toppleAt, toppleLengthMs } from "./anim";
import { SEAT_COLORS, SEAT_SYMBOLS } from "./colors";
import { dominoCues, getDominoSound } from "./dominoSound";
import RulebookModal from "./RulebookModal";
import type { SceneShared } from "./three/DominoScene";

const Loading3D = () => <div className="flex h-full items-center justify-center bg-[#1d1a26] text-xs text-amber-200/60">🁢 도미노 세우는 중…</div>;
const DominoScene = dynamic(() => import("./three/DominoScene"), { ssr: false, loading: Loading3D });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-amber-400 disabled:opacity-40";
const QUALITY_KEY = "domino-chain-quality";
const TOPVIEW_KEY = "domino-chain-topview";

type Tool = "domino" | "split" | "wall";

interface Props {
  state: DominoState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  canDrive: boolean;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
  onBusy: (busy: boolean) => void;
}

function loadFlag(key: string, on: string): boolean {
  try {
    return window.localStorage.getItem(key) === on;
  } catch {
    return false;
  }
}
function saveFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function webglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

function SeatTag({ seat, names, me }: { seat: Seat; names: Record<Seat, string>; me: Seat }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-semibold">
      <span aria-hidden style={{ color: SEAT_COLORS[seat % 4] }}>
        {SEAT_SYMBOLS[seat % 4]}
      </span>
      <span className="truncate">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

/* ── 2D 대체 화면 ─────────────────────────────────────────────────── */

function Board2D({
  state,
  open,
  wallCells,
  selected,
  ghost,
  predicted,
  result,
  toppleMs,
  onCell,
}: {
  state: DominoState;
  open: Set<number>;
  wallCells: Set<number> | null;
  selected: number | null;
  ghost: { kind: Tool; dir: number } | null;
  predicted: Map<number, number> | null;
  result: RoundResult | null;
  toppleMs: number;
  onCell: (i: number) => void;
}) {
  const n = state.size;
  const anim = toppleMs >= 0 && result ? toppleAt(result, toppleMs) : null;
  const marks = wallCells ?? open;
  return (
    <div className="flex h-full items-center justify-center bg-[#1d1a26] p-2">
      <svg viewBox={`-0.6 -0.6 ${n + 0.2} ${n + 0.2}`} className="aspect-square h-full max-h-full w-auto max-w-full touch-manipulation select-none">
        <rect x={-0.5} y={-0.5} width={n} height={n} fill="#e8dcc2" rx={0.1} />
        {state.cells.map((cell, i) => {
          const c = colOf(n, i);
          const r = rowOf(n, i);
          const a = anim?.get(i);
          const p = cell.piece;
          const f = cell.feature;
          const fallen = a?.kind === "fall" && a.fall >= 1;
          const owner = a?.kind === "fall" ? a.owner : (p?.owner ?? -1);
          const pred = predicted?.get(i);
          return (
            <g key={i} onClick={() => onCell(i)} style={{ cursor: marks.has(i) ? "pointer" : "default" }}>
              <rect x={c - 0.5} y={r - 0.5} width={1} height={1} fill={marks.has(i) ? (wallCells ? "rgba(148,163,184,0.45)" : `${SEAT_COLORS[state.activeSeat % 4]}55`) : "transparent"} stroke="#b39f7a" strokeWidth={0.02} />
              {selected === i && <rect x={c - 0.46} y={r - 0.46} width={0.92} height={0.92} fill="none" stroke="#fff" strokeWidth={0.07} />}
              {f?.kind === "bell" && (
                <g opacity={a?.kind === "ring" ? 0.5 : 1}>
                  <circle cx={c} cy={r} r={0.3 + f.value * 0.03} fill={a?.kind === "ring" ? (a.owners.length === 1 ? SEAT_COLORS[a.owners[0] % 4] : "#fff") : "#f2c14e"} stroke="#7a5a12" strokeWidth={0.05} />
                  <text x={c} y={r + 0.13} fontSize={0.36} fontWeight={900} textAnchor="middle" fill="#3b2a00">
                    🔔{f.value}
                  </text>
                </g>
              )}
              {f?.kind === "bomb" && a?.kind !== "boom" && (
                <text x={c} y={r + 0.18} fontSize={0.6} textAnchor="middle">
                  💣
                </text>
              )}
              {f?.kind === "bomb" && a?.kind === "boom" && <circle cx={c} cy={r} r={0.4 + Math.min(1, a.since / 3) * 0.9} fill="#fb923c" opacity={Math.max(0, 1 - a.since / 3)} />}
              {f?.kind === "rock" && <polygon points={`${c - 0.35},${r + 0.2} ${c - 0.1},${r - 0.35} ${c + 0.3},${r - 0.2} ${c + 0.35},${r + 0.25}`} fill="#6b6f76" />}
              {p?.kind === "wall" && <rect x={c - 0.42} y={r - 0.42} width={0.84} height={0.84} fill="#8b8f98" stroke="#4b5563" strokeWidth={0.05} />}
              {p && p.kind !== "wall" && (
                <g transform={`translate(${c} ${r}) rotate(${(Math.atan2(DIRS[p.dir][1], DIRS[p.dir][0]) * 180) / Math.PI})`} opacity={fallen ? 0.55 : 1}>
                  {fallen ? (
                    <rect x={0.05} y={-0.24} width={0.82} height={0.48} rx={0.05} fill={SEAT_COLORS[owner % 4]} stroke="#111" strokeWidth={0.03} />
                  ) : (
                    <rect x={-0.08} y={-0.26} width={0.16} height={0.52} rx={0.03} fill={SEAT_COLORS[owner % 4]} stroke={pred !== undefined && pred !== p.owner && pred >= 0 ? SEAT_COLORS[pred % 4] : "#111"} strokeWidth={pred !== undefined && pred !== p.owner && pred >= 0 ? 0.08 : 0.03} />
                  )}
                  {!fallen && (
                    <path d={p.kind === "split" ? "M0.12 -0.2 L0.4 -0.38 M0.12 0.2 L0.4 0.38" : "M0.12 0 L0.4 0 M0.3 -0.1 L0.4 0 L0.3 0.1"} stroke="#111" strokeWidth={0.06} fill="none" strokeLinecap="round" />
                  )}
                  {p.kind === "pusher" && <rect x={-0.3} y={-0.3} width={0.42} height={0.6} fill={SEAT_COLORS[p.owner % 4]} stroke="#111" strokeWidth={0.04} />}
                </g>
              )}
              {selected === i && ghost && ghost.kind !== "wall" && (
                <g transform={`translate(${c} ${r}) rotate(${(Math.atan2(DIRS[ghost.dir][1], DIRS[ghost.dir][0]) * 180) / Math.PI})`} opacity={0.6}>
                  <rect x={-0.08} y={-0.26} width={0.16} height={0.52} fill={SEAT_COLORS[state.activeSeat % 4]} />
                  <path d={ghost.kind === "split" ? "M0.12 -0.2 L0.4 -0.38 M0.12 0.2 L0.4 0.38" : "M0.12 0 L0.4 0"} stroke="#111" strokeWidth={0.06} />
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── 방향 고르기 ───────────────────────────────────────────────────── */

/** 3×3 compass: the eight facings at their screen spots (rotated so my side is down), centre = cancel. */
function Compass({ allowed, onPick, onHover, onCancel, viewSide }: { allowed: number[]; onPick: (d: number) => void; onHover: (d: number) => void; onCancel: () => void; viewSide: number }) {
  // board direction → screen grid slot: rotate by the viewer's side (south = no turn)
  const turn = [0, 6, 4, 2][viewSide] ?? 0;
  const slots: (number | null)[] = Array(9).fill(null);
  for (let d = 0; d < 8; d++) {
    const sd = (d + turn) % 8;
    const [dc, dr] = DIRS[sd];
    slots[(dr + 1) * 3 + (dc + 1)] = d;
  }
  return (
    <div className="grid w-fit grid-cols-3 gap-1">
      {slots.map((d, k) =>
        k === 4 ? (
          <button key={k} type="button" onClick={onCancel} className="h-11 w-11 rounded-lg border border-white/20 text-xs text-white/70 light:border-slate-300 light:text-slate-600" aria-label="취소">
            ✕
          </button>
        ) : d === null ? (
          <span key={k} />
        ) : (
          <button
            key={k}
            type="button"
            disabled={!allowed.includes(d)}
            onPointerEnter={() => allowed.includes(d) && onHover(d)}
            onFocus={() => allowed.includes(d) && onHover(d)}
            onClick={() => onPick(d)}
            aria-label={`${DIR_ARROWS[(d + turn) % 8]} 방향으로 세우기`}
            className="h-11 w-11 rounded-lg border border-amber-300/60 bg-amber-400/15 text-lg font-black text-amber-100 disabled:border-white/5 disabled:bg-transparent disabled:text-white/15 light:text-amber-800 light:disabled:text-slate-300"
          >
            {DIR_ARROWS[(d + turn) % 8]}
          </button>
        ),
      )}
    </div>
  );
}

/* ── 보드 ───────────────────────────────────────────────────────────── */

export default function DominoBoard({ state, viewerSeat, names, connectedSeats, botSeats, canDrive, deadlineMs, nowMs, onAction, onGameEnd, onBusy }: Props) {
  const [canWebgl, setCanWebgl] = useState(true);
  const [quality, setQuality] = useState<"high" | "low">("high");
  const [topView, setTopView] = useState(false);
  const [rules, setRules] = useState(false);
  const [tool, setTool] = useState<Tool>("domino");
  const [selected, setSelected] = useState<number | null>(null);
  const [ghostDir, setGhostDir] = useState(6);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const [toppleMs, setToppleMs] = useState(-1);
  const shared = useRef<SceneShared>({ toppleMs: -1 });

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setCanWebgl(webglOk());
    setQuality(loadFlag(QUALITY_KEY, "low") ? "low" : "high");
    setTopView(loadFlag(TOPVIEW_KEY, "1"));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const building = state.phase === "build";
  const myTurn = building && state.activeSeat === viewerSeat;
  const canPlay = myTurn && sentTurn !== state.turn;
  const open = useMemo(() => (canPlay && tool !== "wall" ? new Set(frontier(state, viewerSeat).keys()) : new Set<number>()), [canPlay, tool, state, viewerSeat]);
  const wallCells = useMemo(() => (canPlay && tool === "wall" && state.wallsLeft[viewerSeat] > 0 ? new Set(state.cells.map((_, i) => i).filter((i) => canWall(state, i))) : null), [canPlay, tool, state, viewerSeat]);
  const allowed = selected !== null && tool !== "wall" ? allowedDirs(state, viewerSeat, selected) : [];
  const preview = useMemo(() => (building && state.options.preview ? previewTopple(state) : null), [building, state]);
  const predicted = useMemo(() => {
    if (!preview) return null;
    const m = new Map<number, number>();
    for (const e of preview.events) if (e.kind === "fall") m.set(e.cell, e.owner);
    return m;
  }, [preview]);
  const side = (() => {
    const sides = state.playerCount <= 2 ? [0, 2] : state.playerCount === 3 ? [0, 1, 3] : [0, 1, 2, 3];
    return sides[Math.max(0, viewerSeat)] ?? 0;
  })();

  // reset the picker when the turn moves on
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(null);
  }, [state.turn]);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (tool === "split" && state.splitsLeft[viewerSeat] <= 0) setTool("domino");
    if (tool === "wall" && state.wallsLeft[viewerSeat] <= 0) setTool("domino");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tool, state.splitsLeft, state.wallsLeft, viewerSeat]);

  // ── topple playback clock
  const result = state.phase === "topple" || state.phase === "ended" ? state.result : null;
  const resultKey = result ? `${state.seed}:${result.round}` : null;
  const played = useRef<{ key: string | null; idx: number; start: number }>({ key: null, idx: 0, start: 0 });
  useEffect(() => {
    if (!result || !resultKey) {
      shared.current.toppleMs = -1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToppleMs(-1);
      onBusy(false);
      return;
    }
    if (played.current.key !== resultKey) played.current = { key: resultKey, idx: 0, start: performance.now() };
    const total = toppleLengthMs(result);
    onBusy(true);
    let raf = 0;
    let chainSeen = 0;
    const sound = getDominoSound();
    const tick = () => {
      const ms = performance.now() - played.current.start;
      shared.current.toppleMs = Math.min(ms, total);
      setToppleMs(Math.min(ms, total));
      // fire SFX for events whose tick came up
      const t = (ms - LEAD_IN_MS) / TICK_MS;
      while (played.current.idx < result.events.length && result.events[played.current.idx].t <= t) {
        const e = result.events[played.current.idx++];
        if (e.kind === "fall") {
          if (e.t === 0) sound.play("push");
          else {
            chainSeen++;
            if (chainSeen % 2 === 0 || result.events.length < 40) sound.play("clack", Math.min(1, e.t / Math.max(1, result.ticks)));
            if (e.was !== e.owner && e.was >= 0) sound.play("steal");
          }
        } else if (e.kind === "ring") sound.play("bell", state.cells[e.cell].feature?.value ?? 1);
        else if (e.kind === "boom") sound.play("boom");
      }
      if (ms < total) raf = window.requestAnimationFrame(tick);
      else {
        sound.play("roundEnd");
        onBusy(false);
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [result, resultKey, onBusy, state.cells]);
  const toppleDone = !!result && toppleMs >= toppleLengthMs(result);

  // auto next round (driver only)
  useEffect(() => {
    if (!canDrive || state.phase !== "topple" || !toppleDone) return;
    const id = window.setTimeout(() => onAction({ type: "next" }), 6500);
    return () => window.clearTimeout(id);
  }, [canDrive, state.phase, toppleDone, onAction]);

  const bgmLevel = state.phase === "topple" && !toppleDone ? 1 : 0;
  useSuiteBgm(getDominoSound, state.phase !== "ended" || !toppleDone, bgmLevel);
  const classify = useMemo(() => dominoCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getDominoSound, classify);

  const place = useCallback(
    (cell: number, kind: Tool, dir: number) => {
      if (!canPlay) return;
      setSentTurn(state.turn);
      setSelected(null);
      onAction({ type: "place", seat: viewerSeat, cell, kind, dir });
    },
    [canPlay, state.turn, onAction, viewerSeat],
  );
  // a new turn index frees the "sent" lock (two placements per turn)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sentTurn !== null && sentTurn !== state.turn) setSentTurn(null);
  }, [state.turn, sentTurn]);

  const onCell = useCallback(
    (cell: number) => {
      if (!canPlay) return;
      getDominoSound().play("ui");
      if (tool === "wall") {
        if (wallCells?.has(cell)) setSelected(cell);
        else getDominoSound().play("denied");
        return;
      }
      if (!open.has(cell)) {
        getDominoSound().play("denied");
        return;
      }
      setSelected(cell);
      const dirs = allowedDirs(state, viewerSeat, cell);
      // default the ghost to "straight on"
      const arr = frontier(state, viewerSeat).get(cell) ?? [];
      setGhostDir(arr[0] !== undefined && dirs.includes(arr[0]) ? arr[0] : (dirs[0] ?? 0));
      getDominoSound().play("pick");
    },
    [canPlay, tool, wallCells, open, state, viewerSeat],
  );

  const onFps = useCallback((fps: number) => {
    if (fps < 28)
      setQuality((q) => {
        if (q === "low") return q;
        saveFlag(QUALITY_KEY, "low");
        return "low";
      });
  }, []);

  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const activeName = names[state.activeSeat] ?? `${state.activeSeat + 1}번`;
  const activeIsBot = botSeats.has(state.activeSeat);
  const running = result && toppleMs >= 0 ? scoreAt(result, toppleMs, (c) => state.cells[c].feature?.value ?? 0, state.playerCount) : null;
  const shownScores = state.phase === "topple" && running && result && !toppleDone ? state.scores.map((s, i) => s - result.points[i] + running[i]) : state.scores;
  const passNote = state.lastPass && state.lastPass.turn === state.turn - 1 ? `${state.lastPass.seat === viewerSeat ? "내" : `${names[state.lastPass.seat] ?? ""}님의`} 차례가 ${state.lastPass.timeout ? "시간 초과로 " : ""}넘어갔어요` : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          🁢 {state.options.rounds > 1 ? `${state.round + 1}/${state.options.rounds}라운드` : "단판"} · {building ? "🧱 쌓기" : state.phase === "topple" ? "💥 와르르" : "끝"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {canWebgl && (
            <>
              <button
                type="button"
                onClick={() =>
                  setTopView((v) => {
                    saveFlag(TOPVIEW_KEY, v ? "0" : "1");
                    return !v;
                  })
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${topView ? "border-amber-400 text-amber-200 light:text-amber-700" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-600"}`}
              >
                🎥 {topView ? "위에서" : "비스듬히"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = quality === "high" ? "low" : "high";
                  setQuality(next);
                  saveFlag(QUALITY_KEY, next);
                }}
                className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600"
              >
                {quality === "high" ? "✨ 고화질" : "⚡ 가볍게"}
              </button>
            </>
          )}
          <SuiteSoundHud suite={getDominoSound} icon="🁢" label="Clockwork Workshop" preview="bell" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      <div className="relative h-[60vh] max-h-[680px] min-h-[340px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {canWebgl ? (
          <DominoScene
            state={state}
            viewerSeat={viewerSeat}
            open={open}
            wallCells={wallCells}
            selected={selected}
            ghost={selected !== null ? { kind: tool, dir: ghostDir } : null}
            predicted={predicted}
            result={result}
            shared={shared}
            onCell={onCell}
            topView={topView}
            quality={quality}
            onFps={onFps}
          />
        ) : (
          <Board2D state={state} open={open} wallCells={wallCells} selected={selected} ghost={selected !== null ? { kind: tool, dir: ghostDir } : null} predicted={predicted} result={result} toppleMs={toppleMs} onCell={onCell} />
        )}
        {building && (
          <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
            <span style={{ color: SEAT_COLORS[state.activeSeat % 4] }}>{SEAT_SYMBOLS[state.activeSeat % 4]}</span>
            {myTurn ? "🫵 내 차례" : `${activeIsBot ? "🤖 " : ""}${activeName}`}
            <span className="text-amber-300">{"●".repeat(Math.max(0, state.placementsLeft))} 남음</span>
            {remaining !== null && <span className={`tabular-nums ${remaining <= 8 ? "text-rose-300" : "text-white/60"}`}>{remaining}s</span>}
          </div>
        )}
        {state.phase === "topple" && result && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-3">
            <span className="rounded-full bg-black/65 px-4 py-1.5 text-sm font-black text-white">{toppleDone ? "🏁 라운드 결과" : toppleMs < LEAD_IN_MS ? "🥁 준비… 밀어!" : "💥 와르르—"}</span>
          </div>
        )}
        {state.phase === "topple" && result && toppleDone && (
          <div className="absolute inset-x-3 top-12 z-10 mx-auto max-w-sm rounded-2xl border border-white/15 bg-slate-950/85 p-3 text-center text-white shadow-2xl">
            <p className="text-xs text-white/60">{state.round + 1}라운드 결과</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {Array.from({ length: state.playerCount }, (_, s) => s)
                .sort((a, b) => result.points[b] - result.points[a])
                .map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2">
                    <SeatTag seat={s} names={names} me={viewerSeat} />
                    <span className="text-xs text-white/70 tabular-nums">
                      🔔{result.bells[s]} · 🁢{result.chain[s]}
                      {result.steals[s] > 0 && <span className="text-amber-300"> · 🦝{result.steals[s]}</span>}
                      {result.bombs[s] > 0 && <span className="text-rose-300"> · 💣−{result.bombs[s] * BOMB_PENALTY}</span>}
                      {result.longest.includes(s) && <span className="text-emerald-300"> · 🏁+{result.longest.length === 1 ? LONGEST_BONUS : 1}</span>}
                      <b className="ml-2 text-sm text-white">{result.points[s] >= 0 ? "+" : ""}{result.points[s]}</b>
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      {remaining !== null && building && (
        <div className="-mt-1 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full transition-[width] duration-300 ${remaining <= 8 ? "bg-rose-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, ((remaining * 1000) / TURN_TIMEOUT_MS) * 100)}%` }} />
        </div>
      )}

      {building && (
        <div className={`${PANEL} flex flex-col gap-2 text-sm text-white/75 light:text-slate-600`}>
          {canPlay ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: "domino", label: "🁢 도미노", n: Infinity },
                    { id: "split", label: "🔀 갈림길", n: state.splitsLeft[viewerSeat] },
                    { id: "wall", label: "🧱 벽", n: state.wallsLeft[viewerSeat] },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={t.n <= 0}
                    aria-pressed={tool === t.id}
                    onClick={() => {
                      setTool(t.id);
                      setSelected(null);
                    }}
                    className={`min-h-10 rounded-xl border px-3 py-1.5 text-xs font-bold disabled:opacity-30 ${tool === t.id ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-600"}`}
                  >
                    {t.label}
                    {Number.isFinite(t.n) ? ` ×${t.n}` : ""}
                  </button>
                ))}
                <button type="button" onClick={() => onAction({ type: "pass", seat: viewerSeat })} className="ml-auto min-h-10 rounded-xl border border-white/15 px-3 py-1.5 text-xs text-white/60 light:border-slate-300 light:text-slate-500">
                  ⏭ 차례 넘기기
                </button>
              </div>
              {selected === null ? (
                <p className="break-keep text-xs">
                  {tool === "wall"
                    ? "🧱 회색으로 빛나는 칸을 눌러 벽을 세워요 — 상대 사슬을 막아요."
                    : open.size === 0
                      ? "내 사슬 끝이 다 막혔어요. 🧱 벽을 쓰거나 차례를 넘겨요."
                      : "👆 내 색으로 빛나는 칸(사슬 끝)을 눌러 놓을 자리를 골라요. 이번 차례에 2개!"}
                </p>
              ) : tool === "wall" ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => place(selected, "wall", 0)} className={PRIMARY}>
                    🧱 여기에 벽
                  </button>
                  <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-white/15 px-3 py-2 text-xs text-white/70 light:border-slate-300">
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Compass allowed={allowed} viewSide={canWebgl ? side : 0} onHover={setGhostDir} onPick={(d) => place(selected, tool, d)} onCancel={() => setSelected(null)} />
                  <p className="break-keep text-xs text-white/60 light:text-slate-500">
                    쓰러질 방향을 골라요 (들어온 방향에서 좌우 90°까지). {tool === "split" ? "🔀 갈림길은 앞쪽 두 대각선으로 갈라져요." : "화살표 쪽 칸으로 쓰러져요."}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-center break-keep">
              {myTurn ? "놓았어요!" : `${activeIsBot ? "🤖 " : ""}${activeName}님이 도미노를 세우고 있어요`}
              {passNote && <span className="mt-1 block text-xs text-white/45 light:text-slate-400">{passNote}</span>}
            </p>
          )}
        </div>
      )}
      {state.phase === "topple" && toppleDone && (
        <div className={`${PANEL} flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600`}>
          <span>{state.round + 1 >= state.options.rounds ? "곧 최종 결과" : "곧 새 판 — 1등이 먼저(한 개만) 쌓아요"}</span>
          <button type="button" onClick={() => onAction({ type: "next" })} className={PRIMARY}>
            {state.round + 1 >= state.options.rounds ? "결과 보기" : "다음 라운드"}
          </button>
        </div>
      )}
      {state.phase === "ended" && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      {state.phase !== "ended" && (
        <div className={`${PANEL} grid grid-cols-1 gap-1.5 sm:grid-cols-2`}>
          {Array.from({ length: state.playerCount }, (_, s) => s).map((s) => (
            <div key={s} className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs ${s === state.activeSeat && building ? "bg-amber-500/15" : ""}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${connectedSeats.has(s) ? "bg-emerald-400" : "bg-white/20"}`} />
              <span className={`min-w-0 flex-1 truncate ${s === viewerSeat ? "font-black text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>
                {botSeats.has(s) ? "🤖 " : ""}
                <SeatTag seat={s} names={names} me={viewerSeat} />
              </span>
              {building && <span className="shrink-0 text-white/45 light:text-slate-400">차례 {state.turnsLeft[s]} · 🔀{state.splitsLeft[s]} 🧱{state.wallsLeft[s]}</span>}
              {building && preview && <span className="shrink-0 text-sky-200/80 tabular-nums light:text-sky-700">🔮{preview.points[s] >= 0 ? "+" : ""}{preview.points[s]}</span>}
              <b className="shrink-0 text-sm text-amber-200 tabular-nums light:text-amber-700">{shownScores[s]}점</b>
            </div>
          ))}
          {building && preview && <p className="col-span-full text-[11px] text-white/40 light:text-slate-400">🔮 = 지금 모두 쓰러지면 이번 라운드에 얻을 점수 (테두리가 다른 색인 도미노는 그 색 사슬이 먼저 닿아 빼앗겨요)</p>}
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: DominoState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">🁢 최종 결과</h3>
      <ol className="flex flex-col gap-1.5">
        {rankings.map((r) => {
          const t = totals(state, r.seat);
          return (
            <li key={r.seat} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${r.seat === viewerSeat ? "bg-amber-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
              <span className="w-8 font-black text-amber-200 light:text-amber-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
              <span className="min-w-0 flex-1 truncate text-white/85 light:text-slate-700">
                <SeatTag seat={r.seat} names={names} me={viewerSeat} />
              </span>
              <span className="text-xs text-white/50 light:text-slate-500">
                🔔{t.bells} · 🁢{t.chain}
              </span>
              <b className="tabular-nums text-white light:text-slate-900">{state.scores[r.seat]}점</b>
            </li>
          );
        })}
      </ol>
      <p className="text-center text-[11px] text-white/45 light:text-slate-400">동점이면 울린 종 수 → 쓰러뜨린 도미노 수</p>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
