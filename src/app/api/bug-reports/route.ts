import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { hashGuestPassword } from "@/lib/bugReports/guestAuth";
import { getLastGuestSubmissionAt, insertCloudBugReport, listCloudBugReports } from "@/lib/bugReports/serverRepository";
import { validateBugReportInput, validateGuestPassword, type BugReportFormInput } from "@/lib/bugReports/validate";
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
  /** Required when submitting without a login (guest) — ignored for a logged-in submitter. */
  password?: string;
  /** Guest submission only — see `src/lib/identity/deviceId.ts`. Powers the per-device cooldown below. */
  deviceId?: string;
}

/**
 * A device may submit at most one guest report per this window. A weak,
 * client-supplied (`deviceId`) signal — same "nudge, not a hard wall"
 * posture as `guest_usage`'s entitlement caps elsewhere in this app — not
 * a real anti-abuse system (no CAPTCHA/IP throttling, per explicit
 * confirmation with the requester). No spec'd value was given, so this is
 * a directly-chosen reasonable default (mirrors how `IDLE_VOTE_THRESHOLD_MS`
 * was picked in `botTakeover.ts`).
 */
const GUEST_SUBMIT_COOLDOWN_MS = 60_000;

/**
 * Submitting a bug report supports both a logged-in author (`authorId` set)
 * and a guest (no session — authorized instead by a password the submitter
 * picks now and must supply again to edit/delete, see `guestAuth.ts`). This
 * re-adds the anonymous path the 2026-08-28 session removed — see
 * HANDOFF.md for why, and for the guest password design that replaces it.
 */
export async function POST(request: NextRequest) {
  const server = await createServerSupabase();
  if (!server) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const {
    data: { user },
  } = await server.auth.getUser();

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const isGuest = !user;
  const errors = validateBugReportInput(body);
  if (isGuest) {
    const passwordError = validateGuestPassword(body.password);
    if (passwordError) errors.password = passwordError;
  }
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: "validation", errors }, { status: 400 });

  const deviceId = body.deviceId?.trim() || undefined;
  if (isGuest && deviceId) {
    const lastSubmittedAt = await getLastGuestSubmissionAt(deviceId);
    if (lastSubmittedAt && Date.now() - new Date(lastSubmittedAt).getTime() < GUEST_SUBMIT_COOLDOWN_MS) {
      return NextResponse.json({ error: "cooldown" }, { status: 429 });
    }
  }

  // `validateBugReportInput` above already rejects a blank `author`, so no
  // profile-nickname fallback is needed here — the field is always
  // free-text supplied by the submitter, same as the pre-account design.
  const record = await insertCloudBugReport({
    gameId: body.gameId,
    gameName: body.gameName,
    title: body.title.trim(),
    description: body.description.trim(),
    authorId: user?.id,
    authorName: body.author.trim(),
    isGuest,
    passwordHash: isGuest && body.password ? await hashGuestPassword(body.password) : undefined,
    deviceId: isGuest ? deviceId : undefined,
    phone: body.phone?.trim() || undefined,
    attachment: body.attachment,
  });
  if (!record) return NextResponse.json({ error: "not configured" }, { status: 503 });

  return NextResponse.json({ report: record }, { status: 201 });
}
