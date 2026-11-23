import { describe, expect, it } from "vitest";
import { AUGMENTS, AUG_AT, AUG_PICK_MS, AUG_RESUME_MS, augAllowed, rollAugOffer, type AugId } from "./augments";
import { botThink, chooseBotAug } from "./bot";
import { COUNTDOWN_MS, DASH_CD_MS, MAX_CHAIN, SET_TRIPLE_BONUS, STEP_MS, type GameMode, type ToyKind } from "./data";
import { makeSnap, stateFromSnap } from "./net";
import { createHost, createMatch, dashCdOf, limitBlock, maxChainOf, safeCount, setInput, step, type HostRuntime, type MatchState, type Toy } from "./sim";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));
const bots = (n: number, level = 6) => Array.from({ length: n }, () => ({ bot: true, level }));

function run(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) step(rt);
}

function pick(rt: HostRuntime, seat: number, choice: number, seq: number) {
  setInput(rt, seat, { mx: 0, mz: 0, dash: 0, skill: 0, aug: [seq, rt.state.aug!.round, choice] });
}

describe("🧬 증강 켜기", () => {
  it("옵션이 없으면 꺼져 있다 (옛 방장 · 기존 테스트)", () => {
    const s = createMatch(1, humans(3), {});
    expect(s.options.augments).toBe(false);
    expect(s.phase).toBe("countdown");
    expect(s.aug).toBeNull();
  });

  it("켜면 카운트다운 전에 고르기 단계 — 모두 같은 등급 3장, 판 시계는 멈춘다", () => {
    const s = createMatch(2, humans(4), { augments: true });
    expect(s.phase).toBe("augment");
    const a = s.aug!;
    expect(a.round).toBe(0);
    for (const o of a.offers) {
      expect(o).toHaveLength(3);
      expect(new Set(o).size).toBe(3);
      for (const id of o) expect(AUGMENTS.find((x) => x.id === id)!.tier).toBe(a.tier);
    }
    const rt = createHost(s);
    run(rt, 3000);
    expect(s.t).toBe(0);
    expect(s.phase).toBe("augment");
  });

  it("사람이 고르고, 다시 뽑기는 한 번만, 안 고르면 시간이 지나 첫 카드", () => {
    const rt = createHost(createMatch(3, humans(3), { augments: true }));
    const s = rt.state;
    const first = [...s.aug!.offers[1]];
    pick(rt, 0, 2, 1);
    expect(s.players[0].augs).toEqual([s.aug!.offers[0][2]]);
    pick(rt, 0, 1, 2); // 이미 골랐음 → 무시
    expect(s.players[0].augs).toHaveLength(1);
    pick(rt, 1, -1, 1);
    expect(s.aug!.offers[1]).not.toEqual(first);
    const second = [...s.aug!.offers[1]];
    pick(rt, 1, -1, 2); // 두 번째 다시 뽑기 → 무시
    expect(s.aug!.offers[1]).toEqual(second);
    pick(rt, 1, 0, 2); // 같은 번호 재전송 → 무시
    expect(s.aug!.done[1]).toBe(false);
    pick(rt, 1, 0, 3);
    expect(s.players[1].augs).toEqual([second[0]]);
    run(rt, AUG_PICK_MS[0] + 50);
    expect(s.players[2].augs).toEqual([s.aug?.offers[2][0] ?? s.players[2].augs![0]]);
    run(rt, AUG_RESUME_MS + 50);
    expect(s.phase).toBe("countdown");
    run(rt, COUNTDOWN_MS + 50);
    expect(s.phase).toBe("fight");
  });

  it("봇은 혼자 고르고, 1/3·2/3 지점에 다시 열려 끝날 땐 3개씩 — 마감 세일 전에", () => {
    for (const seconds of [120, 150, 180] as const) {
      for (const n of [2, 5]) {
        const rt = createHost(createMatch(40 + n + seconds, bots(n), { augments: true, seconds }), botThink);
        rt.augChoose = chooseBotAug;
        const s = rt.state;
        const opened: number[] = [];
        let guard = 0;
        while (s.phase !== "gameOver" && guard++ < 200_000) {
          const was = s.phase;
          step(rt);
          if (was !== "augment" && s.phase === "augment") opened.push(s.t);
        }
        expect(s.phase).toBe("gameOver");
        expect(opened).toHaveLength(AUG_AT.length - 1);
        for (const t of opened) expect(t).toBeLessThanOrEqual(s.saleStart - 4000);
        for (const p of s.players) {
          expect(p.augs).toHaveLength(3);
          expect(new Set(p.augs).size).toBe(3);
        }
      }
    }
  });

  it("모드에 쓸모없는 카드는 안 나온다", () => {
    const ids = (mode: GameMode, events: boolean) => {
      const out = new Set<AugId>();
      for (let seed = 0; seed < 300; seed++) for (const tier of [1, 2, 3] as const) for (const id of rollAugOffer(seed, seed % 3, seed % 6, tier, [], 0, mode, events)) out.add(id);
      return out;
    };
    const classic = ids("classic", false);
    expect(classic.has("bombPro")).toBe(false);
    expect(classic.has("teamPlayer")).toBe(false);
    expect(classic.has("regular")).toBe(false);
    expect(ids("bomb", true).has("bombPro")).toBe(true);
    const team = ids("team", true);
    expect(team.has("teamPlayer")).toBe(true);
    expect(team.has("lockBasket")).toBe(false);
    // 어느 모드·등급이든 3장을 채울 만큼 카드가 있다
    for (const mode of ["classic", "team", "bomb"] as GameMode[])
      for (const tier of [1, 2, 3]) expect(AUGMENTS.filter((a) => a.tier === tier && augAllowed(a, mode, false)).length).toBeGreaterThanOrEqual(5);
  });

  it("방장이 바뀌어도(스냅샷 → 상태) 고르기를 이어간다", () => {
    const rt = createHost(createMatch(9, humans(2), { augments: true }));
    pick(rt, 0, 1, 1);
    const s2 = stateFromSnap(makeSnap(rt.state, 1));
    const rt2 = createHost(s2);
    expect(s2.phase).toBe("augment");
    expect(s2.aug!.done[0]).toBe(true);
    setInput(rt2, 1, { mx: 0, mz: 0, dash: 0, skill: 0, aug: [5, 0, 2] });
    run(rt2, AUG_RESUME_MS + 50);
    expect(s2.phase).toBe("countdown");
    expect(s2.players[1].augs).toHaveLength(1);
  });
});

describe("🧬 증강 효과", () => {
  function fightWith(augs: AugId[][], n = 2): HostRuntime {
    const rt = createHost(createMatch(5, humans(n), { events: false, goals: false }));
    const s = rt.state;
    while (s.phase !== "fight") step(rt);
    s.toys = [];
    s.stands = [];
    s.nextRefillAt = Infinity;
    augs.forEach((a, i) => (s.players[i].augs = a));
    s.players.forEach((p, i) => Object.assign(p, { x: -8 + i * 0.01, z: 8 - i * 3, vx: 0, vz: 0 }));
    return rt;
  }
  const toy = (s: MatchState, kind: ToyKind, x: number, z: number, extra: Partial<Toy> = {}): Toy => {
    const t: Toy = { id: ++s.toySeq, kind, x, z, state: "floor", owner: -1, shieldUntil: 0, noPickUntil: 0, landAt: 0, ...extra };
    s.toys.push(t);
    return t;
  };

  it("큰 가방·가벼운 발·꽉 쥐기·선물 포장가 수치", () => {
    const rt = fightWith([["bigBag", "quickDash", "tightGrip", "giftWrap"], []]);
    const [a, b] = rt.state.players;
    expect(maxChainOf(a)).toBe(MAX_CHAIN + 3);
    expect(maxChainOf(b)).toBe(MAX_CHAIN);
    expect(dashCdOf(a)).toBeLessThan(DASH_CD_MS);
    expect(safeCount(rt.state, a)).toBe(safeCount(rt.state, b) + 1);
    const g = toy(rt.state, "gift", 0, 0, { state: "chain", owner: 0 });
    a.chain = [g.id];
    b.chain = [toy(rt.state, "gift", 0, 0, { state: "chain", owner: 1 }).id];
    expect(limitBlock(rt.state, a, "gift")).toBeNull();
    expect(limitBlock(rt.state, b, "gift")).toBe("gift");
  });

  it("진공 청소기: 주우면 옆 물건까지 같이", () => {
    const rt = fightWith([["vacuum"], []]);
    const s = rt.state;
    const p = s.players[0];
    Object.assign(p, { x: 1, z: 1 });
    Object.assign(s.players[1], { x: -3, z: -3 });
    toy(s, "sock", p.x + 0.3, p.z);
    toy(s, "duck", p.x + 0.9, p.z + 0.4);
    toy(s, "robot", p.x - 0.8, p.z - 0.5);
    toy(s, "gift", p.x + 3, p.z);
    step(rt);
    expect(p.chain).toHaveLength(3);
  });

  it("세트 장인: 같은 종류 3개 보너스 2배", () => {
    const rt = fightWith([["setMaster"], []]);
    const s = rt.state;
    const p = s.players[0];
    const b = s.baskets[p.basket];
    p.chain = [0, 1, 2].map((i) => toy(s, "sock", p.x - i, p.z, { state: "chain", owner: 0 }).id);
    Object.assign(p, { x: b.x, z: b.z });
    run(rt, 1500);
    expect(p.stats.setBonus).toBe(SET_TRIPLE_BONUS * 2);
  });
});
