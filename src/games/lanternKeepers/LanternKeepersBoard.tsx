"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { Loading3D, ViewToggle, preferLowDetail, useBoardView } from "@/games/shared/three/viewPref";
import {
  FLARES_PER_PLAYER,
  MOVE_MAX,
  PINGS_PER_ROUND,
  T_RAVINE,
  T_TREE,
  T_UNKNOWN,
  WORDS_PER_ROUND,
  allChecked,
  forestName,
  litBy,
  monsterCell,
  neighbors4,
  plannedCells,
  step,
  type EngineAction,
  type GameState,
  type LogEvent,
  type Seat,
} from "./engine";
import { forestById } from "./forest";
import { DIR_ARROW, LANTERNS, PING_MARKS, WORDS, colorTag, lantern, pingMark, type Dir, type PingMark } from "./show";
import { getLanternSound, lanternCues } from "./lanternSound";
import type { SceneFx } from "./three/ForestScene3D";

const ForestScene3D = dynamic(() => import("./three/ForestScene3D"), { ssr: false, loading: () => <Loading3D label="숲을 밝히는 중…" /> });

export interface LanternKeepersBoardProps {
  /** 반드시 lanternView(state, viewerSeat) — 이 좌석이 볼 수 있는 것만 */
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

/** 걸음 애니메이션 한 칸 */
const STEP_MS = 420;

const EVENT_FX: Record<LogEvent["kind"], { icon: string; sound: string }> = {
  trap: { icon: "💥 함정!", sound: "trap" },
  disarm: { icon: "🛠️ 해제", sound: "disarm" },
  fall: { icon: "💧 풍덩!", sound: "fall" },
  bridge: { icon: "🌉 숨은 다리!", sound: "bridge" },
  bite: { icon: "👹 물렸다!", sound: "bite" },
  banish: { icon: "✨ 괴물 퇴치!", sound: "banish" },
  shard: { icon: "💠 빛 조각!", sound: "shard" },
  jar: { icon: "🫙 반딧불 병", sound: "jar" },
  flare: { icon: "🔆 밝히기", sound: "flare" },
  altar: { icon: "🌅 제단 도착", sound: "altar" },
  stunned: { icon: "💫 기절", sound: "stunned" },
};

function eventText(e: LogEvent, names: Record<Seat, string>): string {
  const who = `${lantern(e.seat).glyph}${names[e.seat] ?? `${e.seat + 1}번`}`;
  const tag = e.color >= 0 ? colorTag(e.color) : "";
  switch (e.kind) {
    case "trap":
      return `💥 ${who} — ${tag} 함정을 밟았어요 (♥-1)`;
    case "disarm":
      return `🛠️ ${who} — 자기 색 함정을 해제했어요`;
    case "fall":
      return `💧 ${who} — 다리 없는 골짜기에 빠졌어요 (♥-1)`;
    case "bridge":
      return `🌉 ${who} — ${tag} 다리를 건넜어요 (이제 모두에게 보여요)`;
    case "bite":
      return `👹 ${who} — ${tag} 괴물에게 물렸어요 (♥-1, 다음 라운드 기절)`;
    case "banish":
      return `✨ ${who} — ${tag} 괴물을 빛으로 물리쳤어요`;
    case "shard":
      return `💠 ${who} — 빛 조각을 주웠어요`;
    case "jar":
      return `🫙 ${who} — 반딧불 병을 주웠어요`;
    case "flare":
      return `🔆 ${who} — 등불을 크게 밝혔어요`;
    case "altar":
      return `🌅 ${who} — 새벽 제단에 섰어요`;
    case "stunned":
      return `💫 ${who} — 기절해서 쉬었어요`;
  }
}

/** 칸까지 MOVE_MAX걸음 안의 최단 길 (나무·모르는 칸 제외). 없으면 null */
function pathWithin(view: GameState, from: number, to: number): Dir[] | null {
  if (from === to) return [];
  const prev = new Map<number, number>([[from, -1]]);
  let frontier = [from];
  for (let d = 0; d < MOVE_MAX && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const n of neighbors4(view.w, view.h, c)) {
        if (prev.has(n) || view.tiles[n] === T_TREE || view.tiles[n] === T_UNKNOWN) continue;
        prev.set(n, c);
        next.push(n);
      }
    }
    if (prev.has(to)) break;
    frontier = next;
  }
  if (!prev.has(to)) return null;
  const cells: number[] = [];
  for (let c = to; c !== from; c = prev.get(c)!) cells.unshift(c);
  const out: Dir[] = [];
  let at = from;
  for (const c of cells) {
    const d: Dir = c === at - view.w ? "N" : c === at + view.w ? "S" : c === at + 1 ? "E" : "W";
    out.push(d);
    at = c;
  }
  return out;
}

// ------------------------------------------------------------------ 2D 지도

function Grid2D({
  view,
  viewerSeat,
  displayPos,
  myLit,
  anyLit,
  draft,
  fx,
  showChecked,
  onCellTap,
}: {
  view: GameState;
  viewerSeat: Seat;
  displayPos: number[];
  myLit: Set<number>;
  anyLit: Set<number>;
  draft: number[];
  fx: SceneFx[];
  showChecked: boolean;
  onCellTap: (c: number) => void;
}) {
  const planCells = useMemo(() => {
    const m = new Map<number, number[]>();
    view.plans.forEach((_, seat) => {
      if (seat === viewerSeat || view.phase !== "plan") return;
      for (const c of plannedCells(view, seat)) m.set(c, [...(m.get(c) ?? []), seat]);
    });
    return m;
  }, [view, viewerSeat]);
  const cells = [];
  for (let c = 0; c < view.w * view.h; c++) {
    const t = view.tiles[c];
    let cls = "bg-black";
    let base = "";
    if (t === T_TREE) {
      cls = anyLit.has(c) ? "bg-[#14381f]" : "bg-[#0b1a12]";
      base = "🌲";
    } else if (t === T_RAVINE) {
      cls = anyLit.has(c) ? "bg-[#10203a]" : "bg-[#0a1222]";
      base = view.noBridge.includes(c) ? "✖" : "≈";
    } else if (t !== T_UNKNOWN) {
      cls = myLit.has(c) ? "bg-[#6b573b]" : anyLit.has(c) ? "bg-[#463c2b]" : "bg-[#1f2532]";
      if (showChecked && allChecked(view, c)) cls += " ring-1 ring-inset ring-emerald-400/50";
    }
    const bridge = view.bridges.find((b) => b.cell === c);
    const trap = view.traps.find((x) => x.cell === c);
    const monsters = view.monsters.filter((m) => !m.gone && monsterCell(m) === c);
    const route = view.monsters.find((m) => !m.gone && m.path.length > 1 && m.path.includes(c));
    const shard = view.shards.find((s) => s.cell === c && !s.taken);
    const jar = view.jars.find((s) => s.cell === c && !s.taken);
    const pings = view.pings.filter((p) => p.cell === c);
    const here = displayPos.map((p, s) => (p === c ? s : -1)).filter((s) => s >= 0);
    const myStep = draft.indexOf(c);
    const others = planCells.get(c) ?? [];
    const missing = showChecked && t !== T_UNKNOWN && t !== T_TREE ? LANTERNS.slice(0, view.seatCount).filter((_, s) => !(view.checked[c] & (1 << s))) : [];
    const pop = fx.find((f) => f.cell === c);
    cells.push(
      <button
        key={c}
        type="button"
        onClick={() => onCellTap(c)}
        className={`relative flex aspect-square items-center justify-center overflow-hidden text-[clamp(7px,2.4vw,14px)] leading-none ${cls}`}
        aria-label={`칸 ${c % view.w + 1},${Math.floor(c / view.w) + 1}`}
      >
        {base && <span className={t === T_TREE ? "opacity-70" : "text-sky-300/70"}>{base}</span>}
        {route && !monsters.length && <span className="absolute inset-[30%] rounded-full opacity-40" style={{ background: lantern(route.color).hex }} />}
        {bridge && (
          <span className="absolute inset-x-[8%] inset-y-[30%] flex items-center justify-center rounded-sm bg-[#8b5e34] text-[0.8em] font-black" style={{ boxShadow: `0 0 0 2px ${lantern(bridge.color).hex}`, color: lantern(bridge.color).hex }}>
            {lantern(bridge.color).glyph}
          </span>
        )}
        {trap && (
          <span className={`absolute inset-[14%] flex items-center justify-center rounded-full border-2 text-[0.8em] font-black ${trap.state === "armed" ? "" : "opacity-50"}`} style={{ borderColor: trap.state === "armed" ? lantern(trap.color).hex : "#64748b", color: lantern(trap.color).hex }}>
            {trap.state === "armed" ? lantern(trap.color).glyph : trap.state === "sprung" ? "💥" : "✓"}
          </span>
        )}
        {shard && <span className="absolute">💠</span>}
        {jar && <span className="absolute">🫙</span>}
        {c === view.altar && <span className="absolute">🌅</span>}
        {monsters.map((m) => (
          <span key={m.id} className="absolute flex items-center justify-center">
            👹<span className="absolute -right-[40%] -bottom-[30%] text-[0.65em] font-black" style={{ color: lantern(m.color).hex }}>{lantern(m.color).glyph}</span>
          </span>
        ))}
        {others.length > 0 && <span className="absolute bottom-[8%] left-[8%] h-[22%] w-[22%] rounded-full" style={{ background: lantern(others[0]).hex }} />}
        {myStep >= 0 && <span className="absolute top-[6%] left-[8%] text-[0.7em] font-black text-yellow-300">{myStep + 1}</span>}
        {here.length > 0 && (
          <span className="absolute inset-[10%] flex flex-wrap items-center justify-center gap-px">
            {here.slice(0, 4).map((s) => (
              <span
                key={s}
                className={`flex items-center justify-center rounded-full text-[0.7em] font-black text-slate-950 ${s === viewerSeat ? "h-[80%] w-[80%] ring-2 ring-yellow-300" : here.length > 1 ? "h-[46%] w-[46%]" : "h-[70%] w-[70%]"}`}
                style={{ background: lantern(s).hex }}
              >
                {lantern(s).glyph}
              </span>
            ))}
          </span>
        )}
        {pings.length > 0 && (
          <span className="absolute -top-px -right-px rounded-bl bg-black/70 px-px text-[0.75em]" style={{ boxShadow: `inset 0 0 0 1px ${lantern(pings[0].seat).hex}` }}>
            {pingMark(pings[pings.length - 1].mark).icon}
          </span>
        )}
        {missing.length > 0 && missing.length < view.seatCount && (
          <span className="absolute bottom-0 left-0 flex gap-px text-[0.5em] leading-none">
            {missing.map((l) => (
              <span key={l.id} style={{ color: l.hex }}>
                {l.glyph}
              </span>
            ))}
          </span>
        )}
        {pop && <span className="absolute z-10 animate-bounce rounded bg-black/80 px-0.5 text-[0.7em] whitespace-nowrap text-yellow-200">{pop.icon.split(" ")[0]}</span>}
      </button>,
    );
  }
  return (
    <div className="mx-auto w-full overflow-hidden rounded-xl border border-black/60" style={{ maxWidth: view.w * 44 }}>
      <div className="grid gap-px bg-black" style={{ gridTemplateColumns: `repeat(${view.w}, minmax(0, 1fr))` }}>
        {cells}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 보드

export default function LanternKeepersBoard(props: LanternKeepersBoardProps) {
  const { state: view, viewerSeat, names, deadlineMs, nowMs, onAction, onGameEnd } = props;
  const board = useBoardView("lantern-keepers-view");
  const [lowDetail] = useState(preferLowDetail);
  const [zoom, setZoom] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const [helpOpen, setHelpOpen] = useState(view.round === 1);
  const [showChecked, setShowChecked] = useState(false);
  const [mark, setMark] = useState<PingMark | "clear" | null>(null);
  const me = view.players[viewerSeat];
  const myPlan = view.plans[viewerSeat];
  const ended = view.phase === "ended";
  const stunned = (me?.stunned ?? 0) > 0;
  const ready = myPlan?.ready === true;

  // ---- 소리
  useSuiteBgm(getLanternSound, !ended, view.maxRounds - view.round <= 4 ? 1 : 0);
  const classify = useMemo(() => lanternCues(viewerSeat), [viewerSeat]);
  useSoundCues(view, getLanternSound, classify);

  // ---- 내 계획 초안 (라운드마다 새로)
  const [draft, setDraft] = useState<{ round: number; steps: Dir[]; flare: boolean }>(() => ({ round: view.round, steps: myPlan?.steps ?? [], flare: myPlan?.flare ?? false }));
  const cur = useMemo(
    () => (draft.round === view.round ? draft : { round: view.round, steps: myPlan?.planned ? myPlan.steps : [], flare: myPlan?.planned ? myPlan.flare : false }),
    [draft, view.round, myPlan],
  );
  const revRef = useRef(0);
  const nextRev = () => {
    revRef.current = Math.max(revRef.current + 1, Date.now());
    return revRef.current;
  };
  const planTimer = useRef<number | null>(null);
  const pushPlan = useCallback(
    (steps: Dir[], flare: boolean) => {
      setDraft({ round: view.round, steps, flare });
      if (planTimer.current !== null) window.clearTimeout(planTimer.current);
      const round = view.round;
      planTimer.current = window.setTimeout(() => {
        planTimer.current = null;
        onAction({ type: "PLAN", seat: viewerSeat, round, steps, flare, rev: nextRev() });
      }, 180);
    },
    [onAction, view.round, viewerSeat],
  );
  useEffect(
    () => () => {
      if (planTimer.current !== null) window.clearTimeout(planTimer.current);
    },
    [],
  );
  const canEdit = view.phase === "plan" && !stunned && !ready;
  const draftCells = useMemo(() => (view.phase === "plan" ? plannedCells(view, viewerSeat, cur.steps) : []), [view, viewerSeat, cur.steps]);

  const addStep = useCallback(
    (d: Dir) => {
      if (!canEdit || cur.steps.length >= MOVE_MAX || !me) return;
      const from = draftCells.length > 0 ? draftCells[draftCells.length - 1] : me.pos;
      const to = step(view.w, view.h, from, d);
      if (to < 0 || view.tiles[to] === T_TREE || view.tiles[to] === T_UNKNOWN) return;
      getLanternSound().play("step");
      pushPlan([...cur.steps, d], cur.flare);
    },
    [canEdit, cur, draftCells, me, view, pushPlan],
  );
  const undo = () => canEdit && cur.steps.length > 0 && pushPlan(cur.steps.slice(0, -1), cur.flare);
  const clear = () => canEdit && pushPlan([], cur.flare);
  const toggleFlare = () => canEdit && (me?.flares ?? 0) > 0 && pushPlan(cur.steps, !cur.flare);
  const go = () => {
    if (view.phase !== "plan" || stunned) return;
    if (planTimer.current !== null) {
      window.clearTimeout(planTimer.current);
      planTimer.current = null;
    }
    getLanternSound().unlock();
    getLanternSound().play("ready");
    if (ready) onAction({ type: "READY", seat: viewerSeat, round: view.round, ready: false, rev: nextRev() });
    else onAction({ type: "TURN", seat: viewerSeat, round: view.round, steps: cur.steps, flare: cur.flare, rev: nextRev() });
  };
  const sendWord = (w: number) => view.phase === "plan" && view.wordsLeft[viewerSeat] > 0 && onAction({ type: "SIGNAL", seat: viewerSeat, round: view.round, word: w });

  const onCellTap = useCallback(
    (c: number) => {
      if (view.phase !== "plan" || !me) return;
      if (mark) {
        if (view.explored[c] !== "1") return;
        const mine = view.pings.find((p) => p.seat === viewerSeat && p.cell === c);
        if (mark !== "clear" && !mine && view.pingsLeft[viewerSeat] <= 0) return;
        onAction({ type: "SIGNAL", seat: viewerSeat, round: view.round, ping: { cell: c, mark } });
        getLanternSound().play("ping");
        return;
      }
      if (!canEdit) return;
      const path = pathWithin(view, me.pos, c);
      if (path) pushPlan(path, cur.flare);
    },
    [view, me, mark, viewerSeat, onAction, canEdit, pushPlan, cur.flare],
  );

  // 키보드: 방향키/WASD 걸음, Backspace 되돌리기, Enter 출발
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const map: Record<string, Dir> = { ArrowUp: "N", ArrowDown: "S", ArrowLeft: "W", ArrowRight: "E", w: "N", s: "S", a: "W", d: "E", W: "N", S: "S", A: "W", D: "E" };
      const d = map[e.key];
      if (d) {
        e.preventDefault();
        addStep(d);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        undo();
      } else if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- 걸음 애니메이션 (지난 해결)
  const moves = view.lastMoves;
  const [anim, setAnim] = useState<{ round: number; t0: number } | null>(null);
  const [clock, setClock] = useState(0);
  const seenRound = useRef<number | null>(moves?.round ?? null);
  useEffect(() => {
    if (!moves || seenRound.current === moves.round) return;
    seenRound.current = moves.round;
    setAnim({ round: moves.round, t0: Date.now() });
  }, [moves]);
  const totalSteps = moves ? Math.max(1, ...moves.paths.map((p) => p.length)) : 0;
  const animEnd = anim ? anim.t0 + (totalSteps + 1) * STEP_MS + 400 : 0;
  useEffect(() => {
    if (!anim) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now > animEnd + 1800) setAnim(null);
    }, 90);
    return () => window.clearInterval(id);
  }, [anim, animEnd]);
  const animStep = anim ? Math.floor((clock - anim.t0) / STEP_MS) : Infinity;
  const animating = anim !== null && clock < animEnd;
  const displayPos = view.players.map((p, s) => {
    if (!animating || !moves) return p.pos;
    const path = moves.paths[s] ?? [];
    if (animStep <= 0) return moves.from[s] ?? p.pos;
    if (animStep > path.length) return p.pos;
    return path[animStep - 1];
  });
  // 사건 FX·소리 — 걸음 시각에 맞춰
  const roundEvents = useMemo(() => (moves ? view.log.filter((e) => e.round === moves.round) : []), [view.log, moves]);
  const eventAt = (e: LogEvent) => (e.kind === "stunned" ? 0 : e.step + 1);
  const fx: SceneFx[] = [];
  if (anim) {
    roundEvents.forEach((e, i) => {
      const at = eventAt(e);
      if (animStep >= at && clock - anim.t0 < (at + 4) * STEP_MS) fx.push({ key: `${e.round}-${i}`, cell: e.cell, icon: EVENT_FX[e.kind].icon });
    });
  }
  const fired = useRef(new Set<string>());
  useEffect(() => {
    if (!anim) return;
    roundEvents.forEach((e, i) => {
      const key = `${e.round}-${i}`;
      if (animStep < (e.kind === "stunned" ? 0 : e.step + 1) || fired.current.has(key)) return;
      fired.current.add(key);
      getLanternSound().play(EVENT_FX[e.kind].sound);
    });
  }, [anim, animStep, roundEvents]);
  const endSoundRef = useRef(false);
  useEffect(() => {
    if (!ended || endSoundRef.current || animating) return;
    endSoundRef.current = true;
    getLanternSound().play(view.outcome?.won ? "win" : "lose");
  }, [ended, animating, view.outcome]);

  // ---- 빛
  const myLit = useMemo(() => (me ? litBy(view, viewerSeat) : new Set<number>()), [view, viewerSeat, me]);
  const anyLit = useMemo(() => {
    const s = new Set<number>();
    for (let seat = 0; seat < view.seatCount; seat++) for (const c of litBy(view, seat)) s.add(c);
    return s;
  }, [view]);

  const forest = forestById(view.options.forest);
  const shardsTaken = view.shards.filter((s) => s.taken).length;
  const jarsTaken = view.jars.filter((s) => s.taken).length;
  const roundsLeft = view.maxRounds - view.round + 1;
  const secondsLeft = deadlineMs !== null ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)) : null;
  const myColor = lantern(viewerSeat);
  const draftWarn = draftCells.some((c) => view.tiles[c] === T_RAVINE && !view.bridges.some((b) => b.cell === c) && !view.pings.some((p) => p.cell === c && (p.mark === "bridge" || p.mark === "safe")));
  const draftDanger = draftCells.some((c) => view.pings.some((p) => p.cell === c && (p.mark === "danger" || p.mark === "monster")));
  const lastWords = view.words.filter((w) => w.round >= view.round - 1).slice(-5);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-bold text-white">
          🏮 등불 지기 · {forestName(view)}
        </span>
        <span className="text-xs text-white/60">
          나는 <b style={{ color: myColor.hex }}>{myColor.glyph} {myColor.name} 등불</b> — {myColor.name}({myColor.shape}) 물건만 내 빛에 보여요
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <SuiteSoundHud suite={getLanternSound} icon="🏮" label="Night Forest" preview="shard" />
        <button type="button" onClick={() => setHelpOpen((v) => !v)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30">
          📋 규칙
        </button>
        <ViewToggle board={board} />
      </div>
    </div>
  );

  const hud = (
    <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
      <div className="rounded-lg bg-white/5 px-2 py-1.5">
        <div className="text-white/50">🛢️ 남은 등유</div>
        <div className={`font-bold ${roundsLeft <= 4 ? "text-rose-300" : "text-amber-200"}`}>
          {ended ? "—" : `${roundsLeft}라운드`} <span className="font-normal text-white/40">/ {view.maxRounds}</span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-white/10">
          <div className="h-1 rounded-full bg-amber-400" style={{ width: `${Math.max(0, (roundsLeft / view.maxRounds) * 100)}%` }} />
        </div>
      </div>
      <div className="rounded-lg bg-white/5 px-2 py-1.5">
        <div className="text-white/50">♥ 생명 (팀)</div>
        <div className="font-bold tracking-wider text-rose-300" aria-label={`생명 ${view.hearts}/${view.maxHearts}`}>
          {"♥".repeat(view.hearts)}
          <span className="text-white/20">{"♥".repeat(Math.max(0, view.maxHearts - view.hearts))}</span>
        </div>
      </div>
      <div className="rounded-lg bg-white/5 px-2 py-1.5">
        <div className="text-white/50">💠 빛 조각</div>
        <div className="font-bold text-sky-200">
          {shardsTaken} / {view.need} {shardsTaken >= view.need && <span className="text-amber-300">→ 🌅 제단으로!</span>}
        </div>
      </div>
      <div className="rounded-lg bg-white/5 px-2 py-1.5">
        <div className="text-white/50">🫙 반딧불 · 🔆 · ⏱</div>
        <div className="font-bold text-yellow-200">
          {jarsTaken}/{forest.jars} · 🔆{me?.flares ?? 0}/{FLARES_PER_PLAYER} · {secondsLeft === null ? "∞" : `${secondsLeft}s`}
        </div>
      </div>
    </div>
  );

  const team = (
    <div className="flex flex-wrap gap-1.5">
      {view.players.map((p, s) => {
        const l = lantern(s);
        const plan = view.plans[s];
        const status = ended ? (p.pos === view.altar ? "🌅" : "") : p.stunned > 0 ? "💫 기절" : plan.ready ? "✅ 출발" : plan.planned ? "🗺️ 계획 중" : "⌛";
        return (
          <span key={s} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${s === viewerSeat ? "border-yellow-300/70" : "border-white/15"}`} style={{ background: `${l.hex}22` }}>
            <b style={{ color: l.hex }}>{l.glyph}</b>
            <span className="max-w-[6.5rem] truncate text-white/90">{s === viewerSeat ? "나" : (names[s] ?? `${s + 1}번`)}</span>
            <span className="text-white/60">{status}</span>
            {p.pos === view.altar && !ended && <span>🌅</span>}
            {p.flaring && <span title="이번 라운드 빛이 넓어요">🔆</span>}
          </span>
        );
      })}
    </div>
  );

  const help = helpOpen && (
    <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-50">
      <p className="break-keep">
        <b>목표</b> — 💠 빛 조각 {view.need}개를 모두 줍고, 모두 🌅 새벽 제단에 서면 탈출! 등유({view.maxRounds}라운드)나 ♥가 바닥나면 실패.
      </p>
      <p className="mt-1 break-keep">
        <b>보이는 것</b> — 다리·함정·괴물은 색이 있어요. <b>그 색 등불 빛 안에서만</b> 보여요. 지형(나무·길·골짜기)과 빛 조각은 누구 빛이든 한 번 비추면 모두의 지도에 남아요.
      </p>
      <p className="mt-1 break-keep">
        <b>라운드</b> — 모두 동시에 최대 {MOVE_MAX}걸음을 정하면(동료에게 그대로 보여요) 📍 핑 {PINGS_PER_ROUND}개·💬 한마디 {WORDS_PER_ROUND}개로 신호를 보내고 <b>출발</b>. 모두 출발하면 한 걸음씩 동시에 움직여요.
      </p>
      <p className="mt-1 break-keep">
        💥 남의 색 함정 ♥-1 (내 색은 밟으면 해제) · 💧 다리 없는 골짜기 ♥-1 · 👹 괴물에게 물리면 ♥-1·한 칸 뒤로·다음 라운드 기절 · ✨ 괴물과 <b>같은 색 등불이 바로 옆에서 멈추면</b> 퇴치 · 🔆 밝히기(1인 {FLARES_PER_PLAYER}번)는 다음 라운드 빛이 넓어져요.
      </p>
      <p className="mt-1 break-keep text-amber-200/80">💡 🔍 확인 표시를 켜면 아직 어떤 색이 안 비춘 칸인지 문양으로 보여요. 모든 색이 비춘 길(초록 테두리)이 안전한 길이에요.</p>
    </div>
  );

  const stage =
    board.view === "3d" ? (
      <div className="relative z-10 w-full overflow-hidden rounded-2xl border border-black/60" style={{ aspectRatio: zoom ? "1" : String((view.w + 0.6) / (view.h * Math.sin((62 * Math.PI) / 180) + 1.8)), minHeight: 260, maxHeight: "68vh" }}>
        <ForestScene3D
          view={view}
          viewerSeat={viewerSeat}
          displayPos={displayPos}
          myLit={myLit}
          anyLit={anyLit}
          draft={draftCells}
          names={names}
          fx={fx}
          showChecked={showChecked}
          lowDetail={lowDetail}
          focus={zoom && me ? displayPos[viewerSeat] : null}
          onCellTap={onCellTap}
        />
        <button type="button" onClick={() => setZoom((z) => !z)} className="absolute top-2 right-2 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur hover:bg-black/75">
          {zoom ? "🗺️ 전체 보기" : "🔍 내 등불 확대"}
        </button>
        {mark && (
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] whitespace-nowrap text-yellow-200">
            {mark === "clear" ? "🧽 지울 내 핑을 누르세요" : `${pingMark(mark).icon} ${pingMark(mark).label} — 표시할 칸을 누르세요`}
          </span>
        )}
      </div>
    ) : (
      <Grid2D view={view} viewerSeat={viewerSeat} displayPos={displayPos} myLit={myLit} anyLit={anyLit} draft={draftCells} fx={fx} showChecked={showChecked} onCellTap={onCellTap} />
    );

  const dirBtn = (d: Dir, label: string) => (
    <button
      type="button"
      onClick={() => addStep(d)}
      disabled={!canEdit || cur.steps.length >= MOVE_MAX}
      aria-label={`${label} 한 걸음`}
      className="flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-lg font-bold text-white select-none active:bg-white/25 disabled:opacity-30"
    >
      {DIR_ARROW[d]}
    </button>
  );

  const controls = view.phase === "plan" && (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
      {stunned ? (
        <p className="rounded-lg bg-violet-500/15 px-3 py-2 text-center text-xs text-violet-100">💫 괴물에게 물려 기절했어요 — 이번 라운드는 쉬어요. 신호는 보낼 수 있어요.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1 text-sm text-white">
            {Array.from({ length: MOVE_MAX }, (_, i) => (
              <span key={i} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-base font-bold ${cur.steps[i] ? "border-yellow-300/70 bg-yellow-300/15 text-yellow-100" : "border-white/10 text-white/25"}`}>
                {cur.steps[i] ? DIR_ARROW[cur.steps[i]] : i + 1}
              </span>
            ))}
            <button type="button" onClick={undo} disabled={!canEdit || cur.steps.length === 0} aria-label="한 걸음 되돌리기" className="ml-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs whitespace-nowrap text-white/70 disabled:opacity-30">
              ↶
            </button>
            <button type="button" onClick={clear} disabled={!canEdit || cur.steps.length === 0} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs whitespace-nowrap text-white/70 disabled:opacity-30">
              제자리
            </button>
            <span className="ml-auto text-[11px] whitespace-nowrap text-white/40">칸을 눌러도 길이 정해져요</span>
          </div>
          <div className="flex items-stretch gap-2">
            <div className="grid shrink-0 grid-cols-3 gap-1">
              <span />
              {dirBtn("N", "위로")}
              <span />
              {dirBtn("W", "왼쪽으로")}
              {dirBtn("S", "아래로")}
              {dirBtn("E", "오른쪽으로")}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <button
                type="button"
                onClick={toggleFlare}
                disabled={!canEdit || (me?.flares ?? 0) <= 0}
                aria-pressed={cur.flare}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold whitespace-nowrap disabled:opacity-30 ${cur.flare ? "border-amber-300 bg-amber-400/25 text-amber-100" : "border-white/15 text-white/70"}`}
              >
                🔆 밝히기 {cur.flare ? "ON" : ""} ({me?.flares ?? 0})
              </button>
              <button type="button" onClick={go} className={`flex-1 rounded-xl px-2 py-2 text-sm font-bold break-keep ${ready ? "border border-white/20 text-white/80" : "bg-amber-400 text-slate-900 hover:bg-amber-300"}`}>
                {ready ? "↩ 출발 취소" : cur.steps.length === 0 ? "✅ 제자리 출발" : `🏮 ${cur.steps.length}걸음 출발`}
              </button>
              {(draftWarn || draftDanger) && !ready && <p className="text-[11px] leading-snug text-rose-300">{draftDanger ? "⚠️ 동료가 위험 표시한 칸을 지나가요!" : "≈ 다리를 모르는 골짜기 — 빠지면 ♥-1"}</p>}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-white/50">📍 핑 {view.pingsLeft[viewerSeat]}/{PINGS_PER_ROUND}</span>
        {PING_MARKS.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            onClick={() => setMark((cur) => (cur === m.id ? null : m.id))}
            className={`rounded-lg border px-2 py-1 text-xs ${mark === m.id ? "border-yellow-300 bg-yellow-300/20 text-yellow-100" : "border-white/15 text-white/75"}`}
          >
            {m.icon} {m.label}
          </button>
        ))}
        <button type="button" onClick={() => setMark((cur) => (cur === "clear" ? null : "clear"))} className={`rounded-lg border px-2 py-1 text-xs ${mark === "clear" ? "border-yellow-300 bg-yellow-300/20 text-yellow-100" : "border-white/15 text-white/60"}`}>
          🧽 지우기
        </button>
        <button type="button" onClick={() => setShowChecked((v) => !v)} aria-pressed={showChecked} className={`ml-auto rounded-lg border px-2 py-1 text-xs ${showChecked ? "border-emerald-300 bg-emerald-400/15 text-emerald-100" : "border-white/15 text-white/60"}`}>
          🔍 확인 표시
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-white/50">💬 {view.wordsLeft[viewerSeat]}/{WORDS_PER_ROUND}</span>
        {WORDS.map((w, i) => (
          <button key={w} type="button" onClick={() => sendWord(i)} disabled={view.wordsLeft[viewerSeat] <= 0} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/80 hover:border-white/30 disabled:opacity-30">
            {w}
          </button>
        ))}
      </div>
    </div>
  );

  const recent = [...view.log].reverse().slice(0, 7);
  const log = (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/30 p-2 text-[11px] text-white/70">
      {lastWords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lastWords.map((w, i) => (
            <span key={i} className="rounded-full px-2 py-0.5" style={{ background: `${lantern(w.seat).hex}33`, color: lantern(w.seat).glow }}>
              {lantern(w.seat).glyph} {names[w.seat] ?? `${w.seat + 1}번`}: “{WORDS[w.word]}”
            </span>
          ))}
        </div>
      )}
      {recent.length === 0 ? <span className="text-white/40">아직 아무 일도 없었어요. 첫 걸음을 정해 보세요.</span> : recent.map((e, i) => <span key={i} className="break-keep">R{e.round} · {eventText(e, names)}</span>)}
    </div>
  );

  const outcome = view.outcome;
  const result = ended && outcome && !animating && (
    <div className={`flex flex-col gap-2 rounded-xl border p-4 ${outcome.won ? "border-amber-300/50 bg-amber-400/10" : "border-white/15 bg-white/5"}`}>
      <p className="text-lg font-bold text-white">{outcome.won ? "🌅 새벽이 밝았다 — 탈출 성공!" : outcome.reason === "hearts" ? "🕯️ 생명이 다했어요…" : "🛢️ 등유가 떨어져 등불이 꺼졌어요…"}</p>
      <p className="text-2xl tracking-widest" aria-label={`별 ${outcome.stars}개`}>
        {"⭐".repeat(outcome.stars)}
        <span className="opacity-25">{"⭐".repeat(3 - outcome.stars)}</span>
      </p>
      <ul className="text-xs leading-relaxed text-white/75">
        <li>{outcome.won ? "⭐" : "☆"} 탈출 성공 ({outcome.roundsUsed}/{view.maxRounds}라운드)</li>
        <li>{outcome.won && outcome.hearts * 2 >= view.maxHearts ? "⭐" : "☆"} 생명 절반 이상 지키기 (♥ {outcome.hearts}/{view.maxHearts})</li>
        <li>{outcome.won && outcome.jars >= forest.jars ? "⭐" : "☆"} 반딧불 병 모두 ({outcome.jars}/{forest.jars})</li>
      </ul>
      <div className="grid grid-cols-1 gap-1 text-[11px] text-white/70 sm:grid-cols-2">
        {view.players.map((_, s) => {
          const t = view.tally[s];
          return (
            <span key={s}>
              <b style={{ color: lantern(s).hex }}>{lantern(s).glyph}</b> {s === viewerSeat ? "나" : names[s]} — 💠{t.shards} 🛠️{t.disarms} ✨{t.banishes} 📍{t.pings} · 다친 횟수 {t.hurt}
            </span>
          );
        })}
      </div>
      <button type="button" onClick={onGameEnd} className="self-end rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900">
        결과 저장하고 나가기
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-[#070a12] p-2.5 text-white sm:p-3.5">
      {header}
      {help}
      {hud}
      {team}
      {stage}
      {controls}
      {result}
      {log}
      <p className="break-keep text-[11px] leading-relaxed text-white/45">
        🌲 나무 · ≈ 골짜기(다리가 있어야 건너요, ✖ = 다리 없음 확인) · 💠 빛 조각 · 🫙 반딧불 병 · 🌅 새벽 제단 · 색 문양 {LANTERNS.slice(0, view.seatCount).map((l) => `${l.glyph}${l.name}`).join(" ")} · 칸을 누르면 그 칸까지 길을 정해요
      </p>
    </div>
  );
}
