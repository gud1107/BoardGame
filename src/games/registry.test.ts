import { describe, expect, it } from "vitest";
import { sortByPlayability } from "./registry";
import type { GameMeta } from "./types";

function stub(id: string, playable: boolean): Pick<GameMeta, "id" | "playable"> {
  return { id, playable };
}

describe("sortByPlayability", () => {
  it("moves playable games before non-playable ones", () => {
    const input = [stub("a", false), stub("b", true), stub("c", false), stub("d", true)];
    const result = sortByPlayability(input);
    expect(result.map((g) => g.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps relative order stable within each group", () => {
    const input = [stub("z", true), stub("y", false), stub("x", true), stub("w", false)];
    const result = sortByPlayability(input);
    // Playable group keeps catalog order (z before x), same for non-playable (y before w).
    expect(result.map((g) => g.id)).toEqual(["z", "x", "y", "w"]);
  });

  it("does not mutate the input array", () => {
    const input = [stub("a", false), stub("b", true)];
    const copy = [...input];
    sortByPlayability(input);
    expect(input).toEqual(copy);
  });

  it("is a no-op when every game is already playable or already unplayable", () => {
    const allPlayable = [stub("a", true), stub("b", true)];
    expect(sortByPlayability(allPlayable).map((g) => g.id)).toEqual(["a", "b"]);

    const noneStubPlayable = [stub("a", false), stub("b", false)];
    expect(sortByPlayability(noneStubPlayable).map((g) => g.id)).toEqual(["a", "b"]);
  });
});
