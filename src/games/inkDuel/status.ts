/**
 * 낙서 결투 — status effects shared by both modes. Durations are counted in
 * the victim's own turns in 🛑 stop mode and in milliseconds in 🏃 moving mode.
 */

import type { Element, WeaponStats } from "./analyze";

export type StatusId = "burn" | "poison" | "freeze" | "slow" | "stun" | "weaken" | "vulnerable" | "confuse" | "blind";

export type StatusMap = Partial<Record<StatusId, number>>;

export const STATUS_INFO: Record<StatusId, { emoji: string; name: string; turn: string; live: string }> = {
  burn: { emoji: "🔥", name: "화상", turn: "2턴 동안 턴 시작마다 −5", live: "3초 동안 지속 피해" },
  poison: { emoji: "☠️", name: "중독", turn: "3턴 동안 턴 시작마다 −4", live: "5초 동안 지속 피해" },
  freeze: { emoji: "❄️", name: "빙결", turn: "다음 턴 잉크 72", live: "1.2초 동안 꽁꽁 (이동·공격 불가)" },
  slow: { emoji: "🐌", name: "느려짐", turn: "다음 턴 이동 거리 절반·이동 잉크 2배·발사 힘 −7% (50% 확률 · 연속 없음)", live: "3초 동안 이동 속도 −50%·발사 힘 −10% (50% 확률)" },
  stun: { emoji: "💫", name: "기절", turn: "다음 턴을 통째로 쉼 (45% 확률 · 연속 기절 없음)", live: "1.5초 동안 아무것도 못 함 (45% 확률)" },
  weaken: { emoji: "⬇️", name: "약화", turn: "2턴 동안 주는 피해 −20%", live: "5초 동안 주는 피해 −20%" },
  vulnerable: { emoji: "💔", name: "취약", turn: "2턴 동안 받는 피해 +25%", live: "5초 동안 받는 피해 +25%" },
  confuse: { emoji: "😵", name: "혼란", turn: "다음 발사 각도가 4~9° 빗나감 (50% 확률 · 연속 혼란 없음)", live: "3초 동안 좌우 조작 반대 (50% 확률)" },
  blind: { emoji: "🕶️", name: "실명", turn: "다음 턴 조준선·바람 안 보이고 발사 힘이 ±3~8 흔들림 (50% 확률 · 연속 없음)", live: "3초 동안 조준선 안 보임·시야 어두움·발사 힘 흔들림 (50% 확률)" },
};

/** Which status each ink element inflicts on a hit (steel, shock and vampire work differently). */
export const ELEMENT_STATUS: Partial<Record<Element, StatusId>> = {
  fire: "burn",
  ice: "freeze",
  poison: "poison",
  slow: "slow",
  stun: "stun",
  curse: "weaken",
  crush: "vulnerable",
  chaos: "confuse",
  dark: "blind",
};

export const TURN_DURATION: Record<StatusId, number> = {
  burn: 2,
  poison: 3,
  freeze: 1,
  slow: 1,
  stun: 1,
  weaken: 2,
  vulnerable: 2,
  confuse: 1,
  blind: 1,
};

export const LIVE_DURATION_MS: Record<StatusId, number> = {
  burn: 3000,
  poison: 5000,
  freeze: 1200,
  slow: 3000,
  stun: 1500,
  weaken: 5000,
  vulnerable: 5000,
  confuse: 3000,
  blind: 3000,
};

/**
 * Balance (2026-10-09 combo-duel sim, 60 duels per color pair): guaranteed stun and
 * re-applied confuse locked the victim out (85–100% win rates), so stun became a
 * chance, confuse got a one-turn immunity like stun, and weaken/lifesteal/freeze eased.
 */
export const STUN_CHANCE = 0.45;
export const CONFUSE_CHANCE = 0.5;
/** A second ink color (≥35% of the ink) only lands its effect half the time. */
export const SECOND_ELEMENT_CHANCE = 0.5;
export const SHOCK_STUN_CHANCE = 0.2;
export const LIFESTEAL = 0.3;
export const WEAKEN_MUL = 0.8;
export const VULNERABLE_MUL = 1.25;
/**
 * 🐌 / 🕶️ used to only touch convenience (walking, the aim guide), so bots and careful
 * players ignored them (27% in the duel sim). They now also bend the actual shot.
 */
export const SLOW_POWER_MUL_TURN = 0.93;
export const SLOW_POWER_MUL_LIVE = 0.9;
export const BLIND_POWER_JITTER: [number, number] = [3, 8];
/** 🐌 / 🕶️ land half the time, like 😵. */
export const SLOW_BLIND_CHANCE = 0.5;

export function weaponElements(stats: Pick<WeaponStats, "element" | "element2">): Element[] {
  return stats.element2 && stats.element2 !== stats.element ? [stats.element, stats.element2] : [stats.element];
}

/** Statuses one hit inflicts. `roll` is a 0..1 random number (seeded in stop mode). */
export function statusesForHit(stats: Pick<WeaponStats, "element" | "element2">, roll: number): StatusId[] {
  const out: StatusId[] = [];
  // Independent-looking secondary rolls derived from the one seeded roll (keeps stop mode deterministic).
  const roll2 = (roll * 7.31 + 0.137) % 1;
  const roll3 = (roll * 13.7 + 0.519) % 1;
  const roll4 = (roll * 5.93 + 0.271) % 1;
  weaponElements(stats).forEach((el, i) => {
    if (i > 0 && roll2 >= SECOND_ELEMENT_CHANCE) return;
    const s = ELEMENT_STATUS[el];
    if (s === "stun" && roll >= STUN_CHANCE) return;
    if (s === "confuse" && roll3 >= CONFUSE_CHANCE) return;
    if ((s === "slow" || s === "blind") && roll4 >= SLOW_BLIND_CHANCE) return;
    if (s && !out.includes(s)) out.push(s);
    if (el === "shock" && roll < SHOCK_STUN_CHANCE && !out.includes("stun")) out.push("stun");
  });
  return out;
}

/** 🩷 Share of dealt damage healed: full as the main color, half as the second color. */
export function lifestealRate(stats: Pick<WeaponStats, "element" | "element2">): number {
  const els = weaponElements(stats);
  if (els[0] === "vampire") return LIFESTEAL;
  return els.includes("vampire") ? LIFESTEAL / 2 : 0;
}

export function activeStatuses(map: StatusMap | undefined): StatusId[] {
  if (!map) return [];
  return (Object.keys(map) as StatusId[]).filter((k) => (map[k] ?? 0) > 0);
}
