/**
 * Card + resource data for "센추리: 향신료의 길" (Century: Spice Road). Pure
 * data module — no rules logic lives here, see engine.ts for that.
 *
 * Resource value order is taken from boardGameRule/Century.md §4.1
 * (노란색 → 빨간색 → 초록색 → 갈색, i.e. yellow < red < green < brown). Note
 * this differs from the task brief's prose ("노란색 < 초록색 < 빨간색 < 갈색"),
 * which swaps red/green — the rulebook document is treated as authoritative
 * per this project's convention (boardGameRule/*.md is "the basis the engine
 * implements", see docs/architecture.md §5) and matches the real game's
 * published resource order, so that's what's implemented here.
 *
 * `createMerchantDeck()`'s 32 cards and `createPointDeck()`'s 36 cards are
 * transcribed directly from `boardGameRule/Century.md`'s card-list appendix
 * (its own §1/§2, added after this game's initial implementation) — an
 * earlier revision of this file used an original, self-designed dataset
 * because no machine-readable official card list was available yet; that
 * placeholder dataset has been fully replaced by this transcription. See
 * docs/history.md's card-deck-update phase for the full before/after.
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

// ---------------------------------------------------------------------------
// Merchant deck (32 cards, rulebook "① 일반 상인 카드" appendix) — shuffled,
// 6 kept face-up. Transcribed 1:1 from Century.md's A/B/C breakdown (6
// production + 2 upgrade + 24 trade = 32). Note this deck legitimately
// contains one more `{upgrade, upgrades:2}` card ("업그레이드 카드" B, first
// bullet) *in addition to* every player's own starting upgrade card
// (`basicUpgradeCard`, also upgrades:2) — the rulebook itself calls this out
// explicitly ("기본 카드와 별개로 더미에 1장 추가 포함", i.e. "included as one
// extra copy in the deck, separate from the basic card"). An earlier session
// treated that exact overlap as an unintentional duplicate-card bug and
// filtered it out; this authoritative card list settles that it was by
// design, so no such filter is applied here.
// ---------------------------------------------------------------------------

export function createMerchantDeck(): MerchantCard[] {
  const cards: MerchantCard[] = [
    // A. Production cards (6)
    { id: "merchant-p1", effect: { kind: "production", gain: { yellow: 3 } } },
    { id: "merchant-p2", effect: { kind: "production", gain: { yellow: 4 } } },
    { id: "merchant-p3", effect: { kind: "production", gain: { red: 2 } } },
    { id: "merchant-p4", effect: { kind: "production", gain: { yellow: 1, red: 1 } } },
    { id: "merchant-p5", effect: { kind: "production", gain: { green: 1 } } },
    { id: "merchant-p6", effect: { kind: "production", gain: { brown: 1 } } },
    // B. Upgrade cards (2)
    { id: "merchant-u1", effect: { kind: "upgrade", upgrades: 2 } },
    { id: "merchant-u2", effect: { kind: "upgrade", upgrades: 3 } },
    // C.1 Yellow-based trades (5)
    { id: "merchant-ty1", effect: { kind: "trade", cost: { yellow: 2 }, gain: { green: 1 } } },
    { id: "merchant-ty2", effect: { kind: "trade", cost: { yellow: 3 }, gain: { red: 3 } } },
    { id: "merchant-ty3", effect: { kind: "trade", cost: { yellow: 4 }, gain: { brown: 1 } } },
    { id: "merchant-ty4", effect: { kind: "trade", cost: { yellow: 4 }, gain: { green: 2 } } },
    { id: "merchant-ty5", effect: { kind: "trade", cost: { yellow: 5 }, gain: { red: 3, green: 1 } } },
    // C.2 Red-based trades (6)
    { id: "merchant-tr1", effect: { kind: "trade", cost: { red: 1 }, gain: { yellow: 3 } } },
    { id: "merchant-tr2", effect: { kind: "trade", cost: { red: 1 }, gain: { yellow: 1, green: 1 } } },
    { id: "merchant-tr3", effect: { kind: "trade", cost: { red: 2 }, gain: { green: 2 } } },
    { id: "merchant-tr4", effect: { kind: "trade", cost: { red: 2 }, gain: { yellow: 2, green: 1 } } },
    { id: "merchant-tr5", effect: { kind: "trade", cost: { red: 2 }, gain: { yellow: 1, brown: 1 } } },
    { id: "merchant-tr6", effect: { kind: "trade", cost: { red: 3 }, gain: { brown: 2 } } },
    // C.3 Green-based trades (6)
    { id: "merchant-tg1", effect: { kind: "trade", cost: { green: 1 }, gain: { red: 2 } } },
    { id: "merchant-tg2", effect: { kind: "trade", cost: { green: 1 }, gain: { yellow: 4 } } },
    { id: "merchant-tg3", effect: { kind: "trade", cost: { green: 1 }, gain: { yellow: 1, red: 1, brown: 1 } } },
    { id: "merchant-tg4", effect: { kind: "trade", cost: { green: 2 }, gain: { brown: 2 } } },
    { id: "merchant-tg5", effect: { kind: "trade", cost: { green: 2 }, gain: { yellow: 2, brown: 1 } } },
    { id: "merchant-tg6", effect: { kind: "trade", cost: { green: 2 }, gain: { red: 3, brown: 1 } } },
    // C.4 Brown-based trades (5)
    { id: "merchant-tb1", effect: { kind: "trade", cost: { brown: 1 }, gain: { green: 2 } } },
    { id: "merchant-tb2", effect: { kind: "trade", cost: { brown: 1 }, gain: { red: 3 } } },
    { id: "merchant-tb3", effect: { kind: "trade", cost: { brown: 1 }, gain: { yellow: 5 } } },
    { id: "merchant-tb4", effect: { kind: "trade", cost: { brown: 1 }, gain: { yellow: 3, green: 1 } } },
    { id: "merchant-tb5", effect: { kind: "trade", cost: { brown: 1 }, gain: { yellow: 2, red: 2 } } },
    // C.5 Mixed-resource trades (2). The rulebook footnotes the first as
    // "노란색 1개, 빨간색 1개 → 초록색 1개, 빨간색 1개 (또는 노란색 1개 → 초록색
    // 1개 효과)" — the parenthetical just explains that the red on both
    // sides cancels out net-of-repeats if you already hold enough red; the
    // literal cost/gain (including the red on each side) is what's modeled
    // here so `canAfford`'s repeat check still requires holding that red.
    { id: "merchant-tm1", effect: { kind: "trade", cost: { yellow: 1, red: 1 }, gain: { red: 1, green: 1 } } },
    { id: "merchant-tm2", effect: { kind: "trade", cost: { yellow: 1, green: 1 }, gain: { red: 1, brown: 1 } } },
  ];
  return cards;
}

// ---------------------------------------------------------------------------
// Point deck (36 cards, rulebook "② 점수 카드" appendix) — shuffled, 5 kept
// face-up. Transcribed 1:1 from Century.md's three groups (12 two-color +
// 12 three-color + 4 rainbow + 8 single/advanced = 36).
// ---------------------------------------------------------------------------

export function createPointDeck(): PointCard[] {
  const cards: PointCard[] = [
    // ① Two-color combinations (12)
    { id: "point-1", cost: { yellow: 2, red: 2 }, points: 6 },
    { id: "point-2", cost: { yellow: 2, green: 2 }, points: 8 },
    { id: "point-3", cost: { yellow: 2, brown: 2 }, points: 10 },
    { id: "point-4", cost: { red: 2, green: 2 }, points: 10 },
    { id: "point-5", cost: { red: 2, brown: 2 }, points: 12 },
    { id: "point-6", cost: { green: 2, brown: 2 }, points: 14 },
    { id: "point-7", cost: { yellow: 3, red: 2 }, points: 7 },
    { id: "point-8", cost: { yellow: 3, green: 2 }, points: 9 },
    { id: "point-9", cost: { yellow: 3, brown: 2 }, points: 11 },
    { id: "point-10", cost: { red: 3, green: 2 }, points: 12 },
    { id: "point-11", cost: { red: 3, brown: 2 }, points: 14 },
    { id: "point-12", cost: { green: 3, brown: 2 }, points: 16 },
    // ② Three-color combinations (12)
    { id: "point-13", cost: { yellow: 2, red: 1, green: 1 }, points: 7 },
    { id: "point-14", cost: { yellow: 2, red: 1, brown: 1 }, points: 9 },
    { id: "point-15", cost: { yellow: 2, green: 1, brown: 1 }, points: 11 },
    { id: "point-16", cost: { red: 2, yellow: 1, green: 1 }, points: 8 },
    { id: "point-17", cost: { red: 2, yellow: 1, brown: 1 }, points: 10 },
    { id: "point-18", cost: { red: 2, green: 1, brown: 1 }, points: 12 },
    { id: "point-19", cost: { green: 2, yellow: 1, red: 1 }, points: 10 },
    { id: "point-20", cost: { green: 2, yellow: 1, brown: 1 }, points: 12 },
    { id: "point-21", cost: { green: 2, red: 1, brown: 1 }, points: 13 },
    { id: "point-22", cost: { brown: 2, yellow: 1, red: 1 }, points: 13 },
    { id: "point-23", cost: { brown: 2, yellow: 1, green: 1 }, points: 14 },
    { id: "point-24", cost: { brown: 2, red: 1, green: 1 }, points: 15 },
    // ③A Four-color "rainbow" combinations (4)
    { id: "point-25", cost: { yellow: 1, red: 1, green: 1, brown: 1 }, points: 12 },
    { id: "point-26", cost: { yellow: 2, red: 1, green: 1, brown: 1 }, points: 13 },
    { id: "point-27", cost: { yellow: 1, red: 2, green: 1, brown: 1 }, points: 14 },
    { id: "point-28", cost: { yellow: 1, red: 1, green: 2, brown: 1 }, points: 15 },
    // ③B Single/advanced-resource combinations (8)
    { id: "point-29", cost: { red: 4 }, points: 8 },
    { id: "point-30", cost: { red: 5 }, points: 10 },
    { id: "point-31", cost: { green: 4 }, points: 12 },
    { id: "point-32", cost: { green: 5 }, points: 15 },
    { id: "point-33", cost: { brown: 4 }, points: 16 },
    { id: "point-34", cost: { brown: 5 }, points: 20 },
    { id: "point-35", cost: { green: 2, brown: 3 }, points: 18 },
    { id: "point-36", cost: { brown: 3, red: 2 }, points: 17 },
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
