import type { GameMeta } from "./types";

/**
 * The full game catalog. This file is intentionally just data — adding the
 * 21st or 101st game means appending one object here (and, if it's meant to
 * be playable, registering its engine in `playableGames.ts`). Nothing about
 * the dashboard, routing, or betting system needs to change.
 */
export const GAME_REGISTRY: GameMeta[] = [
  {
    id: "hanamikoji",
    name: "하나미코지",
    nameEn: "Hanamikoji",
    description:
      "게이샤 7명의 마음을 사로잡는 2인 전용 카드 게임. 4가지 액션(비밀, 거래, 선물, 경쟁)을 한 번씩만 사용해 상대보다 더 많은 게이샤의 호감을 얻어야 합니다.",
    players: { min: 2, max: 2 },
    playTime: { minMinutes: 15, maxMinutes: 20 },
    category: "card",
    thumbnail: { emoji: "🌸", gradient: ["#f472b6", "#c026d3"], image: "/games/hanamikoji.jpg" },
    tags: ["2인전용", "블러핑", "심리전"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "splendor",
    name: "스플렌더",
    nameEn: "Splendor",
    description:
      "보석 상인이 되어 광산과 상인을 사들이고 카드 콤보를 쌓아 위신 점수를 모으는 엔진 빌딩 게임.",
    players: { min: 2, max: 4 },
    playTime: { minMinutes: 30, maxMinutes: 30 },
    category: "strategy",
    thumbnail: { emoji: "💎", gradient: ["#38bdf8", "#6366f1"], image: "/games/splendor.jpg" },
    tags: ["엔진빌딩", "카드"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "catan",
    name: "카탄의 개척자들",
    nameEn: "Catan",
    description:
      "무인도를 개척하며 자원을 거래하고 도로와 마을을 확장해 가장 먼저 10점을 달성하는 전략 게임.",
    players: { min: 3, max: 4 },
    playTime: { minMinutes: 60, maxMinutes: 120 },
    category: "strategy",
    thumbnail: { emoji: "🏝️", gradient: ["#fb923c", "#ea580c"], image: "/games/catan.jpg" },
    tags: ["자원관리", "협상"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "ticket-to-ride",
    name: "티켓 투 라이드",
    nameEn: "Ticket to Ride",
    description:
      "기차 노선을 연결해 목적지 카드를 완성하는 가족형 전략 게임. 규칙이 쉬워 입문자에게 추천.",
    players: { min: 2, max: 5 },
    playTime: { minMinutes: 30, maxMinutes: 60 },
    category: "family",
    thumbnail: { emoji: "🚂", gradient: ["#34d399", "#059669"] },
    tags: ["루트구축", "가족게임"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "dominion",
    name: "도미니언",
    nameEn: "Dominion",
    description:
      "덱빌딩 장르를 개척한 카드 게임. 왕국 카드를 조합해 나만의 덱을 최적화하고 승점 카드를 쌓아갑니다.",
    players: { min: 2, max: 4 },
    playTime: { minMinutes: 30, maxMinutes: 45 },
    category: "card",
    thumbnail: { emoji: "👑", gradient: ["#a78bfa", "#7c3aed"] },
    tags: ["덱빌딩"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "avalon",
    name: "아발론",
    nameEn: "The Resistance: Avalon",
    description:
      "선한 세력과 악한 세력으로 나뉘어 서로를 속이고 추리하는 정체 은폐 파티 게임.",
    players: { min: 5, max: 10 },
    playTime: { minMinutes: 20, maxMinutes: 40 },
    category: "deduction",
    thumbnail: { emoji: "🗡️", gradient: ["#f87171", "#b91c1c"], image: "/games/avalon.jpg" },
    tags: ["정체은폐", "파티", "대인원"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "codenames",
    name: "코드네임",
    nameEn: "Codenames",
    description:
      "한 단어로 여러 개의 단어를 동시에 연상시켜야 하는 팀 대항 단어 추리 게임.",
    players: { min: 4, max: 10 },
    playTime: { minMinutes: 15, maxMinutes: 30 },
    category: "party",
    thumbnail: { emoji: "🕵️", gradient: ["#fbbf24", "#d97706"] },
    tags: ["팀전", "단어게임", "대인원"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "bang",
    name: "뱅!",
    nameEn: "Bang!",
    description:
      "보안관, 부관, 무법자, 배신자로 나뉘어 서부극 속 총격전을 벌이는 정체 은폐 카드 게임.",
    players: { min: 4, max: 7 },
    playTime: { minMinutes: 30, maxMinutes: 45 },
    category: "deduction",
    thumbnail: { emoji: "🤠", gradient: ["#f59e0b", "#92400e"], image: "/games/bang.png" },
    tags: ["정체은폐", "서부극"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "grid-poker",
    name: "그리드 포커",
    nameEn: "Grid Poker",
    description:
      "5×5 보드판에 공통 카드를 배치해 포커 족보 라인을 완성하고, 상대와 족보를 겨루는 넷플릭스 데스게임 변형 카드 게임.",
    players: { min: 2, max: 6 },
    playTime: { minMinutes: 20, maxMinutes: 35 },
    category: "card",
    thumbnail: { emoji: "🃏", gradient: ["#34d399", "#0f766e"], image: "/games/grid-poker.jpg" },
    tags: ["포커", "타일배치", "심리전"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "no-thanks",
    name: "노땡스",
    nameEn: "No Thanks!",
    description:
      "3~35 숫자 카드를 놓고 벌이는 마이너스 경매 게임. 칩을 내고 넘기거나 카드를 가져와 벌점을 최소화해야 합니다. 연속된 숫자를 모으면 가장 작은 숫자만 벌점으로 계산됩니다.",
    players: { min: 3, max: 7 },
    playTime: { minMinutes: 15, maxMinutes: 25 },
    category: "card",
    thumbnail: { emoji: "🙅", gradient: ["#fbbf24", "#92400e"], image: "/games/no-thanks.png" },
    tags: ["경매", "심리전", "카드"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "perudo",
    name: "페루도",
    nameEn: "Perudo",
    description:
      "각자 주사위 5개를 컵에 숨기고 테이블 전체의 숫자 개수를 예측해 선언을 올리는 주사위 블러핑 게임. 거짓말을 의심하는 '페루도!'와 정확히 맞히는 '맞아!'로 상대의 주사위를 모두 잃게 만들면 승리합니다.",
    players: { min: 2, max: 8 },
    playTime: { minMinutes: 15, maxMinutes: 30 },
    category: "deduction",
    thumbnail: { emoji: "🎲", gradient: ["#f43f5e", "#7f1d1d"], image: "/games/perudo.jpg" },
    tags: ["주사위", "블러핑", "심리전"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "century",
    name: "센추리: 향신료의 길",
    nameEn: "Century: Spice Road",
    description:
      "향신료 상인이 되어 자원을 생산·업그레이드·교환해 점수 카드를 모으는 엔진 빌딩 게임. 카드 사용, 상인 카드 획득, 휴식, 점수 카드 완성 중 매 턴 하나를 골라 무역로를 개척합니다.",
    players: { min: 2, max: 5 },
    playTime: { minMinutes: 30, maxMinutes: 45 },
    category: "strategy",
    thumbnail: { emoji: "🌶️", gradient: ["#f59e0b", "#78350f"], image: "/games/century.png" },
    tags: ["엔진빌딩", "자원관리", "카드"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "mafia",
    name: "마피아",
    nameEn: "Mafia",
    description:
      "시민과 마피아로 나뉘어 밤과 낮을 오가며 서로를 추리하고 설득하는 국민 파티 게임.",
    players: { min: 6, max: 10 },
    playTime: { minMinutes: 20, maxMinutes: 40 },
    category: "party",
    thumbnail: { emoji: "🎭", gradient: ["#64748b", "#1e293b"] },
    tags: ["정체은폐", "파티", "대인원"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "uno",
    name: "우노",
    nameEn: "UNO",
    description:
      "숫자와 색깔을 맞춰 손패를 가장 먼저 없애는 전세계적으로 사랑받는 카드 게임.",
    players: { min: 2, max: 10 },
    playTime: { minMinutes: 15, maxMinutes: 30 },
    category: "family",
    thumbnail: { emoji: "🔴", gradient: ["#ef4444", "#facc15"] },
    tags: ["가족게임", "대인원"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "rummikub",
    name: "루미큐브",
    nameEn: "Rummikub",
    description:
      "숫자 타일을 조합해 런과 그룹을 만들어 손에 든 타일을 모두 없애는 전략 타일 게임.",
    players: { min: 2, max: 4 },
    playTime: { minMinutes: 30, maxMinutes: 45 },
    category: "family",
    thumbnail: { emoji: "🔢", gradient: ["#22d3ee", "#0e7490"] },
    tags: ["타일게임"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "halli-galli",
    name: "할리갈리",
    nameEn: "Halli Galli",
    description:
      "같은 과일이 5개가 되는 순간 누구보다 빠르게 종을 쳐야 하는 반응 속도 카드 게임.",
    players: { min: 2, max: 6 },
    playTime: { minMinutes: 10, maxMinutes: 15 },
    category: "party",
    thumbnail: { emoji: "🔔", gradient: ["#84cc16", "#166534"] },
    tags: ["반응속도", "가족게임"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "agricola",
    name: "아그리콜라",
    nameEn: "Agricola",
    description:
      "농장을 경영하며 가족을 부양하는 묵직한 일꾼 배치 전략 게임. 헤비 유로게임의 명작.",
    players: { min: 1, max: 5 },
    playTime: { minMinutes: 90, maxMinutes: 150 },
    category: "worker-placement",
    thumbnail: { emoji: "🌾", gradient: ["#a3e635", "#4d7c0f"] },
    tags: ["일꾼배치", "헤비게임", "솔로가능"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "7-wonders",
    name: "세븐 원더스",
    nameEn: "7 Wonders",
    description:
      "고대 문명을 발전시켜 불가사의를 건설하는 카드 드래프팅 문명 게임. 대인원도 빠르게 진행됩니다.",
    players: { min: 3, max: 7 },
    playTime: { minMinutes: 30, maxMinutes: 45 },
    category: "strategy",
    thumbnail: { emoji: "🏛️", gradient: ["#fcd34d", "#b45309"] },
    tags: ["드래프팅", "문명"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "telestrations",
    name: "텔레스트레이션",
    nameEn: "Telestrations",
    description:
      "그림과 단어를 번갈아 전달하며 엉뚱하게 변하는 결과를 함께 웃으며 즐기는 파티 게임.",
    players: { min: 4, max: 10 },
    playTime: { minMinutes: 20, maxMinutes: 30 },
    category: "party",
    thumbnail: { emoji: "✏️", gradient: ["#f472b6", "#7e22ce"] },
    tags: ["그림게임", "파티", "대인원"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "dixit",
    name: "딕싯",
    nameEn: "Dixit",
    description:
      "몽환적인 그림 카드로 은유적인 한마디를 던지고, 다른 플레이어들이 정답을 추리하는 상상력 게임.",
    players: { min: 3, max: 6 },
    playTime: { minMinutes: 30, maxMinutes: 30 },
    category: "party",
    thumbnail: { emoji: "🎨", gradient: ["#c084fc", "#4c1d95"] },
    tags: ["상상력", "파티"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "jenga",
    name: "젠가",
    nameEn: "Jenga",
    description:
      "나무 블록을 한 개씩 빼내 위로 쌓으며 탑을 무너뜨리지 않는 사람이 승리하는 균형 게임.",
    players: { min: 2, max: 10 },
    playTime: { minMinutes: 10, maxMinutes: 20 },
    category: "party",
    thumbnail: { emoji: "🧱", gradient: ["#d6a35c", "#7c4a1e"] },
    tags: ["균형게임", "대인원"],
    playable: false,
    supportsAutoRanking: false,
  },
  {
    id: "spot-difference",
    name: "틀린 그림 찾기",
    nameEn: "Spot the Difference",
    description:
      "원본과 살짝 다른 그림을 나란히 놓고 두 팀이 동시에 차이를 찾는 실시간 팀 대결 게임. 내 사진을 업로드해 자동으로 문제를 만드는 커스텀 모드도 지원합니다.",
    players: { min: 2, max: 8 },
    playTime: { minMinutes: 5, maxMinutes: 15 },
    category: "family",
    thumbnail: { emoji: "🔍", gradient: ["#e879f9", "#6b21a8"], image: "/games/spot-difference.jpg" },
    tags: ["팀전", "관찰력", "커스텀사진"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
  {
    id: "five-cucumbers",
    name: "오이 다섯 개",
    nameEn: "Five Cucumbers",
    description:
      "7번의 트릭 중 마지막 트릭만은 절대 따내면 안 되는 역발상 트릭테이킹 게임. 마지막 트릭의 승자는 오이 토큰을 벌점으로 받으며, 정해둔 개수만큼 모으면 탈락합니다.",
    players: { min: 2, max: 6 },
    playTime: { minMinutes: 15, maxMinutes: 25 },
    category: "card",
    thumbnail: { emoji: "🥒", gradient: ["#65d46e", "#15803d"], image: "/games/five-cucumbers.jpg" },
    tags: ["트릭테이킹", "카드", "역발상"],
    playable: true,
    supportsAutoRanking: true,
    onlineMultiplayer: true,
  },
];

export function getGameMeta(id: string): GameMeta | undefined {
  return GAME_REGISTRY.find((g) => g.id === id);
}

/**
 * Shared default-sort helper: playable games first, "준비중" (not yet
 * implemented) games pushed to the end. Relies on `Array.prototype.sort`
 * being a stable sort (guaranteed since ES2019, true for every runtime this
 * app targets) so games within each group keep their existing relative
 * order (catalog order, or whatever order/filter was applied upstream —
 * e.g. a search/category filter run before this).
 *
 * Any list of games shown to the user (dashboard grid, future category
 * views, etc.) should run through this before rendering, so "준비중" items
 * consistently sink to the bottom regardless of what search/filter state
 * produced the list.
 */
export function sortByPlayability<T extends Pick<GameMeta, "playable">>(
  games: T[],
): T[] {
  return [...games].sort((a, b) => Number(b.playable) - Number(a.playable));
}

export const PLAYABLE_GAME_IDS = GAME_REGISTRY.filter((g) => g.playable).map(
  (g) => g.id,
);
