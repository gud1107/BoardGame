import Image from "next/image";
import { CasinoTileArt, CASINO_THEME_NAMES } from "./CasinoEmblem";
import type { CasinoNumber } from "./engine";

/**
 * Real-photo backgrounds for the six casinos (2026-09-28, "고급스럽고 누구나
 * 가지고 싶은" 재요청): only CC0 / public-domain Wikimedia Commons photos of
 * aspirational, sign-free subjects (palace chandelier, superyacht, overwater
 * villas, Hall of Mirrors, Santorini at dusk, champagne) — casino names in
 * `CASINO_THEME_NAMES` follow these photos. Casinos without such a photo fall back to the original Art
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
  // CC0 — "Chandelier of the Crystal Staircase, Dolmabahçe Palace" by Julian Lupyan
  1: {
    src: "/images/lasVegas/casino-1-chandelier.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Chandelier_of_the_Crystal_Staircase,_Dolmabah%C3%A7e_Palace,_Istanbul.jpg",
  },
  // CC0 — "Samsara Yacht.jpg" by Davidley
  2: {
    src: "/images/lasVegas/casino-2-yacht.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Samsara_Yacht.jpg",
  },
  // CC0 — "Boathouse neighborhood (Unsplash).jpg" by Ishan @seefromthesky
  3: {
    src: "/images/lasVegas/casino-3-lagoon.jpg",
    position: "55% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Boathouse_neighborhood_(Unsplash).jpg",
  },
  // CC0 — "Palace of Versailles Hall of Mirrors (27738100023).jpg" by Gary Todd
  4: {
    src: "/images/lasVegas/casino-4-mirrors.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Palace_of_Versailles_Hall_of_Mirrors_(27738100023).jpg",
  },
  // CC0 — "Santorini Sunset (26536503).jpeg" by Reid Gower
  5: {
    src: "/images/lasVegas/casino-5-santorini.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Santorini_Sunset_(26536503).jpeg",
  },
  // CC0 — "Champagne-glasses-1940262 1920.jpg" by Myriam Zilles
  6: {
    src: "/images/lasVegas/casino-6-champagne.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Champagne-glasses-1940262_1920.jpg",
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
