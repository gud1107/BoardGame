"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { getDeviceId } from "@/lib/identity/deviceId";
import { PERIODS, sinceFor, type ExcludeMe, type Period } from "./adminApi";
import { Chip, Loading } from "./adminUi";
import GamesTab from "./tabs/GamesTab";
import TrendTab from "./tabs/TrendTab";
import MonthlyTab from "./tabs/MonthlyTab";
import HoursTab from "./tabs/HoursTab";
import DropOffTab from "./tabs/DropOffTab";
import RoomsTab from "./tabs/RoomsTab";
import SourcesTab from "./tabs/SourcesTab";
import BugReportsTab from "./tabs/BugReportsTab";
import NoticeTab from "./tabs/NoticeTab";
import GameVisibilityTab from "./tabs/GameVisibilityTab";
import SetupStatus from "./SetupStatus";
import IpLabelsTab from "./tabs/IpLabelsTab";
import { useIpLabels } from "./useIpLabels";

type TabKey = "games" | "monthly" | "trend" | "hours" | "dropoff" | "rooms" | "sources" | "ips" | "bugs" | "notice" | "visibility";

/** `period`: whether the 전체/30일/7일/오늘 filter applies. `stats`: whether "내 기록 제외" applies. */
const TABS: { key: TabKey; label: string; period: boolean; stats: boolean }[] = [
  { key: "games", label: "🎲 게임 통계", period: true, stats: true },
  { key: "monthly", label: "📅 월별", period: false, stats: true },
  { key: "trend", label: "📈 추이", period: false, stats: true },
  { key: "hours", label: "🕒 시간대", period: true, stats: true },
  { key: "dropoff", label: "🪜 이탈 분석", period: true, stats: true },
  { key: "rooms", label: "🚪 방 기록", period: true, stats: true },
  { key: "sources", label: "🧭 유입 경로", period: true, stats: true },
  { key: "ips", label: "🏷️ IP 관리", period: true, stats: false },
  { key: "bugs", label: "🐛 버그 리포트", period: false, stats: false },
  { key: "notice", label: "📢 공지", period: false, stats: false },
  { key: "visibility", label: "👁 게임 관리", period: false, stats: false },
];

const TAB_KEY = "bg_admin_tab";
const EXCLUDE_KEY = "bg_admin_exclude_me";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

const noopSubscribe = () => () => {};

/**
 * The hub restores the last tab and the "내 기록 제외" choice from
 * localStorage, which the server render can't know — so it renders only
 * after hydration instead of mismatching the server HTML.
 */
export default function AdminGamesDashboard() {
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return hydrated ? <AdminHub /> : <Loading />;
}

/**
 * /admin/games — the site admin hub. Gated by `src/proxy.ts` (login +
 * `is_site_admin()`), and every RPC re-checks `is_site_admin()` in the
 * database (supabase/game_events.sql, supabase/admin_suite.sql).
 */
function AdminHub() {
  const [tab, setTab] = useState<TabKey>(() => {
    const saved = readStored(TAB_KEY);
    return TABS.some((t) => t.key === saved) ? (saved as TabKey) : "games";
  });
  const [period, setPeriod] = useState<Period>("all");
  const [reloadKey, setReloadKey] = useState(0);
  const [myIp, setMyIp] = useState<string | null>(null);
  const [excludeMe, setExcludeMe] = useState(() => readStored(EXCLUDE_KEY) === "1");
  const [myDevice] = useState<string | null>(() => {
    try {
      return getDeviceId();
    } catch {
      return null;
    }
  });

  // The admin's own IP, shown up top, marked in device lists, and used by "내 기록 제외".
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/my-ip", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ip?: string | null }) => {
        if (!cancelled) setMyIp(d.ip ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const since = useMemo(() => sinceFor(period), [period]);
  const { labels: ipLabels, reload: reloadIpLabels } = useIpLabels();
  const exclude: ExcludeMe | null = useMemo(
    () => (excludeMe ? { ip: myIp, device: myDevice } : null),
    [excludeMe, myIp, myDevice],
  );
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white light:text-slate-900">🛠 관리자</h1>
          <p className="mt-1 text-xs text-white/40 light:text-slate-500">
            운영 사이트 실제 사용자만 · 자동화 브라우저(클로드 봇) 제외 · 다른 사람 IP는 눌러야 보임
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
              👤 내 IP <span className="font-mono font-semibold">{myIp ?? "확인 중…"}</span>
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/80 light:border-slate-300 light:text-slate-700">
              <input
                type="checkbox"
                checked={excludeMe}
                onChange={(e) => {
                  setExcludeMe(e.target.checked);
                  store(EXCLUDE_KEY, e.target.checked ? "1" : "0");
                }}
                className="accent-amber-500"
              />
              내 기록 제외하고 보기
              <span className="text-white/40" title="이 브라우저의 기기 ID와 지금 IP에서 나온 기록을 통계에서 뺍니다">
                (이 기기·내 IP)
              </span>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/visitors"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-amber-400 light:border-slate-300 light:text-slate-600"
          >
            👥 방문자
          </Link>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-amber-400 light:border-slate-300 light:text-slate-600"
          >
            ↻ 새로고침
          </button>
        </div>
      </div>

      <SetupStatus />

      <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-white/10 px-4 pb-px no-scrollbar sm:mx-0 sm:px-0 light:border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              store(TAB_KEY, t.key);
            }}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition ${
              tab === t.key
                ? "border-amber-400 font-semibold text-amber-200 light:text-amber-700"
                : "border-transparent text-white/50 hover:text-white/80 light:text-slate-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {current.period && (
        <div className="mb-4 flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Chip key={p.key} active={period === p.key} onClick={() => setPeriod(p.key)}>
              {p.label}
            </Chip>
          ))}
          {current.stats && excludeMe && <span className="self-center text-xs text-amber-300/80">· 내 기록 제외 중</span>}
        </div>
      )}

      {tab === "games" && <GamesTab since={since} exclude={exclude} myIp={myIp} ipLabels={ipLabels} reloadKey={reloadKey} />}
      {tab === "monthly" && <MonthlyTab exclude={exclude} reloadKey={reloadKey} />}
      {tab === "trend" && <TrendTab exclude={exclude} reloadKey={reloadKey} />}
      {tab === "hours" && <HoursTab since={since} exclude={exclude} reloadKey={reloadKey} />}
      {tab === "dropoff" && <DropOffTab since={since} exclude={exclude} reloadKey={reloadKey} />}
      {tab === "rooms" && <RoomsTab since={since} exclude={exclude} reloadKey={reloadKey} />}
      {tab === "sources" && <SourcesTab since={since} exclude={exclude} reloadKey={reloadKey} />}
      {tab === "ips" && (
        <IpLabelsTab since={since} myIp={myIp} labels={ipLabels} onLabelsChanged={reloadIpLabels} reloadKey={reloadKey} />
      )}
      {tab === "bugs" && <BugReportsTab reloadKey={reloadKey} />}
      {tab === "notice" && <NoticeTab />}
      {tab === "visibility" && <GameVisibilityTab />}
    </div>
  );
}
