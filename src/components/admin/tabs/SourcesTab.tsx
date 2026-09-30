"use client";

import { adminRpc, fmt, rate, SERIES, type ExcludeMe } from "../adminApi";
import { Empty, ErrorNote, Loading, Panel } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";

interface SourceRow {
  source: string;
  visits: number;
  visitors: number;
  new_visitors: number;
}

/**
 * 유입 경로 tab. Sources are classified when a visit is recorded
 * (`src/lib/analytics/trafficSource.ts`): in-app browsers by User-Agent
 * first (KakaoTalk usually sends no referrer), then the referrer's host.
 * Only visits recorded after supabase/admin_suite.sql ran carry a source.
 */
export default function SourcesTab({
  since,
  exclude,
  reloadKey,
}: {
  since: string | null;
  exclude: ExcludeMe | null;
  reloadKey: number;
}) {
  const { data, error } = useAdminQuery<SourceRow>(
    () => adminRpc("admin_traffic_sources", { p_since: since }, exclude),
    JSON.stringify([since, exclude, reloadKey]),
  );

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty>아직 기록된 방문이 없습니다.</Empty>;

  const total = data.reduce((a, r) => a + Number(r.visits), 0);
  const top = Math.max(...data.map((r) => Number(r.visits)), 1);

  return (
    <Panel title="어디서 들어왔나" note="방문 = 새 탭으로 사이트를 연 횟수 · 카카오톡 등은 앱 안의 브라우저로 열린 경우">
      <div className="flex flex-col gap-2">
        {data.map((r) => (
          <div key={r.source} className="grid grid-cols-[88px_1fr_150px] items-center gap-3 text-xs sm:grid-cols-[110px_1fr_190px]">
            <span className="truncate font-medium text-white/85 light:text-slate-800">{r.source}</span>
            <div className="h-3.5 rounded-r-[4px] bg-white/5 light:bg-slate-100">
              <div
                className="h-3.5 rounded-r-[4px]"
                style={{ width: `${(Number(r.visits) / top) * 100}%`, minWidth: 2, backgroundColor: SERIES.blue }}
                title={`${r.source}: 방문 ${fmt(r.visits)}회`}
              />
            </div>
            <span className="text-right tabular-nums text-white/80 light:text-slate-700">
              {fmt(r.visits)}회 <span className="text-white/40">{rate(Number(r.visits), total)}</span>
              <span className="ml-2 text-white/50">
                {fmt(r.visitors)}명 (신규 {fmt(r.new_visitors)})
              </span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
