"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Page-level "⛶ 전체화면" for every game (the shared GamePlayPage shell).
 *
 * - Fullscreens the whole document (not the board element) so portaled
 *   modals/toasts (Overlay, bot-takeover votes, MatchRecordCard…) stay visible.
 * - iPhone Safari has no Fullscreen API → falls back to a CSS "immersive"
 *   mode that still hides the site header and widens the column.
 * - Fills the screen by resolution: pure-DOM boards are scaled with CSS
 *   `zoom` (they were laid out for a fixed column, so widening alone would
 *   just leave empty margins). Boards containing a <canvas> (three.js/R3F or
 *   2D canvas games) are only widened instead — R3F measures with
 *   getBoundingClientRect and would double-apply an ancestor zoom.
 */

/** Tailwind max-w classes used by the game page → px. */
export const MAX_W_PX: Record<string, number> = {
  "max-w-2xl": 672,
  "max-w-3xl": 768,
  "max-w-4xl": 896,
  "max-w-5xl": 1024,
  "max-w-6xl": 1152,
  "max-w-7xl": 1280,
  "max-w-[96rem]": 1536,
};

/** Design height a board column is expected to read well at. */
const BASE_VIEW_H = 780;
const MAX_ZOOM = 2;

/** Scale for a `basePx`-wide column on a `vw`×`vh` screen: never shrinks, bounded by width and height. */
export function fullscreenZoom(vw: number, vh: number, basePx: number): number {
  if (vw <= 0 || vh <= 0 || basePx <= 0) return 1;
  const z = Math.min((vw - 24) / basePx, vh / BASE_VIEW_H);
  return Math.max(1, Math.min(MAX_ZOOM, Math.floor(z * 100) / 100));
}

/** Horizontal padding of the immersive page wrapper (sm:px-4 on both sides). */
const PAGE_PAD_X = 32;

/** Unzoomed layout width so a `zoom`-scaled column spans the full viewport width. */
export function fullscreenColumnPx(vw: number, zoom: number): number {
  if (vw <= 0 || zoom <= 0) return 0;
  return Math.floor((vw - PAGE_PAD_X) / zoom);
}

/** The board's main three.js (R3F) canvas: the largest one, at least half the column wide. */
function mainR3fCanvas(root: HTMLElement): HTMLCanvasElement | null {
  const minW = root.getBoundingClientRect().width * 0.5;
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const c of root.querySelectorAll("canvas")) {
    // R3F wraps its canvas in a `width:100%;height:100%` div — 2D canvases with fixed pixel sizes are left alone.
    if (c.parentElement?.style.height !== "100%") continue;
    const r = c.getBoundingClientRect();
    if (r.width < minW || r.height < 120) continue;
    if (r.width * r.height > bestArea) {
      bestArea = r.width * r.height;
      best = c;
    }
  }
  return best;
}

/**
 * Every wrapper between the canvas and the column. Frames are fixed-height
 * (h-[440px]…) and often hold the canvas in an absolutely positioned layer,
 * so growing only the canvas's direct box wouldn't move the frame; growing
 * the whole chain by the same amount keeps HUD overlays at their size.
 */
function ancestorChain(canvas: HTMLCanvasElement, root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let n = canvas.parentElement; n && n !== root; n = n.parentElement) out.push(n);
  return out;
}

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const fsElement = () => document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;

export function useGameFullscreen(basePx: number) {
  const [full, setFull] = useState(false);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [hasCanvas, setHasCanvas] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef(false);

  // Hide the site chrome (CSS in globals.css keys off this attribute).
  useEffect(() => {
    const root = document.documentElement;
    if (full) root.dataset.gameFull = "1";
    else delete root.dataset.gameFull;
    return () => {
      delete root.dataset.gameFull;
    };
  }, [full]);

  // Native fullscreen left via Esc / system gesture → leave immersive too.
  useEffect(() => {
    const on = () => {
      const el = fsElement();
      if (el) {
        if (el === document.documentElement) nativeRef.current = true;
        return; // a game's own stage fullscreen nested inside ours
      }
      if (nativeRef.current) {
        nativeRef.current = false;
        setFull(false);
      }
    };
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
    };
  }, []);

  // Track the viewport while immersive.
  useEffect(() => {
    if (!full) return;
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
    };
  }, [full]);

  // Canvas boards (3D/2D canvas) aren't zoomed — watch for one appearing (e.g. a 2D⇄3D toggle).
  useEffect(() => {
    const el = contentRef.current;
    if (!full || !el) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      setHasCanvas(!!el.querySelector("canvas"));
    };
    check();
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(check);
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [full]);

  // 3D boards sit in fixed-height frames (h-[440px] etc., per game). In
  // fullscreen, grow the main R3F canvas's frame by the empty space left
  // under the page so the 3D view fills the monitor's height too.
  useEffect(() => {
    const el = contentRef.current;
    if (!full || !hasCanvas || !el) return;
    let grown: { node: HTMLElement; prev: string }[] = [];
    const reset = () => {
      for (const g of grown) g.node.style.height = g.prev;
      grown = [];
    };
    const apply = () => {
      reset();
      const target = mainR3fCanvas(el);
      if (!target) return;
      // Empty space under the page column (documentElement.scrollHeight never drops below the viewport, so measure the column itself).
      const frame = el.parentElement ?? el;
      const extra = Math.floor(window.innerHeight - (frame.getBoundingClientRect().bottom + window.scrollY) - 4);
      if (extra < 24) return;
      const chain = ancestorChain(target, el).map((node) => ({ node, h: node.getBoundingClientRect().height }));
      for (const { node, h } of chain) {
        grown.push({ node, prev: node.style.height });
        node.style.height = `${Math.round(h + extra)}px`;
      }
    };
    let raf = requestAnimationFrame(apply);
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      reset();
    };
  }, [full, hasCanvas]);

  // Leaving the page while fullscreen → hand the screen back.
  useEffect(
    () => () => {
      if (nativeRef.current && fsElement()) {
        nativeRef.current = false;
        void Promise.resolve(document.exitFullscreen?.()).catch(() => {});
      }
    },
    [],
  );

  const toggle = useCallback(() => {
    if (full) {
      setFull(false);
      if (fsElement()) {
        nativeRef.current = false;
        const d = document as FsDoc;
        void Promise.resolve(d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()).catch(() => {});
      }
      return;
    }
    setFull(true);
    const root = document.documentElement as FsEl;
    if (fsElement()) return;
    try {
      const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: "hide" }) : root.webkitRequestFullscreen?.();
      void Promise.resolve(p).catch(() => {}); // unsupported (iPhone) → CSS immersive only
    } catch {
      /* CSS immersive only */
    }
  }, [full]);

  const zoom = full ? fullscreenZoom(vp.w, vp.h, basePx) : 1;
  // Fill the whole monitor: canvas boards take the full width; DOM boards are
  // scaled up by `zoom` AND their layout column widens to the remaining width
  // (vw / zoom), so wide screens don't leave empty side margins.
  const contentStyle: CSSProperties | undefined = !full
    ? undefined
    : hasCanvas || zoom === 1
      ? { width: "100%", maxWidth: "none" }
      : { width: `${fullscreenColumnPx(vp.w, zoom)}px`, maxWidth: "none", marginInline: "auto", zoom };

  return { full, toggle, contentRef, contentStyle, zoom: hasCanvas ? 1 : zoom };
}

export function GameFullscreenButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={full}
      aria-label={full ? "전체화면 끝내기" : "전체화면"}
      title={full ? "전체화면 끝내기 (Esc)" : "화면에 꽉 차게 보기"}
      className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-white/15 px-3 text-xs font-semibold text-white/75 transition hover:border-white/35 hover:text-white light:border-slate-300 light:text-slate-600 light:hover:border-slate-400 light:hover:text-slate-900"
    >
      <span aria-hidden>{full ? "↙" : "⛶"}</span>
      <span className="hidden sm:inline">{full ? "작게" : "전체화면"}</span>
    </button>
  );
}
