/**
 * 마법 상점 AI (Lv.1~10). One small step per call, like a person tapping:
 *
 *   pending 폐기 → choose what to trash (🕸️ first, then starter cards early)
 *   → play draw cards first, 🪞 right after the best card, the rest at once
 *   → fill the best set of orders → buy the best-valued cards while 🪙 lasts
 *   → (Lv.6+) 🔄 send away an order my deck can't make → end, keeping the
 *   rarest elements in the 🧪.
 *
 * Card value = what it adds to an average hand of MY deck right now: 🪙 (worth
 * less as the game nears its end), elements weighted by how much the visible
 * orders want them and how few my deck makes, draws (× my deck's average card),
 * trashing (early only), 🪧 명성 per expected future play, 🐈‍⬛ curses. A
 * card is bought only if it beats my deck's average card (it dilutes otherwise).
 * Weak levels see generic demand instead of the actual orders and go through
 * `pickByLevel`'s mistake / tie noise.
 */
import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { CARDS, cardDef, ELEMENTS, isChoiceCard, orderDef, STAR, SUPPLY_IDS, WEB } from "./cards";
import { allCards, autoStore, bestFulfilSet, canPay, isLegal, REROLL_COST, simpleHandIdxs, type EngineAction, type MagicState, type SeatIndex } from "./engine";

const STARTERS = new Set(["coin", "herb", "ember", "dew"].map((id) => CARDS.findIndex((c) => c.id === id)));
const COIN = CARDS.findIndex((c) => c.id === "coin");

interface Ctx {
  state: MagicState;
  seat: SeatIndex;
  level: BotLevel;
  deck: number[];
  /** 0 … 1: how close the leader is to the goal. */
  stage: number;
  elValue: number[];
  goldValue: number;
  avg: number;
  turnsLeft: number;
}

function elementDemand(state: MagicState, smart: boolean): number[] {
  if (!smart) return [1, 1, 1, 1.6];
  const want = [0.6, 0.6, 0.6, 0.9];
  for (const o of state.orders) {
    if (o === null) continue;
    const od = orderDef(o);
    od.need.forEach((v, i) => (want[i] += (v * od.fame) / 6));
  }
  const sum = want.reduce((a, b) => a + b, 0);
  return want.map((w) => (w / sum) * 4);
}

function makeCtx(state: MagicState, seat: SeatIndex, level: BotLevel): Ctx {
  const me = state.players[seat];
  const deck = allCards(me);
  const lead = Math.max(...state.players.map((p) => p.fame));
  const stage = Math.min(1, lead / state.goal);
  const smart = level >= 5;
  const demand = elementDemand(state, smart);
  // expected element per hand my deck makes
  const make = [0, 0, 0, 0];
  let gold = 0;
  for (const c of deck) {
    const d = cardDef(c);
    d.els.forEach((v, i) => (make[i] += v));
    gold += d.gold;
  }
  const perHand = (x: number) => (x / Math.max(1, deck.length)) * 5;
  const elValue = demand.map((dm, i) => {
    const base = i === STAR ? 1.9 : 1;
    const scarcity = smart ? 1.6 / (1 + perHand(make[i])) : 1;
    return base * dm * (0.55 + scarcity * 0.6);
  });
  const goldPerHand = perHand(gold);
  const goldValue = (1 - stage * 0.55) * (goldPerHand < 4 ? 1.15 : 0.85);
  const famePerTurn = Math.max(1.2, me.fame / Math.max(1, state.round));
  const turnsLeft = Math.max(1, Math.ceil((state.goal - lead) / famePerTurn));
  const ctx: Ctx = { state, seat, level, deck, stage, elValue, goldValue, avg: 0, turnsLeft };
  ctx.avg = deck.reduce((a, c) => a + baseValue(ctx, c), 0) / Math.max(1, deck.length);
  return ctx;
}

/** Value without draws (used for the deck average, so draw value can lean on it). */
function baseValue(ctx: Ctx, id: number): number {
  const d = cardDef(id);
  if (id === WEB) return 0;
  let v = d.gold * ctx.goldValue;
  for (let i = 0; i < ELEMENTS; i++) v += d.els[i] * ctx.elValue[i];
  if (d.fame) v += d.fame * 1.6 * Math.min(1, 0.35 + ctx.stage);
  if (d.curse) v += 0.35 * (ctx.state.playerCount - 1) * (1 - ctx.stage) * (ctx.state.webs > 0 ? 1 : 0);
  return v;
}

function cardValue(ctx: Ctx, id: number): number {
  const d = cardDef(id);
  let v = baseValue(ctx, id);
  if (d.draw) v += d.draw * ctx.avg * 0.95;
  if (d.mirror) v += ctx.avg * 1.5;
  if (d.trash) {
    const junk = ctx.deck.filter((c) => c === WEB || (STARTERS.has(c) && ctx.stage < 0.5)).length;
    v += Math.min(d.trash, junk / 3) * (ctx.stage < 0.4 ? 0.9 : 0.25);
  }
  return v;
}

/** How much buying `id` improves my deck — negative = it would dilute. */
function buyScore(ctx: Ctx, id: number): number {
  const v = cardValue(ctx, id);
  const n = ctx.deck.length;
  // the card shows up about (turnsLeft × 5 / n) more times
  const plays = Math.min(4, (ctx.turnsLeft * 5) / (n + 1));
  const gain = (v - ctx.avg) * plays;
  // a famous card: its 명성 lands even if drawn once in the final turns
  const fameKick = cardDef(id).fame ? cardDef(id).fame * Math.min(plays, ctx.turnsLeft / 2) * 0.5 : 0;
  return gain + fameKick;
}

function trashChoice(ctx: Ctx, max: number, rng: () => number): number[] {
  const hand = ctx.state.players[ctx.seat].hand;
  const scored = hand.map((c, i) => {
    let s = -9;
    if (c === WEB) s = 10;
    else if (ctx.level >= 3 && STARTERS.has(c) && ctx.stage < 0.45) {
      const goldLeft = ctx.deck.reduce((a, x) => a + cardDef(x).gold, 0) - (c === COIN ? 1 : 0);
      s = c === COIN ? (goldLeft >= 6 ? 2 : -1) : 1.5;
    }
    if (ctx.level <= 2 && rng() < 0.4) s = rng() * 4 - 2;
    return { i, s };
  });
  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.i);
}

/** `bias` (balance tests only): extra buy score per card id, e.g. { stardust: -99 } to test a strategy. */
export function chooseBotAction(state: MagicState, seat: SeatIndex, level: BotLevel, rng: () => number = Math.random, bias?: Record<string, number>): EngineAction | null {
  if (state.phase !== "playing" || state.active !== seat) return null;
  const turn = state.turn;
  const ctx = makeCtx(state, seat, level);
  const me = state.players[seat];

  if (state.pending) return { type: "trash", seat, turn, idxs: trashChoice(ctx, state.pending.max, rng) };

  // ── 1. play ──
  const hand = me.hand;
  if (hand.length) {
    const playable = hand.map((c, i) => ({ c, i })).filter(({ c }) => c !== WEB);
    const drawer = playable.find(({ c }) => cardDef(c).draw > 0 && !isChoiceCard(c));
    const mirror = playable.find(({ c }) => cardDef(c).mirror);
    if (mirror && state.lastPlayed !== null && cardValue(ctx, state.lastPlayed) >= ctx.avg * 1.3) return { type: "play", seat, turn, idx: mirror.i, card: mirror.c };
    if (drawer) return { type: "play", seat, turn, idx: drawer.i, card: drawer.c };
    const trasher = playable.find(({ c }) => cardDef(c).trash > 0);
    const hasJunk = hand.some((c) => c === WEB || (STARTERS.has(c) && ctx.stage < 0.45));
    if (trasher && hasJunk && level >= 2) return { type: "play", seat, turn, idx: trasher.i, card: trasher.c };
    if (simpleHandIdxs(hand).length) {
      // play the best simple card first when a mirror waits for it
      if (mirror) {
        const best = playable.filter(({ c }) => !isChoiceCard(c)).sort((a, b) => cardValue(ctx, b.c) - cardValue(ctx, a.c))[0];
        if (best) return { type: "play", seat, turn, idx: best.i, card: best.c };
      }
      return { type: "playAll", seat, turn };
    }
    if (mirror && state.lastPlayed !== null) return { type: "play", seat, turn, idx: mirror.i, card: mirror.c };
    if (trasher) return { type: "play", seat, turn, idx: trasher.i, card: trasher.c };
  }

  // ── 2. orders ──
  const set = bestFulfilSet(state.pool, state.orders);
  if (set.length && (level >= 2 || rng() < 0.8)) return { type: "fulfil", seat, turn, slot: set[0], order: state.orders[set[0]]! };

  // ── 3. buy ──
  const options: { move: EngineAction | null; score: number }[] = [{ move: null, score: 0.15 }];
  state.shop.forEach((id, slot) => {
    if (id !== null && CARDS[id].cost <= state.pool.gold) options.push({ move: { type: "buy", seat, turn, src: "shop", slot, card: id }, score: buyScore(ctx, id) + (bias?.[CARDS[id].id] ?? 0) });
  });
  for (const id of SUPPLY_IDS) {
    if (CARDS[id].cost <= state.pool.gold) options.push({ move: { type: "buy", seat, turn, src: "supply", slot: id, card: id }, score: buyScore(ctx, id) + (bias?.[CARDS[id].id] ?? 0) });
  }
  if (options.length > 1) {
    const pick = pickByLevel(options, level, rng);
    if (pick) return pick;
  }

  // ── 4. 🔄 send away an order nobody near me can make ──
  if (level >= 6 && !state.rerolled && state.pool.gold >= REROLL_COST && state.orderDeck.length > 0) {
    const make = [0, 0, 0, 0];
    for (const c of ctx.deck) cardDef(c).els.forEach((v, i) => (make[i] += v));
    let worst = -1;
    let worstScore = Infinity;
    state.orders.forEach((o, slot) => {
      if (o === null) return;
      const od = orderDef(o);
      const pool = { gold: 0, els: make.map((m) => (m / ctx.deck.length) * 6 + 0.5) };
      const ok = canPay(pool, od.need) ? 1 : 0;
      const score = ok * od.fame + od.fame * 0.2;
      if (score < worstScore) {
        worstScore = score;
        worst = slot;
      }
    });
    if (worst >= 0 && worstScore < 2) {
      const a: EngineAction = { type: "reroll", seat, turn, slot: worst, order: state.orders[worst]! };
      if (isLegal(state, a)) return a;
    }
  }

  // ── 5. end ──
  return { type: "end", seat, turn, store: autoStore(state, seat) };
}
