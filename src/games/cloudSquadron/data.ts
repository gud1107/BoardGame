/**
 * 구름 편대 — 규칙 수치와 공용 타입 (룰북: boardGameRule/구름편대/구름편대.md).
 *
 * 좌표: 세로 화면 360×640 (x→오른쪽, y→아래), 속도 px/s, 시간 ms(시뮬 시각).
 * 수치는 `balance.sim.test.ts` 셀프플레이로 맞췄다(조종사별·인원별 클리어율, 레벨 차이).
 */

export const GAME_ID = "cloud-squadron";
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;

export const W = 360;
export const H = 640;
export const STEP_MS = 1000 / 60;

export type Difficulty = "easy" | "normal" | "hard";

export interface GameOptions {
  /** 스테이지 수: 1 = 구름 바다만 (짧은 판) · 3 = 전체 원정 */
  stages: 1 | 3;
  difficulty: Difficulty;
}

export const DEFAULT_OPTIONS: GameOptions = { stages: 3, difficulty: "normal" };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  const stages = o?.stages === 1 ? 1 : 3;
  const difficulty: Difficulty = o?.difficulty === "easy" || o?.difficulty === "hard" ? o.difficulty : "normal";
  return { stages, difficulty };
}

export const DIFF: Record<Difficulty, { label: string; hp: number; bulletSpeed: number; fire: number; continues: number }> = {
  easy: { label: "순항", hp: 0.8, bulletSpeed: 0.85, fire: 0.75, continues: 2 },
  normal: { label: "편대", hp: 1, bulletSpeed: 1, fire: 1, continues: 1 },
  hard: { label: "폭풍", hp: 1.2, bulletSpeed: 1.12, fire: 1.25, continues: 0 },
};

/** 인원수 보정: 적 체력 × (0.6 + 0.4 × 인원) */
export const hpScale = (players: number) => 0.6 + 0.4 * players;

/* ── 조종사 ─────────────────────────────────────────────────────────── */

export type PilotId = "wind" | "iron" | "firefly" | "bolt" | "shadow" | "flame";
export const PILOT_IDS: PilotId[] = ["wind", "iron", "firefly", "bolt", "shadow", "flame"];

export type PlaneKind = "dart" | "heavy" | "round" | "forward" | "wing" | "twinboom";

export interface Pilot {
  id: PilotId;
  name: string;
  call: string;
  role: string;
  /** 대표 색 (기체 포인트·탄·이름표) */
  color: string;
  /** 어두운 보조색 (기체 몸통 그림자) */
  dark: string;
  plane: PlaneKind;
  /** 이동 속도 px/s · 정밀 비행(Shift) 속도 */
  speed: number;
  focusSpeed: number;
  /** 피격 판정 반지름 (판정점) */
  hitR: number;
  maxHp: number;
  /** 스킬 재사용 ms */
  skillCd: number;
  /** 화면에 보이는 능력치 1~5 */
  stats: { 속도: number; 화력: number; 내구: number; 회피: number };
  quote: string;
  bio: string;
  shot: { name: string; desc: string };
  skill: { name: string; desc: string };
  ult: { name: string; desc: string };
  /** 잘 맞는 동료 한 줄 */
  pair: string;
  /** 초상화 */
  look: {
    skin: string;
    hair: string;
    jacket: string;
    eyes: string;
    hairStyle: "swept" | "buzz" | "pony" | "spiky" | "hood" | "mohawk";
    goggles?: boolean;
    glasses?: boolean;
    beard?: boolean;
    mask?: boolean;
    scarf?: string;
  };
}

export const PILOTS: Record<PilotId, Pilot> = {
  wind: {
    id: "wind",
    name: "바람",
    call: "GALE",
    role: "회피형",
    color: "#5fd4e0",
    dark: "#1d5866",
    plane: "dart",
    speed: 300,
    focusSpeed: 130,
    hitR: 3,
    maxHp: 3,
    skillCd: 6000,
    stats: { 속도: 5, 화력: 2, 내구: 2, 회피: 5 },
    quote: "맞지 않으면 질 일도 없지.",
    bio: "편대에서 제일 빠른 정찰 조종사. 탄막 사이 틈을 먼저 찾아내 길을 열어 줍니다.",
    shot: { name: "쌍발 속사", desc: "가늘고 빠른 탄 두 줄 — 파워가 오르면 바깥 줄이 늘어요." },
    skill: { name: "순풍 대시", desc: "누르는 방향으로 0.35초 돌진, 그동안 무적." },
    ult: { name: "태풍의 눈", desc: "1.6초 동안 주변 적탄을 빨아들인 뒤 사방으로 되쏩니다. 많이 빨아들일수록 강해요." },
    pair: "무쇠 — 무쇠가 막는 동안 앞으로 파고들어요.",
    look: { skin: "#f2c9a5", hair: "#2d6f80", jacket: "#1f5662", eyes: "#13263f", hairStyle: "swept", goggles: true, scarf: "#e9eef9" },
  },
  iron: {
    id: "iron",
    name: "무쇠",
    call: "ANVIL",
    role: "탱커",
    color: "#b4c2d6",
    dark: "#3f4b5e",
    plane: "heavy",
    speed: 205,
    focusSpeed: 105,
    hitR: 5,
    maxHp: 4,
    skillCd: 11000,
    stats: { 속도: 1, 화력: 3, 내구: 5, 회피: 1 },
    quote: "뒤에 서. 다 막아 줄 테니까.",
    bio: "낡은 화물기를 강철판으로 두른 베테랑. 느리지만 체력 4칸으로 편대의 방패가 됩니다.",
    shot: { name: "3갈래 철갑탄", desc: "느리고 묵직한 탄을 부채꼴로 쏩니다." },
    skill: { name: "방패 전개", desc: "3초 동안 앞쪽 반원 방패가 적탄을 막아요. 바로 뒤의 동료도 보호돼요." },
    ult: { name: "강철 돌진", desc: "화면 꼭대기까지 들이받았다 돌아와요. 지나간 줄의 적탄을 지우고 적에게 큰 피해." },
    pair: "번개 — 레이저를 모으는 동안 앞을 막아 줘요.",
    look: { skin: "#d9a67e", hair: "#3b3a3a", jacket: "#4a5566", eyes: "#1b1b1b", hairStyle: "buzz", beard: true },
  },
  firefly: {
    id: "firefly",
    name: "반디",
    call: "LANTERN",
    role: "지원",
    color: "#c6e36a",
    dark: "#4b6420",
    plane: "round",
    speed: 245,
    focusSpeed: 115,
    hitR: 4,
    maxHp: 3,
    skillCd: 13000,
    stats: { 속도: 3, 화력: 2, 내구: 3, 회피: 3 },
    quote: "다치면 바로 말해요. 불 켜고 갈게요.",
    bio: "구조 비행정 출신 정비사. 반디가 있으면 편대가 쉽게 무너지지 않아요.",
    shot: { name: "반딧불 유도탄", desc: "빛 구슬이 가장 가까운 적을 쫓아가요. 조준이 서툴러도 맞아요." },
    skill: { name: "치유 드론", desc: "체력이 가장 적은 동료(나 포함) 1칸 회복, 드론이 6초 동안 같이 쏴요." },
    ult: { name: "신호탄", desc: "쓰러진 동료 전원 즉시 부활 + 모두 체력 1칸 회복 + 1.5초 무적." },
    pair: "불꽃 — 위험하게 붙는 플레이를 부활이 받쳐 줘요.",
    look: { skin: "#f5d2b4", hair: "#7a4a2a", jacket: "#5d7a2c", eyes: "#2a1d10", hairStyle: "pony", glasses: true },
  },
  bolt: {
    id: "bolt",
    name: "번개",
    call: "ARC",
    role: "화력",
    color: "#b38cff",
    dark: "#43287a",
    plane: "forward",
    speed: 240,
    focusSpeed: 110,
    hitR: 4,
    maxHp: 3,
    skillCd: 8000,
    stats: { 속도: 3, 화력: 5, 내구: 2, 회피: 2 },
    quote: "3초만 버텨 줘. 그다음은 내가 끝낸다.",
    bio: "실험용 전기포를 단 시험 비행사. 모으는 동안 무방비지만 터뜨리면 보스 체력이 쭉 빠져요.",
    shot: { name: "관통 레이저", desc: "앞의 적을 뚫고 지나가는 얇은 전기선." },
    skill: { name: "충전 레이저", desc: "0.6초 모았다가 0.9초 굵은 레이저. 같은 줄의 적탄도 지워요." },
    ult: { name: "낙뢰", desc: "화면의 모든 적에게 번개가 연쇄로 떨어지고 적탄 절반이 사라져요." },
    pair: "그림자 — 시간 감속 중엔 레이저를 맞히기 쉬워요.",
    look: { skin: "#efc4a0", hair: "#e9eef9", jacket: "#4b2f86", eyes: "#2b1650", hairStyle: "spiky", goggles: true },
  },
  shadow: {
    id: "shadow",
    name: "그림자",
    call: "DUSK",
    role: "기술",
    color: "#ff6fb1",
    dark: "#5b1f45",
    plane: "wing",
    speed: 275,
    focusSpeed: 120,
    hitR: 3,
    maxHp: 2,
    skillCd: 9000,
    stats: { 속도: 4, 화력: 4, 내구: 1, 회피: 4 },
    quote: "나를 못 보면, 나를 못 쏘겠지.",
    bio: "말수 적은 야간 저격수. 멀리서 한 발씩 정확하게 큰 적을 끊어 냅니다.",
    shot: { name: "저격탄", desc: "느린 연사지만 적을 여러 마리 꿰뚫는 큰 탄." },
    skill: { name: "은신", desc: "2.5초 동안 흐려져 조준탄이 나를 노리지 않고, 맞아도 1번은 스쳐 지나가요." },
    ult: { name: "시간 감속", desc: "4초 동안 모든 적과 적탄이 35% 속도로 느려져요. 편대 전원에게 적용." },
    pair: "바람 — 느려진 탄막을 통째로 빨아들여요.",
    look: { skin: "#e0b391", hair: "#1c2238", jacket: "#262c45", eyes: "#ff6fb1", hairStyle: "hood", mask: true },
  },
  flame: {
    id: "flame",
    name: "불꽃",
    call: "EMBER",
    role: "근접 폭격",
    color: "#ff8a4c",
    dark: "#6e2a14",
    plane: "twinboom",
    speed: 265,
    focusSpeed: 120,
    hitR: 4,
    maxHp: 3,
    skillCd: 9000,
    stats: { 속도: 4, 화력: 4, 내구: 3, 회피: 2 },
    quote: "멀리서 쏘는 건 재미없잖아!",
    bio: "곡예비행단 출신 폭격수. 사거리가 짧지만 붙기만 하면 순식간에 쓸어버립니다.",
    shot: { name: "근접 산탄", desc: "짧고 넓게 퍼지는 탄. 가까울수록 다 맞아요." },
    skill: { name: "네이팜", desc: "3초 동안 지나간 자리에 불길을 남겨 적탄을 태우고 적에게 피해." },
    ult: { name: "융단 폭격", desc: "화면 아래에서 위로 폭탄이 줄지어 터지며 적탄과 적을 쓸어 가요." },
    pair: "반디 — 쓰러져도 다시 일으켜 줘요.",
    look: { skin: "#c98d66", hair: "#d8452b", jacket: "#7a2f1d", eyes: "#2a120a", hairStyle: "mohawk", goggles: true },
  },
};

/* ── 몸·피격 ────────────────────────────────────────────────────────── */

export const INVULN_MS = 1600;
export const RESPAWN_INVULN_MS = 2200;
/** 쓰러진 동료 곁(반지름)에 이 시간 머물면 부활 */
export const REVIVE_R = 46;
export const REVIVE_MS = 2600;
/** 아무도 안 구하러 오면 이 시간 뒤 스스로 체력 1칸으로 복귀 (점수 −) */
export const SELF_REVIVE_MS = 15000;
export const SELF_REVIVE_PENALTY = 500;
/** 스침: 판정점에서 이 거리 안을 지나간 적탄 */
export const GRAZE_R = 16;
export const MAX_POWER = 4;

/* ── 궁극기 게이지 (0~100) ──────────────────────────────────────────── */

export const GAUGE_PER_SEC = 1.1;
export const GAUGE_PER_DMG = 0.055;
export const GAUGE_PER_GRAZE = 1.6;
/** 두 사람이 이 시간 안에 궁극기를 쓰면 합동 궁극기 (피해 ×1.3, 보너스 점수) */
export const COMBO_MS = 2000;
export const COMBO_BONUS = 1.3;

/* ── 적 ─────────────────────────────────────────────────────────────── */

export type EnemyKind = "wasp" | "swallow" | "lancer" | "balloon" | "gunship" | "carrier" | "frigate" | "whale" | "manta" | "citadel";

export interface EnemyInfo {
  name: string;
  hp: number;
  /** 몸 판정 반지름 */
  r: number;
  score: number;
  boss?: boolean;
  mid?: boolean;
}

export const ENEMIES: Record<EnemyKind, EnemyInfo> = {
  wasp: { name: "말벌 드론", hp: 9, r: 13, score: 100 },
  swallow: { name: "제비 요격기", hp: 12, r: 14, score: 150 },
  lancer: { name: "창기병", hp: 16, r: 14, score: 200 },
  balloon: { name: "풍선 포대", hp: 55, r: 22, score: 500 },
  gunship: { name: "철갑 포함", hp: 80, r: 24, score: 700 },
  carrier: { name: "수송 비행선", hp: 170, r: 34, score: 1500 },
  frigate: { name: "폭풍 호위함", hp: 900, r: 46, score: 6000, mid: true },
  whale: { name: "구름 고래", hp: 2600, r: 70, score: 20000, boss: true },
  manta: { name: "번개 쥐가오리", hp: 3000, r: 66, score: 25000, boss: true },
  citadel: { name: "하늘 요새 핵", hp: 3600, r: 62, score: 30000, boss: true },
};

/* ── 스테이지 ───────────────────────────────────────────────────────── */

export interface StageInfo {
  name: string;
  sub: string;
  boss: EnemyKind;
  /** 잡몹 웨이브 구간 길이 (중간 보스 앞·뒤) */
  wavesA: number;
  wavesB: number;
  /** 등장하는 잡몹 */
  pool: EnemyKind[];
}

export const STAGES: StageInfo[] = [
  { name: "구름 바다", sub: "STAGE 1 · SEA OF CLOUDS", boss: "whale", wavesA: 42000, wavesB: 26000, pool: ["wasp", "swallow", "balloon", "gunship"] },
  { name: "폭풍 협곡", sub: "STAGE 2 · STORM CANYON", boss: "manta", wavesA: 44000, wavesB: 28000, pool: ["wasp", "swallow", "lancer", "gunship", "carrier"] },
  { name: "하늘 요새", sub: "STAGE 3 · SKY CITADEL", boss: "citadel", wavesA: 46000, wavesB: 30000, pool: ["swallow", "lancer", "balloon", "gunship", "carrier"] },
];

/** 중간 보스가 이 시간 안에 안 잡히면 물러난다 */
export const MID_TIMEOUT_MS = 35000;
export const INTRO_MS = 3200;
export const STAGE_CLEAR_MS = 5200;
export const PICK_MS = 25000;
/** 보스전 제한 — 넘으면 보스가 광폭화(탄 1.35배) */
export const BOSS_RAGE_MS = 120000;

/* ── 아이템 ─────────────────────────────────────────────────────────── */

export type ItemKind = "power" | "heal" | "star";
export const ITEM_INFO: Record<ItemKind, { label: string; emoji: string }> = {
  power: { label: "파워 업", emoji: "⚡" },
  heal: { label: "체력 1칸", emoji: "❤" },
  star: { label: "별 (+300점)", emoji: "★" },
};
export const STAR_SCORE = 300;

/* ── 자리 표시: 색 + 모양 ───────────────────────────────────────────── */

export const SEAT_SYMBOLS = ["●", "▲", "■", "◆"] as const;
