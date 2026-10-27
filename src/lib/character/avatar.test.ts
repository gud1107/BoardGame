import { describe, expect, it } from "vitest";
import { AVATAR_OPTIONS, defaultLook, resolveLook, sanitizeAvatar } from "./avatar";

describe("avatar", () => {
  it("defaults alternate K-pop women and men with options from the shared lists", () => {
    for (let seat = 0; seat < 10; seat++) {
      const l = defaultLook(seat);
      expect(l.gender).toBe(seat % 2 === 0 ? "f" : "m");
      expect(AVATAR_OPTIONS.skin.map((o) => o.id)).toContain(l.skin);
      expect((l.gender === "f" ? AVATAR_OPTIONS.hairF : AVATAR_OPTIONS.hairM).map((o) => o.id)).toContain(l.hair);
      expect(AVATAR_OPTIONS.hairStyle.map((o) => o.id)).toContain(l.hairStyle);
      expect(l.beard).toBe(false);
    }
  });

  it("sanitize keeps only valid fields from untrusted data", () => {
    expect(sanitizeAvatar(null)).toEqual({});
    expect(sanitizeAvatar("x")).toEqual({});
    expect(
      sanitizeAvatar({ gender: "x", skin: "red", hair: "#ABCDEF", hairStyle: "mohawk", coat: "<script>", glasses: "yes", lip: "#e05a6e", hat: "crown" }),
    ).toEqual({ hair: "#abcdef", lip: "#e05a6e" });
    expect(sanitizeAvatar({ gender: "m", hairStyle: "curtain", glasses: true })).toEqual({ gender: "m", hairStyle: "curtain", glasses: true });
  });

  it("resolve overlays the profile but never lets it change the game's hat", () => {
    const l = resolveLook(0, ["cowboy"], { skin: "#f2cfb5", hat: "crown" });
    expect(l.skin).toBe("#f2cfb5");
    expect(l.hat).toBe("cowboy");
  });

  it("a gender switch without a chosen cut takes that gender's defaults, not the seat's", () => {
    const l = resolveLook(0, undefined, { gender: "m" });
    expect(l.gender).toBe("m");
    expect(["comma", "curtain", "dandy"]).toContain(l.hairStyle);
    expect(l.lip).toBe("#c27a6e");
  });
});

describe("character presets", () => {
  it("have unique stable ids and only valid fields", async () => {
    const { CHARACTER_PRESETS } = await import("./avatar");
    expect(new Set(CHARACTER_PRESETS.map((c) => c.id)).size).toBe(CHARACTER_PRESETS.length);
    for (const c of CHARACTER_PRESETS) {
      expect(sanitizeAvatar({ ...c.look, presetId: c.id })).toEqual({ ...c.look, presetId: c.id });
    }
  });

  it("two players may share one preset — resolveLook is the same per seat apart from the game's hat", async () => {
    const { CHARACTER_PRESETS } = await import("./avatar");
    const c = CHARACTER_PRESETS[0];
    const a = resolveLook(1, ["none"], { ...c.look, presetId: c.id });
    const b = resolveLook(4, ["none"], { ...c.look, presetId: c.id });
    expect({ ...a, hatColor: "" }).toEqual({ ...b, hatColor: "" });
    expect(a).not.toHaveProperty("presetId");
  });
});

describe("character individuality", () => {
  it("sanitize keeps known build/face/eyes/mark and drops unknown ones", () => {
    expect(sanitizeAvatar({ build: "broad", face: "vline", eyes: "fox", mark: "mole" })).toEqual({ build: "broad", face: "vline", eyes: "fox", mark: "mole" });
    expect(sanitizeAvatar({ build: "huge", face: 3, eyes: "<b>", mark: "tattoo" })).toEqual({});
  });

  it("presets don't share a face: no two presets of one gender have the same build + face + eyes", async () => {
    const { CHARACTER_PRESETS } = await import("./avatar");
    const sig = CHARACTER_PRESETS.map((c) => `${c.look.gender}:${c.look.build}:${c.look.face}:${c.look.eyes}`);
    expect(new Set(sig).size).toBe(sig.length);
    for (const k of ["build", "face", "eyes"] as const) expect(new Set(CHARACTER_PRESETS.map((c) => c.look[k])).size).toBe(4);
  });

  it("every seat default has a valid build/face/eyes/mark", () => {
    for (let seat = 0; seat < 10; seat++) {
      const l = defaultLook(seat);
      expect(sanitizeAvatar({ build: l.build, face: l.face, eyes: l.eyes, mark: l.mark })).toEqual({ build: l.build, face: l.face, eyes: l.eyes, mark: l.mark });
    }
  });
});

describe("VRM model choice", () => {
  it("sanitize keeps a known model and drops unknown ones", () => {
    expect(sanitizeAvatar({ model: "seed-san" })).toEqual({ model: "seed-san" });
    expect(sanitizeAvatar({ model: "../evil.vrm" })).toEqual({});
  });

  it("a chosen model sets the gender when the profile has none", () => {
    expect(resolveLook(0, undefined, { model: "seed-san" }).gender).toBe("m");
    expect(resolveLook(1, undefined, { model: "three-vrm-girl" }).gender).toBe("f");
  });

  it("every preset names a model that matches its gender", async () => {
    const { CHARACTER_PRESETS, VRM_MODEL_GENDER } = await import("./avatar");
    for (const c of CHARACTER_PRESETS) expect(VRM_MODEL_GENDER[c.look.model]).toBe(c.look.gender);
  });
});

describe("VRoid wardrobe", () => {
  it("sanitize keeps wardrobe picks from the classic family only", async () => {
    expect(sanitizeAvatar({ hairFrom: "vroid-g", outfitFrom: "pixiv-sample", shoesFrom: "nope", hairDye: true })).toEqual({ hairFrom: "vroid-g", hairDye: true });
  });

  it("hair crosses genders, outfits and shoes don't, and the original models wear only their own", async () => {
    const { wardrobeFor } = await import("./avatar");
    expect(wardrobeFor("vroid-d").hair).toContain("vroid-hair-m");
    expect(wardrobeFor("vroid-d").outfit).not.toContain("vroid-fumiriya");
    expect(wardrobeFor("vroid-hair-m").shoes).toEqual(["vroid-hair-m", "vroid-fumiriya"]);
    expect(wardrobeFor("pixiv-sample")).toEqual({ hair: [], outfit: [], shoes: [] });
    expect(wardrobeFor("seed-san").hair).toEqual([]);
  });

  it("resolveLook drops a borrowed part that doesn't fit the chosen body", () => {
    const l = resolveLook(0, undefined, { model: "vroid-fumiriya", outfitFrom: "vroid-g", hairFrom: "vroid-g" });
    expect(l.outfitFrom).toBeUndefined();
    expect(l.hairFrom).toBe("vroid-g");
    expect(resolveLook(0, undefined, { model: "seed-san", hairFrom: "vroid-g" }).hairFrom).toBeUndefined();
  });
});


describe("make-up", () => {
  it("sanitize keeps hex lens / blusher / eyeshadow colours only", () => {
    expect(sanitizeAvatar({ iris: "#4F86D0", blush: "pink", shadow: "#9474c4" })).toEqual({ iris: "#4f86d0", shadow: "#9474c4" });
  });

  it("presets on one model never share 눈매 + make-up, so they don't read as one face", async () => {
    const { CHARACTER_PRESETS } = await import("./avatar");
    const sig = CHARACTER_PRESETS.map((c) => [c.look.model, c.look.eyes, c.look.iris ?? "", c.look.shadow ?? "", c.look.blush ?? ""].join("|"));
    expect(new Set(sig).size).toBe(sig.length);
    // and each one on a shared model has its own 눈매
    const eyes = CHARACTER_PRESETS.map((c) => `${c.look.model}|${c.look.eyes}`);
    expect(new Set(eyes).size).toBe(eyes.length);
  });
});
