import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 renamed `middleware.ts` -> `proxy.ts` (`export function proxy`
 * instead of `middleware`) — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
 * This is the project's first proxy/middleware file.
 *
 * Scoped to `/admin/:path*` only (see `config.matcher` below) rather than
 * every request — this is purely a page-level redirect gate for UX;
 * `src/app/api/admin/*` Route Handlers independently re-verify the caller's
 * role themselves and must never rely on this having run.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Accounts feature isn't configured at all — nothing to gate into.
    return NextResponse.redirect(new URL("/", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Site admins are checked inside the database (`is_site_admin()`, see
  // supabase/game_events.sql: a confirmed email listed in `site_admins`),
  // which works without the `profiles` table or a service-role key —
  // neither exists in production. `profiles.role` stays as a fallback.
  const { data: isSiteAdmin } = await supabase.rpc("is_site_admin");
  if (isSiteAdmin !== true) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
