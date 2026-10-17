"use client";

import { useState } from "react";
import { UNITS, type UnitKind } from "./engine";

export type LogTone = "wave" | "boss" | "danger" | "good";

export interface LogEntry {
  key: number;
  text: string;
  sub?: string;
  tone: LogTone;
  wave: number;
}

const TONE: Record<LogTone, string> = {
  wave: "border-sky-300/40 bg-sky-500/20",
  boss: "border-amber-300/60 bg-purple-700/40",
  danger: "border-rose-300/50 bg-rose-600/35",
  good: "border-emerald-300/50 bg-emerald-600/30",
};

const DOT: Record<LogTone, string> = {
  wave: "bg-sky-400",
  boss: "bg-amber-400",
  danger: "bg-rose-500",
  good: "bg-emerald-400",
};

/**
 * Side drawer for the board's announcements (sends, hires, jams, boss waves…).
 * Collapsed by default so nothing covers the road on phones — the tab only shows
 * an unread count; open it to read what happened.
 */
export default function EventLog({ entries }: { entries: LogEntry[] }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const latest = entries.at(-1);
  const unread = open ? 0 : entries.filter((e) => e.key > seen).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSeen(latest?.key ?? 0);
        }}
        className="absolute right-0 bottom-2 z-20 flex items-center gap-1 rounded-l-xl border border-r-0 border-white/25 bg-slate-950/80 py-1.5 pr-1.5 pl-2 text-[11px] font-bold text-white shadow-lg backdrop-blur-sm"
        aria-label={`알림 기록 펼치기${unread ? ` (새 알림 ${unread}개)` : ""}`}
        title="상대가 보낸 몬스터·견제·웨이브 알림을 모아 봐요"
      >
        <span aria-hidden>◀</span> 📜
        {unread > 0 && latest && (
          <span key={latest.key} className={`min-w-[1.1rem] rounded-full px-1 text-center text-[10px] text-white motion-safe:animate-[md-pop_0.35s_ease-out] ${DOT[latest.tone]}`}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="absolute inset-y-1 right-1 z-20 flex w-64 max-w-[78%] flex-col overflow-hidden rounded-xl border border-white/20 bg-slate-950/90 text-white shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-2 py-1 text-[11px] font-bold">
        <span>📜 알림 기록</span>
        <button type="button" onClick={() => setOpen(false)} className="px-1.5 text-white/70 hover:text-white" aria-label="알림 기록 접기">
          접기 ▶
        </button>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-1.5">
        {entries.length === 0 && <li className="py-2 text-center text-[11px] text-white/50">아직 알림이 없어요</li>}
        {[...entries].reverse().map((e) => (
          <li key={e.key} className={`rounded-lg border px-1.5 py-1 text-[11px] leading-snug ${TONE[e.tone]}`}>
            <span className="mr-1 font-mono text-[9px] text-white/50">W{e.wave}</span>
            <b>{e.text}</b>
            {e.sub && <span className="block text-[10px] text-white/75">{e.sub}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Black or white text, whichever reads better on the tower's own color. */
function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? "#0b0b0f" : "#ffffff";
}

/** Tower name as a solid chip in the tower's color — readable on both themes. */
export function TowerName({ kind, emoji = true, wrap = false, className = "" }: { kind: UnitKind; emoji?: boolean; wrap?: boolean; className?: string }) {
  const u = UNITS[kind];
  return (
    <span
      className={`inline-block rounded-md px-1 font-black shadow-[0_0_6px_rgba(0,0,0,0.35)] ${wrap ? "break-keep" : "whitespace-nowrap"} ${className}`}
      style={{ background: u.color, color: inkFor(u.color) }}
    >
      {emoji ? `${u.emoji} ` : ""}
      {u.name}
    </span>
  );
}
