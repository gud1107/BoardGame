import { useId, type ReactNode } from "react";
import { GEM_PALETTE } from "./DuelToken";
import type { DuelCard, GemColor, Level } from "./engine";

/**
 * Tier-based Renaissance scene paintings for the development cards' center
 * window — inline SVG only (no image assets), like every other visual here.
 *
 * Each level has 3 fictional trade scenes (level I: mining the stone, II:
 * cutting & trading it, III: presenting it at court). Which one a card gets
 * is a stable hash of its id, so the same card always shows the same scene on
 * both clients.
 *
 * Every scene is painted in depth layers (far → mid → near), lit by one
 * motivated key light (torch, window, sunset, chandelier) whose color rims
 * the figure, plus one ambient glow in the card's own gem color (the crystal
 * vein, the stone under the loupe, the lady's gown…) so the art still reads
 * as "a sapphire card" at a glance. Glows are radial gradients, not blur
 * filters — ~20 cards are on screen at once, and gradients are free to
 * rasterize; the only filter is one static canvas pass per card (grain +
 * brushstrokes), with craquelure as a tiled pattern. Live flames flicker via
 * an opacity-only SMIL loop; the gem's light disperses into faint rainbow
 * caustic fans with seeded gem dust.
 *
 * Drawn in a 100×100 box and rendered with `slice`, so the window can be any
 * aspect. Figures sit left-of-center: the bonus gem floats bottom-right on top.
 */

export interface SceneMeta {
  key: string;
  label: string;
}

const SCENES: Record<Level, SceneMeta[]> = {
  1: [
    { key: "miner", label: "비밀 광맥 탐사공" },
    { key: "panner", label: "강변 사금 채취자" },
    { key: "quarry", label: "알프스 채석공" },
  ],
  2: [
    { key: "cutter", label: "공방 세공 마이스터" },
    { key: "caravan", label: "대상 캐러밴 상인" },
    { key: "ship", label: "항구 무역선 선장" },
  ],
  3: [
    { key: "guild", label: "보석 길드 대상인" },
    { key: "jeweler", label: "궁정 왕실 보석상" },
    { key: "lady", label: "궁정 귀부인" },
  ],
};

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function sceneFor(card: Pick<DuelCard, "id" | "level">): SceneMeta {
  const list = SCENES[card.level];
  return list[hash(card.id) % list.length];
}

interface Accent {
  light: string;
  base: string;
  dark: string;
}

const PRISM: Accent = { light: "#fff4c2", base: "#e0a40a", dark: "#6b4200" };

/** Linear mix of two #rrggbb colors. */
function mix(c1: string, c2: string, t: number) {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const ch = (i: number) => Math.round(p(c1, i) * (1 - t) + p(c2, i) * t).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

interface SceneProps {
  id: string;
  a: Accent;
}

/* ── Shared lighting defs ─────────────────────────────────────────────── */

/**
 * Per-card gradient library. `gA` = gem-colored glow, `gW` = warm flame,
 * `gC` = cool daylight, `shaft` = volumetric light beam (fades downward).
 */
function LightDefs({ id, a }: SceneProps) {
  const glow = (name: string, inner: string, outer: string, o = 0.9) => (
    <radialGradient id={`${id}-${name}`} cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor={inner} stopOpacity={o} />
      <stop offset="0.35" stopColor={outer} stopOpacity={o * 0.45} />
      <stop offset="1" stopColor={outer} stopOpacity="0" />
    </radialGradient>
  );
  return (
    <defs>
      {glow("gA", a.light, a.base)}
      {glow("gW", "#fff1c4", "#f59e0b")}
      {glow("gC", "#eef6ff", "#93c5fd", 0.7)}
      <linearGradient id={`${id}-shaft`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff6d6" stopOpacity="0.55" />
        <stop offset="1" stopColor="#fff6d6" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-rock`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#5b4d42" />
        <stop offset="0.55" stopColor="#2e2620" />
        <stop offset="1" stopColor="#120e0b" />
      </linearGradient>
      {/* Marble column: cylinder shading, lit from the left. */}
      <linearGradient id={`${id}-marble`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#6f6a66" />
        <stop offset="0.3" stopColor="#f3ece2" />
        <stop offset="0.65" stopColor="#b9aea2" />
        <stop offset="1" stopColor="#3a3431" />
      </linearGradient>
      {/* Canvas finish in one pass: fine linen grain + horizontally stretched
          noise that reads as dragged brushstrokes. */}
      <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="g" />
        <feTurbulence type="fractalNoise" baseFrequency="0.05 0.9" numOctaves="2" seed="3" result="s" />
        <feBlend in="g" in2="s" mode="multiply" />
        <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 0.6 0" />
        <feComposite in2="SourceGraphic" operator="in" />
      </filter>
      {/* Craquelure: aged-varnish hairline cracks (dark crack + lit lip), tiled. */}
      <pattern id={`${id}-crack`} width="34" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
        <path
          d="M0 7 L6 9 L11 5 L18 8 L24 4 L34 7 M11 5 L12 14 L8 21 L10 30 M24 4 L26 12 L21 18 L27 24 L25 30 M12 14 L21 18 M0 21 L8 21 M27 24 L34 22"
          fill="none"
          stroke="#120a04"
          strokeOpacity="0.55"
          strokeWidth="0.35"
        />
        <path d="M0 7.5 L6 9.5 L11 5.5 L18 8.5 M12.4 14 L21 18.4" fill="none" stroke="#fff3d6" strokeOpacity="0.18" strokeWidth="0.25" />
      </pattern>
      {/* Prismatic caustic: a spectral band split out of the gem's light. */}
      <linearGradient id={`${id}-prism`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#ff3b6b" stopOpacity="0" />
        <stop offset="0.2" stopColor="#ff5e5e" />
        <stop offset="0.36" stopColor="#ffd84a" />
        <stop offset="0.52" stopColor="#5cf08a" />
        <stop offset="0.68" stopColor="#4ab8ff" />
        <stop offset="0.84" stopColor="#a86bff" />
        <stop offset="1" stopColor="#a86bff" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

/**
 * `flicker` = a live flame (torch, candle, chandelier): the glow breathes on
 * an irregular 1.7s loop, desynced per card by `id` so a market row of
 * candlelit cards doesn't pulse in unison. Opacity-only, so it stays cheap.
 */
const Glow = ({ id, kind, cx, cy, r, flicker = false }: { id: string; kind: "gA" | "gW" | "gC"; cx: number; cy: number; r: number; flicker?: boolean }) => (
  <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-${kind})`}>
    {flicker && <animate attributeName="opacity" values="1;0.78;0.94;0.7;0.9;1" dur="1.7s" begin={`-${(hash(id) % 17) / 10}s`} repeatCount="indefinite" />}
  </circle>
);

/** Volumetric beam: a trapezoid from (x, top) widening downward, tilted by `lean`. */
const Shaft = ({ id, x, w, lean, top = 0, len = 100, o = 1 }: { id: string; x: number; w: number; lean: number; top?: number; len?: number; o?: number }) => (
  <path d={`M${x - w * 0.25} ${top} L${x + w * 0.25} ${top} L${x + lean + w} ${top + len} L${x + lean - w} ${top + len} Z`} fill={`url(#${id}-shaft)`} opacity={o} />
);

/** 4-point sparkle star. */
const Sparkle = ({ x, y, r, color = "#fff" }: { x: number; y: number; r: number; color?: string }) => (
  <path d={`M${x} ${y - r} Q${x + r * 0.15} ${y - r * 0.15} ${x + r} ${y} Q${x + r * 0.15} ${y + r * 0.15} ${x} ${y + r} Q${x - r * 0.15} ${y + r * 0.15} ${x - r} ${y} Q${x - r * 0.15} ${y - r * 0.15} ${x} ${y - r} Z`} fill={color} />
);

/** Faceted crystal in the gem color, with its own glow. */
function Crystal({ id, x, y, s = 1, a, glow = true }: { id: string; x: number; y: number; s?: number; a: Accent; glow?: boolean }) {
  return (
    <g>
      {glow && <Glow id={id} kind="gA" cx={x} cy={y} r={14 * s} />}
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <path d="M0 -7 L5 -2 L3 6 L-3 6 L-5 -2 Z" fill={a.base} stroke={a.light} strokeWidth="0.7" />
        <path d="M0 -7 L2 -1 L0 6 L-2 -1 Z" fill={a.light} fillOpacity="0.6" />
        <path d="M-5 -2 L-2 -1 L-3 6 Z" fill={a.dark} fillOpacity="0.65" />
        <path d="M5 -2 L2 -1 L3 6 Z" fill={a.dark} fillOpacity="0.35" />
      </g>
    </g>
  );
}

/**
 * Head-and-shoulders bust with real shading: the key light (`light` side,
 * `rim` color) brightens that side of the robe and face and draws a rim-light
 * edge; the far side falls into shadow. `cx` = center x, head at y≈50.
 */
function Bust({
  id,
  cx = 40,
  skin,
  cloth,
  light,
  rim,
  collar,
  children,
}: {
  id: string;
  cx?: number;
  skin: string;
  cloth: string;
  light: "left" | "right";
  rim: string;
  collar?: string;
  children?: ReactNode;
}) {
  const L = light === "left";
  const lit = mix(cloth, rim, 0.4);
  const shade = mix(cloth, "#000000", 0.65);
  const side = L ? -1 : 1;
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-cl`} x1={L ? 0 : 1} y1="0" x2={L ? 1 : 0} y2="0.4">
          <stop offset="0" stopColor={lit} />
          <stop offset="0.45" stopColor={cloth} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <radialGradient id={`${id}-sk`} cx={L ? 0.32 : 0.68} cy="0.35" r="0.8">
          <stop offset="0" stopColor={mix(skin, "#ffffff", 0.35)} />
          <stop offset="0.55" stopColor={skin} />
          <stop offset="1" stopColor={mix(skin, "#2a1208", 0.55)} />
        </radialGradient>
      </defs>
      <path d={`M${cx - 27} 100 C${cx - 25} 76, ${cx - 14} 68, ${cx} 68 C${cx + 14} 68, ${cx + 25} 76, ${cx + 27} 100 Z`} fill={`url(#${id}-cl)`} />
      {/* Rim light along the lit shoulder */}
      <path d={`M${cx + side * 27} 100 C${cx + side * 25} 76, ${cx + side * 14} 68, ${cx} 68`} fill="none" stroke={rim} strokeOpacity="0.85" strokeWidth="1.4" />
      {collar && <path d={`M${cx - 12} 70 L${cx} 82 L${cx + 12} 70`} fill="none" stroke={collar} strokeWidth="2.4" strokeLinejoin="round" />}
      <rect x={cx - 5} y="56" width="10" height="14" rx="3" fill={`url(#${id}-sk)`} />
      {/* Chin shadow on the neck */}
      <ellipse cx={cx} cy="61" rx="5" ry="2.5" fill="#000" fillOpacity="0.35" />
      <ellipse cx={cx} cy="50" rx="10" ry="11.5" fill={`url(#${id}-sk)`} />
      <path d={`M${cx + side * 9.6} 45 A10 11.5 0 0 ${L ? 0 : 1} ${cx + side * 6} 59`} fill="none" stroke={rim} strokeOpacity="0.9" strokeWidth="1.1" />
      <ellipse cx={cx - 3.5} cy="50" rx="1.1" ry="1.4" fill="#1f1411" />
      <ellipse cx={cx + 3.5} cy="50" rx="1.1" ry="1.4" fill="#1f1411" />
      <path d={`M${cx + side * 0.5} 51 L${cx - side * 1.2} 54.5`} stroke="#000" strokeOpacity="0.3" strokeWidth="0.9" strokeLinecap="round" />
      <path d={`M${cx - 2.5} 57 Q${cx} 58.3 ${cx + 2.5} 57`} fill="none" stroke="#6b2a16" strokeWidth="1" strokeLinecap="round" />
      {children}
    </g>
  );
}

/** Hanging chandelier: gold arms, candle flames with warm glows, crystal drops. */
function Chandelier({ id, x, y, s = 1 }: { id: string; x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <Glow id={id} kind="gW" cx={0} cy={4} r={22} flicker />
      <path d="M0 -30 V0" stroke="#c9971c" strokeWidth="0.8" />
      <path d="M-14 2 Q-14 8 0 8 Q14 8 14 2 M-8 2 Q-8 6 0 6 Q8 6 8 2" fill="none" stroke="#e0b44a" strokeWidth="1.2" />
      {[-14, -8, 8, 14].map((dx) => (
        <g key={dx}>
          <rect x={dx - 0.6} y="-2" width="1.2" height="4" fill="#fff7e0" />
          <path d={`M${dx} -2 q-1.2 -2 0 -3.6 q1.2 1.6 0 3.6 Z`} fill="#ffd166" />
        </g>
      ))}
      {[-11, -4, 4, 11, 0].map((dx, i) => (
        <path key={i} d={`M${dx} ${8 + (i % 2) * 2} l1 2.5 l-1 2.5 l-1 -2.5 Z`} fill="#eaf6ff" fillOpacity="0.9" />
      ))}
      <Sparkle x={-14} y={-3} r={2.4} />
      <Sparkle x={14} y={-3} r={2.4} />
    </g>
  );
}

/** Heavy velvet drape with shaded folds, in `color`. */
function Drape({ id, color, side }: { id: string; color: string; side: "left" | "right" }) {
  const gid = `${id}-dr${side}`;
  const L = side === "left";
  return (
    <g>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0" spreadMethod="repeat" gradientTransform="scale(0.16 1)">
          <stop offset="0" stopColor={mix(color, "#000000", 0.6)} />
          <stop offset="0.5" stopColor={mix(color, "#ffffff", 0.15)} />
          <stop offset="1" stopColor={mix(color, "#000000", 0.6)} />
        </linearGradient>
      </defs>
      <path d={L ? "M0 0 H28 Q18 42 26 100 H0 Z" : "M100 0 H74 Q84 45 72 100 H100 Z"} fill={`url(#${gid})`} />
      <path d={L ? "M28 0 Q18 42 26 100" : "M74 0 Q84 45 72 100"} fill="none" stroke="#f2c14e" strokeOpacity="0.55" strokeWidth="1" />
      {/* Gold-thread embroidery: a running stitch just inside the hem + fleur studs */}
      <path d={L ? "M24 0 Q14 42 22 100" : "M78 0 Q88 45 76 100"} fill="none" stroke="#f7d774" strokeOpacity="0.6" strokeWidth="0.6" strokeDasharray="1.4 1.2" />
      {(L ? [[18, 20], [15, 48], [18, 76]] : [[82, 20], [85, 48], [81, 76]]).map(([x, y]) => (
        <path key={y} d={`M${x} ${y - 2.2} L${x + 1.2} ${y} L${x} ${y + 2.2} L${x - 1.2} ${y} Z`} fill="#f7d774" fillOpacity="0.7" />
      ))}
    </g>
  );
}

/* ── Tier I · The Secret Mines ────────────────────────────────────────── */

function MinerScene({ id, a }: SceneProps) {
  return (
    <>
      {/* Far: cave depth */}
      <rect width="100" height="100" fill="#0b0907" />
      <radialGradient id={`${id}-cave`} cx="0.55" cy="0.45" r="0.7">
        <stop offset="0" stopColor={mix(a.dark, "#3a2a1c", 0.5)} />
        <stop offset="1" stopColor="#070504" />
      </radialGradient>
      <rect width="100" height="100" fill={`url(#${id}-cave)`} />
      {/* Sunbeam through a ceiling crack */}
      <Shaft id={id} x={62} w={12} lean={-14} />
      <Shaft id={id} x={66} w={5} lean={-10} o={0.8} />
      {/* Stalactites (ceiling) */}
      <path d="M0 0 H100 V10 L94 24 L90 12 L84 30 L78 11 L70 18 L64 8 L56 22 L50 9 L40 26 L34 10 L26 20 L18 8 L10 28 L4 12 L0 16 Z" fill={`url(#${id}-rock)`} />
      <path d="M40 26 L42 20 M84 30 L86 22 M10 28 L12 20" stroke="#8a7a6a" strokeOpacity="0.5" strokeWidth="0.8" />
      {/* Mid: crystal vein wall on the right */}
      <path d="M64 100 L70 46 L84 36 L100 40 V100 Z" fill={`url(#${id}-rock)`} />
      <path d="M70 46 L84 36 L100 40" fill="none" stroke="#a08a72" strokeOpacity="0.6" strokeWidth="0.9" />
      <path d="M74 60 L82 66 L78 78 M88 52 L94 62" stroke="#0a0806" strokeWidth="0.9" fill="none" />
      <Crystal id={id} x={82} y={56} s={1.3} a={a} />
      <Crystal id={id} x={92} y={70} s={0.8} a={a} />
      <Crystal id={id} x={76} y={74} s={0.6} a={a} glow={false} />
      {/* Torch (key light, left) */}
      <Glow id={id} kind="gW" cx={16} cy={40} r={36} flicker />
      <path d="M14 58 L18 42" stroke="#4a2c14" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M18 42 C13 36 18 31 17.5 26 C22 31 23.5 36 18 42 Z" fill="#f59e0b" />
      <path d="M18 41 C16 37 18.5 34 18.3 31 C20.5 34 20.5 37 18 41 Z" fill="#fff1c4" />
      <Bust id={`${id}-b`} cx={42} skin="#d8a57f" cloth="#4a3527" light="left" rim="#ffb45a" collar="#8a6a4a">
        {/* Leather cap + goggles pushed up */}
        <path d="M31 47 C31 36, 38 33, 42 33 C46 33, 53 36, 53 47 C49 42, 35 42, 31 47 Z" fill="#5a3d24" />
        <circle cx="38.5" cy="41" r="3" fill="#9fd3e6" fillOpacity="0.7" stroke="#2a1a0e" strokeWidth="1.1" />
        <circle cx="45.5" cy="41" r="3" fill="#9fd3e6" fillOpacity="0.7" stroke="#2a1a0e" strokeWidth="1.1" />
        <circle cx="37.5" cy="40" r="0.9" fill="#fff" />
        {/* Leather apron */}
        <path d="M32 100 L34 78 Q42 74 50 78 L52 100 Z" fill="#7a4a24" />
        <path d="M34 78 Q42 74 50 78" fill="none" stroke="#ffb45a" strokeOpacity="0.5" strokeWidth="0.8" />
        {/* Hammer striking a wedge into the vein */}
        <path d="M54 84 L66 64" stroke="#6b4423" strokeWidth="2.8" strokeLinecap="round" />
        <rect x="62" y="58" width="10" height="6" rx="1" fill="#8b9199" transform="rotate(-30 67 61)" />
        <path d="M70 64 L76 60" stroke="#c7ccd4" strokeWidth="2.2" strokeLinecap="round" />
        <Sparkle x={75} y={60} r={3} color={a.light} />
      </Bust>
      {/* Near: foreground ledge */}
      <path d="M0 92 Q30 86 60 94 Q80 98 100 92 V100 H0 Z" fill="#0a0706" />
    </>
  );
}

function PannerScene({ id, a }: SceneProps) {
  return (
    <>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a2552" />
        <stop offset="0.5" stopColor="#d9764a" />
        <stop offset="0.7" stopColor="#ffcf8a" />
      </linearGradient>
      <rect width="100" height="100" fill={`url(#${id}-sky)`} />
      <Glow id={id} kind="gW" cx={78} cy={52} r={30} />
      <circle cx="78" cy="54" r="6" fill="#fff1c4" />
      {/* Far → mid mountains (atmospheric perspective: farther = paler) */}
      <path d="M0 58 L18 36 L32 48 L50 30 L68 46 L84 34 L100 50 V64 H0 Z" fill="#9a7496" fillOpacity="0.75" />
      <path d="M0 62 L14 46 L30 58 L44 42 L62 60 L80 50 L100 60 V66 H0 Z" fill="#5a3f62" />
      <path d="M50 30 L54 35 L47 35 Z M84 34 L88 39 L81 39 Z" fill="#fff" fillOpacity="0.7" />
      {/* River with sun reflection */}
      <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e8a26a" />
        <stop offset="1" stopColor="#2c4a66" />
      </linearGradient>
      <path d="M0 64 Q50 60 100 66 L100 82 Q50 76 0 84 Z" fill={`url(#${id}-water)`} />
      <path d="M70 66 H86 M72 70 H84 M74 74 H82" stroke="#fff1c4" strokeOpacity="0.7" strokeWidth="1" />
      <path d="M6 72 Q24 69 40 72" stroke="#cfe8f5" strokeOpacity="0.4" strokeWidth="0.8" fill="none" />
      {/* Near bank + reeds */}
      <path d="M0 80 Q50 74 100 82 V100 H0 Z" fill="#241a10" />
      <path d="M90 100 L88 78 M94 100 L95 76 M97 100 L99 80" stroke="#3a2a14" strokeWidth="1.2" />
      <Bust id={`${id}-b`} cx={36} skin="#c98f64" cloth="#6b4f2a" light="right" rim="#ffc27a" collar="#b08a57">
        <ellipse cx="36" cy="40" rx="18" ry="4.5" fill="#b8903e" />
        <path d="M18 40 Q36 36 54 40" fill="none" stroke="#ffd79a" strokeWidth="1" />
        <path d="M28 40 C28 31, 44 31, 44 40 Z" fill="#d9b35a" />
      </Bust>
      {/* Pan with glinting grains */}
      <Glow id={id} kind="gA" cx={68} cy={86} r={14} />
      <ellipse cx="68" cy="88" rx="15" ry="5" fill="#3b3024" stroke="#c9a46a" strokeWidth="1.3" />
      <circle cx="64" cy="87" r="1.3" fill={a.light} />
      <circle cx="70" cy="88.5" r="1.7" fill={a.base} stroke={a.light} strokeWidth="0.5" />
      <circle cx="74" cy="86.5" r="1" fill="#fde68a" />
      <Sparkle x={70} y={86} r={2.6} />
    </>
  );
}

function QuarryScene({ id, a }: SceneProps) {
  return (
    <>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6d8fb5" />
        <stop offset="1" stopColor="#dbe6f0" />
      </linearGradient>
      <rect width="100" height="100" fill={`url(#${id}-sky)`} />
      <Glow id={id} kind="gC" cx={14} cy={10} r={30} />
      {/* Far snow peaks */}
      <path d="M0 50 L22 16 L36 32 L56 6 L78 30 L100 18 V60 H0 Z" fill="#8c9bb0" />
      <path d="M22 16 L28 26 L18 24 Z M56 6 L64 18 L50 16 Z M100 18 L100 28 L92 24 Z" fill="#ffffff" />
      <Shaft id={id} x={18} w={10} lean={20} o={0.7} />
      {/* Mid: quarried cliff — blocks with lit tops and shadowed sides */}
      {[
        [56, 44, 22, 14],
        [78, 40, 22, 18],
        [52, 58, 20, 16],
        [72, 58, 28, 16],
        [48, 74, 26, 26],
        [74, 74, 26, 26],
      ].map(([x, y, w, h], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} fill={i % 2 ? "#8b8177" : "#9a9086"} />
          <rect x={x} y={y} width={w} height="2.4" fill="#e6dccf" />
          <rect x={x + w - 3} y={y} width="3" height={h} fill="#4d453e" />
        </g>
      ))}
      <Crystal id={id} x={80} y={66} s={1.3} a={a} />
      <Crystal id={id} x={90} y={82} s={0.8} a={a} />
      <Bust id={`${id}-b`} cx={34} skin="#e0b08c" cloth="#7a2e1f" light="left" rim="#fff4d8" collar="#d6a45a">
        <path d="M24 46 C24 36, 32 34, 34 34 C40 34, 45 38, 44 46 C40 41, 28 41, 24 46 Z" fill="#3a2718" />
        {/* Hammer and chisel */}
        <path d="M50 96 L54 66" stroke="#6b4423" strokeWidth="3" strokeLinecap="round" />
        <rect x="48" y="60" width="12" height="7" rx="1.5" fill="#9ca3af" />
        <rect x="48" y="60" width="12" height="2" rx="1" fill="#e5e7eb" />
      </Bust>
      <path d="M0 94 L20 90 L34 96 L56 92 L100 96 V100 H0 Z" fill="#4d453e" />
    </>
  );
}

/* ── Tier II · Guild Atelier & Trade ──────────────────────────────────── */

function CutterScene({ id, a }: SceneProps) {
  return (
    <>
      {/* Stone atelier wall */}
      <rect width="100" height="100" fill="#2a211b" />
      <path d="M0 20 H100 M0 40 H100 M0 60 H100 M20 0 V20 M50 20 V40 M30 40 V60 M80 0 V20 M90 40 V60" stroke="#1a140f" strokeWidth="1" />
      {/* Arched window → harbor with a moored carrack */}
      <linearGradient id={`${id}-win`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6e9cc4" />
        <stop offset="0.7" stopColor="#f6d6a0" />
      </linearGradient>
      <path d="M56 58 V22 Q73 6 90 22 V58 Z" fill={`url(#${id}-win)`} />
      <path d="M56 50 H90 V58 H56 Z" fill="#35577a" />
      <path d="M66 50 L82 50 L79 54 L69 54 Z" fill="#2a1a10" />
      <path d="M74 50 V32" stroke="#2a1a10" strokeWidth="0.9" />
      <path d="M74 33 Q82 40 74 47 Z" fill="#f4ecd8" fillOpacity="0.9" />
      <path d="M73 6 V58 M56 36 H90" stroke="#3a2c20" strokeWidth="2" />
      <path d="M56 58 V22 Q73 6 90 22 V58" fill="none" stroke="#6b5846" strokeWidth="2.5" />
      {/* Daylight beam falling across the bench */}
      <Shaft id={id} x={70} w={16} lean={-26} top={40} len={60} o={0.8} />
      {/* Workbench */}
      <rect y="82" width="100" height="18" fill="#4a2e18" />
      <rect y="80" width="100" height="3" fill="#8a5a2f" />
      {/* Parchment sea chart */}
      <path d="M2 84 L26 82 L28 96 L4 98 Z" fill="#e9d6a8" />
      <path d="M6 88 Q14 85 22 90 M8 93 L20 91" stroke="#8a6a3a" strokeWidth="0.6" fill="none" />
      {/* Candle (warm key) */}
      <Glow id={id} kind="gW" cx={92} cy={70} r={20} flicker />
      <rect x="90" y="72" width="4" height="10" fill="#f5ecd5" />
      <path d="M92 72 q-1.5 -3 0 -5 q1.5 2 0 5 Z" fill="#ffd166" />
      <Bust id={`${id}-b`} cx={38} skin="#e3b391" cloth="#23304a" light="right" rim="#ffe0a8" collar="#c9a14a">
        {/* Velvet beret */}
        <path d="M26 46 C22 36, 34 30, 42 32 C52 32, 56 38, 50 44 C44 40, 32 40, 26 46 Z" fill="#7f1d1d" />
        <path d="M42 32 C52 32, 56 38, 50 44" fill="none" stroke="#ff9a8a" strokeOpacity="0.6" strokeWidth="1" />
        {/* Lace ruff */}
        <path d="M28 68 Q33 64 38 68 Q43 64 48 68 Q43 72 38 70 Q33 72 28 68 Z" fill="#f8fafc" fillOpacity="0.9" />
        {/* Loupe */}
        <circle cx="41.5" cy="50" r="4" fill="#bfe7f5" fillOpacity="0.45" stroke="#d4a52a" strokeWidth="1.6" />
      </Bust>
      {/* The stone under a focused beam + brass tweezers */}
      <path d="M62 60 L78 60 L74 80 L66 80 Z" fill="#fff6d6" fillOpacity="0.14" />
      <Crystal id={id} x={70} y={76} s={1.15} a={a} />
      <path d="M58 60 L67 72 M61 58 L70 70" stroke="#e0b44a" strokeWidth="1.3" strokeLinecap="round" />
      <Sparkle x={73} y={72} r={2.6} />
    </>
  );
}

function CaravanScene({ id, a }: SceneProps) {
  return (
    <>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5a2340" />
        <stop offset="0.55" stopColor="#f08a3e" />
        <stop offset="0.8" stopColor="#ffd68a" />
      </linearGradient>
      <rect width="100" height="100" fill={`url(#${id}-sky)`} />
      <Glow id={id} kind="gW" cx={74} cy={50} r={34} />
      <circle cx="74" cy="52" r="10" fill="#fff1c4" />
      {/* Far → near dunes */}
      <path d="M0 60 Q26 50 50 58 Q76 66 100 54 V70 H0 Z" fill="#c67a45" fillOpacity="0.85" />
      <path d="M0 68 Q30 58 55 66 Q80 74 100 62 L100 100 L0 100 Z" fill="#9c5a2c" />
      <path d="M55 66 Q80 74 100 62" fill="none" stroke="#ffcf8a" strokeOpacity="0.7" strokeWidth="1" />
      <path d="M0 84 Q40 74 100 86 L100 100 L0 100 Z" fill="#5e3318" />
      {/* Camel line against the sun, with rim light */}
      {[60, 76, 90].map((x, i) => (
        <g key={x} transform={`translate(${x} ${64 - i}) scale(${1 - i * 0.15})`}>
          <path d="M0 0 q2 -6 5 -1 q2 -5 5 0 l3 -4 l1 2 l-2 4 l0 6 m-1 0 l0 -5 m-9 5 l0 -6 m3 6 l0 -6" fill="#2a130a" stroke="#2a130a" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M2 -1 q1 -4 3 0 q1 -4 3 0" fill="none" stroke="#ffcf8a" strokeWidth="0.5" />
        </g>
      ))}
      <Bust id={`${id}-b`} cx={36} skin="#b97c52" cloth="#1f4a5a" light="right" rim="#ffc27a" collar="#e0a40a">
        {/* Turban with jewel pin */}
        <path d="M24 46 C22 32, 32 28, 36 28 C44 28, 50 32, 48 46 C44 40, 28 40, 24 46 Z" fill="#efe7d8" />
        <path d="M25 40 Q36 34 47 40 M26 35 Q36 30 46 35" stroke="#c4b69e" strokeWidth="1.2" fill="none" />
        <Crystal id={id} x={36} y={34} s={0.55} a={a} />
      </Bust>
      {/* Open trade chest spilling light */}
      <Glow id={id} kind="gA" cx={70} cy={86} r={16} />
      <rect x="59" y="84" width="22" height="12" rx="1.5" fill="#5a2e12" stroke="#e0a40a" strokeWidth="1.2" />
      <path d="M59 84 L62 76 L84 76 L81 84 Z" fill="#6b3a1a" stroke="#e0a40a" strokeWidth="1" />
      <circle cx="66" cy="84" r="1.8" fill={a.base} stroke={a.light} strokeWidth="0.5" />
      <circle cx="72" cy="83" r="1.4" fill="#fde68a" />
      <Sparkle x={70} y={80} r={2.4} />
    </>
  );
}

function ShipScene({ id, a }: SceneProps) {
  return (
    <>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4c6f94" />
        <stop offset="0.6" stopColor="#f3c98a" />
      </linearGradient>
      <rect width="100" height="100" fill={`url(#${id}-sky)`} />
      <Glow id={id} kind="gW" cx={20} cy={50} r={30} />
      {/* Far: harbor town skyline (domes & towers) */}
      <path d="M40 60 V52 H46 V46 H50 V52 Q54 44 58 52 H64 V48 H68 V60 Z" fill="#6a5a6e" fillOpacity="0.6" />
      {/* Water */}
      <linearGradient id={`${id}-sea`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8aa6bf" />
        <stop offset="1" stopColor="#14283f" />
      </linearGradient>
      <rect y="60" width="100" height="40" fill={`url(#${id}-sea)`} />
      <path d="M0 66 Q12 63 24 66 T48 66 T72 66 T100 66 M10 74 Q30 71 50 74" stroke="#e8f1f8" strokeOpacity="0.5" fill="none" strokeWidth="0.8" />
      {/* Mid: galleon with shaded sails */}
      <linearGradient id={`${id}-sail`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fffaf0" />
        <stop offset="1" stopColor="#b8a98c" />
      </linearGradient>
      <path d="M52 62 L94 62 L88 72 L58 72 Z" fill="#3a2010" />
      <path d="M52 62 L94 62" stroke="#ffcf8a" strokeWidth="0.8" />
      <path d="M66 62 V16 M82 62 V24" stroke="#2a1a0e" strokeWidth="1.6" />
      <path d="M66 18 Q79 28 66 40 Z M66 42 Q81 51 66 60 Z M82 26 Q92 34 82 42 Z M82 44 Q91 50 82 58 Z" fill={`url(#${id}-sail)`} />
      <path d="M66 16 L74 18 L66 20 Z" fill="#b91c1c" />
      <path d="M58 76 Q74 74 90 76" stroke="#3a2010" strokeOpacity="0.4" strokeWidth="2" />
      <Bust id={`${id}-b`} cx={32} skin="#dca982" cloth="#3a1d4a" light="left" rim="#ffd79a" collar="#e0a40a">
        {/* Plumed captain's hat */}
        <ellipse cx="32" cy="40" rx="15" ry="4" fill="#161616" />
        <path d="M24 40 C24 32, 40 32, 40 40 Z" fill="#161616" />
        <path d="M17 40 Q26 38 32 40" stroke="#ffd79a" strokeOpacity="0.6" strokeWidth="0.8" />
        <path d="M38 34 Q48 26 50 34" stroke="#f8fafc" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* Brooch */}
        <Glow id={id} kind="gA" cx={32} cy={80} r={8} />
        <circle cx="32" cy="80" r="2.6" fill={a.base} stroke={a.light} strokeWidth="0.8" />
      </Bust>
      {/* Near: quay stones + rolled chart */}
      <path d="M0 92 H100 V100 H0 Z" fill="#3e3630" />
      <path d="M0 92 H100" stroke="#8a7d70" strokeWidth="0.8" />
      <rect x="56" y="86" width="22" height="6" rx="3" fill="#e9d6a8" stroke="#8a6a3a" strokeWidth="0.6" />
    </>
  );
}

/* ── Tier III · The Royal Presentation ────────────────────────────────── */

function Column({ id, x, w = 10 }: { id: string; x: number; w?: number }) {
  return (
    <g>
      <rect x={x} y="10" width={w} height="90" fill={`url(#${id}-marble)`} />
      <rect x={x - 2} y="8" width={w + 4} height="4" fill="#d9c79a" />
      <path d={`M${x + w * 0.3} 20 Q${x + w * 0.5} 50 ${x + w * 0.35} 90`} stroke="#8a8078" strokeOpacity="0.4" strokeWidth="0.5" fill="none" />
    </g>
  );
}

function GuildScene({ id, a }: SceneProps) {
  return (
    <>
      <radialGradient id={`${id}-hall`} cx="0.5" cy="0.2" r="0.9">
        <stop offset="0" stopColor="#6b3a1a" />
        <stop offset="0.6" stopColor="#1f0d10" />
        <stop offset="1" stopColor="#070304" />
      </radialGradient>
      <rect width="100" height="100" fill={`url(#${id}-hall)`} />
      <Column id={id} x={84} />
      <Drape id={id} color="#5c0a1c" side="left" />
      <Chandelier id={id} x={70} y={20} s={0.8} />
      <Bust id={`${id}-b`} cx={42} skin="#e7bb96" cloth="#141018" light="left" rim="#ffd98a" collar="#f2c14e">
        {/* Ebony robe with fur collar + beret */}
        <path d="M18 88 C24 74, 34 70, 42 70 C50 70, 60 74, 66 88 C56 82, 28 82, 18 88 Z" fill="#6e553c" />
        <path d="M18 88 C24 74, 34 70, 42 70" fill="none" stroke="#ffd98a" strokeOpacity="0.5" strokeWidth="1" />
        <path d="M29 44 C28 33, 56 33, 55 44 C50 39, 34 39, 29 44 Z" fill="#0d0b10" />
        <path d="M32 58 C33 66, 51 66, 52 58 C48 62, 36 62, 32 58 Z" fill="#5a4030" />
        {/* Chain of office with the guild stone */}
        <path d="M30 78 Q42 94 54 78" fill="none" stroke="#f2c14e" strokeWidth="2" strokeDasharray="2 1.2" />
        <Crystal id={id} x={42} y={90} s={0.8} a={a} />
        <Sparkle x={45} y={87} r={2.4} />
      </Bust>
    </>
  );
}

function JewelerScene({ id, a }: SceneProps) {
  return (
    <>
      <rect width="100" height="100" fill="#140d18" />
      {/* Palace arch window at night */}
      <linearGradient id={`${id}-night`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#0f1e3d" />
        <stop offset="1" stopColor="#35507a" />
      </linearGradient>
      <path d="M58 100 V38 Q74 18 90 38 V100 Z" fill={`url(#${id}-night)`} />
      <path d="M74 22 V100 M58 58 H90" stroke="#d4a52a" strokeOpacity="0.55" strokeWidth="1.1" />
      <circle cx="84" cy="34" r="0.8" fill="#fff" />
      <circle cx="66" cy="46" r="0.6" fill="#fff" />
      <Column id={id} x={48} w={8} />
      <Chandelier id={id} x={32} y={16} s={0.85} />
      <Bust id={`${id}-b`} cx={30} skin="#e9c09c" cloth="#0f3d33" light="right" rim="#ffe0a0" collar="#f2c14e">
        <path d="M20 46 C19 34, 26 31, 30 31 C36 31, 42 35, 41 45 C37 39, 24 39, 20 46 Z" fill="#a8a29e" />
        <path d="M20 50 C20 62, 40 62, 40 50 C36 58, 24 58, 20 50 Z" fill="#a8a29e" />
      </Bust>
      {/* Crown on a velvet cushion, set with the card's stone */}
      <Glow id={id} kind="gA" cx={72} cy={74} r={20} />
      <ellipse cx="72" cy="88" rx="19" ry="6" fill="#7a0e2c" />
      <ellipse cx="72" cy="86" rx="17" ry="4" fill="#a3163e" />
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff4c2" />
        <stop offset="0.5" stopColor="#e0a40a" />
        <stop offset="1" stopColor="#7a4a00" />
      </linearGradient>
      <path d="M59 85 L59 70 L65 76 L72 63 L79 76 L85 70 L85 85 Z" fill={`url(#${id}-gold)`} stroke="#6b4200" strokeWidth="0.7" strokeLinejoin="round" />
      <circle cx="72" cy="79" r="3.2" fill={a.base} stroke={a.light} strokeWidth="0.8" />
      <circle cx="64" cy="81" r="1.3" fill="#f8fafc" />
      <circle cx="80" cy="81" r="1.3" fill="#f8fafc" />
      <Sparkle x={72} y={62} r={3} />
      <Sparkle x={84} y={70} r={2} />
    </>
  );
}

function LadyScene({ id, a }: SceneProps) {
  return (
    <>
      <radialGradient id={`${id}-hall`} cx="0.45" cy="0.3" r="0.9">
        <stop offset="0" stopColor="#5a2a2a" />
        <stop offset="1" stopColor="#0c0406" />
      </radialGradient>
      <rect width="100" height="100" fill={`url(#${id}-hall)`} />
      <Column id={id} x={2} w={9} />
      <Drape id={id} color="#6b0f24" side="right" />
      <Chandelier id={id} x={44} y={12} s={0.7} />
      {/* The gown is the card's own gem color */}
      <Bust id={`${id}-b`} cx={44} skin="#f3d2b8" cloth={a.base} light="left" rim="#ffe7b0" collar="#f2c14e">
        {/* Hair up + diamond tiara */}
        <path d="M33 50 C31 34, 40 30, 44 30 C50 30, 58 34, 55 50 C52 40, 36 40, 33 50 Z" fill="#5a2e14" />
        <path d="M36 36 L39 30 L42 34 L44 27 L46 34 L49 30 L52 36 Q44 33 36 36 Z" fill="#f2c14e" />
        <circle cx="44" cy="30.5" r="1.6" fill="#f8fafc" />
        <Sparkle x={44} y={28} r={3.2} />
        {/* Lace ruff */}
        <path d="M30 70 Q37 64 44 70 Q51 64 58 70 Q51 76 44 72 Q37 76 30 70 Z" fill="#f8fafc" fillOpacity="0.92" />
        {/* Pendant necklace */}
        <path d="M34 78 Q44 88 54 78" fill="none" stroke="#f2c14e" strokeWidth="1.2" />
        <Crystal id={id} x={44} y={86} s={0.85} a={a} />
      </Bust>
    </>
  );
}

const RENDER: Record<string, (p: SceneProps) => ReactNode> = {
  miner: MinerScene,
  panner: PannerScene,
  quarry: QuarryScene,
  cutter: CutterScene,
  caravan: CaravanScene,
  ship: ShipScene,
  guild: GuildScene,
  jeweler: JewelerScene,
  lady: LadyScene,
};

/** Tier ambient: I warm amber (lamplight), II honey gold (atelier), III champagne (court). */
const LEVEL_TONE: Record<Level, string> = { 1: "#f59e0b", 2: "#fcd34d", 3: "#fde68a" };

/** Full-bleed scene painting for a card; sized by its (relative) parent. */
export default function CardScene({ card, color, className = "" }: { card: Pick<DuelCard, "id" | "level">; color: GemColor | null; className?: string }) {
  const id = useId().replace(/:/g, "");
  const scene = sceneFor(card);
  const a = color ? GEM_PALETTE[color] : PRISM;
  const Scene = RENDER[scene.key];
  // 7 motes along the caustic fans, seeded by card id so both clients match.
  const seed = hash(card.id);
  const dust = Array.from({ length: 7 }, (_, i) => {
    const t = ((seed >> (i * 3)) & 7) / 8;
    return [88 - (20 + i * 9) * (0.9 + t * 0.2), 88 - (14 + i * 7) * (0.8 + t * 0.4), 0.35 + t * 0.5] as const;
  });
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden="true">
      <LightDefs id={id} a={a} />
      <Scene id={id} a={a} />
      {/* Spectral dispersion: the bonus stone (floating bottom-right) splits
          its light into two faint rainbow fans across the canvas, plus a
          stable scatter of gem dust in its color. */}
      <g style={{ mixBlendMode: "screen" }} opacity={card.level === 3 ? 0.3 : 0.2}>
        <rect x="-10" y="70" width="130" height="7" fill={`url(#${id}-prism)`} transform="rotate(-38 88 88)" />
        <rect x="-10" y="80" width="120" height="4" fill={`url(#${id}-prism)`} transform="rotate(-24 88 88)" opacity="0.7" />
      </g>
      {dust.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={i % 3 ? a.light : "#ffffff"} fillOpacity={0.55 + (i % 2) * 0.3} />
      ))}
      {/* Oil-painting finish: canvas grain + brushstrokes, craquelure, tier varnish, gem-tinted ambient, vignette */}
      <rect width="100" height="100" fill="#000" filter={`url(#${id}-grain)`} opacity="0.35" />
      <rect width="100" height="100" fill={`url(#${id}-crack)`} />
      <linearGradient id={`${id}-var`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={LEVEL_TONE[card.level]} stopOpacity="0.2" />
        <stop offset="0.6" stopColor={a.base} stopOpacity="0.08" />
        <stop offset="1" stopColor="#1a0f00" stopOpacity="0.3" />
      </linearGradient>
      <rect width="100" height="100" fill={`url(#${id}-var)`} />
      <radialGradient id={`${id}-vig`} cx="0.45" cy="0.45" r="0.75">
        <stop offset="0.55" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.7" />
      </radialGradient>
      <rect width="100" height="100" fill={`url(#${id}-vig)`} />
    </svg>
  );
}
