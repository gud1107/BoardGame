/**
 * 얼어붙은 호수 = 뾰족한 위(pointy-top) 육각 얼음 칸. 축 좌표(q, r) → 평면 (x, z).
 * 화면 기준 x → 오른쪽, z → 아래(카메라 쪽).
 *
 * 호수는 6개 **구역**(부채꼴)으로 나뉜다 — 해빙 경보가 한 구역씩 비춘다. 가운데 칸은
 * 어느 구역에도 속하지 않는다(해빙을 안 받음, 서든데스 마지막에만 깨짐).
 */

export const HEX = 1.15;
const SQ3 = Math.sqrt(3);
/** 구역 경계에 칸 중심이 딱 걸리지 않게 살짝 돌려 둔다 (기기마다 atan2 끝자리가 달라도 같은 구역) */
const SECTOR_TWIST = 0.013;

export interface Tile {
  q: number;
  r: number;
  ring: number;
  x: number;
  z: number;
  /** 0~5, 가운데 칸은 -1 */
  sector: number;
}

export interface LakeGeo {
  rings: number;
  tiles: Tile[];
  index: Map<string, number>;
  /** 호수 가장자리까지 대략의 반지름 */
  radius: number;
  /** 고리별 타일 번호 (서든데스: 바깥 고리부터) */
  byRing: number[][];
  /** 구역별 타일 번호 */
  bySector: number[][];
}

export function ringsFor(players: number): number {
  return players <= 2 ? 4 : players <= 4 ? 5 : 6;
}

export function hexToWorld(q: number, r: number): { x: number; z: number } {
  return { x: HEX * SQ3 * (q + r / 2), z: HEX * 1.5 * r };
}

/** 평면 좌표가 속한 구역 (가운데 근처는 -1) */
export function sectorOf(x: number, z: number): number {
  if (Math.hypot(x, z) < HEX * 0.5) return -1;
  const a = Math.atan2(z, x) + Math.PI + SECTOR_TWIST;
  return Math.floor(a / (Math.PI / 3)) % 6;
}

/** 구역 가운데 방향 (라디안, x=cos z=sin) */
export function sectorAngle(sector: number): number {
  return -Math.PI - SECTOR_TWIST + (sector + 0.5) * (Math.PI / 3);
}

/** 구역 경계 두 각 [시작, 끝] */
export function sectorSpan(sector: number): [number, number] {
  const a0 = -Math.PI - SECTOR_TWIST + sector * (Math.PI / 3);
  return [a0, a0 + Math.PI / 3];
}

const cache = new Map<number, LakeGeo>();

export function lakeGeo(rings: number): LakeGeo {
  const hit = cache.get(rings);
  if (hit) return hit;
  const tiles: Tile[] = [];
  const byRing: number[][] = Array.from({ length: rings + 1 }, () => []);
  const bySector: number[][] = Array.from({ length: 6 }, () => []);
  for (let ring = 0; ring <= rings; ring++) {
    for (let q = -ring; q <= ring; q++) {
      for (let r = -ring; r <= ring; r++) {
        const s = -q - r;
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) !== ring) continue;
        const { x, z } = hexToWorld(q, r);
        const sector = ring === 0 ? -1 : sectorOf(x, z);
        byRing[ring].push(tiles.length);
        if (sector >= 0) bySector[sector].push(tiles.length);
        tiles.push({ q, r, ring, x, z, sector });
      }
    }
  }
  const index = new Map(tiles.map((t, i) => [`${t.q},${t.r}`, i]));
  const geo: LakeGeo = { rings, tiles, index, radius: rings * HEX * SQ3 + HEX, byRing, bySector };
  cache.set(rings, geo);
  return geo;
}

/** 평면 좌표가 올라 있는 타일 번호 (호수 밖이면 -1) */
export function tileIndexAt(geo: LakeGeo, x: number, z: number): number {
  const fq = ((SQ3 / 3) * x - z / 3) / HEX;
  const fr = ((2 / 3) * z) / HEX;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  const i = geo.index.get(`${q},${r}`);
  return i === undefined ? -1 : i;
}
