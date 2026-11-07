"use client";

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { blinking, type PersonLook } from "@/games/shared/three/SeatedPerson";
import { tickVrm, useVrmAvatar } from "@/games/shared/three/VrmPerson";
import { toVrm0 } from "@/games/shared/three/vrmPose";

/**
 * 숨바꼭질 저택을 돌아다니는 VRM 인물 — 다른 3D 테이블과 같은 내 캐릭터(`useVrmAvatar`).
 * `path`(월드 좌표 웨이포인트)를 따라 걷고, 도착하면 `pose`를 취한다. 자세는 정규화 본의
 * 목표 각도를 매 프레임 섞는다(프레임당 할당 없음). VRM이 아직 안 왔으면 자리 색 캡슐.
 */

export type FigurePose = "stand" | "count" | "crouch" | "search" | "caught" | "cheer" | "flash" | "aimGun" | "holdGun" | "holdMelee";

/** 공격 한 번 (변신 숨바꼭질 술래) — `at` = performance.now() ms */
export interface Strike {
  at: number;
  kind: "melee" | "punch" | "gun" | "none";
}

export interface HouseFigureProps {
  look: PersonLook;
  seed: number;
  color: string;
  /** 출발점부터 도착점까지 (마지막 점이 머무는 곳) */
  path: THREE.Vector3[];
  /** path가 바뀌면 처음부터 다시 걷는다 */
  pathKey: string;
  /** 걷기 시작까지 기다리는 초 */
  delay?: number;
  /** 도착 후 바라볼 곳 */
  faceTo: THREE.Vector3 | null;
  pose: FigurePose;
  lowDetail: boolean;
  speed?: number;
  size?: number;
  /** 있으면(active) 경로 대신 이 값을 따른다 — 내 캐릭터를 직접 걷게 할 때 */
  drive?: RefObject<Drive>;
  /**
   * 넓은 맵용 시야 절약 (변신 숨바꼭질): 화면 밖이면 VRM을 그리지도 움직이지도 않고,
   * 멀면 외곽선을 끄고 몸짓을 띄엄띄엄 갱신한다. 없으면 예전처럼 항상 그린다.
   */
  cull?: boolean;
  /** 오른손에 쥘 것 (손 뼈 기준: T자세에서 팔은 -x, 손등은 +y, 앞은 +z) */
  hand?: ReactNode;
  /** 머리 뼈에 붙일 것 (모자 등) — 원점 = 정수리 부근, +z 앞 */
  headgear?: ReactNode;
  /** 머리 뼈 기준 headgear 높이 (기본 0.12m, 모델 좌표) */
  headgearY?: number;
  /** 공격 몸짓 — 바뀐 `at`부터 휘두르기·찌르기·반동을 덮어 그린다 */
  strike?: RefObject<Strike>;
  children?: ReactNode;
}

export interface Drive {
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
}

const BONES: VRMHumanBoneName[] = ["spine", "chest", "neck", "head", "rightUpperArm", "rightLowerArm", "leftUpperArm", "leftLowerArm", "rightUpperLeg", "rightLowerLeg", "leftUpperLeg", "leftLowerLeg"];
const B = Object.fromEntries(BONES.map((b, i) => [b, i * 3])) as Record<(typeof BONES)[number], number>;
const CROUCH = BONES.length * 3;
const HOP = CROUCH + 1;
const CHANNELS = HOP + 1;
const HEAD_HEIGHT = 1.45;

function set3(o: Float32Array, at: number, x: number, y: number, z: number) {
  o[at] = x;
  o[at + 1] = y;
  o[at + 2] = z;
}

function poseTarget(o: Float32Array, pose: FigurePose, t: number, seed: number) {
  o.fill(0);
  const sway = Math.sin(t * 1.7 + seed) * 0.03;
  // arms down at the sides
  set3(o, B.rightUpperArm, 0, 0, 1.25 + sway);
  set3(o, B.leftUpperArm, 0, 0, -1.25 - sway);
  set3(o, B.rightLowerArm, 0, 0.2, 0);
  set3(o, B.leftLowerArm, 0, -0.2, 0);
  set3(o, B.spine, Math.sin(t * 2.1 + seed) * 0.02, 0, 0);
  switch (pose) {
    case "stand":
      return;
    case "count":
      // 기둥에 이마를 대고 두 팔로 눈을 가린다
      set3(o, B.rightUpperArm, -1.6, 0.6, 0.6);
      set3(o, B.leftUpperArm, -1.6, -0.6, -0.6);
      set3(o, B.rightLowerArm, 0, 2.0, 0);
      set3(o, B.leftLowerArm, 0, -2.0, 0);
      set3(o, B.spine, 0.25, 0, 0);
      set3(o, B.head, 0.35 + Math.sin(t * 3) * 0.04, 0, 0);
      return;
    case "crouch":
      // 몸을 잔뜩 웅크리고 숨는다
      set3(o, B.rightUpperArm, -0.9, 0.3, 0.9);
      set3(o, B.leftUpperArm, -0.9, -0.3, -0.9);
      set3(o, B.rightLowerArm, 0, 1.6, 0);
      set3(o, B.leftLowerArm, 0, -1.6, 0);
      set3(o, B.spine, 0.55, 0, 0);
      set3(o, B.head, 0.2, Math.sin(t * 0.9 + seed) * 0.35, 0);
      set3(o, B.rightUpperLeg, -1.25, 0, 0.15);
      set3(o, B.leftUpperLeg, -1.25, 0, -0.15);
      set3(o, B.rightLowerLeg, 2.0, 0, 0);
      set3(o, B.leftLowerLeg, 2.0, 0, 0);
      o[CROUCH] = 0.55;
      return;
    case "search": {
      // 허리를 숙여 가구 뒤를 뒤적인다
      const r = Math.sin(t * 9) * 0.15;
      set3(o, B.spine, 0.7, 0, 0);
      set3(o, B.head, 0.15, Math.sin(t * 2.5) * 0.3, 0);
      set3(o, B.rightUpperArm, -1.2, 0, 1.0 + r);
      set3(o, B.leftUpperArm, -1.2, 0, -1.0 - r);
      set3(o, B.rightUpperLeg, -0.6, 0, 0.15);
      set3(o, B.leftUpperLeg, -0.6, 0, -0.15);
      set3(o, B.rightLowerLeg, 1.0, 0, 0);
      set3(o, B.leftLowerLeg, 1.0, 0, 0);
      o[CROUCH] = 0.18;
      return;
    }
    case "flash":
      // 손전등을 앞으로 비춘다
      set3(o, B.rightUpperArm, -1.35, 0.25, 0.25);
      set3(o, B.rightLowerArm, 0, 0.15, 0);
      set3(o, B.head, 0.05, 0, 0);
      return;
    case "caught":
      // 화들짝 두 손을 든다
      set3(o, B.rightUpperArm, 0, 0, -1.0);
      set3(o, B.leftUpperArm, 0, 0, 1.0);
      set3(o, B.rightLowerArm, 0, 0.9, 0);
      set3(o, B.leftLowerArm, 0, -0.9, 0);
      set3(o, B.spine, -0.12, 0, 0);
      return;
    case "aimGun":
      // 오른팔을 앞으로 곧게, 왼손으로 받친다
      set3(o, B.rightUpperArm, 0, Math.PI / 2, 0.06);
      set3(o, B.rightLowerArm, 0, 0, 0);
      set3(o, B.leftUpperArm, 0, -Math.PI / 2 - 0.45, 0.12);
      set3(o, B.leftLowerArm, 0, -0.55, 0);
      set3(o, B.head, 0.06, 0, 0);
      return;
    case "holdGun":
      // 총구를 앞쪽 아래로 (경계 자세)
      set3(o, B.rightUpperArm, 0, Math.PI / 2 - 0.25, 0.75 + sway);
      set3(o, B.rightLowerArm, 0, 0.35, 0);
      return;
    case "holdMelee":
      // 팔꿈치를 굽혀 뿅망치를 앞으로 든다
      set3(o, B.rightUpperArm, 0, 0.15, 1.15 + sway);
      set3(o, B.rightLowerArm, 0, 1.35, 0);
      return;
    case "cheer":
      set3(o, B.rightUpperArm, -0.2, 0, -1.1 + Math.sin(t * 6) * 0.15);
      set3(o, B.leftUpperArm, -0.2, 0, 1.1 - Math.sin(t * 6) * 0.15);
      set3(o, B.rightLowerArm, 0, 0.2, 0);
      set3(o, B.leftLowerArm, 0, -0.2, 0);
      set3(o, B.spine, -0.1, 0, 0);
      o[HOP] = Math.abs(Math.sin(t * 6)) * 0.12;
      return;
  }
}

function face(pose: FigurePose): { surprised: number; happy: number; angry: number; shut: boolean } {
  switch (pose) {
    case "count":
      return { surprised: 0, happy: 0, angry: 0, shut: true };
    case "crouch":
      return { surprised: 0.35, happy: 0, angry: 0, shut: false };
    case "search":
    case "flash":
      return { surprised: 0, happy: 0, angry: 0.45, shut: false };
    case "caught":
      return { surprised: 1, happy: 0, angry: 0, shut: false };
    case "cheer":
      return { surprised: 0, happy: 1, angry: 0, shut: false };
    default:
      return { surprised: 0, happy: 0, angry: 0, shut: false };
  }
}

/**
 * 공격 몸짓: 오른팔 "앞으로 뻗기" 계열(Y +90°) 위에서 Z로 높이만 바꾼다 — c<0 위로, c>0 아래로.
 * 반환 = 덮어쓸 세기(0~1)
 */
function strikeOverlay(o: Float32Array, kind: Strike["kind"], e: number): number {
  const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));
  const ease = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
  if (kind === "melee") {
    // 머리 위로 치켜들었다(0~0.09s) 앞 아래로 내려친다(~0.2s)
    if (e > 0.55) return 0;
    const c = e < 0.09 ? lerp(0.2, -1.55, ease(e / 0.09)) : lerp(-1.55, 1.0, ease((e - 0.09) / 0.11));
    set3(o, B.rightUpperArm, 0, Math.PI / 2, c);
    set3(o, B.rightLowerArm, 0, e < 0.09 ? 0.9 : lerp(0.9, 0.1, (e - 0.09) / 0.1), 0);
    set3(o, B.spine, e < 0.09 ? -0.12 : lerp(-0.12, 0.28, (e - 0.09) / 0.11), 0.15, 0);
    return e < 0.32 ? 1 : 1 - (e - 0.32) / 0.23;
  }
  if (kind === "punch") {
    if (e > 0.42) return 0;
    const out = e < 0.06 ? 0 : ease((e - 0.06) / 0.08);
    set3(o, B.rightUpperArm, 0, Math.PI / 2, lerp(0.45, 0.02, out));
    set3(o, B.rightLowerArm, 0, lerp(1.5, 0, out), 0);
    set3(o, B.spine, 0, lerp(0, 0.25, out), 0);
    return e < 0.24 ? 1 : 1 - (e - 0.24) / 0.18;
  }
  if (kind === "gun") {
    if (e > 0.6) return 0;
    // 조준 + 총구가 튀어 오르는 반동
    const kick = Math.max(0, 1 - e / 0.13);
    set3(o, B.rightUpperArm, 0, Math.PI / 2, 0.06 - 0.38 * kick);
    set3(o, B.rightLowerArm, 0, -0.2 * kick, 0);
    set3(o, B.leftUpperArm, 0, -Math.PI / 2 - 0.45, 0.12 - 0.25 * kick);
    set3(o, B.leftLowerArm, 0, -0.55, 0);
    set3(o, B.spine, -0.08 * kick, 0, 0);
    return e < 0.4 ? 1 : 1 - (e - 0.4) / 0.2;
  }
  return 0;
}
const strikeBuf = new Float32Array(BONES.length * 3 + 2);
/** strikeOverlay가 건드리는 채널 */
const STRIKE_CH = [B.rightUpperArm, B.rightLowerArm, B.leftUpperArm, B.leftLowerArm, B.spine];

const fQ = new THREE.Quaternion();
const fE = new THREE.Euler();
const tmp = new THREE.Vector3();
const cullPos = new THREE.Vector3();
const cullSphere = new THREE.Sphere();
const cullMat = new THREE.Matrix4();
/** 한 프레임에 한 번만 만드는 카메라 시야 (모든 인물이 같이 쓴다) */
const cullFrustum = { at: -1, f: new THREE.Frustum() };
/** 이보다 멀면 외곽선 끔 · 몸짓 띄엄띄엄 (m) */
const OUTLINE_FAR = 16;
const LOD_FAR = 26;

export default function HouseFigure(props: HouseFigureProps) {
  const { look, seed, color, path, pathKey, delay = 0, faceTo, pose, lowDetail, speed = 2.6, size = 1, drive, cull = false, strike } = props;
  const { vrm, morphs } = useVrmAvatar(look, seed, { lowDetail });
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const st = useRef<{ key: string; start: number; leg: number; yaw: number | null; walk: number; springs: { current: number }; cur: Float32Array; want: Float32Array; shown: boolean; outline: boolean; lodAcc: number } | null>(null);
  // 화면 밖이면 안 그리므로, 처음 보이는 순간 셰이더를 컴파일하느라 끊기지 않게 도착하자마자 미리 컴파일
  const gl = useThree((x) => x.gl);
  const scene = useThree((x) => x.scene);
  const camera = useThree((x) => x.camera);
  useEffect(() => {
    if (!cull || !vrm) return;
    try {
      gl.compile(vrm.scene, camera, scene);
    } catch {
      /* 컴파일은 최적화일 뿐 — 실패하면 처음 그릴 때 컴파일된다 */
    }
  }, [cull, vrm, gl, scene, camera]);
  const outlines = useRef<{ of: unknown; list: THREE.Material[] }>({ of: null, list: [] });
  const hand = vrm?.humanoid.getNormalizedBoneNode("rightHand") ?? null;
  const headBone = vrm?.humanoid.getNormalizedBoneNode("head") ?? null;
  const fit = useMemo(() => {
    if (!vrm) return null;
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    return HEAD_HEIGHT / Math.max(0.5, y);
  }, [vrm]);

  useFrame(({ clock, camera }, dtRaw) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body || path.length === 0) return;
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime;
    const s = (st.current ??= { key: "", start: 0, leg: 0, yaw: null, walk: 0, springs: { current: 0 }, cur: new Float32Array(CHANNELS), want: new Float32Array(CHANNELS), shown: true, outline: true, lodAcc: 0 });
    if (s.key !== pathKey) {
      // 새 경로: 지금 서 있는 곳에서 가장 가까운 점부터가 아니라 처음부터 (첫 점 = 직전 도착점)
      if (s.key === "") root.position.copy(path[0]);
      s.key = pathKey;
      s.start = t;
      // 이미 도착점에 서 있으면(직접 걸어서 고른 경우) 경로를 다시 걷지 않는다
      s.leg = root.position.distanceTo(path[path.length - 1]) < 0.4 ? path.length : 1;
    }
    const waiting = t - s.start < delay;
    let walking = false;
    const d = drive?.current;
    if (d?.active) {
      // 플레이어가 직접 조종 중
      root.position.set(d.x, d.y, d.z);
      walking = d.moving;
      if (d.moving) {
        let dy = d.yaw - (s.yaw ?? d.yaw);
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        s.yaw = (s.yaw ?? d.yaw) + dy * (1 - Math.exp(-dt * 14));
      }
    } else if (!waiting) {
      // 경로를 다 걸었어도(또는 중간에 새 경로로 바뀌어도) 마지막 점까지는 마저 걷는다
      const dest = path[Math.min(s.leg, path.length - 1)];
      tmp.subVectors(dest, root.position);
      const dist = tmp.length();
      const step = dt * speed;
      if (dist <= step) {
        root.position.copy(dest);
        if (s.leg < path.length) s.leg++;
      } else {
        root.position.addScaledVector(tmp, step / dist);
        walking = true;
        if (tmp.x * tmp.x + tmp.z * tmp.z > 1e-4) {
          const yawTo = Math.atan2(tmp.x, tmp.z);
          let dy = yawTo - (s.yaw ?? yawTo);
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          s.yaw = (s.yaw ?? yawTo) + dy * (1 - Math.exp(-dt * 12));
        }
      }
    }
    if (!walking && faceTo) {
      const yawTo = Math.atan2(faceTo.x - root.position.x, faceTo.z - root.position.z);
      let dy = yawTo - (s.yaw ?? yawTo);
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      s.yaw = (s.yaw ?? yawTo) + dy * (1 - Math.exp(-dt * 8));
    }
    root.rotation.y = s.yaw ?? 0;

    poseTarget(s.want, walking ? "stand" : pose, t, seed);
    if (walking) {
      s.walk += dt * 10;
      const w = Math.sin(s.walk) * 0.55;
      s.want[B.rightUpperLeg] = w;
      s.want[B.leftUpperLeg] = -w;
      s.want[B.rightLowerLeg] = Math.max(0, -w) * 1.1;
      s.want[B.leftLowerLeg] = Math.max(0, w) * 1.1;
      s.want[B.rightUpperArm] = -w * 0.6;
      s.want[B.leftUpperArm] = w * 0.6;
      s.want[B.rightUpperArm + 2] = 1.25;
      s.want[B.leftUpperArm + 2] = -1.25;
    }
    const k = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < CHANNELS; i++) s.cur[i] += (s.want[i] - s.cur[i]) * k;
    // 공격 몸짓은 부드럽게 따라가지 않고 그 순간 그대로 (빠른 휘두르기)
    let strikeW = 0;
    const sk = strike?.current;
    if (sk && sk.kind !== "none") {
      strikeBuf.set(s.cur.subarray(0, strikeBuf.length));
      strikeW = strikeOverlay(strikeBuf, sk.kind, (performance.now() - sk.at) / 1000);
    }
    body.position.y = s.cur[HOP] - s.cur[CROUCH] * size;

    if (!vrm || !fit) return;
    let tickDt = dt;
    if (cull) {
      if (cullFrustum.at !== clock.elapsedTime) {
        cullFrustum.at = clock.elapsedTime;
        camera.updateMatrixWorld();
        cullFrustum.f.setFromProjectionMatrix(cullMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      }
      root.getWorldPosition(cullPos);
      const dist = cullPos.distanceTo(camera.position);
      cullPos.y += 0.9 * size;
      cullSphere.set(cullPos, 1.6 * size); // 카메라가 이번 프레임에 돌기 전 시야라 여유를 둔다
      const inView = cullFrustum.f.intersectsSphere(cullSphere);
      if (inView !== s.shown) {
        s.shown = inView;
        body.visible = inView;
        // 오래 멈췄다 다시 보이면 머리카락 스프링이 순간이동한 몸을 쫓아 출렁이지 않게
        if (inView) vrm.springBoneManager?.reset();
      }
      if (!inView) return;
      const wantOutline = !lowDetail && dist < OUTLINE_FAR;
      const ol = outlines.current;
      const fresh = ol.of !== vrm;
      if (fresh) {
        // 모델이 바뀌면 외곽선 재질 목록을 다시 모으고, 새 모델에도 지금 거리 기준을 적용
        ol.of = vrm;
        ol.list = [];
        vrm.scene.traverse((o) => {
          const mm = (o as THREE.Mesh).material;
          for (const m of Array.isArray(mm) ? mm : mm ? [mm] : []) if ((m as { isOutline?: boolean }).isOutline && !ol.list.includes(m)) ol.list.push(m);
        });
      }
      if (fresh || wantOutline !== s.outline) {
        s.outline = wantOutline;
        for (const m of ol.list) m.visible = wantOutline;
      }
      if (dist > LOD_FAR) {
        // 먼 사람은 뼈·표정을 ~12번/초만
        s.lodAcc += dt;
        if (s.lodAcc < 1 / 12) return;
        tickDt = s.lodAcc;
        s.lodAcc = 0;
      } else s.lodAcc = 0;
    }
    const vrm0 = vrm.meta.metaVersion === "0";
    for (let i = 0; i < BONES.length; i++) {
      const node = vrm.humanoid.getNormalizedBoneNode(BONES[i]);
      if (!node) continue;
      let ex = s.cur[i * 3];
      let ey = s.cur[i * 3 + 1];
      let ez = s.cur[i * 3 + 2];
      if (strikeW > 0 && STRIKE_CH.includes(i * 3)) {
        ex += (strikeBuf[i * 3] - ex) * strikeW;
        ey += (strikeBuf[i * 3 + 1] - ey) * strikeW;
        ez += (strikeBuf[i * 3 + 2] - ez) * strikeW;
      }
      fQ.setFromEuler(fE.set(ex, ey, ez));
      node.quaternion.copy(vrm0 ? toVrm0(fQ) : fQ);
    }
    const em = vrm.expressionManager;
    if (em) {
      const f = face(walking ? "stand" : pose);
      em.setValue("surprised", f.surprised);
      em.setValue("happy", f.happy);
      em.setValue("angry", f.angry);
      em.setValue("blink", f.shut ? 1 : f.happy > 0.9 || f.surprised > 0.5 ? 0 : blinking(t, seed) ? 1 : 0);
    }
    tickVrm(vrm, tickDt, morphs.current, s.springs, lowDetail || (cull && tickDt > dt));
  });

  return (
    <group ref={rootRef}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[0.36 * size, 18]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group ref={bodyRef}>
        {vrm && fit ? (
          <>
            <primitive object={vrm.scene} scale={fit * size} />
            {props.hand && hand && createPortal(<group rotation-y={vrm.meta.metaVersion === "0" ? Math.PI : 0}>{props.hand}</group>, hand)}
            {props.headgear &&
              headBone &&
              createPortal(
                <group rotation-y={vrm.meta.metaVersion === "0" ? Math.PI : 0}>
                  <group position={[0, props.headgearY ?? 0.12, 0.005]}>{props.headgear}</group>
                </group>,
                headBone,
              )}
          </>
        ) : (
          <group scale={size}>
            <mesh position-y={0.62}>
              <capsuleGeometry args={[0.26, 0.6, 6, 12]} />
              <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
            <mesh position-y={1.32}>
              <sphereGeometry args={[0.22, 14, 10]} />
              <meshStandardMaterial color="#f1d3b8" roughness={0.7} />
            </mesh>
          </group>
        )}
      </group>
      {props.children}
    </group>
  );
}
