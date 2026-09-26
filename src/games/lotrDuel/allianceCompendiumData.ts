import type { AllianceTokenId } from "./types";

/**
 * Compendium-only detail for the 18 alliance tokens. Name / race / one-shot
 * flag / short description stay in `TOKENS` (data.ts) — the single source the
 * in-game HUD and pick modal read too; this only adds the long-form text shown
 * in the Alliance Compendium modal. Keep each entry in sync with the engine
 * behaviour in engine.ts (`hasToken` checks and `tokenEffects`).
 */
export interface TokenCompendiumDetail {
  triggerCondition: string;
  detail: string;
  strategyTip: string;
}

export const TOKEN_COMPENDIUM: Record<AllianceTokenId, TokenCompendiumDetail> = {
  ELF_YELLOW_EXTRA_TURN: {
    triggerCondition: "노란색(재정) 카드를 내려놓을 때",
    detail: "이번 차례를 마친 후 즉시 추가 턴 1회를 진행합니다.",
    strategyTip: "자금 확보와 동시에 연속 행동으로 템포를 끌어올리는 기동 패시브입니다.",
  },
  ELF_RED_ANYWHERE: {
    triggerCondition: "빨간색(군사) 카드를 내려놓을 때",
    detail: "카드에 적힌 지역 제한을 무시하고, 7개 지역 중 원하는 곳에 유닛을 배치합니다.",
    strategyTip: "상대 후방이나 비어 있는 지역에 병력을 꽂아 넣어 7지역 지배 승리를 노리기 좋습니다.",
  },
  ELF_GREEN_MOVES: {
    triggerCondition: "초록색(종족) 카드를 내려놓을 때",
    detail: "지도 위에서 자신의 유닛 이동을 2회 수행합니다.",
    strategyTip: "종족 수집과 전선 재배치를 동시에 하며 인접 지역 교전을 유발할 수 있습니다.",
  },
  DWARF_LANDMARK_DISCOUNT: {
    triggerCondition: "랜드마크 타일을 가져올 때",
    detail: "보드 위 내 요새 수만큼 붙는 추가 주화 비용(요새당 +1)을 면제받습니다.",
    strategyTip: "요새를 많이 지은 후반에도 기본 비용만으로 랜드마크를 연속 확보할 수 있습니다.",
  },
  DWARF_LANDMARK_EXTRA_TURN: {
    triggerCondition: "랜드마크 타일을 가져올 때",
    detail: "이번 차례를 마친 후 즉시 추가 턴 1회를 진행합니다.",
    strategyTip: "랜드마크를 세운 직후 피라미드 카드를 연속으로 가져가 상대의 선택지를 줄입니다.",
  },
  DWARF_WILD_TECH: {
    triggerCondition: "카드·랜드마크 비용을 낼 때 (차례마다)",
    detail: "보유하지 않은 기술 기호 1개를 원하는 종류로 무료 제공받습니다.",
    strategyTip: "부족한 기술을 주화로 메꿀 필요가 줄어 사실상 매 턴 1주화 할인 효과입니다.",
  },
  HOBBIT_EAGLE: {
    triggerCondition: "종족 동맹 승리 판정 시",
    detail: "🦅 독수리 종족 기호로 인정되어 종족 동맹 승리에 필요한 6종족 중 1개를 채웁니다.",
    strategyTip: "5개 종족만 모아도 이 토큰이 6번째 역할을 해 기습적인 즉시 승리가 가능합니다.",
  },
  HOBBIT_BLUE_UNIT: {
    triggerCondition: "파란색(반지) 카드를 내려놓을 때",
    detail: "원하는 지역 1곳에 아군 유닛 1개를 추가로 배치합니다.",
    strategyTip: "반지 트랙을 전진시키면서 지도에도 세력을 투사하는 하이브리드 토큰입니다.",
  },
  HOBBIT_DISCARD_DOUBLE: {
    triggerCondition: "카드를 버릴 때",
    detail: "버리기로 얻는 주화가 2배가 됩니다. (1챕터 2 / 2챕터 4 / 3챕터 6주화)",
    strategyTip: "필요 없는 카드를 버리는 턴이 큰 수입원이 되어 고비용 카드·랜드마크를 노리기 쉽습니다.",
  },
  HUMAN_YELLOW_RING: {
    triggerCondition: "노란색(재정) 카드를 내려놓을 때",
    detail: "반지 트랙에서 자신의 말을 1칸 전진시킵니다.",
    strategyTip: "재정 턴에도 종착점을 향한 레이스에서 한 칸 더 앞서 나갈 수 있습니다.",
  },
  HUMAN_RED_EXTRA_UNIT: {
    triggerCondition: "빨간색(군사) 카드를 내려놓을 때",
    detail: "배치하는 유닛 수가 1개 늘어납니다.",
    strategyTip: "1개 배치는 2개로, 2개 배치는 3개로 강화되어 1:1 상쇄 전투에서 우위를 점합니다.",
  },
  HUMAN_CHAIN_BONUS: {
    triggerCondition: "연계 기호로 카드를 무료 플레이할 때",
    detail: "은행에서 3주화를 즉시 획득합니다.",
    strategyTip: "무료로 카드를 가져오면서 국고까지 채워지는 경제 시너지 토큰입니다.",
  },
  ENT_RING_TWO: {
    triggerCondition: "토큰 획득 즉시 1회",
    detail: "반지 트랙에서 자신의 말을 즉시 2칸 전진시킵니다.",
    strategyTip: "원정대의 마지막 스퍼트, 혹은 나즈굴의 종착점 결승 스퍼트로 쓸 수 있습니다.",
  },
  ENT_DESTROY_FORTRESS: {
    triggerCondition: "토큰 획득 즉시 1회",
    detail: "지도에서 원하는 지역의 상대 요새 1개를 파괴합니다.",
    strategyTip: "일반 전투로는 깰 수 없는 요새를 철거해 지역 지배권을 빼앗아 옵니다.",
  },
  ENT_TRIPLE: {
    triggerCondition: "토큰 획득 즉시 1회",
    detail: "[적 유닛 1개 제거 / 상대 주화 1개 차감 / 유닛 이동 1회] 중에서 3번 선택해 발동합니다. (같은 효과 반복 가능)",
    strategyTip: "병력 제거·국고 압박·기동을 유연하게 조합해 전황을 뒤집는 특수 공격입니다.",
  },
  WIZARD_EXTRA_TURN: {
    triggerCondition: "토큰 획득 즉시 1회",
    detail: "이번 차례를 마친 후 즉시 추가 턴 1회를 진행합니다.",
    strategyTip: "상대가 노리던 핵심 카드나 랜드마크를 먼저 가져갈 템포를 제공합니다.",
  },
  WIZARD_TWO_UNITS: {
    triggerCondition: "토큰 획득 즉시 1회",
    detail: "유닛 2개를 배치합니다. (한 지역에 2개, 또는 서로 다른 두 지역에 1개씩)",
    strategyTip: "빈 지역 2곳을 동시에 점령해 7지역 지배 조건을 빠르게 앞당깁니다.",
  },
  WIZARD_DISCARD_PLAY: {
    triggerCondition: "토큰 획득 즉시 1회",
    detail: "버려진 카드 더미에서 1장을 골라 무료로 내 앞에 내려놓습니다.",
    strategyTip: "상대가 버린 강력한 카드나 연계 기호 카드를 주워 와 전력으로 전환합니다.",
  },
};
