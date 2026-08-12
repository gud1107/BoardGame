/**
 * Pure "포세일(For Sale)" rules engine — no React, no I/O. Implements the
 * rulebook at boardGameRule/포세일/포세일.md: a two-phase real-estate auction
 * game (Stefan Dorra) — Phase 1 bids up 30 numbered property cards with an
 * "everyone-can-pass-for-a-half-refund" English auction, Phase 2 blind-sells
 * those properties for cash checks, and the richest total (checks + leftover
 * cash) wins.
 *
 * Same online-multiplayer trust model as every other game in this project
 * (see Perudo/Avalon/Coyote's module docs): every connected client computes
 * and holds the FULL state (every seat's hand, every secret Phase-2
 * submission) from a shared RNG seed plus replayed `EngineAction`s — there is
 * no server authority. Phase-2's "카드 비공개 동시 제출" secrecy (a seat
 * shouldn't see others' submitted property card until everyone has submitted)
 * is enforced purely at the view layer via `getPlayerView` below, exactly
 * like Coyote's forehead-card redaction — nothing is ever actually hidden
 * inside `ForSaleState` itself once submitted.
 *
 * Documented assumptions/inferences (the rulebook doesn't spell these out, or
 * is internally inconsistent about them):
 *
 * 1. **Check card face values.** The rulebook states "총 30장", "$0부터
 *    $15,000까지", "$2,000 단위로 구성", "각 금액당 2장씩 존재($0 포함)" — but
 *    these four constraints can't all be simultaneously true ($0 to $15,000
 *    in $2,000 steps never lands exactly on $15,000, and even if it did that
 *    would be 8 distinct values × 2 = 16 cards, not 30; 15 distinct values ×
 *    2 = 30 cards requires a different step). This isn't a rulebook-vs-brief
 *    conflict (the task brief repeats the identical inconsistent numbers) —
 *    it's the rulebook contradicting itself. Resolved by keeping the three
 *    constraints that actually matter for the auction/scoring math ("총
 *    30장", "$0 포함", "각 금액당 2장씩") exactly, using $1,000 steps from $0
 *    to $14,000 (15 values × 2 = 30 cards) — closest clean sequence to the
 *    stated range. No FAQ example ever computes with the literal top card, so
 *    nothing downstream depends on it being exactly "$15,000".
 * 2. **Starting cash "차등 지급".** The task brief frames starting cash as
 *    varying by player count, but the rulebook's own setup table (§3) gives
 *    every player count (3/4/5/6) the same flat $14,000 — only the *cards
 *    removed* varies by count, not the cash. Rulebook wins per
 *    ARCHITECTURE.md §5 (`PLAYER_SETUP` below reflects the flat amount).
 * 3. **4-player card removal (structural correction).** The rulebook's setup
 *    table (§3) says 4 players use "제거 없음 (30장 모두 사용)", but §4's
 *    "카드 공개" step requires exactly `playerCount` cards revealed per
 *    auction/sale round with none left over (30 isn't divisible by 4 — a
 *    partial final round of 2 cards for 4 bidders has no coherent auction
 *    resolution, since a passing bidder always needs a card to take). Every
 *    *other* player count in the same table (3/5/6) already divides evenly
 *    (24/3=8, 30/5=6, 24/6=4), so the 4-player row is treated as the
 *    rulebook's error and corrected the same way as its siblings: remove 2
 *    random property cards **and** 2 random check cards (→ 28 of each,
 *    28/4=7 clean rounds) — the smallest fix restoring the invariant every
 *    other row already satisfies.
 * 4. **Auction turn order / round starter.** "가장 최근에 이사한 사람(또는
 *    임의의 선 플레이어)" for the very first round has no shared meaning
 *    online, so — same convention as Avalon/Perudo/No Thanks/Coyote — it's
 *    drawn from the shared seed. Each subsequent round's starter is that
 *    round's auction winner (rulebook §4-1-3, explicit). Phase 2 has no
 *    "starter"/turn order at all — every submission is simultaneous.
 * 5. **Pass refund rounds to the nearest $1,000 chip, not the nearest
 *    dollar.** The rulebook's FAQ gives an explicit formula box —
 *    `지불 금액 = ⌊입찰금 ÷ 2⌋` — but that formula doesn't match its own two
 *    worked examples: a $3,000 bid pays "$1,000" (⌊3000/2⌋ would be $1,500)
 *    and a $5,000 bid pays "$2,000" (⌊5000/2⌋ would be $2,500). Both examples
 *    are only consistent with flooring in $1,000-coin units first
 *    (`⌊bid / $2,000⌋ × $1,000`, see `pass()`), which also matches §2's coin
 *    denominations ($1,000/$2,000 only — there's no $500 coin to make exact
 *    change for an odd $1,000-multiple). The concrete worked examples are
 *    treated as authoritative over the mislabeled formula box.
 */

export type SeatIndex = number;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const PROPERTY_COUNT = 30;
export const BID_INCREMENT = 1000;

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

// ---------------------------------------------------------------------------
// Setup tables
// ---------------------------------------------------------------------------

/** Flat starting cash + how many of the 30 property/check cards are actually used, per player count — see module doc assumptions #2/#3. */
export const PLAYER_SETUP: Record<number, { cash: number; cardsUsed: number }> = {
  3: { cash: 14000, cardsUsed: 24 },
  4: { cash: 14000, cardsUsed: 28 },
  5: { cash: 14000, cardsUsed: 30 },
  6: { cash: 14000, cardsUsed: 24 },
};

/** 15 distinct values ($0..$14,000, $1,000 apart) × 2 copies = 30 — see module doc assumption #1. */
export function buildCheckDeck(): number[] {
  const values: number[] = [];
  for (let v = 0; v <= 14000; v += 1000) values.push(v, v);
  return values;
}

export const CHECK_DECK_SIZE = buildCheckDeck().length; // 30, verified in ForSale.test.ts

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PlayerState {
  seat: SeatIndex;
  cash: number;
  /** Property card numbers currently held (unsold), unordered. */
  properties: number[];
  /** Check card values already won in Phase 2. */
  checks: number[];
}

export interface AuctionRoundResult {
  /** Every card dealt this round, in the order it was claimed (pass order), plus the final winner. */
  passes: { seat: SeatIndex; card: number; refundPaid: number }[];
  winnerSeat: SeatIndex;
  winnerCard: number;
  winnerPaid: number;
}

export interface AuctionState {
  /** This round's open property cards, always kept ascending for display (rulebook §4-1-1). */
  openCards: number[];
  currentBid: number;
  highBidderSeat: SeatIndex | null;
  /** Each seat's own last bid this round (0/absent if they never bid before passing) — needed for the half-refund-on-pass rule, which refunds the passer's *own* last bid, not the table's current high bid. */
  bidsBySeat: Record<SeatIndex, number>;
  /** Seats still bidding this round, in original seating order (not shrunk-and-reindexed). */
  activeSeats: SeatIndex[];
  activeSeat: SeatIndex;
  /** Every pass resolved so far this round, in order — accumulated so `AuctionRoundResult.passes` can show the whole round once the last bidder wins, not just their final pass. */
  passesThisRound: { seat: SeatIndex; card: number; refundPaid: number }[];
}

export interface SaleAssignment {
  seat: SeatIndex;
  property: number;
  check: number;
}

export interface SaleRoundResult {
  /** Ranked descending by property value — index 0 got the highest check. */
  assignments: SaleAssignment[];
}

export interface SaleState {
  /** This round's open check cards, always kept ascending for display (rulebook §4-2-1). */
  openChecks: number[];
  /** seat -> submitted property value, secret until every seat has one (see `getPlayerView`). */
  submissions: Partial<Record<SeatIndex, number>>;
  /** True once all seats have submitted and this round has been scored — `lastSaleResult` holds the outcome, waiting for `continueSale` to advance. */
  revealed: boolean;
}

export type Phase = "buying" | "selling" | "gameOver";

export interface ForSaleState {
  playerCount: number;
  players: PlayerState[];
  /** Undealt property cards, in shuffled deal order (NOT sorted — each round's `openCards` is sorted separately for display). */
  propertyDeck: number[];
  /** Undealt check cards, in shuffled deal order. */
  checkDeck: number[];
  phase: Phase;
  auction: AuctionState | null;
  sale: SaleState | null;
  /** Which seat starts the current (or, once resolved, next) Phase-1 auction round. */
  roundStarter: SeatIndex;
  /** Most recently resolved Phase-1 round, kept around for the UI to animate — overwritten every round. */
  lastAuctionResult: AuctionRoundResult | null;
  /** Most recently resolved Phase-2 round, kept around for the UI to animate — overwritten every round. */
  lastSaleResult: SaleRoundResult | null;
}

export type EngineAction =
  | { type: "bid"; seat: SeatIndex; amount: number }
  | { type: "pass"; seat: SeatIndex }
  | { type: "submitCard"; seat: SeatIndex; property: number }
  | { type: "continueSale" };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function dealAuctionRound(propertyDeck: number[], playerCount: number, starter: SeatIndex): { auction: AuctionState; remainingDeck: number[] } {
  const openCards = [...propertyDeck.slice(0, playerCount)].sort((a, b) => a - b);
  const remainingDeck = propertyDeck.slice(playerCount);
  const activeSeats = Array.from({ length: playerCount }, (_, i) => (starter + i) % playerCount);
  return {
    auction: { openCards, currentBid: 0, highBidderSeat: null, bidsBySeat: {}, activeSeats, activeSeat: starter, passesThisRound: [] },
    remainingDeck,
  };
}

function dealSaleRound(checkDeck: number[], playerCount: number): { sale: SaleState; remainingDeck: number[] } {
  const openChecks = [...checkDeck.slice(0, playerCount)].sort((a, b) => a - b);
  const remainingDeck = checkDeck.slice(playerCount);
  return { sale: { openChecks, submissions: {}, revealed: false }, remainingDeck };
}

export function startGame(playerCount: number, seed: number): ForSaleState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const setup = PLAYER_SETUP[playerCount];
  const rng = seededRng(seed);

  const fullPropertyDeck = Array.from({ length: PROPERTY_COUNT }, (_, i) => i + 1);
  const propertyDeck = shuffle(fullPropertyDeck, rng).slice(0, setup.cardsUsed);
  const checkDeck = shuffle(buildCheckDeck(), rng).slice(0, setup.cardsUsed);

  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    cash: setup.cash,
    properties: [],
    checks: [],
  }));

  // No physical "가장 최근에 이사한 사람" has meaning online — same convention
  // as every other game here: draw the first starter from the shared seed.
  const starter = Math.floor(rng() * playerCount);
  const { auction, remainingDeck } = dealAuctionRound(propertyDeck, playerCount, starter);

  return {
    playerCount,
    players,
    propertyDeck: remainingDeck,
    checkDeck,
    phase: "buying",
    auction,
    sale: null,
    roundStarter: starter,
    lastAuctionResult: null,
    lastSaleResult: null,
  };
}

// ---------------------------------------------------------------------------
// Derived / view helpers
// ---------------------------------------------------------------------------

function nextActiveSeat(seat: SeatIndex, activeSeats: SeatIndex[], playerCount: number): SeatIndex {
  const active = new Set(activeSeats);
  let next = (seat + 1) % playerCount;
  for (let i = 0; i < playerCount; i++) {
    if (active.has(next)) return next;
    next = (next + 1) % playerCount;
  }
  return seat; // unreachable while >=1 active seat remains, kept only as a safe fallback
}

/**
 * What `viewerSeat` is allowed to see of Phase 2's blind submissions right
 * now (task brief §"Blind Reveal"). While a sale round is still collecting
 * submissions (`sale.revealed === false`), every *other* seat's submitted
 * property card is redacted to `null` (their own is always visible to them);
 * once `revealed` flips true every submission is visible to everyone.
 * Mirrors Coyote's `getPlayerView` — `ForSaleState` itself never actually
 * hides anything, this is purely a read-side projection.
 */
export interface VisibleSubmission {
  seat: SeatIndex;
  property: number | null;
}

export function getPlayerView(state: ForSaleState, viewerSeat: SeatIndex): VisibleSubmission[] {
  if (!state.sale) return [];
  const seats = Array.from({ length: state.playerCount }, (_, i) => i);
  return seats.map((seat) => {
    const submitted = state.sale!.submissions[seat];
    const visible = state.sale!.revealed || seat === viewerSeat;
    return { seat, property: visible && submitted !== undefined ? submitted : null };
  });
}

// ---------------------------------------------------------------------------
// Phase 1 — buying (auction)
// ---------------------------------------------------------------------------

/** "입찰(Bid)" — must exceed the current bid by at least `BID_INCREMENT`, and never exceed the bidder's own cash on hand (rulebook §4-1-2-A). */
function bid(state: ForSaleState, seat: SeatIndex, amount: number): ForSaleState {
  if (state.phase !== "buying" || !state.auction) return state;
  const auction = state.auction;
  if (seat !== auction.activeSeat || !auction.activeSeats.includes(seat)) return state;
  if (!Number.isInteger(amount) || amount % BID_INCREMENT !== 0) return state;
  if (amount < auction.currentBid + BID_INCREMENT) return state;
  const player = state.players.find((p) => p.seat === seat);
  if (!player || amount > player.cash) return state;

  return {
    ...state,
    auction: {
      ...auction,
      currentBid: amount,
      highBidderSeat: seat,
      bidsBySeat: { ...auction.bidsBySeat, [seat]: amount },
      activeSeat: nextActiveSeat(seat, auction.activeSeats, state.playerCount),
    },
  };
}

/**
 * "포기(Pass)" — pays half of the passer's own last bid this round (0 if they
 * never bid) and takes the lowest remaining open card (rulebook §4-1-2-B).
 * When exactly one bidder remains, the round resolves immediately: they pay
 * their bid in full and take the single remaining (highest) card (rulebook
 * §4-1-3) — no separate confirmation action, same "last-actor triggers
 * auto-resolution" convention as Las Vegas/Summoner's Rift.
 *
 * The "half, floored" rule floors to the nearest **$1,000 chip**, not the
 * nearest dollar: the rulebook's FAQ formula box literally writes
 * `⌊입찰금 ÷ 2⌋`, but its own worked examples don't match that — $3,000 →
 * pays $1,000 (not $1,500) and $5,000 → pays $2,000 (not $2,500). Both
 * examples are only consistent with flooring in units of the $1,000 coin
 * denomination first (`⌊bid / $2,000⌋ × $1,000`), which also matches physical
 * reality: coins only come in $1,000/$2,000 pieces (§2), so paying an exact
 * half of an odd $1,000-multiple like $1,500 is never actually possible at
 * the table. The concrete, self-consistent worked examples win over the
 * mislabeled formula box.
 */
function pass(state: ForSaleState, seat: SeatIndex): ForSaleState {
  if (state.phase !== "buying" || !state.auction) return state;
  const auction = state.auction;
  if (seat !== auction.activeSeat || !auction.activeSeats.includes(seat)) return state;

  const ownBid = auction.bidsBySeat[seat] ?? 0;
  const refundPaid = Math.floor(ownBid / 2000) * 1000;
  const lowestCard = Math.min(...auction.openCards);

  let players = state.players.map((p) => (p.seat === seat ? { ...p, cash: p.cash - refundPaid, properties: [...p.properties, lowestCard] } : p));
  const remainingActiveSeats = auction.activeSeats.filter((s) => s !== seat);
  const remainingOpenCards = auction.openCards.filter((c) => c !== lowestCard);
  const passesThisRound = [...auction.passesThisRound, { seat, card: lowestCard, refundPaid }];

  if (remainingActiveSeats.length > 1) {
    return {
      ...state,
      players,
      auction: {
        ...auction,
        activeSeats: remainingActiveSeats,
        openCards: remainingOpenCards,
        activeSeat: nextActiveSeat(seat, remainingActiveSeats, state.playerCount),
        passesThisRound,
      },
    };
  }

  // Exactly one bidder left — round resolves right now.
  const winnerSeat = remainingActiveSeats[0];
  const winnerCard = remainingOpenCards[0];
  const winnerPaid = auction.currentBid;
  players = players.map((p) => (p.seat === winnerSeat ? { ...p, cash: p.cash - winnerPaid, properties: [...p.properties, winnerCard] } : p));

  const lastAuctionResult: AuctionRoundResult = { passes: passesThisRound, winnerSeat, winnerCard, winnerPaid };

  if (state.propertyDeck.length === 0) {
    const { sale, remainingDeck } = dealSaleRound(state.checkDeck, state.playerCount);
    return {
      ...state,
      players,
      phase: "selling",
      checkDeck: remainingDeck,
      auction: null,
      sale,
      roundStarter: winnerSeat,
      lastAuctionResult,
    };
  }

  const { auction: nextAuction, remainingDeck } = dealAuctionRound(state.propertyDeck, state.playerCount, winnerSeat);
  return {
    ...state,
    players,
    propertyDeck: remainingDeck,
    auction: nextAuction,
    roundStarter: winnerSeat,
    lastAuctionResult,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — selling
// ---------------------------------------------------------------------------

/**
 * "카드 제출" — a seat's single blind property submission for this sale
 * round (rulebook §4-2-2). Once every seat has submitted, the round resolves
 * immediately: descending property order gets descending check order
 * (rulebook §4-2-3) — properties are globally unique (each of the 30 cards
 * exists once, dealt to exactly one owner in Phase 1) so no tie-break is ever
 * needed between submitted values.
 */
function submitCard(state: ForSaleState, seat: SeatIndex, property: number): ForSaleState {
  if (state.phase !== "selling" || !state.sale || state.sale.revealed) return state;
  const sale = state.sale;
  if (sale.submissions[seat] !== undefined) return state;
  const player = state.players.find((p) => p.seat === seat);
  if (!player || !player.properties.includes(property)) return state;

  const submissions = { ...sale.submissions, [seat]: property };
  if (Object.keys(submissions).length < state.playerCount) {
    return { ...state, sale: { ...sale, submissions } };
  }

  const order = Object.entries(submissions)
    .map(([s, p]) => ({ seat: Number(s), property: p as number }))
    .sort((a, b) => b.property - a.property);
  const sortedChecks = [...sale.openChecks].sort((a, b) => b - a);

  let players = state.players;
  const assignments: SaleAssignment[] = order.map(({ seat: s, property: p }, i) => {
    const check = sortedChecks[i];
    players = players.map((pl) => (pl.seat === s ? { ...pl, checks: [...pl.checks, check], properties: pl.properties.filter((c) => c !== p) } : pl));
    return { seat: s, property: p, check };
  });

  return {
    ...state,
    players,
    sale: { ...sale, submissions, revealed: true },
    lastSaleResult: { assignments },
  };
}

/** Advances past a resolved sale round (after the UI has had a chance to animate the blind reveal) — deals the next round, or ends the game once the check deck is exhausted (rulebook §4-2-4/§5). */
function continueSale(state: ForSaleState): ForSaleState {
  if (state.phase !== "selling" || !state.sale?.revealed) return state;
  if (state.checkDeck.length === 0) {
    return { ...state, phase: "gameOver", sale: null };
  }
  const { sale, remainingDeck } = dealSaleRound(state.checkDeck, state.playerCount);
  return { ...state, checkDeck: remainingDeck, sale };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: ForSaleState, action: EngineAction): ForSaleState {
  switch (action.type) {
    case "bid":
      return bid(state, action.seat, action.amount);
    case "pass":
      return pass(state, action.seat);
    case "submitCard":
      return submitCard(state, action.seat, action.property);
    case "continueSale":
      return continueSale(state);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Final rankings
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  total: number;
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 — every game exposes getValidMoves +
// chooseBotAction so a host client can drive a bot-occupied seat). Levels
// 1–10 route through the shared `pickByLevel` noise curve (botDifficulty.ts)
// on top of `scoreMove` below — see that module's doc for the tier design.
// ---------------------------------------------------------------------------

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";

/** seat가 지금 제출할 수 있는 모든 합법 EngineAction — bid/pass의 가드를 그대로 반영. */
export function getValidMoves(state: ForSaleState, seat: SeatIndex): EngineAction[] {
  if (state.phase === "buying" && state.auction) {
    const auction = state.auction;
    if (seat !== auction.activeSeat || !auction.activeSeats.includes(seat)) return [];
    const player = state.players.find((p) => p.seat === seat);
    if (!player) return [];
    const moves: EngineAction[] = [{ type: "pass", seat }];
    for (let amount = auction.currentBid + BID_INCREMENT; amount <= player.cash; amount += BID_INCREMENT) {
      moves.push({ type: "bid", seat, amount });
    }
    return moves;
  }
  if (state.phase === "selling" && state.sale && !state.sale.revealed && state.sale.submissions[seat] === undefined) {
    const player = state.players.find((p) => p.seat === seat);
    if (!player) return [];
    return player.properties.map((property) => ({ type: "submitCard", seat, property }) satisfies EngineAction);
  }
  return [];
}

/** Rough dollar value of holding property `card` — property numbers are the game's only rank signal, so a linear map onto the check deck's $0..$14,000 range is the simplest unbiased estimate every level shares. */
function propertyValueEstimate(card: number): number {
  return (card / PROPERTY_COUNT) * 14000;
}

/**
 * Phase 1 (buying) scoring. `pass` nets the estimated value of the lowest
 * remaining card minus the half-refund it costs; `bid` nets the estimated
 * value of the highest remaining card (what you're chasing if you win the
 * round) minus the amount committed. Expert level (Lv.8–10) additionally
 * shades both toward preserving cash — "절반 환불금을 계산한 입찰 포기 타이밍"
 * from the work order is exactly the pass-side term below.
 */
function scoreBuyingMove(state: ForSaleState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  const auction = state.auction!;
  const player = state.players.find((p) => p.seat === seat)!;
  const cashWeight = botTier(level) === "expert" ? 0.05 : 0;

  if (move.type === "pass") {
    const ownBid = auction.bidsBySeat[seat] ?? 0;
    const refundPaid = Math.floor(ownBid / 2000) * 1000;
    const lowestCard = Math.min(...auction.openCards);
    return propertyValueEstimate(lowestCard) - refundPaid + cashWeight * player.cash;
  }
  if (move.type !== "bid") return 0; // unreachable from getValidMoves during "buying", kept only to satisfy the union

  const highestCard = Math.max(...auction.openCards);
  return propertyValueEstimate(highestCard) - move.amount + cashWeight * (player.cash - move.amount);
}

/**
 * Phase 2 (selling) scoring. Blind-submits are scored by how well the
 * submitted property's rank among the seat's *remaining* properties matches
 * how attractive this round's open checks are relative to the long-run
 * average — a strong property should be saved for a strong check round and
 * "dumped" while checks are weak, matching the work order's "수표 카드 배당을
 * 극대화하는 블라인드 비교 카드 제출". Levels 8–10 use the *actual* mean of
 * the still-undealt check deck (derivable from public state — every round's
 * check values are revealed before being claimed, so the remaining
 * composition is honest deck-counting, not hidden opponent info) instead of
 * the flat $7,000 theoretical mean core levels use.
 */
function scoreSellingMove(state: ForSaleState, seat: SeatIndex, move: Extract<EngineAction, { type: "submitCard" }>, level: BotLevel): number {
  const sale = state.sale!;
  const player = state.players.find((p) => p.seat === seat)!;
  const checkAvg = sale.openChecks.reduce((s, c) => s + c, 0) / sale.openChecks.length;
  const referenceAvg =
    botTier(level) === "expert" && state.checkDeck.length > 0
      ? state.checkDeck.reduce((s, c) => s + c, 0) / state.checkDeck.length
      : 7000;
  const roundQuality = checkAvg - referenceAvg;

  const sorted = [...player.properties].sort((a, b) => a - b);
  const rankIndex = sorted.indexOf(move.property);
  const relativeRank = sorted.length > 1 ? rankIndex / (sorted.length - 1) : 0.5;

  return roundQuality * relativeRank;
}

function scoreMove(state: ForSaleState, seat: SeatIndex, move: EngineAction, level: BotLevel): number {
  if (state.phase === "buying") return scoreBuyingMove(state, seat, move, level);
  if (move.type === "submitCard") return scoreSellingMove(state, seat, move, level);
  return 0;
}

/** getValidMoves 중 level(1~10)에 맞는 액션을 고른다 — 점수 매기기+노이즈는 botDifficulty.ts의 공용 커브. seat가 지금 할 게 없으면 null. */
export function chooseBotAction(
  state: ForSaleState,
  seat: SeatIndex,
  level: BotLevel = 5,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const scored = moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) }));
  return pickByLevel(scored, level, rng);
}

/**
 * Only meaningful once `state.phase === "gameOver"`. Total = sum of won
 * checks + leftover cash (rulebook §5). Ties broken by leftover cash; if
 * still tied, co-winners share a rank (standard competition ranking) — both
 * explicit in the rulebook's tie-breaker section.
 */
export function computeRankings(state: ForSaleState): RankedSeat[] {
  const scored = state.players
    .map((p) => ({ seat: p.seat, cash: p.cash, total: p.checks.reduce((sum, c) => sum + c, 0) + p.cash }))
    .sort((a, b) => b.total - a.total || b.cash - a.cash);

  const ranks: RankedSeat[] = [];
  scored.forEach((s, i) => {
    const tiedWithPrevious = i > 0 && s.total === scored[i - 1].total && s.cash === scored[i - 1].cash;
    ranks.push({ seat: s.seat, rank: tiedWithPrevious ? ranks[i - 1].rank : i + 1, total: s.total });
  });
  return ranks;
}
