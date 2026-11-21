import { describe, expect, it } from "vitest";
import { layoutFor } from "./arena";
import { botThink } from "./bot";
import { BOX_INFO, COUNTDOWN_MS, EXPRESS_BONUS, FULL_BONUS, HEAVY_SOLO, MISS_PENALTY, SCAN_BONUS, SHOT_BONUS, starTargets, truckCap, type BoxKind, type GameOptions } from "./data";
import { isSnap, makeSnap, stateFromSnap } from "./net";
import { applyInput, boxOf, computeRanks, createHost, createMatch, dockFor, layoutOf, press, setInput, spawnBox, step, type Box, type HostRuntime } from "./sim";
import { parcelPanicStatDetails } from "./stats";

/** 사람 n명(봇 없음) 판을 근무 시작 직후까지 돌린다. 사건·자동 상자는 끈다 */
function setup(n = 2, opts: Partial<GameOptions> = {}): HostRuntime {
  const s = createMatch(42, Array.from({ length: n }, () => ({ bot: false, level: 5 })), { incidents: false, roles: false, ...opts });
  const rt = createHost(s, null);
  while (s.phase === "countdown") step(rt);
  // 컨베이어 자동 상자 끄기 (테스트가 직접 놓는다)
  s.nextSpawnAt = 1e12;
  return rt;
}

function steps(rt: HostRuntime, n: number) {
  for (let i = 0; i < n; i++) step(rt);
}

function floorBox(rt: HostRuntime, kind: BoxKind, x: number, z: number, dest?: number): Box {
  const s = rt.state;
  const b = spawnBox(s, layoutOf(s), kind, { unknown: false, x, z, state: "floor" });
  if (dest !== undefined) b.dest = dest;
  return b;
}

function place(rt: HostRuntime, seat: number, x: number, z: number, face = -Math.PI / 2) {
  const p = rt.state.players[seat];
  p.x = x;
  p.z = z;
  p.vx = 0;
  p.vz = 0;
  p.face = face;
}

/** 칸 앞(아래)에 서서 잡고 칸으로 걸어 들어가기 */
function walkInto(rt: HostRuntime, seat: number, tx: number, tz: number, maxSteps = 400) {
  for (let i = 0; i < maxSteps; i++) {
    const p = rt.state.players[seat];
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) break;
    setInput(rt, seat, { mx: dx / d, mz: dz / d });
    step(rt);
  }
  setInput(rt, seat, { mx: 0, mz: 0 });
}

describe("parcel panic — layout", () => {
  it("sizes and docks scale with players", () => {
    expect(layoutFor(2).docks.length).toBe(3);
    expect(layoutFor(4).docks.length).toBe(4);
    expect(layoutFor(6).W).toBeGreaterThan(layoutFor(2).W);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const L = layoutFor(n);
      // 칸은 겹치지 않고 창고 안
      const xs = L.docks.map((d) => d.zone).sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < xs.length; i++) expect(xs[i].x0).toBeGreaterThan(xs[i - 1].x1);
      expect(xs[0].x0).toBeGreaterThan(-L.W / 2);
      expect(xs[xs.length - 1].x1).toBeLessThan(L.W / 2);
      // 스캐너는 칸·선반과 안 겹침
      for (const r of L.racks) expect(L.scanner.x + L.scanner.r).toBeLessThan(r.x0);
    }
  });

  it("star targets rise with players, time and difficulty", () => {
    const a = starTargets(2, 180, "normal");
    expect(a[0]).toBeLessThan(a[1]);
    expect(a[1]).toBeLessThan(a[2]);
    expect(starTargets(4, 180, "normal")[1]).toBeGreaterThan(a[1]);
    expect(starTargets(2, 240, "normal")[1]).toBeGreaterThan(a[1]);
    expect(starTargets(2, 180, "hard")[1]).toBeGreaterThan(a[1]);
    expect(starTargets(2, 180, "easy")[1]).toBeLessThan(a[1]);
  });
});

describe("parcel panic — carrying and loading", () => {
  it("grab → walk into the matching dock → loaded and scored", () => {
    const rt = setup(2);
    const s = rt.state;
    const L = layoutOf(s);
    const dk = L.docks[0];
    const b = floorBox(rt, "normal", dk.x, dk.zone.z1 + 2, s.docks[0].dest);
    place(rt, 0, dk.x, dk.zone.z1 + 2.8);
    press(rt, 0, "grab");
    step(rt);
    expect(s.players[0].hold).toBe(b.id);
    expect(boxOf(s, b.id)?.state).toBe("held");
    walkInto(rt, 0, dk.x, dk.z);
    expect(s.loaded).toBe(1);
    expect(s.docks[0].load).toEqual(["normal"]);
    expect(s.teamScore).toBe(BOX_INFO.normal.value);
    expect(s.players[0].hold).toBe(-1);
    expect(s.players[0].stats.loads).toBe(1);
  });

  it("wrong dock refuses with a blocked event, unknown label refuses until scanned", () => {
    const rt = setup(2);
    const s = rt.state;
    const L = layoutOf(s);
    const dk = L.docks[0];
    const other = s.docks.find((d, i) => i !== 0)!.dest;
    floorBox(rt, "normal", dk.x, dk.zone.z1 + 2, other);
    place(rt, 0, dk.x, dk.zone.z1 + 2.8);
    press(rt, 0, "grab");
    step(rt);
    walkInto(rt, 0, dk.x, dk.z);
    steps(rt, 5);
    expect(s.loaded).toBe(0);
    expect(s.events.some((e) => e.k === "blocked" && e.s === 0 && e.why === "wrong")).toBe(true);

    const rt2 = setup(2);
    const s2 = rt2.state;
    const L2 = layoutOf(s2);
    const b = spawnBox(s2, L2, "normal", { unknown: true, x: L2.scanner.x + 2.2, z: L2.scanner.z, state: "floor" });
    place(rt2, 0, L2.scanner.x + 3, L2.scanner.z, Math.PI);
    press(rt2, 0, "grab");
    step(rt2);
    expect(b.known).toBe(false);
    walkInto(rt2, 0, L2.scanner.x, L2.scanner.z);
    expect(b.known).toBe(true);
    expect(s2.teamScore).toBe(SCAN_BONUS);
    expect(s2.events.some((e) => e.k === "scan")).toBe(true);
  });

  it("put down drops the box on the floor in front", () => {
    const rt = setup(1);
    const s = rt.state;
    const b = floorBox(rt, "normal", 0, 2.3);
    place(rt, 0, 0, 3);
    press(rt, 0, "grab");
    step(rt);
    expect(s.players[0].hold).toBe(b.id);
    press(rt, 0, "grab");
    step(rt);
    expect(s.players[0].hold).toBe(-1);
    expect(b.state).toBe("floor");
  });

  it("express on time gets a bonus, a full truck leaves with a bonus and comes back empty", () => {
    const rt = setup(2);
    const s = rt.state;
    const L = layoutOf(s);
    const dk = L.docks[1];
    const dest = s.docks[1].dest;
    const cap = truckCap(s.seatCount);
    s.docks[1].load = Array.from({ length: cap - 1 }, () => "normal" as BoxKind);
    floorBox(rt, "express", dk.x, dk.zone.z1 + 2, dest);
    place(rt, 0, dk.x, dk.zone.z1 + 2.8);
    press(rt, 0, "grab");
    step(rt);
    walkInto(rt, 0, dk.x, dk.z);
    expect(s.teamScore).toBe(BOX_INFO.express.value + EXPRESS_BONUS + FULL_BONUS);
    expect(s.docks[1].state).toBe("away");
    expect(s.players[0].stats.fullTrucks).toBe(1);
    steps(rt, 60 * 6);
    expect(s.docks[1].state).toBe("here");
    expect(s.docks[1].load.length).toBe(0);
  });

  it("a truck that runs out of time leaves with what it has", () => {
    const rt = setup(2);
    const s = rt.state;
    s.docks[0].load = ["normal"];
    s.docks[0].leaveAt = s.t + 50;
    steps(rt, 5);
    expect(s.docks[0].state).toBe("away");
    expect(s.events.some((e) => e.k === "truckGo" && e.dock === 0 && !e.full)).toBe(true);
  });
});

describe("parcel panic — throwing", () => {
  it("throwing into a matching truck zone loads it with a shot bonus", () => {
    const rt = setup(2);
    const s = rt.state;
    const L = layoutOf(s);
    const dk = L.docks[0];
    floorBox(rt, "normal", dk.x, dk.z + 4.2, s.docks[0].dest);
    place(rt, 0, dk.x, dk.z + 5);
    press(rt, 0, "grab");
    step(rt);
    setInput(rt, 0, { mx: 0, mz: -1, aim: (5 - 0.55 - 0.55) / 5 });
    press(rt, 0, "throw");
    steps(rt, 80);
    expect(s.loaded).toBe(1);
    expect(s.players[0].stats.shots).toBe(1);
    expect(s.teamScore).toBe(BOX_INFO.normal.value + SHOT_BONUS);
  });

  it("a thrown fragile breaks unless the thrower is the pitcher; a teammate can catch it", () => {
    const rt = setup(2);
    const s = rt.state;
    floorBox(rt, "fragile", 0, 2.4);
    place(rt, 0, 0, 3.1);
    place(rt, 1, 8, 3.1);
    press(rt, 0, "grab");
    step(rt);
    setInput(rt, 0, { mx: 0, mz: -1 });
    press(rt, 0, "throw");
    steps(rt, 80);
    expect(s.broken).toBe(1);
    expect(s.teamScore).toBe(-MISS_PENALTY);

    const rt2 = setup(2);
    const s2 = rt2.state;
    s2.players[0].role = "pitcher";
    const b2 = floorBox(rt2, "fragile", 0, 2.4);
    place(rt2, 0, 0, 3.1);
    place(rt2, 1, 8, 3.1);
    press(rt2, 0, "grab");
    step(rt2);
    setInput(rt2, 0, { mx: 0, mz: -1 });
    press(rt2, 0, "throw");
    steps(rt2, 80);
    expect(s2.broken).toBe(0);
    expect(b2.state).toBe("floor");

    // 받기: 날아가는 길 위의 빈손 팀원
    const rt3 = setup(2);
    const s3 = rt3.state;
    const b3 = floorBox(rt3, "fragile", 0, 2.4);
    place(rt3, 0, 0, 3.1);
    place(rt3, 1, 0, -0.5);
    press(rt3, 0, "grab");
    step(rt3);
    setInput(rt3, 0, { mx: 0, mz: -1 });
    press(rt3, 0, "throw");
    steps(rt3, 80);
    expect(s3.players[1].hold).toBe(b3.id);
    expect(s3.broken).toBe(0);
    expect(s3.players[1].stats.catches).toBe(1);
  });

  it("heavy furniture cannot be thrown", () => {
    const rt = setup(1);
    const s = rt.state;
    const b = floorBox(rt, "heavy", 0, 2.1);
    place(rt, 0, 0, 3.1);
    press(rt, 0, "grab");
    step(rt);
    expect(s.players[0].hold).toBe(b.id);
    press(rt, 0, "throw");
    step(rt);
    expect(b.state).toBe("held");
    expect(s.events.some((e) => e.k === "blocked" && e.why === "noThrow")).toBe(true);
  });
});

describe("parcel panic — heavy furniture", () => {
  it("two holders move it much faster than one; pushing opposite ways stalls", () => {
    const solo = setup(2);
    const b1 = floorBox(solo, "heavy", 0, 2.6);
    place(solo, 0, 0, 3.6);
    press(solo, 0, "grab");
    step(solo);
    const x0 = b1.x;
    setInput(solo, 0, { mx: 1, mz: 0 });
    steps(solo, 60);
    const soloDist = b1.x - x0;

    const duo = setup(2);
    const b2 = floorBox(duo, "heavy", 0, 2.6);
    place(duo, 0, 0, 3.6);
    press(duo, 0, "grab");
    step(duo);
    place(duo, 1, 0, 1.6, Math.PI / 2);
    press(duo, 1, "grab");
    step(duo);
    expect(b2.holders.length).toBe(2);
    const x1 = b2.x;
    setInput(duo, 0, { mx: 1, mz: 0 });
    setInput(duo, 1, { mx: 1, mz: 0 });
    steps(duo, 60);
    const duoDist = b2.x - x1;
    expect(duoDist).toBeGreaterThan(soloDist * 1.6);
    expect(soloDist).toBeGreaterThan(0);
    expect(soloDist).toBeLessThan(5 * HEAVY_SOLO * 1.3);

    // 반대로 밀기
    setInput(duo, 0, { mx: 1, mz: 0 });
    setInput(duo, 1, { mx: -1, mz: 0 });
    const x2 = b2.x;
    steps(duo, 90);
    expect(Math.abs(b2.x - x2)).toBeLessThan(0.6);
  });

  it("loading furniture with two people credits both", () => {
    const rt = setup(2);
    const s = rt.state;
    const L = layoutOf(s);
    const dk = L.docks[0];
    const b = floorBox(rt, "heavy", dk.x, dk.zone.z1 + 3, s.docks[0].dest);
    place(rt, 0, dk.x - 1, dk.zone.z1 + 3, 0);
    press(rt, 0, "grab");
    step(rt);
    place(rt, 1, dk.x + 1, dk.zone.z1 + 3, Math.PI);
    press(rt, 1, "grab");
    step(rt);
    expect(b.holders.length).toBe(2);
    for (let i = 0; i < 300 && s.loaded === 0; i++) {
      setInput(rt, 0, { mx: 0, mz: -1 });
      setInput(rt, 1, { mx: 0, mz: -1 });
      step(rt);
    }
    expect(s.loaded).toBe(1);
    expect(s.players[0].stats.heavyDuo).toBe(1);
    expect(s.players[1].stats.heavyDuo).toBe(1);
    expect(s.teamScore).toBe(BOX_INFO.heavy.value);
  });
});

describe("parcel panic — losses", () => {
  it("boxes reaching the belt end are missed with a penalty; cold boxes melt", () => {
    const rt = setup(2);
    const s = rt.state;
    const L = layoutOf(s);
    spawnBox(s, L, "normal", { unknown: false, x: L.belt.x1 - 0.3 });
    steps(rt, 40);
    expect(s.missed).toBe(1);
    expect(s.teamScore).toBe(-MISS_PENALTY);
    const c = floorBox(rt, "cold", 0, 2);
    c.expireAt = s.t + 30;
    steps(rt, 5);
    expect(s.melted).toBe(1);
    expect(c.state).toBe("gone");
  });

  it("inspector reveals labels on pickup and buys cold boxes time", () => {
    const rt = setup(2);
    const s = rt.state;
    s.players[0].role = "inspector";
    const b = spawnBox(s, layoutOf(s), "cold", { unknown: true, x: 0, z: 2.3, state: "floor" });
    const exp = b.expireAt;
    place(rt, 0, 0, 3);
    press(rt, 0, "grab");
    step(rt);
    expect(b.known).toBe(true);
    expect(b.expireAt).toBeGreaterThan(exp);
  });
});

describe("parcel panic — versus", () => {
  it("dashing into a carrier knocks the box out (fragile breaks)", () => {
    const rt = setup(2, { mode: "versus" });
    const s = rt.state;
    const b = floorBox(rt, "normal", 0, 2.4);
    place(rt, 0, 0, 3.1);
    press(rt, 0, "grab");
    step(rt);
    expect(s.players[0].hold).toBe(b.id);
    place(rt, 1, -2.2, 3.1, 0);
    setInput(rt, 1, { mx: 1, mz: 0 });
    press(rt, 1, "dash");
    steps(rt, 30);
    expect(s.players[0].hold).toBe(-1);
    expect(s.players[1].stats.knocks).toBe(1);
    expect(s.events.some((e) => e.k === "knock")).toBe(true);
  });

  it("ranks by personal score; co-op ranks everyone together by stars", () => {
    const rt = setup(3, { mode: "versus" });
    const s = rt.state;
    s.players[0].score = 30;
    s.players[1].score = 50;
    s.players[2].score = 30;
    expect(computeRanks(s)).toEqual([2, 1, 2]);
    const co = setup(3);
    co.state.teamScore = co.state.targets[0];
    expect(computeRanks(co.state)).toEqual([1, 1, 1]);
    co.state.teamScore = 0;
    expect(computeRanks(co.state)).toEqual([2, 2, 2]);
  });
});

describe("parcel panic — incidents, net, bots", () => {
  it("truck swap exchanges destinations and both trucks come back", () => {
    const rt = setup(4, { incidents: true });
    const s = rt.state;
    const before = s.docks.map((d) => d.dest);
    s.lastIncident = "blackout";
    // 트럭 바꾸기만 나오게 다른 사건을 후보에서 뺄 수 없으니 여러 번 시도
    let swapped = false;
    for (let tries = 0; tries < 30 && !swapped; tries++) {
      s.incident = null;
      s.nextIncidentAt = s.t;
      step(rt);
      if ((s.incident as { k: string } | null)?.k === "swap") swapped = true;
      else {
        s.fork = null;
        s.incident = null;
      }
    }
    expect(swapped).toBe(true);
    const after = s.docks.map((d) => d.dest);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
    steps(rt, 60 * 5);
    expect(s.docks.every((d) => d.state === "here")).toBe(true);
    // 목적지로 트럭을 찾는 함수가 바뀐 자리를 따라간다
    for (const d of after) expect(s.docks[dockFor(s, d)].dest).toBe(d);
  });

  it("forklift knocks a carrier off its lane", () => {
    const rt = setup(2, { incidents: true });
    const s = rt.state;
    const L = layoutOf(s);
    const lane = L.lanes[0];
    const b = floorBox(rt, "fragile", 0, lane - 0.7);
    place(rt, 0, 0, lane);
    press(rt, 0, "grab");
    step(rt);
    expect(s.players[0].hold).toBe(b.id);
    place(rt, 0, 0, lane);
    s.fork = { z: lane, x: -4, dir: 1, goAt: s.t };
    steps(rt, 120);
    expect(s.players[0].hold).toBe(-1);
    expect(s.players[0].stats.forkHits).toBe(1);
    expect(s.broken).toBe(1);
  });

  it("snapshots round-trip and a migrated host keeps going deterministically", () => {
    const s = createMatch(7, [
      { bot: true, level: 6 },
      { bot: true, level: 6 },
      { bot: true, level: 6 },
    ]);
    const rt = createHost(s, botThink);
    steps(rt, 60 * 40);
    const snap = makeSnap(s, 1);
    expect(isSnap(snap)).toBe(true);
    const json = JSON.parse(JSON.stringify(snap));
    expect(isSnap(json)).toBe(true);
    const a = createHost(stateFromSnap(json), botThink);
    const b = createHost(stateFromSnap(json), botThink);
    steps(a, 60 * 10);
    steps(b, 60 * 10);
    expect(a.state.teamScore).toBe(b.state.teamScore);
    expect(a.state.boxes.length).toBe(b.state.boxes.length);
  });

  it("bots on their own finish a shift with deliveries and stats", () => {
    const s = createMatch(99, [
      { bot: true, level: 7 },
      { bot: true, level: 7 },
    ], { seconds: 120 });
    const rt = createHost(s, botThink);
    let guard = 0;
    while (s.phase !== "gameOver" && guard++ < 60 * 200) step(rt);
    expect(s.phase).toBe("gameOver");
    expect(s.loaded).toBeGreaterThan(10);
    expect(s.ranks).not.toBeNull();
    const d = parcelPanicStatDetails(s, 0);
    expect(d.loads).toBeGreaterThan(0);
    expect(d.teamScore).toBe(Math.round(s.teamScore));
    expect(s.events.some((e) => e.k === "over")).toBe(true);
  });

  it("solo practice works with one seat and ignores inputs for bot seats", () => {
    const s = createMatch(3, [{ bot: false, level: 5 }]);
    const rt = createHost(s, botThink);
    while (s.phase === "countdown") step(rt);
    expect(s.seatCount).toBe(1);
    expect(s.options.mode).toBe("coop");
    const s2 = createMatch(3, [
      { bot: false, level: 5 },
      { bot: true, level: 5 },
    ]);
    const rt2 = createHost(s2, null);
    applyInput(rt2, 1, { mx: 1, mz: 0 });
    expect(rt2.inputs[1].mx).toBe(0);
    expect(s2.t).toBe(0);
    expect(COUNTDOWN_MS).toBeGreaterThan(0);
  });
});
