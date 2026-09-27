import { computeCollectionBonus } from "./engine";
import type { AuctionCardDef, GreatLegacyState, Market, OwnedAsset, SeatIndex, Sector, SpecialKind } from "./types";

const MARKET_EMOJI: Record<string, string> = { 미장: "🇺🇸", 국장: "🇰🇷", 코인: "🪙" };
const SECTOR_EMOJI: Record<string, string> = { "빅테크&AI": "🤖", 블루칩: "🏆", "밈&테마주": "🎢" };

/** A +3 collection, identified the way computeCollectionBonus reports it. */
export type CollectionRef = { kind: "market"; market: Market } | { kind: "sector"; sector: Sector };

export function collectionKey(c: CollectionRef): string {
  return c.kind === "market" ? `m:${c.market}` : `s:${c.sector}`;
}

export function collectionTitle(c: CollectionRef): string {
  return c.kind === "market" ? `${MARKET_EMOJI[c.market]} ${c.market} 영끌 올인` : `${SECTOR_EMOJI[c.sector]} ${c.sector} 분산투자`;
}

/** Every collection currently completed by `assets`. */
export function completedCollections(assets: OwnedAsset[]): CollectionRef[] {
  const { markets, sectors } = computeCollectionBonus(assets);
  return [
    ...markets.map((market) => ({ kind: "market", market: market as Market }) as const),
    ...sectors.map((sector) => ({ kind: "sector", sector: sector as Sector }) as const),
  ];
}

function diffCollections(before: OwnedAsset[], after: OwnedAsset[]): { gained: CollectionRef[]; lost: CollectionRef[] } {
  const b = completedCollections(before);
  const a = completedCollections(after);
  const bKeys = new Set(b.map(collectionKey));
  const aKeys = new Set(a.map(collectionKey));
  return { gained: a.filter((c) => !bKeys.has(collectionKey(c))), lost: b.filter((c) => !aKeys.has(collectionKey(c))) };
}

export function isDiscardKind(kind: SpecialKind) {
  return kind === "상장폐지" || kind === "강제반대매매";
}

/**
 * Viewer's assets as they would look right after winning `card` — mirrors
 * engine.ts grantAsset/grantSpecial (a queued pending special hits the next
 * asset won; a special won hits the last-acquired asset, or queues if none).
 */
export function projectWin(assets: OwnedAsset[], pendingSpecials: SpecialKind[], card: AuctionCardDef): OwnedAsset[] {
  if (card.kind === "asset") {
    const pending = pendingSpecials[0];
    return [
      ...assets,
      {
        assetId: card.asset.id,
        market: card.asset.market,
        sector: card.asset.sector,
        baseScore: card.asset.baseScore,
        currentScore: pending === "초대형호재" ? 5 : pending === "악재어닝쇼크" ? 1 : card.asset.baseScore,
        discarded: pending !== undefined && isDiscardKind(pending),
      },
    ];
  }
  if (assets.length === 0 || !isDiscardKind(card.special)) return assets; // queued, or score-only change — collections unaffected
  return assets.map((a, i) => (i === assets.length - 1 ? { ...a, discarded: true } : a));
}

/** Collections winning `card` would newly complete (`gained`) or break (`lost`) for this player. */
export function lotSynergyImpact(assets: OwnedAsset[], pendingSpecials: SpecialKind[], card: AuctionCardDef) {
  return diffCollections(assets, projectWin(assets, pendingSpecials, card));
}

export interface SynergyChangeEvent {
  seat: SeatIndex;
  collection: CollectionRef;
  /** "complete" = newly finished +3; "break" = a finished one lost (상장폐지/강제반대매매 discarding one of its cards). */
  type: "complete" | "break";
}

/**
 * Collections each seat newly completed or lost between two consecutive
 * state snapshots — drives the fanfare / red-warning overlays on every
 * client (same diff-based approach as AuctionCoinEffects' detectCoinEvents).
 */
export function detectSynergyChanges(prev: GreatLegacyState, next: GreatLegacyState): SynergyChangeEvent[] {
  const events: SynergyChangeEvent[] = [];
  for (const p of next.players) {
    const before = prev.players.find((q) => q.seat === p.seat);
    if (!before || before.assets === p.assets) continue;
    const { gained, lost } = diffCollections(before.assets, p.assets);
    for (const collection of lost) events.push({ seat: p.seat, collection, type: "break" });
    for (const collection of gained) events.push({ seat: p.seat, collection, type: "complete" });
  }
  return events;
}
