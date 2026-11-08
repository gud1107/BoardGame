import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { BlushStyle, EyeShape, FaceMark, FaceShape, LinerStyle, LipStyle, PersonLook, ShadowStyle, VrmModel } from "@/lib/character/avatar";

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
  // the lower lash line / 애교살 band just under the opening
  underY: 0.588,
  // outer eye corners (left/right of the texture) and where a liner tail starts
  outer: [0.287, 0.713],
  outerY: 0.546,
  cheekY: 0.672,
  cheeks: [0.315, 0.685],
  nose: [0.5, 0.645],
  mouth: [0.5, 0.764],
  mole: [0.4, 0.628],
  lipMole: [0.56, 0.786],
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

type Paint = Pick<PersonLook, "gender" | "lip" | "mark" | "blush" | "shadow" | "shadowStyle" | "liner" | "blushStyle" | "lipStyle" | "glow">;

export function paintKey(p: Paint): string {
  return [p.gender, p.lip, p.mark, p.blush ?? "", p.shadow ?? "", p.shadowStyle ?? "", p.liner ?? "", p.blushStyle ?? "", p.lipStyle ?? "", p.glow ? 1 : 0].join("|");
}

function rgba(hex: string, a: number): string {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

/** A soft elliptical dab, strongest in the middle (`edge`: where it has faded to 60%; `rot` tilts it). */
function dab(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, v: number, ru: number, rv: number, color: string, a: number, edge = 0.55, rot = 0) {
  ctx.save();
  ctx.translate(u * W, v * H);
  if (rot) ctx.rotate(rot);
  ctx.scale(1, (rv * H) / (ru * W));
  const r = ru * W;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(edge, rgba(color, a * 0.6));
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
  if (p.shadow) paintShadow(ctx, W, H, p.shadow, p.shadowStyle ?? "soft");
  if (p.blush) paintBlush(ctx, W, H, p.blush, p.blushStyle ?? "apple");
  paintLip(ctx, W, H, p.lip, p.lipStyle ?? "blur", p.gender === "f" ? 1 : 0.32);
  ctx.globalCompositeOperation = "source-over";
  if (p.liner && p.liner !== "none") paintLiner(ctx, W, H, p.liner);
  if (p.shadow && p.shadowStyle === "glitter") sparkle(ctx, W, H);
  if (p.glow) paintGlow(ctx, W, H);
  if (p.lipStyle === "gloss") dab(ctx, W, H, UV.mouth[0] - 0.008, UV.mouth[1] + 0.006, 0.016, 0.0045, "#ffffff", 0.6);
  paintMark(ctx, W, H, p.mark);
  return canvas;
}

/** 아이섀도: 은은하게 (one wash over the lid), 그라데이션 (light wash + deep lash line), 스모키 (wide, dark, smudged under), 애교살 글리터 (wash + a lit band under the eye). */
function paintShadow(ctx: CanvasRenderingContext2D, W: number, H: number, c: string, style: ShadowStyle) {
  for (const u of UV.eyes) {
    const out = u < 0.5 ? -1 : 1;
    if (style === "soft") dab(ctx, W, H, u, UV.shadowY, 0.09, 0.034, c, 0.9);
    else if (style === "gradient") {
      dab(ctx, W, H, u, UV.shadowY - 0.012, 0.1, 0.045, c, 0.45, 0.4);
      dab(ctx, W, H, u + out * 0.012, UV.shadowY + 0.012, 0.075, 0.02, c, 1, 0.7);
    } else if (style === "smoky") {
      dab(ctx, W, H, u + out * 0.01, UV.shadowY + 0.004, 0.115, 0.05, c, 1, 0.65);
      dab(ctx, W, H, u, UV.underY, 0.075, 0.012, c, 0.7, 0.5);
    } else {
      dab(ctx, W, H, u, UV.shadowY, 0.085, 0.03, c, 0.7);
      dab(ctx, W, H, u, UV.underY, 0.07, 0.011, c, 0.45, 0.5);
    }
  }
}

/** Fixed glitter flecks along the 애교살 (a stable look, not a reroll per seat). */
const GLITTER: [number, number][] = (() => {
  const out: [number, number][] = [];
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (const u of UV.eyes) for (let i = 0; i < 9; i++) out.push([u + (rnd() - 0.5) * 0.12, UV.underY + (rnd() - 0.5) * 0.018]);
  return out;
})();

function sparkle(ctx: CanvasRenderingContext2D, W: number, H: number) {
  for (const u of UV.eyes) dab(ctx, W, H, u, UV.underY, 0.07, 0.013, "#fff6e8", 0.45, 0.5);
  ctx.fillStyle = "rgba(255,255,245,0.95)";
  for (const [u, v] of GLITTER) {
    ctx.beginPath();
    ctx.arc(u * W, v * H, 0.0028 * W, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 아이라인 꼬리 from the outer corner: up and out (고양이) or down and out (강아지). */
function paintLiner(ctx: CanvasRenderingContext2D, W: number, H: number, style: LinerStyle) {
  ctx.save();
  ctx.fillStyle = "rgba(34,22,20,0.95)";
  for (const u of UV.outer) {
    const out = u < 0.5 ? -1 : 1;
    const x0 = u * W - out * 0.016 * W, y0 = (UV.outerY + (style === "wing" ? 0.004 : 0.022)) * H;
    const x1 = u * W + out * (style === "wing" ? 0.04 : 0.036) * W, y1 = y0 + (style === "wing" ? -0.046 : 0.03) * H;
    const t = 0.015 * W;
    // a tapered tail: thick at the eye, a point at the end
    ctx.beginPath();
    ctx.moveTo(x0, y0 - t);
    ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - t * 0.5, x1, y1);
    ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + t * 0.7, x0, y0 + t * 0.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** 블러셔: 볼 중앙, 숙취 (high under the eyes and over the nose), 광대 사선 (tilted up toward the temples). */
function paintBlush(ctx: CanvasRenderingContext2D, W: number, H: number, c: string, style: BlushStyle) {
  if (style === "apple") for (const u of UV.cheeks) dab(ctx, W, H, u, UV.cheekY, 0.08, 0.05, c, 0.36);
  else if (style === "hangover") {
    for (const u of UV.eyes) dab(ctx, W, H, u + (u < 0.5 ? 0.02 : -0.02), UV.underY + 0.03, 0.085, 0.035, c, 0.42);
    dab(ctx, W, H, UV.nose[0], UV.nose[1] - 0.015, 0.035, 0.022, c, 0.32);
  } else for (const u of UV.cheeks) dab(ctx, W, H, u + (u < 0.5 ? -0.03 : 0.03), UV.cheekY - 0.02, 0.1, 0.03, c, 0.42, 0.55, u < 0.5 ? 0.45 : -0.45);
}

/** 립: 블러 (soft gradient, the default), 풀 (a crisp full lip); 글로시 is 풀 + a highlight drawn on top. */
function paintLip(ctx: CanvasRenderingContext2D, W: number, H: number, c: string, style: LipStyle, k: number) {
  const [u, v] = UV.mouth;
  if (style === "blur") dab(ctx, W, H, u, v, 0.052, 0.017, c, 0.8 * k);
  else {
    dab(ctx, W, H, u, v, 0.058, 0.02, c, 0.85 * k, 0.85);
    dab(ctx, W, H, u, v, 0.03, 0.012, c, 0.5 * k, 0.6);
  }
}

/** 하이라이터: a lit stroke down the nose and on the cheekbones. */
function paintGlow(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  dab(ctx, W, H, UV.nose[0], UV.nose[1] - 0.03, 0.009, 0.035, "#fff2e2", 0.55);
  for (const u of UV.cheeks) dab(ctx, W, H, u + (u < 0.5 ? -0.01 : 0.01), UV.underY + 0.025, 0.045, 0.014, "#fff2e2", 0.5, 0.55, u < 0.5 ? 0.35 : -0.35);
  ctx.restore();
}

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.35);
  ctx.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
  ctx.closePath();
}

/** 포인트: moles and freckles are painted skin; the stickers and the plaster sit on top. */
function paintMark(ctx: CanvasRenderingContext2D, W: number, H: number, mark: FaceMark) {
  const dot = (u: number, v: number, r: number) => {
    ctx.beginPath();
    ctx.arc(u * W, v * H, r * W, 0, Math.PI * 2);
    ctx.fill();
  };
  if (mark === "mole" || mark === "lipMole") {
    ctx.fillStyle = "rgba(70,42,34,0.9)";
    const [u, v] = mark === "mole" ? UV.mole : UV.lipMole;
    dot(u, v, 0.0042);
  } else if (mark === "freckles") {
    ctx.fillStyle = "rgba(150,90,62,0.55)";
    for (const [u, v] of FRECKLES) dot(u, v, 0.003);
  } else if (mark === "heart" || mark === "star") {
    const heart = mark === "heart";
    const x = (heart ? 0.7 : 0.285) * W, y = (heart ? 0.655 : 0.63) * H, r = 0.016 * W;
    ctx.save();
    ctx.fillStyle = heart ? "#ff4f86" : "#ffcc33";
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 0.0025 * W;
    if (heart) heartPath(ctx, x, y, r);
    else starPath(ctx, x, y, r * 1.1);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (mark === "bandage") {
    ctx.save();
    ctx.translate(UV.nose[0] * W, (UV.nose[1] - 0.035) * H);
    ctx.rotate(-0.12);
    const w = 0.075 * W, h = 0.02 * W;
    ctx.fillStyle = "#f1d2b0";
    ctx.strokeStyle = "rgba(150,110,80,0.6)";
    ctx.lineWidth = 0.0015 * W;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e6bf98";
    ctx.fillRect(-w * 0.16, -h * 0.38, w * 0.32, h * 0.76);
    ctx.restore();
  }
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
