"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getGameMeta } from "@/games/registry";
import { adminRpc, fmt, SERIES, type ExcludeMe } from "../adminApi";
import { Chip, Empty, ErrorNote, Loading, Panel, StatCard } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";

interface MonthRow {
  month: string;
  visitors: number;
  new_visitors: number;
  returning_visitors: number;
  visits: number;
  room_creates: number;
  joins: number;
  game_starts: number;
  game_ends: number;
  active_players: number;
}

interface MonthGameRow {
  month: string;
  game_id: string;
  hub_clicks: number;
  room_creates: number;
  joins: number;
  game_starts: number;
  players: number;
}

const RANGES = [6, 12] as const;

const GRID = "rgba(148,163,184,0.15)";
const TICK = { fill: "rgba(148,163,184,0.9)", fontSize: 11 };
const TOOLTIP_STYLE = {
  background: "rgba(10,10,10,0.92)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 12,
  color: "#fff",
};

/** "2026-10-01" → "10월" (adds the year when it isn't this year's). */
function monthLabel(month: string, thisYear: string): string {
  const [y, m] = month.slice(0, 7).split("-");
  return y === thisYear ? `${Number(m)}월` : `${y.slice(2)}년 ${Number(m)}월`;
}

/** Change vs. the previous month, e.g. "▲ 25%"; null when there's nothing to compare to. */
export function monthOverMonth(current: number, previous: number): { text: string; up: boolean | null } | null {
  if (previous <= 0) return current > 0 ? { text: "신규", up: true } : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "±0%", up: null };
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`, up: pct > 0 };
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const d = monthOverMonth(current, previous);
  if (!d) return <span className="text-white/30">—</span>;
  const tone = d.up === null ? "text-white/40" : d.up ? "text-emerald-300" : "text-rose-300";
  return <span className={tone}>{d.text}</span>;
}

/**
 * 📅 월별 tab (Korea-time calendar months): site-wide visitors, rooms and
 * starts per month with change vs. the previous month, and a per-game
 * ranking for any chosen month. Needs supabase/admin_monthly.sql.
 */
export default function MonthlyTab({ exclude, reloadKey }: { exclude: ExcludeMe | null; reloadKey: number }) {
  const [months, setMonths] = useState<(typeof RANGES)[number]>(6);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const { data, error } = useAdminQuery<MonthRow>(
    () => adminRpc("admin_monthly_stats", { p_months: months }, exclude),
    JSON.stringify(["m", months, exclude, reloadKey]),
  );
  const { data: gameData, error: gameError } = useAdminQuery<MonthGameRow>(
    () => adminRpc("admin_monthly_game_stats", { p_months: months }, exclude),
    JSON.stringify(["g", months, exclude, reloadKey]),
  );

  const thisYear = String(new Date().getFullYear());
  // Small arrays (≤ 12 months, a few dozen games) — computed inline.
  const rows = (data ?? []).map((r) => ({
        month: String(r.month).slice(0, 10),
        label: monthLabel(String(r.month), thisYear),
        visitors: Number(r.visitors),
        new_visitors: Number(r.new_visitors),
        returning_visitors: Number(r.returning_visitors),
        visits: Number(r.visits),
        room_creates: Number(r.room_creates),
        joins: Number(r.joins),
        game_starts: Number(r.game_starts),
        game_ends: Number(r.game_ends),
        active_players: Number(r.active_players),
      }));

  const current = rows.at(-1);
  const previous = rows.at(-2);
  const selected = pickedMonth ?? current?.month ?? null;
  const selectedIdx = rows.findIndex((r) => r.month === selected);
  const prevMonth = selectedIdx > 0 ? rows[selectedIdx - 1].month : null;

  const gameRanking = (() => {
    if (!selected) return [];
    const byKey = new Map((gameData ?? []).map((r) => [`${String(r.month).slice(0, 10)}|${r.game_id}`, r]));
    const ids = new Set((gameData ?? []).filter((r) => String(r.month).slice(0, 10) === selected).map((r) => r.game_id));
    return [...ids]
      .map((id) => {
        const r = byKey.get(`${selected}|${id}`)!;
        const p = prevMonth ? byKey.get(`${prevMonth}|${id}`) : undefined;
        return {
          id,
          starts: Number(r.game_starts),
          prevStarts: Number(p?.game_starts ?? 0),
          players: Number(r.players),
          rooms: Number(r.room_creates),
          joins: Number(r.joins),
          clicks: Number(r.hub_clicks),
        };
      })
      .sort((a, b) => b.starts - a.starts || b.clicks - a.clicks);
  })();

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((m) => (
          <Chip key={m} active={months === m} onClick={() => setMonths(m)}>
            최근 {m}개월
          </Chip>
        ))}
      </div>

      {current && (
        <>
          <p className="text-xs text-white/50 light:text-slate-500">
            이번 달({current.label}) · 괄호는 지난달({previous?.label ?? "—"}) 대비
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["방문자", "visitors", `신규 ${fmt(current.new_visitors)} · 재방문 ${fmt(current.returning_visitors)}`],
                ["게임 시작", "game_starts", `끝까지 한 판 ${fmt(current.game_ends)}`],
                ["방 만들기", "room_creates", `참여 ${fmt(current.joins)}`],
                ["플레이한 사람", "active_players", "게임을 시작한 기기 수"],
              ] as const
            ).map(([label, key, sub]) => (
              <div key={key} className="relative">
                <StatCard label={label} value={fmt(current[key])} sub={sub} />
                <span className="absolute top-4 right-4 text-xs font-semibold">
                  <Delta current={current[key]} previous={previous?.[key] ?? 0} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Panel title="월별 방문자" note="한 달 동안 온 서로 다른 기기 수 · 신규(그달 처음 온 기기)와 재방문으로 나눔">
        <div className="h-60 w-full">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="returning_visitors" name="재방문" stackId="v" fill={SERIES.blue} />
              <Bar dataKey="new_visitors" name="신규" stackId="v" fill={SERIES.aqua} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="월별 게임 시작" note="방장이 실제로 시작한 판 (혼자 하는 게임은 매 판)">
        <div className="h-52 w-full">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
              <Bar dataKey="game_starts" name="게임 시작" fill={SERIES.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <button type="button" onClick={() => setShowTable((v) => !v)} className="self-start text-xs text-white/50 underline">
        {showTable ? "월별 표 숨기기" : "월별 표로 보기"}
      </button>
      {showTable && (
        <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
          <table className="w-full min-w-[640px] text-right text-xs tabular-nums">
            <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">월</th>
                <th className="px-3 py-2 font-medium">방문자</th>
                <th className="px-3 py-2 font-medium">신규</th>
                <th className="px-3 py-2 font-medium">재방문</th>
                <th className="px-3 py-2 font-medium">방문 횟수</th>
                <th className="px-3 py-2 font-medium">방 만들기</th>
                <th className="px-3 py-2 font-medium">참여</th>
                <th className="px-3 py-2 font-medium">게임 시작</th>
                <th className="px-3 py-2 font-medium">플레이한 사람</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80 light:divide-slate-100 light:text-slate-700">
              {[...rows].reverse().map((r) => (
                <tr key={r.month}>
                  <td className="px-3 py-1.5 text-left">{r.label}</td>
                  <td className="px-3 py-1.5">{fmt(r.visitors)}</td>
                  <td className="px-3 py-1.5">{fmt(r.new_visitors)}</td>
                  <td className="px-3 py-1.5">{fmt(r.returning_visitors)}</td>
                  <td className="px-3 py-1.5">{fmt(r.visits)}</td>
                  <td className="px-3 py-1.5">{fmt(r.room_creates)}</td>
                  <td className="px-3 py-1.5">{fmt(r.joins)}</td>
                  <td className="px-3 py-1.5">{fmt(r.game_starts)}</td>
                  <td className="px-3 py-1.5">{fmt(r.active_players)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Panel title="게임별 월간 순위" note="게임 시작 많은 순 · 괄호는 지난달 대비">
        <div className="mb-3 flex flex-wrap gap-2">
          {[...rows].reverse().map((r) => (
            <Chip key={r.month} active={selected === r.month} onClick={() => setPickedMonth(r.month)}>
              {r.label}
            </Chip>
          ))}
        </div>
        <ErrorNote message={gameError} />
        {!gameData && !gameError ? (
          <Loading />
        ) : gameRanking.length === 0 ? (
          <Empty>이 달에는 기록된 게임 활동이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-white/50 light:text-slate-500">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">#</th>
                  <th className="py-1.5 pr-2 font-medium">게임</th>
                  <th className="py-1.5 pr-2 text-right font-medium">게임 시작</th>
                  <th className="py-1.5 pr-2 text-right font-medium">지난달 대비</th>
                  <th className="py-1.5 pr-2 text-right font-medium">플레이한 사람</th>
                  <th className="py-1.5 pr-2 text-right font-medium">방 / 참여</th>
                  <th className="py-1.5 text-right font-medium">허브 클릭</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80 tabular-nums light:divide-slate-100 light:text-slate-700">
                {gameRanking.map((g, i) => (
                  <tr key={g.id}>
                    <td className="py-1.5 pr-2 text-white/40">{i + 1}</td>
                    <td className="py-1.5 pr-2 font-semibold text-white light:text-slate-900">{getGameMeta(g.id)?.name ?? g.id}</td>
                    <td className="py-1.5 pr-2 text-right font-bold text-amber-300 light:text-amber-700">{fmt(g.starts)}</td>
                    <td className="py-1.5 pr-2 text-right">
                      {prevMonth ? <Delta current={g.starts} previous={g.prevStarts} /> : <span className="text-white/30">—</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{fmt(g.players)}</td>
                    <td className="py-1.5 pr-2 text-right">
                      {fmt(g.rooms)} / {fmt(g.joins)}
                    </td>
                    <td className="py-1.5 text-right">{fmt(g.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
