import type {
  AllianceRace,
  AllianceToken,
  AllianceTokenId,
  CardColor,
  Faction,
  LandmarkId,
  LandmarkTile,
  LotrDuelCard,
  RegionId,
  TechSymbol,
} from "./types";

/**
 * Static data for 반지의 제왕: 가운데땅에서의 대결 (Duel for Middle-earth).
 *
 * The rulebook (`boardGameRule/반지의제왕_세븐윈더스/반지의제왕가운데땅에서의대결.md`)
 * gives the per-chapter colour counts, the 18 alliance tokens and the 7
 * landmarks, but not the individual card costs, names, region pairs or chain
 * symbols. Those are self-designed here (see HANDOFF.md) to respect its
 * counts: every chapter has exactly 23 cards.
 */

export const REGIONS: RegionId[] = ["LINDON", "ARNOR", "ENEDWAITH", "RHOVANION", "ROHAN", "GONDOR", "MORDOR"];

export const REGION_INFO: Record<RegionId, { name: string; sub: string; x: number; y: number }> = {
  LINDON: { name: "린돈", sub: "회색 항구", x: 13, y: 38 },
  ARNOR: { name: "아르노르", sub: "브리", x: 32, y: 22 },
  ENEDWAITH: { name: "에네드와이스", sub: "아이센가드", x: 28, y: 64 },
  RHOVANION: { name: "로바니온", sub: "에레보르", x: 66, y: 18 },
  ROHAN: { name: "로한", sub: "헬름 협곡", x: 52, y: 58 },
  GONDOR: { name: "곤도르", sub: "미나스 티리스", x: 62, y: 86 },
  MORDOR: { name: "모르도르", sub: "바라드두르", x: 86, y: 62 },
};

/** Self-designed adjacency (the rulebook has no map picture) — a loop with two cross links. */
export const ADJACENCY: Record<RegionId, RegionId[]> = {
  LINDON: ["ARNOR", "ENEDWAITH"],
  ARNOR: ["LINDON", "ENEDWAITH", "RHOVANION"],
  ENEDWAITH: ["LINDON", "ARNOR", "ROHAN"],
  RHOVANION: ["ARNOR", "ROHAN", "MORDOR"],
  ROHAN: ["ENEDWAITH", "RHOVANION", "GONDOR"],
  GONDOR: ["ROHAN", "MORDOR"],
  MORDOR: ["RHOVANION", "GONDOR"],
};

export const FACTION_LABEL: Record<Faction, string> = { FELLOWSHIP: "반지 원정대", SAURON: "사우론" };
export const FACTION_EMOJI: Record<Faction, string> = { FELLOWSHIP: "💍", SAURON: "👁️" };

export const TECH_INFO: Record<TechSymbol, { name: string; emoji: string }> = {
  BOOK: { name: "지식", emoji: "📜" },
  FLAG: { name: "지휘", emoji: "🚩" },
  SWORD: { name: "무력", emoji: "⚔️" },
  MASK: { name: "계략", emoji: "🎭" },
  COURAGE: { name: "용기", emoji: "🔥" },
};
export const TECHS: TechSymbol[] = ["BOOK", "FLAG", "SWORD", "MASK", "COURAGE"];

export const RACE_INFO: Record<AllianceRace | "EAGLE", { name: string; emoji: string }> = {
  ELF: { name: "엘프", emoji: "🧝" },
  DWARF: { name: "드워프", emoji: "⛏️" },
  HOBBIT: { name: "호빗", emoji: "🍀" },
  HUMAN: { name: "인간", emoji: "🛡️" },
  ENT: { name: "엔트", emoji: "🌳" },
  WIZARD: { name: "마법사", emoji: "🧙" },
  EAGLE: { name: "독수리", emoji: "🦅" },
};
export const RACES: AllianceRace[] = ["ELF", "DWARF", "HOBBIT", "HUMAN", "ENT", "WIZARD"];

export const COLOR_INFO: Record<CardColor, { name: string; emoji: string }> = {
  GRAY: { name: "기술", emoji: "⚙️" },
  GREEN: { name: "종족", emoji: "🌿" },
  RED: { name: "군사", emoji: "⚔️" },
  YELLOW: { name: "재정", emoji: "🪙" },
  BLUE: { name: "반지", emoji: "💍" },
  PURPLE: { name: "전술", emoji: "🗡️" },
};

export const CHAIN_INFO: Record<string, string> = {
  LEAF: "🍃",
  PIPE: "🪈",
  HORN: "📯",
  STAFF: "🪄",
  TOWER: "🗼",
  LANTERN: "🏮",
  KEY: "🗝️",
  SHIP: "⛵",
  EYE: "👁️",
  MIRROR: "🪞",
  AXE: "🪓",
  BOAT: "🛶",
  RANGER: "🏹",
  ROOT: "🌱",
  PALANTIR: "🔮",
  HELM: "⛑️",
  BANNER: "🏳️",
  CROWN: "👑",
  FIRE: "🌋",
};

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

type CardInit = Omit<LotrDuelCard, "id" | "chapter">;

function t(...syms: TechSymbol[]): TechSymbol[] {
  return syms;
}

const CHAPTER_1: CardInit[] = [
  // Gray (6): 5 single techs + 1 choice
  { color: "GRAY", name: "리븐델 서고", cost: {}, providesTech: t("BOOK") },
  { color: "GRAY", name: "곤도르 봉화", cost: { coins: 1 }, providesTech: t("FLAG") },
  { color: "GRAY", name: "에레보르 대장간", cost: { coins: 1 }, providesTech: t("SWORD") },
  { color: "GRAY", name: "그림자 첩자", cost: {}, providesTech: t("MASK") },
  { color: "GRAY", name: "샤이어의 용기", cost: {}, providesTech: t("COURAGE") },
  { color: "GRAY", name: "갈림길 지도", cost: { coins: 2 }, selectTechChoice: t("BOOK", "MASK") },
  // Green (6): one per race
  { color: "GREEN", name: "로리엔 궁수", cost: { tech: t("BOOK") }, race: "ELF", providesChain: "LEAF" },
  { color: "GREEN", name: "철산 도끼병", cost: { tech: t("SWORD") }, race: "DWARF", providesChain: "AXE" },
  { color: "GREEN", name: "샤이어 파이프", cost: { coins: 1 }, race: "HOBBIT", providesChain: "PIPE" },
  { color: "GREEN", name: "로한 기마병", cost: { tech: t("FLAG") }, race: "HUMAN", providesChain: "HORN" },
  { color: "GREEN", name: "팡고른의 속삭임", cost: { tech: t("COURAGE") }, race: "ENT", providesChain: "ROOT" },
  { color: "GREEN", name: "회색 순례자", cost: { tech: t("MASK") }, race: "WIZARD", providesChain: "STAFF" },
  // Red (4): 1 unit into one of two adjacent regions
  { color: "RED", name: "국경 순찰대", cost: { tech: t("SWORD") }, militaryUnits: { count: 1, allowedRegions: ["LINDON", "ARNOR"] } },
  { color: "RED", name: "아이센 여울 전초", cost: { coins: 1 }, militaryUnits: { count: 1, allowedRegions: ["ENEDWAITH", "ROHAN"] } },
  { color: "RED", name: "동부 정찰병", cost: { tech: t("FLAG") }, militaryUnits: { count: 1, allowedRegions: ["ARNOR", "RHOVANION"] } },
  { color: "RED", name: "오스길리아스 수비대", cost: { tech: t("COURAGE") }, militaryUnits: { count: 1, allowedRegions: ["GONDOR", "MORDOR"] }, providesChain: "TOWER" },
  // Yellow (4): 2–3 coins + chain for the next chapter
  { color: "YELLOW", name: "브리 여관", cost: {}, coinsReward: 2, providesChain: "LANTERN" },
  { color: "YELLOW", name: "난쟁이 금고", cost: { tech: t("SWORD") }, coinsReward: 3, providesChain: "KEY" },
  { color: "YELLOW", name: "강변 무역선", cost: {}, coinsReward: 2, providesChain: "SHIP" },
  { color: "YELLOW", name: "호빗골 장터", cost: { tech: t("COURAGE") }, coinsReward: 3 },
  // Blue (3): ring +1
  { color: "BLUE", name: "반지의 속삭임", cost: { tech: t("MASK") }, ringAdvance: 1 },
  { color: "BLUE", name: "은밀한 샛길", cost: { tech: t("COURAGE") }, ringAdvance: 1 },
  { color: "BLUE", name: "엘론드의 회의", cost: { coins: 2 }, ringAdvance: 1, providesChain: "EYE" },
];

const CHAPTER_2: CardInit[] = [
  // Red (7): 2 units
  { color: "RED", name: "헬름 협곡 수비대", cost: { tech: t("SWORD", "FLAG"), chainSymbol: "HORN" }, militaryUnits: { count: 2, allowedRegions: ["ENEDWAITH", "ROHAN"] }, providesChain: "HELM" },
  { color: "RED", name: "곤도르 탑 경비대", cost: { tech: t("FLAG", "COURAGE"), chainSymbol: "TOWER" }, militaryUnits: { count: 2, allowedRegions: ["ROHAN", "GONDOR"] }, providesChain: "BANNER" },
  { color: "RED", name: "우루크하이 선봉", cost: { tech: t("SWORD", "MASK") }, militaryUnits: { count: 2, allowedRegions: ["LINDON", "ENEDWAITH"] } },
  { color: "RED", name: "안개산맥 오크떼", cost: { tech: t("MASK", "COURAGE") }, militaryUnits: { count: 2, allowedRegions: ["ARNOR", "ENEDWAITH"] } },
  { color: "RED", name: "어둠숲 거미떼", cost: { tech: t("MASK", "BOOK") }, militaryUnits: { count: 2, allowedRegions: ["RHOVANION", "MORDOR"] }, providesChain: "FIRE" },
  { color: "RED", name: "린돈 수비대", cost: { tech: t("BOOK", "COURAGE") }, militaryUnits: { count: 2, allowedRegions: ["LINDON", "ARNOR"] } },
  { color: "RED", name: "검은 문 군단", cost: { coins: 1, tech: t("SWORD", "COURAGE") }, militaryUnits: { count: 2, allowedRegions: ["GONDOR", "MORDOR"] } },
  // Green (6)
  { color: "GREEN", name: "갈라드리엘의 거울", cost: { tech: t("BOOK", "MASK"), chainSymbol: "LEAF" }, race: "ELF", providesChain: "MIRROR" },
  { color: "GREEN", name: "모리아 광부", cost: { tech: t("SWORD", "COURAGE"), chainSymbol: "AXE" }, race: "DWARF" },
  { color: "GREEN", name: "강노루 나루", cost: { tech: t("COURAGE", "BOOK"), chainSymbol: "PIPE" }, race: "HOBBIT", providesChain: "BOAT" },
  { color: "GREEN", name: "이실리엔 순찰자", cost: { tech: t("FLAG", "SWORD") }, race: "HUMAN", providesChain: "RANGER" },
  { color: "GREEN", name: "엔트 모임", cost: { tech: t("COURAGE", "FLAG"), chainSymbol: "ROOT" }, race: "ENT" },
  { color: "GREEN", name: "오르상크의 탑", cost: { tech: t("BOOK", "MASK"), chainSymbol: "STAFF" }, race: "WIZARD", providesChain: "PALANTIR" },
  // Blue (4): ring +2
  { color: "BLUE", name: "모리아의 어둠", cost: { tech: t("MASK", "COURAGE") }, ringAdvance: 2 },
  { color: "BLUE", name: "라우로스 폭포", cost: { tech: t("BOOK", "COURAGE") }, ringAdvance: 2 },
  { color: "BLUE", name: "죽음의 늪", cost: { tech: t("MASK", "FLAG"), chainSymbol: "EYE" }, ringAdvance: 2, providesChain: "CROWN" },
  { color: "BLUE", name: "시리스 웅골 계단", cost: { coins: 1, tech: t("SWORD", "MASK") }, ringAdvance: 2 },
  // Gray (3): dual choice
  { color: "GRAY", name: "전쟁 회의", cost: { coins: 2 }, selectTechChoice: t("SWORD", "FLAG") },
  { color: "GRAY", name: "옛 전승", cost: { coins: 2 }, selectTechChoice: t("BOOK", "COURAGE") },
  { color: "GRAY", name: "그림자의 속삭임", cost: { coins: 3 }, selectTechChoice: t("MASK", "SWORD") },
  // Yellow (3): 4–6 coins
  { color: "YELLOW", name: "에도라스 보물고", cost: { tech: t("FLAG"), chainSymbol: "LANTERN" }, coinsReward: 4 },
  { color: "YELLOW", name: "델 상인 조합", cost: { tech: t("BOOK", "SWORD"), chainSymbol: "KEY" }, coinsReward: 5 },
  { color: "YELLOW", name: "펠라르기르 항구", cost: { tech: t("COURAGE", "MASK", "FLAG"), chainSymbol: "SHIP" }, coinsReward: 6 },
];

const CHAPTER_3: CardInit[] = [
  // Purple (6): tactics
  { color: "PURPLE", name: "바람의 전령", cost: { tech: t("FLAG", "COURAGE", "BOOK") }, tacticsType: "MULTI_MOVE", tacticsAmount: 2 },
  { color: "PURPLE", name: "강행군", cost: { tech: t("FLAG", "FLAG", "SWORD"), chainSymbol: "BANNER" }, tacticsType: "MULTI_MOVE", tacticsAmount: 3 },
  { color: "PURPLE", name: "숲속의 매복", cost: { tech: t("MASK", "SWORD") }, tacticsType: "SNIPE_UNIT", tacticsAmount: 1 },
  { color: "PURPLE", name: "나즈굴의 급습", cost: { tech: t("MASK", "MASK", "SWORD"), chainSymbol: "FIRE" }, tacticsType: "SNIPE_UNIT", tacticsAmount: 2 },
  { color: "PURPLE", name: "보급로 약탈", cost: { tech: t("MASK", "COURAGE") }, tacticsType: "DRAIN_COINS", tacticsAmount: 3 },
  { color: "PURPLE", name: "공물 강탈", cost: { tech: t("MASK", "BOOK", "SWORD") }, tacticsType: "DRAIN_COINS", tacticsAmount: 4 },
  // Green (6)
  { color: "GREEN", name: "회색 항구의 배", cost: { tech: t("BOOK", "MASK", "COURAGE"), chainSymbol: "MIRROR" }, race: "ELF" },
  { color: "GREEN", name: "외로운 산의 왕", cost: { tech: t("SWORD", "SWORD", "COURAGE") }, race: "DWARF" },
  { color: "GREEN", name: "샤이어 소탕", cost: { tech: t("COURAGE", "COURAGE", "BOOK"), chainSymbol: "BOAT" }, race: "HOBBIT" },
  { color: "GREEN", name: "돌아온 왕", cost: { tech: t("FLAG", "SWORD", "COURAGE"), chainSymbol: "RANGER" }, race: "HUMAN" },
  { color: "GREEN", name: "아이센가드 범람", cost: { tech: t("COURAGE", "FLAG", "SWORD") }, race: "ENT" },
  { color: "GREEN", name: "백색의 간달프", cost: { tech: t("BOOK", "MASK", "FLAG"), chainSymbol: "PALANTIR" }, race: "WIZARD" },
  // Red (5): 2–3 units
  { color: "RED", name: "로히림 돌격", cost: { tech: t("FLAG", "SWORD", "COURAGE"), chainSymbol: "HELM" }, militaryUnits: { count: 3, allowedRegions: ["ROHAN", "GONDOR"] } },
  { color: "RED", name: "펠렌노르 대군", cost: { tech: t("SWORD", "SWORD", "FLAG") }, militaryUnits: { count: 3, allowedRegions: ["GONDOR", "MORDOR"] } },
  { color: "RED", name: "북방 연합군", cost: { tech: t("BOOK", "FLAG", "SWORD") }, militaryUnits: { count: 2, allowedRegions: ["ARNOR", "RHOVANION"] } },
  { color: "RED", name: "하라드림 원군", cost: { tech: t("MASK", "SWORD") }, militaryUnits: { count: 2, allowedRegions: ["RHOVANION", "ROHAN"] } },
  { color: "RED", name: "던랜드 부족", cost: { tech: t("MASK", "COURAGE", "FLAG") }, militaryUnits: { count: 3, allowedRegions: ["LINDON", "ENEDWAITH"] } },
  // Blue (4): ring +2~3
  { color: "BLUE", name: "운명의 틈", cost: { tech: t("COURAGE", "COURAGE", "MASK"), chainSymbol: "CROWN" }, ringAdvance: 3 },
  { color: "BLUE", name: "오로드루인 오르막", cost: { tech: t("COURAGE", "BOOK", "MASK") }, ringAdvance: 3 },
  { color: "BLUE", name: "고르고로스 평원", cost: { tech: t("MASK", "SWORD") }, ringAdvance: 2 },
  { color: "BLUE", name: "셸롭의 굴", cost: { tech: t("BOOK", "COURAGE") }, ringAdvance: 2 },
  // Yellow (2)
  { color: "YELLOW", name: "미나스 티리스 국고", cost: { tech: t("FLAG", "BOOK") }, coinsReward: 7 },
  { color: "YELLOW", name: "바라드두르 공물", cost: { tech: t("MASK", "SWORD") }, coinsReward: 7 },
];

function build(chapter: 1 | 2 | 3, list: CardInit[]): LotrDuelCard[] {
  return list.map((c, i) => ({ ...c, id: `c${chapter}-${String(i + 1).padStart(2, "0")}`, chapter }));
}

export const CHAPTER_DECKS: Record<1 | 2 | 3, LotrDuelCard[]> = {
  1: build(1, CHAPTER_1),
  2: build(2, CHAPTER_2),
  3: build(3, CHAPTER_3),
};
export const ALL_CARDS: LotrDuelCard[] = [...CHAPTER_DECKS[1], ...CHAPTER_DECKS[2], ...CHAPTER_DECKS[3]];
export const CARD_BY_ID: Record<string, LotrDuelCard> = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]));

/**
 * Pyramid shapes — row sizes, top (buried) row first. Positions use
 * half-card units centred on 0, so a card is covered by the cards of the
 * next row whose x differs by exactly 1. Even rows are dealt face-up.
 */
export const PYRAMID_ROWS: Record<1 | 2 | 3, number[][]> = {
  1: [
    [-1, 1],
    [-2, 0, 2],
    [-3, -1, 1, 3],
    [-4, -2, 0, 2, 4],
    [-5, -3, -1, 1, 3, 5],
  ],
  2: [
    [-5, -3, -1, 1, 3, 5],
    [-4, -2, 0, 2, 4],
    [-3, -1, 1, 3],
    [-2, 0, 2],
    [-1, 1],
  ],
  3: [
    [-1, 1],
    [-2, 0, 2],
    [-3, -1, 1, 3],
    [-2, 2],
    [-3, -1, 1, 3],
    [-2, 0, 2],
    [-1, 1],
  ],
};

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

export const LANDMARKS: Record<LandmarkId, LandmarkTile> = {
  BARAD_DUR: {
    id: "BARAD_DUR",
    name: "바라드두르",
    targetRegion: "MORDOR",
    baseCost: { coins: 3, tech: t("MASK") },
    description: "모르도르에 요새 + 버린 카드 더미에서 1장을 골라 무료로 내려놓기",
  },
  BREE: {
    id: "BREE",
    name: "브리",
    targetRegion: "ARNOR",
    baseCost: { coins: 2, tech: t("COURAGE") },
    description: "아르노르에 요새 + 유닛 2개 + 유닛 이동 2회",
  },
  EREBOR: {
    id: "EREBOR",
    name: "에레보르",
    targetRegion: "RHOVANION",
    baseCost: { coins: 2, tech: t("SWORD") },
    description: "로바니온에 요새 + 5주화 + 유닛 이동 1회",
  },
  GREY_HAVENS: {
    id: "GREY_HAVENS",
    name: "회색 항구",
    targetRegion: "LINDON",
    baseCost: { coins: 3, tech: t("BOOK") },
    description: "린돈에 요새 + 원하는 종족 더미 위 2개 중 동맹 토큰 1개 획득",
  },
  HELMS_DEEP: {
    id: "HELMS_DEEP",
    name: "헬름 협곡",
    targetRegion: "ROHAN",
    baseCost: { coins: 3, tech: t("SWORD", "FLAG") },
    description: "로한에 요새 + 유닛 3개",
  },
  ISENGARD: {
    id: "ISENGARD",
    name: "아이센가드",
    targetRegion: "ENEDWAITH",
    baseCost: { coins: 3, tech: t("MASK", "BOOK") },
    description: "에네드와이스에 요새 + 상대 회색 카드 1장 파괴 + 반지 트랙 1칸",
  },
  MINAS_TIRITH: {
    id: "MINAS_TIRITH",
    name: "미나스 티리스",
    targetRegion: "GONDOR",
    baseCost: { coins: 4, tech: t("FLAG", "COURAGE") },
    description: "곤도르에 요새 + 유닛 1개 + 반지 트랙 2칸",
  },
};
export const LANDMARK_IDS = Object.keys(LANDMARKS) as LandmarkId[];

// ---------------------------------------------------------------------------
// Alliance tokens (18 = 6 races × 3)
// ---------------------------------------------------------------------------

export const TOKENS: Record<AllianceTokenId, AllianceToken> = {
  ELF_YELLOW_EXTRA_TURN: { id: "ELF_YELLOW_EXTRA_TURN", race: "ELF", isOneShot: false, name: "엘프의 축복", description: "노란색 카드를 내면 추가 턴" },
  ELF_RED_ANYWHERE: { id: "ELF_RED_ANYWHERE", race: "ELF", isOneShot: false, name: "엘프 길잡이", description: "빨간색 카드의 유닛을 7개 지역 어디에나 배치" },
  ELF_GREEN_MOVES: { id: "ELF_GREEN_MOVES", race: "ELF", isOneShot: false, name: "엘프 행군", description: "초록색 카드를 내면 유닛 이동 2회" },
  DWARF_LANDMARK_DISCOUNT: { id: "DWARF_LANDMARK_DISCOUNT", race: "DWARF", isOneShot: false, name: "드워프 석공", description: "랜드마크의 요새당 추가 주화 면제" },
  DWARF_LANDMARK_EXTRA_TURN: { id: "DWARF_LANDMARK_EXTRA_TURN", race: "DWARF", isOneShot: false, name: "드워프 건축가", description: "랜드마크를 가져오면 추가 턴" },
  DWARF_WILD_TECH: { id: "DWARF_WILD_TECH", race: "DWARF", isOneShot: false, name: "드워프 장인", description: "차례마다 원하는 기술 기호 1개 무료" },
  HOBBIT_EAGLE: { id: "HOBBIT_EAGLE", race: "HOBBIT", isOneShot: false, name: "독수리의 도움", description: "🦅 독수리 — 종족 동맹 승리의 6종족 중 1개로 인정" },
  HOBBIT_BLUE_UNIT: { id: "HOBBIT_BLUE_UNIT", race: "HOBBIT", isOneShot: false, name: "호빗 동행", description: "파란색 카드를 내면 원하는 지역에 유닛 1개" },
  HOBBIT_DISCARD_DOUBLE: { id: "HOBBIT_DISCARD_DOUBLE", race: "HOBBIT", isOneShot: false, name: "호빗 살림꾼", description: "카드를 버릴 때 주화 2배 (2/4/6)" },
  HUMAN_YELLOW_RING: { id: "HUMAN_YELLOW_RING", race: "HUMAN", isOneShot: false, name: "인간의 결의", description: "노란색 카드를 내면 반지 트랙 1칸" },
  HUMAN_RED_EXTRA_UNIT: { id: "HUMAN_RED_EXTRA_UNIT", race: "HUMAN", isOneShot: false, name: "인간 징병", description: "빨간색 카드를 내면 유닛 1개 추가" },
  HUMAN_CHAIN_BONUS: { id: "HUMAN_CHAIN_BONUS", race: "HUMAN", isOneShot: false, name: "인간 교역로", description: "연계로 무료 플레이하면 3주화" },
  ENT_RING_TWO: { id: "ENT_RING_TWO", race: "ENT", isOneShot: true, name: "엔트의 발걸음", description: "즉시 반지 트랙 2칸" },
  ENT_DESTROY_FORTRESS: { id: "ENT_DESTROY_FORTRESS", race: "ENT", isOneShot: true, name: "엔트의 분노", description: "즉시 적 요새 1개 파괴" },
  ENT_TRIPLE: { id: "ENT_TRIPLE", race: "ENT", isOneShot: true, name: "엔트 행진", description: "즉시 [적 유닛 제거 / 상대 1주화 차감 / 유닛 이동] 중 3번 선택" },
  WIZARD_EXTRA_TURN: { id: "WIZARD_EXTRA_TURN", race: "WIZARD", isOneShot: true, name: "마법사의 시간", description: "즉시 추가 턴" },
  WIZARD_TWO_UNITS: { id: "WIZARD_TWO_UNITS", race: "WIZARD", isOneShot: true, name: "마법사의 소환", description: "즉시 유닛 2개 배치 (어느 지역이든)" },
  WIZARD_DISCARD_PLAY: { id: "WIZARD_DISCARD_PLAY", race: "WIZARD", isOneShot: true, name: "마법사의 지혜", description: "즉시 버린 카드 1장을 골라 무료로 내려놓기" },
};
export const TOKEN_IDS_BY_RACE: Record<AllianceRace, AllianceTokenId[]> = {
  ELF: ["ELF_YELLOW_EXTRA_TURN", "ELF_RED_ANYWHERE", "ELF_GREEN_MOVES"],
  DWARF: ["DWARF_LANDMARK_DISCOUNT", "DWARF_LANDMARK_EXTRA_TURN", "DWARF_WILD_TECH"],
  HOBBIT: ["HOBBIT_EAGLE", "HOBBIT_BLUE_UNIT", "HOBBIT_DISCARD_DOUBLE"],
  HUMAN: ["HUMAN_YELLOW_RING", "HUMAN_RED_EXTRA_UNIT", "HUMAN_CHAIN_BONUS"],
  ENT: ["ENT_RING_TWO", "ENT_DESTROY_FORTRESS", "ENT_TRIPLE"],
  WIZARD: ["WIZARD_EXTRA_TURN", "WIZARD_TWO_UNITS", "WIZARD_DISCARD_PLAY"],
};

export function otherFaction(f: Faction): Faction {
  return f === "FELLOWSHIP" ? "SAURON" : "FELLOWSHIP";
}

// ---------------------------------------------------------------------------
// Ring track — official board: 25 points (0 … 24)
// ---------------------------------------------------------------------------

export type RingTrackReward = "NONE" | "COIN_1" | "ALLIANCE_TOKEN" | "MOVE_UNIT" | "PLACE_UNIT" | "MOUNT_DOOM_VICTORY";

export interface RingTrackPoint {
  index: number;
  reward: RingTrackReward;
  isNazgulStart?: boolean;
  isFrodoStart?: boolean;
}

/**
 * 1:1 with the physical board (per the request's photo reading): the Nazgûl
 * start on 0, Frodo & Sam on 13, Mount Doom is 24. Every point a marker passes
 * through or lands on pays its reward once, in order (engine.ts `advanceRing`)
 * — for both sides.
 */
export const OFFICIAL_RING_TRACK: RingTrackPoint[] = [
  { index: 0, reward: "NONE", isNazgulStart: true },
  { index: 1, reward: "NONE" },
  { index: 2, reward: "COIN_1" },
  { index: 3, reward: "NONE" },
  { index: 4, reward: "NONE" },
  { index: 5, reward: "ALLIANCE_TOKEN" },
  { index: 6, reward: "NONE" },
  { index: 7, reward: "NONE" },
  { index: 8, reward: "MOVE_UNIT" },
  { index: 9, reward: "NONE" },
  { index: 10, reward: "NONE" },
  { index: 11, reward: "PLACE_UNIT" },
  { index: 12, reward: "NONE" },
  { index: 13, reward: "COIN_1", isFrodoStart: true },
  { index: 14, reward: "NONE" },
  { index: 15, reward: "NONE" },
  { index: 16, reward: "ALLIANCE_TOKEN" },
  { index: 17, reward: "NONE" },
  { index: 18, reward: "NONE" },
  { index: 19, reward: "MOVE_UNIT" },
  { index: 20, reward: "NONE" },
  { index: 21, reward: "NONE" },
  { index: 22, reward: "PLACE_UNIT" },
  { index: 23, reward: "NONE" },
  { index: 24, reward: "MOUNT_DOOM_VICTORY" },
];

/** Mount Doom. */
export const TRACK_LENGTH = 24;
export const FRODO_START = 13;
export const NAZGUL_START = 0;
