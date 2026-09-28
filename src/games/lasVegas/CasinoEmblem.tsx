import type { CasinoNumber } from "./engine";

/**
 * Pure inline-SVG casino theme art for the 6 casino tiles — no external
 * image assets, same "<Feature>Icon.tsx" convention as DiceIcon.tsx. The
 * rulebook never names the casinos (always just "N번 카지노"), so all six are
 * fictional venues with original scenes (gold vein / temple colonnade /
 * volcano oasis / domed desert palace / sandstone pyramid / big-top tent),
 * drawn as a matched Art Deco set: gold hairlines on deep jewel tones (see
 * `DecoScene`).
 *
 * 2026-09-28 저작권 정리: this used to sit under `CasinoPhotoArt.tsx`, which
 * rendered real photos of 6 Las Vegas Strip casinos (one a watermarked,
 * unlicensed stock photo) under their trademarked names. Both the photos and
 * the real names were removed — these SVG scenes are now the only tile art.
 * Keep it that way: don't reintroduce real casino names, logos, or photos.
 *
 * Two renders of the same 6 scenes are exported:
 *  - `CasinoTileArt`  — the full-bleed 3:4 background. Since every casino
 *    now has a CC0 photo (`CasinoPhotoArt.tsx`), this is only the fallback;
 *    its scenes are the earlier motif set and don't match the current,
 *    photo-driven `CASINO_THEME_NAMES`.
 *  - `CasinoEmblem`   — a small circular medallion, kept in case a compact
 *    badge is ever wanted (dashboard card, rulebook, etc.).
 */

export const CASINO_THEME_NAMES: Record<CasinoNumber, { ko: string; en: string }> = {
  1: { ko: "맨해튼 펜트하우스", en: "Manhattan Penthouse" },
  2: { ko: "빅토리아 하버", en: "Victoria Harbour" },
  3: { ko: "크리스털 타워", en: "Crystal Tower" },
  4: { ko: "골든 커브 레지던스", en: "Golden Curve Residence" },
  5: { ko: "선셋 스카이라인", en: "Sunset Skyline" },
  6: { ko: "하버프론트 타워", en: "Harbourfront Tower" },
};

// ---------------------------------------------------------------------
// Full-bleed 3:4 tile art (the "table mat" background)
// ---------------------------------------------------------------------

/**
 * Shared Art Deco "poster" treatment every scene paints into (2026-09-28
 * "세련되고 우아한" 재디자인): a deep jewel-tone gradient, a faint gold
 * sunburst radiating from the scene's focal point, a soft focal glow, and a
 * double gold hairline frame with fan-shaped corner ornaments. Each scene
 * then draws its motif in the shared `${id}-gold` gradient with thin strokes,
 * so the six tiles read as one matched set.
 */
function DecoScene({
  id,
  top,
  bottom,
  focus,
  children,
}: {
  id: string;
  top: string;
  bottom: string;
  focus: [number, number];
  children: React.ReactNode;
}) {
  const [fx, fy] = focus;
  const rays = 40;
  return (
    <>
      <defs>
        <clipPath id={`${id}-tile-clip`}>
          <rect x="0" y="0" width="240" height="320" rx="18" ry="18" />
        </clipPath>
        <linearGradient id={`${id}-bg`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={top} />
          <stop offset="100%" stopColor={bottom} />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbefc4" />
          <stop offset="45%" stopColor="#d9b25a" />
          <stop offset="100%" stopColor="#9a7428" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx={fx / 240} cy={fy / 320} r="0.55">
          <stop offset="0%" stopColor="#f6dc98" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#f6dc98" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${id}-tile-clip)`}>
        <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-bg)`} />
        <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-glow)`} />
        <g stroke="#e8c874" strokeWidth="0.5" opacity="0.14">
          {[...Array(rays)].map((_, i) => {
            const a = (i / rays) * Math.PI * 2;
            return <path key={i} d={`M${fx} ${fy} L${fx + Math.cos(a) * 420} ${fy + Math.sin(a) * 420}`} />;
          })}
        </g>
        {children}
        <DecoFrame id={id} />
      </g>
    </>
  );
}

/** Double gold hairline frame + stepped fan ornaments in each corner. */
function DecoFrame({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const corners: [number, number, number, number][] = [
    [14, 14, 1, 1],
    [226, 14, -1, 1],
    [14, 306, 1, -1],
    [226, 306, -1, -1],
  ];
  return (
    <g fill="none" stroke={gold}>
      <rect x="9" y="9" width="222" height="302" rx="12" strokeWidth="1.3" />
      <rect x="14" y="14" width="212" height="292" rx="8" strokeWidth="0.5" opacity="0.7" />
      {corners.map(([x, y, sx, sy], i) => (
        <g key={i} strokeWidth="0.7">
          {[10, 16, 22].map((r) => (
            <path key={r} d={`M${x + sx * r} ${y} A${r} ${r} 0 0 ${sx * sy > 0 ? 1 : 0} ${x} ${y + sy * r}`} />
          ))}
          <path d={`M${x} ${y} L${x + sx * 7} ${y + sy * 7}`} />
        </g>
      ))}
      {/* bottom-center keystone ornament */}
      <g strokeWidth="0.8">
        <path d="M120 300 l6 -6 -6 -6 -6 6Z" fill={gold} />
        <path d="M84 294 H108 M132 294 H156" />
      </g>
    </g>
  );
}

/** Tiny four-point gold sparkle. */
function Sparkle({ x, y, r, gold, opacity = 1 }: { x: number; y: number; r: number; gold: string; opacity?: number }) {
  const k = r * 0.28;
  return (
    <path
      d={`M${x} ${y - r} L${x + k} ${y - k} L${x + r} ${y} L${x + k} ${y + k} L${x} ${y + r} L${x - k} ${y + k} L${x - r} ${y} L${x - k} ${y - k}Z`}
      fill={gold}
      opacity={opacity}
    />
  );
}

/** Casino 1 — 황금 광맥: a brilliant-cut gold gem over a hairline mountain range. */
function GoldVeinTile({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const outer: [number, number][] = [
    [120, 96], [168, 118], [186, 168], [166, 222], [120, 246], [74, 222], [54, 168], [72, 118],
  ];
  const inner: [number, number][] = [
    [120, 134], [144, 146], [152, 172], [140, 198], [120, 206], [100, 198], [88, 172], [96, 146],
  ];
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <DecoScene id={id} top="#0d4a38" bottom="#03150f" focus={[120, 170]}>
      <path d="M22 290 L58 262 L86 280 L120 252 L154 280 L182 262 L218 290" fill="none" stroke={gold} strokeWidth="1" opacity="0.7" />
      <polygon points={pts(outer)} fill={gold} stroke="#fbefc4" strokeWidth="1" strokeLinejoin="round" />
      <polygon points={pts(inner)} fill="#fbefc4" fillOpacity="0.35" stroke="#6b4f16" strokeWidth="0.8" strokeLinejoin="round" />
      <g stroke="#6b4f16" strokeWidth="0.7" opacity="0.75">
        {outer.map(([x, y], i) => (
          <path key={i} d={`M${x} ${y} L${inner[i][0]} ${inner[i][1]}`} />
        ))}
      </g>
      <path d="M120 96 L96 146 M120 96 L144 146" stroke="#fff8dc" strokeWidth="0.8" opacity="0.8" />
      <Sparkle x={170} y={106} r={9} gold="#fff8dc" />
      <Sparkle x={62} y={214} r={6} gold="#fff8dc" opacity={0.85} />
      <Sparkle x={196} y={206} r={4} gold={gold} opacity={0.8} />
    </DecoScene>
  );
}

/** Casino 2 — 올림포스 신전: a classical temple facade in gold line, laurel above. */
function OlympusTempleTile({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const columnXs = [66, 88, 110, 130, 152, 174];
  const leaves = (side: 1 | -1) =>
    [...Array(5)].map((_, i) => {
      const a = Math.PI / 2 + side * (0.3 + i * 0.3);
      const x = 120 + Math.cos(a) * 30;
      const y = 78 - Math.sin(a) * 30;
      // each leaf points outward-and-up, angled 40° off the wreath's tangent
      const deg = (-a * 180) / Math.PI + side * 50;
      return <ellipse key={`${side}-${i}`} cx={x} cy={y} rx="6.5" ry="2.6" transform={`rotate(${deg} ${x} ${y})`} />;
    });
  return (
    <DecoScene id={id} top="#5a1426" bottom="#17040a" focus={[120, 96]}>
      {/* laurel wreath */}
      <g fill={gold} opacity="0.95">
        {leaves(1)}
        {leaves(-1)}
      </g>
      {/* pediment + entablature */}
      <path d="M54 124 L120 88 L186 124 Z" fill={gold} fillOpacity="0.14" stroke={gold} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M74 119 L120 95 L166 119 Z" fill="none" stroke={gold} strokeWidth="0.6" opacity="0.7" />
      <circle cx="120" cy="110" r="5" fill="none" stroke={gold} strokeWidth="0.8" />
      <rect x="54" y="124" width="132" height="12" fill={gold} fillOpacity="0.2" stroke={gold} strokeWidth="1" />
      <g stroke={gold} strokeWidth="0.5" opacity="0.7">
        {[...Array(16)].map((_, i) => (
          <path key={i} d={`M${60 + i * 8} 126 V134`} />
        ))}
      </g>
      {/* fluted columns */}
      {columnXs.map((x) => (
        <g key={x}>
          <rect x={x - 6} y="138" width="12" height="4" fill={gold} />
          <rect x={x - 4} y="142" width="8" height="104" fill={gold} fillOpacity="0.16" stroke={gold} strokeWidth="0.9" />
          <path d={`M${x - 1.5} 144 V244 M${x + 1.5} 144 V244`} stroke={gold} strokeWidth="0.4" opacity="0.7" />
          <rect x={x - 6} y="246" width="12" height="4" fill={gold} />
        </g>
      ))}
      {/* stylobate steps */}
      <g fill="none" stroke={gold} strokeWidth="1">
        <rect x="48" y="252" width="144" height="7" />
        <rect x="40" y="259" width="160" height="7" />
        <rect x="32" y="266" width="176" height="7" />
      </g>
    </DecoScene>
  );
}

/** Casino 3 — 화산섬 오아시스: a volcano under a gold moon, palms, still water. */
function VolcanoOasisTile({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const palm = (x: number, s: number) => (
    <g transform={`translate(${x} 244)`} fill="none" stroke={gold} strokeLinecap="round">
      <path d={`M0 0 Q${8 * s} -34 ${3 * s} -66`} strokeWidth="1.6" />
      <g strokeWidth="1">
        <path d={`M${3 * s} -66 q${-14 * s} -8 ${-28 * s} 4`} />
        <path d={`M${3 * s} -66 q${14 * s} -10 ${30 * s} 2`} />
        <path d={`M${3 * s} -66 q${-6 * s} -14 ${-18 * s} -16`} />
        <path d={`M${3 * s} -66 q${8 * s} -14 ${22 * s} -14`} />
        <path d={`M${3 * s} -66 q${-2 * s} 10 ${-14 * s} 18`} />
      </g>
    </g>
  );
  return (
    <DecoScene id={id} top="#0f4a54" bottom="#02161b" focus={[120, 96]}>
      <circle cx="120" cy="96" r="34" fill={gold} fillOpacity="0.14" stroke={gold} strokeWidth="1" />
      <circle cx="120" cy="96" r="40" fill="none" stroke={gold} strokeWidth="0.4" opacity="0.6" />
      {/* smoke plume */}
      <path d="M120 128 C108 112 134 104 122 88 C112 76 130 66 126 52" fill="none" stroke={gold} strokeWidth="1" opacity="0.8" />
      {/* volcano */}
      <path d="M44 242 L102 138 Q120 126 138 138 L196 242 Z" fill="#05282e" stroke={gold} strokeWidth="1.4" strokeLinejoin="round" />
      <g stroke={gold} strokeWidth="0.7" opacity="0.75" fill="none">
        <path d="M112 136 Q108 170 92 206" />
        <path d="M122 134 Q124 180 118 228" />
        <path d="M132 138 Q142 170 156 200" />
      </g>
      {palm(34, 1)}
      {palm(206, -1)}
      {/* water */}
      <path d="M22 244 H218" stroke={gold} strokeWidth="1" />
      <g stroke={gold} strokeWidth="0.7" strokeLinecap="round">
        <path d="M60 256 H180" opacity="0.7" />
        <path d="M78 266 H162" opacity="0.55" />
        <path d="M94 276 H146" opacity="0.4" />
      </g>
    </DecoScene>
  );
}

/** Casino 4 — 사막의 별궁: a domed palace with minarets under a crescent moon. */
function DesertPalaceTile({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const minaret = (x: number) => (
    <g>
      <rect x={x - 5} y="150" width="10" height="92" fill={gold} fillOpacity="0.14" stroke={gold} strokeWidth="0.9" />
      <path d={`M${x - 7} 150 H${x + 7} M${x - 7} 176 H${x + 7}`} stroke={gold} strokeWidth="0.9" />
      <path d={`M${x - 6} 150 Q${x - 6} 136 ${x} 128 Q${x + 6} 136 ${x + 6} 150 Z`} fill={gold} fillOpacity="0.3" stroke={gold} strokeWidth="0.9" />
      <path d={`M${x} 128 V118`} stroke={gold} strokeWidth="0.8" />
    </g>
  );
  return (
    <DecoScene id={id} top="#1d1f5c" bottom="#07071f" focus={[120, 150]}>
      {/* crescent moon + stars */}
      <path d="M186 42 A20 20 0 1 0 198 78 A16 16 0 1 1 186 42 Z" fill={gold} />
      <Sparkle x={52} y={52} r={5} gold="#fff8dc" />
      <Sparkle x={86} y={34} r={3} gold={gold} opacity={0.85} />
      <Sparkle x={148} y={62} r={3.5} gold={gold} opacity={0.8} />
      <Sparkle x={36} y={96} r={2.5} gold={gold} opacity={0.7} />
      <Sparkle x={206} y={110} r={3} gold={gold} opacity={0.7} />
      {minaret(58)}
      {minaret(182)}
      {/* main dome + finial */}
      <path d="M86 172 Q84 126 120 108 Q156 126 154 172 Z" fill={gold} fillOpacity="0.22" stroke={gold} strokeWidth="1.3" />
      <path d="M100 172 Q100 136 120 118 Q140 136 140 172" fill="none" stroke={gold} strokeWidth="0.5" opacity="0.7" />
      <path d="M120 108 V90" stroke={gold} strokeWidth="1" />
      <circle cx="120" cy="86" r="4" fill={gold} />
      {/* palace body with arched windows + door */}
      <rect x="76" y="172" width="88" height="70" fill={gold} fillOpacity="0.1" stroke={gold} strokeWidth="1.2" />
      <path d="M72 172 H168" stroke={gold} strokeWidth="1.6" />
      {[92, 148].map((x) => (
        <path key={x} d={`M${x - 6} 214 V196 Q${x} 186 ${x + 6} 196 V214 Z`} fill="none" stroke={gold} strokeWidth="0.8" />
      ))}
      <path d="M108 242 V206 Q120 190 132 206 V242" fill="#07071f" stroke={gold} strokeWidth="1" />
      {/* dunes */}
      <g fill="none" stroke={gold} strokeLinecap="round">
        <path d="M22 250 Q80 236 130 252 T218 246" strokeWidth="1" />
        <path d="M22 268 Q90 254 150 270 T218 264" strokeWidth="0.7" opacity="0.6" />
        <path d="M22 284 Q70 276 120 286 T218 282" strokeWidth="0.5" opacity="0.4" />
      </g>
    </DecoScene>
  );
}

/** Casino 5 — 태양의 피라미드: a gold-lined pyramid before an Art Deco rising sun. */
function SunPyramidTile({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const sunRays = 13;
  return (
    <DecoScene id={id} top="#3a220c" bottom="#0e0703" focus={[120, 150]}>
      {/* deco sun: disc + fanned rays */}
      <g stroke={gold} strokeWidth="1" opacity="0.8">
        {[...Array(sunRays)].map((_, i) => {
          const a = Math.PI + (i / (sunRays - 1)) * Math.PI;
          return (
            <path
              key={i}
              d={`M${120 + Math.cos(a) * 52} ${150 + Math.sin(a) * 52} L${120 + Math.cos(a) * 86} ${150 + Math.sin(a) * 86}`}
            />
          );
        })}
      </g>
      <circle cx="120" cy="150" r="44" fill={gold} fillOpacity="0.2" stroke={gold} strokeWidth="1.2" />
      {/* side pyramids */}
      <path d="M22 256 L50 206 L78 256 Z" fill="#0e0703" stroke={gold} strokeWidth="0.9" opacity="0.8" />
      <path d="M162 256 L190 206 L218 256 Z" fill="#0e0703" stroke={gold} strokeWidth="0.9" opacity="0.8" />
      {/* main pyramid */}
      <path d="M50 256 L120 116 L190 256 Z" fill="#140a04" stroke={gold} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M120 116 L190 256 L136 256 Z" fill={gold} fillOpacity="0.2" />
      <g stroke={gold} strokeWidth="0.6" opacity="0.6">
        <path d="M100 156 H140" />
        <path d="M90 176 H150" />
        <path d="M80 196 H160" />
        <path d="M70 216 H170" />
        <path d="M60 236 H180" />
      </g>
      <path d="M113 130 L127 130 L120 116 Z" fill={gold} />
      <path d="M22 256 H218" stroke={gold} strokeWidth="1" />
      <g stroke={gold} strokeWidth="0.6" opacity="0.5">
        <path d="M40 270 H200" />
        <path d="M64 282 H176" />
      </g>
    </DecoScene>
  );
}

/** Casino 6 — 별빛 서커스: a striped big-top pavilion under a starry sky. */
function StarlightCircusTile({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const stripes = 8;
  const left = 44;
  const right = 196;
  const eaveY = 160;
  const w = (right - left) / stripes;
  return (
    <DecoScene id={id} top="#3f1253" bottom="#12031b" focus={[120, 76]}>
      <Sparkle x={48} y={60} r={4} gold="#fff8dc" />
      <Sparkle x={190} y={48} r={5} gold="#fff8dc" />
      <Sparkle x={200} y={112} r={2.5} gold={gold} opacity={0.8} />
      <Sparkle x={34} y={120} r={3} gold={gold} opacity={0.75} />
      {/* pennant on the king pole */}
      <path d="M120 76 V44" stroke={gold} strokeWidth="1.2" />
      <path d="M120 44 L140 50 L120 56 Z" fill={gold} />
      {/* canopy: alternating gold / dark gores */}
      {[...Array(stripes)].map((_, i) => {
        const x0 = left + i * w;
        const x1 = x0 + w;
        return (
          <path
            key={i}
            d={`M120 76 L${x0} ${eaveY} Q${(x0 + x1) / 2} ${eaveY + 10} ${x1} ${eaveY} Z`}
            fill={i % 2 === 0 ? gold : "#2a0a38"}
            fillOpacity={i % 2 === 0 ? 0.85 : 1}
            stroke={gold}
            strokeWidth="0.6"
          />
        );
      })}
      {/* drum walls */}
      <rect x="54" y="166" width="132" height="82" fill="#1d0628" stroke={gold} strokeWidth="1.1" />
      <g stroke={gold} strokeWidth="0.5" opacity="0.55">
        {[...Array(10)].map((_, i) => (
          <path key={i} d={`M${54 + (i + 1) * 12} 166 V248`} />
        ))}
      </g>
      {/* scalloped valance over the wall top */}
      <g fill={gold} stroke={gold} strokeWidth="0.6">
        {[...Array(stripes)].map((_, i) => (
          <path key={i} d={`M${left + i * w} ${eaveY} Q${left + (i + 0.5) * w} ${eaveY + 14} ${left + (i + 1) * w} ${eaveY} Z`} />
        ))}
      </g>
      {/* entrance with swept-back drapes */}
      <path d="M100 248 V204 Q120 178 140 204 V248 Z" fill="#12031b" stroke={gold} strokeWidth="1.1" />
      <path d="M100 204 Q108 222 104 248 M140 204 Q132 222 136 248" fill="none" stroke={gold} strokeWidth="0.8" />
      <path d="M22 248 H218" stroke={gold} strokeWidth="1" />
      <g stroke={gold} strokeWidth="0.6" opacity="0.5">
        <path d="M48 262 H192" />
        <path d="M72 274 H168" />
      </g>
    </DecoScene>
  );
}

const TILE_BODIES: Record<CasinoNumber, (props: { id: string }) => React.JSX.Element> = {
  1: GoldVeinTile,
  2: OlympusTempleTile,
  3: VolcanoOasisTile,
  4: DesertPalaceTile,
  5: SunPyramidTile,
  6: StarlightCircusTile,
};

/**
 * Full-bleed 3:4 background art for a casino tile — meant to fill its whole
 * container (e.g. `className="absolute inset-0 h-full w-full"` inside a
 * `relative aspect-[3/4]` wrapper). Uses `preserveAspectRatio="xMidYMid
 * slice"` so it "covers" the box the same way `object-fit: cover` would for
 * a raster image, without ever distorting the scene if the container's
 * actual rendered ratio drifts slightly from 3:4 at odd viewport widths.
 */
export function CasinoTileArt({
  casino,
  className = "",
  title,
}: {
  casino: CasinoNumber;
  className?: string;
  title?: string;
}) {
  const id = `lv-tile-${casino}`;
  const label = title ?? `${CASINO_THEME_NAMES[casino].ko} (카지노 ${casino}) 테마 매트`;
  const Body = TILE_BODIES[casino];
  return (
    <svg viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <Body id={id} />
    </svg>
  );
}

// ---------------------------------------------------------------------
// Legacy small circular medallion (kept for reuse elsewhere; unused by the
// board itself now that CasinoTileArt covers the whole tile).
// ---------------------------------------------------------------------

function Medallion({
  id,
  stops,
  linear,
  children,
}: {
  id: string;
  stops: [string, string][];
  linear?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <defs>
        {linear ? (
          <linearGradient id={id} x1="50%" y1="0%" x2="50%" y2="100%">
            {stops.map(([offset, color], i) => (
              <stop key={i} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        ) : (
          <radialGradient id={id} cx="35%" cy="30%" r="80%">
            {stops.map(([offset, color], i) => (
              <stop key={i} offset={offset} stopColor={color} />
            ))}
          </radialGradient>
        )}
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r="29" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="29" fill={`url(#${id})`} />
      <g clipPath={`url(#${id}-clip)`}>{children}</g>
      <circle cx="32" cy="32" r="29" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
    </>
  );
}

function GoldVeinEmblem({ id }: { id: string }) {
  return (
    <Medallion id={id} stops={[["0%", "#fff3c4"], ["55%", "#f2b632"], ["100%", "#8a5a08"]]}>
      <path
        d="M18 36 L22 21 L33 16 L46 23 L48 37 L39 48 L24 46 Z"
        fill="#ffe18a"
        stroke="#8a5a08"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <g stroke="#c07f10" strokeWidth="1" opacity="0.7" strokeLinecap="round">
        <path d="M24 27 L34 24 L41 30" fill="none" />
        <path d="M27 39 L36 42" fill="none" />
      </g>
      <path d="M43 17 l2.2 4.6 4.6 2.2 -4.6 2.2 -2.2 4.6 -2.2 -4.6 -4.6 -2.2 4.6 -2.2Z" fill="#fff7dc" />
    </Medallion>
  );
}

function OlympusTempleEmblem({ id }: { id: string }) {
  return (
    <Medallion id={id} stops={[["0%", "#fdf6e3"], ["55%", "#b48a3f"], ["100%", "#3d1f4e"]]}>
      <rect x="27" y="20" width="10" height="26" fill="#fde68a" stroke="#78350f" strokeWidth="1" />
      <rect x="24" y="17" width="16" height="4" fill="#fde68a" stroke="#78350f" strokeWidth="1" />
      <g stroke="#78350f" strokeWidth="0.8" opacity="0.7">
        <path d="M29 21 V45" fill="none" />
        <path d="M32 21 V45" fill="none" />
        <path d="M35 21 V45" fill="none" />
      </g>
      <g fill="#facc15" stroke="#78350f" strokeWidth="0.6">
        {[...Array(5)].map((_, i) => {
          const t = i / 4;
          const x = 14 + t * 12;
          const y = 30 + Math.sin(t * Math.PI) * 14;
          const rot = -60 + t * 120;
          return <ellipse key={`l${i}`} cx={x} cy={y} rx="4" ry="2" transform={`rotate(${rot} ${x} ${y})`} />;
        })}
        {[...Array(5)].map((_, i) => {
          const t = i / 4;
          const x = 50 - t * 12;
          const y = 30 + Math.sin(t * Math.PI) * 14;
          const rot = 60 - t * 120;
          return <ellipse key={`r${i}`} cx={x} cy={y} rx="4" ry="2" transform={`rotate(${rot} ${x} ${y})`} />;
        })}
      </g>
    </Medallion>
  );
}

function VolcanoOasisEmblem({ id }: { id: string }) {
  return (
    <Medallion id={id} stops={[["0%", "#b6f5e6"], ["50%", "#14b8a6"], ["100%", "#0f3d3a"]]}>
      <path d="M14 48 C18 32 24 30 28 38 C31 30 37 30 40 39 C44 30 50 33 52 48 Z" fill="#22c55e" opacity="0.9" />
      <path d="M24 48 L34 24 L44 48 Z" fill="#7c3a1c" stroke="#4a220e" strokeWidth="1" strokeLinejoin="round" />
      <path d="M30 33 Q34 26 38 33 L34 40 Z" fill="#fb923c" />
      <circle cx="34" cy="27" r="3.2" fill="#fde68a" opacity="0.9" />
    </Medallion>
  );
}

function DesertPalaceEmblem({ id }: { id: string }) {
  return (
    <Medallion id={id} stops={[["0%", "#0b1245"], ["45%", "#1e1b4b"], ["100%", "#f2b632"]]} linear>
      <g fill="#fff7dc" opacity="0.85">
        <circle cx="20" cy="12" r="0.9" />
        <circle cx="44" cy="10" r="0.7" />
        <circle cx="50" cy="18" r="0.9" />
        <circle cx="14" cy="20" r="0.6" />
      </g>
      <path
        d="M12 34 A20 12 0 0 1 52 34 L48 34 A16 9 0 0 0 16 34 Z"
        fill="#fde68a"
        stroke="#8a5a08"
        strokeWidth="0.8"
        opacity="0.9"
      />
      <path d="M40 22 C40 34 44 38 44 48 L36 48 C36 38 40 34 40 22 Z" fill="#8a5a2b" />
      <path
        d="M40 22 C34 24 30 30 40 34 C48 30 46 24 40 22 Z"
        fill="#22c55e"
      />
    </Medallion>
  );
}

function SunPyramidEmblem({ id }: { id: string }) {
  return (
    <Medallion id={id} stops={[["0%", "#e0703a"], ["100%", "#7a4e07"]]} linear>
      <circle cx="32" cy="22" r="9" fill="#fde68a" opacity="0.85" />
      <path d="M18 48 L32 18 L46 48 Z" fill="#d6a24a" stroke="#7a4e07" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M32 18 L46 48 L38 48 Z" fill="#a8741f" opacity="0.7" />
    </Medallion>
  );
}

function StarlightCircusEmblem({ id }: { id: string }) {
  const stripes = 7;
  return (
    <Medallion id={id} stops={[["0%", "#fee2e2"], ["55%", "#dc2626"], ["100%", "#450a0a"]]}>
      {[...Array(stripes)].map((_, i) => {
        const angleStep = 180 / stripes;
        const a1 = (-90 + i * angleStep) * (Math.PI / 180);
        const a2 = (-90 + (i + 1) * angleStep) * (Math.PI / 180);
        const r = 30;
        const x1 = 32 + r * Math.cos(a1);
        const y1 = 14 + r * Math.sin(a1) * 0.55 + 14;
        const x2 = 32 + r * Math.cos(a2);
        const y2 = 14 + r * Math.sin(a2) * 0.55 + 14;
        return (
          <path
            key={i}
            d={`M32 10 L${x1} ${y1} A30 18 0 0 1 ${x2} ${y2} Z`}
            fill={i % 2 === 0 ? "#fef2f2" : "#dc2626"}
            opacity="0.95"
          />
        );
      })}
      <circle cx="32" cy="10" r="2.6" fill="#fde68a" stroke="#78350f" strokeWidth="0.6" />
      <path d="M9 42 h46 v6 h-46 Z" fill="#fde68a" opacity="0.9" />
      <path d="m40 20 2 4.2 4.2 2 -4.2 2 -2 4.2 -2 -4.2 -4.2 -2 4.2 -2Z" fill="#fef2f2" />
    </Medallion>
  );
}

export function CasinoEmblem({
  casino,
  className = "h-10 w-10",
  title,
}: {
  casino: CasinoNumber;
  className?: string;
  title?: string;
}) {
  const id = `lv-emblem-${casino}`;
  const label = title ?? `${CASINO_THEME_NAMES[casino].ko} (카지노 ${casino})`;
  const Body = {
    1: GoldVeinEmblem,
    2: OlympusTempleEmblem,
    3: VolcanoOasisEmblem,
    4: DesertPalaceEmblem,
    5: SunPyramidEmblem,
    6: StarlightCircusEmblem,
  }[casino];
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} role="img" aria-label={label}>
      <title>{label}</title>
      <Body id={id} />
    </svg>
  );
}
