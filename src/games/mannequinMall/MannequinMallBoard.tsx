"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { BIND_MS, BLEED_MS, CREAK_R, DIFFICULTY_INFO, FLICKER_MS, GRACE_MS, ITEM_INFO, PLACE_MS, REVIVE_MS, SEARCH_MS, SEAT_COLORS, SEAT_SYMBOLS, TIME_LIMIT_MS, clockText, type MoveMode } from "./data";
import { getMannequinMallSound } from "./mannequinMallSound";
import { createLocal, iSee, reportOf, syncLocal, type LocalBody } from "./localBody";
import { CELL, COLS, CONTAINERS, EXIT, KIND, PANEL, ROOM, ROOM_NAMES, ROWS, colOf, idx, roomNameAt, rowOf } from "./map";
import type { SnapBuffer, Snap } from "./net";
import { ITEM_ORDER, type GameEvent, type PlayerAct, type PosReport } from "./sim";
import RulebookModal from "./RulebookModal";
import type { SceneShared } from "./three/MallScene";

const MallScene = dynamic(() => import("./three/MallScene"), { ssr: false, loading: () => null });

/** 내 몸(ref 안의 값)을 꺼낸다 — 이벤트·타이머 안에서만 부른다 */
const bodyOf = (sh: MutableRefObject<SceneShared>): LocalBody => sh.current.local;

/**
 * 마네킹 백화점 게임 화면 (룰북 §10~§11): 1인칭 3D 무대 + HUD(손전등·체력·소지품·삐걱 소리·노려보기) +
 * 조작(키보드·마우스 / 터치) + 정전·붙잡힘 배너 + 안내도 + 결과. 소리로 전하는 신호는 모두 글자·색으로도 나온다.
 */

export interface MannequinMallBoardProps {
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
const VIEW_KEY = "mannequin-mall:view";
const TIPS_KEY = "mannequin-mall:tips";

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
    img.data[i + 3] = 34;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

interface Hud {
  stamina: number;
  mv: MoveMode;
  light: boolean;
  target: { id: string; kind: string; n: number } | null;
  using: boolean;
  useK: number;
  /** 삐걱 소리 단계 0~3 */
  near: number;
  /** 내 손전등에 걸린 마네킹 수 / 그중 떨고 있는 것의 노려보기 최대치 */
  watching: number;
  stare: number;
  room: string;
  x: number;
  z: number;
  yaw: number;
}

const HUD0: Hud = { stamina: 100, mv: 0, light: true, target: null, using: false, useK: 0, near: 0, watching: 0, stare: 0, room: "", x: 0, z: 0, yaw: 0 };

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
        getMannequinMallSound().play("ui");
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

/** 층 안내도 — 내 위치와 동료, 뒤진 상자만 나온다 (마네킹은 안 나온다) */
function MallMap({ snap, mySeat, hud, onClose }: { snap: Snap; mySeat: number; hud: Hud; onClose: () => void }) {
  const cells = useMemo(() => {
    const out: { c: number; r: number; fill: string }[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = KIND[idx(c, r)];
        if (k === 0) continue;
        const room = ROOM[idx(c, r)];
        out.push({ c, r, fill: k === 3 ? "#1f6d3d" : k === 4 ? "#191b1f" : k === 5 ? "#050506" : k === 6 ? "#7a6420" : room === "." || room === "+" ? "#2a2f36" : room === "w" || room === "k" ? "#3a3530" : "#343b46" });
      }
    return out;
  }, []);
  const labels = useMemo(() => {
    const acc: Record<string, { x: number; y: number; n: number }> = {};
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const room = ROOM[idx(c, r)];
        if (!ROOM_NAMES[room] || room === "." || room === "+") continue;
        const a = (acc[room] ??= { x: 0, y: 0, n: 0 });
        a.x += c + 0.5;
        a.y += r + 0.5;
        a.n++;
      }
    return Object.entries(acc).map(([room, a]) => ({ room, x: a.x / a.n, y: a.y / a.n }));
  }, []);
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/85 p-3" onClick={onClose}>
      <p className="text-sm font-bold text-amber-100">🗺️ 2층 매장 안내도</p>
      <svg viewBox={`0 0 ${COLS} ${ROWS}`} className="max-h-[78%] w-full max-w-3xl rounded-lg border border-white/15 bg-[#0c0f12]" role="img" aria-label="매장 지도">
        {cells.map((c) => (
          <rect key={`${c.c}-${c.r}`} x={c.c} y={c.r} width={1.02} height={1.02} fill={c.fill} />
        ))}
        {CONTAINERS.map((c) => (
          <g key={c.i}>
            <rect x={colOf(c.cell) + 0.2} y={rowOf(c.cell) + 0.2} width={0.6} height={0.6} rx={0.1} fill={snap.searched[c.i] ? "#20252b" : "#c8a86a"} stroke="#0c0f12" strokeWidth={0.05} />
            {snap.searched[c.i] && (
              <text x={colOf(c.cell) + 0.5} y={rowOf(c.cell) + 0.55} fontSize={0.5} textAnchor="middle" dominantBaseline="central" fill="#6b7480">
                ✓
              </text>
            )}
          </g>
        ))}
        {labels.map((l) => (
          <text key={l.room} x={l.x} y={l.y} fontSize={0.62} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#c8d3df" opacity={0.75}>
            {ROOM_NAMES[l.room]}
          </text>
        ))}
        <text x={PANEL.x / CELL} y={PANEL.z / CELL - 0.3} fontSize={0.85} textAnchor="middle" dominantBaseline="central">
          ⚡
        </text>
        <text x={EXIT.x / CELL} y={EXIT.z / CELL + 0.75} fontSize={0.8} textAnchor="middle" dominantBaseline="central">
          🚪
        </text>
        {snap.players.map((p) =>
          p.seat === mySeat || p.st === "escaped" ? null : (
            <g key={p.seat} opacity={p.st === "dead" ? 0.35 : 1}>
              <circle cx={p.x / CELL} cy={p.z / CELL} r={0.36} fill={SEAT_COLORS[p.seat % 4]} stroke="#000" strokeWidth={0.06} />
              <text x={p.x / CELL} y={p.z / CELL + 0.03} fontSize={0.42} textAnchor="middle" dominantBaseline="central" fill="#000" fontWeight={800}>
                {p.st === "down" ? "✚" : SEAT_SYMBOLS[p.seat % 4]}
              </text>
            </g>
          ),
        )}
        <g transform={`translate(${hud.x / CELL} ${hud.z / CELL}) rotate(${(-hud.yaw * 180) / Math.PI})`}>
          <path d="M0,-0.62 L0.42,0.45 L0,0.2 L-0.42,0.45 Z" fill="#fff" stroke="#000" strokeWidth={0.07} />
        </g>
      </svg>
      <p className="text-center text-[11px] text-white/60">
        ▲ 나 · 금색 칸 = 안 뒤진 상자 · ✓ 뒤진 상자 · 검은 칸 = 진열장 · ⚡ 배전반 · 🚪 정문 셔터 — 마네킹은 지도에 나오지 않는다
        <br />
        아무 곳이나 누르면 닫혀요 (M)
      </p>
    </div>
  );
}

/* ── 본체 ───────────────────────────────────────────────────────────── */

export default function MannequinMallBoard({ snap, buf, fresh, mySeat, names, onReport, onAct, ended, isHost, onRestart, onLeave, practice, notice }: MannequinMallBoardProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const shared = useRef<SceneShared>(null as unknown as SceneShared);
  if (shared.current === null) shared.current = { buf, local: createLocal(), mySeat, calm: false, flash: null };
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
  const [flash, setFlash] = useState<{ tone: "red" | "white"; id: number } | null>(null);
  const [grain, setGrain] = useState("");
  const [tipsSeen, setTipsSeen] = useState(true);
  const toastId = useRef(0);
  const sound = getMannequinMallSound;
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
    bodyOf(shared).onStep = (mode) => sound().play("step", mode);
    return () => {
      bodyOf(shared).onStep = null;
    };
  }, [sound]);

  /* ── 행동 ── */
  const doFlash = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (!p || p.st !== "alive") return;
    if (p.cameras <= 0) {
      sound().play("denied");
      return;
    }
    actRef.current({ k: "flash", yaw: bodyOf(shared).yaw, pitch: bodyOf(shared).pitch });
  }, [mySeat, sound]);
  const toggleLight = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (!p || p.st !== "alive") return;
    if (p.battery <= 0) {
      sound().play("lightDead");
      return;
    }
    bodyOf(shared).light = !bodyOf(shared).light;
    sound().play(bodyOf(shared).light ? "lightOn" : "lightOff");
  }, [mySeat, sound]);
  const pressUse = useCallback(() => {
    bodyOf(shared).wantUse = true;
  }, []);
  const releaseUse = useCallback(() => {
    bodyOf(shared).wantUse = false;
  }, []);
  const cycleSpectate = useCallback(() => {
    const s = snapRef.current;
    const list = s.players.filter((p) => p.st === "alive" && p.seat !== mySeat).map((p) => p.seat);
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
      if (e.code === "KeyF") toggleLight();
      else if (e.code === "KeyE" || e.code === "Space") pressUse();
      else if (e.code === "KeyQ") doFlash();
      else if (e.code === "KeyM" || e.code === "Tab") setMapOpen((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      held.delete(e.code);
      sync();
      if (e.code === "KeyE" || e.code === "Space") releaseUse();
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
  }, [toggleLight, pressUse, releaseUse, doFlash]);

  useEffect(() => {
    if ((overlayOpen || !playing) && document.pointerLockElement) document.exitPointerLock();
  }, [overlayOpen, playing]);

  /* ── 0.1초마다: 방장에게 보고 + HUD + 삐걱 소리 ── */
  useEffect(() => {
    let useId: string | null = null;
    let useStart = 0;
    let creakAt = 0;
    let beatAt = 0;
    let stareAt = 0;
    const id = window.setInterval(() => {
      const s = snapRef.current;
      const p = s.players[mySeat];
      if (!p) return;
      const now = performance.now();
      const b = bodyOf(shared);
      // 새 판이면 먼저 시작 자리로 맞춘 뒤에 보고한다 (안 그러면 (0,0)을 보고해 벽 속으로 끌려간다)
      syncLocal(b, s, mySeat);
      if (s.phase === "play") reportRef.current(reportOf(b));
      if (b.use !== useId) {
        useId = b.use;
        useStart = now;
        if (useId?.[0] === "c") sound().play("rummage");
      } else if (useId?.[0] === "c" && Math.floor((now - useStart) / 560) !== Math.floor((now - 100 - useStart) / 560)) sound().play("rummage");
      const need = useId?.[0] === "p" ? PLACE_MS : useId?.[0] === "r" ? REVIVE_MS : useId?.[0] === "m" ? BIND_MS : SEARCH_MS;
      // 삐걱: 움직이는 마네킹 중 가장 가까운 것 (보는 중엔 안 움직이니 소리도 없다)
      let nearest = 99;
      for (const m of s.mannequins) if (m.moving) nearest = Math.min(nearest, Math.hypot(m.x - b.x, m.z - b.z));
      const audible = s.phase === "play" && p.st !== "dead" && p.st !== "escaped";
      const near = !audible || nearest > CREAK_R ? 0 : nearest < 5 ? 3 : nearest < 10 ? 2 : 1;
      if (near > 0 && now >= creakAt) {
        creakAt = now + (260 + nearest * 40) * (0.8 + Math.random() * 0.4);
        const v = Math.max(0.05, Math.pow(1 - nearest / CREAK_R, 1.5));
        sound().play(Math.random() < 0.65 ? "creak" : "scrape", v);
      }
      if (p.st === "alive" && near >= 2 && now >= beatAt) {
        beatAt = now + (near === 3 ? 520 : 800);
        sound().play("beat", near === 3 ? 1 : 0.5);
      }
      // 내 손전등에 걸린 것 중 노려보기가 차오르는 마네킹
      let watching = 0;
      let stare = 0;
      if (p.st === "alive")
        for (const m of s.mannequins) {
          if (!iSee(b, s, mySeat, m.x, m.z)) continue;
          watching++;
          if (m.downUntil <= s.t) stare = Math.max(stare, m.stare);
        }
      if (stare > 0.05 && now >= stareAt) {
        stareAt = now + 260;
        sound().play("stare", stare);
      }
      const tgt = b.target;
      setHud({
        stamina: b.stamina,
        mv: b.mv,
        light: b.light && p.battery > 0,
        target: tgt ? { id: tgt.id, kind: tgt.kind, n: tgt.n } : null,
        using: useId !== null,
        useK: useId ? Math.min(1, (now - useStart) / need) : 0,
        near,
        watching,
        stare,
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
    const nm = (seat?: number) => (seat === mySeat ? "나" : (namesRef.current[seat ?? -1] ?? "누군가"));
    const volAt = (x?: number, z?: number, reach = 26) => (x === undefined || z === undefined ? 0.5 : Math.max(0.05, 1 - Math.hypot(x - bodyOf(shared).x, z - bodyOf(shared).z) / reach));
    for (const e of fresh.events) {
      const mine = e.seat === mySeat;
      switch (e.k) {
        case "found": {
          const kind = ITEM_ORDER[e.n ?? 0] ?? "empty";
          const info = ITEM_INFO[kind];
          if (mine) {
            sound().play(kind === "fuse" ? "fuse" : kind === "battery" ? "battery" : kind === "camera" ? "camera" : kind === "ribbon" ? "ribbon" : "empty");
            toast(kind === "empty" ? "🕸️ 빈 상자다" : `${info.emoji} ${info.name} — ${info.desc}`, kind === "empty" ? "info" : "good");
          } else if (kind === "fuse") toast(`⚡ ${nm(e.seat)}이(가) 퓨즈를 찾았다`, "good");
          break;
        }
        case "full":
          if (mine) {
            sound().play("full");
            toast(`${ITEM_INFO[ITEM_ORDER[e.n ?? 0] ?? "empty"].emoji} 더 들 수 없다 — 그대로 두었다`);
          }
          break;
        case "place":
          sound().play("place", e.n ?? 1);
          showBanner(`⚡ 퓨즈 ${e.n}/${s.need}`, "warn", (e.n ?? 0) >= s.need ? "마지막 퓨즈다 — 셔터가 올라간다" : "배전반이 웅 하고 깨어났다… 어딘가에서 마네킹 하나가 고개를 든다", 3200);
          break;
        case "exitOpen":
          sound().play("exitOpen");
          window.setTimeout(() => showBanner("🚪 정문 셔터가 올라간다!", "good", "남쪽 화장품 매장 정문으로 — 뒤를 돌아보면서!", 5000), 1200);
          break;
        case "wake":
          sound().play("wake");
          if (s.t < 20_000) toast("…어딘가에서 플라스틱이 툭 하고 움직였다", "bad");
          break;
        case "flickerWarn":
          sound().play("flickerWarn");
          showBanner("⚡ 형광등이 지직거린다…", "warn", "곧 정전 — 마네킹에게서 멀어지고 동료 곁으로", 2600);
          break;
        case "flickerOn":
          sound().play("flickerOn");
          break;
        case "flickerOff":
          sound().play("flickerOff");
          break;
        case "grab":
          if (mine) {
            const m = s.mannequins[e.n ?? -1];
            bodyOf(shared).scareUntil = performance.now() + 1100;
            bodyOf(shared).scareAt = m ? { x: m.x, z: m.z } : null;
            bodyOf(shared).shake = 1;
            sound().play(viewRef.current.calm ? "grabFar" : "grabMe", 0.6);
            setFlash({ tone: "red", id: e.id });
          } else {
            sound().play("grabFar", volAt(e.x, e.z, 30));
            toast(`✚ ${nm(e.seat)}이(가) 붙잡혀 굳었다 — 다가가 풀어 주세요`, "bad");
          }
          break;
        case "revive":
          sound().play("revive");
          toast(mine ? `${nm(e.n)}이(가) 나를 풀어 줬다` : `${nm(e.n)}이(가) ${nm(e.seat)}을(를) 풀어 줬다`, "good");
          break;
        case "dead":
          sound().play("dead");
          toast(`🧍 ${nm(e.seat)}… 영영 마네킹이 되었다`, "bad");
          break;
        case "escape":
          sound().play("escape");
          toast(mine ? "🚪 탈출했다!" : `🚪 ${nm(e.seat)} 탈출!`, "good");
          break;
        case "flash": {
          sound().play("flash");
          shared.current.flash = { x: e.x ?? 0, z: e.z ?? 0, at: performance.now() };
          if (mine) setFlash({ tone: "white", id: e.id });
          if ((e.n ?? 0) > 0) {
            window.setTimeout(() => sound().play("reveal"), 180);
            toast(`📸 ${mine ? "" : `${nm(e.seat)}의 `}플래시에 살아 있는 마네킹 ${e.n}개가 드러났다 — 눈이 붉다!`, "bad");
          } else if (mine) toast("📸 찰칵… 비친 마네킹은 모두 그냥 마네킹이다");
          break;
        }
        case "bound":
          sound().play("bound");
          toast(mine ? "🎀 묶었다! 살아 있는 놈이었다 — 한동안 못 움직인다" : `🎀 ${nm(e.seat)}이(가) 살아 있는 마네킹을 묶었다`, "good");
          break;
        case "decoy":
          sound().play("decoy");
          if (mine) toast("🎀 …그냥 마네킹이었다 (끈은 써 버렸다)");
          break;
        case "unbound":
          sound().play("unbound", volAt(e.x, e.z, 24));
          break;
        case "topple":
          sound().play("topple", volAt(e.x, e.z, 26));
          if (mine) toast("🔦 노려봤더니 와르르 쓰러졌다! (잠깐 뒤 다시 일어선다)", "good");
          break;
        case "rise":
          sound().play("rise", volAt(e.x, e.z, 22));
          break;
        case "lastMinute":
          sound().play("lastMinute");
          showBanner("⏰ 자정까지 1분", "danger", "자정이 되면 셔터는 영영 잠긴다", 3500);
          break;
        case "over":
          sound().play(e.n === 1 ? "victory" : "defeat");
          break;
      }
    }
  }, [fresh, mySeat, sound, toast, showBanner]);

  const batteryDead = !!me && me.battery <= 0;
  useEffect(() => {
    if (batteryDead && playing) {
      sound().play("lightDead");
      toast("🔦 건전지가 다 됐다 — 이제 코앞밖에 안 보인다", "bad");
    }
  }, [batteryDead, playing, sound, toast]);

  /* ── BGM ── */
  const dark = snap.flicker.st === "dark";
  const intensity = !playing ? 0 : dark || hud.near >= 3 ? 2 : hud.near >= 1 || snap.flicker.st === "warn" ? 1 : 0;
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

  const sleeping = snap.t < GRACE_MS;
  const info = DIFFICULTY_INFO[snap.options.difficulty];
  const carried = snap.players.reduce((n, p) => n + (p.st === "alive" || p.st === "down" ? p.fuses : 0), 0);
  const objective = snap.exitOpen
    ? "🚪 셔터가 열렸다 — 남쪽 정문으로 탈출!"
    : me.fuses > 0
      ? `⚡ 퓨즈 ${me.fuses}개를 들고 있다 — 가운데 에스컬레이터 앞 배전반에 꽂아라`
      : `⚡ 셔터 퓨즈 찾기 — 계산대·상자를 뒤져라 (꽂은 것 ${snap.placed}/${snap.need}${carried > 0 ? ` · 동료가 ${carried}개 들고 있음` : ""})`;
  const prompt = !alive || !hud.target
    ? null
    : hud.target.kind === "search"
      ? "뒤지기 (누르고 있기) — 그동안 뒤는 못 본다"
      : hud.target.kind === "panel"
        ? "퓨즈 꽂기 (누르고 있기)"
        : hud.target.kind === "revive"
          ? `${names[hud.target.n] ?? "동료"} 풀어 주기 (누르고 있기)`
          : "🎀 마네킹 묶기 (누르고 있기)";
  const timeLeft = Math.max(0, TIME_LIMIT_MS - snap.t);
  const showTips = !tipsSeen && playing && snap.t < 40_000;
  const tip =
    snap.t < 9000
      ? "셔터가 내려갔다. 손전등 하나뿐이다… 계산대와 상자를 뒤져 셔터 퓨즈를 찾자"
      : snap.t < 18_000
        ? "진열된 마네킹 중 몇 개는 살아 있다. 누군가 보고 있는 동안엔 움직이지 못한다"
        : snap.t < 28_000
          ? "'삐걱…' 소리가 나면 무언가 움직이는 중이다 — 돌아서서 손전등으로 비춰라"
          : "손전등으로 3초쯤 계속 노려보면 와르르 쓰러진다. 뒤지는 동안엔 동료가 등 뒤를 봐 주자";
  const needPointer = !touch && playing && !locked && !overlayOpen && me.st !== "dead" && me.st !== "escaped";
  const o = snap.outcome;

  return (
    <div className="flex flex-col gap-2">
      <style>{`@keyframes mm-grain{0%{background-position:0 0}25%{background-position:-37px 21px}50%{background-position:19px -43px}75%{background-position:-11px 53px}100%{background-position:0 0}}@keyframes mm-flash{0%{opacity:.95}100%{opacity:0}}@keyframes mm-pulse{0%,100%{opacity:.55}50%{opacity:1}}@keyframes mm-buzz{0%,100%{opacity:0}10%{opacity:.5}12%{opacity:0}40%{opacity:.35}43%{opacity:0}70%{opacity:.6}72%{opacity:0}}`}</style>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-semibold text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
          {info.emoji} {info.label} · ⚡ {snap.placed}/{snap.need}
        </span>
        <span className={`rounded-full border px-2.5 py-1 font-semibold tabular-nums ${timeLeft < 60_000 ? "border-rose-400/60 bg-rose-500/15 text-rose-200" : "border-white/10 bg-white/[0.04] text-white/80 light:border-slate-200 light:bg-white light:text-slate-700"}`} title="자정이 되면 셔터가 영영 잠긴다">
          🕒 밤 {clockText(snap.t)}
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
              <button key={q} type="button" onClick={() => updateView({ quality: q })} className={`rounded-full border px-2 py-0.5 ${view.quality === q ? "border-amber-400/70 bg-amber-400/15 text-amber-100 light:text-amber-700" : "border-white/15 light:border-slate-300"}`}>
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
            놀람 연출 줄이기 (비명·화면 흔들림·번쩍임 약하게)
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
          🔇 소리가 꺼져 있어요 — 마네킹이 움직이는 &quot;삐걱…&quot; 소리를 들으면 훨씬 유리해요 (화면 가장자리 👂 표시로도 나와요). 눌러서 소리 켜기 🔊
        </button>
      )}

      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black select-none light:border-slate-300 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[68svh] min-h-[360px]" : "aspect-[16/9] max-h-[78vh]"}`}
        onClick={() => {
          if (touch || overlayOpen || !playing) return;
          if (me.st === "dead" || me.st === "escaped") {
            cycleSpectate();
            return;
          }
          if (document.pointerLockElement !== stageRef.current) void stageRef.current?.requestPointerLock?.();
          else doFlash();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="absolute inset-0" style={{ filter: me.st === "down" ? "grayscale(0.9) brightness(0.85) contrast(1.1)" : dark ? "brightness(0.4)" : undefined }}>
          {canGl ? <MallScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} onFps={(f) => f < 26 && setLowFps(true)} /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">이 기기는 3D(WebGL)를 지원하지 않아 플레이할 수 없어요.</div>}
        </div>

        {grain && <div className="pointer-events-none absolute inset-[-60px] z-10 opacity-60 mix-blend-overlay" style={{ backgroundImage: `url(${grain})`, animation: "mm-grain 0.42s steps(4) infinite" }} />}
        <div className="pointer-events-none absolute inset-0 z-10" style={{ background: "radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,0.66) 100%)" }} />
        {hud.near >= 1 && alive && <div className="pointer-events-none absolute inset-0 z-10" style={{ boxShadow: `inset 0 0 ${hud.near === 3 ? 150 : hud.near === 2 ? 90 : 50}px rgba(200,60,40,${hud.near === 3 ? 0.42 : hud.near === 2 ? 0.24 : 0.12})`, animation: `mm-pulse ${hud.near === 3 ? 0.4 : 0.8}s ease-in-out infinite` }} />}
        {snap.flicker.st === "warn" && <div className="pointer-events-none absolute inset-0 z-10 bg-black" style={{ animation: "mm-buzz 0.9s steps(1) infinite" }} />}
        {dark && <div className="pointer-events-none absolute inset-0 z-10 bg-black/80" />}
        {flash && <div key={flash.id} className="pointer-events-none absolute inset-0 z-30" style={{ background: flash.tone === "red" ? (view.calm ? "rgba(120,0,0,0.45)" : "rgba(190,0,0,0.9)") : view.calm ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)", animation: "mm-flash 0.9s ease-out forwards" }} />}

        {/* 조준점 + 노려보기 고리 + 상호작용 */}
        {alive && playing && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
            <div className="relative flex h-10 w-10 items-center justify-center">
              {hud.stare > 0.03 && (
                <svg viewBox="0 0 40 40" className="absolute inset-0" aria-label={`노려보기 ${Math.round(hud.stare * 100)}%`}>
                  <circle cx={20} cy={20} r={15} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />
                  <circle cx={20} cy={20} r={15} fill="none" stroke="#fbbf24" strokeWidth={3} strokeDasharray={`${hud.stare * 94.2} 94.2`} transform="rotate(-90 20 20)" />
                </svg>
              )}
              <div className={`h-1.5 w-1.5 rounded-full ${hud.target ? "bg-amber-300" : hud.watching > 0 ? "bg-sky-200" : "bg-white/50"}`} />
            </div>
            {hud.stare > 0.03 && <span className="mt-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-amber-200">부들부들 떤다 — 계속 비춰라!</span>}
            {prompt && (
              <div className="mt-4 flex flex-col items-center gap-1">
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

        {/* 왼쪽 위: 목표 · 동료 */}
        <div className="pointer-events-none absolute top-2 left-2 z-20 flex max-w-[62%] flex-col gap-1.5">
          {playing && <p className="rounded-lg bg-black/60 px-2.5 py-1.5 text-[11px] leading-snug font-semibold break-keep text-amber-50 sm:text-xs">{objective}</p>}
          {playing && hud.room && <p className="w-fit rounded bg-black/45 px-2 py-0.5 text-[10px] text-white/60">📍 {hud.room}</p>}
          <div className="flex flex-col gap-1">
            {snap.players.map((p) =>
              p.seat === mySeat ? null : (
                <p key={p.seat} className={`flex w-fit items-center gap-1.5 rounded bg-black/55 px-2 py-0.5 text-[11px] ${p.st === "dead" ? "text-white/35 line-through" : "text-white/85"}`}>
                  <span aria-hidden style={{ color: SEAT_COLORS[p.seat % 4] }}>
                    {SEAT_SYMBOLS[p.seat % 4]}
                  </span>
                  <span className="max-w-[7rem] truncate">{names[p.seat] ?? `${p.seat + 1}번`}</span>
                  {(p.bot || p.away) && <span className="text-[9px] text-white/40">🤖</span>}
                  <span>{p.st === "down" ? `✚ 굳음 ${Math.max(0, Math.ceil((BLEED_MS - (snap.t - p.downAt)) / 1000))}초` : p.st === "escaped" ? "🚪 탈출" : p.st === "dead" ? "" : `${p.fuses > 0 ? `⚡${p.fuses} ` : ""}${p.light && p.battery > 0 ? "🔦" : "🌑"}`}</span>
                </p>
              ),
            )}
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

        {/* 가운데 위: 정전 · 배너 · 도움말 */}
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex flex-col items-center gap-2 px-3 text-center">
          {dark && (
            <div className="flex flex-col items-center gap-1">
              <p className="text-4xl font-black tracking-[0.3em] text-rose-200 drop-shadow-[0_0_18px_rgba(255,80,60,0.9)] sm:text-6xl">정전</p>
              <p className="rounded-full bg-black/70 px-3 py-1 text-xs font-bold text-rose-100">아무것도 안 보인다 — 지금은 모두가 움직인다 ({(Math.max(0, snap.flicker.until - snap.t) / 1000).toFixed(1)}초 / {FLICKER_MS / 1000}초)</p>
            </div>
          )}
          {!dark && banner && (
            <div className={`rounded-2xl px-4 py-2 ${banner.tone === "danger" ? "bg-rose-800/90 text-white" : banner.tone === "good" ? "bg-emerald-800/90 text-emerald-50" : "bg-black/80 text-amber-100"}`}>
              <p className="text-lg font-black sm:text-2xl">{banner.text}</p>
              {banner.sub && <p className="mt-0.5 text-[11px] break-keep opacity-90 sm:text-xs">{banner.sub}</p>}
            </div>
          )}
          {showTips && !banner && !dark && <p className="max-w-md rounded-xl bg-black/65 px-3 py-1.5 text-[11px] leading-snug break-keep text-white/85 sm:text-xs">💡 {tip}</p>}
          {sleeping && playing && tipsSeen && <p className="rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/60">…아직은 모두 그냥 마네킹 같다</p>}
        </div>

        {/* 왼쪽 아래: 상태 */}
        {alive && playing && (
          <div className={`pointer-events-none absolute z-20 flex flex-col gap-1 rounded-xl bg-black/55 p-2 ${touch ? "top-[38%] left-2" : "bottom-2 left-2"}`}>
            <Meter icon="🔦" label="손전등 건전지" value={me.battery} color={me.battery < 15 ? "#ef4444" : hud.light ? "#fde68a" : "#6b7280"} warn={me.battery < 15 && me.battery > 0} />
            <Meter icon="🏃" label="달리기 체력" value={hud.stamina} color="#60a5fa" />
            <div className="flex items-center gap-1.5 text-[11px] text-white/85" title="마네킹이 움직이는 삐걱 소리 (누군가 보고 있으면 멈춰서 소리가 안 난다)">
              <span aria-hidden className="w-5 text-center text-sm">
                👂
              </span>
              <span className="tracking-widest" aria-label={`삐걱 소리 ${hud.near}단계`}>
                {[1, 2, 3].map((n) => (
                  <span key={n} className={hud.near >= n ? (hud.near === 3 ? "text-rose-400" : "text-amber-200") : "text-white/20"}>
                    ▮
                  </span>
                ))}
              </span>
              <span className="text-[10px] text-white/50">{hud.near === 0 ? "조용함" : hud.near === 1 ? "멀리서 삐걱…" : hud.near === 2 ? "가깝다" : "바로 옆!"}</span>
            </div>
            <p className="text-[10px] text-white/55">👁 지금 보고 있는 마네킹 {hud.watching}개{!hud.light ? " · 🌑 손전등 꺼짐 (코앞만 보인다)" : ""}</p>
          </div>
        )}

        {/* 오른쪽 아래: 소지품 · 조작 */}
        {alive && playing && !touch && (
          <div className="pointer-events-none absolute right-2 bottom-2 z-20 flex flex-col items-end gap-1 text-[11px] text-white/85">
            <div className="flex gap-1.5 rounded-xl bg-black/55 px-2.5 py-1.5 text-sm">
              <span title="셔터 퓨즈">⚡{me.fuses}</span>
              <span title="일회용 카메라 (Q/클릭: 플래시)">📸{me.cameras}</span>
              <span title="포장 끈 (마네킹 앞에서 E)">🎀{me.ribbons}</span>
            </div>
            <p className="rounded-lg bg-black/45 px-2 py-1 text-right text-[10px] leading-relaxed text-white/60">
              WASD 이동 · Shift 달리기 · 마우스 둘러보기
              <br />E/Space 상호작용 · F 손전등 · Q/클릭 📸 플래시 · M 지도
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
                {me.cameras > 0 && <TouchBtn label="📸" sub={`${me.cameras}`} onDown={doFlash} ariaLabel="플래시 터뜨리기" />}
                <TouchBtn label="🗺️" onDown={() => setMapOpen(true)} ariaLabel="지도" />
                <TouchBtn label="🔦" active={hud.light} onDown={toggleLight} ariaLabel="손전등" />
              </div>
              <TouchBtn label="✋" sub={hud.target ? (hud.target.kind === "search" ? "뒤지기" : hud.target.kind === "panel" ? "꽂기" : hud.target.kind === "bind" ? "묶기" : "풀기") : ""} active={!!hud.target} onDown={pressUse} onUp={releaseUse} big ariaLabel="상호작용" />
            </div>
            <div className="pointer-events-none absolute top-2 left-1/2 z-20 flex -translate-x-1/2 gap-1.5 rounded-xl bg-black/55 px-2.5 py-1 text-sm text-white/85">
              <span>⚡{me.fuses}</span>
              <span>🎀{me.ribbons}</span>
            </div>
          </>
        )}

        {playing && me.st === "down" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[18%] z-20 flex flex-col items-center gap-1 px-3 text-center">
            <p className="text-2xl font-black text-rose-200">몸이 굳어 간다…</p>
            <p className="rounded-full bg-black/70 px-3 py-1 text-xs text-white/85">동료가 다가와 풀어 주길 기다린다 — 남은 시간 {Math.max(0, Math.ceil((BLEED_MS - (snap.t - me.downAt)) / 1000))}초</p>
          </div>
        )}
        {playing && (me.st === "dead" || me.st === "escaped") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[10%] z-20 flex flex-col items-center gap-1 px-3 text-center">
            <p className={`text-xl font-black ${me.st === "escaped" ? "text-emerald-200" : "text-white/70"}`}>{me.st === "escaped" ? "🚪 탈출했다!" : "🧍 영영 마네킹이 되었다"}</p>
            <p className="rounded-full bg-black/70 px-3 py-1 text-xs text-white/80">남은 동료의 눈으로 지켜보는 중 — 화면을 누르면 다른 동료로</p>
          </div>
        )}

        {needPointer && (
          <div className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center gap-2 bg-black/55 text-center">
            <p className="text-lg font-bold text-white">🖱️ 화면을 클릭하면 시작</p>
            <p className="text-xs text-white/70">마우스로 둘러보기 · Esc로 마우스 풀기</p>
          </div>
        )}

        {mapOpen && <MallMap snap={snap} mySeat={mySeat} hud={hud} onClose={() => setMapOpen(false)} />}

        {o && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/88 p-4 text-center">
            <p className={`text-3xl font-black sm:text-5xl ${o.win ? "text-emerald-200" : "text-rose-300"}`}>{o.win ? "셔터 밖으로 나왔다" : o.why === "time" ? "자정 — 셔터가 잠겼다" : "모두 진열대에 섰다"}</p>
            <p className="text-sm text-white/80">
              등급 <b className="text-2xl text-amber-200">{o.grade}</b> · 탈출 {o.escaped}/{snap.seatCount}명 · 매장 시각 {clockText(o.tMs)} ({Math.floor(o.tMs / 60000)}분 {Math.floor((o.tMs % 60000) / 1000)}초)
            </p>
            <div className="w-full max-w-xl overflow-x-auto">
              <table className="w-full text-left text-[11px] text-white/80 sm:text-xs">
                <thead>
                  <tr className="text-white/45">
                    <th className="py-1 pr-2 font-medium">이름</th>
                    <th className="pr-2 font-medium">결과</th>
                    <th className="pr-2 font-medium">⚡ 찾음/꽂음</th>
                    <th className="pr-2 font-medium">👁 응시</th>
                    <th className="pr-2 font-medium">🔦 쓰러뜨림</th>
                    <th className="pr-2 font-medium">✚ 풀어 줌</th>
                    <th className="font-medium">붙잡힘</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.players.map((p) => (
                    <tr key={p.seat} className={p.seat === mySeat ? "font-bold text-white" : ""}>
                      <td className="py-0.5 pr-2">
                        <span style={{ color: SEAT_COLORS[p.seat % 4] }}>{SEAT_SYMBOLS[p.seat % 4]}</span> {p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}
                      </td>
                      <td className="pr-2">{p.st === "escaped" ? "🚪 탈출" : "🧍"}</td>
                      <td className="pr-2 tabular-nums">
                        {p.stats.fuseFound}/{p.stats.fusePlaced}
                      </td>
                      <td className="pr-2 tabular-nums">{Math.round(p.stats.stareSec)}초</td>
                      <td className="pr-2 tabular-nums">{p.stats.topples}</td>
                      <td className="pr-2 tabular-nums">{p.stats.revives}</td>
                      <td className="tabular-nums">{p.stats.downs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              {onRestart && isHost && ended && (
                <button type="button" onClick={onRestart} className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-400">
                  🔁 다시 들어가기
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
