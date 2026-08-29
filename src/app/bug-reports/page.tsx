"use client";

import { useEffect, useMemo, useState } from "react";
import { GAME_REGISTRY } from "@/games/registry";
import { useBugReportStore } from "@/store/bugReportStore";
import { BUG_REPORT_STATUSES, filterReports, mergeReportSources } from "@/lib/bugReports/board";
import BugReportModal from "@/components/bugReport/BugReportModal";
import BugReportDetailModal from "@/components/bugReport/BugReportDetailModal";
import type { BugReportStatus } from "@/lib/db/types";
import type { UnifiedBugReport } from "@/lib/bugReports/types";

const PLAYABLE_GAMES = GAME_REGISTRY.filter((g) => g.playable);

const STATUS_STYLE: Record<BugReportStatus, string> = {
  접수됨: "border-white/20 text-white/70",
  "확인 중": "border-amber-400/40 bg-amber-500/10 text-amber-200",
  "수정 완료": "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function BugReportsPage() {
  const localReports = useBugReportStore((s) => s.localReports);
  const cloudReports = useBugReportStore((s) => s.cloudReports);
  const hydrated = useBugReportStore((s) => s.hydrated);
  const init = useBugReportStore((s) => s.init);
  const refreshCurrentUser = useBugReportStore((s) => s.refreshCurrentUser);

  useEffect(() => {
    void init();
    void refreshCurrentUser();
  }, [init, refreshCurrentUser]);

  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<BugReportStatus | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<UnifiedBugReport | null>(null);

  const merged = useMemo(() => mergeReportSources(localReports, cloudReports), [localReports, cloudReports]);
  const filtered = useMemo(
    () => filterReports(merged, { gameId: gameFilter, status: statusFilter, query }),
    [merged, gameFilter, statusFilter, query],
  );

  // Keep the open detail modal's contents in sync after an edit/status update elsewhere.
  if (selected) {
    const fresh = merged.find((r) => r.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    else if (!fresh) setSelected(null); // deleted while open
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">🐛 버그 리포트 게시판</h1>
          <p className="mt-1 text-sm text-white/50">
            로그인 없이도 작성할 수 있어요 — 비로그인 작성 시 입력한 비밀번호로 나중에 직접 수정·삭제할 수
            있습니다. 로그인 후 작성한 리포트는 본인 계정으로 바로 수정·삭제할 수 있고, 관리자는 모든 리포트를
            관리할 수 있습니다. 전화번호는 목록/상세 모두 마스킹되어 노출됩니다.
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="shrink-0 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400"
        >
          + 새 리포트 작성
        </button>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제목 검색..."
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none sm:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={gameFilter}
            onChange={(e) => setGameFilter(e.target.value)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 focus:border-rose-400 focus:outline-none"
          >
            <option value="all">전체 게임</option>
            <option value="">허브 전체(게임 무관)</option>
            {PLAYABLE_GAMES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {(["all", ...BUG_REPORT_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === s
                  ? "border-rose-400 bg-rose-500/20 text-white"
                  : "border-white/10 text-white/60 hover:border-white/25"
              }`}
            >
              {s === "all" ? "전체 상태" : s}
            </button>
          ))}
        </div>
      </div>

      {!hydrated ? (
        <p className="py-16 text-center text-sm text-white/40">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/40">
          {merged.length === 0 ? "아직 제출된 버그 리포트가 없습니다." : "검색/필터 조건에 맞는 리포트가 없습니다."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-white/5 text-left text-xs text-white/50">
                <th className="px-3 py-2.5">번호</th>
                <th className="px-3 py-2.5">관련 게임</th>
                <th className="px-3 py-2.5">제목</th>
                <th className="px-3 py-2.5">작성자</th>
                <th className="px-3 py-2.5">등록일</th>
                <th className="px-3 py-2.5">상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="cursor-pointer border-t border-white/10 text-white/80 transition hover:bg-white/[0.04]"
                >
                  <td className="px-3 py-2.5 text-white/40">{filtered.length - idx}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{r.gameName ?? "허브"}</td>
                  <td className="px-3 py-2.5">
                    <span className="line-clamp-1">{r.title}</span>
                    {r.attachment && <span className="ml-1 text-white/40">📎</span>}
                    {r.updatedAt && r.updatedAt !== r.createdAt && (
                      <span className="ml-1 text-xs text-white/30">(수정됨)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.author}
                    {r.source === "cloud" && r.isGuest && (
                      <span className="ml-1 text-white/30" title="비로그인(게스트) 작성">
                        👤
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-white/50">{formatDate(r.createdAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && <BugReportModal onClose={() => setFormOpen(false)} />}
      {selected && <BugReportDetailModal report={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
