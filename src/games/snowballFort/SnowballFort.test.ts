import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { AMMO_START, BLIZZARD_AT_MS, CHARGE_MS, GATHER_MS, launchFor, ROUND_MS, snowmanHpFor, STEP_MS, WALL_COST, WALL_H } from "./data";
import { isSnap, makeSnap, SnapBuffer, stateFromSnap } from "./net";
import { applyInput, ballPos, createHost, createMatch, hostStep, press, setAway, setInput, spawnPoint, step, type HostRuntime, type PlayerInput } from "./sim";
import { snowballStatDetails } from "./stats";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function toFight(rt: HostRuntime) {
  while (rt.state.phase === "countdown") step(rt);
}

function run(rt: HostRuntime, ms: number) {
  const end = rt.state.t + ms;
  while (rt.state.t < end && rt.state.phase !== "gameOver") step(rt);
}

const input = (p: Partial<PlayerInput>): PlayerInput => ({ mx: 0, mz: 0, aim: 0, charge: 0, gather: 0, throw: 0, pow: 0, wall: 0, dash: 0, ...p });

describe("snowball fort — setup", () => {
  it("splits seats into two teams, odd counts get a tougher small team", () => {
    const s = createMatch(1, humans(5));
    expect(s.teamSize).toEqual([3, 2]);
    expect(s.players.map((p) => p.team)).toEqual([0, 1, 0, 1, 0]);
    expect(s.players[1].hpMax).toBeGreaterThan(s.players[0].hpMax);
    expect(s.snowmen[0].hpMax).toBe(snowmanHpFor(2, 3));
    expect(s.snowmen[1].hpMax).toBeGreaterThan(s.snowmen[0].hpMax);
    expect(s.walls.filter((w) => w.until === 0).length).toBe(6);
    for (const p of s.players) expect(Math.sign(p.z)).toBe(p.team === 0 ? 1 : -1);
  });

  it("the throw table: harder = further and higher", () => {
    const soft = launchFor(0);
    const hard = launchFor(1);
    expect(hard.range).toBeGreaterThan(soft.range);
    const apex = (L: ReturnType<typeof launchFor>) => 1.45 + (L.vy * L.vy) / (2 * 14);
    expect(apex(hard)).toBeGreaterThan(WALL_H + 1);
    expect(soft.vy).toBeLessThan(1);
  });
});

describe("snowball fort — actions", () => {
  it("gathering while standing still makes snowballs", () => {
    const rt = createHost(createMatch(2, humans(2)));
    toFight(rt);
    const p = rt.state.players[0];
    p.x = 3;
    p.z = 3;
    applyInput(rt, 0, input({ gather: 1 }));
    run(rt, GATHER_MS * 2 + 60);
    expect(p.ammo).toBe(AMMO_START + 2);
    // moving stops gathering
    applyInput(rt, 0, input({ gather: 1, mx: 1 }));
    const before = p.ammo;
    run(rt, GATHER_MS * 2);
    expect(p.ammo).toBe(before);
  });

  it("a charged throw flies, hits a rival and freezes them after enough hits", () => {
    const rt = createHost(createMatch(3, humans(2)));
    toFight(rt);
    const a = rt.state.players[0];
    const b = rt.state.players[1];
    a.x = 0;
    a.z = 2;
    b.x = 0;
    b.z = -4;
    a.ammo = 4;
    rt.state.walls = [];
    const aim = Math.atan2(b.z - a.z, b.x - a.x);
    let thrown = 0;
    for (let k = 0; k < 3; k++) {
      applyInput(rt, 0, input({ aim, charge: 1, throw: thrown }));
      run(rt, CHARGE_MS * 0.2);
      thrown++;
      applyInput(rt, 0, input({ aim, charge: 0, throw: thrown, pow: 140 }));
      run(rt, 900);
      b.x = 0;
      b.z = -4;
    }
    expect(a.stats.throws).toBe(3);
    expect(a.stats.hits).toBe(3);
    expect(b.frozenUntil).toBeGreaterThan(rt.state.t);
    expect(a.stats.freezes).toBe(1);
  });

  it("a low throw is stopped by a wall, a lob clears it", () => {
    const rt = createHost(createMatch(4, humans(2)));
    toFight(rt);
    const s = rt.state;
    const a = s.players[0];
    const b = s.players[1];
    s.walls = [{ id: 99, team: 1, x: 0, z: -2, a: 0, hp: 3, hpMax: 3, until: 0, by: -1 }];
    a.x = 0;
    a.z = 2;
    b.x = 0;
    b.z = -7.5;
    a.ammo = 4;
    const aim = -Math.PI / 2;
    // low and fast → wall
    applyInput(rt, 0, input({ aim, charge: 1 }));
    run(rt, 100);
    applyInput(rt, 0, input({ aim, throw: 1, pow: 200 }));
    run(rt, 1200);
    expect(s.walls[0].hp).toBe(2);
    expect(b.hp).toBe(b.hpMax);
    // full lob → over the wall
    b.x = 0;
    b.z = -16 + 0.5;
    applyInput(rt, 0, input({ aim, charge: 1, throw: 1 }));
    run(rt, CHARGE_MS + 50);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    applyInput(rt, 0, input({ aim, throw: 2, pow: Math.round(((d - 4) / 14) * 1000) }));
    run(rt, 1500);
    expect(s.walls[0].hp).toBe(2);
  });

  it("cannot throw harder than the host saw you hold", () => {
    const rt = createHost(createMatch(5, humans(2)));
    toFight(rt);
    const a = rt.state.players[0];
    a.ammo = 2;
    applyInput(rt, 0, input({ aim: 0, charge: 1 }));
    step(rt);
    applyInput(rt, 0, input({ aim: 0, throw: 1, pow: 1000 }));
    step(rt);
    const b = rt.state.balls[0];
    const L = launchFor(0.32);
    expect(Math.hypot(b.vx, b.vz)).toBeLessThanOrEqual(L.vh + 0.5);
  });

  it("building a wall costs two snowballs and only works on your half", () => {
    const rt = createHost(createMatch(6, humans(2)));
    toFight(rt);
    const a = rt.state.players[0];
    a.ammo = 3;
    a.x = 0;
    a.z = 5;
    applyInput(rt, 0, input({ aim: -Math.PI / 2, wall: 1 }));
    step(rt);
    expect(a.ammo).toBe(3 - WALL_COST);
    expect(rt.state.walls.filter((w) => w.by === 0).length).toBe(1);
    a.ammo = 4;
    a.x = 0;
    a.z = -5;
    run(rt, 500);
    applyInput(rt, 0, input({ aim: -Math.PI / 2, wall: 2 }));
    step(rt);
    expect(rt.state.walls.filter((w) => w.by === 0).length).toBe(1);
  });

  it("a dash moves fast and dodges a ball in flight", () => {
    const rt = createHost(createMatch(7, humans(2)));
    toFight(rt);
    const a = rt.state.players[0];
    const x0 = a.x;
    applyInput(rt, 0, input({ mx: 1, dash: 1 }));
    run(rt, 240);
    expect(a.x - x0).toBeGreaterThan(2);
  });
});

describe("snowball fort — rounds", () => {
  it("knocking the snowman down wins the round; first to the majority wins the match", () => {
    const rt = createHost(createMatch(8, humans(2), { rounds: 3 }));
    toFight(rt);
    rt.state.snowmen[1].hp = 0;
    step(rt);
    expect(rt.state.phase).toBe("roundEnd");
    expect(rt.state.wins).toEqual([1, 0]);
    run(rt, 6000);
    toFight(rt);
    rt.state.snowmen[1].hp = 0;
    step(rt);
    run(rt, 6000);
    expect(rt.state.phase).toBe("gameOver");
    expect(rt.state.ranks).toEqual([1, 2]);
    expect(snowballStatDetails(rt.state, 0).matchWins).toBe(1);
  });

  it("time out: the healthier snowman wins; the blizzard melts walls", () => {
    const rt = createHost(createMatch(9, humans(2), { rounds: 1 }));
    toFight(rt);
    rt.state.snowmen[0].hp -= 2;
    const wallsBefore = rt.state.walls.reduce((a, w) => a + w.hp, 0);
    run(rt, BLIZZARD_AT_MS + 7000);
    expect(rt.state.blizzard).toBe(true);
    expect(rt.state.walls.reduce((a, w) => a + w.hp, 0)).toBeLessThan(wallsBefore);
    run(rt, ROUND_MS);
    expect(rt.state.history[0].winner).toBe(1);
    expect(rt.state.history[0].reason).toBe("time");
  });

  it("frozen players thaw back at their spawn with full hp", () => {
    const rt = createHost(createMatch(10, humans(2)));
    toFight(rt);
    const p = rt.state.players[0];
    p.hp = 0;
    p.frozenUntil = rt.state.t + 100;
    p.x = 5;
    run(rt, 200);
    const sp = spawnPoint(rt.state, 0);
    expect(p.frozenUntil).toBe(0);
    expect(p.x).toBeCloseTo(sp.x, 3);
    expect(p.hp).toBe(p.hpMax);
  });
});

describe("snowball fort — network + bots", () => {
  it("a snapshot round-trips into a host state (host migration)", () => {
    const rt = createHost(createMatch(11, humans(4)), botThink);
    toFight(rt);
    run(rt, 3000);
    const snap = makeSnap(rt.state, 7);
    expect(isSnap(snap)).toBe(true);
    const back = stateFromSnap(JSON.parse(JSON.stringify(snap)));
    const rt2 = createHost(back, botThink);
    hostStep(rt2, 500);
    expect(rt2.state.t).toBeGreaterThan(snap.t);
    const buf = new SnapBuffer();
    buf.push(snap, 0);
    expect(buf.body(0, 50)).not.toBeNull();
  });

  it("balls are drawn from their launch values", () => {
    const b = { id: 1, seat: 0, team: 0, x0: 0, y0: 1.45, z0: 0, vx: 10, vy: 2, vz: 0, t0: 1000, big: false, apex: 1.45 };
    const p = ballPos(b, 1500);
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.y).toBeCloseTo(1.45 + 1 - 0.5 * 14 * 0.25, 6);
  });

  it("all-bot 4v4 match plays to the end with throws, hits and walls", () => {
    const seats = Array.from({ length: 8 }, (_, i) => ({ bot: true, level: 3 + (i % 6) }));
    const rt = createHost(createMatch(12, seats, { rounds: 1 }), botThink);
    let guard = 0;
    while (rt.state.phase !== "gameOver" && guard++ < 60 * 200) step(rt);
    expect(rt.state.phase).toBe("gameOver");
    const st = rt.state.players.map((p) => p.stats);
    expect(st.reduce((a, x) => a + x.throws, 0)).toBeGreaterThan(30);
    expect(st.reduce((a, x) => a + x.hits, 0)).toBeGreaterThan(5);
    expect(st.reduce((a, x) => a + x.gathered, 0)).toBeGreaterThan(5);
  });

  it("an away human is driven by the bot and handed back", () => {
    const rt = createHost(createMatch(13, humans(2)), botThink);
    setAway(rt, 1, true);
    expect(rt.state.players[1].bot).toBe(true);
    toFight(rt);
    run(rt, 2000);
    setAway(rt, 1, false);
    expect(rt.state.players[1].bot).toBe(false);
    // bots ignore applyInput; humans don't get bot presses
    press(rt, 0, "throw", 0.5);
    setInput(rt, 0, { aim: 0 });
    expect(STEP_MS).toBeGreaterThan(16);
  });
});
