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

const ROCK: Partial<Record<Scenario["sky"], [string, string]>> & { day: [string, string] } = {
  day: ["#6b5240", "#5a4434"],
  dusk: ["#6b4a3a", "#583a2e"],
  night: ["#3f3a4a", "#332e3d"],
  cave: ["#44403c", "#36322f"],
  storm: ["#4b5563", "#3f4752"],
  desert: ["#b7793f", "#9c6433"],
  volcano: ["#2b1d1a", "#1f1513"],
  toxic: ["#3f4a2a", "#333d22"],
  snow: ["#64748b", "#56657a"],
};
const CAP: Partial<Record<Scenario["sky"], string>> = {
  day: "#4ade80",
  dusk: "#65a30d",
  storm: "#4d7c0f",
  snow: "#f8fafc",
  toxic: "#a3e635",
};

/** Cheap animated backdrop per sky. */
function drawScenery(ctx: CanvasRenderingContext2D, sky: Scenario["sky"], w: number, h: number, c: number, t: number) {
  const cloud = (cx: number, cy: number, s: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, s, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.9, cy - s * 0.35, s * 0.8, 0, Math.PI * 2);
    ctx.arc(cx + s * 1.7, cy, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
  };
  if (sky === "day" || sky === "desert" || sky === "dusk") {
    const sx = w * 0.82;
    const sy = c * 1.6;
    const sg = ctx.createRadialGradient(sx, sy, c * 0.2, sx, sy, c * 2.2);
    sg.addColorStop(0, sky === "dusk" ? "rgba(254,215,170,0.95)" : "rgba(254,249,195,0.95)");
    sg.addColorStop(1, "rgba(254,249,195,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(sx - c * 2.2, sy - c * 2.2, c * 4.4, c * 4.4);
  }
  if (sky === "day" || sky === "storm" || sky === "snow" || sky === "dusk") {
    const col = sky === "storm" ? "rgba(30,41,59,0.45)" : "rgba(255,255,255,0.55)";
    const span = w + c * 6;
    for (let k = 0; k < 3; k++) {
      const cx = ((t / (90 + k * 40) + k * span * 0.37) % span) - c * 3;
      cloud(cx, c * (1.2 + k * 1.3), c * (0.6 + 0.15 * k), col);
    }
  }
  if (sky === "night" || sky === "cave") {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let k = 0; k < 18; k++) {
      const x = ((k * 7919) % 997) / 997;
      const y = ((k * 104729) % 991) / 991;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t / 700 + k));
      ctx.globalAlpha = sky === "cave" ? tw * 0.25 : tw;
      ctx.fillRect(x * w, y * h * 0.6, Math.max(1, c * 0.06), Math.max(1, c * 0.06));
    }
    ctx.globalAlpha = 1;
  }
  if (sky === "volcano" || sky === "toxic" || sky === "snow") {
    ctx.fillStyle = sky === "volcano" ? "rgba(251,146,60,0.7)" : sky === "toxic" ? "rgba(217,249,157,0.45)" : "rgba(255,255,255,0.8)";
    const down = sky === "snow";
    for (let k = 0; k < 14; k++) {
      const x = ((k * 7919) % 997) / 997;
      const ph = (((t / (2600 + (k % 5) * 400) + k * 0.137) % 1) + 1) % 1;
      const y = down ? ph : 1 - ph;
      ctx.beginPath();
      ctx.arc(x * w + Math.sin(t / 600 + k) * c * 0.3, y * h, c * (0.05 + (k % 3) * 0.025), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (sky === "storm") {
    const flash = Math.max(0, Math.sin(t / 1700) - 0.97) * 20;
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.25})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function firstSolidBelow(f: Frame, x: number, y: number): number {
  for (let yy = y + 1; yy < H; yy++) {
    const m = f.cells[yy * W + x];
    if (m !== M.EMPTY && m !== M.PET) return yy;
  }
  return H;
}

const PATH_RGB: Record<number, string> = {
  [M.WATER]: "96,165,250",
  [M.LAVA]: "249,115,22",
  [M.ACID]: "163,230,53",
  [M.SAND]: "214,180,106",
  [M.SNOW]: "241,245,249",
  [M.BOULDER]: "120,113,108",
  [M.GAS]: "168,85,247",
};

/** Design phase: animate where each hazard will travel (falling streams, rain bands, flight lines). */
function drawForecastPaths(ctx: CanvasRenderingContext2D, sc: Scenario, f: Frame, emitters: readonly Emitter[], c: number, t: number) {
  const pet = { x: f.petX * c + c / 2, y: f.petY * c + c / 2 };
  for (const e of emitters) {
    if (e.k === "pour") {
      const rgb = PATH_RGB[e.mat] ?? PATH_RGB[M.WATER];
      const len = firstSolidBelow(f, e.x, e.y) - e.y - 0.5;
      ctx.fillStyle = `rgba(${rgb},0.2)`;
      ctx.fillRect(e.x * c + c * 0.3, e.y * c + c / 2, c * 0.4, len * c);
      ctx.fillStyle = `rgba(${rgb},0.95)`;
      for (let k = 0; k < 3; k++) {
        const ph = ((t / 900 + k / 3) % 1) * len;
        ctx.beginPath();
        ctx.arc(e.x * c + c / 2, e.y * c + c / 2 + ph * c, c * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.k === "rain" || e.k === "meteor" || e.k === "bolt") {
      const rgb = e.k === "rain" ? (PATH_RGB[e.mat] ?? PATH_RGB[M.WATER]) : e.k === "meteor" ? "251,146,60" : "253,224,71";
      const bg = ctx.createLinearGradient(0, 0, 0, c * 4);
      bg.addColorStop(0, `rgba(${rgb},0.4)`);
      bg.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = bg;
      ctx.fillRect(e.x0 * c, 0, (e.x1 - e.x0 + 1) * c, c * 4);
      ctx.strokeStyle = `rgba(${rgb},0.85)`;
      ctx.lineWidth = Math.max(1.5, c / 12);
      ctx.beginPath();
      for (let x = e.x0; x <= e.x1; x++) {
        const depth = Math.min(firstSolidBelow(f, x, 0), 7);
        const ph = ((t / (e.k === "rain" ? 700 : 1100) + ((x * 37) % 11) / 11) % 1) * depth;
        const slant = e.k === "meteor" ? c * 0.3 : 0;
        const sx = x * c + c / 2 - (e.k === "meteor" ? ph * c * 0.3 : 0);
        ctx.moveTo(sx, ph * c);
        ctx.lineTo(sx + slant, ph * c + c * 0.55);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    } else if (e.k === "spawn") {
      const sx = e.x * c + c / 2;
      const sy = e.y * c + c / 2;
      ctx.strokeStyle = "rgba(250,204,21,0.85)";
      ctx.lineWidth = Math.max(1.5, c / 14);
      ctx.setLineDash([c * 0.25, c * 0.2]);
      ctx.lineDashOffset = -t / 40;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo((sx + pet.x) / 2, Math.min(sy, pet.y) - c * 1.5, pet.x, pet.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.lineWidth = 1;
      const bx = Math.min(W * c - c * 0.3, sx + c * 0.45);
      const by = Math.max(c * 0.3, sy - c * 0.45);
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(bx, by, c * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(c * 0.3)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`×${e.count}`, bx, by + 1);
    } else if (e.k === "breach") {
      ctx.strokeStyle = `rgba(239,68,68,${0.5 + 0.4 * Math.sin(t / 150)})`;
      ctx.lineWidth = 2;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sc.map[y][x] === "d") ctx.strokeRect(x * c + 2, y * c + 2, c - 4, c - 4);
      ctx.lineWidth = 1;
    }
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
  /** Replay finished and the pet is safe → golden halo. */
  safe?: boolean;
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
  drawScenery(ctx, sc.sky, wpx, hpx, c, o.time);

  // faint grid (design only — the replay reads cleaner without it)
  if (o.design) {
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < W; x++) {
      ctx.moveTo(x * c + 0.5, 0);
      ctx.lineTo(x * c + 0.5, hpx);
    }
    for (let y = 1; y < H; y++) {
      ctx.moveTo(0, y * c + 0.5);
      ctx.lineTo(wpx, y * c + 0.5);
    }
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
        case M.ROCK: {
          const pal = ROCK[sc.sky] ?? ROCK.day;
          const above = y > 0 ? f.cells[i - W] : M.EMPTY;
          const below = y < H - 1 ? f.cells[i + W] : M.ROCK;
          ctx.fillStyle = pal[0];
          ctx.fillRect(px, py, c + 0.5, c + 0.5);
          // speckles (stable per cell)
          ctx.fillStyle = pal[1];
          const hsh = Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
          for (let k = 0; k < 3; k++) {
            const sx = ((hsh >>> (k * 5)) & 31) / 31;
            const sy = ((hsh >>> (k * 5 + 15)) & 31) / 31;
            ctx.fillRect(px + c * (0.1 + 0.7 * sx), py + c * (0.15 + 0.7 * sy), c * 0.14, c * 0.1);
          }
          if (above !== M.ROCK) {
            ctx.fillStyle = "rgba(255,255,255,0.16)";
            ctx.fillRect(px, py, c, c * 0.12);
            const cap = CAP[sc.sky];
            if (cap && (above === M.EMPTY || above === M.PET)) {
              ctx.fillStyle = cap;
              ctx.fillRect(px, py, c + 0.5, c * 0.2);
              for (let k = 0; k < 3; k++) ctx.fillRect(px + c * (0.12 + k * 0.33), py + c * 0.2, c * 0.12, c * 0.1);
            }
          }
          if (below !== M.ROCK) {
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.fillRect(px, py + c * 0.82, c, c * 0.18);
          }
          break;
        }
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
        case M.WATER: {
          const deep = y > 0 && f.cells[i - W] === M.WATER;
          ctx.fillStyle = deep ? "rgba(29,78,216,0.9)" : "rgba(59,130,246,0.88)";
          ctx.fillRect(px, py, c + 0.5, c + 0.5);
          if (!deep) {
            const wv = Math.sin((t + x * 220) / 180) * c * 0.06;
            ctx.fillStyle = "rgba(219,234,254,0.85)";
            ctx.fillRect(px, py + c * 0.08 + wv, c + 0.5, c * 0.1);
          } else {
            ctx.fillStyle = "rgba(191,219,254,0.22)";
            ctx.fillRect(px + c * (0.2 + 0.15 * Math.sin((t + i * 97) / 260)), py + c * 0.45, c * 0.25, c * 0.06);
          }
          break;
        }
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

  // design overlays: animated hazard paths, emitters + hover
  if (o.design && o.emitters) {
    drawForecastPaths(ctx, sc, f, o.emitters, c, o.time);
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
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(px, py + c * 0.42, c * 0.38, c * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    if (f.hit) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 90);
      const r = c * (0.9 + 0.25 * pulse);
      const rg = ctx.createRadialGradient(px, py, c * 0.1, px, py, r);
      rg.addColorStop(0, "rgba(239,68,68,0.75)");
      rg.addColorStop(1, "rgba(239,68,68,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(0.35);
      emoji(ctx, o.petEmoji, 0, 0, c * 0.9);
      ctx.restore();
      emoji(ctx, "💥", px + c * 0.32, py - c * 0.38, c * (0.55 + 0.15 * pulse));
    } else {
      const hop = Math.abs(Math.sin(t / (o.design ? 260 : 180))) * c * 0.08;
      const rg = ctx.createRadialGradient(px, py, c * 0.1, px, py, c * 0.75);
      rg.addColorStop(0, o.safe ? "rgba(253,224,71,0.85)" : "rgba(255,255,255,0.6)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(px, py, c * 0.75, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, o.petEmoji, px, py - hop, c * 0.92);
      if (o.safe) emoji(ctx, "✨", px + c * 0.38, py - c * 0.42 - hop, c * 0.42);
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

  // soft vignette
  const vg = ctx.createRadialGradient(wpx / 2, hpx / 2, Math.min(wpx, hpx) * 0.45, wpx / 2, hpx / 2, Math.max(wpx, hpx) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, wpx, hpx);
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
