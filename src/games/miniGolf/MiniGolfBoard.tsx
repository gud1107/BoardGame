"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { HOLES, layoutFor, OBSTACLE_KINDS, OBSTACLES, type ObstacleKind } from "./course";
import {
  ballSpot,
  capOf,
  computeRankings,
  currentHole,
  currentLayout,
  holeInOnesOf,
  liveTotal,
  parOf,
  PICK_TIMEOUT_MS,
  quantizeShot,
  scoreName,
  SHOT_TIMEOUT_MS,
  toPar,
  totalOf,
  type EngineAction,
  type MiniGolfState,
  type Seat,
  type ShotRecord,
} from "./engine";
import { BALL_R, CUP_R, simulate, type Layout } from "./physics";
import { ReplayPlayer, type ReplayEvent, type ReplayView } from "./replay";
import { aimLabel, normAngle, velocityFor, type LiveAim } from "./aim";
import { windmillNow } from "./clock";
import { getMiniGolfSound, miniGolfCues } from "./miniGolfSound";
import RulebookModal from "./RulebookModal";
import { webglAvailable } from "./three/webgl";
import { resultLabel } from "./labels";
import { SEAT_COLORS, SEAT_MARKS, SEAT_NAMES } from "./three/textures";
import type { CamMode } from "./three/GolfScene";

const Loading3D = () => <div className="flex h-full items-center justify-center bg-[#bfe3ff] text-xs text-sky-900/60">☁️ 섬을 띄우는 중…</div>;
const GolfScene = dynamic(() => import("./three/GolfScene"), { ssr: false, loading: Loading3D });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-40";
const QUALITY_KEY = "mini-golf-quality";
const CAM_KEY = "mini-golf-cam";
const FULL_PULL = 1.1;
const DEG = Math.PI / 180;

interface Props {
  state: MiniGolfState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  deadlineMs: number | null;
  nowMs: number;
  /** Shared aim slot, owned by the room (remote aims and mine both land here). */
  aim: MutableRefObject<LiveAim | null>;
  onAim: (aim: LiveAim | null) => void;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
  /** The replay is (not) playing — the room holds bots and the turn clock while it is. */
  onBusy: (busy: boolean) => void;
}

interface Draft {
  turn: number;
  ang: number;
  power: number;
}

function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

/** A seat's colour chip with its shape mark (§1 — readable without colour). */
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

/* ── 2D fallback (no WebGL): the hole from above ─────────────────────── */

function Course2D({ state, player, canAim, aim, preview, onDraft, onEvent, onBusy }: { state: MiniGolfState; player: ReplayPlayer; canAim: boolean; aim: MutableRefObject<LiveAim | null>; preview: ObstacleKind | null; onDraft: (p: { ang?: number; power?: number; dragging?: boolean }, shoot?: boolean) => void; onEvent: (e: ReplayEvent) => void; onBusy: (b: boolean) => void }) {
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
      setAimView(a && a.turn === state.turn && !v.busy ? { ...a } : null);
      id = window.requestAnimationFrame(loop);
    };
    id = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(id);
  }, [player, state, aim]);
  const rec = view?.rec;
  const L: Layout = rec ? layoutFor(rec.holeId, rec.obstacle) : state.phase === "pick" && state.holeIdx + 1 < state.holes.length ? layoutFor(state.holes[state.holeIdx + 1], preview) : currentLayout(state);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of L.ground)
    for (const [x, y] of g) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  x0 -= 0.2;
  y0 -= 0.2;
  x1 += 0.2;
  y1 += 0.2;
  const Y = (y: number) => y1 + y0 - y;
  const pts = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${x},${Y(y)}`).join(" ");
  const toCourse = (cx: number, cy: number) => {
    const s = svg.current;
    const ctm = s?.getScreenCTM();
    if (!s || !ctm) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    return { x: p.x, y: y1 + y0 - p.y };
  };
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const lastPull = useRef<{ ang: number; power: number } | null>(null);
  const active = view?.balls.find((b) => b.active);
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-sky-300 to-sky-100 p-2">
      <svg
        ref={svg}
        viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-auto max-w-full touch-none select-none"
        onPointerDown={(e) => {
          if (!canAim) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          dragFrom.current = toCourse(e.clientX, e.clientY);
          lastPull.current = null;
          onDraft({ dragging: true });
        }}
        onPointerMove={(e) => {
          const f = dragFrom.current;
          if (!f || !e.buttons) return;
          const p = toCourse(e.clientX, e.clientY);
          if (!p) return;
          const px = f.x - p.x;
          const py = f.y - p.y;
          const pull = Math.hypot(px, py);
          if (pull < 0.04) {
            lastPull.current = null;
            return;
          }
          lastPull.current = { ang: Math.atan2(py, px), power: Math.min(1, pull / FULL_PULL) };
          onDraft({ ...lastPull.current, dragging: true });
        }}
        onPointerUp={() => {
          if (!dragFrom.current) return;
          dragFrom.current = null;
          onDraft({ dragging: false }, !!lastPull.current && lastPull.current.power >= 0.03);
        }}
        onPointerCancel={() => {
          dragFrom.current = null;
          onDraft({ dragging: false });
        }}
      >
        {L.ground.map((g, i) => (
          <polygon key={`g${i}`} points={pts(g)} fill="#4fae4a" stroke="#2f6e2b" strokeWidth={0.02} />
        ))}
        {L.voids.map((v, i) => (
          <polygon key={`v${i}`} points={pts(v)} fill="#bfe6ff" />
        ))}
        {L.zones.map((z, i) => (
          <polygon key={`z${i}`} points={pts(z.poly)} fill={z.kind === "sand" ? "#e9d49a" : z.kind === "ice" ? "#cbeeff" : "rgba(255,255,255,0.18)"} />
        ))}
        {L.zones
          .filter((z) => z.kind === "slope")
          .map((z, i) => {
            const cx = z.poly.reduce((a, p) => a + p[0], 0) / z.poly.length;
            const cy = z.poly.reduce((a, p) => a + p[1], 0) / z.poly.length;
            const l = Math.hypot(z.ax, z.ay) || 1;
            return <line key={`s${i}`} x1={cx} y1={Y(cy)} x2={cx + (z.ax / l) * 0.25} y2={Y(cy + (z.ay / l) * 0.25)} stroke="white" strokeWidth={0.025} markerEnd="url(#mg-arrow)" />;
          })}
        {L.ramps.map((r, i) => (
          <polygon key={`r${i}`} points={pts(r.poly)} fill="#ffd23f" stroke="#2b2b33" strokeWidth={0.015} />
        ))}
        {L.walls.map((s, i) => (
          <line key={`w${i}`} x1={s.x1} y1={Y(s.y1)} x2={s.x2} y2={Y(s.y2)} stroke="#a76a33" strokeWidth={0.04} strokeLinecap="round" />
        ))}
        {L.windmill && <line x1={L.windmill.gate.x1} y1={Y(L.windmill.gate.y1)} x2={L.windmill.gate.x2} y2={Y(L.windmill.gate.y2)} stroke="#e85d4f" strokeWidth={0.03} strokeDasharray="0.04 0.03" />}
        {L.bumpers.map((b, i) => (
          <circle key={`b${i}`} cx={b.x} cy={Y(b.y)} r={b.r} fill="#e8473c" stroke="#fff" strokeWidth={0.015} />
        ))}
        {L.magnets.map((m, i) => (
          <g key={`m${i}`}>
            <circle cx={m.x} cy={Y(m.y)} r={m.field} fill="rgba(255,90,90,0.08)" stroke="rgba(255,90,90,0.4)" strokeWidth={0.01} />
            <circle cx={m.x} cy={Y(m.y)} r={m.r} fill="#4b5263" />
          </g>
        ))}
        <circle cx={L.cup.x} cy={Y(L.cup.y)} r={CUP_R} fill="#0b0d10" stroke="#fff" strokeWidth={0.012} />
        {aimView && active && (
          <line x1={active.x} y1={Y(active.y)} x2={active.x + Math.cos(aimView.ang) * (0.18 + aimView.power * 1.5)} y2={Y(active.y + Math.sin(aimView.ang) * (0.18 + aimView.power * 1.5))} stroke="#fff6c4" strokeWidth={0.02} strokeDasharray="0.05 0.03" />
        )}
        {view?.balls.map((b) =>
          b.visible ? <circle key={b.seat} cx={b.x} cy={Y(b.y)} r={BALL_R * (1 + Math.max(0, b.z) * 3) * (b.z < 0 ? Math.max(0.2, 1 + b.z * 2) : 1)} fill="#fbfbf7" stroke={SEAT_COLORS[b.seat % 6]} strokeWidth={b.active ? 0.022 : 0.014} /> : null,
        )}
        <defs>
          <marker id="mg-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="white" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

/* ── score card ──────────────────────────────────────────────────────── */

function scoreTone(score: number, par: number): string {
  if (score === 1) return "text-amber-300 light:text-amber-600";
  if (score < par) return "text-sky-300 light:text-sky-600";
  if (score === par) return "text-white/85 light:text-slate-700";
  return "text-rose-300 light:text-rose-600";
}

function ScoreCard({ state, viewerSeat, names, botSeats, connectedSeats, hide }: { state: MiniGolfState; viewerSeat: Seat; names: Record<Seat, string>; botSeats: Set<Seat>; connectedSeats: Set<Seat>; hide: ShotRecord | null }) {
  const N = state.holes.length;
  return (
    <div className={`${PANEL} overflow-x-auto`}>
      <table className="w-full min-w-[420px] border-collapse text-center text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] text-white/40 light:text-slate-400">
            <th className="w-28 text-left font-semibold">홀</th>
            {state.holes.map((id, i) => (
              <th key={i} className={`font-semibold ${i === state.holeIdx && state.phase === "play" ? "text-emerald-300 light:text-emerald-700" : ""}`} title={HOLES[id].name}>
                {i + 1}
                {state.obstacles[i] ? <span className="ml-0.5">{OBSTACLES[state.obstacles[i]!].icon}</span> : null}
              </th>
            ))}
            <th className="w-10 font-semibold">합계</th>
            <th className="w-10 font-semibold">파 대비</th>
          </tr>
          <tr className="text-[10px] text-white/35 light:text-slate-400">
            <td className="text-left">파</td>
            {state.holes.map((id, i) => (
              <td key={i}>{HOLES[id].par}</td>
            ))}
            <td>{state.holes.reduce((a, id) => a + HOLES[id].par, 0)}</td>
            <td />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: state.playerCount }, (_, s) => {
            const active = state.phase === "play" && s === state.activeSeat;
            let tp = toPar(state, s);
            let tot = totalOf(state, s);
            const hidden = hide && hide.seat === s && hide.score !== null ? hide : null;
            if (hidden) {
              tot -= hidden.score!;
              tp -= hidden.score! - HOLES[hidden.holeId].par;
            }
            return (
              <tr key={s} className={`border-t border-white/5 light:border-slate-100 ${active ? "bg-emerald-500/10" : ""}`}>
                <td className="py-1 text-left">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(s) ? "bg-emerald-400" : "bg-white/20"}`} />
                    <SeatChip seat={s} size={14} />
                    <span className={`truncate ${s === viewerSeat ? "font-black text-emerald-200 light:text-emerald-700" : "text-white/80 light:text-slate-700"}`}>
                      {botSeats.has(s) ? "🤖 " : ""}
                      {names[s] ?? `${s + 1}번`}
                    </span>
                  </span>
                </td>
                {Array.from({ length: N }, (_, i) => {
                  let sc = state.scores[s][i];
                  if (hidden && hidden.holeIdx === i) sc = null;
                  const par = parOf(state, i);
                  const live = i === state.holeIdx && state.phase === "play" && sc === null ? state.strokes[s] : null;
                  return (
                    <td key={i} className="border-l border-white/5 px-0.5 py-1 light:border-slate-100">
                      {sc !== null ? (
                        <span className={`font-black ${scoreTone(sc, par)}`} title={scoreName(sc, par)}>
                          {sc}
                          {sc === 1 ? "⛳" : ""}
                        </span>
                      ) : live ? (
                        <span className="text-white/35 light:text-slate-400">{live}…</span>
                      ) : (
                        ""
                      )}
                    </td>
                  );
                })}
                <td className="border-l border-white/5 text-sm font-black text-emerald-200 light:border-slate-100 light:text-emerald-700">{tot}</td>
                <td className={`text-xs font-bold ${tp < 0 ? "text-sky-300 light:text-sky-600" : tp > 0 ? "text-rose-300 light:text-rose-600" : "text-white/60 light:text-slate-500"}`}>{tp === 0 ? "E" : tp > 0 ? `+${tp}` : tp}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── the board ────────────────────────────────────────────────────────── */

interface Banner {
  key: number;
  text: string;
  tone: "gold" | "good" | "bad" | "info";
  big: boolean;
}

export default function MiniGolfBoard({ state, viewerSeat, names, connectedSeats, botSeats, deadlineMs, nowMs, aim, onAim, onAction, onGameEnd, onBusy }: Props) {
  const [canWebgl] = useState(webglAvailable);
  const [quality, setQuality] = useState<"high" | "low">(() => (load(QUALITY_KEY) === "low" ? "low" : "high"));
  const [cam, setCam] = useState<CamMode>(() => (load(CAM_KEY) === "overview" ? "overview" : "follow"));
  const [rules, setRules] = useState(false);
  const [player] = useState(() => new ReplayPlayer());
  const [busy, setBusy] = useState(false);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const [draftRaw, setDraft] = useState<Draft | null>(null);
  const [dragging, setDragging] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [preview, setPreview] = useState<ObstacleKind | null>(null);
  const [shownTurn, setShownTurn] = useState<number>(state.lastShot?.turn ?? -1);
  const seq = useRef(0);
  const lastClack = useRef(0);

  const hole = currentHole(state);
  const par = hole.par;
  const myTurn = state.phase === "play" && state.activeSeat === viewerSeat;
  const canAim = myTurn && !busy && sentTurn !== state.turn;
  const iPick = state.phase === "pick" && state.picker === viewerSeat && !busy;
  const L = currentLayout(state);
  const spot = ballSpot(state, state.activeSeat);
  const defaultAng = Math.atan2(L.cup.y - spot.y, L.cup.x - spot.x);
  // the draft belongs to one turn; a new turn starts aimed at the cup
  const draft: Draft = useMemo(() => (draftRaw && draftRaw.turn === state.turn ? draftRaw : { turn: state.turn, ang: defaultAng, power: 0.35 }), [draftRaw, state.turn, defaultAng]);

  useSuiteBgm(getMiniGolfSound, state.phase !== "ended", state.holeIdx === state.holes.length - 1 ? 1 : 0);
  const classify = useMemo(() => miniGolfCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getMiniGolfSound, classify);

  const showBanner = useCallback((text: string, tone: Banner["tone"], big: boolean) => {
    seq.current += 1;
    setBanner({ key: seq.current, text, tone, big });
  }, []);
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner((b) => (b?.key === banner.key ? null : b)), banner.big ? 2400 : 1900);
    return () => window.clearTimeout(id);
  }, [banner]);
  const showToast = useCallback((text: string) => {
    seq.current += 1;
    setToast({ key: seq.current, text });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast((t) => (t?.key === toast.key ? null : t)), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleBusy = useCallback(
    (b: boolean) => {
      setBusy(b);
      onBusy(b);
    },
    [onBusy],
  );

  const namesRef = useRef(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  const handleEvent = useCallback(
    (e: ReplayEvent) => {
      const sound = getMiniGolfSound();
      if (e.kind === "swing") sound.play("putt", e.power);
      else if (e.kind === "hit") {
        const now = performance.now();
        if (e.ev === "wall" || e.ev === "post") {
          if (now - lastClack.current < 50) return;
          lastClack.current = now;
          sound.play(e.ev === "post" ? "magnet" : "wall", e.impulse);
          if (e.ev === "post") sound.play("wall", e.impulse);
        } else if (e.ev === "bumper") sound.play("bumper");
        else if (e.ev === "ball") sound.play("clack", e.impulse);
        else if (e.ev === "cup") sound.play("cup");
        else if (e.ev === "out") sound.play("fall");
        else if (e.ev === "launch") sound.play("launch");
        else if (e.ev === "land") sound.play("land");
        else if (e.ev === "windmill") sound.play("blade");
        else if (e.ev === "sand") sound.play("sand");
      } else if (e.kind === "settled") {
        const r = e.rec;
        const label = resultLabel(r, namesRef.current);
        showBanner(label.text, label.tone, label.big);
        if (r.timeout) sound.play("whiff");
        else if (r.holed) {
          const d = r.stroke - HOLES[r.holeId].par;
          sound.play(r.stroke === 1 ? "holeInOne" : d < 0 ? "birdie" : d === 0 ? "par" : "bogey");
        } else if (r.out) sound.play("splash");
        else if (r.knockedOut.length > 0) sound.play("knock");
        setShownTurn(r.turn);
      } else if (e.kind === "done") setShownTurn((t) => Math.max(t, e.rec.turn));
    },
    [showBanner],
  );

  // a new hole: name, par, hint, obstacle
  const lastHoleShown = useRef(-1);
  useEffect(() => {
    if (busy || state.phase !== "play") return;
    if (lastHoleShown.current === state.holeIdx) return;
    lastHoleShown.current = state.holeIdx;
    const ob = state.obstacles[state.holeIdx];
    const parts = [`⛳ ${state.holeIdx + 1}번 홀 「${hole.name}」 파 ${hole.par}`, hole.hint];
    if (ob) parts.push(`${OBSTACLES[ob].icon} ${OBSTACLES[ob].name}${state.lastPick && state.lastPick.holeIdx === state.holeIdx ? ` ← ${names[state.lastPick.seat] ?? ""}님 선택` : ""}`);
    showToast(parts.join(" · "));
    if (state.holeIdx > 0) getMiniGolfSound().play("hole");
  }, [busy, state.phase, state.holeIdx, state.obstacles, state.lastPick, hole, names, showToast]);

  // ---- my aim → the shared slot (spectators see it via broadcast)
  useEffect(() => {
    if (canAim) onAim({ turn: state.turn, ang: draft.ang, power: draft.power, dragging, at: performance.now() });
  }, [canAim, draft.ang, draft.power, dragging, state.turn, onAim]);

  // the scene's drag handlers capture these callbacks at pointer-down, so they read the live draft / turn from refs
  const live = useRef({ canAim, draft, turn: state.turn, seat: viewerSeat });
  useEffect(() => {
    live.current = { canAim, draft, turn: state.turn, seat: viewerSeat };
  });

  const shoot = useCallback(
    (d: Draft) => {
      if (!live.current.canAim) return;
      const v = velocityFor(d.ang, d.power);
      const q = quantizeShot(v.vx, v.vy, windmillNow());
      live.current = { ...live.current, canAim: false };
      setSentTurn(live.current.turn);
      setDragging(false);
      onAim(null);
      getMiniGolfSound().unlock();
      onAction({ type: "shot", seat: live.current.seat, ...q });
    },
    [onAim, onAction],
  );

  const editDraft = useCallback(
    (patch: { ang?: number; power?: number; dragging?: boolean }, fire?: boolean) => {
      const cur = live.current;
      if (!cur.canAim) return;
      const next: Draft = { turn: cur.turn, ang: normAngle(patch.ang ?? cur.draft.ang), power: Math.max(0.02, Math.min(1, patch.power ?? cur.draft.power)) };
      live.current = { ...cur, draft: next };
      setDraft(next);
      if (patch.dragging !== undefined) setDragging(patch.dragging);
      if (patch.power !== undefined && patch.dragging) getMiniGolfSound().play("meter", next.power);
      if (fire) shoot(next);
    },
    [shoot],
  );

  // keyboard: ←/→ direction, ↑/↓ power, Space to putt
  useEffect(() => {
    if (!canAim) return;
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const step = e.shiftKey ? 10 : 1;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) shoot(draft);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        editDraft({ ang: draft.ang + step * DEG });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        editDraft({ ang: draft.ang - step * DEG });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        editDraft({ power: draft.power + 0.01 * step });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        editDraft({ power: draft.power - 0.01 * step });
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [canAim, draft, editDraft, shoot]);

  const onFps = useCallback((fps: number) => {
    if (fps < 26) {
      setQuality((q) => {
        if (q === "low") return q;
        save(QUALITY_KEY, "low");
        return "low";
      });
    }
  }, []);

  // roughly how far a putt goes on flat carpet (for the power label)
  const rollDist = useMemo(() => {
    const v = velocityFor(0, draft.power);
    const flat: Layout = { ground: [[[-1, -1], [60, -1], [60, 1], [-1, 1]]], voids: [], walls: [], zones: [], bumpers: [], windmill: null, ramps: [], magnets: [], tee: { x: 0, y: 0 }, cup: { x: 99, y: 99 } };
    const r = simulate(flat, [{ id: 0, x: 0, y: 0 }], { shooter: 0, vx: v.vx, vy: 0, wm: 0 });
    return r.balls[0].x;
  }, [draft.power]);

  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const timeoutMs = state.phase === "pick" ? PICK_TIMEOUT_MS : SHOT_TIMEOUT_MS;
  const activeName = names[state.activeSeat] ?? `${state.activeSeat + 1}번`;
  const activeIsBot = botSeats.has(state.activeSeat);
  const hide = busy && state.lastShot && state.lastShot.turn > shownTurn ? state.lastShot : null;
  const ob = state.obstacles[state.holeIdx];
  const cap = capOf(par);
  const pickerName = state.picker !== null ? (names[state.picker] ?? `${state.picker + 1}번`) : "";
  const nextHole = state.phase === "pick" ? HOLES[state.holes[state.holeIdx + 1]] : null;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          {state.phase === "ended" ? "게임 끝" : state.phase === "pick" ? `다음: ${state.holeIdx + 2}번 홀` : `${state.holeIdx + 1}/${state.holes.length}번 홀 · 파 ${par}`}
          {state.phase === "play" && ` · ${hole.name}`}
          {state.phase === "play" && ob ? ` · ${OBSTACLES[ob].icon}` : ""}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {canWebgl && (
            <button
              type="button"
              onClick={() => {
                const next = quality === "high" ? "low" : "high";
                setQuality(next);
                save(QUALITY_KEY, next);
              }}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600"
            >
              {quality === "high" ? "✨ 고화질" : "⚡ 가볍게"}
            </button>
          )}
          <SuiteSoundHud suite={getMiniGolfSound} icon="⛳" label="Cloud Hopper" preview="holeInOne" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {/* 무대 */}
      <div className="relative h-[58vh] max-h-[640px] min-h-[320px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {canWebgl ? (
          <GolfScene state={state} player={player} viewerSeat={viewerSeat} canAim={canAim} aim={aim} onDraft={editDraft} onEvent={handleEvent} onBusy={handleBusy} names={names} helper={state.options.helper} quality={quality} cam={cam} preview={preview} onFps={onFps} />
        ) : (
          <Course2D state={state} player={player} canAim={canAim} aim={aim} preview={preview} onDraft={editDraft} onEvent={handleEvent} onBusy={handleBusy} />
        )}

        {/* 차례 띠 */}
        {state.phase === "play" && (
          <div className="pointer-events-none absolute top-2 left-2 flex max-w-[66%] items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
            <SeatChip seat={busy && state.lastShot ? state.lastShot.seat : state.activeSeat} />
            <span className="truncate">{busy ? "🎬 굴러가는 중" : myTurn ? "🫵 내 차례" : `${activeIsBot ? "🤖 " : ""}${activeName}`}</span>
            {!busy && <span className="text-emerald-200">{state.strokes[state.activeSeat] + 1}타째</span>}
            {!busy && remaining !== null && <span className={`tabular-nums ${remaining <= 8 ? "text-rose-300" : "text-white/60"}`}>{remaining}s</span>}
          </div>
        )}
        {canWebgl && state.phase === "play" && (
          <button
            type="button"
            onClick={() => {
              const next = cam === "follow" ? "overview" : "follow";
              setCam(next);
              save(CAM_KEY, next);
            }}
            className="absolute top-2 right-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white"
          >
            {cam === "follow" ? "🗺️ 전체 보기" : "🎥 공 따라가기"}
          </button>
        )}
        {/* 당기는 세기 */}
        {dragging && canAim && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="flex w-56 flex-col gap-1 rounded-xl bg-black/70 px-3 py-2 text-[11px] font-bold text-white">
              <span className="flex justify-between">
                🏹 세기 <span className="tabular-nums">{Math.round(draft.power * 100)}%</span>
              </span>
              <div className="h-3 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-500" style={{ width: `${Math.round(draft.power * 100)}%` }} />
              </div>
              <span className="text-white/60">놓으면 쳐요 · 처음 누른 곳으로 되돌리면 취소</span>
            </div>
          </div>
        )}
        {banner && (
          <div key={banner.key} className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center px-2">
            <span
              className={`rounded-2xl px-5 py-2 text-center font-black break-keep shadow-2xl ${banner.big ? "animate-bounce text-3xl sm:text-5xl" : "text-lg sm:text-xl"} ${
                banner.tone === "gold" ? "bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 text-slate-900" : banner.tone === "good" ? "bg-emerald-500/95 text-white" : banner.tone === "bad" ? "bg-rose-600/90 text-white" : "bg-black/70 text-white"
              }`}
            >
              {banner.text}
            </span>
          </div>
        )}
        {toast && (
          <div key={toast.key} className="pointer-events-none absolute inset-x-2 bottom-16 flex justify-center">
            <span className="max-w-full rounded-2xl bg-black/75 px-4 py-1.5 text-center text-xs font-bold break-keep text-white shadow-lg">{toast.text}</span>
          </div>
        )}
      </div>

      {remaining !== null && state.phase !== "ended" && !busy && (
        <div className="-mt-1 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full transition-[width] duration-300 ${remaining <= 8 ? "bg-rose-500" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, ((remaining * 1000) / timeoutMs) * 100)}%` }} />
        </div>
      )}

      {/* 조작 */}
      {state.phase === "play" && (
        <div className={`${PANEL} flex flex-col gap-3`}>
          {canAim ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 text-xs text-white/70 light:text-slate-600">
                  <span className="flex justify-between">
                    <span>🎯 방향</span>
                    <span className="font-bold tabular-nums">{aimLabel(draft.ang)}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {[
                      { l: "⏪", d: 10, a: "왼쪽으로 10도" },
                      { l: "◀", d: 1, a: "왼쪽으로 1도" },
                    ].map((b) => (
                      <button key={b.l} type="button" onClick={() => editDraft({ ang: draft.ang + b.d * DEG })} aria-label={b.a} className="h-10 min-w-10 flex-1 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                        {b.l}
                      </button>
                    ))}
                    <button type="button" onClick={() => editDraft({ ang: defaultAng })} className="h-10 flex-[1.4] rounded-lg border border-emerald-400/40 text-[11px] font-bold text-emerald-200 light:border-emerald-500 light:text-emerald-700">
                      ⛳ 컵 쪽
                    </button>
                    {[
                      { l: "▶", d: -1, a: "오른쪽으로 1도" },
                      { l: "⏩", d: -10, a: "오른쪽으로 10도" },
                    ].map((b) => (
                      <button key={b.l} type="button" onClick={() => editDraft({ ang: draft.ang + b.d * DEG })} aria-label={b.a} className="h-10 min-w-10 flex-1 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                        {b.l}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-xs text-white/70 light:text-slate-600">
                  <span className="flex justify-between">
                    <span>💪 세기</span>
                    <span className="font-bold tabular-nums">
                      {Math.round(draft.power * 100)}% · 평지 약 {rollDist.toFixed(1)} m
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => editDraft({ power: draft.power - 0.01 })} className="h-10 w-10 shrink-0 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700" aria-label="세기 줄이기">
                      −
                    </button>
                    <input type="range" min={0.02} max={1} step={0.005} value={draft.power} onChange={(e) => editDraft({ power: Number(e.target.value) })} className="w-full accent-emerald-500" aria-label="세기" />
                    <button type="button" onClick={() => editDraft({ power: draft.power + 0.01 })} className="h-10 w-10 shrink-0 rounded-lg border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700" aria-label="세기 올리기">
                      +
                    </button>
                  </div>
                </label>
              </div>
              <button type="button" onClick={() => shoot(draft)} className={`${PRIMARY} py-4 text-base`}>
                🏌️ 치기 ({state.strokes[viewerSeat] + 1}타째)
              </button>
              <p className="text-center text-[11px] break-keep text-white/45 light:text-slate-400">
                코스를 누른 채 보낼 방향 <b>반대로</b> 끌었다 놓으면 새총처럼 쳐요 · 키보드: ←→ 방향(Shift 10°), ↑↓ 세기, 스페이스 치기
                {L.windmill ? " · 🌀 날개가 터널 입구를 막는 순간을 피해서!" : ""}
              </p>
            </>
          ) : (
            <p className="text-center text-sm break-keep text-white/70 light:text-slate-600">
              {busy ? "공이 굴러가요… ⛳" : myTurn ? "쳤어요!" : `${activeIsBot ? "🤖 " : ""}${activeName}님이 ${state.strokes[state.activeSeat] + 1}타째를 준비하고 있어요`}
            </p>
          )}
          <p className="text-center text-[11px] text-white/40 light:text-slate-400">
            이 홀 내 타수 {state.strokes[viewerSeat] ?? 0} · {cap}타까지 못 넣으면 공을 줍고 {cap + 1}타 · 누적 {liveTotal(state, viewerSeat)}타
          </p>
        </div>
      )}

      {/* 장애물 고르기 */}
      {state.phase === "pick" && !busy && nextHole && (
        <div className={`${PANEL} flex flex-col gap-3`}>
          {iPick ? (
            <>
              <p className="text-center text-sm font-bold break-keep text-white light:text-slate-900">
                🎲 꼴찌 역전 찬스! {state.holeIdx + 2}번 홀 「{nextHole.name}」에 놓을 장애물을 골라요
              </p>
              <p className="-mt-2 text-center text-[11px] break-keep text-white/50 light:text-slate-500">눌러서 미리 보고, 한 번 더 누르면 확정 · 고른 사람은 이 홀을 맨 마지막에 쳐요</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {OBSTACLE_KINDS.map((k) => {
                  const o = OBSTACLES[k];
                  const sel = preview === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        if (sel) {
                          getMiniGolfSound().play("pick");
                          onAction({ type: "pick", seat: viewerSeat, kind: k });
                          setPreview(null);
                        } else setPreview(k);
                      }}
                      className={`flex flex-col gap-1 rounded-xl border p-3 text-left text-xs break-keep ${sel ? "border-emerald-400 bg-emerald-500/20 text-emerald-50 light:text-emerald-900" : "border-white/15 text-white/75 light:border-slate-300 light:text-slate-600"}`}
                    >
                      <b className="text-base">
                        {o.icon} {o.name} {sel ? "— 한 번 더 누르면 확정!" : ""}
                      </b>
                      {o.desc}
                      <span className="text-emerald-200/80 light:text-emerald-700">💡 {o.tip}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-center text-sm break-keep text-white/70 light:text-slate-600">
              🎲 {botSeats.has(state.picker ?? -1) ? "🤖 " : ""}
              {pickerName}님(꼴찌)이 {state.holeIdx + 2}번 홀 「{nextHole.name}」의 장애물을 고르고 있어요…
            </p>
          )}
        </div>
      )}

      {state.phase === "ended" && !busy && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      <ScoreCard state={state} viewerSeat={viewerSeat} names={names} botSeats={botSeats} connectedSeats={connectedSeats} hide={hide} />

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: MiniGolfState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">⛳ 최종 결과</h3>
      <ol className="flex flex-col gap-1.5">
        {rankings.map((r) => {
          const tp = toPar(state, r.seat);
          const hio = holeInOnesOf(state, r.seat);
          return (
            <li key={r.seat} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${r.seat === viewerSeat ? "bg-emerald-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
              <span className="w-8 font-black text-emerald-200 light:text-emerald-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
              <SeatChip seat={r.seat} />
              <span className="min-w-0 flex-1 truncate text-white/85 light:text-slate-700">{names[r.seat] ?? `${r.seat + 1}번`}</span>
              <span className="font-black tabular-nums text-white light:text-slate-900">{totalOf(state, r.seat)}타</span>
              <span className={`w-9 text-right text-xs font-bold ${tp < 0 ? "text-sky-300 light:text-sky-600" : tp > 0 ? "text-rose-300 light:text-rose-600" : "text-white/60"}`}>{tp === 0 ? "E" : tp > 0 ? `+${tp}` : tp}</span>
              {hio > 0 && <span className="text-xs text-amber-200 light:text-amber-700">⛳×{hio}</span>}
            </li>
          );
        })}
      </ol>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
