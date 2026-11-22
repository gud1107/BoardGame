"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  bagTotal,
  bustChance,
  cheatAllowed,
  compromiseGain,
  computeRankings,
  CRISIS_DAY,
  DAY_MS,
  DAYS,
  DECLARE_IDS,
  DECLARES,
  drawsForDay,
  eventOf,
  pendingSeats,
  PLAN_MS,
  previewPlan,
  REVIEW_MS,
  SEASONS,
  solveInputFor,
  solveRun,
  STRENGTH_IDS,
  STRENGTHS,
  successGain,
  TOKEN_IDS,
  TOKENS,
  TUNING,
  type Bag,
  type Bet,
  type Declare,
  type EngineAction,
  type LogEntry,
  type ResolveState,
  type SeasonRun,
  type SeatIndex,
  type Strength,
  type TokenId,
} from "./engine";
import { getThreeDayResolveSound, resolveIntensity, resolveSoundCues } from "./threeDayResolveSound";

export interface ThreeDayResolveBoardProps {
  state: ResolveState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  isHost: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
  onRulebook: () => void;
}

type ActionBody = EngineAction extends infer A ? (A extends EngineAction ? Omit<A, "seat" | "step"> : never) : never;

const PANEL = "rounded-2xl border border-white/10 bg-[#13202b]/85 p-2.5 text-white shadow-lg";
const H = "mb-1.5 flex items-center justify-between gap-2 text-xs font-bold text-teal-100/80";
const SEAT_SHAPES = ["●", "▲", "■", "◆", "★", "✚"];
const SEAT_COLORS = ["#f472b6", "#38bdf8", "#facc15", "#4ade80", "#c084fc", "#fb923c"];

function phaseMs(state: ResolveState): number {
  return state.phase === "plan" ? PLAN_MS : state.phase === "day" ? DAY_MS : REVIEW_MS;
}

/** Ms left in this step by this client's own clock (negative once overdue). */
function useStepClock(step: number, total: number): number {
  const [left, setLeft] = useState({ step, ms: total });
  useEffect(() => {
    const at = Date.now();
    const tick = () => setLeft({ step, ms: total - (Date.now() - at) });
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [step, total]);
  return left.step === step ? left.ms : total;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function Token({ id, count, size = "md", dim }: { id: TokenId; count?: number; size?: "sm" | "md" | "lg"; dim?: boolean }) {
  const t = TOKENS[id];
  const box = size === "lg" ? "h-14 w-14 text-2xl" : size === "sm" ? "h-8 w-8 text-sm" : "h-10 w-10 text-lg";
  const ring = t.value === 0 ? "border-sky-300/70 bg-sky-500/20" : t.value >= 3 ? "border-rose-400/80 bg-rose-500/25" : t.value === 2 ? "border-amber-300/80 bg-amber-500/20" : "border-violet-300/70 bg-violet-500/20";
  return (
    <span className={`relative inline-flex shrink-0 flex-col items-center justify-center rounded-full border-2 ${ring} ${box} ${dim ? "opacity-35" : ""}`} title={`${t.name} (${t.value}점)`}>
      <span className="leading-none">{t.emoji}</span>
      <span className="absolute -bottom-1.5 rounded-full bg-black/80 px-1 text-[10px] font-black leading-tight text-white">{t.value}</span>
      {count !== undefined && count > 1 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-white px-1 text-[10px] font-black leading-tight text-black">×{count}</span>}
    </span>
  );
}

function BagView({ bag, compact }: { bag: Bag; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {TOKEN_IDS.filter((k) => bag[k] > 0).map((k) => (
        <Token key={k} id={k} count={bag[k]} size={compact ? "sm" : "md"} />
      ))}
      <span className="text-[11px] text-white/50">총 {bagTotal(bag)}개</span>
    </div>
  );
}

/** Temptation gauge: how close the run is to the limit. */
function Gauge({ sum, limit, busted }: { sum: number; limit: number; busted?: boolean }) {
  const cells = Array.from({ length: limit + 1 }, (_, i) => i);
  return (
    <div className="flex items-center gap-0.5" aria-label={`유혹 ${sum} / 한계 ${limit}`}>
      {cells.map((i) => {
        const filled = i < sum;
        const over = i === limit;
        return (
          <span
            key={i}
            className={`h-3 flex-1 rounded-sm ${over ? (busted ? "bg-rose-500" : "border border-dashed border-rose-400/70 bg-transparent") : filled ? (sum >= limit - 1 ? "bg-amber-400" : "bg-teal-300") : "bg-white/10"}`}
          />
        );
      })}
      <span className={`ml-1 min-w-12 text-right text-xs font-black ${busted ? "text-rose-300" : "text-white"}`}>
        {Math.min(sum, 99)}/{limit}
      </span>
    </div>
  );
}

function statusBadge(run: SeasonRun | null) {
  if (!run) return null;
  switch (run.status) {
    case "going":
      return <span className="rounded-full bg-teal-500/25 px-1.5 text-[10px] font-bold text-teal-100">🔥 버티는 중</span>;
    case "stopped":
      return <span className="rounded-full bg-sky-500/25 px-1.5 text-[10px] font-bold text-sky-100">🤝 {run.endDay}일차 타협</span>;
    case "busted":
      return <span className="rounded-full bg-rose-500/30 px-1.5 text-[10px] font-bold text-rose-100">💥 {run.endDay}일차 무너짐</span>;
    case "done":
      return <span className="rounded-full bg-emerald-500/30 px-1.5 text-[10px] font-bold text-emerald-100">✅ 7일 성공</span>;
  }
}

function logText(e: LogEntry, nameOf: (s: SeatIndex) => string): string | null {
  const who = e.seat >= 0 ? nameOf(e.seat) : "";
  switch (e.kind) {
    case "season":
      return `📅 시즌 ${e.n} 시작`;
    case "crisis":
      return `🔥 ${e.day}일차 고비! 모두 ${e.n}개씩 뽑아요`;
    case "draw":
      return TOKENS[e.token!].value === 0 ? null : `${who}: ${TOKENS[e.token!].emoji} ${TOKENS[e.token!].name} +${TOKENS[e.token!].value}`;
    case "block":
      return `${who}: 📘 교훈으로 ${TOKENS[e.token!].emoji} ${TOKENS[e.token!].name}을(를) 되돌림`;
    case "bust":
      return `${who} 💥 ${e.day}일차에 무너졌어요 (유혹 ${e.n})`;
    case "stop":
      return `${who} 🤝 ${e.day}일차 타협 (${(e.n ?? 0) >= 0 ? "+" : ""}${e.n})`;
    case "cheat":
      return `${who} 🍰 치팅데이`;
    case "success":
      return `${who} ✅ 7일 완주!`;
    case "timeout":
      return `${who} ⏰ 시간 초과 — 자동 선택`;
    case "end":
      return "🏁 게임 끝";
    default:
      return null;
  }
}

export default function ThreeDayResolveBoard({ state, viewerSeat, names, connectedSeats, isHost, onAction, onGameEnd, onRulebook }: ThreeDayResolveBoardProps) {
  const sound = getThreeDayResolveSound;
  useSoundCues(state, sound, resolveSoundCues);
  useSuiteBgm(sound, state.phase !== "gameOver", resolveIntensity(state));

  const nameOf = (seat: SeatIndex) => names[seat] ?? `${seat + 1}번`;
  const me = state.players[viewerSeat];
  const ev = eventOf(state);
  const pending = pendingSeats(state);
  const myPending = pending.includes(viewerSeat);
  const step = state.step;
  const act = (a: ActionBody) => onAction({ ...a, seat: viewerSeat, step } as EngineAction);

  // ── clock: own seat times itself out; the host covers silent seats after a grace ──
  const total = phaseMs(state);
  const remaining = useStepClock(step, total);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const decidedRef = useRef(-1);
  useEffect(() => {
    if (myPending && decidedRef.current !== step) {
      decidedRef.current = step;
      if (state.phase !== "review") sound().play("decide");
    }
  }, [myPending, step, state.phase, sound]);
  const tickRef = useRef(-1);
  useEffect(() => {
    if (!myPending || seconds > 5 || seconds <= 0 || tickRef.current === seconds || state.phase === "review") return;
    tickRef.current = seconds;
    sound().play("tick");
  }, [myPending, seconds, sound, state.phase]);
  const timedOutRef = useRef("");
  useEffect(() => {
    if (state.phase === "gameOver" || remaining > 0) return;
    const seats = myPending ? [viewerSeat] : [];
    if (isHost && remaining <= -6000) for (const s of pending) if (s !== viewerSeat) seats.push(s);
    for (const seat of seats) {
      const key = `${step}:${seat}`;
      if (timedOutRef.current.includes(`|${key}|`)) continue;
      timedOutRef.current += `|${key}|`;
      onAction({ type: "timeout", seat, step });
    }
  }, [remaining, myPending, isHost, pending, state.phase, step, viewerSeat, onAction]);

  // ── bust flash for my own run ──
  const [flash, setFlash] = useState<"bust" | "success" | null>(null);
  const myStatus = me.run?.status;
  const [lastStatus, setLastStatus] = useState(myStatus);
  if (myStatus !== lastStatus) {
    setLastStatus(myStatus);
    if (myStatus === "busted") setFlash("bust");
    else if (myStatus === "done") setFlash("success");
  }
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(id);
  }, [flash]);

  const recentLog = useMemo(
    () =>
      state.log
        .map((e) => ({ e, text: logText(e, nameOf) }))
        .filter((x) => x.text)
        .slice(-8)
        .reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.log, names],
  );

  const crisisNow = state.phase === "day" && state.day === CRISIS_DAY;

  return (
    <div className={`relative flex flex-col gap-2.5 overflow-hidden rounded-3xl bg-gradient-to-b from-[#123040] via-[#0e1f2b] to-[#0a1219] p-2 text-white sm:p-3 ${flash === "bust" ? "animate-[tdr-shake_0.45s_ease-in-out]" : ""}`}>
      <style>{`@keyframes tdr-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}`}</style>
      {flash && (
        <div className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center ${flash === "bust" ? "bg-rose-600/30" : "bg-emerald-400/20"}`}>
          <span className="rounded-2xl bg-black/70 px-5 py-3 text-2xl font-black">{flash === "bust" ? "💥 작심삼일…" : "✅ 7일 완주!"}</span>
        </div>
      )}

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <span className="text-xl">🔥</span>
          작심삼일
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-teal-100">
            시즌 {Math.min(state.season, SEASONS)}/{SEASONS}
          </span>
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100" title={ev.desc}>
            {ev.emoji} {ev.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {state.phase !== "gameOver" && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${seconds <= 5 && myPending ? "animate-pulse bg-rose-500/80" : "bg-white/10"}`}>⏱ {seconds}s</span>
          )}
          <SuiteSoundHud suite={sound} icon="🔥" label="Morning Routine" preview="success" />
          <button onClick={onRulebook} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/40">
            📖 룰북
          </button>
        </div>
      </div>
      <p className="-mt-1 text-[11px] text-amber-100/70">
        {ev.emoji} {ev.desc}
      </p>

      {/* week tracker */}
      {state.phase !== "gameOver" && (
        <div className="flex items-center gap-1">
          {Array.from({ length: DAYS }, (_, i) => i + 1).map((d) => {
            const current = state.phase === "day" && state.day === d;
            const past = state.phase === "review" || (state.phase === "day" && d < state.day);
            return (
              <div
                key={d}
                className={`flex flex-1 flex-col items-center rounded-lg py-1 text-[10px] font-bold ${current ? (d === CRISIS_DAY ? "animate-pulse bg-rose-500/70" : "bg-teal-400/70 text-black") : past ? "bg-white/15 text-white/60" : "bg-white/5 text-white/40"}`}
              >
                <span>{d === CRISIS_DAY ? "🔥" : d === DAYS ? "🏁" : "·"}</span>
                {d}일
              </div>
            );
          })}
        </div>
      )}
      {crisisNow && (
        <div className="rounded-xl border border-rose-400/60 bg-rose-500/20 px-3 py-1.5 text-center text-sm font-black text-rose-50">
          🔥 3일차 고비! 오늘 버티면 {drawsForDay(state)}개를 뽑아요
        </div>
      )}

      {/* players */}
      <div className={PANEL}>
        <div className={H}>
          <span>👥 참가자</span>
          <span className="font-normal text-white/40">{state.phase === "plan" ? "모두 비밀로 결심 중" : state.phase === "day" ? `${state.day}일차` : state.phase === "review" ? "시즌 결과" : "최종"}</span>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {state.players.map((p, seat) => {
            const run = p.run;
            const waiting = pending.includes(seat);
            return (
              <div key={seat} className={`rounded-xl border px-2 py-1.5 ${seat === viewerSeat ? "border-teal-300/60 bg-teal-400/10" : "border-white/10 bg-black/20"}`}>
                <div className="flex items-center justify-between gap-1 text-xs">
                  <span className="flex min-w-0 items-center gap-1 font-bold">
                    <span style={{ color: SEAT_COLORS[seat] }} aria-hidden>
                      {SEAT_SHAPES[seat]}
                    </span>
                    <span className="truncate">{nameOf(seat)}</span>
                    {!connectedSeats.has(seat) && <span className="text-[10px] text-white/40">📡</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {waiting ? <span className="text-[10px] text-white/50">🤔</span> : state.phase !== "gameOver" && <span className="text-[10px] text-teal-200">✔</span>}
                    <span className="rounded-md bg-white/10 px-1.5 font-black tabular-nums">{p.score}점</span>
                  </span>
                </div>
                {run && (
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-white/70">
                      <span>
                        {STRENGTHS[run.strength].emoji} {STRENGTHS[run.strength].name}
                      </span>
                      <span>
                        {DECLARES[run.declare].emoji} {DECLARES[run.declare].name}
                      </span>
                      {run.cheers > 0 && <span>👏×{run.cheers}</span>}
                      {statusBadge(run)}
                    </div>
                    <Gauge sum={run.sum} limit={run.limit} busted={run.status === "busted"} />
                  </div>
                )}
                {!run && state.phase === "plan" && (
                  <div className="mt-0.5 text-[10px] text-white/45">
                    한계 {p.limit} · 📘 {p.lessons} · ✅{p.successes} 💥{p.fails} 🤝{p.compromises}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {state.phase === "plan" && <PlanPanel state={state} seat={viewerSeat} nameOf={nameOf} submitted={!myPending} onSubmit={(strength, declare, bet) => act({ type: "plan", strength, declare, bet })} />}
      {state.phase === "day" && <DayPanel state={state} seat={viewerSeat} myPending={myPending} onChoose={(choice) => act({ type: "day", choice })} />}
      {state.phase === "review" && <ReviewPanel state={state} seat={viewerSeat} nameOf={nameOf} ready={!myPending} onReady={() => act({ type: "ready" })} />}
      {state.phase === "gameOver" && <FinalPanel state={state} nameOf={nameOf} viewerSeat={viewerSeat} onGameEnd={onGameEnd} />}

      {/* log */}
      <div className={PANEL}>
        <div className={H}>📜 기록</div>
        <ul className="flex flex-col gap-0.5 text-[11px] text-white/70">
          {recentLog.map(({ e, text }) => (
            <li key={e.seq}>{text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PlanPanel({
  state,
  seat,
  nameOf,
  submitted,
  onSubmit,
}: {
  state: ResolveState;
  seat: SeatIndex;
  nameOf: (s: SeatIndex) => string;
  submitted: boolean;
  onSubmit: (s: Strength, d: Declare, bet: Bet | null) => void;
}) {
  const [strength, setStrength] = useState<Strength>("proper");
  const [declare, setDeclare] = useState<Declare>("friend");
  const [bet, setBet] = useState<Bet | null>(null);
  const me = state.players[seat];
  const ev = eventOf(state);
  const preview = previewPlan(state, seat, strength, declare);
  const solved = solveRun(preview);
  const gain = successGain(strength, declare, ev);

  if (submitted) {
    return (
      <div className={`${PANEL} text-center text-sm text-white/70`}>
        🤫 결심을 적어 냈어요. 다른 사람들을 기다리는 중…
        {me.plan && (
          <div className="mt-1 text-xs text-white/50">
            {STRENGTHS[me.plan.strength].emoji} {STRENGTHS[me.plan.strength].name} · {DECLARES[me.plan.declare].emoji} {DECLARES[me.plan.declare].name}
            {me.plan.bet && ` · ${me.plan.bet.kind === "cheer" ? "👏 응원" : "🍿 구경"} → ${nameOf(me.plan.bet.target)}`}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={PANEL}>
      <div className={H}>
        <span>📝 시즌 {state.season} 결심 세우기</span>
        <span className="font-normal text-white/45">모두 동시에 공개돼요</span>
      </div>
      <div className="mb-1 text-[11px] font-bold text-white/60">① 얼마나 독하게?</div>
      <div className="grid grid-cols-3 gap-1.5">
        {STRENGTH_IDS.map((s) => {
          const d = STRENGTHS[s];
          const on = s === strength;
          return (
            <button
              key={s}
              onClick={() => setStrength(s)}
              className={`flex min-h-24 flex-col items-center gap-0.5 rounded-xl border-2 p-1.5 text-center transition ${on ? "border-teal-300 bg-teal-400/20" : "border-white/10 bg-black/20 hover:border-white/30"}`}
            >
              <span className="text-2xl">{d.emoji}</span>
              <span className="text-xs font-black">{d.name}</span>
              <span className="text-[10px] text-white/55">{d.examples[(state.season + seat) % d.examples.length]}</span>
              <span className="text-[11px] font-bold text-amber-200">성공 {d.reward}점</span>
              <span className="flex flex-wrap justify-center gap-0.5 text-[11px]">{d.extra.length ? d.extra.map((t, i) => <span key={i}>+{TOKENS[t].emoji}</span>) : <span className="text-white/40">추가 유혹 없음</span>}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-1 mt-2.5 text-[11px] font-bold text-white/60">② 누구에게 말할까?</div>
      <div className="grid grid-cols-3 gap-1.5">
        {DECLARE_IDS.map((k) => {
          const d = DECLARES[k];
          const on = k === declare;
          return (
            <button key={k} onClick={() => setDeclare(k)} className={`flex flex-col items-center gap-0.5 rounded-xl border-2 p-1.5 text-center transition ${on ? "border-teal-300 bg-teal-400/20" : "border-white/10 bg-black/20 hover:border-white/30"}`}>
              <span className="text-xl">{d.emoji}</span>
              <span className="text-xs font-black">{d.name}</span>
              <span className="text-[11px] font-bold text-amber-200">보상 ×{d.mult}</span>
              <span className="text-[10px] text-white/60">
                한계 {d.limit > 0 ? `+${d.limit}` : d.limit === 0 ? "±0" : d.limit}
                {d.penalty ? ` · 실패 −${d.penalty}` : " · 벌점 없음"}
              </span>
              {d.facePenalty > 0 && <span className="text-[10px] text-white/45">타협하면 체면 −{d.facePenalty}</span>}
            </button>
          );
        })}
      </div>

      {state.playerCount > 1 && (
        <>
          <div className="mb-1 mt-2.5 text-[11px] font-bold text-white/60">③ 다른 사람에게 걸기 (선택 · 시즌 끝에 공개)</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setBet(null)} className={`rounded-full border px-2.5 py-1 text-[11px] ${!bet ? "border-teal-300 bg-teal-400/20" : "border-white/15"}`}>
              안 걸기
            </button>
            {state.players.map((_, t) =>
              t === seat ? null : (
                <span key={t} className="flex overflow-hidden rounded-full border border-white/15 text-[11px]">
                  <span className="max-w-24 truncate px-2 py-1 text-white/70">{nameOf(t)}</span>
                  {(["cheer", "watch"] as const).map((kind) => {
                    const on = bet?.target === t && bet.kind === kind;
                    return (
                      <button key={kind} onClick={() => setBet({ target: t, kind })} className={`px-2 py-1 ${on ? (kind === "cheer" ? "bg-emerald-500/50" : "bg-rose-500/50") : "bg-white/5 hover:bg-white/15"}`} title={kind === "cheer" ? `성공하면 나 +${TUNING.cheerPay}, 상대 한계 +${TUNING.cheerLimit}` : `무너지면 나 +${TUNING.watchPay}`}>
                        {kind === "cheer" ? "👏" : "🍿"}
                      </button>
                    );
                  })}
                </span>
              ),
            )}
          </div>
          <p className="mt-1 text-[10px] text-white/45">
            👏 응원: 그 사람이 성공하면 나 +{TUNING.cheerPay}, 그 사람은 한계 +{TUNING.cheerLimit} · 🍿 구경: 그 사람이 무너지면 나 +{TUNING.watchPay}
          </p>
        </>
      )}

      <div className="mt-2.5 rounded-xl bg-black/30 p-2">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
          <span className="font-bold text-white/70">이번 시즌 내 주머니 (한계 {preview.limit})</span>
          <span className="text-white/60">
            끝까지 버티면 성공 <b className="text-teal-200">{pct(solved.pushAllSuccess)}</b> · 성공 시 <b className="text-amber-200">+{gain}</b>
          </span>
        </div>
        <div className="mt-1.5">
          <BagView bag={preview.pool} compact />
        </div>
        <p className="mt-1 text-[10px] text-white/45">
          뽑은 토큰은 다시 주머니로 들어가요 · 7일 동안 {DAYS + (ev.crisisDraws ?? 2) - 1}개를 뽑아요 (3일차 {ev.crisisDraws ?? 2}개) · 📘 교훈 {me.lessons}개
        </p>
      </div>
      <button onClick={() => onSubmit(strength, declare, bet)} className="mt-2 w-full rounded-xl bg-teal-400 py-2.5 text-sm font-black text-black hover:bg-teal-300">
        ✍️ 이렇게 결심하기
      </button>
    </div>
  );
}

function DayPanel({ state, seat, myPending, onChoose }: { state: ResolveState; seat: SeatIndex; myPending: boolean; onChoose: (c: "push" | "stop" | "cheat") => void }) {
  const me = state.players[seat];
  const run = me.run!;
  const draws = drawsForDay(state);
  const risk = bustChance({ pool: run.pool, sum: run.sum, limit: run.limit, lessons: me.lessons }, draws);
  const inp = solveInputFor(state, seat)!;
  const solved = solveRun(inp, cheatAllowed(state, seat));
  const stopGain = compromiseGain(run.declare, run.daysDone);
  const winGain = successGain(run.strength, run.declare, eventOf(state)) - (run.cheatUsed ? TUNING.cheatCost : 0);
  const going = run.status === "going";

  return (
    <div className={PANEL}>
      <div className={H}>
        <span>
          {STRENGTHS[run.strength].emoji} 내 결심 · {DECLARES[run.declare].emoji} {DECLARES[run.declare].name}
        </span>
        {statusBadge(run)}
      </div>
      <Gauge sum={run.sum} limit={run.limit} busted={run.status === "busted"} />
      <div className="mt-2 flex min-h-10 flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/50">뽑은 것</span>
        {run.drawn.length === 0 ? <span className="text-[11px] text-white/35">아직 없음</span> : run.drawn.map((t, i) => <Token key={i} id={t} size="sm" />)}
        {run.cheatUsed && <span className="rounded-full bg-pink-500/25 px-2 text-[10px]">🍰 치팅데이 씀</span>}
      </div>
      <div className="mt-2 rounded-xl bg-black/30 p-2">
        <div className="mb-1 text-[11px] text-white/60">주머니 (뽑아도 다시 들어가요)</div>
        <BagView bag={run.pool} compact />
      </div>

      {going && myPending && (
        <>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <button onClick={() => onChoose("push")} className={`flex flex-col items-center rounded-xl border-2 p-2 ${solved.best === "push" ? "border-teal-300" : "border-transparent"} bg-teal-500/80 text-black hover:bg-teal-400`}>
              <span className="text-lg">✊</span>
              <span className="text-sm font-black">버티기</span>
              <span className="text-[11px] font-bold">{draws}개 뽑기</span>
              <span className={`mt-0.5 rounded-full px-1.5 text-[11px] font-black ${risk >= 0.4 ? "bg-rose-600 text-white" : risk >= 0.2 ? "bg-amber-300 text-black" : "bg-black/20"}`}>무너질 확률 {pct(risk)}</span>
            </button>
            <button onClick={() => onChoose("stop")} className={`flex flex-col items-center rounded-xl border-2 p-2 ${solved.best === "stop" ? "border-teal-300" : "border-transparent"} bg-sky-500/30 hover:bg-sky-500/45`}>
              <span className="text-lg">🤝</span>
              <span className="text-sm font-black">타협</span>
              <span className="text-[11px]">여기서 멈추기</span>
              <span className="mt-0.5 text-[11px] font-black text-sky-100">
                {stopGain >= 0 ? "+" : ""}
                {stopGain}점
              </span>
            </button>
            <button
              onClick={() => cheatAllowed(state, seat) && onChoose("cheat")}
              disabled={!cheatAllowed(state, seat)}
              className={`flex flex-col items-center rounded-xl border-2 p-2 ${solved.best === "cheat" ? "border-teal-300" : "border-transparent"} bg-pink-500/30 hover:bg-pink-500/45 disabled:opacity-35`}
            >
              <span className="text-lg">🍰</span>
              <span className="text-sm font-black">치팅데이</span>
              <span className="text-[11px]">오늘은 안 뽑음</span>
              <span className="mt-0.5 text-[11px] font-black text-pink-100">{run.cheatUsed ? "이미 씀" : state.day === CRISIS_DAY ? "고비엔 불가" : `성공 보상 −${TUNING.cheatCost}`}</span>
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-white/55">
            지금부터 끝까지 버티면 성공 {pct(solved.pushAllSuccess)} → +{winGain}점 · 무너지면 {-DECLARES[run.declare].penalty === 0 ? "0" : `−${DECLARES[run.declare].penalty}`}점
            {me.lessons > 0 && ` · 📘 교훈 ${me.lessons}개가 무너질 토큰을 막아줘요`}
          </p>
        </>
      )}
      {going && !myPending && <p className="mt-2 text-center text-sm text-white/60">✔ 오늘 선택 완료 — 다른 사람을 기다리는 중…</p>}
      {!going && <p className="mt-2 text-center text-sm text-white/60">이번 시즌은 끝났어요. 다른 사람들의 일주일을 지켜봐요 👀</p>}
    </div>
  );
}

function ReviewPanel({ state, seat, nameOf, ready, onReady }: { state: ResolveState; seat: SeatIndex; nameOf: (s: SeatIndex) => string; ready: boolean; onReady: () => void }) {
  return (
    <div className={PANEL}>
      <div className={H}>
        <span>📊 시즌 {state.season} 결과</span>
        <span className="font-normal text-white/45">{state.season >= SEASONS ? "마지막 시즌이었어요" : "다음 시즌 준비"}</span>
      </div>
      <div className="flex flex-col gap-1">
        {state.players.map((p, s) => {
          const h = p.history[p.history.length - 1];
          const run = p.run!;
          if (!h) return null;
          return (
            <div key={s} className={`flex flex-wrap items-center justify-between gap-1 rounded-lg px-2 py-1 text-xs ${s === seat ? "bg-teal-400/15" : "bg-black/20"}`}>
              <span className="flex items-center gap-1 font-bold">
                <span style={{ color: SEAT_COLORS[s] }}>{SEAT_SHAPES[s]}</span>
                {nameOf(s)}
                {statusBadge(run)}
              </span>
              <span className="flex items-center gap-2">
                {run.bet && (
                  <span className="text-[10px] text-white/60">
                    {run.bet.kind === "cheer" ? "👏" : "🍿"} {nameOf(run.bet.target)} {h.betGain ? `+${h.betGain}` : "✗"}
                  </span>
                )}
                <span className={`font-black tabular-nums ${h.gain > 0 ? "text-amber-200" : h.gain < 0 ? "text-rose-300" : "text-white/60"}`}>
                  {h.gain >= 0 ? "+" : ""}
                  {h.gain}
                </span>
                <span className="text-white/50">→ {p.score}점</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-white/50">✅ 성공: 😞 자책 1개를 털어내거나 💧 의지 +1 · 💥 실패: 😞 자책 +1, 📘 교훈 +1 (최대 {TUNING.maxLessons})</p>
      <button onClick={onReady} disabled={ready} className="mt-2 w-full rounded-xl bg-teal-400 py-2.5 text-sm font-black text-black hover:bg-teal-300 disabled:bg-white/15 disabled:text-white/50">
        {ready ? "✔ 다른 사람 기다리는 중…" : state.season >= SEASONS ? "🏁 최종 결과 보기" : "▶ 다음 시즌으로"}
      </button>
    </div>
  );
}

function FinalPanel({ state, nameOf, viewerSeat, onGameEnd }: { state: ResolveState; nameOf: (s: SeatIndex) => string; viewerSeat: SeatIndex; onGameEnd: () => void }) {
  const ranks = computeRankings(state);
  return (
    <div className={`${PANEL} border-amber-300/40`}>
      <div className={H}>🏆 최종 결과</div>
      <div className="flex flex-col gap-1">
        {ranks.map((r) => {
          const p = state.players[r.seat];
          return (
            <div key={r.seat} className={`rounded-lg px-2 py-1.5 ${r.seat === viewerSeat ? "bg-teal-400/15" : "bg-black/20"}`}>
              <div className="flex items-center justify-between text-sm font-bold">
                <span>
                  {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `${r.rank}.`} {nameOf(r.seat)}
                </span>
                <span className="tabular-nums">{p.score}점</span>
              </div>
              <div className="mt-0.5 flex gap-0.5 text-sm" aria-label="시즌별 결과">
                {p.history.map((h) => (
                  <span key={h.season} title={`시즌 ${h.season}: ${STRENGTHS[h.strength].name} · ${DECLARES[h.declare].name} · ${h.gain}점`}>
                    {h.status === "done" ? "✅" : h.status === "busted" ? "💥" : "🤝"}
                  </span>
                ))}
                <span className="ml-1 text-[10px] text-white/50">
                  성공 {p.successes} · 실패 {p.fails} · 타협 {p.compromises}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={onGameEnd} className="mt-2 w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-black hover:bg-amber-300">
        결과 저장하고 나가기
      </button>
    </div>
  );
}
