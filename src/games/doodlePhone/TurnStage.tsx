"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isBlankDrawing, type Drawing } from "./drawing";
import { getDoodlePhoneSound } from "./doodlePhoneSound";
import DoodleCanvas, { type DoodleCanvasHandle } from "./DoodleCanvas";
import DrawingView from "./DrawingView";
import {
  TEXT_MAX_CHARS,
  TEXT_MIN_CHARS,
  albumFor,
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
  type Page,
  type SeatIndex,
} from "./engine";
import { KNOCK_OFF_PEEK_MS, MODES, drawingReferenceFor, icebreakerQuestion, inspirationWord, openingChoices, themeApplies, type DrawingReference } from "./modes";
import { THEME_INFO } from "./themes";
import { FALLBACK_PROMPTS } from "./prompts";
import { useNow } from "./useNow";

/** Chrome/Safari/Firefox mask a normal text input with this — unlike type="password", Korean IME still works. */
const MASKED_INPUT_STYLE = { WebkitTextSecurity: "disc" } as CSSProperties;

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
  const durationMs = turnDurationMs(state, turn);
  const remainingMs = useRemainingMs(turnStartedAt + durationMs);
  const mine = slotFor(state, viewerSeat, turn);

  return (
    <div className="flex flex-col gap-4">
      <TurnHeader title={turnTitle(state, viewerSeat, turn)} state={state} turn={turn} remainingMs={remainingMs} durationMs={durationMs} />
      {hasSubmitted(state, viewerSeat, turn) ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-6 text-center light:border-emerald-200 light:bg-emerald-50">
          <span className="text-3xl">{mine?.auto ? "⏰" : "✅"}</span>
          <p className="font-semibold text-white light:text-slate-900">{mine?.auto ? "시간이 다 돼 자동으로 채워졌어요" : "제출 완료!"}</p>
          <p className="text-sm text-white/60 light:text-slate-500">다른 플레이어를 기다리는 중이에요…</p>
        </div>
      ) : (
        <TurnComposer key={`${state.seed}:${turn}`} state={state} turn={turn} seat={viewerSeat} turnStartedAt={turnStartedAt} deadline={turnStartedAt + durationMs} onAction={onAction} />
      )}
      <SubmissionRoster state={state} turn={turn} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} />
    </div>
  );
}

function useRemainingMs(deadline: number): number {
  return Math.max(0, deadline - useNow());
}

/** How the current drawing turn presents the previous page, or null on a text turn / while it's still in flight. */
function referenceFor(state: DoodlePhoneState, seat: SeatIndex, turn: number): DrawingReference | null {
  if (turnKind(state, turn) !== "drawing") return null;
  const prompt = promptFor(state, seat, turn);
  if (prompt === undefined) return null;
  return drawingReferenceFor(state.options.mode, prompt?.kind ?? null);
}

const DRAWING_TITLES: Record<DrawingReference, string> = {
  prompt: "🎨 그림 그리기",
  copy: "🖼️ 똑같이 따라 그리기",
  memory: "👥 기억해서 따라 그리기",
  onion: "🎞️ 다음 프레임 그리기",
  base: "🖍️ 이어서 덧그리기",
  free: "🎨 자유롭게 그리기",
};

function turnTitle(state: DoodlePhoneState, seat: SeatIndex, turn: number): string {
  if (turnKind(state, turn) === "text") {
    if (turn > 1) return "🤔 무슨 그림일까요?";
    return state.options.mode === "ICEBREAKER" ? "🧊 질문에 답하기" : "✍️ 제시어 쓰기";
  }
  const reference = referenceFor(state, seat, turn) ?? "prompt";
  if (reference === "free" && state.options.mode === "ANIMATION") return "🎞️ 첫 프레임 그리기";
  if (reference === "free" && state.options.mode === "COMPLEMENT") return "🖍️ 밑그림 그리기";
  return DRAWING_TITLES[reference];
}

function TurnHeader({ title, state, turn, remainingMs, durationMs }: { title: string; state: DoodlePhoneState; turn: number; remainingMs: number; durationMs: number }) {
  const mode = MODES[state.options.mode];
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = seconds <= 10;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-lg font-extrabold text-white light:text-slate-900">{title}</h2>
          <span className="text-xs text-white/50 light:text-slate-500">
            턴 {turn} / {state.playerCount}
          </span>
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-100 light:bg-violet-100 light:text-violet-700">
            {mode.icon} {mode.title}
          </span>
          {themeApplies(state.options) && (
            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-100 light:bg-amber-100 light:text-amber-800">
              {THEME_INFO[state.options.theme].icon} {THEME_INFO[state.options.theme].name}
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 font-mono text-sm font-bold tabular-nums ${
            urgent ? "animate-pulse bg-rose-500/25 text-rose-200 light:bg-rose-100 light:text-rose-700" : "bg-white/10 text-white light:bg-slate-100 light:text-slate-800"
          }`}
        >
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
  turnStartedAt,
  deadline,
  onAction,
}: {
  state: DoodlePhoneState;
  turn: number;
  seat: SeatIndex;
  turnStartedAt: number;
  deadline: number;
  onAction: (action: EngineAction) => void;
}) {
  const kind = turnKind(state, turn);
  const prompt = promptFor(state, seat, turn);
  const reference = referenceFor(state, seat, turn);
  const { mode, ghostFrames, allowUndo } = state.options;
  const blind = MODES[mode].blind;
  const previousDrawing = prompt?.kind === "drawing" ? prompt.drawing : null;

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
  const placeholder = blind ? "글자가 가려진 채로 입력돼요…" : turn === 1 ? `예: ${FALLBACK_PROMPTS[(state.seed + seat) % FALLBACK_PROMPTS.length]}` : "이 그림은…";

  return (
    <div className="flex flex-col gap-3">
      <PromptPanel state={state} seat={seat} turn={turn} prompt={prompt} reference={reference} turnStartedAt={turnStartedAt} />

      {kind === "text" && turn === 1 && (
        <ThemeChoiceChips
          choices={openingChoices(state.options, state.seed, albumFor(state.playerCount, seat, turn))}
          themeName={THEME_INFO[state.options.theme].name}
          selected={draft}
          disabled={sent}
          onPick={(choice) => {
            draftRef.current = choice;
            setDraft(choice);
          }}
        />
      )}

      {kind === "text" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              autoFocus
              value={draft}
              disabled={sent}
              autoComplete="off"
              style={blind ? MASKED_INPUT_STYLE : undefined}
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
              placeholder={placeholder}
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
            {blind && "🙈 비밀 모드 · "}
            {length}/{TEXT_MAX_CHARS}자 · 최소 {TEXT_MIN_CHARS}자 · Enter로 제출
          </p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          <DoodleCanvas
            ref={canvasRef}
            disabled={sent}
            blind={blind}
            allowUndo={allowUndo}
            baseDrawing={reference === "base" ? previousDrawing : null}
            startDrawing={reference === "onion" ? previousDrawing : null}
            onionDrawing={reference === "onion" && ghostFrames ? previousDrawing : null}
            matchKey={state.seed}
          />
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

const hintBox = "rounded-2xl border px-4 py-3 text-sm";
const fuchsiaHint = `${hintBox} border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-100 light:border-fuchsia-200 light:bg-fuchsia-50 light:text-fuchsia-800`;

function PromptPanel({
  state,
  seat,
  turn,
  prompt,
  reference,
  turnStartedAt,
}: {
  state: DoodlePhoneState;
  seat: SeatIndex;
  turn: number;
  prompt: Page | null | undefined;
  reference: DrawingReference | null;
  turnStartedAt: number;
}) {
  const album = albumFor(state.playerCount, seat, turn);

  if (turn === 1 && turnKind(state, 1) === "text") {
    if (state.options.mode === "ICEBREAKER") {
      return (
        <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-4 text-center light:border-cyan-200 light:bg-cyan-50">
          <p className="text-xs text-cyan-100/80 light:text-cyan-700">💡 질문</p>
          <p className="mt-1 text-xl font-extrabold break-keep text-white light:text-slate-900">{icebreakerQuestion(state.seed, album)}</p>
          <p className="mt-1 text-xs text-white/60 light:text-slate-500">내 대답이 곧 이 앨범의 제시어가 돼요.</p>
        </div>
      );
    }
    return <p className={fuchsiaHint}>엉뚱하고 재미있는 문장을 적어주세요. 이 문장이 옆 사람에게 넘어가 그림이 되고, 그 그림이 다시 문장이 됩니다!</p>;
  }

  if (reference === "free") {
    const ideas = openingChoices(state.options, state.seed, album);
    return (
      <p className={fuchsiaHint}>
        첫 장은 자유롭게 그려요. 아이디어가 필요하면 —{" "}
        {ideas.length > 0 ? (
          <>
            {THEME_INFO[state.options.theme].icon} {ideas.map((idea) => `“${idea}”`).join(" · ")}
          </>
        ) : (
          <b>“{inspirationWord(state.seed, album)}”</b>
        )}
        {state.options.mode === "ANIMATION" && " (다음 사람들이 이 그림을 한 프레임씩 움직여요)"}
        {state.options.mode === "COMPLEMENT" && " (다음 사람들이 이 그림 위에 계속 덧그려요)"}
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

  switch (reference) {
    case "memory":
      return <MemoryPeek drawing={prompt.drawing} revealUntil={turnStartedAt + KNOCK_OFF_PEEK_MS} />;
    case "onion":
      return state.options.ghostFrames ? (
        <p className={fuchsiaHint}>🎞️ 앞 프레임이 도화지에 그대로 복사돼 있어요(흐린 잔상은 원래 위치). 👆 선택·이동이나 지우개로 살짝 움직여 다음 장면을 만들어주세요!</p>
      ) : (
        <ReferenceDrawing caption="앞 프레임이 도화지에 복사돼 있어요 — 살짝 움직여 다음 장면을 만들어주세요" drawing={prompt.drawing} />
      );
    case "base":
      return <p className={fuchsiaHint}>🖍️ 앞사람 그림 위에 그대로 이어 그려요. 지우개로 고칠 수도 있지만 원래 그림은 되돌리기로 지워지지 않아요.</p>;
    case "copy":
      return <ReferenceDrawing caption="이 그림을 최대한 똑같이 따라 그려주세요" drawing={prompt.drawing} />;
    default:
      return <ReferenceDrawing caption="앞사람이 그린 그림이에요. 무엇을 그렸을까요?" drawing={prompt.drawing} />;
  }
}

/**
 * Theme packs (themes.ts): turn-1 keyword suggestions. One click fills the
 * input; the text stays editable, and typing something else is fine too.
 */
function ThemeChoiceChips({
  choices,
  themeName,
  selected,
  disabled,
  onPick,
}: {
  choices: readonly string[];
  themeName: string;
  selected: string;
  disabled: boolean;
  onPick: (choice: string) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 light:border-amber-200 light:bg-amber-50">
      <span className="text-xs font-bold text-amber-100 light:text-amber-800">🎲 추천 {themeName} 키워드 — 눌러서 고르거나 직접 써도 돼요</span>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const active = selected === choice;
          return (
            <button
              key={choice}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onPick(choice)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-amber-300 font-bold text-slate-900"
                  : "bg-white/10 text-white/85 hover:bg-white/20 light:bg-white light:text-slate-700 light:ring-1 light:ring-amber-200"
              }`}
            >
              {choice}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReferenceDrawing({ caption, drawing }: { caption: string; drawing: Drawing }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
      <p className="text-center text-xs text-white/60 light:text-slate-500">{caption}</p>
      <DrawingView drawing={drawing} label="참고 그림" />
    </div>
  );
}

/** Knock-off: the original is visible for KNOCK_OFF_PEEK_MS from the moment this device saw the turn open. */
function MemoryPeek({ drawing, revealUntil }: { drawing: Drawing; revealUntil: number }) {
  const secondsLeft = Math.ceil((revealUntil - useNow()) / 1000);
  if (secondsLeft <= 0) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60 light:border-slate-200 light:bg-slate-100 light:text-slate-500">
        🔒 원본이 가려졌어요! 기억나는 대로 그려주세요.
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-2">
      <p className="text-center text-xs font-semibold text-rose-200 light:text-rose-600">👀 원본을 기억하세요 — {secondsLeft}초 후 가려져요</p>
      <DrawingView drawing={drawing} label="기억할 원본" />
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
