import { describe, expect, it } from "vitest";
import { applyGameOverrides, type GameOverride } from "./siteConfig";

const games = [
  { id: "a", playable: true },
  { id: "b", playable: true },
  { id: "c", playable: false },
  { id: "d", playable: true },
];

function o(game_id: string, patch: Partial<GameOverride>): [string, GameOverride] {
  return [game_id, { game_id, hidden: false, coming_soon: false, featured: false, ...patch }];
}

describe("applyGameOverrides", () => {
  it("hides, marks 준비중 and features games without touching the rest", () => {
    const result = applyGameOverrides(
      games,
      new Map([o("a", { hidden: true }), o("b", { coming_soon: true }), o("d", { featured: true })]),
    );
    expect(result.map((g) => g.id)).toEqual(["b", "c", "d"]);
    expect(result.find((g) => g.id === "b")!.playable).toBe(false);
    expect(result.find((g) => g.id === "d")!.featured).toBe(true);
    expect(result.find((g) => g.id === "c")).toEqual({ id: "c", playable: false });
  });

  it("never makes an unplayable game playable", () => {
    const [result] = applyGameOverrides([{ id: "c", playable: false }], new Map([o("c", { featured: true })]));
    expect(result.playable).toBe(false);
  });
});
