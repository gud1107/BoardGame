import * as THREE from "three";
import { HALF_W, HEAD_Y, PIT_Y } from "../physics";

/** Seat colours + shape marks (rulebook §2) — the mark tells balls apart without colour. */
export const SEAT_COLORS = ["#e8473c", "#2f7de1", "#f2b21b", "#3fae5a", "#a35be0", "#ef7fb4"];
export const SEAT_MARKS = ["●", "◆", "▲", "■", "★", "✚"];
export const SEAT_NAMES = ["빨강", "파랑", "노랑", "초록", "보라", "분홍"];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function done(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Lane length the lane texture spans (foul line → pit). */
export const LANE_TEX_LEN = PIT_Y;

/**
 * Maple/pine lane boards with the targeting marks real lanes have (§4): the
 * dots at 2.1 m, the seven arrows at 4.6 m, the foul line, and the pin spots.
 * v = 0 at the foul line, v = 1 at the pit.
 */
export function laneTexture(): THREE.CanvasTexture {
  const W = 156;
  const H = 3072;
  const [c, g] = canvas(W, H);
  const boards = 39;
  const bw = W / boards;
  for (let b = 0; b < boards; b++) {
    const shade = 0.9 + ((b * 7919) % 13) / 100;
    g.fillStyle = `rgb(${Math.round(222 * shade)}, ${Math.round(178 * shade)}, ${Math.round(120 * shade)})`;
    g.fillRect(b * bw, 0, bw + 0.5, H);
    g.fillStyle = "rgba(90,50,20,0.25)";
    g.fillRect(b * bw, 0, 0.6, H);
  }
  // grain streaks
  for (let i = 0; i < 900; i++) {
    const x = ((i * 1103515245) % W + W) % W;
    const y = ((i * 12345 + i * i * 31) % H + H) % H;
    g.fillStyle = `rgba(120,70,30,${0.04 + (i % 5) * 0.01})`;
    g.fillRect(x, y, 0.7, 20 + (i % 9) * 6);
  }
  const yPx = (m: number) => H - (m / LANE_TEX_LEN) * H;
  // the pin deck is a little paler
  g.fillStyle = "rgba(255,245,225,0.18)";
  g.fillRect(0, 0, W, yPx(HEAD_Y - 0.5));
  // foul line
  g.fillStyle = "#2b1508";
  g.fillRect(0, yPx(0.03), W, 6);
  // dots (2.1 m) and arrows (4.6 m) on boards 3,5,8,11,14 … mirrored
  const boardX = (n: number) => W - (n - 0.5) * bw;
  g.fillStyle = "#3b1c0b";
  for (const n of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
    g.beginPath();
    g.arc(boardX(n), yPx(2.1), bw * 0.32, 0, Math.PI * 2);
    g.fill();
  }
  for (const n of [5, 10, 15, 20, 25, 30, 35]) {
    const x = boardX(n);
    const y = yPx(4.6);
    g.beginPath();
    g.moveTo(x, y - 34);
    g.lineTo(x - bw * 0.65, y + 8);
    g.lineTo(x + bw * 0.65, y + 8);
    g.closePath();
    g.fill();
  }
  return done(c);
}

/** Approach (where the bowler walks) — wider, darker boards. */
export function approachTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  for (let b = 0; b < 24; b++) {
    const shade = 0.82 + ((b * 31) % 7) / 50;
    g.fillStyle = `rgb(${Math.round(196 * shade)}, ${Math.round(150 * shade)}, ${Math.round(98 * shade)})`;
    g.fillRect((b * 256) / 24, 0, 256 / 24 + 0.5, 256);
  }
  g.fillStyle = "#3b1c0b";
  for (const x of [40, 80, 128, 176, 216]) {
    g.beginPath();
    g.arc(x, 128, 4, 0, Math.PI * 2);
    g.fill();
  }
  return done(c);
}

/** Bowling ball skin: seat colour swirl, the seat mark, three finger holes. */
export function ballTexture(seat: number): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const base = SEAT_COLORS[seat % SEAT_COLORS.length];
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  // marbled swirl
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = i % 2 ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.14)";
    g.lineWidth = 3 + (i % 5) * 2;
    g.beginPath();
    const y = (i * 37) % 256;
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin((x + i * 23) / 40) * 18);
    g.stroke();
  }
  // seat mark, twice around the equator so one always shows
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 4;
  g.font = "bold 70px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const x of [128, 384]) {
    g.strokeText(SEAT_MARKS[seat % SEAT_MARKS.length], x, 128);
    g.fillText(SEAT_MARKS[seat % SEAT_MARKS.length], x, 128);
  }
  // finger holes
  g.fillStyle = "#0b0b0d";
  for (const [x, y, r] of [
    [250, 96, 11],
    [276, 96, 11],
    [263, 150, 13],
  ] as const) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return done(c);
}

/** Pin profile (radius, height) from base to crown — regulation-ish proportions, 38 cm tall. */
export const PIN_PROFILE: [number, number][] = [
  [0.0, 0.0],
  [0.026, 0.0],
  [0.036, 0.02],
  [0.05, 0.06],
  [0.058, 0.1],
  [0.0605, 0.12],
  [0.058, 0.15],
  [0.049, 0.19],
  [0.036, 0.225],
  [0.026, 0.25],
  [0.023, 0.265],
  [0.025, 0.285],
  [0.031, 0.31],
  [0.032, 0.33],
  [0.028, 0.355],
  [0.017, 0.374],
  [0.0, 0.381],
];
export const PIN_H = 0.381;

/** White pin with the two red neck stripes; v follows the profile points. */
export function pinTexture(tint = "#fbfaf6"): THREE.CanvasTexture {
  const [c, g] = canvas(8, 256);
  const n = PIN_PROFILE.length;
  for (let y = 0; y < 256; y++) {
    const v = 1 - y / 255;
    const f = v * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const h = PIN_PROFILE[i][1] + (PIN_PROFILE[i + 1][1] - PIN_PROFILE[i][1]) * (f - i);
    const red = (h > 0.236 && h < 0.249) || (h > 0.257 && h < 0.27);
    g.fillStyle = red ? "#d1202a" : tint;
    g.fillRect(0, y, 8, 1);
  }
  return done(c);
}

/** Red/white candy stripes for bumper rails. */
export function stripeTexture(a = "#ff4d4d", b = "#ffffff"): THREE.CanvasTexture {
  const [c, g] = canvas(64, 8);
  g.fillStyle = a;
  g.fillRect(0, 0, 32, 8);
  g.fillStyle = b;
  g.fillRect(32, 0, 32, 8);
  const t = done(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Oil slick: dark sheen with rainbow edges. */
export function oilTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const grad = g.createRadialGradient(64, 128, 10, 64, 128, 128);
  grad.addColorStop(0, "rgba(20,14,30,0.85)");
  grad.addColorStop(0.55, "rgba(40,25,60,0.7)");
  grad.addColorStop(0.75, "rgba(120,60,200,0.45)");
  grad.addColorStop(0.85, "rgba(60,200,180,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  return done(c);
}

/** "BOWLING MAYHEM" neon sign for the masking unit above the pins. */
export function signTexture(text: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 160);
  g.fillStyle = "#0a0718";
  g.fillRect(0, 0, 1024, 160);
  g.shadowColor = color;
  g.shadowBlur = 28;
  g.fillStyle = color;
  g.font = "900 92px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 84);
  g.shadowBlur = 0;
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(14, 14, 996, 132);
  return done(c);
}

export const LANE_HALF = HALF_W;
