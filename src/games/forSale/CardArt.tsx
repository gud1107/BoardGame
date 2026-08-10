/**
 * Pure presentation data + visuals for 포세일 — no game logic. Shared between
 * `ForSaleBoard.tsx` and `ForSaleEffects.tsx` so both render the same card
 * identity (same split as coyote/dalmuti's `CardArt.tsx`).
 *
 * Real card-art photos synced from `boardGameRule/포세일/` into
 * `public/images/for-sale/` (see HANDOFF.md for the crop pipeline): the
 * 10x3 property-card contact sheet (`포세일카드.jpg`) was sliced into 30
 * individual per-number files, and the check/coin reference photo
 * (`포세일돈과 카드.jpg`) yielded a reusable check-card parchment texture
 * (cropped tight around the center "$" seal so no single baked-in face value
 * bleeds through — every check value is rendered as our own text over that
 * shared texture, same reasoning as `formatDollars` already being the single
 * source for check labels) plus one $1,000 (silver) and one $2,000 (gold)
 * coin chip photo. The 30 per-cell boxes are NOT a naive equal 80x120.33px
 * grid (the contact sheet has uneven gaps between cards, so that naive
 * division bled ~15-20px of the neighboring card into every crop — the bug
 * behind the cropped/blended card faces seen in-app); each of the 30 boxes
 * was instead measured from the actual photo (per-row column runs + per-row
 * y-bands, via a luminance-threshold scan) so every crop is exactly one full
 * card, border to border. Property faces already carry their own printed index
 * corners like every other photographed deck in this project (see love
 * letter's `CardArt.tsx` doc), so no redundant number is drawn on top of
 * them — only checks (whose texture is deliberately number-free) and coins
 * need a text/tier overlay drawn here.
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

/** Tier accent for a check's face value — same green-scales-with-value read as before, now drawn as a corner ribbon over the shared parchment photo instead of the whole background. */
function checkTierAccent(value: number): string {
  if (value >= 12000) return "#4ade80";
  if (value >= 6000) return "#34d399";
  if (value <= 0) return "#71717a";
  return "#22c55e";
}

/** A check card face. `value === null` renders a face-down back (bank deck placeholder). */
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
  const imgPx = size === "lg" ? 160 : size === "sm" ? 100 : 120;
  if (value === null) {
    return (
      <div className={`relative flex ${dims} shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/25 bg-gradient-to-br from-emerald-950 to-black ${className}`}>
        <span className="text-lg opacity-60">🧾</span>
      </div>
    );
  }
  const accent = checkTierAccent(value);
  return (
    <div className={`relative flex ${dims} shrink-0 overflow-hidden rounded-lg border ${className}`} style={{ borderColor: `${accent}66` }}>
      <Image src="/images/for-sale/check-texture.jpg" alt="수표" width={imgPx} height={imgPx} className={`h-full w-full object-cover ${value <= 0 ? "opacity-50 grayscale" : ""}`} />
      <span
        className={`absolute top-0.5 left-1 leading-none font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${size === "lg" ? "text-lg" : size === "sm" ? "text-xs" : "text-sm"}`}
        style={{ color: accent }}
      >
        {formatDollars(value)}
      </span>
      <span
        className={`absolute right-1 bottom-0.5 leading-none font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${size === "lg" ? "text-lg" : size === "sm" ? "text-xs" : "text-sm"}`}
        style={{ color: accent }}
      >
        {formatDollars(value)}
      </span>
    </div>
  );
}

/**
 * A single cash coin chip — $1,000 (silver) or $2,000 (gold), matching the
 * two physical denominations in the rulebook (§2). Used for the bidding-pot
 * flight FX and the leftover-cash breakdown in the scoreboard.
 */
export function CoinChip({ value, size = "md", className = "" }: { value: 1000 | 2000; size?: "sm" | "md" | "lg"; className?: string }) {
  const dims = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-9 w-9" : "h-6 w-6";
  return (
    <Image
      src={value === 1000 ? "/images/for-sale/coin-1000.png" : "/images/for-sale/coin-2000.png"}
      alt={`${formatDollars(value)} 코인`}
      width={40}
      height={40}
      className={`${dims} shrink-0 rounded-full object-cover shadow-[0_1px_4px_rgba(0,0,0,0.6)] ${className}`}
    />
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
