/**
 * Pure "러브레터(Love Letter)" rules engine — no React, no I/O. Implements
 * the rulebook at boardGameRule/러브레터/러브레터.md, titled from its first
 * line "단판 승부 정식 규칙서" (a single-round house-rule variant of the
 * original multi-round token-collecting game).
 *
 * **Round count vs the task brief — resolved via `AskUserQuestion` before
 * writing any code, same standard this project has used for dalmuti/
 * lasVegas.** The task brief asked for the *original* Love Letter loop
 * (accumulate "호감도 토큰" across many rounds until a player-count-scaled
 * target, e.g. 2p:7/3p:5/4p:4). The assigned rulebook is a **different,
 * explicit house rule**: exactly one round, and that round's winner is
 * immediately the game's winner — no tokens at all. This is a win-condition-
 * level conflict (not a numbers-only one like Century's resource order), so
 * per ARCHITECTURE.md §5 the user was asked which to build; **the user chose
 * the rulebook's single-round variant.** There is therefore no `winTokens`
 * concept anywhere in this engine — `phase: "gameOver"` at the end of the
 * one round IS the end of the game, exactly like dalmuti/lasVegas/coyote's
 * "단판승부" framing.
 *
 * Same online-multiplayer trust model as every other game in this project
 * (see Coyote/Avalon's module docs): every connected client computes and
 * holds the FULL state (every seat's actual hand) from a shared RNG seed
 * plus replayed `EngineAction`s — there is no server authority. Hand secrecy
 * (a seat can't see another seat's hand, and only the acting player learns a
 * Priest peek or a King swap's revealed values) is enforced purely at the
 * view layer via `getPlayerView` below, exactly like Coyote's forehead-card
 * redaction — nothing is ever actually hidden inside `LoveLetterState`
 * itself.
 *
 * Documented assumptions/inferences (the rulebook doesn't spell these out,
 * or leaves genre-standard mechanics implicit):
 * 1. **Eliminated hands are revealed face-up.** The rulebook never says this
 *    explicitly, but (a) it is the actual published Love Letter rule ("if
 *    eliminated, place your hand in the discard pile face up") and (b) the
 *    task brief's UI spec explicitly asks for "버려진 카드들이 각 플레이어
 *    앞에 늘어서서 잔여 카드 추론이 쉽도록 표시" (discard piles laid out per
 *    player for card-counting), and the rulebook's own §6 팁 3 leans on
 *    exactly this ("바닥에 깔린 버린 카드들을 잘 확인하면..."). This engine
 *    therefore folds a seat's final held card into that seat's public
 *    `discardPile` the instant they're eliminated, alongside every normally
 *    played card — one uniform "discard pile" concept, fully public,
 *    de-duplicating what would otherwise be two different reveal rules.
 * 2. **Priest peeks and King swaps are private to their participants.**
 *    Standard Love Letter play: a Priest peek is seen only by the peeker; a
 *    King swap is physically handed over so both participants necessarily
 *    see what they received, but nobody else does. `lastEvent` always
 *    carries the true values (every client holds full state per the trust
 *    model above), and `getPlayerView` redacts them for any viewer who isn't
 *    an authorized participant.
 * 3. **Player count 2~4** per rulebook §2 ("2명~4명, 추천 3~4명"). The
 *    2-player-only extra 3-card face-up removal (§2-3) is implemented as
 *    `visibleRemovedCards`.
 * 4. **Prince's "no cards left" fallback** (rulebook §4 5번 기사: "덱에
 *    카드가 없다면 세팅 때 제거한 비공개 카드를 가져옵니다") only ever
 *    consumes the *single* face-down burned card (`removedCard`), never the
 *    2-player face-up set-aside trio — those stay permanently out of play,
 *    consistent with §2-3 calling them a separate, always-public removal.
 *    Structurally this reserve can be drawn on at most once per game: the
 *    round-end check (§5 조건 2) fires the instant the main deck empties, so
 *    play never reaches a second "deck AND reserve both empty" turn.
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

export type CardNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Card {
  id: number;
  number: CardNumber;
}

export const CARD_NAMES: Record<CardNumber, string> = {
  1: "경비병",
  2: "사제",
  3: "남작",
  4: "하녀",
  5: "왕자",
  6: "왕",
  7: "백작부인",
  8: "공주",
};

/** [number, count][] per rulebook §1 (총 16장). */
const DECK_SPEC: [number: CardNumber, count: number][] = [
  [1, 5],
  [2, 2],
  [3, 2],
  [4, 2],
  [5, 2],
  [6, 1],
  [7, 1],
  [8, 1],
];

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const [number, count] of DECK_SPEC) {
    for (let i = 0; i < count; i++) cards.push({ id: id++, number });
  }
  return cards;
}

export const DECK_SIZE = buildDeck().length; // 16, verified in LoveLetter.test.ts

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PlayerState {
  seat: SeatIndex;
  /** 0 (eliminated, nothing left), 1 (normal between-turns), or 2 (mid-decision, just drew). */
  hand: Card[];
  alive: boolean;
  /** True from playing Handmaid until this seat's own next turn starts. */
  protectedUntilNextTurn: boolean;
  /** Every card this seat has ever played or (on elimination) had left in hand — always public, face-up. */
  discardPile: Card[];
}

export type Phase = "playing" | "gameOver";

export type LastEvent =
  | { type: "guard"; actorSeat: SeatIndex; targetSeat: SeatIndex | null; guess: CardNumber | null; correct: boolean | null; fizzled: boolean }
  | { type: "priest"; actorSeat: SeatIndex; targetSeat: SeatIndex | null; peekedCard: Card | null; fizzled: boolean }
  | { type: "baron"; actorSeat: SeatIndex; targetSeat: SeatIndex | null; outcome: "actorEliminated" | "targetEliminated" | "tie" | null; fizzled: boolean }
  | { type: "handmaid"; actorSeat: SeatIndex }
  | { type: "prince"; actorSeat: SeatIndex; targetSeat: SeatIndex; discardedCard: Card; newCard: Card | null; usedReserve: boolean; eliminatedPrincess: boolean }
  | { type: "king"; actorSeat: SeatIndex; targetSeat: SeatIndex | null; actorNewCard: Card | null; targetNewCard: Card | null; fizzled: boolean }
  | { type: "countess"; actorSeat: SeatIndex }
  | { type: "princess"; actorSeat: SeatIndex };

export interface LoveLetterState {
  playerCount: number;
  players: PlayerState[];
  /** Face-down draw pile. */
  deck: Card[];
  /** The single face-down card burned at setup (rulebook §2-3) — Prince's last-resort reserve, see module doc #4. */
  removedCard: Card;
  /** Whether `removedCard` has already been drawn as a Prince fallback. */
  removedCardUsed: boolean;
  /** 2-player-only: the 3 cards revealed and set aside at setup (§2-3), always public, never re-enter play. */
  visibleRemovedCards: Card[];
  activeSeat: SeatIndex;
  phase: Phase;
  turnNumber: number;
  lastEvent: LastEvent | null;
  /** Seats in elimination order (earliest first) — needed for final rankings. */
  eliminationOrder: SeatIndex[];
  /** Populated once `phase === "gameOver"`; may hold more than one seat on an exact tie (§5-3). */
  winnerSeats: SeatIndex[];
  endReason: "elimination" | "deckExhausted" | null;
}

export type EngineAction = {
  type: "playCard";
  seat: SeatIndex;
  cardId: number;
  targetSeat?: SeatIndex;
  guessNumber?: CardNumber;
};

// ---------------------------------------------------------------------------
// Setup / dealing
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): LoveLetterState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const deck = shuffle(buildDeck(), rng);

  const removedCard = deck.shift()!;
  const visibleRemovedCards = playerCount === 2 ? [deck.shift()!, deck.shift()!, deck.shift()!] : [];

  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    hand: [deck.shift()!],
    alive: true,
    protectedUntilNextTurn: false,
    discardPile: [],
  }));

  // No physical tiebreak (가위바위보/최근 데이트) has meaning at a fresh
  // table — same convention as Coyote/Avalon/Perudo/No Thanks: pick the
  // starter from the shared seed, after dealing is already fixed.
  const starter = Math.floor(rng() * playerCount);
  players[starter].hand.push(deck.shift()!);

  return {
    playerCount,
    players,
    deck,
    removedCard,
    removedCardUsed: false,
    visibleRemovedCards,
    activeSeat: starter,
    phase: "playing",
    turnNumber: 1,
    lastEvent: null,
    eliminationOrder: [],
    winnerSeats: [],
    endReason: null,
  };
}

// ---------------------------------------------------------------------------
// Derived helpers (shared by engine validation and UI — single source of truth)
// ---------------------------------------------------------------------------

export function aliveSeats(state: LoveLetterState): SeatIndex[] {
  return state.players.filter((p) => p.alive).map((p) => p.seat);
}

function nextAliveSeat(seat: SeatIndex, players: PlayerState[], playerCount: number): SeatIndex {
  let next = (seat + 1) % playerCount;
  for (let i = 0; i < playerCount; i++) {
    const p = players.find((pl) => pl.seat === next);
    if (p && p.alive) return next;
    next = (next + 1) % playerCount;
  }
  return seat; // unreachable once the game hasn't already ended, kept only as a safe fallback
}

/** True when `hand` contains the Countess alongside a Prince or King — rulebook §4 7번 백작부인, forces Countess to be the one played. */
export function isForcedCountess(hand: Card[]): boolean {
  const numbers = hand.map((c) => c.number);
  return numbers.includes(7) && (numbers.includes(5) || numbers.includes(6));
}

/** Cards (1,2,3,5,6) that name a target; Handmaid/Countess/Princess never do. Prince always resolves to a target (self allowed), the other four may fizzle with none. */
export function needsTarget(cardNumber: CardNumber): boolean {
  return cardNumber === 1 || cardNumber === 2 || cardNumber === 3 || cardNumber === 5 || cardNumber === 6;
}

export function needsGuess(cardNumber: CardNumber): boolean {
  return cardNumber === 1;
}

/**
 * Who `actorSeat` may legally name with `cardNumber` right now. Guard/Priest/
 * Baron/King exclude the actor themself and any Handmaid-protected seat;
 * Prince includes the actor. An empty result for the non-Prince cards means
 * "every other seat is protected" — the rulebook's fizzle case (§4 지목
 * 불가능 상황).
 */
export function validTargets(state: LoveLetterState, actorSeat: SeatIndex, cardNumber: CardNumber): SeatIndex[] {
  const others = state.players.filter((p) => p.alive && p.seat !== actorSeat && !p.protectedUntilNextTurn).map((p) => p.seat);
  if (cardNumber === 5) return [actorSeat, ...others];
  if (needsTarget(cardNumber)) return others;
  return [];
}

// ---------------------------------------------------------------------------
// Draw helper (deck first, removedCard reserve fallback — module doc #4)
// ---------------------------------------------------------------------------

function drawOne(state: LoveLetterState): { card: Card | null; deck: Card[]; removedCardUsed: boolean } {
  if (state.deck.length > 0) {
    const deck = [...state.deck];
    const card = deck.shift()!;
    return { card, deck, removedCardUsed: state.removedCardUsed };
  }
  if (!state.removedCardUsed) {
    return { card: state.removedCard, deck: state.deck, removedCardUsed: true };
  }
  return { card: null, deck: state.deck, removedCardUsed: state.removedCardUsed }; // structurally unreachable, see module doc #4
}

// ---------------------------------------------------------------------------
// playCard — the entire engine as one action
// ---------------------------------------------------------------------------

function playCard(state: LoveLetterState, seat: SeatIndex, cardId: number, targetSeat: SeatIndex | undefined, guessNumber: CardNumber | undefined): LoveLetterState {
  if (state.phase !== "playing") return state;
  if (seat !== state.activeSeat) return state;
  const actor = state.players.find((p) => p.seat === seat);
  if (!actor || !actor.alive || actor.hand.length !== 2) return state;

  const cardIndex = actor.hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) return state;
  const played = actor.hand[cardIndex];
  const kept = actor.hand[1 - cardIndex];

  if (isForcedCountess(actor.hand) && played.number !== 7) return state; // §4 7번: 강제 플레이 위반

  const legalTargets = needsTarget(played.number) ? validTargets(state, seat, played.number) : [];
  const targetProvided = targetSeat !== undefined;

  // Clear the actor's own protection now that their turn has begun — the
  // Handmaid shield only lasts "until this seat's own next turn" (§4 4번).
  let players = state.players.map((p) => (p.seat === seat ? { ...p, protectedUntilNextTurn: false, hand: [kept] } : p));
  const pushDiscard = (targetSeatToUpdate: SeatIndex, card: Card) => {
    players = players.map((p) => (p.seat === targetSeatToUpdate ? { ...p, discardPile: [...p.discardPile, card] } : p));
  };
  pushDiscard(seat, played);

  let deck = state.deck;
  let removedCardUsed = state.removedCardUsed;
  let eliminationOrder = state.eliminationOrder;
  let lastEvent: LastEvent;

  const eliminate = (loserSeat: SeatIndex) => {
    players = players.map((p) => {
      if (p.seat !== loserSeat || !p.alive) return p;
      const [remaining] = p.hand;
      return {
        ...p,
        alive: false,
        hand: [],
        discardPile: remaining ? [...p.discardPile, remaining] : p.discardPile,
      };
    });
    eliminationOrder = [...eliminationOrder, loserSeat];
  };

  switch (played.number) {
    case 1: {
      // 경비병 — must name a real target when one exists; 1 is never a legal guess.
      if (legalTargets.length === 0) {
        if (targetProvided) return state;
        lastEvent = { type: "guard", actorSeat: seat, targetSeat: null, guess: null, correct: null, fizzled: true };
        break;
      }
      if (!targetProvided || !legalTargets.includes(targetSeat!)) return state;
      if (guessNumber === undefined || guessNumber < 2 || guessNumber > 8) return state;
      const target = players.find((p) => p.seat === targetSeat)!;
      const correct = target.hand.length === 1 && target.hand[0].number === guessNumber;
      if (correct) eliminate(targetSeat!);
      lastEvent = { type: "guard", actorSeat: seat, targetSeat: targetSeat!, guess: guessNumber, correct, fizzled: false };
      break;
    }
    case 2: {
      // 사제 — private peek, see module doc #2.
      if (legalTargets.length === 0) {
        if (targetProvided) return state;
        lastEvent = { type: "priest", actorSeat: seat, targetSeat: null, peekedCard: null, fizzled: true };
        break;
      }
      if (!targetProvided || !legalTargets.includes(targetSeat!)) return state;
      const target = players.find((p) => p.seat === targetSeat)!;
      lastEvent = { type: "priest", actorSeat: seat, targetSeat: targetSeat!, peekedCard: target.hand[0] ?? null, fizzled: false };
      break;
    }
    case 3: {
      // 남작 — compare; lower is eliminated, tie = no effect (§4 3번).
      if (legalTargets.length === 0) {
        if (targetProvided) return state;
        lastEvent = { type: "baron", actorSeat: seat, targetSeat: null, outcome: null, fizzled: true };
        break;
      }
      if (!targetProvided || !legalTargets.includes(targetSeat!)) return state;
      const target = players.find((p) => p.seat === targetSeat)!;
      const actorNumber = kept.number;
      const targetNumber = target.hand[0]!.number;
      let outcome: "actorEliminated" | "targetEliminated" | "tie";
      if (actorNumber < targetNumber) {
        eliminate(seat);
        outcome = "actorEliminated";
      } else if (targetNumber < actorNumber) {
        eliminate(targetSeat!);
        outcome = "targetEliminated";
      } else {
        outcome = "tie";
      }
      lastEvent = { type: "baron", actorSeat: seat, targetSeat: targetSeat!, outcome, fizzled: false };
      break;
    }
    case 4: {
      // 하녀 — shield until this seat's own next turn.
      players = players.map((p) => (p.seat === seat ? { ...p, protectedUntilNextTurn: true } : p));
      lastEvent = { type: "handmaid", actorSeat: seat };
      break;
    }
    case 5: {
      // 왕자 — self always a legal target when nobody else is (§4 지목 불가능 상황 단서).
      if (!targetProvided || !legalTargets.includes(targetSeat!)) return state;
      const target = players.find((p) => p.seat === targetSeat)!;
      const discardedCard = target.hand[0]!;
      pushDiscard(targetSeat!, discardedCard);
      if (discardedCard.number === 8) {
        // §4 5번 조건절: 버려진 카드가 공주면 그 자리에서 탈락 — no redraw.
        players = players.map((p) => (p.seat === targetSeat ? { ...p, hand: [] } : p));
        eliminationOrder = [...eliminationOrder, targetSeat!];
        players = players.map((p) => (p.seat === targetSeat ? { ...p, alive: false } : p));
        lastEvent = { type: "prince", actorSeat: seat, targetSeat: targetSeat!, discardedCard, newCard: null, usedReserve: false, eliminatedPrincess: true };
      } else {
        const draw = drawOne({ ...state, deck, removedCardUsed });
        deck = draw.deck;
        removedCardUsed = draw.removedCardUsed;
        players = players.map((p) => (p.seat === targetSeat ? { ...p, hand: draw.card ? [draw.card] : [] } : p));
        lastEvent = {
          type: "prince",
          actorSeat: seat,
          targetSeat: targetSeat!,
          discardedCard,
          newCard: draw.card,
          usedReserve: draw.card !== null && draw.card.id === state.removedCard.id && !state.removedCardUsed,
          eliminatedPrincess: false,
        };
      }
      break;
    }
    case 6: {
      // 왕 — hand swap, both participants privately learn what they received (module doc #2).
      if (legalTargets.length === 0) {
        if (targetProvided) return state;
        lastEvent = { type: "king", actorSeat: seat, targetSeat: null, actorNewCard: null, targetNewCard: null, fizzled: true };
        break;
      }
      if (!targetProvided || !legalTargets.includes(targetSeat!)) return state;
      const target = players.find((p) => p.seat === targetSeat)!;
      const actorNewCard = target.hand[0]!;
      const targetNewCard = kept;
      players = players.map((p) => {
        if (p.seat === seat) return { ...p, hand: [actorNewCard] };
        if (p.seat === targetSeat) return { ...p, hand: [targetNewCard] };
        return p;
      });
      lastEvent = { type: "king", actorSeat: seat, targetSeat: targetSeat!, actorNewCard, targetNewCard, fizzled: false };
      break;
    }
    case 7: {
      lastEvent = { type: "countess", actorSeat: seat };
      break;
    }
    case 8: {
      // 공주 — playing/discarding it for any reason is immediate elimination (§4 8번).
      players = players.map((p) => (p.seat === seat ? { ...p, alive: false, hand: [] } : p));
      eliminationOrder = [...eliminationOrder, seat];
      lastEvent = { type: "princess", actorSeat: seat };
      break;
    }
    default:
      return state;
  }

  return checkRoundEnd({
    ...state,
    players,
    deck,
    removedCardUsed,
    eliminationOrder,
    lastEvent,
    turnNumber: state.turnNumber, // advanced inside checkRoundEnd if play continues
  });
}

/**
 * §5 종료 판정, run after every `playCard` resolves. Priority: (1) a single
 * survivor wins immediately regardless of deck state; else (2) an emptied
 * deck ends the round by hand comparison; else (3) advance to the next alive
 * seat and deal them their turn-opening draw.
 */
function checkRoundEnd(state: LoveLetterState): LoveLetterState {
  const alive = state.players.filter((p) => p.alive);

  if (alive.length <= 1) {
    return { ...state, phase: "gameOver", endReason: "elimination", winnerSeats: alive.length === 1 ? [alive[0].seat] : [] };
  }

  if (state.deck.length === 0) {
    const maxNumber = Math.max(...alive.map((p) => p.hand[0]!.number));
    const topTier = alive.filter((p) => p.hand[0]!.number === maxNumber);
    let winners: PlayerState[];
    if (topTier.length === 1) {
      winners = topTier;
    } else {
      // §5-3 동률 처리: 버린 카드 숫자 합이 더 높은 사람.
      const maxSum = Math.max(...topTier.map((p) => p.discardPile.reduce((sum, c) => sum + c.number, 0)));
      winners = topTier.filter((p) => p.discardPile.reduce((sum, c) => sum + c.number, 0) === maxSum);
    }
    return { ...state, phase: "gameOver", endReason: "deckExhausted", winnerSeats: winners.map((p) => p.seat) };
  }

  const next = nextAliveSeat(state.activeSeat, state.players, state.playerCount);
  const draw = drawOne(state);
  const players = state.players.map((p) => (p.seat === next ? { ...p, hand: draw.card ? [...p.hand, draw.card] : p.hand } : p));
  return { ...state, players, deck: draw.deck, removedCardUsed: draw.removedCardUsed, activeSeat: next, turnNumber: state.turnNumber + 1 };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: LoveLetterState, action: EngineAction): LoveLetterState {
  switch (action.type) {
    case "playCard":
      return playCard(state, action.seat, action.cardId, action.targetSeat, action.guessNumber);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Player view — hand secrecy projection (module doc #2)
// ---------------------------------------------------------------------------

export interface VisiblePlayer {
  seat: SeatIndex;
  handSize: number;
  /** Only populated for the viewer's own seat, or every seat once `phase === "gameOver"`. */
  hand: Card[] | null;
  alive: boolean;
  protectedUntilNextTurn: boolean;
  discardPile: Card[];
}

export interface LoveLetterView {
  players: VisiblePlayer[];
  lastEvent: LastEvent | null;
}

export function getPlayerView(state: LoveLetterState, viewerSeat: SeatIndex): LoveLetterView {
  const revealAll = state.phase === "gameOver";
  const players: VisiblePlayer[] = state.players.map((p) => ({
    seat: p.seat,
    handSize: p.hand.length,
    hand: revealAll || p.seat === viewerSeat ? p.hand : null,
    alive: p.alive,
    protectedUntilNextTurn: p.protectedUntilNextTurn,
    discardPile: p.discardPile,
  }));

  let lastEvent = state.lastEvent;
  if (lastEvent && !revealAll) {
    if (lastEvent.type === "priest" && lastEvent.actorSeat !== viewerSeat) {
      lastEvent = { ...lastEvent, peekedCard: null };
    } else if (lastEvent.type === "king" && lastEvent.actorSeat !== viewerSeat && lastEvent.targetSeat !== viewerSeat) {
      lastEvent = { ...lastEvent, actorNewCard: null, targetNewCard: null };
    } else if (lastEvent.type === "prince" && lastEvent.targetSeat !== viewerSeat) {
      lastEvent = { ...lastEvent, newCard: null };
    }
  }

  return { players, lastEvent };
}

// ---------------------------------------------------------------------------
// Final rankings
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
}

/**
 * Only meaningful once `state.phase === "gameOver"`. Winner(s) share rank 1
 * (a deck-exhaustion showdown can tie, §5-3); any other still-alive seats
 * (possible when the round ended by elimination-count but more than one
 * seat is alive... actually only reachable via deck exhaustion, since
 * elimination-ending always leaves exactly one alive) are ranked below the
 * winners by the same hand/discard-sum comparison; eliminated seats are
 * ranked below all alive seats, most-recently-eliminated first.
 */
export function computeRankings(state: LoveLetterState): RankedSeat[] {
  if (state.phase !== "gameOver") return [];

  const alive = state.players.filter((p) => p.alive);
  const winnerSet = new Set(state.winnerSeats);
  const nonWinnerAlive = alive.filter((p) => !winnerSet.has(p.seat));

  const scored = (p: PlayerState) => ({
    seat: p.seat,
    handNumber: p.hand[0]?.number ?? 0,
    discardSum: p.discardPile.reduce((sum, c) => sum + c.number, 0),
  });

  function tieredByComparison(list: PlayerState[]): SeatIndex[][] {
    const scoredList = list.map(scored).sort((a, b) => b.handNumber - a.handNumber || b.discardSum - a.discardSum);
    const tiers: SeatIndex[][] = [];
    for (const s of scoredList) {
      const lastTier = tiers[tiers.length - 1];
      const lastSeatScore = lastTier ? scoredList.find((x) => x.seat === lastTier[0])! : null;
      if (lastTier && lastSeatScore!.handNumber === s.handNumber && lastSeatScore!.discardSum === s.discardSum) {
        lastTier.push(s.seat);
      } else {
        tiers.push([s.seat]);
      }
    }
    return tiers;
  }

  const winnerTier: SeatIndex[][] = state.winnerSeats.length > 0 ? [state.winnerSeats] : [];
  const restAliveTiers = tieredByComparison(nonWinnerAlive);
  const eliminatedTiers = [...state.eliminationOrder].reverse().map((seat) => [seat]);

  const tiers = [...winnerTier, ...restAliveTiers, ...eliminatedTiers];
  const ranks: RankedSeat[] = [];
  let rank = 1;
  for (const tier of tiers) {
    for (const seat of tier) ranks.push({ seat, rank });
    rank += tier.length;
  }
  return ranks;
}
