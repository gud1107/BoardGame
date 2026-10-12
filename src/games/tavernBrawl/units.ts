/**
 * 여관 난투 정적 데이터 — 유닛 75종 + 토큰 10종, 종족 10개 · 직업 9개 시너지, 영웅 8명.
 * 한 판에는 종족 10개 중 7개만 나온다(engine.ts `tribesInPlay`) — 풀이 너무 묽어지지 않게.
 * 규칙 원전: boardGameRule/여관난투/여관난투.md (수치가 바뀌면 룰북 표도 같이 고칠 것).
 * 이름·효과는 전부 오리지널(하스스톤 전장/롤토체스 고유 카드명·문구 사용 금지).
 */

export type Tribe = "knight" | "beast" | "mech" | "elemental" | "undead" | "dragon" | "sea" | "demon" | "sylvan" | "fae";
export type ClassId = "warrior" | "guardian" | "assassin" | "mage" | "ranger" | "cleric" | "berserker" | "summoner" | "plunderer";
export type Keyword = "taunt" | "shield" | "poison" | "reborn" | "cleave" | "windfury";
/** 효과 대상. shop에서는 내 보드, 전투에서는 내 편 줄을 뜻한다. */
/** randomEnemy/allEnemies는 전투에서만(약화 효과). */
export type Target = "self" | "randomOther" | "allOthers" | "all" | "leftmost" | "randomEnemy" | "allEnemies";

export type Effect =
  | { kind: "buff"; target: Target; tribe?: Tribe; atk: number; hp: number }
  | { kind: "grant"; target: Target; tribe?: Tribe; keyword: Keyword }
  | { kind: "summon"; unit: string; count: number }
  | { kind: "damage"; target: "randomEnemy" | "allEnemies"; amount: number }
  | { kind: "gold"; amount: number }
  | { kind: "freeReroll"; amount: number };

export interface UnitDef {
  id: string;
  name: string;
  emoji: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  tribe: Tribe | null;
  /** 직업. 토큰은 null */
  cls: ClassId | null;
  atk: number;
  hp: number;
  keywords: Keyword[];
  /** 손에서 보드로 낼 때 (상점 단계, 영구) */
  battlecry?: Effect[];
  /** 전투 중 죽을 때 */
  deathrattle?: Effect[];
  /** 전투 시작 시 (전투 동안만) */
  startOfCombat?: Effect[];
  /** 공격하기 직전 (전투 동안만) */
  onAttack?: Effect[];
  /** 같은 편 다른 유닛이 죽을 때 (전투 동안만) */
  onAllyDeath?: Effect[];
  /** 판매할 때 */
  onSell?: Effect[];
  /** 상점 단계가 끝날 때 (영구) — 룰북의 "성장" */
  shopEnd?: Effect[];
  /** 상점 단계가 시작될 때 */
  shopStart?: Effect[];
  /** 토큰: 상점·공용 풀에 없고 소환으로만 등장 */
  token?: boolean;
  text: string;
  /** 봇 평가용 효과 가치(스탯 환산) */
  ev?: number;
}

export const TRIBES: Record<Tribe, { name: string; emoji: string; color: string; levels: [number, string][] }> = {
  knight: {
    name: "기사단",
    emoji: "🛡️",
    color: "#60a5fa",
    levels: [
      [2, "전투 시작: 모든 기사단 +1/+1, 가장 왼쪽 기사단에 보호막"],
      [4, "전투 시작: 모든 기사단 +1/+1, 보호막"],
      [6, "전투 시작: 모든 기사단 +3/+3, 보호막"],
    ],
  },
  beast: {
    name: "야수",
    emoji: "🐾",
    color: "#f59e0b",
    levels: [
      [2, "전투 중 소환되는 야수 +2/+2"],
      [4, "전투 중 소환되는 야수 +3/+3"],
      [6, "전투 중 소환되는 야수 +5/+5"],
    ],
  },
  mech: {
    name: "기계",
    emoji: "⚙️",
    color: "#94a3b8",
    levels: [
      [2, "기계를 팔면 골드 +1 추가"],
      [4, "전투 시작: 모든 기계 +1/+2"],
      [6, "전투 시작: 모든 기계에 부활"],
    ],
  },
  elemental: {
    name: "원소",
    emoji: "🔥",
    color: "#f97316",
    levels: [
      [2, "상점 단계마다 새로고침 1회 무료"],
      [4, "원소를 살 때마다 그 원소 +1/+1"],
      [6, "상점 단계가 끝날 때 모든 원소 +2/+2"],
    ],
  },
  undead: {
    name: "망령",
    emoji: "👻",
    color: "#a78bfa",
    levels: [
      [2, "전투 시작: 모든 망령 +1/+1"],
      [4, "아군이 죽을 때마다 모든 망령 공격력 +1"],
      [6, "전투 시작: 모든 망령에 부활"],
    ],
  },
  dragon: {
    name: "용족",
    emoji: "🐲",
    color: "#ef4444",
    levels: [
      [2, "전투 시작: 모든 용족 +1/+1"],
      [4, "전투 시작: 모든 용족 +3/+3 (2단계 대신)"],
      [6, "전투 시작: 모든 용족 +3/+3, 모든 적에게 피해 3"],
    ],
  },
  sea: {
    name: "해양",
    emoji: "🌊",
    color: "#06b6d4",
    levels: [
      [2, "해양 유닛을 살 때 보드의 다른 해양 +1/+1"],
      [4, "해양 유닛을 살 때 보드의 다른 해양 +2/+2"],
      [6, "해양 유닛을 살 때 보드의 다른 해양 +3/+3"],
    ],
  },
  demon: {
    name: "악마",
    emoji: "😈",
    color: "#dc2626",
    levels: [
      [2, "전투 시작: 모든 악마 +2/+2 · 대가: 상점 단계마다 내 체력 −1"],
      [4, "전투 시작: 모든 악마 +4/+4 (대가 같음)"],
      [6, "전투 시작: 모든 악마 +7/+7 (대가 같음)"],
    ],
  },
  sylvan: {
    name: "숲",
    emoji: "🌿",
    color: "#22c55e",
    levels: [
      [2, "상점 단계가 끝날 때 무작위 숲 1명 +1/+1"],
      [4, "상점 단계가 끝날 때 모든 숲 +1/+1"],
      [6, "상점 단계가 끝날 때 모든 숲 +2/+2"],
    ],
  },
  fae: {
    name: "요정",
    emoji: "🧚",
    color: "#e879f9",
    levels: [
      [2, "요정이 죽으면 무작위 아군 +3/+3"],
      [4, "요정이 죽으면 무작위 아군 +4/+4"],
      [6, "요정이 죽으면 무작위 아군 +6/+6"],
    ],
  },
};

export const CLASSES: Record<ClassId, { name: string; emoji: string; color: string; levels: [number, string][] }> = {
  warrior: { name: "전사", emoji: "⚔️", color: "#f97316", levels: [[2, "전투 시작: 전사 +2/+0"], [4, "전투 시작: 전사 +4/+1"], [6, "전투 시작: 전사 +7/+3"]] },
  guardian: { name: "수호자", emoji: "🧱", color: "#a8a29e", levels: [[2, "전투 시작: 수호자 +0/+2"], [4, "전투 시작: 수호자 +0/+4, 도발"], [6, "전투 시작: 모든 아군 +0/+4, 수호자 도발"]] },
  assassin: { name: "암살자", emoji: "🗡️", color: "#a3e635", levels: [[2, "암살자는 공격력이 가장 높은 적을 노리고(도발 무시) 공격할 때 반격을 받지 않음, +2/+1"], [4, "(2) + 암살자 +4/+2"], [6, "(2)(4) + 암살자에게 독"]] },
  mage: { name: "마법사", emoji: "🔮", color: "#818cf8", levels: [[2, "전투 시작: 마법사마다 무작위 적에게 피해 2"], [4, "마법사마다 피해 3"], [6, "마법사마다 피해 5"]] },
  ranger: { name: "궁수", emoji: "🏹", color: "#84cc16", levels: [[2, "전투 시작: 궁수 +1/+1, 궁수마다 무작위 적에게 자기 공격력만큼 선제 사격"], [4, "(2) + 궁수 +3/+3, 연타"], [6, "(2) + 궁수 +5/+5, 연타"]] },
  cleric: { name: "성직자", emoji: "🕊️", color: "#fde68a", levels: [[2, "전투 시작: 성직자 +0/+2, 무작위 아군 2명 보호막"], [4, "성직자 +0/+2, 아군 4명 보호막"], [6, "성직자 +0/+2, 모든 아군 보호막"]] },
  berserker: { name: "광전사", emoji: "🪓", color: "#ef4444", levels: [[2, "광전사가 피해를 받고 살아남으면 공격력 +1"], [4, "공격력 +2"], [6, "공격력 +4"]] },
  summoner: { name: "소환사", emoji: "📜", color: "#c084fc", levels: [[2, "소환사가 죽으면 2/2 정령 소환"], [4, "4/4 정령"], [6, "7/7 정령"]] },
  plunderer: { name: "약탈자", emoji: "💰", color: "#facc15", levels: [[2, "전투 시작: 약탈자 +2/+2 · 다음 라운드 골드 +1 (이기면 +1 더)"], [4, "약탈자 +3/+3 · 골드 +2 (이기면 +1 더)"], [6, "약탈자 +5/+5 · 골드 +4 (이기면 +1 더)"]] },
};

export const CLASS_ORDER: ClassId[] = ["warrior", "guardian", "assassin", "mage", "ranger", "cleric", "berserker", "summoner", "plunderer"];

export const TRIBE_ORDER: Tribe[] = ["knight", "beast", "mech", "elemental", "undead", "dragon", "sea", "demon", "sylvan", "fae"];

export const KEYWORDS: Record<Keyword, { name: string; icon: string; text: string }> = {
  taunt: { name: "도발", icon: "🧱", text: "적은 도발 유닛부터 공격해야 해요." },
  shield: { name: "보호막", icon: "✨", text: "처음 받는 피해 한 번을 막아요." },
  poison: { name: "독", icon: "🧪", text: "이 유닛에게 피해를 받은 유닛은 즉사해요." },
  reborn: { name: "부활", icon: "🔁", text: "처음 죽으면 체력 1로 한 번 되살아나요." },
  cleave: { name: "광역", icon: "🌀", text: "공격할 때 대상 양옆 유닛에게도 같은 피해를 줘요." },
  windfury: { name: "연타", icon: "⚡", text: "자기 차례에 두 번 연달아 공격해요." },
};

const U = (d: UnitDef) => d;

export const UNITS: UnitDef[] = [
  // ── 1등급 ─────────────────────────────────────────────
  U({ id: "k_squire", name: "견습 방패병", emoji: "🪖", tier: 1, tribe: "knight", cls: "guardian", atk: 1, hp: 3, keywords: ["taunt"], text: "도발", ev: 1 }),
  U({ id: "b_rabbit", name: "굴토끼", emoji: "🐇", tier: 1, tribe: "beast", cls: "summoner", atk: 1, hp: 1, keywords: [], deathrattle: [{ kind: "summon", unit: "t_bunny", count: 1 }], text: "죽음의 메아리: 1/1 아기 토끼 소환", ev: 2 }),
  U({ id: "b_dog", name: "들개", emoji: "🐕", tier: 1, tribe: "beast", cls: "warrior", atk: 3, hp: 2, keywords: [], text: "" }),
  U({ id: "m_mouse", name: "태엽 쥐", emoji: "🐭", tier: 1, tribe: "mech", cls: "plunderer", atk: 2, hp: 1, keywords: [], onSell: [{ kind: "gold", amount: 1 }], text: "판매 시: 골드 +1 추가", ev: 1 }),
  U({ id: "e_ember", name: "불씨 정령", emoji: "🕯️", tier: 1, tribe: "elemental", cls: "mage", atk: 1, hp: 2, keywords: [], shopEnd: [{ kind: "buff", target: "self", atk: 1, hp: 1 }], text: "성장: 상점 단계가 끝날 때 +1/+1", ev: 2 }),
  U({ id: "u_skeleton", name: "해골 병사", emoji: "💀", tier: 1, tribe: "undead", cls: "warrior", atk: 2, hp: 1, keywords: ["reborn"], text: "부활", ev: 0 }),
  U({ id: "d_whelp", name: "아기 용", emoji: "🐣", tier: 1, tribe: "dragon", cls: "berserker", atk: 2, hp: 3, keywords: [], text: "" }),
  U({ id: "n_kid", name: "여관 꼬마", emoji: "🧒", tier: 1, tribe: null, cls: "cleric", atk: 1, hp: 2, keywords: [], battlecry: [{ kind: "buff", target: "randomOther", atk: 1, hp: 1 }], text: "전투의 함성: 무작위 다른 아군 +1/+1", ev: 2 }),

  // ── 2등급 ─────────────────────────────────────────────
  U({ id: "k_guardian", name: "성당 수호자", emoji: "⛪", tier: 2, tribe: "knight", cls: "cleric", atk: 2, hp: 3, keywords: ["shield"], text: "보호막" }),
  U({ id: "b_wolfmom", name: "어미 늑대", emoji: "🐺", tier: 2, tribe: "beast", cls: "summoner", atk: 2, hp: 2, keywords: [], deathrattle: [{ kind: "summon", unit: "t_wolf", count: 1 }], text: "죽음의 메아리: 2/2 새끼 늑대 소환", ev: 4 }),
  U({ id: "m_repair", name: "수리 로봇", emoji: "🔧", tier: 2, tribe: "mech", cls: "cleric", atk: 2, hp: 3, keywords: [], battlecry: [{ kind: "buff", target: "randomOther", tribe: "mech", atk: 1, hp: 2 }], text: "전투의 함성: 무작위 다른 아군 기계 +1/+2", ev: 2 }),
  U({ id: "e_droplet", name: "물방울 정령", emoji: "💧", tier: 2, tribe: "elemental", cls: "mage", atk: 3, hp: 3, keywords: [], battlecry: [{ kind: "freeReroll", amount: 1 }], text: "전투의 함성: 이번 상점 새로고침 1회 무료", ev: 1 }),
  U({ id: "u_crow", name: "시체 까마귀", emoji: "🐦‍⬛", tier: 2, tribe: "undead", cls: "assassin", atk: 2, hp: 3, keywords: [], onAllyDeath: [{ kind: "buff", target: "self", atk: 1, hp: 0 }], text: "아군이 죽을 때마다 공격력 +1", ev: 2 }),
  U({ id: "d_flame", name: "불꽃 새끼용", emoji: "🦎", tier: 2, tribe: "dragon", cls: "mage", atk: 3, hp: 2, keywords: [], startOfCombat: [{ kind: "damage", target: "randomEnemy", amount: 2 }], text: "전투 시작: 무작위 적에게 피해 2", ev: 2 }),
  U({ id: "n_rogue", name: "독침 도적", emoji: "🗡️", tier: 2, tribe: null, cls: "assassin", atk: 1, hp: 2, keywords: ["poison"], text: "독" }),

  // ── 3등급 ─────────────────────────────────────────────
  U({ id: "k_rider", name: "은빛 기수", emoji: "🏇", tier: 3, tribe: "knight", cls: "warrior", atk: 3, hp: 4, keywords: [], battlecry: [{ kind: "grant", target: "randomOther", keyword: "shield" }], text: "전투의 함성: 무작위 다른 아군에게 보호막", ev: 3 }),
  U({ id: "b_hunter", name: "숲의 사냥꾼", emoji: "🏹", tier: 3, tribe: "beast", cls: "ranger", atk: 4, hp: 3, keywords: [], deathrattle: [{ kind: "buff", target: "randomOther", tribe: "beast", atk: 2, hp: 2 }], text: "죽음의 메아리: 무작위 다른 아군 야수 +2/+2", ev: 3 }),
  U({ id: "m_golem", name: "고철 골렘", emoji: "🤖", tier: 3, tribe: "mech", cls: "berserker", atk: 4, hp: 3, keywords: ["reborn"], text: "부활" }),
  U({ id: "e_wind", name: "바람 정령", emoji: "🌪️", tier: 3, tribe: "elemental", cls: "ranger", atk: 3, hp: 4, keywords: ["cleave"], text: "광역" }),
  U({ id: "u_keeper", name: "묘지기", emoji: "⚰️", tier: 3, tribe: "undead", cls: "summoner", atk: 3, hp: 4, keywords: [], deathrattle: [{ kind: "summon", unit: "t_skel", count: 2 }], text: "죽음의 메아리: 1/1 해골 2마리 소환", ev: 3 }),
  U({ id: "d_guard", name: "비늘 수호룡", emoji: "🦕", tier: 3, tribe: "dragon", cls: "guardian", atk: 3, hp: 5, keywords: ["taunt"], battlecry: [{ kind: "buff", target: "randomOther", tribe: "dragon", atk: 1, hp: 2 }], text: "도발. 전투의 함성: 무작위 다른 아군 용족 +1/+2", ev: 2 }),
  U({ id: "n_merc", name: "떠돌이 용병", emoji: "⚔️", tier: 3, tribe: null, cls: "plunderer", atk: 5, hp: 6, keywords: [], text: "" }),

  // ── 4등급 ─────────────────────────────────────────────
  U({ id: "k_paladin", name: "성기사 단장", emoji: "🔰", tier: 4, tribe: "knight", cls: "guardian", atk: 4, hp: 5, keywords: ["taunt", "shield"], text: "도발, 보호막" }),
  U({ id: "b_bear", name: "동굴 곰", emoji: "🐻", tier: 4, tribe: "beast", cls: "berserker", atk: 3, hp: 5, keywords: ["taunt"], deathrattle: [{ kind: "summon", unit: "t_cub", count: 1 }], text: "도발. 죽음의 메아리: 3/3 새끼 곰 소환", ev: 5 }),
  U({ id: "m_tank", name: "증기 탱크", emoji: "🚂", tier: 4, tribe: "mech", cls: "guardian", atk: 4, hp: 5, keywords: ["taunt"], deathrattle: [{ kind: "summon", unit: "t_scrap", count: 1 }], text: "도발. 죽음의 메아리: 2/2 고철 로봇 소환", ev: 4 }),
  U({ id: "e_lava", name: "용암 거인", emoji: "🌋", tier: 4, tribe: "elemental", cls: "warrior", atk: 5, hp: 5, keywords: [], battlecry: [{ kind: "buff", target: "allOthers", tribe: "elemental", atk: 1, hp: 1 }], text: "전투의 함성: 다른 모든 아군 원소 +1/+1", ev: 3 }),
  U({ id: "u_wraith", name: "독안개 망령", emoji: "🌫️", tier: 4, tribe: "undead", cls: "assassin", atk: 3, hp: 3, keywords: ["poison", "reborn"], text: "독, 부활" }),
  U({ id: "d_dusk", name: "황혼의 비룡", emoji: "🦇", tier: 4, tribe: "dragon", cls: "ranger", atk: 5, hp: 4, keywords: [], onAttack: [{ kind: "buff", target: "randomOther", atk: 1, hp: 1 }], text: "공격할 때마다 무작위 다른 아군 +1/+1", ev: 4 }),
  U({ id: "n_priest", name: "축복의 사제", emoji: "🙏", tier: 4, tribe: null, cls: "cleric", atk: 3, hp: 5, keywords: [], battlecry: [{ kind: "grant", target: "randomOther", keyword: "shield" }, { kind: "buff", target: "randomOther", atk: 1, hp: 1 }], text: "전투의 함성: 무작위 다른 아군에게 보호막, 무작위 다른 아군 +1/+1", ev: 5 }),

  // ── 5등급 ─────────────────────────────────────────────
  U({ id: "k_oath", name: "맹세의 기사", emoji: "⚜️", tier: 5, tribe: "knight", cls: "warrior", atk: 5, hp: 6, keywords: ["shield"], startOfCombat: [{ kind: "buff", target: "all", tribe: "knight", atk: 1, hp: 1 }], text: "보호막. 전투 시작: 모든 아군 기사단 +1/+1", ev: 3 }),
  U({ id: "b_turtle", name: "대지의 거북", emoji: "🐢", tier: 5, tribe: "beast", cls: "guardian", atk: 5, hp: 8, keywords: ["taunt"], shopEnd: [{ kind: "buff", target: "self", atk: 1, hp: 1 }], text: "도발. 성장: 상점 단계가 끝날 때 +1/+1", ev: 3 }),
  U({ id: "m_smith", name: "대장장이 자동인형", emoji: "🦾", tier: 5, tribe: "mech", cls: "plunderer", atk: 5, hp: 5, keywords: [], shopEnd: [{ kind: "buff", target: "all", tribe: "mech", atk: 1, hp: 1 }], text: "성장: 상점 단계가 끝날 때 모든 아군 기계 +1/+1", ev: 5 }),
  U({ id: "e_storm", name: "폭풍 군주", emoji: "⛈️", tier: 5, tribe: "elemental", cls: "mage", atk: 6, hp: 6, keywords: ["cleave"], text: "광역" }),
  U({ id: "u_lich", name: "리치", emoji: "🧙‍♂️", tier: 5, tribe: "undead", cls: "summoner", atk: 4, hp: 7, keywords: [], onAllyDeath: [{ kind: "buff", target: "all", tribe: "undead", atk: 1, hp: 0 }], text: "아군이 죽을 때마다 모든 아군 망령 공격력 +1", ev: 5 }),
  U({ id: "d_drake", name: "화염 드레이크", emoji: "☄️", tier: 5, tribe: "dragon", cls: "mage", atk: 5, hp: 6, keywords: [], startOfCombat: [{ kind: "damage", target: "allEnemies", amount: 1 }], text: "전투 시작: 모든 적에게 피해 1", ev: 5 }),
  U({ id: "n_general", name: "전장의 지휘관", emoji: "🎖️", tier: 5, tribe: null, cls: "warrior", atk: 5, hp: 6, keywords: [], startOfCombat: [{ kind: "buff", target: "allOthers", atk: 1, hp: 1 }], text: "전투 시작: 다른 모든 아군 +1/+1", ev: 6 }),

  // ── 6등급 ─────────────────────────────────────────────
  U({ id: "k_lord", name: "빛의 대영주", emoji: "👑", tier: 6, tribe: "knight", cls: "warrior", atk: 7, hp: 8, keywords: ["shield"], startOfCombat: [{ kind: "grant", target: "allOthers", tribe: "knight", keyword: "shield" }], text: "보호막. 전투 시작: 다른 모든 아군 기사단에 보호막", ev: 6 }),
  U({ id: "b_mammoth", name: "태고의 맘모스", emoji: "🦣", tier: 6, tribe: "beast", cls: "summoner", atk: 8, hp: 8, keywords: [], deathrattle: [{ kind: "summon", unit: "t_calf", count: 2 }], text: "죽음의 메아리: 4/4 새끼 맘모스 2마리 소환", ev: 10 }),
  U({ id: "m_titan", name: "거신 기계", emoji: "🦿", tier: 6, tribe: "mech", cls: "guardian", atk: 6, hp: 7, keywords: ["reborn", "shield"], text: "보호막, 부활" }),
  U({ id: "e_origin", name: "근원의 정령", emoji: "🌟", tier: 6, tribe: "elemental", cls: "cleric", atk: 6, hp: 8, keywords: [], shopEnd: [{ kind: "buff", target: "all", atk: 1, hp: 1 }], text: "성장: 상점 단계가 끝날 때 모든 아군 +1/+1", ev: 8 }),
  U({ id: "u_dk", name: "죽음의 기사", emoji: "☠️", tier: 6, tribe: "undead", cls: "berserker", atk: 7, hp: 6, keywords: ["reborn"], deathrattle: [{ kind: "damage", target: "allEnemies", amount: 2 }], text: "부활. 죽음의 메아리: 모든 적에게 피해 2", ev: 6 }),
  U({ id: "d_elder", name: "고룡", emoji: "🐉", tier: 6, tribe: "dragon", cls: "mage", atk: 7, hp: 7, keywords: [], startOfCombat: [{ kind: "buff", target: "all", tribe: "dragon", atk: 3, hp: 3 }], text: "전투 시작: 모든 아군 용족 +3/+3", ev: 8 }),
  U({ id: "n_alch", name: "황금 연금술사", emoji: "⚗️", tier: 6, tribe: null, cls: "plunderer", atk: 5, hp: 6, keywords: [], shopStart: [{ kind: "gold", amount: 2 }], text: "상점 단계가 시작될 때 골드 +2", ev: 6 }),

  // ── 확장: 해양 · 악마 · 숲 · 요정 · 중립 추가 ──────────────
  U({ id: "s_crab", name: "집게 게", emoji: "🦀", tier: 1, tribe: "sea", cls: "warrior", atk: 2, hp: 2, keywords: [], text: "" }),
  U({ id: "s_fish", name: "꼬마 물고기", emoji: "🐟", tier: 1, tribe: "sea", cls: "cleric", atk: 1, hp: 2, keywords: [], battlecry: [{ kind: "buff", target: "randomOther", tribe: "sea", atk: 1, hp: 1 }], text: "전투의 함성: 무작위 다른 아군 해양 +1/+1", ev: 2 }),
  U({ id: "s_eel", name: "전기뱀장어", emoji: "🐍", tier: 2, tribe: "sea", cls: "mage", atk: 2, hp: 3, keywords: [], startOfCombat: [{ kind: "damage", target: "randomEnemy", amount: 1 }, { kind: "damage", target: "randomEnemy", amount: 1 }], text: "전투 시작: 무작위 적에게 피해 1, 두 번", ev: 2 }),
  U({ id: "s_pirate", name: "해적 선장", emoji: "🏴‍☠️", tier: 3, tribe: "sea", cls: "plunderer", atk: 4, hp: 4, keywords: [], battlecry: [{ kind: "gold", amount: 1 }], text: "전투의 함성: 골드 +1", ev: 2 }),
  U({ id: "s_octo", name: "먹물 문어", emoji: "🐙", tier: 3, tribe: "sea", cls: "assassin", atk: 2, hp: 5, keywords: ["windfury"], text: "연타" }),
  U({ id: "s_shark", name: "굶주린 상어", emoji: "🦈", tier: 4, tribe: "sea", cls: "berserker", atk: 4, hp: 5, keywords: [], onAttack: [{ kind: "buff", target: "self", atk: 1, hp: 0 }], text: "공격할 때마다 공격력 +1", ev: 3 }),
  U({ id: "s_siren", name: "세이렌", emoji: "🧜‍♀️", tier: 5, tribe: "sea", cls: "mage", atk: 5, hp: 6, keywords: [], startOfCombat: [{ kind: "buff", target: "allEnemies", atk: -1, hp: 0 }], text: "전투 시작: 모든 적 공격력 −1", ev: 6 }),
  U({ id: "s_kraken", name: "심해의 크라켄", emoji: "🦑", tier: 6, tribe: "sea", cls: "guardian", atk: 7, hp: 9, keywords: ["taunt"], deathrattle: [{ kind: "damage", target: "allEnemies", amount: 3 }], text: "도발. 죽음의 메아리: 모든 적에게 피해 3", ev: 7 }),

  U({ id: "dm_imp", name: "임프", emoji: "👿", tier: 1, tribe: "demon", cls: "berserker", atk: 3, hp: 3, keywords: [], text: "" }),
  U({ id: "dm_boar", name: "지옥 멧돼지", emoji: "🐗", tier: 2, tribe: "demon", cls: "warrior", atk: 4, hp: 3, keywords: [], text: "" }),
  U({ id: "dm_warlock", name: "흑마법사", emoji: "🧛", tier: 3, tribe: "demon", cls: "summoner", atk: 3, hp: 4, keywords: [], deathrattle: [{ kind: "summon", unit: "t_imp", count: 1 }], text: "죽음의 메아리: 2/2 꼬마 임프 소환", ev: 3 }),
  U({ id: "dm_shade", name: "그림자 몽마", emoji: "🦹", tier: 3, tribe: "demon", cls: "assassin", atk: 5, hp: 3, keywords: [], text: "" }),
  U({ id: "dm_brute", name: "뿔 악마", emoji: "👹", tier: 4, tribe: "demon", cls: "guardian", atk: 6, hp: 6, keywords: ["taunt"], text: "도발" }),
  U({ id: "dm_general", name: "악마 장군", emoji: "👺", tier: 5, tribe: "demon", cls: "warrior", atk: 7, hp: 7, keywords: [], onAttack: [{ kind: "buff", target: "randomOther", tribe: "demon", atk: 2, hp: 2 }], text: "공격할 때마다 무작위 다른 아군 악마 +2/+2", ev: 5 }),
  U({ id: "dm_archfiend", name: "염소 대악마", emoji: "🐐", tier: 6, tribe: "demon", cls: "berserker", atk: 10, hp: 10, keywords: ["cleave"], text: "광역" }),

  U({ id: "sy_sprout", name: "새싹", emoji: "🌱", tier: 1, tribe: "sylvan", cls: "guardian", atk: 1, hp: 2, keywords: [], shopEnd: [{ kind: "buff", target: "self", atk: 1, hp: 1 }], text: "성장: 상점 단계가 끝날 때 +1/+1", ev: 2 }),
  U({ id: "sy_mush", name: "독버섯", emoji: "🍄", tier: 2, tribe: "sylvan", cls: "mage", atk: 2, hp: 3, keywords: [], deathrattle: [{ kind: "damage", target: "allEnemies", amount: 1 }], text: "죽음의 메아리: 모든 적에게 피해 1", ev: 3 }),
  U({ id: "sy_fox", name: "숲 여우", emoji: "🦊", tier: 2, tribe: "sylvan", cls: "ranger", atk: 2, hp: 3, keywords: ["windfury"], text: "연타" }),
  U({ id: "sy_elf", name: "숲엘프 궁수", emoji: "🧝", tier: 3, tribe: "sylvan", cls: "ranger", atk: 3, hp: 4, keywords: ["windfury"], text: "연타" }),
  U({ id: "sy_treant", name: "고목 정령", emoji: "🌳", tier: 4, tribe: "sylvan", cls: "guardian", atk: 3, hp: 6, keywords: ["taunt"], shopEnd: [{ kind: "buff", target: "self", atk: 1, hp: 1 }], text: "도발. 성장: 상점 단계가 끝날 때 +1/+1", ev: 3 }),
  U({ id: "sy_druid", name: "사슴 드루이드", emoji: "🦌", tier: 5, tribe: "sylvan", cls: "cleric", atk: 5, hp: 6, keywords: [], shopEnd: [{ kind: "buff", target: "randomOther", tribe: "sylvan", atk: 2, hp: 2 }], text: "성장: 상점 단계가 끝날 때 무작위 다른 아군 숲 +2/+2", ev: 5 }),
  U({ id: "sy_worldtree", name: "세계수", emoji: "🌲", tier: 6, tribe: "sylvan", cls: "summoner", atk: 6, hp: 10, keywords: [], deathrattle: [{ kind: "summon", unit: "t_sapling", count: 2 }], text: "죽음의 메아리: 3/3 묘목 2그루 소환", ev: 8 }),

  U({ id: "f_butterfly", name: "나비 요정", emoji: "🦋", tier: 1, tribe: "fae", cls: "cleric", atk: 2, hp: 2, keywords: [], battlecry: [{ kind: "buff", target: "randomOther", atk: 0, hp: 2 }], text: "전투의 함성: 무작위 다른 아군 +0/+2", ev: 2 }),
  U({ id: "f_trickster", name: "장난꾸러기 요정", emoji: "🃏", tier: 2, tribe: "fae", cls: "assassin", atk: 3, hp: 2, keywords: [], text: "" }),
  U({ id: "f_moon", name: "달빛 정령", emoji: "🌙", tier: 3, tribe: "fae", cls: "mage", atk: 3, hp: 3, keywords: [], startOfCombat: [{ kind: "damage", target: "randomEnemy", amount: 2 }], text: "전투 시작: 무작위 적에게 피해 2", ev: 2 }),
  U({ id: "f_unicorn", name: "유니콘", emoji: "🦄", tier: 3, tribe: "fae", cls: "cleric", atk: 3, hp: 5, keywords: [], startOfCombat: [{ kind: "grant", target: "randomOther", keyword: "shield" }], text: "전투 시작: 무작위 다른 아군에게 보호막", ev: 3 }),
  U({ id: "f_nymph", name: "숲의 님프", emoji: "🧝‍♀️", tier: 4, tribe: "fae", cls: "ranger", atk: 3, hp: 6, keywords: ["windfury"], text: "연타" }),
  U({ id: "f_queen", name: "요정 여왕", emoji: "👸", tier: 5, tribe: "fae", cls: "summoner", atk: 5, hp: 7, keywords: [], deathrattle: [{ kind: "summon", unit: "t_fairy", count: 2 }], text: "죽음의 메아리: 2/2 작은 요정 2마리 소환", ev: 6 }),
  U({ id: "f_oberon", name: "꿈의 군주", emoji: "🌈", tier: 6, tribe: "fae", cls: "cleric", atk: 7, hp: 8, keywords: [], startOfCombat: [{ kind: "buff", target: "allOthers", atk: 1, hp: 2 }], text: "전투 시작: 다른 모든 아군 +1/+2", ev: 9 }),

  U({ id: "n_bandit", name: "산적", emoji: "🤠", tier: 2, tribe: null, cls: "plunderer", atk: 3, hp: 3, keywords: [], text: "" }),
  U({ id: "n_ninja", name: "그림자 자객", emoji: "🥷", tier: 4, tribe: null, cls: "assassin", atk: 5, hp: 3, keywords: ["poison"], text: "독" }),
  U({ id: "n_sniper", name: "명사수", emoji: "🎯", tier: 5, tribe: null, cls: "ranger", atk: 5, hp: 6, keywords: ["windfury"], text: "연타" }),

  // ── 토큰 ──────────────────────────────────────────────
  U({ id: "t_bunny", name: "아기 토끼", emoji: "🐰", tier: 1, tribe: "beast", cls: null, atk: 1, hp: 1, keywords: [], token: true, text: "" }),
  U({ id: "t_wolf", name: "새끼 늑대", emoji: "🐶", tier: 1, tribe: "beast", cls: null, atk: 2, hp: 2, keywords: [], token: true, text: "" }),
  U({ id: "t_cub", name: "새끼 곰", emoji: "🧸", tier: 1, tribe: "beast", cls: null, atk: 3, hp: 3, keywords: [], token: true, text: "" }),
  U({ id: "t_calf", name: "새끼 맘모스", emoji: "🐘", tier: 1, tribe: "beast", cls: null, atk: 4, hp: 4, keywords: [], token: true, text: "" }),
  U({ id: "t_scrap", name: "고철 로봇", emoji: "🔩", tier: 1, tribe: "mech", cls: null, atk: 2, hp: 2, keywords: [], token: true, text: "" }),
  U({ id: "t_skel", name: "해골", emoji: "🦴", tier: 1, tribe: "undead", cls: null, atk: 1, hp: 1, keywords: [], token: true, text: "" }),
  U({ id: "t_imp", name: "꼬마 임프", emoji: "🧌", tier: 1, tribe: "demon", cls: null, atk: 2, hp: 2, keywords: [], token: true, text: "" }),
  U({ id: "t_sapling", name: "묘목", emoji: "🪴", tier: 1, tribe: "sylvan", cls: null, atk: 3, hp: 3, keywords: [], token: true, text: "" }),
  U({ id: "t_fairy", name: "작은 요정", emoji: "🪽", tier: 1, tribe: "fae", cls: null, atk: 2, hp: 2, keywords: [], token: true, text: "" }),
  U({ id: "t_spirit", name: "소환 정령", emoji: "🌀", tier: 1, tribe: null, cls: null, atk: 2, hp: 2, keywords: [], token: true, text: "소환사 시너지로 등장" }),
];

export const UNIT_BY_ID: Record<string, UnitDef> = Object.fromEntries(UNITS.map((u) => [u.id, u]));
export const POOL_UNITS = UNITS.filter((u) => !u.token);

export function unitDef(id: string): UnitDef {
  const d = UNIT_BY_ID[id];
  if (!d) throw new Error(`unknown unit ${id}`);
  return d;
}

/** 등급별 공용 풀 수량(8인 기준). 인원이 적으면 POOL_SCALE로 줄인다. */
export const POOL_COPIES: Record<number, number> = { 1: 16, 2: 15, 3: 13, 4: 11, 5: 9, 6: 7 };

/** 여관 등급별 상점 칸 수 */
export const SHOP_SLOTS = [0, 3, 4, 4, 5, 5, 6] as const;

/** 여관 등급별 상점 유닛 등급 확률(%) — 인덱스 0 = 1등급 */
export const TIER_ODDS: number[][] = [
  [],
  [100],
  [70, 30],
  [35, 45, 20],
  [25, 30, 30, 15],
  [15, 25, 30, 20, 10],
  [10, 15, 25, 25, 15, 10],
];

/** 다음 등급으로 올리는 기본 비용 (인덱스 = 목표 등급) */
export const UPGRADE_BASE = [0, 0, 5, 7, 8, 9, 10] as const;

export type HeroId = "mage" | "mercenary" | "castellan" | "merchant" | "tamer" | "prophet" | "necro" | "architect";

export interface HeroDef {
  id: HeroId;
  name: string;
  emoji: string;
  power: string;
  /** null = 지속 효과(누를 필요 없음) */
  cost: number | null;
  needsTarget?: boolean;
  text: string;
}

export const HEROES: HeroDef[] = [
  { id: "mage", name: "견습 마법사", emoji: "🧙", power: "마력 주입", cost: 1, needsTarget: true, text: "1골드: 고른 아군(보드) +1/+1. 라운드당 1번." },
  { id: "mercenary", name: "떠돌이 용병대장", emoji: "🗡️", power: "호객 행위", cost: null, text: "지속: 상점 칸 +1, 상점 단계마다 새로고침 2번 무료." },
  { id: "castellan", name: "성채 군주", emoji: "🏰", power: "수호의 맹세", cost: null, text: "지속: 전투 시작 시 가장 왼쪽 아군에게 보호막." },
  { id: "merchant", name: "상인 왕", emoji: "💰", power: "흥정의 달인", cost: null, text: "지속: 유닛을 팔 때 골드 +1 추가." },
  { id: "tamer", name: "용의 조련사", emoji: "🧝", power: "포효", cost: 3, text: "3골드: 보드의 모든 아군 +1/+1. 라운드당 1번." },
  { id: "prophet", name: "예언자", emoji: "🔮", power: "예지", cost: 3, text: "3골드: 내 여관 등급 유닛 3장 중 1장을 골라 손으로. 라운드당 1번." },
  { id: "necro", name: "강령술사", emoji: "🪦", power: "되살림", cost: null, text: "지속: 전투마다 처음 죽는 아군(부활 없는)이 체력 1로 되살아남." },
  { id: "architect", name: "건축가", emoji: "🏗️", power: "증축", cost: null, text: "지속: 여관 등급업 비용 항상 2 할인." },
];

export const HERO_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));
