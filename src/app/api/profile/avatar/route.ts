import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";

/**
 * Clears the caller's own `profiles.avatar_url` and deletes the file it points to.
 * Image upload was removed (2026-10-27 — the 3D character portrait is the profile
 * picture now); this only lets players who uploaded before then delete that photo
 * (`resetAvatar` in `src/store/profileStore.ts`). Routed through the server
 * (rather than a direct client `.update()`) for the same reason as
 * `api/subscription/toggle-cancel`: Postgres RLS can only allow/deny a
 * whole-row UPDATE, not restrict it to this one column, and a same-user
 * `profiles` update policy would also let the caller overwrite their own
 * `role`/`email` — see the comment above the `avatars` Storage policies in
 * `supabase/schema.sql`.
 *
 * Body: `{ avatarUrl: null }`.
 */
export async function POST(request: NextRequest) {
  const server = await createServerSupabase();
  if (!server) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { avatarUrl?: string | null } | null;
  if (!body || body.avatarUrl !== null) {
    return NextResponse.json({ error: "image upload was removed — avatarUrl must be null" }, { status: 400 });
  }

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  // Best-effort delete of the uploaded file. Never blocks the actual update on failure.
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

  // Mirror into the public leaderboard's avatar (supabase/player_stats.sql).
  // Best-effort: that column may not exist yet, and it must never block the
  // avatar change itself.
  await service
    .from("user_profiles")
    .update({ public_avatar_url: body.avatarUrl })
    .eq("id", user.id)
    .then(
      () => undefined,
      () => undefined,
    );

  const { error } = await service.from("profiles").update({ avatar_url: body.avatarUrl }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });

  return NextResponse.json({ ok: true, avatarUrl: body.avatarUrl });
}
