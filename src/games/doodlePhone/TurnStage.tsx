"use client";

import { useEffect, useRef, useState } from "react";
import { isBlankDrawing } from "./drawing";
import { getDoodlePhoneSound } from "./doodlePhoneSound";
import DoodleCanvas, { type DoodleCanvasHandle } from "./DoodleCanvas";
import DrawingView from "./DrawingView";
import {
  TEXT_MAX_CHARS,
  TEXT_MIN_CHARS,
  currentTurn,
  hasSubmitted,
  isValidText,
  promptFor,
  slotFor,
  textLength,
  turnDurationMs,
  turnKind,
  type DoodlePhoneState,
  type EngineAction,
  type SeatIndex,
} from "./engine";
import { FALLBACK_PROMPTS } from "./prompts";

/** The simultaneous write/draw/guess phase (rulebook §2 TURN_INPUT). */
export default function TurnStage({
  state,
  viewerSeat,
  names,
  connectedSeats,
  turnStartedAt,
  onAction,
}: {
  state: DoodlePhoneState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: ReadonlySet<SeatIndex>;
  turnStartedAt: number;
  onAction: (action: EngineAction) => void;
}) {
  const turn = currentTurn(state);
  const durationMs = turnDurationMs(state.pace, turn);
  const deadline = turnStartedAt + durationMs;
  const remainingMs = useRemainingMs(deadline);
  const mine = slotFor(state, viewerSeat, turn);

  return (
    <div className="flex flex-col gap-4">
      <TurnHeader turn={turn} totalTurns={state.playerCount} remainingMs={remainingMs} durationMs={durationMs} />
      {hasSubmitted(state, viewerSeat, turn) ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-6 text-center light:border-emerald-200 light:bg-emerald-50">
          <span className="text-3xl">{mine?.auto ? "⏰" : "✅"}</span>
          <p className="font-semibold text-white light:text-slate-900">
            {mine?.auto ? "시간이 다 돼 자동으로 채워졌어요" : "제출 완료!"}
          </p>
          <p className="text-sm text-white/60 light:text-slate-500">다른 플레이어를 기다리는 중이에요…</p>
        </div>
      ) : (
        <TurnComposer key={`${state.seed}:${turn}`} state={state} turn={turn} seat={viewerSeat} deadline={deadline} onAction={onAction} />
      )}
      <SubmissionRoster state={state} turn={turn} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} />
    </div>
  );
}

function useRemainingMs(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, deadline - now);
}

function TurnHeader({ turn, totalTurns, remainingMs, durationMs }: { turn: number; totalTurns: number; remainingMs: number; durationMs: number }) {
  const kind = turnKind(turn);
  const title = turn === 1 ? "✍️ 제시어 쓰기" : kind === "drawing" ? "🎨 그림 그리기" : "🤔 무슨 그림일까요?";
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = seconds <= 10;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-extrabold text-white light:text-slate-900">{title}</h2>
          <span className="text-xs text-white/50 light:text-slate-500">
            턴 {turn} / {totalTurns}
          </span>
        </div>
        <span className={`rounded-full px-3 py-1 font-mono text-sm font-bold tabular-nums ${urgent ? "animate-pulse bg-rose-500/25 text-rose-200 light:bg-rose-100 light:text-rose-700" : "bg-white/10 text-white light:bg-slate-100 light:text-slate-800"}`}>
          ⏱ {seconds}s
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-linear ${urgent ? "bg-rose-400" : "bg-gradient-to-r from-fuchsia-400 to-violet-400"}`}
          style={{ width: `${(remainingMs / durationMs) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The input for one turn. Keyed by turn in the parent, so the draft and the
 * canvas reset on their own when the turn advances. At 0s it submits
 * whatever is there (rulebook §5) — text only if it is valid, otherwise the
 * host's timeout fills the slot with a fallback prompt.
 */
function TurnComposer({
  state,
  turn,
  seat,
  deadline,
  onAction,
}: {
  state: DoodlePhoneState;
  turn: number;
  seat: SeatIndex;
  deadline: number;
  onAction: (action: EngineAction) => void;
}) {
  const kind = turnKind(turn);
  const prompt = promptFor(state, seat, turn);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const [confirmBlank, setConfirmBlank] = useState(false);
  const canvasRef = useRef<DoodleCanvasHandle | null>(null);
  const draftRef = useRef("");
  const sentRef = useRef(false);

  function submit(auto: boolean) {
    if (sentRef.current) return;
    if (!auto) getDoodlePhoneSound().unlock();
    if (kind === "text") {
      if (!isValidText(draftRef.current)) return;
      onAction({ type: "SUBMIT_TEXT", seat, turn, text: draftRef.current });
    } else {
      const drawing = canvasRef.current?.getDrawing();
      if (!drawing) return;
      if (!auto && isBlankDrawing(drawing) && !confirmBlank) {
        setConfirmBlank(true);
        return;
      }
      onAction({ type: "SUBMIT_DRAWING", seat, turn, drawing });
    }
    sentRef.current = true;
    setSent(true);
    getDoodlePhoneSound().submitPop();
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() < deadline) return;
      window.clearInterval(id);
      submitRef.current(true);
    }, 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  const length = textLength(draft.trim());
  const placeholder = `예: ${FALLBACK_PROMPTS[(state.seed + seat) % FALLBACK_PROMPTS.length]}`;

  return (
    <div className="flex flex-col gap-3">
      <PromptPanel turn={turn} prompt={prompt} />

      {kind === "text" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              autoFocus
              value={draft}
              disabled={sent}
              onChange={(e) => {
                const next = Array.from(e.target.value).slice(0, TEXT_MAX_CHARS).join("");
                draftRef.current = next;
                setDraft(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit(false);
                }
              }}
              placeholder={turn === 1 ? placeholder : "이 그림은…"}
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-fuchsia-400 focus:outline-none disabled:opacity-60 light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={sent || length < TEXT_MIN_CHARS}
              className="shrink-0 rounded-xl bg-fuchsia-600 px-5 text-sm font-bold text-white transition hover:bg-fuchsia-500 disabled:bg-white/10 disabled:text-white/40 light:disabled:bg-slate-200 light:disabled:text-slate-400"
            >
              {sent ? "전송 중…" : "제출"}
            </button>
          </div>
          <p className="text-right text-[11px] text-white/40 light:text-slate-400">
            {length}/{TEXT_MAX_CHARS}자 · 최소 {TEXT_MIN_CHARS}자 · Enter로 제출
          </p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          <DoodleCanvas ref={canvasRef} disabled={sent} />
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={sent}
            className="rounded-xl bg-fuchsia-600 py-3 text-sm font-bold text-white transition hover:bg-fuchsia-500 disabled:bg-white/10 disabled:text-white/40 light:disabled:bg-slate-200"
          >
            {sent ? "전송 중…" : confirmBlank ? "아무것도 안 그렸어요 — 그래도 제출할까요?" : "🎨 완성! 제출하기"}
          </button>
        </div>
      )}
    </div>
  );
}

function PromptPanel({ turn, prompt }: { turn: number; prompt: ReturnType<typeof promptFor> }) {
  if (turn === 1) {
    return (
      <p className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100 light:border-fuchsia-200 light:bg-fuchsia-50 light:text-fuchsia-800">
        엉뚱하고 재미있는 문장을 적어주세요. 이 문장이 옆 사람에게 넘어가 그림이 되고, 그 그림이 다시 문장이 됩니다!
      </p>
    );
  }
  if (prompt === undefined || prompt === null) {
    return <p className="animate-pulse rounded-2xl bg-white/5 px-4 py-6 text-center text-sm text-white/50 light:bg-slate-100 light:text-slate-500">앞사람의 작업을 받는 중…</p>;
  }
  if (prompt.kind === "text") {
    return (
      <div className="rounded-2xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/15 to-violet-500/10 px-4 py-4 text-center light:border-fuchsia-200 light:from-fuchsia-50 light:to-violet-50">
        <p className="text-xs text-white/60 light:text-slate-500">이 문장을 그려주세요</p>
        <p className="mt-1 text-2xl font-extrabold break-keep text-white light:text-slate-900">“{prompt.text}”</p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
      <p className="text-center text-xs text-white/60 light:text-slate-500">앞사람이 그린 그림이에요. 무엇을 그렸을까요?</p>
      <DrawingView drawing={prompt.drawing} label="추측할 그림" />
    </div>
  );
}

function SubmissionRoster({
  state,
  turn,
  viewerSeat,
  names,
  connectedSeats,
}: {
  state: DoodlePhoneState;
  turn: number;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: ReadonlySet<SeatIndex>;
}) {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const done = seats.filter((s) => hasSubmitted(state, s, turn)).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-white/50 light:text-slate-500">
        제출 {done}/{state.playerCount}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {seats.map((seat) => {
          const submitted = hasSubmitted(state, seat, turn);
          return (
            <span
              key={seat}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                submitted
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100 light:border-emerald-300 light:bg-emerald-50 light:text-emerald-800"
                  : "border-white/10 bg-white/5 text-white/60 light:border-slate-200 light:bg-white light:text-slate-500"
              }`}
            >
              {submitted ? "✅" : "✏️"}
              <span className={seat === viewerSeat ? "font-bold" : ""}>{seat === viewerSeat ? `${names[seat]} (나)` : names[seat]}</span>
              {!connectedSeats.has(seat) && <span title="연결 끊김">🔌</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
