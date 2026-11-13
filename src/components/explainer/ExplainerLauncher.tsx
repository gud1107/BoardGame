"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getPosterImage } from "@/constants/posterImages";
import { getGameMeta } from "@/games/registry";
import ExplainerPlayer from "./ExplainerPlayer";
import { getExplainerScript } from "./scripts";
import { buildTimeline, formatTime } from "./timeline";

/**
 * 🎬 영상 설명 entry point: a YouTube-style thumbnail card that opens the
 * explainer player in a theater-mode modal. Renders nothing for a game with
 * neither a hand-made script nor a 30초 룰북 entry.
 */
export default function ExplainerLauncher({ gameId, compact = false }: { gameId: string; compact?: boolean }) {
  const script = useMemo(() => getExplainerScript(gameId), [gameId]);
  const [open, setOpen] = useState(false);
  const meta = getGameMeta(gameId);
  if (!script || !meta) return null;
  const tl = buildTimeline(script);
  const still = getPosterImage(gameId);

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs font-semibold break-keep text-red-200 light:bg-red-50 light:text-red-700"
        >
          🎬 영상으로 룰 배우기 · {formatTime(tl.duration)}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black/30 text-left transition hover:border-red-400/50 light:border-slate-200 light:bg-white"
        >
          <div className="relative aspect-video w-full overflow-hidden" style={{ background: `linear-gradient(135deg, ${meta.thumbnail.gradient?.[0] ?? "#334155"}, ${meta.thumbnail.gradient?.[1] ?? "#0f172a"})` }}>
            {still ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80 transition group-hover:scale-105" loading="lazy" />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-6xl">{meta.thumbnail.emoji}</span>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <span className="absolute top-1/2 left-1/2 flex h-11 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-red-600 text-xl text-white shadow-lg transition group-hover:scale-110">
              ▶
            </span>
            <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">{formatTime(tl.duration)}</span>
            {script.kind === "animated" && (
              <span className="absolute top-2 left-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">애니메이션 해설</span>
            )}
          </div>
          <div className="px-3 py-2">
            <div className="text-sm font-bold break-keep text-white light:text-slate-900">{script.title}</div>
            <div className="text-[11px] text-white/50 light:text-slate-500">
              챕터 {tl.chapters.length}개 · 자막 · 내레이션{script.kind === "summary" ? " · 30초 룰북 기반" : ""}
            </div>
          </div>
        </button>
      )}
      {open && <ExplainerModal gameId={gameId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExplainerModal({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const script = useMemo(() => getExplainerScript(gameId), [gameId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  if (!script || typeof document === "undefined") return null;
  // No backdrop-filter on this overlay: it would become the containing block
  // for the player's `position: fixed` iPhone fullscreen fallback.
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/90 p-2 sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={script.title}>
      <div className="relative w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="text-sm font-bold text-white sm:text-base">🎬 {script.title}</div>
          <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-white hover:bg-white/20" aria-label="닫기">
            ✕ 닫기
          </button>
        </div>
        <ExplainerPlayer script={script} onFinish={onClose} />
      </div>
    </div>,
    document.body,
  );
}
