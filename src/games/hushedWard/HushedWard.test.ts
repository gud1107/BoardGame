import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { BLEED_MS, BREATH_MAX, FEAR_BEAT_1, GRACE_MS, HUSH_MS, HUSH_WARN_MS, REVIVE_MS, SEARCH_MS, TICK_MS, TIME_LIMIT_MS, gradeOf, sanitizeOptions, talismansFor } from "./data";
import { createLocal, findTarget, reportOf, stepLocal, syncLocal } from "./localBody";
import { ALTAR, BLOCKED, CONTAINERS, DOORS, EXIT, GHOST_SPAWNS, KIND, START_CELLS, WALKABLE, cellAt, centerOf, collide, distField, nextCell, throwLanding, walkCellAt, walkField } from "./map";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import { ITEM_ORDER, applyAct, applyReport, createHost, createMatch, emitNoise, ghostDist, hostStep, noiseRadiusOf, type HostRuntime, type PosReport } from "./sim";
import { hushedWardStatDetails } from "./stats";

/** 사람 한 명(0번) 판. 귀신은 깨워서 원하는 곳에 세운다. */
function solo(seed = 7, seats = 1, difficulty: "easy" | "normal" | "hard" | "nightmare" = "normal"): HostRuntime {
  const s = createMatch(seed, Array.from({ length: seats }, () => ({ bot: false, level: 5 })), { difficulty });
  return createHost(s, botThink);
}

function wakeGhostAt(rt: HostRuntime, cell: number, mode: "roam" | "listen" = "listen") {
  const g = rt.state.ghost;
  const c = centerOf(cell);
  g.x = c.x;
  g.z = c.z;
  g.tx = c.x;
  g.tz = c.z;
  g.mode = mode;
  g.until = rt.state.t + 60_000;
  rt.state.t = Math.max(rt.state.t, GRACE_MS + 100);
  rt.state.hush.at = rt.state.t + 600_000;
}

const rep = (rt: HostRuntime, seat: number, patch: Partial<PosReport>): PosReport => {
  const p = rt.state.players[seat];
  return { x: p.x, z: p.z, yaw: p.yaw, pitch: 0, mv: 0, cr: false, hb: false, light: true, use: null, ...patch };
};

const run = (rt: HostRuntime, ms: number, each?: () => void) => {
  for (let t = 0; t < ms; t += TICK_MS) {
    each?.();
    hostStep(rt, TICK_MS);
  }
};

describe("병동 지도", () => {
  it("모든 바닥 칸이 로비에서 걸어서 닿는다", () => {
    const f = walkField(START_CELLS[0]);
    for (const c of WALKABLE) expect(Number.isFinite(f[c]), `cell ${c}`).toBe(true);
  });

  it("서랍 26개는 모두 옆 칸에서 손이 닿고, 문은 19개", () => {
    expect(CONTAINERS.length).toBe(26);
    expect(DOORS.length).toBe(19);
    const f = walkField(START_CELLS[0]);
    for (const c of CONTAINERS) {
      expect(BLOCKED[c.cell]).toBe(1);
      const near = WALKABLE.filter((w) => Math.hypot(centerOf(w).x - c.x, centerOf(w).z - c.z) <= 2.01);
      expect(near.length, `container ${c.i}`).toBeGreaterThan(0);
      expect(near.some((w) => Number.isFinite(f[w]))).toBe(true);
    }
  });

  it("거리장은 대칭이고 길찾기는 목표까지 줄어든다", () => {
    const a = START_CELLS[0];
    const b = GHOST_SPAWNS[0];
    expect(walkField(a)[b]).toBeCloseTo(walkField(b)[a], 3);
    let cur = a;
    let guard = 0;
    while (cur !== b && guard++ < 200) {
      const n = nextCell(cur, b);
      expect(walkField(b)[n]).toBeLessThan(walkField(b)[cur]);
      cur = n;
    }
    expect(cur).toBe(b);
  });

  it("닫힌 문은 소리를 막는다", () => {
    const d = DOORS[0];
    const open = DOORS.map(() => true);
    const shut = DOORS.map(() => false);
    const from = START_CELLS[0];
    const inside = WALKABLE.find((c) => walkField(d.cell)[c] <= 2.01 && KIND[c] === 1 && distField(from, shut)[c] > distField(from, open)[c]);
    expect(inside).toBeDefined();
  });

  it("벽·닫힌 문은 못 지나가고, 약병은 벽 앞에서 깨진다", () => {
    const doors = DOORS.map(() => false);
    // 로비 서쪽 벽 속으로 밀어 넣어도 바닥으로 밀려난다
    const lobby = centerOf(START_CELLS[0]);
    const p = { x: lobby.x - 2.1, z: lobby.z };
    collide(p, doors);
    expect(KIND[cellAt(p.x, p.z)]).not.toBe(0);
    const d = DOORS[0];
    const q = { x: d.x, z: d.z };
    collide(q, doors);
    expect(Math.hypot(q.x - d.x, q.z - d.z)).toBeGreaterThan(0.3);
    const c = centerOf(START_CELLS[0]);
    const land = throwLanding(c.x, c.z, 0, 0.5, doors);
    expect(KIND[cellAt(land.x, land.z)]).not.toBe(0);
    expect(land.dist).toBeLessThan(12.01);
  });
});

describe("판 만들기", () => {
  it("인원수대로 봉인 부적이 숨겨지고, 되도록 서로 다른 방에 있다", () => {
    for (const n of [1, 2, 3, 4]) {
      const s = createMatch(100 + n, Array.from({ length: n }, () => ({ bot: false, level: 5 })));
      const tal = s.contents.map((c, i) => (ITEM_ORDER[c] === "talisman" ? i : -1)).filter((i) => i >= 0);
      expect(tal.length).toBe(talismansFor(n));
      expect(s.need).toBe(talismansFor(n));
      expect(new Set(tal.map((i) => CONTAINERS[i].room)).size).toBe(tal.length);
    }
  });

  it("혼자면 수호 부적 1장, 순한 밤은 모두 1장 더", () => {
    expect(createMatch(1, [{ bot: false, level: 5 }]).players[0].charms).toBe(1);
    expect(createMatch(1, [{ bot: false, level: 5 }, { bot: false, level: 5 }]).players[0].charms).toBe(0);
    expect(createMatch(1, [{ bot: false, level: 5 }], { difficulty: "easy" }).players[0].charms).toBe(2);
  });

  it("옵션·등급 정리", () => {
    expect(sanitizeOptions({ difficulty: "x" as never }).difficulty).toBe("normal");
    expect(gradeOf(0, 4, 0)).toBe("F");
    expect(gradeOf(4, 4, 0)).toBe("S");
    expect(gradeOf(4, 4, 2)).toBe("A");
    expect(gradeOf(2, 4, 1)).toBe("B");
    expect(gradeOf(1, 4, 1)).toBe("C");
  });
});

describe("소리와 청귀", () => {
  it("시작 12초 동안은 잠들어 있다가 깨어난다", () => {
    const rt = solo();
    run(rt, GRACE_MS - 500);
    expect(rt.state.ghost.mode).toBe("sleep");
    run(rt, 1000);
    expect(rt.state.ghost.mode).not.toBe("sleep");
    expect(rt.state.events.some((e) => e.k === "wake")).toBe(true);
  });

  it("앉아 걸으면 안 들리고, 걸으면 가까운 귀신이 추격한다", () => {
    const rt = solo();
    const me = rt.state.players[0];
    const here = walkCellAt(me.x, me.z);
    const near = WALKABLE.find((c) => walkField(here)[c] > 3.5 && walkField(here)[c] < 4.5 && KIND[c] === 1) as number;
    wakeGhostAt(rt, near);
    run(rt, 3000, () => applyReport(rt, 0, rep(rt, 0, { mv: 1, cr: true })));
    expect(rt.state.ghost.mode).toBe("listen");
    run(rt, 2500, () => applyReport(rt, 0, rep(rt, 0, { mv: 2 })));
    expect(["hunt", "feed"]).toContain(rt.state.ghost.mode);
    expect(me.stats.hunted).toBe(1);
  });

  it("먼 소리는 확인하러 올 뿐이고, 물건 소리로는 추격하지 않는다", () => {
    const rt = solo();
    const me = rt.state.players[0];
    const here = walkCellAt(me.x, me.z);
    const far = WALKABLE.find((c) => walkField(here)[c] > 11 && walkField(here)[c] < 13) as number;
    wakeGhostAt(rt, far);
    rt.state.doors = rt.state.doors.map(() => true);
    rt.state.doorVer++;
    emitNoise(rt, me.x, me.z, 16, -1);
    expect(rt.state.ghost.mode).toBe("investigate");
    expect(rt.state.ghost.tx).toBeCloseTo(me.x, 1);
  });

  it("추격 중에 조용히 자리를 옮기면 놓친다", () => {
    const rt = solo();
    const me = rt.state.players[0];
    me.charms = 0;
    const here = walkCellAt(me.x, me.z);
    const far = WALKABLE.find((c) => walkField(here)[c] > 15 && walkField(here)[c] < 17) as number;
    wakeGhostAt(rt, far);
    rt.state.doors = rt.state.doors.map(() => true);
    rt.state.doorVer++;
    rt.state.ghost.alert = 10;
    emitNoise(rt, me.x, me.z, 30, 0);
    expect(rt.state.ghost.mode).toBe("hunt");
    // 소리 난 자리에서 멀리 비켜난다
    const away = centerOf(START_CELLS[3]);
    const dodge = WALKABLE.filter((c) => Math.hypot(centerOf(c).x - me.x, centerOf(c).z - me.z) > 3.5 && Math.hypot(centerOf(c).x - me.x, centerOf(c).z - me.z) < 5 && walkField(far)[c] > walkField(far)[here])[0];
    const to = dodge !== undefined ? centerOf(dodge) : away;
    run(rt, 12_000, () => applyReport(rt, 0, rep(rt, 0, { x: to.x, z: to.z, mv: 0, cr: true })));
    expect(rt.state.events.some((e) => e.k === "lost") || rt.state.ghost.mode !== "hunt").toBe(true);
    expect(me.st).toBe("alive");
  });

  it("몸이 닿으면 붙잡힌다 — 수호 부적이 있으면 한 번 대신 탄다", () => {
    const rt = solo();
    const me = rt.state.players[0];
    expect(me.charms).toBe(1);
    wakeGhostAt(rt, walkCellAt(me.x, me.z));
    run(rt, 200);
    expect(me.st).toBe("alive");
    expect(me.charms).toBe(0);
    expect(rt.state.ghost.mode).toBe("feed");
    expect(rt.state.events.some((e) => e.k === "charm")).toBe(true);
    // 다시 닿으면 쓰러지고, 혼자라 판이 끝난다
    rt.state.ghost.mode = "listen";
    rt.state.ghost.until = rt.state.t + 9000;
    run(rt, 200);
    expect(rt.state.phase).toBe("gameOver");
    expect(rt.state.outcome?.win).toBe(false);
    expect(rt.state.ranks).toEqual([2]);
  });

  it("귀신 거리와 내 소리 표시", () => {
    const rt = solo();
    wakeGhostAt(rt, GHOST_SPAWNS[0]);
    const me = rt.state.players[0];
    expect(ghostDist(rt, me.x, me.z)).toBeGreaterThan(Math.hypot(me.x - rt.state.ghost.x, me.z - rt.state.ghost.z) - 0.01);
    expect(noiseRadiusOf({ mv: 1, fear: 0, hold: false, use: null }, false)).toBe(0);
    expect(noiseRadiusOf({ mv: 1, fear: 0, hold: false, use: null }, true)).toBeGreaterThan(0);
    expect(noiseRadiusOf({ mv: 0, fear: 90, hold: true, use: null }, false)).toBe(0);
    expect(noiseRadiusOf({ mv: 0, fear: 90, hold: false, use: null }, false)).toBeGreaterThan(noiseRadiusOf({ mv: 0, fear: 70, hold: false, use: null }, false));
  });
});

describe("정적 (종)", () => {
  it("예고 뒤 5초 동안 귀를 기울이고, 가만히 있으면 넘긴다", () => {
    const rt = solo();
    wakeGhostAt(rt, GHOST_SPAWNS[1], "roam");
    rt.state.hush.at = rt.state.t + 100;
    run(rt, 300);
    expect(rt.state.hush.st).toBe("warn");
    run(rt, HUSH_WARN_MS);
    expect(rt.state.hush.st).toBe("on");
    expect(rt.state.ghost.mode).toBe("hush");
    run(rt, HUSH_MS + 100, () => applyReport(rt, 0, rep(rt, 0, { mv: 0, cr: true })));
    expect(rt.state.hush.st).toBe("idle");
    expect(rt.state.players[0].stats.hushOk).toBe(1);
    expect(rt.state.ghost.mode).not.toBe("hush");
  });

  it("종이 울리는 동안 걸으면 멀리서도 들켜 빠른 추격이 시작된다", () => {
    const rt = solo();
    const me = rt.state.players[0];
    const here = walkCellAt(me.x, me.z);
    const far = WALKABLE.find((c) => walkField(here)[c] > 11 && walkField(here)[c] < 12.5) as number;
    wakeGhostAt(rt, far, "roam");
    rt.state.doors = rt.state.doors.map(() => true);
    rt.state.doorVer++;
    const g = rt.state.ghost;
    g.tx = g.x;
    g.tz = g.z;
    rt.state.hush.at = rt.state.t;
    run(rt, HUSH_WARN_MS + 200, () => applyReport(rt, 0, rep(rt, 0, { mv: 0, cr: true })));
    expect(rt.state.hush.st).toBe("on");
    run(rt, 1000, () => applyReport(rt, 0, rep(rt, 0, { mv: 2 })));
    expect(g.mode).toBe("hunt");
    expect(g.enraged).toBe(true);
    expect(me.hushHeard).toBe(true);
  });
});

describe("공포 · 숨 · 손전등", () => {
  it("어둠에서는 공포가 오르고 불빛에서는 내려간다", () => {
    const rt = solo();
    const me = rt.state.players[0];
    me.fear = 30;
    run(rt, 4000, () => applyReport(rt, 0, rep(rt, 0, { light: false })));
    expect(me.fear).toBeGreaterThan(36);
    const f = me.fear;
    run(rt, 4000, () => applyReport(rt, 0, rep(rt, 0, { light: true })));
    expect(me.fear).toBeLessThan(f);
    expect(me.battery).toBeLessThan(80);
  });

  it("숨을 끝까지 참으면 헉 소리가 나고 잠깐 못 참는다", () => {
    const rt = solo();
    const me = rt.state.players[0];
    run(rt, BREATH_MAX * 1000 + 200, () => applyReport(rt, 0, rep(rt, 0, { hb: true })));
    expect(rt.state.events.some((e) => e.k === "gasp")).toBe(true);
    expect(me.hold).toBe(false);
    expect(me.gaspUntil).toBeGreaterThan(rt.state.t);
  });

  it("공포가 높으면 가만히 있어도 심장 소리가 들킨다 — 숨을 참으면 안 들킨다", () => {
    const quiet = solo(11);
    const loud = solo(11);
    for (const rt of [quiet, loud]) {
      const me = rt.state.players[0];
      me.charms = 0;
      const near = WALKABLE.find((c) => walkField(walkCellAt(me.x, me.z))[c] > 2.9 && walkField(walkCellAt(me.x, me.z))[c] < 4.1 && KIND[c] === 1) as number;
      wakeGhostAt(rt, near);
      me.fear = FEAR_BEAT_1 + 25;
    }
    run(quiet, 2500, () => applyReport(quiet, 0, rep(quiet, 0, { cr: true, hb: true })));
    run(loud, 2500, () => applyReport(loud, 0, rep(loud, 0, { cr: true })));
    expect(quiet.state.ghost.mode).toBe("listen");
    expect(loud.state.ghost.mode).not.toBe("listen");
  });
});

describe("서랍 · 제단 · 탈출", () => {
  it("서랍을 2초 붙들면 물건이 나오고, 부적을 다 붙이면 현관이 열려 탈출한다", () => {
    const rt = solo(21);
    const s = rt.state;
    const me = s.players[0];
    s.hush.at = 1e9;
    const talIdx = s.contents.map((c, i) => (ITEM_ORDER[c] === "talisman" ? i : -1)).filter((i) => i >= 0);
    expect(talIdx.length).toBe(3);
    for (const ci of talIdx) {
      const c = CONTAINERS[ci];
      const stand = WALKABLE.filter((w) => Math.hypot(centerOf(w).x - c.x, centerOf(w).z - c.z) <= 2.01)[0];
      const at = centerOf(stand);
      s.ghost.mode = "sleep";
      s.t = 0;
      run(rt, SEARCH_MS - 200, () => applyReport(rt, 0, rep(rt, 0, { x: at.x, z: at.z, use: `c${ci}` })));
      expect(s.searched[ci]).toBe(false);
      run(rt, 400, () => applyReport(rt, 0, rep(rt, 0, { x: at.x, z: at.z, use: `c${ci}` })));
      expect(s.searched[ci]).toBe(true);
    }
    expect(me.tal).toBe(3);
    expect(me.stats.searches).toBe(3);
    // 제단
    s.t = 0;
    run(rt, 9000, () => applyReport(rt, 0, rep(rt, 0, { x: ALTAR.x, z: ALTAR.z + 1.6, use: "a" })));
    expect(s.placed).toBe(3);
    expect(s.exitOpen).toBe(true);
    expect(me.stats.talPlaced).toBe(3);
    // 현관
    s.t = 0;
    run(rt, 200, () => applyReport(rt, 0, rep(rt, 0, { x: EXIT.x, z: EXIT.z - 0.4 })));
    expect(me.st).toBe("escaped");
    expect(s.phase).toBe("gameOver");
    expect(s.outcome).toMatchObject({ win: true, escaped: 1, why: "escaped" });
    expect(s.ranks).toEqual([1]);
    const d = hushedWardStatDetails(s, 0);
    expect(d).toMatchObject({ escapes: 1, teamWins: 1, soloEscapes: 1, talPlaced: 3, searches: 3 });
    expect(d.minEscapeSec).toBeDefined();
  });

  it("멀리서는 서랍을 못 뒤지고, 문은 가까이에서만 여닫는다", () => {
    const rt = solo();
    const s = rt.state;
    run(rt, SEARCH_MS + 500, () => applyReport(rt, 0, rep(rt, 0, { use: "c0" })));
    expect(s.searched[0]).toBe(false);
    const before = [...s.doors];
    applyAct(rt, 0, { k: "door", i: 0 });
    expect(s.doors).toEqual(before);
    const lobby = DOORS.find((d) => Math.hypot(d.x - s.players[0].x, d.z - s.players[0].z) < 6) as (typeof DOORS)[number];
    applyReport(rt, 0, rep(rt, 0, { x: lobby.x, z: lobby.z + 1.6, cr: true }));
    applyAct(rt, 0, { k: "door", i: lobby.i });
    expect(s.doors[lobby.i]).toBe(!before[lobby.i]);
    expect(s.events.find((e) => e.k === "door")?.z).toBe(0);
  });

  it("약병은 깨지는 자리로 귀신을 부른다", () => {
    const rt = solo();
    const s = rt.state;
    const me = s.players[0];
    me.bottles = 1;
    wakeGhostAt(rt, GHOST_SPAWNS[2]);
    s.doors = s.doors.map(() => true);
    s.doorVer++;
    s.ghost.x = me.x;
    s.ghost.z = me.z - 9;
    applyAct(rt, 0, { k: "throw", yaw: 0, pitch: 0.2 });
    expect(me.bottles).toBe(0);
    expect(s.bottles.length).toBe(1);
    run(rt, 1500);
    expect(s.events.some((e) => e.k === "shatter")).toBe(true);
    expect(me.stats.bottles).toBe(1);
  });
});

describe("협동", () => {
  it("쓰러진 동료를 4초 붙들면 일어나고, 못 일으키면 70초 뒤 끝난다", () => {
    const rt = solo(5, 2);
    const s = rt.state;
    s.hush.at = 1e9;
    const [a, b] = s.players;
    b.st = "down";
    b.downAt = s.t;
    run(rt, REVIVE_MS + 300, () => applyReport(rt, 0, rep(rt, 0, { x: b.x + 0.8, z: b.z, use: "r1" })));
    expect(b.st).toBe("alive");
    expect(a.stats.revives).toBe(1);
    b.st = "down";
    b.downAt = s.t;
    s.ghost.mode = "sleep";
    s.t = 0;
    b.downAt = 0;
    run(rt, BLEED_MS + 200, () => applyReport(rt, 0, rep(rt, 0, { light: true })));
    expect(b.st).toBe("dead");
    expect(s.phase).toBe("play");
  });

  it("시간이 다 되면 진다", () => {
    const rt = solo();
    rt.state.ghost.mode = "sleep";
    rt.state.t = TIME_LIMIT_MS - 200;
    rt.state.hush.at = 1e9;
    run(rt, 400);
    expect(rt.state.phase).toBe("gameOver");
    expect(rt.state.outcome).toMatchObject({ win: false, why: "time" });
  });

  it("나간 사람 자리는 봇이 대신 움직인다", () => {
    const s = createMatch(9, [{ bot: false, level: 5 }, { bot: true, level: 7 }]);
    const rt = createHost(s, botThink);
    const x0 = s.players[1].x;
    const z0 = s.players[1].z;
    run(rt, 3000);
    expect(Math.hypot(s.players[1].x - x0, s.players[1].z - z0)).toBeGreaterThan(1);
  });
});

describe("스냅샷 · 내 몸", () => {
  it("스냅샷은 JSON으로 왕복되고 방장을 넘겨받아 이어서 돈다", () => {
    const s = createMatch(31, [{ bot: true, level: 6 }, { bot: true, level: 6 }]);
    const rt = createHost(s, botThink);
    run(rt, 20_000);
    const snap = JSON.parse(JSON.stringify(makeSnap(s, 5)));
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const rt2 = createHost(stateFromSnap(snap), botThink);
    run(rt2, 20_000);
    expect(rt2.state.t).toBe(s.t + 20_000);
    expect(rt2.state.searched.filter(Boolean).length).toBeGreaterThanOrEqual(s.searched.filter(Boolean).length);
  });

  it("버퍼는 새 이벤트만 한 번씩 돌려주고 귀신·동료를 보간한다", () => {
    const s = createMatch(32, [{ bot: true, level: 6 }, { bot: true, level: 6 }]);
    const rt = createHost(s, botThink);
    const buf = new SnapBuffer();
    let seen = 0;
    let seq = 0;
    for (let i = 0; i < 400; i++) {
      hostStep(rt, TICK_MS);
      seen += buf.push(makeSnap(s, ++seq), i * TICK_MS).length;
    }
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(s.eid);
    expect(buf.push(makeSnap(s, seq), 1e6).length).toBe(0);
    expect(buf.ghost(400 * TICK_MS)).not.toBeNull();
    expect(buf.body(1, 400 * TICK_MS)).not.toBeNull();
  });

  it("내 몸은 입력대로 걷고 벽을 못 뚫으며, 가까운 서랍을 바라보면 대상이 잡힌다", () => {
    const s = createMatch(33, [{ bot: false, level: 5 }]);
    const snap = makeSnap(s, 1);
    const b = createLocal();
    syncLocal(b, snap, 0);
    const x0 = b.x;
    const z0 = b.z;
    b.mz = 1;
    for (let i = 0; i < 600; i++) stepLocal(b, snap, 0, 1 / 60, i * 16.7);
    expect(Math.hypot(b.x - x0, b.z - z0)).toBeGreaterThan(1);
    expect(KIND[cellAt(b.x, b.z)]).not.toBe(0);
    expect(reportOf(b).mv).toBe(2);
    const c = CONTAINERS[0];
    const stand = WALKABLE.filter((w) => Math.hypot(centerOf(w).x - c.x, centerOf(w).z - c.z) <= 2.01)[0];
    const at = centerOf(stand);
    b.x = at.x;
    b.z = at.z;
    b.yaw = Math.atan2(-(c.x - at.x), -(c.z - at.z));
    const t = findTarget(b, snap, 0);
    expect(t?.id).toBe(`c${c.i}`);
  });
});
