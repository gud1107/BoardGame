"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import Warehouse2D from "./Warehouse2D";
import { getParcelPanicSound } from "./parcelPanicSound";
import {
  BOX_INFO,
  DASH_CD_MS,
  DEST_INFO,
  EXPRESS_BONUS,
  FULL_BONUS,
  INCIDENT_INFO,
  LEVEL_INFO,
  MISS_PENALTY,
  MODE_INFO,
  ROLE_INFO,
  RUNNER_DASH_CD_MS,
  SEAT_COLORS,
  SEAT_COLOR_NAMES,
  SEAT_SYMBOLS,
  SHOT_BONUS,
  STAR_TITLES,
  truckCap,
  type BoxKind,
} from "./data";
import type { SnapBuffer, Snap } from "./net";
import { boxOf, dockFor, grabTarget, isUnderdog, layoutOf, starsFor, type Box, type GameEvent, type PlayerInput, type PlayerState } from "./sim";
import RulebookModal from "./RulebookModal";
import type { FxItem } from "./three/Fx";
import type { SceneShared } from "./three/WarehouseScene";

const WarehouseScene = dynamic(() => import("./three/WarehouseScene"), { ssr: false, loading: () => null });

/**
 * 택배 대란 게임 화면 (룰북 §11): 3D/2D 창고 + 이름표 + HUD(팀 점수·★·트럭 현황·사건·내 상자 안내) + 조작(키보드·터치) + 결과.
 * 방장이든 손님이든 같은 스냅샷 버퍼를 그린다. 싣기·받기·깨짐 연출은 방장이 확정한 이벤트로만.
 */

export interface ParcelPanicBoardProps {
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
const VIEW_KEY = "parcel-panic:view";

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
  grab: ["Space", "KeyJ", "KeyE"],
  throw: ["KeyK", "KeyF"],
  dash: ["ShiftLeft", "ShiftRight", "KeyL"],
};
type Act = "grab" | "throw" | "dash";

function useControls(onInput: (inp: PlayerInput) => void, enabled: boolean, onLocalPress: (what: Act) => void) {
  const held = useRef(new Set<string>());
  const stick = useRef<{ x: number; z: number } | null>(null);
  const counters = useRef({ grab: 0, throw: 0, dash: 0 });
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
    const c = counters.current;
    return { mx: Math.round(mx * 100) / 100, mz: Math.round(mz * 100) / 100, grab: c.grab, throw: c.throw, dash: c.dash, aim: 1 };
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
    (what: Act) => {
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
    const all = Object.values(KEYS).flat();
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (!all.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      held.current.add(e.code);
      if (KEYS.grab.includes(e.code)) press("grab");
      else if (KEYS.throw.includes(e.code)) press("throw");
      else if (KEYS.dash.includes(e.code)) press("dash");
      else flush(true);
    };
    const up = (e: KeyboardEvent) => {
      if (!held.current.delete(e.code)) return;
      flush(true);
    };
    const blur = () => {
      held.current.clear();
      stick.current = null;
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
  };
}

function Joystick({ onMove }: { onMove: (v: { x: number; z: number } | null) => void }) {
  const base = useRef<{ x: number; y: number; id: number } | null>(null);
  const [knob, setKnob] = useState<{ bx: number; by: number; dx: number; dy: number } | null>(null);
  const R = 52;
  return (
    <div
      className="absolute bottom-0 left-0 z-20 h-[48%] w-[50%] touch-none select-none"
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
        const ll = Math.max(1, Math.hypot(dx, dy));
        onMove(l < 6 ? { x: 0, z: 0 } : { x: (dx / ll) * m, z: (dy / ll) * m });
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
        <div className="pointer-events-none absolute bottom-6 left-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/35 text-center text-[11px] font-semibold text-white/70">
          여기를 끌어
          <br />
          이동
        </div>
      )}
    </div>
  );
}

function ActButton({ label, sub, frac = 1, onDown, big, ariaLabel, disabled, hot }: { label: ReactNode; sub?: string; frac?: number; onDown: () => void; big?: boolean; ariaLabel: string; disabled?: boolean; hot?: boolean }) {
  const ready = frac >= 1 && !disabled;
  const size = big ? 80 : 64;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={!ready}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex touch-none select-none flex-col items-center justify-center rounded-full border-2 font-bold text-white shadow-lg ${hot && ready ? "border-emerald-200 bg-emerald-600/70" : ready ? "border-amber-200/80 bg-black/45" : "border-white/25 bg-black/30 text-white/45"}`}
      style={{ width: size, height: size }}
    >
      {frac < 1 && !disabled && (
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
  tone: "go" | "gold" | "bad" | "info" | "alert";
}

interface Feed {
  id: number;
  text: ReactNode;
}

function SeatTag({ seat, names, me }: { seat: number; names: Record<number, string>; me: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SEAT_COLORS[seat % 6] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat % 6]}</span>
      <span className="max-w-[7rem] truncate text-white light:text-slate-900">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

export function DestTag({ dest, short }: { dest: number; short?: boolean }) {
  const d = DEST_INFO[dest];
  if (!d) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-black text-white" style={{ background: d.color }}>
      <span aria-hidden>{d.sym}</span>
      {short ? d.short : d.name}
    </span>
  );
}

const kindEmoji = (k: BoxKind) => BOX_INFO[k].emoji;

export default function ParcelPanicBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: ParcelPanicBoardProps) {
  const [view, setView] = useState<{ mode: ViewMode; quality: Quality }>({ mode: "3d", quality: "auto" });
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [flash, setFlash] = useState<{ id: number; tone: "gold" | "bad" } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);
  const shared = useRef<SceneShared>({ buf, mySeat, shake: 0, labels: [] });
  useEffect(() => {
    shared.current.buf = buf;
    shared.current.mySeat = mySeat;
  }, [buf, mySeat]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setView(loadView());
    setCanGl(webglOk());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const L = layoutOf(snap);
  const me = snap.players[mySeat];
  const working = snap.phase === "work";
  const coop = snap.options.mode === "coop";
  const sound = getParcelPanicSound;
  const left = working ? Math.max(0, snap.workEnd - snap.t) : snap.phase === "countdown" ? snap.workEnd - snap.workStart : 0;
  const leftSec = Math.ceil(left / 1000);
  const beltCount = snap.boxes.filter((b) => b.state === "belt").length;
  const incident = snap.incident && snap.t < snap.incident.until ? snap.incident : null;
  const bgmLevel = !working ? 0 : left <= 20_000 ? 2 : incident || beltCount >= 6 ? 1 : 0;
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

  const myBox: Box | null = me && me.hold >= 0 ? (boxOf(snap, me.hold) ?? null) : null;
  const target = me && !myBox && working ? grabTarget(snap, me) : null;

  const onLocalPress = useCallback(
    (what: Act) => {
      const p = snap.players[mySeat];
      if (!p || snap.phase !== "work") return;
      if (what === "dash") {
        const heavy = p.hold >= 0 && snap.boxes.find((b) => b.id === p.hold)?.kind === "heavy";
        if (p.move === "none" && snap.t >= p.dashCdAt - 150 && !heavy) sound().play("dash");
        else sound().play("denied");
      } else if (what === "throw") {
        if (p.hold < 0) sound().play("denied");
      } else if (p.hold < 0 && !grabTarget(snap, p)) sound().play("denied");
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
    const add: FxItem[] = [];
    const mine = snap.players[mySeat];
    const near = (x: number, z: number, r: number) => !!mine && Math.hypot(mine.x - x, mine.z - z) < r;
    const nm = (seat: number) => (seat === mySeat ? "나" : (names[seat] ?? `${seat + 1}번`));
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "go":
          s.play("go");
          showBanner("📦 근무 시작!", "go", coop ? "상자 라벨(색·기호)이 맞는 트럭에 실어요" : "실은 만큼 내 실적 — 남의 상자는 들이받아 떨어뜨려요", 1500);
          break;
        case "spawn":
          break;
        case "grab":
          if (ev.s === mySeat) {
            s.play(ev.join ? "join" : "grab");
            if (ev.join) showBanner("🛋️ 영차! 둘이 들었어요", "info", "같은 쪽으로 밀어야 빨라요", 1100);
          } else if (near(ev.x, ev.z, 3)) s.play("grab");
          break;
        case "put":
          if (ev.s === mySeat) s.play("put");
          break;
        case "load":
          add.push({ ev, at: now });
          if (ev.s === mySeat || (coop && near(ev.x, ev.z, 6))) {
            s.play("load", ev.s === mySeat ? ev.streak : 1);
            if (ev.shot) s.play("shot");
          }
          if (ev.s === mySeat) {
            const extra = [ev.shot ? `🎯 슛 +${SHOT_BONUS}` : "", ev.onTime ? `⚡ 시간 안 +${EXPRESS_BONUS}` : "", ev.duo ? "🛋️ 둘이서!" : "", ev.streak >= 3 ? `🔥 ${ev.streak}연속` : ""].filter(Boolean).join(" · ");
            showBanner(`${kindEmoji(ev.kind)} +${ev.v}`, "gold", extra || undefined, 900);
          }
          if (ev.shot && ev.s !== mySeat)
            pushFeed(
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} /> 🎯 트럭에 던져 넣기!
              </>,
            );
          break;
        case "truckGo": {
          add.push({ ev, at: now });
          s.play("truckGo", ev.full ? 1 : 0);
          const dest = snap.docks[ev.dock]?.dest ?? 0;
          if (ev.full) {
            showBanner(`🚚 ${DEST_INFO[dest].sym} ${DEST_INFO[dest].short} 트럭 가득! +${ev.bonus}`, "gold", ev.s >= 0 ? `마지막 상자: ${nm(ev.s)}` : undefined, 1400);
          }
          pushFeed(
            <>
              🚚 <DestTag dest={dest} short /> {ev.full ? `가득 출발 (+${ev.bonus})` : `시간 돼서 출발 (${ev.n}개)`}
            </>,
          );
          break;
        }
        case "truckBack":
          s.play("truckBack");
          break;
        case "throw":
          add.push({ ev, at: now });
          if (ev.s === mySeat || near(ev.x, ev.z, 5)) s.play("throw");
          break;
        case "catch":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play(ev.steal ? "steal" : "catch");
            showBanner(ev.steal ? "✋ 가로챘다!" : "🙌 받았다!", ev.steal ? "gold" : "info", ev.steal ? `${nm(ev.from)}이 던진 상자` : undefined, 900);
          } else if (ev.from === mySeat) {
            s.play(ev.steal ? "hit" : "catch");
            if (ev.steal) showBanner("😱 던진 상자를 뺏겼어요!", "bad", `${nm(ev.s)}에게`, 1100);
          }
          break;
        case "land":
          if (near(ev.x, ev.z, 5)) s.play("land");
          break;
        case "break":
          add.push({ ev, at: now });
          s.play("break");
          if (ev.s === mySeat) {
            setFlash({ id: ev.id, tone: "bad" });
            shared.current.shake = Math.max(shared.current.shake, 0.35);
            showBanner("🥚 와장창!", "bad", ev.why === "throw" ? "깨지기 쉬운 상자는 던지면 깨져요 (🎯 투수만 괜찮아요)" : "부딪혀서 떨어뜨렸어요", 1500);
          }
          pushFeed(
            <>
              🥚 {ev.s >= 0 ? <SeatTag seat={ev.s} names={names} me={mySeat} /> : null} 깨짐{coop ? ` −${MISS_PENALTY}` : ""}
            </>,
          );
          break;
        case "melt":
          add.push({ ev, at: now });
          s.play("melt");
          pushFeed(<>🧊 냉장 상자가 녹았어요{coop ? ` −${MISS_PENALTY}` : ""}</>);
          break;
        case "miss":
          add.push({ ev, at: now });
          s.play("miss");
          pushFeed(<>🗑️ 컨베이어 끝까지 가서 반송{coop ? ` −${MISS_PENALTY}` : ""}</>);
          break;
        case "scan":
          add.push({ ev, at: now });
          if (ev.s === mySeat || near(ev.x, ev.z, 5)) s.play("scan");
          if (ev.s === mySeat) showBanner(`🔍 라벨 확인: ${DEST_INFO[ev.dest].sym} ${DEST_INFO[ev.dest].name}`, "info", undefined, 1300);
          break;
        case "blocked":
          if (ev.s === mySeat) {
            s.play("blocked");
            showBanner(ev.why === "wrong" ? "❌ 다른 트럭이에요" : ev.why === "unknown" ? "❓ 라벨이 없어요 — 🔍 스캐너로" : ev.why === "away" ? "🚚 트럭이 아직 안 왔어요" : "🛋️ 가구는 못 던져요", "info", ev.why === "wrong" && myBox ? "라벨 색·기호를 확인하세요" : undefined, 1000);
          }
          break;
        case "dash":
          if (ev.s !== mySeat) {
            const o = snap.players[ev.s];
            if (o && near(o.x, o.z, 5)) s.play("dash");
          }
          break;
        case "knock":
          add.push({ ev, at: now });
          s.play("hit");
          if (ev.b === mySeat) {
            setFlash({ id: ev.id, tone: "bad" });
            shared.current.shake = Math.max(shared.current.shake, 0.4);
            showBanner("💥 들이받혀 상자를 떨어뜨렸어요!", "bad", `${nm(ev.a)}에게`, 1200);
          } else if (ev.a === mySeat) showBanner("💥 들이받기 성공!", "gold", `${nm(ev.b)}의 상자가 떨어졌어요`, 1000);
          break;
        case "forkHit":
          add.push({ ev, at: now });
          s.play("hit");
          if (ev.s === mySeat) {
            setFlash({ id: ev.id, tone: "bad" });
            shared.current.shake = Math.max(shared.current.shake, 0.5);
            showBanner("🚜 지게차에 부딪혔어요!", "bad", "노란 줄이 깜빡이면 비켜요", 1300);
          }
          break;
        case "bump":
          if (ev.p > 4 && (ev.a === mySeat || ev.b === mySeat)) s.play("bump", ev.p);
          break;
        case "incident": {
          const info = INCIDENT_INFO[ev.e];
          s.play(ev.e === "blackout" ? "blackout" : ev.e === "forklift" ? "forkHorn" : "incident");
          let sub: string = info.desc;
          if (ev.e === "swap" && ev.a >= 0 && ev.b >= 0) {
            const da = snap.docks[ev.a]?.dest ?? 0;
            const db = snap.docks[ev.b]?.dest ?? 0;
            sub = `${DEST_INFO[da].sym} ${DEST_INFO[da].short} ↔ ${DEST_INFO[db].sym} ${DEST_INFO[db].short} — 자리를 다시 확인!`;
          }
          if (ev.e === "forklift") sub = `${ev.a === 0 ? "위쪽" : "아래쪽"} 노란 줄 · ${ev.b > 0 ? "왼쪽 → 오른쪽" : "오른쪽 → 왼쪽"} — 부딪히면 상자를 놓쳐요`;
          showBanner(`🚨 ${info.emoji} ${info.name}!`, "alert", sub, 2200);
          break;
        }
        case "incidentEnd":
          if (ev.e === "blackout") showBanner("💡 전기 복구! 몰아서 나와요", "info", undefined, 1100);
          break;
        case "star":
          s.play("star");
          setFlash({ id: ev.id, tone: "gold" });
          showBanner(`${"★".repeat(ev.n)} ${STAR_TITLES[ev.n]}`, "gold", ev.n < 3 ? `다음 ★까지 ${snap.targets[ev.n] - snap.teamScore}점` : "최고 등급!", 1800);
          break;
        case "over":
          s.play(coop ? (starsFor(snap) >= 1 ? "victory" : "defeat") : snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        default:
          break;
      }
    }
    if (add.length) setFx((f) => [...f.filter((x) => now - x.at < 1700), ...add].slice(-60));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound, coop, myBox]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 650);
    return () => window.clearTimeout(id);
  }, [flash]);

  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  const lastClock = useRef(0);
  useEffect(() => {
    if (working && leftSec <= 10 && leftSec > 0 && leftSec !== lastClock.current) sound().play("clock", leftSec);
    lastClock.current = leftSec;
  }, [leftSec, working, sound]);

  const dashReady = !!me && working && snap.t >= me.dashCdAt;
  const lastReady = useRef(true);
  useEffect(() => {
    if (dashReady && !lastReady.current) sound().play("ready");
    lastReady.current = dashReady;
  }, [dashReady, sound]);

  const uiClick = useCallback(() => sound().play("ui"), [sound]);

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
  const cdFrac = (until: number, total: number) => (snap.t >= until ? 1 : Math.max(0, 1 - (until - snap.t) / total));
  const scoreOrder = useMemo(() => [...snap.players].sort((a, b) => b.score - a.score || a.seat - b.seat), [snap.players]);
  const cap = truckCap(snap.seatCount);
  const stars = starsFor(snap);
  const nextTarget = stars < 3 ? snap.targets[stars] : snap.targets[2];
  const topTarget = snap.targets[2] * 1.12;

  // 내 상자 안내
  let hint: ReactNode = null;
  if (me && working) {
    if (myBox) {
      const k = dockFor(snap, myBox.dest);
      const d = k >= 0 ? snap.docks[k] : null;
      const order = k >= 0 ? L.docks.map((dk, i) => ({ i, x: dk.x })).sort((a, b) => a.x - b.x).findIndex((o) => o.i === k) : -1;
      const extra: string[] = [];
      if (myBox.kind === "cold" && myBox.expireAt > 0) extra.push(`🧊 ${Math.max(0, Math.ceil((myBox.expireAt - snap.t) / 1000))}초 뒤 녹음`);
      if (myBox.kind === "express" && snap.t <= myBox.deadline) extra.push(`⚡ ${Math.ceil((myBox.deadline - snap.t) / 1000)}초 안에 +${EXPRESS_BONUS}`);
      if (myBox.kind === "fragile") extra.push(me.role === "pitcher" ? "🎯 투수라 던져도 OK" : "🥚 던지면 깨져요");
      if (myBox.kind === "heavy") extra.push(myBox.holders.length >= 2 ? "🛋️ 둘이서 — 같은 쪽으로!" : "🛋️ 혼자는 느려요 — 동료가 와서 잡으면 빨라져요");
      hint = (
        <span className="flex flex-wrap items-center gap-1.5">
          <b>
            {kindEmoji(myBox.kind)} {BOX_INFO[myBox.kind].name}
          </b>
          →
          {!myBox.known ? (
            <span className="font-bold text-sky-200 light:text-sky-700">❓ 라벨 없음 — 왼쪽 🔍 스캐너로</span>
          ) : (
            <>
              <DestTag dest={myBox.dest} />
              {order >= 0 && <span className="text-white/60 light:text-slate-500">(왼쪽에서 {order + 1}번째 칸)</span>}
              {d && d.state !== "here" && <span className="text-amber-300 light:text-amber-600">{d.swapping ? "🔀 자리 바꾸는 중" : "🚚 오는 중"}</span>}
            </>
          )}
          {extra.map((x) => (
            <span key={x} className="text-white/70 light:text-slate-600">
              · {x}
            </span>
          ))}
        </span>
      );
    } else if (target) {
      hint = (
        <span>
          🤲 {touch ? "잡기 버튼" : "Space"}로 {target.state === "held" ? "🛋️ 같이 들기" : `${kindEmoji(target.kind)} ${BOX_INFO[target.kind].name} 집기`}
          {target.known && target.state !== "held" && (
            <>
              {" "}
              → <DestTag dest={target.dest} short />
            </>
          )}
        </span>
      );
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name} · {LEVEL_INFO[snap.options.level].emoji} {LEVEL_INFO[snap.options.level].name}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="tabular-nums">{snap.phase === "countdown" ? "출근 준비" : snap.phase === "gameOver" ? "퇴근!" : leftSec <= 20 ? <b className="text-orange-300 light:text-orange-600">⏱ 마감 {leftSec}초</b> : <>⏱ 남은 {Math.floor(leftSec / 60)}:{String(leftSec % 60).padStart(2, "0")}</>}</span>
        {working && incident && (
          <span className="rounded-full bg-rose-500/25 px-2 py-0.5 font-semibold text-rose-100 light:text-rose-700">
            🚨 {INCIDENT_INFO[incident.k].emoji} {INCIDENT_INFO[incident.k].name} · {Math.ceil((incident.until - snap.t) / 1000)}초
          </span>
        )}
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

      {/* 팀 점수 + ★ (협동) / 개인 점수 (경쟁) */}
      {coop ? (
        <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs light:border-slate-200 light:bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-white light:text-slate-900">
              🤝 팀 점수 <b className="text-base tabular-nums text-amber-200 light:text-amber-700">{snap.teamScore}</b>
              <span className="ml-2 text-amber-300" aria-label={`별 ${stars}개`}>
                {"★".repeat(stars)}
                <span className="text-white/25 light:text-slate-300">{"★".repeat(3 - stars)}</span>
              </span>
              {stars < 3 && <span className="ml-1.5 font-normal text-white/55 light:text-slate-500">다음 ★ {nextTarget}</span>}
            </span>
            <span className="text-white/60 tabular-nums light:text-slate-500">
              🚚 {snap.loaded}개 실음 · 🗑️ 반송 {snap.missed} · 🥚 깨짐 {snap.broken} · 🧊 녹음 {snap.melted}
            </span>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/10 light:bg-slate-200" role="progressbar" aria-valuenow={snap.teamScore} aria-valuemax={snap.targets[2]} aria-label="별 진행도">
            <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-[width]" style={{ width: `${Math.max(0, Math.min(100, (snap.teamScore / topTarget) * 100))}%` }} />
            {snap.targets.map((t, i) => (
              <span key={i} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] leading-none text-white drop-shadow" style={{ left: `${(t / topTarget) * 100}%` }} aria-hidden>
                {"★"}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {scoreOrder.map((p) => (
            <div
              key={p.seat}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
              title={`${SEAT_COLOR_NAMES[p.seat % 6]} ${SEAT_SYMBOLS[p.seat % 6]}`}
            >
              <SeatTag seat={p.seat} names={names} me={mySeat} />
              {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
              <b className="tabular-nums text-amber-200 light:text-amber-700">{p.score}</b>
              {p.hold >= 0 && <span aria-label="상자 듦">{kindEmoji(snap.boxes.find((b) => b.id === p.hold)?.kind ?? "normal")}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 트럭 현황 */}
      <div className="grid gap-1.5 text-[11px]" style={{ gridTemplateColumns: `repeat(${snap.docks.length}, minmax(0, 1fr))` }}>
        {L.docks
          .map((dk, i) => ({ i, x: dk.x }))
          .sort((a, b) => a.x - b.x)
          .map(({ i }) => {
            const d = snap.docks[i];
            const info = DEST_INFO[d.dest];
            const mine = !!myBox && myBox.known && myBox.dest === d.dest;
            const leave = Math.max(0, Math.ceil((d.leaveAt - snap.t) / 1000));
            return (
              <div key={i} className={`flex flex-col gap-0.5 rounded-lg border px-2 py-1 ${mine ? "border-white ring-2 ring-white/60" : "border-white/10 light:border-slate-200"}`} style={{ background: `${info.color}33` }}>
                <span className="flex items-center justify-between gap-1 font-black text-white light:text-slate-900">
                  <span className="truncate">
                    <span className="rounded px-1 text-white" style={{ background: info.color }}>
                      {info.sym}
                    </span>{" "}
                    {info.short}
                  </span>
                  {mine && <span aria-label="내 상자 트럭">👈</span>}
                </span>
                {d.state === "here" ? (
                  <span className="flex items-center gap-1 tabular-nums text-white/75 light:text-slate-600">
                    📦 {d.load.length}/{cap}
                    <span className="ml-auto">{leave <= 10 ? <b className="text-orange-300 light:text-orange-600">⏱{leave}</b> : `⏱${leave}`}</span>
                  </span>
                ) : (
                  <span className="text-amber-200 light:text-amber-700">{d.swapping ? "🔀 바꾸는 중" : `🚚 오는 중 ${Math.max(0, Math.ceil((d.backAt - snap.t) / 1000))}초`}</span>
                )}
              </div>
            );
          })}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#1c1f26] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[62svh] min-h-[340px]" : "aspect-[16/10] max-h-[74vh]"}`}
      >
        {use3d ? <WarehouseScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} fx={fx} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} /> : <Warehouse2D shared={shared} />}

        {flash && <div key={flash.id} className={`pointer-events-none absolute inset-0 z-10 animate-[pp-flash_0.65s_ease-out] ${flash.tone === "gold" ? "shadow-[inset_0_0_80px_24px_rgba(251,191,36,0.7)]" : "shadow-[inset_0_0_80px_24px_rgba(244,63,94,0.7)]"}`} />}
        {working && incident?.k === "blackout" && <div className="pointer-events-none absolute inset-0 z-[5] bg-slate-950/45" />}

        {/* 이름표 (위치는 무대가 매 프레임 옮김) */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {snap.players.map((p) => {
            const hb = p.hold >= 0 ? snap.boxes.find((b) => b.id === p.hold) : null;
            const ud = working && isUnderdog(snap, p);
            return (
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
                  {p.role !== "none" && <span aria-label={ROLE_INFO[p.role].name}>{ROLE_INFO[p.role].emoji}</span>}
                  <span className="max-w-[5.5rem] truncate">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
                  {hb && (
                    <span className="rounded px-0.5" style={{ background: hb.known ? DEST_INFO[hb.dest]?.color : "#475569" }} aria-label={hb.known ? `${DEST_INFO[hb.dest]?.name} 상자` : "라벨 없는 상자"}>
                      {hb.known ? DEST_INFO[hb.dest]?.sym : "❓"}
                    </span>
                  )}
                  {ud && <span aria-label="꼴찌 보정">🐢</span>}
                </div>
                {p.seat === mySeat && <div className="h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />}
              </div>
            );
          })}
        </div>

        <div className="pointer-events-none absolute top-2 right-2 z-20 flex max-w-[60%] flex-col items-end gap-1">
          {feed.map((f) => (
            <div key={f.id} className="rounded-lg bg-black/55 px-2 py-1 text-[11px] text-white shadow">
              {f.text}
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-20 flex flex-col items-center gap-2 px-3">
          {snap.phase === "countdown" && (
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold text-white drop-shadow">
                {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name} · {snap.options.seconds / 60}분 근무
              </span>
              <span key={countLeft} className="animate-[pp-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft}
              </span>
              <span className="mt-1 max-w-sm rounded-full bg-black/45 px-3 py-1 text-center text-xs text-white">
                {touch ? "왼쪽을 끌어 이동 · 🤲 잡기/놓기 · 🎯 던지기 · 💨 돌진" : "WASD 이동 · Space 잡기/놓기 · K 던지기 · Shift 돌진"} — 라벨 색·기호가 같은 트럭에!
              </span>
              {me && me.role !== "none" && (
                <span className="mt-1 rounded-full px-3 py-1 text-xs font-bold text-slate-950" style={{ background: SEAT_COLORS[mySeat % 6] }}>
                  내 역할: {ROLE_INFO[me.role].emoji} {ROLE_INFO[me.role].name} — {ROLE_INFO[me.role].desc}
                </span>
              )}
              {coop && <span className="mt-1 rounded-full bg-black/45 px-3 py-1 text-[11px] text-white">★ {snap.targets.join(" · ")}점</span>}
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[pp-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-amber-300 text-slate-900" : b.tone === "gold" ? "bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950" : b.tone === "bad" ? "bg-rose-600 text-white" : b.tone === "alert" ? "bg-gradient-to-b from-rose-500 to-orange-500 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-3xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}

        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        <button
          type="button"
          onClick={() => {
            uiClick();
            toggleFull();
          }}
          className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white"
          aria-label={full ? "전체화면 끄기" : "전체화면"}
        >
          {full ? "↙ 작게" : "⛶ 크게"}
        </button>

        {touch && !ended && snap.phase !== "gameOver" && me && (
          <>
            <Joystick onMove={controls.setStick} />
            <div className="absolute right-3 bottom-3 z-20 flex items-end gap-2">
              <ActButton label="🎯" sub="던지기" ariaLabel="던지기" disabled={!myBox || myBox.kind === "heavy"} onDown={() => controls.press("throw")} />
              <ActButton label="💨" sub="돌진" ariaLabel="돌진" frac={cdFrac(me.dashCdAt, me.role === "runner" ? RUNNER_DASH_CD_MS : DASH_CD_MS)} disabled={myBox?.kind === "heavy"} onDown={() => controls.press("dash")} />
              <ActButton label={myBox ? "⬇️" : "🤲"} sub={myBox ? "놓기" : "잡기"} big hot={!!target} ariaLabel={myBox ? "내려놓기" : "잡기"} onDown={() => controls.press("grab")} />
            </div>
          </>
        )}
      </div>

      {/* 내 상태 + 키 안내 */}
      {me && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/75 light:border-slate-200 light:bg-white light:text-slate-600">
          {me.role !== "none" && (
            <span className="font-bold text-white light:text-slate-900" title={ROLE_INFO[me.role].desc}>
              {ROLE_INFO[me.role].emoji} {ROLE_INFO[me.role].name}
            </span>
          )}
          {hint ?? <span className="text-white/50 light:text-slate-400">상자 가까이 가서 {touch ? "🤲" : "Space"}로 집어요</span>}
          <Meter label="💨 돌진" frac={cdFrac(me.dashCdAt, me.role === "runner" ? RUNNER_DASH_CD_MS : DASH_CD_MS)} />
          {!coop && <span>내 실적 {me.score}점</span>}
          {!touch && <span className="text-white/40 light:text-slate-400">WASD/방향키 이동 · Space/J/E 잡기·놓기 · K/F 던지기 · Shift/L 돌진 · 트럭 칸에 들고 들어가면 자동으로 실려요</span>}
        </div>
      )}

      {(ended || snap.phase === "gameOver") && (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && onRestart && (
            <button type="button" onClick={onRestart} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-300">
              다시하기
            </button>
          )}
        </div>
      )}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        @keyframes pp-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes pp-flash { 0% { opacity: 1 } 100% { opacity: 0 } }
      `}</style>
    </div>
  );
}

function Meter({ label, frac }: { label: string; frac: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-white/15 light:bg-slate-200">
        <span className="block h-full bg-amber-400" style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }} />
      </span>
      {frac >= 1 && <span className="text-emerald-300 light:text-emerald-600">✓</span>}
    </span>
  );
}

function FinalPanel({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.ranks ?? snap.players.map(() => 1);
  const coop = snap.options.mode === "coop";
  const stars = starsFor(snap);
  const order = [...snap.players].sort((a, b) => (coop ? b.stats.loadValue - a.stats.loadValue : ranks[a.seat] - ranks[b.seat] || b.score - a.score) || a.seat - b.seat);
  const best = (f: (p: PlayerState) => number) => {
    const max = Math.max(...snap.players.map(f));
    return { seats: max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [], max };
  };
  const loads = best((p) => p.stats.loads);
  const shots = best((p) => p.stats.shots);
  const duo = best((p) => p.stats.heavyDuo);
  const catches = best((p) => p.stats.catches);
  const streak = best((p) => p.stats.bestStreak);
  const knocks = best((p) => p.stats.knocks);
  const scans = best((p) => p.stats.scans);
  const awards: { icon: string; title: string; seats: number[]; value: string }[] = [
    { icon: "📦", title: "최다 상차", seats: loads.seats, value: `${loads.max}개` },
    { icon: "🎯", title: "명사수", seats: shots.seats, value: `던져 넣기 ${shots.max}번` },
    { icon: "🛋️", title: "영차 콤비", seats: duo.seats, value: `가구 ${duo.max}개` },
    { icon: "🙌", title: "캐치왕", seats: catches.seats, value: `${catches.max}번` },
    { icon: "🔥", title: "쉬지 않는 손", seats: streak.seats, value: `${streak.max}연속` },
    { icon: "🔍", title: "꼼꼼 검수", seats: scans.seats, value: `${scans.max}번` },
    ...(!coop ? [{ icon: "💥", title: "불도저", seats: knocks.seats, value: `${knocks.max}번` }] : []),
  ].filter((a) => a.seats.length > 0);
  const title = coop ? STAR_TITLES[stars] : ranks[mySeat] === 1 ? "🏆 이달의 사원!" : `${ranks[mySeat]}등`;
  return (
    <div className="absolute inset-x-3 top-[5%] z-30 mx-auto max-h-[88%] max-w-md overflow-y-auto rounded-2xl border border-amber-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
      <p className="text-center text-xs text-white/60">
        퇴근! · {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name} · {snap.options.seconds / 60}분 · {LEVEL_INFO[snap.options.level].emoji} {LEVEL_INFO[snap.options.level].name}
      </p>
      {coop && (
        <p className="mt-1 text-center text-4xl text-amber-300" aria-label={`별 ${stars}개`}>
          {"★".repeat(stars)}
          <span className="text-white/20">{"★".repeat(3 - stars)}</span>
        </p>
      )}
      <p className="mt-1 text-center text-2xl font-black">{title}</p>
      {coop && (
        <>
          <p className="mt-1 text-center text-sm">
            팀 점수 <b className="text-lg text-amber-200 tabular-nums">{snap.teamScore}</b> <span className="text-white/50">/ ★ {snap.targets.join(" · ")}</span>
          </p>
          <p className="mt-1 text-center text-[11px] text-white/60 tabular-nums">
            🚚 실음 {snap.loaded} · 🗑️ 반송 {snap.missed} · 🥚 깨짐 {snap.broken} · 🧊 녹음 {snap.melted} (각 −{MISS_PENALTY}) · 🚚 가득 보너스 +{FULL_BONUS}
          </p>
        </>
      )}
      <ol className="mt-3 flex flex-col gap-1.5 text-sm">
        {order.map((p) => (
          <li key={p.seat} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
            <span className="flex items-center gap-2">
              {!coop && <b className="w-6 text-center">{ranks[p.seat] === 1 ? "🥇" : ranks[p.seat] === 2 ? "🥈" : ranks[p.seat] === 3 ? "🥉" : ranks[p.seat]}</b>}
              <SeatTag seat={p.seat} names={names} me={mySeat} />
              {p.role !== "none" && <span title={ROLE_INFO[p.role].name}>{ROLE_INFO[p.role].emoji}</span>}
            </span>
            <span className="text-right text-[11px] text-white/70 tabular-nums">
              📦 {p.stats.loads}개{p.stats.shots > 0 && ` · 🎯${p.stats.shots}`}
              {p.stats.breaks > 0 && <span className="text-white/40"> · 🥚{p.stats.breaks}</span>} · <b className="text-sm text-amber-200">{coop ? p.stats.loadValue : p.score}점</b>
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
      <p className="mt-3 text-center text-[11px] text-white/50">{coop ? "★1 이상이면 모두 승리로 기록돼요 · 개인 점수는 내가 실은 값" : "동점이면 실은 개수 → 덜 깨뜨린 사람"}</p>
    </div>
  );
}
