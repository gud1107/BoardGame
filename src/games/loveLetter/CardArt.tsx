import Image from "next/image";
import { CARD_NAMES, type Card, type CardNumber } from "./engine";

/**
 * Presentational card-face building blocks shared by `LoveLetterBoard.tsx`
 * and `LoveLetterEffects.tsx` — no game logic here (same split as
 * summonersRift's assets.ts/CardArt.tsx, dalmuti's CardArt.tsx).
 *
 * Real card-art photos synced from `boardGameRule/러브레터/` (the official
 * AEG/Magpie Korean edition's scanned card faces, one full illustration per
 * character 1~8) into `public/images/love-letter/`. Every face already has
 * its number, name, and effect text baked into the photo itself, so — same
 * lesson as summonersRift's `ItemSlot` doc — no redundant caption is drawn
 * on top; `CardFace` only ever adds a thin highlight ring for "this is the
 * legal one" affordances. No card-back photo was provided, so the face-down
 * back is a pure-CSS wax-seal love-letter motif instead.
 */
export const CARD_IMAGES: Record<CardNumber, string> = {
  1: "/images/love-letter/1-guard.jpg",
  2: "/images/love-letter/2-priest.jpg",
  3: "/images/love-letter/3-baron.jpg",
  4: "/images/love-letter/4-handmaid.jpg",
  5: "/images/love-letter/5-prince.jpg",
  6: "/images/love-letter/6-king.jpg",
  7: "/images/love-letter/7-countess.jpg",
  8: "/images/love-letter/8-princess.jpg",
};

const DIMS: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "h-12 w-8",
  sm: "h-20 w-14",
  md: "h-28 w-20",
  lg: "h-40 w-28",
};

/** Face-down card back — no back photo exists in the source folder (see module doc). Used for hidden hands, the draw pile, and the burned reserve card. */
export function CardBack({ size = "md", className = "" }: { size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border ${DIMS[size]} ${className}`}
      style={{
        borderColor: "rgba(244,114,182,0.4)",
        background: "linear-gradient(155deg,#4a1030 0%,#2a0a1c 55%,#12040c 100%)",
      }}
    >
      <div className="absolute inset-1 rounded-md border border-dashed" style={{ borderColor: "rgba(244,114,182,0.25)" }} />
      <span className={size === "xs" ? "text-xs" : size === "sm" ? "text-lg" : "text-2xl"}>💌</span>
    </div>
  );
}

export interface CardFaceProps {
  card: Card;
  size?: "xs" | "sm" | "md" | "lg";
  highlight?: boolean;
  faded?: boolean;
  className?: string;
}

/** A known, face-up card. */
export function CardFace({ card, size = "md", highlight = false, faded = false, className = "" }: CardFaceProps) {
  const imgSize = size === "lg" ? 160 : size === "md" ? 112 : size === "sm" ? 80 : 48;
  return (
    <div
      title={`${card.number}. ${CARD_NAMES[card.number]}`}
      className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition ${DIMS[size]} ${faded ? "opacity-40 grayscale" : ""} ${className}`}
      style={{
        borderColor: highlight ? "rgba(251,191,36,0.85)" : "rgba(244,114,182,0.4)",
        boxShadow: highlight ? "0 0 14px -2px rgba(251,191,36,0.75)" : "none",
      }}
    >
      <Image src={CARD_IMAGES[card.number]} alt={`${card.number}. ${CARD_NAMES[card.number]}`} width={imgSize} height={imgSize} className="h-full w-full object-cover" />
    </div>
  );
}

/** `card === null` means "known to exist but hidden from this viewer" — always render the back, never guess. */
export function CardSlot({
  card,
  size = "md",
  highlight = false,
  faded = false,
  className = "",
}: {
  card: Card | null;
  size?: "xs" | "sm" | "md" | "lg";
  highlight?: boolean;
  faded?: boolean;
  className?: string;
}) {
  if (!card) return <CardBack size={size} className={className} />;
  return <CardFace card={card} size={size} highlight={highlight} faded={faded} className={className} />;
}

/** Compact inline label used in narration/log text, e.g. "2. 사제". */
export function cardLabel(numberOrCard: CardNumber | Card): string {
  const number = typeof numberOrCard === "number" ? numberOrCard : numberOrCard.number;
  return `${number}. ${CARD_NAMES[number]}`;
}
