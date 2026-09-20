/**
 * Type contracts for 위대한 투자 (The Great Investment) — a psychological
 * auction game (하이 소사이어티 motif, re-themed from the "위대한 유산"
 * relic-auction engine into a stock/crypto portfolio auction) where players
 * leverage a credit-line purse to bid on asset cards and "이벤트" special
 * cards that flip the auction upside down. See
 * `boardGameRule/위대한유산/위대한유산변형_위대한투자.md` for the source
 * rulebook this implementation is built from.
 */

export type SeatIndex = number;

/** 3대 시장 — 미장(나스닥/뉴욕), 국장(코스피/코스닥), 코인(크립토). */
export type Market = "미장" | "국장" | "코인";
/** 3대 섹터 — 빅테크&AI(성장주), 블루칩(우량주), 밈&테마주(투기주). */
export type Sector = "빅테크&AI" | "블루칩" | "밈&테마주";

/**
 * 4종 특수(이벤트) 카드. 초대형호재는 일반 경매(재평가 → 5점), 나머지 셋은
 * 전부 역경매(먼저 포기한 사람이 떠안음) — 악재/어닝쇼크는 1점으로 평가절하,
 * 상장폐지·강제반대매매는 둘 다 영구 폐기로 효과는 동일하고 이름/매수만 다름
 * (상장폐지 2장, 강제반대매매 1장 — 원작 "가품판정 3장"을 테마상 두 카드로 쪼갠 것).
 */
export type SpecialKind = "초대형호재" | "악재어닝쇼크" | "상장폐지" | "강제반대매매";

/** "4p" = 원작 룰북 그대로(4인). "8p" = 위대한유산 8인 리밸런싱안과 동일한 비율로 확장한 다인전 변형. */
export type GreatLegacyMode = "4p" | "8p";

/** 방장이 방 생성 시 고르는 턴 제한시간 — 없음 / 15초 / 30초. */
export type TimeLimitMode = "none" | "15s" | "30s";

/** no-thanks의 ChipVisibility와 동일한 컨벤션 — 방장이 코인 보유 현황 공개/비공개를 선택. */
export type CoinVisibility = "secret" | "public";

export interface AssetDef {
  id: string;
  market: Market;
  sector: Sector;
  name: string;
  baseScore: number;
}

export type AuctionCardDef =
  | { kind: "asset"; cardId: string; asset: AssetDef }
  | { kind: "special"; cardId: string; special: SpecialKind };

/** Coin denominations actually printed for this game — see constants.ts for per-mode counts. */
export type Denomination = 20 | 10 | 5 | 1;

/** A coin purse (or a partial "coins to add" amount), keyed by denomination -> count of that coin. Always non-negative integers. */
export type Purse = Record<Denomination, number>;

export interface OwnedAsset {
  assetId: string;
  market: Market;
  sector: Sector;
  baseScore: number;
  /** baseScore, possibly overwritten by a 초대형호재(→5)/악재·어닝쇼크(→1) special applied to this exact asset. Meaningless once `discarded`. */
  currentScore: number;
  /** true once a 상장폐지/강제반대매매 special discarded this asset — excluded from scoring/collections but kept in the array for history/UI. */
  discarded: boolean;
}

export interface PlayerState {
  seat: SeatIndex;
  /** Coins NOT currently committed to the live auction. */
  purse: Purse;
  /** In acquisition order — the last entry is this player's "직전 획득 자산" special-card target. */
  assets: OwnedAsset[];
  /**
   * FIFO queue of specials won while this player owned zero (non-discarded
   * bookkeeping aside — see engine.ts) assets, per the confirmed rule:
   * "보유 자산이 없을 때 낙찰된 경우, 다음번에 최초로 낙찰받는 자산 카드에
   * 해당 효과가 즉시 발동" — each queued special consumes exactly one future
   * asset acquisition, in the order it was queued (not all stacked onto the
   * very next asset).
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
