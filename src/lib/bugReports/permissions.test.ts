import { describe, expect, it } from "vitest";
import { canChangeStatus, canDelete, canEditContent } from "./permissions";

const AUTHOR = "user-author";
const OTHER = "user-other";

describe("canEditContent", () => {
  it("allows the author themself", () => {
    expect(canEditContent(AUTHOR, AUTHOR, false)).toBe(true);
  });

  it("allows an admin who is not the author", () => {
    expect(canEditContent(AUTHOR, OTHER, true)).toBe(true);
  });

  it("blocks a signed-in non-author, non-admin user", () => {
    expect(canEditContent(AUTHOR, OTHER, false)).toBe(false);
  });

  it("blocks a signed-out visitor (null userId)", () => {
    expect(canEditContent(AUTHOR, null, false)).toBe(false);
  });

  it("an admin editing their own report is still allowed", () => {
    expect(canEditContent(AUTHOR, AUTHOR, true)).toBe(true);
  });
});

describe("canDelete", () => {
  it("mirrors canEditContent for the author", () => {
    expect(canDelete(AUTHOR, AUTHOR, false)).toBe(true);
  });

  it("mirrors canEditContent for an admin", () => {
    expect(canDelete(AUTHOR, OTHER, true)).toBe(true);
  });

  it("mirrors canEditContent for an unrelated signed-in user", () => {
    expect(canDelete(AUTHOR, OTHER, false)).toBe(false);
  });

  it("mirrors canEditContent for a signed-out visitor", () => {
    expect(canDelete(AUTHOR, null, false)).toBe(false);
  });
});

describe("canChangeStatus", () => {
  it("allows admins", () => {
    expect(canChangeStatus(true)).toBe(true);
  });

  it("blocks non-admins, including the report's own author", () => {
    expect(canChangeStatus(false)).toBe(false);
  });
});
