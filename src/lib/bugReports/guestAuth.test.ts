import { describe, expect, it } from "vitest";
import { hashGuestPassword, verifyGuestPassword } from "./guestAuth";

describe("hashGuestPassword / verifyGuestPassword", () => {
  it("verifies the same password against its own hash", async () => {
    const hash = await hashGuestPassword("abcd1234");
    await expect(verifyGuestPassword("abcd1234", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password against the hash", async () => {
    const hash = await hashGuestPassword("abcd1234");
    await expect(verifyGuestPassword("wrong-pw", hash)).resolves.toBe(false);
  });

  it("never stores the password in plaintext inside the hash", async () => {
    const hash = await hashGuestPassword("abcd1234");
    expect(hash).not.toContain("abcd1234");
  });

  it("produces a different hash each time (random salt) but both still verify", async () => {
    const [hashA, hashB] = await Promise.all([hashGuestPassword("abcd1234"), hashGuestPassword("abcd1234")]);
    expect(hashA).not.toBe(hashB);
    await expect(verifyGuestPassword("abcd1234", hashA)).resolves.toBe(true);
    await expect(verifyGuestPassword("abcd1234", hashB)).resolves.toBe(true);
  });
});
