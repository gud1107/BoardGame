/**
 * Canvas 2D renderer for 배고픈 상어. Everything is drawn from vector
 * primitives in code (no image assets — see 저작권, 상표권.md). The canvas
 * paints the same underwater palette regardless of site light/dark theme,
 * same as `worm/WormCanvas.tsx`.
 */

import { seabedY, SEABED_BASE, SKY_TOP, SURFACE_Y, WORLD_W, type SharkDef } from "./data";
import { isDangerous, isEdible, mouthPos, type Entity, type World } from "./engine";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function viewHeightFor(def: SharkDef): number {
  return 760 + def.length * 2.6;
}

/** Smoothly follows the shark with a little velocity look-ahead. */
export function updateCamera(cam: Camera, w: World, viewW: number, viewH: number, dt: number) {
  const s = w.shark;
  const targetZoom = viewH / (viewHeightFor(w.def) * (s.boosting ? 1.08 : 1));
  cam.zoom += (targetZoom - cam.zoom) * Math.min(1, dt * 2);
  const tx = s.x + s.vx * 0.28;
  const ty = s.y + s.vy * 0.2;
  const k = Math.min(1, dt * 5);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  // Don't show beyond the world edges more than necessary.
  const halfW = viewW / 2 / cam.zoom;
  cam.x = Math.max(halfW - 200, Math.min(WORLD_W - halfW + 200, cam.x));
  const halfH = viewH / 2 / cam.zoom;
  cam.y = Math.max(SKY_TOP + halfH, Math.min(SEABED_BASE + 260 - halfH, cam.y));
}

const GOLD = "#facc15";

/** Deterministic hash → [0,1) for scenery placement. */
function h01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function drawWorld(ctx: CanvasRenderingContext2D, w: World, cam: Camera, vw: number, vh: number, t: number, dpr = 1) {
  const z = cam.zoom;
  const shakeX = w.shake > 0 ? (h01(t * 91) - 0.5) * w.shake : 0;
  const shakeY = w.shake > 0 ? (h01(t * 57 + 3) - 0.5) * w.shake : 0;
  const ox = vw / 2 - cam.x * z + shakeX;
  const oy = vh / 2 - cam.y * z + shakeY;
  const left = cam.x - vw / 2 / z - 60;
  const right = cam.x + vw / 2 / z + 60;
  const top = cam.y - vh / 2 / z - 60;
  const bottom = cam.y + vh / 2 / z + 60;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  ctx.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr);

  // ── Sky ──
  if (top < SURFACE_Y) {
    const sky = ctx.createLinearGradient(0, SKY_TOP, 0, SURFACE_Y);
    sky.addColorStop(0, "#0ea5e9");
    sky.addColorStop(0.7, "#7dd3fc");
    sky.addColorStop(1, "#e0f2fe");
    ctx.fillStyle = sky;
    ctx.fillRect(left, Math.max(SKY_TOP - 400, top), right - left, SURFACE_Y - Math.max(SKY_TOP - 400, top));
    // Sun + clouds (parallax 0.3).
    const px = cam.x * 0.7;
    ctx.fillStyle = "rgba(254,240,138,0.9)";
    ctx.beginPath();
    ctx.arc(px + 500, SKY_TOP + 260, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 14; i++) {
      const cx = i * 900 + 200 + px * 0.2 + ((t * 8) % 900);
      if (cx < left - 300 || cx > right + 300) continue;
      const cy = SKY_TOP + 180 + h01(i) * 300;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(cx + k * 45, cy + (k % 2) * 10, 60, 30, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Distant shoreline on the left edge of the world.
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.moveTo(-400, SURFACE_Y);
    ctx.quadraticCurveTo(0, -60, 240, SURFACE_Y);
    ctx.fill();
  }

  // ── Water column ──
  const wtop = Math.max(SURFACE_Y, top);
  if (bottom > SURFACE_Y) {
    const water = ctx.createLinearGradient(0, SURFACE_Y, 0, SEABED_BASE + 300);
    water.addColorStop(0, "#22b8e8");
    water.addColorStop(0.2, "#0679b8");
    water.addColorStop(0.47, "#0a4a78");
    water.addColorStop(0.73, "#082b4a");
    water.addColorStop(1, "#020617");
    ctx.fillStyle = water;
    ctx.fillRect(left, wtop, right - left, bottom - wtop);

    // Distant parallax ridges.
    ctx.fillStyle = "rgba(8,47,73,0.55)";
    ctx.beginPath();
    const par = 0.55;
    ctx.moveTo(left, bottom);
    for (let x = left; x <= right + 80; x += 80) {
      const wx = x * par + cam.x * (1 - par);
      ctx.lineTo(x, SEABED_BASE - 420 + Math.sin(wx * 0.002) * 180 + Math.sin(wx * 0.0071) * 60 + (cam.y - SEABED_BASE) * (1 - par) * 0.3);
    }
    ctx.lineTo(right + 80, bottom);
    ctx.fill();

    // Sun rays in the shallows.
    if (top < 900) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = Math.floor(left / 260) - 1; i < right / 260 + 1; i++) {
        const bx = i * 260 + Math.sin(t * 0.3 + i) * 40;
        const a = 0.05 + 0.04 * Math.sin(t * 0.7 + i * 1.7);
        const g = ctx.createLinearGradient(0, SURFACE_Y, 0, 900);
        g.addColorStop(0, `rgba(186,230,253,${a})`);
        g.addColorStop(1, "rgba(186,230,253,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx, SURFACE_Y);
        ctx.lineTo(bx + 60, SURFACE_Y);
        ctx.lineTo(bx + 200, 900);
        ctx.lineTo(bx + 60, 900);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── Seabed ──
  if (bottom > SEABED_BASE - 300) {
    const sand = ctx.createLinearGradient(0, SEABED_BASE - 200, 0, SEABED_BASE + 400);
    sand.addColorStop(0, "#3f3a2e");
    sand.addColorStop(1, "#0c0a09");
    ctx.fillStyle = sand;
    ctx.beginPath();
    ctx.moveTo(left, bottom + 400);
    const step = 24;
    for (let x = Math.floor(left / step) * step; x <= right + step; x += step) ctx.lineTo(x, seabedY(x));
    ctx.lineTo(right + step, bottom + 400);
    ctx.fill();
    // Kelp, coral and vents.
    for (let i = Math.floor(left / 110); i < right / 110; i++) {
      const x = i * 110 + h01(i) * 60;
      const y = seabedY(x);
      const r = h01(i + 0.5);
      if (r < 0.35) {
        ctx.strokeStyle = "rgba(34,197,94,0.55)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const hgt = 80 + h01(i * 3) * 160;
        for (let k = 1; k <= 6; k++) ctx.lineTo(x + Math.sin(t * 1.2 + k * 0.7 + i) * 10 * (k / 6), y - (hgt * k) / 6);
        ctx.stroke();
      } else if (r < 0.55) {
        ctx.fillStyle = ["#f472b6", "#fb923c", "#a78bfa"][i % 3];
        ctx.globalAlpha = 0.7;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.ellipse(x + k * 12 - 12, y - 14 - k * 4, 8, 18, (k - 1) * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (r > 0.9) {
        // Hydrothermal vent with a lava glow.
        ctx.fillStyle = "#292524";
        ctx.beginPath();
        ctx.moveTo(x - 30, y + 4);
        ctx.lineTo(x - 10, y - 50);
        ctx.lineTo(x + 10, y - 50);
        ctx.lineTo(x + 30, y + 4);
        ctx.fill();
        const glow = 0.5 + 0.3 * Math.sin(t * 3 + i);
        ctx.fillStyle = `rgba(249,115,22,${glow})`;
        ctx.beginPath();
        ctx.ellipse(x, y - 50, 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Entities ──
  const goldOn = w.gold.active;
  for (const e of w.entities) {
    if (!e.alive) continue;
    const r = e.def.radius * 3;
    if (e.x < left - r || e.x > right + r || e.y < top - r || e.y > bottom + r) continue;
    const edible = isEdible(w, e);
    drawEntity(ctx, e, t, goldOn && edible, w.gold.mega && goldOn);
  }

  // ── Shark ──
  drawPlayerShark(ctx, w, t);

  // ── Particles ──
  for (const p of w.particles) {
    if (p.x < left || p.x > right || p.y < top || p.y > bottom) continue;
    const a = Math.max(0, p.life / p.maxLife);
    if (p.kind === "flash") {
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      g.addColorStop(0, "rgba(255,247,237,1)");
      g.addColorStop(0.4, "rgba(251,146,60,0.8)");
      g.addColorStop(1, "rgba(251,146,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.4 - a * 0.4), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.globalAlpha = p.kind === "smoke" ? a * 0.5 : p.kind === "blood" ? a * 0.75 : a;
    ctx.fillStyle = p.color;
    const size = p.kind === "smoke" || p.kind === "blood" ? p.size * (1.8 - a) : p.size;
    if (p.kind === "bubble") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === "coin" || p.kind === "gold") {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, size * Math.abs(Math.cos(t * 8 + p.x)), size, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // ── Surface line ──
  if (top < SURFACE_Y + 40 && bottom > SURFACE_Y - 40) {
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(left, SURFACE_Y + 14);
    for (let x = Math.floor(left / 20) * 20; x <= right + 20; x += 20) ctx.lineTo(x, SURFACE_Y + Math.sin(x * 0.02 + t * 2.2) * 4 + Math.sin(x * 0.007 - t) * 3);
    ctx.lineTo(right + 20, SURFACE_Y + 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2.5 / Math.max(0.6, z);
    ctx.beginPath();
    for (let x = Math.floor(left / 20) * 20; x <= right + 20; x += 20) {
      const y = SURFACE_Y + Math.sin(x * 0.02 + t * 2.2) * 4 + Math.sin(x * 0.007 - t) * 3;
      if (x === Math.floor(left / 20) * 20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ── Float texts ──
  for (const ft of w.texts) {
    const a = Math.min(1, ft.life / 0.4);
    ctx.globalAlpha = a;
    ctx.font = `900 ${ft.size / Math.max(0.55, z) * 0.9}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4 / Math.max(0.55, z);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;

  // ── Screen-space overlays ──
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = (w.shark.x - cam.x) * z + vw / 2;
  const sy = (w.shark.y - cam.y) * z + vh / 2;

  // Depth darkness with a light bubble around the shark (spec: deep-water fog).
  const dark = Math.max(0, Math.min(0.9, (cam.y - 1100) / 2000));
  if (dark > 0.01) {
    const lightR = (230 + w.def.length * 1.4) * z;
    const g = ctx.createRadialGradient(sx, sy, lightR * 0.25, sx, sy, lightR * 1.6);
    g.addColorStop(0, "rgba(2,6,23,0)");
    g.addColorStop(1, `rgba(2,6,23,${dark})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    // Bioluminescent things glow through the dark.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const e of w.entities) {
      if (!e.alive) continue;
      const glow =
        e.kind === "angler" ? "rgba(253,224,71,0.55)"
        : e.kind === "greenJelly" ? "rgba(74,222,128,0.35)"
        : e.kind === "redJelly" ? "rgba(248,113,113,0.35)"
        : e.kind === "ghostShark" ? "rgba(186,230,253,0.25)"
        : e.kind === "rock" ? "rgba(249,115,22,0.5)"
        : null;
      if (!glow) continue;
      const ex = (e.x - cam.x) * z + vw / 2;
      const ey = (e.y - cam.y) * z + vh / 2;
      if (ex < -80 || ex > vw + 80 || ey < -80 || ey > vh + 80) continue;
      const lx = e.kind === "angler" ? ex + Math.cos(e.angle) * e.def.radius * 1.4 * z : ex;
      const ly = e.kind === "angler" ? ey - e.def.radius * 0.9 * z : ey;
      const rg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 40 * z + 10);
      rg.addColorStop(0, glow);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(lx - 60 * z - 10, ly - 60 * z - 10, 120 * z + 20, 120 * z + 20);
    }
    ctx.restore();
  }

  // Gold rush golden vignette.
  if (w.gold.active) {
    const pulse = 0.25 + 0.12 * Math.sin(t * 8);
    const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
    g.addColorStop(0, "rgba(250,204,21,0)");
    g.addColorStop(1, w.gold.mega ? `rgba(244,114,182,${pulse + 0.1})` : `rgba(250,204,21,${pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }

  // Hurt / starving red vignette + heartbeat pulse.
  const hpFrac = w.shark.hp / w.stats.maxHealth;
  const lowHp = hpFrac < 0.25 && !w.gold.active;
  const hurtA = w.shark.hurtFlash > 0 ? w.shark.hurtFlash * 1.2 : 0;
  const beat = lowHp ? Math.pow(Math.max(0, Math.sin(t * 7)), 6) * 0.45 + 0.15 : 0;
  const redA = Math.max(hurtA * 0.6, beat);
  if (redA > 0.01) {
    const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
    g.addColorStop(0, "rgba(220,38,38,0)");
    g.addColorStop(1, `rgba(220,38,38,${redA})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }
  if (w.shark.poison) {
    ctx.fillStyle = `rgba(74,222,128,${0.08 + 0.05 * Math.sin(t * 10)})`;
    ctx.fillRect(0, 0, vw, vh);
  }

  drawThreatArrows(ctx, w, cam, vw, vh, t);
  drawMinimap(ctx, w, vw, vh);
}

// ── Threat indicators ───────────────────────────────────────────────────────

function drawThreatArrows(ctx: CanvasRenderingContext2D, w: World, cam: Camera, vw: number, vh: number, t: number) {
  const z = cam.zoom;
  const s = w.shark;
  for (const e of w.entities) {
    if (!e.alive || !isDangerous(w, e)) continue;
    if (e.def.behavior !== "hunter" && e.kind !== "torpedo") continue;
    const dx = e.x - s.x, dy = e.y - s.y;
    const d = Math.hypot(dx, dy);
    if (d > 1300) continue;
    const ex = (e.x - cam.x) * z + vw / 2;
    const ey = (e.y - cam.y) * z + vh / 2;
    if (ex > 0 && ex < vw && ey > 0 && ey < vh) continue;
    const a = Math.atan2(ey - vh / 2, ex - vw / 2);
    const m = 26;
    const kx = Math.cos(a), ky = Math.sin(a);
    const scale = Math.min((vw / 2 - m) / Math.abs(kx || 1e-6), (vh / 2 - m) / Math.abs(ky || 1e-6));
    const ax = vw / 2 + kx * scale, ay = vh / 2 + ky * scale;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(a);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 10);
    ctx.fillStyle = e.kind === "torpedo" ? "#fb923c" : "#ef4444";
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -10);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 10);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ── Minimap ─────────────────────────────────────────────────────────────────

function drawMinimap(ctx: CanvasRenderingContext2D, w: World, vw: number, vh: number) {
  const mw = Math.min(190, vw * 0.3);
  const worldH = SEABED_BASE + 300 - SKY_TOP;
  const mh = (mw * worldH) / WORLD_W;
  const mx = vw - mw - 10;
  const my = vh - mh - 10;
  const kx = mw / WORLD_W, ky = mh / worldH;
  ctx.fillStyle = "rgba(2,6,23,0.55)";
  ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
  ctx.fillStyle = "rgba(56,189,248,0.25)";
  ctx.fillRect(mx, my + (SURFACE_Y - SKY_TOP) * ky, mw, mh - (SURFACE_Y - SKY_TOP) * ky);
  ctx.fillStyle = "rgba(120,113,108,0.8)";
  ctx.beginPath();
  ctx.moveTo(mx, my + mh);
  for (let x = 0; x <= WORLD_W; x += 300) ctx.lineTo(mx + x * kx, my + (seabedY(x) - SKY_TOP) * ky);
  ctx.lineTo(mx + mw, my + mh);
  ctx.fill();
  for (const e of w.entities) {
    if (!e.alive) continue;
    let c: string | null = null;
    if (e.kind === "chest") c = "#facc15";
    else if (e.def.toughness > 1 && isEdible(w, e)) c = "#4ade80";
    else if (e.def.behavior === "hunter" && isDangerous(w, e)) c = "#ef4444";
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(mx + e.x * kx - 1.5, my + (e.y - SKY_TOP) * ky - 1.5, 3, 3);
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(mx + w.shark.x * kx, my + (w.shark.y - SKY_TOP) * ky, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ── Player shark ────────────────────────────────────────────────────────────

function drawPlayerShark(ctx: CanvasRenderingContext2D, w: World, t: number) {
  const s = w.shark;
  const L = w.stats.length;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);
  if (Math.cos(s.angle) < 0) ctx.scale(1, -1);
  const open = s.jaw > 0 ? Math.sin((s.jaw / 0.22) * Math.PI) : nearPreyOpen(w);
  const speed = Math.hypot(s.vx, s.vy);
  const tailHz = 5 + speed / 60;
  if (w.gold.active) {
    ctx.shadowColor = w.gold.mega ? "#f472b6" : GOLD;
    ctx.shadowBlur = 30;
  }
  drawSharkShape(ctx, w.def, L, open, t * tailHz, s.hurtFlash > 0 && Math.floor(t * 30) % 2 === 0, w.gold.active);
  ctx.restore();
}

/** Mouth hangs slightly open while something edible is right in front. */
function nearPreyOpen(w: World): number {
  const m = mouthPos(w);
  const R = w.stats.eatRadius + 90;
  for (const e of w.entities) {
    if (!e.alive || !isEdible(w, e)) continue;
    if (Math.abs(e.x - m.x) < R && Math.abs(e.y - m.y) < R) return 0.55;
  }
  return 0.08;
}

export function drawSharkShape(
  ctx: CanvasRenderingContext2D,
  def: Pick<SharkDef, "id" | "colors">,
  L: number,
  open: number,
  phase: number,
  flash: boolean,
  gold: boolean,
) {
  const u = L;
  const [back, belly, accent] = def.colors;
  const swing = Math.sin(phase) * 0.28;

  // Tail fin.
  ctx.save();
  ctx.translate(-0.42 * u, 0);
  ctx.rotate(swing);
  ctx.fillStyle = gold ? "#ca8a04" : back;
  ctx.beginPath();
  ctx.moveTo(0.02 * u, -0.03 * u);
  ctx.quadraticCurveTo(-0.1 * u, -0.1 * u, -0.2 * u, -0.26 * u);
  ctx.quadraticCurveTo(-0.13 * u, -0.06 * u, -0.1 * u, 0);
  ctx.quadraticCurveTo(-0.13 * u, 0.06 * u, -0.15 * u, 0.15 * u);
  ctx.quadraticCurveTo(-0.06 * u, 0.06 * u, 0.02 * u, 0.03 * u);
  ctx.fill();
  ctx.restore();

  // Dorsal + pectoral fins.
  ctx.fillStyle = gold ? "#ca8a04" : back;
  ctx.beginPath();
  ctx.moveTo(0.06 * u, -0.13 * u);
  ctx.quadraticCurveTo(-0.02 * u, -0.2 * u, -0.1 * u, -0.33 * u);
  ctx.quadraticCurveTo(-0.1 * u, -0.2 * u, -0.16 * u, -0.1 * u);
  ctx.fill();
  const flap = Math.sin(phase * 0.5) * 0.04 * u;
  ctx.beginPath();
  ctx.moveTo(0.14 * u, 0.09 * u);
  ctx.quadraticCurveTo(0.06 * u, 0.2 * u + flap, -0.04 * u, 0.27 * u + flap);
  ctx.quadraticCurveTo(0.02 * u, 0.14 * u, 0.0 * u, 0.1 * u);
  ctx.fill();
  // Small second dorsal + anal fin.
  ctx.beginPath();
  ctx.moveTo(-0.3 * u, -0.06 * u);
  ctx.lineTo(-0.35 * u, -0.12 * u);
  ctx.lineTo(-0.37 * u, -0.05 * u);
  ctx.fill();

  // Body with counter-shading.
  const bodyGrad = ctx.createLinearGradient(0, -0.16 * u, 0, 0.14 * u);
  if (gold) {
    bodyGrad.addColorStop(0, "#a16207");
    bodyGrad.addColorStop(0.5, "#facc15");
    bodyGrad.addColorStop(1, "#fef9c3");
  } else {
    bodyGrad.addColorStop(0, back);
    bodyGrad.addColorStop(0.52, back);
    bodyGrad.addColorStop(0.62, belly);
    bodyGrad.addColorStop(1, belly);
  }
  ctx.fillStyle = flash ? "#fecaca" : bodyGrad;
  ctx.beginPath();
  ctx.moveTo(0.5 * u, 0.02 * u);
  ctx.quadraticCurveTo(0.4 * u, -0.16 * u, 0.1 * u, -0.155 * u);
  ctx.quadraticCurveTo(-0.2 * u, -0.13 * u, -0.42 * u, -0.035 * u);
  ctx.lineTo(-0.45 * u, 0);
  ctx.lineTo(-0.42 * u, 0.03 * u);
  ctx.quadraticCurveTo(-0.2 * u, 0.13 * u, 0.1 * u, 0.135 * u);
  ctx.quadraticCurveTo(0.3 * u, 0.13 * u, 0.44 * u, 0.07 * u);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // Species details.
  if (def.id === "tiger" && !gold) {
    ctx.strokeStyle = "rgba(28,25,23,0.55)";
    ctx.lineWidth = 0.025 * u;
    for (let i = 0; i < 6; i++) {
      const x = 0.12 * u - i * 0.08 * u;
      ctx.beginPath();
      ctx.moveTo(x, -0.13 * u + i * 0.01 * u);
      ctx.lineTo(x - 0.04 * u, -0.03 * u);
      ctx.stroke();
    }
  }
  if (def.id === "hammer") {
    ctx.fillStyle = gold ? "#eab308" : back;
    ctx.beginPath();
    ctx.ellipse(0.46 * u, -0.02 * u, 0.06 * u, 0.13 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (def.id === "megalodon" && !gold) {
    ctx.strokeStyle = "rgba(127,29,29,0.7)";
    ctx.lineWidth = 0.012 * u;
    ctx.beginPath();
    ctx.moveTo(0.05 * u, -0.1 * u);
    ctx.lineTo(-0.05 * u, -0.02 * u);
    ctx.moveTo(-0.1 * u, -0.09 * u);
    ctx.lineTo(-0.16 * u, -0.03 * u);
    ctx.stroke();
  }

  // Gills.
  ctx.strokeStyle = "rgba(15,23,42,0.45)";
  ctx.lineWidth = Math.max(1, 0.008 * u);
  for (let i = 0; i < 4; i++) {
    const x = 0.24 * u - i * 0.025 * u;
    ctx.beginPath();
    ctx.moveTo(x, -0.06 * u);
    ctx.quadraticCurveTo(x - 0.012 * u, 0, x, 0.05 * u);
    ctx.stroke();
  }

  // Mouth: hinge at (0.28u, 0.06u); lower jaw rotates open.
  const ang = open * 0.55;
  const hingeX = 0.27 * u, hingeY = 0.06 * u;
  const tipX = hingeX + Math.cos(ang) * 0.19 * u;
  const tipY = hingeY + Math.sin(ang) * 0.19 * u;
  if (open > 0.05) {
    ctx.fillStyle = "#450a0a";
    ctx.beginPath();
    ctx.moveTo(hingeX, hingeY);
    ctx.lineTo(0.47 * u, 0.045 * u);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 5; i++) {
      const f = (i + 0.5) / 5;
      const ux = hingeX + (0.47 * u - hingeX) * f, uy = hingeY + (0.045 * u - hingeY) * f;
      ctx.beginPath();
      ctx.moveTo(ux - 0.012 * u, uy);
      ctx.lineTo(ux + 0.012 * u, uy);
      ctx.lineTo(ux, uy + 0.03 * u * open + 0.008 * u);
      ctx.fill();
      const lx = hingeX + (tipX - hingeX) * f, ly = hingeY + (tipY - hingeY) * f;
      ctx.beginPath();
      ctx.moveTo(lx - 0.012 * u, ly);
      ctx.lineTo(lx + 0.012 * u, ly);
      ctx.lineTo(lx, ly - 0.03 * u * open - 0.008 * u);
      ctx.fill();
    }
  }
  ctx.fillStyle = gold ? "#fde68a" : belly;
  ctx.beginPath();
  ctx.moveTo(hingeX, hingeY);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - 0.04 * u, tipY + 0.03 * u);
  ctx.quadraticCurveTo(hingeX + 0.05 * u, hingeY + 0.07 * u, hingeX - 0.04 * u, hingeY + 0.05 * u);
  ctx.closePath();
  ctx.fill();

  // Eye.
  ctx.fillStyle = "#020617";
  ctx.beginPath();
  ctx.arc(0.34 * u, -0.045 * u, 0.024 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(0.345 * u, -0.052 * u, 0.008 * u, 0, Math.PI * 2);
  ctx.fill();
  void accent;
}

// ── Entities ────────────────────────────────────────────────────────────────

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, t: number, gold: boolean, mega: boolean) {
  const r = e.def.radius;
  ctx.save();
  ctx.translate(e.x, e.y);
  const faceLeft = Math.cos(e.angle) < 0;
  const col = gold ? GOLD : e.hitFlash > 0 ? "#fecaca" : e.def.color;
  if (gold) {
    ctx.shadowColor = mega ? "#f472b6" : GOLD;
    ctx.shadowBlur = 14;
  }
  switch (e.kind) {
    case "smallFish":
    case "grouper":
    case "tuna": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      const wag = Math.sin(e.phase * 14) * 0.3;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.25, r * (e.kind === "tuna" ? 0.5 : 0.62), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(-r * 1.1, 0);
      ctx.rotate(wag);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.8, -r * 0.6);
      ctx.lineTo(-r * 0.8, r * 0.6);
      ctx.fill();
      ctx.restore();
      if (e.kind === "tuna" && !gold) {
        ctx.fillStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.ellipse(0, r * 0.18, r * 1.1, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(r * 0.75, -r * 0.12, Math.max(1.2, r * 0.13), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "puffer": {
      const puff = 1 + 0.25 * Math.max(0, Math.sin(e.phase * 3));
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r * puff, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = gold ? "#a16207" : "#365314";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * puff, Math.sin(a) * r * puff);
        ctx.lineTo(Math.cos(a) * r * puff * 1.35, Math.sin(a) * r * puff * 1.35);
        ctx.stroke();
      }
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc((faceLeft ? -1 : 1) * r * 0.45, -r * 0.2, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "crab": {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.65, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i += 2)
        for (let k = 0; k < 3; k++) {
          const lx = i * (r * 0.4 + k * 3);
          ctx.beginPath();
          ctx.moveTo(lx, 0);
          ctx.lineTo(lx + i * 5, 6 + Math.sin(e.phase * 12 + k) * 2);
          ctx.stroke();
        }
      ctx.beginPath();
      ctx.arc(-r * 1.1, -r * 0.5, 3.5, 0, Math.PI * 2);
      ctx.arc(r * 1.1, -r * 0.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "swimmer":
    case "sailor":
    case "passenger": {
      if (faceLeft) ctx.scale(-1, 1);
      const stroke = Math.sin(e.phase * 6);
      ctx.fillStyle = gold ? GOLD : e.kind === "sailor" ? "#fb923c" : e.kind === "passenger" ? "#c084fc" : "#0ea5e9";
      ctx.fillRect(-r, -2, r * 1.6, 6); // torso (horizontal)
      ctx.fillStyle = gold ? "#fde68a" : "#fcd9b6";
      ctx.beginPath();
      ctx.arc(r * 0.85, -2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = gold ? "#fde68a" : "#fcd9b6";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(r * 0.4, 0);
      ctx.lineTo(r * 0.4 + stroke * 8, -8 + Math.abs(stroke) * 3);
      ctx.moveTo(-r, 2);
      ctx.lineTo(-r - 8, 2 + stroke * 4);
      ctx.stroke();
      if (e.kind === "sailor" && !gold) {
        ctx.fillStyle = "#facc15";
        ctx.fillRect(-r * 0.6, -4, r * 1.1, 3);
      }
      break;
    }
    case "diver":
    case "cageDiver": {
      if (e.kind === "cageDiver") {
        ctx.strokeStyle = gold ? GOLD : "#a1a1aa";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(-r + (i * r) / 2, -r);
          ctx.lineTo(-r + (i * r) / 2, r);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(0, -r - 400);
        ctx.strokeStyle = "rgba(161,161,170,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (faceLeft) ctx.scale(-1, 1);
      const kick = Math.sin(e.phase * 5) * 4;
      const s = e.kind === "cageDiver" ? 0.6 : 1;
      ctx.scale(s, s);
      ctx.fillStyle = gold ? GOLD : "#111827";
      ctx.fillRect(-12, -4, 20, 8);
      ctx.fillStyle = gold ? "#fde68a" : "#facc15";
      ctx.fillRect(-10, -9, 14, 5); // tank
      ctx.fillStyle = gold ? GOLD : "#fcd9b6";
      ctx.beginPath();
      ctx.arc(11, -1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(12, -4, 4, 4);
      ctx.fillStyle = gold ? GOLD : "#111827";
      ctx.beginPath();
      ctx.moveTo(-12, -2);
      ctx.lineTo(-22, -4 + kick);
      ctx.lineTo(-22, 4 + kick);
      ctx.fill();
      break;
    }
    case "greenJelly":
    case "redJelly": {
      const pulse = 1 + 0.12 * Math.sin(e.phase * 3);
      ctx.fillStyle = gold ? GOLD : e.kind === "greenJelly" ? "rgba(74,222,128,0.7)" : "rgba(248,113,113,0.7)";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * pulse, r * 0.75 / pulse, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const x = -r * 0.7 + (i * r * 1.4) / 4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let k = 1; k <= 4; k++) ctx.lineTo(x + Math.sin(e.phase * 3 + k + i) * 4, k * r * 0.45);
        ctx.stroke();
      }
      break;
    }
    case "mineS":
    case "mineM":
    case "mineL":
    case "mineXL": {
      ctx.strokeStyle = "rgba(82,82,91,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, r);
      ctx.lineTo(Math.sin(e.phase) * 4, r + 90);
      ctx.stroke();
      ctx.fillStyle = col;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.save();
        ctx.rotate(a);
        ctx.fillRect(r * 0.8, -2.5, r * 0.45, 5);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      const blink = Math.sin(e.phase * 5) > 0.3;
      ctx.fillStyle = blink ? "#ef4444" : "#7f1d1d";
      ctx.beginPath();
      ctx.arc(0, -r * 0.35, Math.max(2.5, r * 0.18), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "pelican": {
      if (faceLeft) ctx.scale(-1, 1);
      const flapA = Math.sin(e.phase * 8) * 10;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, -2);
      ctx.lineTo(-14, -12 - flapA);
      ctx.lineTo(6, -3);
      ctx.fill();
      ctx.fillStyle = gold ? "#ca8a04" : "#f59e0b";
      ctx.beginPath();
      ctx.moveTo(r * 0.8, -3);
      ctx.lineTo(r * 2.2, 1);
      ctx.lineTo(r * 0.8, 5);
      ctx.fill();
      break;
    }
    case "ray": {
      if (faceLeft) ctx.scale(-1, 1);
      const flapA = Math.sin(e.phase * 3) * 0.25;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.quadraticCurveTo(0, -r * (0.7 + flapA), -r * 0.6, 0);
      ctx.quadraticCurveTo(0, r * (0.5 - flapA), r, 0);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, 0);
      ctx.lineTo(-r * 1.8, Math.sin(e.phase * 2) * 5);
      ctx.stroke();
      break;
    }
    case "angler": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      ctx.fillStyle = gold ? GOLD : "#1e1b4b";
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e2e8f0";
      for (let i = 0; i < 6; i++) {
        const x = r * 0.35 + i * 3;
        ctx.beginPath();
        ctx.moveTo(x, r * 0.1);
        ctx.lineTo(x + 1.5, r * 0.35);
        ctx.lineTo(x + 3, r * 0.1);
        ctx.fill();
      }
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.7);
      ctx.quadraticCurveTo(r * 0.8, -r * 1.5, r * 1.4, -r * 0.9);
      ctx.stroke();
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(r * 1.4, -r * 0.9, 4 + Math.sin(e.phase * 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fef08a";
      ctx.beginPath();
      ctx.arc(r * 0.45, -r * 0.3, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "torpedo": {
      ctx.rotate(e.angle);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.8, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(r * 1.6, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "fishingBoat":
    case "yacht": {
      if (faceLeft) ctx.scale(-1, 1);
      const rock = Math.sin(e.phase * 1.3) * 0.05;
      ctx.rotate(rock);
      ctx.fillStyle = gold ? GOLD : e.kind === "yacht" ? "#f8fafc" : "#92400e";
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.2);
      ctx.lineTo(r * 1.1, -r * 0.2);
      ctx.lineTo(r * 0.7, r * 0.35);
      ctx.lineTo(-r * 0.85, r * 0.35);
      ctx.fill();
      ctx.fillStyle = gold ? "#fde68a" : e.kind === "yacht" ? "#0ea5e9" : "#fef3c7";
      ctx.fillRect(-r * 0.4, -r * 0.65, r * 0.7, r * 0.45);
      if (e.kind === "fishingBoat") {
        ctx.strokeStyle = "#57534e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, -r * 0.2);
        ctx.lineTo(-r * 1.2, -r * 1.1);
        ctx.lineTo(-r * 1.4, r * 0.8);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(-r * 0.3, -r * 0.55, r * 0.5, r * 0.15);
      }
      if (e.hp < e.def.toughness) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(-r * 0.6, -r * 1.05, r * 1.2, 5);
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(-r * 0.6, -r * 1.05, r * 1.2 * Math.max(0, e.hp / e.def.toughness), 5);
      }
      break;
    }
    case "smallShark":
    case "ghostShark": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      const def = e.kind === "ghostShark"
        ? { id: "ghost", colors: ["rgba(186,230,253,0.75)", "rgba(240,249,255,0.8)", "#0ea5e9"] as [string, string, string] }
        : { id: "small", colors: ["#6b7280", "#e5e7eb", "#111827"] as [string, string, string] };
      if (e.state === "chase" && !gold) {
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 16;
      }
      drawSharkShape(ctx, def, r * 3.2, e.state === "chase" ? 0.6 : 0.1, e.phase * 9, e.hitFlash > 0, gold);
      break;
    }
    case "submarine": {
      if (faceLeft) ctx.scale(-1, 1);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.3, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-r * 0.3, -r * 0.8, r * 0.55, r * 0.45);
      ctx.fillStyle = gold ? "#fde68a" : "#0f172a";
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(-r * 0.6 + i * r * 0.4, 0, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(-r * 1.3, 0);
      ctx.rotate(e.phase * 12);
      ctx.fillStyle = "#57534e";
      ctx.fillRect(-2, -r * 0.3, 4, r * 0.6);
      ctx.restore();
      if (e.hp < e.def.toughness) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(-r * 0.6, -r * 1.05, r * 1.2, 5);
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(-r * 0.6, -r * 1.05, r * 1.2 * Math.max(0, e.hp / e.def.toughness), 5);
      }
      break;
    }
    case "helicopter": {
      if (faceLeft) ctx.scale(-1, 1);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.8, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-r * 1.6, -r * 0.1, r * 1.0, r * 0.18);
      ctx.fillStyle = "#bae6fd";
      ctx.beginPath();
      ctx.ellipse(r * 0.35, -r * 0.05, r * 0.3, r * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 3;
      const blade = Math.cos(e.phase * 40) * r * 1.4;
      ctx.beginPath();
      ctx.moveTo(-blade, -r * 0.6);
      ctx.lineTo(blade, -r * 0.6);
      ctx.moveTo(0, -r * 0.45);
      ctx.lineTo(0, -r * 0.6);
      ctx.moveTo(-r * 0.4, r * 0.55);
      ctx.lineTo(r * 0.5, r * 0.55);
      ctx.stroke();
      if (e.hp < e.def.toughness) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(-r * 0.6, -r * 1.0, r * 1.2, 5);
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(-r * 0.6, -r * 1.0, r * 1.2 * Math.max(0, e.hp / e.def.toughness), 5);
      }
      break;
    }
    case "rock": {
      ctx.rotate(e.angle);
      ctx.fillStyle = gold ? GOLD : "#44403c";
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = r * (0.8 + h01(e.id + i) * 0.4);
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.fill();
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case "chest": {
      ctx.fillStyle = "#78350f";
      ctx.fillRect(-r, -r * 0.5, r * 2, r * 1.1);
      ctx.fillStyle = "#92400e";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.5, r, r * 0.45, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#facc15";
      ctx.fillRect(-r, -r * 0.2, r * 2, 3);
      ctx.fillRect(-3, -r * 0.35, 6, 8);
      const sp = 0.5 + 0.5 * Math.sin(t * 4 + e.id);
      ctx.fillStyle = `rgba(253,224,71,${sp})`;
      ctx.beginPath();
      ctx.arc(r * 0.7, -r * 0.9, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
