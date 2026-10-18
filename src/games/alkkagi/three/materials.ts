import * as THREE from "three";
import { EDGE } from "../physics";

/**
 * Procedural looks for 알까기 대전 (rulebook §13): a kaya-coloured goban with
 * ink grid lines and star points, darker end grain on the sides, an oiled
 * 장판 floor, and glossy stones per seat (흑 · 백 · 홍 · 청).
 */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return [c, c.getContext("2d")!];
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let gobanTop: THREE.Texture | null = null;
/** Top face: wood + 19×19 grid + 9 star points. The texture spans exactly ±EDGE. */
export function gobanTopTexture(): THREE.Texture {
  if (gobanTop) return gobanTop;
  const size = 1024;
  const [c, g] = canvas(size);
  const rnd = seeded(7);
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#e2b66e");
  grad.addColorStop(0.5, "#d9a85c");
  grad.addColorStop(1, "#cf9a4e");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // straight grain
  for (let i = 0; i < 260; i++) {
    const y = rnd() * size;
    g.strokeStyle = `rgba(${120 + rnd() * 40}, ${70 + rnd() * 30}, 20, ${0.04 + rnd() * 0.08})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= size; x += 32) g.lineTo(x, y + Math.sin(x * 0.006 + i) * 3 + (rnd() - 0.5) * 1.5);
    g.stroke();
  }
  const px = (u: number) => ((u + EDGE) / (2 * EDGE)) * size;
  g.strokeStyle = "rgba(25, 14, 6, 0.85)";
  g.lineWidth = 2.2;
  for (let i = -9; i <= 9; i++) {
    g.beginPath();
    g.moveTo(px(i), px(-9));
    g.lineTo(px(i), px(9));
    g.stroke();
    g.beginPath();
    g.moveTo(px(-9), px(i));
    g.lineTo(px(9), px(i));
    g.stroke();
  }
  g.lineWidth = 3.4;
  g.strokeRect(px(-9), px(-9), px(9) - px(-9), px(9) - px(-9));
  g.fillStyle = "rgba(25, 14, 6, 0.9)";
  for (const a of [-6, 0, 6])
    for (const b of [-6, 0, 6]) {
      g.beginPath();
      g.arc(px(a), px(b), 7, 0, Math.PI * 2);
      g.fill();
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  gobanTop = tex;
  return tex;
}

let gobanSide: THREE.Texture | null = null;
export function gobanSideTexture(): THREE.Texture {
  if (gobanSide) return gobanSide;
  const [c, g] = canvas(256);
  const rnd = seeded(11);
  g.fillStyle = "#b07a3c";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const y = rnd() * 256;
    g.strokeStyle = `rgba(80, 40, 10, ${0.08 + rnd() * 0.15})`;
    g.lineWidth = 0.5 + rnd() * 2;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y + (rnd() - 0.5) * 6);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  gobanSide = tex;
  return tex;
}

let floorTex: THREE.Texture | null = null;
/** 장판 — oiled yellow floor paper in faint squares. */
export function floorTexture(): THREE.Texture {
  if (floorTex) return floorTex;
  const size = 512;
  const [c, g] = canvas(size);
  const rnd = seeded(23);
  g.fillStyle = "#c99a4c";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${150 + rnd() * 60}, ${100 + rnd() * 40}, 40, ${rnd() * 0.06})`;
    g.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 14, 2 + rnd() * 14);
  }
  g.strokeStyle = "rgba(110, 70, 25, 0.35)";
  g.lineWidth = 2;
  for (let k = 0; k <= size; k += size / 2) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, k);
    g.lineTo(size, k);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  floorTex = tex;
  return tex;
}

/** Seat colours (§1). */
export const SEAT_COLORS = ["#16161a", "#f4f1e8", "#b4262b", "#1f4fb8"];
/** HUD swatches, same order. */
export const SEAT_LABELS = ["흑", "백", "홍", "청"];

const stoneMats = new Map<string, THREE.MeshPhysicalMaterial>();
export function stoneMaterial(seat: number, glow = false): THREE.MeshPhysicalMaterial {
  const key = `${seat}:${glow}`;
  const hit = stoneMats.get(key);
  if (hit) return hit;
  const color = SEAT_COLORS[seat % SEAT_COLORS.length];
  const white = seat === 1;
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: white ? 0.32 : 0.22,
    metalness: 0,
    clearcoat: white ? 0.6 : 1,
    clearcoatRoughness: 0.12,
    sheen: white ? 0.3 : 0,
    emissive: glow ? new THREE.Color(white ? "#7a5a10" : "#ffb347") : new THREE.Color("#000000"),
    emissiveIntensity: glow ? 0.35 : 0,
  });
  stoneMats.set(key, m);
  return m;
}

export const goldMaterial = new THREE.MeshStandardMaterial({ color: "#e7b43a", metalness: 0.85, roughness: 0.28, emissive: "#3a2400", emissiveIntensity: 0.4 });
