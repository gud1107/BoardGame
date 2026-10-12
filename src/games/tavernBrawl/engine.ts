import { seededRng, shuffle } from "@/lib/rng";
import { baseInstance, byLevel, classCounts, simulateCombat, synergyLevel, tribeCounts, type CombatSide, type UnitInstance } from "./combat";
import {
  HEROES,
  HERO_BY_ID,
  POOL_COPIES,
  POOL_UNITS,
  SHOP_SLOTS,
  TIER_ODDS,
  TRIBE_ORDER,
  UPGRADE_BASE,
  unitDef,
  type Effect,
  type HeroId,
  type Tribe,
  type UnitDef,
} from "./units";

/** 한 판에 나오는 종족 수(10개 중) — 전장처럼 판마다 바꿔 풀이 묽어지지 않게 */
export const TRIBES_PER_GAME = 7;

/**
 * 여관 난투 — 하스스톤 전장·롤토체스 계열 오토배틀러. 순수 리듀서(ARCHITECTURE.md §1).
 * 룰북: boardGameRule/여관난투/여관난투.md, 설계: docs/auto-battler-spec.md
 *
 * 흐름: heroPick → [shop(동시) → combat(자동, 재생)] × N → ended
 *
 * 락스텝 안전성(설계서 §3.3): 상점 행동은 자기 좌석 상태만 바꾼다. 상점 굴림은
 * `seededRng(mix(seed, round, seat, 좌석 카운터))`이고, 공용 풀은 라운드 시작 스냅샷
 * (`pool`) + 내 이번 라운드 변화(`poolDelta`)로만 본다 → 다른 사람의 행동 순서와 무관.
 * 풀은 다음 상점 시작 때 "전원이 가진 유닛"으로 다시 계산한다.
 */

export type Seat = number;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const BOARD_MAX = 7;
export const HAND_MAX = 10;
export const BUY_COST = 3;
export const REROLL_COST = 1;
export const MAX_GOLD = 10;
export const MAX_ROUNDS = 40;
/** 이 라운드부터 무승부면 양쪽 모두 여관 등급만큼 피해 */
export const DRAW_DAMAGE_ROUND = 20;

export interface GameOptions {
  startHp: number;
  /** 상점 기본 시간(초). 0 = 무제한(모두 준비해야 넘어감) */
  shopSeconds: number;
}

export const DEFAULT_OPTIONS: GameOptions = { startHp: 30, shopSeconds: 35 };

export interface SeatStats {
  triples: number;
  wins: number;
  losses: number;
  draws: number;
  damageDealt: number;
  maxTier: number;
  bought: number;
  rerolls: number;
}

export interface SeatState {
  heroOptions: HeroId[];
  hero: HeroId | null;
  hp: number;
  alive: boolean;
  place: number | null;
  gold: number;
  tier: number;
  upCost: number;
  shop: (string | null)[];
  frozen: boolean;
  hand: UnitInstance[];
  board: UnitInstance[];
  ready: boolean;
  freeRerolls: number;
  powerUsed: boolean;
  discover: string[][];
  rngN: number;
  uidN: number;
  winStreak: number;
  lossStreak: number;
  recentOpps: number[];
  lastResult: "win" | "loss" | "draw" | null;
  poolDelta: Record<string, number>;
  /** 약탈자 시너지로 다음 라운드에 더 받을 골드 */
  bonusGold: number;
  acted: boolean;
  inCombat: boolean;
  combatDone: boolean;
  stats: SeatStats;
}

export interface CombatRecord {
  a: Seat;
  /** -1 = 유령 */
  b: Seat;
  /** 유령이면 누구의 보드를 빌렸는지 */
  ghostOf: Seat | null;
  sideA: CombatSide;
  sideB: CombatSide;
  seed: number;
  winner: 0 | 1 | null;
  damage: number;
}

export type Phase = "heroPick" | "shop" | "combat" | "ended";

export interface GameState {
  seed: number;
  /** 이번 판 상점에 나오는 종족(중립은 항상) */
  tribesInPlay: Tribe[];
  options: GameOptions;
  seatCount: number;
  round: number;
  phase: Phase;
  stage: number;
  seats: SeatState[];
  /** 이번 라운드 시작 시점의 공용 풀 스냅샷 */
  pool: Record<string, number>;
  combats: CombatRecord[];
  /** 가장 최근 탈락자의 마지막 보드 — 홀수 인원일 때 유령 상대 */
  ghost: { seat: Seat; side: CombatSide } | null;
  idleStreak: number[];
  /** 이번 라운드에 탈락한 좌석 */
  eliminatedThisRound: Seat[];
}

export type EngineAction =
  | { type: "PICK_HERO"; seat: Seat; hero: HeroId }
  | { type: "BUY"; seat: Seat; round: number; slot: number }
  | { type: "SELL"; seat: Seat; round: number; uid: string }
  | { type: "PLAY"; seat: Seat; round: number; uid: string; index: number }
  | { type: "MOVE"; seat: Seat; round: number; uid: string; index: number }
  | { type: "REROLL"; seat: Seat; round: number }
  | { type: "FREEZE"; seat: Seat; round: number }
  | { type: "UPGRADE"; seat: Seat; round: number }
  | { type: "HERO_POWER"; seat: Seat; round: number; target?: string }
  | { type: "DISCOVER"; seat: Seat; round: number; pick: number }
  | { type: "READY"; seat: Seat; round: number }
  | { type: "BATCH"; seat: Seat; round: number; actions: EngineAction[] }
  | { type: "COMBAT_DONE"; seat: Seat; round: number }
  | { type: "TIMEOUT"; stage: number };

/* ── 난수·풀 ─────────────────────────────────────────────── */

export function mix(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

function seatRng(st: GameState, s: SeatState, seat: Seat): () => number {
  return seededRng(mix(st.seed, st.round, seat, s.rngN++, 17));
}

export function poolScale(playerCount: number): number {
  return playerCount <= 3 ? 0.5 : playerCount <= 5 ? 0.7 : playerCount <= 6 ? 0.85 : 1;
}

/** 이번 판 풀에 들어가는 유닛 */
export function inPlay(st: { tribesInPlay?: Tribe[] }, d: UnitDef): boolean {
  return !d.token && (d.tribe === null || !st.tribesInPlay || st.tribesInPlay.includes(d.tribe));
}

export function totalCopies(defId: string, playerCount: number): number {
  return Math.ceil(POOL_COPIES[unitDef(defId).tier] * poolScale(playerCount));
}

/** 유닛 하나가 풀에서 차지하는 장 수(황금 = 3) */
function copiesOf(u: UnitInstance): number {
  return unitDef(u.defId).token ? 0 : u.golden ? 3 : 1;
}

function computePool(st: GameState): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const d of POOL_UNITS) if (inPlay(st, d)) pool[d.id] = totalCopies(d.id, st.seatCount);
  for (const s of st.seats) {
    if (!s.alive) continue;
    for (const u of [...s.hand, ...s.board]) if (u.defId in pool) pool[u.defId] -= copiesOf(u);
  }
  for (const k of Object.keys(pool)) pool[k] = Math.max(0, pool[k]);
  return pool;
}

/** 이 좌석 시점의 남은 풀 = 스냅샷 + 내 이번 라운드 변화 */
export function effectivePool(st: GameState, s: SeatState): Record<string, number> {
  const out: Record<string, number> = { ...st.pool };
  for (const [k, v] of Object.entries(s.poolDelta)) out[k] = Math.max(0, (out[k] ?? 0) + v);
  return out;
}

function weightedPick(entries: [string, number][], rng: () => number): string | null {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

function rollShop(st: GameState, s: SeatState, seat: Seat) {
  const rng = seatRng(st, s, seat);
  const pool = effectivePool(st, s);
  const slots = SHOP_SLOTS[s.tier] + (s.hero === "mercenary" ? 1 : 0);
  const shop: (string | null)[] = [];
  for (let i = 0; i < slots; i++) {
    const byTier: Record<number, [string, number][]> = {};
    for (const d of POOL_UNITS) {
      if (d.tier > s.tier || !inPlay(st, d) || (pool[d.id] ?? 0) <= 0) continue;
      (byTier[d.tier] ??= []).push([d.id, pool[d.id]]);
    }
    const odds = TIER_ODDS[s.tier].map((p, idx) => [String(idx + 1), byTier[idx + 1] ? p : 0] as [string, number]);
    const tier = weightedPick(odds, rng);
    const id = tier ? weightedPick(byTier[Number(tier)], rng) : null;
    if (!id) break;
    pool[id]--;
    shop.push(id);
  }
  s.shop = shop;
}

function discoverOptions(st: GameState, s: SeatState, seat: Seat, tier: number): string[] {
  const rng = seatRng(st, s, seat);
  const pool = effectivePool(st, s);
  for (let t = tier; t >= 1; t--) {
    const ids = POOL_UNITS.filter((d) => d.tier === t && inPlay(st, d) && (pool[d.id] ?? 0) > 0).map((d) => d.id);
    if (ids.length > 0) return shuffle(ids, rng).slice(0, 3);
  }
  return [];
}

/* ── 상점 효과 ───────────────────────────────────────────── */

function newUid(s: SeatState, seat: Seat): string {
  return `${seat}-${s.uidN++}`;
}

function shopTargets(st: GameState, s: SeatState, seat: Seat, source: UnitInstance | null, target: string, tribe?: string): UnitInstance[] {
  const list = s.board.filter((u) => !tribe || unitDef(u.defId).tribe === tribe);
  switch (target) {
    case "self":
      return source && s.board.includes(source) ? [source] : [];
    case "randomOther": {
      const others = list.filter((u) => u !== source);
      if (others.length === 0) return [];
      const rng = seatRng(st, s, seat);
      return [others[Math.floor(rng() * others.length)]];
    }
    case "allOthers":
      return list.filter((u) => u !== source);
    case "all":
      return list;
    case "leftmost":
      return list.slice(0, 1);
    default:
      return [];
  }
}

function runShopEffects(st: GameState, s: SeatState, seat: Seat, source: UnitInstance | null, effects: Effect[] | undefined, golden: boolean) {
  if (!effects) return;
  const m = golden ? 2 : 1;
  for (const e of effects) {
    if (e.kind === "buff") {
      for (const u of shopTargets(st, s, seat, source, e.target, e.tribe)) {
        u.atk += e.atk * m;
        u.hp += e.hp * m;
      }
    } else if (e.kind === "grant") {
      for (const u of shopTargets(st, s, seat, source, e.target, e.tribe)) if (!u.kw.includes(e.keyword)) u.kw.push(e.keyword);
    } else if (e.kind === "gold") {
      s.gold += e.amount * m;
    } else if (e.kind === "freeReroll") {
      s.freeRerolls += e.amount * m;
    }
  }
}

/** 손+보드에 같은 일반 유닛 3장이 모이면 황금 유닛으로 합친다(손으로). */
function checkTriple(s: SeatState, seat: Seat, defId: string) {
  const d = unitDef(defId);
  if (d.token) return;
  const copies = [...s.hand, ...s.board].filter((u) => u.defId === defId && !u.golden);
  if (copies.length < 3) return;
  const three = copies.slice(0, 3);
  const golden = baseInstance(defId, true, newUid(s, seat));
  for (const c of three) {
    golden.atk += Math.max(0, c.atk - d.atk);
    golden.hp += Math.max(0, c.hp - d.hp);
    for (const k of c.kw) if (!golden.kw.includes(k)) golden.kw.push(k);
  }
  s.hand = s.hand.filter((u) => !three.includes(u));
  s.board = s.board.filter((u) => !three.includes(u));
  s.hand.push(golden);
  s.stats.triples++;
}

function gainUnit(s: SeatState, seat: Seat, defId: string): UnitInstance {
  const inst = baseInstance(defId, false, newUid(s, seat));
  s.hand.push(inst);
  s.poolDelta[defId] = (s.poolDelta[defId] ?? 0) - 1;
  const tribe = unitDef(defId).tribe;
  if (tribe === "elemental" && synergyLevel(tribeCounts(s.board).elemental) >= 4) {
    inst.atk += 1;
    inst.hp += 1;
  }
  // 해양: 해양 유닛을 얻으면 보드의 다른 해양 강화
  if (tribe === "sea") {
    const v = byLevel(synergyLevel(tribeCounts(s.board).sea), 1, 2, 3);
    for (const u of s.board) {
      if (unitDef(u.defId).tribe !== "sea") continue;
      u.atk += v;
      u.hp += v;
    }
  }
  checkTriple(s, seat, defId);
  return inst;
}

export function upgradeCost(s: SeatState): number {
  return Math.max(0, s.upCost - (s.hero === "architect" ? 2 : 0));
}

export function sellValue(s: SeatState, u: UnitInstance): number {
  let v = 1;
  if (s.hero === "merchant") v += 1;
  if (unitDef(u.defId).tribe === "mech" && s.board.includes(u) && synergyLevel(tribeCounts(s.board).mech) >= 2) v += 1;
  for (const e of unitDef(u.defId).onSell ?? []) if (e.kind === "gold") v += e.amount * (u.golden ? 2 : 1);
  return v;
}

/* ── 시작 ────────────────────────────────────────────────── */

function emptyStats(): SeatStats {
  return { triples: 0, wins: 0, losses: 0, draws: 0, damageDealt: 0, maxTier: 1, bought: 0, rerolls: 0 };
}

export function startGame(playerCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): GameState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  const heroRng = seededRng(mix(seed, 4242));
  const tribesInPlay = shuffle(TRIBE_ORDER, seededRng(mix(seed, 777)))
    .slice(0, TRIBES_PER_GAME)
    .sort((x, y) => TRIBE_ORDER.indexOf(x) - TRIBE_ORDER.indexOf(y));
  const deck = shuffle(
    HEROES.map((h) => h.id),
    heroRng,
  );
  const seats: SeatState[] = Array.from({ length: n }, (_, i) => ({
    heroOptions: [deck[(i * 3) % deck.length], deck[(i * 3 + 1) % deck.length], deck[(i * 3 + 2) % deck.length]],
    hero: null,
    hp: options.startHp,
    alive: true,
    place: null,
    gold: 0,
    tier: 1,
    upCost: UPGRADE_BASE[2] + 1, // 1라운드 시작 때 1 깎여 5가 된다
    shop: [],
    frozen: false,
    hand: [],
    board: [],
    ready: false,
    freeRerolls: 0,
    powerUsed: false,
    discover: [],
    rngN: 0,
    uidN: 0,
    winStreak: 0,
    lossStreak: 0,
    recentOpps: [],
    lastResult: null,
    poolDelta: {},
    bonusGold: 0,
    acted: false,
    inCombat: false,
    combatDone: true,
    stats: emptyStats(),
  }));
  return {
    seed,
    tribesInPlay,
    options,
    seatCount: n,
    round: 0,
    phase: "heroPick",
    stage: 0,
    seats,
    pool: {},
    combats: [],
    ghost: null,
    idleStreak: Array(n).fill(0),
    eliminatedThisRound: [],
  };
}

function cloneState(st: GameState): GameState {
  return structuredClone(st);
}

/** 라운드 r의 기본 골드 */
export function roundGold(round: number): number {
  return Math.min(MAX_GOLD, round + 2);
}

function startShop(st: GameState): GameState {
  st.round += 1;
  st.phase = "shop";
  st.stage += 1;
  st.eliminatedThisRound = [];
  st.pool = computePool(st);
  st.seats.forEach((s, seat) => {
    s.poolDelta = {};
    s.inCombat = false;
    s.combatDone = true;
    if (!s.alive) return;
    s.ready = false;
    s.acted = false;
    s.powerUsed = false;
    s.upCost = Math.max(0, s.upCost - 1);
    const streak = s.winStreak >= 3 || s.lossStreak >= 3 ? 1 : 0;
    s.gold = roundGold(st.round) + streak + (s.bonusGold ?? 0);
    s.bonusGold = 0;
    // 악마의 대가: 시너지가 켜져 있으면 체력 −1 (1 아래로는 안 떨어짐)
    const demons = tribeCounts(s.board).demon;
    if (synergyLevel(demons) >= 2) s.hp = Math.max(1, s.hp - 1);
    s.freeRerolls = (synergyLevel(tribeCounts(s.board).elemental) >= 2 ? 1 : 0) + (s.hero === "mercenary" ? 3 : 0);
    for (const u of s.board) runShopEffects(st, s, seat, u, unitDef(u.defId).shopStart, u.golden);
    if (s.frozen) {
      s.shop = s.shop.filter((x): x is string => !!x);
      s.frozen = false;
    } else {
      rollShop(st, s, seat);
    }
  });
  return st;
}

/* ── 상점 행동 ───────────────────────────────────────────── */

type SeatAction = Exclude<EngineAction, { type: "PICK_HERO" } | { type: "TIMEOUT" } | { type: "BATCH" } | { type: "COMBAT_DONE" }>;

/** 성공하면 true. s/st는 이미 복제본. */
function applyShopAction(st: GameState, s: SeatState, a: SeatAction): boolean {
  const seat = a.seat;
  if (a.type === "READY") {
    if (s.ready) return false;
    while (s.discover.length > 0) applyShopAction(st, s, { type: "DISCOVER", seat, round: a.round, pick: 0 });
    s.ready = true;
    return true;
  }
  if (s.ready) return false;
  switch (a.type) {
    case "BUY": {
      const id = s.shop[a.slot];
      if (!id || s.gold < BUY_COST || s.hand.length >= HAND_MAX) return false;
      s.gold -= BUY_COST;
      s.shop = s.shop.map((x, i) => (i === a.slot ? null : x));
      gainUnit(s, seat, id);
      s.stats.bought++;
      return true;
    }
    case "SELL": {
      const u = s.board.find((x) => x.uid === a.uid) ?? s.hand.find((x) => x.uid === a.uid);
      if (!u) return false;
      s.gold += sellValue(s, u);
      s.board = s.board.filter((x) => x !== u);
      s.hand = s.hand.filter((x) => x !== u);
      if (!unitDef(u.defId).token) s.poolDelta[u.defId] = (s.poolDelta[u.defId] ?? 0) + copiesOf(u);
      return true;
    }
    case "PLAY": {
      const u = s.hand.find((x) => x.uid === a.uid);
      if (!u || s.board.length >= BOARD_MAX) return false;
      s.hand = s.hand.filter((x) => x !== u);
      const at = Math.max(0, Math.min(a.index, s.board.length));
      s.board.splice(at, 0, u);
      runShopEffects(st, s, seat, u, unitDef(u.defId).battlecry, u.golden);
      if (u.golden) {
        const opts = discoverOptions(st, s, seat, Math.min(6, s.tier + 1));
        if (opts.length) s.discover.push(opts);
      }
      return true;
    }
    case "MOVE": {
      const u = s.board.find((x) => x.uid === a.uid);
      if (!u) return false;
      const rest = s.board.filter((x) => x !== u);
      const at = Math.max(0, Math.min(a.index, rest.length));
      rest.splice(at, 0, u);
      s.board = rest;
      return true;
    }
    case "REROLL": {
      if (s.freeRerolls > 0) s.freeRerolls--;
      else if (s.gold >= REROLL_COST) s.gold -= REROLL_COST;
      else return false;
      s.frozen = false;
      rollShop(st, s, seat);
      s.stats.rerolls++;
      return true;
    }
    case "FREEZE": {
      s.frozen = !s.frozen;
      return true;
    }
    case "UPGRADE": {
      const cost = upgradeCost(s);
      if (s.tier >= 6 || s.gold < cost) return false;
      s.gold -= cost;
      s.tier += 1;
      s.upCost = s.tier < 6 ? UPGRADE_BASE[s.tier + 1] : 0;
      s.stats.maxTier = Math.max(s.stats.maxTier, s.tier);
      // 늘어난 상점 칸은 다음 새로고침부터 적용
      return true;
    }
    case "HERO_POWER": {
      const hero = s.hero ? HERO_BY_ID[s.hero] : null;
      if (!hero || hero.cost === null || s.powerUsed || s.gold < hero.cost) return false;
      if (hero.id === "mage") {
        if (s.board.length === 0) return false;
        const target = s.board.find((u) => u.uid === a.target) ?? s.board[Math.floor(seatRng(st, s, seat)() * s.board.length)];
        target.atk += 1;
        target.hp += 1;
      } else if (hero.id === "tamer") {
        if (s.board.length === 0) return false;
        for (const u of s.board) {
          u.atk += 1;
          u.hp += 1;
        }
      } else if (hero.id === "prophet") {
        const opts = discoverOptions(st, s, seat, s.tier);
        if (!opts.length) return false;
        s.discover.push(opts);
      }
      s.gold -= hero.cost;
      s.powerUsed = true;
      return true;
    }
    case "DISCOVER": {
      const opts = s.discover[0];
      if (!opts) return false;
      const id = opts[Math.max(0, Math.min(a.pick, opts.length - 1))];
      s.discover = s.discover.slice(1);
      gainUnit(s, seat, id);
      return true;
    }
    default:
      return false;
  }
}

/* ── 라운드 해결 ─────────────────────────────────────────── */

export function damageCap(round: number): number {
  return round <= 3 ? 5 : round <= 7 ? 10 : Infinity;
}

function makePairings(st: GameState): { pairs: [Seat, Seat][]; leftover: Seat | null } {
  const alive = st.seats.map((s, i) => (s.alive ? i : -1)).filter((i) => i >= 0);
  let best: { pairs: [Seat, Seat][]; leftover: Seat | null } = { pairs: [], leftover: null };
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 30; attempt++) {
    const order = shuffle(alive, seededRng(mix(st.seed, st.round, attempt, 99)));
    const pairs: [Seat, Seat][] = [];
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
    const leftover = order.length % 2 === 1 ? order[order.length - 1] : null;
    let score = 0;
    for (const [x, y] of pairs) {
      const r = st.seats[x].recentOpps;
      if (r[r.length - 1] === y) score += 10;
      else if (r.includes(y)) score += 3;
    }
    if (leftover !== null && st.seats[leftover].recentOpps.at(-1) === -1) score += 5;
    if (score < bestScore) {
      bestScore = score;
      best = { pairs, leftover };
      if (score === 0) break;
    }
  }
  return best;
}

function sideOf(s: SeatState): CombatSide {
  return { board: structuredClone(s.board), hero: s.hero, tier: s.tier };
}

function resolveShop(st: GameState): GameState {
  // 남은 발견·준비 강제 처리, 성장(상점 종료) 효과
  st.seats.forEach((s, seat) => {
    if (!s.alive) return;
    while (s.discover.length > 0) applyShopAction(st, s, { type: "DISCOVER", seat, round: st.round, pick: 0 });
    s.ready = true;
    for (const u of [...s.board]) runShopEffects(st, s, seat, u, unitDef(u.defId).shopEnd, u.golden);
    const syLv = synergyLevel(tribeCounts(s.board).sylvan);
    if (syLv) {
      const trees = s.board.filter((u) => unitDef(u.defId).tribe === "sylvan");
      const v = syLv === 6 ? 2 : 1;
      const targets = syLv === 2 ? [trees[Math.floor(seatRng(st, s, seat)() * trees.length)]] : trees;
      for (const u of targets) {
        u.atk += v;
        u.hp += v;
      }
    }
    if (synergyLevel(tribeCounts(s.board).elemental) >= 6) {
      for (const u of s.board) {
        if (unitDef(u.defId).tribe !== "elemental") continue;
        u.atk += 2;
        u.hp += 2;
      }
    }
  });

  const { pairs, leftover } = makePairings(st);
  const combats: CombatRecord[] = [];
  const hpLoss = Array(st.seatCount).fill(0) as number[];
  const cap = damageCap(st.round);
  const record = (seat: Seat, result: "win" | "loss" | "draw", opp: Seat) => {
    const s = st.seats[seat];
    s.lastResult = result;
    s.recentOpps = [...s.recentOpps, opp].slice(-2);
    s.inCombat = true;
    s.combatDone = false;
    const plunder = byLevel(synergyLevel(classCounts(s.board).plunderer), 1, 2, 4);
    s.bonusGold = plunder ? plunder + (result === "win" ? 1 : 0) : 0;
    if (result === "win") {
      s.winStreak++;
      s.lossStreak = 0;
      s.stats.wins++;
    } else if (result === "loss") {
      s.lossStreak++;
      s.winStreak = 0;
      s.stats.losses++;
    } else {
      s.winStreak = 0;
      s.lossStreak = 0;
      s.stats.draws++;
    }
  };

  pairs.forEach(([x, y], i) => {
    const sideA = sideOf(st.seats[x]);
    const sideB = sideOf(st.seats[y]);
    const seed = mix(st.seed, st.round, i, 7);
    const r = simulateCombat(sideA, sideB, seed);
    let damage = 0;
    if (r.winner !== null) {
      const winSide = r.winner === 0 ? sideA : sideB;
      damage = Math.min(cap, winSide.tier + r.survivorTiers);
      const loser = r.winner === 0 ? y : x;
      const winnerSeat = r.winner === 0 ? x : y;
      hpLoss[loser] += damage;
      st.seats[winnerSeat].stats.damageDealt += damage;
    } else if (st.round >= DRAW_DAMAGE_ROUND) {
      hpLoss[x] += sideB.tier;
      hpLoss[y] += sideA.tier;
    }
    record(x, r.winner === 0 ? "win" : r.winner === 1 ? "loss" : "draw", y);
    record(y, r.winner === 1 ? "win" : r.winner === 0 ? "loss" : "draw", x);
    combats.push({ a: x, b: y, ghostOf: null, sideA, sideB, seed, winner: r.winner, damage });
  });

  if (leftover !== null) {
    let ghostSide: CombatSide | null = null;
    let ghostOf: Seat | null = null;
    if (st.ghost && st.ghost.seat !== leftover) {
      ghostSide = structuredClone(st.ghost.side);
      ghostOf = st.ghost.seat;
    } else {
      const others = st.seats.map((s, i) => (s.alive && i !== leftover ? i : -1)).filter((i) => i >= 0);
      if (others.length > 0) {
        ghostOf = others[Math.floor(seededRng(mix(st.seed, st.round, 55))() * others.length)];
        ghostSide = sideOf(st.seats[ghostOf]);
      }
    }
    if (ghostSide && ghostOf !== null) {
      const sideA = sideOf(st.seats[leftover]);
      const seed = mix(st.seed, st.round, pairs.length, 7);
      const r = simulateCombat(sideA, ghostSide, seed);
      let damage = 0;
      if (r.winner === 1) {
        damage = Math.min(cap, ghostSide.tier + r.survivorTiers);
        hpLoss[leftover] += damage;
      } else if (r.winner === 0) {
        damage = Math.min(cap, sideA.tier + r.survivorTiers);
      } else if (st.round >= DRAW_DAMAGE_ROUND) {
        hpLoss[leftover] += ghostSide.tier;
      }
      record(leftover, r.winner === 0 ? "win" : r.winner === 1 ? "loss" : "draw", -1);
      combats.push({ a: leftover, b: -1, ghostOf, sideA, sideB: ghostSide, seed, winner: r.winner, damage });
    }
  }

  // 체력 반영 + 탈락 순위
  const aliveBefore = st.seats.filter((s) => s.alive).length;
  const newlyDead: Seat[] = [];
  st.seats.forEach((s, seat) => {
    if (!s.alive) return;
    s.hp -= hpLoss[seat];
    if (s.hp <= 0) newlyDead.push(seat);
  });
  const aliveAfter = aliveBefore - newlyDead.length;
  for (const seat of newlyDead) {
    const s = st.seats[seat];
    const better = newlyDead.filter((o) => st.seats[o].hp > s.hp).length;
    s.place = aliveAfter + 1 + better;
    s.alive = false;
  }
  if (newlyDead.length > 0) {
    // 가장 체력이 높았던(=가장 늦게 떨어진) 탈락자의 보드를 다음 유령으로
    const last = [...newlyDead].sort((p, q) => st.seats[q].hp - st.seats[p].hp || p - q)[0];
    st.ghost = { seat: last, side: sideOf(st.seats[last]) };
  }
  st.eliminatedThisRound = newlyDead;
  st.combats = combats;
  st.phase = "combat";
  st.stage += 1;
  return st;
}

function finishOrNextRound(st: GameState): GameState {
  const alive = st.seats.map((s, i) => (s.alive ? i : -1)).filter((i) => i >= 0);
  if (alive.length <= 1 || st.round >= MAX_ROUNDS) {
    // 남은 생존자는 체력 순으로 1위부터
    const sorted = [...alive].sort((p, q) => st.seats[q].hp - st.seats[p].hp);
    for (const seat of sorted) {
      const s = st.seats[seat];
      s.place = 1 + sorted.filter((o) => st.seats[o].hp > s.hp).length;
    }
    st.phase = "ended";
    st.stage += 1;
    return st;
  }
  return startShop(st);
}

/* ── 리듀서 ──────────────────────────────────────────────── */

function allPicked(st: GameState) {
  return st.seats.every((s) => s.hero !== null);
}

function allReady(st: GameState) {
  return st.seats.every((s) => !s.alive || s.ready);
}

function allCombatDone(st: GameState) {
  return st.seats.every((s) => !s.inCombat || s.combatDone);
}

function seatActionOk(st: GameState, a: { seat: Seat; round: number }): boolean {
  return st.phase === "shop" && a.round === st.round && a.seat >= 0 && a.seat < st.seatCount && st.seats[a.seat].alive;
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "PICK_HERO": {
      if (state.phase !== "heroPick") return state;
      const s0 = state.seats[action.seat];
      if (!s0 || s0.hero !== null || !s0.heroOptions.includes(action.hero)) return state;
      const st = cloneState(state);
      st.seats[action.seat].hero = action.hero;
      st.idleStreak[action.seat] = 0;
      return allPicked(st) ? startShop(st) : st;
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      const st = cloneState(state);
      if (st.phase === "heroPick") {
        st.seats.forEach((s, i) => {
          if (s.hero === null) {
            s.hero = s.heroOptions[0];
            st.idleStreak[i]++;
          }
        });
        return startShop(st);
      }
      if (st.phase === "shop") {
        st.seats.forEach((s, i) => {
          if (s.alive && !s.ready && !s.acted) st.idleStreak[i]++;
        });
        return resolveShop(st);
      }
      if (st.phase === "combat") return finishOrNextRound(st);
      return state;
    }
    case "COMBAT_DONE": {
      if (state.phase !== "combat" || action.round !== state.round) return state;
      const s0 = state.seats[action.seat];
      if (!s0 || !s0.inCombat || s0.combatDone) return state;
      const st = cloneState(state);
      st.seats[action.seat].combatDone = true;
      return allCombatDone(st) ? finishOrNextRound(st) : st;
    }
    case "BATCH": {
      if (!seatActionOk(state, action)) return state;
      const st = cloneState(state);
      const s = st.seats[action.seat];
      let changed = false;
      for (const sub of action.actions) {
        if (sub.type === "BATCH" || sub.type === "TIMEOUT" || sub.type === "PICK_HERO" || sub.type === "COMBAT_DONE") continue;
        if (sub.seat !== action.seat) continue;
        if (applyShopAction(st, s, { ...sub, round: st.round } as SeatAction)) changed = true;
      }
      if (!changed) return state;
      s.acted = true;
      st.idleStreak[action.seat] = 0;
      return allReady(st) ? resolveShop(st) : st;
    }
    default: {
      if (!seatActionOk(state, action)) return state;
      const st = cloneState(state);
      const s = st.seats[action.seat];
      if (!applyShopAction(st, s, action)) return state;
      s.acted = true;
      st.idleStreak[action.seat] = 0;
      return allReady(st) ? resolveShop(st) : st;
    }
  }
}

/* ── 조회 ────────────────────────────────────────────────── */

export function pendingSeats(state: GameState): Seat[] {
  return state.seats
    .map((s, i) => {
      if (state.phase === "heroPick") return s.hero === null ? i : -1;
      if (state.phase === "shop") return s.alive && !s.ready ? i : -1;
      if (state.phase === "combat") return s.inCombat && !s.combatDone ? i : -1;
      return -1;
    })
    .filter((i) => i >= 0);
}

/** 상점 제한 시간(초): 기본 + 라운드마다 5초, 최대 기본+30 */
export function shopSecondsFor(state: GameState): number {
  const base = state.options.shopSeconds;
  if (base <= 0) return 0;
  return Math.min(base + 30, base + (state.round - 1) * 5);
}

export function combatFor(state: GameState, seat: Seat): CombatRecord | null {
  return state.combats.find((c) => c.a === seat || c.b === seat) ?? null;
}

export function computeRankings(state: GameState): { seat: Seat; rank: number; score: number }[] {
  return state.seats
    .map((s, seat) => ({ seat, rank: s.place ?? state.seatCount, score: s.hp }))
    .sort((p, q) => p.rank - q.rank || p.seat - q.seat);
}

export function winnerSeats(state: GameState): Seat[] {
  return state.seats.map((s, i) => (s.place === 1 ? i : -1)).filter((i) => i >= 0);
}

/** 이 좌석이 지금 낼 수 있는 모든 합법 액션(봇 계약, ARCHITECTURE.md §7.1). */
export function getValidMoves(state: GameState, seat: Seat): EngineAction[] {
  const s = state.seats[seat];
  if (!s) return [];
  if (state.phase === "heroPick") return s.hero === null ? s.heroOptions.map((hero) => ({ type: "PICK_HERO", seat, hero })) : [];
  if (state.phase === "combat") return s.inCombat && !s.combatDone ? [{ type: "COMBAT_DONE", seat, round: state.round }] : [];
  if (state.phase !== "shop" || !s.alive || s.ready) return [];
  const round = state.round;
  const moves: EngineAction[] = [{ type: "READY", seat, round }];
  if (s.discover.length) return s.discover[0].map((_, pick) => ({ type: "DISCOVER", seat, round, pick }));
  if (s.gold >= BUY_COST && s.hand.length < HAND_MAX) s.shop.forEach((id, slot) => id && moves.push({ type: "BUY", seat, round, slot }));
  for (const u of [...s.board, ...s.hand]) moves.push({ type: "SELL", seat, round, uid: u.uid });
  if (s.board.length < BOARD_MAX) for (const u of s.hand) moves.push({ type: "PLAY", seat, round, uid: u.uid, index: s.board.length });
  if (s.freeRerolls > 0 || s.gold >= REROLL_COST) moves.push({ type: "REROLL", seat, round });
  if (s.tier < 6 && s.gold >= upgradeCost(s)) moves.push({ type: "UPGRADE", seat, round });
  const hero = s.hero ? HERO_BY_ID[s.hero] : null;
  const needsBoard = hero?.id === "mage" || hero?.id === "tamer";
  if (hero && hero.cost !== null && !s.powerUsed && s.gold >= hero.cost && (!needsBoard || s.board.length > 0)) moves.push({ type: "HERO_POWER", seat, round });
  return moves;
}

export { tribeCounts, synergyLevel };
