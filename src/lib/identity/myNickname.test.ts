import { describe, expect, it } from "vitest";
import { cleanNickname, GAME_NICKNAME_MAX, mergeGuestNickname, startingNickname } from "./myNickname";

describe("game nickname", () => {
  it("trims, collapses spaces, caps length and rejects non-strings", () => {
    expect(cleanNickname("  상어   왕  ")).toBe("상어 왕");
    expect(cleanNickname("가".repeat(30))).toHaveLength(GAME_NICKNAME_MAX);
    expect(cleanNickname(42)).toBe("");
  });

  it("a room starts with the profile nickname when one is set", () => {
    expect(startingNickname("  상어 ")).toBe("상어");
  });

  it("on sign-in a name set as a guest wins; otherwise the account's, else this device's is uploaded", () => {
    expect(mergeGuestNickname("상어", "고래", true)).toEqual({ name: "상어", push: true });
    expect(mergeGuestNickname("", "고래", true)).toEqual({ name: "고래", push: false });
    expect(mergeGuestNickname("상어", "고래", false)).toEqual({ name: "고래", push: false });
    expect(mergeGuestNickname("상어", "", false)).toEqual({ name: "상어", push: true });
  });
});
