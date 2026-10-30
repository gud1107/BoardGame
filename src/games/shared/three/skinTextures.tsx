"use client";

import { createContext, useContext, type ReactNode } from "react";
import * as THREE from "three";
import { drawPattern, type CardBackSkin, type TableSkin } from "@/lib/skins/catalog";
import { useCardBackSkin } from "@/lib/skins/useSkins";

/**
 * 3D side of the 🎨 skins: canvas textures for a card-back skin / table skin,
 * cached per skin id (a handful at most), and the seat-owner context that lets
 * `HeldFan` swap a hand's back for its owner's skin without every game passing
 * owner names around — `TableScene` wraps each seat in `CardBackOwner`.
 */

const backCache = new Map<string, THREE.CanvasTexture>();
const feltCache = new Map<string, THREE.CanvasTexture>();

export function skinBackTexture(skin: CardBackSkin): THREE.CanvasTexture {
  const hit = backCache.get(skin.id);
  if (hit) return hit;
  const w = 256;
  const h = 360;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  drawPattern(ctx, skin.pattern, skin.colors, w, h, 22);
  ctx.strokeStyle = skin.accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(9, 9, w - 18, h - 18);
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, w - 48, h - 48);
  ctx.fillStyle = skin.colors[0];
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skin.accent;
  ctx.font = "bold 72px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(skin.emblem, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  backCache.set(skin.id, tex);
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

const OwnerContext = createContext<{ name: string; me: boolean } | null>(null);

export function CardBackOwner({ name, me, children }: { name: string; me: boolean; children: ReactNode }) {
  return <OwnerContext.Provider value={{ name, me }}>{children}</OwnerContext.Provider>;
}

/** The owner's skinned back when the surrounding seat's player picked one, else `fallback`. */
export function useSkinnedBack(fallback: THREE.Texture): THREE.Texture {
  const owner = useContext(OwnerContext);
  const skin = useCardBackSkin(owner?.name, owner?.me ?? false);
  return owner && skin ? skinBackTexture(skin) : fallback;
}
