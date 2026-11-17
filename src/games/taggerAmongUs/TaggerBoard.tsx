"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { EXPOSE_MS, GAUGE_MIN_ON, GRACE_MS, HEART_R, KICK_MS, KID_HEAR_MUL, MAX_FREEZES, SEAT_COLORS, SEAT_SYMBOLS, THAW_MS, timeLimitMs, timeText, type MoveMode } from "./data";
import { createLocal, reportOf, startLunge, syncLocal, type LocalBody } from "./localBody";
import { CELL, COLS, DOORS, EXITS, KIND, ROOM, ROOM_NAMES, ROWS, SPOTS, colOf, idx, roomNameAt, rowOf } from "./map";
import type { SnapBuffer, Snap } from "./net";
import { noiseRadiusOf, type GameEvent, type PlayerAct, type PosReport } from "./sim";
import RulebookModal from "./RulebookModal";
import { getTaggerAmongUsSound } from "./taggerSound";
import type { SceneShared } from "./three/SchoolScene";

/** 내 몸(ref 안의 값)을 꺼낸다 — 이벤트·타이머 안에서만 부른다 */
const bodyOf = (sh: MutableRefObject<SceneShared>): LocalBody => sh.current.local;

const SchoolScene = dynamic(() => import("./three/SchoolScene"), { ssr: false, loading: () => null });

/**
 * 술래는 우리 중에 게임 화면 (룰북 §8~§9): 1인칭 3D 무대 + HUD(역할·봉인·체력·소금·탈 기운) +
 * 조작(키보드·마우스 / 터치) + 배너·알림 + 지도 + 결과. 소리로 전하는 신호는 모두 글자·색으로도 나온다.
 * 변장 중인 술래는 화면 어디에도 표시하지 않는다 (본인 화면 빼고).
 */

export interface TaggerBoardProps {
  snap: Snap;
  buf: SnapBuffer;
  fresh: { events: GameEvent[]; seq: number };
  mySeat: number;
  names: Record<number, string>;
  onReport: (rep: PosReport) => void;
  onAct: (act: PlayerAct) => void;
  ended: boolean;
  isHost: boolean;
  onRestart?: () => void;
  onLeave: () => void;
  practice?: boolean;
  notice?: string | null;
}

type Quality = "auto" | "high" | "low";
interface View {
  quality: Quality;
  sens: number;
  calm: boolean;
}
const VIEW_KEY = "tagger-among-us:view";
const TIPS_KEY = "tagger-among-us:tips";

function loadView(): View {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "{}");
    return { quality: v.quality === "high" || v.quality === "low" ? v.quality : "auto", sens: typeof v.sens === "number" ? Math.max(0.3, Math.min(2.5, v.sens)) : 1, calm: !!v.calm };
  } catch {
    return { quality: "auto", sens: 1, calm: false };
  }
}

function saveView(v: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* 저장 안 돼도 됨 */
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

function grainUrl(): string {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) return "";
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 38;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

interface Hud {
  stamina: number;
  mv: MoveMode;
  cr: boolean;
  light: boolean;
  target: { id: string; kind: string; n: number } | null;
  using: boolean;
  useK: number;
  /** 가면 쓴 술래가 얼마나 가까운가 0~3 (도망자) */
  near: number;
  room: string;
  x: number;
  z: number;
  yaw: number;
}

const HUD0: Hud = { stamina: 100, mv: 0, cr: false, light: true, target: null, using: false, useK: 0, near: 0, room: "", x: 0, z: 0, yaw: 0 };

interface Toast {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

/* ── 작은 부품 ──────────────────────────────────────────────────────── */

function Meter({ icon, label, value, color, warn }: { icon: string; label: string; value: number; color: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span aria-hidden className={`w-5 text-center text-sm ${warn ? "animate-pulse" : ""}`}>
        {icon}
      </span>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10 sm:w-28" role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
      <span className="w-7 text-[10px] tabular-nums text-white/60">{Math.round(value)}</span>
    </div>
  );
}

function ToolBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        getTaggerAmongUsSound().play("ui");
        onClick();
      }}
      className="min-h-8 rounded-full border border-white/15 px-2.5 py-1 text-white/70 hover:border-white/35 light:border-slate-300 light:text-slate-600"
    >
      {label}
    </button>
  );
}

function Joystick({ onMove }: { onMove: (v: { x: number; z: number } | null) => void }) {
  const base = useRef<{ x: number; y: number; id: number } | null>(null);
  const [knob, setKnob] = useState<{ bx: number; by: number; dx: number; dy: number } | null>(null);
  const R = 52;
  return (
    <div
      className="absolute bottom-0 left-0 z-20 h-[52%] w-[45%] touch-none select-none"
      onPointerDown={(e) => {
        if (base.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        base.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
        setKnob({ bx: e.clientX - r.left, by: e.clientY - r.top, dx: 0, dy: 0 });
      }}
      onPointerMove={(e) => {
        const b = base.current;
        if (!b || b.id !== e.pointerId) return;
        let dx = e.clientX - b.x;
        let dy = e.clientY - b.y;
        const l = Math.hypot(dx, dy);
        if (l > R) {
          dx = (dx / l) * R;
          dy = (dy / l) * R;
        }
        setKnob((k) => (k ? { ...k, dx, dy } : k));
        onMove(l < 6 ? { x: 0, z: 0 } : { x: dx / R, z: -dy / R });
      }}
      onPointerUp={(e) => {
        if (base.current?.id !== e.pointerId) return;
        base.current = null;
        setKnob(null);
        onMove(null);
      }}
      onPointerCancel={() => {
        base.current = null;
        setKnob(null);
        onMove(null);
      }}
    >
      {knob ? (
        <div className="pointer-events-none absolute" style={{ left: knob.bx - R, top: knob.by - R, width: R * 2, height: R * 2 }}>
          <div className="absolute inset-0 rounded-full border-2 border-white/30 bg-black/30" />
          <div className="absolute h-14 w-14 rounded-full border-2 border-white/70 bg-white/30" style={{ left: R - 28 + knob.dx, top: R - 28 + knob.dy }} />
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-6 left-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/25 text-center text-[11px] font-semibold text-white/50">
          끌어서 이동
          <br />
          (끝까지 = 달리기)
        </div>
      )}
    </div>
  );
}

function TouchBtn({ label, sub, active, onDown, onUp, big, ariaLabel }: { label: ReactNode; sub?: string; active?: boolean; onDown: () => void; onUp?: () => void; big?: boolean; ariaLabel: string }) {
  const size = big ? 72 : 56;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex touch-none flex-col items-center justify-center rounded-full border-2 font-bold text-white select-none ${active ? "border-amber-300 bg-amber-400/40" : "border-white/40 bg-black/45"}`}
      style={{ width: size, height: size }}
    >
      <span className={big ? "text-2xl leading-none" : "text-xl leading-none"}>{label}</span>
      {sub && <span className="mt-0.5 text-[9px] leading-none text-white/75">{sub}</span>}
    </button>
  );
}

/** 학교 안내도 — 내 위치, 깨어난 장승, 얼어붙은 친구, 교문만 나온다 (다른 사람 위치는 안 나온다) */
function SchoolMap({ snap, hud, onClose }: { snap: Snap; hud: Hud; onClose: () => void }) {
  const cells = useMemo(() => {
    const out: { c: number; r: number; fill: string }[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = KIND[idx(c, r)];
        if (k === 0) continue;
        const room = ROOM[idx(c, r)];
        out.push({ c, r, fill: k === 3 ? "#1f6d3d" : k === 2 ? "#6b5a3a" : room === "." ? "#262b3a" : room === "g" ? "#3d3324" : room === "s" || room === "c" ? "#27413a" : "#323a4c" });
      }
    return out;
  }, []);
  const labels = useMemo(() => {
    const acc: Record<string, { x: number; y: number; n: number }> = {};
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const room = ROOM[idx(c, r)];
        if (room === "#" || room === "." || room === "+" || room === "X") continue;
        const a = (acc[room] ??= { x: 0, y: 0, n: 0 });
        a.x += c + 0.5;
        a.y += r + 0.5;
        a.n++;
      }
    return Object.entries(acc).map(([room, a]) => ({ room, x: a.x / a.n, y: a.y / a.n }));
  }, []);
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/85 p-3" onClick={onClose}>
      <p className="text-sm font-bold text-sky-100">🗺️ 달빛초등학교 1층 안내도</p>
      <svg viewBox={`0 0 ${COLS} ${ROWS}`} className="max-h-[78%] w-full max-w-3xl rounded-lg border border-white/15 bg-[#0b0d14]" role="img" aria-label="학교 지도">
        {cells.map((c) => (
          <rect key={`${c.c}-${c.r}`} x={c.c} y={c.r} width={1.02} height={1.02} fill={c.fill} />
        ))}
        {DOORS.map((d) => (
          <rect key={d.i} x={colOf(d.cell) + (d.ns ? 0.1 : 0.4)} y={rowOf(d.cell) + (d.ns ? 0.4 : 0.1)} width={d.ns ? 0.8 : 0.2} height={d.ns ? 0.2 : 0.8} fill={snap.doors[d.i] ? "#3a3f46" : "#d6b46a"} />
        ))}
        {labels.map((l) => (
          <text key={l.room} x={l.x} y={l.y + 0.9} fontSize={0.6} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#c8d3df" opacity={0.7}>
            {ROOM_NAMES[l.room]}
          </text>
        ))}
        {snap.spots.map((sp, k) => {
          const d = SPOTS[sp.i];
          const cx = colOf(d.cell) + 0.5;
          const cy = rowOf(d.cell) + 0.5;
          return (
            <g key={k}>
              <circle cx={cx} cy={cy} r={0.46} fill={sp.done ? "#f5c451" : "#3a1512"} stroke={sp.done ? "#fff3c4" : "#ff5a36"} strokeWidth={0.09} />
              {!sp.done && sp.p > 0 && <circle cx={cx} cy={cy} r={0.46} fill="none" stroke="#f5c451" strokeWidth={0.16} strokeDasharray={`${sp.p * 2.89} 2.89`} transform={`rotate(-90 ${cx} ${cy})`} />}
              <text x={cx} y={cy + 0.03} fontSize={0.5} textAnchor="middle" dominantBaseline="central" fill={sp.done ? "#3a2a05" : "#ffd9c9"} fontWeight={800}>
                {sp.done ? "封" : "✕"}
              </text>
            </g>
          );
        })}
        {EXITS.map((e) => (
          <text key={e.i} x={e.x / CELL} y={e.z / CELL + (e.dir > 0 ? 0.75 : -0.75)} fontSize={0.8} textAnchor="middle" dominantBaseline="central">
            🚪
          </text>
        ))}
        {snap.players.map((p) =>
          p.st === "frozen" ? (
            <g key={p.seat}>
              <rect x={p.x / CELL - 0.36} y={p.z / CELL - 0.36} width={0.72} height={0.72} rx={0.12} fill="#9fd8ff" stroke="#fff" strokeWidth={0.07} />
              <text x={p.x / CELL} y={p.z / CELL + 0.03} fontSize={0.45} textAnchor="middle" dominantBaseline="central" fill="#062033" fontWeight={800}>
                {SEAT_SYMBOLS[p.seat % 5]}
              </text>
            </g>
          ) : null,
        )}
        <g transform={`translate(${hud.x / CELL} ${hud.z / CELL}) rotate(${(-hud.yaw * 180) / Math.PI})`}>
          <path d="M0,-0.62 L0.42,0.45 L0,0.2 L-0.42,0.45 Z" fill="#fff" stroke="#000" strokeWidth={0.07} />
        </g>
      </svg>
      <p className="text-center text-[11px] text-white/60">
        ▲ 나 · ✕ 깨어난 장승(봉인할 곳, 노란 테두리 = 진행도) · 封 봉인 끝 · 하늘색 네모 = 얼어붙은 친구 · 노란 문 = 닫힘 · 🚪 교문
        <br />
        다른 사람의 위치는 지도에 나오지 않는다 — 아무 곳이나 누르면 닫혀요 (M)
      </p>
    </div>
  );
}

/* ── 본체 ───────────────────────────────────────────────────────────── */

export default function TaggerBoard({ snap, buf, fresh, mySeat, names, onReport, onAct, ended, isHost, onRestart, onLeave, practice, notice }: TaggerBoardProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const shared = useRef<SceneShared>(null as unknown as SceneShared);
  if (shared.current === null) shared.current = { buf, local: createLocal(), mySeat, calm: false };
  const [view, setView] = useState<View>({ quality: "auto", sens: 1, calm: false });
  const viewRef = useRef(view);
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [locked, setLocked] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hud, setHud] = useState<Hud>(HUD0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<{ text: string; sub?: string; tone: "warn" | "danger" | "good"; until: number } | null>(null);
  const [flash, setFlash] = useState<{ tone: "red" | "ice" | "white"; id: number } | null>(null);
  const [grain, setGrain] = useState("");
  const [tipsSeen, setTipsSeen] = useState(true);
  const toastId = useRef(0);
  const sound = getTaggerAmongUsSound;
  const audio = useAudioSettingsStore();
  const sfxMuted = isSfxEffectivelyMuted(audio);

  const snapRef = useRef(snap);
  const namesRef = useRef(names);
  const reportRef = useRef(onReport);
  const actRef = useRef(onAct);
  useEffect(() => {
    snapRef.current = snap;
    namesRef.current = names;
    reportRef.current = onReport;
    actRef.current = onAct;
    shared.current.buf = buf;
    shared.current.mySeat = mySeat;
    shared.current.calm = view.calm;
    viewRef.current = view;
  }, [snap, names, onReport, onAct, buf, mySeat, view]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setView(loadView());
    setCanGl(webglOk());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    setGrain(grainUrl());
    try {
      setTipsSeen(window.localStorage.getItem(TIPS_KEY) === "1");
    } catch {
      setTipsSeen(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const me = snap.players[mySeat];
  const playing = snap.phase === "play" && !ended;
  const alive = me?.st === "alive";
  const iAmTagger = me?.role === "tagger";
  const tg = snap.tg;
  const masked = iAmTagger && tg.form !== "kid";
  const overlayOpen = mapOpen || rulesOpen || settingsOpen;

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const showBanner = useCallback((text: string, tone: "warn" | "danger" | "good", sub?: string, ms = 3200) => {
    setBanner({ text, sub, tone, until: performance.now() + ms });
    window.setTimeout(() => setBanner((b) => (b && b.until <= performance.now() + 30 ? null : b)), ms + 40);
  }, []);

  /* ── 발소리 ── */
  useEffect(() => {
    bodyOf(shared).onStep = (mode) => {
      const s = snapRef.current;
      const p = s.players[mySeat];
      if (p?.role === "tagger" && s.tg.form === "mask") sound().play("stepMask");
      else sound().play("step", mode);
    };
    return () => {
      bodyOf(shared).onStep = null;
    };
  }, [sound, mySeat]);

  /* ── 행동 ── */
  const doSalt = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (!p || p.st !== "alive" || p.role !== "runner") return;
    if (p.salt <= 0) {
      sound().play("denied");
      return;
    }
    actRef.current({ k: "salt", yaw: bodyOf(shared).yaw });
  }, [mySeat, sound]);
  const toggleMask = useCallback(() => {
    const s = snapRef.current;
    const p = s.players[mySeat];
    if (!p || p.role !== "tagger" || s.phase !== "play") return;
    if (s.tg.form === "mask") actRef.current({ k: "mask", on: false });
    else if (s.tg.form === "kid") {
      if (s.t < GRACE_MS || s.tg.gauge < GAUGE_MIN_ON || s.t < s.tg.stunUntil) {
        sound().play("denied");
        return;
      }
      actRef.current({ k: "mask", on: true });
    }
  }, [mySeat, sound]);
  const doHit = useCallback(() => {
    const s = snapRef.current;
    const p = s.players[mySeat];
    if (!p || p.role !== "tagger" || s.tg.form !== "mask") return;
    if (s.t < s.tg.recoverUntil || s.t < s.tg.swingUntil || s.t < s.tg.stunUntil) {
      sound().play("denied");
      return;
    }
    startLunge(bodyOf(shared), performance.now());
    actRef.current({ k: "hit" });
  }, [mySeat, sound]);
  /** 왼쪽 클릭 · Q: 도망자는 소금, 가면 쓴 술래는 덮치기 */
  const primary = useCallback(() => {
    const s = snapRef.current;
    const p = s.players[mySeat];
    if (!p || p.st !== "alive") return;
    if (p.role === "runner") doSalt();
    else if (s.tg.form === "mask") doHit();
  }, [mySeat, doSalt, doHit]);
  const toggleLight = useCallback(() => {
    const s = snapRef.current;
    const p = s.players[mySeat];
    if (!p || p.st !== "alive" || (p.role === "tagger" && s.tg.form !== "kid")) return;
    bodyOf(shared).light = !bodyOf(shared).light;
    sound().play(bodyOf(shared).light ? "lightOn" : "lightOff");
  }, [mySeat, sound]);
  const toggleCrouch = useCallback(() => {
    bodyOf(shared).cr = !bodyOf(shared).cr;
  }, []);
  const pressUse = useCallback(() => {
    const t = bodyOf(shared).target;
    if (t && t.kind === "door") {
      actRef.current({ k: "door", i: t.n });
      return;
    }
    bodyOf(shared).wantUse = true;
  }, []);
  const releaseUse = useCallback(() => {
    bodyOf(shared).wantUse = false;
  }, []);
  const cycleSpectate = useCallback(() => {
    const s = snapRef.current;
    const list = s.players.filter((p) => p.role === "runner" && p.st === "alive" && p.seat !== mySeat).map((p) => p.seat);
    if (!list.length) return;
    bodyOf(shared).spectate = list[(list.indexOf(bodyOf(shared).spectate) + 1) % list.length];
  }, [mySeat]);

  /* ── 키보드 · 마우스 ── */
  useEffect(() => {
    const held = new Set<string>();
    const sync = () => {
      let mx = 0;
      let mz = 0;
      if (held.has("KeyA") || held.has("ArrowLeft")) mx -= 1;
      if (held.has("KeyD") || held.has("ArrowRight")) mx += 1;
      if (held.has("KeyW") || held.has("ArrowUp")) mz += 1;
      if (held.has("KeyS") || held.has("ArrowDown")) mz -= 1;
      bodyOf(shared).mx = mx;
      bodyOf(shared).mz = mz;
      bodyOf(shared).wantRun = held.has("ShiftLeft") || held.has("ShiftRight");
    };
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      held.add(e.code);
      sync();
      if (e.code === "KeyC" || e.code === "ControlLeft") toggleCrouch();
      else if (e.code === "KeyF") toggleLight();
      else if (e.code === "KeyE") pressUse();
      else if (e.code === "KeyQ") primary();
      else if (e.code === "Space" || e.code === "KeyR") toggleMask();
      else if (e.code === "KeyM" || e.code === "Tab") setMapOpen((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      held.delete(e.code);
      sync();
      if (e.code === "KeyE") releaseUse();
    };
    const blur = () => {
      held.clear();
      sync();
      bodyOf(shared).wantUse = false;
    };
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement !== stageRef.current) return;
      const k = 0.0023 * viewRef.current.sens;
      bodyOf(shared).yaw -= e.movementX * k;
      bodyOf(shared).pitch = Math.max(-1.35, Math.min(1.35, bodyOf(shared).pitch - e.movementY * k));
    };
    const lock = () => setLocked(document.pointerLockElement === stageRef.current);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("mousemove", move);
    document.addEventListener("pointerlockchange", lock);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("pointerlockchange", lock);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [toggleCrouch, toggleLight, pressUse, releaseUse, primary, toggleMask]);

  // 창(지도·룰북·설정·결과)이 뜨면 마우스를 풀어 준다
  useEffect(() => {
    if ((overlayOpen || !playing) && document.pointerLockElement) document.exitPointerLock();
  }, [overlayOpen, playing]);

  /* ── 0.1초마다: 방장에게 보고 + HUD + 심장 ── */
  useEffect(() => {
    let useId: string | null = null;
    let useStart = 0;
    let loopAt = 0;
    let beatAt = 0;
    const id = window.setInterval(() => {
      const s = snapRef.current;
      const p = s.players[mySeat];
      if (!p) return;
      const now = performance.now();
      const b = bodyOf(shared);
      // 새 판이면 먼저 시작 자리로 맞춘 뒤에 보고한다 (안 그러면 (0,0)을 보고해 구석으로 끌려간다)
      syncLocal(b, s, mySeat);
      if (s.phase === "play") reportRef.current(reportOf(b));
      if (b.use !== useId) {
        useId = b.use;
        useStart = now;
        loopAt = 0;
      }
      if (useId && now >= loopAt && (useId[0] === "s" || useId[0] === "t")) {
        loopAt = now + 620;
        sound().play(useId[0] === "s" ? "sealing" : "thawing");
      }
      // 진행 막대: 봉인은 실제 진행도(여럿이 하면 빨라진다), 훼손·땡은 누른 시간
      let useK = 0;
      if (useId?.[0] === "s") useK = s.spots[Number(useId.slice(1))]?.p ?? 0;
      else if (useId?.[0] === "k") useK = Math.min(1, (now - useStart) / KICK_MS);
      else if (useId?.[0] === "t") useK = Math.min(1, (now - useStart) / THAW_MS);
      // 심장: 가면 쓴 술래가 가까울수록 빨리 뛴다 (변장 중에는 안 뛴다 — 정체를 흘리지 않는다)
      let near = 0;
      if (p.role === "runner" && p.st === "alive" && s.tg.form !== "kid" && s.phase === "play") {
        const pose = shared.current.buf.body(s.tg.seat, now) ?? s.players[s.tg.seat];
        const d = Math.hypot(pose.x - b.x, pose.z - b.z);
        near = d < HEART_R * 0.35 ? 3 : d < HEART_R * 0.65 ? 2 : d < HEART_R ? 1 : 0;
        if (near > 0 && now >= beatAt) {
          beatAt = now + (near === 3 ? 430 : near === 2 ? 640 : 900);
          sound().play("beat", near / 3);
        }
      }
      const tgt = b.target;
      setHud({
        stamina: b.stamina,
        mv: b.mv,
        cr: b.cr,
        light: b.light,
        target: tgt ? { id: tgt.id, kind: tgt.kind, n: tgt.n } : null,
        using: useId !== null,
        useK,
        near,
        room: roomNameAt(b.x, b.z),
        x: b.x,
        z: b.z,
        yaw: b.yaw,
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [mySeat, sound]);

  /* ── 이벤트 → 소리 · 알림 ── */
  const lastSeq = useRef(0);
  useEffect(() => {
    if (fresh.seq === lastSeq.current) return;
    lastSeq.current = fresh.seq;
    const s = snapRef.current;
    const mine = (seat?: number) => seat === mySeat;
    const amTagger = s.players[mySeat]?.role === "tagger";
    const nm = (seat?: number) => (seat === mySeat ? "나" : (namesRef.current[seat ?? -1] ?? "누군가"));
    const volAt = (x?: number, z?: number, reach = 26) => (x === undefined || z === undefined ? 0.5 : Math.max(0.05, 1 - Math.hypot(x - bodyOf(shared).x, z - bodyOf(shared).z) / reach));
    for (const e of fresh.events) {
      switch (e.k) {
        case "door":
          sound().play("door", mine(e.seat) ? 1 : volAt(e.x, e.z, 20));
          break;
        case "bash":
          sound().play("bash", volAt(e.x, e.z, 30));
          break;
        case "slam":
          sound().play("slam", volAt(e.x, e.z, 32));
          break;
        case "sealDone":
          sound().play("sealDone", e.n ?? 1);
          showBanner(`🧧 봉인 ${e.n}/${s.need}`, amTagger ? "danger" : "good", (e.n ?? 0) >= s.need ? "마지막 봉인이 끝났다" : amTagger ? "아이들이 장승을 하나 더 봉인했다" : "봉인한 사람은 🧂 소금을 한 줌 얻는다", 2800);
          break;
        case "kick":
          sound().play("kick", volAt(e.x, e.z, 30));
          if (!amTagger) toast("👣 술래가 봉인을 걷어찼다 — 진행도가 깎였다", "bad");
          break;
        case "freeze":
          if (mine(e.seat)) {
            sound().play("freezeMe");
            bodyOf(shared).shake = 1;
            setFlash({ tone: "ice", id: e.id });
          } else {
            sound().play("freeze", volAt(e.x, e.z, 34));
            toast(amTagger ? `❄ ${nm(e.seat)}을(를) 얼렸다 (${e.n}/${MAX_FREEZES})` : `❄ ${nm(e.seat)}이(가) 얼었다 — 다가가서 땡! 해 주세요`, amTagger ? "good" : "bad");
          }
          break;
        case "thaw":
          sound().play("thaw");
          toast(mine(e.seat) ? `땡! ${nm(e.n)}이(가) 나를 녹여 줬다` : `땡! ${nm(e.n)}이(가) ${nm(e.seat)}을(를) 녹였다`, amTagger ? "bad" : "good");
          break;
        case "out":
          sound().play("out");
          toast(mine(e.seat) ? "끌려갔다… 남은 친구를 지켜보자" : `🕯️ ${nm(e.seat)}이(가) 끌려갔다`, amTagger ? "good" : "bad");
          break;
        case "escape":
          sound().play("escape");
          toast(mine(e.seat) ? "🚪 교문을 빠져나왔다!" : `🚪 ${nm(e.seat)} 탈출!`, amTagger ? "bad" : "good");
          break;
        case "maskOn":
          sound().play("maskOn", amTagger ? 0.6 : volAt(e.x, e.z, 34));
          if (!amTagger) toast("…어디선가 탈을 쓰는 소리가 난다", "bad");
          break;
        case "masked":
          sound().play("masked", amTagger ? 0.5 : volAt(e.x, e.z, 40));
          showBanner(amTagger ? "👹 탈을 썼다" : "👹 술래가 탈을 썼다!", "danger", amTagger ? "왼쪽 클릭으로 덮쳐서 얼려라 — 탈 기운이 다하면 벗겨진다" : "지금 안 보이는 아이가 누구지? 심장 소리가 빨라지면 달아나라", 3000);
          break;
        case "maskOff":
          sound().play("maskOff", amTagger ? 0.6 : volAt(e.x, e.z, 30));
          toast(amTagger ? "탈을 벗었다 — 다시 아이인 척하자" : "탈이 벗겨졌다 — 술래는 다시 아이들 틈에 섞였다");
          break;
        case "swing":
          sound().play("swing", amTagger ? 0.8 : volAt(e.x, e.z, 16));
          break;
        case "salt":
          sound().play("salt", mine(e.seat) ? 1 : volAt(e.x, e.z, 18));
          break;
        case "saltHit":
          sound().play("saltHit", amTagger ? 1 : volAt(e.x, e.z, 34));
          if (amTagger) {
            bodyOf(shared).shake = 0.9;
            setFlash({ tone: "white", id: e.id });
            showBanner("🧂 소금에 맞았다!", "danger", e.n === 1 ? "잠깐 꼼짝 못 한다" : `변장이 들통났다 — ${EXPOSE_MS / 1000}초 동안 모두가 나를 알아본다`, 3000);
          } else if (e.n === 1) toast(`🧂 ${nm(e.seat)}의 소금에 술래가 멈췄다 — 지금 달아나라!`, "good");
          else showBanner(`🧂 ${namesRef.current[s.tg.seat] ?? "누군가"}이(가) 술래다!`, "good", `${nm(e.seat)}의 소금에 변장이 벗겨졌다 — ${EXPOSE_MS / 1000}초 동안 머리 위에 붉은 표시`, 4200);
          break;
        case "saltFriend":
          sound().play("saltFriend");
          if (e.n === mySeat) toast(`🧂 앗, ${nm(e.seat)}의 소금이 눈에! 잠깐 느려진다`, "bad");
          else if (mine(e.seat)) toast(`🧂 ${nm(e.n)}은(는) 술래가 아니었다…`, "bad");
          break;
        case "gateWarn":
          sound().play("gateWarn");
          showBanner("⛓️ 빗장이 풀리고 있다", amTagger ? "danger" : "good", amTagger ? "곧 교문이 열린다 — 교문 앞을 지켜라" : "잠시 뒤 교문 두 곳(급식실 뒷문 · 중앙 현관 정문)이 열린다", 4200);
          break;
        case "gatesOpen":
          sound().play("gatesOpen");
          showBanner("🚪 교문이 열렸다!", amTagger ? "danger" : "good", amTagger ? "나가는 아이를 막아라" : "북쪽 급식실 뒷문 또는 남쪽 중앙 현관 정문으로 달려라", 5000);
          break;
        case "lastMinute":
          sound().play("lastMinute");
          showBanner("⏰ 첫닭이 울기까지 1분", "danger", amTagger ? "버티면 이긴다" : "그때까지 못 나가면 모두 끌려간다", 3500);
          break;
        case "over": {
          const rank = s.ranks?.[mySeat];
          sound().play(e.n === 2 ? "draw" : rank === 1 ? "victory" : "defeat");
          break;
        }
      }
    }
  }, [fresh, mySeat, sound, toast, showBanner]);

  /* ── BGM ── */
  const intensity = !playing ? 0 : iAmTagger ? (tg.form === "mask" ? 2 : 0) : hud.near >= 2 ? 2 : hud.near === 1 ? 1 : 0;
  useSuiteBgm(sound, playing, intensity);

  /* ── 전체화면 ── */
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
    else if (full) setFull(false);
    else if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) void el.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  }, [full]);

  const quality: "high" | "low" = view.quality === "auto" ? (touch || lowFps ? "low" : "high") : view.quality;
  const updateView = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    setView(next);
    saveView(next);
  };

  if (!me) return null;

  const timeLeft = Math.max(0, timeLimitMs(snap.options) - snap.t);
  const stunned = iAmTagger && snap.t < tg.stunUntil;
  const exposed = snap.t < tg.exposedUntil;
  const recovering = iAmTagger && tg.form === "mask" && snap.t < tg.recoverUntil;
  const graceLeft = Math.max(0, GRACE_MS - snap.t);
  const noise = alive && !iAmTagger ? noiseRadiusOf({ mv: hud.mv, use: hud.using ? (hud.target?.id ?? null) : null, st: me.st }) : 0;
  const noiseLv = noise <= 0 ? 0 : noise <= 6 ? 1 : noise <= 8 ? 2 : 3;
  const runnersLeft = snap.players.filter((p) => p.role === "runner" && p.st === "alive").length;
  const frozenCount = snap.players.filter((p) => p.st === "frozen").length;

  const objective = iAmTagger
    ? snap.gate === "open"
      ? "🚪 교문이 열렸다 — 나가려는 아이를 얼려라"
      : tg.form === "kid"
        ? graceLeft > 0
          ? `🎭 아이인 척 섞여 있어라 — ${Math.ceil(graceLeft / 1000)}초 뒤부터 탈을 쓸 수 있다`
          : "🎭 아이인 척 다가가서, 가까워지면 탈을 써라 (벽 너머 노란 파문 = 발소리)"
        : "👹 덮쳐서 얼려라 — 세 번 얼리면 끌려간다. 진행 중인 장승은 걷어차라"
    : snap.gate === "open"
      ? "🚪 교문이 열렸다 — 급식실 뒷문(북) 또는 중앙 현관 정문(남)으로!"
      : snap.gate === "opening"
        ? "⛓️ 빗장이 풀리는 중 — 교문 근처에서 기다려라"
        : `🧧 눈이 붉은 장승을 봉인하라 (${snap.sealed}/${snap.need})${frozenCount > 0 ? " · ❄ 얼어붙은 친구를 땡! 해 줘라" : ""}`;
  const prompt =
    !alive || !hud.target
      ? null
      : hud.target.kind === "seal"
        ? iAmTagger
          ? "봉인하는 척하기 (누르고 있기 — 진행도는 안 오른다)"
          : "장승 봉인하기 (누르고 있기 — 여럿이면 더 빠르다)"
        : hud.target.kind === "kick"
          ? "봉인 걷어차기 (누르고 있기)"
          : hud.target.kind === "thaw"
            ? `${names[hud.target.n] ?? "친구"} 녹이기 — 땡! (누르고 있기)`
            : masked
              ? "문 부수기"
              : `문 ${snap.doors[hud.target.n] ? "닫기" : "열기"}`;
  const showTips = !tipsSeen && playing && snap.t < 45_000;
  const tip = iAmTagger
    ? snap.t < 15_000
      ? "당신이 술래다. 지금은 다른 아이와 똑같이 보인다 — 봉인하는 척 섞여 있어라"
      : snap.t < 30_000
        ? (touch ? "👹 버튼" : "Space") + "로 탈을 쓰면 빨라지고 밤눈이 켜진다. 탈 기운이 다하면 벗겨지니 가까이 가서 써라"
        : "🧂 소금을 맞으면 멈춘다. 변장 중에 맞으면 정체가 30초 동안 드러난다"
    : snap.t < 12_000
      ? "이 중 한 명이 술래다. 눈이 붉은 장승을 찾아 봉인하면 교문이 열린다"
      : snap.t < 24_000
        ? "심장 소리가 빨라지면 탈 쓴 술래가 가깝다. 달리면 발소리가 벽 너머로 들킨다 — " + (touch ? "⬇" : "C") + " 앉으면 소리가 안 난다"
        : (touch ? "🧂 버튼" : "왼쪽 클릭") + "으로 소금을 뿌리면 술래가 멈춘다. 수상한 아이에게 뿌리면 변장도 벗겨진다 (친구가 맞으면 느려진다)";
  const needPointer = !touch && playing && !locked && !overlayOpen && me.st !== "out" && me.st !== "escaped";
  const introLeft = playing ? 6000 - snap.t : 0;

  const o = snap.outcome;
  const myRank = snap.ranks?.[mySeat];

  return (
    <div className="flex flex-col gap-2">
      <style>{`@keyframes tau-grain{0%{background-position:0 0}25%{background-position:-37px 21px}50%{background-position:19px -43px}75%{background-position:-11px 53px}100%{background-position:0 0}}@keyframes tau-flash{0%{opacity:.95}100%{opacity:0}}@keyframes tau-pulse{0%,100%{opacity:.55}50%{opacity:1}}`}</style>

      {/* 위쪽 도구 줄 */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded-full border px-2.5 py-1 font-bold ${iAmTagger ? "border-rose-400/60 bg-rose-500/15 text-rose-100 light:text-rose-700" : "border-sky-400/50 bg-sky-500/10 text-sky-100 light:text-sky-700"}`}>{iAmTagger ? "👹 나는 술래" : "🏃 나는 도망자"}</span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-semibold text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
          🧧 {snap.sealed}/{snap.need} · 🏃 {runnersLeft}명{frozenCount > 0 ? ` · ❄ ${frozenCount}` : ""}
        </span>
        <span className={`rounded-full border px-2.5 py-1 font-semibold tabular-nums ${timeLeft < 60_000 ? "border-rose-400/60 bg-rose-500/15 text-rose-200" : "border-white/10 bg-white/[0.04] text-white/80 light:border-slate-200 light:bg-white light:text-slate-700"}`} title="첫닭이 울 때까지 남은 시간">
          🐓 {timeText(timeLeft)}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <ToolBtn label="🗺️ 지도" onClick={() => setMapOpen((v) => !v)} />
          <ToolBtn label="📖 룰북" onClick={() => setRulesOpen(true)} />
          <ToolBtn label="⚙️ 설정" onClick={() => setSettingsOpen((v) => !v)} />
          <ToolBtn label={full ? "🗗 창 모드" : "⛶ 전체화면"} onClick={toggleFull} />
        </div>
      </div>

      {settingsOpen && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          <span className="flex items-center gap-1.5">
            화질
            {(["auto", "high", "low"] as Quality[]).map((q) => (
              <button key={q} type="button" onClick={() => updateView({ quality: q })} className={`rounded-full border px-2 py-0.5 ${view.quality === q ? "border-sky-400/70 bg-sky-400/15 text-sky-100 light:text-sky-700" : "border-white/15 light:border-slate-300"}`}>
                {q === "auto" ? "자동" : q === "high" ? "높음(그림자)" : "낮음(빠름)"}
              </button>
            ))}
          </span>
          <label className="flex items-center gap-1.5">
            시선 감도
            <input type="range" min={0.3} max={2.5} step={0.1} value={view.sens} onChange={(e) => updateView({ sens: Number(e.target.value) })} />
            <span className="w-6 tabular-nums">{view.sens.toFixed(1)}</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={view.calm} onChange={(e) => updateView({ calm: e.target.checked })} />
            놀람 연출 줄이기 (화면 흔들림·번쩍임 약하게)
          </label>
          {!canGl && <span className="text-amber-300">이 기기는 3D(WebGL)를 지원하지 않아요</span>}
        </div>
      )}

      {sfxMuted && playing && (
        <button
          type="button"
          onClick={() => {
            audio.setMasterMuted(false);
            audio.setSfxMuted(false);
            audio.setBgmMuted(false);
          }}
          className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-xs font-semibold text-amber-100 light:text-amber-700"
        >
          🔇 소리가 꺼져 있어요 — 심장 소리·탈 쓰는 소리는 화면(💓 표시·배너)으로도 나오지만, 소리를 켜면 훨씬 무섭습니다. 눌러서 소리 켜기 🔊
        </button>
      )}

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black select-none light:border-slate-300 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[68svh] min-h-[360px]" : "aspect-[16/9] max-h-[78vh]"}`}
        onClick={() => {
          if (touch || overlayOpen || !playing) return;
          if (me.st === "out" || me.st === "escaped") {
            cycleSpectate();
            return;
          }
          if (document.pointerLockElement !== stageRef.current) void stageRef.current?.requestPointerLock?.();
          else primary();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="absolute inset-0" style={{ filter: me.st === "frozen" ? "saturate(0.4) brightness(0.85) hue-rotate(170deg)" : masked ? "saturate(1.25) contrast(1.08)" : stunned ? "blur(2px) brightness(1.3)" : undefined }}>
          {canGl ? <SchoolScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} onFps={(f) => f < 26 && setLowFps(true)} /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">이 기기는 3D(WebGL)를 지원하지 않아 플레이할 수 없어요.</div>}
        </div>

        {/* 필름 그레인 · 비네트 · 위험 테두리 */}
        {grain && <div className="pointer-events-none absolute inset-[-60px] z-10 opacity-60 mix-blend-overlay" style={{ backgroundImage: `url(${grain})`, animation: "tau-grain 0.42s steps(4) infinite" }} />}
        <div className="pointer-events-none absolute inset-0 z-10" style={{ background: `radial-gradient(ellipse at center, transparent ${52 - hud.near * 6}%, rgba(0,0,0,${0.6 + hud.near * 0.06}) 100%)` }} />
        {hud.near >= 1 && alive && <div className="pointer-events-none absolute inset-0 z-10" style={{ boxShadow: `inset 0 0 ${50 + hud.near * 40}px rgba(170,0,0,${0.12 + hud.near * 0.12})`, animation: `tau-pulse ${hud.near === 3 ? 0.43 : hud.near === 2 ? 0.64 : 0.9}s ease-in-out infinite` }} />}
        {masked && <div className="pointer-events-none absolute inset-0 z-10" style={{ boxShadow: "inset 0 0 160px rgba(120,0,0,0.55)", background: "radial-gradient(ellipse at center, transparent 55%, rgba(60,0,0,0.5) 100%)" }} />}
        {me.st === "frozen" && <div className="pointer-events-none absolute inset-0 z-10" style={{ boxShadow: "inset 0 0 180px rgba(140,210,255,0.75)", background: "rgba(120,190,255,0.12)" }} />}
        {flash && <div key={flash.id} className="pointer-events-none absolute inset-0 z-30" style={{ background: flash.tone === "red" ? "rgba(190,0,0,0.85)" : flash.tone === "ice" ? (view.calm ? "rgba(160,220,255,0.4)" : "rgba(190,235,255,0.9)") : view.calm ? "rgba(255,250,235,0.4)" : "rgba(255,250,235,0.9)", animation: "tau-flash 1.1s ease-out forwards" }} />}

        {/* 조준점 + 상호작용 */}
        {alive && playing && !stunned && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
            <div className={`h-1.5 w-1.5 rounded-full ${hud.target ? "bg-amber-300" : masked ? "bg-rose-400" : "bg-white/50"}`} />
            {prompt && (
              <div className="mt-6 flex flex-col items-center gap-1">
                <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-amber-100">
                  {!touch && <kbd className="mr-1.5 rounded border border-amber-200/60 px-1 text-[10px]">E</kbd>}
                  {prompt}
                </span>
                {hud.using && (
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full bg-amber-300 transition-[width] duration-100" style={{ width: `${hud.useK * 100}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 왼쪽 위: 목표 · 아이들 */}
        <div className="pointer-events-none absolute top-2 left-2 z-20 flex max-w-[62%] flex-col gap-1.5">
          {playing && <p className="rounded-lg bg-black/60 px-2.5 py-1.5 text-[11px] leading-snug font-semibold break-keep text-amber-50 sm:text-xs">{objective}</p>}
          {playing && hud.room && <p className="w-fit rounded bg-black/45 px-2 py-0.5 text-[10px] text-white/60">📍 {hud.room}</p>}
          <div className="flex flex-col gap-1">
            {snap.players.map((p) => {
              if (p.seat === mySeat) return null;
              // 변장 중인 술래는 다른 아이와 똑같이 적는다. 정체가 드러난 동안(소금)·판이 끝난 뒤에만 표시
              const known = p.role === "tagger" && (exposed || !!o);
              return (
                <p key={p.seat} className={`flex w-fit items-center gap-1.5 rounded bg-black/55 px-2 py-0.5 text-[11px] ${p.st === "out" ? "text-white/35 line-through" : known ? "text-rose-200" : "text-white/85"}`}>
                  <span aria-hidden style={{ color: SEAT_COLORS[p.seat % 5] }}>
                    {SEAT_SYMBOLS[p.seat % 5]}
                  </span>
                  <span className="max-w-[7rem] truncate">{names[p.seat] ?? `${p.seat + 1}번`}</span>
                  {(p.bot || p.away) && <span className="text-[9px] text-white/40">🤖</span>}
                  <span>{known ? "👹 술래!" : p.st === "frozen" ? `❄ ${Math.max(0, Math.ceil(p.melt / 1000))}초 (${p.freezes}/${MAX_FREEZES})` : p.st === "escaped" ? "🚪 탈출" : p.st === "out" ? "" : p.freezes > 0 && p.role === "runner" ? `❄×${p.freezes}` : ""}</span>
                </p>
              );
            })}
          </div>
        </div>

        {/* 오른쪽 위: 알림 */}
        <div className="pointer-events-none absolute top-2 right-2 z-20 flex max-w-[46%] flex-col items-end gap-1">
          {notice && <p className="rounded-lg bg-sky-900/80 px-2.5 py-1 text-[11px] text-sky-100">{notice}</p>}
          {toasts.map((t) => (
            <p key={t.id} className={`rounded-lg px-2.5 py-1 text-right text-[11px] leading-snug break-keep ${t.tone === "good" ? "bg-emerald-900/80 text-emerald-100" : t.tone === "bad" ? "bg-rose-950/85 text-rose-100" : "bg-black/70 text-white/85"}`}>
              {t.text}
            </p>
          ))}
        </div>

        {/* 가운데 위: 역할 공개 · 배너 · 도움말 */}
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex flex-col items-center gap-2 px-3 text-center">
          {introLeft > 0 && !banner && (
            <div className={`rounded-2xl px-5 py-3 ${iAmTagger ? "bg-rose-900/90 text-white" : "bg-sky-900/90 text-sky-50"}`}>
              <p className="text-2xl font-black sm:text-4xl">{iAmTagger ? "👹 당신은 술래입니다" : "🏃 당신은 도망자입니다"}</p>
              <p className="mt-1 text-[11px] break-keep opacity-90 sm:text-xs">{iAmTagger ? "아무도 모른다 — 아이인 척 섞여 있다가 탈을 쓰고 덮쳐라" : `이 중 한 명이 술래다 — 장승 ${snap.need}개를 봉인하고 교문으로 달아나라`}</p>
            </div>
          )}
          {banner && (
            <div className={`rounded-2xl px-4 py-2 ${banner.tone === "danger" ? "bg-rose-800/90 text-white" : banner.tone === "good" ? "bg-emerald-800/90 text-emerald-50" : "bg-black/80 text-amber-100"}`}>
              <p className="text-lg font-black sm:text-2xl">{banner.text}</p>
              {banner.sub && <p className="mt-0.5 text-[11px] break-keep opacity-90 sm:text-xs">{banner.sub}</p>}
            </div>
          )}
          {stunned && <p className="rounded-full bg-black/75 px-3 py-1 text-xs font-bold text-amber-100">🧂 소금에 맞아 꼼짝 못 한다 ({Math.max(0, (tg.stunUntil - snap.t) / 1000).toFixed(1)}초)</p>}
          {iAmTagger && exposed && !stunned && <p className="rounded-full bg-rose-900/80 px-3 py-1 text-xs font-bold text-rose-100">정체가 드러났다 — {Math.ceil((tg.exposedUntil - snap.t) / 1000)}초 동안 모두가 알아본다</p>}
          {showTips && !banner && introLeft <= 0 && <p className="max-w-md rounded-xl bg-black/65 px-3 py-1.5 text-[11px] leading-snug break-keep text-white/85 sm:text-xs">💡 {tip}</p>}
        </div>

        {/* 왼쪽 아래: 상태 */}
        {alive && playing && (
          <div className={`pointer-events-none absolute z-20 flex flex-col gap-1 rounded-xl bg-black/55 p-2 ${touch ? "top-[40%] left-2" : "bottom-2 left-2"}`}>
            {iAmTagger ? (
              <>
                <Meter icon="👹" label={`탈 기운 (${GAUGE_MIN_ON} 이상이어야 쓸 수 있다)`} value={tg.gauge} color={tg.form === "mask" ? "#ef4444" : tg.gauge >= GAUGE_MIN_ON ? "#fb923c" : "#6b7280"} warn={tg.form === "mask" && tg.gauge < 25} />
                {tg.form === "kid" && <Meter icon="🏃" label="달리기 체력" value={hud.stamina} color="#60a5fa" />}
                <p className="text-[10px] text-white/70">
                  {tg.form === "kid" ? (graceLeft > 0 ? `🎭 변장 중 · 탈은 ${Math.ceil(graceLeft / 1000)}초 뒤부터` : tg.gauge >= GAUGE_MIN_ON ? "🎭 변장 중 · 탈을 쓸 수 있다" : "🎭 변장 중 · 탈 기운을 모으는 중") : tg.form === "on" ? "탈을 쓰는 중…" : tg.form === "off" ? "탈을 벗는 중…" : recovering ? "😮‍💨 숨 고르는 중 (느려짐 · 덮치기 불가)" : "👹 탈 — 덮칠 수 있다"}
                </p>
                <p className="text-[10px] text-white/50">노란 파문 = 들리는 발소리{tg.form === "kid" ? ` (변장 중엔 ${KID_HEAR_MUL * 100}%만 들린다)` : ""}</p>
              </>
            ) : (
              <>
                <Meter icon="🏃" label="달리기 체력" value={hud.stamina} color="#60a5fa" />
                <div className="flex items-center gap-1.5 text-[11px] text-white/85" title="가면 쓴 술래가 가까울수록 심장이 빨리 뛴다">
                  <span aria-hidden className={`w-5 text-center text-sm ${hud.near > 0 ? "animate-pulse" : ""}`}>
                    {hud.near > 0 ? "💓" : "🫀"}
                  </span>
                  <span className="tracking-widest" aria-label={`심장 소리 ${hud.near}단계`}>
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={hud.near >= n ? (hud.near === 3 ? "text-rose-400" : "text-rose-200") : "text-white/20"}>
                        ▮
                      </span>
                    ))}
                  </span>
                  <span className="text-[10px] text-white/50">{hud.near === 0 ? "조용함" : hud.near === 1 ? "탈이 근처에 있다" : hud.near === 2 ? "가깝다!" : "바로 옆!"}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-white/85" title="내가 지금 내는 소리 (술래 눈에 벽 너머 파문으로 보인다)">
                  <span aria-hidden className="w-5 text-center text-sm">
                    {noiseLv === 0 ? "🔇" : noiseLv === 1 ? "🔈" : noiseLv === 2 ? "🔉" : "🔊"}
                  </span>
                  <span className={noiseLv >= 3 ? "font-bold text-rose-300" : noiseLv === 2 ? "text-amber-200" : noiseLv === 1 ? "text-white/80" : "text-emerald-200"}>{noiseLv === 0 ? "소리 없음" : `내 소리 ${noise.toFixed(0)}m`}</span>
                </div>
                <p className="text-[10px] text-white/55">
                  {hud.cr ? "⬇ 앉음" : "⬆ 섬"} · ❄ {me.freezes}/{MAX_FREEZES}
                  {snap.t < me.slowUntil ? " · 🧂 눈이 따갑다(느림)" : ""}
                  {snap.t < me.safeUntil ? " · 🛡 방금 녹음" : ""}
                </p>
              </>
            )}
          </div>
        )}

        {/* 오른쪽 아래: 소지품 · 조작 */}
        {alive && playing && !touch && (
          <div className="pointer-events-none absolute right-2 bottom-2 z-20 flex flex-col items-end gap-1 text-[11px] text-white/85">
            {!iAmTagger && (
              <div className="flex gap-1.5 rounded-xl bg-black/55 px-2.5 py-1.5 text-sm">
                <span title="소금 (왼쪽 클릭/Q: 뿌리기)">🧂{me.salt}</span>
              </div>
            )}
            <p className="rounded-lg bg-black/45 px-2 py-1 text-right text-[10px] leading-relaxed text-white/60">
              WASD 이동 · Shift 달리기 · C 앉기 · F 손전등 · M 지도
              <br />
              {iAmTagger ? "E 봉인하는 척/걷어차기/문 · Space 탈 쓰기·벗기 · 클릭 덮치기" : "E 봉인/땡!/문 · 클릭·Q 소금 뿌리기"}
            </p>
          </div>
        )}

        {/* 터치 조작 */}
        {touch && alive && playing && !overlayOpen && (
          <>
            <div
              className="absolute top-0 right-0 z-[15] h-full w-[55%] touch-none"
              onPointerMove={(e) => {
                if (e.pointerType === "mouse" && e.buttons === 0) return;
                const k = 0.0052 * view.sens;
                bodyOf(shared).yaw -= e.movementX * k;
                bodyOf(shared).pitch = Math.max(-1.35, Math.min(1.35, bodyOf(shared).pitch - e.movementY * k));
              }}
            />
            <Joystick
              onMove={(v) => {
                bodyOf(shared).mx = v?.x ?? 0;
                bodyOf(shared).mz = v?.z ?? 0;
                bodyOf(shared).wantRun = !!v && Math.hypot(v.x, v.z) > 0.92;
              }}
            />
            <div className="absolute right-2 bottom-3 z-20 flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <TouchBtn label="🗺️" onDown={() => setMapOpen(true)} ariaLabel="지도" />
                {!masked && <TouchBtn label="🔦" active={hud.light} onDown={toggleLight} ariaLabel="손전등" />}
                {!masked && <TouchBtn label="⬇" sub={hud.cr ? "앉음" : "앉기"} active={hud.cr} onDown={toggleCrouch} ariaLabel="앉기" />}
              </div>
              <div className="flex items-end gap-2">
                {iAmTagger ? (
                  <>
                    <TouchBtn label="👹" sub={tg.form === "mask" ? "벗기" : "탈 쓰기"} active={tg.form === "mask"} onDown={toggleMask} ariaLabel="탈 쓰기 또는 벗기" />
                    {tg.form === "mask" && <TouchBtn label="🫳" sub={recovering ? "숨 고름" : "덮치기"} active={!recovering} onDown={doHit} big ariaLabel="덮치기" />}
                  </>
                ) : (
                  <TouchBtn label="🧂" sub={`${me.salt}`} active={me.salt > 0} onDown={doSalt} ariaLabel="소금 뿌리기" />
                )}
                <TouchBtn label="✋" sub={hud.target ? (hud.target.kind === "door" ? "문" : hud.target.kind === "seal" ? "봉인" : hud.target.kind === "kick" ? "걷어차기" : "땡!") : ""} active={!!hud.target} onDown={pressUse} onUp={releaseUse} big ariaLabel="상호작용" />
              </div>
            </div>
          </>
        )}

        {/* 얼음 · 관전 */}
        {playing && me.st === "frozen" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[18%] z-20 flex flex-col items-center gap-1 px-3 text-center">
            <p className="text-3xl font-black text-sky-100 drop-shadow-[0_0_14px_rgba(120,200,255,0.9)]">❄ 얼음!</p>
            <p className="rounded-full bg-black/70 px-3 py-1 text-xs text-white/85">
              친구가 다가와 땡! 해 주길 기다린다 — {Math.max(0, Math.ceil(me.melt / 1000))}초 안에 못 녹으면 끌려간다 ({me.freezes}/{MAX_FREEZES}번째)
            </p>
          </div>
        )}
        {playing && (me.st === "out" || me.st === "escaped") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[10%] z-20 flex flex-col items-center gap-1 px-3 text-center">
            <p className={`text-xl font-black ${me.st === "escaped" ? "text-emerald-200" : "text-white/70"}`}>{me.st === "escaped" ? "🚪 탈출했다!" : "🕯️ 끌려갔다…"}</p>
            <p className="rounded-full bg-black/70 px-3 py-1 text-xs text-white/80">남은 친구의 눈으로 지켜보는 중 — 화면을 누르면 다른 친구로</p>
          </div>
        )}

        {needPointer && (
          <div className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center gap-2 bg-black/55 text-center">
            <p className="text-lg font-bold text-white">🖱️ 화면을 클릭하면 시작</p>
            <p className="text-xs text-white/70">마우스로 둘러보기 · Esc로 마우스 풀기</p>
          </div>
        )}

        {mapOpen && <SchoolMap snap={snap} hud={hud} onClose={() => setMapOpen(false)} />}

        {/* 결과 */}
        {o && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/88 p-4 text-center">
            <p className={`text-3xl font-black sm:text-5xl ${o.winner === "draw" ? "text-amber-200" : myRank === 1 ? "text-emerald-200" : "text-rose-300"}`}>{o.winner === "runners" ? "아이들이 달아났다" : o.winner === "tagger" ? "술래가 이겼다" : "절반만 달아났다 — 무승부"}</p>
            <p className="text-sm text-white/80">
              👹 술래는 <b className="text-rose-200">{snap.tg.seat === mySeat ? "나" : (names[snap.tg.seat] ?? `${snap.tg.seat + 1}번`)}</b> · 탈출 {o.escaped}/{o.runners}명 · {Math.floor(o.tMs / 60000)}분 {Math.floor((o.tMs % 60000) / 1000)}초{o.why === "time" ? " · 첫닭이 울었다" : ""}
            </p>
            <div className="w-full max-w-xl overflow-x-auto">
              <table className="w-full text-left text-[11px] text-white/80 sm:text-xs">
                <thead>
                  <tr className="text-white/45">
                    <th className="py-1 pr-2 font-medium">이름</th>
                    <th className="pr-2 font-medium">결과</th>
                    <th className="pr-2 font-medium">🧧 봉인</th>
                    <th className="pr-2 font-medium">땡!</th>
                    <th className="pr-2 font-medium">❄ 얼음</th>
                    <th className="font-medium">🧂 명중</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.players.map((p) => (
                    <tr key={p.seat} className={p.seat === mySeat ? "font-bold text-white" : ""}>
                      <td className="py-0.5 pr-2">
                        <span style={{ color: SEAT_COLORS[p.seat % 5] }}>{SEAT_SYMBOLS[p.seat % 5]}</span> {p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}
                      </td>
                      <td className="pr-2">{p.role === "tagger" ? `👹 술래 · 얼림 ${p.stats.catches}` : p.st === "escaped" ? "🚪 탈출" : "🕯️ 끌려감"}</td>
                      <td className="pr-2 tabular-nums">{p.role === "tagger" ? `걷어참 ${p.stats.kicks}` : p.stats.seals}</td>
                      <td className="pr-2 tabular-nums">{p.role === "tagger" ? "-" : p.stats.thaws}</td>
                      <td className="pr-2 tabular-nums">{p.role === "tagger" ? `🧂 맞음 ${p.stats.stunned}` : p.stats.frozen}</td>
                      <td className="tabular-nums">{p.role === "tagger" ? "-" : `${p.stats.saltHits}/${p.stats.salts}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              {onRestart && isHost && ended && (
                <button type="button" onClick={onRestart} className="rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-sky-400">
                  🔁 한 판 더
                </button>
              )}
              <button type="button" onClick={onLeave} className="rounded-full border border-white/25 px-5 py-2 text-sm text-white/80 hover:border-white/50">
                나가기
              </button>
            </div>
            {!isHost && ended && <p className="text-[11px] text-white/45">방장이 다시 시작하면 바로 이어져요.</p>}
            {practice && <p className="text-[11px] text-white/45">혼자 연습 기록도 내 기록에 남아요.</p>}
          </div>
        )}
      </div>

      {showTips && (
        <button
          type="button"
          onClick={() => {
            setTipsSeen(true);
            try {
              window.localStorage.setItem(TIPS_KEY, "1");
            } catch {
              /* 저장 안 돼도 됨 */
            }
          }}
          className="self-end text-[11px] text-white/40 underline light:text-slate-400"
        >
          도움말 다시 보지 않기
        </button>
      )}

      {rulesOpen && <RulebookModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
