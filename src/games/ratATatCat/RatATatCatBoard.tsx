"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import CardFlightEffect, { type CardFlight } from "./CardFlightEffect";
import CardSlot, { CardBack } from "./CardSlot";
import GameOverReveal from "./RatATatCatEffects";
import RatATatCatCallModal from "./RatATatCatCallModal";
import { getValidMoves, SLOTS, type EngineAction, type RatATatCatState, type SeatIndex, type SlotIndex } from "./engine";

/**
 * Controlled component — state comes in via props only, every user action
 * turns into an `EngineAction` handed to `onAction`. No network/betting
 * awareness (ARCHITECTURE.md §2).
 *
 * 2026-08-31 세션에서 추가된 순수 로컬(비-엔진) UI 상태:
 *  - `peekingSlot`/setup 타이머: 엿보기(설정/Peek 특수카드)의 임시 확인 창
 *    (engine.ts docstring point 8 — 더 이상 엔진이 영구 지식을 부여하지
 *    않으므로, "몇 초간 보여주고 다시 숨기는" 연출은 여기서만 관리한다).
 *  - `flights`/`opponentBadges`: 카드 획득/드로우 전역 궤적 이펙트 — 연속된
 *    두 `state` 스냅샷을 비교해 "방금 드로우가 일어났다"/"이번 턴 카드
 *    액션이 막 끝났다"를 감지하고, 덱·버림더미·손패 로우의 실측 좌표
 *    (`getBoundingClientRect`) 사이로 카드 한 장을 날린다.
 *  - `activeCallModal`: "랫어탯켓(콜)" 초대형 연출의 1회성 표시 게이트.
 */
export interface RatATatCatBoardProps {
  state: RatATatCatState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  /** Called once the viewer has acknowledged (or skipped) the game-over reveal. */
  onGameEnd: () => void;
}

/**
 * How long the Peek power card's mid-game temporary reveal stays up before
 * auto-hiding. Originally shared with the setup peek too — both were "고정
 * 3초 자동 + 화면 터치 시 즉시 해제" (AskUserQuestion 2026-08-31). The setup
 * peek has since diverged onto its own `SETUP_PEEK_REVEAL_MS` (see below);
 * this constant now governs the Peek power card only
 * (`peekingSlot`/`dismissPeekReveal`), which keeps its original
 * tap-to-dismiss-early behavior throughout and was never part of any of the
 * setup-peek-specific changes below.
 */
const PEEK_REVEAL_MS = 3000;
/**
 * How long the SETUP peek (slots 0/3 at game start) stays up before
 * auto-hiding — separate from `PEEK_REVEAL_MS` above since AskUserQuestion
 * 2026-09-02 changed setup only into a hard guaranteed minimum with no
 * early-dismiss path at all, so a stray tap/skip could never cut a player's
 * look at their own cards short. **2026-09-04 (AskUserQuestion) partially
 * reversed this**: a player-driven "👁️ 카드 확인하기" button now gates the
 * reveal itself (see `confirmClicked` below — cards no longer flip on their
 * own the instant setup begins), and once the player opts in, an
 * early-dismiss "⏩ 바로 시작 (스킵)" button is offered again, but only after
 * `SKIP_ENABLE_MS` has passed — a compromise between the two prior decisions
 * rather than a full revert (see `setupSkipAvailable` below). **2026-09-04
 * follow-up (user request)** bumped the guaranteed hold itself from 3s to
 * 5s, independent of `SKIP_ENABLE_MS` (still 1s) — a player can still skip
 * from 1s onward, but the un-skipped default wait is now longer.
 */
const SETUP_PEEK_REVEAL_MS = 5000;
/** AskUserQuestion 2026-09-04: minimum forced-visibility before the setup peek's skip button appears — see `SETUP_PEEK_REVEAL_MS`'s docstring. */
const SKIP_ENABLE_MS = 1000;
/** AskUserQuestion 2026-09-04: a player who never taps "카드 확인하기" is auto-confirmed after this long, so an AFK/disconnected human can't stall the whole room at the pre-setup gate forever (bots have their own separate ~1-1.5s auto-ack in RatATatCatGame.tsx and never hit this). */
const SETUP_CONFIRM_TIMEOUT_MS = 15000;
/**
 * 2026-09-04 (user request, "게임시작하고도 3초간 보이게해주세요"): once every
 * seat has confirmed and `state.phase` actually flips from "setup" to
 * "playing", this viewer's own end cards (slots 0/3) get one more automatic
 * — no button, no skip — reveal on the real game board, for this long. Its
 * own fresh timer, independent of how the setup peek itself went for this
 * player (full `SETUP_PEEK_REVEAL_MS` hold, an early skip, or the
 * `SETUP_CONFIRM_TIMEOUT_MS` safety net) — a refresher glance right as real
 * play begins, in case setup finished a while before the slowest seat
 * caught up. See `gameStartPeekActive` below.
 */
const GAME_START_PEEK_MS = 3000;
/** How long an opponent's "드로우 완료"/"카드 정리 완료" badge popup stays visible. */
const OPPONENT_BADGE_MS = 1600;

function seatOrderFrom(viewerSeat: SeatIndex, playerCount: number): SeatIndex[] {
  const order: SeatIndex[] = [];
  for (let i = 1; i < playerCount; i++) order.push((viewerSeat + i) % playerCount);
  return order;
}

/**
 * Small circular progress badge overlaid on a setup-peek card, draining once
 * over the guaranteed `SETUP_PEEK_REVEAL_MS` hold so the player can gauge
 * how much longer their card stays visible. Pure CSS (`ratc-peek-ring-drain`
 * in globals.css) — no per-tick JS re-render. `r=8`/circumference ≈50.27 is
 * hardcoded on both ends; keep them in sync if this radius ever changes.
 */
function PeekCountdownRing() {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="pointer-events-none absolute -right-1.5 -top-1.5 drop-shadow" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
          animation: `ratc-peek-ring-drain ${SETUP_PEEK_REVEAL_MS}ms linear forwards`,
        }}
      />
    </svg>
  );
}

const SPECIAL_INSTRUCTIONS: Record<"peek" | "swap" | "drawTwo", string> = {
  peek: "🔎 엿보기 카드입니다 — 확인하고 싶은 내 카드를 선택하세요.",
  swap: "🔄 바꾸기 카드입니다 — 먼저 내 카드를, 다음으로 상대의 카드를 선택하세요 (앞면은 보지 않고 그대로 교환됩니다).",
  drawTwo: "2️⃣ 두 번 뽑기 카드입니다 — 사용하면 덱에서 카드를 한 장 더 뽑아 마음에 드는 쪽을 고를 수 있어요.",
};

export default function RatATatCatBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: RatATatCatBoardProps) {
  const [swapMySlot, setSwapMySlot] = useState<SlotIndex | null>(null);

  // ---------------------------------------------------------------------
  // Peek temporary-reveal timers (setup end-cards + the Peek power card) —
  // see engine.ts docstring point 8. Every hook below runs unconditionally
  // on every render (React rule) even though most of them only matter in
  // one phase; each effect's own body guards on `state.phase`.
  // ---------------------------------------------------------------------
  const iAcked = state.setupAcks[viewerSeat];

  // 2026-09-04 (AskUserQuestion): the setup peek no longer starts on its
  // own — it now waits for this viewer to actively tap "👁️ 카드 확인하기"
  // (`confirmClicked`) before any card flips. A player who never taps it is
  // auto-confirmed after `SETUP_CONFIRM_TIMEOUT_MS` so an AFK/disconnected
  // human can't stall the room at this pre-reveal gate forever (bots skip
  // this gate entirely — see their own ~1-1.5s auto-ack in
  // RatATatCatGame.tsx, which dispatches INITIAL_PEEK_DONE directly).
  const [confirmClicked, setConfirmClicked] = useState(false);
  useEffect(() => {
    if (state.phase !== "setup" || iAcked || confirmClicked) return;
    const timeout = setTimeout(() => setConfirmClicked(true), SETUP_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [state.phase, iAcked, confirmClicked]);

  const [setupPeekSecondsLeft, setSetupPeekSecondsLeft] = useState(Math.ceil(SETUP_PEEK_REVEAL_MS / 1000));
  const [setupSkipAvailable, setSetupSkipAvailable] = useState(false);
  const setupPeekFiredRef = useRef(false);
  /** Ends the setup peek reveal right now — called by the fixed `SETUP_PEEK_REVEAL_MS` timeout below, or by the player tapping the skip button once `setupSkipAvailable`. Idempotent (guards on the fired ref) since both paths can otherwise race. */
  function dismissSetupPeek() {
    if (setupPeekFiredRef.current) return;
    setupPeekFiredRef.current = true;
    onAction({ type: "INITIAL_PEEK_DONE", seat: viewerSeat });
  }

  // Reveal + timers only start once `confirmClicked` — see docstring above.
  // AskUserQuestion 2026-09-04 (compromise between the 2026-08-31 tap-to-
  // dismiss and 2026-09-02 no-early-dismiss decisions): the reveal still
  // guarantees `SETUP_PEEK_REVEAL_MS` by default, but a skip button
  // reappears after a shorter forced-visibility floor (`SKIP_ENABLE_MS`).
  useEffect(() => {
    if (state.phase !== "setup" || iAcked || !confirmClicked) return;
    // No explicit reset of setupPeekFiredRef/setupSkipAvailable here: both
    // `confirmClicked` and `iAcked` are one-way flips for a given viewer in
    // a single-round game (module docstring), so this effect body only ever
    // runs once per mount — their initial values already start correct.
    const startedAt = Date.now();
    // Deferred (setInterval/setTimeout callbacks, never called synchronously
    // during the effect itself) — the immediate 0ms timeout just corrects the
    // displayed countdown right away for a repeat peek window (a rematch)
    // without setState-in-effect's cascading-render footgun.
    const tick = () => setSetupPeekSecondsLeft(Math.max(0, Math.ceil((SETUP_PEEK_REVEAL_MS - (Date.now() - startedAt)) / 1000)));
    const immediate = setTimeout(tick, 0);
    const interval = setInterval(tick, 250);
    const skipTimer = setTimeout(() => setSetupSkipAvailable(true), SKIP_ENABLE_MS);
    const timeout = setTimeout(dismissSetupPeek, SETUP_PEEK_REVEAL_MS);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
      clearTimeout(skipTimer);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissSetupPeek closes over viewerSeat/onAction, both stable per mount; re-declaring it in deps would re-fire this effect every render.
  }, [state.phase, iAcked, confirmClicked, viewerSeat, onAction]);

  // "게임시작하고도 3초간 보이게해주세요" (2026-09-04) — edge-detects the
  // one-time "setup" → "playing" transition (same ref-diff technique as
  // `prevStateRef` further below) and reveals slots 0/3 again for
  // `GAME_START_PEEK_MS` on the real board, regardless of how this viewer's
  // own setup peek went. Both `setGameStartPeekActive` calls are deferred via
  // `setTimeout(..., 0)` (never called synchronously in the effect body
  // itself) for the same cascading-render reason as the setup peek's `tick`
  // above.
  const [gameStartPeekActive, setGameStartPeekActive] = useState(false);
  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (prevPhase !== "setup" || state.phase !== "playing") return;
    const start = setTimeout(() => setGameStartPeekActive(true), 0);
    const end = setTimeout(() => setGameStartPeekActive(false), GAME_START_PEEK_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [state.phase]);

  const [peekingSlot, setPeekingSlot] = useState<SlotIndex | null>(null);
  const peekPowerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startPeekReveal(slot: SlotIndex) {
    if (peekPowerTimerRef.current) clearTimeout(peekPowerTimerRef.current);
    setPeekingSlot(slot);
    peekPowerTimerRef.current = setTimeout(() => setPeekingSlot(null), PEEK_REVEAL_MS);
  }
  function dismissPeekReveal() {
    if (peekPowerTimerRef.current) {
      clearTimeout(peekPowerTimerRef.current);
      peekPowerTimerRef.current = null;
    }
    setPeekingSlot(null);
  }
  useEffect(
    () => () => {
      if (peekPowerTimerRef.current) clearTimeout(peekPowerTimerRef.current);
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Card acquisition flight effect + opponent draw/settle badges — driven
  // by diffing consecutive `state` snapshots (this is a controlled
  // component with no event stream of its own).
  // ---------------------------------------------------------------------
  const deckRef = useRef<HTMLButtonElement | null>(null);
  const discardRef = useRef<HTMLButtonElement | null>(null);
  const seatRefs = useRef<Map<SeatIndex, HTMLDivElement>>(new Map());
  function setSeatRef(seat: SeatIndex, el: HTMLDivElement | null) {
    if (el) seatRefs.current.set(seat, el);
    else seatRefs.current.delete(seat);
  }

  const [flights, setFlights] = useState<CardFlight[]>([]);
  function handleFlightDone(id: string) {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  }

  const [opponentBadges, setOpponentBadges] = useState<Partial<Record<SeatIndex, { text: string; key: number }>>>({});
  const badgeKeyRef = useRef(0);
  function pushOpponentBadge(seat: SeatIndex, text: string) {
    const key = ++badgeKeyRef.current;
    setOpponentBadges((prev) => ({ ...prev, [seat]: { text, key } }));
    setTimeout(() => {
      setOpponentBadges((prev) => (prev[seat]?.key === key ? { ...prev, [seat]: undefined } : prev));
    }, OPPONENT_BADGE_MS);
  }

  const [activeCallModal, setActiveCallModal] = useState<SeatIndex | null>(null);
  const shownCallForRef = useRef<SeatIndex | null>(null);

  const prevStateRef = useRef(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev === state) return;

    // A call was just declared — show the epic modal exactly once per round.
    if (prev.callerId === null && state.callerId !== null && shownCallForRef.current !== state.callerId) {
      shownCallForRef.current = state.callerId;
      setActiveCallModal(state.callerId);
    }

    // A draw just resolved (deck or discard) — fly a card icon from the
    // source to the drawing seat's hand row, for every viewer.
    const drawSource = state.drawSource;
    if (prev.drawnCard === null && state.drawnCard !== null && drawSource) {
      const drawer = state.currentTurn;
      const fromEl = drawSource === "deck" ? deckRef.current : discardRef.current;
      const toEl = seatRefs.current.get(drawer);
      if (fromEl && toEl) {
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        setFlights((prevFlights) => [
          ...prevFlights,
          {
            id: `flight-${state.seq}`,
            from: { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 },
            to: { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 },
            source: drawSource,
          },
        ]);
        getSoundEngine().playCardDrawWhoosh();
      }
      if (drawer !== viewerSeat) pushOpponentBadge(drawer, "📥 드로우 완료");
    }

    // This seat's card action (replace/discard/power) just fully resolved.
    if (prev.turnPhase !== "TURN_DECISION" && state.turnPhase === "TURN_DECISION") {
      const settler = state.currentTurn;
      if (settler !== viewerSeat) pushOpponentBadge(settler, "🔄 카드 정리 완료");
    }
  }, [state, viewerSeat]);

  if (state.phase === "gameOver") {
    return <GameOverReveal state={state} names={names} viewerSeat={viewerSeat} onDone={onGameEnd} />;
  }

  const myHand = state.hands[viewerSeat];
  const isMyTurn = state.phase === "playing" && state.currentTurn === viewerSeat;
  const myMoves = isMyTurn ? getValidMoves(state, viewerSeat) : [];
  const canDrawDeck = myMoves.some((m) => m.type === "DRAW_CARD" && m.source === "deck");
  const canDrawDiscard = myMoves.some((m) => m.type === "DRAW_CARD" && m.source === "discard");
  // TURN_DECISION only — see engine.ts docstring point 5 (call timing moved
  // from "instead of drawing" to "after this turn's card action resolves").
  const canPassTurn = myMoves.some((m) => m.type === "PASS_TURN");
  const canCall = myMoves.some((m) => m.type === "CALL_RAT_A_TAT_CAT");
  const canDiscard = myMoves.some((m) => m.type === "DISCARD_CARD");
  const discardTop = state.discardPile[state.discardPile.length - 1] ?? null;

  // ---------------------------------------------------------------------
  // Setup phase — everyone privately peeks their own end cards (slots 0/3),
  // a TEMPORARY reveal (engine.ts docstring point 8). 2026-09-04
  // (AskUserQuestion) added a player-driven gate in front of it: cards no
  // longer flip the instant setup begins — this viewer must first tap
  // "👁️ 카드 확인하기" (`confirmClicked`, or the `SETUP_CONFIRM_TIMEOUT_MS`
  // safety timeout fires on their behalf). Once revealed, the window still
  // guarantees `SETUP_PEEK_REVEAL_MS` by default but now offers a "⏩ 바로
  // 시작" skip button again after `SKIP_ENABLE_MS` — a deliberate compromise
  // between the 2026-08-31 tap-to-dismiss and 2026-09-02 no-early-dismiss
  // decisions (see `SETUP_PEEK_REVEAL_MS`'s docstring above).
  // ---------------------------------------------------------------------
  if (state.phase === "setup") {
    const ackedCount = state.setupAcks.filter(Boolean).length;

    if (!iAcked && !confirmClicked) {
      return (
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <span className="text-3xl">🐱🐭</span>
          <h2 className="break-keep text-base font-bold text-white">시작 전 카드 확인</h2>
          <p className="max-w-xs break-keep text-xs text-white/50">
            준비가 되면 아래 버튼을 눌러 내 카드 양 끝(1, 4번)을 확인하세요. 가운데 2장은 능력을 쓰기 전까지 알 수 없어요.
          </p>
          <div className="flex gap-2">
            {SLOTS.map((slot) => (
              <CardSlot key={slot} handCard={myHand[slot]} label={`내 카드 ${slot + 1}번`} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setConfirmClicked(true)}
            style={{ animation: "ratc-call-pulse-glow 1.6s ease-in-out infinite" }}
            className="min-w-[14rem] break-keep rounded-full bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-3 text-sm font-extrabold text-amber-950 hover:from-amber-300 hover:to-amber-500 active:scale-95"
          >
            👁️ 카드 확인하기 (준비 완료)
          </button>
          <p className="break-keep text-[11px] text-white/35">
            {ackedCount}/{state.playerCount}명 확인 완료
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
        <span className="text-3xl">🐱🐭</span>
        <h2 className="break-keep text-base font-bold text-white">시작 전 카드 확인</h2>
        <p className="max-w-xs break-keep text-xs text-white/50">양 끝(1, 4번) 카드만 몰래 확인하세요. 가운데 2장은 능력을 쓰기 전까지 알 수 없어요.</p>
        <div className="flex gap-2">
          {SLOTS.map((slot) => {
            const revealNow = !iAcked && (slot === 0 || slot === 3);
            return (
              <div key={slot} className="relative">
                <CardSlot handCard={myHand[slot]} peeking={revealNow} label={`내 카드 ${slot + 1}번`} />
                {revealNow && <PeekCountdownRing />}
              </div>
            );
          })}
        </div>
        {iAcked ? (
          <p className="break-keep text-xs text-white/40">
            {ackedCount}/{state.playerCount}명 확인 완료 — 상대를 기다리는 중...
          </p>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="break-keep text-xs text-amber-200/80">{setupPeekSecondsLeft}초 후 자동으로 뒷면으로 뒤집혀요</p>
            {setupSkipAvailable && (
              <button
                type="button"
                onClick={dismissSetupPeek}
                className="break-keep rounded-full border border-white/20 px-4 py-1.5 text-[11px] text-white/60 hover:border-white/40 active:scale-95"
              >
                ⏩ 바로 시작 (스킵)
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing phase
  // ---------------------------------------------------------------------
  const opponents = seatOrderFrom(viewerSeat, state.playerCount);

  function handleMySlotClick(slot: SlotIndex) {
    if (!isMyTurn) return;
    if (state.turnPhase === "DECIDE_CARD") {
      onAction({ type: "REPLACE_CARD", seat: viewerSeat, slot });
      return;
    }
    if (state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "peek") {
      onAction({ type: "USE_SPECIAL_CARD", seat: viewerSeat, power: "peek", slot });
      startPeekReveal(slot);
      return;
    }
    if (state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "swap") {
      setSwapMySlot(slot);
    }
  }

  function handleOpponentSlotClick(targetSeat: SeatIndex, targetSlot: SlotIndex) {
    if (!isMyTurn || swapMySlot === null) return;
    onAction({ type: "USE_SPECIAL_CARD", seat: viewerSeat, power: "swap", mySlot: swapMySlot, targetSeat, targetSlot });
    setSwapMySlot(null);
  }

  const inSwapPickOwn = isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "swap" && swapMySlot === null;
  const inSwapPickTarget = isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "swap" && swapMySlot !== null;
  const inPeekPick = isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard?.kind === "peek";
  const inReplacePick = isMyTurn && state.turnPhase === "DECIDE_CARD";

  return (
    <div className="flex flex-col gap-5">
      <CardFlightEffect flights={flights} onFlightDone={handleFlightDone} />
      {activeCallModal !== null && (
        <RatATatCatCallModal
          callerSeat={activeCallModal}
          callerName={names[activeCallModal]}
          viewerSeat={viewerSeat}
          onDismiss={() => setActiveCallModal(null)}
        />
      )}

      {/* Ongoing final-round status, shown once the epic call modal has been dismissed
          (AskUserQuestion 2026-08-31: the modal replaces the old always-on banner as the
          *announcement*; this slim strip keeps the "N턴 남음" status visible afterward). */}
      {state.callerId !== null && activeCallModal === null && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-xs font-semibold text-amber-200">
          🐱 {names[state.callerId]}님이 &ldquo;랫어탯캣!&rdquo;을 외쳤습니다 — 마지막 턴이 진행 중이에요 ({state.finalRoundTurnsLeft}턴 남음)
        </div>
      )}

      {/* Opponents */}
      <div className="flex flex-wrap justify-center gap-4">
        {opponents.map((seat) => {
          const isTurn = state.phase === "playing" && state.currentTurn === seat;
          const isSwapTarget = inSwapPickTarget;
          const isCaller = state.callerId === seat;
          const badge = opponentBadges[seat];
          return (
            <div
              key={seat}
              ref={(el) => setSeatRef(seat, el)}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-2.5 ${
                isTurn ? "border-emerald-400/50 bg-emerald-400/5" : "border-white/10 bg-white/[0.02]"
              } ${isCaller ? "ratc-caller-border-glow border-amber-300/70" : ""}`}
            >
              {badge && (
                <span
                  key={badge.key}
                  className="ratc-badge-pop pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-sky-300/70 bg-black/80 px-2 py-0.5 text-[10px] font-bold text-sky-200 shadow"
                >
                  {badge.text}
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <Avatar size={22} />
                <span className="max-w-[6rem] truncate text-xs font-semibold text-white/80">{names[seat]}</span>
                {!connectedSeats.has(seat) && <span className="text-[10px] text-white/30">💤</span>}
                {isCaller && <span className="text-[10px]">🐱</span>}
              </div>
              <div className="flex gap-1">
                {SLOTS.map((slot) => (
                  <CardSlot
                    key={slot}
                    size="sm"
                    handCard={state.hands[seat][slot]}
                    highlighted={isSwapTarget}
                    label={`${names[seat]}의 카드 ${slot + 1}번`}
                    onClick={isSwapTarget ? () => handleOpponentSlotClick(seat, slot) : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Center: deck / discard / drawn-card decision zone */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-6">
          <button
            ref={deckRef}
            type="button"
            disabled={!canDrawDeck}
            onClick={() => onAction({ type: "DRAW_CARD", seat: viewerSeat, source: "deck" })}
            className={`flex flex-col items-center gap-1 ${canDrawDeck ? "cursor-pointer" : "cursor-default opacity-60"}`}
          >
            <div className={canDrawDeck ? "animate-pulse" : ""}>
              <CardBack size="lg" />
            </div>
            <span className="text-[11px] text-white/50">덱 ({state.deck.length}장)</span>
          </button>

          <button
            ref={discardRef}
            type="button"
            disabled={!canDrawDiscard}
            onClick={() => onAction({ type: "DRAW_CARD", seat: viewerSeat, source: "discard" })}
            className={`flex flex-col items-center gap-1 ${canDrawDiscard ? "cursor-pointer" : "cursor-default"}`}
          >
            {discardTop ? (
              <CardSlot size="lg" handCard={{ card: discardTop, isKnownToOwner: true, isRevealed: true }} revealed highlighted={canDrawDiscard} />
            ) : (
              <div className="flex h-24 w-16 items-center justify-center rounded-xl border-2 border-dashed border-white/15 text-white/20 sm:h-28 sm:w-20">-</div>
            )}
            <span className="text-[11px] text-white/50">버림 더미</span>
          </button>
        </div>

        {isMyTurn && state.turnPhase === "DRAW" && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-white/50">
              {state.drawTwoStage === 1 ? "덱에서 두 번째(마지막) 카드를 뽑으세요." : "덱 또는 버림 더미에서 카드를 가져오세요."}
            </p>
          </div>
        )}

        {/* Turn-end choice — reached once this turn's card action (교체/버리기/능력 사용) is
            fully resolved. Split into two big, clearly separated touch targets (gap-3) so a
            careless tap can't accidentally end the turn instead of calling, or vice versa —
            see engine.ts docstring point 5 for why the call moved here instead of "드로우 대신". */}
        {isMyTurn && state.turnPhase === "TURN_DECISION" && (
          <div className="flex flex-col items-center gap-2.5">
            <p className="text-xs text-white/50">이번 턴 행동을 마쳤어요. 턴을 마칠까요, 랫어탯캣을 외칠까요?</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {canPassTurn && (
                <button
                  type="button"
                  onClick={() => onAction({ type: "PASS_TURN", seat: viewerSeat })}
                  className="min-w-[9.5rem] rounded-full bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/40 hover:bg-emerald-500 active:scale-95"
                >
                  ✅ 턴 종료
                </button>
              )}
              {canCall && (
                <button
                  type="button"
                  onClick={() => onAction({ type: "CALL_RAT_A_TAT_CAT", seat: viewerSeat })}
                  style={{ animation: "ratc-call-pulse-glow 1.6s ease-in-out infinite" }}
                  className="min-w-[9.5rem] rounded-full bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-3 text-sm font-extrabold text-amber-950 hover:from-amber-300 hover:to-amber-500 active:scale-95"
                >
                  🐱 랫어탯캣! (콜)
                </button>
              )}
            </div>
            {!canCall && <p className="text-[11px] text-white/35">이미 다른 플레이어가 콜을 외쳤어요 — 턴 종료만 가능해요.</p>}
          </div>
        )}

        {isMyTurn && state.turnPhase === "DECIDE_CARD" && state.drawnCard && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-white/60">뽑은 카드:</p>
            <CardSlot size="lg" handCard={{ card: state.drawnCard, isKnownToOwner: true, isRevealed: true }} revealed />
            <p className="text-xs text-white/50">{state.mustReplace ? "버림 더미에서 가져온 카드는 반드시 교체해야 해요." : "아래 내 카드 중 하나와 교체하거나 그냥 버리세요."}</p>
            {canDiscard && (
              <button type="button" onClick={() => onAction({ type: "DISCARD_CARD", seat: viewerSeat })} className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40">
                그냥 버리기
              </button>
            )}
          </div>
        )}

        {isMyTurn && state.turnPhase === "EXECUTE_POWER" && state.drawnCard && state.drawnCard.kind !== "number" && (
          <div className="flex flex-col items-center gap-2">
            <CardSlot size="lg" handCard={{ card: state.drawnCard, isKnownToOwner: true, isRevealed: true }} revealed />
            <p className="max-w-xs text-xs text-white/60">{SPECIAL_INSTRUCTIONS[state.drawnCard.kind]}</p>
            {state.drawnCard.kind === "drawTwo" && (
              <button
                type="button"
                onClick={() => onAction({ type: "USE_SPECIAL_CARD", seat: viewerSeat, power: "drawTwo" })}
                className="rounded-full bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                능력 사용 (한 장 더 뽑기)
              </button>
            )}
            {inSwapPickTarget && (
              <button type="button" onClick={() => setSwapMySlot(null)} className="rounded-full border border-white/20 px-4 py-1.5 text-[11px] text-white/60 hover:border-white/40">
                다시 선택
              </button>
            )}
            {canDiscard && (
              <button type="button" onClick={() => onAction({ type: "DISCARD_CARD", seat: viewerSeat })} className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40">
                그냥 버리기
              </button>
            )}
          </div>
        )}

        {!isMyTurn && state.phase === "playing" && (
          <p className="text-xs text-white/40">{names[state.currentTurn]}님의 차례입니다...</p>
        )}
      </div>

      {/* My hand */}
      <div
        ref={(el) => setSeatRef(viewerSeat, el)}
        className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 ${
          state.callerId === viewerSeat ? "ratc-caller-border-glow border-amber-300/70" : "border-transparent"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Avatar size={22} />
          <span className="text-xs font-semibold text-emerald-300">나 ({names[viewerSeat]})</span>
        </div>
        <div className="flex gap-2">
          {SLOTS.map((slot) => {
            const isPeeking = peekingSlot === slot;
            // "게임시작하고도 3초간 보이게해주세요" (2026-09-04) — a non-interactive,
            // automatic reveal (not the click-driven `isPeeking` above), so it's
            // additive to `peeking` only, never to `clickable`.
            const isGameStartPeek = gameStartPeekActive && (slot === 0 || slot === 3);
            const clickable = isPeeking || inReplacePick || inPeekPick || inSwapPickOwn;
            return (
              <CardSlot
                key={slot}
                size="lg"
                handCard={myHand[slot]}
                knownToViewer={myHand[slot].isKnownToOwner}
                peeking={isPeeking || isGameStartPeek}
                selected={inSwapPickOwn === false && swapMySlot === slot}
                highlighted={inReplacePick || inPeekPick || inSwapPickOwn}
                label={`내 카드 ${slot + 1}번`}
                onClick={clickable ? (isPeeking ? dismissPeekReveal : () => handleMySlotClick(slot)) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
