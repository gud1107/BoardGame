"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import Figure, { type FigureAct } from "./figures";
import { HERO_FIGURES } from "./figureSpecs";
import { plateTexture } from "./textures";

/**
 * 플레이어 아바타 — 롤토체스 "꼬마 전설이"처럼 탁자 위를 자유롭게 돌아다니는 대표 캐릭터(고른 영웅의 모습).
 * - 내 아바타: 탁자 바닥을 누르면 그곳으로 걸어감, PC는 WASD·방향키로 걷고 스페이스로 점프, 아바타를 누르면 춤.
 * - 전투가 끝나면 이긴 쪽 아바타가 진 쪽 아바타에게 빛 구슬을 퍼붓는다(Arena3D `avatarStrike`).
 * 위치는 모드(상점/전투)별로 기억해 라운드가 바뀌어도 그 자리에 있다. 표시 전용 — 게임 규칙·동기화와 무관.
 */

export interface AvatarInfo {
  key: string;
  hero: string | null;
  name: string;
  side: 0 | 1;
  hp: number | null;
  controllable?: boolean;
}

export interface AvatarState {
  pos: THREE.Vector3;
  target: THREE.Vector3 | null;
  keys: Set<string>;
  yaw: number;
  walk: number;
  strike?: { start: number; dur: number; to: string };
  hitAt?: number;
  danceAt?: number;
  jumpAt?: number;
}

/** 모드별 마지막 위치(페이지가 살아 있는 동안) */
const memory = new Map<string, THREE.Vector3>();

const now = () => performance.now();
const SPEED = 2.8;

export function Avatar({
  info,
  home,
  bounds,
  registry,
  cur,
  memKey,
}: {
  info: AvatarInfo;
  home: THREE.Vector3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  registry: MutableRefObject<Map<string, AvatarState>>;
  /** Arena의 위치 맵 — `av:<key>`로 넣어 두면 파편·팝업 같은 기존 연출이 아바타에도 그대로 쓰인다 */
  cur: MutableRefObject<{ cur: Map<string, THREE.Vector3> }>;
  memKey: string;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const act = useRef<FigureAct>({ swing: 0, hit: 0, walk: 0 });
  const ring = useRef<THREE.Mesh>(null);
  /** 원근 보정: 위에서 내려다보는 카메라라 화면 가장자리의 키 큰 캐릭터가 바깥으로 누워 보이는 것을 되돌린다 */
  const tilt = useRef<THREE.Group>(null);
  const spec = HERO_FIGURES[info.hero ?? "mage"] ?? HERO_FIGURES.mage;
  const plate = useMemo(() => plateTexture(info.name, info.hp, info.side === 0), [info.name, info.hp, info.side]);

  // 상태 등록(처음 한 번)
  useEffect(() => {
    const map = registry.current;
    if (!map.has(info.key)) {
      map.set(info.key, { pos: (memory.get(memKey) ?? home).clone(), target: null, keys: new Set(), yaw: 0, walk: 0 });
    }
    return () => {
      map.delete(info.key);
    };
    // home은 처음 위치로만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.key, memKey, registry]);

  // 키보드(PC): WASD·방향키 걷기, 스페이스 점프
  useEffect(() => {
    if (!info.controllable) return;
    const MAP: Record<string, string> = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const st = registry.current.get(info.key);
      if (!st) return;
      const k = MAP[e.code];
      if (k) {
        st.keys.add(k);
        st.target = null;
        e.preventDefault();
      } else if (e.code === "Space") {
        st.jumpAt = now();
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = MAP[e.code];
      if (k) registry.current.get(info.key)?.keys.delete(k);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [info.controllable, info.key, registry]);

  useFrame((stt, dtRaw) => {
    const st = registry.current.get(info.key);
    const g = group.current;
    const b = body.current;
    if (!st || !g || !b) return;
    const dt = Math.min(0.05, dtRaw);
    const t0 = now();
    // 이동
    const dir = new THREE.Vector3((st.keys.has("right") ? 1 : 0) - (st.keys.has("left") ? 1 : 0), 0, (st.keys.has("down") ? 1 : 0) - (st.keys.has("up") ? 1 : 0));
    let moving = false;
    if (dir.lengthSq() > 0) {
      dir.normalize();
      st.pos.addScaledVector(dir, SPEED * dt);
      moving = true;
    } else if (st.target) {
      const to = st.target.clone().sub(st.pos).setY(0);
      const d = to.length();
      if (d < 0.05) st.target = null;
      else {
        dir.copy(to).normalize();
        st.pos.addScaledVector(dir, Math.min(d, SPEED * dt));
        moving = true;
      }
    }
    st.pos.x = Math.max(bounds.minX, Math.min(bounds.maxX, st.pos.x));
    st.pos.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, st.pos.z));
    memory.set(memKey, st.pos.clone());
    st.walk += ((moving ? 1 : 0) - st.walk) * Math.min(1, dt * 10);

    // 바라보는 방향: 걷는 방향 → 공격 대상 → 카메라 쪽
    let wantYaw = 0;
    if (moving) wantYaw = Math.atan2(dir.x, dir.z);
    else if (st.strike && t0 - st.strike.start < st.strike.dur) {
      const to = cur.current.cur.get(`av:${st.strike.to}`);
      if (to) wantYaw = Math.atan2(to.x - st.pos.x, to.z - st.pos.z);
    }
    let dy = wantYaw - st.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    st.yaw += dy * Math.min(1, dt * 8);

    g.position.copy(st.pos);
    b.position.set(0, 0, 0);
    b.rotation.set(0, st.yaw, 0);
    // 점프
    if (st.jumpAt !== undefined) {
      const t = (t0 - st.jumpAt) / 600;
      if (t >= 1) st.jumpAt = undefined;
      else if (t >= 0) b.position.y = Math.sin(Math.PI * t) * 0.9;
    }
    // 춤: 빙글빙글 + 깡충
    if (st.danceAt !== undefined) {
      const t = (t0 - st.danceAt) / 1300;
      if (t >= 1) st.danceAt = undefined;
      else if (t >= 0) {
        b.rotation.y = st.yaw + t * Math.PI * 4;
        b.position.y = Math.abs(Math.sin(t * Math.PI * 4)) * 0.35;
      }
    }
    // 공격: 구슬을 던질 때마다 휘두르며 살짝 뜀
    let swing = 0;
    if (st.strike) {
      const t = (t0 - st.strike.start) / st.strike.dur;
      if (t >= 1.15) st.strike = undefined;
      else if (t >= 0 && t < 1) {
        swing = Math.sin(t * Math.PI * 8);
        b.position.y = Math.max(b.position.y, Math.abs(Math.sin(t * Math.PI * 4)) * 0.25);
      }
    }
    // 맞음
    let hit = 0;
    if (st.hitAt !== undefined) {
      const t = (t0 - st.hitAt) / 1000;
      if (t > 0.6) st.hitAt = undefined;
      else if (t >= 0) hit = Math.exp(-t * 7);
    }
    if (tilt.current) {
      const ndc = st.pos.clone().setY(1).project(stt.camera);
      const aspect = stt.size.width / Math.max(1, stt.size.height);
      tilt.current.rotation.z = THREE.MathUtils.clamp(ndc.x, -1.2, 1.2) * 0.32 * Math.min(2.4, Math.max(1, aspect / 1.3));
    }
    act.current.swing = swing;
    act.current.hit = hit;
    act.current.walk = st.walk;
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(t0 / 300) * 0.06);
    cur.current.cur.set(`av:${info.key}`, st.pos.clone());
  });

  const dance = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const st = registry.current.get(info.key);
    if (st && info.controllable) st.danceAt = now();
  };

  return (
    <group ref={group} position={home}>
      <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.52, 40]} />
        <meshBasicMaterial color={info.side === 0 ? "#4ade80" : "#f87171"} toneMapped={false} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group ref={tilt}>
      <group ref={body} onClick={dance} onPointerOver={info.controllable ? () => (document.body.style.cursor = "pointer") : undefined} onPointerOut={() => (document.body.style.cursor = "")}>
        <group scale={1.0}>
          <Figure defId="n_kid" uid={`avatar-${info.key}`} golden={false} actRef={act} spec={spec} />
        </group>
      </group>
      </group>
      <sprite position={[0, 1.95, 0]} scale={[0.95, 0.29, 1]} renderOrder={4}>
        <spriteMaterial map={plate} toneMapped={false} depthTest={false} transparent />
      </sprite>
    </group>
  );
}
