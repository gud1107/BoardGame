/**
 * Decorative "trade route" illustration layer — pure inline SVG line-art
 * (same no-external-image-asset convention as ResourceIcon.tsx/boardChrome.tsx,
 * see their doc comments), added purely to move the market panels and card
 * faces away from a flat text/number look toward an "illustrated caravan
 * trading post" feel per the brief's ①. Two sizes:
 *
 * - `MarketBanner`: a wide, low-relief skyline strip sitting behind each
 *   market panel's header (point-card market gets a desert bazaar/oasis
 *   skyline, merchant-card market gets a camel caravan under a sun) — real
 *   estate is there for detail at that width.
 * - `CardWatermark`: a single small motif stamped faintly into one card
 *   face's corner (a jug for merchant cards, a trade-ship for point cards) —
 *   individual cards are far too small (≈50-90px) for a full scene, so this
 *   stays a single-glyph watermark at low opacity behind the card's own
 *   (fully opaque) numbers/icons, never competing with them for legibility.
 */

const GOLD = "#c9a15a";

export function MarketBanner({ variant }: { variant: "bazaar" | "caravan" }) {
  return (
    <svg
      viewBox="0 0 400 60"
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]"
      aria-hidden="true"
    >
      {variant === "bazaar" ? (
        <>
          {/* Desert oasis + bazaar skyline: sun, dune, domed market roofs, palm */}
          <circle cx="345" cy="14" r="11" fill={GOLD} />
          <path d="M0 52 Q60 34 130 50 T260 46 T400 52 V60 H0 Z" fill={GOLD} opacity="0.5" />
          <path d="M40 50 V26 a6 6 0 0 1 12 0 V50 Z" fill={GOLD} />
          <path d="M40 26 a6 6 0 0 1 12 0 Z" fill={GOLD} />
          <path d="M70 50 V20 a10 10 0 0 1 20 0 V50 Z" fill={GOLD} />
          <path d="M70 20 a10 10 0 0 1 20 0 Z" fill={GOLD} />
          <rect x="76" y="30" width="8" height="20" fill="none" />
          <path d="M110 50 V32 a5 5 0 0 1 10 0 V50 Z" fill={GOLD} />
          <path d="M110 32 a5 5 0 0 1 10 0 Z" fill={GOLD} />
          <path d="M200 50 V34 l6-8 6 8 v16 Z" fill={GOLD} />
          <path d="M296 50 c0-16 4-24 4-24s4 8 4 24Z" fill={GOLD} />
          <path d="M300 26 q10-2 8 8" stroke={GOLD} strokeWidth="2" fill="none" />
          <path d="M300 26 q-10-2 -8 8" stroke={GOLD} strokeWidth="2" fill="none" />
        </>
      ) : (
        <>
          {/* Camel caravan crossing dunes under a sun */}
          <circle cx="40" cy="14" r="10" fill={GOLD} />
          <path d="M0 52 Q80 32 180 50 T400 48 V60 H0 Z" fill={GOLD} opacity="0.5" />
          {[130, 200, 270].map((x, i) => (
            <g key={x} transform={`translate(${x} 0)`}>
              <path d={`M0 44 q4-14 10-14 q3 0 3 4 q0-4 4-4 q6 0 8 12`} stroke={GOLD} strokeWidth="2.4" fill="none" strokeLinecap="round" />
              <circle cx="1" cy="34" r="3" fill={GOLD} />
              <path d="M-3 46 l1 -5 M3 46 l1 -5 M9 46 l1 -5 M15 46 l1 -5" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
              {i === 1 && <path d="M-1 30 l-4 -6 M2 29 l1 -7" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" />}
            </g>
          ))}
        </>
      )}
    </svg>
  );
}

/** Small single-glyph watermark stamped into one corner of a card face — see module doc. */
export function CardWatermark({ kind }: { kind: "jug" | "ship" }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className="pointer-events-none absolute -right-1 -bottom-1 h-9 w-9 opacity-[0.14] sm:h-11 sm:w-11"
      aria-hidden="true"
    >
      {kind === "jug" ? (
        <path
          d="M16 4h8v4l3 4a6 6 0 0 1 1 3v18a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V15a6 6 0 0 1 1-3l3-4Z"
          fill="none"
          stroke="#5c3a12"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M4 26 L36 26 L30 34 H10 Z M20 26 V6 M20 8 L30 14 L20 18 Z"
          fill="none"
          stroke="#5c3a12"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
