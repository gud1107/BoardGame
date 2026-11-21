"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { BOX_R, ITEM_INFO, SEAT_COLORS, TOY_LEN, type TrackId } from "../data";
import { FL } from "../sim";
import { BRIDGE_H, pointAt, trackFor, trainProgress, trainState, type Prop, type Track } from "../track";
import { flagsOf, poseOf, type SceneShared } from "../view";
import ToyCar, { type CarFrame } from "./Car";
import { FxLayer, type FxItem } from "./Fx";

/**
 * 장난감 방 레이스 3D 무대 (룰북 §11): 거인 시점의 방 바닥(마루·타일·카펫) 위 놀이 매트 도로와 러그,
 * 알록달록 블록 울타리, 출발 아치, 📚 책 점프대·책 다리, 🫧 비누 거품, 🚂 기차 건널목, 🎁 선물 상자,
 * 고정 장애물(블록 탑·샴푸 통), 🦆 오리·🧶 털실·🪀 요요·🧱 장난감 벽, 장난감 차, 연출, 뒤따라가는 카메라.
 * 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 계산해 옮긴다.
 */

export interface RaceSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  track: TrackId;
  quality: "high" | "low";
  fx: FxItem[];
  onFps?: (fps: number) => void;
}

/* ── 텍스처 ─────────────────────────────────────────────────────────── */

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  return t;
}

/** 놀이 매트 도로: 회색 아스팔트 + 흰 가장자리 선 + 노란 가운데 점선 (v 방향 = 트랙 진행) */
function roadTexture() {
  return canvasTex(256, 512, (g) => {
    g.fillStyle = "#5b6472";
    g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(255,255,255,${0.02 + ((i * 37) % 7) * 0.006})`;
      g.fillRect((i * 97) % 256, (i * 151) % 512, 3, 3);
    }
    g.fillStyle = "#f8fafc";
    g.fillRect(10, 0, 10, 512);
    g.fillRect(236, 0, 10, 512);
    g.fillStyle = "#facc15";
    g.fillRect(122, 40, 12, 170);
    g.fillRect(122, 296, 12, 170);
  });
}

const RUG_COLORS: Record<TrackId, [string, string]> = {
  living: ["#be123c", "#fda4af"],
  bath: ["#0e7490", "#22d3ee"],
  bedroom: ["#4d7c0f", "#84cc16"],
};

function rugTexture(id: TrackId) {
  const [a, b] = RUG_COLORS[id];
  return canvasTex(128, 128, (g) => {
    g.fillStyle = a;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = b;
    for (let y = 0; y < 128; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) g.fillRect(x, y, 8, 8);
  });
}

function floorTexture(id: TrackId) {
  if (id === "bath")
    return canvasTex(256, 256, (g) => {
      g.fillStyle = "#cbd5e1";
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          g.fillStyle = (x + y) % 2 ? "#f1f5f9" : "#e2e8f0";
          g.fillRect(x * 64 + 3, y * 64 + 3, 58, 58);
        }
    });
  if (id === "bedroom")
    return canvasTex(256, 256, (g) => {
      g.fillStyle = "#e7dcc8";
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = "rgba(250,204,21,0.5)";
      for (let i = 0; i < 9; i++) {
        const x = (i * 83) % 256;
        const y = (i * 131) % 256;
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 6 : 14;
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.fill();
      }
    });
  // 거실 마루
  return canvasTex(256, 256, (g) => {
    for (let k = 0; k < 8; k++) {
      g.fillStyle = k % 2 ? "#c69467" : "#b98559";
      g.fillRect(0, k * 32, 256, 32);
      g.fillStyle = "rgba(60,30,10,0.35)";
      g.fillRect(0, k * 32, 256, 2);
      g.fillRect(((k * 97) % 200) + 20, k * 32, 2, 32);
    }
  });
}

/* ── 리본 (트랙을 따라 옆 거리 a~b 띠) ─────────────────────────────── */

function ribbon(t: Track, latA: (i: number) => number, latB: (i: number) => number, yOff: number, vScale: number): THREE.BufferGeometry {
  const n = t.n;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const nx = -t.tz[i];
    const nz = t.tx[i];
    const a = latA(i);
    const b = latB(i);
    pos.set([t.x[i] + nx * a, t.y[i] + yOff, t.z[i] + nz * a, t.x[i] + nx * b, t.y[i] + yOff, t.z[i] + nz * b], k * 6);
    const v = (k * t.ds) / vScale;
    uv.set([0, v, 1, v], k * 4);
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ── 방 ─────────────────────────────────────────────────────────────── */

function Room({ t, quality }: { t: Track; quality: "high" | "low" }) {
  const tex = useMemo(() => {
    const f = floorTexture(t.id);
    f.repeat.set(t.room.hx / 6, t.room.hz / 6);
    return f;
  }, [t]);
  useEffect(() => () => tex.dispose(), [tex]);
  const wall = t.id === "bath" ? "#bfdbfe" : t.id === "bedroom" ? "#fde68a" : "#fef3c7";
  const H = 40;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02} receiveShadow>
        <planeGeometry args={[t.room.hx * 2, t.room.hz * 2]} />
        <meshStandardMaterial map={tex} roughness={0.8} />
      </mesh>
      {/* 벽 4면 + 걸레받이 */}
      {[
        [0, -t.room.hz, 0, t.room.hx * 2],
        [0, t.room.hz, Math.PI, t.room.hx * 2],
        [-t.room.hx, 0, Math.PI / 2, t.room.hz * 2],
        [t.room.hx, 0, -Math.PI / 2, t.room.hz * 2],
      ].map(([x, z, ry, w], i) => (
        <group key={i} position={[x, 0, z]} rotation-y={ry}>
          <mesh position-y={H / 2}>
            <planeGeometry args={[w, H]} />
            <meshStandardMaterial color={wall} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.8, 0.2]}>
            <boxGeometry args={[w, 1.6, 0.4]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.6} />
          </mesh>
          {i === 0 && (
            // 창문 (빛이 들어오는 쪽)
            <mesh position={[t.room.hx * 0.35, 22, 0.05]}>
              <planeGeometry args={[22, 16]} />
              <meshBasicMaterial color="#e0f2fe" toneMapped={false} />
            </mesh>
          )}
        </group>
      ))}
      {t.props.map((p, i) => (
        <PropMesh key={i} p={p} t={t} shadows={quality === "high"} />
      ))}
    </group>
  );
}

/** 가구·장난감 소품 (트랙 밖, 부딪힘 없음) */
function PropMesh({ p, t, shadows }: { p: Prop; t: Track; shadows: boolean }) {
  const M = (c: string, r = 0.7) => <meshStandardMaterial color={c} roughness={r} />;
  const cs = shadows;
  let body: React.ReactNode = null;
  switch (p.kind) {
    case "sofa":
      body = (
        <group>
          <mesh position={[0, 3, 0]} castShadow={cs}>
            <boxGeometry args={[40, 6, 12]} />
            {M("#7c3aed", 0.9)}
          </mesh>
          <mesh position={[0, 9, -4.5]} castShadow={cs}>
            <boxGeometry args={[40, 10, 3]} />
            {M("#6d28d9", 0.9)}
          </mesh>
          {[-19, 19].map((x) => (
            <mesh key={x} position={[x, 7, 0]}>
              <boxGeometry args={[3, 8, 12]} />
              {M("#6d28d9", 0.9)}
            </mesh>
          ))}
        </group>
      );
      break;
    case "table":
      body = (
        <group>
          <mesh position={[0, 9, 0]} castShadow={cs}>
            <boxGeometry args={[24, 1, 14]} />
            {M("#92400e", 0.5)}
          </mesh>
          {[
            [-11, -6],
            [11, -6],
            [-11, 6],
            [11, 6],
          ].map(([x, z]) => (
            <mesh key={`${x}${z}`} position={[x, 4.3, z]} castShadow={cs}>
              <cylinderGeometry args={[0.6, 0.5, 8.6, 10]} />
              {M("#78350f", 0.5)}
            </mesh>
          ))}
        </group>
      );
      break;
    case "rug":
      body = (
        <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
          <circleGeometry args={[16, 40]} />
          {M("#fca5a5", 1)}
        </mesh>
      );
      break;
    case "mat":
      body = (
        <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
          <planeGeometry args={[26, 16]} />
          {M("#99f6e4", 1)}
        </mesh>
      );
      break;
    case "lamp":
      body = (
        <group>
          <mesh position={[0, 10, 0]}>
            <cylinderGeometry args={[0.4, 0.4, 20, 8]} />
            {M("#d6d3d1", 0.4)}
          </mesh>
          <mesh position={[0, 21, 0]}>
            <coneGeometry args={[4, 5, 20, 1, true]} />
            <meshStandardMaterial color="#fef9c3" emissive="#fde68a" emissiveIntensity={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
      break;
    case "plant":
      body = (
        <group>
          <mesh position={[0, 2.5, 0]} castShadow={cs}>
            <cylinderGeometry args={[3, 2.2, 5, 14]} />
            {M("#c2410c", 0.8)}
          </mesh>
          {[0, 1, 2, 3, 4].map((k) => (
            <mesh key={k} position={[Math.cos(k * 1.3) * 1.5, 8 + (k % 2) * 2, Math.sin(k * 1.3) * 1.5]} castShadow={cs}>
              <icosahedronGeometry args={[2.6, 1]} />
              <meshStandardMaterial color={k % 2 ? "#15803d" : "#16a34a"} roughness={0.9} flatShading />
            </mesh>
          ))}
        </group>
      );
      break;
    case "bear":
      body = (
        <group>
          <mesh position={[0, 3, 0]} castShadow={cs}>
            <sphereGeometry args={[3.2, 18, 14]} />
            {M("#a16207", 1)}
          </mesh>
          <mesh position={[0, 7.4, 0]} castShadow={cs}>
            <sphereGeometry args={[2.4, 18, 14]} />
            {M("#a16207", 1)}
          </mesh>
          {[-1.7, 1.7].map((x) => (
            <mesh key={x} position={[x, 9.4, 0]}>
              <sphereGeometry args={[0.9, 12, 10]} />
              {M("#854d0e", 1)}
            </mesh>
          ))}
          <mesh position={[0, 7, 2.1]}>
            <sphereGeometry args={[0.9, 12, 10]} />
            {M("#fde68a", 1)}
          </mesh>
        </group>
      );
      break;
    case "blocks":
      body = (
        <group>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <mesh key={k} position={[(k % 3) * 2.2 - 2.2, 1 + Math.floor(k / 3) * 2, (k % 2) * 0.8]} rotation-y={k * 0.3} castShadow={cs}>
              <boxGeometry args={[2, 2, 2]} />
              {M(["#ef4444", "#3b82f6", "#facc15", "#22c55e", "#a855f7", "#f97316"][k], 0.5)}
            </mesh>
          ))}
        </group>
      );
      break;
    case "ball":
      body = (
        <mesh position={[0, 2.2 * p.s, 0]} castShadow={cs}>
          <sphereGeometry args={[2.2 * p.s, 20, 16]} />
          {M("#f43f5e", 0.4)}
        </mesh>
      );
      break;
    case "books":
      body = (
        <group>
          {[0, 1, 2].map((k) => (
            <mesh key={k} position={[0, 0.5 + k, 0]} rotation-y={k * 0.2} castShadow={cs}>
              <boxGeometry args={[5, 1, 3.6]} />
              {M(["#1d4ed8", "#b91c1c", "#15803d"][k], 0.7)}
            </mesh>
          ))}
        </group>
      );
      break;
    case "tub":
      body = (
        <mesh position={[0, 5, 0]} castShadow={cs}>
          <boxGeometry args={[34, 10, 12]} />
          {M("#f8fafc", 0.25)}
        </mesh>
      );
      break;
    case "sink":
      body = (
        <group>
          <mesh position={[0, 6, 0]} castShadow={cs}>
            <boxGeometry args={[14, 12, 8]} />
            {M("#e2e8f0", 0.4)}
          </mesh>
        </group>
      );
      break;
    case "toilet":
      body = (
        <group>
          <mesh position={[0, 3, 0]} castShadow={cs}>
            <cylinderGeometry args={[3.5, 3, 6, 18]} />
            {M("#f8fafc", 0.25)}
          </mesh>
          <mesh position={[0, 8, -3]}>
            <boxGeometry args={[7, 8, 2.5]} />
            {M("#f1f5f9", 0.25)}
          </mesh>
        </group>
      );
      break;
    case "towel":
      body = (
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[10, 0.6, 6]} />
          {M("#f9a8d4", 1)}
        </mesh>
      );
      break;
    case "bed":
      body = (
        <group>
          <mesh position={[0, 4, 0]} castShadow={cs}>
            <boxGeometry args={[44, 8, 16]} />
            {M("#93c5fd", 0.9)}
          </mesh>
          <mesh position={[-16, 9, 0]}>
            <boxGeometry args={[9, 3, 12]} />
            {M("#f8fafc", 1)}
          </mesh>
        </group>
      );
      break;
    case "desk":
      body = (
        <group>
          <mesh position={[0, 12, 0]} castShadow={cs}>
            <boxGeometry args={[18, 1, 9]} />
            {M("#a16207", 0.5)}
          </mesh>
          {[-8, 8].map((x) => (
            <mesh key={x} position={[x, 6, 0]}>
              <boxGeometry args={[1, 12, 8]} />
              {M("#854d0e", 0.5)}
            </mesh>
          ))}
        </group>
      );
      break;
    case "shelf":
      body = (
        <group>
          <mesh position={[0, 10, 0]} castShadow={cs}>
            <boxGeometry args={[20, 20, 5]} />
            {M("#fef3c7", 0.6)}
          </mesh>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <mesh key={k} position={[-7 + k * 2.6, 5 + (k % 2) * 8, 2.6]}>
              <boxGeometry args={[2, 5, 0.6]} />
              {M(["#ef4444", "#3b82f6", "#facc15", "#22c55e", "#a855f7", "#f97316"][k], 0.6)}
            </mesh>
          ))}
        </group>
      );
      break;
    case "rocket":
      body = (
        <group>
          <mesh position={[0, 5, 0]} castShadow={cs}>
            <cylinderGeometry args={[1.6, 1.6, 8, 14]} />
            {M("#f8fafc", 0.4)}
          </mesh>
          <mesh position={[0, 10.5, 0]}>
            <coneGeometry args={[1.6, 3, 14]} />
            {M("#ef4444", 0.4)}
          </mesh>
        </group>
      );
      break;
    default:
      body = null;
  }
  void t;
  return (
    <group position={[p.x, 0, p.z]} rotation-y={p.rot}>
      {body}
    </group>
  );
}

/* ── 트랙 ───────────────────────────────────────────────────────────── */

const FENCE_COLORS = ["#ef4444", "#3b82f6", "#facc15", "#22c55e", "#a855f7", "#f97316"];

function TrackMesh({ t, quality }: { t: Track; quality: "high" | "low" }) {
  const geos = useMemo(() => {
    const road = ribbon(t, (i) => -t.w[i], (i) => t.w[i], 0.02, 8);
    const under = ribbon(t, (i) => (t.y[i] > 0.3 ? t.w[i] : 0), (i) => (t.y[i] > 0.3 ? -t.w[i] : 0), -0.25, 8);
    const rugR = ribbon(t, (i) => t.w[i], (i) => t.w[i] + t.rugA[i], 0.012, 2);
    const rugL = ribbon(t, (i) => -t.w[i] - t.rugB[i], (i) => -t.w[i], 0.012, 2);
    const soap = ribbon(t, (i) => (t.soap[i] ? -t.w[i] : 0), (i) => (t.soap[i] ? t.w[i] : 0), 0.03, 4);
    return { road, under, rugR, rugL, soap };
  }, [t]);
  const roadTex = useMemo(() => roadTexture(), []);
  const rugTex = useMemo(() => {
    const r = rugTexture(t.id);
    r.repeat.set(1, 1);
    return r;
  }, [t.id]);
  useEffect(
    () => () => {
      roadTex.dispose();
      rugTex.dispose();
      Object.values(geos).forEach((g) => g.dispose());
    },
    [geos, roadTex, rugTex],
  );
  const hasSoap = t.soap.some((v) => v === 1);
  return (
    <group>
      <mesh geometry={geos.road} receiveShadow>
        <meshStandardMaterial map={roadTex} roughness={0.75} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <mesh geometry={geos.under}>
        <meshStandardMaterial color="#334155" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geos.rugR} receiveShadow>
        <meshStandardMaterial map={rugTex} roughness={1} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={geos.rugL} receiveShadow>
        <meshStandardMaterial map={rugTex} roughness={1} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      {hasSoap && (
        <mesh geometry={geos.soap}>
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.45} roughness={0.05} metalness={0.2} depthWrite={false} polygonOffset polygonOffsetFactor={-3} />
        </mesh>
      )}
      <Fences t={t} quality={quality} />
      <StartArch t={t} />
      <BridgeSupports t={t} />
      {t.jumps.map((j, i) => (
        <JumpRamp key={i} t={t} s={j.s} />
      ))}
      {hasSoap && <SoapBubbles t={t} />}
      {t.obstacles.map((o, i) => (
        <group key={i} position={[o.x, t.y[Math.round(o.s / t.ds) % t.n], o.z]}>
          {o.kind === "bottle" ? (
            <group>
              <mesh position-y={0.7} castShadow={quality === "high"}>
                <cylinderGeometry args={[o.r * 0.85, o.r, 1.4, 16]} />
                <meshStandardMaterial color={i % 2 ? "#f9a8d4" : "#a5f3fc"} roughness={0.25} />
              </mesh>
              <mesh position-y={1.55}>
                <cylinderGeometry args={[o.r * 0.4, o.r * 0.5, 0.3, 12]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.3} />
              </mesh>
            </group>
          ) : (
            <group>
              {[0, 1, 2].map((k) => (
                <mesh key={k} position={[0, 0.3 + k * 0.55, 0]} rotation-y={k * 0.5} castShadow={quality === "high"}>
                  <boxGeometry args={[o.r * 1.5, 0.55, o.r * 1.5]} />
                  <meshStandardMaterial color={FENCE_COLORS[(i * 3 + k) % 6]} roughness={0.45} />
                </mesh>
              ))}
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

/** 블록 울타리 (러그 바깥) · 다리 위는 낮은 난간 */
function Fences({ t, quality }: { t: Track; quality: "high" | "low" }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: { x: number; y: number; z: number; ry: number; h: number; c: string }[] = [];
    const step = Math.max(1, Math.round(1.2 / t.ds));
    let k = 0;
    for (let i = 0; i < t.n; i += step) {
      const nx = -t.tz[i];
      const nz = t.tx[i];
      for (const side of [1, -1]) {
        const rug = side > 0 ? t.rugA[i] : t.rugB[i];
        const lat = side * (t.w[i] + rug + 0.28);
        const bridge = rug === 0;
        out.push({ x: t.x[i] + nx * lat, y: t.y[i] + (bridge ? 0.15 : 0.25), z: t.z[i] + nz * lat, ry: -Math.atan2(t.tz[i], t.tx[i]), h: bridge ? 0.3 : 0.5, c: FENCE_COLORS[k++ % FENCE_COLORS.length] });
      }
    }
    return out;
  }, [t]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(0, it.ry, 0);
      o.scale.set(1, it.h / 0.5, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(it.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow={quality === "high"} receiveShadow>
      <boxGeometry args={[1.05, 0.5, 0.45]} />
      <meshStandardMaterial roughness={0.45} />
    </instancedMesh>
  );
}

function StartArch({ t }: { t: Track }) {
  const checker = useMemo(
    () =>
      canvasTex(
        256,
        64,
        (g) => {
          for (let y = 0; y < 2; y++)
            for (let x = 0; x < 8; x++) {
              g.fillStyle = (x + y) % 2 ? "#111827" : "#f8fafc";
              g.fillRect(x * 32, y * 32, 32, 32);
            }
        },
        false,
      ),
    [],
  );
  const sign = useMemo(
    () =>
      canvasTex(
        512,
        128,
        (g) => {
          g.fillStyle = "#f97316";
          g.fillRect(0, 0, 512, 128);
          g.fillStyle = "#ffffff";
          g.font = "bold 72px sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText("🏁 출발 · 도착 🏁", 256, 68);
        },
        false,
      ),
    [],
  );
  useEffect(
    () => () => {
      checker.dispose();
      sign.dispose();
    },
    [checker, sign],
  );
  const p = pointAt(t, 0, 0);
  const W = t.w[0] + t.rugA[0] + 0.6;
  return (
    <group position={[p.x, p.y, p.z]} rotation-y={-p.h}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, 0]} rotation-z={Math.PI / 2}>
        <planeGeometry args={[t.w[0] * 2, 0.9]} />
        <meshBasicMaterial map={checker} />
      </mesh>
      {[W, -W].map((z) => (
        <mesh key={z} position={[0, 2, z]} castShadow>
          <boxGeometry args={[0.6, 4, 0.6]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 4.3, 0]} rotation-y={-Math.PI / 2}>
        <boxGeometry args={[W * 2 + 0.6, 1.1, 0.3]} />
        <meshStandardMaterial map={sign} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** 📚 책 다리 기둥 (아래 도로 위에는 세우지 않음) */
function BridgeSupports({ t }: { t: Track }) {
  const spots = useMemo(() => {
    const out: { x: number; z: number; y: number; ry: number }[] = [];
    const step = Math.max(1, Math.round(3.2 / t.ds));
    for (let i = 0; i < t.n; i += step) {
      if (t.y[i] < 0.5) continue;
      let clear = true;
      for (let j = 0; j < t.n && clear; j += 2) {
        if (t.y[j] > 0.3) continue;
        if (Math.hypot(t.x[j] - t.x[i], t.z[j] - t.z[i]) < t.w[j] + t.rugA[j] + 1.2) clear = false;
      }
      if (clear) out.push({ x: t.x[i], z: t.z[i], y: t.y[i], ry: -Math.atan2(t.tz[i], t.tx[i]) });
    }
    return out;
  }, [t]);
  return (
    <group>
      {spots.map((s, i) => {
        const books = Math.max(1, Math.round((s.y - 0.3) / 0.5));
        return (
          <group key={i} position={[s.x, 0, s.z]} rotation-y={s.ry}>
            {Array.from({ length: books }, (_, k) => (
              <mesh key={k} position={[0, 0.25 + k * 0.5, 0]} rotation-y={(k % 3) * 0.08 - 0.08}>
                <boxGeometry args={[1.6, 0.5, t.w[0] * 1.6]} />
                <meshStandardMaterial color={["#1d4ed8", "#b91c1c", "#15803d", "#a16207"][(i + k) % 4]} roughness={0.7} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function JumpRamp({ t, s }: { t: Track; s: number }) {
  const p = pointAt(t, s - 0.9, 0);
  const W = t.w[p.i];
  return (
    <group position={[p.x, p.y, p.z]} rotation-y={-p.h}>
      <mesh position={[0, 0.17, 0]} rotation-z={Math.atan2(0.3, 1.8)} castShadow>
        <boxGeometry args={[1.9, 0.18, W * 2]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.07, 0]}>
        <boxGeometry args={[1.8, 0.14, W * 2 - 0.1]} />
        <meshStandardMaterial color="#fef3c7" roughness={0.9} />
      </mesh>
    </group>
  );
}

function SoapBubbles({ t }: { t: Track }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: { x: number; z: number; y: number; r: number; ph: number }[] = [];
    for (let i = 0; i < t.n; i += 3) {
      if (!t.soap[i]) continue;
      for (let k = 0; k < 3; k++) {
        const lat = Math.sin(i * 12.9898 + k * 78.233) * t.w[i] * 0.9;
        const nx = -t.tz[i];
        const nz = t.tx[i];
        out.push({ x: t.x[i] + nx * lat, z: t.z[i] + nz * lat, y: t.y[i], r: 0.12 + ((i + k) % 4) * 0.05, ph: i * 0.7 + k });
      }
    }
    return out;
  }, [t]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const tt = clock.elapsedTime;
    spots.forEach((s, i) => {
      o.position.set(s.x, s.y + s.r + Math.abs(Math.sin(tt * 1.3 + s.ph)) * 0.12, s.z);
      o.scale.setScalar(s.r);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]}>
      <sphereGeometry args={[1, 12, 8]} />
      <meshStandardMaterial color="#e0f2fe" transparent opacity={0.55} roughness={0.05} metalness={0.4} depthWrite={false} />
    </instancedMesh>
  );
}

/** 🚂 기차 건널목: 도로를 가로지르는 철길 + 경고등 + 지나가는 기차 */
function TrainCrossing({ t, shared }: { t: Track; shared: MutableRefObject<SceneShared> }) {
  const train = useRef<THREE.Group>(null);
  const lights = useRef<THREE.MeshStandardMaterial[]>([]);
  if (!t.train) return null;
  const p = pointAt(t, t.train.s, 0);
  const span = 16;
  return (
    <group position={[p.x, p.y, p.z]} rotation-y={-p.h}>
      <TrainRig shared={shared} t={t} train={train} lights={lights} span={span} />
      {/* 철길 (도로를 가로질러 z 방향) */}
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 0.05, 0]}>
          <boxGeometry args={[0.1, 0.08, span * 2]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {Array.from({ length: 24 }, (_, k) => (
        <mesh key={k} position={[0, 0.025, -span + (k + 0.5) * ((span * 2) / 24)]}>
          <boxGeometry args={[1.3, 0.05, 0.25]} />
          <meshStandardMaterial color="#78350f" roughness={0.9} />
        </mesh>
      ))}
      {/* 경고등 기둥 (양쪽) */}
      {[t.w[p.i] + 2.4, -(t.w[p.i] + 2.4)].map((z, k) => (
        <group key={z} position={[-1.4, 0, z]}>
          <mesh position-y={1.3}>
            <cylinderGeometry args={[0.07, 0.07, 2.6, 8]} />
            <meshStandardMaterial color="#f8fafc" />
          </mesh>
          <mesh position={[0, 2.3, 0]} rotation-z={Math.PI / 4}>
            <boxGeometry args={[1.2, 0.18, 0.05]} />
            <meshStandardMaterial color="#f8fafc" />
          </mesh>
          {[-0.22, 0.22].map((dz, j) => (
            <mesh key={dz} position={[0.1, 1.9, dz]}>
              <sphereGeometry args={[0.13, 12, 8]} />
              <meshStandardMaterial
                ref={(m) => {
                  if (m) lights.current[k * 2 + j] = m;
                }}
                color="#7f1d1d"
                emissive="#ef4444"
                emissiveIntensity={0}
              />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={train} visible={false}>
        {[0, 1, 2].map((k) => (
          <group key={k} position={[0, 0, -k * 2.3]}>
            <mesh position-y={0.75} castShadow>
              <boxGeometry args={[1.2, 1.1, 2.1]} />
              <meshStandardMaterial color={k === 0 ? "#dc2626" : k === 1 ? "#2563eb" : "#16a34a"} roughness={0.4} />
            </mesh>
            {k === 0 && (
              <mesh position={[0, 1.55, 0.5]}>
                <cylinderGeometry args={[0.18, 0.18, 0.5, 10]} />
                <meshStandardMaterial color="#111827" />
              </mesh>
            )}
            {[-0.7, 0.7].map((dz) => (
              <mesh key={dz} position={[0, 0.2, dz]} rotation-z={Math.PI / 2}>
                <cylinderGeometry args={[0.22, 0.22, 1.3, 12]} />
                <meshStandardMaterial color="#111827" />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </group>
  );
}

function trainFrame(sh: SceneShared, t: Track, g: THREE.Group | null, lights: THREE.MeshStandardMaterial[], span: number, time: number) {
  const snap = sh.buf.latest();
  if (!snap || !t.train) return;
  const since = sh.buf.hostNow(performance.now()) - snap.goAt;
  const st = snap.phase === "race" ? trainState(t, since) : "clear";
  const on = st !== "clear" && Math.floor(time * 4) % 2 === 0;
  lights.forEach((m, i) => {
    if (m) m.emissiveIntensity = on ? (i % 2 ? 0 : 2.5) : st !== "clear" ? (i % 2 ? 2.5 : 0) : 0;
  });
  if (!g) return;
  const u = snap.phase === "race" ? trainProgress(t, since) : -1;
  g.visible = u >= 0;
  if (u >= 0) g.position.z = -span + 2.3 * 2 + u * (span * 2);
}

function TrainRig({ shared, t, train, lights, span }: { shared: MutableRefObject<SceneShared>; t: Track; train: MutableRefObject<THREE.Group | null>; lights: MutableRefObject<THREE.MeshStandardMaterial[]>; span: number }) {
  useFrame(({ clock }) => trainFrame(shared.current, t, train.current, lights.current, span, clock.elapsedTime));
  return null;
}

/* ── 상자 · 오리 · 털실 · 요요 · 장난감 벽 ───────────────────────────── */

function Boxes({ t, shared }: { t: Track; shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => boxesFrame(shared.current, t, group.current, clock.elapsedTime));
  return (
    <group ref={group}>
      {t.boxes.map((b, i) => (
        <group key={i} position={[b.x, t.y[Math.round(b.s / t.ds) % t.n] + 0.55, b.z]}>
          <mesh castShadow>
            <boxGeometry args={[BOX_R, BOX_R, BOX_R]} />
            <meshStandardMaterial color={FENCE_COLORS[i % 6]} roughness={0.35} emissive={FENCE_COLORS[i % 6]} emissiveIntensity={0.25} />
          </mesh>
          <mesh>
            <boxGeometry args={[BOX_R + 0.02, BOX_R + 0.02, 0.14]} />
            <meshStandardMaterial color="#fef08a" roughness={0.4} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.14, BOX_R + 0.02, BOX_R + 0.02]} />
            <meshStandardMaterial color="#fef08a" roughness={0.4} />
          </mesh>
          <mesh position-y={BOX_R / 2 + 0.08}>
            <torusGeometry args={[0.12, 0.04, 6, 12]} />
            <meshStandardMaterial color="#fef08a" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function boxesFrame(sh: SceneShared, t: Track, g: THREE.Group | null, time: number) {
  const snap = sh.buf.latest();
  if (!g || !snap) return;
  g.children.forEach((c, i) => {
    const b = snap.boxes[i];
    c.visible = !!b && b.back === 0;
    c.rotation.y = time * 1.6 + i;
    c.position.y = t.y[Math.round(t.boxes[i].s / t.ds) % t.n] + 0.55 + Math.sin(time * 3 + i) * 0.08;
  });
}

const duckBody = new THREE.SphereGeometry(0.32, 14, 10);
const duckHead = new THREE.SphereGeometry(0.2, 12, 10);
const beakGeo = new THREE.ConeGeometry(0.08, 0.18, 8);
const yarnGeo = new THREE.SphereGeometry(0.38, 14, 10);
const yarnRing = new THREE.TorusGeometry(0.38, 0.03, 6, 20);
const yoyoGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 18);
const blockGeo = new THREE.BoxGeometry(0.9, 0.7, 0.9);
const shadowRect = new THREE.PlaneGeometry(1, 1);

function Things({ t, shared }: { t: Track; shared: MutableRefObject<SceneShared> }) {
  const ducks = useRef<THREE.Group>(null);
  const balls = useRef<THREE.Group>(null);
  const walls = useRef<THREE.Group>(null);
  useFrame(({ clock }) => thingsFrame(shared.current, t, ducks.current, balls.current, walls.current, clock.elapsedTime));
  return (
    <group>
      <group ref={ducks}>
        {Array.from({ length: 8 }, (_, i) => (
          <group key={i} visible={false}>
            <mesh geometry={duckBody} position-y={0.28} scale={[1.2, 0.85, 1]}>
              <meshStandardMaterial color="#facc15" roughness={0.3} />
            </mesh>
            <mesh geometry={duckHead} position={[0.28, 0.6, 0]}>
              <meshStandardMaterial color="#facc15" roughness={0.3} />
            </mesh>
            <mesh geometry={beakGeo} position={[0.5, 0.57, 0]} rotation-z={-Math.PI / 2}>
              <meshStandardMaterial color="#f97316" />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={balls}>
        {Array.from({ length: 8 }, (_, i) => (
          <group key={i} visible={false}>
            <group name="yarn">
              <mesh geometry={yarnGeo}>
                <meshStandardMaterial color={ITEM_INFO.yarn.color} roughness={0.95} />
              </mesh>
              {[0, 1, 2].map((k) => (
                <mesh key={k} geometry={yarnRing} rotation={[k * 1.1, k * 0.7, 0]}>
                  <meshStandardMaterial color="#fbcfe8" roughness={1} />
                </mesh>
              ))}
            </group>
            <group name="yoyo">
              {[-0.09, 0.09].map((z) => (
                <mesh key={z} geometry={yoyoGeo} position-z={z} rotation-x={Math.PI / 2}>
                  <meshStandardMaterial color={ITEM_INFO.yoyo.color} emissive={ITEM_INFO.yoyo.color} emissiveIntensity={0.5} />
                </mesh>
              ))}
            </group>
          </group>
        ))}
      </group>
      <group ref={walls}>
        {Array.from({ length: 3 }, (_, i) => (
          <group key={i} visible={false}>
            <mesh name="shadow" geometry={shadowRect} rotation-x={-Math.PI / 2} position-y={0.05}>
              <meshBasicMaterial color="#7f1d1d" transparent opacity={0.35} depthWrite={false} />
            </mesh>
            <group name="blocks">
              {Array.from({ length: 10 }, (_, k) => (
                <mesh key={k} geometry={blockGeo} castShadow>
                  <meshStandardMaterial color={FENCE_COLORS[(k + i) % 6]} roughness={0.4} />
                </mesh>
              ))}
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

function thingsFrame(sh: SceneShared, t: Track, ducks: THREE.Group | null, balls: THREE.Group | null, walls: THREE.Group | null, time: number) {
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const hostT = sh.buf.hostNow(now);
  if (ducks) {
    const list = snap.ducks.filter((d) => !sh.driver.hitIds.has(d.id));
    ducks.children.forEach((c, i) => {
      const d = list[i];
      c.visible = !!d;
      if (d) {
        c.position.set(d.x, d.y + Math.abs(Math.sin(time * 4 + d.id)) * 0.05, d.z);
        c.rotation.y = d.id * 1.7 + Math.sin(time * 2 + d.id) * 0.3;
      }
    });
  }
  if (balls) {
    balls.children.forEach((c, i) => {
      const pj = snap.projectiles[i];
      c.visible = !!pj;
      if (!pj) return;
      const q = pj.kind === "yarn" ? sh.buf.ahead(pj.x, pj.z, pj.vx, pj.vz, now) : { x: pj.x, z: pj.z };
      c.position.set(q.x, pj.y + (pj.kind === "yarn" ? 0.38 : 0.2), q.z);
      const yarn = c.getObjectByName("yarn");
      const yoyo = c.getObjectByName("yoyo");
      if (yarn) {
        yarn.visible = pj.kind === "yarn";
        yarn.rotation.z = -time * 12;
        yarn.rotation.y = Math.atan2(-pj.vz, pj.vx);
      }
      if (yoyo) {
        yoyo.visible = pj.kind === "yoyo";
        yoyo.rotation.y = time * 14;
      }
    });
  }
  if (walls) {
    const list = snap.toys.filter((x) => !sh.driver.hitIds.has(x.id));
    walls.children.forEach((c, i) => {
      const toy = list[i];
      c.visible = !!toy;
      if (!toy) return;
      const p = pointAt(t, toy.s, 0);
      const half = (t.w[p.i] + (toy.side > 0 ? t.rugA[p.i] : t.rugB[p.i])) / 2;
      c.position.set(toy.x, toy.y, toy.z);
      c.rotation.y = -toy.h;
      const shadow = c.getObjectByName("shadow") as THREE.Mesh | undefined;
      const blocks = c.getObjectByName("blocks");
      const warn = hostT < toy.activeAt;
      if (shadow) {
        shadow.visible = true;
        shadow.scale.set(TOY_LEN + 0.4, half * 2 + 0.4, 1);
        const mat = shadow.material as THREE.MeshBasicMaterial;
        mat.opacity = warn ? 0.25 + 0.25 * Math.abs(Math.sin(time * 10)) : 0.2;
      }
      if (blocks) {
        const fall = warn ? -1 : Math.min(1, (hostT - toy.activeAt) / 260);
        blocks.visible = !warn;
        blocks.children.forEach((b, k) => {
          const col = k % 5;
          const row = Math.floor(k / 5);
          const z = -half + 0.45 + (col / 4) * (half * 2 - 0.9);
          b.position.set(0, 0.35 + row * 0.7 + (1 - fall) * 6 * (1 + k * 0.05), z);
          b.rotation.y = (k % 3) * 0.12;
        });
      }
    });
  }
}

/* ── 차 ─────────────────────────────────────────────────────────────── */

function CarSlot({ seat, names, shared, lowDetail }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<CarFrame>({ x: 0, y: 0, z: 0, h: 0, speed: 0, flags: 0, visible: false, shield: false, leader: false, steer: 0, finished: false });
  const lastH = useRef<{ h: number; at: number }>({ h: 0, at: 0 });
  const read = () => readCar(shared.current, seat, frame.current, lastH.current);
  return <ToyCar seat={seat} color={SEAT_COLORS[seat % 8]} look={look} lowDetail={lowDetail} read={read} />;
}

function readCar(sh: SceneShared, seat: number, f: CarFrame, last: { h: number; at: number }): CarFrame {
  const snap = sh.buf.latest();
  const p = snap?.players[seat];
  const now = performance.now();
  const q = p ? poseOf(sh, seat, now) : null;
  if (!snap || !p || !q) {
    f.visible = false;
    return f;
  }
  f.visible = true;
  f.x = q.x;
  f.y = q.y;
  f.z = q.z;
  f.h = q.h;
  f.speed = Math.hypot(q.vx, q.vz);
  f.flags = flagsOf(sh, seat);
  f.shield = snap.phase === "race" && sh.buf.hostNow(now) < p.shieldUntil;
  f.leader = snap.phase === "race" && p.rank === 1 && snap.seatCount > 1;
  f.finished = p.finishedAt > 0 || snap.phase === "gameOver";
  // 핸들 연출: 방향각 변화 속도
  const dt = Math.max(1, now - last.at);
  let dh = q.h - last.h;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  if (now - last.at < 200) f.steer = Math.max(-1, Math.min(1, (dh / dt) * 1000 * 0.45));
  last.h = q.h;
  last.at = now;
  return f;
}

/* ── 카메라 + 이름표 ─────────────────────────────────────────────── */

const v3 = new THREE.Vector3();
type Rig = { x: number; y: number; z: number; yaw: number; fov: number; init: boolean };

function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: Rig) {
  const dt = Math.min(dtRaw, 0.05);
  const snap = sh.buf.latest();
  const me = sh.driver.pose();
  if (!snap || !me) return;
  const fl = sh.driver.flags;
  // 차가 빙글 도는 동안엔 가는 방향(속도)을 따라간다
  const sp = Math.hypot(me.vx, me.vz);
  const want = fl & FL.spin && sp > 2 ? Math.atan2(me.vz, me.vx) : me.h;
  let d = want - st.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  st.yaw = st.init ? st.yaw + d * Math.min(1, dt * (fl & FL.drift ? 3.2 : 5)) : want;
  const far = sh.cam === "far";
  const back = far ? 7.2 : 4.4;
  const up = far ? 4 : 2.1;
  const tx = me.x - Math.cos(st.yaw) * back;
  const tz = me.z - Math.sin(st.yaw) * back;
  const ty = me.y + up;
  const k = st.init ? 1 - Math.exp(-dt * 9) : 1;
  st.init = true;
  st.x += (tx - st.x) * k;
  st.y += (ty - st.y) * k;
  st.z += (tz - st.z) * k;
  const persp = camera as THREE.PerspectiveCamera;
  const fovWant = (far ? 58 : 64) + (fl & FL.boost ? 8 : 0);
  st.fov += (fovWant - st.fov) * Math.min(1, dt * 4);
  if (Math.abs(persp.fov - st.fov) > 0.05) {
    persp.fov = st.fov;
    persp.updateProjectionMatrix();
  }
  const shake = sh.shake;
  sh.shake = Math.max(0, shake - dt * 2.5);
  const t = performance.now();
  const jx = shake > 0 ? (Math.sin(t * 0.09) + Math.sin(t * 0.23)) * 0.1 * shake : 0;
  const jy = shake > 0 ? Math.cos(t * 0.11) * 0.08 * shake : 0;
  camera.position.set(st.x + jx, st.y + jy, st.z);
  camera.lookAt(me.x + Math.cos(st.yaw) * 3.2, me.y + 0.7, me.z + Math.sin(st.yaw) * 3.2);
  // 이름표 (남의 차만, 45u 안)
  for (let seat = 0; seat < sh.labels.length; seat++) {
    const el = sh.labels[seat];
    if (!el) continue;
    const p = snap.players[seat];
    if (!p || seat === sh.mySeat) {
      el.style.display = "none";
      continue;
    }
    const q = sh.buf.car(seat, t);
    if (!q || Math.hypot(q.x - me.x, q.z - me.z) > 45) {
      el.style.display = "none";
      continue;
    }
    v3.set(q.x, q.y + 1.25, q.z).project(camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "";
    const x = (v3.x * 0.5 + 0.5) * size.width;
    const y = (-v3.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function CameraRig({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const st = useRef<Rig>({ x: 0, y: 5, z: 0, yaw: 0, fov: 64, init: false });
  useFrame(({ camera, size }, dt) => rigFrame(camera, size, dt, shared.current, st.current));
  return null;
}

function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames += 1;
    a.time += Math.min(dt, 0.5);
    if (a.time >= 2) {
      onFps?.(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

export default function RaceScene({ shared, names, seatCount, track, quality, fx, onFps }: RaceSceneProps) {
  const high = quality === "high";
  const t = trackFor(track);
  const R = Math.max(t.room.hx, t.room.hz);
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.4]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 64, position: [0, 6, 10], near: 0.1, far: 400 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#fef3c7"]} />
      <fog attach="fog" args={["#fef3c7", 70, 190]} />
      <hemisphereLight args={["#fff7ed", "#a8a29e", 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[R * 0.4, 50, -R * 0.6]}
        intensity={1.45}
        color="#fff4dc"
        castShadow={high}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-R}
        shadow-camera-right={R}
        shadow-camera-top={R}
        shadow-camera-bottom={-R}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0006}
      />
      <Room t={t} quality={quality} />
      <TrackMesh t={t} quality={quality} />
      <TrainCrossing t={t} shared={shared} />
      <Boxes t={t} shared={shared} />
      <Things t={t} shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <CarSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} />
      ))}
      <FxLayer items={fx} />
      <CameraRig shared={shared} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.4} />
    </Canvas>
  );
}

export { BRIDGE_H };
