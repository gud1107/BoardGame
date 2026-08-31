/**
 * Card/deck/hand-ranking data for "러브 윈즈 올" (Love Wins All) — pure data +
 * pure functions, no engine state. Split out from `engine.ts` per
 * ARCHITECTURE.md §2's "선택, 게임별로 필요할 때만 추가" `cards.ts` slot (see
 * `century`/`splendor` precedent) purely because the two variants' hand-rank
 * tables and comparators are sizable enough to want their own file — this is
 * not a "types.ts" in the sense the request assumed (this repo's real
 * convention keeps engine state/action types inside `engine.ts` itself, see
 * that file's module doc).
 *
 * Source of truth: `boardGameRule/러브윈즈올/러브윈즈올.md`. Two rulesets:
 *  - `"base"` — the document's main body (A~K): 30-card deck, 3-card private
 *    hands, 6-tier hand ranking, no community card, no Liar card.
 *  - `"lwa2"` — the appendix "러브 윈즈 올 2" (시즌2 개선판, L~Z): 49-card deck
 *    (adds a 1-of-a-kind Liar wildcard), 1 shared community card + 3 private
 *    cards per seat (4-card hands, Texas-hold'em-style), 9-tier hand ranking.
 *
 * `"lwa2"` is a **host-selectable variant**, not the default — see
 * `engine.ts`'s module doc for the confirmed decision. Because the appendix
 * itself only lists "주요 변경점" (headline diffs) and never restates a full
 * tie-break table the way the base body's §D does, every lwa2 tie-break rule
 * below marked "documented extension" is this session's own consistent,
 * conservative generalization of §D's own logic (RPS-compare the decisive
 * symbol(s), fall back to a full tie otherwise) — not a re-guess of something
 * the base rulebook actually specifies.
 */

export type Variant = "base" | "lwa2";

/** 가위/바위/보 + 러브, plus lwa2's 1-of-a-kind 라이어 wildcard. */
export type Suit = "scissors" | "rock" | "paper" | "love" | "liar";

export const STARTING_CHIPS: Record<Variant, number> = { base: 25, lwa2: 35 };

/** §F.2 / appendix (silent, carries over unchanged — "부록은 변경점만 정리"): both seats post 1 chip before every round, both variants. */
export const ANTE = 1;

/** Appendix "라이어 카드로 승부에서 패배하면 상대에게 칩 5개를 추가로 지불" — lwa2 only. */
export const LIAR_PENALTY = 5;

export const PRIVATE_HAND_SIZE = 3; // both variants deal 3 private cards per seat
/** lwa2 only — §"카드 분배 방식 변경": 1 shared card (public) + 3 private = 4-card hands. */
export const COMMUNITY_CARDS = { base: 0, lwa2: 1 } as const;

/** §B (base, 30장) / appendix "카드 구성 변경" (lwa2, 49장). */
export function buildDeck(variant: Variant): Suit[] {
  const deck: Suit[] = [];
  const counts: Record<Suit, number> =
    variant === "base"
      ? { scissors: 12, rock: 7, paper: 7, love: 4, liar: 0 }
      : { scissors: 18, rock: 12, paper: 12, love: 6, liar: 1 };
  for (const suit of Object.keys(counts) as Suit[]) {
    for (let i = 0; i < counts[suit]; i++) deck.push(suit);
  }
  return deck;
}

/** Cards needed to deal one round: both private hands, plus lwa2's community card. */
export function cardsPerRound(variant: Variant): number {
  return PRIVATE_HAND_SIZE * 2 + COMMUNITY_CARDS[variant];
}

// ---------------------------------------------------------------------------
// Hand ranking — lower `rank` number always beats higher (§C / appendix table).
// ---------------------------------------------------------------------------

export type BaseHandCategory = "loveWinsAll" | "triple" | "twoLove" | "mix" | "double" | "oneLove";
export type Lwa2HandCategory =
  | "loveWinsAll"
  | "threeLove"
  | "fourCard"
  | "mix"
  | "twoLove"
  | "twoPair"
  | "triple"
  | "onePair"
  | "oneLove";
export type HandCategory = BaseHandCategory | Lwa2HandCategory;

export const BASE_HAND_RANK: Record<BaseHandCategory, number> = {
  loveWinsAll: 1,
  triple: 2,
  twoLove: 3,
  mix: 4,
  double: 5,
  oneLove: 6,
};

export const LWA2_HAND_RANK: Record<Lwa2HandCategory, number> = {
  loveWinsAll: 1,
  threeLove: 2,
  fourCard: 3,
  mix: 4,
  twoLove: 5,
  twoPair: 6,
  triple: 7,
  onePair: 8,
  oneLove: 9,
};

export function handRankNumber(category: HandCategory, variant: Variant): number {
  return variant === "base" ? BASE_HAND_RANK[category as BaseHandCategory] : LWA2_HAND_RANK[category as Lwa2HandCategory];
}

/** Every declarable label for a variant, in rank order (best first) — feeds the §4/§H bluffable "족보 선언" UI picker and `chooseBotAction`. */
export function declarableHands(variant: Variant): HandCategory[] {
  const table = variant === "base" ? BASE_HAND_RANK : LWA2_HAND_RANK;
  return (Object.keys(table) as HandCategory[]).sort((a, b) => table[a as never] - table[b as never]);
}

/** RPS beats-relation: `a` beats `b`. */
function beats(a: Suit, b: Suit): boolean {
  return (a === "scissors" && b === "paper") || (a === "paper" && b === "rock") || (a === "rock" && b === "scissors");
}

/** -1 if `a` wins the RPS matchup, 1 if `b` wins, 0 if identical symbol (no comparator — real tie). Only ever called on non-love, non-liar symbols. */
function compareRps(a: Suit, b: Suit): number {
  if (a === b) return 0;
  return beats(a, b) ? -1 : 1;
}

export interface EvaluatedHand {
  category: HandCategory;
  rank: number; // lower wins
  /** Present only when this hand's category was reached by substituting the Liar wildcard for its best symbol (lwa2 only) — drives the appendix's "라이어 카드로 패배 시 페널티 + 동률 시 항상 패배" rule (applied by the engine's showdown resolver, not here). */
  hasLiar: boolean;
  /** Category-specific comparator payload — see `compareEvaluated`. */
  tiebreak: Suit[];
}

function countBy<T extends string>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
}

/** §C — base variant's exhaustive 3-card classification (see module doc: love-count decides the category outright for 1–3 love cards; a 0-love hand's 3 non-love symbols are always either all-same/all-different/2+1, which exhaustively cover triple/mix/double). */
function classifyBase(cards: Suit[]): { category: BaseHandCategory; tiebreak: Suit[] } {
  const loveCount = cards.filter((c) => c === "love").length;
  if (loveCount === 3) return { category: "loveWinsAll", tiebreak: [] };
  if (loveCount === 2) {
    const rest = cards.find((c) => c !== "love")!;
    return { category: "twoLove", tiebreak: [rest] };
  }
  if (loveCount === 1) return { category: "oneLove", tiebreak: [] }; // §D: 원 러브끼리는 항상 즉시 무승부 — the other two cards never matter.

  const counts = countBy(cards);
  if (counts.size === 1) return { category: "triple", tiebreak: [cards[0]] };
  if (counts.size === 3) return { category: "mix", tiebreak: [] }; // always scissors+rock+paper — no distinguishing card between two mix hands (documented extension of §D, see module doc)
  const pairSuit = [...counts.entries()].find(([, n]) => n === 2)![0];
  return { category: "double", tiebreak: [pairSuit] };
}

/** Appendix's 4-card classification (see module doc for the priority order this session derived: love-count decides 2–4-love hands outright; a 1-love hand is the specific "mix" pattern if its other 3 cards are exactly one each of scissors/rock/paper, else the generic "oneLove" catch-all; a 0-love hand's 4 non-love symbols are always one of fourCard/twoPair/triple/onePair by pigeonhole.) */
function classifyLwa2(cards: Suit[]): { category: Lwa2HandCategory; tiebreak: Suit[] } {
  const loveCount = cards.filter((c) => c === "love").length;
  if (loveCount === 4) return { category: "loveWinsAll", tiebreak: [] };
  if (loveCount === 3) return { category: "threeLove", tiebreak: [] };
  if (loveCount === 2) return { category: "twoLove", tiebreak: [] }; // documented extension: no comparator specified by the appendix — always a full tie between two twoLove hands, same conservative treatment as base's oneLove.
  if (loveCount === 1) {
    const rest = cards.filter((c) => c !== "love");
    const restCounts = countBy(rest);
    if (restCounts.size === 3) return { category: "mix", tiebreak: [] }; // love + one each of scissors/rock/paper
    return { category: "oneLove", tiebreak: [] };
  }

  // loveCount === 0: 4 cards from {scissors, rock, paper} — pigeonhole guarantees one of these shapes.
  const counts = countBy(cards);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (entries[0][1] === 4) return { category: "fourCard", tiebreak: [entries[0][0]] };
  if (entries[0][1] === 3) {
    const kicker = entries[1][0];
    return { category: "triple", tiebreak: [entries[0][0], kicker] };
  }
  if (entries[0][1] === 2 && entries[1][1] === 2) {
    // Higher pair by RPS dominance isn't well-defined transitively (rock<paper<scissors<rock cyclically), so order the two pair symbols by their own §D-style RPS matchup for a stable tiebreak vector.
    const [x, y] = [entries[0][0], entries[1][0]];
    const ordered = compareRps(x, y) <= 0 ? [x, y] : [y, x];
    return { category: "twoPair", tiebreak: ordered };
  }
  // entries[0][1] === 2, rest singles
  return { category: "onePair", tiebreak: [entries[0][0]] };
}

/** Liar-as-wildcard resolution (lwa2 only, appendix "원하는 어떤 조합으로든 자유롭게 선언할 수 있는 조커") — tries every real-symbol substitution and keeps whichever yields the single best (lowest-rank) category. */
function evaluateLwa2WithLiar(cards: Suit[]): EvaluatedHand {
  const liarIdx = cards.indexOf("liar");
  if (liarIdx === -1) {
    const { category, tiebreak } = classifyLwa2(cards);
    return { category, rank: LWA2_HAND_RANK[category], hasLiar: false, tiebreak };
  }
  const candidates: Suit[] = ["love", "scissors", "rock", "paper"];
  let best: { category: Lwa2HandCategory; tiebreak: Suit[] } | null = null;
  for (const sub of candidates) {
    const trial = [...cards];
    trial[liarIdx] = sub;
    const result = classifyLwa2(trial);
    if (!best || LWA2_HAND_RANK[result.category] < LWA2_HAND_RANK[best.category]) best = result;
  }
  return { category: best!.category, rank: LWA2_HAND_RANK[best!.category], hasLiar: true, tiebreak: best!.tiebreak };
}

/** `cards` must be exactly 3 (base) or 4 (lwa2, private+community already merged by the caller). */
export function evaluateHand(cards: Suit[], variant: Variant): EvaluatedHand {
  if (variant === "base") {
    const { category, tiebreak } = classifyBase(cards);
    return { category, rank: BASE_HAND_RANK[category], hasLiar: false, tiebreak };
  }
  return evaluateLwa2WithLiar(cards);
}

/**
 * -1 if `a` wins, 1 if `b` wins, 0 if a genuine tie (§G: pot carries to the
 * next round) once every stated/documented-extension tiebreak is exhausted.
 * Does NOT apply the appendix's "라이어 카드는 동률이어도 패배" override — that's
 * a match-outcome rule, not a symbol comparison, and is applied by the
 * engine's showdown resolver using `hasLiar` instead.
 */
export function compareEvaluated(a: EvaluatedHand, b: EvaluatedHand): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const x = a.tiebreak[i];
    const y = b.tiebreak[i];
    if (x === undefined || y === undefined) break;
    const cmp = compareRps(x, y);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export const SUIT_EMOJI: Record<Suit, string> = {
  scissors: "✌️",
  rock: "✊",
  paper: "✋",
  love: "💗",
  liar: "🃏",
};

export const SUIT_LABEL: Record<Suit, string> = {
  scissors: "가위",
  rock: "바위",
  paper: "보",
  love: "러브",
  liar: "라이어",
};

export const HAND_CATEGORY_LABEL: Record<HandCategory, string> = {
  loveWinsAll: "러브 윈즈 올",
  threeLove: "쓰리 러브",
  fourCard: "포카드",
  triple: "트리플",
  twoLove: "투 러브",
  mix: "믹스",
  twoPair: "투페어",
  double: "더블",
  onePair: "원페어",
  oneLove: "원 러브",
};

// ---------------------------------------------------------------------------
// Hand tier (실시간 족보 뱃지 강조 등급) — 일반/레어/전설 3단계로 압축한 시각적
// 분류. 룰북엔 "등급"이라는 개념 자체가 없어(§C/부록은 순위 1~n만 규정) 이 세
// 구간 경계는 이번 세션에서 AskUserQuestion으로 확정한 하우스 프리젠테이션
// 규칙: 전설=러브 윈즈 올(각 변형의 1위)만, 레어=나머지 중 순위 상위 절반,
// 일반=그 아래 절반. 게임 판정(승패/베팅)에는 전혀 관여하지 않는 순수 표시용
// 분류라 `compareEvaluated`/엔진 로직과 완전히 분리되어 있다.
// ---------------------------------------------------------------------------

export type HandTier = "common" | "rare" | "legendary";

export const BASE_HAND_TIER: Record<BaseHandCategory, HandTier> = {
  loveWinsAll: "legendary",
  triple: "rare",
  twoLove: "rare",
  mix: "common",
  double: "common",
  oneLove: "common",
};

export const LWA2_HAND_TIER: Record<Lwa2HandCategory, HandTier> = {
  loveWinsAll: "legendary",
  threeLove: "rare",
  fourCard: "rare",
  mix: "rare",
  twoLove: "rare",
  twoPair: "common",
  triple: "common",
  onePair: "common",
  oneLove: "common",
};

const HAND_TIER_RANK: Record<HandTier, number> = { legendary: 0, rare: 1, common: 2 };

/** Lower is "better" (legendary < rare < common) — lets a caller detect a tier *upgrade* via a plain `<` comparison. */
export function handTierRank(tier: HandTier): number {
  return HAND_TIER_RANK[tier];
}

export function handTier(category: HandCategory, variant: Variant): HandTier {
  return variant === "base" ? BASE_HAND_TIER[category as BaseHandCategory] : LWA2_HAND_TIER[category as Lwa2HandCategory];
}
