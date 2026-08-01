"use client";

import { useState, type ReactNode } from "react";

/**
 * Hover shows it on desktop via plain CSS (`group-hover`); tap toggles it on
 * mobile via React state. These two triggers are kept independent on
 * purpose — a real mouse click fires `mouseenter` immediately before
 * `click`, so driving both off the same boolean made a click flip it
 * open-then-closed in the same tick, and it never visibly appeared.
 * Deliberately does NOT stop click propagation — several callers wrap an
 * already-interactive element (e.g. a selectable card button), and
 * swallowing the click there would silently break selection.
 */
export default function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [tapOpen, setTapOpen] = useState(false);

  return (
    <span className="group relative inline-flex" onClick={() => setTapOpen((o) => !o)}>
      {children}
      <span
        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[190px] -translate-x-1/2 rounded-lg bg-black/90 px-2.5 py-1.5 text-center text-[11px] leading-snug text-white shadow-lg transition-opacity duration-150 group-hover:opacity-100 ${
          tapOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
