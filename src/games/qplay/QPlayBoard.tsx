"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  CHOSUNG_TRIES,
  CLIMB_TOP,
  MINI_INFO,
  computeRankings,
  correctOrder,
  currentMini,
  currentQuestion,
  eligibleSeats,
  hasFinished,
  phaseDurationMs,
  type EngineAction,
  type GameState,
  type Question,
  type Seat,
} from "./engine";
import RulebookModal from "./RulebookModal";
import { getQPlaySound, qplayCues } from "./qplaySound";

export const SEAT_COLORS = ["#f43f5e", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#84cc16"];
const NUMS = ["①", "②", "③", "④"];

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-4 light:border-slate-200 light:bg-white light:shadow-sm";
const BTN = "rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-40";
const PRIMARY = `${BTN} bg-sky-500 text-white hover:bg-sky-400`;

interface Props {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  isHost: boolean;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const initial = (name: string) => Array.from(name.replace(/^🤖\s*(AI\s*)?/, ""))[0] ?? "?";

function SeatDot({ seat, names }: { seat: Seat; names: Record<Seat, string> }) {
  return (
    <span
      title={names[seat]}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black text-white ring-2 ring-black/20"
      style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length] }}
    >
      {initial(names[seat] ?? "?")}
    </span>
  );
}

/* ── 문제 카드 ─────────────────────────────────────────────── */

function QuestionCard({ q, mini, index, total }: { q: Question; mini: ReturnType<typeof currentMini>; index: number; total: number }) {
  const info = MINI_INFO[mini];
  return (
    <div className="relative overflow-hidden rounded-3xl border-2 p-5 text-center shadow-lg sm:p-7" style={{ borderColor: `${info.color}88`, background: `linear-gradient(160deg, ${info.color}26, transparent 70%)` }}>
      <span className="absolute top-2 left-3 text-[11px] font-black tracking-widest text-white/50 light:text-slate-500">
        Q{index + 1}/{total}
      </span>
      {q.label && <p className="mb-1 text-xs font-bold text-white/60 light:text-slate-500">{q.label}</p>}
      {q.kind === "chosung" ? (
        <>
          <p className="text-base font-bold text-white/80 light:text-slate-700">{q.topic?.emoji} {q.topic?.name}</p>
          <p className="mt-1 text-5xl font-black tracking-[0.25em] text-white sm:text-6xl light:text-slate-900">{q.chosung}</p>
        </>
      ) : (
        <p className={`break-keep font-black text-white light:text-slate-900 ${q.prompt.length > 30 ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl"}`}>{q.prompt}</p>
      )}
    </div>
  );
}

/* ── 보기 ─────────────────────────────────────────────────── */

function ChoiceGrid({
  state,
  names,
  picked,
  reveal,
  disabled,
  onPick,
}: {
  state: GameState;
  names: Record<Seat, string>;
  picked: number | null;
  reveal: boolean;
  disabled: boolean;
  onPick: (i: number) => void;
}) {
  const q = currentQuestion(state)!;
  const ox = q.kind === "ox";
  const pickers = (i: number) =>
    Object.entries(state.answers)
      .filter(([, a]) => a.choice === i)
      .map(([s]) => Number(s));
  return (
    <div className={`grid gap-2 ${ox ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
      {q.choices.map((c, i) => {
        const isAnswer = reveal && i === q.answer;
        const mineWrong = reveal && picked === i && i !== q.answer;
        const mine = picked === i;
        const base = ox
          ? i === 0
            ? "border-sky-400/60 bg-sky-500/15 text-sky-50 light:bg-sky-50 light:text-sky-800"
            : "border-rose-400/60 bg-rose-500/15 text-rose-50 light:bg-rose-50 light:text-rose-800"
          : "border-white/15 bg-white/[0.05] text-white light:border-slate-200 light:bg-slate-50 light:text-slate-800";
        const tone = isAnswer
          ? "border-emerald-400 bg-emerald-500/25 text-emerald-50 ring-2 ring-emerald-400 light:bg-emerald-50 light:text-emerald-800"
          : mineWrong
            ? "border-rose-500 bg-rose-600/25 text-rose-100 light:bg-rose-50 light:text-rose-700"
            : mine
              ? "border-amber-300 bg-amber-400/20 text-amber-50 ring-2 ring-amber-300 light:bg-amber-50 light:text-amber-800"
              : base;
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onPick(i)}
            className={`relative flex min-h-14 items-center gap-2 rounded-2xl border-2 px-4 py-3 text-left font-bold transition active:scale-[0.98] disabled:cursor-default ${tone} ${ox ? "min-h-28 justify-center text-6xl" : "text-base"} ${reveal && !isAnswer && !mineWrong ? "opacity-50" : ""}`}
          >
            {ox ? (
              <span aria-label={c === "O" ? "맞다" : "틀리다"}>{c === "O" ? "⭕" : "❌"}</span>
            ) : (
              <>
                <span className="shrink-0 text-lg opacity-70">{NUMS[i]}</span>
                <span className="min-w-0 flex-1 break-keep">{c}</span>
              </>
            )}
            {isAnswer && <span className="absolute top-1 right-2 text-lg">✔</span>}
            {mineWrong && <span className="absolute top-1 right-2 text-lg">✘</span>}
            {reveal && pickers(i).length > 0 && (
              <span className={`flex flex-wrap gap-0.5 ${ox ? "absolute bottom-2 left-1/2 -translate-x-1/2" : ""}`}>
                {pickers(i).map((s) => (
                  <SeatDot key={s} seat={s} names={names} />
                ))}
              </span>
            )}
            {mine && !reveal && <span className="absolute top-1 right-2 text-[10px] font-black text-amber-200 light:text-amber-700">내 선택</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── 초성 입력 ────────────────────────────────────────────── */

function ChosungInput({ state, viewerSeat, onAction }: { state: GameState; viewerSeat: Seat; onAction: (a: EngineAction) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mine = state.answers[viewerSeat];
  const wrongs = mine?.wrongs ?? [];
  const done = hasFinished(state, viewerSeat);
  const eligible = eligibleSeats(state).includes(viewerSeat);
  useEffect(() => {
    if (!done) inputRef.current?.focus();
  }, [done, state.qIndex]);
  function submit() {
    const el = inputRef.current;
    if (!el || !el.value.trim()) return;
    getQPlaySound().unlock();
    onAction({ type: "TYPE", seat: viewerSeat, q: state.qIndex, text: el.value });
    el.value = "";
  }
  if (!eligible) return null;
  if (mine?.correct) return <p className="rounded-xl bg-emerald-500/15 px-3 py-3 text-center text-base font-black text-emerald-200 light:text-emerald-700">✅ 정답! “{mine.text}” — 다른 사람을 기다리는 중</p>;
  if (done) return <p className="rounded-xl bg-rose-500/10 px-3 py-3 text-center text-sm font-bold text-rose-300 light:text-rose-700">❌ {CHOSUNG_TRIES}번 모두 틀렸어요 — 정답 공개를 기다려요</p>;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <input
          ref={inputRef}
          autoComplete="off"
          enterKeyHint="send"
          placeholder="정답 입력 후 엔터"
          maxLength={12}
          className="min-w-0 flex-1 rounded-xl border-2 border-pink-400/50 bg-white/5 px-4 py-3 text-lg font-bold text-white placeholder:text-white/30 focus:border-pink-300 focus:outline-none light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
        />
        <button type="submit" className={`${PRIMARY} shrink-0 bg-pink-500 px-5 text-base hover:bg-pink-400`}>
          제출
        </button>
      </div>
      <p className="text-xs text-white/50 light:text-slate-500">
        남은 기회 {"🔸".repeat(CHOSUNG_TRIES - wrongs.length)}
        {"▫️".repeat(wrongs.length)} {wrongs.length > 0 && <span className="text-rose-300 light:text-rose-600">· 틀림: {wrongs.join(", ")}</span>}
      </p>
    </form>
  );
}

/* ── 올라올라 ─────────────────────────────────────────────── */

function ClimbLadder({ state, viewerSeat, names }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string> }) {
  return (
    <div className={`${PANEL} flex flex-col gap-1.5`}>
      {Array.from({ length: state.seatCount }, (_, s) => s)
        .sort((a, b) => state.floor[b] - state.floor[a] || a - b)
        .map((s) => {
          const done = state.floor[s] >= CLIMB_TOP;
          const place = state.finishOrder.indexOf(s);
          return (
            <div key={s} className="flex items-center gap-2 text-xs">
              <span className={`w-20 shrink-0 truncate ${s === viewerSeat ? "font-black text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>{names[s]}</span>
              <div className="relative flex h-5 flex-1 gap-0.5">
                {Array.from({ length: CLIMB_TOP }, (_, f) => (
                  <span key={f} className="flex-1 rounded-sm" style={{ background: f < state.floor[s] ? SEAT_COLORS[s % SEAT_COLORS.length] : "rgba(148,163,184,0.18)" }} />
                ))}
              </div>
              <span className="w-12 shrink-0 text-right font-black tabular-nums text-white light:text-slate-900">{done ? (place === 0 ? "🥇" : place === 1 ? "🥈" : place === 2 ? "🥉" : "🏁") : `${state.floor[s]}층`}</span>
            </div>
          );
        })}
    </div>
  );
}

function ClimbPanel({ state, viewerSeat, nowMs, onAction }: { state: GameState; viewerSeat: Seat; nowMs: number; onAction: (a: EngineAction) => void }) {
  const idx = state.climbIdx[viewerSeat];
  const q = state.questions[idx];
  const [lockUntil, setLockUntil] = useState(0);
  const [sentIdx, setSentIdx] = useState(-1);
  const prevIdx = useRef(idx);
  useEffect(() => {
    if (prevIdx.current !== idx && state.lastClimb[viewerSeat] === false) setLockUntil(Date.now() + 1000);
    prevIdx.current = idx;
  }, [idx, state.lastClimb, viewerSeat]);
  const top = state.floor[viewerSeat] >= CLIMB_TOP;
  if (top) return <div className={`${PANEL} text-center text-2xl font-black text-emerald-200 light:text-emerald-700`}>🏁 꼭대기 도착! {state.finishOrder.indexOf(viewerSeat) + 1}등</div>;
  if (!q) return <div className={`${PANEL} text-center text-sm text-white/60`}>문제를 다 풀었어요!</div>;
  const locked = nowMs < lockUntil || sentIdx === idx;
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <div className="flex items-center justify-between text-xs text-white/60 light:text-slate-500">
        <span>🧗 {state.floor[viewerSeat]}층 / {CLIMB_TOP}층</span>
        {state.lastClimb[viewerSeat] === false && nowMs < lockUntil && <span className="animate-pulse font-black text-rose-300 light:text-rose-600">❌ 미끄러졌다! 잠깐 멈춤</span>}
        {state.lastClimb[viewerSeat] === true && <span className="font-black text-emerald-300 light:text-emerald-600">⬆️ 한 층 위로!</span>}
      </div>
      <p className="text-center text-3xl font-black text-white tabular-nums light:text-slate-900">{q.prompt}</p>
      <div className="grid grid-cols-3 gap-2">
        {q.choices.map((c, i) => (
          <button
            key={`${idx}-${i}`}
            type="button"
            disabled={locked}
            onClick={() => {
              getQPlaySound().unlock();
              setSentIdx(idx);
              onAction({ type: "CLIMB", seat: viewerSeat, idx, choice: i });
            }}
            className="min-h-16 rounded-2xl border-2 border-teal-400/50 bg-teal-500/15 text-2xl font-black text-white tabular-nums transition active:scale-95 disabled:opacity-40 light:bg-teal-50 light:text-teal-900"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── 미사일 ───────────────────────────────────────────────── */

function Hearts({ hp }: { hp: number }) {
  return (
    <span className="tracking-tighter" aria-label={`하트 ${hp}개`}>
      {"❤️".repeat(hp)}
      {"🖤".repeat(Math.max(0, 3 - hp))}
    </span>
  );
}

function AimPanel({ state, viewerSeat, names, onAction }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; onAction: (a: EngineAction) => void }) {
  const shooter = state.shooter!;
  const q = currentQuestion(state)!;
  if (shooter !== viewerSeat) {
    return (
      <div className={`${PANEL} flex flex-col items-center gap-2 text-center`}>
        <p className="text-sm text-white/70 light:text-slate-600">정답: <b className="text-emerald-300 light:text-emerald-700">{q.choices[q.answer]}</b></p>
        <p className="animate-pulse text-xl font-black text-orange-200 light:text-orange-700">🚀 {names[shooter]}님이 조준 중…</p>
        <p className="text-xs text-white/50 light:text-slate-500">누구를 노릴까요? 7초 안에 안 고르면 하트가 가장 많은 사람에게 자동 발사</p>
      </div>
    );
  }
  const targets = Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => s !== viewerSeat && state.alive[s]);
  return (
    <div className={`${PANEL} flex flex-col gap-3 border-orange-400/50`}>
      <p className="text-center text-xl font-black text-orange-200 light:text-orange-700">🚀 가장 먼저 맞혔어요! 누구에게 쏠까요?</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {targets.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onAction({ type: "FIRE", seat: viewerSeat, target: s })}
            className="flex min-h-14 flex-col items-center justify-center rounded-2xl border-2 border-orange-400/50 bg-orange-500/10 px-2 py-2 font-bold text-white transition hover:bg-orange-500/25 active:scale-95 light:text-slate-900"
          >
            <span className="flex items-center gap-1.5 truncate">
              <SeatDot seat={s} names={names} /> {names[s]}
            </span>
            <span className="text-sm">
              <Hearts hp={state.hp[s]} /> {state.hp[s] === 1 && <span className="text-[11px] font-black text-rose-300">격추 가능!</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShotBanner({ state, names }: { state: GameState; names: Record<Seat, string> }) {
  const shot = state.shot;
  if (!shot) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 flex justify-center">
      <div className="qplay-shot flex items-center gap-2 rounded-full bg-slate-950/85 px-5 py-2 text-lg font-black text-white shadow-2xl">
        <span>{names[shot.from]}</span>
        <span className="qplay-rocket">🚀</span>
        <span>{names[shot.to]}</span>
        <span className="qplay-boom">💥</span>
        {shot.kill && <span className="text-rose-300">격추!</span>}
      </div>
    </div>
  );
}

/* ── 공개 ─────────────────────────────────────────────────── */

function RevealPanel({ state, viewerSeat, names }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string> }) {
  const q = currentQuestion(state)!;
  const mini = currentMini(state);
  const order = correctOrder(state);
  const mine = state.answers[viewerSeat];
  return (
    <div className={`${PANEL} flex flex-col gap-2`}>
      {q.kind === "chosung" && (
        <p className="text-center text-2xl font-black text-emerald-200 light:text-emerald-700">
          정답: {q.word} <span className="text-sm font-bold text-white/60 light:text-slate-500">({q.chosung})</span>
        </p>
      )}
      {q.explain && <p className="break-keep text-center text-sm text-white/75 light:text-slate-600">💡 {q.explain}</p>}
      {mini === "ox" && state.revived && <p className="text-center text-base font-black text-amber-200 light:text-amber-700">😇 전원 오답 — 모두 부활!</p>}
      {mini === "ox" && state.eliminated.length > 0 && (
        <p className="text-center text-sm font-bold text-rose-300 light:text-rose-600">💀 탈락: {state.eliminated.map((s) => names[s]).join(", ")}</p>
      )}
      {state.shot && (
        <p className="text-center text-sm font-bold text-orange-200 light:text-orange-700">
          🚀 {names[state.shot.from]} → {names[state.shot.to]} {state.shot.auto ? "(자동 조준)" : ""} · 하트 −1{state.shot.kill ? " · 💀 격추!" : ""}
        </p>
      )}
      {mini === "missile" && !state.shot && <p className="text-center text-sm text-white/60 light:text-slate-500">아무도 맞히지 못해 미사일이 없어요</p>}
      {order.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {order.map((s, rank) => (
            <span key={s} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${s === viewerSeat ? "bg-amber-400/25 text-amber-100 light:text-amber-800" : "bg-white/10 text-white/80 light:bg-slate-100 light:text-slate-700"}`}>
              {rank + 1}등 {names[s]}
              {q.kind === "chosung" && state.answers[s]?.text && <span className="opacity-70">“{state.answers[s].text}”</span>}
              {state.gained[s] > 0 && <span className="text-emerald-300 light:text-emerald-700">+{state.gained[s]}</span>}
            </span>
          ))}
        </div>
      )}
      {order.length === 0 && mini !== "missile" && <p className="text-center text-sm text-white/60 light:text-slate-500">아무도 맞히지 못했어요 😮</p>}
      {mine && !mine.correct && mine.choice !== null && <p className="text-center text-xs text-rose-300 light:text-rose-600">내 답: {q.choices[mine.choice]}</p>}
    </div>
  );
}

/* ── 미니 게임 결과 · 최종 ─────────────────────────────────── */

function MiniEndPanel({ state, viewerSeat, names, isHost, onAction }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; isHost: boolean; onAction: (a: EngineAction) => void }) {
  const record = state.history[state.history.length - 1];
  const info = MINI_INFO[record.mini];
  const rows = Array.from({ length: state.seatCount }, (_, s) => s).sort((a, b) => record.scores[b] - record.scores[a] || a - b);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">
        {info.emoji} {info.name} 결과
      </h3>
      <ol className="flex flex-col gap-1">
        {rows.map((s) => (
          <li key={s} className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm ${s === viewerSeat ? "bg-amber-400/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-6 text-center">{record.winners.includes(s) ? "👑" : ""}</span>
            <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">{names[s]}</span>
            {state.gained[s] > 0 && <span className="text-[11px] text-white/50 light:text-slate-400">보너스 +{state.gained[s]}</span>}
            <span className="w-14 text-right font-black text-emerald-300 tabular-nums light:text-emerald-700">+{record.scores[s]}</span>
            <span className="w-16 text-right text-xs text-white/60 tabular-nums light:text-slate-500">총 {state.scores[s]}</span>
          </li>
        ))}
      </ol>
      {state.miniIndex + 1 < state.plan.length && (
        <p className="text-center text-xs text-white/50 light:text-slate-500">
          다음: {MINI_INFO[state.plan[state.miniIndex + 1]].emoji} {MINI_INFO[state.plan[state.miniIndex + 1]].name}
        </p>
      )}
      {isHost && (
        <button onClick={() => onAction({ type: "NEXT", stage: state.stage })} className={`${PRIMARY} self-center px-6`}>
          {state.miniIndex + 1 < state.plan.length ? "다음 게임 ▶" : "최종 결과 ▶"}
        </button>
      )}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rows = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-xl font-black text-white light:text-slate-900">🏆 큐플레이 최종 순위</h3>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.seat} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${r.seat === viewerSeat ? "bg-amber-400/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-6 text-center text-lg">{r.rank === 1 ? "👑" : r.rank}</span>
            <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">{names[r.seat]}</span>
            <span className="text-xs text-amber-200 light:text-amber-700">게임 1등 {r.miniWins}</span>
            <span className="w-16 text-right font-black text-sky-200 tabular-nums light:text-sky-700">{r.score}점</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap justify-center gap-1.5 text-[11px] text-white/60 light:text-slate-500">
        {state.history.map((h, i) => (
          <span key={i} className="rounded-full bg-white/5 px-2 py-0.5 light:bg-slate-100">
            {MINI_INFO[h.mini].emoji} {h.winners.map((s) => names[s]).join("·") || "—"}
          </span>
        ))}
      </div>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 저장하고 끝내기
      </button>
    </div>
  );
}

/* ── 보드 ─────────────────────────────────────────────────── */

export default function QPlayBoard({ state, viewerSeat, names, connectedSeats, isHost, deadlineMs, nowMs, onAction, onGameEnd }: Props) {
  const [rules, setRules] = useState(false);
  const mini = currentMini(state);
  const info = MINI_INFO[mini];
  const q = currentQuestion(state);
  const remainingMs = deadlineMs === null ? null : Math.max(0, deadlineMs - nowMs);
  const remaining = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const hurry = (state.phase === "question" || state.phase === "climb" || state.phase === "aim") && remaining !== null && remaining <= (state.phase === "climb" ? 10 : 3);

  useSuiteBgm(getQPlaySound, state.phase !== "ended", hurry ? 1 : 0);
  const classify = useMemo(() => qplayCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getQPlaySound, classify);

  const lastTick = useRef<string | null>(null);
  useEffect(() => {
    const key = `${state.stage}:${remaining}`;
    if (!hurry || remaining === null || remaining <= 0 || remaining > 3 || lastTick.current === key) return;
    lastTick.current = key;
    getQPlaySound().play("tick");
  }, [hurry, remaining, state.stage]);

  // 내 선택은 방장 왕복 전에도 바로 보여 준다.
  const [localPick, setLocalPick] = useState<{ stage: number; choice: number } | null>(null);
  const myAnswer = state.answers[viewerSeat];
  const picked = myAnswer?.choice ?? (localPick && localPick.stage === state.stage ? localPick.choice : null);
  const eligible = eligibleSeats(state).includes(viewerSeat);

  const answeredSeats = new Set(Object.keys(state.answers).map(Number).filter((s) => hasFinished(state, s)));
  const scoreboard = Array.from({ length: state.seatCount }, (_, s) => s).sort((a, b) => state.scores[b] + state.miniScores[b] - (state.scores[a] + state.miniScores[a]) || a - b);
  const showQuestion = q && (state.phase === "question" || state.phase === "reveal" || state.phase === "aim") && mini !== "climb";
  const survival = mini === "ox" || mini === "missile";

  return (
    <div className="relative flex flex-col gap-3">
      <style>{`
        @keyframes qplay-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes qplay-fly { 0% { transform: translateX(-60px) rotate(45deg); opacity: 0 } 30% { opacity: 1 } 100% { transform: translateX(60px) rotate(45deg); opacity: 0 } }
        @keyframes qplay-boom { 0%, 55% { transform: scale(0); opacity: 0 } 70% { transform: scale(1.8); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
        .qplay-shot { animation: qplay-pop .35s ease-out both }
        .qplay-rocket { display: inline-block; animation: qplay-fly .6s ease-in both }
        .qplay-boom { display: inline-block; animation: qplay-boom .9s ease-out both }
        .qplay-in { animation: qplay-pop .3s ease-out both }
      `}</style>

      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          게임 {state.miniIndex + 1}/{state.plan.length}
        </span>
        <span className="text-lg font-black text-white light:text-slate-900">
          {info.emoji} {info.name}
        </span>
        {state.phase !== "intro" && state.phase !== "climb" && state.phase !== "miniEnd" && state.phase !== "ended" && (
          <span className="text-xs text-white/50 light:text-slate-500">
            문제 {state.qIndex + 1}/{state.questions.length}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getQPlaySound} icon="🎙️" label="Quiz Show" preview="miniWin" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {remaining !== null && state.phase !== "ended" && (
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${hurry ? "bg-rose-500" : "bg-sky-400"}`}
              style={{ width: `${remainingMs === null ? 0 : Math.min(100, (remainingMs / Math.max(1, phaseDurationMs(state))) * 100)}%` }}
            />
          </div>
          {(state.phase === "question" || state.phase === "climb" || state.phase === "aim") && (
            <span className={`w-8 text-right text-lg font-black tabular-nums ${hurry ? "animate-pulse text-rose-400" : "text-white light:text-slate-900"}`}>{remaining}</span>
          )}
        </div>
      )}

      {/* 소개 */}
      {state.phase === "intro" && (
        <div key={state.miniIndex} className="qplay-in flex flex-col items-center gap-2 rounded-3xl border-2 p-8 text-center" style={{ borderColor: `${info.color}99`, background: `radial-gradient(circle at 50% 30%, ${info.color}40, transparent 70%)` }}>
          <span className="text-xs font-black tracking-widest text-white/60 light:text-slate-500">GAME {state.miniIndex + 1}</span>
          <span className="text-7xl">{info.emoji}</span>
          <span className="text-3xl font-black text-white light:text-slate-900">{info.name}</span>
          <span className="break-keep text-sm font-semibold text-white/80 light:text-slate-600">{info.short}</span>
          <span className="text-xs text-white/50 light:text-slate-500">
            {mini === "climb" ? `${phaseDurationMs({ ...state, phase: "climb" }) / 1000}초 동안 각자 문제를 풀어요` : `${state.questions.length}문제`} · 곧 시작{remaining !== null ? ` ${remaining}` : ""}
          </span>
        </div>
      )}

      {/* 문제 */}
      {showQuestion && (
        <div className="relative flex flex-col gap-3">
          <QuestionCard key={`${state.miniIndex}-${state.qIndex}`} q={q} mini={mini} index={state.qIndex} total={state.questions.length} />
          {state.phase === "reveal" && <ShotBanner state={state} names={names} />}
          {q.kind !== "chosung" && (
            <ChoiceGrid
              state={state}
              names={names}
              picked={picked}
              reveal={state.phase !== "question"}
              disabled={state.phase !== "question" || !eligible || picked !== null}
              onPick={(i) => {
                getQPlaySound().unlock();
                getQPlaySound().play("pick");
                setLocalPick({ stage: state.stage, choice: i });
                onAction({ type: "ANSWER", seat: viewerSeat, q: state.qIndex, choice: i });
              }}
            />
          )}
          {state.phase === "question" && q.kind === "chosung" && <ChosungInput state={state} viewerSeat={viewerSeat} onAction={onAction} />}
          {state.phase === "question" && q.kind === "chosung" && correctOrder(state).length > 0 && (
            <p className="text-center text-xs font-bold text-emerald-300 light:text-emerald-700">
              ✅ 정답자: {correctOrder(state).map((s, i) => `${i + 1}등 ${names[s]}`).join(" · ")}
            </p>
          )}
          {state.phase === "question" && !eligible && <p className="text-center text-sm font-bold text-white/60 light:text-slate-500">💀 탈락 — 남은 사람들의 대결을 구경해요</p>}
          {state.phase === "question" && eligible && picked !== null && q.kind !== "chosung" && (
            <p className="text-center text-xs text-white/60 light:text-slate-500">
              답변 완료! 다른 사람을 기다리는 중 ({answeredSeats.size}/{eligibleSeats(state).length})
            </p>
          )}
        </div>
      )}

      {state.phase === "aim" && <AimPanel state={state} viewerSeat={viewerSeat} names={names} onAction={onAction} />}
      {state.phase === "reveal" && <RevealPanel state={state} viewerSeat={viewerSeat} names={names} />}

      {state.phase === "climb" && (
        <>
          <ClimbPanel state={state} viewerSeat={viewerSeat} nowMs={nowMs} onAction={onAction} />
          <ClimbLadder state={state} viewerSeat={viewerSeat} names={names} />
        </>
      )}

      {state.phase === "miniEnd" && <MiniEndPanel state={state} viewerSeat={viewerSeat} names={names} isHost={isHost} onAction={onAction} />}
      {state.phase === "ended" && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      {/* 점수판 */}
      {state.phase !== "ended" && (
        <div className={`${PANEL} grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4`}>
          {scoreboard.map((s) => {
            const out = survival && !state.alive[s] && state.phase !== "miniEnd";
            return (
              <div key={s} className={`flex min-w-0 items-center gap-1.5 text-xs ${out ? "opacity-45" : ""}`}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${connectedSeats.has(s) ? "" : "opacity-30"}`} style={{ background: SEAT_COLORS[s % SEAT_COLORS.length] }} />
                <span className={`min-w-0 flex-1 truncate ${s === viewerSeat ? "font-black text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>
                  {out && "💀"}
                  {names[s]}
                </span>
                {mini === "missile" && state.phase !== "intro" && state.phase !== "miniEnd" && <Hearts hp={state.hp[s]} />}
                {state.phase === "question" && answeredSeats.has(s) && <span title="답변 완료">✔️</span>}
                {state.phase === "reveal" && state.gained[s] > 0 && <span className="qplay-in font-black text-emerald-300 light:text-emerald-700">+{state.gained[s]}</span>}
                <span className="font-bold text-sky-200 tabular-nums light:text-sky-700">{state.scores[s] + (state.phase === "miniEnd" ? 0 : state.miniScores[s])}</span>
              </div>
            );
          })}
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}
