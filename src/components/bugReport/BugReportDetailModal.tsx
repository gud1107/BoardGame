"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import BugReportModal from "./BugReportModal";
import { BUG_REPORT_STATUSES } from "@/lib/bugReports/board";
import { maskPhoneNumber } from "@/lib/bugReports/validate";
import { canChangeStatus, canDelete, canEditContent } from "@/lib/bugReports/permissions";
import { useBugReportStore } from "@/store/bugReportStore";
import type { BugReportStatus } from "@/lib/db/types";
import type { UnifiedBugReport } from "@/lib/bugReports/types";

const STATUS_STYLE: Record<BugReportStatus, string> = {
  접수됨: "border-white/20 text-white/70",
  "확인 중": "border-amber-400/40 bg-amber-500/10 text-amber-200",
  "수정 완료": "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BugReportDetailModal({
  report,
  onClose,
}: {
  report: UnifiedBugReport;
  onClose: () => void;
}) {
  const currentUser = useBugReportStore((s) => s.currentUser);
  const updateStatus = useBugReportStore((s) => s.updateStatus);
  const deleteReport = useBugReportStore((s) => s.deleteReport);
  const adminDeleteLocalReport = useBugReportStore((s) => s.adminDeleteLocalReport);
  const adminUpdateLocalStatus = useBugReportStore((s) => s.adminUpdateLocalStatus);

  const [editing, setEditing] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isAdmin = currentUser?.isAdmin ?? false;
  // Legacy local reports (`source: "local"`) have no `authorId` to check
  // ownership against — see permissions.ts / HANDOFF.md — so only the
  // admin-only branch of each rule applies to them, never the "own it" one.
  const canEdit = report.source === "cloud" ? canEditContent(report.authorId, currentUser?.id ?? null, isAdmin) : isAdmin;
  const canRemove = report.source === "cloud" ? canDelete(report.authorId, currentUser?.id ?? null, isAdmin) : isAdmin;
  const canStatus = report.source === "cloud" ? canChangeStatus(isAdmin) : isAdmin;

  async function handleStatusChange(status: BugReportStatus) {
    setStatusUpdating(true);
    if (report.source === "cloud") await updateStatus(report.id, status);
    else await adminUpdateLocalStatus(report.id, status);
    setStatusUpdating(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    const ok = report.source === "cloud" ? (await deleteReport(report.id)).ok : await adminDeleteLocalReport(report.id);
    setDeleting(false);
    if (ok) onClose();
    else setDeleteError("삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }

  if (editing) {
    return <BugReportModal editing={report} onClose={() => setEditing(false)} />;
  }

  return (
    <Overlay title={report.title} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
          <span className={`rounded-full border px-2.5 py-1 font-medium ${STATUS_STYLE[report.status]}`}>
            {report.status}
          </span>
          {report.gameName && (
            <span className="rounded-full border border-white/15 px-2.5 py-1">🎮 {report.gameName}</span>
          )}
          <span>👤 {report.author}</span>
          {report.phone && <span>📞 {maskPhoneNumber(report.phone)}</span>}
          <span>🕒 {formatDateTime(report.createdAt)}</span>
          {report.updatedAt && report.updatedAt !== report.createdAt && (
            <span className="rounded-full border border-white/15 px-2.5 py-1">
              ✏️ 수정됨 · {formatDateTime(report.updatedAt)}
            </span>
          )}
          {report.source === "local" && (
            <span
              title="계정 연동 이전에 이 브라우저에 저장된 기록 — 작성자 식별이 불가해 관리자만 수정/삭제할 수 있습니다."
              className="rounded-full border border-white/10 px-2.5 py-1 text-white/40"
            >
              🗂 로컬 기록
            </span>
          )}
        </div>

        <p className="whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.03] p-4 leading-relaxed">
          {report.description}
        </p>

        {report.attachment && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-white/50">첨부 이미지</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- base64 data: URI, next/image can't optimize this */}
            <img
              src={report.attachment.dataUrl}
              alt={report.attachment.fileName}
              className="max-h-80 rounded-xl border border-white/10 object-contain"
            />
            <a
              href={report.attachment.dataUrl}
              download={report.attachment.fileName}
              className="self-start text-xs text-rose-300 underline"
            >
              ⬇ {report.attachment.fileName} 다운로드
            </a>
          </div>
        )}

        {canStatus && (
          <label className="flex items-center gap-2 text-xs text-white/50">
            <span>처리 상태 변경</span>
            <select
              value={report.status}
              disabled={statusUpdating}
              onChange={(e) => void handleStatusChange(e.target.value as BugReportStatus)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white focus:border-rose-400 focus:outline-none"
            >
              {BUG_REPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}

        {confirmingDelete ? (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-center">
            <p className="text-white/80">정말 이 버그리포트를 삭제하시겠습니까?</p>
            {deleteError && <p className="mt-1 text-xs text-rose-300">{deleteError}</p>}
            <div className="mt-3 flex justify-center gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-white/10"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        ) : (
          (canEdit || canRemove) && (
            <div className="flex gap-2">
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-white/30"
                >
                  ✏️ 수정
                </button>
              )}
              {canRemove && (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded-xl border border-rose-400/40 px-4 py-2 text-xs text-rose-300 hover:bg-rose-500/10"
                >
                  🗑️ 삭제
                </button>
              )}
            </div>
          )
        )}
      </div>
    </Overlay>
  );
}
