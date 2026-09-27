import { describe, expect, it } from "vitest";
import { ASSET_DEFS } from "./constants";
import { applyAction, chooseBotAction, computeCollectionBonus, getValidMoves, startGame } from "./engine";
import { collectionTitle, detectSynergyChanges, lotSynergyImpact, projectWin } from "./synergy";
import type { AuctionCardDef, GreatLegacyState, OwnedAsset, PlayerState } from "./types";

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

describe("detectSynergyChanges / lotSynergyImpact", () => {
  function stateWith(assetsBySeat: OwnedAsset[][]): GreatLegacyState {
    const players = assetsBySeat.map((assets, seat) => ({ seat, assets, pendingSpecials: [] }) as unknown as PlayerState);
    return { players } as unknown as GreatLegacyState;
  }

  it("reports only the seat and collection that newly completed", () => {
    const prev = stateWith([[owned("us-bigtech-1"), owned("us-bluechip-1")], [owned("kr-meme-1")]]);
    const next = stateWith([[owned("us-bigtech-1"), owned("us-bluechip-1"), owned("us-meme-1")], prev.players[1].assets]);
    const events = detectSynergyChanges(prev, next);
    expect(events.map((e) => [e.seat, e.type, collectionTitle(e.collection)])).toEqual([[0, "complete", "🇺🇸 미장 영끌 올인"]]);
  });

  it("reports a break when a completed collection loses a card", () => {
    const full = [owned("us-bigtech-1"), owned("us-bluechip-1"), owned("us-meme-1")];
    const prev = stateWith([full]);
    const next = stateWith([[full[0], full[1], { ...full[2], discarded: true }]]);
    expect(detectSynergyChanges(prev, next).map((e) => [e.type, collectionTitle(e.collection)])).toEqual([["break", "🇺🇸 미장 영끌 올인"]]);
  });

  it("one asset can complete a market and a sector collection at once", () => {
    const assets = [owned("us-bigtech-1"), owned("us-bluechip-1"), owned("kr-meme-1"), owned("cr-meme-1")];
    expect(lotSynergyImpact(assets, [], assetCard("us-meme-1")).gained.map(collectionTitle)).toEqual(["🇺🇸 미장 영끌 올인", "🎢 밈&테마주 분산투자"]);
  });
});

describe("bot synergy awareness", () => {
  // A 3-point asset already bid up to 22 — plain value alone isn't worth a 23-coin bid (Lv10 floor is 22).
  function contested(rivalAssets: OwnedAsset[]): { state: GreatLegacyState; bot: number } {
    const base = startGame("4p", 9);
    const bot = base.auction!.activeSeat;
    const rival = base.auction!.order.find((s) => s !== bot)!;
    const state: GreatLegacyState = {
      ...base,
      players: base.players.map((p) => (p.seat === rival ? { ...p, assets: rivalAssets } : { ...p, assets: [] })),
      auction: {
        ...base.auction!,
        card: assetCard("us-meme-1"),
        kind: "normal",
        highestBid: 22,
        highestBidder: rival,
        committed: { ...base.auction!.committed, [rival]: { 20: 1, 10: 0, 5: 0, 1: 2 } },
      },
    };
    return { state, bot };
  }

  it("an expert bot passes a merely overpriced lot but outbids to block a rival's synergy", () => {
    const plain = contested([owned("kr-meme-1")]);
    expect(chooseBotAction(plain.state, plain.bot, 10, () => 0.99)?.type).toBe("pass");
    const threat = contested([owned("us-bigtech-1"), owned("us-bluechip-1")]);
    expect(chooseBotAction(threat.state, threat.bot, 10, () => 0.99)?.type).toBe("bid");
  });

  it("novice bots ignore rival synergies", () => {
    const threat = contested([owned("us-bigtech-1"), owned("us-bluechip-1")]);
    expect(getValidMoves(threat.state, threat.bot).some((m) => m.type === "bid")).toBe(true);
    expect(chooseBotAction(threat.state, threat.bot, 1, () => 0.99)?.type).toBe("pass");
  });

  function reverseLot(lastAsset: string, highestBid: number) {
    const base = startGame("4p", 9);
    const bot = base.auction!.activeSeat;
    const state: GreatLegacyState = {
      ...base,
      players: base.players.map((p) => (p.seat === bot ? { ...p, assets: [owned(lastAsset)] } : p)),
      auction: { ...base.auction!, card: { kind: "special", cardId: "s", special: "상장폐지" }, kind: "reverse", highestBid },
    };
    return { state, bot };
  }

  it("reverse auction: keeps dodging while the table is cheaper than the penalty, takes the card once it isn't", () => {
    const cheap = reverseLot("kr-meme-2", 1); // losing a 4-point asset vs. a 2-coin bid → stay in
    expect(chooseBotAction(cheap.state, cheap.bot, 10, () => 0.99)?.type).toBe("bid");
    const pricey = reverseLot("us-meme-2", 30); // losing a 1-point asset vs. a 31-coin bid → take it (refunded)
    expect(chooseBotAction(pricey.state, pricey.bot, 10, () => 0.99)?.type).toBe("pass");
  });

});

describe("brokenCollections record (engine)", () => {
  it("a 상장폐지 that breaks a finished collection is logged on the player who took it", () => {
    const base = startGame("4p", 9);
    const bot = base.auction!.activeSeat;
    const full = [owned("us-bigtech-1"), owned("us-bluechip-1"), owned("us-meme-1")];
    const state: GreatLegacyState = {
      ...base,
      players: base.players.map((p) => (p.seat === bot ? { ...p, assets: full } : p)),
      auction: { ...base.auction!, card: { kind: "special", cardId: "s", special: "상장폐지" }, kind: "reverse", highestBid: 0 },
    };
    const after = applyAction(state, { type: "pass", seat: bot }); // first pass in a reverse auction takes the card
    expect(after.players.find((p) => p.seat === bot)!.brokenCollections).toEqual(["m:미장"]);
    expect(after.players.filter((p) => p.seat !== bot).every((p) => p.brokenCollections === undefined)).toBe(true);
  });
});
