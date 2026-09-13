import type { Country, Denomination, Format, GreatLegacyMode, Purse, RelicDef, SpecialKind } from "./types";

export const MIN_PLAYERS: Record<GreatLegacyMode, number> = { "4p": 4, "8p": 8 };
export const MAX_PLAYERS: Record<GreatLegacyMode, number> = { "4p": 4, "8p": 8 };

export const DENOMINATIONS: Denomination[] = [20, 10, 5, 1];

export function emptyPurse(): Purse {
  return { 20: 0, 10: 0, 5: 0, 1: 0 };
}

export function purseValue(purse: Purse): number {
  return 20 * purse[20] + 10 * purse[10] + 5 * purse[5] + 1 * purse[1];
}

export function purseCoinCount(purse: Purse): number {
  return purse[20] + purse[10] + purse[5] + purse[1];
}

export function addPurses(a: Purse, b: Purse): Purse {
  return { 20: a[20] + b[20], 10: a[10] + b[10], 5: a[5] + b[5], 1: a[1] + b[1] };
}

export function subtractPurses(a: Purse, b: Purse): Purse {
  return { 20: a[20] - b[20], 10: a[10] - b[10], 5: a[5] - b[5], 1: a[1] - b[1] };
}

/** Every denomination in `sub` is <= the matching denomination in `purse`. */
export function purseContains(purse: Purse, sub: Purse): boolean {
  return DENOMINATIONS.every((d) => purse[d] >= sub[d]);
}

/**
 * Starting coin allotment per mode (rulebook §B-1 for 4인; §L-2 방안③ for
 * 8인 — 자금 110코인/코인 구성 20×2·10×3·5×6·1×10, confirmed).
 */
export function startingPurse(mode: GreatLegacyMode): Purse {
  return mode === "4p" ? { 20: 2, 10: 5, 5: 8, 1: 10 } : { 20: 2, 10: 3, 5: 6, 1: 10 };
}

/**
 * The 18 relic cards (국가 3종 × 형식 3종 × 2매), names/scores taken directly
 * from `boardGameRule/위대한유산/카드구성.png` — identical for both 4인/8인
 * modes (confirmed: 8인 모드도 국가를 4개로 늘리지 않고 원작 18장을 그대로 씀).
 */
export const RELIC_DEFS: RelicDef[] = [
  { id: "kr-painting-1", country: "한국", format: "그림", name: "씨름도", baseScore: 1 },
  { id: "kr-painting-2", country: "한국", format: "그림", name: "까치호랑이", baseScore: 2 },
  { id: "kr-sculpture-1", country: "한국", format: "조각공예", name: "금동 반가사유상", baseScore: 3 },
  { id: "kr-sculpture-2", country: "한국", format: "조각공예", name: "고려청자", baseScore: 4 },
  { id: "kr-architecture-1", country: "한국", format: "건축물", name: "광화문", baseScore: 5 },
  { id: "kr-architecture-2", country: "한국", format: "건축물", name: "경복궁", baseScore: 5 },

  { id: "eg-painting-1", country: "이집트", format: "그림", name: "이집트 벽화(1)", baseScore: 4 },
  { id: "eg-painting-2", country: "이집트", format: "그림", name: "이집트 벽화(2)", baseScore: 5 },
  { id: "eg-sculpture-1", country: "이집트", format: "조각공예", name: "아메넴헤트 3세 동상", baseScore: 4 },
  { id: "eg-sculpture-2", country: "이집트", format: "조각공예", name: "투탕카멘", baseScore: 3 },
  { id: "eg-architecture-1", country: "이집트", format: "건축물", name: "피라미드", baseScore: 2 },
  { id: "eg-architecture-2", country: "이집트", format: "건축물", name: "룩소르 신전", baseScore: 1 },

  { id: "fr-painting-1", country: "프랑스", format: "그림", name: "별이 빛나는 밤에", baseScore: 3 },
  { id: "fr-painting-2", country: "프랑스", format: "그림", name: "모나리자", baseScore: 3 },
  { id: "fr-sculpture-1", country: "프랑스", format: "조각공예", name: "생각하는 사람", baseScore: 3 },
  { id: "fr-sculpture-2", country: "프랑스", format: "조각공예", name: "밀로의 비너스", baseScore: 3 },
  { id: "fr-architecture-1", country: "프랑스", format: "건축물", name: "에펠탑", baseScore: 3 },
  { id: "fr-architecture-2", country: "프랑스", format: "건축물", name: "노트르담 대성당", baseScore: 3 },
];

export const COUNTRIES: Country[] = ["한국", "이집트", "프랑스"];
export const FORMATS: Format[] = ["그림", "조각공예", "건축물"];

/**
 * Special card counts per mode (rulebook §D for 4인: 재평가2/평가절하2/가품3;
 * §L-2 방안③ for 8인: 재평가3/평가절하3/가품4 — the doubled relic-country
 * count that ③ originally paired this with was declined, but the special
 * card counts themselves were confirmed as-is).
 */
export const SPECIAL_CARD_COUNTS: Record<GreatLegacyMode, Record<SpecialKind, number>> = {
  "4p": { 재평가: 2, 평가절하: 2, 가품판정: 3 },
  "8p": { 재평가: 3, 평가절하: 3, 가품판정: 4 },
};

/**
 * Cards randomly excluded at setup, never dealt. 4인은 원작 그대로 3장
 * (25장 중 3장 제외 → 22장 사용). 8인은 유물 18장을 그대로 두고 특수카드만
 * 10장으로 늘려 총 28장이 되므로, 원작과 같은 제외 비율(3/25 ≈ 12%)을
 * 유지하는 "3장 제외 → 25장 사용" 안으로 확정(HANDOFF 참고).
 */
export const EXCLUDE_COUNT: Record<GreatLegacyMode, number> = { "4p": 3, "8p": 3 };

/**
 * 컬렉션 보너스 — 국가/작품 컬렉션 각각 +3점. 8인도 국가 수가 3개로 원작과
 * 동일하므로 조정하지 않고 그대로 유지 (확정 사항).
 */
export const COLLECTION_BONUS = 3;

export function countAuctionCards(mode: GreatLegacyMode): number {
  const specials = SPECIAL_CARD_COUNTS[mode];
  return RELIC_DEFS.length + specials.재평가 + specials.평가절하 + specials.가품판정;
}
