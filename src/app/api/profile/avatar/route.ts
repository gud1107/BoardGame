import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";

/**
 * Persists the caller's own `profiles.avatar_url` after they've already
 * uploaded the file straight to Supabase Storage's `avatars` bucket from the
 * browser (see `src/store/profileStore.ts`). Routed through the server
 * (rather than a direct client `.update()`) for the same reason as
 * `api/subscription/toggle-cancel`: Postgres RLS can only allow/deny a
 * whole-row UPDATE, not restrict it to this one column, and a same-user
 * `profiles` update policy would also let the caller overwrite their own
 * `role`/`email` — see the comment above the `avatars` Storage policies in
 * `supabase/schema.sql`.
 *
 * Body: `{ avatarUrl: string | null }` — null resets to the app default
 * (`DEFAULT_AVATAR`, rendered client-side whenever the column is null).
 */
export async function POST(request: NextRequest) {
  const server = await createServerSupabase();
  if (!server) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { avatarUrl?: string | null } | null;
  if (!body || (body.avatarUrl !== null && typeof body.avatarUrl !== "string")) {
    return NextResponse.json({ error: "avatarUrl must be a string or null" }, { status: 400 });
  }

  // Sanity check: the value must actually be a public URL inside this
  // user's own Storage folder — never trust a client-supplied URL blindly
  // even though it only ever gets written to that same user's own row.
  if (body.avatarUrl !== null) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const expectedPrefix = url ? `${url}/storage/v1/object/public/avatars/${user.id}/` : null;
    if (!expectedPrefix || !body.avatarUrl.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "avatarUrl must point to the caller's own avatars folder" }, { status: 400 });
    }
  }

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  // Best-effort cleanup of the previous uploaded file so a user repeatedly
  // changing their avatar doesn't silently accumulate orphaned Storage
  // objects. Never blocks the actual update on failure.
  const { data: current } = await service.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle();
  const previousUrl = current?.avatar_url as string | null | undefined;
  if (previousUrl && previousUrl !== body.avatarUrl) {
    const marker = `/storage/v1/object/public/avatars/`;
    const idx = previousUrl.indexOf(marker);
    if (idx !== -1) {
      const path = previousUrl.slice(idx + marker.length);
      if (path.startsWith(`${user.id}/`)) {
        await service.storage.from("avatars").remove([path]).catch(() => {});
      }
    }
  }

  const { error } = await service.from("profiles").update({ avatar_url: body.avatarUrl }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });

  return NextResponse.json({ ok: true, avatarUrl: body.avatarUrl });
}
