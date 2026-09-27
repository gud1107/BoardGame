import { useId } from "react";
import type { MerchantCard } from "./cards";

/**
 * "Silk Road masterpiece" scene illustrations for card faces — six
 * painterly inline-SVG vignettes rendered as an antique oil painting in a
 * gilded frame. Same no-external-image-asset convention as CardArt.tsx /
 * ResourceIcon.tsx: everything is inline SVG + CSS, so nothing can 404 or
 * load late.
 *
 * Painting layers, bottom to top (all inside one `<svg>`):
 *   1. the scene itself (gradients + figures)
 *   2. chiaroscuro — a per-scene radial darkening centred on that scene's
 *      own light source (sun / hanging lamp / chandelier / burner), so the
 *      edges fall into deep shadow the way a Rembrandt-style canvas does
 *   3. canvas weave — fine fractal `feTurbulence` grain, desaturated and
 *      multiplied in at low alpha, to break up flat vector fills
 *   4. craquelure — low-frequency `turbulence` noise whose near-zero bands
 *      are turned into thin dark alpha veins (the cracked-varnish look)
 * The gilded filigree frame is plain DOM around the `<svg>` (a gold
 * gradient bezel + four fixed-size corner flourishes with rivets), not part
 * of the sliced SVG — the painting uses `preserveAspectRatio="slice"`, which
 * would crop or stretch a frame drawn inside it.
 *
 * Scene choice is derived from the card's own effect (`sceneForMerchant`)
 * rather than stored on the card data — cards.ts stays a pure 1:1
 * rulebook transcription, and the mapping can't drift out of sync with a
 * card's actual effect:
 *
 * - production of cheap spices (yellow/red only) → OASIS_HARVEST
 * - production that includes green/brown          → CARAVAN_DESERT
 * - upgrade                                       → ALCHEMY_LAB
 * - trade whose payout is 3+ cubes or brown        → PORT_TRADE (long-haul)
 * - any other trade                               → BAZAAR_MARKET
 * - every point card                              → SULTAN_PALACE
 *
 * Gradient/filter ids go through `useId()` — many cards render at once, and
 * a fixed `id="desert-sunset"` would be a duplicate document id (the first
 * definition silently wins, which breaks as soon as that card unmounts).
 */

export type CenturyArtScene = "CARAVAN_DESERT" | "OASIS_HARVEST" | "BAZAAR_MARKET" | "PORT_TRADE" | "SULTAN_PALACE" | "ALCHEMY_LAB";

export const SCENE_LABEL: Record<CenturyArtScene, string> = {
  CARAVAN_DESERT: "사막 캐러밴",
  OASIS_HARVEST: "오아시스 수확",
  BAZAAR_MARKET: "바자르 무역 시장",
  PORT_TRADE: "지중해 선단",
  SULTAN_PALACE: "술탄의 알현실",
  ALCHEMY_LAB: "정제소 공방",
};

/** Where each scene's key light sits (viewBox units) — the chiaroscuro falloff is centred here. */
const LIGHT: Record<CenturyArtScene, { cx: number; cy: number }> = {
  CARAVAN_DESERT: { cx: 60, cy: 42 },
  OASIS_HARVEST: { cx: 70, cy: 30 },
  BAZAAR_MARKET: { cx: 50, cy: 34 },
  PORT_TRADE: { cx: 76, cy: 56 },
  SULTAN_PALACE: { cx: 50, cy: 34 },
  ALCHEMY_LAB: { cx: 50, cy: 56 },
};

export function sceneForMerchant(card: MerchantCard): CenturyArtScene {
  const e = card.effect;
  if (e.kind === "upgrade") return "ALCHEMY_LAB";
  if (e.kind === "production") return (e.gain.green ?? 0) + (e.gain.brown ?? 0) > 0 ? "CARAVAN_DESERT" : "OASIS_HARVEST";
  const gainCount = Object.values(e.gain).reduce((a, b) => a + (b ?? 0), 0);
  return gainCount >= 3 || (e.gain.brown ?? 0) > 0 ? "PORT_TRADE" : "BAZAAR_MARKET";
}

/** One gilded corner flourish — fixed pixel size so it never stretches with the frame's aspect. */
function FiligreeCorner({ className, big }: { className: string; big: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`pointer-events-none absolute z-20 ${big ? "h-5 w-5" : "h-3 w-3"} ${className}`} aria-hidden="true">
      <path d="M1 12 C1 5 5 1 12 1" fill="none" stroke="#fde68a" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3.5 13 C4 8 8 4 13 3.5 M6 9.5 c2 0 3.5-1.5 3.5-3.5" fill="none" stroke="#b45309" strokeWidth="1" strokeLinecap="round" />
      <path d="M12 1 q3 1.5 2 4.5 q-2-1-2-4.5 M1 12 q1.5 3 4.5 2 q-1-2-4.5-2" fill="#facc15" stroke="#92400e" strokeWidth="0.4" />
      <circle cx="3.2" cy="3.2" r="2.2" fill="#fde047" stroke="#78350f" strokeWidth="0.6" />
      <circle cx="2.6" cy="2.6" r="0.7" fill="#fffbeb" />
    </svg>
  );
}

/**
 * `size="strip"` is the small window on market/hand cards (no caption —
 * too narrow to read); `size="hero"` is the tap-to-preview modal's large
 * render, which also gets the antique gold caption.
 */
export function CenturyCardIllustration({ scene, size = "strip" }: { scene: CenturyArtScene; size?: "strip" | "hero" }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const g = (name: string) => `${name}-${uid}`;
  const u = (name: string) => `url(#${g(name)})`;
  const hero = size === "hero";
  const light = LIGHT[scene];
  return (
    // Gilded bezel: a gold gradient wrapper whose padding is the frame width.
    <div
      className={`relative z-10 w-full rounded-[6px] select-none ${hero ? "p-[4px]" : "p-[2.5px]"}`}
      style={{
        background: "linear-gradient(135deg,#fef3c7 0%,#d4a017 18%,#7c4a03 38%,#f7d774 52%,#8a5a0c 70%,#fde68a 86%,#a16207 100%)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.55), inset 0 0 0 0.5px rgba(60,30,0,0.9)",
      }}
      role="img"
      aria-label={SCENE_LABEL[scene]}
      title={SCENE_LABEL[scene]}
    >
      <FiligreeCorner big={hero} className="top-0 left-0" />
      <FiligreeCorner big={hero} className="top-0 right-0 -scale-x-100" />
      <FiligreeCorner big={hero} className="bottom-0 left-0 -scale-y-100" />
      <FiligreeCorner big={hero} className="right-0 bottom-0 -scale-100" />
      <div
        className={`relative w-full overflow-hidden rounded-[3px] bg-[#080504] ${hero ? "aspect-[4/3]" : "aspect-[16/10]"}`}
        style={{ boxShadow: "inset 0 0 0 1px rgba(40,20,0,0.9), inset 0 0 10px rgba(0,0,0,0.75)" }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
          <defs>
            <radialGradient id={g("chiaro")} cx={light.cx} cy={light.cy} r="70" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#000" stopOpacity="0" />
              <stop offset="45%" stopColor="#000" stopOpacity="0.08" />
              <stop offset="80%" stopColor="#0a0402" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#050201" stopOpacity="0.8" />
            </radialGradient>
            <filter id={g("canvas")} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="1.1 0.9" numOctaves="2" seed="4" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.32  0 0 0 0 0.18  0 0 0 -1.1 0.75" />
            </filter>
            <filter id={g("crack")} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="turbulence" baseFrequency="0.07" numOctaves="2" seed="11" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.04  0 0 0 0 0.01  -9 0 0 0 0.55" />
            </filter>
            <filter id={g("soft")}>
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
          </defs>

          {scene === "CARAVAN_DESERT" && (
            <>
              <defs>
                <radialGradient id={g("sky")} cx="60%" cy="40%" r="75%">
                  <stop offset="0%" stopColor="#ffedd5" />
                  <stop offset="22%" stopColor="#f59e0b" />
                  <stop offset="60%" stopColor="#9a3412" />
                  <stop offset="100%" stopColor="#1c0a04" />
                </radialGradient>
                <linearGradient id={g("dune1")} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#c2410c" />
                  <stop offset="70%" stopColor="#7c2d12" />
                  <stop offset="100%" stopColor="#2a0802" />
                </linearGradient>
                <linearGradient id={g("dune2")} x1="1" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ea580c" />
                  <stop offset="55%" stopColor="#9a3412" />
                  <stop offset="100%" stopColor="#180401" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" fill={u("sky")} />
              <circle cx="60" cy="42" r="20" fill="#fffbeb" opacity="0.35" filter={u("soft")} />
              <circle cx="60" cy="42" r="12" fill="#fef08a" opacity="0.92" />
              {/* Distant birds */}
              <path d="M22,24 q2-2 4 0 q2-2 4 0 M34,19 q1.5-1.5 3 0 q1.5-1.5 3 0" stroke="#3b1206" strokeWidth="0.6" fill="none" />
              <path d="M-10,68 Q30,50 70,64 L110,56 L110,100 L-10,100 Z" fill={u("dune1")} />
              {/* Wind-rippled crest highlight */}
              <path d="M-10,68 Q30,50 70,64" stroke="#fdba74" strokeWidth="0.7" fill="none" opacity="0.6" />
              <path d="M-10,80 Q40,64 90,78 L110,74 L110,100 L-10,100 Z" fill={u("dune2")} />
              {/* Rear camel */}
              <path d="M73,62 q1.5-6 4-6 q1.5 3 3 3 q2-4 4.5-1.5 l.8 4.5 -.8 5.5 h-1.5 l-.6-4 h-4.5 l-.6 4 h-1.5 z" fill="#2d1007" />
              <path d="M73,62 q-1.5-4 -.5-7" stroke="#2d1007" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              {/* Lead camel with brass jar + silk sack */}
              <path d="M40,66 Q43,54 47,54 Q49.5,60 53,60 Q57,52 61,57.5 L63,66 L61,76 L59,76 L58,69 L48.5,69 L47.5,76 L45.5,76 L44.5,69 Z" fill="#140602" />
              <path d="M40,66 Q38,59 39,53" stroke="#140602" strokeWidth="2.6" fill="none" strokeLinecap="round" />
              <ellipse cx="38.8" cy="52" rx="2.8" ry="2" fill="#140602" />
              <path d="M44,58 L58,58" stroke="#b91c1c" strokeWidth="1.4" />
              <path d="M44,58.7 L58,58.7" stroke="#facc15" strokeWidth="0.35" />
              <ellipse cx="49.5" cy="55.5" rx="4" ry="3.2" fill="#d97706" stroke="#78350f" strokeWidth="0.6" />
              <ellipse cx="48.5" cy="54.5" rx="1.4" ry="0.8" fill="#fef3c7" opacity="0.7" />
              <ellipse cx="55.5" cy="56" rx="3.2" ry="2.5" fill="#991b1b" />
              {/* Caravan master: white turban with jewel pin, gold-lined coat, staff */}
              <circle cx="26" cy="63" r="2.6" fill="#fcd9a8" />
              <path d="M23.2,62 Q26,57 29.2,61.6 Q27,60.6 23.2,62 Z" fill="#f8fafc" />
              <circle cx="26.4" cy="60.3" r="0.8" fill="#dc2626" stroke="#facc15" strokeWidth="0.3" />
              <path d="M22,66 L30,66 L32,80 L20,80 Z" fill="#5b2508" />
              <path d="M25.3,66 L26.7,66 L27.4,80 L24.6,80 Z" fill="#facc15" opacity="0.85" />
              <path d="M22,66 L20,80" stroke="#fde68a" strokeWidth="0.3" opacity="0.7" />
              <line x1="31.5" y1="61" x2="32.5" y2="81" stroke="#fde047" strokeWidth="0.9" strokeLinecap="round" />
            </>
          )}

          {scene === "OASIS_HARVEST" && (
            <>
              <defs>
                <linearGradient id={g("sky")} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#042f2e" />
                  <stop offset="50%" stopColor="#0f766e" />
                  <stop offset="100%" stopColor="#fde68a" />
                </linearGradient>
                <radialGradient id={g("pool")} cx="50%" cy="35%" r="65%">
                  <stop offset="0%" stopColor="#a5f3fc" />
                  <stop offset="55%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#075985" />
                </radialGradient>
                <linearGradient id={g("robe")} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#022c22" />
                  <stop offset="50%" stopColor="#047857" />
                  <stop offset="100%" stopColor="#022c22" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" fill={u("sky")} />
              {/* Crescent moon rim-light */}
              <circle cx="72" cy="22" r="6" fill="#fef9c3" opacity="0.9" />
              <circle cx="74.5" cy="20.5" r="5.2" fill="#0b5e58" />
              <path d="M-5,76 Q40,64 105,74 L105,100 L-5,100 Z" fill="#c9a266" />
              <path d="M-5,76 Q40,64 105,74" stroke="#fef3c7" strokeWidth="0.6" fill="none" opacity="0.6" />
              <ellipse cx="66" cy="84" rx="32" ry="10" fill={u("pool")} />
              <ellipse cx="72" cy="81" rx="6" ry="1.2" fill="#fef9c3" opacity="0.55" />
              <path d="M44,83 q6-1 12 0 M76,87 q7-1 14 0" stroke="#e0f2fe" strokeWidth="0.6" opacity="0.7" fill="none" strokeLinecap="round" />
              {/* Date palms with layered fronds + date clusters */}
              <path d="M18,94 Q22,52 15,30" stroke="#5b2f0a" strokeWidth="3.6" fill="none" strokeLinecap="round" />
              <path d="M18,94 Q22,52 15,30" stroke="#a16207" strokeWidth="0.8" fill="none" strokeDasharray="1 2" opacity="0.7" />
              <path d="M15,30 Q30,22 42,32 M15,30 Q28,34 35,46 M15,30 Q5,20 -5,28 M15,30 Q0,35 2,48 M15,30 Q18,18 26,14" stroke="#14532d" strokeWidth="2.6" fill="none" strokeLinecap="round" />
              <path d="M15,30 Q30,24 40,33 M15,30 Q26,35 32,44" stroke="#4ade80" strokeWidth="0.8" fill="none" strokeLinecap="round" />
              <circle cx="17" cy="33" r="1.2" fill="#b45309" />
              <circle cx="14.5" cy="34" r="1.1" fill="#92400e" />
              <path d="M88,78 Q86,56 90,42" stroke="#5b2f0a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
              <path d="M90,42 Q80,36 72,42 M90,42 Q98,36 106,42 M90,42 Q84,48 80,56" stroke="#166534" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              {/* Noble harvester: embroidered robe, basket of turmeric & cardamom */}
              <circle cx="48" cy="61" r="3" fill="#fcd9a8" />
              <path d="M44.5,60.5 Q48,56.5 51.5,60.5 Q48,59 44.5,60.5 Z" fill="#fef3c7" />
              <ellipse cx="48" cy="55.5" rx="6" ry="2.6" fill="#78350f" />
              <path d="M42.4,55 q5.6 2 11.2 0" stroke="#facc15" strokeWidth="0.35" fill="none" />
              <ellipse cx="46" cy="54.2" rx="3" ry="1.3" fill="#eab308" />
              <ellipse cx="50.5" cy="54.2" rx="2.4" ry="1.1" fill="#22c55e" />
              <path d="M43,64 L53,64 L56.5,84 L39.5,84 Z" fill={u("robe")} />
              <path d="M43,64 L53,64 M41,76 L55,76" stroke="#facc15" strokeWidth="0.45" />
              <path d="M48,64 L48,84" stroke="#fde68a" strokeWidth="0.3" opacity="0.8" />
            </>
          )}

          {scene === "BAZAAR_MARKET" && (
            <>
              <defs>
                <radialGradient id={g("lamp")} cx="50%" cy="34%" r="60%">
                  <stop offset="0%" stopColor="#fffbeb" stopOpacity="0.95" />
                  <stop offset="25%" stopColor="#f59e0b" stopOpacity="0.7" />
                  <stop offset="60%" stopColor="#78350f" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#0a0502" />
                </radialGradient>
                <linearGradient id={g("brass")} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#5b2f0a" />
                  <stop offset="40%" stopColor="#f59e0b" />
                  <stop offset="55%" stopColor="#fde68a" />
                  <stop offset="100%" stopColor="#5b2f0a" />
                </linearGradient>
                <linearGradient id={g("saffron")} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fca5a5" />
                  <stop offset="50%" stopColor="#dc2626" />
                  <stop offset="100%" stopColor="#7f1d1d" />
                </linearGradient>
                <linearGradient id={g("turmeric")} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="50%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#854d0e" />
                </linearGradient>
                <linearGradient id={g("velvet")} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#1e1b4b" />
                  <stop offset="45%" stopColor="#4338ca" />
                  <stop offset="100%" stopColor="#1e1b4b" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" fill="#0a0502" />
              <rect width="100" height="100" fill={u("lamp")} />
              {/* Velvet canopy with gold fringe */}
              <path d="M0,0 L100,0 L92,18 Q50,26 8,18 Z" fill="#881337" />
              <path d="M20,0 L24,20 M40,0 L42,23 M60,0 L58,23 M80,0 L76,20" stroke="#4c0519" strokeWidth="1.6" />
              <path d="M0,15 Q25,22 50,15 Q75,22 100,15" stroke="#fbbf24" strokeWidth="1.1" fill="none" />
              {/* Hanging brass lamp with flickering flame */}
              <line x1="50" y1="0" x2="50" y2="20" stroke="#d97706" strokeWidth="0.8" />
              <polygon points="46.5,20 53.5,20 52,27 48,27" fill={u("brass")} />
              <ellipse cx="50" cy="30" rx="3.2" ry="5" fill="#fef08a" opacity="0.85" className="motion-safe:animate-pulse" />
              <ellipse cx="50" cy="30.5" rx="1.5" ry="3" fill="#ea580c" />
              {/* Brass bowls heaped with spice */}
              <path d="M10,90 L20,66 L38,66 L46,90 Z" fill={u("brass")} stroke="#451a03" strokeWidth="0.7" />
              <polygon points="19,66 39,66 29,48" fill={u("saffron")} />
              <path d="M58,90 L66,68 L84,68 L92,90 Z" fill={u("brass")} stroke="#451a03" strokeWidth="0.7" />
              <polygon points="65,68 85,68 75,51" fill={u("turmeric")} />
              {/* Incense burner + curling smoke */}
              <path d="M88,92 L91,84 L97,84 L100,92 Z" fill={u("brass")} />
              <path d="M94,84 C90,76 98,72 93,64 C89,58 96,54 92,46" stroke="#e7e5e4" strokeWidth="0.9" fill="none" opacity="0.45" strokeLinecap="round" className="motion-safe:animate-pulse" />
              {/* Venetian merchant: indigo velvet turban + robe, gold scale */}
              <circle cx="50" cy="42" r="5" fill="#fcd9a8" />
              <path d="M44,40 Q50,32 56,40 Q53,37.5 47,38 Z" fill={u("velvet")} />
              <circle cx="50" cy="36.8" r="0.9" fill="#10b981" stroke="#facc15" strokeWidth="0.3" />
              <path d="M47.5,45.5 q2.5 3 5 0 l-.5 3 h-4 z" fill="#44403c" />
              <path d="M41,49 L59,49 L62,72 L38,72 Z" fill={u("velvet")} />
              <path d="M50,49 L50,72 M40,70 L60,70" stroke="#facc15" strokeWidth="0.45" />
              <line x1="57" y1="53" x2="72" y2="48.5" stroke="#facc15" strokeWidth="1.1" />
              <line x1="67" y1="50" x2="67" y2="55" stroke="#facc15" strokeWidth="0.5" />
              <path d="M63.5,55 q3.5 3 7 0 Z" fill="#ca8a04" />
            </>
          )}

          {scene === "PORT_TRADE" && (
            <>
              <defs>
                <linearGradient id={g("sky")} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1e1b4b" />
                  <stop offset="42%" stopColor="#9a3412" />
                  <stop offset="64%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#082f49" />
                </linearGradient>
                <linearGradient id={g("sea")} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#155e75" />
                  <stop offset="100%" stopColor="#041b2d" />
                </linearGradient>
                <linearGradient id={g("sail")} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fffbeb" />
                  <stop offset="100%" stopColor="#d6b273" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" fill={u("sky")} />
              <circle cx="78" cy="58" r="10" fill="#fde68a" opacity="0.3" filter={u("soft")} />
              <circle cx="78" cy="58" r="6" fill="#fde68a" opacity="0.9" />
              <rect x="0" y="64" width="100" height="36" fill={u("sea")} />
              <path d="M62,67 h32 M67,71 h22 M72,75 h12" stroke="#fcd34d" strokeWidth="0.7" opacity="0.6" />
              {/* Three-masted galley with oars and pennants */}
              <path d="M20,70 Q50,79 82,70 L75,80 L27,80 Z" fill="#451a03" stroke="#1c0a02" strokeWidth="0.8" />
              <path d="M24,73 Q50,80 78,73" stroke="#facc15" strokeWidth="0.4" fill="none" />
              <path d="M32,78 l-3 6 M38,79 l-3 6 M44,79.5 l-3 6 M50,79.5 l-3 6 M56,79.5 l-3 6 M62,79 l-3 6 M68,78 l-3 6" stroke="#291203" strokeWidth="0.6" />
              <line x1="36" y1="40" x2="36" y2="72" stroke="#78350f" strokeWidth="1.3" />
              <path d="M36,42 Q52,52 36,64 Z" fill={u("sail")} opacity="0.95" />
              <line x1="50" y1="28" x2="50" y2="74" stroke="#78350f" strokeWidth="1.7" />
              <path d="M50,30 Q72,46 50,64 Z" fill={u("sail")} />
              <path d="M50,40 Q60,47 50,54" stroke="#b91c1c" strokeWidth="0.8" fill="none" opacity="0.8" />
              <line x1="64" y1="38" x2="64" y2="72" stroke="#78350f" strokeWidth="1.2" />
              <path d="M64,40 Q78,52 64,63 Z" fill={u("sail")} opacity="0.9" />
              <path d="M50,28 l5 1.6 -5 1.6 z M36,40 l4 1.3 -4 1.3 z" fill="#dc2626" />
              {/* Dock with spice sacks and barrel */}
              <polygon points="0,82 32,82 25,100 0,100" fill="#1c0f06" />
              <path d="M0,86 L30,86" stroke="#3b2210" strokeWidth="0.5" />
              <ellipse cx="11" cy="85" rx="5" ry="3.5" fill="#a16207" />
              <ellipse cx="18.5" cy="82.5" rx="4" ry="3" fill="#854d0e" />
              <ellipse cx="6" cy="81" rx="3.5" ry="2.6" fill="#7f1d1d" />
              <rect x="21" y="83" width="5" height="6" rx="1.4" fill="#78350f" />
              <path d="M21,85 h5 M21,87 h5" stroke="#1c0a02" strokeWidth="0.4" />
            </>
          )}

          {scene === "SULTAN_PALACE" && (
            <>
              <defs>
                <radialGradient id={g("sky")} cx="50%" cy="32%" r="70%">
                  <stop offset="0%" stopColor="#fef9c3" />
                  <stop offset="32%" stopColor="#f59e0b" stopOpacity="0.8" />
                  <stop offset="70%" stopColor="#4c0519" />
                  <stop offset="100%" stopColor="#070104" />
                </radialGradient>
                <linearGradient id={g("dome")} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#92400e" />
                  <stop offset="38%" stopColor="#fde047" />
                  <stop offset="55%" stopColor="#fffbeb" />
                  <stop offset="100%" stopColor="#78350f" />
                </linearGradient>
                <linearGradient id={g("marble")} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#1c1917" />
                  <stop offset="35%" stopColor="#57534e" />
                  <stop offset="50%" stopColor="#e7e5e4" />
                  <stop offset="65%" stopColor="#57534e" />
                  <stop offset="100%" stopColor="#1c1917" />
                </linearGradient>
                <pattern id={g("mosaic")} width="5" height="5" patternUnits="userSpaceOnUse">
                  <rect width="5" height="5" fill="#0f3d3e" />
                  <path d="M2.5 0 L5 2.5 L2.5 5 L0 2.5 Z" fill="#b45309" />
                  <circle cx="2.5" cy="2.5" r="0.8" fill="#fde047" />
                </pattern>
              </defs>
              <rect width="100" height="100" fill="#070104" />
              <rect width="100" height="100" fill={u("sky")} />
              {/* Golden chandelier */}
              <line x1="50" y1="0" x2="50" y2="14" stroke="#facc15" strokeWidth="0.9" />
              <path d="M40,14 Q50,20 60,14" stroke="#facc15" strokeWidth="1.1" fill="none" />
              <circle cx="40" cy="13" r="1.3" fill="#fffbeb" />
              <circle cx="50" cy="17.5" r="1.6" fill="#fde047" />
              <circle cx="60" cy="13" r="1.3" fill="#fffbeb" />
              {/* Palace body, dome and minarets */}
              <rect x="30" y="56" width="40" height="34" fill="#2a1508" />
              <path d="M44,90 V74 a6 6 0 0 1 12 0 V90 Z" fill="#fbbf24" opacity="0.4" />
              <path d="M34,90 V78 a3 3 0 0 1 6 0 V90 Z M60,90 V78 a3 3 0 0 1 6 0 V90 Z" fill="#fbbf24" opacity="0.22" />
              <rect x="20" y="44" width="8" height="46" fill="#1f130b" />
              <polygon points="20,44 24,27 28,44" fill={u("dome")} />
              <rect x="72" y="44" width="8" height="46" fill="#1f130b" />
              <polygon points="72,44 76,27 80,44" fill={u("dome")} />
              <path d="M34,58 C34,38 44,32 50,24 C56,32 66,38 66,58 Z" fill={u("dome")} stroke="#ca8a04" strokeWidth="0.8" />
              <path d="M40,56 C40,42 46,36 50,30" stroke="#fffbeb" strokeWidth="0.8" fill="none" opacity="0.55" />
              <circle cx="50" cy="20" r="2.4" fill="#fde047" />
              <circle cx="51.1" cy="19.4" r="2" fill="#6b1d0c" />
              {/* Velvet carpet + golden dais */}
              <polygon points="30,100 70,100 62,87 38,87" fill="#881337" stroke="#fbbf24" strokeWidth="0.7" />
              <path d="M36,94 h28" stroke="#fbbf24" strokeWidth="0.4" strokeDasharray="1 1" />
              <ellipse cx="50" cy="87" rx="12" ry="2.2" fill="#fbbf24" opacity="0.9" />
              {/* Marble pillars with gloss + mosaic arch */}
              <rect x="4" y="0" width="8" height="100" fill={u("marble")} />
              <rect x="88" y="0" width="8" height="100" fill={u("marble")} />
              <path d="M4,28 Q50,-4 96,28 L96,22 Q50,-10 4,22 Z" fill={u("mosaic")} stroke="#facc15" strokeWidth="0.8" />
              <path d="M12,28 Q50,4 88,28" fill="none" stroke="#facc15" strokeWidth="0.7" />
              {/* Victory-point gems on the pillar bases */}
              <polygon points="8,92 10.5,94.5 8,97 5.5,94.5" fill="#10b981" stroke="#fde68a" strokeWidth="0.3" />
              <polygon points="92,92 94.5,94.5 92,97 89.5,94.5" fill="#e11d48" stroke="#fde68a" strokeWidth="0.3" />
            </>
          )}

          {scene === "ALCHEMY_LAB" && (
            <>
              <defs>
                <radialGradient id={g("glow")} cx="50%" cy="58%" r="55%">
                  <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.9" />
                  <stop offset="45%" stopColor="#0891b2" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#04060c" />
                </radialGradient>
                <linearGradient id={g("glass")} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.5" />
                  <stop offset="30%" stopColor="#ecfeff" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#0891b2" stopOpacity="0.6" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" fill="#04060c" />
              <rect width="100" height="100" fill={u("glow")} />
              {/* Stone arch */}
              <path d="M12,0 L12,86 M88,0 L88,86" stroke="#1e293b" strokeWidth="6" />
              <path d="M9,0 L9,86" stroke="#475569" strokeWidth="0.6" opacity="0.6" />
              {/* Shelf of spice jars */}
              <line x1="15" y1="30" x2="36" y2="30" stroke="#78350f" strokeWidth="1.4" />
              <rect x="17" y="23" width="4" height="7" rx="1" fill="#eab308" />
              <rect x="23" y="24" width="4" height="6" rx="1" fill="#dc2626" />
              <rect x="29" y="22" width="4" height="8" rx="1" fill="#16a34a" />
              <rect x="17.6" y="23.6" width="0.8" height="5" fill="#fff" opacity="0.5" />
              {/* Alembic: flask → tube → receiver */}
              <path d="M46,40 L54,40 L60,62 L40,62 Z" fill={u("glass")} stroke="#0891b2" strokeWidth="1" />
              <path d="M54,42 Q66,34 72,48" stroke="#67e8f9" strokeWidth="1.1" fill="none" />
              <path d="M69,48 h6 l1.5 8 h-9 z" fill={u("glass")} stroke="#0891b2" strokeWidth="0.6" />
              <rect x="69.5" y="53" width="7" height="2.6" fill="#eab308" opacity="0.85" />
              <ellipse cx="50" cy="62" rx="10" ry="3" fill="#0891b2" />
              <path d="M44,66 L56,66 L54,74 L46,74 Z" fill="#334155" />
              <path d="M47.5,66 q2.5-5 5 0" fill="#f97316" className="motion-safe:animate-pulse" />
              <circle cx="48" cy="54" r="1.5" fill="#fef08a" />
              <circle cx="53" cy="50" r="1.8" fill="#fef08a" />
              <circle cx="50" cy="45" r="1.2" fill="#ffffff" />
              <path d="M47,40 C44,34 52,30 48,24" stroke="#cffafe" strokeWidth="0.7" fill="none" opacity="0.5" />
              {/* Golden rune arrow of refinement */}
              <polygon points="50,12 43,22 57,22" fill="#facc15" className="motion-safe:animate-pulse" />
              <rect x="30" y="76" width="40" height="3" fill="#5b2f0a" />
            </>
          )}

          {/* Painting layers — see module doc. */}
          <rect width="100" height="100" fill={u("chiaro")} />
          <rect width="100" height="100" filter={u("canvas")} opacity="0.55" style={{ mixBlendMode: "multiply" }} />
          <rect width="100" height="100" filter={u("crack")} opacity="0.5" />
        </svg>
        {hero && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent pt-3 pb-1 text-center">
            <span className="font-serif text-[10px] font-black tracking-widest text-amber-300 drop-shadow-[0_1px_3px_rgba(0,0,0,1)]">{SCENE_LABEL[scene]}</span>
          </div>
        )}
      </div>
    </div>
  );
}
