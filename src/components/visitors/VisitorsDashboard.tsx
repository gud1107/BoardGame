"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase/client";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { getGameMeta } from "@/games/registry";
import type { VisitorRow } from "@/lib/analytics/visitors";
import { isReturning, summarizeVisitors, topGames } from "@/lib/analytics/visitorSummary";

/** Remembered for this tab only, so a refresh doesn't ask again. */
const PASSWORD_KEY = "bg_visitors_pw";

type Filter = "all" | "returning" | "new" | "named";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "returning", label: "🔁 재방문자" },
  { key: "new", label: "🆕 1회 방문" },
  { key: "named", label: "🏷️ 닉네임 있음" },
];

const DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatWhen(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

function gameName(id: string): string {
  return getGameMeta(id)?.name ?? id;
}

function readSavedPassword(): string {
  try {
    return window.sessionStorage.getItem(PASSWORD_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Signed in as a site admin (freedom_03@naver.com)? Then the list comes
 * from `admin_list_visitors()` (supabase/game_events.sql) with no password.
 * Null when not signed in / not an admin.
 */
async function fetchVisitorsAsAdmin(): Promise<VisitorRow[] | null> {
  const supabase = getAuthSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_list_visitors");
  return error ? null : ((data ?? []) as VisitorRow[]);
}

async function fetchVisitors(password: string): Promise<{ rows: VisitorRow[] } | { error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { error: "Supabase 설정이 없습니다." };
  const { data, error } = await supabase.rpc("list_visitors", { p_password: password });
  if (error) {
    if (error.code === "28P01") return { error: "비밀번호가 맞지 않습니다." };
    if (error.code === "PGRST202") return { error: "방문자 테이블이 아직 없습니다. supabase/visitors.sql을 먼저 실행하세요." };
    return { error: `불러오지 못했습니다 (${error.code ?? "unknown"}).` };
  }
  return { rows: (data ?? []) as VisitorRow[] };
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 light:border-slate-200 light:bg-white">
      <p className="text-xs text-white/50 light:text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-white tabular-nums light:text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40 light:text-slate-400">{sub}</p>}
    </div>
  );
}

function VisitorName({ row }: { row: VisitorRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-white light:text-slate-900">
        {row.nickname ?? <span className="font-normal text-white/40 light:text-slate-400">익명</span>}
        {isReturning(row) && (
          <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 light:bg-emerald-100 light:text-emerald-700">
            재방문
          </span>
        )}
      </p>
      <p className="font-mono text-[10px] text-white/30 light:text-slate-400">{row.device_id.slice(0, 8)}</p>
    </div>
  );
}

function deviceLabel(row: VisitorRow): string {
  return [row.device_type, row.os, row.browser].filter(Boolean).join(" · ") || "—";
}

function GamesList({ row }: { row: VisitorRow }) {
  const top = topGames(row.games);
  if (top.length === 0) return <span className="text-white/30 light:text-slate-400">—</span>;
  return (
    <span className="text-white/70 light:text-slate-600">
      {top.map(([id, n]) => `${gameName(id)} ${n}`).join(", ")}
    </span>
  );
}

export default function VisitorsDashboard() {
  const [password, setPassword] = useState("");
  const [rows, setRows] = useState<VisitorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async (pw: string) => {
    setLoading(true);
    setError(null);
    const result = await fetchVisitors(pw);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      setRows(null);
      try {
        window.sessionStorage.removeItem(PASSWORD_KEY);
      } catch {}
      return;
    }
    setRows(result.rows);
    setLoadedAt(Date.now());
    try {
      window.sessionStorage.setItem(PASSWORD_KEY, pw);
    } catch {}
  }, []);

  // Admin login opens it directly; otherwise re-open with the password
  // already entered in this tab.
  const [adminMode, setAdminMode] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchVisitorsAsAdmin().then(async (adminRows) => {
      if (cancelled) return;
      if (adminRows) {
        setAdminMode(true);
        setRows(adminRows);
        setLoadedAt(Date.now());
        return;
      }
      const saved = readSavedPassword();
      if (!saved) return;
      const result = await fetchVisitors(saved);
      if (cancelled || "error" in result) return;
      setPassword(saved);
      setRows(result.rows);
      setLoadedAt(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!adminMode) return load(password);
    setLoading(true);
    const adminRows = await fetchVisitorsAsAdmin();
    setLoading(false);
    if (adminRows) {
      setRows(adminRows);
      setLoadedAt(Date.now());
    }
  }, [adminMode, load, password]);

  const summary = useMemo(() => (rows ? summarizeVisitors(rows, loadedAt) : null), [rows, loadedAt]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "returning" && !isReturning(r)) return false;
      if (filter === "new" && isReturning(r)) return false;
      if (filter === "named" && !r.nickname) return false;
      if (q && !(r.nickname ?? "").toLowerCase().includes(q) && !r.device_id.startsWith(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  if (!rows || !summary) {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold text-white light:text-slate-900">👥 방문자</h1>
        <p className="mb-6 text-sm text-white/50 light:text-slate-500">
          관리자 계정으로 로그인하면 바로 열립니다. 로그인하지 않았다면 방문자 페이지 전용 비밀번호(supabase/visitors.sql 실행 때 정한 것)를 입력하세요.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password && !loading) void load(password);
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-400 light:border-slate-300 light:bg-white light:text-slate-900"
          />
          <button
            type="submit"
            disabled={!password || loading}
            className="rounded-xl bg-amber-500 px-4 py-3 font-semibold text-black transition hover:bg-amber-400 disabled:opacity-40"
          >
            {loading ? "확인 중…" : "보기"}
          </button>
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </form>
        <Link href="/" className="mt-8 text-center text-xs text-white/40 hover:text-white/70 light:text-slate-400">
          ← 보드게임 허브로
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white light:text-slate-900">👥 방문자</h1>
          <p className="mt-1 text-xs text-white/40 light:text-slate-500">
            기기(브라우저) 1대 = 방문자 1명 · 운영 사이트 방문만 · 자동화 브라우저 제외 · {formatWhen(new Date(loadedAt).toISOString())} 기준
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/80 transition hover:border-amber-400 disabled:opacity-40 light:border-slate-300 light:text-slate-700"
        >
          {loading ? "불러오는 중…" : "↻ 새로고침"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="전체 방문자" value={formatNumber(summary.total)} sub={`총 ${formatNumber(summary.totalVisits)}회 방문`} />
        <StatCard
          label="재방문자"
          value={formatNumber(summary.returning)}
          sub={`재방문율 ${(summary.returningRate * 100).toFixed(1)}%`}
        />
        <StatCard label="오늘 방문자" value={formatNumber(summary.todayActive)} />
        <StatCard label="오늘 신규" value={formatNumber(summary.todayNew)} />
        <StatCard label="최근 7일 방문자" value={formatNumber(summary.last7Active)} />
        <StatCard label="총 플레이" value={formatNumber(summary.totalPlays)} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? "border-amber-400 bg-amber-500/20 text-amber-200 light:text-amber-800"
                : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600"
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="닉네임 또는 ID 검색"
          className="ml-auto w-full rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white outline-none focus:border-amber-400 sm:w-56 light:border-slate-300 light:bg-white light:text-slate-900"
        />
      </div>

      <p className="mt-3 text-xs text-white/40 light:text-slate-500">{formatNumber(visible.length)}명 · 최근 방문순</p>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40 light:text-slate-400">
          {rows.length === 0 ? "아직 기록된 방문자가 없습니다." : "조건에 맞는 방문자가 없습니다."}
        </p>
      ) : (
        <>
          {/* Phone: one card per visitor */}
          <ul className="mt-2 flex flex-col gap-2 sm:hidden">
            {visible.map((r) => (
              <li key={r.device_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs light:border-slate-200 light:bg-white">
                <div className="flex items-start justify-between gap-2">
                  <VisitorName row={r} />
                  <p className="shrink-0 text-right text-white/60 tabular-nums light:text-slate-600">
                    방문 {formatNumber(r.visit_count)} · 플레이 {formatNumber(r.play_count)}
                  </p>
                </div>
                <p className="mt-1.5 text-white/50 light:text-slate-500">{deviceLabel(r)}</p>
                <p className="mt-0.5 text-white/50 light:text-slate-500">
                  첫 방문 {formatWhen(r.first_seen)} · 최근 {formatWhen(r.last_seen)}
                </p>
                <p className="mt-0.5">
                  <GamesList row={r} />
                </p>
              </li>
            ))}
          </ul>

          {/* Tablet/desktop: table */}
          <div className="mt-2 hidden overflow-x-auto rounded-xl border border-white/10 sm:block light:border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">방문자</th>
                  <th className="px-3 py-2 font-medium">기기</th>
                  <th className="px-3 py-2 font-medium">첫 방문</th>
                  <th className="px-3 py-2 font-medium">최근 방문</th>
                  <th className="px-3 py-2 text-right font-medium">방문</th>
                  <th className="px-3 py-2 text-right font-medium">플레이</th>
                  <th className="px-3 py-2 font-medium">자주 한 게임</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 light:divide-slate-100">
                {visible.map((r) => (
                  <tr key={r.device_id} className="align-top">
                    <td className="max-w-[12rem] px-3 py-2">
                      <VisitorName row={r} />
                    </td>
                    <td className="px-3 py-2 text-white/60 light:text-slate-600">{deviceLabel(r)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-white/60 tabular-nums light:text-slate-600">{formatWhen(r.first_seen)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-white/60 tabular-nums light:text-slate-600">{formatWhen(r.last_seen)}</td>
                    <td className="px-3 py-2 text-right text-white tabular-nums light:text-slate-900">{formatNumber(r.visit_count)}</td>
                    <td className="px-3 py-2 text-right text-white tabular-nums light:text-slate-900">{formatNumber(r.play_count)}</td>
                    <td className="px-3 py-2">
                      <GamesList row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
