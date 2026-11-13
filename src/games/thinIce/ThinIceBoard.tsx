"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { lakeGeo, sectorSpan, tileIndexAt } from "./lake";
import Lake2D from "./Lake2D";
import { getThinIceSound } from "./thinIceSound";
import { CRACK_1, CRACK_2, FIGHT_MAX_MS, ITEM_INFO, JUMP_CD_MS, SEAT_COLORS, SEAT_COLOR_NAMES, SEAT_SYMBOLS, STOMP_CD_MS, SUDDEN_MS } from "./data";
import type { SnapBuffer, Snap } from "./net";
import type { GameEvent, PlayerInput } from "./sim";
import RulebookModal from "./RulebookModal";
import type { FxItem } from "./three/Fx";
import type { SceneShared } from "./three/LakeScene";

const LakeScene = dynamic(() => import("./three/LakeScene"), { ssr: false, loading: () => null });

/**
 * 살얼음 파티 게임 화면 (룰북 §9~§11): 3D/2D 무대 + 이름표 + HUD + 조작(키보드·터치) +
 * 유령 투표판 + 라운드/최종 결과. 방장이든 손님이든 같은 스냅샷 버퍼를 그린다.
 */

export interface ThinIceBoardProps {
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
const VIEW_KEY = "thin-ice-party:view";

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
  stomp: ["ShiftLeft", "ShiftRight", "KeyJ", "KeyE"],
};
const VOTE_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Numpad1", "Numpad2", "Numpad3", "Numpad4", "Numpad5", "Numpad6"];

function useControls(onInput: (inp: PlayerInput) => void, enabled: boolean, onLocalPress: (what: "jump" | "stomp") => void) {
  const held = useRef(new Set<string>());
  const stick = useRef<{ x: number; z: number } | null>(null);
  const counters = useRef({ jump: 0, stomp: 0 });
  const vote = useRef(-1);
  const last = useRef<string>("");
  const lastSent = useRef(0);
  const cbRef = useRef(onInput);
  const pressRef = useRef(onLocalPress);
  const [myVote, setMyVote] = useState(-1);
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
    return { mx: Math.round(mx * 100) / 100, mz: Math.round(mz * 100) / 100, jump: counters.current.jump, stomp: counters.current.stomp, vote: vote.current };
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
    (what: "jump" | "stomp") => {
      counters.current[what] += 1;
      pressRef.current(what);
      flush(true);
    },
    [flush],
  );

  const setVote = useCallback(
    (v: number) => {
      vote.current = v;
      setMyVote(v);
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
      const vi = VOTE_KEYS.indexOf(e.code);
      if (vi >= 0) {
        setVote(vi % 6);
        return;
      }
      const all = Object.values(KEYS).flat();
      if (!all.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      held.current.add(e.code);
      if (KEYS.jump.includes(e.code)) press("jump");
      else if (KEYS.stomp.includes(e.code)) press("stomp");
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
  }, [enabled, flush, press, setVote]);

  return {
    press,
    myVote,
    setVote,
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

function CdButton({ label, sub, frac, onDown, big, ariaLabel }: { label: ReactNode; sub?: string; frac: number; onDown: () => void; big?: boolean; ariaLabel: string }) {
  const ready = frac >= 1;
  const size = big ? 78 : 64;
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

/* ── 유령 투표판 ──────────────────────────────────────────────────── */

function VotePicker({ snap, mySeat, myVote, onVote, names }: { snap: Snap; mySeat: number; myVote: number; onVote: (v: number) => void; names: Record<number, string> }) {
  const geo = lakeGeo(snap.rings);
  const alive = [0, 1, 2, 3, 4, 5].map((k) => geo.bySector[k].filter((i) => snap.broke[i] === 0 && snap.doom[i] === 0).length);
  const votes = [0, 1, 2, 3, 4, 5].map((k) => snap.players.filter((p) => !p.alive && p.ghost && p.seat !== mySeat && p.vote === k).map((p) => p.seat));
  const warned = snap.thaw?.sector ?? -1;
  const until = snap.thaw ? null : Math.max(0, Math.ceil((snap.nextThawAt - snap.t) / 1000));
  return (
    <div className="absolute inset-x-2 bottom-2 z-30 mx-auto flex w-fit max-w-full items-center gap-3 rounded-2xl border border-white/20 bg-slate-950/85 px-3 py-2 text-white shadow-2xl">
      <div className="flex w-40 min-w-0 flex-col gap-0.5 break-keep text-[11px] leading-snug">
        <b className="text-sm">👻 유령이 됐어요</b>
        <span className="text-white/70">다음에 녹일 구역을 골라요 (1~6 키)</span>
        <span className="text-sky-200 tabular-nums">{warned >= 0 ? `지금 ☀ ${warned + 1}구역 경보 중 — 그다음 차례를 골라요` : `다음 경보까지 ${until}초`}</span>
        <span className="text-white/60">{myVote >= 0 ? `내 선택: ${myVote + 1}구역` : "아직 안 골랐어요"}</span>
      </div>
      <svg viewBox="-1.12 -1.12 2.24 2.24" className="h-28 w-28 shrink-0" role="group" aria-label="해빙 구역 고르기">
        {[0, 1, 2, 3, 4, 5].map((k) => {
          const [a0, a1] = sectorSpan(k);
          const am = (a0 + a1) / 2;
          const off = alive[k] < 2;
          const sel = myVote === k;
          const d = `M0 0 L${Math.cos(a0).toFixed(3)} ${Math.sin(a0).toFixed(3)} L${Math.cos(a1).toFixed(3)} ${Math.sin(a1).toFixed(3)} Z`;
          return (
            <g key={k}>
              <path
                d={d}
                role="button"
                aria-label={`${k + 1}구역 (얼음 ${alive[k]}칸)${off ? " — 고를 수 없음" : ""}`}
                tabIndex={off ? -1 : 0}
                onClick={() => !off && onVote(k)}
                onKeyDown={(e) => {
                  if (!off && (e.key === "Enter" || e.key === " ")) onVote(k);
                }}
                className={off ? "cursor-not-allowed" : "cursor-pointer"}
                fill={off ? "#0b1624" : sel ? "#ff9a3c" : k === warned ? "#7c4a1e" : "#1d3a5c"}
                stroke="#0a1320"
                strokeWidth={0.035}
              />
              <text x={Math.cos(am) * 0.6} y={Math.sin(am) * 0.6} textAnchor="middle" dominantBaseline="central" fontSize={0.24} fontWeight={800} fill={sel ? "#1f1300" : "#eaf6ff"} pointerEvents="none">
                {k + 1}
              </text>
              {votes[k].map((seat, j) => (
                <text key={seat} x={Math.cos(am) * 0.88 + (j - (votes[k].length - 1) / 2) * 0.14} y={Math.sin(am) * 0.88} textAnchor="middle" dominantBaseline="central" fontSize={0.15} fill={SEAT_COLORS[seat % 6]} pointerEvents="none">
                  <title>{names[seat] ?? ""}</title>
                  {SEAT_SYMBOLS[seat % 6]}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── 보드 ───────────────────────────────────────────────────────────── */

interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "go" | "warn" | "ko" | "info" | "sun";
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

export default function ThinIceBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: ThinIceBoardProps) {
  const [view, setView] = useState<{ mode: ViewMode; quality: Quality }>({ mode: "3d", quality: "auto" });
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [myOut, setMyOut] = useState<{ by: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerSeq = useRef(0);
  const shared = useRef<SceneShared>({ buf, mySeat, shake: 0, labels: [], votes: [] });
  useEffect(() => {
    shared.current.buf = buf;
    shared.current.mySeat = mySeat;
  }, [buf, mySeat]);
  useEffect(() => {
    shared.current.votes = snap.players.map((p) => (!p.alive && p.ghost ? p.vote : -1));
  }, [snap]);

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
  const sound = getThinIceSound;
  useSuiteBgm(sound, !ended && snap.phase !== "gameOver", snap.sudden ? 1 : 0);

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

  // 내가 누른 점프·내려찍기는 바로 소리 (방장 확인을 기다리지 않음)
  const onLocalPress = useCallback(
    (what: "jump" | "stomp") => {
      const p = snap.players[mySeat];
      if (!p || snap.phase !== "fight" || !p.alive) return;
      if (what === "jump" && p.air === "none" && snap.t >= p.jumpCdAt - 150) sound().play("jump");
      if (what === "stomp" && snap.t >= p.stompCdAt - 150) sound().play("stomp");
    },
    [snap, mySeat, sound],
  );

  const controls = useControls(onInput, !ended, onLocalPress);
  const { setVote } = controls;

  // 새 이벤트 → 연출·소리·알림
  const lastFresh = useRef(0);
  useEffect(() => {
    if (fresh.seq === lastFresh.current) return;
    lastFresh.current = fresh.seq;
    const now = performance.now();
    const s = sound();
    const geo = lakeGeo(snap.rings);
    const add: FxItem[] = [];
    let breakPlayed = false;
    const mine = snap.players[mySeat];
    const near = (x: number, z: number, r: number) => !!mine && Math.hypot(mine.x - x, mine.z - z) < r;
    // 새 스냅샷의 이벤트를 화면 효과·알림으로 옮기는 곳 — 이벤트 묶음마다 한 번만 돈다
    /* eslint-disable react-hooks/set-state-in-effect */
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "slam":
          add.push({ ev, at: now });
          s.play("slam", ev.n);
          if (ev.s === mySeat || near(ev.x, ev.z, 3.5)) shared.current.shake = Math.max(shared.current.shake, ev.s === mySeat ? 0.45 : 0.3);
          if (ev.n > 0) pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} /> <span className="text-amber-300">💥 내려찍기</span> {ev.n}명 밀침
            </>,
          );
          break;
        case "land":
          if (ev.s === mySeat) s.play("land");
          break;
        case "stomp":
          if (ev.s !== mySeat && mine && near(snap.players[ev.s]?.x ?? 99, snap.players[ev.s]?.z ?? 99, 5)) s.play("stomp");
          break;
        case "bump":
          add.push({ ev, at: now });
          if (ev.p > 3.5) s.play("bump", ev.p);
          break;
        case "break": {
          const t = geo.tiles[ev.i];
          if (t) add.push({ ev, at: now, x: t.x, z: t.z });
          if (!breakPlayed) {
            s.play("break");
            breakPlayed = true;
          }
          break;
        }
        case "fall":
          if (ev.by >= 0) s.play("ko");
          if (ev.s === mySeat) {
            s.play("myOut");
            setMyOut({ by: ev.by });
            shared.current.shake = 1;
          }
          pushFeed(
            ev.by >= 0 ? (
              <>
                <SeatTag seat={ev.by} names={names} me={mySeat} /> <span className="text-amber-300">💥 KO</span> <SeatTag seat={ev.s} names={names} me={mySeat} />
              </>
            ) : (
              <>
                <SeatTag seat={ev.s} names={names} me={mySeat} /> <span className="text-sky-300">🌊 풍덩!</span>
              </>
            ),
          );
          if (ev.by === mySeat) showBanner("💥 KO!", "ko", `${names[ev.s] ?? ""} 빠뜨림 +1점`, 1200);
          break;
        case "splash":
          add.push({ ev, at: now });
          s.play("splash");
          break;
        case "spawn":
          s.play("spawn");
          break;
        case "pick":
          add.push({ ev, at: now });
          s.play(ev.kind);
          if (ev.s === mySeat) showBanner(`${ITEM_INFO[ev.kind].emoji} ${ITEM_INFO[ev.kind].name}!`, "info", ITEM_INFO[ev.kind].desc, 1700);
          else pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} /> {ITEM_INFO[ev.kind].emoji} {ITEM_INFO[ev.kind].name}
            </>,
          );
          break;
        case "warn":
          s.play("warn");
          showBanner(`☀️ ${ev.sector + 1}구역 해빙 경보!`, "sun", ev.by.length ? `👻 ${ev.by.map((b) => (b === mySeat ? "나" : (names[b] ?? `${b + 1}번`))).join(", ")}의 선택 · 3초 뒤 녹아요` : "해님이 골랐어요 · 3초 뒤 녹아요", 1800);
          // 표는 한 번 쓰면 비운다 — 다음 경보를 위해 다시 고른다
          if (mine && !mine.alive) setVote(-1);
          break;
        case "thaw":
          add.push({ ev, at: now, rings: snap.rings });
          s.play("thaw");
          break;
        case "vote":
          if (ev.s !== mySeat) {
            s.play("vote");
            pushFeed(
              <>
                👻 <SeatTag seat={ev.s} names={names} me={mySeat} /> → {ev.sector + 1}구역
              </>,
            );
          }
          break;
        case "go":
          s.play("go");
          showBanner("얼음 위로!", "go", undefined, 900);
          break;
        case "sudden":
          s.play("sudden");
          showBanner("⚠️ 서든데스", "warn", "바깥 고리부터 차례로 무너져요!", 1800);
          break;
        case "ring":
          s.play("ring");
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
          setVote(-1);
          break;
        default:
          break;
      }
    }
    if (add.length) setFx((f) => [...f.filter((x) => now - x.at < 1700), ...add].slice(-50));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fresh, snap, mySeat, names, pushFeed, showBanner, sound, setVote]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  // 내 발밑: 금 단계가 바뀌면 소리, 경보 구역·서든데스면 글자 경고 (소리 없이도 보이게)
  const geo = lakeGeo(snap.rings);
  const underMe = me && me.alive && me.air === "none" ? tileIndexAt(geo, me.x, me.z) : -1;
  const underHp = underMe >= 0 ? snap.hp[underMe] : 1;
  const crackLvl = underMe < 0 ? 0 : underHp < CRACK_2 ? 2 : underHp < CRACK_1 ? 1 : 0;
  const lastCrack = useRef({ tile: -1, lvl: 0 });
  useEffect(() => {
    const lc = lastCrack.current;
    if (fighting && underMe >= 0 && underMe === lc.tile && crackLvl > lc.lvl) sound().play("crack", crackLvl);
    lastCrack.current = { tile: underMe, lvl: crackLvl };
  }, [crackLvl, underMe, fighting, sound]);
  const underWarned = underMe >= 0 && !!snap.thaw && geo.tiles[underMe].sector === snap.thaw.sector;
  const underDoomed = underMe >= 0 && snap.doom[underMe] > 0;
  const lastDanger = useRef(false);
  useEffect(() => {
    const d = fighting && (underWarned || underDoomed);
    if (d && !lastDanger.current) sound().play("danger");
    lastDanger.current = d;
  }, [underWarned, underDoomed, fighting, sound]);

  // 전체화면
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  const quality: "high" | "low" = view.quality === "auto" ? (touch || lowFps ? "low" : "high") : view.quality;
  const use3d = view.mode === "3d" && canGl;
  const el = snap.phase === "fight" ? snap.t - snap.fightStart : 0;
  const clock = snap.phase === "fight" ? (el < SUDDEN_MS ? Math.ceil((SUDDEN_MS - el) / 1000) : Math.ceil((FIGHT_MAX_MS - el) / 1000)) : null;
  const alive = snap.players.filter((p) => p.alive).length;
  const ghostMode = !!me && !me.alive && me.ghost && fighting;
  const lastRound = snap.history[snap.history.length - 1];
  const thawLeft = snap.thaw ? Math.max(0, (snap.thaw.at - snap.t) / 1000) : null;
  const nextWarn = !snap.thaw && fighting ? Math.max(0, Math.ceil((snap.nextThawAt - snap.t) / 1000)) : null;

  const cdFrac = (until: number, total: number) => (snap.t >= until ? 1 : Math.max(0, 1 - (until - snap.t) / total));
  const scoreOrder = useMemo(() => [...snap.players].sort((a, b) => b.score - a.score || a.seat - b.seat), [snap.players]);

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          🧊 라운드 {snap.round}/{snap.options.rounds}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span className="tabular-nums">
          {clock !== null ? (snap.sudden ? <span className="font-bold text-rose-300 light:text-rose-600">⚠️ 서든데스 · 남은 {clock}초</span> : <>⏱ 서든데스까지 {clock}초</>) : snap.phase === "countdown" ? "준비" : snap.phase === "roundEnd" ? "라운드 끝" : "끝"}
        </span>
        {fighting && (
          <span className={`tabular-nums ${snap.thaw ? "font-bold text-orange-300 light:text-orange-600" : ""}`}>
            {snap.thaw ? `☀️ ${snap.thaw.sector + 1}구역 ${thawLeft?.toFixed(1)}초` : `☀️ 다음 경보 ${nextWarn}초`}
          </span>
        )}
        <span>
          생존 <b className="text-white light:text-slate-900">{alive}</b>/{snap.seatCount}
        </span>
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => setRulebook(true)} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300">
            📖 룰북
          </button>
          <button type="button" onClick={() => setSettings((v) => !v)} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300" aria-expanded={settings} aria-label="보기 설정">
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
              className={`rounded-full border px-2.5 py-1 ${view.mode === m ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 light:border-slate-300"}`}
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
              className={`rounded-full border px-2.5 py-1 ${view.quality === q ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 light:border-slate-300"}`}
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
            <b className="tabular-nums text-sky-200 light:text-sky-700">{p.score}점</b>
            {snap.phase !== "gameOver" && !p.alive && <span className="text-[11px]">{p.ghost ? (p.vote >= 0 ? `👻${p.vote + 1}` : "👻") : "🌊"}</span>}
            {p.alive && snap.t < p.spikesUntil && <span aria-label="아이젠">🥾</span>}
          </div>
        ))}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d3a5c] select-none light:border-slate-200 ${full ? "h-screen rounded-none" : touch ? "h-[64svh] min-h-[340px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? (
          <LakeScene shared={shared} names={names} seatCount={snap.seatCount} quality={quality} fx={fx} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} />
        ) : (
          <Lake2D shared={shared} />
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
                {p.alive && snap.t < p.spikesUntil && <span aria-label="아이젠">🥾</span>}
              </div>
              {p.seat === mySeat && p.alive && <div className="h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />}
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
        <div className="pointer-events-none absolute inset-x-0 top-[16%] z-20 flex flex-col items-center gap-2 px-3">
          {snap.phase === "countdown" && (
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold text-white drop-shadow">라운드 {snap.round}</span>
              <span key={countLeft} className="animate-[ti-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
                {countLeft}
              </span>
              {snap.round === 1 && (
                <span className="mt-1 max-w-sm rounded-full bg-black/45 px-3 py-1 text-center text-xs text-white">
                  {touch ? "왼쪽을 끌어 이동 · 오른쪽 버튼으로 점프·내려찍기" : "WASD/방향키 이동 · Space 점프 · Shift 내려찍기"} — 한 칸에 오래 서 있지 마세요!
                </span>
              )}
            </div>
          )}
          {banners.map((b) => (
            <div
              key={b.id}
              className={`animate-[ti-pop_0.4s_ease-out] rounded-2xl px-5 py-2 text-center shadow-xl ${b.tone === "go" ? "bg-sky-300 text-slate-900" : b.tone === "warn" ? "bg-rose-600 text-white" : b.tone === "sun" ? "bg-orange-400 text-slate-950" : b.tone === "ko" ? "bg-fuchsia-600 text-white" : "bg-slate-900/80 text-white"}`}
            >
              <div className={b.tone === "go" ? "text-4xl font-black" : "text-lg font-black"}>{b.text}</div>
              {b.sub && <div className="text-[11px] font-semibold opacity-90">{b.sub}</div>}
            </div>
          ))}
        </div>

        {/* 내 발밑 경고 (소리 없이도 보이게) */}
        {fighting && me?.alive && (underDoomed || underWarned || crackLvl === 2) && (
          <div className={`pointer-events-none absolute inset-x-0 bottom-[30%] z-20 mx-auto w-fit animate-pulse rounded-full px-3 py-1 text-xs font-bold ${underWarned ? "bg-orange-400/95 text-slate-950" : "bg-rose-600/90 text-white"}`}>
            {underDoomed ? "⚠️ 발밑이 무너져요! 안쪽으로" : underWarned ? `☀️ 여기는 곧 녹아요! (${thawLeft?.toFixed(1)}초)` : "⚠️ 발밑 얼음이 깨지려 해요!"}
          </div>
        )}

        {/* 내가 빠짐 */}
        {myOut && snap.phase === "fight" && (
          <div className="pointer-events-none absolute inset-x-0 top-[30%] z-20 flex flex-col items-center gap-1 px-3">
            <div className="animate-[ti-pop_0.4s_ease-out] text-5xl font-black text-sky-300 drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">풍덩!</div>
            <div className="rounded-full bg-black/60 px-3 py-1 text-center text-xs text-white">
              {myOut.by >= 0 ? `${names[myOut.by] ?? "누군가"}에게 밀려 빠졌어요` : "얼음이 깨져 빠졌어요"}
              {snap.options.ghosts ? " · 👻 아래에서 다음 해빙 구역을 골라요" : " · 다음 라운드를 기다려요"}
            </div>
          </div>
        )}

        {/* 라운드 결과 */}
        {snap.phase === "roundEnd" && lastRound && (
          <div className="absolute inset-x-3 top-[12%] z-30 mx-auto max-w-sm animate-[ti-pop_0.4s_ease-out] rounded-2xl border border-white/15 bg-slate-950/85 p-4 text-center text-white shadow-2xl">
            <p className="text-xs text-white/60">라운드 {lastRound.round} 결과 · {Math.round(lastRound.ms / 1000)}초</p>
            <p className="mt-1 text-xl font-black">
              {lastRound.winner >= 0 ? (
                <>
                  🏆 <SeatTag seat={lastRound.winner} names={names} me={mySeat} /> 끝까지 버팀!
                </>
              ) : lastRound.order.length === snap.seatCount ? (
                "🤝 동시에 풍덩 — 무승부"
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
            <p className="mt-2 text-[11px] text-white/50">{snap.round < snap.options.rounds ? `곧 라운드 ${snap.round + 1} — 1등보다 4점 이상 뒤진 사람은 🥾 아이젠을 신고 시작` : "최종 결과로…"}</p>
          </div>
        )}

        {/* 최종 결과 */}
        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}

        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        {/* 전체화면 */}
        <button type="button" onClick={toggleFull} className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white" aria-label={full ? "전체화면 끄기" : "전체화면"}>
          {full ? "↙ 작게" : "⛶ 크게"}
        </button>

        {/* 유령 투표판 */}
        {ghostMode && !ended && <VotePicker snap={snap} mySeat={mySeat} myVote={controls.myVote} onVote={setVote} names={names} />}

        {/* 터치 조작 */}
        {touch && !ended && snap.phase !== "gameOver" && me?.alive && (
          <>
            <Joystick onMove={controls.setStick} />
            <div className="absolute right-3 bottom-3 z-20 flex items-end gap-2">
              <CdButton label="⤴" sub="점프" ariaLabel="점프" frac={cdFrac(me.jumpCdAt, JUMP_CD_MS)} onDown={() => controls.press("jump")} />
              <CdButton label="💥" sub="내려찍기" big ariaLabel="내려찍기" frac={cdFrac(me.stompCdAt, STOMP_CD_MS)} onDown={() => controls.press("stomp")} />
            </div>
          </>
        )}
      </div>

      {/* 내 상태 + 키 안내 */}
      {me && snap.phase !== "gameOver" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          {me.alive ? (
            <>
              <Meter label="🧊 발밑 얼음" frac={underHp} tone={crackLvl === 2 ? "rose" : crackLvl === 1 ? "amber" : "sky"} value={`${Math.round(underHp * 100)}%`} />
              <Meter label="⤴ 점프" frac={cdFrac(me.jumpCdAt, JUMP_CD_MS)} />
              <Meter label="💥 내려찍기" frac={cdFrac(me.stompCdAt, STOMP_CD_MS)} />
              {snap.t < me.spikesUntil && <span>🥾 아이젠 {Math.ceil((me.spikesUntil - snap.t) / 1000)}초</span>}
            </>
          ) : ghostMode ? (
            <span>👻 유령: 아래 육각판(또는 1~6 키)으로 다음 해빙 구역을 골라요. 표가 가장 많은 구역이 다음에 녹아요.</span>
          ) : (
            <span>다음 라운드를 기다리는 중…</span>
          )}
          {!touch && <span className="text-white/40 light:text-slate-400">WASD/방향키 이동 · Space/K 점프 · Shift/J/E 내려찍기 · 1~6 유령 투표</span>}
        </div>
      )}

      {(ended || snap.phase === "gameOver") && (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && onRestart && (
            <button type="button" onClick={onRestart} className="rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-sky-300">
              다시하기
            </button>
          )}
        </div>
      )}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        @keyframes ti-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
      `}</style>
    </div>
  );
}

function Meter({ label, frac, tone = "amber", value }: { label: string; frac: number; tone?: "amber" | "sky" | "rose"; value?: string }) {
  const color = tone === "sky" ? "bg-sky-400" : tone === "rose" ? "bg-rose-500" : "bg-amber-400";
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-white/15 light:bg-slate-200">
        <span className={`block h-full ${color}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }} />
      </span>
      {value ? <span className="tabular-nums">{value}</span> : frac >= 1 && <span className="text-emerald-300 light:text-emerald-600">✓</span>}
    </span>
  );
}

function FinalPanel({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.ranks ?? snap.players.map(() => 1);
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || a.seat - b.seat);
  const best = (f: (p: (typeof snap.players)[number]) => number) => {
    const max = Math.max(...snap.players.map(f));
    return { seats: max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [], max };
  };
  const ko = best((p) => p.stats.kos);
  const wins = best((p) => p.stats.roundWins);
  const fish = best((p) => p.stats.fish);
  const vote = best((p) => p.stats.voteHits);
  const surv = best((p) => p.stats.bestSurviveMs);
  const awards: { icon: string; title: string; seats: number[]; value: string }[] = [
    { icon: "💥", title: "KO 왕", seats: ko.seats, value: `${ko.max}KO` },
    { icon: "🏆", title: "생존왕", seats: wins.seats, value: `${wins.max}라운드` },
    { icon: "⏱", title: "오래 버티기", seats: surv.seats, value: `${Math.round(surv.max / 1000)}초` },
    { icon: "🐟", title: "낚시왕", seats: fish.seats, value: `${fish.max}마리` },
    { icon: "☀️", title: "해빙 지휘자", seats: vote.seats, value: `${vote.max}명 빠뜨림` },
  ].filter((a) => a.seats.length > 0);
  return (
    <div className="absolute inset-x-3 top-[6%] z-30 mx-auto max-h-[86%] max-w-md overflow-y-auto rounded-2xl border border-sky-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
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
              🏆{p.stats.roundWins} · 💥{p.stats.kos} · 🌊{p.stats.falls} · <b className="text-sm text-sky-200">{p.score}점</b>
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
      <p className="mt-3 text-center text-[11px] text-white/50">동점이면 라운드 1등 → KO → 버틴 시간 순</p>
    </div>
  );
}
