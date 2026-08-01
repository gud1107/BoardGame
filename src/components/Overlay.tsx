"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Rendered via a portal into document.body. Without this, a `fixed`
 * overlay nested under an ancestor with `backdrop-filter` (our sticky
 * header uses `backdrop-blur`) gets its containing block redefined to
 * that ancestor per the CSS spec, so it renders clipped to the header's
 * tiny box instead of covering the viewport.
 */
export default function Overlay({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  // Callers only ever render this after a user interaction (button click
  // opening a modal), never during SSR, so `document` is always available
  // by the time this actually mounts — no need for an effect-based guard.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div
        className={`max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-[#151022] p-5 shadow-2xl sm:rounded-2xl sm:p-6 ${
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
