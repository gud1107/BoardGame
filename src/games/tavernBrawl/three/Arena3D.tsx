"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Snap } from "../combat";
import { unitDef } from "../units";
import { popupTexture, statTexture, tagTexture, woodTexture } from "./textures";
import { CLASSES, TRIBES } from "../units";
import Figure, { type FigureAct } from "./figures";
import { StyleFxLayer, fxLife, type StyleFxInput, type StyleFxItem } from "./StyleFx";
import type { AttackKind } from "../attackStyle";
import { unitTip } from "../UnitTooltip";

/**
 * 여관 난투 3D 탁자. 표시 전용: 보이는 건 화면에 넘겨준 유닛뿐이고, 모든 움직임은 시작 시각 기준
 * 닫힌 식(물리 엔진 없음)이라 프레임 속도와 무관하게 같은 연출이 나온다.
 *
 * - side 0 = 아래(카메라 쪽, 나), side 1 = 위(상대). 상점 단계는 side 0만.
 * - 좁은 화면(세로 모바일)에서는 한 편을 앞줄 4 + 뒷줄 3으로 접는다. 공격 순서는 그대로 0번부터.
 * - 연출은 `apiRef`의 명령(attack/hit/die/spawn/…)으로 시작한다(Combat3D가 호출).
 */

export interface ArenaUnit extends Snap {
  side: 0 | 1;
}

export interface ArenaApi {
  attack(from: string, to: string, durMs: number, impactFrac: number, holdFrac: number, ranged?: boolean): void;
  /** 원거리 투사체: from → to, durMs 동안 날아감 */
  projectile(kind: AttackKind, color: string, from: string, to: string, durMs: number): void;
  /** 충돌 순간의 스타일 이펙트(베기 궤적·할퀸 자국·번개…) */
  impactFx(kind: AttackKind, color: string, uid: string, from: string | null, big: boolean): void;
  /** 공격 예고: 조준선 + 표적(durMs 동안) */
  aim(from: string, to: string, durMs: number, color: string, ranged: boolean): void;
  /** 반격: uid가 to 쪽으로 짧게 받아친다 */
  counter(uid: string, to: string): void;
  /** 상점 탁자: 화면 좌표에서 가장 가까운 "끼워 넣을 자리" 번호(0..보드 수) */
  nearestInsert(clientX: number, clientY: number): number;
  hit(uid: string, power: number, from?: string): void;
  die(uid: string, durMs: number): void;
  spawn(uid: string): void;
  glow(uid: string): void;
  burst(uid: string, color: string, count: number, spread: number, size?: number): void;
  ring(uid: string, color: string, size?: number): void;
  popup(uid: string, text: string, color: string, scale?: number): void;
  shake(power: number): void;
}

type Anim = {
  atk?: { start: number; dur: number; impact: number; hold: number; to: string; ranged?: boolean };
  knock?: { start: number; dir: THREE.Vector3; power: number };
  counter?: { start: number; to: string };
  flash?: number;
  die?: { start: number; dur: number };
  spawn?: number;
  glow?: number;
};

const SP = 1.08;
const now = () => performance.now();

function layout(units: ArenaUnit[], mode: "shop" | "combat", compact: boolean): Map<string, THREE.Vector3> {
  const out = new Map<string, THREE.Vector3>();
  for (const side of [0, 1] as const) {
    const list = units.filter((u) => u.side === side);
    const n = list.length;
    const sign = side === 0 ? 1 : -1;
    list.forEach((u, i) => {
      if (!compact) {
        const z = mode === "shop" ? 0 : 1.3 * sign;
        out.set(u.uid, new THREE.Vector3((i - (n - 1) / 2) * SP, 0, z));
      } else {
        const front = Math.min(n, 4);
        const back = n - front;
        const zf = mode === "shop" ? -0.6 : 0.95 * sign;
        const zb = mode === "shop" ? 0.7 : 2.4 * sign;
        if (i < front) out.set(u.uid, new THREE.Vector3((i - (front - 1) / 2) * SP, 0, zf));
        else out.set(u.uid, new THREE.Vector3((i - front - (back - 1) / 2) * SP, 0, zb));
      }
    });
  }
  return out;
}

/** 상점 보드에 끼워 넣을 자리 k(0..n)의 위치 */
function insertPos(units: ArenaUnit[], pos: Map<string, THREE.Vector3>, k: number, compact: boolean): THREE.Vector3 {
  const list = units.filter((u) => u.side === 0);
  const n = list.length;
  if (n === 0) return new THREE.Vector3(0, 0, 0);
  const p = (i: number) => pos.get(list[i].uid)!;
  if (k === 0) return p(0).clone().add(new THREE.Vector3(-SP * 0.55, 0, 0));
  if (k === n) return p(n - 1).clone().add(new THREE.Vector3(SP * 0.55, 0, 0));
  if (compact && k === Math.min(n, 4)) return p(k - 1).clone().add(new THREE.Vector3(SP * 0.55, 0, 0));
  return p(k - 1).clone().lerp(p(k), 0.5);
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t;
function bounce(t: number) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/* ── 공유 상태 ───────────────────────────────────────────── */

interface Shared {
  /** 상점 탁자에서 끼워 넣을 자리들(0..n) */
  inserts: THREE.Vector3[];
  target: Map<string, THREE.Vector3>;
  cur: Map<string, THREE.Vector3>;
  anim: Map<string, Anim>;
  shake: { start: number; power: number };
}

/* ── 토큰 ─────────────────────────────────────────────────── */

const TIER_BASE = ["#334155", "#64748b", "#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#f43f5e"];

function Token({
  u,
  sharedRef,
  selected,
  onPick,
  onGrab,
  size,
  facing,
}: {
  u: ArenaUnit;
  sharedRef: MutableRefObject<Shared>;
  selected: boolean;
  onPick?: (uid: string) => void;
  onGrab?: (uid: string, e: PointerEvent) => void;
  size: number;
  facing: number;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const act = useRef<FigureAct>({ swing: 0, hit: 0 });
  const flashRef = useRef<THREE.PointLight>(null);
  const bubble = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const sel = useRef<THREE.Mesh>(null);
  const d = unitDef(u.defId);
  const m = u.golden ? 2 : 1;
  const atkTex = useMemo(() => statTexture(u.atk, "atk", u.atk > d.atk * m), [u.atk, d.atk, m]);
  const tagTex = useMemo(() => {
    const tribe = d.tribe ? TRIBES[d.tribe] : null;
    const cls = d.cls ? CLASSES[d.cls] : null;
    return tagTexture(`${tribe?.emoji ?? "⚪"}${cls?.emoji ?? ""}`, [tribe?.color ?? "#94a3b8", cls?.color ?? tribe?.color ?? "#94a3b8"]);
  }, [d.tribe, d.cls]);
  const hpTex = useMemo(() => statTexture(Math.max(0, u.hp), "hp", u.hp > d.hp * m), [u.hp, d.hp, m]);

  useFrame(() => {
    const g = group.current;
    const b = body.current;
    if (!g || !b) return;
    const shared = sharedRef.current;
    const t0 = now();
    const target = shared.target.get(u.uid);
    let cur = shared.cur.get(u.uid);
    if (!cur) {
      cur = (target ?? new THREE.Vector3()).clone();
      shared.cur.set(u.uid, cur);
    }
    if (target) cur.lerp(target, 0.14);
    g.position.copy(cur);
    b.position.set(0, 0, 0);
    b.rotation.set(0, facing, 0);
    b.scale.setScalar(1);
    let bright = 1;
    let swing = 0;
    let hit = 0;
    const a = shared.anim.get(u.uid);
    if (a?.atk) {
      const p = (t0 - a.atk.start) / a.atk.dur;
      const to = shared.cur.get(a.atk.to);
      if (p >= 1 || !to) a.atk = undefined;
      else if (p >= 0) {
        const v = to.clone().sub(cur).setY(0);
        const dir = v.clone().normalize();
        const { impact, hold } = a.atk;
        b.rotation.y = Math.atan2(v.x, v.z);
        if (a.atk.ranged) {
          // 원거리: 제자리에서 겨누고(치켜듦) 발사 순간 반동으로 뒤로 밀림
          if (p < 0.25) {
            const e = easeOut(p / 0.25);
            swing = -e;
            b.position.addScaledVector(dir, -0.12 * e).setY(0.08 * e);
            b.scale.setScalar(1 + 0.08 * e);
          } else if (p < 0.4) {
            const e = (p - 0.25) / 0.15;
            swing = -1 + 2 * Math.min(1, e * 2);
            b.position.addScaledVector(dir, -0.12 - 0.18 * Math.sin(Math.PI * e)).setY(0.08);
          } else {
            const r = easeOut((p - 0.4) / 0.6);
            swing = 1 - r;
            b.position.addScaledVector(dir, -0.12 * (1 - r));
            b.rotation.y = facing + (Math.atan2(v.x, v.z) - facing) * (1 - r);
          }
        } else if (p < 0.25) {
          swing = -easeOut(p / 0.25);
          const e = easeOut(p / 0.25);
          b.position.addScaledVector(dir, -0.35 * e).setY(0.25 * e);
          b.rotation.x = -0.25 * e * Math.sign(v.z || 1);
          b.scale.setScalar(1 + 0.18 * e);
        } else if (p < impact) {
          const q = easeIn((p - 0.25) / (impact - 0.25));
          swing = -1 + 2 * q;
          b.position.copy(dir.clone().multiplyScalar(-0.35).lerp(v.clone().multiplyScalar(0.7), q));
          b.position.y = 0.25 + Math.sin(Math.PI * q) * 0.9 - 0.25 * q;
          b.rotation.x = 0.45 * Math.sign(v.z || 1) * q;
          b.scale.setScalar(1.18 + 0.1 * q);
        } else if (p < impact + hold) {
          swing = 1;
          b.position.copy(v.clone().multiplyScalar(0.66));
          b.rotation.x = 0.35 * Math.sign(v.z || 1);
          b.scale.setScalar(1.22);
        } else {
          const r = easeOut((p - impact - hold) / (1 - impact - hold));
          swing = 1 - r;
          b.rotation.y = facing + (Math.atan2(v.x, v.z) - facing) * (1 - r);
          b.position.copy(v.clone().multiplyScalar(0.66 * (1 - r)));
          b.position.y = Math.sin(Math.PI * r) * 0.35;
          b.rotation.x = 0.35 * Math.sign(v.z || 1) * (1 - r);
          b.scale.setScalar(1.22 - 0.22 * r);
        }
      }
    }
    if (a?.knock) {
      const t = (t0 - a.knock.start) / 1000;
      if (t > 0.9) a.knock = undefined;
      else if (t >= 0) {
        const k = t < 0.06 ? t / 0.06 : Math.exp(-(t - 0.06) * 8) * Math.cos((t - 0.06) * 26);
        const amp = Math.min(0.55, 0.12 + a.knock.power * 0.035);
        hit = Math.max(hit, Math.abs(k) * Math.min(1, 0.35 + a.knock.power / 8));
        b.position.addScaledVector(a.knock.dir, amp * k);
        b.rotation.z += 0.35 * k * (a.knock.dir.x >= 0 ? -1 : 1);
        b.rotation.x += -0.3 * k * Math.sign(a.knock.dir.z || 1);
      }
    }
    if (a?.counter) {
      const t = (t0 - a.counter.start) / 420;
      const to = shared.cur.get(a.counter.to);
      if (t >= 1 || !to) a.counter = undefined;
      else if (t >= 0) {
        const v = to.clone().sub(cur).setY(0);
        const k = Math.sin(Math.PI * Math.min(1, t * 1.6));
        b.rotation.y = Math.atan2(v.x, v.z);
        b.position.addScaledVector(v.normalize(), 0.35 * k);
        swing = t < 0.25 ? -t / 0.25 : Math.max(0, 1 - (t - 0.25) / 0.5);
      }
    }
    if (a?.flash !== undefined) {
      const t = (t0 - a.flash) / 1000;
      if (t > 0.5) a.flash = undefined;
      else if (t >= 0) bright = 1 + 5 * Math.exp(-t * 14);
    }
    if (a?.glow !== undefined) {
      const t = (t0 - a.glow) / 1000;
      if (t > 0.5) a.glow = undefined;
      else if (t >= 0) {
        const s = Math.sin((Math.PI * t) / 0.5);
        b.scale.multiplyScalar(1 + 0.3 * s);
        bright = Math.max(bright, 1 + 1.5 * s);
      }
    }
    if (a?.spawn !== undefined) {
      const t = (t0 - a.spawn) / 450;
      if (t >= 1) a.spawn = undefined;
      else if (t >= 0) {
        b.position.y += 2.4 * (1 - bounce(t));
        b.scale.multiplyScalar(0.35 + 0.65 * easeOut(t));
      } else b.scale.setScalar(0.001);
    }
    if (a?.die) {
      const t = Math.min(1, (t0 - a.die.start) / a.die.dur);
      if (t >= 0) {
        if (t < 0.25) {
          b.scale.multiplyScalar(1 + 0.3 * (t / 0.25));
          bright = Math.max(bright, 1 + 4 * (t / 0.25));
        } else {
          const r = (t - 0.25) / 0.75;
          b.scale.multiplyScalar(Math.max(0.001, 1.3 * (1 - easeIn(r))));
          b.rotation.y += r * 6;
          b.position.y -= 0.5 * r;
          bright = 0.4;
        }
      }
    }
    act.current.swing = swing;
    act.current.hit = hit;
    // 번쩍임: 맞은 순간 몸 안쪽에서 흰 빛이 터진다
    if (flashRef.current) flashRef.current.intensity = (bright - 1) * 2.2;
    if (bubble.current) {
      const s = 1 + Math.sin(t0 / 260) * 0.04;
      bubble.current.scale.setScalar(s);
    }
    if (halo.current) halo.current.rotation.z = t0 / 300;
    if (sel.current) sel.current.scale.setScalar(1 + Math.sin(t0 / 180) * 0.08);
  });

  const click = onPick
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onPick(u.uid);
      }
    : undefined;

  return (
    <group ref={group}>
      <group scale={size}>
      <group ref={body}>
        <group
          onClick={
            click ??
            ((e: ThreeEvent<MouseEvent>) => {
              // 누를 데가 없는 3D 말(전투)은 탭하면 설명
              e.stopPropagation();
              unitTip.toggle(u, e.nativeEvent.clientX, e.nativeEvent.clientY);
            })
          }
          onPointerDown={
            onGrab
              ? (e: ThreeEvent<PointerEvent>) => {
                  e.stopPropagation();
                  onGrab(u.uid, e.nativeEvent);
                }
              : undefined
          }
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
            if (e.nativeEvent.pointerType === "mouse") unitTip.show(u, e.nativeEvent.clientX, e.nativeEvent.clientY);
          }}
          onPointerOut={(e: ThreeEvent<PointerEvent>) => {
            document.body.style.cursor = "";
            if (e.nativeEvent.pointerType === "mouse") unitTip.hide();
          }}
        >
          {/* 받침 */}
          <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.44, 0.48, 0.14, 32]} />
            <meshStandardMaterial
              color={u.golden ? "#facc15" : TIER_BASE[d.tier]}
              metalness={u.golden ? 0.85 : 0.35}
              roughness={u.golden ? 0.22 : 0.55}
              emissive={u.golden ? "#a16207" : "#000000"}
              emissiveIntensity={u.golden ? 0.35 : 0}
            />
          </mesh>
          <mesh position={[0, 0.145, 0]}>
            <cylinderGeometry args={[0.38, 0.38, 0.02, 32]} />
            <meshStandardMaterial color="#1c1917" roughness={0.9} />
          </mesh>
          {/* 캐릭터 */}
          <group position={[0, 0.155, 0]} scale={1.2}>
            <Figure defId={u.defId} uid={u.uid} golden={u.golden} actRef={act} />
          </group>
          <pointLight ref={flashRef} position={[0, 0.7, 0.4]} color="#ffffff" intensity={0} distance={1.8} decay={1.5} />
          {/* 종족·직업 꼬리표(전투·상점 모두) — 마우스를 올리면 전체 설명 */}
          <sprite position={[0, 1.72, 0]} scale={[0.46, 0.23, 1]} renderOrder={3}>
            <spriteMaterial map={tagTex} toneMapped={false} depthTest={false} transparent />
          </sprite>
          <sprite position={[-0.34, 0.16, 0.38]} scale={[0.28, 0.28, 1]} renderOrder={2}>
            <spriteMaterial map={atkTex} toneMapped={false} depthTest={false} />
          </sprite>
          <sprite position={[0.34, 0.16, 0.38]} scale={[0.28, 0.28, 1]} renderOrder={2}>
            <spriteMaterial map={hpTex} toneMapped={false} depthTest={false} />
          </sprite>
          {/* 키워드 */}
          {u.kw.includes("shield") && (
            <mesh ref={bubble} position={[0, 0.7, 0]}>
              <sphereGeometry args={[0.7, 24, 16]} />
              <meshStandardMaterial color="#fde68a" emissive="#facc15" emissiveIntensity={0.9} transparent opacity={0.16} depthWrite={false} />
            </mesh>
          )}
          {u.kw.includes("taunt") && (
            <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.55, 0.07, 8, 24]} />
              <meshStandardMaterial color="#78716c" roughness={1} />
            </mesh>
          )}
          {u.kw.includes("reborn") && (
            <group position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <mesh ref={halo}>
                <ringGeometry args={[0.5, 0.58, 32, 1, 0, Math.PI * 0.6]} />
                <meshBasicMaterial color="#67e8f9" toneMapped={false} side={THREE.DoubleSide} />
              </mesh>
            </group>
          )}
          {u.kw.includes("poison") && (
            <mesh position={[0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.4, 0.47, 32]} />
              <meshBasicMaterial color="#4ade80" toneMapped={false} transparent opacity={0.85} />
            </mesh>
          )}
        </group>
      </group>
      </group>
      {selected && (
        <mesh ref={sel} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.66, 40]} />
          <meshBasicMaterial color="#fde047" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/* ── 효과 (파편·고리·숫자) ─────────────────────────────── */

const MAX_PARTS = 700;
const GRAV = -9;

interface Burst {
  start: number;
  origin: THREE.Vector3;
  from: number;
  n: number;
  vel: THREE.Vector3[];
  size: number;
  color: THREE.Color;
}

const RING_N = 12;
const POP_N = 24;

function Effects({ apiRef, sharedRef, addStyleFx }: { apiRef: MutableRefObject<ArenaApi | null>; sharedRef: MutableRefObject<Shared>; addStyleFx: (f: StyleFxInput) => void }) {
  const camera = useThree((st) => st.camera);
  const gl = useThree((st) => st.gl);
  const parts = useRef<THREE.InstancedMesh>(null);
  const bursts = useRef<Burst[]>([]);
  const nextPart = useRef(0);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const ringState = useRef<{ start: number; size: number }[]>(Array.from({ length: RING_N }, () => ({ start: -1e9, size: 1 })));
  const nextRing = useRef(0);
  const pops = useRef<(THREE.Sprite | null)[]>([]);
  const popState = useRef<{ start: number; scale: number; base: THREE.Vector3; aspect: number }[]>(
    Array.from({ length: POP_N }, () => ({ start: -1e9, scale: 1, base: new THREE.Vector3(), aspect: 2 })),
  );
  const nextPop = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const shared = sharedRef.current;
    const posOf = (uid: string) => (shared.cur.get(uid) ?? shared.target.get(uid) ?? new THREE.Vector3()).clone();
    const anim = (uid: string) => {
      let a = shared.anim.get(uid);
      if (!a) {
        a = {};
        shared.anim.set(uid, a);
      }
      return a;
    };
    apiRef.current = {
      attack(from, to, durMs, impactFrac, holdFrac, ranged) {
        anim(from).atk = { start: now(), dur: durMs, impact: impactFrac, hold: holdFrac, to, ranged };
      },
      projectile(kind, color, from, to, durMs) {
        const a = posOf(from).add(new THREE.Vector3(0, 0.85, 0));
        const b = posOf(to).add(new THREE.Vector3(0, 0.7, 0));
        addStyleFx({ type: "proj", kind, color, from: [a.x, a.y, a.z], to: [b.x, b.y, b.z], start: now(), dur: durMs });
      },
      aim(from, to, durMs, color, ranged) {
        const a = posOf(from);
        const b = posOf(to);
        addStyleFx({ type: "aim", color, from: [a.x, a.y, a.z], to: [b.x, b.y, b.z], start: now(), dur: durMs, ranged });
      },
      counter(uid, to) {
        anim(uid).counter = { start: now(), to };
      },
      nearestInsert(clientX, clientY) {
        const rect = gl.domElement.getBoundingClientRect();
        let best = shared.inserts.length - 1;
        let bestD = Infinity;
        shared.inserts.forEach((p, k) => {
          const v = p.clone().setY(0.5).project(camera);
          const x = ((v.x + 1) / 2) * rect.width + rect.left;
          const y = ((1 - v.y) / 2) * rect.height + rect.top;
          const d = Math.hypot(x - clientX, y - clientY);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        });
        return Math.max(0, best);
      },
      impactFx(kind, color, uid, from, big) {
        const at = posOf(uid);
        const dir = from ? at.clone().sub(posOf(from)).setY(0).normalize() : new THREE.Vector3(0, 0, -1);
        addStyleFx({ type: "impact", kind, color, at: [at.x, at.y, at.z], dir: [dir.x, dir.y, dir.z], start: now(), big });
      },
      hit(uid, power, from) {
        const a = anim(uid);
        a.flash = now();
        const dir = from ? posOf(uid).sub(posOf(from)).setY(0).normalize() : new THREE.Vector3(0, 0, -1);
        a.knock = { start: now(), dir, power };
      },
      die(uid, durMs) {
        anim(uid).die = { start: now(), dur: durMs };
      },
      spawn(uid) {
        anim(uid).spawn = now();
      },
      glow(uid) {
        anim(uid).glow = now();
      },
      burst(uid, color, count, spread, size = 1) {
        const n = Math.min(count, 60);
        const vel = Array.from({ length: n }, () => {
          const a = Math.random() * Math.PI * 2;
          const up = 0.4 + Math.random();
          const sp = (0.5 + Math.random()) * spread;
          return new THREE.Vector3(Math.cos(a) * sp, up * spread * 1.2, Math.sin(a) * sp);
        });
        const from = nextPart.current;
        nextPart.current = (nextPart.current + n) % MAX_PARTS;
        bursts.current = bursts.current.filter((b) => now() - b.start < 1400);
        bursts.current.push({ start: now(), origin: posOf(uid).add(new THREE.Vector3(0, 0.7, 0)), from, n, vel, size, color: new THREE.Color(color) });
      },
      ring(uid, color, size = 1) {
        const i = nextRing.current;
        nextRing.current = (i + 1) % ringState.current.length;
        const m = rings.current[i];
        if (!m) return;
        m.position.copy(posOf(uid)).setY(0.05);
        (m.material as THREE.MeshBasicMaterial).color.set(color);
        ringState.current[i] = { start: now(), size };
      },
      popup(uid, text, color, scale = 1) {
        const i = nextPop.current;
        nextPop.current = (i + 1) % popState.current.length;
        const s = pops.current[i];
        if (!s) return;
        const { tex, aspect } = popupTexture(text, color);
        (s.material as THREE.SpriteMaterial).map = tex;
        (s.material as THREE.SpriteMaterial).needsUpdate = true;
        popState.current[i] = { start: now(), scale, base: posOf(uid).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.5, 0.3)), aspect };
      },
      shake(power) {
        shared.shake = { start: now(), power };
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, sharedRef, addStyleFx, camera, gl]);

  useFrame(() => {
    const t0 = now();
    const im = parts.current;
    if (im) {
      for (let i = 0; i < MAX_PARTS; i++) {
        dummy.position.set(0, -50, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      for (const b of bursts.current) {
        const t = (t0 - b.start) / 1000;
        if (t < 0 || t > 1.2) continue;
        for (let k = 0; k < b.n; k++) {
          const v = b.vel[k];
          const y = b.origin.y + v.y * t + 0.5 * GRAV * t * t;
          dummy.position.set(b.origin.x + v.x * t, Math.max(0.03, y), b.origin.z + v.z * t);
          dummy.rotation.set(t * 9 + k, t * 7, 0);
          dummy.scale.setScalar(b.size * Math.max(0, 1 - t / 1.2) * (y < 0.03 ? 0.6 : 1));
          dummy.updateMatrix();
          const idx = (b.from + k) % MAX_PARTS;
          im.setMatrixAt(idx, dummy.matrix);
          im.setColorAt(idx, b.color);
        }
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    ringState.current.forEach((r, i) => {
      const m = rings.current[i];
      if (!m) return;
      const t = (t0 - r.start) / 550;
      if (t < 0 || t > 1) {
        m.visible = false;
        return;
      }
      m.visible = true;
      m.scale.setScalar((0.4 + easeOut(t) * 2.4) * r.size);
      (m.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    });
    popState.current.forEach((p, i) => {
      const s = pops.current[i];
      if (!s) return;
      const t = (t0 - p.start) / 1000;
      if (t < 0 || t > 1) {
        s.visible = false;
        return;
      }
      s.visible = true;
      const punch = t < 0.12 ? 2.3 - 1.4 * (t / 0.12) : t < 0.22 ? 0.9 + 0.25 * ((t - 0.12) / 0.1) : 1.15 - 0.15 * Math.min(1, (t - 0.22) / 0.2);
      const h = 0.55 * p.scale * punch;
      s.scale.set(h * p.aspect, h, 1);
      s.position.copy(p.base).add(new THREE.Vector3(0, easeOut(t) * 0.9, 0));
      (s.material as THREE.SpriteMaterial).opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    });
  });

  return (
    <>
      <instancedMesh ref={parts} args={[undefined, undefined, MAX_PARTS]} frustumCulled={false}>
        <boxGeometry args={[0.09, 0.09, 0.09]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {Array.from({ length: RING_N }, (_, i) => (
        <mesh key={i} ref={(m) => void (rings.current[i] = m)} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.36, 0.44, 48]} />
          <meshBasicMaterial transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {Array.from({ length: POP_N }, (_, i) => (
        <sprite key={i} ref={(s) => void (pops.current[i] = s)} visible={false} renderOrder={10}>
          <spriteMaterial transparent depthTest={false} toneMapped={false} />
        </sprite>
      ))}
    </>
  );
}

/* ── 카메라·조명·탁자 ─────────────────────────────────────── */

function CameraRig({ mode, compact, sharedRef }: { mode: "shop" | "combat"; compact: boolean; sharedRef: MutableRefObject<Shared> }) {
  useFrame((st) => {
    const shared = sharedRef.current;
    const cam = st.camera as THREE.PerspectiveCamera;
    const aspect = st.size.width / Math.max(1, st.size.height);
    const needW = compact ? 5.2 : 8.6;
    const needH = mode === "combat" ? (compact ? 6.2 : 4.4) : compact ? 3.4 : 2.4;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dist = Math.max(needW / (2 * tanH * aspect), needH / (2 * tanH)) * 1.02;
    const dir = (compact ? new THREE.Vector3(0, 0.9, 0.44) : new THREE.Vector3(0, 0.82, 0.57)).normalize();
    const look = new THREE.Vector3(0, 0.35, mode === "combat" ? 0.15 : 0.05);
    cam.position.copy(look).addScaledVector(dir, dist);
    const t = (now() - shared.shake.start) / 1000;
    if (t >= 0 && t < 0.5) {
      const p = Math.min(1, shared.shake.power / 14) * 0.22 * Math.exp(-t * 8);
      cam.position.x += Math.sin(t * 90) * p;
      cam.position.y += Math.cos(t * 70) * p * 0.7;
      cam.position.z += Math.sin(t * 55 + 1) * p * 0.5;
    }
    cam.lookAt(look);
  });
  return null;
}

function Candle({ x, z, phase }: { x: number; z: number; phase: number }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = now() / 1000 + phase;
    const f = 1 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.05;
    if (light.current) light.current.intensity = 6 * f;
    if (flame.current) flame.current.scale.set(1, f, 1);
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.09, 0.1, 0.5, 12]} />
        <meshStandardMaterial color="#fef3c7" roughness={0.8} />
      </mesh>
      <mesh ref={flame} position={[0, 0.58, 0]}>
        <coneGeometry args={[0.05, 0.16, 10]} />
        <meshBasicMaterial color="#fdba74" toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0.8, 0]} color="#ffb366" distance={7} decay={1.6} />
    </group>
  );
}

function Table({ mode }: { mode: "shop" | "combat" }) {
  const wood = useMemo(() => woodTexture(), []);
  return (
    <>
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[12, 0.4, 8]} />
        <meshStandardMaterial map={wood} roughness={0.75} />
      </mesh>
      <mesh position={[0, -2.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#1a0f08" roughness={1} />
      </mesh>
      {mode === "combat" && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[10, 0.05]} />
          <meshBasicMaterial color="#fbbf24" toneMapped={false} transparent opacity={0.5} />
        </mesh>
      )}
      <Candle x={-5.2} z={-3.2} phase={0} />
      <Candle x={5.2} z={-3.2} phase={1.7} />
      <Candle x={-5.2} z={3.0} phase={3.1} />
    </>
  );
}

/* ── 공개 컴포넌트 ───────────────────────────────────────── */

export interface Arena3DProps {
  /** 상점 탁자: 유닛을 꾹 눌러/끌기 시작 */
  onGrab?: (uid: string, e: PointerEvent) => void;
  units: ArenaUnit[];
  mode: "shop" | "combat";
  apiRef: MutableRefObject<ArenaApi | null>;
  selected?: string | null;
  onPick?: (uid: string) => void;
  /** 상점: 손패/보드 유닛을 고른 상태면 끼워 넣을 자리 표시 */
  insert?: { onInsert: (index: number) => void } | null;
  quality?: "high" | "low";
  className?: string;
}

function Scene({ units, mode, apiRef, selected, onPick, onGrab, insert, quality }: Arena3DProps) {
  const { size } = useThree();
  const compact = size.width < 640 || size.width / Math.max(1, size.height) < 1.15;
  const sharedRef = useRef<Shared>({ inserts: [], target: new Map(), cur: new Map(), anim: new Map(), shake: { start: -1e9, power: 0 } });
  const [styleFx, setStyleFx] = useState<StyleFxItem[]>([]);
  const fxSeq = useRef(0);
  const addStyleFx = useCallback((f: StyleFxInput) => {
    const item = { ...f, id: ++fxSeq.current } as StyleFxItem;
    setStyleFx((cur) => [...cur, item]);
    window.setTimeout(() => setStyleFx((cur) => cur.filter((x) => x.id !== item.id)), fxLife(item));
  }, []);
  const pos = useMemo(() => layout(units, mode, compact), [units, mode, compact]);
  // 목표 위치 갱신(현재 위치는 각 토큰이 부드럽게 따라감) — 그리기 전에 반영
  useLayoutEffect(() => {
    sharedRef.current.target = pos;
    const mineCount = units.filter((u) => u.side === 0).length;
    sharedRef.current.inserts = Array.from({ length: mineCount + 1 }, (_, k) => insertPos(units, pos, k, compact));
  }, [pos, units, compact]);
  const mine = units.filter((u) => u.side === 0).length;
  return (
    <>
      <color attach="background" args={["#140c07"]} />
      <fog attach="fog" args={["#140c07", 14, 30]} />
      <ambientLight intensity={0.45} color="#ffe2c2" />
      <hemisphereLight args={["#ffd7a8", "#2a1608", 0.55]} />
      <directionalLight position={[3, 9, 5]} intensity={1.6} color="#fff1dc" castShadow={quality === "high"} shadow-mapSize={[1024, 1024]} />
      <CameraRig mode={mode} compact={compact} sharedRef={sharedRef} />
      <Table mode={mode} />
      {units.map((u) => (
        <Token key={u.uid} u={u} sharedRef={sharedRef} selected={selected === u.uid} onPick={onPick} onGrab={onGrab} size={compact ? 0.95 : 1.05} facing={0} />
      ))}
      {insert &&
        Array.from({ length: mine + 1 }, (_, k) => {
          const p = insertPos(units, pos, k, compact);
          return (
            <mesh
              key={k}
              position={[p.x, 0.03, p.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                insert.onInsert(k);
              }}
              onPointerOver={() => (document.body.style.cursor = "pointer")}
              onPointerOut={() => (document.body.style.cursor = "")}
            >
              <circleGeometry args={[0.3, 28]} />
              <meshBasicMaterial color="#fde047" toneMapped={false} transparent opacity={0.75} />
            </mesh>
          );
        })}
      <Effects apiRef={apiRef} sharedRef={sharedRef} addStyleFx={addStyleFx} />
      <StyleFxLayer items={styleFx} />
    </>
  );
}

export default function Arena3D(props: Arena3DProps) {
  return (
    <div className={props.className ?? "h-72 w-full"}>
      <Canvas
        shadows={props.quality === "high"}
        dpr={props.quality === "high" ? [1, 2] : [1, 1.25]}
        camera={{ fov: 40, near: 0.1, far: 80, position: [0, 8, 6] }}
        gl={{ antialias: props.quality === "high", powerPreference: "high-performance" }}
        onPointerMissed={() => (document.body.style.cursor = "")}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
