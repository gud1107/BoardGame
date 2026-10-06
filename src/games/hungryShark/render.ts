/**
 * Canvas 2D renderer for 배고픈 상어. Everything is drawn from vector
 * primitives in code (no image assets — see 저작권, 상표권.md). The canvas
 * paints the same underwater palette regardless of site light/dark theme,
 * same as `worm/WormCanvas.tsx`.
 */

import { activeGeometry, ceilingY, ENTITY_DEFS, isUnderIce, seabedExtent, seabedY, SEABED_BASE, SKY_TOP, SURFACE_Y, WORLD_W, worldBottom, ZONES, type EntityKind, type SharkDef } from "./data";
import { ICE_TOP, type Structure } from "./mapGeometry";
import { bodyLength, bodyScale, isCloaked, isDangerous, isEdible, mouthPos, type Entity, type World } from "./engine";
import { MARKER_COLORS, type Marker } from "./markers";

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
  const targetZoom = viewH / (viewHeightFor(w.def) * (s.boosting ? 1.08 : 1) * (bodyScale(w) > 1 ? 1.5 : 1));
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
  // Map-aware floor: 얼음 해협 trenches dip below the old fixed 3560 limit.
  cam.y = Math.max(SKY_TOP + halfH, Math.min(worldBottom() - halfH, cam.y));
}

const GOLD = "#facc15";

/** Deterministic hash → [0,1) for scenery placement. */
function h01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function drawWorld(ctx: CanvasRenderingContext2D, w: World, cam: Camera, vw: number, vh: number, t: number, dpr = 1, markers: Marker[] = []) {
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
  const pal = w.map.palette;

  // ── Sky ──
  if (top < SURFACE_Y) {
    const sky = ctx.createLinearGradient(0, SKY_TOP, 0, SURFACE_Y);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(0.7, pal.sky[1]);
    sky.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(left, Math.max(SKY_TOP - 400, top), right - left, SURFACE_Y - Math.max(SKY_TOP - 400, top));
    // Sun + clouds (parallax 0.3).
    const px = cam.x * 0.7;
    ctx.fillStyle = pal.sun;
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
    if (w.map.feature === "coral") {
      // Distant shoreline on the left edge of the world.
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.moveTo(-400, SURFACE_Y);
      ctx.quadraticCurveTo(0, -60, 240, SURFACE_Y);
      ctx.fill();
    } else if (w.map.feature === "iceSheet") drawAurora(ctx, left, right, top, t, cam.x);
    else drawStorm(ctx, left, right, top, t);
  }

  // ── Water column ──
  const wtop = Math.max(SURFACE_Y, top);
  if (bottom > SURFACE_Y) {
    const water = ctx.createLinearGradient(0, SURFACE_Y, 0, SEABED_BASE + 300);
    water.addColorStop(0, pal.water[0]);
    water.addColorStop(0.2, pal.water[1]);
    water.addColorStop(0.47, pal.water[2]);
    water.addColorStop(0.73, pal.water[3]);
    water.addColorStop(1, pal.water[4]);
    ctx.fillStyle = water;
    ctx.fillRect(left, wtop, right - left, bottom - wtop);

    // Distant parallax ridges.
    ctx.fillStyle = pal.ridge;
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
      const rayK = w.map.feature === "wrecks" ? 0.45 : 1;
      for (let i = Math.floor(left / 260) - 1; i < right / 260 + 1; i++) {
        const bx = i * 260 + Math.sin(t * 0.3 + i) * 40;
        if (isUnderIce(bx + 30)) continue; // light only falls through breathing holes
        const a = (0.05 + 0.04 * Math.sin(t * 0.7 + i * 1.7)) * rayK;
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
  if (bottom > seabedExtent().min - 20) {
    const sand = ctx.createLinearGradient(0, SEABED_BASE - 200, 0, SEABED_BASE + 400);
    sand.addColorStop(0, pal.sand[0]);
    sand.addColorStop(1, pal.sand[1]);
    ctx.fillStyle = sand;
    ctx.beginPath();
    ctx.moveTo(left, bottom + 400);
    const step = 24;
    for (let x = Math.floor(left / step) * step; x <= right + step; x += step) ctx.lineTo(x, seabedY(x));
    ctx.lineTo(right + step, bottom + 400);
    ctx.fill();
    if (w.map.feature === "iceSheet") drawIceFloorDecor(ctx, left, right, t);
    else if (w.map.feature === "wrecks") drawWreckFloorDecor(ctx, left, right, t);
    // Kelp, coral and vents (딥 블루 only).
    for (let i = Math.floor(left / 110); i < right / 110 && w.map.feature === "coral"; i++) {
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

  drawStructures(ctx, left, right, top, bottom, t);
  if (w.map.feature === "iceSheet" && top < 260) drawIceSheet(ctx, left, right, t);

  // ── Entities ──
  const goldOn = w.gold.active;
  for (const e of w.entities) {
    if (!e.alive) continue;
    const r = e.def.radius * 3;
    if (e.x < left - r || e.x > right + r || e.y < top - r || e.y > bottom + r) continue;
    const edible = isEdible(w, e);
    drawEntity(ctx, e, t, goldOn && edible, w.gold.mega && goldOn);
  }

  // Stunned (EMP / roar / ram): electric halo.
  for (const e of w.entities) {
    if (!e.alive || e.stun <= 0) continue;
    if (e.x < left || e.x > right || e.y < top || e.y > bottom) continue;
    ctx.strokeStyle = `rgba(103,232,249,${0.4 + 0.4 * Math.abs(Math.sin(t * 14 + e.id))})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.def.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawSafeZone(ctx, w, t);
  drawSkillFx(ctx, w, t);

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
  const dark = Math.max(0, Math.min(0.9, (cam.y - w.map.darknessStart) / 2000));
  if (dark > 0.01) {
    const lightR = (230 + bodyLength(w) * 1.4) * z;
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
        : e.kind === "goldenTuna" ? "rgba(250,204,21,0.55)"
        : e.kind === "giantSquid" ? "rgba(248,113,113,0.4)"
        : e.kind === "moray" ? "rgba(190,242,100,0.3)"
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

  // Reticles go on top of the depth darkness so they stay readable in the abyss.
  ctx.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr);
  drawMarkers(ctx, markers, z, t);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawThreatArrows(ctx, w, cam, vw, vh, t);
  if (w.skill.reveal > 0) drawSonar(ctx, w, cam, vw, vh, t);
  drawMinimap(ctx, w, vw, vh);
}

// ── Target Feed Indicator (world-space reticles) ────────────────────────────

function drawMarkers(ctx: CanvasRenderingContext2D, markers: Marker[], z: number, t: number) {
  if (!markers.length) return;
  const k = 1 / Math.max(0.45, z); // keep reticles/text roughly screen-constant
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const m of markers) {
    const e = m.e;
    const col = MARKER_COLORS[m.kind];
    const warn = m.kind === "danger";
    const blink = warn ? 0.55 + 0.45 * Math.abs(Math.sin(t * 7)) : 1;
    const r = e.def.radius + 9 * k;
    ctx.globalAlpha = 0.9 * blink;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2 * k;
    const shiny = m.kind === "gold" || m.kind === "mega";
    if (shiny) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
    }
    // Rotating dashed ring + 4 corner ticks (crosshair).
    ctx.setLineDash([7 * k, 5 * k]);
    ctx.lineDashOffset = -t * (warn ? 40 : 18) * k;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * (r + 3 * k), e.y + Math.sin(a) * (r + 3 * k));
      ctx.lineTo(e.x + Math.cos(a) * (r + 9 * k), e.y + Math.sin(a) * (r + 9 * k));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Label pill above the target.
    let ly = e.y - r - 22 * k;
    ctx.font = `800 ${12 * k}px system-ui, sans-serif`;
    const lw = ctx.measureText(m.label).width;
    ctx.font = `600 ${9.5 * k}px system-ui, sans-serif`;
    const sw = ctx.measureText(m.sub).width;
    const pw = Math.max(lw, sw) + 12 * k;
    const ph = 28 * k;
    // Clustered targets: stack overlapping pills upward instead of overdrawing.
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((p) => Math.abs(p.x - e.x) < (p.w + pw) / 2 && Math.abs(p.y - ly) < (p.h + ph) / 2);
      if (!hit) break;
      ly = hit.y - (hit.h + ph) / 2 - 3 * k;
    }
    placed.push({ x: e.x, y: ly, w: pw, h: ph });
    ctx.globalAlpha = 0.82 * (warn ? Math.max(0.75, blink) : 1);
    ctx.fillStyle = "rgba(2,6,23,0.78)";
    ctx.beginPath();
    ctx.roundRect(e.x - pw / 2, ly - ph / 2, pw, ph, 7 * k);
    ctx.fill();
    ctx.lineWidth = 1.2 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.font = `800 ${12 * k}px system-ui, sans-serif`;
    ctx.fillText(m.label, e.x, ly - 5.5 * k);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `600 ${9.5 * k}px system-ui, sans-serif`;
    ctx.fillText(m.sub, e.x, ly + 7 * k);
  }
  ctx.restore();
}

/** Draws one entity kind centered in a `size`×`size` box (bestiary icons). */
export function drawEntityIcon(ctx: CanvasRenderingContext2D, kind: EntityKind, size: number, t = 0) {
  const def = ENTITY_DEFS[kind];
  const e: Entity = {
    id: 1, kind, def, alive: true, x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: def.toughness,
    phase: t, timer: 0, attackCd: 0, hitFlash: 0, homeY: 0, dir: 1, state: "patrol", stun: 0,
  };
  // Visual extent in units of radius, per silhouette.
  const extent =
    kind === "smallShark" || kind === "ghostShark" ? 3.4
    : kind === "fishingBoat" || kind === "yacht" || kind === "submarine" ? 2.8
    : kind === "helicopter" ? 3.4
    : kind === "iceberg" ? 2.4
    : kind === "iceShard" ? 3
    : kind === "mastDebris" ? 3.6
    : kind === "orca" || kind === "narwhal" ? 3.4
    : kind === "giantSquid" || kind === "moray" ? 3.2
    : kind === "barracuda" || kind === "seal" ? 3
    : kind === "ray" || kind === "pelican" ? 3.2
    : kind.startsWith("mine") ? 2.8
    : 2.6;
  const scale = (size * 0.86) / (def.radius * extent);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, scale);
  drawEntity(ctx, e, t, false, false);
  ctx.restore();
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
  const worldH = worldBottom() + 40 - SKY_TOP;
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
  for (let x = 0; x <= WORLD_W; x += 100) ctx.lineTo(mx + x * kx, my + (seabedY(x) - SKY_TOP) * ky);
  ctx.lineTo(mx + mw, my + mh);
  ctx.fill();
  // Depth-zone boundaries (얕은 바다 | 산호초 | 심해 | 해구), drawn over water and seabed alike.
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const z of ZONES.slice(0, -1)) {
    const zy = my + (z.to - SKY_TOP) * ky;
    ctx.beginPath();
    ctx.moveTo(mx, zy);
    ctx.lineTo(mx + mw, zy);
    ctx.stroke();
  }
  ctx.restore();
  const geo = activeGeometry();
  if (geo.ice) {
    ctx.fillStyle = "rgba(240,249,255,0.85)";
    for (let x = 0; x < WORLD_W; x += 60) if (isUnderIce(x + 30)) ctx.fillRect(mx + x * kx, my + (SURFACE_Y - SKY_TOP) * ky - 1, 60 * kx + 0.5, 2.5);
  }
  ctx.fillStyle = "rgba(148,163,184,0.75)";
  for (const c of geo.colliders) ctx.fillRect(mx + c.x * kx - 0.75, my + (c.y - SKY_TOP) * ky - 0.75, 1.5, 1.5);
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

// ── Map scenery ─────────────────────────────────────────────────────────────

/** Solid level structures (icicles, ice pillars, hulls, masts) — same shapes physics collides with. */
function drawStructures(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, bottom: number, t: number) {
  for (const st of activeGeometry().structures) {
    const span = st.kind === "hull" ? st.len : st.kind === "mast" ? st.len * 0.6 : st.thick + 40;
    if (st.x + span < left || st.x - span > right) continue;
    const yTop = st.kind === "icicle" ? st.y : st.kind === "hull" ? st.y - st.len : st.y - st.len;
    const yBot = st.kind === "icicle" ? st.y + st.len : st.y + st.thick;
    if (yBot < top - 40 || yTop > bottom + 40) continue;
    switch (st.kind) {
      case "icicle": drawIcicle(ctx, st, t); break;
      case "icePillar": drawIcePillar(ctx, st); break;
      case "hull": drawHull(ctx, st, t); break;
      case "mast": drawMast(ctx, st, t); break;
    }
  }
}

function drawIcicle(ctx: CanvasRenderingContext2D, st: Structure, t: number) {
  const hw = st.thick / 2;
  const g = ctx.createLinearGradient(st.x - hw, 0, st.x + hw, 0);
  g.addColorStop(0, "rgba(186,230,253,0.85)");
  g.addColorStop(0.5, "rgba(240,249,255,0.95)");
  g.addColorStop(1, "rgba(125,211,252,0.8)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(st.x - hw, st.y);
  ctx.lineTo(st.x - hw * 0.35, st.y + st.len * 0.55);
  ctx.lineTo(st.x, st.y + st.len);
  ctx.lineTo(st.x + hw * 0.4, st.y + st.len * 0.6);
  ctx.lineTo(st.x + hw, st.y);
  ctx.closePath();
  ctx.fill();
  // Glint running down the edge.
  const k = (t * 0.25 + h01(st.seed)) % 1;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(st.x - hw * 0.3 * (1 - k), st.y + st.len * k * 0.9, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawIcePillar(ctx: CanvasRenderingContext2D, st: Structure) {
  const hw = st.thick / 2;
  const g = ctx.createLinearGradient(0, st.y, 0, st.y - st.len);
  g.addColorStop(0, "rgba(14,116,144,0.95)");
  g.addColorStop(1, "rgba(165,243,252,0.85)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(st.x - hw, st.y);
  for (let k = 1; k <= 6; k++) {
    const f = k / 6;
    ctx.lineTo(st.x - hw * (1 - f * 0.7) + (h01(st.seed * 7 + k) - 0.5) * 14, st.y - st.len * f);
  }
  ctx.lineTo(st.x + (h01(st.seed + 0.3) - 0.5) * 10, st.y - st.len - 26);
  for (let k = 6; k >= 1; k--) {
    const f = k / 6;
    ctx.lineTo(st.x + hw * (1 - f * 0.7) + (h01(st.seed * 5 + k) - 0.5) * 14, st.y - st.len * f);
  }
  ctx.lineTo(st.x + hw, st.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(240,249,255,0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(st.x - hw * 0.4, st.y - 10);
  ctx.lineTo(st.x - hw * 0.15, st.y - st.len * 0.9);
  ctx.stroke();
}

function drawHull(ctx: CanvasRenderingContext2D, st: Structure, t: number) {
  const L = st.len, H = st.thick;
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.rotate(st.angle);
  // Keel-up hull silhouette: flat deck line on top, rounded bilge below.
  ctx.fillStyle = "#2a2118";
  ctx.beginPath();
  ctx.moveTo(-L / 2, -H * 0.45);
  ctx.lineTo(L / 2 - H * 0.2, -H * 0.55);
  ctx.quadraticCurveTo(L / 2 + H * 0.35, -H * 0.5, L / 2 + H * 0.05, H * 0.1);
  ctx.quadraticCurveTo(L * 0.3, H * 0.55, 0, H * 0.55);
  ctx.quadraticCurveTo(-L * 0.4, H * 0.55, -L / 2, H * 0.15);
  ctx.closePath();
  ctx.fill();
  // Planks.
  ctx.strokeStyle = "rgba(120,90,60,0.45)";
  ctx.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(-L / 2 + 12, -H * 0.3 + k * H * 0.2);
    ctx.lineTo(L / 2 - 24, -H * 0.38 + k * H * 0.2);
    ctx.stroke();
  }
  // Portholes + a gaping torpedo hole with a faint glow inside.
  ctx.fillStyle = "#07080a";
  const ports = Math.max(3, Math.floor(L / 110));
  for (let k = 0; k < ports; k++) {
    ctx.beginPath();
    ctx.arc(-L * 0.38 + (k / ports) * L * 0.75, -H * 0.18, Math.max(5, H * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(L * 0.14, H * 0.12, H * 0.28, H * 0.22, 0.3, 0, Math.PI * 2);
  ctx.fill();
  const glow = 0.25 + 0.15 * Math.sin(t * 2 + st.seed);
  ctx.fillStyle = `rgba(250,204,21,${glow})`;
  ctx.beginPath();
  ctx.arc(L * 0.14, H * 0.15, H * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // Barnacles / rust streaks.
  ctx.fillStyle = "rgba(161,98,7,0.35)";
  for (let k = 0; k < 7; k++) {
    ctx.beginPath();
    ctx.arc(-L / 2 + h01(st.seed * 3 + k) * L, H * (0.1 + h01(st.seed + k) * 0.35), 4 + h01(k + st.seed) * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMast(ctx: CanvasRenderingContext2D, st: Structure, t: number) {
  const dx = Math.sin(st.angle), dy = -Math.cos(st.angle);
  const ex = st.x + dx * st.len, ey = st.y + dy * st.len;
  ctx.strokeStyle = "#3b2f22";
  ctx.lineWidth = st.thick;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(st.x, st.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // Yard arm + tattered sail.
  const yx = st.x + dx * st.len * 0.7, yy = st.y + dy * st.len * 0.7;
  ctx.lineWidth = st.thick * 0.5;
  ctx.beginPath();
  ctx.moveTo(yx - 70, yy + 8);
  ctx.lineTo(yx + 70, yy - 8);
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.fillStyle = "rgba(203,213,225,0.16)";
  ctx.beginPath();
  ctx.moveTo(yx - 60, yy + 10);
  ctx.quadraticCurveTo(yx + Math.sin(t + st.seed) * 14, yy + 90, yx - 30, yy + 150);
  ctx.lineTo(yx + 40, yy + 70 + Math.sin(t * 1.3 + st.seed) * 8);
  ctx.lineTo(yx + 60, yy - 6);
  ctx.closePath();
  ctx.fill();
}

/** 얼음 해협: the solid ice sheet with its jagged underside and breathing holes. */
function drawIceSheet(ctx: CanvasRenderingContext2D, left: number, right: number, t: number) {
  const step = 16;
  let x = Math.floor(left / step) * step;
  while (x <= right + step) {
    if (!isUnderIce(x)) { x += step; continue; }
    // One continuous ice run.
    const x0 = x;
    ctx.beginPath();
    ctx.moveTo(x0, ICE_TOP);
    const under: [number, number][] = [];
    while (x <= right + step && isUnderIce(x)) { under.push([x, ceilingY(x)]); x += step; }
    const x1 = x - step;
    ctx.lineTo(x1, ICE_TOP);
    for (let k = under.length - 1; k >= 0; k--) ctx.lineTo(under[k][0], under[k][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, ICE_TOP, 0, 120);
    g.addColorStop(0, "#f8fafc");
    g.addColorStop(0.35, "#bae6fd");
    g.addColorStop(1, "#38bdf8");
    ctx.fillStyle = g;
    ctx.fill();
    // Snow crust on top + cracks.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0, ICE_TOP - 6, x1 - x0, 7);
    ctx.strokeStyle = "rgba(14,116,144,0.35)";
    ctx.lineWidth = 2;
    for (let cx = Math.ceil(x0 / 170) * 170; cx < x1; cx += 170) {
      ctx.beginPath();
      ctx.moveTo(cx, ICE_TOP);
      ctx.lineTo(cx + 18, ICE_TOP + 30);
      ctx.lineTo(cx + 6, ceilingY(cx) - 6);
      ctx.stroke();
    }
  }
  void t;
}

/** Aurora curtains + snowfall over the frozen strait. */
function drawAurora(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, t: number, camX: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let band = 0; band < 3; band++) {
    ctx.beginPath();
    const base = SKY_TOP + 160 + band * 70;
    ctx.moveTo(left, base);
    for (let x = left; x <= right + 40; x += 40) {
      const wx = x * 0.8 + camX * 0.2;
      ctx.lineTo(x, base + Math.sin(wx * 0.003 + t * 0.4 + band) * 50 + Math.sin(wx * 0.011 - t * 0.7) * 16);
    }
    ctx.lineTo(right + 40, base + 220);
    ctx.lineTo(left, base + 220);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, base - 60, 0, base + 220);
    const c = band === 1 ? "167,139,250" : "74,222,128";
    g.addColorStop(0, `rgba(${c},0)`);
    g.addColorStop(0.3, `rgba(${c},0.22)`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  const y0 = Math.max(SKY_TOP, top);
  for (let i = 0; i < 70; i++) {
    const sx = left + ((h01(i) * 1.3 + t * 0.02 * (0.5 + h01(i + 1))) % 1) * (right - left);
    const sy = y0 + ((h01(i + 2) + t * 0.08 * (0.6 + h01(i + 3))) % 1) * (SURFACE_Y - y0);
    ctx.fillRect(sx, sy, 3, 3);
  }
}

/** Storm clouds, rain and the odd lightning flash over the wreck graveyard. */
function drawStorm(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, t: number) {
  const flash = Math.max(0, Math.sin(t * 0.9) * Math.sin(t * 7.3)) > 0.93;
  if (flash) {
    ctx.fillStyle = "rgba(226,232,240,0.35)";
    ctx.fillRect(left, Math.max(SKY_TOP - 400, top), right - left, SURFACE_Y - Math.max(SKY_TOP - 400, top));
  }
  ctx.fillStyle = "rgba(15,23,42,0.55)";
  for (let i = Math.floor(left / 500) - 1; i < right / 500 + 1; i++) {
    const cx = i * 500 + ((t * 14) % 500);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + k * 90, SKY_TOP + 130 + h01(i) * 60 + (k % 2) * 25, 130, 55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const y0 = Math.max(SKY_TOP + 160, top);
  for (let i = 0; i < 90; i++) {
    const rx = left + h01(i * 1.9) * (right - left);
    const ry = y0 + ((h01(i) + t * 1.4) % 1) * (SURFACE_Y - y0);
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx - 8, ry + 28);
  }
  ctx.stroke();
}

/** 얼음 해협 seabed: frosted boulders, ice crystals, pale sea grass. */
function drawIceFloorDecor(ctx: CanvasRenderingContext2D, left: number, right: number, t: number) {
  for (let i = Math.floor(left / 130); i < right / 130; i++) {
    const x = i * 130 + h01(i * 1.3) * 70;
    const y = seabedY(x);
    const r = h01(i + 0.7);
    if (r < 0.3) {
      ctx.fillStyle = "#64748b";
      ctx.beginPath();
      ctx.ellipse(x, y - 8, 26 + r * 40, 18 + r * 20, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(241,245,249,0.85)";
      ctx.beginPath();
      ctx.ellipse(x - 4, y - 18 - r * 18, 18 + r * 30, 7, 0, Math.PI, 0);
      ctx.fill();
    } else if (r < 0.5) {
      ctx.fillStyle = "rgba(165,243,252,0.75)";
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + (k - 1.5) * 0.35;
        const hgt = 30 + h01(i * 3 + k) * 40;
        ctx.beginPath();
        ctx.moveTo(x + k * 8 - 12, y);
        ctx.lineTo(x + k * 8 - 12 + Math.cos(a) * hgt - 5, y + Math.sin(a) * hgt);
        ctx.lineTo(x + k * 8 - 12 + Math.cos(a) * hgt + 5, y + Math.sin(a) * hgt);
        ctx.closePath();
        ctx.fill();
      }
    } else if (r < 0.65) {
      ctx.strokeStyle = "rgba(204,251,241,0.45)";
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 9, y);
        ctx.quadraticCurveTo(x + k * 9 + Math.sin(t + i + k) * 8, y - 30, x + k * 9 + Math.sin(t * 1.3 + i) * 12, y - 60 - k * 10);
        ctx.stroke();
      }
    }
  }
}

/** 난파선 무덤 seabed: bones, anchors, barrels, dead kelp. */
function drawWreckFloorDecor(ctx: CanvasRenderingContext2D, left: number, right: number, t: number) {
  for (let i = Math.floor(left / 120); i < right / 120; i++) {
    const x = i * 120 + h01(i * 2.1) * 60;
    const y = seabedY(x);
    const r = h01(i + 0.3);
    if (r < 0.18) {
      // Anchor.
      ctx.strokeStyle = "#57534e";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x, y - 70);
      ctx.lineTo(x, y - 6);
      ctx.moveTo(x - 26, y - 22);
      ctx.quadraticCurveTo(x, y + 6, x + 26, y - 22);
      ctx.moveTo(x - 14, y - 60);
      ctx.lineTo(x + 14, y - 60);
      ctx.stroke();
    } else if (r < 0.34) {
      // Barrel on its side.
      ctx.fillStyle = "#5b4636";
      ctx.beginPath();
      ctx.ellipse(x, y - 13, 22, 14, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#292524";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 26);
      ctx.lineTo(x - 7, y);
      ctx.moveTo(x + 8, y - 26);
      ctx.lineTo(x + 10, y);
      ctx.stroke();
    } else if (r < 0.48) {
      // Fish skeleton / bones.
      ctx.strokeStyle = "rgba(231,229,228,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 24, y - 6);
      ctx.lineTo(x + 20, y - 6);
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(x + k * 8, y - 14);
        ctx.lineTo(x + k * 8, y + 2);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(231,229,228,0.6)";
      ctx.beginPath();
      ctx.arc(x + 24, y - 6, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (r < 0.72) {
      // Dead, drooping kelp.
      ctx.strokeStyle = "rgba(101,84,46,0.6)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const hgt = 60 + h01(i * 3) * 110;
      for (let k = 1; k <= 5; k++) ctx.lineTo(x + Math.sin(t * 0.8 + k * 0.9 + i) * 7 * (k / 5) + k * 4, y - (hgt * k) / 5);
      ctx.stroke();
    }
  }
}

/** Start bubble (MapDef.safeStart): dashed shield ring + countdown, fading out in its last 3 seconds. */
function drawSafeZone(ctx: CanvasRenderingContext2D, w: World, t: number) {
  const sf = w.safe;
  if (!sf || w.time >= sf.until) return;
  const left = sf.until - w.time;
  const a = Math.min(1, left / 3);
  ctx.save();
  ctx.globalAlpha = a * (0.55 + 0.15 * Math.sin(t * 4));
  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 4;
  ctx.setLineDash([22, 16]);
  ctx.lineDashOffset = -t * 30;
  ctx.beginPath();
  ctx.arc(sf.x, sf.y, sf.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = a * 0.07;
  ctx.fillStyle = "#5eead4";
  ctx.fill();
  // The ring (650u) is wider than a small shark's view, so the countdown rides above the shark while it's inside.
  const s = w.shark;
  const inside = Math.hypot(s.x - sf.x, s.y - sf.y) < sf.r;
  const lx = inside ? s.x : sf.x;
  const ly = inside ? s.y - bodyLength(w) * 0.6 - 26 : sf.y - sf.r - 14;
  ctx.globalAlpha = a;
  ctx.font = "900 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  const label = `🛡 안전 구역 ${Math.ceil(left)}초`;
  ctx.strokeText(label, lx, ly);
  ctx.fillStyle = "#99f6e4";
  ctx.fillText(label, lx, ly);
  ctx.restore();
}

// ── Skill FX ────────────────────────────────────────────────────────────────

function drawSkillFx(ctx: CanvasRenderingContext2D, w: World, t: number) {
  for (const r of w.rings) {
    const k = 1 - r.life / r.maxLife;
    ctx.globalAlpha = Math.max(0, 1 - k) * 0.8;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 6 * (1 - k) + 1.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius * (0.15 + 0.85 * k), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const b of w.beams) {
    ctx.globalAlpha = Math.max(0, b.life / b.maxLife);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.zigzag ? 3 : 7;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    if (b.zigzag) {
      const n = 6;
      for (let i = 1; i < n; i++) {
        const f = i / n;
        const jitter = (h01(i * 13.7 + Math.floor(t * 30)) - 0.5) * 26;
        const nx = -(b.y2 - b.y1), ny = b.x2 - b.x1;
        const nl = Math.hypot(nx, ny) || 1;
        ctx.lineTo(b.x1 + (b.x2 - b.x1) * f + (nx / nl) * jitter, b.y1 + (b.y2 - b.y1) * f + (ny / nl) * jitter);
      }
    }
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    if (!b.zigzag) {
      // Snap-jaw head at the tip.
      ctx.fillStyle = "#fce7f3";
      ctx.beginPath();
      ctx.arc(b.x2, b.y2, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  if (w.skill.id === "blizzard" && w.skill.active > 0) {
    const fade = Math.min(1, w.skill.active / 0.5);
    const bx = w.shark.x, by = w.shark.y;
    const g = ctx.createRadialGradient(bx, by, 60, bx, by, 520);
    g.addColorStop(0, `rgba(224,242,254,${0.05 * fade})`);
    g.addColorStop(0.55, `rgba(186,230,253,${0.16 * fade})`);
    g.addColorStop(1, "rgba(186,230,253,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, 520, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(224,242,254,${0.45 * fade})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const a0 = -t * 3 + (i * Math.PI * 2) / 3;
      ctx.arc(bx, by, 280 + i * 80, a0, a0 + 1.2);
      ctx.stroke();
    }
  }
  const v = w.skill.vortex;
  if (v) {
    const fade = Math.min(1, v.remaining / 0.5);
    const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.radius);
    g.addColorStop(0, `rgba(2,0,10,${0.95 * fade})`);
    g.addColorStop(0.18, `rgba(76,29,149,${0.8 * fade})`);
    g.addColorStop(0.6, `rgba(168,85,247,${0.25 * fade})`);
    g.addColorStop(1, "rgba(168,85,247,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(v.x, v.y, v.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(216,180,254,${0.6 * fade})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const a0 = t * 5 + (i * Math.PI) / 2;
      ctx.arc(v.x, v.y, v.radius * (0.3 + i * 0.16), a0, a0 + 1.6);
      ctx.stroke();
    }
  }
}

/** 소나 펄스: edge-of-screen arrows to chests, golden tuna and big edible prey. */
function drawSonar(ctx: CanvasRenderingContext2D, w: World, cam: Camera, vw: number, vh: number, t: number) {
  const z = cam.zoom;
  const s = w.shark;
  const picks: { e: Entity; color: string; label: string }[] = [];
  for (const e of w.entities) {
    if (!e.alive) continue;
    if (e.kind === "chest") picks.push({ e, color: "#facc15", label: "🎁" });
    else if (e.kind === "goldenTuna") picks.push({ e, color: "#fde047", label: "🐟" });
    else if (e.def.toughness > 1 && isEdible(w, e)) picks.push({ e, color: "#4ade80", label: "🍖" });
  }
  picks.sort((a, b) => Math.hypot(a.e.x - s.x, a.e.y - s.y) - Math.hypot(b.e.x - s.x, b.e.y - s.y));
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 11px system-ui, sans-serif";
  for (const { e, color, label } of picks.slice(0, 8)) {
    const ex = (e.x - cam.x) * z + vw / 2;
    const ey = (e.y - cam.y) * z + vh / 2;
    const onScreen = ex > 0 && ex < vw && ey > 0 && ey < vh;
    const a = Math.atan2(ey - vh / 2, ex - vw / 2);
    const m = 40;
    const kx = Math.cos(a), ky = Math.sin(a);
    const sc = Math.min((vw / 2 - m) / Math.abs(kx || 1e-6), (vh / 2 - m) / Math.abs(ky || 1e-6));
    const ax = onScreen ? ex : vw / 2 + kx * sc;
    const ay = onScreen ? ey : vh / 2 + ky * sc;
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ax, ay, 14 + 3 * Math.sin(t * 6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(2,6,23,0.6)";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, ax, ay);
    if (!onScreen) {
      const dm = Math.round(Math.hypot(e.x - s.x, e.y - s.y) / 10);
      ctx.fillStyle = color;
      ctx.fillText(`${dm}m`, ax, ay + 24);
    }
  }
  ctx.restore();
}

// ── Player shark ────────────────────────────────────────────────────────────

function drawPlayerShark(ctx: CanvasRenderingContext2D, w: World, t: number) {
  const s = w.shark;
  const L = bodyLength(w);
  ctx.save();
  ctx.translate(s.x, s.y);
  if (s.shield > 0) {
    ctx.strokeStyle = `rgba(125,211,252,${0.35 + 0.25 * Math.sin(t * 10)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, L * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (isCloaked(w)) ctx.globalAlpha = 0.28 + 0.1 * Math.sin(t * 12);
  else if (w.skill.ambush) {
    ctx.shadowColor = "#c084fc";
    ctx.shadowBlur = 24;
  }
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
  const R = w.stats.eatRadius * bodyScale(w) + 90;
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
  if (def.id === "thresher") {
    // 환도상어: scythe-like upper lobe almost as long as the body.
    ctx.beginPath();
    ctx.moveTo(0.02 * u, -0.03 * u);
    ctx.quadraticCurveTo(-0.2 * u, -0.1 * u, -0.48 * u, -0.3 * u);
    ctx.quadraticCurveTo(-0.22 * u, -0.06 * u, -0.08 * u, 0);
    ctx.closePath();
    ctx.fill();
  }
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
  if (def.id === "sandTiger" && !gold) {
    // Scattered dark spots.
    ctx.fillStyle = "rgba(63,47,29,0.5)";
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(0.2 * u - i * 0.065 * u, -0.1 * u + (i % 3) * 0.03 * u, 0.012 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (def.id === "elecShark" && !gold) {
    // Glowing electric zigzag along the flank.
    ctx.strokeStyle = `rgba(103,232,249,${0.6 + 0.4 * Math.sin(phase * 2)})`;
    ctx.lineWidth = 0.014 * u;
    ctx.beginPath();
    ctx.moveTo(0.22 * u, -0.07 * u);
    for (let i = 1; i <= 8; i++) ctx.lineTo(0.22 * u - i * 0.07 * u, -0.07 * u + (i % 2 ? 0.035 : -0.01) * u);
    ctx.stroke();
  }
  if (def.id === "goblin") {
    // Long blade-like snout over the mouth.
    ctx.fillStyle = gold ? "#eab308" : back;
    ctx.beginPath();
    ctx.moveTo(0.4 * u, -0.07 * u);
    ctx.quadraticCurveTo(0.62 * u, -0.06 * u, 0.66 * u, -0.02 * u);
    ctx.quadraticCurveTo(0.55 * u, 0.0, 0.42 * u, 0.0);
    ctx.fill();
  }
  if ((def.id === "phantom" || def.id === "leviathan") && !gold) {
    // Bioluminescent spine dots.
    ctx.fillStyle = def.id === "phantom" ? "rgba(192,132,252,0.9)" : "rgba(129,140,248,0.9)";
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(0.18 * u - i * 0.09 * u, -0.11 * u + i * 0.012 * u, 0.012 * u * (1 + 0.3 * Math.sin(phase + i)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (def.id === "hammer") {
    ctx.fillStyle = gold ? "#eab308" : back;
    ctx.beginPath();
    ctx.ellipse(0.46 * u, -0.02 * u, 0.06 * u, 0.13 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if ((def.id === "greenland" || def.id === "sleeper" || def.id === "cryodon") && !gold) {
    // Frost crystals scattered along the back.
    ctx.fillStyle = def.id === "cryodon" ? `rgba(165,243,252,${0.7 + 0.3 * Math.sin(phase * 1.5)})` : "rgba(224,242,254,0.55)";
    const n = def.id === "greenland" ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const cx = 0.2 * u - i * 0.075 * u, cy = -0.12 * u + i * 0.008 * u, r = 0.016 * u;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.6);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r * 1.2);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (def.id === "cryodon" && !gold) {
    // Icicle fangs jutting from the upper jaw.
    ctx.fillStyle = "rgba(224,242,254,0.9)";
    for (let i = 0; i < 3; i++) {
      const x = 0.3 * u + i * 0.05 * u;
      ctx.beginPath();
      ctx.moveTo(x - 0.012 * u, 0.04 * u);
      ctx.lineTo(x + 0.012 * u, 0.04 * u);
      ctx.lineTo(x, 0.1 * u);
      ctx.fill();
    }
  }
  if ((def.id === "bullShark" || def.id === "thresher" || def.id === "basilisk") && !gold) {
    // Toxic stripes; the basilisk's pulse.
    const glow = def.id === "basilisk" ? 0.55 + 0.4 * Math.sin(phase * 2.2) : 0.5;
    ctx.strokeStyle = `rgba(163,230,53,${glow})`;
    ctx.lineWidth = 0.014 * u;
    for (let i = 0; i < (def.id === "bullShark" ? 3 : 5); i++) {
      const x = 0.12 * u - i * 0.08 * u;
      ctx.beginPath();
      ctx.moveTo(x, -0.13 * u + i * 0.006 * u);
      ctx.lineTo(x - 0.035 * u, -0.04 * u);
      ctx.stroke();
    }
  }
  if (def.id === "basilisk" && !gold) {
    // Crest spines on the head.
    ctx.fillStyle = accent;
    for (let i = 0; i < 4; i++) {
      const x = 0.32 * u - i * 0.06 * u;
      ctx.beginPath();
      ctx.moveTo(x - 0.02 * u, -0.14 * u + i * 0.004 * u);
      ctx.lineTo(x - 0.05 * u, -0.22 * u);
      ctx.lineTo(x + 0.01 * u, -0.145 * u);
      ctx.fill();
    }
  }
  if (def.id === "tigerShark" && !gold) {
    // Dark tiger bars across the back.
    ctx.strokeStyle = "rgba(41,37,36,0.55)";
    ctx.lineWidth = 0.018 * u;
    for (let i = 0; i < 6; i++) {
      const x = 0.18 * u - i * 0.075 * u;
      ctx.beginPath();
      ctx.moveTo(x, -0.14 * u + i * 0.01 * u);
      ctx.lineTo(x - 0.02 * u, -0.05 * u);
      ctx.stroke();
    }
  }
  if (def.id === "lantern" || def.id === "abyssLantern") {
    // Glowing photophores along the belly.
    ctx.fillStyle = gold ? "#fde68a" : `rgba(134,239,172,${0.6 + 0.4 * Math.sin(phase * 1.8)})`;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(0.22 * u - i * 0.075 * u, 0.09 * u - i * 0.004 * u, 0.011 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (def.id === "abyssLantern") {
    // Angler-style lure stalk with a glowing orb.
    ctx.strokeStyle = gold ? "#eab308" : back;
    ctx.lineWidth = 0.012 * u;
    ctx.beginPath();
    ctx.moveTo(0.3 * u, -0.13 * u);
    ctx.quadraticCurveTo(0.45 * u, -0.34 * u, 0.6 * u, -0.2 * u + Math.sin(phase) * 0.02 * u);
    ctx.stroke();
    ctx.fillStyle = gold ? "#fef08a" : `rgba(187,247,208,${0.75 + 0.25 * Math.sin(phase * 2)})`;
    ctx.beginPath();
    ctx.arc(0.6 * u, -0.2 * u + Math.sin(phase) * 0.02 * u, 0.03 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  if (def.id === "blueShark" && !gold) {
    // Pale speed streak along the flank.
    ctx.strokeStyle = "rgba(186,230,253,0.7)";
    ctx.lineWidth = 0.012 * u;
    ctx.beginPath();
    ctx.moveTo(0.3 * u, -0.02 * u);
    ctx.quadraticCurveTo(0.0, -0.06 * u, -0.38 * u, -0.01 * u);
    ctx.stroke();
  }
  if (def.id === "bladeShark" && !gold) {
    // Lightning edge down the spine.
    ctx.strokeStyle = `rgba(250,204,21,${0.7 + 0.3 * Math.sin(phase * 3)})`;
    ctx.lineWidth = 0.014 * u;
    ctx.beginPath();
    ctx.moveTo(0.3 * u, -0.14 * u);
    for (let i = 1; i <= 8; i++) ctx.lineTo(0.3 * u - i * 0.08 * u, -0.13 * u + (i % 2 ? 0.03 : 0) * u + i * 0.008 * u);
    ctx.stroke();
  }
  if (def.id === "iceLance") {
    // Long icy lance snout.
    ctx.fillStyle = gold ? "#eab308" : "rgba(224,242,254,0.95)";
    ctx.beginPath();
    ctx.moveTo(0.42 * u, -0.06 * u);
    ctx.lineTo(0.8 * u, -0.02 * u);
    ctx.lineTo(0.43 * u, 0.0);
    ctx.closePath();
    ctx.fill();
  }
  if (def.id === "aurora" && !gold) {
    // Shimmering aurora bands.
    const bands = ["rgba(45,212,191,0.45)", "rgba(192,132,252,0.45)", "rgba(134,239,172,0.4)"];
    ctx.lineWidth = 0.02 * u;
    bands.forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(0.28 * u, -0.1 * u + i * 0.03 * u);
      ctx.quadraticCurveTo(0.0, -0.13 * u + i * 0.03 * u + Math.sin(phase + i) * 0.02 * u, -0.36 * u, -0.05 * u + i * 0.025 * u);
      ctx.stroke();
    });
  }
  if (def.id === "wobbegong" && !gold) {
    // Camouflage blotches + beard tassels under the snout.
    ctx.fillStyle = "rgba(101,163,13,0.45)";
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(0.2 * u - i * 0.08 * u, -0.08 * u + (i % 2) * 0.03 * u, 0.03 * u, 0.018 * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.01 * u;
    for (let i = 0; i < 4; i++) {
      const x = 0.32 * u + i * 0.035 * u;
      ctx.beginPath();
      ctx.moveTo(x, 0.1 * u);
      ctx.lineTo(x - 0.01 * u, 0.15 * u + Math.sin(phase + i) * 0.01 * u);
      ctx.stroke();
    }
  }
  if (def.id === "hydra") {
    // Two extra heads sprouting above and below the main one.
    for (const dy of [-0.2, 0.17]) {
      ctx.fillStyle = gold ? "#eab308" : back;
      ctx.beginPath();
      ctx.ellipse(0.3 * u, dy * u, 0.13 * u, 0.045 * u, dy < 0 ? -0.35 : 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = gold ? "#fde68a" : accent;
      ctx.beginPath();
      ctx.arc(0.36 * u, dy * u + (dy < 0 ? -0.01 : 0.01) * u, 0.014 * u, 0, Math.PI * 2);
      ctx.fill();
    }
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

  if (def.id === "helicoprion") {
    // Spiral tooth-whorl on the lower jaw, spinning.
    const cx = 0.36 * u, cy = 0.08 * u, r = 0.06 * u;
    ctx.fillStyle = gold ? "#ca8a04" : "#78350f";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fef3c7";
    for (let i = 0; i < 10; i++) {
      const a = phase * 2 + (i * Math.PI * 2) / 10;
      const rr = r * (0.55 + i * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rr * 0.7, cy + Math.sin(a) * rr * 0.7);
      ctx.lineTo(cx + Math.cos(a + 0.25) * rr * 0.7, cy + Math.sin(a + 0.25) * rr * 0.7);
      ctx.lineTo(cx + Math.cos(a + 0.12) * (rr + 0.02 * u), cy + Math.sin(a + 0.12) * (rr + 0.02 * u));
      ctx.fill();
    }
  }

  // Eye.
  ctx.fillStyle = (def.id === "leviathan" || def.id === "phantom" || def.id === "cryodon" || def.id === "basilisk" || def.id === "abyssLantern" || def.id === "aurora" || def.id === "bladeShark") && !gold ? accent : "#020617";
  ctx.beginPath();
  ctx.arc(0.34 * u, -0.045 * u, 0.024 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(0.345 * u, -0.052 * u, 0.008 * u, 0, Math.PI * 2);
  ctx.fill();

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
    case "tuna":
    case "goldenTuna": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      const wag = Math.sin(e.phase * 14) * 0.3;
      ctx.fillStyle = col;
      ctx.beginPath();
      if (e.kind === "goldenTuna") {
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 18 + 8 * Math.sin(t * 6);
        ctx.fillStyle = "#facc15";
      }
      ctx.ellipse(0, 0, r * 1.25, r * (e.kind === "tuna" || e.kind === "goldenTuna" ? 0.5 : 0.62), 0, 0, Math.PI * 2);
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
      if (e.kind === "goldenTuna") {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fef9c3";
        ctx.beginPath();
        ctx.ellipse(0, r * 0.18, r * 1.1, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        const tw = 0.5 + 0.5 * Math.sin(t * 9 + e.id);
        ctx.fillStyle = `rgba(255,255,255,${tw})`;
        ctx.beginPath();
        ctx.arc(-r * 0.3, -r * 0.25, 2, 0, Math.PI * 2);
        ctx.fill();
      }
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
    case "iceberg": {
      // Floating ice: small cap above the waterline, big translucent body below.
      const bob = Math.sin(e.phase * 0.8) * 3;
      ctx.translate(0, bob);
      ctx.fillStyle = gold ? GOLD : "rgba(224,242,254,0.95)";
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, 4);
      ctx.lineTo(-r * 0.35, -r * 0.45);
      ctx.lineTo(r * 0.05, -r * 0.6);
      ctx.lineTo(r * 0.45, -r * 0.3);
      ctx.lineTo(r * 0.75, 4);
      ctx.fill();
      ctx.fillStyle = gold ? "#fde68a" : "rgba(186,230,253,0.6)";
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, 4);
      ctx.lineTo(r * 0.85, 4);
      ctx.lineTo(r * 0.55, r * 0.9);
      ctx.lineTo(-r * 0.2, r * 1.15);
      ctx.lineTo(-r * 0.7, r * 0.6);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.45);
      ctx.lineTo(-r * 0.1, -r * 0.1);
      ctx.stroke();
      break;
    }
    case "penguin": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      const flap = Math.sin(e.phase * 16) * 0.5;
      ctx.fillStyle = gold ? GOLD : "#0f172a";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.3, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = gold ? "#fde68a" : "#f8fafc";
      ctx.beginPath();
      ctx.ellipse(r * 0.1, r * 0.22, r * 1.05, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.moveTo(r * 1.25, -r * 0.1);
      ctx.lineTo(r * 1.75, r * 0.05);
      ctx.lineTo(r * 1.25, r * 0.15);
      ctx.fill();
      ctx.fillStyle = gold ? GOLD : "#0f172a";
      ctx.save();
      ctx.translate(r * 0.1, -r * 0.2);
      ctx.rotate(flap);
      ctx.beginPath();
      ctx.ellipse(-r * 0.4, 0, r * 0.6, r * 0.18, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(r * 0.85, -r * 0.25, Math.max(1.2, r * 0.13), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "seal": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      const wag = Math.sin(e.phase * 8) * 0.35;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.25, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 1.05, -r * 0.08, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(-r * 1.15, 0);
      ctx.rotate(wag);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.6, -r * 0.4);
      ctx.lineTo(-r * 0.5, 0);
      ctx.lineTo(-r * 0.6, r * 0.4);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(71,85,105,0.5)";
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.arc(-r * 0.6 + k * r * 0.35, -r * 0.15 + (k % 2) * r * 0.2, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(r * 1.2, -r * 0.2, Math.max(1.5, r * 0.1), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "narwhal":
    case "orca": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      if (e.state === "chase" && !gold) {
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 16;
      }
      const orca = e.kind === "orca";
      const wag = Math.sin(e.phase * (e.state === "chase" ? 10 : 5)) * 0.25;
      ctx.fillStyle = gold ? GOLD : orca ? "#0f172a" : e.hitFlash > 0 ? "#fecaca" : "#94a3b8";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.45, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      // Flukes.
      ctx.save();
      ctx.translate(-r * 1.35, 0);
      ctx.rotate(wag);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-r * 0.4, -r * 0.6, -r * 0.7, -r * 0.55);
      ctx.lineTo(-r * 0.45, 0);
      ctx.lineTo(-r * 0.7, r * 0.55);
      ctx.quadraticCurveTo(-r * 0.4, r * 0.6, 0, 0);
      ctx.fill();
      ctx.restore();
      // Dorsal fin.
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.45);
      ctx.lineTo(orca ? -r * 0.35 : -r * 0.25, orca ? -r * 1.35 : -r * 0.75);
      ctx.lineTo(r * 0.25, -r * 0.45);
      ctx.fill();
      if (orca) {
        ctx.fillStyle = gold ? "#fde68a" : e.hitFlash > 0 ? "#fecaca" : "#f8fafc";
        ctx.beginPath();
        ctx.ellipse(r * 0.85, -r * 0.18, r * 0.28, r * 0.12, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(r * 0.1, r * 0.3, r * 1.0, r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Spiral tusk + mottling.
        ctx.strokeStyle = gold ? "#fde68a" : "#f5f5f4";
        ctx.lineWidth = Math.max(2, r * 0.1);
        ctx.beginPath();
        ctx.moveTo(r * 1.35, -r * 0.05);
        ctx.lineTo(r * 2.6, -r * 0.2);
        ctx.stroke();
        ctx.fillStyle = "rgba(51,65,85,0.45)";
        for (let k = 0; k < 6; k++) {
          ctx.beginPath();
          ctx.arc(-r * 0.8 + k * r * 0.35, -r * 0.2 + (k % 2) * r * 0.15, r * 0.09, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = "#020617";
      ctx.beginPath();
      ctx.arc(r * 1.05, -r * 0.08, Math.max(1.6, r * 0.07), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "barracuda": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      if (e.state === "chase" && !gold) {
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 12;
      }
      const wag = Math.sin(e.phase * 16) * 0.3;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(r * 1.9, 0);
      ctx.quadraticCurveTo(r * 0.6, -r * 0.5, -r * 1.3, -r * 0.2);
      ctx.lineTo(-r * 1.3, r * 0.2);
      ctx.quadraticCurveTo(r * 0.6, r * 0.5, r * 1.9, 0);
      ctx.fill();
      ctx.save();
      ctx.translate(-r * 1.3, 0);
      ctx.rotate(wag);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 0.6, -r * 0.5);
      ctx.lineTo(-r * 0.6, r * 0.5);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "rgba(41,37,36,0.5)";
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.8 + k * r * 0.4, -r * 0.3);
        ctx.lineTo(-r * 0.9 + k * r * 0.4, r * 0.05);
        ctx.stroke();
      }
      ctx.fillStyle = "#f5f5f4";
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(r * 1.2 + k * 3, r * 0.08);
        ctx.lineTo(r * 1.25 + k * 3, r * 0.25);
        ctx.lineTo(r * 1.3 + k * 3, r * 0.08);
        ctx.fill();
      }
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(r * 1.2, -r * 0.12, Math.max(1.5, r * 0.12), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "moray": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      if (e.state === "chase" && !gold) {
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 12;
      }
      // Undulating eel body as a thick stroked spline.
      ctx.strokeStyle = col;
      ctx.lineCap = "round";
      ctx.lineWidth = r * 0.75;
      ctx.beginPath();
      ctx.moveTo(r * 1.2, 0);
      for (let k = 1; k <= 8; k++) ctx.lineTo(r * 1.2 - k * r * 0.45, Math.sin(e.phase * 6 - k * 0.8) * r * 0.25 * (k / 8 + 0.3));
      ctx.stroke();
      ctx.lineCap = "butt";
      ctx.fillStyle = gold ? "#fde68a" : "#a3e635";
      ctx.globalAlpha = 0.5;
      for (let k = 1; k < 8; k++) {
        ctx.beginPath();
        ctx.arc(r * 1.2 - k * r * 0.45, Math.sin(e.phase * 6 - k * 0.8) * r * 0.25 * (k / 8 + 0.3) - r * 0.1, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const open = e.state === "chase" ? 0.35 : 0.12;
      ctx.fillStyle = gold ? GOLD : col;
      ctx.beginPath();
      ctx.moveTo(r * 1.0, -r * 0.35);
      ctx.lineTo(r * 1.75, -r * (0.05 + open));
      ctx.lineTo(r * 1.0, 0);
      ctx.lineTo(r * 1.7, r * (0.05 + open));
      ctx.lineTo(r * 1.0, r * 0.35);
      ctx.fill();
      ctx.fillStyle = "#fef08a";
      ctx.beginPath();
      ctx.arc(r * 1.25, -r * 0.18, Math.max(1.5, r * 0.1), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "treasureHunter": {
      if (faceLeft) ctx.scale(-1, 1);
      const kick = Math.sin(e.phase * 5) * 4;
      ctx.fillStyle = gold ? GOLD : "#7c2d12";
      ctx.fillRect(-12, -4, 20, 8);
      ctx.fillStyle = gold ? "#fde68a" : "#94a3b8";
      ctx.fillRect(-10, -10, 14, 6); // tank
      // Brass helmet.
      ctx.fillStyle = gold ? GOLD : "#d97706";
      ctx.beginPath();
      ctx.arc(11, -1, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(13, -1, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = gold ? GOLD : "#7c2d12";
      ctx.beginPath();
      ctx.moveTo(-12, -2);
      ctx.lineTo(-22, -4 + kick);
      ctx.lineTo(-22, 4 + kick);
      ctx.fill();
      // Loot sack.
      ctx.fillStyle = "#a16207";
      ctx.beginPath();
      ctx.arc(0, 9, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fde047";
      ctx.fillRect(-1, 5, 2, 2);
      break;
    }
    case "giantSquid": {
      ctx.rotate(e.angle);
      if (faceLeft) ctx.scale(1, -1);
      if (e.state === "chase" && !gold) {
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 18;
      }
      const c = gold ? GOLD : e.hitFlash > 0 ? "#fecaca" : "#b91c1c";
      // Mantle points backwards; tentacles trail ahead of the eye (jet-swimming squid moves mantle-first,
      // but this reads better as a monster: tentacles reach toward the target).
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-r * 1.6, 0);
      ctx.quadraticCurveTo(-r * 0.6, -r * 0.75, r * 0.4, -r * 0.45);
      ctx.lineTo(r * 0.4, r * 0.45);
      ctx.quadraticCurveTo(-r * 0.6, r * 0.75, -r * 1.6, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 1.6, 0);
      ctx.lineTo(-r * 1.95, -r * 0.45);
      ctx.lineTo(-r * 1.3, -r * 0.2);
      ctx.moveTo(-r * 1.6, 0);
      ctx.lineTo(-r * 1.95, r * 0.45);
      ctx.lineTo(-r * 1.3, r * 0.2);
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineCap = "round";
      for (let k = 0; k < 6; k++) {
        const off = (k - 2.5) * r * 0.13;
        const len = k === 1 || k === 4 ? r * 1.9 : r * 1.3;
        ctx.lineWidth = Math.max(2, r * (k === 1 || k === 4 ? 0.09 : 0.12));
        ctx.beginPath();
        ctx.moveTo(r * 0.35, off);
        for (let j = 1; j <= 5; j++) ctx.lineTo(r * 0.35 + (len * j) / 5, off * (1 + j * 0.25) + Math.sin(e.phase * 5 + k + j * 0.9) * r * 0.12 * (j / 5));
        ctx.stroke();
      }
      ctx.lineCap = "butt";
      ctx.fillStyle = "#fef3c7";
      ctx.beginPath();
      ctx.arc(r * 0.15, -r * 0.2, r * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(r * 0.2, -r * 0.2, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "mastDebris": {
      const hanging = e.timer > 0 && e.vy === 0;
      if (hanging) {
        ctx.translate(Math.sin(e.phase * 40) * 1.8, 0);
        ctx.strokeStyle = `rgba(248,113,113,${0.35 + 0.3 * Math.sin(e.phase * 16)})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 9]);
        ctx.beginPath();
        ctx.moveTo(0, r);
        ctx.lineTo(0, r + 600);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.rotate(e.angle);
      // A splintered chunk of yard arm with a scrap of sail and rope.
      ctx.fillStyle = gold ? GOLD : e.hitFlash > 0 ? "#fecaca" : "#5b3a1e";
      ctx.beginPath();
      ctx.moveTo(-r * 1.6, -r * 0.28);
      ctx.lineTo(r * 1.3, -r * 0.34);
      ctx.lineTo(r * 1.6, -r * 0.05);
      ctx.lineTo(r * 1.35, r * 0.1);
      ctx.lineTo(r * 1.55, r * 0.3);
      ctx.lineTo(-r * 1.5, r * 0.3);
      ctx.lineTo(-r * 1.75, r * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(30,20,10,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 1.4, -r * 0.05);
      ctx.lineTo(r * 1.2, -r * 0.1);
      ctx.stroke();
      ctx.fillStyle = "rgba(203,213,225,0.35)";
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, r * 0.3);
      ctx.quadraticCurveTo(-r * 0.2, r * 1.3, r * 0.4, r * 0.9);
      ctx.lineTo(r * 0.5, r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#a8a29e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 1.1, r * 0.2);
      ctx.quadraticCurveTo(r * 1.4, r * 0.9, r * 0.9, r * 1.3);
      ctx.stroke();
      break;
    }
    case "iceShard": {
      const hanging = e.timer > 0 && e.vy === 0;
      if (hanging) {
        // Tremble + a faint drop line showing where it will fall.
        ctx.translate(Math.sin(e.phase * 60) * 2.2, 0);
        ctx.strokeStyle = `rgba(248,113,113,${0.35 + 0.3 * Math.sin(e.phase * 18)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(0, r * 1.4);
        ctx.lineTo(0, r * 1.4 + 520);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const g = ctx.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, gold ? GOLD : "#bae6fd");
      g.addColorStop(0.5, "#ffffff");
      g.addColorStop(1, gold ? GOLD : "#7dd3fc");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 1.3);
      ctx.lineTo(r * 0.75, -r * 1.3);
      ctx.lineTo(r * 0.2, r * 0.4);
      ctx.lineTo(0, r * 1.5);
      ctx.lineTo(-r * 0.25, r * 0.5);
      ctx.closePath();
      ctx.fill();
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
