/**
 * 낙서 결투 — arena maps. Pure data shared by the engine (terrain shape +
 * small rule tweaks) and the art layer (which picks its palette by id).
 */

export const MAP_IDS = ["meadow", "desert", "snow", "volcano"] as const;
export type MapId = (typeof MAP_IDS)[number];

export interface MapInfo {
  id: MapId;
  emoji: string;
  name: string;
  /** One-line rule tweak shown in the lobby. */
  rule: string;
  /** Terrain generator: base height and the amplitude of each sine layer (low → high frequency). */
  terrain: { base: number; amps: [number, number, number]; freqs: [number, number, number] };
  /** Wind strength multiplier. */
  windMul: number;
  /** Crater size multiplier (soft snow digs deep, volcanic rock barely dents). */
  craterMul: number;
}

export const MAPS: Record<MapId, MapInfo> = {
  meadow: {
    id: "meadow",
    emoji: "🌼",
    name: "공책 들판",
    rule: "기본 규칙 — 완만한 언덕",
    terrain: { base: 400, amps: [45, 24, 8], freqs: [0.006, 0.017, 0.04] },
    windMul: 1,
    craterMul: 1,
  },
  desert: {
    id: "desert",
    emoji: "🏜️",
    name: "모래 사막",
    rule: "바람 1.6배 — 길고 부드러운 모래 언덕",
    terrain: { base: 410, amps: [60, 14, 3], freqs: [0.0045, 0.012, 0.03] },
    windMul: 1.6,
    craterMul: 1.1,
  },
  snow: {
    id: "snow",
    emoji: "❄️",
    name: "눈 덮인 산",
    rule: "푹신한 눈 — 구덩이 1.4배",
    terrain: { base: 385, amps: [70, 30, 10], freqs: [0.005, 0.016, 0.045] },
    windMul: 1.1,
    craterMul: 1.4,
  },
  volcano: {
    id: "volcano",
    emoji: "🌋",
    name: "불꽃 화산",
    rule: "단단한 현무암 — 구덩이 0.7배, 들쭉날쭉한 지형",
    terrain: { base: 405, amps: [40, 34, 18], freqs: [0.007, 0.022, 0.06] },
    windMul: 0.8,
    craterMul: 0.7,
  },
};

export function isMapId(v: unknown): v is MapId {
  return typeof v === "string" && (MAP_IDS as readonly string[]).includes(v);
}

/** Number of selectable characters (art lives in arenaArt.ts CHARACTERS, same order). */
export const CHARACTER_COUNT = 6;
