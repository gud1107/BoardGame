import { seededRng } from "@/lib/rng";

/**
 * 죽은척 대작전 🧬 증강 — 정해진 라운드 시작 전에 모두 3장 중 1장을 고른다(롤 칼바람식).
 *
 * - 같은 라운드엔 모두 같은 등급(공정), 카드 3장은 자리마다 따로 뽑는다(이미 가진 것 제외).
 * - 다시 뽑기는 한 판에 1번.
 * - 고른 증강은 **전원이 다 고른 뒤 공개**된다. 증강은 공개 정보라서 "살아 있을 확률" 계산에도
 *   그대로 들어간다(방탄 효과는 공개 피해 범위 자체를 줄여서 기록한다).
 * - 진짜 죽은 사람도 똑같이 고른다 — 고르는 타이밍·여부로 정체가 새지 않게.
 *
 * 수치는 전부 여기 `AUG_N`에서만 고친다. 측정 방법·결과는 룰북 §증강.
 */

export type AugTier = 1 | 2 | 3;
export type AugId =
  // 실버
  | "bandolier"
  | "supply"
  | "helmet"
  | "camo"
  | "pickpocket"
  | "coroner"
  | "tripwire"
  | "ambusher"
  | "riposte"
  // 골드
  | "vest"
  | "sniper"
  | "apRounds"
  | "quickdraw"
  | "coverPro"
  | "adrenaline"
  | "stethoscope"
  | "scavenger"
  // 프리즘
  | "heavy"
  | "ammoCrate"
  | "plate"
  | "counterSniper"
  | "understudy"
  | "frag";

export interface AugDef {
  id: AugId;
  tier: AugTier;
  icon: string;
  name: string;
  desc: string;
}

/** 증강 수치 — 밸런스는 여기만 */
export const AUG_N = {
  bandolierMax: 7,
  supplyNow: 2,
  helmetHits: 1,
  /** 방탄모·조끼: 최대 피해가 이 이상인 타격에만 쓰인다 */
  shieldFrom: 3,
  bandolierNow: 0,
  vestHits: 2,
  camoLie: 1,
  camoRiseAmmo: 1,
  pickpocketTake: 2,
  tripwireDmg: [1, 2] as const,
  ambusherDmg: 1,
  ripostePlus: 2,
  coverProStreak: 2,
  coverProDrain: 2,
  adrenalineAmmo: 3,
  scavengerAmmo: 1,
  heavyGrenadeCost: 2,
  ammoCrateReload: 2,
  /** 탄약 상자: 장전 전 탄약이 이 이하일 때만 +2 */
  ammoCrateBelow: 1,
  counterSniperDmg: [1, 2] as const,
  understudyLie: 2,
  understudyDmg: 1,
  understudyAmmo: 1,
  fragDmg: 1,
} as const;

export const AUGMENTS: AugDef[] = [
  { id: "bandolier", tier: 1, icon: "🎽", name: "탄띠", desc: `최대 탄약 ${AUG_N.bandolierMax}발` },
  { id: "supply", tier: 1, icon: "📦", name: "보급 상자", desc: `바로 탄약 +${AUG_N.supplyNow}` },
  { id: "helmet", tier: 1, icon: "⛑️", name: "방탄모", desc: `다음에 맞는 타격 ${AUG_N.helmetHits}번: 최대 피해가 ${AUG_N.shieldFrom} 이상이면 −1` },
  { id: "camo", tier: 1, icon: "🌿", name: "위장복", desc: `누워 버티기 +${AUG_N.camoLie}라운드, 누운 내 몸은 탄약을 못 뺏고 확인사살 피해 −1, 일어날 때 탄약 +${AUG_N.camoRiseAmmo}` },
  { id: "pickpocket", tier: 1, icon: "🤏", name: "손버릇", desc: `탄약 뺏기로 ${AUG_N.pickpocketTake}발 더 챙겨요` },
  { id: "coroner", tier: 1, icon: "🔍", name: "검시 도구", desc: "확인사살에 탄약이 안 들어요" },
  { id: "tripwire", tier: 1, icon: "🪤", name: "부비트랩", desc: `누운 내 몸을 털거나 확인사살하면 그 사람이 ${AUG_N.tripwireDmg[0]}~${AUG_N.tripwireDmg[1]} 피해 (진짜 시체여도 터져요)` },
  { id: "ambusher", tier: 1, icon: "🐍", name: "매복", desc: `벌떡 기습 피해 +${AUG_N.ambusherDmg}, 엄폐한 상대에게도 1이 들어가요` },
  { id: "riposte", tier: 1, icon: "🛡️", name: "엄폐 보급", desc: `엄폐로 막아 내면 탄약 +${AUG_N.ripostePlus}, 다음 라운드에도 엄폐할 수 있어요` },

  { id: "vest", tier: 2, icon: "🦺", name: "방탄조끼", desc: `다음에 맞는 타격 ${AUG_N.vestHits}번: 최대 피해가 ${AUG_N.shieldFrom} 이상이면 −1` },
  { id: "sniper", tier: 2, icon: "🎯", name: "저격 조준경", desc: "사격 피해 1 → 1~2" },
  { id: "apRounds", tier: 2, icon: "🔩", name: "철갑탄", desc: "연사도 엄폐를 뚫고 1 피해" },
  { id: "quickdraw", tier: 2, icon: "🤠", name: "속사", desc: "같은 화력끼리 맞사격하면 내가 이겨요" },
  { id: "coverPro", tier: 2, icon: "🧱", name: "엄폐 숙련", desc: `엄폐를 ${AUG_N.coverProStreak}라운드 연속 쓸 수 있고, 막아 내면 쏜 사람 탄약 −${AUG_N.coverProDrain}` },
  { id: "adrenaline", tier: 2, icon: "💉", name: "아드레날린", desc: `쓰러졌다 일어날 때(일어나기·기습) 탄약 +${AUG_N.adrenalineAmmo}` },
  { id: "stethoscope", tier: 2, icon: "🩺", name: "청진기", desc: "매 라운드 끝에 쓰러진 상대 1명의 진짜 생사를 몰래 알아요" },
  { id: "scavenger", tier: 2, icon: "🦴", name: "전리품", desc: `연사·수류탄이 들어갈 때마다 탄약 +${AUG_N.scavengerAmmo}` },

  { id: "heavy", tier: 3, icon: "🧨", name: "중화기", desc: `수류탄이 탄약 ${AUG_N.heavyGrenadeCost}발` },
  { id: "ammoCrate", tier: 3, icon: "🗃️", name: "탄약 상자", desc: `탄약 ${AUG_N.ammoCrateBelow}발 이하에서 장전하면 +${AUG_N.ammoCrateReload}발` },
  { id: "plate", tier: 3, icon: "🛡", name: "강화 방탄판", desc: "받는 타격의 최대 피해 −1 (예: 수류탄 2~3 → 2)" },
  { id: "counterSniper", tier: 3, icon: "🔭", name: "카운터 저격", desc: `엄폐로 막아 내면 쏜 사람에게 ${AUG_N.counterSniperDmg[0]}~${AUG_N.counterSniperDmg[1]} 피해` },
  { id: "understudy", tier: 3, icon: "🎭", name: "명배우", desc: `누워 버티기 +${AUG_N.understudyLie}라운드, 기습 피해 +${AUG_N.understudyDmg}, 누워 있는 라운드마다 탄약 +${AUG_N.understudyAmmo} (진짜 시체여도 — 티 안 나요)` },
  { id: "frag", tier: 3, icon: "💢", name: "파편 수류탄", desc: `수류탄이 들어가면 엄폐 안 한 다른 서 있는 상대 모두 ${AUG_N.fragDmg} 피해` },
];

export const AUG_BY_ID: Record<AugId, AugDef> = Object.fromEntries(AUGMENTS.map((a) => [a.id, a])) as Record<AugId, AugDef>;
export const AUG_TIER_NAME: Record<AugTier, string> = { 1: "실버", 2: "골드", 3: "프리즘" };

/**
 * 증강 고르기 라운드 — 이 라운드의 행동을 고르기 전에 연다.
 * 증강 켠 셀프플레이(레벨 7 봇) 판 길이 중앙값이 2인 8·3인 10·4인 12·5인 14·6인 16라운드라
 * 2인전도 세 번째(7라운드, 총공세 직전)까지 대부분 간다.
 */
export const AUG_ROUNDS = [1, 4, 7] as const;
/** 회차별 등급 확률 [실버, 골드, 프리즘] */
export const AUG_TIER_ODDS: readonly (readonly [number, number, number])[] = [
  [0.6, 0.35, 0.05],
  [0.3, 0.5, 0.2],
  [0.15, 0.45, 0.4],
];
export const AUG_REROLLS = 1;
export const AUG_OFFER = 3;

export function augIndexOf(round: number): number {
  return (AUG_ROUNDS as readonly number[]).indexOf(round);
}

/** 이번 회차 등급 — 시드+라운드로 모두 같은 값 */
export function rollAugTier(seed: number, round: number): AugTier {
  const idx = Math.max(0, augIndexOf(round));
  const odds = AUG_TIER_ODDS[Math.min(idx, AUG_TIER_ODDS.length - 1)];
  const r = seededRng((seed ^ Math.imul(round + 101, 0x9e3779b1)) >>> 0)();
  return r < odds[0] ? 1 : r < odds[0] + odds[1] ? 2 : 3;
}

/** 자리별 카드 3장 — 시드·라운드·자리·다시 뽑기 횟수로 결정(모든 기기가 같은 카드) */
export function rollAugOffer(seed: number, round: number, seat: number, tier: AugTier, owned: readonly AugId[], reroll: number, avoid: readonly AugId[] = []): AugId[] {
  const rng = seededRng((seed ^ Math.imul(round * 7 + seat * 131 + reroll * 977 + 13, 0x85ebca6b)) >>> 0);
  let pool = AUGMENTS.filter((a) => a.tier === tier && !owned.includes(a.id) && !avoid.includes(a.id)).map((a) => a.id);
  // 다시 뽑기로 같은 카드만 나오지 않게 — 모자라면 피할 목록을 무시
  if (pool.length < AUG_OFFER) pool = AUGMENTS.filter((a) => a.tier === tier && !owned.includes(a.id)).map((a) => a.id);
  const out: AugId[] = [];
  while (out.length < AUG_OFFER && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
