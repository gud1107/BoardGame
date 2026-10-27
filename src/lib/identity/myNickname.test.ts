import { describe, expect, it } from "vitest";
import { cleanNickname, GAME_NICKNAME_MAX, startingNickname } from "./myNickname";

describe("game nickname", () => {
  it("trims, collapses spaces, caps length and rejects non-strings", () => {
    expect(cleanNickname("  상어   왕  ")).toBe("상어 왕");
    expect(cleanNickname("가".repeat(30))).toHaveLength(GAME_NICKNAME_MAX);
    expect(cleanNickname(42)).toBe("");
  });

  it("a room starts with the profile nickname when one is set", () => {
    expect(startingNickname("  상어 ")).toBe("상어");
  });
});
