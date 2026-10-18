import * as THREE from "three";

/**
 * Procedural wood for the blocks — long faces get flowing grain, the two
 * ends get growth rings. Drawn once per variant on a canvas and shared by
 * every block (one material set per variant/highlight, so 60 blocks stay a
 * handful of materials).
 */

export const VARIANTS = 5;
const TONES = ["#d8a56a", "#cf9a5c", "#e0b27a", "#c98f52", "#dcac70"];

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
}

function grainCanvas(variant: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  const r = rng(variant * 977 + 13);
  const tone = TONES[variant % TONES.length];
  g.fillStyle = tone;
  g.fillRect(0, 0, 256, 64);
  // broad colour bands
  for (let i = 0; i < 6; i++) {
    g.fillStyle = shade(tone, 0.9 + r() * 0.18);
    g.globalAlpha = 0.35;
    g.fillRect(0, r() * 64, 256, 4 + r() * 12);
  }
  g.globalAlpha = 1;
  // grain lines
  for (let i = 0; i < 22; i++) {
    const y0 = r() * 64;
    const amp = 1 + r() * 4;
    const freq = 0.01 + r() * 0.03;
    const ph = r() * 6;
    g.strokeStyle = shade(tone, 0.62 + r() * 0.2);
    g.globalAlpha = 0.25 + r() * 0.4;
    g.lineWidth = 0.6 + r() * 1.4;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.25;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // a knot now and then
  if (r() < 0.6) {
    const kx = 30 + r() * 196;
    const ky = 12 + r() * 40;
    for (let k = 5; k > 0; k--) {
      g.strokeStyle = shade(tone, 0.55);
      g.globalAlpha = 0.35;
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(kx, ky, k * 3.2, k * 1.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  // edge wear
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.12)");
  grad.addColorStop(0.08, "rgba(0,0,0,0)");
  grad.addColorStop(0.92, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.12)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 64);
  return c;
}

function endCanvas(variant: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const r = rng(variant * 331 + 5);
  const tone = shade(TONES[variant % TONES.length], 0.92);
  g.fillStyle = tone;
  g.fillRect(0, 0, 64, 64);
  const cx = -20 + r() * 30;
  const cy = 90 + r() * 30;
  for (let k = 0; k < 40; k++) {
    g.strokeStyle = shade(tone, 0.7 + r() * 0.15);
    g.globalAlpha = 0.5;
    g.lineWidth = 0.8 + r();
    g.beginPath();
    g.arc(cx, cy, 8 + k * 3.4, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

export type BlockLook = "base" | "dim" | "hover" | "selected" | "live";

const cache = new Map<string, THREE.Material[]>();
const texCache = new Map<string, THREE.Texture>();

function tex(key: string, make: () => HTMLCanvasElement): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(make());
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

/** BoxGeometry face order: +x, −x (ends), +y, −y, +z, −z. */
export function blockMaterials(variant: number, look: BlockLook): THREE.Material[] {
  const key = `${variant}:${look}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const grain = tex(`g${variant}`, () => grainCanvas(variant));
  const ends = tex(`e${variant}`, () => endCanvas(variant));
  const emissive = look === "hover" ? "#5b3a10" : look === "selected" ? "#b86b12" : look === "live" ? "#7a2a10" : "#000000";
  const mk = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      roughness: 0.72,
      metalness: 0,
      color: look === "dim" ? "#8d7a66" : "#ffffff",
      emissive,
      emissiveIntensity: look === "base" || look === "dim" ? 0 : 0.55,
    });
  const e = mk(ends);
  const s = mk(grain);
  const mats = [e, e, s, s, s, s];
  cache.set(key, mats);
  return mats;
}

let ghost: THREE.MeshStandardMaterial | null = null;
let ghostHot: THREE.MeshStandardMaterial | null = null;
export function ghostMaterial(hot: boolean): THREE.MeshStandardMaterial {
  if (hot) {
    ghostHot ??= new THREE.MeshStandardMaterial({ color: "#fbbf24", transparent: true, opacity: 0.55, emissive: "#f59e0b", emissiveIntensity: 0.6, depthWrite: false });
    return ghostHot;
  }
  ghost ??= new THREE.MeshStandardMaterial({ color: "#fde68a", transparent: true, opacity: 0.22, emissive: "#f59e0b", emissiveIntensity: 0.25, depthWrite: false });
  return ghost;
}

let tableTex: THREE.Texture | null = null;
export function tableTexture(): THREE.Texture {
  if (tableTex) return tableTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#4a2c17";
  g.fillRect(0, 0, 512, 512);
  const r = rng(99);
  for (let i = 0; i < 70; i++) {
    const y0 = r() * 512;
    g.strokeStyle = r() < 0.5 ? "#3a2110" : "#5a3720";
    g.globalAlpha = 0.35 + r() * 0.3;
    g.lineWidth = 1 + r() * 3;
    g.beginPath();
    for (let x = 0; x <= 512; x += 16) {
      const y = y0 + Math.sin(x * 0.012 + i) * 6;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // plank seams
  g.globalAlpha = 0.6;
  g.strokeStyle = "#22130a";
  g.lineWidth = 3;
  for (let y = 0; y <= 512; y += 128) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  tableTex = new THREE.CanvasTexture(c);
  tableTex.colorSpace = THREE.SRGBColorSpace;
  tableTex.wrapS = tableTex.wrapT = THREE.RepeatWrapping;
  tableTex.repeat.set(2, 2);
  return tableTex;
}
