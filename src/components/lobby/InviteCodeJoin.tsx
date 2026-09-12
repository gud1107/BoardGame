"use client";

import { useState } from "react";
import { findActiveRoomsByCode } from "@/lib/activeRooms/repository";

/**
 * Compact "초대 코드로 입장" input, extracted from the desktop dashboard's
 * now-removed `LobbyProfileCard` (2026-09-12 grid-overhaul session) so the
 * quick-join capability survives the dashboard's left rail going away —
 * lives in `SiteHeader` instead (`hidden xl:flex`, so mobile/tablet headers
 * stay pixel-identical, matching this app's existing desktop-only boundary
 * for this feature). Same lookup logic as before: a bare code can't
 * disambiguate a cross-game collision, so this lands on the most recently
 * updated match.
 */
export default function InviteCodeJoin() {
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);

  async function handleJoin() {
    const code = codeInput.trim();
    if (!code) return;
    setCodeError(null);
    setCodeChecking(true);
    try {
      const matches = await findActiveRoomsByCode(code);
      if (matches.length === 0) {
        setCodeError("코드를 확인해주세요");
        return;
      }
      const target = matches.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
      window.location.href = `/games/${target.gameId}?room=${target.roomCode}`;
    } finally {
      setCodeChecking(false);
    }
  }

  return (
    <div className="relative flex items-center gap-1.5">
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 focus-within:border-rose-400/50">
        <span className="shrink-0 text-[10px] text-white/40">🔑</span>
        <input
          value={codeInput}
          onChange={(e) => {
            setCodeInput(e.target.value.toUpperCase());
            setCodeError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="초대 코드"
          aria-label="초대 코드로 입장"
          className="w-20 bg-transparent font-mono text-xs uppercase text-rose-200 outline-none placeholder:text-white/30 placeholder:normal-case"
        />
        <button
          type="button"
          onClick={handleJoin}
          disabled={!codeInput.trim() || codeChecking}
          className="shrink-0 rounded-full bg-rose-500/80 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {codeChecking ? "…" : "입장"}
        </button>
      </div>
      {codeError && (
        <span className="absolute top-full left-0 mt-1 whitespace-nowrap text-[10px] text-rose-300">
          {codeError}
        </span>
      )}
    </div>
  );
}
