import * as THREE from "three";

/**
 * 병동 표면 텍스처 — 전부 캔버스로 그린다 (이미지 파일 없음). 씨앗 고정 난수라 매번 같은 얼룩이 나온다.
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

function grime(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 8 + r() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(30,24,16,${alpha * (0.4 + r() * 0.6)})`);
    gr.addColorStop(1, "rgba(30,24,16,0)");
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/** 벽: 위는 누렇게 뜬 회벽, 아래 1.1m는 병원 녹색 페인트, 물 얼룩이 흘러내린다 (2m × 3m 한 칸) */
export function wallTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 384);
  const r = rng(11);
  g.fillStyle = "#b9b4a2";
  g.fillRect(0, 0, 256, 384);
  const split = 384 * (1 - 1.1 / 3);
  g.fillStyle = "#566e62";
  g.fillRect(0, split, 256, 384 - split);
  g.fillStyle = "#3d4f46";
  g.fillRect(0, split - 3, 256, 6);
  g.fillStyle = "#2c2a26";
  g.fillRect(0, 372, 256, 12);
  grime(g, 256, 384, r, 46, 0.22);
  // 흘러내린 물 얼룩
  for (let i = 0; i < 9; i++) {
    const x = r() * 256;
    const len = 60 + r() * 220;
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, "rgba(40,32,20,0.34)");
    gr.addColorStop(1, "rgba(40,32,20,0)");
    g.fillStyle = gr;
    g.fillRect(x, 0, 3 + r() * 9, len);
  }
  // 벗겨진 페인트
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(150,146,130,${0.25 + r() * 0.4})`;
    g.beginPath();
    g.ellipse(r() * 256, split + r() * (384 - split), 3 + r() * 14, 2 + r() * 7, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // 미세한 거칠기
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
    g.fillRect(r() * 256, r() * 384, 1.5, 1.5);
  }
  return finish(c);
}

/** 바닥: 낡은 리놀륨 타일 (한 장 = 2m, 4×4 타일) */
export function floorTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(23);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const v = 96 + Math.floor(r() * 22) + ((x + y) % 2) * 14;
      g.fillStyle = `rgb(${v},${v + 4},${v - 6})`;
      g.fillRect(x * 64, y * 64, 64, 64);
    }
  g.strokeStyle = "rgba(20,20,18,0.55)";
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, 256);
    g.moveTo(0, i * 64);
    g.lineTo(256, i * 64);
    g.stroke();
  }
  grime(g, 256, 256, r, 26, 0.3);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.1})`;
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  return finish(c, true);
}

/** 천장: 물 먹은 텍스 타일 */
export function ceilingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(31);
  g.fillStyle = "#8e8b80";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(30,30,28,0.6)";
  g.lineWidth = 3;
  for (let i = 0; i <= 2; i++) {
    g.beginPath();
    g.moveTo(i * 128, 0);
    g.lineTo(i * 128, 256);
    g.moveTo(0, i * 128);
    g.lineTo(256, i * 128);
    g.stroke();
  }
  grime(g, 256, 256, r, 18, 0.4);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.18})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return finish(c, true);
}

/** 문짝: 칠 벗겨진 나무 + 작은 유리창 */
export function doorTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const r = rng(47);
  g.fillStyle = "#6f6a58";
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(40,34,24,${0.05 + r() * 0.12})`;
    g.fillRect(r() * 128, 0, 1 + r() * 3, 256);
  }
  g.fillStyle = "#11161a";
  g.fillRect(44, 34, 40, 56);
  g.strokeStyle = "#3a372e";
  g.lineWidth = 4;
  g.strokeRect(44, 34, 40, 56);
  g.fillStyle = "#8d8a7c";
  g.fillRect(100, 132, 14, 6);
  grime(g, 128, 256, r, 14, 0.35);
  return finish(c);
}

/** 봉인 부적: 누런 종이에 붉은 글씨 */
export function talismanTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(96, 256);
  g.fillStyle = "#d9b64a";
  g.fillRect(0, 0, 96, 256);
  g.strokeStyle = "#8f1d12";
  g.lineWidth = 5;
  g.strokeRect(8, 8, 80, 240);
  g.fillStyle = "#9c1c10";
  g.font = "bold 44px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  ["封", "鬼", "聽", "止"].forEach((ch, i) => g.fillText(ch, 48, 42 + i * 56));
  const r = rng(5);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(60,40,10,${r() * 0.15})`;
    g.fillRect(r() * 96, r() * 256, 2, 2);
  }
  return finish(c);
}

/** 글자 팻말 (방 이름·비상구). `glow`면 스스로 빛나는 표지판용 */
export function labelTexture(text: string, opts: { bg: string; fg: string; w?: number; h?: number; font?: number }): THREE.CanvasTexture {
  const w = opts.w ?? 256;
  const h = opts.h ?? 64;
  const [c, g] = canvas(w, h);
  g.fillStyle = opts.bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = opts.fg;
  g.font = `bold ${opts.font ?? 34}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2);
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

/** 바닥·벽의 검붉은 얼룩 (투명 바탕) */
export function stainTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = rng(seed);
  for (let i = 0; i < 16; i++) {
    const x = 64 + (r() - 0.5) * 70;
    const y = 64 + (r() - 0.5) * 70;
    const rad = 6 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(58,8,6,${0.5 + r() * 0.4})`);
    gr.addColorStop(1, "rgba(58,8,6,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  // 끌린 자국
  g.strokeStyle = "rgba(50,6,4,0.5)";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(64, 64);
  g.quadraticCurveTo(90 + r() * 20, 80, 120, 100 + r() * 20);
  g.stroke();
  return finish(c);
}

/** 청귀의 얼굴: 꿰매어 감긴 눈, 귀까지 찢어진 입 */
export function ghostFaceTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(77);
  g.fillStyle = "#b8b1a4";
  g.fillRect(0, 0, 256, 256);
  grime(g, 256, 256, r, 30, 0.35);
  // 정면은 텍스처 가운데 (u=0.5)
  const cx = 128;
  // 눈두덩: 푹 꺼진 그늘 + 꿰맨 자국
  for (const dx of [-26, 26]) {
    const gr = g.createRadialGradient(cx + dx, 104, 2, cx + dx, 104, 22);
    gr.addColorStop(0, "rgba(20,10,12,0.95)");
    gr.addColorStop(1, "rgba(20,10,12,0)");
    g.fillStyle = gr;
    g.fillRect(cx + dx - 24, 80, 48, 48);
    g.strokeStyle = "#1a0d0d";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx + dx - 15, 104);
    g.lineTo(cx + dx + 15, 104);
    g.stroke();
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(cx + dx + i * 6 - 2, 97);
      g.lineTo(cx + dx + i * 6 + 2, 111);
      g.stroke();
    }
  }
  // 입: 귀까지 찢어진 검은 틈 + 이
  g.fillStyle = "#0b0405";
  g.beginPath();
  g.moveTo(cx - 44, 150);
  g.quadraticCurveTo(cx, 196, cx + 44, 150);
  g.quadraticCurveTo(cx, 168, cx - 44, 150);
  g.fill();
  g.fillStyle = "#cfc8b4";
  for (let i = -5; i <= 5; i++) g.fillRect(cx + i * 7 - 2, 158 + Math.abs(i) * -0.6, 4, 7);
  g.strokeStyle = "rgba(60,10,10,0.7)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - 44, 150);
  g.lineTo(cx - 62, 138);
  g.moveTo(cx + 44, 150);
  g.lineTo(cx + 62, 138);
  g.stroke();
  // 핏줄
  g.strokeStyle = "rgba(70,30,40,0.35)";
  g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    let x = r() * 256;
    let y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (r() - 0.5) * 26;
      y += (r() - 0.5) * 26;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return finish(c);
}
