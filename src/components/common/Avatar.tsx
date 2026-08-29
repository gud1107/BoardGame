"use client";

import { DEFAULT_AVATAR } from "@/constants/avatar";

/**
 * Shared profile avatar — every place in the app that shows a player's
 * picture (site header, profile modal, account page, in-game player slots)
 * renders through this instead of a raw `<img>` so the fallback behavior
 * stays consistent everywhere:
 *  - no `src` (guest, or a logged-in user who never set a custom image)
 *    renders `DEFAULT_AVATAR` immediately;
 *  - a broken/expired `src` (deleted Storage object, bad external URL)
 *    swaps to `DEFAULT_AVATAR` on load failure via `onError`, exactly once —
 *    a plain `<img>` is used (not `next/image`) specifically so this
 *    imperative `currentTarget.src` swap works for arbitrary external URLs
 *    without needing every possible host allowlisted in `next.config.ts`.
 */
export default function Avatar({
  src,
  alt = "프로필 이미지",
  size = 40,
  className = "",
}: {
  src?: string | null;
  alt?: string;
  /** Pixel size of the (square) avatar. Default 40px. */
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- imperative onError fallback (see comment above) needs a plain <img>.
    <img
      src={src || DEFAULT_AVATAR}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`rounded-full border border-white/20 object-cover ${className}`}
      onError={(e) => {
        if (e.currentTarget.src.endsWith(DEFAULT_AVATAR)) return; // already showing the fallback — avoid an error loop
        e.currentTarget.src = DEFAULT_AVATAR;
      }}
    />
  );
}
