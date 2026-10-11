import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  buildDeck,
  chooseBotAction,
  computeRankings,
  getPlayerView,
  getValidMoves,
  hyperAtLeast,
  mustChallenge,
  pullDanger,
  startGame,
  type BluffRouletteState,
  type Card,
  type CardKind,
  type EngineAction,
} from "./engine";
import { bluffRouletteStatDetails } from "./stats";

let nextId = 1000;
const card = (kind: CardKind): Card => ({ id: nextId++, kind });

/** A hand-built mid-round state: seats get the given hands, table suit sun, no plays yet. */
function rig(hands: CardKind[][], opts: { shots?: number[]; bullets?: number[]; active?: number; skullMode?: boolean } = {}): BluffRouletteState {
  const s = startGame(Math.max(2, hands.length), 1, { skullMode: !!opts.skullMode });
  return {
    ...s,
    tableSuit: "sun",
    activeSeat: opts.active ?? 0,
    roundStarter: opts.active ?? 0,
    players: hands.map((h, seat) => ({
      seat,
      alive: true,
      hand: h.map(card),
      shots: opts.shots?.[seat] ?? 0,
      bullet: opts.bullets?.[seat] ?? 5,
    })),
  };
}

function playIds(s: BluffRouletteState, seat: number, kinds: CardKind[]): EngineAction {
  const pool = [...s.players[seat].hand];
  const ids = kinds.map((k) => {
    const i = pool.findIndex((c) => c.kind === k);
    const [c] = pool.splice(i, 1);
    return c.id;
  });
  return { type: "play", seat, cardIds: ids };
}

function runBotGame(playerCount: number, seed: number, levels: number[], skullMode = false) {
  let s = startGame(playerCount, seed, { skullMode });
  const rng = seededRng(seed * 7 + 1);
  let cont = seed;
  for (let g = 0; g < 5000 && s.phase !== "gameOver"; g++) {
    if (s.phase === "reveal") {
      s = applyAction(s, { type: "continue", seed: ++cont });
      continue;
    }
    const a = chooseBotAction(s, s.activeSeat, levels[s.activeSeat], rng);
    expect(a).not.toBeNull();
    const before = s;
    s = applyAction(s, a!);
    expect(s).not.toBe(before); // every bot move is legal
  }
  return s;
}

describe("deck (§O)", () => {
  it("20 cards for 2-4 players, 30 for 5-6", () => {
    for (const n of [2, 3, 4]) expect(buildDeck(n, { skullMode: false })).toHaveLength(20);
    for (const n of [5, 6]) expect(buildDeck(n, { skullMode: false })).toHaveLength(30);
  });
  it("skull mode swaps exactly one mask", () => {
    const d = buildDeck(4, { skullMode: true });
    expect(d.filter((c) => c.kind === "skull")).toHaveLength(1);
    expect(d.filter((c) => c.kind === "mask")).toHaveLength(1);
    expect(d).toHaveLength(20);
  });
  it("deals 5 to everyone, ids unique, bullets 0..5", () => {
    for (let n = 2; n <= 6; n++) {
      const s = startGame(n, 99 + n);
      const ids = s.players.flatMap((p) => p.hand.map((c) => c.id));
      expect(ids).toHaveLength(n * 5);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of s.players) {
        expect(p.bullet).toBeGreaterThanOrEqual(0);
        expect(p.bullet).toBeLessThan(6);
      }
      expect(["sun", "moon", "star"]).toContain(s.tableSuit);
    }
  });
  it("same seed → same game (lockstep)", () => {
    expect(startGame(4, 123)).toEqual(startGame(4, 123));
  });
});

describe("playing (§F, §G)", () => {
  it("1-3 cards only, own cards only, only on your turn", () => {
    const s = rig([["sun", "sun", "moon", "star", "mask"], ["moon", "moon", "moon", "moon", "moon"]]);
    const all = s.players[0].hand.map((c) => c.id);
    expect(applyAction(s, { type: "play", seat: 0, cardIds: [] })).toBe(s);
    expect(applyAction(s, { type: "play", seat: 0, cardIds: all.slice(0, 4) })).toBe(s);
    expect(applyAction(s, { type: "play", seat: 0, cardIds: [all[0], all[0]] })).toBe(s);
    expect(applyAction(s, { type: "play", seat: 0, cardIds: [s.players[1].hand[0].id] })).toBe(s);
    expect(applyAction(s, playIds(s, 1, ["moon"]))).toBe(s);
    const n = applyAction(s, playIds(s, 0, ["sun", "moon"]));
    expect(n.players[0].hand).toHaveLength(3);
    expect(n.pile).toHaveLength(1);
    expect(n.activeSeat).toBe(1);
  });
  it("cannot call liar with no previous play", () => {
    const s = rig([["sun"], ["moon"]]);
    expect(applyAction(s, { type: "liar", seat: 0 })).toBe(s);
  });
  it("skips survivors with no cards", () => {
    let s = rig([["sun"], [], ["moon", "star"]]);
    s = applyAction(s, playIds(s, 0, ["sun"]));
    expect(s.activeSeat).toBe(2);
  });
  it("forced challenge when everyone else is out of cards (§L)", () => {
    let s = rig([["sun", "moon"], [], []]);
    s = applyAction(s, playIds(s, 0, ["moon"]));
    expect(s.activeSeat).toBe(1);
    expect(mustChallenge(s)).toBe(true);
    expect(getValidMoves(s, 1)).toEqual([{ type: "liar", seat: 1 }]);
    const r = applyAction(s, { type: "liar", seat: 1 });
    expect(r.lastResolution?.forced).toBe(true);
    expect(r.lastResolution?.truthful).toBe(false);
  });
  it("emptying your hand gives the turn to the next holder, who may still play", () => {
    let s = rig([["sun"], ["moon", "sun"]]);
    s = applyAction(s, playIds(s, 0, ["sun"]));
    expect(s.activeSeat).toBe(1);
    expect(mustChallenge(s)).toBe(false);
    s = applyAction(s, playIds(s, 1, ["sun"]));
    // seat 0 is empty and is the only other survivor → forced
    expect(s.activeSeat).toBe(0);
    expect(mustChallenge(s)).toBe(true);
  });
});

describe("challenge & roulette (§I, §J)", () => {
  it("truthful play → challenger pulls; masks are wild", () => {
    let s = rig([["sun", "mask"], ["moon"]], { bullets: [5, 5] });
    s = applyAction(s, playIds(s, 0, ["sun", "mask"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    expect(s.lastResolution!.truthful).toBe(true);
    expect(s.lastResolution!.pulls).toEqual([{ seat: 1, chamber: 0, hit: false }]);
    expect(s.players[1].shots).toBe(1);
    expect(s.phase).toBe("reveal");
  });
  it("one fake card makes the whole play a lie → player pulls", () => {
    let s = rig([["sun", "moon"], ["moon"]]);
    s = applyAction(s, playIds(s, 0, ["sun", "moon"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    expect(s.lastResolution!.truthful).toBe(false);
    expect(s.lastResolution!.pulls[0].seat).toBe(0);
  });
  it("only the latest play can be challenged", () => {
    let s = rig([["moon"], ["sun"], ["star"]]);
    s = applyAction(s, playIds(s, 0, ["moon"])); // lie
    s = applyAction(s, playIds(s, 1, ["sun"])); // truth
    s = applyAction(s, { type: "liar", seat: 2 });
    expect(s.lastResolution!.accusedSeat).toBe(1);
    expect(s.lastResolution!.pulls[0].seat).toBe(2);
  });
  it("bullet chamber fires and eliminates; 6th pull always fires", () => {
    let s = rig([["moon"], ["sun"], ["sun"]], { shots: [2, 0, 0], bullets: [2, 5, 5] });
    s = applyAction(s, playIds(s, 0, ["moon"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    expect(s.lastResolution!.pulls[0]).toEqual({ seat: 0, chamber: 2, hit: true });
    expect(s.players[0].alive).toBe(false);
    expect(s.eliminationOrder).toEqual([0]);
    expect(pullDanger(0)).toBeCloseTo(1 / 6);
    expect(pullDanger(5)).toBe(1);
  });
  it("last survivor wins and rankings follow reverse elimination", () => {
    let s = rig([["moon"], ["sun"]], { bullets: [0, 5] });
    s = applyAction(s, playIds(s, 0, ["moon"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    expect(s.phase).toBe("gameOver");
    expect(s.winnerSeat).toBe(1);
    expect(computeRankings(s)).toEqual([{ seat: 1, rank: 1 }, { seat: 0, rank: 2 }]);
  });
});

describe("next round (§K)", () => {
  it("surviving shooter starts; fresh hands and pile", () => {
    let s = rig([["moon", "sun"], ["sun", "star"], ["star"]]);
    s = applyAction(s, playIds(s, 0, ["moon"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    s = applyAction(s, { type: "continue", seed: 5 });
    expect(s.phase).toBe("playing");
    expect(s.activeSeat).toBe(0);
    expect(s.pile).toEqual([]);
    expect(s.players.every((p) => p.hand.length === 5)).toBe(true);
    expect(s.roundNumber).toBe(2);
  });
  it("dead shooter → next survivor starts; dead get no cards", () => {
    let s = rig([["moon"], ["sun"], ["star"]], { bullets: [0, 5, 5] });
    s = applyAction(s, playIds(s, 0, ["moon"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    s = applyAction(s, { type: "continue", seed: 6 });
    expect(s.activeSeat).toBe(1);
    expect(s.players[0].hand).toHaveLength(0);
  });
  it("continue is ignored outside reveal", () => {
    const s = rig([["sun"], ["moon"]]);
    expect(applyAction(s, { type: "continue", seed: 1 })).toBe(s);
  });
});

describe("skull mode (§M)", () => {
  it("lone skull challenged → everyone but its owner pulls, challenger first", () => {
    let s = rig([["moon"], ["skull"], ["sun"], ["star"]], { active: 1, skullMode: true, bullets: [0, 5, 5, 0] });
    s = applyAction(s, playIds(s, 1, ["skull"]));
    s = applyAction(s, { type: "liar", seat: 2 });
    const r = s.lastResolution!;
    expect(r.skull).toBe(true);
    expect(r.pulls.map((p) => p.seat)).toEqual([2, 3, 0]);
    expect(s.eliminationOrder).toEqual([3, 0]);
    s = applyAction(s, { type: "continue", seed: 3 });
    expect(s.activeSeat).toBe(1); // skull owner starts
  });
  it("skull mixed with other cards is a lie", () => {
    let s = rig([["skull", "sun"], ["moon"]], { skullMode: true });
    s = applyAction(s, playIds(s, 0, ["skull", "sun"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    expect(s.lastResolution!.skull).toBe(false);
    expect(s.lastResolution!.truthful).toBe(false);
  });
  it("skull can kill everyone else — owner wins", () => {
    let s = rig([["skull"], ["moon"]], { skullMode: true, bullets: [5, 0] });
    s = applyAction(s, playIds(s, 0, ["skull"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    expect(s.phase).toBe("gameOver");
    expect(s.winnerSeat).toBe(0);
  });
});

describe("view secrecy (§Q)", () => {
  it("only my own hand is visible; bullets never exposed", () => {
    const s = startGame(4, 77);
    const v = getPlayerView(s, 2);
    expect(v[2].hand).toHaveLength(5);
    expect(v.filter((p) => p.seat !== 2).every((p) => p.hand === null && p.handCount === 5)).toBe(true);
    expect(JSON.stringify(v)).not.toContain("bullet");
  });
});

describe("bots (§W)", () => {
  it("hypergeometric helper sanity", () => {
    expect(hyperAtLeast(10, 10, 3, 3)).toBeCloseTo(1);
    expect(hyperAtLeast(10, 0, 3, 1)).toBe(0);
    expect(hyperAtLeast(20, 8, 5, 1)).toBeCloseTo(1 - (12 * 11 * 10 * 9 * 8) / (20 * 19 * 18 * 17 * 16));
  });
  it("full games finish for every player count, level and mode", () => {
    for (let n = 2; n <= 6; n++) {
      for (const skull of [false, true]) {
        for (const lv of [1, 5, 10]) {
          const s = runBotGame(n, n * 100 + lv + (skull ? 7 : 0), Array(n).fill(lv), skull);
          expect(s.phase).toBe("gameOver");
          expect(computeRankings(s)).toHaveLength(n);
          expect(new Set(computeRankings(s).map((r) => r.rank)).size).toBe(n);
        }
      }
    }
  });
  it("bots never read hidden info: swapping other hands (same counts) doesn't change their pick", () => {
    let differ = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = startGame(4, seed);
      s = applyAction(s, chooseBotAction(s, s.activeSeat, 10, () => 0.5)!);
      const me = s.activeSeat;
      const shuffled = {
        ...s,
        players: s.players.map((p) => (p.seat === me ? p : { ...p, hand: p.hand.map((c, i) => ({ ...c, kind: (["sun", "moon", "star"] as const)[(i + seed) % 3] })) })),
      };
      const a = JSON.stringify(chooseBotAction(s, me, 10, () => 0.5));
      const b = JSON.stringify(chooseBotAction(shuffled, me, 10, () => 0.5));
      if (a !== b) differ++;
    }
    expect(differ).toBe(0);
  });
  it("Lv.10 beats Lv.1 clearly in 4-player tables", () => {
    let wins = 0;
    const games = 200;
    for (let g = 0; g < games; g++) {
      const levels = [1, 1, 1, 1];
      const strong = g % 4;
      levels[strong] = 10;
      const s = runBotGame(4, 5000 + g, levels);
      if (s.winnerSeat === strong) wins++;
    }
    expect(wins / games).toBeGreaterThan(0.4); // 25% would be chance; self-play measured ~57%
  });
});

describe("stats", () => {
  it("tallies stay consistent with resolutions", () => {
    const s = runBotGame(4, 4242, [6, 6, 6, 6]);
    const ranks = computeRankings(s);
    const all = s.players.map((p) => bluffRouletteStatDetails(s, p.seat, ranks.find((r) => r.seat === p.seat)!.rank));
    const sum = (k: string) => all.reduce((n, d) => n + (d[k] ?? 0), 0);
    expect(sum("liarCorrect")).toBeLessThanOrEqual(sum("liarCalls"));
    expect(sum("liesCaught")).toBe(sum("liarCorrect"));
    expect(sum("triggerPulls") - sum("survivedPulls")).toBe(s.eliminationOrder.length);
    expect(sum("flawlessWins")).toBeLessThanOrEqual(1);
  });
});

describe("showdown timeline (§J pull steps)", () => {
  it("each pull walks grab → open → notch → close → raise → cock → hold → fire in order", async () => {
    const { buildTimeline, pullStep } = await import("./timeline");
    let s = rig([["skull"], ["moon"], ["sun"], ["star"]], { skullMode: true });
    s = applyAction(s, playIds(s, 0, ["skull"]));
    s = applyAction(s, { type: "liar", seat: 1 });
    const tl = buildTimeline(s.lastResolution!);
    expect(tl.pulls).toHaveLength(3);
    for (const p of tl.pulls) {
      const beats = [p.liftAt, p.openAt, p.spinAt, p.closeAt, p.raiseAt, p.cockAt, p.holdAt, p.fireAt, p.lowerAt, p.endAt];
      for (let i = 1; i < beats.length; i++) expect(beats[i]).toBeGreaterThan(beats[i - 1]);
      const seen = [p.liftAt, p.openAt, p.spinAt, p.closeAt, p.raiseAt, p.cockAt, p.holdAt, p.fireAt, p.lowerAt].map((x) => pullStep(p, x + 0.001));
      expect(seen).toEqual(["grab", "open", "notch", "close", "raise", "cock", "hold", "fire", "after"]);
    }
    // pulls never overlap; later skull pulls are faster than the first
    for (let j = 1; j < tl.pulls.length; j++) expect(tl.pulls[j].liftAt).toBeGreaterThanOrEqual(tl.pulls[j - 1].endAt);
    expect(tl.pulls[1].endAt - tl.pulls[1].liftAt).toBeLessThan(tl.pulls[0].endAt - tl.pulls[0].liftAt);
    expect(tl.total).toBeGreaterThan(tl.pulls[2].endAt);
  });
});

describe("cosmetics from the network", () => {
  it("avatars only accept offered options, else the seat default", async () => {
    const { sanitizeAvatar, defaultAvatar, COATS } = await import("./cosmetics");
    expect(sanitizeAvatar({ hat: "top", coat: COATS[3].id, accessory: "scarf", skin: "#8f5d3e" }, 2)).toEqual({ hat: "top", coat: COATS[3].id, accessory: "scarf", skin: "#8f5d3e" });
    expect(sanitizeAvatar({ hat: "crown", coat: "red", accessory: 5, skin: "<script>" }, 1)).toEqual(defaultAvatar(1));
    expect(sanitizeAvatar(null, 4)).toEqual(defaultAvatar(4));
  });
  it("emotes must name a real seat and kind", async () => {
    const { sanitizeEmote } = await import("./cosmetics");
    expect(sanitizeEmote({ seat: 1, kind: "clap", id: 5 }, 4)).toEqual({ seat: 1, kind: "clap", id: 5 });
    expect(sanitizeEmote({ seat: 4, kind: "clap", id: 5 }, 4)).toBeNull();
    expect(sanitizeEmote({ seat: 1.5, kind: "clap", id: 5 }, 4)).toBeNull();
    expect(sanitizeEmote({ seat: 1, kind: "dance", id: 5 }, 4)).toBeNull();
    expect(sanitizeEmote("clap", 4)).toBeNull();
  });
});
