import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { buildCourse, cellIndex, distanceField, grippable, reachable } from "./course";
import { COURSES, COURSE_IDS, GRAB_MIN, LEDGE, OVERHANG, ROPE_LEN, ROPE_MIN, SMOOTH, STAM_MAX, STEP_MS, TEAM_FALL_MS, WALL_W, sanitizeOptions } from "./data";
import { isSnap, makeSnap, SnapBuffer, stateFromSnap } from "./net";
import { applyInput, campSpot, createHost, createMatch, mvpSeats, setAway, step, type HostRuntime, type MatchState } from "./sim";
import { ropeClimbStatDetails } from "./stats";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function start(n = 2, opts: Parameters<typeof createMatch>[2] = {}, seed = 7): { s: MatchState; rt: HostRuntime } {
  const s = createMatch(seed, humans(n), opts);
  const rt = createHost(s);
  while (s.phase === "countdown") step(rt);
  return { s, rt };
}

const run = (rt: HostRuntime, ms: number) => {
  for (let i = 0; i < Math.round(ms / STEP_MS); i++) step(rt);
};

/** 주어진 종류의 칸 중심 하나 (없으면 실패) */
function findCell(s: MatchState, pred: (v: number, r: number, c: number) => boolean): { x: number; y: number } {
  const course = buildCourse(s.seed, s.options.course);
  for (let i = WALL_W; i < course.cells.length - WALL_W; i++) {
    const r = Math.floor(i / WALL_W);
    const c = i % WALL_W;
    if (pred(course.cells[i], r, c)) return { x: c + 0.5 - WALL_W / 2, y: r + 0.5 };
  }
  throw new Error("no such cell");
}

/** r0~r1행에 턱이 하나도 없는 열의 x (떨어뜨려도 중간에 안 걸리게) */
function freeColumnX(s: MatchState, r0: number, r1: number): number {
  const course = buildCourse(s.seed, s.options.course);
  for (let c = 0; c < WALL_W; c++) {
    let ok = true;
    for (let r = r0; r <= r1; r++) if (course.cells[r * WALL_W + c] === LEDGE) ok = false;
    if (ok) return c + 0.5 - WALL_W / 2;
  }
  throw new Error("no free column");
}

describe("한 줄 등반대 — 벽", () => {
  it("같은 씨앗이면 같은 벽, 다른 씨앗이면 다른 벽", () => {
    expect(buildCourse(11, "ice").cells).toEqual(buildCourse(11, "ice").cells);
    expect(buildCourse(11, "ice").cells).not.toEqual(buildCourse(12, "ice").cells);
  });

  it("어느 산이든 출발 바닥에서 정상까지 잡을 수 있는 길이 있다 (씨앗 60개씩)", () => {
    for (const id of COURSE_IDS) for (let seed = 1; seed <= 60; seed++) expect(reachable(buildCourse(seed * 7919, id)), `${id} ${seed}`).toBe(true);
  });

  it("바닥과 정상은 전부 턱, 캠프는 산 설정 수만큼, 별은 3개", () => {
    for (const id of COURSE_IDS) {
      const c = buildCourse(5, id);
      const H = COURSES[id].height;
      for (let col = 0; col < WALL_W; col++) {
        expect(c.cells[col]).toBe(LEDGE);
        expect(c.cells[H * WALL_W + col]).toBe(LEDGE);
      }
      expect(c.camps.length).toBe(COURSES[id].camps + 1);
      expect(c.stars.length).toBe(3);
    }
  });

  it("매끈한 띠에는 오버행 틈이 있고, 띠 위에는 바위가 두 줄 이상 있다", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = buildCourse(seed, "ice");
      for (const b of c.bands) {
        const above1 = c.cells.slice((b.r1 + 1) * WALL_W, (b.r1 + 2) * WALL_W);
        const above2 = c.cells.slice((b.r1 + 2) * WALL_W, (b.r1 + 3) * WALL_W);
        expect(above1.every((v) => grippable(v))).toBe(true);
        expect(above2.some((v) => grippable(v))).toBe(true);
      }
    }
  });

  it("거리장은 정상에서 0이고 아래로 갈수록 커진다", () => {
    const c = buildCourse(3, "hill");
    const d = distanceField(c);
    expect(d[c.height * WALL_W]).toBe(0);
    expect(Math.min(...d.slice(0, WALL_W))).toBeGreaterThan(c.height * 0.5);
  });

  it("옵션은 이상한 값을 기본값으로 고친다", () => {
    expect(sanitizeOptions({ course: "moon" as never, lives: 9 as never })).toEqual({ course: "hill", lives: 3 });
    expect(sanitizeOptions({ course: "volcano", lives: 5 })).toEqual({ course: "volcano", lives: 5 });
  });
});

describe("한 줄 등반대 — 몸과 체력", () => {
  it("카운트다운 뒤 등반이 시작되고 모두 바닥 턱에 서 있다", () => {
    const { s } = start(3);
    expect(s.phase).toBe("climb");
    for (const p of s.players) {
      expect(p.mode).toBe("grip");
      expect(p.y).toBeLessThan(1);
      expect(p.stam).toBe(STAM_MAX);
    }
    expect(s.ropes).toEqual([ROPE_LEN, ROPE_LEN]);
  });

  it("바위를 오르면 체력이 닳고, 턱에 서 있으면 다시 찬다", () => {
    const { s, rt } = start(2);
    // 줄에 안 걸리게 둘이 같이 올린다
    applyInput(rt, 0, { mx: 0, my: 1 });
    applyInput(rt, 1, { mx: 0, my: 1 });
    run(rt, 1200);
    expect(s.players[0].y).toBeGreaterThan(1.5);
    const used = s.players[0].stam;
    expect(used).toBeLessThan(STAM_MAX);
    applyInput(rt, 0, { mx: 0, my: -1 });
    applyInput(rt, 1, { mx: 0, my: -1 });
    run(rt, 2500);
    expect(s.players[0].y).toBeLessThan(1);
    expect(s.players[0].stam).toBeGreaterThan(used);
  });

  it("매끈한 암반으로는 기어 들어갈 수 없다", () => {
    const { s, rt } = start(2, {}, 21);
    const course = buildCourse(s.seed, "hill");
    const at = findCell(s, (v, r, c) => v === SMOOTH && grippable(course.cells[(r - 1) * WALL_W + c]) && r > 1);
    for (const p of s.players) {
      p.x = at.x;
      p.y = at.y - 1;
    }
    applyInput(rt, 0, { mx: 0, my: 1 });
    run(rt, 1500);
    expect(s.players[0].y).toBeLessThan(at.y - 0.5 + 0.01);
    expect(s.players[0].mode).toBe("grip");
  });

  it("방향 없이 잡기 버튼 = 손 놓기, 공중에서 다시 누르면 바위를 잡는다", () => {
    const { s, rt } = start(2);
    for (const p of s.players) p.y = 2.5;
    applyInput(rt, 0, { mx: 0, my: 0, grab: 1 });
    step(rt);
    expect(s.players[0].mode).toBe("air");
    run(rt, 300);
    applyInput(rt, 0, { mx: 0, my: 0, grab: 2 });
    run(rt, 100);
    expect(s.players[0].mode).toBe("grip");
    expect(s.players[0].y).toBeLessThan(2.5);
  });

  it("도약은 위로 약 2m 솟고 체력을 쓴다", () => {
    const { s, rt } = start(2);
    for (const p of s.players) p.y = 2.5;
    const before = s.players[0].stam;
    applyInput(rt, 0, { mx: 0, my: 1, grab: 1 });
    let top = 0;
    for (let i = 0; i < 60; i++) {
      step(rt);
      top = Math.max(top, s.players[0].y);
    }
    expect(top - 2.5).toBeGreaterThan(1.6);
    expect(top - 2.5).toBeLessThan(2.4);
    expect(s.players[0].stam).toBeLessThan(before);
    expect(s.players[0].stats.leaps).toBe(1);
  });

  it("체력이 0이 되면 손을 놓치고, 충분히 찰 때까지 다시 못 잡는다", () => {
    const { s, rt } = start(2);
    const [a, b] = s.players;
    a.y = 2.5;
    b.y = 2.5;
    b.x = a.x + 1;
    a.stam = 0.05;
    applyInput(rt, 0, { mx: 0, my: 1 });
    run(rt, 200);
    expect(a.mode).toBe("air");
    expect(a.tired).toBe(true);
    expect(a.stats.slips).toBe(1);
    // 바위 위에서 잡기를 눌러도 체력이 모자라 못 잡는다
    a.stam = GRAB_MIN - 10;
    a.y = 2.4;
    a.vy = 0;
    applyInput(rt, 0, { mx: 0, my: 0, grab: 5 });
    step(rt);
    expect(a.mode).toBe("air");
  });

  it("떨어지다 턱에 닿으면 저절로 내려선다", () => {
    const { s, rt } = start(2);
    const p = s.players[0];
    p.y = 1.8;
    applyInput(rt, 0, { grab: 1 });
    run(rt, 900);
    expect(p.mode).toBe("grip");
    expect(p.y).toBeLessThan(1);
  });
});

describe("한 줄 등반대 — 줄", () => {
  it("둘 다 잡고 있으면 줄 길이보다 멀어질 수 없다", () => {
    const { s, rt } = start(2);
    applyInput(rt, 0, { mx: -1, my: 0 });
    applyInput(rt, 1, { mx: 1, my: 0 });
    run(rt, 4000);
    const [a, b] = s.players;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(ROPE_LEN + 0.05);
  });

  it("손을 놓으면 잡고 있는 옆 사람 줄에 매달리고, 버티는 사람은 무게만큼 체력이 닳는다", () => {
    const { s, rt } = start(2);
    const [a, b] = s.players;
    a.x = 0;
    a.y = 9.5;
    b.x = 0.4;
    b.y = 8.5;
    // 둘 다 바위(턱이 아닌 곳)에 있게
    const course = buildCourse(s.seed, "hill");
    const okCell = (x: number, y: number) => course.cells[cellIndex(course, x, y)] === 0;
    if (!okCell(a.x, a.y) || !okCell(b.x, b.y)) return; // 이 씨앗에서 그 자리가 바위가 아니면 건너뜀
    applyInput(rt, 1, { grab: 1 });
    run(rt, 2500);
    expect(b.mode).toBe("air");
    expect(b.hang).toBe(true);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(ROPE_LEN + 0.05);
    expect(a.load).toBe(1);
    expect(s.taut[0]).toBe(1);
    const before = a.stam;
    run(rt, 1000);
    expect(before - a.stam).toBeGreaterThan(4);
    // 매달린 사람은 체력이 찬다
    expect(b.stam).toBeGreaterThan(90);
  });

  it("당기면 줄이 짧아져 매달린 사람이 끌려 올라오고, 다시 잡으면 줄이 풀린다", () => {
    const { s, rt } = start(2, {}, 7);
    const [a, b] = s.players;
    const spot = findCell(s, (v, r) => v === 0 && r >= 6 && r <= 10);
    a.x = spot.x;
    a.y = spot.y;
    b.x = spot.x;
    b.y = spot.y - 1;
    applyInput(rt, 1, { grab: 1 });
    run(rt, 2000);
    expect(b.hang).toBe(true);
    const lowY = b.y;
    applyInput(rt, 0, { haul: true });
    run(rt, 1500);
    expect(a.hauling).toBe(true);
    expect(s.ropes[0]).toBeLessThan(ROPE_LEN - 1);
    expect(b.y).toBeGreaterThan(lowY + 1);
    expect(a.stats.haulM).toBeGreaterThan(1);
    run(rt, 2500);
    expect(s.ropes[0]).toBeGreaterThanOrEqual(ROPE_MIN - 0.001);
    expect(a.pts).toBeGreaterThan(0);
  });

  it("떨어지던 사람이 줄 끝에서 채이면 받아냄으로 기록된다", () => {
    const { s, rt } = start(2, {}, 7);
    const [a, b] = s.players;
    const spot = findCell(s, (v, r) => v === 0 && r >= 8 && r <= 12);
    a.x = spot.x;
    a.y = spot.y;
    b.x = spot.x + 0.3;
    b.y = spot.y + 0.3;
    b.mode = "air";
    b.vy = 0;
    run(rt, 1200);
    expect(a.stats.catches).toBe(1);
    expect(b.stats.saved).toBe(1);
    expect(a.stam).toBeLessThan(STAM_MAX - 5);
    expect(s.events.some((e) => e.k === "catch")).toBe(true);
  });

  it("아무도 못 잡은 채 0.9초가 지나면 팀 추락 — ⛑ 하나를 잃고 캠프에서 다시", () => {
    const { s, rt } = start(2);
    const x = freeColumnX(s, 12, 21);
    for (const p of s.players) {
      p.x = x;
      p.y = 20.5;
      p.mode = "air";
      p.vy = 0;
      p.tired = true;
      p.stam = 0;
    }
    // 0.9초 동안 5m쯤 떨어진다 — 그 사이 턱이 없는 열이라 아무도 못 잡는다
    run(rt, TEAM_FALL_MS + 100);
    expect(s.falls).toBe(1);
    expect(s.lives).toBe(2);
    const at = campSpot(buildCourse(s.seed, "hill"), s.camp, 0, 2);
    expect(s.players[0].y).toBeCloseTo(at.y, 1);
    expect(s.players[0].stam).toBe(STAM_MAX);
    expect(s.players[0].mode).toBe("grip");
  });

  it("⛑가 0일 때 또 추락하면 실패 — 전원 꼴찌로 기록", () => {
    const { s, rt } = start(3, { lives: 2 });
    for (let k = 0; k < 3; k++) {
      const x = freeColumnX(s, 12, 21);
      for (const p of s.players) {
        p.x = x;
        p.y = 20.5;
        p.mode = "air";
        p.vx = 0;
        p.vy = 0;
        p.tired = true;
        p.stam = 0;
        p.stunUntil = 0;
      }
      run(rt, TEAM_FALL_MS + 100);
    }
    expect(s.phase).toBe("gameOver");
    expect(s.cleared).toBe(false);
    expect(s.ranks).toEqual([3, 3, 3]);
    expect(s.grade).toBe(0);
  });
});

describe("한 줄 등반대 — 진행", () => {
  it("모두 정상에 서면 완등 — 전원 1등, 추락 없고 빠르면 ⭐⭐⭐", () => {
    const { s, rt } = start(2);
    const H = COURSES.hill.height;
    s.players[0].x = -1;
    s.players[0].y = H + 0.2;
    s.players[1].x = 1;
    s.players[1].y = H - 0.6;
    step(rt);
    expect(s.phase).toBe("climb");
    expect(s.players[0].summit).toBe(true);
    applyInput(rt, 1, { mx: 0, my: 1 });
    run(rt, 1500);
    expect(s.phase).toBe("gameOver");
    expect(s.cleared).toBe(true);
    expect(s.ranks).toEqual([1, 1]);
    expect(s.grade).toBe(3);
    expect(s.alt).toBe(H);
    expect(mvpSeats(s).length).toBeGreaterThan(0);
    const d = ropeClimbStatDetails(s, 0);
    expect(d.summits).toBe(1);
    expect(d.stars3).toBe(1);
    expect(d.maxAlt).toBe(H);
  });

  it("캠프 턱에 닿으면 체크포인트가 올라간다", () => {
    const { s, rt } = start(2);
    const course = buildCourse(s.seed, "hill");
    const cp = course.camps[1];
    s.players[0].x = cp.c0 + 0.5 - WALL_W / 2;
    s.players[0].y = cp.row + 0.2;
    s.players[1].x = cp.c0 + 1.5 - WALL_W / 2;
    s.players[1].y = cp.row + 0.2;
    step(rt);
    expect(s.camp).toBe(1);
    expect(s.events.some((e) => e.k === "camp")).toBe(true);
  });

  it("제한 시간이 끝나면 실패로 끝난다", () => {
    const { s, rt } = start(2);
    s.climbStart = s.t - COURSES.hill.limitMs + 50;
    run(rt, 200);
    expect(s.phase).toBe("gameOver");
    expect(s.cleared).toBe(false);
  });

  it("부서지는 바위는 잡은 지 1.6초 뒤 매끈해지고 잡고 있던 사람은 떨어진다", () => {
    const s = createMatch(3, humans(2), { course: "volcano" });
    const rt = createHost(s);
    while (s.phase === "countdown") step(rt);
    const course = buildCourse(s.seed, "volcano");
    const at = findCell(s, (v) => v === 3);
    const i = cellIndex(course, at.x, at.y);
    s.players[0].x = at.x;
    s.players[0].y = at.y;
    s.players[1].x = at.x;
    s.players[1].y = at.y;
    s.nextRockAt = 1e12;
    s.nextWindAt = 1e12;
    run(rt, 1700);
    expect(s.gone).toContain(i);
    expect(rt.cells[i]).toBe(SMOOTH);
    run(rt, 100);
    expect(s.players[0].mode).toBe("air");
  });

  it("낙석에 맞으면 체력이 깎이고 벽에서 떨어진다 (정상에 선 사람은 안 맞는다)", () => {
    const { s, rt } = start(2, {}, 7);
    const spot = findCell(s, (v, r) => v === 0 && r >= 6 && r <= 10);
    const [a, b] = s.players;
    a.x = spot.x;
    a.y = spot.y;
    b.x = spot.x;
    b.y = spot.y - 1;
    s.rocks.push({ id: 99, x: spot.x, y: spot.y + 3, y0: spot.y + 3, endY: -2, fallAt: s.t, hit: [] });
    run(rt, 600);
    expect(a.stats.rockHits).toBe(1);
    expect(a.stam).toBeLessThan(STAM_MAX - 10);
    expect(s.events.some((e) => e.k === "rockHit" && e.s === 0)).toBe(true);
  });

  it("오버행에선 같은 시간에 체력이 2배 넘게 닳는다", () => {
    const s = createMatch(4, humans(2), { course: "ice" });
    const rt = createHost(s);
    while (s.phase === "countdown") step(rt);
    s.nextRockAt = 1e12;
    s.nextWindAt = 1e12;
    const over = findCell(s, (v) => v === OVERHANG);
    const rock = findCell(s, (v, r) => v === 0 && r > 2);
    const [a, b] = s.players;
    a.x = over.x;
    a.y = over.y;
    b.x = over.x;
    b.y = over.y;
    run(rt, 1000);
    const usedOver = STAM_MAX - a.stam;
    a.stam = STAM_MAX;
    b.stam = STAM_MAX;
    a.x = b.x = rock.x;
    a.y = b.y = rock.y;
    run(rt, 1000);
    const usedRock = STAM_MAX - a.stam;
    expect(usedOver).toBeGreaterThan(usedRock * 2);
  });
});

describe("한 줄 등반대 — 봇 대체·스냅샷", () => {
  it("나간 사람 자리는 봇이 대신하고, 돌아오면 돌려받는다", () => {
    const s = createMatch(5, humans(2));
    const rt = createHost(s, botThink);
    while (s.phase === "countdown") step(rt);
    setAway(rt, 1, true);
    expect(s.players[1].bot).toBe(true);
    expect(s.players[1].away).toBe(true);
    applyInput(rt, 1, { mx: 1, my: 0 });
    expect(rt.inputs[1].mx).toBe(0);
    setAway(rt, 1, false);
    expect(s.players[1].bot).toBe(false);
    applyInput(rt, 1, { mx: 1, my: 0 });
    expect(rt.inputs[1].mx).toBe(1);
  });

  it("스냅샷으로 판을 그대로 이어받을 수 있다 (방장 승계)", () => {
    const s = createMatch(9, [{ bot: true, level: 8 }, { bot: true, level: 8 }, { bot: true, level: 8 }], { course: "hill" });
    const rt = createHost(s, botThink);
    for (let i = 0; i < 60 * 25; i++) step(rt);
    const snap = makeSnap(s, 42);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const wire = JSON.parse(JSON.stringify(snap));
    const s2 = stateFromSnap(wire);
    expect("seq" in s2).toBe(false);
    const rt2 = createHost(s2, botThink);
    let guard = 0;
    while (s2.phase !== "gameOver" && guard++ < 60 * 60 * 5) step(rt2);
    expect(s2.phase).toBe("gameOver");
    expect(s2.alt).toBeGreaterThanOrEqual(s.alt);
  });

  it("스냅샷 버퍼는 새 이벤트만 한 번씩 돌려주고, 내 몸은 조금 앞서 그린다", () => {
    const { s, rt } = start(2);
    const buf = new SnapBuffer();
    const first = buf.push(makeSnap(s, 1), 1000);
    expect(first.some((e) => e.k === "go")).toBe(true);
    applyInput(rt, 0, { mx: 0, my: 1 });
    applyInput(rt, 1, { mx: 0, my: 1 });
    run(rt, 100);
    const again = buf.push(makeSnap(s, 2), 1100);
    expect(again.some((e) => e.k === "go")).toBe(false);
    const ahead = buf.ahead(0, 1200)!;
    const body = buf.body(0, 1200)!;
    expect(ahead.y).toBeGreaterThan(body.y);
    // 옛 스냅샷은 버린다
    expect(buf.push(makeSnap(s, 1), 1300)).toEqual([]);
  });
});
