import * as THREE from "three";

/**
 * 고택 표면 텍스처 — 전부 캔버스로 그린다 (이미지 파일 없음). 씨앗 고정 난수라 매번 같은 무늬가 나온다.
 */

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

function finish(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 벽: 누렇게 바랜 흙벽 + 가운데 창호지 문살, 위아래 나무 인방 (2m × 2.8m 한 칸) */
export function wallTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 360);
  const r = rng(21);
  g.fillStyle = "#b9a888";
  g.fillRect(0, 0, 256, 360);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${60 + r() * 40},${40 + r() * 30},20,${r() * 0.08})`;
    g.fillRect(r() * 256, r() * 360, 2, 2);
  }
  // 나무 기둥·인방
  g.fillStyle = "#4a3324";
  g.fillRect(0, 0, 14, 360);
  g.fillRect(242, 0, 14, 360);
  g.fillRect(0, 36, 256, 12);
  g.fillRect(0, 318, 256, 42);
  // 창호지 문살 (가운데)
  g.fillStyle = "#e9e0c8";
  g.fillRect(48, 80, 160, 200);
  g.strokeStyle = "#5a4030";
  g.lineWidth = 3;
  g.strokeRect(48, 80, 160, 200);
  g.lineWidth = 2;
  for (let x = 48 + 20; x < 208; x += 20) {
    g.beginPath();
    g.moveTo(x, 80);
    g.lineTo(x, 280);
    g.stroke();
  }
  for (let y = 80 + 25; y < 280; y += 25) {
    g.beginPath();
    g.moveTo(48, y);
    g.lineTo(208, y);
    g.stroke();
  }
  // 얼룩 (찢어진 창호지)
  for (let k = 0; k < 4; k++) {
    g.fillStyle = `rgba(30,20,10,${0.2 + r() * 0.3})`;
    g.beginPath();
    g.ellipse(60 + r() * 140, 90 + r() * 180, 4 + r() * 10, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c, true);
}

/** 방바닥: 누런 장판 / 대청: 나무 마루 (2m × 2m 한 칸) */
export function floorTexture(kind: "maru" | "ondol"): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(kind === "maru" ? 5 : 7);
  if (kind === "ondol") {
    g.fillStyle = "#b08a4e";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(80,50,20,${r() * 0.07})`;
      g.fillRect(r() * 256, r() * 256, 3, 1);
    }
    g.strokeStyle = "rgba(90,60,30,0.45)";
    g.lineWidth = 2;
    g.strokeRect(1, 1, 126, 254);
    g.strokeRect(129, 1, 126, 254);
    return finish(c, true);
  }
  for (let i = 0; i < 8; i++) {
    const base = 80 + r() * 26;
    g.fillStyle = `rgb(${base + 22},${base},${base - 26})`;
    g.fillRect(0, i * 32, 256, 32);
    for (let k = 0; k < 10; k++) {
      g.strokeStyle = `rgba(40,25,10,${0.08 + r() * 0.1})`;
      g.lineWidth = 0.8;
      g.beginPath();
      const y = i * 32 + r() * 32;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + (r() - 0.5) * 6, 170, y + (r() - 0.5) * 6, 256, y);
      g.stroke();
    }
    g.fillStyle = "rgba(20,12,6,0.6)";
    g.fillRect(0, i * 32 + 31, 256, 1);
  }
  return finish(c, true);
}

/** 마당: 다져진 흙과 잔돌 */
export function groundTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(13);
  g.fillStyle = "#5d5141";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3800; i++) {
    const v = 60 + r() * 60;
    g.fillStyle = `rgba(${v + 20},${v + 10},${v - 10},${0.15 + r() * 0.25})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * 256, r() * 256, s, s);
  }
  return finish(c, true);
}

/** 천장: 서까래 */
export function ceilingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#2c2119";
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 32) {
    const gr = g.createLinearGradient(x, 0, x + 18, 0);
    gr.addColorStop(0, "#3b2a1e");
    gr.addColorStop(0.5, "#5a4231");
    gr.addColorStop(1, "#3b2a1e");
    g.fillStyle = gr;
    g.fillRect(x, 0, 18, 128);
  }
  return finish(c, true);
}

/** 장롱 옆면: 붉은 옻칠 + 놋쇠 장식 */
export function wardrobeTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const r = rng(seed);
  const reds = ["#5a1d16", "#3e2a1a", "#4a1a22"];
  g.fillStyle = reds[seed % reds.length];
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = "rgba(0,0,0,0.5)";
  g.lineWidth = 3;
  g.strokeRect(8, 10, 112, 110);
  g.strokeRect(8, 130, 112, 116);
  g.fillStyle = "#b8924a";
  for (const y of [60, 190]) {
    g.beginPath();
    g.arc(64, y, 9, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.03})`;
    g.fillRect(r() * 128, r() * 256, 1, 4);
  }
  return finish(c);
}

export function labelTexture(text: string, opts: { bg: string; fg: string; w?: number; h?: number; font?: number; sub?: string }): THREE.CanvasTexture {
  const w = opts.w ?? 256;
  const h = opts.h ?? 64;
  const [c, g] = canvas(w, h);
  g.fillStyle = opts.bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = opts.fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold ${opts.font ?? 34}px serif`;
  g.fillText(text, w / 2, opts.sub ? h * 0.4 : h / 2 + 2);
  if (opts.sub) {
    g.globalAlpha = 0.7;
    g.font = `600 ${Math.round((opts.font ?? 34) * 0.42)}px sans-serif`;
    g.fillText(opts.sub, w / 2, h * 0.78);
    g.globalAlpha = 1;
  }
  return finish(c);
}

/** 이름표 (투명 바탕) */
export function nameTexture(text: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 64);
  g.font = "bold 30px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.strokeText(text, 128, 34);
  g.fillStyle = color;
  g.fillText(text, 128, 34);
  return finish(c);
}
