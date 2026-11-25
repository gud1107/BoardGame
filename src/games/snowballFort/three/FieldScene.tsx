"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { DASH_MS, FIELD_HL, FIELD_HW, ITEM_INFO, PILES, SEAT_SCARF, SNOWMAN_H, TEAM_COLORS, WALL_H, WALL_LEN, WALL_T, launchFor, sideSign, teamOf } from "../data";
import type { SnapBuffer } from "../net";
import { ballPos, isFrozen, type GameEvent, type MatchState, type PlayerState } from "../sim";
import Kid, { type KidFrame, type KidMode } from "./Kid";

/**
 * 눈싸움 요새전 3D 무대 (룰북 §11): 해 질 녘 눈밭. 가운데선과 울타리, 눈더미, 양 팀 요새(기본
 * 벽 + ☃️ 눈사람 대장, 맞을수록 기울고 부서짐), 세운 눈벽(금 가는 단계), 날아가는 눈덩이(발사값으로
 * 포물선을 직접 계산), 내 조준 포물선 미리보기, 맞음·터짐 눈가루, VRM 캐릭터, 아이템, 눈보라.
 * 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 옮긴다.
 */

export interface SceneShared {
  buf: SnapBuffer;
  mySeat: number;
  shake: number;
  labels: (HTMLDivElement | null)[];
  /** 마우스 위치 (캔버스 NDC) — 데스크톱 조준 */
  pointer: { x: number; y: number } | null;
  /** 마우스 아래 눈밭 위 점 (장면이 매 프레임 계산) */
  aimWorld: { x: number; z: number } | null;
  /** 내 조준 미리보기 (힘 모으는 중) */
  preview: { aim: number; pow: number } | null;
}

export interface FxItem {
  ev: GameEvent;
  at: number;
  /** 구르기 시작한 곳 */
  x?: number;
  z?: number;
}

export interface FieldSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  mySeat: number;
  seatCount: number;
  quality: "high" | "low";
  fx: FxItem[];
  onFps?: (fps: number) => void;
}

const v3 = new THREE.Vector3();

/* ── 하늘·땅 ───────────────────────────────────────────────────────── */

function snowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#eef4fa";
  g.fillRect(0, 0, 512, 512);
  let s = 5;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(${150 + rnd() * 60},${180 + rnd() * 50},${210 + rnd() * 40},${0.05 + rnd() * 0.08})`;
    g.beginPath();
    g.arc(rnd() * 512, rnd() * 512, 1 + rnd() * 6, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 8);
  return t;
}

function Ground({ quality }: { quality: "high" | "low" }) {
  const tex = useMemo(() => snowTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const trees = useMemo(() => {
    const n = quality === "high" ? 40 : 18;
    return Array.from({ length: n }, (_, i) => {
      const a = i * 2.399963 + 0.4;
      const rx = FIELD_HW + 4 + ((i * 37) % 11) * 0.9;
      const rz = FIELD_HL + 4 + ((i * 53) % 9) * 0.9;
      return { x: Math.cos(a) * rx, z: Math.sin(a) * rz, s: 1.3 + ((i * 7) % 5) * 0.3 };
    });
  }, [quality]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[FIELD_HW * 2 + 40, FIELD_HL * 2 + 40]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      {/* 가운데선 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <planeGeometry args={[FIELD_HW * 2, 0.18]} />
        <meshBasicMaterial color="#93c5fd" transparent opacity={0.8} />
      </mesh>
      {/* 진영 바닥 색 띠 (자기 진영 끝) */}
      {[0, 1].map((team) => (
        <mesh key={team} rotation-x={-Math.PI / 2} position={[0, 0.008, sideSign(team) * (FIELD_HL - 0.4)]}>
          <planeGeometry args={[FIELD_HW * 2, 0.8]} />
          <meshBasicMaterial color={TEAM_COLORS[team]} transparent opacity={0.35} />
        </mesh>
      ))}
      {/* 낮은 나무 울타리 */}
      {[
        { x: 0, z: FIELD_HL + 0.3, w: FIELD_HW * 2 + 0.6, d: 0.12 },
        { x: 0, z: -FIELD_HL - 0.3, w: FIELD_HW * 2 + 0.6, d: 0.12 },
        { x: FIELD_HW + 0.3, z: 0, w: 0.12, d: FIELD_HL * 2 + 0.6 },
        { x: -FIELD_HW - 0.3, z: 0, w: 0.12, d: FIELD_HL * 2 + 0.6 },
      ].map((f, i) => (
        <mesh key={i} position={[f.x, 0.35, f.z]} castShadow={quality === "high"}>
          <boxGeometry args={[f.w, 0.7, f.d]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
        </mesh>
      ))}
      {/* 눈더미 */}
      {PILES.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh scale={[1.6, 0.55, 1.6]} castShadow={quality === "high"} receiveShadow>
            <sphereGeometry args={[1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#f8fbff" roughness={1} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
            <ringGeometry args={[2.1, 2.3, 40]} />
            <meshBasicMaterial color="#60a5fa" transparent opacity={0.35} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {/* 나무: 부분마다 인스턴스 하나 (따로 그리면 나무 40그루 = 160번 그리기) */}
      <TreeParts trees={trees} y={0.4}>
        <cylinderGeometry args={[0.12, 0.16, 0.8, 6]} />
        <meshStandardMaterial color="#5b3a24" roughness={1} />
      </TreeParts>
      {[0, 1, 2].map((k) => (
        <TreeParts key={k} trees={trees} y={1.1 + k * 0.75}>
          <coneGeometry args={[1.05 - k * 0.28, 1.25, 8]} />
          <meshStandardMaterial color={k === 2 ? "#f1f7fb" : "#1f5a45"} roughness={0.9} />
        </TreeParts>
      ))}
    </group>
  );
}

function TreeParts({ trees, y, children }: { trees: { x: number; z: number; s: number }[]; y: number; children: ReactNode }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => im.setMatrixAt(i, m.makeScale(t.s, t.s, t.s).setPosition(t.x, y * t.s, t.z)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [trees, y]);
  return (
    <instancedMesh key={trees.length} ref={ref} args={[undefined, undefined, trees.length]}>
      {children}
    </instancedMesh>
  );
}

/** 이번 프레임에 쓴 만큼만 GPU로 보낸다 */
function uploadN(attr: THREE.InstancedBufferAttribute | null, n: number) {
  if (!attr || n === 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

/* ── 눈사람 대장 ────────────────────────────────────────────────────── */

function Snowmen({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  const hitAt = useRef([0, 0]);
  const lastHp = useRef([-1, -1]);
  useFrame(({ clock }) => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    const t = clock.elapsedTime;
    g.children.forEach((c, team) => {
      const m = snap.snowmen[team];
      if (!m) return;
      if (lastHp.current[team] !== m.hp) {
        if (lastHp.current[team] > m.hp) hitAt.current[team] = t;
        lastHp.current[team] = m.hp;
      }
      const frac = m.hp / m.hpMax;
      const shake = Math.max(0, 0.35 - (t - hitAt.current[team])) * 1.6;
      c.position.set(m.x + Math.sin(t * 60) * shake * 0.1, 0, m.z);
      // 많이 맞을수록 옆으로 기울고, 0이면 무너짐
      const down = m.hp <= 0;
      c.rotation.z = down ? 1.35 : (1 - frac) * 0.25 * (team === 0 ? 1 : -1);
      c.scale.set(1, down ? 0.45 : 0.7 + frac * 0.3, 1);
      const head = c.children[2];
      if (head) head.visible = frac > 0.34 || down;
      const bar = c.children[c.children.length - 1] as THREE.Group;
      if (bar) {
        // 우리 눈사람 막대는 낮은 카메라 앞을 가려서 숨김 (화면 위 상태판에 있음)
        bar.visible = !down && team !== shared.current.mySeat % 2;
        const fill = bar.children[1] as THREE.Mesh;
        fill.scale.x = Math.max(0.001, frac);
        fill.position.x = -(1 - frac) * 1.3 * (shared.current.mySeat % 2 === 1 ? -1 : 1);
      }
    });
  });
  return (
    <group ref={group}>
      {[0, 1].map((team) => (
        <group key={team}>
          <mesh position-y={0.62} castShadow>
            <sphereGeometry args={[0.95, 22, 16]} />
            <meshStandardMaterial color="#ffffff" roughness={0.85} />
          </mesh>
          <mesh position-y={1.55} castShadow>
            <sphereGeometry args={[0.66, 20, 14]} />
            <meshStandardMaterial color="#ffffff" roughness={0.85} />
          </mesh>
          <group position-y={2.18}>
            <mesh castShadow>
              <sphereGeometry args={[0.44, 18, 12]} />
              <meshStandardMaterial color="#ffffff" roughness={0.85} />
            </mesh>
            <mesh position={[0, 0.02, sideSign(1 - team) * 0.46]} rotation-x={(sideSign(1 - team) * Math.PI) / 2}>
              <coneGeometry args={[0.07, 0.32, 10]} />
              <meshStandardMaterial color="#f97316" />
            </mesh>
            {[-0.15, 0.15].map((ex) => (
              <mesh key={ex} position={[ex, 0.12, sideSign(1 - team) * 0.38]}>
                <sphereGeometry args={[0.05, 8, 6]} />
                <meshStandardMaterial color="#111827" />
              </mesh>
            ))}
            {/* 팀 색 양동이 모자 */}
            <mesh position-y={0.42}>
              <cylinderGeometry args={[0.3, 0.38, 0.38, 18]} />
              <meshStandardMaterial color={TEAM_COLORS[team]} roughness={0.5} />
            </mesh>
          </group>
          {/* 팀 깃발 */}
          <group position={[0.95, 0, 0]}>
            <mesh position-y={1.4}>
              <cylinderGeometry args={[0.03, 0.03, 2.8, 6]} />
              <meshStandardMaterial color="#6b4423" />
            </mesh>
            <mesh position={[0.3, 2.5, 0]}>
              <planeGeometry args={[0.6, 0.4]} />
              <meshStandardMaterial color={TEAM_COLORS[team]} side={THREE.DoubleSide} />
            </mesh>
          </group>
          {/* 체력 막대 */}
          <group position-y={SNOWMAN_H + 1.1}>
            <mesh>
              <planeGeometry args={[2.8, 0.5]} />
              <meshBasicMaterial color="#0f172a" transparent opacity={0.85} depthWrite={false} fog={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh renderOrder={1}>
              <planeGeometry args={[2.6, 0.34]} />
              <meshBasicMaterial color={TEAM_COLORS[team]} transparent depthWrite={false} fog={false} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/* ── 눈벽 ───────────────────────────────────────────────────────────── */

const MAX_WALLS = 24;

function Walls({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    g.children.forEach((c, k) => {
      const w = snap.walls[k];
      if (!w) {
        c.visible = false;
        return;
      }
      c.visible = true;
      c.position.set(w.x, 0, w.z);
      c.rotation.y = -w.a;
      const frac = w.hp / w.hpMax;
      const body = c.children[0] as THREE.Mesh;
      body.scale.y = 0.55 + frac * 0.45;
      body.position.y = (WALL_H * body.scale.y) / 2;
      ((body.material as THREE.MeshStandardMaterial).color as THREE.Color).setRGB(0.92 + frac * 0.06, 0.95 + frac * 0.04, 1);
      const flag = c.children[1] as THREE.Mesh;
      flag.visible = w.until !== 0;
      ((flag.material as THREE.MeshBasicMaterial).color as THREE.Color).set(TEAM_COLORS[w.team]);
      const crack = c.children[2] as THREE.Mesh;
      crack.visible = frac < 0.7;
      (crack.material as THREE.MeshBasicMaterial).opacity = (1 - frac) * 0.9;
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: MAX_WALLS }, (_, k) => (
        <group key={k} visible={false}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[WALL_LEN, WALL_H, WALL_T]} />
            <meshStandardMaterial color="#f1f7ff" roughness={0.9} />
          </mesh>
          <mesh position={[WALL_LEN / 2 - 0.15, WALL_H + 0.18, 0]}>
            <planeGeometry args={[0.32, 0.22]} />
            <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, WALL_H * 0.55, WALL_T / 2 + 0.005]}>
            <planeGeometry args={[WALL_LEN * 0.8, WALL_H * 0.6]} />
            <meshBasicMaterial color="#64748b" transparent opacity={0.4} depthWrite={false} wireframe />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── 눈덩이·미리보기·아이템 ─────────────────────────────────────────── */

const MAX_BALLS = 80;
/** 보이는 크기만 키움 (판정 반지름은 data.ts 그대로) */
const BALL_DRAW_R = 0.21;
const GIANT_DRAW_R = 0.42;
/** 꼬리: 지난 위치 잔상 개수·간격 */
const TRAIL_N = 6;
const TRAIL_MS = 26;
const TEAM_COLOR3 = TEAM_COLORS.map((c) => new THREE.Color(c));

function Balls({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const inst = useRef<THREE.InstancedMesh>(null);
  const shadows = useRef<THREE.InstancedMesh>(null);
  const shells = useRef<THREE.InstancedMesh>(null);
  const trails = useRef<THREE.InstancedMesh>(null);
  const arc = useRef<THREE.Points>(null);
  const land = useRef<THREE.Mesh>(null);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const arcGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    return g;
  }, []);
  useEffect(() => () => arcGeo.dispose(), [arcGeo]);
  useFrame(() => ballsFrame(shared.current, inst.current, shadows.current, shells.current, trails.current, arc.current, land.current, arcGeo, m4));
  return (
    <group>
      <instancedMesh ref={inst} args={[undefined, undefined, MAX_BALLS]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.7} emissive="#dbeafe" emissiveIntensity={0.35} />
      </instancedMesh>
      {/* 흰 눈밭 위에서도 보이게: 던진 팀 색 테두리 + 꼬리 */}
      <instancedMesh ref={shells} args={[undefined, undefined, MAX_BALLS]} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshBasicMaterial color="#ffffff" side={THREE.BackSide} fog={false} />
      </instancedMesh>
      <instancedMesh ref={trails} args={[undefined, undefined, MAX_BALLS * TRAIL_N]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} fog={false} />
      </instancedMesh>
      <instancedMesh ref={shadows} args={[undefined, undefined, MAX_BALLS]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 0.01, 12]} />
        <meshBasicMaterial color="#1e293b" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
      <points ref={arc} geometry={arcGeo} visible={false} frustumCulled={false}>
        <pointsMaterial color="#facc15" size={0.16} sizeAttenuation transparent opacity={0.9} depthWrite={false} />
      </points>
      <mesh ref={land} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.35, 0.5, 28]} />
        <meshBasicMaterial color="#facc15" transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 눈덩이 + 내 조준 포물선 (매 프레임, 컴포넌트 밖 — 공유 객체·지오메트리를 고친다) */
function ballsFrame(sh: SceneShared, im: THREE.InstancedMesh | null, sm: THREE.InstancedMesh | null, shell: THREE.InstancedMesh | null, trail: THREE.InstancedMesh | null, pts: THREE.Points | null, landMesh: THREE.Mesh | null, arcGeo: THREE.BufferGeometry, m4: THREE.Matrix4) {
  {
    const snap = sh.buf.latest();
    if (!snap || !im || !sm || !shell || !trail) return;
    const now = performance.now();
    const t = sh.buf.simNow(now);
    let n = 0;
    let tn = 0;
    for (const b of snap.balls) {
      if (n >= MAX_BALLS) break;
      const p = ballPos(b, Math.max(b.t0, t));
      if (p.y < -0.5) continue;
      const r = b.big ? GIANT_DRAW_R : BALL_DRAW_R;
      m4.makeScale(r, r, r).setPosition(p.x, Math.max(r * 0.5, p.y), p.z);
      im.setMatrixAt(n, m4);
      m4.makeScale(r * 1.1, 1, r * 1.1).setPosition(p.x, 0.02, p.z);
      sm.setMatrixAt(n, m4);
      const color = TEAM_COLOR3[b.team];
      m4.makeScale(r * 1.28, r * 1.28, r * 1.28).setPosition(p.x, Math.max(r * 0.5, p.y), p.z);
      shell.setMatrixAt(n, m4);
      shell.setColorAt(n, color);
      for (let k = 1; k <= TRAIL_N; k++) {
        const tt = t - k * TRAIL_MS;
        if (tt <= b.t0) break;
        const q = ballPos(b, tt);
        const tr = r * (0.95 - k * 0.12);
        m4.makeScale(tr, tr, tr).setPosition(q.x, Math.max(tr * 0.5, q.y), q.z);
        trail.setMatrixAt(tn, m4);
        trail.setColorAt(tn, color);
        tn++;
      }
      n++;
    }
    im.count = n;
    sm.count = n;
    shell.count = n;
    trail.count = tn;
    uploadN(im.instanceMatrix, n);
    uploadN(sm.instanceMatrix, n);
    uploadN(shell.instanceMatrix, n);
    uploadN(shell.instanceColor, n);
    uploadN(trail.instanceMatrix, tn);
    uploadN(trail.instanceColor, tn);
    // 내 조준 포물선
    const pv = sh.preview;
    const me = snap.players[sh.mySeat];
    if (pts && landMesh) {
      const show = !!pv && !!me && !isFrozen(me, snap.t) && snap.phase === "fight";
      pts.visible = show;
      landMesh.visible = show;
      if (show && pv && me) {
        const pose = sh.buf.ahead(sh.mySeat, now) ?? { x: me.x, z: me.z };
        const L = launchFor(pv.pow);
        const c = Math.cos(pv.aim);
        const s = Math.sin(pv.aim);
        const pos = arcGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < 40; i++) {
          const tt = (i / 39) * L.time * 1.05;
          pos.setXYZ(i, pose.x + c * (0.57 + L.vh * tt), Math.max(0.05, 1.45 + L.vy * tt - 7 * tt * tt), pose.z + s * (0.57 + L.vh * tt));
        }
        pos.needsUpdate = true;
        landMesh.position.set(pose.x + c * (0.57 + L.range), 0.03, pose.z + s * (0.57 + L.range));
      }
    }
  }
}

function emojiTexture(emoji: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "96px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Items({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  const tex = useMemo(() => ({ cocoa: emojiTexture(ITEM_INFO.cocoa.emoji), giant: emojiTexture(ITEM_INFO.giant.emoji) }), []);
  useEffect(
    () => () => {
      tex.cocoa.dispose();
      tex.giant.dispose();
    },
    [tex],
  );
  useFrame(({ clock }) => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    g.children.forEach((c, k) => {
      const it = snap.items[k];
      c.visible = !!it;
      if (!it) return;
      c.position.set(it.x, 0.9 + Math.sin(clock.elapsedTime * 3 + k) * 0.15, it.z);
      const sp = c.children[0] as THREE.Sprite;
      (sp.material as THREE.SpriteMaterial).map = tex[it.kind];
      const ring = c.children[1] as THREE.Mesh;
      ring.position.y = -0.85;
      ((ring.material as THREE.MeshBasicMaterial).color as THREE.Color).set(ITEM_INFO[it.kind].color);
    });
  });
  return (
    <group ref={group}>
      {[0, 1].map((k) => (
        <group key={k} visible={false}>
          <sprite scale={[1, 1, 1]}>
            <spriteMaterial map={tex.cocoa} transparent depthWrite={false} />
          </sprite>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.55, 0.7, 28]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.8} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── 눈가루 연출 ───────────────────────────────────────────────────── */

const PUFF_N = 260;

function Puffs({ fx, low }: { fx: FxItem[]; low: boolean }) {
  const inst = useRef<THREE.InstancedMesh>(null);
  const parts = useRef<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; born: number; life: number; s: number }[]>([]);
  const seen = useRef(new Set<number>());
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  useEffect(() => {
    for (const f of fx) {
      if (seen.current.has(f.ev.id)) continue;
      seen.current.add(f.ev.id);
      const e = f.ev;
      let x = 0;
      let y = 0;
      let z = 0;
      let n = 0;
      let pow = 1;
      if (e.k === "splat" || e.k === "hit" || e.k === "wallHit" || e.k === "snowman") {
        x = e.x;
        y = e.y;
        z = e.z;
        n = e.k === "splat" ? (e.big ? 22 : 9) : e.k === "snowman" ? 16 : 12;
        pow = e.k === "splat" && e.big ? 2 : 1;
      } else if (e.k === "wallBreak" || e.k === "freeze") {
        x = e.x;
        y = 0.6;
        z = e.z;
        n = 28;
        pow = 1.6;
      } else if (e.k === "dash" && f.x !== undefined && f.z !== undefined) {
        x = f.x;
        y = 0.2;
        z = f.z;
        n = 12;
        pow = 0.7;
      } else continue;
      if (low) n = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (1 + Math.random() * 3) * pow;
        parts.current.push({ x, y: Math.max(0.1, y), z, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 3 * pow, vz: Math.sin(a) * sp, born: f.at, life: 500 + Math.random() * 400, s: 0.05 + Math.random() * 0.08 });
      }
    }
    if (seen.current.size > 500) seen.current = new Set(fx.map((f) => f.ev.id));
    if (parts.current.length > PUFF_N) parts.current.splice(0, parts.current.length - PUFF_N);
  }, [fx, low]);
  useFrame(() => {
    const im = inst.current;
    if (!im) return;
    const now = performance.now();
    parts.current = parts.current.filter((p) => now - p.born < p.life);
    let n = 0;
    for (const p of parts.current) {
      const t = (now - p.born) / 1000;
      const y = p.y + p.vy * t - 6 * t * t;
      const k = 1 - (now - p.born) / p.life;
      m4.makeScale(p.s * k, p.s * k, p.s * k).setPosition(p.x + p.vx * t, Math.max(0.02, y), p.z + p.vz * t);
      im.setMatrixAt(n++, m4);
    }
    im.count = n;
    uploadN(im.instanceMatrix, n);
  });
  return (
    <instancedMesh ref={inst} args={[undefined, undefined, PUFF_N]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshBasicMaterial color="#ffffff" />
    </instancedMesh>
  );
}

function Snowfall({ shared, heavy }: { shared: MutableRefObject<SceneShared>; heavy: boolean }) {
  const pts = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = heavy ? 1400 : 500;
    const pos = new Float32Array(n * 3);
    let seed = 17;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * (FIELD_HW * 2 + 10);
      pos[i * 3 + 1] = rnd() * 14;
      pos[i * 3 + 2] = (rnd() - 0.5) * (FIELD_HL * 2 + 10);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [heavy]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dtRaw) => snowFrame(geo, pts.current, !!shared.current.buf.latest()?.blizzard, Math.min(dtRaw, 0.05)));
  return (
    <points ref={pts} geometry={geo} frustumCulled={false}>
      <pointsMaterial color="#ffffff" size={0.12} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}

function snowFrame(geo: THREE.BufferGeometry, pts: THREE.Points | null, blizzard: boolean, dt: number) {
  {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const fall = blizzard ? 3.2 : 1.1;
    const wind = blizzard ? 2.5 : 0.3;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - fall * dt;
      let x = p.getX(i) + wind * dt;
      if (y < 0) y += 14;
      if (x > FIELD_HW + 5) x -= FIELD_HW * 2 + 10;
      p.setXY(i, x, y);
    }
    p.needsUpdate = true;
    if (pts) (pts.material as THREE.PointsMaterial).opacity = blizzard ? 0.95 : 0.7;
  }
}

const ROLL_MS = 460;

/* ── 캐릭터 ─────────────────────────────────────────────────────────── */

export function modeOf(snap: MatchState, p: PlayerState, now: number): KidMode {
  if (snap.phase === "gameOver") return snap.ranks?.[p.seat] === 1 ? "cheer" : "sad";
  if (snap.phase === "roundEnd") {
    const w = snap.history[snap.history.length - 1]?.winner;
    return w === p.team ? "cheer" : w === -1 ? "idle" : "sad";
  }
  if (isFrozen(p, snap.t)) return "frozen";
  if (snap.t < p.dashUntil) return "dash";
  if (snap.t < p.stallUntil) return "build";
  if (snap.t - p.lastThrowAt < 280 && p.lastThrowAt > 0) return "throw";
  if (p.chargeAt) return "charge";
  if (p.gathering) return "gather";
  void now;
  return Math.hypot(p.vx, p.vz) > 0.5 ? "run" : "idle";
}

const KidSlot = memo(function KidSlot({ seat, names, shared, lowDetail }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<KidFrame>({ x: 0, z: 0, face: 0, mode: "idle", speed: 0, charge: 0, visible: false, cocoa: false, giant: false, roll: -1, rollDir: 0 });
  const hitUntil = useRef(0);
  const lastHp = useRef(-1);
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
    if (lastHp.current > p.hp && p.hp > 0) hitUntil.current = now + 300;
    lastHp.current = p.hp;
    f.visible = true;
    f.x = pose.x;
    f.z = pose.z;
    f.face = pose.face;
    let mode = modeOf(snap, p, now);
    if (now < hitUntil.current && mode !== "frozen") mode = "hit";
    // 구르기: 판정(0.23초 미끄러짐)보다 조금 길게, 앞구르기 한 바퀴를 끝까지 보여 준다
    const at = (seat === sh.mySeat ? sh.buf.simLive(now) : sh.buf.simNow(now)) - (p.dashUntil - DASH_MS);
    const rolling = p.dashUntil > 0 && at >= 0 && at < ROLL_MS && mode !== "frozen" && snap.phase === "fight";
    f.roll = rolling ? at / ROLL_MS : -1;
    f.rollDir = Math.atan2(p.dashZ, p.dashX);
    if (rolling) mode = "dash";
    else if (mode === "dash") mode = "run";
    f.mode = mode;
    f.speed = Math.min(1, Math.hypot(p.vx, p.vz) / 4.6);
    f.charge = p.chargeAt ? Math.min(1, (snap.t - p.chargeAt) / 900) : 0;
    f.cocoa = snap.t < p.cocoaUntil;
    f.giant = p.giant;
    return f;
  };
  return <Kid look={look} seed={seat * 17 + 5} teamColor={TEAM_COLORS[teamOf(seat)]} scarf={SEAT_SCARF[seat % SEAT_SCARF.length]} lowDetail={lowDetail} read={read} />;
});

/* ── 카메라 + 이름표 + 마우스 조준 ──────────────────────────────────── */

type RigState = { cx: number; cz: number; h: number; b: number; ahead: number; init: boolean };
const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitP = new THREE.Vector3();

function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: RigState) {
  const dt = Math.min(dtRaw, 0.05);
  const snap = sh.buf.latest();
  if (!snap) return;
  const now = performance.now();
  const me = snap.players[sh.mySeat];
  const team = me ? me.team : 0;
  const sg = sideSign(team);
  let tx = 0;
  let tz = sg * 4;
  // 싸우는 동안은 내 어깨 뒤 낮은 추적 시점(캐릭터가 크게, 상대 요새가 정면), 준비·결과 땐 높은 전경
  const close = !!me && (snap.phase === "fight" || snap.phase === "roundEnd");
  if (me) {
    const b = sh.buf.ahead(sh.mySeat, now);
    if (b) {
      tx = b.x * 0.9;
      tz = b.z;
    }
  }
  if (snap.phase === "gameOver") {
    tx = 0;
    tz = 0;
  }
  const aspect = size.width / Math.max(1, size.height);
  const portrait = aspect < 0.85;
  const wantH = close ? (portrait ? 8.5 : 5.8) : portrait ? 19 : 14;
  const wantB = close ? (portrait ? 8.5 : 6.6) : portrait ? 15 : 12;
  // 바라보는 곳: 내 앞쪽(상대 진영) 몇 칸
  const wantAhead = close ? (portrait ? 5 : 6) : 4.7;
  const k = st.init ? 1 - Math.exp(-dt * 4) : 1;
  const kz = st.init ? 1 - Math.exp(-dt * 1.6) : 1;
  st.init = true;
  st.cx += (tx - st.cx) * k;
  st.cz += (tz - st.cz) * k;
  st.h += (wantH - st.h) * kz;
  st.b += (wantB - st.b) * kz;
  st.ahead += (wantAhead - st.ahead) * kz;
  const shake = Math.max(0, sh.shake);
  sh.shake = Math.max(0, sh.shake - dt * 2.5);
  const jx = shake > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * shake : 0;
  const jy = shake > 0 ? Math.cos(now * 0.11) * 0.1 * shake : 0;
  camera.position.set(st.cx + jx, st.h + jy, st.cz + sg * st.b);
  camera.lookAt(st.cx * 0.85, 0.6, st.cz - sg * st.ahead);
  // 마우스 아래 눈밭 점
  if (sh.pointer) {
    ray.setFromCamera(new THREE.Vector2(sh.pointer.x, sh.pointer.y), camera);
    if (ray.ray.intersectPlane(ground, hitP) && hitP.distanceTo(ray.ray.origin) < 60) sh.aimWorld = { x: hitP.x, z: hitP.z };
    else {
      // 낮은 시점이라 지평선 위를 가리키면 바닥과 안 만난다 — 그 방향 먼 곳을 조준점으로
      const d = ray.ray.direction;
      const l = Math.hypot(d.x, d.z) || 1;
      sh.aimWorld = { x: ray.ray.origin.x + (d.x / l) * 40, z: ray.ray.origin.z + (d.z / l) * 40 };
    }
  }
  for (let seat = 0; seat < sh.labels.length; seat++) {
    const el = sh.labels[seat];
    if (!el) continue;
    const p = snap.players[seat];
    const b = p ? (seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now)) : null;
    if (!p || !b) {
      el.style.display = "none";
      continue;
    }
    v3.set(b.x, 2.15, b.z).project(camera);
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

function CameraRig({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const st = useRef<RigState>({ cx: 0, cz: 0, h: 14, b: 12, ahead: 4.7, init: false });
  useFrame(({ camera, size }, dtRaw) => rigFrame(camera, size, dtRaw, shared.current, st.current));
  return null;
}

function PointerTracker({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      shared.current.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", move);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", move);
    };
  }, [gl, shared]);
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

function Fog({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const scene = useThree((s) => s.scene);
  useFrame(() => fogFrame(scene, !!shared.current.buf.latest()?.blizzard));
  return null;
}

function fogFrame(scene: THREE.Scene, blizzard: boolean) {
  const f = scene.fog as THREE.Fog | null;
  if (!f) return;
  const near = blizzard ? 18 : 40;
  const far = blizzard ? 55 : 110;
  f.near += (near - f.near) * 0.03;
  f.far += (far - f.far) * 0.03;
}

/** 그림자 지도는 두 프레임에 한 번만 (8인이면 그림자만으로 그리기 수백 번), 처음에 안 보이는 재질까지 미리 컴파일 */
function RenderTuning({ high }: { high: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const n = useRef(0);
  useEffect(() => {
    setShadowAuto(gl, false);
    const id = window.setTimeout(() => void gl.compileAsync(scene, camera).catch(() => {}), 600);
    return () => {
      window.clearTimeout(id);
      setShadowAuto(gl, true);
    };
  }, [gl, scene, camera]);
  useFrame(() => {
    if (high && n.current++ % 2 === 0) refreshShadow(gl);
  });
  return null;
}
function setShadowAuto(gl: THREE.WebGLRenderer, v: boolean) {
  gl.shadowMap.autoUpdate = v;
  gl.shadowMap.needsUpdate = true;
}
function refreshShadow(gl: THREE.WebGLRenderer) {
  gl.shadowMap.needsUpdate = true;
}

export default memo(function FieldScene({ shared, names, mySeat, seatCount, quality, fx, onFps }: FieldSceneProps) {
  const high = quality === "high";
  return (
    <Canvas shadows={high} dpr={high ? [1, 2] : [1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} camera={{ fov: 50, position: [0, 15, 14], near: 0.1, far: 300 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#b9d3ec"]} />
      <fog attach="fog" args={["#c9dcef", 40, 110]} />
      <hemisphereLight args={["#ffe9d6", "#9db8d6", 0.9]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[-10, 18, 8]}
        intensity={1.6}
        color="#ffe3c2"
        castShadow={high}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-FIELD_HW - 2}
        shadow-camera-right={FIELD_HW + 2}
        shadow-camera-top={FIELD_HL + 2}
        shadow-camera-bottom={-FIELD_HL - 2}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0006}
      />
      <Fog shared={shared} />
      <Ground quality={quality} />
      <Snowmen shared={shared} />
      <Walls shared={shared} />
      <Balls shared={shared} />
      <Items shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <KidSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high || (seatCount > 4 && seat !== mySeat)} />
      ))}
      <Puffs fx={fx} low={!high} />
      <Snowfall shared={shared} heavy={high} />
      <CameraRig shared={shared} />
      <PointerTracker shared={shared} />
      <RenderTuning high={high} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 2 : 1.5} />
    </Canvas>
  );
});
