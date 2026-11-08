import { describe, expect, it } from "vitest";
import {
  applyAction,
  autoMove,
  BAG,
  checkPlace,
  cogHeight,
  computeRankings,
  currentActor,
  deckFor,
  exposedOf,
  forecastsFor,
  FRAGILE_BONUS,
  isSupported,
  legalPlacements,
  limitOf,
  passCost,
  pointsFor,
  previewPlace,
  resolveSpill,
  spillPick,
  startGame,
  torqueOf,
  turnsFor,
  type CargoState,
  type Crate,
  type Placed,
} from "./engine";
import { chooseBotAction } from "./bot";
import { cargoStackStatDetails } from "./stats";
import { cargoStackCues } from "./cargoStackSound";

let nextId = 1;
function crate(kind: Crate["kind"], len: Crate["len"], w: number): Crate {
  return { id: nextId++, kind, len, w };
}
function placed(c: Crate, x: number, y: number, owner = 0, pts = pointsFor(c, y)): Placed {
  return { ...c, x, y, owner, pts };
}
/** A state with a hand-built deck / dock for rule checks. */
function withDock(s: CargoState, dock: Crate[], deck: Placed[] = []): CargoState {
  return { ...s, dock, deck };
}

describe("setup", () => {
  it("bag is 20 crates with the advertised mix", () => {
    expect(BAG.length).toBe(20);
    const count = (k: string) => BAG.filter((b) => b.kind === k).length;
    expect([count("box"), count("steel"), count("fragile"), count("gold")]).toEqual([13, 3, 2, 2]);
  });

  it("turns per voyage by player count", () => {
    expect([1, 2, 3, 4, 5, 6].map(turnsFor)).toEqual([10, 8, 6, 5, 4, 4]);
  });

  it("deck is deterministic, unique ids, covers every turn + dock", () => {
    const a = deckFor(42, 1, 4);
    const b = deckFor(42, 1, 4);
    expect(a).toEqual(b);
    expect(a.length).toBe(4 * 5 + 3);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    expect(deckFor(43, 1, 4)).not.toEqual(a);
  });

  it("forecast: last voyage is never calm; weather off = all calm", () => {
    for (let seed = 0; seed < 50; seed++) expect(forecastsFor(seed, 3, true)[2]).not.toBe("calm");
    expect(forecastsFor(7, 3, false)).toEqual(["calm", "calm", "calm"]);
  });

  it("startGame lays out the first voyage", () => {
    const s = startGame(3, 9);
    expect(s.dock.length).toBe(3);
    expect(s.pile.length).toBe(3 * 6);
    expect(s.turnsLeft).toEqual([6, 6, 6]);
    expect(currentActor(s)).toBe(0);
    expect(s.phase).toBe("load");
  });
});

describe("stacking (§4)", () => {
  it("drops to the highest covered column", () => {
    const deck = [placed(crate("box", 1, 1), 3, 0)];
    expect(checkPlace(deck, 2, 3)).toEqual({ ok: true, y: 1 });
    expect(checkPlace(deck, 2, 4)).toEqual({ ok: true, y: 0 });
  });

  it("rejects off-edge and over the top tier", () => {
    expect(checkPlace([], 3, 7).ok).toBe(false);
    const tower = Array.from({ length: 6 }, (_, y) => placed(crate("box", 1, 1), 0, y));
    const r = checkPlace(tower, 1, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toBe("full");
  });

  it("centre-of-support rule: 2-wide may overhang half, 3-wide needs centre or both ends", () => {
    const one = [placed(crate("box", 1, 1), 4, 0)];
    expect(isSupported(one, 2, 4, 1)).toBe(true); // half overhang
    expect(isSupported(one, 3, 4, 1)).toBe(false); // only the left end held
    expect(isSupported(one, 3, 3, 1)).toBe(true); // centre held
    const ends = [placed(crate("box", 1, 1), 2, 0), placed(crate("box", 1, 1), 4, 0)];
    expect(isSupported(ends, 3, 2, 1)).toBe(true);
  });
});

describe("balance (§6)", () => {
  it("torque and limit", () => {
    const deck = [placed(crate("box", 1, 2), 0, 0), placed(crate("box", 2, 3), 7, 0)];
    // 2 × (0 − 4) + 3 × (7.5 − 4) = −8 + 10.5
    expect(torqueOf(deck, 0)).toBeCloseTo(2.5);
    expect(torqueOf(deck, -3)).toBeCloseTo(-0.5);
    expect(cogHeight(deck)).toBeCloseTo(0.5);
    expect(limitOf(deck)).toBeCloseTo(14);
    expect(limitOf([])).toBe(15);
  });

  it("limit shrinks with height, floored at 6", () => {
    const tower = Array.from({ length: 6 }, (_, y) => placed(crate("box", 1, 1), 4, y));
    expect(limitOf(tower)).toBe(15 - 2 * 3);
    const top = [placed(crate("box", 1, 1), 4, 0), placed(crate("steel", 1, 6), 4, 5)];
    expect(limitOf(top)).toBe(6);
  });

  it("exposed / spill pick takes the highest crate on the low side, outermost first", () => {
    const a = placed(crate("box", 1, 1), 8, 0);
    const b = placed(crate("box", 1, 1), 7, 0);
    const c = placed(crate("box", 1, 1), 7, 1);
    const deck = [a, b, c];
    expect(exposedOf(deck).map((p) => p.id).sort()).toEqual([a.id, c.id].sort());
    expect(spillPick(deck, 1)?.id).toBe(c.id);
    expect(spillPick([a, b], 1)?.id).toBe(a.id);
  });

  it("an edge steel crate on an empty ship slides straight off and costs the placer", () => {
    const s0 = startGame(2, 1);
    const steel = crate("steel", 2, 6);
    const s = withDock(s0, [steel, crate("box", 1, 1), crate("box", 1, 1)]);
    const o = previewPlace(s, 0, 0, 7);
    // 6 × 3.5 = 21 > 15
    expect(o.spilled.map((p) => p.id)).toEqual([steel.id]);
    expect(o.capsized).toBe(false);
    expect(o.deltas[0]).toBe(-2); // +6 then −6 lost −2 fine
    const next = applyAction(s, { type: "place", seat: 0, slot: 0, x: 7 });
    expect(next.scores[0]).toBe(-2);
    expect(next.deck.length).toBe(0);
    expect(next.statTally?.[0]?.spills).toBe(1);
    expect(next.statTally?.[0]?.lost).toBe(1);
  });

  it("capsizes when three spills are not enough", () => {
    // a heavily right-leaning ship held by ballast... build: three light exposed on the right, heavy buried
    const heavy = [placed(crate("steel", 2, 6), 7, 0, 1), placed(crate("steel", 2, 6), 7, 1, 1)];
    const lights = [placed(crate("box", 1, 1), 6, 0, 1), placed(crate("box", 1, 1), 6, 1, 1)];
    const cap = [placed(crate("box", 3, 3), 6, 2, 1)];
    const deck = [...heavy, ...lights, ...cap];
    const res = resolveSpill(deck, 6, 0, 3);
    expect(res.over).toBe(true);
    const s = withDock({ ...startGame(2, 1), ballast: 6 }, [crate("box", 1, 2), crate("box", 1, 1), crate("box", 1, 1)], deck.slice(0, 4));
    const o = previewPlace(s, 0, 0, 8);
    expect(o.capsized).toBe(true);
    const next = applyAction(s, { type: "place", seat: 0, slot: 0, x: 8 });
    expect(next.phase).toBe("depart");
    expect(next.departure?.capsized).toBe(true);
    expect(next.statTally?.[0]?.capsizes).toBe(1);
  });
});

describe("special crates", () => {
  it("gold scores double", () => {
    expect(pointsFor({ kind: "gold", w: 2 }, 2)).toBe(12);
    expect(pointsFor({ kind: "box", w: 2 }, 2)).toBe(6);
  });

  it("3t+ right on a fragile crate breaks it (owner loses, crusher −2)", () => {
    const glass = placed(crate("fragile", 1, 1), 4, 0, 1);
    const s = withDock({ ...startGame(2, 1), scores: [0, glass.pts] }, [crate("box", 1, 3), crate("box", 1, 2), crate("box", 1, 1)], [glass]);
    const o = previewPlace(s, 0, 0, 4);
    expect(o.crushed.map((c) => c.id)).toEqual([glass.id]);
    expect(o.deltas).toEqual([3 * 2 - 2, -1]);
    const light = previewPlace(s, 0, 1, 4);
    expect(light.crushed).toEqual([]);
  });

  it("intact fragile crates pay +4 at departure", () => {
    let s = startGame(1, 5, { voyages: 1, weather: false });
    s = withDock(s, [crate("fragile", 1, 1), crate("box", 1, 1), crate("box", 1, 1)]);
    s = { ...s, turnsLeft: [1], pile: [] };
    s = applyAction(s, { type: "place", seat: 0, slot: 0, x: 4 });
    expect(s.phase).toBe("ended");
    expect(s.scores[0]).toBe(1 + FRAGILE_BONUS);
    expect(s.departure?.fragile.length).toBe(1);
  });
});

describe("turns, ballast, pass, voyages", () => {
  it("ballast once per voyage, shifts the torque by 3", () => {
    let s = startGame(2, 3);
    s = applyAction(s, { type: "ballast", seat: 0, dir: 1 });
    expect(s.ballast).toBe(3);
    expect(s.ballastUsed[0]).toBe(true);
    expect(s.active).toBe(1);
    const again = applyAction({ ...s, active: 0 }, { type: "ballast", seat: 0, dir: 1 });
    expect(again.ballast).toBe(3);
  });

  it("pass costs 1 unless forced", () => {
    let s = startGame(2, 3);
    expect(passCost(s, 0)).toBe(1);
    s = applyAction(s, { type: "pass", seat: 0 });
    expect(s.scores[0]).toBe(-1);
    const full = { ...s, active: 0, ballastUsed: [true, false], dock: [null, null, crate("box", 3, 3)], deck: Array.from({ length: 9 }, (_, c) => Array.from({ length: 6 }, (_, y) => placed(crate("box", 1, 1), c, y))).flat() };
    expect(legalPlacements(full)).toEqual([]);
    expect(passCost(full, 0)).toBe(0);
  });

  it("rejects moves out of turn / invalid columns", () => {
    const s = startGame(2, 3);
    expect(applyAction(s, { type: "place", seat: 1, slot: 0, x: 0 })).toBe(s);
    expect(applyAction(s, { type: "place", seat: 0, slot: 0, x: 99 })).toBe(s);
    expect(applyAction(s, { type: "place", seat: 0, slot: 5, x: 0 })).toBe(s);
    expect(applyAction(s, { type: "sail", seat: 0 })).toBe(s);
  });

  it("timeout auto-places the safest crate, ignores a stale turn", () => {
    const s = startGame(2, 11);
    expect(applyAction(s, { type: "timeout", seat: 0, turn: 5 })).toBe(s);
    const m = autoMove(s, 0)!;
    const t = applyAction(s, { type: "timeout", seat: 0, turn: 0 });
    expect(t.turn).toBe(1);
    expect(t.lastEvent?.auto).toBe(true);
    expect(t.lastEvent?.slot).toBe(m.slot);
    expect(t.statTally?.[0]?.timeouts).toBe(1);
  });

  it("a voyage runs every seat's turns, then departs; lowest score starts next", () => {
    let s = startGame(2, 21, { voyages: 2, weather: false });
    let guard = 0;
    while (s.phase === "load" && guard++ < 100) {
      const a = currentActor(s)!;
      const m = autoMove(s, a);
      s = applyAction(s, m ? { type: "place", seat: a, ...m } : { type: "pass", seat: a });
    }
    expect(s.phase).toBe("depart");
    expect(s.departures.length).toBe(1);
    const low = s.scores[0] < s.scores[1] ? 0 : s.scores[1] < s.scores[0] ? 1 : 1;
    expect(s.nextStart).toBe(low);
    const sailed = applyAction(s, { type: "sail", seat: s.nextStart! });
    expect(sailed.phase).toBe("load");
    expect(sailed.voyage).toBe(1);
    expect(sailed.deck).toEqual([]);
    expect(sailed.active).toBe(low);
    expect(sailed.ballastUsed).toEqual([false, false]);
  });

  it("depart timeout sails on", () => {
    let s = startGame(1, 2, { voyages: 2 });
    s = { ...s, turnsLeft: [1] };
    const m = autoMove(s, 0)!;
    s = applyAction(s, { type: "place", seat: 0, ...m });
    expect(s.phase).toBe("depart");
    const t = applyAction(s, { type: "timeout", seat: 0, turn: s.turn });
    expect(t.voyage).toBe(1);
  });
});

describe("rankings, stats, sound cues", () => {
  it("ties broken by fewer lost crates", () => {
    const s = { ...startGame(3, 1), scores: [10, 10, 4], statTally: { 0: { lost: 2 }, 1: { lost: 0 } } };
    expect(computeRankings(s).map((r) => [r.seat, r.rank])).toEqual([
      [1, 1],
      [0, 2],
      [2, 3],
    ]);
    const tie = { ...s, statTally: {} };
    expect(computeRankings(tie).map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("bots always return a legal action and stats stay finite", () => {
    let s = startGame(4, 77);
    for (let i = 0; i < 400 && s.phase !== "ended"; i++) {
      const a = currentActor(s)!;
      const n = applyAction(s, chooseBotAction(s, a, ((i % 10) + 1) as 1, Math.random));
      expect(n).not.toBe(s);
      s = n;
    }
    expect(s.phase).toBe("ended");
    const d = cargoStackStatDetails(s, 0);
    for (const v of Object.values(d)) expect(Number.isFinite(v)).toBe(true);
    expect(d.maxScore).toBe(Math.max(0, s.scores[0]));
  });

  it("sound cues fire for placements and spills", () => {
    const s = startGame(2, 4);
    const cues = cargoStackCues(1);
    const m = autoMove(s, 0)!;
    const n = applyAction(s, { type: "place", seat: 0, ...m });
    const out = cues(s, n).map((c) => (typeof c === "string" ? c : c.name));
    expect(out).toContain("land");
    expect(out).toContain("turn");
  });
});
