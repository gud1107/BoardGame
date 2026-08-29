import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockListCloudBugReports = vi.fn();
const mockInsertCloudBugReport = vi.fn();
const mockGetLastGuestSubmissionAt = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("@/lib/bugReports/serverRepository", () => ({
  listCloudBugReports: (...args: unknown[]) => mockListCloudBugReports(...args),
  insertCloudBugReport: (...args: unknown[]) => mockInsertCloudBugReport(...args),
  getLastGuestSubmissionAt: (...args: unknown[]) => mockGetLastGuestSubmissionAt(...args),
}));

import { GET, POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/bug-reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLastGuestSubmissionAt.mockResolvedValue(null);
});

describe("GET /api/bug-reports", () => {
  it("returns the list from the repository without requiring login", async () => {
    mockListCloudBugReports.mockResolvedValue([{ id: "r1", title: "버그" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports).toEqual([{ id: "r1", title: "버그" }]);
  });
});

describe("POST /api/bug-reports", () => {
  it("rejects a blank title with 400 and does not insert", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1", email: "u1@x.com" } } });
    const res = await POST(jsonRequest({ title: "  ", description: "d", author: "a" }) as never);
    expect(res.status).toBe(400);
    expect(mockInsertCloudBugReport).not.toHaveBeenCalled();
  });

  it("inserts with author_id set to the signed-in user's id and returns 201", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1", email: "u1@x.com" } } });
    mockInsertCloudBugReport.mockResolvedValue({ id: "r1", authorId: "u1", title: "t" });

    const res = await POST(jsonRequest({ title: "t", description: "d", author: "닉네임" }) as never);

    expect(res.status).toBe(201);
    expect(mockInsertCloudBugReport).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "u1", authorName: "닉네임", isGuest: false, title: "t", description: "d" }),
    );
  });

  describe("guest (signed-out) submissions", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
    });

    it("400s a guest submission with no password (no longer a blanket 401)", async () => {
      const res = await POST(jsonRequest({ title: "t", description: "d", author: "게스트" }) as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.errors.password).toBeTruthy();
      expect(mockInsertCloudBugReport).not.toHaveBeenCalled();
    });

    it("400s a guest submission with a too-short password", async () => {
      const res = await POST(jsonRequest({ title: "t", description: "d", author: "게스트", password: "123" }) as never);
      expect(res.status).toBe(400);
      expect(mockInsertCloudBugReport).not.toHaveBeenCalled();
    });

    it("201s a valid guest submission, hashing the password and setting isGuest/authorId null", async () => {
      mockInsertCloudBugReport.mockResolvedValue({ id: "r1", authorId: null, isGuest: true, title: "t" });

      const res = await POST(
        jsonRequest({ title: "t", description: "d", author: "게스트", password: "abcd1234", deviceId: "dev-1" }) as never,
      );

      expect(res.status).toBe(201);
      const insertArg = mockInsertCloudBugReport.mock.calls[0][0];
      expect(insertArg.authorId).toBeUndefined();
      expect(insertArg.isGuest).toBe(true);
      expect(insertArg.deviceId).toBe("dev-1");
      expect(typeof insertArg.passwordHash).toBe("string");
      expect(insertArg.passwordHash).not.toBe("abcd1234");
    });

    it("429s a guest submission from a device still inside the cooldown window", async () => {
      mockGetLastGuestSubmissionAt.mockResolvedValue(new Date().toISOString());

      const res = await POST(
        jsonRequest({ title: "t", description: "d", author: "게스트", password: "abcd1234", deviceId: "dev-1" }) as never,
      );

      expect(res.status).toBe(429);
      expect(mockInsertCloudBugReport).not.toHaveBeenCalled();
    });

    it("allows a guest submission once the cooldown window has passed", async () => {
      mockGetLastGuestSubmissionAt.mockResolvedValue(new Date(Date.now() - 10 * 60 * 1000).toISOString());
      mockInsertCloudBugReport.mockResolvedValue({ id: "r1", authorId: null, isGuest: true, title: "t" });

      const res = await POST(
        jsonRequest({ title: "t", description: "d", author: "게스트", password: "abcd1234", deviceId: "dev-1" }) as never,
      );

      expect(res.status).toBe(201);
    });
  });
});
