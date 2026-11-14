import { describe, expect, it } from "vitest";
import {
  applyAction,
  cellAt,
  computeRankings,
  EXIT,
  isLegal,
  KEYS_PER_SEAT,
  LAYOUTS,
  legalTargets,
  moveHash,
  pickTarget,
  previewMonster,
  startGame,
  startOf,
  W,
  H,
  xy,
  type Move,
  type NightState,
} from "./engine";
import { chooseBotMove } from "./bot";
import { hushNightStatDetails } from "./stats";
import { hushNightCues } from "./hushNightSound";

/** Commit + reveal everyone's moves (seat order). */
function play(s: NightState, moves: Move[]): NightState {
  moves.forEach((m, seat) => {
    s = applyAction(s, { type: "commit", seat, step: s.step, hash: moveHash(m, `salt${seat}`) });
  });
  moves.forEach((m, seat) => {
    if (s.phase === "reveal") s = applyAction(s, { type: "reveal", seat, step: s.step, move: m, salt: `salt${seat}` });
  });
  return s;
}
const adv = (s: NightState) => applyAction(s, { type: "advance", step: s.step });
const hush: Move = { kind: "hush" };

describe("setup", () => {
  it("layouts are symmetric under every rotation / mirror and leave the hatch open", () => {
    for (const l of LAYOUTS) {
      const set = new Set(l.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of l) {
        for (const [a, b] of [
          [6 - x, y],
          [x, 6 - y],
          [y, x],
        ])
          expect(set.has(`${a},${b}`)).toBe(true);
      }
      expect(set.has("3,3")).toBe(false);
    }
  });

  it("every seat gets the same mirrored keys around its corner", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = startGame(4, seed);
      expect(s.keys.length).toBe(4 * KEYS_PER_SEAT);
      expect(new Set(s.keys).size).toBe(s.keys.length);
      for (const k of s.keys) expect(s.blocked.includes(k)).toBe(false);
      const near = (seat: number) =>
        s.keys
          .map((k) => Math.abs(xy(k).x - xy(startOf(seat)).x) + Math.abs(xy(k).y - xy(startOf(seat)).y))
          .sort((a, b) => a - b)
          .slice(0, KEYS_PER_SEAT);
      for (let seat = 1; seat < 4; seat++) expect(near(seat)).toEqual(near(0));
    }
  });
});

describe("rules", () => {
  it("walk = 1 step, run = exactly 2, throw within 4, pebbles run out", () => {
    const s = startGame(2, 3);
    expect(legalTargets(s, 0, "walk").length).toBeGreaterThan(0);
    for (const c of legalTargets(s, 0, "run")) expect(legalTargets(s, 0, "walk")).not.toContain(c);
    expect(isLegal(s, 0, { kind: "walk", to: cellAt(3, 3) })).toBe(false);
    const dry = { ...s, seats: s.seats.map((x) => ({ ...x, pebbles: 0 })) };
    expect(legalTargets(dry, 0, "throw")).toEqual([]);
  });

  it("commit hides the move; a reveal that doesn't match the hash counts as hush", () => {
    let s = startGame(2, 5);
    const to = legalTargets(s, 0, "walk")[0];
    s = applyAction(s, { type: "commit", seat: 0, step: s.step, hash: moveHash({ kind: "walk", to }, "a") });
    s = applyAction(s, { type: "commit", seat: 1, step: s.step, hash: moveHash(hush, "b") });
    expect(s.phase).toBe("reveal");
    s = applyAction(s, { type: "reveal", seat: 0, step: s.step, move: { kind: "run", to: legalTargets(s, 0, "run")[0] }, salt: "a" });
    s = applyAction(s, { type: "reveal", seat: 1, step: s.step, move: hush, salt: "b" });
    expect(s.phase).toBe("resolved");
    expect(s.seats[0].at).toBe(startOf(0));
  });

  it("time-outs: no commit = hush; a missing reveal = hush", () => {
    let s = startGame(3, 6);
    s = applyAction(s, { type: "commit", seat: 0, step: s.step, hash: moveHash(hush, "x") });
    s = adv(s);
    expect(s.phase).toBe("reveal");
    s = adv(s);
    expect(s.phase).toBe("resolved");
    expect(s.last?.moves.every((m) => m.kind === "hush")).toBe(true);
  });

  it("stepping on a key picks it up; carrying it to the hatch banks it", () => {
    let s = startGame(2, 7);
    const key = s.keys[0];
    const near = legalTargets(s, 0, "walk")[0];
    s = { ...s, keys: [near, ...s.keys.slice(1)], monster: cellAt(6, 6) };
    s = play(s, [{ kind: "walk", to: near }, hush]);
    expect(s.seats[0].carry).toBe(1);
    expect(s.last?.picked).toContain(0);
    // teleport next to the hatch and walk in
    s = adv(s);
    const beside = cellAt(3, 2);
    s = { ...s, seats: s.seats.map((x, i) => (i === 0 ? { ...x, at: beside } : x)), blocked: [], monster: cellAt(6, 6) };
    s = play(s, [{ kind: "walk", to: EXIT }, hush]);
    expect(s.seats[0].banked).toBe(1);
    expect(s.seats[0].carry).toBe(0);
    expect(key).toBeDefined();
  });

  it("the monster goes for the loudest sound it can hear and catches anyone it sweeps", () => {
    const bs = new Set<number>();
    const m = cellAt(3, 3);
    expect(pickTarget(m, [{ at: cellAt(3, 5), level: 1, seat: 0, why: "walk" }], bs)?.seat).toBe(0);
    expect(pickTarget(m, [{ at: cellAt(0, 0), level: 1, seat: 0, why: "walk" }], bs)).toBeNull();
    expect(pickTarget(m, [{ at: cellAt(3, 5), level: 1, seat: 0, why: "walk" }, { at: cellAt(0, 3), level: 4, seat: 1, why: "throw" }], bs)?.seat).toBe(1);

    let s = startGame(2, 8);
    s = { ...s, blocked: [], round: 3, monster: cellAt(3, 3), seats: s.seats.map((x, i) => (i === 0 ? { ...x, at: cellAt(3, 6), carry: 2 } : x)) };
    s = play(s, [{ kind: "walk", to: cellAt(3, 5) }, hush]);
    expect(s.last?.caught).toContain(0);
    expect(s.seats[0].at).toBe(startOf(0));
    expect(s.seats[0].carry).toBe(0);
    expect(s.keys.length).toBeGreaterThanOrEqual(2);
  });

  it("the monster sleeps through round 1", () => {
    let s = startGame(2, 9);
    const before = s.monster;
    s = play(s, [{ kind: "run", to: legalTargets(s, 0, "run")[0] }, hush]);
    expect(s.monster).toBe(before);
    expect(previewMonster(s, 0, hush).path).toEqual([]);
  });

  it("ends after the last round; ranks by banked keys then fewer catches", () => {
    let s = startGame(2, 10, { rounds: 10, helper: true });
    for (let i = 0; i < 100 && s.phase !== "ended"; i++) s = s.phase === "choose" ? play(s, [hush, hush]) : adv(s);
    expect(s.phase).toBe("ended");
    expect(s.round).toBe(10);
    const t = { ...s, seats: s.seats.map((x, i) => ({ ...x, banked: 2, caught: i })) };
    expect(computeRankings(t).map((r) => r.seat)).toEqual([0, 1]);
  });
});

describe("bots, stats, sound", () => {
  it("bots only make legal moves and the grid stays in bounds", () => {
    let s = startGame(4, 11);
    for (let i = 0; i < 300 && s.phase !== "ended"; i++) {
      if (s.phase === "choose") {
        const moves = s.seats.map((_, seat) => chooseBotMove(s, seat, (seat * 3) % 10 + 1));
        moves.forEach((m, seat) => expect(isLegal(s, seat, m)).toBe(true));
        const prev = s;
        s = play(s, moves);
        expect(hushNightCues(0)(prev, s).length).toBeGreaterThan(0);
      } else s = adv(s);
      expect(s.monster).toBeGreaterThanOrEqual(0);
      expect(s.monster).toBeLessThan(W * H);
    }
    expect(s.phase).toBe("ended");
    const d = hushNightStatDetails(s, 0);
    expect(d.hushes + d.walks + d.runs + d.throws).toBeGreaterThan(0);
  });
});
