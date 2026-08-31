/**
 * Pure presentation data + visuals for 포세일 — no game logic. Shared between
 * `ForSaleBoard.tsx` and `ForSaleEffects.tsx` so both render the same card
 * identity (same split as coyote/dalmuti's `CardArt.tsx`).
 *
 * Real card-art photos synced from `boardGameRule/포세일/` into
 * `public/images/for-sale/` (see HANDOFF.md for the crop pipeline): the
 * 10x3 property-card contact sheet (`포세일카드.jpg`) was sliced into 30
 * individual per-number files, each of the 30 boxes measured from the actual
 * photo (per-row column runs + per-row y-bands, via a luminance-threshold
 * scan) so every crop is exactly one full card, border to border, at a clean
 * 70x106px portrait aspect that matches `PropertyCard`'s box ratio — these
 * are unaffected by the bug below and stay photo-based.
 *
 * `CheckCard` and `CoinChip` used to be built the same way, layering our own
 * text over a shared photo crop (`check-texture.jpg` / `coin-1000.png` /
 * `coin-2000.png`). Those source photos turned out too small and the wrong
 * aspect ratio for where they render — `check-texture.jpg` is a 44x82
 * portrait crop stretched via `object-cover` into a ~96x64 landscape card
 * box, so `object-cover` throws away most of its width and blows up a thin
 * vertical sliver to fill the box, producing the blurry "broken-looking"
 * vertical striping reported in
 * `boardGameRule/포세일/돈이깨져서나오는현상.png` (not a 404 — the file
 * loads fine, it's just badly undersized for the box). The 58x58 coin PNGs
 * have the same undersized-source problem at their largest render size (36px
 * for `size="lg"`, upscaled from a 58px source isn't the issue — it's that
 * 58px itself is soft/JPEG-artifacted at that DPI). Fix: both are now drawn
 * as pure CSS/SVG vector shapes — resolution-independent, so they're always
 * crisp regardless of render size, and there's no external file for a build
 * or network hiccup to fail to load. The two coin PNGs and check-texture.jpg
 * are unused now and can be deleted from `public/images/for-sale/` in a
 * follow-up asset-cleanup pass.
 */
import Image from "next/image";

/** Tier accent (border/ring color only — the card face itself is now a photo) by property number, "1번 판잣집 ~ 30번 우주기지" (task brief §1 flavor names, kept for `title`). */
function propertyTier(value: number): { label: string; border: string; ring: string } {
  if (value >= 30) return { label: "우주기지", border: "border-indigo-300/60", ring: "rgba(129,140,248,0.85)" };
  if (value >= 26) return { label: "고층 타워", border: "border-purple-300/50", ring: "rgba(216,180,254,0.8)" };
  if (value >= 21) return { label: "대저택", border: "border-amber-300/50", ring: "rgba(252,211,77,0.8)" };
  if (value >= 16) return { label: "빌딩", border: "border-sky-300/50", ring: "rgba(125,211,252,0.8)" };
  if (value >= 11) return { label: "전원주택", border: "border-emerald-300/50", ring: "rgba(110,231,183,0.8)" };
  if (value >= 6) return { label: "주택", border: "border-lime-300/40", ring: "rgba(190,242,100,0.75)" };
  return { label: "판잣집", border: "border-orange-200/30", ring: "rgba(254,215,170,0.7)" };
}

export function propertyImageSrc(value: number): string {
  return `/images/for-sale/properties/${value}.jpg`;
}

/**
 * A property card face. `value === null` renders the face-down back (used
 * while a Phase-2 submission is still hidden from other seats — see
 * engine.ts's `getPlayerView`).
 */
export function PropertyCard({
  value,
  className = "",
  highlight = false,
  size = "md",
}: {
  value: number | null;
  className?: string;
  highlight?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "h-16 w-11" : size === "lg" ? "h-28 w-20" : "h-20 w-14";
  const imgPx = size === "lg" ? 120 : size === "sm" ? 64 : 80;
  if (value === null) {
    return (
      <div
        className={`relative flex ${dims} shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/25 bg-gradient-to-br from-sky-950 to-black ${className}`}
      >
        <span className="text-lg opacity-60">🏠</span>
      </div>
    );
  }
  const t = propertyTier(value);
  return (
    <div
      title={`${value}번 ${t.label}`}
      className={`relative flex ${dims} shrink-0 overflow-hidden rounded-lg border bg-black transition ${t.border} ${className}`}
      style={highlight ? { boxShadow: `0 0 14px -2px ${t.ring}`, outline: `2px solid ${t.ring}`, outlineOffset: "-1px" } : undefined}
    >
      <Image src={propertyImageSrc(value)} alt={`${value}번 ${t.label}`} width={imgPx} height={imgPx} className="h-full w-full object-cover" />
    </div>
  );
}

export function formatDollars(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

/** Tier accent for a check's face value — same green-scales-with-value read as before, now the corner-text and guilloché-pattern color over a pure-CSS bank-note gradient instead of a stretched photo. */
function checkTierAccent(value: number): { text: string; from: string; via: string; to: string; pattern: string } {
  if (value >= 12000) return { text: "#bbf7d0", from: "#0f3d2e", via: "#155e3f", to: "#0a2b21", pattern: "rgba(187,247,208,0.10)" };
  if (value >= 6000) return { text: "#a7f3d0", from: "#0d3a34", via: "#0f5e4f", to: "#082a25", pattern: "rgba(167,243,208,0.10)" };
  if (value <= 0) return { text: "#d4d4d8", from: "#27272a", via: "#3f3f46", to: "#18181b", pattern: "rgba(212,212,216,0.08)" };
  return { text: "#86efac", from: "#0c332a", via: "#134e3a", to: "#071f19", pattern: "rgba(134,239,172,0.10)" };
}

/**
 * A check card face — a pure CSS/SVG bank-note design (no external photo, so
 * it's always crisp and never fails to load): a diagonal green/teal gradient
 * base, a fine repeating-diagonal-line "guilloché" security pattern layered
 * on top (the wavy engraved lines real banknotes use to resist copying), a
 * double border to read as a certificate/check rather than a flat card, a
 * large faint "$" watermark centered behind the text, and the face value
 * printed bold in the two corners real checks repeat it in (top-left amount
 * box + bottom-right written-amount line) — see HANDOFF.md for why that
 * dual-corner layout was kept over a single centered value.
 * `value === null` renders a face-down back (bank deck placeholder).
 */
export function CheckCard({
  value,
  className = "",
  size = "md",
}: {
  value: number | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "h-14 w-20" : size === "lg" ? "h-20 w-32" : "h-16 w-24";
  const textSize = size === "lg" ? "text-lg" : size === "sm" ? "text-xs" : "text-sm";
  const dollarSize = size === "lg" ? "text-4xl" : size === "sm" ? "text-2xl" : "text-3xl";
  if (value === null) {
    return (
      <div className={`relative flex ${dims} shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/25 bg-gradient-to-br from-emerald-950 to-black ${className}`}>
        <span className="text-lg opacity-60">🧾</span>
      </div>
    );
  }
  const t = checkTierAccent(value);
  return (
    <div
      className={`relative flex ${dims} shrink-0 overflow-hidden rounded-lg border-double border-4 ${className}`}
      style={{
        borderColor: `${t.text}55`,
        background: [
          // fine diagonal "guilloché" security-line texture, tiled on top of the base gradient
          `repeating-linear-gradient(45deg, ${t.pattern} 0 1px, transparent 1px 5px)`,
          `repeating-linear-gradient(-45deg, ${t.pattern} 0 1px, transparent 1px 5px)`,
          `linear-gradient(135deg, ${t.from} 0%, ${t.via} 55%, ${t.to} 100%)`,
        ].join(", "),
      }}
    >
      {/* centered watermark, like a check's faint printed seal */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 flex items-center justify-center font-black ${dollarSize}`}
        style={{ color: t.text, opacity: 0.16 }}
      >
        $
      </span>
      <span
        className={`absolute top-0.5 left-1 leading-none font-black tracking-tight whitespace-nowrap drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${textSize} ${
          value <= 0 ? "opacity-70" : ""
        }`}
        style={{ color: t.text }}
      >
        {formatDollars(value)}
      </span>
      <span
        className={`absolute right-1 bottom-0.5 leading-none font-black tracking-tight whitespace-nowrap drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${textSize} ${
          value <= 0 ? "opacity-70" : ""
        }`}
        style={{ color: t.text }}
      >
        {formatDollars(value)}
      </span>
    </div>
  );
}

/**
 * A single cash coin chip — $1,000 (silver) or $2,000 (gold), matching the
 * two physical denominations in the rulebook (§2). Drawn as a pure inline
 * SVG (radial metallic gradient body + dashed poker-chip edge ring + bold
 * denomination glyph) instead of a photo, so it stays crisp — vector, not
 * upscaled from a raster source — at every render size from the tiny `sm`
 * cash-breakdown badge up to the `lg` bidding-pot-flight FX icon. Used for
 * the bidding-pot flight FX and the leftover-cash breakdown in the
 * scoreboard.
 */
export function CoinChip({ value, size = "md", className = "" }: { value: 1000 | 2000; size?: "sm" | "md" | "lg"; className?: string }) {
  const dims = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-9 w-9" : "h-6 w-6";
  const isGold = value === 2000;
  const gradId = `forsale-coin-${value}`;
  // face-value glyph: "1K"/"2K" at md/lg (legible enough at 24-36px), bare "$" at sm (16px has no room for two glyphs).
  const label = size === "sm" ? "$" : value === 1000 ? "1K" : "2K";
  const labelFontSize = size === "sm" ? 11 : label.length > 1 ? 15 : 18;
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label={`${formatDollars(value)} 코인`}
      className={`${dims} shrink-0 aspect-square drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] ${className}`}
    >
      <defs>
        <radialGradient id={gradId} cx="35%" cy="30%" r="75%">
          {isGold ? (
            <>
              <stop offset="0%" stopColor="#fef9c3" />
              <stop offset="45%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#92400e" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="45%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#475569" />
            </>
          )}
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill={`url(#${gradId})`} stroke={isGold ? "#78350f" : "#334155"} strokeWidth="1" />
      <circle
        cx="20"
        cy="20"
        r="14.5"
        fill="none"
        stroke={isGold ? "#fde68a" : "#f1f5f9"}
        strokeOpacity="0.85"
        strokeWidth="1.5"
        strokeDasharray="3 3.2"
      />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={labelFontSize}
        fontWeight={900}
        fill={isGold ? "#451a03" : "#1e293b"}
      >
        {label}
      </text>
    </svg>
  );
}

/** Greedily breaks a cash amount into the fewest $2,000/$1,000 chips (every amount in this engine is a $1,000 multiple — bids, refunds, and starting cash all are, per engine.ts). Purely for the visual coin stack; never used for game math. */
export function coinBreakdown(amount: number): { value: 1000 | 2000; count: number }[] {
  const safe = Math.max(0, Math.round(amount / 1000)) * 1000;
  const twoThousands = Math.floor(safe / 2000);
  const remainder = safe - twoThousands * 2000;
  const chips: { value: 1000 | 2000; count: number }[] = [];
  if (twoThousands > 0) chips.push({ value: 2000, count: twoThousands });
  if (remainder > 0) chips.push({ value: 1000, count: remainder / 1000 });
  return chips;
}
