"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { synergyLevel, type UnitInstance } from "./combat";
import {
  BOARD_MAX,
  BUY_COST,
  HAND_MAX,
  REROLL_COST,
  combatFor,
  roundGold,
  sellValue,
  upgradeCost,
  type CombatRecord,
  type EngineAction,
  type GameState,
  type Seat,
} from "./engine";
import { HERO_BY_ID, SHOP_SLOTS, type HeroId, TRIBES, UPGRADE_BASE, unitDef } from "./units";
import UnitCard, { UnitDetail, type CardUnit } from "./UnitCard";
import CombatReplay, { COMBAT_CSS, sideOfSeat } from "./CombatReplay";
import RulebookModal from "./RulebookModal";
import { AbilityText } from "./AbilityFeed";
import { UnitTooltipHost, unitTip } from "./UnitTooltip";
import { EmoteBubble, EmoteWheel, type EmoteKind, type EmoteSlot } from "./emotes";
import SynergyTracker, { traitsOf } from "./SynergyTracker";
import { rpForRank, tierChange, tierOf, type RankResult, type RankTier } from "@/lib/stats/rankTier";
import HeroPreview from "./HeroPreview";
import CombatStats from "./CombatStats";
import GoldenMergeFX from "./GoldenMergeFX";
import FinalStandFX, { type FinalStandPlayer } from "./FinalStandFX";
import { getTavernBrawlSound } from "./tavernBrawlBgm";
import type { ArenaApi } from "./three/Arena3D";
import { webglAvailable } from "./three/webgl";

// three.js는 무거워서 3D 화면이 처음 필요할 때만 받는다
const Loading3D = () => <div className="flex h-72 items-center justify-center rounded-2xl bg-stone-950 text-xs text-amber-200/60">🍺 3D 여관 준비 중…</div>;
const Arena3D = dynamic(() => import("./three/Arena3D"), { ssr: false, loading: Loading3D });
const Combat3D = dynamic(() => import("./three/Combat3D"), { ssr: false, loading: Loading3D });

type View = "3d" | "2d";
const VIEW_KEY = "tavern-brawl-view";

function initialView(): View {
  if (!webglAvailable()) return "2d";
  try {
    return window.localStorage.getItem(VIEW_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

function initialQuality(): "high" | "low" {
  if (typeof window === "undefined") return "low";
  return window.innerWidth >= 768 && (navigator.hardwareConcurrency ?? 4) >= 4 ? "high" : "low";
}

type Props = {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  deadlineMs: number | null;
  /** 이번 단계 전체 제한 시간(ms) — 남은 시간 막대의 기준 */
  totalMs?: number;
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
  /** 끝난 판의 랭크 점수 변화(자동 기록 뒤 채워짐) */
  rankResult?: RankResult | null;
  /** 좌석별 마지막 감정표현 */
  emotes?: Record<Seat, EmoteSlot>;
  onEmote?: (kind: EmoteKind) => void;
};

type Selection = { kind: "shop"; slot: number } | { kind: "hand"; uid: string } | { kind: "board"; uid: string } | null;
type DragData = { from: "shop"; slot: number } | { from: "hand"; uid: string } | { from: "board"; uid: string };

const PANEL = "rounded-2xl border border-amber-900/30 bg-stone-900/60 p-2.5 light:border-amber-200 light:bg-amber-50/80 light:shadow-sm";
const LABEL = "text-[11px] font-semibold tracking-wide text-amber-200/70 light:text-amber-800";
const BTN = "whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
const BTN_GOLD = `${BTN} bg-amber-500 text-black hover:bg-amber-400`;
const BTN_DARK = `${BTN} border border-white/15 bg-black/30 text-white/85 hover:border-white/35 light:border-amber-300 light:bg-white light:text-amber-900`;
const BTN_GREEN = `${BTN} bg-emerald-600 text-white hover:bg-emerald-500`;

function sfx(name: string) {
  const s = getTavernBrawlSound();
  s.unlock();
  s.play(name);
}

function combatNames(c: CombatRecord, names: Record<Seat, string>): [string, string] {
  return [names[c.a] ?? `${c.a + 1}번`, c.b === -1 ? `👻 ${c.ghostOf !== null ? names[c.ghostOf] : "유령"}의 유령` : (names[c.b] ?? `${c.b + 1}번`)];
}


function PlayersPanel({
  state,
  viewerSeat,
  names,
  connectedSeats,
  onInspect,
  emotes,
}: {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  onInspect: (seat: Seat) => void;
  emotes: Record<Seat, EmoteSlot>;
}) {
  const order = state.seats.map((s, i) => ({ s, i })).sort((a, b) => Number(b.s.alive) - Number(a.s.alive) || b.s.hp - a.s.hp || (a.s.place ?? 0) - (b.s.place ?? 0));
  const max = state.options.startHp;
  return (
    <div className={`${PANEL} flex flex-col gap-1.5`}>
      <p className={LABEL}>🍻 손님들 (누르면 그 사람 보드)</p>
      {order.map(({ s, i }) => {
        const hero = s.hero ? HERO_BY_ID[s.hero] : null;
        const done = state.phase === "shop" ? s.ready : state.phase === "heroPick" ? s.hero !== null : null;
        const status = !s.alive ? (
          `💀 ${s.place}위`
        ) : done === null ? (
          ""
        ) : (
          <ReadyPill ready={done} />
        );
        return (
          <button
            key={i}
            type="button"
            onClick={() => onInspect(i)}
            className={`flex items-center gap-2 rounded-xl px-2 py-1 text-left text-xs transition hover:bg-white/5 ${i === viewerSeat ? "bg-amber-400/10 ring-1 ring-amber-400/40" : ""} ${!s.alive ? "opacity-50" : ""}`}
          >
            <span className="text-lg">{hero?.emoji ?? "❔"}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate font-semibold text-white/90 light:text-slate-800">{names[i] ?? `${i + 1}번`}</span>
                <EmoteBubble slot={emotes[i]} className="!px-1.5 !text-[10px]" />
                {!connectedSeats.has(i) && <span title="연결 끊김">📡</span>}
                <span className="ml-auto shrink-0 text-white/50 light:text-slate-500">
                  🏠{s.tier} {s.lastResult === "win" ? "🟢" : s.lastResult === "loss" ? "🔴" : s.lastResult === "draw" ? "⚪" : ""}
                  {s.winStreak >= 2 ? `🔥${s.winStreak}` : ""} {s.stats.triples > 0 && <span title={`황금 유닛 ${s.stats.triples}번 만듦`}>✨{s.stats.triples}</span>} {status}
                </span>
              </span>
              <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                <span className={`block h-full ${s.hp > max / 2 ? "bg-emerald-500" : s.hp > max / 5 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.max(0, (s.hp / max) * 100)}%` }} />
              </span>
            </span>
            <span className="w-7 shrink-0 text-right font-bold text-rose-300 light:text-rose-600">{Math.max(0, s.hp)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 손님 보드 보기 — 나는 지금 보드, 다른 사람은 공개 정보(가장 최근 전투에 나온 보드)만. ◀ ▶로 다음 사람. */
function InspectModal({
  state,
  seat,
  viewerSeat,
  names,
  onClose,
  onMove,
}: {
  state: GameState;
  seat: Seat;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  onClose: () => void;
  onMove: (seat: Seat) => void;
}) {
  const s = state.seats[seat];
  const hero = s.hero ? HERO_BY_ID[s.hero] : null;
  const isMe = seat === viewerSeat;
  const c = state.combats.find((x) => x.a === seat || x.b === seat);
  const board: CardUnit[] = isMe ? state.seats[seat].board : c ? (c.a === seat ? c.sideA.board : c.sideB.board) : [];
  const opp = c ? (c.a === seat ? c.b : c.a) : null;
  const oppName = c ? (c.a === seat ? combatNames(c, names)[1] : combatNames(c, names)[0]) : "";
  const won = c && c.winner !== null ? c.winner === (c.a === seat ? 0 : 1) : null;
  const seats = state.seats.map((_, i) => i as Seat);
  const step = (d: number) => onMove(seats[(seats.indexOf(seat) + d + seats.length) % seats.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const label = isMe
    ? "지금 내 보드"
    : !c
      ? "아직 전투 기록이 없어요"
      : state.phase === "combat"
        ? "이번 전투에 나온 보드"
        : "지난 전투 때 보드 (상점에서 바꾼 건 다음 전투에 보여요)";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-3 sm:items-center" onClick={onClose}>
      <div className="tb-pop w-full max-w-2xl rounded-2xl border border-amber-700/50 bg-stone-900 p-4 shadow-2xl light:border-amber-300 light:bg-amber-50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} className={`${BTN_DARK} px-2.5`} aria-label="이전 손님">
            ◀
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-base font-black text-white light:text-slate-900">
              <span className="mr-1 text-2xl">{hero?.emoji ?? "❔"}</span>
              {names[seat] ?? `${seat + 1}번`} {isMe && <span className="text-xs text-amber-300">(나)</span>}
            </p>
            <p className="text-xs text-white/60 light:text-slate-600">
              ❤️ {Math.max(0, s.hp)} · 🏠 {s.tier}등급 · {s.stats.wins}승 {s.stats.losses}패{s.stats.triples ? ` · ✨${s.stats.triples}` : ""}
              {!s.alive && ` · 💀 ${s.place}위`}
            </p>
          </div>
          <button type="button" onClick={() => step(1)} className={`${BTN_DARK} px-2.5`} aria-label="다음 손님">
            ▶
          </button>
        </div>
        {hero && (
          <p className="mt-2 rounded-lg bg-black/25 px-2 py-1 text-[11px] text-white/70 light:bg-white light:text-slate-600">
            {hero.name} — <b>{hero.power}</b>: <AbilityText text={hero.text} />
          </p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-white/55 light:text-slate-500">
          {label}
          {!isMe && c && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${won === null ? "bg-white/10 text-white/70" : won ? "bg-emerald-500/25 text-emerald-200" : "bg-rose-500/25 text-rose-200"}`}>
              vs {opp === viewerSeat ? "나" : oppName} · {won === null ? "무승부" : won ? "승리" : "패배"}
            </span>
          )}
        </p>
        <div className="mt-4 flex min-h-[7rem] flex-wrap justify-center gap-3 pb-2">
          {board.map((u, i) => (
            <UnitCard key={i} unit={u} />
          ))}
          {board.length === 0 && <p className="self-center text-xs text-white/40">보여 줄 유닛이 없어요</p>}
        </div>
        <FinalTraits board={board} />
        <button onClick={onClose} className={`${BTN_DARK} mt-3 w-full`}>
          닫기
        </button>
      </div>
    </div>
  );
}

/** 좁은 화면용 손님 띠 — 누르면 그 사람 보드(넓은 화면은 오른쪽 손님 목록) */
/** 준비 완료 여부 배지 — 색만이 아니라 글자로도 구분 */
function ReadyPill({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="rounded-full bg-emerald-500/20 px-1.5 py-px text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-400/50 light:text-emerald-700">✅ 준비</span>
  ) : (
    <span className="tb-tm-pulse inline-block rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-200 ring-1 ring-amber-400/50 light:text-amber-700">⏳ 고민 중</span>
  );
}

function PlayerStrip({ state, viewerSeat, names, onInspect }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; onInspect: (seat: Seat) => void }) {
  const max = state.options.startHp;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
      {state.seats.map((s, i) => {
        const hero = s.hero ? HERO_BY_ID[s.hero] : null;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onInspect(i as Seat)}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${i === viewerSeat ? "border-amber-400/70 bg-amber-400/15" : "border-white/15 bg-black/30"} ${s.alive ? "" : "opacity-45"}`}
            title="누르면 보드 보기"
          >
            <span className="text-base leading-none">{hero?.emoji ?? "❔"}</span>
            <span className="max-w-[4.5rem] truncate font-semibold text-white/90 light:text-slate-800">{names[i] ?? `${i + 1}번`}</span>
            <span className={`font-black tabular-nums ${s.hp > max / 2 ? "text-emerald-300" : s.hp > max / 5 ? "text-amber-300" : "text-rose-300"}`}>{s.alive ? s.hp : "💀"}</span>
            {state.phase === "shop" && s.alive && <span title={s.ready ? "준비 완료" : "아직 준비 안 함"}>{s.ready ? "✅" : "⏳"}</span>}
          </button>
        );
      })}
    </div>
  );
}

const TIMER_CSS = `
@keyframes tb-tm-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.18) } }
@keyframes tb-tm-shake { 0%,100% { transform: translateX(0) rotate(0) } 25% { transform: translateX(-2px) rotate(-3deg) } 75% { transform: translateX(2px) rotate(3deg) } }
@keyframes tb-tm-vignette { 0%,100% { opacity: .35 } 50% { opacity: .85 } }
@keyframes tb-tm-stripes { to { background-position: 28px 0 } }
.tb-tm-pulse { animation: tb-tm-pulse 1s ease-in-out infinite; }
.tb-tm-shake { animation: tb-tm-shake .25s linear infinite; }
.tb-tm-vignette { animation: tb-tm-vignette 1s ease-in-out infinite; }
.tb-tm-stripes { background-image: repeating-linear-gradient(-45deg, rgba(255,255,255,.22) 0 7px, transparent 7px 14px); background-size: 28px 100%; animation: tb-tm-stripes .6s linear infinite; }
@media (prefers-reduced-motion: reduce) { .tb-tm-pulse, .tb-tm-shake, .tb-tm-stripes { animation: none; } .tb-tm-vignette { animation: none; opacity: .5; } }
`;

/** 남은 초가 이 값 이하면 "시간 부족" 분위기 */
const HURRY_SEC = 10;
const PANIC_SEC = 5;

/**
 * 단계 제한 시간 — "23초 / 40초"와 줄어드는 막대. 10초 남으면 빨갛게 박동하며 째깍,
 * 5초부터 숫자가 떨리고 화면 가장자리가 붉게 맥박친다. 시간 기준은 이 기기가 단계 시작을 본 시각.
 */
function PhaseTimer({ deadlineMs, totalMs, nowMs, label, done }: { deadlineMs: number | null; totalMs: number; nowMs: number; label: string; /** 이미 준비 끝(또는 관전) — 재촉하지 않는다 */ done: boolean }) {
  const left = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)) : null;
  const total = Math.max(1, Math.round(totalMs / 1000));
  // 초가 바뀔 때만 째깍(같은 초에 여러 번 렌더돼도 한 번)
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (left === null || left === lastTickRef.current) return;
    lastTickRef.current = left;
    if (done) return;
    if (left === 0) sfx("timeUp");
    else if (left <= PANIC_SEC) sfx("tickUrgent");
    else if (left <= HURRY_SEC) sfx("tick");
  }, [left, done]);
  if (left === null || !totalMs) return null;
  const hurry = !done && left <= HURRY_SEC;
  const panic = left <= PANIC_SEC;
  const pct = Math.min(100, ((deadlineMs! - nowMs) / totalMs) * 100);
  return (
    <>
      <style>{TIMER_CSS}</style>
      {hurry && (
        <div
          className="tb-tm-vignette pointer-events-none fixed inset-0 z-[55]"
          style={{ boxShadow: `inset 0 0 ${panic ? 140 : 80}px ${panic ? 40 : 18}px rgba(220,38,38,${panic ? 0.75 : 0.5})` }}
          aria-hidden
        />
      )}
      <div
        className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-colors ${
          panic ? "border-rose-400 bg-rose-950/80" : hurry ? "border-rose-400/60 bg-rose-950/50" : "border-amber-900/40 bg-black/30 light:border-amber-200 light:bg-white"
        }`}
      >
        <span className={`text-lg leading-none ${panic ? "tb-tm-shake" : hurry ? "tb-tm-pulse" : ""}`}>{hurry ? "⏰" : "⏱"}</span>
        <span className="flex items-baseline gap-0.5 tabular-nums">
          <span className={`font-black leading-none ${panic ? "tb-tm-pulse text-3xl text-rose-300" : hurry ? "text-2xl text-rose-300" : "text-xl text-amber-100 light:text-amber-900"}`}>{left}</span>
          <span className="text-xs font-bold text-white/45 light:text-slate-500">/ {total}초</span>
        </span>
        <span className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-linear ${
              panic ? "tb-tm-stripes bg-rose-500" : hurry ? "tb-tm-stripes bg-gradient-to-r from-rose-600 to-orange-400" : pct > 50 ? "bg-gradient-to-r from-emerald-500 to-lime-300" : "bg-gradient-to-r from-amber-500 to-yellow-300"
            }`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className={`shrink-0 text-[11px] font-bold ${hurry ? "text-rose-200" : "text-white/55 light:text-slate-500"}`}>{panic ? "서둘러요!" : hurry ? "시간이 얼마 안 남았어요" : done ? "다른 손님 기다리는 중" : label}</span>
      </div>
    </>
  );
}
export default function TavernBrawlBoard({ state, viewerSeat, names, connectedSeats, deadlineMs, totalMs = 0, nowMs, onAction, onGameEnd, emotes = {}, onEmote, rankResult = null }: Props) {
  const me = state.seats[viewerSeat];
  const [rules, setRules] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [quality] = useState(initialQuality);
  const [canWebgl] = useState(webglAvailable);
  const toggleView = () => {
    const next: View = view === "3d" ? "2d" : "3d";
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // 저장 못 해도 이번 화면만 바뀌면 된다
    }
  };
  const [inspect, setInspect] = useState<Seat | null>(null);
  // 전투 통계: 내 전투 재생이 끝나면 잠깐(auto) 뜨고, 헤더 📊로 열고 닫는다
  const [statsView, setStatsView] = useState<{ round: number; auto: boolean } | null>(null);
  const [endedRound, setEndedRound] = useState(0);
  const statsCombat = state.phase === "shop" || state.phase === "combat" ? combatFor(state, viewerSeat) : null;
  const statsReady = !!statsCombat && (state.phase === "shop" || endedRound === state.round || me.combatDone);
  const closeStats = useCallback(() => setStatsView(null), []);
  const onMyCombatEnded = useCallback(() => {
    setEndedRound(state.round);
    setStatsView({ round: state.round, auto: true });
  }, [state.round]);
  useSuiteBgm(getTavernBrawlSound, state.phase !== "ended", state.phase === "combat" ? 1 : 0);

  // 황금 유닛·탈락·우승 효과음
  const fxTimers = useRef(new Set<number>());
  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      fxTimers.current.delete(t);
      fn();
    }, ms);
    fxTimers.current.add(t);
  }, []);
  useEffect(() => {
    const timers = fxTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  // 3장 합성: 새로 생긴 황금 유닛을 찾아 합성 연출(빨려 들어옴 → 충돌 순간 효과음)
  const triplesRef = useRef(me.stats.triples);
  const goldenUidsRef = useRef(new Set([...me.hand, ...me.board].filter((u) => u.golden).map((u) => u.uid)));
  const [mergeFx, setMergeFx] = useState<{ id: string; unit: CardUnit }[]>([]);
  useEffect(() => {
    const goldens = [...me.hand, ...me.board].filter((u) => u.golden);
    const fresh = goldens.filter((u) => !goldenUidsRef.current.has(u.uid));
    goldenUidsRef.current = new Set(goldens.map((u) => u.uid));
    const merged = me.stats.triples > triplesRef.current;
    triplesRef.current = me.stats.triples;
    if (!merged || !fresh.length) return;
    sfx("reroll");
    // 상태가 곧바로 또 바뀌어도(다음 동기화) 연출이 끊기지 않게 — 타이머는 언마운트 때만 정리
    later(() => setMergeFx((q) => [...q, ...fresh.map((u) => ({ id: u.uid, unit: { defId: u.defId, atk: u.atk, hp: u.hp, golden: true, kw: u.kw } }))]), 0);
    later(() => sfx("golden"), 700);
  }, [me.stats.triples, me.hand, me.board, later]);
  const doneMerge = useCallback(() => setMergeFx((q) => q.slice(1)), []);

  // 최후의 4인(5인 이상으로 시작) / 최후의 결투(3인 이상으로 시작): 전투 재생이 끝나고 상점 단계가 열릴 때 한 번
  const aliveCount = state.seats.filter((s) => s.alive).length;
  const announcedRef = useRef(aliveCount);
  const [finalFx, setFinalFx] = useState<{ id: number; count: 4 | 2; players: FinalStandPlayer[] } | null>(null);
  useEffect(() => {
    if (state.phase !== "shop") return;
    const before = announcedRef.current;
    announcedRef.current = aliveCount;
    const count = aliveCount === 2 && before > 2 && state.seatCount >= 3 ? 2 : aliveCount === 4 && before > 4 && state.seatCount >= 5 ? 4 : null;
    if (!count) return;
    const players = state.seats.flatMap((s, seat) => (s.alive ? [{ seat, name: names[seat] ?? `${seat + 1}번`, hero: s.hero, hp: s.hp, me: seat === viewerSeat }] : []));
    later(() => {
      setFinalFx({ id: state.round, count, players });
      sfx(count === 2 ? "finalDuel" : "finalFour");
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 단계·생존자 수가 바뀔 때만
  }, [state.phase, aliveCount]);
  const doneFinal = useCallback(() => setFinalFx(null), []);

  // 상대가 황금 유닛을 만들면 작은 알림(어떤 유닛인지는 비공개 — 전장처럼 횟수만)
  const rivalTriplesRef = useRef(state.seats.map((s) => s.stats.triples));
  const [rivalToasts, setRivalToasts] = useState<{ id: number; seat: Seat }[]>([]);
  const rivalSeq = useRef(0);
  useEffect(() => {
    const prev = rivalTriplesRef.current;
    const made = state.seats.map((s, i) => i).filter((i) => i !== viewerSeat && state.seats[i].stats.triples > (prev[i] ?? 0));
    rivalTriplesRef.current = state.seats.map((s) => s.stats.triples);
    if (!made.length) return;
    const items = made.map((seat) => ({ id: ++rivalSeq.current, seat: seat as Seat }));
    later(() => {
      setRivalToasts((q) => [...q, ...items].slice(-3));
      sfx("ability");
    }, 0);
    later(() => setRivalToasts((q) => q.filter((x) => !items.some((y) => y.id === x.id))), 3200);
  }, [state.seats, viewerSeat, later]);
  const aliveRef = useRef(me.alive);
  useEffect(() => {
    if (aliveRef.current && !me.alive && state.phase !== "ended") sfx("eliminated");
    aliveRef.current = me.alive;
  }, [me.alive, state.phase]);
  const endedRef = useRef(state.phase === "ended");
  useEffect(() => {
    if (!endedRef.current && state.phase === "ended") sfx(me.place === 1 ? "victory" : "lose");
    endedRef.current = state.phase === "ended";
  }, [state.phase, me.place]);

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-200 light:text-amber-800">🍺 여관 난투</span>
      {state.round > 0 && <span className="text-xs text-white/60 light:text-slate-600">{state.round}라운드</span>}
      {state.tribesInPlay && (
        <span className="text-xs text-white/50 light:text-slate-500" title={`이번 판 종족: ${state.tribesInPlay.map((t) => TRIBES[t].name).join(", ")}`}>
          이번 판 {state.tribesInPlay.map((t) => TRIBES[t].emoji).join("")}
        </span>
      )}
      <span className="text-xs text-white/50 light:text-slate-500">
        {state.phase === "heroPick" ? "영웅 고르기" : state.phase === "shop" ? "🛒 상점 단계" : state.phase === "combat" ? "⚔️ 전투" : "🏁 끝"}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {statsReady && (
          <button
            onClick={() => setStatsView((v) => (v ? null : { round: state.round, auto: false }))}
            className={`rounded-full border px-2.5 py-1 text-xs ${statsView ? "border-amber-400 bg-amber-400/15 text-amber-100 light:text-amber-800" : "border-white/15 text-white/70 light:border-amber-300 light:text-amber-800"}`}
            title="이번(지난) 전투에서 유닛별 넣은 피해·받은 피해"
          >
            📊 전투 통계
          </button>
        )}
        {canWebgl && (
          <button onClick={toggleView} className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-amber-300 light:text-amber-800" title="3D 탁자 / 2D 카드 화면 전환">
            {view === "3d" ? "🖼️ 2D로" : "🧊 3D로"}
          </button>
        )}
        <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-amber-300 light:text-amber-800">
          📖 룰북
        </button>
      </span>
    </div>
  );

  // 롤토체스식 시너지 표: 상점은 내 보드, 전투는 그 전투의 내 편(+상대 탭)
  const myCombat = state.phase === "combat" ? combatFor(state, viewerSeat) : null;
  const mySide = myCombat ? sideOfSeat(myCombat, viewerSeat) : 0;
  const trackerBoard = myCombat ? (mySide === 0 ? myCombat.sideA.board : myCombat.sideB.board) : me.board;
  const trackerEnemy = myCombat ? (mySide === 0 ? myCombat.sideB.board : myCombat.sideA.board) : undefined;
  const tracker =
    state.phase === "shop" || state.phase === "combat"
      ? (layout: "column" | "strip") => (
          <SynergyTracker board={trackerBoard} owned={[...me.board, ...me.hand]} tribesInPlay={state.tribesInPlay} enemyBoard={trackerEnemy} layout={layout} />
        )
      : null;

  let body: React.ReactNode;
  if (state.phase === "heroPick") body = <HeroPick state={state} viewerSeat={viewerSeat} names={names} onAction={onAction} view={view} quality={quality} />;
  else if (state.phase === "shop" && me.alive) body = <ShopView state={state} viewerSeat={viewerSeat} names={names} onAction={onAction} view={view} quality={quality} myEmote={emotes[viewerSeat]} />;
  else if (state.phase === "shop") body = <Spectator state={state} viewerSeat={viewerSeat} />;
  else if (state.phase === "combat") body = <CombatView key={state.round} onMyCombatEnded={onMyCombatEnded} state={state} viewerSeat={viewerSeat} names={names} onAction={onAction} view={view} quality={quality} emotes={emotes} />;
  else body = <Standings state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} rankResult={rankResult} />;

  return (
    <div className="flex flex-col gap-3">
      <style>{COMBAT_CSS}</style>
      <UnitTooltipHost />
      {onEmote && state.phase !== "ended" && <EmoteWheel onEmote={onEmote} mine={emotes[viewerSeat]} />}
      {rivalToasts.length > 0 && (
        <div className="pointer-events-none fixed right-3 top-16 z-[80] flex flex-col items-end gap-1.5">
          {rivalToasts.map((t) => (
            <div key={t.id} className="tb-feed flex items-center gap-1.5 rounded-full border border-yellow-300/70 bg-gradient-to-r from-amber-700/95 to-yellow-600/95 px-3 py-1 text-xs font-bold text-yellow-50 shadow-[0_0_14px_rgba(250,204,21,0.5)]">
              <span className="text-sm">✨</span>
              <span className="max-w-[9rem] truncate">{names[t.seat] ?? `${t.seat + 1}번`}</span>님이 황금 유닛을 만들었어요
            </div>
          ))}
        </div>
      )}
      {finalFx && <FinalStandFX key={finalFx.id} count={finalFx.count} players={finalFx.players} onDone={doneFinal} />}
      {mergeFx[0] && <GoldenMergeFX key={mergeFx[0].id} unit={mergeFx[0].unit} onDone={doneMerge} />}
      {statsView && statsReady && statsCombat && (
        <CombatStats
          key={`${statsView.round}-${statsView.auto}`}
          combat={statsCombat}
          viewSide={sideOfSeat(statsCombat, viewerSeat)}
          names={sideOfSeat(statsCombat, viewerSeat) === 0 ? combatNames(statsCombat, names) : (combatNames(statsCombat, names).reverse() as [string, string])}
          autoClose={statsView.auto}
          onClose={closeStats}
        />
      )}
      {header}
      {(state.phase === "shop" || state.phase === "heroPick") && (
        <PhaseTimer deadlineMs={deadlineMs} totalMs={totalMs} nowMs={nowMs} label={state.phase === "shop" ? "상점 시간" : "영웅 고르기"}
          done={!me.alive || (state.phase === "shop" ? me.ready : me.hero !== null)}
        />
      )}
      <div className={`grid gap-3 lg:grid-cols-[1fr_17rem] ${tracker ? "xl:grid-cols-[15rem_1fr_17rem]" : ""}`}>
        {tracker && <div className="relative z-40 hidden xl:block">{tracker("column")}</div>}
        <div className="min-w-0">
          {(state.phase === "shop" || state.phase === "combat") && <PlayerStrip state={state} viewerSeat={viewerSeat} names={names} onInspect={setInspect} />}
          {tracker && <div className="mb-2 xl:hidden">{tracker("strip")}</div>}
          {body}
        </div>
        {state.phase !== "heroPick" && state.phase !== "ended" && (
          <PlayersPanel state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} onInspect={setInspect} emotes={emotes} />
        )}
      </div>
      {rules && <RulebookModal onClose={() => setRules(false)} />}
      {inspect !== null && <InspectModal state={state} seat={inspect} viewerSeat={viewerSeat} names={names} onClose={() => setInspect(null)} onMove={setInspect} />}
    </div>
  );
}

/* ── 영웅 고르기 ─────────────────────────────────────────── */

const NO_UNITS: never[] = [];

function HeroPick({
  state,
  viewerSeat,
  names,
  onAction,
  view,
  quality,
}: {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  onAction: (a: EngineAction) => void;
  view: View;
  quality: "high" | "low";
}) {
  const me = state.seats[viewerSeat];
  const waiting = state.seats.map((s, i) => (s.hero ? null : names[i])).filter(Boolean);
  const arenaApi = useRef<ArenaApi | null>(null);
  // 능력 미리보기: 마우스오버(넓은 화면) 또는 "미리보기" 탭(모바일)
  const [hover, setHover] = useState<string | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  /** 마지막으로 본 영웅 — 마우스가 카드 밖으로 나가도 탁자 위 말은 그대로 */
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  // 고른 영웅이 곧 내 말: 고르기 전엔 보고 있는 영웅이 탁자 위에 서서 걸어 볼 수 있다
  const stageHero = me.hero ?? hover ?? tapped ?? lastSeen ?? me.heroOptions[0] ?? null;
  const stageAvatars = useMemo(
    () => (stageHero ? [{ key: "me", hero: stageHero, name: "나", side: 0 as const, hp: me.hp, controllable: true }] : undefined),
    [stageHero, me.hp],
  );
  const focus = (id: string) => {
    setHover(id);
    setLastSeen(id);
  };
  return (
    <div className={`${PANEL} flex flex-col items-center gap-4 p-5`}>
      <p className="text-center text-sm text-amber-100/80 light:text-amber-900">
        영웅 3명 중 한 명을 고르세요. 고른 영웅이 탁자 위를 돌아다니는 <b>내 말</b>이 돼요. 마우스를 올리면 능력 미리보기가 보여요.
      </p>
      {view === "3d" && stageHero && (
        <div className="relative w-full max-w-3xl overflow-hidden rounded-xl">
          <Arena3D units={NO_UNITS} mode="shop" apiRef={arenaApi} avatars={stageAvatars} quality={quality} centerAvatar className="h-52 w-full sm:h-60" />
          <div className="pointer-events-none absolute left-2 top-2 rounded-lg bg-black/60 px-2 py-1 text-[11px] font-bold text-amber-100">
            {me.hero ? (
              <>
                {HERO_BY_ID[me.hero].emoji} 내 말: {HERO_BY_ID[me.hero].name}
              </>
            ) : (
              <>
                👀 {HERO_BY_ID[stageHero].emoji} {HERO_BY_ID[stageHero].name} 미리보기
              </>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] text-white/70">
            바닥을 눌러 걷기 · WASD/방향키 · 스페이스 점프 · 말을 누르면 춤
          </div>
        </div>
      )}
      <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
        {me.heroOptions.map((id) => {
          const h = HERO_BY_ID[id];
          const picked = me.hero === id;
          return (
            <div key={id} className="relative flex flex-col gap-1" onMouseEnter={() => focus(id)} onMouseLeave={() => setHover((h) => (h === id ? null : h))}>
            <button
              disabled={me.hero !== null}
              onClick={() => {
                sfx("power");
                onAction({ type: "PICK_HERO", seat: viewerSeat, hero: id });
              }}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-center transition ${
                picked ? "border-yellow-300 bg-yellow-300/10" : !me.hero && view === "3d" && stageHero === id ? "border-amber-400/80 bg-amber-400/5" : "border-amber-900/40 bg-black/20 hover:border-amber-400 light:border-amber-300 light:bg-white"
              } disabled:cursor-default`}
            >
              <span className="text-5xl">{h.emoji}</span>
              <span className="font-bold text-white light:text-slate-900">{h.name}</span>
              <span className="text-xs font-semibold text-amber-300 light:text-amber-700">
                {h.power} {h.cost === null ? "· 지속" : `· 🪙${h.cost}`}
              </span>
              <span className="break-keep rounded-lg bg-black/30 px-2 py-1.5 text-xs text-white/75 light:bg-amber-100 light:text-slate-700">
                <AbilityText text={h.text} />
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTapped(tapped === id ? null : id);
                setLastSeen(id);
              }}
              className="rounded-lg bg-white/5 py-1 text-[11px] font-bold text-amber-200/80 sm:hidden"
            >
              👁 효과 미리보기 {tapped === id ? "▴" : "▾"}
            </button>
            {tapped === id && (
              <div className="tb-pop rounded-2xl border border-amber-400/40 bg-stone-950/95 p-3 sm:hidden">
                <HeroPreview hero={id as HeroId} />
              </div>
            )}
            {hover === id && (
              <div className="tb-pop pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-72 -translate-x-1/2 rounded-2xl border border-amber-400/40 bg-stone-950/95 p-3 shadow-2xl backdrop-blur sm:block">
                <HeroPreview hero={id as HeroId} />
              </div>
            )}
            </div>
          );
        })}
      </div>
      {me.hero && <p className="text-xs text-white/50 light:text-slate-500">다른 손님을 기다리는 중… {waiting.join(", ")}</p>}
    </div>
  );
}

/* ── 상점 ─────────────────────────────────────────────────── */

/** 칸 제한 표시: 여유(초록) · 1칸 남음(주황) · 꽉 참(빨강, 깜빡) */
function CapBadge({ label, n, max }: { label: string; n: number; max: number }) {
  const full = n >= max;
  const near = !full && n >= max - 1;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-sm font-black tabular-nums ${
        full ? "tb-upglow border-rose-300 bg-rose-600 text-white" : near ? "border-amber-300/70 bg-amber-500/20 text-amber-100" : "border-emerald-300/50 bg-emerald-500/15 text-emerald-100"
      }`}
      title={full ? `${label}이(가) 꽉 찼어요` : `${label} ${max - n}칸 남음`}
    >
      {label} {n}/{max}
      {full && <span className="text-[11px]">꽉 참!</span>}
    </span>
  );
}

/* ── 골드·등급업 HUD ─────────────────────────────────────── */

/** 큰 골드 표시 — 바뀔 때마다 번쩍이며 +N/−N이 떠오른다 */
function GoldCounter({ gold, max }: { gold: number; max: number }) {
  const prev = useRef(gold);
  const [fx, setFx] = useState<{ id: number; delta: number } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const delta = gold - prev.current;
    prev.current = gold;
    if (!delta) return;
    const id = ++seq.current;
    const t0 = window.setTimeout(() => setFx({ id, delta }), 0);
    const t1 = window.setTimeout(() => setFx((f) => (f && f.id === id ? null : f)), 1100);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [gold]);
  return (
    <span className="relative inline-flex">
      <span
        key={`pill-${fx?.id ?? 0}`}
        className={`inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-b from-yellow-200 via-yellow-400 to-amber-600 px-3 py-1 text-black shadow-[0_0_14px_rgba(250,204,21,0.45)] ${fx ? "tb-goldpulse" : ""}`}
        title="골드 — 유닛 구매 3, 새로고침 1, 여관 등급업"
      >
        <span className="text-2xl leading-none drop-shadow">🪙</span>
        <span className="text-2xl font-black leading-none tabular-nums">{gold}</span>
        <span className="text-xs font-bold text-black/55">/{max}</span>
      </span>
      {fx && (
        <span key={`float-${fx.id}`} className={`tb-coinfloat pointer-events-none absolute left-1/2 -top-3 text-lg font-black drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] ${fx.delta > 0 ? "text-lime-300" : "text-rose-300"}`}>
          {fx.delta > 0 ? `+${fx.delta}` : fx.delta}
        </span>
      )}
    </span>
  );
}

/** 여관 등급 + 등급업 버튼 — 살 수 있으면 금빛으로 빛나고, 모자라면 몇 골드 부족한지 */
function UpgradePanel({ tier, cost, base, gold, onUpgrade }: { tier: number; cost: number; base: number; gold: number; onUpgrade: () => void }) {
  const can = tier < 6 && gold >= cost;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex flex-col items-center rounded-xl border-2 border-sky-300/60 bg-sky-900/60 px-2.5 py-0.5 leading-tight" title="여관 등급이 높을수록 높은 등급 유닛과 상점 칸이 늘어나요">
        <span className="text-[10px] font-semibold text-sky-200/80">🏠 여관</span>
        <span className="text-lg font-black text-sky-50">
          {tier}등급 <span className="text-[10px] text-yellow-300">{"★".repeat(tier)}</span>
        </span>
      </span>
      {tier < 6 ? (
        <button
          type="button"
          disabled={!can}
          onClick={onUpgrade}
          className={`relative inline-flex flex-col items-start rounded-xl px-3 py-1 text-left leading-tight transition ${
            can ? "tb-upglow bg-gradient-to-b from-amber-300 to-amber-600 text-black hover:scale-105" : "cursor-not-allowed border border-white/15 bg-black/30 text-white/55"
          }`}
          title="여관 등급업: 매 라운드 비용이 1씩 싸져요"
        >
          <span className="text-sm font-black">⬆ {tier + 1}등급으로</span>
          <span className={`text-[11px] font-bold ${can ? "text-black/70" : ""}`}>
            🪙{cost}
            {cost < base && <span className={`ml-1 rounded px-1 ${can ? "bg-black/20" : "bg-lime-400/20 text-lime-300"}`}>할인 −{base - cost}</span>}
            {!can && <span className="ml-1 text-rose-300">{cost - gold}골드 부족</span>}
          </span>
        </button>
      ) : (
        <span className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 px-3 py-1.5 text-sm font-black text-black">👑 최고 등급</span>
      )}
    </span>
  );
}

function ShopView({
  state,
  viewerSeat,
  names,
  onAction,
  view,
  quality,
  myEmote,
}: {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  onAction: (a: EngineAction) => void;
  view: View;
  quality: "high" | "low";
  myEmote?: EmoteSlot;
}) {
  const arenaApi = useRef<ArenaApi | null>(null);
  // 3D 탁자에 넘기는 배열은 보드가 바뀔 때만 새로 만든다(타이머로 다시 그려질 때 3D가 통째로 다시 그려지지 않게)
  const boardUnits = useMemo(() => state.seats[viewerSeat].board.map((u) => ({ ...u, side: 0 as const })), [state.seats, viewerSeat]);
  const meHero = state.seats[viewerSeat].hero;
  const meHp = state.seats[viewerSeat].hp;
  const shopAvatars = useMemo(
    () => (meHero ? [{ key: "me", hero: meHero, name: "나", side: 0 as const, hp: meHp, controllable: true, emote: myEmote }] : undefined),
    [meHero, meHp, myEmote],
  );
  /** 방금 발동한 능력 안내(전투의 함성·영웅 능력) */
  const [toast, setToast] = useState<{ id: number; label: string; text: string } | null>(null);
  const toastSeq = useRef(0);
  const showToast = (label: string, text: string) => {
    const id = ++toastSeq.current;
    setToast({ id, label, text });
    window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 2800);
  };
  /** 방금 강화된 보드 유닛 → "+a/+h" */
  const [boosts, setBoosts] = useState<Record<string, string>>({});
  const prevBoardRef = useRef<Map<string, { atk: number; hp: number }> | null>(null);
  const me = state.seats[viewerSeat];
  const round = state.round;
  const [sel, setSel] = useState<Selection>(null);
  const [targeting, setTargeting] = useState(false);
  const hero = me.hero ? HERO_BY_ID[me.hero] : null;

  // 선택한 유닛이 사라지면(팔림/합쳐짐) 선택 해제
  const selValid =
    sel === null ||
    (sel.kind === "shop" && !!me.shop[sel.slot]) ||
    (sel.kind === "hand" && me.hand.some((u) => u.uid === sel.uid)) ||
    (sel.kind === "board" && me.board.some((u) => u.uid === sel.uid));
  const selection = selValid ? sel : null;

  // 손패+보드 + 상점의 같은 일반 유닛으로 3장을 채울 수 있으면 → 그 상점 카드에 반짝이(2장 보유면 "3장 완성!", 1장 보유+상점 2장이면 "2장 사면 완성!")
  const ownedCopies = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of [...me.hand, ...me.board]) if (!u.golden) m.set(u.defId, (m.get(u.defId) ?? 0) + 1);
    return m;
  }, [me.hand, me.board]);
  const shopCopies = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of me.shop) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [me.shop]);
  /** 몇 장 더 사면 3장이 되나 — 가진 것 + 상점에 나온 것으로 3장을 채울 수 있을 때만(아니면 0) */
  const tripleNeed = (defId: string): number => {
    if (unitDef(defId).token) return 0;
    const need = 3 - Math.min(2, ownedCopies.get(defId) ?? 0);
    return (shopCopies.get(defId) ?? 0) >= need ? need : 0;
  };
  const tripleReady = (defId: string) => tripleNeed(defId) > 0;
  // 그런 카드가 새로 상점에 나타나면 반짝 효과음 한 번
  const readyKey = me.shop.map((id, i) => (id && tripleReady(id) ? `${i}:${id}` : "")).filter(Boolean).join(",");
  const prevReadyRef = useRef(readyKey);
  useEffect(() => {
    const before = new Set(prevReadyRef.current.split(",").filter(Boolean));
    prevReadyRef.current = readyKey;
    if (readyKey.split(",").some((k) => k && !before.has(k))) sfx("discover");
  }, [readyKey]);

  // 보드 스탯이 오른 유닛을 찾아 하이라이트(전투의 함성·영웅 능력·발견 등 모든 상점 강화)
  const boardKey = state.seats[viewerSeat].board.map((u) => `${u.uid}:${u.atk}:${u.hp}`).join("|");
  useEffect(() => {
    const board = state.seats[viewerSeat].board;
    const prevMap = prevBoardRef.current;
    prevBoardRef.current = new Map(board.map((u) => [u.uid, { atk: u.atk, hp: u.hp }]));
    if (!prevMap) return;
    const changed: Record<string, string> = {};
    for (const u of board) {
      const p = prevMap.get(u.uid);
      if (p && (u.atk > p.atk || u.hp > p.hp)) changed[u.uid] = `+${Math.max(0, u.atk - p.atk)}/+${Math.max(0, u.hp - p.hp)}`;
    }
    if (!Object.keys(changed).length) return;
    const t0 = window.setTimeout(() => {
      setBoosts(changed);
      for (const [uid, text] of Object.entries(changed)) {
        arenaApi.current?.glow(uid);
        arenaApi.current?.ring(uid, "#fde047", 1.2);
        arenaApi.current?.popup(uid, text, "#4ade80", 0.8);
      }
    }, 0);
    const t1 = window.setTimeout(() => setBoosts({}), 1400);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
    // boardKey가 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  const send = (a: EngineAction, sound?: string) => {
    if (me.ready && a.type !== "UNREADY") {
      showToast("✅ 준비 완료 상태", "상점·보드를 고치려면 먼저 「준비 해제」를 누르세요");
      return;
    }
    if (sound) sfx(sound);
    onAction(a);
  };
  const buy = (slot: number) => {
    if (me.hand.length >= HAND_MAX) {
      showToast(`🖐️ 손패 ${me.hand.length}/${HAND_MAX} 꽉 참`, "보드에 내거나 팔아서 손패를 비우세요");
      return;
    }
    if (me.gold < BUY_COST) {
      showToast(`🪙 골드 부족`, `구매에 ${BUY_COST}골드가 필요해요 (지금 ${me.gold})`);
      return;
    }
    if (!me.shop[slot]) return;
    send({ type: "BUY", seat: viewerSeat, round, slot }, "buy");
    setSel(null);
  };
  const play = (uid: string, index: number, back?: boolean) => {
    if (me.board.length >= BOARD_MAX) {
      showToast(`⚔️ 보드 ${me.board.length}/${BOARD_MAX} 꽉 참`, "보드 유닛을 팔거나(상점으로 끌기) 자리를 비우세요");
      return;
    }
    const u = me.hand.find((x) => x.uid === uid);
    if (u) {
      const d = unitDef(u.defId);
      if (d.battlecry) {
        showToast(`📣 ${d.name}`, d.text);
        window.setTimeout(() => sfx("ability"), 120);
      } else if (u.golden) showToast(`✨ 황금 ${d.name}`, `발견: ${Math.min(6, me.tier + 1)}등급 유닛 3장 중 1장을 골라요`);
    }
    send({ type: "PLAY", seat: viewerSeat, round, uid, index, back }, "play");
    setSel(null);
  };
  const move = (uid: string, index: number, back?: boolean) => {
    send({ type: "MOVE", seat: viewerSeat, round, uid, index, back });
  };
  /** 줄 끝(앞줄 끝 = 앞줄 수, 뒷줄 끝 = 보드 수)에 놓을 자리 */
  const frontCount = me.board.filter((u) => !u.back).length;
  const rowEnd = (back: boolean, excludeUid?: string) =>
    back ? me.board.filter((u) => u.uid !== excludeUid).length : me.board.filter((u) => !u.back && u.uid !== excludeUid).length;
  const place = (index: number, back: boolean) => {
    if (selection?.kind === "hand") play(selection.uid, index, back);
    else if (selection?.kind === "board") move(selection.uid, index, back);
  };
  const sell = (uid: string) => {
    send({ type: "SELL", seat: viewerSeat, round, uid }, "sell");
    setSel(null);
  };
  const reroll = () => {
    if (me.freeRerolls === 0 && me.gold < REROLL_COST) return;
    send({ type: "REROLL", seat: viewerSeat, round }, "reroll");
    setSel(null);
  };
  const rerollRef = useRef(reroll);
  const freezeRef = useRef(() => send({ type: "FREEZE", seat: viewerSeat, round }, "freeze"));
  useEffect(() => {
    rerollRef.current = reroll;
    freezeRef.current = () => send({ type: "FREEZE", seat: viewerSeat, round }, "freeze");
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === "KeyR") rerollRef.current();
      else if (e.code === "KeyF") freezeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const activatePower = (target?: string) => {
    if (hero) showToast(`${hero.emoji} ${hero.power}`, hero.text);
    send({ type: "HERO_POWER", seat: viewerSeat, round, target }, "power");
    setTargeting(false);
  };

  const selectedUnit: UnitInstance | null =
    selection?.kind === "hand" ? (me.hand.find((u) => u.uid === selection.uid) ?? null) : selection?.kind === "board" ? (me.board.find((u) => u.uid === selection.uid) ?? null) : null;
  const shopUnit: CardUnit | null = selection?.kind === "shop" && me.shop[selection.slot] ? protoCard(me.shop[selection.slot]!) : null;

  const cost = upgradeCost(me);
  const powerReady = hero && hero.cost !== null && !me.powerUsed && me.gold >= hero.cost && (!["mage", "tamer"].includes(hero.id) || me.board.length > 0);
  const insertMode = selection?.kind === "hand" || selection?.kind === "board";

  /* ── 끌어다 놓기(마우스·터치 공통, 포인터 이벤트) ──────────────
   * 마우스는 6px 움직이면, 터치는 0.25초 꾹 누르면 끌기 시작(그 전에 움직이면 화면 스크롤).
   * 놓은 자리의 data-drop으로 판단: sell(판매) · hand · board · board:i · board3d(3D 탁자 → 가장 가까운 자리). */
  type DragState = { data: DragData; card: CardUnit; x: number; y: number; active: boolean };
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverDrop, setHoverDrop] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const dropAt = (x: number, y: number): { key: string; el: HTMLElement } | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const key = (el as HTMLElement).dataset?.drop;
      if (key) return { key, el: el as HTMLElement };
    }
    return null;
  };
  const finishDrop = (d: DragState) => {
    const hit = dropAt(d.x, d.y);
    if (!hit) return;
    const { data } = d;
    const k = hit.key;
    if (k === "sell") {
      if (data.from !== "shop") sell(data.uid);
      return;
    }
    if (data.from === "shop") {
      if (k === "hand" || k.startsWith("board")) buy(data.slot);
      return;
    }
    let index = me.board.length;
    let back: boolean | undefined;
    if (k.startsWith("board:")) {
      const [, i, b] = k.split(":");
      index = Number(i);
      back = b === "1";
    } else if (k.startsWith("boardrow:")) {
      back = k === "boardrow:1";
      index = rowEnd(back, data.from === "board" ? data.uid : undefined);
    } else if (k === "board3d") {
      const near = arenaApi.current?.nearestInsert(d.x, d.y);
      if (near) ({ index, back } = near);
    } else if (k !== "board") return;
    if (data.from === "hand") play(data.uid, index, back);
    else move(data.uid, index, back);
  };
  const startDrag = (data: DragData, card: CardUnit, ev: { clientX: number; clientY: number; pointerType: string }) => {
    const sx = ev.clientX;
    const sy = ev.clientY;
    const touch = ev.pointerType === "touch";
    let state: DragState = { data, card, x: sx, y: sy, active: false };
    dragRef.current = state;
    const activate = () => {
      unitTip.hide();
      state = { ...state, active: true };
      dragRef.current = state;
      setDrag(state);
      suppressClickRef.current = true;
      if (touch) navigator.vibrate?.(12);
      sfx("play");
    };
    const holdTimer = touch ? window.setTimeout(activate, 250) : null;
    const onMove = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - sx, e.clientY - sy);
      if (!state.active) {
        if (touch) {
          if (moved > 10) cleanup(); // 꾹 누르기 전에 움직이면 스크롤
          return;
        }
        if (moved < 6) return;
        activate();
      }
      state = { ...state, x: e.clientX, y: e.clientY };
      dragRef.current = state;
      setDrag(state);
      setHoverDrop(dropAt(e.clientX, e.clientY)?.key ?? null);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (state.active) e.preventDefault();
    };
    const onUp = () => {
      if (state.active) finishDrop(state);
      cleanup();
    };
    function cleanup() {
      if (holdTimer) window.clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("touchmove", onTouchMove);
      dragRef.current = null;
      setDrag(null);
      setHoverDrop(null);
      window.setTimeout(() => (suppressClickRef.current = false), 0);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
  };
  const dragging = drag?.active ? drag : null;
  const sellPreview = dragging && dragging.data.from !== "shop" ? (() => {
    const id = "uid" in dragging.data ? dragging.data.uid : null;
    const u = [...me.board, ...me.hand].find((x) => x.uid === id);
    return u ? sellValue(me, u) : 1;
  })() : 0;

  return (
    <div className="flex flex-col gap-2.5">
      {/* HUD */}
      <div className={`${PANEL} flex flex-wrap items-center gap-2`}>
        <span className="text-sm font-bold text-rose-300 light:text-rose-600">❤️ {me.hp}</span>
        <GoldCounter gold={me.gold} max={roundGold(round) + (me.winStreak >= 3 || me.lossStreak >= 3 ? 1 : 0)} />
        <UpgradePanel
          tier={me.tier}
          cost={cost}
          base={me.tier < 6 ? UPGRADE_BASE[me.tier + 1] - (me.hero === "architect" ? 2 : 0) : 0}
          gold={me.gold}
          onUpgrade={() => {
            send({ type: "UPGRADE", seat: viewerSeat, round }, "upgrade");
            showToast(`🏠 ${me.tier + 1}등급 여관!`, `상점에 ${me.tier + 1}등급 유닛까지 나와요 · 다음 새로고침부터 상점 칸 ${SHOP_SLOTS[me.tier + 1]}칸`);
          }}
        />
        {hero && (
          <button
            disabled={hero.cost === null || !powerReady}
            onClick={() => {
              if (hero.id === "mage") {
                if (selection?.kind === "board") activatePower(selection.uid);
                else setTargeting(true);
              } else activatePower();
            }}
            className={`${BTN_DARK} ${targeting ? "ring-2 ring-yellow-300" : ""}`}
            title={hero.text}
          >
            {hero.emoji} {hero.power} {hero.cost === null ? "(지속)" : me.powerUsed ? "✓" : `🪙${hero.cost}`}
          </button>
        )}
        {me.ready ? (
          <button
            onClick={() => send({ type: "UNREADY", seat: viewerSeat, round }, "freeze")}
            className={`${BTN} ml-auto border-2 border-emerald-400 bg-emerald-900/60 px-4 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.45)] hover:bg-emerald-800/70 light:bg-emerald-50 light:text-emerald-800`}
            title="눌러서 준비를 취소하고 다시 상점을 볼 수 있어요"
          >
            ✅ 준비됨 <span className="ml-1 text-xs font-semibold opacity-80">· 해제</span>
          </button>
        ) : (
          <button
            onClick={() => send({ type: "READY", seat: viewerSeat, round }, "ready")}
            className={`${BTN_GREEN} ml-auto px-4`}
          >
            ⚔️ 준비 완료
          </button>
        )}
      </div>
      <ReadyStatus state={state} viewerSeat={viewerSeat} names={names} />
      {targeting && (
        <p className="rounded-xl bg-yellow-300/15 px-3 py-1.5 text-xs text-yellow-100 light:text-amber-800">
          🧙 마력을 불어넣을 보드 유닛을 누르세요.{" "}
          <button className="underline" onClick={() => setTargeting(false)}>
            취소
          </button>
        </p>
      )}

      {/* 상점 */}
      <div
        data-drop={dragging && dragging.data.from !== "shop" ? "sell" : undefined}
        className={`${PANEL} relative flex flex-col gap-2 transition ${dragging && dragging.data.from !== "shop" ? "ring-2 ring-yellow-300/70" : ""} ${hoverDrop === "sell" ? "scale-[1.01] bg-yellow-400/10" : ""}`}
      >
        {dragging && dragging.data.from !== "shop" && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/55 text-sm font-black text-yellow-200">💰 여기에 놓으면 판매 +{sellPreview}골드</div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2">
            <span className="rounded-xl bg-gradient-to-b from-sky-400 to-sky-700 px-3 py-1 text-lg font-black leading-tight text-white shadow-[0_0_12px_rgba(56,189,248,0.4)]" title="여관 등급 — 상점에 나오는 유닛의 최고 등급">
              🏠 {me.tier}등급 <span className="text-sm text-yellow-300">{"★".repeat(me.tier)}</span>
            </span>
            <span className="flex flex-col text-[11px] leading-tight text-white/60 light:text-slate-500">
              <span>
                상점 {me.shop.length}칸 · {me.tier}★까지 · 1장 🪙{BUY_COST}
              </span>
              <span className="hidden sm:inline">유닛을 여기로 끌어다 놓으면 판매</span>
            </span>
          </span>
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => send({ type: "FREEZE", seat: viewerSeat, round }, "freeze")}
              className={`flex h-11 flex-col items-center justify-center rounded-xl px-3 leading-tight transition hover:scale-105 ${
                me.frozen ? "bg-gradient-to-b from-sky-300 to-sky-500 text-black shadow-[0_0_14px_rgba(125,211,252,0.7)]" : "border-2 border-sky-400/60 bg-sky-950/60 text-sky-100"
              }`}
              title="잠그면 다음 라운드에도 같은 상점이 유지돼요 (단축키 F)"
            >
              <span className="text-sm font-black">{me.frozen ? "🔒 잠금 해제" : "🔓 상점 잠금"}</span>
              <span className="text-[10px] opacity-70">F</span>
            </button>
            <button
              disabled={me.freeRerolls === 0 && me.gold < REROLL_COST}
              onClick={reroll}
              className="flex h-11 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 px-4 leading-tight text-black shadow-[0_0_12px_rgba(251,191,36,0.4)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
              title="상점을 새로 뽑아요 (단축키 R)"
            >
              <span className="text-sm font-black">🔄 새로고침</span>
              <span className="text-[11px] font-bold">{me.freeRerolls > 0 ? `무료 ${me.freeRerolls}회` : `🪙${REROLL_COST}`} · R</span>
            </button>
          </span>
        </div>
        {me.frozen && <p className="rounded-lg bg-sky-400/15 px-2 py-1 text-xs font-bold text-sky-100">🔒 상점 잠김 — 다음 라운드에도 이 유닛들이 그대로 남아요</p>}
        <div className={`flex min-h-[6rem] flex-wrap items-center gap-3 px-1 sm:min-h-[7rem] ${readyKey ? "pt-7" : "pt-2"} ${me.frozen ? "rounded-xl bg-sky-400/10 ring-2 ring-sky-300/50" : ""}`}>
          {me.shop.map((id, slot) =>
            id ? (
              <TripleSparkle key={`${slot}-${id}`} need={tripleNeed(id)}>
                <UnitCard
                  unit={protoCard(id)}
                  selected={selection?.kind === "shop" && selection.slot === slot}
                  dim={me.gold < BUY_COST}
                  onClick={() => {
                    if (!suppressClickRef.current) setSel(selection?.kind === "shop" && selection.slot === slot ? null : { kind: "shop", slot });
                  }}
                  onPointerDown={(e) => startDrag({ from: "shop", slot }, protoCard(id), e)}
                />
              </TripleSparkle>
            ) : (
              <div key={slot} className="h-[5.4rem] w-[3.9rem] rounded-xl border border-dashed border-white/10 sm:h-[6.8rem] sm:w-20 light:border-amber-300" />
            ),
          )}
          {me.shop.length === 0 && <span className="text-xs text-white/40">상점이 비었어요 — 새로고침!</span>}
        </div>
      </div>

      {toast && (
        <div key={toast.id} className="tb-feed flex items-start gap-2 rounded-xl border border-yellow-300/50 bg-yellow-300/10 px-3 py-2 text-xs text-yellow-50 shadow-[0_0_18px_rgba(253,224,71,0.25)] light:text-amber-900">
          <span className="shrink-0 font-black text-yellow-300 light:text-amber-700">{toast.label}</span>
          <span className="break-keep">
            <AbilityText text={toast.text} />
          </span>
        </div>
      )}

      {/* 보드 */}
      <div data-drop="board" className={`${PANEL} flex flex-col gap-2 transition ${dragging ? "ring-1 ring-emerald-300/40" : ""} ${hoverDrop?.startsWith("board") ? "ring-2 ring-emerald-300/80" : ""}`}>
        <p className={LABEL}>
          <CapBadge label="⚔️ 보드" n={me.board.length} max={BOARD_MAX} /> <span className="ml-1">앞줄 왼쪽부터 공격 · 근접은 상대 앞줄부터, 🏹궁수·🔮마법사는 아무나, 🗡️암살자는 뒷줄부터</span>
        </p>
        {view === "3d" ? (
          <div data-drop="board3d" className="relative overflow-hidden rounded-xl">
            <Arena3D
              units={boardUnits}
              mode="shop"
              apiRef={arenaApi}
              avatars={shopAvatars}
              quality={quality}
              className="h-64 w-full sm:h-72"
              selected={selection?.kind === "board" ? selection.uid : null}
              onGrab={(uid, e) => {
                const u = me.board.find((x) => x.uid === uid);
                if (u) startDrag({ from: "board", uid }, u, e);
              }}
              onPick={(uid) => {
                if (suppressClickRef.current) return;
                if (targeting) return activatePower(uid);
                setSel(selection?.kind === "board" && selection.uid === uid ? null : { kind: "board", uid });
              }}
              insert={
                insertMode && (selection!.kind === "board" || me.board.length < BOARD_MAX)
                  ? { onInsert: (i, back) => place(i, back) }
                  : null
              }
            />
            {me.board.length === 0 && !insertMode && (
              <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-amber-100/70">손패의 유닛을 골라 탁자에 세우세요.</p>
            )}
            {insertMode && <p className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs font-semibold text-yellow-200">✨ 빛나는 자리를 눌러 세우세요</p>}
            {!insertMode && me.board.length > 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-1.5 text-center text-[10px] text-amber-100/55">탁자를 눌러 내 영웅 이동 · PC: WASD/방향키, 스페이스 점프 · 영웅을 누르면 춤</p>
            )}
          </div>
        ) : (
        <div className="flex flex-col gap-1.5">
        {([false, true] as const).map((back) => {
          const list = me.board.map((u, i) => ({ u, i })).filter((x) => !!x.u.back === back);
          const canPlace = insertMode && (selection!.kind === "board" || me.board.length < BOARD_MAX);
          const rowKey = `boardrow:${back ? 1 : 0}`;
          return (
        <div
          key={rowKey}
          data-drop={rowKey}
          className={`relative flex flex-wrap items-center gap-x-3 gap-y-3 rounded-xl px-1 pb-1 pt-6 ${list.length || canPlace ? "min-h-[6rem] sm:min-h-[7rem]" : "min-h-0 pb-2"} ${back ? "bg-sky-500/5" : "bg-rose-500/5"} ${hoverDrop === rowKey ? "outline-2 outline-dashed outline-emerald-300" : ""}`}
        >
          <span className={`pointer-events-none absolute left-2 top-0.5 text-[10px] font-bold ${back ? "text-sky-200/80 light:text-sky-700" : "text-rose-200/80 light:text-rose-700"}`}>
            {back ? "🏹 뒷줄 — 원거리·암살자만 닿아요" : "🛡️ 앞줄 — 근접 공격을 먼저 받아요"}
          </span>
          {list.map(({ u, i }) => (
            <div key={u.uid} data-drop={`board:${i}:${back ? 1 : 0}`} className={`flex items-center gap-1.5 rounded-xl ${hoverDrop === `board:${i}:${back ? 1 : 0}` ? "outline-2 outline-dashed outline-emerald-300" : ""}`}>
              {canPlace && <InsertMark onClick={() => place(i, back)} />}
              <UnitCard
                unit={u}
                glow={!!boosts[u.uid]}
                float={boosts[u.uid] ?? null}
                selected={selection?.kind === "board" && selection.uid === u.uid}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  if (targeting) return activatePower(u.uid);
                  setSel(selection?.kind === "board" && selection.uid === u.uid ? null : { kind: "board", uid: u.uid });
                }}
                onPointerDown={(e) => startDrag({ from: "board", uid: u.uid }, u, e)}
                dim={dragging?.data.from === "board" && dragging.data.uid === u.uid}
              />
            </div>
          ))}
          {canPlace && <InsertMark onClick={() => place(back ? me.board.length : frontCount, back)} />}
          {list.length === 0 && !insertMode && <span className="text-xs text-white/40 light:text-amber-800/50">{back ? "비어 있음" : me.board.length ? "비어 있음 — 상대 근접 공격이 바로 뒷줄로 와요" : "손패의 유닛을 골라 보드에 내세요."}</span>}
        </div>
          );
        })}
        </div>
        )}
      </div>

      {/* 손패 */}
      <div data-drop="hand" className={`${PANEL} flex flex-col gap-2 transition ${hoverDrop === "hand" ? "ring-2 ring-sky-300/80" : ""}`}>
        <p className={LABEL}>
          <CapBadge label="🖐️ 손패" n={me.hand.length} max={HAND_MAX} /> <span className="ml-1">같은 유닛 3장 = 황금</span>
        </p>
        <div className="flex min-h-[6rem] flex-wrap items-center gap-3 px-1 pt-2 sm:min-h-[7rem]">
          {me.hand.map((u) => (
            <UnitCard
              key={u.uid}
              unit={u}
              selected={selection?.kind === "hand" && selection.uid === u.uid}
              onClick={() => {
                if (!suppressClickRef.current) setSel(selection?.kind === "hand" && selection.uid === u.uid ? null : { kind: "hand", uid: u.uid });
              }}
              onPointerDown={(e) => startDrag({ from: "hand", uid: u.uid }, u, e)}
              dim={dragging?.data.from === "hand" && dragging.data.uid === u.uid}
            />
          ))}
          {me.hand.length === 0 && <span className="text-xs text-white/40 light:text-amber-800/50">상점에서 산 유닛이 여기로 와요.</span>}
        </div>
      </div>

      {/* 끌기: 손가락을 따라오는 카드 + 화면 아래 판매/구매 막대 */}
      {dragging && (
        <>
          <div className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-[70%] rotate-6 opacity-90 drop-shadow-[0_10px_18px_rgba(0,0,0,0.6)]" style={{ left: dragging.x, top: dragging.y }}>
            <UnitCard unit={dragging.card} />
          </div>
          <div
            data-drop={dragging.data.from === "shop" ? "hand" : "sell"}
            className={`fixed inset-x-3 bottom-3 z-[55] flex items-center justify-center rounded-2xl border-2 border-dashed py-4 text-sm font-black shadow-2xl transition ${
              dragging.data.from === "shop"
                ? `border-sky-300 bg-sky-950/90 text-sky-100 ${hoverDrop === "hand" ? "scale-105 bg-sky-800/95" : ""}`
                : `border-yellow-300 bg-stone-950/90 text-yellow-200 ${hoverDrop === "sell" ? "scale-105 bg-yellow-700/90 text-white" : ""}`
            }`}
          >
            {dragging.data.from === "shop" ? `🛒 여기(또는 손패·보드)에 놓으면 구매 🪙${BUY_COST}` : `💰 여기에 놓으면 판매 +${sellPreview}골드`}
          </div>
        </>
      )}

      {/* 선택 정보 + 행동 */}
      {(selectedUnit || shopUnit) && (
        <div className={`${PANEL} sticky bottom-2 z-10 flex flex-col gap-2 border-amber-400/40 sm:flex-row sm:items-center`}>
          <UnitDetail unit={(selectedUnit ?? shopUnit)!} />
          <div className="flex shrink-0 flex-wrap gap-1.5 sm:ml-auto">
            {selection?.kind === "shop" && (
              <button disabled={me.gold < BUY_COST || me.hand.length >= HAND_MAX} onClick={() => buy(selection.slot)} className={BTN_GOLD}>
                구매 🪙{BUY_COST}
              </button>
            )}
            {selection?.kind === "hand" && (
              <>
                <button disabled={me.board.length >= BOARD_MAX} onClick={() => play(selection.uid, frontCount, false)} className={BTN_GOLD}>
                  🛡️ 앞줄에 내기
                </button>
                <button disabled={me.board.length >= BOARD_MAX} onClick={() => play(selection.uid, me.board.length, true)} className={BTN_GOLD}>
                  🏹 뒷줄에 내기
                </button>
              </>
            )}
            {selection?.kind === "board" && selectedUnit && (
              <>
                {(() => {
                  const i = me.board.findIndex((u) => u.uid === selectedUnit.uid);
                  const back = !!selectedUnit.back;
                  const row = me.board.filter((u) => !!u.back === back);
                  return (
                    <>
                      <button disabled={row[0]?.uid === selectedUnit.uid} onClick={() => move(selectedUnit.uid, i - 1, back)} className={BTN_DARK}>
                        ◀
                      </button>
                      <button disabled={row.at(-1)?.uid === selectedUnit.uid} onClick={() => move(selectedUnit.uid, i + 1, back)} className={BTN_DARK}>
                        ▶
                      </button>
                      <button onClick={() => move(selectedUnit.uid, rowEnd(!back, selectedUnit.uid), !back)} className={BTN_DARK} title="앞줄과 뒷줄 바꾸기">
                        {back ? "⬆ 앞줄로" : "⬇ 뒷줄로"}
                      </button>
                    </>
                  );
                })()}
                {hero?.id === "mage" && powerReady && (
                  <button onClick={() => activatePower(selectedUnit.uid)} className={BTN_DARK}>
                    🧙 +1/+1
                  </button>
                )}
              </>
            )}
            {selectedUnit && (
              <button onClick={() => sell(selectedUnit.uid)} className={BTN_DARK}>
                판매 +🪙{sellValue(me, selectedUnit)}
              </button>
            )}
          </div>
        </div>
      )}

      {me.discover.length > 0 && <DiscoverModal options={me.discover[0]} onPick={(pick) => send({ type: "DISCOVER", seat: viewerSeat, round, pick }, "discover")} />}
    </div>
  );
}

const SPARKLE_CSS = `
@keyframes tb-tr-aura { 0%,100% { opacity:.55; transform:scale(1) } 50% { opacity:1; transform:scale(1.06) } }
@keyframes tb-tr-spin { to { transform: rotate(360deg) } }
@keyframes tb-tr-twinkle { 0%,100% { opacity:0; transform:scale(.3) rotate(0) } 50% { opacity:1; transform:scale(1.2) rotate(90deg) } }
@keyframes tb-tr-bob { 0%,100% { transform:translate(-50%,0) } 50% { transform:translate(-50%,-3px) } }
.tb-tr-aura { animation: tb-tr-aura 1.4s ease-in-out infinite; }
.tb-tr-ring { animation: tb-tr-spin 2.6s linear infinite; background: conic-gradient(from 0deg, transparent 0 55%, rgba(253,224,71,.95) 70%, #fff 75%, rgba(253,224,71,.95) 80%, transparent 95%); }
.tb-tr-star { animation: tb-tr-twinkle 1.6s ease-in-out infinite; }
.tb-tr-badge { animation: tb-tr-bob 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .tb-tr-aura, .tb-tr-ring, .tb-tr-star, .tb-tr-badge { animation: none; } }
`;

const TWINKLES = [
  { l: "-10%", t: "8%", d: 0 },
  { l: "92%", t: "18%", d: 0.4 },
  { l: "-6%", t: "70%", d: 0.8 },
  { l: "95%", t: "78%", d: 1.2 },
  { l: "45%", t: "-8%", d: 0.6 },
];

/**
 * 사면 3장이 되는 상점 카드: 금빛 오라 + 테두리를 도는 빛 + 반짝이 + 배지.
 * need 1 = 이 카드 하나로 완성, 2·3 = 상점의 같은 카드를 그만큼 사면 완성(오라만 조금 약하게).
 */
function TripleSparkle({ need, children }: { need: number; children: React.ReactNode }) {
  if (!need) return <>{children}</>;
  return (
    <span className="relative inline-flex" title={need === 1 ? "사면 바로 3장 합성 — 황금 유닛!" : `상점의 같은 카드 ${need}장을 모두 사면 3장 합성 — 황금 유닛!`}>
      <style>{SPARKLE_CSS}</style>
      <span className={`tb-tr-aura pointer-events-none absolute -inset-2 rounded-2xl blur-md ${need === 1 ? "bg-yellow-300/35" : "bg-yellow-300/20"}`} />
      <span className="pointer-events-none absolute -inset-[3px] overflow-hidden rounded-[14px]">
        <span className="tb-tr-ring absolute -inset-1/2" />
      </span>
      <span className="relative">{children}</span>
      {TWINKLES.map((p, i) => (
        <span key={i} className="tb-tr-star pointer-events-none absolute z-10 text-sm text-yellow-200 drop-shadow-[0_0_4px_#fde047]" style={{ left: p.l, top: p.t, animationDelay: `${p.d}s` }}>
          ✦
        </span>
      ))}
      <span className="tb-tr-badge pointer-events-none absolute -top-7 left-1/2 z-10 whitespace-nowrap rounded-full border border-yellow-100 bg-gradient-to-b from-yellow-200 to-amber-500 px-1 text-[9px] font-black tracking-tighter sm:px-1.5 sm:text-[10px] sm:tracking-normal text-amber-950 shadow-[0_0_10px_#facc15]">
        {need === 1 ? "✨ 3장 완성!" : `✨ ${need}장 사면`}
      </span>
    </span>
  );
}

function protoCard(defId: string): CardUnit {
  const d = unitDef(defId);
  return { defId, atk: d.atk, hp: d.hp, golden: false, kw: [...d.keywords] };
}

function InsertMark({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[5.4rem] w-5 items-center justify-center rounded-lg border border-dashed border-yellow-300/60 text-yellow-200 hover:bg-yellow-300/10 sm:h-[6.8rem]" title="여기에 놓기">
      +
    </button>
  );
}

function DiscoverModal({ options, onPick }: { options: string[]; onPick: (i: number) => void }) {
  const [i, setI] = useState(0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="tb-pop w-full max-w-md rounded-2xl border border-yellow-300/50 bg-stone-900 p-4 text-center light:bg-amber-50">
        <p className="font-bold text-yellow-200 light:text-amber-800">✨ 발견! 한 장을 골라 손으로 가져가세요</p>
        <div className="mt-4 flex justify-center gap-3">
          {options.map((id, idx) => (
            <UnitCard key={id} unit={protoCard(id)} selected={i === idx} onClick={() => setI(idx)} />
          ))}
        </div>
        <div className="mt-3 text-left">
          <UnitDetail unit={protoCard(options[i])} />
        </div>
        <button onClick={() => onPick(i)} className={`${BTN_GOLD} mt-3 w-full`}>
          이걸로!
        </button>
      </div>
    </div>
  );
}

/** 상점 단계: 내 준비 상태 + 아직 준비 안 한 손님 이름 */
function ReadyStatus({ state, viewerSeat, names }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string> }) {
  const me = state.seats[viewerSeat];
  const alive = state.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.alive);
  const waiting = alive.filter(({ s, i }) => !s.ready && i !== viewerSeat);
  const readyCount = alive.filter(({ s }) => s.ready).length;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-1.5 text-xs ${me.ready ? "bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/40 light:text-emerald-800" : "bg-black/25 text-white/75 light:bg-amber-50 light:text-slate-700"}`}
    >
      <span className="font-bold">
        {me.ready ? "✅ 준비 완료! 상점이 잠겼어요" : "🛒 상점 보는 중"} · 준비 {readyCount}/{alive.length}
      </span>
      {waiting.length > 0 ? (
        <span className="flex flex-wrap items-center gap-1">
          <span className="opacity-75">⏳ 아직:</span>
          {waiting.map(({ i }) => (
            <span key={i} className="max-w-[7rem] truncate rounded-full bg-amber-500/20 px-2 py-px font-semibold text-amber-100 ring-1 ring-amber-400/40 light:text-amber-800">
              {names[i] ?? `${i + 1}번`}
            </span>
          ))}
        </span>
      ) : (
        !me.ready && <span className="font-semibold text-amber-200 light:text-amber-700">다른 손님은 모두 준비했어요 — 내가 누르면 전투 시작!</span>
      )}
    </div>
  );
}

function Spectator({ state, viewerSeat }: { state: GameState; viewerSeat: Seat }) {
  const me = state.seats[viewerSeat];
  const waiting = state.seats.filter((s) => s.alive && !s.ready).length;
  return (
    <div className={`${PANEL} flex flex-col items-center gap-2 p-6 text-center`}>
      <span className="text-4xl">🪦</span>
      <p className="font-bold text-white light:text-slate-900">{me.place}위로 탈락했어요</p>
      <p className="text-xs text-white/60 light:text-slate-600">남은 손님들이 상점을 보는 중이에요 ({waiting}명). 전투가 시작되면 관전할 수 있어요.</p>
    </div>
  );
}

/* ── 전투 ─────────────────────────────────────────────────── */

function CombatView({
  onMyCombatEnded,
  state,
  viewerSeat,
  names,
  onAction,
  view,
  quality,
  emotes,
}: {
  onMyCombatEnded: () => void;
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  onAction: (a: EngineAction) => void;
  view: View;
  quality: "high" | "low";
  emotes: Record<Seat, EmoteSlot>;
}) {
  const me = state.seats[viewerSeat];
  const mine = combatFor(state, viewerSeat);
  const [watch, setWatch] = useState(() => (mine ? state.combats.indexOf(mine) : 0));
  const [speed, setSpeed] = useState(1);
  const c = state.combats[watch] ?? state.combats[0];
  const doneSentRef = useRef(false);
  const finishMine = () => {
    if (doneSentRef.current || !me.inCombat || me.combatDone) return;
    doneSentRef.current = true;
    onAction({ type: "COMBAT_DONE", seat: viewerSeat, round: state.round });
  };
  const waitingFor = useMemo(() => state.seats.filter((s) => s.inCombat && !s.combatDone).length, [state.seats]);
  if (!c) return null;
  const isMine = mine !== null && c === mine;
  const viewSide = isMine ? sideOfSeat(c, viewerSeat) : 0;
  const pair = combatNames(c, names);
  const hpOf = (seat: number) => (seat < 0 ? null : state.seats[seat].hp);
  const hpPair: [number | null, number | null] = viewSide === 0 ? [hpOf(c.a), hpOf(c.b)] : [hpOf(c.b), hpOf(c.a)];
  const emoteOf = (seat: number) => (seat < 0 ? undefined : emotes[seat]);
  const emotePair: [EmoteSlot | undefined, EmoteSlot | undefined] = viewSide === 0 ? [emoteOf(c.a), emoteOf(c.b)] : [emoteOf(c.b), emoteOf(c.a)];
  const shownNames: [string, string] = viewSide === 0 ? pair : [pair[1], pair[0]];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {state.combats.map((x, i) => {
          const nm = combatNames(x, names);
          return (
            <button
              key={i}
              onClick={() => setWatch(i)}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${i === watch ? "border-amber-400 bg-amber-400/15 text-amber-100 light:text-amber-800" : "border-white/15 text-white/55 light:border-amber-200 light:text-slate-500"}`}
            >
              {x === mine ? "⭐ 내 전투" : `${nm[0]} vs ${nm[1]}`}
            </button>
          );
        })}
        <button onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))} className={`${BTN_DARK} ml-auto py-1`}>
          ⏩ ×{speed}
        </button>
      </div>
      {view === "3d" ? (
        <Combat3D key={`${state.round}-${watch}`} combat={c} viewSide={viewSide} names={shownNames} speed={speed} sound={isMine} quality={quality} hp={hpPair} emotes={emotePair} controllable={isMine} onFinished={isMine ? finishMine : undefined} onEnded={isMine ? onMyCombatEnded : undefined} />
      ) : (
        <CombatReplay key={`${state.round}-${watch}`} combat={c} viewSide={viewSide} names={shownNames} speed={speed} sound={isMine} hp={hpPair} emotes={emotePair} onFinished={isMine ? finishMine : undefined} onEnded={isMine ? onMyCombatEnded : undefined} />
      )}
      {state.eliminatedThisRound.length > 0 && (
        <p className="rounded-xl bg-rose-500/15 px-3 py-1.5 text-center text-xs text-rose-200 light:text-rose-700">
          💀 이번 라운드 탈락: {state.eliminatedThisRound.map((s) => `${names[s]}(${state.seats[s].place}위)`).join(", ")}
        </p>
      )}
      <div className="flex items-center justify-center gap-2 text-xs text-white/50 light:text-slate-500">
        {me.inCombat && !me.combatDone ? (
          <button onClick={finishMine} className={BTN_DARK}>
            ⏭ 결과 보고 다음으로
          </button>
        ) : (
          <span>다음 상점까지 {waitingFor}명이 전투를 보는 중…</span>
        )}
      </div>
    </div>
  );
}

/* ── 결과 ─────────────────────────────────────────────────── */

/** 최종 보드의 종족·직업 — 켜진 시너지는 단계 색, 1명뿐인 건 흐리게 */
function FinalTraits({ board }: { board: readonly CardUnit[] }) {
  const traits = traitsOf(board);
  if (!traits.length) return null;
  return (
    <div className="flex flex-wrap gap-1 pl-8">
      {traits.map((t) => {
        const lv = synergyLevel(t.count);
        return (
          <span
            key={t.key}
            title={`${t.name} ${t.count}명${lv ? ` — ${lv}단계 켜짐` : ""}`}
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${
              lv >= 6
                ? "border-yellow-200 bg-yellow-400/25 text-yellow-100"
                : lv >= 4
                  ? "border-slate-200/70 bg-slate-300/20 text-slate-100"
                  : lv >= 2
                    ? "border-amber-500/70 bg-amber-700/30 text-amber-100"
                    : "border-white/10 text-white/45"
            } light:text-slate-800`}
          >
            {t.emoji} {t.name} {t.count}
          </span>
        );
      })}
    </div>
  );
}

function RpDelta({ v }: { v: number }) {
  return (
    <span className={`w-14 shrink-0 text-right text-xs font-black tabular-nums ${v > 0 ? "text-emerald-300 light:text-emerald-600" : v < 0 ? "text-rose-300 light:text-rose-600" : "text-white/40"}`}>
      {v > 0 ? `+${v}` : v} RP
    </span>
  );
}

function TierBadge({ tier, big }: { tier: RankTier; big?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-gradient-to-b px-2.5 py-0.5 font-black shadow ${tier.badge} ${big ? "text-base" : "text-xs"}`}>
      {tier.emoji} {tier.name}
    </span>
  );
}

/** 내 누적 랭크 점수: 이전 → 이번 판 반영 후, 승급/강등 표시. 게임이 끝나면 자동으로 기록된다. */
function MyRankCard({ result }: { result: RankResult | null }) {
  if (!result) return <p className="text-center text-[11px] text-white/40">🏆 랭크 점수 반영 중…</p>;
  const { prev, next, delta } = result;
  const before = tierOf(prev);
  const after = tierOf(next);
  const change = tierChange(prev, next);
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-3 ${change === "promoted" ? "tb-upglow border-yellow-300/70 bg-yellow-400/10" : change === "demoted" ? "border-rose-400/60 bg-rose-500/10" : "border-white/10 bg-black/25 light:bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-white/60 light:text-slate-500">🏆 랭크</span>
        {before.index !== after.index && (
          <>
            <TierBadge tier={before.tier} />
            <span className="text-white/50">→</span>
          </>
        )}
        <TierBadge tier={after.tier} big />
        {change === "promoted" && <span className="tb-pop rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-black text-black">⬆ 승급!</span>}
        {change === "demoted" && <span className="tb-pop rounded-full bg-rose-600 px-2 py-0.5 text-xs font-black text-white">⬇ 강등</span>}
        <span className="ml-auto text-sm font-black tabular-nums text-white light:text-slate-900">
          {prev} → {next} RP <RpDelta v={delta} />
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-200" style={{ width: `${Math.round(after.progress * 100)}%` }} />
      </div>
      <p className="mt-1 flex justify-between text-[10px] text-white/45 light:text-slate-500">
        <span>{after.next ? `${after.next.emoji} ${after.next.name}까지 ${after.next.min - next} RP` : "최고 티어!"}</span>
        <span>
          1~4위 +40/+30/+20/+10 · 5~8위 −10/−20/−30/−40 ·{" "}
          <a href="/stats" target="_blank" rel="noreferrer" className="underline">
            랭킹 보기
          </a>
        </span>
      </p>
      <p className="text-[10px] text-white/35">{result.counted ? "✓ 자동으로 반영됐어요." : "봇이 대신 끝낸 판이라 랭크에 반영되지 않았어요."}</p>
    </div>
  );
}

function Standings({
  state,
  viewerSeat,
  names,
  onGameEnd,
  rankResult,
}: {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  onGameEnd: () => void;
  rankResult: RankResult | null;
}) {
  const order = state.seats.map((s, i) => ({ s, i })).sort((a, b) => (a.s.place ?? 99) - (b.s.place ?? 99));
  const me = state.seats[viewerSeat];
  return (
    <div className={`${PANEL} flex flex-col gap-3 p-4`}>
      <p className="text-center text-xl font-black text-yellow-200 light:text-amber-700">{me.place === 1 ? "🏆 여관의 챔피언!" : `🏁 ${me.place}위`}</p>
      <MyRankCard result={rankResult} />
      <div className="flex flex-col gap-2">
        {order.map(({ s, i }) => {
          const hero = s.hero ? HERO_BY_ID[s.hero] : null;
          return (
            <div key={i} className={`flex flex-col gap-1.5 rounded-xl p-2 ${i === viewerSeat ? "bg-amber-400/10 ring-1 ring-amber-400/40" : "bg-black/20 light:bg-white"}`}>
              <p className="flex items-center gap-2 text-sm">
                <span className="w-8 font-black text-amber-300 light:text-amber-700">{s.place}위</span>
                <span>{hero?.emoji}</span>
                <span className="font-semibold text-white light:text-slate-900">{names[i]}</span>
                <span className="ml-auto text-xs text-white/50 light:text-slate-500">
                  🏠{s.stats.maxTier} · {s.stats.wins}승 {s.stats.losses}패 · ✨{s.stats.triples}
                </span>
                <RpDelta v={rpForRank(s.place ?? state.seatCount, state.seatCount)} />
              </p>
              <FinalTraits board={s.board} />
              <div className="flex flex-wrap gap-2.5 pl-8 pb-1.5">
                {s.board.map((u) => (
                  <UnitCard key={u.uid} unit={u} size="sm" />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={onGameEnd} className={`${BTN_GOLD} self-center px-6`}>
        마치기
      </button>
    </div>
  );
}
