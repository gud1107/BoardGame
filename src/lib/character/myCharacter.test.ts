import { describe, expect, it } from "vitest";
import { portraitKey } from "./myCharacter";

describe("portraitKey", () => {
  it("ignores field order and presetId, but changes with the look", () => {
    expect(portraitKey({ skin: "#ffffff", build: "slim", presetId: "haerin" })).toBe(portraitKey({ build: "slim", skin: "#ffffff" }));
    expect(portraitKey({ build: "slim" })).not.toBe(portraitKey({ build: "broad" }));
  });
});

describe("saved looks (내가 만든 캐릭터)", () => {
  it("sanitize drops malformed entries and caps the list", async () => {
    const { sanitizeSaved, MAX_SAVED } = await import("./myCharacter");
    expect(sanitizeSaved("x")).toEqual([]);
    expect(sanitizeSaved([{ id: "a1", name: " 내 캐릭터 ", look: { model: "vroid-d", iris: "#4F86D0" } }, { id: "../x", name: "bad", look: { model: "vroid-d" } }, { id: "b2", name: "", look: { model: "vroid-d" } }, { id: "c3", name: "empty", look: { model: "nope" } }])).toEqual([
      { id: "a1", name: "내 캐릭터", look: { model: "vroid-d", iris: "#4f86d0" } },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `id${i}`, name: `n${i}`, look: { model: "vroid-d" } }));
    expect(sanitizeSaved(many)).toHaveLength(MAX_SAVED);
  });

  it("saving under an existing name overwrites it; a new name appends until full", async () => {
    const { withSaved, MAX_SAVED } = await import("./myCharacter");
    const one = withSaved([], "하나", { model: "vroid-d", presetId: "danbi" }, "a")!;
    expect(one).toEqual([{ id: "a", name: "하나", look: { model: "vroid-d" } }]);
    const over = withSaved(one, "하나", { model: "vroid-e" }, "b")!;
    expect(over).toEqual([{ id: "a", name: "하나", look: { model: "vroid-e" } }]);
    let list = over;
    for (let i = 1; i < MAX_SAVED; i++) list = withSaved(list, `n${i}`, { model: "vroid-d" }, `x${i}`)!;
    expect(list).toHaveLength(MAX_SAVED);
    expect(withSaved(list, "새 이름", { model: "vroid-d" }, "z")).toBeNull();
    expect(withSaved(list, "하나", { model: "vroid-g" }, "z")).not.toBeNull();
  });
});
