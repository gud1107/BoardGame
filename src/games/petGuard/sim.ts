/**
 * 🐶 멍냥 방어선 — deterministic cellular hazard simulator.
 *
 * A 12×14 grid (y = 0 is the top). Every rule is integer-only and driven by
 * one mulberry32 stream, so every client replays the identical outcome from
 * (scenario, layout, twist, round seed) — that is how the lockstep room and
 * the replay screen agree without sending a single frame.
 *
 * Materials live in `cells`; moving creatures/meteors are `agents` on top.
 * Rules (boardGameRule/멍냥방어선/멍냥방어선.md §4):
 *  - 💧 water / 🧪 acid flow (fall → diagonal → sideways), 🌋 lava the same
 *    every 3rd tick; 🏜️ sand / 🪨 boulders fall and pile, ☠️ gas / steam rise.
 *  - 🕳️ drains swallow anything that flows or falls into them.
 *  - 🔥 fire burns 🪵 wood / 🌿 bush / 🌻 bait, spreads to neighbours, water
 *    puts it out; lava ignites, lava + water → obsidian + steam; acid eats wood.
 *  - 🐝 bees fly the shortest path to the pet (or a 🌻 flower with room),
 *    🐝‼ hornets and 🐀 rats chew through wood, rats walk only on supported
 *    cells, 🦇 bats bounce diagonally, ☄️ meteors blast a 3×3 hole, ⚡ bolts
 *    hit the topmost thing in a column unless a lightning rod is within 3.
 *  - 🌀 fans push creatures and gas 4 cells along their beam.
 * The pet is hit when something dangerous touches it (4-neighbourhood) or
 * lands on top of it. Nothing can be built on the 8 cells around the pet.
 */

export const W = 12;
export const H = 14;
export const N = W * H;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const M = {
  EMPTY: 0,
  ROCK: 1,
  BUSH: 2,
  DAM: 3,
  OBSIDIAN: 4,
  PET: 5,
  // player pieces
  WOOD: 10,
  STONE: 11,
  DRAIN: 12,
  BAIT: 13,
  FAN_L: 14,
  FAN_R: 15,
  FAN_U: 16,
  ROD: 17,
  // moving matter
  WATER: 20,
  LAVA: 21,
  ACID: 22,
  SAND: 23,
  BOULDER: 24,
  GAS: 25,
  STEAM: 26,
  SNOW: 27,
} as const;
export type Mat = (typeof M)[keyof typeof M];

const LIQUIDS = new Set<number>([M.WATER, M.LAVA, M.ACID]);
const GRAINS = new Set<number>([M.SAND, M.BOULDER, M.SNOW]);
const VAPOURS = new Set<number>([M.GAS, M.STEAM]);
const FLAMMABLE = new Set<number>([M.WOOD, M.BUSH, M.BAIT]);
/** Pieces a meteor blast / quake can destroy. */
const FRAGILE = new Set<number>([M.WOOD, M.BUSH, M.BAIT, M.DRAIN, M.FAN_L, M.FAN_R, M.FAN_U, M.ROD, M.SAND, M.SNOW, M.WATER, M.ACID, M.GAS, M.STEAM]);

export function isLiquid(m: number) {
  return LIQUIDS.has(m);
}
export function isVapour(m: number) {
  return VAPOURS.has(m);
}
/** Air for creatures: empty or vapour. */
function airy(m: number) {
  return m === M.EMPTY || VAPOURS.has(m);
}

// ---------------------------------------------------------------------------
// Pieces (what a player can build)
// ---------------------------------------------------------------------------

export interface PieceDef {
  mat: Mat;
  emoji: string;
  name: string;
  cost: number;
  desc: string;
}

/** Index = piece kind used in layouts. */
export const PIECES: PieceDef[] = [
  { mat: M.WOOD, emoji: "🪵", name: "나무판", cost: 1, desc: "싸고 다 막아요. 불·용암에 타고, 산성액에 녹고, 말벌·쥐가 갉아요." },
  { mat: M.STONE, emoji: "🧱", name: "돌벽", cost: 2, desc: "무엇에도 부서지지 않아요(운석에도 버팀)." },
  { mat: M.DRAIN, emoji: "🕳️", name: "배수구", cost: 2, desc: "흘러오거나 떨어지는 물·용암·산성액·모래·바위를 삼켜요." },
  { mat: M.BAIT, emoji: "🌻", name: "미끼 꽃", cost: 2, desc: "벌·쥐가 펫 대신 꽃으로 가요(꽃 하나에 4마리). 말벌·박쥐는 무시. 불에 타요." },
  { mat: M.FAN_L, emoji: "⬅️", name: "선풍기 ←", cost: 3, desc: "왼쪽 4칸의 벌레·박쥐·가스를 날려 보내요." },
  { mat: M.FAN_R, emoji: "➡️", name: "선풍기 →", cost: 3, desc: "오른쪽 4칸의 벌레·박쥐·가스를 날려 보내요." },
  { mat: M.FAN_U, emoji: "⬆️", name: "선풍기 ↑", cost: 3, desc: "위쪽 4칸의 벌레·박쥐·가스를 날려 보내요." },
  { mat: M.ROD, emoji: "⚡", name: "피뢰침", cost: 2, desc: "좌우 3칸 안에 떨어지는 번개를 대신 맞아요." },
];

export interface Piece {
  x: number;
  y: number;
  k: number;
}

// ---------------------------------------------------------------------------
// Scenario data model
// ---------------------------------------------------------------------------

export type AgentKind = "bee" | "hornet" | "bat" | "rat" | "meteor";

export type Emitter =
  /** Spawn `mat` at (x, y) every `every` ticks in [from, to]. */
  | { k: "pour"; mat: Mat; x: number; y: number; from: number; to: number; every: number }
  /** Spawn `mat` at a random top-row column in [x0, x1]. */
  | { k: "rain"; mat: Mat; x0: number; x1: number; from: number; to: number; every: number }
  /** Spawn `count` agents at (x, y), one every `every` ticks from `from`. */
  | { k: "spawn"; agent: AgentKind; x: number; y: number; from: number; every: number; count: number }
  /** Meteors from a random top column in [x0, x1]. */
  | { k: "meteor"; x0: number; x1: number; from: number; every: number; count: number }
  /** Lightning at these ticks, random column in [x0, x1] (warned 10 ticks ahead). */
  | { k: "bolt"; at: number[]; x0: number; x1: number }
  /** Set these cells on fire at `at`. */
  | { k: "ignite"; at: number; cells: [number, number][] }
  /** Every 🧱 DAM cell vanishes at `at`. */
  | { k: "breach"; at: number };

export interface Scenario {
  id: string;
  emoji: string;
  name: string;
  tier: 1 | 2 | 3;
  /** Flavour + the honest hint shown in the design phase. */
  desc: string;
  hint: string;
  budget: number;
  ticks: number;
  /** 14 rows × 12 chars: . empty, # rock, g bush, d dam, w water, s sand, P pet. */
  map: string[];
  emitters: Emitter[];
  /** Background palette key for the renderer. */
  sky: "day" | "dusk" | "night" | "cave" | "storm" | "desert" | "volcano" | "toxic" | "snow";
}

// ---------------------------------------------------------------------------
// Twists (sent to the next seat, revealed when the simulation starts)
// ---------------------------------------------------------------------------

export interface TwistDef {
  id: number;
  emoji: string;
  name: string;
  desc: string;
}

export const TWISTS: TwistDef[] = [
  { id: 0, emoji: "💪", name: "폭주", desc: "쏟아지는 양이 1.5배 · 생물 +50% · 번개 +2번 · 운석 +2개" },
  { id: 1, emoji: "🔀", name: "역방향", desc: "위험이 나오는 위치가 좌우로 뒤집혀요" },
  { id: 2, emoji: "🧨", name: "지진", desc: "45틱에 가장 비싼 기물 하나가 무너져요" },
  { id: 3, emoji: "🐾", name: "산책", desc: "60틱에 펫이 옆 칸으로 한 걸음 걸어가요" },
  { id: 4, emoji: "🐝", name: "불청객", desc: "반대편 위 구석에서 벌 5마리가 추가로 날아와요" },
  { id: 5, emoji: "⏰", name: "연장전", desc: "버텨야 하는 시간이 40틱 늘어나요" },
];
export const NO_TWIST = -1;

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

export interface Agent {
  id: number;
  kind: AgentKind;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Ticks spent chewing the next wood cell. */
  chew: number;
  /** Index of the 🌻 cell this agent is heading for (-1 = the pet). */
  bait: number;
  /** Settled on its flower — stays put. */
  eating: boolean;
  /** 0 = alive. */
  dead: boolean;
}

export type HitCause = "water" | "lava" | "acid" | "gas" | "fire" | "sand" | "boulder" | "bee" | "hornet" | "bat" | "rat" | "bolt" | "meteor";

export const HIT_LABEL: Record<HitCause, string> = {
  water: "💧 물에 젖었어요",
  lava: "🌋 용암에 데었어요",
  acid: "🧪 산성액에 닿았어요",
  gas: "☠️ 독가스를 마셨어요",
  fire: "🔥 불길에 휩싸였어요",
  sand: "🏜️ 모래에 묻혔어요",
  boulder: "🪨 바위에 깔렸어요",
  bee: "🐝 벌에 쏘였어요",
  hornet: "🐝 말벌에 쏘였어요",
  bat: "🦇 박쥐에 물렸어요",
  rat: "🐀 쥐에 물렸어요",
  bolt: "⚡ 번개를 맞았어요",
  meteor: "☄️ 운석에 맞았어요",
};

export type SimEvent =
  | { k: "warn"; x: number }
  | { k: "bolt"; x: number; y: number; rod: boolean }
  | { k: "boom"; x: number; y: number }
  | { k: "crush"; x: number; y: number }
  | { k: "chew"; x: number; y: number }
  | { k: "drown"; x: number; y: number }
  | { k: "quake"; x: number; y: number }
  | { k: "walk"; x: number; y: number }
  | { k: "breach" }
  | { k: "hit"; cause: HitCause };

export interface SimState {
  cells: Uint8Array;
  /** Remaining burn ticks for a burning cell (0 = not burning). */
  burn: Uint8Array;
  /** Gas / steam lifetime; boulder fall height. */
  life: Uint8Array;
  agents: Agent[];
  petX: number;
  petY: number;
  tick: number;
  ticks: number;
  hit: { tick: number; cause: HitCause } | null;
  rng: number;
  nextAgentId: number;
  /** Bees/rats parked per 🌻 cell index. */
  baitLoad: Map<number, number>;
  /** Units swallowed by drains (stats). */
  drained: number;
  /** Creatures drowned (stats). */
  drowned: number;
  /** Lightning bolts caught by rods (stats). */
  rodCatches: number;
  events: SimEvent[];
  emitters: Emitter[];
  twist: number;
  quakeAt: number;
  walkAt: number;
  /** Agents spawned so far per emitter index. */
  spawned: number[];
  /** Column chosen at the warning for each pending bolt (emitter·10000 + tick). */
  boltCols: Map<number, number>;
}

function idx(x: number, y: number) {
  return y * W + x;
}
function inside(x: number, y: number) {
  return x >= 0 && x < W && y >= 0 && y < H;
}

function rand(s: SimState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(s: SimState, n: number): number {
  return Math.floor(rand(s) * n);
}

/** Pet position from the scenario map. */
export function petOf(sc: Scenario): { x: number; y: number } {
  for (let y = 0; y < H; y++) {
    const x = sc.map[y].indexOf("P");
    if (x >= 0) return { x, y };
  }
  return { x: 5, y: H - 2 };
}

function baseMat(ch: string): Mat {
  switch (ch) {
    case "#":
      return M.ROCK;
    case "g":
      return M.BUSH;
    case "d":
      return M.DAM;
    case "w":
      return M.WATER;
    case "s":
      return M.SAND;
    case "P":
      return M.PET;
    default:
      return M.EMPTY;
  }
}

/** Cells emitters spawn on — never buildable. */
export function emitterCells(sc: Scenario): Set<number> {
  const out = new Set<number>();
  for (const e of sc.emitters) {
    if (e.k === "pour" || e.k === "spawn") out.add(idx(e.x, e.y));
  }
  return out;
}

/** Can a piece go on (x, y)? Empty terrain, not the top row, not next to the pet, not an emitter mouth. */
export function canBuild(sc: Scenario, x: number, y: number): boolean {
  if (!inside(x, y) || y === 0) return false;
  if (baseMat(sc.map[y][x]) !== M.EMPTY) return false;
  const p = petOf(sc);
  if (Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1) return false;
  if (emitterCells(sc).has(idx(x, y))) return false;
  return true;
}

export function layoutCost(pieces: readonly Piece[]): number {
  return pieces.reduce((a, p) => a + (PIECES[p.k]?.cost ?? 0), 0);
}

/** Drops illegal / overlapping / over-budget pieces (keeps the first ones). */
export function sanitizeLayout(sc: Scenario, pieces: readonly Piece[]): Piece[] {
  const out: Piece[] = [];
  const used = new Set<number>();
  let spent = 0;
  for (const p of pieces) {
    if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.k)) continue;
    if (p.k < 0 || p.k >= PIECES.length) continue;
    if (!canBuild(sc, p.x, p.y) || used.has(idx(p.x, p.y))) continue;
    const c = PIECES[p.k].cost;
    if (spent + c > sc.budget) continue;
    spent += c;
    used.add(idx(p.x, p.y));
    out.push({ x: p.x, y: p.y, k: p.k });
  }
  return out;
}

function mirrorEmitter(e: Emitter): Emitter {
  const mx = (x: number) => W - 1 - x;
  switch (e.k) {
    case "pour":
    case "spawn":
      return { ...e, x: mx(e.x) };
    case "rain":
    case "meteor":
    case "bolt":
      return { ...e, x0: mx(e.x1), x1: mx(e.x0) };
    case "ignite":
      return { ...e, cells: e.cells.map(([x, y]) => [mx(x), y] as [number, number]) };
    default:
      return e;
  }
}

function surgeEmitter(e: Emitter): Emitter {
  switch (e.k) {
    case "pour":
    case "rain":
      return { ...e, every: Math.max(1, Math.floor((e.every * 2) / 3)), to: e.every === 1 ? e.to + Math.floor((e.to - e.from) / 2) : e.to };
    case "spawn":
      return { ...e, count: e.count + Math.ceil(e.count / 2) };
    case "meteor":
      return { ...e, count: e.count + 2 };
    case "bolt": {
      const last = e.at[e.at.length - 1] ?? 40;
      return { ...e, at: [...e.at, last + 12, last + 24] };
    }
    default:
      return e;
  }
}

export function twistedEmitters(sc: Scenario, twist: number): Emitter[] {
  let em = sc.emitters.map((e) => ({ ...e })) as Emitter[];
  if (twist === 0) em = em.map(surgeEmitter);
  if (twist === 1) em = em.map(mirrorEmitter);
  if (twist === 4) {
    // opposite top corner to the first emitter
    const first = em.find((e) => e.k === "pour" || e.k === "spawn") as { x: number } | undefined;
    const x = first && first.x < W / 2 ? W - 1 : 0;
    em.push({ k: "spawn", agent: "bee", x, y: 0, from: 30, every: 8, count: 5 });
  }
  return em;
}

export function createSim(sc: Scenario, layout: readonly Piece[], twist: number, seed: number): SimState {
  const cells = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[idx(x, y)] = baseMat(sc.map[y][x] ?? ".");
  for (const p of sanitizeLayout(sc, layout)) cells[idx(p.x, p.y)] = PIECES[p.k].mat;
  const pet = petOf(sc);
  const emitters = twistedEmitters(sc, twist);
  return {
    cells,
    burn: new Uint8Array(N),
    life: new Uint8Array(N),
    agents: [],
    petX: pet.x,
    petY: pet.y,
    tick: 0,
    ticks: sc.ticks + (twist === 5 ? 40 : 0),
    hit: null,
    rng: (seed ^ 0x5bd1e995) | 0,
    nextAgentId: 1,
    baitLoad: new Map(),
    drained: 0,
    drowned: 0,
    rodCatches: 0,
    events: [],
    emitters,
    twist,
    quakeAt: twist === 2 ? 45 : -1,
    walkAt: twist === 3 ? 60 : -1,
    spawned: emitters.map(() => 0),
    boltCols: new Map(),
  };
}

// ---------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------

/** Nearest empty cell in the same row (emitter fallback when its mouth is blocked by terrain after a mirror). */
function openNear(s: SimState, x: number, y: number): number {
  for (let d = 0; d < W; d++) {
    for (const xx of [x - d, x + d]) {
      if (xx >= 0 && xx < W && s.cells[idx(xx, y)] === M.EMPTY) return idx(xx, y);
    }
  }
  return -1;
}

function spawnMat(s: SimState, mat: Mat, x: number, y: number) {
  const i = s.cells[idx(x, y)] === M.EMPTY ? idx(x, y) : s.cells[idx(x, y)] === M.ROCK ? openNear(s, x, y) : -1;
  if (i < 0 || s.cells[i] !== M.EMPTY) return;
  s.cells[i] = mat;
  s.life[i] = mat === M.GAS ? 110 : mat === M.ACID ? ACID_LIFE : 0;
}

function spawnAgent(s: SimState, kind: AgentKind, x: number, y: number) {
  let px = x;
  let py = y;
  if (!airy(s.cells[idx(x, y)])) {
    const i = openNear(s, x, y);
    if (i < 0) return;
    px = i % W;
    py = Math.floor(i / W);
  }
  const dir = px < W / 2 ? 1 : -1;
  s.agents.push({ id: s.nextAgentId++, kind, x: px, y: py, dx: dir, dy: 1, chew: 0, bait: -1, eating: false, dead: false });
}

function runEmitters(s: SimState) {
  const t = s.tick;
  s.emitters.forEach((e, ei) => {
    switch (e.k) {
      case "pour":
        if (t >= e.from && t <= e.to && (t - e.from) % e.every === 0) spawnMat(s, e.mat, e.x, e.y);
        break;
      case "rain":
        if (t >= e.from && t <= e.to && (t - e.from) % e.every === 0) spawnMat(s, e.mat, e.x0 + randInt(s, e.x1 - e.x0 + 1), 0);
        break;
      case "spawn":
        if (t >= e.from && s.spawned[ei] < e.count && (t - e.from) % e.every === 0) {
          s.spawned[ei]++;
          spawnAgent(s, e.agent, e.x, e.y);
        }
        break;
      case "meteor":
        if (t >= e.from && s.spawned[ei] < e.count && (t - e.from) % e.every === 0) {
          s.spawned[ei]++;
          const x = e.x0 + randInt(s, e.x1 - e.x0 + 1);
          s.agents.push({ id: s.nextAgentId++, kind: "meteor", x, y: 0, dx: rand(s) < 0.5 ? -1 : 1, dy: 1, chew: 0, bait: -1, eating: false, dead: false });
        }
        break;
      case "bolt":
        for (const at of e.at) {
          if (t === at - 10) {
            // pick the column now so the warning shows where it will land
            const col = e.x0 + randInt(s, e.x1 - e.x0 + 1);
            s.boltCols.set(ei * 10000 + at, col);
            s.events.push({ k: "warn", x: col });
          }
          if (t === at) {
            const col = s.boltCols.get(ei * 10000 + at) ?? e.x0;
            strike(s, col);
          }
        }
        break;
      case "ignite":
        if (t === e.at) for (const [x, y] of e.cells) ignite(s, idx(x, y));
        break;
      case "breach":
        if (t === e.at) {
          for (let i = 0; i < N; i++) if (s.cells[i] === M.DAM) s.cells[i] = M.EMPTY;
          s.events.push({ k: "breach" });
        }
        break;
    }
  });
}

function ignite(s: SimState, i: number) {
  if (FLAMMABLE.has(s.cells[i]) && s.burn[i] === 0) s.burn[i] = s.cells[i] === M.WOOD ? 36 : s.cells[i] === M.BAIT ? 24 : 30;
}

function strike(s: SimState, col: number) {
  // lightning rod within 3 columns takes it
  let best = -1;
  let bestD = 99;
  for (let i = 0; i < N; i++) {
    if (s.cells[i] !== M.ROD) continue;
    const d = Math.abs((i % W) - col);
    if (d <= 3 && (d < bestD || (d === bestD && i < best))) {
      best = i;
      bestD = d;
    }
  }
  if (best >= 0) {
    s.rodCatches++;
    s.events.push({ k: "bolt", x: best % W, y: Math.floor(best / W), rod: true });
    return;
  }
  for (let y = 0; y < H; y++) {
    const i = idx(col, y);
    const m = s.cells[i];
    if (m === M.EMPTY || VAPOURS.has(m)) {
      if (s.agents.some((a) => !a.dead && a.x === col && a.y === y && a.kind !== "meteor")) {
        for (const a of s.agents) if (!a.dead && a.x === col && a.y === y) a.dead = true;
        s.events.push({ k: "bolt", x: col, y, rod: false });
        return;
      }
      continue;
    }
    s.events.push({ k: "bolt", x: col, y, rod: false });
    if (m === M.PET) hitPet(s, "bolt");
    else if (m === M.WATER) {
      // electrified pool: the pet is hit if it touches this water body
      if (touchesConnected(s, i, M.WATER)) hitPet(s, "bolt");
    } else ignite(s, i);
    return;
  }
}

/** Is the pet adjacent to the connected body of `mat` that contains cell i? */
function touchesConnected(s: SimState, start: number, mat: number): boolean {
  const seen = new Uint8Array(N);
  const q = [start];
  seen[start] = 1;
  const pet = idx(s.petX, s.petY);
  while (q.length) {
    const i = q.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (j === pet) return true;
      if (!seen[j] && s.cells[j] === mat) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  return false;
}

const DIRS4: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function hitPet(s: SimState, cause: HitCause) {
  if (s.hit) return;
  s.hit = { tick: s.tick, cause };
  s.events.push({ k: "hit", cause });
}

/** Moves matter one step. Returns true if moved. */
function tryMove(s: SimState, from: number, to: number, moved: Uint8Array): boolean {
  const m = s.cells[from];
  const t = s.cells[to];
  if (t === M.DRAIN && (LIQUIDS.has(m) || GRAINS.has(m))) {
    s.cells[from] = M.EMPTY;
    s.life[from] = 0;
    s.drained++;
    return true;
  }
  if (t === M.EMPTY || (VAPOURS.has(t) && !VAPOURS.has(m))) {
    s.cells[to] = m;
    s.life[to] = s.life[from];
    s.cells[from] = t;
    s.life[from] = 0;
    moved[to] = 1;
    // liquid/grain falling onto a creature drowns / squashes it
    if (LIQUIDS.has(m) || m === M.BOULDER) {
      const tx = to % W;
      const ty = (to - tx) / W;
      for (const a of s.agents) {
        if (!a.dead && a.kind !== "meteor" && a.x === tx && a.y === ty) {
          a.dead = true;
          s.drowned++;
          s.events.push({ k: "drown", x: tx, y: ty });
        }
      }
    }
    return true;
  }
  return false;
}

function stepMatter(s: SimState) {
  const moved = new Uint8Array(N);
  const leftFirst = (s.tick & 1) === 0;
  const lavaTurn = s.tick % 3 === 0;
  // falling things, bottom-up
  for (let y = H - 1; y >= 0; y--) {
    for (let k = 0; k < W; k++) {
      const x = leftFirst ? k : W - 1 - k;
      const i = idx(x, y);
      if (moved[i]) continue;
      const m = s.cells[i];
      if (!LIQUIDS.has(m) && !GRAINS.has(m)) continue;
      if (m === M.LAVA && !lavaTurn) continue;
      const down = y + 1 < H ? idx(x, y + 1) : -1;
      if (down >= 0 && tryMove(s, i, down, moved)) {
        if (m === M.BOULDER) s.life[down] = Math.min(250, s.life[down] + 1);
        continue;
      }
      if (m === M.BOULDER) {
        // a boulder that fell 3+ cells crushes the wood it lands on
        if (down >= 0 && s.life[i] >= 3 && (s.cells[down] === M.WOOD || s.cells[down] === M.BAIT || s.cells[down] === M.BUSH)) {
          s.cells[down] = M.EMPTY;
          s.burn[down] = 0;
          s.events.push({ k: "crush", x, y: y + 1 });
          s.life[i] = 1;
          continue;
        }
      }
      const d1 = ((x + s.tick) & 1) === 0 ? -1 : 1;
      let done = false;
      if (down >= 0) {
        for (const d of [d1, -d1]) {
          const nx = x + d;
          if (nx < 0 || nx >= W) continue;
          // boulders roll only when the side is open too
          if (m === M.BOULDER && s.cells[idx(nx, y)] !== M.EMPTY) continue;
          if (tryMove(s, i, idx(nx, y + 1), moved)) {
            done = true;
            break;
          }
        }
      }
      if (done) continue;
      if (m === M.BOULDER || m === M.SAND || m === M.SNOW) {
        if (m === M.BOULDER) s.life[i] = 0;
        continue;
      }
      // liquids spread sideways (up to 2 cells for water/acid)
      for (const d of [d1, -d1]) {
        const nx = x + d;
        if (nx < 0 || nx >= W) continue;
        if (tryMove(s, i, idx(nx, y), moved)) {
          done = true;
          break;
        }
      }
    }
  }
  // rising vapours, top-down
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < W; k++) {
      const x = leftFirst ? W - 1 - k : k;
      const i = idx(x, y);
      if (moved[i]) continue;
      const m = s.cells[i];
      if (!VAPOURS.has(m)) continue;
      if (s.life[i] <= 1) {
        s.cells[i] = M.EMPTY;
        s.life[i] = 0;
        continue;
      }
      s.life[i]--;
      const pushed = fanPush(s, x, y);
      if (pushed) {
        const [nx, ny] = pushed;
        if (inside(nx, ny) && s.cells[idx(nx, ny)] === M.EMPTY) {
          tryMove(s, i, idx(nx, ny), moved);
          continue;
        }
      }
      if (y > 0 && s.cells[idx(x, y - 1)] === M.EMPTY) {
        tryMove(s, i, idx(x, y - 1), moved);
        continue;
      }
      const r = randInt(s, 3);
      if (r === 0) continue;
      const d = r === 1 ? -1 : 1;
      const nx = x + d;
      if (nx >= 0 && nx < W && s.cells[idx(nx, y)] === M.EMPTY) tryMove(s, i, idx(nx, y), moved);
    }
  }
}

function stepReactions(s: SimState) {
  const c = s.cells;
  for (let i = 0; i < N; i++) {
    const m = c[i];
    const x = i % W;
    const y = (i - x) / W;
    if (m === M.LAVA) {
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (c[j] === M.WATER) {
          c[i] = M.OBSIDIAN;
          c[j] = M.STEAM;
          s.life[j] = 14;
          break;
        }
        ignite(s, j);
      }
    } else if (m === M.ACID) {
      if (s.life[i] <= 1) {
        c[i] = M.STEAM;
        s.life[i] = 8;
        continue;
      }
      s.life[i]--;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (c[j] === M.WOOD || c[j] === M.BAIT || c[j] === M.BUSH || c[j] === M.FAN_L || c[j] === M.FAN_R || c[j] === M.FAN_U) {
          c[j] = M.EMPTY;
          s.burn[j] = 0;
          c[i] = M.EMPTY;
          s.events.push({ k: "chew", x: nx, y: ny });
          break;
        }
      }
    }
  }
  // fire
  for (let i = 0; i < N; i++) {
    if (s.burn[i] === 0) continue;
    if (!FLAMMABLE.has(c[i])) {
      s.burn[i] = 0;
      continue;
    }
    const x = i % W;
    const y = (i - x) / W;
    let doused = false;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (inside(nx, ny) && c[idx(nx, ny)] === M.WATER) doused = true;
    }
    if (doused) {
      s.burn[i] = 0;
      continue;
    }
    s.burn[i]--;
    if (s.burn[i] % 6 === 0) {
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (inside(nx, ny)) ignite(s, idx(nx, ny));
      }
      // embers jump a 1-cell gap (a solid piece in the gap stops them)
      if (rand(s) < 0.6) {
        const [dx, dy] = DIRS4[randInt(s, 4)];
        const mx = x + dx;
        const my = y + dy;
        const tx = x + dx * 2;
        const ty = y + dy * 2;
        if (inside(tx, ty) && airy(c[idx(mx, my)])) ignite(s, idx(tx, ty));
      }
      // flames lick upwards into the air above too
      if (y > 0 && c[idx(x, y - 1)] === M.EMPTY && rand(s) < 0.15) {
        c[idx(x, y - 1)] = M.STEAM;
        s.life[idx(x, y - 1)] = 6;
      }
    }
    if (s.burn[i] === 0) {
      if (c[i] === M.BAIT) releaseBait(s, i);
      c[i] = M.EMPTY;
    }
  }
}

function releaseBait(s: SimState, i: number) {
  s.baitLoad.delete(i);
  for (const a of s.agents) {
    if (a.bait === i) {
      a.bait = -1;
      a.eating = false;
    }
  }
}

/** If (x, y) is in a fan beam, the direction it is pushed. */
function fanPush(s: SimState, x: number, y: number): [number, number] | null {
  // look back along each axis for a fan facing this cell, max 4 cells, no solid between
  const checks: [Mat, number, number][] = [
    [M.FAN_L, 1, 0],
    [M.FAN_R, -1, 0],
    [M.FAN_U, 0, 1],
  ];
  for (const [fan, sx, sy] of checks) {
    for (let d = 1; d <= 4; d++) {
      const fx = x + sx * d;
      const fy = y + sy * d;
      if (!inside(fx, fy)) break;
      const m = s.cells[idx(fx, fy)];
      if (m === fan) return [x - sx, y - sy];
      if (!airy(m) && !LIQUIDS.has(m)) break;
    }
  }
  return null;
}

/** Distance field to `targets` for an agent class. chew = wood costs 6 extra. */
function field(s: SimState, targets: number[], ground: boolean, chew: boolean): Int16Array {
  const INF = 32000;
  const dist = new Int16Array(N).fill(INF);
  // Dial's algorithm with small integer weights
  const buckets: number[][] = [];
  for (const t of targets) {
    dist[t] = 0;
    (buckets[0] ??= []).push(t);
  }
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let bi = 0; bi < b.length; bi++) {
      const i = b[bi];
      if (dist[i] !== d) continue;
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        const m = s.cells[j];
        let w = 0;
        if (airy(m)) w = 1;
        else if (chew && m === M.WOOD) w = 7;
        else continue;
        if (ground && airy(m) && !supported(s, nx, ny)) continue;
        const nd = d + w;
        if (nd < dist[j]) {
          dist[j] = nd;
          (buckets[nd] ??= []).push(j);
        }
      }
    }
  }
  return dist;
}

/** A walking rat needs something under it or beside it to cling to. */
function supported(s: SimState, x: number, y: number): boolean {
  if (y === H - 1) return true;
  const below = s.cells[idx(x, y + 1)];
  if (!airy(below) && !LIQUIDS.has(below)) return true;
  for (const d of [-1, 1]) {
    const nx = x + d;
    if (nx >= 0 && nx < W) {
      const m = s.cells[idx(nx, y)];
      if (!airy(m) && !LIQUIDS.has(m)) return true;
    }
  }
  return false;
}

/** Acid drops fizzle into steam after this many ticks. */
const ACID_LIFE = 70;

const SPEED: Record<AgentKind, number> = { bee: 2, hornet: 2, bat: 1, rat: 3, meteor: 1 };
const CHEW_TICKS = 10;
const BAIT_CAP = 4;

function stepAgents(s: SimState) {
  const live = s.agents.filter((a) => !a.dead);
  if (live.length === 0) return;
  const pet = idx(s.petX, s.petY);
  const fields = new Map<string, Int16Array>();
  const fieldFor = (targets: number[], key: string, ground: boolean, chew: boolean) => {
    let f = fields.get(key);
    if (!f) {
      f = field(s, targets, ground, chew);
      fields.set(key, f);
    }
    return f;
  };
  const baits: number[] = [];
  for (let i = 0; i < N; i++) if (s.cells[i] === M.BAIT) baits.push(i);

  for (const a of live) {
    // drowned by matter flowing into its cell
    const here = s.cells[idx(a.x, a.y)];
    if (a.kind !== "meteor" && (LIQUIDS.has(here) || GRAINS.has(here))) {
      a.dead = true;
      s.drowned++;
      s.events.push({ k: "drown", x: a.x, y: a.y });
      continue;
    }
    if (a.kind === "meteor") {
      stepMeteor(s, a);
      continue;
    }
    // fans override movement
    const push = fanPush(s, a.x, a.y);
    if (push) {
      const [nx, ny] = push;
      if (a.eating) releaseAgent(s, a);
      if (inside(nx, ny) && airy(s.cells[idx(nx, ny)])) {
        a.x = nx;
        a.y = ny;
      } else if (!inside(nx, ny)) {
        // blown off the board
        a.dead = true;
      }
      continue;
    }
    if (s.tick % SPEED[a.kind] !== a.id % SPEED[a.kind]) continue;
    if (a.kind === "bat") {
      stepBat(s, a);
      continue;
    }
    if (a.eating) continue;
    const ground = a.kind === "rat";
    if (ground && !supported(s, a.x, a.y)) {
      // fall
      if (a.y + 1 < H && airy(s.cells[idx(a.x, a.y + 1)])) a.y++;
      continue;
    }
    const chew = a.kind === "hornet" || a.kind === "rat";
    // pick a flower with room (bees + rats)
    if (a.bait < 0 && (a.kind === "bee" || a.kind === "rat")) {
      let bestBait = -1;
      let bestD = 32000;
      for (const b of baits) {
        if ((s.baitLoad.get(b) ?? 0) >= BAIT_CAP) continue;
        const f = fieldFor([b], `b${b}${ground ? "g" : "f"}${chew ? "c" : ""}`, ground, chew);
        const d = minAround(f, a.x, a.y);
        if (d < bestD) {
          bestD = d;
          bestBait = b;
        }
      }
      if (bestBait >= 0) {
        a.bait = bestBait;
        s.baitLoad.set(bestBait, (s.baitLoad.get(bestBait) ?? 0) + 1);
      }
    }
    if (a.bait >= 0 && s.cells[a.bait] !== M.BAIT) releaseAgent(s, a);
    const target = a.bait >= 0 ? a.bait : pet;
    const f = fieldFor([target], `t${target}${ground ? "g" : "f"}${chew ? "c" : ""}`, ground, chew);
    // adjacent to the flower → settle
    if (a.bait >= 0 && Math.abs((a.bait % W) - a.x) + Math.abs(Math.floor(a.bait / W) - a.y) === 1) {
      a.eating = true;
      continue;
    }
    let best: [number, number] | null = null;
    let bestD = f[idx(a.x, a.y)];
    for (const [dx, dy] of rotated(DIRS4, a.id + s.tick)) {
      const nx = a.x + dx;
      const ny = a.y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (f[j] < bestD) {
        bestD = f[j];
        best = [nx, ny];
      }
    }
    if (!best) {
      // no path: wander
      const [dx, dy] = DIRS4[randInt(s, 4)];
      const nx = a.x + dx;
      const ny = a.y + dy;
      if (inside(nx, ny) && airy(s.cells[idx(nx, ny)]) && (!ground || supported(s, nx, ny))) {
        a.x = nx;
        a.y = ny;
      }
      continue;
    }
    const j = idx(best[0], best[1]);
    if (s.cells[j] === M.WOOD) {
      a.chew += SPEED[a.kind];
      if (a.chew >= CHEW_TICKS) {
        s.cells[j] = M.EMPTY;
        s.burn[j] = 0;
        a.chew = 0;
        s.events.push({ k: "chew", x: best[0], y: best[1] });
      }
      continue;
    }
    if (j === pet) continue;
    a.chew = 0;
    a.x = best[0];
    a.y = best[1];
  }
  s.agents = s.agents.filter((a) => !a.dead);
}

function releaseAgent(s: SimState, a: Agent) {
  if (a.bait >= 0) s.baitLoad.set(a.bait, Math.max(0, (s.baitLoad.get(a.bait) ?? 1) - 1));
  a.bait = -1;
  a.eating = false;
}

function minAround(f: Int16Array, x: number, y: number): number {
  let best = f[idx(x, y)];
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx;
    const ny = y + dy;
    if (inside(nx, ny)) best = Math.min(best, f[idx(nx, ny)] + 1);
  }
  return best;
}

function rotated<T>(arr: T[], k: number): T[] {
  const r = ((k % arr.length) + arr.length) % arr.length;
  return [...arr.slice(r), ...arr.slice(0, r)];
}

function stepBat(s: SimState, a: Agent) {
  const tryCell = (dx: number, dy: number) => {
    const nx = a.x + dx;
    const ny = a.y + dy;
    return inside(nx, ny) && airy(s.cells[idx(nx, ny)]) ? [nx, ny] : null;
  };
  const opts: [number, number][] = [
    [a.dx, a.dy],
    [-a.dx, a.dy],
    [a.dx, -a.dy],
    [-a.dx, -a.dy],
  ];
  for (const [dx, dy] of opts) {
    const c = tryCell(dx, dy);
    if (c) {
      a.dx = dx;
      a.dy = dy;
      a.x = c[0];
      a.y = c[1];
      return;
    }
  }
  // boxed in diagonally: try straight moves
  for (const [dx, dy] of DIRS4) {
    const c = tryCell(dx, dy);
    if (c) {
      a.x = c[0];
      a.y = c[1];
      return;
    }
  }
}

function stepMeteor(s: SimState, a: Agent) {
  let nx = a.x + a.dx;
  const ny = a.y + 1;
  if (nx < 0 || nx >= W) {
    a.dx = -a.dx;
    nx = a.x + a.dx;
  }
  const blocked = ny >= H || !airy(s.cells[idx(nx, ny)]) || (s.petX === nx && s.petY === ny);
  if (!blocked) {
    a.x = nx;
    a.y = ny;
    return;
  }
  // explode around the impact cell
  const cx = ny >= H ? a.x : nx;
  const cy = ny >= H ? a.y : ny;
  a.dead = true;
  s.events.push({ k: "boom", x: cx, y: cy });
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inside(x, y)) continue;
      const j = idx(x, y);
      if (j === idx(s.petX, s.petY)) hitPet(s, "meteor");
      if (FRAGILE.has(s.cells[j])) {
        if (s.cells[j] === M.BAIT) releaseBait(s, j);
        s.cells[j] = M.EMPTY;
        s.burn[j] = 0;
      }
      for (const o of s.agents) if (!o.dead && o.kind !== "meteor" && o.x === x && o.y === y) o.dead = true;
    }
  }
  // embers
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inside(cx + dx, cy + dy)) ignite(s, idx(cx + dx, cy + dy));
}

function stepTwistEvents(s: SimState, layoutCostOf: (m: number) => number) {
  if (s.tick === s.quakeAt) {
    let best = -1;
    let bestCost = 0;
    let bestD = 999;
    for (let i = 0; i < N; i++) {
      const c = layoutCostOf(s.cells[i]);
      if (c <= 0) continue;
      const d = Math.abs((i % W) - s.petX) + Math.abs(Math.floor(i / W) - s.petY);
      if (c > bestCost || (c === bestCost && d < bestD)) {
        best = i;
        bestCost = c;
        bestD = d;
      }
    }
    if (best >= 0) {
      if (s.cells[best] === M.BAIT) releaseBait(s, best);
      s.cells[best] = M.EMPTY;
      s.burn[best] = 0;
      s.events.push({ k: "quake", x: best % W, y: Math.floor(best / W) });
    }
  }
  if (s.tick === s.walkAt) {
    const first = rand(s) < 0.5 ? -1 : 1;
    for (const d of [first, -first]) {
      const nx = s.petX + d;
      if (nx < 0 || nx >= W) continue;
      const j = idx(nx, s.petY);
      const supportedBelow = s.petY === H - 1 || !airy(s.cells[idx(nx, s.petY + 1)]);
      if (s.cells[j] === M.EMPTY && supportedBelow) {
        s.cells[idx(s.petX, s.petY)] = M.EMPTY;
        s.cells[j] = M.PET;
        s.petX = nx;
        s.events.push({ k: "walk", x: nx, y: s.petY });
        break;
      }
    }
  }
}

const MAT_COST = new Map<number, number>(PIECES.map((p) => [p.mat, p.cost]));
// the three fans share one cost
function matCost(m: number): number {
  return MAT_COST.get(m) ?? 0;
}

function checkPet(s: SimState) {
  if (s.hit) return;
  const x = s.petX;
  const y = s.petY;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inside(nx, ny)) continue;
    const j = idx(nx, ny);
    const m = s.cells[j];
    if (m === M.WATER) return hitPet(s, "water");
    if (m === M.LAVA) return hitPet(s, "lava");
    if (m === M.ACID) return hitPet(s, "acid");
    if (m === M.GAS) return hitPet(s, "gas");
    if (s.burn[j] > 0) return hitPet(s, "fire");
    if (dy === -1 && (m === M.SAND || m === M.SNOW)) return hitPet(s, "sand");
    if (dy === -1 && m === M.BOULDER) return hitPet(s, "boulder");
  }
  for (const a of s.agents) {
    if (a.dead || a.kind === "meteor") continue;
    if (Math.abs(a.x - x) + Math.abs(a.y - y) <= 1) return hitPet(s, a.kind);
  }
}

/** Advances one tick. `events` holds only this tick's events afterwards. */
export function stepSim(s: SimState) {
  s.events = [];
  if (s.hit || s.tick >= s.ticks) return;
  runEmitters(s);
  stepTwistEvents(s, matCost);
  stepMatter(s);
  stepReactions(s);
  stepAgents(s);
  checkPet(s);
  s.tick++;
}

export interface SimOutcome {
  survived: boolean;
  hitTick: number | null;
  cause: HitCause | null;
  ticks: number;
  drained: number;
  drowned: number;
  rodCatches: number;
}

export function runSim(sc: Scenario, layout: readonly Piece[], twist: number, seed: number): SimOutcome {
  const s = createSim(sc, layout, twist, seed);
  while (!s.hit && s.tick < s.ticks) stepSim(s);
  return {
    survived: !s.hit,
    hitTick: s.hit?.tick ?? null,
    cause: s.hit?.cause ?? null,
    ticks: s.ticks,
    drained: s.drained,
    drowned: s.drowned,
    rodCatches: s.rodCatches,
  };
}

/** A renderable snapshot of one tick. */
export interface Frame {
  cells: Uint8Array;
  burn: Uint8Array;
  agents: { id: number; kind: AgentKind; x: number; y: number; eating: boolean }[];
  petX: number;
  petY: number;
  tick: number;
  events: SimEvent[];
  hit: { tick: number; cause: HitCause } | null;
}

export function snapshot(s: SimState): Frame {
  return {
    cells: s.cells.slice(),
    burn: s.burn.slice(),
    agents: s.agents.filter((a) => !a.dead).map((a) => ({ id: a.id, kind: a.kind, x: a.x, y: a.y, eating: a.eating })),
    petX: s.petX,
    petY: s.petY,
    tick: s.tick,
    events: s.events.slice(),
    hit: s.hit,
  };
}

/** Every frame of a run (frame 0 = the built board before tick 0), plus a few frames past the hit. */
export function recordSim(sc: Scenario, layout: readonly Piece[], twist: number, seed: number): Frame[] {
  const s = createSim(sc, layout, twist, seed);
  const frames: Frame[] = [snapshot(s)];
  while (!s.hit && s.tick < s.ticks) {
    stepSim(s);
    frames.push(snapshot(s));
  }
  return frames;
}

/** Score for one round (§5): survive = 10 + unspent coins; hit at t = ⌊7·t/T⌋. */
export function roundScore(sc: Scenario, outcome: SimOutcome, spent: number): number {
  if (outcome.survived) return 10 + Math.max(0, sc.budget - spent);
  return Math.floor((7 * (outcome.hitTick ?? 0)) / outcome.ticks);
}
