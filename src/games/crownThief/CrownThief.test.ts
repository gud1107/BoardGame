import { describe, expect, it } from "vitest";
import { arenaFor, CENTER_CLEAR, PILLAR_R } from "./arena";
import { botThink } from "./bot";
import {
  BODY_R,
  CROWN_DROP_BAN_MS,
  CROWN_DROP_MS,
  FAKE_MS,
  GOLDEN_MS,
  INVULN_MS,
  MAGNET_REACH,
  RESPAWN_MS,
  REVENGE_MS,
  STEP_MS,
  TOUCH_DIST,
  UNDERDOG_BONUS,
  WEIGHT_PER_STEP,
  WEIGHT_STEP_MS,
  fmtScore,
  sanitizeOptions,
  type GameMode,
} from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import {
  applyInput,
  computeRanks,
  createHost,
  createMatch,
  crownSpeedMult,
  isKing,
  revengeBanned,
  setAway,
  setInput,
  speedMult,
  step,
  type HostRuntime,
  type MatchState,
} from "./sim";
import { crownThiefStatDetails } from "./stats";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function host(n = 3, mode: GameMode = "classic", items = false, seed = 7): HostRuntime {
  return createHost(createMatch(seed, humans(n), { mode, items, seconds: 120 }));
}

function run(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) step(rt);
}

/** 카운트다운을 건너뛰고 싸움 시작 + 모두 가장자리 쪽 안전한 곳으로 */
function toFight(rt: HostRuntime) {
  const s = rt.state;
  while (s.phase !== "fight") step(rt);
  s.nextItemAt = Infinity;
}

function place(s: MatchState, seat: number, x: number, z: number) {
  Object.assign(s.players[seat], { x, z, vx: 0, vz: 0, y: 0, move: "none", respawnAt: 0, ghostUntil: 0 });
}

/** 왕관을 seat에게 바로 씌운다 (무적 없이) */
function crownTo(rt: HostRuntime, seat: number, { invuln = false } = {}) {
  const s = rt.state;
  s.crown = { state: "held", holder: seat, x: s.players[seat].x, z: s.players[seat].z, at: s.t, invulnUntil: invuln ? s.t + INVULN_MS : 0, prev: -1, prevUntil: 0, dropBan: -1, dropBanUntil: 0 };
  s.players[seat].reignStart = s.t;
  s.players[seat].skillUsed = false;
}

/** 나머지 사람을 멀리 치워 둔다 (기둥 없는 빈 자리) */
function park(s: MatchState, except: number[]) {
  // 기둥·점프대를 피한 자리 (작은·중간 광장 공통)
  const spots = [
    [5.6, 2.4],
    [-5.6, -2.4],
    [-5.6, 2.4],
    [5.6, -2.4],
    [2.4, 5.6],
    [-2.4, -5.6],
    [2.4, -5.6],
    [-2.4, 5.6],
  ];
  let k = 0;
  for (const p of s.players) if (!except.includes(p.seat)) place(s, p.seat, spots[k][0], spots[k++][1]);
}

describe("광장 배치", () => {
  for (const n of [2, 3, 4, 5, 6, 8]) {
    it(`${n}인 광장: 겹치지 않고, 가운데가 비고, 점프대 도착점이 안전하다`, () => {
      const g = arenaFor(n);
      const things = [...g.pillars, ...g.pads];
      for (const c of [...things, ...g.bushes]) expect(Math.hypot(c.x, c.z) + c.r).toBeLessThan(g.radius - 0.3);
      for (const c of [...things, ...g.bushes]) expect(Math.hypot(c.x, c.z) - c.r).toBeGreaterThan(CENTER_CLEAR);
      for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) expect(Math.hypot(things[i].x - things[j].x, things[i].z - things[j].z)).toBeGreaterThan(things[i].r + things[j].r + BODY_R * 2);
      for (const pad of g.pads) {
        for (const c of g.pillars) expect(Math.hypot(pad.tx - c.x, pad.tz - c.z)).toBeGreaterThan(PILLAR_R + BODY_R + 0.2);
        for (const o of g.pads) expect(Math.hypot(pad.tx - o.x, pad.tz - o.z)).toBeGreaterThan(o.r + BODY_R);
        expect(Math.hypot(pad.tx, pad.tz)).toBeLessThan(g.radius - 1);
        expect(g.pads[pad.pair].pair).toBe(g.pads.indexOf(pad));
      }
      // 원점 대칭 (어느 자리에서 시작해도 같은 지형)
      for (const cs of [g.pillars, g.bushes, g.pads]) {
        expect(Math.abs(cs.reduce((a, c) => a + c.x, 0))).toBeLessThan(0.01);
        expect(Math.abs(cs.reduce((a, c) => a + c.z, 0))).toBeLessThan(0.01);
      }
    });
  }

  it("시작 자리는 모두 같은 반지름이고 기둥·점프대와 겹치지 않는다", () => {
    for (const n of [2, 4, 6, 8]) {
      const s = createMatch(11, humans(n));
      const g = arenaFor(n);
      for (const p of s.players) {
        for (const c of [...g.pillars, ...g.pads]) expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(c.r + BODY_R);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(g.radius - 0.9);
      }
    }
  });
});

describe("옵션", () => {
  it("팀전은 4명 미만이면 개인전으로, 이상한 값은 기본값으로", () => {
    expect(sanitizeOptions({ mode: "team" }, 3).mode).toBe("classic");
    expect(sanitizeOptions({ mode: "team" }, 4).mode).toBe("team");
    expect(sanitizeOptions({ seconds: 77 as 90 }).seconds).toBe(120);
    expect(sanitizeOptions(null)).toEqual({ mode: "classic", seconds: 120, items: true });
    expect(fmtScore(12_345)).toBe("12.3");
  });
});

describe("왕관 떨어지기·줍기", () => {
  it("싸움 시작 1.5초 뒤 가운데에 떨어지고, 먼저 닿은 사람이 왕", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    park(s, [0]);
    place(s, 0, 0.3, 0);
    expect(s.crown.state).toBe("pending");
    run(rt, CROWN_DROP_MS - 50);
    expect(s.crown.state).toBe("pending");
    run(rt, 120);
    expect(isKing(s, 0)).toBe(true);
    expect(s.players[0].stats.pickups).toBe(1);
  });

  it("왕관을 쓰면 시간만큼 점수가 오르고 마지막 20초는 2배", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    park(s, [0]);
    crownTo(rt, 0);
    run(rt, 1000);
    expect(s.players[0].score).toBeGreaterThan(980);
    expect(s.players[0].score).toBeLessThan(1020);
    s.t = s.fightEnd - GOLDEN_MS - STEP_MS;
    const before = s.players[0].score;
    run(rt, 1000);
    expect(s.golden).toBe(true);
    expect(s.players[0].score - before).toBeGreaterThan(1900);
  });
});

describe("뺏기", () => {
  it("만지면 뺏는다 — 단 새 왕 무적 1.5초 동안은 안 된다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    park(s, [0, 1]);
    place(s, 0, 0, 0);
    place(s, 1, TOUCH_DIST - 0.05, 0);
    crownTo(rt, 0, { invuln: true });
    run(rt, INVULN_MS - 100);
    expect(isKing(s, 0)).toBe(true);
    place(s, 1, TOUCH_DIST - 0.05, 0);
    place(s, 0, 0, 0);
    run(rt, 200);
    expect(isKing(s, 1)).toBe(true);
    expect(s.players[1].stats.steals).toBe(1);
    expect(s.players[0].stats.lost).toBe(1);
  });

  it("✋ 복수 금지: 방금 뺏긴 사람은 3초 동안 다시 못 뺏지만 다른 사람은 된다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    park(s, [0, 1]);
    place(s, 0, 0, 0);
    place(s, 1, 0.9, 0);
    crownTo(rt, 0);
    step(rt);
    expect(isKing(s, 1)).toBe(true);
    expect(revengeBanned(s, 0)).toBe(true);
    // 무적이 끝나도 0번은 못 뺏음
    s.crown.invulnUntil = s.t;
    place(s, 1, 0, 0);
    place(s, 0, 0.9, 0);
    run(rt, 500);
    expect(isKing(s, 1)).toBe(true);
    // 2번은 된다
    place(s, 2, 0, -0.9);
    place(s, 1, 0, 0);
    run(rt, 50);
    expect(isKing(s, 2)).toBe(true);
    expect(REVENGE_MS).toBe(3000);
  });

  it("복수 금지가 풀리면 다시 뺏을 수 있다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 1, 0.9, 0);
    crownTo(rt, 0);
    step(rt);
    expect(isKing(s, 1)).toBe(true);
    place(s, 0, -5, 0);
    run(rt, REVENGE_MS + 50);
    place(s, 1, 0, 0);
    place(s, 0, 0.9, 0);
    run(rt, 50);
    expect(isKing(s, 0)).toBe(true);
  });

  it("핑 보정: 왕이 0.1초 안에 있던 자리를 만져도 뺏는다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 1, 3, 0);
    crownTo(rt, 0);
    run(rt, 200);
    // 왕이 방금 (0,0)에 있었다 → 지금은 0.5m 옆
    s.players[0].z = 0.5;
    place(s, 1, TOUCH_DIST - 0.05, 0);
    step(rt);
    expect(isKing(s, 1)).toBe(true);
  });

  it("동시에 닿으면 더 가까운 사람, 거리가 같으면 점수가 낮은 사람", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 1, 0.9, 0);
    place(s, 2, -0.95, 0);
    crownTo(rt, 0);
    step(rt);
    expect(isKing(s, 1)).toBe(true);
    const rt2 = host(3);
    toFight(rt2);
    const s2 = rt2.state;
    place(s2, 0, 0, 0);
    place(s2, 1, 0.9, 0);
    place(s2, 2, -0.9, 0);
    s2.players[1].score = 5000;
    s2.players[2].score = 1000;
    crownTo(rt2, 0);
    step(rt2);
    expect(isKing(s2, 2)).toBe(true);
  });

  it("🧲 자석 손이면 0.6m 더 먼 곳에서도 뺏는다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 1, TOUCH_DIST + MAGNET_REACH - 0.1, 0);
    crownTo(rt, 0);
    step(rt);
    expect(isKing(s, 0)).toBe(true);
    s.players[1].magnetUntil = s.t + 1000;
    place(s, 1, TOUCH_DIST + MAGNET_REACH - 0.1, 0);
    place(s, 0, 0, 0);
    step(rt);
    expect(isKing(s, 1)).toBe(true);
  });
});

describe("속도", () => {
  it("🪨 무거운 왕관: 4초마다 4%씩 느려지고 최대 24%", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    crownTo(rt, 0);
    s.t += WEIGHT_STEP_MS * 2 + 10;
    expect(crownSpeedMult(s, s.players[0])).toBeCloseTo(1 - WEIGHT_PER_STEP * 2, 5);
    s.t += 120_000;
    expect(crownSpeedMult(s, s.players[0])).toBeCloseTo(0.76, 5);
  });

  it("🐢 꼴찌 보정: 점수가 가장 낮은 사람(왕 제외)만 5% 빠르다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    s.players[0].score = 3000;
    s.players[1].score = 1000;
    s.players[2].score = 0;
    expect(speedMult(s, s.players[2])).toBeCloseTo(1 + UNDERDOG_BONUS, 5);
    expect(speedMult(s, s.players[1])).toBe(1);
    s.players[1].score = 0;
    s.players[2].score = 0;
    expect(speedMult(s, s.players[2])).toBeCloseTo(1 + UNDERDOG_BONUS, 5);
    s.players.forEach((p) => (p.score = 0));
    expect(speedMult(s, s.players[2])).toBe(1);
  });
});

describe("떨어짐", () => {
  it("왕이 광장 밖으로 나가면 왕관은 안쪽 바닥에 떨어지고, 떨어뜨린 사람은 2.2초 뒤 다시 나타난다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    const R = arenaFor(2).radius;
    place(s, 1, -5, -5);
    place(s, 0, R - 0.05, 0);
    s.players[0].vx = 5;
    crownTo(rt, 0);
    step(rt);
    expect(s.players[0].move).toBe("fall");
    expect(s.crown.state).toBe("ground");
    expect(Math.hypot(s.crown.x, s.crown.z)).toBeLessThan(R - 1.3);
    expect(s.crown.dropBan).toBe(0);
    expect(CROWN_DROP_BAN_MS).toBeLessThan(RESPAWN_MS);
    run(rt, RESPAWN_MS + 50);
    expect(s.players[0].respawnAt).toBe(0);
    expect(Math.hypot(s.players[0].x, s.players[0].z)).toBeLessThan(R);
  });

  it("호령으로 밀려 떨어지면 민 사람이 떨어뜨림(KO) 기록을 받는다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    const R = arenaFor(2).radius;
    place(s, 0, R - 2.8, 0);
    place(s, 1, R - 1.4, 0);
    crownTo(rt, 0, { invuln: true });
    rt.skillReq[0] = s.t;
    run(rt, 1500);
    expect(s.players[0].stats.roars).toBe(1);
    expect(s.players[1].stats.falls).toBe(1);
    expect(s.players[0].stats.kos).toBe(1);
    // 호령은 왕관 한 번에 한 번
    rt.skillReq[0] = s.t;
    run(rt, 100);
    expect(s.players[0].stats.roars).toBe(1);
  });
});

describe("점프대", () => {
  it("밟으면 짝꿍 쪽으로 날아가 정해진 곳에 내려앉고, 나는 동안은 뺏을 수 없다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    const pad = arenaFor(2).pads[0];
    place(s, 0, pad.x, pad.z);
    place(s, 1, -3, 0);
    crownTo(rt, 0);
    step(rt);
    expect(s.players[0].move).toBe("pad");
    place(s, 1, s.players[0].x + 0.5, s.players[0].z);
    s.players[1].x = s.players[0].x + 0.5;
    run(rt, 300);
    expect(isKing(s, 0)).toBe(true);
    run(rt, 600);
    expect(s.players[0].move).not.toBe("pad");
    expect(Math.hypot(s.players[0].x - pad.tx, s.players[0].z - pad.tz)).toBeLessThan(0.6);
  });
});

describe("팀전", () => {
  it("같은 팀은 뺏지 않고, 팀 점수는 인원이 적은 팀에 배수를 준다", () => {
    const rt = host(5, "team");
    toFight(rt);
    const s = rt.state;
    expect(s.teamMult).toEqual([1, 1.5]);
    park(s, [0, 2]);
    place(s, 0, 0, 0);
    place(s, 2, 0.9, 0);
    crownTo(rt, 0);
    run(rt, 500);
    expect(isKing(s, 0)).toBe(true);
    expect(s.teamScores[0]).toBeGreaterThan(450);
    crownTo(rt, 1);
    const b = s.teamScores[1];
    run(rt, 1000);
    expect(s.teamScores[1] - b).toBeGreaterThan(1450);
    const ranks = computeRanks(s);
    expect(ranks[1]).toBe(1);
    expect(ranks[0]).toBe(2);
    expect(s.winnerTeam).toBe(1);
  });

  it("호령은 우리 팀원을 밀지 않는다", () => {
    const rt = host(4, "team");
    toFight(rt);
    const s = rt.state;
    park(s, [0, 1, 2]);
    place(s, 0, 0, 0);
    place(s, 2, 1.5, 0);
    place(s, 1, -1.5, 0);
    crownTo(rt, 0, { invuln: true });
    rt.skillReq[0] = s.t;
    step(rt);
    expect(s.players[2].move).toBe("none");
    expect(s.players[1].move).toBe("stagger");
  });
});

describe("저주의 왕관", () => {
  it("저주는 무작위 한 사람에게 내려앉고, 왕이 만져서 떠넘긴다 · 준 사람에게 3초간 못 돌려준다", () => {
    const rt = host(3, "curse");
    toFight(rt);
    const s = rt.state;
    run(rt, CROWN_DROP_MS + 50);
    expect(s.crown.state).toBe("held");
    park(s, [0, 1]);
    place(s, 0, 0, 0);
    place(s, 1, 0.9, 0);
    crownTo(rt, 0);
    step(rt);
    expect(isKing(s, 1)).toBe(true);
    s.crown.invulnUntil = s.t;
    place(s, 0, 0, 0);
    place(s, 1, 0.9, 0);
    run(rt, 500);
    expect(isKing(s, 1)).toBe(true);
  });

  it("저주가 적은 사람이 1등, 동점이면 끝날 때 안 쓰고 있던 사람", () => {
    const rt = host(3, "curse");
    toFight(rt);
    const s = rt.state;
    s.players[0].score = 9000;
    s.players[1].score = 2000;
    s.players[2].score = 2000;
    crownTo(rt, 1);
    expect(computeRanks(s)).toEqual([3, 2, 1]);
  });

  it("떨어져도 저주는 그대로 붙어 있다", () => {
    const rt = host(2, "curse");
    toFight(rt);
    const s = rt.state;
    const R = arenaFor(2).radius;
    place(s, 1, -4, 0);
    place(s, 0, R - 0.05, 0);
    s.players[0].vx = 5;
    crownTo(rt, 0);
    step(rt);
    expect(s.players[0].move).toBe("fall");
    expect(isKing(s, 0)).toBe(true);
  });
});

describe("아이템", () => {
  it("🍌 바나나: 주운 사람 뒤에 놓이고, 밟은 사람이 미끄러진다", () => {
    const rt = host(2, "classic", true);
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    s.players[0].face = 0;
    place(s, 1, 5, 5);
    s.items = [{ id: 1, kind: "banana", x: 0, z: 0, until: s.t + 5000 }];
    step(rt);
    expect(s.traps.length).toBe(1);
    expect(s.traps[0].x).toBeLessThan(-0.8);
    place(s, 1, s.traps[0].x, s.traps[0].z);
    step(rt);
    expect(s.players[1].move).toBe("stagger");
    expect(s.players[0].stats.bananaHits).toBe(1);
    expect(s.traps.length).toBe(0);
  });

  it("🎭 가짜 왕관: 왕이 주우면 다른 사람에게, 아니면 내게 씌워진다", () => {
    const rt = host(3, "classic", true);
    toFight(rt);
    const s = rt.state;
    park(s, [0]);
    place(s, 0, 0, 0);
    crownTo(rt, 0);
    s.items = [{ id: 1, kind: "fake", x: 0, z: 0, until: s.t + 5000 }];
    step(rt);
    expect(s.players[0].fakeUntil).toBe(0);
    expect(s.players.filter((p) => p.fakeUntil > s.t).length).toBe(1);
    expect(FAKE_MS).toBe(5000);
  });
});

describe("나감·방장 승계", () => {
  it("왕이 나가면 왕관이 그 자리에 떨어진다 (저주는 그대로)", () => {
    const rt = host(2);
    toFight(rt);
    crownTo(rt, 0);
    setAway(rt, 0, true);
    expect(rt.state.crown.state).toBe("ground");
    expect(rt.state.players[0].bot).toBe(true);
    setAway(rt, 0, false);
    expect(rt.state.players[0].bot).toBe(false);
    const rc = host(2, "curse");
    toFight(rc);
    crownTo(rc, 0);
    setAway(rc, 0, true);
    expect(isKing(rc.state, 0)).toBe(true);
  });

  it("스냅샷으로 판을 이어받아 끝까지 진행된다", () => {
    const s = createMatch(42, [{ bot: true, level: 5 }, { bot: false, level: 5 }, { bot: true, level: 7 }], { seconds: 90 });
    const rt = createHost(s, botThink);
    run(rt, 20_000);
    const snap = makeSnap(rt.state, 9);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const buf = new SnapBuffer();
    expect(buf.push(snap, 0).length).toBeGreaterThanOrEqual(0);
    const heir = createHost(stateFromSnap(snap), botThink);
    setAway(heir, 1, true);
    run(heir, 90_000);
    expect(heir.state.phase).toBe("gameOver");
    expect(heir.state.ranks!.length).toBe(3);
  });

  it("손님 입력은 사람 자리에만 먹힌다", () => {
    const rt = createHost(createMatch(3, [{ bot: true, level: 5 }, { bot: false, level: 5 }]));
    applyInput(rt, 0, { mx: 1, mz: 0 });
    expect(rt.inputs[0].mx).toBe(0);
    applyInput(rt, 1, { mx: 3, mz: 4 });
    expect(rt.inputs[1].mx).toBeCloseTo(0.6, 5);
    applyInput(rt, 9, { mx: 1 });
    setInput(rt, 1, { mx: 0, mz: 0, dash: 1 });
    expect(rt.dashReq[1]).toBe(rt.state.t);
  });
});

describe("순위·기록", () => {
  it("개인전 동점이면 끝날 때 왕관을 쓴 사람이 앞", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    s.players[0].score = 5000;
    s.players[1].score = 5000;
    s.players[2].score = 1000;
    crownTo(rt, 1);
    expect(computeRanks(s)).toEqual([2, 1, 3]);
  });

  it("끝나면 기록이 상세 통계로 나온다", () => {
    const s = createMatch(5, Array.from({ length: 4 }, () => ({ bot: true, level: 6 })), { seconds: 90 });
    const rt = createHost(s, botThink);
    while (s.phase !== "gameOver") step(rt);
    const d = crownThiefStatDetails(s, 0);
    expect(d.crownSec).toBeGreaterThanOrEqual(0);
    expect(d.wins === 0 || d.wins === 1).toBe(true);
    const total = s.players.reduce((a, p) => a + p.score, 0);
    // 왕관은 늘 한 명만 — 점수 합은 실제 시간 + 황금 보너스를 넘지 않는다
    expect(total).toBeLessThanOrEqual(90_000 + GOLDEN_MS + 100);
    expect(total).toBeGreaterThan(60_000);
  });
});
