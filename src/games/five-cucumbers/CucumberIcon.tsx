import type { CSSProperties } from "react";

/**
 * Pure inline-SVG "오이" (cucumber) token visual — no external image asset,
 * same convention as splendor/GemToken.tsx, century/ResourceIcon.tsx, and
 * perudo/PerudoFaceIcon.tsx. Used both on card faces (cucumber-count icons,
 * task brief §2) and the player scoreboard (cucumber-token tally).
 */
export function CucumberIcon({
  className = "h-4 w-4",
  title = "오이",
  style,
}: {
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id="cucumber-body" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a3e635" />
          <stop offset="55%" stopColor="#4d9d2f" />
          <stop offset="100%" stopColor="#2f6e1c" />
        </linearGradient>
      </defs>
      <path
        d="M4.5 8.2C7 4.6 10.8 2.6 14.8 2.9c1.3.1 2.3 1.2 2.3 2.5 0 .5-.1.9-.4 1.3 2.6.6 4.4 2.9 4.2 5.6-.3 4.2-4.5 7.9-9.2 8.6-3.8.6-7.3-1-9-4.1-1.6-2.8-1.1-6.1 1.8-8.6Z"
        fill="url(#cucumber-body)"
        stroke="#1f4d12"
        strokeWidth="0.6"
      />
      <g stroke="#dff5c8" strokeWidth="0.5" strokeLinecap="round" opacity="0.8">
        <path d="M7 9.2c2.6-2.6 6-4.1 9-4.3" />
        <path d="M6 12.4c2.9-2.7 6.6-4.3 9.9-4.6" />
        <path d="M5.7 15.6c3-2.4 6.8-3.8 10.2-4" />
      </g>
    </svg>
  );
}

/** "🥒 x N" badge, matching splendor's `GemCountBadge` shape/spacing convention. */
export function CucumberCountBadge({ count, size = "h-4 w-4" }: { count: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] font-semibold text-white/90">
      <CucumberIcon className={size} />
      {count}
    </span>
  );
}

/** A row of N cucumber icons — used on card faces where the count itself IS the visual (task brief §2), not a "icon + number" badge. */
export function CucumberRow({ count, size = "h-3 w-3" }: { count: number; size?: string }) {
  if (count === 0) return <span className="text-[9px] text-white/25">오이 없음</span>;
  return (
    <span className="flex flex-wrap items-center gap-0.5" title={`오이 ${count}개`}>
      {Array.from({ length: count }, (_, i) => (
        <CucumberIcon key={i} className={size} />
      ))}
    </span>
  );
}

/**
 * Hand-scattered pile positions (percent of container, plus a per-icon tilt)
 * for 0-5 cucumbers, one preset per count — mirrors the loose cluster look
 * of the real card art (`boardGameRule/오이다섯개/오이카드구성.jpg`) instead
 * of a tidy row/grid. Icon size shrinks as the count grows so a 5-cucumber
 * pile still fits the same card-face footprint as a single lone cucumber.
 */
const CLUSTER_LAYOUT: Record<number, { x: number; y: number; rotate: number }[]> = {
  1: [{ x: 50, y: 52, rotate: -4 }],
  2: [
    { x: 36, y: 40, rotate: -20 },
    { x: 64, y: 62, rotate: 14 },
  ],
  3: [
    { x: 50, y: 28, rotate: 2 },
    { x: 28, y: 64, rotate: -22 },
    { x: 72, y: 64, rotate: 20 },
  ],
  4: [
    { x: 30, y: 30, rotate: -18 },
    { x: 70, y: 32, rotate: 16 },
    { x: 32, y: 70, rotate: -8 },
    { x: 70, y: 70, rotate: 10 },
  ],
  5: [
    { x: 50, y: 22, rotate: 0 },
    { x: 24, y: 42, rotate: -24 },
    { x: 76, y: 42, rotate: 24 },
    { x: 34, y: 76, rotate: -12 },
    { x: 66, y: 76, rotate: 12 },
  ],
};

const CLUSTER_ICON_SIZE: Record<number, string> = {
  1: "h-[48%] w-[48%]",
  2: "h-[40%] w-[40%]",
  3: "h-[34%] w-[34%]",
  4: "h-[30%] w-[30%]",
  5: "h-[26%] w-[26%]",
};

/** Scattered cucumber pile used on card faces (task brief §1/§2) — fills its parent, so give it a sized `relative` wrapper. */
export function CucumberCluster({ count, className = "" }: { count: number; className?: string }) {
  const layout = CLUSTER_LAYOUT[count];
  if (!layout) return null;
  const iconSize = CLUSTER_ICON_SIZE[count];
  return (
    <div className={`relative h-full w-full ${className}`} title={`오이 ${count}개`}>
      {layout.map((pos, i) => (
        <CucumberIcon
          key={i}
          className={`absolute drop-shadow-sm ${iconSize}`}
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: `translate(-50%, -50%) rotate(${pos.rotate}deg)` }}
        />
      ))}
    </div>
  );
}
