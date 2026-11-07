/**
 * 🧬 잠수 증강 — LoL 칼바람식 3장 고르기, 한 번의 잠수 안에서만 유지된다.
 *
 * 정해진 생존 시각(AUG_TIMES)에 엔진이 `w.augOffer`를 세우고 시뮬레이션을
 * 멈춘다(engine.ts `step`). 세 장은 같은 등급, 다시 뽑기는 잠수당 1번.
 * 등급 확률은 시간이 갈수록 올라간다 — 오래 버틴 잠수일수록 강한 증강.
 *
 * 수치(AUG_N)는 봇 셀프플레이로 맞췄다: 증강 하나를 처음부터 들고 잠수했을 때
 * 잠수당 코인이 실버 +5~25%, 골드 +10~35%, 프리즘 +20~55% 안에 들도록.
 * 수치를 바꾸면 룰북 md(배고픈상어.md §11) 표도 같이 고칠 것.
 */

import type { EffectiveStats } from "./data";

export type AugTier = "silver" | "gold" | "prism";
export type AugTag = "공격" | "생존" | "경제" | "기동" | "스킬";

export type AugmentId =
  // silver
  | "ironJaw" | "wideMaw" | "sleekFins" | "thickHide" | "slowMeta" | "magnetGills"
  | "bigBladder" | "goldScale" | "fastDigest" | "focus" | "scavenger" | "breachMuscle"
  // gold
  | "vampFang" | "thornSkin" | "antidote" | "blastProof" | "longRush" | "greed"
  | "treasureHunter" | "bloodScent" | "chargeBite" | "deepAdapt" | "chainFeed" | "secondWind"
  // prism
  | "phoenix" | "chainBreaker" | "goldHeart" | "frenzyLord" | "apexGrace" | "gambler" | "twinSkill" | "titan";

export interface AugmentDef {
  id: AugmentId;
  tier: AugTier;
  tag: AugTag;
  icon: string;
  name: string;
  desc: string;
  /** Only offered from this effective tier up (e.g. multi-bite prey first appears at T3). */
  minTier?: number;
}

/** Every tunable number in one place (engine reads these, the cards print them). */
export const AUG_N = {
  ironJaw: 1.3,
  wideMaw: 1.2,
  sleekFins: 1.1,
  thickHide: 1.25,
  slowMeta: 0.85,
  magnetGillsMul: 1.25,
  magnetGillsAdd: 10,
  bigBladderDur: 1.4,
  bigBladderRegen: 1.35,
  goldScale: 1.12,
  fastDigest: 1.3,
  focus: 0.85,
  scavenger: 0.1,
  breachJump: 1.25,
  breachScore: 1.5,
  vampFang: 0.05,
  thornSkin: 0.7,
  thornStun: 1.5,
  blastProof: 0.4,
  longRush: 3,
  greed: 1.35,
  treasureHunter: 2,
  bloodScent: 1.6,
  chargeBite: 1.6,
  chargeReach: 1.15,
  deepAdaptM: 120,
  deepAdapt: 0.7,
  chainFeed: 0.2,
  secondWindHp: 0.3,
  secondWindSpeed: 1.25,
  phoenixHp: 0.5,
  phoenixInvuln: 3,
  goldHeartEvery: 4,
  frenzyLordCombo: 2,
  frenzyLordWindow: 1.3,
  apexGrace: 1.12,
  apexGraceDrain: 0.9,
  gamblerCoins: 1.5,
  gamblerDrain: 1.25,
  twinSkill: 0.65,
  titanSize: 1.25,
  titanHp: 1.3,
  titanBite: 1.3,
  titanSpeed: 0.92,
} as const;

const N = AUG_N;
const pct = (m: number) => `${Math.round(Math.abs(m - 1) * 100)}%`;

export const AUGMENTS: AugmentDef[] = [
  // ── 실버: 숫자를 조금씩 ──
  { id: "ironJaw", tier: "silver", tag: "공격", icon: "🦷", name: "강철 턱", desc: `무는 힘 +${pct(N.ironJaw)} (여러 번 물어야 하는 큰 먹이)`, minTier: 3 },
  { id: "wideMaw", tier: "silver", tag: "공격", icon: "👄", name: "넓은 아가리", desc: `먹는 범위 +${pct(N.wideMaw)}` },
  { id: "sleekFins", tier: "silver", tag: "기동", icon: "🪽", name: "유선형 지느러미", desc: `헤엄 속도 +${pct(N.sleekFins)}` },
  { id: "thickHide", tier: "silver", tag: "생존", icon: "🛡️", name: "두꺼운 가죽", desc: `최대 체력 +${pct(N.thickHide)}` },
  { id: "slowMeta", tier: "silver", tag: "생존", icon: "🐢", name: "느린 대사", desc: `허기(체력 감소) −${pct(N.slowMeta)}` },
  { id: "magnetGills", tier: "silver", tag: "공격", icon: "🧲", name: "자석 아가미", desc: `작은 먹이 끌어당기는 범위 +${pct(N.magnetGillsMul)}` },
  { id: "bigBladder", tier: "silver", tag: "기동", icon: "🫧", name: "큰 부레", desc: `부스트 양 +${pct(N.bigBladderDur)} · 회복 +${pct(N.bigBladderRegen)}` },
  { id: "goldScale", tier: "silver", tag: "경제", icon: "✨", name: "금빛 비늘", desc: `코인 +${pct(N.goldScale)}` },
  { id: "fastDigest", tier: "silver", tag: "생존", icon: "🍖", name: "빠른 소화", desc: `먹을 때 회복 +${pct(N.fastDigest)}` },
  { id: "focus", tier: "silver", tag: "스킬", icon: "🎯", name: "집중", desc: `스킬 재사용 대기 −${pct(N.focus)}` },
  { id: "scavenger", tier: "silver", tag: "경제", icon: "🦴", name: "청소부", desc: `먹이가 코인을 떨굴 확률 +${Math.round(N.scavenger * 100)}%p` },
  { id: "breachMuscle", tier: "silver", tag: "기동", icon: "🐬", name: "도약 근육", desc: `수면 점프 +${pct(N.breachJump)} · 공중에서 먹으면 점수 ×${N.breachScore}` },
  // ── 골드: 새 규칙 하나 ──
  { id: "vampFang", tier: "gold", tag: "생존", icon: "🩸", name: "흡혈 이빨", desc: `덩치 큰 먹이를 한 번 물 때마다 최대 체력 ${Math.round(N.vampFang * 100)}% 회복`, minTier: 3 },
  { id: "thornSkin", tier: "gold", tag: "생존", icon: "🌵", name: "가시 피부", desc: `몸통 박치기 피해 −${pct(N.thornSkin)} · 때린 상대 ${N.thornStun}초 기절` },
  { id: "antidote", tier: "gold", tag: "생존", icon: "🧪", name: "해독 간", desc: "해파리 독에 걸리지 않음" },
  { id: "blastProof", tier: "gold", tag: "생존", icon: "💣", name: "방폭 비늘", desc: `폭발(기뢰·어뢰) 피해 −${pct(N.blastProof)}` },
  { id: "longRush", tier: "gold", tag: "경제", icon: "⏳", name: "황금 시간", desc: `골드 러시 +${N.longRush}초` },
  { id: "greed", tier: "gold", tag: "경제", icon: "🤑", name: "탐욕", desc: `골드 러시 게이지 +${pct(N.greed)}` },
  { id: "treasureHunter", tier: "gold", tag: "경제", icon: "🗝️", name: "보물 사냥꾼", desc: `보물 상자 코인 ×${N.treasureHunter}` },
  { id: "bloodScent", tier: "gold", tag: "경제", icon: "🌊", name: "피 냄새", desc: `콤보 유지 시간 +${pct(N.bloodScent)} (FRENZY 이어가기 쉬움)` },
  { id: "chargeBite", tier: "gold", tag: "공격", icon: "💥", name: "돌진 포식", desc: `부스트 중 무는 힘 ×${N.chargeBite} · 먹는 범위 +${pct(N.chargeReach)}` },
  { id: "deepAdapt", tier: "gold", tag: "생존", icon: "🌑", name: "심해 적응", desc: `수심 ${N.deepAdaptM}m 아래에서 허기 −${pct(N.deepAdapt)}` },
  { id: "chainFeed", tier: "gold", tag: "스킬", icon: "🔗", name: "연쇄 포식", desc: `먹을 때마다 스킬 대기 −${N.chainFeed}초` },
  { id: "secondWind", tier: "gold", tag: "기동", icon: "🌬️", name: "두 번째 숨결", desc: `체력 ${Math.round(N.secondWindHp * 100)}% 아래면 속도 +${pct(N.secondWindSpeed)} · 부스트 회복 ×2` },
  // ── 프리즘: 판을 바꾸는 한 장 ──
  { id: "phoenix", tier: "prism", tag: "생존", icon: "🔥", name: "불사조", desc: `한 번, 죽는 순간 체력 ${Math.round(N.phoenixHp * 100)}%로 부활 + ${N.phoenixInvuln}초 무적` },
  { id: "chainBreaker", tier: "prism", tag: "공격", icon: "⛓️", name: "먹이사슬 역행", desc: "한 단계 위 티어 먹이까지 먹을 수 있음" },
  { id: "goldHeart", tier: "prism", tag: "경제", icon: "💛", name: "황금 심장", desc: `메가 골드 러시가 8번째 → ${N.goldHeartEvery}번째 러시마다` },
  { id: "frenzyLord", tier: "prism", tag: "경제", icon: "🌀", name: "광란의 군주", desc: `FRENZY 단계가 콤보 절반에서 열림 · 콤보 유지 +${pct(N.frenzyLordWindow)}` },
  { id: "apexGrace", tier: "prism", tag: "공격", icon: "👑", name: "포식자의 품격", desc: `무는 힘·속도·체력·먹는 범위·부스트 +${pct(N.apexGrace)} · 허기 −${pct(N.apexGraceDrain)}` },
  { id: "gambler", tier: "prism", tag: "경제", icon: "🎲", name: "도박꾼", desc: `코인 ×${N.gamblerCoins} · 대신 허기 +${pct(N.gamblerDrain)}` },
  { id: "twinSkill", tier: "prism", tag: "스킬", icon: "♊", name: "쌍둥이 스킬", desc: `스킬 재사용 대기 −${pct(N.twinSkill)}` },
  { id: "titan", tier: "prism", tag: "공격", icon: "🏔️", name: "거대화", desc: `몸집 +${pct(N.titanSize)} · 체력·무는 힘 +${pct(N.titanHp)} · 속도 −${pct(N.titanSpeed)}` },
];

export const AUG_BY_ID: Record<AugmentId, AugmentDef> = Object.fromEntries(AUGMENTS.map((a) => [a.id, a])) as Record<AugmentId, AugmentDef>;

export const AUG_TIER_LABEL: Record<AugTier, string> = { silver: "실버", gold: "골드", prism: "프리즘" };

/** Survival seconds at which an offer opens. */
export const AUG_TIMES = [45, 120, 240, 390, 570] as const;

/** Tier odds [silver, gold, prism] per offer round (index = round). */
const TIER_ODDS: [number, number, number][] = [
  [0.7, 0.27, 0.03],
  [0.45, 0.45, 0.1],
  [0.2, 0.55, 0.25],
  [0.1, 0.5, 0.4],
  [0.05, 0.45, 0.5],
];

export function tierOdds(round: number): [number, number, number] {
  return TIER_ODDS[Math.min(TIER_ODDS.length - 1, Math.max(0, round))];
}

export function rollTier(round: number, r: number): AugTier {
  const [s, g] = tierOdds(round);
  return r < s ? "silver" : r < s + g ? "gold" : "prism";
}

/** Three distinct cards of `tier`, none already owned (falls back to other tiers if the pool runs dry). */
export function rollCards(tier: AugTier, owned: readonly AugmentId[], rnd: () => number, avoid: readonly AugmentId[] = [], sharkTier = 4): AugmentId[] {
  const free = (t: AugTier, skip: readonly AugmentId[]) =>
    AUGMENTS.filter((a) => a.tier === t && !owned.includes(a.id) && !skip.includes(a.id) && (a.minTier ?? 0) <= sharkTier).map((a) => a.id);
  let pool = free(tier, avoid);
  if (pool.length < 3) pool = free(tier, []);
  if (pool.length < 3) for (const t of ["gold", "silver", "prism"] as AugTier[]) if (t !== tier) pool.push(...free(t, []).filter((id) => !pool.includes(id)));
  const out: AugmentId[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

/** Folds the stat-only parts of the owned augments into a fresh EffectiveStats. */
export function applyAugStats(st: EffectiveStats, augs: readonly AugmentId[]): EffectiveStats {
  if (!augs.length) return st;
  const s = { ...st };
  const has = (id: AugmentId) => augs.includes(id);
  if (has("ironJaw")) s.biteForce *= N.ironJaw;
  if (has("wideMaw")) s.eatRadius *= N.wideMaw;
  if (has("sleekFins")) s.swimSpeed *= N.sleekFins;
  if (has("thickHide")) s.maxHealth = Math.round(s.maxHealth * N.thickHide);
  if (has("slowMeta")) s.baseDrainRate *= N.slowMeta;
  if (has("magnetGills")) s.magnetRadius = s.magnetRadius * N.magnetGillsMul + N.magnetGillsAdd;
  if (has("bigBladder")) {
    s.boostDuration *= N.bigBladderDur;
    s.boostRegen *= N.bigBladderRegen;
  }
  if (has("goldScale")) s.goldMultiplier *= N.goldScale;
  if (has("fastDigest")) s.healMul *= N.fastDigest;
  if (has("focus")) s.skillCooldown *= N.focus;
  if (has("apexGrace")) {
    s.biteForce *= N.apexGrace;
    s.swimSpeed *= N.apexGrace;
    s.maxHealth = Math.round(s.maxHealth * N.apexGrace);
    s.eatRadius *= N.apexGrace;
    s.boostDuration *= N.apexGrace;
    s.baseDrainRate *= N.apexGraceDrain;
  }
  if (has("gambler")) {
    s.goldMultiplier *= N.gamblerCoins;
    s.baseDrainRate *= N.gamblerDrain;
  }
  if (has("twinSkill")) s.skillCooldown *= N.twinSkill;
  if (has("titan")) {
    s.length *= N.titanSize;
    s.eatRadius *= N.titanSize;
    s.maxHealth = Math.round(s.maxHealth * N.titanHp);
    s.biteForce *= N.titanBite;
    s.swimSpeed *= N.titanSpeed;
  }
  return s;
}
