import type { CasinoNumber } from "./engine";

/**
 * Pure inline-SVG casino theme emblems for the 6 casino tiles — no external
 * image assets, same "<Feature>Icon.tsx" convention as DiceIcon.tsx and every
 * other icon component in this project (CucumberIcon.tsx, GemToken.tsx,
 * ResourceIcon.tsx, PerudoFaceIcon.tsx). The rulebook itself never names the
 * casinos (`boardGameRule/라스베가스/라스베가스.md` — always just "N번 카지노"),
 * but the user supplied reference photos of 6 real Las Vegas Strip casinos,
 * numbered to the tiles, and asked for those specific identities
 * (`boardGameRule/라스베가스/골드너겟1.jpg` … `서커스 서커스6.jpg`). Each emblem
 * below is an original flat-icon *reinterpretation* of that casino's most
 * recognizable motif (nugget / laurel column / volcano / desert dome / black
 * pyramid+beam / big-top tent) — not a reproduction of any casino's actual
 * logo, signage typography, or photograph.
 */

export const CASINO_THEME_NAMES: Record<CasinoNumber, { ko: string; en: string }> = {
  1: { ko: "골드너겟", en: "Golden Nugget" },
  2: { ko: "시저스 팰리스", en: "Caesars Palace" },
  3: { ko: "미라지", en: "The Mirage" },
  4: { ko: "사하라", en: "Sahara" },
  5: { ko: "룩소르", en: "Luxor" },
  6: { ko: "서커스 서커스", en: "Circus Circus" },
};

/** Shared medallion backdrop (radial/linear gradient disc + soft ring) every emblem sits on. */
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
