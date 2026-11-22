"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { getCrumbleClimbSound } from "./crumbleClimbSound";
import { COLLAPSE_WARN_H, ITEM_INFO, SAB_INFO, SEAT_COLORS, SEAT_COLOR_NAMES, SEAT_SYMBOLS, SHOVE_CD_MS, finishPoints, type SabKind } from "./data";
import type { SnapBuffer, Snap } from "./net";
import type { GameEvent, PlayerInput, PlayerState } from "./sim";
import { buildTower, platPos } from "./tower";
import RulebookModal from "./RulebookModal";
import Tower2D from "./Tower2D";
import type { FxItem } from "./three/Fx";
import { followSeat, screenToWorld, type SceneShared } from "./view";

const TowerScene = dynamic(() => import("./three/TowerScene"), { ssr: false, loading: () => null });

/**
 * 무너지는 탑 오르기 게임 화면 (룰북 §9~§11): 3D/2D 무대 + 이름표 + 높이 막대 + HUD + 조작(키보드·터치) +
 * 방해 카드 고르기 + 라운드/최종 결과. 방장이든 손님이든 같은 스냅샷 버퍼를 그린다.
 */

export interface CrumbleClimbBoardProps {
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
const VIEW_KEY = "crumble-climb:view";

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
  jump: ["Space", "KeyK"],
  shove: ["ShiftLeft", "ShiftRight", "KeyJ", "KeyE"],
};
const CARD_KEYS = ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"];

function useControls(onInput: (inp: PlayerInput) => void, enabled: boolean, shared: MutableRefObject<SceneShared>, onLocalPress: (what: "jump" | "shove") => void) {
  const held = useRef(new Set<string>());
  const stick = useRef<{ x: number; z: number } | null>(null);
  const counters = useRef({ jump: 0, shove: 0, pick: 0 });
  const card = useRef(-1);
  const last = useRef("");
  const lastSent = useRef(0);
  const cbRef = useRef(onInput);
  const pressRef = useRef(onLocalPress);
  useEffect(() => {
    cbRef.current = onInput;
    pressRef.current = onLocalPress;
  }, [onInput, onLocalPress]);

  const compute = useCallback((): PlayerInput => {
    const h = held.current;
    let sx = 0;
    let sz = 0;
    if (KEYS.left.some((k) => h.has(k))) sx -= 1;
    if (KEYS.right.some((k) => h.has(k))) sx += 1;
    if (KEYS.up.some((k) => h.has(k))) sz -= 1;
    if (KEYS.down.some((k) => h.has(k))) sz += 1;
    if (stick.current) {
      sx += stick.current.x;
      sz += stick.current.z;
    }
    const l = Math.hypot(sx, sz);
    if (l > 1) {
      sx /= l;
      sz /= l;
    }
    const w = screenToWorld(sx, sz, shared.current.camAngle);
    return { mx: Math.round(w.mx * 100) / 100, mz: Math.round(w.mz * 100) / 100, jump: counters.current.jump, shove: counters.current.shove, pick: counters.current.pick, card: card.current };
  }, [shared]);

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
    (what: "jump" | "shove") => {
      counters.current[what] += 1;
      pressRef.current(what);
      flush(true);
    },
    [flush],
  );

  const pickCard = useCallback(
    (i: number) => {
      card.current = i;
      counters.current.pick += 1;
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
      const ci = CARD_KEYS.indexOf(e.code);
      if (ci >= 0) {
        pickCard(ci % 3);
        return;
      }
      const all = Object.values(KEYS).flat();
      if (!all.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      held.current.add(e.code);
      if (KEYS.jump.includes(e.code)) press("jump");
      else if (KEYS.shove.includes(e.code)) press("shove");
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
    // 카메라가 돌면 같은 키도 월드 방향이 바뀐다 → 자주 다시 보낸다
    const id = window.setInterval(() => flush(false), 66);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.clearInterval(id);
    };
  }, [enabled, flush, press, pickCard]);

  return {
    press,
    pickCard,
    setStick: (v: { x: number; z: number } | null) => {
      stick.current = v;
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
        <div className="pointer-events-none absolute bottom-6 left-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/35 text-center text-[11px] font-semibold text-white/80">
          여기를 끌어
          <br />
          이동
        </div>
      )}
    </div>
  );
}

function CdButton({ label, sub, frac, onDown, big, ariaLabel }: { label: ReactNode; sub?: string; frac: number; onDown: () => void; big?: boolean; ariaLabel: string }) {
  const ready = frac >= 1;
  const size = big ? 80 : 64;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex touch-none select-none flex-col items-center justify-center rounded-full border-2 font-bold text-white shadow-lg ${ready ? "border-white/70 bg-black/45" : "border-white/25 bg-black/30 text-white/50"}`}
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

/* ── 방해 카드 고르기 ─────────────────────────────────────────────── */

function CardPicker({ kinds, left, target, onPick }: { kinds: SabKind[]; left: number; target: string | null; onPick: (i: number) => void }) {
  return (
    <div className="absolute inset-x-2 bottom-2 z-30 mx-auto flex w-fit max-w-full flex-col items-center gap-2 rounded-2xl border border-amber-300/40 bg-slate-950/90 px-3 py-2 text-white shadow-2xl">
      <div className="text-center text-xs">
        <b className="text-sm">🧱 방해 카드!</b> <span className="text-white/70">{target ? `과녁: 지금 선두 ${target}` : "선두를 노려요"}</span> · <span className="tabular-nums text-amber-200">{Math.ceil(left / 1000)}초 안에 고르기 (안 고르면 무작위)</span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {kinds.map((k, i) => (
          <button
            key={k}
            type="button"
            onClick={() => onPick(i)}
            className="flex w-28 flex-col items-center gap-0.5 rounded-xl border border-white/20 bg-white/[0.06] px-2 py-2 text-center hover:border-amber-300 hover:bg-amber-300/10 focus:border-amber-300 focus:outline-none"
          >
            <span className="text-2xl leading-none">{SAB_INFO[k].emoji}</span>
            <span className="text-xs font-bold">
              {i + 1}. {SAB_INFO[k].name}
            </span>
            <span className="break-keep text-[10px] leading-snug text-white/65">{SAB_INFO[k].desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── 높이 막대 ────────────────────────────────────────────────────── */

function HeightBar({ snap, mySeat, top }: { snap: Snap; mySeat: number; top: number }) {
  const pct = (y: number) => `${Math.max(0, Math.min(100, (y / top) * 100))}%`;
  return (
    <div className="pointer-events-none absolute top-12 right-2 bottom-24 z-10 w-7" aria-label="탑 높이 막대">
      <div className="absolute inset-y-0 left-1/2 w-2 -translate-x-1/2 rounded-full bg-black/40" />
      <div className="absolute inset-x-1 bottom-0 rounded-b-full bg-[#3a2e26]/90" style={{ height: pct(snap.collapseY) }} />
      <div className="absolute inset-x-0 h-0.5 bg-red-500" style={{ bottom: pct(snap.collapseY + COLLAPSE_WARN_H) }} />
      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-sm" aria-hidden>
        👑
      </span>
      {snap.players.map((p) => (
        <span
          key={p.seat}
          className={`absolute left-1/2 -translate-x-1/2 translate-y-1/2 text-[13px] leading-none font-black drop-shadow ${p.status === "out" ? "opacity-35" : ""}`}
          style={{ bottom: pct(p.status === "done" ? top : p.status === "out" ? p.best : p.y), color: SEAT_COLORS[p.seat % 6], WebkitTextStroke: p.seat === mySeat ? "1px white" : undefined }}
          title={`${SEAT_COLOR_NAMES[p.seat % 6]}`}
        >
          {SEAT_SYMBOLS[p.seat % 6]}
        </span>
      ))}
    </div>
  );
}

/* ── 보드 ───────────────────────────────────────────────────────────── */

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "go" | "warn" | "ko" | "info" | "gold";
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

const nameOf = (names: Record<number, string>, seat: number, me: number) => (seat === me ? "나" : (names[seat] ?? `${seat + 1}번`));

export default function CrumbleClimbBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: CrumbleClimbBoardProps) {
  const [view, setView] = useState<{ mode: ViewMode; quality: Quality }>({ mode: "3d", quality: "auto" });
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);
  const shared = useRef<SceneShared>({ buf, mySeat, shake: 0, labels: [], camAngle: 0, follow: mySeat, shoveAt: [] });
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

  const tower = useMemo(() => buildTower(snap.towerSeed), [snap.towerSeed]);
  const me = snap.players[mySeat];
  const climbingNow = snap.phase === "climb";
  const sound = getCrumbleClimbSound;
  const followS = followSeat(snap, mySeat);
  const fp = snap.players[followS];
  const gapBelow = fp ? fp.y - snap.collapseY : 99;
  // BGM 3단계: 🏁 첫 등정 뒤 2 · 붕괴선이 (따라가는 사람) 발밑 4m 안 1 · 평소 0
  const bgmLevel = !climbingNow ? 0 : snap.finalCall ? 2 : gapBelow < 4 ? 1 : 0;
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

  const onLocalPress = useCallback(
    (what: "jump" | "shove") => {
      const p = snap.players[mySeat];
      if (!p || snap.phase !== "climb" || p.status !== "climb") return;
      if (what === "jump") {
        if (p.on >= 0 || p.feather) sound().play("jump", 1);
      } else if (snap.t >= p.shoveCdAt - 150) {
        sound().play("shove");
        shared.current.shoveAt[mySeat] = performance.now();
      } else sound().play("denied");
    },
    [snap, mySeat, sound],
  );

  const controls = useControls(onInput, !ended, shared, onLocalPress);

  // 새 이벤트 → 연출·소리·알림
  const lastFresh = useRef(0);
  useEffect(() => {
    if (fresh.seq === lastFresh.current) return;
    lastFresh.current = fresh.seq;
    const now = performance.now();
    const s = sound();
    const add: FxItem[] = [];
    const follow = snap.players[followSeat(snap, mySeat)];
    const near = (x: number, y: number, z: number, r: number) => !!follow && Math.hypot(follow.x - x, follow.y - y, follow.z - z) < r;
    const platXYZ = (i: number) => {
      const p = tower.platforms[i];
      if (!p) return { x: 0, y: 0, z: 0 };
      const c = platPos(p, snap.t);
      return { x: c.x, y: p.y, z: c.z };
    };
    let crackPlayed = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "jump":
          if (ev.s !== mySeat) {
            const o = snap.players[ev.s];
            if (o && near(o.x, o.y, o.z, 6)) s.play("jump", 0.35);
          }
          break;
        case "airJump":
          s.play("airJump");
          break;
        case "land": {
          const o = snap.players[ev.s];
          if (ev.s === mySeat) {
            s.play("land", Math.max(0.6, ev.drop));
            if (ev.drop >= 3) shared.current.shake = Math.max(shared.current.shake, 0.4);
          } else if (o && near(o.x, o.y, o.z, 5)) s.play("landFar");
          if (ev.drop >= 1.5) add.push(o ? { ev, at: now, x: o.x, y: o.y, z: o.z } : { ev, at: now, ...platXYZ(ev.p) });
          break;
        }
        case "bounce":
          if (ev.s === mySeat || near(platXYZ(ev.p).x, platXYZ(ev.p).y, platXYZ(ev.p).z, 7)) s.play("bounce");
          add.push({ ev, at: now, ...platXYZ(ev.p) });
          break;
        case "shove": {
          const o = snap.players[ev.s];
          if (ev.s !== mySeat) {
            shared.current.shoveAt[ev.s] = now;
            if (o && near(o.x, o.y, o.z, 6)) s.play("shove");
          }
          if (o) add.push({ ev, at: now, x: o.x, y: o.y, z: o.z, face: o.face });
          break;
        }
        case "hit":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play("hit");
            shared.current.shake = Math.max(shared.current.shake, 0.6);
          } else if (near(ev.x, ev.y, ev.z, 6)) s.play("hit");
          if (ev.by >= 0 && ev.by !== ev.s)
            pushFeed(
              <>
                <SeatTag seat={ev.by} names={names} me={mySeat} /> <span className="text-amber-300">👊</span> <SeatTag seat={ev.s} names={names} me={mySeat} />
              </>,
            );
          break;
        case "block": {
          const o = snap.players[ev.s];
          s.play("block");
          if (o) add.push({ ev, at: now, x: o.x, y: o.y, z: o.z });
          if (ev.s === mySeat) showBanner("🛡 막았다!", "info", undefined, 900);
          break;
        }
        case "crack":
          if (!crackPlayed && near(platXYZ(ev.p).x, platXYZ(ev.p).y, platXYZ(ev.p).z, 7)) {
            s.play("crack");
            crackPlayed = true;
          }
          break;
        case "break":
          add.push({ ev, at: now, ...platXYZ(ev.p) });
          if (near(platXYZ(ev.p).x, platXYZ(ev.p).y, platXYZ(ev.p).z, 8)) s.play("break");
          break;
        case "respawn":
          if (near(platXYZ(ev.p).x, platXYZ(ev.p).y, platXYZ(ev.p).z, 6)) s.play("respawn");
          break;
        case "gone":
          if (near(platXYZ(ev.p).x, platXYZ(ev.p).y, platXYZ(ev.p).z, 9)) {
            s.play("gone");
            add.push({ ev, at: now, ...platXYZ(ev.p) });
          }
          break;
        case "finish": {
          const o = snap.players[ev.s];
          if (o) add.push({ ev, at: now, x: o.x, y: o.y, z: o.z });
          if (ev.s === mySeat) {
            s.play("myFinish");
            showBanner(ev.place === 1 ? "👑 1등 등정!" : `👑 ${ev.place}등 등정!`, "gold", `+${ev.pts}점`, 2200);
          } else s.play("finish");
          pushFeed(
            <>
              👑 <SeatTag seat={ev.s} names={names} me={mySeat} /> {ev.place}등 등정 <span className="text-emerald-300">+{ev.pts}</span>
            </>,
          );
          break;
        }
        case "finalCall":
          s.play("finalCall");
          showBanner("🏁 첫 등정!", "warn", "붕괴가 빨라져요 — 서둘러요!", 1800);
          break;
        case "caught": {
          const o = snap.players[ev.s];
          if (o) add.push({ ev, at: now, x: o.x, y: ev.y, z: o.z });
          if (ev.s === mySeat) {
            s.play("myOut");
            shared.current.shake = 1;
            showBanner("💨 붕괴에 휩쓸렸어요", "ko", snap.options.sabotage ? "🧱 이제 방해 카드로 선두를 괴롭혀요!" : "다른 사람을 구경해요", 2200);
          } else s.play("caught");
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} /> <span className="text-stone-300">💨 휩쓸림</span> ({ev.y.toFixed(0)}m)
            </>,
          );
          break;
        }
        case "card":
          if (ev.s === mySeat) {
            s.play("card");
            showBanner("🧱 방해 카드 도착!", "info", "아래에서 하나 골라요 (1~3 키)", 1400);
          }
          break;
        case "sab": {
          const info = SAB_INFO[ev.kind];
          const key = ev.kind === "rocks" ? "sabRocks" : ev.kind === "ice" ? "sabIce" : ev.kind === "wind" ? "sabWind" : "sabShake";
          s.play(key);
          if (ev.target === mySeat) {
            s.play("targeted");
            showBanner(`${info.emoji} ${info.name}!`, "warn", `${nameOf(names, ev.s, mySeat)}의 방해 — ${info.desc}`, 2000);
          }
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} /> {info.emoji} {info.name}
              {ev.target >= 0 && (
                <>
                  {" → "}
                  <SeatTag seat={ev.target} names={names} me={mySeat} />
                </>
              )}
            </>,
          );
          break;
        }
        case "rock":
          add.push({ ev, at: now });
          if (near(ev.x, ev.y, ev.z, 8)) {
            s.play("rock", ev.n);
            shared.current.shake = Math.max(shared.current.shake, 0.35);
          }
          break;
        case "spawn":
          if (near(platXYZ(ev.p).x, platXYZ(ev.p).y, platXYZ(ev.p).z, 8)) s.play("spawn");
          break;
        case "pick": {
          const o = snap.players[ev.s];
          if (o) add.push({ ev, at: now, x: o.x, y: o.y, z: o.z });
          if (ev.s === mySeat) {
            s.play(ev.kind);
            showBanner(`${ITEM_INFO[ev.kind].emoji} ${ITEM_INFO[ev.kind].name}!`, "info", ITEM_INFO[ev.kind].desc, 1700);
          }
          break;
        }
        case "go":
          s.play("go");
          showBanner("올라가!", "go", undefined, 900);
          break;
        case "round":
          s.play("roundStart");
          break;
        case "end": {
          const h = snap.history[snap.history.length - 1];
          if (h && h.order[0] === mySeat) s.play("roundWin");
          else s.play("roundLose");
          break;
        }
        case "over":
          s.play(snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        default:
          break;
      }
    }
    if (add.length) setFx((f) => [...f.filter((x) => now - x.at < 1900), ...add].slice(-60));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound, tower]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  // 내 발밑 위험
  const myClimb = !!me && me.status === "climb" && climbingNow;
  const myGap = me ? me.y - snap.collapseY : 99;
  const collapseNear = myClimb && myGap < COLLAPSE_WARN_H + 1.5;
  const onCrumbling = myClimb && me.on >= 0 && snap.crumbleAt[me.on] > 0;
  const onIcy = myClimb && me.on >= 0 && snap.icyUntil[me.on] > snap.t;
  const rockOver = myClimb && snap.rocks.some((r) => Math.hypot(r.x - me.x, r.z - me.z) < 1.4 && Math.abs(r.y - me.y) < 2);
  const windOn = myClimb && !!snap.wind && snap.t >= snap.wind.at - 900 && me.y >= snap.wind.minY;
  useEffect(() => {
    if (!collapseNear) return;
    sound().play("danger");
    const id = window.setInterval(() => sound().play("danger"), 900);
    return () => window.clearInterval(id);
  }, [collapseNear, sound]);

  // 발소리
  const stepAcc = useRef<{ x: number; z: number; d: number; n: number } | null>(null);
  useEffect(() => {
    if (!me || !myClimb || me.on < 0) {
      stepAcc.current = null;
      return;
    }
    const a = stepAcc.current;
    if (!a) {
      stepAcc.current = { x: me.x, z: me.z, d: 0, n: 0 };
      return;
    }
    const d = Math.hypot(me.x - a.x, me.z - a.z);
    a.x = me.x;
    a.z = me.z;
    if (d > 3) return;
    a.d += d;
    if (a.d >= 0.95) {
      a.d = 0;
      a.n += 1;
      sound().play("step", a.n);
    }
  }, [me, myClimb, sound]);

  // 밀치기 다시 쓸 수 있으면 띵
  const shoveReady = myClimb && snap.t >= (me?.shoveCdAt ?? 0);
  const lastReady = useRef(true);
  useEffect(() => {
    if (shoveReady && !lastReady.current) sound().play("ready");
    lastReady.current = shoveReady;
  }, [shoveReady, sound]);

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
  const el = climbingNow ? snap.t - snap.climbStart : 0;
  const lastRound = snap.history[snap.history.length - 1];
  const cdFrac = (until: number, total: number) => (snap.t >= until ? 1 : Math.max(0, 1 - (until - snap.t) / total));
  const scoreOrder = useMemo(() => [...snap.players].sort((a, b) => b.score - a.score || a.seat - b.seat), [snap.players]);
  const leaderSeat = useMemo(() => {
    let best = -1;
    let by = -Infinity;
    for (const p of snap.players) if (p.status === "climb" && p.y > by) {
      by = p.y;
      best = p.seat;
    }
    return best;
  }, [snap.players]);
  const card = me?.card ?? null;
  const top = tower.top;

  const statusIcon = (p: PlayerState) => (p.status === "done" ? `👑${p.place}` : p.status === "out" ? "💨" : "");

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          🧱 라운드 {snap.round}/{snap.options.rounds}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="tabular-nums">
          {climbingNow ? (
            snap.finalCall ? (
              <span className="font-bold text-rose-300 light:text-rose-600">🏁 붕괴 가속 · {Math.floor(el / 1000)}초</span>
            ) : (
              <>⏱ {Math.floor(el / 1000)}초</>
            )
          ) : snap.phase === "countdown" ? (
            "준비"
          ) : snap.phase === "roundEnd" ? (
            "라운드 끝"
          ) : (
            "끝"
          )}
        </span>
        {me && (
          <span className="tabular-nums">
            {me.status === "climb" ? (
              <>
                ⛰ 내 높이 <b className="text-white light:text-slate-900">{Math.max(0, me.y).toFixed(1)}</b>/{top.toFixed(0)}m · 붕괴까지 <b className={myGap < 3 ? "text-rose-300 light:text-rose-600" : "text-white light:text-slate-900"}>{Math.max(0, myGap).toFixed(1)}m</b>
              </>
            ) : me.status === "done" ? (
              <>👑 {me.place}등 등정</>
            ) : (
              <>💨 휩쓸림 ({me.best.toFixed(0)}m)</>
            )}
          </span>
        )}
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
              {m === "3d" ? "🎥 3D" : "🖼️ 2D 옆모습"}
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

      {/* 점수판 */}
      <div className="flex flex-wrap gap-1.5">
        {scoreOrder.map((p) => (
          <div
            key={p.seat}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"} ${p.status === "out" ? "opacity-60" : ""}`}
            title={`${SEAT_COLOR_NAMES[p.seat % 6]} ${SEAT_SYMBOLS[p.seat % 6]}`}
          >
            <span aria-hidden className="text-sm leading-none" style={{ color: SEAT_COLORS[p.seat % 6] }}>
              {SEAT_SYMBOLS[p.seat % 6]}
            </span>
            <span className="max-w-[6.5rem] truncate font-semibold text-white light:text-slate-900">{nameOf(names, p.seat, mySeat)}</span>
            {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
            <b className="tabular-nums text-amber-200 light:text-amber-700">{p.score}점</b>
            {snap.phase !== "gameOver" && (
              <span className="text-[11px] tabular-nums text-white/60 light:text-slate-500">
                {statusIcon(p) || `${Math.max(0, p.y).toFixed(0)}m`}
                {p.seat === leaderSeat && p.status === "climb" && " 🔝"}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#3b2a6b] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[66svh] min-h-[340px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? <TowerScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} fx={fx} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} /> : <Tower2D shared={shared} />}

        {/* 이름표 */}
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
                <span className="max-w-[5.5rem] truncate">{nameOf(names, p.seat, mySeat)}</span>
                {p.status === "climb" && snap.t < p.shieldUntil && <span aria-label="방패">🛡</span>}
                {p.status === "climb" && p.feather && <span aria-label="깃털">🪶</span>}
                {p.status === "climb" && snap.t < p.bootsUntil && <span aria-label="번개 신발">⚡</span>}
              </div>
              {p.seat === mySeat && p.status === "climb" && <div className="h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />}
            </div>
          ))}
        </div>

        <HeightBar snap={snap} mySeat={mySeat} top={top} />

        {/* 알림판 */}
        <div className="pointer-events-none absolute top-2 right-11 z-20 flex max-w-[58%] flex-col items-end gap-1">
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
              <span className="text-sm font-bold text-white drop-shadow">라운드 {snap.round} · 새 탑</span>
              <span key={countLeft} className="animate-[cc-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft}
              </span>
              {snap.round === 1 && (
                <span className="mt-1 max-w-sm rounded-full bg-black/45 px-3 py-1 text-center text-xs text-white">
                  {touch ? "왼쪽을 끌어 이동 · ⤴ 점프 · 👊 밀치기" : "WASD/방향키 이동 (←→ 탑 둘레) · Space 점프 · Shift 밀치기"} — 아래에서 탑이 무너져요!
                </span>
              )}
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[cc-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-amber-300 text-slate-900" : b.tone === "warn" ? "bg-rose-600 text-white" : b.tone === "gold" ? "bg-yellow-300 text-slate-950" : b.tone === "ko" ? "bg-stone-700 text-white" : "bg-slate-900/85 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-4xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 내 발밑 경고 (소리 없이도 보이게) */}
        {myClimb && (collapseNear || onCrumbling || rockOver || windOn || onIcy) && (
          <div className={`pointer-events-none absolute inset-x-0 bottom-[30%] z-20 mx-auto w-fit animate-pulse rounded-full px-3 py-1 text-xs font-bold ${collapseNear || rockOver ? "bg-rose-600/90 text-white" : "bg-amber-400/95 text-slate-950"}`}>
            {rockOver ? "🪨 머리 위에 낙석! 비켜요" : collapseNear ? `⚠️ 붕괴선이 바로 아래! (${Math.max(0, myGap).toFixed(1)}m)` : onCrumbling ? "⚠️ 발판이 무너져요! 뛰어요" : windOn ? "💨 돌풍! 기둥 쪽으로 버텨요" : "🧊 얼음판 — 미끄러워요"}
          </div>
        )}

        {/* 라운드 결과 */}
        {snap.phase === "roundEnd" && lastRound && (
          <div className="absolute inset-x-3 top-[10%] z-30 mx-auto max-w-sm animate-[cc-pop_0.4s_ease-out] rounded-2xl border border-white/15 bg-slate-950/85 p-4 text-center text-white shadow-2xl">
            <p className="text-xs text-white/60">라운드 {lastRound.round} 결과 · {Math.round(lastRound.ms / 1000)}초</p>
            <p className="mt-1 text-xl font-black">
              {lastRound.order.length > 0 ? (
                <>
                  👑 <SeatTag seat={lastRound.order[0]} names={names} me={mySeat} /> 1등 등정!
                </>
              ) : (
                "💨 아무도 못 올랐어요"
              )}
            </p>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {[...snap.players]
                .sort((a, b) => b.score - a.score || a.seat - b.seat)
                .map((p) => {
                  const place = lastRound.order.indexOf(p.seat) + 1;
                  return (
                    <li key={p.seat} className="flex items-center justify-between gap-2">
                      <SeatTag seat={p.seat} names={names} me={mySeat} />
                      <span className="tabular-nums">
                        <span className="mr-2 text-xs text-white/60">{place > 0 ? `👑 ${place}등` : `💨 ${lastRound.best[p.seat].toFixed(0)}m`}</span>
                        {lastRound.pts[p.seat] > 0 && <span className="mr-2 text-emerald-300">+{lastRound.pts[p.seat]}</span>}
                        <b>{p.score}점</b>
                      </span>
                    </li>
                  );
                })}
            </ul>
            <p className="mt-2 text-[11px] text-white/50">{snap.round < snap.options.rounds ? `곧 라운드 ${snap.round + 1} — 새 탑이 솟아요` : "최종 결과로…"}</p>
          </div>
        )}

        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}

        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        <button type="button" onClick={() => { uiClick(); toggleFull(); }} className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white" aria-label={full ? "전체화면 끄기" : "전체화면"}>
          {full ? "↙ 작게" : "⛶ 크게"}
        </button>

        {/* 방해 카드 */}
        {card && !ended && climbingNow && (
          <CardPicker kinds={card.kinds} left={Math.max(0, card.until - snap.t)} target={leaderSeat >= 0 && leaderSeat !== mySeat ? nameOf(names, leaderSeat, mySeat) : null} onPick={(i) => { uiClick(); controls.pickCard(i); }} />
        )}

        {/* 터치 조작 */}
        {touch && !ended && snap.phase !== "gameOver" && myClimb && !card && (
          <>
            <Joystick onMove={controls.setStick} />
            <div className="absolute right-11 bottom-3 z-20 flex items-end gap-2">
              <CdButton label="👊" sub="밀치기" ariaLabel="밀치기" frac={cdFrac(me.shoveCdAt, SHOVE_CD_MS)} onDown={() => controls.press("shove")} />
              <CdButton label="⤴" sub={me.feather && me.on < 0 ? "🪶 한 번 더" : "점프"} big ariaLabel="점프" frac={1} onDown={() => controls.press("jump")} />
            </div>
          </>
        )}
      </div>

      {/* 내 상태 + 키 안내 */}
      {me && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          {me.status === "climb" ? (
            <>
              <Meter label="⛰ 높이" frac={Math.max(0, me.y) / top} value={`${Math.round((Math.max(0, me.y) / top) * 100)}%`} />
              <Meter label="👊 밀치기" frac={cdFrac(me.shoveCdAt, SHOVE_CD_MS)} />
              {me.feather && <span>🪶 공중 점프 1번</span>}
              {snap.t < me.bootsUntil && <span>⚡ {Math.ceil((me.bootsUntil - snap.t) / 1000)}초</span>}
              {snap.t < me.shieldUntil && <span>🛡 {Math.ceil((me.shieldUntil - snap.t) / 1000)}초</span>}
            </>
          ) : me.status === "done" ? (
            <span>👑 {me.place}등으로 올랐어요 (+{finishPoints(me.place)}점) — 다른 사람을 구경해요</span>
          ) : snap.options.sabotage ? (
            <span>💨 휩쓸렸어요 — 🧱 방해 카드가 오면 아래에서 골라(1~3 키) 선두를 괴롭혀요. 카메라는 선두를 따라가요.</span>
          ) : (
            <span>💨 휩쓸렸어요 — 카메라가 선두를 따라가요</span>
          )}
          {!touch && <span className="text-white/40 light:text-slate-400">WASD/방향키 이동 (←→ 탑 둘레 · ↑↓ 기둥 쪽/바깥) · Space/K 점프 · Shift/J/E 밀치기 · 1~3 방해 카드</span>}
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
        @keyframes cc-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
      `}</style>
    </div>
  );
}

function Meter({ label, frac, value }: { label: string; frac: number; value?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-white/15 light:bg-slate-200">
        <span className="block h-full bg-amber-400" style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }} />
      </span>
      {value ? <span className="tabular-nums">{value}</span> : frac >= 1 && <span className="text-emerald-300 light:text-emerald-600">✓</span>}
    </span>
  );
}

function FinalPanel({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.ranks ?? snap.players.map(() => 1);
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || a.seat - b.seat);
  const best = (f: (p: PlayerState) => number, low = false) => {
    const vals = snap.players.map(f).filter((v) => v > 0);
    if (vals.length === 0) return { seats: [] as number[], max: 0 };
    const max = low ? Math.min(...vals) : Math.max(...vals);
    return { seats: snap.players.filter((p) => f(p) === max).map((p) => p.seat), max };
  };
  const fast = best((p) => p.stats.fastestMs, true);
  const fin = best((p) => p.stats.finishes);
  const shove = best((p) => p.stats.shoveHits);
  const sab = best((p) => p.stats.sabHits);
  const bounce = best((p) => p.stats.bounces);
  const awards: { icon: string; title: string; seats: number[]; value: string }[] = [
    { icon: "⚡", title: "가장 빠른 등정", seats: fast.seats, value: `${(fast.max / 1000).toFixed(1)}초` },
    { icon: "👑", title: "등정왕", seats: fin.seats, value: `${fin.max}번` },
    { icon: "👊", title: "밀치기 왕", seats: shove.seats, value: `${shove.max}번` },
    { icon: "🪨", title: "낙석 저격수", seats: sab.seats, value: `${sab.max}명` },
    { icon: "🟩", title: "통통 튀는 사람", seats: bounce.seats, value: `${bounce.max}번` },
  ].filter((a) => a.seats.length > 0);
  return (
    <div className="absolute inset-x-3 top-[6%] z-30 mx-auto max-h-[86%] max-w-md overflow-y-auto rounded-2xl border border-amber-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
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
              👑{p.stats.finishes} · 🥇{p.stats.roundWins} · 💨{p.stats.caught} · <b className="text-sm text-amber-200">{p.score}점</b>
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
      <p className="mt-3 text-center text-[11px] text-white/50">동점이면 라운드 1등 등정 → 오른 높이 합 순</p>
    </div>
  );
}
