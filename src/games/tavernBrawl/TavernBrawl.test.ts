import { describe, expect, it } from "vitest";
import { baseInstance, simulateCombat, type CombatSide, type UnitInstance } from "./combat";
import {
  applyAction,
  computeRankings,
  effectivePool,
  getValidMoves,
  pendingSeats,
  startGame,
  totalCopies,
  winnerSeats,
  type EngineAction,
  type GameState,
} from "./engine";
import { chooseBotAction } from "./bot";
import { playBotGame } from "./sim";
import { TRIBE_ORDER, unitDef, type HeroId } from "./units";
import { TRIBES_PER_GAME } from "./engine";

let n = 0;
const unit = (defId: string, patch: Partial<UnitInstance> = {}): UnitInstance => ({ ...baseInstance(defId, false, `u${n++}`), ...patch });
const side = (board: UnitInstance[], hero: HeroId | null = null, tier = 1): CombatSide => ({ board, hero, tier });

function pickHeroes(st: GameState): GameState {
  let s = st;
  for (let seat = 0; seat < s.seatCount; seat++) s = applyAction(s, { type: "PICK_HERO", seat, hero: s.seats[seat].heroOptions[0] });
  return s;
}

describe("combat", () => {
  it("is deterministic for the same seed", () => {
    const a = side([unit("b_wolfmom"), unit("n_rogue"), unit("k_guardian")]);
    const b = side([unit("e_wind"), unit("u_keeper"), unit("d_flame")]);
    const r1 = simulateCombat(a, b, 42, true);
    const r2 = simulateCombat(a, b, 42, true);
    expect(r1.winner).toBe(r2.winner);
    expect(r1.frames).toEqual(r2.frames);
    expect(r1.frames.at(-1)?.ev.t).toBe("end");
  });

  it("does not mutate the input boards", () => {
    const a = side([unit("b_dog")]);
    const b = side([unit("d_whelp")]);
    const before = JSON.stringify([a, b]);
    simulateCombat(a, b, 1);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it("taunt is attacked first", () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = simulateCombat(side([unit("n_merc")]), side([unit("b_dog", { uid: "dog" }), unit("k_squire", { uid: "taunt" })]), seed, true);
      const firstAttack = r.frames.find((f) => f.ev.t === "attack" && f.ev.side === (f.sides[0].some((u) => u.defId === "n_merc") ? 0 : 1));
      if (firstAttack && firstAttack.ev.t === "attack" && firstAttack.ev.from.startsWith("u")) expect(firstAttack.ev.to).toBe("taunt");
    }
  });

  it("shield blocks the first hit, poison kills through anything else", () => {
    // 2/3 보호막 vs 3/2: 첫 피해를 막고 반격으로 이긴다
    const r = simulateCombat(side([unit("k_guardian")]), side([unit("b_dog")]), 3);
    expect(r.winner).toBe(0);
    // 1/2 독 vs 거대 유닛: 둘 다 죽어 무승부
    const p = simulateCombat(side([unit("n_rogue")]), side([unit("n_merc", { atk: 20, hp: 50 })]), 3);
    expect(p.winner).toBe(null);
  });

  it("reborn and deathrattle summon after death", () => {
    const r = simulateCombat(side([unit("u_skeleton")]), side([unit("n_merc")]), 5, true);
    const summoned = r.frames.some((f) => f.sides.some((s) => s.some((u) => u.defId === "u_skeleton" && u.hp === 1 && !u.kw.includes("reborn"))));
    expect(summoned).toBe(true);
    const w = simulateCombat(side([unit("b_wolfmom")]), side([unit("n_merc")]), 5, true);
    expect(w.frames.some((f) => f.sides.some((s) => s.some((u) => u.defId === "t_wolf")))).toBe(true);
  });

  it("cleave hits neighbours", () => {
    const r = simulateCombat(side([unit("e_storm", { atk: 10, hp: 100 })]), side([unit("d_whelp"), unit("d_whelp"), unit("d_whelp")]), 9);
    expect(r.winner).toBe(0);
  });

  it("empty vs empty is a draw, empty loses to anything", () => {
    expect(simulateCombat(side([]), side([]), 1).winner).toBe(null);
    expect(simulateCombat(side([]), side([unit("b_dog")]), 1).winner).toBe(1);
  });

  it("damage = winner tavern tier + surviving unit tiers", () => {
    const r = simulateCombat(side([unit("n_merc"), unit("n_merc")], null, 3), side([unit("t_bunny")]), 1);
    expect(r.winner).toBe(0);
    expect(r.survivorTiers).toBe(6);
  });
});

describe("shop", () => {
  it("hero pick → round 1 shop with 3 gold and 3 slots", () => {
    const st = pickHeroes(startGame(4, 7));
    expect(st.phase).toBe("shop");
    expect(st.round).toBe(1);
    for (const s of st.seats) {
      expect(s.gold).toBe(3);
      expect(s.shop.length).toBe(3);
      expect(s.shop.every((id) => id && unitDef(id).tier === 1)).toBe(true);
    }
  });

  it("buy, play, sell move gold and units", () => {
    let st = pickHeroes(startGame(2, 11));
    const id = st.seats[0].shop[0]!;
    st = applyAction(st, { type: "BUY", seat: 0, round: 1, slot: 0 });
    expect(st.seats[0].gold).toBe(0);
    expect(st.seats[0].hand.map((u) => u.defId)).toEqual([id]);
    expect(effectivePool(st, st.seats[0])[id]).toBe(st.pool[id] - 1);
    const uid = st.seats[0].hand[0].uid;
    st = applyAction(st, { type: "PLAY", seat: 0, round: 1, uid, index: 0 });
    expect(st.seats[0].board).toHaveLength(1);
    const before = st.seats[0].gold;
    st = applyAction(st, { type: "SELL", seat: 0, round: 1, uid });
    expect(st.seats[0].gold).toBeGreaterThan(before);
    expect(st.seats[0].board).toHaveLength(0);
  });

  it("rejects illegal actions without changing state", () => {
    const st = pickHeroes(startGame(2, 12));
    expect(applyAction(st, { type: "UPGRADE", seat: 0, round: 1 })).toBe(st); // 3골드 < 5
    expect(applyAction(st, { type: "BUY", seat: 0, round: 2, slot: 0 })).toBe(st); // 지난/다음 라운드
    expect(applyAction(st, { type: "SELL", seat: 0, round: 1, uid: "nope" })).toBe(st);
    expect(applyAction(st, { type: "TIMEOUT", stage: st.stage - 1 })).toBe(st);
  });

  it("three copies become a golden unit; playing it queues a discover", () => {
    let st = pickHeroes(startGame(2, 13));
    const s = structuredClone(st);
    s.seats[0].hand = [unit("b_dog", { atk: 4 }), unit("b_dog")];
    s.seats[0].shop = ["b_dog", null, null];
    st = applyAction(s, { type: "BUY", seat: 0, round: 1, slot: 0 });
    const hand = st.seats[0].hand;
    expect(hand).toHaveLength(1);
    expect(hand[0].golden).toBe(true);
    expect(hand[0].atk).toBe(3 * 2 + 1); // 기본 2배 + 쌓인 버프
    st = applyAction(st, { type: "PLAY", seat: 0, round: 1, uid: hand[0].uid, index: 0 });
    expect(st.seats[0].discover).toHaveLength(1);
    expect(st.seats[0].discover[0].every((id) => unitDef(id).tier === 2)).toBe(true);
    st = applyAction(st, { type: "DISCOVER", seat: 0, round: 1, pick: 0 });
    expect(st.seats[0].hand).toHaveLength(1);
    expect(st.seats[0].stats.triples).toBe(1);
  });

  it("is order-independent across seats (lockstep safety)", () => {
    const st = pickHeroes(startGame(3, 21));
    const a: EngineAction[] = [
      { type: "BUY", seat: 0, round: 1, slot: 0 },
      { type: "REROLL", seat: 0, round: 1 },
    ];
    const b: EngineAction[] = [
      { type: "BUY", seat: 1, round: 1, slot: 1 },
      { type: "FREEZE", seat: 1, round: 1 },
    ];
    const run = (list: EngineAction[]) => list.reduce(applyAction, st);
    const x = run([...a, ...b]);
    const y = run([b[0], a[0], b[1], a[1]]);
    expect(x).toEqual(y);
  });

  it("every valid move is accepted", () => {
    let st = pickHeroes(startGame(4, 31));
    for (let r = 0; r < 3; r++) {
      for (const m of getValidMoves(st, 0)) {
        if (m.type === "READY") continue;
        expect(applyAction(st, m)).not.toBe(st);
      }
      st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
      st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
    }
  });
});

describe("rounds", () => {
  it("everyone ready → combat → everyone done → next shop with more gold", () => {
    let st = pickHeroes(startGame(4, 41));
    for (let seat = 0; seat < 4; seat++) st = applyAction(st, { type: "READY", seat, round: 1 });
    expect(st.phase).toBe("combat");
    expect(st.combats).toHaveLength(2);
    expect(pendingSeats(st)).toEqual([0, 1, 2, 3]);
    for (let seat = 0; seat < 4; seat++) st = applyAction(st, { type: "COMBAT_DONE", seat, round: 1 });
    expect(st.phase).toBe("shop");
    expect(st.round).toBe(2);
    expect(st.seats.every((s) => s.gold === 4)).toBe(true);
    expect(st.seats.every((s) => s.upCost === 4)).toBe(true);
  });

  it("odd player count fights a ghost", () => {
    let st = pickHeroes(startGame(5, 51));
    st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
    expect(st.combats).toHaveLength(3);
    expect(st.combats.filter((c) => c.b === -1)).toHaveLength(1);
  });

  it("pool never goes negative and returns sold copies", () => {
    const st = pickHeroes(startGame(8, 61));
    for (const s of st.seats) for (const v of Object.values(effectivePool(st, s))) expect(v).toBeGreaterThanOrEqual(0);
    const any = Object.keys(st.pool)[0];
    expect(st.pool[any]).toBe(totalCopies(any, 8));
  });

  it.each([2, 3, 5, 8])("%i bots finish a game with consistent placements", (players) => {
    const { state } = playBotGame(Array(players).fill(5), 100 + players);
    expect(state.phase).toBe("ended");
    expect(winnerSeats(state).length).toBeGreaterThanOrEqual(1);
    const ranks = computeRankings(state).map((r) => r.rank);
    expect(ranks.every((r) => r >= 1 && r <= players)).toBe(true);
    expect(state.round).toBeGreaterThan(3);
    expect(state.round).toBeLessThan(40);
  });

  it("bot batch replays to the same state it planned against", () => {
    let st = pickHeroes(startGame(4, 71));
    st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
    st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
    const a = chooseBotAction(st, 2, 10, () => 0.3);
    expect(a?.type).toBe("BATCH");
    const next = applyAction(st, a!);
    expect(next.seats[2].ready).toBe(true);
  });

  it("Lv.10 bots place better than Lv.1 bots", () => {
    let hi = 0;
    let lo = 0;
    for (let g = 0; g < 8; g++) {
      const levels = g % 2 ? [10, 1, 10, 1] : [1, 10, 1, 10];
      const { state } = playBotGame(levels, 900 + g);
      state.seats.forEach((s, i) => (levels[i] === 10 ? (hi += s.place!) : (lo += s.place!)));
    }
    expect(hi).toBeLessThan(lo);
  });
});

describe("tribes in play & classes", () => {
  it("each game draws 7 distinct tribes and shops only offer those (or neutrals)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      let st = pickHeroes(startGame(8, seed));
      expect(new Set(st.tribesInPlay).size).toBe(TRIBES_PER_GAME);
      for (const t of st.tribesInPlay) expect(TRIBE_ORDER).toContain(t);
      for (let r = 0; r < 4; r++) {
        for (const seat of st.seats) {
          for (const id of seat.shop) {
            const t = id ? unitDef(id).tribe : null;
            if (t) expect(st.tribesInPlay).toContain(t);
          }
        }
        st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
        st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
      }
      expect(Object.keys(st.pool).every((id) => !unitDef(id).tribe || st.tribesInPlay.includes(unitDef(id).tribe!))).toBe(true);
    }
  });

  it("assassins (2+) take no counter-damage when they attack", () => {
    const r = simulateCombat(side([unit("u_crow", { uid: "a1" }), unit("u_crow", { uid: "a2" })]), side([unit("n_merc", { uid: "m", atk: 5, hp: 40 })]), 4, true);
    for (let i = 1; i < r.frames.length; i++) {
      const ev = r.frames[i].ev;
      if (ev.t !== "attack" || !ev.from.startsWith("a")) continue;
      const before = r.frames[i - 1].sides.flat().find((u) => u.uid === ev.from)!;
      const after = r.frames[i].sides.flat().find((u) => u.uid === ev.from)!;
      expect(after.hp).toBe(before.hp);
    }
  });

  it("windfury attacks twice in a row", () => {
    const r = simulateCombat(side([unit("s_octo", { uid: "w", hp: 50 })]), side([unit("n_merc", { atk: 1, hp: 60 })]), 9, true);
    const attacks = r.frames.filter((f) => f.ev.t === "attack").map((f) => (f.ev.t === "attack" ? f.ev.from : ""));
    const i = attacks.indexOf("w");
    expect(attacks[i + 1]).toBe("w");
  });

  it("rangers (2+) open with a volley", () => {
    const r = simulateCombat(side([unit("sy_elf"), unit("n_sniper")]), side([unit("n_merc", { hp: 60 })]), 2, true);
    expect(r.frames.some((f) => f.ev.t === "soc" && f.ev.label.includes("선제 사격"))).toBe(true);
  });

  it("demon synergy costs 1 HP at each shop start", () => {
    let st = pickHeroes(startGame(2, 81));
    const s = structuredClone(st);
    s.seats[0].board = [unit("dm_imp"), unit("dm_boar")];
    s.seats[0].hp = 20;
    st = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    const lost = 20 - st.seats[0].hp;
    st = applyAction(st, { type: "TIMEOUT", stage: st.stage });
    expect(st.phase).toBe("shop");
    expect(20 - st.seats[0].hp).toBe(lost + 1);
  });
});
