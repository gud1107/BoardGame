"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { DestinyWar39State, SeatIndex } from "./engine";

export interface RankedLeaderboardProps {
  state: DestinyWar39State;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
}

const RANK_BADGE: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const COUNT_UP_MS = 900;
const DELTA_FLOAT_MS = 1300;

function totalOf(state: DestinyWar39State, seat: SeatIndex): number {
  const player = state.players.find((p) => p.seat === seat)!;
  return player.scores.reduce((sum: number, v) => sum + (v ?? 0), 0);
}

/**
 * Count-up + floating "+30"/"-15" delta for one player's cumulative total.
 * Diffs against the *previously rendered* total on every prop change rather
 * than keying off `state.phase` — that way it fires correctly whenever the
 * total actually changes (round settle, reconnect resync, …) and stays
 * silent on first mount (no false +N from a starting value of 0).
 */
function AnimatedScore({ total }: { total: number }) {
  const [display, setDisplay] = useState(total);
  const [delta, setDelta] = useState<{ value: number; key: number } | null>(null);
  const prevRef = useRef(total);
  const deltaSeqRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const from = prevRef.current;
    const to = total;
    if (from === to) return;
    prevRef.current = to;
    deltaSeqRef.current += 1;
    setDelta({ value: to - from, key: deltaSeqRef.current });

    const start = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased));
      rafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [total]);

  return (
    <span className="relative inline-flex items-center">
      <b className="tabular-nums text-white">{display}</b>
      {delta && (
        <span
          key={delta.key}
          onAnimationEnd={() => setDelta(null)}
          className={`pointer-events-none absolute left-1/2 -top-1 -translate-x-1/2 text-[11px] font-bold whitespace-nowrap ${
            delta.value >= 0 ? "text-emerald-300" : "text-rose-300"
          }`}
          style={{ animation: `destinywar39-score-delta-float ${DELTA_FLOAT_MS}ms ease-out forwards` }}
        >
          {delta.value >= 0 ? `+${delta.value}` : delta.value}
        </span>
      )}
    </span>
  );
}

/**
 * Sorted rank list, shared by the desktop `<aside>` and the mobile drawer
 * (two separate mounted instances — same FLIP-reorder pattern used by the
 * rest of this project's edge-tab sidebars, e.g. Avalon's role guide).
 * Rank swaps replay a vanilla-JS FLIP: capture each row's rect before the
 * order changes, then on the next layout apply the inverse transform and
 * transition it back to identity — no animation library in this project.
 */
function LeaderboardList({ state, viewerSeat, names, connectedSeats }: RankedLeaderboardProps) {
  const sorted = Array.from({ length: state.playerCount }, (_, seat) => seat)
    .map((seat) => ({ seat, total: totalOf(state, seat) }))
    .sort((a, b) => b.total - a.total || a.seat - b.seat);
  const orderKey = sorted.map((s) => s.seat).join(",");

  const rowRefs = useRef(new Map<SeatIndex, HTMLDivElement>());
  const prevRectsRef = useRef(new Map<SeatIndex, DOMRect>());
  const prevOrderKeyRef = useRef(orderKey);

  useLayoutEffect(() => {
    if (prevOrderKeyRef.current !== orderKey) {
      rowRefs.current.forEach((el, seat) => {
        const prevRect = prevRectsRef.current.get(seat);
        if (!prevRect) return;
        const nextRect = el.getBoundingClientRect();
        const deltaY = prevRect.top - nextRect.top;
        if (!deltaY) return;
        el.style.transition = "none";
        el.style.transform = `translateY(${deltaY}px)`;
        void el.offsetHeight; // force reflow so the starting transform commits before animating back
        el.style.transition = "transform 420ms cubic-bezier(0.22,1,0.36,1)";
        el.style.transform = "";
      });
      prevOrderKeyRef.current = orderKey;
    }
    rowRefs.current.forEach((el, seat) => {
      prevRectsRef.current.set(seat, el.getBoundingClientRect());
    });
  }, [orderKey]);

  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map(({ seat, total }, i) => {
        const rank = i + 1;
        const isMe = seat === viewerSeat;
        return (
          <div
            key={seat}
            ref={(el) => {
              if (el) rowRefs.current.set(seat, el);
              else rowRefs.current.delete(seat);
            }}
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs transition-colors ${
              isMe ? "border-fuchsia-400/40 bg-fuchsia-500/10" : "border-white/10 bg-white/[0.02]"
            } ${!connectedSeats.has(seat) ? "opacity-40" : ""}`}
          >
            <span className="w-6 shrink-0 text-center text-sm" title={`${rank}위`}>
              {RANK_BADGE[rank] ?? <span className="text-[10px] text-white/40">{rank}위</span>}
            </span>
            <span className={`min-w-0 flex-1 truncate font-semibold ${isMe ? "text-fuchsia-200" : "text-white/85"}`}>
              {names[seat]}
              {isMe ? " (나)" : ""}
            </span>
            <AnimatedScore total={total} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Left-side "at a glance" ranked leaderboard — always mounted across every
 * phase (predicting/playing/roundEnd/gameOver), unlike `PredictionStatusBoard`
 * which is scoped to the active round. Desktop gets a fixed column beside the
 * board; narrower viewports get Avalon's edge-tab → slide-in drawer pattern
 * (see `AvalonRoleGuideSidebar.tsx`) so it never blocks the board uninvited.
 * The page container for `destinyWar39` is widened in `[gameId]/page.tsx`
 * (same reason as Avalon/소환사의 협곡) to fit this alongside the right panel.
 */
export default function RankedLeaderboard(props: RankedLeaderboardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Desktop: always-visible fixed column beside the board. */}
      <aside className="hidden max-h-[70vh] w-60 shrink-0 flex-col gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:flex">
        <h3 className="px-1 text-xs font-semibold tracking-wide text-white/50 uppercase">🏆 누적 순위</h3>
        <LeaderboardList {...props} />
      </aside>

      {/* Mobile/tablet: collapsed edge tab that opens a slide-in drawer. */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="누적 순위 패널 열기"
        className="fixed top-1/2 left-0 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-r-xl border border-l-0 border-white/15 bg-[#150c22] px-1.5 py-3 text-[10px] font-semibold text-white/70 shadow-lg lg:hidden"
      >
        <span className="text-base">🏆</span>
        <span className="[writing-mode:vertical-rl]">순위</span>
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-start lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <div className="relative flex h-full w-[85vw] max-w-sm flex-col gap-2 overflow-y-auto border-r border-white/10 bg-[#150c22] p-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-white/50 uppercase">🏆 누적 순위</h3>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="닫기"
                className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30 hover:text-white"
              >
                ✕
              </button>
            </div>
            <LeaderboardList {...props} />
          </div>
        </div>
      )}
    </>
  );
}
