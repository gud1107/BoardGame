/**
 * 랜덤 합성 디펜스 (Merge Defense) — pure simulation engine.
 *
 * Every seat owns a 5×3 board ringed by a looping road. The same waves walk
 * every road at the same time; units on the board shoot them automatically.
 * Summoning gives a random unit, two identical units (same kind + grade)
 * merge into ONE random unit of the next grade — the luck is in what comes
 * out. When the monsters on your road outweigh `LOAD_LIMIT` you're out; the
 * last board standing wins. Every `SEND_EVERY` kills drops an elite onto the
 * next living opponent's road, so a strong board pressures the others.
 *
 * Sync model: same as worm — the room host is the sole authority (calls
 * `stepGame` at a fixed 20Hz and broadcasts snapshots); other clients run
 * `stepGame` locally between snapshots purely for smooth motion and snap to
 * each snapshot when it arrives. All randomness goes through the seeded rng
 * stored IN the state (`state.rng`), never Math.random, so a client's local
 * prediction matches the host until a remote action arrives.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const TICK_MS = 50;
export const TICKS_PER_SEC = 1000 / TICK_MS;

/** Board geometry (logical units — the canvas scales this). */
export const BOARD_W = 400;
export const BOARD_H = 280;
export const COLS = 5;
export const ROWS = 3;
export const SLOTS = COLS * ROWS;
export const CELL = 60;
export const GRID_X = (BOARD_W - COLS * CELL) / 2; // 50
export const GRID_Y = (BOARD_H - ROWS * CELL) / 2; // 50
const ROAD_X0 = 20;
const ROAD_Y0 = 20;
const ROAD_X1 = BOARD_W - 20;
const ROAD_Y1 = BOARD_H - 20;
const ROAD_W = ROAD_X1 - ROAD_X0;
const ROAD_H = ROAD_Y1 - ROAD_Y0;
export const PATH_LEN = 2 * (ROAD_W + ROAD_H);
export const ROAD = { x0: ROAD_X0, y0: ROAD_Y0, x1: ROAD_X1, y1: ROAD_Y1 };

export const PREP_TICKS = 6 * TICKS_PER_SEC;
export const WAVE_TICKS = 20 * TICKS_PER_SEC;
const SPAWN_GAP = 12;
export const BOSS_EVERY = 5;
export const LOAD_LIMIT = 80;
export const SEND_EVERY = 12;
export const MAX_GRADE = 5;
export const MAX_UPGRADE = 10;
export const START_GOLD = 100;
export const START_GEMS = 1;
const MAX_EVENTS = 40;

export type SeatIndex = number;
export type UnitKind = "archer" | "mage" | "frost" | "thunder" | "poison";
export const UNIT_KINDS: UnitKind[] = ["archer", "mage", "frost", "thunder", "poison"];

export interface UnitDef {
  name: string;
  emoji: string;
  color: string;
  /** Damage per hit at grade 1, upgrade 0. */
  dmg: number;
  /** Ticks between attacks at grade 1. */
  interval: number;
  desc: string;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  archer: { name: "궁수", emoji: "🏹", color: "#f97316", dmg: 11, interval: 12, desc: "빠른 단일 공격" },
  mage: { name: "마법사", emoji: "🔮", color: "#a855f7", dmg: 9, interval: 22, desc: "범위 폭발" },
  frost: { name: "서리", emoji: "❄️", color: "#38bdf8", dmg: 6, interval: 18, desc: "둔화" },
  thunder: { name: "번개", emoji: "⚡", color: "#facc15", dmg: 8, interval: 20, desc: "연쇄 공격" },
  poison: { name: "독", emoji: "☠️", color: "#22c55e", dmg: 4, interval: 24, desc: "최대 체력 % 독 (보스 특효)" },
};

export const GRADE_NAMES = ["", "일반", "희귀", "영웅", "전설", "신화"];
export const GRADE_COLORS = ["", "#cbd5e1", "#38bdf8", "#a855f7", "#f59e0b", "#f43f5e"];
/** Damage multiplier per grade step. */
const GRADE_MULT = 2.5;
const UPGRADE_STEP = 0.15;

export interface Unit {
  kind: UnitKind;
  grade: number;
  /** Ticks until the next attack. */
  cd: number;
}

export type MobKind = "normal" | "fast" | "tank" | "boss" | "elite";

export interface Mob {
  id: number;
  kind: MobKind;
  hp: number;
  maxHp: number;
  /** Total distance travelled — position is `trav % PATH_LEN`; larger = older = targeted first. */
  trav: number;
  speed: number;
  weight: number;
  slowT: number;
  slowPct: number;
  poisonT: number;
  poisonDps: number;
  /** Seat that sent this elite (for colour/labels); -1 for wave mobs. */
  from: SeatIndex;
}

export interface Shot {
  slot: number;
  kind: UnitKind;
  grade: number;
  /** Hit positions flattened [x0, y0, x1, y1, …] — first is the main target. */
  pts: number[];
}

export interface Board {
  units: (Unit | null)[];
  mobs: Mob[];
  gold: number;
  gems: number;
  summons: number;
  upgrades: Record<UnitKind, number>;
  kills: number;
  sendMeter: number;
  alive: boolean;
  /** Tick of elimination (null while alive). */
  outAt: number | null;
  outWave: number;
  bot: boolean;
  /** Attacks fired during the most recent tick — for FX only. */
  shots: Shot[];
}

export type GameEvent =
  | { id: number; tick: number; seat: SeatIndex; type: "summon"; slot: number; grade: number; lucky: boolean }
  | { id: number; tick: number; seat: SeatIndex; type: "merge"; slot: number; grade: number }
  | { id: number; tick: number; seat: SeatIndex; type: "gamble"; slot: number; grade: number }
  | { id: number; tick: number; seat: SeatIndex; type: "gamble-fail" }
  | { id: number; tick: number; seat: SeatIndex; type: "upgrade"; kind: UnitKind; level: number }
  | { id: number; tick: number; seat: SeatIndex; type: "send"; to: SeatIndex }
  | { id: number; tick: number; seat: SeatIndex; type: "boss-kill" }
  | { id: number; tick: number; seat: SeatIndex; type: "out" }
  | { id: number; tick: number; seat: -1; type: "wave"; wave: number; boss: boolean };

export interface MergeDefenseState {
  phase: "playing" | "gameOver";
  playerCount: number;
  tick: number;
  /** 0 during the prep countdown, then 1, 2, … */
  wave: number;
  boards: Board[];
  rng: number;
  nextMobId: number;
  nextEventId: number;
  events: GameEvent[];
}

export type Action =
  | { type: "summon" }
  | { type: "gamble" }
  | { type: "merge"; a: number; b: number }
  | { type: "upgrade"; kind: UnitKind };

// ---------------------------------------------------------------------------
// RNG — mulberry32 over `state.rng`.
// ---------------------------------------------------------------------------

function rand(s: MergeDefenseState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(s: MergeDefenseState, list: readonly T[]): T {
  return list[Math.floor(rand(s) * list.length)];
}

// ---------------------------------------------------------------------------
// Geometry helpers (shared with the renderer).
// ---------------------------------------------------------------------------

/** Point on the road for a distance travelled (clockwise from top-left). */
export function pathPoint(trav: number): { x: number; y: number } {
  let d = trav % PATH_LEN;
  if (d < 0) d += PATH_LEN;
  if (d < ROAD_W) return { x: ROAD_X0 + d, y: ROAD_Y0 };
  d -= ROAD_W;
  if (d < ROAD_H) return { x: ROAD_X1, y: ROAD_Y0 + d };
  d -= ROAD_H;
  if (d < ROAD_W) return { x: ROAD_X1 - d, y: ROAD_Y1 };
  d -= ROAD_W;
  return { x: ROAD_X0, y: ROAD_Y1 - d };
}

export function slotCenter(slot: number): { x: number; y: number } {
  const c = slot % COLS;
  const r = Math.floor(slot / COLS);
  return { x: GRID_X + c * CELL + CELL / 2, y: GRID_Y + r * CELL + CELL / 2 };
}

// ---------------------------------------------------------------------------
// Economy / balance formulas.
// ---------------------------------------------------------------------------

export function summonCost(board: Board): number {
  return 20 + board.summons * 2;
}

export function upgradeCost(level: number): number {
  return 40 + level * 40;
}

export function waveHp(wave: number): number {
  return Math.round(28 * Math.pow(1.2, wave - 1));
}

export function killGold(kind: MobKind, wave: number): number {
  if (kind === "boss") return 40 + wave * 4;
  if (kind === "elite") return 4 + Math.floor(wave / 4);
  return 2 + Math.floor(wave / 6);
}

export function waveBonus(wave: number): number {
  return 20 + wave * 3;
}

export function fieldLoad(board: Board): number {
  let load = 0;
  for (const m of board.mobs) load += m.weight;
  return load;
}

export function unitDamage(unit: Unit, board: Board): number {
  return UNITS[unit.kind].dmg * Math.pow(GRADE_MULT, unit.grade - 1) * (1 + UPGRADE_STEP * board.upgrades[unit.kind]);
}

export function unitInterval(unit: Unit): number {
  return Math.max(4, Math.round(UNITS[unit.kind].interval * (1 - 0.07 * (unit.grade - 1))));
}

export function waveCount(wave: number): number {
  return 12 + Math.floor(wave * 0.5);
}

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % BOSS_EVERY === 0;
}

// ---------------------------------------------------------------------------
// Setup.
// ---------------------------------------------------------------------------

function emptyBoard(bot: boolean): Board {
  return {
    units: Array.from({ length: SLOTS }, () => null),
    mobs: [],
    gold: START_GOLD,
    gems: START_GEMS,
    summons: 0,
    upgrades: { archer: 0, mage: 0, frost: 0, thunder: 0, poison: 0 },
    kills: 0,
    sendMeter: 0,
    alive: true,
    outAt: null,
    outWave: 0,
    bot,
    shots: [],
  };
}

export function startGame(playerCount: number, seed: number, botSeats: readonly number[] = []): MergeDefenseState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  return {
    phase: "playing",
    playerCount: n,
    tick: 0,
    wave: 0,
    boards: Array.from({ length: n }, (_, seat) => emptyBoard(botSeats.includes(seat))),
    rng: seed | 0,
    nextMobId: 1,
    nextEventId: 1,
    events: [],
  };
}

function cloneState(s: MergeDefenseState): MergeDefenseState {
  return {
    ...s,
    boards: s.boards.map((b) => ({
      ...b,
      units: b.units.map((u) => (u ? { ...u } : null)),
      mobs: b.mobs.map((m) => ({ ...m })),
      upgrades: { ...b.upgrades },
      shots: [],
    })),
    events: s.events.slice(),
  };
}

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id" | "tick"> : never) : never;

function pushEvent(s: MergeDefenseState, ev: EventBody) {
  s.events.push({ ...ev, id: s.nextEventId++, tick: s.tick } as GameEvent);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

function emptySlots(board: Board): number[] {
  const out: number[] = [];
  board.units.forEach((u, i) => {
    if (!u) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Player actions.
// ---------------------------------------------------------------------------

export function sanitizeAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.type === "summon" || a.type === "gamble") return { type: a.type };
  if (a.type === "merge" && Number.isInteger(a.a) && Number.isInteger(a.b)) {
    const x = a.a as number;
    const y = a.b as number;
    if (x < 0 || y < 0 || x >= SLOTS || y >= SLOTS || x === y) return null;
    return { type: "merge", a: x, b: y };
  }
  if (a.type === "upgrade" && UNIT_KINDS.includes(a.kind as UnitKind)) return { type: "upgrade", kind: a.kind as UnitKind };
  return null;
}

export function canMerge(board: Board, a: number, b: number): boolean {
  const ua = board.units[a];
  const ub = board.units[b];
  return !!ua && !!ub && a !== b && ua.kind === ub.kind && ua.grade === ub.grade && ua.grade < MAX_GRADE;
}

/** Applies one action for `seat`. Invalid / unaffordable actions are ignored (returns the same state). */
export function applyAction(state: MergeDefenseState, seat: SeatIndex, action: Action): MergeDefenseState {
  if (state.phase !== "playing") return state;
  const cur = state.boards[seat];
  if (!cur || !cur.alive) return state;

  if (action.type === "summon") {
    if (cur.gold < summonCost(cur) || emptySlots(cur).length === 0) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gold -= summonCost(board);
    board.summons += 1;
    const slot = pick(s, emptySlots(board));
    const lucky = rand(s) < 0.06;
    const grade = lucky ? 2 : 1;
    board.units[slot] = { kind: pick(s, UNIT_KINDS), grade, cd: 0 };
    pushEvent(s, { seat, type: "summon", slot, grade, lucky });
    return s;
  }

  if (action.type === "gamble") {
    if (cur.gems < 1 || emptySlots(cur).length === 0) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    board.gems -= 1;
    const r = rand(s);
    const grade = r < 0.2 ? 0 : r < 0.68 ? 2 : r < 0.94 ? 3 : 4;
    if (grade === 0) {
      pushEvent(s, { seat, type: "gamble-fail" });
      return s;
    }
    const slot = pick(s, emptySlots(board));
    board.units[slot] = { kind: pick(s, UNIT_KINDS), grade, cd: 0 };
    pushEvent(s, { seat, type: "gamble", slot, grade });
    return s;
  }

  if (action.type === "merge") {
    if (!canMerge(cur, action.a, action.b)) return state;
    const s = cloneState(state);
    const board = s.boards[seat];
    const grade = board.units[action.a]!.grade + 1;
    board.units[action.a] = null;
    board.units[action.b] = { kind: pick(s, UNIT_KINDS), grade, cd: 0 };
    pushEvent(s, { seat, type: "merge", slot: action.b, grade });
    return s;
  }

  // upgrade
  const level = cur.upgrades[action.kind];
  if (level >= MAX_UPGRADE || cur.gold < upgradeCost(level)) return state;
  const s = cloneState(state);
  const board = s.boards[seat];
  board.gold -= upgradeCost(level);
  board.upgrades[action.kind] = level + 1;
  pushEvent(s, { seat, type: "upgrade", kind: action.kind, level: level + 1 });
  return s;
}

// ---------------------------------------------------------------------------
// Simulation step.
// ---------------------------------------------------------------------------

function makeMob(s: MergeDefenseState, kind: MobKind, wave: number, from: SeatIndex = -1): Mob {
  const base = waveHp(Math.max(1, wave));
  const spec: Record<MobKind, { hp: number; speed: number; weight: number }> = {
    normal: { hp: 1, speed: 60, weight: 1 },
    fast: { hp: 0.6, speed: 105, weight: 1 },
    tank: { hp: 2.8, speed: 40, weight: 2 },
    boss: { hp: 45, speed: 32, weight: 15 },
    elite: { hp: 4, speed: 70, weight: 3 },
  };
  const k = spec[kind];
  const hp = Math.round(base * k.hp);
  return { id: s.nextMobId++, kind, hp, maxHp: hp, trav: 0, speed: k.speed, weight: k.weight, slowT: 0, slowPct: 0, poisonT: 0, poisonDps: 0, from };
}

function spawnKindFor(wave: number, index: number): MobKind {
  if (wave >= 6 && index % 5 === 4) return "tank";
  if (wave >= 3 && index % 4 === 2) return "fast";
  return "normal";
}

function spawnWaves(s: MergeDefenseState) {
  if (s.tick < PREP_TICKS) return;
  const t = s.tick - PREP_TICKS;
  const wave = Math.floor(t / WAVE_TICKS) + 1;
  const inWave = t % WAVE_TICKS;
  if (inWave === 0) {
    s.wave = wave;
    const boss = isBossWave(wave);
    pushEvent(s, { seat: -1, type: "wave", wave, boss });
    for (const board of s.boards) {
      if (!board.alive) continue;
      if (wave > 1) board.gold += waveBonus(wave - 1);
      if (boss) board.mobs.push(makeMob(s, "boss", wave));
    }
  }
  if (inWave % SPAWN_GAP !== 0) return;
  const index = inWave / SPAWN_GAP;
  const count = isBossWave(wave) ? Math.floor(waveCount(wave) / 2) : waveCount(wave);
  if (index >= count) return;
  const kind = spawnKindFor(wave, index);
  for (const board of s.boards) {
    if (board.alive) board.mobs.push(makeMob(s, kind, wave));
  }
}

function damage(mob: Mob, amount: number) {
  mob.hp -= amount;
}

function attack(s: MergeDefenseState, board: Board, slot: number, unit: Unit, ordered: Mob[]) {
  const target = ordered[0];
  const dmg = unitDamage(unit, board);
  const hits: number[] = [target.id];
  switch (unit.kind) {
    case "archer":
      damage(target, dmg);
      if (unit.grade >= 3 && ordered[1]) {
        damage(ordered[1], dmg * 0.6);
        hits.push(ordered[1].id);
      }
      break;
    case "mage": {
      const radius = 55 + unit.grade * 5;
      for (const m of ordered) {
        let gap = Math.abs((m.trav % PATH_LEN) - (target.trav % PATH_LEN));
        gap = Math.min(gap, PATH_LEN - gap);
        if (gap <= radius) {
          damage(m, dmg);
          if (m !== target) hits.push(m.id);
        }
      }
      break;
    }
    case "frost": {
      const pct = Math.min(0.7, 0.35 + unit.grade * 0.07);
      damage(target, dmg);
      target.slowT = Math.max(target.slowT, 40);
      target.slowPct = Math.max(target.slowPct, target.kind === "boss" ? pct / 2 : pct);
      break;
    }
    case "thunder": {
      const chain = 2 + Math.floor(unit.grade / 2);
      ordered.slice(0, chain + 1).forEach((m, i) => {
        damage(m, dmg * (i === 0 ? 1 : 0.7));
        if (i > 0) hits.push(m.id);
      });
      break;
    }
    case "poison": {
      damage(target, dmg);
      const pct = 0.025 + unit.grade * 0.01;
      const cap = dmg * 6;
      target.poisonDps = Math.max(target.poisonDps, Math.min(target.maxHp * pct, cap));
      target.poisonT = 60;
      break;
    }
  }
  const pts: number[] = [];
  for (const id of hits) {
    const m = ordered.find((o) => o.id === id);
    if (!m) continue;
    const p = pathPoint(m.trav);
    pts.push(Math.round(p.x), Math.round(p.y));
  }
  board.shots.push({ slot, kind: unit.kind, grade: unit.grade, pts });
  void s;
}

function nextAliveOpponent(s: MergeDefenseState, seat: SeatIndex): SeatIndex | null {
  for (let i = 1; i < s.playerCount; i++) {
    const other = (seat + i) % s.playerCount;
    if (s.boards[other].alive) return other;
  }
  return null;
}

export function stepGame(state: MergeDefenseState): MergeDefenseState {
  if (state.phase !== "playing") return state;
  const s = cloneState(state);
  s.tick += 1;
  spawnWaves(s);

  const sends: { from: SeatIndex; to: SeatIndex }[] = [];

  s.boards.forEach((board, seat) => {
    if (!board.alive) return;

    // Movement + status effects.
    for (const m of board.mobs) {
      const slow = m.slowT > 0 ? m.slowPct : 0;
      m.trav += (m.speed * (1 - slow)) / TICKS_PER_SEC;
      if (m.slowT > 0) m.slowT -= 1;
      if (m.slowT === 0) m.slowPct = 0;
      if (m.poisonT > 0) {
        damage(m, m.poisonDps / TICKS_PER_SEC);
        m.poisonT -= 1;
        if (m.poisonT === 0) m.poisonDps = 0;
      }
    }

    // Attacks — oldest mob first.
    const ordered = board.mobs.filter((m) => m.hp > 0).sort((a, b) => b.trav - a.trav);
    board.units.forEach((unit, slot) => {
      if (!unit) return;
      if (unit.cd > 0) unit.cd -= 1;
      if (unit.cd > 0) return;
      const live = ordered.length > 0 && ordered[0].hp <= 0 ? ordered.filter((m) => m.hp > 0) : ordered;
      if (live.length === 0) return;
      attack(s, board, slot, unit, live);
      unit.cd = unitInterval(unit);
      if (live !== ordered) {
        ordered.length = 0;
        ordered.push(...live);
      }
    });

    // Deaths + rewards.
    const survivors: Mob[] = [];
    for (const m of board.mobs) {
      if (m.hp > 0) {
        survivors.push(m);
        continue;
      }
      board.kills += 1;
      board.gold += killGold(m.kind, s.wave);
      if (m.kind === "boss") {
        board.gems += 2;
        pushEvent(s, { seat, type: "boss-kill" });
      }
      board.sendMeter += 1;
      if (board.sendMeter >= SEND_EVERY) {
        board.sendMeter = 0;
        const to = nextAliveOpponent(s, seat);
        if (to !== null) sends.push({ from: seat, to });
      }
    }
    board.mobs = survivors;
  });

  for (const { from, to } of sends) {
    if (!s.boards[to].alive) continue;
    s.boards[to].mobs.push(makeMob(s, "elite", Math.max(1, s.wave), from));
    pushEvent(s, { seat: from, type: "send", to });
  }

  // Eliminations — everyone over the limit this tick goes out together.
  const out: SeatIndex[] = [];
  s.boards.forEach((board, seat) => {
    if (board.alive && fieldLoad(board) >= LOAD_LIMIT) out.push(seat);
  });
  const aliveBefore = s.boards.filter((b) => b.alive).length;
  if (out.length > 0 && out.length === aliveBefore) {
    // Nobody may go out leaving zero survivors: everyone left ties for 1st.
    s.phase = "gameOver";
    return s;
  }
  for (const seat of out) {
    const board = s.boards[seat];
    board.alive = false;
    board.outAt = s.tick;
    board.outWave = s.wave;
    pushEvent(s, { seat, type: "out" });
  }
  if (s.boards.filter((b) => b.alive).length <= 1) s.phase = "gameOver";
  return s;
}

// ---------------------------------------------------------------------------
// Rankings.
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: SeatIndex;
  rank: number;
  wave: number;
  kills: number;
}

/** Survivors rank first; then later elimination is better; same-tick eliminations tie-break on kills. */
export function computeRankings(state: MergeDefenseState): RankedSeat[] {
  const rows = state.boards.map((b, seat) => ({
    seat,
    out: b.alive ? Number.POSITIVE_INFINITY : (b.outAt ?? 0),
    wave: b.alive ? state.wave : b.outWave,
    kills: b.kills,
  }));
  const sorted = [...rows].sort((a, b) => b.out - a.out || b.kills - a.kills);
  const ranked: RankedSeat[] = [];
  let rank = 1;
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    if (i > 0 && (prev.out !== r.out || prev.kills !== r.kills)) rank = i + 1;
    ranked.push({ seat: r.seat, rank, wave: r.wave, kills: r.kills });
  });
  return ranked;
}

// ---------------------------------------------------------------------------
// Bot.
// ---------------------------------------------------------------------------

/** Pairs of slots holding identical units, lowest grade first. */
export function mergePairs(board: Board): [number, number][] {
  const pairs: [number, number][] = [];
  const used = new Set<number>();
  const order = board.units
    .map((u, i) => ({ u, i }))
    .filter((x): x is { u: Unit; i: number } => !!x.u && x.u.grade < MAX_GRADE)
    .sort((a, b) => a.u.grade - b.u.grade);
  for (const { u, i } of order) {
    if (used.has(i)) continue;
    const match = order.find((o) => o.i !== i && !used.has(o.i) && o.u.kind === u.kind && o.u.grade === u.grade);
    if (match) {
      used.add(i);
      used.add(match.i);
      pairs.push([i, match.i]);
    }
  }
  return pairs;
}

/** A simple greedy bot: gamble gems, fill the board, merge when full, upgrade with spare gold. */
export function chooseBotAction(state: MergeDefenseState, seat: SeatIndex): Action | null {
  const board = state.boards[seat];
  if (!board || !board.alive || state.phase !== "playing") return null;
  const free = emptySlots(board).length;
  const cost = summonCost(board);
  if (board.gems >= 1 && free > 0) return { type: "gamble" };
  if (free > 0 && board.gold >= cost) return { type: "summon" };
  const pairs = mergePairs(board);
  if (free === 0 && pairs.length > 0) return { type: "merge", a: pairs[0][0], b: pairs[0][1] };
  // Spare gold → upgrade the kind with the most total grade on board.
  const weight: Record<UnitKind, number> = { archer: 0, mage: 0, frost: 0, thunder: 0, poison: 0 };
  for (const u of board.units) if (u) weight[u.kind] += Math.pow(GRADE_MULT, u.grade - 1);
  const best = [...UNIT_KINDS].filter((k) => board.upgrades[k] < MAX_UPGRADE).sort((a, b) => weight[b] - weight[a])[0];
  if (best && weight[best] > 0 && board.gold >= upgradeCost(board.upgrades[best]) && (free === 0 || board.gold >= cost + upgradeCost(board.upgrades[best]))) {
    return { type: "upgrade", kind: best };
  }
  return null;
}
