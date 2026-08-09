/**
 * Pure "라스베가스 (Las Vegas)" rules engine — no React, no I/O. Implements
 * boardGameRule/라스베가스/라스베가스.md: players roll their remaining dice
 * pool each turn, commit every die showing one chosen face onto that
 * numbered casino board (1-6), and once every seat has emptied its hand the
 * six casinos settle in order — equal-count dice groups (including the
 * neutral/house dice bucket) cancel each other out entirely, and whoever has
 * the most surviving dice at a casino takes its highest remaining bill, next
 * most takes the next bill, and so on.
 *
 * §5 note on round count: the task brief that requested this game described
 * a 4-round cumulative campaign, but the rulebook file this project was
 * pointed at is explicitly written as a **단판(single-round) 승부** variant
 * ("원래는 4라운드로 진행되는 게임이지만, 요청하신 단판 모드(1라운드 완결
 * 룰)에 맞춰... 구성된 정식 룰북") — its money-card setup, dice-per-player
 * table, cancellation rule, and its own §5 tie-break (bill count, not a 2nd
 * criterion meant to span multiple rounds) are all written for exactly one
 * round. Per this project's standing rule (HANDOFF.md "작업 규칙": when a
 * task brief and a referenced rulebook disagree, the rulebook wins and the
 * call gets documented here), and confirmed explicitly with the user before
 * implementation, this engine plays a single round start-to-finish — there
 * is no `roundNumber` loop or cross-round carry-over.
 *
 * Same online-multiplayer trust model as every other game in this project:
 * every connected client computes and holds the FULL state from a shared RNG
 * seed plus replayed `EngineAction`s — there is no server authority (see
 * docs/architecture.md §2). Mid-game randomness (each turn's dice roll) is
 * NOT drawn inside the reducer with `Math.random()` — like Perudo's
 * `continue` action, the acting client generates a seed value and ships it
 * inside the `rollDice` action itself, so `applyAction` stays a pure,
 * replayable function of its inputs (ARCHITECTURE.md §1).
 */

export type SeatIndex = number;
export type CasinoNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type Face = 1 | 2 | 3 | 4 | 5 | 6;

/** The neutral/house dice bucket — rulebook §2 "중립 주사위". Never owned by a player; a bill it wins is discarded instead of paid out. */
export const NEUTRAL_OWNER = "neutral" as const;
export type DiceOwner = SeatIndex | typeof NEUTRAL_OWNER;

export const MIN_PLAYERS = 2;
// The rulebook's component list ("플레이어 주사위 총 40개: 5개 색상, 색상당 8개씩")
// only ships 5 player colors — unlike Perudo, this engine does not extend
// beyond the physical box, since Las Vegas's neutral-dice table (§2 below)
// is itself defined only for 2-5 players.
export const MAX_PLAYERS = 5;
export const DICE_PER_PLAYER = 8;
export const CASINO_COUNT = 6;
/** Rulebook §2 step 2: keep dealing bills onto a casino until its running total is at least this much. */
export const MIN_CASINO_TOTAL = 50_000;

/** Rulebook §1: 54 money cards, $10,000-$90,000, 6 copies of each value. */
export const MONEY_VALUES = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000] as const;
export const MONEY_COPIES_PER_VALUE = 6;

/**
 * Rulebook §2 step 3's per-player-count neutral dice table. `preplaced` is
 * the 3-player-only special case: 2 leftover neutral dice the lead player
 * rolls and places immediately, before anyone's first real turn.
 */
export const NEUTRAL_DICE_TABLE: Record<number, { perPlayer: number; preplaced: number }> = {
  2: { perPlayer: 4, preplaced: 0 },
  3: { perPlayer: 2, preplaced: 2 },
  4: { perPlayer: 2, preplaced: 0 },
  5: { perPlayer: 0, preplaced: 0 },
};

export interface RolledDie {
  owner: "own" | "neutral";
  face: Face;
}

export interface CasinoState {
  number: CasinoNumber;
  /** Sorted highest-first — rulebook §2 step 4 "금액이 높은 지폐가 위로". Index 0 is awarded first. */
  bills: number[];
  /** Dice committed here so far, keyed by owner (seat index, or `"neutral"`). */
  diceCounts: Partial<Record<DiceOwner, number>>;
}

export interface PlayerState {
  seat: SeatIndex;
  ownDiceInHand: number;
  neutralDiceInHand: number;
  /** Bills won so far (order not meaningful — only used for the total/count at game end). */
  money: number[];
}

export type Phase = "playing" | "gameOver";

export interface CasinoAward {
  owner: DiceOwner;
  diceCount: number;
  /** Null when this group placed dice but the casino ran out of bills before reaching it. */
  bill: number | null;
}

export interface CasinoSettlementResult {
  casino: CasinoNumber;
  /** Owners whose dice count tied another owner's at this casino and were cancelled — rulebook §4 규칙 1 (empty if nobody tied). */
  cancelledOwners: DiceOwner[];
  /** Surviving owners, ranked by dice count descending, with what (if anything) they won. */
  awards: CasinoAward[];
}

export interface LasVegasState {
  playerCount: number;
  players: PlayerState[];
  casinos: CasinoState[];
  activeSeat: SeatIndex;
  /** The active seat's freshly-rolled, not-yet-placed dice. Null between turns / before the first roll. */
  currentRoll: RolledDie[] | null;
  phase: Phase;
  /** Most recently resolved placement — UI-only flash/highlight, not consumed by the engine. */
  lastPlacement: { seat: SeatIndex; casino: CasinoNumber; face: Face; ownCount: number; neutralCount: number } | null;
  /** Populated once `phase` flips to "gameOver" — one entry per casino, in settlement order (1-6). */
  settlement: CasinoSettlementResult[] | null;
  initialSeed: number;
}

export type EngineAction =
  | { type: "rollDice"; seat: SeatIndex; seed: number }
  | { type: "placeDice"; seat: SeatIndex; face: Face };

/** Deterministic PRNG, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };

function rollFaces(rng: () => number, count: number): Face[] {
  return Array.from({ length: count }, () => (1 + Math.floor(rng() * 6)) as Face);
}

/** The full 54-card money deck: $10,000-$90,000, 6 copies each (rulebook §1). */
export function buildMoneyDeck(): number[] {
  const deck: number[] = [];
  for (const value of MONEY_VALUES) {
    for (let i = 0; i < MONEY_COPIES_PER_VALUE; i++) deck.push(value);
  }
  return deck;
}

/**
 * Rulebook §2 step 2: fill casino 1 first (dealing one bill at a time until
 * its total is >= $50,000), THEN casino 2, and so on — not a round-robin
 * across casinos. Bills are re-sorted highest-first once a casino is done
 * (step 4), since the draw order and the payout order are independent.
 */
function dealCasinoBills(deck: number[]): CasinoState[] {
  let cursor = 0;
  const casinos: CasinoState[] = [];
  for (let n = 1; n <= CASINO_COUNT; n++) {
    const bills: number[] = [];
    let total = 0;
    while (total < MIN_CASINO_TOTAL && cursor < deck.length) {
      const bill = deck[cursor++];
      bills.push(bill);
      total += bill;
    }
    bills.sort((a, b) => b - a);
    casinos.push({ number: n as CasinoNumber, bills, diceCounts: {} });
  }
  return casinos;
}

function addDice(casino: CasinoState, owner: DiceOwner, count: number): CasinoState {
  if (count <= 0) return casino;
  return { ...casino, diceCounts: { ...casino.diceCounts, [owner]: (casino.diceCounts[owner] ?? 0) + count } };
}

function totalDiceInHand(p: PlayerState): number {
  return p.ownDiceInHand + p.neutralDiceInHand;
}

/** Next seat (clockwise) with at least one die left in hand; null once every seat has emptied its hand. */
function nextActiveSeat(players: PlayerState[], from: SeatIndex): SeatIndex | null {
  const count = players.length;
  for (let i = 1; i <= count; i++) {
    const s = (from + i) % count;
    if (totalDiceInHand(players[s]) > 0) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): LasVegasState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = seededRng(seed);
  const neutral = NEUTRAL_DICE_TABLE[playerCount];

  const players: PlayerState[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    ownDiceInHand: DICE_PER_PLAYER,
    neutralDiceInHand: neutral.perPlayer,
    money: [],
  }));

  let casinos = dealCasinoBills(shuffle(buildMoneyDeck(), rng));

  // Rulebook §2 step 3, 3-player special case: the lead player pre-rolls the
  // 2 leftover neutral dice and they land immediately, before real turns
  // start — each independently, so both can land on the same casino.
  for (let i = 0; i < neutral.preplaced; i++) {
    const face = rollFaces(rng, 1)[0];
    casinos = casinos.map((c) => (c.number === face ? addDice(c, NEUTRAL_OWNER, 1) : c));
  }

  // "가장 최근에 라스베가스나 카지노를 방문해본 사람" has no digital meaning —
  // same convention as every other engine here (Avalon/No Thanks/Perudo):
  // pick the starter from the shared seed for determinism.
  const starter = Math.floor(rng() * playerCount);

  return {
    playerCount,
    players,
    casinos,
    activeSeat: starter,
    currentRoll: null,
    phase: "playing",
    lastPlacement: null,
    settlement: null,
    initialSeed: seed,
  };
}

// ---------------------------------------------------------------------------
// Turn actions
// ---------------------------------------------------------------------------

/** Rulebook §3 step 1: roll every die still in hand (own-color + neutral) together. */
function rollDice(state: LasVegasState, seat: SeatIndex, seed: number): LasVegasState {
  if (state.phase !== "playing" || seat !== state.activeSeat || state.currentRoll !== null) return state;
  const player = state.players.find((p) => p.seat === seat);
  if (!player || totalDiceInHand(player) === 0) return state;

  const rng = seededRng(seed);
  const own: RolledDie[] = rollFaces(rng, player.ownDiceInHand).map((face) => ({ owner: "own" as const, face }));
  const neutral: RolledDie[] = rollFaces(rng, player.neutralDiceInHand).map((face) => ({ owner: "neutral" as const, face }));
  return { ...state, currentRoll: [...own, ...neutral] };
}

/**
 * Rulebook §3 steps 2-3: choose one face from the roll; every die (own AND
 * neutral) showing it goes onto that casino, no partial commits allowed.
 * Then either hand off to the next seat with dice left, or — once nobody
 * does — settle all six casinos and end the game (§4/§5, single round).
 */
function placeDice(state: LasVegasState, seat: SeatIndex, face: Face): LasVegasState {
  if (state.phase !== "playing" || seat !== state.activeSeat || !state.currentRoll) return state;
  const matching = state.currentRoll.filter((d) => d.face === face);
  if (matching.length === 0) return state;

  const ownCount = matching.filter((d) => d.owner === "own").length;
  const neutralCount = matching.filter((d) => d.owner === "neutral").length;

  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, ownDiceInHand: p.ownDiceInHand - ownCount, neutralDiceInHand: p.neutralDiceInHand - neutralCount } : p,
  );
  let casinos = state.casinos.map((c) => (c.number === face ? addDice(c, seat, ownCount) : c));
  casinos = casinos.map((c) => (c.number === face ? addDice(c, NEUTRAL_OWNER, neutralCount) : c));

  const lastPlacement = { seat, casino: face as CasinoNumber, face, ownCount, neutralCount };
  const next = nextActiveSeat(players, seat);

  if (next === null) {
    const settlement = settleCasinos(casinos);
    const settledPlayers = applySettlementToPlayers(players, settlement);
    return { ...state, players: settledPlayers, casinos, currentRoll: null, lastPlacement, phase: "gameOver", settlement };
  }

  return { ...state, players, casinos, currentRoll: null, lastPlacement, activeSeat: next };
}

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: LasVegasState, action: EngineAction): LasVegasState {
  switch (action.type) {
    case "rollDice":
      return rollDice(state, action.seat, action.seed);
    case "placeDice":
      return placeDice(state, action.seat, action.face);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Settlement — rulebook §4
// ---------------------------------------------------------------------------

/**
 * Settles one casino: owners tied on dice count (including the neutral
 * bucket as a single group) cancel each other out entirely (규칙 1), then
 * surviving groups take the highest remaining bill in descending dice-count
 * order (규칙 2). A neutral group that would have won a bill instead gets
 * `bill: null` recorded as "awarded" but paid to nobody (rulebook: "지폐 더미
 * 맨 아래로 버립니다") — `applySettlementToPlayers` only ever pays real seats.
 */
export function settleCasino(casino: CasinoState): CasinoSettlementResult {
  const groups = (Object.entries(casino.diceCounts) as [string, number][])
    .filter(([, count]) => count > 0)
    .map(([owner, count]) => ({ owner: (owner === NEUTRAL_OWNER ? NEUTRAL_OWNER : Number(owner)) as DiceOwner, count }));

  const countTally = new Map<number, number>();
  for (const g of groups) countTally.set(g.count, (countTally.get(g.count) ?? 0) + 1);

  const cancelledOwners = groups.filter((g) => (countTally.get(g.count) ?? 0) >= 2).map((g) => g.owner);
  const survivors = groups
    .filter((g) => (countTally.get(g.count) ?? 0) < 2)
    .sort((a, b) => b.count - a.count);

  const awards: CasinoAward[] = survivors.map((g, i) => ({
    owner: g.owner,
    diceCount: g.count,
    bill: i < casino.bills.length ? casino.bills[i] : null,
  }));

  return { casino: casino.number, cancelledOwners, awards };
}

export function settleCasinos(casinos: CasinoState[]): CasinoSettlementResult[] {
  return [...casinos].sort((a, b) => a.number - b.number).map(settleCasino);
}

function applySettlementToPlayers(players: PlayerState[], settlement: CasinoSettlementResult[]): PlayerState[] {
  const wonByPlayer = new Map<SeatIndex, number[]>();
  for (const result of settlement) {
    for (const award of result.awards) {
      if (award.bill === null || award.owner === NEUTRAL_OWNER) continue;
      const seat = award.owner as SeatIndex;
      const list = wonByPlayer.get(seat) ?? [];
      list.push(award.bill);
      wonByPlayer.set(seat, list);
    }
  }
  return players.map((p) => ({ ...p, money: [...p.money, ...(wonByPlayer.get(p.seat) ?? [])] }));
}

// ---------------------------------------------------------------------------
// Final scoring — rulebook §5
// ---------------------------------------------------------------------------

export interface RankedPlayer {
  seat: SeatIndex;
  rank: number;
  total: number;
  billCount: number;
}

/**
 * Only meaningful once `state.phase === "gameOver"`. Ranked by total money
 * descending; ties broken by bill count descending (rulebook §5 "지폐 카드의
 * 장수가 더 많은 플레이어가 승리" — more, smaller bills beats fewer, bigger
 * ones on a pure total tie); still-tied players share the rank (standard
 * competition ranking, matching the rulebook's explicit "공동 승리" allowance).
 */
export function computeRankings(state: LasVegasState): RankedPlayer[] {
  const scored = state.players.map((p) => ({
    seat: p.seat,
    total: p.money.reduce((sum, v) => sum + v, 0),
    billCount: p.money.length,
  }));
  const sorted = [...scored].sort((a, b) => b.total - a.total || b.billCount - a.billCount);
  const ranked: RankedPlayer[] = [];
  let rank = 1;
  sorted.forEach((entry, i) => {
    if (i > 0) {
      const prev = sorted[i - 1];
      if (prev.total !== entry.total || prev.billCount !== entry.billCount) rank = i + 1;
    }
    ranked.push({ ...entry, rank });
  });
  return ranked;
}
