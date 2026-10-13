"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { classCounts, synergyLevel, tribeCounts, type UnitInstance } from "./combat";
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
import { CLASSES, CLASS_ORDER, HERO_BY_ID, SHOP_SLOTS, type HeroId, TRIBES, TRIBE_ORDER, UPGRADE_BASE, unitDef } from "./units";
import UnitCard, { UnitDetail, type CardUnit } from "./UnitCard";
import CombatReplay, { COMBAT_CSS, sideOfSeat } from "./CombatReplay";
import RulebookModal from "./RulebookModal";
import { AbilityText } from "./AbilityFeed";
import { UnitTooltipHost, unitTip } from "./UnitTooltip";
import { EmoteBubble, EmotePicker, type EmoteKind, type EmoteSlot } from "./emotes";
import SynergyTracker, { traitsOf } from "./SynergyTracker";
import { listPlayerStats } from "@/lib/stats/playerStats";
import { applyRp, rpForRank, rpFromDetails, tierChange, tierOf, type RankTier } from "@/lib/stats/rankTier";
import HeroPreview from "./HeroPreview";
import CombatStats from "./CombatStats";
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
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
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


function SynergyBar({ board, compact }: { board: CardUnit[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const tc = tribeCounts(board);
  const cc = classCounts(board);
  const items = [
    ...TRIBE_ORDER.filter((t) => tc[t] > 0).map((t) => ({ key: t, n: tc[t], ...TRIBES[t] })),
    ...CLASS_ORDER.filter((k) => cc[k] > 0).map((k) => ({ key: k, n: cc[k], ...CLASSES[k] })),
  ].sort((x, y) => synergyLevel(y.n) - synergyLevel(x.n) || y.n - x.n);
  if (items.length === 0) return compact ? null : <p className="text-[11px] text-white/35 light:text-amber-800/50">같은 종족·직업을 2·4·6명 모으면 시너지가 켜져요.</p>;
  const sel = items.find((i) => i.key === open);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {items.map((it) => {
          const lv = synergyLevel(it.n);
          const next = [2, 4, 6].find((x) => x > it.n);
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => setOpen(open === it.key ? null : it.key)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                lv ? "border-yellow-300/70 bg-yellow-300/15 text-yellow-100 light:text-amber-900" : "border-white/15 text-white/55 light:border-amber-300 light:text-amber-800/70"
              }`}
              style={lv ? { boxShadow: `0 0 8px ${it.color}66` } : undefined}
            >
              {it.emoji} {it.name} {it.n}
              {next ? <span className="opacity-60">/{next}</span> : " ✓"}
            </button>
          );
        })}
      </div>
      {sel && (
        <ul className="rounded-lg bg-black/30 px-2 py-1 text-[11px] text-white/70 light:bg-white light:text-slate-600">
          {sel.levels.map(([n, text]) => (
            <li key={n} className={sel.n >= n ? "font-semibold text-yellow-200 light:text-amber-700" : ""}>
              ({n}) {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
      <p className={LABEL}>🍻 손님들 (누르면 지난 전투 보드)</p>
      {order.map(({ s, i }) => {
        const hero = s.hero ? HERO_BY_ID[s.hero] : null;
        const status = !s.alive ? `💀 ${s.place}위` : state.phase === "shop" ? (s.ready ? "✅" : "🤔") : state.phase === "heroPick" ? (s.hero ? "✅" : "🤔") : "";
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
                  {s.winStreak >= 2 ? `🔥${s.winStreak}` : ""} {status}
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

function InspectModal({ state, seat, names, onClose }: { state: GameState; seat: Seat; names: Record<Seat, string>; onClose: () => void }) {
  const s = state.seats[seat];
  const hero = s.hero ? HERO_BY_ID[s.hero] : null;
  // 공개 정보만: 지난 전투에서 드러난 보드(자기 자신이면 현재 보드)
  const c = state.combats.find((x) => x.a === seat || x.b === seat);
  const board: CardUnit[] = c ? (c.a === seat ? c.sideA.board : c.sideB.board) : [];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-amber-900/40 bg-stone-900 p-4 light:border-amber-300 light:bg-amber-50" onClick={(e) => e.stopPropagation()}>
        <p className="font-bold text-white light:text-slate-900">
          {hero?.emoji} {names[seat]} <span className="text-xs font-normal text-white/50 light:text-slate-500">❤️ {Math.max(0, s.hp)} · 🏠 {s.tier}등급 · {s.stats.wins}승 {s.stats.losses}패</span>
        </p>
        {hero && (
          <p className="mt-1 text-xs text-white/60 light:text-slate-600">
            {hero.name} — {hero.power}: {hero.text}
          </p>
        )}
        <p className="mt-3 text-xs text-white/50 light:text-slate-500">{c ? "지난 전투에서 드러난 보드" : "아직 전투 기록이 없어요"}</p>
        <div className="mt-3 flex flex-wrap gap-2.5 pb-2">
          {board.map((u, i) => (
            <UnitCard key={i} unit={u} size="sm" />
          ))}
        </div>
        <SynergyBar board={board} compact />
        <button onClick={onClose} className={`${BTN_DARK} mt-3 w-full`}>
          닫기
        </button>
      </div>
    </div>
  );
}

function Timer({ deadlineMs, nowMs }: { deadlineMs: number | null; nowMs: number }) {
  if (!deadlineMs) return null;
  const left = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${left <= 5 ? "bg-rose-500 text-white" : "bg-black/40 text-amber-100 light:bg-white light:text-amber-900"}`}>⏱ {left}</span>;
}

export default function TavernBrawlBoard({ state, viewerSeat, names, connectedSeats, deadlineMs, nowMs, onAction, onGameEnd, emotes = {}, onEmote }: Props) {
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
  const triplesRef = useRef(me.stats.triples);
  useEffect(() => {
    if (me.stats.triples > triplesRef.current) sfx("golden");
    triplesRef.current = me.stats.triples;
  }, [me.stats.triples]);
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
        <Timer deadlineMs={deadlineMs} nowMs={nowMs} />
        {statsReady && (
          <button
            onClick={() => setStatsView((v) => (v ? null : { round: state.round, auto: false }))}
            className={`rounded-full border px-2.5 py-1 text-xs ${statsView ? "border-amber-400 bg-amber-400/15 text-amber-100 light:text-amber-800" : "border-white/15 text-white/70 light:border-amber-300 light:text-amber-800"}`}
            title="이번(지난) 전투에서 유닛별 넣은 피해·받은 피해"
          >
            📊 전투 통계
          </button>
        )}
        {onEmote && state.phase !== "ended" && <EmotePicker onEmote={onEmote} />}
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
  if (state.phase === "heroPick") body = <HeroPick state={state} viewerSeat={viewerSeat} names={names} onAction={onAction} />;
  else if (state.phase === "shop" && me.alive) body = <ShopView state={state} viewerSeat={viewerSeat} onAction={onAction} view={view} quality={quality} myEmote={emotes[viewerSeat]} />;
  else if (state.phase === "shop") body = <Spectator state={state} viewerSeat={viewerSeat} />;
  else if (state.phase === "combat") body = <CombatView key={state.round} onMyCombatEnded={onMyCombatEnded} state={state} viewerSeat={viewerSeat} names={names} onAction={onAction} view={view} quality={quality} emotes={emotes} />;
  else body = <Standings state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />;

  return (
    <div className="flex flex-col gap-3">
      <style>{COMBAT_CSS}</style>
      <UnitTooltipHost />
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
      <div className={`grid gap-3 lg:grid-cols-[1fr_17rem] ${tracker ? "xl:grid-cols-[15rem_1fr_17rem]" : ""}`}>
        {tracker && <div className="relative z-40 hidden xl:block">{tracker("column")}</div>}
        <div className="min-w-0">
          {tracker && <div className="mb-2 xl:hidden">{tracker("strip")}</div>}
          {body}
        </div>
        {state.phase !== "heroPick" && state.phase !== "ended" && (
          <PlayersPanel state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} onInspect={setInspect} emotes={emotes} />
        )}
      </div>
      {rules && <RulebookModal onClose={() => setRules(false)} />}
      {inspect !== null && <InspectModal state={state} seat={inspect} names={names} onClose={() => setInspect(null)} />}
    </div>
  );
}

/* ── 영웅 고르기 ─────────────────────────────────────────── */

function HeroPick({ state, viewerSeat, names, onAction }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; onAction: (a: EngineAction) => void }) {
  const me = state.seats[viewerSeat];
  const waiting = state.seats.map((s, i) => (s.hero ? null : names[i])).filter(Boolean);
  // 능력 미리보기: 마우스오버(넓은 화면) 또는 "미리보기" 탭(모바일)
  const [hover, setHover] = useState<string | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  return (
    <div className={`${PANEL} flex flex-col items-center gap-4 p-5`}>
      <p className="text-center text-sm text-amber-100/80 light:text-amber-900">영웅 3명 중 한 명을 고르세요. 영웅마다 고유 능력이 있어요. 마우스를 올리면 능력 미리보기가 보여요.</p>
      <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
        {me.heroOptions.map((id) => {
          const h = HERO_BY_ID[id];
          const picked = me.hero === id;
          return (
            <div key={id} className="relative flex flex-col gap-1" onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover((h) => (h === id ? null : h))}>
            <button
              disabled={me.hero !== null}
              onClick={() => {
                sfx("power");
                onAction({ type: "PICK_HERO", seat: viewerSeat, hero: id });
              }}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-center transition ${
                picked ? "border-yellow-300 bg-yellow-300/10" : "border-amber-900/40 bg-black/20 hover:border-amber-400 light:border-amber-300 light:bg-white"
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
              onClick={() => setTapped(tapped === id ? null : id)}
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
  onAction,
  view,
  quality,
  myEmote,
}: {
  state: GameState;
  viewerSeat: Seat;
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
  const play = (uid: string, index: number) => {
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
    send({ type: "PLAY", seat: viewerSeat, round, uid, index }, "play");
    setSel(null);
  };
  const move = (uid: string, index: number) => {
    send({ type: "MOVE", seat: viewerSeat, round, uid, index });
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
    if (k.startsWith("board:")) index = Number(k.slice(6));
    else if (k === "board3d") index = arenaApi.current?.nearestInsert(d.x, d.y) ?? me.board.length;
    else if (k !== "board") return;
    if (data.from === "hand") play(data.uid, index);
    else move(data.uid, index);
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
        <button
          onClick={() => send({ type: "READY", seat: viewerSeat, round }, "ready")}
          className={`${BTN_GREEN} ml-auto px-4`}
        >
          ⚔️ 준비 완료
        </button>
      </div>
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
        <div className={`flex min-h-[6rem] flex-wrap items-center gap-3 px-1 pt-2 sm:min-h-[7rem] ${me.frozen ? "rounded-xl bg-sky-400/10 ring-2 ring-sky-300/50" : ""}`}>
          {me.shop.map((id, slot) =>
            id ? (
              <UnitCard
                key={`${slot}-${id}`}
                unit={protoCard(id)}
                selected={selection?.kind === "shop" && selection.slot === slot}
                dim={me.gold < BUY_COST}
                onClick={() => {
                  if (!suppressClickRef.current) setSel(selection?.kind === "shop" && selection.slot === slot ? null : { kind: "shop", slot });
                }}
                onPointerDown={(e) => startDrag({ from: "shop", slot }, protoCard(id), e)}
              />
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
          <CapBadge label="⚔️ 보드" n={me.board.length} max={BOARD_MAX} /> <span className="ml-1">왼쪽부터 공격해요</span>
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
                  ? { onInsert: (i) => (selection!.kind === "hand" ? play(selection!.uid, i) : move(selection!.uid, i)) }
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
        <div className="flex min-h-[6rem] flex-wrap items-center gap-x-3 gap-y-3 px-1 pt-2 sm:min-h-[7rem]">
          {me.board.map((u, i) => (
            <div key={u.uid} data-drop={`board:${i}`} className={`flex items-center gap-1.5 rounded-xl ${hoverDrop === `board:${i}` ? "outline-2 outline-dashed outline-emerald-300" : ""}`}>
              {insertMode && <InsertMark onClick={() => (selection!.kind === "hand" ? play(selection!.uid, i) : move(selection!.uid, i))} />}
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
          {insertMode && (selection!.kind === "board" || me.board.length < BOARD_MAX) && (
            <InsertMark onClick={() => (selection!.kind === "hand" ? play(selection!.uid, me.board.length) : move(selection!.uid, me.board.length))} />
          )}
          {me.board.length === 0 && !insertMode && <span className="text-xs text-white/40 light:text-amber-800/50">손패의 유닛을 골라 보드에 내세요.</span>}
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
              <button disabled={me.board.length >= BOARD_MAX} onClick={() => play(selection.uid, me.board.length)} className={BTN_GOLD}>
                보드에 내기
              </button>
            )}
            {selection?.kind === "board" && selectedUnit && (
              <>
                <button disabled={me.board[0]?.uid === selectedUnit.uid} onClick={() => move(selectedUnit.uid, me.board.findIndex((u) => u.uid === selectedUnit.uid) - 1)} className={BTN_DARK}>
                  ◀
                </button>
                <button disabled={me.board.at(-1)?.uid === selectedUnit.uid} onClick={() => move(selectedUnit.uid, me.board.findIndex((u) => u.uid === selectedUnit.uid) + 1)} className={BTN_DARK}>
                  ▶
                </button>
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

/** 내 누적 랭크 점수: 지금 → 이번 판 반영 후, 승급/강등 표시. 실제 기록은 "결과 저장"에서. */
function MyRankCard({ rank, players }: { rank: number; players: number }) {
  const [prev, setPrev] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void listPlayerStats().then((all) => {
      if (alive) setPrev(rpFromDetails(all.find((t) => t.gameId === "tavern-brawl")?.details));
    });
    return () => {
      alive = false;
    };
  }, []);
  if (prev === null) return null;
  const { delta, next } = applyRp(prev, rank, players);
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
      <p className="text-[10px] text-white/35">「결과 저장하고 마치기」를 눌러야 반영돼요.</p>
    </div>
  );
}

function Standings({ state, viewerSeat, names, onGameEnd }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const order = state.seats.map((s, i) => ({ s, i })).sort((a, b) => (a.s.place ?? 99) - (b.s.place ?? 99));
  const me = state.seats[viewerSeat];
  return (
    <div className={`${PANEL} flex flex-col gap-3 p-4`}>
      <p className="text-center text-xl font-black text-yellow-200 light:text-amber-700">{me.place === 1 ? "🏆 여관의 챔피언!" : `🏁 ${me.place}위`}</p>
      <MyRankCard rank={me.place ?? state.seatCount} players={state.seatCount} />
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
        결과 저장하고 마치기
      </button>
    </div>
  );
}
