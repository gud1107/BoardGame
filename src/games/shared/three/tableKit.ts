"use client";

import { useCallback, useState } from "react";
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

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export type BoardView = "3d" | "2d";

function readView(key: string): BoardView {
  try {
    return window.localStorage.getItem(key) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

/**
 * The board's 3D/2D choice, remembered per game in localStorage. Without
 * WebGL the board is always 2D and `canToggle` is false (hide the button).
 */
export function useBoardView(storageKey: string): { view: BoardView; setView: (v: BoardView) => void; canToggle: boolean } {
  const [hasWebgl] = useState(webglAvailable);
  const [view, setViewState] = useState<BoardView>(() => (typeof window === "undefined" ? "3d" : readView(storageKey)));
  const setView = useCallback(
    (v: BoardView) => {
      setViewState(v);
      try {
        window.localStorage.setItem(storageKey, v);
      } catch {
        /* private mode — keep the in-memory choice */
      }
    },
    [storageKey],
  );
  return { view: hasWebgl ? view : "2d", setView, canToggle: hasWebgl };
}

/** Low detail on narrow / weak devices (fewer segments, no shadows). */
export function preferLowDetail(): boolean {
  if (typeof window === "undefined") return true;
  const cores = navigator.hardwareConcurrency ?? 4;
  return window.innerWidth < 640 || cores < 4;
}

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
  ctx.font = `700 50px ${TEXT_FONT}, ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const shown = [...text].length > 10 ? `${[...text].slice(0, 9).join("")}…` : text;
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
  const key = `${text}|${style.bg}|${style.fg}|${style.border}|${style.size ?? 0}`;
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
  const boxH = lines.length * lineH + pad * 1.3;
  const tail = 26;
  const H = Math.ceil(boxH + tail + 8);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const x0 = (W - boxW) / 2;
  ctx.fillStyle = style.bg;
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(x0, 4, boxW, boxH, 30);
  ctx.moveTo(W / 2 - 18, boxH + 2);
  ctx.lineTo(W / 2, boxH + tail);
  ctx.lineTo(W / 2 + 18, boxH + 2);
  ctx.fill();
  ctx.stroke();
  // hide the stroke seam between box and tail
  ctx.fillRect(W / 2 - 15, boxH - 2, 30, 8);
  ctx.fillStyle = style.fg;
  ctx.font = `700 ${size}px ${TEXT_FONT}, ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 4 + pad * 0.65 + lineH * (i + 0.5)));
  const out = { tex: makeTexture(c), aspect: H / W };
  bubbleCache.set(key, out);
  return out;
}
