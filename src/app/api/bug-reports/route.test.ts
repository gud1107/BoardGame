import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockListCloudBugReports = vi.fn();
const mockInsertCloudBugReport = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("@/lib/bugReports/serverRepository", () => ({
  listCloudBugReports: (...args: unknown[]) => mockListCloudBugReports(...args),
  insertCloudBugReport: (...args: unknown[]) => mockInsertCloudBugReport(...args),
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
  it("rejects a signed-out submitter with 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ title: "t", description: "d", author: "a" }) as never);
    expect(res.status).toBe(401);
    expect(mockInsertCloudBugReport).not.toHaveBeenCalled();
  });

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
      expect.objectContaining({ authorId: "u1", authorName: "닉네임", title: "t", description: "d" }),
    );
  });
});
