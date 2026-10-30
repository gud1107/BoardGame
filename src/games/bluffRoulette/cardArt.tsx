import SkinBackFace from "@/components/skins/SkinBackFace";
import { useCardBackSkin } from "@/lib/skins/useSkins";
import { useSyncExternalStore } from "react";
import type { CardKind, Suit } from "./engine";

/**
 * Self-designed card faces (rulebook §B — no playing-card art): ivory stock,
 * a gilt double frame, corner indices and a gradient emblem; the back is an
 * art-deco burgundy with a revolver-cylinder medallion. One SVG string per
 * card (100×140 box, emblem centred at 50,70) feeds both the 2D HUD (`<img>`)
 * and the 3D textures (the same image drawn onto a canvas), so they always
 * match.
 *
 * Themes: every look is just a pair of SVG builders (face + back) keyed in
 * `THEMES` below — add a theme by writing those two functions and listing
 * it there; the HUD, the 3D textures and the ⚙ picker pick it up from
 * `CARD_THEMES` automatically.
 */

function polygon(cx: number, cy: number, points: number, outer: number, inner: number, rot = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z`;
}

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;

/** One filled shape of an emblem: `main` = accent gradient, `light` = pale highlight, `dark` = deep accent. */
interface Layer {
  d: string;
  fill: "main" | "light" | "dark";
  evenodd?: boolean;
}

export interface CardArt {
  label: string;
  /** Deep and bright accent (gradient ends). */
  accent: [string, string];
  /** Paper tint for the face. */
  paper: [string, string];
  layers: Layer[];
}

const MASK_PATH =
  "M22 46 Q50 30 78 46 Q80 86 50 104 Q20 86 22 46 Z M33 61 Q38 55 45 61 Q38 66 33 61 Z M55 61 Q62 55 67 61 Q62 66 55 61 Z M38 81 Q50 91 62 81 Q50 87 38 81 Z";
const SKULL_PATH = `M50 36 C28 36 22 54 24 68 C25 76 30 80 34 82 L34 96 L66 96 L66 82 C70 80 75 76 76 68 C78 54 72 36 50 36 Z ${circle(39, 64, 7)} ${circle(61, 64, 7)} M50 72 L45 82 L55 82 Z M40 88 L40 96 M50 88 L50 96 M60 88 L60 96`;

export const CARD_ART: Record<CardKind, CardArt> = {
  sun: {
    label: "해",
    accent: ["#b45309", "#f59e0b"],
    paper: ["#fffaf0", "#f6e9cf"],
    layers: [
      { d: polygon(50, 70, 16, 33, 21), fill: "main" },
      { d: circle(50, 70, 17), fill: "light" },
      { d: circle(50, 70, 11), fill: "main" },
    ],
  },
  moon: {
    label: "달",
    accent: ["#312e81", "#6366f1"],
    paper: ["#f8f8ff", "#e6e6f5"],
    layers: [
      { d: "M62 38 A32 32 0 1 0 62 102 A42 42 0 0 1 62 38 Z", fill: "main" },
      { d: "M56 46 A24 24 0 0 0 56 94 A34 34 0 0 1 56 46 Z", fill: "light" },
      { d: `${polygon(70, 52, 4, 5, 1.6)} ${polygon(76, 72, 4, 3.5, 1.1)} ${polygon(66, 88, 4, 4, 1.3)}`, fill: "dark" },
    ],
  },
  star: {
    label: "별",
    accent: ["#115e59", "#14b8a6"],
    paper: ["#f6fffd", "#dff3ef"],
    layers: [
      { d: polygon(50, 72, 5, 34, 14), fill: "main" },
      { d: polygon(50, 72, 5, 17, 7), fill: "light" },
    ],
  },
  mask: {
    label: "가면",
    accent: ["#701a75", "#d946ef"],
    paper: ["#fff8fe", "#f3e3f2"],
    layers: [
      { d: MASK_PATH, fill: "main", evenodd: true },
      { d: "M26 48 Q50 36 74 48 Q72 52 50 44 Q28 52 26 48 Z", fill: "light" },
    ],
  },
  skull: {
    label: "해골",
    accent: ["#18181b", "#57534e"],
    paper: ["#f5f5f4", "#d6d3d1"],
    layers: [{ d: SKULL_PATH, fill: "main", evenodd: true }],
  },
};

export const SUIT_ORDER: Suit[] = ["sun", "moon", "star"];

const GOLD = "#b8892d";
const GOLD_LIGHT = "#e8c56a";

function faceSvg(kind: CardKind): string {
  const a = CARD_ART[kind];
  const fills = { main: "url(#m)", light: "url(#l)", dark: a.accent[0] };
  const emblem = a.layers
    .map((l) => `<path d="${l.d}" fill="${fills[l.fill]}"${l.evenodd ? ' fill-rule="evenodd"' : ""}${l.fill === "main" ? ` stroke="${a.accent[0]}" stroke-width="0.8" stroke-linejoin="round"` : ""}/>`)
    .join("");
  const mini = a.layers
    .filter((l) => l.fill === "main")
    .map((l) => `<path d="${l.d}" fill="${a.accent[0]}"${l.evenodd ? ' fill-rule="evenodd"' : ""}/>`)
    .join("");
  const corner = `<g transform="translate(14 22) scale(0.17) translate(-50 -70)">${mini}</g><text x="14" y="38" font-size="8.5" font-weight="800" text-anchor="middle" fill="${a.accent[0]}" font-family="'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif">${a.label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">
<defs>
<linearGradient id="p" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${a.paper[0]}"/><stop offset="1" stop-color="${a.paper[1]}"/></linearGradient>
<linearGradient id="m" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${a.accent[1]}"/><stop offset="1" stop-color="${a.accent[0]}"/></linearGradient>
<radialGradient id="l" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="${a.accent[1]}" stop-opacity="0.55"/></radialGradient>
<radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${a.accent[1]}" stop-opacity="0.22"/><stop offset="1" stop-color="${a.accent[1]}" stop-opacity="0"/></radialGradient>
<pattern id="t" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0 L0 6" stroke="${a.accent[0]}" stroke-opacity="0.05" stroke-width="2"/></pattern>
</defs>
<rect x="1" y="1" width="98" height="138" rx="9" fill="url(#p)" stroke="#2a1d10" stroke-opacity="0.45" stroke-width="1.2"/>
<rect x="1" y="1" width="98" height="138" rx="9" fill="url(#t)"/>
<rect x="5" y="5" width="90" height="130" rx="6.5" fill="none" stroke="${GOLD}" stroke-width="1.3"/>
<rect x="7.5" y="7.5" width="85" height="125" rx="5" fill="none" stroke="${GOLD_LIGHT}" stroke-width="0.5" stroke-opacity="0.9"/>
<circle cx="50" cy="70" r="40" fill="url(#g)"/>
<circle cx="50" cy="70" r="37" fill="none" stroke="${a.accent[0]}" stroke-opacity="0.18" stroke-width="0.6" stroke-dasharray="1.5 2.5"/>
${emblem}
${corner}
<g transform="rotate(180 50 70)">${corner}</g>
</svg>`;
}

/** Card back — burgundy with a gilt art-deco sunburst and a revolver-cylinder medallion. */
function backSvg(): string {
  const rays = Array.from({ length: 24 }, (_, i) => {
    const t = (i / 24) * Math.PI * 2;
    return `M50 70 L${(50 + Math.cos(t) * 80).toFixed(1)} ${(70 + Math.sin(t) * 80).toFixed(1)}`;
  }).join(" ");
  const holes = [0, 1, 2, 3, 4, 5].map((i) => circle(50 + Math.cos((i * Math.PI) / 3) * 10, 70 + Math.sin((i * Math.PI) / 3) * 10, 3)).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">
<defs>
<radialGradient id="b" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#7f1d2d"/><stop offset="1" stop-color="#3b0a12"/></radialGradient>
<linearGradient id="gd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d58a"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="#f0cf7a"/></linearGradient>
<clipPath id="c"><rect x="8" y="8" width="84" height="124" rx="5"/></clipPath>
</defs>
<rect x="1" y="1" width="98" height="138" rx="9" fill="url(#b)" stroke="#120406" stroke-width="1.2"/>
<g clip-path="url(#c)"><path d="${rays}" stroke="${GOLD}" stroke-opacity="0.22" stroke-width="0.7"/></g>
<rect x="5" y="5" width="90" height="130" rx="6.5" fill="none" stroke="url(#gd)" stroke-width="1.4"/>
<rect x="8" y="8" width="84" height="124" rx="5" fill="none" stroke="${GOLD}" stroke-opacity="0.7" stroke-width="0.5"/>
<path d="M50 14 L56 20 L50 26 L44 20 Z M50 114 L56 120 L50 126 L44 120 Z" fill="url(#gd)"/>
<circle cx="50" cy="70" r="22" fill="#2a0710" stroke="url(#gd)" stroke-width="1.6"/>
<circle cx="50" cy="70" r="18" fill="none" stroke="${GOLD}" stroke-opacity="0.6" stroke-width="0.5"/>
<path d="${circle(50, 70, 15.5)} ${holes} ${circle(50, 70, 3.5)}" fill="url(#gd)" fill-rule="evenodd"/>
</svg>`;
}

/** Neon-casino palette per kind: [glow, core]. */
const NEON: Record<CardKind, [string, string]> = {
  sun: ["#ffb020", "#fff3c4"],
  moon: ["#7c8cff", "#e3e6ff"],
  star: ["#22f5d0", "#d6fff7"],
  mask: ["#ff3dcb", "#ffd6f5"],
  skull: ["#a3ff3d", "#efffd6"],
};

function neonFaceSvg(kind: CardKind): string {
  const a = CARD_ART[kind];
  const [glow, core] = NEON[kind];
  const emblem = a.layers
    .filter((l) => l.fill !== "light")
    .map((l) => `<path d="${l.d}" fill="none" stroke="${l.fill === "dark" ? glow : core}" stroke-width="${l.fill === "dark" ? 1.2 : 2}" stroke-linejoin="round"${l.evenodd ? ' fill-rule="evenodd"' : ""}/>`)
    .join("");
  const corner = `<text x="14" y="26" font-size="10" font-weight="900" text-anchor="middle" fill="${core}" filter="url(#n)" font-family="'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif">${a.label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">
<defs>
<filter id="n" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="bg" cx="0.5" cy="0.45" r="0.8"><stop offset="0" stop-color="#1a0d33"/><stop offset="1" stop-color="#07030f"/></radialGradient>
<pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0 L0 0 0 10" fill="none" stroke="${glow}" stroke-opacity="0.12" stroke-width="0.5"/></pattern>
</defs>
<rect x="1" y="1" width="98" height="138" rx="9" fill="url(#bg)" stroke="#000" stroke-width="1"/>
<rect x="1" y="1" width="98" height="138" rx="9" fill="url(#grid)"/>
<rect x="5" y="5" width="90" height="130" rx="7" fill="none" stroke="${glow}" stroke-width="1.6" filter="url(#n)"/>
<g filter="url(#n)" stroke="${glow}">${emblem}</g>
${corner}
<g transform="rotate(180 50 70)">${corner}</g>
</svg>`;
}

function neonBackSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">
<defs>
<filter id="n" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14062b"/><stop offset="1" stop-color="#05020c"/></linearGradient>
<pattern id="d" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="none" stroke="#ff3dcb" stroke-opacity="0.18" stroke-width="0.6"/></pattern>
</defs>
<rect x="1" y="1" width="98" height="138" rx="9" fill="url(#bg)" stroke="#000" stroke-width="1"/>
<rect x="1" y="1" width="98" height="138" rx="9" fill="url(#d)"/>
<rect x="5" y="5" width="90" height="130" rx="7" fill="none" stroke="#22f5d0" stroke-width="1.5" filter="url(#n)"/>
<path d="M50 40 L72 70 L50 100 L28 70 Z" fill="none" stroke="#ff3dcb" stroke-width="1.8" filter="url(#n)"/>
<circle cx="50" cy="70" r="12" fill="none" stroke="#ffb020" stroke-width="1.6" filter="url(#n)"/>
${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${(50 + Math.cos((i * Math.PI) / 3) * 7).toFixed(1)}" cy="${(70 + Math.sin((i * Math.PI) / 3) * 7).toFixed(1)}" r="2" fill="#ffb020"/>`).join("")}
</svg>`;
}

export type CardTheme = "classic" | "neon";

const THEMES: Record<CardTheme, { label: string; face: (k: CardKind) => string; back: () => string }> = {
  classic: { label: "클래식 살롱", face: faceSvg, back: backSvg },
  neon: { label: "네온 카지노", face: neonFaceSvg, back: neonBackSvg },
};

export const CARD_THEMES: { id: CardTheme; label: string }[] = (Object.keys(THEMES) as CardTheme[]).map((id) => ({ id, label: THEMES[id].label }));

const urlCache = new Map<string, string>();
/** `data:` URL of a card image (memoised per theme). */
export function cardImageUrl(kind: CardKind | "back", theme: CardTheme = "classic"): string {
  const key = `${theme}:${kind}`;
  let u = urlCache.get(key);
  if (!u) {
    const t = THEMES[theme] ?? THEMES.classic;
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(kind === "back" ? t.back() : t.face(kind))}`;
    urlCache.set(key, u);
  }
  return u;
}

// --- per-viewer theme preference (localStorage, best effort) ---
const THEME_KEY = "bluff-roulette-card-theme";
const themeListeners = new Set<() => void>();
function readTheme(): CardTheme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "neon" || v === "classic" ? v : "classic";
  } catch {
    return "classic";
  }
}
let currentTheme: CardTheme | null = null;
export function getCardTheme(): CardTheme {
  if (currentTheme === null) currentTheme = typeof window === "undefined" ? "classic" : readTheme();
  return currentTheme;
}
export function setCardTheme(theme: CardTheme) {
  currentTheme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — keep the in-memory choice */
  }
  themeListeners.forEach((l) => l());
}
export function useCardTheme(): CardTheme {
  return useSyncExternalStore(
    (l) => {
      themeListeners.add(l);
      return () => themeListeners.delete(l);
    },
    getCardTheme,
    () => "classic",
  );
}

export function CardFace({ kind, className = "", dim = false }: { kind: CardKind; className?: string; dim?: boolean }) {
  const theme = useCardTheme();
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline data: SVG, nothing for next/image to optimise
    <img
      src={cardImageUrl(kind, theme)}
      alt={CARD_ART[kind].label}
      draggable={false}
      className={`select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)] ${className}`}
      style={dim ? { opacity: 0.45 } : undefined}
    />
  );
}

/** `owner` = whose cards these are (the accused at a showdown) — their 🎨 back skin wins when set. */
export function CardBack({ className = "", owner }: { className?: string; owner?: string }) {
  const theme = useCardTheme();
  const skin = useCardBackSkin(owner);
  if (skin) return <SkinBackFace skin={skin} className={className} emblemClassName="text-lg" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline data: SVG, nothing for next/image to optimise
    <img src={cardImageUrl("back", theme)} alt="뒷면" draggable={false} className={`select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)] ${className}`} />
  );
}

/** Draws a card onto a 2D canvas once its SVG image has decoded (for three.js textures). */
export function paintCard(ctx: CanvasRenderingContext2D, kind: CardKind | "back", w: number, h: number, onDone?: () => void, theme: CardTheme = "classic") {
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    onDone?.();
  };
  img.src = cardImageUrl(kind, theme);
}
