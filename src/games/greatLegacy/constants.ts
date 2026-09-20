import type { AssetDef, Denomination, GreatLegacyMode, Market, Purse, Sector, SpecialKind } from "./types";

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
 * Starting coin allotment (= 신용대출 한도) per mode. 4인은 룰북 §2-1 그대로
 * 140코인(20×2·10×5·5×8·1×10). 8인은 위대한유산 원작의 8인 리밸런싱안과 동일한
 * 비율(110코인, 20×2·10×3·5×6·1×10)로 확장한 하우스룰.
 */
export function startingPurse(mode: GreatLegacyMode): Purse {
  return mode === "4p" ? { 20: 2, 10: 5, 5: 8, 1: 10 } : { 20: 2, 10: 3, 5: 6, 1: 10 };
}

/**
 * The 18 asset cards (3대 시장 × 3대 섹터 × 2매), scores taken directly from
 * 룰북 §3-1 자산 카드 점수표 — identical for both 4인/8인 modes.
 */
export const ASSET_DEFS: AssetDef[] = [
  // 빅테크 & AI
  { id: "us-bigtech-1", market: "미장", sector: "빅테크&AI", name: "애플", baseScore: 3 },
  { id: "us-bigtech-2", market: "미장", sector: "빅테크&AI", name: "구글 알파벳", baseScore: 3 },
  { id: "kr-bigtech-1", market: "국장", sector: "빅테크&AI", name: "카카오", baseScore: 2 },
  { id: "kr-bigtech-2", market: "국장", sector: "빅테크&AI", name: "네이버", baseScore: 2 },
  { id: "cr-bigtech-1", market: "코인", sector: "빅테크&AI", name: "솔라나", baseScore: 2 },
  { id: "cr-bigtech-2", market: "코인", sector: "빅테크&AI", name: "리플", baseScore: 1 },

  // 블루칩 (우량주)
  { id: "us-bluechip-1", market: "미장", sector: "블루칩", name: "엔비디아", baseScore: 5 },
  { id: "us-bluechip-2", market: "미장", sector: "블루칩", name: "마이크로소프트", baseScore: 5 },
  { id: "kr-bluechip-1", market: "국장", sector: "블루칩", name: "삼성전자", baseScore: 4 },
  { id: "kr-bluechip-2", market: "국장", sector: "블루칩", name: "현대차", baseScore: 3 },
  { id: "cr-bluechip-1", market: "코인", sector: "블루칩", name: "비트코인", baseScore: 5 },
  { id: "cr-bluechip-2", market: "코인", sector: "블루칩", name: "이더리움", baseScore: 4 },

  // 광기의 밈 & 테마주
  { id: "us-meme-1", market: "미장", sector: "밈&테마주", name: "테슬라", baseScore: 3 },
  { id: "us-meme-2", market: "미장", sector: "밈&테마주", name: "게임스탑", baseScore: 1 },
  { id: "kr-meme-1", market: "국장", sector: "밈&테마주", name: "초전도체 테마주", baseScore: 4 },
  { id: "kr-meme-2", market: "국장", sector: "밈&테마주", name: "정치인 테마주", baseScore: 4 },
  { id: "cr-meme-1", market: "코인", sector: "밈&테마주", name: "도지코인", baseScore: 3 },
  { id: "cr-meme-2", market: "코인", sector: "밈&테마주", name: "페페 코인", baseScore: 3 },
];

export const MARKETS: Market[] = ["미장", "국장", "코인"];
export const SECTORS: Sector[] = ["빅테크&AI", "블루칩", "밈&테마주"];

/**
 * Special (이벤트) card counts per mode. 4인은 룰북 §4 그대로: 초대형호재2 ·
 * 악재/어닝쇼크2 · 상장폐지2 · 강제반대매매1 (총 7장). 8인은 위대한유산
 * 원작 8인안(재평가3·평가절하3·가품4)과 동일 비율로 확장 — 상장폐지·
 * 강제반대매매를 합쳐 원작 "가품판정 4"에 대응시킴.
 */
export const SPECIAL_CARD_COUNTS: Record<GreatLegacyMode, Record<SpecialKind, number>> = {
  "4p": { 초대형호재: 2, 악재어닝쇼크: 2, 상장폐지: 2, 강제반대매매: 1 },
  "8p": { 초대형호재: 3, 악재어닝쇼크: 3, 상장폐지: 3, 강제반대매매: 1 },
};

/** 4인은 룰북 §6 그대로 25장 중 3장 제외 → 22장 진행. 8인도 동일 비율(3/28 ≈ 위대한유산 8인안)로 3장 제외. */
export const EXCLUDE_COUNT: Record<GreatLegacyMode, number> = { "4p": 3, "8p": 3 };

/**
 * 컬렉션 보너스 — "영끌 올인"(시장 컬렉션) / "테마 분산투자"(섹터 컬렉션)
 * 각각 +3점 (룰북 §5).
 */
export const COLLECTION_BONUS = 3;

export function countAuctionCards(mode: GreatLegacyMode): number {
  const specials = SPECIAL_CARD_COUNTS[mode];
  return ASSET_DEFS.length + specials.초대형호재 + specials.악재어닝쇼크 + specials.상장폐지 + specials.강제반대매매;
}
