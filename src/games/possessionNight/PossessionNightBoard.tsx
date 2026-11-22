"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { BURN_MS, CURSE_NAMES, DIFFICULTY_INFO, GRACE_MS, ITEM_INFO, ITEM_ORDER, LANTERN_MS, PICK_MS, POSSESS_FEAR, POWERS, POWER_ORDER, REVIVE_MS, SEARCH_MS, SEAT_COLORS, SEAT_SYMBOLS, TIME_LIMIT_MS, clockText, selfWakeMs, type MoveMode, type PowerKind } from "./data";
import { getPossessionNightSound } from "./possessionNightSound";
import { createLocal, reportOf, syncLocal, type LocalBody } from "./localBody";
import { BRAZIER, CELL, COLS, CONTAINERS, KIND, LANTERNS, ROOM, ROOM_NAMES, ROWS, colOf, idx, roomNameAt, rowOf } from "./map";
import { ghostKnown, type SnapBuffer, type Snap } from "./net";
import { canBePossessed, isCurse, powerCheck, type GameEvent, type PlayerAct, type PosReport } from "./sim";
import RulebookModal from "./RulebookModal";
import type { SceneShared } from "./three/HouseScene";

const HouseScene = dynamic(() => import("./three/HouseScene"), { ssr: false, loading: () => null });

/** 내 몸(ref 안의 값)을 꺼낸다 — 이벤트·타이머 안에서만 부른다 */
const bodyOf = (sh: MutableRefObject<SceneShared>): LocalBody => sh.current.local;

/**
 * 빙의의 밤 게임 화면 (룰북 §10~§11): 1인칭 3D 무대 + 역할별 HUD + 조작(키보드·마우스 / 터치) + 알림 + 고택 지도 + 결과.
 * 🧿 퇴마사: 공포·손전등·체력·🔮 영기·소지품, 속삭임 방향. 👻 원귀: 원한(기력)·혼·힘 6가지·퇴마사들의 공포.
 * 소리로 전하는 신호는 모두 글자·색·모양으로도 나온다.
 */

export interface PossessionNightBoardProps {
  snap: Snap;
  buf: SnapBuffer;
  fresh: { events: GameEvent[]; seq: number };
  mySeat: number;
  names: Record<number, string>;
  onReport: (rep: PosReport) => void;
  onAct: (act: PlayerAct) => void;
  ended: boolean;
  canRestart: boolean;
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
const VIEW_KEY = "possession-night:view";
const TIPS_KEY = "possession-night:tips";

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

interface Hud {
  stamina: number;
  mv: MoveMode;
  light: boolean;
  target: { id: string; kind: string; n: number } | null;
  using: boolean;
  useK: number;
  room: string;
  x: number;
  z: number;
  yaw: number;
}

const HUD0: Hud = { stamina: 100, mv: 0, light: true, target: null, using: false, useK: 0, room: "", x: 0, z: 0, yaw: 0 };

interface Toast {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

/** 속삭임이 들린 방향 (내 시선 기준: -π~π, 0 = 앞) */
interface WhisperCue {
  rel: number;
  until: number;
}

/* ── 작은 부품 ──────────────────────────────────────────────────────── */

function Meter({ icon, label, value, color, warn, wide }: { icon: string; label: string; value: number; color: string; warn?: boolean; wide?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span aria-hidden className={`w-5 text-center text-sm ${warn ? "animate-pulse" : ""}`}>
        {icon}
      </span>
      <div className={`h-2 overflow-hidden rounded-full bg-white/10 ${wide ? "w-32 sm:w-40" : "w-24 sm:w-28"}`} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
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
        getPossessionNightSound().play("ui");
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

function TouchBtn({ label, sub, active, dim, onDown, onUp, big, ariaLabel }: { label: ReactNode; sub?: string; active?: boolean; dim?: boolean; onDown: () => void; onUp?: () => void; big?: boolean; ariaLabel: string }) {
  const size = big ? 72 : 52;
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
      className={`flex touch-none flex-col items-center justify-center rounded-full border-2 font-bold text-white select-none ${active ? "border-cyan-200 bg-cyan-400/40" : "border-white/40 bg-black/45"} ${dim ? "opacity-40" : ""}`}
      style={{ width: size, height: size }}
    >
      <span className={big ? "text-2xl leading-none" : "text-lg leading-none"}>{label}</span>
      {sub && <span className="mt-0.5 text-[9px] leading-none text-white/80">{sub}</span>}
    </button>
  );
}

/** 고택 지도 — 퇴마사: 나·동료·뒤진 곳·켠 등잔 / 원귀: 그에 더해 물건이 든 곳과 나 */
function HouseMap({ snap, mySeat, hud, ghostView, ghostPos, names, onClose }: { snap: Snap; mySeat: number; hud: Hud; ghostView: boolean; ghostPos: { x: number; z: number } | null; names: Record<number, string>; onClose: () => void }) {
  const cells = useMemo(() => {
    const out: { c: number; r: number; fill: string }[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = KIND[idx(c, r)];
        if (k === 0) continue;
        const room = ROOM[idx(c, r)];
        out.push({ c, r, fill: k === 4 ? "#1b120d" : k === 5 ? "#2b241c" : k === 6 ? "#7a3d12" : room === "m" ? "#2f3a2c" : room === "." || room === "+" ? "#3a2f24" : "#4a3a29" });
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
  const me = { x: ghostView && ghostPos ? ghostPos.x : hud.x, z: ghostView && ghostPos ? ghostPos.z : hud.z };
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/85 p-3" onClick={onClose}>
      <p className="text-sm font-bold text-amber-100">🗺️ 고택 배치도</p>
      <svg viewBox={`0 0 ${COLS} ${ROWS}`} className="max-h-[78%] w-full max-w-3xl rounded-lg border border-white/15 bg-[#0c0a08]" role="img" aria-label="고택 지도">
        {cells.map((c) => (
          <rect key={`${c.c}-${c.r}`} x={c.c} y={c.r} width={1.02} height={1.02} fill={c.fill} />
        ))}
        {CONTAINERS.map((c) => {
          const curse = ghostView && snap.secret && !snap.searched[c.i] && isCurse(snap.contents[c.i]);
          return (
            <g key={c.i}>
              <rect x={colOf(c.cell) + 0.2} y={rowOf(c.cell) + 0.2} width={0.6} height={0.6} rx={0.1} fill={snap.searched[c.i] ? "#20252b" : curse ? "#d22b2b" : "#c8a86a"} stroke="#0c0f12" strokeWidth={0.05} />
              {snap.searched[c.i] && (
                <text x={colOf(c.cell) + 0.5} y={rowOf(c.cell) + 0.55} fontSize={0.5} textAnchor="middle" dominantBaseline="central" fill="#6b7480">
                  ✓
                </text>
              )}
            </g>
          );
        })}
        {LANTERNS.map((l) => (
          <circle key={l.i} cx={l.x / CELL} cy={l.z / CELL} r={0.22} fill={snap.lanterns[l.i] ? "#ffcf70" : "#3a3a3a"} stroke="#000" strokeWidth={0.04} />
        ))}
        {labels.map((l) => (
          <text key={l.room} x={l.x} y={l.y} fontSize={0.62} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#e8d6b0" opacity={0.75}>
            {ROOM_NAMES[l.room]}
          </text>
        ))}
        <text x={BRAZIER.x / CELL} y={BRAZIER.z / CELL + 0.05} fontSize={0.9} textAnchor="middle" dominantBaseline="central">
          🔥
        </text>
        {snap.ground.map((g) => (
          <text key={g.id} x={g.x / CELL} y={g.z / CELL} fontSize={0.7} textAnchor="middle" dominantBaseline="central">
            🪆
          </text>
        ))}
        {snap.players.map((p) =>
          p.seat === mySeat || p.role === "ghost" ? null : (
            <g key={p.seat}>
              <circle cx={p.x / CELL} cy={p.z / CELL} r={0.36} fill={SEAT_COLORS[p.seat % 6]} stroke={ghostView && p.fear >= POSSESS_FEAR ? "#ff2a2a" : "#000"} strokeWidth={ghostView && p.fear >= POSSESS_FEAR ? 0.14 : 0.06} />
              <text x={p.x / CELL} y={p.z / CELL + 0.03} fontSize={0.42} textAnchor="middle" dominantBaseline="central" fill="#000" fontWeight={800}>
                {p.st === "possessed" ? "👻" : SEAT_SYMBOLS[p.seat % 6]}
              </text>
              {ghostView && (
                <text x={p.x / CELL} y={p.z / CELL - 0.65} fontSize={0.38} textAnchor="middle" fill="#fff" opacity={0.85}>
                  {names[p.seat]?.slice(0, 6)} {Math.round(p.fear)}
                </text>
              )}
            </g>
          ),
        )}
        <g transform={`translate(${me.x / CELL} ${me.z / CELL}) rotate(${(-hud.yaw * 180) / Math.PI})`}>
          <path d="M0,-0.62 L0.42,0.45 L0,0.2 L-0.42,0.45 Z" fill={ghostView ? "#9fe3ff" : "#fff"} stroke="#000" strokeWidth={0.07} />
        </g>
      </svg>
      <p className="text-center text-[11px] text-white/60">
        {ghostView ? "▲ 나(원귀) · 붉은 칸 = 저주받은 물건이 든 곳 · 숫자 = 그 사람의 공포 · 붉은 테 = 빙의할 수 있을 만큼 겁먹음" : "▲ 나 · 금색 칸 = 안 뒤진 곳 · ✓ 뒤진 곳 · ● 등잔(노랑 = 켜짐) · 🔥 화로 — 원귀는 지도에 나오지 않는다"}
        <br />
        아무 곳이나 누르면 닫혀요 (M)
      </p>
    </div>
  );
}

/* ── 본체 ───────────────────────────────────────────────────────────── */

export default function PossessionNightBoard({ snap, buf, fresh, mySeat, names, onReport, onAct, ended, canRestart, onRestart, onLeave, practice, notice }: PossessionNightBoardProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const shared = useRef<SceneShared>(null as unknown as SceneShared);
  if (shared.current === null) shared.current = { buf, local: createLocal(), mySeat, calm: false, fx: { slam: null, water: null, burn: 0, manifest: 0 } };
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
  const [flash, setFlash] = useState<{ tone: "red" | "white" | "blue"; id: number } | null>(null);
  const [whisper, setWhisper] = useState<WhisperCue | null>(null);
  const [tipsSeen, setTipsSeen] = useState(true);
  const toastId = useRef(0);
  const sound = getPossessionNightSound;
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
    try {
      setTipsSeen(window.localStorage.getItem(TIPS_KEY) === "1");
    } catch {
      setTipsSeen(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const me = snap.players[mySeat];
  const ghostView = me?.role === "ghost";
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
  const doWater = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (!p || p.role !== "hunter" || p.st !== "alive") return;
    if (p.water <= 0) {
      sound().play("denied");
      return;
    }
    actRef.current({ k: "water", yaw: bodyOf(shared).yaw, pitch: bodyOf(shared).pitch });
  }, [mySeat, sound]);
  const doTea = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (!p || p.role !== "hunter" || p.st !== "alive") return;
    if (p.tea <= 0) {
      sound().play("denied");
      return;
    }
    actRef.current({ k: "tea" });
  }, [mySeat, sound]);
  const doPower = useCallback(
    (k: PowerKind) => {
      const s = snapRef.current;
      const p = s.players[mySeat];
      if (!p || p.role !== "ghost" || s.phase !== "play") return;
      // 판정 기기(원귀 자신)라면 미리 막아 준다 — 아니면 그냥 보낸다
      if (s.secret) {
        const chk = powerCheck(s, k);
        if (!chk.ok) {
          sound().play("denied");
          toast(`${POWERS[k].emoji} ${POWERS[k].name}: ${chk.why ?? "지금은 안 된다"}`);
          return;
        }
      }
      actRef.current({ k: "power", p: k });
    },
    [mySeat, sound, toast],
  );
  const toggleLight = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (!p || p.role !== "hunter" || p.st !== "alive") return;
    if (p.battery <= 0) {
      sound().play("lightDead");
      return;
    }
    bodyOf(shared).light = !bodyOf(shared).light;
    sound().play(bodyOf(shared).light ? "lightOn" : "lightOff");
  }, [mySeat, sound]);
  const pressUse = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (p?.role === "ghost") {
      doPower("possess");
      return;
    }
    bodyOf(shared).wantUse = true;
  }, [mySeat, doPower]);
  const releaseUse = useCallback(() => {
    bodyOf(shared).wantUse = false;
  }, []);

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
      const ghost = snapRef.current.players[mySeat]?.role === "ghost";
      if (e.code === "KeyE" || e.code === "Space") pressUse();
      else if (e.code === "KeyM" || e.code === "Tab") setMapOpen((v) => !v);
      else if (ghost) {
        const k = POWER_ORDER.find((pk) => POWERS[pk].key === e.key);
        if (k) doPower(k);
      } else if (e.code === "KeyF") toggleLight();
      else if (e.code === "KeyQ") doWater();
      else if (e.code === "KeyR") doTea();
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
  }, [toggleLight, pressUse, releaseUse, doWater, doTea, doPower, mySeat]);

  useEffect(() => {
    if ((overlayOpen || !playing) && document.pointerLockElement) document.exitPointerLock();
  }, [overlayOpen, playing]);

  /* ── 0.1초마다: 판정 기기에 보고 + HUD + 심장·한기 ── */
  useEffect(() => {
    let useId: string | null = null;
    let useStart = 0;
    let beatAt = 0;
    let chillAt = 0;
    const id = window.setInterval(() => {
      const s = snapRef.current;
      const p = s.players[mySeat];
      if (!p) return;
      const now = performance.now();
      const b = bodyOf(shared);
      // 새 판이면 먼저 시작 자리로 맞춘 뒤에 보고한다 (안 그러면 (0,0)을 보고해 벽 속으로 끌려간다)
      syncLocal(b, s, mySeat);
      if (s.phase === "play" && b.seed === s.seed) reportRef.current(reportOf(b));
      if (b.use !== useId) {
        useId = b.use;
        useStart = now;
        if (useId?.[0] === "c") sound().play("rummage");
      } else if (useId?.[0] === "c" && Math.floor((now - useStart) / 560) !== Math.floor((now - 100 - useStart) / 560)) sound().play("rummage");
      const need = useId?.[0] === "b" ? BURN_MS : useId?.[0] === "r" ? REVIVE_MS : useId?.[0] === "l" ? LANTERN_MS : useId?.[0] === "g" ? PICK_MS : SEARCH_MS;
      if (p.role === "hunter" && p.st === "alive" && s.phase === "play") {
        if (p.fear >= 55 && now >= beatAt) {
          beatAt = now + (p.fear >= 90 ? 480 : p.fear >= 75 ? 650 : 880);
          sound().play("beat", p.fear / 100);
        }
        if (p.emf >= 3 && now >= chillAt) {
          chillAt = now + 3200;
          sound().play("chill");
        }
      }
      const tgt = b.target;
      setHud({
        stamina: b.stamina,
        mv: b.mv,
        light: b.light && p.battery > 0 && s.t >= p.lightOffUntil,
        target: tgt ? { id: tgt.id, kind: tgt.kind, n: tgt.n } : null,
        using: useId !== null,
        useK: useId ? Math.min(1, (now - useStart) / need) : 0,
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
    const ghost = s.players[mySeat]?.role === "ghost";
    const nm = (seat?: number) => (seat === mySeat ? "나" : (namesRef.current[seat ?? -1] ?? "누군가"));
    const b = bodyOf(shared);
    const volAt = (x?: number, z?: number, reach = 26) => (x === undefined || z === undefined ? 0.5 : Math.max(0.05, 1 - Math.hypot(x - b.x, z - b.z) / reach));
    for (const e of fresh.events) {
      if (e.to !== undefined && e.to !== mySeat && !(ghost && e.k === "whisper")) continue;
      const mine = e.seat === mySeat;
      switch (e.k) {
        case "found": {
          const v = e.n ?? 0;
          const curse = isCurse(v);
          const kind = curse ? "curse" : (ITEM_ORDER[v] ?? "empty");
          const info = ITEM_INFO[kind];
          if (mine) {
            sound().play(kind === "curse" ? "curse" : kind === "water" ? "waterFound" : kind === "tea" ? "teaFound" : kind === "battery" ? "battery" : "empty");
            toast(kind === "empty" ? "🕸️ 아무것도 없다" : curse ? `🪆 ${CURSE_NAMES[v - 100] ?? "저주받은 물건"}을(를) 찾았다 — 마당 화로로!` : `${info.emoji} ${info.name} — ${info.desc}`, kind === "empty" ? "info" : curse ? "bad" : "good");
          } else if (curse) toast(`🪆 ${nm(e.seat)}이(가) ${CURSE_NAMES[v - 100] ?? "저주받은 물건"}을(를) 찾았다`, ghost ? "bad" : "good");
          break;
        }
        case "full":
          if (mine) {
            sound().play("full");
            toast("더 들 수 없다 — 그대로 두었다");
          }
          break;
        case "burn":
          sound().play("burn", e.x ?? 1);
          shared.current.fx.burn = performance.now();
          showBanner(`🔥 ${CURSE_NAMES[e.n ?? 0] ?? "물건"} — 태웠다 ${e.x}/${s.need}`, ghost ? "danger" : "good", (e.x ?? 0) >= s.need ? "모두 태웠다 — 이제 화로 곁에서 퇴마 의식!" : `${nm(e.seat)}이(가) 화로에 던졌다`, 2800);
          break;
        case "ritualStart":
          sound().play("ritualStart");
          window.setTimeout(() => showBanner("🔥 퇴마 의식이 시작됐다", ghost ? "danger" : "good", ghost ? "화로 6m 안에서 🌫️ 불길 꺾기(5) — 의식을 막아라!" : "화로 3.5m 안에 서 있으면 차오른다 — 여럿이 설수록 빠르다", 4500), 900);
          break;
        case "ritualDone":
          break;
        case "lantern":
          sound().play("lantern");
          if (mine) toast("🏮 등잔을 켰다 — 이 방에선 공포가 가라앉는다", "good");
          break;
        case "pick":
          sound().play("pick");
          if (mine) toast(`🪆 ${CURSE_NAMES[e.n ?? 0] ?? "물건"}을(를) 주웠다`, "good");
          break;
        case "drop":
          if (!ghost) toast(`🪆 ${nm(e.seat)}이(가) 물건을 떨어뜨렸다 — 그 자리에서 주울 수 있다`, "bad");
          break;
        case "water":
          sound().play("water");
          shared.current.fx.water = { x: e.x ?? 0, z: e.z ?? 0, at: performance.now() };
          if (mine && !e.n) toast("💧 …허공에 뿌렸다");
          break;
        case "ghostHit":
          sound().play("ghostHit");
          if (ghost) {
            setFlash({ tone: "blue", id: e.id });
            showBanner("💧 성수에 맞았다!", "danger", "4초 동안 묶이고 모습이 드러난다 · 원한 -25", 2600);
          } else toast(`💧 ${mine ? "" : `${nm(e.seat)}의 `}성수가 원귀를 적셨다! 지금 보인다`, "good");
          break;
        case "tea":
          if (mine) {
            sound().play("tea");
            toast("🍵 청심환 — 마음이 가라앉는다", "good");
          }
          break;
        case "panic":
          if (mine) {
            sound().play("panic");
            showBanner("😱 공황!", "danger", "달릴 수 없고 손전등이 떨린다 — 동료가 곁에 있어도 빙의당할 수 있다. 🍵 청심환이나 등잔·동료 곁으로", 3500);
          } else if (ghost) toast(`😱 ${nm(e.seat)} 공황 — 원한 +12, 지금 씔 수 있다`, "good");
          break;
        case "calm":
          if (mine) sound().play("calm");
          break;
        case "possess":
          if (mine) {
            b.scareUntil = performance.now() + 1100;
            b.scareAt = ghostKnown(s) ? { x: s.ghost.x, z: s.ghost.z } : null;
            b.shake = 1;
            sound().play(viewRef.current.calm ? "possessFar" : "possessMe", 0.6);
            setFlash({ tone: "red", id: e.id });
          } else {
            sound().play("possessFar", volAt(e.x, e.z, 34));
            toast(ghost ? `👻 ${nm(e.seat)}에게 씌었다 — 혼 ${s.souls}/${s.soulsNeed}` : `👻 ${nm(e.seat)}이(가) 빙의됐다! 다가가 퇴마해 주세요 (혼 ${s.souls}/${s.soulsNeed})`, ghost ? "good" : "bad");
          }
          break;
        case "revive":
          sound().play("revive");
          toast(e.n === -1 ? `${nm(e.seat)}이(가) 스스로 깨어났다` : mine ? `${nm(e.n)}이(가) 나를 퇴마해 줬다` : `${nm(e.n)}이(가) ${nm(e.seat)}을(를) 퇴마했다`, ghost ? "bad" : "good");
          break;
        case "whisper": {
          if (ghost) {
            sound().play("whisper");
            toast(`🗣️ ${nm(e.seat)}의 귓가에 속삭였다`);
            break;
          }
          // 나에게만 들린다 — 들린 방향 표시
          sound().play("whisper");
          if (e.x !== undefined && e.z !== undefined) {
            const want = Math.atan2(-(e.x - b.x), -(e.z - b.z));
            let rel = want - b.yaw;
            while (rel > Math.PI) rel -= Math.PI * 2;
            while (rel < -Math.PI) rel += Math.PI * 2;
            setWhisper({ rel, until: performance.now() + 2600 });
            window.setTimeout(() => setWhisper((w) => (w && w.until <= performance.now() + 30 ? null : w)), 2640);
          }
          break;
        }
        case "slam":
          sound().play("slam", volAt(e.x, e.z, 22));
          shared.current.fx.slam = { x: e.x ?? 0, z: e.z ?? 0, at: performance.now() };
          if (!ghost && Math.hypot((e.x ?? 0) - b.x, (e.z ?? 0) - b.z) < 10) toast(`💥 ${roomNameAt(e.x ?? 0, e.z ?? 0) || "어딘가"}에서 무언가 덜컹!`, "bad");
          break;
        case "snuff":
          if (e.n === -2) {
            sound().play("lightDead");
            toast("🕯️ 손전등이 픽 꺼졌다… (6초)", "bad");
          } else if (e.n !== undefined && e.n >= 0) {
            sound().play("snuff", volAt(e.x, e.z, 20));
            if (!ghost) toast(`🕯️ ${ROOM_NAMES[LANTERNS[e.n]?.room ?? ""] ?? ""} 등잔이 꺼졌다`, "bad");
          } else if (ghost) sound().play("snuff", 0.5);
          break;
        case "manifest":
          sound().play("manifest", ghost ? 0.5 : volAt(e.x, e.z, 22));
          shared.current.fx.manifest = performance.now();
          if (!ghost && Math.hypot((e.x ?? 0) - b.x, (e.z ?? 0) - b.z) < 14) setFlash({ tone: "white", id: e.id });
          break;
        case "quench":
          sound().play("quench");
          showBanner("🌫️ 불길이 꺾였다", ghost ? "good" : "danger", `퇴마 의식 ${e.n}%`, 2200);
          break;
        case "fail":
          if (ghost) sound().play("denied");
          break;
        case "awaken":
          sound().play("awaken");
          if (ghost) showBanner("👻 원한이 깨어났다", "warn", "이제 힘을 쓸 수 있다 — 1 속삭임 · 2 덜컹 · 3 소등 · 4 현신 · E 빙의", 4000);
          else toast("…어디선가 차가운 바람이 분다. 무언가 깨어났다", "bad");
          break;
        case "lastMinute":
          sound().play("lastMinute");
          showBanner("🐓 첫닭까지 1분", ghost ? "good" : "danger", ghost ? "버티면 이긴다" : "닭이 울면 원귀가 이긴다", 3500);
          break;
        case "over":
          sound().play((e.n === 1) !== ghost ? "victory" : "defeat");
          break;
      }
    }
  }, [fresh, mySeat, sound, toast, showBanner]);

  /* ── BGM ── */
  const danger = !me ? 0 : ghostView ? (snap.ritual >= 0 ? 2 : snap.players.some((p) => p.role === "hunter" && p.st === "alive" && p.fear >= POSSESS_FEAR) ? 1 : 0) : me.st === "possessed" || me.panic || snap.ritual >= 0 ? 2 : me.emf >= 2 || me.fear >= 60 ? 1 : 0;
  useSuiteBgm(sound, playing, playing ? danger : 0);

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

  const info = DIFFICULTY_INFO[snap.options.difficulty];
  const g = snap.ghost;
  const timeLeft = Math.max(0, TIME_LIMIT_MS - snap.t);
  const grace = snap.t < GRACE_MS;
  const stunned = ghostView && snap.t < g.stunUntil;
  const seen = ghostView && snap.ghostVis > 0;
  const carried = snap.players.reduce((n, p) => n + p.carry.length, 0);
  const objective = ghostView
    ? snap.ritual >= 0
      ? `🌫️ 퇴마 의식 ${Math.round(snap.ritual)}% — 화로 6m 안에서 5 불길 꺾기, 의식하는 사람에게 겁주기`
      : `👻 혼 ${snap.souls}/${snap.soulsNeed} — 겁에 질려(공포 ${POSSESS_FEAR}↑) 혼자 남은 사람 곁에서 E 빙의 · 첫닭까지 버텨도 승리`
    : snap.ritual >= 0
      ? `🔥 퇴마 의식 ${Math.round(snap.ritual)}% — 화로 곁(3.5m)에 함께 서라!`
      : me.carry.length > 0
        ? `🪆 ${me.carry.map((c) => CURSE_NAMES[c]).join(", ")} — 마당 화로에서 E로 태워라`
        : `🪆 저주받은 물건 찾기 — 반닫이·항아리를 뒤져라 (태운 것 ${snap.burned}/${snap.need}${carried > 0 ? ` · 동료가 ${carried}개 들고 있음` : ""})`;
  const tg = hud.target;
  const prompt = ghostView || !alive || !tg ? null : tg.kind === "search" ? "뒤지기 (누르고 있기)" : tg.kind === "burn" ? "🔥 화로에 태우기 (누르고 있기)" : tg.kind === "lantern" ? "🏮 등잔 켜기 (누르고 있기)" : tg.kind === "revive" ? `👻 ${names[tg.n] ?? "동료"} 퇴마하기 (누르고 있기)` : "🪆 떨어진 물건 줍기";
  const possessable = ghostView && snap.secret ? powerCheck(snap, "possess") : null;
  const showTips = !tipsSeen && playing && snap.t < 45_000;
  const tip = ghostView
    ? snap.t < 15_000
      ? "나는 원귀다. 벽을 뚫고 떠다니며 퇴마사들을 본다 — 붉게 빛날수록 겁먹은 사람"
      : snap.t < 28_000
        ? "1 속삭임·2 덜컹·3 소등·4 현신으로 공포를 키워라. 손전등 빛·켜진 등잔 안에선 희미하게 보인다"
        : "공포 75↑에 6m 안에 동료가 없거나, 공황(100)이면 2.2m 안에서 E 빙의. 화로 결계 안엔 못 들어간다"
    : snap.t < 12_000
      ? "이 고택에 원귀가 있다 — 원귀는 보이지 않는다. 반닫이·항아리를 뒤져 🪆 저주받은 물건을 찾자"
      : snap.t < 26_000
        ? "혼자 어두운 곳에 있으면 공포가 찬다. 동료 곁·켜진 등잔·달빛 마당에선 가라앉는다"
        : "🔮 영기가 오르면 원귀가 가깝다. 속삭임이 들린 쪽으로 Q 💧 성수를 뿌리면 묶인다";
  const needPointer = !touch && playing && !locked && !overlayOpen;
  const o = snap.outcome;
  const won = !!o && o.winner === me.role;
  const myGhostPos = ghostView ? { x: hud.x, z: hud.z } : null;

  return (
    <div className="flex flex-col gap-2">
      <style>{`@keyframes pn-flash{0%{opacity:.95}100%{opacity:0}}@keyframes pn-pulse{0%,100%{opacity:.5}50%{opacity:1}}@keyframes pn-wobble{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}`}</style>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded-full border px-2.5 py-1 font-semibold ${ghostView ? "border-cyan-300/50 bg-cyan-500/15 text-cyan-100" : "border-amber-300/40 bg-amber-500/10 text-amber-100"}`}>{ghostView ? "👻 나는 원귀" : "🧿 나는 퇴마사"}</span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-semibold text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
          {info.emoji} {info.label} · 🔥 {snap.burned}/{snap.need} · 👻 혼 {snap.souls}/{snap.soulsNeed}
        </span>
        <span className={`rounded-full border px-2.5 py-1 font-semibold tabular-nums ${timeLeft < 60_000 ? "border-rose-400/60 bg-rose-500/15 text-rose-200" : "border-white/10 bg-white/[0.04] text-white/80 light:border-slate-200 light:bg-white light:text-slate-700"}`} title="첫닭이 울면(새벽 5시) 원귀 승리">
          🕒 {clockText(snap.t)}
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
          🔇 소리가 꺼져 있어요 — 속삭임·덜컹 소리를 들으면 훨씬 무섭고 유리해요 (화면 글자·방향 표시로도 나와요). 눌러서 소리 켜기 🔊
        </button>
      )}

      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black select-none light:border-slate-300 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[68svh] min-h-[360px]" : "aspect-[16/9] max-h-[78vh]"}`}
        onClick={() => {
          if (touch || overlayOpen || !playing) return;
          if (document.pointerLockElement !== stageRef.current) void stageRef.current?.requestPointerLock?.();
          else if (ghostView) doPower("possess");
          else doWater();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="absolute inset-0"
          style={{
            filter: ghostView ? `saturate(0.55) hue-rotate(${stunned ? 0 : 160}deg) brightness(${stunned ? 0.6 : 1.05})` : me.st === "possessed" ? "grayscale(0.9) brightness(0.7) contrast(1.2) hue-rotate(180deg)" : me.panic ? "saturate(1.4) contrast(1.15)" : undefined,
          }}
        >
          {canGl ? <HouseScene shared={shared} names={names} seatCount={snap.seatCount} ghostSeat={snap.ghostSeat} quality={quality} onFps={(f) => f < 26 && setLowFps(true)} /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">이 기기는 3D(WebGL)를 지원하지 않아 플레이할 수 없어요.</div>}
        </div>

        <div className="pointer-events-none absolute inset-0 z-10" style={{ background: ghostView ? "radial-gradient(ellipse at center, transparent 55%, rgba(0,30,50,0.6) 100%)" : "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.7) 100%)" }} />
        {!ghostView && alive && me.fear >= 50 && <div className="pointer-events-none absolute inset-0 z-10" style={{ boxShadow: `inset 0 0 ${60 + me.fear * 1.2}px rgba(150,20,30,${0.12 + (me.fear - 50) * 0.008})`, animation: `pn-pulse ${me.panic ? 0.45 : 1}s ease-in-out infinite` }} />}
        {flash && <div key={flash.id} className="pointer-events-none absolute inset-0 z-30" style={{ background: flash.tone === "red" ? (view.calm ? "rgba(120,0,0,0.45)" : "rgba(170,0,10,0.9)") : flash.tone === "blue" ? "rgba(140,210,255,0.6)" : view.calm ? "rgba(255,255,255,0.3)" : "rgba(235,245,255,0.85)", animation: "pn-flash 0.9s ease-out forwards" }} />}

        {/* 속삭임 방향 */}
        {whisper && !ghostView && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="relative h-56 w-56" style={{ transform: `rotate(${(-whisper.rel * 180) / Math.PI}deg)` }}>
              <span className="absolute top-0 left-1/2 -translate-x-1/2 text-3xl text-cyan-100 drop-shadow-[0_0_10px_rgba(160,230,255,0.9)]" style={{ animation: "pn-pulse 0.5s ease-in-out infinite" }}>
                ▲
              </span>
            </div>
            <p className="absolute top-[64%] rounded-full bg-black/70 px-3 py-1 text-xs font-bold text-cyan-100" style={{ animation: "pn-wobble 0.3s linear infinite" }}>
              🗣️ …누군가 귓가에 속삭인다 ({Math.abs(whisper.rel) < 0.6 ? "앞" : Math.abs(whisper.rel) > 2.5 ? "뒤" : whisper.rel > 0 ? "왼쪽" : "오른쪽"})
            </p>
          </div>
        )}

        {/* 조준점 + 상호작용 */}
        {playing && (alive || ghostView) && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
            <div className={`h-1.5 w-1.5 rounded-full ${tg || possessable?.ok ? "bg-cyan-200" : "bg-white/50"}`} />
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
            {ghostView && possessable?.ok && possessable.target !== undefined && (
              <span className="mt-4 animate-pulse rounded-full bg-cyan-900/80 px-3 py-1 text-xs font-bold text-cyan-50">
                {!touch && <kbd className="mr-1.5 rounded border border-cyan-200/60 px-1 text-[10px]">E</kbd>}👻 {names[possessable.target] ?? "퇴마사"}에게 빙의할 수 있다!
              </span>
            )}
          </div>
        )}

        {/* 왼쪽 위: 목표 · 사람들 */}
        <div className="pointer-events-none absolute top-2 left-2 z-20 flex max-w-[62%] flex-col gap-1.5">
          {playing && <p className="rounded-lg bg-black/60 px-2.5 py-1.5 text-[11px] leading-snug font-semibold break-keep text-amber-50 sm:text-xs">{objective}</p>}
          {playing && hud.room && <p className="w-fit rounded bg-black/45 px-2 py-0.5 text-[10px] text-white/60">📍 {hud.room}</p>}
          <div className="flex flex-col gap-1">
            {snap.players.map((p) =>
              p.seat === mySeat || p.role === "ghost" ? null : (
                <p key={p.seat} className="flex w-fit items-center gap-1.5 rounded bg-black/55 px-2 py-0.5 text-[11px] text-white/85">
                  <span aria-hidden style={{ color: SEAT_COLORS[p.seat % 6] }}>
                    {SEAT_SYMBOLS[p.seat % 6]}
                  </span>
                  <span className="max-w-[7rem] truncate">{names[p.seat] ?? `${p.seat + 1}번`}</span>
                  {(p.bot || p.away) && <span className="text-[9px] text-white/40">🤖</span>}
                  {p.st === "possessed" ? (
                    <span className="text-cyan-200">👻 빙의 {Math.max(0, Math.ceil((selfWakeMs(snap.seatCount - 1) - (snap.t - p.downAt)) / 1000))}초</span>
                  ) : (
                    <>
                      <span className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-white/15" aria-label={`공포 ${Math.round(p.fear)}`}>
                        <span className="block h-full" style={{ width: `${p.fear}%`, background: p.fear >= POSSESS_FEAR ? "#f43f5e" : p.fear >= 50 ? "#f59e0b" : "#a3e635" }} />
                      </span>
                      {p.panic && <span>😱</span>}
                      {p.carry.length > 0 && <span>🪆{p.carry.length}</span>}
                      {!ghostView && <span className="text-white/50">🔮{p.emf}</span>}
                      {ghostView && canBePossessed(snap, p) && <span className="text-rose-300">씔 수 있음</span>}
                    </>
                  )}
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

        {/* 가운데 위: 배너 · 의식 · 도움말 */}
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex flex-col items-center gap-2 px-3 text-center">
          {snap.ritual >= 0 && playing && (
            <div className="w-64 max-w-[80%]">
              <p className="text-[11px] font-bold text-amber-100">🔥 퇴마 의식 {Math.round(snap.ritual)}%</p>
              <div className="mt-0.5 h-2.5 overflow-hidden rounded-full bg-white/15">
                <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-200 transition-[width] duration-200" style={{ width: `${snap.ritual}%` }} />
              </div>
            </div>
          )}
          {banner && (
            <div className={`rounded-2xl px-4 py-2 ${banner.tone === "danger" ? "bg-rose-800/90 text-white" : banner.tone === "good" ? "bg-emerald-800/90 text-emerald-50" : "bg-black/80 text-amber-100"}`}>
              <p className="text-lg font-black sm:text-2xl">{banner.text}</p>
              {banner.sub && <p className="mt-0.5 text-[11px] break-keep opacity-90 sm:text-xs">{banner.sub}</p>}
            </div>
          )}
          {stunned && <p className="rounded-full bg-sky-900/85 px-3 py-1 text-xs font-bold text-sky-100">💧 성수에 묶였다 — {((g.stunUntil - snap.t) / 1000).toFixed(1)}초</p>}
          {seen && playing && !stunned && <p className="rounded-full bg-rose-900/80 px-3 py-1 text-[11px] font-bold text-rose-100">👁 지금 {snap.ghostVis === 2 ? "모습이 다 드러났다" : "희미하게 보인다 (손전등·등잔 빛)"}</p>}
          {showTips && !banner && <p className="max-w-md rounded-xl bg-black/65 px-3 py-1.5 text-[11px] leading-snug break-keep text-white/85 sm:text-xs">💡 {tip}</p>}
          {grace && playing && tipsSeen && <p className="rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/60">{ghostView ? `원한이 깨어나기까지 ${Math.ceil((GRACE_MS - snap.t) / 1000)}초` : "…아직은 조용하다"}</p>}
        </div>

        {/* 왼쪽 아래: 상태 */}
        {playing && !ghostView && alive && (
          <div className={`pointer-events-none absolute z-20 flex flex-col gap-1 rounded-xl bg-black/55 p-2 ${touch ? "top-[38%] left-2" : "bottom-2 left-2"}`}>
            <Meter icon={me.panic ? "😱" : "💓"} label="공포" value={me.fear} wide color={me.fear >= POSSESS_FEAR ? "#f43f5e" : me.fear >= 50 ? "#f59e0b" : "#a3e635"} warn={me.fear >= POSSESS_FEAR} />
            <Meter icon="🔦" label="손전등 건전지" value={me.battery} color={me.battery < 15 ? "#ef4444" : hud.light ? "#fde68a" : "#6b7280"} warn={me.battery < 15 && me.battery > 0} />
            <Meter icon="🏃" label="달리기 체력" value={hud.stamina} color={me.panic ? "#6b7280" : "#60a5fa"} />
            <div className="flex items-center gap-1.5 text-[11px] text-white/85" title="영기 탐지기: 원귀까지 4m / 8m / 14m">
              <span aria-hidden className="w-5 text-center text-sm">
                🔮
              </span>
              <span className="tracking-widest" aria-label={`영기 ${me.emf}단계`}>
                {[1, 2, 3].map((n) => (
                  <span key={n} className={me.emf >= n ? (me.emf === 3 ? "text-rose-400" : "text-cyan-200") : "text-white/20"}>
                    ▮
                  </span>
                ))}
              </span>
              <span className="text-[10px] text-white/50">{me.emf === 0 ? "조용함" : me.emf === 1 ? "멀리서 기척" : me.emf === 2 ? "가깝다" : "바로 곁! (입김이 보인다)"}</span>
            </div>
            <p className="text-[10px] text-white/55">{!hud.light ? (snap.t < me.lightOffUntil ? "🕯️ 원귀가 손전등을 꺼뜨렸다" : "🌑 손전등 꺼짐") : me.fear >= POSSESS_FEAR ? "⚠️ 혼자 있으면 빙의당한다!" : "동료 곁·등잔·마당에선 공포가 가라앉는다"}</p>
          </div>
        )}
        {playing && ghostView && (
          <div className={`pointer-events-none absolute z-20 flex flex-col gap-1 rounded-xl bg-black/55 p-2 ${touch ? "top-[38%] left-2" : "bottom-2 left-2"}`}>
            <Meter icon="🌑" label="원한 (기력)" value={g.energy} wide color="#7dd3fc" />
            <p className="text-[10px] text-white/60">👻 혼 {snap.souls}/{snap.soulsNeed} · 화로 결계엔 못 들어간다</p>
          </div>
        )}

        {/* 오른쪽 아래: 소지품·힘 (데스크톱) */}
        {playing && !touch && !ghostView && alive && (
          <div className="pointer-events-none absolute right-2 bottom-2 z-20 flex flex-col items-end gap-1 text-[11px] text-white/85">
            <div className="flex gap-1.5 rounded-xl bg-black/55 px-2.5 py-1.5 text-sm">
              <span title="저주받은 물건">🪆{me.carry.length}</span>
              <span title="성수 (Q/클릭)">💧{me.water}</span>
              <span title="청심환 (R)">🍵{me.tea}</span>
            </div>
            <p className="rounded-lg bg-black/45 px-2 py-1 text-right text-[10px] leading-relaxed text-white/60">
              WASD 이동 · Shift 달리기 · 마우스 둘러보기
              <br />E/Space 상호작용 · F 손전등 · Q/클릭 💧 성수 · R 🍵 · M 지도
            </p>
          </div>
        )}
        {playing && ghostView && (
          <div className={`absolute right-2 z-20 flex max-w-[60%] flex-wrap justify-end gap-1.5 ${touch ? "bottom-3" : "bottom-2"}`}>
            {POWER_ORDER.filter((k) => k !== "quench" || snap.ritual >= 0).map((k) => {
              const pi = POWERS[k];
              const chk = snap.secret ? powerCheck(snap, k) : { ok: true };
              const cd = Math.max(0, g.ready[k] - snap.t);
              return (
                <button
                  key={k}
                  type="button"
                  title={`${pi.name} (${pi.key}) — 원한 ${pi.cost}: ${pi.desc}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    doPower(k);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={`flex min-w-[52px] flex-col items-center rounded-xl border px-1.5 py-1 text-white select-none ${chk.ok ? "border-cyan-300/70 bg-cyan-500/25" : "border-white/15 bg-black/55 opacity-60"}`}
                >
                  <span className="text-lg leading-none">{pi.emoji}</span>
                  <span className="text-[9px] leading-tight">{pi.name}</span>
                  <span className="text-[9px] text-white/60 tabular-nums">{cd > 0 ? `${Math.ceil(cd / 1000)}s` : `${!touch ? `${pi.key}·` : ""}${pi.cost}`}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 터치 조작 */}
        {touch && playing && !overlayOpen && (alive || ghostView) && (
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
            {!ghostView && (
              <div className="absolute right-2 bottom-3 z-20 flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <TouchBtn label="💧" sub={`${me.water}`} dim={me.water <= 0} onDown={doWater} ariaLabel="성수 뿌리기" />
                  <TouchBtn label="🍵" sub={`${me.tea}`} dim={me.tea <= 0} onDown={doTea} ariaLabel="청심환 먹기" />
                  <TouchBtn label="🔦" active={hud.light} onDown={toggleLight} ariaLabel="손전등" />
                  <TouchBtn label="🗺️" onDown={() => setMapOpen(true)} ariaLabel="지도" />
                </div>
                <TouchBtn label="✋" sub={tg ? (tg.kind === "search" ? "뒤지기" : tg.kind === "burn" ? "태우기" : tg.kind === "lantern" ? "등잔" : tg.kind === "revive" ? "퇴마" : "줍기") : ""} active={!!tg} onDown={pressUse} onUp={releaseUse} big ariaLabel="상호작용" />
              </div>
            )}
            {ghostView && (
              <div className="absolute top-[38%] right-2 z-20">
                <TouchBtn label="🗺️" onDown={() => setMapOpen(true)} ariaLabel="지도" />
              </div>
            )}
          </>
        )}

        {playing && !ghostView && me.st === "possessed" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[18%] z-20 flex flex-col items-center gap-1 px-3 text-center">
            <p className="text-2xl font-black text-cyan-100">👻 빙의됐다…</p>
            <p className="rounded-full bg-black/70 px-3 py-1 text-xs text-white/85">몸이 내 것이 아니다 — 동료가 다가와 퇴마해 주거나, {Math.max(0, Math.ceil((selfWakeMs(snap.seatCount - 1) - (snap.t - me.downAt)) / 1000))}초 뒤 스스로 깨어난다</p>
          </div>
        )}

        {needPointer && (
          <div className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center gap-2 bg-black/55 text-center">
            <p className="text-lg font-bold text-white">🖱️ 화면을 클릭하면 시작</p>
            <p className="text-xs text-white/70">{ghostView ? "마우스로 둘러보기 · 1~5 힘 · E/클릭 빙의 · Esc로 마우스 풀기" : "마우스로 둘러보기 · Esc로 마우스 풀기"}</p>
          </div>
        )}

        {mapOpen && <HouseMap snap={snap} mySeat={mySeat} hud={hud} ghostView={ghostView} ghostPos={myGhostPos} names={names} onClose={() => setMapOpen(false)} />}

        {o && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/88 p-4 text-center">
            <p className={`text-3xl font-black sm:text-5xl ${won ? "text-emerald-200" : "text-rose-300"}`}>{o.winner === "hunter" ? "🔥 퇴마 성공 — 원귀가 흩어졌다" : o.why === "dawn" ? "🐓 첫닭이 울었다 — 원귀가 고택에 남았다" : "👻 혼을 모두 빼앗겼다"}</p>
            <p className="text-sm text-white/80">
              {won ? "승리!" : "패배"} · 🔥 태운 물건 {o.burned}/{snap.need} · 👻 혼 {snap.souls}/{snap.soulsNeed} · {clockText(o.tMs)} ({Math.floor(o.tMs / 60000)}분 {Math.floor((o.tMs % 60000) / 1000)}초)
            </p>
            <div className="w-full max-w-xl overflow-x-auto">
              <table className="w-full text-left text-[11px] text-white/80 sm:text-xs">
                <thead>
                  <tr className="text-white/45">
                    <th className="py-1 pr-2 font-medium">이름</th>
                    <th className="pr-2 font-medium">역할</th>
                    <th className="pr-2 font-medium">🪆 찾음/태움</th>
                    <th className="pr-2 font-medium">💧 맞힘</th>
                    <th className="pr-2 font-medium">✚ 퇴마</th>
                    <th className="font-medium">👻 빙의</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.players.map((p) => (
                    <tr key={p.seat} className={p.seat === mySeat ? "font-bold text-white" : ""}>
                      <td className="py-0.5 pr-2">
                        <span style={{ color: SEAT_COLORS[p.seat % 6] }}>{SEAT_SYMBOLS[p.seat % 6]}</span> {p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}
                      </td>
                      <td className="pr-2">{p.role === "ghost" ? "👻 원귀" : "🧿 퇴마사"}</td>
                      {p.role === "ghost" ? (
                        <td className="pr-2 text-white/60" colSpan={3}>
                          🗣️{p.ghost.whispers} 💥{p.ghost.slams} 🕯️{p.ghost.snuffs} 👁️{p.ghost.manifests} · 성수 {p.ghost.hits}번 맞음
                        </td>
                      ) : (
                        <>
                          <td className="pr-2 tabular-nums">
                            {p.hunter.cursesFound}/{p.hunter.burned}
                          </td>
                          <td className="pr-2 tabular-nums">
                            {p.hunter.waterHits}/{p.hunter.waters}
                          </td>
                          <td className="pr-2 tabular-nums">{p.hunter.revives}</td>
                        </>
                      )}
                      <td className="tabular-nums">{p.role === "ghost" ? `${p.ghost.possessions}번 씀` : `${p.hunter.possessed}번 당함`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              {onRestart && canRestart && ended && (
                <button type="button" onClick={onRestart} className="rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400">
                  🔁 한 판 더
                </button>
              )}
              <button type="button" onClick={onLeave} className="rounded-full border border-white/25 px-5 py-2 text-sm text-white/80 hover:border-white/50">
                나가기
              </button>
            </div>
            {!canRestart && ended && <p className="text-[11px] text-white/45">판정하던 사람이 다시 시작하면 바로 이어져요.</p>}
            {practice && <p className="text-[11px] text-white/45">혼자 하기 기록도 내 기록에 남아요.</p>}
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
