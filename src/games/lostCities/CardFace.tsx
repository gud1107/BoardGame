import { EXPEDITION_THEME, type Card, type Color } from "./engine";

/**
 * Pure inline-styled card face — no external image asset, matching this
 * project's convention for simple card games (grid-poker's `cardDisplay.tsx`
 * CardChip is the closest analogue).
 *
 * 2026-08-31 visual-renewal session: swapped the old washed-out/translucent
 * per-color backgrounds for **fully solid, vivid** ones, and every color got
 * a small inline-SVG vector emblem (not just an emoji) watermarked behind the
 * number — a shape difference survives grayscale/colorblind rendering, not
 * just the hue. The 5 hex targets the task brief specified
 * (#EAB308/#2563EB/#F1F5F9+#CBD5E1/#16A34A/#DC2626) are exact matches for
 * this project's existing Tailwind palette (`yellow-500`/`blue-600`/
 * `slate-100`+`slate-300`/`green-600`/`red-600`), so plain utility classes
 * are used rather than arbitrary hex — consistent with every other color
 * usage in this codebase.
 */
export const LANE_THEME: Record<
  Color,
  { solidBg: string; text: string; ring: string; backdropFrom: string; backdropTo: string; laneBorder: string; discardBorder: string; label: string }
> = {
  yellow: {
    solidBg: "bg-yellow-500",
    text: "text-yellow-950",
    ring: "border-yellow-300",
    backdropFrom: "from-yellow-900/70",
    backdropTo: "to-[#2b1c02]",
    laneBorder: "border-yellow-600/50",
    discardBorder: "border-yellow-500/40",
    label: "사막",
  },
  blue: {
    solidBg: "bg-blue-600",
    text: "text-white",
    ring: "border-blue-300",
    backdropFrom: "from-blue-950/80",
    backdropTo: "to-[#020617]",
    laneBorder: "border-blue-600/50",
    discardBorder: "border-blue-500/40",
    label: "침몰 도시",
  },
  white: {
    solidBg: "bg-slate-100",
    text: "text-slate-900",
    ring: "border-slate-300",
    backdropFrom: "from-slate-700/70",
    backdropTo: "to-slate-950",
    laneBorder: "border-slate-400/50",
    discardBorder: "border-slate-300/40",
    label: "히말라야",
  },
  green: {
    solidBg: "bg-green-600",
    text: "text-white",
    ring: "border-green-300",
    backdropFrom: "from-green-950/80",
    backdropTo: "to-[#031006]",
    laneBorder: "border-green-600/50",
    discardBorder: "border-green-500/40",
    label: "열대우림",
  },
  red: {
    solidBg: "bg-red-600",
    text: "text-white",
    ring: "border-red-300",
    backdropFrom: "from-red-950/80",
    backdropTo: "to-[#1a0303]",
    laneBorder: "border-red-600/50",
    discardBorder: "border-red-500/40",
    label: "화산",
  },
};

/** Inline vector emblem per color — watermarked behind the card's number, shape-distinct so hue alone is never the only signal. */
function ColorEmblem({ color, className }: { color: Color; className?: string }) {
  switch (color) {
    case "yellow": // 황금 피라미드 + 태양 (desert)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <circle cx="12" cy="6" r="2.1" />
          <path d="M12 9 L21 21 H3 Z" />
        </svg>
      );
    case "blue": // 심해 파도 (Atlantis / ocean)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M2 9 Q6.5 4 11 9 T20 9" />
          <path d="M2 15 Q6.5 10 11 15 T20 15" />
          <path d="M2 21 Q6.5 16 11 21 T20 21" />
        </svg>
      );
    case "white": // 설산 봉우리 (Himalaya)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M2 21 L8 8 L11 13 L15 3 L22 21 Z" />
        </svg>
      );
    case "green": // 정글 덩굴잎 (jungle vine)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M12 2 C5 7 5 15 12 22 C19 15 19 7 12 2 Z" />
        </svg>
      );
    case "red": // 화산 + 용암 (volcano)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M4 21 L11 8 L13 11 L15 6 L21 21 Z" />
          <path d="M12 1 C10.3 3.3 13.7 4.3 12 6.6 C10.3 4.3 13.7 3.3 12 1 Z" />
        </svg>
      );
  }
}

const SIZE_DIMS: Record<"sm" | "md" | "lg", string> = {
  sm: "h-12 w-9 sm:h-14 sm:w-10",
  md: "h-16 w-12 sm:h-20 sm:w-14",
  lg: "h-20 w-14 sm:h-24 sm:w-16",
};
const SIZE_TEXT: Record<"sm" | "md" | "lg", string> = {
  sm: "text-sm",
  md: "text-lg sm:text-xl",
  lg: "text-xl sm:text-2xl",
};
const EMBLEM_SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "h-8 w-8",
  md: "h-11 w-11",
  lg: "h-14 w-14",
};

export default function CardFace({
  card,
  size = "md",
  selected = false,
  faded = false,
  /** Investment card only — the lane's *current* multiplier ((investCount)+1) as of this render, e.g. 2 for the 1st investment card placed. `ExpeditionLane.tsx` supplies this; every investment card in a lane shows the same current value since the multiplier applies uniformly to the whole lane. */
  multiplierBadge,
  onClick,
}: {
  card: Card;
  size?: "sm" | "md" | "lg";
  /** Highlighted as the currently-selected hand card. */
  selected?: boolean;
  /** Dimmed — used for the "just discarded, can't take back this turn" top-of-pile card. */
  faded?: boolean;
  multiplierBadge?: number;
  onClick?: () => void;
}) {
  const theme = LANE_THEME[card.color];
  const legacyTheme = EXPEDITION_THEME[card.color];
  const className = `relative flex ${SIZE_DIMS[size]} flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-2 font-bold shadow-md transition ${theme.solidBg} ${theme.text} ${theme.ring} ${
    selected ? "-translate-y-2 ring-4 ring-white/90 shadow-[0_0_16px_rgba(255,255,255,0.5)]" : ""
  } ${faded ? "opacity-35" : ""} ${onClick ? "cursor-pointer active:scale-95" : "cursor-default"}`;
  const label = `${legacyTheme.name} ${card.kind === "investment" ? "투자 카드" : card.value}`;
  const content = (
    <>
      <ColorEmblem color={card.color} className={`pointer-events-none absolute inset-0 m-auto ${EMBLEM_SIZE[size]} opacity-25`} />
      <span className="relative z-10 text-[10px] leading-none opacity-80 sm:text-xs">{legacyTheme.emoji}</span>
      <span className={`relative z-10 ${SIZE_TEXT[size]} leading-none drop-shadow-sm`}>{card.kind === "investment" ? "🤝" : card.value}</span>
      {card.kind === "investment" && multiplierBadge && multiplierBadge > 1 && (
        <span className="lc-mult-badge-glow absolute -top-1.5 -right-1.5 z-20 rounded-full border border-amber-200 bg-gradient-to-br from-amber-300 to-amber-500 px-1 text-[9px] font-extrabold leading-tight text-amber-950 shadow">
          ×{multiplierBadge}
        </span>
      )}
    </>
  );
  // Only ever a real <button> when it's independently clickable (hand
  // cards) — every other usage (lane stacks, discard-pile tops) is nested
  // inside an *outer* button that already carries the actual click handler
  // (LostCitiesBoard.tsx's `LaneStack`/discard-pile buttons), and nesting an
  // interactive <button> inside another is invalid HTML that browsers
  // silently mangle (closes the outer button early) — plain markup here
  // avoids that entirely.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} aria-label={label}>
        {content}
      </button>
    );
  }
  return (
    <div className={className} aria-label={label}>
      {content}
    </div>
  );
}

export function CardBack({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div
      className={`flex ${SIZE_DIMS[size]} items-center justify-center rounded-lg border-2 border-white/20 bg-gradient-to-br from-slate-700 to-slate-900 text-white/30`}
      aria-hidden
    >
      🗺️
    </div>
  );
}
