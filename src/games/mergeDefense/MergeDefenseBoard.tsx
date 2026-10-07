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
  LOAD_LIMIT,
  MAX_GRADE,
  MAX_UPGRADE,
  PREP_TICKS,
  ROWS,
  SEND_EVERY,
  TICK_MS,
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
  upgradeCost,
  type Action,
  type MergeDefenseState,
  type SeatIndex,
} from "./engine";
import { drawBoard, drawFx, SEAT_COLORS, type Fx } from "./render";
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

const MAX_FX = 260;

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
  const selectedRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const bannerKey = useRef(0);

  useCanvasSize(mainRef);

  const me = state.boards[mySeat];
  const firstAliveOther = state.boards.findIndex((b, i) => i !== mySeat && b.alive);
  const resolvedView = me.alive || firstAliveOther < 0 ? mySeat : firstAliveOther;
  const viewRef = useRef(resolvedView);
  useEffect(() => {
    viewRef.current = resolvedView;
  }, [resolvedView]);
  const others = state.boards.map((_, i) => i).filter((i) => i !== resolvedView);

  // A selection goes stale once that slot empties (merged away, etc.).
  const selected = rawSelected !== null && me.units[rawSelected] ? rawSelected : null;
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
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

    if (state.tick !== prev.tick && board) {
      for (const shot of board.shots) {
        if (shot.pts.length < 2) continue;
        fx.push({ type: "shot", kind: shot.kind, grade: shot.grade, from: slotCenter(shot.slot), pts: shot.pts, t0: now, dur: shot.kind === "mage" ? 380 : 220 });
      }
      if (prevBoard && prevBoard.mobs.length > 0) {
        const alive = new Set(board.mobs.map((m) => m.id));
        for (const m of prevBoard.mobs) {
          if (alive.has(m.id)) continue;
          const p = pathPoint(m.trav);
          const color = m.kind === "boss" ? "#c084fc" : m.kind === "elite" ? "#f87171" : "#bef264";
          fx.push({ type: "spark", x: p.x, y: p.y, color, t0: now, dur: m.kind === "boss" ? 900 : 380, seed: m.id });
          if (m.kind === "boss") fx.push({ type: "ring", x: p.x, y: p.y, color: "#facc15", r0: 10, r1: 70, t0: now, dur: 700 });
        }
      }
    }

    const fresh = state.events.filter((e) => e.id > lastEventIdRef.current);
    if (fresh.length > 0) lastEventIdRef.current = fresh[fresh.length - 1].id;
    const audible = typeof document !== "undefined" && document.visibilityState === "visible";
    for (const ev of fresh) {
      if (ev.type === "wave") {
        if (ev.boss) {
          showBanner({ text: `👑 WAVE ${ev.wave} — 보스 등장!`, sub: "보스 1마리 = 몬스터 15마리 무게", tone: "boss" });
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
          if (ev.lucky) fx.push({ type: "text", x: c.x, y: c.y - 20, text: "행운! 희귀", color: GRADE_COLORS[2], t0: now, dur: 1100, size: 15 });
          if (mine && audible) audio.playSummon(ev.lucky);
          break;
        }
        case "merge": {
          const c = slotCenter(ev.slot);
          fx.push({ type: "spark", x: c.x, y: c.y, color: GRADE_COLORS[ev.grade], t0: now, dur: 650, seed: ev.id });
          fx.push({ type: "ring", x: c.x, y: c.y, color: GRADE_COLORS[ev.grade], r0: 10, r1: 46, t0: now, dur: 550 });
          fx.push({ type: "text", x: c.x, y: c.y - 22, text: GRADE_NAMES[ev.grade], color: GRADE_COLORS[ev.grade], t0: now, dur: 1000, size: ev.grade >= 4 ? 20 : 15 });
          if (mine && audible) audio.playMerge(ev.grade);
          break;
        }
        case "gamble": {
          const c = slotCenter(ev.slot);
          fx.push({ type: "spark", x: c.x, y: c.y, color: GRADE_COLORS[ev.grade], t0: now, dur: 800, seed: ev.id });
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
        case "boss-kill":
          fx.push({ type: "text", x: BOARD_W / 2, y: BOARD_H / 2 - 10, text: "보스 처치! +💎2", color: "#facc15", t0: now, dur: 1500, size: 22 });
          if (mine && audible) audio.playBossKill();
          break;
      }
    }

    // Drop finished effects; cap the list.
    const live = fx.filter((f) => now - f.t0 < f.dur);
    fxRef.current = live.length > MAX_FX ? live.slice(live.length - MAX_FX) : live;
  }, [state, mySeat, names]);

  // Clear banners after a moment.
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner((b) => (b?.key === banner.key ? null : b)), banner.tone === "boss" ? 2600 : 1900);
    return () => window.clearTimeout(t);
  }, [banner]);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const s = stateRef.current;
      const alpha = Math.min(1, (now - stateAtRef.current) / TICK_MS);
      const view = viewRef.current;
      const main = mainRef.current;
      if (main) {
        const ctx = main.getContext("2d");
        if (ctx) {
          const k = main.width / BOARD_W;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, main.width, main.height);
          ctx.setTransform(k, 0, 0, k, 0, 0);
          const board = s.boards[view];
          const sel = view === mySeat ? selectedRef.current : null;
          const highlight = new Set<number>();
          if (sel !== null) board.units.forEach((_, i) => canMerge(board, sel, i) && highlight.add(i));
          drawBoard(ctx, board, { alpha: s.phase === "playing" ? alpha : 0, now, selected: sel, highlight, dropTarget: dropTargetRef.current });
          drawFx(ctx, fxRef.current, now);
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
        drawBoard(ctx, s.boards[seat], { alpha: s.phase === "playing" ? alpha : 0, now, mini: true });
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
    const next = slot !== null && slot !== from && canMerge(me, from, slot) ? slot : null;
    if (next !== dropTargetRef.current) setDropTarget(next);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    const from = dragFromRef.current;
    dragFromRef.current = null;
    setDropTarget(null);
    const { x, y } = toLogical(e);
    const slot = slotAt(x, y);
    // Drag onto a matching unit → merge.
    if (from !== null && slot !== null && slot !== from) {
      if (canMerge(me, from, slot)) {
        onAction({ type: "merge", a: from, b: slot });
        setSelected(null);
      }
      return;
    }
    // Tap logic.
    if (slot === null || !me.units[slot]) {
      setSelected(null);
      return;
    }
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

  const load = fieldLoad(me);
  const loadPct = Math.min(1, load / LOAD_LIMIT);
  const cost = summonCost(me);
  const freeSlots = me.units.filter((u) => !u).length;
  const pairs = useMemo(() => mergePairs(me), [me]);
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
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2 pb-20 select-none sm:pb-0">
      <style>{`@keyframes md-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}`}</style>
      {/* Wave HUD */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">{state.wave === 0 ? "준비 시간" : `🌊 WAVE ${state.wave}`}</span>
        <span className={nextIsBoss ? "font-semibold text-amber-300 light:text-amber-600" : ""}>
          {nextIsBoss ? "👑 보스" : "다음 웨이브"} {Math.ceil(waveLeftTicks / (1000 / TICK_MS))}초
        </span>
        <button onClick={() => setRulebookOpen(true)} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/30 light:border-slate-300">
          📖 룰
        </button>
      </div>

      {/* Opponents */}
      <div className="flex justify-center gap-2">
        {others.map((seat) => {
          const b = state.boards[seat];
          const l = Math.min(1, fieldLoad(b) / LOAD_LIMIT);
          return (
            <div key={seat} className="flex w-[min(32%,170px)] flex-col gap-0.5">
              <div className="flex items-center gap-1 text-[11px] text-white/70 light:text-slate-600">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEAT_COLORS[seat] }} />
                <span className="truncate">{names[seat]}</span>
                {seat === mySeat && <span className="text-white/40">(나)</span>}
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
            </div>
          );
        })}
      </div>

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
        <div className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-white/60 light:text-slate-500">몬스터</span>
          <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <div
              className={`h-full transition-[width] duration-200 ${loadPct > 0.75 ? "animate-pulse bg-rose-500" : loadPct > 0.5 ? "bg-amber-400" : "bg-emerald-400"}`}
              style={{ width: `${loadPct * 100}%` }}
            />
          </div>
          <span className={`w-12 text-right font-mono font-bold ${loadPct > 0.75 ? "text-rose-300 light:text-rose-600" : "text-white light:text-slate-900"}`}>
            {load}/{LOAD_LIMIT}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm font-bold text-white light:text-slate-900">
          <span>🪙 {Math.floor(me.gold)}</span>
          <span>💎 {me.gems}</span>
          <span className="text-xs font-semibold text-white/60 light:text-slate-500" title="이만큼 처치하면 다음 상대에게 정예 몬스터를 보내요">
            🔥 {me.sendMeter}/{SEND_EVERY}
          </span>
          <span className="text-xs font-semibold text-white/60 light:text-slate-500">⚔️ {me.kills}</span>
        </div>
      </div>

      {selectedUnit && (
        <p className="text-center text-xs text-white/70 light:text-slate-600">
          <span style={{ color: GRADE_COLORS[selectedUnit.grade] }}>{GRADE_NAMES[selectedUnit.grade]}</span> {UNITS[selectedUnit.kind].emoji}{" "}
          {UNITS[selectedUnit.kind].name} — {UNITS[selectedUnit.kind].desc}
          {selectedUnit.grade < MAX_GRADE ? " · 같은 유닛을 눌러 합성" : " · 최고 등급"}
        </p>
      )}

      {/* Actions */}
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
        <button
          disabled={!interactive || me.gold < cost || freeSlots === 0}
          onClick={() => onAction({ type: "summon" })}
          className="rounded-xl bg-gradient-to-b from-amber-400 to-orange-600 py-3 text-sm font-black text-white shadow-[0_4px_0_#9a3412] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40"
        >
          🎲 소환 <span className="font-mono">🪙{cost}</span>
          {freeSlots === 0 && <span className="block text-[10px] font-semibold">자리 없음 — 합성하세요</span>}
        </button>
        <button
          disabled={!interactive || me.gems < 1 || freeSlots === 0}
          onClick={() => onAction({ type: "gamble" })}
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

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
