/**
 * 섬 개척자 — tile catalogue. Rules: boardGameRule/섬개척자/섬개척자.md §2.
 *
 * Every tile is split corner-to-corner into four triangles (N, E, S, W). Each
 * triangle has one terrain, and the edge of the tile on that side IS that
 * triangle — so "edges must match" is just "the touching triangles have the
 * same terrain". Inside a tile, two neighbouring triangles (N–E, E–S, S–W,
 * W–N) of the same terrain are one piece of land; opposite triangles only join
 * through a neighbour of the same terrain.
 *
 * Resources: some tiles show one icon on one triangle (🪵 in forest, 🐑 in
 * meadow, 💎 in mountain, 🐟 in sea — the icon always matches its terrain).
 */

export type Terrain = 0 | 1 | 2 | 3;
export const FOREST: Terrain = 0;
export const MEADOW: Terrain = 1;
export const MOUNTAIN: Terrain = 2;
export const SEA: Terrain = 3;

export const TERRAIN_NAMES = ["숲", "초원", "산", "바다"] as const;
export const TERRAIN_EMOJI = ["🌲", "🌾", "⛰️", "🌊"] as const;
export const RESOURCE_NAMES = ["목재", "양털", "광석", "물고기"] as const;
export const RESOURCE_EMOJI = ["🪵", "🐑", "💎", "🐟"] as const;

export interface TileDef {
  /** Terrain of the N, E, S, W triangles (rotation 0). */
  q: readonly [Terrain, Terrain, Terrain, Terrain];
  /** Triangle (rotation 0) that carries a resource icon, or -1. */
  res: number;
}

const L: Record<string, Terrain> = { F: 0, M: 1, R: 2, S: 3 };

/**
 * Deck composition (60 tiles). Letters are N E S W: F 숲, M 초원, R 산, S 바다.
 * Counted so that land dominates (an island grows out of the sea) and every
 * terrain appears in enough two-terrain tiles to keep the frontier fillable.
 */
const TEMPLATES: [string, number][] = [
  ["FFFF", 3], ["MMMM", 3], ["RRRR", 1], ["SSSS", 2],
  ["FFFM", 3], ["FFFS", 3], ["MMMF", 3], ["MMMS", 3], ["RRRM", 2], ["RRRF", 2], ["SSSF", 2], ["SSSM", 2], ["SSSR", 1],
  ["FFMM", 3], ["FFSS", 3], ["MMSS", 3], ["RRSS", 2], ["FFRR", 2], ["MMRR", 2],
  ["FMFM", 2], ["FSFS", 1], ["MSMS", 1], ["MRMR", 1],
  ["FFMS", 2], ["MMFS", 2], ["FFRS", 1], ["MMRS", 1], ["RRFM", 1], ["SSFM", 2],
  ["FMRS", 1],
];

function buildDeck(): TileDef[] {
  const out: TileDef[] = [];
  // tile 0 — 🏕️ 상륙 캠프 (always in the middle at the start)
  out.push({ q: [0, 1, 3, 2], res: -1 });
  let i = 0;
  for (const [pattern, count] of TEMPLATES) {
    const q = pattern.split("").map((c) => L[c]) as unknown as TileDef["q"];
    for (let k = 0; k < count; k++) {
      // every other tile carries one resource; which triangle cycles so the icons spread over terrains
      let res = -1;
      if (i % 2 === 1) {
        const start = (i * 3 + k) % 4;
        res = start;
      }
      out.push({ q, res });
      i++;
    }
  }
  return out;
}

export const TILE_DEFS: readonly TileDef[] = buildDeck();
export const START_TILE = 0;
/** Ids of the 60 deck tiles (everything except the start camp). */
export const DECK_IDS: readonly number[] = TILE_DEFS.map((_, id) => id).filter((id) => id !== START_TILE);

/** Terrain of tile `tile` turned `rot` quarter-turns clockwise, on side `dir` (0 N, 1 E, 2 S, 3 W). */
export function quadTerrain(tile: number, rot: number, dir: number): Terrain {
  return TILE_DEFS[tile].q[(((dir - rot) % 4) + 4) % 4];
}

/** Side (after rotation) that carries the resource icon, or -1. */
export function resourceDir(tile: number, rot: number): number {
  const r = TILE_DEFS[tile].res;
  return r < 0 ? -1 : (r + rot) % 4;
}

/** The four sides' terrain after rotation. */
export function rotatedQuads(tile: number, rot: number): [Terrain, Terrain, Terrain, Terrain] {
  return [quadTerrain(tile, rot, 0), quadTerrain(tile, rot, 1), quadTerrain(tile, rot, 2), quadTerrain(tile, rot, 3)];
}

/** Rotations that look different (FFFF has one, FMFM two, …). Resource position counts. */
export function distinctRotations(tile: number): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let rot = 0; rot < 4; rot++) {
    const key = `${rotatedQuads(tile, rot).join("")}:${resourceDir(tile, rot)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rot);
  }
  return out;
}
