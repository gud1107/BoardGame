import { MAPS, sanitizeMap, type Difficulty, type GameMode, type MapId } from "./engine";

/**
 * A 1080×1080 PNG of a broken record, for 📷 저장 / 📤 공유 on the results
 * screen: the map's road sketch (+ this match's wave chart), WAVE before →
 * after, setup, name and date.
 * Drawn straight onto a canvas (no DOM capture library) — UI-only file.
 */
export interface RecordCardInput {
  map?: MapId;
  mode: GameMode;
  difficulty: Difficulty;
  wave: number;
  prev: number;
  name: string;
  /** This match's per-wave peak monsters on each road (the results chart) — drawn beside the map when present. */
  chart?: { limit: number; bossEvery: number; series: { load: number[]; color: string; me: boolean }[] };
}

const SIZE = 1080;
const FONT = `"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
const DIFF: Record<Difficulty, string> = { easy: "🌱 쉬움", normal: "⚖️ 보통", hard: "🔥 어려움" };

export function drawRecordCard(r: RecordCardInput): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const m = MAPS[sanitizeMap(r.map)];
  const beat = r.prev > 0 && r.wave > r.prev;

  // Backdrop: the results screen's warm brown, with a gold glow behind the title.
  const bg = ctx.createLinearGradient(0, 0, SIZE * 0.4, SIZE);
  bg.addColorStop(0, "#3b1d06");
  bg.addColorStop(0.55, "#1c1206");
  bg.addColorStop(1, "#0a0703");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const glow = ctx.createRadialGradient(SIZE / 2, 250, 20, SIZE / 2, 250, 520);
  glow.addColorStop(0, "rgba(251,191,36,0.35)");
  glow.addColorStop(1, "rgba(251,191,36,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(252,211,77,0.85)";
  ctx.lineWidth = 10;
  roundRect(ctx, 30, 30, SIZE - 60, SIZE - 60, 48);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(253,230,138,0.85)";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("🎲 랜덤 합성 디펜스", SIZE / 2, 110);
  ctx.fillStyle = "#fffbeb";
  ctx.font = `900 96px ${FONT}`;
  ctx.fillText(beat ? "🏆 이 맵 신기록!" : "🏅 최고 기록!", SIZE / 2, 220);

  // Map sketch (the board is 400×280 logical units) — centred, or on the left of the chart.
  const chart = r.chart && r.chart.series.some((x) => x.load.length > 1) ? r.chart : null;
  const k = chart ? 1.05 : 1.5;
  const ox = chart ? 70 : (SIZE - 400 * k) / 2;
  const oy = chart ? 330 : 300;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  ctx.fillStyle = m.grass[1];
  roundRect(ctx, 0, 0, 400, 280, 24);
  ctx.fill();
  ctx.strokeStyle = "#c8a06a";
  ctx.lineWidth = 30;
  ctx.lineJoin = "round";
  ctx.beginPath();
  m.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  for (const [x, y] of m.slots) {
    roundRect(ctx, x - 22, y - 22, 44, 44, 9);
    ctx.fill();
  }
  ctx.fillStyle = "#a855f7";
  ctx.beginPath();
  ctx.arc(m.path[0][0], m.path[0][1], 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (chart) drawChart(ctx, chart, 540, 310, 470, 340);

  ctx.fillStyle = "#fde68a";
  ctx.font = `800 46px ${FONT}`;
  ctx.fillText(`${m.emoji} ${m.name}  ·  ${DIFF[r.difficulty]}  ·  ${r.mode === "versus" ? "⚔️ 유닛 대결" : "🛡️ 생존전"}`, SIZE / 2, 770);

  ctx.font = `900 120px ${FONT}`;
  const waveText = beat ? `WAVE ${r.prev} → ${r.wave}` : `WAVE ${r.wave}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(waveText, SIZE / 2, 880);
  if (beat) {
    ctx.font = `800 44px ${FONT}`;
    ctx.fillStyle = "#6ee7b7";
    ctx.fillText(`+${r.wave - r.prev} 웨이브`, SIZE / 2, 960);
  }

  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  const date = new Date().toLocaleDateString("ko-KR");
  ctx.fillText([r.name.slice(0, 16), date, window.location.host].filter(Boolean).join("  ·  "), SIZE / 2, 1015);
  return c;
}

/** Peak monsters per wave: my line bold on top, the others thin, the elimination line dashed red. */
function drawChart(ctx: CanvasRenderingContext2D, ch: NonNullable<RecordCardInput["chart"]>, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText("👾 웨이브별 최대 몬스터", x + 22, y + 32);
  const px = x + 30;
  const py = y + 64;
  const pw = w - 60;
  const ph = h - 110;
  const waves = Math.max(2, ...ch.series.map((s) => s.load.length));
  const top = Math.max(ch.limit, ...ch.series.flatMap((s) => s.load)) * 1.05;
  const X = (i: number) => px + (i / (waves - 1)) * pw;
  const Y = (v: number) => py + ph - (v / top) * ph;
  // Boss waves as faint gold columns.
  ctx.fillStyle = "rgba(250,204,21,0.08)";
  for (let wv = ch.bossEvery; wv <= waves; wv += ch.bossEvery) ctx.fillRect(X(wv - 1) - 5, py, 10, ph);
  ctx.strokeStyle = "rgba(248,113,113,0.85)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(px, Y(ch.limit));
  ctx.lineTo(px + pw, Y(ch.limit));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#fca5a5";
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`탈락 ${ch.limit}`, px + 4, Y(ch.limit) - 10);
  const line = (load: number[], color: string, width: number, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    load.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  for (const s of ch.series) if (!s.me) line(s.load, s.color, 3, 0.45);
  for (const s of ch.series) if (s.me) line(s.load, "#fbbf24", 7, 1);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `600 20px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("W1", px, py + ph + 30);
  ctx.textAlign = "right";
  ctx.fillText(`W${waves}`, px + pw, py + ph + 30);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function recordCardBlob(r: RecordCardInput): Promise<Blob | null> {
  return new Promise((resolve) => drawRecordCard(r).toBlob(resolve, "image/png"));
}

export function recordCardFileName(r: RecordCardInput): string {
  return `merge-defense-${sanitizeMap(r.map)}-wave${r.wave}.png`;
}
