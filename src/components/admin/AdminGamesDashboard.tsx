"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { GAME_REGISTRY, getGameMeta } from "@/games/registry";
import { computeDuplicateFlags, isSuspectedDuplicate } from "@/lib/analytics/duplicateFlags";
import { kstDay } from "@/lib/analytics/visitorSummary";

interface FunnelRow {
  game_id: string;
  hub_clicks: number;
  room_creates: number;
  invite_clicks: number;
  joins: number;
  game_starts: number;
  unique_devices: number;
  unique_ips: number;
}

interface ParticipantRow {
  device_id: string;
  nicknames: string[];
  ip_hashes: string[];
  hub_clicks: number;
  room_creates: number;
  invite_clicks: number;
  joins: number;
  game_starts: number;
  first_at: string;
  last_at: string;
  device_type: string | null;
  os: string | null;
  browser: string | null;
}

type Period = "all" | "30d" | "7d" | "today";

const PERIODS: { key: Period; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "30d", label: "최근 30일" },
  { key: "7d", label: "최근 7일" },
  { key: "today", label: "오늘" },
];

const METRICS: { key: keyof Omit<FunnelRow, "game_id" | "unique_devices" | "unique_ips">; label: string; hint: string }[] = [
  { key: "hub_clicks", label: "허브 클릭", hint: "보드게임 허브에서 게임 카드를 누른 횟수" },
  { key: "room_creates", label: "방 만들기", hint: "게임에 들어가 실제로 방을 연 횟수" },
  { key: "invite_clicks", label: "초대코드 클릭", hint: "'초대 코드로 참여' 버튼을 누른 횟수" },
  { key: "joins", label: "참여", hint: "다른 사람 방에 실제로 들어간 횟수" },
  { key: "game_starts", label: "게임 시작", hint: "방장이 실제로 게임을 시작한 횟수 (혼자 하는 게임은 매 판)" },
];

function sinceFor(period: Period): string | null {
  const now = Date.now();
  if (period === "all") return null;
  if (period === "today") return new Date(`${kstDay(now)}T00:00:00+09:00`).toISOString();
  const days = period === "7d" ? 7 : 30;
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

const DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fmt = (n: number) => Number(n).toLocaleString("ko-KR");
const gameName = (id: string) => getGameMeta(id)?.name ?? id;

function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((Number(part) / Number(whole)) * 100)}%` : "—";
}

function errorMessage(code: string | undefined): string {
  if (code === "42501") return "관리자 계정만 볼 수 있습니다. freedom_03@naver.com으로 로그인했는지 확인하세요.";
  if (code === "PGRST202") return "통계 테이블이 아직 없습니다. supabase/game_events.sql을 먼저 실행하세요.";
  return `불러오지 못했습니다 (${code ?? "unknown"}).`;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-amber-400 bg-amber-500/20 text-amber-200 light:text-amber-800"
          : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
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

function Participants({ gameId, since }: { gameId: string; since: string | null }) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlySuspects, setOnlySuspects] = useState(false);

  useEffect(() => {
    const supabase = getAuthSupabase();
    if (!supabase) return;
    let cancelled = false;
    void supabase.rpc("admin_game_participants", { p_game_id: gameId, p_since: since }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(errorMessage(error.code));
      else setRows((data ?? []) as ParticipantRow[]);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, since]);

  const flags = useMemo(() => computeDuplicateFlags(rows ?? []), [rows]);
  const visible = (rows ?? []).filter((r) => !onlySuspects || isSuspectedDuplicate(flags.get(r.device_id)));
  const suspects = (rows ?? []).filter((r) => isSuspectedDuplicate(flags.get(r.device_id))).length;

  if (error) return <p className="py-4 text-sm text-rose-400">{error}</p>;
  if (!rows) return <p className="py-4 text-sm text-white/40">불러오는 중…</p>;

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-white/50 light:text-slate-500">
        <span>
          기기 {fmt(rows.length)}대 · 중복 의심 {fmt(suspects)}대
        </span>
        <Chip active={!onlySuspects} onClick={() => setOnlySuspects(false)}>
          전체
        </Chip>
        <Chip active={onlySuspects} onClick={() => setOnlySuspects(true)}>
          ⚠️ 중복 의심만
        </Chip>
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-sm text-white/40">해당하는 기기가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">닉네임 / 기기 ID</th>
                <th className="px-3 py-2 font-medium">IP(해시)</th>
                <th className="px-3 py-2 font-medium">중복 검토</th>
                <th className="px-3 py-2 text-right font-medium">클릭</th>
                <th className="px-3 py-2 text-right font-medium">방</th>
                <th className="px-3 py-2 text-right font-medium">초대</th>
                <th className="px-3 py-2 text-right font-medium">참여</th>
                <th className="px-3 py-2 text-right font-medium">시작</th>
                <th className="px-3 py-2 font-medium">기기</th>
                <th className="px-3 py-2 font-medium">최근</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 light:divide-slate-100">
              {visible.map((r) => {
                const f = flags.get(r.device_id);
                return (
                  <tr key={r.device_id ?? "none"} className="align-top">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-white light:text-slate-900">
                        {r.nicknames.length ? r.nicknames.join(", ") : <span className="font-normal text-white/40">익명</span>}
                      </p>
                      <p className="font-mono text-[10px] text-white/30">{(r.device_id ?? "—").slice(0, 8)}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-white/50">{r.ip_hashes.join(", ") || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        {f && f.sameIpDevices > 0 && <span className="text-amber-300">같은 IP 기기 {f.sameIpDevices}대</span>}
                        {f && f.sameNicknameDevices > 0 && <span className="text-amber-300">같은 닉네임 기기 {f.sameNicknameDevices}대</span>}
                        {f?.multipleNicknames && <span className="text-sky-300">닉네임 여러 개</span>}
                        {!isSuspectedDuplicate(f) && !f?.multipleNicknames && <span className="text-white/30">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.hub_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.room_creates)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.invite_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.joins)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.game_starts)}</td>
                    <td className="px-3 py-2 text-white/60">{[r.device_type, r.os, r.browser].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-white/60 tabular-nums">{DATE_TIME.format(new Date(r.last_at))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminGamesDashboard() {
  const [period, setPeriod] = useState<Period>("all");
  const [rows, setRows] = useState<FunnelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openGame, setOpenGame] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const since = useMemo(() => sinceFor(period), [period]);

  const load = useCallback(async (sinceIso: string | null) => {
    const supabase = getAuthSupabase();
    if (!supabase) return { error: "Supabase 설정이 없습니다." };
    const { data, error } = await supabase.rpc("admin_game_funnel", { p_since: sinceIso });
    if (error) return { error: errorMessage(error.code) };
    return { rows: (data ?? []) as FunnelRow[] };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(since).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error ?? null);
        setRows(null);
      } else {
        setError(null);
        setRows(result.rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load, since, reloadKey]);

  // Every playable game gets a row, even with no events yet.
  const table = useMemo(() => {
    const byId = new Map((rows ?? []).map((r) => [r.game_id, r]));
    return GAME_REGISTRY.filter((g) => g.playable)
      .map(
        (g) =>
          byId.get(g.id) ?? {
            game_id: g.id,
            hub_clicks: 0,
            room_creates: 0,
            invite_clicks: 0,
            joins: 0,
            game_starts: 0,
            unique_devices: 0,
            unique_ips: 0,
          },
      )
      .sort((a, b) => Number(b.game_starts) - Number(a.game_starts) || Number(b.hub_clicks) - Number(a.hub_clicks));
  }, [rows]);

  const totals = useMemo(() => {
    const t = { hub_clicks: 0, room_creates: 0, invite_clicks: 0, joins: 0, game_starts: 0 };
    for (const r of table) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += Number(r[k]);
    return t;
  }, [table]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white light:text-slate-900">🎲 게임 통계</h1>
          <p className="mt-1 text-xs text-white/40 light:text-slate-500">
            운영 사이트 실제 사용자만 · 자동화 브라우저(클로드 봇) 제외 · IP는 암호화된 해시로만 저장
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/visitors" className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-amber-400 light:border-slate-300 light:text-slate-600">
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

      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Chip key={p.key} active={period === p.key} onClick={() => setPeriod(p.key)}>
            {p.label}
          </Chip>
        ))}
      </div>

      {error && <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {METRICS.map((m) => (
          <StatCard key={m.key} label={m.label} value={rows ? fmt(totals[m.key]) : "—"} sub={m.hint} />
        ))}
      </div>

      <p className="mt-6 mb-2 text-xs text-white/40 light:text-slate-500">
        게임을 누르면 기기별 기록과 중복 사용자(같은 IP·같은 닉네임) 검토가 열립니다. 전환율 = 방 만들기 ÷ 허브 클릭, 참여 ÷ 초대코드 클릭.
      </p>

      <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">게임</th>
              <th className="px-3 py-2 text-right font-medium">허브 클릭</th>
              <th className="px-3 py-2 text-right font-medium">방 만들기</th>
              <th className="px-3 py-2 text-right font-medium">초대코드 클릭</th>
              <th className="px-3 py-2 text-right font-medium">참여</th>
              <th className="px-3 py-2 text-right font-medium">게임 시작</th>
              <th className="px-3 py-2 text-right font-medium">기기 / IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 light:divide-slate-100">
            {table.map((r) => {
              const open = openGame === r.game_id;
              return (
                <Fragment key={r.game_id}>
                  <tr
                    onClick={() => setOpenGame(open ? null : r.game_id)}
                    className={`cursor-pointer transition hover:bg-white/[0.03] ${open ? "bg-amber-500/5" : ""}`}
                  >
                    <td className="px-3 py-2 font-semibold text-white light:text-slate-900">
                      {open ? "▾" : "▸"} {gameName(r.game_id)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt(r.hub_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">
                      {fmt(r.room_creates)} <span className="text-white/30">{rate(r.room_creates, r.hub_clicks)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt(r.invite_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">
                      {fmt(r.joins)} <span className="text-white/30">{rate(r.joins, r.invite_clicks)}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-amber-300">{fmt(r.game_starts)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/60">
                      {fmt(r.unique_devices)} / {fmt(r.unique_ips)}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} className="bg-black/20 px-3 pb-4 light:bg-slate-50">
                        <Participants gameId={r.game_id} since={since} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
