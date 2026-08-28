/**
 * Pure authorization rules for the bug report board's edit/delete/status
 * actions. Kept dependency-free (no Supabase/Next imports) so this is
 * unit-testable under vitest's `environment: "node"` config, and so both
 * the API route handlers (server) and the detail modal (client, to decide
 * what to render) share exactly one source of truth instead of
 * reimplementing the same comparison twice — see `board.ts` for the same
 * "pure logic split out of the IO layer" convention already used in this
 * feature.
 *
 * The server-side check in the route handlers is the actual security
 * boundary; the client-side use of these same functions is UX only (hides
 * buttons a request would be rejected for anyway).
 */

/**
 * Content edit (title/description/game tag/phone/attachment) — the
 * author themself, or an admin, per the explicit request ("작성자 본인
 * 또는 관리자").
 */
export function canEditContent(authorId: string, userId: string | null, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return userId !== null && userId === authorId;
}

/** Delete uses the identical rule as content edit — kept as a distinct
 * name (not an alias) because the two actions are independent request
 * requirements and may diverge later. */
export function canDelete(authorId: string, userId: string | null, isAdmin: boolean): boolean {
  return canEditContent(authorId, userId, isAdmin);
}

/**
 * Processing-status changes (접수됨/확인 중/수정 완료) are a moderation
 * action, not a content edit — restricted to admins. This is a
 * deliberate tightening versus the pre-existing behavior, which let
 * anyone who could see the report (any visitor sharing the browser)
 * change its status with no check at all.
 */
export function canChangeStatus(isAdmin: boolean): boolean {
  return isAdmin;
}
