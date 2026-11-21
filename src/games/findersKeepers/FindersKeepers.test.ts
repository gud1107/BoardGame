import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import {
  BOMB_REVEAL_MS,
  CUT_BOOST_MS,
  DEPOSIT_MS,
  DROP_NOPICK_MS,
  GOAL_BONUS,
  MAX_CHAIN,
  REVENGE_MS,
  SET_RAINBOW_BONUS,
  SET_TRIPLE_BONUS,
  SHIELD_MS,
  SNATCH_CD_MS,
  SNATCH_SHIELD_MS,
  STEP_MS,
  TOY_INFO,
  UNDERDOG_SAFE,
  WEIGHT_MAX,
  sanitizeOptions,
  type GameMode,
  type ToyKind,
} from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import { basketOf, chainValue, computeRanks, createHost, createMatch, setAway, setInput, speedMult, step, weightMult, type HostRuntime, type MatchState, type Toy } from "./sim";
import { findersKeepersStatDetails } from "./stats";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function host(n = 3, mode: GameMode = "classic", seed = 7): HostRuntime {
  return createHost(createMatch(seed, humans(n), { mode, events: false, goals: false, seconds: 150 }));
}

function run(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) step(rt);
}

/** 카운트다운을 건너뛰고, 바닥 물건을 다 치우고, 다시 채우기·방송을 끈다 */
function toFight(rt: HostRuntime) {
  const s = rt.state;
  while (s.phase !== "fight") step(rt);
  s.toys = [];
  // 테스트 자리 잡기를 방해하지 않게 진열대를 치운다 (작은 홀은 가운데에도 진열대가 있다)
  s.stands = [];
  s.nextRefillAt = Infinity;
  s.nextEventAt = Infinity;
  // 모두 가운데에서 멀리, 바구니 밖으로
  s.players.forEach((p, i) => place(s, i, -8 + i * 0.01, 8 - i * 3));
}

function place(s: MatchState, seat: number, x: number, z: number) {
  Object.assign(s.players[seat], { x, z, vx: 0, vz: 0, move: "none" });
}

function toy(s: MatchState, kind: ToyKind, x: number, z: number, extra: Partial<Toy> = {}): Toy {
  const t: Toy = { id: ++s.toySeq, kind, x, z, state: "floor", owner: -1, shieldUntil: 0, noPickUntil: 0, landAt: 0, ...extra };
  s.toys.push(t);
  return t;
}

/** seat의 줄을 kinds로 바로 만든다 (보호 없음, 몸 뒤로 일렬) */
function giveChain(s: MatchState, seat: number, kinds: ToyKind[]) {
  const p = s.players[seat];
  p.chain = kinds.map((k, i) => toy(s, k, p.x - (i + 1) * 0.7, p.z, { state: "chain", owner: seat }).id);
}

const kindsOf = (s: MatchState, seat: number) => s.players[seat].chain.map((id) => s.toys.find((t) => t.id === id)!.kind);

describe("만지면 내 꺼! 시작", () => {
  it("인원수별 물건·바구니·자리, 대칭 배치", () => {
    for (const n of [2, 3, 4, 5, 6, 8]) {
      const s = createMatch(11, humans(n), {});
      const gifts = n <= 3 ? 1 : n <= 5 ? 2 : 3;
      expect(s.toys.length).toBe(n * 6 + gifts + (n <= 3 ? 2 : 0));
      expect(s.baskets.length).toBe(n);
      expect(new Set(s.players.map((p) => p.basket)).size).toBe(n);
      // 바구니는 모두 홀 가운데에서 같은 거리
      const ds = s.baskets.map((b) => Math.hypot(b.x, b.z));
      expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(0.01);
      // 자기 바구니 근처에서 시작
      for (const p of s.players) expect(Math.hypot(p.x - basketOf(s, p).x, p.z - basketOf(s, p).z)).toBeLessThan(2);
      // 물건은 진열대와 겹치지 않는다
      for (const t of s.toys) for (const c of s.stands) expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeGreaterThan(c.r);
    }
  });

  it("팀전은 4명 이상 · 팀 바구니 2개 · 2·3명이면 개인전", () => {
    expect(sanitizeOptions({ mode: "team" }, 3).mode).toBe("classic");
    const s = createMatch(3, humans(6), { mode: "team" });
    expect(s.baskets.length).toBe(2);
    expect(s.players.every((p) => p.basket === p.team)).toBe(true);
    expect(s.teamMult).toEqual([1, 1]);
    const s5 = createMatch(3, humans(5), { mode: "team" });
    expect(s5.teamMult[1]).toBeCloseTo(1.5);
  });

  it("보너스 목표 2개(서로 다름) · 폭탄 세일 폭탄 수", () => {
    const s = createMatch(5, humans(4), { goals: true });
    expect(s.goals.length).toBe(2);
    expect(new Set(s.goals).size).toBe(2);
    expect(createMatch(5, humans(4), { goals: false }).goals.length).toBe(0);
    expect(createMatch(5, humans(4), { mode: "bomb" }).bombs.length).toBe(1);
    expect(createMatch(5, humans(6), { mode: "bomb" }).bombs.length).toBe(2);
  });
});

describe("줍기와 줄", () => {
  it("바닥 물건을 만지면 내 줄 끝에 붙고, 잠깐 보호된다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    const t = toy(s, "duck", 0.5, 0);
    step(rt);
    expect(s.players[0].chain).toEqual([t.id]);
    expect(t.state).toBe("chain");
    expect(t.shieldUntil - s.t).toBeGreaterThan(SHIELD_MS - 50);
  });

  it("줄은 몸을 간격을 두고 따라온다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    place(s, 0, -2, 0);
    giveChain(s, 0, ["sock", "sock", "sock"]);
    setInput(rt, 0, { mx: 1, mz: 0 });
    run(rt, 900);
    const p = s.players[0];
    let prev = { x: p.x, z: p.z };
    for (const id of p.chain) {
      const t = s.toys.find((x) => x.id === id)!;
      expect(Math.hypot(t.x - prev.x, t.z - prev.z)).toBeLessThan(0.75);
      expect(t.x).toBeLessThan(prev.x);
      prev = t;
    }
  });

  it("🎁 선물 상자·🏆 트로피는 줄에 1개만 · 꽉 차면 못 줍는다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    giveChain(s, 0, ["gift"]);
    const g2 = toy(s, "gift", 0.3, 0);
    step(rt);
    expect(g2.state).toBe("floor");
    expect(s.events.some((e) => e.k === "blocked" && e.why === "gift")).toBe(true);
    giveChain(s, 0, Array(MAX_CHAIN).fill("sock"));
    const d = toy(s, "duck", 0.2, 0.2);
    run(rt, 1700);
    expect(d.state).toBe("floor");
  });

  it("🐢 무게: 값이 무거울수록 느리고, 최대 30%", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    expect(weightMult(s, s.players[0])).toBe(1);
    giveChain(s, 0, ["robot", "robot"]);
    expect(weightMult(s, s.players[0])).toBeCloseTo(1 - 6 * 0.01);
    giveChain(s, 0, ["trophy", "gift", "robot", "robot", "robot"]);
    expect(weightMult(s, s.players[0])).toBeCloseTo(1 - WEIGHT_MAX);
  });
});

describe("가로채기", () => {
  function setup() {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    place(s, 1, 0, 0);
    giveChain(s, 1, ["sock", "duck", "robot", "sock"]); // x = -0.7, -1.4, -2.1, -2.8
    // 점수 차이를 둬서 1번이 꼴찌 보호를 받지 않게 (2번이 혼자 꼴찌)
    s.baskets[s.players[1].basket].stack = ["sock", "sock"];
    s.baskets[s.players[0].basket].stack = ["sock", "sock"];
    return { rt, s };
  }

  it("k번째를 만지면 k번째부터 끝까지 내 줄로 · 앞쪽은 주인에게", () => {
    const { rt, s } = setup();
    place(s, 0, -1.4, 0.5); // 1번 칸(duck) 근처
    step(rt);
    expect(kindsOf(s, 1)).toEqual(["sock"]);
    expect(kindsOf(s, 0)).toEqual(["duck", "robot", "sock"]);
    const ev = s.events.find((e) => e.k === "snatch");
    expect(ev && ev.k === "snatch" && ev.n === 3 && ev.v === 6).toBe(true);
    // 가로챈 물건은 더 길게 보호
    const t = s.toys.find((x) => x.id === s.players[0].chain[0])!;
    expect(t.shieldUntil - s.t).toBeGreaterThan(SNATCH_SHIELD_MS - 50);
    // ✋ 되찜 금지 · 🤲 손이 무거움
    expect(s.players[1].revengeOn).toBe(0);
    expect(s.players[1].revengeUntil - s.t).toBeGreaterThan(REVENGE_MS - 50);
    expect(s.players[0].snatchCdAt - s.t).toBeGreaterThan(SNATCH_CD_MS - 50);
  });

  it("✊ 몸 바로 뒤 첫 물건은 못 뺏는다", () => {
    const { rt, s } = setup();
    place(s, 0, -0.7, 0.6);
    step(rt);
    expect(kindsOf(s, 1).length).toBe(4);
  });

  it("🛡 보호 중인 물건 · 🧺 바구니 안 주인의 줄은 못 건드린다", () => {
    const { rt, s } = setup();
    const t = s.toys.find((x) => x.id === s.players[1].chain[1])!;
    t.shieldUntil = s.t + 1000;
    place(s, 0, -1.4, 0.5);
    step(rt);
    expect(kindsOf(s, 1).length).toBe(4);
    // 바구니 안에 선 주인: 줄을 바구니 밖으로 늘어뜨려도 못 건드린다 (그동안 앞에서부터 넣는다)
    const b = basketOf(s, s.players[1]);
    place(s, 1, b.x, b.z);
    const ux = -b.x / Math.hypot(b.x, b.z);
    const uz = -b.z / Math.hypot(b.x, b.z);
    s.players[1].chain.forEach((id, i) => Object.assign(s.toys.find((x) => x.id === id)!, { x: b.x + ux * 0.7 * (i + 1), z: b.z + uz * 0.7 * (i + 1), shieldUntil: 0 }));
    place(s, 0, b.x + ux * 2.1 + uz * 0.4, b.z + uz * 2.1 - ux * 0.4);
    step(rt);
    expect(s.players[1].inBasket).toBe(true);
    expect(kindsOf(s, 0)).toEqual([]);
    expect(kindsOf(s, 1).length).toBe(3);
  });

  it("돌진 중엔 못 가로챈다 · 되찜 금지 동안 그 사람 줄은 못 건드린다", () => {
    const { rt, s } = setup();
    place(s, 0, -1.4, 0.5);
    s.players[0].move = "dash";
    s.players[0].moveUntil = s.t + 1000;
    step(rt);
    expect(kindsOf(s, 1).length).toBe(4);
    s.players[0].move = "none";
    s.players[0].revengeOn = 1;
    s.players[0].revengeUntil = s.t + 1000;
    step(rt);
    expect(kindsOf(s, 1).length).toBe(4);
  });

  it("두 사람이 같은 줄을 동시에 만지면 더 앞 칸이 먼저", () => {
    const { rt, s } = setup();
    place(s, 0, -2.8, 0.5); // 3번 칸
    place(s, 2, -1.4, -0.5); // 1번 칸
    step(rt);
    expect(kindsOf(s, 2)).toEqual(["duck", "robot", "sock"]);
    expect(kindsOf(s, 0)).toEqual([]);
  });

  it("🐣 꼴찌(혼자 가장 낮은 점수)는 앞 3개가 안전", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    place(s, 1, 0, 0);
    giveChain(s, 1, ["sock", "duck", "robot", "sock", "duck"]);
    s.baskets[s.players[0].basket].stack = ["robot"];
    s.baskets[s.players[2].basket].stack = ["robot"];
    step(rt);
    place(s, 0, -2.1, 0.5); // 2번 칸 — 꼴찌라 안전
    step(rt);
    expect(kindsOf(s, 1).length).toBe(5);
    place(s, 0, -2.8, 0.5); // 3번 칸 = UNDERDOG_SAFE
    step(rt);
    expect(kindsOf(s, 1).length).toBe(UNDERDOG_SAFE);
  });
});

describe("바구니", () => {
  it("줄 앞에서부터 0.25초마다 하나씩 넣고, 같은 종류 3개·무지개 세트 보너스", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    const b = basketOf(s, s.players[0]);
    place(s, 0, b.x, b.z);
    giveChain(s, 0, ["sock", "duck", "sock", "robot", "sock", "gift"]);
    step(rt);
    expect(b.stack).toEqual(["sock"]);
    run(rt, DEPOSIT_MS * 6 + 50);
    expect(b.stack).toEqual(["sock", "duck", "sock", "robot", "sock", "gift"]);
    expect(s.players[0].chain).toEqual([]);
    const base = 1 + 2 + 1 + 3 + 1 + 5;
    expect(s.players[0].bonus).toBe(SET_TRIPLE_BONUS + SET_RAINBOW_BONUS);
    expect(s.players[0].score).toBe(base + SET_TRIPLE_BONUS + SET_RAINBOW_BONUS);
    // 나가면 한 번 끝 (최고 기록)
    place(s, 0, 0, 0);
    step(rt);
    expect(s.players[0].stats.bestRun).toBe(base);
    expect(s.players[0].stats.bestRunToys).toBe(6);
  });

  it("남의 바구니엔 못 넣는다 · 🏷️ 타임세일은 그 종류 값 2배", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    const other = basketOf(s, s.players[1]);
    place(s, 0, other.x, other.z);
    giveChain(s, 0, ["duck"]);
    run(rt, 500);
    expect(other.stack).toEqual([]);
    const mine = basketOf(s, s.players[0]);
    place(s, 0, mine.x, mine.z);
    s.event = { k: "timeSale", kind: "duck", at: s.t, until: s.t + 5000 };
    step(rt);
    expect(mine.stack).toEqual(["duck"]);
    expect(s.players[0].score).toBe(TOY_INFO.duck.value * 2);
  });

  it("🔥 마감 세일: 맨 위 1개 털기 · 주인이 안에 서 있으면 못 털고 · 털린 뒤 잠깐 못 턴다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    s.sale = true;
    s.saleStart = s.t;
    const b = basketOf(s, s.players[1]);
    b.stack = ["sock", "robot", "gift"];
    s.baskets[s.players[2].basket].stack = ["sock"];
    s.baskets[s.players[0].basket].stack = ["sock", "sock"];
    // 주인이 안에 서 있음
    place(s, 1, b.x, b.z);
    place(s, 0, b.x * 0.85, b.z * 0.85);
    step(rt);
    expect(b.stack.length).toBe(3);
    // 주인이 나감
    place(s, 1, 0, 0);
    step(rt);
    expect(b.stack).toEqual(["sock", "robot"]);
    expect(kindsOf(s, 0)).toEqual(["gift"]);
    s.players[0].chain = [];
    run(rt, 1000);
    expect(b.stack.length).toBe(2);
  });
});

describe("✂️ 줄 끊기 · 🤝 넘겨주기", () => {
  it("뒤쪽 절반(올림)을 떨어뜨리고 잠깐 빨라진다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    giveChain(s, 0, ["sock", "duck", "robot", "sock", "duck"]);
    const before = speedMult(s, s.players[0]);
    setInput(rt, 0, { skill: 1 });
    step(rt);
    expect(kindsOf(s, 0)).toEqual(["sock", "duck"]);
    const dropped = s.toys.filter((t) => t.state === "floor");
    expect(dropped.length).toBe(3);
    expect(dropped.every((t) => t.noPickUntil - s.t > DROP_NOPICK_MS - 50)).toBe(true);
    expect(speedMult(s, s.players[0])).toBeGreaterThan(before);
    run(rt, CUT_BOOST_MS + 100);
    expect(s.t >= s.players[0].boostUntil).toBe(true);
  });

  it("팀전: 팀원에게 닿은 채 누르면 줄을 통째로 넘긴다", () => {
    const rt = host(4, "team");
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 2, 0.6, 0);
    giveChain(s, 0, ["sock", "duck", "robot"]);
    setInput(rt, 0, { skill: 1 });
    step(rt);
    expect(kindsOf(s, 0)).toEqual([]);
    expect(kindsOf(s, 2)).toEqual(["sock", "duck", "robot"]);
    // 팀원 줄은 가로채지 않는다
    place(s, 0, s.toys.find((t) => t.id === s.players[2].chain[2])!.x, s.toys.find((t) => t.id === s.players[2].chain[2])!.z);
    run(rt, SNATCH_SHIELD_MS + 100);
    expect(kindsOf(s, 2).length).toBe(3);
  });
});

describe("💣 폭탄 세일", () => {
  it("1등에게 떨어지고, 몸을 만지면 떠넘기고, 준 사람에겐 바로 못 돌려준다", () => {
    const rt = host(3, "bomb");
    toFight(rt);
    const s = rt.state;
    s.baskets[s.players[2].basket].stack = ["gift"];
    step(rt);
    s.bombs[0].dropAt = s.t;
    step(rt);
    expect(s.bombs[0].state).toBe("held");
    expect(s.bombs[0].holder).toBe(2);
    // 보호 시간 지나고 0번에 닿기
    s.bombs[0].shieldUntil = 0;
    place(s, 2, 0, 0);
    place(s, 0, 0.7, 0);
    step(rt);
    expect(s.bombs[0].holder).toBe(0);
    s.bombs[0].shieldUntil = 0;
    step(rt);
    expect(s.bombs[0].holder).toBe(0);
  });

  it("터지면 줄이 흩어지고 바구니 맨 위 2개가 바닥으로", () => {
    const rt = host(3, "bomb");
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    giveChain(s, 0, ["sock", "duck"]);
    const b = basketOf(s, s.players[0]);
    b.stack = ["sock", "robot", "gift"];
    s.bombs[0] = { ...s.bombs[0], state: "held", holder: 0, at: s.t, fuseAt: s.t + 1, shieldUntil: s.t + 9999 };
    step(rt);
    expect(s.players[0].chain).toEqual([]);
    expect(b.stack).toEqual(["sock"]);
    expect(s.toys.filter((t) => t.state === "floor").map((t) => t.kind).sort()).toEqual(["duck", "gift", "robot", "sock"]);
    expect(s.bombs[0].state).toBe("pending");
    expect(s.players[0].stats.bombBooms).toBe(1);
  });

  it("스냅샷엔 마지막 5초 전까지 터지는 시각이 없다 · 이어받으면 새로 정한다", () => {
    const rt = host(3, "bomb");
    toFight(rt);
    const s = rt.state;
    s.bombs[0] = { ...s.bombs[0], state: "held", holder: 0, at: s.t, fuseAt: s.t + 20_000 };
    const snap = makeSnap(s, 1);
    expect(snap.bombs[0].fuseAt).toBe(0);
    const back = stateFromSnap(snap);
    expect(back.bombs[0].fuseAt).toBeGreaterThan(s.t + BOMB_REVEAL_MS);
    s.bombs[0].fuseAt = s.t + 3000;
    expect(makeSnap(s, 2).bombs[0].fuseAt).toBe(s.t + 3000);
  });
});

describe("끝 · 순위 · 목표", () => {
  it("줄 위 물건은 0점 · 동점이면 바구니 물건이 적은 사람", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    basketOf(s, s.players[0]).stack = ["gift"];
    basketOf(s, s.players[1]).stack = ["sock", "sock", "robot"];
    basketOf(s, s.players[2]).stack = ["sock"];
    giveChain(s, 2, ["trophy"]);
    s.fightEnd = s.t + STEP_MS;
    step(rt);
    expect(s.phase).toBe("gameOver");
    expect(s.players[2].stats.wastedValue).toBe(10);
    expect(s.players.map((p) => p.score)).toEqual([5, 5, 1]);
    expect(s.ranks).toEqual([1, 2, 3]);
  });

  it("🎖 목표 달성자(동점 모두)에게 +5", () => {
    const rt = createHost(createMatch(9, humans(3), { goals: true, events: false }));
    toFight(rt);
    const s = rt.state;
    s.goals = ["duck", "snatcher"];
    s.players[0].stats.ducks = 3;
    s.players[1].stats.ducks = 3;
    s.players[2].stats.snatchedValue = 7;
    s.fightEnd = s.t + STEP_MS;
    step(rt);
    expect(s.goalWinners).toEqual([[0, 1], [2]]);
    expect(s.players.map((p) => p.bonus)).toEqual([GOAL_BONUS, GOAL_BONUS, GOAL_BONUS]);
  });

  it("팀전 순위: 팀 합산(배수), 동점이면 트로피 넣은 팀", () => {
    const rt = host(4, "team");
    toFight(rt);
    const s = rt.state;
    s.baskets[0].stack = ["trophy"];
    s.baskets[1].stack = ["gift", "gift"];
    step(rt);
    expect(s.teamScores).toEqual([10, 10]);
    const ranks = computeRanks(s);
    expect(s.winnerTeam).toBe(0);
    expect(ranks).toEqual([1, 2, 1, 2]);
  });
});

describe("네트워크 · 끊김", () => {
  it("스냅샷 왕복과 보간 버퍼", () => {
    const rt = host(4);
    run(rt, 5000);
    const snap = makeSnap(rt.state, 3);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1, players: [] })).toBe(false);
    const json = JSON.parse(JSON.stringify(snap));
    expect(isSnap(json)).toBe(true);
    const buf = new SnapBuffer();
    buf.push(snap, 0);
    run(rt, 100);
    const ev = buf.push(makeSnap(rt.state, 4), 100);
    expect(Array.isArray(ev)).toBe(true);
    expect(buf.body(0, 150)).not.toBeNull();
    for (const t of rt.state.toys) expect(Number.isFinite(buf.toy(t, 150).x)).toBe(true);
  });

  it("방장 승계: 스냅샷에서 이어받아도 판이 끝까지 간다", () => {
    const s0 = createMatch(21, Array.from({ length: 4 }, () => ({ bot: true, level: 6 })), { mode: "classic" });
    const rt = createHost(s0, botThink);
    run(rt, 30_000);
    const heir = createHost(stateFromSnap(makeSnap(rt.state, 9)), botThink);
    let guard = 0;
    while (heir.state.phase !== "gameOver" && guard++ < 60 * 200) step(heir);
    expect(heir.state.phase).toBe("gameOver");
    expect(heir.state.ranks?.length).toBe(4);
  });

  it("나간 사람은 AI가 대신하고 돌아오면 돌려받는다 (줄은 그대로)", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    giveChain(s, 1, ["duck"]);
    setAway(rt, 1, true);
    expect(s.players[1].bot && s.players[1].away).toBe(true);
    expect(s.players[1].chain.length).toBe(1);
    setAway(rt, 1, false);
    expect(s.players[1].bot).toBe(false);
  });
});

describe("기록", () => {
  it("상세 기록 키", () => {
    const rt = createHost(createMatch(5, Array.from({ length: 3 }, () => ({ bot: true, level: 5 })), { seconds: 120 }), botThink);
    while (rt.state.phase !== "gameOver") step(rt);
    const d = findersKeepersStatDetails(rt.state, 0);
    for (const k of ["score", "maxScore", "depositValue", "snatches", "bestRun", "bestRunToys", "trophies", "setBonus", "maxWasted", "wins"]) expect(d[k], k).toBeTypeOf("number");
    expect(chainValue(rt.state, rt.state.players[0])).toBe(d.wastedValue);
  });
});
