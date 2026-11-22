"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { BASE_R, COLLAPSE_WARN_H, CRUMBLE_MS, ITEM_INFO, PILLAR_R, ROCK_R, ROCK_WARN_MS, SEAT_COLORS, SHAKE_MS, WIND_MS } from "../data";
import { buildTower, platPos, type Platform } from "../tower";
import { followSeat, type SceneShared } from "../view";
import type { MatchState, PlayerState } from "../sim";
import { FxLayer, type FxItem } from "./Fx";
import Climber, { type ClimberFrame, type ClimberMode } from "./Climber";

/**
 * 무너지는 탑 오르기 3D 무대 (룰북 §11): 노을 하늘 구름 바다 위에 솟은 돌기둥 탑. 둘레를 나선으로 도는
 * 발판(돌·금 간·트램펄린·움직이는·왕관), 아래에서 올라오는 붕괴 먼지와 붉은 경고 띠, 낙석 경고 원,
 * 돌풍 줄기, 아이템, VRM 캐릭터, 연출, 따라 도는 카메라.
 *
 * 카메라는 따라가는 사람(나, 끝났으면 선두)의 기둥 둘레 각도로 돌아가며 늘 기둥 바깥에서 그 사람을
 * 본다 — 그래서 화면의 ←→는 "탑 둘레", ↑↓는 "기둥 쪽/바깥쪽"이다. 보드는 `camAngle`로 입력 방향을 바꾼다.
 * 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 계산해 옮긴다.
 */

export interface TowerSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  quality: "high" | "low";
  fx: FxItem[];
  onFps?: (fps: number) => void;
}

/* ── 하늘·구름 ─────────────────────────────────────────────────────── */

function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#1e1b4b");
  grad.addColorStop(0.35, "#5b3a8a");
  grad.addColorStop(0.55, "#d9677a");
  grad.addColorStop(0.68, "#f5a35c");
  grad.addColorStop(0.8, "#fde3b0");
  grad.addColorStop(1, "#f2d7c4");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Sky() {
  const tex = useMemo(() => skyTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const group = useRef<THREE.Group>(null);
  // 하늘은 카메라 높이를 따라간다 (탑을 올라도 노을이 늘 같은 자리)
  useFrame(({ camera }) => {
    if (group.current) group.current.position.y = camera.position.y * 0.85;
  });
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[150, 24, 16]} />
        <meshBasicMaterial map={tex} side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>
      <mesh position={[70, 8, -90]}>
        <sphereGeometry args={[9, 24, 16]} />
        <meshBasicMaterial color="#fff1c7" fog={false} />
      </mesh>
      <mesh position={[70, 8, -90.5]}>
        <sphereGeometry args={[15, 24, 16]} />
        <meshBasicMaterial color="#ffd59a" transparent opacity={0.18} fog={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function CloudSea({ quality }: { quality: "high" | "low" }) {
  const puffs = useMemo(() => {
    const n = quality === "high" ? 70 : 30;
    return Array.from({ length: n }, (_, i) => {
      const a = i * 2.399963;
      const r = 12 + ((i * 37) % 60);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 4 + ((i * 7) % 6), y: -9 - ((i * 13) % 4) };
    });
  }, [quality]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-11}>
        <circleGeometry args={[140, 32]} />
        <meshBasicMaterial color="#f3d9c9" />
      </mesh>
      {puffs.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} scale={[p.s, p.s * 0.45, p.s]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#fff4ea" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/* ── 기둥 ───────────────────────────────────────────────────────────── */

function brickTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#7b6a58";
  g.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 9; col++) {
      const x = col * 32 + off;
      const y = row * 16;
      const tone = 105 + ((row * 31 + col * 17) % 40);
      g.fillStyle = `rgb(${tone + 25},${tone + 10},${tone - 10})`;
      g.fillRect(x + 1, y + 1, 30, 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function Pillar({ top }: { top: number }) {
  const tex = useMemo(() => {
    const t = brickTexture();
    t.repeat.set(5, Math.round((top + 14) / 2.2));
    return t;
  }, [top]);
  useEffect(() => () => tex.dispose(), [tex]);
  const torches = useMemo(() => {
    const out: { x: number; y: number; z: number; a: number }[] = [];
    for (let y = 2; y < top; y += 3.2) {
      const a = y * 1.7;
      out.push({ x: Math.cos(a) * (PILLAR_R + 0.05), y, z: Math.sin(a) * (PILLAR_R + 0.05), a });
    }
    return out;
  }, [top]);
  const H = top + 14;
  return (
    <group>
      <mesh position-y={top - H / 2 + 2.5} castShadow receiveShadow>
        <cylinderGeometry args={[PILLAR_R, PILLAR_R * 1.06, H, 28, 1]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {/* 꼭대기 처마 */}
      <mesh position-y={top + 2.6}>
        <coneGeometry args={[PILLAR_R * 1.6, 2.2, 10]} />
        <meshStandardMaterial color="#7f1d1d" roughness={0.7} />
      </mesh>
      {torches.map((t, i) => (
        <mesh key={i} position={[t.x, t.y, t.z]}>
          <boxGeometry args={[0.12, 0.22, 0.12]} />
          <meshBasicMaterial color="#fbbf24" />
        </mesh>
      ))}
    </group>
  );
}

/* ── 발판 ───────────────────────────────────────────────────────────── */

const PLAT_H = 0.42;
const COL = {
  stone: new THREE.Color("#b9ab98"),
  crumbly: new THREE.Color("#a0754d"),
  bouncy: new THREE.Color("#3fbf6a"),
  moving: new THREE.Color("#7aa6d6"),
  crown: new THREE.Color("#f4c542"),
  base: new THREE.Color("#a99882"),
  ice: new THREE.Color("#cdefff"),
  warn: new THREE.Color("#e2553f"),
};

function crackTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(45,25,10,0.85)";
  g.lineWidth = 4;
  g.lineCap = "round";
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let b = 0; b < 6; b++) {
    let x = 64;
    let y = 64;
    let a = (b / 6) * Math.PI * 2 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      a += (rnd() - 0.5) * 1.1;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function chevronTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 10;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const dx of [-26, 26]) {
    const s = Math.sign(dx);
    g.beginPath();
    g.moveTo(64 + dx - s * 10, 40);
    g.lineTo(64 + dx + s * 10, 64);
    g.lineTo(64 + dx - s * 10, 88);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface PlatRefs {
  group: THREE.Group | null;
  mat: THREE.MeshStandardMaterial | null;
  shownAt: number;
  wasSolid: boolean;
}

function PlatformMesh({ p, bind, crackTex, chevTex }: { p: Platform; bind: (i: number, r: Partial<PlatRefs>) => void; crackTex: THREE.Texture; chevTex: THREE.Texture }) {
  const color = COL[p.kind === "base" ? "base" : p.kind];
  const r = p.r;
  return (
    <group ref={(g) => bind(p.i, { group: g })}>
      {p.kind === "base" ? (
        <mesh position-y={-0.5} receiveShadow castShadow>
          <cylinderGeometry args={[BASE_R, BASE_R * 0.92, 1, 40]} />
          <meshStandardMaterial ref={(m) => bind(p.i, { mat: m })} color={color} roughness={0.95} />
        </mesh>
      ) : (
        <mesh position-y={-PLAT_H / 2} receiveShadow castShadow>
          <cylinderGeometry args={[r, r * (p.kind === "crown" ? 0.7 : 0.82), PLAT_H, p.kind === "crumbly" ? 9 : 24]} />
          <meshStandardMaterial ref={(m) => bind(p.i, { mat: m })} color={color} roughness={p.kind === "crown" ? 0.35 : 0.85} metalness={p.kind === "crown" ? 0.5 : 0} />
        </mesh>
      )}
      {p.kind === "crumbly" && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
          <planeGeometry args={[r * 1.8, r * 1.8]} />
          <meshBasicMaterial map={crackTex} transparent depthWrite={false} />
        </mesh>
      )}
      {p.kind === "bouncy" && (
        <>
          <mesh rotation-x={-Math.PI / 2} position-y={0.015}>
            <ringGeometry args={[r * 0.45, r * 0.62, 24]} />
            <meshBasicMaterial color="#ecfccb" />
          </mesh>
          <mesh position-y={-PLAT_H - 0.18} rotation-x={Math.PI / 2}>
            <torusGeometry args={[r * 0.45, 0.05, 6, 20]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position-y={-PLAT_H - 0.36} rotation-x={Math.PI / 2}>
            <torusGeometry args={[r * 0.45, 0.05, 6, 20]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.3} />
          </mesh>
        </>
      )}
      {p.kind === "moving" && (
        <mesh rotation-x={-Math.PI / 2} rotation-z={p.ang + Math.PI / 2} position-y={0.012}>
          <planeGeometry args={[r * 1.4, r * 1.4]} />
          <meshBasicMaterial map={chevTex} transparent depthWrite={false} />
        </mesh>
      )}
      {p.kind === "crown" && (
        <group position-y={0.02}>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[r * 0.7, r * 0.85, 32]} />
            <meshBasicMaterial color="#fff7d6" />
          </mesh>
          {/* 왕관 */}
          <group position-y={2.1}>
            <mesh>
              <cylinderGeometry args={[0.45, 0.4, 0.3, 10, 1, true]} />
              <meshStandardMaterial color="#facc15" metalness={0.8} roughness={0.25} side={THREE.DoubleSide} emissive="#a16207" emissiveIntensity={0.4} />
            </mesh>
            {[0, 1, 2, 3, 4].map((k) => (
              <mesh key={k} position={[Math.cos((k / 5) * Math.PI * 2) * 0.42, 0.28, Math.sin((k / 5) * Math.PI * 2) * 0.42]}>
                <coneGeometry args={[0.08, 0.28, 5]} />
                <meshStandardMaterial color="#facc15" metalness={0.8} roughness={0.25} emissive="#a16207" emissiveIntensity={0.4} />
              </mesh>
            ))}
          </group>
          {/* 깃대 */}
          <mesh position={[r * 0.85, 1.1, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 2.2, 6]} />
            <meshStandardMaterial color="#e5e7eb" />
          </mesh>
          <mesh position={[r * 0.85 + 0.3, 1.95, 0]}>
            <planeGeometry args={[0.6, 0.36]} />
            <meshStandardMaterial color="#dc2626" side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function Platforms({ shared, seed }: { shared: MutableRefObject<SceneShared>; seed: number }) {
  const tower = useMemo(() => buildTower(seed), [seed]);
  const refs = useRef<PlatRefs[]>([]);
  const crackTex = useMemo(() => crackTexture(), []);
  const chevTex = useMemo(() => chevronTexture(), []);
  useEffect(
    () => () => {
      crackTex.dispose();
      chevTex.dispose();
    },
    [crackTex, chevTex],
  );
  const bind = (i: number, r: Partial<PlatRefs>) => {
    const cur = refs.current[i] ?? { group: null, mat: null, shownAt: 0, wasSolid: true };
    refs.current[i] = { ...cur, ...r };
  };
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const snap = shared.current.buf.latest();
    if (!snap || snap.towerSeed !== seed) return;
    const now = shared.current.buf.simNow(performance.now());
    const wall = performance.now();
    for (const p of tower.platforms) {
      const r = refs.current[p.i];
      if (!r?.group) continue;
      const g = r.group;
      const br = snap.broke[p.i] ?? 0;
      const gone = (snap.gone[p.i] ?? 0) !== 0;
      const solidNow = br === 0 && !gone;
      if (solidNow && !r.wasSolid) r.shownAt = wall;
      r.wasSolid = solidNow;
      const c = platPos(p, now);
      let y = p.y;
      let rx = 0;
      let rz = 0;
      let sc = 1;
      if (!solidNow) {
        const u = (now - br) / 1000;
        if (u > 1.6 || u < 0) {
          g.visible = false;
          continue;
        }
        y -= 0.5 * 14 * u * u;
        rx = u * 1.6 * (p.i % 2 ? 1 : -1);
        rz = u * 0.9;
      } else {
        const ca = snap.crumbleAt[p.i] ?? 0;
        const warnBand = p.kind !== "crown" && p.y < snap.collapseY + COLLAPSE_WARN_H;
        if (ca > 0) {
          const left = Math.max(0, (ca - now) / Math.max(CRUMBLE_MS, SHAKE_MS));
          const amp = 0.03 + (1 - left) * 0.08;
          rx = Math.sin(now * 0.06 + p.i) * amp;
          rz = Math.cos(now * 0.055 + p.i * 1.3) * amp;
        } else if (warnBand) {
          rx = Math.sin(now * 0.05 + p.i) * 0.035;
          rz = Math.cos(now * 0.047 + p.i) * 0.035;
        }
        const pop = (wall - r.shownAt) / 280;
        if (pop >= 0 && pop < 1) sc = 0.4 + 0.6 * (1 - (1 - pop) * (1 - pop));
      }
      g.visible = true;
      g.position.set(c.x, y, c.z);
      g.rotation.set(rx, 0, rz);
      g.scale.setScalar(sc);
      const m = r.mat;
      if (m) {
        const base = COL[p.kind === "base" ? "base" : p.kind];
        tmp.copy(base);
        if ((snap.icyUntil[p.i] ?? 0) > now) tmp.lerp(COL.ice, 0.75);
        if (solidNow && p.kind !== "crown" && p.y < snap.collapseY + COLLAPSE_WARN_H) tmp.lerp(COL.warn, 0.45 + 0.25 * Math.sin(now * 0.012));
        if ((snap.crumbleAt[p.i] ?? 0) > 0) tmp.lerp(COL.warn, 0.3);
        m.color.copy(tmp);
        m.emissive.set((snap.icyUntil[p.i] ?? 0) > now ? "#7dd3fc" : "#000000");
        m.emissiveIntensity = 0.25;
      }
    }
  });
  return (
    <group>
      {tower.platforms.map((p) => (
        <PlatformMesh key={`${seed}-${p.i}`} p={p} bind={bind} crackTex={crackTex} chevTex={chevTex} />
      ))}
    </group>
  );
}

/* ── 붕괴선 ────────────────────────────────────────────────────────── */

function Collapse({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: "high" | "low" }) {
  const group = useRef<THREE.Group>(null);
  const band = useRef<THREE.Mesh>(null);
  const dust = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = quality === "high" ? 500 : 200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963;
      const r = 1.5 + ((i * 0.618034) % 1) * 9;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = ((i * 0.754877) % 1) * 2.6 - 0.6;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [quality]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    const snap = shared.current.buf.latest();
    const g = group.current;
    if (!snap || !g) return;
    const y = snap.collapseY;
    g.position.y = y;
    const t = clock.elapsedTime;
    if (band.current) {
      band.current.position.y = COLLAPSE_WARN_H;
      ((band.current.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.12 * Math.sin(t * 5));
    }
    if (dust.current) dust.current.rotation.y = t * 0.15;
  });
  return (
    <group ref={group}>
      {/* 무너지는 먼지 구름 (아래는 짙게) */}
      <mesh position-y={-0.2}>
        <cylinderGeometry args={[11, 11, 0.4, 40, 1]} />
        <meshBasicMaterial color="#4a3b30" transparent opacity={0.78} depthWrite={false} />
      </mesh>
      <mesh position-y={-3}>
        <cylinderGeometry args={[11, 11, 5.6, 40, 1, true]} />
        <meshBasicMaterial color="#3a2e26" transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <points ref={dust} geometry={geo}>
        <pointsMaterial color="#8b7560" size={0.28} sizeAttenuation transparent opacity={0.8} depthWrite={false} />
      </points>
      {/* 경고 띠: 이 높이보다 낮은 발판은 곧 삼켜진다 */}
      <mesh ref={band} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[PILLAR_R + 0.1, 8.5, 48]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ── 낙석·돌풍 ──────────────────────────────────────────────────────── */

function Rocks({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    const now = shared.current.buf.simNow(performance.now());
    g.children.forEach((c, i) => {
      const r = snap.rocks[i];
      if (!r) {
        c.visible = false;
        return;
      }
      c.visible = true;
      const u = Math.max(0, Math.min(1, 1 - (r.at - now) / ROCK_WARN_MS));
      c.position.set(r.x, r.y, r.z);
      const ring = c.children[0] as THREE.Mesh;
      const rock = c.children[1] as THREE.Mesh;
      ring.scale.setScalar(0.6 + u * 0.4);
      ((ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.45 * Math.abs(Math.sin(now * 0.02)));
      rock.position.y = 9 * (1 - u * u) + 0.4;
      rock.rotation.set(now * 0.004, now * 0.003, 0);
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: 9 }, (_, i) => (
        <group key={i} visible={false}>
          <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
            <ringGeometry args={[ROCK_R * 0.75, ROCK_R, 28]} />
            <meshBasicMaterial color="#ef4444" transparent depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh castShadow>
            <dodecahedronGeometry args={[0.45, 0]} />
            <meshStandardMaterial color="#78716c" roughness={1} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function WindStreaks({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  const streaks = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ a: i * 2.399963, r: 3.5 + ((i * 0.618) % 1) * 4, h: ((i * 0.754877) % 1) * 5 })), []);
  useFrame(({ clock }) => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    const w = snap.wind;
    const now = shared.current.buf.simNow(performance.now());
    if (!w || now > w.until) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const active = now >= w.at;
    const t = clock.elapsedTime;
    g.children.forEach((c, i) => {
      const s = streaks[i];
      const a = s.a + t * (active ? 2.2 : 0.8);
      const r = s.r + (active ? ((t * 2 + i) % 3) : 0);
      c.position.set(Math.cos(a) * r, w.minY + s.h, Math.sin(a) * r);
      c.rotation.y = -a;
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = active ? 0.55 * (1 - (now - w.at) / WIND_MS) + 0.15 : 0.18;
    });
  });
  return (
    <group ref={group} visible={false}>
      {streaks.map((_, i) => (
        <mesh key={i}>
          <boxGeometry args={[0.03, 0.03, 1.6]} />
          <meshBasicMaterial color="#f8fafc" transparent depthWrite={false} />
        </mesh>
      ))}
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

function Items({ shared, seed }: { shared: MutableRefObject<SceneShared>; seed: number }) {
  const tower = useMemo(() => buildTower(seed), [seed]);
  const group = useRef<THREE.Group>(null);
  const textures = useMemo(() => Object.fromEntries(Object.entries(ITEM_INFO).map(([k, v]) => [k, emojiTexture(v.emoji)])), []);
  useFrame(({ clock }) => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap || snap.towerSeed !== seed) return;
    const now = shared.current.buf.simNow(performance.now());
    const t = clock.elapsedTime;
    g.children.forEach((c, i) => {
      const it = snap.items[i];
      const pl = it ? tower.platforms[it.plat] : null;
      if (!it || !pl) {
        c.visible = false;
        return;
      }
      c.visible = true;
      const pos = platPos(pl, now);
      c.position.set(pos.x, pl.y, pos.z);
      const sprite = c.children[0] as THREE.Sprite;
      const ring = c.children[1] as THREE.Mesh;
      sprite.position.y = 0.75 + Math.sin(t * 3 + i) * 0.1;
      const mat = sprite.material as THREE.SpriteMaterial;
      const tex = textures[it.kind];
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      mat.opacity = it.until - snap.t < 3000 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 8)) : 1;
      ring.rotation.z = t * 1.5;
      (ring.material as THREE.MeshBasicMaterial).color.set(ITEM_INFO[it.kind].color);
    });
  });
  return (
    <group ref={group}>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} visible={false}>
          <sprite scale={[0.8, 0.8, 0.8]}>
            <spriteMaterial transparent depthWrite={false} />
          </sprite>
          <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
            <ringGeometry args={[0.4, 0.52, 6]} />
            <meshBasicMaterial transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── 캐릭터 ─────────────────────────────────────────────────────────── */

export function modeOf(snap: MatchState, p: PlayerState, shovedAt: number, now: number): ClimberMode {
  if (snap.phase === "gameOver") return snap.ranks?.[p.seat] === 1 ? "cheer" : "sad";
  if (p.status === "done") return "cheer";
  if (p.status === "out") return "fall";
  if (snap.t < p.staggerUntil) return "stagger";
  if (now - shovedAt < 260) return "shove";
  if (p.on < 0) {
    if (p.vy > 6.5) return "bounce";
    return p.vy < -5 ? "fall" : "jump";
  }
  return Math.hypot(p.vx, p.vz) > 0.7 ? "run" : "idle";
}

function ClimberSlot({ seat, names, shared, lowDetail }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<ClimberFrame>({ x: 0, y: 0, z: 0, face: 0, mode: "idle", speed: 0, visible: false, shield: false, boots: false, feather: false, fear: 0 });
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
    // 휩쓸린 사람은 먼지 속으로 잠깐 떨어지다 사라진다
    const outFor = p.status === "out" ? snap.t - p.doneAt : 0;
    f.visible = (p.status !== "out" || outFor < 900) && snap.phase !== "gameOver" ? true : snap.phase === "gameOver";
    if (snap.phase === "gameOver") {
      // 끝나면 모두 왕관 발판 위로
      const tower = buildTower(snap.towerSeed);
      const crown = tower.platforms[tower.crown];
      const c = platPos(crown, 0);
      const order = snap.ranks ?? [];
      const a = crown.ang + (order[seat] ?? seat) * 1.0;
      f.x = c.x + Math.cos(a) * 0.95;
      f.z = c.z + Math.sin(a) * 0.95;
      f.y = crown.y;
      f.face = Math.atan2(-f.z, -f.x) + Math.PI;
    } else {
      f.x = pose.x;
      f.y = pose.y - (p.status === "out" ? (outFor / 1000) * 3 : 0);
      f.z = pose.z;
      f.face = pose.face;
    }
    f.mode = modeOf(snap, p, sh.shoveAt[seat] ?? -1e9, now);
    f.speed = Math.min(1, Math.hypot(p.vx, p.vz) / 5.2);
    f.shield = p.status === "climb" && snap.t < p.shieldUntil;
    f.boots = p.status === "climb" && snap.t < p.bootsUntil;
    f.feather = p.status === "climb" && p.feather;
    const gap = p.y - snap.collapseY;
    f.fear = p.status === "climb" && snap.phase === "climb" && gap < 3 ? Math.min(1, (3 - gap) / 2.5) : 0;
    return f;
  };
  return <Climber look={look} seed={seat * 13 + 3} color={SEAT_COLORS[seat % 6]} lowDetail={lowDetail} read={read} />;
}

/* ── 카메라 + 이름표 + 해 ────────────────────────────────────────── */

const v3 = new THREE.Vector3();

type RigState = { ang: number; y: number; init: boolean };

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** 카메라 따라 돌기 + 이름표 옮기기 (매 프레임). 공유 객체·DOM을 고치므로 컴포넌트 밖 함수로 둔다. */
function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: RigState, sun: THREE.DirectionalLight | null) {
  const dt = Math.min(dtRaw, 0.05);
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const seat = followSeat(snap, sh.mySeat);
  sh.follow = seat;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  if (snap.phase === "gameOver") {
    const tower = buildTower(snap.towerSeed);
    const crown = tower.platforms[tower.crown];
    const c = platPos(crown, 0);
    tx = c.x;
    tz = c.z;
    ty = crown.y;
  } else {
    const b = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
    if (b) {
      tx = b.x;
      ty = b.y;
      tz = b.z;
    }
  }
  const wantAng = Math.atan2(tz, tx);
  const wantY = snap.phase === "countdown" ? Math.max(0, ty) : ty;
  if (!st.init) {
    st.ang = wantAng;
    st.y = wantY;
    st.init = true;
  }
  const ka = 1 - Math.exp(-dt * (snap.phase === "gameOver" ? 0.6 : 3.2));
  const ky = 1 - Math.exp(-dt * 3.5);
  st.ang = wrap(st.ang + wrap(wantAng - st.ang) * ka);
  if (snap.phase === "gameOver") st.ang = wrap(st.ang + dt * 0.25);
  st.y += (wantY - st.y) * ky;
  sh.camAngle = st.ang;
  const aspect = size.width / Math.max(1, size.height);
  const R = aspect < 0.8 ? 15.5 : 12.5;
  const lift = aspect < 0.8 ? 3.4 : 2.6;
  const v = sh.shake;
  sh.shake = Math.max(0, v - dt * 2.5);
  const jx = v > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * v : 0;
  const jy = v > 0 ? Math.cos(now * 0.11) * 0.1 * v : 0;
  const ca = Math.cos(st.ang);
  const sa = Math.sin(st.ang);
  camera.position.set(ca * R - sa * jx, st.y + lift + jy, sa * R + ca * jx);
  camera.lookAt(ca * 1.2, st.y + 1.7, sa * 1.2);
  if (sun) {
    sun.position.set(ca * 6 + 10, st.y + 16, sa * 6 - 8);
    sun.target.position.set(ca * 3, st.y, sa * 3);
    sun.target.updateMatrixWorld();
  }
  for (let s = 0; s < sh.labels.length; s++) {
    const el = sh.labels[s];
    if (!el) continue;
    const p = snap.players[s];
    if (!p || (p.status === "out" && snap.phase !== "gameOver") || snap.phase === "gameOver") {
      el.style.display = "none";
      continue;
    }
    const b = s === sh.mySeat ? sh.buf.ahead(s, now) : sh.buf.body(s, now);
    if (!b) {
      el.style.display = "none";
      continue;
    }
    v3.set(b.x, b.y + 1.9, b.z).project(camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.2 || Math.abs(v3.y) > 1.2) {
      el.style.display = "none";
      continue;
    }
    // 기둥 뒤(카메라 반대편)는 흐리게
    const behind = Math.abs(wrap(Math.atan2(b.z, b.x) - st.ang)) > 1.75;
    el.style.display = "";
    el.style.opacity = behind ? "0.35" : "1";
    const x = (v3.x * 0.5 + 0.5) * size.width;
    const y = (-v3.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function CameraRig({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const st = useRef<RigState>({ ang: 0, y: 0, init: false });
  const sun = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  useEffect(() => {
    const l = sun.current;
    if (l) scene.add(l.target);
    return () => {
      if (l) scene.remove(l.target);
    };
  }, [scene]);
  useFrame(({ camera, size }, dtRaw) => rigFrame(camera, size, dtRaw, shared.current, st.current, sun.current));
  return (
    <directionalLight
      ref={sun}
      intensity={1.5}
      color="#ffe2c2"
      castShadow
      shadow-mapSize-width={1024}
      shadow-mapSize-height={1024}
      shadow-camera-left={-10}
      shadow-camera-right={10}
      shadow-camera-top={10}
      shadow-camera-bottom={-10}
      shadow-camera-near={1}
      shadow-camera-far={50}
      shadow-bias={-0.0008}
    />
  );
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

/** 라운드가 바뀌면(탑 씨앗이 바뀌면) 발판을 새로 짓는다 */
function TowerLayer({ shared, quality }: { shared: MutableRefObject<SceneShared>; quality: "high" | "low" }) {
  const [seed, setSeed] = useState(() => shared.current.buf.latest()?.towerSeed ?? 0);
  useFrame(() => {
    const s = shared.current.buf.latest()?.towerSeed ?? 0;
    if (s !== seed) setSeed(s);
  });
  const top = buildTower(seed).top;
  return (
    <group key={seed}>
      <Pillar top={top} />
      <Platforms shared={shared} seed={seed} />
      <Items shared={shared} seed={seed} />
      <Collapse shared={shared} quality={quality} />
    </group>
  );
}

export default function TowerScene({ shared, names, seatCount, quality, fx, onFps }: TowerSceneProps) {
  const high = quality === "high";
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 52, position: [0, 4, 12], near: 0.1, far: 400 }} style={{ touchAction: "none" }}>
      <fog attach="fog" args={["#f0c3a6", 30, 120]} />
      <Sky />
      <CloudSea quality={quality} />
      <hemisphereLight args={["#ffe9d6", "#5b4a6b", 0.8]} />
      <ambientLight intensity={0.3} color="#ffe8d6" />
      <TowerLayer shared={shared} quality={quality} />
      <Rocks shared={shared} />
      <WindStreaks shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <ClimberSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} />
      ))}
      <FxLayer items={fx} />
      <CameraRig shared={shared} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
