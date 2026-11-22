/**
 * Canvas drawing for 한 발의 묘수 — a sunset shooting gallery in world units
 * (1000×600; the caller scales the context). Targets are ringed discs,
 * hostages are person silhouettes (shape, not just colour, tells them apart),
 * mirrors are riveted steel, walls are planks.
 */

import { BULLET_SPEED, FLOOR_Y, H, W, aimDir, motionAt, segmentAt, type Fx, type Motion, type Sim, type Vec } from "./sim";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: "spark" | "chip" | "smoke" | "ring" | "text";
  text?: string;
}

export class FxLayer {
  private ps: Particle[] = [];
  shake = 0;
  flash = 0;

  clear() {
    this.ps = [];
    this.shake = 0;
    this.flash = 0;
  }

  spawn(f: Fx, calm: boolean) {
    const add = (n: number, mk: (i: number) => Partial<Particle>) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 220;
        this.ps.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5, size: 3, color: "#fde68a", kind: "spark", ...mk(i) });
      }
    };
    switch (f.kind) {
      case "shot":
        add(6, () => ({ max: 0.18, color: "#fff7cc", size: 4 }));
        add(3, () => ({ kind: "smoke", vx: 20 + Math.random() * 30, vy: -30 - Math.random() * 20, max: 0.9, size: 10, color: "rgba(230,220,200,0.5)" }));
        if (!calm) this.shake = Math.max(this.shake, 3);
        break;
      case "hit":
        add(12, () => ({ kind: "chip", max: 0.8, size: 5, color: Math.random() < 0.5 ? "#dc2626" : "#fef3c7", vy: -120 - Math.random() * 160 }));
        this.ps.push({ x: f.x, y: f.y, vx: 0, vy: -40, life: 0, max: 0.9, size: 18, color: "#fde047", kind: "text", text: "명중!" });
        break;
      case "ricochet":
        add(10, () => ({ max: 0.3, color: "#e0f2fe", size: 3 }));
        this.ps.push({ x: f.x, y: f.y, vx: 0, vy: 0, life: 0, max: 0.35, size: 22, color: "#bae6fd", kind: "ring" });
        break;
      case "wall":
      case "thud":
        add(6, () => ({ kind: "chip", max: 0.5, size: 3, color: "#a16207" }));
        break;
      case "cut":
        add(8, () => ({ max: 0.35, color: "#fcd34d" }));
        this.ps.push({ x: f.x, y: f.y, vx: 0, vy: -30, life: 0, max: 0.8, size: 15, color: "#fcd34d", kind: "text", text: "툭!" });
        break;
      case "boom":
        add(26, () => ({ max: 0.7, color: Math.random() < 0.5 ? "#f97316" : "#fde047", size: 5 }));
        add(10, () => ({ kind: "smoke", max: 1.6, size: 26, color: "rgba(80,60,50,0.55)", vy: -40 - Math.random() * 60 }));
        this.ps.push({ x: f.x, y: f.y, vx: 0, vy: 0, life: 0, max: 0.45, size: 105, color: "#fb923c", kind: "ring" });
        if (!calm) {
          this.shake = Math.max(this.shake, 12);
          this.flash = Math.max(this.flash, 0.5);
        }
        break;
      case "smash":
        add(16, () => ({ kind: "chip", max: 0.9, size: 4, color: "#fde68a", vy: -160 - Math.random() * 120 }));
        this.ps.push({ x: f.x, y: f.y, vx: 0, vy: -40, life: 0, max: 0.9, size: 18, color: "#fde047", kind: "text", text: "쾅!" });
        if (!calm) this.shake = Math.max(this.shake, 6);
        break;
      case "land":
        add(10, () => ({ kind: "smoke", max: 1, size: 14, color: "rgba(214,180,140,0.55)", vy: -20 - Math.random() * 30 }));
        break;
      case "hostage":
        this.ps.push({ x: f.x, y: f.y, vx: 0, vy: -20, life: 0, max: 1.6, size: 22, color: "#f87171", kind: "text", text: "인질!" });
        if (!calm) this.shake = Math.max(this.shake, 8);
        break;
    }
  }

  update(dt: number) {
    for (const p of this.ps) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "chip") p.vy += 700 * dt;
      if (p.kind === "spark") {
        p.vx *= 0.9;
        p.vy *= 0.9;
      }
    }
    this.ps = this.ps.filter((p) => p.life < p.max);
    this.shake *= Math.pow(0.0001, dt);
    this.flash = Math.max(0, this.flash - dt * 1.6);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.ps) {
      const k = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, k);
      if (p.kind === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4 * k + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === "text") {
        ctx.fillStyle = p.color;
        ctx.font = `900 ${p.size}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 4;
        ctx.strokeText(p.text ?? "", p.x, p.y - 30);
        ctx.fillText(p.text ?? "", p.x, p.y - 30);
      } else if (p.kind === "smoke") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------ backdrop */

let bgCache: HTMLCanvasElement | null = null;

function backdrop(): HTMLCanvasElement {
  if (bgCache) return bgCache;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, FLOOR_Y);
  sky.addColorStop(0, "#3b1d4a");
  sky.addColorStop(0.45, "#c2410c");
  sky.addColorStop(0.8, "#f59e0b");
  sky.addColorStop(1, "#fcd34d");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, FLOOR_Y);
  // sun
  const sun = g.createRadialGradient(760, 420, 10, 760, 420, 170);
  sun.addColorStop(0, "rgba(255,247,200,0.95)");
  sun.addColorStop(0.3, "rgba(253,224,71,0.5)");
  sun.addColorStop(1, "rgba(253,224,71,0)");
  g.fillStyle = sun;
  g.fillRect(560, 250, 400, 330);
  // mesas
  g.fillStyle = "#7c2d12";
  g.beginPath();
  g.moveTo(0, 470);
  g.lineTo(80, 470);
  g.lineTo(110, 420);
  g.lineTo(260, 420);
  g.lineTo(290, 470);
  g.lineTo(560, 470);
  g.lineTo(590, 395);
  g.lineTo(700, 395);
  g.lineTo(735, 470);
  g.lineTo(1000, 470);
  g.lineTo(1000, FLOOR_Y);
  g.lineTo(0, FLOOR_Y);
  g.fill();
  g.fillStyle = "rgba(67,20,7,0.55)";
  g.fillRect(0, 500, W, FLOOR_Y - 500);
  // gallery frame posts
  g.fillStyle = "rgba(41,22,10,0.35)";
  for (let x = 120; x < W; x += 220) g.fillRect(x, 0, 6, FLOOR_Y);
  // floor planks
  const fl = g.createLinearGradient(0, FLOOR_Y, 0, H);
  fl.addColorStop(0, "#78350f");
  fl.addColorStop(1, "#451a03");
  g.fillStyle = fl;
  g.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 1;
  for (let x = 0; x < W; x += 64) {
    g.beginPath();
    g.moveTo(x, FLOOR_Y);
    g.lineTo(x - 18, H);
    g.stroke();
  }
  g.fillStyle = "#fbbf24";
  g.fillRect(0, FLOOR_Y, W, 3);
  bgCache = c;
  return c;
}

/* ------------------------------------------------------------ pieces */

function track(ctx: CanvasRenderingContext2D, m: Motion) {
  ctx.save();
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = "rgba(255,240,210,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (m.k === "line") {
    ctx.moveTo(m.a.x, m.a.y);
    ctx.lineTo(m.b.x, m.b.y);
  } else if (m.k === "orbit") {
    ctx.arc(m.c.x, m.c.y, m.r, 0, Math.PI * 2);
  } else if (m.k === "pendulum") {
    const a0 = Math.PI / 2 - (m.amp * Math.PI) / 180;
    const a1 = Math.PI / 2 + (m.amp * Math.PI) / 180;
    ctx.arc(m.pivot.x, m.pivot.y, m.len, a0, a1);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTarget(ctx: CanvasRenderingContext2D, p: Vec, r: number, dead: boolean) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (dead) {
    ctx.globalAlpha = 0.28;
    ctx.rotate(0.5);
  }
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(3, 4, r, r, 0, 0, Math.PI * 2);
  ctx.fill();
  const rings = ["#f8fafc", "#dc2626", "#f8fafc", "#dc2626"];
  rings.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1 - i * 0.24), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = "#1c1917";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  if (dead) {
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.2);
    ctx.lineTo(r * 0.1, r * 0.1);
    ctx.lineTo(r * 0.6, -r * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHostage(ctx: CanvasRenderingContext2D, p: Vec, r: number, dead: boolean) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (dead) ctx.globalAlpha = 0.5;
  // white keep-out ring + body silhouette with raised hands
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, r * 0.95);
  ctx.quadraticCurveTo(-r * 0.6, -r * 0.05, 0, -r * 0.05);
  ctx.quadraticCurveTo(r * 0.6, -r * 0.05, r * 0.55, r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, r * 0.1);
  ctx.lineTo(-r * 0.8, -r * 0.75);
  ctx.moveTo(r * 0.45, r * 0.1);
  ctx.lineTo(r * 0.8, -r * 0.75);
  ctx.stroke();
  ctx.fillStyle = "#fde3c4";
  ctx.beginPath();
  ctx.arc(0, -r * 0.42, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.arc(-r * 0.1, -r * 0.45, 1.8, 0, Math.PI * 2);
  ctx.arc(r * 0.1, -r * 0.45, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -r * 0.3, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  if (dead) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-r, -r);
    ctx.lineTo(r, r);
    ctx.moveTo(r, -r);
    ctx.lineTo(-r, r);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSegment(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, mirror: boolean) {
  ctx.save();
  ctx.lineCap = "round";
  if (mirror) {
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, "#94a3b8");
    g.addColorStop(0.5, "#f8fafc");
    g.addColorStop(1, "#94a3b8");
    ctx.strokeStyle = g;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = "#334155";
    for (const u of [0.1, 0.5, 0.9]) {
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = "#292524";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 18]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBarrel(ctx: CanvasRenderingContext2D, p: Vec, r: number, blown: boolean) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (blown) {
    ctx.fillStyle = "rgba(20,10,5,0.55)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.7, r * 1.3, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const w = r * 1.5;
  const h = r * 1.9;
  ctx.fillStyle = "#991b1b";
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.fillRect(-w / 2, -h * 0.3, w, 4);
  ctx.fillRect(-w / 2, h * 0.24, w, 4);
  ctx.fillStyle = "#fde047";
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.2);
  ctx.lineTo(h * 0.17, h * 0.12);
  ctx.lineTo(-h * 0.17, h * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.font = `900 ${Math.round(r * 0.55)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText("!", 0, h * 0.08);
  ctx.restore();
}

function drawWeight(ctx: CanvasRenderingContext2D, p: Vec, r: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = "#b45309";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 4, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#facc15";
  ctx.beginPath();
  ctx.ellipse(0, 4, r * 0.85, r * 0.3, 0, 0, Math.PI);
  ctx.fill();
  for (const dx of [-0.65, -0.22, 0.22, 0.65]) {
    ctx.fillStyle = "#fef3c7";
    ctx.fillRect(dx * r - 2.5, -r * 0.55, 5, r * 0.55);
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.ellipse(dx * r, -r * 0.66, 2.6, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#78350f";
  ctx.beginPath();
  ctx.arc(0, -r * 0.1, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGun(ctx: CanvasRenderingContext2D, gun: Vec, angle: number) {
  ctx.save();
  ctx.translate(gun.x, gun.y);
  // gunslinger: hat + poncho
  ctx.fillStyle = "#1c1917";
  ctx.beginPath();
  ctx.ellipse(-12, -2, 22, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#b45309";
  ctx.beginPath();
  ctx.moveTo(-38, 30);
  ctx.lineTo(-12, -14);
  ctx.lineTo(14, 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fde3c4";
  ctx.beginPath();
  ctx.arc(-12, -24, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#422006";
  ctx.beginPath();
  ctx.ellipse(-12, -32, 22, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-22, -46, 20, 14);
  // revolver arm
  ctx.rotate((angle * Math.PI) / 180);
  ctx.fillStyle = "#b45309";
  ctx.fillRect(-4, -5, 22, 10);
  ctx.fillStyle = "#57534e";
  ctx.fillRect(16, -6, 10, 12);
  ctx.fillStyle = "#a8a29e";
  ctx.fillRect(24, -3.5, 14, 7);
  ctx.restore();
}

/* ------------------------------------------------------------ scene */

export interface SceneView {
  sim: Sim;
  /** Time drawn — equals sim.time while running; the scrubber's time while observing. */
  t: number;
  aim: number;
  showAim: boolean;
  /** End of the aim line and whether it ends on a mirror. */
  preview: { end: Vec; bend: boolean } | null;
  /** Answer ghost paths (hint 3) / previous attempt paths. */
  ghost: Vec[][];
  mine: Vec[][];
  /** Reserved shots (practice) drawn as numbered rays. */
  reserved: { angle: number; label: string; active: boolean }[];
  fx: FxLayer;
}

export function drawScene(ctx: CanvasRenderingContext2D, v: SceneView) {
  const { sim, t } = v;
  const st = sim.stage;
  ctx.save();
  if (v.fx.shake > 0.3) ctx.translate((Math.random() - 0.5) * v.fx.shake, (Math.random() - 0.5) * v.fx.shake);
  ctx.drawImage(backdrop(), 0, 0);

  for (const td of st.targets) track(ctx, td.m);
  for (const wd of st.weights) if (!sim.falling.has(wd.id)) track(ctx, wd.m);

  // ropes + weights
  for (const wd of st.weights) {
    const rope = sim.ropeOf(wd, t);
    if (rope) {
      ctx.strokeStyle = "#e7d3a7";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rope.a.x, rope.a.y);
      ctx.lineTo(rope.b.x, rope.b.y);
      ctx.stroke();
      ctx.fillStyle = "#57534e";
      ctx.fillRect(rope.a.x - 7, rope.a.y - 2, 14, 6);
    }
  }
  for (const sd of st.segments) {
    const s = segmentAt(sd, t);
    drawSegment(ctx, s.a, s.b, sd.kind === "mirror");
  }
  for (const bd of st.barrels) drawBarrel(ctx, motionAt(bd.m, t), bd.r, sim.blown.has(bd.id) && sim.blown.get(bd.id)! <= sim.tick);
  for (const wd of st.weights) drawWeight(ctx, sim.weightPos(wd, t), wd.r);
  for (const td of st.targets) {
    const p = motionAt(td.m, t);
    const dead = sim.dead.has(td.id);
    if (td.kind === "hostage") drawHostage(ctx, p, td.r, dead);
    else drawTarget(ctx, p, td.r, dead);
  }

  // previous attempt / ghost answer
  const paths = (list: Vec[][], color: string, dash: number[]) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(dash);
    for (const path of list) {
      if (path.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  };
  paths(v.mine, "rgba(255,255,255,0.45)", [3, 6]);
  paths(v.ghost, "rgba(34,211,238,0.9)", [10, 6]);

  // reserved rays
  for (const r of v.reserved) {
    const d = aimDir(r.angle);
    ctx.save();
    ctx.strokeStyle = r.active ? "rgba(253,224,71,0.85)" : "rgba(253,224,71,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(sim.gun.x + d.x * 34, sim.gun.y + d.y * 34);
    ctx.lineTo(sim.gun.x + d.x * 150, sim.gun.y + d.y * 150);
    ctx.stroke();
    ctx.fillStyle = "#fde047";
    ctx.font = "800 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(r.label, sim.gun.x + d.x * 165, sim.gun.y + d.y * 165 + 4);
    ctx.restore();
  }

  // aim line
  if (v.showAim && v.preview) {
    const d = aimDir(v.aim);
    ctx.save();
    ctx.strokeStyle = "rgba(255,250,235,0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(sim.gun.x + d.x * 34, sim.gun.y + d.y * 34);
    ctx.lineTo(v.preview.end.x, v.preview.end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = v.preview.bend ? "#7dd3fc" : "rgba(255,250,235,0.9)";
    ctx.beginPath();
    ctx.arc(v.preview.end.x, v.preview.end.y, v.preview.bend ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (v.preview.bend) {
      ctx.strokeStyle = "#7dd3fc";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(v.preview.end.x, v.preview.end.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#e0f2fe";
      ctx.font = "800 14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("?", v.preview.end.x, v.preview.end.y - 18);
    }
    ctx.restore();
  }

  // bullets
  for (const b of sim.bullets) {
    if (!b.alive) continue;
    ctx.save();
    const tail = Math.min(70, BULLET_SPEED * 0.05);
    const g = ctx.createLinearGradient(b.x, b.y, b.x - b.dx * tail, b.y - b.dy * tail);
    g.addColorStop(0, "rgba(255,251,235,1)");
    g.addColorStop(1, "rgba(253,224,71,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.dx * tail, b.y - b.dy * tail);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawGun(ctx, sim.gun, v.aim);
  v.fx.draw(ctx);
  ctx.restore();

  if (v.fx.flash > 0) {
    ctx.fillStyle = `rgba(255,237,213,${v.fx.flash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
}
