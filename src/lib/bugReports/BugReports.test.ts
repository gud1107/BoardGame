import { describe, expect, it } from "vitest";
import {
  formatPhoneNumber,
  isBugReportValid,
  maskPhoneNumber,
  validateAttachmentMeta,
  validateBugReportInput,
} from "./validate";
import {
  filterReports,
  mergeReportSources,
  prependReport,
  removeReportFromList,
  updateReportInList,
  updateReportStatusInList,
} from "./board";
import type { BugReportRecord } from "@/lib/db/types";
import type { CloudBugReportRecord } from "./types";

function report(overrides: Partial<BugReportRecord> = {}): BugReportRecord {
  return {
    id: "r1",
    title: "제목",
    description: "설명",
    author: "작성자",
    status: "접수됨",
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function cloudReport(overrides: Partial<CloudBugReportRecord> = {}): CloudBugReportRecord {
  return {
    id: "c1",
    title: "클라우드 제목",
    description: "설명",
    authorId: "user-1",
    author: "작성자",
    status: "접수됨",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateBugReportInput", () => {
  it("passes with all required fields present and no phone", () => {
    expect(validateBugReportInput({ title: "제목", description: "내용", author: "홍길동" })).toEqual({});
    expect(isBugReportValid({ title: "제목", description: "내용", author: "홍길동" })).toBe(true);
  });

  it("rejects a missing/blank title", () => {
    const errors = validateBugReportInput({ title: "  ", description: "내용", author: "홍길동" });
    expect(errors.title).toBeDefined();
    expect(errors.description).toBeUndefined();
  });

  it("rejects a missing description", () => {
    const errors = validateBugReportInput({ title: "제목", description: "", author: "홍길동" });
    expect(errors.description).toBeDefined();
  });

  it("rejects a missing author", () => {
    const errors = validateBugReportInput({ title: "제목", description: "내용", author: "" });
    expect(errors.author).toBeDefined();
  });

  it("reports all three missing fields at once", () => {
    const errors = validateBugReportInput({ title: "", description: "", author: "" });
    expect(Object.keys(errors).sort()).toEqual(["author", "description", "title"]);
    expect(isBugReportValid({ title: "", description: "", author: "" })).toBe(false);
  });

  it("does not require a phone number", () => {
    expect(validateBugReportInput({ title: "제목", description: "내용", author: "홍길동", phone: "" }).phone).toBeUndefined();
  });

  it("validates phone format only when a phone is provided", () => {
    expect(
      validateBugReportInput({ title: "제목", description: "내용", author: "홍길동", phone: "12" }).phone,
    ).toBeDefined();
    expect(
      validateBugReportInput({ title: "제목", description: "내용", author: "홍길동", phone: "010-1234-5678" })
        .phone,
    ).toBeUndefined();
  });
});

describe("formatPhoneNumber", () => {
  it("formats an 11-digit mobile number as 3-4-4", () => {
    expect(formatPhoneNumber("01012345678")).toBe("010-1234-5678");
  });

  it("formats a 10-digit number as 3-3-4", () => {
    expect(formatPhoneNumber("0212345678")).toBe("021-234-5678");
  });

  it("formats progressively as digits are typed", () => {
    expect(formatPhoneNumber("010")).toBe("010");
    expect(formatPhoneNumber("0101234")).toBe("010-1234");
  });

  it("ignores non-digit characters and caps at 11 digits", () => {
    expect(formatPhoneNumber("010-1234-5678-9999")).toBe("010-1234-5678");
  });
});

describe("maskPhoneNumber", () => {
  it("masks the middle group of a formatted number", () => {
    expect(maskPhoneNumber("010-1234-5678")).toBe("010-****-5678");
  });

  it("masks the middle group of raw digits", () => {
    expect(maskPhoneNumber("01012345678")).toBe("010-****-5678");
  });

  it("leaves values too short to mask unchanged", () => {
    expect(maskPhoneNumber("010-1234")).toBe("010-1234");
  });
});

describe("validateAttachmentMeta", () => {
  it("accepts a small PNG", () => {
    expect(validateAttachmentMeta({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("rejects a non-image mime type", () => {
    expect(validateAttachmentMeta({ type: "application/pdf", size: 1024 })).toMatch(/이미지/);
  });

  it("rejects a file over the size cap", () => {
    expect(validateAttachmentMeta({ type: "image/jpeg", size: 10 * 1024 * 1024 })).toMatch(/5MB/);
  });
});

describe("prependReport", () => {
  it("adds a new report to the front of the list", () => {
    const existing = [report({ id: "old" })];
    const fresh = report({ id: "new" });
    const result = prependReport(existing, fresh);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("new");
    expect(result[1].id).toBe("old");
    // Original list untouched (pure function).
    expect(existing).toHaveLength(1);
  });

  it("defaults a freshly submitted report to '접수됨'", () => {
    const fresh = report({ id: "new", status: "접수됨" });
    const result = prependReport([], fresh);
    expect(result[0].status).toBe("접수됨");
  });
});

describe("updateReportStatusInList", () => {
  it("updates only the targeted report's status", () => {
    const list = [report({ id: "a", status: "접수됨" }), report({ id: "b", status: "접수됨" })];
    const result = updateReportStatusInList(list, "a", "확인 중");
    expect(result.find((r) => r.id === "a")?.status).toBe("확인 중");
    expect(result.find((r) => r.id === "b")?.status).toBe("접수됨");
  });

  it("is a no-op when the id isn't found", () => {
    const list = [report({ id: "a" })];
    expect(updateReportStatusInList(list, "missing", "수정 완료")).toEqual(list);
  });
});

describe("filterReports", () => {
  const list = [
    report({ id: "1", gameId: "perudo", status: "접수됨", title: "주사위가 안 굴러가요" }),
    report({ id: "2", gameId: "coup", status: "확인 중", title: "카드가 겹쳐 보여요" }),
    report({ id: "3", gameId: undefined, status: "수정 완료", title: "허브 로딩 느림" }),
  ];

  it("returns everything with no filter", () => {
    expect(filterReports(list, {})).toHaveLength(3);
    expect(filterReports(list, { gameId: "all", status: "all" })).toHaveLength(3);
  });

  it("filters by gameId", () => {
    expect(filterReports(list, { gameId: "perudo" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("filters by status", () => {
    expect(filterReports(list, { status: "확인 중" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("combines game and status filters", () => {
    expect(filterReports(list, { gameId: "coup", status: "확인 중" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterReports(list, { gameId: "coup", status: "수정 완료" })).toEqual([]);
  });

  it("filters by title substring, case-insensitively", () => {
    expect(filterReports(list, { query: "카드" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("treats an empty-string gameId as 'hub-only', distinct from no filter", () => {
    expect(filterReports(list, { gameId: "" }).map((r) => r.id)).toEqual(["3"]);
  });
});

describe("updateReportInList", () => {
  it("merges a partial patch into only the targeted item", () => {
    const list = [report({ id: "a", title: "원래 제목" }), report({ id: "b", title: "다른 글" })];
    const result = updateReportInList(list, "a", { title: "수정된 제목", updatedAt: "2026-08-20T00:00:00.000Z" });
    expect(result.find((r) => r.id === "a")).toMatchObject({ title: "수정된 제목", updatedAt: "2026-08-20T00:00:00.000Z" });
    expect(result.find((r) => r.id === "b")?.title).toBe("다른 글");
  });

  it("is a no-op when the id isn't found", () => {
    const list = [report({ id: "a" })];
    expect(updateReportInList(list, "missing", { title: "x" })).toEqual(list);
  });
});

describe("removeReportFromList", () => {
  it("drops the targeted report and leaves the rest untouched", () => {
    const list = [report({ id: "a" }), report({ id: "b" })];
    expect(removeReportFromList(list, "a").map((r) => r.id)).toEqual(["b"]);
  });
});

describe("mergeReportSources", () => {
  it("tags each side with its source and sorts the combined feed newest-first", () => {
    const local = [report({ id: "local-old", createdAt: "2026-08-01T00:00:00.000Z" })];
    const cloud = [cloudReport({ id: "cloud-new", createdAt: "2026-08-20T00:00:00.000Z" })];
    const result = mergeReportSources(local, cloud);
    expect(result.map((r) => [r.id, r.source])).toEqual([
      ["cloud-new", "cloud"],
      ["local-old", "local"],
    ]);
  });

  it("returns an empty feed for two empty lists", () => {
    expect(mergeReportSources([], [])).toEqual([]);
  });
});
