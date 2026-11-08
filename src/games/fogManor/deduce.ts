import { CARD_COUNT, CATEGORIES, cardsOf, matchesTrait, type Category } from "./data";
import type { GameState, Guess, Seat } from "./engine";

/**
 * 추리 엔진 (규칙서 §12) — 한 좌석의 보기(`fogView`)만으로 카드마다 "주인 후보"를 좁힌다.
 * 후보는 비트 마스크: 비트 s = 탐정 s, 비트 n = 봉투(정답), 비트 n+1 = 🗄️ 금고(금고가 있을 때만).
 * 공개 카드는 아무 후보도 없음(0).
 *
 * 제약(레벨에 따라 일부만 쓴다): 내 손패 · 공개 카드 · 내가 본 카드 · 내 단서(특징·알리바이) ·
 * 공개 심문 장수(정확히 k장) · 손패 장수 · 종류마다 봉투엔 정확히 1장 · 틀린 고발 조합.
 * 고정점까지 전파한다. 모순이 나오면(정보를 일부러 버린 낮은 레벨에선 생기지 않음) 그 칸은 그대로 둔다.
 */

export interface DeduceOptions {
  /** 공개 심문 장수 제약 */
  counts: boolean;
  /** 장수 제약을 끝까지(고정점) — false면 "0장"만 쓴다 */
  fullCounts: boolean;
  /** 손패 장수 제약 */
  handSizes: boolean;
  /** 틀린 고발 조합 */
  wrongAccusations: boolean;
  /** 0~1: 내가 본 카드 기억을 이 비율만큼 잊는다 (결정론 해시) */
  forget: number;
}

export const FULL_DEDUCE: DeduceOptions = { counts: true, fullCounts: true, handSizes: true, wrongAccusations: true, forget: 0 };

export interface Knowledge {
  /** 카드별 주인 후보 마스크 */
  dom: number[];
  sol: number;
  /** 금고 비트 (금고가 없으면 0) */
  vault: number;
  /** 종류별 정답 후보 카드 */
  candidates: Record<Category, number[]>;
  /** 후보 조합 수 */
  combos: number;
  /** 확정이면 그 조합 */
  solved: Guess | null;
}

const popcount = (x: number) => {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
};

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function deduce(view: GameState, me: Seat, opts: DeduceOptions = FULL_DEDUCE): Knowledge {
  const n = view.seatCount;
  const SOL = 1 << n;
  const VAULT = view.vaultCount > 0 ? 1 << (n + 1) : 0;
  const ALL = ((1 << (n + 1)) - 1) | VAULT;
  const dom: number[] = Array(CARD_COUNT).fill(ALL & ~(1 << me));
  const pub = new Set(view.publicCards);
  for (const c of pub) dom[c] = 0;
  for (const c of view.hands[me] ?? []) dom[c] = 1 << me;

  // 내 단서
  for (const clue of view.clues[me] ?? []) {
    if (clue.kind === "alibi") dom[clue.card] &= ~SOL;
    else for (const c of cardsOf(clue.trait.cat)) if (!matchesTrait(c, clue.trait)) dom[c] &= ~SOL;
  }

  type CountC = { t: Seat; cards: number[]; k: number };
  const counts: CountC[] = [];
  const wrongs: number[][] = [];
  view.log.forEach((e, i) => {
    if (e.kind === "ask") {
      if (e.seat === me && e.shown !== null && e.shown >= 0 && !(opts.forget > 0 && hash01(me * 131 + i, e.shown) < opts.forget)) {
        dom[e.shown] = dom[e.shown] & (1 << e.target) ? 1 << e.target : dom[e.shown];
      }
      if (opts.counts && e.target !== me) counts.push({ t: e.target, cards: e.cards.filter((c) => !pub.has(c)), k: e.count });
    } else if (e.kind === "accuse" && !e.correct && opts.wrongAccusations) {
      wrongs.push([e.guess.suspect, e.guess.weapon, e.guess.room]);
    }
  });

  const fix = (c: number, mask: number): boolean => {
    const next = dom[c] & mask;
    if (next === dom[c] || next === 0) return false;
    dom[c] = next;
    return true;
  };

  for (let iter = 0; iter < 60; iter++) {
    let changed = false;
    // 종류마다 봉투엔 정확히 1장
    for (const cat of CATEGORIES) {
      const cs = cardsOf(cat);
      const solPossible = cs.filter((c) => dom[c] & SOL);
      if (solPossible.length === 1) changed = fix(solPossible[0], SOL) || changed;
      const solFixed = cs.filter((c) => dom[c] === SOL);
      if (solFixed.length === 1) for (const c of cs) if (c !== solFixed[0]) changed = fix(c, ~SOL) || changed;
    }
    // 공개 심문 장수
    for (const { t, cards, k } of counts) {
      const bit = 1 << t;
      if (!opts.fullCounts) {
        if (k === 0) for (const c of cards) changed = fix(c, ~bit) || changed;
        continue;
      }
      const fixed = cards.filter((c) => dom[c] === bit).length;
      const poss = cards.filter((c) => dom[c] !== bit && dom[c] & bit);
      if (fixed === k) for (const c of poss) changed = fix(c, ~bit) || changed;
      else if (fixed + poss.length === k) for (const c of poss) changed = fix(c, bit) || changed;
    }
    // 손패 장수
    if (opts.handSizes) {
      for (let p = 0; p <= n + 1; p++) {
        if (p === me || p === n || (p === n + 1 && !VAULT)) continue;
        const bit = 1 << p;
        const size = p === n + 1 ? view.vaultCount : view.handCount[p];
        const fixed: number[] = [];
        const poss: number[] = [];
        for (let c = 0; c < CARD_COUNT; c++) {
          if (dom[c] === bit) fixed.push(c);
          else if (dom[c] & bit) poss.push(c);
        }
        if (fixed.length === size) for (const c of poss) changed = fix(c, ~bit) || changed;
        else if (fixed.length + poss.length === size) for (const c of poss) changed = fix(c, bit) || changed;
      }
    }
    // 틀린 고발: 셋 다 정답일 순 없다
    for (const g of wrongs) {
      const solFixed = g.filter((c) => dom[c] === SOL).length;
      if (solFixed === 2) for (const c of g) if (dom[c] !== SOL) changed = fix(c, ~SOL) || changed;
    }
    if (!changed) break;
  }

  const candidates = Object.fromEntries(CATEGORIES.map((cat) => [cat, cardsOf(cat).filter((c) => dom[c] & SOL)])) as Record<Category, number[]>;
  // 정보를 버린 레벨에서 후보가 0이 되는 일은 없지만, 혹시 몰라 빈 종류는 공개·내 카드 빼고 전부로
  for (const cat of CATEGORIES) if (candidates[cat].length === 0) candidates[cat] = cardsOf(cat).filter((c) => !pub.has(c) && !(view.hands[me] ?? []).includes(c));
  const combos = candidates.suspect.length * candidates.weapon.length * candidates.room.length;
  const solved = combos === 1 ? { suspect: candidates.suspect[0], weapon: candidates.weapon[0], room: candidates.room[0] } : null;
  return { dom, sol: SOL, vault: VAULT, candidates, combos, solved };
}

/** 카드가 정답일 듯한 정도 (후보 주인이 적을수록 높다) */
export function solLikelihood(k: Knowledge, card: number): number {
  if (!(k.dom[card] & k.sol)) return 0;
  return 1 / popcount(k.dom[card]);
}

/** 각 종류에서 가장 그럴듯한 후보 */
export function bestGuess(k: Knowledge, rng: () => number = Math.random): Guess {
  const pick = (cat: Category) => {
    const cs = k.candidates[cat];
    let best = cs[0];
    let bestScore = -1;
    for (const c of cs) {
      const s = solLikelihood(k, c) + rng() * 0.01;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  };
  return { suspect: pick("suspect"), weapon: pick("weapon"), room: pick("room") };
}

/** 이 카드의 주인이 아직 불확실한가 */
export function uncertain(k: Knowledge, card: number): boolean {
  return popcount(k.dom[card]) > 1;
}

export { popcount };
