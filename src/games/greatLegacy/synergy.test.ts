import { describe, expect, it } from "vitest";
import { ASSET_DEFS } from "./constants";
import { chooseBotAction, computeCollectionBonus, getValidMoves, startGame } from "./engine";
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
  // A 3-point asset already bid up to 10 — plain value alone isn't worth an 11-coin raise.
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
        highestBid: 10,
        highestBidder: rival,
        committed: { ...base.auction!.committed, [rival]: { 20: 0, 10: 1, 5: 0, 1: 0 } },
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

  it("a nearly broke bot takes a reverse-auction penalty card instead of bidding itself dry", () => {
    const base = startGame("4p", 9);
    const bot = base.auction!.activeSeat;
    const state: GreatLegacyState = {
      ...base,
      players: base.players.map((p) => (p.seat === bot ? { ...p, purse: { 20: 0, 10: 0, 5: 0, 1: 3 }, assets: [owned("kr-meme-2")] } : p)),
      auction: { ...base.auction!, card: { kind: "special", cardId: "s", special: "상장폐지" }, kind: "reverse", highestBid: 1 },
    };
    expect(chooseBotAction(state, bot, 10, () => 0.99)?.type).toBe("pass");
  });
});
