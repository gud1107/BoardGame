"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  ACTIVITY_INFO,
  BLOCK_INFO,
  CHALLENGE_BY_ID,
  DAY_NAMES,
  EVENTS,
  GOAL_BY_ID,
  OPPORTUNITY_BY_ID,
  TRACKS,
  TRACK_INFO,
  TUNING,
  type Activity,
} from "./data";
import {
  bannedActivities,
  canResist,
  computeRankings,
  forcedBlocks,
  goalIdOf,
  goalProgressInfo,
  habitAt,
  pendingSeats,
  previewDay,
  resistCost,
  scoreBreakdown,
  soloGrade,
  temptationOf,
  temptationPlacements,
  totalDays,
  type BlockOutcome,
  type Cell,
  type DayRecord,
  type EngineAction,
  type GameState,
  type Plan,
  type ScoreBreakdown,
  type Seat,
  type SeatState,
} from "./engine";
import { ACTIVITY_HELP, EVENT_TIPS, situationNotes, type GuideTone } from "./guide";
import DayReplay from "./DayReplay";
import { cellArg, getGodLifePlannerSound, godLifePlannerCues } from "./godLifePlannerSound";
import RulebookModal from "./RulebookModal";

interface Props {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: ReadonlySet<Seat>;
  /** 지금 단계가 끝나는 시각(이 기기 기준). 제한 없음/알 수 없음이면 null. */
  deadlineMs: number | null;
  /** 지금 단계의 전체 제한 시간(ms). 0이면 무제한. */
  phaseMs: number;
  nowMs: number;
  committedPlan: Plan | null;
  onAction: (action: EngineAction) => void;
  onCommit: (plan: Plan) => void;
  onGameEnd: () => void;
}

const CARD = "rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white light:shadow-sm";
const SUB = "text-xs text-white/50 light:text-slate-500";
const PRIMARY = "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40";
const GHOST =
  "rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400";

const PALETTE: Activity[] = ["sleep", "study", "exercise", "work", "meet", "rest", "empty"];

const CELL_TONE: Record<Cell, string> = {
  sleep: "bg-indigo-500/15 border-indigo-400/30 light:bg-indigo-50 light:border-indigo-200",
  study: "bg-sky-500/15 border-sky-400/30 light:bg-sky-50 light:border-sky-200",
  exercise: "bg-orange-500/15 border-orange-400/30 light:bg-orange-50 light:border-orange-200",
  work: "bg-amber-500/15 border-amber-400/30 light:bg-amber-50 light:border-amber-200",
  meet: "bg-pink-500/15 border-pink-400/30 light:bg-pink-50 light:border-pink-200",
  rest: "bg-emerald-500/15 border-emerald-400/30 light:bg-emerald-50 light:border-emerald-200",
  empty: "bg-white/[0.02] border-white/10 border-dashed light:bg-slate-50 light:border-slate-200",
  temptation: "bg-fuchsia-500/20 border-fuchsia-400/40 light:bg-fuchsia-50 light:border-fuchsia-300",
};

function cellLabel(state: GameState, seat: Seat, cell: Cell, day = state.day): { emoji: string; name: string } {
  if (cell === "temptation") {
    const t = temptationOf(state, seat, day);
    return { emoji: t.emoji, name: t.name };
  }
  return { emoji: ACTIVITY_INFO[cell].emoji, name: ACTIVITY_INFO[cell].name };
}

function gainsText(o: BlockOutcome): string {
  return TRACKS.filter((t) => o.gains[t])
    .map((t) => `${TRACK_INFO[t].emoji}${o.gains[t]! > 0 ? "+" : ""}${o.gains[t]}`)
    .join(" ");
}

function defaultDraft(state: GameState, seat: Seat): Plan {
  const yesterday = state.seats[seat].days[state.day - 1];
  const base: Cell[] = yesterday
    ? yesterday.plan.cells.map((c) => (c === "temptation" ? "empty" : c))
    : ["sleep", "sleep", "empty", "empty", "empty", "empty", "empty", "sleep"];
  const banned = bannedActivities(state, seat);
  const cells = base.map((c) => (c !== "temptation" && banned.has(c) ? "empty" : c)) as Cell[];
  for (const [b, act] of forcedBlocks(state, seat)) cells[b] = act;
  return { cells, temptation: canResist(state, seat) ? "resist" : "yield", opportunityId: null };
}

function Pips({ value, tone }: { value: number; tone: "hp" | "mp" }) {
  const on = tone === "hp" ? "bg-rose-400" : "bg-violet-400";
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: TUNING.gaugeMax }, (_, i) => (
        <span key={i} className={`h-2.5 w-2 rounded-sm ${i < value ? on : "bg-white/10 light:bg-slate-200"}`} />
      ))}
    </span>
  );
}

function SeatStatus({ s, compact }: { s: SeatState; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70 light:text-slate-600">
        <span className="flex items-center gap-1.5">
          ⚡<Pips value={s.hp} tone="hp" />
          <b className="tabular-nums">{s.hp}</b>
        </span>
        <span className="flex items-center gap-1.5">
          💗<Pips value={s.mp} tone="mp" />
          <b className="tabular-nums">{s.mp}</b>
        </span>
        {s.sick && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-200 light:text-rose-700">🤒 몸살</span>}
        {s.apathy && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-200 light:text-violet-700">😶 무기력</span>}
      </div>
      <div className={`grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
        {TRACKS.map((t) => (
          <div key={t} className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[11px] text-white/60 light:text-slate-500">
              <span>
                {TRACK_INFO[t].emoji}
                {!compact && ` ${TRACK_INFO[t].name}`}
              </span>
              <b className="tabular-nums text-white/90 light:text-slate-800">{s.tracks[t]}</b>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
              <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${(s.tracks[t] / TUNING.trackMax) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HabitChips({ s }: { s: SeatState }) {
  if (s.habits.length === 0) return <span className={SUB}>아직 습관이 없어요 — 같은 블록에 같은 활동을 3일 연속!</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...s.habits]
        .sort((a, b) => a.block - b.block)
        .map((h) => (
          <span
            key={h.block}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              h.shaken ? "border-amber-400/50 text-amber-200 light:text-amber-700" : "border-emerald-400/40 text-emerald-200 light:text-emerald-700"
            }`}
          >
            {h.shaken ? "⚠️" : "🌱"} {BLOCK_INFO[h.block].label} {ACTIVITY_INFO[h.activity].emoji}
            {ACTIVITY_INFO[h.activity].name}
          </span>
        ))}
    </div>
  );
}

function OutcomeCell({ state, seat, o, day, delay, animate }: { state: GameState; seat: Seat; o: BlockOutcome; day: number; delay?: number; animate?: boolean }) {
  const { emoji, name } = cellLabel(state, seat, o.cell, day);
  const dim = o.kind === "void" || o.kind === "fail" || o.kind === "nap";
  return (
    <div
      className={`relative flex min-h-[3.6rem] flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-center ${CELL_TONE[o.cell]} ${dim ? "opacity-60" : ""} ${
        o.matched ? "ring-2 ring-pink-400/70" : ""
      } ${o.opp ? "ring-2 ring-lime-400/70" : ""}`}
      style={animate ? { animation: "glp-pop 0.35s ease both", animationDelay: `${delay ?? 0}ms` } : undefined}
      title={`${name}${o.kind === "fail" ? " (실패)" : o.kind === "void" ? " (무효)" : o.kind === "nap" ? " (쓰러져 잠듦)" : ""}`}
    >
      <span className={`text-base leading-none ${o.kind === "fail" ? "line-through" : ""}`}>{o.kind === "nap" ? "💤" : o.kind === "void" ? "🫥" : emoji}</span>
      <span className="mt-0.5 text-[10px] leading-tight text-white/70 light:text-slate-600">
        {o.kind === "fail" ? "실패" : o.kind === "void" ? "무효" : o.kind === "nap" ? "쓰러짐" : name}
      </span>
      {gainsText(o) && <span className="text-[9px] leading-tight text-emerald-200 light:text-emerald-700">{gainsText(o)}</span>}
      {(o.matched || o.opp || o.noShow) && (
        <span className="absolute -right-1 -top-1 text-[11px]">{o.noShow ? "🙇" : o.opp ? OPPORTUNITY_BY_ID[o.opp]?.emoji : "🤝"}</span>
      )}
    </div>
  );
}

function DayRow({ state, seat, rec, day, animate }: { state: GameState; seat: Seat; rec: DayRecord; day: number; animate?: boolean }) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {rec.outcomes.map((o, b) => (
        <OutcomeCell key={b} state={state} seat={seat} o={o} day={day} delay={b * 140} animate={animate} />
      ))}
    </div>
  );
}

const NOTE_TONE: Record<GuideTone, string> = {
  warn: "border-rose-400/30 bg-rose-500/10 light:border-rose-200 light:bg-rose-50",
  info: "border-sky-400/25 bg-sky-500/[0.07] light:border-sky-200 light:bg-sky-50",
  good: "border-emerald-400/30 bg-emerald-500/10 light:border-emerald-200 light:bg-emerald-50",
};

const SCORE_PARTS: { key: keyof Omit<ScoreBreakdown, "goalMet" | "total">; label: string; help: string }[] = [
  { key: "growth", label: "성장", help: "네 트랙 합" },
  { key: "balance", label: "균형", help: "가장 낮은 트랙 값" },
  { key: "habits", label: "습관", help: "습관 1개 2점(흔들림 1점)" },
  { key: "goal", label: "인생 목표", help: "달성하면 카드 점수" },
  { key: "challenges", label: "주간 도전", help: "먼저 달성한 사람에게" },
  { key: "condition", label: "컨디션", help: "(체력+멘탈)÷4" },
  { key: "penalty", label: "붕괴", help: "탈진·번아웃 1회 −3" },
];

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0";
}

/** 게임 중 남에게 보이는 점수 — 비밀 인생 목표 점수는 끝날 때까지 뺀다(달성 순간 점수 급등으로 목표가 들키지 않게). */
function publicTotal(b: ScoreBreakdown): number {
  return b.total - b.goal;
}

/** 공개 점수 기준 순위(1부터) */
function publicRank(state: GameState, seat: Seat): number {
  const totals = state.seats.map((_, i) => publicTotal(scoreBreakdown(state, i)));
  return 1 + totals.filter((t) => t > totals[seat]).length;
}

function rankLabel(rank: number): string {
  return rank === 1 ? "🥇 1위" : rank === 2 ? "🥈 2위" : rank === 3 ? "🥉 3위" : `${rank}위`;
}

/** 지금 점수 · 순위 · 인생 목표 진행도 — "무엇을 위해 하는지"를 늘 보이게 한다. */
function ScoreCard({ state, seat }: { state: GameState; seat: Seat }) {
  const b = scoreBreakdown(state, seat);
  const myRank = publicRank(state, seat);
  const gid = goalIdOf(state, seat);
  const goal = gid ? GOAL_BY_ID[gid] : null;
  const prog = gid ? goalProgressInfo(gid, state.seats[seat], state.options.days === 5) : null;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-amber-400/[0.07] px-3 py-2.5 light:bg-amber-50">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-white/80 light:text-slate-700">
          🏆 지금 내 점수 <b className="text-lg tabular-nums text-amber-200 light:text-amber-700">{b.total}</b>점
          {state.seatCount > 1 ? (
            <span className="ml-1.5 text-xs text-white/60 light:text-slate-500">
              ({rankLabel(myRank)} / {state.seatCount}명 · 비밀 목표 제외 기준)
            </span>
          ) : (
            <span className="ml-1.5 text-xs text-white/60 light:text-slate-500">(등급: {soloGrade(b.total)})</span>
          )}
        </span>
        <span className="text-[11px] text-white/45 light:text-slate-400">마지막 날 마감 점수로 순위 결정</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {SCORE_PARTS.map((p) => {
          if (p.key === "goal" && !goal) return null;
          const v = b[p.key];
          return (
            <span key={p.key} title={p.help} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/70 light:bg-white light:text-slate-600">
              {p.label} <b className="tabular-nums text-white/90 light:text-slate-800">{p.key === "penalty" ? (v ? `−${v}` : 0) : p.key === "goal" && !b.goalMet ? "아직" : v}</b>
            </span>
          );
        })}
      </div>
      {goal && prog && (
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap justify-between gap-x-2 text-[11px] text-white/65 light:text-slate-500">
            <span className="break-keep">
              🤫 내 인생 목표 {goal.emoji} <b className="text-white/85 light:text-slate-800">{goal.name}</b> — {goal.text}
            </span>
            <span className={prog.met ? "font-bold text-emerald-200 light:text-emerald-700" : ""}>{prog.met ? `달성! +${goal.points}` : `${prog.label} · 달성 시 +${goal.points}`}</span>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <span className={`block h-full rounded-full ${prog.met ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${Math.round(prog.ratio * 100)}%` }} />
          </span>
        </div>
      )}
    </div>
  );
}

/** 계획 단계 — 처음 하는 사람용 3단계 안내 + 오늘 상황에 맞춘 팁. */
function PlanGuide({ state, seat }: { state: GameState; seat: Seat }) {
  const notes = situationNotes(state, seat);
  const evId = state.events[state.day];
  return (
    <div className={`${CARD} flex flex-col gap-2 p-3 sm:p-4`}>
      <details open={state.day === 0} className="group">
        <summary className="cursor-pointer text-sm font-bold text-white light:text-slate-900">🧭 어떻게 하나요? <span className="text-xs font-normal text-white/50 light:text-slate-500">(3단계)</span></summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-xs text-white/75 light:text-slate-600">
          <li className="break-keep">
            <b>활동 버튼</b>(공부·운동…)을 고르고 <b>시간 칸</b>을 눌러 칠해요. 하루는 3시간짜리 8칸(B1 0시 ~ B8 24시)이에요.
          </li>
          <li className="break-keep">
            칸마다 예상 <b>⚡체력 · 💗멘탈</b>과 <b>성장(📘💪💰🤝)</b>이 바로 보여요. 빨간 경고가 없게 수면·휴식을 섞으세요.
          </li>
          <li className="break-keep">
            아래에서 <b>😈 유혹</b>(참기/넘어가기)과 <b>🍀 기회 카드</b>(선택)를 정하고 <b>🔒 계획 확정</b>!
          </li>
        </ol>
        <p className="mt-1.5 break-keep text-[11px] text-white/50 light:text-slate-400">
          💡 점수 = 네 트랙 합 + 가장 낮은 트랙(골고루 키울수록 유리) + 습관 + 인생 목표 + 주간 도전 + 컨디션 − 붕괴. 체력·멘탈이 0이 되면 붕괴(−3점)예요.
        </p>
      </details>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-white/60 light:text-slate-500">📌 오늘의 상황 안내</p>
        <div className={`rounded-lg border px-2.5 py-1.5 text-xs ${NOTE_TONE.info}`}>
          <b className="text-white/90 light:text-slate-800">
            {EVENTS[evId].emoji} {EVENTS[evId].name}
          </b>
          <span className="text-white/70 light:text-slate-600"> — {EVENT_TIPS[evId]}</span>
        </div>
        {notes.map((n) => (
          <div key={n.title} className={`rounded-lg border px-2.5 py-1.5 text-xs ${NOTE_TONE[n.tone]}`}>
            <b className="text-white/90 light:text-slate-800">
              {n.icon} {n.title}
            </b>
            <span className="break-keep text-white/70 light:text-slate-600"> — {n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 하루 결과 — 오늘 무엇이 얼마나 달라졌는지(점수·순위·게이지·트랙·내일 상태). */
function DayChangePanel({ state, seat, rec }: { state: GameState; seat: Seat; rec: DayRecord }) {
  const s = state.seats[seat];
  const before = rec.scoreBefore;
  const after = rec.scoreAfter ?? scoreBreakdown(state, seat);
  const startTracks = rec.startTracks;
  const rankBy = (pick: (r: DayRecord | undefined) => number | undefined): number | null => {
    const totals = state.seats.map((x) => pick(x.days[state.day]));
    // 비밀 목표 점수는 남의 것을 모르니 순위는 목표를 뺀 점수로 비교
    if (totals.some((t) => t === undefined)) return null;
    return 1 + totals.filter((t) => t! > totals[seat]!).length;
  };
  const pub = (b: ScoreBreakdown | undefined) => (b ? publicTotal(b) : undefined);
  const rankBefore = state.day > 0 ? rankBy((r) => pub(r?.scoreBefore)) : null;
  const rankAfter = rankBy((r) => pub(r?.scoreAfter));
  const tomorrow: string[] = [];
  if (s.pendingSick) tomorrow.push("🤒 몸살 — 운동을 할 수 없어요");
  if (s.pendingApathy) tomorrow.push("😶 무기력 — 공부·일을 할 수 없고 유혹도 못 참아요");
  if (s.hangover) tomorrow.push("🍺 숙취 — 아침 체력 −2");
  if (s.emergencyHp) tomorrow.push(`🚑 체력이 최소 ${TUNING.emergencyFloor}까지 응급 회복돼요`);
  if (s.emergencyMp) tomorrow.push(`🚑 멘탈이 최소 ${TUNING.emergencyFloor}까지 응급 회복돼요`);
  const delta = (a: number, b: number) => (
    <span className={`font-bold tabular-nums ${b > a ? "text-emerald-200 light:text-emerald-700" : b < a ? "text-rose-200 light:text-rose-700" : "text-white/40 light:text-slate-400"}`}>{signed(b - a)}</span>
  );
  return (
    <div className={`${CARD} flex flex-col gap-3 p-3 sm:p-4`}>
      <p className="text-sm font-bold text-white light:text-slate-900">📈 오늘 달라진 점</p>
      {before && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-400/[0.07] px-3 py-2.5 light:bg-amber-50">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-white/80 light:text-slate-700">
            <span>
              🏆 점수 <span className="tabular-nums">{before.total}</span> → <b className="text-lg tabular-nums text-amber-200 light:text-amber-700">{after.total}</b>
            </span>
            {delta(before.total, after.total)}
            {state.seatCount > 1 && rankAfter !== null && (
              <span className="text-xs text-white/60 light:text-slate-500">
                · 순위 {rankBefore !== null && rankBefore !== rankAfter ? `${rankBefore}위 → ` : ""}
                <b>{rankAfter}위</b>
                {rankBefore !== null && rankBefore !== rankAfter && (rankAfter < rankBefore ? " ▲" : " ▼")}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-1">
            {SCORE_PARTS.map((p) => {
              const d = p.key === "penalty" ? -(after.penalty - before.penalty) : after[p.key] - before[p.key];
              if (d === 0) return null;
              return (
                <span key={p.key} title={p.help} className={`rounded-full px-2 py-0.5 text-[11px] ${d > 0 ? "bg-emerald-500/15 text-emerald-200 light:text-emerald-700" : "bg-rose-500/15 text-rose-200 light:text-rose-700"}`}>
                  {p.label} {signed(d)}
                </span>
              );
            })}
            {after.goalMet && !before.goalMet && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-200 light:text-emerald-700">🤫 인생 목표 달성!</span>}
            {before.goalMet && !after.goalMet && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200 light:text-rose-700">🤫 인생 목표 조건이 깨졌어요</span>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-white/75 sm:grid-cols-3 light:text-slate-600">
        <span>
          ⚡ 체력 {rec.startHp} → <b>{rec.endHp}</b> {delta(rec.startHp, rec.endHp)}
        </span>
        <span>
          💗 멘탈 {rec.startMp} → <b>{rec.endMp}</b> {delta(rec.startMp, rec.endMp)}
        </span>
        {TRACKS.map((t) => (
          <span key={t}>
            {TRACK_INFO[t].emoji} {TRACK_INFO[t].name} {startTracks ? `${startTracks[t]} → ` : ""}
            <b>{s.tracks[t]}</b> {startTracks && delta(startTracks[t], s.tracks[t])}
          </span>
        ))}
      </div>
      {rec.notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-white/70 light:text-slate-600">
          {rec.notes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}
      {tomorrow.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/70 light:bg-slate-50 light:text-slate-600">
          <p className="font-semibold text-white/85 light:text-slate-800">🌅 내일은</p>
          {tomorrow.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GodLifePlannerBoard({ state, viewerSeat, names, connectedSeats, deadlineMs, phaseMs, nowMs, committedPlan, onAction, onCommit, onGameEnd }: Props) {
  const me = state.seats[viewerSeat];
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [previewReplay, setPreviewReplay] = useState(false);
  const [brush, setBrush] = useState<Activity>("study");
  const [draft, setDraft] = useState<Plan>(() => defaultDraft(state, viewerSeat));
  const draftKeyRef = useRef(`${state.seed}:${state.day}`);
  const pending = pendingSeats(state);
  const secondsLeft = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const days = totalDays(state);
  const event = EVENTS[state.events[state.day]];
  const committed = state.commits[viewerSeat] !== null;
  // 내가 아직 뭔가 해야 하는 단계인가(마감 경고·초침 기준)
  const myMove =
    (state.phase === "goalDraft" && state.seats[viewerSeat].goalPick === null) ||
    (state.phase === "planning" && !committed) ||
    (state.phase === "dayResult" && !state.ready[viewerSeat]);
  const lowTime = secondsLeft !== null && secondsLeft <= 10 && myMove;
  const timeTag = secondsLeft !== null && myMove ? ` · ${secondsLeft}초` : "";

  // 새 날이 되면 초안을 어제 계획으로 다시 채운다(습관은 같은 시간 반복이 핵심이라).
  useEffect(() => {
    const key = `${state.seed}:${state.day}`;
    if (draftKeyRef.current === key || state.phase !== "planning") return;
    draftKeyRef.current = key;
    setDraft(defaultDraft(state, viewerSeat));
  }, [state, viewerSeat]);

  // 계획 시간이 끝나기 직전 자동 확정
  const autoCommitRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.phase !== "planning" || committed || deadlineMs === null) return;
    if (deadlineMs - nowMs > 1500 || autoCommitRef.current === state.stage) return;
    autoCommitRef.current = state.stage;
    onCommit(draft);
  }, [state.phase, state.stage, committed, deadlineMs, nowMs, draft, onCommit]);

  // 사운드: 상태 변화 효과음(모든 자리의 행동) + BGM(마지막 날엔 글로켄·플루트가 더해짐)
  const cues = useMemo(() => godLifePlannerCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getGodLifePlannerSound, cues);
  useSuiteBgm(getGodLifePlannerSound, state.phase !== "ended", state.day === days - 1 ? 1 : 0);

  // 내 차례 마감 10초 전부터 초침
  const tickSecRef = useRef(-1);
  useEffect(() => {
    if (!lowTime || secondsLeft === null || secondsLeft <= 0) return;
    if (tickSecRef.current === secondsLeft) return;
    tickSecRef.current = secondsLeft;
    getGodLifePlannerSound().play("tick", secondsLeft);
  }, [lowTime, secondsLeft]);

  const preview = useMemo(() => (state.phase === "planning" ? previewDay(state, viewerSeat, draft) : null), [state, viewerSeat, draft]);
  const banned = bannedActivities(state, viewerSeat);
  // 몸살·무기력으로 고른 붓이 금지되면 허용된 첫 활동으로 대신 칠한다
  const activeBrush: Activity = banned.has(brush) ? (PALETTE.find((x) => !banned.has(x)) ?? "empty") : brush;
  const forced = forcedBlocks(state, viewerSeat);
  const card = state.phase === "planning" || state.phase === "revealing" ? temptationOf(state, viewerSeat) : null;
  const placements = state.phase === "planning" ? temptationPlacements(state, viewerSeat) : [];
  const resistOk = state.phase === "planning" && canResist(state, viewerSeat);

  function paint(b: number) {
    if (committed) return;
    if (forced.has(b)) {
      getGodLifePlannerSound().play("nope");
      return;
    }
    getGodLifePlannerSound().play("paint", cellArg(activeBrush));
    setDraft((d) => {
      const cells = [...d.cells];
      cells[b] = activeBrush;
      return { ...d, cells };
    });
  }

  function chooseTemptation(mode: "resist" | "yield", blocks?: number[]) {
    getGodLifePlannerSound().play(mode);
    setDraft((d) => {
      const cells = d.cells.map((c) => (c === "temptation" ? "empty" : c)) as Cell[];
      if (mode === "yield" && blocks) for (const b of blocks) cells[b] = "temptation";
      return { ...d, cells, temptation: mode };
    });
  }

  const placedBlocks = draft.cells.map((c, b) => (c === "temptation" ? b : -1)).filter((b) => b >= 0);

  // ---------- 상단 바
  const header = (
    <div className={`${CARD} flex flex-col gap-2 p-3 sm:p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📅</span>
          <div>
            <p className="text-sm font-bold text-white light:text-slate-900">
              {state.phase === "goalDraft" ? "인생 목표 고르기" : state.phase === "ended" ? "일주일 끝!" : `${DAY_NAMES[state.day]}요일`}
              {state.phase !== "goalDraft" && state.phase !== "ended" && <span className="ml-1.5 font-normal text-white/50 light:text-slate-500">Day {state.day + 1}/{days}</span>}
            </p>
            <p className={SUB}>
              {state.phase === "goalDraft" && `비밀 목표 1장을 골라요${timeTag}`}
              {state.phase === "planning" && (committed ? "계획 확정 — 다른 사람을 기다리는 중" : "오늘 8블록을 계획하세요")}
              {state.phase === "revealing" && "계획 공개 중..."}
              {state.phase === "dayResult" && "오늘의 결과"}
              {state.phase === "ended" && "최종 점수"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {secondsLeft !== null && state.phase !== "ended" && (
            <span
              className={`rounded-full px-2.5 py-1 text-sm font-black tabular-nums ${
                secondsLeft <= 10 ? "animate-pulse bg-rose-500/25 text-rose-200 light:bg-rose-100 light:text-rose-700" : secondsLeft <= 30 ? "bg-amber-500/20 text-amber-200 light:bg-amber-100 light:text-amber-700" : "bg-white/10 text-white/85 light:bg-slate-100 light:text-slate-700"
              }`}
              title="이 단계 남은 시간"
            >
              ⏱ {secondsLeft}초
            </span>
          )}
          <SuiteSoundHud suite={getGodLifePlannerSound} icon="🎧" label="Morning Routine" preview="habit" />
          <button
            onClick={() => {
              getGodLifePlannerSound().play("page");
              setRulebookOpen(true);
            }}
            className={GHOST}
          >
            📖 룰북
          </button>
        </div>
      </div>
      {secondsLeft !== null && phaseMs > 0 && state.phase !== "ended" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200" role="progressbar" aria-label="남은 시간" aria-valuenow={secondsLeft} aria-valuemin={0} aria-valuemax={Math.round(phaseMs / 1000)}>
          <div
            className={`h-full rounded-full ${secondsLeft <= 10 ? "bg-rose-500" : secondsLeft <= 30 ? "bg-amber-400" : "bg-emerald-400"}`}
            style={{ width: `${Math.min(100, (secondsLeft * 1000 * 100) / phaseMs)}%`, transition: "width 1s linear" }}
          />
        </div>
      )}
      {lowTime && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" role="status" aria-live="assertive">
          <div className="flex max-w-md items-center gap-3 rounded-2xl bg-rose-600/95 px-4 py-2.5 text-white shadow-2xl ring-2 ring-rose-300/60">
            <span className="animate-pulse text-3xl font-black tabular-nums leading-none">{secondsLeft}</span>
            <span className="break-keep text-xs font-semibold leading-snug sm:text-sm">
              ⏰ 시간이 얼마 안 남았어요!
              <span className="block font-normal text-white/90">
                {state.phase === "goalDraft" && "안 고르면 첫 번째 목표가 자동으로 선택돼요"}
                {state.phase === "planning" && "시간이 끝나면 지금 짠 계획 그대로 자동 확정돼요"}
                {state.phase === "dayResult" && (state.day + 1 >= days ? "시간이 끝나면 최종 점수로 넘어가요" : "시간이 끝나면 자동으로 다음 날로 넘어가요")}
              </span>
            </span>
          </div>
        </div>
      )}
      {state.phase !== "goalDraft" && state.phase !== "ended" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-xs light:bg-slate-50">
          <span className="font-semibold text-white light:text-slate-800">
            {event.emoji} 오늘의 이벤트 · {event.name}
          </span>
          <span className="text-white/60 light:text-slate-500">{event.text}</span>
          {state.friendBlocks[state.day] !== null && (
            <span className="rounded-full bg-pink-500/15 px-2 py-0.5 text-pink-200 light:text-pink-700">🧑‍🤝‍🧑 친구는 {BLOCK_INFO[state.friendBlocks[state.day]!].label}에 시간 있음</span>
          )}
        </div>
      )}
    </div>
  );

  // ---------- 주간 도전 · 다른 사람
  const challengesPanel = (
    <div className={`${CARD} flex flex-col gap-2 p-3`}>
      <p className="text-xs font-semibold text-white/60 light:text-slate-500">🏁 주간 도전 {state.seatCount === 1 ? "(목요일까지 5점 · 일요일까지 3점)" : state.seatCount === 2 ? "(먼저 달성 4점)" : "(1등 5점 · 2등 3점)"}</p>
      {state.challenges.map((cid) => {
        const c = CHALLENGE_BY_ID[cid];
        const aw = state.challengeAwards[cid];
        const winners = [...aw.first, ...aw.second];
        return (
          <div key={cid} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-2">
            <span className="min-w-0 break-keep text-white/80 light:text-slate-700">
              {c.emoji} <b>{c.name}</b> <span className="text-white/50 light:text-slate-500">— {c.text}</span>
            </span>
            {winners.length > 0 && <span className="min-w-0 break-words text-[11px] text-emerald-200 sm:max-w-[45%] sm:text-right light:text-emerald-700">✅ {winners.map((s) => names[s]).join(", ")}</span>}
          </div>
        );
      })}
    </div>
  );

  const othersPanel =
    state.seatCount > 1 ? (
      <div className={`${CARD} flex flex-col gap-2.5 p-3`}>
        <p className="text-xs font-semibold text-white/60 light:text-slate-500">👥 다른 사람</p>
        {state.seats.map((s, seat) => {
          if (seat === viewerSeat) return null;
          const waiting = pending.includes(seat);
          return (
            <div key={seat} className="flex flex-col gap-1 border-t border-white/5 pt-2 first:border-t-0 first:pt-0 light:border-slate-100">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={`truncate font-semibold ${connectedSeats.has(seat) ? "text-white light:text-slate-900" : "text-white/40 light:text-slate-400"}`}>
                  {names[seat]}
                </span>
                <span className="shrink-0 text-white/50 light:text-slate-500">
                  {state.phase === "planning" ? (waiting ? "⏳ 계획 중" : "✅ 확정") : state.phase === "dayResult" ? (waiting ? "보는 중" : "✅ 준비") : ""}
                  {" · "}습관 {s.habits.length}
                </span>
              </div>
              <SeatStatus s={s} compact />
            </div>
          );
        })}
      </div>
    ) : null;

  // ---------- 목표 고르기
  if (state.phase === "goalDraft") {
    const picked = me.goalPick;
    return (
      <div className="flex flex-col gap-3">
        <style>{GLP_KEYFRAMES}</style>
        {header}
        <div className={`${CARD} flex flex-col gap-2.5 border-amber-400/30 p-4`}>
          <p className="text-base font-bold text-white light:text-slate-900">🏆 게임 목표</p>
          <p className="break-keep text-sm text-white/80 light:text-slate-700">
            {days}일 동안 매일 하루 계획을 짜서 <b>{state.seatCount > 1 ? "마지막 날 점수가 가장 높은 사람이 승리" : "최대한 높은 점수(등급)를 만드는 것"}</b>가 목표예요.
          </p>
          <div className="grid gap-1.5 text-xs text-white/75 sm:grid-cols-3 light:text-slate-600">
            <div className="rounded-xl bg-white/[0.04] px-3 py-2 light:bg-slate-50">
              <b className="text-white/90 light:text-slate-800">① 계획</b> — 하루 8칸(3시간씩)에 공부·운동·일·약속·휴식·수면을 배치
            </div>
            <div className="rounded-xl bg-white/[0.04] px-3 py-2 light:bg-slate-50">
              <b className="text-white/90 light:text-slate-800">② 성장</b> — ⚡체력·💗멘탈을 써서 📘지식 💪몸 💰자산 🤝관계를 키우기
            </div>
            <div className="rounded-xl bg-white/[0.04] px-3 py-2 light:bg-slate-50">
              <b className="text-white/90 light:text-slate-800">③ 조심</b> — 체력·멘탈이 0이 되면 붕괴(−3점). 수면·휴식으로 채우기
            </div>
          </div>
          <p className="break-keep text-[11px] text-white/50 light:text-slate-400">
            점수 = 네 트랙 합 + 가장 낮은 트랙(균형 보너스) + 습관 + 비밀 인생 목표 + 주간 도전 + 남은 컨디션 − 붕괴
          </p>
        </div>
        <div className={`${CARD} flex flex-col gap-3 p-4`}>
          <p className="break-keep text-sm text-white/80 light:text-slate-700">
            🤫 <b>비밀 인생 목표</b>를 1장 골라요. 게임이 끝날 때 공개되고, 달성하면 보너스 점수를 받아요. 다른 사람에게는 보이지 않아요.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {state.goalOptions[viewerSeat].map((gid, i) => {
              const g = GOAL_BY_ID[gid];
              const chosen = picked === i;
              return (
                <button
                  key={gid}
                  disabled={picked !== null}
                  onClick={() => onAction({ type: "CHOOSE_GOAL", seat: viewerSeat, pick: i as 0 | 1 })}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                    chosen ? "border-emerald-400 bg-emerald-400/10" : "border-white/15 hover:border-white/30 disabled:opacity-40 light:border-slate-300"
                  }`}
                >
                  <span className="text-lg">
                    {g.emoji} <b className="text-white light:text-slate-900">{g.name}</b>
                  </span>
                  <span className="break-keep text-xs text-white/70 light:text-slate-600">{g.text}</span>
                  <span className="text-xs font-bold text-amber-200 light:text-amber-700">+{g.points}점</span>
                </button>
              );
            })}
          </div>
          {picked !== null && <p className={SUB}>다른 사람을 기다리는 중... ({state.seatCount - pending.length}/{state.seatCount})</p>}
        </div>
        {challengesPanel}
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  const myPanel = (
    <div className={`${CARD} flex flex-col gap-2.5 p-3 sm:p-4`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-white light:text-slate-900">🙋 {names[viewerSeat]}</p>
        <span className={SUB}>
          주간 도전 {me.challengePoints}점 · 붕괴 {me.collapses}회
        </span>
      </div>
      <SeatStatus s={me} />
      <HabitChips s={me} />
      <ScoreCard state={state} seat={viewerSeat} />
    </div>
  );

  // ---------- 지난 날 (내 플래너)
  const historyPanel =
    me.days.length > 0 && state.phase !== "dayResult" ? (
      <details className={`${CARD} px-3 py-2.5`} open={state.phase === "ended"}>
        <summary className="cursor-pointer text-xs font-semibold text-white/60 light:text-slate-500">🗓️ 내 플래너 ({me.days.length}일)</summary>
        <div className="mt-2 flex flex-col gap-1.5">
          {me.days.map((rec, d) => (
            <div key={d} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center text-xs font-bold text-white/60 light:text-slate-500">{DAY_NAMES[d]}</span>
              <div className="min-w-0 flex-1">
                <DayRow state={state} seat={viewerSeat} rec={rec} day={d} />
              </div>
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-emerald-200 light:text-emerald-700">+{rec.growth}</span>
            </div>
          ))}
        </div>
      </details>
    ) : null;

  // ---------- 계획 단계
  if (state.phase === "planning" || state.phase === "revealing") {
    const plan = committed ? (committedPlan ?? draft) : draft;
    const shown = committed && committedPlan ? previewDay(state, viewerSeat, committedPlan) : preview;
    const rec = shown?.record ?? null;
    const shownAfter = shown?.after ?? null;
    const warnings: string[] = [];
    if (rec) {
      if (rec.exhausted) warnings.push("🥵 이대로면 탈진해요 (−3점, 내일 몸살)");
      if (rec.burnout) warnings.push("😵 이대로면 번아웃이에요 (−3점, 내일 무기력)");
      if (rec.nightSleep < (state.options.hard ? 3 : 2)) warnings.push(`🥱 밤잠(B1·B2·B8 수면)이 ${rec.nightSleep}블록 — 마감 때 체력 −2, 멘탈 −1`);
      if (rec.outcomes.some((o) => o.kind === "fail")) warnings.push("⚠️ 비용을 낼 수 없어 실패하는 블록이 있어요");
    }
    const yieldBlock = card && card.kind === "block" && plan.temptation === "yield";
    return (
      <div className="flex flex-col gap-3">
        <style>{GLP_KEYFRAMES}</style>
        {header}
        {myPanel}
        {!committed && <PlanGuide state={state} seat={viewerSeat} />}

        <div className={`${CARD} flex flex-col gap-3 p-3 sm:p-4`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-white light:text-slate-900">✏️ 오늘의 계획</p>
            {!committed && state.day > 0 && (
              <button
                onClick={() => {
                  getGodLifePlannerSound().play("rewind");
                  setDraft(defaultDraft(state, viewerSeat));
                }}
                className={GHOST}
              >
                ↺ 어제 계획
              </button>
            )}
          </div>

          {!committed && (
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((a) => {
                const disabled = banned.has(a);
                return (
                  <button
                    key={a}
                    disabled={disabled}
                    onClick={() => {
                      setBrush(a);
                      getGodLifePlannerSound().play("brush", cellArg(a));
                    }}
                    className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-30 ${CELL_TONE[a]} ${
                      activeBrush === a ? "ring-2 ring-emerald-400" : ""
                    } text-white/85 light:text-slate-700`}
                  >
                    {ACTIVITY_INFO[a].emoji} {ACTIVITY_INFO[a].name}
                  </button>
                );
              })}
            </div>
          )}
          {!committed && (
            <p className="break-keep rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/70 light:bg-slate-50 light:text-slate-600">
              🖌️ <b className="text-white/90 light:text-slate-800">{ACTIVITY_INFO[activeBrush].name}</b> 선택됨 — {ACTIVITY_HELP[activeBrush]}
              <span className="text-white/45 light:text-slate-400"> · 아래 칸을 눌러 칠하세요</span>
              {[...banned].length > 0 && (
                <span className="block text-amber-200 light:text-amber-700">
                  🚫 오늘 못 하는 활동: {[...banned].map((a) => ACTIVITY_INFO[a].name).join("·")} ({me.sick ? "몸살" : ""}
                  {me.sick && me.apathy ? "·" : ""}
                  {me.apathy ? "무기력" : ""})
                </span>
              )}
            </p>
          )}

          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {plan.cells.map((c, b) => {
              const o = rec?.outcomes[b];
              const habit = habitAt(me, b);
              const streak = me.streak[b];
              const label = cellLabel(state, viewerSeat, c);
              const habitHere = habit && habit.activity === c;
              const streakHere = !habitHere && c !== "temptation" && c !== "empty" && streak.activity === c && streak.count > 0;
              return (
                <button
                  key={b}
                  onClick={() => paint(b)}
                  disabled={committed}
                  className={`relative flex min-h-[5.2rem] flex-col items-center justify-start gap-0.5 rounded-xl border px-1 py-1.5 text-center transition ${CELL_TONE[c]} ${
                    o && (o.kind === "fail" || o.kind === "void" || o.kind === "nap") ? "ring-2 ring-rose-500/70" : ""
                  } ${forced.has(b) ? "cursor-not-allowed" : ""}`}
                >
                  <span className="text-[10px] leading-none text-white/50 light:text-slate-500">
                    {BLOCK_INFO[b].label} {BLOCK_INFO[b].time}
                  </span>
                  <span className="text-lg leading-tight">{label.emoji}</span>
                  <span className="text-[11px] font-semibold leading-tight text-white/90 light:text-slate-800">{label.name}</span>
                  {o && (
                    <span className="text-[10px] leading-tight text-white/60 light:text-slate-500">
                      {o.kind === "fail" ? "❌ 실패" : o.kind === "void" ? "🫥 무효" : o.kind === "nap" ? "💤 쓰러짐" : `⚡${o.hp} 💗${o.mp}`}
                    </span>
                  )}
                  {o && gainsText(o) && <span className="text-[10px] leading-tight text-emerald-200 light:text-emerald-700">{gainsText(o)}</span>}
                  {habitHere && <span className="absolute -right-1 -top-1 text-xs" title="습관 블록">{habit.shaken ? "⚠️" : "🌱"}</span>}
                  {streakHere && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-emerald-500/80 px-1 text-[9px] font-bold text-white" title="연속 일수">
                      {streak.count + 1}/{state.options.easyHabit ? 2 : 3}
                    </span>
                  )}
                  {forced.has(b) && <span className="absolute -left-1 -top-1 text-xs" title="이벤트로 고정">🔒</span>}
                </button>
              );
            })}
          </div>

          {rec && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/75 light:bg-slate-50 light:text-slate-600">
              <span>
                🔮 예상 마감 ⚡<b>{rec.endHp}</b> 💗<b>{rec.endMp}</b>
              </span>
              <span>
                성장 <b className="text-emerald-200 light:text-emerald-700">+{rec.growth}</b>
              </span>
              <span className="text-white/45 light:text-slate-400">(약속 성사·기회 카드 경쟁은 공개 후 결정)</span>
            </div>
          )}
          {rec && shownAfter && (
            previewReplay ? (
              <DayReplay state={state} rec={rec} endTracks={shownAfter.tracks} preview onClose={() => setPreviewReplay(false)} />
            ) : (
              <button
                onClick={() => {
                  getGodLifePlannerSound().play("ui");
                  setPreviewReplay(true);
                }}
                className={`${GHOST} self-start !border-sky-400/40 !text-sky-200 light:!text-sky-700`}>
                🎬 이 계획대로 하루 미리 재생
              </button>
            )
          )}
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-rose-200 light:text-rose-700">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>

        {card && (
          <div className={`${CARD} flex flex-col gap-2 border-fuchsia-400/30 p-3 sm:p-4`}>
            <p className="text-sm font-bold text-white light:text-slate-900">
              😈 오늘의 유혹 · {card.emoji} {card.name}
            </p>
            <p className="break-keep text-xs text-white/65 light:text-slate-500">{card.text}</p>
            {!committed && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  disabled={!resistOk}
                  onClick={() => chooseTemptation("resist")}
                  className={`${GHOST} ${plan.temptation === "resist" ? "!border-emerald-400 !text-emerald-200 light:!text-emerald-700" : ""} disabled:opacity-30`}
                >
                  🛡️ 참기 (멘탈 −{resistCost(state)})
                </button>
                {card.kind === "instant" ? (
                  <button onClick={() => chooseTemptation("yield")} className={`${GHOST} ${plan.temptation === "yield" ? "!border-fuchsia-400 !text-fuchsia-200 light:!text-fuchsia-700" : ""}`}>
                    😈 넘어가기
                  </button>
                ) : (
                  placements.map((blocks) => {
                    const active = plan.temptation === "yield" && blocks.length === placedBlocks.length && blocks.every((x, i) => x === placedBlocks[i]);
                    return (
                      <button
                        key={blocks.join("-")}
                        onClick={() => chooseTemptation("yield", blocks)}
                        className={`${GHOST} ${active ? "!border-fuchsia-400 !text-fuchsia-200 light:!text-fuchsia-700" : ""}`}
                      >
                        😈 {blocks.map((b) => BLOCK_INFO[b].label).join("+")}에 넘어가기
                      </button>
                    );
                  })
                )}
              </div>
            )}
            {!resistOk && state.phase === "planning" && <p className="text-xs text-amber-200 light:text-amber-700">멘탈이 부족하거나 무기력해서 참을 수 없어요 — 반드시 넘어가야 해요.</p>}
            {yieldBlock && placedBlocks.length === 0 && !(card.id === "T4" && plan.cells[2] === "sleep") && !committed && (
              <p className="text-xs text-white/50 light:text-slate-400">놓을 블록을 고르지 않으면 첫 번째 가능한 블록에 자동으로 들어가요.</p>
            )}
          </div>
        )}

        {state.markets[state.day].length > 0 && (
          <div className={`${CARD} flex flex-col gap-2 p-3 sm:p-4`}>
            <p className="text-sm font-bold text-white light:text-slate-900">🍀 기회 카드 <span className="text-xs font-normal text-white/50 light:text-slate-500">(하루 1장 신청 · 정원이 넘치면 성장 합이 낮은 사람 우선)</span></p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {state.markets[state.day].map((id) => {
                const opp = OPPORTUNITY_BY_ID[id];
                const at = opp.block ?? plan.cells.indexOf(opp.activity);
                const fits = at >= 0 && plan.cells[at] === opp.activity;
                const selected = plan.opportunityId === id;
                const reward = [
                  ...TRACKS.filter((t) => opp.reward.tracks?.[t]).map((t) => `${TRACK_INFO[t].emoji}+${opp.reward.tracks![t]}`),
                  opp.reward.hp ? `⚡+${opp.reward.hp}` : "",
                  opp.reward.mp ? `💗${opp.reward.mp > 0 ? "+" : ""}${opp.reward.mp}` : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={id}
                    disabled={committed}
                    onClick={() => {
                      getGodLifePlannerSound().play(selected ? "oppOff" : "oppOn");
                      setDraft((d) => ({ ...d, opportunityId: d.opportunityId === id ? null : id }));
                    }}
                    className={`flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left text-xs transition ${
                      selected ? "border-lime-400 bg-lime-400/10" : "border-white/10 hover:border-white/25 light:border-slate-200"
                    }`}
                  >
                    <span className="font-semibold text-white light:text-slate-900">
                      {opp.emoji} {opp.name} {selected && "✓"}
                    </span>
                    <span className="text-white/60 light:text-slate-500">
                      {opp.block === null ? "아무 블록" : BLOCK_INFO[opp.block].label} {ACTIVITY_INFO[opp.activity].emoji}
                      {ACTIVITY_INFO[opp.activity].name} · 정원 {opp.capacity}
                      {opp.minPeople ? ` (최소 ${opp.minPeople}명)` : ""}
                      {opp.cost ? ` · 💰−${opp.cost}` : ""}
                    </span>
                    <span className="text-emerald-200 light:text-emerald-700">보상 {reward}</span>
                    {selected && !fits && <span className="text-amber-200 light:text-amber-700">⚠️ 계획에 이 블록·활동이 없어요</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!committed ? (
          <button onClick={() => onCommit(draft)} className={`${PRIMARY} py-3 text-base`}>
            🔒 계획 확정{timeTag}
          </button>
        ) : (
          <p className="text-center text-sm text-white/60 light:text-slate-500">
            {state.phase === "revealing" ? "모두 확정! 계획을 공개하는 중..." : `다른 사람을 기다리는 중... (${state.seatCount - pending.length}/${state.seatCount})`}
          </p>
        )}

        {challengesPanel}
        {othersPanel}
        {historyPanel}
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  // ---------- 하루 결과
  if (state.phase === "dayResult") {
    const order = [viewerSeat, ...state.seats.map((_, i) => i).filter((i) => i !== viewerSeat)];
    const ready = !pending.includes(viewerSeat);
    return (
      <div className="flex flex-col gap-3">
        <style>{GLP_KEYFRAMES}</style>
        {header}
        {me.days[state.day] && (
          <div className={`${CARD} flex flex-col gap-2 p-3 sm:p-4`}>
            <p className="text-sm font-bold text-white light:text-slate-900">🎬 오늘 하루 다시 보기 <span className="text-xs font-normal text-white/50 light:text-slate-500">— 내 계획이 시간대별로 어떻게 흘러갔는지</span></p>
            <DayReplay key={`replay-${state.day}`} state={state} rec={me.days[state.day]} endTracks={me.tracks} />
          </div>
        )}
        {me.days[state.day] && <DayChangePanel state={state} seat={viewerSeat} rec={me.days[state.day]} />}
        <div className={`${CARD} flex flex-col gap-3 p-3 sm:p-4`}>
          <p className="text-sm font-bold text-white light:text-slate-900">🗓️ {state.seatCount > 1 ? "모두의 하루" : "나의 하루"}</p>
          <div className="grid grid-cols-8 gap-1 text-center text-[10px] text-white/45 light:text-slate-400">
            {BLOCK_INFO.map((b) => (
              <span key={b.label}>
                {b.label}
                <span className="hidden sm:inline"> {b.time}</span>
              </span>
            ))}
          </div>
          {order.map((seat) => {
            const rec = state.seats[seat].days[state.day];
            if (!rec) return null;
            const t = temptationOf(state, seat);
            return (
              <div key={seat} className="flex flex-col gap-1.5 border-t border-white/5 pt-2.5 first:border-t-0 first:pt-0 light:border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span className="font-semibold text-white light:text-slate-900">
                    {seat === viewerSeat ? "🙋 나" : names[seat]}
                    {rec.plan.auto && <span className="ml-1 font-normal text-amber-200 light:text-amber-700">(시간 초과 — 기본 계획)</span>}
                  </span>
                  <span className="text-white/60 light:text-slate-500">
                    {rec.plan.temptation === "resist" ? "🛡️" : t.emoji} 성장 <b className="text-emerald-200 light:text-emerald-700">+{rec.growth}</b> · ⚡{rec.endHp} 💗{rec.endMp}
                    {rec.scoreBefore && rec.scoreAfter && (() => {
                      // 남의 점수는 비밀 목표를 뺀 공개 점수로
                      const a = seat === viewerSeat ? rec.scoreAfter.total : publicTotal(rec.scoreAfter);
                      const b0 = seat === viewerSeat ? rec.scoreBefore.total : publicTotal(rec.scoreBefore);
                      return (
                        <>
                          {" · "}🏆 {a}점 <b className={a >= b0 ? "text-amber-200 light:text-amber-700" : "text-rose-200 light:text-rose-700"}>({signed(a - b0)})</b>
                        </>
                      );
                    })()}
                  </span>
                </div>
                <DayRow state={state} seat={seat} rec={rec} day={state.day} animate />
                {seat !== viewerSeat && rec.notes.length > 0 && (
                  <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/65 light:text-slate-500">
                    {rec.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-white/40 light:text-slate-400">🤝 분홍 테두리 = 약속 성사 · 🍀 연두 테두리 = 기회 카드 획득 · 🙇 펑크(약속 못 나감) · ❌ 실패(비용 부족 → 게이지 0) · 🫥 무효(붕괴 뒤) · 💤 쓰러짐</p>
        </div>
        <button disabled={ready} onClick={() => onAction({ type: "READY", seat: viewerSeat })} className={`${PRIMARY} py-3 text-base`}>
          {ready ? `다른 사람 기다리는 중 (${state.seatCount - pending.length}/${state.seatCount})` : state.day + 1 >= days ? "🏁 최종 점수 보기" : `☀️ ${DAY_NAMES[state.day + 1]}요일로`}
          {!ready && timeTag}
        </button>
        {myPanel}
        {challengesPanel}
        {othersPanel}
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  // ---------- 게임 종료
  const rankings = computeRankings(state);
  return (
    <div className="flex flex-col gap-3">
      <style>{GLP_KEYFRAMES}</style>
      {header}
      <div className={`${CARD} flex flex-col gap-3 p-3 sm:p-4`}>
        {state.seatCount === 1 && (
          <p className="text-center text-lg font-bold text-white light:text-slate-900">
            🎖️ {soloGrade(rankings[0].score)} <span className="text-sm font-normal text-white/60 light:text-slate-500">({rankings[0].score}점)</span>
          </p>
        )}
        <ol className="flex flex-col gap-2 sm:hidden">
          {rankings.map((r) => {
            const b = scoreBreakdown(state, r.seat);
            const gid = goalIdOf(state, r.seat);
            const g = gid ? GOAL_BY_ID[gid] : null;
            return (
              <li key={r.seat} className={`flex flex-col gap-1 rounded-xl border border-white/10 p-2.5 text-xs light:border-slate-200 ${r.seat === viewerSeat ? "bg-emerald-400/5" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold text-white light:text-slate-900">
                    {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `${r.rank}.`} {names[r.seat]}
                  </span>
                  <b className="shrink-0 tabular-nums text-amber-200 light:text-amber-700">{r.score}점</b>
                </div>
                <span className="break-keep text-white/60 light:text-slate-500">
                  성장 {b.growth} · 균형 {b.balance} · 습관 {b.habits} · 도전 {b.challenges} · 컨디션 {b.condition}
                  {b.penalty ? ` · 붕괴 −${b.penalty}` : ""}
                </span>
                <span className="break-keep text-white/60 light:text-slate-500">
                  {g ? `${g.emoji} ${g.name} ` : ""}
                  <b className={b.goalMet ? "text-emerald-200 light:text-emerald-700" : "text-white/40 light:text-slate-400"}>{b.goalMet ? `+${b.goal}` : "실패"}</b>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-left text-xs">
            <thead className="text-white/45 light:text-slate-400">
              <tr>
                <th className="py-1 pr-2 font-medium">순위</th>
                <th className="py-1 pr-2 font-medium">이름</th>
                <th className="py-1 pr-2 font-medium">성장</th>
                <th className="py-1 pr-2 font-medium">균형</th>
                <th className="py-1 pr-2 font-medium">습관</th>
                <th className="py-1 pr-2 font-medium">인생 목표</th>
                <th className="py-1 pr-2 font-medium">도전</th>
                <th className="py-1 pr-2 font-medium">컨디션</th>
                <th className="py-1 pr-2 font-medium">붕괴</th>
                <th className="py-1 font-medium">합계</th>
              </tr>
            </thead>
            <tbody className="text-white/85 light:text-slate-700">
              {rankings.map((r) => {
                const b = scoreBreakdown(state, r.seat);
                const gid = goalIdOf(state, r.seat);
                const g = gid ? GOAL_BY_ID[gid] : null;
                return (
                  <tr key={r.seat} className={`border-t border-white/5 light:border-slate-100 ${r.seat === viewerSeat ? "bg-emerald-400/5" : ""}`}>
                    <td className="py-1.5 pr-2 font-bold">{r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}</td>
                    <td className="max-w-[7rem] truncate py-1.5 pr-2 font-semibold">{names[r.seat]}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.growth}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.balance}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.habits}</td>
                    <td className="py-1.5 pr-2">
                      {g ? `${g.emoji} ${g.name} ` : ""}
                      <b className={b.goalMet ? "text-emerald-200 light:text-emerald-700" : "text-white/40 light:text-slate-400"}>{b.goalMet ? `+${b.goal}` : "실패"}</b>
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.challenges}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.condition}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.penalty ? `−${b.penalty}` : 0}</td>
                    <td className="py-1.5 font-bold tabular-nums text-amber-200 light:text-amber-700">{r.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          onClick={() => {
            getGodLifePlannerSound().play("ui");
            onGameEnd();
          }}
          className={`${PRIMARY} self-center`}
        >
          결과 확정하고 계속하기
        </button>
      </div>
      {state.seats.every((s) => s.days.every((r) => r.scoreAfter)) && (
        <div className={`${CARD} flex flex-col gap-2 p-3 sm:p-4`}>
          <p className="text-sm font-bold text-white light:text-slate-900">📈 날마다 점수 흐름</p>
          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs tabular-nums">
              <thead className="text-white/45 light:text-slate-400">
                <tr>
                  <th className="py-1 pr-2 text-left font-medium">이름</th>
                  {state.seats[0].days.map((_, d) => (
                    <th key={d} className="px-1 py-1 font-medium">
                      {DAY_NAMES[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-white/85 light:text-slate-700">
                {rankings.map((r) => {
                  const recs = state.seats[r.seat].days;
                  return (
                    <tr key={r.seat} className={`border-t border-white/5 light:border-slate-100 ${r.seat === viewerSeat ? "bg-emerald-400/5" : ""}`}>
                      <td className="max-w-[6rem] truncate py-1.5 pr-2 text-left font-semibold">{names[r.seat]}</td>
                      {recs.map((rec, d) => {
                        const diff = rec.scoreAfter!.total - (rec.scoreBefore?.total ?? 0);
                        const bad = rec.exhausted || rec.burnout;
                        return (
                          <td key={d} className="px-1 py-1.5" title={rec.notes.join("\n")}>
                            <b>{rec.scoreAfter!.total}</b>
                            <span className={`block text-[10px] ${bad || diff < 0 ? "text-rose-200 light:text-rose-700" : "text-emerald-200 light:text-emerald-700"}`}>
                              {bad ? "💥" : ""}
                              {signed(diff)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-white/40 light:text-slate-400">각 칸 = 그날 마감 때 점수(아래는 하루 변화) · 💥 = 그날 붕괴</p>
        </div>
      )}
      {myPanel}
      {historyPanel}
      {challengesPanel}
      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

const GLP_KEYFRAMES = `@keyframes glp-pop{0%{opacity:0;transform:translateY(6px) scale(.92)}100%{opacity:1;transform:none}}`;

