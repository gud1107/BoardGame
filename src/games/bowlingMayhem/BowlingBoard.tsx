"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  AIM_TIMEOUT_MS,
  canUseItem,
  computeRankings,
  currentSetup,
  foulsOf,
  ITEMS,
  LANE_MODS,
  maxPossible,
  quantizeRoll,
  scoreFrames,
  sparesOf,
  strikesOf,
  totalOf,
  type BowlingState,
  type EngineAction,
  type ItemKind,
  type RollRecord,
  type Seat,
} from "./engine";
import { HALF_W, HEAD_Y, MAX_SLOPE, PIT_Y, RACK, WALL_X } from "./physics";
import { ReplayPlayer, type ReplayEvent, type ReplayView } from "./replay";
import { boardOf, meterAt, releaseFor, slopeDegrees, type LiveAim } from "./aim";
import { bowlingCues, getBowlingSound } from "./bowlingSound";
import RulebookModal from "./RulebookModal";
import { webglAvailable } from "./three/webgl";
import { resultLabel } from "./labels";
import { SEAT_COLORS, SEAT_MARKS, SEAT_NAMES } from "./three/textures";

const Loading3D = () => <div className="flex h-full items-center justify-center bg-[#0c0820] text-xs text-fuchsia-200/60">🎳 레인에 기름 바르는 중…</div>;
const BowlingScene = dynamic(() => import("./three/BowlingScene"), { ssr: false, loading: Loading3D });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-fuchsia-500 disabled:opacity-40";
const QUALITY_KEY = "bowling-mayhem-quality";
const DRAFT_KEY = "bowling-mayhem-draft";
const METER_PERIOD = 1500;

interface Props {
  state: BowlingState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  deadlineMs: number | null;
  nowMs: number;
  /** Shared aim slot, owned by the room (remote aims and mine both land here). */
  aim: MutableRefObject<LiveAim | null>;
  /** My aim changed — the room throttles the broadcast. */
  onAim: (aim: LiveAim | null) => void;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
  /** The replay is (not) playing — the room holds bots and the turn clock while it is. */
  onBusy: (busy: boolean) => void;
}

interface Draft {
  x: number;
  slope: number;
  spin: number;
}

function loadDraft(): Draft {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as Partial<Draft> | null;
    if (raw && [raw.x, raw.slope, raw.spin].every((v) => typeof v === "number" && Number.isFinite(v))) return { x: raw.x!, slope: raw.slope!, spin: raw.spin! };
  } catch {
    /* ignore */
  }
  return { x: 0.06, slope: -0.004, spin: 0 };
}
function saveDraft(d: Draft) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}
function loadLow(): boolean {
  try {
    return window.localStorage.getItem(QUALITY_KEY) === "low";
  } catch {
    return false;
  }
}

/** A seat's colour chip with its shape mark (§2 — readable without colour). */
export function SeatChip({ seat, size = 16 }: { seat: Seat; size?: number }) {
  return (
    <span
      aria-label={SEAT_NAMES[seat % SEAT_NAMES.length]}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-black text-white"
      style={{ width: size, height: size, background: SEAT_COLORS[seat % SEAT_COLORS.length], fontSize: size * 0.6, textShadow: "0 1px 1px rgba(0,0,0,.6)" }}
    >
      {SEAT_MARKS[seat % SEAT_MARKS.length]}
    </span>
  );
}

/* ── pin diagram (the "핀 배치도" every alley screen has) ───────────────── */

function PinDiagram({ standing, down, size = 86 }: { standing: ReadonlySet<number>; down?: ReadonlySet<number>; size?: number }) {
  const w = size;
  const h = size * 0.82;
  const sx = (x: number) => w / 2 + (x / 0.5) * (w * 0.42);
  const sy = (y: number) => h - 10 - ((y - HEAD_Y) / 0.8) * (h - 20);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={`서 있는 핀 ${standing.size}개`}>
      {RACK.map((p) => {
        const up = standing.has(p.id);
        const justDown = down?.has(p.id);
        return (
          <g key={p.id}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={size * 0.075} fill={up ? "#fbfaf6" : justDown ? "rgba(255,90,90,0.35)" : "rgba(255,255,255,0.08)"} stroke={up ? "#d1202a" : justDown ? "#ff6b6b" : "rgba(255,255,255,0.25)"} strokeWidth={1.4} />
            <text x={sx(p.x)} y={sy(p.y) + size * 0.032} fontSize={size * 0.085} textAnchor="middle" fontWeight={800} fill={up ? "#3b1c0b" : "rgba(255,255,255,0.45)"}>
              {p.id + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── 2D fallback (no WebGL): the lane from above ─────────────────────── */

const Y_SCALE = 0.22;

function Lane2D({ state, player, canAim, aim, onDraft, onEvent, onBusy }: { state: BowlingState; player: ReplayPlayer; canAim: boolean; aim: MutableRefObject<LiveAim | null>; onDraft: (p: { x?: number; slope?: number }) => void; onEvent: (e: ReplayEvent) => void; onBusy: (b: boolean) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ReplayView | null>(null);
  const [aimView, setAimView] = useState<LiveAim | null>(null);
  const cb = useRef({ onEvent, onBusy });
  useEffect(() => {
    cb.current = { onEvent, onBusy };
  }, [onEvent, onBusy]);
  useEffect(() => {
    let id = 0;
    let busy: boolean | null = null;
    const loop = () => {
      const v = player.sample(state, performance.now(), (e) => cb.current.onEvent(e));
      if (busy !== v.busy) {
        busy = v.busy;
        cb.current.onBusy(v.busy);
      }
      setView(v);
      const a = aim.current;
      setAimView(a && a.turn === state.turn && !v.busy ? a : null);
      id = window.requestAnimationFrame(loop);
    };
    id = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(id);
  }, [player, state, aim]);
  const W = WALL_X + 0.1;
  const H = PIT_Y * Y_SCALE;
  const Y = (y: number) => H - y * Y_SCALE;
  const toLane = (cx: number, cy: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return null;
    const x = ((cx - r.left) / r.width) * 2 * W - W;
    const y = (H - ((cy - r.top) / r.height) * (H + 0.3)) / Y_SCALE;
    return { x, y };
  };
  const drag = (e: React.PointerEvent) => {
    if (!canAim) return;
    const p = toLane(e.clientX, e.clientY);
    if (!p) return;
    if (p.y < 1.6) onDraft({ x: Math.max(-(HALF_W - 0.12), Math.min(HALF_W - 0.12, p.x)) });
    else onDraft({ slope: Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, (p.x - (aim.current?.x ?? 0)) / Math.max(2, p.y))) });
  };
  const ball = view?.ball?.visible ? view.ball : null;
  return (
    <div className="flex h-full items-center justify-center bg-[#0c0820] p-2">
      <svg
        ref={svg}
        viewBox={`${-W} -0.3 ${W * 2} ${H + 0.3}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-auto max-w-full touch-none select-none"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) drag(e);
        }}
      >
        <rect x={-WALL_X} y={0} width={WALL_X * 2} height={H} fill="#2b2d36" />
        <rect x={-HALF_W} y={0} width={HALF_W * 2} height={H} fill={state.laneMods[state.frame] === "ice" ? "#cbeeff" : "#d9a86a"} />
        {[5, 10, 15, 20, 25, 30, 35].map((b) => (
          <polygon key={b} points={`${-(b - 20) * 0.027},${Y(4.6) - 0.08} ${-(b - 20) * 0.027 - 0.02},${Y(4.6)} ${-(b - 20) * 0.027 + 0.02},${Y(4.6)}`} fill="#3b1c0b" />
        ))}
        <line x1={-HALF_W} x2={HALF_W} y1={Y(0)} y2={Y(0)} stroke="#2b1508" strokeWidth={0.02} />
        {aimView && <line x1={aimView.x} y1={Y(0)} x2={aimView.x + aimView.slope * 7} y2={Y(7)} stroke="#fff3c4" strokeWidth={0.015} strokeDasharray="0.06 0.04" />}
        {view?.pins.map((p) =>
          p.visible ? (
            <ellipse key={p.id} cx={p.x} cy={Y(p.y)} rx={0.06} ry={0.06 * (p.tip > 0.5 ? 0.6 : 1)} fill={p.tip > 0.5 ? "#c9c6bf" : "#fbfaf6"} stroke="#d1202a" strokeWidth={0.012} />
          ) : null,
        )}
        {(ball || (!view?.busy && aimView)) && <circle cx={ball ? ball.x : aimView!.x} cy={Y(ball ? ball.y : 0.2)} r={0.11} fill={SEAT_COLORS[(view?.rec?.seat ?? state.activeSeat) % 6]} stroke="#000" strokeWidth={0.01} />}
      </svg>
    </div>
  );
}

/* ── score sheet ──────────────────────────────────────────────────────── */

function ScoreSheet({ state, viewerSeat, names, botSeats, connectedSeats, busy, shownRolls }: { state: BowlingState; viewerSeat: Seat; names: Record<Seat, string>; botSeats: Set<Seat>; connectedSeats: Set<Seat>; busy: boolean; shownRolls: number[][][] }) {
  const F = state.options.frames;
  return (
    <div className={`${PANEL} overflow-x-auto`}>
      <table className="w-full min-w-[520px] border-collapse text-center text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] text-white/40 light:text-slate-400">
            <th className="w-28 text-left font-semibold">플레이어</th>
            {Array.from({ length: F }, (_, f) => (
              <th key={f} className={`font-semibold ${f === state.frame && state.phase === "aim" ? "text-fuchsia-300 light:text-fuchsia-700" : ""}`}>
                {f + 1}
                <span className="ml-0.5">{LANE_MODS[state.laneMods[f]].icon !== "🎳" && f <= state.frame ? LANE_MODS[state.laneMods[f]].icon : ""}</span>
              </th>
            ))}
            <th className="w-12 font-semibold">합계</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: state.playerCount }, (_, s) => {
            const frames = scoreFrames(shownRolls[s], foulsOf(state, s));
            const active = state.phase === "aim" && s === state.activeSeat;
            return (
              <tr key={s} className={`border-t border-white/5 light:border-slate-100 ${active ? "bg-fuchsia-500/10" : ""}`}>
                <td className="py-1 text-left">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(s) ? "bg-emerald-400" : "bg-white/20"}`} />
                    <SeatChip seat={s} size={14} />
                    <span className={`truncate ${s === viewerSeat ? "font-black text-fuchsia-200 light:text-fuchsia-700" : "text-white/80 light:text-slate-700"}`}>
                      {botSeats.has(s) ? "🤖 " : ""}
                      {names[s] ?? `${s + 1}번`}
                    </span>
                  </span>
                </td>
                {frames.map((fr, f) => {
                  const last = f === F - 1;
                  const boxes = last ? 3 : 2;
                  const marks = [...fr.marks];
                  // a strike in an open frame prints in the second box, like a real sheet
                  if (!last && marks[0] === "X") marks.splice(0, 1, "", "X");
                  return (
                    <td key={f} className={`border-l border-white/5 px-0.5 py-0.5 align-top light:border-slate-100 ${active && f === state.frame && !busy ? "bg-fuchsia-500/10" : ""}`}>
                      <div className="flex justify-end gap-px">
                        {Array.from({ length: boxes }, (_, b) => {
                          const m = marks[b] ?? "";
                          return (
                            <span key={b} className={`inline-block w-3.5 text-[11px] font-black ${m === "X" ? "text-amber-300 light:text-amber-600" : m === "/" ? "text-sky-300 light:text-sky-600" : m === "F" ? "text-rose-400" : "text-white/80 light:text-slate-700"}`}>
                              {m}
                            </span>
                          );
                        })}
                      </div>
                      <div className="text-[11px] font-bold text-white/70 light:text-slate-600">{fr.total ?? ""}</div>
                    </td>
                  );
                })}
                <td className="border-l border-white/5 text-sm font-black text-fuchsia-200 light:border-slate-100 light:text-fuchsia-700">{totalOfRolls(shownRolls[s])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function totalOfRolls(r: number[][]): number {
  return totalOf({ rolls: [r] }, 0);
}

/* ── the board ────────────────────────────────────────────────────────── */

interface Banner {
  key: number;
  text: string;
  tone: "gold" | "good" | "bad" | "info";
  big: boolean;
}

export default function BowlingBoard({ state, viewerSeat, names, connectedSeats, botSeats, deadlineMs, nowMs, aim, onAim, onAction, onGameEnd, onBusy }: Props) {
  const [canWebgl] = useState(webglAvailable);
  const [quality, setQuality] = useState<"high" | "low">(() => (loadLow() ? "low" : "high"));
  const [rules, setRules] = useState(false);
  const [player] = useState(() => new ReplayPlayer());
  const [busy, setBusy] = useState(false);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [chargeRaw, setCharging] = useState<{ since: number } | null>(null);
  const [power, setPower] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [picking, setPicking] = useState<ItemKind | null>(null);
  /** Rolls as the replay has shown them (the sheet doesn't spoil a roll still playing). */
  const [shownTurn, setShownTurn] = useState<number>(state.lastRoll?.turn ?? -1);
  const [lastShown, setLastShown] = useState<RollRecord | null>(null);
  const seq = useRef(0);
  const crashed = useRef<number | null>(null);
  const lastClack = useRef(0);

  const myTurn = state.phase === "aim" && state.activeSeat === viewerSeat;
  const canAim = myTurn && !busy && sentTurn !== state.turn;
  // the meter only runs while I may bowl (a turn change drops it)
  const charging = canAim ? chargeRaw : null;
  const setup = useMemo(() => currentSetup(state), [state]);
  const lim = HALF_W - setup.ballR - 0.01;
  const mod = LANE_MODS[state.laneMods[state.frame] ?? "normal"];
  const last = state.frame === state.options.frames - 1;

  useSuiteBgm(getBowlingSound, state.phase !== "ended", last ? 1 : 0);
  const classify = useMemo(() => bowlingCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getBowlingSound, classify);

  const showBanner = useCallback((text: string, tone: Banner["tone"], big: boolean) => {
    seq.current += 1;
    setBanner({ key: seq.current, text, tone, big });
  }, []);
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner((b) => (b?.key === banner.key ? null : b)), banner.big ? 2300 : 2000);
    return () => window.clearTimeout(id);
  }, [banner]);
  const showToast = useCallback((text: string) => {
    seq.current += 1;
    setToast({ key: seq.current, text });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast((t) => (t?.key === toast.key ? null : t)), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  // the rolls the sheet shows: up to the last roll the replay has finished
  const shownRolls = useMemo(() => {
    if (!busy || !state.lastRoll || state.lastRoll.turn <= shownTurn) return state.rolls;
    // hide the roll(s) still playing
    const out = state.rolls.map((r) => r.map((b) => [...b]));
    const r = state.lastRoll;
    const list = out[r.seat][r.frame];
    if (list.length > 0) list.pop();
    return out;
  }, [busy, state.rolls, state.lastRoll, shownTurn]);

  const handleBusy = useCallback(
    (b: boolean) => {
      setBusy(b);
      onBusy(b);
    },
    [onBusy],
  );

  const handleEvent = useCallback(
    (e: ReplayEvent) => {
      const sound = getBowlingSound();
      if (e.kind === "release") {
        sound.play("release", e.power);
        sound.play("rumble", 2.6);
      } else if (e.kind === "hit") {
        const now = performance.now();
        const rec = state.lastRoll;
        if (e.ev === "pin" && crashed.current !== rec?.turn && (rec?.setup.pins.length ?? 0) >= 6) {
          crashed.current = rec?.turn ?? null;
          sound.play("crash");
          return;
        }
        if (now - lastClack.current < 40) return;
        lastClack.current = now;
        if (e.ev === "wall") sound.play("wall");
        else sound.play("pin", e.impulse);
      } else if (e.kind === "gutter") sound.play("gutter");
      else if (e.kind === "bumper") sound.play("bumper");
      else if (e.kind === "cone") sound.play("cone");
      else if (e.kind === "settled") {
        const r = e.rec;
        const label = resultLabel(r);
        showBanner(label.text, label.tone, label.big);
        if (r.foul) sound.play("foul");
        else if (r.strike) sound.play(r.streak >= 3 ? "turkey" : "strike");
        else if (r.spare) sound.play("spare");
        else if (r.split) sound.play("split");
        else if (r.down.length === 0) sound.play("miss");
        setShownTurn(r.turn);
        setLastShown(r);
      } else if (e.kind === "done") {
        setShownTurn((t) => Math.max(t, e.rec.turn));
      }
    },
    [state.lastRoll, showBanner],
  );

  // item / gift / hazard notices
  const lastItemTurn = useRef(state.lastItem?.turn ?? -1);
  useEffect(() => {
    const it = state.lastItem;
    if (!it || it.turn <= lastItemTurn.current) return;
    lastItemTurn.current = it.turn;
    const who = it.seat === viewerSeat ? "내가" : `${names[it.seat] ?? "누군가"}님이`;
    const spec = ITEMS[it.kind];
    if (spec.self) showToast(`${spec.icon} ${who} ${spec.name}을(를) 세웠어요!`);
    else showToast(`${spec.icon} ${who} ${it.target === viewerSeat ? "내" : `${names[it.target] ?? ""}님`} 레인에 ${spec.name}!`);
  }, [state.lastItem, viewerSeat, names, showToast]);
  const lastGiftTurn = useRef(state.lastGift?.turn ?? -1);
  useEffect(() => {
    const g = state.lastGift;
    if (!g || g.turn <= lastGiftTurn.current) return;
    lastGiftTurn.current = g.turn;
    const mine = g.seats.indexOf(viewerSeat);
    if (mine >= 0) showToast(`🎁 꼴찌 역전 찬스! ${ITEMS[g.kinds[mine]].icon} ${ITEMS[g.kinds[mine]].name} 획득`);
    else showToast(`🎁 ${g.seats.map((s) => names[s] ?? "").join(", ")}님이 역전 아이템을 받았어요`);
  }, [state.lastGift, viewerSeat, names, showToast]);
  // a fresh lane twist when a frame starts
  const lastFrameShown = useRef(-1);
  useEffect(() => {
    if (busy || state.phase !== "aim" || state.ball !== 0) return;
    const key = state.frame * 100 + state.activeSeat;
    if (lastFrameShown.current === key) return;
    lastFrameShown.current = key;
    const m = LANE_MODS[state.laneMods[state.frame]];
    const parts: string[] = [];
    if (state.laneMods[state.frame] !== "normal" && state.activeSeat === 0) parts.push(`${m.icon} ${state.frame + 1}프레임: ${m.name} — ${m.desc}`);
    if (state.active.length > 0 && state.activeSeat === viewerSeat) parts.push(`⚠️ 내 레인에 ${state.active.map((h) => `${ITEMS[h.kind].icon}${ITEMS[h.kind].name}`).join(", ")}!`);
    if (parts.length) showToast(parts.join(" · "));
  }, [busy, state.phase, state.ball, state.frame, state.activeSeat, state.laneMods, state.active, viewerSeat, showToast]);

  // ---- my aim → the shared slot (spectators see it via broadcast)
  const pushAim = useCallback(
    (d: Draft, p: number) => {
      onAim({ turn: state.turn, x: d.x, slope: d.slope, spin: d.spin, power: p, at: performance.now() });
    },
    [onAim, state.turn],
  );
  useEffect(() => {
    if (canAim) pushAim(draft, charging ? power : -1);
  }, [canAim, draft, charging, power, pushAim]);

  const editDraft = useCallback(
    (patch: Partial<Draft>) => {
      setDraft((d) => {
        const next = { ...d, ...patch };
        next.x = Math.max(-lim, Math.min(lim, next.x));
        next.slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, next.slope));
        next.spin = Math.max(-1, Math.min(1, next.spin));
        saveDraft(next);
        return next;
      });
    },
    [lim],
  );

  const roll = useCallback(
    (p: number) => {
      if (!canAim) return;
      const r = releaseFor(draft, p);
      const q = quantizeRoll(Math.max(-lim, Math.min(lim, r.x)), r.vx, r.vy, r.spin);
      setSentTurn(state.turn);
      setCharging(null);
      setPicking(null);
      onAim(null);
      onAction({ type: "roll", seat: viewerSeat, ...q });
    },
    [canAim, draft, lim, state.turn, onAim, onAction, viewerSeat],
  );

  // ---- the power meter: hold to run it, let go to bowl
  useEffect(() => {
    if (!charging) return;
    let id = 0;
    let lastTick = 0;
    const loop = () => {
      const held = performance.now() - charging.since;
      const p = meterAt(held, METER_PERIOD);
      setPower(p);
      if (performance.now() - lastTick > 90) {
        lastTick = performance.now();
        getBowlingSound().play("meter", p);
      }
      id = window.requestAnimationFrame(loop);
    };
    id = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(id);
  }, [charging]);
  const startCharge = useCallback(() => {
    if (!canAim || charging) return;
    getBowlingSound().unlock();
    setCharging({ since: performance.now() });
  }, [canAim, charging]);
  const release = useCallback(() => {
    if (!charging) return;
    const p = meterAt(performance.now() - charging.since, METER_PERIOD);
    roll(p);
  }, [charging, roll]);
  // keyboard: ←/→ position, ↑/↓ aim, A/D hook, hold Space to bowl
  useEffect(() => {
    if (!canAim) return;
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) startCharge();
      } else if (e.key === "ArrowLeft") editDraft({ x: draft.x - 0.027 });
      else if (e.key === "ArrowRight") editDraft({ x: draft.x + 0.027 });
      else if (e.key === "ArrowUp") editDraft({ slope: draft.slope + 0.002 });
      else if (e.key === "ArrowDown") editDraft({ slope: draft.slope - 0.002 });
      else if (e.key === "a" || e.key === "A") editDraft({ spin: draft.spin - 0.1 });
      else if (e.key === "d" || e.key === "D") editDraft({ spin: draft.spin + 0.1 });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        release();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [canAim, draft, editDraft, startCharge, release]);

  const onFps = useCallback((fps: number) => {
    if (fps < 26) {
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

  const applyItem = (kind: ItemKind, target: Seat) => {
    if (!canUseItem(state, viewerSeat, kind, target)) return;
    setPicking(null);
    onAction({ type: "item", seat: viewerSeat, kind, target });
  };

  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const activeName = names[state.activeSeat] ?? `${state.activeSeat + 1}번`;
  const activeIsBot = botSeats.has(state.activeSeat);
  const standingSet = useMemo(() => new Set(busy && state.lastRoll ? state.lastRoll.setup.pins.map((p) => p.id) : state.standing), [busy, state.lastRoll, state.standing]);
  const downSet = useMemo(() => (lastShown && !busy ? new Set(lastShown.down) : undefined), [lastShown, busy]);
  const myItems = state.items[viewerSeat] ?? [];
  const itemsOpen = myTurn && !busy && state.ball === 0 && !state.itemUsed && state.options.items;
  const others = Array.from({ length: state.playerCount }, (_, s) => s).filter((s) => s !== viewerSeat);
  // from the sheet as shown, so a roll still playing does not spoil its result
  const myTotal = totalOfRolls(shownRolls[viewerSeat] ?? []);

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          {state.phase === "ended" ? "게임 끝" : `${state.frame + 1}/${state.options.frames} 프레임${last ? " 🔥 마지막" : ""}`} · {mod.icon} {mod.name}
        </span>
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
          <SuiteSoundHud suite={getBowlingSound} icon="🎳" label="Disco Lanes" preview="strike" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {/* 무대 */}
      <div className="relative h-[58vh] max-h-[640px] min-h-[320px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {canWebgl ? (
          <BowlingScene state={state} player={player} viewerSeat={viewerSeat} canAim={canAim} aim={aim} onDraft={editDraft} onEvent={handleEvent} onBusy={handleBusy} names={names} helper={state.options.helper} quality={quality} onFps={onFps} />
        ) : (
          <Lane2D state={state} player={player} canAim={canAim} aim={aim} onDraft={editDraft} onEvent={handleEvent} onBusy={handleBusy} />
        )}

        {/* 차례 띠 */}
        {state.phase === "aim" && (
          <div className="pointer-events-none absolute top-2 left-2 flex max-w-[70%] items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
            <SeatChip seat={busy && state.lastRoll ? state.lastRoll.seat : state.activeSeat} />
            <span className="truncate">{busy ? "🎬 굴러가는 중" : myTurn ? "🫵 내 차례" : `${activeIsBot ? "🤖 " : ""}${activeName}`}</span>
            {!busy && <span className="text-fuchsia-200">{state.ball + 1}구</span>}
            {!busy && remaining !== null && <span className={`tabular-nums ${remaining <= 8 ? "text-rose-300" : "text-white/60"}`}>{remaining}s</span>}
          </div>
        )}
        {/* 핀 배치도 */}
        {state.phase === "aim" && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-xl bg-black/55 p-1.5">
            <PinDiagram standing={standingSet} down={downSet} size={78} />
          </div>
        )}
        {/* 걸린 방해 */}
        {state.phase === "aim" && !busy && (state.active.length > 0 || state.selfBumper) && (
          <div className="pointer-events-none absolute top-24 right-2 flex flex-col items-end gap-1">
            {state.active.map((h, i) => (
              <span key={i} className="rounded-full bg-rose-600/85 px-2 py-0.5 text-[11px] font-bold text-white">
                {ITEMS[h.kind].icon} {ITEMS[h.kind].name} ← {names[h.from] ?? ""}
              </span>
            ))}
            {state.selfBumper && <span className="rounded-full bg-emerald-600/85 px-2 py-0.5 text-[11px] font-bold text-white">🍀 행운 범퍼</span>}
          </div>
        )}
        {/* 세기 */}
        {charging && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="flex w-56 flex-col gap-1 rounded-xl bg-black/70 px-3 py-2 text-[11px] font-bold text-white">
              <span className="flex justify-between">
                세기 <span className="tabular-nums">{Math.round(power * 100)}%</span>
              </span>
              <div className="relative h-3 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-500" style={{ width: `${Math.round(power * 100)}%` }} />
                {/* 기준선: 70~85%가 보통 스트라이크 존 */}
                <div className="absolute inset-y-0 left-[70%] w-[15%] border-x border-white/70" />
              </div>
              <span className="text-white/60">손을 떼면 던져요 · 세게 던지면 덜 휘어요</span>
            </div>
          </div>
        )}
        {banner && (
          <div key={banner.key} className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center">
            <span
              className={`rounded-2xl px-5 py-2 font-black shadow-2xl ${banner.big ? "animate-bounce text-4xl sm:text-5xl" : "text-xl"} ${
                banner.tone === "gold" ? "bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 text-slate-900" : banner.tone === "good" ? "bg-sky-500/95 text-white" : banner.tone === "bad" ? "bg-rose-600/90 text-white" : "bg-black/70 text-white"
              }`}
            >
              {banner.text}
            </span>
          </div>
        )}
        {toast && (
          <div key={toast.key} className="pointer-events-none absolute inset-x-2 bottom-16 flex justify-center">
            <span className="max-w-full rounded-full bg-black/75 px-4 py-1.5 text-center text-xs font-bold break-keep text-white shadow-lg">{toast.text}</span>
          </div>
        )}
      </div>

      {remaining !== null && state.phase === "aim" && !busy && (
        <div className="-mt-1 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full transition-[width] duration-300 ${remaining <= 8 ? "bg-rose-500" : "bg-fuchsia-400"}`} style={{ width: `${Math.min(100, ((remaining * 1000) / AIM_TIMEOUT_MS) * 100)}%` }} />
        </div>
      )}

      {/* 조작 */}
      {state.phase === "aim" && (
        <div className={`${PANEL} flex flex-col gap-3`}>
          {myTurn && !busy && sentTurn !== state.turn ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-white/70 light:text-slate-600">
                  <span className="flex justify-between">
                    <span>📍 서는 위치</span>
                    <span className="font-bold tabular-nums">{boardOf(draft.x)}번 보드</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => editDraft({ x: draft.x - 0.027 })} className="h-9 w-9 shrink-0 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700" aria-label="왼쪽으로">
                      ◀
                    </button>
                    <input type="range" min={-lim} max={lim} step={0.001} value={draft.x} onChange={(e) => editDraft({ x: Number(e.target.value) })} className="w-full accent-fuchsia-500" aria-label="서는 위치" />
                    <button type="button" onClick={() => editDraft({ x: draft.x + 0.027 })} className="h-9 w-9 shrink-0 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700" aria-label="오른쪽으로">
                      ▶
                    </button>
                  </div>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70 light:text-slate-600">
                  <span className="flex justify-between">
                    <span>🎯 방향</span>
                    <span className="font-bold tabular-nums">
                      {Math.abs(slopeDegrees(draft.slope)) < 0.05 ? "정면" : `${slopeDegrees(draft.slope) < 0 ? "왼쪽" : "오른쪽"} ${Math.abs(slopeDegrees(draft.slope)).toFixed(1)}°`}
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => editDraft({ slope: draft.slope - 0.002 })} className="h-9 w-9 shrink-0 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700" aria-label="왼쪽으로 겨누기">
                      ↖
                    </button>
                    <input type="range" min={-MAX_SLOPE} max={MAX_SLOPE} step={0.0005} value={draft.slope} onChange={(e) => editDraft({ slope: Number(e.target.value) })} className="w-full accent-fuchsia-500" aria-label="방향" />
                    <button type="button" onClick={() => editDraft({ slope: draft.slope + 0.002 })} className="h-9 w-9 shrink-0 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700" aria-label="오른쪽으로 겨누기">
                      ↗
                    </button>
                  </div>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/70 light:text-slate-600">
                  <span className="flex justify-between">
                    <span>🌀 회전(훅)</span>
                    <span className="font-bold">{Math.abs(draft.spin) < 0.05 ? "직구" : `${draft.spin < 0 ? "↶ 왼쪽" : "오른쪽 ↷"}으로 ${Math.round(Math.abs(draft.spin) * 100)}%`}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 text-center">↶</span>
                    <input type="range" min={-1} max={1} step={0.05} value={draft.spin} onChange={(e) => editDraft({ spin: Number(e.target.value) })} className="w-full accent-fuchsia-500" aria-label="회전" />
                    <span className="w-5 text-center">↷</span>
                  </div>
                </label>
              </div>
              {itemsOpen && myItems.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-white/50 light:text-slate-500">🎒 내 아이템 — 첫 공을 던지기 전에 하나만 쓸 수 있어요</span>
                  <div className="flex flex-wrap gap-1.5">
                    {myItems.map((k, i) => (
                      <button
                        key={`${k}${i}`}
                        type="button"
                        onClick={() => (ITEMS[k].self ? applyItem(k, viewerSeat) : setPicking((p) => (p === k ? null : k)))}
                        disabled={ITEMS[k].self ? !canUseItem(state, viewerSeat, k, viewerSeat) : !others.some((o) => canUseItem(state, viewerSeat, k, o))}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${picking === k ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/80 light:border-slate-300 light:text-slate-700"}`}
                        title={ITEMS[k].desc}
                      >
                        {ITEMS[k].icon} {ITEMS[k].name}
                      </button>
                    ))}
                  </div>
                  {picking && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-fuchsia-500/10 p-2 text-xs">
                      <span className="text-white/70 light:text-slate-600">{ITEMS[picking].desc} — 누구에게?</span>
                      {others.map((o) => (
                        <button key={o} type="button" disabled={!canUseItem(state, viewerSeat, picking, o)} onClick={() => applyItem(picking, o)} className="flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 font-bold text-white disabled:opacity-40 light:border-slate-300 light:text-slate-700">
                          <SeatChip seat={o} size={13} /> {names[o] ?? `${o + 1}번`} <span className="text-white/50 light:text-slate-400">{totalOf(state, o)}점</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  startCharge();
                }}
                onPointerUp={release}
                onPointerCancel={() => setCharging(null)}
                onContextMenu={(e) => e.preventDefault()}
                className={`${PRIMARY} touch-none py-4 text-base select-none ${charging ? "scale-[0.98] bg-fuchsia-500" : ""}`}
              >
                {charging ? `🎳 놓으면 던져요! ${Math.round(power * 100)}%` : "🎳 꾹 누르고 있다가 놓아서 던지기"}
              </button>
              <p className="text-center text-[11px] break-keep text-white/45 light:text-slate-400">
                레인을 끌면 그쪽으로 겨눠요 · 공을 좌우로 끌면 서는 위치 · 키보드: ←→ 위치, ↑↓ 방향, A/D 회전, 스페이스 꾹
              </p>
            </>
          ) : (
            <p className="text-center text-sm break-keep text-white/70 light:text-slate-600">
              {busy
                ? "공이 굴러가요… 🎳"
                : myTurn
                  ? "던졌어요!"
                  : `${activeIsBot ? "🤖 " : ""}${activeName}님이 ${state.ball + 1}구를 준비하고 있어요${state.options.items && (state.items[viewerSeat]?.length ?? 0) > 0 ? " · 🎒 내 아이템은 내 차례 첫 공 전에 쓸 수 있어요" : ""}`}
            </p>
          )}
          {state.phase === "aim" && state.options.frames > 1 && (
            <p className="text-center text-[11px] text-white/40 light:text-slate-400">
              내 점수 {myTotal}점 · 남은 공을 모두 스트라이크로 치면 최대 {maxPossible(shownRolls[viewerSeat] ?? [])}점
            </p>
          )}
        </div>
      )}

      {state.phase === "ended" && !busy && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      <ScoreSheet state={state} viewerSeat={viewerSeat} names={names} botSeats={botSeats} connectedSeats={connectedSeats} busy={busy} shownRolls={shownRolls} />

      {state.options.items && state.phase === "aim" && state.playerCount > 1 && (
        <div className={`${PANEL} flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/60 light:text-slate-500`}>
          <span className="font-semibold">🎒 아이템</span>
          {Array.from({ length: state.playerCount }, (_, s) => (
            <span key={s} className="flex items-center gap-1">
              <SeatChip seat={s} size={12} />
              {(state.items[s] ?? []).length === 0 ? "—" : (state.items[s] ?? []).map((k) => ITEMS[k].icon).join("")}
              {(state.pending[s] ?? []).length > 0 && <span className="text-rose-300 light:text-rose-600">⚠️{state.pending[s].map((h) => ITEMS[h.kind].icon).join("")}</span>}
            </span>
          ))}
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: BowlingState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">🎳 최종 결과</h3>
      <ol className="flex flex-col gap-1.5">
        {rankings.map((r) => (
          <li key={r.seat} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${r.seat === viewerSeat ? "bg-fuchsia-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-8 font-black text-fuchsia-200 light:text-fuchsia-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
            <SeatChip seat={r.seat} />
            <span className="min-w-0 flex-1 truncate text-white/85 light:text-slate-700">{names[r.seat] ?? `${r.seat + 1}번`}</span>
            <span className="font-black tabular-nums text-white light:text-slate-900">{totalOf(state, r.seat)}점</span>
            <span className="text-xs text-amber-200/80 light:text-amber-700">X{strikesOf(state, r.seat)}</span>
            <span className="text-xs text-sky-200/80 light:text-sky-700">/{sparesOf(state, r.seat)}</span>
          </li>
        ))}
      </ol>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
