"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { buildCourse, cellIndex } from "./course";
import { COURSES, GRAB_MIN, LEDGE, OVERHANG, ROPE_LEN, SEAT_COLORS, SEAT_COLOR_NAMES, SEAT_SYMBOLS, SMOOTH, STAM_MAX } from "./data";
import type { SnapBuffer, Snap } from "./net";
import { getRopeClimbSound } from "./ropeClimbSound";
import RulebookModal from "./RulebookModal";
import { mvpSeats, type GameEvent, type PlayerInput, type PlayerState } from "./sim";
import type { SceneShared } from "./three/WallScene";
import Wall2D from "./Wall2D";

const WallScene = dynamic(() => import("./three/WallScene"), { ssr: false, loading: () => null });

/**
 * 한 줄 등반대 게임 화면 (룰북 §8~§10): 3D/2D 암벽 + 이름표 + 팀 체력판 + 고도계 + 조작(키보드·터치) +
 * 상황 안내 한 줄 + 결과. 방장이든 손님이든 같은 스냅샷 버퍼를 그린다.
 */

export interface RopeClimbBoardProps {
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
const VIEW_KEY = "rope-climbers:view";

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
  grab: ["Space", "KeyK"],
  haul: ["ShiftLeft", "ShiftRight", "KeyE", "KeyJ"],
};

function useControls(onInput: (inp: PlayerInput) => void, enabled: boolean, onLocalGrab: () => void) {
  const held = useRef(new Set<string>());
  const stick = useRef<{ x: number; y: number } | null>(null);
  const haulBtn = useRef(false);
  const grab = useRef(0);
  const last = useRef("");
  const lastSent = useRef(0);
  const cbRef = useRef(onInput);
  const grabRef = useRef(onLocalGrab);
  useEffect(() => {
    cbRef.current = onInput;
    grabRef.current = onLocalGrab;
  }, [onInput, onLocalGrab]);

  const compute = useCallback((): PlayerInput => {
    const h = held.current;
    let mx = 0;
    let my = 0;
    if (KEYS.left.some((k) => h.has(k))) mx -= 1;
    if (KEYS.right.some((k) => h.has(k))) mx += 1;
    if (KEYS.up.some((k) => h.has(k))) my += 1;
    if (KEYS.down.some((k) => h.has(k))) my -= 1;
    if (stick.current) {
      mx += stick.current.x;
      my += stick.current.y;
    }
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    return { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, grab: grab.current, haul: haulBtn.current || KEYS.haul.some((k) => h.has(k)) };
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

  const pressGrab = useCallback(() => {
    grab.current += 1;
    grabRef.current();
    flush(true);
  }, [flush]);

  useEffect(() => {
    if (!enabled) return;
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const all = Object.values(KEYS).flat();
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || !all.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      held.current.add(e.code);
      if (KEYS.grab.includes(e.code)) pressGrab();
      else flush(true);
    };
    const up = (e: KeyboardEvent) => {
      if (!held.current.delete(e.code)) return;
      flush(true);
    };
    const blur = () => {
      held.current.clear();
      stick.current = null;
      haulBtn.current = false;
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
  }, [enabled, flush, pressGrab]);

  return {
    pressGrab,
    setHaul: (v: boolean) => {
      haulBtn.current = v;
      flush(true);
    },
    setStick: (v: { x: number; y: number } | null) => {
      stick.current = v;
      flush(true);
    },
  };
}

/* ── 터치 조이스틱 ─────────────────────────────────────────────────── */

function Joystick({ onMove }: { onMove: (v: { x: number; y: number } | null) => void }) {
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
        const n = Math.max(1, Math.hypot(dx, dy));
        // 화면 아래(+dy)는 벽 아래(−y)
        onMove(l < 6 ? { x: 0, y: 0 } : { x: (dx / n) * m, y: (-dy / n) * m });
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
        <div className="pointer-events-none absolute bottom-6 left-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/45 bg-black/20 text-center text-[11px] font-semibold text-white/80">
          여기를 끌어
          <br />
          오르기
        </div>
      )}
    </div>
  );
}

/* ── 보드 ───────────────────────────────────────────────────────────── */

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "go" | "warn" | "good" | "info" | "wind";
}

interface Feed {
  id: number;
  text: ReactNode;
}

function SeatTag({ seat, names, me }: { seat: number; names: Record<number, string>; me: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SEAT_COLORS[seat % 4] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat % 4]}</span>
      <span className="max-w-[7rem] truncate text-white light:text-slate-900">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

function stateIcon(snap: Snap, p: PlayerState, onLedge: boolean): { icon: string; label: string } {
  if (p.summit) return { icon: "🚩", label: "정상" };
  if (snap.t < p.stunUntil) return { icon: "😵", label: "휘청" };
  if (p.mode === "air") return p.hang ? { icon: "🪢", label: "매달림" } : { icon: "⬇️", label: "추락 중" };
  if (p.hauling) return { icon: "💪", label: "당기는 중" };
  if (onLedge) return { icon: "💤", label: "쉬는 중" };
  return { icon: "🧗", label: "등반" };
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function RopeClimbBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: RopeClimbBoardProps) {
  const [view, setView] = useState<{ mode: ViewMode; quality: Quality }>({ mode: "3d", quality: "auto" });
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);
  const shared = useRef<SceneShared>({ buf, mySeat, shake: 0, labels: [], fx: [] });
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

  const spec = COURSES[snap.options.course];
  const course = useMemo(() => buildCourse(snap.seed, snap.options.course), [snap.seed, snap.options.course]);
  const cellOf = useCallback(
    (p: PlayerState) => {
      const i = cellIndex(course, p.x, p.y);
      return i < 0 ? undefined : snap.gone.includes(i) ? SMOOTH : course.cells[i];
    },
    [course, snap.gone],
  );
  const me = snap.players[mySeat];
  const climbing = snap.phase === "climb";
  const sound = getRopeClimbSound;
  const anyHang = snap.players.some((p) => p.mode === "air");
  const timeLeft = climbing ? spec.limitMs - (snap.t - snap.climbStart) : spec.limitMs;
  const bgmLevel = !climbing ? 0 : snap.lives === 0 || timeLeft < 30_000 ? 2 : anyHang ? 1 : 0;
  useSuiteBgm(sound, !ended && snap.phase !== "gameOver", bgmLevel);

  const showBanner = useCallback((text: string, tone: Banner["tone"], sub?: string, ms = 1500) => {
    const id = ++bannerSeq.current;
    setBanners((b) => [...b.slice(-2), { id, text, tone, sub }]);
    window.setTimeout(() => setBanners((b) => b.filter((x) => x.id !== id)), ms);
  }, []);

  const pushFeed = useCallback((text: ReactNode) => {
    const id = ++bannerSeq.current;
    setFeed((f) => [...f.slice(-4), { id, text }]);
    window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 5000);
  }, []);

  // 내가 누른 잡기/도약은 바로 소리 (방장 확인을 기다리지 않음)
  const onLocalGrab = useCallback(() => {
    const p = snap.players[mySeat];
    if (!p || snap.phase !== "climb") return;
    if (snap.t < p.stunUntil) sound().play("denied");
    else if (p.mode === "grip") sound().play("leap");
    else if (p.tired && p.stam < GRAB_MIN) sound().play("denied");
  }, [snap, mySeat, sound]);

  const controls = useControls(onInput, !ended && snap.phase !== "gameOver", onLocalGrab);

  // 새 이벤트 → 연출·소리·알림
  const lastFresh = useRef(0);
  useEffect(() => {
    if (fresh.seq === lastFresh.current) return;
    lastFresh.current = fresh.seq;
    const now = performance.now();
    const s = sound();
    const sh = shared.current;
    const posOf = (seat: number) => snap.players[seat] ?? { x: 0, y: 0 };
    const nm = (seat: number) => (seat === mySeat ? "나" : (names[seat] ?? `${seat + 1}번`));
    // 새 스냅샷의 이벤트를 화면 효과·알림으로 옮기는 곳 — 이벤트 묶음마다 한 번만 돈다
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "go":
          s.play("go");
          showBanner("등반 시작!", "go", undefined, 900);
          break;
        case "leap":
          if (ev.s !== mySeat) s.play("leap");
          break;
        case "grab":
          s.play("grab");
          break;
        case "land":
          s.play("land", ev.hard ? 1 : 0);
          if (ev.hard && ev.s === mySeat) sh.shake = 0.5;
          break;
        case "slip":
          s.play("slip");
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} /> <span className="text-rose-300">손을 놓쳤어요!</span>
            </>,
          );
          if (ev.s === mySeat) showBanner("😵 체력 바닥!", "warn", "줄에 매달려 숨을 고르세요", 1400);
          break;
        case "catch": {
          s.play("catch", ev.v);
          const b = posOf(ev.b);
          sh.fx.push({ k: "ring", x: b.x, y: b.y, at: now, color: "#ffb347" });
          if (ev.a === mySeat || ev.b === mySeat) sh.shake = Math.max(sh.shake, 0.6);
          pushFeed(
            <>
              <SeatTag seat={ev.a} names={names} me={mySeat} /> <span className="text-amber-300">🪢 받아냄!</span> <SeatTag seat={ev.b} names={names} me={mySeat} />
            </>,
          );
          if (ev.a === mySeat) showBanner("🪢 받아냈다!", "good", `${nm(ev.b)}을(를) 줄로 붙잡음`, 1300);
          else if (ev.b === mySeat) showBanner("🪢 줄이 살렸다!", "good", `${nm(ev.a)}이(가) 붙잡아 줌`, 1300);
          break;
        }
        case "crack":
          s.play("crack");
          break;
        case "crumble": {
          s.play("crumble");
          const r = Math.floor(ev.i / 14);
          const c = ev.i % 14;
          sh.fx.push({ k: "burst", x: c + 0.5 - 7, y: r + 0.5, at: now, color: "#c98a5a" });
          break;
        }
        case "rockWarn":
          s.play("rockWarn");
          if (me && Math.abs(me.x - ev.x) < 1.3) showBanner("🪨 머리 위 낙석!", "warn", "옆으로 피하세요", 1200);
          break;
        case "rockHit":
          s.play("rockHit");
          sh.fx.push({ k: "burst", x: ev.x, y: ev.y, at: now, color: "#ff5a3c" });
          if (ev.s === mySeat) sh.shake = 1;
          pushFeed(
            <>
              🪨 <SeatTag seat={ev.s} names={names} me={mySeat} /> 낙석에 맞음
            </>,
          );
          break;
        case "windWarn":
          s.play("windWarn");
          showBanner(ev.dir > 0 ? "💨 돌풍 예고 →" : "← 돌풍 예고 💨", "wind", "2초 뒤 — 매달려 있으면 날려요", 1700);
          break;
        case "wind":
          s.play("wind");
          break;
        case "star": {
          s.play("star");
          sh.fx.push({ k: "ring", x: ev.x, y: ev.y, at: now, color: "#fde047" });
          pushFeed(
            <>
              ⭐ <SeatTag seat={ev.s} names={names} me={mySeat} /> 별 획득
            </>,
          );
          break;
        }
        case "camp":
          s.play("camp");
          showBanner(`⛺ 캠프 ${ev.n} 도착`, "good", "여기서부터 다시 시작해요", 1500);
          break;
        case "fall":
          s.play("fall");
          sh.shake = 1;
          showBanner("💥 팀 추락!", "warn", ev.lives > 0 ? `⛑ ${ev.lives}개 남음 — 캠프에서 다시` : "⛑ 0개 — 한 번 더 떨어지면 끝", 2000);
          break;
        case "summit":
          s.play("summit");
          pushFeed(
            <>
              🚩 <SeatTag seat={ev.s} names={names} me={mySeat} /> 정상 도착
            </>,
          );
          break;
        case "over":
          s.play(ev.cleared ? "victory" : "defeat");
          break;
        default:
          break;
      }
    }
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound, me]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  // 체력 경고 (25 아래로 내려갈 때 한 번)
  const lowStam = !!me && climbing && me.mode === "grip" && me.stam < 25 && cellOf(me) !== LEDGE;
  const lastLow = useRef(false);
  useEffect(() => {
    if (lowStam && !lastLow.current) sound().play("tired");
    lastLow.current = lowStam;
  }, [lowStam, sound]);

  // 끌어올리는 동안 줄 당기는 소리
  const hauling = !!me?.hauling && climbing;
  useEffect(() => {
    if (!hauling) return;
    let n = 0;
    sound().play("haul", n++);
    const id = window.setInterval(() => sound().play("haul", n++), 260);
    return () => window.clearInterval(id);
  }, [hauling, sound]);

  const uiClick = useCallback(() => sound().play("ui"), [sound]);

  // 전체화면
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
    else if (full) setFull(false);
    else if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) void el.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  };

  const quality: "high" | "low" = view.quality === "auto" ? (touch || lowFps ? "low" : "high") : view.quality;
  const use3d = view.mode === "3d" && canGl;

  // 지금 상황에 맞는 안내 한 줄 (처음 하는 사람이 다음에 뭘 할지 알게)
  const hint = useMemo((): { text: string; tone: "info" | "warn" | "good" } | null => {
    if (!me || !climbing) return null;
    const grabKey = touch ? "✋ 버튼" : "Space";
    const haulKey = touch ? "🪢 버튼을 꾹" : "Shift를 꾹";
    if (me.summit) return { text: snap.players.some((p) => p.mode === "air") ? `🚩 정상! 매달린 동료를 ${haulKey} 눌러 끌어올리세요` : "🚩 정상 도착! 동료가 모두 올라오면 완등", tone: "good" };
    if (snap.t < me.stunUntil) return { text: "😵 휘청! 잠깐 움직일 수 없어요", tone: "warn" };
    const neighbors = [snap.players[mySeat - 1], snap.players[mySeat + 1]].filter(Boolean) as PlayerState[];
    if (me.mode === "air") {
      if (me.hang) return { text: me.tired && me.stam < GRAB_MIN ? `🪢 줄에 매달려 숨 고르는 중… (체력 ${GRAB_MIN}부터 다시 잡을 수 있어요)` : `🪢 줄에 매달렸어요 — 바위 위에서 ${grabKey}(으)로 다시 잡기 · 좌우로 몸 흔들기`, tone: "info" };
      return { text: `⬇️ 떨어지는 중! 바위 위에서 ${grabKey}(으)로 잡으세요`, tone: "warn" };
    }
    if (neighbors.some((n) => n.mode === "air")) return { text: `🪢 동료가 매달렸어요 — ${haulKey} 눌러 끌어올리세요 (움직이면 같이 끌려와요)`, tone: "warn" };
    const cell = cellOf(me);
    if (cell !== LEDGE && me.stam < 25) return { text: "⚠️ 체력이 바닥나요! 가까운 바위 턱(▬)에서 쉬세요", tone: "warn" };
    if (neighbors.some((n) => n.mode === "grip" && Math.hypot(n.x - me.x, n.y - me.y) > ROPE_LEN - 0.35)) return { text: "🪢 줄이 팽팽해요 — 동료를 기다리거나 가까이 가세요", tone: "info" };
    if (cell === LEDGE && me.stam < STAM_MAX - 2) return { text: "💤 바위 턱에서 쉬는 중 — 체력이 차요", tone: "good" };
    if (cell === OVERHANG) return { text: "▼ 오버행 — 느리고 체력이 2배 넘게 닳아요", tone: "warn" };
    return null;
  }, [me, climbing, snap.players, snap.t, mySeat, cellOf, touch]);

  const stamColor = (v: number) => (v < 25 ? "bg-rose-500" : v < 50 ? "bg-amber-400" : "bg-emerald-400");
  const H = course.height;
  const mvp = snap.phase === "gameOver" ? mvpSeats(snap) : [];

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          {spec.emoji} {spec.name}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className={`tabular-nums ${climbing && timeLeft < 30_000 ? "font-bold text-rose-300 light:text-rose-600" : ""}`}>⏱ {snap.phase === "gameOver" ? mmss(snap.endMs) : mmss(timeLeft)}</span>
        <span className="tabular-nums">
          📍 <b className="text-white light:text-slate-900">{Math.min(H, snap.alt)}</b>/{H}m
        </span>
        <span aria-label={`남은 헬멧 ${snap.lives}개`}>
          {"⛑".repeat(snap.lives) || "⛑✕"} <span className="text-white/40 light:text-slate-400">추락 {snap.falls}</span>
        </span>
        <span>
          ⭐ {snap.stars.filter(Boolean).length}/{snap.stars.length}
        </span>
        <span className="flex items-center gap-1.5">
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
                uiClick();
                const v = { ...view, mode: m };
                setView(v);
                saveView(v);
              }}
              className={`rounded-full border px-2.5 py-1 ${view.mode === m ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 light:border-slate-300"}`}
            >
              {m === "3d" ? "🎥 3D" : "🗺️ 2D 단면"}
            </button>
          ))}
          <span className="ml-2">화질</span>
          {(["auto", "high", "low"] as Quality[]).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                uiClick();
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

      {/* 팀 체력판 — 줄 순서대로 (옆 칸이 나와 줄로 이어진 사람) */}
      <div className="flex flex-wrap items-stretch gap-1">
        {snap.players.map((p, i) => {
          const st = stateIcon(snap, p, cellOf(p) === LEDGE && p.mode === "grip");
          return (
            <div key={p.seat} className="flex items-center gap-1">
              {i > 0 && (
                <span className={`text-[10px] font-bold ${snap.taut[i - 1] ? "text-orange-400" : "text-white/30 light:text-slate-300"}`} title={snap.taut[i - 1] ? "줄이 팽팽함" : "줄이 느슨함"} aria-label={snap.taut[i - 1] ? "줄 팽팽" : "줄 느슨"}>
                  {snap.taut[i - 1] ? "━🪢━" : "╌╌"}
                </span>
              )}
              <div
                className={`flex min-w-[7.5rem] flex-col gap-0.5 rounded-xl border px-2 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
                title={`${SEAT_COLOR_NAMES[p.seat % 4]} ${SEAT_SYMBOLS[p.seat % 4]} · ${st.label}`}
              >
                <span className="flex items-center gap-1">
                  <span aria-hidden style={{ color: SEAT_COLORS[p.seat % 4] }}>
                    {SEAT_SYMBOLS[p.seat % 4]}
                  </span>
                  <span className="max-w-[5rem] truncate font-semibold text-white light:text-slate-900">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
                  {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
                  <span className="ml-auto" aria-label={st.label}>
                    {st.icon}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15 light:bg-slate-200">
                    <span className={`block h-full ${stamColor(p.stam)}`} style={{ width: `${Math.round(Math.max(0, Math.min(100, p.stam)))}%` }} />
                  </span>
                  <span className="w-6 text-right text-[10px] tabular-nums text-white/60 light:text-slate-500">{Math.round(p.stam)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#8fc7e8] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[66svh] min-h-[360px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? (
          <WallScene shared={shared} names={names} seatCount={snap.seatCount} seed={snap.seed} course={snap.options.course} quality={quality} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} />
        ) : (
          <Wall2D shared={shared} />
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
                <span style={{ color: SEAT_COLORS[p.seat % 4] }} aria-hidden>
                  {SEAT_SYMBOLS[p.seat % 4]}
                </span>
                <span className="max-w-[5.5rem] truncate">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
              </div>
              <div className="h-1 w-12 overflow-hidden rounded-full bg-black/50">
                <div className={`h-full ${stamColor(p.stam)}`} style={{ width: `${Math.round(Math.max(0, Math.min(100, p.stam)))}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* 고도계: 오른쪽 세로 막대 (캠프 ⛺ · 정상 🚩 · 자리 표식) */}
        <div className="pointer-events-none absolute top-10 right-2 bottom-24 z-10 w-5 rounded-full bg-black/35" aria-hidden>
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-sm">🚩</span>
          {course.camps.slice(1).map((cp, i) => (
            <span key={i} className={`absolute left-1/2 -translate-x-1/2 translate-y-1/2 text-[10px] ${snap.camp > i ? "" : "opacity-50"}`} style={{ bottom: `${(cp.row / H) * 100}%` }}>
              ⛺
            </span>
          ))}
          {snap.players.map((p) => (
            <span key={p.seat} className="absolute -translate-x-full translate-y-1/2 pr-0.5 text-[11px] font-bold drop-shadow" style={{ bottom: `${Math.max(0, Math.min(1, p.y / H)) * 100}%`, left: 0, color: SEAT_COLORS[p.seat % 4] }}>
              {SEAT_SYMBOLS[p.seat % 4]}
            </span>
          ))}
        </div>

        {/* 알림판 */}
        <div className="pointer-events-none absolute top-2 right-9 z-20 flex max-w-[60%] flex-col items-end gap-1">
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
              <span className="rounded-full bg-black/45 px-3 py-0.5 text-sm font-bold text-white">
                {spec.emoji} {spec.name} · {H}m
              </span>
              <span key={countLeft} className="animate-[rc-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {Math.min(3, countLeft)}
              </span>
              <span className="mt-1 max-w-sm rounded-2xl bg-black/50 px-3 py-1.5 text-center text-xs leading-relaxed text-white">
                {touch ? "왼쪽을 끌어 오르기 · ✋ 도약/잡기 · 🪢 꾹 눌러 끌어올리기" : "WASD/방향키 오르기 · Space 도약/잡기 · Shift 꾹 눌러 끌어올리기"}
                <br />
                옆 사람과 줄 {ROPE_LEN}m로 묶여 있어요 — 모두 정상에 올라야 완등!
              </span>
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[rc-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-amber-300 text-slate-900" : b.tone === "warn" ? "bg-rose-600 text-white" : b.tone === "wind" ? "bg-sky-200 text-slate-900" : b.tone === "good" ? "bg-emerald-500 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-4xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 돌풍 표시 (소리 없이도 보이게) */}
        {climbing && snap.wind && (
          <div className="pointer-events-none absolute inset-x-0 top-11 z-20 mx-auto w-fit rounded-full bg-sky-100/95 px-3 py-1 text-xs font-bold text-slate-900">
            {snap.t < snap.wind.from ? `💨 돌풍 ${Math.ceil((snap.wind.from - snap.t) / 1000)}초 뒤 ${snap.wind.dir > 0 ? "→" : "←"}` : `💨 돌풍 ${snap.wind.dir > 0 ? "→→→" : "←←←"} 꽉 잡으세요`}
          </div>
        )}

        {/* 상황 안내 */}
        {hint && (
          <div className={`pointer-events-none absolute inset-x-2 z-20 mx-auto w-fit max-w-full rounded-full px-3 py-1 text-center text-xs font-bold break-keep ${touch ? "bottom-[50%]" : "bottom-3"} ${hint.tone === "warn" ? "animate-pulse bg-rose-600/90 text-white" : hint.tone === "good" ? "bg-emerald-600/90 text-white" : "bg-slate-900/80 text-white"}`}>{hint.text}</div>
        )}

        {/* 결과 */}
        {snap.phase === "gameOver" && (
          <div className="absolute inset-x-3 top-[5%] z-30 mx-auto max-h-[88%] max-w-md overflow-y-auto rounded-2xl border border-amber-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
            <p className="text-center text-xs text-white/60">
              {spec.emoji} {spec.name} · {snap.seatCount}인 등반대
            </p>
            <p className="mt-1 text-center text-2xl font-black">{snap.cleared ? "🚩 완등!" : snap.lives === 0 && snap.falls > snap.options.lives ? "💥 추락으로 실패" : "⏰ 시간 초과"}</p>
            {snap.cleared ? (
              <p className="mt-1 text-center text-3xl tracking-widest" aria-label={`별 ${snap.grade}개`}>
                {"⭐".repeat(snap.grade)}
                <span className="opacity-25">{"⭐".repeat(3 - snap.grade)}</span>
              </p>
            ) : (
              <p className="mt-1 text-center text-sm text-white/70">
                최고 높이 {Math.min(H, snap.alt)}m / {H}m
              </p>
            )}
            <p className="mt-1 text-center text-xs text-white/60 tabular-nums">
              ⏱ {mmss(snap.endMs)} (⭐ 기준 {mmss(spec.parMs)}) · 팀 추락 {snap.falls}번 (⭐ 기준 1번 이하) · 별 {snap.stars.filter(Boolean).length}/{snap.stars.length}
            </p>
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-white/50">
                  <th className="py-1 text-left font-normal">등반가</th>
                  <th className="font-normal" title="팀 최고 높이를 새로 올린 거리">선등</th>
                  <th className="font-normal" title="동료를 끌어올린 거리">끌기</th>
                  <th className="font-normal" title="떨어지는 동료를 줄로 받아낸 횟수">받기</th>
                  <th className="font-normal">⭐</th>
                  <th className="text-right font-normal">기여</th>
                </tr>
              </thead>
              <tbody>
                {[...snap.players]
                  .sort((a, b) => b.pts - a.pts || a.seat - b.seat)
                  .map((p) => (
                    <tr key={p.seat} className={p.seat === mySeat ? "bg-white/10" : ""}>
                      <td className="py-1 pl-1">
                        <SeatTag seat={p.seat} names={names} me={mySeat} />
                        {mvp.includes(p.seat) && <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[10px] font-black text-slate-900">MVP</span>}
                      </td>
                      <td className="text-center tabular-nums">{Math.round(p.stats.leadM)}m</td>
                      <td className="text-center tabular-nums">{Math.round(p.stats.haulM)}m</td>
                      <td className="text-center tabular-nums">{p.stats.catches}</td>
                      <td className="text-center tabular-nums">{p.stats.stars}</td>
                      <td className="pr-1 text-right font-bold tabular-nums text-amber-200">{p.pts}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="mt-3 text-center text-[11px] text-white/50">협동 게임이라 완등하면 모두 승리예요. 기여 점수는 MVP 표시에만 쓰여요.</p>
          </div>
        )}

        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        <button type="button" onClick={() => { uiClick(); toggleFull(); }} className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white" aria-label={full ? "전체화면 끄기" : "전체화면"}>
          {full ? "↙ 작게" : "⛶ 크게"}
        </button>

        {/* 터치 조작 */}
        {touch && !ended && snap.phase !== "gameOver" && me && (
          <>
            <Joystick onMove={controls.setStick} />
            <div className="absolute right-9 bottom-3 z-20 flex items-end gap-2">
              <button
                type="button"
                aria-label="줄 당기기 (누르고 있기)"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  controls.setHaul(true);
                }}
                onPointerUp={() => controls.setHaul(false)}
                onPointerCancel={() => controls.setHaul(false)}
                onContextMenu={(e) => e.preventDefault()}
                className={`flex h-16 w-16 touch-none flex-col items-center justify-center rounded-full border-2 font-bold text-white shadow-lg select-none ${me.hauling ? "border-amber-300 bg-amber-500/70" : "border-white/70 bg-black/45"}`}
              >
                <span className="text-xl leading-none">🪢</span>
                <span className="mt-0.5 text-[10px] leading-none">당기기</span>
              </button>
              <button
                type="button"
                aria-label={me.mode === "grip" ? "도약" : "잡기"}
                onPointerDown={(e) => {
                  e.preventDefault();
                  controls.pressGrab();
                }}
                onContextMenu={(e) => e.preventDefault()}
                className="flex h-20 w-20 touch-none flex-col items-center justify-center rounded-full border-2 border-white/70 bg-black/45 font-bold text-white shadow-lg select-none"
              >
                <span className="text-2xl leading-none">{me.mode === "grip" ? "⤴" : "✋"}</span>
                <span className="mt-0.5 text-[10px] leading-none">{me.mode === "grip" ? "도약" : "잡기"}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 키 안내 */}
      {!touch && snap.phase !== "gameOver" && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50 light:border-slate-200 light:bg-white light:text-slate-500">
          WASD/방향키 오르기 · <b>Space</b>/K — 잡고 있을 때 도약(방향키와 함께) 또는 손 놓기, 공중에선 잡기 · <b>Shift</b>/E/J 꾹 — 매달린 옆 사람 끌어올리기
        </div>
      )}

      {(ended || snap.phase === "gameOver") && (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && onRestart && (
            <button type="button" onClick={onRestart} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-300">
              다시 오르기
            </button>
          )}
        </div>
      )}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        @keyframes rc-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
      `}</style>
    </div>
  );
}
