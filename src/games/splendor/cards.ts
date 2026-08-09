/**
 * Card + token data for "스플렌더" (Splendor). Pure data module — no rules
 * logic lives here, see engine.ts for that.
 *
 * boardGameRule/스플랜더.md documents the *quantities* per tier (40 tier-1 /
 * 30 tier-2 / 20 tier-3 development cards, 10 noble tiles) and the general
 * cost/point curve per tier (§2), but — unlike boardGameRule/Century.md,
 * which got a full card-list appendix — it does not include a literal
 * card-by-card list. Rather than fabricate a "transcription" that might not
 * match the real deck, this module generates a self-designed dataset that
 * satisfies the documented counts and follows the documented cost/point
 * shape per tier (same category of documented, intentional simplification as
 * century/cards.ts's own predecessor dataset — see that file's header).
 *
 * The generator rotates a small set of hand-designed cost "templates" across
 * the 5 gem colors (`GEM_ORDER`), so e.g. tier-1's 8 templates × 5 colors =
 * 40 cards, each color getting one card per template. This keeps the table
 * short and guarantees the exact official counts/distribution by
 * construction rather than by careful hand-counting.
 */

export type GemColor = "white" | "blue" | "green" | "red" | "black";
/** `"gold"` is the wildcard/joker token — never a development-card cost or bonus color, only ever held/spent as a token. */
export type TokenColor = GemColor | "gold";

/** Diamond(흰)/Sapphire(파랑)/Emerald(초록)/Ruby(빨강)/Onyx(검정), the rulebook's own listing order (§2). */
export const GEM_ORDER: GemColor[] = ["white", "blue", "green", "red", "black"];
export const TOKEN_COLORS: TokenColor[] = [...GEM_ORDER, "gold"];

/** A sparse gem-color multiset (development card costs, noble costs). Missing keys mean 0. */
export type CostBundle = Partial<Record<GemColor, number>>;
/** A sparse token multiset (what a player holds / the bank supply) — includes gold. */
export type TokenBundle = Partial<Record<TokenColor, number>>;

export type Tier = 1 | 2 | 3;

export interface DevelopmentCard {
  id: string;
  tier: Tier;
  /** The permanent gem-color discount this card grants once purchased (rulebook §5-1). */
  bonus: GemColor;
  cost: CostBundle;
  points: number;
}

export interface Noble {
  id: string;
  /** Checked purely against a player's purchased-card bonus counts (rulebook §5-5) — never against held tokens. */
  cost: CostBundle;
  points: number;
}

function colorAt(baseIndex: number, offset: number): GemColor {
  return GEM_ORDER[(baseIndex + offset) % GEM_ORDER.length];
}

function bundleFromOffsets(baseIndex: number, offsets: [offset: number, count: number][]): CostBundle {
  const bundle: CostBundle = {};
  for (const [offset, count] of offsets) {
    bundle[colorAt(baseIndex, offset)] = count;
  }
  return bundle;
}

interface CardTemplate {
  offsets: [offset: number, count: number][];
  points: number;
}

// Tier 1 (rulebook: 40 cards, cheap, mostly 0 points) — 8 templates × 5 colors.
const TIER1_TEMPLATES: CardTemplate[] = [
  { offsets: [[1, 3]], points: 0 },
  { offsets: [[1, 1], [2, 2]], points: 0 },
  { offsets: [[2, 2], [3, 1]], points: 0 },
  { offsets: [[1, 1], [2, 1], [3, 1]], points: 0 },
  { offsets: [[3, 2], [4, 1]], points: 0 },
  { offsets: [[1, 4]], points: 1 },
  { offsets: [[1, 2], [2, 1], [3, 1]], points: 0 },
  { offsets: [[2, 1], [3, 1], [4, 2]], points: 0 },
];

// Tier 2 (rulebook: 30 cards, mid cost, 1-3 points) — 6 templates × 5 colors.
const TIER2_TEMPLATES: CardTemplate[] = [
  { offsets: [[1, 3], [2, 2]], points: 1 },
  { offsets: [[1, 2], [2, 2], [3, 1]], points: 2 },
  { offsets: [[1, 5]], points: 2 },
  { offsets: [[2, 4], [3, 1]], points: 2 },
  { offsets: [[1, 6]], points: 3 },
  { offsets: [[3, 3], [4, 3]], points: 3 },
];

// Tier 3 (rulebook: 20 cards, expensive, high points) — 4 templates × 5 colors.
const TIER3_TEMPLATES: CardTemplate[] = [
  { offsets: [[1, 3], [2, 3], [3, 3]], points: 3 },
  { offsets: [[1, 7]], points: 4 },
  { offsets: [[2, 3], [3, 5]], points: 4 },
  { offsets: [[1, 3], [2, 6]], points: 5 },
];

export function createDevelopmentDeck(): DevelopmentCard[] {
  const cards: DevelopmentCard[] = [];
  const tiers: [Tier, CardTemplate[]][] = [
    [1, TIER1_TEMPLATES],
    [2, TIER2_TEMPLATES],
    [3, TIER3_TEMPLATES],
  ];
  for (const [tier, templates] of tiers) {
    GEM_ORDER.forEach((bonus, colorIndex) => {
      templates.forEach((tmpl, tmplIndex) => {
        cards.push({
          id: `t${tier}-${bonus}-${tmplIndex}`,
          tier,
          bonus,
          cost: bundleFromOffsets(colorIndex, tmpl.offsets),
          points: tmpl.points,
        });
      });
    });
  }
  return cards;
}

// Nobles (rulebook: 10 tiles, all worth 3pt) — 2 templates × 5 colors.
const NOBLE_TEMPLATES: CardTemplate[] = [
  { offsets: [[1, 3], [2, 3], [3, 3]], points: 3 }, // 3 colors × 3
  { offsets: [[1, 4], [2, 4]], points: 3 }, // 2 colors × 4
];

export function createNobles(): Noble[] {
  const nobles: Noble[] = [];
  GEM_ORDER.forEach((_, colorIndex) => {
    NOBLE_TEMPLATES.forEach((tmpl, tmplIndex) => {
      nobles.push({
        id: `noble-${colorIndex}-${tmplIndex}`,
        cost: bundleFromOffsets(colorIndex, tmpl.offsets),
        points: tmpl.points,
      });
    });
  });
  return nobles;
}

// ---------------------------------------------------------------------------
// Bundle arithmetic shared by engine.ts and the UI.
// ---------------------------------------------------------------------------

export function costTotal(bundle: CostBundle): number {
  return GEM_ORDER.reduce((sum, c) => sum + (bundle[c] ?? 0), 0);
}

export function tokenTotal(bundle: TokenBundle): number {
  return TOKEN_COLORS.reduce((sum, c) => sum + (bundle[c] ?? 0), 0);
}

export function addTokens(a: TokenBundle, b: TokenBundle): TokenBundle {
  const result: TokenBundle = {};
  for (const c of TOKEN_COLORS) {
    const v = (a[c] ?? 0) + (b[c] ?? 0);
    if (v !== 0) result[c] = v;
  }
  return result;
}

export function subtractTokens(a: TokenBundle, b: TokenBundle): TokenBundle {
  const result: TokenBundle = {};
  for (const c of TOKEN_COLORS) {
    const v = (a[c] ?? 0) - (b[c] ?? 0);
    if (v !== 0) result[c] = v;
  }
  return result;
}

export function canPayTokens(have: TokenBundle, cost: TokenBundle): boolean {
  return TOKEN_COLORS.every((c) => (have[c] ?? 0) >= (cost[c] ?? 0));
}
