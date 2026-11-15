import { BONUS_POINTS_PER_SPOT, SAME_POINTS, type StageKind } from "./engine";

/** Display copy for each stage kind — shared by the board banner, the answer sheet and the room setup. */
export const STAGE_KIND_META: Record<StageKind, { emoji: string; label: string; howTo: string; points: string }> = {
  classic: { emoji: "🖼️", label: "기본", howTo: "양쪽 그림에서 다른 부분을 찾아 클릭하세요", points: "차이 1개 = 1점" },
  mirror: {
    emoji: "🪞",
    label: "대칭 거울",
    howTo: "오른쪽은 거울에 비친 그림이에요. 좌우가 뒤집힌 채로 다른 곳을 찾으세요",
    points: `차이 1개 = ${BONUS_POINTS_PER_SPOT}점`,
  },
  memory: {
    emoji: "🧠",
    label: "기억력",
    howTo: "원본을 잠깐 보여 준 뒤 숨겨요. 기억을 더듬어 바뀐 그림에서 다른 곳을 찾으세요",
    points: `차이 1개 = ${BONUS_POINTS_PER_SPOT}점`,
  },
  fade: {
    emoji: "🌫️",
    label: "흐려지는 그림",
    howTo: "시간이 갈수록 두 그림이 점점 흐려져요. 선명할 때 빨리 찾으세요",
    points: `차이 1개 = ${BONUS_POINTS_PER_SPOT}점`,
  },
  same: {
    emoji: "🔍",
    label: "같은 그림 찾기",
    howTo: "4장 중 원본과 완전히 똑같은 그림은 딱 하나! 틀리면 4초 잠기고 그 카드는 모두에게 ❌로 공개돼요",
    points: `정답 = ${SAME_POINTS}점`,
  },
};
