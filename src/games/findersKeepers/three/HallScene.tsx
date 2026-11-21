"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { BASKET_R, BOMB_REVEAL_MS, SEAT_COLORS, SEAT_SYMBOLS, TEAM_INFO, TOY_INFO, type ToyKind } from "../data";
import { hallFor, type HallGeo } from "../arena";
import type { SnapBuffer } from "../net";
import { bombOf, isUnderdog, type MatchState, type PlayerState, type Toy } from "../sim";
import { FxLayer, type FxItem } from "./Fx";
import Runner, { type RunnerFrame, type RunnerMode } from "./Runner";
import ToyModel from "./ToyModel";

/**
 * 만지면 내 꺼! 3D 무대 (룰북 §11): 문 닫기 직전 장난감 백화점의 둥근 중앙 홀. 체크무늬 바닥 + 낮은 담,
 * 담 밖 진열장, 가운데를 도는 무빙워크, 둥근 진열대, 자리 색 바구니(깃발 + 쌓인 물건 탑),
 * 바닥·줄 위 장난감(줄은 리본 끈으로 이어짐), 지붕 틈에서 떨어지는 물건(그림자 예고), VRM 캐릭터, 연출, 따라가는 카메라.
 * 이름표는 DOM(보드)이 그리고 여기서는 매 프레임 화면 좌표만 계산해 옮긴다.
 */

export interface SceneShared {
  buf: SnapBuffer;
  mySeat: number;
  shake: number;
  labels: (HTMLDivElement | null)[];
}

export interface HallSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  /** 진열대 (판마다 회전이 달라 상태에서 받는다) */
  stands: { x: number; z: number; r: number }[];
  quality: "high" | "low";
  fx: FxItem[];
  onFps?: (fps: number) => void;
}

/* ── 바닥 · 담 · 진열장 ───────────────────────────────────────────── */

function floorTexture(): THREE.Texture {
  // 큰 체크무늬 · 굵은 줄눈 (얇은 선은 비스듬한 카메라에서 물결무늬가 생겨 피한다)
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  const n = 12;
  const cell = 1024 / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? "#f3e8ff" : "#fbcfe8";
      g.fillRect(i * cell, j * cell, cell, cell);
    }
  g.strokeStyle = "rgba(120,80,140,0.18)";
  g.lineWidth = 6;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, 1024);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * cell);
    g.lineTo(1024, i * cell);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function walkwayTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#334155";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(250,204,21,0.85)";
  g.lineWidth = 14;
  // 방사형 화살표 무늬 (링을 돌려서 움직임을 보인다)
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    g.save();
    g.translate(256, 256);
    g.rotate(a);
    g.beginPath();
    g.moveTo(150, -10);
    g.lineTo(180, 0);
    g.lineTo(150, 10);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Hall({ geo, stands, quality }: { geo: HallGeo; stands: { x: number; z: number; r: number }[]; quality: "high" | "low" }) {
  const tex = useMemo(() => floorTexture(), []);
  const wtex = useMemo(() => walkwayTexture(), []);
  useEffect(
    () => () => {
      tex.dispose();
      wtex.dispose();
    },
    [tex, wtex],
  );
  const R = geo.radius;
  const walk = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const w = geo.walkway;
    if (walk.current && w) walk.current.rotation.z += (Math.min(dt, 0.05) * 1.8) / ((w.r0 + w.r1) / 2);
  });
  const shelves = useMemo(() => {
    const n = Math.round(R * 1.6);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { a, x: Math.cos(a) * (R + 2.2), z: Math.sin(a) * (R + 2.2), hue: (i * 47) % 360 };
    });
  }, [R]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[R, 72]} />
        <meshStandardMaterial map={tex} roughness={0.7} />
      </mesh>
      {/* 바깥 바닥 (담 밖) — 홀 바닥보다 조금 아래라 겹쳐 깜빡이지 않는다 */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.04}>
        <ringGeometry args={[R, R + 6, 72]} />
        <meshStandardMaterial color="#3b2a52" roughness={0.9} />
      </mesh>
      {/* 담 (뚜껑 없는 원통 + 위 테) */}
      <mesh position-y={0.3}>
        <cylinderGeometry args={[R + 0.12, R + 0.12, 0.6, 72, 1, true]} />
        <meshStandardMaterial color="#c084fc" roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position-y={0.6} rotation-x={Math.PI / 2}>
        <torusGeometry args={[R + 0.12, 0.09, 8, 72]} />
        <meshStandardMaterial color="#fde047" roughness={0.35} metalness={0.3} />
      </mesh>
      {geo.walkway && (
        <mesh ref={walk} rotation-x={-Math.PI / 2} position-y={0.015}>
          <ringGeometry args={[geo.walkway.r0, geo.walkway.r1, 64]} />
          <meshStandardMaterial map={wtex} roughness={0.6} />
        </mesh>
      )}
      {/* 진열대 */}
      {stands.map((c, i) => (
        <group key={i} position={[c.x, 0, c.z]}>
          <mesh position-y={0.45} castShadow={quality === "high"} receiveShadow>
            <cylinderGeometry args={[c.r, c.r * 1.05, 0.9, 24]} />
            <meshStandardMaterial color={i % 2 ? "#7dd3fc" : "#fda4af"} roughness={0.5} />
          </mesh>
          <mesh position-y={0.92}>
            <cylinderGeometry args={[c.r * 1.08, c.r * 1.08, 0.06, 24]} />
            <meshStandardMaterial color="#ffffff" roughness={0.4} />
          </mesh>
          {c.r > 0.8 && (
            <group position={[0, 0.95, 0]} scale={1.3}>
              <group position={[-0.2, 0, 0.1]} rotation-y={i}>
                <ToyModel kind={(["duck", "robot", "sock", "gift"] as ToyKind[])[i % 4]} />
              </group>
              <group position={[0.22, 0, -0.12]} rotation-y={i * 2}>
                <ToyModel kind={(["sock", "duck", "robot", "duck"] as ToyKind[])[i % 4]} />
              </group>
            </group>
          )}
        </group>
      ))}
      {/* 담 밖 진열장 (분위기) */}
      {shelves.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation-y={-s.a + Math.PI / 2}>
          <mesh position-y={1.6}>
            <boxGeometry args={[2.6, 3.2, 0.9]} />
            <meshStandardMaterial color="#5b3f7a" roughness={0.8} />
          </mesh>
          {[0.7, 1.6, 2.5].map((y, k) => (
            <mesh key={k} position={[0, y, -0.32]}>
              <boxGeometry args={[2.2, 0.5, 0.3]} />
              <meshStandardMaterial color={`hsl(${(s.hue + k * 60) % 360}, 70%, 62%)`} roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ── 바구니 ─────────────────────────────────────────────────────────── */

const labelCache = new Map<string, THREE.Texture>();
function textTexture(text: string, color: string): THREE.Texture {
  const key = `${text}|${color}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(15,10,30,0.78)";
  g.beginPath();
  g.roundRect(8, 8, 240, 112, 36);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.font = "bold 64px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, t);
  return t;
}

function stackValue(stack: ToyKind[]): number {
  return stack.reduce((a, k) => a + TOY_INFO[k].value, 0);
}

type BasketView = { team: boolean; baskets: MatchState["baskets"] };

function Baskets({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const [view, setView] = useState<BasketView | null>(null);
  const sigRef = useRef("");
  useFrame(() => {
    const snap = shared.current.buf.latest();
    if (!snap) return;
    const next = snap.baskets.map((b) => b.stack.length + ":" + (b.stack[b.stack.length - 1] ?? "")).join("|");
    if (next === sigRef.current) return;
    sigRef.current = next;
    setView({ team: snap.options.mode === "team", baskets: snap.baskets.map((b) => ({ ...b, stack: [...b.stack] })) });
  });
  if (!view) return null;
  const team = view.team;
  return (
    <group>
      {view.baskets.map((b, i) => {
        const color = team ? TEAM_INFO[b.team].color : SEAT_COLORS[b.owner % 8];
        const label = team ? TEAM_INFO[b.team].symbol : SEAT_SYMBOLS[b.owner % 8];
        const shown = b.stack.slice(-10);
        return (
          <group key={i} position={[b.x, 0, b.z]}>
            {/* 바구니 구역 (안에 서면 넣고·지킨다) */}
            <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
              <ringGeometry args={[BASKET_R - 0.12, BASKET_R, 48]} />
              <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position-y={0.018}>
              <circleGeometry args={[BASKET_R - 0.12, 48]} />
              <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} />
            </mesh>
            {/* 바구니 */}
            <mesh position-y={0.3} castShadow>
              <cylinderGeometry args={[0.78, 0.62, 0.6, 20, 1, true]} />
              <meshStandardMaterial color="#d6a46a" roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
            <mesh position-y={0.6} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.78, 0.06, 8, 24]} />
              <meshStandardMaterial color={color} roughness={0.5} />
            </mesh>
            <mesh position-y={0.04}>
              <cylinderGeometry args={[0.6, 0.6, 0.04, 20]} />
              <meshStandardMaterial color="#a0703e" roughness={0.9} />
            </mesh>
            {/* 쌓인 물건 (최근 10개) */}
            {shown.map((k, j) => (
              <group key={j} position={[Math.cos(j * 2.4) * 0.3, 0.12 + j * 0.13, Math.sin(j * 2.4) * 0.3]} rotation-y={j * 1.7} scale={0.85}>
                <ToyModel kind={k} />
              </group>
            ))}
            {/* 깃발 + 점수 */}
            <mesh position={[0.95, 1.1, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 2.2, 8]} />
              <meshStandardMaterial color="#e5e7eb" metalness={0.5} roughness={0.3} />
            </mesh>
            <sprite position={[0.95, 2.45, 0]} scale={[1.3, 0.65, 1]}>
              <spriteMaterial map={textTexture(`${label} ${stackValue(b.stack)}`, color)} transparent depthWrite={false} />
            </sprite>
          </group>
        );
      })}
    </group>
  );
}

/* ── 장난감 · 줄 ─────────────────────────────────────────────────── */

const ownerRingGeo = new THREE.RingGeometry(0.26, 0.34, 20);
const shadowGeo = new THREE.CircleGeometry(0.3, 16);

function ToyMesh({ id, kind, shared }: { id: number; kind: ToyKind; shared: MutableRefObject<SceneShared> }) {
  const g = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const cache = useRef<{ t: Toy | null; snapT: number }>({ t: null, snapT: -1 });
  useFrame(({ clock }) => {
    const sh = shared.current;
    const snap = sh.buf.latest();
    const grp = g.current;
    if (!snap || !grp || !body.current) return;
    if (cache.current.snapT !== snap.t) {
      cache.current = { t: snap.toys.find((x) => x.id === id) ?? null, snapT: snap.t };
    }
    const t = cache.current.t;
    if (!t) {
      grp.visible = false;
      return;
    }
    grp.visible = true;
    const now = performance.now();
    const pos = sh.buf.toy(t, now);
    const time = clock.elapsedTime;
    grp.position.set(pos.x, 0, pos.z);
    const simNow = sh.buf.simNow(now);
    if (t.state === "drop") {
      const left = Math.max(0, t.landAt - simNow);
      const u = Math.min(1, left / 1500);
      body.current.position.y = u * u * 7;
      body.current.rotation.y = time * 6;
      if (shadow.current) {
        shadow.current.visible = true;
        shadow.current.scale.setScalar(0.6 + (1 - u) * 0.8);
      }
    } else {
      if (shadow.current) shadow.current.visible = t.state !== "chain";
      if (t.state === "chain") {
        body.current.position.y = 0.05 + Math.abs(Math.sin(time * 9 + id)) * 0.08;
        body.current.rotation.y = Math.sin(time * 3 + id) * 0.5;
      } else {
        body.current.position.y = 0.02 + Math.sin(time * 2.5 + id) * 0.03;
        body.current.rotation.y = time * 0.8 + id;
      }
    }
    if (ring.current && ringMat.current) {
      const owned = t.state === "chain" && t.owner >= 0;
      ring.current.visible = owned || (t.state === "floor" && simNow < t.noPickUntil);
      if (owned) {
        const shield = simNow < t.shieldUntil;
        ringMat.current.color.set(shield ? "#ffffff" : SEAT_COLORS[t.owner % 8]);
        ringMat.current.opacity = shield ? 0.5 + 0.45 * Math.abs(Math.sin(time * 14)) : 0.9;
      } else {
        ringMat.current.color.set("#64748b");
        ringMat.current.opacity = 0.5;
      }
    }
  });
  const big = kind === "trophy" ? 1.35 : kind === "gift" ? 1.1 : 1.15;
  return (
    <group ref={g} visible={false}>
      <mesh ref={shadow} geometry={shadowGeo} rotation-x={-Math.PI / 2} position-y={0.01}>
        <meshBasicMaterial color="#0b0614" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh ref={ring} geometry={ownerRingGeo} rotation-x={-Math.PI / 2} position-y={0.014} visible={false}>
        <meshBasicMaterial ref={ringMat} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={body} scale={big}>
        <ToyModel kind={kind} />
      </group>
    </group>
  );
}

function Toys({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const [list, setList] = useState<{ id: number; kind: ToyKind }[]>([]);
  const sigRef = useRef("");
  useFrame(() => {
    const snap = shared.current.buf.latest();
    if (!snap) return;
    const sig = snap.toys.map((t) => t.id).join(",");
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setList(snap.toys.map((t) => ({ id: t.id, kind: t.kind })));
    }
  });
  return (
    <group>
      {list.map((t) => (
        <ToyMesh key={t.id} id={t.id} kind={t.kind} shared={shared} />
      ))}
    </group>
  );
}

/** 줄: 몸 → 물건 → 물건 … 을 잇는 리본 끈 (가는 원통 InstancedMesh) */
const MAX_SEGS = 8 * 13;
const segGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 6, 1, true);
segGeo.translate(0, 0.5, 0);
segGeo.rotateX(Math.PI / 2);
const tmpM = new THREE.Matrix4();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpUp = new THREE.Vector3(0, 1, 0);
const tmpC = new THREE.Color();
const tmpS = new THREE.Vector3();

function Ropes({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const m = ref.current;
    const sh = shared.current;
    const snap = sh.buf.latest();
    if (!m || !snap) return;
    const now = performance.now();
    const byId = new Map(snap.toys.map((t) => [t.id, t]));
    let n = 0;
    for (const p of snap.players) {
      if (!p.chain.length) continue;
      const b = p.seat === sh.mySeat ? sh.buf.ahead(p.seat, now) : sh.buf.body(p.seat, now);
      if (!b) continue;
      tmpA.set(b.x, 0.55, b.z);
      tmpC.set(SEAT_COLORS[p.seat % 8]);
      for (const id of p.chain) {
        const t = byId.get(id);
        if (!t || n >= MAX_SEGS) continue;
        const q = sh.buf.toy(t, now);
        tmpB.set(q.x, 0.3, q.z);
        const len = tmpA.distanceTo(tmpB);
        if (len > 1e-3) {
          // lookAt(eye=B, target=A): z축 = B − A → 원통(+Z로 0~1)이 A에서 B로 뻗는다
          tmpM.lookAt(tmpB, tmpA, tmpUp);
          tmpS.set(1, 1, len);
          tmpM.scale(tmpS);
          tmpM.setPosition(tmpA);
          m.setMatrixAt(n, tmpM);
          m.setColorAt(n, tmpC);
          n++;
        }
        tmpA.copy(tmpB);
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[segGeo, undefined, MAX_SEGS]} frustumCulled={false}>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/* ── 캐릭터 ─────────────────────────────────────────────────────────── */

export function modeOf(snap: MatchState, p: PlayerState): RunnerMode {
  if (snap.phase === "gameOver") return snap.ranks?.[p.seat] === 1 ? "cheer" : "sad";
  if (p.move === "stagger") return "stagger";
  if (p.move === "dash") return "dash";
  if (p.inBasket && p.chain.length > 0) return "deposit";
  return Math.hypot(p.vx, p.vz) > 0.6 ? "run" : "idle";
}

function RunnerSlot({ seat, names, shared, lowDetail }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<RunnerFrame>({ x: 0, z: 0, face: 0, mode: "idle", speed: 0, visible: false, bomb: false, bombHot: false, underdog: false, team: null });
  const cutUntil = useRef(0);
  const lastCut = useRef(0);
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
    f.visible = true;
    f.x = pose.x;
    f.z = pose.z;
    f.face = pose.face;
    let mode = modeOf(snap, p);
    const cut = snap.events.find((e) => (e.k === "cut" || e.k === "pass") && e.s === seat && e.id > lastCut.current);
    if (cut) {
      lastCut.current = cut.id;
      cutUntil.current = now + 450;
    }
    if (now < cutUntil.current && mode !== "stagger") mode = "cut";
    f.mode = mode;
    f.speed = Math.min(1, Math.hypot(p.vx, p.vz) / 5);
    const b = bombOf(snap, seat);
    f.bomb = !!b && snap.phase === "fight";
    f.bombHot = !!b && b.fuseAt > 0 && b.fuseAt - snap.t <= BOMB_REVEAL_MS;
    f.underdog = snap.phase === "fight" && isUnderdog(snap, p);
    f.team = snap.options.mode === "team" ? TEAM_INFO[p.team].color : null;
    return f;
  };
  return <Runner look={look} seed={seat * 13 + 5} color={SEAT_COLORS[seat % 8]} lowDetail={lowDetail} read={read} />;
}

/* ── 카메라 + 이름표 ─────────────────────────────────────────────── */

const v3 = new THREE.Vector3();

type RigState = { cx: number; cz: number; ext: number; init: boolean };

/** 카메라: 나 60% + 모두 40% 쪽을 보며, 나와 가까운 사람들이 들어오게. 끝나면 홀 전체. */
function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, st: RigState) {
  const dt = Math.min(dtRaw, 0.05);
  const snap = sh.buf.latest();
  if (!snap) return;
  const geo = hallFor(snap.seatCount);
  const now = performance.now();
  const meP = sh.buf.ahead(sh.mySeat, now);
  let px = 0;
  let pz = 0;
  let pn = 0;
  for (const p of snap.players) {
    const b = sh.buf.body(p.seat, now);
    if (!b) continue;
    px += b.x;
    pz += b.z;
    pn++;
  }
  const gx = pn ? px / pn : 0;
  const gz = pn ? pz / pn : 0;
  let cx = meP ? meP.x * 0.6 + gx * 0.4 : gx;
  let cz = meP ? meP.z * 0.6 + gz * 0.4 : gz;
  let ext = 7.5;
  if (meP) {
    ext = Math.max(ext, Math.hypot(meP.x - cx, meP.z - cz) + 4);
    // 내 바구니도 웬만하면 화면에
    const bk = snap.baskets[snap.players[sh.mySeat]?.basket ?? 0];
    if (bk) ext = Math.max(ext, Math.min(geo.radius, Math.hypot(bk.x - cx, bk.z - cz) * 0.75 + 1.5));
  }
  ext = Math.min(ext, geo.radius + 1.5);
  if (snap.phase === "gameOver" || snap.phase === "countdown") {
    cx = snap.phase === "countdown" && meP ? meP.x * 0.3 : 0;
    cz = snap.phase === "countdown" && meP ? meP.z * 0.3 : 0;
    ext = geo.radius * (snap.phase === "countdown" ? 0.85 : 0.95);
  }
  const k = st.init ? 1 - Math.exp(-dt * 2.4) : 1;
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
  const shake = sh.shake;
  sh.shake = Math.max(0, shake - dt * 2.5);
  const jx = shake > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * shake : 0;
  const jy = shake > 0 ? Math.cos(now * 0.11) * 0.1 * shake : 0;
  camera.position.set(st.cx + jx, Math.sin(pitch) * dist + jy, st.cz + Math.cos(pitch) * dist);
  camera.lookAt(st.cx + jx * 0.5, 0, st.cz + 0.5);
  for (let seat = 0; seat < sh.labels.length; seat++) {
    const el = sh.labels[seat];
    if (!el) continue;
    const b = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
    if (!b) {
      el.style.display = "none";
      continue;
    }
    v3.set(b.x, 1.95, b.z).project(camera);
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

function CameraRig({ shared, radius }: { shared: MutableRefObject<SceneShared>; radius: number }) {
  const st = useRef<RigState>({ cx: 0, cz: 0, ext: radius, init: false });
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

export default function HallScene({ shared, names, seatCount, stands, quality, fx, onFps }: HallSceneProps) {
  const high = quality === "high";
  const geo = hallFor(seatCount);
  const r = geo.radius;
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : [1, 1.5]} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 42, position: [0, 18, 16], near: 0.1, far: 300 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#1e1530"]} />
      <fog attach="fog" args={["#1e1530", 30, 70]} />
      <hemisphereLight args={["#fff1f9", "#6b4f8a", 0.95]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[8, 20, 10]}
        intensity={1.35}
        color="#fff4e6"
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
      <pointLight position={[0, 7, 0]} intensity={30} distance={22} color="#f0abfc" />
      <Hall geo={geo} stands={stands} quality={quality} />
      <Baskets shared={shared} />
      <Toys shared={shared} />
      <Ropes shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <RunnerSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} />
      ))}
      <FxLayer items={fx} />
      <CameraRig shared={shared} radius={r} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
