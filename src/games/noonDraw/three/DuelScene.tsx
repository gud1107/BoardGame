"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { SEAT_COLORS, type FeintKind } from "../data";
import type { NoonState } from "../engine";
import Samurai, { type SamuraiFrame, type SamuraiMode } from "./Samurai";

/**
 * 정오의 발도 3D 무대 (룰북 §11): 한낮의 모래 마당. 해가 머리 위에 있어 그림자가 짧고, 뒤에 징 걸이(진짜 신호 때 울림),
 * 왼쪽에 큰 북(🥁 가짜 신호 때 흔들림), 소나무(🐦 새 떼·🐦‍⬛ 까마귀가 날아오름), 낙엽(🍂), 마른 천둥(⚡ 번쩍).
 * 토너먼트는 두 사람이 옆으로 마주 보고, 난투는 모두 둥글게 가운데를 본다.
 * 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 계산해 옮긴다.
 */

export interface DuelSceneProps {
  state: NoonState;
  /** 보여 줄 자리: 토너먼트 = 이 경기 두 사람, 난투 = 모두 */
  focus: number[];
  names: string[];
  quality: "high" | "low";
  labels: MutableRefObject<(HTMLDivElement | null)[]>;
  onFps?: (fps: number) => void;
}

const DUEL_X = 2.1;

/* ── 하늘·땅 ─────────────────────────────────────────────────────── */

function gradientTexture(stops: [number, string][], h = 256): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = h;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sandTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d8bf8a";
  g.fillRect(0, 0, 256, 256);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(120,92,52,${0.05 + r() * 0.08})` : `rgba(255,244,214,${0.05 + r() * 0.1})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Sky({ flash }: { flash: MutableRefObject<number> }) {
  const tex = useMemo(() => gradientTexture([[0, "#5d9fdc"], [0.42, "#9cc8ec"], [0.5, "#e9edea"], [0.56, "#f2e6c8"], [1, "#e7d6a8"]]), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (mat.current) mat.current.color.setScalar(1 - flash.current * 0.45);
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[120, 24, 16]} />
        <meshBasicMaterial ref={mat} map={tex} side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>
      {/* 정오의 해 — 거의 머리 위 */}
      <mesh position={[18, 70, -40]}>
        <sphereGeometry args={[5, 20, 12]} />
        <meshBasicMaterial color="#fffbe6" fog={false} />
      </mesh>
    </group>
  );
}

function Ground() {
  const tex = useMemo(() => sandTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[60, 48]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
      {/* 갈퀴로 고른 결투 마당 */}
      {[3.2, 3.9, 4.6].map((r) => (
        <mesh key={r} rotation-x={-Math.PI / 2} position-y={0.006}>
          <ringGeometry args={[r, r + 0.05, 64]} />
          <meshBasicMaterial color="#b89a62" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const woodMat = new THREE.MeshStandardMaterial({ color: "#6b4a2e", roughness: 0.9 });
const darkWoodMat = new THREE.MeshStandardMaterial({ color: "#3e2a1a", roughness: 0.85 });
const stoneMat = new THREE.MeshStandardMaterial({ color: "#9a958c", roughness: 0.95 });
const pineMat = new THREE.MeshStandardMaterial({ color: "#2f5d3a", roughness: 0.9 });
const roofMat = new THREE.MeshStandardMaterial({ color: "#3b3f4a", roughness: 0.7 });
const plasterMat = new THREE.MeshStandardMaterial({ color: "#efe6d2", roughness: 0.95 });

function Fence() {
  const posts = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i <= 26; i++) {
      const a = Math.PI * 0.08 + (i / 26) * Math.PI * 0.84;
      out.push([Math.cos(a) * 11, Math.sin(a) * -11, -a + Math.PI / 2]);
    }
    return out;
  }, []);
  return (
    <group>
      {posts.map(([x, z, rot], i) => (
        <group key={i} position={[x, 0, z]} rotation-y={rot}>
          <mesh material={darkWoodMat} position-y={0.6} castShadow>
            <boxGeometry args={[0.14, 1.2, 0.14]} />
          </mesh>
          {i < posts.length - 1 && (
            <mesh material={woodMat} position={[0, 0.85, 0]} rotation-y={0}>
              <boxGeometry args={[0.06, 0.12, 2.7]} />
            </mesh>
          )}
        </group>
      ))}
      {/* 먼 도장 건물 */}
      <group position={[0, 0, -16]}>
        <mesh material={plasterMat} position-y={1.6} castShadow>
          <boxGeometry args={[12, 3.2, 4]} />
        </mesh>
        <mesh material={roofMat} position-y={3.7} rotation-y={Math.PI / 4} scale={[1, 0.35, 1]}>
          <coneGeometry args={[9.2, 3, 4]} />
        </mesh>
        {[-4.5, -1.5, 1.5, 4.5].map((x) => (
          <mesh key={x} material={darkWoodMat} position={[x, 1.6, 2.02]}>
            <boxGeometry args={[0.18, 3.2, 0.05]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Pine({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh material={darkWoodMat} position-y={1.2} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 2.4, 8]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} material={pineMat} position-y={2.3 + i * 0.85} castShadow>
          <coneGeometry args={[1.5 - i * 0.38, 1.4, 9]} />
        </mesh>
      ))}
    </group>
  );
}

function Lantern({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh material={stoneMat} position-y={0.35} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 0.7, 6]} />
      </mesh>
      <mesh material={stoneMat} position-y={0.85}>
        <boxGeometry args={[0.42, 0.32, 0.42]} />
      </mesh>
      <mesh material={stoneMat} position-y={1.1}>
        <coneGeometry args={[0.42, 0.28, 4]} />
      </mesh>
    </group>
  );
}

/* ── 징 (진짜 신호) · 북 (가짜 신호) ─────────────────────────────────── */

const bronzeMat = new THREE.MeshStandardMaterial({ color: "#c99a3b", metalness: 0.85, roughness: 0.3, emissive: "#6b4a10", emissiveIntensity: 0.1 });

function Gong({ hit }: { hit: MutableRefObject<number> }) {
  const disc = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const u = clock.elapsedTime - hit.current;
    const k = u >= 0 && u < 2.2 ? Math.exp(-u * 2.2) : 0;
    if (disc.current) {
      disc.current.rotation.x = Math.sin(u * 20) * 0.18 * k;
      disc.current.rotation.z = Math.sin(u * 13) * 0.05 * k;
    }
    if (glow.current) glow.current.opacity = Math.min(0.85, k * 1.2);
    bronzeMat.emissiveIntensity = 0.1 + k * 1.4;
  });
  return (
    <group position={[0, 0, -5.2]}>
      {[-1, 1].map((s) => (
        <mesh key={s} material={darkWoodMat} position={[s * 1.05, 1.35, 0]} castShadow>
          <boxGeometry args={[0.16, 2.7, 0.16]} />
        </mesh>
      ))}
      <mesh material={darkWoodMat} position-y={2.72}>
        <boxGeometry args={[2.6, 0.18, 0.2]} />
      </mesh>
      <group position-y={2.62}>
        <mesh ref={disc} material={bronzeMat} position-y={-0.9} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.78, 0.78, 0.06, 32]} />
        </mesh>
      </group>
      <mesh position={[0, 1.72, 0.1]}>
        <circleGeometry args={[1.5, 32]} />
        <meshBasicMaterial ref={glow} color="#ffe9a8" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

const drumSkinMat = new THREE.MeshStandardMaterial({ color: "#efe2c4", roughness: 0.8 });
const drumBodyMat = new THREE.MeshStandardMaterial({ color: "#7a2b1e", roughness: 0.6 });

function Drum({ hit }: { hit: MutableRefObject<number> }) {
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const u = clock.elapsedTime - hit.current;
    const k = u >= 0 && u < 1.2 ? Math.exp(-u * 4) : 0;
    if (body.current) body.current.scale.setScalar(1 + Math.sin(u * 40) * 0.05 * k);
  });
  return (
    <group position={[-5.6, 0, -2.6]} rotation-y={0.6}>
      <mesh material={darkWoodMat} position-y={0.4}>
        <boxGeometry args={[1.1, 0.8, 0.5]} />
      </mesh>
      <group ref={body} position-y={1.25} rotation-z={Math.PI / 2}>
        <mesh material={drumBodyMat} castShadow>
          <cylinderGeometry args={[0.62, 0.62, 0.9, 20]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} material={drumSkinMat} position-y={s * 0.455}>
            <cylinderGeometry args={[0.6, 0.6, 0.02, 20]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ── 가짜 신호 연출 ─────────────────────────────────────────────────── */

interface FeintFx {
  kind: FeintKind;
  at: number;
}

const birdGeo = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.12, -0.3, 0.05, -0.08, 0, 0, -0.05, 0, 0, 0.12, 0.3, 0.05, -0.08, 0, 0, -0.05], 3));
  g.computeVertexNormals();
  return g;
})();
const birdMat = new THREE.MeshBasicMaterial({ color: "#2d2a26", side: THREE.DoubleSide });
const crowMat = new THREE.MeshBasicMaterial({ color: "#0b0b10", side: THREE.DoubleSide });
const leafMat = new THREE.MeshStandardMaterial({ color: "#c8692b", side: THREE.DoubleSide, roughness: 0.9 });
const leafGeo = new THREE.PlaneGeometry(0.16, 0.1);

const LEAVES = 36;

function Feints({ fx }: { fx: MutableRefObject<FeintFx[]> }) {
  const birds = useRef<THREE.Group>(null);
  const crow = useRef<THREE.Mesh>(null);
  const leaves = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => Array.from({ length: LEAVES }, (_, i) => [Math.sin(i * 12.9898) * 0.5 + 0.5, Math.sin(i * 78.233) * 0.5 + 0.5, Math.sin(i * 39.12) * 0.5 + 0.5]), []);
  const m4 = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const latest = (k: FeintKind) => {
      for (let i = fx.current.length - 1; i >= 0; i--) if (fx.current[i].kind === k) return t - fx.current[i].at;
      return Infinity;
    };
    // 🐦 새 떼 — 오른쪽 뒤 소나무에서 왼쪽 위로
    const ub = latest("bird");
    if (birds.current) {
      birds.current.visible = ub < 3.2;
      if (ub < 3.2) {
        birds.current.children.forEach((b, i) => {
          const p = ub * (1.15 + i * 0.12);
          b.position.set(6 - p * 4.2 + i * 0.4, 4.2 + p * 1.6 + Math.sin(i) * 0.4, -6 + p * 1.2 + i * 0.3);
          b.scale.set(1, 1 + Math.sin(t * 22 + i) * 0.6, 1);
          b.rotation.y = -0.9;
        });
      }
    }
    // 🐦‍⬛ 까마귀 — 낮게 가로질러
    const uc = latest("crow");
    if (crow.current) {
      crow.current.visible = uc < 2.6;
      if (uc < 2.6) {
        crow.current.position.set(-7 + uc * 6.5, 2.6 + Math.sin(uc * 2.4) * 0.8, -2.4 - uc * 0.6);
        crow.current.scale.set(2.4, 2.4 * (1 + Math.sin(t * 16) * 0.5), 2.4);
        crow.current.rotation.y = Math.PI / 2;
      }
    }
    // 🍂 낙엽 — 바람에 쓸려 마당을 가로지름
    const ul = latest("leaf");
    if (leaves.current) {
      leaves.current.visible = ul < 3.4;
      if (ul < 3.4) {
        for (let i = 0; i < LEAVES; i++) {
          const [a, b, c] = seeds[i];
          const p = ul * (2.2 + a * 1.6) - b * 2;
          m4.position.set(-6 + p * 2.2, 0.15 + Math.abs(Math.sin(p * 2 + c * 6)) * (0.6 + a * 1.4), -3 + c * 6);
          m4.rotation.set(t * (3 + a * 4), t * (2 + b * 3), c * 6);
          m4.scale.setScalar(p < 0 ? 0 : 1);
          m4.updateMatrix();
          leaves.current.setMatrixAt(i, m4.matrix);
        }
        leaves.current.instanceMatrix.needsUpdate = true;
      }
    }
  });
  return (
    <group>
      <group ref={birds} visible={false}>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} geometry={birdGeo} material={birdMat} />
        ))}
      </group>
      <mesh ref={crow} geometry={birdGeo} material={crowMat} visible={false} />
      <instancedMesh ref={leaves} args={[leafGeo, leafMat, LEAVES]} visible={false} frustumCulled={false} />
    </group>
  );
}

/* ── 결투자 자리 ─────────────────────────────────────────────────────── */

interface SeatAnim {
  mode: SamuraiMode;
  since: number;
  /** 결과 때 지나쳐 간 거리 (0~1) */
  passFrom: number;
  pass: boolean;
}

function layoutOf(focus: number[], mode: NoonState["mode"], seat: number): { x: number; z: number; yaw: number } {
  const i = focus.indexOf(seat);
  if (mode === "tournament") {
    const side = i === 0 ? -1 : 1;
    return { x: side * DUEL_X, z: 0, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  const n = focus.length;
  const r = 2.1 + n * 0.22;
  const a = (i / n) * Math.PI * 2 + Math.PI / n;
  const x = Math.sin(a) * r;
  const z = Math.cos(a) * r;
  return { x, z, yaw: Math.atan2(-x, -z) };
}

/** 이 자리가 지금 어떤 자세여야 하는지 (상태만 보고). `u` = 결과가 나온 뒤 지난 초. */
function targetMode(s: NoonState, seat: number, u: number): { mode: SamuraiMode; pass: boolean } {
  const b = s.bout;
  if (s.phase === "finished") {
    if (s.ranking?.[0] === seat) return { mode: "cheer", pass: false };
    return { mode: s.mode === "brawl" && !s.alive[seat] ? "down" : "idle", pass: false };
  }
  if (s.mode === "brawl" && !s.alive[seat] && !(b?.phase === "result" && b.participants.includes(seat))) return { mode: "down", pass: false };
  if (!b || s.phase !== "bout" || !b.participants.includes(seat)) return { mode: "idle", pass: false };
  const rec = b.draws[seat];
  if (b.phase === "ready") return { mode: "stance", pass: false };
  if (b.phase === "wait") return { mode: rec?.kind === "early" ? "stumble" : "tense", pass: false };
  if (b.phase === "draw") return { mode: rec ? (rec.kind === "early" ? "stumble" : rec.kind === "valid" ? "slash" : "tense") : "tense", pass: false };
  const res = b.result;
  if (!res) return { mode: "tense", pass: false };
  const v = res.verdicts[seat]?.v ?? "miss";
  let lost = false;
  let won = false;
  if (s.mode === "tournament") {
    const pt = res.points?.find((p) => {
      const m = s.bracket[s.round]?.[p.match];
      return m && (m.a === seat || m.b === seat);
    });
    won = pt?.winner === seat;
    lost = !!pt && pt.winner !== null && pt.winner !== seat;
  } else {
    lost = !!res.hits?.some((h) => h.seat === seat);
    won = !lost;
  }
  const base: SamuraiMode = v === "valid" ? "slash" : v === "early" ? "stumble" : "tense";
  const pass = s.mode === "tournament" && v === "valid" && (won || lost);
  if (lost) return { mode: u > 0.55 ? (s.mode === "brawl" && !s.alive[seat] ? "down" : "kneel") : base, pass };
  if (won && v === "valid") return { mode: u > 1.3 ? "sheathe" : "slash", pass };
  if (v === "valid") return { mode: u > 1.3 ? "sheathe" : "slash", pass: false };
  return { mode: v === "early" ? "stumble" : "stance", pass: false };
}

function SamuraiSlot({
  seat,
  name,
  st,
  focus,
  resultAt,
  lowDetail,
  out,
}: {
  seat: number;
  name: string;
  st: MutableRefObject<NoonState>;
  focus: number[];
  resultAt: MutableRefObject<number>;
  lowDetail: boolean;
  out: boolean;
}) {
  const chars = useRoomCharacters((x) => x.byName);
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const anim = useRef<SeatAnim>({ mode: "idle", since: 0, passFrom: 0, pass: false });
  const frame = useRef<SamuraiFrame>({ x: 0, z: 0, yaw: 0, mode: "idle", since: 0, visible: true });
  const clockRef = useRef(0);
  useFrame(({ clock }) => {
    clockRef.current = clock.elapsedTime;
  });
  const read = () => {
    const s = st.current;
    const t = clockRef.current;
    const a = anim.current;
    const u = t - resultAt.current;
    const want = targetMode(s, seat, u);
    if (want.mode !== a.mode) {
      a.mode = want.mode;
      a.since = t;
    }
    if (want.pass && !a.pass) {
      a.pass = true;
      a.passFrom = t;
    } else if (!want.pass && a.pass) a.pass = false;
    const L = layoutOf(focus, s.mode, seat);
    const f = frame.current;
    f.yaw = L.yaw;
    f.z = L.z;
    if (a.pass) {
      // 서로 스쳐 지나가 반대편으로 (0.16초)
      const k = Math.min(1, (t - a.passFrom) / 0.16);
      const e = 1 - Math.pow(1 - k, 3);
      f.x = L.x + (-L.x * 1.25 - L.x) * e;
      f.z = L.z + (L.x < 0 ? 0.35 : -0.35) * e;
    } else if (a.mode === "stumble") {
      const k = Math.min(1, (t - a.since) / 0.3);
      f.x = L.x * (1 - 0.18 * k);
    } else f.x = L.x;
    f.mode = a.mode;
    f.since = a.since;
    f.visible = true;
    return f;
  };
  return <Samurai look={look} seed={seat * 7 + 3} color={SEAT_COLORS[seat]} lowDetail={lowDetail} out={out} read={read} />;
}

/* ── 카메라·이름표·FX 연결 ─────────────────────────────────────────── */

function Director({
  st,
  focus,
  labels,
  gongHit,
  drumHit,
  flash,
  feintFx,
  resultAt,
  onFps,
}: {
  st: MutableRefObject<NoonState>;
  focus: number[];
  labels: MutableRefObject<(HTMLDivElement | null)[]>;
  gongHit: MutableRefObject<number>;
  drumHit: MutableRefObject<number>;
  flash: MutableRefObject<number>;
  feintFx: MutableRefObject<FeintFx[]>;
  resultAt: MutableRefObject<number>;
  onFps?: (fps: number) => void;
}) {
  const { camera, size } = useThree();
  const seen = useRef({ bout: -1, phase: "", feints: 0, phaseAt: 0 });
  const look = useMemo(() => new THREE.Vector3(), []);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  const fps = useRef({ n: 0, t: 0, reported: false });
  const amb = useRef<THREE.AmbientLight>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const s = st.current;
    const b = s.bout;
    const sn = seen.current;
    if (b) {
      if (b.id !== sn.bout) {
        sn.bout = b.id;
        sn.feints = 0;
        sn.phase = "";
      }
      if (b.phase !== sn.phase) {
        sn.phase = b.phase;
        sn.phaseAt = t;
        if (b.phase === "draw") gongHit.current = t;
        if (b.phase === "result") resultAt.current = t;
      }
      for (; sn.feints < b.feints.length; sn.feints++) {
        const kind = b.feints[sn.feints].kind;
        feintFx.current = [...feintFx.current.slice(-6), { kind, at: t }];
        if (kind === "drum") drumHit.current = t;
        if (kind === "thunder") flash.current = 1;
      }
    }
    flash.current = Math.max(0, flash.current - dt * 2.8);
    if (amb.current) amb.current.intensity = 0.55 + flash.current * 2.2;

    // 카메라
    const duel = s.mode === "tournament";
    const n = Math.max(2, focus.length);
    let px = 0;
    let py = duel ? 1.45 : 4.6 + n * 0.25;
    let pz = duel ? 6.6 : 7.2 + n * 0.35;
    const u = t - sn.phaseAt;
    if (b && s.phase === "bout") {
      if (b.phase === "wait") {
        const k = 1 - Math.exp(-u * 0.25);
        pz -= (duel ? 1.4 : 1.6) * k;
        py -= (duel ? 0.12 : 0.8) * k;
      } else if (b.phase === "draw") {
        pz -= duel ? 1.9 : 2.2;
        py -= duel ? 0.15 : 1;
      } else if (b.phase === "result") {
        const shake = u < 0.5 ? (0.5 - u) * 0.18 : 0;
        px += Math.sin(t * 60) * shake;
        py += Math.cos(t * 53) * shake;
        pz -= (duel ? 0.8 : 1) * Math.exp(-u * 1.2);
      }
    }
    if (s.phase === "finished") {
      px = Math.sin(t * 0.25) * 2;
      pz -= 0.8;
    }
    const lerp = 1 - Math.exp(-dt * (b?.phase === "draw" ? 14 : 3));
    camera.position.x += (px - camera.position.x) * lerp;
    camera.position.y += (py - camera.position.y) * lerp;
    camera.position.z += (pz - camera.position.z) * lerp;
    look.set(0, duel ? 1.05 : 0.8, 0);
    camera.lookAt(look);

    // 이름표
    for (const seat of focus) {
      const el = labels.current[seat];
      if (!el) continue;
      const L = layoutOf(focus, s.mode, seat);
      v3.set(L.x, 2.05, L.z).project(camera);
      const behind = v3.z > 1;
      el.style.opacity = behind ? "0" : "1";
      el.style.transform = `translate(-50%, -100%) translate(${((v3.x + 1) / 2) * size.width}px, ${((1 - v3.y) / 2) * size.height}px)`;
    }

    if (onFps && !fps.current.reported) {
      fps.current.n++;
      fps.current.t += dt;
      if (fps.current.t > 4) {
        fps.current.reported = true;
        onFps(fps.current.n / fps.current.t);
      }
    }
  });
  return <ambientLight ref={amb} intensity={0.55} color="#fff6e6" />;
}

export default function DuelScene({ state, focus, names, quality, labels, onFps }: DuelSceneProps) {
  const st = useRef(state);
  useEffect(() => {
    st.current = state;
  }, [state]);
  const gongHit = useRef(-99);
  const drumHit = useRef(-99);
  const flash = useRef(0);
  const feintFx = useRef<FeintFx[]>([]);
  const resultAt = useRef(-99);
  const high = quality === "high";
  const focusKey = focus.join(",");
  const shownFocus = useMemo(() => (focusKey ? focusKey.split(",").map(Number) : []), [focusKey]);

  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 46, position: [0, 1.6, 7], near: 0.1, far: 300 }} style={{ touchAction: "none" }}>
      <fog attach="fog" args={["#efe4c6", 24, 90]} />
      <Sky flash={flash} />
      <hemisphereLight args={["#fff3da", "#9c8459", 0.75]} />
      <directionalLight
        position={[3, 14, 2.5]}
        intensity={2.1}
        color="#fff4dc"
        castShadow={high}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <Director st={st} focus={shownFocus} labels={labels} gongHit={gongHit} drumHit={drumHit} flash={flash} feintFx={feintFx} resultAt={resultAt} onFps={onFps} />
      <Ground />
      <Fence />
      <Pine position={[6.5, 0, -7]} scale={1.2} />
      <Pine position={[-8, 0, -8.5]} scale={1.4} />
      <Pine position={[9.5, 0, -2]} scale={0.9} />
      <Lantern position={[-3.2, 0, -4.6]} />
      <Lantern position={[3.2, 0, -4.6]} />
      <Gong hit={gongHit} />
      <Drum hit={drumHit} />
      <Feints fx={feintFx} />
      {shownFocus.map((seat) => (
        <SamuraiSlot key={`${seat}-${state.mode}`} seat={seat} name={names[seat] ?? ""} st={st} focus={shownFocus} resultAt={resultAt} lowDetail={!high} out={state.mode === "brawl" && !state.alive[seat]} />
      ))}
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
