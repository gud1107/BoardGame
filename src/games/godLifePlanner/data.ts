/**
 * 갓생 플래너 카드·수치 데이터 — boardGameRule/갓생플래너/갓생플래너.md §6·§13~§16 그대로.
 * 블록 인덱스는 0부터: 0=B1(00–03) … 7=B8(21–24).
 */

export type Activity = "sleep" | "study" | "exercise" | "work" | "meet" | "rest" | "empty";
export type Track = "knowledge" | "body" | "wealth" | "social";

export const TRACKS: readonly Track[] = ["knowledge", "body", "wealth", "social"];
export const ACTIVITIES: readonly Activity[] = ["sleep", "study", "exercise", "work", "meet", "rest", "empty"];
export const BLOCK_COUNT = 8;

export const TRACK_INFO: Record<Track, { name: string; emoji: string }> = {
  knowledge: { name: "지식", emoji: "📘" },
  body: { name: "몸", emoji: "💪" },
  wealth: { name: "자산", emoji: "💰" },
  social: { name: "관계", emoji: "🤝" },
};

export const ACTIVITY_INFO: Record<Activity, { name: string; emoji: string; short: string }> = {
  sleep: { name: "수면", emoji: "😴", short: "수" },
  study: { name: "공부", emoji: "📘", short: "공" },
  exercise: { name: "운동", emoji: "💪", short: "운" },
  work: { name: "일", emoji: "💼", short: "일" },
  meet: { name: "약속", emoji: "🤝", short: "약" },
  rest: { name: "휴식", emoji: "☕", short: "휴" },
  empty: { name: "빈칸", emoji: "·", short: "·" },
};

export const BLOCK_INFO: readonly { label: string; time: string; name: string }[] = [
  { label: "B1", time: "00–03", name: "심야" },
  { label: "B2", time: "03–06", name: "새벽" },
  { label: "B3", time: "06–09", name: "아침" },
  { label: "B4", time: "09–12", name: "오전" },
  { label: "B5", time: "12–15", name: "오후" },
  { label: "B6", time: "15–18", name: "늦은 오후" },
  { label: "B7", time: "18–21", name: "저녁" },
  { label: "B8", time: "21–24", name: "밤" },
];

export const NIGHT_BLOCKS: readonly number[] = [0, 1, 7];
export const OFFICE_BLOCKS: readonly number[] = [3, 4, 5];
export const DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"] as const;

// ---------------------------------------------------------------------------
// 오늘의 이벤트 (§15)

export type EventId = "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8" | "E9" | "E10" | "E11" | "E12" | "SAT" | "SUN";

export const EVENTS: Record<EventId, { name: string; emoji: string; text: string }> = {
  E1: { name: "축 처지는 날", emoji: "🫠", text: "공부·일의 멘탈 비용 +1" },
  E2: { name: "비 오는 날", emoji: "🌧️", text: "운동 골든타임 보너스 없음 · 휴식 멘탈 +1" },
  E3: { name: "맑은 날", emoji: "☀️", text: "모든 블록에서 운동 몸 +1" },
  E4: { name: "마감 임박", emoji: "⏰", text: "일 자산 +1 · 마감 때 오늘 일을 한 번도 못 했으면 멘탈 −1" },
  E5: { name: "시험 기간", emoji: "📝", text: "공부 지식 +1 · 약속의 기본 관계 +1이 0" },
  E6: { name: "단체 회식", emoji: "🍻", text: "B7·B8 약속은 혼자여도 성사" },
  E7: { name: "갑작스런 야근", emoji: "🧾", text: "모두 B7에 일을 해야 함(야근) · 무기력이면 면제" },
  E8: { name: "꿀잠 날씨", emoji: "🌙", text: "밤잠 멘탈 +1" },
  E9: { name: "친구 생일", emoji: "🎂", text: "약속 성사 시 관계 +2 · 마감 때 약속이 없었으면 관계 −1" },
  E10: { name: "지름신 강림", emoji: "🛍️", text: "유혹 저항 비용 멘탈 −2 (멘탈 2 이하면 저항 불가)" },
  E11: { name: "동기부여 영상", emoji: "🔥", text: "아침에 모두 멘탈 +2" },
  E12: { name: "감기 유행", emoji: "🤧", text: "마감 때 체력 4 이하면 다음 날 몸살(페널티 없음)" },
  SAT: { name: "주말", emoji: "🏖️", text: "근무시간 없음(모든 일 = 특근) · 약속 관계 +1" },
  SUN: { name: "일요일", emoji: "🛋️", text: "주말 효과 + 휴식 멘탈 +1" },
};

export const WEEKDAY_EVENT_DECK: readonly EventId[] = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12"];

// ---------------------------------------------------------------------------
// 기회 카드 (§13.4)

export interface OpportunityCard {
  id: string;
  name: string;
  emoji: string;
  /** 0~7, null = 자유 블록(그날 해당 활동의 첫 블록에서 판정) */
  block: number | null;
  activity: Activity;
  capacity: number;
  minPeople?: number;
  cost?: number; // 자산
  reward: { hp?: number; mp?: number; tracks?: Partial<Record<Track, number>> };
}

export const OPPORTUNITIES: readonly OpportunityCard[] = [
  { id: "O1", name: "새벽 수영반", emoji: "🏊", block: 2, activity: "exercise", capacity: 1, reward: { mp: 1, tracks: { body: 2 } } },
  { id: "O2", name: "원데이 특강", emoji: "🎓", block: 3, activity: "study", capacity: 2, cost: 1, reward: { tracks: { knowledge: 3 } } },
  { id: "O3", name: "스터디 그룹", emoji: "👥", block: 6, activity: "study", capacity: 3, minPeople: 2, reward: { tracks: { knowledge: 2, social: 1 } } },
  { id: "O4", name: "프로젝트 발표", emoji: "📊", block: 4, activity: "work", capacity: 1, reward: { tracks: { wealth: 3 } } },
  { id: "O5", name: "러닝 크루", emoji: "🏃", block: 6, activity: "exercise", capacity: 3, reward: { tracks: { body: 1, social: 1 } } },
  { id: "O6", name: "멘토 커피챗", emoji: "☕", block: 4, activity: "meet", capacity: 1, reward: { tracks: { social: 1, knowledge: 2 } } },
  { id: "O7", name: "부업 의뢰", emoji: "💻", block: 7, activity: "work", capacity: 1, reward: { mp: -1, tracks: { wealth: 3 } } },
  { id: "O8", name: "요가 클래스", emoji: "🧘", block: 5, activity: "exercise", capacity: 2, reward: { mp: 2, tracks: { body: 1 } } },
  { id: "O9", name: "도서관 명당 자리", emoji: "📚", block: 5, activity: "study", capacity: 2, reward: { tracks: { knowledge: 2 } } },
  { id: "O10", name: "동창회", emoji: "🎉", block: 7, activity: "meet", capacity: 4, reward: { tracks: { social: 2 } } },
  { id: "O11", name: "사내 교육", emoji: "🏢", block: 3, activity: "work", capacity: 2, reward: { tracks: { knowledge: 2 } } },
  { id: "O12", name: "아침 명상", emoji: "🪷", block: 2, activity: "rest", capacity: 2, reward: { mp: 2, hp: 1 } },
  { id: "O13", name: "PT 1회권", emoji: "🏋️", block: null, activity: "exercise", capacity: 1, cost: 2, reward: { tracks: { body: 4 } } },
  { id: "O14", name: "공모전 마감", emoji: "🏆", block: 0, activity: "study", capacity: 1, reward: { tracks: { knowledge: 2, wealth: 2 } } },
  { id: "O15", name: "봉사활동", emoji: "🤲", block: 3, activity: "meet", capacity: 3, reward: { mp: 1, tracks: { social: 2 } } },
  { id: "O16", name: "플리마켓", emoji: "🛒", block: 4, activity: "meet", capacity: 2, reward: { tracks: { wealth: 2 } } },
  { id: "O17", name: "건강검진", emoji: "🩺", block: 2, activity: "rest", capacity: 2, reward: { hp: 3 } },
  { id: "O18", name: "네트워킹 파티", emoji: "🥂", block: 6, activity: "meet", capacity: 2, reward: { tracks: { social: 2, wealth: 1 } } },
];

export const OPPORTUNITY_BY_ID: Record<string, OpportunityCard> = Object.fromEntries(OPPORTUNITIES.map((o) => [o.id, o]));

/** §13.1 인원별 하루 공개 장수 */
export function opportunitiesPerDay(seatCount: number): number {
  if (seatCount <= 2) return 2;
  if (seatCount <= 4) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// 유혹 카드 (§14.4)

export interface TemptationCard {
  id: string;
  name: string;
  emoji: string;
  /** "instant" = 블록을 차지하지 않고 실행 시작 때 적용 */
  kind: "block" | "instant";
  /** 차지할 수 있는 블록(시작 블록). null = 자유 */
  allowed: readonly number[] | null;
  span: 1 | 2;
  /** span 2 고정 카드(T9)는 정확히 이 블록들 */
  fixedBlocks?: readonly number[];
  effect: { hp?: number; mp?: number; tracks?: Partial<Record<Track, number>> };
  /** 낮잠으로 처리(T4) */
  nap?: boolean;
  dayEndHp?: number; // T2 야식
  nextMorningHp?: number; // T9 숙취
  text: string;
}

export const TEMPTATIONS: Record<string, TemptationCard> = {
  T1: { id: "T1", name: "숏폼 무한 스크롤", emoji: "📱", kind: "block", allowed: null, span: 1, effect: { mp: 1 }, text: "자유 1블록 · 멘탈 +1" },
  T2: { id: "T2", name: "야식", emoji: "🍗", kind: "block", allowed: [6, 7], span: 1, effect: { mp: 2 }, dayEndHp: -1, text: "B7 또는 B8 · 멘탈 +2 / 마감 때 체력 −1" },
  T3: { id: "T3", name: "밤샘 게임", emoji: "🎮", kind: "block", allowed: [0, 7], span: 1, effect: { mp: 3, hp: -1 }, text: "B1 또는 B8 · 멘탈 +3, 체력 −1" },
  T4: { id: "T4", name: "늦잠", emoji: "🛌", kind: "block", allowed: [2], span: 1, effect: { hp: 1 }, nap: true, text: "B3 고정 · 낮잠(체력 +1). B3에 이미 수면이면 그대로" },
  T5: { id: "T5", name: "충동구매", emoji: "💳", kind: "instant", allowed: null, span: 1, effect: { mp: 2, tracks: { wealth: -2 } }, text: "블록 없음 · 자산 −2, 멘탈 +2" },
  T6: { id: "T6", name: "드라마 정주행", emoji: "📺", kind: "block", allowed: null, span: 2, effect: { mp: 3 }, text: "연속 2블록 · 멘탈 +3" },
  T7: { id: "T7", name: "단톡방 수다", emoji: "💬", kind: "block", allowed: null, span: 1, effect: { mp: 1, tracks: { social: 1 } }, text: "자유 1블록 · 멘탈 +1, 관계 +1" },
  T8: { id: "T8", name: "오늘만 쉬자", emoji: "🙈", kind: "block", allowed: null, span: 1, effect: { mp: 2 }, text: "1블록을 휴식으로(멘탈 +2)" },
  T9: { id: "T9", name: "술자리", emoji: "🍺", kind: "block", allowed: [6], span: 2, fixedBlocks: [6, 7], effect: { mp: 1, tracks: { social: 2 } }, nextMorningHp: -2, text: "B7+B8 고정 · 관계 +2, 멘탈 +1 / 다음 날 아침 체력 −2" },
  T10: { id: "T10", name: "점심 후 낮잠", emoji: "😪", kind: "block", allowed: [4], span: 1, effect: { hp: 1, mp: 1 }, text: "B5 고정 · 체력 +1, 멘탈 +1" },
};

export const TEMPTATION_DECK: readonly string[] = [
  "T1", "T1", "T1", "T2", "T2", "T3", "T3", "T4", "T4", "T5", "T5", "T6", "T6", "T7", "T7", "T8", "T8", "T9", "T9", "T10",
];

// ---------------------------------------------------------------------------
// 인생 목표 (§16.1) · 주간 도전 (§16.2)

export interface GoalCard {
  id: string;
  name: string;
  emoji: string;
  text: string;
  points: number;
}

export const LIFE_GOALS: readonly GoalCard[] = [
  { id: "G1", name: "마라톤 완주", emoji: "🏅", text: "몸 32 이상", points: 8 },
  { id: "G2", name: "자격증 합격", emoji: "📜", text: "지식 32 이상", points: 8 },
  { id: "G3", name: "내 집 마련 저축", emoji: "🏠", text: "자산 32 이상", points: 8 },
  { id: "G4", name: "인싸", emoji: "🌟", text: "관계 32 이상", points: 8 },
  { id: "G5", name: "워라밸", emoji: "⚖️", text: "네 트랙 모두 22 이상", points: 9 },
  { id: "G6", name: "미라클 모닝", emoji: "🌅", text: "B2(03–06)에 수면이 아닌 활동을 성공한 날 5일 이상", points: 7 },
  { id: "G7", name: "규칙적인 삶", emoji: "🗓️", text: "게임 종료 때 수면이 아닌 습관 4개", points: 8 },
  { id: "G8", name: "멘탈 갑", emoji: "🧠", text: "붕괴 0회 + 최종 멘탈 8 이상", points: 7 },
  { id: "G9", name: "N잡러", emoji: "💼", text: "야근·특근 일 블록 7개 이상 성공", points: 7 },
  { id: "G10", name: "공부하는 직장인", emoji: "🎒", text: "지식 25 이상 + 자산 25 이상", points: 8 },
  { id: "G11", name: "모임왕", emoji: "🥳", text: "약속 성사 10회 이상", points: 7 },
  { id: "G12", name: "독서광", emoji: "📖", text: "공부 습관 1개 이상 + 지식 28 이상", points: 7 },
];

export const CHALLENGES: readonly GoalCard[] = [
  { id: "C1", name: "운동 습관", emoji: "🌱", text: "운동 습관 형성", points: 5 },
  { id: "C2", name: "한 우물", emoji: "🎯", text: "트랙 하나가 20 이상", points: 5 },
  { id: "C3", name: "알찬 하루", emoji: "✨", text: "하루 성장 합 18 이상", points: 5 },
  { id: "C4", name: "의지의 사람", emoji: "🛡️", text: "유혹 저항 누적 5회", points: 5 },
  { id: "C5", name: "소셜 버터플라이", emoji: "🦋", text: "약속 성사 누적 6회", points: 5 },
  { id: "C6", name: "균형 잡힌 삶", emoji: "☯️", text: "네 트랙 모두 12 이상", points: 5 },
  { id: "C7", name: "기회를 잡아라", emoji: "🍀", text: "기회 카드 보상 누적 3회", points: 5 },
  { id: "C8", name: "아침형 인간", emoji: "🐓", text: "B3에서 공부를 성공한 날 누적 3일", points: 5 },
  { id: "C9", name: "완벽한 수면", emoji: "🛏️", text: "하루 밤잠 3블록 + 마감 때 체력 10", points: 5 },
  { id: "C10", name: "습관 부자", emoji: "💎", text: "수면이 아닌 습관 2개를 동시에 보유", points: 5 },
];

export const GOAL_BY_ID: Record<string, GoalCard> = Object.fromEntries(LIFE_GOALS.map((g) => [g.id, g]));
export const CHALLENGE_BY_ID: Record<string, GoalCard> = Object.fromEntries(CHALLENGES.map((g) => [g.id, g]));

// ---------------------------------------------------------------------------
// 튜닝 상수 (§22.9)

export const TUNING = {
  gaugeStart: 7,
  gaugeMax: 10,
  trackMax: 40,
  habitMax: 4,
  collapsePenalty: 3,
  emergencyFloor: 3,
  challengeFirst: 5,
  challengeSecond: 3,
  challengeTwoPlayer: 4,
} as const;
