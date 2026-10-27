import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { EyeShape, FaceShape, PersonLook, VrmModel } from "@/lib/character/avatar";

/**
 * Make-up and face styling for the VRoid table characters, so two players on one model
 * read as two people: paint on the face texture (eyeshadow, blusher, lip tint, mole /
 * freckles), coloured lenses, a resting 눈매 held on the face morphs, eye size and head width.
 *
 * Every VRoid export (the classic cast, three-vrm-girl, pixiv-sample) lays its face
 * texture out the same way, so the paint goes to fixed UV spots. Seed-san is another
 * rig: its own morph names, and lenses are painted into its eye atlas (`SEED_IRIS`).
 */

/** Spots on the VRoid face texture, in UV (0..1; glTF textures aren't flipped, so UV = image fraction). */
const UV = {
  eyes: [0.345, 0.665],
  // just above the eye opening (the opening itself is a hole in the mesh)
  shadowY: 0.502,
  cheekY: 0.672,
  cheeks: [0.315, 0.685],
  mouth: [0.5, 0.764],
  mole: [0.4, 0.628],
} as const;

/** Models whose face texture uses the VRoid layout. */
const PAINTABLE = (key: VrmModel) => key !== "seed-san";

export function isFaceSkin(materialName: string): boolean {
  const n = materialName.toLowerCase();
  return n.includes("face_00_skin") || n === "face";
}
export function isIris(materialName: string): boolean {
  return materialName.toLowerCase().includes("eyeiris");
}
export function isBrow(materialName: string): boolean {
  return materialName.toLowerCase().includes("facebrow");
}

type Paint = Pick<PersonLook, "gender" | "lip" | "mark" | "blush" | "shadow">;

export function paintKey(p: Paint): string {
  return [p.gender, p.lip, p.mark, p.blush ?? "", p.shadow ?? ""].join("|");
}

function rgba(hex: string, a: number): string {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

/** A soft elliptical dab, strongest in the middle. */
function dab(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, v: number, ru: number, rv: number, color: string, a: number) {
  ctx.save();
  ctx.translate(u * W, v * H);
  ctx.scale(1, (rv * H) / (ru * W));
  const r = ru * W;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.55, rgba(color, a * 0.6));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Fixed freckle spots (same on everyone with freckles — a stable look, not a reroll per seat). */
const FRECKLES: [number, number][] = (() => {
  const out: [number, number][] = [];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (const side of [-1, 1])
    for (let i = 0; i < 9; i++) out.push([0.5 + side * (0.045 + rnd() * 0.13), 0.6 + rnd() * 0.06]);
  return out;
})();

function paint(img: CanvasImageSource & { width: number; height: number }, p: Paint): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  const W = (canvas.width = img.width);
  const H = (canvas.height = img.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  // multiply keeps the painted skin's own shading under the colour
  ctx.globalCompositeOperation = "multiply";
  if (p.shadow) for (const u of UV.eyes) dab(ctx, W, H, u, UV.shadowY, 0.09, 0.034, p.shadow, 0.9);
  if (p.blush) for (const u of UV.cheeks) dab(ctx, W, H, u, UV.cheekY, 0.08, 0.05, p.blush, 0.36);
  dab(ctx, W, H, UV.mouth[0], UV.mouth[1], 0.052, 0.017, p.lip, p.gender === "f" ? 0.8 : 0.25);
  ctx.globalCompositeOperation = "source-over";
  if (p.mark === "mole") {
    ctx.fillStyle = "rgba(70,42,34,0.9)";
    ctx.beginPath();
    ctx.arc(UV.mole[0] * W, UV.mole[1] * H, 0.0042 * W, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.mark === "freckles") {
    ctx.fillStyle = "rgba(150,90,62,0.55)";
    for (const [u, v] of FRECKLES) {
      ctx.beginPath();
      ctx.arc(u * W, v * H, 0.003 * W, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

function canvasTexture(canvas: HTMLCanvasElement, like: THREE.Texture): THREE.Texture {
  const out = new THREE.CanvasTexture(canvas);
  out.flipY = like.flipY;
  out.colorSpace = like.colorSpace;
  out.wrapS = like.wrapS;
  out.wrapT = like.wrapT;
  out.magFilter = like.magFilter;
  out.minFilter = like.minFilter;
  out.channel = like.channel;
  return out;
}

/** Seed-san's eye atlas: the two iris ellipses (UV centre + radii), recoloured for a lens. */
const SEED_IRIS = [
  [0.26, 0.425, 0.21, 0.26],
  [0.725, 0.425, 0.21, 0.26],
] as const;

function paintSeedIris(img: CanvasImageSource & { width: number; height: number }, hex: string): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  const W = (canvas.width = img.width);
  const H = (canvas.height = img.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;
  const c = new THREE.Color(hex);
  for (const [cu, cv, ru, rv] of SEED_IRIS)
    for (let y = Math.floor((cv - rv) * H); y < (cv + rv) * H; y++)
      for (let x = Math.floor((cu - ru) * W); x < (cu + ru) * W; x++) {
        const du = (x / W - cu) / ru, dv = (y / H - cv) / rv;
        if (du * du + dv * dv > 1) continue;
        const i = (y * W + x) * 4;
        const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        // dark rim and pupil stay dark, the warm glow takes the lens colour, catchlights stay white
        const k = Math.min(1.6, l * 2.2);
        const white = Math.max(0, l - 0.85) / 0.15;
        px[i] = 255 * Math.min(1, c.r * k + white);
        px[i + 1] = 255 * Math.min(1, c.g * k + white);
        px[i + 2] = 255 * Math.min(1, c.b * k + white);
      }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * Painted textures are shared by every seat with the same base texture and make-up,
 * and freed when the last one lets go (a full profile list renders ~20 looks).
 */
const painted = new Map<string, { tex: THREE.Texture; refs: number }>();

function acquire(base: THREE.Texture, sig: string, draw: (img: CanvasImageSource & { width: number; height: number }) => HTMLCanvasElement | null): { tex: THREE.Texture; id: string } | null {
  const img = base.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width) return null;
  const id = `${base.uuid}|${sig}`;
  let e = painted.get(id);
  if (!e) {
    const canvas = draw(img);
    if (!canvas) return null;
    painted.set(id, (e = { tex: canvasTexture(canvas, base), refs: 0 }));
  }
  e.refs++;
  return { tex: e.tex, id };
}

export function acquirePaintedFace(base: THREE.Texture, p: Paint) {
  return acquire(base, paintKey(p), (img) => paint(img, p));
}

export function acquireSeedEyes(base: THREE.Texture, iris: string) {
  return acquire(base, `seed-iris|${iris}`, (img) => paintSeedIris(img, iris));
}

export function releasePaintedFace(id: string | undefined) {
  const e = id ? painted.get(id) : undefined;
  if (!e || --e.refs > 0) return;
  e.tex.dispose();
  painted.delete(id!);
}

/**
 * An iris texture as grey with its depth kept (dark rim and pupil, bright catchlight),
 * so the lens colour tinted on top reads on every model.
 */
const irisCache = new WeakMap<THREE.Texture, THREE.Texture>();
export function greyIris(tex: THREE.Texture): THREE.Texture {
  let t = irisCache.get(tex);
  if (t) return t;
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width) return tex;
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return tex;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = Math.min(255, 70 + l * 1.25);
  }
  ctx.putImageData(data, 0, 0);
  irisCache.set(tex, (t = canvasTexture(canvas, tex)));
  return t;
}

/** Resting 눈매 on the VRoid face morphs (Fcl_* names, prefixes vary per export). */
const EYES_VROID: Record<EyeShape, [string, number][]> = {
  round: [["Fcl_BRW_Surprised", 0.45]],
  fox: [["Fcl_BRW_Angry", 0.6], ["Fcl_EYE_Angry", 0.45]],
  puppy: [["Fcl_BRW_Sorrow", 0.75], ["Fcl_EYE_Sorrow", 0.35]],
  sharp: [["Fcl_EYE_Close", 0.3], ["Fcl_BRW_Angry", 0.25]],
};
const EYES_SEED: Record<EyeShape, [string, number][]> = {
  round: [["eye_black_big", 1], ["eye_brow_up", 0.3]],
  fox: [["eye_angry", 0.7], ["eye_brow_down", 0.5]],
  puppy: [["eye_brow_up", 0.9], ["eye_V", 0.3]],
  sharp: [["eye_zitome", 0.65]],
};
/** Eye size per 눈매 (scale of the eye bones the iris hangs on). */
const EYE_SIZE: Record<EyeShape, number> = { round: 1.1, fox: 0.97, puppy: 1.04, sharp: 0.92 };
/** Head width per 얼굴형. */
const HEAD_WIDTH: Record<FaceShape, number> = { oval: 1, vline: 0.95, round: 1.05, square: 1.03 };

export type FaceMorph = { inf: number[]; idx: number; w: number; applied: number };

export function faceMorphs(vrm: VRM, key: VrmModel, look: Pick<PersonLook, "eyes">): FaceMorph[] {
  const want = (key === "seed-san" ? EYES_SEED : EYES_VROID)[look.eyes];
  const out: FaceMorph[] = [];
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences || mesh.userData.grafted) return;
    for (const [name, w] of want)
      for (const [k, idx] of Object.entries(mesh.morphTargetDictionary))
        if (k === name || k.endsWith(`.${name}`) || (name.startsWith("Fcl_") && k.endsWith(`_${name}`))) out.push({ inf: mesh.morphTargetInfluences, idx, w, applied: 0 });
  });
  return out;
}

/** Undo last frame's offsets — call before the expression manager writes its weights. */
export function liftMorphs(list: FaceMorph[]) {
  for (const m of list) {
    m.inf[m.idx] -= m.applied;
    m.applied = 0;
  }
}

/** Lay the resting offsets over the expression, fading out as a strong expression (or a blink) takes the face. */
export function holdMorphs(list: FaceMorph[], strong: number) {
  const k = Math.max(0, 1 - strong);
  for (const m of list) {
    const before = m.inf[m.idx];
    const after = Math.min(1, before + m.w * k);
    m.inf[m.idx] = after;
    m.applied = after - before;
  }
}

/** Eye size and head width on the raw bones (the rig's pose only ever writes rotations). */
export function shapeFace(vrm: VRM, look: Pick<PersonLook, "eyes" | "face">) {
  const head = vrm.humanoid.getRawBoneNode("head");
  const w = HEAD_WIDTH[look.face];
  head?.scale.set(w, 1, (1 + w) / 2);
  const e = EYE_SIZE[look.eyes];
  for (const b of ["leftEye", "rightEye"] as const) vrm.humanoid.getRawBoneNode(b)?.scale.setScalar(e);
}

export { PAINTABLE };
