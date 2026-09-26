import { useId, type CSSProperties } from "react";
import { DuelToken, GEM_PALETTE } from "./DuelToken";
import type { CardAbility, GemColor, Level } from "./engine";

/**
 * "Renaissance luxury" dressing for 스플렌더 대결 cards — inline SVG/CSS
 * only (no image assets, same convention as DuelToken / RoyalPortrait).
 *
 * Everything here is *decoration around* the existing token art: the gem
 * silhouettes themselves stay in DuelToken.tsx so a sapphire on the board, in
 * a cost row and in a card's illustration window is the exact same stone.
 * Nothing in this file may add vertical height to a card — the phone layout
 * is measured at exactly 844px with no slack (see HANDOFF).
 */

/** Gold bezel painted as a border-box gradient, so the card keeps its 1.5px border and its size. */
const GOLD_RIM = "linear-gradient(135deg, #fff4c2 0%, #d4a52a 22%, #7a4a00 48%, #f7dc85 70%, #8a5a00 100%)";
const DULL_RIM = "linear-gradient(135deg, #8a7a55 0%, #4a3d22 50%, #7d6c45 100%)";

/** Velvet ground per level: I = emerald baize, II = cognac leather, III = midnight silk. */
const LEVEL_GROUND: Record<Level, string> = {
  1: "radial-gradient(120% 70% at 50% 0%, #1d5a44 0%, #0d241c 55%, #0a0908 100%)",
  2: "radial-gradient(120% 70% at 50% 0%, #7a4f16 0%, #2b1a08 55%, #0a0908 100%)",
  3: "radial-gradient(120% 70% at 50% 0%, #25407a 0%, #0f1a36 55%, #07080f 100%)",
};

export function cardFrameStyle(level: Level, lit: boolean): CSSProperties {
  return {
    background: `${LEVEL_GROUND[level]} padding-box, ${lit || level === 3 ? GOLD_RIM : DULL_RIM} border-box`,
    border: `${level === 3 ? 2 : 1.5}px solid transparent`,
  };
}

export function royalFrameStyle(): CSSProperties {
  return { background: `#000 padding-box, ${GOLD_RIM} border-box`, border: "2px solid transparent" };
}

/** Embossed gold numeral (prestige points) — text-clipped gradient + dark bevel shadow. */
export function GoldNumeral({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span
      className={`bg-gradient-to-b from-[#fff7cf] via-[#f2c14e] to-[#9a6300] bg-clip-text font-serif font-black text-transparent ${className}`}
      style={{ filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.9))" }}
    >
      {value}
    </span>
  );
}

/** Tiny gold crown (replaces the 👑 emoji inside cards so it renders identically on every OS). */
export function CrownGlyph({ className = "h-3 w-3" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 24 20" className={`shrink-0 ${className}`} aria-hidden="true" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.7))" }}>
      <defs>
        <linearGradient id={`${id}-c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff4b8" />
          <stop offset="0.55" stopColor="#f2b705" />
          <stop offset="1" stopColor="#8a5a00" />
        </linearGradient>
      </defs>
      <path d="M2 16 L3 5 L8 10 L12 2 L16 10 L21 5 L22 16 Z" fill={`url(#${id}-c)`} stroke="#5c3a00" strokeWidth="0.8" strokeLinejoin="round" />
      <rect x="2" y="15.5" width="20" height="3" rx="1" fill="#e0a40a" stroke="#5c3a00" strokeWidth="0.6" />
      <circle cx="12" cy="11" r="1.6" fill="#e0194a" />
    </svg>
  );
}

export function CrownRow({ count, className }: { count: number; className: string }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex" title={`왕관 ${count}개`}>
      {Array.from({ length: count }, (_, i) => (
        <CrownGlyph key={i} className={className} />
      ))}
    </span>
  );
}

/* ── Ability jewel badges ─────────────────────────────────────────────── */

interface JewelLook {
  light: string;
  base: string;
  dark: string;
  /** White glyph drawn on the cabochon, in a 24×24 box. */
  glyph: React.ReactNode;
}

const G = { fill: "none", stroke: "#fff", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const JEWELS: Record<CardAbility, JewelLook> = {
  // Aquamarine — circular arrow.
  extraTurn: {
    light: "#b8f5ff",
    base: "#0fa5c7",
    dark: "#053a4d",
    glyph: (
      <g {...G}>
        <path d="M18 9.5 A6.5 6.5 0 1 0 18.3 15" />
        <path d="M18.6 5.2 L18.2 9.8 L13.8 9" />
      </g>
    ),
  },
  // Amethyst — two overlapping facets ("copy").
  copyBonus: {
    light: "#ecd5ff",
    base: "#8b3fd9",
    dark: "#2e0a55",
    glyph: (
      <g {...G} strokeWidth={2}>
        <path d="M9 5 L14 10 L9 15 L4 10 Z" />
        <path d="M15 9 L20 14 L15 19 L10 14 Z" fill="#fff" fillOpacity="0.35" />
      </g>
    ),
  },
  // Peridot — arrow down into a tray ("take").
  takeToken: {
    light: "#dcffb0",
    base: "#4fa21a",
    dark: "#173b05",
    glyph: (
      <g {...G}>
        <path d="M12 4 V14" />
        <path d="M7.5 10 L12 14.5 L16.5 10" />
        <path d="M5 17 V19.5 H19 V17" />
      </g>
    ),
  },
  // Topaz — rolled scroll.
  gainPrivilege: {
    light: "#fff1bf",
    base: "#e39b0b",
    dark: "#5a3300",
    glyph: (
      <g {...G} strokeWidth={2}>
        <path d="M7 6 H17 V18 H7 Z" fill="#fff" fillOpacity="0.25" />
        <path d="M5 6 A2 2 0 0 1 9 6 M15 18 A2 2 0 0 0 19 18" />
        <path d="M10 10 H14 M10 13.5 H14" strokeWidth={1.6} />
      </g>
    ),
  },
  // Garnet — hooked claw pulling a gem ("steal").
  stealToken: {
    light: "#ffc2cc",
    base: "#c3123f",
    dark: "#4a0616",
    glyph: (
      <g {...G}>
        <path d="M20 7 H11 A4.5 4.5 0 0 0 11 16 H14" />
        <path d="M16.5 3.8 L20.2 7 L16.5 10.2" />
        <path d="M6 17 L8 19.5 L6 22 L4 19.5 Z" fill="#fff" strokeWidth={1.2} />
      </g>
    ),
  },
};

/**
 * An ability rendered as a jewel: cabochon stone of the ability's color in a
 * milled gold bezel, with a white engraved glyph. Readable down to ~12px.
 */
export function AbilityJewel({ ability, className = "h-5 w-5", title }: { ability: CardAbility; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const j = JEWELS[ability];
  return (
    <svg viewBox="0 0 32 32" className={`inline-block shrink-0 align-middle ${className}`} role="img" aria-label={title} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${id}-bz`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4c2" />
          <stop offset="0.4" stopColor="#d4a52a" />
          <stop offset="0.7" stopColor="#7a4a00" />
          <stop offset="1" stopColor="#f2c14e" />
        </linearGradient>
        <radialGradient id={`${id}-st`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor={j.light} />
          <stop offset="0.5" stopColor={j.base} />
          <stop offset="1" stopColor={j.dark} />
        </radialGradient>
      </defs>
      {/* Milled bezel: 16 tiny beads around the rim */}
      <circle cx="16" cy="16" r="15.2" fill={`url(#${id}-bz)`} />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <circle key={i} cx={16 + 14 * Math.cos(a)} cy={16 + 14 * Math.sin(a)} r="0.9" fill="#fff6d0" fillOpacity="0.7" />;
      })}
      <circle cx="16" cy="16" r="11.6" fill={`url(#${id}-st)`} stroke="#5c3a00" strokeWidth="0.8" />
      <g transform="translate(5.2 5.2) scale(0.9)">{j.glyph}</g>
      <ellipse cx="11.5" cy="10" rx="4" ry="2.2" fill="#fff" fillOpacity="0.45" transform="rotate(-35 11.5 10)" />
    </svg>
  );
}

/* ── Gem illustration window ──────────────────────────────────────────── */

/** Soft god-rays + halo in the gem's own color behind the stone, with a slow glint sweep. */
export function GemHalo({ color }: { color: GemColor | null }) {
  const id = useId().replace(/:/g, "");
  const tint = color ? GEM_PALETTE[color].light : "#e7e5e4";
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-h`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={tint} stopOpacity="0.55" />
          <stop offset="0.55" stopColor={tint} stopOpacity="0.12" />
          <stop offset="1" stopColor={tint} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-glint`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g opacity="0.35">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M50 50 L47 -10 L53 -10 Z" fill={tint} transform={`rotate(${i * 30} 50 50)`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="46" fill={`url(#${id}-h)`} />
      <rect x="-40" y="-20" width="30" height="140" fill={`url(#${id}-glint)`} transform="rotate(20 50 50)">
        <animate attributeName="x" values="-60;140;140" keyTimes="0;0.35;1" dur="6s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

/** Colorless ("보너스 복사" / pure points) stone — a prismatic opal in the same faceted style. */
export function PrismStone({ className }: { className: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full border border-white/60 shadow-[inset_-2px_-3px_4px_rgba(0,0,0,0.45),inset_2px_2px_3px_rgba(255,255,255,0.6)] ${className}`}
      style={{ background: "conic-gradient(from 30deg, #c9e2fb, #1f6fe5, #0e9f6e, #f2b705, #e0194a, #8b3fd9, #c9e2fb)" }}
    />
  );
}

/**
 * The card's central illustration: an inset "jeweller's window" (dark
 * velvet well, gold hairline) with the stone floating in its own light.
 * `fill` sizes the stone; the window itself stretches to its parent.
 */
export function GemWindow({ color, stoneClass, className = "" }: { color: GemColor | null; stoneClass: string; className?: string }) {
  return (
    <span className={`relative flex items-center justify-center overflow-hidden rounded-md ${className}`}>
      <GemHalo color={color} />
      <span className="relative inline-flex">{color ? <DuelToken color={color} className={stoneClass} /> : <PrismStone className={stoneClass} />}</span>
    </span>
  );
}

/* ── Royal wax seal ───────────────────────────────────────────────────── */

const SEALS: Record<string, { wax: [string, string]; sigil: React.ReactNode; title: string }> = {
  // 국왕 — crown
  "royal-plain": {
    wax: ["#e0484f", "#6b0d14"],
    title: "국왕의 인장",
    sigil: <path d="M8 21 L8.8 12 L12.5 15.5 L16 9 L19.5 15.5 L23.2 12 L24 21 Z" fill="#ffd9a0" fillOpacity="0.85" />,
  },
  // 여왕 — rose
  "royal-steal": {
    wax: ["#b04ad6", "#3b0a52"],
    title: "여왕의 인장",
    sigil: (
      <g fill="#ffd9a0" fillOpacity="0.85">
        {Array.from({ length: 5 }, (_, i) => (
          <ellipse key={i} cx="16" cy="11" rx="3" ry="5" transform={`rotate(${i * 72} 16 16)`} />
        ))}
        <circle cx="16" cy="16" r="2.4" fill="#6b0d14" fillOpacity="0.6" />
      </g>
    ),
  },
  // 재상 — quill over scroll
  "royal-privilege": {
    wax: ["#3d6fd9", "#0b1f55"],
    title: "재상의 인장",
    sigil: (
      <g fill="none" stroke="#ffd9a0" strokeOpacity="0.9" strokeWidth="1.8" strokeLinecap="round">
        <path d="M9 22 L23 8" />
        <path d="M23 8 C18 8, 14 12, 13 18" />
        <path d="M9 23 H20" />
      </g>
    ),
  },
  // 왕자 — radiant star
  "royal-extra": {
    wax: ["#1fa37a", "#063d2c"],
    title: "왕자의 인장",
    sigil: <path d="M16 7 L18.3 13.2 L25 13.5 L19.8 17.6 L21.6 24 L16 20.3 L10.4 24 L12.2 17.6 L7 13.5 L13.7 13.2 Z" fill="#ffd9a0" fillOpacity="0.85" />,
  },
};

/** Wax seal emblem for a royal card — irregular melted rim, pressed sigil. */
export function WaxSeal({ royalId, className = "h-6 w-6" }: { royalId: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const s = SEALS[royalId] ?? SEALS["royal-plain"];
  // Melted blob outline: a 14-lobe wobble around r≈14.
  const blob = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    const r = i % 2 ? 13.2 : 15;
    return `${i ? "L" : "M"}${(16 + r * Math.cos(a)).toFixed(1)} ${(16 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} role="img" aria-label={s.title} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85))" }}>
      <title>{s.title}</title>
      <defs>
        <radialGradient id={`${id}-w`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor={s.wax[0]} />
          <stop offset="1" stopColor={s.wax[1]} />
        </radialGradient>
      </defs>
      <path d={`${blob} Z`} fill={`url(#${id}-w)`} />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#000" strokeOpacity="0.3" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="0.6" transform="translate(-0.5 -0.5)" />
      {s.sigil}
      <ellipse cx="11" cy="9.5" rx="3.5" ry="1.8" fill="#fff" fillOpacity="0.3" transform="rotate(-35 11 9.5)" />
    </svg>
  );
}
