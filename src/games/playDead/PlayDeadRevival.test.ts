import { describe, expect, it } from "vitest";
import {
  aliveChance,
  applyAction,
  BANDAGE_COST,
  intelValid,
  isMedkitRound,
  legalMoves,
  MEDKIT_ROUND,
  moveHash,
  nextMedkitRound,
  pendingSeats,
  startGame,
  survivalChance,
  type DmgRange,
  type GameState,
  type Move,
  type SeatState,
} from "./engine";
import { buildFx, describeEvents, fightersAt, SHOW } from "./show";

function play(state: GameState, moves: Record<number, Move>): GameState {
  let s = state;
  const pick = (seat: number): Move => moves[seat] ?? (s.seats[seat].down ? { kind: "hold" } : { kind: "reload" });
  for (const seat of pendingSeats(s)) s = applyAction(s, { type: "COMMIT", seat, round: s.round, hash: moveHash(pick(seat), `salt${seat}`) });
  for (const seat of pendingSeats(s)) s = applyAction(s, { type: "REVEAL", seat, round: s.round, move: pick(seat), salt: `salt${seat}` });
  return s;
}
const withSeats = (state: GameState, patch: Partial<SeatState>[]): GameState => ({ ...state, seats: state.seats.map((s, i) => ({ ...s, ...(patch[i] ?? {}) })) });
const corpse: Partial<SeatState> = { down: true, dead: true, hp: 0, hits: [[2, 3]], diedRound: 1, ammo: 3 };
const faker: Partial<SeatState> = { down: true, dead: false, hp: 1, hits: [[1, 2]], ammo: 3 };
const healOf = (s: GameState, seat: number) => s.events.find((e) => e.t === "heal" && e.seat === seat);

describe("play-dead revival — 🩹 bandage", () => {
  it("is offered to a body with ammo before its breath runs out — the same to corpses and fakers", () => {
    const s = withSeats(startGame(3, 1), [corpse, faker]);
    const kinds = (st: GameState, seat: number) => legalMoves(st, seat).map((m) => `${m.kind}:${m.target ?? ""}`).sort();
    expect(kinds(s, 0)).toContain("bandage:");
    expect(legalMoves(s, 1).some((m) => m.kind === "bandage")).toBe(true);
    expect(legalMoves(withSeats(s, [{ ammo: BANDAGE_COST - 1 }]), 0).some((m) => m.kind === "bandage")).toBe(false);
    // 숨 참기 한도(3) 직전엔 못 감는다 — "한도보다 오래 누워 있으면 시체" 추리가 그대로 맞게
    expect(legalMoves(withSeats(s, [{ lie: 2 }]), 0).some((m) => m.kind === "bandage")).toBe(false);
    expect(legalMoves(s, 2).some((m) => m.kind === "bandage")).toBe(false);
    // 같은 공개 상태면 시체와 죽은 척이 받는 메뉴가 똑같다
    const asFaker = withSeats(s, [{ dead: false, hp: 1 }]);
    expect(kinds(asFaker, 0)).toEqual(kinds(s, 0));
  });

  it("a corpse comes back with 1 life about half the time, still lying down", () => {
    let revived = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const s = play(withSeats(startGame(3, seed), [corpse]), { 0: { kind: "bandage" } });
      const me = s.seats[0];
      expect(me.down).toBe(true);
      expect(me.ammo).toBe(3 - BANDAGE_COST);
      expect(me.heals).toEqual([1]);
      const h = healOf(s, 0);
      expect(h).toMatchObject({ t: "heal", source: "bandage" });
      if (!me.dead) {
        revived++;
        expect(me.hp).toBe(1);
        expect(me.diedRound).toBeNull();
        expect(h).toMatchObject({ result: "revived" });
      } else expect(h).toMatchObject({ result: "failed" });
    }
    expect(revived / N).toBeGreaterThan(0.4);
    expect(revived / N).toBeLessThan(0.6);
  });

  it("a faker heals +1 (capped at 3)", () => {
    const s = play(withSeats(startGame(3, 2), [{}, faker]), { 1: { kind: "bandage" } });
    expect(s.seats[1]).toMatchObject({ hp: 2, dead: false, down: true, lie: 1 });
    expect(healOf(s, 1)).toMatchObject({ result: "healed" });
    const full = play(withSeats(startGame(3, 2), [{}, { ...faker, hp: 3 }]), { 1: { kind: "bandage" } });
    expect(full.seats[1].hp).toBe(3);
  });

  it("a finisher catches a bandaging corpse first — confirmed, no revive", () => {
    const s = play(withSeats(startGame(3, 3), [corpse, { ammo: 2 }]), { 0: { kind: "bandage" }, 1: { kind: "finish", target: 0 } });
    expect(s.seats[0]).toMatchObject({ confirmed: true, dead: true });
    expect(healOf(s, 0)).toBeUndefined();
  });
});

describe("play-dead revival — 🎁 medkit drop", () => {
  it("drops on fixed rounds only", () => {
    expect(isMedkitRound(MEDKIT_ROUND - 1)).toBe(false);
    expect(isMedkitRound(MEDKIT_ROUND)).toBe(true);
    expect(nextMedkitRound(1)).toBe(MEDKIT_ROUND);
    expect(nextMedkitRound(MEDKIT_ROUND + 1)).toBeGreaterThan(MEDKIT_ROUND + 1);
    expect(isMedkitRound(nextMedkitRound(MEDKIT_ROUND + 1))).toBe(true);
  });

  it("lands on one body at the end of that round, and nowhere when nobody is down", () => {
    const at = (s: GameState): GameState => ({ ...s, round: MEDKIT_ROUND });
    const s = play(at(withSeats(startGame(3, 4), [corpse])), {});
    expect(healOf(s, 0)).toMatchObject({ t: "heal", source: "medkit" });
    expect(s.seats[0].heals).toEqual([1]);
    const none = play(at(startGame(3, 4)), {});
    expect(none.events.some((e) => e.t === "heal")).toBe(false);
  });
});

describe("play-dead revival — public odds stay exact", () => {
  /** brute force over every damage roll and revive coin, with the engine's rules */
  function brute(hits: DmgRange[], heals: number[], hp = 3): number {
    type Path = [sum: number, dead: boolean, p: number];
    const healAll = (paths: Path[], i: number): Path[] => {
      let out = paths;
      for (const h of heals) {
        if (h !== i) continue;
        out = out.flatMap(([s, d, p]): Path[] => (d ? [[hp - 1, false, p / 2], [s, true, p / 2]] : [[Math.max(0, s - 1), false, p]]));
      }
      return out;
    };
    let paths: Path[] = [[0, false, 1]];
    hits.forEach(([lo, hi], i) => {
      paths = healAll(paths, i).flatMap(([s, d, p]): Path[] => {
        const out: Path[] = [];
        for (let v = lo; v <= hi; v++) out.push([s + v, d || s + v >= hp, p / (hi - lo + 1)]);
        return out;
      });
    });
    paths = healAll(paths, hits.length);
    return paths.reduce((a, [, d, p]) => a + (d ? 0 : p), 0);
  }
  const cases: [DmgRange[], number[]][] = [
    [[[2, 3]], [1]],
    [[[1, 2], [2, 3]], [2]],
    [[[2, 3], [1, 1]], [1]],
    [[[1, 2], [1, 2], [1, 1]], [1, 3, 3]],
    [[[3, 4]], [1, 1]],
  ];
  it.each(cases)("hits %j heals %j", (hits, heals) => {
    expect(survivalChance(hits, 3, heals)).toBeCloseTo(brute(hits, heals), 10);
  });

  it("a bandage shows up in everyone's odds, and stale 🩺 intel is dropped", () => {
    let s = withSeats(startGame(3, 5), [{}, { ...corpse, ammo: 2 }, { augs: ["stethoscope"], intel: { 1: { dead: true, hits: 1 } } }]);
    expect(aliveChance(s, 1, 0)).toBeCloseTo(0.5, 10); // 2~3 on 3 lives: 50% dead
    expect(intelValid(s.seats[2], 1, s.seats[1])).toBe(true);
    const before = aliveChance(s, 1, 0);
    s = play(s, { 1: { kind: "bandage" } });
    expect(aliveChance(s, 1, 0)).toBeCloseTo(before + (1 - before) * 0.5, 10);
    expect(intelValid(s.seats[2], 1, s.seats[1])).toBe(s.seats[2].intel[1]?.hits === 2);
  });
});

describe("play-dead revival — nothing leaks on other screens", () => {
  const find = (want: "revived" | "failed") => {
    for (let seed = 1; seed < 200; seed++) {
      const s = play(withSeats(startGame(3, seed), [corpse]), { 0: { kind: "bandage" } });
      const h = healOf(s, 0);
      if (h?.t === "heal" && h.result === want) return s;
    }
    throw new Error("no seed");
  };
  it("fx, poses and log lines for others are identical whether the corpse revived or not", () => {
    const a = find("revived");
    const b = find("failed");
    const prev = withSeats(startGame(3, 1), [corpse]).seats;
    const names = { 0: "A", 1: "B", 2: "C" };
    const strip = (fx: ReturnType<typeof buildFx>) => fx.map(({ key, ...r }) => (void key, r));
    expect(strip(buildFx(a, 1))).toEqual(strip(buildFx(b, 1)));
    for (const e of [0, SHOW.fall + 0.5, SHOW.end + 1]) {
      const pa = fightersAt(a, prev, 1, names, e, [false, false, false]).map((f) => [f.pose, f.blood]);
      const pb = fightersAt(b, prev, 1, names, e, [false, false, false]).map((f) => [f.pose, f.blood]);
      expect(pa).toEqual(pb);
    }
    const heal = (s: GameState, v: number) => describeEvents(s, names, v).filter((l) => l.text.includes("붕대"));
    expect(heal(a, 1)).toEqual(heal(b, 1));
    expect(heal(a, 0)[0].text).toContain("숨이 돌아왔다");
    expect(heal(b, 0)[0].text).not.toContain("숨이 돌아왔다");
  });
});
