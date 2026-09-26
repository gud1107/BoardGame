"use client";

import { useState } from "react";
import CardDetailModal from "./CardDetailModal";
import type { LogEntry, LogKind } from "./types";

/**
 * Whole-game history for 반지의 제왕: 가운데땅에서의 대결 — card picks and
 * discards, coins, ring-track moves, clashes, units, fortresses, tokens.
 *
 * Desktop (lg+): a slim sticky panel on the left of the board; its ◀ button
 * folds it into a thin sticky tab (📜 기록 + count) so the board gets the
 * width back, and tapping the tab unfolds it again.
 * Phones: a small "📜 기록" tab on the left edge (the site header is sticky
 * and tall on phones, so a top-left chip would sit under it); tapping it
 * slides a drawer in from the left, closed by tapping outside or ✕.
 *
 * Card entries (buy / discard / free play / destroyed) carry a 🔍 tag and
 * open `CardDetailModal` in the centre of the screen.
 *
 * The "timestamp" is the turn number — every client replays the same state,
 * so wall-clock times would differ between the two players.
 */

const KIND_ICON: Record<LogKind, string> = {
  CARD: "🃏",
  DISCARD: "🗑️",
  TRACK: "💍",
  COIN: "🪙",
  COMBAT: "⚔️",
  UNIT: "🪖",
  MOVE: "👣",
  LANDMARK: "🏰",
  TOKEN: "🤝",
  TACTIC: "🎯",
  SYSTEM: "📖",
};

function LogList({ log, onClose, onCollapse, onInspect }: { log: LogEntry[]; onClose?: () => void; onCollapse?: () => void; onInspect: (e: LogEntry) => void }) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-neutral-950/95 select-none">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 bg-neutral-900/90 px-3">
        <span className="font-serif text-xs font-black text-amber-300">📜 게임 기록 ({log.length})</span>
        {onCollapse && (
          <button onClick={onCollapse} className="rounded-md px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-white/10 hover:text-amber-200" aria-label="기록 접기" title="기록 접기">
            ◀ 접기
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="p-1 text-sm text-neutral-400 hover:text-white" aria-label="기록 닫기">
            ✕
          </button>
        )}
      </div>
      <ol className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {log.length === 0 && <li className="py-10 text-center text-[11px] text-neutral-500">기록된 행동이 없습니다.</li>}
        {[...log].reverse().map((e) => (
          <li
            key={e.no}
            {...(e.card
              ? {
                  role: "button",
                  tabIndex: 0,
                  title: "클릭하면 카드 상세를 봅니다",
                  onClick: () => onInspect(e),
                  onKeyDown: (k: React.KeyboardEvent) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), onInspect(e)),
                }
              : {})}
            className={`group rounded-xl border p-2 text-[11px] leading-relaxed ${
              e.card ? "cursor-pointer transition hover:border-amber-400/80 hover:shadow-[0_0_12px_rgba(251,191,36,.25)] focus-visible:outline-2 focus-visible:outline-amber-400" : ""
            } ${
              e.faction === "FELLOWSHIP"
                ? "border-amber-500/30 bg-amber-950/20 text-amber-50"
                : e.faction === "SAURON"
                  ? "border-rose-500/30 bg-rose-950/20 text-rose-50"
                  : e.kind === "COMBAT"
                    ? "border-red-500/40 bg-red-950/30 text-red-50"
                    : "border-white/10 bg-white/[0.03] text-neutral-200"
            }`}
          >
            <span className="mb-0.5 flex items-center justify-between font-mono text-[9px] text-neutral-400">
              <span className={e.faction === "FELLOWSHIP" ? "font-bold text-amber-300" : e.faction === "SAURON" ? "font-bold text-rose-300" : "font-bold text-neutral-300"}>
                {KIND_ICON[e.kind]} {e.faction === "FELLOWSHIP" ? "원정대" : e.faction === "SAURON" ? "사우론" : e.kind === "COMBAT" ? "교전" : "진행"}
              </span>
              <span className="flex items-center gap-1.5">
                {e.card && <span className="rounded border border-amber-500/40 bg-amber-500/20 px-1 font-bold text-amber-300">🔍 카드 보기</span>}
                <span>{e.turn}턴</span>
              </span>
            </span>
            <span className={`break-keep ${e.card ? "decoration-amber-300/70 underline-offset-2 group-hover:text-amber-100 group-hover:underline" : ""}`}>{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function HistoryLogDrawer({ log }: { log: LogEntry[] }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [inspecting, setInspecting] = useState<LogEntry | null>(null);
  return (
    <>
      {/* phones: left-edge tab */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-1/3 left-0 z-30 flex flex-col items-center gap-1 rounded-r-xl border border-l-0 border-amber-500/40 bg-neutral-900/90 px-1.5 py-2 text-[11px] font-bold text-amber-300 shadow-lg backdrop-blur-md lg:hidden"
        aria-label="게임 기록 열기"
      >
        <span>📜</span>
        <span className="[writing-mode:vertical-rl]">기록</span>
        <span className="rounded-full bg-amber-500/25 px-1 font-mono text-[9px]">{log.length}</span>
      </button>

      {/* desktop: sticky left panel, foldable into a thin tab */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="sticky top-20 hidden shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-amber-500/30 bg-neutral-900/90 px-1.5 py-3 text-[11px] font-bold text-amber-300 shadow-2xl transition hover:border-amber-400/70 hover:bg-neutral-800 lg:flex"
          aria-label="게임 기록 펼치기"
          title="기록 펼치기"
        >
          <span>📜</span>
          <span className="[writing-mode:vertical-rl]">기록</span>
          <span className="rounded-full bg-amber-500/25 px-1 font-mono text-[9px]">{log.length}</span>
          <span className="text-[10px] text-neutral-400">▶</span>
        </button>
      ) : (
        <aside className="sticky top-20 hidden h-[calc(100dvh-7rem)] w-60 shrink-0 overflow-hidden rounded-2xl border border-amber-500/20 shadow-2xl lg:block">
          <LogList log={log} onCollapse={() => setCollapsed(true)} onInspect={setInspecting} />
        </aside>
      )}

      {/* phones: slide-over drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="게임 기록">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw] border-r border-amber-500/20 shadow-2xl" style={{ animation: "lotrlog-in .28s cubic-bezier(.2,.9,.2,1) both" }}>
            <style>{"@keyframes lotrlog-in { 0% { transform: translateX(-100%) } 100% { transform: none } }"}</style>
            <LogList log={log} onClose={() => setOpen(false)} onInspect={setInspecting} />
          </div>
        </div>
      )}

      {/* card inspector — above the mobile drawer too */}
      {inspecting?.card && <CardDetailModal entry={inspecting} log={log} onClose={() => setInspecting(null)} />}
    </>
  );
}
