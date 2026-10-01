import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { bootstrapProfile } from "@/lib/auth/bootstrapProfile";

/**
 * OAuth (PKCE) landing page for social login — see
 * src/components/auth/SocialLoginButtons.tsx. Supabase redirects here with
 * `?code=...` after Kakao/Google/GitHub/Discord approve the user; we trade it
 * for a session and write the session cookies onto the redirect response
 * itself (same cookie-adapter pattern as src/proxy.ts), so the browser lands
 * on `next` already signed in.
 *
 * The public nickname/avatar row (`user_profiles`) is created by the DB
 * trigger in supabase/social_auth.sql, not here.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!code || !url || !anonKey) {
    return NextResponse.redirect(new URL(`/login?error=oauth`, origin));
  }

  const response = NextResponse.redirect(new URL(next, origin));
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL(`/login?error=oauth`, origin));
  }

  // Same idempotent profile/trial bootstrap the email login runs.
  await bootstrapProfile(data.user).catch(() => null);

  return response;
}

/** Only same-origin relative paths — never an open redirect to `//evil.com`. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
