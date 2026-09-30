import AdminGamesDashboard from "@/components/admin/AdminGamesDashboard";

export const metadata = {
  title: "게임 통계 · 관리자",
  robots: { index: false, follow: false },
};

/**
 * Admin-only per-game funnel + duplicate-user review (2026-10-01). Gated by
 * `src/proxy.ts` (login + `is_site_admin()`), and every RPC it calls
 * re-checks `is_site_admin()` inside the database — see
 * `supabase/game_events.sql`.
 */
export default function AdminGamesPage() {
  return <AdminGamesDashboard />;
}
