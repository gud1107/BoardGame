import { describe, expect, it } from "vitest";
import { filterProfanity } from "./profanity";

describe("filterProfanity", () => {
  it("does not flag a clean message", () => {
    const result = filterProfanity("안녕하세요! 반갑습니다");
    expect(result.flagged).toBe(false);
    expect(result.clean).toBe("안녕하세요! 반갑습니다");
  });

  it("flags and masks a Korean banned word", () => {
    const result = filterProfanity("이 시발 뭐야");
    expect(result.flagged).toBe(true);
    expect(result.clean).toBe("이 ** 뭐야");
  });

  it("flags and masks an English banned word case-insensitively", () => {
    const result = filterProfanity("what the FUCK");
    expect(result.flagged).toBe(true);
    expect(result.clean).toBe("what the ****");
  });

  it("catches whitespace-evaded banned words", () => {
    const result = filterProfanity("시 발 놈아");
    expect(result.flagged).toBe(true);
  });
});
