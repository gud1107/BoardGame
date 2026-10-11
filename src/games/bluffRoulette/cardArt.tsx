import type { CardKind, Suit } from "./engine";

/**
 * Self-designed card faces (rulebook §B — no playing-card art). One set of
 * SVG path data (100×140 box, symbol centred at 50,70) drives both the 2D
 * HUD cards (<svg>) and the 3D card textures (`Path2D` on a canvas), so the
 * two always match.
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

export interface CardArt {
  label: string;
  short: string;
  bg: [string, string];
  fg: string;
  /** Even-odd fill path. */
  path: string;
}

export const CARD_ART: Record<CardKind, CardArt> = {
  sun: {
    label: "해",
    short: "☀",
    bg: ["#fff7e0", "#fde68a"],
    fg: "#d97706",
    path: `${circle(50, 70, 17)} ${polygon(50, 70, 12, 34, 21)}`,
  },
  moon: {
    label: "달",
    short: "🌙",
    bg: ["#eef2ff", "#c7d2fe"],
    fg: "#4338ca",
    // outer big arc bulging left, back along a flatter (larger-radius) arc → crescent
    path: "M62 38 A32 32 0 1 0 62 102 A42 42 0 0 1 62 38 Z",
  },
  star: {
    label: "별",
    short: "★",
    bg: ["#ecfeff", "#a5f3fc"],
    fg: "#0e7490",
    path: polygon(50, 72, 5, 33, 14),
  },
  mask: {
    label: "가면",
    short: "🎭",
    bg: ["#fdf4ff", "#f0abfc"],
    fg: "#a21caf",
    // a face plate with two eye holes and a smile slot (even-odd cuts them out)
    path: "M22 44 Q50 30 78 44 Q80 86 50 104 Q20 86 22 44 Z M33 60 Q38 54 45 60 Q38 64 33 60 Z M55 60 Q62 54 67 60 Q62 64 55 60 Z M38 80 Q50 90 62 80 Q50 86 38 80 Z",
  },
  skull: {
    label: "해골",
    short: "💀",
    bg: ["#f4f4f5", "#a1a1aa"],
    fg: "#18181b",
    path: `M50 36 C28 36 22 54 24 68 C25 76 30 80 34 82 L34 96 L66 96 L66 82 C70 80 75 76 76 68 C78 54 72 36 50 36 Z ${circle(39, 64, 7)} ${circle(61, 64, 7)} M50 72 L45 82 L55 82 Z`,
  },
};

export const SUIT_ORDER: Suit[] = ["sun", "moon", "star"];

/** Card back — a burgundy diamond lattice with a gold revolver-cylinder medallion. */
export const BACK_PATH = `${circle(50, 70, 18)} ${circle(50, 70, 6)} ${[0, 1, 2, 3, 4, 5]
  .map((i) => {
    const a = (i * Math.PI) / 3;
    return circle(50 + Math.cos(a) * 11, 70 + Math.sin(a) * 11, 3.2);
  })
  .join(" ")}`;

export function CardFace({ kind, className = "", dim = false }: { kind: CardKind; className?: string; dim?: boolean }) {
  const art = CARD_ART[kind];
  const id = `brc-${kind}`;
  return (
    <svg viewBox="0 0 100 140" className={className} style={dim ? { opacity: 0.45 } : undefined} aria-label={art.label} role="img">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={art.bg[0]} />
          <stop offset="1" stopColor={art.bg[1]} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="96" height="136" rx="10" fill={`url(#${id})`} stroke="#1c1917" strokeOpacity="0.35" strokeWidth="2" />
      <rect x="8" y="8" width="84" height="124" rx="7" fill="none" stroke={art.fg} strokeOpacity="0.35" strokeWidth="1.5" />
      <path d={art.path} fill={art.fg} fillRule="evenodd" />
      <text x="13" y="24" fontSize="13" fontWeight="800" fill={art.fg}>
        {art.label}
      </text>
    </svg>
  );
}

export function CardBack({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 140" className={className} aria-label="뒷면" role="img">
      <defs>
        <pattern id="brc-lattice" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="14" height="14" fill="#5b1520" />
          <rect width="7" height="7" fill="#6e1b28" />
        </pattern>
      </defs>
      <rect x="2" y="2" width="96" height="136" rx="10" fill="url(#brc-lattice)" stroke="#1c1917" strokeWidth="2" />
      <rect x="8" y="8" width="84" height="124" rx="7" fill="none" stroke="#d4a64a" strokeOpacity="0.7" strokeWidth="1.5" />
      <path d={BACK_PATH} fill="#d4a64a" fillRule="evenodd" />
    </svg>
  );
}

/** Draws the same face onto a 2D canvas (for three.js textures). */
export function paintCard(ctx: CanvasRenderingContext2D, kind: CardKind | "back", w: number, h: number) {
  ctx.save();
  ctx.scale(w / 100, h / 140);
  const rr = (x: number, y: number, ww: number, hh: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, ww, hh, r);
  };
  if (kind === "back") {
    rr(2, 2, 96, 136, 10);
    ctx.fillStyle = "#5b1520";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#6e1b28";
    for (let y = -140; y < 280; y += 14) for (let x = -100; x < 200; x += 14) {
      ctx.save();
      ctx.translate(x + ((y / 14) % 2) * 7, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(0, 0, 7, 7);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = "#d4a64a";
    ctx.lineWidth = 1.5;
    rr(8, 8, 84, 124, 7);
    ctx.stroke();
    ctx.fillStyle = "#d4a64a";
    ctx.fill(new Path2D(BACK_PATH), "evenodd");
  } else {
    const art = CARD_ART[kind];
    const g = ctx.createLinearGradient(0, 0, 40, 140);
    g.addColorStop(0, art.bg[0]);
    g.addColorStop(1, art.bg[1]);
    rr(2, 2, 96, 136, 10);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = art.fg;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    rr(8, 8, 84, 124, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = art.fg;
    ctx.fill(new Path2D(art.path), "evenodd");
    ctx.font = "800 13px sans-serif";
    ctx.fillText(art.label, 13, 24);
  }
  ctx.restore();
}
