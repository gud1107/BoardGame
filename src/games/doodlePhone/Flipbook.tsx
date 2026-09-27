"use client";

import { useEffect, useState } from "react";
import type { Drawing } from "./drawing";
import DrawingView from "./DrawingView";

const FRAME_MS = 400;

/**
 * Animation mode's payoff: an album's frames played back as a looping
 * flipbook. (The brief asked for a GIF; this plays the same frames in place
 * without a GIF encoder dependency — each frame can still be saved as PNG
 * from the results screen.)
 */
export default function Flipbook({ frames, title = "🎞️ 애니메이션" }: { frames: readonly Drawing[]; title?: string }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % frames.length), FRAME_MS);
    return () => window.clearInterval(id);
  }, [playing, frames.length]);

  if (frames.length === 0) return null;
  const frame = frames[index % frames.length];
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-violet-400/30 bg-violet-500/10 p-3 light:border-violet-200 light:bg-violet-50">
      <div className="flex items-center justify-between text-xs text-white/70 light:text-slate-600">
        <span className="font-bold">{title}</span>
        <span className="tabular-nums">
          {(index % frames.length) + 1} / {frames.length}
        </span>
        <button type="button" onClick={() => setPlaying((p) => !p)} className="rounded-full border border-white/15 px-2.5 py-0.5 light:border-slate-300">
          {playing ? "⏸ 멈춤" : "▶ 재생"}
        </button>
      </div>
      <DrawingView drawing={frame} label={`프레임 ${index + 1}`} />
    </section>
  );
}
