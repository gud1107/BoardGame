import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { BLEED_MS, BIND_MS, FLICKER_MS, FLICKER_WARN_MS, GRACE_MS, PLACE_MS, REVIVE_MS, SEARCH_MS, STARE_MS, TICK_MS, TIME_LIMIT_MS, TOPPLE_MS, clockText, fusesFor, gradeOf, sanitizeOptions } from "./data";
import { createLocal, findTarget, iSee, reportOf, stepLocal, syncLocal } from "./localBody";
import { BLOCKED, CONTAINERS, EXIT, MANNEQUIN_CELLS, MAP_ROWS, PANEL, PANEL_CELL, START_CELLS, WALKABLE, centerOf, clearLine, collide, idx, pathDist, walkCellAt, walkField } from "./map";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import { ITEM_ORDER, applyAct, applyReport, createHost, createMatch, hostStep, sees, watched, type HostRuntime, type Mannequin, type PosReport } from "./sim";
import { mannequinMallStatDetails } from "./stats";

/** 사람만 있는 판. 정전·깨어나기를 멀리 미뤄 두고 원하는 마네킹만 깨운다. */
function match(seats = 1, difficulty: "easy" | "normal" | "hard" | "nightmare" = "normal", seed = 7): HostRuntime {
  const s = createMatch(seed, Array.from({ length: seats }, () => ({ bot: false, level: 5 })), { difficulty });
  const rt = createHost(s, botThink);
  s.t = GRACE_MS + 100;
  s.awakeWant = 0;
  s.flicker.at = s.t + 600_000;
  return rt;
}

function place(rt: HostRuntime, seat: number, x: number, z: number, yaw = 0, pitch = 0) {
  const p = rt.state.players[seat];
  p.x = x;
  p.z = z;
  p.yaw = yaw;
  p.pitch = pitch;
}

/** 마네킹 하나를 (x, z)에 세우고 깨운다 */
function wakeAt(rt: HostRuntime, id: number, x: number, z: number): Mannequin {
  const m = rt.state.mannequins[id];
  m.x = x;
  m.z = z;
  m.awake = true;
  m.restUntil = 0;
  return m;
}

/** 사람이 (x, z)를 보도록 고개를 돌린다 */
const yawTo = (fx: number, fz: number, x: number, z: number) => Math.atan2(-(x - fx), -(z - fz));

const run = (rt: HostRuntime, ms: number, each?: () => void) => {
  for (let t = 0; t < ms; t += TICK_MS) {
    each?.();
    hostStep(rt, TICK_MS);
  }
};

const rep = (rt: HostRuntime, seat: number, patch: Partial<PosReport>): PosReport => {
  const p = rt.state.players[seat];
  return { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, mv: 0, light: true, use: null, ...patch };
};

// 남쪽 큰 통로(14행)는 길게 뚫려 있어 시선 실험에 쓴다
const ROW14 = (c: number) => centerOf(idx(c, 14));

describe("매장 지도", () => {
  it("모든 줄이 같은 길이이고, 모든 바닥 칸이 시작 자리에서 걸어서 닿는다", () => {
    for (const r of MAP_ROWS) expect(r.length).toBe(MAP_ROWS[0].length);
    const f = walkField(START_CELLS[0]);
    for (const c of WALKABLE) expect(Number.isFinite(f[c]), `cell ${c}`).toBe(true);
  });

  it("상자 28개는 모두 옆 칸에서 손이 닿고, 마네킹 자리 26곳은 모두 걸을 수 있는 칸", () => {
    expect(CONTAINERS.length).toBe(28);
    const f = walkField(START_CELLS[0]);
    for (const c of CONTAINERS) {
      expect(BLOCKED[c.cell]).toBe(1);
      const near = WALKABLE.filter((w) => Math.hypot(centerOf(w).x - c.x, centerOf(w).z - c.z) <= 2.01);
      expect(near.some((w) => Number.isFinite(f[w])), `container ${c.i}`).toBe(true);
    }
    expect(MANNEQUIN_CELLS.length).toBe(26);
    for (const m of MANNEQUIN_CELLS) expect(BLOCKED[m], `mannequin ${m}`).toBe(0);
    expect(BLOCKED[PANEL_CELL]).toBe(1);
    expect(Number.isFinite(f[walkCellAt(PANEL.x, PANEL.z + 1)])).toBe(true);
    expect(Number.isFinite(f[walkCellAt(EXIT.x, EXIT.z)])).toBe(true);
  });

  it("진열장·벽은 시선을 막고, 낮은 계산대·에스컬레이터 빈 곳 너머는 보인다", () => {
    // 남성복 진열장(2~4열, 8행) 너머
    expect(clearLine(centerOf(idx(3, 7)).x, centerOf(idx(3, 7)).z, centerOf(idx(3, 9)).x, centerOf(idx(3, 9)).z)).toBe(false);
    // 에스컬레이터 빈 곳(13~17열, 8~11행) 너머: 12열 통로 ↔ 18열 통로
    expect(clearLine(centerOf(idx(12, 9)).x, centerOf(idx(12, 9)).z, centerOf(idx(18, 9)).x, centerOf(idx(18, 9)).z)).toBe(true);
    // 바깥벽
    expect(clearLine(centerOf(idx(1, 14)).x, centerOf(idx(1, 14)).z, -3, centerOf(idx(1, 14)).z)).toBe(false);
  });

  it("몸은 벽·진열장·마네킹에서 밀려난다", () => {
    const p = { x: centerOf(idx(3, 7)).x, z: centerOf(idx(3, 8)).z };
    collide(p);
    expect(BLOCKED[walkCellAt(p.x, p.z)]).toBe(0);
    const a = ROW14(10);
    const q = { x: a.x + 0.1, z: a.z };
    collide(q, 0.3, [{ x: a.x, z: a.z }]);
    expect(Math.hypot(q.x - a.x, q.z - a.z)).toBeGreaterThanOrEqual(0.61);
  });
});

describe("판 만들기", () => {
  it("인원별 퓨즈 수, 퓨즈는 서로 다른 매장 상자에 (안내 데스크 제외)", () => {
    for (const n of [1, 2, 3, 4]) {
      const s = createMatch(11 + n, Array.from({ length: n }, () => ({ bot: false, level: 5 })));
      expect(s.need).toBe(fusesFor(n));
      const fuseIdx = ITEM_ORDER.indexOf("fuse");
      const rooms = CONTAINERS.filter((c) => s.contents[c.i] === fuseIdx).map((c) => c.room);
      expect(rooms.length).toBe(s.need);
      expect(rooms).not.toContain("e");
      expect(new Set(rooms).size).toBe(Math.min(rooms.length, 8));
      expect(s.mannequins.every((m) => !m.awake)).toBe(true);
    }
  });

  it("같은 씨앗이면 같은 판", () => {
    const a = createMatch(99, [{ bot: false, level: 5 }, { bot: true, level: 5 }]);
    const b = createMatch(99, [{ bot: false, level: 5 }, { bot: true, level: 5 }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("옵션은 이상한 값을 보통으로", () => {
    expect(sanitizeOptions({ difficulty: "x" as never }).difficulty).toBe("normal");
    expect(sanitizeOptions(null).difficulty).toBe("normal");
  });

  it("유예 시간이 지나면 깨어 있어야 할 수만큼, 모두에게서 먼 마네킹이 깨어난다", () => {
    const s = createMatch(5, [{ bot: false, level: 5 }, { bot: false, level: 5 }, { bot: false, level: 5 }]);
    const rt = createHost(s, null);
    run(rt, GRACE_MS + 1100);
    const awake = s.mannequins.filter((m) => m.awake);
    expect(awake.length).toBe(2);
    for (const m of awake) for (const p of s.players) expect(pathDist(m.x, m.z, p.x, p.z)).toBeGreaterThanOrEqual(12);
  });
});

describe("시선", () => {
  it("켠 손전등: 앞 17m까지 보이고, 등 뒤·옆은 안 보인다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const b = ROW14(11);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z));
    expect(sees(s, s.players[0], b.x, b.z)).toBe(true);
    s.players[0].yaw += Math.PI;
    expect(sees(s, s.players[0], b.x, b.z)).toBe(false);
    s.players[0].yaw -= Math.PI / 2;
    expect(sees(s, s.players[0], b.x, b.z)).toBe(false);
    // 바닥만 내려다보면 안 보인다
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z), -1.3);
    expect(sees(s, s.players[0], b.x, b.z)).toBe(false);
  });

  it("손전등을 끄면 4m 안만, 정전 중엔 아무도 못 본다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const near = ROW14(5);
    const far = ROW14(9);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, far.x, far.z));
    s.players[0].light = false;
    expect(sees(s, s.players[0], near.x, near.z)).toBe(true);
    expect(sees(s, s.players[0], far.x, far.z)).toBe(false);
    s.players[0].light = true;
    s.flicker.st = "dark";
    expect(sees(s, s.players[0], near.x, near.z)).toBe(false);
  });

  it("건전지가 없으면 켜도 꺼진 것과 같다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const far = ROW14(9);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, far.x, far.z));
    s.players[0].battery = 0;
    expect(sees(s, s.players[0], far.x, far.z)).toBe(false);
  });
});

describe("마네킹", () => {
  it("아무도 안 보면 다가와 붙잡고, 붙잡힌 사람은 굳는다", () => {
    const rt = match(2);
    const s = rt.state;
    // 동료는 창고 구석에서 벽을 본다
    place(rt, 1, centerOf(idx(2, 1)).x, centerOf(idx(2, 1)).z, Math.PI / 2);
    const a = ROW14(4);
    const b = ROW14(9);
    place(rt, 0, a.x, a.z, yawTo(b.x, b.z, a.x, a.z) + Math.PI);
    s.players[0].yaw = yawTo(a.x, a.z, b.x, b.z) + Math.PI; // 등을 돌린다
    const m = wakeAt(rt, 0, b.x, b.z);
    const d0 = Math.hypot(m.x - a.x, m.z - a.z);
    run(rt, 500);
    expect(Math.hypot(m.x - a.x, m.z - a.z)).toBeLessThan(d0 - 1);
    run(rt, 4000);
    expect(s.players[0].st).toBe("down");
    expect(s.players[0].stats.downs).toBe(1);
    expect(s.events.some((e) => e.k === "grab")).toBe(true);
  });

  it("보고 있는 동안은 한 발짝도 안 움직이고, 포즈도 그대로", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const b = ROW14(9);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z));
    const m = wakeAt(rt, 0, b.x, b.z);
    const pose = m.pose;
    run(rt, 1500);
    expect(m.x).toBeCloseTo(b.x, 6);
    expect(m.z).toBeCloseTo(b.z, 6);
    expect(m.pose).toBe(pose);
    expect(watched(s, m)).toBe(true);
    expect(s.players[0].stats.stareSec).toBeGreaterThan(1.3);
  });

  it("눈을 돌렸다 다시 보면 포즈가 바뀌어 있다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(3);
    const b = ROW14(12);
    const look = yawTo(a.x, a.z, b.x, b.z);
    place(rt, 0, a.x, a.z, look);
    const m = wakeAt(rt, 0, b.x, b.z);
    const pose = m.pose;
    s.players[0].yaw = look + Math.PI;
    run(rt, 300);
    s.players[0].yaw = look;
    expect(m.pose).not.toBe(pose);
  });

  it("정전 중엔 보고 있어도 움직인다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const b = ROW14(10);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z));
    const m = wakeAt(rt, 0, b.x, b.z);
    s.flicker = { st: "dark", at: 0, until: s.t + 1000, count: 1 };
    run(rt, 400);
    expect(Math.hypot(m.x - b.x, m.z - b.z)).toBeGreaterThan(0.5);
  });

  it("진열장 뒤에 숨은 마네킹은 내 손전등이 닿지 않는다", () => {
    const rt = match();
    const s = rt.state;
    const a = centerOf(idx(3, 7));
    const b = centerOf(idx(3, 9));
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z));
    const m = wakeAt(rt, 0, b.x, b.z);
    expect(watched(s, m)).toBe(false);
  });
});

describe("노려보기", () => {
  it(`켠 손전등으로 ${STARE_MS / 1000}초쯤 비추면 쓰러지고, 쓰러진 동안엔 안 봐도 못 움직인다`, () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const b = ROW14(8);
    const look = yawTo(a.x, a.z, b.x, b.z);
    place(rt, 0, a.x, a.z, look);
    const m = wakeAt(rt, 0, b.x, b.z);
    run(rt, STARE_MS - 300);
    expect(m.downUntil).toBe(0);
    run(rt, 500);
    expect(m.downUntil).toBeGreaterThan(s.t);
    expect(s.players[0].stats.topples).toBe(1);
    s.players[0].yaw = look + Math.PI;
    run(rt, TOPPLE_MS - 1000);
    expect(Math.hypot(m.x - b.x, m.z - b.z)).toBeLessThan(0.01);
    run(rt, 1500);
    expect(s.events.some((e) => e.k === "rise")).toBe(true);
    run(rt, 600);
    expect(Math.hypot(m.x - b.x, m.z - b.z)).toBeGreaterThan(0.3);
  });

  it("두 사람이 함께 비추면 두 배로 빨리, 쓰러질 때마다 더 오래 버틴다", () => {
    const rt = match(2);
    const s = rt.state;
    const a = ROW14(4);
    const a2 = ROW14(5);
    const b = ROW14(9);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z));
    place(rt, 1, a2.x, a2.z + 0.5, yawTo(a2.x, a2.z + 0.5, b.x, b.z));
    const m = wakeAt(rt, 0, b.x, b.z);
    run(rt, STARE_MS / 2 + 200);
    expect(m.downUntil).toBeGreaterThan(s.t);
    expect(m.topples).toBe(1);
    m.downUntil = s.t;
    run(rt, TICK_MS);
    run(rt, STARE_MS / 2 + 200);
    expect(m.downUntil).toBeLessThan(s.t);
  });

  it("손전등을 끄면 노려보기가 안 차오른다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const b = ROW14(5);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z));
    s.players[0].light = false;
    const m = wakeAt(rt, 0, b.x + 0.6, b.z);
    run(rt, STARE_MS + 500);
    expect(m.downUntil).toBe(0);
    expect(m.stare).toBe(0);
  });
});

describe("물건", () => {
  it("📸 플래시: 앞쪽 살아 있는 마네킹은 굳고 정체가 드러나며, 그냥 마네킹은 확인됨으로", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const b = ROW14(9);
    const c = ROW14(11);
    const look = yawTo(a.x, a.z, b.x, b.z);
    place(rt, 0, a.x, a.z, look + Math.PI);
    s.players[0].cameras = 1;
    const live = wakeAt(rt, 0, b.x, b.z);
    const dummy = s.mannequins[1];
    dummy.x = c.x;
    dummy.z = c.z;
    applyAct(rt, 0, { k: "flash", yaw: look, pitch: -0.03 });
    expect(s.players[0].cameras).toBe(0);
    expect(live.stunUntil).toBeGreaterThan(s.t);
    expect(live.revealUntil).toBeGreaterThan(s.t);
    expect(dummy.checked).toBe(true);
    expect(s.events.find((e) => e.k === "flash")?.n).toBe(1);
    // 등을 돌려도 굳어 있다
    run(rt, 2000);
    expect(Math.hypot(live.x - b.x, live.z - b.z)).toBeLessThan(0.01);
    // 카메라가 없으면 아무 일도 없다
    applyAct(rt, 0, { k: "flash", yaw: look, pitch: 0 });
    expect(s.players[0].stats.flashes).toBe(1);
  });

  it("🎀 포장 끈: 살아 있는 것은 묶이고, 그냥 마네킹은 확인만 된다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const b = { x: a.x - 1.2, z: a.z };
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, b.x, b.z));
    s.players[0].ribbons = 2;
    const live = wakeAt(rt, 0, b.x, b.z);
    applyReport(rt, 0, rep(rt, 0, { use: "m0" }));
    run(rt, BIND_MS + 100, () => applyReport(rt, 0, rep(rt, 0, { use: "m0" })));
    expect(live.boundUntil).toBeGreaterThan(s.t);
    expect(s.players[0].ribbons).toBe(1);
    const dummy = s.mannequins[1];
    dummy.x = a.x + 1.2;
    dummy.z = a.z;
    s.players[0].yaw = yawTo(a.x, a.z, dummy.x, dummy.z);
    run(rt, BIND_MS + 100, () => applyReport(rt, 0, rep(rt, 0, { use: "m1" })));
    expect(dummy.checked).toBe(true);
    expect(dummy.awake).toBe(false);
    expect(s.players[0].stats.decoys).toBe(1);
    expect(s.players[0].ribbons).toBe(0);
  });

  it("상자를 뒤지면 내용물을 얻고, 다 들고 있으면 그대로 둔다", () => {
    const rt = match();
    const s = rt.state;
    const c = CONTAINERS[0];
    const spot = centerOf(idx(2, 1));
    place(rt, 0, spot.x, spot.z, yawTo(spot.x, spot.z, c.x, c.z));
    s.contents[0] = ITEM_ORDER.indexOf("camera");
    s.players[0].cameras = 2;
    run(rt, SEARCH_MS + 100, () => applyReport(rt, 0, rep(rt, 0, { use: "c0" })));
    expect(s.searched[0]).toBe(false);
    expect(s.events.some((e) => e.k === "full")).toBe(true);
    s.players[0].cameras = 0;
    run(rt, SEARCH_MS + 100, () => applyReport(rt, 0, rep(rt, 0, { use: "c0" })));
    expect(s.searched[0]).toBe(true);
    expect(s.players[0].cameras).toBe(1);
  });
});

describe("퓨즈 · 셔터 · 탈출", () => {
  it("퓨즈를 꽂을 때마다 마네킹 하나가 더 깨어나고 정전이 앞당겨지며, 다 꽂으면 셔터가 열린다", () => {
    const rt = match();
    const s = rt.state;
    const at = { x: PANEL.x, z: PANEL.z + 1.4 };
    place(rt, 0, at.x, at.z, 0);
    s.players[0].fuses = s.need;
    const want0 = s.awakeWant;
    run(rt, PLACE_MS + 100, () => applyReport(rt, 0, rep(rt, 0, { use: "p" })));
    expect(s.placed).toBe(1);
    expect(s.awakeWant).toBe(want0 + 1);
    expect(s.flicker.at).toBeLessThan(s.t + 5000);
    s.flicker.at = s.t + 600_000;
    run(rt, (PLACE_MS + 100) * (s.need - 1), () => applyReport(rt, 0, rep(rt, 0, { use: "p" })));
    expect(s.placed).toBe(s.need);
    expect(s.exitOpen).toBe(true);
    // 셔터 앞으로
    place(rt, 0, EXIT.x, EXIT.z - 0.5);
    run(rt, 100);
    expect(s.players[0].st).toBe("escaped");
    run(rt, 100);
    expect(s.phase).toBe("gameOver");
    expect(s.outcome?.win).toBe(true);
    expect(s.ranks).toEqual([1]);
  });

  it("굳은 동료는 옆에서 4초 붙들면 풀리고, 잠깐 안전하다", () => {
    const rt = match(2);
    const s = rt.state;
    const a = ROW14(6);
    place(rt, 0, a.x, a.z);
    place(rt, 1, a.x + 1.2, a.z, Math.PI / 2);
    s.players[0].st = "down";
    s.players[0].downAt = s.t;
    run(rt, REVIVE_MS + 100, () => applyReport(rt, 1, rep(rt, 1, { use: "r0" })));
    expect(s.players[0].st).toBe("alive");
    expect(s.players[0].safeUntil).toBeGreaterThan(s.t);
    expect(s.players[1].stats.revives).toBe(1);
  });

  it(`${BLEED_MS / 1000}초 안에 못 풀어 주면 영영 마네킹, 모두 그렇게 되면 끝`, () => {
    const rt = match();
    const s = rt.state;
    s.players[0].st = "down";
    s.players[0].downAt = s.t;
    run(rt, BLEED_MS + 200);
    expect(s.players[0].st).toBe("dead");
    expect(s.phase).toBe("gameOver");
    expect(s.outcome?.why).toBe("allDown");
    expect(s.outcome?.grade).toBe("F");
  });

  it("자정이 되면 끝", () => {
    const rt = match();
    const s = rt.state;
    s.t = TIME_LIMIT_MS - 100;
    run(rt, 200);
    expect(s.phase).toBe("gameOver");
    expect(s.outcome?.why).toBe("time");
  });
});

describe("정전", () => {
  it("경고 → 어둠 → 다시 켜짐 순서", () => {
    const rt = match();
    const s = rt.state;
    s.flicker.at = s.t + 100;
    run(rt, 150);
    expect(s.flicker.st).toBe("warn");
    run(rt, FLICKER_WARN_MS);
    expect(s.flicker.st).toBe("dark");
    run(rt, FLICKER_MS + 100);
    expect(s.flicker.st).toBe("idle");
    expect(s.flicker.count).toBe(1);
    expect(s.flicker.at).toBeGreaterThan(s.t + 20_000);
  });
});

describe("네트워크 · 방장 승계", () => {
  it("스냅샷은 JSON으로 왕복하고, 이어받은 판이 계속 돈다", () => {
    const s = createMatch(3, [{ bot: true, level: 6 }, { bot: true, level: 6 }]);
    const rt = createHost(s, botThink);
    run(rt, 20_000);
    const snap = makeSnap(rt.state, 12);
    const wire = JSON.parse(JSON.stringify(snap));
    expect(isSnap(wire)).toBe(true);
    expect(isSnap({ v: 1, players: [] })).toBe(false);
    const heir = createHost(stateFromSnap(wire), botThink);
    run(heir, 5000);
    expect(heir.state.t).toBeGreaterThan(snap.t);
  });

  it("버퍼는 처음 보는 이벤트만 넘기고, 같은 시각 스냅샷은 무시", () => {
    const rt = match();
    const buf = new SnapBuffer();
    rt.state.events.push({ id: 900, at: rt.state.t, k: "wake" });
    expect(buf.push(makeSnap(rt.state, 1), 0).length).toBe(1);
    expect(buf.push(makeSnap(rt.state, 2), 10).length).toBe(0);
    run(rt, 100);
    expect(buf.push(makeSnap(rt.state, 3), 100).length).toBe(0);
    expect(buf.mannequin(0, 200)).not.toBeNull();
  });
});

describe("내 몸 (이 기기)", () => {
  it("보고한 자리가 방장 판정에 그대로 들어가고, 마주 본 상자가 대상이 된다", () => {
    const rt = match();
    const s = rt.state;
    const snap = makeSnap(s, 1);
    const b = createLocal();
    syncLocal(b, snap, 0);
    expect(b.x).toBeCloseTo(s.players[0].x);
    const c = CONTAINERS[0];
    const spot = centerOf(idx(2, 1));
    b.x = spot.x;
    b.z = spot.z;
    b.yaw = yawTo(spot.x, spot.z, c.x, c.z);
    const t = findTarget(b, snap, 0);
    expect(t?.id).toBe("c0");
    b.mz = 1;
    stepLocal(b, snap, 0, 0.1, 1000);
    applyReport(rt, 0, reportOf(b));
    expect(s.players[0].x).toBeCloseTo(b.x, 1);
  });

  it("이 기기 시선 판정(iSee)은 방장 판정과 같다", () => {
    const rt = match();
    const s = rt.state;
    const a = ROW14(4);
    const m = ROW14(9);
    place(rt, 0, a.x, a.z, yawTo(a.x, a.z, m.x, m.z));
    const snap = makeSnap(s, 1);
    const b = createLocal();
    syncLocal(b, snap, 0);
    b.x = a.x;
    b.z = a.z;
    b.yaw = s.players[0].yaw;
    expect(iSee(b, snap, 0, m.x, m.z)).toBe(sees(s, s.players[0], m.x, m.z));
    b.yaw += Math.PI;
    expect(iSee(b, snap, 0, m.x, m.z)).toBe(false);
  });
});

describe("봇", () => {
  it("의심 가는 마네킹이 다가오면 멈춰 서서 노려본다", () => {
    const s = createMatch(4, [{ bot: true, level: 8 }]);
    const rt = createHost(s, botThink);
    s.t = GRACE_MS + 100;
    s.awakeWant = 0;
    s.flicker.at = s.t + 600_000;
    const a = ROW14(4);
    place(rt, 0, a.x, a.z, 0);
    const m = wakeAt(rt, 0, ROW14(9).x, ROW14(9).z);
    run(rt, 6000);
    expect(s.players[0].st).toBe("alive");
    expect(s.players[0].stats.stareSec).toBeGreaterThan(0.5);
    expect(m.topples + (m.downUntil > 0 ? 1 : 0)).toBeGreaterThan(0);
  });
});

describe("기록 · 표시", () => {
  it("등급과 시계", () => {
    expect(gradeOf(0, 2, 0)).toBe("F");
    expect(gradeOf(2, 2, 0)).toBe("S");
    expect(gradeOf(2, 2, 1)).toBe("A");
    expect(gradeOf(1, 2, 0)).toBe("B");
    expect(gradeOf(1, 4, 0)).toBe("C");
    expect(clockText(0)).toBe("22:00");
    expect(clockText(TIME_LIMIT_MS)).toBe("0:00");
  });

  it("상세 기록은 숫자만", () => {
    const s = createMatch(8, [{ bot: false, level: 5 }]);
    s.players[0].st = "escaped";
    s.outcome = { win: true, escaped: 1, grade: "S", tMs: 300_000, why: "escaped" };
    s.t = 300_000;
    const d = mannequinMallStatDetails(s, 0);
    expect(d.escapes).toBe(1);
    expect(d.soloEscapes).toBe(1);
    expect(d.minEscapeSec).toBe(300);
    for (const v of Object.values(d)) expect(Number.isFinite(v)).toBe(true);
    expect(mannequinMallStatDetails(s, 3)).toEqual({});
  });
});
