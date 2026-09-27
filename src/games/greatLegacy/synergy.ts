import type { AuctionCardDef, OwnedAsset, SpecialKind } from "./types";

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
