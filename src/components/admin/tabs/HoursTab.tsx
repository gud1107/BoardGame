"use client";

import { useMemo, useState } from "react";
import { adminRpc, fmt, type ExcludeMe } from "../adminApi";
import { Chip, ErrorNote, Loading, Panel } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";

interface HourRow {
  dow: number;
  hour: number;
  visits: number;
  game_starts: number;
}

// Monday-first rows; Postgres dow is 0 = Sunday.
const DAYS: { dow: number; label: string }[] = [
  { dow: 1, label: "월" },
  { dow: 2, label: "화" },
  { dow: 3, label: "수" },
  { dow: 4, label: "목" },
  { dow: 5, label: "금" },
  { dow: 6, label: "토" },
  { dow: 0, label: "일" },
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type Metric = "visits" | "game_starts";

/**
 * 시간대 tab: weekday × hour heatmap in Korea time. One sequential hue
 * (blue), near-zero cells recede toward the surface; exact counts are in
 * each cell's tooltip and the busiest slots are named above the grid.
 */
export default function HoursTab({
  since,
  exclude,
  reloadKey,
}: {
  since: string | null;
  exclude: ExcludeMe | null;
  reloadKey: number;
}) {
  const [metric, setMetric] = useState<Metric>("visits");
  const { data, error } = useAdminQuery<HourRow>(
    () => adminRpc("admin_hourly_stats", { p_since: since }, exclude),
    JSON.stringify([since, exclude, reloadKey]),
  );

  const grid = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) m.set(`${r.dow}-${r.hour}`, Number(r[metric]));
    return m;
  }, [data, metric]);
  const max = Math.max(1, ...grid.values());

  const busiest = useMemo(
    () =>
      [...grid.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, n]) => {
          const [dow, hour] = k.split("-").map(Number);
          return `${DAYS.find((d) => d.dow === dow)?.label}요일 ${hour}시 (${fmt(n)})`;
        }),
    [grid],
  );

  const byHour = HOURS.map((h) => DAYS.reduce((a, d) => a + (grid.get(`${d.dow}-${h}`) ?? 0), 0));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Chip active={metric === "visits"} onClick={() => setMetric("visits")}>
          방문
        </Chip>
        <Chip active={metric === "game_starts"} onClick={() => setMetric("game_starts")}>
          게임 시작
        </Chip>
      </div>
      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <p className="text-sm text-white/80 light:text-slate-700">
            {busiest.length ? (
              <>
                가장 붐비는 시간: <span className="font-semibold text-amber-300 light:text-amber-700">{busiest.join(" · ")}</span>
              </>
            ) : (
              "아직 기록이 없습니다."
            )}
          </p>

          <Panel title={`요일 × 시간대 ${metric === "visits" ? "방문" : "게임 시작"}`} note="한국 시간 기준 · 진할수록 많음 · 칸에 마우스를 올리면 정확한 수">
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-[2px]">
                  <span />
                  {HOURS.map((h) => (
                    <span key={h} className="text-center text-[10px] text-white/40 light:text-slate-400">
                      {h % 3 === 0 ? h : ""}
                    </span>
                  ))}
                  {DAYS.map((d) => (
                    <Row key={d.dow} label={d.label}>
                      {HOURS.map((h) => {
                        const n = grid.get(`${d.dow}-${h}`) ?? 0;
                        const alpha = n === 0 ? 0.05 : 0.18 + 0.82 * (n / max);
                        return (
                          <span
                            key={h}
                            title={`${d.label}요일 ${h}시: ${fmt(n)}`}
                            className="aspect-square rounded-[3px]"
                            style={{ backgroundColor: `rgba(57,135,229,${alpha.toFixed(3)})` }}
                          />
                        );
                      })}
                    </Row>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="시간대별 합계" note="모든 요일을 합친 값">
            <div className="flex h-28 gap-[2px]">
              {byHour.map((n, h) => {
                const top = Math.max(...byHour, 1);
                return (
                  <div key={h} className="flex flex-1 flex-col items-center justify-end" title={`${h}시: ${fmt(n)}`}>
                    <div className="w-full rounded-t-[4px]" style={{ height: `${(n / top) * 100}%`, minHeight: n ? 2 : 0, backgroundColor: "#3987e5" }} />
                    <span className="mt-1 text-[9px] text-white/40 light:text-slate-400">{h % 3 === 0 ? h : ""}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="self-center text-[11px] text-white/50 light:text-slate-500">{label}</span>
      {children}
    </>
  );
}
