import Image from "next/image";
import { CasinoTileArt, CASINO_THEME_NAMES } from "./CasinoEmblem";
import type { CasinoNumber } from "./engine";

/**
 * Real photo backgrounds for 5 of the 6 casino mats — supersedes
 * `CasinoEmblem.tsx`'s original-illustration-only approach for this game
 * (2026-08-23 "실제 이미지 에셋 전면 교체" request). `CasinoEmblem.tsx`'s own
 * header comment documents *why* the previous session deliberately avoided
 * this (the reference photos are real, trademarked Las Vegas Strip casinos,
 * not the physical Las Vegas board game's own artwork) — this file exists
 * because the user was shown that exact tradeoff and explicitly chose to use
 * the real photos anyway, accepting the licensing risk for this personal
 * project. That decision is scoped to *these 5 files only*:
 *
 * Casino 2 (Caesars Palace) is deliberately excluded — its only supplied
 * reference photo (`boardGameRule/라스베가스/시저스 팰리스2.jpg`) carries a
 * visible tiled "123RF" stock-photo watermark. Removing/cloning out a stock
 * agency's watermark to disguise an unlicensed image as clean was declined
 * (that crosses from "use a real photo, at your own risk" into actively
 * defeating the mechanism that signals the photo isn't licensed — a
 * meaningfully different ask). So casino 2 still falls back to
 * `CasinoTileArt`'s original SVG illustration below, same as before this
 * change; swap in a clean, unwatermarked Caesars Palace photo (dropped into
 * `boardGameRule/라스베가스/` and `public/images/lasVegas/`) any time to light
 * it up like the other 5.
 *
 * Files live in `public/images/lasVegas/`, copied verbatim (no crop/edit)
 * from the matching `boardGameRule/라스베가스/*` source — same "sync real
 * photos into `public/images/<game>/`" convention as
 * `forSale/CardArt.tsx`.
 */
const CASINO_PHOTOS: Partial<Record<CasinoNumber, string>> = {
  1: "/images/lasVegas/casino-1-gold-nugget.jpg",
  3: "/images/lasVegas/casino-3-mirage.png",
  4: "/images/lasVegas/casino-4-sahara.jpg",
  5: "/images/lasVegas/casino-5-luxor.avif",
  6: "/images/lasVegas/casino-6-circus-circus.jpg",
};

/**
 * Fills its container (meant for the same `relative aspect-[3/4]` wrapper
 * `CasinoTileArt` was designed for) with the real casino photo via
 * `fill` + `object-cover`, or falls back to the original SVG scene for
 * casino 2 (see module doc above).
 */
export function CasinoMatArt({ casino, className = "" }: { casino: CasinoNumber; className?: string }) {
  const src = CASINO_PHOTOS[casino];
  if (!src) return <CasinoTileArt casino={casino} className={className} />;
  const label = `${CASINO_THEME_NAMES[casino].ko} (카지노 ${casino}) 실사 매트`;
  return (
    <Image
      src={src}
      alt={label}
      fill
      sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 16vw"
      className={`object-cover ${className}`}
      priority={false}
    />
  );
}
