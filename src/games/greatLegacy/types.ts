/**
 * Type contracts for 위대한 유산 (The Great Legacy) — a psychological auction
 * game (하이 소사이어티 motif) where players bid coins to win relic cards and
 * "penalty" special cards that flip the auction upside down. See
 * `boardGameRule/위대한유산/위대한유산4인.md` / `위대한유산8인.md` for the
 * source rulebook and HANDOFF.md for the confirmed design decisions this
 * implementation is built from (every ambiguous point was asked, not
 * assumed — see that session's entries).
 */

export type SeatIndex = number;

export type Country = "한국" | "이집트" | "프랑스";
export type Format = "그림" | "조각공예" | "건축물";

export type SpecialKind = "재평가" | "평가절하" | "가품판정";

/** "4p" = 원작 4인 규칙 그대로. "8p" = 문서 8인안 ③(단일테이블 완전 리밸런싱), 국가/유물카드는 원작 18장 그대로 유지하고 자금·특수카드·제외매수만 조정 — 확정 내역은 HANDOFF.md 참고. */
export type GreatLegacyMode = "4p" | "8p";

/** 방장이 방 생성 시 고르는 턴 제한시간 — 없음 / 15초 / 30초. */
export type TimeLimitMode = "none" | "15s" | "30s";

/** no-thanks의 ChipVisibility와 동일한 컨벤션 — 방장이 코인 보유 현황 공개/비공개를 선택. */
export type CoinVisibility = "secret" | "public";

export interface RelicDef {
  id: string;
  country: Country;
  format: Format;
  name: string;
  baseScore: number;
}

export type AuctionCardDef =
  | { kind: "relic"; cardId: string; relic: RelicDef }
  | { kind: "special"; cardId: string; special: SpecialKind };

/** Coin denominations actually printed for this game — see constants.ts for per-mode counts. */
export type Denomination = 20 | 10 | 5 | 1;

/** A coin purse (or a partial "coins to add" amount), keyed by denomination -> count of that coin. Always non-negative integers. */
export type Purse = Record<Denomination, number>;

export interface OwnedRelic {
  relicId: string;
  country: Country;
  format: Format;
  baseScore: number;
  /** baseScore, possibly overwritten by a 재평가(→5)/평가절하(→1) special applied to this exact relic. Meaningless once `discarded`. */
  currentScore: number;
  /** true once a 가품 판정 special discarded this relic — excluded from scoring/collections but kept in the array for history/UI. */
  discarded: boolean;
}

export interface PlayerState {
  seat: SeatIndex;
  /** Coins NOT currently committed to the live auction. */
  purse: Purse;
  /** In acquisition order — the last entry is this player's "직전 획득 유물" special-card target. */
  relics: OwnedRelic[];
  /**
   * FIFO queue of specials won while this player owned zero (non-discarded
   * bookkeeping aside — see engine.ts) relics, per the confirmed rule:
   * "특수카드를 유물 없이 낙찰받으면 순서대로 유물카드 획득 시에 적용됩니다"
   * — each queued special consumes exactly one future relic acquisition, in
   * the order it was queued (not all stacked onto the very next relic).
   */
  pendingSpecials: SpecialKind[];
}

export type AuctionKind = "normal" | "reverse";

export interface AuctionState {
  card: AuctionCardDef;
  kind: AuctionKind;
  /** Full seat rotation for this auction, starting from the opening bidder. */
  order: SeatIndex[];
  activeSeat: SeatIndex;
  /** Current highest cumulative bid total (coin face value), 0 before anyone has bid. */
  highestBid: number;
  highestBidder: SeatIndex | null;
  /** Coins each seat has committed so far this auction (cumulative, never decreases except on a normal-auction refund at pass). */
  committed: Partial<Record<SeatIndex, Purse>>;
  /** Seats that have already passed out of this auction (normal auctions only — a reverse auction's first pass ends it outright, see engine.ts). */
  passed: SeatIndex[];
}

export type Phase = "playing" | "gameOver";

export interface GreatLegacyState {
  mode: GreatLegacyMode;
  players: PlayerState[];
  /** Remaining, not-yet-auctioned cards, in draw order. */
  deck: AuctionCardDef[];
  /** The 3 cards randomly excluded at setup — never dealt, kept for tests/debugging (per the rulebook, nobody in-game ever learns these). */
  excludedCards: AuctionCardDef[];
  /** null only right after `phase` flips to "gameOver" (the last auction has just resolved and there is no next card). */
  auction: AuctionState | null;
  phase: Phase;
  timeLimitMode: TimeLimitMode;
  coinVisibility: CoinVisibility;
  /** Seat that will open the *next* auction — the previous auction's winner, or a random seat before the very first auction (confirmed: "선플레이어는 랜덤으로"). */
  nextOpenerSeat: SeatIndex;
}

export type EngineAction =
  | { type: "bid"; seat: SeatIndex; addCoins: Purse }
  | { type: "pass"; seat: SeatIndex };
