import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockGetProfile = vi.fn();
const mockGetCloudBugReport = vi.fn();
const mockUpdateCloudBugReport = vi.fn();
const mockSoftDeleteCloudBugReport = vi.fn();
const mockVerifyGuestReportPassword = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("@/lib/bugReports/serverRepository", () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  getCloudBugReport: (...args: unknown[]) => mockGetCloudBugReport(...args),
  updateCloudBugReport: (...args: unknown[]) => mockUpdateCloudBugReport(...args),
  softDeleteCloudBugReport: (...args: unknown[]) => mockSoftDeleteCloudBugReport(...args),
  verifyGuestReportPassword: (...args: unknown[]) => mockVerifyGuestReportPassword(...args),
}));

import { DELETE, PATCH } from "./route";

const REPORT = { id: "r1", authorId: "author-1", title: "제목", status: "접수됨", isGuest: false };
const GUEST_REPORT = { id: "r1", authorId: null, title: "게스트 글", status: "접수됨", isGuest: true };
const params = Promise.resolve({ id: "r1" });

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/bug-reports/r1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(body?: unknown): Request {
  return new Request("http://localhost/api/bug-reports/r1", {
    method: "DELETE",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

function signInAs(userId: string, role: "user" | "admin" = "user", email = `${userId}@x.com`) {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId, email } } });
  mockGetProfile.mockResolvedValue({ role, nickname: null, email });
}

function signOut() {
  mockGetUser.mockResolvedValue({ data: { user: null } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCloudBugReport.mockResolvedValue(REPORT);
  mockVerifyGuestReportPassword.mockResolvedValue(false);
});

describe("PATCH /api/bug-reports/:id", () => {
  it("403s a signed-out request against a logged-in author's report (no password to try)", async () => {
    signOut();
    const res = await PATCH(patchRequest({ title: "새 제목" }) as never, { params });
    expect(res.status).toBe(403);
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

  it("200s a content edit from the freedom_03@naver.com super admin even without a profiles.role='admin' row", async () => {
    signInAs("super-1", "user", "freedom_03@naver.com");
    mockUpdateCloudBugReport.mockResolvedValue({ ...REPORT, title: "슈퍼관리자 수정" });
    const res = await PATCH(patchRequest({ title: "슈퍼관리자 수정" }) as never, { params });
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

  describe("guest report password path", () => {
    beforeEach(() => {
      mockGetCloudBugReport.mockResolvedValue(GUEST_REPORT);
    });

    it("403s a signed-out edit attempt on a guest report with no password", async () => {
      signOut();
      const res = await PATCH(patchRequest({ title: "새 제목" }) as never, { params });
      expect(res.status).toBe(403);
      expect(mockUpdateCloudBugReport).not.toHaveBeenCalled();
    });

    it("403s a signed-out edit attempt with the wrong password", async () => {
      signOut();
      mockVerifyGuestReportPassword.mockResolvedValue(false);
      const res = await PATCH(patchRequest({ title: "새 제목", password: "wrong" }) as never, { params });
      expect(res.status).toBe(403);
      expect(mockVerifyGuestReportPassword).toHaveBeenCalledWith("r1", "wrong");
    });

    it("200s a signed-out edit attempt with the correct password", async () => {
      signOut();
      mockVerifyGuestReportPassword.mockResolvedValue(true);
      mockUpdateCloudBugReport.mockResolvedValue({ ...GUEST_REPORT, title: "게스트 수정" });
      const res = await PATCH(patchRequest({ title: "게스트 수정", password: "correct" }) as never, { params });
      expect(res.status).toBe(200);
    });

    it("still 403s a status change on a guest report even with the correct password (status stays admin-only)", async () => {
      signOut();
      mockVerifyGuestReportPassword.mockResolvedValue(true);
      const res = await PATCH(patchRequest({ status: "확인 중", password: "correct" }) as never, { params });
      expect(res.status).toBe(403);
    });
  });
});

describe("DELETE /api/bug-reports/:id", () => {
  it("403s a signed-out request against a logged-in author's report (no password to try)", async () => {
    signOut();
    const res = await DELETE(deleteRequest() as never, { params });
    expect(res.status).toBe(403);
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

  describe("guest report password path", () => {
    beforeEach(() => {
      mockGetCloudBugReport.mockResolvedValue(GUEST_REPORT);
    });

    it("403s a signed-out delete attempt with no password", async () => {
      signOut();
      const res = await DELETE(deleteRequest() as never, { params });
      expect(res.status).toBe(403);
      expect(mockSoftDeleteCloudBugReport).not.toHaveBeenCalled();
    });

    it("403s a signed-out delete attempt with the wrong password", async () => {
      signOut();
      mockVerifyGuestReportPassword.mockResolvedValue(false);
      const res = await DELETE(deleteRequest({ password: "wrong" }) as never, { params });
      expect(res.status).toBe(403);
    });

    it("200s a signed-out delete attempt with the correct password", async () => {
      signOut();
      mockVerifyGuestReportPassword.mockResolvedValue(true);
      mockSoftDeleteCloudBugReport.mockResolvedValue(true);
      const res = await DELETE(deleteRequest({ password: "correct" }) as never, { params });
      expect(res.status).toBe(200);
      expect(mockVerifyGuestReportPassword).toHaveBeenCalledWith("r1", "correct");
    });

    it("200s a delete from a regular logged-in non-admin user who supplies the correct guest password", async () => {
      signInAs("someone-else", "user");
      mockVerifyGuestReportPassword.mockResolvedValue(true);
      mockSoftDeleteCloudBugReport.mockResolvedValue(true);
      const res = await DELETE(deleteRequest({ password: "correct" }) as never, { params });
      expect(res.status).toBe(200);
    });

    it("200s a delete from the freedom_03@naver.com super admin with no password at all (master delete)", async () => {
      signInAs("super-1", "user", "freedom_03@naver.com");
      mockSoftDeleteCloudBugReport.mockResolvedValue(true);
      const res = await DELETE(deleteRequest() as never, { params });
      expect(res.status).toBe(200);
      expect(mockVerifyGuestReportPassword).not.toHaveBeenCalled();
    });

    it("403s a delete from an ordinary other user account with no password (unaffected by the master delete)", async () => {
      signInAs("regular-user", "user");
      const res = await DELETE(deleteRequest() as never, { params });
      expect(res.status).toBe(403);
      expect(mockSoftDeleteCloudBugReport).not.toHaveBeenCalled();
    });
  });

  it("200s a master delete of a *logged-in-author's* report by freedom_03@naver.com too (not just guest reports)", async () => {
    signInAs("super-1", "user", "freedom_03@naver.com");
    mockSoftDeleteCloudBugReport.mockResolvedValue(true);
    const res = await DELETE(deleteRequest() as never, { params });
    expect(res.status).toBe(200);
  });
});
