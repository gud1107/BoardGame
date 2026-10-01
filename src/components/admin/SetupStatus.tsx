"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

const SQL_EDITOR_URL = "https://supabase.com/dashboard/project/kamwwbveqizpfufsebof/sql/new";

/**
 * Warns on /admin/games when a required supabase/*.sql file hasn't been applied
 * to the live database — without it the lobby's "🔥 10월 N회 플레이",
 * the notice banner and game visibility all silently do nothing, which is
 * easy to miss (the SQL editor asks to confirm its DROP/DELETE statements,
 * and dismissing that dialog runs nothing).
 */
/**
 * Each SQL file the admin hub depends on, and one function it creates. The
 * probe runs with the anon key: a missing function answers PGRST202, an
 * existing admin-only one answers "permission denied" — either way nothing
 * is read or written.
 */
const CHECKS = [
  {
    file: "supabase/admin_suite.sql",
    rpc: "public_game_play_stats",
    args: {},
    effect: "허브의 \"🔥 10월 N회 플레이\", 추이·시간대·방 기록·유입 경로, 공지, 게임 관리",
    destructive: true,
  },
  {
    file: "supabase/admin_monthly.sql",
    rpc: "admin_monthly_stats",
    args: { p_months: 1 },
    effect: "📅 월별 탭",
    destructive: false,
  },
  {
    file: "supabase/admin_ip_labels.sql",
    rpc: "admin_list_ip_labels",
    args: {},
    effect: "🏷️ IP 관리 탭과 IP 이름 표시",
    destructive: false,
  },
  {
    file: "supabase/admin_ip_labels_2.sql",
    rpc: "admin_labeled_activity",
    args: {},
    effect: "🔔 이름 붙인 사람 접속 알림과 \"이름 붙인 IP 제외\"",
    destructive: false,
  },
  {
    file: "supabase/admin_alerts.sql",
    rpc: "admin_get_alert_settings",
    args: {},
    effect: "📱 휴대폰 알림(ntfy)과 사람별 🔔 선택",
    destructive: false,
  },
];

export default function SetupStatus() {
  const [missing, setMissing] = useState<typeof CHECKS>([]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    void Promise.all(
      CHECKS.map(async (c) => {
        const { error } = await supabase.rpc(c.rpc, c.args);
        return error?.code === "PGRST202" ? c : null;
      }),
    ).then((results) => {
      if (!cancelled) setMissing(results.filter((c): c is (typeof CHECKS)[number] => c !== null));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (missing.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 light:text-amber-900">
      <p className="font-semibold">⚠️ 아직 적용되지 않은 DB 설정이 있습니다</p>
      <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-amber-100/80 light:text-amber-800">
        {missing.map((c) => (
          <li key={c.file}>
            <b className="font-mono">{c.file}</b> — 없으면 {c.effect}이(가) 동작하지 않습니다.
            {c.destructive && " Run 후 확인 창(\"destructive operation\")이 뜨면 Run this query를 누르세요."}
          </li>
        ))}
      </ul>
      <a
        href={SQL_EDITOR_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400"
      >
        Supabase SQL Editor 열기 ↗
      </a>
    </div>
  );
}
