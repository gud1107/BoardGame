import { describe, expect, it } from "vitest";
import { ASSET_DEFS } from "./constants";
import { computeCollectionBonus } from "./engine";
import { projectWin } from "./synergy";
import type { AuctionCardDef, OwnedAsset } from "./types";

function owned(id: string, discarded = false): OwnedAsset {
  const a = ASSET_DEFS.find((d) => d.id === id)!;
  return { assetId: a.id, market: a.market, sector: a.sector, baseScore: a.baseScore, currentScore: a.baseScore, discarded };
}
function assetCard(id: string): AuctionCardDef {
  return { kind: "asset", cardId: `c-${id}`, asset: ASSET_DEFS.find((d) => d.id === id)! };
}

describe("projectWin (collection synergy preview)", () => {
  const twoUs = [owned("us-bigtech-1"), owned("us-bluechip-1")];

  it("completes a market collection when the missing sector is won", () => {
    expect(computeCollectionBonus(projectWin(twoUs, [], assetCard("us-meme-1"))).markets).toEqual(["미장"]);
  });

  it("a queued 상장폐지 discards the next asset won, so nothing completes", () => {
    const after = projectWin(twoUs, ["상장폐지"], assetCard("us-meme-1"));
    expect(after.at(-1)!.discarded).toBe(true);
    expect(computeCollectionBonus(after).bonus).toBe(0);
  });

  it("상장폐지 on the last asset breaks a finished collection", () => {
    const full = [...twoUs, owned("us-meme-1")];
    const after = projectWin(full, [], { kind: "special", cardId: "s", special: "상장폐지" });
    expect(computeCollectionBonus(full).bonus).toBe(3);
    expect(computeCollectionBonus(after).bonus).toBe(0);
  });

  it("score-only specials and specials with no assets leave collections alone", () => {
    expect(projectWin(twoUs, [], { kind: "special", cardId: "s", special: "악재어닝쇼크" })).toBe(twoUs);
    expect(projectWin([], [], { kind: "special", cardId: "s", special: "강제반대매매" })).toEqual([]);
  });
});
