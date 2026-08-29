import { describe, expect, it } from "vitest";
import {
  mergeParticipants,
  membersOf,
  removeMember,
  resolveGroupId,
  unmergeParticipants,
} from "./mergeGroups";

describe("mergeParticipants", () => {
  it("folds multiple raw ids under one canonical id", () => {
    const groups = mergeParticipants([], "p1", ["p2", "p3"]);
    expect(groups).toEqual([{ canonicalId: "p1", memberIds: expect.arrayContaining(["p1", "p2", "p3"]) }]);
    expect(resolveGroupId(groups, "p2")).toBe("p1");
    expect(resolveGroupId(groups, "p3")).toBe("p1");
  });

  it("leaves ungrouped ids resolving to themselves", () => {
    const groups = mergeParticipants([], "p1", ["p2"]);
    expect(resolveGroupId(groups, "p4")).toBe("p4");
  });

  it("dissolves a prior group when one of its members is re-merged elsewhere", () => {
    let groups = mergeParticipants([], "기택", ["기탁"]);
    groups = mergeParticipants(groups, "기택", ["기태기"]); // re-merge with a third alias
    expect(membersOf(groups, "기택").sort()).toEqual(["기탁", "기태기", "기택"].sort());
    expect(groups).toHaveLength(1);
  });
});

describe("unmergeParticipants", () => {
  it("fully dissolves the group, reverting every member to its own row", () => {
    const groups = mergeParticipants([], "p1", ["p2", "p3"]);
    const undone = unmergeParticipants(groups, "p1");
    expect(undone).toEqual([]);
    expect(resolveGroupId(undone, "p2")).toBe("p2");
  });

  it("is a no-op for an id that wasn't a merge canonical", () => {
    const groups = mergeParticipants([], "p1", ["p2"]);
    expect(unmergeParticipants(groups, "p2")).toEqual(groups);
  });
});

describe("removeMember", () => {
  it("pulls one member out while keeping the rest merged", () => {
    const groups = mergeParticipants([], "p1", ["p2", "p3"]);
    const next = removeMember(groups, "p3");
    expect(resolveGroupId(next, "p3")).toBe("p3");
    expect(resolveGroupId(next, "p2")).toBe("p1");
  });

  it("dissolves the group entirely once only one member is left", () => {
    const groups = mergeParticipants([], "p1", ["p2"]);
    const next = removeMember(groups, "p2");
    expect(next).toEqual([]);
  });

  it("promotes another member to canonical if the canonical itself is removed", () => {
    const groups = mergeParticipants([], "p1", ["p2", "p3"]);
    const next = removeMember(groups, "p1");
    expect(next).toHaveLength(1);
    expect(next[0].canonicalId).not.toBe("p1");
    expect(membersOf(next, next[0].canonicalId).sort()).toEqual(["p2", "p3"]);
  });
});
