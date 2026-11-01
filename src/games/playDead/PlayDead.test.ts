import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  aliveChance,
  applyAction,
  computeRankings,
  legalMoves,
  moveHash,
  pendingSeats,
  startGame,
  type GameState,
  type Move,
  type SeatState,
} from "./engine";
import { chooseBotMove, scoreMove } from "./bot";

/** Commit + reveal every seat's move and resolve the round. */
function play(state: GameState, moves: Record<number, Move>): GameState {
  let s = state;
  for (const seat of pendingSeats(s)) {
    const m = moves[seat] ?? (s.seats[seat].down ? { kind: "hold" } : { kind: "charge" });
    s = applyAction(s, { type: "COMMIT", seat, round: s.round, hash: moveHash(m, `salt${seat}`) });
  }
  for (const seat of pendingSeats(s)) {
    const m = moves[seat] ?? (s.seats[seat].down ? { kind: "hold" } : { kind: "charge" });
    s = applyAction(s, { type: "REVEAL", seat, round: s.round, move: m, salt: `salt${seat}` });
  }
  return s;
}

function next(state: GameState): GameState {
  return state.phase === "resolved" ? applyAction(state, { type: "TIMEOUT", stage: state.stage }) : state;
}

function withSeats(state: GameState, patch: Partial<SeatState>[]): GameState {
  return { ...state, seats: state.seats.map((s, i) => ({ ...s, ...(patch[i] ?? {}) })) };
}

describe("play-dead engine", () => {
  it("starts everyone standing with 3 lives and no ki", () => {
    const s = startGame(4, 7);
    expect(s.seats.every((x) => x.hp === 3 && x.ki === 0 && !x.down && x.hits.length === 0)).toBe(true);
  });

  it("rolls hidden damage inside the public range, the same on every device", () => {
    const s0 = withSeats(startGame(2, 21), [{ ki: 3 }]);
    const a = play(s0, { 0: { kind: "energy", target: 1 } });
    const b = play(s0, { 0: { kind: "energy", target: 1 } });
    const hit = a.events.find((e) => e.t === "blast")!;
    expect(hit.t === "blast" && hit.hit!.dmg).toBeGreaterThanOrEqual(2);
    expect(a.seats[1].hits).toEqual([[2, 3]]);
    expect(a.seats[1].hp).toBe(b.seats[1].hp);
    expect(a.seats[1].hp).toBe(3 - (hit.t === "blast" ? hit.hit!.dmg : 0));
  });

  it("charges, then a blast knocks the target down whether or not it survived", () => {
    let s = startGame(3, 1);
    s = next(play(s, {}));
    expect(s.seats.map((x) => x.ki)).toEqual([1, 1, 1]);
    s = withSeats(s, [{ hp: 3 }, { hp: 1 }, { hp: 3 }]);
    s = play(s, { 0: { kind: "pa", target: 1 }, 2: { kind: "pa", target: 0 } });
    // both hit: seat 1 dies, seat 0 survives — both lie down the same way
    expect(s.seats[0]).toMatchObject({ down: true, dead: false, hits: [[1, 1]], hp: 2 });
    expect(s.seats[1]).toMatchObject({ down: true, dead: true, hits: [[1, 1]] });
    expect(s.events.find((e) => e.t === "fall")).toEqual({ t: "fall", seats: [0, 1] });
  });

  it("block stops pa/jangpung, energy pierces for 1, and nobody blocks twice in a row", () => {
    let s = withSeats(startGame(2, 3), [{ ki: 5 }]);
    s = next(play(s, { 0: { kind: "jangpung", target: 1 }, 1: { kind: "block" } }));
    expect(s.seats[1].hits).toEqual([]);
    expect(legalMoves(s, 1).some((m) => m.kind === "block")).toBe(false);
    s = next(play(s, { 0: { kind: "charge" }, 1: { kind: "charge" } }));
    expect(legalMoves(s, 1).some((m) => m.kind === "block")).toBe(true);
    s = withSeats(s, [{ ki: 3 }, { blockStreak: 0 }]);
    s = play(s, { 0: { kind: "energy", target: 1 }, 1: { kind: "block" } });
    expect(s.seats[1]).toMatchObject({ hits: [[1, 1]], down: true, hp: 2 });
  });

  it("mutual blasts: equal tiers cancel, the higher tier wins", () => {
    let s = withSeats(startGame(2, 4), [{ ki: 2 }, { ki: 2 }]);
    const clash = play(s, { 0: { kind: "pa", target: 1 }, 1: { kind: "pa", target: 0 } });
    expect(clash.seats.every((x) => x.hits.length === 0)).toBe(true);
    s = play(s, { 0: { kind: "jangpung", target: 1 }, 1: { kind: "pa", target: 0 } });
    expect(s.seats[0].hits).toEqual([]);
    expect(s.seats[1].hits).toEqual([[1, 2]]);
  });

  it("a living body ambushes its looter; a finisher exposes a fake corpse", () => {
    let s = withSeats(startGame(3, 5), [{ down: true, ki: 2 }, {}, { ki: 1 }]);
    const looted = play(s, { 0: { kind: "ambush", target: 1 }, 1: { kind: "loot", target: 0 } });
    expect(looted.seats[1]).toMatchObject({ hits: [[2, 3]], down: true });
    expect(looted.seats[0].down).toBe(false);
    s = play(s, { 0: { kind: "hold" }, 2: { kind: "finish", target: 0 } });
    expect(s.seats[0]).toMatchObject({ hits: [[1, 2]], down: true, confirmed: false });
    expect(s.events.some((e) => e.t === "finish" && e.result === "exposed")).toBe(true);
  });

  it("a real corpse can be looted for 2 ki and confirmed; confirmed seats stop acting", () => {
    let s = withSeats(startGame(3, 6), [{ down: true, dead: true, hp: 0, ki: 4, hits: [[2, 3], [1, 1]] }, { ki: 1 }, {}]);
    s = play(s, { 1: { kind: "finish", target: 0 }, 2: { kind: "loot", target: 0 } });
    expect(s.seats[0].confirmed).toBe(true);
    expect(s.seats[2].ki).toBe(2);
    s = next(s);
    expect(pendingSeats(s)).toEqual([1, 2]);
  });

  it("a faker who lies three rounds is forced up by the breath limit", () => {
    let s = withSeats(startGame(3, 8), [{ down: true }]);
    for (let r = 0; r < 2; r++) s = next(play(s, { 0: { kind: "hold" } }));
    expect(s.seats[0].lie).toBe(2);
    s = play(s, { 0: { kind: "hold" } });
    expect(s.seats[0].down).toBe(false);
    expect(s.events.some((e) => e.t === "rise" && e.reason === "breath")).toBe(true);
  });

  it("ends when one player is truly alive and ranks later deaths higher", () => {
    let s = withSeats(startGame(3, 9), [{ ki: 3 }, { hp: 1 }, { hp: 1, ki: 1 }]);
    s = play(s, { 0: { kind: "energy", target: 1 }, 2: { kind: "block" } });
    expect(s.phase).toBe("resolved");
    s = next(s);
    s = withSeats(s, [{ ki: 1 }]);
    s = play(s, { 0: { kind: "pa", target: 2 } });
    expect(s.phase).toBe("ended");
    expect(computeRankings(s)).toEqual([
      { seat: 0, rank: 1 },
      { seat: 2, rank: 2 },
      { seat: 1, rank: 3 },
    ]);
  });

  it("a timed-out seat charges (or holds when down) by default", () => {
    let s = startGame(3, 10);
    s = applyAction(s, { type: "COMMIT", seat: 0, round: 1, hash: moveHash({ kind: "block" }, "a") });
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("revealing");
    s = applyAction(s, { type: "REVEAL", seat: 0, round: 1, move: { kind: "block" }, salt: "a" });
    expect(s.phase).toBe("resolved");
    expect(s.seats.map((x) => x.ki)).toEqual([0, 1, 1]);
    expect(s.idleStreak).toEqual([0, 1, 1]);
  });

  it("a forged reveal falls back to the default move", () => {
    let s = withSeats(startGame(2, 11), [{ ki: 3 }]);
    s = applyAction(s, { type: "COMMIT", seat: 0, round: 1, hash: moveHash({ kind: "charge" }, "a") });
    s = applyAction(s, { type: "COMMIT", seat: 1, round: 1, hash: moveHash({ kind: "charge" }, "b") });
    s = applyAction(s, { type: "REVEAL", seat: 0, round: 1, move: { kind: "energy", target: 1 }, salt: "a" });
    s = applyAction(s, { type: "REVEAL", seat: 1, round: 1, move: { kind: "charge" }, salt: "b" });
    expect(s.seats[1].hits).toEqual([]);
    expect(s.seats[0].ki).toBe(4);
  });

  it("from the surge round every hit range grows by one", () => {
    const s = withSeats({ ...startGame(2, 22), round: 8 }, [{ ki: 1 }]);
    expect(play(s, { 0: { kind: "pa", target: 1 } }).seats[1].hits).toEqual([[2, 2]]);
  });

  it("alive chance follows the public damage ranges", () => {
    const s = withSeats(startGame(4, 12), [{}, { down: true, hits: [[1, 1]] }, { down: true, hits: [[1, 2], [1, 1]] }, { down: true, hits: [[2, 3], [1, 1]] }]);
    expect(aliveChance(s, 1)).toBe(1);
    expect(aliveChance(s, 2)).toBe(0.5);
    expect(aliveChance(s, 3)).toBe(0);
    expect(aliveChance(s, 0)).toBe(1);
    // a faker would have been forced up by now
    expect(aliveChance(withSeats(s, [{}, { lie: 3 }]), 1)).toBe(0);
  });
});

describe("play-dead bots", () => {
  it("always return a legal move while acting", () => {
    const s = withSeats(startGame(4, 13), [{ ki: 3 }, { down: true }, { ki: 1 }]);
    for (let seat = 0; seat < 4; seat++) {
      const m = chooseBotMove(s, seat, 5, seededRng(seat));
      expect(m).not.toBeNull();
      expect(legalMoves(s, seat).some((x) => x.kind === m!.kind && x.target === m!.target)).toBe(true);
    }
  });

  it("never read another seat's hidden life", () => {
    const base = withSeats(startGame(4, 14), [{ ki: 2 }, { down: true, hits: [[1, 2]] }, { ki: 1 }, {}]);
    const flipped = withSeats(base, [{}, { dead: true, hp: 0 }, { hp: 1 }, { hp: 3 }]);
    for (const m of legalMoves(base, 0)) expect(scoreMove(flipped, 0, m)).toBe(scoreMove(base, 0, m));
  });

  it("level 10 takes the best-scored move where level 1's blunder path doesn't", () => {
    const s = withSeats(startGame(3, 15), [{ ki: 3 }, { hits: [[1, 2]] }, {}]);
    const zero = () => 0;
    const best = chooseBotMove(s, 0, 10, zero)!;
    const top = legalMoves(s, 0).reduce((a, b) => (scoreMove(s, 0, b) > scoreMove(s, 0, a) ? b : a));
    expect(best).toEqual(top);
    expect(chooseBotMove(s, 0, 1, zero)).toEqual(legalMoves(s, 0)[0]);
  });

  it("bot-only games always finish", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const n = 2 + (seed % 5);
      const rng = seededRng(seed * 31);
      let s = startGame(n, seed);
      let guard = 0;
      while (s.phase !== "ended" && guard++ < 500) {
        if (s.phase === "resolved") {
          s = next(s);
          continue;
        }
        const moves: Record<number, Move> = {};
        for (const seat of pendingSeats(s)) moves[seat] = chooseBotMove(s, seat, 1 + (seat % 10), rng)!;
        s = play(s, moves);
      }
      expect(s.phase, `seed ${seed}`).toBe("ended");
      expect(computeRankings(s).length).toBe(n);
    }
  });
});
