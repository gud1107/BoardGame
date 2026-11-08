import * as THREE from "three";

/** Seat colours + shape marks (rulebook §1) — the mark tells balls apart without colour. */
export const SEAT_COLORS = ["#e8473c", "#2f7de1", "#f2b21b", "#3fae5a", "#a35be0", "#ef7fb4"];
export const SEAT_MARKS = ["●", "◆", "▲", "■", "★", "✚"];
export const SEAT_NAMES = ["빨강", "파랑", "노랑", "초록", "보라", "분홍"];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function done(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.needsUpdate = true;
  return t;
}

/** Putting-green carpet: mown stripes + speckle, tiles every metre. */
export function grassTexture(tint: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = tint;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
    g.fillRect(0, i * 64, 256, 64);
  }
  for (let i = 0; i < 2600; i++) {
    const x = (i * 9301 + 49297) % 256;
    const y = (i * 233 + i * i * 7) % 256;
    g.fillStyle = i % 3 ? "rgba(0,40,0,0.12)" : "rgba(255,255,220,0.1)";
    g.fillRect(x, y, 1, 2);
  }
  return done(c, true);
}

export function sandTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#e9d49a";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1800; i++) {
    const x = (i * 7919) % 128;
    const y = (i * 104729 + i * 13) % 128;
    g.fillStyle = i % 2 ? "rgba(140,100,40,0.18)" : "rgba(255,250,230,0.25)";
    g.fillRect(x, y, 1, 1);
  }
  // raked ripples
  g.strokeStyle = "rgba(150,110,50,0.18)";
  for (let y = 4; y < 128; y += 9) {
    g.beginPath();
    for (let x = 0; x <= 128; x += 4) g.lineTo(x, y + Math.sin(x / 9) * 2);
    g.stroke();
  }
  return done(c, true);
}

export function iceTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, "#d9f4ff");
  grad.addColorStop(1, "#9fd8f5");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    const x = (i * 37) % 128;
    g.moveTo(x, 0);
    g.lineTo(x + 30, 60 + (i % 3) * 10);
    g.lineTo(x + 10, 128);
    g.stroke();
  }
  return done(c, true);
}

/** Chevrons for slopes — the texture's +v is "downhill". */
export function chevronTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 6;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(14, 22);
  g.lineTo(32, 42);
  g.lineTo(50, 22);
  g.stroke();
  return done(c, true);
}

export function stripeTexture(a = "#ffffff", b = "#e8473c"): THREE.CanvasTexture {
  const [c, g] = canvas(64, 16);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect(i * 8, 0, 8, 16);
  }
  return done(c, true);
}

/** Golf ball: white with dimples and the seat's band + mark. */
export function ballTexture(seat: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = "#fbfbf7";
  g.fillRect(0, 0, 256, 128);
  for (let y = 6; y < 128; y += 10)
    for (let x = (y / 10) % 2 ? 5 : 0; x < 256; x += 10) {
      g.fillStyle = "rgba(0,0,0,0.07)";
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  const col = SEAT_COLORS[seat % SEAT_COLORS.length];
  g.fillStyle = col;
  g.fillRect(0, 54, 256, 20);
  g.fillStyle = "#ffffff";
  g.font = "bold 18px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let x = 32; x < 256; x += 64) g.fillText(SEAT_MARKS[seat % SEAT_MARKS.length], x, 64);
  return done(c);
}

/** Pennant with the hole number. */
export function flagTexture(num: number, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 80);
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.font = "bold 54px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(num), 64, 44);
  return done(c);
}

/** Rock underside of a floating island: layered earth. */
export function rockTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#6b4a2b");
  grad.addColorStop(0.12, "#7d5a36");
  grad.addColorStop(0.5, "#6a5b52");
  grad.addColorStop(1, "#3c3a48");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) {
    const x = (i * 6151) % 128;
    const y = (i * 2971) % 256;
    g.fillStyle = `rgba(0,0,0,${0.05 + (i % 4) * 0.03})`;
    g.fillRect(x, y, 3 + (i % 5), 2);
  }
  return done(c, true);
}

/** Painted-board text for the windmill and the ramp. */
export function labelTexture(text: string, bg: string, fg = "#ffffff"): THREE.CanvasTexture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg;
  g.font = "bold 34px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 34);
  return done(c);
}

/** Island tints per theme (grass). */
export const THEME_GRASS: Record<string, string> = {
  meadow: "#4fae4a",
  cliff: "#58a83f",
  rainbow: "#5bbf6a",
  stones: "#4c9e57",
  pinball: "#3e9d7a",
  ice: "#5aa88f",
  volcano: "#6a9b3c",
  fork: "#4aa35a",
  summit: "#56b06d",
};
