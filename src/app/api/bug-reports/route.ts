import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { insertCloudBugReport, listCloudBugReports } from "@/lib/bugReports/serverRepository";
import { validateBugReportInput, type BugReportFormInput } from "@/lib/bugReports/validate";
import type { BugReportAttachment } from "@/lib/db/types";

/** Public — the board is readable by anyone, same as before this feature added accounts. */
export async function GET() {
  const reports = await listCloudBugReports();
  return NextResponse.json({ reports });
}

interface CreateBody extends BugReportFormInput {
  gameId?: string;
  gameName?: string;
  attachment?: BugReportAttachment;
}

/**
 * Submitting a bug report now requires login (see HANDOFF.md — the prior
 * anonymous/IndexedDB-only design had no `authorId` to authorize edits
 * against, so an account link is unavoidable for this feature).
 */
export async function POST(request: NextRequest) {
  const server = await createServerSupabase();
  if (!server) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const errors = validateBugReportInput(body);
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: "validation", errors }, { status: 400 });

  // `validateBugReportInput` above already rejects a blank `author`, so no
  // profile-nickname fallback is needed here — the field is always
  // free-text supplied by the submitter, same as the pre-account design.
  const record = await insertCloudBugReport({
    gameId: body.gameId,
    gameName: body.gameName,
    title: body.title.trim(),
    description: body.description.trim(),
    authorId: user.id,
    authorName: body.author.trim(),
    phone: body.phone?.trim() || undefined,
    attachment: body.attachment,
  });
  if (!record) return NextResponse.json({ error: "not configured" }, { status: 503 });

  return NextResponse.json({ report: record }, { status: 201 });
}
