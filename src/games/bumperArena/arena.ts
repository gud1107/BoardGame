/**
 * 섬 = 뾰족한 위가 위로 가는(pointy-top) 육각 타일. 축 좌표(q, r) → 평면 (x, z).
 * 링 0(가운데 한 칸)은 절대 무너지지 않는다. 인원이 많을수록 링이 늘어난다.
 */

export const HEX = 1.3;
const SQ3 = Math.sqrt(3);

export interface Tile {
  q: number;
  r: number;
  ring: number;
  x: number;
  z: number;
}

export interface ArenaGeo {
  rings: number;
  tiles: Tile[];
  index: Map<string, number>;
  /** 섬 가장자리까지 대략의 반지름 */
  radius: number;
  /** 링별 타일 번호 (바깥 링부터 무너뜨릴 때 쓴다) */
  byRing: number[][];
}

export function ringsFor(players: number): number {
  return players <= 2 ? 3 : players <= 4 ? 4 : 5;
}

export function hexToWorld(q: number, r: number): { x: number; z: number } {
  return { x: HEX * SQ3 * (q + r / 2), z: HEX * 1.5 * r };
}

const cache = new Map<number, ArenaGeo>();

export function arenaGeo(rings: number): ArenaGeo {
  const hit = cache.get(rings);
  if (hit) return hit;
  const tiles: Tile[] = [];
  const byRing: number[][] = Array.from({ length: rings + 1 }, () => []);
  for (let ring = 0; ring <= rings; ring++) {
    for (let q = -ring; q <= ring; q++) {
      for (let r = -ring; r <= ring; r++) {
        const s = -q - r;
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) !== ring) continue;
        const { x, z } = hexToWorld(q, r);
        byRing[ring].push(tiles.length);
        tiles.push({ q, r, ring, x, z });
      }
    }
  }
  const index = new Map(tiles.map((t, i) => [`${t.q},${t.r}`, i]));
  const geo: ArenaGeo = { rings, tiles, index, radius: rings * HEX * SQ3 + HEX, byRing };
  cache.set(rings, geo);
  return geo;
}

/** 평면 좌표가 올라 있는 타일 번호 (섬 밖이면 -1) */
export function tileIndexAt(geo: ArenaGeo, x: number, z: number): number {
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

/** 범퍼 기둥이 서는 타일 (4링: 2개, 5링: 3개, 3링: 없음) */
export function postTiles(geo: ArenaGeo): number[] {
  const pick = (q: number, r: number) => geo.index.get(`${q},${r}`);
  const list =
    geo.rings >= 5
      ? [pick(0, -3), pick(3, 0), pick(-3, 3)]
      : geo.rings === 4
        ? [pick(2, 0), pick(-2, 0)]
        : [];
  return list.filter((i): i is number => i !== undefined);
}
