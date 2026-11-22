/**
 * 🎱 당구 한 큐 stages. `solution` shots were found by a grid solver and are
 * re-checked by MyosuDojo.test.ts (⭐⭐⭐ with a margin on angle and power) —
 * move a ball and you must re-solve.
 */

import type { CueStage } from "./cue";

export const CUE_STAGES: CueStage[] = [
  {
    id: "b1",
    title: "정면 한 방",
    goal: "노란 1번 공을 넣으세요",
    tierText: ["1번 공 넣기 (흰 공은 남기기)", "흰 공을 동그라미 안에 세우기", "흰 공을 작은 동그라미 안에"],
    hint: "흰 공·1번 공·포켓을 일직선으로. 노란 점선이 1번 공이 굴러갈 길이에요. 다음엔 힘을 줄여 흰 공을 세워 보세요.",
    pockets: true,
    balls: [
      { id: 0, x: -6, y: 1.5 },
      { id: 1, x: 7, y: 4 },
    ],
    tiers: [[{ k: "pot", id: 1 }, { k: "noPot", id: 0 }], [{ k: "rest", id: 0, x: 4, y: 2.5, r: 2.2 }], [{ k: "rest", id: 0, x: 4, y: 2.5, r: 1.1 }]],
    solution: { angle: 10.4, power: 77, spin: -0.5, side: 0 },
  },
  {
    id: "b2",
    title: "길을 막는 8번",
    goal: "8번 공을 피해서 1번 공을 넣으세요",
    tierText: ["1번 공 넣기 (흰 공·8번 공은 남기기)", "8번 공은 건드리지 않기", "위 가운데 포켓에 넣기"],
    hint: "똑바로는 8번이 막아요. 쿠션에 한 번 튕겨서 1번 공의 옆구리를 노려 보세요.",
    pockets: true,
    balls: [
      { id: 0, x: -7, y: 3 },
      { id: 8, x: -3, y: -0.5 },
      { id: 1, x: 1.6, y: -4.2 },
    ],
    tiers: [[{ k: "pot", id: 1 }, { k: "noPot", id: 0 }, { k: "noPot", id: 8 }], [{ k: "noTouch", id: 8 }], [{ k: "pot", id: 1, pocket: 1 }]],
    solution: { angle: 24.15, power: 97, spin: 0, side: 0 },
  },
  {
    id: "b3",
    title: "징검다리",
    goal: "파란 2번 공으로 1번 공을 밀어 넣으세요",
    tierText: ["1번 공 넣기 (흰 공은 남기기)", "흰 공은 2번 공부터 맞히기", "2번 공은 넣지 않기"],
    hint: "흰 공 → 2번 → 1번 순서로 부딪히는 '콤비네이션'이에요. 2번 공이 1번 공의 어디를 맞혀야 하는지부터 거꾸로 생각해 보세요.",
    pockets: true,
    balls: [
      { id: 0, x: -8, y: -1 },
      { id: 2, x: -0.7, y: 0.4 },
      { id: 1, x: 6.5, y: 4 },
    ],
    tiers: [[{ k: "pot", id: 1 }, { k: "noPot", id: 0 }], [{ k: "first", id: 2 }], [{ k: "noPot", id: 2 }]],
    solution: { angle: 16, power: 82, spin: 1, side: 0 },
  },
  {
    id: "b4",
    title: "두 마리 토끼",
    goal: "한 큐에 1번과 3번을 모두 넣으세요",
    tierText: ["1번 공 넣기 (흰 공은 남기기)", "3번 공도 같이 넣기", "흰 공을 구석 동그라미 안에 세우기"],
    hint: "1번 공을 맞힌 흰 공은 1번 공이 가는 길과 거의 직각으로 튕겨 나가요. 그 길 끝에 3번 공이 있도록 맞힐 두께를 고르세요.",
    pockets: true,
    balls: [
      { id: 0, x: -4, y: 0 },
      { id: 1, x: 9.1, y: 4.4 },
      { id: 3, x: 11.2, y: -4.9 },
    ],
    tiers: [[{ k: "pot", id: 1 }, { k: "noPot", id: 0 }], [{ k: "pot", id: 3 }], [{ k: "rest", id: 0, x: 10.6, y: -3.4, r: 1.4 }]],
    solution: { angle: 30.4, power: 94, spin: 0, side: 0 },
  },
  {
    id: "b5",
    title: "캐롬 첫걸음",
    goal: "구멍 없는 테이블 — 흰 공으로 두 공을 다 맞히세요",
    tierText: ["흰 공으로 1번·9번 모두 맞히기", "마지막 공 전에 쿠션 1번 이상", "마지막 공 전에 쿠션 3번 이상"],
    hint: "첫 공을 얇게 맞히면 흰 공이 크게 꺾이지 않아요. 3쿠션은 테이블 가장자리 점(다이아몬드)을 따라 길을 그려 보세요.",
    pockets: false,
    balls: [
      { id: 0, x: -7, y: 3 },
      { id: 1, x: -2.5, y: -1.4 },
      { id: 9, x: 6.2, y: 3.3 },
    ],
    tiers: [[{ k: "carom", ids: [1, 9] }], [{ k: "rails", ids: [1, 9], n: 1 }], [{ k: "rails", ids: [1, 9], n: 3 }]],
    solution: { angle: 17.85, power: 96, spin: 1, side: 0 },
  },
  {
    id: "b6",
    title: "구석의 두 공",
    goal: "구석에 붙은 두 공 — 쿠션으로 돌아서 맞히세요",
    tierText: ["흰 공으로 1번·9번 모두 맞히기", "1번 공부터 맞히기", "마지막 공 전에 쿠션 3번 이상"],
    hint: "1번 공을 먼저 맞히고 테이블을 한 바퀴. 옆 당점(↔)을 주면 쿠션에서 꺾이는 각도가 달라져요.",
    pockets: false,
    balls: [
      { id: 0, x: 6, y: 4 },
      { id: 1, x: -8.2, y: 2.5 },
      { id: 9, x: 8.7, y: -3.5 },
    ],
    tiers: [[{ k: "carom", ids: [1, 9] }], [{ k: "first", id: 1 }], [{ k: "rails", ids: [1, 9], n: 3 }]],
    solution: { angle: 183.5, power: 98, spin: 1, side: 1 },
  },
];
