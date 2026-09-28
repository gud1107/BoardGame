import Image from "next/image";
import { CasinoTileArt, CASINO_THEME_NAMES } from "./CasinoEmblem";
import type { CasinoNumber } from "./engine";

/**
 * Real-photo backgrounds for the casinos that have a *license-free* match
 * (2026-09-28): only CC0 / public-domain Wikimedia Commons photos of generic,
 * sign-free subjects (a ruin, a volcano, a monument) that fit the fictional
 * casino themes. Casinos without such a photo fall back to the original Art
 * Deco SVG (`CasinoTileArt`) until a good one is found.
 *
 * History: an earlier version of this file showed photos of real Las Vegas
 * Strip casinos (one an unlicensed, watermarked stock image) under their
 * trademarked names; that was removed. Don't reintroduce real casino photos,
 * names, signage, or anything not CC0/public domain — even a free-licensed
 * photo doesn't clear trademarks visible in it. Record every photo's source
 * below and in CREDITS.md.
 */
const CASINO_PHOTOS: Partial<Record<CasinoNumber, { src: string; position: string; source: string }>> = {
  // CC0 — "Colonnade Parthenon Acropolis, Athens, Greece.jpg" by Jebulon
  2: {
    src: "/images/lasVegas/casino-2-temple.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Colonnade_Parthenon_Acropolis,_Athens,_Greece.jpg",
  },
  // Public domain (US government work, CIA) — "Arenal Volcano, Costa Rica.jpg"
  3: {
    src: "/images/lasVegas/casino-3-volcano.jpg",
    position: "50% 40%",
    source: "https://commons.wikimedia.org/wiki/File:Arenal_Volcano,_Costa_Rica.jpg",
  },
  // CC0 — "Taj Mahal 2018.jpg" by Almbauer
  4: {
    src: "/images/lasVegas/casino-4-palace.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Taj_Mahal_2018.jpg",
  },
};

/**
 * Fills its `relative aspect-[3/4]` container with the casino's photo
 * (`fill` + `object-cover`), or the original SVG scene when there is none.
 */
export function CasinoMatArt({ casino, className = "" }: { casino: CasinoNumber; className?: string }) {
  const photo = CASINO_PHOTOS[casino];
  if (!photo) return <CasinoTileArt casino={casino} className={className} />;
  return (
    <Image
      src={photo.src}
      alt={`${CASINO_THEME_NAMES[casino].ko} (카지노 ${casino})`}
      fill
      sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 16vw"
      className={`object-cover ${className}`}
      style={{ objectPosition: photo.position }}
    />
  );
}
