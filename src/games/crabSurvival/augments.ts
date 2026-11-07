/**
 * 꽃게 서바이벌 증강 (augments): a 3-card pick at level milestones, kept for the whole match
 * (death and revive included). Numeric effects fold into one `AugMods` per crab; the handful of
 * prism specials (`special`) are wired by id in engine.ts.
 */

export type AugTier = "silver" | "gold" | "prism";
export type AugTag = "공격" | "방어" | "기동" | "경제" | "특수";

export interface AugMods {
  /** Multipliers (1 = neutral). */
  atk: number;
  armor: number;
  speed: number;
  hp: number;
  regen: number;
  food: number;
  coin: number;
  kill: number;
  stamina: number;
  skillCd: number;
  gearDmg: number;
  gearDur: number;
  reach: number;
  atkCd: number;
  mutDur: number;
  scale: number;
  /** Additive (0 = neutral). */
  crit: number;
  critMult: number;
  counter: number;
  lifesteal: number;
  thorns: number;
  execute: number;
  slayer: number;
  dodge: number;
  magnet: number;
  gearSlots: number;
}

export const NEUTRAL_MODS: AugMods = {
  atk: 1, armor: 1, speed: 1, hp: 1, regen: 1, food: 1, coin: 1, kill: 1, stamina: 1, skillCd: 1,
  gearDmg: 1, gearDur: 1, reach: 1, atkCd: 1, mutDur: 1, scale: 1,
  crit: 0, critMult: 0, counter: 0, lifesteal: 0, thorns: 0, execute: 0, slayer: 0, dodge: 0, magnet: 0, gearSlots: 0,
};
const MULT_KEYS = ["atk", "armor", "speed", "hp", "regen", "food", "coin", "kill", "stamina", "skillCd", "gearDmg", "gearDur", "reach", "atkCd", "mutDur", "scale"] as const;

/** Specials that need their own code path in the engine. */
export type AugSpecial = "phoenix" | "chain" | "quake" | "feast" | "crown" | "underdog" | "masterKey" | "nova" | "ghostStep" | "comboKing";

export interface AugmentDef {
  id: string;
  name: string;
  emoji: string;
  tier: AugTier;
  tag: AugTag;
  desc: string;
  mods?: Partial<AugMods>;
  special?: AugSpecial;
}

// Thresholds / numbers for the specials (tuned by bot self-play).
export const EXECUTE_HP = 0.3;
export const PHOENIX_HP = 0.4;
export const PHOENIX_INVULN = 2;
export const CHAIN_EVERY = 4;
export const CHAIN_RANGE = 230;
export const CHAIN_TARGETS = 3;
export const CHAIN_DMG = 1.4; // × ATK
export const QUAKE_EVERY = 5;
export const QUAKE_RADIUS = 125; // × scale
export const QUAKE_DMG = 2.2; // × ATK
export const FEAST_HEAL = 0.4;
export const FEAST_RUSH = 3;
export const CROWN_ATK = 1.2;
export const CROWN_ARMOR = 0.8;
export const UNDERDOG_ATK = 1.35;
export const UNDERDOG_SPEED = 1.12;
export const NOVA_RADIUS = 190; // × scale
export const NOVA_DMG = 3; // × ATK
export const GHOST_INVULN = 1.2;
export const GHOST_EVERY = 13;
export const COMBO_KING_STEP = 0.05;

export const AUGMENT_LIST: AugmentDef[] = [
  // ── 실버: plain stat bumps ──
  { id: "claw", name: "단단한 집게", emoji: "🦀", tier: "silver", tag: "공격", desc: "공격력 +15%", mods: { atk: 1.15 } },
  { id: "shell", name: "두꺼운 껍질", emoji: "🐚", tier: "silver", tag: "방어", desc: "받는 피해 -12%", mods: { armor: 0.88 } },
  { id: "legs", name: "가벼운 다리", emoji: "🦵", tier: "silver", tag: "기동", desc: "이동 속도 +8%", mods: { speed: 1.08 } },
  { id: "body", name: "튼튼한 몸", emoji: "💪", tier: "silver", tag: "방어", desc: "최대 체력 +15%", mods: { hp: 1.15 } },
  { id: "gourmet", name: "미식가", emoji: "🍌", tier: "silver", tag: "경제", desc: "음식 점수 +25%", mods: { food: 1.25 } },
  { id: "pocket", name: "동전 주머니", emoji: "🪙", tier: "silver", tag: "경제", desc: "코인 점수 +25%, 줍는 범위 +30", mods: { coin: 1.25, magnet: 30 } },
  { id: "breath", name: "숨 고르기", emoji: "🫁", tier: "silver", tag: "기동", desc: "부스트 스태미나 소모 -35%", mods: { stamina: 0.65 } },
  { id: "regen", name: "재생 체질", emoji: "🌿", tier: "silver", tag: "방어", desc: "자연 회복 ×2", mods: { regen: 2 } },
  { id: "long", name: "긴 집게", emoji: "📏", tier: "silver", tag: "공격", desc: "공격 사거리 +15%", mods: { reach: 1.15 } },
  { id: "quick", name: "빠른 손놀림", emoji: "✋", tier: "silver", tag: "공격", desc: "공격 쿨다운 -10%", mods: { atkCd: 0.9 } },
  { id: "eye", name: "날카로운 눈", emoji: "👁️", tier: "silver", tag: "공격", desc: "치명타 확률 +8%", mods: { crit: 0.08 } },
  { id: "parry", name: "반격 본능", emoji: "🔁", tier: "silver", tag: "공격", desc: "반격 피해 ×1.5 → ×2.0", mods: { counter: 0.5 } },

  // ── 골드: build-defining ──
  { id: "vamp", name: "흡혈 집게", emoji: "🩸", tier: "gold", tag: "방어", desc: "준 피해의 12%만큼 회복", mods: { lifesteal: 0.12 } },
  { id: "thorn", name: "가시 껍질", emoji: "🌵", tier: "gold", tag: "방어", desc: "받은 근접 피해의 40%를 되돌려줌", mods: { thorns: 0.4 } },
  { id: "execute", name: "처형인", emoji: "🪓", tier: "gold", tag: "공격", desc: "체력 30% 이하 대상에게 피해 +60%", mods: { execute: 0.6 } },
  { id: "slayer", name: "거인 사냥꾼", emoji: "🗡️", tier: "gold", tag: "공격", desc: "나보다 레벨 높은 꽃게에게 피해 +30%", mods: { slayer: 0.3 } },
  { id: "vital", name: "급소 강타", emoji: "🎯", tier: "gold", tag: "공격", desc: "치명타 확률 +6%, 치명타 피해 ×1.75 → ×2.35", mods: { crit: 0.06, critMult: 0.6 } },
  { id: "engineer", name: "장비 마스터", emoji: "🔧", tier: "gold", tag: "공격", desc: "필드 무기 피해 +30%, 지속 +25%", mods: { gearDmg: 1.3, gearDur: 1.25 } },
  { id: "haste", name: "스킬 가속", emoji: "⚡", tier: "gold", tag: "특수", desc: "티어 스킬 쿨다운 -35%", mods: { skillCd: 0.65 } },
  { id: "dodge", name: "잔상 회피", emoji: "💨", tier: "gold", tag: "방어", desc: "12% 확률로 공격을 완전히 회피", mods: { dodge: 0.12 } },
  { id: "hunter", name: "현상금 사냥꾼", emoji: "💰", tier: "gold", tag: "경제", desc: "꽃게 처치 보상 +40%", mods: { kill: 1.4 } },
  { id: "mutant", name: "돌연변이 체질", emoji: "🧬", tier: "gold", tag: "특수", desc: "버프 돌연변이 지속 +70%", mods: { mutDur: 1.7 } },
  { id: "berserk", name: "광전사", emoji: "😡", tier: "gold", tag: "공격", desc: "공격력 +25%, 받는 피해 +10%", mods: { atk: 1.25, armor: 1.1 } },
  { id: "bulwark", name: "철벽", emoji: "🧱", tier: "gold", tag: "방어", desc: "받는 피해 -26%, 이동 속도 -4%", mods: { armor: 0.74, speed: 0.96 } },
  { id: "sprint", name: "질주 본능", emoji: "🏃", tier: "gold", tag: "기동", desc: "이동 속도 +12%, 스태미나 소모 -25%", mods: { speed: 1.12, stamina: 0.75 } },
  { id: "combo", name: "연타의 달인", emoji: "🥁", tier: "gold", tag: "공격", desc: "콤보 1회마다 공격력 +5% (최대 10콤보)", special: "comboKing" },

  // ── 프리즘: specials ──
  { id: "phoenix", name: "불사조 껍질", emoji: "🔥", tier: "prism", tag: "방어", desc: "매치당 1회, 치명상을 버티고 체력 40%로 부활 + 2초 무적", special: "phoenix" },
  { id: "chain", name: "천둥 집게", emoji: "🌩️", tier: "prism", tag: "공격", desc: "4번째 적중마다 번개가 주변 적 3명에게 튐 (ATK×1.4)", special: "chain" },
  { id: "quake", name: "지진 집게", emoji: "🌋", tier: "prism", tag: "공격", desc: "5번째 휘두름마다 주변에 충격파 (ATK×2.2 + 기절)", special: "quake" },
  { id: "feast", name: "피의 축제", emoji: "🍖", tier: "prism", tag: "방어", desc: "꽃게 처치 시 체력 40% 회복 + 3초 질주", special: "feast" },
  { id: "crown", name: "왕의 위엄", emoji: "👑", tier: "prism", tag: "특수", desc: "킹 크랩인 동안 공격력 +20%, 받는 피해 -20%", special: "crown" },
  { id: "underdog", name: "역전의 용사", emoji: "🔻", tier: "prism", tag: "특수", desc: "순위가 절반 아래일 때 공격력 +35%, 이속 +12%", special: "underdog" },
  { id: "masterKey", name: "만능 열쇠", emoji: "🗝️", tier: "prism", tag: "경제", desc: "황금 상자를 열쇠 없이 열고, 코인 점수 +20%", special: "masterKey", mods: { coin: 1.2 } },
  { id: "arsenal", name: "무기고", emoji: "🎒", tier: "prism", tag: "공격", desc: "필드 무기를 3개까지 장착, 지속 +15%", mods: { gearSlots: 1, gearDur: 1.15 } },
  { id: "midas", name: "황금 손", emoji: "✨", tier: "prism", tag: "경제", desc: "음식·코인 점수 +35%", mods: { food: 1.35, coin: 1.35 } },
  { id: "colossus", name: "거대 갑각", emoji: "🗿", tier: "prism", tag: "방어", desc: "몸집 +20%, 최대 체력 +35%, 공격력 +10%, 이속 -5%", mods: { scale: 1.2, hp: 1.35, atk: 1.1, speed: 0.95 } },
  { id: "nova", name: "초신성", emoji: "💥", tier: "prism", tag: "공격", desc: "레벨업할 때마다 대폭발 (ATK×3, 넉백)", special: "nova" },
  { id: "ghostStep", name: "유령 걸음", emoji: "👻", tier: "prism", tag: "기동", desc: "13초마다 피격 시 1.2초 무적, 이속 +8%", special: "ghostStep", mods: { speed: 1.08 } },
];

export const AUGMENTS: Record<string, AugmentDef> = Object.fromEntries(AUGMENT_LIST.map((a) => [a.id, a]));

export const AUG_TIER: Record<AugTier, { label: string; color: string; glow: string }> = {
  silver: { label: "실버", color: "#cbd5e1", glow: "rgba(203,213,225,0.45)" },
  gold: { label: "골드", color: "#fbbf24", glow: "rgba(251,191,36,0.5)" },
  prism: { label: "프리즘", color: "#e879f9", glow: "rgba(232,121,249,0.55)" },
};

/** The level that opens each augment round, and that round's tier odds (silver, gold, prism). */
export const AUG_LEVELS = [3, 6, 9, 11] as const;
export const AUG_ODDS: [number, number, number][] = [
  [0.7, 0.25, 0.05],
  [0.3, 0.55, 0.15],
  [0.1, 0.5, 0.4],
  [0, 0.4, 0.6],
];
export const AUG_CARDS = 3;
export const AUG_REROLLS = 1;

export function foldMods(ids: readonly string[]): AugMods {
  const m: AugMods = { ...NEUTRAL_MODS };
  for (const id of ids) {
    const d = AUGMENTS[id]?.mods;
    if (!d) continue;
    for (const k of Object.keys(d) as (keyof AugMods)[]) {
      const v = d[k]!;
      if ((MULT_KEYS as readonly string[]).includes(k)) m[k] *= v;
      else m[k] += v;
    }
  }
  return m;
}

export function hasAug(ids: readonly string[], special: AugSpecial): boolean {
  return ids.some((id) => AUGMENTS[id]?.special === special);
}

/** Roll a round's tier from its odds, `r` ∈ [0,1). */
export function rollTier(round: number, r: number): AugTier {
  const [s, g] = AUG_ODDS[Math.min(round, AUG_ODDS.length - 1)];
  return r < s ? "silver" : r < s + g ? "gold" : "prism";
}

/** Draw `n` distinct cards of a tier the crab doesn't own yet; `rnd` returns [0,1). */
export function drawCards(tier: AugTier, owned: readonly string[], rnd: () => number, n = AUG_CARDS, exclude: readonly string[] = []): string[] {
  let pool = AUGMENT_LIST.filter((a) => a.tier === tier && !owned.includes(a.id) && !exclude.includes(a.id)).map((a) => a.id);
  if (pool.length < n) pool = AUGMENT_LIST.filter((a) => a.tier === tier && !owned.includes(a.id)).map((a) => a.id);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
