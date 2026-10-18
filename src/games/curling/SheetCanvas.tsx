"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  aimDir,
  BACK_Y,
  BUTTON_R,
  HACK_Y,
  HOG_Y,
  HOUSE_R,
  NEAR_TEE_Y,
  RELEASE_Y,
  RING_4_R,
  RING_8_R,
  SHEET_HALF,
  STONE_R,
  TEE_Y,
  travelFor,
  type PartyKind,
  type Stone,
} from "./physics";
import { viewStones, type LiveEvent, type LiveStone, type LiveView } from "./live";

/**
 * Top-down sheet (rulebook §1, §16) drawn on a 2D canvas with its own rAF
 * loop — React only hands it refs, so a sliding stone never re-renders the
 * page. The camera frames the far house while aiming (zooming out to fit any
 * guards), cuts to the release point when a stone is thrown and follows it
 * up the sheet like a TV broadcast, then settles back on the house.
 */

export interface AimView {
  aim: number;
  spin: 1 | -1;
  /** Weight while the gauge is held (0..1), else null. */
  charge: number | null;
  side: number;
  kind: PartyKind | null;
  interactive: boolean;
}

/** A teammate's skip call (§17) drawn on the sheet. */
export interface CallMark {
  seat: number;
  side: number;
  x: number;
  y: number;
  tag: "draw" | "guard" | "hit";
  name: string;
  /** Called by a bot teammate (🤖 AI 스킵) — each player can hide these. */
  bot?: boolean;
}
export const CALL_TAGS: Record<CallMark["tag"], { emoji: string; label: string }> = {
  draw: { emoji: "🎯", label: "여기 붙여!" },
  guard: { emoji: "🛡️", label: "가드!" },
  hit: { emoji: "💥", label: "쳐내!" },
};

export interface MeasureView {
  scorer: number | null;
  counting: number[];
}

export const SIDE_COLORS = ["#ef4444", "#facc15", "#3b82f6", "#22c55e", "#a855f7", "#f97316"];
export const SIDE_NAMES_TEAM = ["레드", "옐로"];
export const SIDE_NAMES_FFA = ["빨강", "노랑", "파랑", "초록", "보라", "주황"];
export const SIDE_SYMBOLS = ["●", "◆", "▲", "■", "★", "✚"];
export const PARTY_EMOJI: Record<PartyKind, string> = { heavy: "🐘", bomb: "💣", sticky: "🍯", swirl: "🌀", ghost: "👻", magnet: "🧲" };

interface Props {
  stones: readonly Stone[];
  live: MutableRefObject<LiveView | null>;
  aim: MutableRefObject<AimView | null>;
  measure: MeasureView | null;
  onAim?: (aim: number) => void;
  /** Tap on the sheet (world meters) when not aiming — skip calls. */
  onTap?: (x: number, y: number) => void;
  calls?: readonly CallMark[];
  /** Delivered stone speed 0..1 every frame it moves (rumble SFX). */
  onSlide?: (speed: number) => void;
  /** Each FX-worthy event once (sound). */
  onEvent?: (e: LiveEvent) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}
interface Ring {
  x: number;
  y: number;
  r: number;
  grow: number;
  life: number;
  max: number;
  color: string;
}

const VIEW_TOP = BACK_Y - 0.62;
const VIEW_W = SHEET_HALF * 2 + 0.55;
const MINI_W = 16;

function makePebble(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 160;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#eef6fb";
  g.fillRect(0, 0, 160, 160);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 520; i++) {
    const x = rnd() * 160;
    const y = rnd() * 160;
    const r = 0.4 + rnd() * 1.1;
    g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.9)" : "rgba(148,180,205,0.22)";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // faint scratches from earlier sweeping
  g.strokeStyle = "rgba(160,190,210,0.12)";
  g.lineWidth = 0.6;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const x = rnd() * 160;
    g.moveTo(x, rnd() * 160);
    g.lineTo(x + (rnd() - 0.5) * 30, rnd() * 160);
    g.stroke();
  }
  return c;
}

/** Shape path for a side (§1): ● ◆ ▲ ■ ★ ✚ — so teams never rely on color alone. */
function shapePath(g: CanvasRenderingContext2D, side: number, k: number) {
  g.beginPath();
  switch (side % 6) {
    case 0:
      g.arc(0, 0, k, 0, Math.PI * 2);
      break;
    case 1:
      g.moveTo(0, -k * 1.25);
      g.lineTo(k * 1.05, 0);
      g.lineTo(0, k * 1.25);
      g.lineTo(-k * 1.05, 0);
      break;
    case 2:
      g.moveTo(0, -k * 1.2);
      g.lineTo(k * 1.15, k * 0.9);
      g.lineTo(-k * 1.15, k * 0.9);
      break;
    case 3:
      g.rect(-k, -k, k * 2, k * 2);
      break;
    case 4:
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * i) / 5 - Math.PI / 2;
        const rr = i % 2 === 0 ? k * 1.35 : k * 0.6;
        if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      break;
    default:
      g.rect(-k * 0.38, -k * 1.2, k * 0.76, k * 2.4);
      g.rect(-k * 1.2, -k * 0.38, k * 2.4, k * 0.76);
  }
  g.closePath();
}

/** Bright caps (yellow/green/orange) get a dark symbol, dark caps a white one. */
const DARK_ON_CAP = SIDE_COLORS.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.3;
});

function drawSymbol(g: CanvasRenderingContext2D, side: number, r: number) {
  const dark = DARK_ON_CAP[side % 6];
  shapePath(g, side, r * 0.46);
  g.lineJoin = "round";
  g.strokeStyle = dark ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.75)";
  g.lineWidth = Math.max(1, r * 0.1);
  g.stroke();
  g.fillStyle = dark ? "#0f172a" : "#ffffff";
  g.fill();
}

function drawStone(g: CanvasRenderingContext2D, sx: number, sy: number, r: number, s: LiveStone | Stone, alpha = 1) {
  const color = SIDE_COLORS[s.side % SIDE_COLORS.length];
  const ghost = "ghost" in s && s.ghost;
  g.save();
  g.globalAlpha = alpha * (ghost ? 0.45 : 1);
  // shadow
  g.fillStyle = "rgba(15,30,50,0.28)";
  g.beginPath();
  g.ellipse(sx + r * 0.14, sy + r * 0.2, r * 1.04, r * 0.98, 0, 0, Math.PI * 2);
  g.fill();
  // granite body
  const body = g.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r);
  body.addColorStop(0, "#d4d8de");
  body.addColorStop(0.55, "#8d939c");
  body.addColorStop(1, "#4b5260");
  g.fillStyle = body;
  g.beginPath();
  g.arc(sx, sy, r, 0, Math.PI * 2);
  g.fill();
  // granite speckles
  g.fillStyle = "rgba(40,44,52,0.35)";
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39 + (s.id % 7);
    const d = r * (0.82 + ((i * 37) % 10) / 70);
    g.beginPath();
    g.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d, Math.max(0.5, r * 0.05), 0, Math.PI * 2);
    g.fill();
  }
  // colored cap
  const cap = g.createRadialGradient(sx - r * 0.2, sy - r * 0.25, r * 0.05, sx, sy, r * 0.72);
  cap.addColorStop(0, "#ffffff");
  cap.addColorStop(0.18, color);
  cap.addColorStop(1, color);
  g.fillStyle = cap;
  g.beginPath();
  g.arc(sx, sy, r * 0.7, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = Math.max(0.6, r * 0.06);
  g.stroke();
  // handle
  g.translate(sx, sy);
  g.rotate(s.angle);
  g.fillStyle = "rgba(20,24,32,0.45)";
  const hw = r * 1.05;
  const hh = r * 0.18;
  g.beginPath();
  g.roundRect(-hw / 2, -hh / 2, hw, hh, hh / 2);
  g.fill();
  g.rotate(-s.angle);
  drawSymbol(g, s.side, r);
  g.restore();
  if (s.kind && r > 5) {
    g.save();
    g.globalAlpha = alpha;
    g.font = `${Math.max(9, r * 0.9)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(PARTY_EMOJI[s.kind], sx + r * 0.78, sy - r * 0.78);
    g.restore();
  }
}

function drawHouse(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const rings: [number, string][] = [
    [HOUSE_R, "#2563eb"],
    [RING_8_R, "#f8fafc"],
    [RING_4_R, "#dc2626"],
    [BUTTON_R, "#f8fafc"],
  ];
  for (const [r, c] of rings) {
    g.fillStyle = c;
    g.globalAlpha = c === "#f8fafc" ? 0.95 : 0.82;
    g.beginPath();
    g.arc(cx, cy, r * s, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

export default function SheetCanvas({ stones, live, aim, measure, onAim, onTap, calls, onSlide, onEvent }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ stones, measure, onAim, onTap, calls, onSlide, onEvent });
  useEffect(() => {
    propsRef.current = { stones, measure, onAim, onTap, calls, onSlide, onEvent };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const pebble = makePebble();
    const pattern = pebble ? g.createPattern(pebble, "repeat") : null;
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const cam = { top: VIEW_TOP, scale: 0, inited: false };
    let particles: Particle[] = [];
    let rings: Ring[] = [];
    let shake = 0;
    let trail: { x: number; y: number }[] = [];
    let trailTurn = -1;
    let lastT = performance.now();
    let raf = 0;

    const spawn = (x: number, y: number, n: number, color: string, speed: number, size: number, life = 0.6) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: size * (0.5 + Math.random()) });
      }
    };

    const consume = (e: LiveEvent) => {
      propsRef.current.onEvent?.(e);
      switch (e.kind) {
        case "hit": {
          const k = Math.min(1, e.power / 5);
          rings.push({ x: e.x, y: e.y, r: 0.05, grow: 1.6 + k * 2, life: 0.45, max: 0.45, color: "rgba(255,255,255,0.9)" });
          spawn(e.x, e.y, 6 + Math.round(k * 12), "#fde68a", 1.5 + k * 3, 0.04);
          shake = Math.max(shake, k * 6);
          break;
        }
        case "out":
          spawn(e.x, e.y, 10, "#e0f2fe", 1.2, 0.05, 0.8);
          break;
        case "bomb":
          rings.push({ x: e.x, y: e.y, r: 0.1, grow: 4.5, life: 0.7, max: 0.7, color: "rgba(251,146,60,0.95)" });
          rings.push({ x: e.x, y: e.y, r: 0.1, grow: 2.6, life: 0.9, max: 0.9, color: "rgba(254,240,138,0.9)" });
          spawn(e.x, e.y, 46, "#fb923c", 4.5, 0.07, 0.9);
          spawn(e.x, e.y, 24, "#475569", 2.5, 0.06, 1.2);
          shake = 14;
          break;
        case "stick":
          spawn(e.x, e.y, 18, "#f59e0b", 1.1, 0.07, 0.9);
          rings.push({ x: e.x, y: e.y, r: 0.12, grow: 0.9, life: 0.6, max: 0.6, color: "rgba(245,158,11,0.9)" });
          break;
        case "solid":
          rings.push({ x: e.x, y: e.y, r: 0.15, grow: 1.2, life: 0.5, max: 0.5, color: "rgba(196,181,253,0.9)" });
          break;
        default:
          break;
      }
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const { stones: resting, measure: meas } = propsRef.current;
      const lv = live.current;
      const av = aim.current;

      // FX events from the live throw
      if (lv && lv.pending.length) {
        const evs = lv.pending.splice(0);
        for (const e of evs) consume(e);
      }

      const showLive = !!lv && lv.snaps.length > 0;
      const shown: LiveStone[] = showLive ? viewStones(lv!) : resting.map((s) => ({ ...s, ghost: false }));
      const delivered = showLive ? shown.find((s) => s.id === lv!.deliveredId) : undefined;
      const following = showLive && !lv!.done && !!delivered;

      // trail of the delivered stone
      if (lv && lv.turn !== trailTurn) {
        trailTurn = lv.turn;
        trail = [];
      }
      if (following && delivered) {
        const last = trail[trail.length - 1];
        if (!last || Math.abs(last.y - delivered.y) + Math.abs(last.x - delivered.x) > 0.12) trail.push({ x: delivered.x, y: delivered.y });
        if (trail.length > 400) trail.shift();
      }

      // camera
      const usableW = W - MINI_W - 4;
      let targetScale: number;
      let targetTop: number;
      if (following && delivered) {
        targetScale = Math.min(usableW / VIEW_W, H / 5.2);
        const viewH = H / targetScale;
        targetTop = Math.max(VIEW_TOP, delivered.y - viewH * 0.6);
      } else {
        let bottom = 2.4;
        for (const s of shown) if (s.y < HOG_Y + 1.2) bottom = Math.max(bottom, s.y + 0.7);
        if (av?.charge !== null && av?.charge !== undefined) {
          const d = aimDir(av.aim);
          const stopY = RELEASE_Y + d.y * travelFor(av.charge);
          if (stopY > VIEW_TOP) bottom = Math.max(bottom, Math.min(HOG_Y + 1.5, stopY + 0.7));
        }
        bottom = Math.min(bottom, HOG_Y + 1.6);
        targetScale = Math.min(usableW / VIEW_W, H / (bottom - VIEW_TOP));
        targetTop = VIEW_TOP;
      }
      if (!cam.inited) {
        cam.scale = targetScale;
        cam.top = targetTop;
        cam.inited = true;
      }
      if (Math.abs(targetTop - cam.top) > 12) cam.top = targetTop; // TV cut to the release
      else cam.top += (targetTop - cam.top) * Math.min(1, dt * (following ? 9 : 3.2));
      cam.scale += (targetScale - cam.scale) * Math.min(1, dt * 3.2);
      const s = cam.scale;
      const top = cam.top;
      const cx = usableW / 2;
      shake *= Math.pow(0.02, dt);
      const shx = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
      const shy = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
      const X = (x: number) => cx + x * s + shx;
      const Y = (y: number) => (y - top) * s + shy;
      const viewBottom = top + H / s;

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // arena
      g.fillStyle = "#0f172a";
      g.fillRect(0, 0, W, H);
      // boards (LED strips)
      const bw = 0.16 * s;
      g.fillStyle = "#1e293b";
      g.fillRect(X(-SHEET_HALF) - bw, 0, bw, H);
      g.fillRect(X(SHEET_HALF), 0, bw, H);
      g.fillStyle = "rgba(56,189,248,0.55)";
      g.fillRect(X(-SHEET_HALF) - bw * 0.35, 0, bw * 0.18, H);
      g.fillRect(X(SHEET_HALF) + bw * 0.17, 0, bw * 0.18, H);
      // ice
      g.save();
      g.beginPath();
      g.rect(X(-SHEET_HALF), 0, SHEET_HALF * 2 * s, H);
      g.clip();
      if (pattern) {
        g.translate(X(-SHEET_HALF), Y(0));
        g.fillStyle = pattern;
        g.fillRect(0, -Y(0), SHEET_HALF * 2 * s, H);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      } else {
        g.fillStyle = "#eef6fb";
        g.fillRect(X(-SHEET_HALF), 0, SHEET_HALF * 2 * s, H);
      }
      // painted logo mid-sheet
      if (17 > top - 3 && 17 < viewBottom + 3) {
        g.save();
        g.translate(X(0), Y(17));
        g.rotate(-Math.PI / 2);
        g.font = `900 ${1.1 * s}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "rgba(59,130,246,0.13)";
        g.fillText("CURLING PARTY 🥌", 0, 0);
        g.restore();
      }
      // houses
      if (HOUSE_R > top - 2 && -HOUSE_R < viewBottom) drawHouse(g, X(0), Y(0), s);
      if (NEAR_TEE_Y + HOUSE_R > top && NEAR_TEE_Y - HOUSE_R < viewBottom) drawHouse(g, X(0), Y(NEAR_TEE_Y), s);
      // lines
      const hline = (y: number, color: string, width: number) => {
        if (y < top - 1 || y > viewBottom + 1) return;
        g.fillStyle = color;
        g.fillRect(X(-SHEET_HALF), Y(y) - (width * s) / 2, SHEET_HALF * 2 * s, Math.max(1, width * s));
      };
      g.fillStyle = "rgba(30,41,59,0.55)";
      g.fillRect(X(0) - 0.5, Y(BACK_Y - 1.83), 1, Y(HACK_Y) - Y(BACK_Y - 1.83));
      hline(TEE_Y, "rgba(30,41,59,0.6)", 0.02);
      hline(BACK_Y, "rgba(30,41,59,0.7)", 0.02);
      hline(HOG_Y, "#dc2626", 0.1);
      hline(RELEASE_Y, "#dc2626", 0.1);
      hline(NEAR_TEE_Y, "rgba(30,41,59,0.6)", 0.02);
      hline(NEAR_TEE_Y + 1.83, "rgba(30,41,59,0.7)", 0.02);
      // hack
      if (HACK_Y > top && HACK_Y < viewBottom + 1) {
        g.fillStyle = "#111827";
        g.fillRect(X(-0.2), Y(HACK_Y) - 0.1 * s, 0.14 * s, 0.2 * s);
        g.fillRect(X(0.06), Y(HACK_Y) - 0.1 * s, 0.14 * s, 0.2 * s);
      }

      // trail
      if (trail.length > 1) {
        g.strokeStyle = "rgba(148,163,184,0.45)";
        g.lineWidth = Math.max(1, STONE_R * s * 0.5);
        g.lineCap = "round";
        g.beginPath();
        trail.forEach((p, i) => (i === 0 ? g.moveTo(X(p.x), Y(p.y)) : g.lineTo(X(p.x), Y(p.y))));
        if (delivered && following) g.lineTo(X(delivered.x), Y(delivered.y));
        g.stroke();
      }

      // aim line + broom
      if (av && !following) {
        const d = aimDir(av.aim);
        const color = SIDE_COLORS[av.side % SIDE_COLORS.length];
        g.save();
        g.setLineDash([6, 6]);
        g.strokeStyle = "rgba(15,23,42,0.45)";
        g.lineWidth = 2;
        g.beginPath();
        // from the bottom of the view to the broom
        const t0 = (viewBottom - RELEASE_Y) / d.y;
        g.moveTo(X(d.x * Math.max(0, t0)), Y(RELEASE_Y + d.y * Math.max(0, t0)));
        g.lineTo(X(av.aim), Y(0));
        g.stroke();
        g.setLineDash([]);
        // curl hint: a hooked arrow toward the spin side
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.beginPath();
        const bx = X(av.aim);
        const by = Y(0);
        const hook = av.spin * 0.9 * s;
        g.moveTo(bx - hook * 0.15, by + 1.6 * s);
        g.quadraticCurveTo(bx, by + 0.4 * s, bx + hook, by + 0.2 * s);
        g.stroke();
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(bx + hook, by + 0.2 * s);
        g.lineTo(bx + hook - av.spin * 0.22 * s, by + 0.02 * s);
        g.lineTo(bx + hook - av.spin * 0.16 * s, by + 0.42 * s);
        g.closePath();
        g.fill();
        // broom head
        g.translate(bx, by);
        g.fillStyle = "#1f2937";
        g.fillRect(-0.03 * s, 0, 0.06 * s, 0.9 * s);
        g.fillStyle = color;
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.lineWidth = 1.5;
        g.beginPath();
        g.roundRect(-0.22 * s, -0.08 * s, 0.44 * s, 0.16 * s, 0.05 * s);
        g.fill();
        g.stroke();
        g.restore();
        // predicted straight stop while charging
        if (av.charge !== null) {
          const t = travelFor(av.charge);
          const px = d.x * t;
          const py = RELEASE_Y + d.y * t;
          if (py > top - 1 && py < viewBottom + 1) {
            g.save();
            g.strokeStyle = color;
            g.setLineDash([4, 3]);
            g.lineWidth = 2;
            g.beginPath();
            g.arc(X(px), Y(py), STONE_R * s * 1.15, 0, Math.PI * 2);
            g.stroke();
            g.restore();
          } else if (py <= top - 1) {
            g.fillStyle = color;
            g.font = "bold 12px system-ui";
            g.textAlign = "center";
            g.fillText("▲ 하우스 너머", X(0), 14);
          }
        }
      }

      // skip calls (§17)
      const marks = propsRef.current.calls;
      if (marks && marks.length && !following) {
        for (const c of marks) {
          if (c.y < top - 1 || c.y > viewBottom + 1) continue;
          const col = SIDE_COLORS[c.side % SIDE_COLORS.length];
          const cxp = X(c.x);
          const cyp = Y(c.y);
          const rr = STONE_R * s * (1.25 + 0.15 * Math.sin(now / 160));
          g.save();
          g.setLineDash([4, 3]);
          g.strokeStyle = col;
          g.lineWidth = 2.5;
          g.beginPath();
          g.arc(cxp, cyp, rr, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          const label = `${CALL_TAGS[c.tag].emoji} ${c.name}`;
          g.font = "bold 11px system-ui, sans-serif";
          const tw = g.measureText(label).width + 10;
          const bx = Math.min(Math.max(cxp - tw / 2, 2), usableW - tw - 2);
          g.fillStyle = "rgba(15,23,42,0.82)";
          g.beginPath();
          g.roundRect(bx, cyp - rr - 19, tw, 16, 8);
          g.fill();
          g.fillStyle = "#fff";
          g.textAlign = "left";
          g.textBaseline = "middle";
          g.fillText(label, bx + 5, cyp - rr - 11);
          g.restore();
        }
      }

      // measure (scored phase): lines from the button to counting stones
      if (meas && meas.counting.length) {
        g.save();
        g.strokeStyle = "rgba(15,23,42,0.6)";
        g.lineWidth = 1.5;
        g.setLineDash([3, 3]);
        meas.counting.forEach((id) => {
          const st = shown.find((x) => x.id === id);
          if (!st) return;
          g.beginPath();
          g.moveTo(X(0), Y(0));
          g.lineTo(X(st.x), Y(st.y));
          g.stroke();
        });
        g.restore();
      }

      // stones
      const r = STONE_R * s;
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      for (const st of shown) {
        if (st.y < top - 1 || st.y > viewBottom + 1) continue;
        const counted = meas?.counting.indexOf(st.id) ?? -1;
        if (counted >= 0) {
          g.fillStyle = `rgba(250,204,21,${0.35 + 0.35 * pulse})`;
          g.beginPath();
          g.arc(X(st.x), Y(st.y), r * 1.55, 0, Math.PI * 2);
          g.fill();
        }
        drawStone(g, X(st.x), Y(st.y), r, st);
        if (counted >= 0) {
          g.fillStyle = "#0f172a";
          g.beginPath();
          g.arc(X(st.x) + r, Y(st.y) + r, Math.max(7, r * 0.55), 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#fde047";
          g.font = `bold ${Math.max(9, r * 0.7)}px system-ui`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(String(counted + 1), X(st.x) + r, Y(st.y) + r + 0.5);
        }
      }

      // sweepers in front of the delivered stone
      if (following && delivered && lv) {
        const sw = Math.max(lv.sweep.own, lv.sweep.opp);
        const prev = trail[trail.length - 2] ?? { x: delivered.x, y: delivered.y + 1 };
        let dx = delivered.x - prev.x;
        let dy = delivered.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= len;
        dy /= len;
        const speed = Math.min(1, len / 0.25);
        propsRef.current.onSlide?.(speed);
        if (sw > 0.05) {
          const brooms = lv.sweep.own > 0.05 && lv.sweep.opp > 0.05 ? 2 : 1;
          for (let b = 0; b < brooms; b++) {
            const side = b === 0 && lv.sweep.own > 0.05 ? lv.side : lv.side === 0 ? 1 : 0;
            const ahead = 0.42 + b * 0.22;
            const wig = Math.sin(now / (b ? 55 : 48) + b) * 0.18 * (0.4 + sw * 0.6);
            const bx = delivered.x + dx * ahead + -dy * wig;
            const by = delivered.y + dy * ahead + dx * wig;
            g.save();
            g.translate(X(bx), Y(by));
            g.rotate(Math.atan2(dy, dx) + Math.PI / 2);
            g.fillStyle = SIDE_COLORS[side % SIDE_COLORS.length];
            g.strokeStyle = "rgba(0,0,0,0.45)";
            g.lineWidth = 1;
            g.beginPath();
            g.roundRect(-0.2 * s, -0.06 * s, 0.4 * s, 0.12 * s, 0.04 * s);
            g.fill();
            g.stroke();
            g.restore();
            if (Math.random() < sw * 0.9) spawn(bx, by, 1, "rgba(224,242,254,0.95)", 0.6, 0.035, 0.45);
          }
        }
      }

      // particles + rings
      particles = particles.filter((p) => (p.life -= dt) > 0);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
        g.globalAlpha = Math.max(0, p.life / p.max);
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(X(p.x), Y(p.y), Math.max(1, p.size * s), 0, Math.PI * 2);
        g.fill();
      }
      rings = rings.filter((q) => (q.life -= dt) > 0);
      for (const q of rings) {
        const k = 1 - q.life / q.max;
        g.globalAlpha = 1 - k;
        g.strokeStyle = q.color;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(X(q.x), Y(q.y), (q.r + q.grow * k) * s, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.restore();

      // minimap (full sheet)
      const mx = W - MINI_W - 2;
      const my0 = 6;
      const my1 = H - 6;
      const mTop = VIEW_TOP;
      const mBot = HACK_Y + 0.5;
      const MY = (y: number) => my0 + ((y - mTop) / (mBot - mTop)) * (my1 - my0);
      const MX = (x: number) => mx + MINI_W / 2 + (x / SHEET_HALF) * (MINI_W / 2 - 1);
      g.fillStyle = "rgba(226,240,250,0.92)";
      g.beginPath();
      g.roundRect(mx, my0, MINI_W, my1 - my0, 3);
      g.fill();
      g.fillStyle = "#3b82f6";
      const hrx = (HOUSE_R / SHEET_HALF) * (MINI_W / 2 - 1);
      const hry = Math.max(2, (HOUSE_R / (mBot - mTop)) * (my1 - my0));
      for (const ty of [0, NEAR_TEE_Y]) {
        g.beginPath();
        g.ellipse(MX(0), MY(ty), hrx, hry, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#dc2626";
      g.fillRect(mx, MY(HOG_Y) - 0.5, MINI_W, 1.5);
      g.fillRect(mx, MY(RELEASE_Y) - 0.5, MINI_W, 1.5);
      for (const st of shown) {
        g.save();
        g.translate(MX(st.x), MY(st.y));
        shapePath(g, st.side, 2.6);
        g.fillStyle = SIDE_COLORS[st.side % SIDE_COLORS.length];
        g.fill();
        g.strokeStyle = "rgba(15,23,42,0.85)";
        g.lineWidth = 0.8;
        g.stroke();
        g.restore();
      }
      g.strokeStyle = "rgba(15,23,42,0.8)";
      g.lineWidth = 1;
      g.strokeRect(mx + 0.5, MY(top), MINI_W - 1, Math.max(3, MY(viewBottom) - MY(top)));
    };
    raf = requestAnimationFrame(frame);

    // aiming by dragging anywhere on the sheet
    let dragging = false;
    const toAim = (clientX: number) => {
      const r = canvas.getBoundingClientRect();
      const usableW = W - MINI_W - 4;
      const x = (clientX - r.left - usableW / 2) / (cam.scale || 1);
      propsRef.current.onAim?.(Math.max(-2.2, Math.min(2.2, Math.round(x * 100) / 100)));
    };
    const down = (e: PointerEvent) => {
      const tap = propsRef.current.onTap;
      if (tap && !(aim.current?.interactive && propsRef.current.onAim)) {
        const r = canvas.getBoundingClientRect();
        const usableW = W - MINI_W - 4;
        const sc = cam.scale || 1;
        const x = (e.clientX - r.left - usableW / 2) / sc;
        const y = (e.clientY - r.top) / sc + cam.top;
        if (Math.abs(x) <= SHEET_HALF) tap(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
        return;
      }
      if (!aim.current?.interactive || !propsRef.current.onAim) return;
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      toAim(e.clientX);
    };
    const move = (e: PointerEvent) => {
      if (dragging) toAim(e.clientX);
    };
    const up = () => {
      dragging = false;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [live, aim]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-pan-y select-none" aria-label="컬링 시트" />
    </div>
  );
}

