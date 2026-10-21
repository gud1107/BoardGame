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
