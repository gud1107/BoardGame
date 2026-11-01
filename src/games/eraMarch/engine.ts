/**
 * 시대의 진격 (Era March) — pure lane-battle simulation.
 *
 * Two bases sit at the ends of one lane (side 0 at x = 0 marching right,
 * side 1 at x = LANE marching left). Players spend gold on units that walk
 * the lane and fight on their own, on base turrets, and on one special per
 * era; XP + gold together evolve a side to the next era, where it also picks
 * one of two doctrines (a passive + an extra unit). A base at 0 HP loses.
 *
 * Determinism: fixed TICK_MS steps, the only randomness is `state.rng`
 * (mulberry32) and units act in id order, so the same seed + the same
 * per-tick commands always give the same match. That is what the future
 * online mode (host-authoritative snapshots, like mergeDefense) relies on.
 * Within a tick every attack is decided first and all damage lands together,
 * so neither side wins simultaneous trades just by being processed first.
 *
 * Pre-battle shop: each side's `Loadout` (a command plan + items, data.ts)
 * is part of `startGame`, so it rides inside the state like everything else
 * and the online replay stays deterministic. Plan/item effects are applied
 * at start (gold, slots, turret, free vanguard) and through the modifier
 * helpers below (speed, training, range, HP, income, XP, kill gold).
 *
 * `stepGame` mutates the state in place (the board steps 20×/s and keeps
 * one live object); clone with `structuredClone` when a copy is needed.
 * `state.events` holds what happened in the last step — the 3D scene, the
 * overlay and the sound layer all read it and nothing else.
 */

import {
  ALLY_GAP,
  BASE_FRONT,
  CATCH_UP_DISCOUNT,
  CONTACT_GAP,
  DOCTRINES,
  ERA_DOCTRINES,
  ERA_GAP_BONUS,
  ERA_TURRETS,
  ERA_UNITS,
  ERAS,
  FRONT_MAX,
  FRONT_STEP,
  KILL_GOLD,
  KILL_XP,
  LANE,
  LAST_STAND_MUL,
  LAST_STAND_RANGE,
  MATCH_TICKS,
  PASSIVE_XP,
  PLUNDER_GOLD,
  POP_CAP,
  QUEUE_CAP,
  roleMul,
  SELL_REFUND,
  SLOT_COST,
  SPAWN_X,
  SPECIAL_CD,
  START_GOLD,
  SUDDEN_DEATH_PCT,
  TICKS_PER_SEC,
  TRAIN_XP,
  TURRETS,
  UNITS,
  type DoctrineId,
  type Era,
  type ItemId,
  type Loadout,
  type PlanId,
  type Fx,
  type Role,
  type TurretKind,
  type UnitKind,
} from "./data";

export type Side = 0 | 1;

export interface Unit {
  id: number;
  side: Side;
  kind: UnitKind;
  x: number;
  hp: number;
  maxHp: number;
  cd: number;
  stun: number;
  /** Tick of the last attack (drives the swing animation). */
  lastAtk: number;
  /** Whether the unit moved this tick. */
  moving: boolean;
}

export interface QueueItem {
  kind: UnitKind;
  left: number;
  total: number;
  /** Shop vanguard: no refund on cancel. */
  free?: boolean;
}

export interface TurretSlot {
  kind: TurretKind;
  cd: number;
  lastShot: number;
}

export interface PlayerStats {
  trained: number;
  kills: number;
  lost: number;
  goldEarned: number;
  damage: number;
  specials: number;
}

export interface PlayerState {
  /** Shop pick (null in tests / old states = no plan). */
  plan: PlanId | null;
  items: ItemId[];
  gold: number;
  xp: number;
  era: Era;
  doctrines: DoctrineId[];
  queue: QueueItem[];
  turrets: (TurretSlot | null)[];
  slots: number;
  specialCd: number;
  /** Enemy EMP: turrets silent while > 0. */
  jammed: number;
  baseHp: number;
  baseMax: number;
  stats: PlayerStats;
}

interface PendingHit {
  due: number;
  side: Side;
  /** Unit id, or -1 for the enemy base. */
  target: number;
  x: number;
  dmg: number;
  role: Role | "turret";
  fx: Fx;
  splash: number;
  siege: number;
  steal: number;
  kind: UnitKind | null;
}

export interface Strike {
  /** Tick it was cast (the 3D scene flies the shell from `at` to `due`). */
  at: number;
  due: number;
  side: Side;
  x: number;
  radius: number;
  dmg: number;
  stun: number;
  push: number;
  /** Hit only this unit (naval fire), else everything in the radius. */
  target: number;
  era: Era;
}

export interface Sweep {
  side: Side;
  x: number;
  vx: number;
  end: number;
  dmg: number;
  stun: number;
  push: number;
  hit: number[];
  era: Era;
}

export type FxEvent =
  | { t: "train"; side: Side; kind: UnitKind }
  | { t: "cancel"; side: Side }
  | { t: "reject"; side: Side; reason: string }
  | { t: "spawn"; side: Side; id: number; kind: UnitKind }
  | { t: "swing"; side: Side; id: number; kind: UnitKind }
  | { t: "shot"; side: Side; from: number; to: number; fx: Fx; ticks: number; turret: number; id: number; base: boolean }
  | { t: "hit"; side: Side; id: number; x: number; dmg: number; fx: Fx; mul: number; base: boolean }
  | { t: "death"; side: Side; id: number; kind: UnitKind; x: number }
  | { t: "bounty"; side: Side; x: number; gold: number; bonus: boolean }
  | { t: "heal"; side: Side; x: number; amt: number }
  | { t: "steal"; side: Side; x: number; gold: number }
  | { t: "evolve"; side: Side; era: Era; doctrine: DoctrineId | null }
  | { t: "special"; side: Side; era: Era }
  | { t: "strike"; side: Side; x: number; radius: number; era: Era }
  | { t: "sweep"; side: Side; x: number; era: Era }
  | { t: "turret"; side: Side; slot: number; kind: TurretKind }
  | { t: "sell"; side: Side; slot: number }
  | { t: "slot"; side: Side; slot: number }
  | { t: "specialReady"; side: Side }
  | { t: "suddenDeath" }
  | { t: "end"; winner: Side | "draw" };

export type Command =
  | { t: "train"; kind: UnitKind }
  | { t: "cancel"; index: number }
  | { t: "evolve"; doctrine?: DoctrineId }
  | { t: "turret"; slot: number; kind: TurretKind }
  | { t: "sell"; slot: number }
  | { t: "slot" }
  | { t: "special" };

export interface SeatCommand {
  side: Side;
  cmd: Command;
}

export interface EraMarchState {
  tick: number;
  rng: number;
  nextId: number;
  players: [PlayerState, PlayerState];
  units: Unit[];
  hits: PendingHit[];
  strikes: Strike[];
  sweeps: Sweep[];
  events: FxEvent[];
  suddenDeath: boolean;
  winner: Side | "draw" | null;
}

/* ── rng ─────────────────────────────────────────────────────────────── */

export function nextRandom(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ── setup ───────────────────────────────────────────────────────────── */

function newPlayer(loadout?: Loadout): PlayerState {
  const p: PlayerState = {
    plan: loadout?.plan ?? null,
    items: loadout ? [...loadout.items] : [],
    gold: START_GOLD,
    xp: 0,
    era: 0,
    doctrines: [],
    queue: [],
    turrets: [null, null, null],
    slots: 1,
    specialCd: Math.round(SPECIAL_CD / 2),
    jammed: 0,
    baseHp: 0,
    baseMax: 0,
    stats: { trained: 0, kills: 0, lost: 0, goldEarned: 0, damage: 0, specials: 0 },
  };
  p.baseMax = p.baseHp = baseHpFor(p, 0);
  if (p.plan === "blitz") p.gold += 150;
  if (p.plan === "scholar") p.gold -= 20;
  if (p.plan === "fortress") p.slots = 2;
  if (hasItem(p, "vault")) p.gold += 90;
  if (hasItem(p, "warmup")) p.specialCd = 0;
  if (hasItem(p, "tower")) p.turrets[0] = { kind: "rock", cd: 20, lastShot: -99 };
  if (hasItem(p, "veterans")) for (let i = 0; i < 3; i++) p.queue.push({ kind: "club", left: 4 + i * 8, total: 4 + i * 8, free: true });
  return p;
}

/** `loadouts` = the shop picks by side; omitted = no plan, no items. */
export function startGame(seed: number, loadouts?: readonly [Loadout, Loadout]): EraMarchState {
  return {
    tick: 0,
    rng: seed | 0,
    nextId: 1,
    players: [newPlayer(loadouts?.[0]), newPlayer(loadouts?.[1])],
    units: [],
    hits: [],
    strikes: [],
    sweeps: [],
    events: [],
    suddenDeath: false,
    winner: null,
  };
}

/* ── geometry helpers ────────────────────────────────────────────────── */

export const dirOf = (side: Side) => (side === 0 ? 1 : -1);
/** Distance marched from the unit's own base. */
export const progress = (side: Side, x: number) => (side === 0 ? x : LANE - x);
export const fromProgress = (side: Side, p: number) => (side === 0 ? p : LANE - p);
/** x of `side`'s own base wall. */
export const wallX = (side: Side) => (side === 0 ? BASE_FRONT : LANE - BASE_FRONT);

export const has = (p: PlayerState, d: DoctrineId) => p.doctrines.includes(d);
export const hasItem = (p: PlayerState, i: ItemId) => (p.items ?? []).includes(i);

export function baseHpFor(p: PlayerState, era: Era): number {
  const m = p.plan === "fortress" ? 1.15 : 1;
  return Math.round(ERAS[era].baseHp * m);
}

/** Unit attack multiplier (plan). */
export const atkMul = (p: PlayerState) => (p.plan === "blitz" ? 1.15 : 1);

/** XP multiplier (plan). */
export const xpMul = (p: PlayerState) => (p.plan === "scholar" ? 1.35 : 1);

/** Spawn HP multiplier for this unit (doctrine + plan + items). */
export function hpMul(p: PlayerState, kind: UnitKind): number {
  let m = UNITS[kind].role === "charge" && has(p, "iron") ? 1.3 : 1;
  if (hasItem(p, "armor")) m *= 1.08;
  if (p.plan === "merchant") m *= 0.92;
  return m;
}

export function unitRange(p: PlayerState, kind: UnitKind): number {
  const def = UNITS[kind];
  if (def.role !== "ranged" && def.role !== "support") return def.range;
  return def.range * (has(p, "aim") ? 1.2 : 1) * (hasItem(p, "sharp") ? 1.1 : 1);
}

export function unitSpeed(p: PlayerState, kind: UnitKind): number {
  const def = UNITS[kind];
  return def.speed * (def.role === "charge" && has(p, "chariot") ? 1.25 : 1) * (p.plan === "blitz" ? 1.15 : 1);
}

export function trainTicks(p: PlayerState, kind: UnitKind): number {
  let m = has(p, "mass") ? 0.75 : 1;
  if (p.plan === "fortress") m *= 1.15;
  if (p.plan === "blitz") m *= 0.8;
  if (hasItem(p, "drill")) m *= 0.9;
  return Math.max(1, Math.round(UNITS[kind].trainTicks * m));
}

export function specialCdMax(p: PlayerState): number {
  return has(p, "overload") ? Math.round(SPECIAL_CD * 0.7) : SPECIAL_CD;
}

/** Units this side may train right now (current era + its doctrine units). */
export function rosterOf(p: PlayerState): UnitKind[] {
  const list: UnitKind[] = [...ERA_UNITS[p.era]];
  for (const d of p.doctrines) if (DOCTRINES[d].era === p.era) list.push(DOCTRINES[d].unit);
  return list;
}

/** Highest x a side's front reaches (as progress), 0 when it has no units. */
export function frontProgress(s: EraMarchState, side: Side): number {
  let best = 0;
  for (const u of s.units) if (u.side === side) best = Math.max(best, progress(side, u.x));
  return best;
}

export function frontIncome(s: EraMarchState, side: Side): number {
  const over = frontProgress(s, side) - LANE / 2;
  return over <= 0 ? 0 : Math.min(FRONT_MAX, Math.floor(over / FRONT_STEP));
}

export function incomeOf(s: EraMarchState, side: Side): number {
  const p = s.players[side];
  const m = 1 + (p.plan === "merchant" ? 0.15 : 0) + (hasItem(p, "bonds") ? 0.15 : 0);
  return Math.round((ERAS[p.era].income + frontIncome(s, side)) * m * 10) / 10;
}

export function popOf(s: EraMarchState, side: Side): number {
  let n = 0;
  for (const u of s.units) if (u.side === side) n++;
  return n;
}

export function nextEra(p: PlayerState): Era | null {
  return p.era < 4 ? ((p.era + 1) as Era) : null;
}

/** Gold to evolve now (discounted while the opponent is already ahead). */
export function evolveCost(s: EraMarchState, side: Side): number {
  const p = s.players[side];
  const n = nextEra(p);
  if (n === null) return 0;
  const behind = s.players[side === 0 ? 1 : 0].era > p.era;
  return Math.round(ERAS[n].goldCost * (behind ? CATCH_UP_DISCOUNT : 1) * (p.plan === "scholar" ? 0.8 : p.plan === "blitz" ? 1.1 : 1));
}

/* ── command validation ──────────────────────────────────────────────── */

export function commandError(s: EraMarchState, side: Side, c: Command): string | null {
  if (s.winner !== null) return "게임 종료";
  const p = s.players[side];
  switch (c.t) {
    case "train": {
      if (!rosterOf(p).includes(c.kind)) return "지금 시대에 없는 유닛";
      if (p.queue.length >= QUEUE_CAP) return "생산 대기열이 가득 참";
      if (p.gold < UNITS[c.kind].cost) return "골드 부족";
      const lim = UNITS[c.kind].limit;
      if (lim !== undefined) {
        const alive = s.units.filter((u) => u.side === side && u.kind === c.kind).length + p.queue.filter((q) => q.kind === c.kind).length;
        if (alive >= lim) return `전장에 ${lim}기만 가능`;
      }
      return null;
    }
    case "cancel":
      return c.index >= 0 && c.index < p.queue.length ? null : "취소할 유닛 없음";
    case "evolve": {
      const n = nextEra(p);
      if (n === null) return "마지막 시대";
      if (p.xp < ERAS[n].xpNeed) return "경험치 부족";
      if (p.gold < evolveCost(s, side)) return "골드 부족";
      return null;
    }
    case "turret": {
      if (c.slot < 0 || c.slot >= p.slots) return "닫힌 슬롯";
      const def = TURRETS[c.kind];
      if (!def || def.era > p.era) return "아직 못 짓는 포탑";
      const refund = p.turrets[c.slot] ? Math.floor(TURRETS[p.turrets[c.slot]!.kind].cost * SELL_REFUND) : 0;
      if (p.gold + refund < def.cost) return "골드 부족";
      return null;
    }
    case "sell":
      return p.turrets[c.slot] ? null : "포탑 없음";
    case "slot":
      if (p.slots >= SLOT_COST.length) return "슬롯 모두 개방";
      return p.gold >= SLOT_COST[p.slots] ? null : "골드 부족";
    case "special":
      return p.specialCd > 0 ? "필살기 충전 중" : null;
  }
}

/* ── step ────────────────────────────────────────────────────────────── */

function applyCommand(s: EraMarchState, side: Side, c: Command) {
  const err = commandError(s, side, c);
  const p = s.players[side];
  if (err) {
    s.events.push({ t: "reject", side, reason: err });
    return;
  }
  switch (c.t) {
    case "train": {
      p.gold -= UNITS[c.kind].cost;
      const total = trainTicks(p, c.kind);
      p.queue.push({ kind: c.kind, left: total, total });
      p.xp += Math.round(UNITS[c.kind].cost * TRAIN_XP * xpMul(p));
      s.events.push({ t: "train", side, kind: c.kind });
      return;
    }
    case "cancel": {
      const [q] = p.queue.splice(c.index, 1);
      if (!q.free) {
        p.gold += UNITS[q.kind].cost;
        p.xp = Math.max(0, p.xp - Math.round(UNITS[q.kind].cost * TRAIN_XP * xpMul(p)));
      }
      s.events.push({ t: "cancel", side });
      return;
    }
    case "evolve": {
      const n = nextEra(p)!;
      p.gold -= evolveCost(s, side);
      p.era = n;
      const pair = ERA_DOCTRINES[n];
      let doctrine: DoctrineId | null = null;
      if (pair) {
        doctrine = c.doctrine && pair.includes(c.doctrine) ? c.doctrine : pair[0];
        p.doctrines.push(doctrine);
      }
      const gain = baseHpFor(p, n) - p.baseMax;
      p.baseMax = baseHpFor(p, n);
      p.baseHp = Math.min(p.baseMax, p.baseHp + gain);
      p.specialCd = 0;
      // Queued old-era units still come out — they were paid for.
      s.events.push({ t: "evolve", side, era: n, doctrine });
      s.events.push({ t: "specialReady", side });
      return;
    }
    case "turret": {
      const old = p.turrets[c.slot];
      if (old) p.gold += Math.floor(TURRETS[old.kind].cost * SELL_REFUND);
      p.gold -= TURRETS[c.kind].cost;
      p.turrets[c.slot] = { kind: c.kind, cd: 10, lastShot: -99 };
      s.events.push({ t: "turret", side, slot: c.slot, kind: c.kind });
      return;
    }
    case "sell": {
      const old = p.turrets[c.slot]!;
      p.gold += Math.floor(TURRETS[old.kind].cost * SELL_REFUND);
      p.turrets[c.slot] = null;
      s.events.push({ t: "sell", side, slot: c.slot });
      return;
    }
    case "slot":
      p.gold -= SLOT_COST[p.slots];
      s.events.push({ t: "slot", side, slot: p.slots });
      p.slots++;
      return;
    case "special":
      castSpecial(s, side);
      return;
  }
}

function enemiesOf(s: EraMarchState, side: Side): Unit[] {
  return s.units.filter((u) => u.side !== side);
}

function castSpecial(s: EraMarchState, side: Side) {
  const p = s.players[side];
  const era = p.era;
  const foe: Side = side === 0 ? 1 : 0;
  p.specialCd = specialCdMax(p);
  p.stats.specials++;
  s.events.push({ t: "special", side, era });
  const enemies = enemiesOf(s, side);
  const d = dirOf(side);
  switch (era) {
    case 0: // mammoth stampede: sweeps from my base toward theirs
      s.sweeps.push({ side, x: wallX(side), vx: d * 22, end: wallX(foe), dmg: 75, stun: 24, push: 90, hit: [], era });
      return;
    case 1: {
      // catapult volley on the densest enemy pack
      let bestX = enemies.length ? enemies[0].x : fromProgress(side, LANE * 0.65);
      let bestN = -1;
      for (const e of enemies) {
        const n = enemies.filter((o) => Math.abs(o.x - e.x) <= 60).length;
        if (n > bestN) [bestN, bestX] = [n, e.x];
      }
      for (let i = 0; i < 3; i++) s.strikes.push({ at: s.tick, due: s.tick + 18 + i * 9, side, x: bestX + d * (i - 1) * 25, radius: 62, dmg: 160, stun: 6, push: 12, target: -1, era });
      return;
    }
    case 2: {
      // naval fire: up to 6 random enemies
      const pool = [...enemies];
      for (let i = 0; i < 6 && pool.length; i++) {
        const k = Math.floor(nextRandom(s) * pool.length);
        const [e] = pool.splice(k, 1);
        s.strikes.push({ at: s.tick, due: s.tick + 16 + i * 5, side, x: e.x, radius: 18, dmg: 560, stun: 8, push: 0, target: e.id, era });
      }
      return;
    }
    case 3: {
      // airship bombing run: starts above my front
      const start = fromProgress(side, Math.max(SPAWN_X, frontProgress(s, side) - 40));
      s.sweeps.push({ side, x: start, vx: d * 9, end: wallX(foe), dmg: 900, stun: 10, push: 20, hit: [], era });
      return;
    }
    case 4:
      for (const e of enemies) s.strikes.push({ at: s.tick, due: s.tick + 10, side, x: e.x, radius: 0, dmg: 1300, stun: 60, push: 0, target: e.id, era });
      s.players[foe].jammed = 60;
      s.strikes.push({ at: s.tick, due: s.tick + 10, side, x: fromProgress(side, LANE / 2), radius: 0, dmg: 0, stun: 0, push: 0, target: -2, era });
      return;
  }
}

/** Damage `dmg` of `role` deals to unit `u` (role matchup + the defender's doctrines). */
function damageTo(s: EraMarchState, u: Unit, dmg: number, role: Role | "turret" | "special"): number {
  const def = UNITS[u.kind];
  const owner = s.players[u.side];
  let m = role === "turret" || role === "special" ? 1 : roleMul(role, def.role);
  if (def.role === "melee" && has(owner, "shield")) m *= 0.8;
  if ((def.role === "ranged" || def.role === "support") && has(owner, "network")) m *= 0.75;
  return Math.max(1, Math.round(dmg * m));
}

interface Dmg {
  u: Unit;
  amt: number;
  by: Side;
  fx: Fx;
  mul: number;
}

function hitUnit(s: EraMarchState, out: Dmg[], u: Unit, raw: number, role: Role | "turret" | "special", by: Side, fx: Fx) {
  const amt = damageTo(s, u, raw, role);
  const mul = role === "turret" || role === "special" ? 1 : roleMul(role, UNITS[u.kind].role);
  out.push({ u, amt, by, fx, mul });
}

function splashAround(s: EraMarchState, out: Dmg[], side: Side, x: number, radius: number, raw: number, role: Role | "turret" | "special", fx: Fx, skip?: Unit) {
  for (const e of s.units) {
    if (e.side === side || e === skip || e.hp <= 0) continue;
    if (Math.abs(e.x - x) <= radius) hitUnit(s, out, e, raw, role, side, fx);
  }
}

function damageBase(s: EraMarchState, side: Side, raw: number, fx: Fx, by: Side) {
  const p = s.players[side];
  const amt = Math.max(1, Math.round(raw));
  p.baseHp = Math.max(0, p.baseHp - amt);
  s.players[by].stats.damage += amt;
  s.events.push({ t: "hit", side, id: -1, x: wallX(side), dmg: amt, fx, mul: 1, base: true });
}

const PROJ_SPEED = 32; // lane units per tick

export function stepGame(s: EraMarchState, cmds: readonly SeatCommand[]): void {
  s.events = [];
  if (s.winner !== null) return;
  s.tick++;

  for (const c of cmds) applyCommand(s, c.side, c.cmd);

  // 1. production
  for (const side of [0, 1] as const) {
    const p = s.players[side];
    const q = p.queue[0];
    if (!q) continue;
    if (q.left > 0) q.left--;
    if (q.left > 0) continue;
    if (popOf(s, side) >= POP_CAP) continue;
    const spawnX = fromProgress(side, SPAWN_X);
    if (s.units.some((u) => u.side === side && progress(side, u.x) < SPAWN_X + ALLY_GAP)) continue;
    p.queue.shift();
    const def = UNITS[q.kind];
    const hp = Math.round(def.hp * hpMul(p, q.kind));
    const u: Unit = { id: s.nextId++, side, kind: q.kind, x: spawnX, hp, maxHp: hp, cd: Math.round(def.cdTicks * 0.4), stun: 0, lastAtk: -99, moving: false };
    s.units.push(u);
    p.stats.trained++;
    s.events.push({ t: "spawn", side, id: u.id, kind: u.kind });
  }

  // Fronts as of the start of this tick (sorted by progress, front first).
  const bySide: [Unit[], Unit[]] = [[], []];
  for (const u of s.units) bySide[u.side].push(u);
  for (const side of [0, 1] as const) bySide[side].sort((a, b) => progress(side, b.x) - progress(side, a.x) || a.id - b.id);

  const dmgs: Dmg[] = [];
  const attacking = new Set<number>();

  // 2. unit attacks (decided on the start-of-tick picture)
  const order = [...s.units].sort((a, b) => a.id - b.id);
  for (const u of order) {
    if (u.cd > 0) u.cd--;
    if (u.stun > 0) {
      u.stun--;
      attacking.add(u.id);
      continue;
    }
    const p = s.players[u.side];
    const def = UNITS[u.kind];
    const foe: Side = u.side === 0 ? 1 : 0;
    const range = unitRange(p, u.kind);
    if (def.role === "support") {
      // heal the frontmost damaged ally ahead within range
      const ally = bySide[u.side].find((a) => a !== u && a.hp < a.maxHp && progress(u.side, a.x) >= progress(u.side, u.x) - 10 && Math.abs(a.x - u.x) <= range);
      const enemyFront = bySide[foe][0];
      const busy = !!enemyFront && Math.abs(enemyFront.x - u.x) <= range + 40;
      if (ally && busy) {
        attacking.add(u.id);
        if (u.cd === 0) {
          u.cd = def.cdTicks;
          u.lastAtk = s.tick;
          const amt = Math.min(def.atk, ally.maxHp - ally.hp);
          ally.hp += amt;
          s.events.push({ t: "shot", side: u.side, from: u.x, to: ally.x, fx: "heal", ticks: 6, turret: -1, id: u.id, base: false });
          s.events.push({ t: "heal", side: u.side, x: ally.x, amt });
        }
      } else if (busy) attacking.add(u.id);
      continue;
    }
    const enemy = bySide[foe][0];
    const enemyDist = enemy ? Math.abs(enemy.x - u.x) : Infinity;
    const baseDist = Math.abs(wallX(foe) - u.x);
    let target: Unit | "base" | null = null;
    if (enemy && enemyDist <= range + (def.range <= 30 ? CONTACT_GAP : 0)) target = enemy;
    else if (baseDist <= range + 6) target = "base";
    if (!target) continue;
    attacking.add(u.id);
    if (u.cd > 0) continue;
    u.cd = def.cdTicks;
    u.lastAtk = s.tick;
    const tx = target === "base" ? wallX(foe) : target.x;
    const ranged = def.range > 30;
    if (ranged) {
      const ticks = Math.max(2, Math.ceil(Math.abs(tx - u.x) / PROJ_SPEED));
      s.hits.push({ due: s.tick + ticks, side: u.side, target: target === "base" ? -1 : target.id, x: tx, dmg: Math.round(def.atk * atkMul(p)), role: def.role, fx: def.fx, splash: def.splash ?? 0, siege: def.siege ?? 1, steal: def.steal ?? 0, kind: u.kind });
      s.events.push({ t: "shot", side: u.side, from: u.x, to: tx, fx: def.fx, ticks, turret: -1, id: u.id, base: target === "base" });
    } else {
      s.events.push({ t: "swing", side: u.side, id: u.id, kind: u.kind });
      if (target === "base") damageBase(s, foe, def.atk * atkMul(p) * (def.siege ?? 1), def.fx, u.side);
      else {
        hitUnit(s, dmgs, target, def.atk * atkMul(p), def.role, u.side, def.fx);
        if (def.splash) splashAround(s, dmgs, u.side, target.x, def.splash, def.atk * atkMul(p) * 0.5, def.role, def.fx, target);
        if (def.steal) stealGold(s, u.side, def.steal, target.x);
      }
    }
  }

  // 3. turrets
  for (const side of [0, 1] as const) {
    const p = s.players[side];
    const foe: Side = side === 0 ? 1 : 0;
    if (p.jammed > 0) p.jammed--;
    const nearest = bySide[foe][bySide[foe].length - 1] ? closestToBase(bySide[foe], side) : null;
    p.turrets.forEach((t, slot) => {
      if (!t) return;
      if (t.cd > 0) t.cd--;
      if (p.jammed > 0 || t.cd > 0 || !nearest) return;
      const def = TURRETS[t.kind];
      const dist = Math.abs(nearest.x - wallX(side));
      if (dist > def.range) return;
      t.cd = def.cdTicks;
      t.lastShot = s.tick;
      const stand = dist <= LAST_STAND_RANGE ? LAST_STAND_MUL : 1;
      const from = fromProgress(side, 12);
      const ticks = Math.max(3, Math.ceil(Math.abs(nearest.x - from) / PROJ_SPEED));
      s.hits.push({ due: s.tick + ticks, side, target: nearest.id, x: nearest.x, dmg: Math.round(def.dmg * stand * (p.plan === "fortress" ? 1.15 : 1)), role: "turret", fx: def.fx, splash: def.splash ?? 0, siege: 1, steal: 0, kind: null });
      s.events.push({ t: "shot", side, from, to: nearest.x, fx: def.fx, ticks, turret: slot, id: -1, base: false });
    });
  }

  // 4. projectiles / strikes / sweeps landing this tick
  const alive = new Map(s.units.map((u) => [u.id, u]));
  s.hits = s.hits.filter((h) => {
    if (h.due > s.tick) return true;
    const foe: Side = h.side === 0 ? 1 : 0;
    if (h.target === -1) {
      damageBase(s, foe, h.dmg * h.siege, h.fx, h.side);
      return false;
    }
    const tu = alive.get(h.target);
    const at = tu && tu.hp > 0 ? tu.x : h.x;
    if (tu && tu.hp > 0) {
      hitUnit(s, dmgs, tu, h.dmg, h.role, h.side, h.fx);
      if (h.steal) stealGold(s, h.side, h.steal, at);
    } else if (!h.splash) {
      s.events.push({ t: "hit", side: foe, id: 0, x: at, dmg: 0, fx: h.fx, mul: 1, base: false });
    }
    if (h.splash) splashAround(s, dmgs, h.side, at, h.splash, h.dmg * 0.6, h.role, h.fx, tu);
    return false;
  });
  s.strikes = s.strikes.filter((k) => {
    if (k.due > s.tick) return true;
    if (k.target === -2) return false; // EMP visual anchor
    s.events.push({ t: "strike", side: k.side, x: k.x, radius: k.radius, era: k.era });
    const victims = k.target >= 0 ? [alive.get(k.target)].filter((u): u is Unit => !!u && u.hp > 0) : s.units.filter((u) => u.side !== k.side && Math.abs(u.x - k.x) <= k.radius);
    for (const v of victims) {
      hitUnit(s, dmgs, v, k.dmg, "special", k.side, "shell");
      v.stun = Math.max(v.stun, k.stun);
      if (k.push) v.x = clampLane(v.x + dirOf(k.side) * k.push, v.side);
    }
    return false;
  });
  s.sweeps = s.sweeps.filter((w) => {
    w.x += w.vx;
    s.events.push({ t: "sweep", side: w.side, x: w.x, era: w.era });
    for (const e of s.units) {
      if (e.side === w.side || w.hit.includes(e.id)) continue;
      if ((w.vx > 0 && e.x <= w.x) || (w.vx < 0 && e.x >= w.x)) {
        w.hit.push(e.id);
        hitUnit(s, dmgs, e, w.dmg, "special", w.side, w.era === 0 ? "gore" : "shell");
        e.stun = Math.max(e.stun, w.stun);
        if (w.push) e.x = clampLane(e.x + dirOf(w.side) * w.push, e.side);
        if (w.era === 3) s.events.push({ t: "strike", side: w.side, x: e.x, radius: 20, era: w.era });
      }
    }
    return w.vx > 0 ? w.x < w.end : w.x > w.end;
  });

  // 5. damage lands together
  for (const d of dmgs) {
    if (d.u.hp <= 0) continue;
    const real = Math.min(d.u.hp, d.amt);
    d.u.hp -= d.amt;
    s.players[d.by].stats.damage += real;
    s.events.push({ t: "hit", side: d.u.side, id: d.u.id, x: d.u.x, dmg: d.amt, fx: d.fx, mul: d.mul, base: false });
    if (d.u.hp <= 0) kill(s, d.u, d.by);
  }
  s.units = s.units.filter((u) => u.hp > 0);

  // 6. movement, front to back so each unit sees the updated unit ahead
  const live: [Unit[], Unit[]] = [[], []];
  for (const u of s.units) live[u.side].push(u);
  for (const side of [0, 1] as const) live[side].sort((a, b) => progress(side, b.x) - progress(side, a.x) || a.id - b.id);
  for (const side of [0, 1] as const) {
    const foe: Side = side === 0 ? 1 : 0;
    const enemyFront = live[foe][0];
    const enemyLimit = enemyFront ? LANE - progress(foe, enemyFront.x) - CONTACT_GAP : Infinity;
    const baseLimit = LANE - BASE_FRONT - 4;
    let aheadP = Infinity;
    for (const u of live[side]) {
      const p = progress(side, u.x);
      u.moving = false;
      if (!attacking.has(u.id) && u.stun <= 0) {
        const step = unitSpeed(s.players[side], u.kind) / TICKS_PER_SEC;
        const lim = Math.min(aheadP - ALLY_GAP, enemyLimit, baseLimit);
        const np = Math.min(p + step, lim);
        if (np > p + 0.01) {
          u.x = fromProgress(side, np);
          u.moving = true;
        }
      }
      aheadP = progress(side, u.x);
    }
  }

  // 7. economy, special timers, sudden death
  for (const side of [0, 1] as const) {
    const p = s.players[side];
    if (p.specialCd > 0 && --p.specialCd === 0) s.events.push({ t: "specialReady", side });
    if (s.tick % TICKS_PER_SEC === 0) {
      const inc = incomeOf(s, side);
      p.gold += inc;
      p.stats.goldEarned += inc;
      p.xp += Math.round(ERAS[p.era].income * PASSIVE_XP * xpMul(p));
    }
  }
  if (s.tick >= MATCH_TICKS) {
    if (!s.suddenDeath) {
      s.suddenDeath = true;
      s.events.push({ t: "suddenDeath" });
    }
    if (s.tick % TICKS_PER_SEC === 0) {
      for (const side of [0, 1] as const) {
        const p = s.players[side];
        p.baseHp = Math.max(0, p.baseHp - Math.ceil(p.baseMax * SUDDEN_DEATH_PCT));
      }
    }
  }

  // 8. result
  const dead0 = s.players[0].baseHp <= 0;
  const dead1 = s.players[1].baseHp <= 0;
  if (dead0 || dead1) {
    if (dead0 && dead1) {
      const r0 = s.players[0].baseHp / s.players[0].baseMax;
      const r1 = s.players[1].baseHp / s.players[1].baseMax;
      s.winner = r0 === r1 ? "draw" : r0 > r1 ? 0 : 1;
    } else s.winner = dead0 ? 1 : 0;
    s.events.push({ t: "end", winner: s.winner });
  }
}

function closestToBase(units: Unit[], baseSide: Side): Unit | null {
  let best: Unit | null = null;
  let bd = Infinity;
  for (const u of units) {
    const d = Math.abs(u.x - wallX(baseSide));
    if (d < bd || (d === bd && best && u.id < best.id)) [bd, best] = [d, u];
  }
  return best;
}

function clampLane(x: number, side: Side): number {
  // knocked-back units stay in front of their own base wall
  const p = Math.max(SPAWN_X - 10, Math.min(LANE - BASE_FRONT - 4, progress(side, x)));
  return fromProgress(side, p);
}

function stealGold(s: EraMarchState, thief: Side, amt: number, x: number) {
  const victim = s.players[thief === 0 ? 1 : 0];
  const got = Math.min(victim.gold, amt);
  if (got <= 0) return;
  victim.gold -= got;
  s.players[thief].gold += got;
  s.events.push({ t: "steal", side: thief, x, gold: got });
}

function kill(s: EraMarchState, u: Unit, by: Side) {
  const def = UNITS[u.kind];
  const killer = s.players[by];
  const bonus = def.era > killer.era;
  const gm = (bonus ? ERA_GAP_BONUS : 1) * (has(killer, "plunder") ? PLUNDER_GOLD : 1) * (killer.plan === "merchant" ? 1.1 : 1);
  const gold = Math.max(1, Math.round(def.cost * KILL_GOLD * gm));
  killer.gold += gold;
  killer.xp += Math.round(def.cost * KILL_XP * (bonus ? ERA_GAP_BONUS : 1) * xpMul(killer));
  killer.stats.kills++;
  killer.stats.goldEarned += gold;
  s.players[u.side].stats.lost++;
  s.events.push({ t: "death", side: u.side, id: u.id, kind: u.kind, x: u.x });
  s.events.push({ t: "bounty", side: by, x: u.x, gold, bonus });
}

/** Seconds left before sudden death (0 once it started). */
export function secondsLeft(s: EraMarchState): number {
  return Math.max(0, Math.ceil((MATCH_TICKS - s.tick) / TICKS_PER_SEC));
}

/** Best turret this side can build now in a slot, cheapest first within its era. */
export function turretChoices(p: PlayerState): TurretKind[] {
  const out: TurretKind[] = [];
  for (let e = 0; e <= p.era; e++) out.push(...ERA_TURRETS[e]);
  return out;
}
