"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { adminRpc, fmt, SERIES, type ExcludeMe } from "../adminApi";
import { Chip, ErrorNote, Loading, Panel, StatCard } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";

interface DailyRow {
  day: string;
  visitors: number;
  new_visitors: number;
  returning_visitors: number;
  visits: number;
  room_creates: number;
  game_starts: number;
}

const RANGES = [14, 30, 90] as const;

// Recessive chrome: gridlines and axes stay quiet so the marks carry the chart.
const GRID = "rgba(148,163,184,0.15)";
const TICK = { fill: "rgba(148,163,184,0.9)", fontSize: 11 };
const TOOLTIP_STYLE = {
  background: "rgba(10,10,10,0.92)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 12,
  color: "#fff",
};

const shortDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 추이 tab: daily visitors (new vs returning) and daily game activity, Korea days. */
export default function TrendTab({ exclude, reloadKey }: { exclude: ExcludeMe | null; reloadKey: number }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [showTable, setShowTable] = useState(false);
  const { data, error } = useAdminQuery<DailyRow>(
    () => adminRpc("admin_daily_stats", { p_days: days }, exclude),
    JSON.stringify([days, exclude, reloadKey]),
  );

  const rows = (data ?? []).map((r) => ({
    ...r,
    label: shortDay(String(r.day)),
    visitors: Number(r.visitors),
    new_visitors: Number(r.new_visitors),
    returning_visitors: Number(r.returning_visitors),
    room_creates: Number(r.room_creates),
    game_starts: Number(r.game_starts),
  }));
  const sum = (k: keyof DailyRow) => rows.reduce((a, r) => a + Number(r[k]), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((d) => (
          <Chip key={d} active={days === d} onClick={() => setDays(d)}>
            최근 {d}일
          </Chip>
        ))}
      </div>
      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="방문 (일별 방문자 합)" value={fmt(sum("visitors"))} sub={`신규 ${fmt(sum("new_visitors"))} · 재방문 ${fmt(sum("returning_visitors"))}`} />
            <StatCard label="총 방문 횟수" value={fmt(sum("visits"))} />
            <StatCard label="방 만들기" value={fmt(sum("room_creates"))} />
            <StatCard label="게임 시작" value={fmt(sum("game_starts"))} />
          </div>

          <Panel title="일별 방문자" note="하루 동안 들어온 기기 수 · 신규(그날 처음 온 기기)와 재방문으로 나눔">
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="returning_visitors" name="재방문" stackId="v" fill={SERIES.blue} stroke="transparent" />
                  <Bar dataKey="new_visitors" name="신규" stackId="v" fill={SERIES.aqua} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="일별 게임 활동" note="방 만들기 = 실제로 연 방 · 게임 시작 = 방장이 시작한 판(혼자 하는 게임은 매 판)">
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <LineChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="game_starts" name="게임 시작" stroke={SERIES.blue} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="room_creates" name="방 만들기" stroke={SERIES.orange} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <button type="button" onClick={() => setShowTable((v) => !v)} className="self-start text-xs text-white/50 underline">
            {showTable ? "표 숨기기" : "표로 보기"}
          </button>
          {showTable && (
            <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
              <table className="w-full min-w-[560px] text-right text-xs tabular-nums">
                <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">날짜</th>
                    <th className="px-3 py-2 font-medium">방문자</th>
                    <th className="px-3 py-2 font-medium">신규</th>
                    <th className="px-3 py-2 font-medium">재방문</th>
                    <th className="px-3 py-2 font-medium">방문 횟수</th>
                    <th className="px-3 py-2 font-medium">방 만들기</th>
                    <th className="px-3 py-2 font-medium">게임 시작</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-white/80 light:divide-slate-100 light:text-slate-700">
                  {[...rows].reverse().map((r) => (
                    <tr key={String(r.day)}>
                      <td className="px-3 py-1.5 text-left">{String(r.day)}</td>
                      <td className="px-3 py-1.5">{fmt(r.visitors)}</td>
                      <td className="px-3 py-1.5">{fmt(r.new_visitors)}</td>
                      <td className="px-3 py-1.5">{fmt(r.returning_visitors)}</td>
                      <td className="px-3 py-1.5">{fmt(r.visits)}</td>
                      <td className="px-3 py-1.5">{fmt(r.room_creates)}</td>
                      <td className="px-3 py-1.5">{fmt(r.game_starts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
