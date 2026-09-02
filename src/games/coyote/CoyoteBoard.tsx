"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import RulebookModal from "./RulebookModal";
import { CardFace, HeartPips } from "./CardArt";
import {
  CardFlipWrapper,
  CoyoteHowlBanner,
  detectCoyoteCallEvent,
  QuestionCardFlyGhost,
  questionCardSeat,
  QUESTION_FLY_MS,
  QUESTION_PULSE_CLASS,
  QUESTION_PULSE_MS,
  REVEAL_HOLD_MS,
} from "./CoyoteEffects";
import { computeRankings, getPlayerView, STARTING_HEARTS, type Card, type CoyoteState, type EngineAction, type SeatIndex } from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's forehead
 * card) per this project's lockstep trust model; the "이마 카드" secrecy is
 * enforced only here, purely at render time, via `getPlayerView` (see
 * engine.ts's module doc).
 */
export interface CoyoteBoardProps {
  state: CoyoteState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * Position of a seat around the round table, relative to the viewer always
 * sitting at the bottom — same technique as avalon/AvalonBoard.tsx's
 * `seatPosition`. At 7-8 players the ellipse widens slightly (45/41 vs
 * 42/38) so the extra seats' cards spread further from the center instead of
 * crowding closer together at the same radius — paired with the taller/wider
 * table container and the smaller "xs" card size below (CoyoteBoard's
 * `compact` branch) per product decision to keep a single ellipse rather than
 * an inner/outer double-ring layout.
 */
function seatPosition(relativeIndex: number, total: number): CSSProperties {
  const angleDeg = 90 + (relativeIndex / total) * 360;
  const angleRad = (angleDeg * Math.PI) / 180;
  const compact = total > 6;
  const radiusX = compact ? 45 : 42;
  const radiusY = compact ? 41 : 38;
  const x = 50 + radiusX * Math.cos(angleRad);
  const y = 50 + radiusY * Math.sin(angleRad);
  return { left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" };
}

export default function CoyoteBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: CoyoteBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  // Same "diff consecutive lockstep snapshots on render" pattern every other
  // Board in this project uses to drive purely cosmetic flourishes — see
  // CoyoteEffects.tsx's module doc.
  const [trackedState, setTrackedState] = useState(state);
  const [howl, setHowl] = useState<{ callerName: string } | null>(null);
  if (trackedState !== state) {
    if (detectCoyoteCallEvent(trackedState, state) && state.lastResolution) {
      setHowl({ callerName: names[state.lastResolution.callerSeat] });
    }
    setTrackedState(state);
  }

  // The declare-number stepper resets to "one more than the current bid"
  // every time it becomes a fresh decision point (a new active seat or a
  // new bid to beat) — adjusted directly during render (React's recommended
  // "state adjustment" pattern), same as dalmuti's selection-reset.
  const turnKey = `${state.activeSeat}-${state.currentBid?.number ?? "none"}-${state.roundNumber}-${state.phase}`;
  const [trackedTurnKey, setTrackedTurnKey] = useState(turnKey);
  const [declareValue, setDeclareValue] = useState((state.currentBid?.number ?? 0) + 1);
  if (trackedTurnKey !== turnKey) {
    setTrackedTurnKey(turnKey);
    setDeclareValue((state.currentBid?.number ?? 0) + 1);
  }

  // -------------------------------------------------------------------
  // Reveal/showdown sequencing (2026-09-03) — "?" 카드 치환(펄스→비행→
  // 3D플립) + 판정 패널 전체의 3초 최소 유지/스킵. `res` (state.lastResolution)
  // identity가 바뀔 때만(=새 "코요테!" 호출마다) 재시작된다 — `howl` 위에서
  // 쓰는 것과 동일한 "연속 스냅샷 diff" 기법.
  // -------------------------------------------------------------------
  const res = state.lastResolution;
  const qSeat = res ? questionCardSeat(res) : null;

  const [trackedRes, setTrackedRes] = useState(res);
  const [questionStage, setQuestionStage] = useState<"pulse" | "flying" | "flipped">("pulse");
  const [revealSettled, setRevealSettled] = useState(false);
  const [countingActive, setCountingActive] = useState(false);
  const [displayedTotal, setDisplayedTotal] = useState(0);
  const skippedRef = useRef(false);
  if (trackedRes !== res) {
    setTrackedRes(res);
    setQuestionStage("pulse");
    setRevealSettled(false);
    setDisplayedTotal(0);
    setCountingActive(!res || questionCardSeat(res) === null); // no "?" card in this round -> count up right away
  }

  // Stage timers: pulse -> fly -> flipped (only when a "?" card is in play),
  // plus the unified REVEAL_HOLD_MS minimum before "다음 라운드" unlocks.
  // Also owns resetting `skippedRef` for the new resolution (a ref write
  // belongs in an effect/handler, never directly in the render body).
  useEffect(() => {
    skippedRef.current = false;
    if (!res || state.phase === "playing") return;
    const timers: number[] = [];
    if (questionCardSeat(res) !== null) {
      timers.push(window.setTimeout(() => setQuestionStage("flying"), QUESTION_PULSE_MS));
      timers.push(
        window.setTimeout(() => {
          setQuestionStage("flipped");
          setCountingActive(true);
        }, QUESTION_PULSE_MS + QUESTION_FLY_MS),
      );
    }
    timers.push(window.setTimeout(() => setRevealSettled(true), REVEAL_HOLD_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `res` identity only, restarts exactly once per new "코요테!" call
  }, [res]);

  // "실제 총합" count-up, 0 -> res.finalTotal over ~550ms once `countingActive`
  // flips true (either immediately, or synced to the "?" card's flip settling).
  useEffect(() => {
    if (!countingActive || !res) return;
    if (skippedRef.current) {
      setDisplayedTotal(res.finalTotal);
      return;
    }
    const target = res.finalTotal;
    const durationMs = 550;
    const start = performance.now();
    let raf = 0;
    function tick(now: number) {
      if (skippedRef.current) {
        setDisplayedTotal(target);
        return;
      }
      const t = Math.min(1, (now - start) / durationMs);
      setDisplayedTotal(Math.round(target * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [countingActive, res]);

  /** "⏩ 스킵" — 애니메이션을 기다리지 않고 즉시 "?" 치환/합산 완료 화면으로 전환. */
  function handleSkipReveal() {
    if (revealSettled) return;
    skippedRef.current = true;
    setQuestionStage("flipped");
    setCountingActive(true);
    if (res) setDisplayedTotal(res.finalTotal);
    setRevealSettled(true);
  }

  const seatRefs = useRef(new Map<SeatIndex, HTMLElement>());
  function setSeatRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) seatRefs.current.set(seat, el);
      else seatRefs.current.delete(seat);
    };
  }
  const tableCenterRef = useRef<HTMLDivElement | null>(null);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 코요테 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#2e1a0d 0%,#1a0f08 55%,#0a0704 100%)" }}
      >
        <span className="text-5xl">🐺</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[winner.seat]}님이 최후까지 살아남아 승리했습니다!</h2>
        <p className="text-xs text-white/50">하트를 모두 잃은 다른 플레이어들은 탈락했습니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[360px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">남은 하트</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => {
                const player = state.players.find((p) => p.seat === seat)!;
                return (
                  <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "🐺 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      {names[seat]}
                      {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-left">
                      <HeartPips hearts={player.hearts} max={STARTING_HEARTS} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400">
          결과 확정하고 계속하기
        </button>
        {howl && <CoyoteHowlBanner callerName={howl.callerName} onDone={() => setHowl(null)} />}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing / reveal
  // ---------------------------------------------------------------------
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => (viewerSeat + i) % state.playerCount);
  const otherSeats = seatOrder.slice(1);
  const view = getPlayerView(state, viewerSeat);
  const cardBySeat = new Map(view.map((v) => [v.seat, v.card]));
  const revealed = state.phase !== "playing";
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const minDeclare = (state.currentBid?.number ?? -Infinity) + 1;
  const canDeclare = isMyTurn && Number.isInteger(declareValue) && declareValue > (state.currentBid?.number ?? -Infinity);
  const canCoyote = isMyTurn && state.currentBid !== null;
  // 7-8인일 때만 카드/이름표를 한 단계 줄여 타원 위 겹침을 방지 — 레이아웃 방식(단일 타원 유지)은
  // 그대로 두고 크기/간격만 반응형으로 축소하는 쪽으로 제품 확정.
  const compact = state.playerCount > 6;

  function renderSeat(seat: SeatIndex, style: CSSProperties, isSelf: boolean) {
    const player = state.players.find((p) => p.seat === seat)!;
    const isActive = state.phase === "playing" && state.activeSeat === seat;

    // "?" 치환 연출 대상 좌석이면 스테이지에 따라 표시 카드를 바꿔치기한다
    // (엔진 state는 그대로 — 순수 표시 레이어 오버라이드). pulse/flying 단계는
    // 원래 "?" 카드를 그대로 보여주고(스테이지 1 펄스 글로우만 덧씌움),
    // flipped 단계부터 실제로 뽑힌 카드(res.extraDrawnCards[0])로 바뀐다.
    const isQuestionSeat = revealed && res && seat === qSeat;
    const showReplacedCard = isQuestionSeat && questionStage === "flipped";
    const card: Card | null = showReplacedCard ? (res!.extraDrawnCards[0] ?? cardBySeat.get(seat) ?? null) : (cardBySeat.get(seat) ?? null);
    const pulseActive = isQuestionSeat && questionStage !== "flipped";
    const flipKey = showReplacedCard ? `${seat}-${state.roundNumber}-replaced` : `${seat}-${state.roundNumber}-${revealed}`;

    return (
      <div key={seat} ref={setSeatRef(seat)} className="absolute flex flex-col items-center gap-1" style={style}>
        <CardFlipWrapper flipKey={flipKey} revealed={revealed}>
          <div className={pulseActive ? QUESTION_PULSE_CLASS : undefined}>
            <CardFace card={card} highlight={isActive} size={compact ? "xs" : "sm"} />
          </div>
        </CardFlipWrapper>
        <div
          className={`flex flex-col items-center gap-0.5 rounded-xl border text-center ${compact ? "max-w-[70px] px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"} ${
            isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/30"
          }`}
        >
          <span className="flex max-w-full items-center gap-1 truncate font-semibold text-white/90">
            <Avatar size={compact ? 14 : 16} className="shrink-0" />
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
            {isActive && <span title="차례">👉</span>}
            <span className="break-keep truncate">{names[seat]}</span>
            {isSelf && <span className="shrink-0 text-amber-200">(나)</span>}
          </span>
          <HeartPips hearts={player.hearts} max={STARTING_HEARTS} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#3a2410 0%,#20140a 45%,#0d0805 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-orange-100/70">
        <span>
          {state.playerCount}인 · {state.roundNumber}라운드 · 하트 {STARTING_HEARTS}개 모두 잃으면 탈락
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      {/* Round table: every seat's forehead card placed around an ellipse, viewer at the bottom. Widens for 7-8 players (see `compact`) so seatPosition's slightly larger radius has more physical room to spread cards apart. */}
      <div className={`relative z-10 mx-auto w-full ${compact ? "h-[320px] max-w-lg sm:h-[380px]" : "h-[280px] max-w-md sm:h-[320px]"}`}>
        <div ref={tableCenterRef} className="absolute inset-[10%] rounded-[50%] border-4 border-orange-900/50 bg-gradient-to-b from-orange-950/50 to-black/70 shadow-inner" />
        {renderSeat(viewerSeat, seatPosition(0, state.playerCount), true)}
        {otherSeats.map((seat, i) => renderSeat(seat, seatPosition(i + 1, state.playerCount), false))}
        {questionStage === "flying" && qSeat !== null && (
          <QuestionCardFlyGhost getFromEl={() => tableCenterRef.current} getToEl={() => seatRefs.current.get(qSeat) ?? null} />
        )}
      </div>

      {/* Bidding phase */}
      {state.phase === "playing" && (
        <div className="relative z-10 flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-center">
          <p className="text-xs text-orange-100/80">
            {state.currentBid ? (
              <>
                현재 선언: <span className="text-lg font-bold text-amber-300">{state.currentBid.number}</span> ({names[state.currentBid.seat]}
                님)
              </>
            ) : (
              <>아직 선언이 없습니다 — {names[state.activeSeat]}님이 첫 선언을 합니다.</>
            )}
          </p>
          {isMyTurn ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-medium text-amber-200">🫵 당신 차례입니다!</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDeclareValue((n) => Math.max(minDeclare, n - 1))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
                >
                  −
                </button>
                <input
                  type="number"
                  value={declareValue}
                  onChange={(e) => setDeclareValue(Number(e.target.value))}
                  className="w-20 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-center text-lg font-bold text-white focus:border-amber-400 focus:outline-none"
                />
                <button onClick={() => setDeclareValue((n) => n + 1)} className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30">
                  +
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={!canDeclare}
                  onClick={() => onAction({ type: "declare", seat: viewerSeat, number: declareValue })}
                  className="rounded-full bg-amber-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  📢 선언하기
                </button>
                <button
                  disabled={!canCoyote}
                  onClick={() => onAction({ type: "coyote", seat: viewerSeat })}
                  className="rounded-full bg-rose-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  🐺 코요테!
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/50">{names[state.activeSeat]}님의 차례를 기다리는 중...</p>
          )}
        </div>
      )}

      {/* Reveal / showdown — 보드게임허브 공통 규격: 카드 공개("?" 치환 포함)는
          최소 REVEAL_HOLD_MS(3초)간 유지되며, 그동안 "다음 라운드" 대신
          "⏩ 스킵" 버튼만 노출된다(클릭 시 handleSkipReveal이 즉시 최종
          치환/합산 완료 화면으로 전환). */}
      {state.phase === "reveal" && res && (
        <div className="relative z-10 flex flex-col gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-center text-xs">
          <p className="break-keep font-semibold text-rose-200">🐺 {names[res.callerSeat]}님이 &quot;코요테!&quot;를 외쳤습니다</p>
          <p className="break-keep text-white/70">
            직전 선언: <b className="text-amber-300">{res.bid.number}</b> ({names[res.bid.seat]}) · 실제 총합: <b className="text-emerald-300">{displayedTotal}</b>
          </p>
          {res.extraDrawnCards.length > 0 && (
            <p className="break-keep text-white/60">🎁 ? 카드로 {res.extraDrawnCards.length}장 추가 공개됨</p>
          )}
          {res.maxZeroTarget.card && <p className="break-keep text-white/60">👧 최고값 카드({res.maxZeroTarget.card.value})가 0으로 무효화됨</p>}
          {res.doubled && <p className="break-keep text-white/60">🪶 최종 합산이 2배 적용됨</p>}
          {res.nightCardHolderSeat !== null && <p className="break-keep text-white/60">🌙 {names[res.nightCardHolderSeat]}님이 다음 라운드의 선이 됩니다</p>}
          <p className="break-keep font-semibold text-white">
            {res.loserWasBidder
              ? `${names[res.bid.seat]}님이 오버 배팅으로 하트 1개를 잃었습니다.`
              : `${names[res.callerSeat]}님이 잘못된 코요테 외침으로 하트 1개를 잃었습니다.`}
          </p>
          {revealSettled ? (
            <button
              onClick={() => onAction({ type: "continue", seed: randomSeed() })}
              className="mx-auto mt-1 rounded-full bg-amber-500 px-6 py-2 text-xs font-bold text-black transition hover:bg-amber-400"
            >
              ▶️ 다음 라운드
            </button>
          ) : (
            <button
              onClick={handleSkipReveal}
              className="mx-auto mt-1 touch-manipulation rounded-full border border-white/20 bg-black/30 px-6 py-2 text-xs font-bold text-white/80 transition select-none hover:border-white/40 hover:text-white"
            >
              ⏩ 스킵
            </button>
          )}
        </div>
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      {howl && <CoyoteHowlBanner callerName={howl.callerName} onDone={() => setHowl(null)} durationMs={1300} />}
    </div>
  );
}
