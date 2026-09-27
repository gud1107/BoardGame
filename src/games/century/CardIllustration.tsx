import { useId } from "react";
import type { MerchantCard } from "./cards";

/**
 * "Silk Road masterpiece" scene illustrations for card faces — six
 * painterly inline-SVG vignettes (layered linear/radial gradients + a warm
 * chiaroscuro glow) sitting in a window on each card, replacing the old
 * flat parchment-with-watermark look on the larger card renders. Same
 * no-external-image-asset convention as CardArt.tsx / ResourceIcon.tsx:
 * everything is inline SVG, so nothing can 404 or load late.
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
 * Gradient ids go through `useId()` — many cards render at once, and a
 * fixed `id="desert-sunset"` would be a duplicate document id (the first
 * definition silently wins, which breaks as soon as that card unmounts).
 */

export type CenturyArtScene = "CARAVAN_DESERT" | "OASIS_HARVEST" | "BAZAAR_MARKET" | "PORT_TRADE" | "SULTAN_PALACE" | "ALCHEMY_LAB";

export const SCENE_LABEL: Record<CenturyArtScene, string> = {
  CARAVAN_DESERT: "사막 캐러밴",
  OASIS_HARVEST: "오아시스 채집",
  BAZAAR_MARKET: "바자르 시장",
  PORT_TRADE: "지중해 선단",
  SULTAN_PALACE: "술탄의 궁전",
  ALCHEMY_LAB: "정제소 공방",
};

export function sceneForMerchant(card: MerchantCard): CenturyArtScene {
  const e = card.effect;
  if (e.kind === "upgrade") return "ALCHEMY_LAB";
  if (e.kind === "production") return (e.gain.green ?? 0) + (e.gain.brown ?? 0) > 0 ? "CARAVAN_DESERT" : "OASIS_HARVEST";
  const gainCount = Object.values(e.gain).reduce((a, b) => a + (b ?? 0), 0);
  return gainCount >= 3 || (e.gain.brown ?? 0) > 0 ? "PORT_TRADE" : "BAZAAR_MARKET";
}

/**
 * `size="strip"` is the small window on market/hand cards (no caption —
 * too narrow to read); `size="hero"` is the tap-to-preview modal's large
 * render, which also gets the antique gold caption.
 */
export function CenturyCardIllustration({ scene, size = "strip" }: { scene: CenturyArtScene; size?: "strip" | "hero" }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const g = (name: string) => `${name}-${uid}`;
  return (
    <div
      className={`relative z-10 w-full overflow-hidden rounded-[5px] border border-[#7a5a2e]/70 bg-[#0d0907] shadow-[inset_0_0_8px_rgba(0,0,0,0.6)] select-none ${
        size === "hero" ? "aspect-[4/3]" : "aspect-[16/10]"
      }`}
      role="img"
      aria-label={SCENE_LABEL[scene]}
      title={SCENE_LABEL[scene]}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
        <defs>
          {/* Shared vignette — the "museum oil painting" darkened edges. */}
          <radialGradient id={g("vig")} cx="50%" cy="50%" r="72%">
            <stop offset="60%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        {scene === "CARAVAN_DESERT" && (
          <>
            <defs>
              <linearGradient id={g("sky")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c2d12" />
                <stop offset="45%" stopColor="#ea580c" />
                <stop offset="75%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#78350f" />
              </linearGradient>
              <radialGradient id={g("sun")} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#fffbeb" />
                <stop offset="55%" stopColor="#fef08a" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="100" height="100" fill={`url(#${g("sky")})`} />
            <circle cx="62" cy="44" r="22" fill={`url(#${g("sun")})`} />
            <path d="M-10,75 Q30,55 70,72 L110,65 L110,100 L-10,100 Z" fill="#9a3412" />
            <path d="M-10,82 Q40,68 90,85 L110,80 L110,100 L-10,100 Z" fill="#451a03" />
            {/* Camel with spice bundle */}
            <path d="M42,66 Q44,56 47,56 Q49,60 52,60 Q55,54 58,58 L60,66 L58,74 L56.5,74 L55.5,68 L48,68 L47,74 L45.5,74 L44.5,68 Z" fill="#1c0a02" />
            <path d="M42,66 Q40,60 41,55" stroke="#1c0a02" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            <circle cx="41.5" cy="54" r="2.2" fill="#1c0a02" />
            <ellipse cx="53" cy="58" rx="4" ry="2.8" fill="#b45309" />
            <ellipse cx="53" cy="57.2" rx="2.6" ry="1.2" fill="#dc2626" opacity="0.85" />
            {/* Turbaned caravaneer with staff */}
            <circle cx="28" cy="64" r="2.5" fill="#fde68a" />
            <path d="M25.5,63 Q27,59 31,61 Q30.5,63 28,62.5 Z" fill="#f8fafc" />
            <path d="M25,67 L31,67 L33,77 L23.5,77 Z" fill="#78350f" />
            <line x1="33" y1="63" x2="34" y2="78" stroke="#fde047" strokeWidth="0.9" />
            {/* Distant second camel */}
            <path d="M78,68 q1.5-4 3-4 q1 1.5 2.5 1.5 q1.5-2.5 3-.5 l.5 3 z" fill="#3b1606" opacity="0.8" />
          </>
        )}

        {scene === "OASIS_HARVEST" && (
          <>
            <defs>
              <linearGradient id={g("sky")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#064e3b" />
                <stop offset="50%" stopColor="#0f766e" />
                <stop offset="100%" stopColor="#fef3c7" />
              </linearGradient>
              <radialGradient id={g("pool")} cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#7dd3fc" />
                <stop offset="100%" stopColor="#0369a1" />
              </radialGradient>
            </defs>
            <rect width="100" height="100" fill={`url(#${g("sky")})`} />
            <path d="M-5,78 Q40,66 105,76 L105,100 L-5,100 Z" fill="#d6b273" />
            <ellipse cx="66" cy="84" rx="32" ry="10" fill={`url(#${g("pool")})`} opacity="0.95" />
            <path d="M44,82 q6-1 12 0 M68,86 q7-1 14 0" stroke="#e0f2fe" strokeWidth="0.7" opacity="0.7" fill="none" strokeLinecap="round" />
            {/* Palms */}
            <path d="M18,92 Q22,52 15,30" stroke="#78350f" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            <path d="M15,30 Q30,22 42,32 M15,30 Q28,34 35,46 M15,30 Q5,20 -5,28 M15,30 Q0,35 2,48 M15,30 Q18,18 26,14" stroke="#15803d" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M88,78 Q86,56 90,42" stroke="#78350f" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            <path d="M90,42 Q80,36 72,42 M90,42 Q98,36 106,42 M90,42 Q84,48 80,56" stroke="#166534" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            {/* Harvester carrying a basket of turmeric/saffron */}
            <circle cx="48" cy="62" r="3" fill="#fed7aa" />
            <path d="M44.5,61 Q48,57.5 51.5,61 Z" fill="#fef3c7" />
            <ellipse cx="48" cy="56.5" rx="5.5" ry="2.5" fill="#92400e" />
            <ellipse cx="48" cy="55.5" rx="4" ry="1.3" fill="#eab308" />
            <path d="M43,65 L53,65 L56,84 L40,84 Z" fill="#047857" />
          </>
        )}

        {scene === "BAZAAR_MARKET" && (
          <>
            <defs>
              <radialGradient id={g("lamp")} cx="50%" cy="30%" r="60%">
                <stop offset="0%" stopColor="#fef08a" stopOpacity="0.9" />
                <stop offset="40%" stopColor="#ea580c" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#1a0a03" stopOpacity="0.98" />
              </radialGradient>
              <linearGradient id={g("brass")} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#78350f" />
                <stop offset="45%" stopColor="#d97706" />
                <stop offset="100%" stopColor="#78350f" />
              </linearGradient>
            </defs>
            <rect width="100" height="100" fill="#1a0a03" />
            <rect width="100" height="100" fill={`url(#${g("lamp")})`} />
            <polygon points="0,0 100,0 90,22 10,22" fill="#b91c1c" />
            <path d="M22,0 L26,22 M42,0 L44,22 M58,0 L56,22 M78,0 L74,22" stroke="#7f1d1d" strokeWidth="2" />
            <path d="M10,22 Q20,28 30,22 Q40,28 50,22 Q60,28 70,22 Q80,28 90,22" fill="#facc15" />
            {/* Brass jars with spice pyramids */}
            <path d="M16,88 L24,62 L36,62 L44,88 Z" fill={`url(#${g("brass")})`} stroke="#451a03" strokeWidth="0.8" />
            <polygon points="24,62 36,62 30,50" fill="#dc2626" />
            <path d="M56,88 L64,65 L76,65 L84,88 Z" fill={`url(#${g("brass")})`} stroke="#451a03" strokeWidth="0.8" />
            <polygon points="64,65 76,65 70,54" fill="#eab308" />
            <path d="M84,90 L88,76 L96,76 L100,90 Z" fill={`url(#${g("brass")})`} opacity="0.85" />
            <polygon points="88,76 96,76 92,69" fill="#16a34a" />
            {/* Merchant with balance scale */}
            <circle cx="50" cy="38" r="4.5" fill="#fde68a" />
            <ellipse cx="50" cy="34.5" rx="5.5" ry="3" fill="#be123c" />
            <path d="M42,44 L58,44 L60,65 L40,65 Z" fill="#1e1b4b" />
            <line x1="57" y1="47" x2="70" y2="43" stroke="#facc15" strokeWidth="1" />
            <line x1="63.5" y1="45" x2="63.5" y2="50" stroke="#facc15" strokeWidth="0.6" />
            <path d="M60,50 q3.5 3 7 0 Z" fill="#ca8a04" />
          </>
        )}

        {scene === "PORT_TRADE" && (
          <>
            <defs>
              <linearGradient id={g("sky")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1e3a8a" />
                <stop offset="40%" stopColor="#b45309" />
                <stop offset="65%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#082f49" />
              </linearGradient>
              <linearGradient id={g("sea")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#155e75" />
                <stop offset="100%" stopColor="#082f49" />
              </linearGradient>
            </defs>
            <rect width="100" height="100" fill={`url(#${g("sky")})`} />
            <circle cx="78" cy="58" r="7" fill="#fde68a" opacity="0.85" />
            <rect x="0" y="65" width="100" height="35" fill={`url(#${g("sea")})`} />
            <path d="M60,68 h36 M66,72 h26 M72,76 h16" stroke="#fcd34d" strokeWidth="0.8" opacity="0.55" />
            {/* Merchant galley */}
            <path d="M22,70 Q50,78 78,70 L72,79 L28,79 Z" fill="#451a03" stroke="#291203" strokeWidth="1" />
            <line x1="45" y1="30" x2="45" y2="72" stroke="#78350f" strokeWidth="1.8" />
            <path d="M45,32 Q68,48 45,62 Z" fill="#fef3c7" opacity="0.92" />
            <line x1="58" y1="38" x2="58" y2="72" stroke="#78350f" strokeWidth="1.4" />
            <path d="M58,40 Q75,52 58,62 Z" fill="#e2e8f0" opacity="0.85" />
            <path d="M45,30 l5 2 -5 2 z" fill="#dc2626" />
            {/* Dock with spice sacks */}
            <polygon points="0,82 32,82 25,100 0,100" fill="#291203" />
            <ellipse cx="12" cy="85" rx="5" ry="3.5" fill="#a16207" />
            <ellipse cx="19" cy="82.5" rx="4" ry="3" fill="#854d0e" />
            <ellipse cx="7" cy="81" rx="3.5" ry="2.6" fill="#7f1d1d" />
          </>
        )}

        {scene === "SULTAN_PALACE" && (
          <>
            <defs>
              <radialGradient id={g("sky")} cx="50%" cy="35%" r="65%">
                <stop offset="0%" stopColor="#fef08a" stopOpacity="0.9" />
                <stop offset="30%" stopColor="#f59e0b" stopOpacity="0.65" />
                <stop offset="70%" stopColor="#4c0519" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#090104" />
              </radialGradient>
              <linearGradient id={g("dome")} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#a16207" />
                <stop offset="40%" stopColor="#fde047" />
                <stop offset="100%" stopColor="#92400e" />
              </linearGradient>
            </defs>
            <rect width="100" height="100" fill="#090104" />
            <rect width="100" height="100" fill={`url(#${g("sky")})`} />
            {/* Palace body + minarets */}
            <rect x="30" y="56" width="40" height="34" fill="#2a1508" />
            <path d="M44,90 V74 a6 6 0 0 1 12 0 V90 Z" fill="#fbbf24" opacity="0.35" />
            <rect x="18" y="42" width="10" height="48" fill="#1f130b" />
            <polygon points="18,42 23,24 28,42" fill={`url(#${g("dome")})`} />
            <rect x="72" y="42" width="10" height="48" fill="#1f130b" />
            <polygon points="72,42 77,24 82,42" fill={`url(#${g("dome")})`} />
            <path d="M34,58 C34,36 44,30 50,22 C56,30 66,36 66,58 Z" fill={`url(#${g("dome")})`} stroke="#ca8a04" strokeWidth="1" />
            {/* Crescent finial */}
            <circle cx="50" cy="17" r="2.6" fill="#fde047" />
            <circle cx="51.2" cy="16.4" r="2.2" fill="#b45309" />
            <polygon points="28,98 72,98 64,86 36,86" fill="#881337" stroke="#fbbf24" strokeWidth="0.8" />
            {/* Arabesque arch frame */}
            <path d="M8,0 L8,100 M92,0 L92,100" stroke="#b45309" strokeWidth="4" />
            <path d="M8,26 Q50,0 92,26" fill="none" stroke="#facc15" strokeWidth="2" />
            {/* Victory-point gems */}
            <circle cx="15" cy="95" r="2" fill="#10b981" />
            <circle cx="85" cy="95" r="2" fill="#e11d48" />
          </>
        )}

        {scene === "ALCHEMY_LAB" && (
          <>
            <defs>
              <radialGradient id={g("glow")} cx="50%" cy="58%" r="50%">
                <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.8" />
                <stop offset="45%" stopColor="#0891b2" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#050811" stopOpacity="0.98" />
              </radialGradient>
            </defs>
            <rect width="100" height="100" fill="#050811" />
            <rect width="100" height="100" fill={`url(#${g("glow")})`} />
            <path d="M12,0 L12,85 M88,0 L88,85" stroke="#1e293b" strokeWidth="6" />
            {/* Shelf of spice jars */}
            <line x1="15" y1="30" x2="36" y2="30" stroke="#78350f" strokeWidth="1.5" />
            <rect x="17" y="23" width="4" height="7" rx="1" fill="#eab308" />
            <rect x="23" y="24" width="4" height="6" rx="1" fill="#dc2626" />
            <rect x="29" y="22" width="4" height="8" rx="1" fill="#16a34a" />
            {/* Distillation flask, burner, rising essence */}
            <path d="M46,40 L54,40 L60,62 L40,62 Z" fill="#a5f3fc" opacity="0.75" stroke="#0891b2" strokeWidth="1.2" />
            <ellipse cx="50" cy="62" rx="10" ry="3" fill="#0891b2" />
            <path d="M44,66 L56,66 L54,74 L46,74 Z" fill="#334155" />
            <path d="M48,66 q2-4 4 0" fill="#f97316" />
            <circle cx="48" cy="54" r="1.5" fill="#fef08a" />
            <circle cx="53" cy="50" r="1.8" fill="#fef08a" />
            <circle cx="50" cy="45" r="1.2" fill="#ffffff" />
            {/* Upgrade arrow aura */}
            <polygon points="50,22 43,32 57,32" fill="#facc15" className="animate-pulse" />
            <path d="M64,70 L72,62 L80,70" stroke="#78350f" strokeWidth="1" fill="none" />
            <rect x="60" y="70" width="24" height="3" fill="#78350f" />
          </>
        )}

        <rect width="100" height="100" fill={`url(#${g("vig")})`} />
      </svg>
      {size === "hero" && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent py-1 text-center">
          <span className="font-serif text-[10px] font-black tracking-widest text-amber-200/90 drop-shadow-[0_1px_3px_rgba(0,0,0,1)]">{SCENE_LABEL[scene]}</span>
        </div>
      )}
    </div>
  );
}
