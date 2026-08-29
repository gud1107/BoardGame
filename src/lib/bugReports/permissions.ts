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
 *
 * `isAdmin` here is expected to already fold in the `SUPER_ADMIN_EMAIL`
 * bypass (`src/lib/admin/superAdmin.ts`) at the call site — every admin
 * (not just the super admin) already gets full delete/edit power over
 * every report by the rule below, so the super admin's "마스터 삭제" is
 * implemented as "always counts as `isAdmin` here", not as a separate
 * rule. See the route handlers for where that fold happens.
 *
 * A guest (non-logged-in) report has `authorId: null` — nobody can match
 * it by identity, so these functions correctly fall through to `false` for
 * everyone except an admin. The guest's own password-based authorization
 * is a *separate* path the route handlers check in addition to these
 * functions (see `guestAuth.ts` — comparing a plaintext password against a
 * stored hash isn't a pure identity comparison, so it doesn't belong here).
 */

/**
 * Content edit (title/description/game tag/phone/attachment) — the
 * author themself, or an admin, per the explicit request ("작성자 본인
 * 또는 관리자"). A guest report (`authorId: null`) is never matched here —
 * see the guest password path in the route handlers.
 */
export function canEditContent(authorId: string | null, userId: string | null, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return userId !== null && authorId !== null && userId === authorId;
}

/** Delete uses the identical rule as content edit — kept as a distinct
 * name (not an alias) because the two actions are independent request
 * requirements and may diverge later. */
export function canDelete(authorId: string | null, userId: string | null, isAdmin: boolean): boolean {
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
