import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { AUG_BY_ID, AUG_ROUNDS, AUGMENTS, rollAugOffer, type AugId } from "./augments";
import { aliveChance, applyAction, legalMoves, moveHash, pendingSeats, startGame, type GameState, type Move, type SeatState } from "./engine";
import { chooseBotAugment, chooseBotMove } from "./bot";

const ON = { chooseSeconds: 15, maxRounds: 0, augments: true };

function play(state: GameState, moves: Record<number, Move>): GameState {
  let s = state;
  for (const seat of pendingSeats(s)) {
    const m = moves[seat] ?? (s.seats[seat].down ? { kind: "hold" } : { kind: "reload" });
    s = applyAction(s, { type: "COMMIT", seat, round: s.round, hash: moveHash(m, `salt${seat}`) });
  }
  for (const seat of pendingSeats(s)) {
    const m = moves[seat] ?? (s.seats[seat].down ? { kind: "hold" } : { kind: "reload" });
    s = applyAction(s, { type: "REVEAL", seat, round: s.round, move: m, salt: `salt${seat}` });
  }
  return s;
}

function withSeats(state: GameState, patch: Partial<SeatState>[]): GameState {
  return { ...state, seats: state.seats.map((s, i) => ({ ...s, ...(patch[i] ?? {}) })) };
}

/** 증강 없이 시작해 자리마다 증강을 바로 쥐여 준다 */
function armed(n: number, seed: number, augs: AugId[][], patch: Partial<SeatState>[] = []): GameState {
  const s = startGame(n, seed);
  return withSeats(s, s.seats.map((_, i) => ({ augs: augs[i] ?? [], ...(patch[i] ?? {}) })));
}

describe("play-dead augments", () => {
  it("opens a same-tier 3-card offer before round 1 and applies picks once everyone chose", () => {
    let s = startGame(3, 42, ON);
    expect(s.phase).toBe("augment");
    const tier = s.aug!.tier;
    for (const o of s.aug!.offers) {
      expect(o).toHaveLength(3);
      expect(new Set(o).size).toBe(3);
      expect(o.every((id) => AUG_BY_ID[id].tier === tier)).toBe(true);
    }
    expect(pendingSeats(s)).toEqual([0, 1, 2]);
    s = applyAction(s, { type: "AUG_PICK", seat: 0, round: 1, id: s.aug!.offers[0][1] });
    // not on your list → ignored
    const bogus = AUGMENTS.find((a) => !s.aug!.offers[1].includes(a.id))!.id;
    expect(applyAction(s, { type: "AUG_PICK", seat: 1, round: 1, id: bogus })).toBe(s);
    // picks stay off the public seat state until everyone chose
    expect(s.seats[0].augs).toEqual([]);
    s = applyAction(s, { type: "AUG_PICK", seat: 1, round: 1, id: s.aug!.offers[1][0] });
    s = applyAction(s, { type: "AUG_PICK", seat: 2, round: 1, id: s.aug!.offers[2][2] });
    expect(s.phase).toBe("choosing");
    expect(s.seats.every((x) => x.augs.length === 1)).toBe(true);
  });

  it("is deterministic across devices and off by default", () => {
    expect(startGame(4, 7, ON)).toEqual(startGame(4, 7, ON));
    expect(startGame(4, 7).phase).toBe("choosing");
  });

  it("rerolls once into different cards, timeout picks the first card", () => {
    let s = startGame(2, 9, ON);
    const before = s.aug!.offers[0];
    s = applyAction(s, { type: "AUG_REROLL", seat: 0, round: 1 });
    expect(s.aug!.offers[0].some((id) => before.includes(id))).toBe(false);
    expect(applyAction(s, { type: "AUG_REROLL", seat: 0, round: 1 })).toBe(s);
    const first = s.aug!.offers[1][0];
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("choosing");
    expect(s.seats[1].augs).toEqual([first]);
    expect(s.idleStreak).toEqual([1, 1]);
  });

  it("opens again on later augment rounds and never offers an owned card", () => {
    let s = startGame(2, 3, ON);
    let guard = 0;
    while (s.round < AUG_ROUNDS[2] && guard++ < 50) {
      if (s.phase === "augment") {
        for (const seat of pendingSeats(s)) s = applyAction(s, { type: "AUG_PICK", seat, round: s.round, id: s.aug!.offers[seat][0] });
      } else if (s.phase === "resolved") s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
      else s = play(s, { 0: { kind: "cover" }, 1: { kind: "cover" } });
      if (s.phase === "augment") for (const [i, o] of s.aug!.offers.entries()) expect(o.some((id) => s.seats[i].augs.includes(id))).toBe(false);
    }
    expect(s.round).toBe(AUG_ROUNDS[2]);
    expect(s.phase).toBe("augment");
    expect(s.seats[0].augs).toHaveLength(2);
    expect(rollAugOffer(1, 1, 0, 1, [], 0)).toHaveLength(3);
  });

  it("armour shrinks the public range and still knocks you down", () => {
    const shot = play(armed(2, 1, [[], ["helmet"]], [{ ammo: 1 }, { shield: 1 }]), { 0: { kind: "shot", target: 1 } });
    // the helmet is spent on the next hit even when that hit is too small for it
    expect(shot.seats[1]).toMatchObject({ hits: [[1, 1]], down: true, shield: 0 });
    const s = play(armed(2, 1, [[], ["helmet"]], [{ ammo: 3 }, { shield: 1 }]), { 0: { kind: "grenade", target: 1 } });
    expect(s.seats[1]).toMatchObject({ hits: [[1, 2]], down: true, shield: 0 });
    const p = play(armed(2, 2, [[], ["plate"]], [{ ammo: 3 }]), { 0: { kind: "grenade", target: 1 } });
    expect(p.seats[1].hits).toEqual([[2, 2]]);
  });

  it("heavy grenades cost 2, coroner finishes for free, bandolier raises the cap", () => {
    const s = armed(3, 4, [["heavy", "coroner"]], [{ ammo: 2 }, { down: true }]);
    expect(legalMoves(s, 0).some((m) => m.kind === "grenade")).toBe(true);
    const z = withSeats(s, [{ ammo: 0 }]);
    expect(legalMoves(z, 0).some((m) => m.kind === "finish")).toBe(true);
    const b = play(armed(2, 5, [["bandolier"]], [{ ammo: 5 }]), {});
    expect(b.seats[0].ammo).toBe(6);
  });

  it("tripwire hurts whoever loots the body — even a real corpse", () => {
    const s = play(armed(3, 6, [["tripwire"]], [{ down: true, dead: true, hp: 0, hits: [[2, 3], [1, 1]], ammo: 2 }]), { 1: { kind: "loot", target: 0 } });
    expect(s.seats[1]).toMatchObject({ down: true, ammo: 2 });
    expect(s.seats[1].hits).toEqual([[1, 2]]);
    expect(s.events.some((e) => e.t === "aug" && e.id === "tripwire" && e.target === 1)).toBe(true);
  });

  it("quickdraw wins an equal-tier shootout; counter-sniper answers a blocked shot", () => {
    const q = play(armed(2, 7, [["quickdraw"]], [{ ammo: 1 }, { ammo: 1 }]), { 0: { kind: "shot", target: 1 }, 1: { kind: "shot", target: 0 } });
    expect(q.seats[0].hits).toEqual([]);
    expect(q.seats[1].hits).toEqual([[1, 1]]);
    const c = play(armed(2, 8, [[], ["counterSniper"]], [{ ammo: 1 }]), { 0: { kind: "shot", target: 1 }, 1: { kind: "cover" } });
    expect(c.seats[1].hits).toEqual([]);
    expect(c.seats[0]).toMatchObject({ hits: [[1, 2]], down: true });
  });

  it("AP rounds let a burst pierce cover; frag splashes another standing player", () => {
    const a = play(armed(2, 9, [["apRounds"]], [{ ammo: 2 }]), { 0: { kind: "burst", target: 1 }, 1: { kind: "cover" } });
    expect(a.seats[1].hits).toEqual([[1, 1]]);
    const f = play(armed(3, 10, [["frag"]], [{ ammo: 3 }]), { 0: { kind: "grenade", target: 1 } });
    expect(f.seats[2].hits).toEqual([[1, 1]]);
  });

  it("camo/understudy raise the public lie limit used by alive chance", () => {
    const s = armed(3, 11, [[], ["camo"], ["understudy"]], [{}, { down: true, lie: 3, hits: [[1, 1]] }, { down: true, lie: 4, hits: [[1, 1]] }]);
    expect(aliveChance(s, 1)).toBe(1);
    expect(aliveChance(s, 2)).toBe(1);
    expect(aliveChance(withSeats(s, [{}, { lie: 4 }]), 1)).toBe(0);
  });

  it("stethoscope learns one downed seat's truth — only its owner's view changes", () => {
    let s = armed(3, 12, [["stethoscope"]], [{}, { down: true, dead: true, hp: 0, hits: [[1, 2], [1, 1]] }]);
    s = play(s, {});
    expect(s.seats[0].intel[1]).toEqual({ dead: true, hits: 2 });
    expect(aliveChance(s, 1, 0)).toBe(0);
    expect(aliveChance(s, 1, 2)).toBeGreaterThan(0);
  });

  it("scavenger and adrenaline pay out ammo", () => {
    const sc = play(armed(2, 13, [["scavenger"]], [{ ammo: 2 }]), { 0: { kind: "burst", target: 1 } });
    expect(sc.seats[0].ammo).toBe(1);
    const ad = play(armed(2, 14, [["adrenaline"]], [{ down: true }]), { 0: { kind: "rise" } });
    expect(ad.seats[0].ammo).toBe(3);
    // understudy: the corpse pockets ammo exactly like a faker would
    const un = play(armed(3, 15, [["understudy"], ["understudy"]], [{ down: true }, { down: true, dead: true, hp: 0, hits: [[2, 3], [1, 1]] }]), {});
    expect([un.seats[0].ammo, un.seats[1].ammo]).toEqual([1, 1]);
    // camo: nothing to loot
    const ca = play(armed(2, 16, [[], ["camo"]], [{}, { down: true, ammo: 3 }]), { 0: { kind: "loot", target: 1 } });
    expect([ca.seats[0].ammo, ca.seats[1].ammo]).toEqual([0, 3]);
  });

  it("bot-only augment games always finish with bots picking legal cards", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const n = 2 + (seed % 5);
      const rng = seededRng(seed * 17);
      let s = startGame(n, seed, ON);
      let guard = 0;
      while (s.phase !== "ended" && guard++ < 500) {
        if (s.phase === "resolved") {
          s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
          continue;
        }
        if (s.phase === "augment") {
          for (const seat of pendingSeats(s)) {
            const id = chooseBotAugment(s, seat, 1 + (seat % 10), rng)!;
            expect(s.aug!.offers[seat]).toContain(id);
            s = applyAction(s, { type: "AUG_PICK", seat, round: s.round, id });
          }
          continue;
        }
        const moves: Record<number, Move> = {};
        for (const seat of pendingSeats(s)) moves[seat] = chooseBotMove(s, seat, 1 + (seat % 10), rng)!;
        s = play(s, moves);
      }
      expect(s.phase, `seed ${seed}`).toBe("ended");
    }
  });
});
