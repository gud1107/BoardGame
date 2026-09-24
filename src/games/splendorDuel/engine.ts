/**
 * Pure "스플렌더 대결" (Splendor Duel) rules engine — no React, no I/O.
 * Implements boardGameRule/스플랜더 대결/스플랜더 대결.md: a 2-player-only
 * Splendor variant where tokens are drafted from a 5×5 board in contiguous
 * lines instead of from a supply, 3 privilege scrolls move between the table
 * and the players, cards carry crowns and abilities, and the game ends the
 * instant the active player finishes a turn having met any of 3 victory
 * conditions (20 prestige / 10 crowns / 10 prestige in one color).
 *
 * Turn structure (rulebook §3-§4) is modelled as:
 *  - `playing` + `!mandatoryDone`: optional actions (use scroll / refill the
 *    board) any number of times, then exactly one mandatory action (take
 *    1-3 tokens in a line / reserve + gold / buy).
 *  - `resolving`: a FIFO `pending` queue of follow-up decisions the active
 *    player must make before the turn can end — card/royal abilities that
 *    need a choice (copy bonus, take matching token, steal), picking a royal
 *    card on reaching 3/6 crowns, and discarding down to 10 tokens. Choices
 *    that have no legal option (e.g. steal from an opponent with no gems) are
 *    skipped automatically, so the queue never dead-ends.
 *  - `gameOver` once `checkVictory` passes at the end of a turn.
 *
 * Same lockstep trust model as every other online game here (see
 * lostCities/engine.ts): both clients hold the full state and replay the
 * same `EngineAction`s. The only mid-game randomness — refilling the board
 * from the bag — is derived from `seed` + `refillCount`, never Math.random,
 * so replays stay byte-identical on every client.
 */

import { seededRng, shuffle } from "@/lib/rng";
import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  addTokens,
  canPayTokens,
  createDevelopmentDeck,
  createRoyalCards,
  GEM_ORDER,
  subtractTokens,
  TOKEN_ORDER,
  tokenTotal,
  type BoardToken,
  type CardAbility,
  type DuelCard,
  type GemColor,
  type Level,
  type RoyalCard,
  type TokenBundle,
  type TokenColor,
} from "./cards";

export type { BoardToken, CardAbility, DuelCard, GemColor, Level, RoyalCard, TokenBundle, TokenColor } from "./cards";
export { GEM_ORDER, TOKEN_ORDER, tokenTotal } from "./cards";

export type Seat = "p1" | "p2";
export const SEATS: Seat[] = ["p1", "p2"];
export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export const GRID_SIZE = 5;
export const GOLD_SUPPLY = 3;
export const TOTAL_SCROLLS = 3;
export const TOKEN_LIMIT = 10;
export const RESERVE_LIMIT = 3;
export const MARKET_SIZE: Record<Level, number> = { 1: 5, 2: 4, 3: 3 };
/** Rulebook §5 — a royal card is claimed on reaching each of these crown totals (max 2 per player). */
export const ROYAL_CROWN_THRESHOLDS = [3, 6];
export const WIN_PRESTIGE = 20;
export const WIN_CROWNS = 10;
export const WIN_SINGLE_COLOR = 10;

/**
 * The 25 board cells in fill order: starting at the center (2,2) and
 * spiraling outward (rulebook §1-3 "중앙 소용돌이 시작점부터"). 22 starting
 * tokens fill the first 22, so the last 3 (top row, right side) start empty.
 */
export const SPIRAL_COORDS: [number, number][] = [
  [2, 2], [2, 3], [3, 3], [3, 2], [3, 1],
  [2, 1], [1, 1], [1, 2], [1, 3], [1, 4],
  [2, 4], [3, 4], [4, 4], [4, 3], [4, 2],
  [4, 1], [4, 0], [3, 0], [2, 0], [1, 0],
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
];
/** Same order as flat cell indices (`row * 5 + col`). */
export const SPIRAL_ORDER: number[] = SPIRAL_COORDS.map(([r, c]) => r * GRID_SIZE + c);

export interface OwnedCard extends DuelCard {
  /** The color this card counts as for bonuses/single-color points — `color`, or the color a "보너스 복사" card was bound to. */
  boundColor: GemColor | null;
}

export interface PlayerState {
  tokens: TokenBundle;
  cards: OwnedCard[];
  reserved: DuelCard[];
  royals: RoyalCard[];
  scrolls: number;
}

export type Pending =
  | { kind: "copyBonus"; cardId: string }
  | { kind: "takeToken"; color: GemColor }
  | { kind: "stealToken" }
  | { kind: "chooseRoyal" }
  | { kind: "discard" };

export type WinReason = "prestige" | "crowns" | "singleColor";

/** One-shot "what just happened" marker the UI uses for FX/sound — purely cosmetic, never read by rules. */
export type DuelEvent =
  | { kind: "take"; seat: Seat; count: number; penalty: boolean; scrollFrom: ScrollSource }
  | { kind: "scrollUse"; seat: Seat }
  | { kind: "refill"; seat: Seat; scrollFrom: ScrollSource }
  | { kind: "reserve"; seat: Seat; gainedGold: boolean }
  | { kind: "buy"; seat: Seat; cardId: string; scrollFrom: ScrollSource; goldSpent: number }
  | { kind: "royal"; seat: Seat; royalId: string; scrollFrom: ScrollSource }
  | { kind: "steal"; seat: Seat; color: TokenColor }
  | { kind: "copy"; seat: Seat; color: GemColor }
  | { kind: "takeMatching"; seat: Seat; color: GemColor }
  | { kind: "discard"; seat: Seat; goldReturned: number }
  | { kind: "extraTurn"; seat: Seat }
  | { kind: "pass"; seat: Seat };

/** Where a scroll gained this action came from — "none" when the gainer already holds all 3. */
export type ScrollSource = "table" | "opponent" | "none" | null;

export interface SplendorDuelState {
  seed: number;
  refillCount: number;
  /** Flat 25-cell board, index = row * 5 + col. */
  grid: (BoardToken | null)[];
  bag: BoardToken[];
  goldSupply: number;
  tableScrolls: number;
  decks: Record<Level, DuelCard[]>;
  market: Record<Level, (DuelCard | null)[]>;
  royals: RoyalCard[];
  players: Record<Seat, PlayerState>;
  activeSeat: Seat;
  turnNumber: number;
  phase: "playing" | "resolving" | "gameOver";
  mandatoryDone: boolean;
  pending: Pending[];
  extraTurn: boolean;
  winner: Seat | null;
  winReason: WinReason | null;
  lastEvent: DuelEvent | null;
  eventSeq: number;
}

export type EngineAction =
  | { type: "useScroll"; seat: Seat; cell: number }
  | { type: "refillBoard"; seat: Seat }
  | { type: "takeTokens"; seat: Seat; cells: number[] }
  | { type: "reserveCard"; seat: Seat; level: Level; marketIndex?: number }
  | { type: "buyCard"; seat: Seat; cardId: string; source: "market" | "reserved" }
  | { type: "resolveCopy"; seat: Seat; color: GemColor }
  | { type: "resolveTakeToken"; seat: Seat; cell: number }
  | { type: "resolveSteal"; seat: Seat; color: GemColor | "pearl" }
  | { type: "chooseRoyal"; seat: Seat; royalId: string }
  | { type: "discardTokens"; seat: Seat; discard: TokenBundle }
  | { type: "pass"; seat: Seat };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function fillFromBag(grid: (BoardToken | null)[], bag: BoardToken[], rng: () => number) {
  const shuffled = shuffle(bag, rng);
  const next = [...grid];
  for (const idx of SPIRAL_ORDER) {
    if (next[idx] === null && shuffled.length > 0) next[idx] = shuffled.shift()!;
  }
  return { grid: next, bag: shuffled };
}

export function startGame(seed: number): SplendorDuelState {
  const rng = seededRng(seed);
  const all = createDevelopmentDeck();
  const decks = {} as Record<Level, DuelCard[]>;
  const market = {} as Record<Level, (DuelCard | null)[]>;
  for (const level of [1, 2, 3] as Level[]) {
    const shuffled = shuffle(all.filter((c) => c.level === level), rng);
    market[level] = shuffled.slice(0, MARKET_SIZE[level]);
    decks[level] = shuffled.slice(MARKET_SIZE[level]);
  }
  const bag: BoardToken[] = [];
  for (const c of GEM_ORDER) for (let i = 0; i < 4; i++) bag.push(c);
  bag.push("pearl", "pearl");
  const filled = fillFromBag(Array(GRID_SIZE * GRID_SIZE).fill(null), bag, rng);

  const emptyPlayer = (scrolls: number): PlayerState => ({ tokens: {}, cards: [], reserved: [], royals: [], scrolls });
  return {
    seed,
    refillCount: 0,
    grid: filled.grid,
    bag: filled.bag,
    goldSupply: GOLD_SUPPLY,
    // Rulebook §1-6 — the second player starts holding 1 scroll.
    tableScrolls: TOTAL_SCROLLS - 1,
    decks,
    market,
    royals: createRoyalCards(),
    players: { p1: emptyPlayer(0), p2: emptyPlayer(1) },
    activeSeat: "p1",
    turnNumber: 1,
    phase: "playing",
    mandatoryDone: false,
    pending: [],
    extraTurn: false,
    winner: null,
    winReason: null,
    lastEvent: null,
    eventSeq: 0,
  };
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export function bonusCounts(player: PlayerState): Record<GemColor, number> {
  const out = { white: 0, blue: 0, green: 0, red: 0, black: 0 } as Record<GemColor, number>;
  for (const c of player.cards) if (c.boundColor) out[c.boundColor] += c.bonus;
  return out;
}

export function colorPoints(player: PlayerState): Record<GemColor, number> {
  const out = { white: 0, blue: 0, green: 0, red: 0, black: 0 } as Record<GemColor, number>;
  for (const c of player.cards) if (c.boundColor) out[c.boundColor] += c.points;
  return out;
}

export function prestigeOf(player: PlayerState): number {
  return player.cards.reduce((s, c) => s + c.points, 0) + player.royals.reduce((s, r) => s + r.points, 0);
}

export function crownsOf(player: PlayerState): number {
  return player.cards.reduce((s, c) => s + c.crowns, 0);
}

/** Rulebook §2 — checked only at the end of the active player's own turn. */
export function checkVictory(player: PlayerState): WinReason | null {
  if (prestigeOf(player) >= WIN_PRESTIGE) return "prestige";
  if (crownsOf(player) >= WIN_CROWNS) return "crowns";
  if (Object.values(colorPoints(player)).some((p) => p >= WIN_SINGLE_COLOR)) return "singleColor";
  return null;
}

/** Cost after color-bonus discounts. Pearls are never discounted (no card grants a pearl bonus). */
export function effectiveCost(card: DuelCard, player: PlayerState): Partial<Record<GemColor | "pearl", number>> {
  const bonus = bonusCounts(player);
  const out: Partial<Record<GemColor | "pearl", number>> = {};
  for (const c of GEM_ORDER) {
    const n = Math.max(0, (card.cost[c] ?? 0) - bonus[c]);
    if (n > 0) out[c] = n;
  }
  if (card.cost.pearl) out.pearl = card.cost.pearl;
  return out;
}

/** Gems/pearls still missing after bonuses and held tokens — exactly how many gold this purchase would need. */
export function goldNeeded(card: DuelCard, player: PlayerState): number {
  let short = 0;
  for (const [color, need] of Object.entries(effectiveCost(card, player)) as [GemColor | "pearl", number][]) {
    short += Math.max(0, need - (player.tokens[color] ?? 0));
  }
  return short;
}

/**
 * Spend matching tokens first, gold only for the shortfall — never worse than
 * any other valid payment (see splendor/engine.ts `computeAutoPayment`).
 * Hard cap: returns null (unaffordable) whenever the shortfall exceeds the
 * gold the player actually holds, so gold is never conjured from nothing.
 */
export function autoPayment(card: DuelCard, player: PlayerState): TokenBundle | null {
  const cost = effectiveCost(card, player);
  const payment: TokenBundle = {};
  let gold = 0;
  for (const [color, need] of Object.entries(cost) as [GemColor | "pearl", number][]) {
    const have = player.tokens[color] ?? 0;
    const pay = Math.min(need, have);
    if (pay > 0) payment[color] = pay;
    gold += need - pay;
  }
  if (gold > (player.tokens.gold ?? 0)) return null;
  if (gold > 0) payment.gold = gold;
  return payment;
}

export function canAfford(card: DuelCard, player: PlayerState): boolean {
  return autoPayment(card, player) !== null;
}

function cellRC(idx: number): [number, number] {
  return [Math.floor(idx / GRID_SIZE), idx % GRID_SIZE];
}

/**
 * Rulebook §3 필수 행동 1 — 1 to 3 tokens forming one unbroken horizontal,
 * vertical or diagonal line. Every chosen cell must hold a token, so an
 * empty cell between two picks can never be "skipped over": the picks
 * themselves must be adjacent step by step.
 */
export function isValidSelection(cells: number[], grid: (BoardToken | null)[]): boolean {
  if (cells.length < 1 || cells.length > 3) return false;
  if (new Set(cells).size !== cells.length) return false;
  if (cells.some((i) => i < 0 || i >= grid.length || grid[i] === null)) return false;
  if (cells.length === 1) return true;
  const sorted = [...cells].map(cellRC).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const dr = sorted[1][0] - sorted[0][0];
  const dc = sorted[1][1] - sorted[0][1];
  const okStep = (dr === 0 && dc === 1) || (dr === 1 && (dc === 0 || dc === 1 || dc === -1));
  if (!okStep) return false;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i][0] - sorted[i - 1][0] !== dr || sorted[i][1] - sorted[i - 1][1] !== dc) return false;
  }
  return true;
}

/** Rulebook §3 — taking 3 of the same color or both pearls hands the opponent a scroll. */
export function selectionGivesPrivilege(cells: number[], grid: (BoardToken | null)[]): boolean {
  const tokens = cells.map((i) => grid[i]);
  if (tokens.filter((t) => t === "pearl").length >= 2) return true;
  return tokens.length === 3 && tokens.every((t) => t !== null && t !== "pearl" && t === tokens[0]);
}

/** Every legal 1-3 token line on the board — used by the bot and to detect "nothing to take". */
export function allSelections(grid: (BoardToken | null)[]): number[][] {
  const out: number[][] = [];
  const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let idx = 0; idx < grid.length; idx++) {
    if (grid[idx] === null) continue;
    out.push([idx]);
    const [r, c] = cellRC(idx);
    for (const [dr, dc] of dirs) {
      const line = [idx];
      for (let k = 1; k < 3; k++) {
        const nr = r + dr * k;
        const nc = c + dc * k;
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) break;
        const n = nr * GRID_SIZE + nc;
        if (grid[n] === null) break;
        line.push(n);
        out.push([...line]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scroll helpers (rulebook §6 — exactly 3 scrolls exist, zero-sum)
// ---------------------------------------------------------------------------

function gainScroll(state: SplendorDuelState, seat: Seat): { state: SplendorDuelState; from: ScrollSource } {
  const opp = otherSeat(seat);
  if (state.tableScrolls > 0) {
    return {
      state: { ...state, tableScrolls: state.tableScrolls - 1, players: patchPlayer(state.players, seat, { scrolls: state.players[seat].scrolls + 1 }) },
      from: "table",
    };
  }
  if (state.players[opp].scrolls > 0) {
    let players = patchPlayer(state.players, opp, { scrolls: state.players[opp].scrolls - 1 });
    players = patchPlayer(players, seat, { scrolls: players[seat].scrolls + 1 });
    return { state: { ...state, players }, from: "opponent" };
  }
  return { state, from: "none" };
}

function patchPlayer(players: Record<Seat, PlayerState>, seat: Seat, patch: Partial<PlayerState>): Record<Seat, PlayerState> {
  return { ...players, [seat]: { ...players[seat], ...patch } };
}

function withEvent(state: SplendorDuelState, event: DuelEvent): SplendorDuelState {
  return { ...state, lastEvent: event, eventSeq: state.eventSeq + 1 };
}

function canAct(state: SplendorDuelState, seat: Seat): boolean {
  return state.phase === "playing" && seat === state.activeSeat && !state.mandatoryDone;
}

// ---------------------------------------------------------------------------
// Optional actions
// ---------------------------------------------------------------------------

function spendScroll(state: SplendorDuelState, seat: Seat, cell: number): SplendorDuelState {
  if (!canAct(state, seat)) return state;
  const token = state.grid[cell];
  if (state.players[seat].scrolls <= 0 || token === null || token === undefined) return state;
  const grid = [...state.grid];
  grid[cell] = null;
  const p = state.players[seat];
  const players = patchPlayer(state.players, seat, { scrolls: p.scrolls - 1, tokens: addTokens(p.tokens, { [token]: 1 }) });
  return withEvent({ ...state, grid, players, tableScrolls: state.tableScrolls + 1 }, { kind: "scrollUse", seat });
}

function refillBoard(state: SplendorDuelState, seat: Seat): SplendorDuelState {
  if (!canAct(state, seat) || state.bag.length === 0) return state;
  if (!state.grid.some((t) => t === null)) return state;
  const rng = seededRng((state.seed ^ Math.imul(state.refillCount + 1, 0x9e3779b1)) >>> 0);
  const filled = fillFromBag(state.grid, state.bag, rng);
  const gained = gainScroll({ ...state, grid: filled.grid, bag: filled.bag, refillCount: state.refillCount + 1 }, otherSeat(seat));
  return withEvent(gained.state, { kind: "refill", seat, scrollFrom: gained.from });
}

// ---------------------------------------------------------------------------
// Mandatory actions
// ---------------------------------------------------------------------------

function takeTokens(state: SplendorDuelState, seat: Seat, cells: number[]): SplendorDuelState {
  if (!canAct(state, seat) || !isValidSelection(cells, state.grid)) return state;
  const penalty = selectionGivesPrivilege(cells, state.grid);
  const grid = [...state.grid];
  let tokens = state.players[seat].tokens;
  for (const i of cells) {
    tokens = addTokens(tokens, { [grid[i]!]: 1 });
    grid[i] = null;
  }
  let next: SplendorDuelState = { ...state, grid, players: patchPlayer(state.players, seat, { tokens }), mandatoryDone: true };
  let from: ScrollSource = null;
  if (penalty) {
    const g = gainScroll(next, otherSeat(seat));
    next = g.state;
    from = g.from;
  }
  return continueTurn(withEvent(next, { kind: "take", seat, count: cells.length, penalty, scrollFrom: from }));
}

function reserveCard(state: SplendorDuelState, seat: Seat, level: Level, marketIndex?: number): SplendorDuelState {
  if (!canAct(state, seat)) return state;
  const p = state.players[seat];
  if (p.reserved.length >= RESERVE_LIMIT) return state;
  let market = state.market;
  let decks = state.decks;
  let card: DuelCard | null;
  if (marketIndex !== undefined) {
    card = state.market[level][marketIndex] ?? null;
    if (!card) return state;
    const drawn = decks[level][0] ?? null;
    market = { ...market, [level]: market[level].map((c, i) => (i === marketIndex ? drawn : c)) };
    decks = { ...decks, [level]: decks[level].slice(1) };
  } else {
    card = decks[level][0] ?? null;
    if (!card) return state;
    decks = { ...decks, [level]: decks[level].slice(1) };
  }
  // Rulebook §3 필수 행동 2 — reserving is still allowed when the gold stand is empty, just without the gold.
  const gainedGold = state.goldSupply > 0;
  const players = patchPlayer(state.players, seat, {
    reserved: [...p.reserved, card],
    tokens: gainedGold ? addTokens(p.tokens, { gold: 1 }) : p.tokens,
  });
  const next: SplendorDuelState = { ...state, market, decks, players, goldSupply: state.goldSupply - (gainedGold ? 1 : 0), mandatoryDone: true };
  return continueTurn(withEvent(next, { kind: "reserve", seat, gainedGold }));
}

/** Apply a card/royal ability: instant ones resolve now, choice-based ones queue a `Pending`. */
function applyAbility(
  state: SplendorDuelState,
  seat: Seat,
  ability: CardAbility | undefined,
  source: { cardId?: string; color?: GemColor | null },
): { state: SplendorDuelState; scrollFrom: ScrollSource } {
  switch (ability) {
    case "extraTurn":
      return { state: { ...state, extraTurn: true }, scrollFrom: null };
    case "gainPrivilege": {
      const g = gainScroll(state, seat);
      return { state: g.state, scrollFrom: g.from };
    }
    case "copyBonus":
      return { state: { ...state, pending: [...state.pending, { kind: "copyBonus", cardId: source.cardId! }] }, scrollFrom: null };
    case "takeToken":
      if (!source.color) return { state, scrollFrom: null };
      return { state: { ...state, pending: [...state.pending, { kind: "takeToken", color: source.color }] }, scrollFrom: null };
    case "stealToken":
      return { state: { ...state, pending: [...state.pending, { kind: "stealToken" }] }, scrollFrom: null };
    default:
      return { state, scrollFrom: null };
  }
}

function buyCard(state: SplendorDuelState, seat: Seat, cardId: string, source: "market" | "reserved"): SplendorDuelState {
  if (!canAct(state, seat)) return state;
  const p = state.players[seat];
  let card: DuelCard | undefined;
  let market = state.market;
  let decks = state.decks;
  let reserved = p.reserved;
  if (source === "reserved") {
    card = p.reserved.find((c) => c.id === cardId);
    reserved = p.reserved.filter((c) => c.id !== cardId);
  } else {
    for (const level of [1, 2, 3] as Level[]) {
      const idx = state.market[level].findIndex((c) => c?.id === cardId);
      if (idx < 0) continue;
      card = state.market[level][idx]!;
      const drawn = decks[level][0] ?? null;
      market = { ...market, [level]: market[level].map((c, i) => (i === idx ? drawn : c)) };
      decks = { ...decks, [level]: decks[level].slice(1) };
      break;
    }
  }
  if (!card) return state;
  const payment = autoPayment(card, p);
  if (!payment) return state;

  const bagReturn: BoardToken[] = [];
  for (const [color, n] of Object.entries(payment) as [TokenColor, number][]) {
    if (color === "gold") continue;
    for (let i = 0; i < n; i++) bagReturn.push(color);
  }
  const owned: OwnedCard = { ...card, boundColor: card.color };
  const players = patchPlayer(state.players, seat, {
    tokens: subtractTokens(p.tokens, payment),
    cards: [...p.cards, owned],
    reserved,
  });
  let next: SplendorDuelState = {
    ...state,
    market,
    decks,
    players,
    bag: [...state.bag, ...bagReturn],
    goldSupply: state.goldSupply + (payment.gold ?? 0),
    mandatoryDone: true,
  };
  const applied = applyAbility(next, seat, card.ability, { cardId: card.id, color: card.color });
  next = applied.state;
  return continueTurn(withEvent(next, { kind: "buy", seat, cardId: card.id, scrollFrom: applied.scrollFrom, goldSpent: payment.gold ?? 0 }));
}

function pass(state: SplendorDuelState, seat: Seat): SplendorDuelState {
  if (!canAct(state, seat)) return state;
  // Only ever offered when nothing else is legal — see getValidMoves.
  if (getMandatoryMoves(state, seat).length > 0) return state;
  return continueTurn(withEvent({ ...state, mandatoryDone: true }, { kind: "pass", seat }));
}

// ---------------------------------------------------------------------------
// Pending resolution (abilities / royals / discard)
// ---------------------------------------------------------------------------

function opponentStealable(state: SplendorDuelState, seat: Seat): (GemColor | "pearl")[] {
  const opp = state.players[otherSeat(seat)];
  return ([...GEM_ORDER, "pearl"] as (GemColor | "pearl")[]).filter((c) => (opp.tokens[c] ?? 0) > 0);
}

function royalDue(state: SplendorDuelState, seat: Seat): boolean {
  const p = state.players[seat];
  const claimed = p.royals.length;
  if (claimed >= ROYAL_CROWN_THRESHOLDS.length || state.royals.length === 0) return false;
  return crownsOf(p) >= ROYAL_CROWN_THRESHOLDS[claimed];
}

/** Can this pending step actually be acted on? If not it's silently skipped (rulebook: "획득 불가"/"보너스 없이 등록"). */
function pendingIsActionable(state: SplendorDuelState, seat: Seat, step: Pending): boolean {
  const p = state.players[seat];
  switch (step.kind) {
    case "copyBonus":
      return p.cards.some((c) => c.id !== step.cardId && c.boundColor !== null);
    case "takeToken":
      return state.grid.some((t) => t === step.color);
    case "stealToken":
      return opponentStealable(state, seat).length > 0;
    case "chooseRoyal":
      return state.royals.length > 0;
    case "discard":
      return tokenTotal(p.tokens) > TOKEN_LIMIT;
  }
}

/**
 * Drives the turn forward after any mandatory action or pending resolution:
 * pops non-actionable pending steps, stops on the first real decision, and
 * otherwise runs the end-of-turn checks in rulebook order — royal card on
 * crossing 3/6 crowns, discard down to 10, victory, then hand-off (or an
 * extra turn).
 */
function continueTurn(state: SplendorDuelState): SplendorDuelState {
  let s = state;
  const seat = s.activeSeat;
  for (let guard = 0; guard < 20; guard++) {
    if (s.pending.length > 0) {
      const head = s.pending[0];
      if (pendingIsActionable(s, seat, head)) return { ...s, phase: "resolving" };
      s = { ...s, pending: s.pending.slice(1) };
      continue;
    }
    if (royalDue(s, seat)) {
      s = { ...s, pending: [{ kind: "chooseRoyal" }] };
      continue;
    }
    if (tokenTotal(s.players[seat].tokens) > TOKEN_LIMIT) {
      s = { ...s, pending: [{ kind: "discard" }] };
      continue;
    }
    break;
  }
  return endTurn(s);
}

function endTurn(state: SplendorDuelState): SplendorDuelState {
  const seat = state.activeSeat;
  const reason = checkVictory(state.players[seat]);
  if (reason) return { ...state, phase: "gameOver", pending: [], winner: seat, winReason: reason };
  const again = state.extraTurn;
  const next: SplendorDuelState = {
    ...state,
    phase: "playing",
    pending: [],
    mandatoryDone: false,
    extraTurn: false,
    activeSeat: again ? seat : otherSeat(seat),
    turnNumber: state.turnNumber + 1,
  };
  return again ? withEvent(next, { kind: "extraTurn", seat }) : next;
}

function canResolve(state: SplendorDuelState, seat: Seat, kind: Pending["kind"]): boolean {
  return state.phase === "resolving" && seat === state.activeSeat && state.pending[0]?.kind === kind;
}

function resolveCopy(state: SplendorDuelState, seat: Seat, color: GemColor): SplendorDuelState {
  if (!canResolve(state, seat, "copyBonus")) return state;
  const step = state.pending[0] as Extract<Pending, { kind: "copyBonus" }>;
  const p = state.players[seat];
  if (!p.cards.some((c) => c.id !== step.cardId && c.boundColor === color)) return state;
  const cards = p.cards.map((c) => (c.id === step.cardId ? { ...c, boundColor: color } : c));
  const next = { ...state, players: patchPlayer(state.players, seat, { cards }), pending: state.pending.slice(1) };
  return continueTurn(withEvent(next, { kind: "copy", seat, color }));
}

function resolveTakeToken(state: SplendorDuelState, seat: Seat, cell: number): SplendorDuelState {
  if (!canResolve(state, seat, "takeToken")) return state;
  const step = state.pending[0] as Extract<Pending, { kind: "takeToken" }>;
  if (state.grid[cell] !== step.color) return state;
  const grid = [...state.grid];
  grid[cell] = null;
  const p = state.players[seat];
  const next = { ...state, grid, players: patchPlayer(state.players, seat, { tokens: addTokens(p.tokens, { [step.color]: 1 }) }), pending: state.pending.slice(1) };
  return continueTurn(withEvent(next, { kind: "takeMatching", seat, color: step.color }));
}

function resolveSteal(state: SplendorDuelState, seat: Seat, color: GemColor | "pearl"): SplendorDuelState {
  if (!canResolve(state, seat, "stealToken")) return state;
  if (!opponentStealable(state, seat).includes(color)) return state;
  const opp = otherSeat(seat);
  let players = patchPlayer(state.players, opp, { tokens: subtractTokens(state.players[opp].tokens, { [color]: 1 }) });
  players = patchPlayer(players, seat, { tokens: addTokens(players[seat].tokens, { [color]: 1 }) });
  return continueTurn(withEvent({ ...state, players, pending: state.pending.slice(1) }, { kind: "steal", seat, color }));
}

function chooseRoyal(state: SplendorDuelState, seat: Seat, royalId: string): SplendorDuelState {
  if (!canResolve(state, seat, "chooseRoyal")) return state;
  const royal = state.royals.find((r) => r.id === royalId);
  if (!royal) return state;
  const p = state.players[seat];
  let next: SplendorDuelState = {
    ...state,
    royals: state.royals.filter((r) => r.id !== royalId),
    players: patchPlayer(state.players, seat, { royals: [...p.royals, royal] }),
    pending: state.pending.slice(1),
  };
  const applied = applyAbility(next, seat, royal.ability, { color: null });
  next = applied.state;
  return continueTurn(withEvent(next, { kind: "royal", seat, royalId, scrollFrom: applied.scrollFrom }));
}

function discardTokens(state: SplendorDuelState, seat: Seat, discard: TokenBundle): SplendorDuelState {
  if (!canResolve(state, seat, "discard")) return state;
  const p = state.players[seat];
  if (!canPayTokens(p.tokens, discard)) return state;
  const tokens = subtractTokens(p.tokens, discard);
  if (tokenTotal(tokens) !== TOKEN_LIMIT) return state;
  const bagReturn: BoardToken[] = [];
  for (const [color, n] of Object.entries(discard) as [TokenColor, number][]) {
    if (color === "gold") continue;
    for (let i = 0; i < n; i++) bagReturn.push(color);
  }
  const next = {
    ...state,
    players: patchPlayer(state.players, seat, { tokens }),
    bag: [...state.bag, ...bagReturn],
    goldSupply: state.goldSupply + (discard.gold ?? 0),
    pending: state.pending.slice(1),
  };
  return continueTurn(withEvent(next, { kind: "discard", seat, goldReturned: discard.gold ?? 0 }));
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Gold invariant (rulebook §1): exactly `GOLD_SUPPLY` (3) gold tokens exist —
 * stand + both players' holdings. Gold never enters the bag or the 5×5 grid
 * (`BoardToken` excludes it by type), is only ever gained by reserving while
 * the stand is non-empty, and always returns to the stand when spent or
 * discarded. Scrolls/"토큰 획득" can only target grid cells and 강탈 only
 * gems/pearls, so none of them can move gold.
 */
export function totalGold(state: SplendorDuelState): number {
  return state.goldSupply + (state.players.p1.tokens.gold ?? 0) + (state.players.p2.tokens.gold ?? 0);
}

export function applyAction(state: SplendorDuelState, action: EngineAction): SplendorDuelState {
  const next = reduce(state, action);
  if (process.env.NODE_ENV !== "production" && totalGold(next) !== GOLD_SUPPLY) {
    console.error(`[SplendorDuel] gold invariant violated after ${action.type}: ${totalGold(next)} (expected ${GOLD_SUPPLY})`);
  }
  return next;
}

function reduce(state: SplendorDuelState, action: EngineAction): SplendorDuelState {
  switch (action.type) {
    case "useScroll":
      return spendScroll(state, action.seat, action.cell);
    case "refillBoard":
      return refillBoard(state, action.seat);
    case "takeTokens":
      return takeTokens(state, action.seat, action.cells);
    case "reserveCard":
      return reserveCard(state, action.seat, action.level, action.marketIndex);
    case "buyCard":
      return buyCard(state, action.seat, action.cardId, action.source);
    case "resolveCopy":
      return resolveCopy(state, action.seat, action.color);
    case "resolveTakeToken":
      return resolveTakeToken(state, action.seat, action.cell);
    case "resolveSteal":
      return resolveSteal(state, action.seat, action.color);
    case "chooseRoyal":
      return chooseRoyal(state, action.seat, action.royalId);
    case "discardTokens":
      return discardTokens(state, action.seat, action.discard);
    case "pass":
      return pass(state, action.seat);
    default:
      return state;
  }
}

/** Whose decision it is right now (null once the game is over). */
export function currentActor(state: SplendorDuelState): Seat | null {
  return state.phase === "gameOver" ? null : state.activeSeat;
}

// ---------------------------------------------------------------------------
// Legal moves + bot AI
// ---------------------------------------------------------------------------

function getMandatoryMoves(state: SplendorDuelState, seat: Seat): EngineAction[] {
  const p = state.players[seat];
  const moves: EngineAction[] = [];
  for (const cells of allSelections(state.grid)) moves.push({ type: "takeTokens", seat, cells });
  if (p.reserved.length < RESERVE_LIMIT) {
    for (const level of [1, 2, 3] as Level[]) {
      state.market[level].forEach((c, marketIndex) => c && moves.push({ type: "reserveCard", seat, level, marketIndex }));
      if (state.decks[level].length > 0) moves.push({ type: "reserveCard", seat, level });
    }
  }
  for (const level of [1, 2, 3] as Level[]) {
    for (const c of state.market[level]) if (c && canAfford(c, p)) moves.push({ type: "buyCard", seat, cardId: c.id, source: "market" });
  }
  for (const c of p.reserved) if (canAfford(c, p)) moves.push({ type: "buyCard", seat, cardId: c.id, source: "reserved" });
  return moves;
}

function discardCombos(tokens: TokenBundle, overage: number): TokenBundle[] {
  const colors = TOKEN_ORDER.filter((c) => (tokens[c] ?? 0) > 0);
  const out: TokenBundle[] = [];
  const walk = (i: number, left: number, acc: TokenBundle) => {
    if (left === 0) return void out.push({ ...acc });
    if (i >= colors.length) return;
    const max = Math.min(left, tokens[colors[i]] ?? 0);
    for (let n = 0; n <= max; n++) walk(i + 1, left - n, n > 0 ? { ...acc, [colors[i]]: n } : acc);
  };
  walk(0, overage, {});
  return out;
}

export function getValidMoves(state: SplendorDuelState, seat: Seat): EngineAction[] {
  if (state.phase === "gameOver" || seat !== state.activeSeat) return [];
  const p = state.players[seat];
  if (state.phase === "resolving") {
    const step = state.pending[0];
    if (!step) return [];
    switch (step.kind) {
      case "copyBonus": {
        const colors = new Set(p.cards.filter((c) => c.id !== step.cardId && c.boundColor).map((c) => c.boundColor!));
        return [...colors].map((color) => ({ type: "resolveCopy", seat, color }));
      }
      case "takeToken":
        return state.grid.flatMap((t, cell) => (t === step.color ? [{ type: "resolveTakeToken", seat, cell } as EngineAction] : []));
      case "stealToken":
        return opponentStealable(state, seat).map((color) => ({ type: "resolveSteal", seat, color }));
      case "chooseRoyal":
        return state.royals.map((r) => ({ type: "chooseRoyal", seat, royalId: r.id }));
      case "discard":
        return discardCombos(p.tokens, tokenTotal(p.tokens) - TOKEN_LIMIT).map((discard) => ({ type: "discardTokens", seat, discard }));
    }
  }
  if (state.mandatoryDone) return [];
  const moves = getMandatoryMoves(state, seat);
  // Optional actions offered to the bot only when they're clearly useful:
  // refill when the board has nothing left to take, spend a scroll when
  // holding 2+ (a hoarded scroll is just something the opponent can steal).
  if (state.bag.length > 0 && allSelections(state.grid).length === 0) moves.push({ type: "refillBoard", seat });
  if (p.scrolls >= 2) state.grid.forEach((t, cell) => t && moves.push({ type: "useScroll", seat, cell }));
  if (moves.length === 0) return [{ type: "pass", seat }];
  return moves;
}

/** How many visible/reserved cards still need more of `color` than `seat` holds — a cheap "is this token useful" proxy. */
function tokenUtility(state: SplendorDuelState, seat: Seat, color: BoardToken | "gold"): number {
  if (color === "gold") return 4;
  const p = state.players[seat];
  const cards = [...(([1, 2, 3] as Level[]).flatMap((l) => state.market[l]).filter(Boolean) as DuelCard[]), ...p.reserved];
  let u = 0;
  for (const c of cards) {
    const need = effectiveCost(c, p)[color] ?? 0;
    if (need > (p.tokens[color] ?? 0)) u += 1 + c.points * 0.3;
  }
  return color === "pearl" ? u * 1.5 + 1 : u;
}

function cardValue(card: DuelCard, seat: Seat, state: SplendorDuelState, expert: boolean): number {
  const p = state.players[seat];
  let v = card.points * 10 + card.crowns * 6 + card.bonus * 3;
  const abilityBonus: Record<CardAbility, number> = { extraTurn: 8, stealToken: 4, gainPrivilege: 3, takeToken: 3, copyBonus: 3 };
  if (card.ability) v += abilityBonus[card.ability];
  if (expert && card.color) v += colorPoints(p)[card.color] * card.points * 1.5;
  if (expert && card.crowns > 0) {
    const crowns = crownsOf(p);
    const next = ROYAL_CROWN_THRESHOLDS[p.royals.length];
    if (next !== undefined && crowns < next && crowns + card.crowns >= next) v += 12;
  }
  return v;
}

function scoreMove(state: SplendorDuelState, seat: Seat, move: EngineAction, level: BotLevel): number {
  const expert = botTier(level) === "expert";
  const p = state.players[seat];
  switch (move.type) {
    case "buyCard": {
      const after = applyAction(state, move);
      if (after.winner === seat) return 10_000;
      const card = move.source === "reserved" ? p.reserved.find((c) => c.id === move.cardId) : ([1, 2, 3] as Level[]).flatMap((l) => state.market[l]).find((c) => c?.id === move.cardId);
      return card ? 20 + cardValue(card, seat, state, expert) : -Infinity;
    }
    case "takeTokens": {
      let v = move.cells.reduce((s, i) => s + tokenUtility(state, seat, state.grid[i]!), 0) + move.cells.length * 1.5;
      if (selectionGivesPrivilege(move.cells, state.grid)) v -= expert ? 6 : 3;
      const overflow = tokenTotal(p.tokens) + move.cells.length - TOKEN_LIMIT;
      if (overflow > 0) v -= overflow * 3;
      return v;
    }
    case "reserveCard": {
      const card = move.marketIndex !== undefined ? state.market[move.level][move.marketIndex] : null;
      const gold = state.goldSupply > 0 ? 5 : 0;
      return 2 + gold + (card ? cardValue(card, seat, state, expert) * 0.25 : 2) - p.reserved.length * 2;
    }
    case "useScroll":
      return tokenUtility(state, seat, state.grid[move.cell]!) + 2;
    case "refillBoard":
      return 1;
    case "resolveCopy":
      return colorPoints(p)[move.color] * 2 + bonusCounts(p)[move.color];
    case "resolveTakeToken":
      return 0;
    case "resolveSteal":
      return tokenUtility(state, seat, move.color);
    case "chooseRoyal": {
      const r = state.royals.find((x) => x.id === move.royalId);
      return r ? r.points * 3 + (r.ability === "extraTurn" ? 4 : r.ability ? 2 : 0) : 0;
    }
    case "discardTokens":
      return -(Object.entries(move.discard) as [TokenColor, number][]).reduce((s, [c, n]) => s + tokenUtility(state, seat, c) * n, 0);
    case "pass":
      return 0;
    default:
      return -Infinity;
  }
}

/** Local-UX bot choice (Math.random by default) — the chosen action still replays through the deterministic reducer. */
export function chooseBotAction(state: SplendorDuelState, seat: Seat, level: BotLevel = 5, rng: () => number = Math.random): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  return pickByLevel(
    moves.map((move) => ({ move, score: scoreMove(state, seat, move, level) })),
    level,
    rng,
  );
}
