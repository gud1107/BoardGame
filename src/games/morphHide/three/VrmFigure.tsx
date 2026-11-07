"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import HouseFigure, { type Drive, type FigurePose, type Strike } from "../../hideAndSeek/three/HouseFigure";
import HeldWeapon from "./HeldWeapon";
import PoliceCap from "./PoliceCap";
import type { WeaponLook } from "./Figures";
import { CHARACTER_PRESETS, resolveLook, type PersonLook } from "@/lib/character/avatar";

/**
 * 변신 숨바꼭질의 VRM 사람 — 한밤의 숨바꼭질 `HouseFigure`를 "제자리 + 몸짓 이름"으로 쓴다.
 * 부모 그룹이 위치·방향을 잡고, 여기선 걷기 여부와 자세만 넘긴다.
 *
 * 누구로 보이나 (11-06 사용자 선택):
 * - 술래 = 각자 프로필 VRM (`seekerLook`)
 * - 행인 NPC · "행인"으로 변신한 숨는 사람 · 그 분신 = 출연진 21명 중 랜덤(`castLook`) — 서로 구분이 안 돼야 위장이 된다
 */

const ORIGIN = [new THREE.Vector3()];

const GUNS = new Set<WeaponLook>(["sling", "pistol", "shotgun", "sniper"]);

/** 무기를 든 술래: 총은 겨누거나 앞쪽 아래로, 뿅망치는 앞으로 들고 */
export function heldPose(anim: string, held: WeaponLook | undefined): FigurePose {
  if (held && GUNS.has(held)) {
    if (anim === "aim" || anim === "inspect") return "aimGun";
    if (anim === "idle") return "holdGun";
  }
  if (held === "hammer" && (anim === "idle" || anim === "inspect" || anim === "aim")) return "holdMelee";
  return animToPose(anim);
}

export function animToPose(anim: string): FigurePose {
  switch (anim) {
    case "inspect":
    case "aim":
    case "radio":
      return "flash";
    case "crouch":
    case "sit":
    case "lie":
      return "crouch";
    case "wave":
    case "dance":
    case "laugh":
    case "taunt":
      return "cheer";
    case "caught":
      return "caught";
    default:
      return "stand";
  }
}

/** 출연진 중 한 명 — 같은 key면 모든 기기에서 같은 얼굴 */
export function castLook(key: number): PersonLook {
  const n = CHARACTER_PRESETS.length;
  const i = (((Math.imul(key, 2654435761) >>> 0) % n) + n) % n;
  const p = CHARACTER_PRESETS[i];
  return resolveLook(i, ["none"], { ...p.look, presetId: p.id });
}

export function seekerLook(seat: number, profile: unknown): PersonLook {
  return resolveLook(seat, ["none"], profile);
}

export default function VrmFigure({ look, seed, anim, lowDetail, held, strike, cap }: { look: PersonLook; seed: number; anim: string; lowDetail: boolean; held?: WeaponLook; strike?: RefObject<Strike>; cap?: boolean }) {
  const drive = useRef<Drive>({ active: true, x: 0, y: 0, z: 0, yaw: 0, moving: false });
  const moving = anim === "walk" || anim === "run" || anim === "jump";
  useFrame(() => {
    drive.current.moving = moving;
  });
  const path = useMemo(() => ORIGIN, []);
  return <HouseFigure look={look} seed={seed} color="#94a3b8" path={path} pathKey="fixed" faceTo={null} pose={heldPose(anim, held)} lowDetail={lowDetail} drive={drive} cull strike={strike} hand={held ? <HeldWeapon kind={held} strike={strike} /> : undefined} headgear={cap ? <PoliceCap scale={1.12} /> : undefined} speed={anim === "run" ? 4.5 : 2.6} />;
}
