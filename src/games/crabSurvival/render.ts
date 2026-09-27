/**
 * Canvas renderer for 꽃게 서바이벌. Fakes the spec's quarter-view camera with
 * a y-squash (TILT) on the ground plane plus screen-space "height" for tall
 * things (rocks, palms, crowns), and draws everything in y-sorted order so
 * crabs walk behind/in front of props correctly.
 */

import { BOXES, CRAB_RADIUS, FOODS, islandRadiusAt, SHALLOW_W, SHIELDS, WEAPONS, type CrabColor, type ShieldKind, type WeaponKind } from "./data";
import { crabRadius, player, type Box, type Crab, type Creature, type Palm, type Pickup, type Rock, type World } from "./engine";

export const TILT = 0.72;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** World units visible (geometric mean of width/height) for a given crab scale. */
function viewSpanFor(scale: number): number {
  return 640 * (0.72 + 0.28 * scale);
}

export function targetZoom(scale: number, W: number, H: number): number {
  return Math.sqrt(W * H) / viewSpanFor(scale);
}

export function updateCamera(cam: Camera, w: World, W: number, H: number, dt: number) {
  const me = player(w);
  const k = 1 - Math.exp(-6 * dt);
  cam.x += (me.x - cam.x) * k;
  cam.y += (me.y - cam.y) * k;
  // Cinemachine-style: distance grows with the crab.
  cam.zoom += (targetZoom(me.scale, W, H) - cam.zoom) * (1 - Math.exp(-2 * dt));
}

/** Screen position of a world point lifted `h` world units above the ground. */
export function toScreen(cam: Camera, W: number, H: number, x: number, y: number, h = 0): [number, number] {
  return [(x - cam.x) * cam.zoom + W / 2, (y - cam.y) * cam.zoom * TILT + H / 2 - h * cam.zoom];
}

export function screenToWorld(cam: Camera, W: number, H: number, sx: number, sy: number): [number, number] {
  return [(sx - W / 2) / cam.zoom + cam.x, (sy - H / 2) / (cam.zoom * TILT) + cam.y];
}

// ── Cached geometry / sprites ───────────────────────────────────────────────

let islandPts: [number, number][] | null = null;
function islandPath(offset: number): Path2D {
  if (!islandPts) {
    islandPts = [];
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      islandPts.push([Math.cos(a), Math.sin(a)]);
    }
  }
  const p = new Path2D();
  islandPts.forEach(([cx, cy], i) => {
    const a = Math.atan2(cy, cx);
    const r = islandRadiusAt(a) + offset;
    if (i === 0) p.moveTo(cx * r, cy * r);
    else p.lineTo(cx * r, cy * r);
  });
  p.closePath();
  return p;
}
const pathCache = new Map<number, Path2D>();
function island(offset: number): Path2D {
  let p = pathCache.get(offset);
  if (!p) {
    p = islandPath(offset);
    pathCache.set(offset, p);
  }
  return p;
}

const emojiCache = new Map<string, HTMLCanvasElement>();
function emojiSprite(e: string): HTMLCanvasElement {
  let c = emojiCache.get(e);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 72;
    const g = c.getContext("2d")!;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "56px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    g.fillText(e, 36, 40);
    emojiCache.set(e, c);
  }
  return c;
}

// ── Main draw ───────────────────────────────────────────────────────────────

type Drawable =
  | { y: number; k: "crab"; o: Crab }
  | { y: number; k: "creature"; o: Creature }
  | { y: number; k: "rock"; o: Rock }
  | { y: number; k: "palm"; o: Palm }
  | { y: number; k: "box"; o: Box }
  | { y: number; k: "pickup"; o: Pickup };

export function drawWorld(ctx: CanvasRenderingContext2D, w: World, cam: Camera, W: number, H: number, t: number, dpr: number) {
  const z = cam.zoom;
  const shake = w.shake > 0 ? w.shake * w.shake * 14 : 0;
  const shx = shake ? Math.sin(t * 91) * shake : 0;
  const shy = shake ? Math.cos(t * 77) * shake : 0;
  const cx = cam.x - shx / z, cy = cam.y - shy / (z * TILT);
  const view: Camera = { x: cx, y: cy, zoom: z };
  const me = player(w);

  // Sea.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, "#0b5f8a");
  sea.addColorStop(1, "#083d63");
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);

  const ground = () => ctx.setTransform(dpr * z, 0, 0, dpr * z * TILT, dpr * (W / 2 - cx * z), dpr * (H / 2 - cy * z * TILT));
  ground();

  // Visible world rect (with margin).
  const halfW = W / 2 / z + 200, halfH = H / 2 / (z * TILT) + 260;
  const inView = (x: number, y: number, m = 0) => Math.abs(x - cx) < halfW + m && Math.abs(y - cy) < halfH + m;

  // Deep-water sparkle lines.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 3;
  for (let i = -6; i <= 6; i++) {
    const yy = Math.round(cy / 140) * 140 + i * 140;
    ctx.beginPath();
    for (let x = cx - halfW; x <= cx + halfW; x += 60) {
      const yv = yy + Math.sin(x * 0.01 + t * 1.2 + i) * 10;
      if (x === cx - halfW) ctx.moveTo(x, yv);
      else ctx.lineTo(x, yv);
    }
    ctx.stroke();
  }

  // Shallows, foam, wet sand, sand.
  ctx.fillStyle = "#2bb3d6";
  ctx.fill(island(SHALLOW_W));
  ctx.fillStyle = "#5fd0e6";
  ctx.fill(island(SHALLOW_W * 0.45));
  ctx.save();
  ctx.lineWidth = 10;
  ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.25 * Math.sin(t * 1.6)})`;
  ctx.setLineDash([40, 26]);
  ctx.lineDashOffset = -t * 20;
  // Integer offsets only — each distinct offset is cached as its own Path2D.
  ctx.stroke(island(18 + Math.round(Math.sin(t * 1.6) * 10)));
  ctx.restore();
  ctx.fillStyle = "#d9bf85";
  ctx.fill(island(8));
  const sand = ctx.createRadialGradient(0, 0, 200, 0, 0, 1900);
  sand.addColorStop(0, "#f6e3b0");
  sand.addColorStop(1, "#ecd293");
  ctx.fillStyle = sand;
  ctx.fill(island(-6));

  // Deco.
  for (const d of w.deco) {
    if (!inView(d.x, d.y)) continue;
    drawDeco(ctx, d.kind, d.x, d.y, d.rot);
  }

  // Tide pools.
  for (const p of w.pools) {
    if (!inView(p.x, p.y, p.r)) continue;
    drawPool(ctx, p.x, p.y, p.r, t);
  }

  // Shadows (ground plane).
  ctx.fillStyle = "rgba(60,40,10,0.22)";
  for (const c of w.crabs) {
    if (!inView(c.x, c.y)) continue;
    if (!c.alive && c.deadT > 3 && !c.isPlayer) continue;
    ctx.beginPath();
    ctx.ellipse(c.x + 4 * c.scale, c.y + 6 * c.scale, crabRadius(c) * 1.25, crabRadius(c) * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const k of w.rocks) {
    if (!inView(k.x, k.y, k.r)) continue;
    ctx.beginPath();
    ctx.ellipse(k.x + k.r * 0.35, k.y + k.r * 0.3, k.r * 1.12, k.r * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Y-sorted props & actors.
  const list: Drawable[] = [];
  for (const k of w.rocks) if (inView(k.x, k.y, k.r)) list.push({ y: k.y, k: "rock", o: k });
  for (const p of w.palms) if (inView(p.x, p.y, 100)) list.push({ y: p.y, k: "palm", o: p });
  for (const b of w.boxes) if (b.alive && inView(b.x, b.y)) list.push({ y: b.y, k: "box", o: b });
  for (const p of w.pickups) if (inView(p.x, p.y)) list.push({ y: p.y - 1, k: "pickup", o: p });
  for (const c of w.creatures) if ((c.alive || c.deadT < 0.6) && inView(c.x, c.y)) list.push({ y: c.y, k: "creature", o: c });
  for (const c of w.crabs) {
    if (!c.alive && !c.isPlayer && c.deadT > 3) continue;
    if (inView(c.x, c.y, 100)) list.push({ y: c.y, k: "crab", o: c });
  }
  list.sort((a, b) => a.y - b.y);

  for (const d of list) {
    switch (d.k) {
      case "rock":
        ground();
        drawRock(ctx, d.o);
        break;
      case "palm": {
        const under = me.alive && Math.hypot(me.x - d.o.x, me.y - (d.o.y - 60)) < 110 && me.y < d.o.y;
        drawPalm(ctx, view, W, H, dpr, d.o, t, under);
        break;
      }
      case "box":
        drawBox(ctx, view, W, H, dpr, d.o, t);
        break;
      case "pickup":
        drawPickup(ctx, view, W, H, dpr, d.o, t);
        break;
      case "creature":
        ground();
        drawCreature(ctx, d.o, t);
        break;
      case "crab":
        ground();
        drawCrabWorld(ctx, d.o, t, w.kingId === d.o.id);
        break;
    }
  }

  // Particles (screen space with height).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of w.particles) {
    const [sx, sy] = toScreen(view, W, H, p.x, p.y, p.z);
    if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    const s = p.size * Math.max(0.5, z);
    if (p.kind === "star" || p.kind === "gold") {
      drawStar(ctx, sx, sy, s * 1.2, t * 4 + p.x);
    } else if (p.kind === "heal") {
      ctx.fillRect(sx - s * 0.2, sy - s, s * 0.4, s * 2);
      ctx.fillRect(sx - s, sy - s * 0.2, s * 2, s * 0.4);
    } else if (p.kind === "coin") {
      ctx.beginPath();
      ctx.ellipse(sx, sy, s, s * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "splinter") {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(p.x * 0.3 + t * 8);
      ctx.fillRect(-s, -s * 0.3, s * 2, s * 0.6);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Names, HP bars, crowns, stun stars (screen space, on top of everything).
  for (const c of w.crabs) {
    if (!c.alive || !inView(c.x, c.y)) continue;
    drawCrabOverlay(ctx, view, W, H, c, t, w.kingId === c.id);
  }
  for (const cr of w.creatures) {
    if (!cr.alive || cr.hp >= cr.def.hp || !inView(cr.x, cr.y)) continue;
    const [sx, sy] = toScreen(view, W, H, cr.x, cr.y, cr.def.radius * 1.3);
    bar(ctx, sx, sy, Math.max(24, cr.def.radius * z * 1.6), 4, cr.hp / cr.def.hp, "#f97316");
  }

  // Floating texts.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const ft of w.texts) {
    const [sx, sy] = toScreen(view, W, H, ft.x, ft.y);
    const a = Math.min(1, ft.life / (ft.maxLife * 0.4));
    const pop = 1 + Math.max(0, (ft.life - ft.maxLife * 0.8) / (ft.maxLife * 0.2)) * 0.35;
    ctx.globalAlpha = a;
    ctx.font = `900 ${Math.round(ft.size * pop * Math.min(1.3, Math.max(0.85, z)))}px system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(ft.text, sx, sy);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, sx, sy);
  }
  ctx.globalAlpha = 1;

  // Low-HP vignette.
  if (me.alive && me.hp / me.maxHp < 0.3) {
    const k = 1 - me.hp / me.maxHp / 0.3;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(220,20,20,0)");
    g.addColorStop(1, `rgba(220,20,20,${0.25 + 0.2 * k * (0.5 + 0.5 * Math.sin(t * 6))})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawKingMarker(ctx, view, W, H, w, t);
}

// ── Ground bits ─────────────────────────────────────────────────────────────

function drawDeco(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, rot: number) {
  switch (kind) {
    case 0: // pebbles
      ctx.fillStyle = "rgba(160,130,90,0.35)";
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 4, rot, 0, Math.PI * 2);
      ctx.ellipse(x + 8, y + 3, 3, 2.5, rot, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1: // shell
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = "#fbe4d8";
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.arc(0, 0, 7, Math.PI * 1.1, Math.PI * 1.9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(200,140,120,0.6)";
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 5);
        ctx.lineTo(i * 2.6, -6);
        ctx.stroke();
      }
      ctx.restore();
      break;
    case 2: // dune grass
      ctx.strokeStyle = "rgba(120,150,60,0.8)";
      ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 2, y);
        ctx.quadraticCurveTo(x + i * 4, y - 10, x + i * 6 + Math.sin(rot) * 3, y - 16 - Math.abs(i) * -2);
        ctx.stroke();
      }
      break;
    case 3: // sand ripple
      ctx.strokeStyle = "rgba(190,160,100,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 22, rot, rot + 1.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 8, 22, rot, rot + 1.2);
      ctx.stroke();
      break;
    default: // tiny starfish print
      ctx.fillStyle = "rgba(230,120,90,0.35)";
      drawStar(ctx, x, y, 5, rot);
  }
}

function drawPool(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  // Stone rim.
  ctx.fillStyle = "#b8a687";
  ctx.beginPath();
  ctx.arc(x, y, r + 12, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, "#9ff3e4");
  g.addColorStop(0.6, "#35c4c9");
  g.addColorStop(1, "#1a8fa6");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.5 + i / 3) % 1;
    ctx.globalAlpha = 1 - ph;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.2 + 0.75 * ph), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Rim pebbles.
  ctx.fillStyle = "#948367";
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + x * 0.01;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8), 7, 5, a, 0, Math.PI * 2);
    ctx.fill();
  }
  // Green "heal" cross.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(x - 5, y - 16, 10, 32);
  ctx.fillRect(x - 16, y - 5, 32, 10);
}

function drawRock(ctx: CanvasRenderingContext2D, k: Rock) {
  const lift = k.h / TILT;
  const base = ["#8a8378", "#7d766b", "#978f80"][Math.floor(k.tint * 3)];
  const top = ["#b3ab9b", "#a39b8b", "#c0b7a5"][Math.floor(k.tint * 3)];
  // Side hull.
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(k.x, k.y, k.r, 0, Math.PI);
  ctx.lineTo(k.x - k.r, k.y - lift);
  ctx.arc(k.x, k.y - lift, k.r, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  // Top.
  const g = ctx.createRadialGradient(k.x - k.r * 0.35, k.y - lift - k.r * 0.35, k.r * 0.1, k.x, k.y - lift, k.r);
  g.addColorStop(0, "#e2dccd");
  g.addColorStop(0.5, top);
  g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(k.x, k.y - lift, k.r, 0, Math.PI * 2);
  ctx.fill();
  // Cracks & moss.
  ctx.strokeStyle = "rgba(60,50,40,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(k.x - k.r * 0.3, k.y - lift - k.r * 0.2);
  ctx.lineTo(k.x + k.r * 0.05, k.y - lift + k.r * 0.1);
  ctx.lineTo(k.x + k.r * 0.35, k.y - lift + k.r * 0.05);
  ctx.stroke();
  ctx.fillStyle = "rgba(90,140,70,0.45)";
  ctx.beginPath();
  ctx.ellipse(k.x + k.r * 0.3, k.y - lift + k.r * 0.45, k.r * 0.35, k.r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPalm(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, dpr: number, p: Palm, t: number, under: boolean) {
  const z = cam.zoom;
  const trunkH = 150 * p.size;
  const [bx, by] = toScreen(cam, W, H, p.x, p.y);
  const sway = Math.sin(t * 0.9 + p.x) * 4;
  const tx = bx + (p.lean * 60 + sway) * p.size * z;
  const ty = by - trunkH * z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Ground shadow blob of the canopy.
  ctx.fillStyle = "rgba(60,40,10,0.18)";
  ctx.beginPath();
  ctx.ellipse(tx + 30 * z, by + 6 * z, 70 * p.size * z, 34 * p.size * z, 0, 0, Math.PI * 2);
  ctx.fill();
  // Trunk: segmented curve.
  const segs = 7;
  for (let i = segs; i >= 0; i--) {
    const f = i / segs;
    const x = bx + (tx - bx) * f * f;
    const y = by + (ty - by) * f;
    const r = (11 - 4 * f) * p.size * z;
    ctx.fillStyle = i % 2 ? "#9a6b3c" : "#86582e";
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = under ? 0.4 : 1;
  // Fronds.
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + p.lean + Math.sin(t * 1.3 + i + p.y) * 0.06;
    const len = 78 * p.size * z;
    const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.55 + 16 * z;
    const mx = tx + Math.cos(a) * len * 0.5, my = ty + Math.sin(a) * len * 0.3 - 18 * z;
    ctx.strokeStyle = i % 2 ? "#2f8f3a" : "#3aa545";
    ctx.lineWidth = 15 * p.size * z;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();
    ctx.strokeStyle = "rgba(20,80,30,0.6)";
    ctx.lineWidth = 2 * z;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();
  }
  // Coconuts.
  ctx.fillStyle = "#6b4423";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(tx + (i - 1) * 9 * z, ty + 8 * z, 7 * z * p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = "butt";
}

function drawBox(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, dpr: number, b: Box, t: number) {
  const z = cam.zoom;
  const gold = b.kind === "gold";
  const s = BOXES[b.kind].radius * z;
  const [x, y] = toScreen(cam, W, H, b.x, b.y);
  const shake = b.hitFlash > 0 ? Math.sin(t * 90) * 3 : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "rgba(60,40,10,0.25)";
  ctx.beginPath();
  ctx.ellipse(x + 4 * z, y + 4 * z, s * 1.2, s * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  const bx = x - s + shake, fy = y - s * 0.35;
  const hgt = s * 1.35;
  const topD = s * 0.9 * TILT;
  // Front face.
  ctx.fillStyle = b.hitFlash > 0 ? "#fff" : gold ? "#d4a017" : "#a0622d";
  ctx.fillRect(bx, fy - hgt + topD * 0.4, s * 2, hgt);
  // Top face.
  ctx.fillStyle = b.hitFlash > 0 ? "#fff" : gold ? "#f7d154" : "#c17f43";
  ctx.fillRect(bx, fy - hgt - topD * 0.6, s * 2, topD);
  ctx.strokeStyle = gold ? "#8a6508" : "#6b3d17";
  ctx.lineWidth = Math.max(1, 2 * z);
  ctx.strokeRect(bx, fy - hgt + topD * 0.4, s * 2, hgt);
  ctx.strokeRect(bx, fy - hgt - topD * 0.6, s * 2, topD);
  if (gold) {
    // Bands + lock.
    ctx.fillStyle = "#8a6508";
    ctx.fillRect(bx + s * 0.3, fy - hgt - topD * 0.6, s * 0.25, hgt + topD);
    ctx.fillRect(bx + s * 1.45, fy - hgt - topD * 0.6, s * 0.25, hgt + topD);
    ctx.fillStyle = "#1f2937";
    const lx = bx + s, ly = fy - hgt * 0.45;
    ctx.fillRect(lx - s * 0.22, ly - s * 0.1, s * 0.44, s * 0.4);
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = Math.max(1, 2.5 * z);
    ctx.beginPath();
    ctx.arc(lx, ly - s * 0.1, s * 0.14, Math.PI, 0);
    ctx.stroke();
    // Glint.
    const gl = (t * 0.6 + b.x * 0.001) % 1;
    ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - Math.abs(gl - 0.5) * 2)})`;
    drawStar(ctx, bx + s * 2 * gl, fy - hgt - topD * 0.2, 6 * z, t * 3);
  } else {
    ctx.strokeStyle = "rgba(80,40,10,0.6)";
    ctx.lineWidth = Math.max(1, 1.5 * z);
    for (let i = 1; i < 3; i++) {
      const yy = fy - hgt + topD * 0.4 + (hgt / 3) * i;
      ctx.beginPath();
      ctx.moveTo(bx, yy);
      ctx.lineTo(bx + s * 2, yy);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(bx, fy - hgt + topD * 0.4);
    ctx.lineTo(bx + s * 2, fy + topD * 0.4);
    ctx.stroke();
    if (b.hp < b.maxHp) bar(ctx, x, fy - hgt - topD - 8 * z, s * 2, 4, b.hp / b.maxHp, "#f59e0b");
  }
}

function drawPickup(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, dpr: number, p: Pickup, t: number) {
  const z = cam.zoom;
  const bob = p.type === "food" || p.type === "coin" ? 0 : 5 + Math.sin(t * 3 + p.id) * 4;
  const [x, y] = toScreen(cam, W, H, p.x, p.y, p.z + bob);
  const [gx, gy] = toScreen(cam, W, H, p.x, p.y);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Blink before expiry.
  if (p.ttl !== Infinity && p.ttl - p.age < 6 && Math.sin(t * 18) > 0.3) return;
  ctx.fillStyle = "rgba(60,40,10,0.22)";
  ctx.beginPath();
  ctx.ellipse(gx, gy + 2, p.radius * z * 0.9, p.radius * z * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  const size = p.radius * 2.3 * z;
  if (p.type === "coin") {
    const spin = Math.abs(Math.cos(t * 3 + p.id));
    ctx.fillStyle = "#b8860b";
    ctx.beginPath();
    ctx.ellipse(x, y - size * 0.3, size * 0.45 * (0.3 + 0.7 * spin), size * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.ellipse(x, y - size * 0.32, size * 0.36 * (0.3 + 0.7 * spin), size * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  let emoji = "🍌";
  let glow: string | null = null;
  if (p.type === "food") emoji = FOODS[p.food ?? "banana"].emoji;
  else if (p.type === "key") {
    emoji = "🔑";
    glow = "rgba(253,224,71,0.55)";
  } else if (p.type === "weapon" && p.weapon) {
    emoji = WEAPONS[p.weapon.kind].emoji;
    glow = WEAPONS[p.weapon.kind].tier >= 4 ? "rgba(251,146,60,0.6)" : "rgba(147,197,253,0.55)";
  } else if (p.type === "shield" && p.shield) {
    emoji = SHIELDS[p.shield.kind].emoji;
    glow = "rgba(134,239,172,0.55)";
  }
  if (glow) {
    const r = size * (0.85 + 0.12 * Math.sin(t * 4 + p.id));
    const g = ctx.createRadialGradient(x, y - size * 0.4, 0, x, y - size * 0.4, r);
    g.addColorStop(0, glow);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - size * 0.4, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const sp = emojiSprite(emoji);
  ctx.drawImage(sp, x - size / 2, y - size * 0.95, size, size);
}

// ── Crabs ───────────────────────────────────────────────────────────────────

function drawCrabWorld(ctx: CanvasRenderingContext2D, c: Crab, t: number, king: boolean) {
  const s = c.scale;
  ctx.save();
  // Slight lift so the body floats above its shadow.
  ctx.translate(c.x, c.y - (3 * s) / TILT);
  ctx.rotate(c.angle);
  ctx.scale(s, s);
  if (!c.alive) {
    const fade = c.isPlayer ? 1 : Math.max(0, 1 - Math.max(0, c.deadT - 2));
    ctx.globalAlpha = fade;
    drawCrabBody(ctx, c.color, { walk: t * 12, dead: true, flipT: Math.min(1, c.deadT * 3) });
  } else {
    if (c.invuln > 0 && Math.sin(t * 30) > 0) ctx.globalAlpha = 0.45;
    drawCrabBody(ctx, c.color, {
      walk: c.moving ? c.walk : 0,
      flash: c.hitFlash > 0,
      swing: c.swing > 0 ? 1 - c.swing / 0.24 : -1,
      swingSide: c.swingSide,
      weapon: c.weapon?.kind ?? null,
      shield: c.shield?.kind ?? null,
      guard: c.guardFlash > 0,
      king,
    });
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export interface CrabPose {
  walk: number;
  flash?: boolean;
  swing?: number; // 0..1 progress, -1 = idle
  swingSide?: 1 | -1;
  weapon?: WeaponKind | null;
  shield?: ShieldKind | null;
  guard?: boolean;
  dead?: boolean;
  flipT?: number;
  king?: boolean;
}

/**
 * Draws one crab in local space: facing +x, body radius ≈ CRAB_RADIUS (18u).
 * "Right" claw is +y (clockwise of facing), "left" claw is −y.
 */
export function drawCrabBody(ctx: CanvasRenderingContext2D, col: CrabColor, pose: CrabPose) {
  const R = CRAB_RADIUS;
  const shell = pose.flash ? "#ffffff" : col.shell;
  const dark = pose.flash ? "#f1f5f9" : col.dark;

  if (pose.dead) {
    // Belly-up: pale underside, legs flailing upward.
    const f = pose.flipT ?? 1;
    ctx.scale(1, 1 - 0.3 * Math.sin(f * Math.PI));
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const bx = -6 + i * 5, by = side * R * 0.7;
        const wig = Math.sin(pose.walk + i * 1.7) * 4;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 4 + wig, by + side * 12);
        ctx.lineTo(bx - 2 - wig, by + side * 20);
        ctx.stroke();
      }
    }
    ctx.fillStyle = col.belly;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.8, R * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-R * 0.5, 0);
    ctx.lineTo(R * 0.4, 0);
    ctx.moveTo(-R * 0.2, -R * 0.5);
    ctx.lineTo(-R * 0.2, R * 0.5);
    ctx.stroke();
    // X_X eyes.
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.6;
    for (const e of [-1, 1]) {
      const ex = R * 0.75, ey = e * 5;
      ctx.beginPath();
      ctx.moveTo(ex - 2, ey - 2);
      ctx.lineTo(ex + 2, ey + 2);
      ctx.moveTo(ex + 2, ey - 2);
      ctx.lineTo(ex - 2, ey + 2);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    return;
  }

  // Walking legs (4 per side, the swimming crab's back pair is paddle-shaped).
  ctx.strokeStyle = dark;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const phase = pose.walk + i * 1.6 + (side > 0 ? Math.PI : 0);
      const sw = Math.sin(phase) * 0.35;
      const bx = 6 - i * 5.2, by = side * R * 0.72;
      const a1 = side * (Math.PI / 2 + 0.25 + i * 0.28) + sw;
      const kx = bx + Math.cos(a1) * 11, ky = by + Math.sin(a1) * 11;
      const a2 = a1 + side * 0.7 - sw * 0.5;
      const fx = kx + Math.cos(a2) * 10, fy = ky + Math.sin(a2) * 10;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      if (i === 3) {
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 4, 2.2, a2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Claw arms: idle pose, swing sweeps the active claw across the front.
  const drawArm = (side: 1 | -1) => {
    const active = pose.swing !== undefined && pose.swing >= 0 && (pose.weapon ? side === 1 : pose.swingSide === side);
    const sp = active ? pose.swing! : -1;
    // Sweep: raised outward (wind-up) → snaps across the front.
    const base = side * 0.55;
    const armA = active ? side * (1.1 - 1.9 * easeOut(sp)) : base;
    const reach = active ? 1 + 0.35 * Math.sin(sp * Math.PI) : 1;
    const sx = 8, sy = side * R * 0.55;
    const ex = sx + Math.cos(armA) * 14 * reach, ey = sy + Math.sin(armA) * 14 * reach;
    ctx.strokeStyle = shell;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Weapon in the right claw.
    if (side === 1 && pose.weapon) {
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(armA - 0.2 + (active ? -0.6 * Math.sin(sp * Math.PI) : 0));
      drawWeapon(ctx, pose.weapon);
      ctx.restore();
    }
    // Pincer.
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(armA * 0.6);
    const open = active ? 0.2 + 0.5 * Math.sin(sp * Math.PI) : 0.28;
    const big = 1.15;
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.ellipse(3, 0, 7 * big, 5.5 * big, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dark;
    // Upper finger.
    ctx.save();
    ctx.rotate(-open);
    ctx.beginPath();
    ctx.moveTo(6, -2);
    ctx.quadraticCurveTo(15 * big, -6, 17 * big, 0);
    ctx.lineTo(7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Lower finger.
    ctx.save();
    ctx.rotate(open);
    ctx.beginPath();
    ctx.moveTo(6, 2);
    ctx.quadraticCurveTo(14 * big, 6, 15 * big, 1);
    ctx.lineTo(7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // Shield on the left claw.
    if (side === -1 && pose.shield) {
      ctx.save();
      ctx.translate(ex + 6, ey - 2);
      drawShield(ctx, pose.shield, !!pose.guard);
      ctx.restore();
    }
  };
  drawArm(-1);
  drawArm(1);

  // Carapace: wide, with the swimming crab's long lateral spines.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(R * 0.55, -R * 0.95);
  ctx.lineTo(R * 0.25, -R * 1.55);
  ctx.lineTo(-R * 0.05, -R * 0.95);
  ctx.moveTo(R * 0.55, R * 0.95);
  ctx.lineTo(R * 0.25, R * 1.55);
  ctx.lineTo(-R * 0.05, R * 0.95);
  ctx.fill();
  const g = ctx.createRadialGradient(-R * 0.1, -R * 0.35, R * 0.1, 0, 0, R * 1.2);
  g.addColorStop(0, pose.flash ? "#fff" : lighten(col.shell));
  g.addColorStop(0.55, shell);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(R * 0.72, -R * 0.2);
  // Serrated front edge.
  for (let i = 0; i <= 8; i++) {
    const a = -1.1 + (i / 8) * 2.2;
    const rr = i % 2 ? R * 0.78 : R * 0.9;
    ctx.lineTo(Math.cos(a) * rr * 0.85, Math.sin(a) * rr * 1.2);
  }
  ctx.quadraticCurveTo(-R * 0.5, R * 1.05, -R * 0.8, R * 0.2);
  ctx.quadraticCurveTo(-R * 0.95, 0, -R * 0.8, -R * 0.2);
  ctx.quadraticCurveTo(-R * 0.5, -R * 1.05, Math.cos(-1.1) * R * 0.9 * 0.85, Math.sin(-1.1) * R * 0.9 * 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Pale spots (꽃게 pattern) + a centre groove.
  if (!pose.flash) {
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    for (const [sx, sy, sr] of [[-4, -8, 2.6], [-6, 7, 2.2], [3, -3, 1.8], [-10, -1, 2], [2, 9, 1.6]] as const) {
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(4, -6);
    ctx.quadraticCurveTo(-4, 0, 4, 6);
    ctx.stroke();
  }
  // Eye stalks.
  for (const e of [-1, 1]) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(R * 0.6, e * 4);
    ctx.lineTo(R * 0.92, e * 6.5);
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(R * 0.95, e * 6.8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(R * 0.95 + 0.9, e * 6.8 - 0.9, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = "butt";
}

function drawWeapon(ctx: CanvasRenderingContext2D, kind: WeaponKind) {
  const d = WEAPONS[kind];
  ctx.lineCap = "round";
  switch (kind) {
    case "bat":
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(34, -5);
      ctx.quadraticCurveTo(40, 0, 34, 5);
      ctx.lineTo(0, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(-2, -2.5, 6, 5);
      break;
    case "bone":
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(28, 0);
      ctx.stroke();
      ctx.fillStyle = d.color;
      for (const [x, y] of [[29, -4], [29, 4], [1, -4], [1, 4]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "knife":
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(-2, -2.5, 10, 5);
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(8, -3.5);
      ctx.lineTo(30, -1);
      ctx.lineTo(34, 1);
      ctx.lineTo(8, 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10, -2);
      ctx.lineTo(28, -0.5);
      ctx.stroke();
      break;
    case "bottle":
      ctx.fillStyle = "rgba(74,222,128,0.85)";
      ctx.fillRect(0, -2.5, 10, 5);
      ctx.beginPath();
      ctx.moveTo(10, -6);
      ctx.lineTo(24, -6);
      ctx.lineTo(27, -2);
      ctx.lineTo(24, 0);
      ctx.lineTo(28, 3);
      ctx.lineTo(24, 6);
      ctx.lineTo(10, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(12, -4, 9, 2);
      break;
    case "hammer":
      ctx.fillStyle = "#8b5a2b";
      ctx.fillRect(0, -2.5, 28, 5);
      ctx.fillStyle = d.color;
      ctx.fillRect(24, -10, 10, 20);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(25, -9, 3, 18);
      break;
    case "sickle":
      ctx.fillStyle = "#8b5a2b";
      ctx.fillRect(0, -2, 16, 4);
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(15, -2);
      ctx.quadraticCurveTo(38, -4, 30, 18);
      ctx.quadraticCurveTo(32, 2, 15, 2);
      ctx.closePath();
      ctx.fill();
      break;
    case "sign":
      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(0, -2, 34, 4);
      ctx.save();
      ctx.translate(38, 0);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = d.color;
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
      ctx.fillStyle = "#1f2937";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", 38, 0.5);
      break;
    case "anchor":
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(34, 0);
      ctx.moveTo(8, -8);
      ctx.lineTo(8, 8);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(28, 0, 11, -Math.PI / 2 - 0.3, Math.PI / 2 + 0.3, false);
      ctx.stroke();
      ctx.fillStyle = d.color;
      for (const y of [-11, 11]) {
        ctx.beginPath();
        ctx.moveTo(28 + (y < 0 ? -2 : -2), y);
        ctx.lineTo(22, y + (y < 0 ? -3 : 3));
        ctx.lineTo(26, y + (y < 0 ? 5 : -5));
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(-2, 0, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  ctx.lineCap = "butt";
}

function drawShield(ctx: CanvasRenderingContext2D, kind: ShieldKind, guard: boolean) {
  const d = SHIELDS[kind];
  ctx.save();
  ctx.scale(0.55, 1);
  switch (kind) {
    case "potLid": {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#374151";
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "shell": {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * Math.PI;
        ctx.lineTo(Math.cos(a) * 15 - 4, Math.sin(a) * 15);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#db2777";
      ctx.lineWidth = 1.2;
      for (let i = 1; i < 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(Math.cos(a) * 14 - 4, Math.sin(a) * 14);
        ctx.stroke();
      }
      break;
    }
    case "captain": {
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(0, 0, 12.5, 0, Math.PI * 2);
      ctx.fill();
      // Gold anchor emblem.
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.moveTo(-4, -4);
      ctx.lineTo(-4, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(3, 0, 5, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      break;
    }
  }
  if (guard) {
    ctx.strokeStyle = "rgba(147,197,253,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCrabOverlay(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, c: Crab, t: number, king: boolean) {
  const z = cam.zoom;
  const r = crabRadius(c);
  const [sx, sy] = toScreen(cam, W, H, c.x, c.y, r * 1.2 + 6);
  let top = sy - 6;
  if (king) {
    const bob = Math.sin(t * 3) * 3;
    drawCrown(ctx, sx, top - 10 * Math.max(0.8, z) + bob, 17 * Math.max(0.8, Math.min(1.5, z * c.scale * 0.7)), t);
    top -= 26 * Math.max(0.8, Math.min(1.5, z * c.scale * 0.7));
  }
  if (c.stun > 0) {
    for (let i = 0; i < 3; i++) {
      const a = t * 6 + (i / 3) * Math.PI * 2;
      ctx.fillStyle = "#fde047";
      drawStar(ctx, sx + Math.cos(a) * r * z * 0.8, sy + 8 + Math.sin(a) * r * z * 0.3, 5, a);
    }
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = `800 ${c.isPlayer ? 13 : 12}px system-ui, sans-serif`;
  const label = `Lv${c.level} ${c.name}`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(label, sx, top - 6);
  ctx.fillStyle = king ? "#fde047" : c.isPlayer ? "#a5f3fc" : "#ffffff";
  ctx.fillText(label, sx, top - 6);
  bar(ctx, sx, top - 2, Math.max(34, r * z * 2), 5, c.hp / c.maxHp, c.isPlayer ? "#22c55e" : king ? "#facc15" : "#ef4444");
  if (c.hasKey) {
    const sp = emojiSprite("🔑");
    ctx.drawImage(sp, sx + Math.max(34, r * z * 2) / 2 + 2, top - 12, 14, 14);
  }
}

function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, s * 1.8);
  g.addColorStop(0, `rgba(253,224,71,${0.45 + 0.15 * Math.sin(t * 4)})`);
  g.addColorStop(1, "rgba(253,224,71,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, s * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#facc15";
  ctx.strokeStyle = "#a16207";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x - s, y - s * 0.3);
  ctx.lineTo(x - s * 0.5, y + s * 0.1);
  ctx.lineTo(x, y - s * 0.6);
  ctx.lineTo(x + s * 0.5, y + s * 0.1);
  ctx.lineTo(x + s, y - s * 0.3);
  ctx.lineTo(x + s, y + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(x, y + s * 0.15, s * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3b82f6";
  for (const dx of [-0.6, 0.6]) {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + s * 0.22, s * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Creatures ───────────────────────────────────────────────────────────────

const BABY_COLOR: CrabColor = { id: "red", name: "", shell: "#fb923c", dark: "#9a3412", belly: "#ffedd5" };

function drawCreature(ctx: CanvasRenderingContext2D, cr: Creature, t: number) {
  const r = cr.def.radius;
  ctx.save();
  ctx.translate(cr.x, cr.y);
  if (!cr.alive) {
    ctx.globalAlpha = Math.max(0, 1 - cr.deadT / 0.6);
    ctx.scale(1 + cr.deadT, 1 + cr.deadT);
  }
  // Shadow.
  ctx.fillStyle = "rgba(60,40,10,0.2)";
  ctx.beginPath();
  ctx.ellipse(3, 4, r * 1.1, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(cr.angle);
  const flash = cr.hitFlash > 0;
  switch (cr.kind) {
    case "babyCrab":
      ctx.scale(r / CRAB_RADIUS, r / CRAB_RADIUS);
      drawCrabBody(ctx, BABY_COLOR, { walk: cr.walk, flash });
      break;
    case "fish": {
      const wig = Math.sin(t * 12 + cr.id) * 0.3;
      ctx.fillStyle = flash ? "#fff" : cr.def.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.2, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(-r * 1.1, 0);
      ctx.rotate(wig);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.8, -r * 0.6);
      ctx.lineTo(-r * 0.8, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#0c4a6e";
      ctx.beginPath();
      ctx.arc(r * 0.7, -r * 0.2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.2, r * 0.7, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "crayfish":
    case "lobster": {
      const k = r / 15;
      ctx.scale(k, k);
      const col = flash ? "#fff" : cr.def.color;
      const dk = flash ? "#eee" : "#7f1d1d";
      // Tail segments.
      ctx.fillStyle = col;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(-8 - i * 5, 0, 5 - i * 0.6, 7 - i * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-33, -7);
      ctx.lineTo(-33, 7);
      ctx.closePath();
      ctx.fill();
      // Legs.
      ctx.strokeStyle = dk;
      ctx.lineWidth = 1.6;
      for (const s of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const sw = Math.sin(cr.walk + i + (s > 0 ? 1.5 : 0)) * 2;
          ctx.beginPath();
          ctx.moveTo(-i * 4, s * 5);
          ctx.lineTo(-i * 4 - 3 + sw, s * 12);
          ctx.stroke();
        }
      // Body + big claws.
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(2, 0, 10, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const s of [-1, 1]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(8, s * 4);
        ctx.lineTo(16, s * 9);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(22, s * 10, 7, 4.5, s * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = dk;
        ctx.beginPath();
        ctx.moveTo(26, s * 9);
        ctx.lineTo(32, s * 8);
        ctx.lineTo(27, s * 11);
        ctx.fill();
      }
      // Antennae.
      ctx.strokeStyle = dk;
      ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(10, s * 2);
        ctx.quadraticCurveTo(26, s * 4, 36, s * (14 + Math.sin(t * 3 + cr.id) * 3));
        ctx.stroke();
      }
      ctx.fillStyle = "#111";
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(10, s * 3, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "turtle": {
      const k = r / 32;
      ctx.scale(k, k);
      const pad = Math.sin(cr.walk * 2) * 0.4;
      ctx.fillStyle = flash ? "#fff" : "#84cc16";
      for (const [fx, fy, a] of [[14, -22, -0.6 + pad], [14, 22, 0.6 - pad], [-16, -18, -2.4 - pad], [-16, 18, 2.4 + pad]] as const) {
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(8, 0, 11, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.ellipse(34, 0, 10, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(39, -4, 1.8, 0, Math.PI * 2);
      ctx.arc(39, 4, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flash ? "#fff" : "#4d7c0f";
      ctx.beginPath();
      ctx.ellipse(0, 0, 28, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#365314";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = flash ? "#fff" : "#65a30d";
      const hex = (hx: number, hy: number, s: number) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.lineTo(hx + Math.cos(a) * s, hy + Math.sin(a) * s);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      hex(0, 0, 9);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        hex(Math.cos(a) * 16, Math.sin(a) * 14, 6.5);
      }
      break;
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ── Screen-space helpers ────────────────────────────────────────────────────

function bar(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, h: number, frac: number, color: string) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = color;
  ctx.fillRect(cx - w / 2, y, w * Math.max(0, Math.min(1, frac)), h);
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function easeOut(x: number) {
  return 1 - (1 - x) * (1 - x);
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 70), g = Math.min(255, ((n >> 8) & 255) + 70), b = Math.min(255, (n & 255) + 70);
  return `rgb(${r},${g},${b})`;
}

/** Edge-of-screen tracker pointing at the king crab (spec: "1위 위치 추적 핑"). */
function drawKingMarker(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, w: World, t: number) {
  if (w.kingId === null || w.kingId === w.playerId) return;
  const k = w.crabs.find((c) => c.id === w.kingId);
  if (!k || !k.alive) return;
  const [sx, sy] = toScreen(cam, W, H, k.x, k.y);
  const m = 34;
  if (sx > m && sx < W - m && sy > m && sy < H - m) return;
  const cx = W / 2, cy = H / 2;
  const dx = sx - cx, dy = sy - cy;
  const s = Math.min((W / 2 - m) / Math.abs(dx || 1), (H / 2 - m) / Math.abs(dy || 1));
  const px = cx + dx * s, py = cy + dy * s;
  const a = Math.atan2(dy, dx);
  const me = player(w);
  const dist = Math.round(Math.hypot(k.x - me.x, k.y - me.y) / 10);
  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = `rgba(250,204,21,${0.75 + 0.25 * Math.sin(t * 6)})`;
  ctx.save();
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(8, -10);
  ctx.lineTo(8, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawCrown(ctx, px, py, 9, t);
  ctx.font = "800 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  const label = `${k.name} ${dist}m`;
  const ly = py + (py > H / 2 ? -34 : 18);
  // Keep the label on-screen when the marker hugs the left/right edge.
  const half = ctx.measureText(label).width / 2 + 4;
  const lx = Math.min(W - half, Math.max(half, px));
  ctx.strokeText(label, lx, ly);
  ctx.fillStyle = "#fde047";
  ctx.fillText(label, lx, ly);
}

/** Minimap: island, pools, gold chests, you, and the king ping. */
export function drawMinimap(ctx: CanvasRenderingContext2D, w: World, size: number, t: number, dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const R = size / 2;
  const k = (R - 3) / (islandRadiusAt(0) + SHALLOW_W + 120);
  ctx.save();
  ctx.beginPath();
  ctx.arc(R, R, R - 1, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8,61,99,0.85)";
  ctx.fill();
  ctx.clip();
  ctx.translate(R, R);
  ctx.scale(k, k);
  ctx.fillStyle = "#2bb3d6";
  ctx.fill(island(SHALLOW_W));
  ctx.fillStyle = "#ecd293";
  ctx.fill(island(0));
  ctx.fillStyle = "#35c4c9";
  for (const p of w.pools) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 30, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#8a8378";
  for (const r of w.rocks) {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f59e0b";
  for (const b of w.boxes) if (b.alive && b.kind === "gold") ctx.fillRect(b.x - 30, b.y - 30, 60, 60);
  ctx.restore();

  const me = player(w);
  const dot = (x: number, y: number) => [R + x * k, R + y * k] as const;
  if (w.kingId !== null && w.kingId !== w.playerId) {
    const king = w.crabs.find((c) => c.id === w.kingId);
    if (king?.alive) {
      const [x, y] = dot(king.x, king.y);
      const ph = (t * 1.2) % 1;
      ctx.strokeStyle = `rgba(250,204,21,${1 - ph})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4 + ph * 12, 0, Math.PI * 2);
      ctx.stroke();
      drawCrown(ctx, x, y, 6, t);
    }
  }
  const [mx, my] = dot(me.x, me.y);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(me.angle);
  ctx.fillStyle = me.alive ? "#ffffff" : "#94a3b8";
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (w.kingId === w.playerId) drawCrown(ctx, mx, my - 9, 6, t);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(R, R, R - 1, 0, Math.PI * 2);
  ctx.stroke();
}

/** Standalone preview (menu): one crab, idle-animated, optional gear/crown. */
export function drawCrabPreview(ctx: CanvasRenderingContext2D, col: CrabColor, W: number, H: number, t: number, opts: { weapon?: WeaponKind | null; shield?: ShieldKind | null; crown?: boolean } = {}) {
  ctx.clearRect(0, 0, W, H);
  const s = Math.min(W, H) / 70;
  ctx.save();
  ctx.translate(W / 2, H / 2 + 4 * s);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, 12 * s, 22 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.scale(s, s * TILT);
  ctx.rotate(-Math.PI / 2);
  const sp = (t * 0.8) % 2.2;
  drawCrabBody(ctx, col, { walk: t * 6, swing: sp < 1 ? sp : -1, swingSide: 1, weapon: opts.weapon ?? null, shield: opts.shield ?? null });
  ctx.restore();
  if (opts.crown) drawCrown(ctx, W / 2, H / 2 - 22 * s, 7 * s, t);
}
