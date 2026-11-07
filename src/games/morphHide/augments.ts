/**
 * 변신 숨바꼭질 — 술래 증강 (롤 증강처럼 3장 중 1장).
 *
 * 술래는 눈을 가린 동안(변신 고르기 + 숨는 시간) 증강을 **두 번** 고른다.
 * - 1번째: 변신 고르기 단계 — 숨는 사람도 무엇을 골랐는지 볼 수 있어 변신을 맞춰 고를 수 있다.
 * - 2번째: 숨는 시간 — 등급이 높게 나오기 쉽다.
 * 한 번 뽑을 때 3장은 **같은 등급**(실버/골드/프리즘)이다. 라운드마다 다시 뽑기 1번.
 * 효과는 그 라운드에만 (술래가 매 라운드 바뀌므로).
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
  /** 꼼꼼이 모드 전용 / 일반 전용 */
  mode?: "kkom" | "normal";
  /** 봇이 고르는 선호도 (높을수록 먼저) */
  bot: number;
}

export const AUGS: AugDef[] = [
  // ── 실버 ─────────────────────────────────────────────
  { id: "tough", name: "단단한 몸", icon: "🛡️", tier: "silver", kind: "stat", desc: "최대 체력 +40", bot: 6 },
  { id: "sprint", name: "가벼운 운동화", icon: "👟", tier: "silver", kind: "stat", desc: "이동 속도 +12%", bot: 5 },
  { id: "quick", name: "빠른 손", icon: "✋", tier: "silver", kind: "stat", desc: "공격 쿨타임 −20%", bot: 4 },
  { id: "mag", name: "큰 탄창", icon: "🧰", tier: "silver", kind: "stat", desc: "총 탄약 +50% (단계마다)", bot: 3 },
  { id: "reach", name: "긴 팔", icon: "🦾", tier: "silver", kind: "stat", desc: "손·망치 사거리 +0.5m, 휘두르는 범위 넓게", bot: 4 },
  { id: "calm", name: "침착함", icon: "🧘", tier: "silver", kind: "stat", desc: "헛손질 벌점 −25%", bot: 6 },
  { id: "vamp", name: "사냥의 기쁨", icon: "🩸", tier: "silver", kind: "stat", desc: "잡을 때 회복 +25 (총 +50)", bot: 4 },
  { id: "scout", name: "첫 정찰", icon: "🔭", tier: "silver", kind: "intel", desc: "사냥 시작 때 집 안·밖에 숨은 사람 수를 알려 줘요", bot: 3 },
  { id: "chest", name: "보물 사냥꾼", icon: "🎁", tier: "silver", kind: "intel", desc: "보물 상자 탐지 반경 12m → 24m, 열면 체력 +20", bot: 3 },
  { id: "hasty", name: "급한 술래", icon: "⏩", tier: "silver", kind: "stat", desc: "숨는 시간 −5초 (숨는 사람에게도 보여요)", bot: 5 },

  // ── 골드 ─────────────────────────────────────────────
  { id: "steady", name: "평정심", icon: "🎯", tier: "gold", kind: "stat", desc: "연속 헛손질 벌점 가중이 없어져요", bot: 6 },
  { id: "shield", name: "보호막", icon: "🔰", tier: "gold", kind: "stat", desc: "처음 헛손질 2번은 벌점 0", bot: 7 },
  { id: "npcpass", name: "동네 인싸", icon: "🙋", tier: "gold", kind: "stat", desc: "행인·점검원·동물·청소기를 잘못 치면 벌점 −60%", bot: 6 },
  { id: "propeye", name: "물건 감정사", icon: "🔍", tier: "gold", kind: "stat", desc: "물건·분신을 잘못 치면 벌점 −60%", bot: 6 },
  { id: "decoyx", name: "분신 감별", icon: "🪞", tier: "gold", kind: "intel", desc: "분신을 치면 벌점 없이 펑! — 주인이 15m 안에 있는지 알려 줘요", bot: 5 },
  { id: "radar", name: "휴대 레이더", icon: "📡", tier: "gold", kind: "intel", desc: "35초마다 반경 15m 안 숨은 사람 수", bot: 6 },
  { id: "ear", name: "예민한 귀", icon: "👂", tier: "gold", kind: "intel", desc: "12m 안에서 숨은 사람이 움직이면 대략 그쪽에 소리 표시", bot: 7 },
  { id: "hunter", name: "추격 본능", icon: "🐺", tier: "gold", kind: "stat", desc: "잡은 뒤 12초 동안 이동 +30%, 헛손질 벌점 0", bot: 5 },
  { id: "mark", name: "헛손질 단서", icon: "📍", tier: "gold", kind: "intel", desc: "헛치면 그 자리 8m 안에 숨은 사람이 몇 명인지 알려 줘요", bot: 5 },
  { id: "trap", name: "방울 덫", icon: "🔔", tier: "gold", kind: "active", desc: "T: 발밑에 덫(3개). 숨은 사람이 밟으면 딸랑 — 그 근처 원 표시", bot: 6 },
  { id: "overtime", name: "연장전", icon: "⏱️", tier: "gold", kind: "stat", desc: "술래 시간 +40초 (술래 여럿이 골라도 한 번만)", bot: 5 },
  { id: "camp", name: "전봇대 경보", icon: "🚨", tier: "gold", kind: "intel", desc: "숨은 사람이 기지 10m 안에 들어오면 경보", mode: "kkom", bot: 8 },

  // ── 프리즘 ───────────────────────────────────────────
  { id: "scent", name: "냄새 추적", icon: "🐾", tier: "prism", kind: "intel", desc: "40초마다 숨은 사람 한 명이 있는 9m 원을 지도에 표시", bot: 9 },
  { id: "dossier", name: "정보원", icon: "🗂️", tier: "prism", kind: "intel", desc: "사냥 시작 때 이번 판 숨은 사람들의 변신 목록 공개 (누가 어디인지는 몰라요)", bot: 8 },
  { id: "lastone", name: "마지막 사냥", icon: "🎯", tier: "prism", kind: "intel", desc: "숨은 사람이 1명 남으면 15초마다 그 사람 근처 7m 원 표시", mode: "normal", bot: 6 },
  { id: "giant", name: "거인", icon: "🗿", tier: "prism", kind: "stat", desc: "최대 체력 +90, 이동 속도 −6%", bot: 8 },
  { id: "resolve", name: "불굴", icon: "🔥", tier: "prism", kind: "stat", desc: "체력이 0이 되면 한 번 70으로 버텨요", bot: 8 },
  { id: "shock", name: "충격파", icon: "💥", tier: "prism", kind: "active", desc: "Q: 반경 6m를 흔들어 숨은 사람 위치를 2.5초 드러내요 (라운드 2번)", bot: 9 },
  { id: "sixth", name: "육감", icon: "🌀", tier: "prism", kind: "stat", desc: "근처(2m)에 숨은 사람이 있으면 조준점이 떨려요 · 헛손질 벌점 −20%", bot: 7 },
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
  earR: 12,
  earMs: 2500,
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

/** 술래 이동 속도 배수 (내 기기 예측 이동과 봇이 같은 식을 쓴다) */
export function augSpeedMult(augs: readonly string[] | undefined, hunterActive = false): number {
  if (!augs) return 1;
  let m = 1;
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
export function augPool(goalMode: boolean, owned: readonly string[]): AugDef[] {
  return AUGS.filter((a) => !owned.includes(a.id) && (!a.mode || (a.mode === "kkom") === goalMode));
}

/** 3장 뽑기: 같은 등급에서 겹치지 않게 (그 등급이 모자라면 다른 등급에서 채운다) */
export function rollAugOffer(rng: () => number, pick: number, goalMode: boolean, owned: readonly string[], exclude: readonly string[] = []): string[] {
  const odds = AUG_TIER_ODDS[Math.min(pick, AUG_TIER_ODDS.length - 1)];
  const r = rng();
  const tier: AugTier = r < odds[0] ? "silver" : r < odds[0] + odds[1] ? "gold" : "prism";
  const pool = augPool(goalMode, owned);
  const fresh = pool.filter((a) => !exclude.includes(a.id));
  const base = fresh.length >= 3 ? fresh : pool;
  const same = base.filter((a) => a.tier === tier);
  const rest = base.filter((a) => a.tier !== tier);
  const shuffle = (arr: AugDef[]) => arr.map((a) => ({ a, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.a);
  return [...shuffle(same), ...shuffle(rest)].slice(0, 3).map((a) => a.id);
}
