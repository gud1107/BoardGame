import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/adminGuard";
import { getServiceSupabase } from "@/lib/supabase/serviceClient";
import type { SubscriptionSource, SubscriptionStatus, Tier } from "@/lib/entitlements/types";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  tier: Tier;
  status: SubscriptionStatus;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  source: SubscriptionSource;
  gamesUsedToday: number;
  minutesUsedToday: number;
}

/** No table join here on purpose — three plain queries merged in JS, simplest thing that works at phase-1 scale. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const [{ data: profiles }, { data: subscriptions }, { data: usage }] = await Promise.all([
    service.from("profiles").select("id, email, role, created_at").order("created_at", { ascending: false }),
    service.from("subscriptions").select("user_id, tier, status, period_end, cancel_at_period_end, source"),
    service.from("usage_daily").select("user_id, games_used, minutes_used").eq("date", todayKey()),
  ]);

  const subByUser = new Map((subscriptions ?? []).map((s) => [s.user_id, s]));
  const usageByUser = new Map((usage ?? []).map((u) => [u.user_id, u]));

  const rows: AdminUserRow[] = (profiles ?? []).map((p) => {
    const sub = subByUser.get(p.id);
    const use = usageByUser.get(p.id);
    return {
      id: p.id,
      email: p.email,
      role: p.role,
      createdAt: p.created_at,
      tier: (sub?.tier as Tier) ?? "free",
      status: sub?.status ?? "active",
      periodEnd: sub?.period_end ?? null,
      cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
      source: sub?.source ?? "signup",
      gamesUsedToday: use?.games_used ?? 0,
      minutesUsedToday: use?.minutes_used ?? 0,
    };
  });

  return NextResponse.json({ users: rows });
}

interface UpdateUserBody {
  userId: string;
  tier?: Tier;
  status?: SubscriptionStatus;
  /** Extend period_end this many days from now; omit to leave unchanged. */
  extendDays?: number;
  resetUsageToday?: boolean;
}

/** Manual grant path — this is the entire "billing" system until a real PG is wired up (see HANDOFF.md). */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: admin.status });

  const service = getServiceSupabase();
  if (!service) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as UpdateUserBody | null;
  if (!body?.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const { data: existing } = await service
    .from("subscriptions")
    .select("period_end")
    .eq("user_id", body.userId)
    .maybeSingle();

  const patch: Record<string, unknown> = { source: "admin", updated_at: new Date().toISOString() };
  if (body.tier) patch.tier = body.tier;
  if (body.status) patch.status = body.status;
  if (typeof body.extendDays === "number" && body.extendDays !== 0) {
    const base = existing?.period_end && new Date(existing.period_end) > new Date() ? new Date(existing.period_end) : new Date();
    patch.period_end = new Date(base.getTime() + body.extendDays * 24 * 60 * 60 * 1000).toISOString();
  }

  await service.from("subscriptions").upsert({ user_id: body.userId, ...patch }, { onConflict: "user_id" });

  if (body.resetUsageToday) {
    await service
      .from("usage_daily")
      .upsert({ user_id: body.userId, date: todayKey(), games_used: 0, minutes_used: 0 }, { onConflict: "user_id,date" });
  }

  return NextResponse.json({ ok: true });
}
