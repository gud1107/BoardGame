/**
 * Global default profile avatar. Every player identity in this app (logged-in
 * account, guest, in-game seat) falls back to this image whenever no custom
 * avatar is set — see `src/components/common/Avatar.tsx` for the actual
 * fallback wiring. Kept as a named constant (rather than a literal string
 * scattered across callers) so the asset can move without a grep-and-replace.
 */
export const DEFAULT_AVATAR = "/assets/images/user.png";
