"use client";

import { useState } from "react";
import Avatar from "@/components/common/Avatar";
import RulebookModal from "./RulebookModal";
import WordInput from "./WordInput";
import { rotationPartner } from "./hangul";
import {
  buildHint,
  isHintUnlocked,
  totalAttemptsRemaining,
  otherSeat,
  type EngineAction,
  type FeedbackColor,
  type GuessRecord,
  type PiecesOfLanguageState,
  type Seat,
} from "./engine";

/**
 * Pure game UI + rules driver — knows nothing about betting, IndexedDB, or
 * networking. State is fully controlled by the caller (`PiecesOfLanguageGame`,
 * which owns the Supabase Realtime sync): this component only ever emits
 * intent via `onAction`/`onGameEnd`, never mutates state itself.
 *
 * Both seats race toward one system-generated shared target word
 * (`state.targetWord`), taking strict turns submitting a guess — this board
 * never reveals `targetWord` before `phase === "gameOver"`. Word entry is
 * direct keyboard typing (`WordInput` below, replacing the earlier
 * per-syllable 자음/모음 회전 dial picker — see git history for that
 * version): a player types their whole guess into one text field with their
 * own keyboard/IME, with a live consonant/vowel usage counter
 * (`PieceTracker`) above it. A typed word only submits once it matches an
 * entry in `wordsOfLength(wordLength)` (`isValidWord`); until then the input
 * shows closest-match word hints instead of silently accepting garbage.
 *
 * Feedback is **one light per completed 글자** (syllable), not per jamo
 * slot: green (character + position both match the target), yellow
 * (character exists elsewhere in the target), red (character absent
 * entirely) — see `engine.ts`'s `compareWords` module doc.
 *
 * Typed guesses are further hard-railed by `state.tilePool` (`TilePool`
 * below renders it in the shared common area): a typed word only submits
 * once it's *both* a real word-bank entry *and* buildable from the pool
 * (literally or via each tile's rotation partner) — see `engine.ts`'s
 * `buildTilePool`/`wordBuildableFromPool` module doc for why the pool is
 * deliberately minimal (exactly the target's own jamo, no random filler).
 * `WordInput`'s `PieceTracker` panel previews this same pool rule live, per
 * jamo, as the player types (`hangul.ts`'s `jamoAvailableInPool`).
 *
 * There is deliberately no wall-clock per-turn timer (confirmed via
 * `AskUserQuestion`): the "제한시간 내에 먼저 맞히면 승리" win condition is
 * modeled as a pure race — first exact match wins — with no countdown UI.
 * The optional combined attempt cap (§4-style house rule, now summed across
 * both seats since they share one target) is still shown as a depleting bar,
 * which is the only "countdown"-flavored element this board has.
 *
 * `HintPanel` (below) is each viewer's own gated, partial-reveal hint of
 * `targetWord` (engine.ts's `isHintUnlocked`/`buildHint`): locked until that
 * viewer has submitted at least one wrong guess of their own, then showing
 * exactly half its characters (random positions) masked as `_` otherwise —
 * see engine.ts's module doc for why.
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
// JIT scanner can actually see and keep them — see WordInput's `accent` usage.
const SEAT_PICKER_ACCENT: Record<Seat, string> = {
  p1: "hover:border-violet-400 hover:bg-violet-500/10",
  p2: "hover:border-amber-400 hover:bg-amber-500/10",
};

/** One light per completed 글자 — see engine.ts's `compareWords` doc for the color semantics. */
const TILE_COLOR: Record<FeedbackColor, string> = {
  green: "border-emerald-300 bg-emerald-500 text-white shadow-[0_0_14px_2px_rgba(16,185,129,0.5)]",
  yellow: "border-amber-200 bg-amber-400/80 text-black",
  red: "border-rose-400/40 bg-rose-500/10 text-rose-100/70",
};

function SyllableTile({ char, feedback, index }: { char: string; feedback: FeedbackColor; index: number }) {
  return (
    <div
      className={`grid h-11 w-11 place-items-center rounded-lg border text-lg font-bold sm:h-12 sm:w-12 sm:text-xl ${TILE_COLOR[feedback]}`}
      style={{ animation: `pol-tile-flip 0.4s ease-out ${index * 0.12}s both` }}
      title={feedback}
    >
      {char}
    </div>
  );
}

/** One seat's guess, rendered as a cell inside the 2×N history grid — the seat is implied by which column it's in, so no seat badge here (unlike the old single-timeline row). */
function GuessCell({ guess, turn }: { guess: GuessRecord; turn: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5">
      <span className="w-5 shrink-0 text-right text-[11px] text-white/30">{turn}</span>
      <div className="flex gap-1.5">
        {[...guess.word].map((char, i) => (
          <SyllableTile key={i} char={char} feedback={guess.feedback[i]} index={i} />
        ))}
      </div>
      {guess.isMatch && <span className="ml-1 text-xs font-bold text-sky-300">✔</span>}
    </div>
  );
}

/** Empty placeholder cell for a turn this seat hasn't reached yet — keeps the two columns row-aligned. */
function EmptyGuessCell({ turn }: { turn: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-white/5 px-2 py-1.5">
      <span className="w-5 shrink-0 text-right text-[11px] text-white/20">{turn}</span>
      <span className="text-xs text-white/20">대기 중…</span>
    </div>
  );
}

/**
 * 2×N grid history (`언어의조각.md` §4): P1's own guesses down the left
 * column, P2's own guesses down the right column, row *n* pairing each
 * seat's *n*-th own submission — replaces the old single merged
 * chronological timeline entirely.
 */
function HistoryGrid({ history, names }: { history: GuessRecord[]; names: Record<Seat, string> }) {
  const bySeat: Record<Seat, GuessRecord[]> = { p1: [], p2: [] };
  for (const g of history) bySeat[g.seat].push(g);
  const rows = Math.max(bySeat.p1.length, bySeat.p2.length);

  if (rows === 0) {
    return <p className="text-xs text-white/30">아직 아무도 시도하지 않았어요.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {(["p1", "p2"] as const).map((seat) => (
        <div key={seat} className={`flex items-center gap-1.5 text-xs font-semibold ${SEAT_THEME[seat].text}`}>
          <Avatar size={16} />
          <span>{SEAT_THEME[seat].emoji}</span>
          <span className="truncate">{names[seat]}</span>
        </div>
      ))}
      {/* Flat list, not grouped by row — `grid-cols-2`'s default row-major auto-flow
          lands p1/p2 side by side per row on its own, so no Fragment-per-row wrapper
          (and no missing-key-on-Fragment footgun) is needed. */}
      {Array.from({ length: rows }, (_, i) => i).flatMap((i) =>
        (["p1", "p2"] as const).map((seat) =>
          bySeat[seat][i] ? (
            <GuessCell key={`${seat}-${i}`} guess={bySeat[seat][i]} turn={i + 1} />
          ) : (
            <EmptyGuessCell key={`${seat}-${i}`} turn={i + 1} />
          ),
        ),
      )}
    </div>
  );
}

/** The common consonant/vowel tile pool, rendered in the shared central area both seats build guesses from (`언어의조각.md` §1/§2). */
function TilePool({ pool }: { pool: string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-sky-400/20 bg-gradient-to-b from-sky-950/40 to-black/20 p-3">
      <p className="text-center text-xs font-semibold tracking-wide text-sky-200/70">
        🧵 공통 자모음 조각 풀 — 이 조각(과 회전 변환)으로만 조합 가능
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {pool.map((jamo, i) => {
          const partner = rotationPartner(jamo);
          return (
            <div
              key={i}
              className="flex flex-col items-center gap-0.5 rounded-lg border border-sky-400/30 bg-sky-500/10 px-2.5 py-1.5"
              title={partner ? `회전하면 ${partner}(으)로도 사용할 수 있어요` : undefined}
            >
              <span className="text-lg font-bold text-white">{jamo}</span>
              {partner && <span className="text-[10px] leading-none text-sky-300">↻{partner}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The viewer's own partial-reveal hint (`engine.ts`'s `isHintUnlocked`/
 * `buildHint`): locked until the viewer has submitted at least one wrong
 * guess of their own, then shows exactly half of the target word's
 * characters (random positions) with the rest masked as `_` — never the
 * whole word, and never before anyone's actually missed.
 */
function HintPanel({ state, seat }: { state: PiecesOfLanguageState; seat: Seat }) {
  if (!isHintUnlocked(state, seat)) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white/30">
        <span>🔒</span>
        <span>힌트는 내가 오답을 1회 이상 제출해야 해금돼요</span>
      </div>
    );
  }
  const revealed = buildHint(state.targetWord, seat);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/5 px-3 py-2.5">
      <span className="text-xs font-semibold text-sky-200/70">💡 힌트</span>
      <div className="flex gap-1.5">
        {revealed.map((ch, i) => (
          <span
            key={i}
            className={`grid h-8 w-8 place-items-center rounded-md border text-sm font-bold ${
              ch === "_" ? "border-white/10 bg-white/5 text-white/25" : "border-sky-300/40 bg-sky-500/15 text-white"
            }`}
          >
            {ch}
          </span>
        ))}
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

      <TilePool pool={state.tilePool} />

      <HintPanel state={state} seat={viewerSeat} />

      <p className="text-center text-xs text-white/40">
        {isMyTurn ? "내 차례입니다 — 공통 정답 단어를 추리해 제시하세요" : `${names[opponentSeat]}의 차례를 기다리는 중…`}
      </p>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-4">
        <h3 className="text-sm font-bold text-white">🎯 공통 정답 단어 추리 — 기록</h3>
        <HistoryGrid history={state.history} names={names} />
        {isMyTurn && attemptsLeft !== 0 && (
          <WordInput
            wordLength={state.wordLength}
            pool={state.tilePool}
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
            <Avatar size={18} />
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
