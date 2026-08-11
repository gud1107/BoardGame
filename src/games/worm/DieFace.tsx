import type { Face } from "./engine";

/**
 * Pure inline-CSS die visual — no external image assets, same
 * "<Feature>Icon.tsx" convention as `five-cucumbers/CucumberIcon.tsx` /
 * `lasVegas/DiceIcon.tsx`. Faces 1-5 reuse the classic pip-grid layout;
 * the 6th "지렁이"(worm) face gets its own emoji face instead of a pip count
 * since it isn't a number.
 */

const PIP_LAYOUTS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
};

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

export function DieFace({
  face,
  size = "h-10 w-10",
  className = "",
  dimmed = false,
}: {
  face: Face;
  size?: string;
  className?: string;
  /** Rendered muted/grayscale — used for faces already locked out (`usedFaces`) this turn. */
  dimmed?: boolean;
}) {
  const isWorm = face === "worm";
  return (
    <div
      className={`relative shrink-0 rounded-[22%] border shadow-[0_2px_5px_-1px_rgba(0,0,0,0.6)] transition ${size} ${className} ${
        dimmed ? "opacity-35 grayscale" : ""
      }`}
      style={{
        background: isWorm ? "linear-gradient(160deg,#f472b6 0%,#be185d 100%)" : "linear-gradient(160deg,#fef3c7 0%,#e7d199 100%)",
        borderColor: "rgba(0,0,0,0.35)",
      }}
    >
      {isWorm ? (
        <span className="absolute inset-0 grid place-items-center text-[1.1em] leading-none select-none">🪱</span>
      ) : (
        PIP_LAYOUTS[face].map((i) => {
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
                background: "#1a1a1a",
              }}
            />
          );
        })
      )}
    </div>
  );
}
