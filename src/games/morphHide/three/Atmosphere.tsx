"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 변신 숨바꼭질 분위기 — 매직아워(해 질 녘) 하늘, 따라다니는 해 그림자, 절차적 바닥 질감.
 * 화면 연출만 담당하고 게임 상태는 읽지 않는다 (해 그림자 위치만 내 캐릭터를 따라간다).
 */

export const DUSK = {
  top: "#1d2a5c",
  mid: "#6a5a9a",
  horizon: "#f3a679",
  fog: "#c7928a",
  sun: "#ffd1a1",
  sky: "#ffe0bd",
  ground: "#3b3048",
} as const;

/** 하늘 돔: 위 남색 → 보라 → 지평선 살구색 + 해 무리 */
export function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(DUSK.top) },
          mid: { value: new THREE.Color(DUSK.mid) },
          hor: { value: new THREE.Color(DUSK.horizon) },
          sunDir: { value: new THREE.Vector3(0.55, 0.3, 0.78).normalize() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.18 ? mix(mid, top, smoothstep(0.18, 0.75, h)) : mix(hor, mid, smoothstep(-0.05, 0.18, h));
            float s = max(dot(normalize(vDir), sunDir), 0.0);
            c += vec3(1.0, 0.62, 0.38) * pow(s, 24.0) * 0.55 + vec3(1.0, 0.85, 0.6) * pow(s, 900.0) * 2.5;
            // 디더링: 부드러운 그라데이션이 8비트 계단(띠)으로 끊겨 보이지 않게
            float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            c += (dn - 0.5) / 160.0;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const ref = useRef<THREE.Mesh>(null);
  // 하늘은 카메라를 따라다닌다 (멀리 있는 무한 배경)
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} material={mat} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[150, 48, 32]} />
    </mesh>
  );
}

/** 해: 낮게 깔린 따뜻한 빛. 고사양에선 내 주변 40m만 그림자 지도를 그린다 (따라다님) */
export function SunLight({ shadows, followRef }: { shadows: boolean; followRef: RefObject<{ x: number; y: number; z: number }> }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.add(target);
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target = target;
    if (shadows) {
      l.shadow.mapSize.set(2048, 2048);
      const cam = l.shadow.camera as THREE.OrthographicCamera;
      cam.left = -22;
      cam.right = 22;
      cam.top = 22;
      cam.bottom = -22;
      cam.near = 1;
      cam.far = 90;
      cam.updateProjectionMatrix();
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.03;
      l.shadow.radius = 3;
    }
  }, [shadows, target]);
  useFrame(() => {
    const l = light.current;
    const f = followRef.current;
    if (!l || !f) return;
    // 그림자 지도 픽셀 단위로 맞춰 움직여야 가장자리가 반짝이지 않는다
    const snap = (v: number) => Math.round(v / 0.5) * 0.5;
    const x = snap(f.x);
    const z = snap(f.z);
    target.position.set(x, 0, z);
    l.position.set(x + 25, 21, z + 35);
  });
  return <directionalLight ref={light} castShadow={shadows} intensity={2.3} color={DUSK.sun} />;
}

/** 새로 붙는 메시까지 주기적으로 그림자 켜기 (불투명한 것만, 표지·발광은 제외) */
export function ShadowSetup({ enabled }: { enabled: boolean }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!enabled) return;
    const apply = () => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.Material | THREE.Material[];
        const one = Array.isArray(mat) ? mat[0] : mat;
        const solid = one && !one.transparent && !(one as THREE.MeshBasicMaterial).isMeshBasicMaterial && one.type !== "ShaderMaterial";
        m.receiveShadow = solid;
        m.castShadow = solid && !m.userData.noCast;
      });
    };
    apply();
    const id = window.setInterval(apply, 1500);
    return () => window.clearInterval(id);
  }, [scene, enabled]);
  return null;
}

// ---------------------------------------------------------------------------
// 절차적 질감 (이미지 파일 없이 캔버스로)

const texCache = new Map<string, THREE.CanvasTexture>();

/** 바닥 질감 한 장의 해상도 — 3m 타일 기준 m당 ~170px (예전 256은 가까이서 뭉개졌다) */
const TEX_SIZE = 512;

function makeTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, n: number) => void): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  // 비스듬히 보는 바닥이 흐려지지 않게 — 렌더러가 기기 최대치로 알아서 줄인다
  t.anisotropy = 16;
  texCache.set(key, t);
  return t;
}

function lcg(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** 이음매 없이 반복되도록 가장자리를 넘는 그림은 반대편에도 그린다 */
function wrapDraw(n: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const ox of [-n, 0, n])
    for (const oy of [-n, 0, n]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > n || py + r < 0 || py - r > n) continue;
      draw(px, py);
    }
}

function speckle(g: CanvasRenderingContext2D, n: number, count: number, colors: string[], min: number, max: number, seed: number) {
  const rnd = lcg(seed);
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.globalAlpha = 0.25 + rnd() * 0.5;
    const r = min + rnd() * (max - min);
    const x = rnd() * n;
    const y = rnd() * n;
    const ry = r * (0.6 + rnd());
    if (r < 2.5) g.fillRect(x, y, r, ry);
    else {
      // 큰 알갱이(자갈·꽃)는 네모 픽셀 대신 둥글게
      g.beginPath();
      g.ellipse(x, y, r / 2, ry / 2, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

/** 큰 얼룩 — 반복 무늬가 격자처럼 보이지 않게 하는 저주파 명암 */
function blotches(g: CanvasRenderingContext2D, n: number, count: number, colors: string[], rMin: number, rMax: number, alpha: number, seed: number) {
  const rnd = lcg(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const r = rMin + rnd() * (rMax - rMin);
    const col = colors[Math.floor(rnd() * colors.length)];
    const a = alpha * (0.5 + rnd() * 0.5);
    wrapDraw(n, x, y, r, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = a;
      g.fillStyle = grad;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  g.globalAlpha = 1;
}

/** 짧은 선 (풀잎·나뭇결·잔금) */
function strokes(g: CanvasRenderingContext2D, n: number, count: number, colors: string[], len: [number, number], width: number, angle: [number, number], alpha: number, seed: number) {
  const rnd = lcg(seed);
  g.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const l = len[0] + rnd() * (len[1] - len[0]);
    const ang = angle[0] + rnd() * (angle[1] - angle[0]);
    g.strokeStyle = colors[Math.floor(rnd() * colors.length)];
    g.globalAlpha = alpha * (0.5 + rnd() * 0.5);
    g.lineWidth = width * (0.6 + rnd() * 0.8);
    wrapDraw(n, x, y, l, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(ang) * l, py + Math.sin(ang) * l);
      g.stroke();
    });
  }
  g.globalAlpha = 1;
}

export type SurfaceKind = "grass" | "asphalt" | "sidewalk" | "path" | "wood" | "tile" | "concrete" | "carpet";

const BASE: Record<SurfaceKind, string> = {
  grass: "#55813f",
  asphalt: "#2b2c31",
  sidewalk: "#a9a6a0",
  path: "#c7ab7d",
  wood: "#8a6040",
  tile: "#c9d6dc",
  concrete: "#6f6d6b",
  carpet: "#7d5a5a",
};

/** 표면별 요철 세기 (질감 밝기를 그대로 높낮이로 쓴다 — 해가 낮아서 결이 살아난다) */
export const SURFACE_BUMP: Record<SurfaceKind, number> = {
  grass: 1.2,
  asphalt: 0.9,
  sidewalk: 1.4,
  path: 1.0,
  wood: 0.7,
  tile: 1.1,
  concrete: 1.0,
  carpet: 0.6,
};

/** 표면 질감 (base 색을 곱해 쓰므로 회색조 대비만 그린다) */
export function surfaceTexture(kind: SurfaceKind): THREE.CanvasTexture {
  return makeTex(kind, TEX_SIZE, (g, n) => {
    g.fillStyle = BASE[kind];
    g.fillRect(0, 0, n, n);
    switch (kind) {
      case "grass":
        blotches(g, n, 18, ["#3a6129", "#6f9c4b", "#4b7a35", "#7f9a45"], 50, 150, 0.45, 21);
        speckle(g, n, 7000, ["#3f6b2e", "#6a9a4a", "#4d7a36", "#7aa957"], 1, 4, 7);
        strokes(g, n, 5200, ["#2f5523", "#7fb15c", "#5d8d40", "#94be6a"], [5, 12], 1.6, [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5], 0.55, 8);
        speckle(g, n, 220, ["#d9d27a", "#f2efe0", "#c9a8d8"], 2, 3, 19); // 작은 들꽃
        break;
      case "asphalt":
        blotches(g, n, 14, ["#1a1b1f", "#3a3b41", "#24252a"], 60, 170, 0.5, 23);
        speckle(g, n, 11000, ["#1c1d21", "#3b3c42", "#48494f", "#5a5b61"], 1, 3, 11);
        strokes(g, n, 26, ["#141519"], [20, 70], 1.4, [0, Math.PI * 2], 0.5, 24); // 잔금
        break;
      case "concrete":
        blotches(g, n, 16, ["#5a5856", "#85827e", "#686562"], 50, 160, 0.45, 25);
        speckle(g, n, 6500, ["#5d5b59", "#7f7c79", "#8d8a86"], 1, 4, 5);
        strokes(g, n, 14, ["#4a4846"], [25, 80], 1.2, [0, Math.PI * 2], 0.45, 26);
        break;
      case "path":
        blotches(g, n, 16, ["#b39771", "#dcc59b", "#c2a578"], 50, 150, 0.3, 27);
        speckle(g, n, 6000, ["#b2966a", "#d8bf92", "#a88b60", "#8f7552"], 1, 5, 3);
        speckle(g, n, 260, ["#7d6a52", "#e6d6b6", "#9a8466"], 4, 9, 28); // 자갈
        break;
      case "sidewalk":
      case "tile": {
        const tile = kind === "tile";
        const step = n / 4;
        const rnd = lcg(tile ? 31 : 29);
        // 판마다 조금씩 다른 색 (한 장씩 깐 느낌)
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 4; j++) {
            g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,1)" : "rgba(0,0,0,1)";
            g.globalAlpha = 0.03 + rnd() * 0.05;
            g.fillRect(i * step, j * step, step, step);
          }
        g.globalAlpha = 1;
        blotches(g, n, 10, tile ? ["#b3c2c8", "#e3ecef"] : ["#8f8c86", "#c2bfb9"], 60, 150, 0.35, 32);
        speckle(g, n, 3600, tile ? ["#b8c6cc", "#dde7eb"] : ["#97948e", "#bab7b1", "#85827c"], 1, 3, 9);
        // 줄눈 + 판 가장자리 살짝 밝게
        g.strokeStyle = tile ? "rgba(90,110,120,0.6)" : "rgba(55,53,50,0.6)";
        g.lineWidth = 5;
        for (let i = 0; i <= 4; i++) {
          g.beginPath();
          g.moveTo(i * step, 0);
          g.lineTo(i * step, n);
          g.moveTo(0, i * step);
          g.lineTo(n, i * step);
          g.stroke();
        }
        g.strokeStyle = "rgba(255,255,255,0.14)";
        g.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(i * step + 4, 0);
          g.lineTo(i * step + 4, n);
          g.moveTo(0, i * step + 4);
          g.lineTo(n, i * step + 4);
          g.stroke();
        }
        break;
      }
      case "wood": {
        const h = n / 8;
        const rnd = lcg(41);
        for (let i = 0; i < 8; i++) {
          g.fillStyle = rnd() < 0.5 ? "rgba(255,230,200,1)" : "rgba(40,20,5,1)";
          g.globalAlpha = 0.04 + rnd() * 0.07;
          g.fillRect(0, i * h, n, h);
        }
        g.globalAlpha = 1;
        // 나뭇결 (길게 가로로)
        strokes(g, n, 900, ["#5e3d24", "#a47852", "#6d4a30"], [30, 110], 1.2, [-0.03, 0.03], 0.35, 42);
        speckle(g, n, 900, ["#6d4a30", "#a07450"], 1, 5, 13);
        for (let i = 0; i < 8; i++) {
          g.fillStyle = "rgba(30,15,5,0.5)";
          g.fillRect(0, i * h, n, 3);
          const off = ((i * 97) % 4) * (n / 4);
          g.fillRect(off, i * h, 3, h);
        }
        break;
      }
      case "carpet":
        blotches(g, n, 10, ["#6a4848", "#8f6b6b"], 60, 160, 0.3, 43);
        speckle(g, n, 14000, ["#6c4a4a", "#8c6868", "#5e3f3f"], 1, 2, 17);
        break;
    }
  });
}
