import { describe, expect, it } from "vitest";
import { PATCH_NOTES, PATCH_NOTE_DESC_MAX } from "./patchNotes";
import { DAY_GROUP_COLLAPSE_AT, PATCH_NOTE_DAY_SUMMARIES, groupPatchNotesByDay } from "./patchNoteDays";

describe("groupPatchNotesByDay", () => {
  const days = groupPatchNotesByDay();

  it("makes one card per date, newest first, keeping every entry and line", () => {
    const dates = days.map((d) => d.releaseDate);
    expect(new Set(dates).size).toBe(dates.length);
    expect(days.flatMap((d) => d.entries)).toEqual(PATCH_NOTES);
    for (const day of days) {
      expect(day.groups.flatMap((g) => g.changes).length).toBe(day.entries.flatMap((e) => e.changes).length);
      expect(new Set(day.groups.map((g) => g.game)).size).toBe(day.groups.length);
    }
  });

  it(`folds a game with ${DAY_GROUP_COLLAPSE_AT}+ lines on one date and nothing smaller`, () => {
    for (const group of days.flatMap((d) => d.groups)) {
      expect(group.collapsed).toBe(group.changes.length >= DAY_GROUP_COLLAPSE_AT);
    }
  });

  it("merges a game's lines across that day's versions", () => {
    const day = groupPatchNotesByDay([
      { version: "v9.1.0", releaseDate: "2099-01-01", title: "b", changes: [{ game: "chess", type: "FEAT", desc: "b1" }] },
      {
        version: "v9.0.0",
        releaseDate: "2099-01-01",
        title: "a",
        changes: [
          { game: "chess", type: "FIX", desc: "a1" },
          { game: "common", type: "IMPROVE", desc: "a2" },
          { game: "chess", type: "FIX", desc: "a3" },
          { game: "chess", type: "IMPROVE", desc: "a4" },
        ],
      },
    ])[0];
    expect(day.groups.map((g) => [g.game, g.changes.map((c) => c.desc)])).toEqual([
      ["chess", ["b1", "a1", "a3", "a4"]],
      ["common", ["a2"]],
    ]);
    // No summary written for this fake date → falls back to type counts.
    expect(day.groups[0]).toMatchObject({ collapsed: true, summary: "새 기능 1 · 개선 1 · 수정 2" });
  });
});

describe("PATCH_NOTE_DAY_SUMMARIES", () => {
  const folded = groupPatchNotesByDay().flatMap((d) =>
    d.groups.filter((g) => g.collapsed).map((g) => ({ date: d.releaseDate, game: g.game })),
  );

  it("has a written summary for every folded same-day game group", () => {
    const missing = folded
      .filter(({ date, game }) => !PATCH_NOTE_DAY_SUMMARIES[date]?.[game])
      .map(({ date, game }) => `${date} ${game}`);
    expect(missing, "patchNoteDays.ts의 PATCH_NOTE_DAY_SUMMARIES에 한 줄 요약 추가").toEqual([]);
  });

  it("has no summary for a group that isn't folded (stale key)", () => {
    const keys = new Set(folded.map(({ date, game }) => `${date} ${game}`));
    const stale = Object.entries(PATCH_NOTE_DAY_SUMMARIES).flatMap(([date, games]) =>
      Object.keys(games).filter((game) => !keys.has(`${date} ${game}`)).map((game) => `${date} ${game}`),
    );
    expect(stale).toEqual([]);
  });

  it(`keeps summaries within ${PATCH_NOTE_DESC_MAX} characters`, () => {
    const tooLong = Object.values(PATCH_NOTE_DAY_SUMMARIES)
      .flatMap((games) => Object.values(games))
      .filter((s): s is string => !!s && s.length > PATCH_NOTE_DESC_MAX);
    expect(tooLong).toEqual([]);
  });
});

describe("PATCH_NOTES versions", () => {
  it("are unique (the page used to key cards by version)", () => {
    const versions = PATCH_NOTES.map((e) => e.version);
    const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });
});
