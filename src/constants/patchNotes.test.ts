import { describe, expect, it } from "vitest";
import { GAME_REGISTRY } from "@/games/registry";
import {
  PATCH_NOTES,
  LATEST_PATCH_VERSION,
  getPatchNoteGameMeta,
} from "./patchNotes";

/**
 * This project's `<Game>Board.tsx`/header-level components have no
 * unit-test coverage (jsdom isn't installed; `vitest.config.mts` runs the
 * `node` environment — see HANDOFF.md's recurring note on this), so
 * `PatchNoteModal.tsx`/`PatchNoteButton.tsx` aren't exercised here. This
 * file instead locks down the one thing that's actually pure data/logic:
 * `patchNotes.ts` itself — the newest-first ordering the modal relies on
 * (no re-sort happens at render time) and the game-tag → label/emoji
 * lookup that reads from the single source of truth (`GAME_REGISTRY`).
 */
describe("PATCH_NOTES", () => {
  it("is non-empty and starts at the retroactive v1.0.0 baseline", () => {
    expect(PATCH_NOTES.length).toBeGreaterThan(0);
    expect(PATCH_NOTES[PATCH_NOTES.length - 1].version).toBe("v1.0.0");
  });

  it("is sorted strictly newest-first by releaseDate (ties broken by version, both descending)", () => {
    for (let i = 0; i < PATCH_NOTES.length - 1; i++) {
      const cur = PATCH_NOTES[i];
      const next = PATCH_NOTES[i + 1];
      expect(cur.releaseDate >= next.releaseDate).toBe(true);
      if (cur.releaseDate === next.releaseDate) {
        expect(cur.version >= next.version).toBe(true);
      }
    }
  });

  it("exposes the first array entry's version as LATEST_PATCH_VERSION", () => {
    expect(LATEST_PATCH_VERSION).toBe(PATCH_NOTES[0].version);
  });

  it("every version follows vMAJOR.MINOR.PATCH and every releaseDate is YYYY-MM-DD", () => {
    for (const entry of PATCH_NOTES) {
      expect(entry.version).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(entry.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });

  it("every non-'common' game tag resolves to a real entry in GAME_REGISTRY", () => {
    const registryIds = new Set(GAME_REGISTRY.map((g) => g.id));
    for (const entry of PATCH_NOTES) {
      for (const change of entry.changes) {
        if (change.game === "common") continue;
        expect(registryIds.has(change.game)).toBe(true);
      }
    }
  });
});

describe("getPatchNoteGameMeta", () => {
  it("returns the fixed 🎮 공통 badge for \"common\"", () => {
    expect(getPatchNoteGameMeta("common")).toEqual({ emoji: "🎮", label: "공통" });
  });

  it("looks up a real game id's emoji/name from GAME_REGISTRY", () => {
    const dalmuti = GAME_REGISTRY.find((g) => g.id === "dalmuti")!;
    expect(getPatchNoteGameMeta("dalmuti")).toEqual({
      emoji: dalmuti.thumbnail.emoji,
      label: dalmuti.name,
    });
  });

  it("falls back to the raw tag for an unknown/removed game id", () => {
    expect(getPatchNoteGameMeta("no-such-game")).toEqual({ emoji: "🎲", label: "no-such-game" });
  });
});
