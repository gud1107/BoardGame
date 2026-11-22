import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { CARD_COUNT, CLAIM_WINDOW_MS, DECK, dumpHand, FREEZE_MS, GRAB_ROUNDS, INTRO_MS, LATENCY_ALLOW_MS, MIN_FIND_MS, REVEAL_MS, SYMBOL_NAMES, SYMBOLS, cardLayout, commonSymbol, type Mode } from "./data";
import { answerFor, applyAction, createGame, score, tick, topCard, type PairState } from "./engine";
import { botMedianFind, createBotMemory, runBots } from "./bots";

const T0 = 1_000_000;

function start(mode: Mode, n: number, seed = 1) {
  const s = createGame({ playerCount: n, mode, seed, now: T0, rng: seededRng(seed) });
  return tick(s, T0 + INTRO_MS);
}

/** A symbol on `seat`'s card that is not the answer. */
function wrongSym(s: PairState, seat: number) {
  const ans = answerFor(s, seat);
  return DECK[topCard(s, seat)!].find((x) => x !== ans)!;
}

function runAll(mode: Mode, n: number, level: number, seed: number) {
  const rng = seededRng(seed * 31 + 7);
  let s = createGame({ playerCount: n, mode, seed, now: T0, rng: seededRng(seed) });
  const bots = new Map(Array.from({ length: n }, (_, i) => [i, level]));
  const mem = createBotMemory();
  let now = T0;
  while (s.phase !== "finished" && now < T0 + 20 * 60_000) {
    now += 20;
    s = tick(s, now);
    for (const a of runBots(s, now, bots, mem, rng)) s = applyAction(s, a, now);
  }
  return { s, ms: now - T0 };
}

describe("deck (order-7 projective plane)", () => {
  it("57 cards × 8 distinct symbols, every pair shares exactly one", () => {
    expect(DECK).toHaveLength(CARD_COUNT);
    expect(SYMBOLS).toHaveLength(CARD_COUNT);
    expect(SYMBOL_NAMES).toHaveLength(CARD_COUNT);
    expect(new Set(SYMBOLS).size).toBe(CARD_COUNT);
    for (const c of DECK) {
      expect(new Set(c).size).toBe(8);
      for (const x of c) expect(x >= 0 && x < CARD_COUNT).toBe(true);
    }
    for (let a = 0; a < CARD_COUNT; a++)
      for (let b = a + 1; b < CARD_COUNT; b++) {
        const shared = DECK[a].filter((x) => DECK[b].includes(x));
        expect(shared).toHaveLength(1);
        expect(commonSymbol(a, b)).toBe(shared[0]);
      }
  });

  it("every symbol appears on exactly 8 cards", () => {
    const count = Array(CARD_COUNT).fill(0);
    for (const c of DECK) for (const x of c) count[x]++;
    expect(count.every((c) => c === 8)).toBe(true);
  });

  it("layout is deterministic, holds the card's 8 symbols and stays inside the card", () => {
    const a = cardLayout(12, 345);
    expect(cardLayout(12, 345)).toEqual(a);
    expect(cardLayout(12, 346)).not.toEqual(a);
    expect(a.map((l) => l.sym).sort((x, y) => x - y)).toEqual([...DECK[12]].sort((x, y) => x - y));
    for (let c = 0; c < CARD_COUNT; c++)
      for (const l of cardLayout(c, 9)) {
        expect(Math.hypot(l.x, l.y) + l.scale * 9).toBeLessThan(50);
        expect(l.scale).toBeGreaterThanOrEqual(0.78);
      }
  });
});

describe("setup", () => {
  it.each([2, 3, 5, 8])("%i players: grab deals 1 card each, dump deals the hand, no card twice", (n) => {
    for (const mode of ["grab", "dump"] as Mode[]) {
      const s = createGame({ playerCount: n, mode, seed: n, now: T0, rng: seededRng(n) });
      const all = [...s.piles.flat(), s.center, ...s.deck];
      expect(new Set(all).size).toBe(all.length);
      if (mode === "grab") {
        expect(s.piles.every((p) => p.length === 1)).toBe(true);
        expect(s.roundsLeft).toBe(Math.min(GRAB_ROUNDS, CARD_COUNT - n));
      } else expect(s.piles.every((p) => p.length === dumpHand(n))).toBe(true);
    }
  });

  it("claims are ignored during the 3·2·1 intro", () => {
    const s = createGame({ playerCount: 2, mode: "grab", seed: 1, now: T0, rng: seededRng(1) });
    expect(applyAction(s, { type: "claim", seat: 0, sym: answerFor(s, 0)!, seq: 0, rt: 900 }, T0 + 100)).toBe(s);
  });
});

describe("claims", () => {
  it("a wrong symbol freezes the seat, and presses during the freeze are ignored", () => {
    const s = start("grab", 2);
    const at = T0 + INTRO_MS + 500;
    const f = applyAction(s, { type: "claim", seat: 0, sym: wrongSym(s, 0), seq: 0, rt: 500 }, at);
    expect(f.frozenUntil[0]).toBe(at + FREEZE_MS);
    expect(f.stats[0].wrong).toBe(1);
    expect(applyAction(f, { type: "claim", seat: 0, sym: answerFor(f, 0)!, seq: 0, rt: 900 }, at + 300)).toBe(f);
    const ok = applyAction(f, { type: "claim", seat: 0, sym: answerFor(f, 0)!, seq: 0, rt: 1800 }, at + FREEZE_MS);
    expect(ok.pending).toHaveLength(1);
  });

  it("a symbol only on the centre card (not mine) counts as wrong", () => {
    const s = start("grab", 2);
    const mine = DECK[topCard(s, 0)!];
    const onlyCenter = DECK[s.center].find((x) => !mine.includes(x))!;
    expect(applyAction(s, { type: "claim", seat: 0, sym: onlyCenter, seq: 0, rt: 900 }, T0 + INTRO_MS + 900).stats[0].wrong).toBe(1);
  });

  it("a claim for an old card (stale seq) is dropped without penalty", () => {
    const s = start("grab", 2);
    expect(applyAction(s, { type: "claim", seat: 0, sym: wrongSym(s, 0), seq: 5, rt: 900 }, T0 + INTRO_MS + 900)).toBe(s);
  });

  it("the shortest device reaction time inside the window wins, even if it arrived later", () => {
    let s = start("grab", 3);
    const t = T0 + INTRO_MS;
    s = applyAction(s, { type: "claim", seat: 0, sym: answerFor(s, 0)!, seq: 0, rt: 1500 }, t + 1550);
    s = applyAction(s, { type: "claim", seat: 1, sym: answerFor(s, 1)!, seq: 0, rt: 1400 }, t + 1550 + CLAIM_WINDOW_MS - 20);
    s = tick(s, t + 1550 + CLAIM_WINDOW_MS - 10);
    expect(s.phase).toBe("play");
    s = tick(s, t + 1550 + CLAIM_WINDOW_MS);
    expect(s.phase).toBe("reveal");
    expect(s.last!.winner).toBe(1);
    expect(s.last!.rivals).toEqual([0]);
    expect(s.stats[0].close).toBe(1);
  });

  it("a reported reaction time can't be shorter than host elapsed − allowance, nor the human floor", () => {
    const s = start("grab", 2);
    const t = T0 + INTRO_MS;
    const a = applyAction(s, { type: "claim", seat: 0, sym: answerFor(s, 0)!, seq: 0, rt: 50 }, t + 3000);
    expect(a.pending[0].rt).toBe(3000 - LATENCY_ALLOW_MS);
    const b = applyAction(s, { type: "claim", seat: 0, sym: answerFor(s, 0)!, seq: 0, rt: 10 }, t + 200);
    expect(b.pending[0].rt).toBe(MIN_FIND_MS);
  });

  it("grab: the winner takes the centre card, a new centre appears after the reveal", () => {
    let s = start("grab", 2);
    const t = T0 + INTRO_MS;
    const center = s.center;
    s = applyAction(s, { type: "claim", seat: 1, sym: answerFor(s, 1)!, seq: 0, rt: 1200 }, t + 1200);
    s = tick(s, t + 1200 + CLAIM_WINDOW_MS);
    expect(topCard(s, 1)).toBe(center);
    expect(s.center).not.toBe(center);
    expect(s.seq).toBe(1);
    s = tick(s, s.phaseAt + REVEAL_MS.grab);
    expect(s.phase).toBe("play");
    expect(s.centerAt).toBe(s.phaseAt);
  });

  it("dump: the winner's top card becomes the centre", () => {
    let s = start("dump", 2);
    const t = T0 + INTRO_MS;
    const mine = topCard(s, 0);
    const before = s.piles[0].length;
    s = applyAction(s, { type: "claim", seat: 0, sym: answerFor(s, 0)!, seq: 0, rt: 1200 }, t + 1200);
    s = tick(s, t + 1200 + CLAIM_WINDOW_MS);
    expect(s.center).toBe(mine);
    expect(s.piles[0].length).toBe(before - 1);
  });
});

describe("full games (all bots)", () => {
  it.each([2, 3, 4, 6, 8])("%i players finish in both modes with a sane ranking", (n) => {
    for (const mode of ["grab", "dump"] as Mode[]) {
      const { s, ms } = runAll(mode, n, 5, n * 11);
      expect(s.phase).toBe("finished");
      expect(s.ranking).toHaveLength(n);
      expect(new Set(s.ranking).size).toBe(n);
      expect(ms).toBeLessThan(6 * 60_000);
      if (mode === "grab") {
        const flipped = s.piles.reduce((a, p) => a + p.length - 1, 0);
        expect(flipped).toBe(Math.min(GRAB_ROUNDS, CARD_COUNT - n));
        for (let i = 1; i < n; i++) expect(score(s, s.ranking![i - 1])).toBeGreaterThanOrEqual(score(s, s.ranking![i]));
      } else {
        expect(s.piles[s.ranking![0]]).toHaveLength(0);
      }
    }
  });

  it("bot find times get faster with level", () => {
    for (let l = 2; l <= 10; l++) expect(botMedianFind(l)).toBeLessThan(botMedianFind(l - 1));
  });
});
