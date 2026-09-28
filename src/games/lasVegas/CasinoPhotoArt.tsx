import Image from "next/image";
import { CasinoTileArt, CASINO_THEME_NAMES } from "./CasinoEmblem";
import type { CasinoNumber } from "./engine";

/**
 * Real-photo backgrounds for the six casinos (2026-09-28, "세련된 고급 카지노
 * 사진" 재요청 — casino-table close-ups, not scenery): only CC0 /
 * public-domain Wikimedia Commons photos with no brand marks in frame (chips
 * printed with a sportsbook logo and a deck stamped with its maker's seal were
 * rejected for that reason). Casino names in
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
  // Public domain — "Roulette-Tisch.jpg" by Sozi
  1: {
    src: "/images/lasVegas/casino-1-roulette.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Roulette-Tisch.jpg",
  },
  // CC0 — "Pile of Poker Chips.jpg" by Julian Lupyan
  2: {
    src: "/images/lasVegas/casino-2-chips.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Pile_of_Poker_Chips.jpg",
  },
  // Public domain — "Royal flush.JPG" by Wingchun1990 at English Wikipedia
  3: {
    src: "/images/lasVegas/casino-3-royal-flush.jpg",
    position: "20% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Royal_flush.JPG",
  },
  // CC0 — "Casino-3262947 1920.jpg" by Jonathan Petersson
  4: {
    src: "/images/lasVegas/casino-4-dice.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Casino-3262947_1920.jpg",
  },
  // CC0 — "Poker chips 2.jpg" by Jismab
  5: {
    src: "/images/lasVegas/casino-5-high-roller.jpg",
    position: "40% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Poker_chips_2.jpg",
  },
  // Public domain — "Casino Dice (11275288753).jpg" by davidgsteadman
  6: {
    src: "/images/lasVegas/casino-6-emerald.jpg",
    position: "75% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Casino_Dice_(11275288753).jpg",
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
