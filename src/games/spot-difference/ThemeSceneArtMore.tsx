"use client";

/**
 * Artwork for the six themes added 2026-09-30 (bazaar, orbital lounge,
 * bakery, arcade, camping, haunted hall) — same contract as the scenes in
 * ThemeSceneArt.tsx, which dispatches here: 0..100 stretched viewBox, `on(id)`
 * true only for this side's active mutations, every mutation's change kept
 * inside its hit radius (themeScenes.ts), deterministic geometry only.
 */

export type ArtProps = { on: (id: string) => boolean; p: string };

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// ---------------------------------------------------------------------------
// 5. 실크로드 황혼의 바자르
// ---------------------------------------------------------------------------
export function Bazaar({ on, p }: ArtProps) {
  return (
    <>
      <defs>
        <linearGradient id={`${p}dusk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#312e81" />
          <stop offset="45%" stopColor="#9a3412" />
          <stop offset="75%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${p}dusk)`} />
      {/* crescent + star (26,16) */}
      <circle cx="22" cy="15" r="3.6" fill="#fef3c7" />
      <circle cx="23.6" cy="14" r="3.1" fill="#3b2a6e" />
      {!on("moonStar") && <polygon points="29,11 29.7,13 31.8,13 30.1,14.2 30.8,16.2 29,15 27.2,16.2 27.9,14.2 26.2,13 28.3,13" fill="#fde68a" />}
      {/* distant domes and minaret */}
      <path d="M30,62 L30,48 Q38,36 46,48 L46,62 Z" fill="#431407" opacity="0.8" />
      <rect x="52" y="34" width="4" height="28" fill="#431407" opacity="0.8" />
      <path d="M51,34 L54,27 L57,34 Z" fill="#431407" opacity="0.8" />
      <path d="M58,62 L58,52 Q64,44 70,52 L70,62 Z" fill="#431407" opacity="0.7" />
      {/* canopy drapes */}
      <path d="M0,0 L42,0 L42,5 Q31,9 21,5 Q10,9 0,5 Z" fill="#b91c1c" />
      <path d="M58,0 L100,0 L100,5 Q89,9 79,5 Q68,9 58,5 Z" fill="#b91c1c" />
      {range(5).map((i) => (
        <rect key={i} x={i * 9 + 2} y="0" width="3" height="5" fill="#fde68a" opacity="0.6" />
      ))}
      {/* pennant pole (50,10) */}
      <rect x="49.5" y="2" width="1" height="14" fill="#78350f" />
      <polygon points="50.5,4 57,7.5 50.5,11" fill={on("pennant") ? "#0d9488" : "#dc2626"} />
      {/* hanging carpet (84,28) */}
      <line x1="75" y1="15" x2="93" y2="15" stroke="#78350f" strokeWidth="0.8" />
      <rect x="76" y="16" width="16" height="25" fill="#7f1d1d" stroke="#fbbf24" strokeWidth="0.8" />
      <rect x="78" y="18" width="12" height="21" fill="none" stroke="#fde68a" strokeWidth="0.3" />
      <polygon points="84,21.5 89,28 84,34.5 79,28" fill={on("carpet") ? "#047857" : "#1d4ed8"} stroke="#fde68a" strokeWidth="0.4" />
      <circle cx="84" cy="28" r="1" fill="#fde68a" />
      {range(5).map((i) => (
        <line key={i} x1={77.5 + i * 3.25} y1="41" x2={77.5 + i * 3.25} y2="43" stroke="#fbbf24" strokeWidth="0.4" />
      ))}
      {/* camel (bell at 16,46) */}
      <ellipse cx="9" cy="60" rx="10" ry="5.5" fill="#a16207" />
      <ellipse cx="7" cy="54.5" rx="4.5" ry="3.5" fill="#a16207" />
      <path d="M16,58 Q20,50 20,42 L24,40 Q26,41 25,43 L22,44 Q22,52 19,60 Z" fill="#a16207" />
      <circle cx="23.5" cy="41.2" r="0.4" fill="#1c1917" />
      <path d="M2,55 L16,55 L15,58 L3,58 Z" fill="#9f1239" />
      <path d="M18,46 Q17.5,47.5 17,48.5" stroke="#fbbf24" strokeWidth="0.3" fill="none" />
      {!on("camelBell") && <circle cx="17" cy="49.5" r="1.2" fill="#fbbf24" stroke="#92400e" strokeWidth="0.3" />}
      {/* brass lamp (66,48) */}
      <line x1="66" y1="5" x2="66" y2="47" stroke="#78350f" strokeWidth="0.3" />
      <path d="M62.5,50 Q66,46 69.5,50 Q66,54.5 62.5,50 Z" fill="#ca8a04" stroke="#92400e" strokeWidth="0.3" />
      <circle cx="66" cy="50.3" r="0.8" fill="#fde68a" />
      {!on("lampSmoke") && <path d="M66,47 Q64,45 66,43.5 Q68,42 66,40.5" stroke="#e5e7eb" strokeWidth="0.6" fill="none" opacity="0.7" strokeLinecap="round" />}
      {/* stall table */}
      <rect x="0" y="74" width="100" height="26" fill="#7c2d12" />
      <rect x="0" y="74" width="100" height="2" fill="#b45309" />
      {range(10).map((i) => (
        <polygon key={i} points={`${i * 10 + 2},76 ${i * 10 + 5},79 ${i * 10 + 8},76`} fill="#fbbf24" opacity="0.5" />
      ))}
      {/* spice mounds (30,66) */}
      <path d="M17,74 Q23,63 29,74 Z" fill="#b91c1c" />
      <path d="M24,74 Q30,61 36,74 Z" fill={on("spice") ? "#65a30d" : "#f59e0b"} />
      <path d="M31,74 Q37,64 43,74 Z" fill="#78350f" />
      {/* scales (56,70) */}
      <rect x="55.5" y="64" width="1" height="10" fill="#a16207" />
      <rect x="53" y="73" width="6" height="1.2" fill="#a16207" />
      <g transform={on("scales") ? "rotate(12 56 64)" : "rotate(-6 56 64)"}>
        <line x1="50" y1="64" x2="62" y2="64" stroke="#ca8a04" strokeWidth="0.7" />
        <path d="M50,64 L48.5,68 L51.5,68 Z M62,64 L60.5,68 L63.5,68 Z" fill="none" stroke="#ca8a04" strokeWidth="0.3" />
        <path d="M48,68 Q50,70 52,68 Z M60,68 Q62,70 64,68 Z" fill="#ca8a04" />
      </g>
      {/* pomegranate basket (38,87) */}
      {[34, 42, ...(on("pomegranate") ? [] : [38])].map((x) => (
        <g key={x}>
          <circle cx={x} cy={x === 38 ? 85 : 86.5} r="2.2" fill="#be123c" />
          <path d={`M${x - 0.6},${(x === 38 ? 85 : 86.5) - 2.2} l0.6,-0.8 l0.6,0.8`} fill="#881337" />
        </g>
      ))}
      <path d="M30,88 L46,88 L44,93 L32,93 Z" fill="#92400e" />
      <path d="M31,90 h14" stroke="#78350f" strokeWidth="0.4" />
      {/* copper pot (80,82) */}
      <ellipse cx="80" cy="83" rx="5" ry="4.5" fill="#c2410c" />
      <path d="M85,81 Q89,79 90,76" stroke="#c2410c" strokeWidth="1.1" fill="none" />
      <rect x="77" y="77" width="6" height="1.6" rx="0.6" fill="#9a3412" />
      <circle cx="80" cy="76.5" r="0.8" fill="#9a3412" />
      {on("copperPot") ? (
        <polygon points="80,80.3 80.8,82.3 82.8,82.4 81.2,83.6 81.8,85.6 80,84.4 78.2,85.6 78.8,83.6 77.2,82.4 79.2,82.3" fill="none" stroke="#fed7aa" strokeWidth="0.4" />
      ) : (
        <circle cx="80" cy="83" r="2.2" fill="none" stroke="#fed7aa" strokeWidth="0.4" />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. 궤도 정거장 라운지
// ---------------------------------------------------------------------------
export function Orbital({ on, p }: ArtProps) {
  return (
    <>
      <defs>
        <clipPath id={`${p}win`}>
          <rect x="20" y="4" width="76" height="54" rx="5" />
        </clipPath>
        <radialGradient id={`${p}earth`} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="60%" stopColor="#0369a1" />
          <stop offset="100%" stopColor="#0c4a6e" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="#0f172a" />
      {/* window */}
      <g clipPath={`url(#${p}win)`}>
        <rect x="20" y="4" width="76" height="54" fill="#020617" />
        {range(22).map((i) => (
          <circle key={i} cx={22 + ((i * 37) % 72)} cy={6 + ((i * 23) % 30)} r={0.25 + (i % 3) * 0.15} fill="#fff" opacity="0.8" />
        ))}
        <circle cx="46" cy="112" r="76" fill={`url(#${p}earth)`} />
        <path d="M-10,110 Q20,50 60,40" stroke="#bae6fd" strokeWidth="0.8" fill="none" opacity="0.5" />
        <path d="M40,60 Q50,52 62,56 Q55,62 44,64 Z M24,70 Q30,62 36,66 Z" fill="#15803d" opacity="0.7" />
        {/* aurora (40,34) */}
        <path d="M32.5,38 Q40,29 47.5,38" stroke={on("aurora") ? "#c084fc" : "#4ade80"} strokeWidth="2.4" fill="none" opacity="0.65" strokeLinecap="round" />
        {/* bright star (58,13) */}
        {!on("star") && <path d="M58,10.5 L58.6,12.4 L60.5,13 L58.6,13.6 L58,15.5 L57.4,13.6 L55.5,13 L57.4,12.4 Z" fill="#fef9c3" />}
        {/* satellite (80,18) */}
        <rect x="77.5" y="18" width="5" height="3.4" fill="#cbd5e1" />
        <rect x="72" y="18.6" width="5" height="2.2" fill="#1d4ed8" />
        <rect x="83" y="18.6" width="5" height="2.2" fill="#1d4ed8" />
        <line x1="80" y1="18" x2={on("antenna") ? 85.5 : 83} y2={on("antenna") ? 16.5 : 12.8} stroke="#e2e8f0" strokeWidth="0.5" />
        <circle cx={on("antenna") ? 85.5 : 83} cy={on("antenna") ? 16.5 : 12.8} r="0.6" fill="#ef4444" />
        {/* station solar wing (88,48) */}
        <rect x="80" y="50.5" width="16" height="0.8" fill="#64748b" />
        <rect x="82" y="44.5" width="12" height="6" fill="#1e3a8a" stroke="#94a3b8" strokeWidth="0.3" />
        {[85, 88, 91].map((x) => (
          <line key={x} x1={x} y1="44.5" x2={x} y2="50.5" stroke="#94a3b8" strokeWidth="0.2" />
        ))}
        <line x1="82" y1="47.5" x2="94" y2="47.5" stroke="#94a3b8" strokeWidth="0.2" />
        {on("solarPanel") && <polygon points="83,50.5 86,44.5 88,44.5 85,50.5" fill="#e0f2fe" opacity="0.7" />}
      </g>
      <rect x="20" y="4" width="76" height="54" rx="5" fill="none" stroke="#475569" strokeWidth="1.6" />
      <line x1="58" y1="4" x2="58" y2="58" stroke="#475569" strokeWidth="1" />
      {/* left wall + docking light (12,44) */}
      <rect x="0" y="0" width="20" height="80" fill="#1e293b" />
      <rect x="6" y="36" width="12" height="16" rx="1.5" fill="#0f172a" stroke="#475569" strokeWidth="0.4" />
      <circle cx="12" cy="41" r="2" fill={on("dockLight") ? "#ef4444" : "#22c55e"} />
      <circle cx="12" cy="41" r="3.2" fill={on("dockLight") ? "#ef4444" : "#22c55e"} opacity="0.2" />
      <rect x="8.5" y="46" width="7" height="1" fill="#64748b" />
      <rect x="8.5" y="48.5" width="5" height="1" fill="#64748b" />
      {/* floor */}
      <rect x="0" y="80" width="100" height="20" fill="#111827" />
      <rect x="0" y="80" width="100" height="0.8" fill="#334155" />
      {/* coffee (28,66) */}
      <circle cx="28" cy={on("coffee") ? 61 : 66} r="2.6" fill="#78350f" stroke="#ca8a04" strokeWidth="0.4" />
      <circle cx="27" cy={on("coffee") ? 60 : 65} r="0.7" fill="#fde68a" opacity="0.7" />
      <path d="M25,76 L31,76 L30.4,80 L25.6,80 Z" fill="#e2e8f0" />
      {/* table + helmet (52,76) */}
      <rect x="40" y="80.5" width="26" height="1.5" fill="#64748b" />
      <rect x="51" y="82" width="2" height="8" fill="#475569" />
      <circle cx="52" cy="76" r="4.6" fill="#f8fafc" />
      <ellipse cx="53" cy="76" rx="3" ry="2.2" fill="#0f172a" />
      <rect x="47.6" y="72.8" width="8.8" height="1.2" fill={on("helmet") ? "#22d3ee" : "#f59e0b"} />
      {/* robot arm (72,68) */}
      <path d="M100,58 L86,62 L76,66" stroke="#94a3b8" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="86" cy="62" r="1.5" fill="#64748b" />
      <circle cx="76" cy="66" r="1.2" fill="#64748b" />
      {on("robotArm") ? (
        <path d="M75.5,66 L72,67.5 M75.5,66.5 L72,68" stroke="#f59e0b" strokeWidth="0.8" strokeLinecap="round" />
      ) : (
        <path d="M75.5,66 L71.5,64.5 M75.5,66.5 L71.5,69.5" stroke="#f59e0b" strokeWidth="0.8" strokeLinecap="round" />
      )}
      {/* holo plant (30,86) */}
      <path d="M27,88 L33,88 L32,93 L28,93 Z" fill="#334155" />
      {[
        [28, 85],
        [32, 84],
        [30, 81.5],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={on("holoPlant") ? "#f472b6" : "#22d3ee"} opacity="0.55" />
      ))}
      <line x1="30" y1="88" x2="30" y2="82" stroke="#67e8f9" strokeWidth="0.3" opacity="0.7" />
    </>
  );
}

// ---------------------------------------------------------------------------
// 7. 새벽의 골목 베이커리
// ---------------------------------------------------------------------------
export function Bakery({ on, p }: ArtProps) {
  const hour = on("clock") ? { h: [74, 24.6], m: [78.2, 24.2] } : { h: [74.4, 29.2], m: [76, 23] };
  return (
    <>
      <defs>
        <linearGradient id={`${p}dawn`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#fed7aa" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${p}dawn)`} />
      {/* facade */}
      <rect x="0" y="16" width="100" height="56" fill="#f5e6d3" />
      {range(9).map((r) => (
        <line key={r} x1="0" y1={20 + r * 6} x2="100" y2={20 + r * 6} stroke="#e7d3b8" strokeWidth="0.3" />
      ))}
      {/* awning (stripe at 50,11) */}
      {range(11).map((i) => {
        const x = -5 + i * 10;
        const red = i % 2 === 1; // odd stripes red, so the centre stripe (i=5, x 45–55) is a red one
        const isTarget = i === 5;
        return <rect key={i} x={x} y="4" width="10" height="12" fill={red ? (isTarget && on("awning") ? "#2563eb" : "#dc2626") : "#fff7ed"} />;
      })}
      {range(10).map((i) => (
        <path key={i} d={`M${i * 10},16 q5,4 10,0`} fill="#dc2626" />
      ))}
      {/* hanging sign (26,27) */}
      <line x1="18" y1="20" x2="30" y2="20" stroke="#78350f" strokeWidth="0.6" />
      <line x1="22" y1="20" x2="22" y2="22.5" stroke="#78350f" strokeWidth="0.3" />
      <line x1="30" y1="20" x2="30" y2="22.5" stroke="#78350f" strokeWidth="0.3" />
      <circle cx="26" cy="27" r="4.8" fill="#92400e" stroke="#fbbf24" strokeWidth="0.4" />
      {on("sign") ? (
        <path d="M22.8,28.5 Q26,22 29.2,28.5 Q26,26 22.8,28.5 Z" fill="#fbbf24" />
      ) : (
        <path d="M24,29 Q22,25 26,26 Q30,25 28,29 M24.5,27.5 Q26,30 27.5,27.5" stroke="#fbbf24" strokeWidth="0.8" fill="none" />
      )}
      {/* clock (76,27) */}
      <circle cx="76" cy="27" r="4.6" fill="#ffffff" stroke="#78350f" strokeWidth="0.8" />
      {range(4).map((i) => (
        <circle key={i} cx={76 + Math.sin((i * Math.PI) / 2) * 3.6} cy={27 - Math.cos((i * Math.PI) / 2) * 3.6} r="0.35" fill="#78350f" />
      ))}
      <line x1="76" y1="27" x2={hour.h[0]} y2={hour.h[1]} stroke="#1c1917" strokeWidth="0.6" strokeLinecap="round" />
      <line x1="76" y1="27" x2={hour.m[0]} y2={hour.m[1]} stroke="#1c1917" strokeWidth="0.4" strokeLinecap="round" />
      {/* shop window with baker (hat at 58,45) */}
      <rect x="36" y="34" width="44" height="34" fill="#fef3c7" stroke="#78350f" strokeWidth="1" />
      <rect x="36" y="58" width="44" height="10" fill="#b45309" />
      <circle cx="58" cy="50" r="3" fill="#fcd34d" />
      <path d="M53,58 Q58,53 63,58 Z" fill="#ffffff" />
      {on("chefHat") ? (
        <rect x="55" y="43.5" width="6" height="4" rx="0.6" fill="#ffffff" stroke="#e5e7eb" strokeWidth="0.3" />
      ) : (
        <g fill="#ffffff" stroke="#e5e7eb" strokeWidth="0.3">
          <rect x="55.5" y="45.5" width="5" height="2.4" />
          <circle cx="56" cy="44.5" r="1.8" />
          <circle cx="58" cy="43.4" r="2" />
          <circle cx="60" cy="44.5" r="1.8" />
        </g>
      )}
      {range(4).map((i) => (
        <ellipse key={i} cx={42 + i * 10} cy="61" rx="3" ry="1.4" fill="#f59e0b" />
      ))}
      <line x1="58" y1="34" x2="58" y2="40" stroke="#78350f" strokeWidth="0.4" opacity="0.5" />
      {/* side window + flower box (88,47) */}
      <rect x="83" y="32" width="11" height="11" fill="#bae6fd" stroke="#78350f" strokeWidth="0.6" />
      <line x1="88.5" y1="32" x2="88.5" y2="43" stroke="#78350f" strokeWidth="0.4" />
      <rect x="82" y="47.5" width="13" height="3" fill="#92400e" />
      {[84.5, 88.5, 92.5].map((x) => (
        <g key={x}>
          <path d={`M${x},47.5 v-1.5`} stroke="#15803d" strokeWidth="0.4" />
          <circle cx={x} cy="45.5" r="1.4" fill={on("flowerBox") ? "#a855f7" : "#ef4444"} />
        </g>
      ))}
      {/* street */}
      <rect x="0" y="72" width="100" height="28" fill="#d6d3d1" />
      {range(12).map((i) => (
        <ellipse key={i} cx={4 + (i % 6) * 17 + (i >= 6 ? 8 : 0)} cy={i >= 6 ? 94 : 80} rx="5" ry="1.6" fill="#a8a29e" opacity="0.5" />
      ))}
      {/* croissant bench (26,60) */}
      <rect x="10" y="63" width="30" height="2" fill="#78350f" />
      <rect x="12" y="65" width="1.5" height="7" fill="#78350f" />
      <rect x="36.5" y="65" width="1.5" height="7" fill="#78350f" />
      <ellipse cx="26" cy="62.4" rx="11" ry="1" fill="#e5e7eb" />
      {[20, 26, ...(on("croissants") ? [] : [32])].map((x) => (
        <path key={x} d={`M${x - 2.6},61.8 Q${x},57 ${x + 2.6},61.8 Q${x},60 ${x - 2.6},61.8 Z`} fill="#d97706" stroke="#92400e" strokeWidth="0.2" />
      ))}
      {/* bread basket (46,75) */}
      <path d="M40,76 L52,76 L50.5,82 L41.5,82 Z" fill="#a16207" />
      <path d="M42,76 L44,68 M45,76 L46.5,69 M48,76 L50,69.5" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M44.5,75.5 L46,74.5 L47.5,75.5 L46,76.5 Z" fill={on("ribbon") ? "#16a34a" : "#dc2626"} />
      <path d="M45,76.5 l-1,2 M47,76.5 l1,2" stroke={on("ribbon") ? "#16a34a" : "#dc2626"} strokeWidth="0.5" />
      {/* flour sack (80,78) */}
      <path d="M74,86 Q73,76 76,72 L84,72 Q87,76 86,86 Z" fill="#f5f5f4" stroke="#d6d3d1" strokeWidth="0.4" />
      <path d="M75.5,72 Q80,70 84.5,72" stroke="#a8a29e" strokeWidth="0.5" fill="none" />
      {on("flourSack") ? (
        <polygon points="80,75.5 80.7,77.3 82.6,77.4 81.1,78.6 81.6,80.5 80,79.4 78.4,80.5 78.9,78.6 77.4,77.4 79.3,77.3" fill="#b91c1c" />
      ) : (
        <g stroke="#a16207" strokeWidth="0.4" fill="#ca8a04">
          <line x1="80" y1="75.5" x2="80" y2="81" />
          <ellipse cx="79.2" cy="77" rx="0.7" ry="0.4" />
          <ellipse cx="80.8" cy="77.8" rx="0.7" ry="0.4" />
          <ellipse cx="79.2" cy="78.6" rx="0.7" ry="0.4" />
        </g>
      )}
      {/* chalkboard (12,84) */}
      <path d="M6,92 L8,77 L16,77 L18,92" fill="none" stroke="#78350f" strokeWidth="0.8" />
      <rect x="7.5" y="78" width="9" height="11" fill="#1f2937" stroke="#78350f" strokeWidth="0.6" />
      <path d="M9,80.5 h6" stroke="#f5f5f4" strokeWidth="0.3" />
      {!on("chalkboard") && <path d="M9,86.5 Q12,83.5 15,85.5 Q12,87.5 9,86.5 Z M10.5,85.7 l0.6,-0.6 M12,85.2 l0.6,-0.6 M13.5,85.2 l0.6,-0.6" stroke="#fde68a" strokeWidth="0.3" fill="none" />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 8. 80년대 레트로 오락실
// ---------------------------------------------------------------------------
const GHOST_PIXELS = [
  "..###..",
  ".#####.",
  "##.#.##",
  "#######",
  "#######",
  "#.#.#.#",
];

export function Arcade({ on, p }: ArtProps) {
  const ghost = on("ghostSign") ? "#4ade80" : "#f472b6";
  return (
    <>
      <defs>
        <linearGradient id={`${p}juke`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="50%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <radialGradient id={`${p}lamp`}>
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="#140a26" />
      {range(10).map((i) => (
        <line key={i} x1={i * 11} y1="0" x2={i * 11} y2="74" stroke="#2e1065" strokeWidth="0.4" />
      ))}
      {/* ceiling lamp (40,11) */}
      <line x1="40" y1="0" x2="40" y2="7" stroke="#475569" strokeWidth="0.4" />
      {!on("ceilingLight") && <circle cx="40" cy="12" r="6" fill={`url(#${p}lamp)`} />}
      <path d="M36.5,10 L43.5,10 L42,7 L38,7 Z" fill="#334155" />
      <ellipse cx="40" cy="10.6" rx="1.6" ry="0.8" fill={on("ceilingLight") ? "#475569" : "#fef3c7"} />
      {/* pixel ghost neon (70,18) */}
      <rect x="63.5" y="12.5" width="13" height="11.5" rx="1" fill={ghost} opacity="0.12" />
      {GHOST_PIXELS.map((row, r) =>
        row.split("").map((c, col) =>
          c === "#" ? <rect key={`${r}-${col}`} x={65.1 + col * 1.4} y={14 + r * 1.4} width="1.3" height="1.3" fill={ghost} /> : null,
        ),
      )}
      {/* soda can (9,60) */}
      <rect x="2" y="64" width="14" height="1" fill="#475569" />
      <rect x="7" y="56.5" width="4" height="7.5" rx="0.8" fill={on("soda") ? "#2563eb" : "#dc2626"} />
      <rect x="7" y="58.8" width="4" height="1.2" fill="#f8fafc" />
      {/* arcade cabinet */}
      <path d="M14,88 L14,26 Q14,22 18,22 L34,22 Q38,22 38,26 L38,88 Z" fill="#1e1b4b" stroke="#7c3aed" strokeWidth="0.6" />
      <rect x="17" y="27" width="18" height="20" rx="1" fill="#020617" stroke="#4c1d95" strokeWidth="0.5" />
      {/* hi-score bars (24,37) */}
      <rect x="19" y="31.5" width={on("hiScore") ? 7 : 12} height="1.5" fill="#facc15" />
      <rect x="19" y="35" width="10" height="1.5" fill="#22d3ee" />
      <rect x="19" y="38.5" width="8" height="1.5" fill="#f472b6" />
      <rect x="19" y="42" width="6" height="1.5" fill="#a3e635" />
      {/* control panel + joystick (26,63) */}
      <path d="M14,56 L38,56 L40,66 L12,66 Z" fill="#312e81" />
      <line x1="24" y1="62" x2="24" y2="58.6" stroke="#cbd5e1" strokeWidth="0.7" />
      <circle cx="24" cy="58.2" r="1.8" fill={on("joystick") ? "#2563eb" : "#dc2626"} />
      <circle cx="30" cy="61" r="1.1" fill="#facc15" />
      <circle cx="33" cy="61" r="1.1" fill="#22d3ee" />
      {/* coin door (28,82) */}
      <rect x="22" y="76" width="10" height="9" rx="0.6" fill="#0f172a" stroke="#475569" strokeWidth="0.4" />
      <rect x="26.5" y="78" width="0.8" height="3" fill="#94a3b8" />
      <circle cx="29.5" cy="79.5" r="0.8" fill={on("coinLed") ? "#334155" : "#ef4444"} />
      {/* jukebox (58,58) */}
      <path d="M50,76 L50,50 Q58,40 66,50 L66,76 Z" fill="#7c2d12" stroke="#fbbf24" strokeWidth="0.6" />
      <path d="M52.5,52 Q58,45 63.5,52" stroke="#fbbf24" strokeWidth="0.5" fill="none" />
      <rect x="51.5" y="56.5" width="13" height="3" rx="1.5" fill={on("jukebox") ? "#22c55e" : `url(#${p}juke)`} />
      <rect x="53" y="62" width="10" height="8" rx="1" fill="#1c1917" />
      {range(3).map((i) => (
        <line key={i} x1="54" y1={64 + i * 2} x2="62" y2={64 + i * 2} stroke="#78716c" strokeWidth="0.3" />
      ))}
      {/* claw machine (86,54) */}
      <rect x="76" y="30" width="20" height="54" rx="1" fill="#831843" stroke="#f472b6" strokeWidth="0.6" />
      <rect x="78" y="34" width="16" height="28" fill="#fdf2f8" fillOpacity="0.12" stroke="#fbcfe8" strokeWidth="0.3" />
      <line x1="86" y1="34" x2="86" y2="46" stroke="#e2e8f0" strokeWidth="0.3" />
      <path d="M84,48 L86,46 L88,48 M84.4,48 L84,50 M87.6,48 L88,50" stroke="#e2e8f0" strokeWidth="0.5" fill="none" />
      {!on("claw") && (
        <g>
          <circle cx="84.6" cy="52.2" r="0.9" fill="#a16207" />
          <circle cx="87.4" cy="52.2" r="0.9" fill="#a16207" />
          <circle cx="86" cy="54" r="2.4" fill="#ca8a04" />
          <ellipse cx="86" cy="57.6" rx="2.6" ry="2" fill="#ca8a04" />
          <circle cx="85.2" cy="53.6" r="0.3" fill="#1c1917" />
          <circle cx="86.8" cy="53.6" r="0.3" fill="#1c1917" />
        </g>
      )}
      {[80, 84, 89, 92].map((x, i) => (
        <circle key={x} cx={x} cy="60.5" r="1.4" fill={["#60a5fa", "#f87171", "#34d399", "#fbbf24"][i]} />
      ))}
      <rect x="82" y="68" width="8" height="5" fill="#0f172a" />
      {/* carpet (56,89) */}
      <rect x="0" y="88" width="100" height="12" fill="#1e1b4b" />
      <rect x="0" y="86" width="100" height="2" fill="#312e81" />
      {range(8).map((i) => {
        const x = 6 + i * 12.5;
        if (Math.abs(x - 56) < 2) return null;
        return i % 2 ? (
          <circle key={i} cx={x} cy="93" r="1.4" fill="none" stroke="#22d3ee" strokeWidth="0.4" />
        ) : (
          <polygon key={i} points={`${x},91.3 ${x + 0.5},92.6 ${x + 1.8},92.7 ${x + 0.8},93.5 ${x + 1.1},94.8 ${x},94 ${x - 1.1},94.8 ${x - 0.8},93.5 ${x - 1.8},92.7 ${x - 0.5},92.6`} fill="#facc15" />
        );
      })}
      {on("carpet") ? (
        <polygon points="56,87.3 56.5,88.6 57.8,88.7 56.8,89.5 57.1,90.8 56,90 54.9,90.8 55.2,89.5 54.2,88.7 55.5,88.6" fill="#facc15" />
      ) : (
        <circle cx="56" cy="89" r="1.4" fill="none" stroke="#22d3ee" strokeWidth="0.4" />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 9. 은하수 캠핑장과 모닥불
// ---------------------------------------------------------------------------
export function Camping({ on, p }: ArtProps) {
  const dipper: [number, number][] = [
    [58, 14],
    [62, 15.5],
    [65.5, 17.5],
    [68.5, 20.5],
    [69.5, 25],
    [74.5, 25.5],
    [75.5, 20.5],
  ];
  return (
    <>
      <defs>
        <linearGradient id={`${p}night`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#020617" />
          <stop offset="60%" stopColor="#1e1b4b" />
          <stop offset="100%" stopColor="#14532d" />
        </linearGradient>
        <radialGradient id={`${p}fire`}>
          <stop offset="0%" stopColor="#fb923c" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${p}tail`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde047" stopOpacity="0" />
          <stop offset="100%" stopColor="#fef9c3" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${p}night)`} />
      {/* milky way */}
      <ellipse cx="50" cy="30" rx="60" ry="7" fill="#c7d2fe" opacity="0.08" transform="rotate(-18 50 30)" />
      {range(40).map((i) => (
        <circle key={i} cx={(i * 41) % 100} cy={2 + ((i * 17) % 44)} r={0.2 + (i % 4) * 0.12} fill="#fff" opacity={0.4 + (i % 3) * 0.2} />
      ))}
      {/* crescent moon (11,13) — shadow side flips */}
      <circle cx="11" cy="13" r="3.8" fill="#fef9c3" />
      <circle cx={on("moon") ? 9.4 : 12.6} cy="12.2" r="3.3" fill="#0b1026" />
      {/* shooting star (34,14) */}
      {on("shootingStar") && <line x1="28.5" y1="10.5" x2="38.5" y2="16.5" stroke={`url(#${p}tail)`} strokeWidth="0.9" strokeLinecap="round" />}
      {/* big dipper (66,19) */}
      {dipper.slice(0, -1).map(([x, y], i) => {
        if (i === 2 && on("dipper")) return null;
        const [nx, ny] = dipper[i + 1];
        return <line key={i} x1={x} y1={y} x2={nx} y2={ny} stroke="#93c5fd" strokeWidth="0.25" opacity="0.8" />;
      })}
      <line x1="75.5" y1="20.5" x2="68.5" y2="20.5" stroke="#93c5fd" strokeWidth="0.25" opacity="0.8" />
      {dipper.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.6" fill="#fff" />
      ))}
      {/* hills + pines */}
      <path d="M0,66 Q30,56 60,64 Q80,58 100,62 L100,100 L0,100 Z" fill="#052e16" />
      <polygon points="88,22 96,40 92,40 99,56 77,56 84,40 80,40" fill="#14532d" />
      <rect x="87" y="56" width="2" height="6" fill="#422006" />
      <polygon points="6,40 12,56 0,56" fill="#14532d" opacity="0.8" />
      {/* owl (88,38) */}
      {!on("owl") && (
        <g>
          <ellipse cx="88" cy="38.5" rx="1.8" ry="2.3" fill="#78350f" />
          <circle cx="87.3" cy="37.6" r="0.55" fill="#facc15" />
          <circle cx="88.7" cy="37.6" r="0.55" fill="#facc15" />
          <path d="M86.6,36.4 l0.3,-0.8 l0.4,0.6 M89.4,36.4 l-0.3,-0.8 l-0.4,0.6" stroke="#78350f" strokeWidth="0.3" />
        </g>
      )}
      {/* tent + lantern (22,56) */}
      <polygon points="6,80 22,46 38,80" fill="#ea580c" stroke="#9a3412" strokeWidth="0.6" />
      <polygon points="18,80 22,62 26,80" fill="#431407" />
      <line x1="22" y1="46" x2="22" y2="52" stroke="#9a3412" strokeWidth="0.4" />
      <circle cx="22" cy="56" r="3.4" fill={on("lantern") ? "#38bdf8" : "#fde68a"} opacity="0.25" />
      <rect x="20.8" y="54.4" width="2.4" height="3.2" rx="0.5" fill={on("lantern") ? "#38bdf8" : "#fde68a"} stroke="#78350f" strokeWidth="0.25" />
      {/* campfire (sparks at 50,61) */}
      <circle cx="50" cy="70" r="11" fill={`url(#${p}fire)`} />
      <path d="M44,76 L56,72 M44,72 L56,76" stroke="#78350f" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M46,74 Q47,68 50,64 Q53,68 54,74 Z" fill="#ef4444" />
      <path d="M47.5,74 Q48.5,70 50,67 Q51.5,70 52.5,74 Z" fill="#facc15" />
      {on("sparks") && (
        <g fill="#fde68a">
          <circle cx="48" cy="60" r="0.5" />
          <circle cx="52" cy="58.5" r="0.45" />
          <circle cx="50.5" cy="61.5" r="0.4" />
          <circle cx="46.8" cy="57.8" r="0.35" />
        </g>
      )}
      {/* marshmallow stick (67,72) */}
      <line x1="80" y1="80" x2="62" y2="68" stroke="#a16207" strokeWidth="0.6" />
      {!on("marshmallow") && <rect x="63.4" y="67.8" width="2.6" height="2.2" rx="0.7" fill="#fef3c7" transform="rotate(34 64.7 68.9)" />}
      <rect x="67" y="70.2" width="2.6" height="2.2" rx="0.7" fill="#fef3c7" transform="rotate(34 68.3 71.3)" />
      {/* guitar (strap at 86,78) */}
      <line x1="82" y1="64" x2="86" y2="78" stroke="#a16207" strokeWidth="1" />
      <ellipse cx="87.5" cy="82" rx="4" ry="3.4" fill="#c2410c" transform="rotate(-15 87.5 82)" />
      <ellipse cx="85.8" cy="77.8" rx="2.8" ry="2.4" fill="#c2410c" transform="rotate(-15 85.8 77.8)" />
      <circle cx="86.8" cy="80" r="0.9" fill="#1c1917" />
      <path d="M83,70 Q80,78 90.5,85" stroke={on("guitarStrap") ? "#14b8a6" : "#e11d48"} strokeWidth="0.9" fill="none" />
      {/* thermos (38,86) */}
      <rect x="34" y="80" width="3.6" height="10" rx="0.8" fill="#64748b" />
      <rect x="34" y="80" width="3.6" height="1.5" fill="#94a3b8" />
      <path d="M39.5,86.5 L43.5,86.5 L43,90 L40,90 Z" fill={on("thermos") ? "#2563eb" : "#dc2626"} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 10. 할로윈 유령의 대저택 (hall interior)
// ---------------------------------------------------------------------------
export function Haunted({ on, p }: ArtProps) {
  const pupilDx = on("portrait") ? 0.6 : -0.6;
  return (
    <>
      <defs>
        <radialGradient id={`${p}moon`}>
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${p}candle`}>
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* wallpaper */}
      <rect width="100" height="100" fill="#1f1235" />
      {range(14).map((i) => (
        <rect key={i} x={i * 7.5} y="0" width="2.5" height="70" fill="#2a1747" />
      ))}
      {/* arched window with moon + bats (24,17) */}
      <path d="M10,32 L10,12 Q24,-2 38,12 L38,32 Z" fill="#1e1b4b" stroke="#3f3f46" strokeWidth="1" />
      <circle cx="24" cy="17" r="10" fill={`url(#${p}moon)`} />
      <circle cx="24" cy="17" r="5.5" fill="#fef3c7" />
      {[
        [20.5, 15.5],
        [27.5, 19.5],
        ...(on("bats") ? [[24, 12.5]] : []),
      ].map(([x, y]) => (
        <path key={`${x}-${y}`} d={`M${x - 2.2},${y} Q${x - 1.1},${y - 1.3} ${x},${y} Q${x + 1.1},${y - 1.3} ${x + 2.2},${y} Q${x + 1},${y + 0.2} ${x},${y + 0.9} Q${x - 1},${y + 0.2} ${x - 2.2},${y} Z`} fill="#0c0a09" />
      ))}
      <line x1="24" y1="4" x2="24" y2="32" stroke="#3f3f46" strokeWidth="0.6" />
      <line x1="10" y1="20" x2="38" y2="20" stroke="#3f3f46" strokeWidth="0.6" />
      {/* attic round window (60,15) */}
      <circle cx="60" cy="15" r="4.2" fill="#fde68a" stroke="#3f3f46" strokeWidth="0.8" />
      {on("atticHand") && <path d="M58.6,17.8 L58.6,15 L58.8,12.8 M59.6,15 L59.8,12.2 M60.6,15 L60.8,12.4 M61.4,15.4 L61.8,13.4 M58.6,16 L57.4,14.8" stroke="#1c1917" strokeWidth="0.55" strokeLinecap="round" fill="none" />}
      {/* chandelier + spider (46,36) */}
      <line x1="46" y1="0" x2="46" y2="24" stroke="#57534e" strokeWidth="0.4" />
      <path d="M38,26 Q46,31 54,26" stroke="#a16207" strokeWidth="0.8" fill="none" />
      {[38, 42, 50, 54].map((x) => (
        <g key={x}>
          <rect x={x - 0.5} y={x === 42 || x === 50 ? 26 : 24} width="1" height="2.5" fill="#f5f5f4" />
          <ellipse cx={x} cy={(x === 42 || x === 50 ? 26 : 24) - 0.8} rx="0.5" ry="0.9" fill="#fbbf24" />
        </g>
      ))}
      <path d="M40,26 L46,20 L52,26" stroke="#e5e7eb" strokeWidth="0.15" opacity="0.5" fill="none" />
      {on("spider") && (
        <g>
          <line x1="46" y1="28.5" x2="46" y2="35" stroke="#e5e7eb" strokeWidth="0.15" />
          <circle cx="46" cy="36" r="1" fill="#0c0a09" />
          <path d="M44.5,35 l-1,-0.8 M44.5,36.2 l-1.2,0.4 M47.5,35 l1,-0.8 M47.5,36.2 l1.2,0.4" stroke="#0c0a09" strokeWidth="0.3" />
        </g>
      )}
      {/* gargoyle on pedestal (12,42) */}
      <rect x="6" y="47" width="12" height="23" fill="#44403c" />
      <rect x="5" y="46" width="14" height="1.5" fill="#57534e" />
      <path d="M8,46 Q8,39 12,38.5 Q16,39 16,46 Z" fill="#57534e" />
      <path d="M9,40 L8,36.5 L10.5,39 M15,40 L16,36.5 L13.5,39" fill="#57534e" />
      <circle cx="10.7" cy="41.8" r="0.7" fill={on("gargoyle") ? "#ef4444" : "#1c1917"} />
      <circle cx="13.3" cy="41.8" r="0.7" fill={on("gargoyle") ? "#ef4444" : "#1c1917"} />
      {/* portrait (84,38) */}
      <rect x="76" y="27" width="16" height="22" fill="#78350f" stroke="#ca8a04" strokeWidth="1" />
      <rect x="78" y="29" width="12" height="18" fill="#292524" />
      <ellipse cx="84" cy="37" rx="3.6" ry="4.6" fill="#d6d3d1" />
      <path d="M80,47 Q84,41 88,47 Z" fill="#1c1917" />
      <circle cx="82.6" cy="36.4" r="0.8" fill="#fff" />
      <circle cx="85.4" cy="36.4" r="0.8" fill="#fff" />
      <circle cx={82.6 + pupilDx} cy="36.4" r="0.4" fill="#1c1917" />
      <circle cx={85.4 + pupilDx} cy="36.4" r="0.4" fill="#1c1917" />
      {/* floating candle (32,57) */}
      {!on("floatCandle") && (
        <g>
          <circle cx="32" cy="55" r="4" fill={`url(#${p}candle)`} />
          <rect x="31" y="56" width="2" height="4.5" fill="#f5f5f4" />
          <ellipse cx="32" cy="55" rx="0.7" ry="1.3" fill="#fbbf24" />
        </g>
      )}
      {/* floor */}
      <rect x="0" y="70" width="100" height="30" fill="#1c1917" />
      {range(6).map((i) => (
        <line key={i} x1="0" y1={74 + i * 5} x2="100" y2={74 + i * 5} stroke="#292524" strokeWidth="0.4" />
      ))}
      {/* ghost (87,64) */}
      {!on("ghost") && (
        <path d="M83.5,68 L83.5,62 Q87,56 90.5,62 L90.5,68 L89.3,66.8 L88.1,68 L87,66.8 L85.9,68 L84.7,66.8 Z" fill="#e0e7ff" opacity="0.55" />
      )}
      {!on("ghost") && (
        <g fill="#1e1b4b" opacity="0.8">
          <circle cx="85.8" cy="62" r="0.5" />
          <circle cx="88.2" cy="62" r="0.5" />
        </g>
      )}
      {/* pumpkin (68,78) */}
      <ellipse cx="68" cy="79" rx="6" ry="4.6" fill="#ea580c" />
      <path d="M65,75 Q64,79 65,83.4 M71,75 Q72,79 71,83.4" stroke="#c2410c" strokeWidth="0.4" fill="none" />
      <rect x="67.4" y="73.4" width="1.2" height="1.8" fill="#15803d" />
      <polygon points="65,77.5 66.5,76.2 67.2,78" fill="#facc15" />
      <polygon points="71,77.5 69.5,76.2 68.8,78" fill="#facc15" />
      {on("pumpkin") ? (
        <ellipse cx="68" cy="81" rx="1.6" ry="1.2" fill="#facc15" />
      ) : (
        <path d="M64.8,80.2 L66,81.6 L67.2,80.4 L68.4,81.6 L69.6,80.4 L71.2,81.8 L70,82.8 L66,82.8 Z" fill="#facc15" />
      )}
      {/* rug crest (46,87) */}
      <ellipse cx="46" cy="88" rx="16" ry="6" fill="#7f1d1d" stroke="#a16207" strokeWidth="0.5" />
      <ellipse cx="46" cy="88" rx="12" ry="4.2" fill="none" stroke="#a16207" strokeWidth="0.3" />
      {on("gateCrest") ? (
        <g fill="#fde68a">
          <circle cx="46" cy="86.8" r="1.6" />
          <rect x="45" y="87.8" width="2" height="1.4" />
          <circle cx="45.4" cy="86.7" r="0.35" fill="#7f1d1d" />
          <circle cx="46.6" cy="86.7" r="0.35" fill="#7f1d1d" />
        </g>
      ) : (
        <path d="M43,87.5 Q44.5,86.2 46,87.5 Q47.5,86.2 49,87.5 Q47.6,87.8 46,89 Q44.4,87.8 43,87.5 Z" fill="#fde68a" />
      )}
    </>
  );
}
