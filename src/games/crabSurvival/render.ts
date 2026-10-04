/**
 * Canvas renderer for 꽃게 서바이벌. Fakes the spec's quarter-view camera with
 * a y-squash (TILT) on the ground plane plus screen-space "height" for tall
 * things (rocks, palms, crowns), and draws everything in y-sorted order so
 * crabs walk behind/in front of props correctly.
 */

import { BOXES, CRAB_RADIUS, epicBounty, EPIC_WANTED, FOODS, GEAR_RARITY, GEARS, islandRadiusAt, MUTATIONS, SHALLOW_W, SHIELDS, SPECIES, WEAPONS, type CrabColor, type ShieldKind, type SpeciesDef, type SpeciesId, type WeaponKind } from "./data";
import { crabRadius, hasMut, holdsEpic, penaltyLeft, player, type Beam, type Box, type Crab, type Creature, type Palm, type Pickup, type Rock, type Shot, type World } from "./engine";

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

  // Burning seaweed trail (매운 고추 미역) and armed puffer mines.
  for (const h of w.hazards) {
    if (!inView(h.x, h.y)) continue;
    const a = h.life / h.maxLife;
    const flick = 0.8 + 0.2 * Math.sin(t * 22 + h.x);
    const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r * flick);
    g.addColorStop(0, `rgba(254,240,138,${0.75 * a})`);
    g.addColorStop(0.45, `rgba(249,115,22,${0.6 * a})`);
    g.addColorStop(1, "rgba(220,38,38,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r * flick, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const m of w.mines) {
    if (!inView(m.x, m.y)) continue;
    const armed = m.arm <= 0;
    const blink = armed && Math.sin(t * 10 + m.id) > 0.4;
    const gold = (m.lv ?? 1) >= 3;
    ctx.fillStyle = "rgba(60,40,10,0.25)";
    ctx.beginPath();
    ctx.ellipse(m.x + 3, m.y + 4, 13, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(m.x - 4, m.y - 4, 2, m.x, m.y, 14);
    g.addColorStop(0, "#ecfccb");
    g.addColorStop(1, blink ? "#65a30d" : "#a3e635");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gold ? "#f59e0b" : "#3f6212";
    for (let i = 0; i < (gold ? 12 : 8); i++) {
      const a = (i / (gold ? 12 : 8)) * Math.PI * 2 + m.id;
      ctx.beginPath();
      ctx.arc(m.x + Math.cos(a) * 12, m.y + Math.sin(a) * 12, gold ? 3 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (blink) {
      ctx.strokeStyle = "rgba(190,242,100,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.blast, 0, Math.PI * 2);
      ctx.stroke();
    }
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

  // Field-weapon projectiles and line FX (screen space).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const s of w.shots) {
    if (!inView(s.x, s.y, s.r * 2)) continue;
    if (s.kind === "vortex") drawVortex(ctx, view, W, H, s, t);
    else drawShot(ctx, view, W, H, s);
  }
  for (const b of w.beams) drawBeam(ctx, view, W, H, b, t);

  // Particles (screen space with height).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of w.particles) {
    const [sx, sy] = toScreen(view, W, H, p.x, p.y, p.z);
    if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    const s = p.size * Math.max(0.5, z);
    if (p.kind === "ring") {
      // Expanding ground shockwave (squashed like the ground plane).
      const [gx, gy] = toScreen(view, W, H, p.x, p.y);
      const k = 1 - a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(2, 7 * a * z);
      ctx.beginPath();
      ctx.ellipse(gx, gy, p.size * k * z, p.size * k * z * TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (p.kind === "streak") {
      const len = Math.hypot(p.vx, p.vy) * 0.06 * z;
      const ang = Math.atan2(p.vy * TILT, p.vx);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1.5, s * 0.6);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - Math.cos(ang) * len, sy - Math.sin(ang) * len);
      ctx.stroke();
      ctx.lineCap = "butt";
      continue;
    }
    if (p.kind === "bubble") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1.5, s * 0.3);
      ctx.beginPath();
      ctx.arc(sx, sy, s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(sx - s * 0.35, sy - s * 0.35, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (p.kind === "petal") {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(t * 5 + p.x * 0.7);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.1, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    if (p.kind === "shard") {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(p.y * 0.5 + t * 3);
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.4);
      ctx.lineTo(s * 0.55, 0);
      ctx.lineTo(0, s * 1.4);
      ctx.lineTo(-s * 0.55, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(-s * 0.12, -s * 0.9, s * 0.24, s * 0.9);
      ctx.restore();
      continue;
    }
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

  // 방사능: green-warped vision. 럼주: a woozy purple swirl at the edges.
  if (me.alive && penaltyLeft(me, "toxic") > 0) {
    ctx.fillStyle = `rgba(101,163,13,${0.16 + 0.05 * Math.sin(t * 5)})`;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(132,204,22,0)");
    g.addColorStop(1, "rgba(77,124,15,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (me.alive && penaltyLeft(me, "rum") > 0) {
    const g = ctx.createRadialGradient(W / 2 + Math.sin(t * 2) * 40, H / 2 + Math.cos(t * 1.7) * 30, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(168,85,247,0)");
    g.addColorStop(1, `rgba(126,34,206,${0.25 + 0.1 * Math.sin(t * 3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawKingMarker(ctx, view, W, H, w, t);
}

function drawShot(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, s: Shot) {
  const z = cam.zoom;
  const [x, y] = toScreen(cam, W, H, s.x, s.y, 12);
  const ang = Math.atan2(s.vy * TILT, s.vx);
  const lv = s.lv ?? 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // ★2 shots are a touch bigger; ★3 shots are big, gilded and haloed.
  const k = Math.max(0.7, z) * (lv >= 3 ? 1.45 : lv === 2 ? 1.15 : 1);
  if (lv >= 3) {
    const hr = (s.kind === "trident" ? 20 : 11) * k;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hr);
    g.addColorStop(0, "rgba(253,230,138,0.65)");
    g.addColorStop(1, "rgba(251,191,36,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-hr * 0.3, 0, hr * 1.4, hr, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  switch (s.kind) {
    case "shotgun":
      ctx.fillStyle = lv >= 3 ? "#fde68a" : "#fbcfe8";
      ctx.strokeStyle = lv >= 3 ? "#b45309" : "#9d174d";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8 * k, 0);
      ctx.lineTo(-4 * k, -4 * k);
      ctx.lineTo(-2 * k, 0);
      ctx.lineTo(-4 * k, 4 * k);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case "needle":
      ctx.strokeStyle = "rgba(251,113,133,0.45)";
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.moveTo(-18 * k, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.strokeStyle = lv >= 3 ? "#fef3c7" : "#fecdd3";
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(-7 * k, 0);
      ctx.lineTo(7 * k, 0);
      ctx.stroke();
      break;
    case "trident": {
      const L = 26 * k * Math.sqrt(s.r / 13);
      ctx.strokeStyle = lv >= 3 ? "rgba(251,191,36,0.55)" : "rgba(56,189,248,0.5)";
      ctx.lineWidth = 7 * k;
      ctx.beginPath();
      ctx.moveTo(-L * 1.6, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.strokeStyle = "#b45309";
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.moveTo(-L, 0);
      ctx.lineTo(L * 0.4, 0);
      ctx.stroke();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2.5 * k;
      ctx.beginPath();
      ctx.moveTo(L * 0.4, -6 * k);
      ctx.lineTo(L * 0.4, 6 * k);
      for (const off of [-6, 0, 6]) {
        ctx.moveTo(L * 0.4, off * k);
        ctx.lineTo(L * 0.85, off * k);
      }
      ctx.stroke();
      break;
    }
    default:
      ctx.fillStyle = GEARS[s.kind].color;
      ctx.beginPath();
      ctx.arc(0, 0, 4 * k, 0, Math.PI * 2);
      ctx.fill();
  }
  ctx.restore();
}

function drawVortex(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, s: Shot, t: number) {
  const z = cam.zoom;
  const [x, y] = toScreen(cam, W, H, s.x, s.y, 4);
  const fade = Math.min(1, s.life / 0.4);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, TILT);
  const R = s.r * z;
  const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 1.25);
  g.addColorStop(0, `rgba(30,27,75,${0.75 * fade})`);
  g.addColorStop(0.6, `rgba(79,70,229,${0.45 * fade})`);
  g.addColorStop(1, "rgba(129,140,248,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.25, 0, Math.PI * 2);
  ctx.fill();
  // Spiral arms spinning inward.
  ctx.lineCap = "round";
  for (let arm = 0; arm < 4; arm++) {
    ctx.strokeStyle = (s.lv ?? 1) >= 3 ? `rgba(253,224,71,${(arm % 2 ? 0.55 : 0.9) * fade})` : `rgba(199,210,254,${(arm % 2 ? 0.5 : 0.85) * fade})`;
    ctx.lineWidth = Math.max(1.5, 3 * z);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      const a = -t * 7 + arm * (Math.PI / 2) + k * 4.2;
      const rr = R * (1.15 - k);
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawBeam(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, b: Beam, t: number) {
  const z = cam.zoom;
  const a = b.life / b.maxLife;
  const h = b.kind === "zap" ? 14 : 10;
  const [x1, y1] = toScreen(cam, W, H, b.x1, b.y1, h);
  const [x2, y2] = toScreen(cam, W, H, b.x2, b.y2, h);
  ctx.save();
  ctx.lineCap = "round";
  if (b.kind === "zap") {
    // Jagged lightning, re-jittered every frame.
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const segs = Math.max(4, Math.round(len / 18));
    const pts: [number, number][] = [[x1, y1]];
    for (let i = 1; i < segs; i++) {
      const j = Math.sin(t * 90 + i * 12.9898 + b.x1) * 9 * Math.max(0.7, z);
      pts.push([x1 + (dx * i) / segs + nx * j, y1 + (dy * i) / segs + ny * j]);
    }
    pts.push([x2, y2]);
    const gold = (b.lv ?? 1) >= 3;
    const wk = gold ? 1.5 : 1;
    for (const [w, col] of [[b.width * 3 * wk * Math.max(0.7, z), gold ? `rgba(251,191,36,${0.4 * a})` : `rgba(167,139,250,${0.35 * a})`], [b.width * wk * Math.max(0.7, z), gold ? `rgba(254,243,199,${a})` : `rgba(237,233,254,${a})`]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  } else {
    const wpx = b.width * 2 * z * (0.6 + 0.4 * a);
    for (const [k, col] of [[1.6, `rgba(14,165,233,${0.35 * a})`], [1, `rgba(103,232,249,${0.8 * a})`], [0.4, `rgba(240,253,255,${a})`]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = wpx * k * (1 + 0.06 * Math.sin(t * 40));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(224,242,254,${a})`;
    ctx.beginPath();
    ctx.arc(x1, y1, wpx * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  if (p.type === "mutation" && p.mutation === "oil") {
    // The oil slick is a trap on the ground, not a floating prize.
    ctx.fillStyle = "rgba(15,23,42,0.82)";
    ctx.beginPath();
    ctx.ellipse(gx, gy, size * 1.1, size * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(167,139,250,${0.25 + 0.15 * Math.sin(t * 2 + p.id)})`;
    ctx.beginPath();
    ctx.ellipse(gx - size * 0.3, gy - size * 0.12, size * 0.4, size * 0.16, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(56,189,248,0.25)";
    ctx.beginPath();
    ctx.ellipse(gx + size * 0.35, gy + size * 0.1, size * 0.28, size * 0.1, 0.2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
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
  } else if (p.type === "gear" && p.gear) {
    emoji = GEARS[p.gear].emoji;
    glow = GEAR_RARITY[GEARS[p.gear].rarity].glow;
  } else if (p.type === "mutation" && p.mutation) {
    const m = MUTATIONS[p.mutation];
    emoji = m.emoji;
    glow = m.risk ? "rgba(239,68,68,0.6)" : "rgba(74,222,128,0.65)";
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
  if (p.type === "gear" && p.gear) {
    // Twinkle so dropped weapons read as "shiny loot" from across the beach — rarer = more sparkles.
    const rank = GEAR_RARITY[GEARS[p.gear].rarity].rank;
    ctx.fillStyle = rank >= 3 ? "#fef3c7" : rank === 2 ? "#f3e8ff" : "#ecfeff";
    if (rank >= 3) {
      // Legendary: a light pillar so it can be spotted from off-screen-ish distances.
      const pg = ctx.createLinearGradient(x, y - size * 3.2, x, y);
      pg.addColorStop(0, "rgba(251,191,36,0)");
      pg.addColorStop(1, `rgba(251,191,36,${0.35 + 0.15 * Math.sin(t * 5)})`);
      ctx.fillStyle = pg;
      ctx.fillRect(x - size * 0.22, y - size * 3.2, size * 0.44, size * 3.2);
      ctx.fillStyle = "#fef3c7";
    }
    for (let i = 0; i < rank * 2; i++) {
      const a = t * 2.5 + (i / rank) * Math.PI + p.id;
      const k = 0.5 + 0.5 * Math.sin(t * 6 + i * 2);
      drawStar(ctx, x + Math.cos(a) * size * 0.6, y - size * 0.45 + Math.sin(a) * size * 0.35, 4 * k + 1, a);
    }
  }
}

// ── Crabs ───────────────────────────────────────────────────────────────────

function drawCrabWorld(ctx: CanvasRenderingContext2D, c: Crab, t: number, king: boolean) {
  const s = c.scale;
  if (c.alive && c.burrow > 0) {
    // Hidden under the sand: a trembling mound with eye-stalks peeking out.
    const R = CRAB_RADIUS * s * 1.3;
    ctx.fillStyle = "#c9a35f";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, R * (1 + 0.06 * Math.sin(t * 30)), R * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e6c98e";
    ctx.beginPath();
    ctx.ellipse(c.x - R * 0.15, c.y - R * 0.2, R * 0.7, R * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111827";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c.x + sx * R * 0.22, c.y - R * 0.35, 2.4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (c.alive && c.muts.length) drawMutationAura(ctx, c, t);
  if (holdsEpic(c)) {
    const r = CRAB_RADIUS * s;
    ctx.strokeStyle = `rgba(251,191,36,${0.55 + 0.25 * Math.sin(t * 6)})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (c.alive && c.surge > 0) {
    const sp = SPECIES[c.species];
    const k = Math.min(1, c.surge / Math.max(0.1, sp.perk.seconds));
    const r = CRAB_RADIUS * s * (1.7 + 0.15 * Math.sin(t * 14));
    const g = ctx.createRadialGradient(c.x, c.y, r * 0.3, c.x, c.y, r);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, sp.perk.color);
    ctx.globalAlpha = 0.25 + 0.35 * k;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.save();
  // Slight lift so the body floats above its shadow.
  ctx.translate(c.x, c.y - (3 * s) / TILT);
  ctx.rotate(c.angle);
  ctx.scale(s, s);
  if (!c.alive) {
    const fade = c.isPlayer ? 1 : Math.max(0, 1 - Math.max(0, c.deadT - 2));
    ctx.globalAlpha = fade;
    drawCrabBody(ctx, c.color, { walk: t * 12, dead: true, flipT: Math.min(1, c.deadT * 3), build: SPECIES[c.species].build });
  } else {
    if (c.invuln > 0 && Math.sin(t * 30) > 0) ctx.globalAlpha = 0.45;
    drawCrabBody(ctx, c.color, {
      build: SPECIES[c.species].build,
      walk: c.moving ? c.walk : 0,
      flash: c.hitFlash > 0,
      swing: c.swing > 0 ? 1 - c.swing / 0.24 : -1,
      swingSide: c.swingSide,
      weapon: c.weapon?.kind ?? null,
      shield: c.shield?.kind ?? null,
      guard: c.guardFlash > 0,
      king,
    });
    const saw = c.gear.find((g) => g.kind === "saw");
    if (saw) {
      // Spinning saw blade bolted to the claws (★3: oversized and gilded).
      const big = saw.lv >= 3 ? 1.45 : saw.lv === 2 ? 1.15 : 1;
      ctx.save();
      ctx.translate(CRAB_RADIUS * (1.55 + (big - 1) * 0.6), 0);
      ctx.rotate(t * (saw.lv >= 3 ? 34 : 24));
      ctx.scale(big, big);
      ctx.fillStyle = saw.lv >= 3 ? "#fcd34d" : "#cbd5e1";
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 ? 9 : 13;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#475569";
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawMutationAura(ctx: CanvasRenderingContext2D, c: Crab, t: number) {
  const r = CRAB_RADIUS * c.scale;
  const glow = (color: string, k: number, alpha: number) => {
    const R = r * k;
    const g = ctx.createRadialGradient(c.x, c.y, R * 0.35, c.x, c.y, R);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, color);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  if (hasMut(c, "capsule")) glow("#facc15", 2.4 + 0.15 * Math.sin(t * 8), 0.35);
  if (hasMut(c, "toxic")) glow("#84cc16", 1.8 + 0.2 * Math.sin(t * 11), 0.55);
  if (hasMut(c, "giant")) glow("#ef4444", 1.5, 0.3);
  if (hasMut(c, "salt")) glow("#f8fafc", 1.45, 0.55);
  if (hasMut(c, "pepper")) glow("#f97316", 1.6 + 0.2 * Math.sin(t * 25), 0.45);
  if (c.pearl > 0) {
    ctx.strokeStyle = `rgba(224,242,254,${0.55 + 0.2 * Math.sin(t * 4)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(186,230,253,0.18)";
    ctx.fill();
    for (let i = 0; i < c.pearl; i++) {
      const a = t * 2 + (i / Math.max(1, c.pearl)) * Math.PI * 2;
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(c.x + Math.cos(a) * r * 1.55, c.y + Math.sin(a) * r * 1.55, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  /** Species proportions (claw sizes, leg length, shell size). */
  build?: SpeciesDef["build"];
}

/**
 * Draws one crab in local space: facing +x, body radius ≈ CRAB_RADIUS (18u).
 * "Right" claw is +y (clockwise of facing), "left" claw is −y.
 */
export function drawCrabBody(ctx: CanvasRenderingContext2D, col: CrabColor, pose: CrabPose) {
  const legK = pose.build?.leg ?? 1, bodyK = pose.build?.body ?? 1;
  const clawL = pose.build?.clawL ?? 1, clawR = pose.build?.clawR ?? 1;
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
      const kx = bx + Math.cos(a1) * 11 * legK, ky = by + Math.sin(a1) * 11 * legK;
      const a2 = a1 + side * 0.7 - sw * 0.5;
      const fx = kx + Math.cos(a2) * 10 * legK, fy = ky + Math.sin(a2) * 10 * legK;
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
    const armLen = 14 * Math.sqrt(side === 1 ? clawR : clawL);
    const ex = sx + Math.cos(armA) * armLen * reach, ey = sy + Math.sin(armA) * armLen * reach;
    ctx.strokeStyle = shell;
    ctx.lineWidth = 5.5 * Math.sqrt(side === 1 ? clawR : clawL);
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
    const big = 1.15 * (side === 1 ? clawR : clawL);
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
    // 참게: furry "mittens" on the claw base.
    if (pose.build?.fur) {
      ctx.fillStyle = "rgba(40,30,20,0.75)";
      for (let i = 0; i < 6; i++) {
        const fa = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(ex + Math.cos(fa) * 4.5, ey + Math.sin(fa) * 4.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
  ctx.save();
  ctx.scale(bodyK, bodyK);
  if (pose.build?.spikes) {
    // 털게: bristly outline.
    ctx.fillStyle = dark;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const rx = R * 0.95, ry = R * 1.15;
      const bx = Math.cos(a) * rx, by = Math.sin(a) * ry;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(a + 1.4) * 2.2, by + Math.sin(a + 1.4) * 2.2);
      ctx.lineTo(Math.cos(a) * (rx + 5), Math.sin(a) * (ry + 5));
      ctx.lineTo(bx + Math.cos(a - 1.4) * 2.2, by + Math.sin(a - 1.4) * 2.2);
      ctx.fill();
    }
  }
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
  if (pose.build?.shell) {
    // 소라게: spiral whelk shell riding on the back.
    ctx.save();
    ctx.translate(-R * 0.55, 0);
    const sg = ctx.createRadialGradient(-3, -4, 2, 0, 0, R * 0.95);
    sg.addColorStop(0, pose.flash ? "#fff" : "#fdf4e3");
    sg.addColorStop(0.6, pose.flash ? "#fff" : "#e7c9a0");
    sg.addColorStop(1, pose.flash ? "#eee" : "#a47148");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.95, R * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,70,30,0.7)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = i * 0.42;
      const rr = R * 0.8 * (1 - i / 44);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.9;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
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
  ctx.restore();
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
  if (c.burrow > 0) return;
  if (holdsEpic(c)) {
    // Wanted poster: the bounty on this shell, growing the longer it survives.
    const bounty = epicBounty(c.level, c.epicT);
    const wanted = bounty >= EPIC_WANTED;
    const txt = `${wanted ? "🚨" : "💰"}${bounty.toLocaleString()}`;
    ctx.font = "900 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const bx = sx + Math.max(34, r * z * 2) / 2 + (c.hasKey ? 18 : 4);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(txt, bx, top - 4);
    ctx.fillStyle = wanted ? "#f87171" : "#fbbf24";
    ctx.fillText(txt, bx, top - 4);
    ctx.textAlign = "center";
  }
  const icons = [...c.gear.map((g) => GEARS[g.kind].emoji), ...c.muts.filter((m) => m.kind !== "oil").map((m) => MUTATIONS[m.kind].emoji)];
  if (c.slide) icons.push("🛢️");
  if (penaltyLeft(c, "rum") > 0) {
    // Drunken swirl over the head.
    ctx.fillStyle = "#c084fc";
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(a) * 12, top - 30 + Math.sin(a) * 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!icons.length) return;
  const sz = 13;
  const x0 = sx - (icons.length * (sz + 1)) / 2;
  icons.forEach((e, i) => ctx.drawImage(emojiSprite(e), x0 + i * (sz + 1), top - 22 - sz, sz, sz));
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
  for (const c of w.crabs) {
    if (c.isPlayer || !holdsEpic(c)) continue;
    const [x, y] = dot(c.x, c.y);
    // WANTED carriers (bounty ≥ EPIC_WANTED) get a bigger, faster, red-and-gold blip.
    const wanted = epicBounty(c.level, c.epicT) >= EPIC_WANTED;
    const ph = (t * (wanted ? 2.6 : 1.6) + c.id * 0.13) % 1;
    ctx.strokeStyle = wanted ? `rgba(239,68,68,${1 - ph})` : `rgba(251,191,36,${1 - ph})`;
    ctx.lineWidth = wanted ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(x, y, (wanted ? 5 : 3) + ph * (wanted ? 15 : 9), 0, Math.PI * 2);
    ctx.stroke();
    if (wanted) {
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = wanted ? "#ef4444" : "#fbbf24";
    ctx.beginPath();
    ctx.arc(x, y, wanted ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
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
export function drawCrabPreview(ctx: CanvasRenderingContext2D, col: CrabColor, W: number, H: number, t: number, opts: { weapon?: WeaponKind | null; shield?: ShieldKind | null; crown?: boolean; species?: SpeciesId } = {}) {
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
  drawCrabBody(ctx, col, { walk: t * 6, swing: sp < 1 ? sp : -1, swingSide: 1, weapon: opts.weapon ?? null, shield: opts.shield ?? null, build: SPECIES[opts.species ?? "flower"].build });
  ctx.restore();
  if (opts.crown) drawCrown(ctx, W / 2, H / 2 - 22 * s, 7 * s, t);
}
