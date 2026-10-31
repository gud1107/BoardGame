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

  it("keeps pattern backs tellable apart at hand size (base + accent colour distance)", () => {
    // In 3D a held back is ~20×28 px: the pattern blurs away and what's left is
    // the base colour and the accent (frame, bold overlay, big emblem). Rendered
    // at that size the closest pair measured ΔE≈13 when this sum was ≥10; the
    // old near-twins (compass/scholar, ΔE≈3) summed to ~7.
    const lab = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const f = (v: number) => ((v /= 255) > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92);
      const [r, g, b] = [f(n >> 16), f((n >> 8) & 255), f(n & 255)];
      const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
      const x = t((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = t(r * 0.2126 + g * 0.7152 + b * 0.0722), z = t((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const de = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
    const backs = CARD_BACK_SKINS.filter((s) => !s.image);
    for (let i = 0; i < backs.length; i++)
      for (let j = i + 1; j < backs.length; j++) {
        const d = de(backs[i].colors[0], backs[j].colors[0]) + de(backs[i].accent, backs[j].accent);
        expect(d, `${backs[i].id} ~ ${backs[j].id}`).toBeGreaterThanOrEqual(10);
      }
  });

  it("keeps every pattern back's silhouette visible on both themes (border or fill ≥ 3:1)", () => {
    // WCAG non-text contrast: a card edge reads when its frame (accent) or its
    // body (base) stands 3:1 off the page. Dark = page bg and its lighter top glow,
    // light = page bg, panel and white. A light accent on a light base fails here.
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const f = (v: number) => ((v /= 255) > 0.03928 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92);
      return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const pages = { dark: ["#0b0b12", "#1a1230"], light: ["#dde2e8", "#eceff3", "#ffffff"] };
    for (const b of CARD_BACK_SKINS.filter((s) => !s.image))
      for (const [theme, bgs] of Object.entries(pages))
        for (const bg of bgs) expect(Math.max(ratio(b.accent, bg), ratio(b.colors[0], bg)), `${b.id} on ${theme} ${bg}`).toBeGreaterThanOrEqual(3);
  });
});
