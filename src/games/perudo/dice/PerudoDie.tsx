"use client";

import { useEffect, type CSSProperties } from "react";
import PerudoFaceIcon from "../PerudoFaceIcon";
import type { DiceColorway } from "./colorways";

/**
 * The one shared die primitive for this game — replaces the WebGL physics
 * dice (`dice3d/DiceMesh.tsx` + friends, removed 2026-08-16, see HANDOFF.md)
 * with a plain CSS/SVG "photographed straight down onto the table" look, per
 * user request: no `three`/`@react-three/*` runtime cost, just a rounded
 * square with a chamfer bevel, a soft top-left light gradient, a grounding
 * drop shadow, and debossed (inset-shadowed) pips/mark. Every die anywhere
 * in this game — a player's own hand, roster backs, the lost-dice tray, the
 * purple betting die, reveal-panel tiles — renders through this component so
 * they all share one visual language, the same "one primitive, many
 * colorways" pattern the old CSS `DiceCube`/WebGL `DiceMesh` both used.
 *
 * The old WebGL system also carried real physics tumble animation
 * (`DiceTray3D`) for a player's own roll. That's replaced by `DiceRollTray`
 * below: a CSS keyframe shake-then-settle per die (no physics, no canvas) —
 * see its own doc comment.
 */

export const DIE_SIZE_PX = { sm: 24, md: 36, lg: 48 } as const;
export type DieSize = keyof typeof DIE_SIZE_PX;

const PIP_LAYOUT: Record<number, number[]> = {
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Lightens (`percent` > 0) or darkens (`percent` < 0) a `#rrggbb` hex color — the die's light gradient/chamfer shading needs shades of whatever hex a `DiceColorway` carries, and Tailwind can't express arbitrary dynamic hex gradients as utility classes. */
function shadeHex(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const clamp = (c: number) => Math.min(255, Math.max(0, c));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Cheap deterministic pseudo-random in `[-3, 3]` degrees from an integer seed — stable across re-renders for the same seed (unlike `Math.random()`, which would jitter the tray on every unrelated re-render). Used for the "not a mechanical row" resting tilt on both the hand tray and the showdown/reveal grid (rulebook UX request #3). */
export function tiltFor(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 6 - 3;
}

function DiePips({ value, ink }: { value: number; ink: string }) {
  return (
    <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-[1px] p-[15%]">
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="m-auto h-[72%] w-[72%] rounded-full"
          style={
            PIP_LAYOUT[value]?.includes(i)
              ? {
                  backgroundColor: ink,
                  // Debossed/carved-in feel: a dark shadow on the upper-left
                  // edge of the pip (as if light from the top-left is
                  // catching the recess's far wall) plus a faint highlight
                  // on the lower-right (the recess's near wall).
                  boxShadow: "inset 1.5px 1.5px 2px rgba(0,0,0,0.5), inset -1px -1px 1px rgba(255,255,255,0.15)",
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}

export interface PerudoDieProps {
  /** 1-6 face-up value; omit (or pass `blank`) for a hidden/concealed die. */
  value?: number;
  size?: DieSize;
  colorway: DiceColorway;
  ring?: "match" | "wild";
  /** A hidden/opponent die: a plain colored body with no pips/mark at all — reads as a true silhouette rather than a generic dice emoji. */
  blank?: boolean;
  /** Resting tilt in degrees (e.g. -3..3, see `tiltFor`) — echoes loose dice scattered on a real tray rather than a mechanical row. */
  tilt?: number;
  glossy?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * One physical die, rendered as if photographed from directly above on a
 * table: `border-radius` chamfer corners, a soft light gradient falling from
 * the upper-left, a grounding drop shadow, and debossed pips/mark. Always
 * renders in the passed-in `colorway` — including the face-1 페루도 mark,
 * which is engraved in that same die's own ink color rather than a fixed
 * universal red (see `colorways.ts`'s file header).
 */
export function PerudoDie({ value, size = "md", colorway, ring, blank = false, tilt = 0, glossy = true, title, className = "", style }: PerudoDieProps) {
  const w = DIE_SIZE_PX[size];
  const isPerudoMark = !blank && value === 1;
  const ringShadow =
    ring === "match"
      ? "0 0 0 3px rgba(252,211,77,0.95), 0 0 10px 2px rgba(252,211,77,0.55)"
      : ring === "wild"
        ? "0 0 0 3px rgba(196,181,253,0.95), 0 0 10px 2px rgba(196,181,253,0.55)"
        : "none";
  // Body: a soft radial "light falling from the upper-left" highlight over
  // the flat colorway body, darkening slightly toward the bottom-right — the
  // photographed-under-a-lamp look requested, without a literal light source.
  const bodyBg = `radial-gradient(circle at 30% 24%, ${shadeHex(colorway.body, 32)}, ${colorway.body} 48%, ${shadeHex(colorway.body, -12)} 100%)`;
  const borderColor = shadeHex(colorway.shadow, -4);
  const markColorStyle: CSSProperties = {
    color: colorway.ink,
    // Same debossed logic as DiePips' inset shadow, translated to a
    // currentColor SVG via layered drop-shadows (box-shadow can't reach
    // into an <svg>'s own alpha shape) — a dark shadow toward the light
    // source (upper-left) and a faint highlight opposite it.
    filter: "drop-shadow(1px 1px 1px rgba(0,0,0,0.45)) drop-shadow(-0.5px -0.5px 0.5px rgba(255,255,255,0.2))",
  };
  return (
    <div
      className={`relative inline-block shrink-0 rounded-[24%] border ${className}`}
      title={title}
      style={{
        width: w,
        height: w,
        background: bodyBg,
        borderColor,
        boxShadow: [
          ringShadow,
          "0 4px 10px rgba(0,0,0,0.25)",
          "0 1px 1.5px rgba(0,0,0,0.35)",
          "inset 0 1px 1.5px rgba(255,255,255,0.45)",
          "inset 0 -2px 3px rgba(0,0,0,0.28)",
        ].join(", "),
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        ...style,
      }}
    >
      {glossy && (
        <div className="pointer-events-none absolute top-[8%] left-[10%] h-[38%] w-[38%] rounded-full bg-white/25 blur-[3px]" />
      )}
      {!blank && !isPerudoMark && (
        <div className="relative flex h-full w-full items-center justify-center">
          <DiePips value={value ?? 0} ink={colorway.ink} />
        </div>
      )}
      {isPerudoMark && (
        // The colorway's ink color + the debossed drop-shadow filter live on
        // this wrapper (not threaded into the shared icon component as
        // props), since other call sites of `PerudoFaceIcon` (face picker,
        // rulebook, bid-track medallions) rely on it staying style-agnostic.
        <div className="pointer-events-none relative flex h-full w-full items-center justify-center" style={markColorStyle}>
          <PerudoFaceIcon className="mx-auto h-[70%] w-[70%]" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roll tray — a CSS-only replacement for the old `DiceTray3D` physics
// tumble. The engine has already decided the settled values (see
// `PerudoBoard.tsx`'s trust-model note, same as the WebGL version had) — this
// component only ever plays a cosmetic shake-then-settle over those already-
// final values, it never itself decides anything.
// ---------------------------------------------------------------------------

/** Total duration of the shake-then-settle keyframe (`perudo-dice-settle` in globals.css) — used to time the roll/thud sound cues to the animation's actual end. */
export const DICE_ROLL_MS = 650;
const DIE_STAGGER_MS = 45;

function hashToken(token: number | string): number {
  if (typeof token === "number") return token;
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return h;
}

export interface DiceRollTrayProps {
  /** The already-decided, engine-authoritative dice values (1-6) to land on — see file header. */
  dice: number[];
  colorway: DiceColorway;
  /** Bump this (e.g. `state.roundNumber`) to replay the shake-then-settle; the actual `dice` values driving the landed faces can (and should) already reflect the new round. */
  rollToken: number | string;
  /** Per-die match/wild highlight (see `PerudoDie`'s `ring` prop). */
  ringForIndex?: (index: number) => "match" | "wild" | undefined;
  onRollStart?: () => void;
  onSettled?: () => void;
  size?: DieSize;
}

/** A player's own dice, replaying a short shake-then-settle every time `rollToken` changes, landing on the passed-in `dice` values. See file header for why this replaced the WebGL physics tray. */
export function DiceRollTray({ dice, colorway, rollToken, ringForIndex, onRollStart, onSettled, size = "lg" }: DiceRollTrayProps) {
  const tokenSeed = hashToken(rollToken);

  useEffect(() => {
    onRollStart?.();
    const timeout = setTimeout(() => onSettled?.(), DICE_ROLL_MS + (dice.length - 1) * DIE_STAGGER_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replay only on rollToken change, not every render (dice/callback identities can churn without a new roll)
  }, [rollToken]);

  if (dice.length === 0) return null;
  return (
    <div key={rollToken} className="flex flex-wrap justify-center gap-1.5">
      {dice.map((value, i) => {
        const tilt = tiltFor(tokenSeed * 97 + i * 7);
        return (
          <PerudoDie
            key={i}
            value={value}
            size={size}
            colorway={colorway}
            ring={ringForIndex?.(i)}
            tilt={tilt}
            style={
              {
                animation: `perudo-dice-settle ${DICE_ROLL_MS}ms cubic-bezier(0.22,1,0.36,1) ${i * DIE_STAGGER_MS}ms both`,
                "--tilt": `${tilt}deg`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
