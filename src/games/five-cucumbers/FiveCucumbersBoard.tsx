"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import RulebookModal from "./RulebookModal";
import { CucumberCluster, CucumberIcon } from "./CucumberIcon";
import {
  buildCucumberPickupEvents,
  detectCardPlayEvent,
  FlyingCucumber,
  FlyingPlayedCard,
  type CardPlayEvent,
  type CucumberPickupEvent,
} from "./CardEffects";
import {
  computeRankings,
  cucumberCount,
  FINAL_TRICK_NUMBER,
  legalCardIds,
  TRICKS_PER_ROUND,
  type Card,
  type EngineAction,
  type FiveCucumbersState,
  type PlayedCard,
  type RoundSummary,
  type SeatIndex,
  type TrickResult,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's hand) per
 * this project's lockstep trust model, but a player's hand is meant to stay
 * secret from *opponents* by the physical rules — enforced here only:
 * `HandStrip` renders the viewer's own hand face-up but every other seat's
 * hand as a face-down count (see engine.ts's module doc).
 */
export interface FiveCucumbersBoardProps {
  state: FiveCucumbersState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

/**
 * Card size, shared by the hand and the trick area so a card reads as the
 * "same physical object" wherever it appears — bumped up from the original
 * h-24 w-16 (task brief: cards read as too small) while keeping the real
 * card's ~5:7 index-card ratio (`오이카드구성.jpg`).
 */
const CARD_SIZE_CLASSES = "h-28 w-20 sm:h-36 sm:w-24 lg:h-40 lg:w-28";

/**
 * Danger-tier accent (0-5 cucumbers) — the real card art doesn't color-code
 * this, but surfacing it as a glow/ring around an otherwise-authentic green
 * card face is a legibility aid worth keeping (higher trick-7 risk = hotter
 * ring), same idea as the previous fully-recolored background just toned
 * down to a border/glow instead of replacing the base card color.
 */
const CUCUMBER_TIER_RING: Record<number, string> = {
  0: "shadow-[0_10px_22px_-12px_rgba(0,0,0,0.7)]",
  1: "shadow-[0_10px_22px_-12px_rgba(0,0,0,0.7)]",
  2: "shadow-[0_0_0_2px_rgba(251,191,36,0.35),0_10px_22px_-12px_rgba(0,0,0,0.7)]",
  3: "shadow-[0_0_0_2px_rgba(251,146,60,0.45),0_10px_22px_-12px_rgba(0,0,0,0.7)]",
  4: "shadow-[0_0_0_2px_rgba(251,113,133,0.5),0_10px_22px_-12px_rgba(0,0,0,0.7)]",
  5: "shadow-[0_0_0_3px_rgba(244,63,94,0.65),0_10px_22px_-12px_rgba(0,0,0,0.75)]",
};

/** Mottled light-green card stock, layered radial highlights over a green base — matches the real card art's watercolor swirl (`오이카드구성.jpg`) without an external image asset (same convention as CucumberIcon.tsx). */
const CARD_STOCK_BG =
  "radial-gradient(circle at 26% 18%, rgba(255,255,255,0.55) 0%, transparent 45%)," +
  "radial-gradient(circle at 78% 72%, rgba(255,255,255,0.35) 0%, transparent 42%)," +
  "radial-gradient(circle at 60% 15%, rgba(255,255,255,0.3) 0%, transparent 38%)," +
  "radial-gradient(circle at 50% 55%, #bfdd8c 0%, #a4cf6c 55%, #8bbd52 100%)";

/**
 * One playing card, styled to match the real "Five Cucumbers" card stock:
 * white index-card border, mottled green face, a corner index top-left and
 * a mirrored (180°-rotated) index bottom-right so it reads right-side-up
 * from either side of the table, and a scattered cucumber pile centered on
 * the face (task brief §1). Card 1 additionally carries the "×2" bomb badge
 * from the real card art — it's the only card with 0 cucumbers of its own
 * but doubles whoever wins the trick's penalty (see engine.ts).
 */
function CardFace({ card, className = "" }: { card: Card; className?: string }) {
  const cucumbers = cucumberCount(card.value);
  return (
    <div
      className={`relative shrink-0 rounded-xl border-[3px] p-1 ${CARD_SIZE_CLASSES} ${CUCUMBER_TIER_RING[cucumbers]} ${className}`}
      style={{ background: CARD_STOCK_BG, borderColor: "#f6fadf" }}
    >
      <span className="absolute top-1 left-1.5 text-sm leading-none font-black text-[#213409] sm:text-base">{card.value}</span>
      <span className="absolute right-1.5 bottom-1 rotate-180 text-sm leading-none font-black text-[#213409] sm:text-base">
        {card.value}
      </span>
      {card.value === 1 && (
        // Kept in the top-LEFT quadrant (beside its own index, not the trailing
        // edge) so it stays attached to card 1 even when a fanned hand's next
        // card overlaps this card's right side — see task brief §1's "1번은
        // 오이 2배 폭탄" badge from the real card art.
        <span className="absolute top-6 left-1.5 rotate-[-6deg] text-[9px] font-black text-red-600 sm:top-7 sm:text-[11px]">×2</span>
      )}
      <CucumberCluster count={cucumbers} className="py-3" />
    </div>
  );
}

function TrickSlot({
  play,
  label,
  isMe,
  slotRef,
}: {
  play?: PlayedCard;
  label: string;
  isMe: boolean;
  /** Landing spot for `FlyingPlayedCard` — see FiveCucumbersBoard's `trickSlotRefs`. */
  slotRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[10px] font-semibold ${isMe ? "text-amber-200" : "text-white/50"}`}>{label}</span>
      {play ? (
        <div ref={slotRef}>
          <CardFace card={play.card} />
        </div>
      ) : (
        <div className={`flex items-center justify-center rounded-xl border border-dashed border-white/10 ${CARD_SIZE_CLASSES}`} />
      )}
    </div>
  );
}

/** Slight arc + overlap so a hand of cards reads like it's fanned out by hand, not stacked in a grid — same technique as hanamikoji/HanamikojiBoard.tsx's `fanStyle`. */
function fanStyle(index: number, total: number, overlapPx: number): CSSProperties {
  if (total <= 1) return { zIndex: index };
  const mid = (total - 1) / 2;
  const offset = index - mid;
  return {
    transform: `rotate(${offset * 5}deg) translateY(${Math.abs(offset) * 6}px)`,
    marginLeft: index === 0 ? 0 : -overlapPx,
    zIndex: index,
  };
}

export default function FiveCucumbersBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: FiveCucumbersBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  // Whenever `state` changes, notice freshly-resolved tricks/rounds and flash
  // a transient banner about them — same "diff consecutive snapshots on
  // render" pattern NoThanksBoard/SplendorBoard use, since this component
  // never mutates state itself and the caller owns the network sync. The
  // same diff also drives the card-play FX (task brief §3) and queues up
  // sequential cucumber-pickup FX (task brief §4) the instant the 7th
  // trick's penalty settles — see CardEffects.tsx.
  const [trackedState, setTrackedState] = useState(state);
  const [trickFlash, setTrickFlash] = useState<TrickResult | null>(null);
  const [roundFlash, setRoundFlash] = useState<RoundSummary | null>(null);
  const [cardFlyEvents, setCardFlyEvents] = useState<CardPlayEvent[]>([]);
  const [cucumberEvents, setCucumberEvents] = useState<CucumberPickupEvent[]>([]);
  if (trackedState !== state) {
    const newTrick = state.lastTrickResult !== trackedState.lastTrickResult ? state.lastTrickResult : null;
    const newRound = state.lastRoundSummary !== trackedState.lastRoundSummary ? state.lastRoundSummary : null;
    const cardPlay = detectCardPlayEvent(trackedState, state);
    setTrackedState(state);
    if (newTrick) setTrickFlash(newTrick);
    if (newRound) {
      setRoundFlash(newRound);
      if (newRound.cucumberPenaltyEach > 0) {
        setCucumberEvents((prev) => {
          let nextId = (prev.at(-1)?.id ?? 0) + 1;
          const created = buildCucumberPickupEvents(newRound.winnerSeats, newRound.cucumberPenaltyEach, () => nextId++);
          return [...prev, ...created];
        });
      }
    }
    if (cardPlay) {
      setCardFlyEvents((prev) => [...prev, { ...cardPlay, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    }
  }
  useEffect(() => {
    if (!trickFlash && !roundFlash) return;
    const t = setTimeout(() => {
      setTrickFlash(null);
      setRoundFlash(null);
    }, 3600);
    return () => clearTimeout(t);
  }, [trickFlash, roundFlash]);
  const handleCardFlyDone = useCallback((id: number) => {
    setCardFlyEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const handleCucumberDone = useCallback((id: number) => {
    setCucumberEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Landing/launch spots for the FX above — persistent refs keyed by seat
  // (scoreboard row + cucumber badge) plus the trick area container and the
  // viewer's own hand section, same `Map`-of-refs technique NoThanksBoard's
  // `seatRefs` uses.
  const seatRowRefs = useRef(new Map<SeatIndex, HTMLElement>());
  const cucumberBadgeRefs = useRef(new Map<SeatIndex, HTMLElement>());
  const trickSlotRefs = useRef(new Map<SeatIndex, HTMLElement>());
  const trickAreaRef = useRef<HTMLElement | null>(null);
  const handSectionRef = useRef<HTMLElement | null>(null);
  function setSeatRowRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) seatRowRefs.current.set(seat, el);
      else seatRowRefs.current.delete(seat);
    };
  }
  function setCucumberBadgeRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) cucumberBadgeRefs.current.set(seat, el);
      else cucumberBadgeRefs.current.delete(seat);
    };
  }
  function setTrickSlotRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) trickSlotRefs.current.set(seat, el);
      else trickSlotRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 오이 다섯 개 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    const tied = rankings.filter((r) => r.rank === 1).length > 1;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#132a1c 0%,#0d1e14 55%,#070f0a 100%)" }}
      >
        <span className="text-5xl">{tied ? "🥒" : "🏆"}</span>
        <h2 className="text-2xl font-bold text-emerald-100">
          {tied ? "공동 최후 생존!" : `${names[winner.seat]}님 최후 생존 승리!`}
        </h2>
        <p className="text-xs text-white/50">오이를 가장 적게 먹고 가장 오래 살아남은 사람이 이기는 게임입니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">최종 오이</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">생존</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, cucumbers, eliminatedAtRound }) => (
                <tr key={seat} className={rank === 1 ? "bg-emerald-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-emerald-200">{rank === 1 ? "🏆 1" : rank}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-emerald-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">
                    <span className="inline-flex items-center gap-1 text-rose-200">
                      <CucumberIcon className="h-3.5 w-3.5" /> {cucumbers}
                    </span>
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-white/60">
                    {eliminatedAtRound === null ? "끝까지 생존" : `${eliminatedAtRound}라운드까지`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400">
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.activeSeat === viewerSeat && !me.eliminated;
  const legal = legalCardIds(state, viewerSeat);
  const isFinalTrick = state.trickNumber === FINAL_TRICK_NUMBER;
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  function playCard(cardId: string) {
    if (!isMyTurn || !legal.has(cardId)) return;
    onAction({ type: "playCard", seat: viewerSeat, cardId });
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#0f2418 0%,#0a1710 45%,#050b07 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-emerald-100/70">
        <span className="flex items-center gap-1.5">
          {state.playerCount}인 · 라운드 {state.roundNumber} · 트릭 {state.trickNumber}/{TRICKS_PER_ROUND}
          <span
            title="이 개수 이상 오이를 먹으면 탈락합니다"
            className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50"
          >
            탈락 기준 🥒{state.eliminationThreshold}개
          </span>
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      {isFinalTrick && (
        <p className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1.5 text-center text-[11px] font-semibold text-rose-200">
          ⚠️ 마지막 7번째 트릭입니다 — 여기서 이기면 오이를 먹습니다!
        </p>
      )}

      {(trickFlash || roundFlash) && (
        <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-center text-xs">
          {roundFlash ? (
            <>
              <p className="font-semibold text-rose-200">
                🥒 {roundFlash.winnerSeats.map((s) => names[s]).join(", ")}님이 마지막 트릭에서 오이 {roundFlash.cucumberPenaltyEach}개 획득
                {roundFlash.onesCount > 0 && ` (1번 카드 ${roundFlash.onesCount}장 → ×${2 ** roundFlash.onesCount} 배수)`}
              </p>
              {roundFlash.newlyEliminatedSeats.length > 0 && (
                <p className="mt-0.5 text-rose-300">💀 {roundFlash.newlyEliminatedSeats.map((s) => names[s]).join(", ")}님 탈락!</p>
              )}
            </>
          ) : (
            trickFlash && (
              <p className="text-white/70">
                {names[trickFlash.winnerSeats[0]]}님이 트릭 {trickFlash.trickNumber}을 가져가 다음 리드가 됩니다.
              </p>
            )
          )}
        </div>
      )}

      <p className={`text-center text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
        {me.eliminated
          ? "탈락했습니다 — 남은 라운드를 구경하는 중..."
          : isMyTurn
            ? state.trickPlays.length === 0
              ? "🫵 당신 차례입니다! 트릭을 리드할 카드를 아무거나 내세요."
              : "🫵 당신 차례입니다! 현재 최댓값 이상이거나, 손패 중 가장 낮은 카드만 낼 수 있어요."
            : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      {/* Current trick */}
      <section ref={trickAreaRef} className="flex flex-wrap items-start justify-center gap-2.5 rounded-2xl border border-white/10 bg-black/25 p-3">
        {state.trickPlays.length === 0 ? (
          <p className="py-6 text-xs text-white/30">아직 아무도 카드를 내지 않았어요.</p>
        ) : (
          state.trickPlays.map((play, i) => (
            <TrickSlot
              key={play.seat}
              play={play}
              label={`${i + 1}. ${names[play.seat]}`}
              isMe={play.seat === viewerSeat}
              slotRef={setTrickSlotRef(play.seat)}
            />
          ))
        )}
      </section>

      {/* Scoreboard */}
      <section className="flex flex-col gap-1.5">
        {seatOrder.map((seat) => {
          const p = state.players.find((pl) => pl.seat === seat)!;
          const isActive = state.activeSeat === seat && !p.eliminated;
          const isSelf = seat === viewerSeat;
          return (
            <div
              key={seat}
              ref={setSeatRowRef(seat)}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                p.eliminated
                  ? "border-white/5 bg-black/10 opacity-50"
                  : isActive
                    ? "border-amber-300/60 bg-amber-400/10"
                    : "border-white/10 bg-black/20"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white/90">
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                {names[seat]}
                {isSelf && <span className="text-amber-200">(나)</span>}
                {p.eliminated && <span className="text-rose-300">💀 탈락</span>}
              </span>
              <div className="flex items-center gap-3 text-white/70">
                <span title="남은 손패 수">🂠 {p.hand.length}장</span>
                <span
                  ref={setCucumberBadgeRef(seat)}
                  title={`오이 ${p.cucumbers} / ${state.eliminationThreshold}개`}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${
                    p.cucumbers >= state.eliminationThreshold
                      ? "border-rose-400/60 text-rose-300"
                      : p.cucumbers > 0
                        ? "border-amber-300/40 text-amber-200"
                        : "border-white/15 text-white/50"
                  }`}
                >
                  <CucumberIcon className="h-3.5 w-3.5" /> {p.cucumbers} / {state.eliminationThreshold}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* My hand */}
      <section
        ref={handSectionRef}
        className="rounded-2xl border border-emerald-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#173322 0%,#0f2116 55%,#081108 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-emerald-200/90 uppercase">🃏 내 손패 ({me.hand.length}장)</h3>
        {me.hand.length === 0 ? (
          <p className="text-xs text-white/30">손패가 없습니다.</p>
        ) : (
          // Fanned overlap (task brief §2) instead of a wrapping grid — up to
          // 7 cards at round start still fit a phone-width hand at the
          // bigger card size, and each card pops forward on hover/tap.
          <div className="flex flex-wrap justify-center pt-3 sm:pt-4">
            {me.hand.map((c, i) => {
              const isLegal = isMyTurn && legal.has(c.id);
              return (
                <div key={c.id} className="relative" style={fanStyle(i, me.hand.length, 42)}>
                  <button
                    disabled={!isLegal}
                    onClick={() => playCard(c.id)}
                    className={`relative block transition ${
                      isLegal ? "cursor-pointer hover:z-30 hover:-translate-y-4 hover:scale-105" : "cursor-not-allowed opacity-40"
                    }`}
                  >
                    <CardFace card={c} className={isLegal ? "shadow-[0_0_18px_-2px_rgba(251,191,36,0.9)] ring-2 ring-amber-300/80" : ""} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* Card-play FX (task brief §3): hand/seat -> central trick area. */}
      {cardFlyEvents.map((event) => (
        <FlyingPlayedCard
          key={event.id}
          event={event}
          getSourceEl={() => (event.seat === viewerSeat ? handSectionRef.current : (seatRowRefs.current.get(event.seat) ?? null))}
          getTargetEl={() => trickSlotRefs.current.get(event.seat) ?? trickAreaRef.current}
          onDone={handleCardFlyDone}
        />
      ))}

      {/* Sequential cucumber-pickup FX (task brief §4): trick area -> winner's scoreboard badge, one token at a time. */}
      {cucumberEvents.map((event) => (
        <FlyingCucumber
          key={event.id}
          event={event}
          getSourceEl={() => trickAreaRef.current}
          getTargetEl={() => cucumberBadgeRefs.current.get(event.seat) ?? seatRowRefs.current.get(event.seat) ?? null}
          onDone={handleCucumberDone}
        />
      ))}
    </div>
  );
}
