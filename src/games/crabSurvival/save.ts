/**
 * Local profile for 꽃게 서바이벌 (browser-only): nickname, shell colour,
 * preferred match length, and lifetime records. Corrupt saves fall back to a
 * fresh profile.
 */

import { CRAB_COLORS, MATCH_LENGTHS } from "./data";

export interface CrabSave {
  version: 1;
  name: string;
  colorId: string;
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
}

const KEY = "crab-survival-save-v1";

export function freshSave(): CrabSave {
  return {
    version: 1,
    name: "",
    colorId: CRAB_COLORS[0].id,
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
  };
}

export function loadSave(): CrabSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const parsed = JSON.parse(raw) as Partial<CrabSave>;
    if (parsed.version !== 1) return freshSave();
    return { ...freshSave(), ...parsed };
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

/** Trophy points for a finish: podium-heavy, everyone in the top half scores. */
export function trophiesFor(rank: number, total: number): number {
  if (rank === 1) return 30;
  if (rank === 2) return 20;
  if (rank === 3) return 14;
  if (rank <= Math.ceil(total / 2)) return 8;
  return 2;
}
