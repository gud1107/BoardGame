/**
 * 🥏 알까기 · 🥌 컬링 stages. `solution` shots come from a grid solver and are
 * re-checked by MyosuDojo.test.ts (⭐⭐⭐ with a margin) — move a stone and
 * you must re-solve.
 */

import type { CurlStage } from "./curl";
import type { FlickStage } from "./flick";

export const FLICK_STAGES: FlickStage[] = [
  {
    id: "a1",
    title: "정면 돌파",
    goal: "흰 알을 튕겨 검은 알을 판 밖으로",
    tierText: ["검은 알 1개 이상 떨어뜨리기", "튕긴 흰 알은 판 위에 남기", "검은 알 2개 모두 떨어뜨리기"],
    hint: "정면으로 세게 맞히면 맞은 알만 날아가고 내 알은 그 자리에 멈춰요. 두 알을 한 번에 노리려면 비스듬히 맞혀 튕겨 나가는 길을 이용하세요.",
    stones: [
      { id: 1, side: 0, x: 0, y: -3 },
      { id: 11, side: 1, x: -0.6, y: -6.4 },
      { id: 12, side: 1, x: 1.6, y: -7.6 },
    ],
    tiers: [[{ k: "knock", n: 1 }], [{ k: "shooterStays" }], [{ k: "knock", n: 2 }]],
    solution: { angle: 269.75, power: 96, shooter: 1 },
  },
  {
    id: "a2",
    title: "비스듬한 줄",
    goal: "비스듬히 줄 선 검은 알을 밀어내세요",
    tierText: ["검은 알 1개 이상 떨어뜨리기", "튕긴 흰 알은 판 위에 남기", "검은 알 2개 이상 떨어뜨리기"],
    hint: "알끼리 부딪히면 힘이 앞 알로 넘어가요. 맞은 알이 다음 알을 어느 쪽으로 미는지 점선을 보며 맞힐 곳을 고르세요.",
    stones: [
      { id: 1, side: 0, x: -2, y: -4 },
      { id: 11, side: 1, x: -0.6, y: -7.4 },
      { id: 12, side: 1, x: 0.4, y: -8.2 },
      { id: 13, side: 1, x: 1.4, y: -9 },
    ],
    tiers: [[{ k: "knock", n: 1 }], [{ k: "shooterStays" }], [{ k: "knock", n: 2 }]],
    solution: { angle: 291.85, power: 96, shooter: 1 },
  },
  {
    id: "a3",
    title: "누구로 칠까",
    goal: "흰 알 셋 중 하나를 골라 튕기세요 (알을 눌러 고르기)",
    tierText: ["검은 알 1개 이상 떨어뜨리기", "내 알은 하나도 안 떨어지기", "검은 알 2개 이상 떨어뜨리기"],
    hint: "가운데 알이 늘 정답은 아니에요. 검은 알 두 개가 겹쳐 보이는 각도에 있는 흰 알을 찾아보세요.",
    stones: [
      { id: 1, side: 0, x: -6, y: -4 },
      { id: 2, side: 0, x: 0, y: -4.5 },
      { id: 3, side: 0, x: 6, y: -4 },
      { id: 11, side: 1, x: -3, y: -8.6 },
      { id: 12, side: 1, x: 0, y: -8.9 },
      { id: 13, side: 1, x: 3, y: -8.6 },
    ],
    tiers: [[{ k: "knock", n: 1 }], [{ k: "safe" }], [{ k: "knock", n: 2 }]],
    solution: { angle: 310.8, power: 92, shooter: 1 },
  },
  {
    id: "a4",
    title: "왕을 지키는 졸",
    goal: "구석의 무거운 검은 왕을 떨어뜨리세요",
    tierText: ["검은 알 1개 이상 떨어뜨리기", "구석의 검은 왕 떨어뜨리기", "검은 알 2개 이상 떨어뜨리기"],
    hint: "왕은 무게가 3배라 흰 알로 직접 치면 꿈쩍 안 해요. 왕 바로 앞의 검은 알을 왕 쪽으로 밀어 부딪히게 해 보세요.",
    stones: [
      { id: 1, side: 0, x: -1, y: -5 },
      { id: 2, side: 0, x: 5, y: -5.5 },
      { id: 11, side: 1, x: 8.9, y: -8.9, king: true },
      { id: 12, side: 1, x: 7.6, y: -7.6 },
      { id: 13, side: 1, x: 3, y: -8.8 },
    ],
    tiers: [[{ k: "knock", n: 1 }], [{ k: "fall", ids: [11] }], [{ k: "knock", n: 2 }]],
    solution: { angle: 316.75, power: 97, shooter: 2 },
  },
  {
    id: "a5",
    title: "한 방 대청소",
    goal: "구석에 몰린 검은 알 5개 — 한 번에 몇 개나?",
    tierText: ["검은 알 1개 이상 떨어뜨리기", "검은 알 2개 이상", "검은 알 3개 이상"],
    hint: "가장 바깥 알을 직접 노리기보다, 안쪽 알을 쳐서 구석으로 몰아붙이세요. 첫 충돌 뒤 두 알은 서로 직각으로 갈라져요.",
    stones: [
      { id: 1, side: 0, x: 0, y: -2 },
      { id: 2, side: 0, x: 4, y: 0 },
      { id: 11, side: 1, x: 5, y: -7 },
      { id: 12, side: 1, x: 6.2, y: -7.8 },
      { id: 13, side: 1, x: 7.4, y: -8.6 },
      { id: 14, side: 1, x: 6, y: -6 },
      { id: 15, side: 1, x: 8.4, y: -7.2 },
    ],
    tiers: [[{ k: "knock", n: 1 }], [{ k: "knock", n: 2 }], [{ k: "knock", n: 3 }]],
    solution: { angle: 286.5, power: 98, shooter: 2 },
  },
];

export const CURL_STAGES: CurlStage[] = [
  {
    id: "u1",
    title: "마지막 한 수",
    goal: "빨강의 마지막 스톤 — 점수를 따내세요",
    tierText: ["1점 이상 따내기", "단추 위 노란 스톤 쳐내기", "2점 이상 따내기"],
    hint: "브룸 위치는 겨냥, 회전은 휘는 방향, 세기는 멈추는 곳이에요. 노란 스톤을 맞히고 내 스톤이 하우스 안에 남게 해 보세요.",
    stones: [
      { id: 1, side: 0, x: -1.05, y: -0.55 },
      { id: 2, side: 1, x: 0.12, y: 0.3 },
    ],
    tiers: [[{ k: "score", n: 1 }], [{ k: "out", ids: [2] }], [{ k: "score", n: 2 }]],
    solution: { aim: 0.63, weight: 67.5, spin: -1 },
  },
  {
    id: "u2",
    title: "가드 뒤로",
    goal: "앞을 막은 노란 가드를 피해 하우스로",
    tierText: ["1점 이상 따내기", "단추 위 노란 스톤 쳐내기", "2점 이상 따내기"],
    hint: "스톤은 회전 방향으로 끝에서 휘어요. 가드 옆을 지나 하우스 안에서 휘어 들어가게 브룸을 바깥쪽에 두세요.",
    stones: [
      { id: 1, side: 1, x: 0.05, y: 3.6 },
      { id: 2, side: 1, x: -0.1, y: 0.15 },
      { id: 3, side: 0, x: 0.95, y: 0.85 },
    ],
    tiers: [[{ k: "score", n: 1 }], [{ k: "out", ids: [2] }], [{ k: "score", n: 2 }]],
    solution: { aim: -0.77, weight: 63, spin: 1 },
  },
  {
    id: "u3",
    title: "더블 테이크아웃",
    goal: "하우스 안 노란 스톤 둘을 한 번에",
    tierText: ["1점 이상 따내기", "노란 스톤 모두 쳐내기", "2점 이상 따내기"],
    hint: "첫 스톤을 비스듬히 맞히면 내 스톤이 튕겨 두 번째 스톤으로 향해요. 세게 던질수록 덜 휘어요.",
    stones: [
      { id: 1, side: 1, x: -0.55, y: 0.35 },
      { id: 2, side: 1, x: 0.65, y: -0.55 },
      { id: 3, side: 0, x: 1.25, y: 1.05 },
    ],
    tiers: [[{ k: "score", n: 1 }], [{ k: "out", ids: [1, 2] }], [{ k: "score", n: 2 }]],
    solution: { aim: -0.71, weight: 93, spin: 1 },
  },
  {
    id: "u4",
    title: "대역전 세 점",
    goal: "지고 있는 마지막 엔드 — 3점이 필요해요",
    tierText: ["1점 이상 따내기", "2점 이상 따내기", "3점 따내기"],
    hint: "노란 스톤만 쳐내고 내 스톤들은 그대로 두는 길을 찾아야 해요. 빨강 스톤에 맞혀 노란 스톤까지 밀어내는 방법도 있어요.",
    stones: [
      { id: 1, side: 1, x: 0.1, y: -0.2 },
      { id: 2, side: 0, x: -0.75, y: 0.7 },
      { id: 3, side: 0, x: 0.95, y: -0.95 },
      { id: 4, side: 1, x: -0.3, y: 2.8 },
    ],
    tiers: [[{ k: "score", n: 1 }], [{ k: "score", n: 2 }], [{ k: "score", n: 3 }]],
    solution: { aim: 0.74, weight: 60, spin: -1 },
  },
];
