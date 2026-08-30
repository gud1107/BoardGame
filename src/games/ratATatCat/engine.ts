/**
 * Pure "랫어탯캣 (Rat-a-Tat Cat)" rules engine — no React, no I/O. Implements
 * the 2-6 player single-round ruleset from `boardGameRule/렛어텟켓/렛어텟켓.md`:
 * a 54-card deck (45 number cards 0-9 + 9 special cards: Peek/Swap/Draw Two
 * ×3 each), 4 face-down cards per player (only the leftmost/rightmost peeked
 * at setup), draw-one-decide-one turns, and a "Rat-a-Tat-Cat!" call that
 * gives every other seat exactly one more turn before the round ends and the
 * lowest card-sum wins.
 *
 * **House rules confirmed with the user (`AskUserQuestion`, no assumption)**:
 * 1. Round format: single round (단판 승부) — not the rulebook §6's optional
 *    multi-round cumulative-score variant (no target score was specified).
 * 2. Caller penalty: NONE — the rulebook's own text never actually states a
 *    penalty for a caller who turns out not to have the lowest sum (the
 *    original work order flagged this as unconfirmed); lowest sum wins
 *    regardless of who called.
 * 3. Network architecture: reuses this repo's actual standard (Supabase
 *    Realtime lockstep + `botTakeover.ts` vote-based disconnect handling,
 *    see ARCHITECTURE.md/docs/cloud-sync.md) instead of the work order's
 *    assumed `roomManager.ts`/`aiBot.ts` socket-server stack, which does not
 *    exist in this codebase (same discrepancy hit by every recent new-game
 *    session — see HANDOFF.md).
 * 4. `bettingRoomLinked`: NOT applied (optional pilot feature, absent from
 *    the work order's "공통 규격" list — same call as Lost Cities).
 * 5. **Call timing (deliberate house-rule deviation from rulebook §6)**: the
 *    rulebook's own text has the call replace the draw ("턴을 시작할 때, 카드
 *    뽑기 행동을 하는 **대신** 외칠 수 있다") — the original engine matched
 *    that exactly. A later work order asked instead for the call to be
 *    offered *after* that seat's draw/replace/discard/power action fully
 *    resolves, so the player can improve their hand this turn AND still
 *    call. Confirmed via `AskUserQuestion` (2026-08-31, "완전 대체"): the
 *    pre-draw "call instead of drawing" option is REMOVED entirely, not
 *    offered alongside the new one — `CALL_RAT_A_TAT_CAT` is only a legal
 *    move from the new `TURN_DECISION` resting phase below.
 * 6. Draw Two chain × the new `TURN_DECISION` phase: confirmed the decision
 *    screen appears only once the chain is fully resolved (after the final
 *    candidate is replaced/discarded), never at the mid-chain "reject the
 *    first candidate" step — matches the existing "only resting phases get
 *    their own phase value" design below.
 * 7. No new turn timer: confirmed no chess-clock-style per-turn timeout was
 *    wanted for the new `TURN_DECISION` screen — this project has no
 *    turn-level timer anywhere, only the existing idle/disconnect-based
 *    `botTakeover.ts` vote flow, which is unaffected and untouched.
 * 8. **Peek visibility is now TEMPORARY, not a permanent memory hint**
 *    (confirmed via `AskUserQuestion`, 2026-08-31, "완전히 숨김(규칙 변경)"):
 *    the original engine had both the setup's leftmost/rightmost peek and
 *    the Peek special card set `isKnownToOwner = true` forever, which
 *    `CardSlot.tsx` rendered as a permanent dim hint to the owner — a bug
 *    report described this as "카드가 뒷면으로 자동 전환되지 않는" defect. It
 *    was actually the original deliberate design (see git history), but the
 *    user confirmed they want the real physical-game feel instead: peeking
 *    only grants a few seconds of visibility, then the card goes fully back
 *    to unknown — the player must actually remember it. `initialPeekDone`
 *    and `resolvePeek` below therefore no longer set `isKnownToOwner` at
 *    all; the few-seconds-then-hide behavior is implemented purely as local,
 *    ephemeral UI state in `RatATatCatBoard.tsx` (every client already holds
 *    the real `card` value for every slot regardless of this flag — see this
 *    docstring's trust-model paragraph below — so no engine/network change
 *    is needed to show a temporary reveal). `isKnownToOwner` now means
 *    exactly one thing: "this slot's current card was actively placed here
 *    by REPLACE_CARD this game" (confirmed to stay permanent — a replace
 *    isn't a "peek", the owner just placed the card and reasonably still
 *    remembers it, same as the physical game). One accepted side effect:
 *    `assumedSlotValue`'s bot heuristic below now also "forgets" a
 *    peeked-only slot instead of getting free permanent knowledge from it —
 *    judged as an acceptable, thematically-consistent simplification rather
 *    than worth a second confirmation round (bots become exactly as fallible
 *    as a human who doesn't memorize their peek in time).
 *
 * **Engineering judgment calls (implementation detail, not a rules
 * ambiguity — documented per ARCHITECTURE.md §5 rather than re-asked)**:
 * - The work order sketched `turnPhase: 'DRAW' | 'DECIDE_CARD' |
 *   'EXECUTE_POWER' | 'DISCARD'`. Implemented as only 3 *resting* phases plus
 *   the later-added `TURN_DECISION` (point 5 above) — 'DISCARD' turned out
 *   to have no reachable state of its own once modeled precisely: §4 방식
 *   A/B's "그냥 버리기" always resolves atomically inside the
 *   `DECIDE_CARD`/`EXECUTE_POWER` action handler (never left parked in a
 *   phase of its own), and §5 Draw Two's mandatory second draw is just a
 *   restricted re-entry into `DRAW` (deck-only, no call, tracked by
 *   `drawTwoStage`) rather than a new named phase. `TurnPhase` keeps
 *   'DISCARD' in its JSDoc union for traceability but it is never actually
 *   assigned.
 * - §3.2's initial deal is unrestricted (any of the 54 cards, including
 *   specials, can land in a starting hand) and §3.4's peek only ever looks
 *   at 2 of the 4 slots — so a special card can sit in a hand all game and
 *   never get looked at or replaced. §6.2 explicitly covers this: at
 *   scoring time, any hand slot still holding a special card is resolved by
 *   drawing from the remaining deck (deterministically, no new randomness)
 *   until a number card turns up, and that becomes the slot's score value.
 *   Swap can also blindly relocate a special card into another seat's hand
 *   (the rulebook doesn't restrict Swap to number cards) — hands are never
 *   guaranteed to hold only number cards until this final resolution.
 * - Starting player / setup: §3.5 "시작 플레이어를 정합니다" doesn't specify
 *   how, so (matching this repo's No Thanks!/Avalon convention) it's derived
 *   from the shared seed for determinism. §3.4's simultaneous peek is
 *   modeled as an unordered `INITIAL_PEEK_DONE` ack per seat (no cross-seat
 *   interaction, so simultaneity has no engine-observable difference from
 *   any resolution order) — `phase` stays `"setup"` until every seat has
 *   acked, then flips to `"playing"` at the pre-picked starting seat.
 *
 * Same online-multiplayer trust model as every other lockstep game in this
 * project (ARCHITECTURE.md §1, docs/architecture.md §2): every connected
 * client computes and holds the FULL state (every seat's hidden cards) from
 * a shared RNG seed plus replayed `EngineAction`s. There is no server
 * authority — a technically inclined player could inspect their own
 * client's memory to see every hand. Accepted trade-off, same as the other
 * ~20 games in this catalog.
 */

import { seededRng, shuffle } from "@/lib/rng";
import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

export type SeatIndex = number;
export type SlotIndex = 0 | 1 | 2 | 3;
export const SLOTS: readonly SlotIndex[] = [0, 1, 2, 3];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type SpecialKind = "peek" | "swap" | "drawTwo";

export interface NumberCard {
  id: string;
  kind: "number";
  /** 0-9. Rulebook flavor: 0-5 "cats" (low/good), 6-9 "rats" (high/bad) — pure flavor, scoring only cares about the number. */
  value: number;
}

export interface SpecialCard {
  id: string;
  kind: SpecialKind;
}

export type Card = NumberCard | SpecialCard;

/** Mean value of a number card across the full 45-card number pool: (4 each of 0-8, plus 9 of value 9) = 225/45 = 5 exactly. Used by the bot heuristic below to price an unknown/unseen slot or draw. */
export const AVERAGE_CARD_VALUE = 5;

/** Builds the full 54-card deck (unshuffled) — 45 number cards (0-8 ×4, 9 ×9) + 9 special cards (peek/swap/drawTwo ×3 each), per §2's composition table. */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (let value = 0; value <= 8; value++) {
    for (let i = 0; i < 4; i++) cards.push({ id: `n${value}-${i}`, kind: "number", value });
  }
  for (let i = 0; i < 9; i++) cards.push({ id: `n9-${i}`, kind: "number", value: 9 });
  for (const kind of ["peek", "swap", "drawTwo"] as const) {
    for (let i = 0; i < 3; i++) cards.push({ id: `${kind}-${i}`, kind });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface HandCard {
  card: Card;
  /** True only once the owning seat has actively placed this exact card here via REPLACE_CARD this game — NOT set by the setup peek or the Peek power, which are temporary/UI-only (module docstring point 8). Drives the board's permanent "살짝 투명한 힌트" vs "?" rendering for a just-placed card — a purely per-viewer concern, never used to gate engine actions. */
  isKnownToOwner: boolean;
  /** True only once the round is over and every hand is revealed for scoring. */
  isRevealed: boolean;
}

export type Hand = [HandCard, HandCard, HandCard, HandCard];

export type Phase = "setup" | "playing" | "gameOver";

/**
 * See this module's docstring — `DISCARD` is kept in the union for
 * traceability against the original work order's sketch but never actually
 * assigned (every "그냥 버리기" resolves atomically inside
 * `DECIDE_CARD`/`EXECUTE_POWER` instead of resting in a phase of its own).
 * `TURN_DECISION` IS a real resting phase: entered once a turn's card action
 * (replace / plain discard / power resolution) is fully done, offering the
 * acting seat a choice between ending the turn normally and calling
 * "Rat-a-Tat-Cat!" now that their hand reflects this turn's play (house-rule
 * deviation from rulebook §6 — see module docstring point 5).
 */
export type TurnPhase = "DRAW" | "DECIDE_CARD" | "EXECUTE_POWER" | "DISCARD" | "TURN_DECISION";

/**
 * 0 = no active Draw Two chain (a plain discard moves on to TURN_DECISION
 *     normally, like any other resolved card action).
 * 1 = holding the chain's first candidate — discarding it (instead of
 *     using/replacing) forces the mandatory second draw rather than resting
 *     in TURN_DECISION yet.
 * 2 = holding the chain's mandatory second (final) candidate — discarding
 *     it now behaves exactly like stage 0 (moves on to TURN_DECISION, no
 *     further draw).
 * Using ANY drawTwo special card's power (even mid-chain, if one happens to
 * be drawn as a candidate) always resets this to a fresh 1 — nesting is
 * bounded by the deck's finite 3 physical Draw Two cards, never infinite.
 */
export type DrawTwoStage = 0 | 1 | 2;

export interface RatATatCatState {
  phase: Phase;
  playerCount: number;
  /** Face-down draw pile. Index 0 = top (next to be drawn). */
  deck: Card[];
  /** Face-up discard pile. Last element = top (most recently discarded, the only one ever shown/reclaimed). */
  discardPile: Card[];
  hands: Hand[];
  /** Setup-only: has seat N completed its one-time leftmost/rightmost peek. */
  setupAcks: boolean[];
  currentTurn: SeatIndex;
  turnPhase: TurnPhase;
  /** The card currently drawn and awaiting a decision, or null between turns. */
  drawnCard: Card | null;
  drawSource: "deck" | "discard" | null;
  /** True only for a number card taken from the discard pile — §4 방식A: it must replace a hand slot, "그냥 버리기" isn't offered. */
  mustReplace: boolean;
  drawTwoStage: DrawTwoStage;
  callerId: SeatIndex | null;
  /** Number of OTHER seats still owed their final turn after a call, or null if nobody has called. */
  finalRoundTurnsLeft: number | null;
  /** Monotonic counter incremented on every applied action — mirrors malDalliJa/showMeTheCoin's `isStateSyncStale` guard for the reconnect `state-sync` race (docs/cloud-sync.md §2.3). */
  seq: number;
}

export type EngineAction =
  | { type: "INITIAL_PEEK_DONE"; seat: SeatIndex }
  | { type: "DRAW_CARD"; seat: SeatIndex; source: "deck" | "discard" }
  | { type: "REPLACE_CARD"; seat: SeatIndex; slot: SlotIndex }
  | { type: "DISCARD_CARD"; seat: SeatIndex }
  | { type: "USE_SPECIAL_CARD"; seat: SeatIndex; power: "peek"; slot: SlotIndex }
  | { type: "USE_SPECIAL_CARD"; seat: SeatIndex; power: "swap"; mySlot: SlotIndex; targetSeat: SeatIndex; targetSlot: SlotIndex }
  | { type: "USE_SPECIAL_CARD"; seat: SeatIndex; power: "drawTwo" }
  /** Only legal from `TURN_DECISION` — ends the turn normally without calling. */
  | { type: "PASS_TURN"; seat: SeatIndex }
  /** Only legal from `TURN_DECISION` (see module docstring point 5) — declares "Rat-a-Tat-Cat!" now that this turn's card action is done, then ends the turn. */
  | { type: "CALL_RAT_A_TAT_CAT"; seat: SeatIndex };

function nextSeat(seat: SeatIndex, playerCount: number): SeatIndex {
  return (seat + 1) % playerCount;
}

/** See malDalliJa/showMeTheCoin's identically-named guard — rejects a `state-sync` snapshot that raced behind a client's own already-applied action. `current === null` (genuine first catch-up) always accepts. */
export function isStateSyncStale(current: RatATatCatState | null, synced: RatATatCatState): boolean {
  return current !== null && synced.seq < current.seq;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): RatATatCatState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const shuffled = shuffle(buildDeck(), rng);

  const hands: Hand[] = [];
  let cursor = 0;
  for (let seat = 0; seat < playerCount; seat++) {
    const slots: HandCard[] = [];
    for (let i = 0; i < 4; i++) {
      slots.push({ card: shuffled[cursor], isKnownToOwner: false, isRevealed: false });
      cursor++;
    }
    hands.push(slots as Hand);
  }
  const discardPile: Card[] = [shuffled[cursor]];
  cursor++;
  const deck = shuffled.slice(cursor);

  return {
    phase: "setup",
    playerCount,
    deck,
    discardPile,
    hands,
    setupAcks: Array.from({ length: playerCount }, () => false),
    // Picked now (from the same seed) for determinism — §3.5 doesn't specify
    // how, see module docstring.
    currentTurn: Math.floor(rng() * playerCount),
    turnPhase: "DRAW",
    drawnCard: null,
    drawSource: null,
    mustReplace: false,
    drawTwoStage: 0,
    callerId: null,
    finalRoundTurnsLeft: null,
    seq: 0,
  };
}

// ---------------------------------------------------------------------------
// Turn-lifecycle helpers
// ---------------------------------------------------------------------------

function clearedForNextDecision(state: RatATatCatState): RatATatCatState {
  return { ...state, drawnCard: null, drawSource: null, mustReplace: false, drawTwoStage: 0, turnPhase: "DRAW" };
}

/**
 * A turn's card action (replace / plain discard / power resolution) just
 * fully resolved — instead of immediately advancing to the next seat, parks
 * the *same* seat in `TURN_DECISION` so it can choose `PASS_TURN` or
 * `CALL_RAT_A_TAT_CAT` (module docstring point 5). `currentTurn`/`callerId`/
 * `finalRoundTurnsLeft` are untouched; only the transient draw/decision
 * fields are cleared, same as `clearedForNextDecision`.
 */
function awaitTurnDecision(state: RatATatCatState): RatATatCatState {
  return { ...state, drawnCard: null, drawSource: null, mustReplace: false, drawTwoStage: 0, turnPhase: "TURN_DECISION" };
}

/** Reveals every hand for the game-over scoring animation. Score *values* are computed separately (see `computeGameOverScores`) — the special-card-substitution rule (§6.2) never mutates the actual hands, only the derived score. */
function finishGame(state: RatATatCatState): RatATatCatState {
  const hands = state.hands.map((hand) => hand.map((hc) => ({ ...hc, isRevealed: true })) as Hand);
  return { ...state, hands, phase: "gameOver", turnPhase: "DRAW", drawnCard: null, drawSource: null };
}

/** Ends the current seat's turn: advances to the next seat, or ends the round if a call's final lap just completed or the deck just ran dry (§6 "덱이 바닥난 경우에도 즉시 라운드가 종료됩니다"). */
function advanceTurn(state: RatATatCatState): RatATatCatState {
  const cleared = clearedForNextDecision(state);
  if (cleared.callerId !== null) {
    const left = (cleared.finalRoundTurnsLeft ?? 0) - 1;
    if (left <= 0 || cleared.deck.length === 0) return finishGame(cleared);
    return { ...cleared, finalRoundTurnsLeft: left, currentTurn: nextSeat(cleared.currentTurn, cleared.playerCount) };
  }
  if (cleared.deck.length === 0) return finishGame(cleared);
  return { ...cleared, currentTurn: nextSeat(cleared.currentTurn, cleared.playerCount) };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Acks that `seat` has finished its one-time setup peek at slots 0/3 (module
 * docstring point 8: the peek itself is a temporary reveal handled entirely
 * client-side by `RatATatCatBoard.tsx` — this action only advances the
 * setup handshake and grants no lasting `isKnownToOwner` knowledge).
 */
function initialPeekDone(state: RatATatCatState, seat: SeatIndex): RatATatCatState {
  if (state.phase !== "setup") return state;
  if (seat < 0 || seat >= state.playerCount || state.setupAcks[seat]) return state;

  const setupAcks = state.setupAcks.map((acked, s) => (s === seat ? true : acked));
  const allAcked = setupAcks.every(Boolean);
  return { ...state, setupAcks, phase: allAcked ? "playing" : "setup", seq: state.seq + 1 };
}

function drawCard(state: RatATatCatState, seat: SeatIndex, source: "deck" | "discard"): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn || state.turnPhase !== "DRAW" || state.drawnCard !== null) return state;

  if (source === "deck") {
    if (state.deck.length === 0) return state;
    const [card, ...rest] = state.deck;
    const turnPhase: TurnPhase = card.kind === "number" ? "DECIDE_CARD" : "EXECUTE_POWER";
    return { ...state, deck: rest, drawnCard: card, drawSource: "deck", mustReplace: false, turnPhase, seq: state.seq + 1 };
  }

  // §4 방식A: only a number card on top of the discard pile can be taken, and only outside an active Draw Two chain (its inner draws are always from the deck, §5).
  if (state.drawTwoStage !== 0) return state;
  const top = state.discardPile[state.discardPile.length - 1];
  if (!top || top.kind !== "number") return state;
  const discardPile = state.discardPile.slice(0, -1);
  return { ...state, discardPile, drawnCard: top, drawSource: "discard", mustReplace: true, turnPhase: "DECIDE_CARD", seq: state.seq + 1 };
}

function replaceCard(state: RatATatCatState, seat: SeatIndex, slot: SlotIndex): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn || state.turnPhase !== "DECIDE_CARD") return state;
  const drawn = state.drawnCard;
  if (!drawn || drawn.kind !== "number") return state;

  const oldCard = state.hands[seat][slot].card;
  const hands = state.hands.map((hand, s) => {
    if (s !== seat) return hand;
    const next = [...hand] as Hand;
    next[slot] = { card: drawn, isKnownToOwner: true, isRevealed: false };
    return next;
  });
  const discardPile = [...state.discardPile, oldCard];
  return awaitTurnDecision({ ...state, hands, discardPile, seq: state.seq + 1 });
}

function discardCard(state: RatATatCatState, seat: SeatIndex): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn) return state;
  if (state.turnPhase !== "DECIDE_CARD" && state.turnPhase !== "EXECUTE_POWER") return state;
  const drawn = state.drawnCard;
  if (!drawn) return state;
  if (state.turnPhase === "DECIDE_CARD" && state.mustReplace) return state; // §4 방식A: no plain discard for a discard-pile take

  const discardPile = [...state.discardPile, drawn];
  if (state.drawTwoStage === 1) {
    // §5: didn't like the first candidate — forced into the mandatory second draw, deck-only, no call.
    return { ...state, discardPile, drawnCard: null, drawSource: null, mustReplace: false, drawTwoStage: 2, turnPhase: "DRAW", seq: state.seq + 1 };
  }
  return awaitTurnDecision({ ...state, discardPile, seq: state.seq + 1 });
}

/**
 * Resolves the Peek special card. Per module docstring point 8, this grants
 * no lasting `isKnownToOwner` knowledge — the temporary reveal itself is
 * handled purely client-side (`RatATatCatBoard.tsx`), which already has the
 * real `card` value on hand regardless of this flag (see the trust-model
 * paragraph above).
 */
function resolvePeek(state: RatATatCatState, seat: SeatIndex, slot: SlotIndex): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn || state.turnPhase !== "EXECUTE_POWER") return state;
  const drawn = state.drawnCard;
  if (!drawn || drawn.kind !== "peek") return state;
  if (slot < 0 || slot > 3) return state;

  const discardPile = [...state.discardPile, drawn];
  return awaitTurnDecision({ ...state, discardPile, seq: state.seq + 1 });
}

function resolveSwap(state: RatATatCatState, seat: SeatIndex, mySlot: SlotIndex, targetSeat: SeatIndex, targetSlot: SlotIndex): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn || state.turnPhase !== "EXECUTE_POWER") return state;
  const drawn = state.drawnCard;
  if (!drawn || drawn.kind !== "swap") return state;
  if (targetSeat === seat || targetSeat < 0 || targetSeat >= state.playerCount) return state;

  const mine = state.hands[seat][mySlot];
  const theirs = state.hands[targetSeat][targetSlot];
  const hands = state.hands.map((hand, s) => {
    if (s === seat) {
      const next = [...hand] as Hand;
      next[mySlot] = { card: theirs.card, isKnownToOwner: false, isRevealed: false };
      return next;
    }
    if (s === targetSeat) {
      const next = [...hand] as Hand;
      next[targetSlot] = { card: mine.card, isKnownToOwner: false, isRevealed: false };
      return next;
    }
    return hand;
  });
  const discardPile = [...state.discardPile, drawn];
  return awaitTurnDecision({ ...state, hands, discardPile, seq: state.seq + 1 });
}

function resolveDrawTwo(state: RatATatCatState, seat: SeatIndex): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn || state.turnPhase !== "EXECUTE_POWER") return state;
  const drawn = state.drawnCard;
  if (!drawn || drawn.kind !== "drawTwo") return state;

  const discardPile = [...state.discardPile, drawn];
  // Doesn't end the turn — kicks off (or restarts, if nested) a fresh Draw Two chain.
  return { ...state, discardPile, drawnCard: null, drawSource: null, mustReplace: false, drawTwoStage: 1, turnPhase: "DRAW", seq: state.seq + 1 };
}

/** Only legal from `TURN_DECISION` (see module docstring point 5) — this seat's card action for the turn is already resolved, so ending the turn just needs the ordinary `advanceTurn`. */
function passTurn(state: RatATatCatState, seat: SeatIndex): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn || state.turnPhase !== "TURN_DECISION") return state;
  return advanceTurn({ ...state, seq: state.seq + 1 });
}

function callRatATatCat(state: RatATatCatState, seat: SeatIndex): RatATatCatState {
  if (state.phase !== "playing" || seat !== state.currentTurn || state.turnPhase !== "TURN_DECISION") return state;
  if (state.callerId !== null) return state;

  // House-rule call timing (module docstring point 5): the caller's own turn
  // ends instantly right after this turn's card action; every OTHER seat
  // gets exactly one more turn. `finalRoundTurnsLeft` starts at the full
  // `playerCount - 1` (the caller's own turn doesn't count against it) — the
  // next seat's own `passTurn`/`CALL_RAT_A_TAT_CAT` will run through
  // `advanceTurn` and decrement it normally from there, same as before.
  return {
    ...state,
    callerId: seat,
    finalRoundTurnsLeft: state.playerCount - 1,
    currentTurn: nextSeat(seat, state.playerCount),
    turnPhase: "DRAW",
    seq: state.seq + 1,
  };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: RatATatCatState, action: EngineAction): RatATatCatState {
  switch (action.type) {
    case "INITIAL_PEEK_DONE":
      return initialPeekDone(state, action.seat);
    case "DRAW_CARD":
      return drawCard(state, action.seat, action.source);
    case "REPLACE_CARD":
      return replaceCard(state, action.seat, action.slot);
    case "DISCARD_CARD":
      return discardCard(state, action.seat);
    case "PASS_TURN":
      return passTurn(state, action.seat);
    case "CALL_RAT_A_TAT_CAT":
      return callRatATatCat(state, action.seat);
    case "USE_SPECIAL_CARD":
      if (action.power === "peek") return resolvePeek(state, action.seat, action.slot);
      if (action.power === "swap") return resolveSwap(state, action.seat, action.mySlot, action.targetSeat, action.targetSlot);
      return resolveDrawTwo(state, action.seat);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Scoring (§6) — hands are never mutated with substitute values; this is a
// pure read of `state` computed once at (or after) gameOver.
// ---------------------------------------------------------------------------

export interface SlotScore {
  slot: SlotIndex;
  card: Card;
  /** The number actually counted for scoring — `card.value` for a number card, or the §6.2 deck-substitution value for a leftover special card. */
  value: number;
  substituted: boolean;
}

export interface HandScore {
  seat: SeatIndex;
  slots: SlotScore[];
  total: number;
}

/**
 * §6.2: any hand slot still holding a special card at game end is resolved
 * by drawing from the remaining deck, in order, until a number card turns
 * up (a special card drawn as a substitute is itself skipped and the draw
 * continues) — that number becomes the slot's score. All seats draw from
 * one shared queue (seat 0 slot 0 first, ... deterministic, matches every
 * client's identical post-gameOver `state.deck`). If the deck is ever fully
 * exhausted mid-resolution (Rules-silent, extremely unlikely — the pool has
 * 45 number cards against at most 24 hand slots at 6 players), any
 * remaining unresolved slot falls back to the deck's known mean (see
 * `AVERAGE_CARD_VALUE`) rather than an arbitrary hardcoded number.
 */
export function computeGameOverScores(state: RatATatCatState): HandScore[] {
  const queue = [...state.deck];
  const scores: HandScore[] = [];
  for (let seat = 0; seat < state.playerCount; seat++) {
    const slots: SlotScore[] = [];
    let total = 0;
    for (const slot of SLOTS) {
      const card = state.hands[seat][slot].card;
      if (card.kind === "number") {
        slots.push({ slot, card, value: card.value, substituted: false });
        total += card.value;
        continue;
      }
      let value: number | null = null;
      while (queue.length > 0) {
        const drawn = queue.shift()!;
        if (drawn.kind === "number") {
          value = drawn.value;
          break;
        }
      }
      const resolved = value ?? AVERAGE_CARD_VALUE;
      slots.push({ slot, card, value: resolved, substituted: true });
      total += resolved;
    }
    scores.push({ seat, slots, total });
  }
  return scores;
}

export interface RankedScore {
  seat: SeatIndex;
  rank: number;
  score: HandScore;
}

/** Standard competition ranking (1,1,3,...) — lower `total` wins. No caller penalty (see module docstring, confirmed with the user). */
export function computeRankings(state: RatATatCatState): RankedScore[] {
  const scores = computeGameOverScores(state);
  return scores
    .map((score) => ({
      seat: score.seat,
      rank: 1 + scores.filter((other) => other.seat !== score.seat && other.total < score.total).length,
      score,
    }))
    .sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves mirrors every action
// handler's own guards exactly; chooseBotAction scores candidates with a
// simple memory-based heuristic (keep known-low cards, shed known-high
// ones — matching the work order's "메모리 기반 지능형 플레이" ask) and
// routes through the shared Level 1-10 noise curve.
// ---------------------------------------------------------------------------

/** Whose decision is pending right now: during `"setup"`, the lowest-indexed seat that still hasn't acked its initial peek (setup has no single "current turn", but a bot must still act on exactly one seat per state — see engine.ts docstring); during `"playing"`, `currentTurn`; otherwise null. */
export function currentActor(state: RatATatCatState): SeatIndex | null {
  if (state.phase === "setup") {
    const idx = state.setupAcks.findIndex((acked) => !acked);
    return idx === -1 ? null : idx;
  }
  if (state.phase === "playing") return state.currentTurn;
  return null;
}

/** Every legal `EngineAction` `seat` may submit right now. Mirrors each action handler's own guards. */
export function getValidMoves(state: RatATatCatState, seat: SeatIndex): EngineAction[] {
  if (state.phase === "setup") {
    if (seat < 0 || seat >= state.playerCount || state.setupAcks[seat]) return [];
    return [{ type: "INITIAL_PEEK_DONE", seat }];
  }
  if (state.phase !== "playing" || seat !== state.currentTurn) return [];

  const moves: EngineAction[] = [];
  if (state.turnPhase === "DRAW") {
    // No "call instead of drawing" — the call is only offered from
    // TURN_DECISION, after this turn's card action resolves (module
    // docstring point 5).
    if (state.drawTwoStage === 0) {
      if (state.deck.length > 0) moves.push({ type: "DRAW_CARD", seat, source: "deck" });
      const top = state.discardPile[state.discardPile.length - 1];
      if (top && top.kind === "number") moves.push({ type: "DRAW_CARD", seat, source: "discard" });
    } else {
      // Draw Two's mandatory redraw — deck-only, no discard-pile take.
      if (state.deck.length > 0) moves.push({ type: "DRAW_CARD", seat, source: "deck" });
    }
    return moves;
  }
  if (state.turnPhase === "TURN_DECISION") {
    moves.push({ type: "PASS_TURN", seat });
    if (state.callerId === null) moves.push({ type: "CALL_RAT_A_TAT_CAT", seat });
    return moves;
  }
  if (state.turnPhase === "DECIDE_CARD") {
    if (!state.mustReplace) moves.push({ type: "DISCARD_CARD", seat });
    for (const slot of SLOTS) moves.push({ type: "REPLACE_CARD", seat, slot });
    return moves;
  }
  if (state.turnPhase === "EXECUTE_POWER") {
    moves.push({ type: "DISCARD_CARD", seat });
    const drawn = state.drawnCard;
    if (drawn && drawn.kind === "peek") {
      for (const slot of SLOTS) moves.push({ type: "USE_SPECIAL_CARD", seat, power: "peek", slot });
    } else if (drawn && drawn.kind === "swap") {
      for (const mySlot of SLOTS) {
        for (let targetSeat = 0; targetSeat < state.playerCount; targetSeat++) {
          if (targetSeat === seat) continue;
          for (const targetSlot of SLOTS) {
            moves.push({ type: "USE_SPECIAL_CARD", seat, power: "swap", mySlot, targetSeat, targetSlot });
          }
        }
      }
    } else if (drawn && drawn.kind === "drawTwo") {
      moves.push({ type: "USE_SPECIAL_CARD", seat, power: "drawTwo" });
    }
    return moves;
  }
  return moves; // "DISCARD" is never assigned — see module docstring.
}

/** A slot's assumed value from `seat`'s own point of view — its known number-card value, or the deck's mean for anything unseen (unknown slot, or a known-but-special card that'll be substituted at scoring per §6.2). Information-fair: never reads another seat's hidden cards. */
function assumedSlotValue(hc: HandCard): number {
  if (hc.isKnownToOwner && hc.card.kind === "number") return hc.card.value;
  return AVERAGE_CARD_VALUE;
}

function estimateHandValue(hand: Hand): number {
  return hand.reduce((sum, hc) => sum + assumedSlotValue(hc), 0);
}

/**
 * Scores one candidate move by its expected effect on `seat`'s own assumed
 * hand total (lower total is better, so higher score = better move — this
 * keeps every branch comparable on one "hand-value delta" scale). Level
 * 8-10 (`botTier(level) === "expert"`) additionally reads the discard
 * pile's visible top card when deciding whether to take it — still
 * information-fair (the discard pile is public to everyone, not hidden
 * state) — while lower tiers treat a discard-pile take the same as an
 * average blind draw.
 */
function scoreMove(state: RatATatCatState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  const hand = state.hands[seat];
  const expert = botTier(level) === "expert";

  switch (move.type) {
    case "INITIAL_PEEK_DONE":
      return 0;
    case "PASS_TURN":
      return 0; // baseline "do nothing" — comparable to CALL_RAT_A_TAT_CAT's delta scale below
    case "CALL_RAT_A_TAT_CAT": {
      const estimate = estimateHandValue(hand);
      // Flat bonus scaled so calling only outscores PASS_TURN's 0 baseline
      // once the hand is genuinely good (well under the ~20 average for 4
      // cards at mean 5).
      return (10 - estimate) * 1.5;
    }
    case "DRAW_CARD": {
      if (move.source === "deck") return 0; // neutral baseline — unknown draw, ~average EV
      const top = state.discardPile[state.discardPile.length - 1];
      const topValue = top && top.kind === "number" ? top.value : AVERAGE_CARD_VALUE;
      return AVERAGE_CARD_VALUE - topValue;
    }
    case "REPLACE_CARD": {
      const drawn = state.drawnCard!;
      if (drawn.kind !== "number") return -Infinity;
      return assumedSlotValue(hand[move.slot]) - drawn.value;
    }
    case "DISCARD_CARD":
      return 0; // baseline "do nothing" — comparable to REPLACE_CARD's delta scale
    case "USE_SPECIAL_CARD": {
      if (move.power === "peek") {
        return hand[move.slot].isKnownToOwner ? 0.5 : 3;
      }
      if (move.power === "swap") {
        const base = assumedSlotValue(hand[move.mySlot]) - AVERAGE_CARD_VALUE;
        return expert ? base * 1.2 : base;
      }
      return 2; // drawTwo: pure optionality, no real downside — always worth using
    }
    default:
      return 0;
  }
}

/**
 * Picks a move for `seat` per the shared Level 1-10 curve (`pickByLevel`,
 * botDifficulty.ts). `rng` defaults to `Math.random` — bot decisions are
 * local UX, not part of the deterministic engine contract; the resulting
 * `EngineAction` still runs through the ordinary, fully deterministic
 * `applyAction`.
 */
export function chooseBotAction(
  state: RatATatCatState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}
