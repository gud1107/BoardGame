"use client";

import { useEffect, useRef, useState } from "react";

/** Brushing across the grid shouldn't start ten downloads — wait for a rest. */
const HOVER_DELAY_MS = 250;

function canPlayHoverVideo() {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}

/**
 * Hover highlight clip for a poster card (see `posterVideos.ts`). Returns the
 * pointer handlers for the card and the `<video>` layer to put over the still
 * capture. The element is only created after the first real mouse rest, then
 * kept so later hovers replay from the buffer; it fades in once frames play
 * and restarts from the top on every hover.
 */
export function usePosterHoverVideo(video: { webm: string; mp4: string } | null) {
  const [mounted, setMounted] = useState(false);
  const [showing, setShowing] = useState(false);
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onPointerEnter = (e: React.PointerEvent) => {
    if (!video || e.pointerType !== "mouse" || !canPlayHoverVideo()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setMounted(true);
      setShowing(true);
      const el = ref.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => {});
      }
    }, HOVER_DELAY_MS);
  };

  const onPointerLeave = () => {
    window.clearTimeout(timer.current);
    setShowing(false);
    ref.current?.pause();
  };

  const layer =
    mounted && video ? (
      <video
        ref={(el) => {
          ref.current = el;
          // React doesn't reflect `muted` as an attribute; set it before load
          // so the browser's autoplay policy lets the clip start.
          if (el) {
            el.defaultMuted = true;
            el.muted = true;
          }
        }}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        aria-hidden
        tabIndex={-1}
        onPlaying={() => setReady(true)}
        // A clip that can't decode stays invisible; the still capture shows.
        onError={() => setReady(false)}
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          showing && ready ? "opacity-100" : "opacity-0"
        }`}
      >
        <source src={video.webm} type="video/webm" />
        <source src={video.mp4} type="video/mp4" />
      </video>
    ) : null;

  return { onPointerEnter, onPointerLeave, layer };
}
