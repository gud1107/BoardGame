"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import DragHandle from "@/components/common/DragHandle";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

/**
 * Rendered via a portal into document.body. Without this, a `fixed`
 * overlay nested under an ancestor with `backdrop-filter` (our sticky
 * header uses `backdrop-blur`) gets its containing block redefined to
 * that ancestor per the CSS spec, so it renders clipped to the header's
 * tiny box instead of covering the viewport.
 *
 * Below `sm` (640px) this renders as a bottom sheet — drag handle, swipe
 * down to close (`useSwipeToDismiss`), tap the backdrop to close. At `sm`
 * and up it's the original centered modal (no drag, no backdrop-close
 * regression there since desktop always had the × as its only affordance).
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
  const { dragY, dragging, handlers } = useSwipeToDismiss(onClose);

  // Callers only ever render this after a user interaction (button click
  // opening a modal), never during SSR, so `document` is always available
  // by the time this actually mounts — no need for an effect-based guard.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 200ms ease-out" }}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#151022] shadow-2xl sm:rounded-2xl ${
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        }`}
      >
        {/* Drag zone: handle + header only, so a swipe started over scrollable
            body content below scrolls it instead of fighting the dismiss gesture. */}
        <div {...handlers} className="shrink-0 px-5 pt-5 sm:px-6 sm:pt-6">
          <DragHandle />
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="-mr-2 grid h-12 w-12 place-items-center rounded-full text-xl text-white/50 transition hover:bg-white/10 hover:text-white active:bg-white/20"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
