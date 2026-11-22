import { ENEMIES, PILOTS, type EnemyKind, type PilotId } from "./data";

/**
 * 구름 편대 아트 (룰북 §11). 전부 코드로 그린 벡터 — 이미지 파일 없음.
 *
 * - 아군 기체: 조종사마다 실루엣이 완전히 다르다(색각 이상이어도 모양으로 구분). 금속 그라데이션
 *   몸통 + 패널 선 + 대표색 띠 + 유리 조종석 반사 + 날개 끝 항법등(왼쪽 빨강·오른쪽 초록).
 * - 적 "잿빛 폭풍단": 건메탈 장갑 + 진홍색 발광 눈/핵 + 주황 배기구로 통일. 아래를 향한다.
 * - 적탄은 모두 **흰 테두리 링**, 아군 탄은 테두리 없는 빛줄기 — 모양부터 다르다.
 *
 * 무거운 정적 그림은 처음 한 번 오프스크린 캔버스에 3배 해상도로 구워 두고(`spriteOf`) 매 프레임
 * drawImage만 한다. 보스·회전 포탑·날갯짓처럼 움직이는 부분만 매번 그린다.
 */

export type Ctx = CanvasRenderingContext2D;

const SS = 3; // 스프라이트 해상도 배율

interface Sprite {
  c: HTMLCanvasElement;
  w: number;
  h: number;
}

const cache = new Map<string, Sprite>();

function bake(key: string, w: number, h: number, draw: (g: Ctx) => void): Sprite {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * SS);
  c.height = Math.ceil(h * SS);
  const g = c.getContext("2d")!;
  g.scale(SS, SS);
  g.translate(w / 2, h / 2);
  draw(g);
  const sp = { c, w, h };
  cache.set(key, sp);
  return sp;
}

export function drawSprite(g: Ctx, sp: Sprite, x: number, y: number, scale = 1, rot = 0, alpha = 1) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  if (alpha !== 1) g.globalAlpha *= alpha;
  g.drawImage(sp.c, (-sp.w / 2) * scale, (-sp.h / 2) * scale, sp.w * scale, sp.h * scale);
  g.restore();
}

/* ── 색 보조 ─────────────────────────────────────────────────────────── */

function mix(a: string, b: string, k: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * k));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}
function hex(c: string): number[] {
  const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
export function rgba(c: string, a: number): string {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}

function path(g: Ctx, pts: number[], close = true) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  if (close) g.closePath();
}

/** 왼쪽 위에서 빛이 오는 금속 그라데이션 */
function metal(g: Ctx, x0: number, x1: number, light: string, dark: string): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, dark);
  gr.addColorStop(0.28, light);
  gr.addColorStop(0.55, mix(light, dark, 0.35));
  gr.addColorStop(1, dark);
  return gr;
}

function glass(g: Ctx, x: number, y: number, rx: number, ry: number, tint = "#9fe7ff") {
  const gr = g.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
  gr.addColorStop(0, "#f4fdff");
  gr.addColorStop(0.35, tint);
  gr.addColorStop(1, "#0c2236");
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(10,20,30,.55)";
  g.lineWidth = 0.6;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,.85)";
  g.beginPath();
  g.ellipse(x - rx * 0.35, y - ry * 0.35, rx * 0.25, ry * 0.4, -0.5, 0, Math.PI * 2);
  g.fill();
}

function navLights(g: Ctx, lx: number, ly: number, rx: number, ry: number) {
  for (const [x, y, c] of [
    [lx, ly, "#ff4d5e"],
    [rx, ry, "#4dff9a"],
  ] as const) {
    const gr = g.createRadialGradient(x, y, 0, x, y, 3.2);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.35, c);
    gr.addColorStop(1, rgba(c === "#ff4d5e" ? "#ff4d5e" : "#4dff9a", 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
  }
}

function panel(g: Ctx, pts: number[], close = false, w = 0.45, c = "rgba(8,14,24,.38)") {
  path(g, pts, close);
  g.strokeStyle = c;
  g.lineWidth = w;
  g.stroke();
}

function outline(g: Ctx, w = 0.9) {
  g.strokeStyle = "rgba(6,10,18,.75)";
  g.lineWidth = w;
  g.lineJoin = "round";
  g.stroke();
}

/* ── 아군 기체 (위를 본다) ───────────────────────────────────────────── */

/** 기체별 엔진 불꽃 위치 (스프라이트 좌표) */
export const ENGINE_PORTS: Record<PilotId, [number, number][]> = {
  wind: [[0, 21]],
  iron: [
    [-15, 17],
    [15, 17],
  ],
  firefly: [[0, 17]],
  bolt: [[0, 22]],
  shadow: [
    [-6, 13],
    [6, 13],
  ],
  flame: [
    [-14, 23],
    [14, 23],
  ],
};

function drawPlaneBody(g: Ctx, id: PilotId) {
  const P = PILOTS[id];
  const c = P.color;
  const d = P.dark;
  switch (id) {
    case "wind": {
      // 가는 델타익 + 카나드
      g.fillStyle = metal(g, -24, 24, mix(c, "#ffffff", 0.55), d);
      path(g, [0, -4, 23, 13, 22, 17, 6, 15, -6, 15, -22, 17, -23, 13]);
      g.fill();
      outline(g);
      g.fillStyle = rgba(c, 0.95);
      path(g, [9, 6, 21, 13.5, 21, 15.5, 8, 9.5]);
      g.fill();
      path(g, [-9, 6, -21, 13.5, -21, 15.5, -8, 9.5]);
      g.fill();
      // 카나드
      g.fillStyle = metal(g, -10, 10, "#e9f2f6", d);
      path(g, [3, -12, 10, -8, 10, -6, 3, -8]);
      g.fill();
      outline(g, 0.6);
      path(g, [-3, -12, -10, -8, -10, -6, -3, -8]);
      g.fill();
      outline(g, 0.6);
      // 몸통
      g.fillStyle = metal(g, -4, 4, "#f2f8fb", mix(d, "#000000", 0.2));
      path(g, [0, -27, 3, -18, 4, 2, 3.5, 19, 0, 21, -3.5, 19, -4, 2, -3, -18]);
      g.fill();
      outline(g);
      panel(g, [-4, 2, 4, 2]);
      panel(g, [-3.5, 10, 3.5, 10]);
      // 꼬리 날개 두 장 (위에서 보면 가는 선)
      g.fillStyle = mix(c, d, 0.4);
      path(g, [3, 12, 7, 20, 5.5, 20.5, 2.5, 15]);
      g.fill();
      path(g, [-3, 12, -7, 20, -5.5, 20.5, -2.5, 15]);
      g.fill();
      glass(g, 0, -13, 2.4, 5.2);
      navLights(g, -22.5, 15, 22.5, 15);
      break;
    }
    case "iron": {
      // 넓은 직선익 화물기 + 장갑판
      g.fillStyle = metal(g, -31, 31, "#dfe6ef", d);
      path(g, [-31, -3, 31, -3, 31, 6, 26, 9, -26, 9, -31, 6]);
      g.fill();
      outline(g);
      for (const x of [-22, -8, 8, 22]) panel(g, [x, -3, x, 9]);
      g.fillStyle = rgba(c, 0.9);
      g.fillRect(-31, -3, 5, 9);
      g.fillRect(26, -3, 5, 9);
      // 엔진 포드
      for (const x of [-15, 15]) {
        g.fillStyle = metal(g, x - 5, x + 5, "#cfd8e3", "#2a3240");
        path(g, [x - 4.5, -10, x + 4.5, -10, x + 5, 15, x + 3, 18, x - 3, 18, x - 5, 15]);
        g.fill();
        outline(g, 0.7);
        g.fillStyle = "#11161f";
        g.beginPath();
        g.ellipse(x, -9.5, 3.4, 1.6, 0, 0, Math.PI * 2);
        g.fill();
        panel(g, [x - 5, 4, x + 5, 4]);
      }
      // 두꺼운 몸통
      g.fillStyle = metal(g, -8, 8, "#eef2f7", mix(d, "#000000", 0.25));
      path(g, [-6, -24, 6, -24, 8, -14, 8, 18, 5, 26, -5, 26, -8, 18, -8, -14]);
      g.fill();
      outline(g);
      // 장갑 코
      g.fillStyle = "#5b6778";
      path(g, [-6, -24, 6, -24, 7, -18, -7, -18]);
      g.fill();
      outline(g, 0.6);
      for (const y of [-6, 4, 14]) panel(g, [-8, y, 8, y]);
      g.fillStyle = "rgba(255,255,255,.5)";
      for (const [x, y] of [
        [-6, -10],
        [6, -10],
        [-6, 0],
        [6, 0],
        [-6, 10],
        [6, 10],
      ])
        g.fillRect(x - 0.4, y - 0.4, 0.8, 0.8);
      // 꼬리날개
      g.fillStyle = metal(g, -16, 16, "#d5dde7", d);
      path(g, [-16, 19, 16, 19, 14, 24, -14, 24]);
      g.fill();
      outline(g, 0.7);
      g.fillStyle = c;
      g.fillRect(-2, 19, 4, 5);
      glass(g, 0, -14, 4, 3.2, "#b9d7ff");
      navLights(g, -30.5, 1.5, 30.5, 1.5);
      break;
    }
    case "firefly": {
      // 둥근 구조정 + 양옆 회전익 포드 + 등불 돔
      g.fillStyle = metal(g, -26, 26, mix(c, "#ffffff", 0.4), d);
      path(g, [-25, 2, -12, -1, 12, -1, 25, 2, 25, 7, 12, 9, -12, 9, -25, 7]);
      g.fill();
      outline(g);
      for (const x of [-22, 22]) {
        const gr = g.createRadialGradient(x - 2, 0, 1, x, 3, 7);
        gr.addColorStop(0, "#f4ffd8");
        gr.addColorStop(0.4, mix(c, "#ffffff", 0.2));
        gr.addColorStop(1, d);
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, 3, 6.2, 0, Math.PI * 2);
        g.fill();
        outline(g, 0.7);
        g.fillStyle = "#1c2610";
        g.beginPath();
        g.arc(x, 3, 1.6, 0, Math.PI * 2);
        g.fill();
      }
      const body = g.createRadialGradient(-4, -6, 2, 0, 0, 16);
      body.addColorStop(0, "#fbfff0");
      body.addColorStop(0.45, mix(c, "#ffffff", 0.25));
      body.addColorStop(1, d);
      g.fillStyle = body;
      g.beginPath();
      g.ellipse(0, 1, 13.5, 15.5, 0, 0, Math.PI * 2);
      g.fill();
      outline(g);
      panel(g, [-13, 3, 13, 3]);
      g.beginPath();
      g.ellipse(0, 1, 9.5, 11.5, 0, 0, Math.PI * 2);
      g.strokeStyle = "rgba(20,30,10,.3)";
      g.lineWidth = 0.5;
      g.stroke();
      // 구조 표식 (+)
      g.fillStyle = "#fffef2";
      g.fillRect(-1.6, 7, 3.2, 8);
      g.fillRect(-4, 9.4, 8, 3.2);
      g.fillStyle = "#e0463c";
      g.fillRect(-1, 7.6, 2, 6.8);
      g.fillRect(-3.4, 10, 6.8, 2);
      glass(g, 0, -6, 6, 5.2, "#fff3b0");
      navLights(g, -28, 4, 28, 4);
      break;
    }
    case "bolt": {
      // 전진익 + 코일 포신
      g.fillStyle = metal(g, -25, 25, mix(c, "#ffffff", 0.5), d);
      path(g, [-5, 4, -23, -9, -25, -6, -9, 14, 9, 14, 25, -6, 23, -9, 5, 4]);
      g.fill();
      outline(g);
      g.fillStyle = rgba(c, 0.9);
      path(g, [-20, -7, -23, -9, -25, -6, -21, -2]);
      g.fill();
      path(g, [20, -7, 23, -9, 25, -6, 21, -2]);
      g.fill();
      panel(g, [-6, 6, -19, -4]);
      panel(g, [6, 6, 19, -4]);
      // 포신
      g.fillStyle = "#2a2440";
      g.fillRect(-1.6, -36, 3.2, 16);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? mix(c, "#ffffff", 0.5) : c;
        g.fillRect(-2.6, -34 + i * 3.6, 5.2, 1.8);
      }
      // 몸통
      g.fillStyle = metal(g, -6, 6, "#f3eefe", mix(d, "#000000", 0.25));
      path(g, [0, -24, 5, -14, 6, 8, 9, 18, 4, 23, -4, 23, -9, 18, -6, 8, -5, -14]);
      g.fill();
      outline(g);
      panel(g, [-6, 4, 6, 4]);
      // 카나드
      g.fillStyle = mix(c, d, 0.3);
      path(g, [4, -14, 12, -10, 12, -8, 5, -10]);
      g.fill();
      path(g, [-4, -14, -12, -10, -12, -8, -5, -10]);
      g.fill();
      glass(g, 0, -10, 2.8, 5, "#d9c6ff");
      navLights(g, -24, -7.5, 24, -7.5);
      break;
    }
    case "shadow": {
      // 무광 날개 동체 + 톱니 뒷전 + 분홍 이음선
      const gr = g.createLinearGradient(0, -20, 0, 16);
      gr.addColorStop(0, "#5a5f78");
      gr.addColorStop(0.5, "#2b2f42");
      gr.addColorStop(1, "#171a26");
      g.fillStyle = gr;
      path(g, [0, -21, 27, 11, 20, 10, 14, 15, 7, 11, 0, 15, -7, 11, -14, 15, -20, 10, -27, 11]);
      g.fill();
      outline(g);
      g.strokeStyle = rgba(c, 0.95);
      g.lineWidth = 0.8;
      path(g, [0, -16, 21, 9], false);
      g.stroke();
      path(g, [0, -16, -21, 9], false);
      g.stroke();
      g.fillStyle = "rgba(255,255,255,.09)";
      path(g, [0, -21, -27, 11, -20, 10, 0, -12]);
      g.fill();
      // 등 덮개
      g.fillStyle = "#3c4159";
      path(g, [0, -12, 6, 0, 4, 8, -4, 8, -6, 0]);
      g.fill();
      outline(g, 0.5);
      glass(g, 0, -6, 2.3, 4, "#ff9fd0");
      // 은은한 적외선 무늬
      g.fillStyle = rgba(c, 0.8);
      g.fillRect(-12, 6, 4, 1);
      g.fillRect(8, 6, 4, 1);
      navLights(g, -26, 10.5, 26, 10.5);
      break;
    }
    case "flame": {
      // 쌍동체 + 넓은 주익 + 불꽃 문양
      g.fillStyle = metal(g, -30, 30, mix(c, "#ffffff", 0.45), d);
      path(g, [-30, -2, 30, -2, 30, 4, 24, 7, -24, 7, -30, 4]);
      g.fill();
      outline(g);
      for (const x of [-14, 14]) {
        g.fillStyle = metal(g, x - 4, x + 4, "#ffe1cf", mix(d, "#000000", 0.2));
        path(g, [x - 3, -14, x + 3, -14, x + 3.6, 18, x + 2, 22, x - 2, 22, x - 3.6, 18]);
        g.fill();
        outline(g, 0.7);
        g.fillStyle = "#2b130b";
        g.beginPath();
        g.ellipse(x, -13.5, 2.4, 1.2, 0, 0, Math.PI * 2);
        g.fill();
        // 불꽃 데칼
        g.fillStyle = "#ffcf4d";
        path(g, [x - 2.5, 8, x, 2, x + 2.5, 8, x + 1.2, 6.5, x, 10, x - 1.2, 6.5]);
        g.fill();
      }
      g.fillStyle = metal(g, -18, 18, "#ffd9c2", d);
      path(g, [-18, 17, 18, 17, 18, 21, -18, 21]);
      g.fill();
      outline(g, 0.7);
      // 가운데 조종석 포드
      g.fillStyle = metal(g, -5, 5, "#fff1e8", mix(d, "#000000", 0.2));
      path(g, [0, -20, 4.5, -12, 5, 6, 3, 10, -3, 10, -5, 6, -4.5, -12]);
      g.fill();
      outline(g);
      g.fillStyle = c;
      path(g, [-30, -2, -24, -2, -26, 4, -30, 4]);
      g.fill();
      path(g, [30, -2, 24, -2, 26, 4, 30, 4]);
      g.fill();
      glass(g, 0, -9, 2.8, 5, "#ffe0a8");
      navLights(g, -29.5, 1, 29.5, 1);
      break;
    }
  }
}

export function planeSprite(id: PilotId): Sprite {
  return bake(`plane:${id}`, 72, 80, (g) => {
    g.translate(0, 2);
    drawPlaneBody(g, id);
  });
}

/** 구름에 비친 그림자 (어두운 실루엣) */
export function planeShadow(id: PilotId): Sprite {
  return bake(`plane-shadow:${id}`, 72, 80, (g) => {
    g.translate(0, 2);
    drawPlaneBody(g, id);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "rgba(10,24,48,1)";
    g.fillRect(-40, -45, 80, 90);
  });
}

/** 맞았을 때 하얗게 번쩍이는 실루엣 */
function whiteOf(key: string, w: number, h: number, draw: (g: Ctx) => void): Sprite {
  return bake(`white:${key}`, w, h, (g) => {
    draw(g);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#ffffff";
    g.fillRect(-w, -h, w * 2, h * 2);
  });
}

/** 엔진 불꽃 (매 프레임) */
export function drawEngines(g: Ctx, id: PilotId, x: number, y: number, t: number, boost = 1, alpha = 1) {
  const c = PILOTS[id].color;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = alpha;
  for (const [ex, ey] of ENGINE_PORTS[id]) {
    const fl = (7 + Math.sin(t * 0.05 + ex) * 2 + Math.random() * 3) * boost;
    const px = x + ex;
    const py = y + ey + 2;
    const gr = g.createRadialGradient(px, py, 0, px, py + fl * 0.4, fl);
    gr.addColorStop(0, "rgba(255,255,255,.95)");
    gr.addColorStop(0.25, rgba(c, 0.8));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(px, py + fl * 0.45, 3.2, fl * 0.75, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/* ── 적 "잿빛 폭풍단" (아래를 본다) ─────────────────────────────────── */

const STEEL_L = "#9aa3b3";
const STEEL = "#5a6273";
const STEEL_D = "#262b36";
const CRIMSON = "#ff3b5c";
const EMBER = "#ff9a3c";

function core(g: Ctx, x: number, y: number, r: number, c = CRIMSON) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
  gr.addColorStop(0, "#ffffff");
  gr.addColorStop(0.25, c);
  gr.addColorStop(0.6, rgba(c, 0.35));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r * 2.2, 0, Math.PI * 2);
  g.fill();
}

function drawWasp(g: Ctx) {
  // 날개 (반투명)
  g.fillStyle = "rgba(200,220,240,.28)";
  g.strokeStyle = "rgba(220,235,255,.55)";
  g.lineWidth = 0.5;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 10, -5, 9, 4, s * 0.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(s * 8, 2, 6.5, 3, s * -0.2, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // 배 (뒤 = 위)
  const ab = g.createLinearGradient(-6, 0, 6, 0);
  ab.addColorStop(0, STEEL_D);
  ab.addColorStop(0.35, STEEL_L);
  ab.addColorStop(1, STEEL_D);
  g.fillStyle = ab;
  g.beginPath();
  g.ellipse(0, -10, 5.5, 8, 0, 0, Math.PI * 2);
  g.fill();
  outline(g, 0.7);
  g.fillStyle = EMBER;
  for (const y of [-14, -10, -6]) g.fillRect(-5, y, 10, 1.4);
  // 가슴·머리
  g.fillStyle = metal(g, -6, 6, STEEL_L, STEEL_D);
  g.beginPath();
  g.ellipse(0, 1, 5, 5, 0, 0, Math.PI * 2);
  g.fill();
  outline(g, 0.7);
  g.fillStyle = metal(g, -5, 5, "#c4ccd8", STEEL_D);
  path(g, [-4, 5, 4, 5, 2.5, 11, -2.5, 11]);
  g.fill();
  outline(g, 0.6);
  // 침 포신
  g.fillStyle = "#1a1d24";
  g.fillRect(-0.8, 10, 1.6, 5);
  core(g, -2, 7.5, 1.1);
  core(g, 2, 7.5, 1.1);
}

function drawSwallow(g: Ctx) {
  g.fillStyle = metal(g, -18, 18, STEEL_L, STEEL_D);
  path(g, [0, 14, 4, 2, 19, -10, 17, -12, 5, -6, 3, -14, 0, -12, -3, -14, -5, -6, -17, -12, -19, -10, -4, 2]);
  g.fill();
  outline(g);
  g.fillStyle = CRIMSON;
  path(g, [12, -7, 18, -11, 19, -10, 13, -5]);
  g.fill();
  path(g, [-12, -7, -18, -11, -19, -10, -13, -5]);
  g.fill();
  panel(g, [-4, 2, -14, -7]);
  panel(g, [4, 2, 14, -7]);
  g.fillStyle = "#151820";
  path(g, [-2.5, 4, 2.5, 4, 0, 10]);
  g.fill();
  core(g, 0, 6, 1.3);
}

function drawLancer(g: Ctx) {
  g.fillStyle = metal(g, -12, 12, STEEL_L, STEEL_D);
  path(g, [-12, -8, -4, -4, -4, -14, 4, -14, 4, -4, 12, -8, 6, 4, 2, 6, 0, 22, -2, 6, -6, 4]);
  g.fill();
  outline(g);
  g.fillStyle = "#cfd6e2";
  path(g, [-1.4, 6, 1.4, 6, 0, 21]);
  g.fill();
  g.fillStyle = EMBER;
  g.fillRect(-3, -14, 6, 2);
  panel(g, [-4, -4, 4, -4]);
  core(g, 0, 0, 1.6);
}

function drawBalloon(g: Ctx) {
  // 장갑 기구 (줄무늬 외피)
  const env = g.createRadialGradient(-6, -8, 2, 0, 0, 22);
  env.addColorStop(0, "#c46a74");
  env.addColorStop(0.5, "#7a2f3c");
  env.addColorStop(1, "#2c1218");
  g.fillStyle = env;
  g.beginPath();
  g.ellipse(0, -2, 19, 22, 0, 0, Math.PI * 2);
  g.fill();
  outline(g);
  g.save();
  g.beginPath();
  g.ellipse(0, -2, 19, 22, 0, 0, Math.PI * 2);
  g.clip();
  for (let i = -3; i <= 3; i++) {
    g.strokeStyle = i % 2 ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.25)";
    g.lineWidth = 3.4;
    g.beginPath();
    g.ellipse(0, -2, Math.abs(i) * 5.5 + 0.1, 22, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  // 장갑 띠
  g.fillStyle = metal(g, -20, 20, STEEL_L, STEEL_D);
  g.fillRect(-19, 4, 38, 4);
  outline(g, 0.5);
  // 곤돌라 포대
  g.fillStyle = metal(g, -8, 8, "#aab3c2", STEEL_D);
  g.beginPath();
  g.ellipse(0, 14, 8, 6, 0, 0, Math.PI * 2);
  g.fill();
  outline(g, 0.7);
  core(g, 0, 14, 2.2);
}

function drawGunshipHull(g: Ctx) {
  // 거북 등 장갑
  g.fillStyle = metal(g, -26, 26, STEEL_L, STEEL_D);
  path(g, [-14, -22, 14, -22, 24, -8, 24, 10, 12, 22, -12, 22, -24, 10, -24, -8]);
  g.fill();
  outline(g, 1);
  // 육각 장갑판
  g.strokeStyle = "rgba(10,14,22,.45)";
  g.lineWidth = 0.6;
  for (const [cx, cy] of [
    [0, -8],
    [-11, 2],
    [11, 2],
    [0, 12],
  ]) {
    path(g, [cx - 5, cy, cx - 2.5, cy - 4.5, cx + 2.5, cy - 4.5, cx + 5, cy, cx + 2.5, cy + 4.5, cx - 2.5, cy + 4.5]);
    g.stroke();
  }
  // 배기구
  for (const x of [-9, 9]) {
    g.fillStyle = "#14171e";
    g.fillRect(x - 3, -23, 6, 3);
    g.fillStyle = rgba(EMBER, 0.9);
    g.fillRect(x - 2, -22.4, 4, 1.4);
  }
  core(g, 0, 18, 2);
}

function drawCarrierHull(g: Ctx) {
  // 긴 비행선 선체
  const hull = g.createLinearGradient(-22, 0, 22, 0);
  hull.addColorStop(0, STEEL_D);
  hull.addColorStop(0.3, "#a2abba");
  hull.addColorStop(0.6, STEEL);
  hull.addColorStop(1, STEEL_D);
  g.fillStyle = hull;
  g.beginPath();
  g.ellipse(0, 0, 20, 40, 0, 0, Math.PI * 2);
  g.fill();
  outline(g, 1);
  for (let y = -30; y <= 30; y += 10) panel(g, [-19 + Math.abs(y) * 0.12, y, 19 - Math.abs(y) * 0.12, y]);
  // 꼬리 지느러미 (위쪽)
  g.fillStyle = metal(g, -20, 20, STEEL_L, STEEL_D);
  path(g, [-6, -34, -22, -44, -20, -36, -8, -26]);
  g.fill();
  outline(g, 0.7);
  path(g, [6, -34, 22, -44, 20, -36, 8, -26]);
  g.fill();
  outline(g, 0.7);
  // 격납고 문
  g.fillStyle = "#1a1d25";
  g.fillRect(-7, -6, 14, 20);
  g.strokeStyle = rgba(EMBER, 0.85);
  g.lineWidth = 0.8;
  g.strokeRect(-7, -6, 14, 20);
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(0, 14);
  g.stroke();
  // 운항등
  for (const [x, y] of [
    [-16, -14],
    [16, -14],
    [-16, 14],
    [16, 14],
  ])
    core(g, x, y, 1.1);
  core(g, 0, 33, 2.4);
}

export function enemySprite(kind: EnemyKind): Sprite {
  const size: Partial<Record<EnemyKind, [number, number]>> = { wasp: [44, 40], swallow: [44, 34], lancer: [30, 42], balloon: [46, 52], gunship: [56, 52], carrier: [52, 96] };
  const [w, h] = size[kind] ?? [40, 40];
  const draw = (g: Ctx) => {
    if (kind === "wasp") drawWasp(g);
    else if (kind === "swallow") drawSwallow(g);
    else if (kind === "lancer") drawLancer(g);
    else if (kind === "balloon") drawBalloon(g);
    else if (kind === "gunship") drawGunshipHull(g);
    else if (kind === "carrier") drawCarrierHull(g);
  };
  return bake(`enemy:${kind}`, w, h, draw);
}

export function enemyWhite(kind: EnemyKind): Sprite {
  const size: Partial<Record<EnemyKind, [number, number]>> = { wasp: [44, 40], swallow: [44, 34], lancer: [30, 42], balloon: [46, 52], gunship: [56, 52], carrier: [52, 96] };
  const [w, h] = size[kind] ?? [40, 40];
  return whiteOf(kind, w, h, (g) => {
    if (kind === "wasp") drawWasp(g);
    else if (kind === "swallow") drawSwallow(g);
    else if (kind === "lancer") drawLancer(g);
    else if (kind === "balloon") drawBalloon(g);
    else if (kind === "gunship") drawGunshipHull(g);
    else if (kind === "carrier") drawCarrierHull(g);
  });
}

/** 포탑 (조준 방향으로 회전) */
function turret(g: Ctx, x: number, y: number, ang: number, r = 5) {
  g.save();
  g.translate(x, y);
  g.fillStyle = metal(g, -r, r, "#b7bfcc", STEEL_D);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  outline(g, 0.7);
  g.rotate(ang - Math.PI / 2);
  g.fillStyle = "#1b1f28";
  g.fillRect(-1.3, 0, 2.6, r + 5);
  g.fillStyle = rgba(CRIMSON, 0.9);
  g.fillRect(-1.3, r + 3.6, 2.6, 1.4);
  g.restore();
  core(g, x, y, r * 0.28);
}

/**
 * 움직이는 적(포탑 회전·날갯짓)과 보스를 그린다. aim = 가장 가까운 기체 쪽 각도.
 * flash = 맞은 직후 0~1.
 */
export function drawEnemy(g: Ctx, kind: EnemyKind, x: number, y: number, t: number, aim: number, flash: number, hpFrac: number, charging = false) {
  const info = ENEMIES[kind];
  if (info.boss || info.mid) {
    drawBoss(g, kind, x, y, t, aim, flash, hpFrac);
    return;
  }
  if (kind === "wasp") {
    // 날갯짓: 좌우로 살짝 눌렀다 폈다
    const flap = 1 + Math.sin(t * 0.06 + x) * 0.06;
    g.save();
    g.translate(x, y);
    g.scale(flap, 1);
    drawSprite(g, enemySprite(kind), 0, 0);
    if (flash > 0) drawSprite(g, enemyWhite(kind), 0, 0, 1, 0, flash);
    g.restore();
    return;
  }
  drawSprite(g, enemySprite(kind), x, y);
  if (flash > 0) drawSprite(g, enemyWhite(kind), x, y, 1, 0, flash);
  if (kind === "gunship") {
    turret(g, x - 11, y + 2, aim, 4.6);
    turret(g, x + 11, y + 2, aim, 4.6);
  }
  if (kind === "lancer" && charging) {
    g.save();
    g.globalCompositeOperation = "lighter";
    const k = 0.5 + 0.5 * Math.sin(t * 0.04);
    const gr = g.createRadialGradient(x, y + 18, 0, x, y + 18, 16);
    gr.addColorStop(0, rgba(EMBER, 0.9 * k));
    gr.addColorStop(1, rgba(EMBER, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y + 18, 16, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/* ── 보스 ───────────────────────────────────────────────────────────── */

function drawBoss(g: Ctx, kind: EnemyKind, x: number, y: number, t: number, aim: number, flash: number, hpFrac: number) {
  g.save();
  g.translate(x, y);
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.006);
  const hurt = 1 - hpFrac;
  if (kind === "frigate") {
    // 폭풍 호위함: 쐐기형 선체 + 갑판 + 포탑 3기
    g.fillStyle = metal(g, -48, 48, STEEL_L, STEEL_D);
    path(g, [0, 52, 22, 30, 44, -10, 40, -34, 18, -48, -18, -48, -40, -34, -44, -10, -22, 30]);
    g.fill();
    outline(g, 1.2);
    g.fillStyle = "#3a404d";
    path(g, [0, 40, 14, 22, 26, -12, 22, -30, -22, -30, -26, -12, -14, 22]);
    g.fill();
    for (let i = -24; i <= 24; i += 8) panel(g, [i * 0.8, -28, i * 0.4, 30], false, 0.5, "rgba(255,255,255,.06)");
    // 함교
    g.fillStyle = metal(g, -12, 12, "#c9d0db", STEEL_D);
    g.fillRect(-11, -24, 22, 14);
    outline(g, 0.8);
    g.fillStyle = rgba(CRIMSON, 0.85);
    g.fillRect(-9, -14, 18, 2);
    for (const x0 of [-40, 40]) {
      g.fillStyle = "#14171e";
      g.fillRect(x0 - 4, -36, 8, 4);
      g.fillStyle = rgba(EMBER, 0.7 + pulse * 0.3);
      g.fillRect(x0 - 3, -35.4, 6, 2);
    }
    turret(g, 0, 26, aim, 7);
    turret(g, -24, 2, aim, 6);
    turret(g, 24, 2, aim, 6);
    core(g, 0, 6, 4 + pulse * 1.5);
  } else if (kind === "whale") {
    // 구름 고래: 둥근 기계 고래 (꼬리가 위, 입이 아래)
    const tail = Math.sin(t * 0.003) * 0.18;
    g.save();
    g.translate(0, -58);
    g.rotate(tail);
    g.fillStyle = metal(g, -40, 40, "#8fa3c2", "#2a3550");
    path(g, [0, 6, 18, -6, 40, -18, 36, -4, 12, 10, -12, 10, -36, -4, -40, -18, -18, -6]);
    g.fill();
    outline(g, 1);
    g.restore();
    const body = g.createRadialGradient(-20, -20, 10, 0, 0, 80);
    body.addColorStop(0, "#b9c9e4");
    body.addColorStop(0.45, "#5f7398");
    body.addColorStop(1, "#1c2438");
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 0, 56, 66, 0, 0, Math.PI * 2);
    g.fill();
    outline(g, 1.4);
    // 배 주름 장갑
    g.save();
    g.beginPath();
    g.ellipse(0, 0, 56, 66, 0, 0, Math.PI * 2);
    g.clip();
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = "rgba(10,16,30,.35)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(0, 70, 30 + i * 9, 40 + i * 9, 0, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,.08)";
    g.beginPath();
    g.ellipse(-22, -24, 20, 28, -0.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 지느러미
    for (const s of [-1, 1]) {
      g.save();
      g.translate(s * 52, 10);
      g.rotate(s * (0.5 + Math.sin(t * 0.004) * 0.12));
      g.fillStyle = metal(g, -10, 10, "#9fb1cf", "#26304a");
      path(g, [0, -12, s * 30, 12, s * 22, 18, 0, 10]);
      g.fill();
      outline(g, 0.9);
      g.restore();
    }
    // 숨구멍 (위쪽)
    g.fillStyle = "#11151f";
    g.beginPath();
    g.ellipse(0, -30, 8, 4, 0, 0, Math.PI * 2);
    g.fill();
    core(g, 0, -30, 2.5 + pulse * 2, "#8fd8ff");
    // 눈 (양옆 아래)
    core(g, -30, 30, 3.6 + hurt * 2);
    core(g, 30, 30, 3.6 + hurt * 2);
    // 따개비 포탑
    turret(g, -20, 46, aim, 6);
    turret(g, 20, 46, aim, 6);
    turret(g, 0, 56, aim, 7);
  } else if (kind === "manta") {
    // 번개 쥐가오리: 넓은 날개 + 전기 줄무늬
    const flap = Math.sin(t * 0.004) * 0.08;
    g.save();
    g.scale(1 + flap, 1);
    const wing = g.createLinearGradient(-90, 0, 90, 0);
    wing.addColorStop(0, "#1a2032");
    wing.addColorStop(0.3, "#56607a");
    wing.addColorStop(0.5, "#7e88a3");
    wing.addColorStop(0.7, "#56607a");
    wing.addColorStop(1, "#1a2032");
    g.fillStyle = wing;
    path(g, [0, -46, 40, -26, 92, 6, 60, 18, 26, 36, 0, 44, -26, 36, -60, 18, -92, 6, -40, -26]);
    g.fill();
    outline(g, 1.3);
    g.restore();
    // 전기 줄무늬 (빛남)
    g.save();
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = `rgba(140,220,255,${0.35 + pulse * 0.45})`;
    g.lineWidth = 1.6;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 12, -20);
      g.lineTo(s * 34, -10);
      g.lineTo(s * 46, 2);
      g.lineTo(s * 70, 8);
      g.stroke();
    }
    g.restore();
    // 머리 지느러미 (아래쪽 두 개)
    for (const s of [-1, 1]) {
      g.fillStyle = metal(g, -10, 10, "#8f99b3", "#232a3c");
      path(g, [s * 8, 36, s * 20, 40, s * 16, 56, s * 6, 46]);
      g.fill();
      outline(g, 0.8);
    }
    // 꼬리 (위로)
    g.strokeStyle = "#2a3146";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -44);
    g.quadraticCurveTo(Math.sin(t * 0.003) * 14, -70, Math.sin(t * 0.003 + 1) * 8, -92);
    g.stroke();
    core(g, 0, -92 + 0, 2, "#8fd8ff");
    // 등 장갑과 핵
    g.fillStyle = metal(g, -18, 18, "#aab4cc", "#2a3146");
    g.beginPath();
    g.ellipse(0, 4, 18, 30, 0, 0, Math.PI * 2);
    g.fill();
    outline(g, 0.9);
    core(g, 0, 4, 5 + pulse * 2, "#7fd2ff");
    core(g, -10, 34, 2.4 + hurt * 2);
    core(g, 10, 34, 2.4 + hurt * 2);
  } else if (kind === "citadel") {
    // 하늘 요새 핵: 회전하는 바깥 고리 + 포탑 4 + 수정 핵
    const rot = t * 0.0006;
    g.save();
    g.rotate(rot);
    g.strokeStyle = "#2a2f3c";
    g.lineWidth = 9;
    g.beginPath();
    g.arc(0, 0, 66, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#7d8597";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 66, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate((i / 12) * Math.PI * 2);
      g.fillStyle = i % 3 === 0 ? rgba(CRIMSON, 0.85) : "#3b414f";
      g.fillRect(-3, -70, 6, 8);
      g.restore();
    }
    g.restore();
    // 팔각 본체
    const oct: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      oct.push(Math.cos(a) * 48, Math.sin(a) * 48);
    }
    g.fillStyle = metal(g, -48, 48, "#b8c0cf", "#232836");
    path(g, oct);
    g.fill();
    outline(g, 1.2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      panel(g, [0, 0, Math.cos(a) * 48, Math.sin(a) * 48], false, 0.6);
    }
    for (const [dx, dy] of [
      [-70, -10],
      [70, -10],
      [-40, 40],
      [40, 40],
    ]) {
      g.fillStyle = "#2d323f";
      g.beginPath();
      g.arc(dx, dy, 10, 0, Math.PI * 2);
      g.fill();
      outline(g, 0.8);
      turret(g, dx, dy, aim, 7);
    }
    // 수정 핵
    g.save();
    g.rotate(-rot * 3);
    const cr = g.createLinearGradient(-16, -22, 16, 22);
    cr.addColorStop(0, "#ffd6e0");
    cr.addColorStop(0.5, CRIMSON);
    cr.addColorStop(1, "#5a0d22");
    g.fillStyle = cr;
    path(g, [0, -24, 14, 0, 0, 24, -14, 0]);
    g.fill();
    outline(g, 0.9);
    g.restore();
    core(g, 0, 0, 7 + pulse * 3 + hurt * 3);
  }
  // 맞았을 때 번쩍
  if (flash > 0) {
    g.globalCompositeOperation = "lighter";
    // 계속 맞는 동안 계속 켜져 있으니 아주 옅게 (보스 그림이 씻겨 보이지 않게)
    g.fillStyle = `rgba(255,255,255,${flash * 0.07})`;
    g.beginPath();
    g.arc(0, 0, ENEMIES[kind].r * 0.9, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/* ── 탄 ─────────────────────────────────────────────────────────────── */

const BULLET_COL = ["#ff4d6d", "#d65cff", "#ff9a3c", "#7fd8ff"];

/** 적탄: 빛나는 속 + 흰 테두리 링 (색각 이상이어도 링으로 구분) */
export function bulletSprite(k: number): Sprite {
  const r = [5, 7, 4.5, 10][k] ?? 5;
  const c = BULLET_COL[k] ?? BULLET_COL[0];
  return bake(`bullet:${k}`, r * 4, r * 4, (g) => {
    if (k === 2) {
      // 쌀알 (진행 방향 = 위쪽으로 그려 두고 회전)
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 2);
      gr.addColorStop(0, rgba(c, 0.55));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, 0, r * 1.3, r * 2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(0, 0, r * 0.75, r * 1.45, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1.4;
      g.stroke();
      g.fillStyle = "#fff6ea";
      g.beginPath();
      g.ellipse(0, -r * 0.2, r * 0.3, r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
      return;
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 2);
    gr.addColorStop(0, rgba(c, 0.6));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, r * 2, 0, Math.PI * 2);
    g.fill();
    const body = g.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.35, k === 3 ? "rgba(220,245,255,.5)" : c);
    body.addColorStop(1, k === 3 ? "rgba(127,216,255,.35)" : mix(c, "#000000", 0.25));
    g.fillStyle = body;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = k === 3 ? 1.6 : 1.5;
    g.stroke();
  });
}

/** 아군 탄 (테두리 없는 빛) */
export function shotSprite(id: PilotId, kind: "needle" | "slug" | "orb" | "line" | "sniper" | "pellet"): Sprite {
  const c = PILOTS[id].color;
  const dims: Record<typeof kind, [number, number]> = { needle: [8, 22], slug: [16, 22], orb: [16, 16], line: [8, 34], sniper: [18, 40], pellet: [12, 14] };
  const [w, h] = dims[kind];
  return bake(`shot:${id}:${kind}`, w, h, (g) => {
    g.globalCompositeOperation = "lighter";
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2);
    glow.addColorStop(0, rgba(c, 0.55));
    glow.addColorStop(1, rgba(c, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    if (kind === "needle" || kind === "line") {
      g.beginPath();
      g.ellipse(0, 0, 1.2, h * 0.38, 0, 0, Math.PI * 2);
      g.fill();
    } else if (kind === "sniper") {
      g.fillStyle = mix(c, "#ffffff", 0.6);
      g.beginPath();
      g.ellipse(0, 0, 3.6, h * 0.42, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(0, -2, 1.4, h * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    } else if (kind === "slug") {
      g.fillStyle = mix(c, "#ffffff", 0.55);
      g.beginPath();
      g.ellipse(0, 0, 3.6, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(0, -1.5, 1.6, 4, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.arc(0, 0, kind === "orb" ? 3 : 2.2, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export const SHOT_KIND: Record<PilotId, "needle" | "slug" | "orb" | "line" | "sniper" | "pellet"> = {
  wind: "needle",
  iron: "slug",
  firefly: "orb",
  bolt: "line",
  shadow: "sniper",
  flame: "pellet",
};

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export function itemSprite(kind: string): Sprite {
  return bake(`item:${kind}`, 30, 30, (g) => {
    if (kind === "star") {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 12);
      gr.addColorStop(0, "rgba(255,230,140,.7)");
      gr.addColorStop(1, "rgba(255,230,140,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, 12, 0, Math.PI * 2);
      g.fill();
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 3 : 7;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.fillStyle = "#ffe27a";
      path(g, pts);
      g.fill();
      g.strokeStyle = "#a86a10";
      g.lineWidth = 0.8;
      g.stroke();
      return;
    }
    const col = kind === "power" ? "#ffcf3a" : "#ff6b8a";
    // 캡슐
    const gr = g.createRadialGradient(-3, -4, 1, 0, 0, 12);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.4, col);
    gr.addColorStop(1, mix(col, "#000000", 0.45));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, 10, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.9)";
    g.lineWidth = 1.2;
    g.setLineDash([2.4, 1.6]);
    g.beginPath();
    g.arc(0, 0, 12.5, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "#1a1206";
    g.font = "bold 12px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(kind === "power" ? "P" : "+", 0, 0.5);
  });
}

/* ── 배경 ───────────────────────────────────────────────────────────── */

/** 구름 덩어리 (빛 받는 위쪽, 그늘진 아래쪽) */
export function cloudSprite(variant: number, tint: "day" | "storm" | "dusk"): Sprite {
  return bake(`cloud:${variant}:${tint}`, 200, 120, (g) => {
    let seed = variant * 9301 + 49297;
    const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const puffs = Array.from({ length: 9 }, () => ({ x: (r() - 0.5) * 120, y: (r() - 0.5) * 40, s: 18 + r() * 26 }));
    const pal = tint === "day" ? ["#ffffff", "#e4eefb", "#9fb6d8"] : tint === "storm" ? ["#9aa4b8", "#6b7590", "#2c3348"] : ["#ffe3ef", "#c9a6d8", "#5c4a86"];
    // 그늘
    for (const p of puffs) {
      g.fillStyle = rgba(pal[2], 0.55);
      g.beginPath();
      g.arc(p.x + 4, p.y + 7, p.s, 0, Math.PI * 2);
      g.fill();
    }
    for (const p of puffs) {
      const gr = g.createRadialGradient(p.x - p.s * 0.35, p.y - p.s * 0.4, p.s * 0.1, p.x, p.y, p.s);
      gr.addColorStop(0, pal[0]);
      gr.addColorStop(0.6, pal[1]);
      gr.addColorStop(1, rgba(pal[1], 0.85));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      g.fill();
    }
  });
}
