import Image from "next/image";
import { CasinoTileArt, CASINO_THEME_NAMES } from "./CasinoEmblem";
import type { CasinoNumber } from "./engine";

/**
 * Real photo backgrounds for all 6 casino mats — supersedes
 * `CasinoEmblem.tsx`'s original-illustration-only approach for this game
 * (2026-08-23 "실제 이미지 에셋 전면 교체" request). `CasinoEmblem.tsx`'s own
 * header comment documents *why* the previous session deliberately avoided
 * this (the reference photos are real, trademarked Las Vegas Strip casinos,
 * not the physical Las Vegas board game's own artwork) — this file exists
 * because the user was shown that exact tradeoff and explicitly chose to use
 * the real photos anyway, accepting the licensing risk for this personal
 * project.
 *
 * Casino 2 (Caesars Palace)'s only supplied reference photo
 * (`boardGameRule/라스베가스/시저스 팰리스2.jpg`) carries a visible tiled
 * "123RF" stock-photo watermark. An earlier ask to remove/clone out that
 * watermark (to disguise the unlicensed image as clean) was declined — that
 * crosses from "use a real photo, at your own risk" into actively defeating
 * the mechanism that signals the photo isn't licensed. The user then
 * clarified this is a test/private build and explicitly asked to use the
 * photo *as-is, watermark visible* rather than skip casino 2 — a materially
 * different, reasonable ask (nothing is hidden or disguised), so casino 2
 * now renders the same as the other 5, watermark and all. `CasinoTileArt`'s
 * original SVG fallback stays wired below purely as a defensive default for
 * any future casino number without a synced photo.
 *
 * Files live in `public/images/lasVegas/`, copied verbatim (no crop/edit)
 * from the matching `boardGameRule/라스베가스/*` source — same "sync real
 * photos into `public/images/<game>/`" convention as
 * `forSale/CardArt.tsx`.
 */
const CASINO_PHOTOS: Partial<Record<CasinoNumber, string>> = {
  1: "/images/lasVegas/casino-1-gold-nugget.jpg",
  2: "/images/lasVegas/casino-2-caesars-palace.jpg",
  3: "/images/lasVegas/casino-3-mirage.png",
  4: "/images/lasVegas/casino-4-sahara.jpg",
  5: "/images/lasVegas/casino-5-luxor.avif",
  6: "/images/lasVegas/casino-6-circus-circus.jpg",
};

/**
 * Fills its container (meant for the same `relative aspect-[3/4]` wrapper
 * `CasinoTileArt` was designed for) with the real casino photo via
 * `fill` + `object-cover`, or falls back to the original SVG scene if a
 * casino has no synced photo (see module doc above).
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
