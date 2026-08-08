/**
 * Card + resource data for "센추리: 향신료의 길" (Century: Spice Road). Pure
 * data module — no rules logic lives here, see engine.ts for that.
 *
 * Resource value order is taken from boardGameRuleBook/Century.md §4.1
 * (노란색 → 빨간색 → 초록색 → 갈색, i.e. yellow < red < green < brown). Note
 * this differs from the task brief's prose ("노란색 < 초록색 < 빨간색 < 갈색"),
 * which swaps red/green — the rulebook document is treated as authoritative
 * per this project's convention (boardGameRule/*.md is "the basis the engine
 * implements", see docs/architecture.md §5) and matches the real game's
 * published resource order, so that's what's implemented here.
 *
 * The 42 real Century merchant cards and 36 real point cards aren't
 * reproduced verbatim (no public machine-readable copy of the exact
 * official card list was available while building this) — the arrays below
 * are an original set designed to match the rulebook's card *shapes*
 * (production / upgrade / trade merchant cards; resource-cost point cards)
 * and its balance intent (increasing cost restriction, escalating point
 * value), not a reprint of the licensed game's specific card text/art.
 */

export type Resource = "yellow" | "red" | "green" | "brown";

/** Ascending value order — see module doc. */
export const RESOURCE_ORDER: Resource[] = ["yellow", "red", "green", "brown"];

export function resourceRank(r: Resource): number {
  return RESOURCE_ORDER.indexOf(r);
}

/** The next resource up the value chain, or null if `r` is already the top (brown). */
export function upgradeOf(r: Resource): Resource | null {
  const i = resourceRank(r);
  return i < RESOURCE_ORDER.length - 1 ? RESOURCE_ORDER[i + 1] : null;
}

/** A sparse resource multiset — missing keys mean 0. Used for both costs and gains. */
export type ResourceBundle = Partial<Record<Resource, number>>;

export type MerchantCardEffect =
  | { kind: "production"; gain: ResourceBundle }
  | { kind: "upgrade"; upgrades: number }
  | { kind: "trade"; cost: ResourceBundle; gain: ResourceBundle };

export interface MerchantCard {
  id: string;
  effect: MerchantCardEffect;
}

export interface PointCard {
  id: string;
  cost: ResourceBundle;
  points: number;
}

// ---------------------------------------------------------------------------
// Basic starting merchant cards (rulebook §3.2-3) — every player gets their
// own instance of both, dealt straight into `startGame()`'s starting hands
// and never mixed into the shuffled market deck below.
// ---------------------------------------------------------------------------

export function basicProductionCard(seat: number): MerchantCard {
  return { id: `basic-production-${seat}`, effect: { kind: "production", gain: { yellow: 2 } } };
}

export function basicUpgradeCard(seat: number): MerchantCard {
  return { id: `basic-upgrade-${seat}`, effect: { kind: "upgrade", upgrades: 2 } };
}

/** The two starting cards' effects, by shape rather than id — used to keep them out of `createMerchantDeck()`. */
const STARTER_MERCHANT_EFFECTS: MerchantCardEffect[] = [
  basicProductionCard(0).effect,
  basicUpgradeCard(0).effect,
];

/**
 * True if `effect` is identical (in kind + numbers, not id) to one of the
 * two starting cards. Every player already owns one of each starting card
 * from turn 1 (rulebook §3.2-3) — a market/deck card with the exact same
 * effect would look, to a player, like "my starting card came back", which
 * isn't how the physical game's 32-card deck works (those two cards are
 * printed on distinct card backs and never shuffled in). Compared
 * structurally rather than by id so this still catches a future edit to
 * `createMerchantDeck()` that accidentally reintroduces the same numbers
 * under a new id.
 */
function isStarterMerchantEffect(effect: MerchantCardEffect): boolean {
  return STARTER_MERCHANT_EFFECTS.some((starter) => {
    if (starter.kind !== effect.kind) return false;
    if (starter.kind === "production" && effect.kind === "production") {
      return RESOURCE_ORDER.every((r) => (starter.gain[r] ?? 0) === (effect.gain[r] ?? 0));
    }
    if (starter.kind === "upgrade" && effect.kind === "upgrade") {
      return starter.upgrades === effect.upgrades;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Merchant deck (rulebook §2/§3.1-4) — shuffled, 6 kept face-up. Filtered
// through `isStarterMerchantEffect` below so the market/draw deck can never
// contain a card duplicating either starting card's effect (see doc comment
// above) — two of the raw entries below (`merchant-u3`/`merchant-u4`, both
// "upgrade any resource twice") exactly match `basicUpgradeCard`'s effect
// and are dropped by that filter, leaving 30 cards in the actual deck.
// ---------------------------------------------------------------------------

export function createMerchantDeck(): MerchantCard[] {
  const cards: MerchantCard[] = [
    // Production
    { id: "merchant-p1", effect: { kind: "production", gain: { yellow: 3 } } },
    { id: "merchant-p2", effect: { kind: "production", gain: { yellow: 4 } } },
    { id: "merchant-p3", effect: { kind: "production", gain: { yellow: 2, red: 1 } } },
    { id: "merchant-p4", effect: { kind: "production", gain: { red: 2 } } },
    { id: "merchant-p5", effect: { kind: "production", gain: { yellow: 1, green: 1 } } },
    { id: "merchant-p6", effect: { kind: "production", gain: { green: 1 } } },
    { id: "merchant-p7", effect: { kind: "production", gain: { red: 1, green: 1 } } },
    { id: "merchant-p8", effect: { kind: "production", gain: { brown: 1 } } },
    { id: "merchant-p9", effect: { kind: "production", gain: { green: 1, brown: 1 } } },
    // Upgrade
    { id: "merchant-u1", effect: { kind: "upgrade", upgrades: 1 } },
    { id: "merchant-u2", effect: { kind: "upgrade", upgrades: 1 } },
    { id: "merchant-u3", effect: { kind: "upgrade", upgrades: 2 } },
    { id: "merchant-u4", effect: { kind: "upgrade", upgrades: 2 } },
    { id: "merchant-u5", effect: { kind: "upgrade", upgrades: 3 } },
    { id: "merchant-u6", effect: { kind: "upgrade", upgrades: 4 } },
    // Trade — yellow <-> red
    { id: "merchant-t1", effect: { kind: "trade", cost: { yellow: 2 }, gain: { red: 1 } } },
    { id: "merchant-t2", effect: { kind: "trade", cost: { yellow: 3 }, gain: { red: 2 } } },
    // Trade — yellow/red -> green
    { id: "merchant-t4", effect: { kind: "trade", cost: { yellow: 3 }, gain: { green: 1 } } },
    { id: "merchant-t5", effect: { kind: "trade", cost: { red: 2 }, gain: { green: 1 } } },
    { id: "merchant-t6", effect: { kind: "trade", cost: { yellow: 2, red: 1 }, gain: { green: 1 } } },
    { id: "merchant-t7", effect: { kind: "trade", cost: { red: 1 }, gain: { green: 1 } } },
    // Trade — up to brown
    { id: "merchant-t8", effect: { kind: "trade", cost: { green: 2 }, gain: { brown: 1 } } },
    { id: "merchant-t9", effect: { kind: "trade", cost: { yellow: 1, green: 1 }, gain: { brown: 1 } } },
    { id: "merchant-t10", effect: { kind: "trade", cost: { red: 1, green: 1 }, gain: { brown: 1 } } },
    { id: "merchant-t11", effect: { kind: "trade", cost: { yellow: 4 }, gain: { brown: 1 } } },
    { id: "merchant-t12", effect: { kind: "trade", cost: { green: 1 }, gain: { brown: 1 } } },
    // Multi-output trades (repeatable, matches rulebook's "6 yellow -> 3 green" example shape)
    { id: "merchant-t13", effect: { kind: "trade", cost: { yellow: 2 }, gain: { green: 1 } } },
    { id: "merchant-t14", effect: { kind: "trade", cost: { red: 1 }, gain: { yellow: 3 } } },
    { id: "merchant-t15", effect: { kind: "trade", cost: { yellow: 3, red: 1 }, gain: { brown: 1 } } },
    { id: "merchant-t16", effect: { kind: "trade", cost: { green: 1, brown: 1 }, gain: { yellow: 3, red: 3 } } },
    { id: "merchant-t17", effect: { kind: "trade", cost: { yellow: 5 }, gain: { green: 2 } } },
    { id: "merchant-t18", effect: { kind: "trade", cost: { red: 3 }, gain: { brown: 2 } } },
  ];
  return cards.filter((c) => !isStarterMerchantEffect(c.effect));
}

// ---------------------------------------------------------------------------
// Point deck (36 cards, rulebook §2/§3.1-3/§7.2) — shuffled, 5 kept face-up.
// Escalating cost/value tiers, mixing resource colors like the real game.
// ---------------------------------------------------------------------------

export function createPointDeck(): PointCard[] {
  const cards: PointCard[] = [
    { id: "point-1", cost: { yellow: 4 }, points: 6 },
    { id: "point-2", cost: { yellow: 5 }, points: 7 },
    { id: "point-3", cost: { yellow: 3, red: 1 }, points: 8 },
    { id: "point-4", cost: { yellow: 2, red: 2 }, points: 9 },
    { id: "point-5", cost: { red: 3 }, points: 10 },
    { id: "point-6", cost: { yellow: 2, green: 1 }, points: 10 },
    { id: "point-7", cost: { red: 2, green: 1 }, points: 11 },
    { id: "point-8", cost: { yellow: 3, green: 1 }, points: 11 },
    { id: "point-9", cost: { green: 2 }, points: 12 },
    { id: "point-10", cost: { red: 1, green: 2 }, points: 12 },
    { id: "point-11", cost: { yellow: 2, red: 1, green: 1 }, points: 13 },
    { id: "point-12", cost: { brown: 1, yellow: 2 }, points: 13 },
    { id: "point-13", cost: { brown: 1, red: 1 }, points: 13 },
    { id: "point-14", cost: { green: 1, brown: 1 }, points: 14 },
    { id: "point-15", cost: { yellow: 1, red: 1, green: 1 }, points: 14 },
    { id: "point-16", cost: { red: 2, green: 2 }, points: 15 },
    { id: "point-17", cost: { brown: 1, green: 1 }, points: 15 },
    { id: "point-18", cost: { brown: 2 }, points: 16 },
    { id: "point-19", cost: { yellow: 2, brown: 1 }, points: 16 },
    { id: "point-20", cost: { red: 1, brown: 1 }, points: 16 },
    { id: "point-21", cost: { yellow: 1, red: 1, brown: 1 }, points: 17 },
    { id: "point-22", cost: { green: 2, brown: 1 }, points: 17 },
    { id: "point-23", cost: { red: 3, green: 1 }, points: 17 },
    { id: "point-24", cost: { yellow: 3, brown: 1 }, points: 18 },
    { id: "point-25", cost: { green: 1, brown: 2 }, points: 18 },
    { id: "point-26", cost: { red: 2, brown: 1 }, points: 18 },
    { id: "point-27", cost: { yellow: 1, green: 1, brown: 1 }, points: 19 },
    { id: "point-28", cost: { red: 1, green: 1, brown: 1 }, points: 19 },
    { id: "point-29", cost: { brown: 3 }, points: 20 },
    { id: "point-30", cost: { green: 2, brown: 2 }, points: 20 },
    { id: "point-31", cost: { yellow: 2, red: 2, green: 1 }, points: 20 },
    { id: "point-32", cost: { red: 1, green: 1, brown: 2 }, points: 21 },
    { id: "point-33", cost: { yellow: 1, red: 1, green: 1, brown: 1 }, points: 21 },
    { id: "point-34", cost: { green: 3, brown: 1 }, points: 22 },
    { id: "point-35", cost: { red: 2, brown: 2 }, points: 22 },
    { id: "point-36", cost: { brown: 4 }, points: 23 },
  ];
  return cards;
}

// ---------------------------------------------------------------------------
// Resource bundle arithmetic helpers shared by engine.ts and the UI.
// ---------------------------------------------------------------------------

export function bundleTotal(bundle: ResourceBundle): number {
  return RESOURCE_ORDER.reduce((sum, r) => sum + (bundle[r] ?? 0), 0);
}

export function canAfford(have: ResourceBundle, cost: ResourceBundle): boolean {
  return RESOURCE_ORDER.every((r) => (have[r] ?? 0) >= (cost[r] ?? 0));
}

export function addBundle(a: ResourceBundle, b: ResourceBundle): ResourceBundle {
  const result: ResourceBundle = {};
  for (const r of RESOURCE_ORDER) {
    const v = (a[r] ?? 0) + (b[r] ?? 0);
    if (v !== 0) result[r] = v;
  }
  return result;
}

export function subtractBundle(a: ResourceBundle, b: ResourceBundle): ResourceBundle {
  const result: ResourceBundle = {};
  for (const r of RESOURCE_ORDER) {
    const v = (a[r] ?? 0) - (b[r] ?? 0);
    if (v !== 0) result[r] = v;
  }
  return result;
}

export function scaleBundle(a: ResourceBundle, factor: number): ResourceBundle {
  const result: ResourceBundle = {};
  for (const r of RESOURCE_ORDER) {
    const v = (a[r] ?? 0) * factor;
    if (v !== 0) result[r] = v;
  }
  return result;
}
