/**
 * Pure BANG! rules engine — no React, no I/O. Implements the standard
 * base-game ruleset (80-card deck, 4 roles: Sheriff/Deputy/Outlaw/Renegade)
 * for 4-8 players (the 8-player table adds a second, independent Renegade —
 * see ROLE_SETS and checkWinner's doc below), MINUS the ~16 unique character
 * special-ability cards
 * (Willy the Kid, Bart Cassidy, etc.) — every player is a generic role-only
 * player. This is the one deliberate content cut; everything else (every
 * card type, both win-condition edge cases, weapon ranges, distance
 * modifiers, Dynamite/Jail mechanics, the Outlaw-kill reward and
 * Sheriff-kills-Deputy penalty) is implemented for real.
 *
 * Same online-multiplayer trust model as Hanamikoji: every connected
 * client computes and holds the FULL state (all hands, all secret roles)
 * via a shared RNG seed plus replayed `EngineAction`s — there is no server
 * authority. The view layer only ever *renders* the viewer's own secrets;
 * a technically inclined player could inspect client state to see others'
 * roles/hands. Accepted trade-off for casual play among friends, see
 * README.
 *
 * Simplification: once any `pending` response is open, the active player
 * cannot play additional cards until it fully resolves (no interleaving
 * multiple simultaneous pendings) — a deliberate scope cut to keep the
 * reactive-response machinery tractable.
 */

export type Suit = "S" | "H" | "D" | "C";
export type SeatIndex = number;

export type CardType =
  | "bang"
  | "missed"
  | "beer"
  | "saloon"
  | "duel"
  | "indians"
  | "gatling"
  | "general-store"
  | "stagecoach"
  | "wells-fargo"
  | "panic"
  | "cat-balou"
  | "jail"
  | "dynamite"
  | "volcanic"
  | "schofield"
  | "remington"
  | "rev-carbine"
  | "winchester"
  | "barrel"
  | "scope"
  | "mustang";

export interface Card {
  id: string;
  type: CardType;
  suit: Suit;
  rank: number; // 2-14 (11=J,12=Q,13=K,14=A)
}

export type Role = "sheriff" | "deputy" | "outlaw" | "renegade";
export type Team = "law" | "outlaw" | "renegade";
export type EquipSlot = "weapon" | "scope" | "mustang" | "barrel" | "jail" | "dynamite";

export interface PlayerState {
  seat: SeatIndex;
  role: Role;
  alive: boolean;
  roleRevealed: boolean;
  life: number;
  maxLife: number;
  hand: Card[];
  equipment: Record<EquipSlot, Card | null>;
  bangPlayedThisTurn: number;
}

export type TurnPhase = "begin-turn" | "action" | "pending" | "game-end";

export interface PendingGroupResponse {
  kind: "group";
  cause: "bang" | "gatling" | "indians";
  source: SeatIndex;
  requiredCard: "missed" | "bang";
  barrelAllowed: boolean;
  outstanding: SeatIndex[];
}

export interface PendingDuel {
  kind: "duel";
  attacker: SeatIndex;
  defender: SeatIndex;
  turnToRespond: SeatIndex;
}

export interface PendingGeneralStore {
  kind: "general-store";
  revealed: Card[];
  pickOrder: SeatIndex[];
  nextPickIndex: number;
}

export type PendingResponse = PendingGroupResponse | PendingDuel | PendingGeneralStore;

export interface BangState {
  turnOrder: SeatIndex[];
  players: PlayerState[];
  deck: Card[];
  discard: Card[];
  turnSeat: SeatIndex;
  turnPhase: TurnPhase;
  pending: PendingResponse | null;
  turnNumber: number;
  winner: Team | null;
  playerCount: number;
}

export type EngineAction =
  | { type: "begin-turn"; seed?: number }
  | { type: "play-beer"; cardId: string }
  | { type: "play-saloon"; cardId: string }
  | { type: "play-stagecoach"; cardId: string; seed?: number }
  | { type: "play-wells-fargo"; cardId: string; seed?: number }
  | { type: "play-weapon"; cardId: string }
  | { type: "play-scope"; cardId: string }
  | { type: "play-mustang"; cardId: string }
  | { type: "play-barrel"; cardId: string }
  | { type: "play-dynamite"; cardId: string }
  | {
      type: "play-panic";
      cardId: string;
      targetSeat: SeatIndex;
      from: "hand" | "equip";
      equipCardId?: string;
      seed?: number;
    }
  | {
      type: "play-cat-balou";
      cardId: string;
      targetSeat: SeatIndex;
      from: "hand" | "equip";
      equipCardId?: string;
      seed?: number;
    }
  | { type: "play-jail"; cardId: string; targetSeat: SeatIndex }
  | { type: "play-bang"; cardId: string; targetSeat: SeatIndex }
  | { type: "play-duel"; cardId: string; targetSeat: SeatIndex }
  | { type: "play-indians"; cardId: string }
  | { type: "play-gatling"; cardId: string }
  | { type: "play-general-store"; cardId: string; seed?: number }
  | { type: "group-respond"; seat: SeatIndex; mode: "card"; cardId: string }
  | { type: "group-respond"; seat: SeatIndex; mode: "barrel"; seed?: number }
  | { type: "group-respond"; seat: SeatIndex; mode: "take-hit" }
  | { type: "duel-respond"; seat: SeatIndex; cardId: string | null }
  | { type: "general-store-pick"; seat: SeatIndex; cardId: string }
  | { type: "end-turn"; discardCardIds: string[] };

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

// ---------------------------------------------------------------------------
// The 80-card deck. Exact per-card suit/rank assignment isn't reliably
// sourceable as text (the publisher only renders it as card-face images), so
// this bakes a FIXED, static suit+rank onto each of the 80 card objects —
// shuffle order is randomized at deal time, never the suit assignment,
// exactly like the physical deck — calibrated so ~20/80 are Hearts (~25%
// Barrel/Jail success, matching real odds) and ~8/80 are Spade 2-9 (~10%
// Dynamite explosion, matching real odds). Not a byte-for-byte replica of
// the physical deck's suit table, but statistically equivalent for every
// rule that reads suit.
// ---------------------------------------------------------------------------

const CARD_SPECS: { type: CardType; count: number }[] = [
  { type: "bang", count: 25 },
  { type: "missed", count: 12 },
  { type: "beer", count: 6 },
  { type: "panic", count: 4 },
  { type: "cat-balou", count: 4 },
  { type: "duel", count: 3 },
  { type: "stagecoach", count: 2 },
  { type: "general-store", count: 2 },
  { type: "mustang", count: 2 },
  { type: "indians", count: 2 },
  { type: "gatling", count: 1 },
  { type: "jail", count: 3 },
  { type: "dynamite", count: 1 },
  { type: "volcanic", count: 2 },
  { type: "schofield", count: 3 },
  { type: "remington", count: 1 },
  { type: "rev-carbine", count: 1 },
  { type: "winchester", count: 1 },
  { type: "barrel", count: 2 },
  { type: "scope", count: 1 },
  { type: "saloon", count: 1 },
  { type: "wells-fargo", count: 1 },
];

const HEART_COUNT = 20;
const SPADE_LOW_COUNT = 8;

export function buildCardCatalog(): Card[] {
  const flatTypes: CardType[] = [];
  for (const spec of CARD_SPECS) {
    for (let i = 0; i < spec.count; i++) flatTypes.push(spec.type);
  }
  return flatTypes.map((type, index) => {
    let suit: Suit;
    let rank: number;
    if (index < HEART_COUNT) {
      suit = "H";
      rank = 2 + (index % 13);
    } else if (index < HEART_COUNT + SPADE_LOW_COUNT) {
      suit = "S";
      rank = 2 + ((index - HEART_COUNT) % 8); // 2..9
    } else {
      const rest = index - HEART_COUNT - SPADE_LOW_COUNT;
      const suits: Suit[] = ["D", "C", "S"];
      suit = suits[rest % 3];
      rank = 10 + (rest % 5); // 10..14, never lands on Spade 2-9
    }
    return { id: `${type}-${index}`, type, suit, rank };
  });
}

const WEAPON_TYPES: CardType[] = ["volcanic", "schofield", "remington", "rev-carbine", "winchester"];

const WEAPON_RANGE: Partial<Record<CardType, number>> = {
  volcanic: 1,
  schofield: 2,
  remington: 3,
  "rev-carbine": 4,
  winchester: 5,
};

// ---------------------------------------------------------------------------
// Roles & setup
// ---------------------------------------------------------------------------

/**
 * 8-player table adds a second Renegade (official Dodge City / 8-player
 * expansion distribution) instead of a 4th Outlaw or 3rd Deputy — see
 * `checkWinner`'s doc for how the two Renegades resolve independently.
 */
export const ROLE_SETS: Record<number, Role[]> = {
  4: ["sheriff", "outlaw", "outlaw", "renegade"],
  5: ["sheriff", "deputy", "outlaw", "outlaw", "renegade"],
  6: ["sheriff", "deputy", "outlaw", "outlaw", "outlaw", "renegade"],
  7: ["sheriff", "deputy", "deputy", "outlaw", "outlaw", "outlaw", "renegade"],
  8: ["sheriff", "deputy", "deputy", "outlaw", "outlaw", "outlaw", "renegade", "renegade"],
};

function emptyEquipment(): Record<EquipSlot, Card | null> {
  return { weapon: null, scope: null, mustang: null, barrel: null, jail: null, dynamite: null };
}

function takeN<T>(arr: T[], n: number): [T[], T[]] {
  return [arr.slice(0, n), arr.slice(n)];
}

export function startGame(playerCount: number, seed: number): BangState {
  const roleSet = ROLE_SETS[playerCount];
  if (!roleSet) throw new Error(`Unsupported player count: ${playerCount}`);
  const rng = seededRng(seed);
  const roles = shuffle(roleSet, rng);

  const players: PlayerState[] = roles.map((role, seat) => ({
    seat,
    role,
    alive: true,
    roleRevealed: role === "sheriff",
    life: role === "sheriff" ? 5 : 4,
    maxLife: role === "sheriff" ? 5 : 4,
    hand: [],
    equipment: emptyEquipment(),
    bangPlayedThisTurn: 0,
  }));

  const sheriffSeat = players.findIndex((p) => p.role === "sheriff");
  const seats = players.map((p) => p.seat);
  const turnOrder = [...seats.slice(sheriffSeat), ...seats.slice(0, sheriffSeat)];

  let deck = shuffle(buildCardCatalog(), rng);
  for (const seat of turnOrder) {
    const player = players[seat];
    const [dealt, rest] = takeN(deck, player.maxLife);
    player.hand = dealt;
    deck = rest;
  }

  return {
    turnOrder,
    players,
    deck,
    discard: [],
    turnSeat: sheriffSeat,
    turnPhase: "begin-turn",
    pending: null,
    turnNumber: 1,
    winner: null,
    playerCount,
  };
}

// ---------------------------------------------------------------------------
// Distance / range
// ---------------------------------------------------------------------------

export function livingSeatsInOrder(state: BangState): SeatIndex[] {
  return state.turnOrder.filter((seat) => state.players[seat].alive);
}

export function circleDistance(state: BangState, a: SeatIndex, b: SeatIndex): number {
  if (a === b) return 0;
  const order = livingSeatsInOrder(state);
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia === -1 || ib === -1) return Infinity;
  const n = order.length;
  const diff = Math.abs(ia - ib);
  return Math.min(diff, n - diff);
}

export function weaponRange(player: PlayerState): number {
  const weapon = player.equipment.weapon;
  return weapon ? (WEAPON_RANGE[weapon.type] ?? 1) : 1;
}

export function effectiveDistance(state: BangState, attackerSeat: SeatIndex, targetSeat: SeatIndex): number {
  const attacker = state.players[attackerSeat];
  const target = state.players[targetSeat];
  const base = circleDistance(state, attackerSeat, targetSeat);
  const scopeBonus = attacker.equipment.scope ? 1 : 0;
  const mustangPenalty = target.equipment.mustang ? 1 : 0;
  return Math.max(1, base + mustangPenalty - scopeBonus);
}

export function canBang(state: BangState, attackerSeat: SeatIndex, targetSeat: SeatIndex): boolean {
  if (attackerSeat === targetSeat) return false;
  const attacker = state.players[attackerSeat];
  const target = state.players[targetSeat];
  if (!attacker.alive || !target.alive) return false;
  return effectiveDistance(state, attackerSeat, targetSeat) <= weaponRange(attacker);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fallbackSeed(state: BangState, salt: number): number {
  return state.turnNumber * 999983 + state.deck.length * 7919 + salt;
}

function rngFor(state: BangState, seed: number | undefined, salt = 0): () => number {
  return seededRng(seed ?? fallbackSeed(state, salt));
}

function takeFromHand(hand: Card[], cardId: string): [Card, Card[]] {
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error(`Card ${cardId} not in hand`);
  return [hand[idx], [...hand.slice(0, idx), ...hand.slice(idx + 1)]];
}

function drawTopCard(state: BangState, rng: () => number): { state: BangState; card: Card | null } {
  let deck = state.deck;
  let discard = state.discard;
  if (deck.length === 0) {
    if (discard.length === 0) return { state, card: null };
    deck = shuffle(discard, rng);
    discard = [];
  }
  const [card, ...rest] = deck;
  return { state: { ...state, deck: rest, discard }, card };
}

function drawN(state: BangState, seat: SeatIndex, n: number, rng: () => number): BangState {
  let s = state;
  const drawn: Card[] = [];
  for (let i = 0; i < n; i++) {
    const result = drawTopCard(s, rng);
    s = result.state;
    if (!result.card) break;
    drawn.push(result.card);
  }
  if (drawn.length === 0) return s;
  const players = s.players.map((p, i) => (i === seat ? { ...p, hand: [...p.hand, ...drawn] } : p));
  return { ...s, players };
}

/**
 * Role-count-agnostic by construction, which is exactly what makes the
 * 8-player table's second, independent Renegade (ROLE_SETS[8]) fall out for
 * free with zero extra logic: each Renegade is racing every other seat
 * (Law, Outlaws, *and* the other Renegade — never allied with them) to be
 * the lone survivor. The moment the Sheriff dies, the check below fires on
 * however many players are alive at *that* instant — if it's exactly one
 * (a Renegade), that Renegade wins solo, precisely the "survivors were
 * [Sheriff + one Renegade]" case; with either Renegade still alive alongside
 * anyone else (including the other Renegade), it's an Outlaw win instead,
 * same as the single-Renegade tables. A table can therefore end with one
 * Renegade already dead and the other going on to win, or both Renegades
 * alive when the Sheriff falls losing to an instant Outlaw win — both are
 * correct per the official 2-Renegade rule.
 */
function checkWinner(state: BangState): Team | null {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length === 1 && alive[0].role === "renegade") return "renegade";
  const sheriff = state.players.find((p) => p.role === "sheriff");
  if (sheriff && !sheriff.alive) return "outlaw";
  const outlawOrRenegadeAlive = state.players.some(
    (p) => p.alive && (p.role === "outlaw" || p.role === "renegade"),
  );
  if (!outlawOrRenegadeAlive) return "law";
  return null;
}

/** Elimination pipeline: reveal role, discard hand+equipment, apply the
 * Outlaw-kill reward (killer draws 3) and Sheriff-kills-Deputy penalty
 * (Sheriff discards entire hand), then run the win-check. */
function eliminate(state: BangState, seat: SeatIndex, killerSeat: SeatIndex | null, seed: number | undefined): BangState {
  const player = state.players[seat];
  if (!player.alive) return state;
  const equipCards = Object.values(player.equipment).filter((c): c is Card => c !== null);
  const discard = [...state.discard, ...player.hand, ...equipCards];
  const updatedPlayer: PlayerState = {
    ...player,
    alive: false,
    roleRevealed: true,
    hand: [],
    equipment: emptyEquipment(),
  };
  const players = state.players.map((p, i) => (i === seat ? updatedPlayer : p));
  let s: BangState = { ...state, players, discard };

  if (killerSeat !== null && killerSeat !== seat && s.players[killerSeat].alive) {
    if (player.role === "outlaw") {
      const rng = rngFor(s, seed, seat + 101);
      s = drawN(s, killerSeat, 3, rng);
    }
    if (s.players[killerSeat].role === "sheriff" && player.role === "deputy") {
      const killer = s.players[killerSeat];
      const killerEquip = Object.values(killer.equipment).filter((c): c is Card => c !== null);
      s = {
        ...s,
        discard: [...s.discard, ...killer.hand, ...killerEquip],
        players: s.players.map((p, i) => (i === killerSeat ? { ...p, hand: [], equipment: emptyEquipment() } : p)),
      };
    }
  }

  const winner = checkWinner(s);
  if (winner) return { ...s, winner, turnPhase: "game-end", pending: null };
  return s;
}

/** Rule 7's "last-gasp Beer": a player whose life would hit 0 survives instead
 * if they hold a Beer card, discarding it to come back to 1 life — except
 * when only 2 players remain alive, where Beer (this included) has no effect. */
function tryEmergencyBeerSave(state: BangState, seat: SeatIndex): BangState | null {
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (aliveCount <= 2) return null;
  const player = state.players[seat];
  const beerIdx = player.hand.findIndex((c) => c.type === "beer");
  if (beerIdx === -1) return null;
  const card = player.hand[beerIdx];
  const hand = [...player.hand.slice(0, beerIdx), ...player.hand.slice(beerIdx + 1)];
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand, life: 1 } : p));
  return { ...state, players, discard: [...state.discard, card] };
}

function applyDamage(
  state: BangState,
  seat: SeatIndex,
  amount: number,
  killerSeat: SeatIndex | null,
  seed: number | undefined,
): BangState {
  const player = state.players[seat];
  if (!player.alive) return state;
  const life = Math.max(0, player.life - amount);
  const players = state.players.map((p, i) => (i === seat ? { ...p, life } : p));
  let s = { ...state, players };
  if (life <= 0) {
    const saved = tryEmergencyBeerSave(s, seat);
    s = saved ?? eliminate(s, seat, killerSeat, seed);
  }
  return s;
}

/** Advances to the next living seat after `state.turnSeat`, resetting to a fresh begin-turn. */
function advanceToNextSeat(state: BangState): BangState {
  const order = state.turnOrder;
  const idx = order.indexOf(state.turnSeat);
  let nextSeat = state.turnSeat;
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(idx + step) % order.length];
    if (state.players[candidate].alive) {
      nextSeat = candidate;
      break;
    }
  }
  return { ...state, turnSeat: nextSeat, turnPhase: "begin-turn", turnNumber: state.turnNumber + 1, pending: null };
}

/** Called after every pending response clears (or an elimination happens) to decide what's next:
 * game over, the active player died mid-resolution (advance turn), or resume their action phase. */
function resumeAfterPending(state: BangState): BangState {
  if (state.winner) return { ...state, turnPhase: "game-end", pending: null };
  if (state.pending) return state;
  if (!state.players[state.turnSeat].alive) return advanceToNextSeat(state);
  return { ...state, turnPhase: "action" };
}

// ---------------------------------------------------------------------------
// Turn flow: begin-turn (dynamite/jail checks + draw 2), end-turn
// ---------------------------------------------------------------------------

function beginTurn(state: BangState, seed: number | undefined): BangState {
  if (state.turnPhase !== "begin-turn") return state;
  const seat = state.turnSeat;
  const rng = rngFor(state, seed, seat);
  let s = state;

  if (s.players[seat].equipment.dynamite) {
    const dynamiteCard = s.players[seat].equipment.dynamite!;
    const draw = drawTopCard(s, rng);
    s = draw.state;
    const checkCard = draw.card;
    s = {
      ...s,
      players: s.players.map((p, i) => (i === seat ? { ...p, equipment: { ...p.equipment, dynamite: null } } : p)),
      discard: checkCard ? [...s.discard, checkCard, dynamiteCard] : [...s.discard, dynamiteCard],
    };
    const explodes = checkCard !== null && checkCard.suit === "S" && checkCard.rank >= 2 && checkCard.rank <= 9;
    if (explodes) {
      s = applyDamage(s, seat, 3, null, undefined);
      if (s.winner) return { ...s, turnPhase: "game-end", pending: null };
      if (!s.players[seat].alive) return advanceToNextSeat(s);
    } else {
      const order = livingSeatsInOrder(s);
      const idx = order.indexOf(seat);
      const nextSeat = order[(idx + 1) % order.length];
      s = {
        ...s,
        players: s.players.map((p, i) =>
          i === nextSeat ? { ...p, equipment: { ...p.equipment, dynamite: dynamiteCard } } : p,
        ),
      };
    }
  }

  if (s.players[seat].equipment.jail) {
    const jailCard = s.players[seat].equipment.jail!;
    const draw = drawTopCard(s, rng);
    s = draw.state;
    const checkCard = draw.card;
    s = {
      ...s,
      players: s.players.map((p, i) => (i === seat ? { ...p, equipment: { ...p.equipment, jail: null } } : p)),
      discard: checkCard ? [...s.discard, checkCard, jailCard] : [...s.discard, jailCard],
    };
    const freed = checkCard !== null && checkCard.suit === "H";
    if (!freed) return advanceToNextSeat(s);
  }

  s = drawN(s, seat, 2, rng);
  s = {
    ...s,
    turnPhase: "action",
    players: s.players.map((p, i) => (i === seat ? { ...p, bangPlayedThisTurn: 0 } : p)),
  };
  return s;
}

function endTurn(state: BangState, action: Extract<EngineAction, { type: "end-turn" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  let hand = player.hand;
  const discarded: Card[] = [];
  for (const id of action.discardCardIds) {
    const idx = hand.findIndex((c) => c.id === id);
    if (idx === -1) continue;
    discarded.push(hand[idx]);
    hand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  }
  if (hand.length > player.life) return state; // must discard down to life limit first
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand } : p));
  const s: BangState = { ...state, players, discard: [...state.discard, ...discarded] };
  return advanceToNextSeat(s);
}

// ---------------------------------------------------------------------------
// Non-reactive card plays
// ---------------------------------------------------------------------------

function playBeer(state: BangState, cardId: string): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (aliveCount <= 2) return state; // no effect with only 2 players left, per real rules
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, cardId);
  const life = Math.min(player.maxLife, player.life + 1);
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand, life } : p));
  return { ...state, players, discard: [...state.discard, card] };
}

function playSaloon(state: BangState, cardId: string): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, cardId);
  const players = state.players.map((p, i) => {
    if (i === seat) return { ...p, hand, life: Math.min(p.maxLife, p.life + 1) };
    if (!p.alive) return p;
    return { ...p, life: Math.min(p.maxLife, p.life + 1) };
  });
  return { ...state, players, discard: [...state.discard, card] };
}

function playDrawCards(state: BangState, cardId: string, n: number, seed: number | undefined): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, cardId);
  let s: BangState = {
    ...state,
    players: state.players.map((p, i) => (i === seat ? { ...p, hand } : p)),
    discard: [...state.discard, card],
  };
  s = drawN(s, seat, n, rngFor(s, seed, seat + 1));
  return s;
}

function equipSlotFor(type: CardType): EquipSlot | null {
  if (WEAPON_TYPES.includes(type)) return "weapon";
  if (type === "scope") return "scope";
  if (type === "mustang") return "mustang";
  if (type === "barrel") return "barrel";
  if (type === "dynamite") return "dynamite";
  return null;
}

function playEquip(state: BangState, cardId: string): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, cardId);
  const slot = equipSlotFor(card.type);
  if (!slot) return state;
  const oldEquip = player.equipment[slot];
  const discard = oldEquip ? [...state.discard, oldEquip] : state.discard;
  const players = state.players.map((p, i) =>
    i === seat ? { ...p, hand, equipment: { ...p.equipment, [slot]: card } } : p,
  );
  return { ...state, players, discard };
}

function pickCardFromPlayer(
  state: BangState,
  targetSeat: SeatIndex,
  from: "hand" | "equip",
  equipCardId: string | undefined,
  seed: number | undefined,
): { card: Card | null; state: BangState } {
  const target = state.players[targetSeat];
  if (from === "equip") {
    if (!equipCardId) return { card: null, state };
    const entry = (Object.entries(target.equipment) as [EquipSlot, Card | null][]).find(
      ([, c]) => c?.id === equipCardId,
    );
    if (!entry) return { card: null, state };
    const [slot, card] = entry;
    const players = state.players.map((p, i) =>
      i === targetSeat ? { ...p, equipment: { ...p.equipment, [slot]: null } } : p,
    );
    return { card, state: { ...state, players } };
  }
  if (target.hand.length === 0) return { card: null, state };
  const rng = rngFor(state, seed, targetSeat + 201);
  const idx = Math.floor(rng() * target.hand.length);
  const card = target.hand[idx];
  const hand = [...target.hand.slice(0, idx), ...target.hand.slice(idx + 1)];
  const players = state.players.map((p, i) => (i === targetSeat ? { ...p, hand } : p));
  return { card, state: { ...state, players } };
}

function playPanic(state: BangState, action: Extract<EngineAction, { type: "play-panic" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  if (seat === action.targetSeat) return state;
  if (effectiveDistance(state, seat, action.targetSeat) > 1) return state;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  let s: BangState = {
    ...state,
    players: state.players.map((p, i) => (i === seat ? { ...p, hand } : p)),
    discard: [...state.discard, card],
  };
  const picked = pickCardFromPlayer(s, action.targetSeat, action.from, action.equipCardId, action.seed);
  s = picked.state;
  if (picked.card) {
    const stolen = picked.card;
    s = { ...s, players: s.players.map((p, i) => (i === seat ? { ...p, hand: [...p.hand, stolen] } : p)) };
  }
  return s;
}

function playCatBalou(state: BangState, action: Extract<EngineAction, { type: "play-cat-balou" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  if (seat === action.targetSeat) return state;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  let s: BangState = {
    ...state,
    players: state.players.map((p, i) => (i === seat ? { ...p, hand } : p)),
    discard: [...state.discard, card],
  };
  const picked = pickCardFromPlayer(s, action.targetSeat, action.from, action.equipCardId, action.seed);
  s = picked.state;
  if (picked.card) s = { ...s, discard: [...s.discard, picked.card] };
  return s;
}

function playJail(state: BangState, action: Extract<EngineAction, { type: "play-jail" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const target = state.players[action.targetSeat];
  if (!target || !target.alive || target.role === "sheriff") return state;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  const oldJail = target.equipment.jail;
  const discard = oldJail ? [...state.discard, oldJail] : state.discard;
  const players = state.players.map((p, i) => {
    if (i === seat) return { ...p, hand };
    if (i === action.targetSeat) return { ...p, equipment: { ...p.equipment, jail: card } };
    return p;
  });
  return { ...state, players, discard };
}

// ---------------------------------------------------------------------------
// Targeted plays that open a pending response
// ---------------------------------------------------------------------------

function playBang(state: BangState, action: Extract<EngineAction, { type: "play-bang" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  if (!canBang(state, seat, action.targetSeat)) return state;
  const isVolcanic = player.equipment.weapon?.type === "volcanic";
  const cap = isVolcanic ? Infinity : 1;
  if (player.bangPlayedThisTurn >= cap) return state;
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  const players = state.players.map((p, i) =>
    i === seat ? { ...p, hand, bangPlayedThisTurn: p.bangPlayedThisTurn + 1 } : p,
  );
  const pending: PendingGroupResponse = {
    kind: "group",
    cause: "bang",
    source: seat,
    requiredCard: "missed",
    barrelAllowed: true,
    outstanding: [action.targetSeat],
  };
  return { ...state, players, discard: [...state.discard, card], pending, turnPhase: "pending" };
}

function playDuel(state: BangState, action: Extract<EngineAction, { type: "play-duel" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const target = state.players[action.targetSeat];
  if (!target || !target.alive || seat === action.targetSeat) return state;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand } : p));
  const pending: PendingDuel = { kind: "duel", attacker: seat, defender: action.targetSeat, turnToRespond: action.targetSeat };
  return { ...state, players, discard: [...state.discard, card], pending, turnPhase: "pending" };
}

function playIndians(state: BangState, action: Extract<EngineAction, { type: "play-indians" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand } : p));
  const base: BangState = { ...state, players, discard: [...state.discard, card] };
  const outstanding = base.turnOrder.filter((s) => s !== seat && base.players[s].alive);
  if (outstanding.length === 0) return base;
  const pending: PendingGroupResponse = {
    kind: "group",
    cause: "indians",
    source: seat,
    requiredCard: "bang",
    barrelAllowed: false,
    outstanding,
  };
  return { ...base, pending, turnPhase: "pending" };
}

function playGatling(state: BangState, action: Extract<EngineAction, { type: "play-gatling" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  const players = state.players.map((p, i) => (i === seat ? { ...p, hand } : p));
  const base: BangState = { ...state, players, discard: [...state.discard, card] };
  const outstanding = base.turnOrder.filter((s) => s !== seat && base.players[s].alive);
  if (outstanding.length === 0) return base;
  const pending: PendingGroupResponse = {
    kind: "group",
    cause: "gatling",
    source: seat,
    requiredCard: "missed",
    barrelAllowed: true,
    outstanding,
  };
  return { ...base, pending, turnPhase: "pending" };
}

function playGeneralStore(state: BangState, action: Extract<EngineAction, { type: "play-general-store" }>): BangState {
  if (state.turnPhase !== "action") return state;
  const seat = state.turnSeat;
  const player = state.players[seat];
  const [card, hand] = takeFromHand(player.hand, action.cardId);
  let s: BangState = {
    ...state,
    players: state.players.map((p, i) => (i === seat ? { ...p, hand } : p)),
    discard: [...state.discard, card],
  };
  const aliveCount = s.players.filter((p) => p.alive).length;
  const rng = rngFor(s, action.seed, seat + 301);
  const revealed: Card[] = [];
  for (let i = 0; i < aliveCount; i++) {
    const draw = drawTopCard(s, rng);
    s = draw.state;
    if (draw.card) revealed.push(draw.card);
  }
  if (revealed.length === 0) return s;
  const order = livingSeatsInOrder(s);
  const idx = order.indexOf(seat);
  const pickOrder = [...order.slice(idx), ...order.slice(0, idx)];
  const pending: PendingGeneralStore = { kind: "general-store", revealed, pickOrder, nextPickIndex: 0 };
  return { ...s, pending, turnPhase: "pending" };
}

// ---------------------------------------------------------------------------
// Response resolution
// ---------------------------------------------------------------------------

function resolveGroupRespond(
  state: BangState,
  seat: SeatIndex,
  action: Extract<EngineAction, { type: "group-respond" }>,
): BangState {
  const pending = state.pending;
  if (!pending || pending.kind !== "group") return state;
  if (!pending.outstanding.includes(seat)) return state;

  let s = state;
  let defended = false;

  if (action.mode === "card") {
    const player = s.players[seat];
    const idx = player.hand.findIndex((c) => c.id === action.cardId && c.type === pending.requiredCard);
    if (idx === -1) return state;
    const card = player.hand[idx];
    const hand = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
    s = { ...s, players: s.players.map((p, i) => (i === seat ? { ...p, hand } : p)), discard: [...s.discard, card] };
    defended = true;
  } else if (action.mode === "barrel") {
    if (!pending.barrelAllowed) return state;
    const barrel = s.players[seat].equipment.barrel;
    if (!barrel) return state;
    const draw = drawTopCard(s, rngFor(s, action.seed, seat + 401));
    s = draw.state;
    if (draw.card) s = { ...s, discard: [...s.discard, draw.card] };
    defended = draw.card !== null && draw.card.suit === "H";
  } else {
    defended = false;
  }

  if (!defended) s = applyDamage(s, seat, 1, pending.source, undefined);

  const stillPending = s.pending && s.pending.kind === "group" ? (s.pending as PendingGroupResponse) : null;
  const outstanding = stillPending ? stillPending.outstanding.filter((x) => x !== seat) : [];
  s = { ...s, pending: stillPending && outstanding.length > 0 ? { ...stillPending, outstanding } : null };

  return resumeAfterPending(s);
}

function resolveDuelRespond(
  state: BangState,
  seat: SeatIndex,
  action: Extract<EngineAction, { type: "duel-respond" }>,
): BangState {
  const pending = state.pending;
  if (!pending || pending.kind !== "duel") return state;
  if (pending.turnToRespond !== seat) return state;

  if (action.cardId === null) {
    const opponent = pending.attacker === seat ? pending.defender : pending.attacker;
    let s: BangState = { ...state, pending: null };
    s = applyDamage(s, seat, 1, opponent, undefined);
    return resumeAfterPending(s);
  }

  const player = state.players[seat];
  const idx = player.hand.findIndex((c) => c.id === action.cardId && c.type === "bang");
  if (idx === -1) return state;
  const card = player.hand[idx];
  const hand = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
  const nextToRespond = seat === pending.attacker ? pending.defender : pending.attacker;
  return {
    ...state,
    players: state.players.map((p, i) => (i === seat ? { ...p, hand } : p)),
    discard: [...state.discard, card],
    pending: { ...pending, turnToRespond: nextToRespond },
  };
}

function resolveGeneralStorePick(
  state: BangState,
  seat: SeatIndex,
  action: Extract<EngineAction, { type: "general-store-pick" }>,
): BangState {
  const pending = state.pending;
  if (!pending || pending.kind !== "general-store") return state;
  if (pending.pickOrder[pending.nextPickIndex] !== seat) return state;
  const idx = pending.revealed.findIndex((c) => c.id === action.cardId);
  if (idx === -1) return state;
  const card = pending.revealed[idx];
  const revealed = [...pending.revealed.slice(0, idx), ...pending.revealed.slice(idx + 1)];
  const s: BangState = { ...state, players: state.players.map((p, i) => (i === seat ? { ...p, hand: [...p.hand, card] } : p)) };
  if (revealed.length === 0) return resumeAfterPending({ ...s, pending: null });
  return { ...s, pending: { ...pending, revealed, nextPickIndex: pending.nextPickIndex + 1 } };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: BangState, action: EngineAction): BangState {
  switch (action.type) {
    case "begin-turn":
      return beginTurn(state, action.seed);
    case "play-beer":
      return playBeer(state, action.cardId);
    case "play-saloon":
      return playSaloon(state, action.cardId);
    case "play-stagecoach":
      return playDrawCards(state, action.cardId, 2, action.seed);
    case "play-wells-fargo":
      return playDrawCards(state, action.cardId, 3, action.seed);
    case "play-weapon":
    case "play-scope":
    case "play-mustang":
    case "play-barrel":
    case "play-dynamite":
      return playEquip(state, action.cardId);
    case "play-panic":
      return playPanic(state, action);
    case "play-cat-balou":
      return playCatBalou(state, action);
    case "play-jail":
      return playJail(state, action);
    case "play-bang":
      return playBang(state, action);
    case "play-duel":
      return playDuel(state, action);
    case "play-indians":
      return playIndians(state, action);
    case "play-gatling":
      return playGatling(state, action);
    case "play-general-store":
      return playGeneralStore(state, action);
    case "group-respond":
      return resolveGroupRespond(state, action.seat, action);
    case "duel-respond":
      return resolveDuelRespond(state, action.seat, action);
    case "general-store-pick":
      return resolveGeneralStorePick(state, action.seat, action);
    case "end-turn":
      return endTurn(state, action);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). Information fairness: this
// engine has no `getPlayerView`-style redaction helper of its own (every
// role is redacted only in the UI layer) — the bot compensates by only ever
// treating another seat's role as known when `roleRevealed` is true (public
// per the sheriff's always-revealed status and the reveal-on-death rule),
// falling back to "unknown" (neutral) otherwise. Its own seat's role is
// always legitimately known. Actions that carry an optional `seed`
// (stagecoach/wells-fargo/panic/cat-balou/general-store/barrel-response) are
// simply left seedless here — `rngFor`'s own state-derived fallback already
// makes the reducer deterministic without one, so there's nothing for
// `chooseBotAction` to fill in after the fact (unlike coup/lasVegas).
// ---------------------------------------------------------------------------

const EQUIP_SLOTS: EquipSlot[] = ["weapon", "scope", "mustang", "barrel", "jail", "dynamite"];

function teamOf(role: Role): Team {
  if (role === "sheriff" || role === "deputy") return "law";
  if (role === "outlaw") return "outlaw";
  return "renegade";
}

/** The viewer's best legitimate read on `targetSeat`'s team — their own team if it's the viewer's own seat, the real team once `roleRevealed` makes it public, "unknown" otherwise. Never reads another seat's still-secret role. */
function apparentTeam(state: BangState, viewerSeat: SeatIndex, targetSeat: SeatIndex): Team | "unknown" {
  if (targetSeat === viewerSeat) return teamOf(state.players[viewerSeat].role);
  const target = state.players[targetSeat];
  return target.roleRevealed ? teamOf(target.role) : "unknown";
}

const CARD_VALUE: Partial<Record<CardType, number>> = {
  volcanic: 6, schofield: 6, remington: 6, "rev-carbine": 6, winchester: 6,
  bang: 5, missed: 4, duel: 4, beer: 3, barrel: 3, mustang: 3, scope: 3,
  panic: 3, "cat-balou": 3, indians: 3, gatling: 3,
  jail: 2, dynamite: 2, "general-store": 2, saloon: 2, stagecoach: 2, "wells-fargo": 2,
};

function cardValue(c: Card): number {
  return CARD_VALUE[c.type] ?? 1;
}

/** Which cards `end-turn` would discard right now — greedily keeps the highest-value cards and sheds the rest, only when over the hand-size limit (no-op otherwise). */
function discardSelectionFor(player: PlayerState): string[] {
  const excess = player.hand.length - player.life;
  if (excess <= 0) return [];
  return [...player.hand]
    .sort((a, b) => cardValue(a) - cardValue(b))
    .slice(0, excess)
    .map((c) => c.id);
}

export function getValidMoves(state: BangState, seat: SeatIndex): EngineAction[] {
  if (state.winner) return [];

  if (state.pending) {
    const pending = state.pending;
    if (pending.kind === "group") {
      if (!pending.outstanding.includes(seat)) return [];
      const player = state.players[seat];
      const moves: EngineAction[] = [];
      for (const c of player.hand) {
        if (c.type === pending.requiredCard) moves.push({ type: "group-respond", seat, mode: "card", cardId: c.id });
      }
      if (pending.barrelAllowed && player.equipment.barrel) moves.push({ type: "group-respond", seat, mode: "barrel" });
      moves.push({ type: "group-respond", seat, mode: "take-hit" }); // always legal — guarantees this list is never empty
      return moves;
    }
    if (pending.kind === "duel") {
      if (pending.turnToRespond !== seat) return [];
      const player = state.players[seat];
      const moves: EngineAction[] = [];
      for (const c of player.hand) if (c.type === "bang") moves.push({ type: "duel-respond", seat, cardId: c.id });
      moves.push({ type: "duel-respond", seat, cardId: null }); // concede — always legal
      return moves;
    }
    // general-store
    if (pending.pickOrder[pending.nextPickIndex] !== seat) return [];
    return pending.revealed.map((c) => ({ type: "general-store-pick", seat, cardId: c.id }) as EngineAction);
  }

  if (state.turnPhase === "begin-turn") {
    return seat === state.turnSeat ? [{ type: "begin-turn" }] : [];
  }
  if (state.turnPhase !== "action" || seat !== state.turnSeat) return [];

  const player = state.players[seat];
  const aliveOthers = livingSeatsInOrder(state).filter((s) => s !== seat);
  const aliveCount = state.players.filter((p) => p.alive).length;
  const moves: EngineAction[] = [];

  for (const card of player.hand) {
    switch (card.type) {
      case "bang": {
        const cap = player.equipment.weapon?.type === "volcanic" ? Infinity : 1;
        if (player.bangPlayedThisTurn < cap) {
          for (const target of aliveOthers) {
            if (canBang(state, seat, target)) moves.push({ type: "play-bang", cardId: card.id, targetSeat: target });
          }
        }
        break;
      }
      case "beer":
        if (aliveCount > 2) moves.push({ type: "play-beer", cardId: card.id });
        break;
      case "saloon":
        moves.push({ type: "play-saloon", cardId: card.id });
        break;
      case "stagecoach":
        moves.push({ type: "play-stagecoach", cardId: card.id });
        break;
      case "wells-fargo":
        moves.push({ type: "play-wells-fargo", cardId: card.id });
        break;
      case "volcanic":
      case "schofield":
      case "remington":
      case "rev-carbine":
      case "winchester":
        moves.push({ type: "play-weapon", cardId: card.id });
        break;
      case "scope":
        moves.push({ type: "play-scope", cardId: card.id });
        break;
      case "mustang":
        moves.push({ type: "play-mustang", cardId: card.id });
        break;
      case "barrel":
        moves.push({ type: "play-barrel", cardId: card.id });
        break;
      case "dynamite":
        moves.push({ type: "play-dynamite", cardId: card.id });
        break;
      case "panic":
        for (const target of aliveOthers) {
          if (effectiveDistance(state, seat, target) > 1) continue;
          const t = state.players[target];
          if (t.hand.length > 0) moves.push({ type: "play-panic", cardId: card.id, targetSeat: target, from: "hand" });
          for (const slot of EQUIP_SLOTS) {
            const equipCard = t.equipment[slot];
            if (equipCard) moves.push({ type: "play-panic", cardId: card.id, targetSeat: target, from: "equip", equipCardId: equipCard.id });
          }
        }
        break;
      case "cat-balou":
        for (const target of aliveOthers) {
          const t = state.players[target];
          if (t.hand.length > 0) moves.push({ type: "play-cat-balou", cardId: card.id, targetSeat: target, from: "hand" });
          for (const slot of EQUIP_SLOTS) {
            const equipCard = t.equipment[slot];
            if (equipCard) moves.push({ type: "play-cat-balou", cardId: card.id, targetSeat: target, from: "equip", equipCardId: equipCard.id });
          }
        }
        break;
      case "jail":
        for (const target of aliveOthers) {
          if (state.players[target].role !== "sheriff") moves.push({ type: "play-jail", cardId: card.id, targetSeat: target });
        }
        break;
      case "duel":
        for (const target of aliveOthers) moves.push({ type: "play-duel", cardId: card.id, targetSeat: target });
        break;
      case "indians":
        moves.push({ type: "play-indians", cardId: card.id });
        break;
      case "gatling":
        moves.push({ type: "play-gatling", cardId: card.id });
        break;
      case "general-store":
        moves.push({ type: "play-general-store", cardId: card.id });
        break;
      default:
        break; // "missed" has no action-phase effect — response-only.
    }
  }

  moves.push({ type: "end-turn", discardCardIds: discardSelectionFor(player) }); // always legal — guarantees this list is never empty
  return moves;
}

/**
 * Higher = more desirable for the bot. Tiers per ARCHITECTURE.md §7.5:
 * novice ~ uniform over every legal move. core reacts to immediate danger
 * (plays Beer when actually hurt, desperately avoids "take the hit"/concede
 * once at 1 life) but targets attacks without any role read. expert
 * (Lv.8-10, per the task brief) additionally weighs targets by apparent
 * team via `apparentTeam` — law hunts revealed Outlaws/Renegades and never
 * hits a revealed teammate, Outlaws prioritize the Sheriff above all else,
 * and Renegades hang back from open attacks once only 3 players remain
 * (angling to be the last one standing rather than tipping the balance).
 */
export function scoreMove(state: BangState, seat: SeatIndex, move: EngineAction, tier: BotTier): number {
  if (tier === "novice") return 0;
  const expert = tier === "expert";
  const player = state.players[seat];
  const myTeam = teamOf(player.role);
  const aliveCount = state.players.filter((p) => p.alive).length;

  const hostility = (targetSeat: SeatIndex): number => {
    const apparent = apparentTeam(state, seat, targetSeat);
    if (myTeam === "law") {
      if (apparent === "outlaw" || apparent === "renegade") return 2;
      if (apparent === "law") return -3; // never want to hit a revealed teammate
      return 0; // unknown seat — no reliable read
    }
    if (myTeam === "outlaw") {
      if (apparent === "law" && state.players[targetSeat].role === "sheriff") return 3; // killing the Sheriff wins outright
      if (apparent === "law") return 2;
      if (apparent === "renegade") return 1;
      return 0.5;
    }
    // renegade
    if (aliveCount <= 3) return -1; // hang back near the endgame — angling to be last standing
    if (apparent === "law") return 2;
    if (apparent === "outlaw") return 1;
    return 0.5;
  };

  switch (move.type) {
    case "begin-turn":
      return 0; // the only candidate in this phase
    case "play-bang":
      return 8 + (expert ? hostility(move.targetSeat) * 5 : 3);
    case "play-duel":
      return 7 + (expert ? hostility(move.targetSeat) * 5 : 2);
    case "play-jail":
      return 4 + (expert ? hostility(move.targetSeat) * 4 : 1);
    case "play-indians":
    case "play-gatling": {
      // Hits everyone else at once — much better when most of "everyone else" is hostile.
      const others = livingSeatsInOrder(state).filter((s) => s !== seat);
      const net = expert ? others.reduce((sum, s) => sum + hostility(s), 0) : others.length;
      return 6 + net;
    }
    case "play-panic":
      return 5 + (expert ? hostility(move.targetSeat) * 3 : 1); // steals (keeps the card), so scores a touch above Cat Balou
    case "play-cat-balou":
      return 4 + (expert ? hostility(move.targetSeat) * 3 : 1);
    case "play-beer": {
      const missing = player.maxLife - player.life;
      if (!expert) return missing > 0 ? 9 : 1; // core: only heals when actually hurt
      return 4 + missing * 3;
    }
    case "play-saloon": {
      const missing = player.maxLife - player.life;
      return 3 + missing * 2;
    }
    case "play-weapon":
    case "play-scope":
    case "play-mustang":
    case "play-barrel":
    case "play-dynamite":
      return 6; // equipment upgrades are almost always worth playing immediately
    case "play-stagecoach":
      return 5;
    case "play-wells-fargo":
      return 6;
    case "play-general-store":
      return 4;
    case "end-turn": {
      if (!expert) return player.life <= player.maxLife / 2 ? -2 : 0; // core: reluctant to pass while hurt if anything else was on offer
      return -1; // ending the turn is a legal fallback but usually the worst option available
    }
    case "group-respond": {
      if (move.mode === "take-hit") return player.life <= 1 ? -20 : -2; // desperate to avoid this near death
      if (move.mode === "barrel") return 3; // a free (no card spent) chance to dodge
      return 6; // spending a real card to guarantee the dodge
    }
    case "duel-respond": {
      if (move.cardId === null) return player.life <= 1 ? -20 : -2;
      return 6;
    }
    case "general-store-pick": {
      const card = state.pending?.kind === "general-store" ? state.pending.revealed.find((c) => c.id === move.cardId) : undefined;
      return card ? cardValue(card) : 0;
    }
    default:
      return 0;
  }
}

export function chooseBotAction(
  state: BangState,
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
