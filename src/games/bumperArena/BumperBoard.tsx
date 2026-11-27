"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { tileIndexAt, arenaGeo } from "./arena";
import Arena2D from "./Arena2D";
import { getBumperArenaSound } from "./bumperArenaSound";
import {
  DASH_CD_MS,
  FIGHT_MAX_MS,
  GUST_CD_MS,
  ITEM_INFO,
  JUMP_CD_MS,
  SEAT_COLORS,
  SEAT_COLOR_NAMES,
  SEAT_SYMBOLS,
  SUDDEN_MS,
} from "./data";
import type { SnapBuffer, Snap } from "./net";
import type { GameEvent, PlayerInput } from "./sim";
import RulebookModal from "./RulebookModal";
import type { FxItem } from "./three/Fx";
import type { SceneShared } from "./three/ArenaScene";

const ArenaScene = dynamic(() => import("./three/ArenaScene"), { ssr: false, loading: () => null });

/**
 * 범퍼 아레나 게임 화면 (룰북 §9~§11): 3D/2D 무대 + 이름표 + HUD + 조작(키보드·터치) +
 * 라운드/최종 결과. 방장이든 손님이든 같은 스냅샷 버퍼를 그린다.
 */

export interface BumperBoardProps {
  snap: Snap;
  buf: SnapBuffer;
  /** 처음 보는 이벤트 묶음 (방 컴포넌트가 버퍼에서 꺼내 준다) */
  fresh: { events: GameEvent[]; seq: number };
  mySeat: number;
  names: Record<number, string>;
  onInput: (inp: PlayerInput) => void;
  ended: boolean;
  isHost: boolean;
  onRestart?: () => void;
  onLeave: () => void;
  practice?: boolean;
  /** 연결 상태 안내 (방장 승계 중 등) */
  notice?: string | null;
}

type ViewMode = "3d" | "2d";
type Quality = "auto" | "high" | "low";
const VIEW_KEY = "bumper-arena:view";

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

const KEYS = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  dash: ["Space", "KeyJ"],
  jump: ["KeyK", "KeyE"],
  brace: ["ShiftLeft", "ShiftRight", "KeyL"],
};

function useControls(onInput: (inp: PlayerInput) => void, enabled: boolean, onLocalPress: (what: "dash" | "jump") => void) {
  const held = useRef(new Set<string>());
  const stick = useRef<{ x: number; z: number } | null>(null);
  const braceTouch = useRef(false);
  const counters = useRef({ dash: 0, jump: 0 });
  const last = useRef<string>("");
  const lastSent = useRef(0);
  const cbRef = useRef(onInput);
  const pressRef = useRef(onLocalPress);
  useEffect(() => {
    cbRef.current = onInput;
    pressRef.current = onLocalPress;
  }, [onInput, onLocalPress]);

  const compute = useCallback((): PlayerInput => {
    const h = held.current;
    let mx = 0;
    let mz = 0;
    if (KEYS.left.some((k) => h.has(k))) mx -= 1;
    if (KEYS.right.some((k) => h.has(k))) mx += 1;
    if (KEYS.up.some((k) => h.has(k))) mz -= 1;
    if (KEYS.down.some((k) => h.has(k))) mz += 1;
    if (stick.current) {
      mx += stick.current.x;
      mz += stick.current.z;
    }
    const l = Math.hypot(mx, mz);
    if (l > 1) {
      mx /= l;
      mz /= l;
    }
    return {
      mx: Math.round(mx * 100) / 100,
      mz: Math.round(mz * 100) / 100,
      brace: braceTouch.current || KEYS.brace.some((k) => h.has(k)),
      dash: counters.current.dash,
      jump: counters.current.jump,
    };
  }, []);

  const flush = useCallback(
    (force = false) => {
      const inp = compute();
      const key = JSON.stringify(inp);
      const now = performance.now();
      if (!force && key === last.current && now - lastSent.current < 250) return;
      last.current = key;
      lastSent.current = now;
      cbRef.current(inp);
    },
    [compute],
  );

  const press = useCallback(
    (what: "dash" | "jump") => {
      counters.current[what] += 1;
      pressRef.current(what);
      flush(true);
    },
    [flush],
  );

  useEffect(() => {
    if (!enabled) return;
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const all = Object.values(KEYS).flat();
      if (!all.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      held.current.add(e.code);
      if (KEYS.dash.includes(e.code)) press("dash");
      else if (KEYS.jump.includes(e.code)) press("jump");
      else flush(true);
    };
    const up = (e: KeyboardEvent) => {
      if (!held.current.delete(e.code)) return;
      flush(true);
    };
    const blur = () => {
      held.current.clear();
      stick.current = null;
      braceTouch.current = false;
      flush(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const id = window.setInterval(() => flush(false), 100);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.clearInterval(id);
    };
  }, [enabled, flush, press]);

  return {
    press,
    setStick: (v: { x: number; z: number } | null) => {
      stick.current = v;
      flush(true);
    },
    setBrace: (on: boolean) => {
      braceTouch.current = on;
      flush(true);
    },
  };
}

/* ── 터치 조이스틱 ─────────────────────────────────────────────────── */

function Joystick({ onMove }: { onMove: (v: { x: number; z: number } | null) => void }) {
  const base = useRef<{ x: number; y: number; id: number } | null>(null);
  const [knob, setKnob] = useState<{ bx: number; by: number; dx: number; dy: number } | null>(null);
  const R = 52;
  return (
    <div
      className="absolute bottom-0 left-0 z-20 h-[48%] w-[52%] touch-none select-none"
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
        const m = Math.min(1, l / R);
        onMove(l < 6 ? { x: 0, z: 0 } : { x: (dx / Math.max(1, Math.hypot(dx, dy))) * m, z: (dy / Math.max(1, Math.hypot(dx, dy))) * m });
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
          <div className="absolute inset-0 rounded-full border-2 border-white/40 bg-black/20" />
          <div className="absolute h-14 w-14 rounded-full border-2 border-white/80 bg-white/40" style={{ left: R - 28 + knob.dx, top: R - 28 + knob.dy }} />
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-6 left-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/35 text-[11px] font-semibold text-white/70">
          여기를 끌어 이동
        </div>
      )}
    </div>
  );
}

function CdButton({ label, sub, frac, onDown, onUp, big, active, ariaLabel }: { label: ReactNode; sub?: string; frac: number; onDown: () => void; onUp?: () => void; big?: boolean; active?: boolean; ariaLabel: string }) {
  const ready = frac >= 1;
  const size = big ? 76 : 62;
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
      className={`relative flex touch-none select-none flex-col items-center justify-center rounded-full border-2 font-bold text-white shadow-lg ${active ? "border-sky-300 bg-sky-500/70" : ready ? "border-white/70 bg-black/45" : "border-white/25 bg-black/30 text-white/50"}`}
      style={{ width: size, height: size }}
    >
      {!ready && (
        <svg className="pointer-events-none absolute inset-0" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="6" strokeDasharray={`${frac * 289} 289`} transform="rotate(-90 50 50)" />
        </svg>
      )}
      <span className={big ? "text-2xl leading-none" : "text-xl leading-none"}>{label}</span>
      {sub && <span className="mt-0.5 text-[10px] leading-none">{sub}</span>}
    </button>
  );
}

/* ── 보드 ───────────────────────────────────────────────────────────── */

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "go" | "warn" | "ko" | "info";
}

interface Feed {
  id: number;
  text: ReactNode;
  at: number;
}

function SeatTag({ seat, names, me }: { seat: number; names: Record<number, string>; me: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SEAT_COLORS[seat % 6] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat % 6]}</span>
      <span className="max-w-[7rem] truncate text-white light:text-slate-900">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

export default function BumperBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: BumperBoardProps) {
  const [view, setView] = useState<{ mode: ViewMode; quality: Quality }>({ mode: "3d", quality: "auto" });
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [puffs, setPuffs] = useState<{ id: number; at: number; x: number; z: number; seat: number }[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [myOut, setMyOut] = useState<{ by: number; at: number } | null>(null);
  const [flash, setFlash] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);
  const shared = useRef<SceneShared>({ buf, mySeat, hitAt: [], shake: 0, labels: [] });
  useEffect(() => {
    shared.current.buf = buf;
    shared.current.mySeat = mySeat;
  }, [buf, mySeat]);

  useEffect(() => {
    // 저장된 보기 설정·기기 종류는 마운트 뒤에 읽는다 (서버 렌더와 맞추기)
    /* eslint-disable react-hooks/set-state-in-effect */
    setView(loadView());
    setCanGl(webglOk());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const me = snap.players[mySeat];
  const fighting = snap.phase === "fight";
  const sound = getBumperArenaSound;
  useSuiteBgm(sound, !ended && snap.phase !== "gameOver", snap.sudden ? 1 : 0);

  const showBanner = useCallback((text: string, tone: Banner["tone"], sub?: string, ms = 1400) => {
    const id = ++bannerSeq.current;
    setBanners((b) => [...b.slice(-2), { id, text, tone, sub }]);
    window.setTimeout(() => setBanners((b) => b.filter((x) => x.id !== id)), ms);
  }, []);

  const pushFeed = useCallback((text: ReactNode) => {
    const id = ++bannerSeq.current;
    setFeed((f) => [...f.slice(-4), { id, text, at: performance.now() }]);
    window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 5000);
  }, []);

  // 내가 누른 대시·점프는 바로 소리 (방장 확인을 기다리지 않음)
  const onLocalPress = useCallback(
    (what: "dash" | "jump") => {
      const p = snap.players[mySeat];
      if (!p || snap.phase !== "fight") return;
      if (p.alive) {
        if (what === "dash" && snap.t >= p.dashCdAt - 150) sound().play("dash");
        if (what === "jump" && snap.t >= p.jumpCdAt - 150) sound().play("jump");
      } else if (p.ghost && what === "dash" && snap.t >= p.ghost.cdAt - 150) sound().play("gust");
    },
    [snap, mySeat, sound],
  );

  const controls = useControls(onInput, !ended, onLocalPress);

  // 새 이벤트 → 연출·소리·알림
  const lastFresh = useRef(0);
  useEffect(() => {
    if (fresh.seq === lastFresh.current) return;
    lastFresh.current = fresh.seq;
    const now = performance.now();
    const s = sound();
    const addFx: FxItem[] = [];
    const addPuffs: typeof puffs = [];
    let bumpPlayed = false;
    // 새 스냅샷의 이벤트를 화면 효과·알림으로 옮기는 곳 — 이벤트 묶음마다 한 번만 돈다
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "hit": {
          addFx.push({ ev, at: now });
          shared.current.hitAt[ev.b] = now;
          // 서로 맞부딪힌 경우(대시 아님) 양쪽 다 휘청
          if (!ev.d && ev.p > 4) shared.current.hitAt[ev.a] = now;
          if (!bumpPlayed) {
            s.play("bump", ev.p);
            bumpPlayed = true;
          }
          if (ev.b === mySeat || ev.a === mySeat) {
            const k = Math.min(1, ev.p / 10);
            shared.current.shake = Math.max(shared.current.shake, ev.b === mySeat ? k : k * 0.5);
            if (ev.b === mySeat && ev.p > 5) setFlash((f) => f + 1);
          }
          break;
        }
        case "post":
          addFx.push({ ev, at: now });
          s.play("post");
          break;
        case "land":
          addFx.push({ ev, at: now });
          if (ev.s === mySeat || ev.n > 0) s.play("land", ev.n);
          if (ev.n > 0 && ev.s === mySeat) shared.current.shake = Math.max(shared.current.shake, 0.35);
          break;
        case "fall": {
          const p = snap.players[ev.s];
          addPuffs.push({ id: ev.id, at: now, x: p ? p.x + p.vx * 0.8 : 0, z: p ? p.z + p.vz * 0.8 : 0, seat: ev.s });
          s.play("fall");
          if (ev.by >= 0) s.play("ko");
          if (ev.s === mySeat) {
            s.play("myOut");
            setMyOut({ by: ev.by, at: now });
            shared.current.shake = 1;
          }
          pushFeed(
            ev.by >= 0 ? (
              <>
                <SeatTag seat={ev.by} names={names} me={mySeat} /> <span className="text-amber-300">💥 KO</span> <SeatTag seat={ev.s} names={names} me={mySeat} />
              </>
            ) : (
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} /> <span className="text-sky-300">☁️ 스스로 추락</span>
              </>
            ),
          );
          if (ev.by === mySeat) showBanner("💥 KO!", "ko", `${names[ev.s] ?? ""} 떨어뜨림 +1점`, 1200);
          break;
        }
        case "spawn":
          s.play("spawn");
          break;
        case "pick":
          addFx.push({ ev, at: now });
          s.play(ev.kind === "big" || ev.kind === "turbo" || ev.kind === "shield" ? ev.kind : "pick");
          if (ev.s === mySeat) showBanner(`${ITEM_INFO[ev.kind].emoji} ${ITEM_INFO[ev.kind].name}!`, "info", ITEM_INFO[ev.kind].desc, 1600);
          else pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} /> {ITEM_INFO[ev.kind].emoji} {ITEM_INFO[ev.kind].name}
            </>,
          );
          break;
        case "shock":
          addFx.push({ ev, at: now });
          s.play("shock");
          shared.current.shake = Math.max(shared.current.shake, 0.6);
          break;
        case "block":
          s.play("block");
          if (ev.s === mySeat) showBanner("🛡️ 방패로 막았다!", "info", undefined, 1000);
          break;
        case "gust":
          addFx.push({ ev, at: now });
          if (ev.s !== mySeat) s.play("gust");
          break;
        case "go":
          s.play("go");
          showBanner("밀어라!", "go", undefined, 900);
          break;
        case "sudden":
          s.play("sudden");
          showBanner("⚠️ 서든데스", "warn", "섬이 훨씬 빨리 무너져요!", 1800);
          break;
        case "end":
          if (ev.draw) s.play("draw");
          else if (ev.winner === mySeat) s.play("roundWin");
          else s.play("roundLose");
          break;
        case "over":
          s.play(snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        case "round":
          setMyOut(null);
          break;
        default:
          break;
      }
    }
    if (addFx.length) setFx((f) => [...f.filter((x) => now - x.at < 1600), ...addFx].slice(-40));
    if (addPuffs.length) setPuffs((p) => [...p.filter((x) => now - x.at < 2000), ...addPuffs]);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  // 내 발밑 타일이 흔들리기 시작하면 경고음 + 무너지는 소리
  const lastWarn = useRef(-1);
  const fallenCount = useMemo(() => snap.tiles.filter((f) => f > 0 && snap.t >= f).length, [snap.tiles, snap.t]);
  const lastFallen = useRef(0);
  useEffect(() => {
    if (fallenCount > lastFallen.current && snap.phase === "fight") sound().play("crumble");
    lastFallen.current = fallenCount;
  }, [fallenCount, snap.phase, sound]);
  const underMe = me && me.alive ? tileIndexAt(arenaGeo(snap.rings), me.x, me.z) : -1;
  const underWarn = underMe >= 0 && snap.tiles[underMe] > 0 && snap.t < snap.tiles[underMe];
  useEffect(() => {
    if (underWarn && lastWarn.current !== underMe) sound().play("warn");
    lastWarn.current = underWarn ? underMe : -1;
  }, [underWarn, underMe, sound]);

  // 전체화면
  const [full, setFull] = useState(false);
  useEffect(() => {
    // 이 무대만 비교 — 페이지 전체화면(공용 셸) 안에서도 상태가 꼬이지 않게
    const on = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
    else if (full) setFull(false); // 아이폰 등: 창 가득 모드 해제
    else if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) void el.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  };

  const quality: "high" | "low" = view.quality === "auto" ? (touch || lowFps ? "low" : "high") : view.quality;
  const use3d = view.mode === "3d" && canGl;
  const el = snap.phase === "fight" ? snap.t - snap.fightStart : 0;
  const clock = snap.phase === "fight" ? (el < SUDDEN_MS ? Math.ceil((SUDDEN_MS - el) / 1000) : Math.ceil((FIGHT_MAX_MS - el) / 1000)) : null;
  const alive = snap.players.filter((p) => p.alive).length;
  const ghostMode = !!me && !me.alive && !!me.ghost && fighting;
  const lastRound = snap.history[snap.history.length - 1];

  const cdFrac = (until: number, total: number) => (snap.t >= until ? 1 : Math.max(0, 1 - (until - snap.t) / total));
  const scoreOrder = [...snap.players].sort((a, b) => b.score - a.score || a.seat - b.seat);

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          🥊 라운드 {snap.round}/{snap.options.rounds}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="tabular-nums">
          {clock !== null ? (snap.sudden ? <span className="font-bold text-rose-300 light:text-rose-600">⚠️ 서든데스 {clock}초</span> : <>⏱ 서든데스까지 {clock}초</>) : snap.phase === "countdown" ? "준비" : snap.phase === "roundEnd" ? "라운드 끝" : "끝"}
        </span>
        <span>
          생존 <b className="text-white light:text-slate-900">{alive}</b>/{snap.seatCount}
        </span>
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => setRulebook(true)} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300">
            📖 룰북
          </button>
          <button type="button" onClick={() => setSettings((v) => !v)} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300" aria-expanded={settings}>
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
              className={`rounded-full border px-2.5 py-1 ${view.mode === m ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 light:border-slate-300"}`}
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
              className={`rounded-full border px-2.5 py-1 ${view.quality === q ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 light:border-slate-300"}`}
            >
              {q === "auto" ? "자동" : q === "high" ? "높음" : "낮음(빠름)"}
            </button>
          ))}
          {!canGl && <span className="text-amber-300">이 기기는 3D(WebGL)를 지원하지 않아 2D로 보여요</span>}
        </div>
      )}

      {/* 점수판 */}
      <div className="flex flex-wrap gap-1.5">
        {scoreOrder.map((p) => (
          <div
            key={p.seat}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"} ${p.alive ? "" : "opacity-60"}`}
            title={`${SEAT_COLOR_NAMES[p.seat % 6]} ${SEAT_SYMBOLS[p.seat % 6]}`}
          >
            <span aria-hidden className="text-sm leading-none" style={{ color: SEAT_COLORS[p.seat % 6] }}>
              {SEAT_SYMBOLS[p.seat % 6]}
            </span>
            <span className="max-w-[6.5rem] truncate font-semibold text-white light:text-slate-900">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
            {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
            <b className="tabular-nums text-amber-200 light:text-amber-700">{p.score}점</b>
            {snap.phase !== "gameOver" && (p.alive ? <HeatBadge heat={p.heat} /> : <span className="text-[11px]">{p.ghost ? "👻" : "💀"}</span>)}
            {p.alive && p.shield && <span aria-label="방패">🛡️</span>}
          </div>
        ))}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-sky-300 select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[64svh] min-h-[340px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? (
          <ArenaScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} fx={fx} puffs={puffs} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} />
        ) : (
          <Arena2D shared={shared} />
        )}

        {/* 이름표 (위치는 무대가 매 프레임 옮김) */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {snap.players.map((p) => (
            <div
              key={p.seat}
              ref={(el) => {
                shared.current.labels[p.seat] = el;
              }}
              className="absolute top-0 left-0 flex flex-col items-center gap-0.5 whitespace-nowrap"
              style={{ display: "none" }}
            >
              <div className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                <span style={{ color: SEAT_COLORS[p.seat % 6] }} aria-hidden>
                  {SEAT_SYMBOLS[p.seat % 6]}
                </span>
                <span className="max-w-[5.5rem] truncate">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
                {!p.alive && p.ghost ? <span>👻</span> : <HeatBadge heat={p.heat} compact />}
              </div>
              {p.seat === mySeat && p.alive && <div className="h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />}
            </div>
          ))}
        </div>

        {/* 맞으면 붉은 테두리 */}
        <div key={flash} className={`pointer-events-none absolute inset-0 z-10 ${flash > 0 ? "animate-[ba-flash_0.45s_ease-out]" : ""}`} style={{ boxShadow: "inset 0 0 0 0 transparent" }} />

        {/* 알림판: KO 기록 */}
        <div className="pointer-events-none absolute top-2 right-2 z-20 flex max-w-[60%] flex-col items-end gap-1">
          {feed.map((f) => (
            <div key={f.id} className="rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white shadow">
              {f.text}
            </div>
          ))}
        </div>

        {/* 배너 */}
        <div className="pointer-events-none absolute inset-x-0 top-[18%] z-20 flex flex-col items-center gap-2">
          {snap.phase === "countdown" && (
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold text-white drop-shadow">라운드 {snap.round}</span>
              <span key={countLeft} className="animate-[ba-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft}
              </span>
              {snap.round === 1 && <span className="mt-1 rounded-full bg-black/45 px-3 py-1 text-xs text-white">{touch ? "왼쪽을 끌어 이동 · 오른쪽 버튼으로 대시·점프·버티기" : "WASD/방향키 이동 · Space 대시 · K 점프 · Shift 버티기"}</span>}
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[ba-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-amber-400 text-slate-900" : b.tone === "warn" ? "bg-rose-600 text-white" : b.tone === "ko" ? "bg-fuchsia-600 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-4xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 내 발밑 경고 (소리 없이도 보이게) */}
        {underWarn && fighting && <div className="pointer-events-none absolute inset-x-0 bottom-[30%] z-20 mx-auto w-fit animate-pulse rounded-full bg-rose-600/90 px-3 py-1 text-xs font-bold text-white">⚠️ 발밑이 무너져요! 피하세요</div>}

        {/* 내가 떨어짐 */}
        {myOut && snap.phase === "fight" && (
          <div className="pointer-events-none absolute inset-x-0 top-[34%] z-20 flex flex-col items-center gap-1">
            <div className="animate-[ba-pop_0.4s_ease-out] text-5xl font-black text-rose-500 drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">OUT!</div>
            <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              {myOut.by >= 0 ? `${names[myOut.by] ?? "누군가"}에게 밀려 떨어졌어요` : "섬 밖으로 떨어졌어요"}
              {snap.options.ghosts ? " · 👻 유령으로 입김을 불어 방해할 수 있어요" : " · 다음 라운드를 기다려요"}
            </div>
          </div>
        )}

        {/* 라운드 결과 */}
        {snap.phase === "roundEnd" && lastRound && (
          <div className="absolute inset-x-3 top-[14%] z-30 mx-auto max-w-sm animate-[ba-pop_0.4s_ease-out] rounded-2xl border border-white/15 bg-slate-950/85 p-4 text-center text-white shadow-2xl">
            <p className="text-xs text-white/60">라운드 {lastRound.round} 결과</p>
            <p className="mt-1 text-xl font-black">
              {lastRound.winner >= 0 ? (
                <>
                  🏆 <SeatTag seat={lastRound.winner} names={names} me={mySeat} /> 생존!
                </>
              ) : lastRound.draw && lastRound.order.length === snap.seatCount ? (
                "🤝 동시 추락 무승부"
              ) : (
                "⏰ 시간 종료 무승부"
              )}
            </p>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {[...snap.players]
                .sort((a, b) => b.score - a.score || a.seat - b.seat)
                .map((p) => (
                  <li key={p.seat} className="flex items-center justify-between gap-2">
                    <SeatTag seat={p.seat} names={names} me={mySeat} />
                    <span className="tabular-nums">
                      {lastRound.pts[p.seat] > 0 && <span className="mr-2 text-emerald-300">+{lastRound.pts[p.seat]}</span>}
                      {lastRound.kos[p.seat] > 0 && <span className="mr-2 text-amber-200">💥{lastRound.kos[p.seat]}</span>}
                      <b>{p.score}점</b>
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-[11px] text-white/50">{snap.round < snap.options.rounds ? `곧 라운드 ${snap.round + 1} — 1등보다 4점 이상 뒤진 사람은 🛡️ 방패를 들고 시작` : "최종 결과로…"}</p>
          </div>
        )}

        {/* 최종 결과 */}
        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}

        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        {/* 전체화면 */}
        <button type="button" onClick={toggleFull} className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white" aria-label={full ? "전체화면 끄기" : "전체화면"}>
          {full ? "↙ 작게" : "⛶ 크게"}
        </button>

        {/* 터치 조작 */}
        {touch && !ended && snap.phase !== "gameOver" && (me?.alive || ghostMode) && (
          <>
            <Joystick onMove={controls.setStick} />
            <div className="absolute right-3 bottom-3 z-20 flex items-end gap-2">
              {ghostMode ? (
                <CdButton label="💨" sub="입김" big ariaLabel="유령 입김" frac={cdFrac(me.ghost!.cdAt, GUST_CD_MS)} onDown={() => controls.press("dash")} />
              ) : (
                <>
                  <div className="flex flex-col items-center gap-2">
                    <CdButton label="⤴" sub="점프" ariaLabel="점프" frac={cdFrac(me.jumpCdAt, JUMP_CD_MS)} onDown={() => controls.press("jump")} />
                    <CdButton label="🛡" sub="버티기" ariaLabel="버티기 (누르고 있기)" frac={me.stamina >= 0.15 || me.bracing ? 1 : me.stamina / 0.15} active={me.bracing} onDown={() => controls.setBrace(true)} onUp={() => controls.setBrace(false)} />
                  </div>
                  <CdButton label="💨" sub="대시" big ariaLabel="대시" frac={cdFrac(me.dashCdAt, DASH_CD_MS)} onDown={() => controls.press("dash")} />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 내 상태 + 키 안내 (데스크톱) */}
      {me && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          {me.alive ? (
            <>
              <span>
                내 열기 <HeatBadge heat={me.heat} /> <span className="text-white/40 light:text-slate-400">(높을수록 멀리 날아가요)</span>
              </span>
              <Meter label="💨 대시" frac={cdFrac(me.dashCdAt, DASH_CD_MS)} />
              <Meter label="⤴ 점프" frac={cdFrac(me.jumpCdAt, JUMP_CD_MS)} />
              <Meter label="🛡 버티기 힘" frac={me.stamina} tone={me.bracing ? "sky" : "emerald"} />
              {snap.t < me.bigUntil && <span>🍄 거대화 {Math.ceil((me.bigUntil - snap.t) / 1000)}초</span>}
              {snap.t < me.turboUntil && <span>⚡ 터보 {Math.ceil((me.turboUntil - snap.t) / 1000)}초</span>}
              {me.shield && <span>🛡️ 방패</span>}
            </>
          ) : ghostMode ? (
            <>
              <span>👻 유령: 움직여서 바라보는 쪽으로 입김(💨)을 불어요 — 열기와 상관없이 살짝 밀고, KO 점수는 없어요</span>
              <Meter label="💨 입김" frac={cdFrac(me.ghost!.cdAt, GUST_CD_MS)} />
            </>
          ) : (
            <span>다음 라운드를 기다리는 중…</span>
          )}
          {!touch && <span className="text-white/40 light:text-slate-400">WASD/방향키 이동 · Space/J 대시 · K/E 점프 · Shift/L 버티기(누르고 있기)</span>}
        </div>
      )}

      {(ended || snap.phase === "gameOver") && (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && onRestart && (
            <button type="button" onClick={onRestart} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400">
              다시하기
            </button>
          )}
        </div>
      )}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        @keyframes ba-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes ba-flash { 0% { box-shadow: inset 0 0 80px 20px rgba(239,68,68,0.75) } 100% { box-shadow: inset 0 0 0 0 rgba(239,68,68,0) } }
      `}</style>
    </div>
  );
}

function HeatBadge({ heat, compact }: { heat: number; compact?: boolean }) {
  const h = Math.round(heat);
  const tone = h >= 120 ? "bg-rose-600 text-white" : h >= 60 ? "bg-orange-500 text-white" : h >= 25 ? "bg-amber-300 text-slate-900" : "bg-white/80 text-slate-900";
  return (
    <span className={`inline-block rounded-full px-1.5 font-black tabular-nums ${compact ? "text-[10px]" : "text-[11px]"} ${tone}`} title="열기 — 높을수록 멀리 날아가요">
      🔥{h}%
    </span>
  );
}

function Meter({ label, frac, tone = "amber" }: { label: string; frac: number; tone?: "amber" | "sky" | "emerald" }) {
  const color = tone === "sky" ? "bg-sky-400" : tone === "emerald" ? "bg-emerald-400" : "bg-amber-400";
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-white/15 light:bg-slate-200">
        <span className={`block h-full ${color}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }} />
      </span>
      {frac >= 1 && <span className="text-emerald-300 light:text-emerald-600">✓</span>}
    </span>
  );
}

function FinalPanel({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.ranks ?? snap.players.map(() => 1);
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || a.seat - b.seat);
  const best = (f: (p: (typeof snap.players)[number]) => number) => {
    const max = Math.max(...snap.players.map(f));
    return max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [];
  };
  const awards: { icon: string; title: string; seats: number[]; value: string }[] = [
    { icon: "💥", title: "KO 왕", seats: best((p) => p.stats.kos), value: `${Math.max(...snap.players.map((p) => p.stats.kos))}KO` },
    { icon: "🏆", title: "생존왕", seats: best((p) => p.stats.roundWins), value: `${Math.max(...snap.players.map((p) => p.stats.roundWins))}라운드` },
    { icon: "🎁", title: "아이템 수집가", seats: best((p) => p.stats.items), value: `${Math.max(...snap.players.map((p) => p.stats.items))}개` },
    { icon: "👻", title: "끈질긴 유령", seats: best((p) => p.stats.gusts), value: `${Math.max(...snap.players.map((p) => p.stats.gusts))}번` },
  ].filter((a) => a.seats.length > 0);
  return (
    <div className="absolute inset-x-3 top-[8%] z-30 mx-auto max-h-[84%] max-w-md overflow-y-auto rounded-2xl border border-amber-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
      <p className="text-center text-xs text-white/60">최종 결과 · {snap.options.rounds}라운드</p>
      <p className="mt-1 text-center text-2xl font-black">{ranks[mySeat] === 1 ? "🏆 우승!" : `${ranks[mySeat]}등`}</p>
      <ol className="mt-3 flex flex-col gap-1.5 text-sm">
        {order.map((p) => (
          <li key={p.seat} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
            <span className="flex items-center gap-2">
              <b className="w-6 text-center">{ranks[p.seat] === 1 ? "🥇" : ranks[p.seat] === 2 ? "🥈" : ranks[p.seat] === 3 ? "🥉" : ranks[p.seat]}</b>
              <SeatTag seat={p.seat} names={names} me={mySeat} />
            </span>
            <span className="text-xs text-white/70 tabular-nums">
              🏆{p.stats.roundWins} · 💥{p.stats.kos} · ☁️{p.stats.falls} · <b className="text-sm text-amber-200">{p.score}점</b>
            </span>
          </li>
        ))}
      </ol>
      {awards.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
          {awards.map((a) => (
            <div key={a.title} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
              <div className="font-bold">
                {a.icon} {a.title} {a.value && <span className="text-white/50">{a.value}</span>}
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
      <p className="mt-3 text-center text-[11px] text-white/50">동점이면 라운드 승 → KO → 덜 떨어진 순</p>
    </div>
  );
}
