/**
 * Password hashing/verification for guest (non-logged-in) bug report
 * submissions — see `supabase/schema.sql`'s `bug_reports.password_hash`.
 * Kept as its own tiny module (not folded into `permissions.ts`, whose
 * header comment promises purely synchronous identity comparisons) and not
 * folded into `serverRepository.ts` either, so the hashing algorithm is
 * unit-testable in isolation from the Supabase service client.
 *
 * `bcryptjs` (pure JS, no native bindings) is used deliberately — this app
 * deploys to Vercel serverless functions, where a native `bcrypt` build can
 * fail to install/run without extra config.
 */
import bcrypt from "bcryptjs";

/** Cost factor for the guest password hash — bcryptjs default, no need to tune for this app's threat model (deters casual DB dumps, not a banking system). */
const SALT_ROUNDS = 10;

export async function hashGuestPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyGuestPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
