"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

const SQL_EDITOR_URL = "https://supabase.com/dashboard/project/kamwwbveqizpfufsebof/sql/new";

/**
 * Warns on /admin/games when supabase/admin_suite.sql hasn't been applied
 * to the live database — without it the lobby's "🔥 10월 N회 플레이",
 * the notice banner and game visibility all silently do nothing, which is
 * easy to miss (the SQL editor asks to confirm its DROP/DELETE statements,
 * and dismissing that dialog runs nothing).
 */
export default function SetupStatus() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    void supabase.rpc("public_game_play_stats").then(({ error }) => {
      if (!cancelled && error?.code === "PGRST202") setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!missing) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 light:text-amber-900">
      <p className="font-semibold">⚠️ DB 설정이 아직 적용되지 않았습니다 (supabase/admin_suite.sql)</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-100/80 light:text-amber-800">
        이 상태에서는 허브의 &quot;🔥 10월 N회 플레이&quot;, 추이·시간대·방 기록·유입 경로, 공지, 게임 관리가 동작하지 않습니다.
        SQL Editor에 파일 전체를 붙여넣고 Run → 확인 창(&quot;destructive operation&quot;)이 뜨면 <b>Run this query</b>를 누르세요.
      </p>
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
