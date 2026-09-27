"use client";

import { useEffect, useRef, useState } from "react";
import PageCard from "./PageCard";
import {
  REACTION_EMOJIS,
  pageAt,
  pageKey,
  reactionsLeft,
  turnKind,
  type DoodlePhoneState,
  type EngineAction,
  type ReactionEmoji,
  type ReactionTally,
  type SeatIndex,
} from "./engine";

/** How long a newly revealed drawing takes to "draw itself". */
const DRAW_REPLAY_MS = 2_400;
/** Host auto-advance delays by what is on stage. */
const AUTO_DELAY_MS = { cover: 2_000, text: 3_200, drawing: 5_000 } as const;

/** Rulebook §6 — the host reveals one page at a time; everyone can react. */
export default function ShowcaseStage({
  state,
  viewerSeat,
  names,
  isHost,
  onAction,
}: {
  state: DoodlePhoneState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  isHost: boolean;
  onAction: (action: EngineAction) => void;
}) {
  const { album, revealed } = state.showcase;
  const n = state.playerCount;
  const [autoPlay, setAutoPlay] = useState(false);
  const newestRef = useRef<HTMLDivElement | null>(null);

  const advance = () => onAction({ type: "SHOWCASE_NEXT", from: state.showcase });
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  });

  useEffect(() => {
    newestRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [album, revealed]);

  useEffect(() => {
    if (!isHost || !autoPlay) return;
    const delay = revealed === 0 ? AUTO_DELAY_MS.cover : AUTO_DELAY_MS[turnKind(revealed)];
    const id = window.setTimeout(() => advanceRef.current(), delay);
    return () => window.clearTimeout(id);
  }, [isHost, autoPlay, album, revealed]);

  const nextLabel = revealed < n ? "다음 장 ▶" : album + 1 < n ? "다음 앨범 ▶" : "🏁 결과 보기";

  return (
    <div className="relative flex flex-col gap-4">
      <ReactionFloats reactions={state.reactions} />

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold text-white light:text-slate-900">🎬 결과 발표</h2>
        <span className="text-xs text-white/50 light:text-slate-500">
          앨범 {album + 1} / {n}
        </span>
      </div>

      <div className="rounded-2xl border border-fuchsia-400/30 bg-gradient-to-br from-fuchsia-600/25 via-violet-600/15 to-transparent p-5 text-center light:border-fuchsia-200 light:from-fuchsia-100 light:via-violet-50">
        <p className="text-xs tracking-widest text-fuchsia-200/80 uppercase light:text-fuchsia-600">Album #{album + 1}</p>
        <p className="mt-1 text-xl font-extrabold text-white light:text-slate-900">📖 {names[album]}님의 앨범</p>
        <p className="mt-1 text-xs text-white/50 light:text-slate-500">
          {revealed}/{n}장 공개
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: revealed }, (_, i) => {
          const turn = i + 1;
          const page = pageAt(state, album, turn);
          const isNewest = turn === revealed;
          return (
            <div key={pageKey(album, turn)} ref={isNewest ? newestRef : undefined} className={isNewest ? "animate-[doodle-page-in_420ms_ease-out]" : ""}>
              <PageCard
                page={page}
                turn={turn}
                authorName={page ? names[page.author] : "…"}
                animateMs={isNewest ? DRAW_REPLAY_MS : 0}
                footer={
                  page && (
                    <ReactionBar
                      tally={state.reactions[pageKey(album, turn)]}
                      canReact={page.author !== viewerSeat && reactionsLeft(state, viewerSeat, album, turn) > 0}
                      onReact={(emoji) => onAction({ type: "REACT", seat: viewerSeat, album, turn, emoji })}
                    />
                  )
                }
              />
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-3 z-10 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-950/80 p-2 backdrop-blur light:border-slate-200 light:bg-white/90">
        {isHost ? (
          <>
            <button type="button" onClick={advance} className="flex-1 rounded-xl bg-fuchsia-600 py-3 text-sm font-bold text-white transition hover:bg-fuchsia-500">
              {nextLabel}
            </button>
            <button
              type="button"
              aria-pressed={autoPlay}
              onClick={() => setAutoPlay((v) => !v)}
              className={`rounded-xl border px-3 py-3 text-xs font-semibold transition ${
                autoPlay ? "border-fuchsia-400 bg-fuchsia-500/20 text-white light:text-fuchsia-800" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-600"
              }`}
            >
              {autoPlay ? "⏸ 자동" : "▶ 자동"}
            </button>
          </>
        ) : (
          <p className="py-2 text-xs text-white/60 light:text-slate-500">방장이 한 장씩 넘기는 중이에요 · 마음에 드는 장면에 리액션을 보내보세요!</p>
        )}
      </div>

      <style>{`
        @keyframes doodle-page-in { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }
        @keyframes doodle-float-up {
          0% { opacity: 0; transform: translateY(0) scale(0.6); }
          15% { opacity: 1; transform: translateY(-20px) scale(1.15); }
          100% { opacity: 0; transform: translateY(-260px) scale(1); }
        }
      `}</style>
    </div>
  );
}

function ReactionBar({ tally, canReact, onReact }: { tally: ReactionTally | undefined; canReact: boolean; onReact: (emoji: ReactionEmoji) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {REACTION_EMOJIS.map((emoji) => {
        const count = tally?.[emoji] ?? 0;
        return (
          <button
            key={emoji}
            type="button"
            disabled={!canReact}
            onClick={() => onReact(emoji)}
            className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-sm transition hover:scale-110 hover:border-fuchsia-300 disabled:hover:scale-100 disabled:hover:border-white/10 light:border-slate-200 light:bg-slate-50"
          >
            <span>{emoji}</span>
            {count > 0 && <span className="text-xs font-bold text-white/80 tabular-nums light:text-slate-700">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface FloatingEmoji {
  id: string;
  emoji: string;
  leftPct: number;
}

function hashToPercent(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return 8 + (Math.abs(h) % 84);
}

/** New reactions since the last render, one float per added count. Ids are derived from the counts, so they are stable and unique. */
function diffReactions(prev: DoodlePhoneState["reactions"], next: DoodlePhoneState["reactions"]): FloatingEmoji[] {
  const out: FloatingEmoji[] = [];
  for (const [key, tally] of Object.entries(next)) {
    for (const emoji of REACTION_EMOJIS) {
      const before = prev[key]?.[emoji] ?? 0;
      for (let n = before + 1; n <= (tally[emoji] ?? 0); n++) {
        const id = `${key}:${emoji}:${n}`;
        out.push({ id, emoji, leftPct: hashToPercent(id) });
      }
    }
  }
  return out;
}

function ReactionFloats({ reactions }: { reactions: DoodlePhoneState["reactions"] }) {
  const [seen, setSeen] = useState(reactions);
  const [floats, setFloats] = useState<FloatingEmoji[]>([]);
  // Render-time diff (not an effect) — see ARCHITECTURE.md §7.3's
  // "compare and setState during render" pattern.
  if (seen !== reactions) {
    const spawned = diffReactions(seen, reactions);
    setSeen(reactions);
    if (spawned.length > 0 && spawned.length <= 20) setFloats((f) => [...f, ...spawned].slice(-30));
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 mx-auto h-0 max-w-2xl" aria-hidden>
      {floats.map((f) => (
        <span
          key={f.id}
          onAnimationEnd={() => setFloats((list) => list.filter((x) => x.id !== f.id))}
          className="absolute text-4xl drop-shadow-lg"
          style={{ left: `${f.leftPct}%`, animation: "doodle-float-up 1.8s ease-out forwards" }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}
