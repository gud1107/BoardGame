"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  AIM_TIMEOUT_MS,
  aliveCount,
  computeRankings,
  maxChain,
  quantizeShot,
  ROUND_SHOT_LIMIT,
  sideOf,
  stoneCountFor,
  toSim,
  type AlkkagiState,
  type EngineAction,
  type Seat,
  type Stone,
} from "./engine";
import { EDGE, firstContact, slideDistance, speedForPower } from "./physics";
import { ReplayPlayer, type ReplayEvent, type ReplayView } from "./replay";
import { alkkagiCues, getAlkkagiSound } from "./alkkagiSound";
import RulebookModal from "./RulebookModal";
import { webglAvailable } from "./three/webgl";
import { SEAT_COLORS, SEAT_LABELS } from "./three/materials";
import type { LiveAim } from "./three/Scene3D";
import { WORDS, wordTier } from "./three/fxWords";

const Loading3D = () => <div className="flex h-full items-center justify-center bg-[#1a120b] text-xs text-amber-200/60">⚫ 바둑판 펴는 중…</div>;
const Scene3D = dynamic(() => import("./three/Scene3D"), { ssr: false, loading: Loading3D });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-500 disabled:opacity-40";
const QUALITY_KEY = "alkkagi-quality";
const TOPVIEW_KEY = "alkkagi-topview";
/** Same full-power drag as the 3D scene (board units). */
const AIM_FULL_2D = 4.6;
const nowMs = () => performance.now();

interface Props {
  state: AlkkagiState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  /** This client drives bots/timeouts/next-round. */
  canDrive: boolean;
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

/** A seat's colour chip — colour plus the 홍 ring / 청 dot mark (§1). */
function SeatChip({ seat, size = 14 }: { seat: Seat; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-1 -1 2 2" aria-label={SEAT_LABELS[seat]} className="shrink-0">
      <circle r={0.92} fill={SEAT_COLORS[seat]} stroke="rgba(0,0,0,0.5)" strokeWidth={0.12} />
      {seat === 2 && <circle r={0.45} fill="none" stroke="#e7b43a" strokeWidth={0.2} />}
      {seat === 3 && <circle r={0.3} fill="#e7b43a" />}
    </svg>
  );
}

/* ── 2D 대체 화면 (WebGL 없음): 위에서 본 판 ─────────────────────────── */

/** Board → screen-view rotation so my side is at the bottom (CCW by side × 90°). */
function rot(x: number, y: number, side: number): [number, number] {
  switch (side) {
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    case 3:
      return [y, -x];
    default:
      return [x, y];
  }
}
function unrot(x: number, y: number, side: number): [number, number] {
  return rot(x, y, (4 - side) % 4);
}

function Board2D({
  state,
  player,
  side,
  canAim,
  viewerSeat,
  aim,
  onAimLocal,
  onShoot,
  onEvent,
  onBusy,
}: {
  state: AlkkagiState;
  player: ReplayPlayer;
  side: number;
  canAim: boolean;
  viewerSeat: Seat;
  aim: MutableRefObject<LiveAim | null>;
  onAimLocal: (a: LiveAim | null) => void;
  onShoot: (stoneId: number, dx: number, dy: number, power: number) => void;
  onEvent: (e: ReplayEvent) => void;
  onBusy: (busy: boolean) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ReplayView | null>(null);
  /** Collision ripples (§13), board coords + strength, aged in the frame loop. */
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; k: number; fatal: boolean; age: number }[]>([]);
  const [aimView, setAimView] = useState<LiveAim | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastAim = useRef<LiveAim | null>(null);
  const cb = useRef({ onEvent, onBusy });
  useEffect(() => {
    cb.current = { onEvent, onBusy };
  }, [onEvent, onBusy]);

  useEffect(() => {
    let id = 0;
    let busy: boolean | null = null;
    let live: { id: number; x: number; y: number; k: number; fatal: boolean; born: number }[] = [];
    let seq = 0;
    const loop = () => {
      const now = performance.now();
      const v = player.sample(state, now, (e) => {
        if (e.kind === "clack") live.push({ id: seq++, x: e.x, y: e.y, k: Math.min(1, e.impulse / 9), fatal: e.fatal, born: now });
        cb.current.onEvent(e);
      });
      live = live.filter((r) => now - r.born < 750);
      setRipples(live.map((r) => ({ id: r.id, x: r.x, y: r.y, k: r.k, fatal: r.fatal, age: (now - r.born) / 750 })));
      if (busy !== v.busy) {
        busy = v.busy;
        cb.current.onBusy(v.busy);
      }
      setView(v);
      const a = aim.current;
      setAimView(a && a.turn === state.turn && performance.now() - a.at < 1800 && !v.busy ? a : null);
      id = window.requestAnimationFrame(loop);
    };
    id = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(id);
  }, [player, state, aim]);

  const toBoard = (cx: number, cy: number): [number, number] | null => {
    const el = svg.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const vx = ((cx - r.left) / r.width) * 2 * (EDGE + 0.8) - (EDGE + 0.8);
    const vy = -(((cy - r.top) / r.height) * 2 * (EDGE + 0.8) - (EDGE + 0.8));
    return unrot(vx, vy, side);
  };

  const stones = view?.stones ?? state.stones.map((s) => ({ ...s, fade: 0 }));
  const radius = (king: boolean) => (king ? 0.62 : 0.46);
  const guide = (() => {
    if (!aimView) return null;
    const me = stones.find((s) => s.id === aimView.stoneId);
    if (!me) return null;
    const sims = toSim(stones.map((s) => ({ id: s.id, owner: s.owner, x: s.x, y: s.y, king: s.king })));
    const hit = firstContact(sims, me.id, aimView.dx, aimView.dy);
    let len = Math.min(slideDistance(speedForPower(aimView.power)), hit ? hit.t : 99);
    if (aimView.dx > 1e-6) len = Math.min(len, (EDGE - me.x) / aimView.dx);
    if (aimView.dx < -1e-6) len = Math.min(len, (-EDGE - me.x) / aimView.dx);
    if (aimView.dy > 1e-6) len = Math.min(len, (EDGE - me.y) / aimView.dy);
    if (aimView.dy < -1e-6) len = Math.min(len, (-EDGE - me.y) / aimView.dy);
    return { me, len: Math.max(0, len), hit };
  })();
  const P = (x: number, y: number) => {
    const [vx, vy] = rot(x, y, side);
    return { cx: vx, cy: -vy };
  };
  const span = EDGE + 0.8;

  return (
    <div className="flex h-full items-center justify-center bg-[#1a120b] p-2">
      <svg
        ref={svg}
        viewBox={`${-span} ${-span} ${span * 2} ${span * 2}`}
        className="aspect-square h-full max-h-full w-auto max-w-full touch-none select-none"
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = toBoard(e.clientX, e.clientY);
          if (!p) return;
          const px = d.x - p[0];
          const py = d.y - p[1];
          const dist = Math.hypot(px, py);
          if (dist < 0.05) return;
          const a: LiveAim = { turn: state.turn, stoneId: d.id, dx: px / dist, dy: py / dist, power: Math.min(1, dist / AIM_FULL_2D), at: nowMs() };
          lastAim.current = a;
          onAimLocal(a);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const a = lastAim.current;
          lastAim.current = null;
          if (a && a.stoneId === d.id && a.power >= 0.05) onShoot(d.id, a.dx, a.dy, a.power);
          else onAimLocal(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          lastAim.current = null;
          onAimLocal(null);
        }}
      >
        <rect x={-EDGE} y={-EDGE} width={EDGE * 2} height={EDGE * 2} rx={0.15} fill="#d9a85c" stroke="#6b4218" strokeWidth={0.12} />
        {Array.from({ length: 19 }, (_, i) => i - 9).map((i) => (
          <g key={i} stroke="rgba(30,16,6,0.8)" strokeWidth={0.05}>
            <line x1={i} y1={-9} x2={i} y2={9} />
            <line x1={-9} y1={i} x2={9} y2={i} />
          </g>
        ))}
        {[-6, 0, 6].flatMap((a) => [-6, 0, 6].map((b) => <circle key={`${a}:${b}`} cx={a} cy={b} r={0.14} fill="rgba(30,16,6,0.9)" />))}
        {guide && (
          <line
            {...(() => {
              const a = P(guide.me.x, guide.me.y);
              const b = P(guide.me.x + aimView!.dx * guide.len, guide.me.y + aimView!.dy * guide.len);
              return { x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy };
            })()}
            stroke="#fff6d8"
            strokeWidth={0.07}
            strokeDasharray="0.28 0.2"
          />
        )}
        {guide?.hit && guide.hit.t <= guide.len + 1e-6 && <circle {...P(guide.hit.cx, guide.hit.cy)} r={radius(guide.me.king)} fill="none" stroke="#fff6d8" strokeWidth={0.06} />}
        {ripples.map((r) => {
          const p = P(r.x, r.y);
          const e = 1 - Math.pow(1 - r.age, 3);
          const tier = wordTier(r.k, r.fatal);
          const spec = tier === null ? null : WORDS[tier];
          return (
            <g key={`rp-${r.id}`} pointerEvents="none">
              <circle {...p} r={0.2 + e * (0.7 + Math.min(r.k, 0.7) * 2 + (r.fatal ? 1.4 : 0))} fill="none" stroke={r.fatal ? "#ffd27a" : "#fff6dc"} strokeWidth={0.12 * (1 - r.age) + 0.02} opacity={1 - r.age} />
              {r.age < 0.3 && <circle {...p} r={0.25 + (r.fatal ? 0.8 : r.k * 0.4)} fill="#fffbe8" opacity={(1 - r.age / 0.3) * 0.9} />}
              {spec && (
                <text
                  x={p.cx}
                  y={p.cy - 0.8 - e * 1.2}
                  fontSize={tier === 2 ? 2.1 : tier === 1 ? 1.5 : 1.15}
                  fontWeight={900}
                  textAnchor="middle"
                  fill={spec.fill}
                  stroke="#1a0d05"
                  strokeWidth={0.22}
                  paintOrder="stroke"
                  opacity={r.age < 0.7 ? 1 : 1 - (r.age - 0.7) / 0.3}
                >
                  {tier === 1 ? `≡${spec.word}≡` : tier === 2 ? `✸${spec.word}` : spec.word}
                </text>
              )}
            </g>
          );
        })}
        {stones.map((s) => {
          const p = P(s.x, s.y);
          const r = radius(s.king) * (s.fade > 0 ? 1 - s.fade : 1);
          const mine = canAim && s.owner === viewerSeat;
          return (
            <g
              key={s.id}
              onPointerDown={(e) => {
                if (!mine) return;
                (e.target as Element).setPointerCapture?.(e.pointerId);
                drag.current = { id: s.id, x: s.x, y: s.y };
              }}
              style={{ cursor: mine ? "grab" : "default" }}
            >
              {mine && <circle {...p} r={r * 1.35} fill="none" stroke="#ffd36b" strokeWidth={0.08} opacity={0.8} />}
              <circle {...p} r={r} fill={SEAT_COLORS[s.owner]} stroke="rgba(0,0,0,0.55)" strokeWidth={0.05} />
              {s.owner === 2 && <circle {...p} r={r * 0.45} fill="none" stroke="#e7b43a" strokeWidth={0.08} />}
              {s.owner === 3 && <circle {...p} r={r * 0.25} fill="#e7b43a" />}
              {s.king && (
                <text x={p.cx} y={p.cy + 0.22} fontSize={0.62} textAnchor="middle">
                  👑
                </text>
              )}
            </g>
          );
        })}
        {aimView &&
          (() => {
            const me = stones.find((s) => s.id === aimView.stoneId);
            if (!me) return null;
            const a = P(me.x, me.y);
            const len = 0.6 + aimView.power * 3.4;
            const b = P(me.x + aimView.dx * len, me.y + aimView.dy * len);
            const col = aimView.power < 0.5 ? "#7be38f" : aimView.power < 0.8 ? "#f2c94c" : "#ef5b4c";
            return <line x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} stroke={col} strokeWidth={0.16} strokeLinecap="round" />;
          })()}
      </svg>
    </div>
  );
}

/* ── 보드 ─────────────────────────────────────────────────── */

interface Toast {
  key: number;
  text: string;
  tone: "good" | "bad" | "info";
}

export default function AlkkagiBoard({ state, viewerSeat, names, connectedSeats, botSeats, canDrive, deadlineMs, nowMs, aim, onAim, onAction, onGameEnd, onBusy }: Props) {
  const [canWebgl] = useState(webglAvailable);
  const [quality, setQuality] = useState<"high" | "low">(() => (loadFlag(QUALITY_KEY, "low") ? "low" : "high"));
  const [topView, setTopView] = useState(() => loadFlag(TOPVIEW_KEY, "1"));
  const [rules, setRules] = useState(false);
  const [player] = useState(() => new ReplayPlayer());
  const [busy, setBusy] = useState(false);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const [myAim, setMyAim] = useState<LiveAim | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSeq = useRef(0);
  const lastClack = useRef(0);
  const lastStretch = useRef({ at: 0, power: 0 });

  const side = sideOf(state, viewerSeat >= 0 ? viewerSeat : 0);
  const myTurn = state.phase === "aim" && state.activeSeat === viewerSeat;
  const canAim = myTurn && !busy && sentTurn !== state.turn;
  const startCount = stoneCountFor(state.playerCount, state.options.stones);
  // while a shot is still playing, the HUD shows the board as it was before it
  const hudStones: Stone[] = busy && state.lastShot ? state.lastShot.before : state.stones;
  const lowest = useMemo(() => {
    let m = 99;
    for (let s = 0; s < state.playerCount; s++) {
      const n = hudStones.filter((x) => x.owner === s).length;
      if (n > 0) m = Math.min(m, n);
    }
    return m;
  }, [hudStones, state.playerCount]);

  useSuiteBgm(getAlkkagiSound, state.phase !== "ended", lowest <= 2 ? 1 : 0);
  const classify = useMemo(() => alkkagiCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getAlkkagiSound, classify);

  const showToast = useCallback((text: string, tone: Toast["tone"]) => {
    toastSeq.current += 1;
    setToast({ key: toastSeq.current, text, tone });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast((t) => (t?.key === toast.key ? null : t)), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleBusy = useCallback(
    (b: boolean) => {
      setBusy(b);
      onBusy(b);
    },
    [onBusy],
  );

  const handleEvent = useCallback(
    (e: ReplayEvent) => {
      const sound = getAlkkagiSound();
      if (e.kind === "flick") sound.play("flick", e.power);
      else if (e.kind === "clack") {
        const now = performance.now();
        if (now - lastClack.current < 35) return;
        lastClack.current = now;
        sound.play("clack", e.impulse);
        if (e.fatal) sound.play("smash");
      } else if (e.kind === "fall") sound.play("fall");
      else if (e.kind === "floor") sound.play("floor", e.strength);
      else if (e.kind === "done") {
        const shot = e.shot;
        const who = shot.seat === viewerSeat ? "내" : `${names[shot.seat] ?? "상대"}님의`;
        for (const s of shot.eliminated) sound.play(s === viewerSeat ? "lose" : "out");
        if (shot.kingsDown.some((k) => k !== shot.seat)) showToast(`👑 왕 잡기! ${shot.kingsDown.map((k) => names[k] ?? "").join(", ")} 탈락`, "good");
        else if (shot.eliminated.length > 0) showToast(`💀 ${shot.eliminated.map((s) => (s === viewerSeat ? "나" : names[s])).join(", ")} 탈락!`, shot.eliminated.includes(viewerSeat) ? "bad" : "info");
        else if (shot.bonus) {
          sound.play("combo");
          showToast(`🔥 ${who} 알이 ${shot.knocked}개 떨어뜨림! 한 번 더`, "good");
        } else if (shot.knocked >= 2) showToast(`💥 한 방에 ${shot.knocked}개!`, "good");
        else if (shot.knocked === 1) showToast(`⚫ ${shot.knocked}개 떨어뜨림`, "info");
        else if (shot.shooterFell) showToast(`😵 ${who} 알이 스스로 떨어졌어요`, "bad");
        if (state.phase !== "aim" && state.lastShot?.turn === shot.turn) sound.play("round");
      }
    },
    [viewerSeat, names, showToast, state.phase, state.lastShot],
  );

  const prevAim = useRef<LiveAim | null>(null);
  const handleAim = useCallback(
    (a: LiveAim | null) => {
      const prev = prevAim.current;
      prevAim.current = a;
      if (a && (!prev || prev.stoneId !== a.stoneId)) getAlkkagiSound().play("pick");
      if (!a && prev) getAlkkagiSound().play("cancel");
      setMyAim(a);
      if (a) {
        const now = performance.now();
        if (now - lastStretch.current.at > 110 && Math.abs(a.power - lastStretch.current.power) > 0.04) {
          lastStretch.current = { at: now, power: a.power };
          getAlkkagiSound().play("stretch", a.power);
        }
      }
      onAim(a);
    },
    [onAim],
  );

  const shoot = useCallback(
    (stoneId: number, dx: number, dy: number, power: number) => {
      if (!canAim) return;
      const sp = speedForPower(power);
      const q = quantizeShot(dx * sp, dy * sp);
      setSentTurn(state.turn);
      setMyAim(null);
      prevAim.current = null;
      onAction({ type: "flick", seat: viewerSeat, stone: stoneId, vx: q.vx, vy: q.vy });
    },
    [canAim, state.turn, onAction, viewerSeat],
  );

  // auto next round (driver only), once the last shot has played out
  useEffect(() => {
    if (!canDrive || state.phase !== "roundOver" || busy) return;
    const id = window.setTimeout(() => onAction({ type: "next" }), 5500);
    return () => window.clearTimeout(id);
  }, [canDrive, state.phase, state.turn, busy, onAction]);

  const onFps = useCallback((fps: number) => {
    if (fps < 28) {
      setQuality((q) => {
        if (q === "low") return q;
        saveFlag(QUALITY_KEY, "low");
        return "low";
      });
    }
  }, []);

  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const activeName = names[state.activeSeat] ?? `${state.activeSeat + 1}번`;
  const activeIsBot = botSeats.has(state.activeSeat);
  const rec = state.history[state.history.length - 1];
  const shotsLeft = ROUND_SHOT_LIMIT - state.roundShots;
  const showRoundOver = state.phase === "roundOver" && !busy && rec;
  const passNote = state.lastPass && state.lastPass.turn === state.turn - 1 ? `${state.lastPass.seat === viewerSeat ? "내" : `${names[state.lastPass.seat] ?? ""}님의`} 차례가 시간 초과로 넘어갔어요` : null;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          {state.options.rounds > 1 ? `${state.round + 1}/${state.options.rounds}판` : "단판"} · 튕기기 {state.roundShots}번{state.options.king ? " · 👑 왕알" : ""}{state.options.bonusShots > 0 ? ` · 🔥 보너스 ${state.options.bonusShots}회` : " · 보너스 없음"}
        </span>
        {shotsLeft <= 10 && state.phase === "aim" && <span className="text-xs text-rose-300 light:text-rose-600">⏳ {shotsLeft}번 남음</span>}
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
          <SuiteSoundHud suite={getAlkkagiSound} icon="⚫" label="Pebble Dojo" preview="clack" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {/* 무대 */}
      <div className="relative h-[60vh] max-h-[680px] min-h-[320px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {canWebgl ? (
          <Scene3D
            state={state}
            player={player}
            side={side}
            canAim={canAim}
            viewerSeat={viewerSeat}
            aim={aim}
            onAim={handleAim}
            onShoot={shoot}
            onEvent={handleEvent}
            onBusy={handleBusy}
            topView={topView}
            quality={quality}
            onFps={onFps}
          />
        ) : (
          <Board2D state={state} player={player} side={side} canAim={canAim} viewerSeat={viewerSeat} aim={aim} onAimLocal={handleAim} onShoot={shoot} onEvent={handleEvent} onBusy={handleBusy} />
        )}

        {/* 차례 띠 */}
        {state.phase === "aim" && (
          <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
            <SeatChip seat={state.activeSeat} />
            {busy ? "🎬 결과 보는 중" : myTurn ? "🫵 내 차례" : `${activeIsBot ? "🤖 " : ""}${activeName}`}
            {!busy && state.chain > 0 && <span className="text-amber-300">🔥 연속 {state.chain + 1}/{maxChain(state.options)}</span>}
            {!busy && remaining !== null && <span className={`tabular-nums ${remaining <= 8 ? "text-rose-300" : "text-white/60"}`}>{remaining}s</span>}
          </div>
        )}
        {/* 세기 */}
        {myAim && canAim && (
          <div className="pointer-events-none absolute right-2 bottom-2 flex w-36 flex-col gap-1 rounded-xl bg-black/60 px-3 py-2 text-[11px] font-bold text-white">
            <span className="flex justify-between">
              세기 <span className="tabular-nums">{Math.round(myAim.power * 100)}%</span>
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-white/15">
              <div className={`h-full rounded-full ${myAim.power < 0.5 ? "bg-emerald-400" : myAim.power < 0.8 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${Math.round(myAim.power * 100)}%` }} />
            </div>
            {myAim.power < 0.05 && <span className="text-white/60">여기서 놓으면 취소</span>}
          </div>
        )}
        {toast && (
          <div key={toast.key} className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
            <span
              className={`animate-bounce rounded-full px-4 py-1.5 text-sm font-black shadow-lg ${toast.tone === "good" ? "bg-amber-500/95 text-slate-900" : toast.tone === "bad" ? "bg-rose-600/95 text-white" : "bg-black/70 text-white"}`}
            >
              {toast.text}
            </span>
          </div>
        )}
        {showRoundOver && (
          <div className="pointer-events-none absolute inset-x-0 top-1/4 flex flex-col items-center gap-1.5 text-center">
            <span className="text-5xl">{rec.places[0] === viewerSeat ? "🏆" : "⚫"}</span>
            <span className="rounded-xl bg-black/70 px-4 py-2 text-lg font-black text-white">{rec.places[0] === viewerSeat ? "이번 판 1등!" : `${names[rec.places[0]] ?? "누군가"}님이 이번 판 1등`}</span>
            <span className="flex flex-wrap justify-center gap-1.5">
              {rec.places.map((s, i) => (
                <span key={s} className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                  {rec.ranks[i]}위 <SeatChip seat={s} size={12} /> {s === viewerSeat ? "나" : names[s]} +{state.playerCount - rec.ranks[i]}
                </span>
              ))}
            </span>
            {rec.limitHit && <span className="text-xs text-white/70">{ROUND_SHOT_LIMIT}번 제한 — 남은 알 수로 순위를 정했어요</span>}
          </div>
        )}
      </div>

      {remaining !== null && state.phase === "aim" && !busy && (
        <div className="-mt-1 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full transition-[width] duration-300 ${remaining <= 8 ? "bg-rose-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, ((remaining * 1000) / AIM_TIMEOUT_MS) * 100)}%` }} />
        </div>
      )}

      {/* 안내 */}
      {state.phase === "aim" && (
        <div className={`${PANEL} text-center text-sm break-keep text-white/75 light:text-slate-600`}>
          {busy
            ? "알이 다 멈출 때까지 지켜봐요…"
            : myTurn
              ? sentTurn === state.turn
                ? "튕겼어요!"
                : "👆 빛나는 내 알을 꾹 누르고 뒤로 당겼다가 놓아요 — 화살표 쪽으로 날아가요. 빈 곳을 끌면 판을 돌려 볼 수 있어요."
              : `${activeIsBot ? "🤖 " : ""}${activeName}님이 조준하고 있어요`}
          {passNote && <p className="mt-1 text-xs text-white/45 light:text-slate-400">{passNote}</p>}
        </div>
      )}
      {state.phase === "roundOver" && (
        <div className={`${PANEL} flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600`}>
          <span>{busy ? "마지막 장면을 보는 중…" : state.round + 1 >= state.options.rounds ? "곧 최종 결과가 나와요" : "곧 새 배치로 다음 판을 시작해요"}</span>
          <button type="button" disabled={busy} onClick={() => onAction({ type: "next" })} className={PRIMARY}>
            {state.round + 1 >= state.options.rounds ? "결과 보기" : "다음 판"}
          </button>
        </div>
      )}
      {state.phase === "ended" && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      {/* 플레이어 */}
      {state.phase !== "ended" && (
        <div className={`${PANEL} grid grid-cols-1 gap-1.5 sm:grid-cols-2`}>
          {Array.from({ length: state.playerCount }, (_, s) => s).map((s) => {
            const mine = hudStones.filter((x) => x.owner === s);
            const out = mine.length === 0;
            const kingAlive = mine.some((x) => x.king);
            return (
              <div key={s} className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs ${s === state.activeSeat && state.phase === "aim" ? "bg-amber-500/15" : ""} ${out ? "opacity-50" : ""}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${connectedSeats.has(s) ? "bg-emerald-400" : "bg-white/20"}`} />
                <SeatChip seat={s} />
                <span className={`min-w-0 flex-1 truncate ${s === viewerSeat ? "font-black text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>
                  {botSeats.has(s) ? "🤖 " : ""}
                  {names[s] ?? `${s + 1}번`}
                  {s === viewerSeat ? " (나)" : ""}
                </span>
                <span className="shrink-0 tracking-tighter text-white/70 light:text-slate-500" aria-label={`남은 알 ${mine.length}개`}>
                  {out ? "💀 탈락" : `${state.options.king ? (kingAlive ? "👑" : "") : ""}${"●".repeat(Math.max(0, mine.length - (kingAlive ? 1 : 0)))}${"○".repeat(Math.max(0, startCount - mine.length))}`}
                </span>
                {state.options.rounds > 1 && <span className="shrink-0 font-bold text-amber-200 tabular-nums light:text-amber-700">{state.scores[s]}점</span>}
              </div>
            );
          })}
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: AlkkagiState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">⚫ 최종 결과</h3>
      <ol className="flex flex-col gap-1.5">
        {rankings.map((r) => (
          <li key={r.seat} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${r.seat === viewerSeat ? "bg-amber-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-8 font-black text-amber-200 light:text-amber-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
            <SeatChip seat={r.seat} />
            <span className="min-w-0 flex-1 truncate text-white/85 light:text-slate-700">{names[r.seat] ?? `${r.seat + 1}번`}</span>
            {state.options.rounds > 1 && <span className="tabular-nums text-white/70 light:text-slate-600">{state.scores[r.seat]}점</span>}
            <span className="text-xs text-amber-200/80 light:text-amber-700">🏆{state.roundWins[r.seat]}</span>
            <span className="text-xs text-white/50 light:text-slate-500">⚫{state.knocks[r.seat]}</span>
            <span className="text-xs text-white/40 light:text-slate-400">남은 {aliveCount(state, r.seat)}</span>
          </li>
        ))}
      </ol>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
