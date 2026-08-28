import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCloudBugReport,
  getProfile,
  softDeleteCloudBugReport,
  updateCloudBugReport,
  type UpdateBugReportInput,
} from "@/lib/bugReports/serverRepository";
import { canChangeStatus, canDelete, canEditContent } from "@/lib/bugReports/permissions";
import type { BugReportAttachment, BugReportStatus } from "@/lib/db/types";

interface PatchBody {
  title?: string;
  description?: string;
  author?: string;
  gameId?: string | null;
  gameName?: string | null;
  phone?: string | null;
  attachment?: BugReportAttachment | null;
  status?: BugReportStatus;
}

const CONTENT_FIELDS: (keyof PatchBody)[] = [
  "title",
  "description",
  "author",
  "gameId",
  "gameName",
  "phone",
  "attachment",
];

async function requireUser(): Promise<
  { ok: true; userId: string; isAdmin: boolean } | { ok: false; status: 401 | 503 }
> {
  const server = await createServerSupabase();
  if (!server) return { ok: false, status: 503 };
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return { ok: false, status: 401 };
  const profile = await getProfile(user.id);
  return { ok: true, userId: user.id, isAdmin: profile?.role === "admin" };
}

/**
 * Edits a report's content (author-or-admin) and/or its processing status
 * (admin-only) — see `permissions.ts` for the rules and
 * `serverRepository.ts` for why this can safely use the service role
 * without a client-reachable RLS backstop.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "not configured" }, { status: auth.status });

  const existing = await getCloudBugReport(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const wantsContentChange = CONTENT_FIELDS.some((f) => body[f] !== undefined);
  const wantsStatusChange = body.status !== undefined;

  if (wantsContentChange && !canEditContent(existing.authorId, auth.userId, auth.isAdmin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (wantsStatusChange && !canChangeStatus(auth.isAdmin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (body.title !== undefined && !body.title.trim()) {
    return NextResponse.json({ error: "validation", errors: { title: "제목을 입력해주세요." } }, { status: 400 });
  }
  if (body.description !== undefined && !body.description.trim()) {
    return NextResponse.json(
      { error: "validation", errors: { description: "내용을 입력해주세요." } },
      { status: 400 },
    );
  }
  if (body.author !== undefined && !body.author.trim()) {
    return NextResponse.json({ error: "validation", errors: { author: "글쓴이(작성자)를 입력해주세요." } }, { status: 400 });
  }

  const patch: UpdateBugReportInput = {
    title: body.title?.trim(),
    description: body.description?.trim(),
    authorName: body.author?.trim(),
    gameId: body.gameId,
    gameName: body.gameName,
    phone: body.phone === undefined ? undefined : body.phone?.trim() || null,
    attachment: body.attachment === undefined ? undefined : body.attachment,
    status: body.status,
  };

  const updated = await updateCloudBugReport(id, patch);
  if (!updated) return NextResponse.json({ error: "not configured" }, { status: 503 });

  return NextResponse.json({ report: updated });
}

/** Soft-deletes (author-or-admin) — see `permissions.ts`. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "not configured" }, { status: auth.status });

  const existing = await getCloudBugReport(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!canDelete(existing.authorId, auth.userId, auth.isAdmin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ok = await softDeleteCloudBugReport(id);
  if (!ok) return NextResponse.json({ error: "not configured" }, { status: 503 });

  return NextResponse.json({ ok: true });
}
