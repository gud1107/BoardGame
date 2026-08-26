"use client";

import { useEffect, useRef, useState } from "react";
import Overlay from "@/components/Overlay";
import RulebookModal from "./RulebookModal";
import DealerReveal from "./DealerReveal";
import { CardChip } from "./cardDisplay";
import { useCountdown } from "./useCountdown";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { detectNewlyCompletedLines, HandRankFloatingBadge, type LineCompleteEvent } from "./GridPokerEffects";
import RoundResultOverlay from "./RoundResultOverlay";
import {
  BOARD_SIZE,
  LINE_LABELS,
  LINES,
  ROUND_RESULT_SECONDS,
  completedLineCount,
  evaluateHand,
  formatHandLabel,
  linesByHandStrengthDesc,
  opponentLiveCell,
  visibleOpponentBoard,
  type Card,
  type EngineAction,
  type GridPokerState,
  type PlayerState,
  type SeatIndex,
} from "./engine";

const URGENT_THRESHOLD = 5;

function randomFrom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Score-descending standings with competition ranking (ties share a rank,
 * the next distinct score skips ahead — e.g. 1,1,3), used by the always-
 * visible top badge strip so an 8-player game reads as a leaderboard rather
 * than an unordered seat list.
 */
function rankedPlayers(players: PlayerState[]): { player: PlayerState; rank: number }[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((player) => ({ player, rank: sorted.findIndex((p) => p.score === player.score) + 1 }));
}

/**
 * Per-player "how close to the win threshold" dots for the leaderboard
 * strip — one dot per round win needed to end the game (`state.winThreshold`,
 * 6 for 2p / 7 for 3+p), filled left-to-right as `wins` climbs. Deliberately
 * keyed to the threshold rather than `totalScoringRounds`: the game can (and
 * usually does) end the instant someone hits the threshold, well before every
 * scoring round is played, so the threshold is the number that actually
 * tells a player "this many rounds until it's over" (see engine.ts's
 * `checkGameEnd`).
 */
function WinDots({ wins, threshold }: { wins: number; threshold: number }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: threshold }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < wins ? "bg-amber-300" : "border border-white/25 bg-transparent"}`}
        />
      ))}
    </span>
  );
}

/**
 * Pure game UI + rules driver — same contract as HanamikojiBoard/BangBoard:
 * state is fully controlled by the caller (GridPokerGame, which owns the
 * Supabase Realtime sync); this component only ever emits intent via
 * `onAction`. Every client holds the FULL state (every player's entire
 * board); this component only *renders* a filtered view of opponents via
 * `visibleOpponentBoard` — see engine.ts and README for the accepted trust
 * trade-off (no server authority).
 */
export interface GridPokerBoardProps {
  state: GridPokerState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/50 bg-gradient-to-b from-[#151a2e] via-[#0f1322] to-[#0a0d17] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

const CELL_DIMS = {
  main: "h-14 w-10 sm:h-16 sm:w-12",
  mini: "h-11 w-8 sm:h-12 sm:w-9",
};

/**
 * `hiddenOccupied` is the "opponent already placed something here but we
 * can't see what" state — visually distinct from a genuinely empty cell so
 * the board reads as progressively darkening/filling in, not as if nothing
 * happened there. Every client holds the opponent's full board in memory
 * (see engine.ts's trust-trade-off note); this is purely a rendering choice
 * to *not* show it.
 */
/** Which completed-line sweep (if any) a cell should play right now — `eventId` keys the sweep span so an overlapping second completion on the same cell (rare: a corner/center cell shared by two lines finished by the same placement) still remounts and restarts the animation instead of silently no-opping. */
type CellGlow = { delayMs: number; eventId: number };

function Cell({
  card,
  hiddenOccupied = false,
  highlight,
  glow = null,
  onClick,
  size = "main",
}: {
  card: Card | null;
  hiddenOccupied?: boolean;
  highlight?: boolean;
  glow?: CellGlow | null;
  onClick?: () => void;
  size?: "main" | "mini";
}) {
  const dims = CELL_DIMS[size];
  if (hiddenOccupied) {
    return (
      <span
        title="상대가 이미 카드를 놓은 칸 (공개 전)"
        className={`inline-flex ${dims} items-center justify-center rounded-md border border-white/5 bg-black/75 text-white/15 shadow-[inset_0_0_8px_rgba(0,0,0,0.8)] ${
          highlight ? "ring-2 ring-amber-400/80" : ""
        }`}
      >
        <span className="text-xs">🂠</span>
      </span>
    );
  }
  if (!card) {
    return (
      <button
        onClick={onClick}
        disabled={!onClick}
        className={`${dims} rounded-md border border-dashed transition ${
          onClick ? "border-white/25 bg-white/[0.03] hover:border-emerald-400/60 hover:bg-emerald-400/10" : "border-white/10 bg-white/[0.02]"
        } ${highlight ? "ring-2 ring-amber-400/70" : ""}`}
      />
    );
  }
  return (
    <span className={`relative inline-block rounded-md ${highlight ? "ring-2 ring-amber-400/80" : ""}`}>
      {/* Keyed by card.id: a cell only ever transitions null -> Card once, so
          this remounts (replaying the mount-only gp-card-place/gp-cell-pulse
          keyframes — see globals.css) exactly on that placement, never again
          on later unrelated re-renders. */}
      <span key={card.id} className="block animate-[gp-card-place_0.42s_cubic-bezier(0.34,1.56,0.64,1)_both]">
        <CardChip card={card} size={size === "main" ? "md" : "sm"} dim={false} />
      </span>
      <span
        key={`${card.id}-pulse`}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-md animate-[gp-cell-pulse_0.6s_ease-out_forwards]"
      />
      {glow && (
        <span
          key={glow.eventId}
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-lg animate-[gp-line-glow_0.9s_ease-out_forwards]"
          style={{ animationDelay: `${glow.delayMs}ms` }}
        />
      )}
    </span>
  );
}

/**
 * An opponent's board as seen by everyone else: `visibleOpponentBoard`'s
 * permanent reveals (first-placed cell + already-submitted lines), with
 * `opponentLiveCell`'s "placing it right now" marker layered on top and
 * everything else darkened via `hiddenOccupied`. Shared by the desktop
 * inline grid and the mobile tap-to-view popup so the two never drift.
 */
function OpponentBoardGrid({ state, player, size = "mini" }: { state: GridPokerState; player: PlayerState; size?: "main" | "mini" }) {
  const board = visibleOpponentBoard(player);
  const liveCell = opponentLiveCell(state, player);
  return (
    <div className="grid grid-cols-5 gap-1">
      {board.map((card, i) => {
        const isLive = i === liveCell;
        const displayCard = isLive ? player.board[i] : card;
        // Revealed-null but actually filled (per the full state every
        // client holds) = placed here in an earlier round and still
        // hidden — render dark, not empty.
        const hiddenOccupied = !isLive && displayCard === null && player.board[i] !== null;
        return <Cell key={i} card={displayCard} hiddenOccupied={hiddenOccupied} highlight={isLive} size={size} />;
      })}
    </div>
  );
}

/** Numeric countdown bar, red-hot once inside the urgent threshold. */
function CountdownBar({ timeLeft, total }: { timeLeft: number; total: number }) {
  const urgent = timeLeft <= URGENT_THRESHOLD;
  const pct = Math.max(0, Math.min(100, (timeLeft / total) * 100));
  return (
    <div className="flex w-full max-w-[220px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
            urgent ? "bg-rose-500" : "bg-emerald-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-6 text-right text-xs font-bold tabular-nums ${urgent ? "animate-pulse text-rose-300" : "text-white/60"}`}>
        {timeLeft}
      </span>
    </div>
  );
}

export default function GridPokerBoard({
  state,
  viewerSeat,
  names,
  connectedSeats,
  onAction,
  onGameEnd,
}: GridPokerBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  // Which opponent's board the mobile tap-to-view popup currently shows
  // (see the opponent tab strip below) — null means no popup is open.
  // Desktop never sets this; it renders every opponent's board inline.
  const [viewedSeat, setViewedSeat] = useState<SeatIndex | null>(null);
  const viewer = state.players[viewerSeat];
  const opponents = state.players.filter((p) => p.seat !== viewerSeat);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 족보 · 룰북
    </button>
  );

  // All hooks (countdowns, the SFX effect, the mute-toggle state) must run
  // unconditionally on every render, so this whole block lives above the
  // early `game-end` return below rather than after it.
  const filledCells = viewer.board.filter((c) => c !== null).length;
  const myTurnToPlace = state.phase === "placing" && state.currentCard !== null && !state.placedThisRound[viewerSeat];
  const mySubmission = state.submissions[viewerSeat];

  // Line-completion flourish (see GridPokerEffects.tsx's module doc) —
  // `viewer.board`'s array reference only ever changes when *this* seat's
  // own `place()` actually mutates it (engine.ts's reducer leaves every
  // other player's `board` reference untouched on any other action), so
  // comparing it against the last-seen reference is exactly "did I just
  // place a card" with no extra bookkeeping. Detection + state update happen
  // directly during render (not inside a useEffect) — same "compare then
  // conditionally setState while rendering" pattern this project already
  // uses for its other diff-driven flourishes (see e.g. coup/CoupBoard.tsx).
  const [trackedBoard, setTrackedBoard] = useState(viewer.board);
  const [lineEvents, setLineEvents] = useState<LineCompleteEvent[]>([]);
  const lineEventIdRef = useRef(0);
  if (trackedBoard !== viewer.board) {
    const newlyCompleted = detectNewlyCompletedLines(trackedBoard, viewer.board);
    setTrackedBoard(viewer.board);
    if (newlyCompleted.length > 0) {
      const board = viewer.board;
      setLineEvents((events) => [
        ...events,
        ...newlyCompleted.map((lineIndex) => ({
          id: ++lineEventIdRef.current,
          lineIndex,
          hand: evaluateHand(LINES[lineIndex].map((cellIndex) => board[cellIndex]!)),
        })),
      ]);
    }
  }
  // Which cell (if any) should play the gold sweep right now, and with how
  // much delay along its line (so the sweep visibly travels across the 5
  // cells instead of all popping at once) — derived fresh each render from
  // `lineEvents`, not stored separately, so it always matches exactly the
  // still-active events below.
  const glowByCell = new Map<number, { delayMs: number; eventId: number }>();
  for (const event of lineEvents) {
    LINES[event.lineIndex].forEach((cellIndex, i) => {
      if (!glowByCell.has(cellIndex)) glowByCell.set(cellIndex, { delayMs: i * 70, eventId: event.id });
    });
  }

  function placeAt(cellIndex: number) {
    if (!myTurnToPlace || viewer.board[cellIndex] !== null) return;
    const engine = getSoundEngine();
    engine.unlock();
    engine.playCardFlick(); // pick-and-move flick, then a settling snap once it locks into the cell
    setTimeout(() => engine.playGridSnap(), 90);
    onAction({ type: "place", seat: viewerSeat, cellIndex });
  }

  function submitLine(lineIndex: number) {
    if (state.phase !== "submitting" || mySubmission !== null || viewer.usedLines[lineIndex]) return;
    onAction({ type: "submit-line", seat: viewerSeat, lineIndex });
  }

  // Room-chosen per-phase countdown lengths (see engine.ts's `TimerSettings`
  // doc) — set once by the host at room-create time and carried inside
  // `state` itself, so every client's countdown reads the exact same
  // numbers with no separate sync channel. `mode === "unlimited"` gates the
  // countdowns off entirely: `active` stays false, so `useCountdown` never
  // ticks or auto-acts, and the bar itself doesn't render.
  const { placingSeconds, submittingSeconds } = state.timerSettings;
  const timeLimited = state.timerSettings.mode === "limited";

  // Per-viewer countdowns (see useCountdown.ts) — each client only ever
  // auto-acts for its own seat on expiry, matching the lockstep model.
  // `resetKey` ties each timer to "this specific draw/round" so a rerender
  // mid-countdown never restarts it early, and a fresh draw/round always does.
  const { timeLeft: placingTimeLeft } = useCountdown(placingSeconds, state.drawCount, myTurnToPlace && timeLimited, () => {
    const emptyCells = viewer.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    const cell = randomFrom(emptyCells);
    if (cell !== undefined) placeAt(cell);
  });
  const submittingActive = state.phase === "submitting" && mySubmission === null && timeLimited;
  const { timeLeft: submittingTimeLeft } = useCountdown(submittingSeconds, state.roundNumber, submittingActive, () => {
    const unused = LINES.map((_, i) => i).filter((i) => !viewer.usedLines[i]);
    const line = randomFrom(unused);
    if (line !== undefined) submitLine(line);
  });

  // Round-result's "다음 라운드 준비" bar (RoundResultOverlay.tsx) — a purely
  // cosmetic local clock every client runs to *display*, in step with the
  // host's own real advance timer (GridPokerGame.tsx's `advance-round-result`
  // broadcast). Always active while parked here regardless of the room's
  // placing/submitting timer mode — this isn't a per-room configurable
  // option, see `ROUND_RESULT_SECONDS`'s own doc — so no `timeLimited` gate
  // and a no-op `onExpire` (the phase transition itself is the host's job).
  const { timeLeft: roundResultTimeLeft } = useCountdown(
    ROUND_RESULT_SECONDS,
    state.lastRoundResult?.roundNumber,
    state.phase === "round-result",
    () => {},
  );

  const urgentTimeLeft = !timeLimited ? null : myTurnToPlace ? placingTimeLeft : submittingActive ? submittingTimeLeft : null;
  const isUrgent = urgentTimeLeft !== null && urgentTimeLeft <= URGENT_THRESHOLD && urgentTimeLeft > 0;
  useEffect(() => {
    const engine = getSoundEngine();
    if (isUrgent) engine.startFuseCrackle();
    else engine.stopFuseCrackle();
    return () => engine.stopFuseCrackle();
  }, [isUrgent]);

  // A short positive "ding" the instant the round-result overlay appears —
  // there's no bespoke fanfare/victory jingle anywhere in this project's
  // sound engine to draw from (checked: only playCorrectDing/playWrongBuzz/
  // dice/BGM exist), so this reuses the same generic positive sound already
  // used elsewhere rather than adding new audio synthesis for one flourish.
  useEffect(() => {
    if (state.phase === "round-result") getSoundEngine().playCorrectDing();
  }, [state.phase, state.lastRoundResult?.roundNumber]);

  // Both toggles below read/write the site-wide `audioSettings` store, so
  // they always match the header's global sound widget and the settings
  // modal — no more per-game-only mute flags (2026-08-26 세션, 통합).
  const masterMuted = useAudioSettingsStore((s) => s.masterMuted);
  const toggleMasterMuted = useAudioSettingsStore((s) => s.toggleMasterMuted);
  const soundToggle = (
    <button
      onClick={() => {
        toggleMasterMuted();
        getSoundEngine().unlock();
      }}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
      aria-label={masterMuted ? "소리 켜기" : "소리 끄기"}
    >
      {masterMuted ? "🔇" : "🔊"}
    </button>
  );

  // Separate from `soundToggle` above: that one mutes/unmutes everything
  // (SFX + BGM) via the master flag, while this one only mutes this game's
  // themed background music (딥 하우스 BGM — see `useGameBgm("gridPoker")`
  // in GridPokerGame.tsx), independent of the SFX-affecting master toggle.
  const bgmMuted = useAudioSettingsStore((s) => s.bgmMuted);
  const toggleBgmMuted = useAudioSettingsStore((s) => s.toggleBgmMuted);
  const bgmToggle = (
    <button
      onClick={toggleBgmMuted}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
      aria-label={bgmMuted ? "배경음악 켜기" : "배경음악 끄기"}
      title="배경음악"
    >
      {bgmMuted ? "🎵🚫" : "🎵"}
    </button>
  );

  if (state.phase === "game-end") {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-5 p-8 text-center`}>
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100">
          {state.winner && state.winner.length === 1
            ? `${names[state.winner[0]]}님 승리!`
            : "동점으로 무승부"}
        </h2>
        <div className="relative z-10 flex flex-wrap justify-center gap-2">
          {sorted.map((p) => (
            <div
              key={p.seat}
              className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs ${
                state.winner?.includes(p.seat) ? "border-amber-400/50 bg-amber-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <span className="text-white/80">{names[p.seat]}</span>
              <span className="text-lg font-bold text-white">{p.score}승</span>
            </div>
          ))}
        </div>
        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      </div>
    );
  }

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-4 p-3 sm:p-4`}>
      <div className="relative z-10 flex items-center justify-between text-xs text-white/60">
        <span>
          {state.phase === "placing"
            ? `배치 중 · ${filledCells}/${BOARD_SIZE}칸`
            : state.phase === "round-result"
              ? `${state.lastRoundResult?.roundNumber ?? state.roundNumber}라운드 결과`
              : `제출 라운드 ${Math.min(state.roundNumber, state.totalScoringRounds)}/${state.totalScoringRounds}`}
        </span>
        <div className="flex items-center gap-1.5">
          {bgmToggle}
          {soundToggle}
          {rulebookButton}
        </div>
      </div>

      {/* Always-visible leaderboard strip — ranked, not seat order, so an
          8-player game reads as standings at a glance without an extra tap.
          Scrolls horizontally on narrow phones instead of wrapping to
          multiple lines, so it never eats into the board area below;
          desktop has the room to wrap instead. */}
      <div className="relative z-10 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {rankedPlayers(state.players).map(({ player: p, rank }) => (
          <div
            key={p.seat}
            title={`목표 ${state.winThreshold}승 중 ${p.score}승 · ${Math.max(state.winThreshold - p.score, 0)}승 남음`}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
              p.seat === viewerSeat ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-white/60"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(p.seat) ? "bg-emerald-400" : "bg-white/20"}`} />
            <span className="font-semibold text-amber-300/90">{rank === 1 ? "🏆" : `${rank}위`}</span>
            {names[p.seat]} · {p.score}/{state.winThreshold}승
            <WinDots wins={p.score} threshold={state.winThreshold} />
          </div>
        ))}
      </div>

      {state.phase === "placing" && (
        <div className="relative z-10 flex flex-col items-center gap-2">
          <DealerReveal
            card={state.currentCard}
            drawCount={state.drawCount}
            caption={
              !state.currentCard
                ? "다음 카드를 뽑는 중..."
                : myTurnToPlace
                  ? "빈 칸을 눌러 배치하세요"
                  : "배치 완료 · 다른 플레이어를 기다리는 중..."
            }
          />
          {myTurnToPlace && timeLimited && <CountdownBar timeLeft={placingTimeLeft} total={placingSeconds} />}
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <p className="text-xs text-white/50">내 보드판</p>
        <div className="grid grid-cols-5 gap-1.5 rounded-2xl border border-white/10 bg-black/20 p-2.5 sm:gap-2 sm:p-3">
          {viewer.board.map((card, i) => (
            <Cell key={i} card={card} glow={glowByCell.get(i) ?? null} onClick={myTurnToPlace && card === null ? () => placeAt(i) : undefined} />
          ))}
        </div>
      </div>

      {lineEvents.map((event, i) => (
        <HandRankFloatingBadge
          key={event.id}
          event={event}
          stackIndex={i}
          onDone={(id) => setLineEvents((events) => events.filter((e) => e.id !== id))}
        />
      ))}

      {state.phase === "submitting" && (
        <div className="relative z-10 flex flex-col items-center gap-2">
          <p className="text-center text-xs text-white/50">
            {mySubmission !== null ? "제출 완료 · 다른 플레이어를 기다리는 중..." : "제출할 라인을 하나 고르세요"}
          </p>
          {submittingActive && <CountdownBar timeLeft={submittingTimeLeft} total={submittingSeconds} />}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {/* Default-sorted strongest hand first (linesByHandStrengthDesc,
                engine.ts) — matches the rulebook's high-to-low ordering
                (RulebookModal.tsx's HAND_EXAMPLES) so the best line to submit
                always leads the list without any extra sort toggle. */}
            {linesByHandStrengthDesc(viewer).map(({ lineIndex, hand }) => {
              const used = viewer.usedLines[lineIndex];
              const cards = LINES[lineIndex].map((c) => viewer.board[c]!);
              return (
                <button
                  key={lineIndex}
                  onClick={() => submitLine(lineIndex)}
                  disabled={used || mySubmission !== null}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${
                    used
                      ? "border-white/5 bg-white/[0.02] opacity-40"
                      : mySubmission === lineIndex
                        ? "border-amber-400/60 bg-amber-400/10"
                        : "border-white/10 bg-white/5 hover:border-emerald-400/50 hover:bg-emerald-400/10"
                  }`}
                >
                  <span className="text-[10px] text-white/50">{LINE_LABELS[lineIndex]}</span>
                  <div className="flex gap-0.5">
                    {cards.map((c) => (
                      <CardChip key={c.id} card={c} size="sm" />
                    ))}
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-300">
                    {formatHandLabel(hand)}
                    <span className="ml-1 font-normal text-white/40">({hand.category + 1}/9)</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {state.lastRoundResult && (
        <div className="relative z-10 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-xs text-white/50">
            {state.lastRoundResult.roundNumber}라운드 결과
            {state.lastRoundResult.winnerSeat !== null
              ? ` · ${names[state.lastRoundResult.winnerSeat]} 승!`
              : " · 무승부"}
          </p>
          <div className="flex flex-col gap-1.5">
            {state.lastRoundResult.submissions.map((sub) => (
              <div key={sub.seat} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-16 shrink-0 truncate ${sub.seat === state.lastRoundResult!.winnerSeat ? "font-semibold text-amber-300" : "text-white/60"}`}
                >
                  {names[sub.seat]}
                </span>
                <div className="flex gap-0.5">
                  {sub.hand.cards.map((c, i) => (
                    <span key={i} className="relative">
                      <CardChip card={{ kind: "std", rank: c.rank, suit: c.suit }} size="sm" />
                      {c.fromJoker && (
                        <span className="absolute -top-1 -right-1 text-[8px]" title="조커로 대체됨">
                          🃏
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <span className="text-white/50">{formatHandLabel(sub.hand)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {opponents.length > 0 && (
        <div className="relative z-10 flex flex-col gap-1.5">
          <p className="text-xs text-white/50">상대 보드판 (처음 배치한 칸 + 공개된 라인 + 이번 카드 배치 위치만 보임)</p>

          {/* Mobile (< sm): a scrollable strip of summary chips — tap one to
              pop the board open in `viewedSeat`'s popup below, instead of
              cramming up to 7 mini-grids onto a phone screen at once. */}
          <div className="flex gap-2 overflow-x-auto pb-1 sm:hidden">
            {opponents.map((p) => {
              const liveCell = opponentLiveCell(state, p);
              return (
                <button
                  key={p.seat}
                  onClick={() => setViewedSeat(p.seat)}
                  className="flex shrink-0 flex-col items-start gap-0.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-left transition active:border-emerald-400/50 active:bg-emerald-400/10"
                >
                  <span className="flex items-center gap-1 text-[11px] font-medium text-white/80">
                    {names[p.seat]}
                    {liveCell !== null && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="배치 중" />}
                  </span>
                  <span className="text-[10px] text-white/50">
                    {p.score}승 · 라인 {completedLineCount(p)}개
                  </span>
                </button>
              );
            })}
          </div>

          {/* Desktop/tablet (>= sm): room enough to show every board inline. */}
          <div className="hidden flex-wrap gap-2 sm:flex">
            {opponents.map((p) => {
              const liveCell = opponentLiveCell(state, p);
              return (
                <div key={p.seat} className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-2">
                  <span className="flex items-center gap-1 text-[11px] text-white/60">
                    {names[p.seat]} · {p.score}승 · 라인 {completedLineCount(p)}개
                    {liveCell !== null && <span className="text-[10px] text-amber-300">· 배치 중</span>}
                  </span>
                  <OpponentBoardGrid state={state} player={p} size="mini" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewedSeat !== null && (
        <Overlay
          title={`${names[state.players[viewedSeat].seat]} · ${state.players[viewedSeat].score}승 · 라인 ${completedLineCount(state.players[viewedSeat])}개`}
          onClose={() => setViewedSeat(null)}
        >
          <div className="flex justify-center">
            <OpponentBoardGrid state={state} player={state.players[viewedSeat]} size="main" />
          </div>
        </Overlay>
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {state.phase === "round-result" && state.lastRoundResult && (
        <RoundResultOverlay
          result={state.lastRoundResult}
          players={state.players}
          names={names}
          winThreshold={state.winThreshold}
          viewerSeat={viewerSeat}
          timeLeft={roundResultTimeLeft}
          secondsTotal={ROUND_RESULT_SECONDS}
        />
      )}
    </div>
  );
}
