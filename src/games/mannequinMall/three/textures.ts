import * as THREE from "three";

/**
 * 백화점 표면 텍스처 — 전부 캔버스로 그린다 (이미지 파일 없음). 씨앗 고정 난수라 매번 같은 무늬가 나온다.
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

/** 벽: 크림색 벽지, 아래에 짙은 걸레받이, 위쪽에 가는 금색 몰딩 (2m × 3.4m 한 칸) */
export function wallTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 432);
  const r = rng(21);
  g.fillStyle = "#cfc6b4";
  g.fillRect(0, 0, 256, 432);
  // 은은한 세로 줄무늬 벽지
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = x % 32 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)";
    g.fillRect(x, 0, 8, 432);
  }
  g.fillStyle = "#8e7a52";
  g.fillRect(0, 40, 256, 4);
  g.fillStyle = "#2b2622";
  g.fillRect(0, 404, 256, 28);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
    g.fillRect(r() * 256, r() * 432, 1.5, 1.5);
  }
  return finish(c, true);
}

/** 바닥: 광택 나는 큰 대리석 타일 (2m × 2m 한 칸 = 타일 4장) */
export function floorTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(5);
  for (let ty = 0; ty < 2; ty++)
    for (let tx = 0; tx < 2; tx++) {
      const base = (tx + ty) % 2 === 0 ? 214 : 196;
      g.fillStyle = `rgb(${base},${base - 4},${base - 10})`;
      g.fillRect(tx * 128, ty * 128, 128, 128);
      // 대리석 결
      for (let k = 0; k < 5; k++) {
        g.strokeStyle = `rgba(120,110,100,${0.08 + r() * 0.12})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        let x = tx * 128 + r() * 128;
        let y = ty * 128;
        g.moveTo(x, y);
        for (let s = 0; s < 6; s++) {
          x += (r() - 0.5) * 40;
          y += 128 / 6;
          g.lineTo(Math.max(tx * 128, Math.min(tx * 128 + 128, x)), y);
        }
        g.stroke();
      }
    }
  g.strokeStyle = "rgba(60,54,48,0.6)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  g.strokeRect(129, 1, 126, 126);
  g.strokeRect(1, 129, 126, 126);
  g.strokeRect(129, 129, 126, 126);
  return finish(c, true);
}

/** 천장: 흰 석고 텍스 판 격자 */
export function ceilingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = rng(9);
  g.fillStyle = "#9c9890";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
    g.fillRect(r() * 128, r() * 128, 1, 1);
  }
  g.strokeStyle = "#6a665e";
  g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  g.strokeRect(64, 0, 64, 64);
  g.strokeRect(0, 64, 64, 64);
  g.strokeRect(64, 64, 64, 64);
  return finish(c, true);
}

/** 키 큰 진열장 옆면: 개어 놓은 옷·신발 상자가 칸칸이 */
export function shelfTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = "#3b3631";
  g.fillRect(0, 0, 256, 256);
  const palettes = [
    ["#7a2e3a", "#2f4d6b", "#c9b48a", "#4a6b4f", "#d8d2c4", "#583f6e"],
    ["#1f2a36", "#5b6470", "#8b6f4e", "#2e2e2e", "#b0a28a", "#6b2f2a"],
    ["#e07a5f", "#81b29a", "#f2cc8f", "#3d405b", "#f4f1de", "#e9c46a"],
  ];
  const pal = palettes[seed % palettes.length];
  for (let row = 0; row < 4; row++) {
    const y0 = row * 64;
    g.fillStyle = "#6e655a";
    g.fillRect(0, y0 + 58, 256, 6);
    let x = 4;
    while (x < 250) {
      const w = 18 + r() * 30;
      const h = 22 + r() * 30;
      g.fillStyle = pal[Math.floor(r() * pal.length)];
      g.fillRect(x, y0 + 58 - h, Math.min(w, 252 - x), h);
      g.fillStyle = "rgba(255,255,255,0.08)";
      for (let k = 6; k < h; k += 7) g.fillRect(x, y0 + 58 - h + k, Math.min(w, 252 - x), 1);
      x += w + 2 + r() * 4;
    }
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
  g.font = `bold ${opts.font ?? 34}px sans-serif`;
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

/** 셔터: 가로 골이 진 금속판 */
export function shutterTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  for (let y = 0; y < 256; y += 8) {
    const gr = g.createLinearGradient(0, y, 0, y + 8);
    gr.addColorStop(0, "#8d949b");
    gr.addColorStop(0.5, "#5d646b");
    gr.addColorStop(1, "#3c4248");
    g.fillStyle = gr;
    g.fillRect(0, y, 128, 8);
  }
  return finish(c, true);
}
