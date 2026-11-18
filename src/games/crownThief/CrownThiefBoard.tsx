"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { arenaFor } from "./arena";
import Arena2D from "./Arena2D";
import { getCrownThiefSound } from "./crownThiefSound";
import { DASH_CD_MS, GOLDEN_MS, GOLDEN_MULT, INVULN_MS, ITEM_INFO, MODE_INFO, REVENGE_MS, SEAT_COLORS, SEAT_COLOR_NAMES, SEAT_SYMBOLS, TEAM_INFO, fmtScore } from "./data";
import type { SnapBuffer, Snap } from "./net";
import { crownOn, crownSpeedMult, isUnderdog, type GameEvent, type PlayerInput, type PlayerState } from "./sim";
import RulebookModal from "./RulebookModal";
import type { FxItem } from "./three/Fx";
import type { SceneShared } from "./three/ArenaScene";

const ArenaScene = dynamic(() => import("./three/ArenaScene"), { ssr: false, loading: () => null });

/**
 * 왕관 도둑 게임 화면 (룰북 §9~§11): 3D/2D 무대 + 이름표 + HUD + 조작(키보드·터치) + 최종 결과.
 * 방장이든 손님이든 같은 스냅샷 버퍼를 그린다. 왕관이 넘어가는 연출은 방장이 확정한 `steal` 이벤트로만.
 */

export interface CrownThiefBoardProps {
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
const VIEW_KEY = "crown-thief:view";

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
  dash: ["Space", "KeyK"],
  skill: ["ShiftLeft", "ShiftRight", "KeyJ", "KeyE"],
};

function useControls(onInput: (inp: PlayerInput) => void, enabled: boolean, onLocalPress: (what: "dash" | "skill") => void) {
  const held = useRef(new Set<string>());
  const stick = useRef<{ x: number; z: number } | null>(null);
  const counters = useRef({ dash: 0, skill: 0 });
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
    return { mx: Math.round(mx * 100) / 100, mz: Math.round(mz * 100) / 100, dash: counters.current.dash, skill: counters.current.skill };
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
    (what: "dash" | "skill") => {
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
      else if (KEYS.skill.includes(e.code)) press("skill");
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
        <div className="pointer-events-none absolute bottom-6 left-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/35 text-center text-[11px] font-semibold text-white/70">
          여기를 끌어
          <br />
          이동
        </div>
      )}
    </div>
  );
}

function CdButton({ label, sub, frac, onDown, big, ariaLabel, disabled }: { label: ReactNode; sub?: string; frac: number; onDown: () => void; big?: boolean; ariaLabel: string; disabled?: boolean }) {
  const ready = frac >= 1 && !disabled;
  const size = big ? 78 : 64;
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
      className={`relative flex touch-none select-none flex-col items-center justify-center rounded-full border-2 font-bold text-white shadow-lg ${ready ? "border-amber-200/80 bg-black/45" : "border-white/25 bg-black/30 text-white/45"}`}
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
  tone: "go" | "gold" | "bad" | "info" | "curse";
}

interface Feed {
  id: number;
  text: ReactNode;
}

function SeatTag({ seat, names, me, team }: { seat: number; names: Record<number, string>; me: number; team?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SEAT_COLORS[seat % 8] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat % 8]}</span>
      {team && <span aria-label={TEAM_INFO[seat % 2].name}>{TEAM_INFO[seat % 2].symbol}</span>}
      <span className="max-w-[7rem] truncate text-white light:text-slate-900">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

export default function CrownThiefBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: CrownThiefBoardProps) {
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
    // 저장된 보기 설정·기기 종류는 마운트 뒤에 읽는다 (서버 렌더와 맞추기)
    /* eslint-disable react-hooks/set-state-in-effect */
    setView(loadView());
    setCanGl(webglOk());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const me = snap.players[mySeat];
  const fighting = snap.phase === "fight";
  const curse = snap.options.mode === "curse";
  const team = snap.options.mode === "team";
  const sound = getCrownThiefSound;
  const left = fighting ? Math.max(0, snap.fightEnd - snap.t) : snap.phase === "countdown" ? snap.fightEnd - snap.fightStart : 0;
  const leftSec = Math.ceil(left / 1000);
  // BGM 3단계: 마지막 10초 2 · 황금 왕관 1 · 평소 0
  const bgmLevel = !fighting ? 0 : left <= 10_000 ? 2 : snap.golden ? 1 : 0;
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

  const isMeKing = snap.crown.state === "held" && snap.crown.holder === mySeat;

  // 내가 누른 돌진·호령은 바로 소리 (방장 확인을 기다리지 않음)
  const onLocalPress = useCallback(
    (what: "dash" | "skill") => {
      const p = snap.players[mySeat];
      if (!p || snap.phase !== "fight" || p.respawnAt > 0) return;
      if (what === "dash") {
        if (p.move === "none" && snap.t >= p.dashCdAt - 150) sound().play("dash");
        else sound().play("denied");
      } else if (!(snap.crown.state === "held" && snap.crown.holder === mySeat) || p.skillUsed) sound().play("denied");
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
    // 새 스냅샷의 이벤트를 화면 효과·알림으로 옮기는 곳 — 이벤트 묶음마다 한 번만 돈다
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "go":
          s.play("go");
          showBanner(curse ? "💀 저주를 피해라!" : "👑 왕관을 노려라!", "go", undefined, 1000);
          break;
        case "crownLand":
          add.push({ ev, at: now });
          s.play("crownLand");
          break;
        case "steal": {
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play(curse ? "cursed" : ev.from >= 0 ? "steal" : "pickup");
            setFlash({ id: ev.id, tone: curse ? "bad" : "gold" });
            shared.current.shake = Math.max(shared.current.shake, 0.35);
            showBanner(curse ? "💀 저주를 떠안았어요!" : ev.from >= 0 ? "👑 왕관을 뺏었어요!" : "👑 왕관을 주웠어요!", curse ? "curse" : "gold", curse ? `${INVULN_MS / 1000}초 뒤부터 다른 사람을 만져 떠넘겨요` : `${INVULN_MS / 1000}초 동안 무적 — 이제 도망쳐요!`, 1500);
          } else if (ev.from === mySeat) {
            s.play(curse ? "passed" : "lost");
            if (!curse) setFlash({ id: ev.id, tone: "bad" });
            showBanner(curse ? "😮‍💨 저주를 떠넘겼어요" : "😱 왕관을 뺏겼어요", curse ? "gold" : "bad", curse ? `${nm(ev.s)}에게 · ${REVENGE_MS / 1000}초 동안은 다시 안 와요` : `${REVENGE_MS / 1000}초 동안은 ${nm(ev.s)}에게서 다시 못 뺏어요`, 1500);
          } else s.play("stealOther");
          pushFeed(
            ev.from >= 0 ? (
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> <span className={curse ? "text-violet-300" : "text-amber-300"}>{curse ? "💀←" : "👑←"}</span> <SeatTag seat={ev.from} names={names} me={mySeat} team={team} />
              </>
            ) : (
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> {curse ? "💀 저주가 내려앉음" : "👑 왕관을 주움"}
              </>
            ),
          );
          break;
        }
        case "drop":
          add.push({ ev, at: now });
          s.play("drop");
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> 👑 왕관을 떨어뜨림!
            </>,
          );
          if (ev.s !== mySeat) showBanner("👑 왕관이 떨어졌어요!", "info", "먼저 줍는 사람이 왕", 1200);
          break;
        case "dash":
          if (ev.s !== mySeat) {
            const o = snap.players[ev.s];
            if (o && near(o.x, o.z, 5)) s.play("dash");
          }
          break;
        case "dashHit":
          add.push({ ev, at: now });
          if (ev.a === mySeat || ev.b === mySeat || near(ev.x, ev.z, 6)) s.play("dashHit");
          if (ev.b === mySeat) shared.current.shake = Math.max(shared.current.shake, 0.4);
          break;
        case "roar":
          add.push({ ev, at: now });
          s.play("roar");
          if (near(ev.x, ev.z, 4)) shared.current.shake = Math.max(shared.current.shake, 0.5);
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> <span className="text-amber-300">📣 호령</span> {ev.n}명 밀침
            </>,
          );
          break;
        case "snare":
          add.push({ ev, at: now });
          s.play("snare");
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> <span className="text-violet-300">💀 저주의 손길</span> {ev.n}명 느려짐
            </>,
          );
          break;
        case "bump":
          add.push({ ev, at: now });
          if (ev.p > 3.5 && (ev.a === mySeat || ev.b === mySeat || near(ev.x, ev.z, 5))) s.play("bump", ev.p);
          break;
        case "fall":
          s.play("fall");
          if (ev.s === mySeat) shared.current.shake = 0.8;
          pushFeed(
            ev.by >= 0 ? (
              <>
                <SeatTag seat={ev.by} names={names} me={mySeat} team={team} /> <span className="text-sky-300">💥 밀어 떨어뜨림</span> <SeatTag seat={ev.s} names={names} me={mySeat} team={team} />
                {ev.king && !curse ? " 👑" : ""}
              </>
            ) : (
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> <span className="text-sky-300">☁️ 떨어짐</span>
              </>
            ),
          );
          if (ev.s === mySeat) showBanner("☁️ 떨어졌어요!", "bad", "잠시 뒤 다시 나타나요", 1500);
          break;
        case "respawn":
          add.push({ ev, at: now });
          if (ev.s === mySeat) s.play("respawn");
          break;
        case "pad":
          {
            const o = snap.players[ev.s];
            if (ev.s === mySeat || (o && near(o.x, o.z, 6))) s.play("pad");
          }
          break;
        case "land":
          if (ev.s === mySeat || near(ev.x, ev.z, 5)) s.play("land");
          add.push({ ev, at: now });
          break;
        case "spawn":
          s.play("spawn");
          break;
        case "pick":
          add.push({ ev, at: now });
          s.play(ev.kind);
          if (ev.s === mySeat) showBanner(`${ITEM_INFO[ev.kind].emoji} ${ITEM_INFO[ev.kind].name}!`, "info", ITEM_INFO[ev.kind].desc, 1700);
          else
            pushFeed(
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> {ITEM_INFO[ev.kind].emoji} {ITEM_INFO[ev.kind].name}
              </>,
            );
          break;
        case "expire":
          s.play("expire");
          break;
        case "slip":
          add.push({ ev, at: now });
          s.play("slip");
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> 🍌 미끄덩!
            </>,
          );
          break;
        case "fakeOn":
          if (ev.s === mySeat) showBanner("🎭 가짜 왕관을 썼어요", "info", "진짜처럼 보여요 — 쫓는 사람을 속여요", 1500);
          break;
        case "invulnEnd":
          if (ev.s === mySeat || (snap.crown.state === "held" && mine && near(snap.players[ev.s]?.x ?? 99, snap.players[ev.s]?.z ?? 99, 6))) s.play("invulnEnd");
          break;
        case "golden":
          s.play("golden");
          showBanner(curse ? "✨ 황금 저주!" : "✨ 황금 왕관!", "gold", `마지막 ${GOLDEN_MS / 1000}초 — 점수 ${GOLDEN_MULT}배`, 2000);
          break;
        case "over":
          s.play(snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        default:
          break;
      }
    }
    if (add.length) setFx((f) => [...f.filter((x) => now - x.at < 1700), ...add].slice(-50));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound, curse, team]);

  // 화면 가장자리 번쩍임 (소리 없이도 왕관 이동이 보이게)
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 650);
    return () => window.clearTimeout(id);
  }, [flash]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  // 마지막 10초 똑딱
  const lastClock = useRef(0);
  useEffect(() => {
    if (fighting && leftSec <= 10 && leftSec > 0 && leftSec !== lastClock.current) sound().play("clock", leftSec);
    lastClock.current = leftSec;
  }, [leftSec, fighting, sound]);

  // 돌진 다시 쓸 수 있게 되면 띵
  const dashReady = !!me && fighting && me.respawnAt === 0 && snap.t >= me.dashCdAt;
  const lastReady = useRef(true);
  useEffect(() => {
    if (dashReady && !lastReady.current) sound().play("ready");
    lastReady.current = dashReady;
  }, [dashReady, sound]);

  const uiClick = useCallback(() => sound().play("ui"), [sound]);

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
    else if (full) setFull(false);
    else if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) void el.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  };

  const quality: "high" | "low" = view.quality === "auto" ? (touch || lowFps ? "low" : "high") : view.quality;
  const use3d = view.mode === "3d" && canGl;
  const kingP = snap.crown.state === "held" ? snap.players[snap.crown.holder] : null;
  const anyFake = fighting && snap.players.some((p) => snap.t < p.fakeUntil && p !== kingP);
  const invulnLeft = kingP ? Math.max(0, snap.crown.invulnUntil - snap.t) : 0;
  const banned = snap.crown.prev === mySeat && snap.t < snap.crown.prevUntil;
  const weight = me && isMeKing ? crownSpeedMult(snap, me) : 1;
  const underdog = !!me && isUnderdog(snap, me);
  const R = arenaFor(snap.seatCount).radius;
  const edgeDanger = !!me && fighting && me.respawnAt === 0 && me.move !== "pad" && Math.hypot(me.x, me.z) > R - 1.3;

  const cdFrac = (until: number, total: number) => (snap.t >= until ? 1 : Math.max(0, 1 - (until - snap.t) / total));
  const scoreOrder = useMemo(() => [...snap.players].sort((a, b) => (curse ? a.score - b.score : b.score - a.score) || a.seat - b.seat), [snap.players, curse]);

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="tabular-nums">
          {snap.phase === "countdown" ? "준비" : snap.phase === "gameOver" ? "끝" : snap.golden ? <b className="text-amber-300 light:text-amber-600">✨ 황금 {GOLDEN_MULT}배 · 남은 {leftSec}초</b> : <>⏱ 남은 {leftSec}초</>}
        </span>
        {fighting && (
          <span className="tabular-nums">
            {kingP ? (
              <>
                {anyFake ? "👑 ??? (🎭 가짜 왕관 있음)" : <>{curse ? "💀" : "👑"} <SeatTag seat={kingP.seat} names={names} me={mySeat} team={team} /></>}
                {invulnLeft > 0 && <span className="ml-1 text-amber-200 light:text-amber-700">🛡 {(invulnLeft / 1000).toFixed(1)}초</span>}
              </>
            ) : snap.crown.state === "ground" ? (
              <b className="text-amber-300 light:text-amber-600">👑 바닥에 떨어짐!</b>
            ) : (
              <span>{curse ? "💀 저주가 곧 내려앉아요" : "👑 왕관이 곧 떨어져요 (가운데)"}</span>
            )}
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

      {/* 팀 점수 */}
      {team && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {[0, 1].map((k) => (
            <div key={k} className={`flex items-center justify-between rounded-xl border px-3 py-1.5 ${me?.team === k ? "border-white/40 bg-white/10" : "border-white/10 bg-white/[0.03]"} light:border-slate-200 light:bg-white`}>
              <span className="font-bold" style={{ color: TEAM_INFO[k].color }}>
                {TEAM_INFO[k].symbol} {TEAM_INFO[k].name}
                {snap.teamMult[k] > 1 && <span className="ml-1 text-[10px] text-white/50">×{snap.teamMult[k]}</span>}
                {me?.team === k && <span className="ml-1 text-[10px] text-white/60 light:text-slate-500">(우리 팀)</span>}
              </span>
              <b className="tabular-nums text-white light:text-slate-900">{fmtScore(snap.teamScores[k])}</b>
            </div>
          ))}
        </div>
      )}

      {/* 점수판 */}
      <div className="flex flex-wrap gap-1.5">
        {scoreOrder.map((p) => {
          const c = crownOn(snap, p);
          return (
            <div
              key={p.seat}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"} ${p.respawnAt > 0 ? "opacity-60" : ""}`}
              title={`${SEAT_COLOR_NAMES[p.seat % 8]} ${SEAT_SYMBOLS[p.seat % 8]}`}
            >
              {c && <span aria-label={curse ? "저주" : "왕관"}>{curse ? "💀" : "👑"}</span>}
              <SeatTag seat={p.seat} names={names} me={mySeat} team={team} />
              {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
              <b className={`tabular-nums ${curse ? "text-violet-200 light:text-violet-700" : "text-amber-200 light:text-amber-700"}`}>{fmtScore(p.score)}</b>
              {p.respawnAt > 0 && <span aria-label="떨어짐">☁️</span>}
            </div>
          );
        })}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#8ec5ff] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[64svh] min-h-[340px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? <ArenaScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} fx={fx} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} /> : <Arena2D shared={shared} />}

        {/* 왕관 이동 번쩍임 (소리 없이도 보이게) */}
        {flash && <div key={flash.id} className={`pointer-events-none absolute inset-0 z-10 animate-[ct-flash_0.65s_ease-out] ${flash.tone === "gold" ? "shadow-[inset_0_0_80px_24px_rgba(251,191,36,0.75)]" : "shadow-[inset_0_0_80px_24px_rgba(244,63,94,0.7)]"}`} />}

        {/* 이름표 (위치는 무대가 매 프레임 옮김) */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {snap.players.map((p) => {
            const c = crownOn(snap, p);
            const real = c === "real";
            const shield = real && invulnLeft > 0;
            const ban = snap.crown.prev === p.seat && snap.t < snap.crown.prevUntil && fighting;
            return (
              <div
                key={p.seat}
                ref={(el) => {
                  shared.current.labels[p.seat] = el;
                }}
                className="absolute top-0 left-0 flex flex-col items-center gap-0.5 whitespace-nowrap"
                style={{ display: "none" }}
              >
                <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white shadow ${c ? (curse ? "bg-violet-900/80" : "bg-amber-600/85") : "bg-black/55"}`}>
                  {c && <span aria-label={curse ? "저주" : "왕관"}>{curse ? "💀" : "👑"}</span>}
                  <span style={{ color: c ? "#fff" : SEAT_COLORS[p.seat % 8] }} aria-hidden>
                    {SEAT_SYMBOLS[p.seat % 8]}
                  </span>
                  {team && <span aria-label={TEAM_INFO[p.team].name}>{TEAM_INFO[p.team].symbol}</span>}
                  <span className="max-w-[5.5rem] truncate">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
                  {shield && <span aria-label="무적">🛡</span>}
                  {ban && <span aria-label="복수 금지">✋</span>}
                  {fighting && snap.t < p.magnetUntil && <span aria-label="자석">🧲</span>}
                  {fighting && snap.t < p.slowUntil && <span aria-label="느려짐">🐌</span>}
                </div>
                {p.seat === mySeat && <div className="h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />}
              </div>
            );
          })}
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
        <div className="pointer-events-none absolute inset-x-0 top-[16%] z-20 flex flex-col items-center gap-2 px-3">
          {snap.phase === "countdown" && (
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold text-white drop-shadow">{MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name}</span>
              <span key={countLeft} className="animate-[ct-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft}
              </span>
              <span className="mt-1 max-w-sm rounded-full bg-black/45 px-3 py-1 text-center text-xs text-white">
                {touch ? "왼쪽을 끌어 이동 · 💨 돌진 · 👑 호령(왕만)" : "WASD/방향키 이동 · Space 돌진 · Shift 호령(왕만)"} — {curse ? "저주받은 왕에게 닿지 마세요!" : "왕을 만지면 내가 왕!"}
              </span>
              {team && me && (
                <span className="mt-1 rounded-full px-3 py-1 text-xs font-bold text-slate-950" style={{ background: TEAM_INFO[me.team].color }}>
                  나는 {TEAM_INFO[me.team].symbol} {TEAM_INFO[me.team].name}
                </span>
              )}
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[ct-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-amber-300 text-slate-900" : b.tone === "gold" ? "bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950" : b.tone === "bad" ? "bg-rose-600 text-white" : b.tone === "curse" ? "bg-violet-700 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-3xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 내 상태 경고 (소리 없이도 보이게) */}
        {fighting && me && me.respawnAt === 0 && (edgeDanger || banned) && (
          <div className={`pointer-events-none absolute inset-x-0 bottom-[30%] z-20 mx-auto w-fit animate-pulse rounded-full px-3 py-1 text-xs font-bold ${edgeDanger ? "bg-rose-600/90 text-white" : "bg-slate-900/85 text-white"}`}>
            {edgeDanger ? "⚠️ 가장자리! 안쪽으로" : `✋ ${Math.ceil((snap.crown.prevUntil - snap.t) / 1000)}초 동안 ${curse ? "이 저주는 내게 안 와요" : "이 왕관을 다시 못 뺏어요"}`}
          </div>
        )}

        {/* 떨어져서 기다리는 중 */}
        {fighting && me && me.respawnAt > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-[34%] z-20 flex flex-col items-center gap-1 px-3">
            <div className="text-4xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">☁️ 떨어졌어요</div>
            <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-white tabular-nums">{(Math.max(0, me.respawnAt - snap.t) / 1000).toFixed(1)}초 뒤 다시 나타나요</div>
          </div>
        )}

        {/* 최종 결과 */}
        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}

        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        {/* 전체화면 */}
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

        {/* 터치 조작 */}
        {touch && !ended && snap.phase !== "gameOver" && me && me.respawnAt === 0 && (
          <>
            <Joystick onMove={controls.setStick} />
            <div className="absolute right-3 bottom-3 z-20 flex items-end gap-2">
              <CdButton label={curse ? "💀" : "📣"} sub={curse ? "손길" : "호령"} ariaLabel={curse ? "저주의 손길 (왕만)" : "왕의 호령 (왕만)"} frac={1} disabled={!isMeKing || me.skillUsed} onDown={() => controls.press("skill")} />
              <CdButton label="💨" sub="돌진" big ariaLabel="돌진" frac={cdFrac(me.dashCdAt, DASH_CD_MS)} onDown={() => controls.press("dash")} />
            </div>
          </>
        )}
      </div>

      {/* 내 상태 + 키 안내 */}
      {me && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          <Meter label="💨 돌진" frac={cdFrac(me.dashCdAt, DASH_CD_MS)} />
          {isMeKing ? (
            <>
              <span className="font-bold text-amber-200 light:text-amber-700">{curse ? "💀 저주를 쓰고 있어요 — 다른 사람을 만져 떠넘겨요" : "👑 내가 왕! 도망쳐요"}</span>
              <span>{curse ? `⚡ 저주 가속 +${Math.round((weight - 1) * 100)}%` : `🪨 왕관 무게 −${Math.round((1 - weight) * 100)}%`}</span>
              <span>{me.skillUsed ? (curse ? "💀 손길 씀" : "📣 호령 씀") : curse ? "💀 손길 준비 (Shift)" : "📣 호령 준비 (Shift)"}</span>
            </>
          ) : (
            <span>{curse ? "💀 저주받은 왕을 피해 도망쳐요" : team && kingP && kingP.team === me.team ? "🛡 우리 팀이 왕! 몸으로 막아 줘요" : "👑 왕을 쫓아 만지세요"}</span>
          )}
          {underdog && <span>🐢 꼴찌 보정 +5% 속도</span>}
          {!touch && <span className="text-white/40 light:text-slate-400">WASD/방향키 이동 · Space/K 돌진 · Shift/J/E {curse ? "저주의 손길" : "호령"}(왕만)</span>}
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
        @keyframes ct-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes ct-flash { 0% { opacity: 1 } 100% { opacity: 0 } }
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
  const curse = snap.options.mode === "curse";
  const team = snap.options.mode === "team";
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || (curse ? a.score - b.score : b.score - a.score) || a.seat - b.seat);
  const best = (f: (p: PlayerState) => number) => {
    const max = Math.max(...snap.players.map(f));
    return { seats: max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [], max };
  };
  const reign = best((p) => p.stats.bestReignMs);
  const thief = best((p) => p.stats.steals);
  const roar = best((p) => p.stats.roarHits);
  const ko = best((p) => p.stats.kos);
  const banana = best((p) => p.stats.bananaHits);
  const golden = best((p) => p.stats.goldenMs);
  const awards: { icon: string; title: string; seats: number[]; value: string }[] = [
    { icon: "⏳", title: curse ? "가장 오래 저주" : "최장 집권", seats: reign.seats, value: `${(reign.max / 1000).toFixed(1)}초` },
    { icon: "🦹", title: curse ? "떠넘기기 왕" : "도둑왕", seats: thief.seats, value: `${thief.max}번` },
    { icon: "📣", title: "호령 장인", seats: roar.seats, value: `${roar.max}명 밀침` },
    { icon: "💥", title: "낙하 유발자", seats: ko.seats, value: `${ko.max}명` },
    { icon: "🍌", title: "바나나 장인", seats: banana.seats, value: `${banana.max}명` },
    { icon: "✨", title: curse ? "황금 저주 피해자" : "황금 시간의 왕", seats: golden.seats, value: `${(golden.max / 1000).toFixed(1)}초` },
  ].filter((a) => a.seats.length > 0);
  const myRank = ranks[mySeat];
  const title = team ? (snap.winnerTeam < 0 ? "🤝 무승부" : snap.winnerTeam === snap.players[mySeat]?.team ? "🏆 우리 팀 승리!" : "😢 우리 팀 패배") : myRank === 1 ? "🏆 우승!" : `${myRank}등`;
  return (
    <div className="absolute inset-x-3 top-[5%] z-30 mx-auto max-h-[88%] max-w-md overflow-y-auto rounded-2xl border border-amber-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
      <p className="text-center text-xs text-white/60">
        최종 결과 · {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name} · {snap.options.seconds}초
      </p>
      <p className="mt-1 text-center text-2xl font-black">{title}</p>
      {team && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-center text-sm">
          {[0, 1].map((k) => (
            <div key={k} className={`rounded-lg border px-2 py-1 ${snap.winnerTeam === k ? "border-amber-300/60 bg-amber-400/15" : "border-white/10"}`}>
              <div className="font-bold" style={{ color: TEAM_INFO[k].color }}>
                {TEAM_INFO[k].symbol} {TEAM_INFO[k].name} {snap.winnerTeam === k && "🏆"}
              </div>
              <div className="tabular-nums">{fmtScore(snap.teamScores[k])}점</div>
            </div>
          ))}
        </div>
      )}
      <ol className="mt-3 flex flex-col gap-1.5 text-sm">
        {order.map((p) => (
          <li key={p.seat} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
            <span className="flex items-center gap-2">
              <b className="w-6 text-center">{ranks[p.seat] === 1 ? "🥇" : ranks[p.seat] === 2 ? "🥈" : ranks[p.seat] === 3 ? "🥉" : ranks[p.seat]}</b>
              <SeatTag seat={p.seat} names={names} me={mySeat} team={team} />
              {p.stats.crownAtEnd === 1 && <span aria-label="끝날 때 왕관">{curse ? "💀" : "👑"}</span>}
            </span>
            <span className="text-xs text-white/70 tabular-nums">
              🦹{p.stats.steals} · ☁️{p.stats.falls} · <b className={`text-sm ${curse ? "text-violet-200" : "text-amber-200"}`}>{fmtScore(p.score)}</b>
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
                  <SeatTag key={s} seat={s} names={names} me={mySeat} team={team} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-white/50">{curse ? "동점이면 끝날 때 저주를 안 쓴 사람 → 덜 떠안은 사람" : team ? "동점이면 끝날 때 왕관을 쓴 팀이 승리" : "동점이면 끝날 때 왕관을 쓴 사람 → 마지막으로 쓴 시각이 늦은 사람"}</p>
    </div>
  );
}
