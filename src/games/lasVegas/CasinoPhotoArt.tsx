import Image from "next/image";
import { CasinoTileArt, CASINO_THEME_NAMES } from "./CasinoEmblem";
import type { CasinoNumber } from "./engine";

/**
 * Real-photo backgrounds for the six casinos (2026-09-28, "부동산·주식 투자
 * 같은 고급스럽고 화려한 대형 건물" 재요청): night skylines and glass towers,
 * only CC0 / public-domain Wikimedia Commons photos with no legible corporate
 * logo in frame (a Singapore shot with a lit bank logo and a Frankfurt shot
 * with a bank's rooftop logo were rejected for that reason). Casino names in
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
  // CC0 — "City of lights (Unsplash).jpg" by Luca Bravo lucabravo
  1: {
    src: "/images/lasVegas/casino-1-manhattan.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:City_of_lights_(Unsplash).jpg",
  },
  // CC0 — "Victoria Harbour skyscrapers.jpg" by Wilfredor
  2: {
    src: "/images/lasVegas/casino-2-harbour.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Victoria_Harbour_skyscrapers.jpg",
  },
  // CC0 — "Glass london skyscrapers (Unsplash).jpg" by Samuel Zeller samuelzeller
  3: {
    src: "/images/lasVegas/casino-3-crystal-tower.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Glass_london_skyscrapers_(Unsplash).jpg",
  },
  // CC0 — "Curved skyscraper in sun (Unsplash).jpg" by Scott Webb scottwebb
  4: {
    src: "/images/lasVegas/casino-4-golden-curve.jpg",
    position: "15% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Curved_skyscraper_in_sun_(Unsplash).jpg",
  },
  // CC0 — "Best City in the World (Unsplash).jpg" by Matt Lamers lamerbrain
  5: {
    src: "/images/lasVegas/casino-5-sunset-skyline.jpg",
    position: "55% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Best_City_in_the_World_(Unsplash).jpg",
  },
  // CC0 — "Hong Kong skyscrapers in a night of typhoon.jpg" by Wilfredor
  6: {
    src: "/images/lasVegas/casino-6-harbourfront.jpg",
    position: "50% 50%",
    source: "https://commons.wikimedia.org/wiki/File:Hong_Kong_skyscrapers_in_a_night_of_typhoon.jpg",
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
