import { COURSES, CRUMBLY, LEDGE, OVERHANG, ROCK, SMOOTH, WALL_W, type Cell, type CourseId, type ObstacleKind } from "./data";

/**
 * 벽 만들기 (룰북 §3). 씨앗과 산 종류만으로 정해지므로 방장·손님이 같은 벽을 각자 만든다.
 *
 * 칸 좌표: 열 c = 0..WALL_W−1 (x = c − WALL_W/2 .. +1), 행 r = 0..height (y = r .. r+1).
 * 0행은 출발 바닥(전체 턱), height행은 정상(전체 턱). 그 위는 하늘(잡을 수 없음).
 * 장애물은 반드시 잡을 수 있는 길을 하나 이상 남긴다 (`reachable`로 테스트).
 */

export interface Course {
  id: CourseId;
  height: number;
  /** 행 우선 (r * WALL_W + c) */
  cells: Cell[];
  /** 캠프(체크포인트) 행들 — 0번은 출발 바닥 */
  camps: { row: number; c0: number; c1: number }[];
  /** ⭐ 위치 (칸 중심 좌표) */
  stars: { x: number; y: number }[];
  /** 매끈한 띠 (봇·안내용): 행 r0..r1, 틈(오버행) 열 */
  bands: { r0: number; r1: number; crack: number }[];
}

function mulberry(seed: number) {
  let a = seed | 0;
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, Course>();

export function buildCourse(seed: number, id: CourseId): Course {
  const key = `${seed}:${id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = COURSES[id];
  const H = spec.height;
  const rnd = mulberry(seed ^ 0x51ed270b);
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const cells: Cell[] = Array((H + 1) * WALL_W).fill(ROCK);
  const set = (r: number, c: number, v: Cell) => {
    if (r >= 1 && r < H && c >= 0 && c < WALL_W) cells[r * WALL_W + c] = v;
  };
  for (let c = 0; c < WALL_W; c++) {
    cells[c] = LEDGE;
    cells[H * WALL_W + c] = LEDGE;
  }
  // 캠프: 높이를 고르게 나눈 행에 너비 6칸 턱
  const camps: Course["camps"] = [{ row: 0, c0: 0, c1: WALL_W - 1 }];
  const campRows = new Set<number>();
  for (let k = 1; k <= spec.camps; k++) {
    const row = Math.round((k * H) / (spec.camps + 1));
    const c0 = ri(1, WALL_W - 7);
    camps.push({ row, c0, c1: c0 + 5 });
    campRows.add(row);
  }
  const bands: Course["bands"] = [];
  const stars: Course["stars"] = [];
  // 장애물: 아래에서 위로, 캠프 행과 그 바로 위아래는 비워 둔다
  let r = 3;
  let ki = ri(0, spec.kinds.length - 1);
  const free = (r0: number, r1: number) => {
    for (let q = r0 - 1; q <= r1 + 1; q++) if (campRows.has(q)) return false;
    return r1 < H - 1;
  };
  while (r < H - 2) {
    const kind: ObstacleKind = spec.kinds[ki % spec.kinds.length];
    ki += 1 + (rnd() < 0.3 ? 1 : 0);
    const h = kind === "band3" ? 3 : kind === "chimney" ? 4 : kind === "patch" ? 3 : 2;
    if (!free(r, r + h - 1)) {
      r += 1;
      continue;
    }
    if (kind === "band2" || kind === "band3") {
      // 벽 전체를 가로지르는 매끈한 띠 + 오버행 틈 한 줄
      const crack = ri(1, WALL_W - 2);
      for (let q = r; q < r + h; q++) for (let c = 0; c < WALL_W; c++) set(q, c, c === crack ? OVERHANG : SMOOTH);
      bands.push({ r0: r, r1: r + h - 1, crack });
      // ⭐ 띠 한가운데 — 줄에 매달려야 닿는다
      if (stars.length < 3 && rnd() < 0.75) {
        let sc = ri(1, WALL_W - 2);
        if (Math.abs(sc - crack) < 2) sc = crack >= WALL_W / 2 ? crack - 3 : crack + 3;
        stars.push({ x: sc - WALL_W / 2 + 0.5, y: r + h / 2 });
      }
    } else if (kind === "chimney") {
      // 4칸 높이 매끈한 벽, 한쪽 끝에만 두 칸 너비 바위 길
      const left = rnd() < 0.5;
      for (let q = r; q < r + h; q++) for (let c = 0; c < WALL_W; c++) set(q, c, (left ? c < 2 : c >= WALL_W - 2) ? ROCK : SMOOTH);
      bands.push({ r0: r, r1: r + h - 1, crack: left ? 0 : WALL_W - 1 });
    } else if (kind === "roof") {
      // 오버행 지붕: 전체 오버행, 가운데쯤 매끈한 구멍
      const hole = ri(2, WALL_W - 5);
      for (let q = r; q < r + h; q++) for (let c = 0; c < WALL_W; c++) set(q, c, c >= hole && c < hole + 3 ? SMOOTH : OVERHANG);
      // 지붕 위 작은 쉼터
      const lc = ri(1, WALL_W - 3);
      if (free(r + h, r + h)) {
        set(r + h, lc, LEDGE);
        set(r + h, lc + 1, LEDGE);
      }
    } else if (kind === "crumble") {
      // 부서지는 띠: 단단한 바위 기둥 두 줄만 남긴다
      const a = ri(0, WALL_W - 1);
      const b = (a + ri(4, 9)) % WALL_W;
      for (let q = r; q < r + h; q++) for (let c = 0; c < WALL_W; c++) set(q, c, c === a || c === b ? ROCK : CRUMBLY);
    } else {
      // 매끈한 얼룩 2~3개 (돌아가면 된다)
      const n = ri(2, 3);
      for (let k = 0; k < n; k++) {
        const w = ri(2, 4);
        const c0 = ri(0, WALL_W - w);
        const hh = ri(2, 3);
        for (let q = r; q < r + hh; q++) for (let c = c0; c < c0 + w; c++) set(q, c, SMOOTH);
      }
      // 길 하나는 꼭 남긴다
      const keep = ri(0, WALL_W - 1);
      for (let q = r; q < r + 3; q++) set(q, keep, ROCK);
      if (stars.length < 3 && rnd() < 0.4) stars.push({ x: ri(1, WALL_W - 2) - WALL_W / 2 + 0.5, y: r + 1.5 });
    }
    // 장애물 바로 위엔 두 칸짜리 쉼터 (체력 회복) — 띠는 틈 근처에
    if (kind !== "roof" && free(r + h, r + h)) {
      const band = bands[bands.length - 1];
      const near = band && band.r0 === r ? Math.max(1, Math.min(WALL_W - 3, band.crack + (rnd() < 0.5 ? -2 : 1))) : ri(1, WALL_W - 3);
      set(r + h, near, LEDGE);
      set(r + h, near + 1, LEDGE);
    }
    // 장애물 사이엔 바위가 최소 2줄 — 끌어올려진 사람이 잡을 자리
    r += h + Math.max(2, ri(spec.gapMin, spec.gapMax) - 1);
  }
  // 캠프 턱은 장애물 위에 덮어쓴다
  for (const cp of camps.slice(1)) for (let c = cp.c0; c <= cp.c1; c++) cells[cp.row * WALL_W + c] = LEDGE;
  // 별이 모자라면 캠프 사이 바위에 채운다
  let guard = 0;
  while (stars.length < 3 && guard++ < 40) {
    const row = ri(4, H - 3);
    const col = ri(0, WALL_W - 1);
    if (campRows.has(row)) continue;
    stars.push({ x: col - WALL_W / 2 + 0.5, y: row + 0.5 });
  }
  const course: Course = { id, height: H, cells, camps, stars, bands };
  if (cache.size > 12) cache.clear();
  cache.set(key, course);
  return course;
}

/** 좌표가 든 칸 번호 (-1 = 벽 밖) */
export function cellIndex(course: Course, x: number, y: number): number {
  const c = Math.floor(x + WALL_W / 2);
  const r = Math.floor(y);
  if (c < 0 || c >= WALL_W || r < 0 || r > course.height) return -1;
  return r * WALL_W + c;
}

export function grippable(v: Cell | undefined): boolean {
  return v === ROCK || v === LEDGE || v === CRUMBLY || v === OVERHANG;
}

/**
 * 정상까지의 거리장 (잡을 수 있는 칸만, 8방향). 봇 길찾기와 "길이 반드시 있다" 테스트에 쓴다.
 * 값이 작을수록 정상에 가깝다. 못 가는 칸은 Infinity.
 */
export function distanceField(course: Course, cells: Cell[] = course.cells): number[] {
  const n = cells.length;
  const dist: number[] = Array(n).fill(Infinity);
  const cost = (v: Cell) => (v === LEDGE ? 0.6 : v === CRUMBLY ? 1.3 : v === OVERHANG ? 3.6 : 1);
  // 칸 수가 적어(≤ 840) 단순한 배열 다익스트라로 충분
  const open: number[] = [];
  for (let c = 0; c < WALL_W; c++) {
    const i = course.height * WALL_W + c;
    dist[i] = 0;
    open.push(i);
  }
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
    const i = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const r = Math.floor(i / WALL_W);
    const c = i % WALL_W;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr > course.height || cc < 0 || cc >= WALL_W) continue;
        const j = rr * WALL_W + cc;
        if (!grippable(cells[j])) continue;
        // 대각선은 모서리 두 칸 중 하나는 잡을 수 있어야 지나간다
        if (dr && dc && !grippable(cells[r * WALL_W + cc]) && !grippable(cells[rr * WALL_W + c])) continue;
        const d = dist[i] + cost(cells[j]) * (dr && dc ? 1.41 : 1);
        if (d < dist[j]) {
          if (dist[j] === Infinity) open.push(j);
          dist[j] = d;
        }
      }
  }
  return dist;
}

/** 출발 바닥에서 정상까지 잡을 수 있는 길이 있나 */
export function reachable(course: Course): boolean {
  const d = distanceField(course);
  for (let c = 0; c < WALL_W; c++) if (d[c] < Infinity) return true;
  return false;
}
