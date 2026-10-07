/**
 * Canvas drawing for 랜덤 합성 디펜스. UI-only — free to use Math trig and
 * wall-clock time (the engine never imports this file).
 *
 * Everything is vector-drawn (no emoji, no image assets): towers are small
 * buildings on a pedestal whose material shows the grade, monsters are
 * hand-drawn critters. The static field (grass, cobbled road, stone pads) is
 * cached per pixel size so each frame only draws what moves.
 */

import {
  BOARD_H,
  BOARD_W,
  CELL,
  GRADE_COLORS,
  LOAD_LIMIT,
  PATH_LEN,
  ROAD,
  SLOTS,
  TICKS_PER_SEC,
  UNITS,
  fieldLoad,
  pathPoint,
  slotCenter,
  unitInterval,
  unitRange,
  type Board,
  type Mob,
  type Unit,
  type UnitKind,
} from "./engine";

export const SEAT_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24"];

export interface DrawOptions {
  /** 0..1 fraction of a tick elapsed since this state arrived — for smooth mob motion. */
  alpha: number;
  now: number;
  selected?: number | null;
  /** Empty cell picked as the next build spot. */
  buildSlot?: number | null;
  /** Slots that can merge with `selected`. */
  highlight?: Set<number>;
  mini?: boolean;
  /** Slot currently hovered while dragging. */
  dropTarget?: number | null;
  /** Last aim angle per slot (radians), from recent shots. */
  aim?: Record<number, number>;
}

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}

// ---------------------------------------------------------------------------
// Static field (cached)
// ---------------------------------------------------------------------------

const bgCache = new Map<string, HTMLCanvasElement>();

function fieldCanvas(scale: number, alive: boolean, mini: boolean): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const px = Math.max(1, Math.round(BOARD_W * scale));
  const key = `${px}:${alive ? 1 : 0}:${mini ? 1 : 0}`;
  const hit = bgCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = px;
  c.height = Math.max(1, Math.round(BOARD_H * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(px / BOARD_W, c.height / BOARD_H);
  paintField(ctx, alive, mini);
  if (bgCache.size > 24) bgCache.clear();
  bgCache.set(key, c);
  return c;
}

function paintField(ctx: Ctx, alive: boolean, mini: boolean) {
  const rnd = seeded(20261008);
  // Grass
  const g = ctx.createRadialGradient(BOARD_W / 2, BOARD_H / 2, 40, BOARD_W / 2, BOARD_H / 2, BOARD_W * 0.7);
  g.addColorStop(0, alive ? "#3f8a3a" : "#55565c");
  g.addColorStop(1, alive ? "#1f4d24" : "#2c2d31");
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, BOARD_W, BOARD_H, 18);
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, BOARD_W, BOARD_H, 18);
  ctx.clip();
  if (!mini) {
    // Mottled patches + blades
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(${alive ? "120,190,90" : "160,160,160"},${0.05 + rnd() * 0.07})`;
      ellipse(ctx, rnd() * BOARD_W, rnd() * BOARD_H, 14 + rnd() * 26, 8 + rnd() * 14);
      ctx.fill();
    }
    ctx.lineCap = "round";
    for (let i = 0; i < 220; i++) {
      const x = rnd() * BOARD_W;
      const y = rnd() * BOARD_H;
      const h = 3 + rnd() * 4;
      ctx.strokeStyle = alive ? `rgba(${150 + rnd() * 60},${210 + rnd() * 40},${110 + rnd() * 40},${0.25 + rnd() * 0.25})` : "rgba(200,200,200,0.15)";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (rnd() - 0.5) * 3, y - h * 0.6, x + (rnd() - 0.5) * 4, y - h);
      ctx.stroke();
    }
    if (alive) {
      // A few flowers
      for (let i = 0; i < 14; i++) {
        const x = rnd() * BOARD_W;
        const y = rnd() * BOARD_H;
        const col = ["#fde68a", "#fbcfe8", "#ffffff", "#c4b5fd"][Math.floor(rnd() * 4)];
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          ctx.fillStyle = col;
          ellipse(ctx, x + Math.cos(a) * 1.6, y + Math.sin(a) * 1.6, 1.3, 1.3);
          ctx.fill();
        }
        ctx.fillStyle = "#f59e0b";
        ellipse(ctx, x, y, 0.9, 0.9);
        ctx.fill();
      }
    }
  }

  // Cobbled road: dark kerb, packed earth, then stones.
  const rw = ROAD.x1 - ROAD.x0;
  const rh = ROAD.y1 - ROAD.y0;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 36;
  ctx.strokeRect(ROAD.x0, ROAD.y0 + 2, rw, rh);
  ctx.strokeStyle = alive ? "#6b5134" : "#4b4b4b";
  ctx.lineWidth = 32;
  ctx.strokeRect(ROAD.x0, ROAD.y0, rw, rh);
  ctx.strokeStyle = alive ? "#b48a58" : "#6f6f6f";
  ctx.lineWidth = 26;
  ctx.strokeRect(ROAD.x0, ROAD.y0, rw, rh);
  if (!mini) {
    for (let d = 0; d < PATH_LEN; d += 7) {
      const p = pathPoint(d);
      for (let k = 0; k < 2; k++) {
        const off = (rnd() - 0.5) * 20;
        const horizontal = p.y === ROAD.y0 || p.y === ROAD.y1;
        const x = p.x + (horizontal ? (rnd() - 0.5) * 4 : off);
        const y = p.y + (horizontal ? off : (rnd() - 0.5) * 4);
        const tone = 0.75 + rnd() * 0.3;
        ctx.fillStyle = alive ? `rgb(${Math.round(205 * tone)},${Math.round(178 * tone)},${Math.round(132 * tone)})` : `rgb(${Math.round(140 * tone)},${Math.round(140 * tone)},${Math.round(140 * tone)})`;
        roundRect(ctx, x - 3, y - 2.4, 5.5 + rnd() * 2, 4.4 + rnd() * 1.5, 2);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(x - 2.5, y + 1.6, 5, 0.9);
      }
    }
  }

  // Stone build pads
  for (let slot = 0; slot < SLOTS; slot++) {
    const c = slotCenter(slot);
    const s = CELL - 8;
    const x = c.x - s / 2;
    const y = c.y - s / 2;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    roundRect(ctx, x + 1, y + 3, s, s, 10);
    ctx.fill();
    const pad = ctx.createLinearGradient(x, y, x + s, y + s);
    pad.addColorStop(0, alive ? "#7c8696" : "#6b6b6b");
    pad.addColorStop(1, alive ? "#3d4350" : "#3a3a3a");
    ctx.fillStyle = pad;
    roundRect(ctx, x, y, s, s, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 1.5, y + 1.5, s - 3, s - 3, 9);
    ctx.stroke();
    if (!mini) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1.2;
      ellipse(ctx, c.x, c.y + 4, 15, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x - 6, c.y + 4);
      ctx.lineTo(c.x + 6, c.y + 4);
      ctx.moveTo(c.x, c.y + 0);
      ctx.lineTo(c.x, c.y + 8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function drawBoard(ctx: Ctx, board: Board, opts: DrawOptions) {
  const { now, mini } = opts;
  const scale = ctx.getTransform().a;
  const bg = fieldCanvas(scale, board.alive, !!mini);
  if (bg) ctx.drawImage(bg, 0, 0, BOARD_W, BOARD_H);
  else paintField(ctx, board.alive, !!mini);

  drawPortal(ctx, now, !!mini);

  // Danger vignette
  const load = fieldLoad(board) / LOAD_LIMIT;
  if (board.alive && load > 0.65) {
    const a = (load - 0.65) * 1.8 * (0.6 + 0.4 * Math.sin(now / 160));
    ctx.strokeStyle = `rgba(239,68,68,${Math.min(0.8, a)})`;
    ctx.lineWidth = 10;
    roundRect(ctx, 5, 5, BOARD_W - 10, BOARD_H - 10, 16);
    ctx.stroke();
  }

  // Cell overlays (selection / merge targets / build spot)
  for (let slot = 0; slot < SLOTS; slot++) {
    const c = slotCenter(slot);
    const s = CELL - 8;
    const x = c.x - s / 2;
    const y = c.y - s / 2;
    if (opts.highlight?.has(slot)) {
      const u = board.units[slot];
      ctx.strokeStyle = u ? GRADE_COLORS[u.grade] : "#fff";
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 140);
      ctx.lineWidth = 3;
      roundRect(ctx, x, y, s, s, 10);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (opts.dropTarget === slot) {
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      roundRect(ctx, x, y, s, s, 10);
      ctx.fill();
    }
    if (opts.buildSlot === slot) {
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -now / 50;
      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = 2.5;
      roundRect(ctx, x, y, s, s, 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(253,224,71,0.9)";
      ctx.font = "900 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+", c.x, c.y + 1);
    }
  }

  // Range preview for the selected unit / build spot.
  const rangeSlot = opts.selected ?? opts.buildSlot ?? null;
  if (rangeSlot !== null && !mini) {
    const u = board.units[rangeSlot];
    const c = slotCenter(rangeSlot);
    const r = u ? unitRange(u) : 140;
    ctx.fillStyle = rgba(u ? UNITS[u.kind].color : "#fde047", 0.07);
    ctx.strokeStyle = rgba(u ? UNITS[u.kind].color : "#fde047", 0.55);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Towers back-to-front so lower rows overlap the ones above.
  board.units.forEach((u, slot) => {
    if (!u) return;
    const c = slotCenter(slot);
    drawTower(ctx, c.x, c.y + 6, u, now, { mini, lifted: opts.selected === slot, aim: opts.aim?.[slot] });
  });

  // Mobs (oldest drawn last so the front of the line stays on top)
  const mobs = [...board.mobs].sort((a, b) => a.trav - b.trav);
  for (const m of mobs) {
    const slow = m.slowT > 0 ? m.slowPct : 0;
    const trav = m.trav + (m.speed * (1 - slow) * opts.alpha) / TICKS_PER_SEC;
    drawMob(ctx, m, trav, now, !!mini);
  }

  if (!board.alive) {
    ctx.fillStyle = "rgba(10,10,12,0.5)";
    roundRect(ctx, 0, 0, BOARD_W, BOARD_H, 18);
    ctx.fill();
    ctx.fillStyle = "#fecaca";
    ctx.font = "900 40px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("탈락", BOARD_W / 2, BOARD_H / 2);
  }
}

function drawPortal(ctx: Ctx, now: number, mini: boolean) {
  const x = ROAD.x0;
  const y = ROAD.y0;
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 24);
  glow.addColorStop(0, "rgba(245,208,254,0.95)");
  glow.addColorStop(0.45, "rgba(168,85,247,0.7)");
  glow.addColorStop(1, "rgba(76,29,149,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, Math.PI * 2);
  ctx.fill();
  if (mini) return;
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 3; i++) {
    ctx.rotate(now / (500 + i * 230));
    ctx.strokeStyle = `rgba(233,213,255,${0.65 - i * 0.18})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15 - i * 3.5, 6 - i, 0, 0.3, Math.PI * 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

/** Pedestal materials by grade: [light, dark, rim]. */
const MATERIAL: [string, string, string][] = [
  ["#000000", "#000000", "#000000"],
  ["#d1d5db", "#4b5563", "#9ca3af"], // 일반 — stone
  ["#bfdbfe", "#1e3a8a", "#60a5fa"], // 희귀 — blue steel
  ["#ddd6fe", "#4c1d95", "#a78bfa"], // 영웅 — arcane
  ["#fef3c7", "#92400e", "#fbbf24"], // 전설 — gold
  ["#ffe4e6", "#881337", "#fb7185"], // 신화 — prism (plus rainbow rim)
];

export function drawTower(ctx: Ctx, x: number, y: number, u: Unit, now: number, o: { mini?: boolean; lifted?: boolean; aim?: number; ghost?: boolean } = {}) {
  const sinceFire = unitInterval(u) - u.cd;
  const firing = !o.ghost && sinceFire <= 2;
  const [light, dark, rim] = MATERIAL[u.grade];
  ctx.save();
  ctx.translate(x, y + (o.lifted ? -4 : 0));
  if (o.lifted) ctx.scale(1.08, 1.08);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ellipse(ctx, 0, 11, 20, 6);
  ctx.fill();

  // Aura for 전설+
  if (u.grade >= 4 && !o.mini && !o.ghost) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const aura = ctx.createRadialGradient(0, -6, 4, 0, -6, 30);
    aura.addColorStop(0, rgba(GRADE_COLORS[u.grade], 0.35 + pulse * 0.2));
    aura.addColorStop(1, rgba(GRADE_COLORS[u.grade], 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, -6, 30, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pedestal: two-tier octagon
  const ped = ctx.createLinearGradient(-18, 0, 18, 12);
  ped.addColorStop(0, light);
  ped.addColorStop(1, dark);
  ctx.fillStyle = ped;
  octagon(ctx, 0, 6, 19, 7.5);
  ctx.fill();
  ctx.fillStyle = shade(dark, -0.2);
  ctx.fillRect(-19, 6, 38, 4);
  octagon(ctx, 0, 10, 19, 7.5);
  ctx.fill();
  ctx.fillStyle = ped;
  octagon(ctx, 0, 6, 19, 7.5);
  ctx.fill();
  if (u.grade === 5 && typeof ctx.createConicGradient === "function") {
    const cg = ctx.createConicGradient(now / 600, 0, 6);
    ["#f43f5e", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#a855f7", "#f43f5e"].forEach((c, i, arr) => cg.addColorStop(i / (arr.length - 1), c));
    ctx.strokeStyle = cg;
    ctx.lineWidth = 2.4;
  } else {
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.6;
  }
  octagon(ctx, 0, 6, 19, 7.5);
  ctx.stroke();

  // Grade gems on the front rim
  for (let i = 0; i < u.grade; i++) {
    const gx = (i - (u.grade - 1) / 2) * 6.5;
    ctx.fillStyle = GRADE_COLORS[u.grade];
    ctx.beginPath();
    ctx.moveTo(gx, 9.5);
    ctx.lineTo(gx + 2.2, 11.6);
    ctx.lineTo(gx, 13.7);
    ctx.lineTo(gx - 2.2, 11.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  if (o.ghost) ctx.globalAlpha *= 0.85;
  switch (u.kind) {
    case "archer":
      drawArcher(ctx, now, o.aim, firing, !!o.mini);
      break;
    case "mage":
      drawMage(ctx, now, firing, !!o.mini);
      break;
    case "frost":
      drawFrost(ctx, now, firing, !!o.mini);
      break;
    case "thunder":
      drawThunder(ctx, now, firing, !!o.mini);
      break;
    case "poison":
      drawPoison(ctx, now, firing, !!o.mini);
      break;
  }

  // Mythic sparkles
  if (u.grade === 5 && !o.mini && !o.ghost) {
    for (let i = 0; i < 4; i++) {
      const a = now / 700 + (i * Math.PI) / 2;
      const sx = Math.cos(a) * 20;
      const sy = -8 + Math.sin(a) * 7;
      star(ctx, sx, sy, 2.4, ["#fde68a", "#f9a8d4", "#a5f3fc", "#c4b5fd"][i]);
    }
  }
  ctx.restore();
}

function octagon(ctx: Ctx, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = cx + Math.cos(a) * rx;
    const py = cy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.35;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function drawArcher(ctx: Ctx, now: number, aim: number | undefined, firing: boolean, mini: boolean) {
  // Timber tower body
  const body = ctx.createLinearGradient(-10, 0, 10, 0);
  body.addColorStop(0, "#b7793f");
  body.addColorStop(0.5, "#8a5426");
  body.addColorStop(1, "#5a3414");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-11, 5);
  ctx.lineTo(-9, -14);
  ctx.lineTo(9, -14);
  ctx.lineTo(11, 5);
  ctx.closePath();
  ctx.fill();
  if (!mini) {
    ctx.strokeStyle = "rgba(40,20,5,0.55)";
    ctx.lineWidth = 0.8;
    for (const yy of [-8, -2]) {
      ctx.beginPath();
      ctx.moveTo(-10, yy);
      ctx.lineTo(10, yy);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-9, -14);
    ctx.lineTo(10, 4);
    ctx.moveTo(9, -14);
    ctx.lineTo(-10, 4);
    ctx.stroke();
  }
  // Battlement
  ctx.fillStyle = "#6b3f1a";
  ctx.fillRect(-12, -18, 24, 5);
  ctx.fillStyle = "#8a5426";
  for (let i = 0; i < 4; i++) ctx.fillRect(-12 + i * 6.6, -22, 4, 4.5);
  // Rotating crossbow
  const a = aim ?? -Math.PI / 2 + Math.sin(now / 900) * 0.3;
  ctx.save();
  ctx.translate(0, -19);
  ctx.rotate(a + Math.PI / 2);
  const recoil = firing ? 2 : 0;
  ctx.translate(0, recoil);
  ctx.fillStyle = "#3f2a14";
  ctx.fillRect(-1.6, -12, 3.2, 14);
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, -4, 9, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-7.4, -8.6);
  ctx.lineTo(0, firing ? -2 : 0);
  ctx.lineTo(7.4, -8.6);
  ctx.stroke();
  if (!firing) {
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(2, -11);
    ctx.lineTo(-2, -11);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawMage(ctx: Ctx, now: number, firing: boolean, mini: boolean) {
  // Slender spire
  const body = ctx.createLinearGradient(-8, 0, 8, 0);
  body.addColorStop(0, "#a78bfa");
  body.addColorStop(0.55, "#6d28d9");
  body.addColorStop(1, "#3b0764");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-10, 5);
  ctx.quadraticCurveTo(-7, -10, -3.5, -20);
  ctx.lineTo(3.5, -20);
  ctx.quadraticCurveTo(7, -10, 10, 5);
  ctx.closePath();
  ctx.fill();
  if (!mini) {
    ctx.fillStyle = "rgba(233,213,255,0.85)";
    ctx.font = "bold 6px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ᚱ", 0, -3);
    ctx.fillText("ᛟ", 0, -11);
  }
  // Prongs
  ctx.strokeStyle = "#c4b5fd";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-3.5, -20);
  ctx.quadraticCurveTo(-7, -25, -4, -30);
  ctx.moveTo(3.5, -20);
  ctx.quadraticCurveTo(7, -25, 4, -30);
  ctx.stroke();
  // Floating orb
  const bob = Math.sin(now / 300) * 1.8;
  const r = firing ? 6.5 : 5.2;
  const orb = ctx.createRadialGradient(-1.5, -29 + bob, 0.5, 0, -28 + bob, r + 4);
  orb.addColorStop(0, "#fdf4ff");
  orb.addColorStop(0.4, "#e879f9");
  orb.addColorStop(1, "rgba(168,85,247,0)");
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(0, -28 + bob, r + 4, 0, Math.PI * 2);
  ctx.fill();
  if (!mini) {
    for (let i = 0; i < 3; i++) {
      const a = now / 420 + (i * Math.PI * 2) / 3;
      ctx.fillStyle = "rgba(240,171,252,0.9)";
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 10, -28 + bob + Math.sin(a) * 3.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFrost(ctx: Ctx, now: number, firing: boolean, mini: boolean) {
  const shards: [number, number, number, number][] = [
    [-7, 5, 5, -17],
    [7, 5, 5, -14],
    [0, 5, 6.5, -27],
  ];
  for (const [sx, sy, w, top] of shards) {
    const g = ctx.createLinearGradient(sx - w, top, sx + w, sy);
    g.addColorStop(0, "#f0f9ff");
    g.addColorStop(0.5, "#7dd3fc");
    g.addColorStop(1, "#0369a1");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - w, sy);
    ctx.lineTo(sx - w * 0.7, top + 6);
    ctx.lineTo(sx, top);
    ctx.lineTo(sx + w * 0.7, top + 6);
    ctx.lineTo(sx + w, sy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(sx, top);
    ctx.lineTo(sx - w * 0.15, sy);
    ctx.stroke();
  }
  if (!mini) {
    const glint = (now / 900) % 1;
    ctx.fillStyle = `rgba(255,255,255,${0.9 - glint * 0.9})`;
    star(ctx, 2, -27 + glint * 8, 2.6, "rgba(255,255,255,0.9)");
    if (firing) {
      ctx.fillStyle = "rgba(186,230,253,0.5)";
      ellipse(ctx, 0, -10, 16, 13);
      ctx.fill();
    }
  }
}

function drawThunder(ctx: Ctx, now: number, firing: boolean, mini: boolean) {
  // Metal mast
  const mast = ctx.createLinearGradient(-4, 0, 4, 0);
  mast.addColorStop(0, "#e5e7eb");
  mast.addColorStop(0.5, "#9ca3af");
  mast.addColorStop(1, "#4b5563");
  ctx.fillStyle = mast;
  ctx.beginPath();
  ctx.moveTo(-8, 5);
  ctx.lineTo(-3, -20);
  ctx.lineTo(3, -20);
  ctx.lineTo(8, 5);
  ctx.closePath();
  ctx.fill();
  // Copper coils
  for (let i = 0; i < 3; i++) {
    const yy = -2 - i * 7;
    const w = 9 - i * 1.8;
    ctx.fillStyle = "#b45309";
    ellipse(ctx, 0, yy, w, 2.4);
    ctx.fill();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // Charged sphere
  const r = firing ? 6 : 4.8;
  const g = ctx.createRadialGradient(0, -24, 0.5, 0, -24, r + 3);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.45, "#fde047");
  g.addColorStop(1, "rgba(250,204,21,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -24, r + 3, 0, Math.PI * 2);
  ctx.fill();
  if (!mini) {
    // Crackling arcs
    const t = Math.floor(now / 90);
    ctx.strokeStyle = "rgba(254,249,195,0.9)";
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 2; i++) {
      const rnd = seeded(t * 7 + i * 13 + 1);
      const a0 = rnd() * Math.PI * 2;
      ctx.beginPath();
      let px = Math.cos(a0) * 5;
      let py = -24 + Math.sin(a0) * 5;
      ctx.moveTo(px, py);
      for (let k = 0; k < 3; k++) {
        px += Math.cos(a0) * 3 + (rnd() - 0.5) * 4;
        py += Math.sin(a0) * 3 + (rnd() - 0.5) * 4;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
}

function drawPoison(ctx: Ctx, now: number, firing: boolean, mini: boolean) {
  // Legs
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(-10, 6);
  ctx.moveTo(8, 0);
  ctx.lineTo(10, 6);
  ctx.stroke();
  // Cauldron
  const pot = ctx.createRadialGradient(-4, -8, 1, 0, -5, 14);
  pot.addColorStop(0, "#6b7280");
  pot.addColorStop(1, "#111827");
  ctx.fillStyle = pot;
  ctx.beginPath();
  ctx.ellipse(0, -5, 12, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#374151";
  ellipse(ctx, 0, -13, 12.5, 3.6);
  ctx.fill();
  // Liquid
  const wob = Math.sin(now / 220) * 0.6;
  ctx.fillStyle = "#4ade80";
  ellipse(ctx, 0, -13 + wob * 0.3, 10, 2.5);
  ctx.fill();
  ctx.fillStyle = "rgba(187,247,208,0.8)";
  ellipse(ctx, -3, -13.6, 3, 0.9);
  ctx.fill();
  if (!mini) {
    // Rising bubbles + fumes
    for (let i = 0; i < 4; i++) {
      const t = ((now / (700 + i * 90) + i * 0.27) % 1) * (firing ? 1.4 : 1);
      ctx.fillStyle = `rgba(74,222,128,${0.85 - t * 0.85})`;
      ctx.beginPath();
      ctx.arc((i - 1.5) * 4 + Math.sin(now / 200 + i) * 1.5, -15 - t * 16, 1.4 + t * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(-1.8, -5, 1.6, 0, Math.PI * 2);
    ctx.arc(1.8, -5, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-1.5, -3.6, 3, 1.6);
  }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

function drawMob(ctx: Ctx, m: Mob, trav: number, now: number, mini: boolean) {
  const p = pathPoint(trav);
  const ahead = pathPoint(trav + 4);
  const dx = ahead.x - p.x;
  const facing = dx < -0.1 ? -1 : 1;
  ctx.save();
  ctx.translate(p.x, p.y);

  const size = { normal: 9, fast: 8, tank: 12, boss: 19, elite: 12, invader: 13 }[m.kind];
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ellipse(ctx, 0, size * 0.75, size * 0.95, size * 0.32);
  ctx.fill();

  if ((m.kind === "elite" || m.kind === "invader") && m.from >= 0) {
    const pulse = 0.6 + 0.4 * Math.sin(now / 150 + m.id);
    ctx.strokeStyle = rgba(SEAT_COLORS[m.from] ?? "#ffffff", pulse);
    ctx.lineWidth = 2;
    ellipse(ctx, 0, size * 0.6, size * 1.15, size * 0.45);
    ctx.stroke();
  }

  ctx.save();
  ctx.scale(facing, 1);
  switch (m.kind) {
    case "normal":
      drawSlime(ctx, m, now, mini);
      break;
    case "fast":
      drawBat(ctx, m, now, mini);
      break;
    case "tank":
      drawBeetle(ctx, m, now, mini);
      break;
    case "boss":
      drawDemon(ctx, m, now, mini);
      break;
    case "elite":
      drawOgre(ctx, m, now, mini);
      break;
    case "invader":
      drawInvader(ctx, m, now, mini);
      break;
  }
  ctx.restore();

  // Status overlays
  if (m.slowT > 0) {
    ctx.strokeStyle = "rgba(186,230,253,0.9)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const a = now / 500 + (i * Math.PI * 2) / 3;
      star(ctx, Math.cos(a) * size, -size * 0.2 + Math.sin(a) * size * 0.4, 1.8, "rgba(224,242,254,0.95)");
    }
  }
  if (m.poisonT > 0 && !mini) {
    for (let i = 0; i < 3; i++) {
      const t = (now / 600 + i / 3) % 1;
      ctx.fillStyle = `rgba(74,222,128,${0.9 - t})`;
      ctx.beginPath();
      ctx.arc((i - 1) * size * 0.5, -size - t * 9, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // HP bar
  if (m.hp < m.maxHp) {
    const w = m.kind === "boss" ? 46 : Math.max(16, size * 2.2);
    const top = -size - (m.kind === "boss" ? 20 : 9);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    roundRect(ctx, -w / 2 - 1, top - 1, w + 2, 5, 2);
    ctx.fill();
    const frac = Math.max(0, m.hp / m.maxHp);
    const hp = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    const col = frac > 0.5 ? ["#86efac", "#16a34a"] : frac > 0.25 ? ["#fde68a", "#d97706"] : ["#fca5a5", "#dc2626"];
    hp.addColorStop(0, col[0]);
    hp.addColorStop(1, col[1]);
    ctx.fillStyle = hp;
    roundRect(ctx, -w / 2, top, Math.max(1, w * frac), 3, 1.5);
    ctx.fill();
  }
  ctx.restore();
}

function eyes(ctx: Ctx, x: number, y: number, gap: number, r: number, iris = "#111827", sclera = "#ffffff") {
  for (const s of [-1, 1]) {
    ctx.fillStyle = sclera;
    ellipse(ctx, x + s * gap, y, r, r * 1.15);
    ctx.fill();
    ctx.fillStyle = iris;
    ellipse(ctx, x + s * gap + r * 0.35, y + r * 0.1, r * 0.55, r * 0.65);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ellipse(ctx, x + s * gap + r * 0.1, y - r * 0.35, r * 0.22, r * 0.22);
    ctx.fill();
  }
}

function drawSlime(ctx: Ctx, m: Mob, now: number, mini: boolean) {
  const t = Math.sin(now / 130 + m.id);
  const sx = 1 + t * 0.09;
  const sy = 1 - t * 0.09;
  const g = ctx.createRadialGradient(-3, -5, 1, 0, -1, 12);
  g.addColorStop(0, "#d9f99d");
  g.addColorStop(0.5, "#65a30d");
  g.addColorStop(1, "#365314");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-9 * sx, 6);
  ctx.bezierCurveTo(-11 * sx, -2 * sy, -6 * sx, -12 * sy, 0, -12 * sy);
  ctx.bezierCurveTo(6 * sx, -12 * sy, 11 * sx, -2 * sy, 9 * sx, 6);
  ctx.quadraticCurveTo(0, 8.5, -9 * sx, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ellipse(ctx, -3.5, -7 * sy, 2.6, 1.6);
  ctx.fill();
  if (!mini) {
    eyes(ctx, 1, -2, 3.2, 2);
    ctx.strokeStyle = "#1a2e05";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(1.5, 2, 1.8, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
}

function drawBat(ctx: Ctx, m: Mob, now: number, mini: boolean) {
  const flap = Math.sin(now / 55 + m.id);
  const lift = -3 + flap * 1.5;
  ctx.translate(0, lift - 3);
  // Wings
  ctx.fillStyle = "#7c2d12";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 7, -8 - flap * 5, s * 14, -4 - flap * 6);
    ctx.lineTo(s * 11, 0 - flap * 2);
    ctx.lineTo(s * 8, 2);
    ctx.lineTo(s * 5, 0);
    ctx.closePath();
    ctx.fill();
  }
  // Body
  const g = ctx.createRadialGradient(-1, -2, 0.5, 0, 0, 7);
  g.addColorStop(0, "#fcd34d");
  g.addColorStop(1, "#b45309");
  ctx.fillStyle = g;
  ellipse(ctx, 0, 0, 5.5, 6);
  ctx.fill();
  // Ears
  ctx.beginPath();
  ctx.moveTo(-3.5, -4);
  ctx.lineTo(-2.5, -9);
  ctx.lineTo(-0.8, -5);
  ctx.moveTo(3.5, -4);
  ctx.lineTo(2.5, -9);
  ctx.lineTo(0.8, -5);
  ctx.fill();
  if (!mini) eyes(ctx, 0.8, -1, 2.2, 1.5, "#7f1d1d", "#fef08a");
  // Speed streaks
  ctx.strokeStyle = "rgba(253,230,138,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-9, 3);
  ctx.lineTo(-15, 3);
  ctx.moveTo(-8, -1);
  ctx.lineTo(-13, -1);
  ctx.stroke();
}

function drawBeetle(ctx: Ctx, m: Mob, now: number, mini: boolean) {
  const step = Math.sin(now / 110 + m.id);
  // Legs
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1.6;
  for (let i = -1; i <= 1; i++) {
    const off = (i % 2 === 0 ? step : -step) * 1.5;
    ctx.beginPath();
    ctx.moveTo(i * 5, 3);
    ctx.lineTo(i * 6 + off, 8);
    ctx.stroke();
  }
  // Armoured shell
  const g = ctx.createLinearGradient(0, -14, 0, 6);
  g.addColorStop(0, "#cbd5e1");
  g.addColorStop(0.5, "#64748b");
  g.addColorStop(1, "#1e293b");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-13, 4);
  ctx.bezierCurveTo(-13, -12, 11, -14, 13, 2);
  ctx.lineTo(13, 4);
  ctx.closePath();
  ctx.fill();
  if (!mini) {
    ctx.strokeStyle = "rgba(15,23,42,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-1, -11);
    ctx.lineTo(-2, 4);
    ctx.moveTo(-9, -6);
    ctx.quadraticCurveTo(-1, -4, 10, -7);
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    for (const [rx, ry] of [
      [-7, -2],
      [4, -3],
      [-3, -7],
    ]) {
      ellipse(ctx, rx, ry, 1.1, 1.1);
      ctx.fill();
    }
  }
  // Head + horn
  ctx.fillStyle = "#334155";
  ellipse(ctx, 13, 0, 5, 4.5);
  ctx.fill();
  ctx.fillStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(15, -3);
  ctx.quadraticCurveTo(21, -8, 19, -12);
  ctx.quadraticCurveTo(18, -6, 13, -4);
  ctx.closePath();
  ctx.fill();
  if (!mini) {
    ctx.fillStyle = "#fca5a5";
    ellipse(ctx, 15, -0.5, 1.2, 1.2);
    ctx.fill();
  }
}

function drawDemon(ctx: Ctx, m: Mob, now: number, mini: boolean) {
  const breathe = 1 + Math.sin(now / 400) * 0.04;
  // Dark aura
  const aura = ctx.createRadialGradient(0, -4, 6, 0, -4, 30);
  aura.addColorStop(0, "rgba(124,58,237,0.45)");
  aura.addColorStop(1, "rgba(124,58,237,0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, -4, 30, 0, Math.PI * 2);
  ctx.fill();
  if (!mini) {
    ctx.strokeStyle = `rgba(216,180,254,${0.4 + 0.3 * Math.sin(now / 200)})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.lineDashOffset = now / 40;
    ellipse(ctx, 0, 14, 24, 7);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Cape
  ctx.fillStyle = "#450a0a";
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.quadraticCurveTo(-24, 8 + Math.sin(now / 160) * 2, -16, 14);
  ctx.lineTo(14, 14);
  ctx.quadraticCurveTo(10, 4, 12, -6);
  ctx.closePath();
  ctx.fill();
  // Body
  ctx.save();
  ctx.scale(breathe, breathe);
  const g = ctx.createRadialGradient(-5, -10, 2, 0, -2, 20);
  g.addColorStop(0, "#c084fc");
  g.addColorStop(0.55, "#6d28d9");
  g.addColorStop(1, "#2e1065");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-15, 12);
  ctx.bezierCurveTo(-19, -8, -10, -19, 0, -19);
  ctx.bezierCurveTo(10, -19, 19, -8, 15, 12);
  ctx.quadraticCurveTo(0, 16, -15, 12);
  ctx.fill();
  ctx.restore();
  // Horns
  ctx.fillStyle = "#fef3c7";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 8, -16);
    ctx.quadraticCurveTo(s * 18, -22, s * 17, -32);
    ctx.quadraticCurveTo(s * 13, -23, s * 4, -18);
    ctx.closePath();
    ctx.fill();
  }
  // Crown
  ctx.fillStyle = "#facc15";
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-7, -18);
  ctx.lineTo(-7, -25);
  ctx.lineTo(-3.5, -21);
  ctx.lineTo(0, -27);
  ctx.lineTo(3.5, -21);
  ctx.lineTo(7, -25);
  ctx.lineTo(7, -18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ef4444";
  ellipse(ctx, 0, -20.5, 1.3, 1.3);
  ctx.fill();
  // Glowing eyes + fangs
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#fef08a";
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = mini ? 0 : 8;
    ctx.beginPath();
    ctx.moveTo(s * 2 + 2, -8);
    ctx.lineTo(s * 8 + 2, -11);
    ctx.lineTo(s * 7 + 2, -6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#1e0535";
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.quadraticCurveTo(2, 5, 9, 0);
  ctx.quadraticCurveTo(2, 2, -5, 0);
  ctx.fill();
  ctx.fillStyle = "#fff";
  for (const fx of [-2, 6]) {
    ctx.beginPath();
    ctx.moveTo(fx, 0.6);
    ctx.lineTo(fx + 1.2, 3.6);
    ctx.lineTo(fx + 2.4, 0.9);
    ctx.fill();
  }
}

function drawOgre(ctx: Ctx, m: Mob, now: number, mini: boolean) {
  const bob = Math.abs(Math.sin(now / 140 + m.id)) * 1.5;
  ctx.translate(0, -bob);
  // Spiked back
  ctx.fillStyle = "#7f1d1d";
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI * 0.95 + i * 0.32;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9 - 2);
    ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15 - 2);
    ctx.lineTo(Math.cos(a + 0.18) * 9, Math.sin(a + 0.18) * 9 - 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(-3, -6, 1, 0, -1, 13);
  g.addColorStop(0, "#fca5a5");
  g.addColorStop(0.5, "#dc2626");
  g.addColorStop(1, "#7f1d1d");
  ctx.fillStyle = g;
  ellipse(ctx, 0, -1, 11, 11);
  ctx.fill();
  // Iron mask
  ctx.fillStyle = "#374151";
  roundRect(ctx, -2, -7, 12, 7, 2.5);
  ctx.fill();
  if (!mini) {
    ctx.fillStyle = "#fde047";
    ctx.fillRect(1, -5, 2.5, 1.5);
    ctx.fillRect(6, -5, 2.5, 1.5);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(2, 3);
    ctx.lineTo(3.5, 7);
    ctx.lineTo(5, 3);
    ctx.moveTo(6, 3);
    ctx.lineTo(7.5, 7);
    ctx.lineTo(9, 3);
    ctx.fill();
  }
}

function drawInvader(ctx: Ctx, m: Mob, now: number, mini: boolean) {
  // A corrupted copy of the tower that was sent, floating on dark smoke.
  const hover = Math.sin(now / 240 + m.id) * 1.5;
  ctx.fillStyle = "rgba(30,0,10,0.55)";
  for (let i = 0; i < 4; i++) {
    const t = (now / 500 + i / 4) % 1;
    ellipse(ctx, (i - 1.5) * 5, 6 - t * 4, 5 + t * 3, 3);
    ctx.fill();
  }
  const kind: UnitKind = m.unitKind ?? "archer";
  const grade = m.grade ?? 1;
  ctx.save();
  ctx.translate(0, hover - 2);
  ctx.scale(0.62, 0.62);
  drawTower(ctx, 0, 0, { kind, grade, cd: 99 }, now, { mini, ghost: true });
  ctx.restore();
  // Blood-red tint + skull mark
  ctx.fillStyle = "rgba(220,38,38,0.3)";
  ellipse(ctx, 0, -6 + hover, 12, 13);
  ctx.fill();
  if (!mini) {
    ctx.fillStyle = "#fee2e2";
    ctx.font = "900 8px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("☠", 0, -20 + hover);
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type Fx =
  | { type: "shot"; kind: UnitKind; grade: number; from: { x: number; y: number }; pts: number[]; t0: number; dur: number }
  | { type: "ring"; x: number; y: number; color: string; r0: number; r1: number; t0: number; dur: number }
  | { type: "spark"; x: number; y: number; color: string; t0: number; dur: number; seed: number }
  | { type: "text"; x: number; y: number; text: string; color: string; t0: number; dur: number; size: number };

export function drawFx(ctx: Ctx, fx: Fx[], now: number) {
  for (const f of fx) {
    const k = (now - f.t0) / f.dur;
    if (k < 0 || k > 1) continue;
    ctx.save();
    if (f.type === "shot") drawShot(ctx, f, k);
    else if (f.type === "ring") {
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * k, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.type === "spark") {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + f.seed;
        const d = 6 + k * (26 + (i % 3) * 8);
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 2.6 * (1 - k) + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) * 4;
      ctx.font = `900 ${f.size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      const y = f.y - k * 22;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.restore();
  }
}

function drawShot(ctx: Ctx, f: Extract<Fx, { type: "shot" }>, k: number) {
  const color = UNITS[f.kind].color;
  const tx = f.pts[0];
  const ty = f.pts[1];
  const fx = f.from.x;
  const fy = f.from.y;
  const width = 1.5 + f.grade * 0.6;
  switch (f.kind) {
    case "archer": {
      const shoot = (ex: number, ey: number, alpha: number) => {
        const head = Math.min(1, k * 1.7);
        const hx = fx + (ex - fx) * head;
        const hy = fy + (ey - fy) * head;
        const ang = Math.atan2(ey - fy, ex - fx);
        ctx.globalAlpha = alpha * (head >= 1 ? 1 - (k - 0.6) / 0.4 : 1);
        ctx.strokeStyle = "rgba(255,237,213,0.45)";
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(hx - Math.cos(ang) * 16, hy - Math.sin(ang) * 16);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(ang);
        ctx.fillStyle = "#78350f";
        ctx.fillRect(-9, -0.7, 9, 1.4);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(3, 0);
        ctx.lineTo(-1.5, -2.4);
        ctx.lineTo(-1.5, 2.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fef3c7";
        ctx.fillRect(-10, -1.8, 2.5, 3.6);
        ctx.restore();
      };
      shoot(tx, ty, 1);
      for (let i = 2; i < f.pts.length; i += 2) shoot(f.pts[i], f.pts[i + 1], 0.7);
      break;
    }
    case "mage": {
      if (k < 0.5) {
        const t = k / 0.5;
        ctx.fillStyle = "#f5d0fe";
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(fx + (tx - fx) * t, fy - 20 + (ty - fy + 20) * t - Math.sin(t * Math.PI) * 18, 3 + f.grade, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const t = (k - 0.5) / 0.5;
        ctx.globalAlpha = 1 - t;
        const r = 18 + t * (30 + f.grade * 5);
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, r);
        g.addColorStop(0, "rgba(250,232,255,0.9)");
        g.addColorStop(0.5, "rgba(168,85,247,0.55)");
        g.addColorStop(1, "rgba(168,85,247,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "frost": {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = width + 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(fx, fy - 18);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        star(ctx, tx + Math.cos(a) * 10 * k, ty + Math.sin(a) * 10 * k, 2.2, "#bae6fd");
      }
      break;
    }
    case "thunder": {
      ctx.globalAlpha = k < 0.5 ? 1 : (1 - k) * 2;
      ctx.strokeStyle = "#fef9c3";
      ctx.lineWidth = width;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      let px = fx;
      let py = fy - 24;
      ctx.moveTo(px, py);
      for (let i = 0; i < f.pts.length; i += 2) {
        const nx = f.pts[i];
        const ny = f.pts[i + 1];
        for (let s = 1; s <= 4; s++) {
          const t = s / 4;
          const jitter = s === 4 ? 0 : ((((i + s) * 7919) % 13) - 6) * 1.1;
          ctx.lineTo(px + (nx - px) * t + jitter, py + (ny - py) * t - jitter);
        }
        px = nx;
        py = ny;
      }
      ctx.stroke();
      break;
    }
    case "poison": {
      const t = Math.min(1, k * 1.5);
      ctx.fillStyle = color;
      ctx.globalAlpha = 1 - Math.max(0, k - 0.66) * 3;
      ctx.beginPath();
      ctx.arc(fx + (tx - fx) * t, fy - 14 + (ty - fy + 14) * t - Math.sin(t * Math.PI) * 24, 3 + f.grade * 0.6, 0, Math.PI * 2);
      ctx.fill();
      if (t >= 1) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(tx, ty, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}
