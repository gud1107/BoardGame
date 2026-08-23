import type { CasinoNumber } from "./engine";

/**
 * Pure inline-SVG casino theme art for the 6 casino tiles — no external
 * image assets, same "<Feature>Icon.tsx" convention as DiceIcon.tsx and every
 * other icon component in this project (CucumberIcon.tsx, GemToken.tsx,
 * ResourceIcon.tsx, PerudoFaceIcon.tsx). The rulebook itself never names the
 * casinos (`boardGameRule/라스베가스/라스베가스.md` — always just "N번 카지노"),
 * but the user supplied reference photos of 6 real Las Vegas Strip casinos,
 * numbered to the tiles, and asked for those specific identities
 * (`boardGameRule/라스베가스/골드너겟1.jpg` … `서커스 서커스6.jpg`). Everything below
 * is an original scene *reinterpretation* of that casino's most recognizable
 * motif (nugget rock + mining town / Roman colonnade + laurels / volcano +
 * oasis / desert dome + camel / black pyramid + light beam / big-top canopy)
 * — not a reproduction of any casino's actual logo, signage typography, or
 * photograph (deliberately kept flat/vector for the same reason the real
 * reference photos in `boardGameRule/` were declined as a background source
 * — see HANDOFF.md's existing licensing-caution note on `public/games/`).
 *
 * Two renders of the same 6 scenes are exported:
 *  - `CasinoTileArt`  — the full-bleed 3:4 background. As of 2026-08-23,
 *    `LasVegasBoard.tsx`'s `CasinoTile` no longer calls this directly for
 *    any of the 6 casinos — see `CasinoPhotoArt.tsx`'s `CasinoMatArt`, which
 *    swapped in real casino photos per explicit user decision (accepting
 *    the licensing caveat this file originally declined), including casino
 *    2 (Caesars Palace) whose only supplied photo carries a stock-agency
 *    watermark — used as-is, watermark visible, per a later explicit "this
 *    is a test build" request (see `CasinoPhotoArt.tsx`'s doc). This SVG
 *    stays wired as `CasinoMatArt`'s fallback for any casino without a
 *    synced photo, and is still exported/used standalone wherever a
 *    licensing-safe original illustration is wanted instead.
 *  - `CasinoEmblem`   — the original small circular medallion, kept in case
 *    a compact badge is ever wanted again (dashboard card, rulebook, etc.).
 */

export const CASINO_THEME_NAMES: Record<CasinoNumber, { ko: string; en: string }> = {
  1: { ko: "골드너겟", en: "Golden Nugget" },
  2: { ko: "시저스 팰리스", en: "Caesars Palace" },
  3: { ko: "미라지", en: "The Mirage" },
  4: { ko: "사하라", en: "Sahara" },
  5: { ko: "룩소르", en: "Luxor" },
  6: { ko: "서커스 서커스", en: "Circus Circus" },
};

// ---------------------------------------------------------------------
// Full-bleed 3:4 tile art (the "table mat" background)
// ---------------------------------------------------------------------

/** Shared 240x320 canvas + rounded-rect clip every scene paints into. */
function TileScene({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <defs>
        <clipPath id={`${id}-tile-clip`}>
          <rect x="0" y="0" width="240" height="320" rx="18" ry="18" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-tile-clip)`}>{children}</g>
    </>
  );
}

function scatterStars(seedX: number[], seedY: number[], r: number[], opacity = 0.85) {
  return (
    <g fill="#fff7dc" opacity={opacity}>
      {seedX.map((x, i) => (
        <circle key={i} cx={x} cy={seedY[i]} r={r[i % r.length]} />
      ))}
    </g>
  );
}

function GoldNuggetTile({ id }: { id: string }) {
  return (
    <TileScene id={id}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="45%" stopColor="#e8a531" />
          <stop offset="100%" stopColor="#4a2a06" />
        </linearGradient>
        <radialGradient id={`${id}-nugget`} cx="35%" cy="25%" r="85%">
          <stop offset="0%" stopColor="#fff3c4" />
          <stop offset="55%" stopColor="#f2b632" />
          <stop offset="100%" stopColor="#7a4e07" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-sky)`} />
      {/* distant mountain range */}
      <path d="M-10 175 L40 130 L75 160 L115 110 L150 155 L190 125 L250 168 L250 240 L-10 240 Z" fill="#7a4e07" opacity="0.55" />
      {/* mining-town skyline at the base */}
      <g fill="#2c1a04" opacity="0.75">
        <rect x="18" y="255" width="16" height="34" />
        <path d="M20 255 h12 l-6 -14 Z" />
        <rect x="188" y="248" width="20" height="41" />
        <rect x="196" y="238" width="4" height="14" />
        <rect x="60" y="262" width="10" height="27" />
      </g>
      {/* big faceted nugget centerpiece */}
      <path
        d="M60 240 L72 178 L120 148 L172 172 L188 235 L150 296 L92 292 Z"
        fill={`url(#${id}-nugget)`}
        stroke="#5c3a05"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <g stroke="#c07f10" strokeWidth="2" opacity="0.65" strokeLinecap="round" fill="none">
        <path d="M88 200 L120 186 L152 208" />
        <path d="M100 240 L140 252" />
        <path d="M120 148 L118 292" />
      </g>
      {/* sparkle */}
      <path d="M150 158 l6 13 13 6 -13 6 -6 13 -6 -13 -13 -6 13 -6Z" fill="#fff7dc" />
      <path d="M188 200 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5 -8 -8 -3.5 8 -3.5Z" fill="#fff7dc" opacity="0.9" />
    </TileScene>
  );
}

function CaesarsPalaceTile({ id }: { id: string }) {
  const columnXs = [30, 74, 166, 210];
  return (
    <TileScene id={id}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fdf6e3" />
          <stop offset="45%" stopColor="#b48a3f" />
          <stop offset="100%" stopColor="#301a3c" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-sky)`} />
      {/* receding colonnade */}
      {columnXs.map((x, i) => (
        <g key={i}>
          <rect x={x} y={100} width="18" height="180" fill="#fde68a" stroke="#78350f" strokeWidth="1.5" />
          <rect x={x - 4} y={92} width="26" height="10" fill="#fde68a" stroke="#78350f" strokeWidth="1.5" />
          <g stroke="#78350f" strokeWidth="1" opacity="0.6">
            <path d={`M${x + 4} 100 V280`} />
            <path d={`M${x + 9} 100 V280`} />
            <path d={`M${x + 14} 100 V280`} />
          </g>
        </g>
      ))}
      {/* central marble pillar (hero column) */}
      <rect x="98" y="60" width="44" height="230" fill="#fef3c7" stroke="#78350f" strokeWidth="2" />
      <rect x="90" y="48" width="60" height="16" fill="#fef3c7" stroke="#78350f" strokeWidth="2" />
      <rect x="90" y="284" width="60" height="14" fill="#fef3c7" stroke="#78350f" strokeWidth="2" />
      <g stroke="#78350f" strokeWidth="1.2" opacity="0.7">
        <path d="M108 64 V284" />
        <path d="M120 64 V284" />
        <path d="M132 64 V284" />
      </g>
      {/* laurel wreath arc around the hero column */}
      <g fill="#facc15" stroke="#78350f" strokeWidth="0.8">
        {[...Array(6)].map((_, i) => {
          const t = i / 5;
          const x = 70 + t * 50;
          const y = 44 + Math.sin(t * Math.PI) * 26;
          const rot = -70 + t * 140;
          return <ellipse key={`l${i}`} cx={x} cy={y} rx="8" ry="4" transform={`rotate(${rot} ${x} ${y})`} />;
        })}
        {[...Array(6)].map((_, i) => {
          const t = i / 5;
          const x = 170 - t * 50;
          const y = 44 + Math.sin(t * Math.PI) * 26;
          const rot = 70 - t * 140;
          return <ellipse key={`r${i}`} cx={x} cy={y} rx="8" ry="4" transform={`rotate(${rot} ${x} ${y})`} />;
        })}
      </g>
      {/* marble floor strip */}
      <g opacity="0.35" stroke="#301a3c" strokeWidth="1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M${i * 48} 300 L${i * 48 + 30} 320`} />
        ))}
      </g>
    </TileScene>
  );
}

function MirageTile({ id }: { id: string }) {
  return (
    <TileScene id={id}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#c7fbee" />
          <stop offset="45%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#062b29" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-sky)`} />
      {/* volcano */}
      <path d="M70 220 L120 90 L170 220 Z" fill="#3f5c31" stroke="#1e3417" strokeWidth="2" strokeLinejoin="round" />
      <path d="M108 130 Q120 100 132 130 L120 175 Z" fill="#fb923c" />
      <path d="M118 96 q6 -14 14 -8 q-4 10 -10 14Z" fill="#fde68a" opacity="0.9" />
      {/* palms either side */}
      {[
        { x: 40, s: 1 },
        { x: 200, s: -1 },
      ].map(({ x, s }, i) => (
        <g key={i} transform={`translate(${x} 235)`}>
          <path d={`M0 0 Q${6 * s} -30 ${2 * s} -58`} stroke="#2c1a04" strokeWidth="5" fill="none" strokeLinecap="round" />
          <g fill="#166534">
            <ellipse cx={2 * s} cy={-58} rx="22" ry="8" transform={`rotate(${-20 * s} ${2 * s} -58)`} />
            <ellipse cx={2 * s} cy={-58} rx="22" ry="8" transform={`rotate(${20 * s} ${2 * s} -58)`} />
            <ellipse cx={2 * s} cy={-58} rx="20" ry="7" transform={`rotate(${70 * s} ${2 * s} -58)`} />
          </g>
        </g>
      ))}
      {/* oasis water + reflection ripples */}
      <rect x="0" y="235" width="240" height="85" fill="#0d9488" opacity="0.9" />
      <g stroke="#5eead4" strokeWidth="1.6" opacity="0.55" strokeLinecap="round">
        <path d="M14 255 h44" />
        <path d="M90 268 h60" />
        <path d="M20 285 h56" />
        <path d="M120 250 h50" />
        <path d="M160 298 h60" />
        <path d="M30 305 h70" />
      </g>
    </TileScene>
  );
}

function SaharaTile({ id }: { id: string }) {
  const starX = [24, 58, 96, 130, 168, 200, 46, 150, 210, 12];
  const starY = [22, 46, 14, 34, 20, 50, 70, 62, 74, 88];
  const starR = [1.1, 0.8, 1.3, 0.7, 1, 0.9];
  return (
    <TileScene id={id}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0b1245" />
          <stop offset="42%" stopColor="#3b2f6b" />
          <stop offset="72%" stopColor="#c9862f" />
          <stop offset="100%" stopColor="#f2b632" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-sky)`} />
      {scatterStars(starX, starY, starR)}
      {/* dune horizon */}
      <path d="M-10 220 Q60 190 130 218 T250 205 L250 320 L-10 320 Z" fill="#fde68a" opacity="0.95" />
      <path d="M-10 250 Q80 225 150 248 T250 238 L250 320 L-10 320 Z" fill="#e8a531" opacity="0.9" />
      {/* onion dome palace */}
      <g transform="translate(120 130)">
        <path d="M-26 90 V30 H26 V90 Z" fill="#fef3c7" stroke="#8a5a08" strokeWidth="2" />
        <path d="M-30 30 Q0 -34 30 30 Z" fill="#0d9488" stroke="#04463f" strokeWidth="2" />
        <path d="M-2 -34 h4 v-14 h-4 Z" fill="#0d9488" />
        <circle cx="0" cy="-50" r="4" fill="#facc15" />
        <path d="M-18 40 h36 M-18 55 h36 M-18 70 h36" stroke="#8a5a08" strokeWidth="1.4" opacity="0.6" />
      </g>
      {/* camel silhouette walking the dune line */}
      <g transform="translate(38 208) scale(0.85)" fill="#3d2a10" opacity="0.85">
        <path d="M0 40 Q2 18 14 14 Q16 2 26 4 Q30 -8 38 2 Q44 -2 46 8 Q54 8 54 18 L54 40 L46 40 L46 30 L36 30 L36 40 L28 40 L28 26 L14 26 L14 40 Z" />
      </g>
    </TileScene>
  );
}

function LuxorTile({ id }: { id: string }) {
  return (
    <TileScene id={id}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0a1230" />
          <stop offset="60%" stopColor="#111a3d" />
          <stop offset="100%" stopColor="#020617" />
        </linearGradient>
        <linearGradient id={`${id}-beam`} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#fff7dc" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-sky)`} />
      {scatterStars([20, 50, 200, 220, 80, 160], [16, 34, 20, 46, 12, 28], [0.9, 0.7, 1.1, 0.8, 0.6], 0.7)}
      {/* light beam shooting up from the apex */}
      <path d="M116 96 L94 -20 H146 L124 96 Z" fill={`url(#${id}-beam)`} />
      {/* black glass pyramid */}
      <path d="M56 260 L120 96 L184 260 Z" fill="#0f172a" stroke="#facc15" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M120 96 L140 260 L100 260 Z" fill="#1e293b" opacity="0.7" />
      <g stroke="#facc15" strokeWidth="0.8" opacity="0.5">
        <path d="M120 96 L104 260" />
        <path d="M120 96 L136 260" />
        <path d="M120 96 L152 260" />
        <path d="M120 96 L88 260" />
      </g>
      {/* obelisk */}
      <path d="M198 260 L206 150 L214 150 L222 260 Z" fill="#1e293b" stroke="#facc15" strokeWidth="1.4" />
      <g stroke="#facc15" strokeWidth="0.6" opacity="0.55">
        <path d="M204 175 h14" />
        <path d="M203 200 h16" />
        <path d="M202 225 h18" />
      </g>
      {/* sphinx-ish guardian at the base */}
      <path d="M20 260 Q22 235 46 236 Q60 236 62 260 L62 272 L20 272 Z" fill="#1e293b" stroke="#facc15" strokeWidth="1.2" />
      <path d="M32 236 Q38 218 46 236 Z" fill="#1e293b" stroke="#facc15" strokeWidth="1.2" />
      {/* sand line */}
      <rect x="0" y="272" width="240" height="48" fill="#1e293b" opacity="0.85" />
    </TileScene>
  );
}

function CircusCircusTile({ id }: { id: string }) {
  const stripes = 9;
  const apexX = 120;
  const apexY = 20;
  const baseY = 250;
  const halfWidth = 150;
  return (
    <TileScene id={id}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fee2e2" />
          <stop offset="55%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#450a0a" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-sky)`} />
      {/* big-top canopy radiating from the peak */}
      {[...Array(stripes)].map((_, i) => {
        const t0 = i / stripes;
        const t1 = (i + 1) / stripes;
        const x0 = apexX - halfWidth + t0 * halfWidth * 2;
        const x1 = apexX - halfWidth + t1 * halfWidth * 2;
        const dip = Math.sin(((i + 0.5) / stripes) * Math.PI) * 22;
        return (
          <path
            key={i}
            d={`M${apexX} ${apexY} L${x0} ${baseY - dip} Q${(x0 + x1) / 2} ${baseY - dip + 26} ${x1} ${baseY - dip} Z`}
            fill={i % 2 === 0 ? "#fef2f2" : "#dc2626"}
          />
        );
      })}
      {/* topper star */}
      <circle cx={apexX} cy={apexY} r="6" fill="#fde68a" stroke="#78350f" strokeWidth="1" />
      <path d={`m${apexX} ${apexY - 22} 4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4Z`} fill="#fef2f2" />
      {/* scalloped tent trim */}
      <g fill="#fde68a">
        {[...Array(10)].map((_, i) => (
          <circle key={i} cx={12 + i * 24} cy={252} r="12" />
        ))}
      </g>
      {/* red/white checker band at the base */}
      <g>
        {[...Array(10)].map((_, i) => (
          <rect key={i} x={i * 24} y={264} width="24" height="24" fill={i % 2 === 0 ? "#fef2f2" : "#dc2626"} />
        ))}
      </g>
      <rect x="0" y="288" width="240" height="32" fill="#450a0a" />
    </TileScene>
  );
}

const TILE_BODIES: Record<CasinoNumber, (props: { id: string }) => React.JSX.Element> = {
  1: GoldNuggetTile,
  2: CaesarsPalaceTile,
  3: MirageTile,
  4: SaharaTile,
  5: LuxorTile,
  6: CircusCircusTile,
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

function GoldNuggetEmblem({ id }: { id: string }) {
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

function CaesarsPalaceEmblem({ id }: { id: string }) {
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

function MirageEmblem({ id }: { id: string }) {
  return (
    <Medallion id={id} stops={[["0%", "#b6f5e6"], ["50%", "#14b8a6"], ["100%", "#0f3d3a"]]}>
      <path d="M14 48 C18 32 24 30 28 38 C31 30 37 30 40 39 C44 30 50 33 52 48 Z" fill="#22c55e" opacity="0.9" />
      <path d="M24 48 L34 24 L44 48 Z" fill="#7c3a1c" stroke="#4a220e" strokeWidth="1" strokeLinejoin="round" />
      <path d="M30 33 Q34 26 38 33 L34 40 Z" fill="#fb923c" />
      <circle cx="34" cy="27" r="3.2" fill="#fde68a" opacity="0.9" />
    </Medallion>
  );
}

function SaharaEmblem({ id }: { id: string }) {
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

function LuxorEmblem({ id }: { id: string }) {
  return (
    <Medallion id={id} stops={[["0%", "#1e293b"], ["100%", "#020617"]]} linear>
      <path d="M32 8 L37 46 L27 46 Z" fill="#fde68a" opacity="0.5" />
      <path d="M18 48 L32 18 L46 48 Z" fill="#0f172a" stroke="#facc15" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M32 18 L38 48 L26 48 Z" fill="#1e293b" opacity="0.6" />
      <g fill="none" stroke="#facc15" strokeWidth="1">
        <path d="M11 48 Q13 42 17 42 Q16 45 18 48" />
        <path d="M9 48 h6" />
      </g>
    </Medallion>
  );
}

function CircusCircusEmblem({ id }: { id: string }) {
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
    1: GoldNuggetEmblem,
    2: CaesarsPalaceEmblem,
    3: MirageEmblem,
    4: SaharaEmblem,
    5: LuxorEmblem,
    6: CircusCircusEmblem,
  }[casino];
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} role="img" aria-label={label}>
      <title>{label}</title>
      <Body id={id} />
    </svg>
  );
}
