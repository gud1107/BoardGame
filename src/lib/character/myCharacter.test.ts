import { describe, expect, it } from "vitest";
import { portraitKey } from "./myCharacter";

describe("portraitKey", () => {
  it("ignores field order and presetId, but changes with the look", () => {
    expect(portraitKey({ skin: "#ffffff", build: "slim", presetId: "haerin" })).toBe(portraitKey({ build: "slim", skin: "#ffffff" }));
    expect(portraitKey({ build: "slim" })).not.toBe(portraitKey({ build: "broad" }));
  });
});
