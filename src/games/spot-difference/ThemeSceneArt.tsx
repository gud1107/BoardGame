"use client";

import { useId, type ReactNode } from "react";
import { Arcade, Bakery, Bazaar, Camping, Haunted, Orbital } from "./ThemeSceneArtMore";

/**
 * Hand-built SVG artwork for the themed stages (themeScenes.ts). Same
 * 0..100 stretched viewBox as SpotDifferenceScene.tsx, so every mutation's
 * `xPct`/`yPct` is directly its drawing position. `active` holds the
 * mutation ids that differ on this side — always empty for the original
 * panel, the stage's drawn subset for the modified one. Every mutation's
 * visual change stays inside its own hit radius.
 *
 * Only deterministic geometry here (no Math.random) — both panels, and every
 * client, must render the exact same non-mutated pixels.
 */

type ArtProps = { on: (id: string) => boolean; p: string };

export default function ThemeSceneArt({
  themeId,
  active,
  className,
}: {
  themeId: string;
  active: Set<string>;
  className?: string;
}) {
  const p = `ts${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const on = (id: string) => active.has(id);
  let art: ReactNode = null;
  if (themeId === "theme-cyberpunk") art = <Cyberpunk on={on} p={p} />;
  else if (themeId === "theme-greenhouse") art = <Greenhouse on={on} p={p} />;
  else if (themeId === "theme-alchemy") art = <Alchemy on={on} p={p} />;
  else if (themeId === "theme-deepsea") art = <DeepSea on={on} p={p} />;
  else if (themeId === "theme-bazaar") art = <Bazaar on={on} p={p} />;
  else if (themeId === "theme-orbital") art = <Orbital on={on} p={p} />;
  else if (themeId === "theme-bakery") art = <Bakery on={on} p={p} />;
  else if (themeId === "theme-arcade") art = <Arcade on={on} p={p} />;
  else if (themeId === "theme-camping") art = <Camping on={on} p={p} />;
  else if (themeId === "theme-haunted") art = <Haunted on={on} p={p} />;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={className}>
      {art}
    </svg>
  );
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// ---------------------------------------------------------------------------
// 1. 사이버펑크 네온 골목
// ---------------------------------------------------------------------------
function Cyberpunk({ on, p }: ArtProps) {
  const neon = on("neonSign") ? "#22d3ee" : "#f43f5e";
  const lampOn = !on("streetLamp");
  return (
    <>
      <defs>
        <linearGradient id={`${p}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#07040f" />
          <stop offset="55%" stopColor="#1a0b2e" />
          <stop offset="100%" stopColor="#3b0f4f" />
        </linearGradient>
        <linearGradient id={`${p}street`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1b1033" />
          <stop offset="100%" stopColor="#05030a" />
        </linearGradient>
        <radialGradient id={`${p}glow`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${p}sky)`} />
      {/* distant skyline */}
      {[
        [30, 30, 8, 46],
        [38, 22, 6, 54],
        [45, 36, 9, 40],
        [55, 26, 7, 50],
        [62, 33, 8, 43],
      ].map(([x, y, w, h], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} fill="#150d2b" />
          {range(Math.floor(h / 6)).map((r) => (
            <rect key={r} x={x + 1.5} y={y + 2 + r * 6} width={1.2} height={1.6} fill="#a78bfa" opacity={(i + r) % 3 === 0 ? 0.55 : 0.12} />
          ))}
        </g>
      ))}
      {/* rain */}
      {range(26).map((i) => (
        <line key={i} x1={(i * 37) % 100} y1={(i * 23) % 70} x2={((i * 37) % 100) - 1.2} y2={((i * 23) % 70) + 5} stroke="#c4b5fd" strokeWidth="0.2" opacity="0.35" />
      ))}
      {/* left building */}
      <rect x="0" y="8" width="30" height="70" fill="#0f1024" />
      <rect x="29" y="8" width="1.2" height="70" fill="#1e1b3a" />
      {range(6).map((r) =>
        range(2).map((c) => (
          <rect key={`${r}-${c}`} x={3 + c * 6} y={40 + r * 6} width={3.5} height={3} fill={(r + c) % 2 ? "#fde68a" : "#1e1b3a"} opacity={0.55} />
        )),
      )}
      {/* neon sign */}
      <ellipse cx="22" cy="26" rx="8" ry="11" fill={neon} opacity="0.18" />
      <rect x="18.5" y="16.5" width="7" height="19" rx="1.5" fill="#0b0716" stroke={neon} strokeWidth="0.8" />
      <path d="M20,19.5 h4 M22,19.5 v5 M20,22 h4 M20.5,24.5 l3,0" stroke={neon} strokeWidth="0.7" fill="none" strokeLinecap="round" />
      <path d="M20,28 h4 v5 h-4 z M20,30.5 h4" stroke={neon} strokeWidth="0.7" fill="none" />
      {/* right building */}
      <rect x="70" y="6" width="30" height="72" fill="#0e0d22" />
      <rect x="69" y="6" width="1.2" height="72" fill="#1e1b3a" />
      {range(7).map((r) =>
        range(3).map((c) => {
          const isTarget = r === 3 && c === 1;
          const x = 73 + c * 9;
          const y = 12 + r * 4 + (r > 2 ? 0 : 0);
          if (isTarget) return null;
          return <rect key={`${r}-${c}`} x={x} y={y} width={5} height={2.6} fill={(r * 2 + c) % 3 === 0 ? "#fbbf24" : "#1e1b3a"} opacity={0.6} />;
        }),
      )}
      {/* target window (82,24) */}
      <rect x="79.5" y="22" width="5" height="4" fill={on("window") ? "#1e1b3a" : "#fbbf24"} opacity={on("window") ? 0.9 : 0.85} stroke="#312e81" strokeWidth="0.3" />
      {/* drone */}
      {!on("drone") && (
        <g>
          <line x1="55" y1="12" x2="65" y2="12" stroke="#64748b" strokeWidth="0.6" />
          <ellipse cx="55" cy="11.6" rx="2" ry="0.5" fill="#94a3b8" />
          <ellipse cx="65" cy="11.6" rx="2" ry="0.5" fill="#94a3b8" />
          <ellipse cx="60" cy="14" rx="3.2" ry="1.8" fill="#334155" />
          <circle cx="60" cy="14.4" r="0.9" fill="#ef4444" />
          <path d="M58.5,16 L57,19 L63,19 L61.5,16 Z" fill="#ef4444" opacity="0.18" />
        </g>
      )}
      {/* hologram koi */}
      <ellipse cx="44" cy="41" rx="4" ry="0.8" fill="none" stroke="#22d3ee" strokeWidth="0.4" opacity="0.7" />
      <g transform={on("holoFish") ? "translate(88 0) scale(-1 1)" : undefined} opacity="0.75">
        <path d="M39,34 Q43,29.5 48,33 L51,30.5 L50.2,34 L51,37.5 L48,35 Q43,38.5 39,34 Z" fill="#22d3ee" fillOpacity="0.35" stroke="#67e8f9" strokeWidth="0.4" />
        <circle cx="41" cy="33.5" r="0.5" fill="#ecfeff" />
      </g>
      {/* overhead wire + spark */}
      <path d="M30,46 Q47,56 70,48" stroke="#334155" strokeWidth="0.6" fill="none" />
      {on("wireSpark") && (
        <g>
          <circle cx="34" cy="48.2" r="3" fill={`url(#${p}glow)`} />
          <path d="M34,45.4 L34.8,47.6 L37,48.2 L34.8,48.8 L34,51 L33.2,48.8 L31,48.2 L33.2,47.6 Z" fill="#facc15" />
        </g>
      )}
      {/* street */}
      <rect x="0" y="76" width="100" height="24" fill={`url(#${p}street)`} />
      {range(5).map((i) => (
        <rect key={i} x={6 + i * 20} y={80 + (i % 2) * 6} width={8} height={0.5} fill="#f0abfc" opacity="0.18" />
      ))}
      {/* street lamp */}
      <rect x="61.5" y="55" width="1" height="21" fill="#1e293b" />
      <path d="M59.5,55 L64.5,55 L63.5,53 L60.5,53 Z" fill="#334155" />
      {lampOn && <ellipse cx="62" cy="57.5" rx="4.5" ry="3.5" fill="#fde68a" opacity="0.28" />}
      <ellipse cx="62" cy="55.6" rx="1.6" ry="0.7" fill={lampOn ? "#fde68a" : "#475569"} />
      {/* vending machine */}
      <rect x="80.5" y="49" width="11" height="27" rx="1" fill="#1e293b" stroke="#475569" strokeWidth="0.4" />
      <rect x="82" y="51" width="8" height="5" fill="#0f172a" />
      {range(3).map((i) => (
        <rect key={i} x={82.8 + i * 2.5} y={52} width={1.6} height={3} rx={0.4} fill={["#f43f5e", "#38bdf8", "#a3e635"][i]} />
      ))}
      <rect x="83" y="57.5" width="6" height="4" rx="0.5" fill={on("vending") ? "#22c55e" : "#f59e0b"} />
      <rect x="83" y="66" width="6" height="2" fill="#0f172a" />
      {/* robot cat */}
      <ellipse cx="34" cy="82" rx="3.8" ry="2.4" fill="#475569" />
      <circle cx="30" cy="79.5" r="2" fill="#64748b" />
      <path d="M28.6,78.2 L28.9,76.3 L30,77.6 Z M30.6,77.6 L31.6,76.3 L31.7,78.3 Z" fill="#64748b" />
      <circle cx="29.4" cy="79.4" r="0.35" fill="#22d3ee" />
      <path
        d={on("roboCat") ? "M37.5,81 Q39.5,76 42.5,74.5" : "M37.5,82 Q42.5,85 42.5,79.5"}
        stroke="#38bdf8"
        strokeWidth="0.9"
        fill="none"
        strokeLinecap="round"
      />
      {/* puddle */}
      <ellipse cx="62" cy="89" rx="10" ry="2.6" fill="#1e1b4b" />
      <ellipse cx="62" cy="89" rx="6" ry="0.9" fill={on("puddle") ? "#22d3ee" : "#f43f5e"} opacity="0.55" />
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. 보태니컬 온실 티하우스
// ---------------------------------------------------------------------------
function Greenhouse({ on, p }: ArtProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${p}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0fdf4" />
          <stop offset="55%" stopColor="#bbf7d0" />
          <stop offset="100%" stopColor="#fef3c7" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${p}sun)`} />
      {/* glass frame */}
      <g stroke="#065f46" strokeWidth="0.8" opacity="0.28" fill="none">
        {[10, 30, 70, 90].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="78" />
        ))}
        <path d="M0,42 Q50,4 100,42" />
        <line x1="0" y1="60" x2="100" y2="60" />
      </g>
      {range(6).map((i) => (
        <path key={i} d={`M${4 + i * 17},${6 + (i % 2) * 4} l6,10`} stroke="#ffffff" strokeWidth="0.8" opacity="0.5" />
      ))}
      {/* stained glass rosette (50,11) */}
      <circle cx="50" cy="11" r="5.2" fill="#fef9c3" stroke="#065f46" strokeWidth="0.5" />
      {range(6).map((i) => {
        const a = (i * Math.PI) / 3;
        return <circle key={i} cx={50 + Math.cos(a) * 3} cy={11 + Math.sin(a) * 3} r="1.5" fill={on("stainedGlass") ? "#60a5fa" : "#f472b6"} opacity="0.85" />;
      })}
      <circle cx="50" cy="11" r="1.4" fill="#fde047" />
      {/* hanging monstera (18,24) */}
      <line x1="18" y1="0" x2="18" y2="16" stroke="#78350f" strokeWidth="0.4" />
      <path d="M14.5,16 L21.5,16 L20.5,21 L15.5,21 Z" fill="#c2410c" />
      <ellipse cx="14" cy="24" rx="3.6" ry="2.4" fill="#15803d" transform="rotate(-25 14 24)" />
      {!on("monstera") && <ellipse cx="22" cy="25" rx="3.6" ry="2.4" fill="#16a34a" transform="rotate(30 22 25)" />}
      <ellipse cx="18" cy="29" rx="3" ry="2.2" fill="#22c55e" />
      <path d="M15,21 Q13,30 16,36 M20,21 Q23,30 21,37" stroke="#16a34a" strokeWidth="0.5" fill="none" />
      {/* butterfly (38,34) */}
      {(() => {
        const wing = on("butterfly") ? "#a78bfa" : "#f97316";
        return (
          <g>
            <ellipse cx="36.3" cy="32.8" rx="1.9" ry="1.4" fill={wing} />
            <ellipse cx="39.7" cy="32.8" rx="1.9" ry="1.4" fill={wing} />
            <ellipse cx="36.7" cy="35.2" rx="1.3" ry="1" fill={wing} opacity="0.85" />
            <ellipse cx="39.3" cy="35.2" rx="1.3" ry="1" fill={wing} opacity="0.85" />
            <rect x="37.7" y="31.8" width="0.6" height="4.4" rx="0.3" fill="#1c1917" />
          </g>
        );
      })()}
      {/* bird cage (84,28) */}
      <line x1="84" y1="0" x2="84" y2="17" stroke="#a16207" strokeWidth="0.4" />
      <path d="M78,38 L78,24 Q84,14 90,24 L90,38 Z" fill="#fef3c7" fillOpacity="0.35" stroke="#ca8a04" strokeWidth="0.6" />
      {[80, 82, 84, 86, 88].map((x) => (
        <line key={x} x1={x} y1="21" x2={x} y2="38" stroke="#ca8a04" strokeWidth="0.3" />
      ))}
      <line x1="79" y1="33" x2="89" y2="33" stroke="#92400e" strokeWidth="0.5" />
      {!on("birdCage") && (
        <g>
          <ellipse cx="84" cy="30.5" rx="2" ry="1.6" fill="#0284c7" />
          <circle cx="85.4" cy="29.2" r="1" fill="#0ea5e9" />
          <path d="M86.3,29.2 L87.4,29.5 L86.3,29.8 Z" fill="#f59e0b" />
        </g>
      )}
      {/* table */}
      <rect x="46" y="72" width="4" height="18" fill="#92400e" />
      <ellipse cx="48" cy="66" rx="30" ry="7" fill="#b45309" />
      <ellipse cx="48" cy="65" rx="29" ry="6" fill="#fffbeb" />
      {/* teacup (30,58) */}
      <path d="M26.5,59.5 L33.5,59.5 L32.5,64 L27.5,64 Z" fill="#ffffff" stroke="#d97706" strokeWidth="0.4" />
      <path d="M33.3,60.5 Q35.5,61 33,63" stroke="#d97706" strokeWidth="0.5" fill="none" />
      <ellipse cx="30" cy="64.4" rx="4.5" ry="0.8" fill="#fde68a" />
      <path
        d={on("teaSteam") ? "M30,58.5 Q27,56 29.5,54 Q31.5,52.5 27,51" : "M30,58.5 Q33,56 30.5,54 Q28.5,52.5 33,51"}
        stroke="#94a3b8"
        strokeWidth="0.7"
        fill="none"
        strokeLinecap="round"
      />
      {/* cake stand (52,50) */}
      <ellipse cx="52" cy="61" rx="7" ry="1.2" fill="#e5e7eb" />
      <rect x="51.5" y="58" width="1" height="3" fill="#d1d5db" />
      <rect x="46" y="54" width="12" height="4.5" rx="1" fill="#fbcfe8" />
      <rect x="48.5" y="50.5" width="7" height="3.6" rx="0.8" fill="#f472b6" />
      <path d="M46,55 q1.5,1.2 3,0 q1.5,1.2 3,0 q1.5,1.2 3,0 q1.5,1.2 3,0" stroke="#ffffff" strokeWidth="0.5" fill="none" />
      {!on("cakeCherry") && (
        <g>
          <circle cx="52" cy="49.2" r="1.3" fill="#e11d48" />
          <path d="M52,48 Q52.8,46.6 53.6,46.4" stroke="#15803d" strokeWidth="0.3" fill="none" />
        </g>
      )}
      {/* macaron plate (68,64) */}
      <ellipse cx="68" cy="65.5" rx="6" ry="1.4" fill="#f5f5f4" stroke="#d6d3d1" strokeWidth="0.3" />
      {[
        [64.8, "#f9a8d4"],
        [68, on("macaron") ? "#93c5fd" : "#86efac"],
        [71.2, "#fde68a"],
      ].map(([x, c]) => (
        <g key={x as number}>
          <ellipse cx={x as number} cy="63.2" rx="1.5" ry="0.8" fill={c as string} />
          <rect x={(x as number) - 1.3} y="63.4" width="2.6" height="0.6" fill="#fff7ed" />
          <ellipse cx={x as number} cy="64.4" rx="1.5" ry="0.7" fill={c as string} />
        </g>
      ))}
      {/* floor tiles */}
      {range(10).map((i) => (
        <rect key={i} x={i * 10} y="90" width="10" height="10" fill={i % 2 ? "#e7e5e4" : "#d6d3d1"} />
      ))}
      <rect x="0" y="78" width="100" height="12" fill="#f5f5f4" opacity="0.6" />
      {/* potted fern */}
      <path d="M92,78 L99,78 L98,88 L93,88 Z" fill="#c2410c" />
      <path d="M95.5,78 Q90,70 91,64 M95.5,78 Q97,68 99,63 M95.5,78 Q95,70 95,62" stroke="#15803d" strokeWidth="0.8" fill="none" />
      {/* sleeping cat (82,78) */}
      <ellipse cx="84" cy="80" rx="7.5" ry="4" fill="#f59e0b" />
      <path d="M79,78 q2,2 0,4 M83,76.5 q2,2 0,5 M87,77 q2,2 0,4.5" stroke="#b45309" strokeWidth="0.5" fill="none" />
      <circle cx="77" cy="79" r="3.2" fill="#fbbf24" />
      <path d="M74.6,77.5 L75,74.8 L76.8,76.3 Z M77.4,76 L79,74.6 L79.3,77.2 Z" fill="#fbbf24" />
      <path d="M75.2,79.2 q0.8,0.6 1.6,0 M77.6,79.2 q0.8,0.6 1.6,0" stroke="#78350f" strokeWidth="0.35" fill="none" />
      <path d="M91,81 Q94,84 90,85" stroke="#f59e0b" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M75.5,81.6 Q77.5,82.6 79.5,81.6" stroke="#dc2626" strokeWidth="0.6" fill="none" />
      {on("catBell") && <circle cx="77.6" cy="82.6" r="1" fill="#facc15" stroke="#a16207" strokeWidth="0.25" />}
      {/* watering can (16,84) */}
      {(() => {
        const c = on("wateringCan") ? "#3b82f6" : "#ef4444";
        return (
          <g>
            <path d="M12,81 L20,81 L21,89 L11,89 Z" fill={c} />
            <path d="M20.5,83 L25,79 L25.8,79.8 L21,85" fill={c} />
            <path d="M12.5,81 Q16,76.5 19.5,81" stroke={c} strokeWidth="0.8" fill="none" />
          </g>
        );
      })()}
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. 연금술사의 마법 서재
// ---------------------------------------------------------------------------
function Alchemy({ on, p }: ArtProps) {
  const flame = on("candle") ? "#38bdf8" : "#f97316";
  return (
    <>
      <defs>
        <radialGradient id={`${p}warm`} cx="80%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#5b3416" />
          <stop offset="100%" stopColor="#0c0604" />
        </radialGradient>
        <radialGradient id={`${p}glow`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${p}warm)`} />
      {/* stone wall */}
      {range(8).map((r) => (
        <line key={r} x1="0" y1={r * 8 + 4} x2="100" y2={r * 8 + 4} stroke="#000" strokeWidth="0.3" opacity="0.25" />
      ))}
      {/* arched window with moon */}
      <path d="M64,30 L64,12 Q70,4 76,12 L76,30 Z" fill="#1e1b4b" stroke="#78350f" strokeWidth="0.8" />
      <circle cx="72" cy="15" r="2.2" fill="#fef9c3" />
      <circle cx="73" cy="14.4" r="1.8" fill="#1e1b4b" />
      <line x1="70" y1="10" x2="70" y2="30" stroke="#78350f" strokeWidth="0.5" />
      {/* bookshelf */}
      <rect x="4" y="4" width="40" height="46" fill="#29180d" stroke="#170c06" strokeWidth="0.8" />
      <rect x="4" y="20" width="40" height="1.4" fill="#4a2a14" />
      <rect x="4" y="46" width="40" height="1.6" fill="#4a2a14" />
      {[
        [6, "#7f1d1d", 11],
        [9, "#14532d", 10],
        [12, "#1e3a8a", 12],
        [15.5, "#78350f", 9],
        [18.5, "#581c87", 11],
        [22, "#854d0e", 10],
        [25, "#0f766e", 11.5],
        [31, "#7c2d12", 10.5],
        [34, "#1e40af", 11],
        [37.5, "#3f6212", 9.5],
        [40.5, "#9f1239", 10],
      ].map(([x, c, h]) => (
        <rect key={x as number} x={x as number} y={20 - (h as number)} width="2.6" height={h as number} fill={c as string} stroke="#000" strokeWidth="0.15" />
      ))}
      {/* target book slot (28,15) */}
      {!on("books") && <rect x="28" y="9.5" width="2.6" height="10.5" fill="#b45309" stroke="#000" strokeWidth="0.15" />}
      <path d="M28.6,12 h1.4 M28.6,17 h1.4" stroke="#fde68a" strokeWidth="0.3" opacity={on("books") ? 0 : 1} />
      {/* celestial globe (22,38) */}
      <rect x="20.5" y="43" width="3" height="3" fill="#a16207" />
      <circle cx="22" cy="37.5" r="5.2" fill="#1e3a8a" stroke="#ca8a04" strokeWidth="0.6" />
      <path d="M17,37.5 h10 M22,32.3 v10.4" stroke="#fde68a" strokeWidth="0.25" opacity="0.6" />
      {range(4).map((i) => (
        <circle key={i} cx={19.5 + i * 1.8} cy={35.5 + (i % 2) * 3} r="0.35" fill="#fef9c3" />
      ))}
      <ellipse
        cx="22"
        cy="37.5"
        rx="7.6"
        ry="2.2"
        fill="none"
        stroke="#facc15"
        strokeWidth="0.7"
        transform={on("globeRing") ? "rotate(38 22 37.5)" : "rotate(-25 22 37.5)"}
      />
      {/* jars on middle shelf */}
      <rect x="32" y="39" width="4" height="7" rx="1" fill="#155e75" opacity="0.8" />
      <rect x="37.5" y="41" width="3.5" height="5" rx="1" fill="#65a30d" opacity="0.8" />
      {/* hanging crystal (52,16) */}
      <line x1="52" y1="0" x2="52" y2="11" stroke="#64748b" strokeWidth="0.4" />
      <circle cx="52" cy="16" r="5" fill={`url(#${p}glow)`} />
      <polygon points="52,11 55,15.5 52,21.5 49,15.5" fill={on("crystal") ? "#c084fc" : "#34d399"} stroke="#ffffff" strokeWidth="0.3" strokeOpacity="0.6" />
      <line x1="49" y1="15.5" x2="55" y2="15.5" stroke="#ffffff" strokeWidth="0.25" opacity="0.6" />
      {/* candle (86,30) */}
      <circle cx="86" cy="28" r="6" fill={`url(#${p}glow)`} />
      <rect x="84.6" y="31" width="2.8" height="11" fill="#f5f5f4" />
      <path d="M82,42 L90,42 L88.5,44 L83.5,44 Z" fill="#a16207" />
      <ellipse cx="86" cy="28.2" rx="1.3" ry="2.6" fill={flame} />
      <ellipse cx="86" cy="29" rx="0.6" ry="1.2" fill="#fef9c3" />
      {/* owl on perch (76,50) */}
      <line x1="68" y1="56" x2="84" y2="56" stroke="#57534e" strokeWidth="1" strokeLinecap="round" />
      <ellipse cx="76" cy="51.5" rx="3.6" ry="4.6" fill="#78350f" />
      <ellipse cx="76" cy="53" rx="2.2" ry="2.8" fill="#d6d3d1" opacity="0.5" />
      <path d="M73,47.5 L73.5,45.4 L75,47 Z M79,47.5 L78.5,45.4 L77,47 Z" fill="#78350f" />
      {on("owl") ? (
        <path d="M73.4,49.5 q1.2,0.9 2.2,0 M76.4,49.5 q1.2,0.9 2.2,0" stroke="#1c1917" strokeWidth="0.45" fill="none" />
      ) : (
        <g>
          <circle cx="74.5" cy="49.4" r="1.3" fill="#fbbf24" />
          <circle cx="77.5" cy="49.4" r="1.3" fill="#fbbf24" />
          <circle cx="74.5" cy="49.4" r="0.55" fill="#1c1917" />
          <circle cx="77.5" cy="49.4" r="0.55" fill="#1c1917" />
        </g>
      )}
      <path d="M75.5,50.8 L76.5,50.8 L76,51.8 Z" fill="#f59e0b" />
      {/* desk */}
      <rect x="0" y="62" width="100" height="38" fill="#451a03" />
      <rect x="0" y="62" width="100" height="1.6" fill="#78350f" />
      {range(4).map((i) => (
        <path key={i} d={`M0,${70 + i * 8} Q50,${68 + i * 8} 100,${71 + i * 8}`} stroke="#2a1002" strokeWidth="0.3" fill="none" />
      ))}
      {/* hourglass (44,68) */}
      <rect x="40.5" y="61.5" width="7" height="0.9" fill="#a16207" />
      <rect x="40.5" y="73.6" width="7" height="0.9" fill="#a16207" />
      <path d="M41.5,62.4 L46.5,62.4 L44,68 Z M41.5,73.6 L46.5,73.6 L44,68 Z" fill="#fef3c7" fillOpacity="0.2" stroke="#ca8a04" strokeWidth="0.35" />
      <polygon points={on("hourglass") ? "42.2,63.2 45.8,63.2 44,67.4" : "43.3,65.8 44.7,65.8 44,67.4"} fill="#eab308" />
      <polygon points={on("hourglass") ? "43.5,73.6 44.5,73.6 44,73" : "42,73.6 46,73.6 44,70.6"} fill="#eab308" />
      {/* potion flask (64,68) */}
      <rect x="62.6" y="59" width="2.8" height="3" fill="#94a3b8" fillOpacity="0.4" stroke="#cbd5e1" strokeWidth="0.3" />
      <rect x="62.3" y="58" width="3.4" height="1.2" fill="#78350f" />
      <path
        d={on("potion") ? "M59.8,70.5 L68.2,70.5 L69.5,74 L58.5,74 Z" : "M61.2,66 L66.8,66 L69.5,74 L58.5,74 Z"}
        fill={on("potion") ? "#a855f7" : "#06b6d4"}
        opacity="0.85"
      />
      <path d="M62.6,62 L65.4,62 L69.5,74 L58.5,74 Z" fill="none" stroke="#cbd5e1" strokeWidth="0.4" />
      {/* inkwell + quill (26,82) */}
      <rect x="20" y="84" width="5" height="4" rx="1" fill="#0f172a" stroke="#475569" strokeWidth="0.3" />
      <path
        d="M22.5,85 Q25,80 31,76 Q29.5,80 23.5,85 Z"
        fill={on("quill") ? "#dc2626" : "#f5f5f4"}
        stroke="#a8a29e"
        strokeWidth="0.2"
      />
      <path d="M22.5,85 Q26.5,80 31,76" stroke="#78716c" strokeWidth="0.25" fill="none" />
      {/* parchment + sigil (58,88) */}
      <g transform="rotate(-4 58 88)">
        <rect x="50" y="84" width="16" height="8" rx="0.6" fill="#fef3c7" />
        <circle cx="50" cy="88" r="1" fill="#fde68a" />
        <circle cx="66" cy="88" r="1" fill="#fde68a" />
        {on("rune") ? (
          <polygon points="58,85.2 61,90.6 55,90.6" fill="none" stroke="#9333ea" strokeWidth="0.5" />
        ) : (
          <circle cx="58" cy="88" r="2.6" fill="none" stroke="#7c2d12" strokeWidth="0.5" />
        )}
        <path d="M58,85.4 v5.2 M55.8,88 h4.4" stroke={on("rune") ? "#9333ea" : "#7c2d12"} strokeWidth="0.35" />
        <path d="M51.5,86 h2 M51.5,90 h2 M62.5,86 h2 M62.5,90 h2" stroke="#a16207" strokeWidth="0.3" />
      </g>
      {/* scattered coins */}
      {[
        [80, 76],
        [83, 78],
        [79, 80],
      ].map(([x, y]) => (
        <ellipse key={x} cx={x} cy={y} rx="1.4" ry="0.8" fill="#eab308" stroke="#a16207" strokeWidth="0.2" />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. 심해 연구 돔
// ---------------------------------------------------------------------------
function DeepSea({ on, p }: ArtProps) {
  const jellyTentacles = on("jelly") ? [66.5, 68.2, 70, 71.8, 73.5] : [67.5, 70, 72.5];
  return (
    <>
      <defs>
        <linearGradient id={`${p}sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0e7490" />
          <stop offset="60%" stopColor="#0c4a6e" />
          <stop offset="100%" stopColor="#082f49" />
        </linearGradient>
        <radialGradient id={`${p}beam`} cx="0%" cy="50%" r="100%">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${p}dome`}>
          <ellipse cx="50" cy="40" rx="47" ry="38" />
        </clipPath>
      </defs>
      <rect width="100" height="100" fill="#0b1324" />
      <g clipPath={`url(#${p}dome)`}>
        <rect width="100" height="80" fill={`url(#${p}sea)`} />
        {/* light rays */}
        {[20, 45, 70].map((x) => (
          <polygon key={x} points={`${x},0 ${x + 6},0 ${x + 14},80 ${x + 2},80`} fill="#e0f2fe" opacity="0.06" />
        ))}
        {/* bubbles */}
        {range(10).map((i) => (
          <circle key={i} cx={8 + ((i * 29) % 86)} cy={10 + ((i * 17) % 55)} r={0.4 + (i % 3) * 0.25} fill="none" stroke="#e0f2fe" strokeWidth="0.2" opacity="0.6" />
        ))}
        {/* whale (tail at 28,26) */}
        <path d="M32,26 Q38,18.5 49,20.5 Q56,22.5 53,27 Q46,31.5 36,29.5 Q33,28.5 32,26 Z" fill="#1e3a5f" />
        <path d="M36,28.6 Q45,31 52,27" stroke="#94a3b8" strokeWidth="0.4" fill="none" />
        <circle cx="49" cy="23.8" r="0.5" fill="#e2e8f0" />
        <g transform={on("whaleTail") ? "rotate(32 32 26)" : "rotate(-18 32 26)"}>
          <path d="M32.5,26 L26.5,22.5 Q25,24 27.5,26 Q25,28 26.5,29.5 Z" fill="#1e3a5f" />
        </g>
        {/* jellyfish (70,20) */}
        <path d="M65.5,18.5 Q70,11 74.5,18.5 Z" fill="#f0abfc" opacity="0.8" />
        {jellyTentacles.map((x) => (
          <path key={x} d={`M${x},18.5 q-0.8,2 0,4 q0.8,2 0,4`} stroke="#f0abfc" strokeWidth="0.35" fill="none" opacity="0.8" />
        ))}
        {/* decorative small jelly */}
        <path d="M10,40 Q12.5,36 15,40 Z" fill="#a5f3fc" opacity="0.6" />
        <path d="M11,40 v3 M12.5,40 v3.5 M14,40 v3" stroke="#a5f3fc" strokeWidth="0.25" opacity="0.6" />
        {/* submarine (50,44) */}
        <g transform={on("subBeam") ? "rotate(-32 52.5 44)" : "rotate(14 52.5 44)"}>
          <polygon points="52.5,44 61,40 61,48" fill={`url(#${p}beam)`} />
        </g>
        <ellipse cx="46" cy="44" rx="6.5" ry="3.2" fill="#facc15" />
        <rect x="44" y="39.6" width="3.5" height="2" rx="0.6" fill="#eab308" />
        <circle cx="45.5" cy="44" r="1.3" fill="#0e7490" stroke="#fef9c3" strokeWidth="0.3" />
        <circle cx="52.3" cy="44" r="0.7" fill="#fef9c3" />
        <path d="M39.5,44 L38,42 L38,46 Z" fill="#ca8a04" />
        {/* fish school (82,44) */}
        {[
          [79, 42],
          [83, 41],
          [81, 45.5],
          [85, 46],
        ].map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y} rx="1.4" ry="0.7" fill={i === 2 && on("fish") ? "#f472b6" : "#fbbf24"} />
            <path d={`M${x + 1.2},${y} l1,-0.8 l0,1.6 Z`} fill={i === 2 && on("fish") ? "#f472b6" : "#fbbf24"} />
          </g>
        ))}
        {/* sea floor + coral */}
        <path d="M0,70 Q25,63 50,68 Q75,72 100,66 L100,80 L0,80 Z" fill="#164e63" />
        <path d="M14,70 L14,62 M14,64 L11,60 M14,63 L17,59 M22,70 L22,61 M22,64 L25,60" stroke="#fb7185" strokeWidth="1" strokeLinecap="round" />
        <path d="M76,69 q2,-8 4,0 M80,69 q2,-6 4,0" stroke="#34d399" strokeWidth="0.8" fill="none" />
        {!on("starfish") && (
          <polygon
            points="18,55.5 18.6,57.3 20.4,57.3 19,58.4 19.5,60.2 18,59.1 16.5,60.2 17,58.4 15.6,57.3 17.4,57.3"
            fill="#fb923c"
          />
        )}
      </g>
      {/* dome frame */}
      <ellipse cx="50" cy="40" rx="47" ry="38" fill="none" stroke="#94a3b8" strokeWidth="1.6" />
      <ellipse cx="50" cy="40" rx="47" ry="38" fill="none" stroke="#e2e8f0" strokeWidth="0.3" opacity="0.6" />
      {range(12).map((i) => {
        const a = (i * Math.PI) / 6;
        return <circle key={i} cx={50 + Math.cos(a) * 47} cy={40 + Math.sin(a) * 38} r="0.6" fill="#cbd5e1" />;
      })}
      {/* console */}
      <path d="M0,76 L100,76 L100,100 L0,100 Z" fill="#1e293b" />
      <rect x="0" y="76" width="100" height="1.4" fill="#334155" />
      {/* screen */}
      <rect x="8" y="80" width="18" height="10" rx="1" fill="#022c22" stroke="#475569" strokeWidth="0.4" />
      <path d="M9,85 q2,-3 4,0 t4,0 t4,0 t4,0" stroke="#4ade80" strokeWidth="0.4" fill="none" />
      {/* warning lamp (36,82) */}
      <circle cx="36" cy="82" r="3.2" fill={on("warnLight") ? "#ef4444" : "#22c55e"} opacity="0.25" />
      <circle cx="36" cy="82" r="1.8" fill={on("warnLight") ? "#ef4444" : "#22c55e"} stroke="#0f172a" strokeWidth="0.3" />
      {/* buttons */}
      {range(4).map((i) => (
        <rect key={i} x={32 + i * 3} y="90" width="2" height="1.4" rx="0.3" fill={["#f59e0b", "#38bdf8", "#a3e635", "#f472b6"][i]} />
      ))}
      {/* gauge (58,82) */}
      <circle cx="58" cy="82" r="4.6" fill="#f8fafc" stroke="#64748b" strokeWidth="0.5" />
      {range(7).map((i) => {
        const a = ((-120 + i * 40) * Math.PI) / 180;
        return (
          <line key={i} x1={58 + Math.sin(a) * 3.4} y1={82 - Math.cos(a) * 3.4} x2={58 + Math.sin(a) * 4.2} y2={82 - Math.cos(a) * 4.2} stroke="#334155" strokeWidth="0.3" />
        );
      })}
      <line x1="58" y1="82" x2="58" y2="78.6" stroke="#dc2626" strokeWidth="0.5" strokeLinecap="round" transform={on("gauge") ? "rotate(60 58 82)" : "rotate(-45 58 82)"} />
      <circle cx="58" cy="82" r="0.6" fill="#334155" />
      {/* levers */}
      <rect x="68" y="81" width="1" height="7" fill="#64748b" />
      <circle cx="68.5" cy="80.6" r="1" fill="#ef4444" />
      <rect x="72" y="83" width="1" height="5" fill="#64748b" />
      <circle cx="72.5" cy="82.6" r="1" fill="#3b82f6" />
      {/* mug (84,84) */}
      {!on("mug") && (
        <g>
          <rect x="82" y="82" width="4" height="4.6" rx="0.5" fill="#f8fafc" />
          <path d="M86,83 Q88,84.2 86,85.6" stroke="#f8fafc" strokeWidth="0.6" fill="none" />
          <path d="M83.2,81 q0.8,-1.2 0,-2.2 M84.8,81 q0.8,-1.2 0,-2.2" stroke="#94a3b8" strokeWidth="0.3" fill="none" />
        </g>
      )}
    </>
  );
}
