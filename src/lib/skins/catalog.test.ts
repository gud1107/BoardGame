import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_BACK_SKINS, DEFAULT_SKIN, PLATE_SKINS, PROP_SKINS, SKIN_SETS, TABLE_SKINS, cardBackSkin, patternCss, plateSkin, propSkin, sanitizeSkin, tableSkin } from "./catalog";
import { UNLOCKS } from "./unlocks";

describe("skin catalog", () => {
  it("has unique ids that never collide with the default", () => {
    for (const list of [CARD_BACK_SKINS, TABLE_SKINS, PLATE_SKINS, PROP_SKINS]) {
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
    expect(sanitizeSkin({ table: "velvet", back: "crimson", plate: "crown", prop: "ruby" })).toEqual({ table: "velvet", back: "crimson", plate: "crown", prop: "ruby" });
    expect(sanitizeSkin({ table: "<script>", back: 7, plate: "nope" })).toEqual(DEFAULT_SKIN);
    // a skin saved before name plates existed still loads, plate = default
    expect(sanitizeSkin({ table: "neon" })).toEqual({ table: "neon", back: "default", plate: "default", prop: "default" });
  });

  it("resolves default to null (= the game's own art)", () => {
    expect(cardBackSkin("default")).toBeNull();
    expect(tableSkin("default")).toBeNull();
    expect(tableSkin(undefined)).toBeNull();
    expect(plateSkin("default")).toBeNull();
  });

  it("gives every name plate a different pattern+emblem pair", () => {
    const keys = PLATE_SKINS.map((s) => `${s.pattern}|${s.emblem}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("builds a CSS background for every skin", () => {
    for (const s of CARD_BACK_SKINS) expect(patternCss(s.pattern, s.colors)).toContain(s.colors[0]);
  });

  it("builds every set from existing, free skins (a set never hands out a reward)", () => {
    for (const st of SKIN_SETS) {
      expect(tableSkin(st.table)?.unlock).toBeUndefined();
      expect(cardBackSkin(st.back)?.unlock).toBeUndefined();
      expect(plateSkin(st.plate)?.unlock).toBeUndefined();
      expect(propSkin(st.prop)).not.toBeNull();
      expect(tableSkin(st.table) && cardBackSkin(st.back) && plateSkin(st.plate)).toBeTruthy();
    }
  });

  it("ships the painted backs and only uses known unlock ids", () => {
    for (const b of CARD_BACK_SKINS.filter((x) => x.image)) {
      expect(existsSync(join(process.cwd(), "public", b.image!))).toBe(true);
      expect(b.unlock).toBeDefined();
    }
    for (const s of [...CARD_BACK_SKINS, ...TABLE_SKINS, ...PLATE_SKINS]) if (s.unlock) expect(UNLOCKS[s.unlock]).toBeDefined();
  });
});
