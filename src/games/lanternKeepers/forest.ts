/**
 * 등불 지기 — 숲 생성. 시드 하나로 같은 숲이 나온다(서버·락스텝 모두 같은 함수).
 *
 * 칸: "." 길 · "#" 나무(벽, 빛도 막음) · "~" 골짜기(다리가 있어야 건넘, 빛은 넘어감)
 * 화면에 안 보인 칸은 보기(view)에서 "?"로 가려진다.
 *
 * 만드는 순서
 * 1. 홀수 칸 미로를 깊이 우선으로 파고, 벽 일부를 터서 우회로(고리)를 만든다.
 * 2. 출발(왼쪽 위)·새벽 제단(오른쪽 아래) 둘레 3×3을 빈터로.
 * 3. 막다른 길 중 멀리 떨어진 곳에 빛 조각(필수)·반딧불 병(선택)을 둔다.
 * 4. 꼭 지나야 하는 길(출발→조각·제단 최단 경로) 위 곧은 통로에 "다리 있는 골짜기",
 *    그 밖의 곧은 통로에 "다리 없는 골짜기"(막혀도 모든 목표에 닿을 때만)를 판다.
 * 5. 함정·괴물 순찰로를 색별로 고르게 나눠 깐다.
 * 6. 다리 있는 골짜기만 건널 수 있다고 보고 모든 목표에 닿는지 확인 — 실패하면 다음 시드.
 */

export type ForestId = "trail" | "deep" | "shadow";

export const T_FLOOR = ".";
export const T_TREE = "#";
export const T_RAVINE = "~";
export const T_UNKNOWN = "?";

export interface ForestPreset {
  id: ForestId;
  name: string;
  emoji: string;
  blurb: string;
  w: number;
  h: number;
  shards: number;
  jars: number;
  /** 함정 수 기준값 — 인원이 늘면 늘어난다 */
  traps: number;
  bridges: number;
  fakeRavines: number;
  monsters: (n: number) => number;
  loopRate: number;
  /** 인원별 등유(라운드 수) */
  rounds: Record<number, number>;
  /** 인원별 생명 */
  hearts: Record<number, number>;
}

export const FORESTS: readonly ForestPreset[] = [
  {
    id: "trail",
    name: "반딧불 오솔길",
    emoji: "🌲",
    blurb: "작은 숲. 빛 조각 3개, 괴물은 적어요. 처음이라면 여기서!",
    w: 11,
    h: 11,
    shards: 3,
    jars: 2,
    traps: 5,
    bridges: 3,
    fakeRavines: 1,
    monsters: (n) => (n <= 3 ? 1 : 2),
    loopRate: 0.14,
    rounds: { 2: 28, 3: 25, 4: 25, 5: 25 },
    hearts: { 2: 4, 3: 5, 4: 6, 5: 6 },
  },
  {
    id: "deep",
    name: "깊은 숲",
    emoji: "🌳",
    blurb: "길이 꼬이고 골짜기가 많아요. 다리 색 주인의 신호가 꼭 필요해요.",
    w: 13,
    h: 11,
    shards: 3,
    jars: 2,
    traps: 7,
    bridges: 4,
    fakeRavines: 2,
    monsters: (n) => Math.max(1, n - 1),
    loopRate: 0.12,
    rounds: { 2: 34, 3: 32, 4: 32, 5: 32 },
    hearts: { 2: 4, 3: 5, 4: 6, 5: 7 },
  },
  {
    id: "shadow",
    name: "그림자 숲",
    emoji: "🌑",
    blurb: "넓고 어두운 숲. 빛 조각 4개, 색마다 괴물 하나. 숙련 탐험대용.",
    w: 13,
    h: 13,
    shards: 4,
    jars: 2,
    traps: 9,
    bridges: 5,
    fakeRavines: 3,
    monsters: (n) => n,
    loopRate: 0.1,
    rounds: { 2: 42, 3: 42, 4: 42, 5: 42 },
    hearts: { 2: 5, 3: 6, 4: 7, 5: 8 },
  },
];

export function forestById(id: string): ForestPreset {
  return FORESTS.find((f) => f.id === id) ?? FORESTS[0];
}

export interface Forest {
  w: number;
  h: number;
  tiles: string;
  start: number;
  altar: number;
  shards: number[];
  jars: number[];
  bridges: { cell: number; color: number }[];
  traps: { cell: number; color: number }[];
  monsters: { color: number; path: number[] }[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function neighbors4(w: number, h: number, c: number): number[] {
  const x = c % w;
  const y = Math.floor(c / w);
  const out: number[] = [];
  if (y > 0) out.push(c - w);
  if (x < w - 1) out.push(c + 1);
  if (y < h - 1) out.push(c + w);
  if (x > 0) out.push(c - 1);
  return out;
}

export function manhattan(w: number, a: number, b: number): number {
  return Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
}

/** 길 따라 거리 (passable로 걸러서), 닿지 않으면 -1 */
export function bfs(w: number, h: number, from: number, passable: (c: number) => boolean): { dist: Int16Array; parent: Int16Array } {
  const dist = new Int16Array(w * h).fill(-1);
  const parent = new Int16Array(w * h).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const n of neighbors4(w, h, c)) {
      if (dist[n] !== -1 || !passable(n)) continue;
      dist[n] = dist[c] + 1;
      parent[n] = c;
      q.push(n);
    }
  }
  return { dist, parent };
}

function pathTo(parent: Int16Array, from: number, to: number): number[] {
  const out: number[] = [];
  let c = to;
  while (c !== -1 && c !== from) {
    out.push(c);
    c = parent[c];
  }
  return out.reverse();
}

function shuffle<T>(arr: T[], r: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tryGenerate(preset: ForestPreset, players: number, seed: number): Forest | null {
  const r = mulberry32(seed);
  const { w, h } = preset;
  const t: string[] = Array(w * h).fill(T_TREE);
  const at = (x: number, y: number) => y * w + x;

  // 1. 미로
  const stack: [number, number][] = [[1, 1]];
  t[at(1, 1)] = T_FLOOR;
  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const opts = shuffle(
      [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ].filter(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && t[at(nx, ny)] === T_TREE;
      }),
      r,
    );
    if (opts.length === 0) {
      stack.pop();
      continue;
    }
    const [dx, dy] = opts[0];
    t[at(x + dx / 2, y + dy / 2)] = T_FLOOR;
    t[at(x + dx, y + dy)] = T_FLOOR;
    stack.push([x + dx, y + dy]);
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (t[at(x, y)] !== T_TREE) continue;
      const horiz = t[at(x - 1, y)] === T_FLOOR && t[at(x + 1, y)] === T_FLOOR && t[at(x, y - 1)] === T_TREE && t[at(x, y + 1)] === T_TREE;
      const vert = t[at(x, y - 1)] === T_FLOOR && t[at(x, y + 1)] === T_FLOOR && t[at(x - 1, y)] === T_TREE && t[at(x + 1, y)] === T_TREE;
      if ((horiz || vert) && r() < preset.loopRate) t[at(x, y)] = T_FLOOR;
    }
  }
  // 2. 빈터
  const start = at(1, 1);
  const altar = at(w - 2, h - 2);
  const clearing = new Set<number>();
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) clearing.add(at(x, y));
  for (let y = h - 4; y <= h - 2; y++) for (let x = w - 4; x <= w - 2; x++) clearing.add(at(x, y));
  for (const c of clearing) t[c] = T_FLOOR;

  const floor = (c: number) => t[c] !== T_TREE;
  const fromStart = bfs(w, h, start, floor);
  const floorCells = t.map((v, i) => (v === T_FLOOR ? i : -1)).filter((i) => i >= 0);

  // 3. 빛 조각·반딧불 병 — 막다른 길 중 서로 멀리
  const deadEnds = floorCells.filter((c) => !clearing.has(c) && neighbors4(w, h, c).filter(floor).length === 1);
  const pickFar = (pool: number[], count: number, taken: number[]): number[] => {
    const chosen: number[] = [];
    const candidates = [...pool];
    while (chosen.length < count && candidates.length > 0) {
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const near = Math.min(...[...taken, ...chosen].map((o) => manhattan(w, c, o)));
        const score = near * 2 + fromStart.dist[c] * 0.3 + r() * 2;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      chosen.push(candidates[best]);
      candidates.splice(best, 1);
    }
    return chosen;
  };
  const extra = floorCells.filter((c) => !clearing.has(c) && fromStart.dist[c] >= 6);
  let shards = pickFar(deadEnds, preset.shards, [start, altar]);
  if (shards.length < preset.shards) shards = [...shards, ...pickFar(extra.filter((c) => !shards.includes(c)), preset.shards - shards.length, [start, altar, ...shards])];
  let jars = pickFar(
    deadEnds.filter((c) => !shards.includes(c)),
    preset.jars,
    [start, altar, ...shards],
  );
  if (jars.length < preset.jars) jars = [...jars, ...pickFar(extra.filter((c) => !shards.includes(c) && !jars.includes(c)), preset.jars - jars.length, [start, altar, ...shards, ...jars])];
  if (shards.length < preset.shards) return null;

  const special = new Set<number>([start, altar, ...shards, ...jars]);
  const nearSpecial = (c: number) => [...special].some((s) => manhattan(w, c, s) <= 1);

  // 꼭 지나야 하는 길
  const required = new Set<number>();
  for (const goal of [...shards, altar]) for (const c of pathTo(fromStart.parent, start, goal)) required.add(c);

  const isCorridor = (c: number) => {
    if (t[c] !== T_FLOOR || clearing.has(c) || nearSpecial(c) || fromStart.dist[c] < 3) return false;
    const x = c % w;
    const y = Math.floor(c / w);
    const ns = t[at(x, y - 1)] !== T_TREE && t[at(x, y + 1)] !== T_TREE && t[at(x - 1, y)] === T_TREE && t[at(x + 1, y)] === T_TREE;
    const ew = t[at(x - 1, y)] !== T_TREE && t[at(x + 1, y)] !== T_TREE && t[at(x, y - 1)] === T_TREE && t[at(x, y + 1)] === T_TREE;
    return ns || ew;
  };

  const ravines: number[] = [];
  const spaced = (c: number, list: number[], gap: number) => list.every((o) => manhattan(w, c, o) > gap);
  const colorOffset = Math.floor(r() * players);
  const bridges: { cell: number; color: number }[] = [];
  const onRequired = shuffle(
    floorCells.filter((c) => required.has(c) && isCorridor(c)),
    r,
  );
  for (const c of onRequired) {
    if (bridges.length >= preset.bridges) break;
    if (!spaced(c, ravines, 2)) continue;
    bridges.push({ cell: c, color: (colorOffset + bridges.length) % players });
    ravines.push(c);
  }
  // 꼭 지나야 하는 길이 짧으면 다른 곧은 통로에도 다리를 놓는다
  if (bridges.length < preset.bridges) {
    for (const c of shuffle(floorCells.filter(isCorridor), r)) {
      if (bridges.length >= preset.bridges) break;
      if (!spaced(c, ravines, 2)) continue;
      bridges.push({ cell: c, color: (colorOffset + bridges.length) % players });
      ravines.push(c);
    }
  }
  for (const b of bridges) t[b.cell] = T_RAVINE;
  const bridgeSet = new Set(bridges.map((b) => b.cell));
  const crossable = (c: number) => t[c] === T_FLOOR || (t[c] === T_RAVINE && bridgeSet.has(c));
  const allReachable = () => {
    const d = bfs(w, h, start, crossable).dist;
    return [...shards, ...jars, altar].every((g) => d[g] >= 0);
  };
  let fakes = 0;
  for (const c of shuffle(floorCells.filter((c) => !required.has(c) && isCorridor(c)), r)) {
    if (fakes >= preset.fakeRavines) break;
    if (!spaced(c, ravines, 2)) continue;
    t[c] = T_RAVINE;
    if (!allReachable()) {
      t[c] = T_FLOOR;
      continue;
    }
    ravines.push(c);
    fakes++;
  }

  // 5. 괴물 순찰로 (곧은 3~4칸)
  const monsters: { color: number; path: number[] }[] = [];
  const monsterCount = Math.min(preset.monsters(players), players * 2);
  const blocked = new Set<number>([...special, ...ravines, ...clearing]);
  const monsterCells = new Set<number>();
  const dirs = [1, -1, w, -w];
  for (const c of shuffle(floorCells.filter((c) => fromStart.dist[c] >= 6), r)) {
    if (monsters.length >= monsterCount) break;
    for (const d of shuffle([...dirs], r)) {
      const len = r() < 0.5 ? 3 : 4;
      const path: number[] = [];
      let cur = c;
      let ok = true;
      for (let k = 0; k < len; k++) {
        if (k > 0) {
          // 가로 이동은 줄이 바뀌면 안 된다
          if ((d === 1 || d === -1) && Math.floor(cur / w) !== Math.floor((cur + d) / w)) {
            ok = false;
            break;
          }
          cur += d;
        }
        if (cur < 0 || cur >= w * h || t[cur] !== T_FLOOR || blocked.has(cur) || [...monsterCells].some((m) => manhattan(w, m, cur) <= 2)) {
          ok = false;
          break;
        }
        path.push(cur);
      }
      if (!ok || path.length < 3) continue;
      monsters.push({ color: (colorOffset + 1 + monsters.length) % players, path });
      for (const p of path) monsterCells.add(p);
      break;
    }
  }

  // 6. 함정
  const trapTotal = Math.round(preset.traps * (0.6 + 0.12 * players));
  const traps: { cell: number; color: number }[] = [];
  const trapOk = (c: number) =>
    t[c] === T_FLOOR && !blocked.has(c) && !monsterCells.has(c) && !nearSpecial(c) && fromStart.dist[c] >= 3 && traps.every((o) => manhattan(w, c, o.cell) > 1);
  const pool = shuffle(floorCells.filter(trapOk), r);
  // 절반쯤은 꼭 지나야 하는 길 위에 — 안 그러면 함정이 아무도 안 가는 곳에만 깔린다
  pool.sort((a, b) => (required.has(b) ? 1 : 0) - (required.has(a) ? 1 : 0) + (r() - 0.5) * 1.2);
  for (const c of pool) {
    if (traps.length >= trapTotal) break;
    if (!trapOk(c)) continue;
    traps.push({ cell: c, color: (colorOffset + 2 + traps.length) % players });
  }

  if (!allReachable()) return null;
  return { w, h, tiles: t.join(""), start, altar, shards, jars, bridges, traps, monsters };
}

export function generateForest(forestId: string, players: number, seed: number): Forest {
  const preset = forestById(forestId);
  const n = Math.max(1, Math.min(5, Math.floor(players)));
  for (let k = 0; k < 40; k++) {
    const f = tryGenerate(preset, n, (seed + k * 7919) >>> 0);
    if (f) return f;
  }
  throw new Error("forest generation failed");
}

/**
 * 등불이 비추는 칸 — 나무에 막히는 길 거리 `radius` 안의 길·골짜기와, 그 칸들에 붙은
 * 나무(대각선 포함). 골짜기 위로는 빛이 넘어간다. "?"(모르는 칸)는 막힌 것으로 본다.
 */
export function litCells(tiles: string, w: number, h: number, from: number, radius: number): Set<number> {
  const open = (c: number) => tiles[c] === T_FLOOR || tiles[c] === T_RAVINE;
  const d = bfs(w, h, from, open).dist;
  const out = new Set<number>();
  for (let c = 0; c < w * h; c++) {
    if (d[c] < 0 || d[c] > radius) continue;
    out.add(c);
    const x = c % w;
    const y = Math.floor(c / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (tiles[n] === T_TREE) out.add(n);
      }
    }
  }
  return out;
}
