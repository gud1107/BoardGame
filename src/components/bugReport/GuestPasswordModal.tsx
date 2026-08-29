"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { MIN_GUEST_PASSWORD_LENGTH } from "@/lib/bugReports/validate";

/**
 * The "게스트 작성자 시점: [수정],[삭제] 클릭 시 비밀번호 확인 모달" gate —
 * used before opening the edit form (`BugReportModal`) and inline inside
 * the delete confirmation, see `BugReportDetailModal.tsx`. This modal only
 * *collects* the password; it does not itself verify it (there's no
 * standalone "check my password" endpoint — the actual PATCH/DELETE call
 * that follows is what the server verifies against the stored hash, same
 * as `permissions.ts`'s header comment: client-side gates are UX only).
 */
export default function GuestPasswordModal({
  title,
  onCancel,
  onConfirm,
  submitting,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: (password: string) => void;
  submitting?: boolean;
}) {
  const [password, setPassword] = useState("");

  function handleConfirm() {
    if (password.trim().length < MIN_GUEST_PASSWORD_LENGTH) return;
    onConfirm(password);
  }

  return (
    <Overlay title={title} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-white/70">작성 시 입력한 비밀번호를 입력해주세요.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          placeholder="비밀번호"
          autoFocus
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
        />
        <div className="mt-1 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || password.trim().length < MIN_GUEST_PASSWORD_LENGTH}
            className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-white/10"
          >
            {submitting ? "확인 중..." : "확인"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
