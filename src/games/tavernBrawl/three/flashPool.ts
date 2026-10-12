import * as THREE from "three";

/**
 * 번쩍임 조명 요청 대기열. 이펙트가 조명을 직접 만들고 지우면 three.js가 장면의 조명 개수가 바뀔 때마다
 * 모든 재질 셰이더를 다시 컴파일해 전투 중간에 멈칫한다(렉의 주원인). 그래서 Arena에 조명 몇 개를
 * 항상 켜 두고(밝기 0), 이펙트는 여기에 요청만 넣는다 → 조명 개수는 절대 변하지 않는다.
 */

export interface FlashReq {
  pos: THREE.Vector3;
  color: string;
  intensity: number;
  start: number;
  dur: number;
}

const queue: FlashReq[] = [];

export function requestFlash(pos: [number, number, number] | THREE.Vector3, color: string, intensity = 8, dur = 450) {
  const v = Array.isArray(pos) ? new THREE.Vector3(...pos) : pos.clone();
  queue.push({ pos: v, color, intensity, start: performance.now(), dur });
  if (queue.length > 12) queue.shift();
}

/** 지금 살아 있는 요청(최근 것 우선) */
export function activeFlashes(now: number): FlashReq[] {
  for (let i = queue.length - 1; i >= 0; i--) if (now - queue[i].start > queue[i].dur) queue.splice(i, 1);
  return [...queue].reverse();
}
