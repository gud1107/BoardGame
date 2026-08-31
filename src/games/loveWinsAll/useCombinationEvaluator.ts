"use client";

import { useMemo } from "react";
import { evaluateHand, handTier, HAND_CATEGORY_LABEL, type HandCategory, type HandTier, type Suit, type Variant } from "./cards";

/**
 * Request's "손패/필드 카드 상태가 변경될 때마다 룰북 규칙에 따른 최고 등급
 * 족보를 산출하는 순수 함수 연동" — a thin `useMemo` wrapper around `cards.ts`'s
 * already-existing pure `evaluateHand`/`handTier` (no new evaluation logic:
 * this game's hand ranking was fully implemented in the 2026-08-30 rebuild,
 * see that file's module doc). Only ever call this with a seat's *own*
 * fully-known hand — never the opponent's, whose true suits are hidden
 * until showdown (info-fairness convention used throughout this engine).
 *
 * lwa2 hands are 4 cards (3 private + 1 shared community); base hands are 3
 * private cards with no community — the caller passes `community` as `null`
 * for base and this hook merges it in for lwa2, mirroring the exact merge
 * `engine.ts`'s `resolveShowdown`/`ownHandStrength` already perform.
 */
export interface LiveCombination {
  category: HandCategory;
  label: string;
  tier: HandTier;
}

export function useCombinationEvaluator(hand: Suit[], community: Suit | null, variant: Variant): LiveCombination {
  return useMemo(() => {
    const cards = variant === "lwa2" && community ? [...hand, community] : hand;
    const { category } = evaluateHand(cards, variant);
    return { category, label: HAND_CATEGORY_LABEL[category], tier: handTier(category, variant) };
    // `hand` is a fresh array from engine state each time a card is dealt/reshuffled (never mutated in place), so reference equality is a safe, cheap change signal.
  }, [hand, community, variant]);
}
