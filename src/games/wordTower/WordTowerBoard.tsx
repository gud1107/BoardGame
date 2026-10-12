"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { webglAvailable } from "./three/webgl";
import {
  MAX_WORDS_PER_ROUND,
  MODE_INFO,
  checkWord,
  claimedBy,
  closedTopicOf,
  computeRankings,
  currentLeaders,
  currentTopic,
  foundAnswers,
  pendingEntries,
  phaseDurationMs,
  roundRanking,
  towerHeight,
  voteTally,
  type EngineAction,
  type Entry,
  type GameState,
  type Seat,
} from "./engine";
import RulebookModal from "./RulebookModal";
import type { TowerView } from "./three/Tower3D";
import { getWordTowerSound, wordTowerCues } from "./wordTowerSound";

// three.js는 무거워서 3D 화면이 처음 필요할 때만 받는다
const Loading3D = () => <div className="flex h-full items-center justify-center bg-[#0b1022] text-xs text-sky-200/60">🏗️ 3D 무대 준비 중…</div>;
const Tower3D = dynamic(() => import("./three/Tower3D"), { ssr: false, loading: Loading3D });

export const SEAT_COLORS = ["#f43f5e", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#84cc16"];

type View = "3d" | "2d";
const VIEW_KEY = "word-tower-view";

function initialView(): View {
  if (!webglAvailable()) return "2d";
  try {
    return window.localStorage.getItem(VIEW_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-4 light:border-slate-200 light:bg-white light:shadow-sm";
const BTN = "rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-40";
const PRIMARY = `${BTN} bg-sky-500 text-white hover:bg-sky-400`;

interface Props {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  /** 심사에서 표를 낼 수 있는 좌석(사람) — 진행도 표시용. */
  voterSeats: Seat[];
  isHost: boolean;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function statusChip(e: Entry, mine: boolean): string {
  if (e.status === "late") return "border-white/10 bg-white/[0.03] text-white/40 light:text-slate-400";
  if (e.bonus) return "border-yellow-300/80 bg-yellow-400/20 text-yellow-100 light:bg-yellow-50 light:text-yellow-800";
  switch (e.status) {
    case "pending":
      return "border-violet-400/60 bg-violet-500/15 text-violet-100 light:bg-violet-50 light:text-violet-700 border-dashed";
    case "approved":
      return "border-amber-400/70 bg-amber-400/15 text-amber-100 light:bg-amber-50 light:text-amber-800";
    case "rejected":
      return "border-rose-400/50 bg-rose-500/10 text-rose-300 line-through light:bg-rose-50 light:text-rose-600";
    default:
      return mine
        ? "border-sky-400/50 bg-sky-500/15 text-sky-50 light:bg-sky-50 light:text-sky-800"
        : "border-white/15 bg-white/5 text-white/80 light:border-slate-200 light:bg-slate-50 light:text-slate-700";
  }
}

function WordChip({ e, mine }: { e: Entry; mine: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold ${statusChip(e, mine)}`}>
      {e.word}
      <span className="text-[10px] opacity-70">{e.status === "rejected" ? "−1" : e.status === "late" ? "늦음" : `+${e.blocks}`}</span>
    </span>
  );
}

/* ── 2D 대체 화면 ─────────────────────────────────────────── */

function Towers2D({ towers }: { towers: TowerView[] }) {
  const max = Math.max(8, ...towers.map((t) => t.slabs.reduce((a, s) => a + (s.status === "rejected" ? 0 : s.blocks), 0)));
  return (
    <div className="flex h-full items-end justify-center gap-2 bg-gradient-to-b from-[#0b1022] to-[#1e293b] px-3 pt-8 pb-2">
      {towers.map((t) => (
        <div key={t.seat} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
          {t.crowned && <span className="text-lg">👑</span>}
          <span className="mb-1 text-[11px] font-black text-white">{t.height}층</span>
          <div className="flex w-full max-w-14 flex-col-reverse">
            {t.slabs
              .filter((s) => s.status !== "rejected")
              .map((s) => (
                <div
                  key={s.id}
                  className={`overflow-hidden border-b border-black/20 text-center text-[9px] leading-none font-bold text-white ${s.status === "pending" ? "opacity-50" : ""}`}
                  style={{ height: `${(s.blocks / max) * 100 * 2.2}px`, maxHeight: 40, minHeight: 4, background: t.color }}
                >
                  {s.label}
                </div>
              ))}
          </div>
          <span className={`mt-1 w-full truncate text-center text-[10px] ${t.isMe ? "font-black text-amber-300" : "text-white/70"}`}>{t.name}</span>
        </div>
      ))}
    </div>
  );
}

/* ── 입력창 ───────────────────────────────────────────────── */

function WordInput({ state, viewerSeat, onAction }: { state: GameState; viewerSeat: Seat; onAction: (a: EngineAction) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submitAfterCompose = useRef(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const mineCount = state.entries.filter((e) => e.seat === viewerSeat).length;

  function submit() {
    const el = inputRef.current;
    if (!el) return;
    // 상태값 대신 입력창의 실제 값을 읽는다 — 한글 조합 중 마지막 글자가 빠지지 않게.
    const text = el.value;
    if (!text.trim()) return;
    const check = checkWord(state, viewerSeat, text);
    if (!check.ok) {
      setFeedback({ ok: false, text: check.reason });
      getWordTowerSound().play("invalid");
      el.select();
      return;
    }
    onAction({ type: "SUBMIT", seat: viewerSeat, text });
    const closed = closedTopicOf(state.topics[state.roundIndex]) !== null;
    setFeedback(
      closed
        ? check.inDict
          ? { ok: true, text: `✅ 정답! ${check.word} +${check.blocks}층` }
          : { ok: false, text: `❌ "${check.word}"은(는) 정답이 아니에요 −1층` }
        : { ok: true, text: check.inDict ? `✅ ${check.word} +${check.blocks}층` : `🟣 ${check.word} — 사전에 없어서 라운드 끝에 심사받아요` },
    );
    el.value = "";
    el.focus();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          placeholder={closedTopicOf(state.topics[state.roundIndex]) ? `${currentTopic(state).emoji} ${currentTopic(state).name} 정답 입력 후 엔터` : `${currentTopic(state).emoji} ${currentTopic(state).name} 단어 입력 후 엔터`}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            getWordTowerSound().unlock();
            // 조합 중 엔터: 조합이 끝난 뒤 제출한다
            if (e.nativeEvent.isComposing) submitAfterCompose.current = true;
            else submit();
          }}
          onCompositionEnd={() => {
            if (!submitAfterCompose.current) return;
            submitAfterCompose.current = false;
            setTimeout(submit, 0);
          }}
          className="min-w-0 flex-1 rounded-xl border-2 border-sky-400/50 bg-white/5 px-4 py-3 text-lg font-bold text-white placeholder:text-sm placeholder:font-normal placeholder:text-white/35 focus:border-sky-300 focus:outline-none light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
        />
        <button type="submit" className={`${PRIMARY} shrink-0 px-5 text-base`} onClick={() => getWordTowerSound().unlock()}>
          쌓기
        </button>
      </form>
      <div className="flex min-h-5 items-center justify-between gap-2 text-xs">
        <span className={`break-keep ${feedback?.ok === false ? "text-rose-300 light:text-rose-600" : "text-white/60 light:text-slate-500"}`}>{feedback?.text ?? (closedTopicOf(state.topics[state.roundIndex]) ? "정답은 먼저 낸 사람이 차지(2층) · 오답 −1층 · 혼자 전부 차지하면 +3" : "띄어쓰기는 무시돼요 · 사전에 없는 단어는 심사를 받아요")}</span>
        <span className="shrink-0 text-white/40 light:text-slate-400">
          {mineCount}/{MAX_WORDS_PER_ROUND}
        </span>
      </div>
    </div>
  );
}

/* ── 심사 ─────────────────────────────────────────────────── */

function ReviewPanel({ state, viewerSeat, names, voterSeats, onAction }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; voterSeats: Seat[]; onAction: (a: EngineAction) => void }) {
  const items = pendingEntries(state);
  const myVotes = items.filter((e) => e.seat !== viewerSeat);
  const done = myVotes.filter((e) => state.votes[e.id]?.[viewerSeat] !== undefined).length;
  const finishedVoters = voterSeats.filter((v) => items.every((e) => e.seat === v || state.votes[e.id]?.[v] !== undefined)).length;
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-black text-white light:text-slate-900">🗳️ 사전에 없는 단어 심사</h3>
        <span className="text-xs text-white/50 light:text-slate-500">
          투표 마친 사람 {finishedVoters}/{voterSeats.length} · AI는 기권
        </span>
      </div>
      <p className="break-keep text-xs text-white/60 light:text-slate-500">
        &quot;{currentTopic(state).emoji} {currentTopic(state).name}&quot;에 속하는, 실제로 쓰는 단어인가요? 인정이 거절보다 많아야 통과 — 동점·무투표는 거절(−1층).
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((e) => {
          const mine = e.seat === viewerSeat;
          const my = state.votes[e.id]?.[viewerSeat];
          const { yes, no } = voteTally(state, e.id);
          return (
            <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 light:bg-violet-50">
              <span className="text-lg font-black text-white light:text-slate-900">{e.word}</span>
              <span className="text-[11px] text-white/50 light:text-slate-500">
                {mine ? "내 단어" : names[e.seat]} · +{e.blocks}층
              </span>
              <span className="ml-auto text-[11px] text-white/50 light:text-slate-500">
                ✅{yes} ❌{no}
              </span>
              {mine ? (
                <span className="text-xs text-violet-200 light:text-violet-700">다른 사람이 심사 중…</span>
              ) : (
                <span className="flex gap-1.5">
                  <button
                    onClick={() => onAction({ type: "VOTE", seat: viewerSeat, id: e.id, approve: true })}
                    aria-pressed={my === true}
                    className={`${BTN} px-3 py-1.5 ${my === true ? "bg-emerald-500 text-white" : "border border-emerald-400/40 text-emerald-200 light:text-emerald-700"}`}
                  >
                    ✅ 인정
                  </button>
                  <button
                    onClick={() => onAction({ type: "VOTE", seat: viewerSeat, id: e.id, approve: false })}
                    aria-pressed={my === false}
                    className={`${BTN} px-3 py-1.5 ${my === false ? "bg-rose-500 text-white" : "border border-rose-400/40 text-rose-200 light:text-rose-700"}`}
                  >
                    ❌ 거절
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {myVotes.length > 0 && (
        <p className="text-right text-xs text-white/50 light:text-slate-500">
          내 투표 {done}/{myVotes.length}
        </p>
      )}
    </div>
  );
}

/* ── 정답 모으기 ──────────────────────────────────────────── */

/** 쌓기 중: 정답 N개 중 내가 찾은 것(찾은 칸엔 단어, 못 찾은 칸은 ?). */
function AnswerSlots({ state, viewerSeat, names }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string> }) {
  const closed = closedTopicOf(state.topics[state.roundIndex]);
  if (!closed) return null;
  const claims = closed.answers.map((a) => ({ word: a.word, by: claimedBy(state.entries, a.word) }));
  const taken = claims.filter((c) => c.by !== null).length;
  const mine = claims.filter((c) => c.by === viewerSeat).length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-bold text-amber-200 light:text-amber-700">
        🎯 정답 {closed.answers.length}개 중 {taken}개 차지됨 · 나 {mine}개
      </span>
      {claims.map((c, i) => (
        <span
          key={c.word}
          title={c.by === null ? "아직 아무도 못 찾음" : `${c.by === viewerSeat ? "나" : names[c.by]}님이 차지`}
          className={`flex min-w-8 items-center justify-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold ${c.by === null ? "border-dashed border-white/20 text-white/30 light:border-slate-300 light:text-slate-400" : c.by === viewerSeat ? "border-amber-300/80 bg-amber-400/20 text-amber-50 light:bg-amber-50 light:text-amber-800" : "border-white/15 bg-white/5 text-white/80 light:border-slate-200 light:bg-slate-50 light:text-slate-700"}`}
        >
          {c.by !== null && <span className="h-2 w-2 rounded-full" style={{ background: SEAT_COLORS[c.by % SEAT_COLORS.length] }} />}
          {c.by === null ? i + 1 : c.word}
        </span>
      ))}
    </div>
  );
}

/** 정답 모으기: 모두가 낸 답을 실시간으로 — 최신이 위. */
function LiveFeed({ state, viewerSeat, names }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string> }) {
  if (!closedTopicOf(state.topics[state.roundIndex])) return null;
  const items = state.entries.filter((e) => !e.bonus).slice().reverse();
  return (
    <div className={`${PANEL} flex flex-col gap-1.5`}>
      <h3 className="text-xs font-bold tracking-wide text-white/60 light:text-slate-500">📢 실시간 기록 — 모두에게 보여요</h3>
      {items.length === 0 ? (
        <p className="text-xs text-white/40 light:text-slate-400">아직 아무도 답하지 않았어요. 먼저 말하는 사람이 정답을 차지해요!</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
          {items.map((e) => (
            <li key={e.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${e.seat === viewerSeat ? "bg-amber-400/10" : "bg-white/[0.03] light:bg-slate-50"}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEAT_COLORS[e.seat % SEAT_COLORS.length] }} />
              <span className="w-20 shrink-0 truncate text-xs text-white/60 light:text-slate-500">{e.seat === viewerSeat ? "나" : names[e.seat]}</span>
              <span className={`min-w-0 flex-1 truncate font-bold ${e.status === "rejected" ? "text-rose-300 line-through light:text-rose-600" : e.status === "late" ? "text-white/40 light:text-slate-400" : "text-white light:text-slate-900"}`}>{e.word}</span>
              <span className={`shrink-0 text-xs font-bold ${e.status === "ok" ? "text-emerald-300 light:text-emerald-700" : e.status === "late" ? "text-white/40 light:text-slate-400" : "text-rose-300 light:text-rose-600"}`}>
                {e.status === "ok" ? `✅ 차지 +${e.blocks}` : e.status === "late" ? "⏱ 한발 늦음" : "❌ 오답 −1"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 결과: 정답 전부 공개 + 누가 찾았는지(색 점), 아무도 못 찾은 정답은 흐리게. */
function AnswerReveal({ state, viewerSeat, names, entries, topicId }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; entries: readonly Entry[]; topicId: string }) {
  const closed = closedTopicOf(topicId);
  if (!closed) return null;
  const finders = (word: string) => Array.from({ length: state.seatCount }, (_, seat) => seat).filter((seat) => foundAnswers(entries, seat).includes(word));
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {closed.answers.map((a) => {
        const who = finders(a.word);
        return (
          <span
            key={a.word}
            title={who.map((s) => (s === viewerSeat ? "나" : names[s])).join(", ") || "아무도 못 찾음"}
            className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-sm font-bold ${who.length === 0 ? "border-dashed border-white/20 text-white/40 light:border-slate-300 light:text-slate-400" : who.includes(viewerSeat) ? "border-amber-300/70 bg-amber-400/15 text-amber-100 light:bg-amber-50 light:text-amber-800" : "border-white/15 bg-white/5 text-white light:border-slate-200 light:bg-slate-50 light:text-slate-800"}`}
          >
            {a.word}
            <span className="flex gap-0.5">
              {who.map((seat) => (
                <span key={seat} className="h-2 w-2 rounded-full" style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length] }} />
              ))}
            </span>
          </span>
        );
      })}
      <p className="w-full text-center text-[11px] text-white/45 light:text-slate-500">색 점 = 차지한 사람 · 노란 칸 = 내가 차지 · 점선 = 아무도 못 찾음</p>
    </div>
  );
}

/* ── 라운드 결과 ──────────────────────────────────────────── */

function ResultPanel({ state, viewerSeat, names, isHost, onAction }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; isHost: boolean; onAction: (a: EngineAction) => void }) {
  const record = state.history[state.history.length - 1];
  const ranking = roundRanking(record.entries, state.seatCount);
  const winners = record.winners;
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <p className="text-center text-lg font-black break-keep text-white light:text-slate-900">
        {winners.length === 0 ? "이번 라운드는 1등이 없어요" : `🏆 ${winners.map((s) => (s === viewerSeat ? "나" : names[s])).join(", ")} ${winners.length > 1 ? "공동 1등!" : "1등!"}`}
      </p>
      <AnswerReveal state={state} viewerSeat={viewerSeat} names={names} entries={record.entries} topicId={record.topicId} />
      {closedTopicOf(record.topicId)?.note && (
        <p className="rounded-xl border border-sky-300/25 bg-sky-400/10 px-3 py-2 text-sm break-keep text-sky-50 light:border-sky-200 light:bg-sky-50 light:text-sky-900">
          💡 <b>{closedTopicOf(record.topicId)!.name}</b> — {closedTopicOf(record.topicId)!.note}
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {ranking.map((r) => (
          <li key={r.seat} className={`rounded-xl border px-3 py-2 ${r.seat === viewerSeat ? "border-amber-400/50 bg-amber-400/10" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-slate-50"}`}>
            <div className="flex items-center gap-2">
              <span className="w-6 text-center font-black text-white/80 light:text-slate-700">{r.rank}</span>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: SEAT_COLORS[r.seat % SEAT_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">
                {names[r.seat]}
                {winners.includes(r.seat) && " 🏆"}
                {state.streak[r.seat] >= 2 && <span className="ml-1 text-xs text-orange-300">🔥{state.streak[r.seat]}연승</span>}
              </span>
              <span className="text-base font-black text-sky-200 light:text-sky-700">{r.height}층</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
              {record.entries
                .filter((e) => e.seat === r.seat)
                .map((e) => (
                  <WordChip key={e.id} e={e} mine={e.seat === viewerSeat} />
                ))}
              {record.entries.every((e) => e.seat !== r.seat) && <span className="text-xs text-white/40 light:text-slate-400">단어 없음</span>}
            </div>
          </li>
        ))}
      </ol>
      {isHost ? (
        <button onClick={() => onAction({ type: "NEXT", stage: state.stage })} className={`${PRIMARY} self-center px-6`}>
          {state.roundIndex >= state.topics.length - 1 ? "최종 결과 ▶" : "다음 라운드 ▶"}
        </button>
      ) : (
        <p className="text-center text-xs text-white/50 light:text-slate-500">잠시 후 다음으로 넘어가요</p>
      )}
    </div>
  );
}

/* ── 최종 ─────────────────────────────────────────────────── */

function FinalPanel({ state, viewerSeat, names, onGameEnd }: { state: GameState; viewerSeat: Seat; names: Record<Seat, string>; onGameEnd: () => void }) {
  const rows = computeRankings(state);
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-xl font-black text-white light:text-slate-900">🏙️ 최종 순위</h3>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.seat} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${r.seat === viewerSeat ? "bg-amber-400/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-6 text-center text-lg">{r.rank === 1 ? "👑" : r.rank}</span>
            <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">{names[r.seat]}</span>
            <span className="text-sm text-amber-200 light:text-amber-700">🏆 {r.wins}</span>
            <span className="w-16 text-right text-sm text-sky-200 light:text-sky-700">{r.total}층</span>
            <span className="w-12 text-right text-xs text-orange-300">{state.bestStreak[r.seat] >= 2 ? `🔥${state.bestStreak[r.seat]}` : ""}</span>
          </li>
        ))}
      </ol>
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 저장하고 끝내기
      </button>
    </div>
  );
}

/* ── 보드 ─────────────────────────────────────────────────── */

export default function WordTowerBoard({ state, viewerSeat, names, connectedSeats, voterSeats, isHost, deadlineMs, nowMs, onAction, onGameEnd }: Props) {
  const [view, setView] = useState<View>(initialView);
  const [canWebgl] = useState(webglAvailable);
  const [rules, setRules] = useState(false);
  const topic = currentTopic(state);
  const remainingMs = deadlineMs === null ? null : Math.max(0, deadlineMs - nowMs);
  const remaining = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const hurry = state.phase === "build" && remaining !== null && remaining <= 10;

  useSuiteBgm(getWordTowerSound, state.phase !== "ended", hurry ? 1 : 0);
  const classify = useMemo(() => wordTowerCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getWordTowerSound, classify);

  // 마지막 5초 째깍
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!hurry || remaining === null || remaining > 5 || remaining === lastTick.current) return;
    lastTick.current = remaining;
    if (remaining > 0) getWordTowerSound().play("tick");
  }, [hurry, remaining]);

  const showResult = state.phase === "result" || state.phase === "ended";
  // 정답 모으기는 모두의 답이 공개 — 탑 블록에도 단어가 보인다.
  const closedMode = closedTopicOf(state.topics[state.roundIndex]) !== null;
  const closedCount = closedTopicOf(state.topics[state.roundIndex])?.answers.length ?? null;
  const leaders = useMemo(() => (showResult ? (state.history[state.history.length - 1]?.winners ?? []) : currentLeaders(state)), [showResult, state]);

  const towers: TowerView[] = useMemo(
    () =>
      Array.from({ length: state.seatCount }, (_, seat) => {
        const isMe = seat === viewerSeat;
        return {
          seat,
          name: isMe ? `${names[seat] ?? "나"} (나)` : (names[seat] ?? `${seat + 1}번`),
          color: SEAT_COLORS[seat % SEAT_COLORS.length],
          isMe,
          height: towerHeight(state.entries, seat, !showResult),
          streak: state.streak[seat] ?? 0,
          crowned: leaders.includes(seat),
          slabs: state.entries
            .filter((e) => e.seat === seat && e.status !== "late")
            .map((e) => ({
              id: e.id,
              blocks: e.blocks,
              status: e.status,
              label: isMe || showResult || e.bonus || closedMode || (state.phase === "review" && e.status === "pending") ? e.word : null,
              bonus: e.bonus === true,
            })),
        };
      }),
    [state.seatCount, state.entries, state.streak, state.phase, viewerSeat, names, showResult, leaders, closedMode],
  );

  const scoreboard = [...towers].sort((a, b) => b.height - a.height);

  function toggleView() {
    const next: View = view === "3d" ? "2d" : "3d";
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 저장 못 해도 이번 화면엔 적용 */
    }
  }

  const phaseLabel: Record<GameState["phase"], string> = {
    intro: "📣 주제 공개",
    build: "🏗️ 쌓는 중",
    review: "🗳️ 심사 중",
    result: "🏆 라운드 결과",
    ended: "🏙️ 게임 끝",
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          라운드 {state.roundIndex + 1}/{state.topics.length}
        </span>
        <span className="text-lg font-black text-white light:text-slate-900">
          {topic.emoji} {topic.name}
          {closedCount !== null && <span className="ml-1.5 align-middle text-sm font-bold text-amber-300 light:text-amber-700">정답 {closedCount}개</span>}
        </span>
        <span className="text-xs text-white/50 light:text-slate-500">{phaseLabel[state.phase]}</span>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/60 light:border-slate-300 light:text-slate-500">
          {MODE_INFO[state.options.mode].emoji} {MODE_INFO[state.options.mode].name}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getWordTowerSound} icon="🏗️" label="Sky Builders" preview="approve" />
          {canWebgl && (
            <button onClick={toggleView} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600" title="3D/2D 화면 전환">
              {view === "3d" ? "🖼️ 2D" : "🧊 3D"}
            </button>
          )}
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {remaining !== null && state.phase !== "ended" && (
        <div className="h-2 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${hurry ? "bg-rose-500" : "bg-sky-400"}`}
            style={{ width: `${remainingMs === null ? 0 : Math.min(100, (remainingMs / Math.max(1, phaseDurationMs(state))) * 100)}%` }}
          />
        </div>
      )}

      {/* 무대 */}
      <div className="relative h-[44vh] max-h-[560px] min-h-[260px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {view === "3d" && canWebgl ? <Tower3D towers={towers} /> : <Towers2D towers={towers} />}
        {state.phase === "intro" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-slate-950/55 backdrop-blur-[2px]">
            <span className="text-xs font-bold tracking-widest text-sky-200/80">ROUND {state.roundIndex + 1}</span>
            <span className="animate-[pulse_1s_ease-in-out_infinite] text-7xl">{topic.emoji}</span>
            <span className="mt-1 text-4xl font-black text-white drop-shadow">{topic.name}</span>
            {closedCount !== null && <span className="mt-2 rounded-full bg-amber-400 px-4 py-1 text-lg font-black text-slate-900">🎯 정답 {closedCount}개</span>}
            <span className="mt-2 text-sm text-white/70">곧 시작해요{remaining !== null ? ` · ${remaining}` : ""}</span>
          </div>
        )}
        {remaining !== null && (state.phase === "build" || state.phase === "review") && (
          <span className={`absolute top-2 right-3 rounded-full px-3 py-1 text-xl font-black tabular-nums ${hurry ? "animate-pulse bg-rose-600 text-white" : "bg-slate-950/60 text-white"}`}>{remaining}</span>
        )}
      </div>

      {/* 단계별 패널 */}
      {state.phase === "build" && (
        <div className={`${PANEL} flex flex-col gap-2`}>
          <WordInput key={state.roundIndex} state={state} viewerSeat={viewerSeat} onAction={onAction} />
          <AnswerSlots state={state} viewerSeat={viewerSeat} names={names} />
          {!closedMode && (
            <div className="flex flex-wrap gap-1">
              {state.entries
                .filter((e) => e.seat === viewerSeat)
                .slice()
                .reverse()
                .map((e) => (
                  <WordChip key={e.id} e={e} mine />
                ))}
            </div>
          )}
        </div>
      )}
      {state.phase === "build" && <LiveFeed state={state} viewerSeat={viewerSeat} names={names} />}
      {state.phase === "intro" && <div className={`${PANEL} text-center text-sm text-white/70 light:text-slate-600`}>{closedMode ? "정답은 선착순! 먼저 낸 사람이 차지하고, 모두의 답이 실시간으로 보여요." : "주제를 보고 떠오르는 단어를 준비하세요! 남의 단어는 라운드 결과 때 공개돼요."}</div>}
      {state.phase === "review" && <ReviewPanel state={state} viewerSeat={viewerSeat} names={names} voterSeats={voterSeats} onAction={onAction} />}
      {state.phase === "result" && <ResultPanel state={state} viewerSeat={viewerSeat} names={names} isHost={isHost} onAction={onAction} />}
      {state.phase === "ended" && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} onGameEnd={onGameEnd} />}

      {/* 점수판 */}
      {state.phase !== "ended" && (
        <div className={`${PANEL} grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4`}>
          {scoreboard.map((t) => (
            <div key={t.seat} className="flex min-w-0 items-center gap-1.5 text-xs">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${connectedSeats.has(t.seat) ? "" : "opacity-30"}`} style={{ background: t.color }} />
              <span className={`min-w-0 flex-1 truncate ${t.isMe ? "font-black text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>
                {t.crowned && "👑"}
                {t.name}
              </span>
              <span className="font-bold text-sky-200 tabular-nums light:text-sky-700">{t.height}</span>
              <span className="text-amber-200/80 light:text-amber-700">🏆{state.wins[t.seat]}</span>
            </div>
          ))}
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}
