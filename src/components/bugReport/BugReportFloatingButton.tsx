"use client";

import { useState } from "react";
import BugReportModal from "./BugReportModal";

/**
 * Standing access point rendered on `/games/[gameId]` for every playable
 * game — covers ARCHITECTURE.md's "게임 간 코드 결합 0" rule by living at
 * the shared page wrapper instead of being copy-pasted into all ~19
 * `<Game>Board.tsx` files. `gameId`/`gameName` auto-map into the form.
 */
export default function BugReportFloatingButton({ gameId, gameName }: { gameId: string; gameName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Bottom-left, not bottom-right — `BettingSidebar`'s always-on-screen
          toggle (`src/components/betting/BettingSidebar.tsx`) already owns
          the bottom-right corner site-wide (z-40, 14×14) and would fully
          cover/eat clicks on a same-corner button here. */}
      <button
        onClick={() => setOpen(true)}
        aria-label="버그 리포트 작성"
        className="fixed bottom-5 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-[#151022] text-xl shadow-lg transition hover:border-rose-400 sm:bottom-6 sm:left-6"
      >
        🐛
      </button>
      {open && <BugReportModal gameId={gameId} gameName={gameName} onClose={() => setOpen(false)} />}
    </>
  );
}
