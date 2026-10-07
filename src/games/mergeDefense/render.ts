/**
 * Canvas drawing for 랜덤 합성 디펜스. UI-only — free to use Math trig and
 * wall-clock time (the engine never imports this file).
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
  /** Slots that can merge with `selected` (or every mergeable slot when nothing is selected). */
  highlight?: Set<number>;
  mini?: boolean;
  /** Slot currently hovered while dragging. */
  dropTarget?: number | null;
}

// Cheap deterministic grass speckle layout, computed once.
const SPECKLES: { x: number; y: number; r: number; a: number }[] = (() => {
  const out: { x: number; y: number; r: number; a: number }[] = [];
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 90; i++) out.push({ x: rnd() * BOARD_W, y: rnd() * BOARD_H, r: 1 + rnd() * 2.2, a: 0.08 + rnd() * 0.12 });
  return out;
})();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

export function drawBoard(ctx: CanvasRenderingContext2D, board: Board, opts: DrawOptions) {
  const { now, mini } = opts;
  // Field
  const bg = ctx.createLinearGradient(0, 0, 0, BOARD_H);
  bg.addColorStop(0, board.alive ? "#1f5f2e" : "#3f3f46");
  bg.addColorStop(1, board.alive ? "#14432a" : "#27272a");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, BOARD_W, BOARD_H, 18);
  ctx.fill();
  if (!mini) {
    for (const s of SPECKLES) {
      ctx.fillStyle = `rgba(190,255,170,${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Road
  const rw = ROAD.x1 - ROAD.x0;
  const rh = ROAD.y1 - ROAD.y0;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#5b4220";
  ctx.lineWidth = 32;
  ctx.strokeRect(ROAD.x0, ROAD.y0, rw, rh);
  ctx.strokeStyle = "#c9a46a";
  ctx.lineWidth = 26;
  ctx.strokeRect(ROAD.x0, ROAD.y0, rw, rh);
  if (!mini) {
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = -((now / 40) % 18);
    ctx.strokeStyle = "rgba(255,240,200,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(ROAD.x0, ROAD.y0, rw, rh);
    ctx.setLineDash([]);
  }

  // Portal at the spawn corner
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);
  const portal = ctx.createRadialGradient(ROAD.x0, ROAD.y0, 2, ROAD.x0, ROAD.y0, 20);
  portal.addColorStop(0, "rgba(250,232,255,0.95)");
  portal.addColorStop(0.5, `rgba(168,85,247,${0.6 + pulse * 0.3})`);
  portal.addColorStop(1, "rgba(88,28,135,0)");
  ctx.fillStyle = portal;
  ctx.beginPath();
  ctx.arc(ROAD.x0, ROAD.y0, 20, 0, Math.PI * 2);
  ctx.fill();

  // Danger vignette
  const load = fieldLoad(board) / LOAD_LIMIT;
  if (board.alive && load > 0.7) {
    const a = (load - 0.7) * 1.6 * (0.6 + 0.4 * Math.sin(now / 160));
    ctx.strokeStyle = `rgba(239,68,68,${Math.min(0.75, a)})`;
    ctx.lineWidth = 10;
    roundRect(ctx, 5, 5, BOARD_W - 10, BOARD_H - 10, 16);
    ctx.stroke();
  }

  // Grid cells
  for (let slot = 0; slot < SLOTS; slot++) {
    const c = slotCenter(slot);
    const x = c.x - CELL / 2 + 3;
    const y = c.y - CELL / 2 + 3;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    roundRect(ctx, x, y, CELL - 6, CELL - 6, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (opts.highlight?.has(slot)) {
      const u = board.units[slot];
      ctx.strokeStyle = u ? GRADE_COLORS[u.grade] : "#fff";
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 140);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (opts.dropTarget === slot) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fill();
    }
    if (opts.selected === slot) {
      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // Units
  board.units.forEach((u, slot) => {
    if (!u) return;
    const c = slotCenter(slot);
    drawUnit(ctx, c.x, c.y, u, now, mini, opts.selected === slot);
  });

  // Mobs (oldest drawn last so the front of the line stays on top)
  const mobs = [...board.mobs].sort((a, b) => a.trav - b.trav);
  for (const m of mobs) {
    const slow = m.slowT > 0 ? m.slowPct : 0;
    const trav = m.trav + (m.speed * (1 - slow) * opts.alpha) / TICKS_PER_SEC;
    drawMob(ctx, m, trav, now, mini);
  }

  if (!board.alive) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, 0, 0, BOARD_W, BOARD_H, 18);
    ctx.fill();
    ctx.fillStyle = "#fecaca";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💀 탈락", BOARD_W / 2, BOARD_H / 2);
  }
}

export function drawUnit(ctx: CanvasRenderingContext2D, x: number, y: number, u: Unit, now: number, mini = false, lifted = false) {
  const def = UNITS[u.kind];
  const interval = unitInterval(u);
  // Recoil bump right after firing.
  const sinceFire = interval - u.cd;
  const bump = sinceFire <= 2 ? 1.08 : 1;
  const r = 21 * bump * (lifted ? 1.1 : 1);
  ctx.save();
  ctx.translate(x, y + (lifted ? -3 : 0));

  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.85, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  if (u.grade >= 4 && !mini) {
    ctx.shadowColor = GRADE_COLORS[u.grade];
    ctx.shadowBlur = 12 + 6 * Math.sin(now / 200);
  }
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, shade(def.color, 0.55));
  g.addColorStop(0.6, def.color);
  g.addColorStop(1, shade(def.color, -0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Grade ring
  ctx.lineWidth = u.grade >= 3 ? 3.5 : 2.5;
  if (u.grade === 5 && typeof ctx.createConicGradient === "function") {
    const cg = ctx.createConicGradient(now / 500, 0, 0);
    ["#f43f5e", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#a855f7", "#f43f5e"].forEach((c, i, arr) => cg.addColorStop(i / (arr.length - 1), c));
    ctx.strokeStyle = cg;
  } else {
    ctx.strokeStyle = GRADE_COLORS[u.grade];
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // Glyph
  ctx.font = `${Math.round(r * 0.95)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.emoji, 0, 1);

  // Grade pips
  const pipR = 2.6;
  const total = u.grade;
  for (let i = 0; i < total; i++) {
    const px = (i - (total - 1) / 2) * 7;
    ctx.fillStyle = GRADE_COLORS[u.grade];
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, r + 2, pipR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

const MOB_LOOK: Record<Mob["kind"], { r: number; color: string }> = {
  normal: { r: 8, color: "#84cc16" },
  fast: { r: 6.5, color: "#fde047" },
  tank: { r: 11, color: "#64748b" },
  boss: { r: 17, color: "#7c3aed" },
  elite: { r: 10, color: "#ef4444" },
};

function drawMob(ctx: CanvasRenderingContext2D, m: Mob, trav: number, now: number, mini = false) {
  const p = pathPoint(trav);
  const ahead = pathPoint(trav + 4);
  const dx = ahead.x - p.x;
  const dy = ahead.y - p.y;
  const look = MOB_LOOK[m.kind];
  const wob = 1 + 0.08 * Math.sin(now / 90 + m.id);
  const r = look.r;
  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.75, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  if (m.kind === "elite") {
    ctx.strokeStyle = SEAT_COLORS[m.from] ?? "#fff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r + 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 1, 0, 0, r);
  g.addColorStop(0, shade(look.color, 0.5));
  g.addColorStop(1, shade(look.color, -0.3));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * wob, (r / wob) * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();

  if (m.slowT > 0) {
    ctx.fillStyle = "rgba(125,211,252,0.45)";
    ctx.fill();
  }
  if (m.poisonT > 0 && !mini) {
    ctx.fillStyle = "rgba(34,197,94,0.85)";
    for (let i = 0; i < 3; i++) {
      const a = now / 300 + i * 2.1;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.9, -r * 0.6 - ((now / 12 + i * 9) % 10), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Eyes looking along the road
  if (!mini || r > 9) {
    const len = Math.hypot(dx, dy) || 1;
    const ex = (dx / len) * r * 0.25;
    const ey = (dy / len) * r * 0.25;
    for (const s of [-1, 1]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s * r * 0.35 + ex * 0.5, -r * 0.15 + ey * 0.5, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(s * r * 0.35 + ex, -r * 0.15 + ey, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (m.kind === "boss") {
    ctx.fillStyle = "#facc15";
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, -r + 2);
    ctx.lineTo(-9, -r - 8);
    ctx.lineTo(-4.5, -r - 3);
    ctx.lineTo(0, -r - 10);
    ctx.lineTo(4.5, -r - 3);
    ctx.lineTo(9, -r - 8);
    ctx.lineTo(9, -r + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // HP bar
  if (m.hp < m.maxHp) {
    const w = Math.max(14, r * 2.2);
    const top = -r - (m.kind === "boss" ? 15 : 7);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(-w / 2, top, w, 3.5);
    const frac = Math.max(0, m.hp / m.maxHp);
    ctx.fillStyle = frac > 0.5 ? "#4ade80" : frac > 0.25 ? "#facc15" : "#f87171";
    ctx.fillRect(-w / 2, top, w * frac, 3.5);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type Fx =
  | { type: "shot"; kind: UnitKind; grade: number; from: { x: number; y: number }; pts: number[]; t0: number; dur: number }
  | { type: "ring"; x: number; y: number; color: string; r0: number; r1: number; t0: number; dur: number }
  | { type: "spark"; x: number; y: number; color: string; t0: number; dur: number; seed: number }
  | { type: "text"; x: number; y: number; text: string; color: string; t0: number; dur: number; size: number };

export function drawFx(ctx: CanvasRenderingContext2D, fx: Fx[], now: number) {
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

function drawShot(ctx: CanvasRenderingContext2D, f: Extract<Fx, { type: "shot" }>, k: number) {
  const color = UNITS[f.kind].color;
  const tx = f.pts[0];
  const ty = f.pts[1];
  const fx = f.from.x;
  const fy = f.from.y;
  const width = 1.5 + f.grade * 0.6;
  switch (f.kind) {
    case "archer": {
      // A streak flying from the unit to the target.
      const head = Math.min(1, k * 1.6);
      const tail = Math.max(0, head - 0.35);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(fx + (tx - fx) * tail, fy + (ty - fy) * tail);
      ctx.lineTo(fx + (tx - fx) * head, fy + (ty - fy) * head);
      ctx.stroke();
      for (let i = 2; i < f.pts.length; i += 2) {
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(fx + (f.pts[i] - fx) * tail, fy + (f.pts[i + 1] - fy) * tail);
        ctx.lineTo(fx + (f.pts[i] - fx) * head, fy + (f.pts[i + 1] - fy) * head);
        ctx.stroke();
      }
      break;
    }
    case "mage": {
      if (k < 0.5) {
        const t = k / 0.5;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(fx + (tx - fx) * t, fy + (ty - fy) * t - Math.sin(t * Math.PI) * 18, 3 + f.grade, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const t = (k - 0.5) / 0.5;
        ctx.globalAlpha = 1 - t;
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, 18 + t * (30 + f.grade * 5));
        g.addColorStop(0, "rgba(250,232,255,0.9)");
        g.addColorStop(0.5, "rgba(168,85,247,0.55)");
        g.addColorStop(1, "rgba(168,85,247,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, 18 + t * (30 + f.grade * 5), 0, Math.PI * 2);
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
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = "#bae6fd";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(tx + Math.cos(a) * 9 * k, ty + Math.sin(a) * 9 * k, 1.8, 0, Math.PI * 2);
        ctx.fill();
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
      let py = fy;
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
      ctx.arc(fx + (tx - fx) * t, fy + (ty - fy) * t - Math.sin(t * Math.PI) * 24, 3 + f.grade * 0.6, 0, Math.PI * 2);
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

/** Wraps an index-free mob position for FX lookups. */
export function mobPos(m: Mob): { x: number; y: number } {
  return pathPoint(m.trav % PATH_LEN);
}
