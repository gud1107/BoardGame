"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  BALLAST_STEP,
  canBallast,
  capsizesOf,
  checkPlace,
  COLS,
  computeRankings,
  FORECAST_LABEL,
  KIND_LABEL,
  limitOf,
  lostOf,
  passCost,
  pointsFor,
  previewBallast,
  previewPlace,
  TIERS,
  torqueOf,
  WAVE,
  type CargoState,
  type Crate,
  type EngineAction,
  type Outcome,
  type Seat,
} from "./engine";
import { useTimeline } from "./useTimeline";
import Ship2D, { type Ghost } from "./Ship2D";
import { cargoIntensity, cargoStackCues, getCargoStackSound } from "./cargoStackSound";
import RulebookModal from "./RulebookModal";
import { eventText, seatColor, seatMark, SEAT_NAMES } from "./labels";
import { webglAvailable } from "./three/webgl";

const Loading3D = () => <div className="flex h-full items-center justify-center bg-sky-200 text-xs text-sky-900/60">⚓ 배를 띄우는 중…</div>;
const ShipScene = dynamic(() => import("./three/ShipScene"), { ssr: false, loading: Loading3D });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-500 disabled:opacity-40";
const GHOSTBTN = "rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-white/80 transition hover:border-white/30 disabled:opacity-40 light:border-slate-300 light:text-slate-700";
const VIEW_KEY = "cargo-stack-view";
type View = "3d" | "3d-low" | "2d";

interface Props {
  state: CargoState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
}

function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export function SeatChip({ seat, size = 18 }: { seat: Seat; size?: number }) {
  return (
    <span
      aria-label={SEAT_NAMES[seat % SEAT_NAMES.length]}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-black text-white"
      style={{ width: size, height: size, background: seatColor(seat), fontSize: size * 0.58, textShadow: "0 1px 1px rgba(0,0,0,.6)" }}
    >
      {seatMark(seat)}
    </span>
  );
}

/** A dock crate drawn as its cells. */
function CrateCard({ crate, selected, disabled, onClick, label, small }: { crate: Crate | null; selected: boolean; disabled: boolean; onClick?: () => void; label: string; small?: boolean }) {
  if (!crate) {
    return <div className={`flex min-h-[74px] flex-1 items-center justify-center rounded-xl border border-dashed border-white/15 text-xs text-white/30 light:border-slate-300 light:text-slate-400 ${small ? "max-w-[92px]" : ""}`}>빈 자리</div>;
  }
  const kindCls = crate.kind === "steel" ? "bg-[repeating-linear-gradient(45deg,#64748b_0_6px,#475569_6px_12px)]" : crate.kind === "gold" ? "bg-gradient-to-b from-amber-300 to-amber-500" : crate.kind === "fragile" ? "border-2 border-dashed border-white bg-sky-200/40" : "bg-slate-400";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${label}: ${KIND_LABEL[crate.kind]} ${crate.len}칸 ${crate.w}톤`}
      className={`flex flex-1 flex-col items-center gap-1 rounded-xl border px-2 py-2 text-center transition ${small ? "max-w-[92px] opacity-70" : ""} ${selected ? "border-sky-300 bg-sky-500/20 ring-2 ring-sky-400" : "border-white/15 bg-white/[0.03] hover:border-white/30 light:border-slate-300 light:bg-slate-50"} disabled:cursor-default`}
    >
      <span className="text-[10px] font-bold text-white/50 light:text-slate-500">{label}</span>
      <span className="flex gap-0.5">
        {Array.from({ length: crate.len }, (_, i) => (
          <span key={i} className={`h-5 w-5 rounded-[3px] sm:h-6 sm:w-6 ${kindCls}`} />
        ))}
      </span>
      <span className="text-xs font-black text-white light:text-slate-900">
        {KIND_LABEL[crate.kind].split(" ")[0]} {crate.w}t
      </span>
      {!small && (
        <span className="text-[10px] text-white/50 light:text-slate-500">
          1층 {pointsFor(crate, 0)} ~ 6층 {pointsFor(crate, TIERS - 1)}점
        </span>
      )}
    </button>
  );
}

/** §10 heel gauge: −limit … +limit with the current and previewed heel. */
function HeelGauge({ T, lim, wave, preview }: { T: number; lim: number; wave: number; preview: { T: number; lim: number } | null }) {
  const range = Math.max(lim, preview?.lim ?? 0) * 1.25;
  const pos = (v: number) => `${50 + Math.max(-1, Math.min(1, v / range)) * 50}%`;
  const ratio = Math.abs(T) / lim;
  const tone = ratio >= 0.85 ? "text-rose-300 light:text-rose-600" : ratio >= 0.6 ? "text-amber-200 light:text-amber-600" : "text-emerald-200 light:text-emerald-700";
  const markCls = ratio >= 0.85 ? "bg-rose-500" : ratio >= 0.6 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-bold text-white/60 light:text-slate-500">⚖️ 기울기</span>
        <span className={`font-black tabular-nums ${tone}`}>
          {ratio >= 0.85 ? "⚠ " : ""}
          {T > 0 ? "▶ " : T < 0 ? "◀ " : ""}
          {Math.abs(T).toFixed(1)} / 한계 {lim.toFixed(1)} · 여유 {(lim - Math.abs(T)).toFixed(1)}
          {preview && <span className="ml-1 text-sky-200 light:text-sky-700">→ {Math.abs(preview.T).toFixed(1)}/{preview.lim.toFixed(1)}</span>}
        </span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
        <div className="absolute inset-y-0 bg-emerald-500/25" style={{ left: pos(-lim * 0.6), right: `calc(100% - ${pos(lim * 0.6)})` }} />
        <div className="absolute inset-y-0 bg-amber-400/20" style={{ left: pos(-lim * 0.85), width: `calc(${pos(-lim * 0.6)} - ${pos(-lim * 0.85)})` }} />
        <div className="absolute inset-y-0 bg-amber-400/20" style={{ left: pos(lim * 0.6), width: `calc(${pos(lim * 0.85)} - ${pos(lim * 0.6)})` }} />
        <div className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: pos(-lim) }} />
        <div className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: pos(lim) }} />
        {wave > 0 && (
          <>
            <div className="absolute inset-y-0 border-l border-dashed border-sky-300" style={{ left: pos(-(lim - wave)) }} title="출항 파도 기준" />
            <div className="absolute inset-y-0 border-l border-dashed border-sky-300" style={{ left: pos(lim - wave) }} />
          </>
        )}
        <div className="absolute inset-y-0 w-px bg-white/40 light:bg-slate-400" style={{ left: "50%" }} />
        {preview && <div className="absolute top-0.5 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-sky-300 bg-transparent" style={{ left: pos(preview.T) }} />}
        <div className={`absolute top-0 h-4 w-1.5 -translate-x-1/2 rounded ${markCls}`} style={{ left: pos(T) }} />
      </div>
      {wave > 0 && <p className="text-[10px] text-sky-200/70 light:text-sky-700">┆ 하늘색 점선 = 출항 때 파도({wave}) 기준선 — 끝날 때 이 안쪽이어야 안 쏟아져요</p>}
    </div>
  );
}

function OutcomeLine({ o, seat }: { o: Outcome; seat: Seat }) {
  const parts: string[] = [];
  if (o.placed) parts.push(`+${o.placed.pts}점 (${o.placed.y + 1}층)`);
  if (o.crushed.length) parts.push(`🥚 유리 깨짐 −${o.crushed.length * 2}`);
  if (o.spilled.length) parts.push(`⚠ ${o.spilled.length}개 바다로 (${o.spilled.map((s) => `${seatMark(s.owner)}${s.pts}`).join(" ")}) 벌금 −${o.spilled.length * 2}`);
  if (o.capsized) parts.push("🚨 전복! −10");
  const d = o.deltas[seat] ?? 0;
  const bad = o.spilled.length > 0 || o.capsized || o.crushed.length > 0;
  return (
    <p className={`text-xs font-bold ${bad ? "text-amber-200 light:text-amber-700" : "text-sky-100 light:text-sky-800"}`}>
      🔰 {parts.join(" · ") || "변화 없음"} → 나 {d >= 0 ? `+${d}` : d}
    </p>
  );
}

export default function CargoStackBoard({ state, viewerSeat, names, connectedSeats, botSeats, deadlineMs, nowMs, onAction, onGameEnd }: Props) {
  const [canWebgl] = useState(webglAvailable);
  const [view, setViewRaw] = useState<View>(() => {
    const v = load(VIEW_KEY);
    return v === "2d" || v === "3d-low" ? v : "3d";
  });
  const setView = (v: View) => {
    setViewRaw(v);
    save(VIEW_KEY, v);
  };
  const shownView: View = canWebgl ? view : "2d";
  const [rules, setRules] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const [selRaw, setSel] = useState<{ turn: number; slot: number; x: number } | null>(null);
  const [ballastRaw, setBallast] = useState<{ turn: number; dir: -1 | 1 } | null>(null);
  const name = useCallback((s: Seat) => names[s] ?? `${s + 1}번`, [names]);

  const { frame, heel } = useTimeline(state);

  // ── sound ──
  useSuiteBgm(getCargoStackSound, state.phase !== "ended", cargoIntensity(state));
  const classify = useMemo(() => cargoStackCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getCargoStackSound, classify);
  const play = (n: string, arg?: number) => getCargoStackSound().play(n, arg);

  const myTurn = state.phase === "load" && state.active === viewerSeat && sentTurn !== state.turn;
  const firstSlot = state.dock.findIndex((c) => c !== null);
  /** The legal column nearest the middle (falls back to the middle). */
  const centered = (len: number) => {
    const mid = Math.max(0, Math.min(COLS - len, 4 - Math.floor((len - 1) / 2)));
    for (let d = 0; d < COLS; d++) {
      for (const x of [mid - d, mid + d]) if (x >= 0 && x + len <= COLS && checkPlace(state.deck, len, x).ok) return x;
    }
    return mid;
  };
  const sel = myTurn ? (selRaw && selRaw.turn === state.turn && state.dock[selRaw.slot] ? selRaw : firstSlot >= 0 ? { turn: state.turn, slot: firstSlot, x: centered(state.dock[firstSlot]!.len) } : null) : null;
  const ballastMode = myTurn && ballastRaw && ballastRaw.turn === state.turn ? ballastRaw : null;
  const crate = sel ? state.dock[sel.slot] : null;
  const check = crate && sel ? checkPlace(state.deck, crate.len, sel.x) : null;

  const ghost: Ghost | null = !ballastMode && crate && sel && check ? { len: crate.len, w: crate.w, kind: crate.kind, x: sel.x, y: Math.min(check.y, TIERS - 1), valid: check.ok, owner: viewerSeat } : null;
  const helper = state.options.helper;
  const ballastDir = ballastMode?.dir ?? 0;
  const selSlot = sel?.slot ?? -1;
  const selX = sel?.x ?? -1;
  const placeOk = !!check?.ok;
  const outcome = useMemo(() => {
    if (!myTurn) return null;
    if (ballastDir !== 0) return previewBallast(state, viewerSeat, ballastDir);
    if (selSlot >= 0 && placeOk) return previewPlace(state, viewerSeat, selSlot, selX);
    return null;
  }, [myTurn, ballastDir, selSlot, selX, placeOk, state, viewerSeat]);
  const warnIds = useMemo(() => new Set(helper && outcome ? [...outcome.spilled.map((s) => s.id), ...outcome.crushed.map((c) => c.id)] : []), [helper, outcome]);

  const T = torqueOf(state.deck, state.ballast);
  const lim = limitOf(state.deck);
  const wave = WAVE[state.forecasts[state.voyage] ?? "calm"];
  const forecast = state.forecasts[state.voyage] ?? "calm";

  // ── actions ──
  function choose(slot: number) {
    if (!myTurn || !state.dock[slot]) return;
    setBallast(null);
    const c = state.dock[slot]!;
    const x = sel ? Math.max(0, Math.min(COLS - c.len, sel.x)) : centered(c.len);
    setSel({ turn: state.turn, slot, x });
    play("select");
  }
  function moveTo(x: number) {
    if (!myTurn || !crate || !sel) return;
    const nx = Math.max(0, Math.min(COLS - crate.len, x));
    if (nx !== sel.x) {
      setSel({ ...sel, x: nx });
      play("move");
    }
  }
  function drop() {
    if (!myTurn || !sel || !crate) return;
    if (!check?.ok) {
      play("invalid");
      return;
    }
    setSentTurn(state.turn);
    onAction({ type: "place", seat: viewerSeat, slot: sel.slot, x: sel.x });
  }
  function onColumn(c: number) {
    if (!myTurn || ballastMode || !crate || !sel) return;
    const x = Math.max(0, Math.min(COLS - crate.len, c - Math.floor((crate.len - 1) / 2)));
    if (x === sel.x) drop();
    else moveTo(x);
  }
  function ballastGo(dir: -1 | 1) {
    if (!myTurn || !canBallast(state, viewerSeat, dir)) {
      play("invalid");
      return;
    }
    setSentTurn(state.turn);
    setBallast(null);
    onAction({ type: "ballast", seat: viewerSeat, dir });
  }
  function pass() {
    if (!myTurn) return;
    setSentTurn(state.turn);
    onAction({ type: "pass", seat: viewerSeat });
  }

  // keyboard (§10)
  useEffect(() => {
    if (!myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key;
      if (ballastMode) {
        if (k === "ArrowLeft") setBallast({ turn: state.turn, dir: -1 });
        else if (k === "ArrowRight") setBallast({ turn: state.turn, dir: 1 });
        else if (k === "Enter" || k === " ") ballastGo(ballastMode.dir);
        else if (k === "Escape" || k === "b" || k === "B") setBallast(null);
        else return;
        e.preventDefault();
        return;
      }
      if (k === "1" || k === "2" || k === "3") choose(Number(k) - 1);
      else if (k === "ArrowLeft") moveTo((sel?.x ?? 0) - 1);
      else if (k === "ArrowRight") moveTo((sel?.x ?? 0) + 1);
      else if (k === "Enter" || k === " ") drop();
      else if ((k === "b" || k === "B") && !state.ballastUsed[viewerSeat]) setBallast({ turn: state.turn, dir: T > 0 ? -1 : 1 });
      else if (k === "p" || k === "P") pass();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // timer ticks in the last 5 s of my turn
  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  useEffect(() => {
    if (remaining !== null && remaining > 0 && remaining <= 5 && (myTurn || (state.phase === "depart" && state.nextStart === viewerSeat))) getCargoStackSound().play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const ev = state.lastEvent;
  const evTone = ev?.capsized ? "border-rose-400/50 bg-rose-500/15" : ev && (ev.spilled.length || ev.crushed.length) ? "border-amber-400/40 bg-amber-500/10" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-slate-50";
  const actor = state.phase === "load" ? state.active : state.phase === "depart" ? state.nextStart : null;
  const totalVoyages = state.options.voyages;
  const showDeparture = state.phase !== "load" && state.departure;

  return (
    <div className="flex flex-col gap-3">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-sky-500/20 px-2.5 py-1 text-xs font-black text-sky-100 light:text-sky-800">
          🚢 항해 {state.voyage + 1}/{totalVoyages}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${forecast === "storm" ? "bg-slate-600/60 text-white" : forecast === "swell" ? "bg-sky-700/40 text-sky-100 light:text-sky-900" : "bg-amber-300/25 text-amber-100 light:text-amber-800"}`}>
          {FORECAST_LABEL[forecast]} (파도 {wave})
        </span>
        {state.phase === "load" && <span className="text-xs text-white/50 light:text-slate-500">남은 화물 {state.pile.length + state.dock.filter(Boolean).length}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getCargoStackSound} icon="🚢" label="Harbor Shanty" preview="horn" />
          {canWebgl && (
            <button onClick={() => setView(view === "3d" ? "3d-low" : view === "3d-low" ? "2d" : "3d")} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600" title="보기 전환">
              {view === "3d" ? "🧊 3D" : view === "3d-low" ? "🧊 3D 가볍게" : "📐 2D"}
            </button>
          )}
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </div>
      </div>

      {/* seats */}
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: state.playerCount }, (_, s) => {
          const isActor = actor === s;
          return (
            <div key={s} className={`flex min-w-0 items-center gap-1.5 rounded-xl border px-2 py-1 text-xs ${isActor ? "border-sky-300 bg-sky-500/15" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"} ${connectedSeats.has(s) ? "" : "opacity-50"}`}>
              <SeatChip seat={s} />
              <span className="max-w-[7rem] truncate font-bold text-white light:text-slate-900">
                {s === viewerSeat ? "나" : name(s)}
                {botSeats.has(s) && s !== viewerSeat ? " 🤖" : ""}
              </span>
              <span className="font-black tabular-nums text-sky-100 light:text-sky-700">{state.scores[s]}</span>
              {state.phase === "load" && <span className="text-white/45 light:text-slate-400">⏳{state.turnsLeft[s]}</span>}
              {state.phase === "load" && !state.ballastUsed[s] && (
                <span title="밸러스트 남음" className="text-white/60">
                  ⚓
                </span>
              )}
              {isActor && remaining !== null && <span className={`font-black tabular-nums ${remaining <= 5 ? "text-rose-300" : "text-white/60 light:text-slate-500"}`}>{remaining}s</span>}
            </div>
          );
        })}
      </div>

      {/* ship */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-sky-200 sm:aspect-[16/10] light:border-slate-200">
        {shownView === "2d" ? (
          <Ship2D frame={frame} heel={heel} ghost={ghost} warnIds={warnIds} interactive={myTurn && !ballastMode} onColumn={onColumn} storm={forecast === "storm"} />
        ) : (
          <ShipScene frame={frame} heel={heel} ghost={ghost} warnIds={warnIds} interactive={myTurn && !ballastMode} onColumn={onColumn} forecast={forecast} quality={shownView === "3d-low" ? "low" : "high"} />
        )}
        {state.phase === "load" && (
          <div className="pointer-events-none absolute top-2 left-2 rounded-lg bg-black/45 px-2 py-1 text-[11px] font-bold text-white">
            {myTurn ? "🏗️ 내 차례 — 칸을 눌러 조준, 한 번 더 눌러 내리기" : `${actor !== null ? name(actor) : ""} 님이 싣는 중…`}
          </div>
        )}
        {frame.capsize > 0.5 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-4xl font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,.8)]">🚨 전복!</div>}
      </div>

      {/* heel */}
      <div className={PANEL}>
        <HeelGauge T={T} lim={lim} wave={wave} preview={helper && outcome ? { T: outcome.T, lim: outcome.lim } : null} />
      </div>

      {/* last event */}
      {ev && (
        <div className={`rounded-xl border px-3 py-2 text-xs break-keep text-white/85 light:text-slate-700 ${evTone}`}>
          <SeatChip seat={ev.seat} size={14} /> <span className="align-middle">{eventText(ev, (s) => (s === viewerSeat ? "나" : name(s)))}</span>
        </div>
      )}

      {/* dock + controls */}
      {state.phase === "load" && (
        <div className={`${PANEL} flex flex-col gap-2`}>
          <div className="flex items-stretch gap-1.5">
            {state.dock.map((c, i) => (
              <CrateCard key={i} crate={c} label={`${i + 1}번`} selected={!!sel && sel.slot === i && !ballastMode} disabled={!myTurn} onClick={() => choose(i)} />
            ))}
            <CrateCard crate={state.pile[0] ?? null} label="다음" selected={false} disabled small />
          </div>
          {myTurn ? (
            <>
              {helper && outcome && <OutcomeLine o={outcome} seat={viewerSeat} />}
              {!ballastMode && check && !check.ok && <p className="text-xs font-bold text-rose-300 light:text-rose-600">✕ {check.why === "full" ? "6층 위로는 못 쌓아요" : check.why === "unsupported" ? "받침이 모자라요 — 가운데가 받쳐져야 해요" : "배 밖이에요"}</p>}
              {ballastMode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-white/70 light:text-slate-600">⚓ 물탱크를 어느 쪽으로? (기울기 ±{BALLAST_STEP})</span>
                  <button className={GHOSTBTN} disabled={!canBallast(state, viewerSeat, -1)} onClick={() => (ballastMode.dir === -1 ? ballastGo(-1) : setBallast({ turn: state.turn, dir: -1 }))} aria-pressed={ballastMode.dir === -1}>
                    ◀ 왼쪽
                  </button>
                  <button className={GHOSTBTN} disabled={!canBallast(state, viewerSeat, 1)} onClick={() => (ballastMode.dir === 1 ? ballastGo(1) : setBallast({ turn: state.turn, dir: 1 }))} aria-pressed={ballastMode.dir === 1}>
                    오른쪽 ▶
                  </button>
                  <button className={PRIMARY} onClick={() => ballastGo(ballastMode.dir)} disabled={!canBallast(state, viewerSeat, ballastMode.dir)}>
                    ⚓ 옮기기
                  </button>
                  <button className={GHOSTBTN} onClick={() => setBallast(null)}>
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button className={GHOSTBTN} onClick={() => moveTo((sel?.x ?? 0) - 1)} disabled={!sel || sel.x <= 0} aria-label="왼쪽으로">
                    ◀
                  </button>
                  <span className="min-w-[4.5rem] text-center text-xs font-bold text-white/70 tabular-nums light:text-slate-600">{sel && crate ? `${sel.x + 1}${crate.len > 1 ? `~${sel.x + crate.len}` : ""}번 칸` : "—"}</span>
                  <button className={GHOSTBTN} onClick={() => moveTo((sel?.x ?? 0) + 1)} disabled={!sel || !crate || sel.x + crate.len >= COLS} aria-label="오른쪽으로">
                    ▶
                  </button>
                  <button className={`${PRIMARY} min-w-[7rem]`} onClick={drop} disabled={!check?.ok}>
                    🏗️ 내리기
                  </button>
                  <button className={GHOSTBTN} onClick={() => setBallast({ turn: state.turn, dir: T > 0 ? -1 : 1 })} disabled={state.ballastUsed[viewerSeat]} title="항해마다 한 번">
                    ⚓ 밸러스트
                  </button>
                  <button className={GHOSTBTN} onClick={pass}>
                    ⏭️ 넘기기{passCost(state, viewerSeat) > 0 ? " (−1)" : ""}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-white/50 light:text-slate-500">{viewerSeat < 0 ? "AI가 대신 플레이 중이에요." : "내 차례를 기다리는 중 — 대기열과 기울기를 미리 보고 작전을 세워요."}</p>
          )}
        </div>
      )}

      {showDeparture && state.departure && <DeparturePanel state={state} viewerSeat={viewerSeat} name={name} remaining={remaining} onSail={() => onAction({ type: "sail", seat: viewerSeat })} />}

      {state.phase === "ended" && !frame.busy && <FinalPanel state={state} viewerSeat={viewerSeat} name={name} onGameEnd={onGameEnd} />}

      {/* log */}
      <div className={PANEL}>
        <button onClick={() => setShowLog((v) => !v)} className="w-full text-left text-xs font-bold text-white/60 light:text-slate-500">
          📜 기록 {showLog ? "▲" : "▼"}
        </button>
        {showLog && (
          <ol className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto text-[11px] text-white/70 light:text-slate-600">
            {[...state.log].reverse().map((e) => (
              <li key={e.turn} className="break-keep">
                <span className="text-white/35 light:text-slate-400">항해{e.voyage + 1}</span> {eventText(e, (s) => (s === viewerSeat ? "나" : name(s)))}
              </li>
            ))}
          </ol>
        )}
      </div>

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function DeparturePanel({ state, viewerSeat, name, remaining, onSail }: { state: CargoState; viewerSeat: Seat; name: (s: Seat) => string; remaining: number | null; onSail: () => void }) {
  const d = state.departure!;
  const order = Array.from({ length: state.playerCount }, (_, s) => s).sort((a, b) => d.gains[b] - d.gains[a]);
  const who = (s: Seat) => (s === viewerSeat ? "나" : name(s));
  return (
    <div className={`${PANEL} flex flex-col gap-2`}>
      <h3 className="text-center text-base font-black text-white light:text-slate-900">
        {d.capsized ? `🚨 항해 ${d.voyage + 1} — 배가 뒤집혔어요!` : `⛴️ 항해 ${d.voyage + 1} 출항 — ${FORECAST_LABEL[d.forecast]}`}
      </h3>
      {!d.capsized && (
        <ul className="flex flex-col gap-0.5 text-xs text-white/70 light:text-slate-600">
          <li>{d.spilled.length > 0 ? `🌊 파도에 ${d.spilled.length}개가 쏟아졌어요: ${d.spilled.map((s) => `${who(s.owner)} −${s.pts}`).join(", ")}` : d.wave > 0 ? "🌊 파도를 무사히 견뎠어요!" : "☀️ 잔잔한 바다 — 무사히 출항"}</li>
          {d.fragile.length > 0 && <li>🥚 유리 배달 성공: {d.fragile.map((f) => `${who(f.owner)} +4`).join(", ")}</li>}
        </ul>
      )}
      <ol className="flex flex-col gap-1">
        {order.map((s) => (
          <li key={s} className={`flex items-center gap-2 rounded-lg px-3 py-1 text-sm ${s === viewerSeat ? "bg-sky-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <SeatChip seat={s} />
            <span className="flex-1 truncate font-bold text-white light:text-slate-900">{who(s)}</span>
            <span className={`tabular-nums text-xs font-bold ${d.gains[s] >= 0 ? "text-emerald-200 light:text-emerald-700" : "text-rose-300 light:text-rose-600"}`}>
              이번 항해 {d.gains[s] >= 0 ? "+" : ""}
              {d.gains[s]}
            </span>
            <span className="w-12 text-right font-black tabular-nums text-white light:text-slate-900">{state.scores[s]}</span>
          </li>
        ))}
      </ol>
      {state.phase === "depart" &&
        (state.nextStart === viewerSeat ? (
          <button className={PRIMARY} onClick={onSail}>
            ⚓ 다음 항해 시작 {remaining !== null ? `(${remaining})` : ""}
          </button>
        ) : (
          <p className="text-center text-xs text-white/50 light:text-slate-500">{state.nextStart !== null ? `${who(state.nextStart)} 님이 다음 항해의 선 — 곧 출발해요` : ""}</p>
        ))}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, name, onGameEnd }: { state: CargoState; viewerSeat: Seat; name: (s: Seat) => string; onGameEnd: () => void }) {
  const rankings = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">🚢 최종 결과</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-white/50 light:text-slate-500">
              <th className="px-1 text-left">순위</th>
              <th className="px-1 text-left">선장</th>
              {state.departures.map((d) => (
                <th key={d.voyage} className="px-1 text-right">
                  항해{d.voyage + 1}
                </th>
              ))}
              <th className="px-1 text-right">잃음</th>
              <th className="px-1 text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            {rankings.map((r) => (
              <tr key={r.seat} className={r.seat === viewerSeat ? "bg-sky-500/15" : ""}>
                <td className="px-1 py-1 font-black text-sky-200 light:text-sky-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</td>
                <td className="px-1 py-1">
                  <span className="flex items-center gap-1.5">
                    <SeatChip seat={r.seat} />
                    <span className="max-w-[7rem] truncate font-bold text-white light:text-slate-900">{r.seat === viewerSeat ? "나" : name(r.seat)}</span>
                  </span>
                </td>
                {state.departures.map((d) => (
                  <td key={d.voyage} className="px-1 py-1 text-right tabular-nums text-white/70 light:text-slate-600">
                    {d.gains[r.seat] >= 0 ? "+" : ""}
                    {d.gains[r.seat]}
                  </td>
                ))}
                <td className="px-1 py-1 text-right tabular-nums text-white/50 light:text-slate-500">
                  {lostOf(state, r.seat)}
                  {capsizesOf(state, r.seat) ? ` · 🚨${capsizesOf(state, r.seat)}` : ""}
                </td>
                <td className="px-1 py-1 text-right font-black tabular-nums text-white light:text-slate-900">{state.scores[r.seat]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className={PRIMARY} onClick={onGameEnd}>
        🏁 결과 저장하고 마치기
      </button>
    </div>
  );
}
