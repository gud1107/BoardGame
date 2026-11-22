import { canBuild, H, M, petOf, W, type Emitter, type Frame, type Scenario } from "./sim";

/** Canvas drawing for 멍냥 방어선 boards (design + replay share it). */

export const PET_EMOJI = ["🐶", "🐱", "🐥", "🐹"];

const SKY: Record<Scenario["sky"], [string, string]> = {
  day: ["#7dd3fc", "#e0f2fe"],
  dusk: ["#fb923c", "#fde68a"],
  night: ["#0f172a", "#334155"],
  cave: ["#1c1917", "#44403c"],
  storm: ["#334155", "#94a3b8"],
  desert: ["#fcd34d", "#fef3c7"],
  volcano: ["#450a0a", "#9a3412"],
  toxic: ["#365314", "#a3e635"],
  snow: ["#bae6fd", "#f8fafc"],
};

const EMITTER_ICON: Record<string, string> = {
  water: "🚿",
  lava: "🌋",
  acid: "☔",
  sand: "🏜️",
  snow: "❄️",
  boulder: "🪨",
  gas: "☠️",
  bee: "🍯",
  hornet: "👑",
  bat: "🦇",
  rat: "🐀",
};

function matName(m: number): string {
  switch (m) {
    case M.WATER:
      return "water";
    case M.LAVA:
      return "lava";
    case M.ACID:
      return "acid";
    case M.SAND:
      return "sand";
    case M.SNOW:
      return "snow";
    case M.BOULDER:
      return "boulder";
    case M.GAS:
      return "gas";
    default:
      return "water";
  }
}

export interface EmitterMark {
  x: number;
  y: number;
  icon: string;
}

/** Icons showing where each hazard comes from (design phase). */
export function emitterMarks(emitters: readonly Emitter[]): EmitterMark[] {
  const out: EmitterMark[] = [];
  for (const e of emitters) {
    switch (e.k) {
      case "pour":
        out.push({ x: e.x, y: e.y, icon: EMITTER_ICON[matName(e.mat)] });
        break;
      case "spawn":
        out.push({ x: e.x, y: e.y, icon: EMITTER_ICON[e.agent] ?? "❗" });
        break;
      case "rain":
        for (let x = e.x0; x <= e.x1; x += 2) out.push({ x, y: 0, icon: e.mat === M.BOULDER ? "🪨" : e.mat === M.SAND ? "🌪️" : e.mat === M.ACID ? "☁️" : "🌧️" });
        break;
      case "meteor":
        for (let x = e.x0; x <= e.x1; x += 3) out.push({ x, y: 0, icon: "☄️" });
        break;
      case "bolt":
        for (let x = e.x0; x <= e.x1; x += 3) out.push({ x, y: 0, icon: "⛈️" });
        break;
      case "ignite":
        for (const [x, y] of e.cells) out.push({ x, y, icon: "🔥" });
        break;
      default:
        break;
    }
  }
  return out;
}

export interface DrawOpts {
  /** Pixel size of a cell. */
  cell: number;
  petEmoji: string;
  /** Design overlay: emitter icons + no-build ring. */
  design?: boolean;
  emitters?: readonly Emitter[];
  /** Columns warned for an incoming bolt. */
  warnCols?: number[];
  /** Active bolts to draw (x, y, rod). */
  bolts?: { x: number; y: number; rod: boolean }[];
  booms?: { x: number; y: number; age: number }[];
  /** Hovered cell in design mode. */
  hover?: { x: number; y: number; ok: boolean } | null;
  /** Animation phase (ms) for flicker. */
  time: number;
}

function emoji(ctx: CanvasRenderingContext2D, ch: string, cx: number, cy: number, size: number) {
  ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ch, cx, cy + size * 0.05);
}

export function drawFrame(ctx: CanvasRenderingContext2D, sc: Scenario, f: Frame, o: DrawOpts) {
  const c = o.cell;
  const wpx = W * c;
  const hpx = H * c;
  const [top, bottom] = SKY[sc.sky];
  const g = ctx.createLinearGradient(0, 0, 0, hpx);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, wpx, hpx);

  // faint grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let x = 1; x < W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * c + 0.5, 0);
    ctx.lineTo(x * c + 0.5, hpx);
    ctx.stroke();
  }
  for (let y = 1; y < H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * c + 0.5);
    ctx.lineTo(wpx, y * c + 0.5);
    ctx.stroke();
  }

  // bolt warning columns
  if (o.warnCols?.length) {
    const a = 0.18 + 0.12 * Math.sin(o.time / 60);
    ctx.fillStyle = `rgba(253,224,71,${a})`;
    for (const x of o.warnCols) ctx.fillRect(x * c, 0, c, hpx);
  }

  // no-build ring
  if (o.design) {
    const p = petOf(sc);
    ctx.fillStyle = "rgba(244,63,94,0.13)";
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1 && sc.map[y][x] === ".") ctx.fillRect(x * c, y * c, c, c);
    ctx.fillStyle = "rgba(15,23,42,0.12)";
    for (let x = 0; x < W; x++) if (sc.map[0][x] === ".") ctx.fillRect(x * c, 0, c, c);
  }

  const t = o.time;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const m = f.cells[i];
      const px = x * c;
      const py = y * c;
      switch (m) {
        case M.EMPTY:
        case M.PET:
          break;
        case M.ROCK:
          ctx.fillStyle = "#5b4636";
          ctx.fillRect(px, py, c, c);
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.fillRect(px, py + c * 0.66, c, c * 0.34);
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillRect(px + c * 0.15, py + c * 0.18, c * 0.3, c * 0.14);
          break;
        case M.BUSH:
          ctx.fillStyle = "#166534";
          ctx.fillRect(px, py + c * 0.25, c, c * 0.75);
          ctx.fillStyle = "#22c55e";
          for (const [ox, oy, r] of [
            [0.3, 0.42, 0.26],
            [0.68, 0.38, 0.28],
            [0.5, 0.62, 0.3],
          ]) {
            ctx.beginPath();
            ctx.arc(px + c * ox, py + c * oy, c * r, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case M.DAM:
          ctx.fillStyle = "#78716c";
          ctx.fillRect(px, py, c, c);
          ctx.strokeStyle = "#44403c";
          ctx.strokeRect(px + 2, py + 2, c - 4, c - 4);
          break;
        case M.OBSIDIAN:
          ctx.fillStyle = "#2e1065";
          ctx.fillRect(px, py, c, c);
          ctx.fillStyle = "rgba(196,181,253,0.25)";
          ctx.fillRect(px + c * 0.2, py + c * 0.2, c * 0.25, c * 0.25);
          break;
        case M.WOOD:
          ctx.fillStyle = "#b7834a";
          ctx.fillRect(px + 1, py + 1, c - 2, c - 2);
          ctx.strokeStyle = "#7c4f24";
          ctx.lineWidth = Math.max(1, c / 18);
          for (const k of [0.33, 0.66]) {
            ctx.beginPath();
            ctx.moveTo(px + 2, py + c * k);
            ctx.lineTo(px + c - 2, py + c * k);
            ctx.stroke();
          }
          ctx.lineWidth = 1;
          break;
        case M.STONE:
          ctx.fillStyle = "#9ca3af";
          ctx.fillRect(px + 1, py + 1, c - 2, c - 2);
          ctx.strokeStyle = "#4b5563";
          ctx.lineWidth = Math.max(1, c / 20);
          ctx.beginPath();
          ctx.moveTo(px + 1, py + c / 2);
          ctx.lineTo(px + c - 1, py + c / 2);
          ctx.moveTo(px + c / 2, py + 1);
          ctx.lineTo(px + c / 2, py + c / 2);
          ctx.moveTo(px + c / 4, py + c / 2);
          ctx.lineTo(px + c / 4, py + c - 1);
          ctx.moveTo(px + (3 * c) / 4, py + c / 2);
          ctx.lineTo(px + (3 * c) / 4, py + c - 1);
          ctx.stroke();
          ctx.lineWidth = 1;
          break;
        case M.DRAIN:
          ctx.fillStyle = "#111827";
          ctx.fillRect(px + 1, py + 1, c - 2, c - 2);
          ctx.strokeStyle = "#9ca3af";
          for (let k = 1; k < 4; k++) {
            ctx.beginPath();
            ctx.moveTo(px + (c * k) / 4, py + 3);
            ctx.lineTo(px + (c * k) / 4, py + c - 3);
            ctx.stroke();
          }
          break;
        case M.BAIT:
          ctx.fillStyle = "rgba(250,204,21,0.25)";
          ctx.fillRect(px, py, c, c);
          emoji(ctx, "🌻", px + c / 2, py + c / 2, c * 0.82);
          break;
        case M.FAN_L:
        case M.FAN_R:
        case M.FAN_U: {
          ctx.fillStyle = "#1e3a8a";
          ctx.fillRect(px + 1, py + 1, c - 2, c - 2);
          ctx.save();
          ctx.translate(px + c / 2, py + c / 2);
          ctx.rotate(t / 90);
          emoji(ctx, "🌀", 0, 0, c * 0.7);
          ctx.restore();
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.round(c * 0.42)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(m === M.FAN_L ? "◀" : m === M.FAN_R ? "▶" : "▲", px + c / 2, py + c / 2);
          // beam hint
          ctx.fillStyle = "rgba(147,197,253,0.13)";
          const [dx, dy] = m === M.FAN_L ? [-1, 0] : m === M.FAN_R ? [1, 0] : [0, -1];
          for (let d = 1; d <= 4; d++) {
            const bx = x + dx * d;
            const by = y + dy * d;
            if (bx < 0 || bx >= W || by < 0) break;
            const bm = f.cells[by * W + bx];
            if (bm !== M.EMPTY && bm !== M.GAS && bm !== M.STEAM) break;
            ctx.fillRect(bx * c, by * c, c, c);
          }
          break;
        }
        case M.ROD:
          ctx.fillStyle = "#475569";
          ctx.fillRect(px + c * 0.44, py + c * 0.15, c * 0.12, c * 0.85);
          ctx.fillStyle = "#facc15";
          ctx.beginPath();
          ctx.moveTo(px + c * 0.5, py + 1);
          ctx.lineTo(px + c * 0.62, py + c * 0.22);
          ctx.lineTo(px + c * 0.38, py + c * 0.22);
          ctx.fill();
          break;
        case M.WATER:
          ctx.fillStyle = "rgba(37,99,235,0.85)";
          ctx.fillRect(px, py, c, c);
          ctx.fillStyle = "rgba(191,219,254,0.5)";
          ctx.fillRect(px + c * (0.15 + 0.1 * Math.sin((t + i * 97) / 200)), py + c * 0.2, c * 0.3, c * 0.08);
          break;
        case M.LAVA: {
          const fl = 0.75 + 0.25 * Math.sin((t + i * 53) / 120);
          ctx.fillStyle = `rgb(${Math.round(234 * fl + 20)},${Math.round(88 * fl)},12)`;
          ctx.fillRect(px, py, c, c);
          ctx.fillStyle = "rgba(253,224,71,0.6)";
          ctx.beginPath();
          ctx.arc(px + c * 0.5, py + c * 0.45, c * 0.18 * fl, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case M.ACID:
          ctx.fillStyle = "rgba(132,204,22,0.9)";
          ctx.fillRect(px, py, c, c);
          ctx.fillStyle = "rgba(236,252,203,0.7)";
          ctx.beginPath();
          ctx.arc(px + c * (0.3 + 0.4 * (((t / 300 + i) % 10) / 10)), py + c * 0.35, c * 0.08, 0, Math.PI * 2);
          ctx.fill();
          break;
        case M.SAND:
          ctx.fillStyle = "#d6b46a";
          ctx.fillRect(px, py, c, c);
          ctx.fillStyle = "rgba(120,80,30,0.3)";
          ctx.fillRect(px + c * 0.2, py + c * 0.6, c * 0.12, c * 0.12);
          ctx.fillRect(px + c * 0.65, py + c * 0.3, c * 0.1, c * 0.1);
          break;
        case M.SNOW:
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(px, py, c, c);
          ctx.fillStyle = "rgba(148,163,184,0.35)";
          ctx.fillRect(px, py + c * 0.8, c, c * 0.2);
          break;
        case M.BOULDER:
          ctx.fillStyle = "#57534e";
          ctx.beginPath();
          ctx.arc(px + c / 2, py + c / 2, c * 0.46, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.18)";
          ctx.beginPath();
          ctx.arc(px + c * 0.38, py + c * 0.36, c * 0.14, 0, Math.PI * 2);
          ctx.fill();
          break;
        case M.GAS:
          ctx.fillStyle = `rgba(147,51,234,${0.45 + 0.1 * Math.sin((t + i * 31) / 180)})`;
          ctx.beginPath();
          ctx.arc(px + c / 2, py + c / 2, c * 0.55, 0, Math.PI * 2);
          ctx.fill();
          break;
        case M.STEAM:
          ctx.fillStyle = "rgba(255,255,255,0.4)";
          ctx.beginPath();
          ctx.arc(px + c / 2, py + c / 2, c * 0.45, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
      if (f.burn[i] > 0) {
        ctx.fillStyle = `rgba(249,115,22,${0.35 + 0.2 * Math.sin((t + i * 71) / 70)})`;
        ctx.fillRect(px, py, c, c);
        emoji(ctx, "🔥", px + c / 2, py + c * 0.42, c * (0.75 + 0.1 * Math.sin((t + i * 13) / 90)));
      }
    }
  }

  // design overlays: emitters + hover
  if (o.design && o.emitters) {
    for (const mk of emitterMarks(o.emitters)) {
      // pulsing ring so the source shows even without colour emoji
      ctx.strokeStyle = `rgba(244,63,94,${0.55 + 0.35 * Math.sin(o.time / 180)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(mk.x * c + c / 2, mk.y * c + c / 2, c * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.9;
      emoji(ctx, mk.icon, mk.x * c + c / 2, mk.y * c + c / 2, c * 0.78);
      ctx.globalAlpha = 1;
    }
  }
  if (o.hover) {
    ctx.strokeStyle = o.hover.ok ? "rgba(255,255,255,0.95)" : "rgba(244,63,94,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(o.hover.x * c + 1, o.hover.y * c + 1, c - 2, c - 2);
    ctx.lineWidth = 1;
  }

  // agents
  for (const a of f.agents) {
    const cx = a.x * c + c / 2;
    const bob = a.kind === "rat" || a.kind === "meteor" ? 0 : Math.sin((t + a.id * 140) / 110) * c * 0.08;
    if (a.kind === "meteor") {
      ctx.fillStyle = "rgba(251,146,60,0.45)";
      ctx.beginPath();
      ctx.arc(cx - c * 0.3, a.y * c + c * 0.2, c * 0.28, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, "☄️", cx, a.y * c + c / 2, c * 0.95);
      continue;
    }
    // colour disc so creatures read even where colour emoji are missing
    ctx.fillStyle = a.kind === "bee" ? "rgba(250,204,21,0.75)" : a.kind === "hornet" ? "rgba(234,88,12,0.8)" : a.kind === "bat" ? "rgba(76,29,149,0.75)" : "rgba(87,83,78,0.8)";
    ctx.beginPath();
    ctx.arc(cx, a.y * c + c / 2 + bob, c * 0.32, 0, Math.PI * 2);
    ctx.fill();
    if (a.kind === "hornet") {
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, a.y * c + c / 2 + bob, c * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    emoji(ctx, a.kind === "bat" ? "🦇" : a.kind === "rat" ? "🐀" : "🐝", cx, a.y * c + c / 2 + bob, c * (a.kind === "hornet" ? 0.85 : 0.75));
  }

  // pet
  {
    const px = f.petX * c + c / 2;
    const py = f.petY * c + c / 2;
    if (f.hit) {
      ctx.fillStyle = "rgba(239,68,68,0.45)";
      ctx.beginPath();
      ctx.arc(px, py, c * 0.75, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, o.petEmoji, px, py, c * 0.9);
      emoji(ctx, "💥", px + c * 0.3, py - c * 0.35, c * 0.6);
    } else {
      const hop = o.design ? Math.abs(Math.sin(t / 260)) * c * 0.08 : 0;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(px, py, c * 0.55, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, o.petEmoji, px, py - hop, c * 0.92);
    }
  }

  // bolts
  for (const b of o.bolts ?? []) {
    ctx.strokeStyle = b.rod ? "#fde047" : "#fef9c3";
    ctx.lineWidth = Math.max(2, c / 8);
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    let x = b.x * c + c / 2;
    ctx.moveTo(x, 0);
    const steps = Math.max(2, b.y + 1);
    for (let k = 1; k <= steps; k++) {
      x = b.x * c + c / 2 + (k === steps ? 0 : (((k * 37 + b.x * 11) % 7) - 3) * c * 0.12);
      ctx.lineTo(x, Math.min(b.y * c + c / 2, (k / steps) * (b.y * c + c / 2)));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
  }
  for (const b of o.booms ?? []) {
    const r = c * (0.8 + b.age * 0.35);
    ctx.fillStyle = `rgba(251,146,60,${Math.max(0, 0.6 - b.age * 0.15)})`;
    ctx.beginPath();
    ctx.arc(b.x * c + c / 2, b.y * c + c / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Static board for the design phase (map + layout, no sim). */
export function designFrame(sc: Scenario, pieces: readonly { x: number; y: number; k: number }[], mats: readonly number[]): Frame {
  const cells = new Uint8Array(W * H);
  const ch: Record<string, number> = { "#": M.ROCK, g: M.BUSH, d: M.DAM, w: M.WATER, s: M.SAND, P: M.PET };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[y * W + x] = ch[sc.map[y][x]] ?? M.EMPTY;
  for (const p of pieces) if (canBuild(sc, p.x, p.y)) cells[p.y * W + p.x] = mats[p.k];
  const pet = petOf(sc);
  return { cells, burn: new Uint8Array(W * H), agents: [], petX: pet.x, petY: pet.y, tick: 0, events: [], hit: null };
}
