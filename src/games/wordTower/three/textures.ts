import * as THREE from "three";

/**
 * 단어 마천루 3D용 캔버스 텍스처 — 파일 자산 없이 그때그때 그리고, 같은 내용이면 재사용한다.
 * 한글은 시스템 기본 고딕을 쓴다(웹폰트를 3D에 넣으면 로딩이 무거워져서).
 */

const FONT = `"Pretendard","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

/** 층 하나의 앞면 너비:높이 = 1.2 : (blocks × 0.28). 캔버스도 그 비율로 그려 글자가 찌그러지지 않게 한다. */
const PX_PER_UNIT = 220;
export const SLAB_W = 1.2;
export const BLOCK_H = 0.28;

const faceCache = new Map<string, THREE.CanvasTexture>();

/**
 * 층 앞면 — 단어가 보이면 단어, 아니면 마천루 창문 무늬.
 * `label`이 null이면 남의 단어(아직 비공개).
 */
export function slabFaceTexture(color: string, blocks: number, label: string | null): THREE.CanvasTexture {
  const key = `${color}|${blocks}|${label ?? ""}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const W = Math.round(SLAB_W * PX_PER_UNIT);
  const H = Math.max(40, Math.round(blocks * BLOCK_H * PX_PER_UNIT));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(color, 0.08));
  grad.addColorStop(1, shade(color, -0.1));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // 층마다 얇은 가로줄(블록 경계)
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 2;
  for (let i = 1; i < blocks; i++) {
    const y = Math.round((H * i) / blocks);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }

  if (label) {
    const size = Math.min(H * 0.62, (W * 0.9) / Math.max(1.6, label.length * 0.95));
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = Math.max(3, size * 0.14);
    g.strokeStyle = "rgba(15,23,42,0.75)";
    g.strokeText(label, W / 2, H / 2 + size * 0.04);
    g.fillStyle = "#ffffff";
    g.fillText(label, W / 2, H / 2 + size * 0.04);
  } else {
    // 창문: 층마다 한 줄
    const cols = 5;
    const gap = W / (cols * 2 + 1);
    for (let row = 0; row < blocks; row++) {
      const y0 = (H * row) / blocks;
      const rh = H / blocks;
      for (let col = 0; col < cols; col++) {
        const lit = (row * 7 + col * 3 + blocks) % 4 !== 0;
        g.fillStyle = lit ? "rgba(254,243,199,0.85)" : "rgba(15,23,42,0.45)";
        g.fillRect(gap + col * gap * 2, y0 + rh * 0.25, gap, rh * 0.5);
      }
    }
  }
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, H - 3);
  const t = finish(c);
  faceCache.set(key, t);
  return t;
}

const sideCache = new Map<string, THREE.CanvasTexture>();

/** 옆면 — 창문 무늬만. */
export function slabSideTexture(color: string, blocks: number): THREE.CanvasTexture {
  const key = `${color}|${blocks}`;
  const hit = sideCache.get(key);
  if (hit) return hit;
  const t = slabFaceTexture(color, blocks, null);
  sideCache.set(key, t);
  return t;
}

const labelCache = new Map<string, THREE.CanvasTexture>();

/** 탑 위 이름표: 이름 + 층수 (+ 연승). 스프라이트로 늘 카메라를 본다. */
export function nameTagTexture(name: string, height: number, color: string, isMe: boolean, streak: number): THREE.CanvasTexture {
  const key = `${name}|${height}|${color}|${isMe}|${streak}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const W = 512;
  const H = 160;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = 36;
  g.beginPath();
  g.moveTo(r, 8);
  g.arcTo(W - 8, 8, W - 8, H - 8, r);
  g.arcTo(W - 8, H - 8, 8, H - 8, r);
  g.arcTo(8, H - 8, 8, 8, r);
  g.arcTo(8, 8, W - 8, 8, r);
  g.closePath();
  g.fillStyle = isMe ? "rgba(250,204,21,0.92)" : "rgba(15,23,42,0.82)";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const short = name.length > 9 ? `${name.slice(0, 8)}…` : name;
  g.font = `800 50px ${FONT}`;
  g.fillStyle = isMe ? "#1e293b" : "#e2e8f0";
  g.fillText(short, W / 2, 52);
  g.font = `900 60px ${FONT}`;
  g.fillStyle = isMe ? "#0f172a" : "#ffffff";
  const flame = streak >= 2 ? ` 🔥${streak}` : "";
  g.fillText(`${height}층${flame}`, W / 2, 112);
  const t = finish(c);
  labelCache.set(key, t);
  return t;
}
