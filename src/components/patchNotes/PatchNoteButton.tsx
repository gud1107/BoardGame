"use client";

import { useState } from "react";
import { LATEST_PATCH_VERSION } from "@/constants/patchNotes";
import PatchNoteModal from "./PatchNoteModal";

/** Exact key name from the request brief — kept as-is rather than this
 * project's usual `boardgame_..._v1` namespacing, since it's a literal
 * instruction rather than an internal implementation detail. */
const LAST_SEEN_KEY = "last_seen_version";

/**
 * Header widget: [ 📋 vX.X.X ] button + a small red "unseen" dot that
 * appears whenever `localStorage[last_seen_version]` doesn't match
 * `LATEST_PATCH_VERSION` (covers both "never opened it" and "a newer patch
 * shipped since last open"). Opening the modal immediately marks the
 * current latest version as seen, clearing the dot for future visits.
 *
 * Read via a lazy `useState` initializer (runs during render, not in an
 * effect) rather than `useEffect` + `setState` on mount — same pattern as
 * `NoThanksBoard.tsx`'s `revealOpponentChips`, and avoids the
 * `react-hooks/set-state-in-effect` cascading-render lint warning that a
 * mount effect here would trigger.
 */
export default function PatchNoteButton() {
  const [open, setOpen] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(LAST_SEEN_KEY) !== LATEST_PATCH_VERSION;
    } catch {
      // localStorage unavailable (private browsing 등) — 뱃지 없이 진행, 기능엔 지장 없음.
      return false;
    }
  });

  function handleOpen() {
    setOpen(true);
    setHasUnseen(false);
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, LATEST_PATCH_VERSION);
    } catch {
      // 저장 실패 시 다음 방문에 뱃지가 다시 뜰 뿐 — 무시해도 안전.
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="relative flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 transition hover:border-white/30 hover:text-white sm:text-xs"
        aria-label={`패치노트 ${LATEST_PATCH_VERSION}`}
        title="패치노트"
      >
        <span aria-hidden>📋</span>
        <span className="hidden sm:inline">{LATEST_PATCH_VERSION}</span>
        {hasUnseen && (
          <span
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[#0b0b12]"
            aria-label="새 패치노트 있음"
          />
        )}
      </button>
      {open && <PatchNoteModal onClose={() => setOpen(false)} />}
    </>
  );
}
