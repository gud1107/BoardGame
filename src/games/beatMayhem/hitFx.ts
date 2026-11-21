/**
 * 박자 난장판 — 칠 때마다 나오는 타격 이펙트 계산 (3D `StageScene`·2D `Highway2D` 공용).
 *
 * 렌더러는 이 함수들이 주는 "정규화된" 값(줄 너비 = 1)을 자기 좌표로 늘려 그린다.
 * 같은 버스트는 같은 불꽃 모양이 나오도록 `at`으로 각도를 흩뜨린다(Math.random 없음).
 */

import type { Judge } from "./data";

export type FxLevel = "full" | "lite" | "off";
export const FX_LEVELS: { id: FxLevel; name: string }[] = [
  { id: "full", name: "화려하게" },
  { id: "lite", name: "가볍게" },
  { id: "off", name: "끄기" },
];

/** 버스트(판정 효과) 하나가 화면에 남는 시간 */
export const FX_LIFE_MS = 520;
/** 판정 고리 수명 */
export const RING_MS = 380;
/** 줄 빛기둥 수명 */
export const BEAM_MS = 260;
/** 콤보 축하 물결 수명 */
export const WAVE_MS = 700;
/** 이 콤보마다 물결 */
export const WAVE_EVERY = 25;

export interface Burst {
  lane: number;
  judge: Judge;
  at: number;
  combo: number;
}

/** 판정별 불꽃 개수 (화려하게 기준) */
export function sparkCount(judge: Judge): number {
  return judge === "perfect" ? 12 : judge === "great" ? 8 : judge === "good" ? 5 : 0;
}
export const MAX_SPARKS = 12;

const frac = (x: number) => x - Math.floor(x);

/**
 * i번째 불꽃의 위치(정규화). k = 0~1 경과율.
 * x: 줄 너비 단위 좌우, y: 위로(+), s: 크기 0~1.
 */
export function spark(b: Burst, i: number, k: number): { x: number; y: number; s: number } {
  const n = sparkCount(b.judge);
  const jitter = frac(Math.sin(b.at * 12.9898 + i * 78.233) * 43758.5453);
  // 위쪽 반원(약간 넘치게)으로 흩어진다
  const a = Math.PI * (-0.1 + 1.2 * ((i + 0.5 * jitter) / n));
  const speed = (b.judge === "perfect" ? 1.35 : 1) * (0.7 + 0.6 * jitter);
  const e = 1 - (1 - k) * (1 - k); // 처음엔 빠르게, 나중엔 느리게
  return {
    x: Math.cos(a) * speed * e,
    y: Math.sin(a) * speed * e * 1.2 - k * k * 0.9,
    s: (1 - k) * (b.judge === "perfect" ? 1 : 0.75),
  };
}

/** 줄마다 가장 최근 버스트 (빛기둥용) */
export function latestPerLane(bursts: Burst[], lanes: number): (Burst | null)[] {
  const out: (Burst | null)[] = Array.from({ length: lanes }, () => null);
  for (const b of bursts) if (!out[b.lane] || out[b.lane]!.at < b.at) out[b.lane] = b;
  return out;
}

/** 가장 최근 콤보 축하 버스트 */
export function latestWave(bursts: Burst[], now: number): Burst | null {
  let w: Burst | null = null;
  for (const b of bursts) if (b.combo > 0 && b.combo % WAVE_EVERY === 0 && now - b.at < WAVE_MS && (!w || w.at < b.at)) w = b;
  return w;
}
