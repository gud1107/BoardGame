/**
 * 변신 숨바꼭질 봇 정책 파라미터.
 *
 * 봇은 "정답"을 보지 않는다 — 술래 봇은 사람 술래가 볼 수 있는 것(움직임·새로 생긴 물건·
 * 장소에 안 맞는 물건·NPC답지 않은 행동)만으로 의심 점수를 매긴다. 아래 숫자가 그 판단의 가중치다.
 *
 * TRAINED_* 는 셀프플레이로 찾은 값이다 (`selfplay.ts` — OpenAI "Emergent Tool Use from
 * Multi-Agent Autocurricula"(2019)의 구조를 따름: 숨는 쪽·찾는 쪽이 번갈아 상대를 이기도록
 * 진화하고, 최신 상대뿐 아니라 과거 챔피언들과도 붙는다. 다만 신경망 PPO 대신 이 파라미터
 * 벡터를 교차 엔트로피 방법(CEM)으로 최적화한다). 다시 학습하면 결과를 여기에 붙여 넣는다.
 *
 * 레벨 1 = NAIVE, 레벨 10 = TRAINED, 그 사이는 선형 보간.
 */

export interface HiderParams {
  /** 카드 고를 때 모양별 선호 (prop·person·dog·cat·guard·vacuum) */
  wProp: number;
  wPerson: number;
  wDog: number;
  wCat: number;
  wGuard: number;
  wVacuum: number;
  /** 숨을 자리: 같은 모양 진짜가 근처(8m)에 많을수록 */
  cluster: number;
  /** 숨을 자리: 술래 기지에서 멀수록 */
  far: number;
  /** 숨을 자리: 집 안(+) / 밖(−) */
  indoor: number;
  /** 술래가 나를 볼 수 있으면 그 자리에서 굳을 확률 */
  freeze: number;
  /** 아무도 안 볼 때 초당 자리 옮길 확률 (물건) */
  relocate: number;
  /** 술래가 2.5m 안이면 초당 도망칠 확률 (물건) */
  flee: number;
  /** 분신: 0~1 (낮음 = 안 씀, 중간 = 숨은 자리 옆, 높음 = 가는 길에) */
  decoy: number;
  /** 살아 있는 모양이 NPC처럼 행동할 확률 (술래 앞에서 안 뛰기, 점검원 점검 동작, 행인은 길로) */
  mimic: number;
  /** 꼼꼼이: 찜 장소가 열린 뒤 초당 출발 확률 */
  goalRush: number;
}

export interface SeekerParams {
  /** 물건이 움직이는 걸 봤다 */
  wMove: number;
  /** 아까 비어 있던 자리에 물건이 생겼다 */
  wNovel: number;
  /** 장소에 안 어울린다 (집 안 소화전, 집 안 행인 등) */
  wCtx: number;
  /** NPC답지 않은 행동 (뛰는 행인, 점검 안 하는 점검원, 이상한 자세) */
  wBeh: number;
  /** 살아 있는 모양이 너무 오래 서 있다 */
  wStill: number;
  /** 모든 후보의 기본 의심 */
  bias: number;
  /** 가까울수록 더 의심 (0~1) */
  wNear: number;
  /** 치는 기준선 */
  th0: number;
  /** 체력이 깎일수록 기준선을 올리는 정도 */
  thHp: number;
  /** 벌점이 큰 무기일수록 기준선을 올리는 정도 */
  thPen: number;
  /** 순찰: 변신 후보가 많은 곳을 선호 */
  density: number;
  /** 조준 오차 (라디안 비례) */
  aimErr: number;
}

export type ParamKey<T> = keyof T & string;

export const NAIVE_HIDER: HiderParams = {
  wProp: 1,
  wPerson: 1,
  wDog: 1,
  wCat: 1,
  wGuard: 1,
  wVacuum: 1,
  cluster: 0,
  far: 0,
  indoor: 0,
  freeze: 0.3,
  relocate: 0.04,
  flee: 0.6,
  decoy: 0.2,
  mimic: 0.3,
  goalRush: 0.02,
};

export const NAIVE_SEEKER: SeekerParams = {
  wMove: 0.8,
  wNovel: 0.1,
  wCtx: 0.1,
  wBeh: 0.1,
  wStill: 0.05,
  bias: 0.25,
  wNear: 0.2,
  th0: 0.6,
  thHp: 0,
  thPen: 0,
  density: 0,
  aimErr: 0.14,
};

// 셀프플레이 결과 (selfplay.ts, 2026-11-06: 8세대×양쪽, 후보 12, 후보당 8판, 헛손질 연속 가중·잡으면 회복 규칙)
// 드러난 전략: 숨는 쪽 = 분신을 가는 길에 떨구고 멀리 숨어 한자리에 버티기(재배치 0),
// 술래 = 움직이는 걸 본 것 위주로 치고(wMove), 분신 때문에 "새로 생긴 물건" 단서는 버림(wNovel↓), 체력이 깎이면 신중(thHp).
export const TRAINED_HIDER: HiderParams = {
  wProp: 1.92,
  wPerson: 0.677,
  wDog: 1.959,
  wCat: 1.647,
  wGuard: 1.46,
  wVacuum: 0.877,
  cluster: 0.171,
  far: 0.572,
  indoor: 0.208,
  freeze: 0.183,
  relocate: 0,
  flee: 0.487,
  decoy: 0.729,
  mimic: 0.39,
  goalRush: 0.023,
};
export const TRAINED_SEEKER: SeekerParams = {
  wMove: 1.985,
  wNovel: 0.204,
  wCtx: 0.988,
  wBeh: 0.524,
  wStill: 0.075,
  bias: 0.589,
  wNear: 0.402,
  th0: 0.822,
  thHp: 1.078,
  thPen: 0.156,
  density: 0.162,
  aimErr: 0.145,
};

/** 학습 범위 (CEM 탐색 공간) */
export const HIDER_RANGE: Record<keyof HiderParams, [number, number]> = {
  wProp: [0, 3],
  wPerson: [0, 3],
  wDog: [0, 3],
  wCat: [0, 3],
  wGuard: [0, 3],
  wVacuum: [0, 3],
  cluster: [-1, 3],
  far: [-1, 3],
  indoor: [-2, 2],
  freeze: [0, 1],
  relocate: [0, 0.15],
  flee: [0, 1],
  decoy: [0, 1],
  mimic: [0, 1],
  goalRush: [0, 0.2],
};

export const SEEKER_RANGE: Record<keyof SeekerParams, [number, number]> = {
  wMove: [0, 3],
  wNovel: [0, 3],
  wCtx: [0, 3],
  wBeh: [0, 3],
  wStill: [0, 3],
  bias: [-1, 1],
  wNear: [0, 1.5],
  th0: [0.2, 3],
  thHp: [0, 3],
  thPen: [0, 2],
  density: [0, 2],
  aimErr: [0.01, 0.15],
};

export function lerpParams<T extends object>(a: T, b: T, k: number): T {
  const out = { ...a } as Record<string, number>;
  for (const key of Object.keys(a)) out[key] = (a as Record<string, number>)[key] + ((b as Record<string, number>)[key] - (a as Record<string, number>)[key]) * k;
  return out as T;
}

export function hiderParamsFor(level: number): HiderParams {
  return lerpParams(NAIVE_HIDER, TRAINED_HIDER, Math.max(0, Math.min(1, (level - 1) / 9)));
}

export function seekerParamsFor(level: number): SeekerParams {
  return lerpParams(NAIVE_SEEKER, TRAINED_SEEKER, Math.max(0, Math.min(1, (level - 1) / 9)));
}
