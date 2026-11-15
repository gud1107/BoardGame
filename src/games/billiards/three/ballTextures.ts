import * as THREE from "three";

/**
 * Procedural ball and cloth looks for 당구 파티 (rulebook §10). Numbered
 * pool balls: solid colour + white number disc (1–8), ⭐ gold 9 with a band
 * and a star; the white cue ball has a small red dot so its spin shows.
 * Carom balls: two reds (one with a white dot ring), a yellow spoiler.
 * Every number is printed on both sides of the ball, so the colour is never
 * the only way to tell balls apart (colour-blind friendly).
 */

export const BALL_COLORS: Record<number, string> = {
  0: "#f8f5ec",
  1: "#f5c518",
  2: "#1f4fd6",
  3: "#d62828",
  4: "#6b2fa8",
  5: "#f07a1a",
  6: "#16833f",
  7: "#7a1f1f",
  8: "#121212",
  9: "#e0a91c",
};

export const CAROM_COLORS: Record<number, string> = { 0: "#f8f5ec", 1: "#d62828", 2: "#d62828", 3: "#f2c94c" };

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** Equirectangular ball skin (u around, v pole to pole). */
export function ballTexture(id: number, carom: boolean): THREE.Texture {
  const key = `${carom ? "c" : "p"}${id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const base = carom ? CAROM_COLORS[id] : BALL_COLORS[id];
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const disc = (u: number, label: string, fill = "#fdfaf2", ink = "#141414", star = false) => {
    const x = u * W;
    const y = H / 2;
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, 46, 46, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ink;
    g.font = `900 ${star ? 50 : 56}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, x, y + 3);
  };
  if (!carom) {
    if (id === 0) {
      g.fillStyle = "#c81e1e";
      for (const u of [0.25, 0.75]) {
        g.beginPath();
        g.arc(u * W, H / 2, 10, 0, Math.PI * 2);
        g.fill();
      }
    } else if (id === 9) {
      // gold band ball with a star — the 3-point jackpot
      g.fillStyle = "#fdfaf2";
      g.fillRect(0, 0, W, H * 0.24);
      g.fillRect(0, H * 0.76, W, H * 0.24);
      g.fillStyle = "#f6d35b";
      g.fillRect(0, H * 0.3, W, H * 0.4);
      disc(0.25, "★9", "#fff7d6", "#8a5a00", true);
      disc(0.75, "★9", "#fff7d6", "#8a5a00", true);
    } else {
      disc(0.25, String(id));
      disc(0.75, String(id));
    }
  } else if (id === 2) {
    // second red: a white ring so the two reds are told apart in replays
    g.strokeStyle = "#fdfaf2";
    g.lineWidth = 14;
    for (const u of [0.25, 0.75]) {
      g.beginPath();
      g.arc(u * W, H / 2, 34, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (id === 3) {
    g.fillStyle = "#3b2a00";
    g.font = "900 54px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const u of [0.25, 0.75]) g.fillText("✕", u * W, H / 2 + 2);
  } else if (id === 0) {
    g.fillStyle = "#c81e1e";
    for (const u of [0.25, 0.75]) {
      g.beginPath();
      g.arc(u * W, H / 2, 10, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

let felt: THREE.Texture | null = null;
/** Billiard cloth: deep green with a faint nap and the head string / foot spot marks. */
export function feltTexture(): THREE.Texture {
  if (felt) return felt;
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const grad = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62);
  grad.addColorStop(0, "#1f8a4c");
  grad.addColorStop(1, "#0f5a31");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  let s = 11;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "0,0,0"},${0.02 + rnd() * 0.03})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1);
  }
  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.lineWidth = 2;
  // head string at x = −HALF_W/2  (texture spans the cloth, 0..W ↔ −12..12)
  g.beginPath();
  g.moveTo(W * 0.25, 0);
  g.lineTo(W * 0.25, H);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.35)";
  for (const u of [0.25, 0.5, 0.75]) {
    g.beginPath();
    g.arc(W * u, H / 2, 4, 0, Math.PI * 2);
    g.fill();
  }
  felt = new THREE.CanvasTexture(c);
  felt.colorSpace = THREE.SRGBColorSpace;
  felt.anisotropy = 4;
  return felt;
}

let wood: THREE.Texture | null = null;
export function woodTexture(): THREE.Texture {
  if (wood) return wood;
  const [c, g] = canvas(512, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#6b3a1c");
  grad.addColorStop(0.5, "#5a2f15");
  grad.addColorStop(1, "#4a240f");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  let s = 3;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 90; i++) {
    const y = rnd() * 128;
    g.strokeStyle = `rgba(20,8,2,${0.06 + rnd() * 0.12})`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 24) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 2);
    g.stroke();
  }
  wood = new THREE.CanvasTexture(c);
  wood.colorSpace = THREE.SRGBColorSpace;
  wood.wrapS = THREE.RepeatWrapping;
  wood.wrapT = THREE.RepeatWrapping;
  return wood;
}

/** Big friendly "×2" label for the lucky pocket. */
export function luckyLabel(): THREE.Texture {
  const key = "lucky";
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 128);
  g.fillStyle = "rgba(0,0,0,0)";
  g.fillRect(0, 0, 256, 128);
  g.font = "900 92px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 12;
  g.strokeStyle = "#3b2200";
  g.strokeText("×2", 128, 68);
  g.fillStyle = "#ffd34d";
  g.fillText("×2", 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
