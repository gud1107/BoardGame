"use client";

import { adminRpc, fmt, rate, SERIES, type ExcludeMe } from "../adminApi";
import { Empty, ErrorNote, Loading, Panel, StatCard } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";

export interface ThemeRow {
  origin: string;
  os_scheme: string;
  first_theme: string;
  current_pref: string;
  devices: number;
  changed: number;
}

type Pref = "dark" | "light" | "system";
const PREFS: { key: Pref; label: string; color: string }[] = [
  { key: "dark", label: "🌙 다크", color: SERIES.blue },
  { key: "light", label: "☀️ 라이트", color: SERIES.orange },
  { key: "system", label: "🖥️ 시스템", color: SERIES.aqua },
];
const ORIGINS: { key: string; label: string; note: string }[] = [
  { key: "new", label: "신규 방문자", note: "처음엔 기기 설정을 따름" },
  { key: "returning", label: "기존 방문자", note: "다크로 고정해 둠" },
  { key: "legacy", label: "예전 토글 사용자", note: "이미 다크/라이트를 골라 둠" },
];

export interface OriginSummary {
  devices: number;
  firstLight: number;
  osLight: number;
  changed: number;
  now: Record<Pref, number>;
}

/** Folds the RPC's grouped rows into one summary per first-visit kind (plus "all"). */
export function summarizeThemeRows(rows: ThemeRow[]): Record<string, OriginSummary> {
  const out: Record<string, OriginSummary> = {};
  const bucket = (k: string) =>
    (out[k] ??= { devices: 0, firstLight: 0, osLight: 0, changed: 0, now: { dark: 0, light: 0, system: 0 } });
  for (const r of rows) {
    const n = Number(r.devices);
    for (const s of [bucket(r.origin), bucket("all")]) {
      s.devices += n;
      if (r.first_theme === "light") s.firstLight += n;
      if (r.os_scheme === "light") s.osLight += n;
      s.changed += Number(r.changed);
      if (r.current_pref === "dark" || r.current_pref === "light" || r.current_pref === "system") s.now[r.current_pref] += n;
    }
  }
  return out;
}

/**
 * 🌗 테마 tab — how browsers first saw the site and which theme they use now.
 * Data: supabase/theme_prefs.sql, reported by ThemeContext.tsx (one "first"
 * report per browser, plus every hand-picked change). The period filter is
 * on the browser's first report. Automated browsers are never recorded.
 */
export default function ThemeTab({
  since,
  exclude,
  reloadKey,
}: {
  since: string | null;
  exclude: ExcludeMe | null;
  reloadKey: number;
}) {
  const { data, error } = useAdminQuery<ThemeRow>(
    () => adminRpc("admin_theme_stats", { p_since: since }, exclude, "supabase/theme_prefs.sql"),
    JSON.stringify([since, exclude, reloadKey]),
  );

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty>아직 기록된 테마 정보가 없습니다. (2026-10-04 배포 이후 방문부터 기록)</Empty>;

  const sum = summarizeThemeRows(data);
  const all = sum.all;
  const fresh = sum.new;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="신규 방문자 중 첫 화면이 라이트"
          value={fresh ? rate(fresh.firstLight, fresh.devices) : "—"}
          sub={fresh ? `${fmt(fresh.firstLight)} / ${fmt(fresh.devices)}명 (기기 설정이 라이트)` : "아직 신규 방문 기록 없음"}
        />
        <StatCard
          label="기기 설정이 라이트인 비율 (전체)"
          value={rate(all.osLight, all.devices)}
          sub={`${fmt(all.osLight)} / ${fmt(all.devices)}개 브라우저`}
        />
        <StatCard
          label="테마를 직접 바꾼 브라우저"
          value={rate(all.changed, all.devices)}
          sub={`${fmt(all.changed)}개 — 메뉴에서 한 번이라도 고름`}
        />
      </div>

      <Panel title="지금 쓰는 테마" note="막대 = 지금 선택(🖥️ 시스템은 기기 설정을 따라 그때그때 바뀜) · 브라우저 단위">
        <div className="flex flex-col gap-3">
          {[{ key: "all", label: "전체", note: "" }, ...ORIGINS].map((o) => {
            const s = sum[o.key];
            if (!s) return null;
            return (
              <div key={o.key} className="grid grid-cols-[96px_1fr] items-center gap-3 text-xs sm:grid-cols-[150px_1fr]">
                <span className="leading-tight">
                  <span className="font-medium text-white/85 light:text-slate-800">{o.label}</span>
                  <span className="ml-1 text-white/45 light:text-slate-500">{fmt(s.devices)}</span>
                  {o.note && <span className="block text-[11px] text-white/40 light:text-slate-400">{o.note}</span>}
                </span>
                <div>
                  <div className="flex h-3.5 overflow-hidden rounded-[4px] bg-white/5 light:bg-slate-100">
                    {PREFS.map((p) =>
                      s.now[p.key] > 0 ? (
                        <div
                          key={p.key}
                          style={{ width: `${(s.now[p.key] / s.devices) * 100}%`, backgroundColor: p.color }}
                          className="h-full border-r border-[var(--background)] last:border-r-0"
                          title={`${p.label}: ${fmt(s.now[p.key])} (${rate(s.now[p.key], s.devices)})`}
                        />
                      ) : null,
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-white/60 tabular-nums light:text-slate-600">
                    {PREFS.map((p) => (
                      <span key={p.key}>
                        {p.label} {fmt(s.now[p.key])} <span className="text-white/40 light:text-slate-400">{rate(s.now[p.key], s.devices)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
