"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Snap } from "../combat";
import { unitDef } from "../units";
import { manaTexture, popupTexture, statTexture, tagTexture, woodTexture } from "./textures";
import { skillOf } from "../skills";
import { CLASSES, TRIBES } from "../units";
import Figure, { type FigureAct } from "./figures";
import { StyleFxLayer, fxLife, type StyleFxInput, type StyleFxItem } from "./StyleFx";
import type { AttackKind } from "../attackStyle";
import { unitTip } from "../UnitTooltip";
import { activeFlashes } from "./flashPool";
import { Avatar, type AvatarInfo, type AvatarState } from "./Avatar";

export type { AvatarInfo };

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
  nearestInsert(clientX: number, clientY: number): { index: number; back: boolean } | null;
  /** 승리 연출: from 아바타가 to 아바타에게 빛 구슬을 퍼붓는다(구슬 수 = 피해, 최대 12) */
  avatarStrike(from: string, to: string, damage: number, durMs: number): void;
  /** 아바타 춤(승리·무승부 세리머니) */
  avatarDance(key: string): void;
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

/** 줄 z 위치: 앞줄은 가운데(상대) 쪽, 뒷줄은 내 쪽 끝 */
function rowZ(mode: "shop" | "combat", back: boolean, sign: number): number {
  if (mode === "shop") return back ? 0.65 : -0.55;
  return (back ? 2.3 : 0.95) * sign;
}

/** 한 줄 안 가로 배치 — 좁은 화면에서 4명이 넘으면 간격을 줄이고 지그재그로 엇갈려 겹침을 줄인다 */
function rowSlots(n: number, compact: boolean): { x: number; dz: number }[] {
  const crowded = compact && n > 4;
  const sp = crowded ? 4.4 / (n - 1) : SP;
  return Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * sp, dz: crowded ? (i % 2 ? 0.24 : -0.24) : 0 }));
}

function layout(units: ArenaUnit[], mode: "shop" | "combat", compact: boolean): Map<string, THREE.Vector3> {
  const out = new Map<string, THREE.Vector3>();
  for (const side of [0, 1] as const) {
    const sign = side === 0 ? 1 : -1;
    for (const back of [false, true]) {
      const list = units.filter((u) => u.side === side && !!u.back === back);
      const slots = rowSlots(list.length, compact);
      const z = rowZ(mode, back, sign);
      list.forEach((u, i) => out.set(u.uid, new THREE.Vector3(slots[i].x, 0, z + slots[i].dz * sign)));
    }
  }
  return out;
}

export interface InsertSlot {
  p: THREE.Vector3;
  /** 보드 전체(앞줄 → 뒷줄) 기준 자리 */
  index: number;
  back: boolean;
}

/** 상점 보드에 끼워 넣을 자리들 — 줄마다 (그 줄 수 + 1)개 */
function insertSlots(units: ArenaUnit[], pos: Map<string, THREE.Vector3>, mode: "shop" | "combat"): InsertSlot[] {
  const mine = units.filter((u) => u.side === 0);
  const frontN = mine.filter((u) => !u.back).length;
  const out: InsertSlot[] = [];
  for (const back of [false, true]) {
    const list = mine.filter((u) => !!u.back === back);
    const z = rowZ(mode, back, 1);
    const n = list.length;
    const p = (i: number) => pos.get(list[i].uid)!;
    for (let k = 0; k <= n; k++) {
      let v: THREE.Vector3;
      if (n === 0) v = new THREE.Vector3(0, 0, z);
      else if (k === 0) v = p(0).clone().add(new THREE.Vector3(-SP * 0.55, 0, 0)).setZ(z);
      else if (k === n) v = p(n - 1).clone().add(new THREE.Vector3(SP * 0.55, 0, 0)).setZ(z);
      else v = p(k - 1).clone().lerp(p(k), 0.5).setZ(z);
      out.push({ p: v, index: (back ? frontN : 0) + k, back });
    }
  }
  return out;
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
  inserts: InsertSlot[];
  target: Map<string, THREE.Vector3>;
  cur: Map<string, THREE.Vector3>;
  anim: Map<string, Anim>;
  shake: { start: number; power: number };
}

/* ── 토큰 ─────────────────────────────────────────────────── */

const TIER_BASE = ["#334155", "#64748b", "#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#f43f5e"];

const Token = memo(TokenImpl);

function TokenImpl({
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
  const flashRef = useRef<THREE.Mesh>(null);
  const bubble = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const sel = useRef<THREE.Mesh>(null);
  const d = unitDef(u.defId);
  const m = u.golden ? 2 : 1;
  const atkTex = useMemo(() => statTexture(u.atk, "atk", u.atk > d.atk * m), [u.atk, d.atk, m]);
  const tagTex = useMemo(() => {
    const tribe = d.tribe ? TRIBES[d.tribe] : null;
    const cls = d.cls ? CLASSES[d.cls] : null;
    return tagTexture(`${tribe?.emoji ?? "⚪"}${cls?.emoji ?? ""}`, [tribe?.color ?? "#94a3b8", cls?.color ?? tribe?.color ?? "#94a3b8"], d.token ? 1 : d.tier, u.golden);
  }, [d.tribe, d.cls, d.tier, d.token, u.golden]);
  const hpTex = useMemo(() => statTexture(Math.max(0, u.hp), "hp", u.hp > d.hp * m), [u.hp, d.hp, m]);
  // 기력 칸(전투만, 직업 있는 유닛만) — 가득 차면 다음 차례에 스킬
  const maxMana = skillOf(u.defId)?.mana ?? 0;
  const manaTex = useMemo(() => (u.mana === undefined || !maxMana ? null : manaTexture(u.mana, maxMana)), [u.mana, maxMana]);

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
    if (flashRef.current) {
      const k = Math.min(1, Math.max(0, (bright - 1) / 4));
      flashRef.current.visible = k > 0.02;
      flashRef.current.scale.setScalar(0.5 + k * 0.35);
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = k * 0.85;
    }
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
          {/* 맞았을 때 번쩍임: 조명 대신 가산 합성 빛망울(조명 수를 바꾸지 않음) */}
          <mesh ref={flashRef} position={[0, 0.7, 0.2]} visible={false}>
            <sphereGeometry args={[1, 12, 10]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
          {/* 등급 별 + 종족·직업 꼬리표(전투·상점 항상 표시) — 마우스를 올리면 전체 설명 */}
          <sprite position={[0, 1.8, 0]} scale={[0.56, 0.39, 1]} renderOrder={3}>
            <spriteMaterial map={tagTex} toneMapped={false} depthTest={false} transparent />
          </sprite>
          <sprite position={[-0.34, 0.16, 0.38]} scale={[0.28, 0.28, 1]} renderOrder={2}>
            <spriteMaterial map={atkTex} toneMapped={false} depthTest={false} />
          </sprite>
          <sprite position={[0.34, 0.16, 0.38]} scale={[0.28, 0.28, 1]} renderOrder={2}>
            <spriteMaterial map={hpTex} toneMapped={false} depthTest={false} />
          </sprite>
          {manaTex && (
            <sprite position={[0, 1.52, 0]} scale={[0.66, 0.13, 1]} renderOrder={3}>
              <spriteMaterial map={manaTex} toneMapped={false} depthTest={false} transparent />
            </sprite>
          )}
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

function Effects({
  apiRef,
  sharedRef,
  addStyleFx,
  avatarsRef,
}: {
  apiRef: MutableRefObject<ArenaApi | null>;
  sharedRef: MutableRefObject<Shared>;
  addStyleFx: (f: StyleFxInput) => void;
  avatarsRef: MutableRefObject<Map<string, AvatarState>>;
}) {
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
  /** 파편이 하나도 없으면 매 프레임 700개 갱신·업로드를 건너뛴다 */
  const partsDirty = useRef(true);
  const flashLights = useRef<(THREE.PointLight | null)[]>([]);

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
      avatarStrike(from, to, damage, durMs) {
        const src = avatarsRef.current.get(from);
        const dst = avatarsRef.current.get(to);
        if (!src || !dst) return;
        src.strike = { start: now(), dur: durMs, to };
        const n = Math.max(1, Math.min(12, damage));
        const fly = 420;
        const gap = Math.max(60, (durMs - fly - 150) / n);
        for (let i = 0; i < n; i++) {
          window.setTimeout(() => {
            this.projectile("bolt", i % 3 === 2 ? "#f472b6" : "#fde047", `av:${from}`, `av:${to}`, fly);
            window.setTimeout(() => {
              dst.hitAt = now();
              this.burst(`av:${to}`, "#fde047", 10, 1.6, 0.9);
              this.shake(2 + Math.min(6, damage * 0.3));
            }, fly);
          }, 120 + i * gap);
        }
        window.setTimeout(() => {
          this.popup(`av:${to}`, `-${damage}`, "#ef4444", Math.min(2.4, 1.3 + damage * 0.06));
          this.ring(`av:${to}`, "#ef4444", 1.6);
          this.burst(`av:${to}`, "#ef4444", 30, 2.4, 1.4);
          this.shake(6 + Math.min(8, damage * 0.4));
          src.danceAt = now() + 250;
        }, 120 + (n - 1) * gap + fly + 40);
      },
      avatarDance(key) {
        const st = avatarsRef.current.get(key);
        if (st) st.danceAt = now();
      },
      nearestInsert(clientX, clientY) {
        const rect = gl.domElement.getBoundingClientRect();
        let best = -1;
        let bestD = Infinity;
        shared.inserts.forEach((slot, k) => {
          const v = slot.p.clone().setY(0.5).project(camera);
          const x = ((v.x + 1) / 2) * rect.width + rect.left;
          const y = ((1 - v.y) / 2) * rect.height + rect.top;
          const d = Math.hypot(x - clientX, y - clientY);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        });
        const hit = shared.inserts[best];
        return hit ? { index: hit.index, back: hit.back } : null;
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
        partsDirty.current = true;
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
  }, [apiRef, sharedRef, addStyleFx, camera, gl, avatarsRef]);

  useFrame(() => {
    const t0 = now();
    const im = parts.current;
    const liveBursts = bursts.current.some((b) => t0 - b.start <= 1250);
    if (im && (liveBursts || partsDirty.current)) {
      partsDirty.current = liveBursts;
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
    // 고정 조명 풀(3개): 이펙트가 요청한 번쩍임만 밝기를 준다
    const fl = activeFlashes(t0);
    flashLights.current.forEach((l, i) => {
      if (!l) return;
      const f = fl[i];
      if (!f) {
        l.intensity = 0;
        return;
      }
      const t = (t0 - f.start) / f.dur;
      l.position.copy(f.pos);
      l.color.set(f.color);
      l.intensity = f.intensity * Math.exp(-t * 5);
    });
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
      {[0, 1, 2].map((i) => (
        <pointLight key={i} ref={(l) => void (flashLights.current[i] = l)} intensity={0} distance={4} decay={1.4} />
      ))}
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

function CameraRig({ mode, compact, sharedRef, withAvatars }: { mode: "shop" | "combat"; compact: boolean; sharedRef: MutableRefObject<Shared>; withAvatars: boolean }) {
  useFrame((st) => {
    const shared = sharedRef.current;
    const cam = st.camera as THREE.PerspectiveCamera;
    const aspect = st.size.width / Math.max(1, st.size.height);
    const needW = compact ? (withAvatars ? 5.6 : 5.2) : withAvatars ? (mode === "combat" ? 11.2 : 10.2) : 8.6;
    const needH = mode === "combat" ? (compact ? (withAvatars ? 7.6 : 6.2) : withAvatars ? 6.8 : 5.6) : compact ? (withAvatars ? 4.4 : 3.4) : withAvatars ? 4.0 : 3.2;
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
  /** 캔버스·셰이더 준비가 끝났을 때(첫 프레임 뒤) */
  onReady?: () => void;
  /** 플레이어 아바타(내 것은 controllable) */
  avatars?: AvatarInfo[];
  /** 상점 탁자: 유닛을 꾹 눌러/끌기 시작 */
  onGrab?: (uid: string, e: PointerEvent) => void;
  units: ArenaUnit[];
  mode: "shop" | "combat";
  apiRef: MutableRefObject<ArenaApi | null>;
  selected?: string | null;
  onPick?: (uid: string) => void;
  /** 상점: 손패/보드 유닛을 고른 상태면 끼워 넣을 자리 표시 */
  insert?: { onInsert: (index: number, back: boolean) => void } | null;
  quality?: "high" | "low";
  className?: string;
  /** 아바타 첫 자리를 탁자 가운데로(영웅 고르기 무대) */
  centerAvatar?: boolean;
}

function avatarHome(side: 0 | 1, mode: "shop" | "combat", compact: boolean): THREE.Vector3 {
  const s = side === 0 ? 1 : -1;
  if (mode === "shop") return compact ? new THREE.Vector3(1.7, 0, 1.55) : new THREE.Vector3(3.5, 0, 0.05);
  return compact ? new THREE.Vector3(1.9 * s, 0, 3.3 * s) : new THREE.Vector3(3.9 * s, 0, 1.25 * s);
}

function Scene({ units, mode, apiRef, selected, onPick, onGrab, insert, quality, avatars, centerAvatar }: Arena3DProps) {
  const { size } = useThree();
  const compact = size.width < 640 || size.width / Math.max(1, size.height) < 1.15;
  const sharedRef = useRef<Shared>({ inserts: [], target: new Map(), cur: new Map(), anim: new Map(), shake: { start: -1e9, power: 0 } });
  const [styleFx, setStyleFx] = useState<StyleFxItem[]>([]);
  const avatarsRef = useRef<Map<string, AvatarState>>(new Map());
  const myAvatar = avatars?.find((a) => a.controllable);
  // 토큰에 넘기는 콜백은 항상 같은 함수(최신 핸들러는 ref로) → 토큰·캐릭터가 불필요하게 다시 그려지지 않음
  const pickRef = useRef(onPick);
  const grabRef = useRef(onGrab);
  useLayoutEffect(() => {
    pickRef.current = onPick;
    grabRef.current = onGrab;
  });
  const stablePick = useCallback((uid: string) => pickRef.current?.(uid), []);
  const stableGrab = useCallback((uid: string, e: PointerEvent) => grabRef.current?.(uid, e), []);
  const bounds = useMemo(
    () =>
      mode === "shop"
        ? compact
          ? { minX: -2.2, maxX: 2.2, minZ: -1.4, maxZ: 1.9 }
          : { minX: -3.9, maxX: 3.9, minZ: -1.2, maxZ: 1.3 }
        : compact
          ? { minX: -2.3, maxX: 2.3, minZ: -3.5, maxZ: 3.5 }
          : { minX: -4.4, maxX: 4.4, minZ: -2.4, maxZ: 2.4 },
    [mode, compact],
  );
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
    sharedRef.current.inserts = insertSlots(units, pos, mode);
  }, [pos, units, mode]);
  return (
    <>
      <color attach="background" args={["#140c07"]} />
      <fog attach="fog" args={["#140c07", 14, 30]} />
      <ambientLight intensity={0.45} color="#ffe2c2" />
      <hemisphereLight args={["#ffd7a8", "#2a1608", 0.55]} />
      <directionalLight position={[3, 9, 5]} intensity={1.6} color="#fff1dc" castShadow={quality === "high"} shadow-mapSize={[1024, 1024]} />
      <CameraRig mode={mode} compact={compact} sharedRef={sharedRef} withAvatars={!!avatars?.length} />
      {myAvatar && (
        // 탁자 바닥: 누르면 내 아바타가 그곳으로 걸어감(유닛·자리 클릭은 각자 전파를 막는다)
        <mesh
          position={[0, 0.005, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onClick={(e) => {
            const st = avatarsRef.current.get(myAvatar.key);
            if (!st) return;
            st.keys.clear();
            st.target = new THREE.Vector3(Math.max(bounds.minX, Math.min(bounds.maxX, e.point.x)), 0, Math.max(bounds.minZ, Math.min(bounds.maxZ, e.point.z)));
            addStyleFx({ type: "impact", kind: "fairy", color: "#4ade80", at: [st.target.x, 0, st.target.z], dir: [0, 0, -1], start: performance.now(), big: false });
          }}
        >
          <planeGeometry args={[12, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {avatars?.map((a) => (
        <Avatar key={a.key} info={a} home={centerAvatar ? new THREE.Vector3(0, 0, compact ? 0.6 : 0.3) : avatarHome(a.side, mode, compact)} bounds={bounds} registry={avatarsRef} cur={sharedRef} memKey={`${centerAvatar ? "pick" : mode}:${compact ? "c" : "w"}:${a.key}`} />
      ))}
      <Table mode={mode} />
      {/* 앞줄·뒷줄 구역(내 쪽, 상점은 늘, 전투는 양쪽) */}
      {!centerAvatar &&
        (mode === "shop" ? [1] : [1, -1]).flatMap((sign) =>
          [false, true].map((back) => (
            <mesh key={`${sign}${back}`} position={[0, 0.006, rowZ(mode, back, sign)]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[compact ? 5 : 7.8, mode === "shop" ? 1.1 : 1.15]} />
              <meshBasicMaterial color={back ? "#38bdf8" : "#f87171"} transparent opacity={0.14} depthWrite={false} toneMapped={false} />
            </mesh>
          )),
        )}
      {units.map((u) => (
        <Token key={u.uid} u={u} sharedRef={sharedRef} selected={selected === u.uid} onPick={onPick ? stablePick : undefined} onGrab={onGrab ? stableGrab : undefined} size={compact ? 0.95 : 1.05} facing={0} />
      ))}
      {insert &&
        insertSlots(units, pos, mode).map(({ p, index, back }) => {
          return (
            <mesh
              key={`${back ? "b" : "f"}${index}`}
              position={[p.x, 0.03, p.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                insert.onInsert(index, back);
              }}
              onPointerOver={() => (document.body.style.cursor = "pointer")}
              onPointerOut={() => (document.body.style.cursor = "")}
            >
              <circleGeometry args={[0.3, 28]} />
              <meshBasicMaterial color={back ? "#7dd3fc" : "#fde047"} toneMapped={false} transparent opacity={0.75} />
            </mesh>
          );
        })}
      <Effects apiRef={apiRef} sharedRef={sharedRef} addStyleFx={addStyleFx} avatarsRef={avatarsRef} />
      <StyleFxLayer items={styleFx} />
    </>
  );
}

export default function Arena3D(props: Arena3DProps) {
  return (
    <div className={props.className ?? "h-72 w-full"}>
      <Canvas
        shadows={props.quality === "high"}
        dpr={props.quality === "high" ? [1, 1.6] : [1, 1.25]}
        onCreated={({ gl, scene, camera }) => {
          // 셰이더를 처음에 한꺼번에 컴파일하고, 준비됐음을 알린다(전투 재생은 그 뒤에 시작)
          gl.compile(scene, camera);
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => props.onReady?.()));
        }}
        camera={{ fov: 40, near: 0.1, far: 80, position: [0, 8, 6] }}
        gl={{ antialias: props.quality === "high", powerPreference: "high-performance" }}
        onPointerMissed={() => (document.body.style.cursor = "")}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
