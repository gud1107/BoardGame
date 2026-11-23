import { seededRng } from "@/lib/rng";
import type { GameMode } from "./data";

/**
 * 만지면 내 꺼! 🧬 증강 — 경기 시작 전 · 1/3 · 2/3 지점에서 판이 잠깐 멈추고, 모두 3장 중 1장을 고른다(롤 아레나식).
 *
 * - 같은 회차엔 모두 같은 등급(공정), 카드 3장은 자리마다 따로(이미 가진 것 · 이번 모드에 쓸모없는 것 제외).
 * - 다시 뽑기는 한 판에 1번. 시간이 지나면 첫 번째 카드.
 * - 고른 증강은 공개 정보(점수판·이름표 칩) — 실시간 게임이라 상대가 뭘 가졌는지 보고 피해야 재미있다.
 * - 카드는 시드·회차·자리·다시 뽑기 횟수로만 정해져서 방장이 바뀌어도 같은 카드가 나온다.
 *
 * 수치는 전부 여기 `AUG_N`에서만 고친다. 측정 방법·결과는 룰북 §15.
 */

export type AugTier = 1 | 2 | 3;
export type AugId =
  // 실버
  | "sneakers"
  | "quickDash"
  | "bigBag"
  | "tightGrip"
  | "tape"
  | "quickHands"
  | "scissors"
  | "fastDeposit"
  | "sockLover"
  | "sticky"
  | "pickupBoost"
  | "steady"
  // 골드
  | "strongBack"
  | "magnetHand"
  | "ram"
  | "dashSnatch"
  | "setMaster"
  | "regular"
  | "counter"
  | "giftWrap"
  | "longArm"
  | "bombPro"
  | "teamPlayer"
  // 프리즘
  | "lockBasket"
  | "bigLoot"
  | "piggyBank"
  | "trophyHunter"
  | "clutch"
  | "vacuum"
  | "turbo";

export interface AugDef {
  id: AugId;
  tier: AugTier;
  icon: string;
  name: string;
  desc: string;
  /** 이 모드에서만 나온다 */
  mode?: GameMode;
  /** 이 모드에선 안 나온다 */
  notMode?: GameMode;
  /** 📢 점장 방송이 켜져 있어야 나온다 */
  events?: true;
}

/** 증강 수치 — 밸런스는 여기만 */
export const AUG_N = {
  sneakersSpeed: 0.07,
  quickDashCdMs: 2800,
  bigBagPlus: 3,
  tightGripPlus: 1,
  /** 꽉 쥐기: 줄이 이 개수 이하일 때만 (긴 줄은 손이 모자란다) */
  tightGripMaxChain: 6,
  tapePickShieldMs: 2500,
  tapeSnatchShieldMs: 3600,
  quickHandsCdMs: 3200,
  scissorsCdMs: 4500,
  scissorsBoostMs: 3000,
  fastDepositMs: 110,
  sockLoverBonus: 1,
  stickyStaggerMs: 700,
  pickupBoostMs: 900,
  /** 미끄럼 방지: 받는 비틀거림 배수 */
  steadyStagger: 0.55,
  /** 장사: 무게 감속 배수 */
  strongBackWeight: 0.4,
  magnetPickReach: 0.45,
  ramDropN: 2,
  ramStagger: 1.6,
  setMasterMult: 2,
  /** 단골 손님: 타임세일 종류를 넣으면 값 × (1 + 이 값) — 기본 타임세일은 ×2 */
  regularSaleMult: 2,
  giftWrapMax: 2,
  giftWrapBonus: 2,
  longArmReach: 0.4,
  bombProShieldMs: 300,
  teamPassReach: 1.2,
  teamPassCdMs: 500,
  teamPassBoostMs: 1500,
  bigLootReach: 1.2,
  bigLootN: 2,
  /** 저금통: 이 간격마다 바구니 값 piggyPer점당 +1 (최대 piggyMax) */
  piggyEveryMs: 12_000,
  piggyPer: 10,
  piggyMax: 2,
  trophyHunterWeight: 4,
  trophyHunterBonus: 5,
  clutchBonus: 1,
  clutchSpeed: 0.1,
  /** 자물쇠 바구니: 털린 뒤 다시 못 터는 시간 (원래 5초) */
  lockLootCdMs: 15_000,
  vacuumReach: 1.6,
  vacuumN: 2,
  vacuumShieldMs: 2500,
  turboSpeed: 0.14,
  turboDashCdMs: 2600,
} as const;

const N = AUG_N;
const sec = (ms: number) => `${Math.round(ms / 100) / 10}초`;
const pct = (f: number) => `${Math.round(f * 100)}%`;

export const AUGMENTS: AugDef[] = [
  { id: "sneakers", tier: 1, icon: "👟", name: "새 운동화", desc: `이동 속도 +${pct(N.sneakersSpeed)}` },
  { id: "quickDash", tier: 1, icon: "💨", name: "가벼운 발", desc: `💨 돌진 대기 4초 → ${sec(N.quickDashCdMs)}` },
  { id: "bigBag", tier: 1, icon: "🎒", name: "큰 가방", desc: `줄에 매달 수 있는 물건 12 → ${12 + N.bigBagPlus}개` },
  { id: "tightGrip", tier: 2, icon: "✊", name: "꽉 쥐기", desc: `줄이 ${N.tightGripMaxChain}개 이하일 때 앞 ${1 + N.tightGripPlus}개까지 못 뺏어요 (원래 1개)` },
  { id: "tape", tier: 1, icon: "📦", name: "포장 테이프", desc: `🛡 갓 찜 보호: 주운 물건 ${sec(N.tapePickShieldMs)} · 가로챈 물건 ${sec(N.tapeSnatchShieldMs)}` },
  { id: "quickHands", tier: 1, icon: "🤲", name: "날쌘 손", desc: `가로챈 뒤 다시 가로채기 대기 5초 → ${sec(N.quickHandsCdMs)}` },
  { id: "scissors", tier: 1, icon: "✂️", name: "가위 달인", desc: `✂️ 줄 끊기 대기 8초 → ${sec(N.scissorsCdMs)}, 끊은 뒤 빠른 시간 ${sec(N.scissorsBoostMs)}` },
  { id: "fastDeposit", tier: 1, icon: "🧺", name: "빠른 정리", desc: `바구니에 넣는 속도 2배 이상 (하나에 ${N.fastDepositMs / 1000}초)` },
  { id: "sockLover", tier: 1, icon: "🧦", name: "양말 수집가", desc: `🧦 양말 인형을 넣을 때마다 +${N.sockLoverBonus}점 더` },
  { id: "sticky", tier: 1, icon: "🍯", name: "끈끈이 줄", desc: `내 줄을 가로챈 사람은 ${sec(N.stickyStaggerMs)} 비틀거려요` },
  { id: "pickupBoost", tier: 1, icon: "🛼", name: "줍줍 가속", desc: `바닥에서 물건을 주울 때마다 ${sec(N.pickupBoostMs)} 빠르게` },
  { id: "steady", tier: 1, icon: "🧽", name: "미끄럼 방지", desc: `🧽 물청소에 안 미끄러지고, 부딪혀 비틀거리는 시간 −${pct(1 - N.steadyStagger)}` },

  { id: "strongBack", tier: 2, icon: "💪", name: "장사", desc: `🐢 무게 때문에 느려지는 양 −${pct(1 - N.strongBackWeight)}` },
  { id: "magnetHand", tier: 2, icon: "🧲", name: "자석 손", desc: `바닥 물건을 ${N.magnetPickReach}m 더 멀리서 주워요` },
  { id: "ram", tier: 2, icon: "🐂", name: "들이받기", desc: `💨 돌진으로 박으면 상대 줄 끝 ${N.ramDropN}개가 바닥에 떨어지고 더 오래 비틀거려요` },
  { id: "dashSnatch", tier: 2, icon: "🥷", name: "소매치기 돌진", desc: "💨 돌진하는 중에도 남의 줄을 가로챌 수 있어요" },
  { id: "setMaster", tier: 2, icon: "🎯", name: "세트 장인", desc: `세트 보너스 ×${N.setMasterMult} (같은 종류 3개 +4 · 🌈 무지개 +8)` },
  { id: "regular", tier: 2, icon: "🏷️", name: "단골 손님", desc: `🏷️ 타임세일 물건이 값 2배 → ${1 + N.regularSaleMult}배`, events: true },
  { id: "counter", tier: 2, icon: "🔁", name: "반격", desc: "가로채기 당하면 ✋ 되찜 금지도, 🤲 대기도 없이 바로 다시 가로챌 수 있어요" },
  { id: "giftWrap", tier: 2, icon: "🎁", name: "선물 포장가", desc: `🎁 선물 상자를 줄에 ${N.giftWrapMax}개까지, 넣을 때마다 +${N.giftWrapBonus}점 더` },
  { id: "longArm", tier: 2, icon: "🦒", name: "긴 팔", desc: `남의 줄을 ${N.longArmReach}m 더 멀리서 가로채요` },
  { id: "bombPro", tier: 2, icon: "💣", name: "폭탄 장인", desc: `받은 💣를 ${sec(N.bombProShieldMs)} 만에 떠넘길 수 있고, 내게서 터져도 바구니 물건은 안 날아가요`, mode: "bomb" },
  { id: "teamPlayer", tier: 2, icon: "🤝", name: "패스 장인", desc: `🤝 넘겨주기가 ${N.teamPassReach}m 더 멀리 · 대기 ${sec(N.teamPassCdMs)} · 넘기면 ${sec(N.teamPassBoostMs)} 빠르게`, mode: "team" },

  { id: "lockBasket", tier: 3, icon: "🔒", name: "자물쇠 바구니", desc: `🔥 마감 세일에 내 바구니가 털리면 ${sec(N.lockLootCdMs)} 동안 잠겨요 (원래 5초) · 💣 폭탄에도 안 날아가요`, notMode: "team" },
  { id: "bigLoot", tier: 3, icon: "🔥", name: "마감 털이범", desc: `🔥 마감 세일 털기가 ${N.bigLootReach}m 더 멀리서, 한 번에 ${N.bigLootN}개씩` },
  { id: "piggyBank", tier: 3, icon: "🐷", name: "저금통", desc: `${sec(N.piggyEveryMs)}마다 내 바구니 ${N.piggyPer}점당 +1 (한 번에 최대 +${N.piggyMax})` },
  { id: "trophyHunter", tier: 3, icon: "🏆", name: "트로피 사냥꾼", desc: `🏆 트로피 무게 20 → ${N.trophyHunterWeight}, 넣으면 +${N.trophyHunterBonus}점 더` },
  { id: "clutch", tier: 3, icon: "⏳", name: "막차 탑승", desc: `🔥 마감 세일 동안 속도 +${pct(N.clutchSpeed)}, 넣는 물건마다 +${N.clutchBonus}점` },
  { id: "vacuum", tier: 3, icon: "🌀", name: "진공 청소기", desc: `바닥 물건을 주우면 ${N.vacuumReach}m 안의 바닥 물건 ${N.vacuumN}개까지 같이 빨려오고, 주운 물건은 ${sec(N.vacuumShieldMs)} 동안 🛡 보호` },
  { id: "turbo", tier: 3, icon: "🚀", name: "터보 엔진", desc: `이동 속도 +${pct(N.turboSpeed)}, 💨 돌진 대기 ${sec(N.turboDashCdMs)}` },
];

export const AUG_BY_ID: Record<AugId, AugDef> = Object.fromEntries(AUGMENTS.map((a) => [a.id, a])) as Record<AugId, AugDef>;
export const AUG_TIER_NAME: Record<AugTier, string> = { 1: "실버", 2: "골드", 3: "프리즘" };

/** 회차: 경기 시간의 이 비율 지점에서 연다 (0 = 카운트다운 전). 마감 세일 5초 전까지로 당긴다. */
export const AUG_AT = [0, 1 / 3, 2 / 3] as const;
/** 회차별 등급 확률 [실버, 골드, 프리즘] */
export const AUG_TIER_ODDS: readonly (readonly [number, number, number])[] = [
  [0.6, 0.35, 0.05],
  [0.3, 0.5, 0.2],
  [0.15, 0.45, 0.4],
];
/** 고르는 시간 — 첫 회차는 룰 읽을 시간을 조금 더 */
export const AUG_PICK_MS = [15_000, 12_000, 12_000] as const;
/** 모두 고른 뒤 이만큼 쉬고 다시 시작 (고른 카드가 보이게) */
export const AUG_RESUME_MS = 900;
export const AUG_REROLLS = 1;
export const AUG_OFFER = 3;

export function augAllowed(a: AugDef, mode: GameMode, events: boolean): boolean {
  if (a.mode && a.mode !== mode) return false;
  if (a.notMode && a.notMode === mode) return false;
  if (a.events && !events) return false;
  return true;
}

/** 이번 회차 등급 — 시드+회차로 모두 같은 값 */
export function rollAugTier(seed: number, round: number): AugTier {
  const odds = AUG_TIER_ODDS[Math.min(round, AUG_TIER_ODDS.length - 1)];
  const r = seededRng((seed ^ Math.imul(round + 101, 0x9e3779b1)) >>> 0)();
  return r < odds[0] ? 1 : r < odds[0] + odds[1] ? 2 : 3;
}

/** 자리별 카드 3장 — 시드·회차·자리·다시 뽑기 횟수로 결정 */
export function rollAugOffer(
  seed: number,
  round: number,
  seat: number,
  tier: AugTier,
  owned: readonly AugId[],
  reroll: number,
  mode: GameMode,
  events: boolean,
  avoid: readonly AugId[] = [],
): AugId[] {
  const rng = seededRng((seed ^ Math.imul(round * 7 + seat * 131 + reroll * 977 + 13, 0x85ebca6b)) >>> 0);
  const base = AUGMENTS.filter((a) => a.tier === tier && !owned.includes(a.id) && augAllowed(a, mode, events));
  let pool = base.filter((a) => !avoid.includes(a.id)).map((a) => a.id);
  // 다시 뽑기로 같은 카드만 나오지 않게 — 모자라면 피할 목록을 무시
  if (pool.length < AUG_OFFER) pool = base.map((a) => a.id);
  const out: AugId[] = [];
  while (out.length < AUG_OFFER && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
