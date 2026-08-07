"use client";

import { useCallback, useRef, useState } from "react";
import { detectAuctionEvent, FlyingToken, type AnimEvent } from "./AuctionEffects";
import RulebookModal from "./RulebookModal";
import {
  CARD_MAX,
  CARD_MIN,
  computeGroups,
  computeRankings,
  REMOVE_COUNT,
  type EngineAction,
  type NoThanksState,
  type ScoreGroup,
  type SeatIndex,
} from "./engine";

const REVEAL_CHIPS_STORAGE_KEY = "no-thanks-reveal-opponent-chips";

/**
 * Pure game UI + rules driver — mirrors AvalonBoard/BangBoard/GridPokerBoard's
 * contract: state is fully controlled by the caller (NoThanksGame, which owns
 * the Supabase Realtime sync); this component only ever emits intent via
 * `onAction`, never mutates state itself. Every client holds the FULL state
 * (every seat's private chip count) in memory — this component only ever
 * *renders* the viewer's own chip count as a number and every other seat's
 * as "?". Acquired cards are NOT secret in No Thanks (the rulebook requires
 * them face-up in front of their owner), so those are always shown for real.
 * See engine.ts and README for the accepted trust trade-off.
 */
export interface NoThanksBoardProps {
  state: NoThanksState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

// A felt-green "auction table" panel — distinct from the other games' navy /
// wood / purple boards, fitting No Thanks's casino-chip theme.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/50 bg-gradient-to-b from-[#123326] via-[#0d251c] to-[#071310] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

function TableTexture() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.05]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 1px, transparent 1px, transparent 10px)",
      }}
    />
  );
}

/** One consecutive run rendered as a single fused pill — only the smallest (leftmost) number counts, the rest are visually "cancelled". */
function CardGroupBadge({ group, size = "sm" }: { group: ScoreGroup; size?: "sm" | "lg" }) {
  const cell = size === "lg" ? "h-11 w-11 text-sm" : "h-8 w-8 text-xs";
  return (
    <div className="flex overflow-hidden rounded-lg border border-emerald-400/40 bg-black/30 shadow-sm">
      {group.cards.map((card, i) => (
        <div
          key={card}
          className={`flex items-center justify-center font-bold ${cell} ${
            i === 0 ? "bg-emerald-500/30 text-emerald-100" : "bg-white/5 text-white/30 line-through decoration-white/25"
          } ${i > 0 ? "border-l border-dashed border-white/10" : ""}`}
          title={i === 0 ? `${card}점 벌점` : `${card} — 연속이라 상쇄됨`}
        >
          {card}
        </div>
      ))}
    </div>
  );
}

// Largest possible `cardsRemaining` value, i.e. right after `startGame`
// (24 cards enter play once the 9 removed cards are set aside, one of which
// is immediately flipped as the first auction card) — used only to scale the
// deck-stack visual below, not part of any rules calculation.
const MAX_CARDS_IN_PLAY = CARD_MAX - CARD_MIN + 1 - REMOVE_COUNT;

/**
 * The face-down draw pile sitting next to the flipped auction card. Purely
 * decorative (the real numbers live in `NoThanksState.deck`/`currentCard`),
 * but built to visibly thin out as `count` drops — a handful of stacked
 * layers fanned by a small offset, capped low so it never grows unwieldy,
 * collapsing to an empty dashed slot once the deck is exhausted.
 */
function DeckStack({ count }: { count: number }) {
  if (count <= 0) {
    return (
      <div className="flex h-28 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-white/15 text-[10px] text-white/25 sm:h-36 sm:w-20">
        빈 덱
      </div>
    );
  }

  const ratio = Math.min(1, count / MAX_CARDS_IN_PLAY);
  const layers = Math.max(1, Math.round(ratio * 5)); // 1-5 fanned layers

  return (
    <div className="relative h-28 w-16 sm:h-36 sm:w-20">
      {Array.from({ length: layers }, (_, i) => {
        const depth = layers - 1 - i; // 0 = frontmost layer (top of the pile)
        return (
          <div
            key={i}
            aria-hidden
            className="absolute inset-0 rounded-2xl border-2 border-white/20 bg-gradient-to-br from-slate-600 to-slate-800"
            style={{
              transform: `translate(${-depth * 2.5}px, ${-depth * 2.5}px)`,
              zIndex: i,
              boxShadow: depth === 0 ? "0 4px 10px rgba(0,0,0,0.5)" : undefined,
            }}
          />
        );
      })}
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <div className="h-6 w-6 rotate-45 rounded-sm border-2 border-white/15 sm:h-8 sm:w-8" />
      </div>
      <div
        title="아직 뒤집히지 않은 덱 카드 수 (공개된 경매 카드는 제외)"
        className="absolute -bottom-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/25 bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white shadow"
      >
        덱 {count}장
      </div>
    </div>
  );
}

export default function NoThanksBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: NoThanksBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const publicMode = state.chipVisibility === "public";

  // Local-only, per-viewer practice/debug toggle — only meaningful in
  // "secret" mode, where the rulebook keeps everyone else's chip count
  // hidden by default (see the component-level doc comment). Nothing about
  // the trust model in this project stops a player from *choosing* to
  // reveal it to themselves for a friendlier practice round regardless of
  // the host's chosen mode. Persisted like the other UI toggles in this
  // codebase (e.g. the sound engine's mute flag), not synced to other
  // clients — in "public" mode the host's choice already reveals every
  // chip count to everyone, so this toggle is hidden rather than shown as
  // redundant.
  const [revealOpponentChips, setRevealOpponentChips] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(REVEAL_CHIPS_STORAGE_KEY) === "1";
  });
  function toggleRevealOpponentChips() {
    setRevealOpponentChips((prev) => {
      const next = !prev;
      window.localStorage.setItem(REVEAL_CHIPS_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // Auction effects (coin toss / card+chip collect) — see AuctionEffects.tsx.
  // `state` is fully controlled by the caller, so the only way to notice
  // "a pass or a take just happened" is to diff consecutive snapshots; this
  // follows the same render-time "adjust state when a prop changes" pattern
  // used elsewhere in this project's boards (e.g. AvalonBoard's role-modal
  // reset) rather than a `useEffect` with `setState` inside it.
  // -------------------------------------------------------------------------
  const [trackedState, setTrackedState] = useState(state);
  const [effects, setEffects] = useState<AnimEvent[]>([]);
  if (trackedState !== state) {
    const detected = detectAuctionEvent(trackedState, state);
    setTrackedState(state);
    if (detected) {
      setEffects((prev) => [...prev, { ...detected, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    }
  }
  const handleEffectDone = useCallback((id: number) => {
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const centerCardRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef(new Map<SeatIndex, HTMLDivElement>());
  function setSeatRef(seat: SeatIndex) {
    return (el: HTMLDivElement | null) => {
      if (el) seatRefs.current.set(seat, el);
      else seatRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 노땡스 룰북
    </button>
  );

  const revealChipsButton = (
    <button
      onClick={toggleRevealOpponentChips}
      title="연습/디버그용: 상대방의 칩 개수를 나에게만 숫자로 보여줍니다 (원작 규칙은 비공개, 다른 사람 화면엔 영향 없음)"
      className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
        revealOpponentChips
          ? "border-amber-300/60 bg-amber-400/10 text-amber-200"
          : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
      }`}
    >
      {revealOpponentChips ? "👁️ 상대 칩 공개 중" : "🙈 상대 칩 비공개"}
    </button>
  );

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-5 p-4 text-center sm:p-8`}>
        <TableTexture />
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100">
          {names[rankings[0].seat]}
          {rankings.filter((r) => r.rank === 1).length > 1 ? " 외 공동 1위!" : "님 승리!"}
        </h2>
        <p className="relative z-10 text-xs text-white/50">벌점이 가장 낮은 사람이 이기는 게임입니다.</p>

        <div className="relative z-10 w-full overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">보유 카드 (그룹화)</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">카드 벌점</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">칩</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">최종 점수</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, score }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">
                    {rank === 1 ? "🏆 1" : rank}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left">
                    {score.groups.length === 0 ? (
                      <span className="text-white/30">없음</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {score.groups.map((g) => (
                          <CardGroupBadge key={g.cards[0]} group={g} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-rose-300">−{score.cardPenalty}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-emerald-300">+{score.chips}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-bold text-white">{score.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------
  const isMyTurn = state.activeSeat === viewerSeat;
  const me = state.players[viewerSeat];
  const cardsRemaining = state.deck.length + (state.currentCard !== null ? 1 : 0);
  const canPass = isMyTurn && me.chips > 0;

  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
      <TableTexture />
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-1.5 text-xs text-emerald-100/60">
        <span className="flex items-center gap-1.5">
          {state.playerCount}인 · 남은 카드 {cardsRemaining}장
          <span
            title={publicMode ? "공개 모드: 모두의 칩이 항상 공개됩니다" : "비밀 모드: 각자 자기 칩만 볼 수 있습니다"}
            className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
              publicMode ? "border-amber-300/40 text-amber-200" : "border-white/15 text-white/40"
            }`}
          >
            {publicMode ? "👁️ 공개 모드" : "🔒 비밀 모드"}
          </span>
        </span>
        <div className="flex gap-1.5">
          {!publicMode && revealChipsButton}
          {rulebookButton}
        </div>
      </div>

      {/* Central auction area */}
      <div className="relative z-10 flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-6">
        <p className={`text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
          {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
        </p>

        <div className="flex items-center gap-4 sm:gap-6">
          <DeckStack count={state.deck.length} />
          <div
            ref={centerCardRef}
            className="relative flex h-28 w-20 items-center justify-center rounded-2xl border-2 border-white/20 bg-gradient-to-b from-white to-neutral-200 text-4xl font-black text-neutral-900 shadow-lg sm:h-36 sm:w-24 sm:text-5xl"
          >
            {state.currentCard}
            {state.chipsOnCard > 0 && (
              <div className="absolute -bottom-3 flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-500/90 px-2.5 py-1 text-xs font-bold text-black shadow">
                🪙 {state.chipsOnCard}
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex w-full max-w-xs gap-2">
          <button
            disabled={!canPass}
            onClick={() => onAction({ type: "pass", seat: viewerSeat })}
            className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            🙅 노 땡스! (칩 1개)
          </button>
          <button
            disabled={!isMyTurn}
            onClick={() => onAction({ type: "take", seat: viewerSeat })}
            className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            ✅ 가져오기
          </button>
        </div>
        {isMyTurn && me.chips === 0 && (
          <p className="text-[11px] text-amber-300/80">칩이 없어서 무조건 가져와야 해요!</p>
        )}
      </div>

      {/* Player strip */}
      <div className="relative z-10 flex flex-col gap-2">
        {seatOrder.map((seat) => {
          const player = state.players[seat];
          const isSelf = seat === viewerSeat;
          const isActive = state.activeSeat === seat;
          const groups = computeGroups(player.cards);
          const chipsVisible = isSelf || publicMode || revealOpponentChips;
          return (
            <div
              key={seat}
              ref={setSeatRef(seat)}
              className={`flex flex-col gap-1.5 rounded-xl border p-2.5 transition ${
                isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-white/90">
                  <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                  {isActive && <span title="차례">👉</span>}
                  {names[seat]}
                  {isSelf && <span className="text-amber-200">(나)</span>}
                </span>
                <span className={`flex items-center gap-1 font-bold ${chipsVisible ? "text-amber-200" : "text-white/30"}`}>
                  🪙 {chipsVisible ? player.chips : "?"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {groups.length === 0 ? (
                  <span className="text-[11px] text-white/25">아직 가져온 카드 없음</span>
                ) : (
                  groups.map((g) => <CardGroupBadge key={g.cards[0]} group={g} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {effects.map((effect) => (
        <FlyingToken
          key={effect.id}
          event={effect}
          getSourceEl={() => (effect.kind === "pass" ? (seatRefs.current.get(effect.seat) ?? null) : centerCardRef.current)}
          getTargetEl={() => (effect.kind === "pass" ? centerCardRef.current : (seatRefs.current.get(effect.seat) ?? null))}
          onDone={handleEffectDone}
        />
      ))}
    </div>
  );
}
