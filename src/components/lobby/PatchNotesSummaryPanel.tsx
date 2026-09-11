"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import PatchNoteList from "@/components/patchNotes/PatchNoteList";
import { PATCH_NOTES } from "@/constants/patchNotes";

const PREVIEW_COUNT = 3;

/**
 * Desktop dashboard right rail's bottom section (see `src/app/page.tsx`) —
 * the latest few patch note headlines, with a button that opens the exact
 * same in-place `Overlay` + `PatchNoteList` the header's `PatchNoteButton`
 * uses (never a route navigation — see that component's doc comment on why
 * navigating away from `/games/[gameId]` mid-match is unsafe).
 */
export default function PatchNotesSummaryPanel() {
  const [open, setOpen] = useState(false);
  const preview = PATCH_NOTES.slice(0, PREVIEW_COUNT);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <span className="text-xs font-bold text-amber-400">📜 최신 패치노트</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60 transition hover:border-amber-400/40 hover:text-white"
        >
          전체 보기
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {preview.map((entry) => (
          <li key={entry.version} className="flex items-start gap-1.5 text-[11px] text-white/60">
            <span className="mt-0.5 shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/50">
              {entry.version}
            </span>
            <span className="line-clamp-1 break-keep">{entry.title}</span>
          </li>
        ))}
      </ul>
      {open && (
        <Overlay title="📋 패치노트" onClose={() => setOpen(false)} wide>
          <PatchNoteList />
        </Overlay>
      )}
    </div>
  );
}
