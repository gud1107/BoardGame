import { create } from "zustand";
import type { AnalyticsSummary, DailyTrendPoint, GameRankingRow, MonthlyTrendPoint } from "@/lib/analytics/types";

interface AnalyticsAdminState {
  loading: boolean;
  error: string | null;
  summary: AnalyticsSummary | null;
  trend: MonthlyTrendPoint[];
  daily: DailyTrendPoint[];
  games: GameRankingRow[];
  trendMonths: 6 | 12;

  init: () => Promise<void>;
  setTrendMonths: (months: 6 | 12) => Promise<void>;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const useAnalyticsAdminStore = create<AnalyticsAdminState>((set, get) => ({
  loading: true,
  error: null,
  summary: null,
  trend: [],
  daily: [],
  games: [],
  trendMonths: 6,

  init: async () => {
    set({ loading: true, error: null });
    const [summary, trendRes, dailyRes, gamesRes] = await Promise.all([
      fetchJson<AnalyticsSummary>("/api/admin/analytics/summary"),
      fetchJson<{ trend: MonthlyTrendPoint[] }>(`/api/admin/analytics/visits?months=${get().trendMonths}`),
      fetchJson<{ trend: DailyTrendPoint[] }>("/api/admin/analytics/daily?days=14"),
      fetchJson<{ games: GameRankingRow[] }>("/api/admin/analytics/games"),
    ]);
    if (!summary || !trendRes || !dailyRes || !gamesRes) {
      set({ loading: false, error: "통계를 불러오지 못했습니다." });
      return;
    }
    set({ loading: false, error: null, summary, trend: trendRes.trend, daily: dailyRes.trend, games: gamesRes.games });
  },

  setTrendMonths: async (months) => {
    set({ trendMonths: months });
    const trendRes = await fetchJson<{ trend: MonthlyTrendPoint[] }>(`/api/admin/analytics/visits?months=${months}`);
    if (trendRes) set({ trend: trendRes.trend });
  },
}));
