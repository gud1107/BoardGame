"use client";

import * as THREE from "three";
import type { Card } from "../engine";
import { cardCaption, cardEmoji, cardLabel } from "../CardArt";

/** Canvas painting of a 코요테 card face / back, matching CardArt.tsx's colours. Cached per face. */

const TIER: Record<string, [string, string, string]> = {
  night: ["#1b2a4a", "#05070f", "#a5b4fc"],
  question: ["#4a3312", "#100b03", "#fcd34d"],
  maxZero: ["#4a1030", "#10030c", "#fda4af"],
  double: ["#123a2e", "#04120c", "#6ee7b7"],
  neg: ["#4a1010", "#100303", "#f87171"],
  zero: ["#3a3a1a", "#0e0e06", "#fde68a"],
  pos: ["#5a3a12", "#140e04", "#fde68a"],
};

function tierOf(card: Card): [string, string, string] {
  if (card.kind !== "number") return TIER[card.kind];
  if (card.value < 0) return TIER.neg;
  if (card.value === 0) return TIER.zero;
  return TIER.pos;
}

const EMOJI_FONT = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
const TEXT_FONT = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif";

const cache = new Map<string, THREE.CanvasTexture>();

export function coyoteCardTexture(card: Card | null): THREE.CanvasTexture {
  const key = card ? `${card.kind}:${card.value}` : "back";
  let t = cache.get(key);
  if (t) return t;
  const W = 256;
  const H = 360;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, 22);
  ctx.save();
  ctx.clip();
  if (!card) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#7c3f12");
    g.addColorStop(1, "#2a1405");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(253,230,138,0.35)";
    ctx.lineWidth = 3;
    for (let i = -H; i < W + H; i += 26) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
    }
    ctx.font = `110px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🐺", W / 2, H / 2);
  } else {
    const [a, b, accent] = tierOf(card);
    const g = ctx.createLinearGradient(0, 0, W * 0.5, H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // subtle sun-ray pattern
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = accent;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2, H * 0.55);
      const a0 = (i / 12) * Math.PI * 2;
      ctx.arc(W / 2, H * 0.55, H, a0, a0 + Math.PI / 24);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `64px ${EMOJI_FONT}`;
    ctx.fillText(cardEmoji(card), W / 2, 62);
    const label = cardLabel(card);
    ctx.font = `900 ${label.length > 3 ? 74 : 120}px ${TEXT_FONT}`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(label, W / 2, H * 0.56);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, W / 2, H * 0.56);
    ctx.font = `700 26px ${TEXT_FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(cardCaption(card), W / 2, H - 38);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 8;
  }
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, 22);
  ctx.lineWidth = 8;
  ctx.strokeStyle = card ? tierOf(card)[2] : "#fbbf24";
  ctx.stroke();
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}
