/**
 * Local progress for 묘수 도장 (browser-only): best stars per stage and
 * whether the answer was revealed (a revealed answer caps that stage at ⭐).
 * Corrupt saves fall back to fresh.
 */

import { ALL_IDS, BOOKS, type BookId } from "./books";

export interface StageRecord {
  stars: number;
  /** "정답 보기" was used at least once. */
  peeked: boolean;
  tries: number;
}

export interface DojoSave {
  version: 1;
  records: Record<string, StageRecord>;
  book: BookId;
  muted: boolean;
}

const KEY = "myosu-dojo-save-v1";

export function freshSave(): DojoSave {
  return { version: 1, records: {}, book: "chess", muted: false };
}

export function loadSave(): DojoSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const s = { ...freshSave(), ...(JSON.parse(raw) as Partial<DojoSave>) };
    if (typeof s.records !== "object" || !s.records) s.records = {};
    if (!BOOKS.some((b) => b.id === s.book)) s.book = "chess";
    return s;
  } catch {
    return freshSave();
  }
}

export function writeSave(s: DojoSave) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / private mode */
  }
}

/** First stage of each chapter is open; the rest open once the previous one is cleared. */
export function isUnlocked(s: DojoSave, id: string): boolean {
  for (const b of BOOKS)
    for (const c of b.chapters) {
      const i = c.ids.findIndex((x) => x.id === id);
      if (i < 0) continue;
      return i === 0 || (s.records[c.ids[i - 1].id]?.stars ?? 0) > 0;
    }
  return false;
}

export function applyRun(s: DojoSave, id: string, stars: number, peeked: boolean): DojoSave {
  const prev = s.records[id];
  const p = (prev?.peeked ?? false) || peeked;
  const capped = p ? Math.min(stars, 1) : stars;
  const rec: StageRecord = { stars: Math.max(prev?.stars ?? 0, capped), peeked: p, tries: (prev?.tries ?? 0) + 1 };
  return { ...s, records: { ...s.records, [id]: rec } };
}

export function totals(s: DojoSave, book?: BookId) {
  const ids = book ? BOOKS.find((b) => b.id === book)!.chapters.flatMap((c) => c.ids.map((x) => x.id)) : ALL_IDS;
  let stars = 0;
  let cleared = 0;
  let perfect = 0;
  for (const id of ids) {
    const r = s.records[id];
    if (!r) continue;
    stars += r.stars;
    if (r.stars > 0) cleared++;
    if (r.stars === 3) perfect++;
  }
  return { stars, cleared, perfect, maxStars: ids.length * 3, count: ids.length };
}
