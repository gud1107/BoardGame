"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BugReportStatus } from "@/lib/db/types";
import type { CloudBugReportRecord } from "@/lib/bugReports/types";
import { DATE_TIME, fmt } from "../adminApi";
import { Chip, Empty, ErrorNote, Loading, StatCard } from "../adminUi";

const STATUSES: BugReportStatus[] = ["접수됨", "확인 중", "수정 완료"];

const STATUS_STYLE: Record<BugReportStatus, string> = {
  접수됨: "bg-rose-500/15 text-rose-300",
  "확인 중": "bg-amber-500/15 text-amber-300",
  "수정 완료": "bg-emerald-500/15 text-emerald-300",
};

/**
 * 버그 리포트 tab: the site's shared bug board (`/api/bug-reports`, stored
 * in Supabase `bug_reports` through the server's service-role client) with
 * one-click status changes. The status PATCH is admin-only on the server —
 * freedom_03@naver.com already qualifies (SUPER_ADMIN_EMAIL).
 */
export default function BugReportsTab({ reloadKey }: { reloadKey: number }) {
  const [reports, setReports] = useState<CloudBugReportRecord[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | BugReportStatus>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/bug-reports", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { reports?: CloudBugReportRecord[]; configured?: boolean }) => {
        if (cancelled) return;
        setReports(body.reports ?? []);
        setConfigured(body.configured !== false);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("버그 리포트를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function changeStatus(id: string, status: BugReportStatus) {
    setSavingId(id);
    const res = await fetch(`/api/bug-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setSavingId(null);
    if (!res?.ok) {
      setError(`상태를 바꾸지 못했습니다 (${res?.status ?? "network"}).`);
      return;
    }
    setError(null);
    setReports((prev) => prev?.map((r) => (r.id === id ? { ...r, status } : r)) ?? prev);
  }

  if (!reports && !error) return <Loading />;
  const list = reports ?? [];
  const visible = list.filter((r) => filter === "all" || r.status === filter);
  const count = (s: BugReportStatus) => list.filter((r) => r.status === s).length;

  return (
    <div className="flex flex-col gap-4">
      {!configured && (
        <ErrorNote message="서버 저장소가 꺼져 있습니다. Vercel 환경변수에 SUPABASE_SERVICE_ROLE_KEY를 추가하고 재배포해야 제보가 여기 모입니다 (지금은 제보한 사람의 브라우저에만 저장됨)." />
      )}
      <ErrorNote message={error} />

      <div className="grid grid-cols-3 gap-3">
        {STATUSES.map((s) => (
          <StatCard key={s} label={s} value={fmt(count(s))} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          전체 {fmt(list.length)}
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {s}
          </Chip>
        ))}
        <Link href="/bug-reports" className="ml-auto text-xs text-white/50 underline">
          게시판에서 보기 →
        </Link>
      </div>

      {visible.length === 0 ? (
        <Empty>{list.length === 0 ? "들어온 제보가 없습니다." : "해당 상태의 제보가 없습니다."}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => {
            const open = openId === r.id;
            return (
              <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 light:border-slate-200 light:bg-white">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" onClick={() => setOpenId(open ? null : r.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-semibold text-white light:text-slate-900">
                      {open ? "▾" : "▸"} {r.title}
                    </p>
                    <p className="mt-0.5 text-xs text-white/50 light:text-slate-500">
                      {r.gameName ?? "게임 미지정"} · {r.author}
                      {r.isGuest ? " (게스트)" : ""} · {DATE_TIME.format(new Date(r.createdAt))}
                    </p>
                  </button>
                  <div className="flex items-center gap-1">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={savingId === r.id || r.status === s}
                        onClick={() => void changeStatus(r.id, s)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                          r.status === s ? STATUS_STYLE[s] : "text-white/40 hover:text-white/80 light:text-slate-400"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                {open && (
                  <div className="mt-2 border-t border-white/10 pt-2 text-sm whitespace-pre-line text-white/80 light:border-slate-200 light:text-slate-700">
                    {r.description}
                    {r.phone && <p className="mt-2 text-xs text-white/50">연락처: {r.phone}</p>}
                    {r.attachment && <p className="mt-1 text-xs text-white/50">📎 첨부: {r.attachment.fileName}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
