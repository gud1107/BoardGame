"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import AugmentPicker, { AugChips } from "./AugmentPicker";
import { AUG_BY_ID, AUG_TIER_NAME } from "./augments";
import Hall2D from "./Hall2D";
import { getFindersKeepersSound } from "./findersKeepersSound";
import {
  BASIC_KINDS,
  BOMB_REVEAL_MS,
  EVENT_INFO,
  GOAL_BONUS,
  GOAL_INFO,
  MODE_INFO,
  REVENGE_MS,
  SEAT_COLORS,
  SEAT_COLOR_NAMES,
  SEAT_SYMBOLS,
  SET_RAINBOW_BONUS,
  SET_TRIPLE_BONUS,
  TEAM_INFO,
  TOUCH_BODY,
  TOY_INFO,
  type ToyKind,
} from "./data";
import type { SnapBuffer, Snap } from "./net";
import { basketValue, bombOf, chainValue, cutCdOf, dashCdOf, isUnderdog, maxChainOf, weightMult, type GameEvent, type PlayerInput, type PlayerState } from "./sim";
import RulebookModal from "./RulebookModal";
import type { FxItem } from "./three/Fx";
import type { SceneShared } from "./three/HallScene";

const HallScene = dynamic(() => import("./three/HallScene"), { ssr: false, loading: () => null });

/**
 * 만지면 내 꺼! 게임 화면 (룰북 §11): 3D/2D 무대 + 이름표 + HUD + 조작(키보드·터치) + 최종 결과.
 * 방장이든 손님이든 같은 스냅샷 버퍼를 그린다. 가로채기 연출은 방장이 확정한 `snatch` 이벤트로만.
 */

export interface FindersKeepersBoardProps {
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
const VIEW_KEY = "finders-keepers:view";

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
  const augReq = useRef<[number, number, number] | null>(null);
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
    const out: PlayerInput = { mx: Math.round(mx * 100) / 100, mz: Math.round(mz * 100) / 100, dash: counters.current.dash, skill: counters.current.skill };
    if (augReq.current) out.aug = augReq.current;
    return out;
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
    /** 🧬 고르기/다시 뽑기 (choice −1) — 같은 입력 묶음에 실려 몇 번 더 보내져도 방장은 한 번만 처리 */
    sendAug: (round: number, choice: number) => {
      augReq.current = [(augReq.current?.[0] ?? 0) + 1, round, choice];
      flush(true);
    },
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
  tone: "go" | "gold" | "bad" | "info" | "sale";
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

const toyEmoji = (k: ToyKind) => TOY_INFO[k].emoji;

export default function FindersKeepersBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: FindersKeepersBoardProps) {
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

  const me = snap.players[mySeat];
  const fighting = snap.phase === "fight";
  const team = snap.options.mode === "team";
  const sound = getFindersKeepersSound;
  const augPhase = snap.phase === "augment" && snap.aug ? snap.aug : null;
  const left = fighting || augPhase?.resume === "fight" ? Math.max(0, snap.fightEnd - snap.t) : snap.phase === "countdown" || augPhase ? snap.fightEnd - snap.fightStart : 0;
  const leftSec = Math.ceil(left / 1000);
  const bgmLevel = !fighting ? 0 : left <= 10_000 ? 2 : snap.sale ? 1 : 0;
  useSuiteBgm(sound, !ended && snap.phase !== "gameOver", bgmLevel);
  const byId = useMemo(() => new Map(snap.toys.map((t) => [t.id, t])), [snap.toys]);

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

  const mateTouching = !!me && team && snap.players.some((o) => o !== me && o.team === me.team && Math.hypot(o.x - me.x, o.z - me.z) <= TOUCH_BODY + 0.1);

  const onLocalPress = useCallback(
    (what: "dash" | "skill") => {
      const p = snap.players[mySeat];
      if (!p || snap.phase !== "fight") return;
      if (what === "dash") {
        if (p.move === "none" && snap.t >= p.dashCdAt - 150) sound().play("dash");
        else sound().play("denied");
      } else if (p.chain.length === 0 || (snap.t < p.cutCdAt - 150 && !mateTouching)) sound().play("denied");
    },
    [snap, mySeat, sound, mateTouching],
  );

  const controls = useControls(onInput, !ended, onLocalPress);

  // 새 이벤트 → 연출·소리·알림
  const lastFresh = useRef(0);
  const depositCount = useRef(0);
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
          showBanner("🖐️ 찜 시작!", "go", "만지면 내 꺼 — 내 바구니에 넣어야 점수", 1300);
          break;
        case "pick":
          add.push({ ev, at: now });
          if (ev.s === mySeat) s.play("pick", TOY_INFO[ev.kind].value);
          else if (near(ev.x, ev.z, 4)) s.play("pick", 1);
          if (ev.kind === "trophy") {
            pushFeed(
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> 🏆 트로피를 찜!
              </>,
            );
          }
          break;
        case "snatch": {
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play("snatch");
            setFlash({ id: ev.id, tone: "gold" });
            shared.current.shake = Math.max(shared.current.shake, 0.25);
            showBanner(`✂️ 가로챘다! +${ev.n}개`, "gold", `${nm(ev.from)}의 줄에서 값 ${ev.v} — 잠깐 🛡 보호`, 1300);
          } else if (ev.from === mySeat) {
            s.play("lost");
            setFlash({ id: ev.id, tone: "bad" });
            shared.current.shake = Math.max(shared.current.shake, 0.35);
            showBanner(`😱 가로채기 당함! −${ev.n}개`, "bad", `${nm(ev.s)}에게 값 ${ev.v} · ${REVENGE_MS / 1000}초 동안 그 줄은 못 건드려요`, 1600);
          } else s.play("snatchOther");
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> <span className="text-amber-300">✂️←</span> <SeatTag seat={ev.from} names={names} me={mySeat} team={team} /> <span className="text-white/60">{ev.n}개·{ev.v}점</span>
            </>,
          );
          break;
        }
        case "deposit":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            depositCount.current += 1;
            s.play("deposit", depositCount.current);
            if (ev.sale) s.play("register");
          }
          break;
        case "runEnd":
          if (ev.s === mySeat) {
            if (ev.n >= 6) s.play("runEnd", ev.n);
            depositCount.current = 0;
          }
          if (ev.n >= 6)
            pushFeed(
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> 🚂 한 번에 {ev.n}개 · {ev.sum}점!
              </>,
            );
          break;
        case "set":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play(ev.set === "rainbow" ? "rainbow" : "set");
            showBanner(ev.set === "rainbow" ? `🌈 무지개 세트 +${ev.b}` : `${ev.kind ? toyEmoji(ev.kind) : ""}×3 세트 +${ev.b}`, "gold", undefined, 1200);
          }
          pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> {ev.set === "rainbow" ? "🌈 무지개 세트" : `${ev.kind ? toyEmoji(ev.kind) : ""}×3 세트`} +{ev.b}
            </>,
          );
          break;
        case "cut":
          add.push({ ev, at: now });
          if (ev.s === mySeat || near(ev.x, ev.z, 5)) s.play("cut");
          if (ev.s === mySeat) showBanner(`✂️ 줄 끊기! ${ev.n}개 버림`, "info", "2초 동안 빠르게 — 도망쳐요", 1100);
          break;
        case "pass":
          add.push({ ev, at: now });
          if (ev.s === mySeat || ev.to === mySeat) s.play("pass");
          if (ev.to === mySeat) showBanner(`🤝 팀원이 줄을 넘겨줬어요 (+${ev.n}개)`, "info", "바구니로 달려요!", 1300);
          break;
        case "loot":
          add.push({ ev, at: now });
          {
            const victim = snap.baskets[ev.basket];
            const mineB = !!mine && (victim?.team >= 0 ? victim.team === mine.team && team : victim?.owner === mySeat);
            if (ev.s === mySeat) {
              s.play("loot");
              showBanner(`🔥 털었다! ${toyEmoji(ev.kind)}`, "sale", undefined, 1000);
            } else if (mineB) {
              s.play("looted");
              setFlash({ id: ev.id, tone: "bad" });
              showBanner(`🔥 내 바구니가 털렸어요! ${toyEmoji(ev.kind)}`, "bad", "바구니 안에 서 있으면 못 털어요", 1500);
            }
            pushFeed(
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> 🔥 바구니 털기 {toyEmoji(ev.kind)}
              </>,
            );
          }
          break;
        case "blocked":
          if (ev.s === mySeat) {
            s.play("blocked");
            showBanner(ev.why === "full" ? `🚫 줄이 꽉 찼어요 (${mine ? maxChainOf(mine) : 12}개)` : ev.why === "gift" ? `🎁 선물 상자는 줄에 ${mine?.augs?.includes("giftWrap") ? 2 : 1}개만` : "🏆 트로피는 줄에 1개만", "info", ev.why === "full" ? "바구니에 넣고 오세요" : undefined, 1000);
          }
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
        case "bump":
          add.push({ ev, at: now });
          if (ev.p > 3.5 && (ev.a === mySeat || ev.b === mySeat || near(ev.x, ev.z, 5))) s.play("bump", ev.p);
          break;
        case "dropWarn":
          if (near(ev.x, ev.z, 6)) s.play("dropWarn");
          break;
        case "land":
          add.push({ ev, at: now });
          if (ev.kind === "trophy") {
            s.play("trophy");
            showBanner("🏆 황금 트로피 등장!", "sale", `가운데 — 값 ${TOY_INFO.trophy.value} · 아주 무거워요`, 1500);
          } else if (near(ev.x, ev.z, 6)) s.play("land");
          break;
        case "sale":
          s.play("sale");
          showBanner("🔥 마감 세일!", "sale", "남의 바구니 맨 위 1개를 털 수 있어요 — 바구니 안에 서면 지켜요", 2200);
          break;
        case "shop":
          s.play("shop");
          showBanner(
            `📢 ${EVENT_INFO[ev.e].emoji} ${EVENT_INFO[ev.e].name}!`,
            "info",
            ev.e === "timeSale" && ev.kind ? `${toyEmoji(ev.kind)} ${TOY_INFO[ev.kind].name}을 ${EVENT_INFO.timeSale.ms / 1000}초 안에 넣으면 값 2배` : EVENT_INFO[ev.e].desc,
            2000,
          );
          break;
        case "shopEnd":
          break;
        case "bombOn":
          add.push({ ev, at: now });
          if (ev.s === mySeat) {
            s.play("bombOn");
            setFlash({ id: ev.id, tone: "bad" });
            showBanner("💣 폭탄이 내게!", "bad", "다른 사람 몸을 만져 떠넘겨요 — 터지면 줄과 바구니 물건이 흩어져요", 1700);
          } else if (ev.from === mySeat) {
            s.play("bombPass");
            showBanner("😮‍💨 폭탄을 떠넘겼어요", "gold", `${nm(ev.s)}에게`, 1100);
          }
          pushFeed(
            ev.from >= 0 ? (
              <>
                <SeatTag seat={ev.from} names={names} me={mySeat} team={team} /> 💣→ <SeatTag seat={ev.s} names={names} me={mySeat} team={team} />
              </>
            ) : (
              <>
                💣 폭탄이 <SeatTag seat={ev.s} names={names} me={mySeat} team={team} />에게 떨어짐 (1등 견제)
              </>
            ),
          );
          break;
        case "boom":
          add.push({ ev, at: now });
          s.play("boom");
          if (ev.s === mySeat || near(ev.x, ev.z, 5)) shared.current.shake = Math.max(shared.current.shake, ev.s === mySeat ? 0.9 : 0.5);
          if (ev.s === mySeat) showBanner("💥 펑!", "bad", `줄 ${ev.n}개와 바구니 위 ${ev.lost}개가 흩어졌어요`, 1800);
          pushFeed(
            <>
              💥 <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> 폭탄 펑! (줄 {ev.n} · 바구니 {ev.lost})
            </>,
          );
          break;
        case "goal":
          if (ev.seats.length) {
            s.play("goal");
            pushFeed(
              <>
                🎖 {GOAL_INFO[ev.goal].emoji} {GOAL_INFO[ev.goal].name} +{GOAL_BONUS}:{" "}
                {ev.seats.map((x) => (
                  <SeatTag key={x} seat={x} names={names} me={mySeat} team={team} />
                ))}
              </>,
            );
          }
          break;
        case "augOpen":
          s.play("augOpen", ev.tier);
          break;
        case "augPick":
          if (ev.s === mySeat) {
            s.play("augPick");
            showBanner(`🧬 ${AUG_BY_ID[ev.aug].icon} ${AUG_BY_ID[ev.aug].name}`, "gold", ev.auto ? "시간이 다 돼서 첫 카드로 골랐어요" : AUG_BY_ID[ev.aug].desc, 1600);
          } else
            pushFeed(
              <>
                🧬 <SeatTag seat={ev.s} names={names} me={mySeat} team={team} /> {AUG_BY_ID[ev.aug].icon} {AUG_BY_ID[ev.aug].name}
              </>,
            );
          break;
        case "augDone":
          if (snap.phase === "fight") {
            s.play("go");
            showBanner("▶ 다시 시작!", "go", undefined, 1000);
          }
          break;
        case "piggy":
          if (ev.s === mySeat) {
            s.play("piggy");
            showBanner(`🐷 저금통 +${ev.b}`, "gold", undefined, 900);
          }
          break;
        case "ram":
          add.push({ ev, at: now });
          if (ev.s === mySeat || ev.to === mySeat || near(ev.x, ev.z, 6)) s.play("ram");
          if (ev.s === mySeat) showBanner(`🐂 들이받기! ${ev.n}개 떨어뜨림`, "gold", undefined, 1000);
          else if (ev.to === mySeat) showBanner(`🐂 들이받혀 ${ev.n}개 떨어뜨렸어요`, "bad", undefined, 1200);
          break;
        case "over":
          s.play(snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        default:
          break;
      }
    }
    if (add.length) setFx((f) => [...f.filter((x) => now - x.at < 1700), ...add].slice(-60));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound, team]);

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
    if (fighting && leftSec <= 10 && leftSec > 0 && leftSec !== lastClock.current) sound().play("clock", leftSec);
    lastClock.current = leftSec;
  }, [leftSec, fighting, sound]);

  const dashReady = !!me && fighting && snap.t >= me.dashCdAt;
  const lastReady = useRef(true);
  useEffect(() => {
    if (dashReady && !lastReady.current) sound().play("ready");
    lastReady.current = dashReady;
  }, [dashReady, sound]);

  // 💣 내 폭탄 째깍 (보이는 마지막 5초)
  const myBomb = me ? bombOf(snap, mySeat) : null;
  const bombLeft = myBomb && myBomb.fuseAt > 0 ? Math.max(0, myBomb.fuseAt - snap.t) : -1;
  const bombSec = bombLeft >= 0 ? Math.ceil(bombLeft / 1000) : 0;
  const lastFuse = useRef(0);
  useEffect(() => {
    if (bombSec > 0 && bombSec !== lastFuse.current) sound().play("fuse");
    lastFuse.current = bombSec;
  }, [bombSec, sound]);

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
  const myChainVal = me ? chainValue(snap, me, byId) : 0;
  const myWeight = me ? Math.round((1 - weightMult(snap, me, byId)) * 100) : 0;
  const underdog = !!me && isUnderdog(snap, me);
  const revengeLeft = me && me.revengeOn >= 0 ? Math.max(0, me.revengeUntil - snap.t) : 0;
  const snatchCdLeft = me ? Math.max(0, me.snatchCdAt - snap.t) : 0;
  const ev = snap.event && snap.t < snap.event.until ? snap.event : null;
  const myKinds = useMemo(() => {
    const c: Record<string, number> = {};
    if (me) for (const id of me.chain) {
      const t = byId.get(id);
      if (t) c[t.kind] = (c[t.kind] ?? 0) + 1;
    }
    return c;
  }, [me, byId]);
  const setHint = useMemo(() => {
    const hints: string[] = [];
    for (const k of BASIC_KINDS) if ((myKinds[k] ?? 0) === 2) hints.push(`${toyEmoji(k)} 하나 더면 +${SET_TRIPLE_BONUS}`);
    const has = BASIC_KINDS.filter((k) => (myKinds[k] ?? 0) > 0);
    if (has.length === 3) hints.push(`${BASIC_KINDS.filter((k) => !has.includes(k)).map(toyEmoji).join("")} 있으면 🌈 +${SET_RAINBOW_BONUS}`);
    if (has.length === 4) hints.push(`🌈 무지개 준비! 한 번에 넣으면 +${SET_RAINBOW_BONUS}`);
    return hints;
  }, [myKinds]);

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="tabular-nums">
          {augPhase ? (
            <b className="text-fuchsia-200 light:text-fuchsia-700">
              🧬 증강 고르는 중 ({AUG_TIER_NAME[augPhase.tier]}){augPhase.resume === "fight" && <> · 남은 {leftSec}초</>}
            </b>
          ) : snap.phase === "countdown" ? "준비" : snap.phase === "gameOver" ? "끝" : snap.sale ? <b className="text-orange-300 light:text-orange-600">🔥 마감 세일 · 남은 {leftSec}초</b> : <>⏱ 남은 {leftSec}초</>}
        </span>
        {fighting && ev && (
          <span className="rounded-full bg-sky-500/20 px-2 py-0.5 font-semibold text-sky-100 light:text-sky-700">
            📢 {EVENT_INFO[ev.k].emoji} {EVENT_INFO[ev.k].name}
            {ev.k === "timeSale" && ev.kind && <> {toyEmoji(ev.kind)}×2</>} · {Math.ceil((ev.until - snap.t) / 1000)}초
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

      {/* 🎖 보너스 목표 */}
      {snap.goals.length > 0 && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/70 light:text-slate-600">
          <span className="font-bold">🎖 이번 판 목표 (+{GOAL_BONUS})</span>
          {snap.goals.map((g) => (
            <span key={g} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 light:border-slate-200 light:bg-white" title={GOAL_INFO[g].desc}>
              {GOAL_INFO[g].emoji} {GOAL_INFO[g].name} <span className="text-white/45 light:text-slate-400">— {GOAL_INFO[g].desc}</span>
            </span>
          ))}
        </div>
      )}

      {team && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {[0, 1].map((k) => (
            <div key={k} className={`flex items-center justify-between rounded-xl border px-3 py-1.5 ${me?.team === k ? "border-white/40 bg-white/10" : "border-white/10 bg-white/[0.03]"} light:border-slate-200 light:bg-white`}>
              <span className="font-bold" style={{ color: TEAM_INFO[k].color }}>
                {TEAM_INFO[k].symbol} {TEAM_INFO[k].name}
                {snap.teamMult[k] > 1 && <span className="ml-1 text-[10px] text-white/50">×{Math.round(snap.teamMult[k] * 100) / 100}</span>}
                {me?.team === k && <span className="ml-1 text-[10px] text-white/60 light:text-slate-500">(우리 팀)</span>}
              </span>
              <b className="tabular-nums text-white light:text-slate-900">{Math.round(snap.teamScores[k])}점</b>
            </div>
          ))}
        </div>
      )}

      {/* 점수판 */}
      <div className="flex flex-wrap gap-1.5">
        {scoreOrder.map((p) => {
          const cv = chainValue(snap, p, byId);
          const bomb = bombOf(snap, p.seat);
          return (
            <div
              key={p.seat}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
              title={`${SEAT_COLOR_NAMES[p.seat % 8]} ${SEAT_SYMBOLS[p.seat % 8]}`}
            >
              <SeatTag seat={p.seat} names={names} me={mySeat} team={team} />
              {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
              <b className="tabular-nums text-amber-200 light:text-amber-700">{p.score}</b>
              {p.chain.length > 0 && (
                <span className="tabular-nums text-white/55 light:text-slate-500" aria-label={`줄 ${p.chain.length}개 값 ${cv}`}>
                  🚂{p.chain.length}·{cv}
                </span>
              )}
              {bomb && <span aria-label="폭탄">💣</span>}
              <AugChips p={p} small iconOnly />
            </div>
          );
        })}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#2a1f3d] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[64svh] min-h-[340px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? <HallScene shared={shared} names={names} seatCount={snap.seatCount} stands={snap.stands} quality={quality} fx={fx} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} /> : <Hall2D shared={shared} />}

        {flash && <div key={flash.id} className={`pointer-events-none absolute inset-0 z-10 animate-[fk-flash_0.65s_ease-out] ${flash.tone === "gold" ? "shadow-[inset_0_0_80px_24px_rgba(251,191,36,0.75)]" : "shadow-[inset_0_0_80px_24px_rgba(244,63,94,0.7)]"}`} />}

        {/* 이름표 (위치는 무대가 매 프레임 옮김) */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {snap.players.map((p) => {
            const cv = chainValue(snap, p, byId);
            const bomb = bombOf(snap, p.seat);
            const ud = fighting && isUnderdog(snap, p);
            return (
              <div
                key={p.seat}
                ref={(el) => {
                  shared.current.labels[p.seat] = el;
                }}
                className="absolute top-0 left-0 flex flex-col items-center gap-0.5 whitespace-nowrap"
                style={{ display: "none" }}
              >
                <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white shadow ${bomb ? "bg-rose-700/85" : "bg-black/55"}`}>
                  <span style={{ color: SEAT_COLORS[p.seat % 8] }} aria-hidden>
                    {SEAT_SYMBOLS[p.seat % 8]}
                  </span>
                  {team && <span aria-label={TEAM_INFO[p.team].name}>{TEAM_INFO[p.team].symbol}</span>}
                  <span className="max-w-[5.5rem] truncate">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
                  {p.chain.length > 0 && <span className="tabular-nums text-amber-200">🚂{cv}</span>}
                  {bomb && <span aria-label="폭탄">💣</span>}
                  {ud && <span aria-label="꼴찌 보호">🐣</span>}
                  {fighting && snap.t < p.boostUntil && <span aria-label="빠르게">💨</span>}
                  {fighting && me && me.revengeOn === p.seat && snap.t < me.revengeUntil && <span aria-label="되찜 금지">✋</span>}
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

        <div className="pointer-events-none absolute inset-x-0 top-[16%] z-20 flex flex-col items-center gap-2 px-3">
          {snap.phase === "countdown" && (
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold text-white drop-shadow">
                {MODE_INFO[snap.options.mode].emoji} {MODE_INFO[snap.options.mode].name}
              </span>
              <span key={countLeft} className="animate-[fk-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft}
              </span>
              <span className="mt-1 max-w-sm rounded-full bg-black/45 px-3 py-1 text-center text-xs text-white">
                {touch ? "왼쪽을 끌어 이동 · 💨 돌진 · ✂️ 줄 끊기" : "WASD/방향키 이동 · Space 돌진 · Shift 줄 끊기"} — 만지면 내 꺼, 🧺 내 바구니에 넣어야 점수!
              </span>
              {me && (
                <span className="mt-1 rounded-full px-3 py-1 text-xs font-bold text-slate-950" style={{ background: team ? TEAM_INFO[me.team].color : SEAT_COLORS[mySeat % 8] }}>
                  {team ? `나는 ${TEAM_INFO[me.team].symbol} ${TEAM_INFO[me.team].name} — 팀 바구니` : `내 바구니: ${SEAT_SYMBOLS[mySeat % 8]} ${SEAT_COLOR_NAMES[mySeat % 8]}`}
                </span>
              )}
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[fk-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-amber-300 text-slate-900" : b.tone === "gold" ? "bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950" : b.tone === "bad" ? "bg-rose-600 text-white" : b.tone === "sale" ? "bg-gradient-to-b from-orange-400 to-rose-500 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-3xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 내 상태 경고 */}
        {fighting && me && (myBomb || revengeLeft > 0 || me.inBasket) && (
          <div className={`pointer-events-none absolute inset-x-0 bottom-[30%] z-20 mx-auto w-fit rounded-full px-3 py-1 text-xs font-bold ${myBomb ? "animate-pulse bg-rose-600/90 text-white" : me.inBasket ? "bg-emerald-700/85 text-white" : "bg-slate-900/85 text-white"}`}>
            {myBomb
              ? bombLeft >= 0 && bombLeft <= BOMB_REVEAL_MS
                ? `💣 ${bombSec}초 뒤 펑! 누군가를 만져요`
                : snap.t < myBomb.shieldUntil
                  ? "💣 폭탄을 받았어요 — 잠깐 뒤부터 떠넘길 수 있어요"
                  : "💣 째깍째깍… 다른 사람 몸을 만져 떠넘겨요"
              : me.inBasket
                ? me.chain.length > 0
                  ? "🧺 넣는 중 — 바구니 안에선 내 줄이 안전해요"
                  : snap.sale
                    ? "🧺 바구니를 지키는 중 (안에 서 있으면 못 털어요)"
                    : "🧺 내 바구니"
                : `✋ ${Math.ceil(revengeLeft / 1000)}초 동안 ${names[me.revengeOn] ?? `${me.revengeOn + 1}번`}의 줄은 못 건드려요`}
          </div>
        )}

        {augPhase && !ended && <AugmentPicker snap={snap} mySeat={mySeat} names={names} onPick={controls.sendAug} onReroll={(r) => {
          sound().play("augReroll");
          controls.sendAug(r, -1);
        }} />}

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
              <CdButton
                label={mateTouching ? "🤝" : "✂️"}
                sub={mateTouching ? "넘기기" : "줄 끊기"}
                ariaLabel={mateTouching ? "팀원에게 줄 넘겨주기" : "내 줄 뒤쪽 절반 끊고 빠르게"}
                frac={mateTouching ? 1 : cdFrac(me.cutCdAt, cutCdOf(me))}
                disabled={me.chain.length === 0}
                onDown={() => controls.press("skill")}
              />
              <CdButton label="💨" sub="돌진" big ariaLabel="돌진" frac={cdFrac(me.dashCdAt, dashCdOf(me))} onDown={() => controls.press("dash")} />
            </div>
          </>
        )}
      </div>

      {/* 내 상태 + 키 안내 */}
      {me && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          <span className="font-bold text-white light:text-slate-900">
            🚂 내 줄 {me.chain.length}/{maxChainOf(me)} · 값 {myChainVal}
            {myWeight > 0 && <span className="ml-1 font-normal text-white/60 light:text-slate-500">(🐢 −{myWeight}%)</span>}
          </span>
          {me.chain.length > 0 && (
            <span aria-label="내 줄 구성">
              {BASIC_KINDS.concat("trophy")
                .filter((k) => myKinds[k])
                .map((k) => `${toyEmoji(k)}×${myKinds[k]}`)
                .join(" ")}
            </span>
          )}
          {setHint.map((h) => (
            <span key={h} className="text-amber-200 light:text-amber-700">
              {h}
            </span>
          ))}
          <Meter label="💨 돌진" frac={cdFrac(me.dashCdAt, dashCdOf(me))} />
          <Meter label={team && mateTouching ? "🤝 넘기기" : "✂️ 끊기"} frac={team && mateTouching ? 1 : cdFrac(me.cutCdAt, cutCdOf(me))} />
          <AugChips p={me} />
          {snatchCdLeft > 0 && <span>🤲 다시 가로채기 {Math.ceil(snatchCdLeft / 1000)}초</span>}
          {underdog && <span>🐣 꼴찌 보호: 앞 3개 안전 · 바구니 안 털림 · +5% 속도</span>}
          {snap.sale && me && <span className="text-orange-300 light:text-orange-600">🔥 바구니 {basketValue(snap.baskets[me.basket])}점 — 안에 서면 지켜요</span>}
          {!touch && <span className="text-white/40 light:text-slate-400">WASD/방향키 이동 · Space/K 돌진 · Shift/J/E {team ? "줄 끊기 (팀원에게 닿으면 넘겨주기)" : "줄 끊기"}</span>}
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
        @keyframes fk-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes fk-flash { 0% { opacity: 1 } 100% { opacity: 0 } }
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
  const team = snap.options.mode === "team";
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || b.score - a.score || a.seat - b.seat);
  const best = (f: (p: PlayerState) => number) => {
    const max = Math.max(...snap.players.map(f));
    return { seats: max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [], max };
  };
  const train = best((p) => p.stats.bestRunToys);
  const thief = best((p) => p.stats.snatchedValue);
  const big = best((p) => p.stats.bestRun);
  const waste = best((p) => p.stats.wastedValue);
  const sets = best((p) => p.stats.setBonus);
  const looter = best((p) => p.stats.loots);
  const awards: { icon: string; title: string; seats: number[]; value: string }[] = [
    { icon: "🚂", title: "최장 기차", seats: train.seats, value: `한 번에 ${train.max}개` },
    { icon: "✂️", title: "소매치기왕", seats: thief.seats, value: `${thief.max}점어치` },
    { icon: "💰", title: "한탕왕", seats: big.seats, value: `한 번에 ${big.max}점` },
    { icon: "🌈", title: "세트 장인", seats: sets.seats, value: `+${sets.max}` },
    { icon: "🔥", title: "마감 털이범", seats: looter.seats, value: `${looter.max}번` },
    { icon: "😭", title: "아까운 사람", seats: waste.seats, value: `줄에 ${waste.max}점 남김` },
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
              <div className="tabular-nums">{Math.round(snap.teamScores[k])}점</div>
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
            </span>
            <span className="text-right text-[11px] text-white/70 tabular-nums">
              {team ? `넣음 ${p.stats.depositValue}` : `🧺${basketValue(snap.baskets[p.basket])}`}
              {p.bonus !== 0 && ` + 보너스 ${p.bonus}`}
              {p.stats.wastedValue > 0 && <span className="text-white/40"> · 😭{p.stats.wastedValue}</span>} · <b className="text-sm text-amber-200">{p.score}점</b>
            </span>
          </li>
        ))}
      </ol>
      {snap.goals.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 text-[11px]">
          {snap.goals.map((g, i) => (
            <div key={g} className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1">
              <b>
                🎖 {GOAL_INFO[g].emoji} {GOAL_INFO[g].name} +{GOAL_BONUS}
              </b>
              {(snap.goalWinners[i] ?? []).length ? (snap.goalWinners[i] ?? []).map((s) => <SeatTag key={s} seat={s} names={names} me={mySeat} team={team} />) : <span className="text-white/40">달성한 사람 없음</span>}
            </div>
          ))}
        </div>
      )}
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
      <p className="mt-3 text-center text-[11px] text-white/50">{team ? "동점이면 트로피를 넣은 팀 → 바구니 물건이 적은 팀" : "동점이면 바구니 물건이 적은 사람(비싼 걸 넣은 사람) → 가로챈 값이 큰 사람"} · 줄에 남은 물건은 0점</p>
    </div>
  );
}
