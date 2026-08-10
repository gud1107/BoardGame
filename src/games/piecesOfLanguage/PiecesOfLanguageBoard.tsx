"use client";

import { useState } from "react";
import RulebookModal from "./RulebookModal";
import { wordsOfLength } from "./words";
import {
  totalAttemptsRemaining,
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
 * Both seats race toward one system-generated shared target word
 * (`state.targetWord`), taking strict turns submitting a guess — this board
 * never reveals `targetWord` before `phase === "gameOver"`. Word entry is a
 * tap-to-select "조각" chip picker (search-filtered list of
 * `wordsOfLength(wordLength)`) rather than freeform typing, keeping every
 * submission guaranteed-valid while still giving the "글자 조각을
 * 조합한다" tactile feel.
 *
 * There is deliberately no wall-clock per-turn timer (confirmed via
 * `AskUserQuestion`): the "제한시간 내에 먼저 맞히면 승리" win condition is
 * modeled as a pure race — first exact match wins — with no countdown UI.
 * The optional combined attempt cap (§4-style house rule, now summed across
 * both seats since they share one target) is still shown as a depleting bar,
 * which is the only "countdown"-flavored element this board has.
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

// Static class strings (not built via string interpolation) so Tailwind's
// JIT scanner can actually see and keep them — see WordPicker `accent` usage.
const SEAT_PICKER_ACCENT: Record<Seat, string> = {
  p1: "hover:border-violet-400 hover:bg-violet-500/10",
  p2: "hover:border-amber-400 hover:bg-amber-500/10",
};

const TILE_COLOR: Record<SyllableFeedback["cho"], string> = {
  blue: "bg-sky-500/80 border-sky-300 text-white",
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
          feedback.cho === "blue" && feedback.jung === "blue" && feedback.jong === "blue"
            ? "border-sky-300 bg-sky-500 text-white shadow-[0_0_14px_2px_rgba(14,165,233,0.5)]"
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

function GuessRow({ guess, index, names }: { guess: GuessRecord; index: number; names: Record<Seat, string> }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 shrink-0 text-right text-[11px] text-white/30">{index + 1}</span>
      <span className={`shrink-0 text-xs ${SEAT_THEME[guess.seat].text}`} title={names[guess.seat]}>
        {SEAT_THEME[guess.seat].emoji}
      </span>
      <div className="flex gap-1.5">
        {[...guess.word].map((char, i) => (
          <SyllableTile key={i} char={char} feedback={guess.feedback[i]} index={i} />
        ))}
      </div>
      {guess.isMatch && <span className="ml-1 text-xs font-bold text-sky-300">✔ 정답!</span>}
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
  const attemptsLeft = totalAttemptsRemaining(state);

  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;

  return (
    <div className="relative flex flex-col gap-4">
      <Hud state={state} names={names} viewerSeat={viewerSeat} opponentConnected={opponentConnected} onOpenRulebook={() => setRulebookOpen(true)} />

      {/* ---- optional combined attempt-cap countdown bar (§4-style house rule) ---- */}
      {state.maxAttempts !== null && (
        <AttemptsBar left={attemptsLeft} max={state.maxAttempts} />
      )}

      <p className="text-center text-xs text-white/40">
        {isMyTurn ? "내 차례입니다 — 공통 정답 단어를 추리해 제시하세요" : `${names[opponentSeat]}의 차례를 기다리는 중…`}
      </p>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-4">
        <h3 className="text-sm font-bold text-white">🎯 공통 정답 단어 추리</h3>
        <div className="flex flex-col gap-2">
          {state.history.map((g, i) => (
            <GuessRow key={i} guess={g} index={i} names={names} />
          ))}
          {state.history.length === 0 && <p className="text-xs text-white/30">아직 아무도 시도하지 않았어요.</p>}
        </div>
        {isMyTurn && attemptsLeft !== 0 && (
          <WordPicker
            wordLength={state.wordLength}
            accent={SEAT_PICKER_ACCENT[viewerSeat]}
            onSubmit={(word) => onAction({ type: "guess", word })}
          />
        )}
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {state.phase === "gameOver" && (
        <GameOverOverlay
          amIWinner={state.winner === viewerSeat}
          isDraw={state.isDraw}
          winnerName={state.winner ? names[state.winner] : ""}
          targetWord={state.targetWord}
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
            공통 정답 단어 · {state.wordLength}글자 · 2인 턴제 맞추기
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

function AttemptsBar({ left, max }: { left: number | null; max: number }) {
  const remaining = left ?? max;
  const low = remaining <= Math.ceil(max / 3);
  const barColor = low ? "bg-rose-500" : "bg-sky-400";
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/50">
        <span>남은 총 시도 횟수 (양쪽 합산)</span>
        <span className={low ? "font-bold text-rose-300" : "text-white/60"}>
          {remaining}/{max}
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
  targetWord,
  onConfirm,
}: {
  amIWinner: boolean;
  isDraw: boolean;
  winnerName: string;
  targetWord: string;
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
              양쪽 모두 총 시도 횟수를 다 썼고, 얻어낸 힌트 수도 같습니다.
            </p>
          </>
        ) : amIWinner ? (
          <>
            <p className="text-5xl">🏆</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-amber-300 sm:text-5xl">WINNER</h2>
            <p className="mt-2 text-sm text-amber-100/80">공통 정답 단어를 먼저 완성했습니다.</p>
          </>
        ) : (
          <>
            <p className="text-5xl">💀</p>
            <h2 className="mt-3 text-3xl font-black tracking-wider text-rose-400 sm:text-5xl">ELIMINATED</h2>
            <p className="mt-2 text-sm text-rose-100/70">{winnerName}님이 먼저 정답을 맞혔습니다.</p>
          </>
        )}
      </div>
      <p className="text-xs text-white/50">
        정답 단어: <span className="font-semibold text-white/80">{targetWord}</span>
      </p>
      <button
        onClick={onConfirm}
        className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition hover:bg-white/85"
      >
        결과 확정하고 계속하기
      </button>
    </div>
  );
}
