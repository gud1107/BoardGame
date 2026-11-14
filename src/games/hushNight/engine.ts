import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";

/**
 * 숨죽인 밤 — pure rules (rulebook: boardGameRule/숨죽인밤/숨죽인밤.md).
 *
 * 2–4 rivals sneak around a dark 7×7 house collecting keys and carrying them
 * to the cellar hatch in the middle of the house. Every round everyone secretly commits a move (hash),
 * then reveals it; moves resolve at once. Each move makes noise — hush 0,
 * walk 1, run 3, and a thrown pebble makes 4 where it lands. The blind
 * monster then lumbers toward the loudest thing it heard and catches anyone
 * on its path: they drop the keys they carry and wake up back at their start.
 * Only keys carried down the hatch score.
 *
 * Commit–reveal keeps the simultaneous choice secret on the wire; positions,
 * keys and the monster are public.
 */

export type Seat = number;
export type Cell = number; // y * W + x

export const W = 7;
export const H = 7;
export const MIN_PLAYERS = 2;
/** Only the four corners are equally far from the hatch — a 5th seat measured 4–7% wins (rulebook §9). */
export const MAX_PLAYERS = 4;
export const CARRY_MAX = 3;
export const PEBBLES = 2;
export const THROW_RANGE = 4;
/** Keys per player, laid out identically (mirrored) in each player's quarter of the house. */
export const KEYS_PER_SEAT = 3;
export const NOISE = { hush: 0, walk: 1, run: 3, throw: 4, key: 1, door: 1 } as const;
/** A sound of level L is heard up to L × HEAR_PER_LEVEL steps away (path distance). */
export const HEAR_PER_LEVEL = 2;
export const MONSTER_SPEED = 2;
/** The monster sleeps through the first round(s) — it only starts moving from this round. */
export const WAKE_ROUND = 2;
export const RAGE_SPEED = 3;
export const CHOOSE_MS = 30_000;
export const REVEAL_MS = 6_000;
export const RESOLVED_MS = 4_000;

export type RoundCount = 10 | 14;
export const ROUND_CHOICES: RoundCount[] = [10, 14];
export interface GameOptions {
  rounds: RoundCount;
  /** 🔰 show what the monster will hear from each choice. */
  helper: boolean;
}
export const DEFAULT_OPTIONS: GameOptions = { rounds: 14, helper: true };
export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  return { rounds: o?.rounds === 10 ? 10 : 14, helper: o?.helper !== false };
}
/** The monster gets faster for the last third of the night. */
export const rageFrom = (rounds: number) => Math.ceil((rounds * 2) / 3);

export const xy = (c: Cell) => ({ x: c % W, y: Math.floor(c / W) });
export const cellAt = (x: number, y: number): Cell => y * W + x;
/** The cellar hatch in the middle of the house — where keys are carried out, and where the monster rises from. */
export const EXIT: Cell = cellAt(3, 3);
export const LAIR: Cell = EXIT;
const START_CELLS: Cell[] = [cellAt(0, 0), cellAt(6, 6), cellAt(6, 0), cellAt(0, 6)];
export const startOf = (seat: Seat): Cell => START_CELLS[seat % START_CELLS.length];

/**
 * Furniture layouts (blocked cells). Each is symmetric under every rotation and
 * mirror of the square (D4) — a merely mirror-symmetric layout still favoured
 * one 3-player corner by 13 points in self-play. One is picked by the seed.
 */
export const LAYOUTS: [number, number][][] = [
  [[1, 1], [5, 1], [1, 5], [5, 5], [2, 2], [4, 2], [2, 4], [4, 4]],
  [[2, 1], [4, 1], [1, 2], [1, 4], [5, 2], [5, 4], [2, 5], [4, 5]],
  [[1, 1], [2, 1], [1, 2], [5, 1], [4, 1], [5, 2], [1, 5], [2, 5], [1, 4], [5, 5], [4, 5], [5, 4]],
];

export type Move = { kind: "hush" } | { kind: "walk"; to: Cell } | { kind: "run"; to: Cell } | { kind: "throw"; to: Cell };
export type MoveKind = Move["kind"];

export interface SeatState {
  at: Cell;
  carry: number;
  banked: number;
  pebbles: number;
  caught: number;
}

export interface NoiseEvent {
  at: Cell;
  level: number;
  seat: Seat;
  why: "walk" | "run" | "throw" | "key" | "door";
}

export interface RoundReport {
  round: number;
  moves: Move[];
  from: Cell[];
  noises: NoiseEvent[];
  monsterFrom: Cell;
  monsterPath: Cell[];
  /** The sound the monster went for (null = it heard nothing). */
  target: NoiseEvent | null;
  caught: Seat[];
  picked: Seat[];
  bankedNow: { seat: Seat; keys: number }[];
}

export interface NightState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  blocked: Cell[];
  keys: Cell[];
  seats: SeatState[];
  monster: Cell;
  /** Where the monster last heard something (it keeps heading there in silence). */
  lastHeard: Cell | null;
  round: number;
  phase: "choose" | "reveal" | "resolved" | "ended";
  step: number;
  /** Hash, or "x" = no commit (timed out → hush). */
  commits: (string | null)[];
  moves: (Move | null)[];
  last: RoundReport | null;
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "commit"; seat: Seat; step: number; hash: string }
  | { type: "reveal"; seat: Seat; step: number; move: Move; salt: string }
  | { type: "advance"; step: number };

/* ── helpers ──────────────────────────────────────────────────────── */

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function moveHash(move: Move, salt: string): string {
  const body = `${move.kind}:${"to" in move ? move.to : "-"}`;
  return `${cyrb53(body + "|" + salt, 7)}${cyrb53(salt + "|" + body, 13)}`;
}

export function neighbors(c: Cell, blocked: ReadonlySet<Cell>): Cell[] {
  const { x, y } = xy(c);
  const out: Cell[] = [];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = cellAt(nx, ny);
    if (!blocked.has(n)) out.push(n);
  }
  return out;
}

/** BFS distances from `from` over open cells. */
export function distances(from: Cell, blocked: ReadonlySet<Cell>): number[] {
  const d = Array(W * H).fill(Infinity);
  d[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    for (const n of neighbors(q[i], blocked)) {
      if (d[n] === Infinity) {
        d[n] = d[q[i]] + 1;
        q.push(n);
      }
    }
  }
  return d;
}

/**
 * A shortest path from → to (excluding `from`). Equal next steps are broken by
 * `rng` when given (the monster — a fixed neighbour order drifted it one way
 * and skewed seat win rates), else by neighbour order.
 */
export function pathTo(from: Cell, to: Cell, blocked: ReadonlySet<Cell>, rng?: () => number): Cell[] {
  if (from === to) return [];
  const back = distances(to, blocked);
  if (back[from] === Infinity) return [];
  const out: Cell[] = [];
  let cur = from;
  while (cur !== to) {
    const opts = neighbors(cur, blocked).filter((n) => back[n] === back[cur] - 1);
    const next = rng && opts.length > 1 ? opts[Math.floor(rng() * opts.length)] : opts[0];
    out.push(next);
    cur = next;
  }
  return out;
}

export const manhattan = (a: Cell, b: Cell) => Math.abs(xy(a).x - xy(b).x) + Math.abs(xy(a).y - xy(b).y);
export const blockedSet = (s: NightState) => new Set(s.blocked);

/* ── setup ─────────────────────────────────────────────────────────── */

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): NightState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts = sanitizeOptions(options);
  const rng = seededRng((seed ^ 0x4a5e) | 0);
  const blocked = LAYOUTS[Math.floor(rng() * LAYOUTS.length)].map(([x, y]) => cellAt(x, y));
  const bs = new Set(blocked);
  // keys: picked in the top-left quarter, then mirrored into every seat's quarter, so each
  // player has the same keys around them and an empty corner feeds nobody (rulebook §2)
  const quarter: Cell[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (!bs.has(cellAt(x, y)) && x + y >= 2) quarter.push(cellAt(x, y));
  const mine = shuffle(quarter, rng).slice(0, KEYS_PER_SEAT);
  const keys: Cell[] = [];
  for (let seat = 0; seat < n; seat++) {
    const st = xy(startOf(seat));
    for (const c of mine) {
      const { x, y } = xy(c);
      keys.push(cellAt(st.x === 0 ? x : W - 1 - x, st.y === 0 ? y : H - 1 - y));
    }
  }
  return {
    seed,
    playerCount: n,
    options: opts,
    blocked,
    keys,
    seats: Array.from({ length: n }, (_, i) => ({ at: startOf(i), carry: 0, banked: 0, pebbles: PEBBLES, caught: 0 })),
    monster: LAIR,
    lastHeard: null,
    round: 1,
    phase: "choose",
    step: 0,
    commits: Array(n).fill(null),
    moves: Array(n).fill(null),
    last: null,
    statTally: {},
  };
}

/* ── legality ─────────────────────────────────────────────────────── */

export function legalTargets(s: NightState, seat: Seat, kind: MoveKind): Cell[] {
  const me = s.seats[seat];
  const bs = blockedSet(s);
  if (kind === "hush") return [];
  if (kind === "throw") {
    if (me.pebbles <= 0) return [];
    const out: Cell[] = [];
    for (let c = 0; c < W * H; c++) if (!bs.has(c) && c !== me.at && manhattan(c, me.at) <= THROW_RANGE) out.push(c);
    return out;
  }
  const d = distances(me.at, bs);
  const reach = kind === "walk" ? 1 : 2;
  const out: Cell[] = [];
  for (let c = 0; c < W * H; c++) if (d[c] >= 1 && d[c] <= reach) out.push(c);
  // running only to cells two away (one step is a walk)
  return kind === "run" ? out.filter((c) => d[c] === 2) : out;
}

export function isLegal(s: NightState, seat: Seat, m: Move): boolean {
  if (!m || typeof m !== "object") return false;
  if (m.kind === "hush") return true;
  if (m.kind !== "walk" && m.kind !== "run" && m.kind !== "throw") return false;
  return legalTargets(s, seat, m.kind).includes(m.to);
}

/* ── resolution ───────────────────────────────────────────────────── */

/** Which sound the monster goes for: loudest as heard (level×2 − distance), then nearest, then seat order. */
export function pickTarget(monster: Cell, noises: NoiseEvent[], blocked: ReadonlySet<Cell>): NoiseEvent | null {
  const d = distances(monster, blocked);
  let best: NoiseEvent | null = null;
  let bestLoud = -Infinity;
  let bestDist = Infinity;
  for (const n of noises) {
    if (n.level <= 0) continue;
    const dist = d[n.at];
    if (dist > n.level * HEAR_PER_LEVEL) continue;
    const loud = n.level * HEAR_PER_LEVEL - dist;
    if (loud > bestLoud || (loud === bestLoud && dist < bestDist)) {
      best = n;
      bestLoud = loud;
      bestDist = dist;
    }
  }
  return best;
}

/** Monster's walk this round toward `goal` (or a seeded wander), at most `speed` steps. */
export function monsterWalk(s: NightState, goal: Cell | null, speed: number): Cell[] {
  const bs = blockedSet(s);
  const rng = seededRng((s.seed ^ Math.imul(s.round + 7, 0x2c1b3c6d)) | 0);
  if (goal !== null) return pathTo(s.monster, goal, bs, rng).slice(0, speed);
  const opts = neighbors(s.monster, bs);
  return opts.length ? [opts[Math.floor(rng() * opts.length)]] : [];
}

function resolve(s: NightState): NightState {
  const n = s.playerCount;
  const moves: Move[] = s.moves.map((m) => m ?? { kind: "hush" });
  const from = s.seats.map((x) => x.at);
  const noises: NoiseEvent[] = [];
  let t = s.statTally;
  let keys = [...s.keys];
  const seats = s.seats.map((x) => ({ ...x }));
  const picked: Seat[] = [];
  const bankedNow: { seat: Seat; keys: number }[] = [];

  moves.forEach((m, seat) => {
    const me = seats[seat];
    t = tallyAdd(t, seat, m.kind === "hush" ? "hushes" : m.kind === "walk" ? "walks" : m.kind === "run" ? "runs" : "throws");
    if (m.kind === "walk" || m.kind === "run") {
      me.at = m.to;
      noises.push({ at: m.to, level: NOISE[m.kind], seat, why: m.kind });
    } else if (m.kind === "throw") {
      me.pebbles -= 1;
      noises.push({ at: m.to, level: NOISE.throw, seat, why: "throw" });
    }
  });
  // keys: priority rotates each round so a shared landing isn't always won by seat 0
  const order = Array.from({ length: n }, (_, i) => (i + s.round) % n);
  for (const seat of order) {
    const me = seats[seat];
    const k = keys.indexOf(me.at);
    if (k >= 0 && me.carry < CARRY_MAX) {
      keys.splice(k, 1);
      me.carry += 1;
      picked.push(seat);
      noises.push({ at: me.at, level: NOISE.key, seat, why: "key" });
      t = tallyAdd(t, seat, "picked");
    }
    if (me.at === EXIT && me.carry > 0) {
      bankedNow.push({ seat, keys: me.carry });
      t = tallyAdd(t, seat, "banked", me.carry);
      t = tallyAdd(t, seat, "escapes");
      t = tallyMax(t, seat, "maxBank", me.carry);
      me.banked += me.carry;
      me.carry = 0;
      noises.push({ at: EXIT, level: NOISE.door, seat, why: "door" });
    }
  }

  // the monster — equally loud, equally far sounds are broken by a seeded shuffle (a rotating
  // seat order made whoever was first in round 2, the monster's first awake round, lose 20% of games)
  const bs = blockedSet(s);
  const target = pickTarget(s.monster, shuffle(noises, seededRng((s.seed ^ Math.imul(s.round + 11, 0x1b873593)) | 0)), bs);
  const goal = target ? target.at : s.lastHeard !== null && s.lastHeard !== s.monster ? s.lastHeard : null;
  const speed = s.round < WAKE_ROUND ? 0 : s.round >= rageFrom(s.options.rounds) ? RAGE_SPEED : MONSTER_SPEED;
  const path = speed === 0 ? [] : monsterWalk(s, goal, speed);
  const monster = path.length ? path[path.length - 1] : s.monster;
  const swept = new Set([s.monster, ...path]);
  const caught: Seat[] = [];
  seats.forEach((me, seat) => {
    if (!swept.has(me.at)) return;
    // dropped keys land where they were caught (the exit never holds keys)
    for (let i = 0; i < me.carry; i++) {
      const spot = me.at === EXIT ? from[seat] : me.at;
      keys.push(spot);
    }
    t = tallyAdd(t, seat, "caught");
    t = tallyAdd(t, seat, "dropped", me.carry);
    me.carry = 0;
    me.caught += 1;
    me.at = startOf(seat);
    caught.push(seat);
  });
  if (target && target.why === "throw" && target.seat !== undefined) t = tallyAdd(t, target.seat, "lured");
  // keep keys unique per cell (a second key dropped on a key cell slides to a free neighbour)
  keys = dedupeKeys(keys, bs, seats.map((x) => x.at), seededRng((s.seed ^ Math.imul(s.round + 3, 0x6b43a9b5)) | 0));

  const lastHeard = target ? target.at : goal === monster ? null : s.lastHeard;
  const report: RoundReport = { round: s.round, moves, from, noises, monsterFrom: s.monster, monsterPath: path, target, caught, picked, bankedNow };
  const next: NightState = { ...s, seats, keys, monster, lastHeard, phase: "resolved", step: s.step + 1, last: report, statTally: t };
  return next;
}

function dedupeKeys(keys: Cell[], blocked: ReadonlySet<Cell>, occupied: Cell[], rng: () => number): Cell[] {
  const out: Cell[] = [];
  for (const k of keys) {
    if (!out.includes(k) && k !== EXIT) {
      out.push(k);
      continue;
    }
    // slide to a random nearest free cell (a scan order would drift keys toward one corner)
    const d = distances(k, blocked);
    let bestD = Infinity;
    let opts: Cell[] = [];
    for (let c = 0; c < W * H; c++) {
      if (d[c] === Infinity || c === EXIT || out.includes(c) || occupied.includes(c)) continue;
      if (d[c] < bestD) {
        bestD = d[c];
        opts = [c];
      } else if (d[c] === bestD) opts.push(c);
    }
    if (opts.length) out.push(opts[Math.floor(rng() * opts.length)]);
  }
  return out;
}

function toReveal(s: NightState): NightState {
  const waiting = s.commits.some((c, i) => c !== "x" && s.moves[i] === null);
  if (!waiting) return resolve({ ...s, phase: "reveal" });
  return { ...s, phase: "reveal", step: s.step + 1 };
}

function finish(s: NightState): NightState {
  return { ...s, phase: "ended", step: s.step + 1 };
}

export const keysLeft = (s: NightState) => s.keys.length + s.seats.reduce((a, x) => a + x.carry, 0);

export function applyAction(s: NightState, a: EngineAction): NightState {
  if (s.phase === "ended" || a.step !== s.step) return s;
  if (a.type === "commit") {
    if (s.phase !== "choose" || a.seat < 0 || a.seat >= s.playerCount || s.commits[a.seat] !== null) return s;
    const commits = s.commits.map((c, i) => (i === a.seat ? String(a.hash) : c));
    const next = { ...s, commits };
    return commits.every((c) => c !== null) ? toReveal(next) : next;
  }
  if (a.type === "reveal") {
    if (s.phase !== "reveal" || a.seat < 0 || a.seat >= s.playerCount) return s;
    const hash = s.commits[a.seat];
    if (!hash || hash === "x" || s.moves[a.seat] !== null) return s;
    const ok = moveHash(a.move, a.salt) === hash && isLegal(s, a.seat, a.move);
    const moves = s.moves.map((m, i) => (i === a.seat ? (ok ? a.move : { kind: "hush" as const }) : m));
    const next = { ...s, moves };
    return moves.every((m, i) => m !== null || next.commits[i] === "x") ? resolve(next) : next;
  }
  // advance: time's up
  if (s.phase === "choose") return toReveal({ ...s, commits: s.commits.map((c) => c ?? "x") });
  if (s.phase === "reveal") return resolve(s);
  // resolved → next round or the end
  if (s.round >= s.options.rounds || keysLeft(s) === 0) return finish(s);
  return { ...s, round: s.round + 1, phase: "choose", step: s.step + 1, commits: Array(s.playerCount).fill(null), moves: Array(s.playerCount).fill(null) };
}

export function phaseMs(s: NightState): number {
  return s.phase === "choose" ? CHOOSE_MS : s.phase === "reveal" ? REVEAL_MS : s.phase === "resolved" ? RESOLVED_MS : 0;
}

/** What the monster would do if `seat` made `move` and everyone else hushed — the 🔰 helper's preview. */
export function previewMonster(s: NightState, seat: Seat, move: Move): { target: NoiseEvent | null; path: Cell[] } {
  const noises: NoiseEvent[] = [];
  const to = move.kind === "walk" || move.kind === "run" ? move.to : s.seats[seat].at;
  if (move.kind === "walk" || move.kind === "run") noises.push({ at: to, level: NOISE[move.kind], seat, why: move.kind });
  if (move.kind === "throw") noises.push({ at: move.to, level: NOISE.throw, seat, why: "throw" });
  if (s.keys.includes(to) && s.seats[seat].carry < CARRY_MAX) noises.push({ at: to, level: NOISE.key, seat, why: "key" });
  const bs = blockedSet(s);
  const target = pickTarget(s.monster, noises, bs);
  const goal = target ? target.at : s.lastHeard;
  const speed = s.round < WAKE_ROUND ? 0 : s.round >= rageFrom(s.options.rounds) ? RAGE_SPEED : MONSTER_SPEED;
  return { target, path: speed > 0 && goal !== null && goal !== s.monster ? monsterWalk(s, goal, speed) : [] };
}

export function computeRankings(s: NightState): { seat: Seat; rank: number; score: number }[] {
  const rows = s.seats.map((x, seat) => ({ seat, score: x.banked, caught: x.caught }));
  rows.sort((a, b) => b.score - a.score || a.caught - b.caught || a.seat - b.seat);
  return rows.map((r) => ({ seat: r.seat, score: r.score, rank: 1 + rows.filter((o) => o.score > r.score || (o.score === r.score && o.caught < r.caught)).length }));
}
