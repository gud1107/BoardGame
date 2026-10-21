"use client";

import { useState } from "react";

/**
 * Painted-portrait layer for a card face (Coup / Avalon / Dalmuti oil-portrait
 * art, generated offline and stored under `public/images/<game>/`). Returns
 * `show: false` and no element when the game has no art for this card yet or
 * the file fails to load, so the caller keeps rendering its emoji face —
 * every card stays readable even if an image 404s on a stale deploy.
 *
 * Numbers, names and symbols are always overlaid by the caller in code: the
 * generator draws garbled text, so the art itself carries no game info.
 */
export function usePortrait(src: string | undefined, focusY = "18%") {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const show = !!src && failedSrc !== src;
  const img = show ? (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static card art, next/image adds nothing here
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setFailedSrc(src)}
      className="pointer-events-none absolute inset-0 h-full w-full object-cover select-none"
      style={{ objectPosition: `center ${focusY}` }}
    />
  ) : null;
  return { show, img };
}
