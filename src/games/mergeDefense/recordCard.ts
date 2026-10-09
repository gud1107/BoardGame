import { MAPS, sanitizeMap, type Difficulty, type GameMode, type MapId } from "./engine";

/**
 * A 1080×1080 PNG of a broken record, for 📷 저장 / 📤 공유 on the results
 * screen: the map's road sketch, WAVE before → after, setup, name and date.
 * Drawn straight onto a canvas (no DOM capture library) — UI-only file.
 */
export interface RecordCardInput {
  map?: MapId;
  mode: GameMode;
  difficulty: Difficulty;
  wave: number;
  prev: number;
  name: string;
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

  // Map sketch (the board is 400×280 logical units).
  const k = 1.5;
  const ox = (SIZE - 400 * k) / 2;
  const oy = 300;
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
