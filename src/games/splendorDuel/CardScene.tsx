import { useId, type ReactNode } from "react";
import { GEM_PALETTE } from "./DuelToken";
import type { DuelCard, GemColor, Level } from "./engine";

/**
 * Tier-based Renaissance scene art for the development cards' center window
 * — inline SVG only (no image assets), like every other visual here.
 *
 * Each level has 3 fictional trade scenes (level I: mining the stone, II:
 * cutting & trading it, III: selling it to the court). Which one a card gets
 * is a stable hash of its id, so the same card always shows the same scene on
 * both clients. Every scene carries one accent in the card's own gem color
 * (the crystal in the rock, the stone under the loupe, the lady's necklace…),
 * so the art still reads as "a sapphire card" at a glance.
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
    { key: "miner", label: "갱도 광부" },
    { key: "panner", label: "강변 사금 채취자" },
    { key: "quarry", label: "알프스 채석공" },
  ],
  2: [
    { key: "cutter", label: "보석 세공 장인" },
    { key: "caravan", label: "대상 캐러밴 상인" },
    { key: "ship", label: "항구 무역선 선장" },
  ],
  3: [
    { key: "guild", label: "보석 길드 마스터" },
    { key: "jeweler", label: "궁정 왕실 보석상" },
    { key: "lady", label: "사치품 귀부인" },
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

/* ── Shared figure pieces ─────────────────────────────────────────────── */

/** Head-and-shoulders bust. `cx` = center x, head sits at y≈50. */
function Bust({ cx = 40, skin, cloth, collar, children }: { cx?: number; skin: string; cloth: string; collar?: string; children?: ReactNode }) {
  return (
    <g>
      <path d={`M${cx - 27} 100 C${cx - 25} 76, ${cx - 14} 68, ${cx} 68 C${cx + 14} 68, ${cx + 25} 76, ${cx + 27} 100 Z`} fill={cloth} />
      {collar && <path d={`M${cx - 12} 70 L${cx} 82 L${cx + 12} 70`} fill="none" stroke={collar} strokeWidth="2.4" strokeLinejoin="round" />}
      <rect x={cx - 5} y="56" width="10" height="14" rx="3" fill={skin} />
      <ellipse cx={cx} cy="50" rx="10" ry="11.5" fill={skin} />
      <ellipse cx={cx - 3.5} cy="50" rx="1.1" ry="1.4" fill="#1f1411" />
      <ellipse cx={cx + 3.5} cy="50" rx="1.1" ry="1.4" fill="#1f1411" />
      <path d={`M${cx - 2.5} 56 Q${cx} 57.5 ${cx + 2.5} 56`} fill="none" stroke="#6b2a16" strokeWidth="1" strokeLinecap="round" />
      {children}
    </g>
  );
}

/** Warm varnish + dark vignette laid over every scene for the "oil painting" look. */
function Varnish({ id, tone }: { id: string; tone: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-vig`} cx="0.45" cy="0.45" r="0.75">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.75" />
        </radialGradient>
        <linearGradient id={`${id}-var`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone} stopOpacity="0.22" />
          <stop offset="1" stopColor="#1a0f00" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id}-var)`} />
      <rect width="100" height="100" fill={`url(#${id}-vig)`} />
    </>
  );
}

/** A small faceted crystal in the card's gem color. */
function Crystal({ x, y, s = 1, a }: { x: number; y: number; s?: number; a: Accent }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 -7 L5 -2 L3 6 L-3 6 L-5 -2 Z" fill={a.base} stroke={a.light} strokeWidth="0.8" />
      <path d="M0 -7 L2 -1 L0 6 L-2 -1 Z" fill={a.light} fillOpacity="0.55" />
      <path d="M-5 -2 L-2 -1 L-3 6 Z" fill={a.dark} fillOpacity="0.6" />
    </g>
  );
}

/* ── The 9 scenes ─────────────────────────────────────────────────────── */

function MinerScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#1b120b" />
      {/* Tunnel mouth with timber frame */}
      <path d="M8 100 L8 30 Q50 4 92 30 L92 100 Z" fill="#2c1c10" />
      <path d="M20 100 L20 38 Q50 18 80 38 L80 100 Z" fill="#0d0805" />
      <path d="M14 100 V32 M86 100 V32 M12 33 Q50 10 88 33" fill="none" stroke="#6b4423" strokeWidth="4" />
      {/* Torch glow */}
      <circle cx="18" cy="42" r="22" fill="#f59e0b" fillOpacity="0.28" />
      <path d="M16 52 L19 40" stroke="#5c3a1a" strokeWidth="2.5" />
      <path d="M19 40 C15 35 19 31 18.5 27 C22 31 23 35 19 40 Z" fill="#fbbf24" />
      {/* Ore vein in the wall */}
      <Crystal x={78} y={46} s={1.1} a={a} />
      <Crystal x={86} y={55} s={0.7} a={a} />
      <Bust cx={44} skin="#d8a57f" cloth="#4a3527" collar="#8a6a4a">
        {/* Leather cap + lamp */}
        <path d="M33 47 C33 36, 40 33, 44 33 C48 33, 55 36, 55 47 Z" fill="#5a3d24" />
        <rect x="41" y="38" width="6" height="4" rx="1" fill="#fcd34d" />
        {/* Pickaxe over the shoulder */}
        <path d="M60 96 L70 50" stroke="#7c5a3a" strokeWidth="3" strokeLinecap="round" />
        <path d="M58 52 Q70 42 82 50" fill="none" stroke="#c7ccd4" strokeWidth="3.2" strokeLinecap="round" />
      </Bust>
    </>
  );
}

function PannerScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#3b2a45" />
      <rect width="100" height="55" fill="#e89a5a" fillOpacity="0.55" />
      <path d="M0 55 L22 26 L38 44 L58 18 L80 42 L100 30 L100 60 L0 60 Z" fill="#2a2440" />
      <path d="M52 24 L58 18 L63 25 Z" fill="#f1f5f9" fillOpacity="0.8" />
      {/* River */}
      <path d="M0 64 Q50 58 100 66 L100 80 Q50 74 0 82 Z" fill="#3f6f8f" />
      <path d="M8 70 Q30 67 50 70 M60 72 Q80 69 96 72" stroke="#cfe8f5" strokeOpacity="0.6" strokeWidth="1" fill="none" />
      <rect y="80" width="100" height="20" fill="#3a2a1a" />
      <Bust cx={38} skin="#c98f64" cloth="#6b4f2a" collar="#b08a57">
        {/* Wide straw hat */}
        <ellipse cx="38" cy="40" rx="18" ry="4.5" fill="#c9a24a" />
        <path d="M30 40 C30 31, 46 31, 46 40 Z" fill="#d9b35a" />
      </Bust>
      {/* Pan held out with glinting grains */}
      <ellipse cx="68" cy="84" rx="15" ry="5" fill="#3b3024" stroke="#8a7355" strokeWidth="1.5" />
      <circle cx="64" cy="83" r="1.3" fill={a.light} />
      <circle cx="70" cy="84.5" r="1.6" fill={a.base} stroke={a.light} strokeWidth="0.5" />
      <circle cx="74" cy="82.5" r="1" fill="#fde68a" />
    </>
  );
}

function QuarryScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#415a77" />
      <path d="M0 50 L30 12 L48 34 L66 8 L100 46 L100 100 L0 100 Z" fill="#6b7280" />
      <path d="M26 17 L30 12 L35 19 Z M61 14 L66 8 L72 16 Z" fill="#f8fafc" />
      {/* Cut stone face */}
      <path d="M58 44 L100 40 L100 100 L52 100 Z" fill="#8b8177" />
      <path d="M58 60 H100 M55 78 H100 M74 44 V60 M86 60 V78 M68 78 V100" stroke="#5b5249" strokeWidth="1.2" />
      <Crystal x={80} y={52} s={1.2} a={a} />
      <Crystal x={90} y={70} s={0.8} a={a} />
      <Bust cx={36} skin="#e0b08c" cloth="#7a2e1f" collar="#d6a45a">
        <path d="M26 46 C26 36, 34 34, 36 34 C42 34, 47 38, 46 46 C42 41, 30 41, 26 46 Z" fill="#3a2718" />
        {/* Hammer raised */}
        <path d="M52 96 L56 64" stroke="#7c5a3a" strokeWidth="3" strokeLinecap="round" />
        <rect x="50" y="58" width="12" height="7" rx="1.5" fill="#9ca3af" />
      </Bust>
    </>
  );
}

function CutterScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#2a1d14" />
      {/* Leaded window with daylight */}
      <path d="M58 12 H90 V52 H58 Z" fill="#8fb3c9" fillOpacity="0.75" />
      <path d="M58 12 Q74 0 90 12" fill="#8fb3c9" fillOpacity="0.75" />
      <path d="M74 6 V52 M58 32 H90" stroke="#3b2a1a" strokeWidth="2" />
      <path d="M58 52 L30 100 H100 V52 Z" fill="#ffe8b0" fillOpacity="0.08" />
      {/* Workbench */}
      <rect y="82" width="100" height="18" fill="#5c3a1f" />
      <rect y="80" width="100" height="3" fill="#8a5a2f" />
      <Bust cx={38} skin="#e3b391" cloth="#23304a" collar="#c9a14a">
        <path d="M27 48 C26 36, 33 32, 38 32 C45 32, 50 36, 49 46 C45 40, 32 40, 27 48 Z" fill="#6b4a2e" />
        <path d="M28 40 H48" stroke="#6b1e1e" strokeWidth="4" />
        {/* Loupe on the eye */}
        <circle cx="41.5" cy="50" r="4" fill="#bfe7f5" fillOpacity="0.5" stroke="#d4a52a" strokeWidth="1.6" />
      </Bust>
      {/* Stone being cut on the bench + tweezers */}
      <Crystal x={70} y={76} s={1.1} a={a} />
      <path d="M58 60 L67 72 M61 58 L70 70" stroke="#d1d5db" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="70" cy="68" r="10" fill={a.light} fillOpacity="0.15" />
    </>
  );
}

function CaravanScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#f0a24a" />
      <circle cx="74" cy="40" r="14" fill="#ffe29a" />
      <rect y="0" width="100" height="100" fill="#7a2e1f" fillOpacity="0.25" />
      <path d="M0 66 Q30 54 55 64 Q80 72 100 60 L100 100 L0 100 Z" fill="#c9793a" />
      <path d="M0 80 Q40 70 100 82 L100 100 L0 100 Z" fill="#a85f2a" />
      {/* Camel silhouettes on the dune */}
      {[62, 80].map((x) => (
        <path
          key={x}
          d={`M${x} 62 q2 -6 5 -1 q2 -5 5 0 l3 -4 l1 2 l-2 4 l0 6 m-1 0 l0 -5 m-9 5 l0 -6 m3 6 l0 -6`}
          fill="#3a1d0e"
          stroke="#3a1d0e"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      ))}
      <Bust cx={36} skin="#b97c52" cloth="#1f4a5a" collar="#e0a40a">
        {/* Turban with a jewel pin */}
        <path d="M24 46 C22 32, 32 28, 36 28 C44 28, 50 32, 48 46 C44 40, 28 40, 24 46 Z" fill="#f1ede4" />
        <path d="M25 40 Q36 34 47 40" stroke="#cfc6b4" strokeWidth="1.5" fill="none" />
        <Crystal x={36} y={34} s={0.55} a={a} />
      </Bust>
      {/* Trade chest */}
      <rect x="58" y="84" width="22" height="12" rx="1.5" fill="#6b3a1a" stroke="#e0a40a" strokeWidth="1.2" />
    </>
  );
}

function ShipScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#6d8fb0" />
      <rect y="0" width="100" height="40" fill="#f3d9a4" fillOpacity="0.45" />
      <rect y="62" width="100" height="38" fill="#1f3b5a" />
      <path d="M0 68 Q12 65 24 68 T48 68 T72 68 T100 68" stroke="#bcd6ea" strokeOpacity="0.6" fill="none" />
      {/* Galleon */}
      <path d="M52 62 L94 62 L88 72 L58 72 Z" fill="#4a2a14" />
      <path d="M66 62 V18 M82 62 V26" stroke="#3b2414" strokeWidth="1.6" />
      <path d="M66 20 Q78 30 66 42 Z M66 44 Q80 52 66 60 Z M82 28 Q92 36 82 44 Z" fill="#f4ecd8" />
      <path d="M66 18 L74 20 L66 22 Z" fill="#b91c1c" />
      <Bust cx={34} skin="#dca982" cloth="#3a1d4a" collar="#e0a40a">
        {/* Captain's plumed hat */}
        <ellipse cx="34" cy="40" rx="15" ry="4" fill="#1a1a1a" />
        <path d="M26 40 C26 32, 42 32, 42 40 Z" fill="#1a1a1a" />
        <path d="M40 34 Q50 26 52 34" stroke="#f8fafc" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* Brooch in the card's color */}
        <circle cx="34" cy="78" r="2.6" fill={a.base} stroke={a.light} strokeWidth="0.8" />
      </Bust>
    </>
  );
}

function Curtain({ color }: { color: string }) {
  return (
    <>
      <path d="M0 0 H30 Q22 40 30 100 H0 Z" fill={color} />
      <path d="M100 0 H72 Q80 45 70 100 H100 Z" fill={color} />
      <path d="M8 0 Q4 50 10 100 M20 0 Q14 50 22 100 M88 0 Q92 50 86 100" stroke="#000" strokeOpacity="0.25" strokeWidth="2" fill="none" />
      <path d="M0 6 Q50 20 100 6 V0 H0 Z" fill="#d4a52a" fillOpacity="0.85" />
    </>
  );
}

function GuildScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#1f1433" />
      <Curtain color="#4c1d6e" />
      <Bust cx={42} skin="#e7bb96" cloth="#6b1020" collar="#f2c14e">
        {/* Fur collar + beret */}
        <path d="M18 88 C24 74, 34 70, 42 70 C50 70, 60 74, 66 88 C56 82, 28 82, 18 88 Z" fill="#8a6a4a" />
        <path d="M29 44 C28 33, 56 33, 55 44 C50 39, 34 39, 29 44 Z" fill="#111" />
        <path d="M32 58 C33 66, 51 66, 52 58 C48 62, 36 62, 32 58 Z" fill="#7a5a3a" />
        {/* Chain of office with the guild stone */}
        <path d="M30 78 Q42 94 54 78" fill="none" stroke="#f2c14e" strokeWidth="2" strokeDasharray="2 1.2" />
        <Crystal x={42} y={90} s={0.75} a={a} />
      </Bust>
      <circle cx="78" cy="30" r="12" fill="#f2c14e" fillOpacity="0.14" />
    </>
  );
}

function JewelerScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#10223a" />
      {/* Palace arch window */}
      <path d="M56 100 V36 Q74 14 92 36 V100 Z" fill="#274a72" />
      <path d="M74 20 V100 M56 56 H92" stroke="#d4a52a" strokeOpacity="0.6" strokeWidth="1.2" />
      <Bust cx={34} skin="#e9c09c" cloth="#0f3d33" collar="#f2c14e">
        <path d="M24 46 C23 34, 30 31, 34 31 C40 31, 46 35, 45 45 C41 39, 28 39, 24 46 Z" fill="#9ca3af" />
        <path d="M24 50 C24 62, 44 62, 44 50 C40 58, 28 58, 24 50 Z" fill="#9ca3af" />
      </Bust>
      {/* Crown on a velvet cushion, set with the card's stone */}
      <rect x="54" y="80" width="34" height="9" rx="4" fill="#9f1239" />
      <path d="M58 80 L58 66 L64 72 L71 60 L78 72 L84 66 L84 80 Z" fill="#f2c14e" stroke="#8a5a00" strokeWidth="0.8" strokeLinejoin="round" />
      <circle cx="71" cy="75" r="3" fill={a.base} stroke={a.light} strokeWidth="0.8" />
      <circle cx="71" cy="70" r="14" fill="#f2c14e" fillOpacity="0.12" />
    </>
  );
}

function LadyScene({ a }: { a: Accent }) {
  return (
    <>
      <rect width="100" height="100" fill="#2a0f1c" />
      <Curtain color="#7a1030" />
      <Bust cx={44} skin="#f3d2b8" cloth="#1e2a5a" collar="#f2c14e">
        {/* Hair up + tiara */}
        <path d="M33 50 C31 34, 40 30, 44 30 C50 30, 58 34, 55 50 C52 40, 36 40, 33 50 Z" fill="#6b3a1a" />
        <path d="M36 36 L39 30 L42 34 L44 27 L46 34 L49 30 L52 36 Q44 33 36 36 Z" fill="#f2c14e" />
        <circle cx="44" cy="30.5" r="1.6" fill={a.base} stroke="#fff" strokeWidth="0.4" />
        {/* Lace ruff */}
        <path d="M30 70 Q37 64 44 70 Q51 64 58 70 Q51 76 44 72 Q37 76 30 70 Z" fill="#f8fafc" fillOpacity="0.9" />
        {/* Necklace in the card's gem */}
        <path d="M34 78 Q44 88 54 78" fill="none" stroke="#f2c14e" strokeWidth="1.2" />
        <Crystal x={44} y={86} s={0.8} a={a} />
      </Bust>
    </>
  );
}

const RENDER: Record<string, (p: { a: Accent }) => ReactNode> = {
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

const LEVEL_TONE: Record<Level, string> = { 1: "#f59e0b", 2: "#fcd34d", 3: "#fde68a" };

/** Full-bleed scene painting for a card; sized by its (relative) parent. */
export default function CardScene({ card, color, className = "" }: { card: Pick<DuelCard, "id" | "level">; color: GemColor | null; className?: string }) {
  const id = useId().replace(/:/g, "");
  const scene = sceneFor(card);
  const a = color ? GEM_PALETTE[color] : PRISM;
  const Scene = RENDER[scene.key];
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden="true">
      <Scene a={a} />
      <Varnish id={id} tone={LEVEL_TONE[card.level]} />
    </svg>
  );
}
