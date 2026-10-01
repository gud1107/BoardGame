import { getAuthSupabase } from "@/lib/supabase/authClient";
import { kstDay } from "@/lib/analytics/visitorSummary";

/** What "내 기록 제외" filters out: this browser's device id and current IP. */
export interface ExcludeMe {
  ip: string | null;
  device: string | null;
}

export type Period = "all" | "30d" | "7d" | "today";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "30d", label: "최근 30일" },
  { key: "7d", label: "최근 7일" },
  { key: "today", label: "오늘" },
];

export function sinceFor(period: Period, now = Date.now()): string | null {
  if (period === "all") return null;
  if (period === "today") return new Date(`${kstDay(now)}T00:00:00+09:00`).toISOString();
  const days = period === "7d" ? 7 : 30;
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

export const fmt = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString("ko-KR");

export function rate(part: number, whole: number): string {
  return Number(whole) > 0 ? `${Math.round((Number(part) / Number(whole)) * 100)}%` : "—";
}

export function adminErrorMessage(code: string | undefined): string {
  if (code === "42501") return "관리자 계정만 볼 수 있습니다. freedom_03@naver.com으로 로그인했는지 확인하세요.";
  if (code === "PGRST202" || code === "PGRST205" || code === "42P01")
    return "이 기능용 DB가 아직 없습니다. supabase/admin_suite.sql을 Supabase SQL Editor에서 실행하세요.";
  return `불러오지 못했습니다 (${code ?? "unknown"}).`;
}

/**
 * Calls an admin RPC with the signed-in session. `exclude`, when set, adds
 * the "내 기록 제외" arguments; if the database only has the older
 * signature (admin_suite.sql not run yet) it retries without them, so the
 * page keeps working with the exclusion simply not applied.
 */
export async function adminRpc<T>(
  name: string,
  args: Record<string, unknown>,
  exclude?: ExcludeMe | null,
): Promise<{ data: T[] } | { error: string }> {
  const supabase = getAuthSupabase();
  if (!supabase) return { error: "Supabase 설정이 없습니다." };
  const withExclude = exclude ? { ...args, p_ex_ip: exclude.ip, p_ex_device: exclude.device } : args;
  let { data, error } = await supabase.rpc(name, withExclude);
  if (error?.code === "PGRST202" && exclude) ({ data, error } = await supabase.rpc(name, args));
  if (error) return { error: adminErrorMessage(error.code) };
  return { data: (data ?? []) as T[] };
}

/** Admin write RPC (notice, game visibility) — returns an error message or null. */
export async function adminWrite(name: string, args: Record<string, unknown>): Promise<string | null> {
  const supabase = getAuthSupabase();
  if (!supabase) return "Supabase 설정이 없습니다.";
  const { error } = await supabase.rpc(name, args);
  return error ? adminErrorMessage(error.code) : null;
}

export const DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Chart series colors — the project's validated categorical slots (dataviz palette). */
export const SERIES = {
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
} as const;

/** An admin-given name for an IP (supabase/admin_ip_labels.sql). */
export interface IpLabel {
  ip: string;
  label: string;
  memo: string | null;
  updated_at: string;
}

export type IpLabelMap = ReadonlyMap<string, IpLabel>;
