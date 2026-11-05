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
      <sphereGeometry args={[150, 32, 16]} />
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
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function speckle(g: CanvasRenderingContext2D, n: number, count: number, colors: string[], min: number, max: number, seed: number) {
  let a = seed;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.globalAlpha = 0.25 + rnd() * 0.5;
    const r = min + rnd() * (max - min);
    g.fillRect(rnd() * n, rnd() * n, r, r * (0.6 + rnd()));
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

/** 표면 질감 (base 색을 곱해 쓰므로 회색조 대비만 그린다) */
export function surfaceTexture(kind: SurfaceKind): THREE.CanvasTexture {
  return makeTex(kind, 256, (g, n) => {
    g.fillStyle = BASE[kind];
    g.fillRect(0, 0, n, n);
    switch (kind) {
      case "grass":
        speckle(g, n, 2600, ["#3f6b2e", "#6a9a4a", "#4d7a36", "#7aa957"], 1, 3, 7);
        break;
      case "asphalt":
        speckle(g, n, 3000, ["#1c1d21", "#3b3c42", "#48494f"], 1, 2, 11);
        break;
      case "concrete":
        speckle(g, n, 1800, ["#5d5b59", "#7f7c79"], 1, 3, 5);
        break;
      case "path":
        speckle(g, n, 1600, ["#b2966a", "#d8bf92", "#a88b60"], 1, 3, 3);
        break;
      case "sidewalk":
      case "tile": {
        speckle(g, n, 900, kind === "tile" ? ["#b8c6cc", "#dde7eb"] : ["#97948e", "#bab7b1"], 1, 2, 9);
        g.strokeStyle = kind === "tile" ? "rgba(90,110,120,0.55)" : "rgba(60,58,55,0.5)";
        g.lineWidth = 3;
        const step = n / 4;
        for (let i = 0; i <= 4; i++) {
          g.beginPath();
          g.moveTo(i * step, 0);
          g.lineTo(i * step, n);
          g.moveTo(0, i * step);
          g.lineTo(n, i * step);
          g.stroke();
        }
        break;
      }
      case "wood": {
        const h = n / 8;
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? "rgba(255,230,200,0.06)" : "rgba(40,20,5,0.08)";
          g.fillRect(0, i * h, n, h);
          g.fillStyle = "rgba(30,15,5,0.45)";
          g.fillRect(0, i * h, n, 2);
          const off = ((i * 97) % 4) * (n / 4);
          g.fillRect(off, i * h, 2, h);
        }
        speckle(g, n, 700, ["#6d4a30", "#a07450"], 1, 6, 13);
        break;
      }
      case "carpet":
        speckle(g, n, 3500, ["#6c4a4a", "#8c6868"], 1, 2, 17);
        break;
    }
  });
}
