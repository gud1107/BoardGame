"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { CRACK_1, CRACK_2, ITEM_INFO, SEAT_COLORS, SINK_GONE_Y, THAW_WARN_MS, WATER_Y } from "../data";
import { HEX, lakeGeo, sectorAngle, sectorSpan, tileIndexAt } from "../lake";
import type { SnapBuffer } from "../net";
import type { MatchState, PlayerState } from "../sim";
import { FxLayer, sectorPoint, type FxItem } from "./Fx";
import Skater, { type SkaterFrame, type SkaterMode } from "./Skater";

/**
 * 살얼음 파티 3D 무대 (룰북 §11): 달밤의 얼어붙은 호수. 육각 얼음 칸(인스턴스) + 금 무늬 두 단계,
 * 해빙 경보 구역(주황 부채꼴 + 칸 깜빡임 + 구역 번호 강조), 서든데스 흔들림, 출렁이는 물, 눈 덮인 둔치와
 * 전나무, 눈송이, 아이템, VRM 캐릭터, 유령, 연출, 따라가는 카메라.
 * 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 계산해 옮긴다.
 */

export interface SceneShared {
  buf: SnapBuffer;
  mySeat: number;
  /** 화면 흔들림 세기 (0~1, 보드가 올리고 여기서 줄인다) */
  shake: number;
  /** 이름표 DOM (자리 순서) */
  labels: (HTMLDivElement | null)[];
  /** 유령이 고른 구역 (화면 표시용, 보드가 채움) */
  votes: number[];
}

export interface LakeSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  quality: "high" | "low";
  fx: FxItem[];
  onFps?: (fps: number) => void;
}

/* ── 하늘 ───────────────────────────────────────────────────────────── */

function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#050b1f");
  grad.addColorStop(0.42, "#13254a");
  grad.addColorStop(0.58, "#3b5f8f");
  grad.addColorStop(0.7, "#8fb4d9");
  grad.addColorStop(1, "#dbe9f6");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Sky({ quality }: { quality: "high" | "low" }) {
  const tex = useMemo(() => skyTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const stars = useMemo(() => {
    const n = quality === "high" ? 700 : 250;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i * 2.399963) % (Math.PI * 2);
      const h = 0.25 + ((i * 0.618034) % 1) * 0.72;
      const r = 120;
      pos[i * 3] = Math.cos(a) * Math.sqrt(1 - h * h) * r;
      pos[i * 3 + 1] = h * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.sqrt(1 - h * h) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [quality]);
  useEffect(() => () => stars.dispose(), [stars]);
  return (
    <group>
      <mesh>
        <sphereGeometry args={[140, 24, 16]} />
        <meshBasicMaterial map={tex} side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>
      <points geometry={stars}>
        <pointsMaterial color="#ffffff" size={0.5} sizeAttenuation fog={false} transparent opacity={0.85} />
      </points>
      {/* 달 */}
      <mesh position={[-40, 52, -70]}>
        <sphereGeometry args={[5, 24, 16]} />
        <meshBasicMaterial color="#fff9e6" fog={false} />
      </mesh>
      <mesh position={[-40, 52, -70.5]}>
        <sphereGeometry args={[8, 24, 16]} />
        <meshBasicMaterial color="#fff3c4" transparent opacity={0.12} fog={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ── 둔치·나무·눈 ──────────────────────────────────────────────────── */

function Shore({ rings, quality }: { rings: number; quality: "high" | "low" }) {
  const R = lakeGeo(rings).radius;
  const trees = useMemo(() => {
    const n = quality === "high" ? 46 : 22;
    return Array.from({ length: n }, (_, i) => {
      const a = i * 2.399963 + 0.3;
      const r = R + 5 + ((i * 37) % 17) * 0.9;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 1.2 + ((i * 7) % 5) * 0.35 };
    });
  }, [R, quality]);
  return (
    <group>
      {/* 호수 둘레 눈 덮인 둔치 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[R + 1.6, R + 60, 64, 1]} />
        <meshStandardMaterial color="#eef5fb" roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[R + 0.6, R + 1.7, 64, 1]} />
        <meshStandardMaterial color="#cfe0ee" roughness={0.9} />
      </mesh>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={t.s}>
          <mesh position-y={0.4}>
            <cylinderGeometry args={[0.12, 0.16, 0.8, 6]} />
            <meshStandardMaterial color="#5b3a24" roughness={1} />
          </mesh>
          {[0, 1, 2].map((k) => (
            <mesh key={k} position-y={1.1 + k * 0.75} castShadow={quality === "high"}>
              <coneGeometry args={[1.05 - k * 0.28, 1.25, 8]} />
              <meshStandardMaterial color={k === 2 ? "#f1f7fb" : "#1f5a45"} roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Snowfall({ rings }: { rings: number }) {
  const R = lakeGeo(rings).radius + 6;
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (((i * 0.6180339) % 1) * 2 - 1) * R;
      pos[i * 3 + 1] = ((i * 0.7548776) % 1) * 18;
      pos[i * 3 + 2] = (((i * 0.5698403) % 1) * 2 - 1) * R;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [R]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dtRaw) => {
    const p = ref.current;
    if (!p) return;
    const dt = Math.min(dtRaw, 0.05);
    const a = (p.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] -= dt * (0.8 + ((i * 13) % 7) * 0.08);
      a[i] += Math.sin(a[i + 1] * 0.7 + i) * dt * 0.15;
      if (a[i + 1] < 0) a[i + 1] += 18;
    }
    p.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#ffffff" size={0.09} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}

/* ── 물 ─────────────────────────────────────────────────────────────── */

function Water({ rings }: { rings: number }) {
  const R = lakeGeo(rings).radius + 2;
  const ref = useRef<THREE.Mesh>(null);
  const { geo, base } = useMemo(() => {
    const fine = new THREE.PlaneGeometry(R * 2, R * 2, 40, 40);
    fine.rotateX(-Math.PI / 2);
    return { geo: fine, base: Float32Array.from(fine.attributes.position.array as Float32Array) };
  }, [R]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const a = (m.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      a[i + 1] = Math.sin(x * 0.55 + t * 1.2) * 0.05 + Math.cos(z * 0.7 + t * 1.6) * 0.04;
    }
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.computeVertexNormals();
  });
  return (
    <mesh ref={ref} geometry={geo} position-y={WATER_Y}>
      <meshStandardMaterial color="#0d3a5c" roughness={0.55} metalness={0.1} flatShading />
    </mesh>
  );
}

/* ── 얼음 칸 ───────────────────────────────────────────────────────── */

const ICE_H = 0.3;
const ICE_FULL = new THREE.Color("#eaf6ff");
const ICE_MID = new THREE.Color("#a9d4ef");
const ICE_LOW = new THREE.Color("#5b8fba");
const ICE_CORE = new THREE.Color("#fdfaf0");
const SUN = new THREE.Color("#ffad5c");
const DOOM = new THREE.Color("#d9465b");

function crackTexture(level: 1 | 2): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  let seed = level * 9301 + 49297;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  g.strokeStyle = level === 1 ? "rgba(30,64,105,0.7)" : "rgba(15,35,65,0.9)";
  g.lineCap = "round";
  const branches = level === 1 ? 4 : 9;
  for (let b = 0; b < branches; b++) {
    let x = 128 + (rnd() - 0.5) * 30;
    let y = 128 + (rnd() - 0.5) * 30;
    let a = rnd() * Math.PI * 2;
    g.lineWidth = level === 1 ? 3 : 4;
    g.beginPath();
    g.moveTo(x, y);
    const steps = level === 1 ? 4 : 6;
    for (let k = 0; k < steps; k++) {
      x += Math.cos(a) * (14 + rnd() * 10);
      y += Math.sin(a) * (14 + rnd() * 10);
      a += (rnd() - 0.5) * 1.2;
      g.lineTo(x, y);
      g.lineWidth = Math.max(1, g.lineWidth - 0.4);
    }
    g.stroke();
  }
  if (level === 2) {
    // 가운데 움푹 깨진 자국
    g.fillStyle = "rgba(20,45,80,0.35)";
    g.beginPath();
    g.arc(128, 128, 26, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Ice({ shared, rings }: { shared: MutableRefObject<SceneShared>; rings: number }) {
  const geo = lakeGeo(rings);
  const n = geo.tiles.length;
  const top = useRef<THREE.InstancedMesh>(null);
  const crack1 = useRef<THREE.InstancedMesh>(null);
  const crack2 = useRef<THREE.InstancedMesh>(null);
  const topGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(HEX * 0.965, HEX * 0.9, ICE_H, 6);
    g.translate(0, -ICE_H / 2, 0);
    return g;
  }, []);
  const decalGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(HEX * 1.7, HEX * 1.7);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.006, 0);
    return g;
  }, []);
  const tex1 = useMemo(() => crackTexture(1), []);
  const tex2 = useMemo(() => crackTexture(2), []);
  useEffect(
    () => () => {
      topGeo.dispose();
      decalGeo.dispose();
      tex1.dispose();
      tex2.dispose();
    },
    [topGeo, decalGeo, tex1, tex2],
  );
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const zero = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);
  useEffect(() => {
    const t = top.current;
    if (!t) return;
    for (let i = 0; i < n; i++) t.setColorAt(i, ICE_FULL);
  }, [n]);
  useFrame(() => {
    const t = top.current;
    const c1 = crack1.current;
    const c2 = crack2.current;
    const snap = shared.current.buf.latest();
    if (!t || !c1 || !c2 || !snap || snap.rings !== rings) return;
    const now = shared.current.buf.simNow(performance.now());
    const warned = snap.thaw?.sector ?? -1;
    const warnLeft = snap.thaw ? Math.max(0, (snap.thaw.at - now) / THAW_WARN_MS) : 0;
    for (let i = 0; i < n; i++) {
      const tile = geo.tiles[i];
      const hp = snap.hp[i] ?? 1;
      const br = snap.broke[i] ?? 0;
      const dm = snap.doom[i] ?? 0;
      let y = 0;
      let rx = 0;
      let rz = 0;
      let s = 1;
      // 금 갈수록 살짝 가라앉고 색이 짙어진다
      if (hp > 0.5) col.copy(ICE_MID).lerp(ICE_FULL, (hp - 0.5) * 2);
      else col.copy(ICE_LOW).lerp(ICE_MID, hp * 2);
      if (tile.ring === 0) col.lerp(ICE_CORE, 0.4 * hp);
      y -= (1 - hp) * 0.06;
      if (br > 0) {
        const u = (now - br) / 1000;
        if (u > 2.2) s = 0;
        y -= Math.min(2.5, 0.5 * 9 * u * u);
        rx = u * 1.2 * (i % 2 ? 1 : -1);
        rz = u * 0.7;
        col.lerp(ICE_LOW, 0.6);
      } else {
        if (tile.sector === warned && warned >= 0) {
          const blink = 0.5 + 0.5 * Math.sin(now * (0.012 + (1 - warnLeft) * 0.025));
          col.lerp(SUN, 0.25 + blink * 0.4);
        }
        if (dm > 0) {
          const left = Math.max(0, (dm - now) / 1800);
          const sh = (1 - left) * 0.06 + 0.02;
          rx = Math.sin(now * 0.05 + i) * sh;
          rz = Math.cos(now * 0.047 + i * 1.3) * sh;
          col.lerp(DOOM, 0.3 + 0.3 * (1 - left));
        } else if (hp < CRACK_2) {
          // 2단계 금: 살살 떨린다
          rx = Math.sin(now * 0.04 + i) * 0.012;
          rz = Math.cos(now * 0.043 + i) * 0.012;
        }
      }
      q.setFromEuler(e.set(rx, 0, rz));
      pos.set(tile.x, y, tile.z);
      scl.setScalar(s);
      m.compose(pos, q, scl);
      t.setMatrixAt(i, m);
      t.setColorAt(i, col);
      // 금 무늬 (색만으로 알리지 않음 — 1단계 가는 금, 2단계 굵은 금+움푹)
      q.setFromEuler(e.set(rx, i * 1.7, rz));
      m.compose(pos, q, scl);
      c1.setMatrixAt(i, br === 0 && hp < CRACK_1 && hp >= CRACK_2 ? m : zero);
      c2.setMatrixAt(i, br === 0 && hp < CRACK_2 ? m : zero);
    }
    t.instanceMatrix.needsUpdate = true;
    c1.instanceMatrix.needsUpdate = true;
    c2.instanceMatrix.needsUpdate = true;
    if (t.instanceColor) t.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh key={`t${n}`} ref={top} args={[topGeo, undefined, n]} receiveShadow castShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.42} metalness={0.02} transparent opacity={0.95} />
      </instancedMesh>
      <instancedMesh key={`c1${n}`} ref={crack1} args={[decalGeo, undefined, n]} frustumCulled={false}>
        <meshBasicMaterial map={tex1} transparent depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`c2${n}`} ref={crack2} args={[decalGeo, undefined, n]} frustumCulled={false}>
        <meshBasicMaterial map={tex2} transparent depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

/* ── 구역 표시 · 해빙 경보 ─────────────────────────────────────────── */

const labelCache = new Map<string, THREE.Texture>();
function numberTexture(n: number, hot: boolean): THREE.Texture {
  const key = `${n}${hot ? "h" : ""}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = hot ? "rgba(255,150,60,0.95)" : "rgba(12,30,52,0.82)";
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = hot ? "#fff7ed" : "#9cc9e8";
  g.stroke();
  g.fillStyle = hot ? "#1f1300" : "#eaf6ff";
  g.font = "bold 72px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, t);
  return t;
}

function Sectors({ shared, rings }: { shared: MutableRefObject<SceneShared>; rings: number }) {
  const R = lakeGeo(rings).radius;
  const wedges = useRef<THREE.Group>(null);
  const labels = useRef<THREE.Group>(null);
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) {
      const [a] = sectorSpan(k);
      pts.push(Math.cos(a) * HEX * 0.9, 0.012, Math.sin(a) * HEX * 0.9, Math.cos(a) * (R - 0.2), 0.012, Math.sin(a) * (R - 0.2));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [R]);
  const wedgeGeos = useMemo(
    () =>
      Array.from({ length: 6 }, (_, k) => {
        const [a0, a1] = sectorSpan(k);
        const g = new THREE.CircleGeometry(R - 0.3, 16, -a1, a1 - a0);
        g.rotateX(-Math.PI / 2);
        return g;
      }),
    [R],
  );
  useEffect(
    () => () => {
      lines.dispose();
      wedgeGeos.forEach((g) => g.dispose());
    },
    [lines, wedgeGeos],
  );
  useFrame(({ clock }) => {
    const snap = shared.current.buf.latest();
    if (!snap) return;
    const now = shared.current.buf.simNow(performance.now());
    const warned = snap.thaw?.sector ?? -1;
    const left = snap.thaw ? Math.max(0, (snap.thaw.at - now) / THAW_WARN_MS) : 0;
    const t = clock.elapsedTime;
    wedges.current?.children.forEach((c, k) => {
      c.visible = k === warned;
      if (c.visible) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(t * (6 + (1 - left) * 10)));
    });
    labels.current?.children.forEach((c, k) => {
      const sp = c as THREE.Sprite;
      const mat = sp.material as THREE.SpriteMaterial;
      const want = numberTexture(k + 1, k === warned);
      if (mat.map !== want) {
        mat.map = want;
        mat.needsUpdate = true;
      }
      const v = shared.current.votes;
      const s = k === warned ? 1.5 + Math.sin(t * 8) * 0.1 : v.includes(k) ? 1.25 : 1.05;
      sp.scale.set(s, s, 1);
    });
  });
  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#9cc9e8" transparent opacity={0.35} />
      </lineSegments>
      <group ref={wedges}>
        {wedgeGeos.map((g, k) => (
          <mesh key={k} geometry={g} position-y={0.03} visible={false}>
            <meshBasicMaterial color="#ff9a3c" transparent opacity={0.16} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <group ref={labels}>
        {Array.from({ length: 6 }, (_, k) => {
          const a = sectorAngle(k);
          return (
            <sprite key={k} position={[Math.cos(a) * (R + 1.2), 0.9, Math.sin(a) * (R + 1.2)]} scale={[1.05, 1.05, 1]}>
              <spriteMaterial map={numberTexture(k + 1, false)} transparent depthWrite={false} />
            </sprite>
          );
        })}
      </group>
    </group>
  );
}

/* ── 아이템 ─────────────────────────────────────────────────────────── */

const emojiCache = new Map<string, THREE.Texture>();
function emojiTexture(emoji: string): THREE.Texture {
  const hit = emojiCache.get(emoji);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "96px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(emoji, t);
  return t;
}

function Items({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  const textures = useMemo(() => Object.fromEntries(Object.entries(ITEM_INFO).map(([k, v]) => [k, emojiTexture(v.emoji)])), []);
  useFrame(({ clock }) => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    const t = clock.elapsedTime;
    g.children.forEach((c, i) => {
      const it = snap.items[i];
      if (!it) {
        c.visible = false;
        return;
      }
      c.visible = true;
      c.position.set(it.x, 0, it.z);
      const sprite = c.children[0] as THREE.Sprite;
      const ring = c.children[1] as THREE.Mesh;
      sprite.position.y = 0.7 + Math.sin(t * 3 + i) * 0.1;
      const mat = sprite.material as THREE.SpriteMaterial;
      const tex = textures[it.kind];
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const left = it.until - snap.t;
      mat.opacity = left < 3000 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 8)) : 1;
      ring.rotation.z = t * 1.5;
      ((ring.material as THREE.MeshBasicMaterial).color as THREE.Color).set(ITEM_INFO[it.kind].color);
    });
  });
  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <group key={i} visible={false}>
          <sprite scale={[0.8, 0.8, 0.8]}>
            <spriteMaterial transparent depthWrite={false} />
          </sprite>
          <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
            <ringGeometry args={[0.42, 0.56, 6]} />
            <meshBasicMaterial transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── 캐릭터 ─────────────────────────────────────────────────────────── */

export function modeOf(snap: MatchState, p: PlayerState): SkaterMode {
  if (p.falling || (!p.alive && p.y < 0)) return "fall";
  if (snap.phase === "gameOver") return snap.ranks?.[p.seat] === 1 ? "cheer" : "sad";
  if (snap.phase === "roundEnd" && p.alive) return snap.history[snap.history.length - 1]?.winner === p.seat ? "cheer" : "idle";
  if (p.air === "stagger") return "stagger";
  if (p.air === "stomp") return p.slamAt > 0 ? "slam" : "rise";
  if (p.air === "jump") return "jump";
  return Math.hypot(p.vx, p.vz) > 0.6 ? "run" : "idle";
}

function SkaterSlot({ seat, names, shared, lowDetail }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<SkaterFrame>({ x: 0, y: 0, z: 0, face: 0, mode: "idle", speed: 0, visible: false, spikes: false, wobble: 0 });
  const slamHold = useRef(0);
  const read = () => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    const p = snap?.players[seat];
    const f = frame.current;
    if (!snap || !p) {
      f.visible = false;
      return f;
    }
    const now = performance.now();
    const pose = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
    if (!pose) {
      f.visible = false;
      return f;
    }
    f.visible = p.alive || (p.falling && pose.y > SINK_GONE_Y + 0.4) || snap.phase === "gameOver";
    if (snap.phase === "gameOver" && !p.alive) {
      // 끝나면 모두 얼음 위로 (가운데 둘레에 모여 결과 표정)
      const a = (seat / snap.seatCount) * Math.PI * 2;
      f.x = Math.cos(a) * 2.2;
      f.z = Math.sin(a) * 2.2;
      f.y = 0;
      f.face = a + Math.PI;
    } else {
      f.x = pose.x;
      f.y = pose.y;
      f.z = pose.z;
      f.face = pose.face;
    }
    let mode = modeOf(snap, p);
    if (snap.phase === "gameOver" && !p.alive) mode = snap.ranks?.[seat] === 1 ? "cheer" : "sad";
    // 내려꽂는 순간이 스냅샷 사이에 끼어 안 보일 수 있어 잠깐 붙잡아 둔다
    if (mode === "slam") slamHold.current = now + 220;
    else if (now < slamHold.current && mode !== "fall") mode = "slam";
    f.mode = mode;
    f.speed = Math.min(1, Math.hypot(p.vx, p.vz) / 4.6);
    f.spikes = p.alive && snap.t < p.spikesUntil;
    const ti = p.alive ? tileIndexAt(lakeGeo(snap.rings), f.x, f.z) : -1;
    const hp = ti >= 0 ? snap.hp[ti] : 1;
    f.wobble = p.alive && snap.phase === "fight" && hp < CRACK_2 ? Math.min(1, (CRACK_2 - hp) / CRACK_2 + 0.4) : 0;
    return f;
  };
  return <Skater look={look} seed={seat * 13 + 3} color={SEAT_COLORS[seat % 6]} lowDetail={lowDetail} read={read} />;
}

/** 빠진 사람 = 유령 (반투명 몸 + 눈) — 고른 구역 위에 떠서 기다린다 */
function Ghosts({ shared, seatCount }: { shared: MutableRefObject<SceneShared>; seatCount: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }, dtRaw) => {
    const g = group.current;
    const sh = shared.current;
    const snap = sh.buf.latest();
    if (!g || !snap) return;
    const dt = Math.min(dtRaw, 0.05);
    g.children.forEach((c, seat) => {
      const p = snap.players[seat];
      const on = !!p && !p.alive && p.ghost && snap.phase === "fight" && !p.falling;
      if (!on) {
        c.visible = false;
        c.userData.init = false;
        return;
      }
      const vote = sh.votes[seat] ?? -1;
      const tgt = vote >= 0 ? sectorPoint(vote, snap.rings, 0.45 + (seat % 3) * 0.12) : { x: p.x, z: p.z };
      if (!c.userData.init) {
        c.position.set(p.x, 2, p.z);
        c.userData.init = true;
      }
      const k = 1 - Math.exp(-dt * 1.6);
      c.position.x += (tgt.x - c.position.x) * k;
      c.position.z += (tgt.z - c.position.z) * k;
      c.position.y = 2.2 + Math.sin(clock.elapsedTime * 2.2 + seat) * 0.18;
      c.rotation.y = Math.atan2(-c.position.x, -c.position.z) + Math.PI;
      c.visible = true;
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: seatCount }, (_, seat) => (
        <group key={seat} visible={false}>
          <mesh scale={[0.5, 0.58, 0.5]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color={SEAT_COLORS[seat % 6]} transparent opacity={0.55} emissive={SEAT_COLORS[seat % 6]} emissiveIntensity={0.4} depthWrite={false} />
          </mesh>
          <mesh position={[0, -0.5, -0.12]} rotation-x={0.4} scale={[0.36, 0.55, 0.36]}>
            <coneGeometry args={[1, 1, 12, 1, true]} />
            <meshStandardMaterial color={SEAT_COLORS[seat % 6]} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {[-0.16, 0.16].map((ex) => (
            <mesh key={ex} position={[ex, 0.1, 0.43]}>
              <sphereGeometry args={[0.08, 8, 6]} />
              <meshBasicMaterial color="#111827" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ── 카메라 + 이름표 ─────────────────────────────────────────────── */

const v3 = new THREE.Vector3();

function decayShake(sh: SceneShared, dt: number): number {
  const v = sh.shake;
  sh.shake = Math.max(0, v - dt * 2.5);
  return v;
}

type RigState = { cx: number; cz: number; ext: number; init: boolean };

/** 카메라 따라가기 + 이름표 옮기기 (매 프레임). 공유 객체·DOM을 고치므로 컴포넌트 밖 함수로 둔다. */
function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: RigState) {
  const dt = Math.min(dtRaw, 0.05);
  const snap = sh.buf.latest();
  if (!snap) return;
  const geo = lakeGeo(snap.rings);
  const now = performance.now();
  let tx = 0;
  let tz = 0;
  let tn = 0;
  for (let i = 0; i < geo.tiles.length; i++) {
    if (snap.broke[i] !== 0) continue;
    tx += geo.tiles[i].x;
    tz += geo.tiles[i].z;
    tn++;
  }
  tx /= Math.max(1, tn);
  tz /= Math.max(1, tn);
  let tr = 0;
  for (let i = 0; i < geo.tiles.length; i++) {
    if (snap.broke[i] !== 0) continue;
    tr = Math.max(tr, Math.hypot(geo.tiles[i].x - tx, geo.tiles[i].z - tz) + HEX);
  }
  if (tn === 0) tr = geo.radius;
  let px = 0;
  let pz = 0;
  let pn = 0;
  for (const p of snap.players) {
    if (!p.alive) continue;
    const b = sh.buf.body(p.seat, now);
    if (!b) continue;
    px += b.x;
    pz += b.z;
    pn++;
  }
  let cx = tx;
  let cz = tz;
  if (pn > 0) {
    cx = tx * 0.55 + (px / pn) * 0.45;
    cz = tz * 0.55 + (pz / pn) * 0.45;
  }
  // 호수 전체보단 사람들 위주로 (캐릭터가 너무 작아지지 않게) — 남은 호수의 62%는 늘 담는다
  let ext = Math.max(5, tr * 0.62);
  for (const p of snap.players) {
    if (!p.alive) continue;
    const b = sh.buf.body(p.seat, now);
    if (b) ext = Math.max(ext, Math.hypot(b.x - cx, b.z - cz) + 1.8);
  }
  if (snap.phase === "gameOver") {
    cx = 0;
    cz = 0;
    ext = 5.5;
  }
  const k = st.init ? 1 - Math.exp(-dt * 2) : 1;
  st.init = true;
  st.cx += (cx - st.cx) * k;
  st.cz += (cz - st.cz) * k;
  st.ext += (ext - st.ext) * k;
  const aspect = size.width / Math.max(1, size.height);
  const persp = camera as THREE.PerspectiveCamera;
  const vfov = (persp.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fitFov = Math.min(vfov, hfov);
  const dist = (st.ext * 1.05) / Math.tan(fitFov / 2);
  const pitch = aspect < 0.8 ? 1.08 : 0.98;
  const shake = decayShake(sh, dt);
  const jx = shake > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * shake : 0;
  const jy = shake > 0 ? Math.cos(now * 0.11) * 0.1 * shake : 0;
  camera.position.set(st.cx + jx, Math.sin(pitch) * dist + jy, st.cz + Math.cos(pitch) * dist);
  camera.lookAt(st.cx + jx * 0.5, 0, st.cz + 0.5);
  for (let seat = 0; seat < sh.labels.length; seat++) {
    const el = sh.labels[seat];
    if (!el) continue;
    const p = snap.players[seat];
    if (!p) {
      el.style.display = "none";
      continue;
    }
    let pos: { x: number; z: number; y: number } | null = null;
    if (p.alive || (p.falling && p.y > WATER_Y - 0.2)) {
      const b = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
      if (b) pos = { x: b.x, z: b.z, y: b.y + 1.75 };
    }
    if (!pos) {
      el.style.display = "none";
      continue;
    }
    v3.set(pos.x, pos.y, pos.z).project(camera);
    if (v3.z > 1) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "";
    const x = (v3.x * 0.5 + 0.5) * size.width;
    const y = (-v3.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function CameraRig({ shared, rings }: { shared: MutableRefObject<SceneShared>; rings: number }) {
  const st = useRef<RigState>({ cx: 0, cz: 0, ext: lakeGeo(rings).radius, init: false });
  useFrame(({ camera, size }, dtRaw) => rigFrame(camera, size, dtRaw, shared.current, st.current));
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

export default function LakeScene({ shared, names, seatCount, quality, fx, onFps }: LakeSceneProps) {
  const high = quality === "high";
  const rings = shared.current.buf.latest()?.rings ?? 5;
  const r = lakeGeo(rings).radius;
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : [1, 1.5]}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 42, position: [0, 16, 14], near: 0.1, far: 300 }}
      style={{ touchAction: "none" }}
    >
      <fog attach="fog" args={["#1b3150", 45, 130]} />
      <Sky quality={quality} />
      <hemisphereLight args={["#bcd8ff", "#1e3550", 0.75]} />
      <ambientLight intensity={0.28} color="#cfe3ff" />
      {/* 달빛 */}
      <directionalLight
        position={[-8, 18, -6]}
        intensity={1.25}
        color="#e4eeff"
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-r - 2}
        shadow-camera-right={r + 2}
        shadow-camera-top={r + 2}
        shadow-camera-bottom={-r - 2}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0008}
      />
      <Shore rings={rings} quality={quality} />
      <Water rings={rings} />
      <Ice key={rings} shared={shared} rings={rings} />
      <Sectors shared={shared} rings={rings} />
      <Items shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <SkaterSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} />
      ))}
      <Ghosts shared={shared} seatCount={seatCount} />
      <FxLayer items={fx} />
      {high && <Snowfall rings={rings} />}
      <CameraRig shared={shared} rings={rings} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
