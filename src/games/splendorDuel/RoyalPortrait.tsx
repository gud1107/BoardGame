import { useId } from "react";

/**
 * Inline-SVG bust portraits for the 4 royal cards — entirely fictional
 * characters (names live in cards.ts `createRoyalCards`), drawn in code like
 * every other visual in this project (no image assets). Each one differs in
 * silhouette details (headwear, hair, beard, robe color) so they're
 * recognizable even at the ~50px width of the phone market row.
 */

interface Look {
  bg: [string, string];
  skin: string;
  hair: string;
  robe: string;
  trim: string;
  longHair?: boolean;
  beard?: boolean;
  headwear: "tiara" | "cap" | "circlet" | "crown";
  ermine?: boolean;
  scroll?: boolean;
}

const LOOKS: Record<string, Look> = {
  "royal-steal": { bg: ["#9f1239", "#1c0710"], skin: "#f3cdb0", hair: "#2b1a14", robe: "#881337", trim: "#fbbf24", longHair: true, headwear: "tiara" },
  "royal-privilege": { bg: ["#1e40af", "#070d24"], skin: "#e7b592", hair: "#d6d3d1", robe: "#1e3a8a", trim: "#fcd34d", beard: true, headwear: "cap", scroll: true },
  "royal-extra": { bg: ["#047857", "#03140f"], skin: "#f6d3b8", hair: "#e0a526", robe: "#065f46", trim: "#fde68a", headwear: "circlet" },
  "royal-plain": { bg: ["#6d28d9", "#12071f"], skin: "#d9a27c", hair: "#5b3417", robe: "#5b21b6", trim: "#facc15", beard: true, headwear: "crown", ermine: true },
};

export default function RoyalPortrait({ royalId, className = "h-full w-full" }: { royalId: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const l = LOOKS[royalId] ?? LOOKS["royal-plain"];
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={`${id}-bg`} cx="0.5" cy="0.35" r="0.8">
          <stop offset="0" stopColor={l.bg[0]} />
          <stop offset="1" stopColor={l.bg[1]} />
        </radialGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b0" />
          <stop offset="0.5" stopColor={l.trim} />
          <stop offset="1" stopColor="#8a5a00" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id}-bg)`} />
      {/* Soft halo */}
      <circle cx="50" cy="42" r="30" fill="#ffffff" fillOpacity="0.06" />

      {/* Long hair falls behind the shoulders */}
      {l.longHair && <path d="M32 40 C30 62, 28 76, 34 84 L66 84 C72 76, 70 62, 68 40 Z" fill={l.hair} />}

      {/* Robe + trim */}
      <path d="M8 100 C12 78, 28 69, 50 69 C72 69, 88 78, 92 100 Z" fill={l.robe} />
      <path d="M36 71 L50 90 L64 71" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="3" strokeLinejoin="round" />
      {l.ermine && (
        <g>
          <path d="M14 90 C20 76, 34 70, 50 70 C66 70, 80 76, 86 90 C74 84, 62 81, 50 81 C38 81, 26 84, 14 90 Z" fill="#f8fafc" />
          {[26, 38, 50, 62, 74].map((x) => (
            <path key={x} d={`M${x} ${x === 50 ? 76 : 79} l1.5 3 l-3 0 Z`} fill="#111827" />
          ))}
        </g>
      )}

      {/* Neck + head */}
      <rect x="44" y="54" width="12" height="16" rx="4" fill={l.skin} />
      <ellipse cx="50" cy="44" rx="15" ry="17" fill={l.skin} />
      {/* Ears */}
      <ellipse cx="35.5" cy="46" rx="2.5" ry="4" fill={l.skin} />
      <ellipse cx="64.5" cy="46" rx="2.5" ry="4" fill={l.skin} />

      {/* Front hair */}
      {l.longHair ? (
        <path d="M34 44 C33 30, 42 25, 50 25 C58 25, 67 30, 66 44 C62 36, 56 33, 50 33 C44 33, 38 36, 34 44 Z" fill={l.hair} />
      ) : l.headwear === "cap" ? null : (
        <path d="M35 42 C35 30, 43 26, 50 26 C57 26, 65 30, 65 42 C61 35, 55 33, 50 34 C45 33, 39 35, 35 42 Z" fill={l.hair} />
      )}

      {/* Face */}
      <ellipse cx="44" cy="46" rx="1.8" ry="2.2" fill="#1f1411" />
      <ellipse cx="56" cy="46" rx="1.8" ry="2.2" fill="#1f1411" />
      <path d="M40.5 41.5 Q44 39.5 47 41" fill="none" stroke={l.beard ? l.hair : "#3b2418"} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M53 41 Q56 39.5 59.5 41.5" fill="none" stroke={l.beard ? l.hair : "#3b2418"} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="41" cy="51" r="2.6" fill="#f472b6" fillOpacity="0.22" />
      <circle cx="59" cy="51" r="2.6" fill="#f472b6" fillOpacity="0.22" />
      {l.beard ? (
        <path d="M37 50 C38 62, 44 67, 50 67 C56 67, 62 62, 63 50 C59 56, 55 57, 50 57 C45 57, 41 56, 37 50 Z" fill={l.hair} />
      ) : null}
      <path d={l.beard ? "M46.5 54.5 Q50 56.5 53.5 54.5" : "M46 54 Q50 57 54 54"} fill="none" stroke="#7c2d12" strokeWidth="1.4" strokeLinecap="round" />

      {/* Headwear */}
      {l.headwear === "tiara" && (
        <g>
          <path d="M37 31 L41 25 L45 29 L50 21 L55 29 L59 25 L63 31 Q50 27 37 31 Z" fill={`url(#${id}-gold)`} />
          <circle cx="50" cy="25.5" r="2.2" fill="#e0194a" stroke="#fff" strokeOpacity="0.6" strokeWidth="0.6" />
        </g>
      )}
      {l.headwear === "circlet" && (
        <g>
          <path d="M35.5 35 Q50 29 64.5 35" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="50" cy="31.2" r="1.9" fill="#34d399" stroke="#fff" strokeOpacity="0.6" strokeWidth="0.5" />
        </g>
      )}
      {l.headwear === "cap" && (
        <g>
          <path d="M34 38 C34 24, 42 20, 50 20 C58 20, 66 24, 66 38 Z" fill="#1e3a8a" />
          <rect x="33" y="34" width="34" height="5" rx="2" fill={`url(#${id}-gold)`} />
          <path d="M35 40 C35 44, 36 47, 37 49 M65 40 C65 44, 64 47, 63 49" stroke={l.hair} strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      {l.headwear === "crown" && (
        <g>
          <path d="M34 34 L34 18 L41 25 L50 13 L59 25 L66 18 L66 34 Z" fill={`url(#${id}-gold)`} stroke="#8a5a00" strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
          <rect x="33" y="31" width="34" height="5" rx="1.5" fill="#b91c1c" fillOpacity="0.85" />
          {[40, 50, 60].map((x, i) => (
            <circle key={x} cx={x} cy="33.5" r="1.6" fill={["#38bdf8", "#f8fafc", "#34d399"][i]} />
          ))}
          <circle cx="50" cy="13" r="2" fill="#f8fafc" />
        </g>
      )}

      {l.scroll && (
        <g transform="rotate(-18 80 84)">
          <rect x="70" y="79" width="20" height="9" rx="2" fill="#f5e6c4" stroke="#a16207" strokeWidth="0.8" />
          <circle cx="70" cy="83.5" r="4.5" fill="#e7d3a4" stroke="#a16207" strokeWidth="0.8" />
          <circle cx="90" cy="83.5" r="4.5" fill="#e7d3a4" stroke="#a16207" strokeWidth="0.8" />
        </g>
      )}
    </svg>
  );
}
