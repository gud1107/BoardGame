/**
 * 🧙 마법 상점 (Magic Shop) — an original 2~4 player deckbuilder.
 * Full rules + design/tuning notes: boardGameRule/마법상점/마법상점.md (§ numbers below).
 *
 * §2 Everyone starts with 10 cards (🪙 동전 ×6, 🌿🌿🔥💧) and draws 5.
 * §3 On your turn play cards from your hand in any order for 🪙 and elements
 *    (🔥💧🌿✨), draws, trashing, curses. Spend 🪙 on 🛒 shop shelf (5 random
 *    face-up) or 🏪 counter cards (always there) — bought cards go to your
 *    discard pile. Spend elements on 📜 customer orders for 명성 + a bonus.
 *    Once a turn 🪙1 sends one order away (🔄). Any order, any number.
 * §4 End: up to 🧪 flask-size leftover elements are kept for next turn, the
 *    rest fade; hand + played cards go to the discard pile; draw 5.
 * §5 When someone has the goal 명성 at the end of their turn (or the orders
 *    run out) the round is finished so everyone has had the same number of
 *    turns. 🕸️ 거미줄 −1 each. Ties: more orders, then fewer cards.
 *
 * Lockstep like every other online room (docs/cloud-sync.md): every client
 * replays the same actions from the same seed. The shuffle RNG lives in the
 * state (`rng`) so reshuffles mid-game stay identical everywhere. Actions
 * carry `turn` so a stale one from a previous turn (two timers) is ignored.
 */
import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { CARDS, cardDef, ELEMENTS, isChoiceCard, orderDef, ORDERS, SHOP_IDS, STAR, STARTER, SUPPLY_IDS, WEB, type Els } from "./cards";

export type SeatIndex = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const HAND_SIZE = 5;
export const SHOP_SLOTS = 5;
export const ORDER_SLOTS = 3;
export const START_FLASK = 1;
export const MAX_FLASK = 3;
export const REROLL_COST = 1;
/** Rounds a customer waits before leaving (§3.4). */
export const PATIENCE = 4;
export const TURN_MS = 90_000;
export const MAX_ROUNDS = 30;
/** 명성 that triggers the last round, by player count (§5, self-play tuned). */
export const FAME_GOAL: Record<number, number> = { 2: 25, 3: 22, 4: 20 };
/** 🕸️ 거미줄 in the supply by player count. */
export const WEB_SUPPLY: Record<number, number> = { 2: 6, 3: 10, 4: 12 };
export const WEB_PENALTY = 1;
/** First-turn elements in each later seat's 🧪 by player count (§2, self-play tuned). */
export const SEAT_HEADSTART: Record<number, number[][]> = {
  2: [[0, 0, 0, 0], [1, 0, 1, 0]],
  3: [[0, 0, 0, 0], [1, 0, 1, 0], [1, 1, 1, 0]],
  4: [[0, 0, 0, 0], [0, 0, 1, 0], [1, 0, 1, 0], [1, 1, 1, 0]],
};

export interface Pool {
  gold: number;
  els: number[];
}

export interface PlayerState {
  /** Draw pile — the top card is the LAST element. */
  deck: number[];
  hand: number[];
  discard: number[];
  played: number[];
  fame: number;
  /** Fulfilled order ids, in order. */
  orders: number[];
  /** 🧪 flask size (elements kept between turns). */
  flask: number;
  /** Elements carried into this player's next turn. */
  stored: number[];
  /** Cards removed from the game. */
  trashed: number;
}

export type LogKind = "play" | "buy" | "fulfil" | "trash" | "reroll" | "curse" | "end" | "timeout" | "reshuffle" | "leave";

export interface LogEntry {
  seq: number;
  seat: SeatIndex;
  kind: LogKind;
  /** card id (play/buy/curse/trash) */
  card?: number;
  /** order id (fulfil/reroll) */
  order?: number;
  /** count: trashed cards, kept elements, fame gained, … */
  n?: number;
  /** curse victims */
  victims?: SeatIndex[];
}

export interface FinalRow {
  seat: SeatIndex;
  fame: number;
  webs: number;
  total: number;
  orders: number;
  cards: number;
}

export type Phase = "playing" | "gameOver";

export interface Pending {
  kind: "trash";
  max: number;
  card: number;
}

export interface MagicState {
  playerCount: number;
  seed: number;
  rng: number;
  phase: Phase;
  players: PlayerState[];
  shop: (number | null)[];
  shopDeck: number[];
  orders: (number | null)[];
  orderDeck: number[];
  /** Rounds each order has been waiting (§3.4 — it leaves at PATIENCE). */
  orderAge: number[];
  webs: number;
  goal: number;
  active: SeatIndex;
  turn: number;
  round: number;
  pool: Pool;
  rerolled: boolean;
  pending: Pending | null;
  /** Card whose effect 🪞 거울 마법 repeats (the last non-mirror card played this turn). */
  lastPlayed: number | null;
  finalRound: boolean;
  seq: number;
  log: LogEntry[];
  final: FinalRow[] | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "play"; seat: SeatIndex; turn: number; idx: number; card: number }
  | { type: "playAll"; seat: SeatIndex; turn: number }
  | { type: "trash"; seat: SeatIndex; turn: number; idxs: number[] }
  | { type: "buy"; seat: SeatIndex; turn: number; src: "shop" | "supply"; slot: number; card: number }
  | { type: "fulfil"; seat: SeatIndex; turn: number; slot: number; order: number }
  | { type: "reroll"; seat: SeatIndex; turn: number; slot: number; order: number }
  | { type: "end"; seat: SeatIndex; turn: number; store: number[] }
  | { type: "timeout"; seat: SeatIndex; turn: number };

export function isStateSyncStale(current: MagicState | null, synced: MagicState): boolean {
  if (!current) return false;
  if (synced.seed !== current.seed) return false;
  return synced.seq < current.seq;
}

// ---------------------------------------------------------------------------
// RNG kept in state (mulberry32 step, same as lib/rng)
// ---------------------------------------------------------------------------

function rand(s: MagicState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffleInPlace(s: MagicState, arr: number[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

const clone = (s: MagicState): MagicState => structuredClone(s);

function log(s: MagicState, e: Omit<LogEntry, "seq">) {
  s.seq++;
  s.log.push({ seq: s.seq, ...e });
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

function tally(s: MagicState, seat: SeatIndex, key: string, by = 1) {
  s.statTally = tallyAdd(s.statTally, seat, key, by);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function drawCards(s: MagicState, seat: SeatIndex, n: number): number {
  const p = s.players[seat];
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      p.deck = p.discard;
      p.discard = [];
      shuffleInPlace(s, p.deck);
      if (s.phase === "playing" && s.turn > 0) log(s, { seat, kind: "reshuffle", n: p.deck.length });
    }
    p.hand.push(p.deck.pop()!);
    got++;
  }
  return got;
}

export function startGame(playerCount: number, seed: number): MagicState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const r = seededRng(seed);
  const shopDeck = shuffle(
    SHOP_IDS.flatMap((id) => Array(CARDS[id].copies).fill(id) as number[]),
    r,
  );
  const orderDeck = shuffle(
    ORDERS.map((x) => x.id),
    r,
  );
  // the 15-fame royal order never opens the game: keep it in the bottom half
  const royal = orderDeck.indexOf(ORDERS.length - 1);
  if (royal > orderDeck.length / 2) {
    const j = Math.floor(r() * (orderDeck.length / 2));
    [orderDeck[royal], orderDeck[j]] = [orderDeck[j], orderDeck[royal]];
  }
  const s: MagicState = {
    playerCount: n,
    seed,
    rng: Math.floor(r() * 4294967296) | 0,
    phase: "playing",
    players: Array.from({ length: n }, () => ({
      deck: [...STARTER],
      hand: [],
      discard: [],
      played: [],
      fame: 0,
      orders: [],
      flask: START_FLASK,
      stored: [0, 0, 0, 0],
      trashed: 0,
    })),
    shop: [],
    shopDeck,
    orders: [],
    orderDeck,
    orderAge: [0, 0, 0],
    webs: WEB_SUPPLY[n],
    goal: FAME_GOAL[n],
    active: 0,
    turn: 0,
    round: 1,
    pool: { gold: 0, els: [0, 0, 0, 0] },
    rerolled: false,
    pending: null,
    lastPlayed: null,
    finalRound: false,
    seq: 0,
    log: [],
    final: null,
  };
  for (let i = 0; i < SHOP_SLOTS; i++) s.shop.push(s.shopDeck.pop() ?? null);
  for (let i = 0; i < ORDER_SLOTS; i++) s.orders.push(s.orderDeck.pop() ?? null);
  for (let seat = 0; seat < n; seat++) {
    shuffleInPlace(s, s.players[seat].deck);
    drawCards(s, seat, HAND_SIZE);
  }
  // §2 later seats are compensated for playing after the leader: their 🧪
  // starts with elements for the first turn (self-play tuned, rulebook §8).
  const comp = SEAT_HEADSTART[n] ?? [];
  for (let seat = 1; seat < n; seat++) s.players[seat].stored = [...(comp[seat] ?? [0, 0, 0, 0])];
  s.turn = 1;
  return s;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function currentActor(state: MagicState): SeatIndex | null {
  return state.phase === "playing" ? state.active : null;
}

export const canPay = (pool: Pool, need: Els | readonly number[]) => need.every((v, i) => pool.els[i] >= v);

export function costOf(src: "shop" | "supply", state: MagicState, slot: number): number | null {
  const id = src === "shop" ? state.shop[slot] : SUPPLY_IDS.includes(slot) ? slot : null;
  return id === null || id === undefined ? null : CARDS[id].cost;
}

export const allCards = (p: PlayerState) => [...p.deck, ...p.hand, ...p.discard, ...p.played];
export const websOf = (p: PlayerState) => allCards(p).filter((c) => c === WEB).length;

// ---------------------------------------------------------------------------
// Card effects
// ---------------------------------------------------------------------------

function resolveEffect(s: MagicState, seat: SeatIndex, id: number) {
  const c = cardDef(id);
  s.pool.gold += c.gold;
  for (let i = 0; i < ELEMENTS; i++) s.pool.els[i] += c.els[i];
  if (c.fame) {
    s.players[seat].fame += c.fame;
    tally(s, seat, "signFame", c.fame);
  }
  if (c.draw) drawCards(s, seat, c.draw);
  if (c.curse) {
    const victims: SeatIndex[] = [];
    for (let k = 1; k < s.playerCount; k++) {
      const v = (seat + k) % s.playerCount;
      if (s.webs <= 0) break;
      s.webs--;
      s.players[v].discard.push(WEB);
      victims.push(v);
    }
    if (victims.length) {
      log(s, { seat, kind: "curse", card: id, victims });
      tally(s, seat, "websSent", victims.length);
    }
  }
  if (c.trash && s.players[seat].hand.length > 0) s.pending = { kind: "trash", max: c.trash, card: id };
}

function playCard(s: MagicState, seat: SeatIndex, idx: number) {
  const p = s.players[seat];
  const id = p.hand[idx];
  p.hand.splice(idx, 1);
  p.played.push(id);
  log(s, { seat, kind: "play", card: id });
  tally(s, seat, "played");
  if (cardDef(id).mirror) {
    if (s.lastPlayed !== null) resolveEffect(s, seat, s.lastPlayed);
    return;
  }
  s.lastPlayed = id;
  resolveEffect(s, seat, id);
}

/** Hand indices that "모두 내기" plays: every card without a choice / order dependency. */
export function simpleHandIdxs(hand: readonly number[]): number[] {
  return hand.map((c, i) => (isChoiceCard(c) || c === WEB ? -1 : i)).filter((i) => i >= 0);
}

function playAllSimple(s: MagicState, seat: SeatIndex) {
  // draws can pull more simple cards — keep going until none is left
  for (let guard = 0; guard < 60; guard++) {
    if (s.pending) return;
    const p = s.players[seat];
    const idx = p.hand.findIndex((c) => !isChoiceCard(c) && c !== WEB);
    if (idx < 0) return;
    playCard(s, seat, idx);
  }
}

function refillOrder(s: MagicState, slot: number) {
  s.orders[slot] = s.orderDeck.pop() ?? null;
  s.orderAge[slot] = 0;
}

function fulfil(s: MagicState, seat: SeatIndex, slot: number) {
  const id = s.orders[slot]!;
  const od = orderDef(id);
  for (let i = 0; i < ELEMENTS; i++) s.pool.els[i] -= od.need[i];
  const p = s.players[seat];
  p.fame += od.fame;
  p.orders.push(id);
  refillOrder(s, slot);
  log(s, { seat, kind: "fulfil", order: id, n: od.fame });
  tally(s, seat, "orders");
  tally(s, seat, "orderFame", od.fame);
  s.statTally = tallyMax(s.statTally, seat, "maxOrderFame", od.fame);
  if (od.need[STAR] >= 2) tally(s, seat, "starOrders");
  switch (od.bonus) {
    case "gold2":
      s.pool.gold += 2;
      break;
    case "draw1":
      drawCards(s, seat, 1);
      break;
    case "flask":
      p.flask = Math.min(MAX_FLASK, p.flask + 1);
      break;
    case "clean": {
      for (const pile of [p.hand, p.discard, p.deck]) {
        const i = pile.indexOf(WEB);
        if (i >= 0) {
          pile.splice(i, 1);
          p.trashed++;
          tally(s, seat, "websCleaned");
          break;
        }
      }
      break;
    }
  }
}

/** Default 🧪 choice: the rarest / most wanted elements first. */
export function autoStore(state: MagicState, seat: SeatIndex): number[] {
  const cap = state.players[seat].flask;
  const left = [...state.pool.els];
  const want = [0, 0, 0, 0];
  for (const o of state.orders) if (o !== null) orderDef(o).need.forEach((v, i) => (want[i] += v));
  const order = [STAR, 0, 1, 2].sort((a, b) => (a === STAR ? -1 : b === STAR ? 1 : want[b] - want[a]));
  const store = [0, 0, 0, 0];
  let room = cap;
  for (const e of order) {
    const k = Math.min(room, left[e]);
    store[e] += k;
    room -= k;
  }
  return store;
}

function endTurn(s: MagicState, seat: SeatIndex, store: readonly number[], timeout: boolean) {
  const p = s.players[seat];
  const kept = store.reduce((a, b) => a + b, 0);
  p.stored = [...store];
  if (kept) tally(s, seat, "kept", kept);
  log(s, { seat, kind: timeout ? "timeout" : "end", n: kept });
  p.discard.push(...p.hand, ...p.played);
  p.hand = [];
  p.played = [];
  drawCards(s, seat, HAND_SIZE);
  s.statTally = tallyMax(s.statTally, seat, "maxFame", p.fame);
  s.statTally = tallyMax(s.statTally, seat, "maxDeck", allCards(p).length);
  if (p.fame >= s.goal) s.finalRound = true;
  if (s.orders.every((o) => o === null)) s.finalRound = true;
  const next = (seat + 1) % s.playerCount;
  if (next === 0 && (s.finalRound || s.round >= MAX_ROUNDS)) {
    finish(s);
    return;
  }
  if (next === 0) {
    s.round++;
    // §3.4 customers wait PATIENCE rounds, then leave for the bottom of the deck
    s.orderAge = s.orderAge.map((a, slot) => (s.orders[slot] === null ? 0 : a + 1));
    s.orderAge.forEach((age, slot) => {
      const id = s.orders[slot];
      if (id === null || age < PATIENCE || s.orderDeck.length === 0) return;
      s.orderDeck.unshift(id);
      refillOrder(s, slot);
      log(s, { seat: -1, kind: "leave", order: id });
    });
  }
  s.active = next;
  s.turn++;
  s.rerolled = false;
  s.pending = null;
  s.lastPlayed = null;
  const np = s.players[next];
  s.pool = { gold: 0, els: [...np.stored] };
  np.stored = [0, 0, 0, 0];
}

function finish(s: MagicState) {
  s.phase = "gameOver";
  s.final = s.players.map((p, seat) => {
    const webs = websOf(p);
    return { seat, fame: p.fame, webs, total: p.fame - webs * WEB_PENALTY, orders: p.orders.length, cards: allCards(p).length };
  });
  const ranks = computeRankings(s);
  for (const r of ranks) {
    const row = s.final[r.seat];
    s.statTally = tallyMax(s.statTally, r.seat, "maxScore", row.total);
  }
}

/** Timeout / AFK turn: play every simple card, trash only 🕸️, fill the best orders, keep the default 🧪. No buying. */
function autoTurn(s: MagicState, seat: SeatIndex) {
  for (let guard = 0; guard < 40; guard++) {
    if (s.pending) {
      const hand = s.players[seat].hand;
      const idxs = hand.map((c, i) => (c === WEB ? i : -1)).filter((i) => i >= 0).slice(0, s.pending.max);
      doTrash(s, seat, idxs);
      continue;
    }
    playAllSimple(s, seat);
    if (s.pending) continue;
    const hand = s.players[seat].hand;
    const idx = hand.findIndex((c) => c !== WEB && cardDef(c).trash > 0 && hand.includes(WEB));
    const m = idx >= 0 ? idx : hand.findIndex((c) => cardDef(c).mirror && s.lastPlayed !== null);
    if (m < 0) break;
    playCard(s, seat, m);
  }
  for (const slot of bestFulfilSet(s.pool, s.orders)) fulfil(s, seat, slot);
  endTurn(s, seat, autoStore(s, seat), true);
}

function doTrash(s: MagicState, seat: SeatIndex, idxs: readonly number[]) {
  const p = s.players[seat];
  const sorted = [...new Set(idxs)].filter((i) => i >= 0 && i < p.hand.length).sort((a, b) => b - a).slice(0, s.pending?.max ?? 0);
  const removed: number[] = [];
  for (const i of sorted) removed.push(...p.hand.splice(i, 1));
  p.trashed += removed.length;
  for (const c of removed) log(s, { seat, kind: "trash", card: c });
  tally(s, seat, "trashed", removed.length);
  s.pending = null;
}

/**
 * Orders (slot indices) to fill with this pool for the most 명성 — tiny
 * exhaustive search (3 slots → 8 subsets). Used by timeouts, the bot and the
 * board's "가능" hint.
 */
export function bestFulfilSet(pool: Pool, orders: readonly (number | null)[]): number[] {
  let best: number[] = [];
  let bestFame = 0;
  const slots = orders.map((o, i) => (o === null ? -1 : i)).filter((i) => i >= 0);
  for (let mask = 1; mask < 1 << slots.length; mask++) {
    const need = [0, 0, 0, 0];
    let fame = 0;
    const pick: number[] = [];
    slots.forEach((slot, k) => {
      if (!(mask & (1 << k))) return;
      const od = orderDef(orders[slot]!);
      od.need.forEach((v, i) => (need[i] += v));
      fame += od.fame;
      pick.push(slot);
    });
    if (fame > bestFame && canPay(pool, need)) {
      best = pick;
      bestFame = fame;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function isLegal(state: MagicState, a: EngineAction): boolean {
  if (state.phase !== "playing" || a.seat !== state.active || a.turn !== state.turn) return false;
  const p = state.players[a.seat];
  if (a.type === "timeout") return true;
  if (state.pending) return a.type === "trash";
  switch (a.type) {
    case "trash":
      return false;
    case "play":
      // `card` guards a double tap: the second tap would otherwise play whatever slid into that index
      return Number.isInteger(a.idx) && a.idx >= 0 && a.idx < p.hand.length && p.hand[a.idx] === a.card;
    case "playAll":
      return simpleHandIdxs(p.hand).length > 0;
    case "buy": {
      const cost = costOf(a.src, state, a.slot);
      const id = a.src === "shop" ? state.shop[a.slot] : a.slot;
      return cost !== null && id === a.card && state.pool.gold >= cost;
    }
    case "fulfil": {
      const id = state.orders[a.slot];
      return id !== null && id !== undefined && id === a.order && canPay(state.pool, orderDef(id).need);
    }
    case "reroll":
      return !state.rerolled && state.pool.gold >= REROLL_COST && state.orders[a.slot] === a.order && a.order !== null && state.orderDeck.length > 0;
    case "end": {
      if (!Array.isArray(a.store) || a.store.length !== ELEMENTS) return false;
      if (a.store.some((v, i) => !Number.isInteger(v) || v < 0 || v > state.pool.els[i])) return false;
      return a.store.reduce((x, y) => x + y, 0) <= p.flask;
    }
  }
  return false;
}

export function applyAction(state: MagicState, action: EngineAction): MagicState {
  if (!isLegal(state, action)) return state;
  const s = clone(state);
  const seat = action.seat;
  switch (action.type) {
    case "play":
      playCard(s, seat, action.idx);
      break;
    case "playAll":
      playAllSimple(s, seat);
      break;
    case "trash":
      doTrash(s, seat, action.idxs);
      break;
    case "buy": {
      const id = action.src === "shop" ? s.shop[action.slot]! : action.slot;
      s.pool.gold -= CARDS[id].cost;
      s.players[seat].discard.push(id);
      if (action.src === "shop") s.shop[action.slot] = s.shopDeck.pop() ?? null;
      log(s, { seat, kind: "buy", card: id });
      tally(s, seat, "bought");
      break;
    }
    case "fulfil":
      fulfil(s, seat, action.slot);
      break;
    case "reroll": {
      const old = s.orders[action.slot]!;
      s.pool.gold -= REROLL_COST;
      s.rerolled = true;
      // the old order goes to the bottom of the order deck
      s.orderDeck.unshift(old);
      refillOrder(s, action.slot);
      log(s, { seat, kind: "reroll", order: old });
      break;
    }
    case "end":
      endTurn(s, seat, action.store, false);
      break;
    case "timeout":
      if (s.pending) s.pending = null;
      autoTurn(s, seat);
      break;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  total: number;
}

export function finalRows(state: MagicState): FinalRow[] {
  return (
    state.final ??
    state.players.map((p, seat) => {
      const webs = websOf(p);
      return { seat, fame: p.fame, webs, total: p.fame - webs * WEB_PENALTY, orders: p.orders.length, cards: allCards(p).length };
    })
  );
}

/** Higher total; ties → more orders, then fewer cards; still tied = shared rank. */
export function computeRankings(state: MagicState): RankedSeat[] {
  const rows = finalRows(state);
  const key = (r: FinalRow) => [r.total, r.orders, -r.cards];
  const cmp = (a: FinalRow, b: FinalRow) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...rows].sort((a, b) => cmp(a, b) || a.seat - b.seat);
  return sorted.map((r) => ({ seat: r.seat, total: r.total, rank: sorted.findIndex((x) => cmp(x, r) === 0) + 1 }));
}
