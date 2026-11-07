/**
 * 랜덤 합성 디펜스 — ✨ 증강 (2026-11-07).
 *
 * At the start of waves AUG_WAVES every living board is offered 3 cards of
 * the same tier (one tier roll per round for everyone, so nobody gets a
 * richer table) and keeps one for the rest of the match. The game does not
 * pause: after AUG_PICK_TICKS the first card is taken automatically. One
 * reroll per match.
 *
 * Effects are numbers summed over a board's augments (`augTotals`) and read
 * by the engine's existing formulas (damage, interval, range, gold, …);
 * a few cards also do something once when picked (`instant`, engine side).
 * Pure data + helpers only — engine.ts owns the rng and applies picks.
 */

export type AugTier = "silver" | "gold" | "prism";
export const AUG_TIERS: AugTier[] = ["silver", "gold", "prism"];
export const AUG_TIER_INFO: Record<AugTier, { name: string; color: string; ring: string; mark: string }> = {
  silver: { name: "실버", color: "#cbd5e1", ring: "border-slate-300", mark: "◆" },
  gold: { name: "골드", color: "#fbbf24", ring: "border-amber-300", mark: "◆◆" },
  prism: { name: "프리즘", color: "#e879f9", ring: "border-fuchsia-300", mark: "◆◆◆" },
};

export type AugTag = "공격" | "경제" | "방어" | "운영";

/** Summable effect fields. Fractions unless noted. */
export interface AugTotals {
  /** Damage +% for 물리 / 마법 towers. */
  phys: number;
  magic: number;
  /** Damage +% for 일반·희귀 (grade ≤ 2) / 전설·신화 (grade ≥ 4) towers. */
  low: number;
  high: number;
  /** Damage +% per distinct tower kind on the board. */
  rainbow: number;
  /** Damage +% for the kind with the most towers on the board. */
  specialist: number;
  /** Crit chance (+percentage points as a fraction) / crit multiplier (+). */
  crit: number;
  critMult: number;
  /** Attack interval −%. */
  haste: number;
  /** Range + px (can be negative). */
  range: number;
  /** Share of armor / resist ignored. */
  pierce: number;
  /** Damage +% against bosses and warlords. */
  big: number;
  /** Every monster on this road walks this much slower. */
  slow: number;
  /** Kill gold +% / wave bonus +%. */
  killGold: number;
  waveGold: number;
  /** Wave start: earn this share of current gold (capped by interestCap). */
  interest: number;
  /** 1 = summon price rises +1 per summon instead of +2. */
  cheap: number;
  /** Extra chance a summon lands 희귀. */
  lucky: number;
  /** 1 = a 꽝 gamble rolls once more. */
  gambleRetry: number;
  /** 1 = every merge pays mergeGold(wave). */
  mergeGold: number;
  /** 1 = 판매 refunds everything paid. */
  sellAll: number;
  /** Elimination head count + (absolute). */
  limit: number;
  /** Stun on my towers −%. */
  stunCut: number;
  /** Elites / invaders / hires I send get +% HP. */
  sendHp: number;
  /** Elites / invaders / hires that reach my road get −% HP. */
  foeCut: number;
  /** 유닛 대결 send / hire income +%. */
  income: number;
  /** Extra gems per wave-boss kill (absolute). */
  bossGems: number;
}

const ZERO: AugTotals = {
  phys: 0, magic: 0, low: 0, high: 0, rainbow: 0, specialist: 0, crit: 0, critMult: 0, haste: 0, range: 0, pierce: 0, big: 0,
  slow: 0, killGold: 0, waveGold: 0, interest: 0, cheap: 0, lucky: 0, gambleRetry: 0, mergeGold: 0, sellAll: 0, limit: 0,
  stunCut: 0, sendHp: 0, foeCut: 0, income: 0, bossGems: 0,
};

/** One-off effects applied by the engine when the card is picked. */
export type AugInstant =
  | { kind: "gems"; n: number }
  | { kind: "focus"; n: number }
  | { kind: "hero"; n: number }
  | { kind: "ascend"; n: number };

export interface AugmentDef {
  id: string;
  tier: AugTier;
  emoji: string;
  name: string;
  desc: string;
  tag: AugTag;
  fx: Partial<AugTotals>;
  instant?: AugInstant;
  /** Only offered in 유닛 대결. */
  versusOnly?: boolean;
  /** Lobby-AI preference (higher = picked first by Lv.3+ bots). */
  botScore: number;
}

/**
 * Tuning: edit numbers here only. Balance probe = 2-bot survival games where
 * both seats pick uniformly at random; each card's holder should end within
 * a few waves of the field (see the commit / memory notes for the run).
 */
export const AUGMENT_LIST: AugmentDef[] = [
  // ── 실버 ──
  { id: "sharp", tier: "silver", emoji: "🗡️", name: "예리한 촉", desc: "물리 타워 피해 +14%", tag: "공격", fx: { phys: 0.14 }, botScore: 5 },
  { id: "arcane", tier: "silver", emoji: "🔮", name: "비전 증폭", desc: "마법 타워 피해 +18%", tag: "공격", fx: { magic: 0.18 }, botScore: 5 },
  { id: "rookie", tier: "silver", emoji: "🎖️", name: "신병 훈련소", desc: "일반·희귀 타워 피해 +45%", tag: "공격", fx: { low: 0.45 }, botScore: 4 },
  { id: "eagle", tier: "silver", emoji: "🦅", name: "매의 눈", desc: "모든 타워 사거리 +18", tag: "공격", fx: { range: 18 }, botScore: 4 },
  { id: "chill", tier: "silver", emoji: "🌬️", name: "서리 바람", desc: "내 길의 몬스터 이동 속도 −11%", tag: "방어", fx: { slow: 0.11 }, botScore: 4 },
  { id: "bounty", tier: "silver", emoji: "💰", name: "현상금", desc: "처치 골드 +30%", tag: "경제", fx: { killGold: 0.3 }, botScore: 5 },
  { id: "interest", tier: "silver", emoji: "🏦", name: "이자", desc: "웨이브 시작마다 보유 골드의 8% (최대 20+웨이브×4)", tag: "경제", fx: { interest: 0.08 }, botScore: 3 },
  { id: "cheap", tier: "silver", emoji: "🏷️", name: "할인 소환", desc: "소환 비용이 +2 대신 +1씩 올라요", tag: "경제", fx: { cheap: 1 }, botScore: 4 },
  { id: "gempouch", tier: "silver", emoji: "💎", name: "보석 주머니", desc: "즉시 💎 +3", tag: "경제", fx: {}, instant: { kind: "gems", n: 3 }, botScore: 4 },
  { id: "recycle", tier: "silver", emoji: "♻️", name: "재활용", desc: "판매하면 쓴 골드를 100% 돌려받아요", tag: "운영", fx: { sellAll: 1 }, botScore: 1 },
  { id: "grit", tier: "silver", emoji: "🪖", name: "강철 의지", desc: "내 타워가 받는 기절 시간 −70% · 처치 골드 +10%", tag: "방어", fx: { stunCut: 0.7, killGold: 0.1 }, botScore: 2 },

  // ── 골드 ──
  { id: "crit", tier: "gold", emoji: "🎯", name: "치명 본능", desc: "치명타 확률 +8%p", tag: "공격", fx: { crit: 0.08 }, botScore: 6 },
  { id: "executioner", tier: "gold", emoji: "🪓", name: "처형인", desc: "치명타 배율 +0.7", tag: "공격", fx: { critMult: 0.7 }, botScore: 5 },
  { id: "haste", tier: "gold", emoji: "⏩", name: "속사", desc: "모든 타워 공격 속도 +11%", tag: "공격", fx: { haste: 0.11 }, botScore: 7 },
  { id: "pierce", tier: "gold", emoji: "🔩", name: "관통탄", desc: "몬스터 방어력·마법 저항 40% 무시", tag: "공격", fx: { pierce: 0.4 }, botScore: 5 },
  { id: "giantslayer", tier: "gold", emoji: "🐉", name: "거인 사냥꾼", desc: "보스·전쟁군주에게 피해 +60%", tag: "공격", fx: { big: 0.6 }, botScore: 5 },
  { id: "lucky", tier: "gold", emoji: "🍀", name: "행운의 소환", desc: "소환 시 희귀가 나올 확률 6% → 25%", tag: "운영", fx: { lucky: 0.19 }, botScore: 5 },
  { id: "gambler", tier: "gold", emoji: "🎲", name: "승부사", desc: "💎 도박이 꽝이면 한 번 더 굴려요 · 즉시 💎 +2", tag: "운영", fx: { gambleRetry: 1 }, instant: { kind: "gems", n: 2 }, botScore: 4 },
  { id: "alchemy", tier: "gold", emoji: "⚗️", name: "황금 합성", desc: "합성할 때마다 🪙 8+웨이브", tag: "경제", fx: { mergeGold: 1 }, botScore: 5 },
  { id: "bulwark", tier: "gold", emoji: "🧱", name: "최후의 방벽", desc: "내 탈락 기준 +8마리", tag: "방어", fx: { limit: 8 }, botScore: 6 },
  { id: "focus", tier: "gold", emoji: "🔭", name: "집중 수련", desc: "🎯 집중 +3레벨 즉시 (최대면 레벨당 🪙150)", tag: "공격", fx: {}, instant: { kind: "focus", n: 3 }, botScore: 4 },
  { id: "fortress", tier: "gold", emoji: "🏰", name: "요새화", desc: "상대가 보낸 정예·침략자·몬스터 체력 −45%", tag: "방어", fx: { foeCut: 0.45 }, botScore: 3 },
  { id: "raider", tier: "gold", emoji: "🏴", name: "약탈 원정", desc: "내가 보내는 정예·침략자·몬스터 체력 +40%", tag: "운영", fx: { sendHp: 0.4 }, botScore: 3 },

  // ── 프리즘 ──
  { id: "mythic", tier: "prism", emoji: "✨", name: "신화의 숨결", desc: "전설·신화 타워 피해 +45%", tag: "공격", fx: { high: 0.45 }, botScore: 6 },
  { id: "hero", tier: "prism", emoji: "🦸", name: "영웅 강림", desc: "즉시 영웅 타워 2기 (빈 칸이 없으면 가장 약한 일반·희귀 자리에)", tag: "운영", fx: {}, instant: { kind: "hero", n: 2 }, botScore: 5 },
  { id: "ascend", tier: "prism", emoji: "⬆️", name: "승급 의식", desc: "영웅 이하 타워 2기를 즉시 한 등급 올려요", tag: "운영", fx: {}, instant: { kind: "ascend", n: 2 }, botScore: 6 },
  { id: "rainbow", tier: "prism", emoji: "🌈", name: "무지개 군단", desc: "보드의 타워 종류 1개당 피해 +4%", tag: "공격", fx: { rainbow: 0.04 }, botScore: 6 },
  { id: "specialist", tier: "prism", emoji: "🧪", name: "외골수", desc: "가장 많은 종류의 타워 피해 +60%", tag: "공격", fx: { specialist: 0.6 }, botScore: 5 },
  { id: "midas", tier: "prism", emoji: "👑", name: "미다스의 손", desc: "처치 골드 +35% · 웨이브 보너스 +80%", tag: "경제", fx: { killGold: 0.35, waveGold: 0.8 }, botScore: 6 },
  { id: "overclock", tier: "prism", emoji: "⚙️", name: "과부하", desc: "공격 속도 +22% · 사거리 −10", tag: "공격", fx: { haste: 0.22, range: -10 }, botScore: 7 },
  { id: "geode", tier: "prism", emoji: "🪨", name: "보석 광맥", desc: "즉시 💎 +5 · 웨이브 보스 처치마다 💎 +3 · 처치 골드 +10%", tag: "경제", fx: { bossGems: 3, killGold: 0.1 }, instant: { kind: "gems", n: 5 }, botScore: 5 },
  { id: "warchest", tier: "prism", emoji: "💹", name: "전쟁 자금", desc: "보내기·몬스터 구매 수입 ×2.5", tag: "경제", fx: { income: 1.5 }, versusOnly: true, botScore: 5 },
];

export type AugmentId = string;
export const AUGMENTS: Record<AugmentId, AugmentDef> = Object.fromEntries(AUGMENT_LIST.map((a) => [a.id, a]));

/** Waves whose start opens a pick round (index = round). */
export const AUG_WAVES = [3, 10, 18];
/** Ticks a board has to pick before the first card is taken for it (15 s). */
export const AUG_PICK_TICKS = 15 * 20;
export const AUG_REROLLS = 1;
/** Tier odds (percent) per round — one roll per round, shared by every board. */
export const AUG_ODDS: Record<AugTier, number>[] = [
  { silver: 70, gold: 25, prism: 5 },
  { silver: 25, gold: 55, prism: 20 },
  { silver: 5, gold: 45, prism: 50 },
];

/**
 * Monster HP multiplier for matches with augments on: everyone gets ~3 cards
 * stronger, so the waves get this much tougher to keep game length (bot sim).
 * Mutable for balance sims.
 */
export const AUG_BALANCE = { hp: 1.3, from: 8, to: 22 };

export function sanitizeAugmentId(v: unknown): AugmentId | null {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(AUGMENTS, v) ? v : null;
}

const totalsCache = new WeakMap<readonly string[], AugTotals>();
/** Summed effects of a board's augments (cached per array — boards share it immutably). */
export function augTotals(ids: readonly AugmentId[] | undefined): AugTotals {
  if (!ids || ids.length === 0) return ZERO;
  const hit = totalsCache.get(ids);
  if (hit) return hit;
  const t: AugTotals = { ...ZERO };
  for (const id of ids) {
    const fx = AUGMENTS[id]?.fx;
    if (!fx) continue;
    for (const k of Object.keys(fx) as (keyof AugTotals)[]) t[k] += fx[k] ?? 0;
  }
  totalsCache.set(ids, t);
  return t;
}

/** Gold cap for 🏦 이자 at this wave. */
export function interestCap(wave: number): number {
  return 20 + 4 * Math.max(1, wave);
}

/** Gold per merge for ⚗️ 황금 합성. */
export function mergeGoldAt(wave: number): number {
  return 8 + Math.max(1, wave);
}

/** Round index (0-based) whose pick opens at the start of `wave`, or -1. */
export function augRoundAt(wave: number): number {
  return AUG_WAVES.indexOf(wave);
}

const TOTAL_LABELS: { key: keyof AugTotals; label: (v: number) => string }[] = [
  { key: "phys", label: (v) => `물리 피해 +${Math.round(v * 100)}%` },
  { key: "magic", label: (v) => `마법 피해 +${Math.round(v * 100)}%` },
  { key: "low", label: (v) => `일반·희귀 피해 +${Math.round(v * 100)}%` },
  { key: "high", label: (v) => `전설·신화 피해 +${Math.round(v * 100)}%` },
  { key: "rainbow", label: (v) => `종류당 피해 +${Math.round(v * 100)}%` },
  { key: "specialist", label: (v) => `주력 종류 피해 +${Math.round(v * 100)}%` },
  { key: "crit", label: (v) => `치명타 +${Math.round(v * 100)}%p` },
  { key: "critMult", label: (v) => `치명 배율 +${v.toFixed(1)}` },
  { key: "haste", label: (v) => `공격 속도 +${Math.round(v * 100)}%` },
  { key: "range", label: (v) => `사거리 ${v > 0 ? "+" : ""}${Math.round(v)}` },
  { key: "pierce", label: (v) => `방어·저항 ${Math.round(v * 100)}% 무시` },
  { key: "big", label: (v) => `보스 피해 +${Math.round(v * 100)}%` },
  { key: "slow", label: (v) => `몬스터 감속 ${Math.round(v * 100)}%` },
  { key: "killGold", label: (v) => `처치 골드 +${Math.round(v * 100)}%` },
  { key: "waveGold", label: (v) => `웨이브 보너스 +${Math.round(v * 100)}%` },
  { key: "interest", label: (v) => `이자 ${Math.round(v * 100)}%` },
  { key: "cheap", label: () => "소환비 +1씩" },
  { key: "lucky", label: (v) => `희귀 소환 +${Math.round(v * 100)}%p` },
  { key: "gambleRetry", label: () => "도박 꽝 재굴림" },
  { key: "mergeGold", label: () => "합성 골드" },
  { key: "sellAll", label: () => "판매 100%" },
  { key: "limit", label: (v) => `탈락 기준 +${v}` },
  { key: "stunCut", label: (v) => `기절 −${Math.round(v * 100)}%` },
  { key: "sendHp", label: (v) => `보내는 몬스터 체력 +${Math.round(v * 100)}%` },
  { key: "foeCut", label: (v) => `받는 견제 체력 −${Math.round(v * 100)}%` },
  { key: "income", label: (v) => `보내기 수입 ×${(1 + v).toFixed(1)}` },
  { key: "bossGems", label: (v) => `보스 💎 +${v}` },
];

/** Non-zero summed effects as short Korean labels (for the ✨ 증강 비교 panel). */
export function describeTotals(t: AugTotals): string[] {
  return TOTAL_LABELS.filter(({ key }) => t[key] !== 0).map(({ key, label }) => label(t[key]));
}
