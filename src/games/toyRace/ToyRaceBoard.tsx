"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { FINISH_GRACE_MS, GP_POINTS, INTERMISSION_MS, ITEM_INFO, ITEM_KINDS, ITEM_ROLL_MS, MODE_INFO, SEAT_COLORS, SEAT_COLOR_NAMES, SEAT_SYMBOLS, TOY_AUTO_MS, TRACK_INFO, fmtTime } from "./data";
import { LocalDriver, type LocalEvent } from "./local";
import type { Snap, SnapBuffer } from "./net";
import RulebookModal from "./RulebookModal";
import { FL, lapShown, type GameEvent, type PlayerState, type PosReport } from "./sim";
import { getToyRaceSound } from "./toyRaceSound";
import { trainState, trackFor } from "./track";
import { drawTop, othersOf, type SceneShared } from "./view";
import type { FxItem } from "./three/Fx";

const RaceScene = dynamic(() => import("./three/RaceScene"), { ssr: false, loading: () => null });

/**
 * 장난감 방 레이스 게임 화면 (룰북 §9~§11): 3D/2D 무대 + 내 차 운전(LocalDriver) + HUD + 조작 + 결과.
 * 내 차는 매 프레임 이 기기에서 움직이고 15번/초 방장에게 보고한다. 남의 차·아이템·순위는 스냅샷.
 */

export interface ToyRaceBoardProps {
  snap: Snap;
  buf: SnapBuffer;
  fresh: { events: GameEvent[]; seq: number };
  mySeat: number;
  names: Record<number, string>;
  onReport: (r: PosReport) => void;
  ended: boolean;
  isHost: boolean;
  onRestart?: () => void;
  onLeave: () => void;
  practice?: boolean;
  notice?: string | null;
}

type ViewMode = "3d" | "2d";
type Quality = "auto" | "high" | "low";
interface ViewPref {
  mode: ViewMode;
  quality: Quality;
  cam: "near" | "far";
  assist: boolean;
}
const VIEW_KEY = "toy-room-race:view";
const BEST_KEY = "toy-room-race:best:";

function loadView(): ViewPref {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "{}");
    return { mode: v.mode === "2d" ? "2d" : "3d", quality: v.quality === "high" || v.quality === "low" ? v.quality : "auto", cam: v.cam === "far" ? "far" : "near", assist: v.assist === true };
  } catch {
    return { mode: "3d", quality: "auto", cam: "near", assist: false };
  }
}

function saveView(v: ViewPref) {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* 저장 안 돼도 됨 */
  }
}

function loadBest(track: string): number {
  try {
    return Number(window.localStorage.getItem(BEST_KEY + track)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(track: string, ms: number) {
  try {
    window.localStorage.setItem(BEST_KEY + track, String(Math.round(ms)));
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

const KEYS = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  brake: ["KeyS", "ArrowDown"],
  drift: ["ShiftLeft", "ShiftRight", "KeyJ"],
  item: ["Space", "KeyK", "KeyE"],
  toy: ["KeyQ", "KeyL"],
  reset: ["KeyR"],
  rocket: ["KeyW", "ArrowUp"],
};
const ALL_KEYS = Object.values(KEYS).flat();

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "go" | "gold" | "bad" | "info" | "toy";
}

interface Feed {
  id: number;
  text: ReactNode;
}

function SeatTag({ seat, names, me }: { seat: number; names: Record<number, string>; me: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SEAT_COLORS[seat % 8] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat % 8]}</span>
      <span className="max-w-[7rem] truncate text-white light:text-slate-900">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

/** 누르고 있는 동안 켜지는 터치 버튼 */
function HoldButton({ label, sub, onChange, size = 64, tone = "plain", ariaLabel }: { label: ReactNode; sub?: string; onChange: (down: boolean) => void; size?: number; tone?: "plain" | "drift" | "brake"; ariaLabel: string }) {
  const [down, setDown] = useState(false);
  const set = (v: boolean) => {
    setDown(v);
    onChange(v);
  };
  const ring = tone === "drift" ? "border-sky-300/80" : tone === "brake" ? "border-rose-300/80" : "border-white/60";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={down}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => down && set(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex touch-none select-none flex-col items-center justify-center rounded-full border-2 font-bold text-white shadow-lg ${ring} ${down ? "bg-white/35" : "bg-black/40"}`}
      style={{ width: size, height: size }}
    >
      <span className="text-2xl leading-none">{label}</span>
      {sub && <span className="mt-0.5 text-[10px] leading-none">{sub}</span>}
    </button>
  );
}

function TapButton({ label, sub, onTap, size = 60, disabled, ariaLabel, glow }: { label: ReactNode; sub?: string; onTap: () => void; size?: number; disabled?: boolean; ariaLabel: string; glow?: boolean }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        onTap();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex touch-none select-none flex-col items-center justify-center rounded-full border-2 font-bold shadow-lg ${disabled ? "border-white/25 bg-black/30 text-white/40" : glow ? "animate-pulse border-amber-200 bg-amber-500/60 text-white" : "border-white/70 bg-black/45 text-white"}`}
      style={{ width: size, height: size }}
    >
      <span className="text-2xl leading-none">{label}</span>
      {sub && <span className="mt-0.5 text-[10px] leading-none">{sub}</span>}
    </button>
  );
}

function Minimap({ shared }: { shared: React.MutableRefObject<SceneShared> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      const cv = ref.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      drawTop(g, w, h, shared.current, performance.now(), true);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} aria-label="작은 지도" className="pointer-events-none absolute top-2 right-2 z-20 h-24 w-32 rounded-xl bg-black/35 sm:h-32 sm:w-44" />;
}

function Top2D({ shared }: { shared: React.MutableRefObject<SceneShared> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#d9c2a0";
      g.fillRect(0, 0, w, h);
      drawTop(g, w, h, shared.current, performance.now(), false);
      for (const el of shared.current.labels) if (el) el.style.display = "none";
      shared.current.shake = Math.max(0, shared.current.shake - 0.04);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="h-full w-full" style={{ touchAction: "none" }} />;
}

export default function ToyRaceBoard({ snap, buf, fresh, mySeat, names, onReport, ended, isHost, onRestart, onLeave, practice, notice }: ToyRaceBoardProps) {
  const [view, setView] = useState<ViewPref>({ mode: "3d", quality: "auto", cam: "near", assist: false });
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [flash, setFlash] = useState<{ id: number; tone: "gold" | "bad" | "blue" } | null>(null);
  const [hud, setHud] = useState({ speed: 0, tier: 0 as 0 | 1 | 2, wrong: false, boost: false, draft: false });
  const [myBest, setMyBest] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);
  const [driver] = useState(() => new LocalDriver(mySeat));
  const shared = useRef<SceneShared>({ buf, driver, mySeat, shake: 0, labels: [], cam: "near" });
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    shared.current.buf = buf;
    shared.current.mySeat = mySeat;
    shared.current.cam = view.cam;
    shared.current.driver.seat = mySeat;
    shared.current.driver.assist = view.assist;
  }, [buf, mySeat, view.cam, view.assist]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setView(loadView());
    setCanGl(webglOk());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMyBest(loadBest(snap.track));
  }, [snap.track]);

  const me = snap.players[mySeat];
  const racing = snap.phase === "race";
  const sound = getToyRaceSound;
  const L = trackFor(snap.track).L;
  const graceLeft = racing && snap.firstFinishAt > 0 ? Math.max(0, snap.firstFinishAt + FINISH_GRACE_MS - snap.t) : 0;
  const finalLap = !!me && racing && me.laps >= snap.options.laps - 1 && !me.finishedAt;
  const bgmLevel = !racing ? 0 : graceLeft > 0 ? 2 : finalLap ? 1 : 0;
  useSuiteBgm(sound, !ended && snap.phase !== "gameOver", bgmLevel);

  const showBanner = useCallback((text: string, tone: Banner["tone"], sub?: string, ms = 1400) => {
    const id = ++bannerSeq.current;
    setBanners((b) => [...b.slice(-2), { id, text, tone, sub }]);
    window.setTimeout(() => setBanners((b) => b.filter((x) => x.id !== id)), ms);
  }, []);
  const pushFeed = useCallback((text: ReactNode) => {
    const id = ++bannerSeq.current;
    setFeed((f) => [...f.slice(-3), { id, text }]);
    window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 4500);
  }, []);

  // --- 내 차 루프: 매 프레임 운전, 66ms마다 보고, 10번/초 HUD ---
  const reportRef = useRef(onReport);
  useEffect(() => {
    reportRef.current = onReport;
  }, [onReport]);
  const localEvRef = useRef<(e: LocalEvent) => void>(() => {});
  useEffect(() => {
    let raf = 0;
    let lastRep = 0;
    let lastHud = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const sh = shared.current;
      const driver = sh.driver;
      driver.frame(sh.buf, now, othersOf(sh, now));
      if (driver.events.length) {
        const evs = driver.events;
        driver.events = [];
        for (const e of evs) localEvRef.current(e);
      }
      if (now - lastRep >= 66) {
        lastRep = now;
        const s = sh.buf.latest();
        const r = s ? driver.report(s.race) : null;
        if (r) reportRef.current(r);
      }
      if (now - lastHud >= 100) {
        lastHud = now;
        const c = driver.car;
        const wrong = !!c && c.wrongMs > 1200;
        setHud((h) => {
          const n = { speed: Math.round(driver.speed() * 10) / 10, tier: driver.tier(), wrong, boost: (driver.flags & FL.boost) !== 0, draft: (driver.flags & FL.draft) !== 0 };
          return h.speed === n.speed && h.tier === n.tier && h.wrong === n.wrong && h.boost === n.boost && h.draft === n.draft ? h : n;
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sendNow = useCallback(() => {
    const s = shared.current.buf.latest();
    const r = s ? shared.current.driver.report(s.race) : null;
    if (r) reportRef.current(r);
  }, []);

  // --- 조작 ---
  const keys = useRef(new Set<string>());
  const touchState = useRef({ left: false, right: false, brake: false, drift: false });
  const applyControls = useCallback(() => {
    const k = keys.current;
    const ts = touchState.current;
    let steer = 0;
    if (KEYS.left.some((c) => k.has(c)) || ts.left) steer -= 1;
    if (KEYS.right.some((c) => k.has(c)) || ts.right) steer += 1;
    shared.current.driver.controls = { steer, brake: KEYS.brake.some((c) => k.has(c)) || ts.brake, drift: KEYS.drift.some((c) => k.has(c)) || ts.drift };
  }, []);

  const pressItem = useCallback(() => {
    const s = snapRef.current;
    const p = s.players[mySeat];
    if (s.phase === "countdown") {
      shared.current.driver.pressRocket(performance.now(), s.phase);
      return;
    }
    if (!p || p.item === null || s.t < p.itemAt + ITEM_ROLL_MS || p.finishedAt) {
      sound().play("denied");
      return;
    }
    shared.current.driver.counters.ni += 1;
    sendNow();
  }, [mySeat, sendNow, sound]);
  const pressToy = useCallback(() => {
    const p = snapRef.current.players[mySeat];
    if (!p || p.toy <= 0) {
      sound().play("denied");
      return;
    }
    shared.current.driver.counters.nt += 1;
    sendNow();
  }, [mySeat, sendNow, sound]);
  const pressReset = useCallback(() => {
    if (snapRef.current.phase !== "race") return;
    shared.current.driver.pressReset(performance.now());
    sendNow();
  }, [sendNow]);
  const pressRocket = useCallback(() => {
    const s = snapRef.current;
    shared.current.driver.pressRocket(performance.now(), s.phase);
  }, []);

  useEffect(() => {
    if (ended) return;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || !ALL_KEYS.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      keys.current.add(e.code);
      if (KEYS.item.includes(e.code)) pressItem();
      else if (KEYS.toy.includes(e.code)) pressToy();
      else if (KEYS.reset.includes(e.code)) pressReset();
      else if (KEYS.rocket.includes(e.code)) pressRocket();
      applyControls();
    };
    const up = (e: KeyboardEvent) => {
      if (!keys.current.delete(e.code)) return;
      applyControls();
    };
    const blur = () => {
      keys.current.clear();
      touchState.current = { left: false, right: false, brake: false, drift: false };
      applyControls();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [ended, applyControls, pressItem, pressToy, pressReset, pressRocket]);

  const setHold = useCallback(
    (k: "left" | "right" | "brake" | "drift", v: boolean) => {
      touchState.current[k] = v;
      applyControls();
    },
    [applyControls],
  );

  const nm = useCallback((seat: number) => (seat === mySeat ? "나" : (names[seat] ?? `${seat + 1}번`)), [mySeat, names]);

  // --- 내 차 이벤트 → 소리·배너 ---
  useEffect(() => {
    localEvRef.current = (e: LocalEvent) => {
      const s = sound();
      const now = performance.now();
      switch (e.k) {
        case "wall":
        case "obstacle":
          s.play("wall", e.p);
          shared.current.shake = Math.max(shared.current.shake, Math.min(0.5, e.p / 16));
          setFx((f) => [...f.slice(-40), { ev: { id: -now, at: 0, k: "wall", s: mySeat, p: e.p, x: e.x, z: e.z }, at: now }]);
          break;
        case "driftBoost":
          s.play(e.tier === 2 ? "drift2" : "drift1");
          setFlash({ id: now, tone: "blue" });
          break;
        case "jump":
          s.play("jump");
          break;
        case "land":
          s.play(e.perfect ? "perfect" : "land");
          if (e.perfect) showBanner("✨ 완벽한 착지!", "gold", "짧은 부스트", 900);
          break;
        case "rocket":
          s.play(e.ok ? "rocket" : "stall");
          showBanner(e.ok ? "🚀 출발 부스트!" : "💨 시동 꺼짐…", e.ok ? "gold" : "bad", e.ok ? undefined : "너무 일찍 눌렀어요", 1100);
          break;
        case "reset":
          s.play("reset");
          break;
        case "hazard":
          if (e.blocked) {
            s.play("block");
            showBanner("🫧 방패가 막았어요!", "info", undefined, 900);
          } else if (e.what === "duck") {
            s.play("spun");
            setFlash({ id: now, tone: "bad" });
            showBanner("🦆 꽥! 빙글", "bad", undefined, 900);
          } else {
            s.play("crash");
            shared.current.shake = 0.8;
            setFlash({ id: now, tone: "bad" });
            showBanner(e.what === "train" ? "🚂 기차에 쾅!" : "🧱 장난감 벽에 쾅!", "bad", undefined, 1000);
          }
          break;
        case "fx":
          if (e.what === "spin") {
            s.play("spun");
            shared.current.shake = 0.5;
            setFlash({ id: now, tone: "bad" });
          } else if (e.what === "boost") s.play("boost");
          else if (e.what === "top") s.play("top");
          break;
        default:
          break;
      }
    };
  }, [mySeat, showBanner, sound]);

  // --- 스냅샷 이벤트 → 연출·소리·알림 ---
  const lastFresh = useRef(0);
  const lastTier = useRef(0);
  useEffect(() => {
    if (hud.tier > lastTier.current && hud.tier > 0) sound().play("driftTier");
    lastTier.current = hud.tier;
  }, [hud.tier, sound]);
  useEffect(() => {
    if (fresh.seq === lastFresh.current) return;
    lastFresh.current = fresh.seq;
    const now = performance.now();
    const s = sound();
    const add: FxItem[] = [];
    const mine = shared.current.driver.pose();
    const near = (x: number, z: number, r: number) => !!mine && Math.hypot(mine.x - x, mine.z - z) < r;
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "go":
          s.play("go");
          showBanner("출발!", "go", undefined, 900);
          break;
        case "rocket":
          if (ev.s !== mySeat && ev.ok) add.push({ ev, at: now });
          break;
        case "lap":
          if (ev.s === mySeat) {
            const pb = myBest === 0 || ev.ms < myBest;
            if (pb) {
              saveBest(snap.track, ev.ms);
              setMyBest(ev.ms);
            }
            s.play(pb || ev.best ? "bestLap" : "lap");
            showBanner(`랩 ${fmtTime(ev.ms)}`, pb ? "gold" : "info", pb ? "🆕 내 최고 기록!" : ev.best ? "⏱ 이번 판 내 최고 랩" : undefined, 1300);
          }
          break;
        case "finalLap":
          if (ev.s === mySeat) {
            s.play("finalLap");
            showBanner("🏁 마지막 바퀴!", "gold", undefined, 1600);
          }
          break;
        case "finish":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play("finish");
            const p = snap.players[mySeat];
            if (p && p.stats.bestLapMs > 0 && (myBest === 0 || p.lastLapMs < myBest)) {
              saveBest(snap.track, p.lastLapMs);
              setMyBest(p.lastLapMs);
            }
            showBanner(`🏁 ${ev.rank}등으로 들어왔어요!`, ev.rank === 1 ? "gold" : "info", fmtTime(ev.ms), 2600);
          } else
            pushFeed(
              <>
                🏁 <SeatTag seat={ev.s} names={names} me={mySeat} /> {ev.rank}등 골인
              </>,
            );
          break;
        case "firstFinish":
          if (ev.s !== mySeat) showBanner(`⏱ ${FINISH_GRACE_MS / 1000}초 안에 들어오세요!`, "bad", `${nm(ev.s)} 골인`, 1800);
          break;
        case "box":
          add.push({ ev, at: now });
          if (ev.s === mySeat) s.play("box");
          break;
        case "use":
          add.push({ ev, at: now });
          if (ev.s === mySeat || near(ev.x, ev.z, 14)) s.play(ev.kind);
          if (ev.s !== mySeat && (ev.kind === "yoyo" || ev.kind === "top"))
            pushFeed(
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} /> {ITEM_INFO[ev.kind].emoji} {ITEM_INFO[ev.kind].name}
              </>,
            );
          break;
        case "hit":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            // 내 기기가 스스로 판정한 것(오리·벽·기차)은 이미 소리를 냈다
          } else {
            if (ev.by === mySeat) {
              s.play("hitOther", 1);
              showBanner(`${ev.kind === "toy" ? "🧸" : ITEM_INFO[ev.kind as keyof typeof ITEM_INFO]?.emoji ?? "💥"} 맞혔어요!`, "gold", nm(ev.s), 900);
            } else if (near(ev.x, ev.z, 12)) s.play("hitOther", 0);
            pushFeed(
              <>
                {ev.by >= 0 ? <SeatTag seat={ev.by} names={names} me={mySeat} /> : ev.kind === "train" ? "🚂" : ""} {ev.kind === "toy" ? "🧸→" : ev.kind === "train" ? "→" : `${ITEM_INFO[ev.kind as keyof typeof ITEM_INFO]?.emoji ?? "💥"}→`} <SeatTag seat={ev.s} names={names} me={mySeat} />
              </>,
            );
          }
          if (ev.s === mySeat && ev.by >= 0 && ev.kind !== "duck" && ev.kind !== "toy")
            pushFeed(
              <>
                <SeatTag seat={ev.by} names={names} me={mySeat} /> {ITEM_INFO[ev.kind as keyof typeof ITEM_INFO]?.emoji} → 나
              </>,
            );
          break;
        case "block":
          add.push({ ev, at: now });
          if (ev.s !== mySeat && near(ev.x, ev.z, 12)) s.play("block");
          if (ev.s === mySeat && ev.kind !== "duck" && ev.kind !== "toy") {
            s.play("block");
            showBanner("🫧 방패가 막았어요!", "info", undefined, 900);
          }
          break;
        case "toyGet":
          if (ev.s === mySeat) {
            s.play("toyGet");
            showBanner("🧸 꼴찌의 장난감 상자!", "toy", `${touch ? "🧸 버튼" : "Q"}으로 선두 앞에 장난감 벽을 떨어뜨려요 (${TOY_AUTO_MS / 1000}초 뒤 저절로)`, 2600);
          }
          break;
        case "toyDrop":
          add.push({ ev, at: now });
          s.play("toyDrop");
          if (ev.target === mySeat) {
            showBanner("⚠️ 앞에 장난감 벽이 떨어져요!", "bad", "그림자를 보고 반대쪽으로 피해요", 2000);
            setFlash({ id: now, tone: "bad" });
          } else
            pushFeed(
              <>
                🧸 <SeatTag seat={ev.s} names={names} me={mySeat} /> → <SeatTag seat={ev.target} names={names} me={mySeat} /> 앞에 투하
              </>,
            );
          break;
        case "toyLand":
          add.push({ ev, at: now });
          if (near(ev.x, ev.z, 25)) s.play("toyLand");
          break;
        case "toyBreak":
          add.push({ ev, at: now });
          if (near(ev.x, ev.z, 20)) s.play("toyBreak");
          break;
        case "bump":
          if (near(ev.x, ev.z, 8)) s.play("bump", ev.p);
          add.push({ ev, at: now });
          break;
        case "wall":
          if (near(ev.x, ev.z, 10)) s.play("wall", ev.p * 0.6);
          add.push({ ev, at: now });
          break;
        case "driftBoost":
          break;
        case "land":
          add.push({ ev, at: now });
          break;
        case "pass":
          if (ev.s === mySeat) {
            s.play("pass");
            pushFeed(
              <>
                ⬆️ <SeatTag seat={ev.over} names={names} me={mySeat} /> 추월!
              </>,
            );
          } else if (ev.over === mySeat) {
            s.play("passed");
            pushFeed(
              <>
                ⬇️ <SeatTag seat={ev.s} names={names} me={mySeat} /> 에게 추월당함
              </>,
            );
          }
          break;
        case "raceOver":
          showBanner("🏁 레이스 끝!", "gold", undefined, 1500);
          break;
        case "nextRace":
          showBanner(`${TRACK_INFO[ev.track].emoji} ${TRACK_INFO[ev.track].name}`, "info", `그랑프리 ${ev.race + 1}/${snap.races}`, 2200);
          break;
        case "over":
          s.play(snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        default:
          break;
      }
    }
    if (add.length) setFx((f) => [...f.filter((x) => now - x.at < 2000), ...add].slice(-50));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound, nm, myBest, touch]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 600);
    return () => window.clearTimeout(id);
  }, [flash]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);
  // 들어오기 마감 똑딱
  const graceSec = Math.ceil(graceLeft / 1000);
  const lastClock = useRef(0);
  useEffect(() => {
    if (graceLeft > 0 && graceSec <= 10 && graceSec !== lastClock.current && !me?.finishedAt) sound().play("clock", graceSec);
    lastClock.current = graceSec;
  }, [graceSec, graceLeft, me?.finishedAt, sound]);
  // 반대 방향
  const lastWrong = useRef(false);
  useEffect(() => {
    if (hud.wrong && !lastWrong.current) sound().play("wrongWay");
    lastWrong.current = hud.wrong;
  }, [hud.wrong, sound]);
  // 아이템 룰렛 끝
  const itemReady = !!me && me.item !== null && snap.t >= me.itemAt + ITEM_ROLL_MS && racing && !me.finishedAt;
  const lastReady = useRef(false);
  useEffect(() => {
    if (itemReady && !lastReady.current) sound().play("itemReady");
    lastReady.current = itemReady;
  }, [itemReady, sound]);
  // 기차 경고
  const tr = trackFor(snap.track);
  const trainNow = tr.train && racing ? trainState(tr, snap.t - snap.goAt) : "clear";
  const lastTrain = useRef("clear");
  useEffect(() => {
    if (trainNow !== lastTrain.current) {
      const mine = shared.current.driver.pose();
      const ti = tr.train ? Math.round(tr.train.s / tr.ds) % tr.n : 0;
      const close = !!mine && tr.train && Math.hypot(mine.x - tr.x[ti], mine.z - tr.z[ti]) < 30;
      if (trainNow === "warn" && close) sound().play("trainWarn");
      if (trainNow === "cross" && close) sound().play("train");
    }
    lastTrain.current = trainNow;
  }, [trainNow, sound, tr]);

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

  const setPref = (v: ViewPref) => {
    setView(v);
    saveView(v);
  };
  const quality: "high" | "low" = view.quality === "auto" ? (touch || lowFps ? "low" : "high") : view.quality;
  const use3d = view.mode === "3d" && canGl;
  const order = useMemo(() => [...snap.players].sort((a, b) => a.rank - b.rank), [snap.players]);
  const n = snap.seatCount;
  const rolling = !!me && me.item !== null && snap.t < me.itemAt + ITEM_ROLL_MS;
  const rollEmoji = rolling ? ITEM_INFO[ITEM_KINDS[Math.floor(snap.t / 90) % ITEM_KINDS.length]].emoji : null;
  const lap = me ? lapShown(snap, me) : 1;
  const lapTime = me && racing && !me.finishedAt ? snap.t - me.lapStart : 0;
  const raceMs = racing ? snap.t - snap.goAt : 0;
  const prog = me ? Math.max(0, Math.min(1, me.dist / (L * snap.options.laps))) : 0;

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          {TRACK_INFO[snap.track].emoji} {TRACK_INFO[snap.track].name}
          {snap.races > 1 && <span className="ml-1.5 text-white/60 light:text-slate-500">🏆 {snap.race + 1}/{snap.races}</span>}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="tabular-nums">
          🏁 랩 <b className="text-white light:text-slate-900">{lap}</b>/{snap.options.laps} · ⏱ {fmtTime(raceMs)}
          {myBest > 0 && <span className="ml-1.5 text-white/50 light:text-slate-400">내 최고 {fmtTime(myBest)}</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              uiClick();
              setRulebook(true);
            }}
            className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300"
          >
            📖 룰북
          </button>
          <button
            type="button"
            onClick={() => {
              uiClick();
              setSettings((v) => !v);
            }}
            className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300"
            aria-expanded={settings}
            aria-label="보기 설정"
          >
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
                setPref({ ...view, mode: m });
              }}
              className={`rounded-full border px-2.5 py-1 ${view.mode === m ? "border-orange-400 bg-orange-500/20 text-orange-100 light:text-orange-800" : "border-white/15 light:border-slate-300"}`}
            >
              {m === "3d" ? "🎥 3D 뒤에서" : "🗺️ 2D 위에서"}
            </button>
          ))}
          <span className="ml-2">카메라</span>
          {(["near", "far"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                uiClick();
                setPref({ ...view, cam: c });
              }}
              className={`rounded-full border px-2.5 py-1 ${view.cam === c ? "border-orange-400 bg-orange-500/20 text-orange-100 light:text-orange-800" : "border-white/15 light:border-slate-300"}`}
            >
              {c === "near" ? "가까이" : "멀리 (앞이 더 보임)"}
            </button>
          ))}
          <span className="ml-2">화질</span>
          {(["auto", "high", "low"] as Quality[]).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                uiClick();
                setPref({ ...view, quality: q });
              }}
              className={`rounded-full border px-2.5 py-1 ${view.quality === q ? "border-orange-400 bg-orange-500/20 text-orange-100 light:text-orange-800" : "border-white/15 light:border-slate-300"}`}
            >
              {q === "auto" ? "자동" : q === "high" ? "높음" : "낮음(빠름)"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              uiClick();
              setPref({ ...view, assist: !view.assist });
            }}
            aria-pressed={view.assist}
            className={`ml-2 rounded-full border px-2.5 py-1 ${view.assist ? "border-emerald-400 bg-emerald-500/20 text-emerald-100 light:text-emerald-800" : "border-white/15 light:border-slate-300"}`}
          >
            🧑‍🦽 주행 보조 {view.assist ? "켜짐" : "꺼짐"}
          </button>
          <span className="w-full text-[11px] text-white/45 light:text-slate-400">주행 보조: 핸들을 놓으면 길 가운데로 살살 꺾어 주고, 급한 굽이 앞에서 대신 브레이크를 밟아요 (직접 꺾으면 내 조작이 우선).</span>
          {!canGl && <span className="text-amber-300">이 기기는 3D(WebGL)를 지원하지 않아 2D로 보여요</span>}
        </div>
      )}

      {/* 순위 줄 */}
      <div className="flex flex-wrap gap-1.5" aria-label="지금 순위">
        {order.map((p) => (
          <div
            key={p.seat}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
            title={`${SEAT_COLOR_NAMES[p.seat % 8]} ${SEAT_SYMBOLS[p.seat % 8]}`}
          >
            <b className="tabular-nums text-white light:text-slate-900">{p.rank}</b>
            <SeatTag seat={p.seat} names={names} me={mySeat} />
            {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
            {p.finishedAt > 0 && <span aria-label="들어옴">🏁</span>}
            {p.toy > 0 && <span aria-label="꼴찌의 장난감">🧸</span>}
            {snap.races > 1 && <span className="tabular-nums text-amber-200 light:text-amber-700">{p.points}점</span>}
          </div>
        ))}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#e9d5b5] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[64svh] min-h-[340px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? <RaceScene shared={shared} names={names} seatCount={snap.seatCount} track={snap.track} quality={quality} fx={fx} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} /> : <Top2D shared={shared} />}
        {use3d && <Minimap shared={shared} />}

        {flash && <div key={flash.id} className={`pointer-events-none absolute inset-0 z-10 animate-[tr-flash_0.6s_ease-out] ${flash.tone === "gold" ? "shadow-[inset_0_0_80px_24px_rgba(251,191,36,0.7)]" : flash.tone === "blue" ? "shadow-[inset_0_0_70px_18px_rgba(56,189,248,0.6)]" : "shadow-[inset_0_0_80px_24px_rgba(244,63,94,0.7)]"}`} />}

        {/* 이름표 */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {snap.players.map((p) => (
            <div
              key={p.seat}
              ref={(el) => {
                shared.current.labels[p.seat] = el;
              }}
              className="absolute top-0 left-0 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-white shadow"
              style={{ display: "none" }}
            >
              <span className="tabular-nums text-white/80">{p.rank}</span>
              <span style={{ color: SEAT_COLORS[p.seat % 8] }} aria-hidden>
                {SEAT_SYMBOLS[p.seat % 8]}
              </span>
              <span className="max-w-[5.5rem] truncate">{names[p.seat] ?? `${p.seat + 1}번`}</span>
              {racing && snap.t < p.shieldUntil && <span aria-label="방패">🫧</span>}
              {racing && (p.flags & FL.top) !== 0 && <span aria-label="팽이">🌀</span>}
              {(p.flags & FL.spin) !== 0 && <span aria-label="빙글">💫</span>}
            </div>
          ))}
        </div>

        {/* 왼쪽 위: 순위 · 랩 · 아이템 */}
        {me && snap.phase !== "gameOver" && (
          <div className="pointer-events-none absolute top-2 left-14 z-20 flex items-start gap-2">
            <div className="rounded-2xl bg-black/50 px-3 py-1 text-center text-white shadow">
              <div className="text-3xl leading-none font-black tabular-nums">
                {me.rank}
                <span className="text-sm text-white/70">/{n}</span>
              </div>
              <div className="text-[10px] text-white/70 tabular-nums">랩 {lap}/{snap.options.laps}</div>
            </div>
            {snap.options.items && (
              <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-2xl border-2 bg-black/50 shadow ${itemReady ? "border-amber-200" : "border-white/30"}`} aria-label={me.item ? `아이템 ${ITEM_INFO[me.item].name}` : "아이템 없음"}>
                <span className="text-3xl leading-none">{rolling ? rollEmoji : me.item ? ITEM_INFO[me.item].emoji : ""}</span>
                <span className="text-[9px] text-white/80">{me.item && !rolling ? ITEM_INFO[me.item].name : rolling ? "…" : "🎁 없음"}</span>
              </div>
            )}
            {me.toy > 0 && (
              <div className="animate-pulse rounded-2xl border-2 border-amber-200 bg-amber-500/60 px-2 py-1 text-center text-white shadow">
                <div className="text-2xl leading-none">🧸</div>
                <div className="text-[9px] tabular-nums">{touch ? "버튼" : "Q"} · {Math.max(0, Math.ceil((me.toyAt + TOY_AUTO_MS - snap.t) / 1000))}초</div>
              </div>
            )}
          </div>
        )}

        {/* 알림판 */}
        <div className="pointer-events-none absolute top-28 right-2 z-20 flex max-w-[60%] flex-col items-end gap-1 sm:top-36">
          {feed.map((f) => (
            <div key={f.id} className="rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white shadow">
              {f.text}
            </div>
          ))}
        </div>

        {/* 배너 */}
        <div className="pointer-events-none absolute inset-x-0 top-[18%] z-20 flex flex-col items-center gap-2 px-3">
          {snap.phase === "countdown" && (
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold text-white drop-shadow">
                {snap.races > 1 ? `🏆 그랑프리 ${snap.race + 1}/${snap.races} · ` : ""}
                {TRACK_INFO[snap.track].emoji} {TRACK_INFO[snap.track].name} · {snap.options.laps}바퀴
              </span>
              <span key={countLeft} className="animate-[tr-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft > 3 ? "준비" : countLeft}
              </span>
              {/* 신호등: 소리 없이도 출발 시점이 보이게 */}
              <div className="mt-1 flex gap-1.5 rounded-full bg-black/55 px-2 py-1" aria-hidden>
                {[3, 2, 1].map((k) => (
                  <span key={k} className={`h-4 w-4 rounded-full ${countLeft <= k ? "bg-rose-500" : "bg-white/20"}`} />
                ))}
              </div>
              <span className="mt-1 max-w-sm rounded-full bg-black/45 px-3 py-1 text-center text-xs text-white">
                {touch ? "◀ ▶ 핸들 · 🌀 드리프트 · ⏬ 브레이크 · 🎁 아이템" : "←→ 핸들 · Shift 드리프트 · ↓ 브레이크 · Space 아이템 · Q 장난감 · R 제자리"} — 🚀 {touch ? "버튼" : "↑"}을 불이 다 켜진 직후(출발 직전)에 누르면 출발 부스트!
              </span>
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[tr-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-emerald-400 text-slate-900" : b.tone === "gold" ? "bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950" : b.tone === "bad" ? "bg-rose-600 text-white" : b.tone === "toy" ? "bg-violet-600 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-4xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 경고 (소리 없이도 보이게) */}
        {racing && me && !me.finishedAt && (hud.wrong || trainNow !== "clear" || graceLeft > 0) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[34%] z-20 mx-auto flex w-fit flex-col items-center gap-1">
            {hud.wrong && <div className="animate-pulse rounded-full bg-rose-600/90 px-3 py-1 text-sm font-black text-white">↩ 반대 방향! {touch ? "" : "(R = 제자리로)"}</div>}
            {trainNow !== "clear" && <div className={`rounded-full px-3 py-1 text-xs font-bold ${trainNow === "cross" ? "bg-rose-600/90 text-white" : "animate-pulse bg-amber-400/90 text-slate-900"}`}>🚂 {trainNow === "cross" ? "기차가 지나가는 중!" : "기차가 와요 — 건널목 앞 멈춤"}</div>}
            {graceLeft > 0 && <div className="rounded-full bg-slate-900/85 px-3 py-1 text-xs font-bold text-white tabular-nums">⏱ {graceSec}초 안에 들어와요!</div>}
          </div>
        )}

        {/* 아래 가운데: 속도 · 드리프트 · 진행 */}
        {me && racing && !me.finishedAt && (
          <div className={`pointer-events-none absolute inset-x-0 z-20 mx-auto flex w-fit flex-col items-center gap-1 ${touch ? "bottom-24" : "bottom-3"}`}>
            <div className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-xs text-white tabular-nums">
              <span className="w-12 text-right text-lg font-black">{Math.round(hud.speed * 10)}</span>
              <span className="text-[10px] text-white/60">km/h</span>
              {hud.boost && <span className="font-bold text-emerald-300">⚡부스트</span>}
              {hud.draft && <span className="font-bold text-sky-200">💨바람막이</span>}
              {hud.tier > 0 && <span className={`font-bold ${hud.tier === 2 ? "text-orange-300" : "text-sky-300"}`}>🌀 {hud.tier === 2 ? "2단 (주황)" : "1단 (파랑)"}</span>}
            </div>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/20" aria-label={`진행 ${Math.round(prog * 100)}%`}>
              <div className="h-full bg-orange-400" style={{ width: `${Math.round(prog * 100)}%` }} />
            </div>
            <div className="text-[10px] text-white/80 tabular-nums">이번 랩 {fmtTime(lapTime)}</div>
          </div>
        )}

        {/* 들어온 뒤 */}
        {me && racing && me.finishedAt > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-[30%] z-20 flex flex-col items-center gap-1 px-3">
            <div className="text-4xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">🏁 {me.finishRank}등!</div>
            <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">다른 차를 기다리는 중{graceLeft > 0 ? ` · ${graceSec}초` : ""}</div>
          </div>
        )}

        {/* 그랑프리 중간 결과 */}
        {snap.phase === "raceEnd" && <RaceResult snap={snap} names={names} mySeat={mySeat} />}
        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}

        {notice && <div className="absolute inset-x-0 top-14 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        <button
          type="button"
          onClick={() => {
            uiClick();
            toggleFull();
          }}
          className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white"
          aria-label={full ? "전체화면 끄기" : "전체화면"}
        >
          {full ? "↙" : "⛶"}
        </button>

        {/* 터치 조작 */}
        {touch && !ended && snap.phase !== "gameOver" && me && (
          <>
            <div className="absolute bottom-3 left-3 z-20 flex gap-3">
              <HoldButton label="◀" ariaLabel="왼쪽으로" size={76} onChange={(v) => setHold("left", v)} />
              <HoldButton label="▶" ariaLabel="오른쪽으로" size={76} onChange={(v) => setHold("right", v)} />
            </div>
            <div className="absolute right-3 bottom-3 z-20 flex flex-col items-end gap-2">
              <div className="flex gap-2">
                {me.toy > 0 && <TapButton label="🧸" sub="투하" ariaLabel="꼴찌의 장난감 던지기" glow onTap={pressToy} />}
                {snap.phase === "countdown" ? (
                  <TapButton label="🚀" sub="출발" size={72} ariaLabel="출발 부스트" onTap={pressRocket} />
                ) : (
                  <TapButton label={rolling ? rollEmoji : me.item ? ITEM_INFO[me.item].emoji : "🎁"} sub="아이템" ariaLabel="아이템 쓰기" disabled={!itemReady} onTap={pressItem} />
                )}
              </div>
              <div className="flex items-end gap-2">
                <HoldButton label="⏬" sub="브레이크" ariaLabel="브레이크" tone="brake" size={60} onChange={(v) => setHold("brake", v)} />
                <HoldButton label="🌀" sub="드리프트" ariaLabel="드리프트" tone="drift" size={76} onChange={(v) => setHold("drift", v)} />
              </div>
            </div>
            {racing && (hud.wrong || hud.speed < 0.5) && !me.finishedAt && (
              <button type="button" onPointerDown={pressReset} className="absolute bottom-24 left-3 z-20 rounded-full border border-white/50 bg-black/50 px-3 py-1.5 text-xs font-bold text-white">
                🔁 제자리로
              </button>
            )}
          </>
        )}
      </div>

      {me && snap.phase !== "gameOver" && !touch && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60 light:border-slate-200 light:bg-white light:text-slate-500">
          <span>←→/AD 핸들 · ↓/S 브레이크 · Shift(J) 꾹 = 🌀 드리프트(떼면 ⚡) · Space/K 아이템 · Q 🧸 장난감 · R 🔁 제자리로 · ↑/W 🚀 출발 부스트</span>
        </div>
      )}

      {(ended || snap.phase === "gameOver") && (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && onRestart && (
            <button type="button" onClick={onRestart} className="rounded-xl bg-orange-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-orange-300">
              다시하기
            </button>
          )}
        </div>
      )}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        @keyframes tr-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes tr-flash { 0% { opacity: 1 } 100% { opacity: 0 } }
      `}</style>
    </div>
  );
}

function RaceResult({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.raceRanks ?? snap.players.map((p) => p.rank);
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat]);
  const left = Math.max(0, Math.ceil((snap.phaseEnd - snap.t) / 1000));
  return (
    <div className="absolute inset-x-3 top-[6%] z-30 mx-auto max-h-[86%] max-w-md overflow-y-auto rounded-2xl border border-white/20 bg-slate-950/90 p-4 text-white shadow-2xl">
      <p className="text-center text-xs text-white/60">
        🏆 그랑프리 {snap.race + 1}/{snap.races} 결과 · {TRACK_INFO[snap.track].emoji} {TRACK_INFO[snap.track].name}
      </p>
      <ol className="mt-2 flex flex-col gap-1 text-sm">
        {order.map((p) => (
          <li key={p.seat} className={`flex items-center justify-between rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
            <span className="flex items-center gap-2">
              <b className="w-6 text-center">{ranks[p.seat]}</b>
              <SeatTag seat={p.seat} names={names} me={mySeat} />
            </span>
            <span className="text-xs tabular-nums text-white/70">
              +{GP_POINTS[ranks[p.seat] - 1] ?? 0} → <b className="text-amber-200">{p.points}점</b>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-center text-[11px] text-white/50">다음 레이스 {left}초 뒤 · 점수가 낮은 사람이 앞줄에서 출발 ({INTERMISSION_MS / 1000}초 휴식)</p>
    </div>
  );
}

function FinalPanel({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.ranks ?? snap.players.map(() => 1);
  const gp = snap.races > 1;
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || a.seat - b.seat);
  const best = (f: (p: PlayerState) => number) => {
    const max = Math.max(...snap.players.map(f));
    return { seats: max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [], max };
  };
  const laps = snap.players.filter((p) => p.stats.bestLapMs > 0);
  const fastest = laps.length ? Math.min(...laps.map((p) => p.stats.bestLapMs)) : 0;
  const pass = best((p) => p.stats.passes);
  const hit = best((p) => p.stats.hits);
  const drift = best((p) => p.stats.driftBoosts);
  const toy = best((p) => p.stats.toyHits);
  const shield = best((p) => p.stats.blocked);
  const awards: { icon: string; title: string; seats: number[]; value: string }[] = [
    { icon: "⏱", title: "가장 빠른 랩", seats: fastest > 0 ? laps.filter((p) => p.stats.bestLapMs === fastest).map((p) => p.seat) : [], value: fmtTime(fastest) },
    { icon: "⬆️", title: "추월왕", seats: pass.seats, value: `${pass.max}번` },
    { icon: "🎯", title: "명사수", seats: hit.seats, value: `${hit.max}명` },
    { icon: "🌀", title: "드리프트 장인", seats: drift.seats, value: `${drift.max}번` },
    { icon: "🧸", title: "꼴찌의 반격", seats: toy.seats, value: `${toy.max}번 명중` },
    { icon: "🫧", title: "철벽 방패", seats: shield.seats, value: `${shield.max}번` },
  ].filter((a) => a.seats.length > 0);
  const myRank = ranks[mySeat];
  return (
    <div className="absolute inset-x-3 top-[5%] z-30 mx-auto max-h-[88%] max-w-md overflow-y-auto rounded-2xl border border-orange-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
      <p className="text-center text-xs text-white/60">
        최종 결과 · {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name}
        {!gp && ` · ${TRACK_INFO[snap.track].emoji} ${TRACK_INFO[snap.track].name}`} · {snap.options.laps}바퀴
      </p>
      <p className="mt-1 text-center text-2xl font-black">{myRank === 1 ? "🏆 우승!" : `${myRank}등`}</p>
      <ol className="mt-3 flex flex-col gap-1.5 text-sm">
        {order.map((p) => (
          <li key={p.seat} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
            <span className="flex items-center gap-2">
              <b className="w-6 text-center">{ranks[p.seat] === 1 ? "🥇" : ranks[p.seat] === 2 ? "🥈" : ranks[p.seat] === 3 ? "🥉" : ranks[p.seat]}</b>
              <SeatTag seat={p.seat} names={names} me={mySeat} />
            </span>
            <span className="text-xs text-white/70 tabular-nums">
              {gp ? (
                <>
                  {p.raceRanks.map((r) => `${r}`).join("·")}등 · <b className="text-sm text-amber-200">{p.points}점</b>
                </>
              ) : (
                <>
                  {p.finishedAt ? <b className="text-sm text-amber-200">{fmtTime(p.finishedAt - snap.goAt)}</b> : <span>못 들어옴</span>} · 랩 {fmtTime(p.stats.bestLapMs)}
                </>
              )}
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
      <p className="mt-3 text-center text-[11px] text-white/50">{gp ? "동점이면 마지막 레이스 순위가 높은 사람" : "못 들어온 사람은 더 멀리 간 순서"}</p>
    </div>
  );
}
