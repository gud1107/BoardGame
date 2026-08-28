"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Shared "swipe down to close" physics for the mobile bottom-sheet layout
 * that `Overlay.tsx`/`ChatDrawer.tsx`/`BettingSidebar.tsx` all switch into
 * below the `sm` (640px) breakpoint. A hook rather than a wrapper component
 * because each caller already owns a differently-shaped container (centered
 * modal vs. left drawer vs. right drawer) that only needs to *borrow* the
 * drag tracking, not be replaced by a generic shell.
 *
 * Closes when the drag either travels past `CLOSE_DISTANCE_PX` or is
 * released while moving faster than `CLOSE_VELOCITY_PX_MS` (a quick flick
 * that hasn't yet covered the full distance) — either condition alone is
 * enough, matching a typical native bottom-sheet feel. Anything short of
 * both rubber-bands back to 0 via the caller's own CSS transition (this
 * hook only supplies `dragY`; it stops driving the transform the instant
 * the gesture ends, so a `transition` class on the sheet takes back over
 * for the snap-back).
 *
 * Gated to the mobile breakpoint via `matchMedia` so a touchscreen laptop
 * dragging the header of a *desktop* (side-drawer / centered-modal) layout
 * doesn't fight that layout's own horizontal/fade transform — this hook's
 * `translateY` is only meaningful once the caller has actually switched
 * into its bottom-sheet shape.
 */
const CLOSE_DISTANCE_PX = 100;
const CLOSE_VELOCITY_PX_MS = 0.5;
const MOBILE_QUERY = "(max-width: 639px)";

interface DragStart {
  y: number;
  t: number;
  lastY: number;
  lastT: number;
}

export function useSwipeToDismiss(onDismiss: () => void) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<DragStart | null>(null);

  const isMobile = useCallback(() => {
    return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isMobile()) return;
      const touch = e.touches[0];
      const now = performance.now();
      dragStart.current = { y: touch.clientY, t: now, lastY: touch.clientY, lastT: now };
      setDragging(true);
    },
    [isMobile],
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const touch = e.touches[0];
    const delta = touch.clientY - start.y;
    // Only track downward drags — an upward flick shouldn't lift the sheet
    // past its resting position.
    setDragY(Math.max(0, delta));
    start.lastY = touch.clientY;
    start.lastT = performance.now();
  }, []);

  const onTouchEnd = useCallback(() => {
    const start = dragStart.current;
    dragStart.current = null;
    setDragging(false);
    setDragY(0);
    if (!start) return;
    const distance = start.lastY - start.y;
    const elapsedMs = Math.max(1, start.lastT - start.t);
    const velocity = distance / elapsedMs;
    if (distance >= CLOSE_DISTANCE_PX || velocity >= CLOSE_VELOCITY_PX_MS) {
      onDismiss();
    }
  }, [onDismiss]);

  return {
    /** Live downward drag offset in px — 0 when not dragging. */
    dragY,
    /** True while a touch is actively down; use to suppress the snap-back transition mid-drag. */
    dragging,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
