"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  AIM_TIMEOUT_MS,
  ballValue,
  CAROM_SHOT_LIMIT,
  canPlace,
  computeRankings,
  CUE_ID,
  isPocket,
  lowestBall,
  POCKET_SHOT_LIMIT,
  quantizeShot,
  quantizeSpin,
  RED_A,
  type BilliardsState,
  type EngineAction,
  type Seat,
} from "./engine";
import { HALF_H, HALF_W, POCKETS, R, speedForPower } from "./physics";
import { aimGuide, type LiveAim } from "./live";
import { ReplayPlayer, type BallView, type ReplayEvent } from "./replay";
import { billiardsCues, getBilliardsSound } from "./billiardsSound";
import { BALL_COLORS, CAROM_COLORS } from "./three/ballTextures";
import RulebookModal from "./RulebookModal";

const Loading3D = () => <div className="flex h-full items-center justify-center bg-[#140d0a] text-xs text-emerald-200/60">🎱 당구대 펴는 중…</div>;
const PoolScene = dynamic(() => import("./three/PoolScene"), { ssr: false, loading: Loading3D });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-40";
const QUALITY_KEY = "billiards-quality";
const TOPVIEW_KEY = "billiards-topview";
const SEAT_COLORS = ["#f97316", "#38bdf8", "#a3e635", "#f472b6"] as const;
const SEAT_SYMBOLS = ["●", "▲", "■", "◆"] as const;

interface Props {
  state: BilliardsState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  canDrive: boolean;
  deadlineMs: number | null;
  nowMs: number;
  aim: MutableRefObject<LiveAim | null>;
  onAim: (aim: LiveAim | null) => void;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
  onBusy: (busy: boolean) => void;
}

/** The aim slot belongs to the room; writes go through here (React Compiler can't see a prop is a ref). */
function writeAim(ref: MutableRefObject<LiveAim | null>, a: LiveAim | null) {
  ref.current = a;
}
function readAim(ref: MutableRefObject<LiveAim | null>): LiveAim | null {
  return ref.current;
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

/** Small ball chip (number + colour) for the HUD. */
export function BallChip({ id, carom, size = 18 }: { id: number; carom: boolean; size?: number }) {
  const color = carom ? CAROM_COLORS[id] : BALL_COLORS[id];
  const label = carom ? (id === 0 ? "" : id === 3 ? "✕" : id === 2 ? "◎" : "") : id === 0 ? "" : id === 9 ? "★" : String(id);
  return (
    <svg width={size} height={size} viewBox="-1 -1 2 2" className="shrink-0" aria-label={carom ? (id === 0 ? "흰 공" : id === 3 ? "노란 공" : "빨간 공") : id === 0 ? "흰 공" : `${id}번 공`}>
      <circle r={0.95} fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth={0.08} />
      {label && (
        <>
          {!carom && <circle r={0.52} fill="#fdfaf2" />}
          <text y={0.32} fontSize={carom ? 1 : 0.8} fontWeight={900} textAnchor="middle" fill={carom ? "#fdfaf2" : id === 9 ? "#8a5a00" : "#141414"}>
            {label}
          </text>
        </>
      )}
    </svg>
  );
}

/* ── 2D 대체 화면 (WebGL 없음) ─────────────────────────────────────── */

function Table2D({
  state,
  player,
  canAim,
  placing,
  aim,
  onAimDir,
  onPlace,
  onEvent,
  onBusy,
}: {
  state: BilliardsState;
  player: ReplayPlayer;
  canAim: boolean;
  placing: boolean;
  aim: MutableRefObject<LiveAim | null>;
  onAimDir: (dx: number, dy: number) => void;
  onPlace: (x: number, y: number) => void;
  onEvent: (e: ReplayEvent) => void;
  onBusy: (b: boolean) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [balls, setBalls] = useState<BallView[]>([]);
  const [aimView, setAimView] = useState<LiveAim | null>(null);
  const drag = useRef<"none" | "point" | "place">("none");
  const cbs = useRef({ onEvent, onBusy });
  useEffect(() => {
    cbs.current = { onEvent, onBusy };
  }, [onEvent, onBusy]);
  useEffect(() => {
    let id = 0;
    let busy: boolean | null = null;
    const loop = () => {
      const now = performance.now();
      const v = player.sample(state, now, (e) => cbs.current.onEvent(e));
      if (busy !== v.busy) {
        busy = v.busy;
        cbs.current.onBusy(v.busy);
      }
      setBalls(v.balls);
      const a = aim.current;
      setAimView(a && a.turn === state.turn && (!a.remote || now - a.at < 2200) && !v.busy ? { ...a } : null);
      id = window.requestAnimationFrame(loop);
    };
    id = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(id);
  }, [player, state, aim]);
  const W = HALF_W + 1.4;
  const H = HALF_H + 1.4;
  const toTable = (cx: number, cy: number) => {
    const el = svg.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * 2 * W - W, y: -(((cy - r.top) / r.height) * 2 * H - H) };
  };
  const carom = !isPocket(state);
  const cue = balls.find((b) => b.id === CUE_ID);
  const cuePos = cue && aimView && !Number.isNaN(aimView.px) ? { x: aimView.px, y: aimView.py } : cue;
  const guide = aimView ? aimGuide(state.balls, aimView, state.options.guide === "long") : null;
  const point = (cx: number, cy: number) => {
    const p = toTable(cx, cy);
    if (!p || !cuePos) return;
    const dx = p.x - cuePos.x;
    const dy = p.y - cuePos.y;
    const l = Math.hypot(dx, dy);
    if (l > 0.2) onAimDir(dx / l, dy / l);
  };
  return (
    <div className="flex h-full items-center justify-center bg-[#140d0a] p-2">
      <svg
        ref={svg}
        viewBox={`${-W} ${-H} ${W * 2} ${H * 2}`}
        className="h-auto max-h-full w-full touch-none select-none"
        onPointerDown={(e) => {
          if (!canAim) return;
          const p = toTable(e.clientX, e.clientY);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          if (placing && p && cuePos && Math.hypot(p.x - cuePos.x, p.y - cuePos.y) < R * 2.6) drag.current = "place";
          else {
            drag.current = "point";
            point(e.clientX, e.clientY);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current === "point") point(e.clientX, e.clientY);
          else if (drag.current === "place") {
            const p = toTable(e.clientX, e.clientY);
            if (p) onPlace(p.x, p.y);
          }
        }}
        onPointerUp={() => (drag.current = "none")}
        onPointerCancel={() => (drag.current = "none")}
      >
        <rect x={-W} y={-H} width={W * 2} height={H * 2} rx={0.8} fill="#5a2f15" />
        <rect x={-HALF_W - 0.5} y={-HALF_H - 0.5} width={HALF_W * 2 + 1} height={HALF_H * 2 + 1} fill="#13693a" />
        <rect x={-HALF_W} y={-HALF_H} width={HALF_W * 2} height={HALF_H * 2} fill="#1a7d45" />
        <line x1={-HALF_W / 2} y1={-HALF_H} x2={-HALF_W / 2} y2={HALF_H} stroke="rgba(255,255,255,0.15)" strokeWidth={0.06} />
        {!carom &&
          POCKETS.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={-p.y} r={p.r} fill="#050505" />
              {state.lucky === i && state.phase === "aim" && (
                <>
                  <circle cx={p.x} cy={-p.y} r={p.r + 0.25} fill="none" stroke="#ffd34d" strokeWidth={0.16} />
                  <text x={p.x} y={-p.y + (p.y > 0 ? -1.4 : 1.9)} fontSize={0.9} fontWeight={900} textAnchor="middle" fill="#ffd34d" stroke="#3b2200" strokeWidth={0.12} paintOrder="stroke">
                    ×2
                  </text>
                </>
              )}
            </g>
          ))}
        {guide && (
          <g pointerEvents="none">
            <line x1={guide.cx} y1={-guide.cy} x2={guide.ex} y2={-guide.ey} stroke="#fff6d8" strokeWidth={0.06} strokeDasharray="0.3 0.2" />
            {guide.hit && <circle cx={guide.ex} cy={-guide.ey} r={R} fill="none" stroke="#fff6d8" strokeWidth={0.05} />}
            {guide.hit && guide.objLen > 0 && <line x1={guide.hit.x} y1={-guide.hit.y} x2={guide.hit.x + guide.hit.nx * guide.objLen} y2={-(guide.hit.y + guide.hit.ny * guide.objLen)} stroke="#ffd34d" strokeWidth={0.06} strokeDasharray="0.22 0.16" />}
            {guide.hit && guide.cueLen > 0 && <line x1={guide.ex} y1={-guide.ey} x2={guide.ex + guide.cueTx * guide.cueLen} y2={-(guide.ey + guide.cueTy * guide.cueLen)} stroke="#9fe8ff" strokeWidth={0.05} strokeDasharray="0.18 0.14" />}
          </g>
        )}
        {balls.map((b) => {
          const pos = b.id === CUE_ID && cuePos ? cuePos : b;
          const color = carom ? CAROM_COLORS[b.id] : BALL_COLORS[b.id];
          const r = R * (1 - b.fade * 0.5);
          return (
            <g key={b.id} opacity={1 - b.fade * 0.6}>
              {placing && b.id === CUE_ID && <circle cx={pos.x} cy={-pos.y} r={R * 1.7} fill="none" stroke="#7cf3a0" strokeWidth={0.08} />}
              <circle cx={pos.x} cy={-pos.y} r={r} fill={color} stroke="rgba(0,0,0,0.45)" strokeWidth={0.04} />
              {!carom && b.id !== 0 && (
                <>
                  <circle cx={pos.x} cy={-pos.y} r={r * 0.55} fill="#fdfaf2" />
                  <text x={pos.x} y={-pos.y + 0.17} fontSize={0.46} fontWeight={900} textAnchor="middle" fill={b.id === 9 ? "#8a5a00" : "#141414"}>
                    {b.id === 9 ? "★" : b.id}
                  </text>
                </>
              )}
              {carom && b.id === 2 && <circle cx={pos.x} cy={-pos.y} r={r * 0.6} fill="none" stroke="#fdfaf2" strokeWidth={0.09} />}
              {carom && b.id === 3 && (
                <text x={pos.x} y={-pos.y + 0.17} fontSize={0.5} fontWeight={900} textAnchor="middle" fill="#3b2a00">
                  ✕
                </text>
              )}
            </g>
          );
        })}
        {aimView && cuePos && (
          <line
            x1={cuePos.x - aimView.dx * (R + 0.2)}
            y1={-(cuePos.y - aimView.dy * (R + 0.2))}
            x2={cuePos.x - aimView.dx * (R + 0.2 + 5 + aimView.power * 2.5)}
            y2={-(cuePos.y - aimView.dy * (R + 0.2 + 5 + aimView.power * 2.5))}
            stroke="#d9b27c"
            strokeWidth={0.18}
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
}

/* ── 조작 패널 ─────────────────────────────────────────────────────── */

function PowerBar({ power, onChange, onRelease, disabled }: { power: number; onChange: (p: number) => void; onRelease: () => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const fromY = (y: number) => {
    const el = ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (y - r.top) / r.height));
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="큐 세기 — 아래로 끌어 당긴 뒤 놓으면 쏴요"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(power * 100)}
      className={`relative h-full w-12 touch-none select-none rounded-full border-2 ${disabled ? "border-white/15 opacity-40" : "border-white/50"} bg-black/45`}
      onPointerDown={(e) => {
        if (disabled) return;
        active.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(fromY(e.clientY));
      }}
      onPointerMove={(e) => {
        if (active.current) onChange(fromY(e.clientY));
      }}
      onPointerUp={() => {
        if (!active.current) return;
        active.current = false;
        onRelease();
      }}
      onPointerCancel={() => {
        active.current = false;
        onChange(0);
      }}
    >
      <div className={`absolute inset-x-1 top-1 rounded-full ${power < 0.5 ? "bg-emerald-400" : power < 0.8 ? "bg-amber-400" : "bg-rose-500"}`} style={{ height: `calc(${Math.round(power * 100)}% - 0.5rem)` }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] font-bold text-white">{power < 0.04 ? "↓당겨" : `${Math.round(power * 100)}%`}</div>
    </div>
  );
}

function SpinPad({ spin, side, onChange }: { spin: number; side: number; onChange: (spin: number, side: number) => void }) {
  const set = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const l = Math.hypot(x, y);
    if (l > 0.8) {
      x = (x / l) * 0.8;
      y = (y / l) * 0.8;
    }
    if (Math.hypot(x, y) < 0.12) {
      x = 0;
      y = 0;
    }
    onChange(Math.round(y * 100) / 80, Math.round(x * 100) / 80);
  };
  const label = Math.abs(spin) < 0.1 && Math.abs(side) < 0.1 ? "가운데" : `${spin > 0.15 ? "밀어치기" : spin < -0.15 ? "끌어치기" : ""}${Math.abs(side) > 0.15 ? `${spin > 0.15 || spin < -0.15 ? " · " : ""}${side > 0 ? "오른쪽" : "왼쪽"} 회전` : ""}`;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        viewBox="-1 -1 2 2"
        className="h-16 w-16 touch-none select-none"
        role="group"
        aria-label={`당점: ${label}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) set(e);
        }}
      >
        <circle r={0.96} fill="#f8f5ec" stroke="#0b0b0b" strokeWidth={0.06} />
        <line x1={-0.9} y1={0} x2={0.9} y2={0} stroke="rgba(0,0,0,0.15)" strokeWidth={0.03} />
        <line x1={0} y1={-0.9} x2={0} y2={0.9} stroke="rgba(0,0,0,0.15)" strokeWidth={0.03} />
        <circle cx={side * 0.8 * 1.0} cy={-spin * 0.8} r={0.17} fill="#d62828" stroke="#fff" strokeWidth={0.04} />
      </svg>
      <span className="text-[10px] text-white/70 light:text-slate-500">{label}</span>
    </div>
  );
}

/* ── 보드 ───────────────────────────────────────────────────────────── */

interface Toast {
  key: number;
  text: string;
  tone: "good" | "bad" | "info" | "gold";
}

export default function BilliardsBoard({ state, viewerSeat, names, connectedSeats, botSeats, canDrive, deadlineMs, nowMs, aim, onAim, onAction, onGameEnd, onBusy }: Props) {
  const [canWebgl, setCanWebgl] = useState(true);
  const [quality, setQuality] = useState<"high" | "low">("high");
  const [topView, setTopView] = useState(false);
  const [rules, setRules] = useState(false);
  const [player] = useState(() => new ReplayPlayer());
  const [busy, setBusy] = useState(false);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const [myAim, setMyAim] = useState<LiveAim | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSeq = useRef(0);
  const lastClack = useRef(0);
  const lastPull = useRef({ at: 0, power: 0 });

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setCanWebgl(webglOk());
    setQuality(loadFlag(QUALITY_KEY, "low") ? "low" : "high");
    setTopView(loadFlag(TOPVIEW_KEY, "1"));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const pocket = isPocket(state);
  const myTurn = state.phase === "aim" && state.activeSeat === viewerSeat;
  const canAim = myTurn && !busy && sentTurn !== state.turn;
  const placing = canAim && state.ballInHand;
  // while a shot is still playing the HUD shows the table as it was before it
  const hudBalls = busy && state.lastShot ? state.lastShot.before : state.balls;
  const lowestOnTable = lowestBall(hudBalls);
  const closeToEnd = pocket ? hudBalls.filter((b) => b.id !== CUE_ID).length <= 3 : Math.max(...state.scores) >= state.options.target - 1;

  useSuiteBgm(getBilliardsSound, state.phase !== "ended", closeToEnd ? 1 : 0);
  const classify = useMemo(() => billiardsCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getBilliardsSound, classify);

  const showToast = useCallback((text: string, tone: Toast["tone"]) => {
    toastSeq.current += 1;
    setToast({ key: toastSeq.current, text, tone });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast((t) => (t?.key === toast.key ? null : t)), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleBusy = useCallback(
    (b: boolean) => {
      setBusy(b);
      onBusy(b);
    },
    [onBusy],
  );

  // a fresh turn for me: point at the natural target, power 0, centre ball
  const aimTurn = useRef<number | null>(null);
  useEffect(() => {
    if (!canAim || aimTurn.current === state.turn) return;
    aimTurn.current = state.turn;
    const cue = state.balls.find((b) => b.id === CUE_ID);
    const tid = pocket ? lowestBall(state.balls) : RED_A;
    const t = state.balls.find((b) => b.id === tid);
    let dx = 1;
    let dy = 0;
    if (cue && t) {
      const l = Math.hypot(t.x - cue.x, t.y - cue.y) || 1;
      dx = (t.x - cue.x) / l;
      dy = (t.y - cue.y) / l;
    }
    const a: LiveAim = { turn: state.turn, dx, dy, power: 0, spin: 0, side: 0, px: NaN, py: NaN, at: performance.now() };
    writeAim(aim, a);
    setMyAim(a);
    onAim(a);
    if (state.ballInHand) getBilliardsSound().play("hand");
    else getBilliardsSound().play("chalk");
  }, [canAim, state.turn, state.balls, state.ballInHand, pocket, aim, onAim]);

  const pushAim = useCallback(
    (patch: Partial<LiveAim>) => {
      const cur = readAim(aim);
      if (!cur || cur.turn !== state.turn || cur.remote) return;
      const next: LiveAim = { ...cur, ...patch, at: performance.now() };
      writeAim(aim, next);
      setMyAim(next);
      onAim(next);
    },
    [aim, state.turn, onAim],
  );

  const onAimDir = useCallback((dx: number, dy: number) => pushAim({ dx, dy }), [pushAim]);
  const onPlace = useCallback(
    (x: number, y: number) => {
      const cx = Math.max(-HALF_W + R, Math.min(HALF_W - R, x));
      const cy = Math.max(-HALF_H + R, Math.min(HALF_H - R, y));
      if (canPlace(state, cx, cy)) pushAim({ px: cx, py: cy });
    },
    [state, pushAim],
  );
  const setPower = useCallback(
    (p: number) => {
      pushAim({ power: p });
      const now = performance.now();
      if (now - lastPull.current.at > 110 && Math.abs(p - lastPull.current.power) > 0.05) {
        lastPull.current = { at: now, power: p };
        getBilliardsSound().play("pull", p);
      }
    },
    [pushAim],
  );

  const shoot = useCallback(() => {
    const a = readAim(aim);
    if (!canAim || !a || a.remote || a.turn !== state.turn) return;
    if (a.power < 0.04) {
      pushAim({ power: 0 });
      return;
    }
    const sp = speedForPower(a.power);
    const q = quantizeShot(a.dx * sp, a.dy * sp);
    setSentTurn(state.turn);
    const place = state.ballInHand && !Number.isNaN(a.px) ? { x: Math.round(a.px * 1000), y: Math.round(a.py * 1000) } : null;
    onAction({ type: "shoot", seat: viewerSeat, vx: q.vx, vy: q.vy, spin: quantizeSpin(a.spin), side: quantizeSpin(a.side), place });
    setMyAim(null);
  }, [aim, canAim, state.turn, state.ballInHand, onAction, viewerSeat, pushAim]);

  // keyboard: ←/→ aim (Shift = fine), W/S follow/draw, Q/E side, Space hold → release to shoot
  const spaceHeld = useRef<number | null>(null);
  useEffect(() => {
    if (!canAim) return;
    const rotate = (ang: number) => {
      const a = readAim(aim);
      if (!a) return;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      onAimDir(a.dx * c - a.dy * s, a.dx * s + a.dy * c);
    };
    let raf = 0;
    const tick = () => {
      if (spaceHeld.current !== null) {
        const p = Math.min(1, (performance.now() - spaceHeld.current) / 1500);
        setPower(p);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const a = readAim(aim);
      const fine = e.shiftKey ? 0.15 : 1;
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        e.preventDefault();
        rotate(((Math.PI / 180) * 1.2 * fine) as number);
      } else if (e.code === "ArrowRight" || e.code === "KeyD") {
        e.preventDefault();
        rotate((-(Math.PI / 180) * 1.2 * fine) as number);
      } else if ((e.code === "KeyW" || e.code === "ArrowUp") && a) {
        e.preventDefault();
        pushAim({ spin: Math.min(1, a.spin + 0.25) });
      } else if ((e.code === "KeyS" || e.code === "ArrowDown") && a) {
        e.preventDefault();
        pushAim({ spin: Math.max(-1, a.spin - 0.25) });
      } else if (e.code === "KeyQ" && a) pushAim({ side: Math.max(-1, a.side - 0.25) });
      else if (e.code === "KeyE" && a) pushAim({ side: Math.min(1, a.side + 0.25) });
      else if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat && spaceHeld.current === null) spaceHeld.current = performance.now();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceHeld.current !== null) {
        spaceHeld.current = null;
        shoot();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      spaceHeld.current = null;
    };
  }, [canAim, aim, onAimDir, pushAim, setPower, shoot]);

  const handleEvent = useCallback(
    (e: ReplayEvent) => {
      const sound = getBilliardsSound();
      if (e.kind === "strike") sound.play("strike", e.power);
      else if (e.kind === "clack") {
        const now = performance.now();
        if (now - lastClack.current < 30) return;
        lastClack.current = now;
        sound.play("clack", e.impulse);
      } else if (e.kind === "rail") {
        if (e.impulse > 1.5) sound.play("rail", e.impulse);
      } else if (e.kind === "pot") sound.play("pot");
      else if (e.kind === "done") {
        const shot = e.shot;
        const who = shot.seat === viewerSeat ? "내" : `${names[shot.seat] ?? "상대"}님의`;
        if (shot.foul === "scratch") {
          sound.play("scratch");
          showToast(`😵 ${who} 흰 공이 빠졌어요 −1 · 다음 사람 프리볼`, "bad");
        } else if (shot.foul === "wrongFirst") {
          sound.play("foul");
          showToast(`🚫 가장 낮은 번호 공을 먼저 맞혀야 해요 −1 · 다음 사람 프리볼`, "bad");
        } else if (shot.foul === "miss" && pocket) {
          sound.play("foul");
          showToast(`💨 아무 공도 못 맞혔어요 −1 · 다음 사람 프리볼`, "bad");
        } else if (shot.foul === "yellow") {
          sound.play("foul");
          showToast(`🟡 노란 공을 건드렸어요 −1`, "bad");
        } else if (shot.carom) {
          sound.play(shot.cushions >= 3 ? "three" : "carom");
          showToast(shot.cushions >= 3 ? `⭐ 쓰리쿠션! +${shot.points} · 한 번 더` : `🎯 캐롬! +1 · 한 번 더`, shot.cushions >= 3 ? "gold" : "good");
        } else if (shot.scored.length > 0) {
          const gold = shot.scored.some((s) => s.id === 9);
          const lucky = shot.scored.some((s) => s.lucky);
          if (gold) sound.play("gold");
          if (lucky) sound.play("lucky");
          showToast(`${gold ? "⭐ 황금 9번!" : "🎱 쏙!"} ${shot.scored.map((s) => (s.id === 9 ? "★9" : s.id)).join("·")}번 +${shot.points}${lucky ? " (×2 포켓!)" : ""} · 한 번 더`, gold || lucky ? "gold" : "good");
        } else if (shot.respotted) showToast("⭐9번은 반칙이라 제자리로 돌아왔어요", "info");
        if (state.phase !== "aim" && state.lastShot?.turn === shot.turn) sound.play("rack");
      }
    },
    [viewerSeat, names, showToast, pocket, state.phase, state.lastShot],
  );

  // auto next rack (driver only), once the last shot has played out
  useEffect(() => {
    if (!canDrive || state.phase !== "rackOver" || busy) return;
    const id = window.setTimeout(() => onAction({ type: "next" }), 6000);
    return () => window.clearTimeout(id);
  }, [canDrive, state.phase, state.turn, busy, onAction]);

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
  const limit = pocket ? POCKET_SHOT_LIMIT : CAROM_SHOT_LIMIT;
  const shotsLeft = limit - state.shots;
  const rec = state.history[state.history.length - 1];
  const showRackOver = state.phase === "rackOver" && !busy && rec;
  const passNote = state.lastPass && state.lastPass.turn === state.turn - 1 ? `${state.lastPass.seat === viewerSeat ? "내" : `${names[state.lastPass.seat] ?? ""}님의`} 차례가 시간 초과로 넘어갔어요` : null;
  const objectsLeft = hudBalls.filter((b) => b.id !== CUE_ID).sort((a, b) => a.id - b.id);

  const hint: ReactNode = busy
    ? "공이 다 멈출 때까지 지켜봐요…"
    : myTurn
      ? sentTurn === state.turn
        ? "쳤어요!"
        : placing
          ? "🖐 프리볼: 초록 고리의 흰 공을 끌어 원하는 곳에 놓은 뒤 조준하세요."
          : topView
            ? "👆 판을 눌러 칠 방향을 정하고, 오른쪽 막대를 아래로 끌었다 놓으면 쳐요."
            : "👆 좌우로 끌어 큐를 돌리고(←/→, Shift 미세), 오른쪽 막대를 아래로 끌었다 놓으면 쳐요. Space를 꾹 눌렀다 떼도 돼요."
      : `${activeIsBot ? "🤖 " : ""}${activeName}님이 조준하고 있어요`;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          {pocket ? `🎱 럭키 포켓 · ${state.options.racks > 1 ? `${state.rack + 1}/${state.options.racks}판` : "단판"}` : `🎯 캐롬 파티 · 먼저 ${state.options.target}점`} · {state.shots}타
        </span>
        {shotsLeft <= 10 && state.phase === "aim" && <span className="text-xs text-rose-300 light:text-rose-600">⏳ {shotsLeft}타 남음</span>}
        {!pocket && state.finalInning && state.phase === "aim" && (
          <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-bold text-amber-200 light:text-amber-800">
            🏁 {names[state.winner] ?? "누군가"} 목표 도달 — 이번 바퀴 남은 사람까지 마지막 기회
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {canWebgl && (
            <>
              <button
                type="button"
                onClick={() => {
                  setTopView((v) => {
                    saveFlag(TOPVIEW_KEY, v ? "0" : "1");
                    return !v;
                  });
                }}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${topView ? "border-emerald-400 text-emerald-200 light:text-emerald-700" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-600"}`}
              >
                🎥 {topView ? "위에서" : "조준 시점"}
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
          <SuiteSoundHud suite={getBilliardsSound} icon="🎱" label="Green Felt Lounge" preview="clack" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {/* 남은 공 / 목표 */}
      {pocket && state.phase !== "ended" && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/70 light:text-slate-600">
          {lowestOnTable > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-bold text-amber-100 light:text-amber-800">
              먼저 맞힐 공 <BallChip id={lowestOnTable} carom={false} />
            </span>
          )}
          <span className="flex flex-wrap items-center gap-0.5" aria-label="남은 공">
            {objectsLeft.map((b) => (
              <BallChip key={b.id} id={b.id} carom={false} size={16} />
            ))}
          </span>
          <span className="text-white/45 light:text-slate-400">· 1점씩, ★9는 {ballValue(9)}점 · 노란 고리 ×2 포켓은 칠 때마다 바뀌어요</span>
        </div>
      )}

      {/* 무대 */}
      <div className="relative h-[60vh] max-h-[680px] min-h-[340px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {canWebgl ? (
          <PoolScene
            state={state}
            player={player}
            canAim={canAim}
            placing={placing}
            aim={aim}
            onAimDir={onAimDir}
            onPlace={onPlace}
            onEvent={handleEvent}
            onBusy={handleBusy}
            topView={topView}
            quality={quality}
            onFps={onFps}
          />
        ) : (
          <Table2D state={state} player={player} canAim={canAim} placing={placing} aim={aim} onAimDir={onAimDir} onPlace={onPlace} onEvent={handleEvent} onBusy={handleBusy} />
        )}

        {state.phase === "aim" && (
          <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
            <span style={{ color: SEAT_COLORS[state.activeSeat % 4] }}>{SEAT_SYMBOLS[state.activeSeat % 4]}</span>
            {busy ? "🎬 결과 보는 중" : myTurn ? "🫵 내 차례" : `${activeIsBot ? "🤖 " : ""}${activeName}`}
            {!busy && state.ballInHand && <span className="text-emerald-300">🖐 프리볼</span>}
            {!busy && remaining !== null && <span className={`tabular-nums ${remaining <= 8 ? "text-rose-300" : "text-white/60"}`}>{remaining}s</span>}
          </div>
        )}

        {/* 내 조작: 세기 막대 + 당점 + 미세 조준 */}
        {canAim && myAim && (
          <>
            <div className="absolute top-12 right-2 bottom-24 z-10">
              <PowerBar power={myAim.power} onChange={setPower} onRelease={shoot} disabled={!canAim} />
            </div>
            <div className="absolute bottom-2 left-2 z-10 flex items-end gap-2 rounded-2xl bg-black/45 p-2">
              <SpinPad spin={myAim.spin} side={myAim.side} onChange={(spin, side) => pushAim({ spin, side })} />
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-white/70">미세 조준</span>
                <div className="flex gap-1">
                  {[
                    { label: "◀◀", ang: 2 },
                    { label: "◀", ang: 0.25 },
                    { label: "▶", ang: -0.25 },
                    { label: "▶▶", ang: -2 },
                  ].map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      aria-label={`조준 ${b.ang > 0 ? "왼쪽" : "오른쪽"}으로 ${Math.abs(b.ang)}도`}
                      onClick={() => {
                        const a = readAim(aim);
                        if (!a) return;
                        const r = (b.ang * Math.PI) / 180;
                        onAimDir(a.dx * Math.cos(r) - a.dy * Math.sin(r), a.dx * Math.sin(r) + a.dy * Math.cos(r));
                      }}
                      className="h-10 min-w-10 rounded-lg border border-white/25 bg-black/40 px-2 text-sm font-bold text-white"
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {toast && (
          <div key={toast.key} className="pointer-events-none absolute inset-x-0 top-12 flex justify-center px-3">
            <span
              className={`animate-bounce rounded-full px-4 py-1.5 text-center text-sm font-black shadow-lg ${toast.tone === "gold" ? "bg-amber-400/95 text-slate-900" : toast.tone === "good" ? "bg-emerald-500/95 text-slate-900" : toast.tone === "bad" ? "bg-rose-600/95 text-white" : "bg-black/70 text-white"}`}
            >
              {toast.text}
            </span>
          </div>
        )}
        {showRackOver && (
          <div className="pointer-events-none absolute inset-x-0 top-1/4 flex flex-col items-center gap-1.5 px-3 text-center">
            <span className="text-5xl">🎱</span>
            <span className="rounded-xl bg-black/70 px-4 py-2 text-lg font-black text-white">{rec.rack + 1}판 끝!</span>
            <span className="flex flex-wrap justify-center gap-1.5">
              {rec.scores.map((pts, s) => (
                <span key={s} className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                  <SeatTag seat={s} names={names} me={viewerSeat} /> +{pts}
                </span>
              ))}
            </span>
            {rec.limitHit && <span className="text-xs text-white/70">{POCKET_SHOT_LIMIT}타 제한으로 끝났어요</span>}
          </div>
        )}
      </div>

      {remaining !== null && state.phase === "aim" && !busy && (
        <div className="-mt-1 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full transition-[width] duration-300 ${remaining <= 8 ? "bg-rose-500" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, ((remaining * 1000) / AIM_TIMEOUT_MS) * 100)}%` }} />
        </div>
      )}

      {state.phase === "aim" && (
        <div className={`${PANEL} text-center text-sm break-keep text-white/75 light:text-slate-600`}>
          {hint}
          {passNote && <p className="mt-1 text-xs text-white/45 light:text-slate-400">{passNote}</p>}
        </div>
      )}
      {state.phase === "rackOver" && (
        <div className={`${PANEL} flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600`}>
          <span>{busy ? "마지막 장면을 보는 중…" : state.rack + 1 >= state.options.racks ? "곧 최종 결과가 나와요" : "곧 새로 공을 모아 다음 판 — 꼴찌가 먼저 깨요"}</span>
          <button type="button" disabled={busy} onClick={() => onAction({ type: "next" })} className={PRIMARY}>
            {state.rack + 1 >= state.options.racks ? "결과 보기" : "다음 판"}
          </button>
        </div>
      )}
      {state.phase === "ended" && !busy && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      {state.phase !== "ended" && (
        <div className={`${PANEL} grid grid-cols-1 gap-1.5 sm:grid-cols-2`}>
          {Array.from({ length: state.playerCount }, (_, s) => s).map((s) => (
            <div key={s} className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs ${s === state.activeSeat && state.phase === "aim" ? "bg-emerald-500/15" : ""}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${connectedSeats.has(s) ? "bg-emerald-400" : "bg-white/20"}`} />
              <span className={`min-w-0 flex-1 truncate ${s === viewerSeat ? "font-black text-emerald-200 light:text-emerald-700" : "text-white/80 light:text-slate-700"}`}>
                {botSeats.has(s) ? "🤖 " : ""}
                <SeatTag seat={s} names={names} me={viewerSeat} />
              </span>
              <span className="shrink-0 text-white/50 light:text-slate-400">{pocket ? `🎱${state.potted[s]}` : ""} 반칙 {state.fouls[s]}</span>
              <b className="shrink-0 text-sm text-emerald-200 tabular-nums light:text-emerald-700">
                {state.scores[s]}
                {!pocket ? `/${state.options.target}` : "점"}
              </b>
            </div>
          ))}
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: BilliardsState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  const pocket = isPocket(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">🎱 최종 결과</h3>
      <ol className="flex flex-col gap-1.5">
        {rankings.map((r) => (
          <li key={r.seat} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${r.seat === viewerSeat ? "bg-emerald-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-8 font-black text-emerald-200 light:text-emerald-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
            <span className="min-w-0 flex-1 truncate text-white/85 light:text-slate-700">
              <SeatTag seat={r.seat} names={names} me={viewerSeat} />
            </span>
            <span className="tabular-nums text-white/80 light:text-slate-700">{state.scores[r.seat]}점</span>
            {pocket && <span className="text-xs text-white/50 light:text-slate-500">🎱{state.potted[r.seat]}</span>}
            <span className="text-xs text-white/40 light:text-slate-400">반칙 {state.fouls[r.seat]}</span>
          </li>
        ))}
      </ol>
      <p className="text-center text-[11px] text-white/45 light:text-slate-400">{pocket ? "동점이면 넣은 공 수 → 반칙이 적은 사람" : "점수 → 반칙이 적은 사람 (목표에 닿은 뒤 같은 바퀴 사람까지 마지막 기회)"}</p>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
