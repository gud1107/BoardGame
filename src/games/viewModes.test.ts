import { describe, expect, it } from "vitest";
import { GAME_REGISTRY } from "./registry";
import { GAME_VIEW_MODES, matchesViewFilter } from "./viewModes";

describe("GAME_VIEW_MODES", () => {
  it("classifies every registry game (new games must pick 3d/both/2d)", () => {
    const missing = GAME_REGISTRY.map((g) => g.id).filter((id) => !(id in GAME_VIEW_MODES));
    expect(missing).toEqual([]);
  });

  it("has no stale ids", () => {
    const ids = new Set(GAME_REGISTRY.map((g) => g.id));
    expect(Object.keys(GAME_VIEW_MODES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("splits 3D (opens in 3D) and 2D (flat only) without overlap", () => {
    for (const g of GAME_REGISTRY) {
      expect(matchesViewFilter(g.id, "3d")).not.toBe(matchesViewFilter(g.id, "2d"));
      expect(matchesViewFilter(g.id, "all")).toBe(true);
    }
    expect(matchesViewFilter("perudo", "3d")).toBe(true);
    expect(matchesViewFilter("worm", "2d")).toBe(true);
  });
});
