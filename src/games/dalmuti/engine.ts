/**
 * Pure "달무티" (The Great Dalmuti) rules engine — no React, no I/O. Implements
 * `boardGameRule/달무티/달무티.md`, which is explicitly titled "단판승부 달무티
 * (하우스 룰) 정식 규칙서" — a single-round (단판) house-rule variant: exactly
 * one round is played, the first player to empty their hand wins outright,
 * and the game ends the moment only one player still holds cards (that
 * survivor is automatically last place).
 *
 * §0 rulebook-vs-brief conflict, resolved via `AskUserQuestion` (not silently
 * per ARCHITECTURE.md §5's default "rulebook wins" rule, because this
 * conflict changes the win condition/game loop itself — same class of
 * conflict as lasVegas's round-count question): the task brief described a
 * repeating multi-round loop with rank reassignment each round, but the
 * user-supplied rulebook is explicitly single-round only. Asked the user
 * directly; **the user chose the rulebook's single-round design**. There is
 * therefore no "next round" and no rank-reassignment-between-rounds logic —
 * ranks are decided exactly once, at the start of the one round played.
 *
 * §1 note on initial rank determination: the rulebook's §2 offers two
 * *physical* procedures (draw a card, low card re-drawn on ties; or
 * rock-paper-scissors) to decide the 1st..last seating/rank order before the
 * single round begins. Both are equivalent to "a uniformly random permutation
 * of the seats" in the digital context (no physical re-draw ceremony to
 * visualize), so `determineInitialRankOrder` produces that permutation
 * directly from the shared RNG stream — this is a documented simplification
 * of the *procedure*, not a change to its *outcome distribution*.
 *
 * §2 note on player count: the rulebook never states a min/max player count
 * (a physical 80-card deck is normally played 4-8). This engine allows
 * 3-8 — 3 is the smallest count where the 노예(Slave)↔왕(King) tax exchange
 * is meaningful, and 8 keeps every player's hand a non-trivial size
 * (80/8=10 cards each). At exactly 3 players the "귀족(Noble)"/"거지
 * (Beggar)" tax exchange target the same seat (rank position 1 of 0..2), so
 * that second exchange is skipped entirely — see `computeTributes`.
 *
 * §3 note on trick-passing: rulebook §3-4-B-2 explicitly says a pass within
 * one trick does **not** lock you out of that same trick — "한 트릭 내에서
 * 패스했어도 다음 차례에 다시 참여 가능". This engine therefore tracks no
 * sticky "has passed" set; it just counts consecutive passes since the last
 * accepted play and ends the trick once every other still-active seat has
 * passed in a row (see `pass`) — any play resets that counter, so a seat that
 * passed earlier gets prompted again on its next turn if the trick is still
 * open.
 *
 * §4 note on a trick winner who goes out mid-trick: not covered by the
 * rulebook. Standard convention for this genre (President/Big Two/Tuen
 * Sheung, which this rulebook's "다음 트릭의 선이 됩니다" line otherwise
 * mirrors) is that the next still-active seat after the empty-handed winner
 * leads the next trick instead — implemented in `pass`'s trick-resolution
 * branch.
 *
 * §5 (2026-08-25) 5-tier role rename + commoner mutual exchange, resolved via
 * AskUserQuestion (task brief asked for 왕(King)/귀족(Noble)/평민(Commoner)/
 * 거지(Beggar)/노예(Slave) but conflicted with itself on tribute pairing —
 * see below):
 * - Position *titles* only changed (달무티→왕, 총리→귀족, 중농→평민,
 *   소농노→거지, 대농노→노예, all still via `rankTitle`); the underlying
 *   slot table, forced-tribute pairing (best↔worst 2 cards, 2nd↔2nd-worst 1
 *   card, both auto-selecting the giver's lowest-numbered non-joker cards,
 *   2nd exchange skipped at n=3), and card-rank flavor names in
 *   `CardArt.tsx`'s `CARD_RANK_INFO` (e.g. rank 1 = "위대한 달무티", a card
 *   name, not a player title) are all unchanged — user confirmed reusing the
 *   existing 중농 slot math and the existing best↔worst pairing rather than
 *   the brief's self-contradictory literal wording (왕↔거지 + 귀족↔노예).
 *   Jokers stay exempt from the forced tribute's auto-selected cards too
 *   (user confirmed keeping that existing rulebook-based behavior).
 * - New: a voluntary `commonerExchange` phase between `taxReturn` and
 *   `trick`, for 평민(Commoner)-tier seats only (positions strictly between
 *   1 and n-2 — 0 commoners at n=3/4, up to 4 at n=8). Each commoner
 *   independently opts in/out (no partner selection, per user confirmation);
 *   the engine pairs everyone who opted in, two at a time in rank order,
 *   leaving an odd leftover unpaired; each paired seat then privately picks
 *   one card to swap, and the swap applies the instant both sides have
 *   picked. Fewer than 2 opted-in commoners (or fewer than 2 commoner seats
 *   at all) skips straight to `trick` — see `enterCommonerExchangePhase`.
 *   Runs even after a revolution (which only cancels the *forced* tribute,
 *   not this separate voluntary peer trade) — not covered by the task
 *   brief; documented default, same "reasoned convention over another
 *   question round" approach as §4 above.
 *
 * §6 (2026-08-25 후속 세션) 평민 카드 교환 UI/보안/VFX 세션 — no engine logic
 * changed here; `commonerOfferCard` (§5 above) was already a true free
 * choice of any card in hand, so this session's "원하는 카드 1장 자유 선택"
 * requirement landed entirely in `CardExchangeModal.tsx` (a dedicated modal
 * replacing the old shared inline hand-click flow). Two things resolved via
 * AskUserQuestion (Strict No-Assumption Rule per the task brief):
 * - **Masking scope**: the task brief asked that exchanged cards never leak
 *   to a third party via "네트워크 페이로드나 프론트 상태값". Per
 *   docs/architecture.md §2 this project has no server-authoritative engine
 *   — every client already holds this same `DalmutiState` (every seat's
 *   real hand) in memory, the same trust trade-off every other secret-info
 *   game here accepts. The user confirmed proceeding with UI-layer-only
 *   masking (same convention as hand secrecy itself) rather than a
 *   project-wide server-authoritative rewrite (explicitly out of scope) —
 *   see `DalmutiEffects.tsx`'s `isExchangeParticipant`/`FlyingExchangeCard`.
 * - **No decision timer**: commoner opt-in/card-pick stays untimed, same as
 *   `taxReturn` always has been.
 * - Sound effects were also added this session (user confirmed) — this is
 *   the first audio in this project; see `lib/audio/soundEngine.ts`'s
 *   `playExchangeLaunch`/`playExchangeArrival` and the new mute toggle in
 *   `DalmutiBoard.tsx`.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state (every seat's
 * hand) from a shared RNG seed plus replayed `EngineAction`s — there is no
 * server authority (see docs/architecture.md §2). Hands are secret from
 * other *players* only, enforced at the UI layer (`DalmutiBoard.tsx`), same
 * technique every other game here uses.
 */

import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

export type SeatIndex = number;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const MAX_CARD_RANK = 12;
export const JOKER_RANK = 13;
export const JOKER_COUNT = 2;

export interface Card {
  /** `${rank}-${copyIndex}` for rank cards, `joker-${copyIndex}` for jokers. Unique across the 80-card deck. */
  id: string;
  /** 1 (위대한 달무티, highest) .. 12 (농노, lowest), or 13 for a joker. */
  rank: number;
  isJoker: boolean;
}

export interface PlayerState {
  seat: SeatIndex;
  hand: Card[];
  /** 1-based order this seat emptied its hand (or was auto-assigned last place). Null while still playing. */
  finishedAtOrder: number | null;
}

export type Phase = "revolutionOption" | "taxReturn" | "commonerExchange" | "trick" | "gameOver";

/** The one seat holding both jokers right after the deal, and whether declaring flips every rank (only true when that seat sits at the 노예(Slave) position). */
export interface RevolutionInfo {
  seat: SeatIndex;
  isGrand: boolean;
}

/**
 * One forced tribute exchange (rulebook §3): `givenCardIds` are the tribute
 * seat's automatically-selected highest-ranked cards (no choice involved,
 * jokers excluded per "광대 카드는 세금 바치기 대상에서 제외"), already moved
 * into the recipient's hand the instant tributes are computed.
 * `returnedCardIds` stays empty until the recipient chooses what to give
 * back via `returnTax`.
 */
export interface TributeRecord {
  fromSeat: SeatIndex;
  toSeat: SeatIndex;
  givenCardIds: string[];
  returnedCardIds: string[];
  resolved: boolean;
}

/** One 평민(Commoner) seat's opt-in decision for the voluntary mutual exchange (§5). `participate` stays null until the seat answers. */
export interface CommonerParticipant {
  seat: SeatIndex;
  participate: boolean | null;
}

/**
 * One paired swap between two commoners who both opted in (§5). `cardIdA`/
 * `cardIdB` stay null until that side privately picks a card — the swap
 * itself applies the instant both sides have picked, so a player never sees
 * their partner's choice ahead of committing their own ("비공개로
 * 맞교환" per the task brief).
 */
export interface CommonerExchangePair {
  seatA: SeatIndex;
  seatB: SeatIndex;
  cardIdA: string | null;
  cardIdB: string | null;
  resolved: boolean;
}

/** State for the voluntary `commonerExchange` phase (§5) — null outside that phase. */
export interface CommonerExchangeState {
  participants: CommonerParticipant[];
  pairs: CommonerExchangePair[];
}

export interface TrickPlay {
  seat: SeatIndex;
  cards: Card[];
}

export interface CurrentTrick {
  /** Effective rank of the current best play (min non-joker rank in the set, or 13 for an all-joker set). Null when the trick is empty (no plays yet). */
  rankValue: number | null;
  /** Card count every follow-up play must match exactly. 0 when the trick is empty. */
  count: number;
  plays: TrickPlay[];
  /** Seat that made the current best (most recent accepted) play — leads the next trick once this one resolves. */
  leaderSeat: SeatIndex;
  /** Passes in a row since the last accepted play. Trick resolves once this reaches the number of other still-active seats. */
  consecutivePasses: number;
}

/** UI-only flourish payload — set whenever a trick resolves, not consumed by engine logic. */
export interface TrickResult {
  winnerSeat: SeatIndex;
  rankValue: number;
  count: number;
  plays: TrickPlay[];
}

export interface DalmutiState {
  playerCount: number;
  players: PlayerState[];
  /** rankOrder[0] = 왕(King)'s seat .. rankOrder[n-1] = 노예(Slave)'s seat. Decided once at game start; only a grand revolution (§ above) reverses it, also once. */
  rankOrder: SeatIndex[];
  phase: Phase;
  pendingRevolution: RevolutionInfo | null;
  /** Set once (either immediately at deal, or after `declineRevolution`); empty forever if a revolution was declared. */
  tributes: TributeRecord[];
  /** Non-null only during the `commonerExchange` phase (§5); null before it starts and after it resolves into `trick`. */
  commonerExchange: CommonerExchangeState | null;
  trick: CurrentTrick;
  activeSeat: SeatIndex;
  /** Seats in the order they emptied their hand (or were auto-assigned last place). Length === playerCount only once phase is "gameOver". */
  finishOrder: SeatIndex[];
  lastTrickResult: TrickResult | null;
  revolutionDeclared: { seat: SeatIndex; isGrand: boolean } | null;
  initialSeed: number;
}

export type EngineAction =
  | { type: "declareRevolution"; seat: SeatIndex }
  | { type: "declineRevolution"; seat: SeatIndex }
  | { type: "returnTax"; seat: SeatIndex; cardIds: string[] }
  | { type: "commonerOptIn"; seat: SeatIndex; participate: boolean }
  | { type: "commonerOfferCard"; seat: SeatIndex; cardId: string }
  | { type: "playCards"; seat: SeatIndex; cardIds: string[] }
  | { type: "pass"; seat: SeatIndex };

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

/** The full 80-card deck: rank N has exactly N copies for N=1..12 (78 cards), plus 2 jokers (rulebook §1). */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let rank = 1; rank <= MAX_CARD_RANK; rank++) {
    for (let copy = 0; copy < rank; copy++) {
      deck.push({ id: `${rank}-${copy}`, rank, isJoker: false });
    }
  }
  for (let copy = 0; copy < JOKER_COUNT; copy++) {
    deck.push({ id: `joker-${copy}`, rank: JOKER_RANK, isJoker: true });
  }
  return deck;
}

/** Player-standing title for a rank position (0-based, 0 = 왕/King). See §2 for why n=3 folds 거지(Beggar) into 귀족(Noble), and §5 for the 2026-08-25 rename from the rulebook's 달무티/총리/중농/소농노/대농노 titles. */
export function rankTitle(rankPosition: number, playerCount: number): string {
  if (rankPosition === 0) return "왕";
  if (rankPosition === playerCount - 1) return "노예";
  if (rankPosition === 1) return "귀족";
  if (rankPosition === playerCount - 2) return "거지";
  return "평민";
}

export function rankPositionOfSeat(state: DalmutiState, seat: SeatIndex): number {
  return state.rankOrder.indexOf(seat);
}

function findPlayer(state: DalmutiState, seat: SeatIndex): PlayerState | undefined {
  return state.players.find((p) => p.seat === seat);
}

function activeSeatsWithCards(players: PlayerState[]): SeatIndex[] {
  return players.filter((p) => p.finishedAtOrder === null).map((p) => p.seat);
}

/** Next seat in rank order (clockwise from the 왕/King), skipping any seat that has already emptied its hand. */
function nextActiveSeatInRankOrder(state: DalmutiState, fromSeat: SeatIndex): SeatIndex {
  const order = state.rankOrder;
  const n = order.length;
  const startIdx = order.indexOf(fromSeat);
  let i = (startIdx + 1) % n;
  let guard = 0;
  while (guard < n) {
    const seat = order[i];
    if (findPlayer(state, seat)!.finishedAtOrder === null) return seat;
    i = (i + 1) % n;
    guard++;
  }
  return fromSeat; // unreachable in practice — caller only invokes this while >= 2 active seats remain
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function determineInitialRankOrder(playerCount: number, rng: () => number): SeatIndex[] {
  const seats = Array.from({ length: playerCount }, (_, i) => i);
  return shuffle(seats, rng);
}

/** Rulebook §3-1: shuffle the full deck and deal evenly starting from the 왕(King), clockwise; any remainder is set aside untouched for the rest of the game. */
function dealCards(rankOrder: SeatIndex[], rng: () => number): Map<SeatIndex, Card[]> {
  const deck = shuffle(buildDeck(), rng);
  const n = rankOrder.length;
  const perPlayer = Math.floor(deck.length / n);
  const hands = new Map<SeatIndex, Card[]>();
  rankOrder.forEach((seat, i) => {
    hands.set(seat, deck.slice(i * perPlayer, (i + 1) * perPlayer));
  });
  return hands;
}

/** Highest-ranked (smallest number) non-joker cards in `hand`, up to `count` — the automatic, no-choice tribute selection (jokers are exempt, rulebook §3 note). */
function selectHighestCards(hand: Card[], count: number): Card[] {
  const eligible = hand.filter((c) => !c.isJoker);
  const sorted = [...eligible].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return sorted.slice(0, count);
}

/** Rulebook §3 (roles renamed per §5): 노예(Slave)→왕(King) (2 cards) always; 거지(Beggar)→귀족(Noble) (1 card) only when those are distinct seats (n >= 4, see §2). */
function computeTributes(players: PlayerState[], rankOrder: SeatIndex[]): TributeRecord[] {
  const n = rankOrder.length;
  const dalmutiSeat = rankOrder[0];
  const greatPeonSeat = rankOrder[n - 1];
  const records: TributeRecord[] = [];

  const greatPeon = players.find((p) => p.seat === greatPeonSeat)!;
  records.push({
    fromSeat: greatPeonSeat,
    toSeat: dalmutiSeat,
    givenCardIds: selectHighestCards(greatPeon.hand, 2).map((c) => c.id),
    returnedCardIds: [],
    resolved: false,
  });

  if (n >= 4) {
    const archbishopSeat = rankOrder[1];
    const lesserPeonSeat = rankOrder[n - 2];
    const lesserPeon = players.find((p) => p.seat === lesserPeonSeat)!;
    records.push({
      fromSeat: lesserPeonSeat,
      toSeat: archbishopSeat,
      givenCardIds: selectHighestCards(lesserPeon.hand, 1).map((c) => c.id),
      returnedCardIds: [],
      resolved: false,
    });
  }

  return records;
}

/** Moves each tribute's `givenCardIds` from giver to recipient immediately — the forced half of the exchange has no player choice. */
function applyForcedTribute(players: PlayerState[], tributes: TributeRecord[]): PlayerState[] {
  let next = players;
  for (const t of tributes) {
    if (t.givenCardIds.length === 0) continue;
    const giverIdSet = new Set(t.givenCardIds);
    const giver = next.find((p) => p.seat === t.fromSeat)!;
    const movingCards = giver.hand.filter((c) => giverIdSet.has(c.id));
    next = next.map((p) => {
      if (p.seat === t.fromSeat) return { ...p, hand: p.hand.filter((c) => !giverIdSet.has(c.id)) };
      if (p.seat === t.toSeat) return { ...p, hand: [...p.hand, ...movingCards] };
      return p;
    });
  }
  return next;
}

function emptyTrick(leaderSeat: SeatIndex): CurrentTrick {
  return { rankValue: null, count: 0, plays: [], leaderSeat, consecutivePasses: 0 };
}

export function startGame(playerCount: number, seed: number): DalmutiState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const rankOrder = determineInitialRankOrder(playerCount, rng);
  const hands = dealCards(rankOrder, rng);
  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    hand: hands.get(seat) ?? [],
    finishedAtOrder: null,
  }));

  const base: Omit<DalmutiState, "phase" | "pendingRevolution" | "tributes" | "players"> = {
    playerCount,
    rankOrder,
    commonerExchange: null,
    trick: emptyTrick(rankOrder[0]),
    activeSeat: rankOrder[0],
    finishOrder: [],
    lastTrickResult: null,
    revolutionDeclared: null,
    initialSeed: seed,
  };

  const jokerHolder = players.find((p) => p.hand.filter((c) => c.isJoker).length === JOKER_COUNT);
  if (jokerHolder) {
    const isGrand = rankOrder[playerCount - 1] === jokerHolder.seat;
    return {
      ...base,
      players,
      phase: "revolutionOption",
      pendingRevolution: { seat: jokerHolder.seat, isGrand },
      tributes: [],
    };
  }

  return enterTaxPhase({ ...base, players, phase: "revolutionOption", pendingRevolution: null, tributes: [] });
}

/** Shared by `startGame` (no revolution possible) and `declineRevolution`: compute + immediately hand over the forced tribute, then wait for the recipient(s) to choose what to give back. */
function enterTaxPhase(state: DalmutiState): DalmutiState {
  const tributes = computeTributes(state.players, state.rankOrder);
  const players = applyForcedTribute(state.players, tributes);
  return { ...state, players, tributes, pendingRevolution: null, phase: "taxReturn" };
}

// ---------------------------------------------------------------------------
// Revolution
// ---------------------------------------------------------------------------

function declareRevolution(state: DalmutiState, seat: SeatIndex): DalmutiState {
  if (state.phase !== "revolutionOption" || !state.pendingRevolution || state.pendingRevolution.seat !== seat) return state;
  const { isGrand } = state.pendingRevolution;
  const rankOrder = isGrand ? [...state.rankOrder].reverse() : state.rankOrder;
  // Revolution cancels the *forced* tribute only (rulebook §3-2) — the
  // voluntary commoner exchange (§5) still runs, against the new rankOrder
  // if this was a grand revolution.
  return enterCommonerExchangePhase({
    ...state,
    rankOrder,
    pendingRevolution: null,
    revolutionDeclared: { seat, isGrand },
    tributes: [],
  });
}

function declineRevolution(state: DalmutiState, seat: SeatIndex): DalmutiState {
  if (state.phase !== "revolutionOption" || !state.pendingRevolution || state.pendingRevolution.seat !== seat) return state;
  return enterTaxPhase(state);
}

// ---------------------------------------------------------------------------
// Tax return
// ---------------------------------------------------------------------------

function returnTax(state: DalmutiState, seat: SeatIndex, cardIds: string[]): DalmutiState {
  if (state.phase !== "taxReturn") return state;
  const record = state.tributes.find((t) => t.toSeat === seat && !t.resolved);
  if (!record) return state;
  if (cardIds.length !== record.givenCardIds.length) return state;

  const idSet = new Set(cardIds);
  if (idSet.size !== cardIds.length) return state;
  const recipient = findPlayer(state, seat)!;
  if (![...idSet].every((id) => recipient.hand.some((c) => c.id === id))) return state;

  const movingCards = recipient.hand.filter((c) => idSet.has(c.id));
  const players = state.players.map((p) => {
    if (p.seat === seat) return { ...p, hand: p.hand.filter((c) => !idSet.has(c.id)) };
    if (p.seat === record.fromSeat) return { ...p, hand: [...p.hand, ...movingCards] };
    return p;
  });
  const tributes = state.tributes.map((t) => (t === record ? { ...t, returnedCardIds: cardIds, resolved: true } : t));
  const allResolved = tributes.every((t) => t.resolved);
  const next = { ...state, players, tributes };

  return allResolved ? enterCommonerExchangePhase(next) : { ...next, phase: "taxReturn" as const };
}

// ---------------------------------------------------------------------------
// Commoner mutual exchange (§5) — voluntary, 평민(Commoner)-tier seats only.
// ---------------------------------------------------------------------------

function startTrickPhase(state: DalmutiState): DalmutiState {
  return { ...state, phase: "trick", commonerExchange: null, trick: emptyTrick(state.rankOrder[0]), activeSeat: state.rankOrder[0] };
}

/** Seats at rank positions strictly between 귀족(Noble, position 1) and 거지(Beggar, position n-2) — exactly the positions `rankTitle` labels 평민(Commoner). Empty for n <= 4. */
function commonerSeats(rankOrder: SeatIndex[]): SeatIndex[] {
  const n = rankOrder.length;
  const seats: SeatIndex[] = [];
  for (let pos = 2; pos <= n - 3; pos++) seats.push(rankOrder[pos]);
  return seats;
}

/** Entered after the forced tribute resolves (or is skipped by a revolution). Fewer than 2 commoners means no possible pair, so it skips straight to `trick`. */
function enterCommonerExchangePhase(state: DalmutiState): DalmutiState {
  const seats = commonerSeats(state.rankOrder);
  if (seats.length < 2) return startTrickPhase(state);
  return {
    ...state,
    phase: "commonerExchange",
    commonerExchange: { participants: seats.map((seat) => ({ seat, participate: null })), pairs: [] },
  };
}

function commonerOptIn(state: DalmutiState, seat: SeatIndex, participate: boolean): DalmutiState {
  if (state.phase !== "commonerExchange" || !state.commonerExchange) return state;
  const ex = state.commonerExchange;
  const idx = ex.participants.findIndex((p) => p.seat === seat);
  if (idx === -1 || ex.participants[idx].participate !== null) return state;

  const participants = ex.participants.map((p, i) => (i === idx ? { ...p, participate } : p));
  if (participants.some((p) => p.participate === null)) {
    return { ...state, commonerExchange: { ...ex, participants } };
  }

  // Everyone has answered — pair up every seat that opted in, two at a time
  // in rank order (no partner selection, per user confirmation); an odd
  // leftover simply sits out with no exchange this round.
  const opted = participants.filter((p) => p.participate).map((p) => p.seat);
  opted.sort((a, b) => state.rankOrder.indexOf(a) - state.rankOrder.indexOf(b));
  const pairs: CommonerExchangePair[] = [];
  for (let i = 0; i + 1 < opted.length; i += 2) {
    pairs.push({ seatA: opted[i], seatB: opted[i + 1], cardIdA: null, cardIdB: null, resolved: false });
  }

  if (pairs.length === 0) return startTrickPhase(state);
  return { ...state, commonerExchange: { participants, pairs } };
}

function commonerOfferCard(state: DalmutiState, seat: SeatIndex, cardId: string): DalmutiState {
  if (state.phase !== "commonerExchange" || !state.commonerExchange) return state;
  const ex = state.commonerExchange;
  const pairIdx = ex.pairs.findIndex((p) => !p.resolved && (p.seatA === seat || p.seatB === seat));
  if (pairIdx === -1) return state;
  const pair = ex.pairs[pairIdx];
  const isA = pair.seatA === seat;
  if (isA ? pair.cardIdA !== null : pair.cardIdB !== null) return state;
  const player = findPlayer(state, seat);
  if (!player || !player.hand.some((c) => c.id === cardId)) return state;

  let updatedPair: CommonerExchangePair = isA ? { ...pair, cardIdA: cardId } : { ...pair, cardIdB: cardId };
  let players = state.players;

  // Both sides have now privately picked — swap immediately (neither side
  // ever observes the other's pick before committing their own, satisfying
  // the task brief's "비공개로 맞교환").
  if (updatedPair.cardIdA !== null && updatedPair.cardIdB !== null) {
    const cardAId = updatedPair.cardIdA;
    const cardBId = updatedPair.cardIdB;
    const cardFromA = findPlayer(state, pair.seatA)!.hand.find((c) => c.id === cardAId)!;
    const cardFromB = findPlayer(state, pair.seatB)!.hand.find((c) => c.id === cardBId)!;
    players = state.players.map((p) => {
      if (p.seat === pair.seatA) return { ...p, hand: [...p.hand.filter((c) => c.id !== cardAId), cardFromB] };
      if (p.seat === pair.seatB) return { ...p, hand: [...p.hand.filter((c) => c.id !== cardBId), cardFromA] };
      return p;
    });
    updatedPair = { ...updatedPair, resolved: true };
  }

  const pairs = ex.pairs.map((p, i) => (i === pairIdx ? updatedPair : p));
  const next = { ...state, players, commonerExchange: { ...ex, pairs } };
  return pairs.every((p) => p.resolved) ? startTrickPhase(next) : next;
}

// ---------------------------------------------------------------------------
// Legal-play predicate — pure derived value, drives both validation and the
// UI's "which cards can I click" highlight (task brief §2).
// ---------------------------------------------------------------------------

/**
 * Rulebook §3-4: the trick's leader may play any nonempty same-rank set
 * (jokers may pad the count, or stand alone as rank 13). A follower must
 * match the exact card count and use a strictly *lower* rank number (higher
 * class) than the current trick.
 */
export function isLegalPlay(state: DalmutiState, seat: SeatIndex, cardIds: string[]): boolean {
  if (state.phase !== "trick" || state.activeSeat !== seat || cardIds.length === 0) return false;
  const idSet = new Set(cardIds);
  if (idSet.size !== cardIds.length) return false;
  const player = findPlayer(state, seat);
  if (!player) return false;
  const cards = player.hand.filter((c) => idSet.has(c.id));
  if (cards.length !== cardIds.length) return false;

  const nonJokers = cards.filter((c) => !c.isJoker);
  const distinctRanks = new Set(nonJokers.map((c) => c.rank));
  if (distinctRanks.size > 1) return false;

  const rankValue = distinctRanks.size === 1 ? [...distinctRanks][0] : JOKER_RANK;
  const count = cards.length;

  if (state.trick.count === 0) return true;
  return count === state.trick.count && rankValue < state.trick.rankValue!;
}

export interface LegalRankOption {
  /** The rank this option would play as (1-12 for a real-rank set, or 13 for an all-joker set). */
  rank: number;
  /** Real (non-joker) cards of this rank in hand. */
  cardIds: string[];
  /** Jokers in hand available to pad this set's count. */
  jokerCardIds: string[];
  /** Exact count required to follow the current trick; 0 while leading (any nonempty count is legal). */
  requiredCount: number;
  maxCount: number;
}

/** UI helper: which rank-groups the active seat could currently build a legal play from — drives the "선택 가능한 조합만 클릭 가능" highlight (task brief §2). Authoritative validation still goes through `isLegalPlay`. */
export function legalPlayOptions(state: DalmutiState, seat: SeatIndex): LegalRankOption[] {
  if (state.phase !== "trick" || state.activeSeat !== seat) return [];
  const player = findPlayer(state, seat);
  if (!player || player.hand.length === 0) return [];

  const jokerCardIds = player.hand.filter((c) => c.isJoker).map((c) => c.id);
  const byRank = new Map<number, string[]>();
  for (const c of player.hand) {
    if (c.isJoker) continue;
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank)!.push(c.id);
  }

  const leading = state.trick.count === 0;
  const options: LegalRankOption[] = [];
  for (const [rank, cardIds] of byRank) {
    const maxCount = cardIds.length + jokerCardIds.length;
    if (leading) {
      options.push({ rank, cardIds, jokerCardIds, requiredCount: 0, maxCount });
    } else if (rank < state.trick.rankValue! && maxCount >= state.trick.count) {
      options.push({ rank, cardIds, jokerCardIds, requiredCount: state.trick.count, maxCount });
    }
  }
  if (leading && jokerCardIds.length > 0) {
    options.push({ rank: JOKER_RANK, cardIds: [], jokerCardIds, requiredCount: 0, maxCount: jokerCardIds.length });
  }
  return options.sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// Trick play
// ---------------------------------------------------------------------------

function playCards(state: DalmutiState, seat: SeatIndex, cardIds: string[]): DalmutiState {
  if (!isLegalPlay(state, seat, cardIds)) return state;

  const player = findPlayer(state, seat)!;
  const idSet = new Set(cardIds);
  const cards = player.hand.filter((c) => idSet.has(c.id));
  const hand = player.hand.filter((c) => !idSet.has(c.id));
  const nonJokerRanks = new Set(cards.filter((c) => !c.isJoker).map((c) => c.rank));
  const rankValue = nonJokerRanks.size > 0 ? Math.min(...nonJokerRanks) : JOKER_RANK;

  const finishedNow = hand.length === 0;
  let finishOrder = state.finishOrder;
  const players = state.players.map((p) => {
    if (p.seat !== seat) return p;
    const finishedAtOrder = finishedNow ? finishOrder.length + 1 : null;
    return { ...p, hand, finishedAtOrder };
  });
  if (finishedNow) finishOrder = [...finishOrder, seat];

  const trick: CurrentTrick = {
    rankValue,
    count: cards.length,
    plays: [...state.trick.plays, { seat, cards }],
    leaderSeat: seat,
    consecutivePasses: 0,
  };

  const remaining = activeSeatsWithCards(players);
  if (remaining.length <= 1) {
    if (remaining.length === 1) finishOrder = [...finishOrder, remaining[0]];
    return { ...state, players, trick, finishOrder, phase: "gameOver", activeSeat: seat };
  }

  const nextState = { ...state, players, trick, finishOrder };
  return { ...nextState, activeSeat: nextActiveSeatInRankOrder(nextState, seat) };
}

function pass(state: DalmutiState, seat: SeatIndex): DalmutiState {
  if (state.phase !== "trick" || state.activeSeat !== seat || state.trick.count === 0) return state;

  const leaderSeat = state.trick.leaderSeat;
  const consecutivePasses = state.trick.consecutivePasses + 1;
  const otherActiveCount = activeSeatsWithCards(state.players).filter((s) => s !== leaderSeat).length;

  if (consecutivePasses >= otherActiveCount) {
    const winner = findPlayer(state, leaderSeat)!;
    const lastTrickResult: TrickResult = {
      winnerSeat: leaderSeat,
      rankValue: state.trick.rankValue!,
      count: state.trick.count,
      plays: state.trick.plays,
    };
    const newLeadSeat = winner.finishedAtOrder !== null ? nextActiveSeatInRankOrder(state, leaderSeat) : leaderSeat;
    return { ...state, trick: emptyTrick(newLeadSeat), activeSeat: newLeadSeat, lastTrickResult };
  }

  return { ...state, trick: { ...state.trick, consecutivePasses }, activeSeat: nextActiveSeatInRankOrder(state, seat) };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: DalmutiState, action: EngineAction): DalmutiState {
  switch (action.type) {
    case "declareRevolution":
      return declareRevolution(state, action.seat);
    case "declineRevolution":
      return declineRevolution(state, action.seat);
    case "returnTax":
      return returnTax(state, action.seat, action.cardIds);
    case "commonerOptIn":
      return commonerOptIn(state, action.seat, action.participate);
    case "commonerOfferCard":
      return commonerOfferCard(state, action.seat, action.cardId);
    case "playCards":
      return playCards(state, action.seat, action.cardIds);
    case "pass":
      return pass(state, action.seat);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Final scoring
// ---------------------------------------------------------------------------

export interface RankedPlayer {
  seat: SeatIndex;
  rank: number;
}

/** Only meaningful once `state.phase === "gameOver"`: `finishOrder` is already a strict permutation of every seat (rulebook §4 "카드를 털어낸 순서대로 2등, 3등... 꼴찌"), so no tie-handling is needed here (unlike round-based elimination games in this project). */
export function computeRankings(state: DalmutiState): RankedPlayer[] {
  return state.finishOrder.map((seat, i) => ({ seat, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). Every phase (revolution
// decision, tax return, commoner exchange opt-in/card pick, trick
// play/pass) only ever asks the bot to judge its own hand +
// already-public trick/tribute/exchange state — no other seat's hidden
// hand is ever read.
// ---------------------------------------------------------------------------

/** All k-element subsets of `items` (order-independent, small k only — used for tax-return combos where k is 1 or 2). */
function combinations(items: string[], k: number): string[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

/** Expands one `legalPlayOptions` rank-group into concrete card-id sets for each legal count (leading: every count 1..maxCount; following: only the fixed required count), padding with jokers once real cards of that rank run out. */
function buildRankCandidates(option: LegalRankOption): string[][] {
  const { cardIds, jokerCardIds, maxCount, requiredCount } = option;
  const counts = requiredCount === 0 ? Array.from({ length: maxCount }, (_, i) => i + 1) : [requiredCount];
  const results: string[][] = [];
  for (const count of counts) {
    if (count < 1 || count > maxCount) continue;
    if (count <= cardIds.length) {
      results.push(cardIds.slice(0, count));
    } else {
      results.push([...cardIds, ...jokerCardIds.slice(0, count - cardIds.length)]);
    }
  }
  return results;
}

export function getValidMoves(state: DalmutiState, seat: SeatIndex): EngineAction[] {
  if (state.phase === "revolutionOption") {
    if (!state.pendingRevolution || state.pendingRevolution.seat !== seat) return [];
    return [
      { type: "declareRevolution", seat },
      { type: "declineRevolution", seat },
    ];
  }

  if (state.phase === "taxReturn") {
    const record = state.tributes.find((t) => t.toSeat === seat && !t.resolved);
    if (!record) return [];
    const player = findPlayer(state, seat);
    if (!player) return [];
    return combinations(
      player.hand.map((c) => c.id),
      record.givenCardIds.length,
    ).map((cardIds) => ({ type: "returnTax", seat, cardIds }) as EngineAction);
  }

  if (state.phase === "commonerExchange") {
    const ex = state.commonerExchange;
    if (!ex) return [];
    const participant = ex.participants.find((p) => p.seat === seat);
    if (participant && participant.participate === null) {
      return [
        { type: "commonerOptIn", seat, participate: true },
        { type: "commonerOptIn", seat, participate: false },
      ];
    }
    const pair = ex.pairs.find((p) => !p.resolved && (p.seatA === seat || p.seatB === seat));
    if (pair) {
      const isA = pair.seatA === seat;
      const alreadyPicked = isA ? pair.cardIdA : pair.cardIdB;
      if (alreadyPicked === null) {
        const player = findPlayer(state, seat);
        if (player) return player.hand.map((c) => ({ type: "commonerOfferCard", seat, cardId: c.id }) as EngineAction);
      }
    }
    return [];
  }

  if (state.phase === "trick") {
    if (state.activeSeat !== seat) return [];
    const moves: EngineAction[] = [];
    for (const option of legalPlayOptions(state, seat)) {
      for (const cardIds of buildRankCandidates(option)) {
        moves.push({ type: "playCards", seat, cardIds });
      }
    }
    if (state.trick.count > 0) moves.push({ type: "pass", seat });
    return moves;
  }

  return [];
}

/**
 * Higher = more desirable for the bot. Tiers per ARCHITECTURE.md §7.5:
 * novice ~ uniform over legal moves; core applies simple single-factor
 * rules (dump low-value cards, conserve small counts, return your weakest
 * cards as tax); expert (Lv.8-10, per the task brief) optimizes the tax
 * exchange, maximizes same-rank-plus-joker "대량 털기" dumps while leading a
 * trick, and is choosier about spending jokers.
 */
export function scoreMove(state: DalmutiState, seat: SeatIndex, move: EngineAction, tier: BotTier): number {
  if (tier === "novice") return 0;
  const player = findPlayer(state, seat);
  if (!player) return 0;

  if (move.type === "declareRevolution" || move.type === "declineRevolution") {
    const info = state.pendingRevolution;
    if (!info) return 0;
    if (info.isGrand) return move.type === "declareRevolution" ? 1000 : -1000; // flips this seat straight to 왕(King).
    // Non-grand: declaring skips the tax phase entirely this round — good
    // for whoever would have owed tribute, bad for whoever would have
    // received it.
    const pos = rankPositionOfSeat(state, seat);
    const n = state.playerCount;
    let delta = 0;
    if (pos === n - 1) delta = 60; // 노예(Slave): skips giving away its 2 best cards.
    else if (pos === n - 2 && n >= 4) delta = 30; // 거지(Beggar): skips giving away 1 card.
    else if (pos === 0) delta = -60; // 왕(King): loses its free 2-card tribute.
    else if (pos === 1 && n >= 4) delta = -30; // 귀족(Noble): loses its free 1-card tribute.
    return move.type === "declareRevolution" ? delta : -delta;
  }

  if (move.type === "returnTax") {
    // Give back the weakest cards possible (highest rank number); jokers
    // are far too valuable to hand back voluntarily.
    let score = 0;
    for (const id of move.cardIds) {
      const card = player.hand.find((c) => c.id === id);
      if (!card) continue;
      score += card.isJoker ? -1000 : card.rank;
    }
    return score;
  }

  if (move.type === "commonerOptIn") {
    // Mildly prefer trying the swap — a real gamble either way since a
    // commoner can't see what their (randomly matched) partner will offer,
    // so there's no sharper signal to score this on.
    return move.participate ? 5 : 0;
  }

  if (move.type === "commonerOfferCard") {
    // Same "give away the weakest card, keep jokers" heuristic as returnTax.
    const card = player.hand.find((c) => c.id === move.cardId);
    if (!card) return 0;
    return card.isJoker ? -1000 : card.rank;
  }

  if (move.type === "pass") {
    const options = legalPlayOptions(state, seat);
    const everyOptionNeedsAJoker = options.length > 0 && options.every((o) => o.cardIds.length < o.requiredCount);
    let score = -5; // mild default preference to play over pass when a reasonable option exists.
    if (tier === "expert" && everyOptionNeedsAJoker) score += 20; // save the joker for a better trick instead.
    return score;
  }

  // playCards
  const idSet = new Set(move.cardIds);
  const cards = player.hand.filter((c) => idSet.has(c.id));
  const nonJokerRanks = new Set(cards.filter((c) => !c.isJoker).map((c) => c.rank));
  const rankValue = nonJokerRanks.size > 0 ? Math.min(...nonJokerRanks) : JOKER_RANK;
  const usesJoker = cards.some((c) => c.isJoker);
  const count = cards.length;
  const finishedNow = player.hand.length - count === 0;
  const leading = state.trick.count === 0;

  if (leading) {
    let score =
      tier === "expert"
        ? count * 15 + rankValue - (usesJoker ? 5 : 0) // expert: maximize the "대량 털기" dump size while leading.
        : rankValue * 2 - count * 8; // core: conserve hand size, just shed the weakest cards a few at a time.
    if (finishedNow) score += 1000;
    return score;
  }

  // Following: use the weakest card that still legally beats the trick
  // (highest rankValue among the legal — already-filtered — options),
  // saving stronger cards and jokers for later.
  let score = rankValue * 3;
  score -= usesJoker ? (tier === "expert" && !finishedNow ? 60 : 30) : 0;
  if (finishedNow) score += 1000; // going out first wins the whole round.
  return score;
}

export function chooseBotAction(
  state: DalmutiState,
  seat: SeatIndex,
  level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}
