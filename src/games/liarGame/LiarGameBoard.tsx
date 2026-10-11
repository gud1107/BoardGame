"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import {
  MAX_CHAT_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_GUESS_LEN,
  computeRankings,
  currentDescriber,
  currentLap,
  currentPlan,
  knownWordFor,
  pendingSeats,
  rejectReason,
  type ChatMessage,
  type EngineAction,
  type GameState,
  type RoundOutcome,
  type Seat,
} from "./engine";
import { getCategory } from "./words";
import RulebookModal from "./RulebookModal";

interface Props {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: ReadonlySet<Seat>;
  /** 지금 단계가 끝나는 시각(이 기기 기준). 알 수 없으면 null. */
  deadlineMs: number | null;
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const PHASE_LABEL: Record<GameState["phase"], string> = {
  describe: "🗣️ 설명",
  discuss: "💬 토론",
  vote: "🗳️ 투표",
  guess: "🔍 정답 맞히기",
  roundEnd: "🎭 공개",
  ended: "🏁 게임 종료",
};

const REASON_TEXT: Record<RoundOutcome["reason"], string> = {
  wrongAccuse: "엉뚱한 사람이 지목됐어요",
  tie: "끝까지 동점 — 아무도 지목되지 않았어요",
  guessed: "라이어가 제시어를 맞혔어요",
  missed: "라이어가 제시어를 못 맞혔어요",
};

const CARD = "rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white light:shadow-sm";
const INPUT =
  "min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-fuchsia-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400";
const PRIMARY = "rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-40";

function onEnter(fn: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      fn();
    }
  };
}

function chatText(m: ChatMessage, names: Record<Seat, string>): string {
  return m.mention !== undefined ? m.text.replace("{m}", names[m.mention] ?? "누군가") : m.text;
}

export default function LiarGameBoard({ state, viewerSeat, names, connectedSeats, deadlineMs, nowMs, onAction, onGameEnd }: Props) {
  const plan = currentPlan(state);
  const category = getCategory(plan.categoryId);
  const known = knownWordFor(state, viewerSeat);
  const isLiarView = known === null; // 일반 모드 라이어만 자기가 라이어인 걸 안다
  const describer = currentDescriber(state);
  const pending = pendingSeats(state);
  const revealed = state.phase === "roundEnd" || state.phase === "ended";
  const outcome = state.outcome;

  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [hideCard, setHideCard] = useState(false);
  const [text, setText] = useState("");
  const [chat, setChat] = useState("");
  const [guess, setGuess] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  // 단계 전환 효과음 — 상태 변경 없이 소리만 낸다.
  const lastStageRef = useRef(state.stage);
  useEffect(() => {
    if (lastStageRef.current === state.stage) return;
    lastStageRef.current = state.stage;
    const sound = getSoundEngine();
    if (state.phase === "roundEnd" && state.outcome) {
      const iWon = state.outcome.points[viewerSeat] > 0;
      if (iWon) sound.playCorrectDing();
      else sound.playWrongBuzz();
    } else if (state.phase === "ended") {
      sound.playFinishFanfare();
    } else if (state.phase === "describe" && currentDescriber(state) === viewerSeat) {
      sound.playUiClickTick();
    } else if (state.phase === "vote" || state.phase === "guess") {
      sound.playCardFlick();
    }
  }, [state, viewerSeat]);

  const chatCount = state.chat.length;
  useEffect(() => {
    const box = chatBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chatCount]);

  const secondsLeft = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));

  function submitDescription() {
    const reason = rejectReason(state, viewerSeat, text, "describe");
    if (reason) {
      setError(reason);
      return;
    }
    onAction({ type: "DESCRIBE", seat: viewerSeat, text: text.trim() });
    setText("");
    setError(null);
  }

  function submitChat() {
    const reason = rejectReason(state, viewerSeat, chat, "chat");
    if (reason) {
      setError(reason);
      return;
    }
    onAction({ type: "CHAT", seat: viewerSeat, text: chat.trim() });
    setChat("");
    setError(null);
  }

  function submitGuess(value: string) {
    if (!value.trim()) return;
    onAction({ type: "GUESS", seat: viewerSeat, text: value.trim() });
    setGuess("");
  }

  const seats = Array.from({ length: state.seatCount }, (_, i) => i);
  const roundChat = state.chat.filter((m) => m.round === state.roundIndex + 1);
  const showChat = state.phase !== "describe";
  const votedCount = state.voters.filter((s) => s in state.votes).length;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 바 */}
      <div className={`${CARD} flex flex-wrap items-center gap-2 px-4 py-3`}>
        <span className="text-xs font-semibold text-white/50 light:text-slate-500">
          라운드 {state.roundIndex + 1}/{state.plan.length}
        </span>
        <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-1 text-xs font-bold text-fuchsia-200 light:bg-fuchsia-100 light:text-fuchsia-800">
          {category?.emoji} {plan.category}
        </span>
        <span className="text-sm font-bold text-white light:text-slate-900">{PHASE_LABEL[state.phase]}</span>
        {state.phase === "describe" && (
          <span className="text-xs text-white/50 light:text-slate-500">
            {currentLap(state)}/{state.options.laps}바퀴
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {secondsLeft !== null && state.phase !== "ended" && (
            <span
              className={`rounded-full px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${
                secondsLeft <= 5 ? "bg-rose-500/20 text-rose-200 light:bg-rose-100 light:text-rose-700" : "bg-white/10 text-white/70 light:bg-slate-100 light:text-slate-600"
              }`}
            >
              ⏱ {secondsLeft}초
            </span>
          )}
          <button
            onClick={() => setRulebookOpen(true)}
            className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600"
          >
            📖 룰북
          </button>
        </span>
      </div>

      {/* 내 카드 */}
      {!revealed && (
        <button
          type="button"
          onClick={() => setHideCard((v) => !v)}
          className={`relative overflow-hidden rounded-2xl border px-4 py-4 text-left transition ${
            isLiarView
              ? "border-rose-400/40 bg-gradient-to-br from-rose-500/20 to-slate-900/40 light:border-rose-300 light:from-rose-50 light:to-white"
              : "border-emerald-400/30 bg-gradient-to-br from-emerald-500/15 to-slate-900/40 light:border-emerald-300 light:from-emerald-50 light:to-white"
          }`}
        >
          <p className="text-[11px] font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">내 카드 · 눌러서 {hideCard ? "보기" : "가리기"}</p>
          {hideCard ? (
            <p className="mt-1 text-lg font-bold text-white/40 light:text-slate-400">🂠 가려짐</p>
          ) : isLiarView ? (
            <div className="mt-1">
              <p className="text-2xl font-black text-rose-200 light:text-rose-700">🎭 당신은 라이어!</p>
              <p className="mt-1 break-keep text-xs text-white/60 light:text-slate-600">
                제시어를 모릅니다. 카테고리 <b>{plan.category}</b>만 알고 있어요. 들키지 말고 제시어를 추리하세요.
              </p>
            </div>
          ) : (
            <div className="mt-1">
              <p className="text-xs text-white/60 light:text-slate-600">제시어</p>
              <p className="text-3xl font-black tracking-tight text-emerald-100 light:text-emerald-800">{known}</p>
              <p className="mt-1 break-keep text-xs text-white/50 light:text-slate-500">
                제시어를 직접 말하지 말고, 라이어에게 들키지 않게 설명하세요.
                {state.options.mode === "fool" && " (바보 모드 — 누군가는 다른 제시어를 받았어요!)"}
              </p>
            </div>
          )}
        </button>
      )}

      {/* 좌석 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {seats.map((seat) => {
          const mine = state.descriptions.filter((d) => d.seat === seat);
          const isTurn = describer === seat;
          const isMe = seat === viewerSeat;
          const isLiar = revealed && outcome?.liarSeat === seat;
          const accused = revealed && outcome?.accused === seat;
          const votesFor = revealed && outcome ? (outcome.tally[seat] ?? 0) : null;
          return (
            <div
              key={seat}
              className={`flex flex-col gap-1.5 rounded-xl border p-2.5 transition ${
                isTurn
                  ? "border-fuchsia-400/70 bg-fuchsia-500/10 shadow-[0_0_0_2px_rgba(232,121,249,0.25)] light:bg-fuchsia-50"
                  : isLiar
                    ? "border-rose-400/60 bg-rose-500/10 light:bg-rose-50"
                    : "border-white/10 bg-white/[0.02] light:border-slate-200 light:bg-white"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20 light:bg-slate-300"}`} />
                <span className="truncate text-sm font-semibold text-white light:text-slate-900">
                  {names[seat] ?? `${seat + 1}번`}
                  {isMe && <span className="ml-1 text-[10px] text-fuchsia-300 light:text-fuchsia-600">(나)</span>}
                </span>
                <span className="ml-auto shrink-0 rounded-md bg-white/10 px-1.5 text-xs font-bold tabular-nums text-amber-200 light:bg-amber-50 light:text-amber-700">
                  {state.scores[seat]}점
                </span>
              </div>
              <div className="flex flex-wrap gap-1 text-[10px]">
                {seat === plan.firstSeat && !revealed && <span className="rounded bg-white/10 px-1 text-white/60 light:bg-slate-100 light:text-slate-500">선</span>}
                {isTurn && <span className="rounded bg-fuchsia-500/30 px-1 text-fuchsia-100 light:text-fuchsia-800">🗣 설명 중</span>}
                {state.phase === "discuss" && state.readySeats.includes(seat) && <span className="rounded bg-emerald-500/20 px-1 text-emerald-200 light:text-emerald-700">✅ 준비</span>}
                {state.phase === "vote" && seat in state.votes && <span className="rounded bg-sky-500/20 px-1 text-sky-200 light:text-sky-700">🗳 투표 완료</span>}
                {state.phase === "vote" && state.voteRound === 2 && state.candidates.includes(seat) && (
                  <span className="rounded bg-amber-500/20 px-1 text-amber-200 light:text-amber-700">⚖️ 동점</span>
                )}
                {isLiar && <span className="rounded bg-rose-500/30 px-1 font-bold text-rose-100 light:text-rose-700">🎭 라이어</span>}
                {accused && <span className="rounded bg-amber-500/25 px-1 text-amber-100 light:text-amber-700">👉 지목됨</span>}
                {votesFor !== null && votesFor > 0 && <span className="rounded bg-white/10 px-1 text-white/70 light:bg-slate-100 light:text-slate-600">{votesFor}표</span>}
              </div>
              {mine.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {mine.map((d, i) => (
                    <li
                      key={i}
                      className={`break-keep rounded-lg px-2 py-1 text-xs leading-snug ${
                        d.auto ? "bg-white/5 text-white/35 italic light:bg-slate-50 light:text-slate-400" : "bg-white/10 text-white/90 light:bg-slate-100 light:text-slate-800"
                      }`}
                    >
                      {state.options.laps > 1 && <span className="mr-1 text-[9px] text-white/40 light:text-slate-400">{d.lap}</span>}
                      {d.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-white/25 light:text-slate-400">아직 설명 없음</p>
              )}
            </div>
          );
        })}
      </div>

      {/* 단계별 행동 */}
      <div className={`${CARD} flex flex-col gap-3 p-4`}>
        {state.phase === "describe" &&
          (describer === viewerSeat ? (
            <>
              <p className="break-keep text-sm font-semibold text-fuchsia-200 light:text-fuchsia-700">
                내 차례예요! {isLiarView ? "아는 척 그럴듯하게 한 마디." : "제시어를 한 마디로 설명하세요."}
              </p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={text}
                  maxLength={MAX_DESCRIPTION_LEN}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={onEnter(submitDescription)}
                  placeholder="예: 겨울에 생각나요"
                  className={INPUT}
                />
                <button onClick={submitDescription} disabled={!text.trim()} className={PRIMARY}>
                  말하기
                </button>
              </div>
            </>
          ) : (
            <p className="break-keep text-sm text-white/60 light:text-slate-600">
              <b className="text-white light:text-slate-900">{describer !== null ? names[describer] : ""}</b>님이 설명하는 중… 잘 듣고 라이어를 찾아보세요.
            </p>
          ))}

        {state.phase === "discuss" && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-keep text-sm text-white/70 light:text-slate-600">
              자유 토론! 수상한 사람을 채팅으로 추궁해 보세요. 준비 {state.readySeats.length}/{state.seatCount}
            </p>
            <button
              onClick={() => onAction({ type: "READY", seat: viewerSeat })}
              disabled={state.readySeats.includes(viewerSeat)}
              className={`${PRIMARY} ml-auto`}
            >
              {state.readySeats.includes(viewerSeat) ? "✅ 준비 완료" : "🗳️ 투표하러 가기"}
            </button>
          </div>
        )}

        {state.phase === "vote" && (
          <>
            <p className="break-keep text-sm text-white/70 light:text-slate-600">
              {state.voteRound === 2 ? "⚖️ 동점! 동점자 중 한 명을 다시 골라주세요." : "라이어라고 생각하는 사람을 지목하세요."}{" "}
              <span className="text-white/40 light:text-slate-400">
                ({votedCount}/{state.voters.length} 투표)
              </span>
            </p>
            {state.voters.includes(viewerSeat) ? (
              viewerSeat in state.votes ? (
                <p className="text-sm text-sky-200 light:text-sky-700">🗳 {names[state.votes[viewerSeat] ?? -1] ?? "-"}님에게 투표했어요. 다른 사람을 기다리는 중…</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {state.candidates
                    .filter((c) => c !== viewerSeat)
                    .map((c) => (
                      <button
                        key={c}
                        onClick={() => onAction({ type: "VOTE", seat: viewerSeat, target: c })}
                        className="truncate rounded-xl border border-white/15 px-3 py-2.5 text-sm font-semibold text-white transition hover:border-fuchsia-400 hover:bg-fuchsia-500/10 light:border-slate-300 light:text-slate-800"
                      >
                        👉 {names[c]}
                      </button>
                    ))}
                </div>
              )
            ) : (
              <p className="text-sm text-amber-200 light:text-amber-700">동점자는 재투표에 참여하지 않아요. 결과를 기다려 주세요.</p>
            )}
          </>
        )}

        {state.phase === "guess" &&
          (pending.includes(viewerSeat) ? (
            <>
              <p className="break-keep text-sm font-semibold text-rose-200 light:text-rose-700">들켰어요! 마지막 기회 — 제시어를 맞히면 역전승이에요. (기회 1번)</p>
              {state.options.guessMode === "choice" ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {plan.options.map((o) => (
                    <button
                      key={o}
                      onClick={() => submitGuess(o)}
                      className="rounded-xl border border-white/15 px-3 py-2.5 text-sm font-bold text-white transition hover:border-rose-400 hover:bg-rose-500/10 light:border-slate-300 light:text-slate-800"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input autoFocus value={guess} maxLength={MAX_GUESS_LEN} onChange={(e) => setGuess(e.target.value)} onKeyDown={onEnter(() => submitGuess(guess))} placeholder="제시어는…?" className={INPUT} />
                  <button onClick={() => submitGuess(guess)} disabled={!guess.trim()} className={PRIMARY}>
                    맞히기
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="break-keep text-sm text-white/70 light:text-slate-600">
              🎭 <b className="text-rose-200 light:text-rose-700">{names[plan.liarSeat]}</b>님이 라이어였어요! 제시어를 맞히는 중…
            </p>
          ))}

        {state.phase === "roundEnd" && outcome && (
          <div className="flex flex-col gap-3">
            <div className={`rounded-xl p-3 text-center ${outcome.winner === "liar" ? "bg-rose-500/15 light:bg-rose-50" : "bg-emerald-500/15 light:bg-emerald-50"}`}>
              <p className="text-2xl font-black text-white light:text-slate-900">{outcome.winner === "liar" ? "🎭 라이어 승리!" : "🕵️ 시민 승리!"}</p>
              <p className="mt-1 text-xs text-white/60 light:text-slate-600">{REASON_TEXT[outcome.reason]}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-sm">
              <div className="rounded-xl bg-white/5 p-2 light:bg-slate-50">
                <p className="text-[11px] text-white/50 light:text-slate-500">라이어</p>
                <p className="font-bold text-rose-200 light:text-rose-700">{names[outcome.liarSeat]}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-2 light:bg-slate-50">
                <p className="text-[11px] text-white/50 light:text-slate-500">제시어</p>
                <p className="font-bold text-emerald-200 light:text-emerald-700">{outcome.word}</p>
              </div>
              {outcome.fakeWord && (
                <div className="col-span-2 rounded-xl bg-white/5 p-2 light:bg-slate-50">
                  <p className="text-[11px] text-white/50 light:text-slate-500">🤪 라이어가 받은 가짜 제시어</p>
                  <p className="font-bold text-amber-200 light:text-amber-700">{outcome.fakeWord}</p>
                </div>
              )}
              {outcome.reason === "guessed" || outcome.reason === "missed" ? (
                <div className="col-span-2 rounded-xl bg-white/5 p-2 light:bg-slate-50">
                  <p className="text-[11px] text-white/50 light:text-slate-500">라이어의 답</p>
                  <p className="font-bold text-white light:text-slate-800">{outcome.guess ?? "(시간 초과)"}</p>
                </div>
              ) : null}
            </div>
            <p className="text-center text-xs text-white/50 light:text-slate-500">
              이번 라운드 점수:{" "}
              {seats
                .filter((s) => outcome.points[s] > 0)
                .map((s) => `${names[s]} +${outcome.points[s]}`)
                .join(" · ") || "없음"}
            </p>
            <button onClick={() => onAction({ type: "NEXT", stage: state.stage })} className={`${PRIMARY} self-center`}>
              {state.roundIndex + 1 >= state.plan.length ? "🏁 최종 결과 보기" : "▶ 다음 라운드"}
            </button>
          </div>
        )}

        {state.phase === "ended" && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-2xl font-black text-white light:text-slate-900">🏆 최종 결과</p>
            <ol className="flex flex-col gap-1.5">
              {computeRankings(state).map((r) => (
                <li key={r.seat} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 light:bg-slate-50">
                  <span className="w-8 text-center text-lg">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
                  <span className="flex-1 truncate font-semibold text-white light:text-slate-900">{names[r.seat]}</span>
                  <span className="font-bold tabular-nums text-amber-200 light:text-amber-700">{r.score}점</span>
                </li>
              ))}
            </ol>
            <HistoryTable history={state.history} names={names} />
            <button onClick={onGameEnd} className={`${PRIMARY} self-center`}>
              결과 확정하고 계속하기
            </button>
          </div>
        )}

        {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">⚠️ {error}</p>}
      </div>

      {/* 채팅 */}
      {showChat && (
        <div className={`${CARD} flex flex-col gap-2 p-3`}>
          <p className="text-xs font-semibold text-white/50 light:text-slate-500">💬 채팅</p>
          <div ref={chatBoxRef} className="flex max-h-48 min-h-16 flex-col gap-1 overflow-y-auto">
            {roundChat.length === 0 ? (
              <p className="text-xs text-white/30 light:text-slate-400">아직 아무도 말하지 않았어요.</p>
            ) : (
              roundChat.map((m, i) => (
                <p key={i} className="break-keep text-sm text-white/85 light:text-slate-700">
                  <b className={m.seat === viewerSeat ? "text-fuchsia-300 light:text-fuchsia-700" : "text-white light:text-slate-900"}>{names[m.seat]}</b>{" "}
                  {chatText(m, names)}
                </p>
              ))
            )}
          </div>
          {state.phase !== "ended" && (
            <div className="flex gap-2">
              <input
                value={chat}
                maxLength={MAX_CHAT_LEN}
                onChange={(e) => {
                  setChat(e.target.value);
                  setError(null);
                }}
                onKeyDown={onEnter(submitChat)}
                placeholder="의심 가는 사람을 추궁해 보세요"
                className={INPUT}
              />
              <button onClick={submitChat} disabled={!chat.trim()} className="rounded-xl border border-white/15 px-3 py-2 text-sm text-white/80 hover:border-white/30 disabled:opacity-40 light:border-slate-300 light:text-slate-700">
                보내기
              </button>
            </div>
          )}
        </div>
      )}

      {state.history.length > 0 && state.phase !== "ended" && (
        <details className={`${CARD} px-4 py-3`}>
          <summary className="cursor-pointer text-xs font-semibold text-white/60 light:text-slate-500">📜 지난 라운드 기록 ({state.history.length})</summary>
          <div className="mt-2">
            <HistoryTable history={state.history} names={names} />
          </div>
        </details>
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

function HistoryTable({ history, names }: { history: readonly RoundOutcome[]; names: Record<Seat, string> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-white/40 light:text-slate-400">
          <tr>
            <th className="py-1 pr-2 font-medium">R</th>
            <th className="py-1 pr-2 font-medium">제시어</th>
            <th className="py-1 pr-2 font-medium">라이어</th>
            <th className="py-1 font-medium">결과</th>
          </tr>
        </thead>
        <tbody className="text-white/80 light:text-slate-700">
          {history.map((h) => (
            <tr key={h.round} className="border-t border-white/5 light:border-slate-100">
              <td className="py-1 pr-2 tabular-nums">{h.round}</td>
              <td className="py-1 pr-2">
                {h.category} · <b>{h.word}</b>
                {h.fakeWord && <span className="text-white/40 light:text-slate-400"> (가짜: {h.fakeWord})</span>}
              </td>
              <td className="py-1 pr-2">{names[h.liarSeat]}</td>
              <td className="py-1">{h.winner === "liar" ? "🎭 라이어" : "🕵️ 시민"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
