"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Drawing kit for explainer scenes. The stage is a fixed 1600×900 canvas
 * (scaled to fit by the player), so scenes place things in plain pixels.
 * Colors here are fixed "video" colors — the frame looks the same in light
 * and dark site themes, like a real video would.
 */
export const STAGE_W = 1600;
export const STAGE_H = 900;

/** Absolutely placed, centred on (x, y). */
export function At({
  x,
  y,
  rot = 0,
  scale = 1,
  opacity = 1,
  z,
  children,
  style,
}: {
  x: number;
  y: number;
  rot?: number;
  scale?: number;
  opacity?: number;
  z?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  if (opacity <= 0.001 || scale <= 0.001) return null;
  return (
    <div
      className="absolute top-0 left-0"
      style={{
        transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${scale})`,
        opacity,
        zIndex: z,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export type FeltTheme = "green" | "wine" | "navy" | "desert" | "wood" | "night";

const FELT: Record<FeltTheme, [string, string]> = {
  green: ["#1f6b4a", "#0b2a1d"],
  wine: ["#6b1f3a", "#2a0b16"],
  navy: ["#1f3f6b", "#0b182a"],
  desert: ["#8a5a2b", "#3a220c"],
  wood: ["#6b4a2b", "#2a1a0b"],
  night: ["#2a2f55", "#0c0e1f"],
};

/** Full-frame table background with a soft vignette. */
export function Felt({ theme = "green", children }: { theme?: FeltTheme; children?: ReactNode }) {
  const [a, b] = FELT[theme];
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(ellipse at 50% 42%, ${a} 0%, ${b} 78%)` }}>
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.08) 0 2px, transparent 2px 6px)" }}
      />
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 220px 40px rgba(0,0,0,.55)" }} />
      {children}
    </div>
  );
}

/** Player seat: avatar disc + name plate. */
export function Seat({
  name,
  emoji,
  color = "#38bdf8",
  active = false,
  dim = false,
  sub,
}: {
  name: string;
  emoji: string;
  color?: string;
  active?: boolean;
  dim?: boolean;
  sub?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2" style={{ opacity: dim ? 0.35 : 1 }}>
      <div
        className="flex h-[92px] w-[92px] items-center justify-center rounded-full text-[52px]"
        style={{
          background: `radial-gradient(circle at 35% 30%, ${color}, #0f172a 85%)`,
          boxShadow: active ? `0 0 0 6px #fde047, 0 0 40px 8px ${color}` : "0 8px 24px rgba(0,0,0,.5)",
        }}
      >
        {emoji}
      </div>
      <div className="rounded-full bg-black/70 px-4 py-1 text-[22px] font-bold whitespace-nowrap text-white">{name}</div>
      {sub}
    </div>
  );
}

/** Comic-style speech bubble (tail pointing down). */
export function Bubble({ children, color = "#ffffff", text = "#0f172a", size = 30 }: { children: ReactNode; color?: string; text?: string; size?: number }) {
  return (
    <div className="relative">
      <div
        className="rounded-[22px] px-6 py-3 font-black whitespace-nowrap shadow-[0_10px_30px_rgba(0,0,0,.45)]"
        style={{ background: color, color: text, fontSize: size }}
      >
        {children}
      </div>
      <div
        className="absolute -bottom-3 left-1/2 h-6 w-6 -translate-x-1/2 rotate-45"
        style={{ background: color }}
      />
    </div>
  );
}

/** Big chapter/scene heading (upper third). */
export function Heading({ children, sub, color = "#fde68a" }: { children: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="text-[64px] leading-tight font-black whitespace-nowrap [text-shadow:0_6px_24px_rgba(0,0,0,.7)]" style={{ color }}>
        {children}
      </div>
      {sub && <div className="text-[30px] font-semibold whitespace-nowrap text-white/85 [text-shadow:0_3px_12px_rgba(0,0,0,.7)]">{sub}</div>}
    </div>
  );
}

/** Rounded info panel. */
export function Panel({ children, w, accent = "#38bdf8", style }: { children: ReactNode; w?: number; accent?: string; style?: CSSProperties }) {
  return (
    <div
      className="rounded-[28px] border-2 bg-black/55 px-8 py-6 text-white shadow-[0_20px_60px_rgba(0,0,0,.5)] backdrop-blur-sm"
      style={{ width: w, borderColor: `${accent}88`, ...style }}
    >
      {children}
    </div>
  );
}

/** Casino-style chip. */
export function Chip({ size = 56, color = "#ef4444", label }: { size?: number; color?: string; label?: ReactNode }) {
  return (
    <div
      className="flex items-center justify-center rounded-full font-black text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `radial-gradient(circle at 50% 50%, ${color} 0 52%, #fff 52% 58%, ${color} 58% 100%)`,
        boxShadow: "0 4px 0 rgba(0,0,0,.35), 0 8px 18px rgba(0,0,0,.4)",
        border: `${Math.max(2, size * 0.07)}px dashed rgba(255,255,255,.85)`,
      }}
    >
      {label}
    </div>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

/** A die face. `wild` paints the 1 face as a gold star (페루도 crest style). */
export function Die({ face, size = 64, color = "#f8fafc", pip = "#0f172a", glow, wild = false }: { face: number; size?: number; color?: string; pip?: string; glow?: string; wild?: boolean }) {
  return (
    <div
      className="relative rounded-[18%]"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, ${color}, #cbd5e1)`,
        boxShadow: glow ? `0 0 0 4px ${glow}, 0 0 24px 6px ${glow}` : "0 6px 14px rgba(0,0,0,.45), inset 0 -4px 0 rgba(0,0,0,.12)",
      }}
    >
      {wild && face === 1 ? (
        <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: size * 0.62, color: "#d97706" }}>
          ★
        </div>
      ) : (
        (PIPS[face] ?? []).map(([x, y], i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{ left: `${x}%`, top: `${y}%`, width: size * 0.18, height: size * 0.18, background: pip, transform: "translate(-50%,-50%)" }}
          />
        ))
      )}
    </div>
  );
}

/** Large ✔ / ✘ stamp. */
export function Stamp({ ok, label }: { ok: boolean; label?: string }) {
  const c = ok ? "#22c55e" : "#ef4444";
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border-[6px] px-6 py-2 text-[54px] font-black"
      style={{ color: c, borderColor: c, background: "rgba(0,0,0,.55)", transform: "rotate(-8deg)" }}
    >
      {ok ? "✔" : "✘"}
      {label && <span className="text-[40px]">{label}</span>}
    </div>
  );
}

/** Straight arrow from (x1,y1) to (x2,y2); `p` draws it progressively. */
export function Arrow({ x1, y1, x2, y2, p = 1, color = "#fde047", width = 8 }: { x1: number; y1: number; x2: number; y2: number; p?: number; color?: string; width?: number }) {
  if (p <= 0) return null;
  const ex = x1 + (x2 - x1) * p;
  const ey = y1 + (y2 - y1) * p;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const h = width * 3;
  return (
    <svg className="pointer-events-none absolute inset-0" width={STAGE_W} height={STAGE_H} style={{ overflow: "visible" }}>
      <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray="1 0" />
      <polygon
        points={`${ex},${ey} ${ex - h * Math.cos(ang - 0.45)},${ey - h * Math.sin(ang - 0.45)} ${ex - h * Math.cos(ang + 0.45)},${ey - h * Math.sin(ang + 0.45)}`}
        fill={color}
      />
    </svg>
  );
}

/** Pulsing highlight ring. */
export function Ring({ size, color = "#fde047", strength = 1 }: { size: number; color?: string; strength?: number }) {
  return (
    <div
      className="rounded-full"
      style={{ width: size, height: size, border: `6px solid ${color}`, boxShadow: `0 0 ${30 * strength}px ${8 * strength}px ${color}`, opacity: 0.5 + 0.5 * strength }}
    />
  );
}

/** Scales a DOM component (e.g. a game's real `CardFace`) up to video size. */
export function Big({ s = 2.2, children }: { s?: number; children: ReactNode }) {
  // `zoom` (not transform) so the enlarged card also takes up its real space in flex rows.
  return <div style={{ zoom: s }}>{children}</div>;
}

/** Label pill. */
export function Tag({ children, color = "#0ea5e9", size = 26 }: { children: ReactNode; color?: string; size?: number }) {
  return (
    <div className="rounded-full px-5 py-1.5 font-black whitespace-nowrap text-white shadow-lg" style={{ background: color, fontSize: size }}>
      {children}
    </div>
  );
}
