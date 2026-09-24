import { useId } from "react";
import type { GemColor, TokenColor } from "./engine";

/**
 * Token visuals for 스플렌더 대결 — inline SVG, no image assets (same
 * convention as the rest of this project).
 *
 * Each gem color gets both its own jewel palette AND its own cut silhouette
 * (round brilliant / oval / emerald cut / trillion / hexagon), so tokens stay
 * tellable apart by shape alone — on the dark board, at 16px inside a card
 * cost row, or for color-blind players. Facets are generated from the
 * outline polygon: an inner "table" is the outline scaled toward the center,
 * and each outer edge + its matching table edge forms one facet quad, shaded
 * alternately light/dark to read as cut stone.
 */
export const TOKEN_LABEL: Record<TokenColor, string> = {
  white: "다이아몬드",
  blue: "사파이어",
  green: "에메랄드",
  red: "루비",
  black: "오닉스",
  pearl: "진주",
  gold: "황금",
};

interface GemPalette {
  light: string;
  base: string;
  dark: string;
  /** Outline stroke — kept light on onyx so it never disappears into the dark board. */
  rim: string;
  /** Readable text color on top of `base` (bonus badges). */
  ink: string;
}

export const GEM_PALETTE: Record<GemColor, GemPalette> = {
  white: { light: "#ffffff", base: "#c9e2fb", dark: "#5f82ad", rim: "#eef7ff", ink: "#0f2744" },
  blue: { light: "#8fd0ff", base: "#1f6fe5", dark: "#0a2466", rim: "#9cc9ff", ink: "#ffffff" },
  green: { light: "#7cf0c1", base: "#0e9f6e", dark: "#053d2c", rim: "#86efc4", ink: "#ffffff" },
  red: { light: "#ff9fb2", base: "#e0194a", dark: "#5c0a1f", rim: "#ffb3c2", ink: "#ffffff" },
  black: { light: "#b8b3c9", base: "#3b3847", dark: "#0b0a10", rim: "#d9d6e4", ink: "#ffffff" },
};

/** Solid accent per color, for card headers / bonus badges. */
export const COLOR_ACCENT: Record<GemColor, string> = {
  white: GEM_PALETTE.white.base,
  blue: GEM_PALETTE.blue.base,
  green: GEM_PALETTE.green.base,
  red: GEM_PALETTE.red.base,
  black: GEM_PALETTE.black.base,
};

type Pt = [number, number];

function regular(n: number, rx: number, ry: number, rot = 0): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [50 + rx * Math.cos(a), 50 + ry * Math.sin(a)];
  });
}

/** Outline polygon per gem, in a 100×100 viewBox. */
const SHAPES: Record<GemColor, Pt[]> = {
  // Round brilliant — 16 sides reads as a circle with visible facets.
  white: regular(16, 44, 44, -Math.PI / 2),
  // Oval cabochon-ish faceted sapphire.
  blue: regular(14, 34, 45, -Math.PI / 2),
  // Emerald cut — rectangle with clipped corners.
  green: [
    [32, 7], [68, 7], [81, 20], [81, 80], [68, 93], [32, 93], [19, 80], [19, 20],
  ],
  // Trillion — softened triangle (6 points: long sides + small corner cuts).
  red: [
    [44, 9], [56, 9], [95, 78], [89, 89], [11, 89], [5, 78],
  ],
  // Hexagonal onyx.
  black: regular(6, 45, 45, -Math.PI / 2),
};

function scaleToward(pts: Pt[], k: number, cy = 50): Pt[] {
  return pts.map(([x, y]) => [50 + (x - 50) * k, cy + (y - cy) * k]);
}

const path = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + " Z";

function FacetedGem({ color, className, label }: { color: GemColor; className: string; label: string }) {
  const id = useId().replace(/:/g, "");
  const p = GEM_PALETTE[color];
  const outer = SHAPES[color];
  const table = scaleToward(outer, 0.52, color === "red" ? 62 : 48);
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={label} className={`shrink-0 ${className}`} style={{ filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.55))" }}>
      <title>{label}</title>
      <defs>
        <linearGradient id={`${id}-body`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={p.light} />
          <stop offset="0.45" stopColor={p.base} />
          <stop offset="1" stopColor={p.dark} />
        </linearGradient>
        <radialGradient id={`${id}-table`} cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor={p.light} />
          <stop offset="0.6" stopColor={p.base} />
          <stop offset="1" stopColor={p.dark} stopOpacity="0.9" />
        </radialGradient>
      </defs>
      <path d={path(outer)} fill={`url(#${id}-body)`} />
      {outer.map((pt, i) => {
        const j = (i + 1) % outer.length;
        const quad = [pt, outer[j], table[j], table[i]];
        // Light from the top-left: facets facing up/left brighten, the rest darken.
        const mx = (pt[0] + outer[j][0]) / 2 - 50;
        const my = (pt[1] + outer[j][1]) / 2 - 50;
        const facing = -(mx + my) / 70;
        const fill = facing > 0 ? "#ffffff" : "#000000";
        const opacity = Math.min(0.42, Math.abs(facing) * 0.45) + (i % 2 ? 0.04 : 0);
        return <path key={i} d={path(quad)} fill={fill} fillOpacity={opacity} />;
      })}
      <path d={path(table)} fill={`url(#${id}-table)`} stroke={p.light} strokeOpacity="0.55" strokeWidth="1.2" />
      <path d={path(outer)} fill="none" stroke={p.rim} strokeOpacity="0.85" strokeWidth="2.2" strokeLinejoin="round" />
      <ellipse cx="38" cy="32" rx="9" ry="5" fill="#ffffff" fillOpacity="0.7" transform="rotate(-30 38 32)" />
      <circle cx="62" cy="64" r="2" fill="#ffffff" fillOpacity="0.45" />
    </svg>
  );
}

function Pearl({ className }: { className: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="진주" className={`shrink-0 ${className}`} style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))" }}>
      <title>진주</title>
      <defs>
        <radialGradient id={`${id}-p`} cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#fff4e8" />
          <stop offset="0.7" stopColor="#f1d5cf" />
          <stop offset="1" stopColor="#a67f86" />
        </radialGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#f9a8d4" stopOpacity="0" />
          <stop offset="0.5" stopColor="#a5f3fc" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill={`url(#${id}-p)`} />
      <circle cx="50" cy="50" r="42" fill={`url(#${id}-sheen)`} />
      <circle cx="50" cy="50" r="42" fill="none" stroke="#fff7fb" strokeOpacity="0.8" strokeWidth="2" />
      <ellipse cx="37" cy="33" rx="11" ry="7" fill="#ffffff" fillOpacity="0.9" transform="rotate(-30 37 33)" />
    </svg>
  );
}

function GoldCoin({ className }: { className: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="황금 (조커)" className={`shrink-0 ${className}`} style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.55))" }}>
      <title>황금 (조커)</title>
      <defs>
        <linearGradient id={`${id}-g`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fff4b8" />
          <stop offset="0.45" stopColor="#f2b705" />
          <stop offset="1" stopColor="#7a4a00" />
        </linearGradient>
        <linearGradient id={`${id}-in`} x1="0.85" y1="1" x2="0.15" y2="0">
          <stop offset="0" stopColor="#ffe37a" />
          <stop offset="1" stopColor="#b77900" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill={`url(#${id}-g)`} />
      <circle cx="50" cy="50" r="34" fill={`url(#${id}-in)`} stroke="#fff1a8" strokeOpacity="0.7" strokeWidth="1.5" />
      {/* Crown stamp */}
      <path d="M31 62 L34 40 L43 51 L50 35 L57 51 L66 40 L69 62 Z" fill="#fff6c9" fillOpacity="0.9" stroke="#7a4a00" strokeOpacity="0.5" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="31" y="64" width="38" height="5" rx="1.5" fill="#fff6c9" fillOpacity="0.9" />
      <ellipse cx="36" cy="28" rx="10" ry="5" fill="#ffffff" fillOpacity="0.55" transform="rotate(-30 36 28)" />
    </svg>
  );
}

export function DuelToken({ color, className = "h-8 w-8" }: { color: TokenColor; className?: string }) {
  if (color === "pearl") return <Pearl className={className} />;
  if (color === "gold") return <GoldCoin className={className} />;
  return <FacetedGem color={color} className={className} label={TOKEN_LABEL[color]} />;
}

/** Compact "token + count" chip for cost rows and inventories. */
export function TokenCount({ color, count, size = "h-3.5 w-3.5", dim = false }: { color: TokenColor; count: number; size?: string; dim?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-bold tabular-nums ${dim ? "opacity-35" : ""}`}>
      <DuelToken color={color} className={size} />
      {count}
    </span>
  );
}
