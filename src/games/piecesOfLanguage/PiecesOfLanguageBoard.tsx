"use client";

import { useState } from "react";
import RulebookModal from "./RulebookModal";
import { wordsOfLength } from "./words";
import {
  attemptsRemaining,
  otherSeat,
  type EngineAction,
  type GuessRecord,
  type PiecesOfLanguageState,
  type Seat,
  type SyllableFeedback,
} from "./engine";

/**
 * Pure game UI + rules driver — knows nothing about betting, IndexedDB, or
 * networking. State is fully controlled by the caller (`PiecesOfLanguageGame`,
 * which owns the Supabase Realtime sync): this component only ever emits
 * intent via `onAction`/`onGameEnd`, never mutates state itself.
 *
 * Word entry is a tap-to-select "조각" chip picker (search-filtered list of
 * `wordsOfLength(wordLength)`) rather than freeform typing — this keeps
 * every submission guaranteed-valid (no dictionary-membership rejection
 * round-trip) while still giving the "글자 조각을 조합한다" tactile feel
 * the work order asked for, without inventing the rulebook-absent random
 * letter-supply mechanic (see engine.ts's module doc).
 *
 * The optional §4 attempt cap is displayed as a depleting bar per seat —
 * this is the death-game "countdown" visual the work order asked for,
 * grounded in the rulebook's own optional attempt-limit house rule rather
 * than an invented wall-clock per-turn timer (which the rulebook doesn't
 * have, unlike e.g. malDalliJa's turn timer, which its own §5 does name).
 */
export interface PiecesOfLanguageBoardProps {
  state: PiecesOfLanguageState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  ids: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: (result: { winnerId: string | null; isDraw: boolean }) => void;
}

const SEAT_THEME: Record<Seat, { emoji: string; ring: string; text: string; bg: string }> = {
  p1: { emoji: "🟣", ring: "border-violet-400", text: "text-violet-300", bg: "bg-violet-500/20" },
  p2: { emoji: "🟠", ring: "border-amber-400", text: "text-amber-300", bg: "bg-amber-500/20" },
};

const TILE_COLOR: Record<SyllableFeedback["cho"], string> = {
  green: "bg-emerald-500/80 border-emerald-300 text-white",
  yellow: "bg-amber-400/80 border-amber-200 text-black",
  gray: "bg-white/[0.06] border-white/15 text-white/40",
};

function SyllableTile({ char, feedback, index }: { char: string; feedback: SyllableFeedback; index: number }) {
  return (
    <div
      className="flex flex-col items-center gap-1"
      style={{ animation: `pol-tile-flip 0.4s ease-out ${index * 0.12}s both` }}
    >
      <div
        className={`grid h-11 w-11 place-items-center rounded-lg border text-lg font-bold sm:h-12 sm:w-12 sm:text-xl ${
          feedback.cho === "green" && feedback.jung === "green" && feedback.jong === "green"
            ? "border-emerald-300 bg-emerald-500 text-white shadow-[0_0_14px_2px_rgba(16,185,129,0.5)]"
            : "border-white/15 bg-white/5 text-white"
        }`}
      >
        {char}
      </div>
      <div className="flex gap-0.5">
        {(["cho", "jung", "jong"] as const).map((slot) => (
          <span
            key={slot}
            className={`h-2 w-3.5 rounded-sm border ${TILE_COLOR[feedback[slot]]}`}
            title={`${slot}: ${feedback[slot]}`}
          />
        ))}
      </div>
    </div>
  );
}

function GuessRow({ guess, index }: { guess: GuessRecord; index: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 shrink-0 text-right text-[11px] text-white/30">{index + 1}</span>
      <div className="flex gap-1.5">
        {[...guess.word].map((char, i) => (
          <SyllableTile key={i} char={char} feedback={guess.feedback[i]} index={i} />
        ))}
      </div>
      {guess.isMatch && <span className="ml-1 text-xs font-bold text-emerald-300">✔ 정답!</span>}
    </div>
  );
}

function WordPicker({
  wordLength,
  onSubmit,
  accent,
}: {
  wordLength: number;
  onSubmit: (word: string) => void;
  accent: string;
}) {
  const [filter, setFilter] = useState("");
  const words = wordsOfLength(wordLength).filter((w) => w.includes(filter.trim()));
  return (
    <div className="flex flex-col gap-2">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`${wordLength}글자 단어 검색...`}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
      />
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2">
        {words.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onSubmit(w)}
            className={`rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:text-white ${accent}`}
          >
            {w}
          </button>
        ))}
        {words.length === 0 && <p className="p-2 text-xs text-white/40">일치하는 단어 조각이 없어요</p>}
      </div>
    </div>
  );
}

export default function PiecesOfLanguageBoard({
  state,
  viewerSeat,
  names,
  ids,
  opponentConnected,
  onAction,
  onGameEnd,
}: PiecesOfLanguageBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const opponentSeat = otherSeat(viewerSeat);
  const myAttemptsLeft = attemptsRemaining(state, viewerSeat);
  const oppAttemptsLeft = attemptsRemaining(state, opponentSeat);

  // ---- Setup phase: each viewer privately picks their own secret word. ----
  if (state.phase === "setup") {
    const mySecret = state.players[viewerSeat].secretWord;
    const oppReady = state.players[opponentSeat].secretWord !== null;
    return (
      <div className="flex flex-col gap-4">
        <Hud state={state} names={names} viewerSeat={viewerSeat} opponentConnected={opponentConnected} onOpenRulebook={() => setRulebookOpen(true)} />
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-5">
          <h3 className="mb-1 text-base font-bold text-white">🔒 나의 비밀 단어 정하기</h3>
          <p className="mb-3 text-xs text-white/50">
            {state.wordLength}글자 단어를 하나 골라주세요 — 상대가 이 단어를 맞혀야 합니다.
          </p>
          {mySecret ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-6 text-center">
              <span className="text-3xl">✅</span>
              <p className="text-sm text-white/80">
                비밀 단어 <b className="text-emerald-300">{mySecret}</b> 제출 완료
              </p>
              <p className="text-xs text-white/40">
                {oppReady ? "상대도 준비를 마쳤어요. 곧 시작합니다..." : `${names[opponentSeat]}님을 기다리는 중...`}
              </p>
            </div>
          ) : (
            <WordPicker
              wordLength={state.wordLength}
              accent="hover:border-violet-400 hover:bg-violet-500/10"
              onSubmit={(word) => onAction({ type: "set-secret", seat: viewerSeat, word })}
            />
          )}
        </div>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const myGuesses = state.players[viewerSeat].guesses;
  const oppGuesses = state.players[opponentSeat].guesses;

  return (
    <div className="relative flex flex-col gap-4">
      <Hud state={state} names={names} viewerSeat={viewerSeat} opponentConnected={opponentConnected} onOpenRulebook={() => setRulebookOpen(true)} />

      {/* ---- §4 optional attempt-cap countdown bars ---- */}
      {state.maxAttempts !== null && (
        <div className="grid grid-cols-2 gap-3">
          <AttemptsBar label={`나 (${names[viewerSeat]})`} left={myAttemptsLeft} max={state.maxAttempts} accent="violet" />
          <AttemptsBar label={`상대 (${names[opponentSeat]})`} left={oppAttemptsLeft} max={state.maxAttempts} accent="amber" />
        </div>
      )}

      <p className="text-center text-xs text-white/40">
        {isMyTurn ? "내 차례입니다 — 상대의 단어를 추리해 제시하세요" : `${names[opponentSeat]}의 차례를 기다리는 중…`}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- My guesses against the opponent's secret ---- */}
        <div className="flex flex-col gap-3 rounded-2xl border border-violet-400/20 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-4">
          <h3 className="text-sm font-bold text-white">🎯 내가 추리 중인 {names[opponentSeat]}님의 단어</h3>
          <div className="flex flex-col gap-2">
            {myGuesses.map((g, i) => (
              <GuessRow key={i} guess={g} index={i} />
            ))}
            {myGuesses.length === 0 && <p className="text-xs text-white/30">아직 시도한 단어가 없어요.</p>}
          </div>
          {isMyTurn && myAttemptsLeft !== 0 && (
            <WordPicker
              wordLength={state.wordLength}
              accent="hover:border-violet-400 hover:bg-violet-500/10"
              onSubmit={(word) => onAction({ type: "guess", word })}
            />
          )}
        </div>

        {/* ---- Opponent's guesses against my secret (read-only) ---- */}
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-gradient-to-b from-[#1c1508] via-[#150f06] to-black p-4">
          <h3 className="text-sm font-bold text-white">🕵️ {names[opponentSeat]}님이 추리 중인 내 단어</h3>
          <div className="flex flex-col gap-2">
            {oppGuesses.map((g, i) => (
              <GuessRow key={i} guess={g} index={i} />
            ))}
            {oppGuesses.length === 0 && <p className="text-xs text-white/30">아직 상대의 시도가 없어요.</p>}
          </div>
        </div>
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {state.phase === "gameOver" && (
        <GameOverOverlay
          amIWinner={state.winner === viewerSeat}
          isDraw={state.isDraw}
          winnerName={state.winner ? names[state.winner] : ""}
          mySecret={state.players[viewerSeat].secretWord ?? ""}
          opponentSecret={state.players[opponentSeat].secretWord ?? ""}
          onConfirm={() =>
            onGameEnd({ winnerId: state.winner ? ids[state.winner] : null, isDraw: state.isDraw })
          }
        />
      )}
    </div>
  );
}

function Hud({
  state,
  names,
  viewerSeat,
  opponentConnected,
  onOpenRulebook,
}: {
  state: PiecesOfLanguageState;
  names: Record<Seat, string>;
  viewerSeat: Seat;
  opponentConnected: boolean;
  onOpenRulebook: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-[#050203] p-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🧩</span>
        <div>
          <p className="text-sm font-bold text-white">언어의 조각</p>
          <p className="text-[11px] text-white/40">
            단판 승부 · {state.wordLength}글자 · 데스게임 하우스 룰
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {(["p1", "p2"] as const).map((seat) => (
          <div
            key={seat}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              state.phase === "playing" && state.activeSeat === seat
                ? `${SEAT_THEME[seat].ring} bg-white/10 ${SEAT_THEME[seat].text}`
                : "border-white/10 text-white/40"
            }`}
          >
            <span>{SEAT_THEME[seat].emoji}</span>
            <span>{names[seat]}</span>
            {seat === viewerSeat && <span className="text-white/30">(나)</span>}
            {state.phase === "playing" && state.activeSeat === seat && (
              <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            )}
          </div>
        ))}
        {!opponentConnected && (
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">상대 연결 대기중…</span>
        )}
        <button
          onClick={onOpenRulebook}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/30"
        >
          📖 룰북
        </button>
      </div>
    </div>
  );
}

function AttemptsBar({
  label,
  left,
  max,
  accent,
}: {
  label: string;
  left: number | null;
  max: number;
  accent: "violet" | "amber";
}) {
  const remaining = left ?? max;
  const low = remaining <= Math.ceil(max / 3);
  const barColor = low ? "bg-rose-500" : accent === "violet" ? "bg-violet-400" : "bg-amber-400";
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/50">
        <span>{label}</span>
        <span className={low ? "font-bold text-rose-300" : "text-white/60"}>
          시도 {remaining}/{max}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
        style={low ? { animation: "pol-attempts-warn 0.7s ease-in-out infinite" } : undefined}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${barColor}`}
          style={{ width: `${Math.max(0, (remaining / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function GameOverOverlay({
  amIWinner,
  isDraw,
  winnerName,
  mySecret,
  opponentSecret,
  onConfirm,
}: {
  amIWinner: boolean;
  isDraw: boolean;
  winnerName: string;
  mySecret: string;
  opponentSecret: string;
  onConfirm: () => void;
}) {
  const bgClass = isDraw
    ? "bg-gradient-to-b from-slate-800/95 via-black/95 to-black/95"
    : amIWinner
      ? "bg-gradient-to-b from-amber-950/95 via-black/95 to-black/95"
      : "bg-gradient-to-b from-rose-950/95 via-black/95 to-black/95";

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6 text-center ${bgClass}`}
      style={{ animation: "pol-elim-flash 0.5s ease-out" }}
    >
      <div style={{ animation: "pol-result-burst 0.6s ease-out" }}>
        {isDraw ? (
          <>
            <p className="text-5xl">🤝</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-slate-200 sm:text-5xl">DRAW</h2>
            <p className="mt-2 text-sm text-slate-300/80">
              양쪽 모두 시도 횟수를 다 썼고, 얻어낸 힌트 수도 같습니다.
            </p>
          </>
        ) : amIWinner ? (
          <>
            <p className="text-5xl">🏆</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-amber-300 sm:text-5xl">WINNER</h2>
            <p className="mt-2 text-sm text-amber-100/80">상대의 비밀 단어를 먼저 완성했습니다.</p>
          </>
        ) : (
          <>
            <p className="text-5xl">💀</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-rose-400 sm:text-5xl">ELIMINATED</h2>
            <p className="mt-2 text-sm text-rose-100/70">{winnerName}님이 먼저 정답을 맞혔습니다.</p>
          </>
        )}
      </div>
      <div className="flex gap-6 text-xs text-white/50">
        <p>
          내 비밀 단어: <span className="font-semibold text-white/80">{mySecret}</span>
        </p>
        <p>
          상대 비밀 단어: <span className="font-semibold text-white/80">{opponentSecret}</span>
        </p>
      </div>
      <button
        onClick={onConfirm}
        className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition hover:bg-white/85"
      >
        결과 확정하고 계속하기
      </button>
    </div>
  );
}
