import type { SeatIndex } from "./engine";

/**
 * Pure inline-SVG/CSS dice visuals — no external image assets, same
 * "<Feature>Icon.tsx" convention as `five-cucumbers/CucumberIcon.tsx` and
 * `splendor/GemToken.tsx` (ARCHITECTURE.md §2). Perudo's actual WebGL 3D
 * dice are a documented one-off exception for that game only (HANDOFF.md) —
 * this game deliberately stays flat/CSS, matching every other title.
 */

/** Rulebook §1: "5개 색상" — one per seat. Kept ordered/stable so seat 0 is always the same color across a game. */
export const PLAYER_DICE_COLORS: readonly string[] = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#eab308", // gold
  "#22c55e", // green
  "#a855f7", // purple
];

/** Rulebook §2's neutral/"백색" house dice — never a player color. */
export const NEUTRAL_DICE_COLOR = "#9ca3af"; // slate/white-ish

export function diceColorForSeat(seat: SeatIndex): string {
  return PLAYER_DICE_COLORS[seat % PLAYER_DICE_COLORS.length];
}

/** Standard 6-face pip layout, expressed as which of a 3x3 grid's 9 cells are lit. */
const PIP_LAYOUTS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** (left%, top%) center of each of the 3x3 grid's 9 cells, indexed the same as `PIP_LAYOUTS`. Absolute-positioned rather than an actual CSS grid so pip sizing can't get lost to flex/grid stretch quirks at very small die sizes. */
const PIP_POSITIONS: [number, number][] = [
  [22, 22],
  [50, 22],
  [78, 22],
  [22, 50],
  [50, 50],
  [78, 50],
  [22, 78],
  [50, 78],
  [78, 78],
];

/** Picks readable pip ink (near-black vs near-white) against an arbitrary hex background. */
function readableInk(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1a1a" : "#ffffff";
}

export function DiceFace({
  face,
  color,
  size = "h-8 w-8",
  className = "",
  style,
}: {
  face: number;
  color: string;
  size?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const layout = PIP_LAYOUTS[Math.round(face)] ?? PIP_LAYOUTS[1];
  const ink = readableInk(color);
  return (
    <div
      className={`relative shrink-0 rounded-[22%] border shadow-[0_2px_5px_-1px_rgba(0,0,0,0.6)] ${size} ${className}`}
      style={{ background: color, borderColor: "rgba(0,0,0,0.35)", ...style }}
    >
      {layout.map((i) => {
        const [left, top] = PIP_POSITIONS[i];
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              top: `${top}%`,
              transform: "translate(-50%, -50%)",
              width: "20%",
              height: "20%",
              minWidth: 3,
              minHeight: 3,
              borderRadius: "9999px",
              background: ink,
            }}
          />
        );
      })}
    </div>
  );
}
