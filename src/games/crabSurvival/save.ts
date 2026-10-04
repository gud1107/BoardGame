/**
 * Local profile for 꽃게 서바이벌 (browser-only): nickname, shell colour,
 * preferred match length, and lifetime records. Corrupt saves fall back to a
 * fresh profile.
 */

import { CRAB_COLORS, MATCH_LENGTHS, SPECIES, type SpeciesId } from "./data";

export interface CrabSave {
  version: 1;
  name: string;
  colorId: string;
  species: SpeciesId;
  duration: number;
  muted: boolean;
  followMouse: boolean;
  best: number;
  matches: number;
  wins: number;
  trophies: number;
  totalKills: number;
  kingSeconds: number;
  maxLevel: number;
  /** Per-species lifetime records. */
  speciesStats: Partial<Record<SpeciesId, SpeciesRecord>>;
  /** The lobby's "처음이라면" tip card was dismissed. */
  tipsDismissed: boolean;
}

export interface SpeciesRecord {
  best: number;
  wins: number;
  matches: number;
  maxLevel: number;
  /** Most legendary-bounty points cashed in a single match (absent on pre-10-04 saves). */
  bestBounty?: number;
  /** Longest legendary carry in a single match, seconds. */
  longestEpic?: number;
}

export const EMPTY_RECORD: SpeciesRecord = { best: 0, wins: 0, matches: 0, maxLevel: 1, bestBounty: 0, longestEpic: 0 };

const KEY = "crab-survival-save-v1";

export function freshSave(): CrabSave {
  return {
    version: 1,
    name: "",
    colorId: CRAB_COLORS[0].id,
    species: "flower",
    duration: MATCH_LENGTHS[1].seconds,
    muted: false,
    followMouse: true,
    best: 0,
    matches: 0,
    wins: 0,
    trophies: 0,
    totalKills: 0,
    kingSeconds: 0,
    maxLevel: 1,
    speciesStats: {},
    tipsDismissed: false,
  };
}

export function loadSave(): CrabSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const parsed = JSON.parse(raw) as Partial<CrabSave>;
    if (parsed.version !== 1) return freshSave();
    const merged = { ...freshSave(), ...parsed };
    if (!SPECIES[merged.species]) merged.species = "flower";
    return merged;
  } catch {
    return freshSave();
  }
}

export function writeSave(save: CrabSave) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode / storage full — records just won't persist */
  }
}

/** Fold one finished match into a species record; flags which per-species records it broke. */
export function nextSpeciesRecord(
  prev: SpeciesRecord,
  m: { score: number; rank: number; maxLevel: number; bountyPoints?: number; epicSeconds?: number },
): { record: SpeciesRecord; bountyRecord: boolean; epicRecord: boolean } {
  const bounty = m.bountyPoints ?? 0;
  const epic = Math.round(m.epicSeconds ?? 0);
  return {
    record: {
      best: Math.max(prev.best, m.score),
      wins: prev.wins + (m.rank === 1 ? 1 : 0),
      matches: prev.matches + 1,
      maxLevel: Math.max(prev.maxLevel, m.maxLevel),
      bestBounty: Math.max(prev.bestBounty ?? 0, bounty),
      longestEpic: Math.max(prev.longestEpic ?? 0, epic),
    },
    bountyRecord: bounty > 0 && bounty > (prev.bestBounty ?? 0),
    epicRecord: epic > 0 && epic > (prev.longestEpic ?? 0),
  };
}

/** Trophy points for a finish: podium-heavy, everyone in the top half scores. */
export function trophiesFor(rank: number, total: number): number {
  if (rank === 1) return 30;
  if (rank === 2) return 20;
  if (rank === 3) return 14;
  if (rank <= Math.ceil(total / 2)) return 8;
  return 2;
}
