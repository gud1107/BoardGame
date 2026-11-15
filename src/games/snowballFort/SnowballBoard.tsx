"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import {
  AMMO_MAX,
  BLIZZARD_AT_MS,
  CHARGE_MS,
  DASH_CD_MS,
  ITEM_INFO,
  ROUND_MS,
  SEAT_SCARF,
  TEAM_COLORS,
  TEAM_EMOJI,
  TEAM_NAMES,
  TEAM_SYMBOLS,
  WALL_COST,
  chargeForRange,
} from "./data";
import type { Snap, SnapBuffer } from "./net";
import { ammoMax, isFrozen, type GameEvent, type PlayerInput } from "./sim";
import { getSnowballSound } from "./snowballSound";
import Field2D from "./Field2D";
import RulebookModal from "./RulebookModal";
import type { FxItem, SceneShared } from "./three/FieldScene";

const FieldScene = dynamic(() => import("./three/FieldScene"), { ssr: false, loading: () => null });

/**
 * 눈싸움 요새전 게임 화면 (룰북 §9~§11): 3D/2D 무대 + 이름표 + HUD + 조작(키보드·마우스·터치) +
 * 라운드/최종 결과. 방장이든 손님이든 같은 스냅샷 버퍼를 그린다.
 */

export interface SnowballBoardProps {
  snap: Snap;
  buf: SnapBuffer;
  fresh: { events: GameEvent[]; seq: number };
  mySeat: number;
  names: Record<number, string>;
  onInput: (inp: PlayerInput) => void;
  ended: boolean;
  isHost: boolean;
  onRestart?: () => void;
  onLeave: () => void;
  practice?: boolean;
  notice?: string | null;
}

type ViewMode = "3d" | "2d";
type Quality = "auto" | "high" | "low";
const VIEW_KEY = "snowball-fort:view";

function loadView(): { mode: ViewMode; quality: Quality } {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "{}");
    return { mode: v.mode === "2d" ? "2d" : "3d", quality: v.quality === "high" || v.quality === "low" ? v.quality : "auto" };
  } catch {
    return { mode: "3d", quality: "auto" };
  }
}
function saveView(v: { mode: ViewMode; quality: Quality }) {
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

/* ── 입력 ───────────────────────────────────────────────────────────── */

/** 장면과 나누는 객체에 쓰기 (React Compiler가 훅 인자 수정을 막아서 바깥 함수로) */
function setPreview(sh: React.MutableRefObject<SceneShared>, v: SceneShared["preview"]) {
  sh.current.preview = v;
}
function setShake(sh: React.MutableRefObject<SceneShared>, v: number) {
  sh.current.shake = Math.max(sh.current.shake, v);
}
function setEnv(env: React.MutableRefObject<ControlEnv>, v: ControlEnv) {
  env.current = v;
}
function syncShared(sh: React.MutableRefObject<SceneShared>, buf: SnapBuffer, mySeat: number) {
  sh.current.buf = buf;
  sh.current.mySeat = mySeat;
}
function setLabel(sh: React.MutableRefObject<SceneShared>, seat: number, el: HTMLDivElement | null) {
  sh.current.labels[seat] = el;
}

const KEYS = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  gather: ["KeyE", "KeyF"],
  wall: ["KeyQ", "KeyR"],
  dash: ["ShiftLeft", "ShiftRight"],
  charge: ["Space"],
};

interface ControlEnv {
  /** 화면 → 세계 뒤집기 (1팀은 −1) */
  flip: number;
  myPos: () => { x: number; z: number } | null;
  /** 터치 빠른 던지기: 가장 가까운 상대(또는 눈사람) 조준 */
  autoTarget: () => { aim: number; pow: number } | null;
  cocoa: () => boolean;
  onPress: (what: "throw" | "wall" | "dash" | "charge") => void;
}

function useControls(onInput: (inp: PlayerInput) => void, enabled: boolean, shared: React.MutableRefObject<SceneShared>, env: React.MutableRefObject<ControlEnv>) {
  const held = useRef(new Set<string>());
  const moveStick = useRef<{ x: number; z: number } | null>(null);
  const aimStick = useRef<{ x: number; y: number } | null>(null);
  const counters = useRef({ throw: 0, wall: 0, dash: 0 });
  const chargeAt = useRef<number | null>(null);
  const gatherHeld = useRef(false);
  const pow = useRef(0);
  const aim = useRef(-Math.PI / 2);
  const last = useRef("");
  const lastSent = useRef(0);
  const cb = useRef(onInput);
  useEffect(() => {
    cb.current = onInput;
  }, [onInput]);

  const moveVec = useCallback(() => {
    const h = held.current;
    let mx = 0;
    let mz = 0;
    if (KEYS.left.some((k) => h.has(k))) mx -= 1;
    if (KEYS.right.some((k) => h.has(k))) mx += 1;
    if (KEYS.up.some((k) => h.has(k))) mz -= 1;
    if (KEYS.down.some((k) => h.has(k))) mz += 1;
    if (moveStick.current) {
      mx += moveStick.current.x;
      mz += moveStick.current.z;
    }
    const l = Math.hypot(mx, mz);
    if (l > 1) {
      mx /= l;
      mz /= l;
    }
    const f = env.current.flip;
    return { mx: mx * f, mz: mz * f };
  }, [env]);

  const currentAim = useCallback(() => {
    const f = env.current.flip;
    if (aimStick.current && Math.hypot(aimStick.current.x, aimStick.current.y) > 8) {
      aim.current = Math.atan2(aimStick.current.y * f, aimStick.current.x * f);
    } else if (!aimStick.current && shared.current.aimWorld) {
      const me = env.current.myPos();
      if (me) {
        const dx = shared.current.aimWorld.x - me.x;
        const dz = shared.current.aimWorld.z - me.z;
        if (Math.hypot(dx, dz) > 0.4) aim.current = Math.atan2(dz, dx);
      }
    } else if (!shared.current.pointer && !aimStick.current) {
      // 터치에서 조준 막대를 안 쓰면 걷는 방향을 본다
      const m = moveVec();
      if (Math.hypot(m.mx, m.mz) > 0.3) aim.current = Math.atan2(m.mz, m.mx);
    }
    return aim.current;
  }, [env, shared, moveVec]);

  const livePow = useCallback(() => {
    if (chargeAt.current === null) return 0;
    return Math.min(1, ((performance.now() - chargeAt.current) / CHARGE_MS) * (env.current.cocoa() ? 2 : 1));
  }, [env]);

  const compute = useCallback((): PlayerInput => {
    const m = moveVec();
    const a = currentAim();
    setPreview(shared, chargeAt.current !== null ? { aim: a, pow: livePow() } : null);
    return {
      mx: Math.round(m.mx * 100) / 100,
      mz: Math.round(m.mz * 100) / 100,
      aim: Math.round(a * 1000) / 1000,
      charge: chargeAt.current !== null ? 1 : 0,
      gather: gatherHeld.current || KEYS.gather.some((k) => held.current.has(k)) ? 1 : 0,
      throw: counters.current.throw,
      pow: Math.round(pow.current * 1000),
      wall: counters.current.wall,
      dash: counters.current.dash,
    };
  }, [moveVec, currentAim, livePow, shared]);

  const flush = useCallback(
    (force = false) => {
      const inp = compute();
      const key = JSON.stringify({ ...inp, aim: Math.round(inp.aim * 20) });
      const now = performance.now();
      if (!force && key === last.current && now - lastSent.current < 250) return;
      last.current = key;
      lastSent.current = now;
      cb.current(inp);
    },
    [compute],
  );

  const startCharge = useCallback(() => {
    if (chargeAt.current !== null) return;
    chargeAt.current = performance.now();
    env.current.onPress("charge");
    flush(true);
  }, [flush, env]);
  const release = useCallback(
    (auto = false) => {
      if (chargeAt.current === null) return;
      let p = livePow();
      if (auto) {
        const t = env.current.autoTarget();
        if (t) {
          aim.current = t.aim;
          p = Math.max(p, t.pow);
        }
      }
      pow.current = p;
      chargeAt.current = null;
      counters.current.throw += 1;
      env.current.onPress("throw");
      flush(true);
    },
    [livePow, flush, env],
  );
  const press = useCallback(
    (what: "wall" | "dash") => {
      counters.current[what] += 1;
      env.current.onPress(what);
      flush(true);
    },
    [flush, env],
  );
  const setGather = useCallback(
    (v: boolean) => {
      gatherHeld.current = v;
      flush(true);
    },
    [flush],
  );

  useEffect(() => {
    if (!enabled) return;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const all = Object.values(KEYS).flat();
    const down = (e: KeyboardEvent) => {
      if (typing(e) || !all.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      held.current.add(e.code);
      if (KEYS.charge.includes(e.code)) startCharge();
      else if (KEYS.wall.includes(e.code)) press("wall");
      else if (KEYS.dash.includes(e.code)) press("dash");
      else flush(true);
    };
    const up = (e: KeyboardEvent) => {
      if (!held.current.delete(e.code)) return;
      if (KEYS.charge.includes(e.code)) release();
      else flush(true);
    };
    const blur = () => {
      held.current.clear();
      moveStick.current = null;
      aimStick.current = null;
      chargeAt.current = null;
      gatherHeld.current = false;
      flush(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const id = window.setInterval(() => flush(false), 90);
    let raf = 0;
    const tick = () => {
      // 미리보기 포물선은 매 프레임 (보내기는 위 간격대로)
      setPreview(shared, chargeAt.current !== null ? { aim: currentAim(), pow: livePow() } : null);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.clearInterval(id);
      window.cancelAnimationFrame(raf);
    };
  }, [enabled, flush, press, startCharge, release, currentAim, livePow, shared]);

  return {
    startCharge,
    release,
    press,
    setGather,
    setMoveStick: (v: { x: number; z: number } | null) => {
      moveStick.current = v;
      flush(true);
    },
    setAimStick: (v: { x: number; y: number } | null) => {
      aimStick.current = v;
    },
    isCharging: () => chargeAt.current !== null,
  };
}

/* ── 터치 막대 ─────────────────────────────────────────────────────── */

function Stick({ side, label, onMove, onStart, onEnd }: { side: "left" | "right"; label: ReactNode; onMove: (dx: number, dy: number, len: number) => void; onStart?: () => void; onEnd?: (moved: boolean) => void }) {
  const base = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);
  const [knob, setKnob] = useState<{ bx: number; by: number; dx: number; dy: number } | null>(null);
  const R = 52;
  return (
    <div
      className={`absolute bottom-0 z-20 h-[46%] w-[44%] touch-none select-none ${side === "left" ? "left-0" : "right-0"}`}
      onPointerDown={(e) => {
        if (base.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        base.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        setKnob({ bx: e.clientX - r.left, by: e.clientY - r.top, dx: 0, dy: 0 });
        onStart?.();
      }}
      onPointerMove={(e) => {
        const b = base.current;
        if (!b || b.id !== e.pointerId) return;
        let dx = e.clientX - b.x;
        let dy = e.clientY - b.y;
        const l = Math.hypot(dx, dy);
        if (l > 12) b.moved = true;
        if (l > R) {
          dx = (dx / l) * R;
          dy = (dy / l) * R;
        }
        setKnob((k) => (k ? { ...k, dx, dy } : k));
        onMove(dx, dy, Math.min(1, l / R));
      }}
      onPointerUp={(e) => {
        const b = base.current;
        if (!b || b.id !== e.pointerId) return;
        base.current = null;
        setKnob(null);
        onEnd?.(b.moved);
      }}
      onPointerCancel={() => {
        const moved = base.current?.moved ?? false;
        base.current = null;
        setKnob(null);
        onEnd?.(moved);
      }}
    >
      {knob ? (
        <div className="pointer-events-none absolute" style={{ left: knob.bx - R, top: knob.by - R, width: R * 2, height: R * 2 }}>
          <div className="absolute inset-0 rounded-full border-2 border-white/50 bg-black/20" />
          <div className="absolute h-14 w-14 rounded-full border-2 border-white/80 bg-white/40" style={{ left: R - 28 + knob.dx, top: R - 28 + knob.dy }} />
        </div>
      ) : (
        <div className={`pointer-events-none absolute bottom-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/40 text-center text-[11px] font-semibold text-white/80 ${side === "left" ? "left-6" : "right-6"}`}>{label}</div>
      )}
    </div>
  );
}

function HoldButton({ label, sub, onDown, onUp, active, frac = 1, ariaLabel }: { label: string; sub: string; onDown: () => void; onUp?: () => void; active?: boolean; frac?: number; ariaLabel: string }) {
  const ready = frac >= 1;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex h-14 w-14 touch-none flex-col items-center justify-center rounded-full border-2 font-bold text-white shadow-lg select-none ${active ? "border-amber-300 bg-amber-500/50" : ready ? "border-white/70 bg-black/45" : "border-white/25 bg-black/30 text-white/50"}`}
    >
      {!ready && (
        <svg className="pointer-events-none absolute inset-0" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="6" strokeDasharray={`${frac * 289} 289`} transform="rotate(-90 50 50)" />
        </svg>
      )}
      <span className="text-xl leading-none">{label}</span>
      <span className="mt-0.5 text-[9px] leading-none">{sub}</span>
    </button>
  );
}

/* ── 보드 ───────────────────────────────────────────────────────────── */

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "go" | "warn" | "good" | "bad" | "info";
}

function SeatTag({ seat, names, me }: { seat: number; names: Record<number, string>; me: number }) {
  const team = seat % 2;
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: TEAM_COLORS[team] }}>
      <span aria-hidden>{TEAM_SYMBOLS[team]}</span>
      <span className="max-w-[7rem] truncate text-white light:text-slate-900">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

export default function SnowballBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: SnowballBoardProps) {
  const [view, setView] = useState<{ mode: ViewMode; quality: Quality }>({ mode: "3d", quality: "auto" });
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<{ id: number; text: ReactNode }[]>([]);
  const [gatherOn, setGatherOn] = useState(false);
  const [chargingUi, setChargingUi] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);
  const shared = useRef<SceneShared>({ buf, mySeat, shake: 0, labels: [], pointer: null, aimWorld: null, preview: null });
  useEffect(() => syncShared(shared, buf, mySeat), [buf, mySeat]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setView(loadView());
    setCanGl(webglOk());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const me = snap.players[mySeat];
  const fighting = snap.phase === "fight";
  const sound = getSnowballSound;
  const el = fighting ? snap.t - snap.fightStart : 0;
  const timeLeft = fighting ? Math.max(0, Math.ceil((ROUND_MS - el) / 1000)) : null;
  const myMan = me ? snap.snowmen[me.team] : null;
  const tense = fighting && ((timeLeft ?? 99) <= 30 || snap.snowmen.some((m) => m.hp / m.hpMax <= 0.5));
  const bgmLevel = !fighting ? 0 : snap.blizzard ? 2 : tense ? 1 : 0;
  useSuiteBgm(sound, !ended && snap.phase !== "gameOver", bgmLevel);

  const showBanner = useCallback((text: string, tone: Banner["tone"], sub?: string, ms = 1400) => {
    const id = ++bannerSeq.current;
    setBanners((b) => [...b.slice(-2), { id, text, tone, sub }]);
    window.setTimeout(() => setBanners((b) => b.filter((x) => x.id !== id)), ms);
  }, []);
  const pushFeed = useCallback((text: ReactNode) => {
    const id = ++bannerSeq.current;
    setFeed((f) => [...f.slice(-4), { id, text }]);
    window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 5000);
  }, []);

  // 조작 환경 (팀 방향, 내 위치, 자동 조준)
  const env = useRef<ControlEnv>({ flip: 1, myPos: () => null, autoTarget: () => null, cocoa: () => false, onPress: () => {} });
  useEffect(() => {
    const next: ControlEnv = { flip: me?.team === 1 ? -1 : 1, myPos: () => null, autoTarget: () => null, cocoa: () => false, onPress: () => {} };
    next.myPos = () => buf.ahead(mySeat, performance.now());
    next.cocoa = () => {
      const s = buf.latest();
      const p = s?.players[mySeat];
      return !!s && !!p && s.t < p.cocoaUntil;
    };
    next.autoTarget = () => {
      const s = buf.latest();
      const p = s?.players[mySeat];
      const pos = buf.ahead(mySeat, performance.now());
      if (!s || !p || !pos) return null;
      let best: { x: number; z: number; d: number } | null = null;
      for (const e of s.players) {
        if (e.team === p.team || isFrozen(e, s.t)) continue;
        const d = Math.hypot(e.x - pos.x, e.z - pos.z);
        if (d < 14 && (!best || d < best.d)) best = { x: e.x, z: e.z, d };
      }
      if (!best) {
        const m = s.snowmen[1 - p.team];
        const d = Math.hypot(m.x - pos.x, m.z - pos.z);
        if (d < 18) best = { x: m.x, z: m.z, d };
      }
      if (!best) return null;
      return { aim: Math.atan2(best.z - pos.z, best.x - pos.x), pow: chargeForRange(best.d + 0.8) };
    };
    next.onPress = (what) => {
      const s = buf.latest();
      const p = s?.players[mySeat];
      if (!s || !p || s.phase !== "fight" || isFrozen(p, s.t)) return;
      if (what === "charge") setChargingUi(true);
      if (what === "throw") setChargingUi(false);
      if (what === "throw" && p.ammo <= 0) sound().play("denied");
      if (what === "wall" && p.ammo < WALL_COST) sound().play("denied");
      if (what === "dash" && s.t < p.dashCdAt - 150) sound().play("denied");
    };
    setEnv(env, next);
  }, [me?.team, buf, mySeat, sound]);

  const controls = useControls(onInput, !ended, shared, env);

  // 새 이벤트 → 연출·소리·알림
  const lastFresh = useRef(0);
  useEffect(() => {
    if (fresh.seq === lastFresh.current) return;
    lastFresh.current = fresh.seq;
    const now = performance.now();
    const s = sound();
    const add: FxItem[] = [];
    const mine = snap.players[mySeat];
    const near = (x: number, z: number, r: number) => !!mine && Math.hypot(mine.x - x, mine.z - z) < r;
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "throw":
          if (ev.s === mySeat) s.play("throw", 0.6);
          else {
            const o = snap.players[ev.s];
            if (o && near(o.x, o.z, 9)) s.play("throw", 0.3);
          }
          if (ev.big) pushFeed(<><SeatTag seat={ev.s} names={names} me={mySeat} /> 🧊 왕눈덩이 발사!</>);
          break;
        case "hit":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play("ouch");
            setShake(shared, 0.5);
          } else s.play("hit");
          if (ev.by === mySeat) showBanner("퍽!", "good", undefined, 600);
          break;
        case "freeze":
          add.push({ ev, at: now });
          s.play(ev.s === mySeat ? "myFreeze" : "freeze");
          if (ev.s === mySeat) setShake(shared, 1);
          pushFeed(
            <>
              <SeatTag seat={ev.by} names={names} me={mySeat} /> <span className="text-sky-300">❄️ 얼림</span> <SeatTag seat={ev.s} names={names} me={mySeat} />
            </>,
          );
          if (ev.by === mySeat) showBanner("❄️ 꽁꽁!", "good", `${names[ev.s] ?? ""} 얼림 +2`, 1100);
          break;
        case "thaw":
          if (ev.s === mySeat) s.play("thaw");
          break;
        case "splat":
          add.push({ ev, at: now });
          if (near(ev.x, ev.z, 7)) s.play("splat");
          break;
        case "wallHit":
          add.push({ ev, at: now });
          if (near(ev.x, ev.z, 10)) s.play("wallHit");
          break;
        case "wallBreak":
          add.push({ ev, at: now });
          s.play("wallBreak");
          if (ev.by === mySeat) showBanner("🧱 벽 부숨!", "good", undefined, 900);
          break;
        case "wallUp":
          if (ev.s === mySeat || near(snap.players[ev.s]?.x ?? 99, snap.players[ev.s]?.z ?? 99, 8)) s.play("wallUp");
          break;
        case "snowman": {
          add.push({ ev, at: now });
          const minesHit = mine && ev.team === mine.team;
          s.play(minesHit ? "snowmanMine" : "snowman");
          if (minesHit) setShake(shared, 0.25);
          if (ev.hp === 0) pushFeed(<><SeatTag seat={ev.by} names={names} me={mySeat} /> ☃️ 눈사람 쓰러뜨림!</>);
          break;
        }
        case "gather":
          if (ev.s === mySeat) s.play("gather");
          break;
        case "dash":
          if (ev.s === mySeat) s.play("dash");
          break;
        case "denied":
          if (ev.s === mySeat) s.play("denied");
          break;
        case "spawn":
          s.play("spawn");
          pushFeed(<>{ITEM_INFO[ev.kind].emoji} {ITEM_INFO[ev.kind].name} 등장 (가운데선)</>);
          break;
        case "pick":
          s.play("pick");
          if (ev.s === mySeat) showBanner(`${ITEM_INFO[ev.kind].emoji} ${ITEM_INFO[ev.kind].name}!`, "info", ITEM_INFO[ev.kind].desc, 1800);
          else pushFeed(<><SeatTag seat={ev.s} names={names} me={mySeat} /> {ITEM_INFO[ev.kind].emoji} {ITEM_INFO[ev.kind].name}</>);
          break;
        case "go":
          s.play("go");
          showBanner("눈싸움 시작!", "go", undefined, 1000);
          break;
        case "blizzard":
          s.play("blizzard");
          showBanner("❄️ 눈보라!", "warn", "벽이 6초마다 녹고, 눈덩이를 6개까지 · 뭉치기 1.5배", 2200);
          break;
        case "end":
          if (ev.winner < 0) s.play("draw");
          else s.play(mine && ev.winner === mine.team ? "roundWin" : "roundLose");
          setChargingUi(false);
          break;
        case "over":
          s.play(snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        case "round":
          setGatherOn(false);
          break;
        default:
          break;
      }
    }
    if (add.length) setFx((f) => [...f.filter((x) => now - x.at < 1500), ...add].slice(-60));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  // 전체화면
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    const el2 = stageRef.current;
    if (!el2) return;
    if (document.fullscreenElement === el2) void document.exitFullscreen().catch(() => {});
    else if (full) setFull(false);
    else if (typeof el2.requestFullscreen === "function" && document.fullscreenEnabled !== false) void el2.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  };

  const quality: "high" | "low" = view.quality === "auto" ? (touch || lowFps ? "low" : "high") : view.quality;
  const use3d = view.mode === "3d" && canGl;
  const frozenLeft = me && isFrozen(me, snap.t) ? Math.ceil((me.frozenUntil - snap.t) / 1000) : 0;
  const lastRound = snap.history[snap.history.length - 1];
  const uiClick = useCallback(() => sound().play("ui"), [sound]);
  const maxAmmo = ammoMax(snap);
  const dashFrac = me ? (snap.t >= me.dashCdAt ? 1 : Math.max(0, 1 - (me.dashCdAt - snap.t) / DASH_CD_MS)) : 1;
  const myTeam = me?.team ?? 0;
  const teamOrder = [myTeam, 1 - myTeam];

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          ⛄ 라운드 {snap.round}/{snap.options.rounds}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="flex items-center gap-2 font-bold">
          {teamOrder.map((t, k) => (
            <span key={t} className="flex items-center gap-1" style={{ color: TEAM_COLORS[t] }}>
              {k === 1 && <span className="text-white/40">:</span>}
              {TEAM_EMOJI[t]} {TEAM_SYMBOLS[t]} {snap.wins[t]}
            </span>
          ))}
        </span>
        <span className={`tabular-nums ${snap.blizzard ? "font-bold text-sky-300 light:text-sky-600" : ""}`}>
          {timeLeft !== null ? `${snap.blizzard ? "❄️ 눈보라 · " : ""}⏱ ${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}${!snap.blizzard && snap.options.blizzard && el < BLIZZARD_AT_MS ? ` (눈보라 ${Math.ceil((BLIZZARD_AT_MS - el) / 1000)}초 뒤)` : ""}` : snap.phase === "countdown" ? "준비" : snap.phase === "roundEnd" ? "라운드 끝" : "끝"}
        </span>
        <span className="flex items-center gap-1.5">
          <SuiteSoundHud suite={getSnowballSound} icon="⛄" label="Snow Day March" preview="hit" />
          <button type="button" onClick={() => { uiClick(); setRulebook(true); }} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300">
            📖 룰북
          </button>
          <button type="button" onClick={() => { uiClick(); setSettings((v) => !v); }} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300" aria-expanded={settings} aria-label="보기 설정">
            ⚙️
          </button>
        </span>
      </div>
      {settings && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          보기
          {(["3d", "2d"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={m === "3d" && !canGl}
              onClick={() => {
                const v = { ...view, mode: m };
                setView(v);
                saveView(v);
              }}
              className={`rounded-full border px-2.5 py-1 ${view.mode === m ? "border-cyan-300 bg-cyan-400/20 text-cyan-100 light:text-cyan-800" : "border-white/15 light:border-slate-300"}`}
            >
              {m === "3d" ? "🎥 3D" : "🗺️ 2D 위에서"}
            </button>
          ))}
          <span className="ml-2">화질</span>
          {(["auto", "high", "low"] as Quality[]).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                const v = { ...view, quality: q };
                setView(v);
                saveView(v);
              }}
              className={`rounded-full border px-2.5 py-1 ${view.quality === q ? "border-cyan-300 bg-cyan-400/20 text-cyan-100 light:text-cyan-800" : "border-white/15 light:border-slate-300"}`}
            >
              {q === "auto" ? "자동" : q === "high" ? "높음" : "낮음(빠름)"}
            </button>
          ))}
          {!canGl && <span className="text-amber-300">이 기기는 3D(WebGL)를 지원하지 않아 2D로 보여요</span>}
        </div>
      )}

      {/* 눈사람 체력 */}
      <div className="grid grid-cols-2 gap-2">
        {teamOrder.map((t) => {
          const m = snap.snowmen[t];
          const frac = m ? m.hp / m.hpMax : 0;
          return (
            <div key={t} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs light:border-slate-200 light:bg-white">
              <span className="shrink-0 font-bold" style={{ color: TEAM_COLORS[t] }}>
                ☃️ {TEAM_SYMBOLS[t]} {t === myTeam ? "우리" : "상대"} {TEAM_NAMES[t]}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                <span className="block h-full rounded-full transition-[width]" style={{ width: `${Math.round(frac * 100)}%`, background: TEAM_COLORS[t] }} />
              </span>
              <b className="shrink-0 tabular-nums text-white light:text-slate-900">
                {m?.hp ?? 0}/{m?.hpMax ?? 0}
              </b>
            </div>
          );
        })}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#b9d3ec] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[64svh] min-h-[340px]" : "aspect-[16/10] max-h-[76vh]"}`}
        onPointerDown={(e) => {
          // 데스크톱: 왼쪽 버튼 꾹 = 힘 모으기, 떼면 던지기 (터치는 오른쪽 막대)
          if (e.pointerType === "touch" || e.button !== 0 || ended) return;
          if ((e.target as HTMLElement).closest("button")) return;
          controls.startCharge();
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch" || e.button !== 0) return;
          if (controls.isCharging()) controls.release();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {use3d ? <FieldScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} fx={fx} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} /> : <Field2D shared={shared} />}

        {/* 이름표 */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {snap.players.map((p) => (
            <div
              key={p.seat}
              ref={(el2) => setLabel(shared, p.seat, el2)}
              className="absolute top-0 left-0 flex flex-col items-center gap-0.5 whitespace-nowrap"
              style={{ display: "none" }}
            >
              <div className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                <span style={{ color: TEAM_COLORS[p.team] }} aria-hidden>
                  {TEAM_SYMBOLS[p.team]}
                </span>
                <span className="h-2 w-2 rounded-full" style={{ background: SEAT_SCARF[p.seat % SEAT_SCARF.length] }} aria-hidden />
                <span className="max-w-[5.5rem] truncate">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
                {isFrozen(p, snap.t) ? <span>❄️</span> : <span className="tracking-tighter text-rose-300">{"♥".repeat(Math.max(0, p.hp))}</span>}
                {p.giant && <span aria-label="왕눈덩이">🧊</span>}
              </div>
            </div>
          ))}
        </div>

        {/* 알림판 */}
        <div className="pointer-events-none absolute top-2 right-2 z-20 flex max-w-[60%] flex-col items-end gap-1">
          {feed.map((f) => (
            <div key={f.id} className="rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white shadow">
              {f.text}
            </div>
          ))}
        </div>

        {/* 배너 */}
        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex flex-col items-center gap-2 px-3">
          {snap.phase === "countdown" && (
            <div className="flex flex-col items-center">
              <span className="rounded-full bg-black/40 px-3 py-0.5 text-sm font-bold text-white">
                라운드 {snap.round} · 나는 <span style={{ color: TEAM_COLORS[myTeam] }}>{TEAM_EMOJI[myTeam]} {TEAM_NAMES[myTeam]}</span>
              </span>
              <span key={countLeft} className="animate-[sf-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft}
              </span>
              {snap.round === 1 && (
                <span className="mt-1 max-w-md rounded-2xl bg-black/50 px-3 py-1.5 text-center text-xs break-keep text-white">
                  {touch ? "왼쪽 막대 이동 · 오른쪽 막대 끌어 조준, 길게 누를수록 멀리 · ⛄ 꾹 = 눈 뭉치기 · 🧱 벽 · 💨 구르기" : "WASD 이동 · 마우스로 조준 · 왼쪽 버튼(또는 Space) 꾹 → 떼면 던지기 · E 꾹 = 눈 뭉치기 · Q 벽 · Shift 구르기"} — 상대 ☃️ 눈사람을 먼저 무너뜨려요!
                </span>
              )}
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[sf-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-cyan-300 text-slate-900" : b.tone === "warn" ? "bg-sky-700 text-white" : b.tone === "good" ? "bg-amber-400 text-slate-900" : b.tone === "bad" ? "bg-rose-600 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-3xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 내가 얼었음 */}
        {frozenLeft > 0 && fighting && (
          <div className="pointer-events-none absolute inset-x-0 top-[32%] z-20 flex flex-col items-center gap-1 px-3">
            <div className="animate-[sf-pop_0.4s_ease-out] text-5xl font-black text-sky-200 drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">꽁꽁! {frozenLeft}</div>
            <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">녹으면 우리 진영에서 다시 시작해요</div>
          </div>
        )}
        {/* 우리 눈사람 위험 */}
        {fighting && myMan && myMan.hp > 0 && myMan.hp / myMan.hpMax <= 0.34 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[34%] z-20 mx-auto w-fit animate-pulse rounded-full bg-rose-600/90 px-3 py-1 text-xs font-bold text-white">☃️ 우리 눈사람이 위험해요! ({myMan.hp})</div>
        )}

        {/* 라운드 결과 */}
        {snap.phase === "roundEnd" && lastRound && (
          <div className="absolute inset-x-3 top-[10%] z-30 mx-auto max-w-sm animate-[sf-pop_0.4s_ease-out] rounded-2xl border border-white/15 bg-slate-950/85 p-4 text-center text-white shadow-2xl">
            <p className="text-xs text-white/60">
              라운드 {lastRound.round} · {Math.round(lastRound.ms / 1000)}초 · {lastRound.reason === "snowman" ? "눈사람 쓰러뜨림" : lastRound.reason === "time" ? "시간 종료 — 눈사람 체력 비교" : "무승부"}
            </p>
            <p className="mt-1 text-xl font-black" style={{ color: lastRound.winner >= 0 ? TEAM_COLORS[lastRound.winner] : undefined }}>
              {lastRound.winner < 0 ? "🤝 무승부" : `${TEAM_EMOJI[lastRound.winner]} ${TEAM_NAMES[lastRound.winner]} 승리!`}
            </p>
            <p className="mt-1 text-sm">
              {teamOrder.map((t, k) => (
                <span key={t} style={{ color: TEAM_COLORS[t] }}>
                  {k === 1 && <span className="text-white/50"> : </span>}
                  {TEAM_SYMBOLS[t]} {snap.wins[t]}승
                </span>
              ))}
            </p>
            <p className="mt-2 text-xs text-white/70">
              🌟 라운드 MVP: <SeatTag seat={lastRound.mvp} names={names} me={mySeat} />
            </p>
          </div>
        )}

        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}
        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        <button type="button" onClick={() => { uiClick(); toggleFull(); }} className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white" aria-label={full ? "전체화면 끄기" : "전체화면"}>
          {full ? "↙ 작게" : "⛶ 크게"}
        </button>

        {/* 터치 조작 */}
        {touch && !ended && snap.phase !== "gameOver" && me && frozenLeft === 0 && (
          <>
            <Stick side="left" label={<>여기를 끌어<br />이동</>} onMove={(dx, dy, len) => controls.setMoveStick(len < 0.1 ? { x: 0, z: 0 } : { x: (dx / Math.max(1, Math.hypot(dx, dy))) * len, z: (dy / Math.max(1, Math.hypot(dx, dy))) * len })} onEnd={() => controls.setMoveStick(null)} />
            <Stick
              side="right"
              label={<>꾹 눌러 조준<br />떼면 던지기</>}
              onStart={() => controls.startCharge()}
              onMove={(dx, dy) => controls.setAimStick({ x: dx, y: dy })}
              onEnd={(moved) => {
                controls.release(!moved);
                controls.setAimStick(null);
              }}
            />
            <div className="absolute right-[45%] bottom-3 z-30 flex flex-col items-center gap-2">
              <HoldButton
                label="⛄"
                sub="뭉치기"
                ariaLabel="눈 뭉치기 (누르는 동안)"
                active={gatherOn}
                onDown={() => {
                  setGatherOn(true);
                  controls.setGather(true);
                }}
                onUp={() => {
                  setGatherOn(false);
                  controls.setGather(false);
                }}
              />
              <div className="flex gap-2">
                <HoldButton label="🧱" sub={`벽 ${WALL_COST}개`} ariaLabel="눈벽 세우기" frac={me.ammo >= WALL_COST ? 1 : me.ammo / WALL_COST} onDown={() => controls.press("wall")} />
                <HoldButton label="💨" sub="구르기" ariaLabel="구르기" frac={dashFrac} onDown={() => controls.press("dash")} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* 내 상태 */}
      {me && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          <span>
            나: <b style={{ color: TEAM_COLORS[me.team] }}>{TEAM_EMOJI[me.team]} {TEAM_SYMBOLS[me.team]} {TEAM_NAMES[me.team]}</b>
          </span>
          <span aria-label={`체력 ${me.hp}/${me.hpMax}`}>
            체력 <span className="text-rose-400">{"♥".repeat(Math.max(0, me.hp))}</span>
            <span className="text-white/25">{"♥".repeat(Math.max(0, me.hpMax - me.hp))}</span>
          </span>
          <span aria-label={`눈덩이 ${me.ammo}/${maxAmmo}`}>
            ⛄ 눈덩이 <b className="text-white light:text-slate-900">{"●".repeat(me.ammo)}</b>
            <span className="text-white/25">{"○".repeat(Math.max(0, maxAmmo - me.ammo))}</span>
            {me.gathering && <span className="ml-1 text-cyan-300">뭉치는 중…</span>}
          </span>
          <span>💨 {dashFrac >= 1 ? "✓" : `${Math.ceil((me.dashCdAt - snap.t) / 1000)}초`}</span>
          {snap.t < me.cocoaUntil && <span className="text-amber-300">🍫 {Math.ceil((me.cocoaUntil - snap.t) / 1000)}초</span>}
          {me.giant && <span className="text-sky-300">🧊 다음 한 방은 왕눈덩이</span>}
          {chargingUi && <span className="text-amber-300">힘 모으는 중 — 포물선이 노란 점으로 보여요</span>}
          {!touch && <span className="text-white/40 light:text-slate-400">WASD 이동 · 마우스 조준 · 클릭/Space 꾹→떼기 던지기 · E 꾹 뭉치기 · Q 벽({WALL_COST}개) · Shift 구르기 · 최대 {maxAmmo === AMMO_MAX ? AMMO_MAX : maxAmmo}개</span>}
        </div>
      )}

      {(ended || snap.phase === "gameOver") && (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && onRestart && (
            <button type="button" onClick={onRestart} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-cyan-200">
              다시하기
            </button>
          )}
        </div>
      )}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        @keyframes sf-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
      `}</style>
    </div>
  );
}

function FinalPanel({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.ranks ?? snap.players.map(() => 1);
  const winner = snap.winnerTeam ?? -1;
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || b.points - a.points || a.seat - b.seat);
  const best = (f: (p: (typeof snap.players)[number]) => number) => {
    const max = Math.max(...snap.players.map(f));
    return { seats: max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [], max };
  };
  const fr = best((p) => p.stats.freezes);
  const sm = best((p) => p.stats.snowmanHits);
  const wl = best((p) => p.stats.walls);
  const lob = best((p) => p.stats.lobHits);
  const fin = best((p) => p.stats.finishers);
  const awards = [
    { icon: "❄️", title: "얼음 마왕", seats: fr.seats, value: `${fr.max}명 얼림` },
    { icon: "☃️", title: "요새 파괴자", seats: sm.seats, value: `${sm.max}번 명중` },
    { icon: "🧱", title: "건축왕", seats: wl.seats, value: `벽 ${wl.max}개` },
    { icon: "🌈", title: "포물선 장인", seats: lob.seats, value: `${lob.max}번` },
    { icon: "🏁", title: "마무리 한 방", seats: fin.seats, value: `${fin.max}번` },
  ].filter((a) => a.seats.length > 0);
  return (
    <div className="absolute inset-x-3 top-[5%] z-30 mx-auto max-h-[88%] max-w-md overflow-y-auto rounded-2xl border border-cyan-200/30 bg-slate-950/90 p-4 text-white shadow-2xl">
      <p className="text-center text-xs text-white/60">최종 결과 · {snap.options.rounds}라운드</p>
      <p className="mt-1 text-center text-2xl font-black" style={{ color: winner >= 0 ? TEAM_COLORS[winner] : undefined }}>
        {winner < 0 ? "🤝 무승부" : `${TEAM_EMOJI[winner]} ${TEAM_NAMES[winner]} 승리!`}
      </p>
      <p className="text-center text-sm">
        {[0, 1].map((t, k) => (
          <span key={t} style={{ color: TEAM_COLORS[t] }}>
            {k === 1 && <span className="text-white/50"> : </span>}
            {TEAM_SYMBOLS[t]} {snap.wins[t]}
          </span>
        ))}
      </p>
      <ol className="mt-3 flex flex-col gap-1.5 text-sm">
        {order.map((p) => (
          <li key={p.seat} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
            <span className="flex items-center gap-2">
              <b className="w-6 text-center">{ranks[p.seat] === 1 ? "🥇" : "🥈"}</b>
              <SeatTag seat={p.seat} names={names} me={mySeat} />
            </span>
            <span className="text-xs text-white/70 tabular-nums">
              ❄️{p.stats.freezes} · 🎯{p.stats.hits} · ☃️{p.stats.snowmanHits} · 🧱{p.stats.walls} · <b className="text-sm text-cyan-200">{p.points}점</b>
            </span>
          </li>
        ))}
      </ol>
      {awards.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
          {awards.map((a) => (
            <div key={a.title} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
              <div className="font-bold">
                {a.icon} {a.title} <span className="text-white/50">{a.value}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {a.seats.map((s) => (
                  <SeatTag key={s} seat={s} names={names} me={mySeat} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-white/50">팀이 이기면 모두 1등 · 점수는 팀 안 기여도 (맞힘 1 · 얼림 2 · 눈사람 1)</p>
    </div>
  );
}

