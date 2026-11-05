import type { ThingKind } from "./map";

/**
 * 변신 숨바꼭질 — 변신 카드 · 자세 템플릿 · 시간에 따라 바뀌는 술래 무기.
 * 수치는 여기 한 곳에만 둔다(룰북 md 표도 여기서 옮긴다).
 */

export type FormKind = "prop" | "person" | "dog" | "cat" | "guard" | "vacuum";

export interface DisguiseDef {
  id: string;
  name: string;
  icon: string;
  form: FormKind;
  /** form === "prop"일 때 모양 */
  thing?: ThingKind;
  /** 충돌 반지름·키 */
  r: number;
  h: number;
  /** 걷기 속도 (달리기는 RUN_MULT배) */
  speed: number;
  /** 카드 설명 한 줄 */
  blurb: string;
  /** 뽑힐 가중치 */
  weight: number;
}

export const RUN_MULT = 2.2;

const prop = (id: string, name: string, icon: string, thing: ThingKind, r: number, h: number, blurb: string, weight = 1): DisguiseDef => ({ id, name, icon, form: "prop", thing, r, h, speed: 1.8, blurb, weight });

export const DISGUISES: readonly DisguiseDef[] = [
  // 살아 있는 것 — 움직여도 자연스럽다 (대신 NPC들의 움직임을 흉내 내야 한다)
  { id: "person", name: "행인", icon: "🚶", form: "person", r: 0.3, h: 1.7, speed: 1.8, blurb: "건널목을 건너는 사람들 틈에 섞여요. 신호를 안 지키면 수상해요!", weight: 2.2 },
  { id: "dog", name: "강아지", icon: "🐕", form: "dog", r: 0.32, h: 0.7, speed: 2.0, blurb: "공원·마당을 뛰어다니는 강아지. 빠르지만 집 안에선 튀어요.", weight: 1.8 },
  { id: "cat", name: "고양이", icon: "🐈", form: "cat", r: 0.25, h: 0.5, speed: 1.6, blurb: "작아서 덤불·가구 틈에 쏙. 담 위를 걸어도 어색하지 않아요.", weight: 1.4 },
  { id: "guard", name: "술래인 척", icon: "👮", form: "guard", r: 0.3, h: 1.75, speed: 1.8, blurb: "술래와 똑같은 옷의 점검원. 손을 내밀고 점검하는 척 해야 안 들켜요.", weight: 1.3 },
  { id: "vacuum", name: "로봇 청소기", icon: "🤖", form: "vacuum", r: 0.3, h: 0.25, speed: 1.0, blurb: "집 안을 빙빙 도는 청소기. 납작해서 총에 잘 안 맞아요.", weight: 0.9 },
  // 물건 — 가만히 있으면 진짜와 똑같다. 움직이는 순간 들킨다
  prop("trashcan", "쓰레기통", "🗑️", "trashcan", 0.3, 1.0, "골목·공원 어디에나 있는 쓰레기통."),
  prop("hydrant", "소화전", "🧯", "hydrant", 0.22, 0.8, "작고 단단한 빨간 소화전."),
  prop("bench", "벤치", "🪑", "bench", 0.5, 0.85, "공원 벤치. 커서 눈에 띄지만 숫자가 많아요."),
  prop("cone", "고깔", "🚧", "cone", 0.22, 0.7, "공사장 고깔. 아무 데나 굴러다녀요."),
  prop("mailbox", "우체통", "📮", "mailbox", 0.25, 1.3, "빨간 우체통."),
  prop("vending", "자판기", "🥤", "vending", 0.5, 1.9, "커다란 음료 자판기. 맞추기 쉬우니 조심!", 0.7),
  prop("crate", "나무 상자", "📦", "crate", 0.45, 0.9, "창고·골목에 쌓인 상자. 밟고 올라설 수도 있어요."),
  prop("chair", "의자", "🪑", "chair", 0.25, 0.95, "집 안팎 어디든 어울리는 의자."),
  prop("barrel", "드럼통", "🛢️", "barrel", 0.3, 0.95, "골목의 드럼통."),
  prop("gnome", "정원 난쟁이", "🧙", "gnome", 0.18, 0.6, "마당의 작은 난쟁이 인형. 작아서 잘 안 보여요."),
  prop("plant", "화분", "🪴", "plant", 0.35, 1.5, "큰 화분."),
  prop("hamper", "빨래 바구니", "🧺", "hamper", 0.4, 0.9, "빨래 바구니."),
  prop("toybox", "장난감 상자", "🧸", "toybox", 0.45, 0.78, "아이방 장난감 상자."),
  prop("trunk", "트렁크", "🧳", "trunk", 0.45, 0.75, "다락의 낡은 트렁크."),
  prop("mannequin", "마네킹", "🕴️", "mannequin", 0.25, 1.8, "다락의 마네킹 — 사람 키라서 사람인 척도 돼요."),
  prop("coats", "코트 걸이", "🧥", "coats", 0.3, 1.9, "현관 코트 걸이."),
  prop("washer", "세탁기", "🧺", "washer", 0.38, 0.9, "욕실 세탁기."),
  prop("boxes", "상자 더미", "📦", "boxes", 0.55, 1.1, "창고 상자 더미."),
  prop("desk", "책상", "🖋️", "desk", 0.6, 0.84, "움직이는 책상?! 서재에 있으면 감쪽같아요.", 0.8),
];

const BY_ID = new Map(DISGUISES.map((d) => [d.id, d]));

export function disguise(id: string | null | undefined): DisguiseDef | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/** 판마다 맵에 더 깔리는 소품 종류 (변신할 물건이 진짜 섞여 있게) */
export const FILLER_KINDS: readonly ThingKind[] = ["trashcan", "hydrant", "bench", "cone", "mailbox", "vending", "crate", "chair", "barrel", "gnome", "plant", "hamper", "toybox", "trunk", "washer", "boxes"];

// ---------------------------------------------------------------------------
// 자세 템플릿 (자세 바꾸기 버튼으로 차례로)

export interface PoseDef {
  name: string;
  /** 물건: 추가 회전(라디안) · 넘어짐 */
  yaw?: number;
  tip?: boolean;
  /** 사람·동물: 몸짓 이름 */
  anim?: string;
}

export const POSES: Record<FormKind, readonly PoseDef[]> = {
  prop: [{ name: "기본" }, { name: "90° 돌리기", yaw: Math.PI / 2 }, { name: "뒤돌기", yaw: Math.PI }, { name: "270° 돌리기", yaw: -Math.PI / 2 }, { name: "넘어뜨리기", tip: true }],
  person: [{ name: "서기", anim: "idle" }, { name: "폰 보기", anim: "phone" }, { name: "앉기", anim: "sit" }, { name: "쪼그려 앉기", anim: "crouch" }, { name: "눕기", anim: "lie" }],
  dog: [{ name: "서기", anim: "idle" }, { name: "앉기", anim: "sit" }, { name: "엎드리기", anim: "lie" }, { name: "뒹굴기", anim: "roll" }],
  cat: [{ name: "서기", anim: "idle" }, { name: "식빵 굽기", anim: "loaf" }, { name: "기지개", anim: "stretch" }],
  guard: [{ name: "서기", anim: "idle" }, { name: "점검하기", anim: "inspect" }, { name: "무전하기", anim: "radio" }],
  vacuum: [{ name: "대기" }, { name: "충전 중", yaw: Math.PI }],
};

export function poseOf(form: FormKind, i: number): PoseDef {
  const list = POSES[form];
  return list[((i % list.length) + list.length) % list.length];
}

// ---------------------------------------------------------------------------
// 감정표현 (소리 + 몸짓)

export interface EmoteDef {
  id: string;
  name: string;
  icon: string;
  /** 사람 몸짓 */
  anim: string;
  /** 말풍선/음성 */
  line: string;
  /** 지속(초) */
  dur: number;
}

export const EMOTES: readonly EmoteDef[] = [
  { id: "wave", name: "손 흔들기", icon: "👋", anim: "wave", line: "안녕~", dur: 1.8 },
  { id: "dance", name: "춤", icon: "💃", anim: "dance", line: "룰루랄라~", dur: 2.6 },
  { id: "laugh", name: "웃기", icon: "😂", anim: "laugh", line: "푸하하!", dur: 1.6 },
  { id: "taunt", name: "약 올리기", icon: "😜", anim: "taunt", line: "나 여기 있지롱~", dur: 2.0 },
];

// ---------------------------------------------------------------------------
// 술래 무기 — 시간이 지날수록 좋아지고, 다음 단계가 되면 이전 무기는 다시 못 꺼낸다

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  /** "melee" = 손·도구로 앞을 잡는다, "ray" = 총알 */
  kind: "melee" | "ray";
  /** 사거리 (m) */
  range: number;
  /** 근접: 앞쪽 부채꼴 반각(라디안) */
  cone?: number;
  /** 연사 간격 (ms) */
  cooldownMs: number;
  /** 이 단계에서 받는 총알 (근접은 무한) */
  ammo: number;
  /** 엉뚱한 걸 치면 깎이는 내 체력 */
  penalty: number;
  /** 산탄 갈래 수 */
  pellets?: number;
  /** 확대 조준 */
  zoom?: boolean;
}

export const WEAPONS: Record<string, WeaponDef> = {
  hand: { id: "hand", name: "맨손", icon: "🖐️", kind: "melee", range: 1.5, cone: 0.7, cooldownMs: 700, ammo: 0, penalty: 4 },
  hammer: { id: "hammer", name: "뿅망치", icon: "🔨", kind: "melee", range: 2.5, cone: 0.85, cooldownMs: 650, ammo: 0, penalty: 6 },
  sling: { id: "sling", name: "새총", icon: "🪃", kind: "ray", range: 16, cooldownMs: 800, ammo: 12, penalty: 6 },
  pistol: { id: "pistol", name: "권총", icon: "🔫", kind: "ray", range: 32, cooldownMs: 450, ammo: 12, penalty: 8 },
  shotgun: { id: "shotgun", name: "산탄총", icon: "💥", kind: "ray", range: 11, cooldownMs: 1100, ammo: 6, penalty: 10, pellets: 5 },
  sniper: { id: "sniper", name: "저격총", icon: "🎯", kind: "ray", range: 90, cooldownMs: 1700, ammo: 4, penalty: 20, zoom: true },
};

/** 숨는 시간(분)에 따라 단계 수가 늘어난다 — 길게 할수록 더 잘게 나뉜다 */
export function weaponSchedule(huntSec: number): string[] {
  if (huntSec <= 200) return ["hand", "hammer", "pistol", "sniper"];
  if (huntSec <= 330) return ["hand", "hammer", "sling", "pistol", "sniper"];
  return ["hand", "hammer", "sling", "pistol", "shotgun", "sniper"];
}

/** 지금 단계 (0부터) */
export function weaponTier(huntSec: number, elapsedSec: number): number {
  const n = weaponSchedule(huntSec).length;
  return Math.max(0, Math.min(n - 1, Math.floor((elapsedSec / huntSec) * n)));
}

/** 다음 단계까지 남은 초 (마지막이면 null) */
export function secsToNextTier(huntSec: number, elapsedSec: number): number | null {
  const n = weaponSchedule(huntSec).length;
  const t = weaponTier(huntSec, elapsedSec);
  if (t >= n - 1) return null;
  return ((t + 1) * huntSec) / n - elapsedSec;
}

/** 술래 체력 — 11-05 사용자 요청으로 100 → 150 (헛손질 몇 번에 너무 빨리 탈락) */
export const SEEKER_HP = 150;
export const SEEKER_SPEED = 2.2;
export const DECOY_CHARGES = 2;
export const REROLLS = 1;
/**
 * 헛손질 연속 가중 — 최근 SPAM_WINDOW_MS 안에 헛친 횟수 n이면 벌점 × (1 + SPAM_STEP·n).
 * 셀프플레이에서 "근처를 다 두드려 보기"가 지배 전략이 돼서 넣었다(가끔 하는 실수는 그대로).
 */
export const SPAM_WINDOW_MS = 20_000;
export const SPAM_STEP = 0.5;
/** 숨은 사람을 잡으면 술래 체력 회복 (최대 SEEKER_HP) */
export const CATCH_HEAL = 25;

/** 판 옵션 */
export interface GameOptions {
  /** 술래 시간(초) */
  huntSec: 180 | 300 | 420;
  /** 라운드 수 */
  rounds: number;
  /** 꼼꼼이(찜 장소) 모드 */
  goalMode: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { huntSec: 300, rounds: 3, goalMode: false };

export const PICK_SEC = 15;
export const HIDE_SEC = 30;
export const ROUND_END_SEC = 7;
/** 꼼꼼이: 술래 시간의 이 비율이 지나면 찜 장소가 열린다 */
export const GOAL_OPEN_AT = 0.5;
export const GOAL_RADIUS = 1.3;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** 인원별 술래 수 */
export function seekerCount(n: number): number {
  return n >= 6 ? 2 : 1;
}
