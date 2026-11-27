"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { arenaGeo, HEX } from "../arena";
import { BIG_SCALE, FALL_GONE_Y, ITEM_INFO, POST_R, SEAT_COLORS, WARN_MS } from "../data";
import type { SnapBuffer } from "../net";
import type { MatchState, PlayerState } from "../sim";
import { FallPuffs, FxLayer, type FxItem } from "./Fx";
import Rider, { type RiderFrame, type RiderPose } from "./Rider";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";

/**
 * 범퍼 아레나 3D 무대 (룰북 §11): 구름 위 하늘섬(육각 타일 인스턴스), 범퍼 기둥, 아이템,
 * 튜브 탄 VRM 캐릭터, 유령, 연출, 따라가는 카메라. 이름표·열기 %는 DOM(보드)이 그리고
 * 여기서는 매 프레임 화면 좌표만 계산해 옮겨 준다(글자가 선명하고 색각 이상에도 읽힘).
 */

export interface SceneShared {
  /** 손님/방장 공용 스냅샷 버퍼 */
  buf: SnapBuffer;
  mySeat: number;
  /** 자리별 마지막으로 크게 맞은 시각 (performance.now) */
  hitAt: number[];
  /** 화면 흔들림 세기 (0~1, 보드가 올리고 여기서 줄인다) */
  shake: number;
  /** 이름표 DOM (자리 순서) — 위치만 여기서 옮긴다 */
  labels: (HTMLDivElement | null)[];
}

export interface ArenaSceneProps {
  shared: MutableRefObject<SceneShared>;
  names: Record<number, string>;
  seatCount: number;
  quality: "high" | "low";
  fx: FxItem[];
  puffs: { id: number; at: number; x: number; z: number; seat: number }[];
  onFps?: (fps: number) => void;
}

/* ── 하늘·구름 ─────────────────────────────────────────────────────── */

function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2b6cd8");
  grad.addColorStop(0.45, "#7cc3ff");
  grad.addColorStop(0.62, "#ffe3c2");
  grad.addColorStop(1, "#ffb98a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Sky() {
  const tex = useMemo(() => skyTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh>
      <sphereGeometry args={[140, 24, 16]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

function Clouds({ quality }: { quality: "high" | "low" }) {
  const group = useRef<THREE.Group>(null);
  const puffs = useMemo(() => {
    const n = quality === "high" ? 26 : 12;
    return Array.from({ length: n }, (_, i) => {
      const a = i * 2.399;
      const r = 10 + ((i * 37) % 23);
      return { x: Math.cos(a) * r, y: -7 - ((i * 13) % 9), z: Math.sin(a) * r, s: 2.2 + ((i * 7) % 5) * 0.7 };
    });
  }, [quality]);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.01;
  });
  return (
    <group ref={group}>
      {puffs.map((p, i) => (
        <group key={i} position={[p.x, p.y, p.z]}>
          <mesh scale={[p.s, p.s * 0.55, p.s]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={0.9} />
          </mesh>
          <mesh position={[p.s * 0.8, -0.2, 0.3]} scale={[p.s * 0.7, p.s * 0.4, p.s * 0.7]}>
            <sphereGeometry args={[1, 10, 6]} />
            <meshStandardMaterial color="#f8fbff" roughness={1} transparent opacity={0.9} />
          </mesh>
        </group>
      ))}
      {/* 저 아래 바다 */}
      <mesh rotation-x={-Math.PI / 2} position-y={-26}>
        <circleGeometry args={[130, 40]} />
        <meshStandardMaterial color="#2a7fc4" roughness={0.4} metalness={0.2} />
      </mesh>
    </group>
  );
}

/* ── 섬 (타일 인스턴스) ───────────────────────────────────────────── */

const TOP_H = 0.32;
const GRASS_A = new THREE.Color("#5fc46a");
const GRASS_B = new THREE.Color("#4fb15e");
const CORE = new THREE.Color("#f5c542");
const WARN = new THREE.Color("#ff3b30");
const ROCK = new THREE.Color("#8a6f57");
const ROCK_WARN = new THREE.Color("#5a2b22");

function Island({ shared, rings }: { shared: MutableRefObject<SceneShared>; rings: number }) {
  const geo = arenaGeo(rings);
  const n = geo.tiles.length;
  const top = useRef<THREE.InstancedMesh>(null);
  const rock = useRef<THREE.InstancedMesh>(null);
  const topGeo = useMemo(() => new THREE.CylinderGeometry(HEX * 0.965, HEX * 0.965, TOP_H, 6), []);
  const rockGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(HEX * 0.93, HEX * 0.3, 1.9, 6);
    g.translate(0, -TOP_H / 2 - 0.95, 0);
    return g;
  }, []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    const t = top.current;
    const r = rock.current;
    if (!t || !r) return;
    for (let i = 0; i < n; i++) {
      t.setColorAt(i, GRASS_A);
      r.setColorAt(i, ROCK);
    }
  }, [n]);
  useFrame(() => {
    const t = top.current;
    const r = rock.current;
    const snap = shared.current.buf.latest();
    if (!t || !r || !snap || snap.rings !== rings) return;
    const now = shared.current.buf.simNow(performance.now());
    for (let i = 0; i < n; i++) {
      const tile = geo.tiles[i];
      const f = snap.tiles[i] ?? 0;
      let y = -TOP_H / 2;
      let rx = 0;
      let rz = 0;
      let s = 1;
      const base = tile.ring === 0 ? CORE : (tile.q + tile.r * 2) % 2 === 0 ? GRASS_A : GRASS_B;
      col.copy(base);
      let rc = ROCK;
      if (f > 0) {
        if (now < f) {
          // 흔들림 + 빨갛게 깜빡임 (남은 시간이 줄수록 빨라짐)
          const left = (f - now) / WARN_MS;
          const blink = 0.5 + 0.5 * Math.sin(now * (0.012 + (1 - left) * 0.03));
          col.lerp(WARN, 0.35 + blink * 0.5);
          rc = ROCK_WARN;
          const sh = (1 - left) * 0.07;
          rx = Math.sin(now * 0.05 + i) * sh;
          rz = Math.cos(now * 0.047 + i * 1.3) * sh;
          y += Math.sin(now * 0.09 + i) * 0.02 * (1 - left);
        } else {
          const u = (now - f) / 1000;
          if (u > 2.6) s = 0;
          y -= 0.5 * 14 * u * u;
          rx = u * 0.9 * (i % 2 ? 1 : -1);
          rz = u * 0.6;
          col.lerp(WARN, 0.4);
          rc = ROCK_WARN;
        }
      }
      q.setFromEuler(e.set(rx, 0, rz));
      pos.set(tile.x, y, tile.z);
      scl.setScalar(s);
      m.compose(pos, q, scl);
      t.setMatrixAt(i, m);
      r.setMatrixAt(i, m);
      t.setColorAt(i, col);
      r.setColorAt(i, rc);
    }
    t.instanceMatrix.needsUpdate = true;
    r.instanceMatrix.needsUpdate = true;
    if (t.instanceColor) t.instanceColor.needsUpdate = true;
    if (r.instanceColor) r.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh key={`t${n}`} ref={top} args={[topGeo, undefined, n]} receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh key={`r${n}`} ref={rock} args={[rockGeo, undefined, n]} frustumCulled={false}>
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      {/* 가운데 칸 표시: 끝까지 안 무너짐 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
        <ringGeometry args={[HEX * 0.55, HEX * 0.7, 6]} />
        <meshBasicMaterial color="#fff3b0" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

/* ── 범퍼 기둥 ─────────────────────────────────────────────────────── */

function Posts({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const group = useRef<THREE.Group>(null);
  const posts = useRef<{ x: number; z: number; tile: number }[]>([]);
  useFrame(() => {
    const g = group.current;
    const snap = shared.current.buf.latest();
    if (!g || !snap) return;
    posts.current = snap.posts;
    const now = shared.current.buf.simNow(performance.now());
    g.children.forEach((c, i) => {
      const p = snap.posts[i];
      if (!p) {
        c.visible = false;
        return;
      }
      c.visible = true;
      const f = snap.tiles[p.tile] ?? 0;
      let y = 0;
      if (f > 0 && now >= f) y = -0.5 * 14 * ((now - f) / 1000) ** 2;
      c.position.set(p.x, y, p.z);
      const since = now - p.hitAt;
      const k = p.hitAt > 0 && since < 250 ? 1 + 0.25 * (1 - since / 250) : 1;
      c.scale.set(k, 1, k);
    });
  });
  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <group key={i} visible={false}>
          <mesh position-y={0.45} castShadow>
            <cylinderGeometry args={[POST_R, POST_R * 1.1, 0.9, 20]} />
            <meshStandardMaterial color="#e11d48" roughness={0.4} />
          </mesh>
          <mesh position-y={0.45}>
            <cylinderGeometry args={[POST_R * 1.02, POST_R * 1.02, 0.25, 20]} />
            <meshStandardMaterial color="#ffffff" roughness={0.5} />
          </mesh>
          <mesh position-y={0.92} rotation-x={Math.PI / 2}>
            <torusGeometry args={[POST_R * 0.85, 0.07, 8, 24]} />
            <meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={0.8} />
          </mesh>
        </group>
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
      sprite.position.y = 0.75 + Math.sin(t * 3 + i) * 0.12;
      const mat = sprite.material as THREE.SpriteMaterial;
      const tex = textures[it.kind];
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      // 사라지기 3초 전부터 깜빡임
      const left = it.until - snap.t;
      mat.opacity = left < 3000 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 8)) : 1;
      ring.rotation.z = t * 1.5;
      ((ring.material as THREE.MeshBasicMaterial).color as THREE.Color).set(ITEM_INFO[it.kind].color);
    });
  });
  return (
    <group ref={group}>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} visible={false}>
          <sprite scale={[0.9, 0.9, 0.9]}>
            <spriteMaterial transparent depthWrite={false} />
          </sprite>
          <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
            <ringGeometry args={[0.45, 0.62, 6]} />
            <meshBasicMaterial transparent opacity={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── 캐릭터 ─────────────────────────────────────────────────────────── */

export function poseOf(snap: MatchState, p: PlayerState, hitAt: number, nowMs: number): RiderPose {
  if (p.falling || (!p.alive && p.y < 0)) return "fall";
  if (snap.phase === "gameOver") return snap.ranks?.[p.seat] === 1 ? "cheer" : "sad";
  if (snap.phase === "roundEnd" && p.alive) return snap.history[snap.history.length - 1]?.winner === p.seat ? "cheer" : "idle";
  if (p.jumpAt > 0) return "air";
  if (nowMs - hitAt < 380) return "hit";
  if (snap.t < p.dashUntil) return "dash";
  if (p.bracing) return "brace";
  return Math.hypot(p.vx, p.vz) > 0.7 ? "run" : "idle";
}

function RiderSlot({ seat, names, shared, lowDetail }: { seat: number; names: Record<number, string>; shared: MutableRefObject<SceneShared>; lowDetail: boolean }) {
  const chars = useRoomCharacters((st) => st.byName);
  const name = names[seat] ?? "";
  const look = useMemo(() => resolveLook(seat, ["none"], roomCharacterOf(chars, name)), [seat, chars, name]);
  const frame = useRef<RiderFrame>({ x: 0, y: 0, z: 0, face: 0, pose: "idle", scale: 1, heat: 0, shield: false, turbo: false, visible: false, speed: 0 });
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
    f.visible = p.alive || (p.falling && pose.y > FALL_GONE_Y + 0.5) || (snap.phase === "gameOver" && p.alive);
    f.x = pose.x;
    f.y = pose.y;
    f.z = pose.z;
    f.face = pose.face;
    f.pose = poseOf(snap, p, sh.hitAt[seat] ?? 0, now);
    f.scale = snap.t < p.bigUntil ? BIG_SCALE : 1;
    f.heat = p.heat;
    f.shield = p.shield;
    f.turbo = snap.t < p.turboUntil;
    f.speed = Math.min(1, Math.hypot(p.vx, p.vz) / 5);
    return f;
  };
  return <Rider look={look} seed={seat * 13 + 3} color={SEAT_COLORS[seat % 6]} lowDetail={lowDetail} read={read} />;
}

/** 떨어진 사람 = 유령 (반투명 구름 몸 + 눈) */
function Ghosts({ shared, seatCount }: { shared: MutableRefObject<SceneShared>; seatCount: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    const sh = shared.current;
    const snap = sh.buf.latest();
    if (!g || !snap) return;
    const now = performance.now();
    g.children.forEach((c, seat) => {
      const p = snap.players[seat];
      const gh = p && !p.alive && p.ghost && snap.phase === "fight" ? sh.buf.ghost(seat, now) : null;
      if (!gh) {
        c.visible = false;
        return;
      }
      c.visible = true;
      c.position.set(gh.x, 1.6 + Math.sin(clock.elapsedTime * 2.2 + seat) * 0.15, gh.z);
      c.rotation.y = Math.PI / 2 - gh.face;
      const ready = (p.ghost?.cdAt ?? 0) <= snap.t;
      const body = c.children[0] as THREE.Mesh;
      ((body.material as THREE.MeshStandardMaterial).opacity as number) = ready ? 0.62 : 0.35;
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: seatCount }, (_, seat) => (
        <group key={seat} visible={false}>
          <mesh scale={[0.55, 0.62, 0.55]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color={SEAT_COLORS[seat % 6]} transparent opacity={0.6} emissive={SEAT_COLORS[seat % 6]} emissiveIntensity={0.35} depthWrite={false} />
          </mesh>
          <mesh position={[0, -0.55, -0.15]} rotation-x={0.4} scale={[0.4, 0.6, 0.4]}>
            <coneGeometry args={[1, 1, 12, 1, true]} />
            <meshStandardMaterial color={SEAT_COLORS[seat % 6]} transparent opacity={0.4} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {[-0.18, 0.18].map((ex) => (
            <mesh key={ex} position={[ex, 0.12, 0.47]}>
              <sphereGeometry args={[0.09, 8, 6]} />
              <meshBasicMaterial color="#111827" />
            </mesh>
          ))}
          {/* 입김 방향 */}
          <mesh position={[0, -0.05, 0.72]} rotation-x={Math.PI / 2}>
            <coneGeometry args={[0.1, 0.22, 3]} />
            <meshBasicMaterial color="#e0f2fe" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── 카메라 + 이름표 ─────────────────────────────────────────────── */

const v3 = new THREE.Vector3();

/** 흔들림 줄이기 (공유 객체를 고치는 일은 컴포넌트 밖에서) */
function decayShake(sh: SceneShared, dt: number): number {
  const v = sh.shake;
  sh.shake = Math.max(0, v - dt * 2.5);
  return v;
}

type RigState = { cx: number; cz: number; ext: number; init: boolean };

/** 카메라 따라가기 + 이름표 옮기기 (매 프레임). 공유 객체·DOM을 고치므로 컴포넌트 밖 함수로 둔다. */
function rigFrame(camera: THREE.Camera, size: { width: number; height: number }, dtRaw: number, sh: SceneShared, s0: RigState) {
    const dt = Math.min(dtRaw, 0.05);
    const snap = sh.buf.latest();
    if (!snap) return;
    const geo = arenaGeo(snap.rings);
    const now = performance.now();
    // 남은 타일 범위 + 살아 있는 사람 범위를 둘 다 담는다
    let tx = 0;
    let tz = 0;
    let tn = 0;
    let tr = 0;
    for (let i = 0; i < geo.tiles.length; i++) {
      const f = snap.tiles[i];
      if (f !== 0 && snap.t >= f) continue;
      const t = geo.tiles[i];
      tx += t.x;
      tz += t.z;
      tn++;
    }
    tx /= Math.max(1, tn);
    tz /= Math.max(1, tn);
    for (let i = 0; i < geo.tiles.length; i++) {
      const f = snap.tiles[i];
      if (f !== 0 && snap.t >= f) continue;
      const t = geo.tiles[i];
      tr = Math.max(tr, Math.hypot(t.x - tx, t.z - tz) + HEX);
    }
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
      cx = tx * 0.6 + (px / pn) * 0.4;
      cz = tz * 0.6 + (pz / pn) * 0.4;
    }
    // 섬 전체보단 사람들 위주로 (캐릭터가 너무 작아지지 않게) — 남은 섬의 75%는 늘 담는다
    let ext = Math.max(4.5, tr * 0.75);
    for (const p of snap.players) {
      if (!p.alive) continue;
      const b = sh.buf.body(p.seat, now);
      if (b) ext = Math.max(ext, Math.hypot(b.x - cx, b.z - cz) + 1.6);
    }
    const s = s0;
    const k = s.init ? 1 - Math.exp(-dt * 2.2) : 1;
    s.init = true;
    s.cx += (cx - s.cx) * k;
    s.cz += (cz - s.cz) * k;
    s.ext += (ext - s.ext) * k;
    const aspect = size.width / Math.max(1, size.height);
    const persp = camera as THREE.PerspectiveCamera;
    const vfov = (persp.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fitFov = Math.min(vfov, hfov);
    const dist = (s.ext * 1.05) / Math.tan(fitFov / 2);
    const pitch = aspect < 0.8 ? 1.05 : 0.95;
    const shake = decayShake(sh, dt);
    const jx = shake > 0 ? (Math.sin(now * 0.09) + Math.sin(now * 0.23)) * 0.12 * shake : 0;
    const jy = shake > 0 ? Math.cos(now * 0.11) * 0.1 * shake : 0;
    camera.position.set(s.cx + jx, Math.sin(pitch) * dist + jy, s.cz + Math.cos(pitch) * dist);
    camera.lookAt(s.cx + jx * 0.5, 0, s.cz + 0.6);
    // 이름표 위치 (DOM)
    for (let seat = 0; seat < sh.labels.length; seat++) {
      const el = sh.labels[seat];
      if (!el) continue;
      const p = snap.players[seat];
      if (!p) {
        el.style.display = "none";
        continue;
      }
      let pos: { x: number; z: number; y: number } | null = null;
      if (p.alive || (p.falling && p.y > -1.5)) {
        const b = seat === sh.mySeat ? sh.buf.ahead(seat, now) : sh.buf.body(seat, now);
        if (b) pos = { x: b.x, z: b.z, y: b.y + (snap.t < p.bigUntil ? 2.75 : 2.05) };
      } else if (p.ghost && snap.phase === "fight") {
        const g = sh.buf.ghost(seat, now);
        if (g) pos = { x: g.x, z: g.z, y: 2.45 };
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
  const st = useRef<RigState>({ cx: 0, cz: 0, ext: arenaGeo(rings).radius, init: false });
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

export default function ArenaScene({ shared, names, seatCount, quality, fx, puffs, onFps }: ArenaSceneProps) {
  const high = quality === "high";
  const rings = shared.current.buf.latest()?.rings ?? 4;
  const r = arenaGeo(rings).radius;
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : [1, 1.5]}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 42, position: [0, 14, 14], near: 0.1, far: 300 }}
      style={{ touchAction: "none" }}
    >
      <fog attach="fog" args={["#cfe6ff", 40, 120]} />
      <Sky />
      <hemisphereLight args={["#eaf6ff", "#7a9a6a", 0.9]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[6, 16, 8]}
        intensity={1.6}
        color="#fff1dc"
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-bias={-0.0008}
      />
      <Clouds quality={quality} />
      <Island key={rings} shared={shared} rings={rings} />
      <Posts shared={shared} />
      <Items shared={shared} />
      {Array.from({ length: seatCount }, (_, seat) => (
        <RiderSlot key={seat} seat={seat} names={names} shared={shared} lowDetail={!high} />
      ))}
      <Ghosts shared={shared} seatCount={seatCount} />
      <FxLayer items={fx} />
      <FallPuffs items={puffs} />
      <CameraRig shared={shared} rings={rings} />
      <FpsProbe onFps={onFps} />
      <AdaptiveResolution max={high ? 1.75 : 1.5} />
    </Canvas>
  );
}
