"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_H,
  BOARD_W,
  CELL,
  COLS,
  GRADE_COLORS,
  GRADE_NAMES,
  GRID_X,
  GRID_Y,
  eliminationLimit,
  MAX_GRADE,
  MAX_UPGRADE,
  PREP_TICKS,
  ROWS,
  SEND_EVERY,
  TICK_MS,
  TICKS_PER_SEC,
  UNIT_KINDS,
  UNITS,
  WAVE_TICKS,
  canMerge,
  fieldLoad,
  isBossWave,
  mergePairs,
  pathPoint,
  slotCenter,
  summonCost,
  wakeCost,
  BRACE_MAX,
  braceCost,
  FOCUS_MAX,
  focusCost,
  critStats,
  stunTicks,
  upgradeCost,
  killGold,
  MINION_CAP,
  HIRE_KINDS,
  HIRES,
  hireCost,
  unitRange,
  type Action,
  type MergeDefenseState,
  type SeatIndex,
} from "./engine";
import { coverageFor, drawBoard, drawFx, SEAT_COLORS, type Fx } from "./render";
import * as audio from "./mergeDefenseAudio";
import RulebookModal from "./RulebookModal";

interface Props {
  state: MergeDefenseState;
  mySeat: SeatIndex;
  names: Record<SeatIndex, string>;
  onAction: (action: Action) => void;
}

interface Banner {
  key: number;
  text: string;
  sub?: string;
  tone: "wave" | "boss" | "danger" | "good";
}

const MAX_FX = 320;
/** 타격감: damage numbers for one mob are grouped over this window. */
const DMG_NUMBER_MS = 280;
/** Per-viewer 타격감 toggles (remembered in localStorage). */
interface FxPrefs {
  shake: boolean;
  numbers: boolean;
  hitstop: boolean;
  slowmo: boolean;
}
const FX_PREFS_KEY = "merge-defense:fx";
const FX_DEFAULT: FxPrefs = { shake: true, numbers: true, hitstop: true, slowmo: true };
/** Berserk kill slow motion: playback rate, length (real ms) and peak zoom. */
const SLOWMO = { rate: 0.25, ms: 700, zoom: 0.14 };
function loadFxPrefs(): FxPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(FX_PREFS_KEY) ?? "null");
    return v && typeof v === "object" ? { ...FX_DEFAULT, ...v } : FX_DEFAULT;
  } catch {
    return FX_DEFAULT;
  }
}
const fmtDmg = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
/** Gold gains this close together stack into one "+N" pop. */
const GOLD_POP_MERGE_MS = 700;
const GUIDE_KEY = "merge-defense:guide";
/**
 * 🧭 guide: a number = "자동" — shown through the prep and that many opening
 * waves, then it hides itself. The button cycles 자동 2 → 3 → 5 → ON → OFF.
 */
type GuideMode = 2 | 3 | 5 | "on" | "off";
const GUIDE_CYCLE: GuideMode[] = [2, 3, 5, "on", "off"];
const GUIDE_DEFAULT: GuideMode = 3;
function guideVisible(mode: GuideMode, wave: number): boolean {
  return mode === "on" || (typeof mode === "number" && wave <= mode);
}
/** Attack range the guide assumes for a new build (grade-1 average). */
const BUILD_RANGE = 140;
const HIRE_FX_COLOR: Record<(typeof HIRE_KINDS)[number], string> = { swarm: "#f59e0b", wraith: "#818cf8", golem: "#a8a29e", warlord: "#dc2626" };
const MOB_SPARK: Record<string, string> = {
  boss: "#c084fc",
  elite: "#f87171",
  invader: "#f87171",
  fast: "#fcd34d",
  tank: "#cbd5e1",
  golem: "#a8a29e",
  wraith: "#a5b4fc",
  warlord: "#facc15",
};

interface GoldPop {
  key: number;
  amount: number;
  at: number;
  bonus: boolean;
}

function useCanvasSize(ref: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w) el.width = w;
      if (el.height !== h) el.height = h;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

function slotAt(x: number, y: number): number | null {
  const c = Math.floor((x - GRID_X) / CELL);
  const r = Math.floor((y - GRID_Y) / CELL);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
  return r * COLS + c;
}

export default function MergeDefenseBoard({ state, mySeat, names, onAction }: Props) {
  const mainRef = useRef<HTMLCanvasElement | null>(null);
  const miniRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const stateRef = useRef(state);
  const stateAtRef = useRef(0);
  const fxRef = useRef<Fx[]>([]);
  const lastEventIdRef = useRef<number>(Math.max(0, ...state.events.map((e) => e.id)));
  const prevRef = useRef<MergeDefenseState>(state);

  const [rawSelected, setSelected] = useState<number | null>(null);
  const [rawBuildSlot, setBuildSlot] = useState<number | null>(null);
  const buildSlotRef = useRef<number | null>(null);
  const [rawTarget, setTarget] = useState<SeatIndex | null>(null);
  const aimRef = useRef<Record<number, number>>({});
  const selectedRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const bannerKey = useRef(0);
  const [goldPop, setGoldPop] = useState<GoldPop | null>(null);
  const bornAtRef = useRef<Record<number, { t: number; big: boolean }>>({});
  // 타격감 state (render-only): hit flashes, grouped damage numbers, tower recoil, screen shake.
  const hitsRef = useRef(new Map<number, number>());
  const dmgRef = useRef(new Map<number, { acc: number; shown: number }>());
  const firedRef = useRef<Record<number, number>>({});
  const shakeRef = useRef({ t0: 0, dur: 0, amp: 0 });
  /** Hit-stop: while performance.now() < until, the main board renders this frozen frame. */
  const hitStopRef = useRef<{ until: number; at: number; alpha: number; state: MergeDefenseState | null }>({ until: 0, at: 0, alpha: 0, state: null });
  const [fxPrefs, setFxPrefs] = useState<FxPrefs>(() => (typeof window === "undefined" ? FX_DEFAULT : loadFxPrefs()));
  const fxPrefsRef = useRef(fxPrefs);
  const [fxMenuOpen, setFxMenuOpen] = useState(false);
  /** Slow motion: from `start` (real ms) for SLOWMO.ms the main board replays `state` at SLOWMO.rate, zoomed on (x, y). */
  const slowRef = useRef<{ start: number; state: MergeDefenseState | null; x: number; y: number }>({ start: 0, state: null, x: 0, y: 0 });
  /** White flash that hides the snap back to live play after slow motion. */
  const flashRef = useRef(0);
  useEffect(() => {
    fxPrefsRef.current = fxPrefs;
    try {
      window.localStorage.setItem(FX_PREFS_KEY, JSON.stringify(fxPrefs));
    } catch {
      /* not remembered */
    }
  }, [fxPrefs]);
  const [guide, setGuide] = useState<GuideMode>(() => {
    try {
      const v = typeof window === "undefined" ? null : window.localStorage.getItem(GUIDE_KEY);
      return GUIDE_CYCLE.find((m) => String(m) === v) ?? GUIDE_DEFAULT;
    } catch {
      return GUIDE_DEFAULT;
    }
  });
  const guideRef = useRef(guide);
  useEffect(() => {
    guideRef.current = guide;
    try {
      window.localStorage.setItem(GUIDE_KEY, String(guide));
    } catch {
      /* storage blocked — guide just won't be remembered */
    }
  }, [guide]);
  const [hitVol, setHitVol] = useState(audio.getHitVolume);

  useCanvasSize(mainRef);

  const me = state.boards[mySeat];
  const firstAliveOther = state.boards.findIndex((b, i) => i !== mySeat && b.alive);
  const resolvedView = me.alive || firstAliveOther < 0 ? mySeat : firstAliveOther;
  const viewRef = useRef(resolvedView);
  useEffect(() => {
    viewRef.current = resolvedView;
  }, [resolvedView]);
  const others = state.boards.map((_, i) => i).filter((i) => i !== resolvedView);

  // A selection goes stale once that slot empties (merged away, etc.); a
  // build spot once something stands on it.
  const selected = rawSelected !== null && me.units[rawSelected] ? rawSelected : null;
  const buildSlot = rawBuildSlot !== null && !me.units[rawBuildSlot] ? rawBuildSlot : null;
  useEffect(() => {
    selectedRef.current = selected;
    buildSlotRef.current = buildSlot;
  }, [selected, buildSlot]);
  // 유닛 대결 target: the chosen opponent while alive, else the next living one.
  const nextAlive = (() => {
    for (let i = 1; i < state.playerCount; i++) {
      const seat = (mySeat + i) % state.playerCount;
      if (state.boards[seat].alive) return seat;
    }
    return null;
  })();
  const target = rawTarget !== null && rawTarget !== mySeat && state.boards[rawTarget]?.alive ? rawTarget : nextAlive;
  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);

  const selectedUnit = selected !== null ? me.units[selected] : null;

  function showBanner(b: Omit<Banner, "key">) {
    bannerKey.current += 1;
    setBanner({ ...b, key: bannerKey.current });
  }

  // New state → spawn FX + sounds from what changed.
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    stateRef.current = state;
    stateAtRef.current = performance.now();
    const now = performance.now();
    const view = viewRef.current;
    const fx = fxRef.current;
    const board = state.boards[view];
    const prevBoard = prev.boards[view];
    const audible = typeof document !== "undefined" && document.visibilityState === "visible";

    // Gold earned (kills, wave bonus) — positive deltas only; spending isn't highlighted.
    const gained = Math.floor(state.boards[mySeat].gold) - Math.floor(prev.boards[mySeat]?.gold ?? 0);
    if (gained > 0 && state.tick !== prev.tick) {
      const bonus = state.events.some((e) => e.id > lastEventIdRef.current && e.type === "wave");
      setGoldPop((g) =>
        g && now - g.at < GOLD_POP_MERGE_MS && g.bonus === bonus
          ? { key: g.key, amount: g.amount + gained, at: now, bonus }
          : { key: (g?.key ?? 0) + 1, amount: gained, at: now, bonus },
      );
    }

    const shake = (amp: number, dur: number) => {
      if (!fxPrefsRef.current.shake) return;
      const cur = shakeRef.current;
      const left = cur.amp * Math.max(0, 1 - (now - cur.t0) / (cur.dur || 1));
      if (amp >= left) shakeRef.current = { t0: now, dur, amp };
    };

    if (state.tick !== prev.tick && board) {
      const crits = new Set(board.shots.filter((sh) => sh.crit && sh.target !== undefined).map((sh) => sh.target!));
      // Hits: every mob that lost HP since the last state flashes; damage is
      // pooled per mob and shown as a number at most every DMG_NUMBER_MS
      // (a critical hit flushes at once, in gold with a "!").
      if (prevBoard) {
        const before = new Map(prevBoard.mobs.map((m) => [m.id, m.hp]));
        for (const m of board.mobs) {
          const was = before.get(m.id);
          if (was === undefined || m.hp >= was) continue;
          const lost = was - Math.max(0, m.hp);
          hitsRef.current.set(m.id, now);
          const d = dmgRef.current.get(m.id) ?? { acc: 0, shown: 0 };
          d.acc += lost;
          const crit = crits.has(m.id);
          if ((crit || now - d.shown >= DMG_NUMBER_MS) && d.acc >= 1) {
            const p = pathPoint(m.trav);
            const big = d.acc >= m.maxHp * 0.2;
            if (fxPrefsRef.current.numbers && view === mySeat) {
              fx.push(
                crit
                  ? { type: "text", x: p.x + ((m.id * 7) % 11) - 5, y: p.y - 20, text: `${fmtDmg(d.acc)}!`, color: "#facc15", t0: now, dur: 800, size: big ? 17 : 14 }
                  : { type: "text", x: p.x + ((m.id * 7) % 11) - 5, y: p.y - 16, text: fmtDmg(d.acc), color: big ? "#fb923c" : "#f8fafc", t0: now, dur: big ? 700 : 520, size: big ? 13 : 9 },
              );
            }
            d.acc = 0;
            d.shown = now;
          }
          dmgRef.current.set(m.id, d);
        }
        // Forget mobs that are long gone.
        if (dmgRef.current.size > 200) {
          const live = new Set(board.mobs.map((m) => m.id));
          for (const id of dmgRef.current.keys()) if (!live.has(id)) dmgRef.current.delete(id);
          for (const id of hitsRef.current.keys()) if (!live.has(id)) hitsRef.current.delete(id);
        }
      }
      for (const shot of board.shots) {
        if (shot.pts.length < 2) continue;
        const c = slotCenter(shot.slot);
        const from = { x: c.x, y: c.y + 6 + (shot.kind === "archer" ? -19 : 0) };
        aimRef.current[shot.slot] = Math.atan2(shot.pts[1] - from.y, shot.pts[0] - from.x);
        fx.push({ type: "shot", kind: shot.kind, grade: shot.grade, from, pts: shot.pts, t0: now, dur: shot.kind === "mage" ? 380 : shot.kind === "archer" ? 260 : 220 });
        if (audible) audio.playTowerHit(shot.kind, shot.grade, false, !!shot.crit && view === mySeat);
        firedRef.current[shot.slot] = now;
        if (fx.length < MAX_FX - 40) {
          const t0 = now + (shot.kind === "archer" ? 140 : 60);
          fx.push({ type: "impact", x: shot.pts[0], y: shot.pts[1] - 4, color: shot.crit ? "#facc15" : UNITS[shot.kind].color, size: (8 + shot.grade * 2) * (shot.crit ? 1.8 : 1), t0, dur: shot.crit ? 260 : 180, seed: shot.slot + state.tick });
          if (shot.crit) fx.push({ type: "ring", x: shot.pts[0], y: shot.pts[1] - 4, color: "#fde047", r0: 4, r1: 22, t0, dur: 240 });
        }
        if (shot.crit && shot.grade >= 3) shake(1.2, 90);
      }
      // Other living boards: a faint, muffled patter so you can hear them fight.
      if (audible) {
        state.boards.forEach((b, seat) => {
          if (seat === view || !b.alive) return;
          const shot = b.shots[0];
          if (shot) audio.playTowerHit(shot.kind, shot.grade, true);
        });
      }
      if (prevBoard && prevBoard.mobs.length > 0) {
        const alive = new Set(board.mobs.map((m) => m.id));
        let coins = 0;
        for (const m of prevBoard.mobs) {
          if (alive.has(m.id)) continue;
          // Kill pop + coins flying toward the gold counter (own board only).
          {
            const q = pathPoint(m.trav);
            fx.push({ type: "ring", x: q.x, y: q.y, color: "#ffffff", r0: 3, r1: m.kind === "boss" ? 40 : 16, t0: now, dur: 220 });
            if (view === mySeat && coins < 4) {
              const n = m.kind === "boss" || m.kind === "warlord" ? 6 : m.kind === "normal" || m.kind === "fast" ? 1 : 2;
              for (let i = 0; i < n && coins < 8; i++, coins++) {
                fx.push({ type: "coin", x: q.x, y: q.y, tx: 46, ty: BOARD_H + 18, t0: now + i * 40, dur: 620, seed: m.id + i * 1.7 });
              }
            }
            if (m.kind === "tank" || m.kind === "elite" || m.kind === "golem" || m.kind === "invader") shake(1.6, 140);
          }
          const p = pathPoint(m.trav);
          const color = MOB_SPARK[m.kind] ?? "#bef264";
          fx.push({ type: "spark", x: p.x, y: p.y, color, t0: now, dur: m.kind === "boss" || m.kind === "warlord" ? 900 : 380, seed: m.id });
          if (m.kind === "boss") fx.push({ type: "ring", x: p.x, y: p.y, color: "#facc15", r0: 10, r1: 70, t0: now, dur: 700 });
          if (view === mySeat) fx.push({ type: "text", x: p.x, y: p.y - 10, text: `+${killGold(m.kind, state.wave)}`, color: "#fde047", t0: now, dur: 750, size: m.kind === "boss" ? 16 : 11 });
        }
      }
    }

    const fresh = state.events.filter((e) => e.id > lastEventIdRef.current);
    if (fresh.length > 0) lastEventIdRef.current = fresh[fresh.length - 1].id;
    for (const ev of fresh) {
      if (ev.type === "wave") {
        if (ev.boss) {
          shake(3.5, 380);
          showBanner({ text: `👑 WAVE ${ev.wave} — 보스 등장!`, sub: `4초마다 졸개를 불러요(최대 ${MINION_CAP[state.difficulty ?? "normal"]}마리) → 그다음엔 광폭화`, tone: "boss" });
          if (audible) audio.playBossWave();
        } else if (ev.wave === 1 || ev.wave % 5 === 1) {
          showBanner({ text: `WAVE ${ev.wave}`, tone: "wave" });
        }
        continue;
      }
      if (ev.type === "send" && ev.to === mySeat) {
        showBanner({ text: `🔥 ${names[ev.seat] ?? "상대"}님이 정예 몬스터를 보냈어요!`, tone: "danger" });
        if (audible) audio.playEliteIncoming();
        continue;
      }
      if (ev.type === "invade") {
        const what = `${GRADE_NAMES[ev.grade]} ${UNITS[ev.kind].name}`;
        if (ev.to === mySeat) {
          showBanner({ text: `⚔️ ${names[ev.seat] ?? "상대"}님이 ${what}를 보냈어요!`, sub: "막아내세요!", tone: "danger" });
          if (ev.to === view) fx.push({ type: "portal", color: "#ef4444", label: `침략자 ${GRADE_NAMES[ev.grade]} ${UNITS[ev.kind].name}`, t0: now, dur: 1400, seed: ev.id });
          if (audible) audio.playEliteIncoming();
        } else if (ev.seat === mySeat) {
          showBanner({ text: `⚔️ ${what} → ${names[ev.to] ?? "상대"}`, tone: "good" });
          if (audible) audio.playSendUnit();
        }
        continue;
      }
      if (ev.type === "hire") {
        const what = `${HIRES[ev.mob].emoji} ${HIRES[ev.mob].name}`;
        if (ev.to === mySeat) {
          showBanner({ text: `👾 ${names[ev.seat] ?? "상대"}님이 ${what}을(를) 보냈어요!`, sub: HIRES[ev.mob].desc, tone: "danger" });
          if (audible) audio.playEliteIncoming();
        } else if (ev.seat === mySeat) {
          showBanner({ text: `👾 ${what} → ${names[ev.to] ?? "상대"}`, tone: "good" });
          if (audible) audio.playSendUnit();
        }
        if (ev.to === view) fx.push({ type: "portal", color: HIRE_FX_COLOR[ev.mob], label: `${HIRES[ev.mob].name} 등장!`, t0: now, dur: 1500, seed: ev.id });
        continue;
      }
      if (ev.type === "out") {
        if (ev.seat === mySeat) {
          showBanner({ text: "💀 방어선 붕괴!", sub: "다른 플레이어를 관전합니다", tone: "danger" });
          if (audible) audio.playOut();
        } else {
          showBanner({ text: `💥 ${names[ev.seat] ?? "상대"} 탈락!`, tone: "good" });
        }
        continue;
      }
      if (ev.seat !== view) continue;
      const mine = ev.seat === mySeat;
      switch (ev.type) {
        case "summon": {
          const c = slotCenter(ev.slot);
          fx.push({ type: "ring", x: c.x, y: c.y, color: GRADE_COLORS[ev.grade], r0: 6, r1: 32, t0: now, dur: 380 });
          bornAtRef.current[ev.slot] = { t: now, big: false };
          if (ev.lucky) fx.push({ type: "text", x: c.x, y: c.y - 20, text: "행운! 희귀", color: GRADE_COLORS[2], t0: now, dur: 1100, size: 15 });
          if (mine && audible) audio.playSummon(ev.lucky);
          break;
        }
        case "merge": {
          const c = slotCenter(ev.slot);
          const color = GRADE_COLORS[ev.grade];
          // Evolution: the spent unit streams in, then a light pillar crowns the new grade.
          if (ev.from !== undefined) fx.push({ type: "absorb", from: slotCenter(ev.from), to: c, color: GRADE_COLORS[ev.grade - 1], t0: now, dur: 380 });
          fx.push({ type: "evolve", x: c.x, y: c.y + 4, color, grade: ev.grade, t0: now + 180, dur: 900 + ev.grade * 120 });
          bornAtRef.current[ev.slot] = { t: now + 200, big: true };
          if (ev.grade >= 4) shake(ev.grade >= 5 ? 5 : 3, 320);
          fx.push({ type: "spark", x: c.x, y: c.y, color: GRADE_COLORS[ev.grade], t0: now, dur: 650, seed: ev.id });
          fx.push({ type: "ring", x: c.x, y: c.y, color: GRADE_COLORS[ev.grade], r0: 10, r1: 46, t0: now, dur: 550 });
          fx.push({ type: "text", x: c.x, y: c.y - 22, text: `진화! ${GRADE_NAMES[ev.grade]}`, color, t0: now + 200, dur: 1100, size: ev.grade >= 4 ? 20 : 15 });
          if (mine && audible) audio.playMerge(ev.grade);
          break;
        }
        case "gamble": {
          const c = slotCenter(ev.slot);
          fx.push({ type: "spark", x: c.x, y: c.y, color: GRADE_COLORS[ev.grade], t0: now, dur: 800, seed: ev.id });
          fx.push({ type: "evolve", x: c.x, y: c.y + 4, color: GRADE_COLORS[ev.grade], grade: ev.grade, t0: now, dur: 800 + ev.grade * 120 });
          bornAtRef.current[ev.slot] = { t: now, big: true };
          fx.push({ type: "text", x: c.x, y: c.y - 22, text: `💎 ${GRADE_NAMES[ev.grade]}!`, color: GRADE_COLORS[ev.grade], t0: now, dur: 1200, size: 18 });
          if (mine && audible) audio.playGamble(true);
          break;
        }
        case "gamble-fail":
          fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2, text: "💎 꽝…", color: "#e5e7eb", t0: now, dur: 1100, size: 22 });
          if (mine && audible) audio.playGamble(false);
          break;
        case "upgrade":
          fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2, text: `${UNITS[ev.kind].emoji} 강화 Lv.${ev.level}`, color: UNITS[ev.kind].color, t0: now, dur: 900, size: 18 });
          if (mine && audible) audio.playUpgrade();
          break;
        case "rage": {
          const p = pathPoint(ev.trav);
          fx.push({ type: "ring", x: p.x, y: p.y, color: "#ef4444", r0: 8, r1: 46, t0: now, dur: 700 });
          fx.push({ type: "text", x: p.x, y: p.y < 45 ? p.y + 34 : p.y - 34, text: "광폭화!", color: "#fca5a5", t0: now, dur: 1200, size: 14 });
          if (mine) showBanner({ text: `😡 ${ev.boss ? "보스" : "전쟁군주"} 광폭화!`, sub: "졸개를 다 불렀어요 — 이제 6초마다 가까운 타워를 2초 기절시켜요", tone: "danger" });
          break;
        }
        case "smash": {
          const p = pathPoint(ev.trav);
          const t = slotCenter(ev.slot);
          fx.push({ type: "smash", x: p.x, y: p.y + 6, tx: t.x, ty: t.y + 6, t0: now, dur: 650, seed: ev.id });
          shake(3, 220);
          if (mine && audible) audio.playBossSmash();
          break;
        }
        case "split": {
          const p = pathPoint(ev.trav);
          fx.push({ type: "split", x: p.x, y: p.y, t0: now, dur: 750, seed: ev.id });
          shake(2.4, 200);
          if (mine && audible) audio.playGolemSplit();
          break;
        }
        case "call": {
          // Find the minion that just appeared behind the caller for the tether end.
          const p = pathPoint(ev.trav);
          const s2 = pathPoint(Math.max(0, ev.trav - 6));
          fx.push({ type: "call", x: p.x, y: p.y, sx: s2.x, sy: s2.y + 4, color: ev.boss ? "#a855f7" : "#dc2626", t0: now, dur: 800, seed: ev.id });
          // Top road: put the label under the caller so it stays on the board.
          fx.push({ type: "text", x: p.x, y: p.y < 45 ? p.y + 34 : p.y - (ev.boss ? 36 : 30), text: "졸개 소환!", color: ev.boss ? "#e9d5ff" : "#fecaca", t0: now, dur: 800, size: 11 });
          if (mine && audible) audio.playMinionCall(ev.boss);
          break;
        }
        case "boss-kill":
          shake(ev.rage ? 8 : 6, ev.rage ? 520 : 420);
          // Hit-stop: hold the killing frame for a beat before the shake kicks in.
          {
            const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            const stop = fxPrefsRef.current.hitstop && !calm ? (ev.rage ? 170 : 110) : 0;
            if (stop) hitStopRef.current = { until: now + stop, at: now + 50, alpha: 1, state };
            // Berserk kill: after the freeze, replay the moment in slow motion,
            // zoomed on where the boss fell, then flash back to live play.
            if (ev.rage && fxPrefsRef.current.slowmo && !calm) {
              const fell = prevBoard?.mobs.find((m) => (m.kind === "boss" || m.kind === "warlord") && !board.mobs.some((b) => b.id === m.id));
              const p = fell ? pathPoint(fell.trav) : { x: BOARD_W / 2, y: BOARD_H / 2 };
              slowRef.current = { start: now + stop, state, x: p.x, y: p.y };
              flashRef.current = now + stop + SLOWMO.ms;
              shakeRef.current = { ...shakeRef.current, t0: now + stop + SLOWMO.ms };
            } else if (stop) {
              shakeRef.current = { ...shakeRef.current, t0: now + stop };
            }
          }
          if (ev.rage) {
            // Berserk kill: bigger, redder callout with the bonus spelled out.
            const who = ev.warlord ? "광폭 전쟁군주 처치!" : "광폭 보스 처치!";
            fx.push({ type: "ring", x: BOARD_W / 2, y: BOARD_H / 2, color: "#f87171", r0: 20, r1: 120, t0: now, dur: 900 });
            fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2 - 16, text: who, color: "#fca5a5", t0: now, dur: 1700, size: 22 });
            fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2 + 12, text: `보너스 +${ev.gold ?? 0}골드 · 보석 +${ev.gems ?? 1}`, color: "#fde047", t0: now + 150, dur: 1600, size: 15 });
          } else {
            fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2 - 10, text: "보스 처치! +💎2", color: "#facc15", t0: now, dur: 1500, size: 22 });
          }
          if (mine && audible) audio.playBossKill();
          break;
        case "focus": {
          const cs = critStats(ev.level);
          fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2, text: `집중 Lv.${ev.level} — 치명타 ${Math.round(cs.chance * 100)}% ×${cs.mult.toFixed(2)}`, color: "#facc15", t0: now, dur: 1100, size: 16 });
          if (mine && audible) audio.playUpgrade();
          break;
        }
        case "brace":
          fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2, text: `결속 Lv.${ev.level} — 기절 ${(stunTicks(ev.level) / 20).toFixed(1)}초`, color: "#cbd5e1", t0: now, dur: 1100, size: 17 });
          if (mine && audible) audio.playUpgrade();
          break;
        case "wake":
          fx.push({ type: "ring", x: BOARD_W / 2, y: BOARD_H / 2, color: "#fde047", r0: 10, r1: 90, t0: now, dur: 600 });
          fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2, text: `기절 해제! ×${ev.count}`, color: "#fde047", t0: now, dur: 1000, size: 18 });
          if (mine && audible) audio.playUpgrade();
          break;
      }
    }

    // Drop finished effects; cap the list.
    const live = fx.filter((f) => now - f.t0 < f.dur);
    fxRef.current = live.length > MAX_FX ? live.slice(live.length - MAX_FX) : live;
  }, [state, mySeat, names]);

  // Fade the "+N gold" pop shortly after the last gain.
  useEffect(() => {
    if (!goldPop) return;
    const t = window.setTimeout(() => setGoldPop((g) => (g?.key === goldPop.key && g.at === goldPop.at ? null : g)), 1300);
    return () => window.clearTimeout(t);
  }, [goldPop]);

  // Clear banners after a moment.
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner((b) => (b?.key === banner.key ? null : b)), banner.tone === "boss" ? 2600 : 1900);
    return () => window.clearTimeout(t);
  }, [banner]);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const loop = () => {
      const real = performance.now();
      const hs = hitStopRef.current;
      const frozen = real < hs.until && hs.state !== null;
      const sl = slowRef.current;
      const slowT = !frozen && sl.state && real >= sl.start && real < sl.start + SLOWMO.ms ? (real - sl.start) / SLOWMO.ms : -1;
      const slow = slowT >= 0;
      const now = frozen ? hs.at : slow ? sl.start + (real - sl.start) * SLOWMO.rate : real;
      const s = frozen ? hs.state! : slow ? sl.state! : stateRef.current;
      // Slow motion extrapolates mobs forward from the kill state at the slowed clock.
      const alpha = frozen ? hs.alpha : slow ? 1 + ((real - sl.start) * SLOWMO.rate) / TICK_MS : Math.min(1, (now - stateAtRef.current) / TICK_MS);
      const live = stateRef.current;
      const liveAlpha = Math.min(1, (real - stateAtRef.current) / TICK_MS);
      const view = viewRef.current;
      const main = mainRef.current;
      if (main) {
        const ctx = main.getContext("2d");
        if (ctx) {
          const k = main.width / BOARD_W;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, main.width, main.height);
          // Screen shake (skipped for "reduce motion").
          const sh = shakeRef.current;
          const sk = sh.dur > 0 && !reduceMotion ? Math.max(0, 1 - (now - sh.t0) / sh.dur) : 0;
          const ox = sk > 0 ? (Math.random() * 2 - 1) * sh.amp * sk : 0;
          const oy = sk > 0 ? (Math.random() * 2 - 1) * sh.amp * sk : 0;
          // Slow-motion zoom eases in and back out around the fallen boss.
          const z = slow ? 1 + SLOWMO.zoom * Math.sin(slowT * Math.PI) : 1;
          const zx = slow ? sl.x - sl.x * z : 0;
          const zy = slow ? sl.y - sl.y * z : 0;
          ctx.setTransform(k * z, 0, 0, k * z, (ox + zx) * k, (oy + zy) * k);
          const board = s.boards[view];
          const sel = view === mySeat ? selectedRef.current : null;
          const highlight = new Set<number>();
          if (sel !== null) board.units.forEach((_, i) => canMerge(board, sel, i) && highlight.add(i));
          // Guide range: the unit being moved (selected / dragged), else a fresh build.
          const mine = view === mySeat && s.phase === "playing" && board.alive;
          const moving = dragFromRef.current ?? sel;
          const movingUnit = moving !== null ? board.units[moving] : null;
          const guideOn = guideVisible(guideRef.current, s.wave);
          const coverage = mine && guideOn ? coverageFor(movingUnit ? unitRange(movingUnit) : BUILD_RANGE) : null;
          drawBoard(ctx, board, {
            alpha: s.phase === "playing" ? alpha : 0,
            now,
            selected: sel,
            buildSlot: view === mySeat ? buildSlotRef.current : null,
            highlight,
            dropTarget: dropTargetRef.current,
            aim: aimRef.current,
            coverage,
            bornAt: bornAtRef.current,
            hits: hitsRef.current,
            firedAt: firedRef.current,
            limit: eliminationLimit(s),
          });
          drawFx(ctx, fxRef.current, now);
          if (frozen) {
            // A faint white wash sells the freeze.
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fillRect(-10, -10, BOARD_W + 20, BOARD_H + 20);
          }
          if (slow) {
            // Cinematic vignette while time crawls.
            ctx.setTransform(k, 0, 0, k, 0, 0);
            const v = ctx.createRadialGradient(BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.35, BOARD_W / 2, BOARD_H / 2, BOARD_W * 0.75);
            v.addColorStop(0, "rgba(0,0,0,0)");
            v.addColorStop(1, `rgba(20,0,0,${0.45 * Math.sin(slowT * Math.PI)})`);
            ctx.fillStyle = v;
            ctx.fillRect(0, 0, BOARD_W, BOARD_H);
          }
          const fl = real - flashRef.current;
          if (fl >= 0 && fl < 220) {
            ctx.setTransform(k, 0, 0, k, 0, 0);
            ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - fl / 220)})`;
            ctx.fillRect(0, 0, BOARD_W, BOARD_H);
          }
        }
      }
      miniRefs.current.forEach((c, seat) => {
        if (!c || seat === view) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(c.clientWidth * dpr);
        const h = Math.round(c.clientHeight * dpr);
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx || w === 0) return;
        const k = w / BOARD_W;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawBoard(ctx, live.boards[seat], { alpha: live.phase === "playing" ? liveAlpha : 0, now: real, mini: true, limit: eliminationLimit(live) });
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mySeat]);

  const interactive = me.alive && state.phase === "playing" && resolvedView === mySeat;

  function toLogical(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * BOARD_W, y: ((e.clientY - rect.top) / rect.height) * BOARD_H };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    const { x, y } = toLogical(e);
    const slot = slotAt(x, y);
    dragFromRef.current = slot !== null && me.units[slot] ? slot : null;
    if (dragFromRef.current !== null) e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const from = dragFromRef.current;
    if (from === null) return;
    const { x, y } = toLogical(e);
    const slot = slotAt(x, y);
    const next = slot !== null && slot !== from ? slot : null;
    if (next !== dropTargetRef.current) setDropTarget(next);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    const from = dragFromRef.current;
    dragFromRef.current = null;
    setDropTarget(null);
    const { x, y } = toLogical(e);
    const slot = slotAt(x, y);
    // Drag onto a matching unit → merge; anywhere else on the grid → move/swap.
    if (from !== null && slot !== null && slot !== from) {
      onAction(canMerge(me, from, slot) ? { type: "merge", a: from, b: slot } : { type: "move", a: from, b: slot });
      setSelected(null);
      setBuildSlot(null);
      return;
    }
    // Tap logic: an empty cell becomes the build spot.
    if (slot === null) {
      setSelected(null);
      setBuildSlot(null);
      return;
    }
    if (!me.units[slot]) {
      if (selected !== null) {
        // Selected unit + tap on an empty cell → move it there.
        onAction({ type: "move", a: selected, b: slot });
        setSelected(null);
        return;
      }
      setBuildSlot(buildSlot === slot ? null : slot);
      return;
    }
    setBuildSlot(null);
    if (selected === null || selected === slot) {
      setSelected(selected === slot ? null : slot);
      return;
    }
    if (canMerge(me, selected, slot)) {
      onAction({ type: "merge", a: selected, b: slot });
      setSelected(null);
    } else {
      setSelected(slot);
    }
  }

  const guideShown = guideVisible(guide, state.wave);
  const limit = eliminationLimit(state);
  const load = fieldLoad(me);
  const loadPct = Math.min(1, load / limit);
  const cost = summonCost(me);
  const stunnedCount = me.units.filter((u) => u?.stun).length;
  const wakeNow = wakeCost(state.wave);
  const braceLevel = me.brace ?? 0;
  const focusLevel = me.focus ?? 0;
  const freeSlots = me.units.filter((u) => !u).length;
  const pairs = useMemo(() => mergePairs(me), [me]);
  const versus = state.mode === "versus";
  const sendCdSec = Math.ceil(me.sendCd / TICKS_PER_SEC);
  const canSend = interactive && versus && selected !== null && me.sendCd === 0 && state.wave >= 1 && target !== null;
  const waveLeftTicks = state.tick < PREP_TICKS ? PREP_TICKS - state.tick : WAVE_TICKS - ((state.tick - PREP_TICKS) % WAVE_TICKS);
  const nextWave = state.tick < PREP_TICKS ? 1 : state.wave + 1;
  const nextIsBoss = isBossWave(nextWave);

  const bannerTone: Record<Banner["tone"], string> = {
    wave: "border-sky-300/40 bg-sky-500/25 text-sky-50",
    boss: "border-amber-300/60 bg-gradient-to-r from-purple-700/80 to-amber-600/80 text-amber-50",
    danger: "border-rose-300/50 bg-rose-600/70 text-rose-50",
    good: "border-emerald-300/50 bg-emerald-600/60 text-emerald-50",
  };

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2 pb-20 select-none sm:pb-0" onPointerDown={audio.unlockHitSounds}>
      <style>{`@keyframes md-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}@keyframes md-gold-rise{0%{transform:translateY(4px) scale(.8);opacity:0}15%{transform:translateY(0) scale(1.15);opacity:1}70%{opacity:1}100%{transform:translateY(-14px) scale(1);opacity:0}}@keyframes md-gold-glow{0%{text-shadow:0 0 0 rgba(250,204,21,0);transform:scale(1)}25%{text-shadow:0 0 12px rgba(250,204,21,.95);transform:scale(1.18)}100%{text-shadow:0 0 0 rgba(250,204,21,0);transform:scale(1)}}`}</style>
      {/* Wave HUD */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          {state.wave === 0 ? "준비 시간" : `🌊 WAVE ${state.wave}`}
          {state.difficulty && state.difficulty !== "normal" && (
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${state.difficulty === "hard" ? "bg-rose-500/25 text-rose-200 light:text-rose-700" : "bg-emerald-500/25 text-emerald-200 light:text-emerald-700"}`}>
              {state.difficulty === "hard" ? "🔥 어려움" : "🌱 쉬움"}
            </span>
          )}
        </span>
        <span className={nextIsBoss ? "font-semibold text-amber-300 light:text-amber-600" : ""}>
          {nextIsBoss ? "👑 보스" : "다음 웨이브"} {Math.ceil(waveLeftTicks / (1000 / TICK_MS))}초
        </span>
        <span className="flex gap-1">
          <button
            onClick={() => {
              const i = audio.HIT_VOLUMES.findIndex((v) => v.value === hitVol);
              const next = audio.HIT_VOLUMES[(i + 1) % audio.HIT_VOLUMES.length].value;
              audio.setHitVolume(next);
              setHitVol(next);
              if (next > 0) audio.playTowerHit("archer", 1);
            }}
            title="타워 타격음 크기 (사이트 효과음 볼륨과 곱해져요)"
            className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/30 light:border-slate-300"
          >
            {hitVol === 0 ? "🔇" : hitVol < 1 ? "🔈" : hitVol > 1 ? "🔊" : "🔉"} 타격음 {audio.HIT_VOLUMES.find((v) => v.value === hitVol)?.label}
          </button>
          <button
            onClick={() => setGuide((g) => GUIDE_CYCLE[(GUIDE_CYCLE.indexOf(g) + 1) % GUIDE_CYCLE.length])}
            title="빈 칸마다 길을 얼마나 덮는지(%) 보여줘요 — ★가 가장 좋은 자리. 누를 때마다 자동(2·3·5웨이브까지) → 항상 ON → OFF"
            className={`rounded-full border px-2 py-0.5 text-[11px] ${guideShown ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200 light:border-emerald-400 light:bg-emerald-50 light:text-emerald-700" : "border-white/15 hover:border-white/30 light:border-slate-300"}`}
          >
            🧭 가이드 {typeof guide === "number" ? `자동(~W${guide})` : guide === "on" ? "ON" : "OFF"}
          </button>
          <span className="relative">
            <button
              onClick={() => setFxMenuOpen((o) => !o)}
              aria-expanded={fxMenuOpen}
              title="타격감 연출 설정"
              className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/30 light:border-slate-300"
            >
              ⚙️
            </button>
            {fxMenuOpen && (
              <div className="absolute top-7 right-0 z-30 flex w-44 flex-col gap-1 rounded-xl border border-white/15 bg-slate-900/95 p-2 text-[12px] text-white shadow-xl light:border-slate-200 light:bg-white light:text-slate-800">
                <p className="px-1 text-[10px] font-semibold text-white/50 light:text-slate-400">타격감 연출</p>
                {(
                  [
                    ["shake", "📳 화면 흔들림"],
                    ["numbers", "🔢 데미지 숫자 (내 보드)"],
                    ["hitstop", "⏸️ 보스 처치 멈춤"],
                    ["slowmo", "🎬 광폭 보스 슬로모션"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFxPrefs((p) => ({ ...p, [key]: !p[key] }))}
                    aria-pressed={fxPrefs[key]}
                    className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-white/10 light:hover:bg-slate-100"
                  >
                    <span>{label}</span>
                    <span className={`rounded-full px-1.5 text-[10px] font-bold ${fxPrefs[key] ? "bg-emerald-500/30 text-emerald-200 light:text-emerald-700" : "bg-white/10 text-white/50 light:bg-slate-100 light:text-slate-400"}`}>
                      {fxPrefs[key] ? "ON" : "OFF"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </span>
          <button onClick={() => setRulebookOpen(true)} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/30 light:border-slate-300">
            📖 룰
          </button>
        </span>
      </div>

      {/* Opponents */}
      <div className="flex justify-center gap-2">
        {others.map((seat) => {
          const b = state.boards[seat];
          const oppLoad = fieldLoad(b);
          const l = Math.min(1, oppLoad / limit);
          return (
            <div
              key={seat}
              onClick={() => versus && seat !== mySeat && b.alive && setTarget(seat)}
              className={`flex w-[min(32%,170px)] flex-col gap-0.5 rounded-lg ${versus && seat === target ? "ring-2 ring-rose-400 ring-offset-2 ring-offset-transparent" : ""} ${versus && seat !== mySeat ? "cursor-pointer" : ""}`}
            >
              <div className="flex items-center gap-1 text-[11px] text-white/70 light:text-slate-600">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEAT_COLORS[seat] }} />
                <span className="truncate">{names[seat]}</span>
                {seat === mySeat && <span className="text-white/40">(나)</span>}
                {versus && seat === target && <span className="ml-auto text-[10px] font-bold text-rose-300">🎯</span>}
              </div>
              <canvas
                ref={(el) => {
                  miniRefs.current[seat] = el;
                }}
                className="aspect-[400/280] w-full rounded-lg"
              />
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                <div className={`h-full ${l > 0.75 ? "bg-rose-500" : l > 0.5 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${l * 100}%` }} />
              </div>
              <div className="flex items-center justify-between gap-1 font-mono text-[10px] leading-tight">
                {b.alive ? (
                  <>
                    <span className="text-white/70 light:text-slate-600">👾 몬스터</span>
                    <span className={`font-bold ${l > 0.75 ? "animate-pulse text-rose-300 light:text-rose-600" : l > 0.5 ? "text-amber-300 light:text-amber-600" : "text-white/80 light:text-slate-700"}`}>
                      {oppLoad}
                      <span className="text-rose-300/90 light:text-rose-600">/{limit}마리</span>
                    </span>
                  </>
                ) : (
                  <span className="w-full text-center font-sans font-bold text-rose-300/80 light:text-rose-600">💀 탈락</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 유닛 대결: send a unit / buy monsters — kept up here, beside the target picker, so the site's 🎲 button never covers it on mobile. */}
      {versus && (
        <div className="flex flex-col gap-1 rounded-xl border border-rose-400/25 bg-rose-950/30 px-2 py-1.5 light:border-rose-200 light:bg-rose-50">
          <div className="flex items-center justify-between text-[11px] text-rose-100/80 light:text-rose-700">
            <span className="font-bold">⚔️ 공격 → {target !== null ? names[target] : "-"}</span>
            <span className="opacity-80">{me.sendCd > 0 ? `재사용 ${sendCdSec}초` : state.wave < 1 ? "1웨이브부터" : "상대 미니맵을 눌러 대상 변경"}</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            <button
              disabled={!canSend}
              onClick={() => {
                if (selected === null || target === null) return;
                onAction({ type: "send", slot: selected, to: target });
                setSelected(null);
              }}
              className="flex flex-col items-center rounded-lg bg-gradient-to-b from-rose-500 to-red-800 py-1 text-white shadow-[0_3px_0_#7f1d1d] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40"
            >
              <span className="text-[13px] leading-tight font-black">⚔️ 보내기</span>
              <span className="text-[9px] font-semibold opacity-85">{selected === null ? "유닛 선택" : "선택 유닛"}</span>
            </button>
            {HIRE_KINDS.map((kind) => {
              const def = HIRES[kind];
              const price = hireCost(kind, state.wave);
              const locked = state.wave < def.minWave;
              const ok = interactive && me.sendCd === 0 && state.wave >= 1 && !locked && me.gold >= price && target !== null;
              return (
                <button
                  key={kind}
                  disabled={!ok}
                  title={def.desc}
                  onClick={() => target !== null && onAction({ type: "hire", mob: kind, to: target })}
                  className="flex flex-col items-center rounded-lg border border-rose-300/25 bg-black/30 py-1 text-white transition hover:border-rose-300/60 disabled:opacity-40 light:border-rose-200 light:bg-white light:text-slate-900"
                >
                  <span className="text-[13px] leading-tight">{def.emoji}</span>
                  <span className="text-[9px] leading-tight font-bold">{def.name}</span>
                  <span className="font-mono text-[9px] opacity-75">{locked ? `W${def.minWave}~` : `🪙${price}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main board */}
      <div className="relative">
        <canvas
          ref={mainRef}
          className="aspect-[400/280] w-full touch-none rounded-2xl shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)]"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragFromRef.current = null;
            setDropTarget(null);
          }}
        />
        {interactive && stunnedCount > 0 && (
          <button
            onClick={() => onAction({ type: "wake" })}
            disabled={me.gold < wakeNow}
            className="absolute top-2 right-2 animate-pulse rounded-full border border-amber-200/70 bg-gradient-to-b from-amber-400 to-orange-600 px-3 py-1.5 text-xs font-black text-white shadow-lg transition active:scale-95 disabled:animate-none disabled:opacity-50"
            title="광폭화한 보스에게 기절당한 타워를 모두 바로 깨워요"
          >
            ⚡ 기절 해제 ×{stunnedCount} <span className="font-mono">🪙{wakeNow}</span>
          </button>
        )}
        {resolvedView !== mySeat && (
          <div className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
            👀 {names[resolvedView]} 관전 중
          </div>
        )}
        {banner && (
          <div key={banner.key} className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center px-4">
            <div className={`animate-[md-pop_0.35s_ease-out] rounded-2xl border px-4 py-2 text-center shadow-lg backdrop-blur-sm ${bannerTone[banner.tone]}`}>
              <p className="text-base font-black sm:text-lg">{banner.text}</p>
              {banner.sub && <p className="text-[11px] opacity-80">{banner.sub}</p>}
            </div>
          </div>
        )}
      </div>

      {/* My stats */}
      <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 light:border-slate-200 light:bg-white">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="font-semibold text-white/80 light:text-slate-700">
            👾 내 길의 몬스터{" "}
            <b className={`font-mono text-sm ${loadPct > 0.75 ? "text-rose-300 light:text-rose-600" : loadPct > 0.5 ? "text-amber-300 light:text-amber-600" : "text-white light:text-slate-900"}`}>{load}</b>
            마리
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 font-black ${loadPct > 0.75 ? "animate-pulse border-rose-300 bg-rose-600 text-white" : "border-rose-400/60 bg-rose-500/20 text-rose-200 light:border-rose-300 light:bg-rose-50 light:text-rose-600"}`}
            title={`종류와 상관없이 몬스터 1마리 = 1 · ${state.limit ? "방장이 정한 기준" : "인원별 기본 기준"}`}
          >
            💀 {limit}마리 되면 탈락
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <div
              className={`h-full transition-[width] duration-200 ${loadPct > 0.75 ? "animate-pulse bg-rose-500" : loadPct > 0.5 ? "bg-amber-400" : "bg-emerald-400"}`}
              style={{ width: `${loadPct * 100}%` }}
            />
          </div>
          <span className={`w-14 text-right font-mono font-bold ${loadPct > 0.75 ? "text-rose-300 light:text-rose-600" : "text-white light:text-slate-900"}`}>
            {load}/<span className="text-rose-300 light:text-rose-600">{limit}</span>
          </span>
        </div>
        <p className="text-[10px] leading-tight text-white/45 light:text-slate-400">보스·전쟁군주는 졸개를 다 부르면 광폭화해 타워를 기절시켜요 · 골렘은 쓰러지면 2마리로 갈라져요</p>
        <div className="flex items-center justify-between text-sm font-bold text-white light:text-slate-900">
          <span className="relative">
            <span key={goldPop?.key ?? 0} className={`inline-block ${goldPop ? "animate-[md-gold-glow_0.6s_ease-out] text-amber-300 light:text-amber-600" : ""}`}>
              🪙 {Math.floor(me.gold)}
            </span>
            {goldPop && (
              <span
                key={`${goldPop.key}-${goldPop.amount}`}
                className="pointer-events-none absolute -top-4 left-full ml-1 animate-[md-gold-rise_1.2s_ease-out_forwards] whitespace-nowrap rounded-full bg-amber-400/90 px-1.5 text-[11px] font-black text-amber-950 shadow"
              >
                +{goldPop.amount}
                {goldPop.bonus && <span className="ml-0.5 text-[9px] font-bold">웨이브 보너스</span>}
              </span>
            )}
          </span>
          <span>💎 {me.gems}</span>
          <span className="text-xs font-semibold text-white/60 light:text-slate-500" title="이만큼 처치하면 다음 상대에게 정예 몬스터를 보내요">
            🔥 {me.sendMeter}/{SEND_EVERY}
          </span>
          <span className="text-xs font-semibold text-white/60 light:text-slate-500">⚔️ {me.kills}</span>
        </div>
      </div>

      <p className="min-h-[1rem] text-center text-xs text-white/70 light:text-slate-600">
        {selectedUnit ? (
          <>
            <span style={{ color: GRADE_COLORS[selectedUnit.grade] }}>{GRADE_NAMES[selectedUnit.grade]}</span> {UNITS[selectedUnit.kind].emoji}{" "}
            {UNITS[selectedUnit.kind].name} — {UNITS[selectedUnit.kind].desc}
            {selectedUnit.grade < MAX_GRADE ? " · 같은 유닛을 눌러 합성 · 빈 칸을 눌러 이동" : " · 최고 등급 · 빈 칸을 눌러 이동"}
          </>
        ) : buildSlot !== null ? (
          "🏗️ 이 칸에 건설해요 — 소환 또는 도박을 누르세요 (점선 원 = 사거리)"
        ) : (
          "빈 칸을 눌러 건설 위치를 고르세요 · 유닛을 끌어서 옮기거나 같은 유닛 위에 놓아 합성"
        )}
      </p>

      {/* Actions */}
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
        <button
          disabled={!interactive || me.gold < cost || buildSlot === null}
          onClick={() => buildSlot !== null && onAction({ type: "summon", slot: buildSlot })}
          className="rounded-xl bg-gradient-to-b from-amber-400 to-orange-600 py-3 text-sm font-black text-white shadow-[0_4px_0_#9a3412] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40"
        >
          🎲 소환 <span className="font-mono">🪙{cost}</span>
          <span className="block text-[10px] font-semibold">{freeSlots === 0 ? "자리 없음 — 합성하세요" : buildSlot === null ? "빈 칸을 먼저 선택" : "선택한 칸에 건설"}</span>
        </button>
        <button
          disabled={!interactive || me.gems < 1 || buildSlot === null}
          onClick={() => buildSlot !== null && onAction({ type: "gamble", slot: buildSlot })}
          className="rounded-xl bg-gradient-to-b from-sky-400 to-indigo-600 py-3 text-xs font-black text-white shadow-[0_4px_0_#312e81] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40"
        >
          💎 도박
          <span className="block text-[10px] font-semibold opacity-80">희귀~전설</span>
        </button>
        <button
          disabled={!interactive || pairs.length === 0}
          onClick={() => {
            const [a, b] = pairs[0];
            onAction({ type: "merge", a, b });
            setSelected(null);
          }}
          className="rounded-xl bg-gradient-to-b from-fuchsia-400 to-purple-700 py-3 text-xs font-black text-white shadow-[0_4px_0_#581c87] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40"
        >
          🔀 합성
          <span className="block text-[10px] font-semibold opacity-80">{pairs.length}쌍 가능</span>
        </button>
      </div>

      {/* Upgrades */}
      <div className="grid grid-cols-5 gap-1.5">
        {UNIT_KINDS.map((kind) => {
          const level = me.upgrades[kind];
          const maxed = level >= MAX_UPGRADE;
          const price = upgradeCost(level);
          return (
            <button
              key={kind}
              disabled={!interactive || maxed || me.gold < price}
              onClick={() => onAction({ type: "upgrade", kind })}
              className="flex flex-col items-center rounded-lg border border-white/10 bg-white/5 py-1.5 text-white transition hover:border-white/30 disabled:opacity-40 light:border-slate-200 light:bg-white light:text-slate-900"
              style={{ boxShadow: `inset 0 -3px 0 ${UNITS[kind].color}` }}
            >
              <span className="text-base leading-none">{UNITS[kind].emoji}</span>
              <span className="text-[10px] font-bold">Lv.{level}</span>
              <span className="font-mono text-[10px] opacity-70">{maxed ? "MAX" : `🪙${price}`}</span>
            </button>
          );
        })}
      </div>

      {/* Board-wide upgrades */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          disabled={!interactive || focusLevel >= FOCUS_MAX || me.gold < focusCost(focusLevel)}
          onClick={() => onAction({ type: "focus" })}
          title="🎯 집중: 모든 타워의 치명타 확률 +3%p, 치명타 배율 +0.15 (단계마다)"
          className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-white transition hover:border-white/30 disabled:opacity-40 light:border-slate-200 light:bg-white light:text-slate-900"
          style={{ boxShadow: "inset 0 -3px 0 #facc15" }}
        >
          <span className="flex flex-col leading-tight">
            <span className="text-[12px] font-bold">🎯 집중 {focusLevel}/{FOCUS_MAX}</span>
            <span className="text-[10px] opacity-70">
              치명타 {Math.round(critStats(focusLevel).chance * 100)}% ×{critStats(focusLevel).mult.toFixed(2)}
            </span>
          </span>
          <span className="font-mono text-[10px] opacity-80">{focusLevel >= FOCUS_MAX ? "MAX" : `🪙${focusCost(focusLevel)}`}</span>
        </button>
        <button
          disabled={!interactive || braceLevel >= BRACE_MAX || me.gold < braceCost(braceLevel)}
          onClick={() => onAction({ type: "brace" })}
          title="🛡️ 결속: 광폭화 보스의 기절 시간을 단계마다 25%씩 줄여요"
          className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-white transition hover:border-white/30 disabled:opacity-40 light:border-slate-200 light:bg-white light:text-slate-900"
          style={{ boxShadow: "inset 0 -3px 0 #94a3b8" }}
        >
          <span className="flex flex-col leading-tight">
            <span className="text-[12px] font-bold">🛡️ 결속 {braceLevel}/{BRACE_MAX}</span>
            <span className="text-[10px] opacity-70">기절 {(stunTicks(braceLevel) / 20).toFixed(1)}초</span>
          </span>
          <span className="font-mono text-[10px] opacity-80">{braceLevel >= BRACE_MAX ? "MAX" : `🪙${braceCost(braceLevel)}`}</span>
        </button>
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
