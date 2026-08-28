import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockGetProfile = vi.fn();
const mockGetCloudBugReport = vi.fn();
const mockUpdateCloudBugReport = vi.fn();
const mockSoftDeleteCloudBugReport = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("@/lib/bugReports/serverRepository", () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  getCloudBugReport: (...args: unknown[]) => mockGetCloudBugReport(...args),
  updateCloudBugReport: (...args: unknown[]) => mockUpdateCloudBugReport(...args),
  softDeleteCloudBugReport: (...args: unknown[]) => mockSoftDeleteCloudBugReport(...args),
}));

import { DELETE, PATCH } from "./route";

const REPORT = { id: "r1", authorId: "author-1", title: "제목", status: "접수됨" };
const params = Promise.resolve({ id: "r1" });

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/bug-reports/r1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request("http://localhost/api/bug-reports/r1", { method: "DELETE" });
}

function signInAs(userId: string, role: "user" | "admin" = "user") {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
  mockGetProfile.mockResolvedValue({ role, nickname: null, email: `${userId}@x.com` });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCloudBugReport.mockResolvedValue(REPORT);
});

describe("PATCH /api/bug-reports/:id", () => {
  it("401s a signed-out request", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(patchRequest({ title: "새 제목" }) as never, { params });
    expect(res.status).toBe(401);
  });

  it("404s when the report does not exist", async () => {
    signInAs("author-1");
    mockGetCloudBugReport.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ title: "새 제목" }) as never, { params });
    expect(res.status).toBe(404);
  });

  it("403s a content edit from someone who is neither the author nor an admin", async () => {
    signInAs("someone-else", "user");
    const res = await PATCH(patchRequest({ title: "새 제목" }) as never, { params });
    expect(res.status).toBe(403);
    expect(mockUpdateCloudBugReport).not.toHaveBeenCalled();
  });

  it("200s a content edit from the report's own author and reflects the change", async () => {
    signInAs("author-1", "user");
    mockUpdateCloudBugReport.mockResolvedValue({ ...REPORT, title: "새 제목" });
    const res = await PATCH(patchRequest({ title: "새 제목" }) as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.title).toBe("새 제목");
    expect(mockUpdateCloudBugReport).toHaveBeenCalledWith("r1", expect.objectContaining({ title: "새 제목" }));
  });

  it("200s a content edit from an admin who is not the author", async () => {
    signInAs("some-admin", "admin");
    mockUpdateCloudBugReport.mockResolvedValue({ ...REPORT, title: "관리자 수정" });
    const res = await PATCH(patchRequest({ title: "관리자 수정" }) as never, { params });
    expect(res.status).toBe(200);
  });

  it("403s a status change from the report's own (non-admin) author", async () => {
    signInAs("author-1", "user");
    const res = await PATCH(patchRequest({ status: "확인 중" }) as never, { params });
    expect(res.status).toBe(403);
    expect(mockUpdateCloudBugReport).not.toHaveBeenCalled();
  });

  it("200s a status change from an admin", async () => {
    signInAs("some-admin", "admin");
    mockUpdateCloudBugReport.mockResolvedValue({ ...REPORT, status: "확인 중" });
    const res = await PATCH(patchRequest({ status: "확인 중" }) as never, { params });
    expect(res.status).toBe(200);
  });

  it("400s a blank title without calling the repository", async () => {
    signInAs("author-1", "user");
    const res = await PATCH(patchRequest({ title: "   " }) as never, { params });
    expect(res.status).toBe(400);
    expect(mockUpdateCloudBugReport).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/bug-reports/:id", () => {
  it("401s a signed-out request", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await DELETE({} as never, { params });
    expect(res.status).toBe(401);
  });

  it("404s when the report does not exist", async () => {
    signInAs("author-1");
    mockGetCloudBugReport.mockResolvedValue(null);
    const res = await DELETE(deleteRequest() as never, { params });
    expect(res.status).toBe(404);
  });

  it("403s a delete from someone who is neither the author nor an admin", async () => {
    signInAs("someone-else", "user");
    const res = await DELETE(deleteRequest() as never, { params });
    expect(res.status).toBe(403);
    expect(mockSoftDeleteCloudBugReport).not.toHaveBeenCalled();
  });

  it("200s a delete from the report's own author", async () => {
    signInAs("author-1", "user");
    mockSoftDeleteCloudBugReport.mockResolvedValue(true);
    const res = await DELETE(deleteRequest() as never, { params });
    expect(res.status).toBe(200);
    expect(mockSoftDeleteCloudBugReport).toHaveBeenCalledWith("r1");
  });

  it("200s a delete from an admin who is not the author", async () => {
    signInAs("some-admin", "admin");
    mockSoftDeleteCloudBugReport.mockResolvedValue(true);
    const res = await DELETE(deleteRequest() as never, { params });
    expect(res.status).toBe(200);
  });
});
