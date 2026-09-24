import type { CharacterId, Faction, LotrCard, LotrCharacter, RegionNode } from "./types";

/**
 * Static data: the Shire→Mordor region graph, the 18 characters and the 36
 * combat cards, transcribed from `boardGameRule/반지의제왕_세븐윈더스/
 * 반지의제왕가운데땅에서의대결.md`.
 *
 * The rulebook has no board diagram, so the graph follows the request's
 * 4-tier sketch (Shire / 3 / 3 / 3 / Mordor) with these interpretation calls:
 * - lanes are joined sideways inside a tier, straight between tiers, and the
 *   Caradhras pass (capacity 1) is additionally joined diagonally to both
 *   flanks on each side — so it is the central shortcut every lane can reach,
 *   and the whole graph is mirror-symmetric between the two factions.
 * - Shire / Mordor are home fortresses of capacity 4. With 3 setup slots
 *   there plus 2 in each of the three adjacent regions, each side has exactly
 *   the rulebook's "지정된 9개 칸".
 */

export const SHIRE = "SHIRE";
export const MORDOR = "MORDOR";

const COL = { left: 17, mid: 50, right: 83 };
const ROW = { 4: 9, 3: 29.5, 2: 50, 1: 70.5, 0: 91 } as const;

export const REGIONS: Record<string, RegionNode> = {
  MORDOR: {
    id: MORDOR,
    name: "모르도르",
    nameEn: "Mordor",
    tier: 4,
    capacity: 4,
    adjacentRegions: ["GORGOROTH", "BARAD_DUR", "CIRITH_UNGOL"],
    isMordor: true,
    x: COL.mid,
    y: ROW[4],
  },
  GORGOROTH: {
    id: "GORGOROTH",
    name: "고르고로스",
    nameEn: "Gorgoroth",
    tier: 3,
    capacity: 2,
    adjacentRegions: [MORDOR, "BARAD_DUR", "ROHAN", "CARADHRAS"],
    x: COL.left,
    y: ROW[3],
  },
  BARAD_DUR: {
    id: "BARAD_DUR",
    name: "바랏두르",
    nameEn: "Barad-dûr",
    tier: 3,
    capacity: 2,
    adjacentRegions: [MORDOR, "GORGOROTH", "CIRITH_UNGOL", "CARADHRAS"],
    x: COL.mid,
    y: ROW[3],
  },
  CIRITH_UNGOL: {
    id: "CIRITH_UNGOL",
    name: "키리스 웅골",
    nameEn: "Cirith Ungol",
    tier: 3,
    capacity: 2,
    adjacentRegions: [MORDOR, "BARAD_DUR", "FANGORN", "CARADHRAS"],
    x: COL.right,
    y: ROW[3],
  },
  ROHAN: {
    id: "ROHAN",
    name: "로한",
    nameEn: "Rohan",
    tier: 2,
    capacity: 2,
    adjacentRegions: ["GORGOROTH", "CARADHRAS", "ERIADOR"],
    x: COL.left,
    y: ROW[2],
  },
  CARADHRAS: {
    id: "CARADHRAS",
    name: "카라드라스",
    nameEn: "Caradhras",
    tier: 2,
    capacity: 1,
    adjacentRegions: ["GORGOROTH", "BARAD_DUR", "CIRITH_UNGOL", "ROHAN", "FANGORN", "ERIADOR", "ANDUIN", "GONDOR"],
    isMountain: true,
    x: COL.mid,
    y: ROW[2],
  },
  FANGORN: {
    id: "FANGORN",
    name: "팡고른",
    nameEn: "Fangorn",
    tier: 2,
    capacity: 2,
    adjacentRegions: ["CIRITH_UNGOL", "CARADHRAS", "GONDOR"],
    x: COL.right,
    y: ROW[2],
  },
  ERIADOR: {
    id: "ERIADOR",
    name: "에리아도르",
    nameEn: "Eriador",
    tier: 1,
    capacity: 2,
    adjacentRegions: ["ROHAN", "CARADHRAS", "ANDUIN", SHIRE],
    x: COL.left,
    y: ROW[1],
  },
  ANDUIN: {
    id: "ANDUIN",
    name: "안두인",
    nameEn: "Anduin",
    tier: 1,
    capacity: 2,
    adjacentRegions: ["CARADHRAS", "ERIADOR", "GONDOR", SHIRE],
    x: COL.mid,
    y: ROW[1],
  },
  GONDOR: {
    id: "GONDOR",
    name: "곤도르",
    nameEn: "Gondor",
    tier: 1,
    capacity: 2,
    adjacentRegions: ["FANGORN", "CARADHRAS", "ANDUIN", SHIRE],
    x: COL.right,
    y: ROW[1],
  },
  SHIRE: {
    id: SHIRE,
    name: "샤이어",
    nameEn: "The Shire",
    tier: 0,
    capacity: 4,
    adjacentRegions: ["ERIADOR", "ANDUIN", "GONDOR"],
    isShire: true,
    x: COL.mid,
    y: ROW[0],
  },
};

export const REGION_IDS = Object.keys(REGIONS);

/** Setup slots per region — 3 at home + 2×3 adjacent = 9 per faction. */
export const SETUP_SLOTS: Record<Faction, Record<string, number>> = {
  FELLOWSHIP: { SHIRE: 3, ERIADOR: 2, ANDUIN: 2, GONDOR: 2 },
  SAURON: { MORDOR: 3, GORGOROTH: 2, BARAD_DUR: 2, CIRITH_UNGOL: 2 },
};

export const HOME: Record<Faction, string> = { FELLOWSHIP: SHIRE, SAURON: MORDOR };

export const CHARACTERS: Record<CharacterId, LotrCharacter> = {
  FRODO: {
    id: "FRODO",
    name: "프로도",
    nameEn: "Frodo",
    faction: "FELLOWSHIP",
    basePower: 1,
    emoji: "💍",
    abilityName: "도주",
    abilityDescription: "카드를 내기 전, 뒤쪽 또는 옆쪽의 비어 있거나 아군만 있는 인접 칸으로 즉시 도망칠 수 있습니다.",
  },
  SAM: {
    id: "SAM",
    name: "샘",
    nameEn: "Sam",
    faction: "FELLOWSHIP",
    basePower: 2,
    emoji: "🍳",
    abilityName: "헌신",
    abilityDescription: "프로도를 공격했던 적과 싸울 때 기본 전투력이 5가 됩니다.",
  },
  ARAGORN: {
    id: "ARAGORN",
    name: "아라곤",
    nameEn: "Aragorn",
    faction: "FELLOWSHIP",
    basePower: 4,
    emoji: "👑",
    abilityName: "돌격",
    abilityDescription: "자신이 공격자(먼저 적 칸에 들어간 쪽)일 때 기본 전투력이 5가 됩니다.",
  },
  GANDALF: {
    id: "GANDALF",
    name: "간달프",
    nameEn: "Gandalf",
    faction: "FELLOWSHIP",
    basePower: 5,
    emoji: "🧙",
    abilityName: "백색의 마법",
    abilityDescription: "상대방 카드의 텍스트 효과를 완전히 무시하고 오직 수치만 적용하게 만듭니다.",
  },
  LEGOLAS: {
    id: "LEGOLAS",
    name: "레골라스",
    nameEn: "Legolas",
    faction: "FELLOWSHIP",
    basePower: 3,
    emoji: "🏹",
    abilityName: "사격",
    abilityDescription: "비행 유닛(나즈굴)과 전투 시, 카드를 내기 전에 적을 즉시 사살합니다.",
  },
  GIMLI: {
    id: "GIMLI",
    name: "김리",
    nameEn: "Gimli",
    faction: "FELLOWSHIP",
    basePower: 3,
    emoji: "🪓",
    abilityName: "오크 학살",
    abilityDescription: "오크 계열(오크 군단·고블린)과 전투 시, 카드를 내기 전에 적을 즉시 처치합니다.",
  },
  BOROMIR: {
    id: "BOROMIR",
    name: "보로미르",
    nameEn: "Boromir",
    faction: "FELLOWSHIP",
    basePower: 0,
    emoji: "📯",
    abilityName: "희생",
    abilityDescription: "전투 시 카드를 내지 않고, 자신과 적 캐릭터를 즉시 동반 사망시킵니다.",
  },
  MERRY: {
    id: "MERRY",
    name: "메리",
    nameEn: "Merry",
    faction: "FELLOWSHIP",
    basePower: 1,
    emoji: "🗡️",
    abilityName: "기습",
    abilityDescription: "위치킹과 전투 시, 카드를 내기 전에 위치킹을 즉시 사살합니다.",
  },
  PIPPIN: {
    id: "PIPPIN",
    name: "피핀",
    nameEn: "Pippin",
    faction: "FELLOWSHIP",
    basePower: 1,
    emoji: "🍎",
    abilityName: "정찰",
    abilityDescription: "전투 시작 시 상대 손패 1장을 무작위로 확인하거나, 전투 대신 옆 칸으로 안전하게 이동합니다.",
  },
  WITCH_KING: {
    id: "WITCH_KING",
    name: "위치킹",
    nameEn: "Witch-king",
    faction: "SAURON",
    basePower: 5,
    emoji: "👻",
    abilityName: "앙그마르의 군주",
    abilityDescription: "원정대 기본 전투 카드의 텍스트 효과(마법·퇴각)를 무효화합니다. 단, 메리의 기습에 즉사합니다.",
  },
  SARUMAN: {
    id: "SARUMAN",
    name: "사루만",
    nameEn: "Saruman",
    faction: "SAURON",
    basePower: 4,
    emoji: "🔮",
    abilityName: "음모",
    abilityDescription: "전투 시 상대가 낸 카드의 텍스트 효과를 무효로 만듭니다.",
  },
  BALROG: {
    id: "BALROG",
    name: "발록",
    nameEn: "Balrog",
    faction: "SAURON",
    basePower: 5,
    emoji: "🔥",
    abilityName: "채찍 동귀어진",
    abilityDescription: "전투에서 패배해 사망하더라도, 승리한 상대 캐릭터를 함께 끌고 가 사망시킵니다.",
  },
  NAZGUL: {
    id: "NAZGUL",
    name: "나즈굴",
    nameEn: "Nazgûl",
    faction: "SAURON",
    basePower: 1,
    emoji: "🦇",
    abilityName: "비행 급습",
    abilityDescription: "지형과 말을 무시하고 전방(샤이어 방향)으로 2칸까지 날아가 기습할 수 있습니다.",
  },
  SHELOB: {
    id: "SHELOB",
    name: "쉐롭",
    nameEn: "Shelob",
    faction: "SAURON",
    basePower: 0,
    emoji: "🕷️",
    abilityName: "맹독의 거미줄",
    abilityDescription: "카드를 내기 전, 상대 캐릭터의 기본 전투력을 0으로 고정합니다.",
  },
  EASTERLING: {
    id: "EASTERLING",
    name: "동부인",
    nameEn: "Easterling",
    faction: "SAURON",
    basePower: 3,
    emoji: "🛡️",
    abilityName: "돌파력",
    abilityDescription: "빈 평지(산맥 제외)를 지나 한 번에 2칸까지 이동할 수 있습니다.",
  },
  CAVE_TROLL: {
    id: "CAVE_TROLL",
    name: "동굴 트롤",
    nameEn: "Cave Troll",
    faction: "SAURON",
    basePower: 9,
    emoji: "🧌",
    abilityName: "괴력",
    abilityDescription: "엄청난 전투력을 지녔으나, 사망하면 상대가 이번에 낸 카드를 버리지 않고 손으로 되돌려받습니다.",
  },
  ORCS: {
    id: "ORCS",
    name: "오크 군단",
    nameEn: "Orcs",
    faction: "SAURON",
    basePower: 2,
    emoji: "👹",
    abilityName: "물량 공세",
    abilityDescription: "전투에서 사망하면 상대가 이번에 낸 카드를 영구 파괴합니다(버린 더미로 가지 않음).",
  },
  GOBLIN: {
    id: "GOBLIN",
    name: "고블린",
    nameEn: "Goblin",
    faction: "SAURON",
    basePower: 1,
    emoji: "👺",
    abilityName: "척후병",
    abilityDescription: "전투 개시 즉시 상대 손패 1장을 무작위로 강제 공개시킵니다.",
  },
};

export const FACTION_CHARACTERS: Record<Faction, CharacterId[]> = {
  FELLOWSHIP: ["FRODO", "SAM", "ARAGORN", "GANDALF", "LEGOLAS", "GIMLI", "BOROMIR", "MERRY", "PIPPIN"],
  SAURON: ["WITCH_KING", "SARUMAN", "BALROG", "NAZGUL", "SHELOB", "EASTERLING", "CAVE_TROLL", "ORCS", "GOBLIN"],
};

export const FLYING: CharacterId[] = ["NAZGUL"];
export const ORC_KIND: CharacterId[] = ["ORCS", "GOBLIN"];

function basicCards(faction: Faction): LotrCard[] {
  const prefix = faction === "FELLOWSHIP" ? "F" : "S";
  const nums: LotrCard[] = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `${prefix}-B${n}`,
    name: `${n}`,
    faction,
    type: "BASIC",
    power: n,
    description: `전투력 +${n}.`,
  }));
  return [
    ...nums,
    {
      id: `${prefix}-MAGIC1`,
      name: "마법",
      faction,
      type: "BASIC",
      power: 0,
      effectType: "MAGIC",
      description: "상대 카드의 텍스트 능력을 무력화하고 수치 대결만 진행합니다.",
    },
    {
      id: `${prefix}-MAGIC2`,
      name: "마법",
      faction,
      type: "BASIC",
      power: 0,
      effectType: "MAGIC",
      description: "상대 카드의 텍스트 능력을 무력화하고 수치 대결만 진행합니다.",
    },
    {
      id: `${prefix}-RETREAT`,
      name: "퇴각",
      faction,
      type: "BASIC",
      power: 0,
      effectType: "RETREAT",
      description: "인접한 빈 후방/측면 칸으로 물러나며 전투를 취소합니다.",
    },
  ];
}

const FELLOWSHIP_SPECIALS: LotrCard[] = [
  { id: "F-BOW", name: "엘프의 활", faction: "FELLOWSHIP", type: "SPECIAL", power: 1, effectType: "ELVEN_BOW", description: "적 기본 전투력이 3 이하면 수치 대결 전에 즉시 사살합니다." },
  { id: "F-CLOAK", name: "요정의 망토", faction: "FELLOWSHIP", type: "SPECIAL", power: 0, effectType: "ELVEN_CLOAK", description: "상대 카드의 전투력 수치를 0으로 만듭니다." },
  { id: "F-MITHRIL", name: "미스릴 갑옷", faction: "FELLOWSHIP", type: "SPECIAL", power: 2, effectType: "MITHRIL_MAIL", description: "패배하더라도 이번 전투에서는 사망하지 않습니다." },
  { id: "F-PHIAL", name: "갈라드리엘의 유리병", faction: "FELLOWSHIP", type: "SPECIAL", power: 3, effectType: "PHIAL", description: "사우론의 즉사 능력(사우론의 눈·모르굴의 칼날·발록의 채찍)을 무효화합니다." },
  { id: "F-ANDURIL", name: "안두릴의 검", faction: "FELLOWSHIP", type: "SPECIAL", power: 5, effectType: "ANDURIL", description: "기본 전투력 4 이상의 캐릭터가 쓰면 +1 추가." },
  { id: "F-ENTS", name: "엔트의 진격", faction: "FELLOWSHIP", type: "SPECIAL", power: 3, effectType: "ENTS", description: "적이 사루만이나 동굴 트롤이면 +3 추가." },
  { id: "F-EAGLES", name: "독수리의 구원", faction: "FELLOWSHIP", type: "SPECIAL", power: 0, effectType: "EAGLES", description: "아군 캐릭터를 샤이어(또는 안전한 후방 빈칸)로 공수해 전투를 취소합니다." },
  { id: "F-SMITE", name: "빛의 일격", faction: "FELLOWSHIP", type: "SPECIAL", power: 4, effectType: "SMITE", description: "어둠의 마법 카드(마법·불경한 마법)를 통째로 취소합니다." },
  { id: "F-ATHELAS", name: "희망의 빛", faction: "FELLOWSHIP", type: "SPECIAL", power: 2, effectType: "ATHELAS", description: "전투 후 버린 더미에서 가장 강한 기본 카드 1장을 손으로 회수합니다." },
];

const SAURON_SPECIALS: LotrCard[] = [
  { id: "S-EYE", name: "사우론의 눈", faction: "SAURON", type: "SPECIAL", power: 1, effectType: "EYE_OF_SAURON", description: "상대 카드의 텍스트와 숫자를 무시하고 양쪽 모두 사망시킵니다." },
  { id: "S-MORGUL", name: "모르굴의 칼날", faction: "SAURON", type: "SPECIAL", power: 3, effectType: "MORGUL_BLADE", description: "상대가 프로도면 수치 계산 없이 즉시 암살합니다." },
  { id: "S-DESPAIR", name: "암흑의 공포", faction: "SAURON", type: "SPECIAL", power: 0, effectType: "DARK_DESPAIR", description: "상대 카드를 수치·텍스트 모두 무효화합니다." },
  { id: "S-GROND", name: "그론드의 일격", faction: "SAURON", type: "SPECIAL", power: 6, effectType: "GROND", description: "강력한 공성 타격. 대신 이 캐릭터는 다음 사우론 턴에 이동할 수 없습니다." },
  { id: "S-SORCERY", name: "불경한 마법", faction: "SAURON", type: "SPECIAL", power: 2, effectType: "BLACK_SORCERY", description: "상대 카드의 전투력 수치를 반으로 줄입니다(올림)." },
  { id: "S-TREACHERY", name: "사악한 속임수", faction: "SAURON", type: "SPECIAL", power: 1, effectType: "TREACHERY", description: "상대가 특수 카드를 냈다면 그 텍스트 효과를 빼앗아 사우론이 적용합니다." },
  { id: "S-ORCMOB", name: "오크 무리의 돌격", faction: "SAURON", type: "SPECIAL", power: 3, effectType: "ORC_MOB", description: "공격자이고 기본 전투력이 2 이하면 +2 추가." },
  { id: "S-SHRIEK", name: "비명", faction: "SAURON", type: "SPECIAL", power: 2, effectType: "NAZGUL_SHRIEK", description: "상대의 퇴각/독수리 카드를 봉쇄하고 수치 대결을 강제합니다." },
  { id: "S-WEB", name: "거대한 거미줄", faction: "SAURON", type: "SPECIAL", power: 0, effectType: "WEB", description: "상대 카드의 전투력 수치를 0으로 고정합니다." },
];

export const ALL_CARDS: LotrCard[] = [...basicCards("FELLOWSHIP"), ...FELLOWSHIP_SPECIALS, ...basicCards("SAURON"), ...SAURON_SPECIALS];

export const CARDS: Record<string, LotrCard> = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]));

export function factionDeck(faction: Faction): string[] {
  return ALL_CARDS.filter((c) => c.faction === faction).map((c) => c.id);
}

export function otherFaction(f: Faction): Faction {
  return f === "FELLOWSHIP" ? "SAURON" : "FELLOWSHIP";
}

export const FACTION_LABEL: Record<Faction, string> = { FELLOWSHIP: "원정대", SAURON: "사우론" };
