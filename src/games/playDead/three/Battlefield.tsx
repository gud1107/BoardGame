"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 죽은척 대작전의 전장 — 해 질 녘 포연 속 진흙 들판. 포탄 구덩이, 모래주머니, 대전차 장애물,
 * 무너진 벽, 불타는 잔해, 곳곳에 쓰러진 병사들. 플레이어도 평소엔 이 시체들 사이에 엎드려 있어서
 * 누가 맞았는지, 누가 진짜 죽었는지 겉으로는 가려지지 않는다.
 *
 * 전부 정적인 로우폴리(모래주머니·시체는 인스턴싱), 움직이는 건 불꽃·연기·불씨·먼 섬광뿐.
 * 저사양이면 불빛 조명과 섬광을 끈다.
 */

/** 작은 결정론적 난수 (장면 배치가 모든 기기에서 같도록) */
function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 플레이어 위치: 나는 카메라 앞, 나머지는 들판 건너편에 불규칙하게 흩어진다(원형 테이블 아님).
 * 자리 번호가 아니라 "나를 기준으로 몇 번째"로 정하므로 누구 화면에서든 자기가 앞이다.
 */
export function fieldPos(seat: number, viewer: number, n: number): THREE.Vector3 {
  const k = (seat - viewer + n) % n;
  if (k === 0) return new THREE.Vector3(0, 0, 2.7);
  const others = n - 1;
  const t = others === 1 ? 0.5 : (k - 1) / (others - 1);
  const r = rand(9100 + n * 17 + k * 131);
  const x = (t - 0.5) * (2.6 + others * 1.25) + (r() - 0.5) * 0.7;
  const z = -0.6 - (k % 2) * 1.5 - Math.abs(t - 0.5) * -1.2 + (r() - 0.5) * 0.6;
  return new THREE.Vector3(x, 0, z);
}

export const FIELD_SPAN = 9;

function mudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#2c2520";
  ctx.fillRect(0, 0, 256, 256);
  const r = rand(77);
  for (let i = 0; i < 2600; i++) {
    const v = r();
    ctx.fillStyle = v < 0.4 ? "rgba(25,18,12,0.35)" : v < 0.75 ? "rgba(80,66,44,0.25)" : "rgba(60,70,40,0.22)";
    const s = 2 + r() * 9;
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 256, s, s * (0.4 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softDot(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** 쓰러진 병사 하나 (전장 소품 — 플레이어가 아니다) */
function Corpse({ pos, yaw, tone }: { pos: [number, number]; yaw: number; tone: string }) {
  return (
    <group position={[pos[0], 0, pos[1]]} rotation-y={yaw}>
      <mesh position={[0, 0.13, 0]} rotation-z={Math.PI / 2}>
        <capsuleGeometry args={[0.16, 0.55, 4, 8]} />
        <meshStandardMaterial color={tone} roughness={1} />
      </mesh>
      <mesh position={[0.62, 0.12, 0.02]}>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshStandardMaterial color="#6b5544" roughness={1} />
      </mesh>
      <mesh position={[0.66, 0.16, -0.12]} rotation-x={-0.6}>
        <sphereGeometry args={[0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#3d4a2e" roughness={0.8} />
      </mesh>
      {[-0.1, 0.1].map((z) => (
        <mesh key={z} position={[-0.62, 0.08, z * 1.6]} rotation-z={Math.PI / 2}>
          <capsuleGeometry args={[0.07, 0.5, 4, 6]} />
          <meshStandardMaterial color="#2b2a24" roughness={1} />
        </mesh>
      ))}
      <mesh position={[0.15, 0.08, 0.32]} rotation={[0, 0.6, Math.PI / 2]}>
        <capsuleGeometry args={[0.06, 0.45, 4, 6]} />
        <meshStandardMaterial color={tone} roughness={1} />
      </mesh>
    </group>
  );
}

/** 체코식 고슴도치(대전차 장애물) */
function Hedgehog({ pos, yaw }: { pos: [number, number]; yaw: number }) {
  return (
    <group position={[pos[0], 0.45, pos[1]]} rotation-y={yaw}>
      {[
        [0.6, 0, 0.6],
        [-0.6, 0.6, 0],
        [0, -0.6, 0.6],
      ].map((r, i) => (
        <mesh key={i} rotation={r as [number, number, number]}>
          <boxGeometry args={[0.09, 1.4, 0.09]} />
          <meshStandardMaterial color="#3c3a3a" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function SandbagWall({ x, z, yaw, count }: { x: number; z: number; yaw: number; count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const total = count * 2 - 1;
  useEffect(() => {
    {
      const m = ref.current;
      if (!m) return;
      const d = new THREE.Object3D();
      let i = 0;
      for (let row = 0; row < 2; row++) {
        for (let c = 0; c < count - row; c++) {
          d.position.set((c - (count - row - 1) / 2) * 0.62, 0.13 + row * 0.24, 0);
          // capsules lie on their side like filled sacks
          d.rotation.set(0, (c % 2) * 0.06, Math.PI / 2);
          d.scale.set(1, 1, 1);
          d.updateMatrix();
          m.setMatrixAt(i++, d.matrix);
        }
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }, [count]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, total]} position={[x, 0, z]} rotation-y={yaw}>
      <capsuleGeometry args={[0.13, 0.32, 3, 8]} />
      <meshStandardMaterial color="#8a7653" roughness={1} />
    </instancedMesh>
  );
}

/** 불타는 잔해: 흔들리는 불꽃 + (고사양) 불빛 + 피어오르는 연기 */
function Fire({ pos, lowDetail, i }: { pos: [number, number]; lowDetail: boolean; i: number }) {
  const flame = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = 1 + Math.sin(t * 13 + i * 2) * 0.12 + Math.sin(t * 7.7 + i) * 0.08;
    if (flame.current) flame.current.scale.set(1, f, 1);
    if (light.current) light.current.intensity = 14 * f;
  });
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <mesh position-y={0.15} rotation={[0.3, i, 0.2]}>
        <boxGeometry args={[0.9, 0.3, 0.5]} />
        <meshStandardMaterial color="#1c1714" roughness={1} />
      </mesh>
      <mesh ref={flame} position-y={0.55}>
        <coneGeometry args={[0.28, 0.9, 8]} />
        <meshBasicMaterial color="#ff8a2a" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh position-y={0.42}>
        <coneGeometry args={[0.18, 0.55, 8]} />
        <meshBasicMaterial color="#ffd27a" toneMapped={false} />
      </mesh>
      {!lowDetail && <pointLight ref={light} position-y={0.9} color="#ff7a30" intensity={14} distance={7} decay={2} />}
    </group>
  );
}

/** 연기 기둥과 불씨 — 스프라이트 몇 개를 위로 흘려 보내며 재활용 */
function SmokeAndEmbers({ sources, lowDetail }: { sources: [number, number][]; lowDetail: boolean }) {
  const dot = useMemo(() => softDot(), []);
  const puffs = lowDetail ? 2 : 4;
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const embers = useRef<THREE.Points>(null);
  const emberGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = lowDetail ? 30 : 80;
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  }, [lowDetail]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    sprites.current.forEach((s, idx) => {
      if (!s) return;
      const src = sources[Math.floor(idx / puffs) % sources.length];
      const life = (t * 0.18 + (idx % puffs) / puffs) % 1;
      s.position.set(src[0] + Math.sin(t * 0.3 + idx) * 0.3 + life * 0.8, 0.8 + life * 4.5, src[1] - life * 0.5);
      const k = 0.9 + life * 3.2;
      s.scale.set(k, k, 1);
      (s.material as THREE.SpriteMaterial).opacity = 0.32 * Math.sin(life * Math.PI);
    });
    const pos = emberGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const src = sources[i % sources.length];
      const life = (t * (0.25 + (i % 7) * 0.04) + i * 0.137) % 1;
      pos.setXYZ(i, src[0] + Math.sin(i * 12.9 + t) * 0.6 * life, 0.4 + life * 3.5, src[1] + Math.cos(i * 7.3) * 0.5 * life);
    }
    pos.needsUpdate = true;
  });
  return (
    <>
      {Array.from({ length: sources.length * puffs }, (_, i) => (
        <sprite key={i} ref={(s) => void (sprites.current[i] = s)}>
          <spriteMaterial map={dot} color="#4a403a" transparent depthWrite={false} opacity={0.3} />
        </sprite>
      ))}
      <points ref={embers} geometry={emberGeo}>
        <pointsMaterial map={dot} color="#ffb060" size={0.09} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </points>
    </>
  );
}

/** 지평선 너머 포격 섬광 */
function DistantShelling() {
  const light = useRef<THREE.PointLight>(null);
  const flash = useRef<THREE.Mesh>(null);
  const next = useRef({ at: 2, x: 0 });
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t > next.current.at + 0.6) next.current = { at: t + 2.5 + Math.random() * 4, x: (Math.random() - 0.5) * 26 };
    const e = t - next.current.at;
    const k = e >= 0 && e < 0.6 ? Math.exp(-e * 7) : 0;
    if (light.current) {
      light.current.intensity = 260 * k;
      light.current.position.x = next.current.x;
    }
    if (flash.current) {
      flash.current.visible = k > 0.02;
      flash.current.position.x = next.current.x;
      flash.current.scale.setScalar(1 + (1 - k) * 2);
      (flash.current.material as THREE.MeshBasicMaterial).opacity = k;
    }
  });
  return (
    <>
      <pointLight ref={light} position={[0, 4, -22]} color="#ffb070" intensity={0} distance={60} decay={1.2} />
      <mesh ref={flash} position={[0, 1.5, -26]}>
        <sphereGeometry args={[1.6, 12, 8]} />
        <meshBasicMaterial color="#ffc488" transparent opacity={0} fog={false} toneMapped={false} />
      </mesh>
    </>
  );
}

export default function Battlefield({ n, lowDetail, avoid }: { n: number; lowDetail: boolean; avoid: THREE.Vector3[] }) {
  const mud = useMemo(() => mudTexture(), []);
  // 소품이 플레이어 자리와 겹치지 않게 배치
  const props = useMemo(() => {
    const r = rand(4242 + n);
    const free = (x: number, z: number, d: number) => avoid.every((p) => Math.hypot(p.x - x, p.z - z) > d);
    const pick = (count: number, d: number, zMin: number, zMax: number, span: number) => {
      const out: [number, number][] = [];
      for (let tries = 0; out.length < count && tries < 400; tries++) {
        const x = (r() - 0.5) * span;
        const z = zMin + r() * (zMax - zMin);
        if (free(x, z, d) && out.every((o) => Math.hypot(o[0] - x, o[1] - z) > d)) out.push([x, z]);
      }
      return out;
    };
    return {
      corpses: pick(lowDetail ? 6 : 10, 1.1, -5, 3.2, 12).map((p) => ({ p, yaw: r() * Math.PI * 2, tone: r() < 0.5 ? "#4b5233" : "#5a4a35" })),
      craters: pick(6, 1.6, -6, 2.5, 13).map((p) => ({ p, s: 0.55 + r() * 0.5 })),
      hedgehogs: pick(4, 1.4, -6, 1, 13).map((p) => ({ p, yaw: r() * 3 })),
      fires: pick(lowDetail ? 2 : 3, 2, -5.5, -1, 12),
    };
  }, [n, lowDetail, avoid]);

  return (
    <>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[70, 70]} />
        <meshStandardMaterial map={mud} roughness={1} />
      </mesh>
      {props.craters.map(({ p, s }, i) => (
        <group key={`c${i}`} position={[p[0], 0.01, p[1]]} scale={s}>
          <mesh rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.7, 20]} />
            <meshStandardMaterial color="#1d1610" roughness={1} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
            <ringGeometry args={[0.7, 1.05, 20]} />
            <meshStandardMaterial color="#463a2e" roughness={1} />
          </mesh>
        </group>
      ))}
      <SandbagWall x={-3.4} z={0.9} yaw={0.35} count={5} />
      <SandbagWall x={3.6} z={1.1} yaw={-0.4} count={5} />
      <SandbagWall x={0.2} z={-4.4} yaw={0.05} count={7} />
      {props.hedgehogs.map(({ p, yaw }, i) => (
        <Hedgehog key={`h${i}`} pos={p} yaw={yaw} />
      ))}
      {/* 무너진 벽 */}
      {[
        [-6.5, -6.5, 2.4, 0.2],
        [5.8, -7.2, 1.6, -0.3],
        [-1.5, -9.5, 3.0, 0.05],
      ].map(([x, z, h, yaw], i) => (
        <group key={`w${i}`} position={[x, 0, z]} rotation-y={yaw}>
          <mesh position={[0, h / 2, 0]}>
            <boxGeometry args={[2.4, h, 0.35]} />
            <meshStandardMaterial color="#5e5650" roughness={1} />
          </mesh>
          <mesh position={[0.7, h + 0.25, 0]} rotation-z={0.5}>
            <boxGeometry args={[0.9, 0.6, 0.35]} />
            <meshStandardMaterial color="#5e5650" roughness={1} />
          </mesh>
        </group>
      ))}
      {props.corpses.map(({ p, yaw, tone }, i) => (
        <Corpse key={`d${i}`} pos={p} yaw={yaw} tone={tone} />
      ))}
      {props.fires.map((p, i) => (
        <Fire key={`f${i}`} pos={p} lowDetail={lowDetail} i={i} />
      ))}
      <SmokeAndEmbers sources={props.fires} lowDetail={lowDetail} />
      {!lowDetail && <DistantShelling />}
    </>
  );
}
