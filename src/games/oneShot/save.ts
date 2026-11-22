/**
 * Local progress for 한 발의 묘수 (browser-only): best stars, fewest bullets
 * and 💎 묘수 per stage, plus a few toggles. Corrupt saves fall back to fresh.
 */

import { STAGES } from "./stages";

export interface StageRecord {
  stars: number;
  bullets: number;
  myosu: boolean;
  /** Answer ghost (hint 3) was opened at least once — caps stars at ⭐⭐. */
  ghost: boolean;
}

export interface OneShotSave {
  version: 1;
  records: Record<string, StageRecord>;
  lastStage: string;
  live: boolean;
  muted: boolean;
}

const KEY = "one-shot-save-v1";

export function freshSave(): OneShotSave {
  return { version: 1, records: {}, lastStage: STAGES[0].id, live: false, muted: false };
}

export function loadSave(): OneShotSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const s = { ...freshSave(), ...(JSON.parse(raw) as Partial<OneShotSave>) };
    if (typeof s.records !== "object" || !s.records) s.records = {};
    if (!STAGES.some((x) => x.id === s.lastStage)) s.lastStage = STAGES[0].id;
    return s;
  } catch {
    return freshSave();
  }
}

export function writeSave(s: OneShotSave) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / private mode */
  }
}

export function isUnlocked(s: OneShotSave, id: string): boolean {
  const i = STAGES.findIndex((x) => x.id === id);
  if (i <= 0) return i === 0;
  return (s.records[STAGES[i - 1].id]?.stars ?? 0) > 0;
}

export function totals(s: OneShotSave) {
  let stars = 0;
  let cleared = 0;
  let myosu = 0;
  for (const st of STAGES) {
    const r = s.records[st.id];
    if (!r) continue;
    stars += r.stars;
    if (r.stars > 0) cleared++;
    if (r.myosu) myosu++;
  }
  return { stars, cleared, myosu, maxStars: STAGES.length * 3, myosuStages: STAGES.filter((x) => x.myosu).length };
}

export function applyRun(s: OneShotSave, id: string, stars: number, bullets: number, myosu: boolean, ghost: boolean): OneShotSave {
  const prev = s.records[id];
  const rec: StageRecord = {
    stars: Math.max(prev?.stars ?? 0, stars),
    bullets: stars > 0 ? Math.min(prev?.bullets ?? Infinity, bullets) : (prev?.bullets ?? 0),
    myosu: (prev?.myosu ?? false) || myosu,
    ghost: (prev?.ghost ?? false) || ghost,
  };
  if (!Number.isFinite(rec.bullets)) rec.bullets = 0;
  return { ...s, records: { ...s.records, [id]: rec }, lastStage: id };
}
