"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { BUG_REPORT_STATUSES } from "@/lib/bugReports/board";
import { maskPhoneNumber } from "@/lib/bugReports/validate";
import type { BugReportRecord, BugReportStatus } from "@/lib/db/types";

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
  onStatusChange,
}: {
  report: BugReportRecord;
  onClose: () => void;
  onStatusChange?: (id: string, status: BugReportStatus) => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);

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

        {onStatusChange && (
          <label className="flex items-center gap-2 text-xs text-white/50">
            <span>처리 상태 변경</span>
            <select
              value={report.status}
              disabled={updating}
              onChange={async (e) => {
                setUpdating(true);
                await onStatusChange(report.id, e.target.value as BugReportStatus);
                setUpdating(false);
              }}
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
      </div>
    </Overlay>
  );
}
