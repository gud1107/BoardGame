/**
 * 변신 숨바꼭질 — 술래 증강 (롤 증강처럼 3장 중 1장).
 *
 * 술래는 눈을 가린 동안(변신 고르기 + 숨는 시간) 증강을 **두 번** 고른다.
 * - 1번째: 변신 고르기 단계 — 숨는 사람도 무엇을 골랐는지 볼 수 있어 변신을 맞춰 고를 수 있다.
 * - 2번째: 숨는 시간 — 등급이 높게 나오기 쉽다.
 * 한 번 뽑을 때 3장은 **같은 등급**(실버/골드/프리즘)이다. 라운드마다 다시 뽑기 1번.
 * 효과는 그 라운드에만 (술래가 매 라운드 바뀌므로).
 *
 * 숨는 사람도 고르기 단계에 1장(11-07 후속) — `side: "hider"`. 술래에겐 안 보인다.
 *
 * 숫자는 봇 셀프플레이(selfplay.balance.test.ts)로 맞췄다 — 증강 전에는 숨는 쪽이 유리했다.
 * 정보 증강은 **정확한 위치를 주지 않는다**(원 범위·개수·방향만). 충격파만 예외로 아주 잠깐 정확하다.
 */

export type AugTier = "silver" | "gold" | "prism";
export type AugKind = "stat" | "intel" | "active";

export interface AugDef {
  id: string;
  name: string;
  icon: string;
  tier: AugTier;
  kind: AugKind;
  desc: string;
  /** 언제 발동하나 (사냥 중 위쪽 증강 패널에 계속 보인다) */
  when: string;
  /** 꼼꼼이 모드 전용 / 일반 전용 */
  mode?: "kkom" | "normal";
  /** 누가 고르나 (기본 술래) */
  side?: "seeker" | "hider";
  /** 봇이 고르는 선호도 (높을수록 먼저) */
  bot: number;
}

export const AUGS: AugDef[] = [
  // ── 실버 ─────────────────────────────────────────────
  { id: "tough", name: "단단한 몸", icon: "🛡️", tier: "silver", kind: "stat", desc: "최대 체력 +40", when: "상시", bot: 6 },
  { id: "sprint", name: "가벼운 운동화", icon: "👟", tier: "silver", kind: "stat", desc: "이동 속도 +12%", when: "상시", bot: 5 },
  { id: "quick", name: "빠른 손", icon: "✋", tier: "silver", kind: "stat", desc: "공격 쿨타임 −20%", when: "상시", bot: 4 },
  { id: "mag", name: "큰 탄창", icon: "🧰", tier: "silver", kind: "stat", desc: "총 탄약 +50% (단계마다)", when: "총을 받을 때마다", bot: 3 },
  { id: "reach", name: "긴 팔", icon: "🦾", tier: "silver", kind: "stat", desc: "손·망치 사거리 +0.5m, 휘두르는 범위 넓게", when: "손·뿅망치로 칠 때", bot: 4 },
  { id: "calm", name: "침착함", icon: "🧘", tier: "silver", kind: "stat", desc: "헛손질 벌점 −25%", when: "헛손질할 때", bot: 6 },
  { id: "vamp", name: "사냥의 기쁨", icon: "🩸", tier: "silver", kind: "stat", desc: "잡을 때 회복 +25 (총 +50)", when: "잡을 때", bot: 4 },
  { id: "scout", name: "첫 정찰", icon: "🔭", tier: "silver", kind: "intel", desc: "사냥 시작 때 집 안·밖에 숨은 사람 수를 알려 줘요", when: "사냥 시작 때 1번", bot: 3 },
  { id: "chest", name: "보물 사냥꾼", icon: "🎁", tier: "silver", kind: "intel", desc: "보물 상자 탐지 반경 12m → 24m, 열면 체력 +20", when: "보물 상자를 열 때", bot: 3 },
  { id: "hasty", name: "급한 술래", icon: "⏩", tier: "silver", kind: "stat", desc: "숨는 시간 −5초 (숨는 사람에게도 보여요)", when: "숨는 시간에 적용됨", bot: 5 },

  // ── 골드 ─────────────────────────────────────────────
  { id: "steady", name: "평정심", icon: "🎯", tier: "gold", kind: "stat", desc: "연속 헛손질 벌점 가중이 없어져요", when: "헛손질할 때", bot: 6 },
  { id: "shield", name: "보호막", icon: "🔰", tier: "gold", kind: "stat", desc: "처음 헛손질 2번은 벌점 0", when: "처음 헛손질 2번", bot: 7 },
  { id: "npcpass", name: "동네 인싸", icon: "🙋", tier: "gold", kind: "stat", desc: "행인·점검원·동물·청소기를 잘못 치면 벌점 −60%", when: "NPC를 잘못 칠 때", bot: 6 },
  { id: "propeye", name: "물건 감정사", icon: "🔍", tier: "gold", kind: "stat", desc: "물건·분신을 잘못 치면 벌점 −60%", when: "물건·분신을 잘못 칠 때", bot: 6 },
  { id: "decoyx", name: "분신 감별", icon: "🪞", tier: "gold", kind: "intel", desc: "분신을 치면 펑! 벌점 절반 — 주인이 15m 안에 있는지 알려 줘요", when: "분신을 쳤을 때", bot: 5 },
  { id: "radar", name: "휴대 레이더", icon: "📡", tier: "gold", kind: "intel", desc: "35초마다 반경 15m 안 숨은 사람 수", when: "35초마다 자동", bot: 6 },
  { id: "ear", name: "예민한 귀", icon: "👂", tier: "gold", kind: "intel", desc: "10m 안에서 숨은 사람이 움직이면 4초마다 대략 그쪽(5m 원)에 소리 표시", when: "10m 안에서 움직이면 자동", bot: 7 },
  { id: "hunter", name: "추격 본능", icon: "🐺", tier: "gold", kind: "stat", desc: "잡은 뒤 12초 동안 이동 +30%, 헛손질 벌점 0", when: "잡은 직후 12초", bot: 5 },
  { id: "mark", name: "헛손질 단서", icon: "📍", tier: "gold", kind: "intel", desc: "헛치면 그 자리 8m 안에 숨은 사람이 몇 명인지 알려 줘요", when: "헛손질할 때", bot: 5 },
  { id: "trap", name: "방울 덫", icon: "🔔", tier: "gold", kind: "active", desc: "T: 발밑에 덫(3개). 숨은 사람이 밟으면 딸랑 — 그 근처 원 표시", when: "T 키 / 🔔 버튼으로 설치", bot: 6 },
  { id: "overtime", name: "연장전", icon: "⏱️", tier: "gold", kind: "stat", desc: "술래 시간 +40초 (술래 여럿이 골라도 한 번만)", when: "사냥 시작 때 적용", bot: 5 },
  { id: "camp", name: "전봇대 경보", icon: "🚨", tier: "gold", kind: "intel", desc: "숨은 사람이 기지 10m 안에 들어오면 경보", mode: "kkom", when: "기지 10m 안에 들어오면 자동", bot: 8 },

  // ── 프리즘 ───────────────────────────────────────────
  { id: "scent", name: "냄새 추적", icon: "🐾", tier: "prism", kind: "intel", desc: "40초마다 숨은 사람 한 명이 있는 9m 원을 지도에 표시", when: "40초마다 자동 (처음은 20초)", bot: 9 },
  { id: "dossier", name: "정보원", icon: "🗂️", tier: "prism", kind: "intel", desc: "사냥 시작 때 이번 판 숨은 사람들의 변신 목록 공개 (누가 어디인지는 몰라요)", when: "사냥 시작 때 1번", bot: 8 },
  { id: "lastone", name: "마지막 사냥", icon: "🎯", tier: "prism", kind: "intel", desc: "숨은 사람이 1명 남으면 15초마다 그 사람 근처 7m 원 표시", mode: "normal", when: "1명 남으면 15초마다", bot: 6 },
  { id: "giant", name: "거인", icon: "🗿", tier: "prism", kind: "stat", desc: "최대 체력 +90, 이동 속도 −6%", when: "상시", bot: 8 },
  { id: "resolve", name: "불굴", icon: "🔥", tier: "prism", kind: "stat", desc: "체력이 0이 되면 한 번 70으로 버텨요", when: "체력이 0이 될 때 1번", bot: 8 },
  { id: "shock", name: "충격파", icon: "💥", tier: "prism", kind: "active", desc: "Q: 반경 6m를 흔들어 숨은 사람 위치를 2.5초 드러내요 (라운드 2번)", when: "Q 키 / 💥 버튼 (2번)", bot: 9 },
  { id: "sixth", name: "육감", icon: "🌀", tier: "prism", kind: "stat", desc: "근처(2m)에 숨은 사람이 있으면 조준점이 떨려요 · 헛손질 벌점 −20%", when: "2m 안에 있으면 조준점", bot: 7 },

  // ── 숨는 쪽 (고르기 단계에 1장) ────────────────────────
  { id: "h_swift", side: "hider", name: "날쌘 발", icon: "💨", tier: "silver", kind: "stat", desc: "이동 속도 +12%", when: "상시", bot: 5 },
  { id: "h_decoy", side: "hider", name: "분신술", icon: "👯", tier: "silver", kind: "stat", desc: "분신 +1개 (라운드당 3개)", when: "바로 적용", bot: 6 },
  { id: "h_chest", side: "hider", name: "보물 도둑", icon: "💰", tier: "silver", kind: "stat", desc: "보물 상자를 열면 분신 +2 (보통 +1)", when: "보물 상자를 열 때", bot: 3 },
  { id: "h_survive", side: "hider", name: "버티기 장인", icon: "⏳", tier: "silver", kind: "stat", desc: "끝까지 숨으면 점수 +2 더", when: "라운드 끝에", bot: 4 },
  { id: "h_thorn", side: "hider", name: "가시 분신", icon: "🌵", tier: "silver", kind: "stat", desc: "술래가 내 분신을 치면 헛손질 벌점 ×1.5", when: "술래가 분신을 칠 때", bot: 4 },
  { id: "h_silent", side: "hider", name: "고양이 발걸음", icon: "🐈", tier: "gold", kind: "stat", desc: "술래의 👂 예민한 귀·🔔 방울 덫에 안 걸려요", when: "상시", bot: 5 },
  { id: "h_perfume", side: "hider", name: "향수", icon: "🌸", tier: "gold", kind: "stat", desc: "술래의 🐾 냄새·📡 레이더·📍 헛손질 단서·🎯 마지막 사냥에 안 잡혀요", when: "상시", bot: 5 },
  { id: "h_danger", side: "hider", name: "위험 감지", icon: "⚠️", tier: "gold", kind: "intel", desc: "술래가 10m 안에서 나를 보고 있으면 화면에 경고", when: "술래 시야에 들면 자동", bot: 4 },
  { id: "h_tracker", side: "hider", name: "술래 추적기", icon: "🛰️", tier: "gold", kind: "intel", desc: "25초마다 5초 동안 지도에 술래 위치 표시", when: "25초마다 자동", bot: 4 },
  { id: "h_home", side: "hider", name: "골목대장", icon: "🏃", tier: "gold", kind: "stat", desc: "술래 기지 12m 안에서 이동 +30% — 전봇대 찍기용", when: "기지 근처에서", mode: "kkom", bot: 6 },
  { id: "h_armor", side: "hider", name: "갑옷", icon: "🛡️", tier: "prism", kind: "stat", desc: "한 번 맞아도 안 잡혀요 — 대신 술래에게 근처라고 알려져요", when: "처음 맞을 때 1번", bot: 8 },
  { id: "h_remorph", side: "hider", name: "재변신", icon: "🎭", tier: "prism", kind: "active", desc: "숨는 중·사냥 중 한 번, 처음 받은 카드 중 다른 모양으로 바꿔요", when: "🎭 버튼 (1번)", bot: 2 },
];

export const AUG_BY_ID: Record<string, AugDef> = Object.fromEntries(AUGS.map((a) => [a.id, a]));
export const aug = (id: string | null | undefined): AugDef | undefined => (id ? AUG_BY_ID[id] : undefined);

export const AUG_TIER_STYLE: Record<AugTier, { name: string; color: string }> = {
  silver: { name: "실버", color: "#cbd5e1" },
  gold: { name: "골드", color: "#fcd34d" },
  prism: { name: "프리즘", color: "#e879f9" },
};

/** 몇 번째 뽑기(0, 1)에서 등급 확률 [실버, 골드, 프리즘] */
export const AUG_TIER_ODDS: [number, number, number][] = [
  [0.5, 0.4, 0.1],
  [0.15, 0.5, 0.35],
];
export const AUG_PICKS = 2;
/** 숨는 사람은 고르기 단계에 1장 */
export const HIDER_AUG_PICKS = 1;
export const HIDER_TIER_ODDS: [number, number, number] = [0.45, 0.4, 0.15];
export const AUG_REROLLS = 1;

// ── 수치 ─────────────────────────────────────────────
export const AUG_N = {
  toughHp: 40,
  giantHp: 90,
  sprint: 1.12,
  giantSpeed: 0.94,
  hunterSpeed: 1.3,
  hunterMs: 12_000,
  quickCd: 0.8,
  magMult: 1.5,
  reachM: 0.5,
  reachCone: 0.25,
  calm: 0.75,
  sixthPen: 0.8,
  sixthR: 2,
  npcpass: 0.4,
  propeye: 0.4,
  vampHeal: 25,
  chestR: 24,
  chestHeal: 20,
  hastyMs: 5000,
  shieldHits: 2,
  radarMs: 35_000,
  radarR: 15,
  earR: 10,
  earMs: 4000,
  earPingR: 5,
  decoyPen: 0.5,
  hSwift: 1.12,
  hHomeR: 12,
  hHome: 1.3,
  hSurvive: 2,
  hThorn: 1.5,
  hDangerR: 10,
  hTrackEvery: 25_000,
  hTrackShow: 5_000,
  markR: 8,
  decoyR: 15,
  trapCount: 3,
  trapR: 1.1,
  overtimeMs: 40_000,
  campR: 10,
  campMs: 6000,
  scentMs: 40_000,
  scentR: 9,
  lastMs: 15_000,
  lastR: 7,
  resolveHp: 70,
  shockCount: 2,
  shockR: 6,
  shockMs: 2500,
} as const;

export function hasAug(p: { augs?: readonly string[] } | null | undefined, id: string): boolean {
  return !!p?.augs?.includes(id);
}

/** 이동 속도 배수 (내 기기 예측 이동과 봇이 같은 식을 쓴다) — nearBase: 술래 기지 12m 안 (골목대장) */
export function augSpeedMult(augs: readonly string[] | undefined, hunterActive = false, nearBase = false): number {
  if (!augs) return 1;
  let m = 1;
  if (augs.includes("h_swift")) m *= AUG_N.hSwift;
  if (nearBase && augs.includes("h_home")) m *= AUG_N.hHome;
  if (augs.includes("sprint")) m *= AUG_N.sprint;
  if (augs.includes("giant")) m *= AUG_N.giantSpeed;
  if (hunterActive && augs.includes("hunter")) m *= AUG_N.hunterSpeed;
  return m;
}

export function augCooldownMult(augs: readonly string[] | undefined): number {
  return augs?.includes("quick") ? AUG_N.quickCd : 1;
}

export function augMaxHp(base: number, augs: readonly string[]): number {
  return base + (augs.includes("tough") ? AUG_N.toughHp : 0) + (augs.includes("giant") ? AUG_N.giantHp : 0);
}

export function augAmmo(base: number, augs: readonly string[] | undefined): number {
  return augs?.includes("mag") && base > 0 ? Math.ceil(base * AUG_N.magMult) : base;
}

/** 이번 판에 나올 수 있는 증강 */
export function augPool(goalMode: boolean, owned: readonly string[], side: "seeker" | "hider" = "seeker"): AugDef[] {
  return AUGS.filter((a) => (a.side ?? "seeker") === side && !owned.includes(a.id) && (!a.mode || (a.mode === "kkom") === goalMode));
}

/** 3장 뽑기: 같은 등급에서 겹치지 않게 (그 등급이 모자라면 다른 등급에서 채운다) */
export function rollAugOffer(rng: () => number, pick: number, goalMode: boolean, owned: readonly string[], exclude: readonly string[] = [], side: "seeker" | "hider" = "seeker"): string[] {
  const odds = side === "hider" ? HIDER_TIER_ODDS : AUG_TIER_ODDS[Math.min(pick, AUG_TIER_ODDS.length - 1)];
  const r = rng();
  const tier: AugTier = r < odds[0] ? "silver" : r < odds[0] + odds[1] ? "gold" : "prism";
  const pool = augPool(goalMode, owned, side);
  const fresh = pool.filter((a) => !exclude.includes(a.id));
  const base = fresh.length >= 3 ? fresh : pool;
  const same = base.filter((a) => a.tier === tier);
  const rest = base.filter((a) => a.tier !== tier);
  const shuffle = (arr: AugDef[]) => arr.map((a) => ({ a, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.a);
  return [...shuffle(same), ...shuffle(rest)].slice(0, 3).map((a) => a.id);
}
