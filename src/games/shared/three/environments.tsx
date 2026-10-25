"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { paintedTexture, FONTS } from "./tableKit";

/**
 * Parametric backdrops for the table games — one indoor room and one outdoor
 * plaza, each themed by colours + a few toggles, so a game gets a distinct
 * setting from a handful of props. Presentation only.
 *
 * Both are dressed in classical detail built from the game's own colours (2026-10-25,
 * "배경을 고풍스럽게"): damask wallpaper, panelled wainscot and mouldings, pilasters, gilt-framed
 * oil paintings, curtained windows and candle sconces indoors; cobbles, a balustrade, iron
 * lamp posts and stone urns outdoors. Every texture is painted on a canvas (no assets).
 */

function bannerTexture(color: string, emblem: string): THREE.CanvasTexture {
  return paintedTexture(`env:banner:${color}:${emblem}`, 128, 320, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, color);
    g.addColorStop(1, "#000000");
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H - 48);
    ctx.lineTo(W / 2, H);
    ctx.lineTo(0, H - 48);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e9b949";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.font = `64px ${FONTS.emoji}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emblem, W / 2, 110);
  });
}

function floorTexture(kind: "planks" | "tiles" | "stone" | "carpet", a: string, b: string): THREE.Texture {
  const t = paintedTexture(`env:floor:${kind}:${a}:${b}`, 256, 256, (ctx, W) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, W, W);
    if (kind === "planks") {
      for (let x = 0; x < 8; x++) {
        ctx.globalAlpha = 0.12 + ((x * 37) % 5) * 0.03;
        ctx.fillStyle = b;
        ctx.fillRect(x * 32, 0, 32, W);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#000";
        ctx.fillRect(x * 32, 0, 2, W);
      }
    } else if (kind === "tiles") {
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          ctx.fillStyle = (x + y) % 2 ? b : a;
          ctx.fillRect(x * 64, y * 64, 64, 64);
        }
    } else if (kind === "stone") {
      for (let y = 0, r = 0; y < W; y += 42, r++)
        for (let x = r % 2 ? -40 : 0; x < W; x += 80) {
          ctx.fillStyle = (x + r * 13) % 3 ? a : b;
          ctx.beginPath();
          ctx.roundRect(x + 3, y + 3, 74, 36, 8);
          ctx.fill();
        }
    } else {
      ctx.strokeStyle = b;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3;
      for (let i = 0; i < W; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 16, 16);
        ctx.lineTo(i, 32);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  return t;
}

const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
const GOLD = "#c9a13a";

function repeat(t: THREE.Texture, x: number, y: number): THREE.Texture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(x, y);
  t.anisotropy = 4;
  return t;
}

/** Damask wallpaper in the wall colour: a lighter medallion motif and faint stripes. */
function wallpaperTexture(wall: string): THREE.Texture {
  return paintedTexture(`env:paper:${wall}`, 256, 256, (ctx, W, H) => {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    const light = mix(wall, "#fff4dc", 0.22);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = light;
    for (let x = 0; x < W; x += 32) ctx.fillRect(x, 0, 3, H);
    ctx.globalAlpha = 0.42;
    const medallion = (cx: number, cy: number, k: number) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 22 * k, 34 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy, r] of [
        [0, -48, 0],
        [0, 48, Math.PI],
        [-34, 0, -Math.PI / 2],
        [34, 0, Math.PI / 2],
      ] as const) {
        ctx.save();
        ctx.translate(cx + dx * k, cy + dy * k);
        ctx.rotate(r);
        ctx.beginPath();
        ctx.moveTo(0, 14 * k);
        ctx.bezierCurveTo(-16 * k, 0, -8 * k, -16 * k, 0, -10 * k);
        ctx.bezierCurveTo(8 * k, -16 * k, 16 * k, 0, 0, 14 * k);
        ctx.fill();
        ctx.restore();
      }
    };
    ctx.fillStyle = light;
    medallion(W / 2, H / 2, 1);
    for (const [x, y] of [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ])
      medallion(x, y, 0.7);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = mix(wall, "#000", 0.35);
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, 9, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

/** Dark wood wainscot: raised panels with a lit top edge, a shadowed lower edge, and grain. */
function wainscotTexture(trim: string): THREE.Texture {
  return paintedTexture(`env:wainscot:${trim}`, 256, 128, (ctx, W, H) => {
    const wood = mix(trim, "#2a160a", 0.55);
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#000";
    for (let y = 4; y < H; y += 7) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 1.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const x0 of [14, 142]) {
      ctx.fillStyle = mix(wood, "#000", 0.25);
      ctx.fillRect(x0, 16, 100, 96);
      ctx.fillStyle = mix(wood, "#fff", 0.08);
      ctx.fillRect(x0 + 8, 24, 84, 80);
      ctx.fillStyle = mix(wood, "#ffe0a0", 0.25);
      ctx.fillRect(x0, 16, 100, 3);
      ctx.fillRect(x0, 16, 3, 96);
      ctx.fillStyle = mix(wood, "#000", 0.5);
      ctx.fillRect(x0, 109, 100, 3);
      ctx.fillRect(x0 + 97, 16, 3, 96);
    }
  });
}

/** A small oil painting — landscape, portrait or still life — in a palette around `tone`. */
function paintingTexture(kind: number, tone: string): THREE.Texture {
  return paintedTexture(`env:painting:${kind}:${tone}`, 256, 192, (ctx, W, H) => {
    const dark = mix(tone, "#120a04", 0.6);
    const light = mix(tone, "#fff1c9", 0.55);
    if (kind === 0) {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
      sky.addColorStop(0, mix(light, "#9ec5e8", 0.5));
      sky.addColorStop(1, mix(light, "#f4c98a", 0.4));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = mix(tone, "#3d5a2a", 0.5);
      ctx.beginPath();
      ctx.moveTo(0, H * 0.62);
      ctx.bezierCurveTo(W * 0.3, H * 0.42, W * 0.55, H * 0.7, W, H * 0.5);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.78);
      ctx.bezierCurveTo(W * 0.4, H * 0.66, W * 0.7, H * 0.86, W, H * 0.74);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.fill();
      ctx.fillStyle = mix(dark, "#000", 0.3);
      ctx.fillRect(W * 0.7, H * 0.38, 6, H * 0.3);
      ctx.beginPath();
      ctx.ellipse(W * 0.71, H * 0.36, 26, 32, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 1) {
      const bg = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H / 2, W * 0.6);
      bg.addColorStop(0, mix(tone, "#3a2614", 0.5));
      bg.addColorStop(1, mix(tone, "#0a0604", 0.85));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(W / 2, H * 1.02, 74, 64, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#e6c3a0";
      ctx.beginPath();
      ctx.ellipse(W / 2, H * 0.44, 30, 38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix(tone, "#1a0f08", 0.7);
      ctx.beginPath();
      ctx.ellipse(W / 2, H * 0.33, 36, 26, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.fillRect(W / 2 - 18, H * 0.78, 36, 6);
    } else {
      ctx.fillStyle = mix(tone, "#1c120a", 0.75);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = mix(tone, "#5a3a1e", 0.6);
      ctx.fillRect(0, H * 0.68, W, H * 0.32);
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.ellipse(W * 0.42, H * 0.5, 30, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(W * 0.42 - 10, H * 0.2, 20, 30);
      for (const [x, c] of [
        [0.62, "#b8321f"],
        [0.7, "#d99a2b"],
        [0.56, "#6b8e23"],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(W * x, H * 0.64, 16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // brush strokes, then an old-varnish glow toward the centre
    for (let i = 0; i < 420; i++) {
      const x = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
      const y = Math.abs((Math.sin(i * 78.233) * 12543.123) % 1);
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = i % 2 ? "#fff" : "#000";
      ctx.fillRect(x * W, y * H, 6, 2);
    }
    ctx.globalAlpha = 1;
    const varnish = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.7);
    varnish.addColorStop(0, "rgba(255,210,140,0)");
    varnish.addColorStop(1, "rgba(40,20,5,0.55)");
    ctx.fillStyle = varnish;
    ctx.fillRect(0, 0, W, H);
  });
}

/** A round medallion rug: border bands, a ring of small motifs and a star medallion. */
function rugTexture(rug: string, trim: string): THREE.Texture {
  return paintedTexture(`env:rug:${rug}:${trim}`, 512, 512, (ctx, W) => {
    const c = W / 2;
    const ring = (r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();
    };
    ring(c, mix(rug, "#000", 0.35));
    ring(c * 0.93, mix(trim, rug, 0.35));
    ring(c * 0.88, rug);
    ring(c * 0.62, mix(rug, "#000", 0.25));
    ring(c * 0.58, rug);
    ctx.fillStyle = mix(trim, "#fff", 0.1);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(a) * c * 0.75, c + Math.sin(a) * c * 0.75, 10, 18, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = mix(trim, rug, 0.2);
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? c * 0.2 : c * 0.42;
      ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ring(c * 0.12, mix(rug, "#000", 0.3));
  });
}

function curtainTexture(color: string): THREE.Texture {
  return paintedTexture(`env:curtain:${color}`, 128, 64, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, i % 2 ? mix(color, "#000", 0.45) : mix(color, "#fff", 0.12));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
}

/** Radial cobbles in the plaza colour, laid in rings around the table. */
function cobbleTexture(plaza: string): THREE.Texture {
  // 1024 px over the 14 m plaza: stones ~15 cm, small enough to read as paving, not blotches
  return paintedTexture(`env:cobble:${plaza}`, 1024, 1024, (ctx, W) => {
    const c = W / 2;
    ctx.fillStyle = mix(plaza, "#000", 0.45);
    ctx.fillRect(0, 0, W, W);
    for (let r = 10, row = 0; r < c; r += 12, row++) {
      const n = Math.max(6, Math.floor((Math.PI * 2 * r) / 13));
      for (let i = 0; i < n; i++) {
        const a = ((i + (row % 2) * 0.5) / n) * Math.PI * 2;
        const shade = ((i * 7 + row * 3) % 5) / 5;
        ctx.fillStyle = mix(plaza, i % 3 ? "#ffffff" : "#000000", 0.06 + shade * 0.1);
        ctx.beginPath();
        ctx.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 5.6, 4.8, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

/** Gilt frame + oil painting, with a small brass picture light above it. */
function Painting({ tone, kind }: { tone: string; kind: number }) {
  const map = useMemo(() => paintingTexture(kind, tone), [kind, tone]);
  const gold = <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.32} />;
  return (
    <group>
      <mesh>
        <boxGeometry args={[1.38, 1.08, 0.08]} />
        {gold}
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[1.2, 0.9, 0.02]} />
        <meshStandardMaterial color={mix(GOLD, "#3a2608", 0.45)} metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.058]}>
        <planeGeometry args={[1.08, 0.8]} />
        <meshStandardMaterial map={map} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.66, 0.12]}>
        <boxGeometry args={[0.5, 0.05, 0.08]} />
        {gold}
      </mesh>
    </group>
  );
}

/** Candle sconce on a brass back plate. */
function Sconce({ light }: { light: boolean }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.12, 0.3, 0.03]} />
        <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.05, 0.1]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.012, 0.012, 0.2, 6]} />
        <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.02, 0.2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.14, 10]} />
        <meshStandardMaterial color="#f3ead8" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.13, 0.2]}>
        <coneGeometry args={[0.022, 0.07, 8]} />
        <meshBasicMaterial color="#ffc46b" />
      </mesh>
      {light && <pointLight position={[0, 0.2, 0.3]} color="#ffb35c" intensity={2.2} distance={4} decay={2} />}
    </group>
  );
}

/** Wooden window casing with mullions, a sill, velvet drapes and a valance. */
function WindowDressing({ drape, trim, arched }: { drape: string; trim: string; arched: boolean }) {
  const map = useMemo(() => curtainTexture(drape), [drape]);
  const wood = <meshStandardMaterial color={mix(trim, "#2a160a", 0.4)} roughness={0.6} />;
  const top = arched ? 5.7 : 4.95;
  return (
    <group>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, 3.6, 0.04]}>
          <boxGeometry args={[0.1, 2.8, 0.08]} />
          {wood}
        </mesh>
      ))}
      <mesh position={[0, 2.25, 0.08]}>
        <boxGeometry args={[1.85, 0.1, 0.22]} />
        {wood}
      </mesh>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 3.6, 0.025]}>
          <planeGeometry args={[0.035, 2.6]} />
          {wood}
        </mesh>
      ))}
      {[3.0, 4.2].map((y) => (
        <mesh key={y} position={[0, y, 0.025]}>
          <planeGeometry args={[1.5, 0.035]} />
          {wood}
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 1.05, 3.55, 0.14]}>
          <boxGeometry args={[0.5, 3.3, 0.06]} />
          <meshStandardMaterial map={map} color="#ffffff" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, top + 0.05, 0.16]}>
        <boxGeometry args={[2.6, 0.36, 0.08]} />
        <meshStandardMaterial map={map} color={mix(drape, "#000", 0.15)} roughness={0.95} />
      </mesh>
      <mesh position={[0, top + 0.26, 0.2]}>
        <boxGeometry args={[2.7, 0.06, 0.06]} />
        <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** A flat classical pilaster (base, shaft, capital) standing against the wall. */
function Pilaster({ color }: { color: string }) {
  const m = <meshStandardMaterial color={color} roughness={0.55} />;
  return (
    <group>
      <mesh position={[0, 0.2, 0.06]}>
        <boxGeometry args={[0.62, 0.4, 0.16]} />
        {m}
      </mesh>
      <mesh position={[0, 3.0, 0.04]}>
        <boxGeometry args={[0.46, 5.2, 0.1]} />
        {m}
      </mesh>
      {[-0.12, 0, 0.12].map((x) => (
        <mesh key={x} position={[x, 3.0, 0.095]}>
          <boxGeometry args={[0.04, 4.8, 0.01]} />
          <meshStandardMaterial color={mix(color, "#000", 0.25)} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 5.7, 0.07]}>
        <boxGeometry args={[0.66, 0.32, 0.18]} />
        {m}
      </mesh>
    </group>
  );
}

function Flame({ position, light, color = "#ffae42" }: { position: [number, number, number]; light: boolean; color?: string }) {
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const f = 1 + Math.sin(clock.elapsedTime * 15 + position[0] * 3) * 0.13 + Math.sin(clock.elapsedTime * 6.1) * 0.06;
    flame.current?.scale.set(1, f, 1);
  });
  return (
    <group position={position}>
      <mesh position={[0, -0.22, 0]}>
        <cylinderGeometry args={[0.04, 0.03, 0.4, 8]} />
        <meshStandardMaterial color="#3b2412" roughness={0.8} />
      </mesh>
      <mesh ref={flame} position={[0, 0.06, 0]}>
        <coneGeometry args={[0.08, 0.24, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {light && <pointLight position={[0, 0.2, 0]} color={color} intensity={5} distance={6} decay={2} />}
    </group>
  );
}

export interface IndoorRoomProps {
  lowDetail: boolean;
  wall: string;
  floor: { kind: "planks" | "tiles" | "stone" | "carpet"; a: string; b: string };
  rug: string;
  trim: string;
  /** Glowing windows (count around the wall). */
  windows?: { color: string; count: number; arched?: boolean };
  banners?: { colors: string[]; emblem: string };
  /** Framed pictures between the windows. */
  frames?: string[];
  torches?: boolean;
  pillars?: string;
  /** Extra props placed in the room. */
  children?: ReactNode;
}

export function IndoorRoom(p: IndoorRoomProps) {
  const seg = p.lowDetail ? 24 : 48;
  const floor = useMemo(() => floorTexture(p.floor.kind, p.floor.a, p.floor.b), [p.floor.kind, p.floor.a, p.floor.b]);
  const paper = useMemo(() => repeat(wallpaperTexture(p.wall), 30, 7), [p.wall]);
  const wains = useMemo(() => repeat(wainscotTexture(p.trim), 26, 1), [p.trim]);
  const rugMap = useMemo(() => rugTexture(p.rug, p.trim), [p.rug, p.trim]);
  const drape = p.frames?.[0] ?? mix(p.trim, p.wall, 0.4);
  const stone = mix(p.wall, "#e8dcc4", 0.32);
  const moulding = <meshStandardMaterial color={mix(p.trim, "#fff", 0.1)} roughness={0.45} metalness={0.25} />;
  const slots = 10;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[12, seg]} />
        <meshStandardMaterial map={floor} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4.5, seg]} />
        <meshStandardMaterial map={rugMap} roughness={1} />
      </mesh>
      <mesh position={[0, 0.008, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.5, 4.62, seg]} />
        <meshStandardMaterial color={p.trim} roughness={0.5} metalness={0.5} />
      </mesh>
      {/* damask walls over a panelled wainscot, with base, chair rail, picture rail and cornice */}
      <mesh position={[0, 4.5, 0]}>
        <cylinderGeometry args={[10, 10, 9, seg, 1, true]} />
        <meshStandardMaterial map={paper} roughness={0.9} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0.66, 0]}>
        <cylinderGeometry args={[9.95, 9.95, 1.32, seg, 1, true]} />
        <meshStandardMaterial map={wains} roughness={0.6} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[9.92, 9.92, 0.18, seg, 1, true]} />
        <meshStandardMaterial color={mix(p.trim, "#000", 0.55)} roughness={0.6} side={THREE.BackSide} />
      </mesh>
      {[
        [1.34, 0.05],
        [5.05, 0.035],
        [6.15, 0.14],
      ].map(([y, tube]) => (
        <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[9.94, tube, 6, seg * 2]} />
          {moulding}
        </mesh>
      ))}
      {Array.from({ length: slots }, (_, i) => {
        const a = (i / slots) * Math.PI * 2 + Math.PI / slots;
        const edge = (i / slots) * Math.PI * 2;
        const windowHere = p.windows && i % Math.max(1, Math.round(slots / p.windows.count)) === 0;
        const bannerHere = !windowHere && p.banners && i % 2 === 1;
        const frameHere = !windowHere && !bannerHere && p.frames;
        return (
          <group key={i}>
            {!p.pillars && (
              <group position={[Math.sin(edge) * 9.9, 0, Math.cos(edge) * 9.9]} rotation-y={edge + Math.PI}>
                <Pilaster color={stone} />
              </group>
            )}
            <group position={[Math.sin(a) * 9.85, 0, Math.cos(a) * 9.85]} rotation-y={a + Math.PI}>
              {windowHere && (
                <>
                  <mesh position={[0, 3.6, 0]}>
                    <planeGeometry args={[1.5, 2.6]} />
                    <meshBasicMaterial color={p.windows!.color} fog={false} />
                  </mesh>
                  {p.windows!.arched && (
                    <mesh position={[0, 4.9, 0]}>
                      <circleGeometry args={[0.75, 20, 0, Math.PI]} />
                      <meshBasicMaterial color={p.windows!.color} fog={false} />
                    </mesh>
                  )}
                  <WindowDressing drape={drape} trim={p.trim} arched={!!p.windows!.arched} />
                </>
              )}
              {bannerHere && (
                <mesh position={[0, 4.0, 0]}>
                  <planeGeometry args={[1.05, 2.6]} />
                  <meshStandardMaterial map={bannerTexture(p.banners!.colors[i % p.banners!.colors.length], p.banners!.emblem)} transparent roughness={0.9} side={THREE.DoubleSide} />
                </mesh>
              )}
              {frameHere && (
                <group position={[0, 3.0, 0.02]}>
                  <Painting tone={p.frames![i % p.frames!.length]} kind={i % 3} />
                </group>
              )}
              {frameHere && !p.torches && !p.lowDetail &&
                [-1, 1].map((s) => (
                  <group key={s} position={[s * 1.0, 2.35, 0.02]}>
                    <Sconce light={s === 1 && i % 4 === 1} />
                  </group>
                ))}
              {p.torches && i % 3 === 0 && <Flame position={[0.95, 2.3, 0.2]} light={!p.lowDetail && i % 6 === 0} />}
              {p.pillars && (
                <mesh position={[-1.3, 4.5, 0.3]}>
                  <cylinderGeometry args={[0.28, 0.32, 9, 14]} />
                  <meshStandardMaterial color={p.pillars} roughness={0.6} />
                </mesh>
              )}
            </group>
          </group>
        );
      })}
      {p.children}
    </group>
  );
}

export interface OutdoorPlazaProps {
  lowDetail: boolean;
  ground: string;
  plaza: string;
  trim: string;
  /** Distant silhouettes: mountains (cones), city (boxes) or dunes (spheres). */
  skyline: { kind: "mountains" | "city" | "dunes" | "trees"; color: string; cap?: string };
  sun?: { color: string; position: [number, number, number]; size?: number };
  torches?: boolean;
  /** Low ring wall around the plaza. */
  wall?: string;
  children?: ReactNode;
}

const BALUSTER = [
  [0, 0],
  [0.06, 0],
  [0.06, 0.06],
  [0.035, 0.1],
  [0.075, 0.3],
  [0.035, 0.5],
  [0.045, 0.58],
  [0.045, 0.64],
  [0, 0.64],
].map(([x, y]) => new THREE.Vector2(x, y));

/** Stone balustrade ringing the plaza: plinth, vase balusters (instanced), posts with ball finials and a top rail. */
function Balustrade({ color, lowDetail }: { color: string; lowDetail: boolean }) {
  const R = 9.7;
  const n = lowDetail ? 90 : 180;
  const geo = useMemo(() => new THREE.LatheGeometry(BALUSTER, lowDetail ? 6 : 10), [lowDetail]);
  const inst = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      m.makeTranslation(Math.sin(a) * R, 0.2, Math.cos(a) * R);
      inst.current?.setMatrixAt(i, m);
    }
    if (inst.current) inst.current.instanceMatrix.needsUpdate = true;
  }, [n]);
  const seg = lowDetail ? 32 : 72;
  const stone = <meshStandardMaterial color={color} roughness={0.85} />;
  return (
    <group>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[R + 0.12, R + 0.14, 0.2, seg, 1, true]} />
        <meshStandardMaterial color={mix(color, "#000", 0.15)} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={inst} args={[geo, undefined, n]}>
        {stone}
      </instancedMesh>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[R + 0.1, R + 0.1, 0.12, seg, 1, true]} />
        <meshStandardMaterial color={mix(color, "#fff", 0.08)} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * R, 0, Math.cos(a) * R]}>
            <mesh position={[0, 0.5, 0]}>
              <boxGeometry args={[0.3, 1.0, 0.3]} />
              {stone}
            </mesh>
            <mesh position={[0, 1.12, 0]}>
              <sphereGeometry args={[0.12, 12, 10]} />
              {stone}
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** A classic cast-iron street lamp with a glowing lantern. */
function LampPost({ light }: { light: boolean }) {
  const iron = <meshStandardMaterial color="#1f2328" metalness={0.6} roughness={0.45} />;
  return (
    <group>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.3, 10]} />
        {iron}
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <cylinderGeometry args={[0.045, 0.065, 2.4, 10]} />
        {iron}
      </mesh>
      <mesh position={[0, 2.62, 0]}>
        <boxGeometry args={[0.26, 0.04, 0.26]} />
        {iron}
      </mesh>
      <mesh position={[0, 2.82, 0]}>
        <cylinderGeometry args={[0.13, 0.09, 0.36, 6]} />
        <meshStandardMaterial color="#ffd98a" emissive="#ffb347" emissiveIntensity={1.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 3.06, 0]}>
        <coneGeometry args={[0.19, 0.18, 6]} />
        {iron}
      </mesh>
      {light && <pointLight position={[0, 2.8, 0]} color="#ffc36b" intensity={4} distance={7} decay={2} />}
    </group>
  );
}

const URN = [
  [0, 0],
  [0.16, 0],
  [0.1, 0.08],
  [0.1, 0.18],
  [0.26, 0.38],
  [0.3, 0.6],
  [0.32, 0.64],
  [0, 0.64],
].map(([x, y]) => new THREE.Vector2(x, y));

/** A stone urn, planted when the setting is green. */
function Urn({ stone, plant }: { stone: string; plant: string | null }) {
  const geo = useMemo(() => new THREE.LatheGeometry(URN, 14), []);
  return (
    <group>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={stone} roughness={0.85} />
      </mesh>
      {plant && (
        <mesh position={[0, 0.78, 0]} scale={[1, 0.8, 1]}>
          <sphereGeometry args={[0.32, 12, 10]} />
          <meshStandardMaterial color={plant} roughness={1} flatShading />
        </mesh>
      )}
    </group>
  );
}

export function OutdoorPlaza(p: OutdoorPlazaProps) {
  const seg = p.lowDetail ? 24 : 48;
  const cobbles = useMemo(() => cobbleTexture(p.plaza), [p.plaza]);
  const items = useMemo(
    () =>
      Array.from({ length: p.skyline.kind === "city" ? 26 : 13 }, (_, i) => {
        const a = (i / (p.skyline.kind === "city" ? 26 : 13)) * Math.PI * 2 + 0.2;
        return { a, h: 3 + ((i * 37) % 9), r: 2 + ((i * 13) % 3), d: 24 + ((i * 7) % 5) };
      }),
    [p.skyline.kind],
  );
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[34, seg]} />
        <meshStandardMaterial color={p.ground} roughness={1} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[7, seg]} />
        <meshStandardMaterial map={cobbles} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.007, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.2, 4.45, seg]} />
        <meshStandardMaterial color={p.trim} roughness={0.8} />
      </mesh>
      <Balustrade color={p.wall ?? mix(p.plaza, "#e8dcc4", 0.35)} lowDetail={p.lowDetail} />
      {!p.torches &&
        Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          return (
            <group key={i} position={[Math.sin(a) * 7.6, 0, Math.cos(a) * 7.6]}>
              <LampPost light={!p.lowDetail && i % 3 === 0} />
            </group>
          );
        })}
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * 8.5, 0, Math.cos(a) * 8.5]}>
            <Urn stone={mix(p.plaza, "#e8dcc4", 0.3)} plant={p.skyline.kind === "trees" || p.skyline.kind === "mountains" ? "#3f6b2e" : null} />
          </group>
        );
      })}
      {p.torches &&
        Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          return <Flame key={i} position={[Math.sin(a) * 7.2, 1.6, Math.cos(a) * 7.2]} light={!p.lowDetail && i % 2 === 0} />;
        })}
      {items.map((m, i) => {
        const x = Math.sin(m.a) * m.d;
        const z = Math.cos(m.a) * m.d;
        if (p.skyline.kind === "city")
          return (
            <mesh key={i} position={[x, m.h, z]}>
              <boxGeometry args={[m.r * 1.2, m.h * 2, m.r * 1.2]} />
              <meshStandardMaterial color={p.skyline.color} emissive={p.skyline.cap ?? "#000"} emissiveIntensity={0.18} roughness={1} />
            </mesh>
          );
        if (p.skyline.kind === "dunes")
          return (
            <mesh key={i} position={[x, 0, z]} scale={[2.2, 0.5, 1.4]}>
              <sphereGeometry args={[m.r + 1, 12, 8]} />
              <meshStandardMaterial color={p.skyline.color} roughness={1} />
            </mesh>
          );
        if (p.skyline.kind === "trees")
          return (
            <group key={i} position={[x * 0.6, 0, z * 0.6]}>
              <mesh position={[0, 0.8, 0]}>
                <cylinderGeometry args={[0.12, 0.16, 1.6, 6]} />
                <meshStandardMaterial color="#4a3020" roughness={1} />
              </mesh>
              <mesh position={[0, 2.2, 0]}>
                <coneGeometry args={[0.9 + (i % 3) * 0.2, 2.4, 7]} />
                <meshStandardMaterial color={p.skyline.color} roughness={1} flatShading />
              </mesh>
            </group>
          );
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, m.h / 2 + 2, 0]}>
              <coneGeometry args={[m.r + 1.5, m.h + 4, 6]} />
              <meshStandardMaterial color={p.skyline.color} roughness={1} flatShading />
            </mesh>
            {p.skyline.cap && (
              <mesh position={[0, m.h + 4 - (m.h + 4) * 0.12, 0]}>
                <coneGeometry args={[(m.r + 1.5) * 0.25, (m.h + 4) * 0.25, 6]} />
                <meshStandardMaterial color={p.skyline.cap} roughness={0.8} flatShading />
              </mesh>
            )}
          </group>
        );
      })}
      {p.sun && (
        <mesh position={p.sun.position} rotation-y={Math.atan2(-p.sun.position[0], -p.sun.position[2])}>
          <circleGeometry args={[p.sun.size ?? 2, 32]} />
          <meshBasicMaterial color={p.sun.color} fog={false} />
        </mesh>
      )}
      {p.children}
    </group>
  );
}
