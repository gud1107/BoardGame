/**
 * Shared "render pass" for every themed scene (2026-11-16 quality pass).
 *
 * The hand-built SVG scenes are flat fills — crisp vectors, but no light,
 * glow or depth, so they read as dull and soft. Instead of redrawing ten
 * pictures, ThemeSceneArt wraps each one in:
 *  1. a grade filter — saturation + a gentle contrast curve + a mild unsharp
 *     kernel (punchier colour, crisper edges),
 *  2. bloom — a bright-pass (luminance → alpha) blurred and added back, so
 *     neon, candles, windows and fire actually glow. It's computed from the
 *     pixels, so a mutation that switches a light off loses its glow too —
 *     the lighting can never hide or fake a difference,
 *  3. a broad per-theme key light (soft-light: warms + adds contrast without
 *     lifting blacks into haze) + shadow side (multiply) — wide,
 *     soft gradients deliberately NOT centred on any mutable light source,
 *  4. a soft vignette that stays clear of the 12–88% band where spots live.
 * Everything is deterministic and identical on both panels and every client
 * (no noise/grain — it would only blur the details players hunt for).
 */
import type { ReactNode } from "react";

export interface SceneLight {
  /** Key light centre (0..100 scene space) — usually off-frame, like a sun/window. */
  x: number;
  y: number;
  /** Key light colour + strength (screen blend). */
  color: string;
  strength: number;
  /** Colour the far/shadow side is pushed toward (multiply blend). */
  shade: string;
  shadeStrength: number;
  /** Bloom: luminance threshold (0..1) and how much glow to add back. */
  bloomThreshold: number;
  bloom: number;
  /** Overall saturation multiplier. */
  saturate: number;
}

const DEFAULT_LIGHT: SceneLight = {
  x: 50,
  y: -20,
  color: "#fff7e6",
  strength: 0.4,
  shade: "#1e1b4b",
  shadeStrength: 0.18,
  bloomThreshold: 0.62,
  bloom: 0.7,
  saturate: 1.14,
};

/** Per-theme lighting, matched to each scene's story (dusk sun, neon rain, deep water...). */
export const THEME_LIGHTS: Record<string, Partial<SceneLight>> = {
  // Night / dark scenes: real glow on neon, windows, candles, fire.
  "theme-cyberpunk": { x: 15, y: 10, color: "#f472b6", strength: 0.45, shade: "#0c0a3e", shadeStrength: 0.2, bloomThreshold: 0.5, bloom: 0.75, saturate: 1.18 },
  "theme-alchemy": { x: 105, y: 15, color: "#fdba74", strength: 0.5, shade: "#2e1065", shadeStrength: 0.2, bloomThreshold: 0.6, bloom: 0.65, saturate: 1.08 },
  "theme-deepsea": { x: 50, y: -30, color: "#67e8f9", strength: 0.45, shade: "#082f49", shadeStrength: 0.2, bloomThreshold: 0.6, bloom: 0.6, saturate: 1.16 },
  "theme-orbital": { x: -10, y: 30, color: "#bae6fd", strength: 0.45, shade: "#020617", shadeStrength: 0.2, bloomThreshold: 0.6, bloom: 0.6 },
  "theme-arcade": { x: 85, y: -10, color: "#e879f9", strength: 0.45, shade: "#1e1b4b", shadeStrength: 0.2, bloomThreshold: 0.5, bloom: 0.8, saturate: 1.18 },
  "theme-camping": { x: 50, y: 95, color: "#fb923c", strength: 0.5, shade: "#020617", shadeStrength: 0.18, bloomThreshold: 0.55, bloom: 0.75 },
  "theme-haunted": { x: 20, y: -10, color: "#a7f3d0", strength: 0.4, shade: "#1e1b4b", shadeStrength: 0.22, bloomThreshold: 0.6, bloom: 0.65 },
  // Bright daylight scenes: warm sun + soft shade for depth, no bloom (it would only bleach them).
  "theme-greenhouse": { x: 50, y: -25, color: "#fef3c7", strength: 0.3, shade: "#14532d", shadeStrength: 0.05, bloomThreshold: 1, bloom: 0, saturate: 1.1 },
  "theme-bakery": { x: 100, y: -15, color: "#fef3c7", strength: 0.25, shade: "#7c2d12", shadeStrength: 0.04, bloomThreshold: 1, bloom: 0, saturate: 1.04 },
  "theme-bazaar": { x: 50, y: 115, color: "#fdba74", strength: 0.35, shade: "#3b0764", shadeStrength: 0.18, bloomThreshold: 0.85, bloom: 0.35, saturate: 1.02 },
};

export function sceneLightFor(themeId: string): SceneLight {
  return { ...DEFAULT_LIGHT, ...THEME_LIGHTS[themeId] };
}

/** Wraps a scene's art in the grade/bloom filter and lays the light + vignette passes on top. */
export function SceneRenderFx({ themeId, p, children }: { themeId: string; p: string; children: ReactNode }) {
  const L = sceneLightFor(themeId);
  // Bright pass: alpha = lum*k - (k*threshold - 0) → 0 below the threshold, ramps to 1 above it.
  const k = 4;
  const lum = (c: number) => (c * k).toFixed(4);
  const brightPass = `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${lum(0.2126)} ${lum(0.7152)} ${lum(0.0722)} 0 ${(-k * L.bloomThreshold).toFixed(3)}`;
  const id = (s: string) => `${p}fx${s}`;
  return (
    <>
      <defs>
        <filter id={id("grade")} x="-5" y="-5" width="110" height="110" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="saturate" values={String(L.saturate)} result="sat" />
          {/* gentle S-curve: deeper shadows, brighter mids → reads sharper */}
          <feComponentTransfer in="sat" result="graded">
            <feFuncR type="table" tableValues="0 0.115 0.255 0.425 0.595 0.75 0.89 1" />
            <feFuncG type="table" tableValues="0 0.115 0.255 0.425 0.595 0.75 0.89 1" />
            <feFuncB type="table" tableValues="0 0.12 0.26 0.43 0.595 0.745 0.885 1" />
          </feComponentTransfer>
          <feColorMatrix in="graded" type="matrix" values={brightPass} result="bright" />
          <feGaussianBlur in="bright" stdDeviation="1.6" result="blurred" />
          {/* halo only: drop the glow wherever the source itself is bright, so a lit object's own details (gauge needle, portrait eyes) never wash out */}
          <feComposite in="blurred" in2="bright" operator="out" result="halo" />
          {/* screen-style add: a + s·b − s·a·b never clips to white */}
          <feComposite in="graded" in2="halo" operator="arithmetic" k1={(-L.bloom).toFixed(2)} k2="1" k3={L.bloom.toFixed(2)} k4="0" result="lit" />
          {/* mild unsharp kernel (sums to 1) — crisper edges on the flat vector shapes */}
          <feConvolveMatrix in="lit" order="3" kernelMatrix="0 -0.18 0 -0.18 1.72 -0.18 0 -0.18 0" preserveAlpha="true" edgeMode="duplicate" />
        </filter>
        <radialGradient id={id("key")} gradientUnits="userSpaceOnUse" cx={L.x} cy={L.y} r="95">
          <stop offset="0%" stopColor={L.color} stopOpacity={L.strength} />
          <stop offset="55%" stopColor={L.color} stopOpacity={L.strength * 0.35} />
          <stop offset="100%" stopColor={L.color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("shade")} gradientUnits="userSpaceOnUse" cx={100 - L.x} cy={100 - L.y} r="110">
          <stop offset="0%" stopColor={L.shade} stopOpacity={L.shadeStrength} />
          <stop offset="70%" stopColor={L.shade} stopOpacity={L.shadeStrength * 0.25} />
          <stop offset="100%" stopColor={L.shade} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("vig")} cx="50" cy="50" r="72" gradientUnits="userSpaceOnUse">
          <stop offset="70%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
        </radialGradient>
      </defs>
      <g filter={`url(#${id("grade")})`}>{children}</g>
      <rect width="100" height="100" fill={`url(#${id("shade")})`} style={{ mixBlendMode: "multiply" }} pointerEvents="none" />
      <rect width="100" height="100" fill={`url(#${id("key")})`} style={{ mixBlendMode: "soft-light" }} pointerEvents="none" />
      <rect width="100" height="100" fill={`url(#${id("vig")})`} pointerEvents="none" />
    </>
  );
}
