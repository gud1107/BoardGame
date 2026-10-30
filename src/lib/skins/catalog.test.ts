import { describe, expect, it } from "vitest";
import { CARD_BACK_SKINS, DEFAULT_SKIN, TABLE_SKINS, cardBackSkin, patternCss, sanitizeSkin, tableSkin } from "./catalog";

describe("skin catalog", () => {
  it("has unique ids that never collide with the default", () => {
    for (const list of [CARD_BACK_SKINS, TABLE_SKINS]) {
      const ids = list.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain("default");
    }
  });

  it("gives every card back a different pattern+emblem pair, so backs differ without colour", () => {
    const keys = CARD_BACK_SKINS.map((s) => `${s.pattern}|${s.emblem}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sanitizes untrusted presence / metadata to known ids", () => {
    expect(sanitizeSkin(null)).toEqual(DEFAULT_SKIN);
    expect(sanitizeSkin({ table: "velvet", back: "crimson" })).toEqual({ table: "velvet", back: "crimson" });
    expect(sanitizeSkin({ table: "<script>", back: 7 })).toEqual(DEFAULT_SKIN);
    expect(sanitizeSkin({ table: "neon" })).toEqual({ table: "neon", back: "default" });
  });

  it("resolves default to null (= the game's own art)", () => {
    expect(cardBackSkin("default")).toBeNull();
    expect(tableSkin("default")).toBeNull();
    expect(tableSkin(undefined)).toBeNull();
  });

  it("builds a CSS background for every skin", () => {
    for (const s of CARD_BACK_SKINS) expect(patternCss(s.pattern, s.colors)).toContain(s.colors[0]);
  });
});
