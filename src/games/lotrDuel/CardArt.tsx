"use client";

import { useId, type ReactNode } from "react";
import type { LotrDuelCard, RaceSymbol, TechSymbol } from "./types";

/**
 * Inline SVG illustrations for 반지의 제왕: 가운데땅에서의 대결 — the dark-luxury
 * art-deco card art. Everything is vector (no image assets, nothing to 404),
 * drawn on a 64×64 box and scaled by the parent.
 *
 * Gradient ids come from `useId()` so dozens of cards on screen never share
 * (and never lose) a definition when one unmounts.
 *
 * All motifs are generic fantasy shapes (leaf, anvil, round door, white tree,
 * tree-spirit, staff, eagle, ring, helm) — no film stills or logos.
 */

type Def = { id: (k: string) => string; url: (k: string) => string };
function useDefs(): Def {
  const base = useId().replace(/:/g, "");
  return { id: (k) => `${base}-${k}`, url: (k) => `url(#${base}-${k})` };
}

const Frame = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 64 64" className={`h-full w-full ${className}`} aria-hidden>
    {children}
  </svg>
);

// ---------------------------------------------------------------------------
// Seal-wax race emblems
// ---------------------------------------------------------------------------

export const RACE_WAX: Record<RaceSymbol, { wax: string; waxDark: string; glow: string; label: string }> = {
  ELF: { wax: "#34d399", waxDark: "#065f46", glow: "rgba(110,231,183,.85)", label: "엘프" },
  DWARF: { wax: "#f59e0b", waxDark: "#78350f", glow: "rgba(251,191,36,.85)", label: "드워프" },
  HOBBIT: { wax: "#84cc16", waxDark: "#365314", glow: "rgba(190,242,100,.8)", label: "호빗" },
  HUMAN: { wax: "#3b82f6", waxDark: "#1e3a8a", glow: "rgba(147,197,253,.85)", label: "인간" },
  ENT: { wax: "#15803d", waxDark: "#052e16", glow: "rgba(74,222,128,.7)", label: "엔트" },
  WIZARD: { wax: "#a855f7", waxDark: "#3b0764", glow: "rgba(216,180,254,.9)", label: "마법사" },
  EAGLE: { wax: "#eab308", waxDark: "#713f12", glow: "rgba(253,224,71,.9)", label: "독수리" },
};

/** Glyph paths drawn in "emboss" style on the wax (dark fill + light offset). */
function raceGlyph(race: RaceSymbol): ReactNode {
  switch (race) {
    case "ELF": // mallorn leaf
      return (
        <>
          <path d="M32 15 C43 23 44 36 32 50 C20 36 21 23 32 15 Z" />
          <path d="M32 19 V48 M32 27 L26 23 M32 27 L38 23 M32 34 L25 30 M32 34 L39 30 M32 41 L27 38 M32 41 L37 38" fill="none" strokeWidth="1.3" />
        </>
      );
    case "DWARF": // anvil + rune pick
      return (
        <>
          <path d="M17 29 H47 C47 33 43 35 39 35 V39 H43 V44 H21 V39 H25 V35 C20 35 17 33 17 29 Z" />
          <path d="M40 15 L46 21 M43 18 L33 28 M37 13 C42 13 47 17 48 21" fill="none" strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case "HOBBIT": // round door
      return (
        <>
          <circle cx="32" cy="33" r="13" fill="none" strokeWidth="2.6" />
          <circle cx="32" cy="33" r="9.5" fill="none" strokeWidth="1.1" />
          <path d="M26.5 25.5 V41.5 M32 23.5 V42.5 M37.5 25.5 V41.5" fill="none" strokeWidth="1.1" />
          <circle cx="37.5" cy="34" r="1.8" />
          <path d="M18 47 H46" fill="none" strokeWidth="1.6" strokeLinecap="round" />
        </>
      );
    case "HUMAN": // white tree + stars
      return (
        <>
          <path d="M32 49 V26 M32 38 C27 35 24 31 23 26 M32 38 C37 35 40 31 41 26 M32 32 C28 29 27 25 27 22 M32 32 C36 29 37 25 37 22 M32 44 C26 42 21 38 20 33 M32 44 C38 42 43 38 44 33" fill="none" strokeWidth="1.8" strokeLinecap="round" />
          {[
            [32, 13],
            [24, 15],
            [40, 15],
            [18, 20],
            [46, 20],
            [28, 11],
            [36, 11],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="1.5" />
          ))}
        </>
      );
    case "ENT": // tree spirit
      return (
        <>
          <path d="M28 50 C28 44 27 38 29 31 C24 30 20 26 21 21 C25 23 27 22 28 18 C30 21 34 21 36 18 C37 22 39 23 43 21 C44 26 40 30 35 31 C37 38 36 44 36 50 L33 46 L31 50 L29 46 Z" />
          <circle cx="29.5" cy="26" r="1.2" fill="#fef3c7" stroke="none" />
          <circle cx="34.5" cy="26" r="1.2" fill="#fef3c7" stroke="none" />
        </>
      );
    case "WIZARD": // staff + flame rune
      return (
        <>
          <path d="M22 50 L39 22" fill="none" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M41 11 C45 16 46 20 42 25 C41 22 38 21 37 24 C35 20 37 15 41 11 Z" />
          <path d="M44 30 L48 30 M46 28 L46 32 M18 22 L21 22 M19.5 20.5 L19.5 23.5" fill="none" strokeWidth="1.2" strokeLinecap="round" />
        </>
      );
    case "EAGLE": // spread wings
      return (
        <>
          <path d="M32 26 C28 20 18 17 10 20 C15 22 16 25 14 27 C19 26 21 28 20 31 C25 29 28 31 32 36 C36 31 39 29 44 31 C43 28 45 26 50 27 C48 25 49 22 54 20 C46 17 36 20 32 26 Z" />
          <path d="M32 36 L29 44 L32 42 L35 44 Z" />
          <circle cx="32" cy="27" r="2.2" />
        </>
      );
  }
}

/** Irregular wax blob outline (a circle with a few drips). */
const WAX_PATH =
  "M32 5 C38 5 41 8 46 8 C52 9 55 14 57 19 C59 24 60 28 59 33 C58 39 60 42 57 47 C54 52 50 55 44 57 C39 59 36 61 31 59 C25 60 21 58 16 55 C11 52 8 48 7 42 C5 37 4 33 6 27 C7 21 9 16 14 12 C19 8 25 5 32 5 Z";

export function SealStamp({ race, className = "" }: { race: RaceSymbol; className?: string }) {
  const d = useDefs();
  const w = RACE_WAX[race];
  return (
    <Frame className={className}>
      <defs>
        <radialGradient id={d.id("wax")} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#fff" stopOpacity=".55" />
          <stop offset="18%" stopColor={w.wax} />
          <stop offset="100%" stopColor={w.waxDark} />
        </radialGradient>
      </defs>
      <path d={WAX_PATH} fill={d.url("wax")} stroke={w.waxDark} strokeWidth="1" />
      <circle cx="32" cy="32" r="21" fill="none" stroke={w.waxDark} strokeOpacity=".7" strokeWidth="1.6" />
      <circle cx="32" cy="32" r="18.5" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth=".8" strokeDasharray="1.5 2.2" />
      {/* emboss: light offset under dark glyph */}
      <g transform="translate(.7 .7)" fill="#fff" stroke="#fff" opacity=".35">
        {raceGlyph(race)}
      </g>
      <g fill={w.waxDark} stroke={w.waxDark}>
        {raceGlyph(race)}
      </g>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Tech engravings
// ---------------------------------------------------------------------------

function techGlyph(tech: TechSymbol, gold: string): ReactNode {
  switch (tech) {
    case "BOOK": // parchment scroll
      return (
        <g stroke={gold} strokeWidth="1.4" fill="none">
          <path d="M19 18 H44 C47 18 47 23 44 23 H41 V46 C41 50 37 50 36 46 H21 C18 46 18 41 21 41 H23 V21 C23 18 19 18 19 18 Z" fill="#f5e6c4" fillOpacity=".92" />
          <path d="M27 27 H37 M27 31 H36 M27 35 H37 M27 39 H33" strokeWidth="1" stroke="#7c5a2a" />
        </g>
      );
    case "FLAG": // battle standard
      return (
        <g stroke={gold} strokeWidth="1.4">
          <path d="M22 12 V52" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="22" cy="11" r="2" fill={gold} />
          <path d="M23 15 H45 L39 23 L45 31 H23 Z" fill="#b91c1c" />
          <path d="M31 19 L33 23 L37 23 L34 26 L35 29 L31 27 L28 29 L29 26 L26 23 L30 23 Z" fill={gold} stroke="none" />
        </g>
      );
    case "SWORD": // elven dagger
      return (
        <g stroke={gold} strokeWidth="1.2">
          <path d="M32 9 L36 38 H28 Z" fill="#e2e8f0" />
          <path d="M32 12 V36" stroke="#94a3b8" strokeWidth=".8" />
          <path d="M21 38 C26 41 38 41 43 38 C38 36 26 36 21 38 Z" fill={gold} />
          <path d="M30 41 H34 V51 H30 Z" fill="#78350f" />
          <circle cx="32" cy="53.5" r="2.4" fill={gold} />
        </g>
      );
    case "MASK": // shadow mask
      return (
        <g stroke={gold} strokeWidth="1.3">
          <path d="M14 22 C22 17 42 17 50 22 C51 34 44 46 32 50 C20 46 13 34 14 22 Z" fill="#111827" />
          <path d="M20 29 C23 26 27 26 29 30 C26 32 22 32 20 29 Z M44 29 C41 26 37 26 35 30 C38 32 42 32 44 29 Z" fill={gold} stroke="none" />
          <path d="M26 40 C30 43 34 43 38 40" fill="none" />
        </g>
      );
    case "COURAGE": // star of Eärendil
      return (
        <g>
          <circle cx="32" cy="32" r="14" fill="#fef9c3" opacity=".25" />
          <path d="M32 10 L35 29 L54 32 L35 35 L32 54 L29 35 L10 32 L29 29 Z" fill="#fef3c7" stroke={gold} strokeWidth="1" />
          <path d="M32 20 L34 30 L44 32 L34 34 L32 44 L30 34 L20 32 L30 30 Z" fill={gold} opacity=".9" transform="rotate(45 32 32)" />
          <circle cx="32" cy="32" r="3" fill="#fff" />
        </g>
      );
  }
}

export function TechArt({ techs }: { techs: TechSymbol[] }) {
  const d = useDefs();
  const gold = "#f2c14e";
  return (
    <Frame>
      <defs>
        <radialGradient id={d.id("bg")} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={d.url("bg")} />
      <circle cx="32" cy="32" r="26" fill="none" stroke={gold} strokeOpacity=".35" strokeDasharray="2 3" />
      {techs.length === 1 ? (
        techGlyph(techs[0], gold)
      ) : (
        <>
          <g transform="translate(-9 -6) scale(.72)">{techGlyph(techs[0], gold)}</g>
          <g transform="translate(26 22) scale(.72)">{techGlyph(techs[1], gold)}</g>
          <path d="M40 18 L24 46" stroke={gold} strokeOpacity=".6" strokeWidth="1" />
        </>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Military / treasury / ring / tactics
// ---------------------------------------------------------------------------

export function MilitaryArt() {
  const d = useDefs();
  return (
    <Frame>
      <defs>
        <radialGradient id={d.id("bg")} cx="50%" cy="80%" r="80%">
          <stop offset="0%" stopColor="#f97316" stopOpacity=".85" />
          <stop offset="40%" stopColor="#9f1239" />
          <stop offset="100%" stopColor="#1c0509" />
        </radialGradient>
        <linearGradient id={d.id("blade")} x1="0" x2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={d.url("bg")} />
      {/* smoke */}
      <path d="M0 50 C10 44 18 52 28 46 C38 40 46 50 64 44 V64 H0 Z" fill="#000" opacity=".35" />
      {/* orc shield */}
      <path d="M32 20 L46 25 C46 38 41 46 32 51 C23 46 18 38 18 25 Z" fill="#292524" stroke="#57534e" strokeWidth="1.2" />
      <path d="M26 31 L32 41 L38 31" fill="none" stroke="#b91c1c" strokeWidth="2" />
      {/* crossed mithril blades */}
      <g stroke="#e2e8f0" strokeWidth=".6">
        <path d="M12 10 L15 8 L44 40 L41 43 Z" fill={d.url("blade")} />
        <path d="M52 10 L49 8 L20 40 L23 43 Z" fill={d.url("blade")} />
      </g>
      <path d="M38 44 L46 36 M26 44 L18 36" stroke="#f2c14e" strokeWidth="2.4" strokeLinecap="round" />
    </Frame>
  );
}

export function TreasuryArt({ coins }: { coins: number }) {
  const d = useDefs();
  const stack = (x: number, n: number) =>
    Array.from({ length: n }, (_, i) => (
      <g key={`${x}-${i}`}>
        <ellipse cx={x} cy={50 - i * 3.2} rx="7" ry="2.6" fill="#b45309" />
        <ellipse cx={x} cy={49 - i * 3.2} rx="7" ry="2.6" fill={d.url("coin")} stroke="#78350f" strokeWidth=".4" />
      </g>
    ));
  return (
    <Frame>
      <defs>
        <radialGradient id={d.id("bg")} cx="50%" cy="65%" r="70%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity=".7" />
          <stop offset="45%" stopColor="#78350f" />
          <stop offset="100%" stopColor="#1c1003" />
        </radialGradient>
        <linearGradient id={d.id("coin")} x1="0" x2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={d.url("bg")} />
      {/* jewel chest */}
      <path d="M16 26 H48 V40 H16 Z" fill="#5b2c0e" stroke="#f2c14e" strokeWidth="1" />
      <path d="M16 26 C16 16 48 16 48 26 Z" fill="#7c3a12" stroke="#f2c14e" strokeWidth="1" />
      <rect x="29" y="27" width="6" height="6" rx="1" fill="#f2c14e" />
      <circle cx="22" cy="22" r="1.8" fill="#ef4444" />
      <circle cx="42" cy="22" r="1.8" fill="#22d3ee" />
      <circle cx="32" cy="19" r="1.8" fill="#a3e635" />
      {stack(14, Math.min(6, Math.max(2, Math.round(coins / 2))))}
      {stack(50, Math.min(6, Math.max(2, Math.ceil(coins / 2))))}
      {stack(32, 3)}
      {/* sparkles */}
      {[
        [10, 12],
        [54, 14],
        [40, 10],
      ].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 3} L${x + 1} ${y} L${x} ${y + 3} L${x - 1} ${y} Z M${x - 3} ${y} L${x} ${y + 1} L${x + 3} ${y} L${x} ${y - 1} Z`} fill="#fef3c7" />
      ))}
    </Frame>
  );
}

export function RingArt() {
  const d = useDefs();
  return (
    <Frame>
      <defs>
        <radialGradient id={d.id("bg")} cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#0e7490" stopOpacity=".55" />
          <stop offset="60%" stopColor="#0b1026" />
          <stop offset="100%" stopColor="#020617" />
        </radialGradient>
        <linearGradient id={d.id("gold")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
        <radialGradient id={d.id("fire")} cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="#f97316" stopOpacity="0" />
          <stop offset="85%" stopColor="#f97316" stopOpacity=".45" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={d.url("bg")} />
      {/* starlight guide */}
      {[
        [8, 10, 0.8],
        [20, 6, 0.5],
        [52, 9, 1],
        [58, 22, 0.6],
        [6, 44, 0.6],
        [56, 52, 0.8],
        [14, 56, 0.5],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#e0f2fe" />
      ))}
      <ellipse cx="32" cy="32" rx="24" ry="20" fill={d.url("fire")} />
      <ellipse cx="32" cy="33" rx="17" ry="11" fill="none" stroke="#78350f" strokeWidth="6" opacity=".6" />
      <ellipse cx="32" cy="32" rx="17" ry="11" fill="none" stroke={d.url("gold")} strokeWidth="5" />
      {/* tengwar-like fire script */}
      <ellipse cx="32" cy="32" rx="17" ry="11" fill="none" stroke="#fb923c" strokeWidth="1.1" strokeDasharray="1.2 .8 3 1 .6 1.6" opacity=".95" />
      <path d="M22 28 C26 25 38 25 42 28" fill="none" stroke="#fff7ed" strokeWidth=".8" opacity=".7" />
    </Frame>
  );
}

export function TacticsArt({ kind, amount }: { kind: LotrDuelCard["tacticsType"]; amount: number }) {
  const d = useDefs();
  return (
    <Frame>
      <defs>
        <radialGradient id={d.id("bg")} cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#7e22ce" stopOpacity=".8" />
          <stop offset="55%" stopColor="#1e0b33" />
          <stop offset="100%" stopColor="#05020a" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={d.url("bg")} />
      {/* lightning */}
      <path d="M50 2 L42 18 L48 18 L38 34" fill="none" stroke="#e9d5ff" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M50 2 L42 18 L48 18 L38 34" fill="none" stroke="#a855f7" strokeWidth="3.5" strokeOpacity=".35" />
      <path d="M10 6 L15 16 L11 16 L17 26" fill="none" stroke="#d8b4fe" strokeWidth="1" />
      {/* iron crown helm of the shadow king */}
      <path d="M18 40 C18 26 24 20 32 20 C40 20 46 26 46 40 L42 54 H22 Z" fill="#0a0a0a" stroke="#6b21a8" strokeWidth="1" />
      <path d="M20 26 L23 16 L27 23 L32 13 L37 23 L41 16 L44 26" fill="#1f2937" stroke="#a1a1aa" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M24 36 H40 L38 40 H26 Z" fill="#000" />
      <circle cx="28" cy="38" r="1.2" fill="#e9d5ff" />
      <circle cx="36" cy="38" r="1.2" fill="#e9d5ff" />
      <text x="32" y="62" textAnchor="middle" fontSize="8.5" fontWeight="900" fill="#e9d5ff">
        {kind === "MULTI_MOVE" ? `이동×${amount}` : kind === "SNIPE_UNIT" ? `제거×${amount}` : `강탈${amount}`}
      </text>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Race card art (seal on a themed backdrop)
// ---------------------------------------------------------------------------

const RACE_BG: Record<RaceSymbol, [string, string]> = {
  ELF: ["#a7f3d0", "#022c22"],
  DWARF: ["#f59e0b", "#1c0f02"],
  HOBBIT: ["#bef264", "#14230a"],
  HUMAN: ["#93c5fd", "#0b1a3d"],
  ENT: ["#4ade80", "#03170b"],
  WIZARD: ["#d8b4fe", "#1a0630"],
  EAGLE: ["#fde68a", "#1f1a07"],
};

export function RaceArt({ race }: { race: RaceSymbol }) {
  const d = useDefs();
  const [hi, lo] = RACE_BG[race];
  return (
    <div className="relative h-full w-full">
      <Frame className="absolute inset-0">
        <defs>
          <radialGradient id={d.id("bg")} cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor={hi} stopOpacity=".55" />
            <stop offset="55%" stopColor={lo} />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
        </defs>
        <rect width="64" height="64" fill={d.url("bg")} />
        {/* moonlight beams */}
        <path d="M22 0 L30 64 H26 L14 0 Z M42 0 L38 64 H35 L36 0 Z" fill={hi} opacity=".08" />
      </Frame>
      <div className="absolute inset-[8%]" style={{ filter: `drop-shadow(0 0 6px ${RACE_WAX[race].glow})` }}>
        <SealStamp race={race} />
      </div>
    </div>
  );
}

/** Picks the right illustration for any card. */
export function CardIllustration({ card }: { card: LotrDuelCard }) {
  switch (card.color) {
    case "GREEN":
      return <RaceArt race={card.race!} />;
    case "GRAY":
      return <TechArt techs={card.selectTechChoice ?? card.providesTech ?? ["BOOK"]} />;
    case "RED":
      return <MilitaryArt />;
    case "YELLOW":
      return <TreasuryArt coins={card.coinsReward ?? 2} />;
    case "BLUE":
      return <RingArt />;
    case "PURPLE":
      return <TacticsArt kind={card.tacticsType} amount={card.tacticsAmount ?? 1} />;
  }
}

// ---------------------------------------------------------------------------
// Card back + fortress
// ---------------------------------------------------------------------------

export function CardBackArt({ chapter }: { chapter: number }) {
  const d = useDefs();
  const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ";
  return (
    <Frame>
      <defs>
        <radialGradient id={d.id("bg")} cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#3b2a12" />
          <stop offset="100%" stopColor="#0d0906" />
        </radialGradient>
        <path id={d.id("arc")} d="M32 14 A18 18 0 1 1 31.9 14" />
      </defs>
      <rect width="64" height="64" fill={d.url("bg")} />
      <path d="M32 4 L60 32 L32 60 L4 32 Z" fill="none" stroke="#b8893b" strokeOpacity=".35" strokeWidth=".8" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="#b8893b" strokeOpacity=".55" strokeWidth="1" />
      <circle cx="32" cy="32" r="13" fill="#1a1208" stroke="#d4a54a" strokeWidth="1.2" />
      <text fontSize="5.2" fill="#d4a54a" fillOpacity=".75" letterSpacing="1.4">
        <textPath href={`#${d.id("arc")}`}>{runes + runes}</textPath>
      </text>
      <text x="32" y="36.5" textAnchor="middle" fontSize="12" fontWeight="900" fill="#e7b85a" fontFamily="serif">
        {["Ⅰ", "Ⅱ", "Ⅲ"][chapter - 1]}
      </text>
    </Frame>
  );
}

export function FortressArt({ owner }: { owner?: "FELLOWSHIP" | "SAURON" }) {
  const d = useDefs();
  const stone = owner === "SAURON" ? ["#52525b", "#18181b"] : ["#e7d9b8", "#6b5a3a"];
  return (
    <Frame>
      <defs>
        <linearGradient id={d.id("st")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stone[0]} />
          <stop offset="100%" stopColor={stone[1]} />
        </linearGradient>
        <radialGradient id={d.id("sky")} cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity=".55" />
          <stop offset="100%" stopColor="#0c0a09" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="8" fill={d.url("sky")} />
      <path d="M10 56 V30 H14 V26 H18 V30 H22 V22 H26 V14 L32 6 L38 14 V22 H42 V30 H46 V26 H50 V30 H54 V56 Z" fill={d.url("st")} stroke="#f2c14e" strokeWidth="1" />
      <path d="M28 56 V46 C28 42 36 42 36 46 V56 Z" fill="#1c1917" />
      <path d="M31 24 H33 V30 H31 Z M17 38 H19 V43 H17 Z M45 38 H47 V43 H45 Z" fill="#fde68a" />
      <path d="M32 6 V1 L37 3 L32 5" fill="#b91c1c" stroke="#f2c14e" strokeWidth=".5" />
    </Frame>
  );
}
