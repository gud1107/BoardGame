import { clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  analyzeMeld,
  checkCommit,
  isValidMeld,
  isWild,
  MAX_NUM,
  OPENING_MIN,
  penaltyOf,
  tileOf,
  type EngineAction,
  type SeatIndex,
  type StarRummyState,
  type TileId,
} from "./engine";

/**
 * 별빛 러미 bots. The core is `solve`: a node-bounded backtracking search that
 * lays out melds from a pool of tiles where some MUST be placed (the current
 * table) and the rest MAY be (my hand), maximising what leaves my hand.
 *
 *  - Lv.1~3: hand-only melds, sometimes misses lay-offs, sometimes just draws.
 *  - Lv.4~7: hand-only melds + laying single tiles onto table melds (+ a small
 *    full re-solve from Lv.6).
 *  - Lv.8~10: full table re-solve (rearranging everything) with a bigger budget,
 *    compared against the lay-off plan.
 */

const key = (id: TileId) => {
  const t = tileOf(id);
  return (t.color ?? 0) * MAX_NUM + (t.num - 1);
};

interface Pools {
  /** Per key (0..47): tile ids that must be placed / may be placed. */
  must: TileId[][];
  may: TileId[][];
  mustWild: TileId[];
  mayWild: TileId[];
}

function makePools(must: readonly TileId[], may: readonly TileId[]): Pools {
  const p: Pools = { must: Array.from({ length: 48 }, () => []), may: Array.from({ length: 48 }, () => []), mustWild: [], mayWild: [] };
  for (const id of must) (isWild(id) ? p.mustWild : p.must[key(id)]).push(id);
  for (const id of may) (isWild(id) ? p.mayWild : p.may[key(id)]).push(id);
  return p;
}

type Slot = { k: number } | "wild";

/** Candidate melds (as slot lists) containing key `k`. */
function candidates(p: Pools, k: number, useMust: boolean): Slot[][] {
  const out: Slot[][] = [];
  const color = Math.floor(k / MAX_NUM);
  const num = (k % MAX_NUM) + 1;
  const wildsAvail = (useMust ? p.mustWild.length : 0) + p.mayWild.length;
  const has = (kk: number, need = 1) => (useMust ? p.must[kk].length : 0) + p.may[kk].length >= need;

  // groups: the other three colours each absent / real / wild
  const others = [0, 1, 2, 3].filter((c) => c !== color);
  for (let mask = 0; mask < 27; mask++) {
    const pick = [mask % 3, Math.floor(mask / 3) % 3, Math.floor(mask / 9) % 3];
    const slots: Slot[] = [{ k }];
    let wilds = 0;
    let ok = true;
    pick.forEach((choice, i) => {
      const kk = others[i] * MAX_NUM + (num - 1);
      if (choice === 1) {
        if (has(kk)) slots.push({ k: kk });
        else ok = false;
      } else if (choice === 2) {
        wilds++;
        slots.push("wild");
      }
    });
    if (!ok || slots.length < 3 || wilds > wildsAvail) continue;
    // a wild where a real tile sits unused is pointless — skip
    if (pick.some((choice, i) => choice === 2 && has(others[i] * MAX_NUM + (num - 1)))) continue;
    out.push(slots);
  }

  // runs of this colour that contain `num`
  for (let s = num; s >= 1; s--) {
    let wildBelow = 0;
    for (let n = s; n < num; n++) if (!has(color * MAX_NUM + n - 1)) wildBelow++;
    if (wildBelow > wildsAvail) break;
    for (let e = Math.max(num, s + 2); e <= MAX_NUM; e++) {
      let wilds = wildBelow;
      for (let n = num + 1; n <= e; n++) if (!has(color * MAX_NUM + n - 1)) wilds++;
      if (wilds > wildsAvail) break;
      const slots: Slot[] = [];
      for (let n = s; n <= e; n++) {
        const kk = color * MAX_NUM + n - 1;
        slots.push(n === num || has(kk) ? { k: kk } : "wild");
      }
      out.push(slots);
    }
  }
  const wildCount = (m: Slot[]) => m.filter((x) => x === "wild").length;
  return out.sort((a, b) => wildCount(a) - wildCount(b) || b.length - a.length);
}

type Scorer = (meld: TileId[], fromHand: TileId[]) => number;
const defaultScore: Scorer = (_meld, fromHand) => fromHand.reduce((s, id) => s + 10 + penaltyOf(id), 0);
export const openingScore: Scorer = (meld) => analyzeMeld(meld)?.value ?? 0;

export interface Solution {
  melds: TileId[][];
  /** Hand tiles used. */
  used: TileId[];
  score: number;
}

/**
 * Place every `must` tile and as many `may` tiles as pays, within `budget`
 * search nodes. Returns null when no full placement of `must` was found.
 */
export function solve(must: readonly TileId[], may: readonly TileId[], budget: number, score: Scorer = defaultScore): Solution | null {
  const p = makePools(must, may);
  const mayIds = new Set(may);
  let nodes = 0;
  let best: Solution | null = null;
  const melds: TileId[][] = [];

  const take = (slot: Slot, useMust: boolean): TileId => {
    if (slot === "wild") return useMust && p.mustWild.length ? p.mustWild.pop()! : p.mayWild.pop()!;
    return useMust && p.must[slot.k].length ? p.must[slot.k].pop()! : p.may[slot.k].pop()!;
  };
  const giveBack = (id: TileId) => {
    const list = isWild(id) ? (mayIds.has(id) ? p.mayWild : p.mustWild) : mayIds.has(id) ? p.may[key(id)] : p.must[key(id)];
    list.push(id);
  };

  /** Hang leftover wilds (`list`) onto melds that stay valid; false if any is left over. */
  function hangWilds(list: TileId[], all: TileId[][]): { placed: TileId[]; touched: Map<number, TileId[]> } {
    const placed: TileId[] = [];
    const touched = new Map<number, TileId[]>();
    for (const w of [...list]) {
      for (let i = 0; i < all.length; i++) {
        const cur = touched.get(i) ?? all[i];
        if (isValidMeld([...cur, w])) {
          touched.set(i, [...cur, w]);
          placed.push(w);
          break;
        }
      }
    }
    return { placed, touched };
  }

  function finish(total: number) {
    // leftover optional wilds: hang them anywhere they fit
    const { placed, touched } = hangWilds(p.mayWild, melds);
    const final = melds.map((m, i) => touched.get(i) ?? m);
    let s = total;
    for (const w of placed) s += defaultScore([], [w]);
    if (!best || s > best.score) {
      const used = final.flat().filter((id) => mayIds.has(id));
      best = { melds: final.map((m) => [...m]), used, score: s };
    }
  }

  function phase2(total: number) {
    if (++nodes > budget) return;
    let k = -1;
    for (let i = 0; i < 48; i++) if (p.may[i].length) {
      k = i;
      break;
    }
    if (k < 0) {
      finish(total);
      return;
    }
    for (const slots of candidates(p, k, false)) {
      const ids = slots.map((sl) => take(sl, false));
      melds.push(ids);
      phase2(total + score(ids, ids));
      melds.pop();
      ids.forEach(giveBack);
      if (nodes > budget) return;
    }
    // or leave this tile in hand
    const skipped = p.may[k].pop()!;
    phase2(total);
    p.may[k].push(skipped);
  }

  function phase1(total: number) {
    if (++nodes > budget) return;
    let k = -1;
    for (let i = 0; i < 48; i++) if (p.must[i].length) {
      k = i;
      break;
    }
    if (k < 0) {
      if (p.mustWild.length) {
        // table wilds must stay on the table
        const { placed, touched } = hangWilds(p.mustWild, melds);
        if (placed.length < p.mustWild.length) return;
        const saved = melds.map((m) => m);
        const savedWild = [...p.mustWild];
        touched.forEach((m, i) => (melds[i] = m));
        p.mustWild.length = 0;
        phase2(total);
        p.mustWild.push(...savedWild);
        saved.forEach((m, i) => (melds[i] = m));
        return;
      }
      phase2(total);
      return;
    }
    for (const slots of candidates(p, k, true)) {
      const ids = slots.map((sl) => take(sl, true));
      melds.push(ids);
      phase1(total + score(ids, ids.filter((id) => mayIds.has(id))));
      melds.pop();
      ids.forEach(giveBack);
      if (nodes > budget) return;
    }
  }

  phase1(0);
  return best;
}

/** Lay single hand tiles onto existing melds while any fits. Mutates nothing; returns the new table + used tiles. */
export function layOff(table: readonly TileId[][], hand: readonly TileId[], skipChance = 0, rng: () => number = Math.random): { table: TileId[][]; used: TileId[] } {
  const next = table.map((m) => [...m]);
  const left = [...hand];
  const used: TileId[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...left]) {
      for (const m of next) {
        if (isValidMeld([...m, id])) {
          if (skipChance > 0 && rng() < skipChance) break;
          m.push(id);
          used.push(id);
          left.splice(left.indexOf(id), 1);
          changed = true;
          break;
        }
      }
    }
  }
  return { table: next, used };
}

/** How well an observatory tile fits my hand (higher = keep it). */
export function fitScore(hand: readonly TileId[], id: TileId): number {
  if (isWild(id)) return 10;
  const t = tileOf(id);
  let s = 0;
  const seenColor = new Set<number>();
  for (const h of hand) {
    if (isWild(h)) continue;
    const o = tileOf(h);
    if (o.num === t.num && o.color !== t.color && !seenColor.has(o.color!)) {
      seenColor.add(o.color!);
      s += 1;
    }
    if (o.color === t.color) {
      const d = Math.abs(o.num - t.num);
      if (d === 1) s += 1.5;
      else if (d === 2) s += 0.75;
      else if (d === 0) s -= 0.5;
    }
  }
  return s;
}

const BUDGET: Record<number, { hand: number; full: number }> = {
  1: { hand: 200, full: 0 },
  2: { hand: 300, full: 0 },
  3: { hand: 500, full: 0 },
  4: { hand: 1200, full: 0 },
  5: { hand: 1800, full: 0 },
  6: { hand: 2500, full: 1500 },
  7: { hand: 3000, full: 3000 },
  8: { hand: 4000, full: 6000 },
  9: { hand: 5000, full: 12000 },
  10: { hand: 6000, full: 20000 },
};

/** The bot's turn: the best commit it can find, otherwise a draw. */
export function chooseBotAction(state: StarRummyState, seat: SeatIndex, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (state.phase !== "playing" || state.active !== seat) return null;
  const lv = clampBotLevel(level);
  const hand = state.hands[seat];
  const budget = BUDGET[lv];
  const turn = state.turn;
  const draw = (): EngineAction => ({ type: "draw", seat, turn, from: pickDraw(state, hand, lv, rng) });

  // Novices sometimes just draw even with a play available.
  const lazy = lv <= 3 ? [0.3, 0.2, 0.12][lv - 1] : 0;
  if (rng() < lazy) return draw();

  let plan: TileId[][] | null = null;

  if (!state.opened[seat]) {
    const sol = solve([], hand, budget.hand * 2, openingScore);
    if (sol && sol.score >= OPENING_MIN) plan = [...state.table.map((m) => [...m]), ...sol.melds];
  } else {
    // A: melds from the hand + lay-offs onto the table
    const own = solve([], hand, budget.hand);
    const ownMelds = own?.melds ?? [];
    const usedOwn = new Set(own?.used ?? []);
    const rest = hand.filter((id) => !usedOwn.has(id));
    const skip = lv <= 3 ? [0.6, 0.45, 0.3][lv - 1] : 0;
    const laid = layOff([...state.table, ...ownMelds], rest, skip, rng);
    const usedA = (own?.used.length ?? 0) + laid.used.length;
    const valueA = [...(own?.used ?? []), ...laid.used].reduce((s, id) => s + penaltyOf(id), 0);
    if (usedA > 0) plan = laid.table;
    let bestScore = usedA * 10 + valueA;

    // B: rearrange the whole table
    if (budget.full > 0) {
      const full = solve(state.table.flat(), hand, budget.full);
      if (full) {
        const laidB = layOff(full.melds, hand.filter((id) => !full.used.includes(id)));
        const usedB = [...full.used, ...laidB.used];
        const scoreB = usedB.reduce((s, id) => s + 10 + penaltyOf(id), 0);
        if (usedB.length > 0 && scoreB > bestScore) {
          plan = laidB.table;
          bestScore = scoreB;
        }
      }
    }
  }

  if (plan && checkCommit(state, seat, plan).ok) return { type: "commit", seat, turn, table: plan };
  return draw();
}

function pickDraw(state: StarRummyState, hand: readonly TileId[], lv: number, rng: () => number): "pool" | number {
  if (state.observatory.length === 0) return "pool";
  if (lv <= 2 && rng() < 0.5) return rng() < 0.3 ? Math.floor(rng() * state.observatory.length) : "pool";
  let best = -1;
  let bestScore = -Infinity;
  state.observatory.forEach((id, i) => {
    const s = fitScore(hand, id);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  const threshold = lv >= 7 ? 1.5 : lv >= 4 ? 2 : 2.5;
  if (state.pool.length === 0 || bestScore >= threshold) return best;
  return "pool";
}
