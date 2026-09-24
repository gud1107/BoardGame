/**
 * Card + token data for "스플렌더 대결" (Splendor Duel). Pure data module —
 * no rules logic lives here, see engine.ts for that.
 *
 * boardGameRule/스플랜더 대결/스플랜더 대결.md documents the component
 * *counts* (67 development cards split 30/24/13 across levels 1/2/3, 4 royal
 * cards, 20 gems + 2 pearls + 3 gold) and the 5 card abilities, but — like
 * the base Splendor rulebook, see splendor/cards.ts's header — it has no
 * literal card-by-card list. Rather than fabricate a "transcription" that
 * might not match the real deck, this module generates a self-designed
 * dataset that hits the documented counts exactly and spreads points,
 * crowns, pearl costs and abilities so all 3 victory conditions (20 prestige
 * / 10 crowns / 10 points in one color) are genuinely reachable.
 *
 * Colored cards come from cost "templates" rotated across the 5 gem colors
 * (same trick as splendor/cards.ts — guarantees an even color distribution
 * by construction), plus a handful of hand-written colorless cards: the
 * "보너스 복사(?)" cards, which have no color until their owner binds them
 * to one of their existing colors on purchase (rulebook §5).
 */

export type GemColor = "white" | "blue" | "green" | "red" | "black";
/** Gold is the joker — held/spent as a token only, never a card cost or bonus. Pearl is a card cost but never a bonus. */
export type TokenColor = GemColor | "pearl" | "gold";
/** What can physically sit on the 5×5 board / in the bag — gold lives on its own stand above the board in this rulebook. */
export type BoardToken = GemColor | "pearl";

export const GEM_ORDER: GemColor[] = ["white", "blue", "green", "red", "black"];
export const TOKEN_ORDER: TokenColor[] = [...GEM_ORDER, "pearl", "gold"];

export type CostBundle = Partial<Record<GemColor | "pearl", number>>;
export type TokenBundle = Partial<Record<TokenColor, number>>;

export type Level = 1 | 2 | 3;

export type CardAbility = "extraTurn" | "copyBonus" | "takeToken" | "gainPrivilege" | "stealToken";

export interface DuelCard {
  id: string;
  level: Level;
  /** `null` = colorless card (a "보너스 복사" card before it's bound, or a pure points/crowns card). */
  color: GemColor | null;
  points: number;
  crowns: number;
  /** How many discount "gems" this card's color bonus is worth (1, or 2 for a few double-bonus cards). */
  bonus: number;
  cost: CostBundle;
  ability?: CardAbility;
}

export interface RoyalCard {
  id: string;
  points: number;
  ability?: CardAbility;
}

function colorAt(base: number, offset: number): GemColor {
  return GEM_ORDER[(base + offset) % GEM_ORDER.length];
}

interface Template {
  /** [offset from the card's own color, count]; the string key "pearl" adds pearls. */
  cost: ([number, number] | ["pearl", number])[];
  points: number;
  crowns: number;
  bonus: number;
  ability?: CardAbility;
}

function fromTemplate(level: Level, tIdx: number, base: number, t: Template): DuelCard {
  const cost: CostBundle = {};
  for (const [key, count] of t.cost) {
    if (key === "pearl") cost.pearl = (cost.pearl ?? 0) + count;
    else {
      const c = colorAt(base, key);
      cost[c] = (cost[c] ?? 0) + count;
    }
  }
  return {
    id: `L${level}-${tIdx}-${GEM_ORDER[base]}`,
    level,
    color: GEM_ORDER[base],
    points: t.points,
    crowns: t.crowns,
    bonus: t.bonus,
    cost,
    ability: t.ability,
  };
}

/** 6 templates × 5 colors = 30 level-1 cards. */
const LEVEL1: Template[] = [
  { cost: [[1, 1], [2, 1], [3, 1]], points: 0, crowns: 0, bonus: 1 },
  { cost: [[1, 2], [2, 2]], points: 0, crowns: 0, bonus: 1, ability: "takeToken" },
  { cost: [[2, 3], ["pearl", 1]], points: 1, crowns: 0, bonus: 1 },
  { cost: [[3, 3]], points: 0, crowns: 1, bonus: 1 },
  { cost: [[1, 2], [4, 1], ["pearl", 1]], points: 0, crowns: 0, bonus: 1, ability: "extraTurn" },
  { cost: [[1, 1], [2, 1], [3, 1], [4, 1]], points: 1, crowns: 0, bonus: 1, ability: "gainPrivilege" },
];

/** 4 templates × 5 colors = 20, + 4 colorless "보너스 복사" cards = 24 level-2 cards. */
const LEVEL2: Template[] = [
  { cost: [[1, 3], [2, 2], ["pearl", 1]], points: 1, crowns: 1, bonus: 1 },
  { cost: [[2, 4], [3, 2]], points: 2, crowns: 0, bonus: 1, ability: "stealToken" },
  { cost: [[3, 2], [4, 2], [1, 1], ["pearl", 1]], points: 2, crowns: 0, bonus: 1, ability: "extraTurn" },
  { cost: [[1, 4], [4, 2], ["pearl", 1]], points: 1, crowns: 0, bonus: 2 },
];

const LEVEL2_COLORLESS: DuelCard[] = [
  { id: "L2-copy-a", level: 2, color: null, points: 1, crowns: 1, bonus: 1, ability: "copyBonus", cost: { white: 2, blue: 2, green: 2 } },
  { id: "L2-copy-b", level: 2, color: null, points: 1, crowns: 1, bonus: 1, ability: "copyBonus", cost: { green: 2, red: 2, black: 2 } },
  { id: "L2-copy-c", level: 2, color: null, points: 1, crowns: 1, bonus: 1, ability: "copyBonus", cost: { red: 2, black: 2, white: 2 } },
  { id: "L2-copy-d", level: 2, color: null, points: 0, crowns: 2, bonus: 1, ability: "copyBonus", cost: { blue: 3, green: 2, pearl: 1 } },
];

/** 2 templates × 5 colors = 10, + 3 colorless cards = 13 level-3 cards. */
const LEVEL3: Template[] = [
  { cost: [[1, 5], [2, 3], ["pearl", 1]], points: 4, crowns: 0, bonus: 1 },
  { cost: [[2, 6], [3, 2], ["pearl", 1]], points: 3, crowns: 2, bonus: 1 },
];

const LEVEL3_COLORLESS: DuelCard[] = [
  { id: "L3-crown-a", level: 3, color: null, points: 0, crowns: 3, bonus: 0, cost: { white: 3, blue: 3, black: 3, pearl: 1 } },
  { id: "L3-crown-b", level: 3, color: null, points: 0, crowns: 3, bonus: 0, cost: { green: 3, red: 3, black: 3, pearl: 1 } },
  { id: "L3-copy-a", level: 3, color: null, points: 3, crowns: 1, bonus: 1, ability: "copyBonus", cost: { white: 4, red: 4, pearl: 1 } },
];

export function createDevelopmentDeck(): DuelCard[] {
  const cards: DuelCard[] = [];
  const add = (level: Level, templates: Template[]) =>
    templates.forEach((t, tIdx) => GEM_ORDER.forEach((_, base) => cards.push(fromTemplate(level, tIdx, base, t))));
  add(1, LEVEL1);
  add(2, LEVEL2);
  cards.push(...LEVEL2_COLORLESS);
  add(3, LEVEL3);
  cards.push(...LEVEL3_COLORLESS);
  return cards;
}

/** Rulebook §5 — 4 royal cards, laid out face up (not shuffled). Points + abilities, never a gem bonus. */
export function createRoyalCards(): RoyalCard[] {
  return [
    { id: "royal-steal", points: 2, ability: "stealToken" },
    { id: "royal-privilege", points: 2, ability: "gainPrivilege" },
    { id: "royal-extra", points: 2, ability: "extraTurn" },
    { id: "royal-plain", points: 3 },
  ];
}

export function tokenTotal(bundle: TokenBundle): number {
  return Object.values(bundle).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

export function addTokens(a: TokenBundle, b: TokenBundle): TokenBundle {
  const out: TokenBundle = { ...a };
  for (const [k, v] of Object.entries(b) as [TokenColor, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function subtractTokens(a: TokenBundle, b: TokenBundle): TokenBundle {
  const out: TokenBundle = { ...a };
  for (const [k, v] of Object.entries(b) as [TokenColor, number][]) out[k] = (out[k] ?? 0) - v;
  return out;
}

export function canPayTokens(have: TokenBundle, pay: TokenBundle): boolean {
  return (Object.entries(pay) as [TokenColor, number][]).every(([k, v]) => v >= 0 && (have[k] ?? 0) >= v);
}
