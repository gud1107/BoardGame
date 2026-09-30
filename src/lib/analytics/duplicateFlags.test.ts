import { describe, expect, it } from "vitest";
import { computeDuplicateFlags, isSuspectedDuplicate } from "./duplicateFlags";

describe("computeDuplicateFlags", () => {
  const flags = computeDuplicateFlags([
    { device_id: "phone", ip_hashes: ["ipA"], nicknames: ["철수"] },
    { device_id: "pc", ip_hashes: ["ipA", "ipB"], nicknames: ["철수 ", "철수2"] },
    { device_id: "friend", ip_hashes: ["ipC"], nicknames: ["영희"] },
    { device_id: "anon", ip_hashes: [], nicknames: [] },
  ]);

  it("links devices sharing an IP hash", () => {
    expect(flags.get("phone")!.sameIpDevices).toBe(1);
    expect(flags.get("pc")!.sameIpDevices).toBe(1);
    expect(flags.get("friend")!.sameIpDevices).toBe(0);
  });

  it("links devices sharing a nickname, ignoring case and spaces", () => {
    expect(flags.get("phone")!.sameNicknameDevices).toBe(1);
    expect(flags.get("pc")!.sameNicknameDevices).toBe(1);
  });

  it("flags one device using several nicknames", () => {
    expect(flags.get("pc")!.multipleNicknames).toBe(true);
    expect(flags.get("phone")!.multipleNicknames).toBe(false);
  });

  it("leaves unrelated and empty devices unflagged", () => {
    expect(isSuspectedDuplicate(flags.get("friend"))).toBe(false);
    expect(isSuspectedDuplicate(flags.get("anon"))).toBe(false);
    expect(isSuspectedDuplicate(flags.get("pc"))).toBe(true);
  });
});
