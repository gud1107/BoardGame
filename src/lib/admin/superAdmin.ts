/**
 * A handful of admin-dashboard controls are sensitive enough to restrict to
 * one specific developer account rather than every `profiles.role='admin'`
 * user (currently: the entitlements kill switch on `/admin`). Compared
 * client-side (to decide what to render/enable) and re-checked server-side
 * in the route handler that writes the setting — the client check is only
 * UX, never the actual boundary.
 */
export const SUPER_ADMIN_EMAIL = "freedom_03@naver.com";
