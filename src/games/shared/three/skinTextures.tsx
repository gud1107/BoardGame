"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { drawPattern, type CardBackSkin, type PropSkin, type SkinParticles, type TableSkin } from "@/lib/skins/catalog";
import { useCardBackSkin, usePropSkin } from "@/lib/skins/useSkins";

/**
 * 3D side of the 🎨 skins: canvas textures for a card-back skin / table skin,
 * cached per skin id (a handful at most), and the seat-owner context that lets
 * `HeldFan` swap a hand's back for its owner's skin without every game passing
 * owner names around — `TableScene` wraps each seat in `CardBackOwner`. The
 * same context gives props (CoinStack, Perudo's cup) their owner's prop skin.
 */

const backCache = new Map<string, THREE.CanvasTexture>();
const feltCache = new Map<string, THREE.CanvasTexture>();

/**
 * Two players can wear the same back. A held card stays in its holder's hands
 * under their name plate, but the card itself also carries the seat colour as a
 * band top and bottom (like the plate's inner border), so whose card it is reads
 * from the card alone. Cached per skin + seat colour.
 */
function drawSeatBands(ctx: CanvasRenderingContext2D, w: number, h: number, band: string | undefined) {
  if (!band) return;
  ctx.fillStyle = band;
  ctx.fillRect(18, 18, w - 36, 24);
  ctx.fillRect(18, h - 42, w - 36, 24);
}

export function skinBackTexture(skin: CardBackSkin, band?: string): THREE.Texture {
  const key = `${skin.id}|${band ?? ""}`;
  const hit = backCache.get(key);
  if (hit) return hit;
  if (skin.image) {
    // painted back: drawn onto the canvas (with the seat bands) once the image has loaded
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 360;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      drawSeatBands(ctx, c.width, c.height, band);
      tex.needsUpdate = true;
    };
    img.src = skin.image;
    backCache.set(key, tex);
    return tex;
  }
  const w = 256;
  const h = 360;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  // A held card is ~20×28 px on screen, where the fine pattern and a small
  // emblem blur into one dark tile (53 backs measured ΔE ≈ 3 apart). So: a bold
  // accent-coloured copy of the pattern on top, a thick frame and a big emblem
  // — measured again at 20×28, the closest pair is ΔE ≈ 13.
  drawPattern(ctx, skin.pattern, skin.colors, w, h, 22);
  ctx.globalAlpha = 0.45;
  drawPattern(ctx, skin.pattern, ["rgba(0,0,0,0)", skin.accent], w, h, 72);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = skin.accent;
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, w - 18, h - 18);
  ctx.fillStyle = skin.colors[0];
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 92, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = skin.accent;
  ctx.font = "bold 140px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(skin.emblem, w / 2, h / 2 + 8);
  drawSeatBands(ctx, w, h, band);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  backCache.set(key, tex);
  return tex;
}

export function skinFeltTexture(skin: TableSkin): THREE.CanvasTexture {
  const hit = feltCache.get(skin.id);
  if (hit) return hit;
  const s = 512;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  drawPattern(ctx, skin.pattern, [skin.felt, skin.feltAccent], s, s, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  feltCache.set(skin.id, tex);
  return tex;
}

const OwnerContext = createContext<{ name: string; me: boolean; color?: string } | null>(null);

export function CardBackOwner({ name, me, color, children }: { name: string; me: boolean; color?: string; children: ReactNode }) {
  return <OwnerContext.Provider value={{ name, me, color }}>{children}</OwnerContext.Provider>;
}

/** The owner's skinned back when the surrounding seat's player picked one, else `fallback`. */
export function useSkinnedBack(fallback: THREE.Texture): THREE.Texture {
  const owner = useContext(OwnerContext);
  const skin = useCardBackSkin(owner?.name, owner?.me ?? false);
  return owner && skin ? skinBackTexture(skin, owner.color) : fallback;
}

/** The surrounding seat's player's 🎨 prop skin (null outside a seat or when they picked none). */
export function useOwnerProp(): PropSkin | null {
  const owner = useContext(OwnerContext);
  const skin = usePropSkin(owner?.name, owner?.me ?? false);
  return owner ? skin : null;
}

const dotCache = new Map<string, THREE.CanvasTexture>();
/** A soft round sprite (petals get a squashed oval). */
function dotTexture(kind: SkinParticles): THREE.CanvasTexture {
  const hit = dotCache.get(kind);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(kind === "bubbles" ? 0.75 : 0.45, kind === "bubbles" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  if (kind === "petals") ctx.ellipse(32, 32, 30, 16, 0.6, 0, Math.PI * 2);
  else ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  if (kind === "bubbles") {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  dotCache.set(kind, tex);
  return tex;
}

const COUNT = 70;
/** Fall speed (negative = rises), sway, twinkle per kind. */
const MOTION: Record<SkinParticles, { vy: number; sway: number; twinkle: boolean; size: number }> = {
  petals: { vy: -0.16, sway: 0.25, twinkle: false, size: 0.09 },
  snow: { vy: -0.12, sway: 0.12, twinkle: false, size: 0.06 },
  bubbles: { vy: 0.14, sway: 0.08, twinkle: false, size: 0.08 },
  embers: { vy: 0.1, sway: 0.1, twinkle: true, size: 0.045 },
  stars: { vy: 0, sway: 0, twinkle: true, size: 0.06 },
  sparkles: { vy: 0.03, sway: 0.05, twinkle: true, size: 0.05 },
};

/**
 * The table skin's ambient specks (꽃잎·별·눈·거품·불씨·반짝이) in a box around the table —
 * one Points draw call, kept outside the table's edge so nothing on the felt is hidden.
 */
export function SkinParticleField({ kind, color, radius }: { kind: SkinParticles; color: string; radius: number }) {
  const m = MOTION[kind];
  const { geo, seeds } = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // deterministic spread (no Math.random → the same on every render)
      const a = (i * 2.399963) % (Math.PI * 2);
      const r = radius + 0.4 + ((i * 0.618) % 1) * 2.6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.3 + ((i * 0.381) % 1) * 3.2;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = (i * 0.137) % 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geo: g, seeds };
  }, [radius]);
  const mat = useRef<THREE.PointsMaterial>(null);
  useFrame(({ clock }, dt) => {
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const t = clock.elapsedTime;
    for (let i = 0; i < COUNT; i++) {
      let y = arr[i * 3 + 1] + m.vy * dt * (0.6 + seeds[i]);
      if (y < 0.2) y = 3.5;
      if (y > 3.6) y = 0.25;
      arr[i * 3 + 1] = y;
      arr[i * 3] += Math.sin(t * 0.7 + seeds[i] * 9) * m.sway * dt;
    }
    attr.needsUpdate = true;
    if (mat.current && m.twinkle) mat.current.opacity = 0.65 + Math.sin(t * 2.2) * 0.25;
  });
  return (
    <points geometry={geo}>
      <pointsMaterial ref={mat} map={dotTexture(kind)} color={color} size={m.size} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}
