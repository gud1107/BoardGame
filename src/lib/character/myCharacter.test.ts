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

describe("signing in after editing as a guest", () => {
  const a = { model: "vroid-d" } as const;
  const b = { model: "vroid-e" } as const;
  const id = () => "new1";

  it("without guest edits the account wins, and an empty account takes this device's copy", async () => {
    const { mergeGuestEdits } = await import("./myCharacter");
    expect(mergeGuestEdits({ look: a, saved: [] }, { look: b, saved: [] }, {}, id)).toMatchObject({ look: b, pushLook: false });
    expect(mergeGuestEdits({ look: a, saved: [] }, { look: null, saved: undefined }, {}, id)).toMatchObject({ look: a, pushLook: true });
  });

  it("a guest's new look wins and the account's old one is kept in 내가 만든 캐릭터", async () => {
    const { mergeGuestEdits, PREVIOUS_ACCOUNT_LOOK } = await import("./myCharacter");
    const r = mergeGuestEdits({ look: a, saved: [] }, { look: b, saved: [] }, { look: true }, id);
    expect(r.look).toEqual(a);
    expect(r.pushLook).toBe(true);
    expect(r.saved).toEqual([{ id: "new1", name: PREVIOUS_ACCOUNT_LOOK, look: b }]);
    expect(r.pushSaved).toBe(true);
  });

  it("saved lists are united without duplicates, account entries first", async () => {
    const { mergeGuestEdits } = await import("./myCharacter");
    const account = [{ id: "acc1", name: "계정", look: a }];
    const local = [
      { id: "acc1", name: "계정", look: a },
      { id: "dup2", name: "같은 모습", look: a },
      { id: "g3", name: "게스트", look: b },
    ];
    const r = mergeGuestEdits({ look: null, saved: local }, { look: null, saved: account }, { saved: true }, id);
    expect(r.saved.map((s) => s.id)).toEqual(["acc1", "g3"]);
    expect(r.pushSaved).toBe(true);
    // not edited as a guest: a stale device list never resurrects deleted entries
    expect(mergeGuestEdits({ look: null, saved: local }, { look: null, saved: account }, {}, id).saved).toEqual(account);
  });
});
