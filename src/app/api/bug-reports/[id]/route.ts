import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { SUPER_ADMIN_EMAIL } from "@/lib/admin/superAdmin";
import {
  getCloudBugReport,
  getProfile,
  softDeleteCloudBugReport,
  updateCloudBugReport,
  verifyGuestReportPassword,
  type UpdateBugReportInput,
} from "@/lib/bugReports/serverRepository";
import { canChangeStatus, canDelete, canEditContent } from "@/lib/bugReports/permissions";
import type { BugReportAttachment, BugReportStatus } from "@/lib/db/types";
import type { CloudBugReportRecord } from "@/lib/bugReports/types";

interface PatchBody {
  title?: string;
  description?: string;
  author?: string;
  gameId?: string | null;
  gameName?: string | null;
  phone?: string | null;
  attachment?: BugReportAttachment | null;
  status?: BugReportStatus;
  /** Required to authorize a content edit on a guest report from someone who isn't an admin — see `authorizeContentChange`. */
  password?: string;
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

interface AuthContext {
  userId: string | null;
  /**
   * Folds together `profiles.role === 'admin'` and the
   * `SUPER_ADMIN_EMAIL` bypass (`src/lib/admin/superAdmin.ts`) — every
   * existing admin already gets full delete/edit power over every report
   * (see `permissions.ts`'s header comment), and this session's request
   * asked for freedom_03@naver.com's "마스터 삭제" to additionally always
   * pass even on an account with no `profiles` row / a non-admin role, not
   * to replace the existing admin-role behavior. `null` (signed-out) users
   * are never the super admin, obviously — they fall through to the guest
   * password path below instead.
   */
  isAdmin: boolean;
}

async function getAuthContext(): Promise<{ ok: true; auth: AuthContext } | { ok: false; status: 503 }> {
  const server = await createServerSupabase();
  if (!server) return { ok: false, status: 503 };

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return { ok: true, auth: { userId: null, isAdmin: false } };

  const profile = await getProfile(user.id);
  const isAdmin = profile?.role === "admin" || user.email === SUPER_ADMIN_EMAIL;
  return { ok: true, auth: { userId: user.id, isAdmin } };
}

/**
 * Authorizes a content edit: identity-based (`canEditContent`) first, and
 * for a guest report that fails identity (nobody can match `authorId: null`
 * by identity — see `permissions.ts`), a submitted password checked against
 * the stored hash. `false` for a non-guest report even with a `password` in
 * the body (there's nothing to check it against).
 */
async function authorizeContentChange(
  existing: CloudBugReportRecord,
  auth: AuthContext,
  password: string | undefined,
): Promise<boolean> {
  if (canEditContent(existing.authorId, auth.userId, auth.isAdmin)) return true;
  if (existing.isGuest && password) return verifyGuestReportPassword(existing.id, password);
  return false;
}

/** Same shape as `authorizeContentChange`, for delete — see `canDelete`. */
async function authorizeDelete(
  existing: CloudBugReportRecord,
  auth: AuthContext,
  password: string | undefined,
): Promise<boolean> {
  if (canDelete(existing.authorId, auth.userId, auth.isAdmin)) return true;
  if (existing.isGuest && password) return verifyGuestReportPassword(existing.id, password);
  return false;
}

/**
 * Edits a report's content (author-or-admin-or-correct-guest-password)
 * and/or its processing status (admin-only, unchanged by the guest
 * feature — a guest never gets a password-based bypass for this) — see
 * `permissions.ts` for the identity rules and `serverRepository.ts` for
 * why this can safely use the service role without a client-reachable RLS
 * backstop.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx.ok) return NextResponse.json({ error: "not configured" }, { status: ctx.status });
  const { auth } = ctx;

  const existing = await getCloudBugReport(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const wantsContentChange = CONTENT_FIELDS.some((f) => body[f] !== undefined);
  const wantsStatusChange = body.status !== undefined;

  if (wantsContentChange && !(await authorizeContentChange(existing, auth, body.password))) {
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

/** Soft-deletes (author-or-admin-or-correct-guest-password) — see `permissions.ts`. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx.ok) return NextResponse.json({ error: "not configured" }, { status: ctx.status });
  const { auth } = ctx;

  const existing = await getCloudBugReport(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  // A DELETE request only needs a body when a guest is proving ownership
  // via password — a missing/unparseable body (the common case: an
  // author-or-admin delete) is not an error here.
  const body = (await request.json().catch(() => null)) as { password?: string } | null;

  if (!(await authorizeDelete(existing, auth, body?.password))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ok = await softDeleteCloudBugReport(id);
  if (!ok) return NextResponse.json({ error: "not configured" }, { status: 503 });

  return NextResponse.json({ ok: true });
}
