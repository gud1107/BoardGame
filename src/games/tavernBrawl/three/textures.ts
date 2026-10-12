import * as THREE from "three";
import { TRIBES, unitDef } from "../units";

/**
 * 3D용 캔버스 텍스처 — 페이지당 한 번만 만들어 모든 토큰이 공유한다(파일 자산 없음).
 * 카드 그림은 이모지 + 이름 + 등급 별, 숫자는 굵은 외곽선 글씨.
 */

const EMOJI_FONT = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
const TIER_COLORS: [string, string][] = [
  ["#475569", "#1e293b"],
  ["#475569", "#1e293b"],
  ["#059669", "#064e3b"],
  ["#0284c7", "#0c4a6e"],
  ["#7c3aed", "#4c1d95"],
  ["#f59e0b", "#9a3412"],
  ["#e11d48", "#881337"],
];

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const cardCache = new Map<string, THREE.CanvasTexture>();
export function cardTexture(defId: string, golden: boolean): THREE.CanvasTexture {
  const key = `${defId}:${golden}`;
  const hit = cardCache.get(key);
  if (hit) return hit;
  const d = unitDef(defId);
  const W = 256;
  const H = 320;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const [top, bottom] = TIER_COLORS[d.tier];
  roundRect(g, 6, 6, W - 12, H - 12, 34);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = golden ? 14 : 8;
  g.strokeStyle = golden ? "#fde047" : d.tribe ? TRIBES[d.tribe].color : "#0f172a";
  g.stroke();
  if (golden) {
    const shine = g.createLinearGradient(0, 0, W, H);
    shine.addColorStop(0, "rgba(255,240,150,0.45)");
    shine.addColorStop(0.5, "rgba(255,255,255,0)");
    shine.addColorStop(1, "rgba(255,200,60,0.35)");
    g.fillStyle = shine;
    roundRect(g, 6, 6, W - 12, H - 12, 34);
    g.fill();
  }
  // 빛 번짐
  const glow = g.createRadialGradient(W / 2, 135, 10, W / 2, 135, 120);
  glow.addColorStop(0, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `150px ${EMOJI_FONT}`;
  g.fillText(d.emoji, W / 2, 140);
  g.font = "bold 30px sans-serif";
  g.fillStyle = "#fde047";
  g.fillText("★".repeat(d.tier), W / 2, 34);
  g.font = "bold 30px 'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  const name = d.name.length > 7 ? `${d.name.slice(0, 6)}…` : d.name;
  g.strokeText(name, W / 2, 272);
  g.fillStyle = "#fff";
  g.fillText(name, W / 2, 272);
  if (d.tribe) {
    g.font = `40px ${EMOJI_FONT}`;
    g.fillText(TRIBES[d.tribe].emoji, W - 40, 40);
  }
  const t = finish(c);
  cardCache.set(key, t);
  return t;
}

const statCache = new Map<string, THREE.CanvasTexture>();
/** 공격력(주황)·체력(빨강) 보석 숫자. buffed면 숫자가 연두색. */
export function statTexture(value: number, kind: "atk" | "hp", buffed: boolean): THREE.CanvasTexture {
  const key = `${value}:${kind}:${buffed}`;
  const hit = statCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(52, 48, 8, 64, 64, 60);
  if (kind === "atk") {
    grad.addColorStop(0, "#fde68a");
    grad.addColorStop(1, "#d97706");
  } else {
    grad.addColorStop(0, "#fda4af");
    grad.addColorStop(1, "#be123c");
  }
  g.beginPath();
  if (kind === "atk") {
    g.moveTo(64, 6);
    g.lineTo(122, 64);
    g.lineTo(64, 122);
    g.lineTo(6, 64);
    g.closePath();
  } else {
    g.arc(64, 64, 58, 0, Math.PI * 2);
  }
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = "#1c1917";
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${value >= 100 ? 50 : 64}px sans-serif`;
  g.lineWidth = 10;
  g.strokeStyle = "#1c1917";
  g.strokeText(String(value), 64, 68);
  g.fillStyle = buffed ? "#bef264" : "#ffffff";
  g.fillText(String(value), 64, 68);
  const t = finish(c);
  statCache.set(key, t);
  return t;
}

const textCache = new Map<string, THREE.CanvasTexture>();
/** 떠오르는 큰 숫자/글자 (피해·막음·버프) */
export function popupTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const key = `${text}:${color}`;
  let t = textCache.get(key);
  const W = 256;
  const H = 128;
  if (!t) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `900 ${text.length > 4 ? 64 : 92}px 'Pretendard','Malgun Gothic',sans-serif`;
    g.lineJoin = "round";
    g.lineWidth = 16;
    g.strokeStyle = "#0c0a09";
    g.strokeText(text, W / 2, H / 2 + 4);
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.fillStyle = color;
    g.fillText(text, W / 2, H / 2 + 4);
    t = finish(c);
    textCache.set(key, t);
  }
  return { tex: t, aspect: W / H };
}

let woodTex: THREE.CanvasTexture | null = null;
/** 여관 탁자 나뭇결 */
export function woodTexture(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#5b3418";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 2 ? "rgba(0,0,0,0.12)" : "rgba(255,200,140,0.05)";
    g.fillRect(0, i * 57, 512, 3);
  }
  for (let i = 0; i < 260; i++) {
    const y = (i * 37.3) % 512;
    g.strokeStyle = `rgba(${i % 3 ? "30,15,5" : "160,100,50"},${0.08 + (i % 5) * 0.02})`;
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin((x + i * 13) / 60) * 4);
    g.stroke();
  }
  woodTex = finish(c);
  woodTex.wrapS = THREE.RepeatWrapping;
  woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.repeat.set(3, 2);
  return woodTex;
}

const tagCache = new Map<string, THREE.CanvasTexture>();
/** 3D 말 머리 위 종족·직업 아이콘 꼬리표 */
export function tagTexture(icons: string, colors: [string, string]): THREE.CanvasTexture {
  const key = `${icons}|${colors.join()}`;
  const hit = tagCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 80;
  const g = c.getContext("2d")!;
  roundRect(g, 4, 6, 152, 68, 32);
  const grad = g.createLinearGradient(0, 0, 160, 0);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  g.fillStyle = "rgba(12,10,9,0.82)";
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = grad;
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `44px ${EMOJI_FONT}`;
  g.fillText(icons, 80, 42);
  const t = finish(c);
  tagCache.set(key, t);
  return t;
}

const plateCache = new Map<string, THREE.CanvasTexture>();
/** 아바타 머리 위 이름표: 이름 + 체력 */
export function plateTexture(name: string, hp: number | null, mine: boolean): THREE.CanvasTexture {
  const key = `${name}|${hp}|${mine}`;
  const hit = plateCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 96;
  const g = c.getContext("2d")!;
  roundRect(g, 4, 6, 312, 84, 30);
  g.fillStyle = "rgba(12,10,9,0.85)";
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = mine ? "#4ade80" : "#f87171";
  g.stroke();
  g.textBaseline = "middle";
  g.font = "bold 34px 'Pretendard','Malgun Gothic',sans-serif";
  g.fillStyle = "#ffffff";
  const label = name.length > 7 ? `${name.slice(0, 6)}…` : name;
  g.textAlign = "left";
  g.fillText(label, 22, 48);
  if (hp !== null) {
    g.textAlign = "right";
    g.font = `bold 36px ${EMOJI_FONT}`;
    g.fillStyle = hp <= 10 ? "#fca5a5" : "#fecdd3";
    g.fillText(`❤${Math.max(0, hp)}`, 300, 50);
  }
  const t = finish(c);
  plateCache.set(key, t);
  return t;
}
