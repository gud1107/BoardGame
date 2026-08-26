"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAnalyticsAdminStore } from "@/store/analyticsAdminStore";

// Dark-surface categorical slots from the project's data-viz palette
// (see dataviz skill `references/palette.md`) — used in fixed order, never
// reassigned per-filter, so a series always keeps the same color.
const COLOR_VISITS = "#3987e5"; // slot 1 (blue)
const COLOR_UNIQUE = "#d95926"; // slot 2 (orange)
const COLOR_PLAYS = "#199e70"; // slot 3 (aqua)

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

function MomBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-white/40">— (비교 데이터 없음)</span>;
  const up = pct > 0;
  const flat = pct === 0;
  return (
    <span className={`text-xs font-medium ${flat ? "text-white/40" : up ? "text-emerald-400" : "text-rose-400"}`}>
      {flat ? "±0%" : `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`} 전월 대비
    </span>
  );
}

function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-xs text-white/50">
        {icon} {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="mb-4 text-sm font-semibold text-white/80">{title}</h3>
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

export default function AdminStatsPage() {
  const loading = useAnalyticsAdminStore((s) => s.loading);
  const error = useAnalyticsAdminStore((s) => s.error);
  const summary = useAnalyticsAdminStore((s) => s.summary);
  const trend = useAnalyticsAdminStore((s) => s.trend);
  const games = useAnalyticsAdminStore((s) => s.games);
  const trendMonths = useAnalyticsAdminStore((s) => s.trendMonths);
  const init = useAnalyticsAdminStore((s) => s.init);
  const setTrendMonths = useAnalyticsAdminStore((s) => s.setTrendMonths);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">통계 대시보드</h1>
        <Link href="/admin" className="text-xs text-white/50 underline hover:text-white/70">
          ← 관리자 대시보드
        </Link>
      </div>

      {loading && <p className="text-center text-sm text-white/40">불러오는 중…</p>}
      {error && <p className="text-center text-sm text-rose-300">{error}</p>}

      {!loading && !error && summary && (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon="📊"
              label="이번 달 방문수"
              value={formatNumber(summary.thisMonthVisits)}
              sub={<MomBadge pct={summary.visitMomChangePct} />}
            />
            <StatCard icon="🌐" label="누적 방문수" value={formatNumber(summary.totalVisits)} />
            <StatCard icon="🎮" label="전체 게임 총 플레이 수" value={formatNumber(summary.totalPlays)} />
            <StatCard icon="🔥" label="오늘 진행된 게임 수" value={formatNumber(summary.todayPlays)} />
          </div>

          <div className="mb-4 flex justify-end gap-2">
            {([6, 12] as const).map((m) => (
              <button
                key={m}
                onClick={() => void setTrendMonths(m)}
                className={`rounded-lg border px-3 py-1 text-xs transition ${
                  trendMonths === m
                    ? "border-rose-400 bg-rose-500/20 text-white"
                    : "border-white/15 text-white/50 hover:border-white/30"
                }`}
              >
                최근 {m}개월
              </button>
            ))}
          </div>

          <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="월별 방문 추이 (총 방문수 · 고유 방문자)">
              <ResponsiveContainer>
                <ComposedChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                    formatter={(value) => formatNumber(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }} />
                  <Bar dataKey="totalVisits" name="총 방문수" fill={COLOR_VISITS} radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="uniqueVisitors"
                    name="고유 방문자"
                    stroke={COLOR_UNIQUE}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="월별 총 플레이 수 추이">
              <ResponsiveContainer>
                <ComposedChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                    formatter={(value) => formatNumber(Number(value))}
                  />
                  <Bar dataKey="totalPlays" name="총 플레이 수" fill={COLOR_PLAYS} radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="mb-4 text-sm font-semibold text-white/80">게임별 플레이 랭킹</h2>
            {games.length === 0 ? (
              <p className="text-xs text-white/40">아직 기록된 플레이가 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="text-white/40">
                    <tr>
                      <th className="pb-2 pr-3">순위</th>
                      <th className="pb-2 pr-3">게임명</th>
                      <th className="pb-2 pr-3">누적 플레이 수</th>
                      <th className="pb-2 pr-3">이번 달 플레이 수</th>
                      <th className="pb-2 pr-3">점유율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((g) => (
                      <tr key={g.gameId} className="border-t border-white/5 text-white/70">
                        <td className="py-2 pr-3">{g.rank}</td>
                        <td className="py-2 pr-3">{g.name}</td>
                        <td className="py-2 pr-3">{formatNumber(g.totalPlays)}회</td>
                        <td className="py-2 pr-3">{formatNumber(g.thisMonthPlays)}회</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${g.sharePct}%`, backgroundColor: COLOR_VISITS }}
                              />
                            </div>
                            <span>{g.sharePct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
