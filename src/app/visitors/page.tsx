import VisitorsDashboard from "@/components/visitors/VisitorsDashboard";

export const metadata = {
  title: "방문자 · 보드게임 허브",
  robots: { index: false, follow: false },
};

/**
 * Password-gated visitor list (2026-10-01): who visited, who came back.
 * Not under `/admin` because `src/proxy.ts` requires a Supabase admin login
 * there, which production doesn't have; the password is checked inside the
 * database by `list_visitors` (see `supabase/visitors.sql`).
 */
export default function VisitorsPage() {
  return <VisitorsDashboard />;
}
