"use client";

import * as THREE from "three";

/**
 * Small helpers shared by the "people around a table" 3D boards (코요테,
 * 라이어를 찾아라) and the 3D board games (말달리자, 시티 체이스): WebGL
 * detection, the 🧊 3D / 🖼️ 2D view preference, cached canvas textures for
 * name tags / speech bubbles / emoji, and a few easing helpers.
 *
 * Everything here is presentation only — no game state is ever derived from
 * it, so every device may render at its own frame rate.
 */

export { webglAvailable, useBoardView, preferLowDetail, type BoardView } from "./viewPref";

// ---------------------------------------------------------------------------
// Geometry + easing
// ---------------------------------------------------------------------------

/** Angle of `seat` around a round table with the viewer at angle 0 (toward the camera, +z). */
export function seatAngle(seat: number, viewer: number, n: number): number {
  return ((((seat - viewer) % n) + n) % n) / n * Math.PI * 2;
}

/** Point at radius `r` in the direction of `angle` (angle 0 = +z). */
export function polar(angle: number, r: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r);
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
export const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = clamp01(x);
  return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
};

// ---------------------------------------------------------------------------
// Canvas textures (module-level caches: built once per page)
// ---------------------------------------------------------------------------

const EMOJI_FONT = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
const TEXT_FONT = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif";

function makeTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const labelCache = new Map<string, THREE.CanvasTexture>();
/** Rounded name tag (512×128). */
export function labelTexture(text: string, color: string, opts: { bg?: string; fg?: string } = {}): THREE.CanvasTexture {
  const key = `${text}|${color}|${opts.bg ?? ""}|${opts.fg ?? ""}`;
  let t = labelCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = opts.bg ?? "rgba(12,10,9,0.78)";
  ctx.beginPath();
  ctx.roundRect(8, 20, 496, 88, 44);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = opts.fg ?? "#fef3c7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const shown = [...text].length > 16 ? `${[...text].slice(0, 15).join("")}…` : text;
  // shrink long tags to fit instead of cutting them
  let size = 50;
  for (; size > 30; size -= 2) {
    ctx.font = `700 ${size}px ${TEXT_FONT}, ${EMOJI_FONT}`;
    if (ctx.measureText(shown).width <= 456) break;
  }
  ctx.fillText(shown, 256, 66);
  t = makeTexture(c);
  labelCache.set(key, t);
  return t;
}

const emojiCache = new Map<string, THREE.CanvasTexture>();
/** A bare emoji / short glyph string on a transparent 128px square. */
export function emojiTexture(icon: string): THREE.CanvasTexture {
  let t = emojiCache.get(icon);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.font = `96px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon, 64, 70);
  t = makeTexture(c);
  emojiCache.set(icon, t);
  return t;
}

export interface BubbleStyle {
  bg: string;
  fg: string;
  border: string;
  /** Font px on the 512-wide canvas; long text shrinks automatically. */
  size?: number;
  /** Speaker name drawn as a tab on the bubble's top edge (TableScene fills it in for every seat bubble). */
  who?: string;
  /** Tab colour — the speaker's seat colour; also replaces the border so bubble and seat match. */
  whoColor?: string;
}

const bubbleCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();

/** Word-wrap Korean/latin text to `maxW` (breaks between words, falls back to characters). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width <= maxW || !line.trim()) {
        if (ctx.measureText(test).width > maxW) {
          // a single over-long word: break by character
          for (const ch of word) {
            if (ctx.measureText(line + ch).width > maxW && line) {
              lines.push(line);
              line = ch;
            } else line += ch;
          }
        } else line = test;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.filter((l, i) => l || i === 0);
}

/**
 * A speech bubble with a tail at the bottom centre. Returns the texture and
 * its height/width aspect so the sprite can be scaled without distortion.
 * Cached by text + style (a description never changes once said).
 */
export function bubbleTexture(text: string, style: BubbleStyle): { tex: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${style.bg}|${style.fg}|${style.border}|${style.size ?? 0}|${style.who ?? ""}|${style.whoColor ?? ""}`;
  const hit = bubbleCache.get(key);
  if (hit) return hit;
  const W = 512;
  const pad = 30;
  const probe = document.createElement("canvas").getContext("2d")!;
  let size = style.size ?? 44;
  let lines: string[] = [];
  for (; size >= 24; size -= 4) {
    probe.font = `700 ${size}px ${TEXT_FONT}, ${EMOJI_FONT}`;
    lines = wrap(probe, text, W - pad * 2);
    if (lines.length <= 3) break;
  }
  if (lines.length > 4) lines = [...lines.slice(0, 3), `${lines[3].slice(0, Math.max(1, lines[3].length - 1))}…`];
  probe.font = `700 ${size}px ${TEXT_FONT}, ${EMOJI_FONT}`;
  const textW = Math.max(...lines.map((l) => probe.measureText(l).width));
  const boxW = Math.min(W - 8, Math.max(140, textW + pad * 2));
  const lineH = size * 1.22;
  const boxH = lines.length * lineH + pad * 1.3 + (style.who ? 20 : 0);
  const tail = 26;
  // a name tab sits on the top edge (half above it), so who's talking reads without hunting
  const tabH = style.who ? 82 : 0;
  const top = 4 + tabH / 2;
  const H = Math.ceil(top + boxH + tail + 8);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const x0 = (W - boxW) / 2;
  ctx.fillStyle = style.bg;
  ctx.strokeStyle = style.whoColor ?? style.border;
  ctx.lineWidth = style.whoColor ? 9 : 6;
  ctx.beginPath();
  ctx.roundRect(x0, top, boxW, boxH, 30);
  ctx.moveTo(W / 2 - 18, top + boxH - 2);
  ctx.lineTo(W / 2, top + boxH + tail);
  ctx.lineTo(W / 2 + 18, top + boxH - 2);
  ctx.fill();
  ctx.stroke();
  // hide the stroke seam between box and tail
  ctx.fillRect(W / 2 - 14, top + boxH - 6, 28, 10);
  ctx.fillStyle = style.fg;
  ctx.font = `700 ${size}px ${TEXT_FONT}, ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + pad * 0.65 + lineH * (i + 0.5) + (tabH ? 14 : 0)));
  if (style.who) {
    // bots are named "[Lv.5] AI 봇 3" — the tab only has room for who it is, not the level
    const who = style.who.replace(/^\[[^\]]*\]\s*/, "") || style.who;
    const name = [...who].length > 8 ? `${[...who].slice(0, 7).join("")}…` : who;
    ctx.font = `800 60px ${TEXT_FONT}, ${EMOJI_FONT}`;
    const tw = Math.min(boxW - 40, ctx.measureText(name).width + 40);
    const tx = Math.max(6, x0 + 22);
    const tc = style.whoColor ?? style.border;
    ctx.fillStyle = tc;
    ctx.beginPath();
    ctx.roundRect(tx, 4, tw, tabH - 4, 38);
    ctx.fill();
    // white or near-black lettering, whichever has the higher WCAG contrast on the seat colour
    // (a 0.55 brightness cut put white on #4ade80 green — 1.7:1; best-of-two keeps all ≥ 4.2:1)
    const rgb = new THREE.Color(tc); // linear components
    const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    ctx.fillStyle = 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.061 ? "#ffffff" : "#1c1917";
    ctx.textAlign = "left";
    ctx.fillText(name, tx + 20, 4 + (tabH - 4) / 2 + 2);
  }
  const out = { tex: makeTexture(c), aspect: H / W };
  bubbleCache.set(key, out);
  return out;
}

const paintedCache = new Map<string, THREE.CanvasTexture>();
/**
 * A cached canvas texture painted once by `draw` — card faces, dice pips,
 * table felt patterns. `key` must capture everything `draw` depends on.
 */
export function paintedTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  let t = paintedCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  t = makeTexture(c);
  paintedCache.set(key, t);
  return t;
}

export const FONTS = { emoji: EMOJI_FONT, text: TEXT_FONT };

export interface SimpleCardSpec {
  /** Big centre text (number / name). */
  big?: string;
  /** Emoji / glyph above the big text. */
  icon?: string;
  /** Small caption at the bottom. */
  caption?: string;
  /** Corner index (top-left). */
  corner?: string;
  bg: [string, string];
  edge: string;
  fg?: string;
}

/** A generic painted card face (gradient, double border, icon / big text / caption). Cached by `key`. */
export function simpleCardTexture(key: string, c: SimpleCardSpec): THREE.CanvasTexture {
  return paintedTexture(`card:${key}`, 256, 360, (ctx, W, H) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 22);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, c.bg[0]);
    g.addColorStop(1, c.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    for (let i = -H; i < W + H; i += 24) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(9, 9, W - 18, H - 18, 18);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fg = c.fg ?? "#ffffff";
    const hasIcon = !!c.icon;
    if (c.icon) {
      ctx.font = `${c.big ? 80 : 120}px ${EMOJI_FONT}`;
      ctx.fillText(c.icon, W / 2, c.big ? 92 : H / 2 - 16);
    }
    if (c.big) {
      const len = [...c.big].length;
      const size = len <= 2 ? 128 : len <= 3 ? 96 : len <= 5 ? 58 : 42;
      ctx.fillStyle = fg;
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 10;
      ctx.font = `900 ${size}px ${TEXT_FONT}`;
      ctx.fillText(c.big, W / 2, hasIcon ? 208 : H / 2 - 10);
      ctx.shadowBlur = 0;
    }
    if (c.caption) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `700 ${[...c.caption].length > 6 ? 26 : 32}px ${TEXT_FONT}, ${EMOJI_FONT}`;
      ctx.fillText(c.caption, W / 2, H - 58);
    }
    if (c.corner) {
      ctx.fillStyle = c.edge;
      ctx.font = `800 34px ${TEXT_FONT}`;
      ctx.fillText(c.corner, 40, 44);
    }
  });
}

/** A generic card back: radial gradient, rings and a centre emblem. */
export function simpleBackTexture(key: string, a: string, b: string, edge: string, emblem: string): THREE.CanvasTexture {
  return paintedTexture(`back:${key}`, 256, 360, (ctx, W, H) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 22);
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 3;
    for (let r = 30; r < 220; r += 26) {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(10, 10, W - 20, H - 20, 18);
    ctx.stroke();
    ctx.font = `92px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emblem, W / 2, H / 2 + 6);
  });
}

/**
 * A card face built from a real image (cover-fit into the card) plus an
 * optional number band. Paints a placeholder immediately and repaints once
 * the image loads, so it can be used synchronously from render.
 */
export function imageCardTexture(key: string, src: string, band: { text: string; bg: string; fg: string } | null, edge = "#f5efe0"): THREE.CanvasTexture {
  const id = `img:${key}`;
  const hit = paintedCache.get(id);
  if (hit) return hit;
  const W = 256;
  const H = 360;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const paint = (img: HTMLImageElement | null) => {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.clip();
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, W, H);
    if (img && img.naturalWidth > 0) {
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    }
    ctx.restore();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(5, 5, W - 10, H - 10, 18);
    ctx.stroke();
    if (band) {
      ctx.fillStyle = band.bg;
      ctx.beginPath();
      ctx.roundRect(18, 16, 96, 64, 14);
      ctx.fill();
      ctx.fillStyle = band.fg;
      ctx.font = `900 46px ${TEXT_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(band.text, 66, 50);
    }
  };
  paint(null);
  const t = makeTexture(c);
  paintedCache.set(id, t);
  const img = new Image();
  img.onload = () => {
    paint(img);
    t.needsUpdate = true;
  };
  img.src = src;
  return t;
}
