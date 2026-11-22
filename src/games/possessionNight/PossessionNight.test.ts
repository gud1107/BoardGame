import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { GRACE_MS, MAX_PLAYERS, MIN_PLAYERS, POSSESS_FEAR, TICK_MS, TIME_LIMIT_MS, WARD_R, cursesFor, sanitizeOptions, selfWakeMs, soulsFor } from "./data";
import { BLOCKED, BRAZIER, CONTAINERS, COLS, MAP_ROWS, ROWS, START_CELLS, WALKABLE, centerOf, clampGhost, walkField } from "./map";
import { HIDDEN, makeSnap, stateFromSnap } from "./net";
import { CURSE_BASE, applyAct, applyReport, canBePossessed, castPower, createHost, createMatch, hostStep, isCurse, possessTarget, powerCheck, rebuildSecrets, type MatchState } from "./sim";
import { possessionNightStatDetails } from "./stats";

const seats = (n: number, bot = false) => Array.from({ length: n }, () => ({ bot, level: 5 }));

function at(s: MatchState, seat: number, x: number, z: number) {
  const p = s.players[seat];
  p.x = x;
  p.z = z;
}

function step(rt: ReturnType<typeof createHost>, ms: number) {
  for (let t = 0; t < ms; t += TICK_MS) hostStep(rt, TICK_MS);
}

/** JSON 안의 모든 숫자 */
function numbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numbers(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbers(x, out));
  return out;
}

describe("map", () => {
  it("is a closed rectangle with the brazier in the courtyard", () => {
    expect(MAP_ROWS.every((r) => r.length === COLS)).toBe(true);
    expect(MAP_ROWS.length).toBe(ROWS);
    expect(MAP_ROWS[0]).toMatch(/^#+$/);
    expect(MAP_ROWS[ROWS - 1]).toMatch(/^#+$/);
    expect(MAP_ROWS[11][13]).toBe("F");
  });

  it("every container and start cell is reachable from the courtyard", () => {
    const f = walkField(START_CELLS[0]);
    for (const c of START_CELLS) expect(Number.isFinite(f[c])).toBe(true);
    for (const c of CONTAINERS) {
      const col = c.cell % COLS;
      const row = Math.floor(c.cell / COLS);
      const near = [c.cell - 1, c.cell + 1, c.cell - COLS, c.cell + COLS].filter((n) => !BLOCKED[n] && Math.abs((n % COLS) - col) + Math.abs(Math.floor(n / COLS) - row) === 1);
      expect(near.some((n) => Number.isFinite(f[n]))).toBe(true);
    }
    expect(WALKABLE.length).toBeGreaterThan(300);
  });

  it("keeps the ghost out of the brazier ward", () => {
    const p = { x: BRAZIER.x + 0.5, z: BRAZIER.z };
    clampGhost(p, WARD_R);
    expect(Math.hypot(p.x - BRAZIER.x, p.z - BRAZIER.z)).toBeCloseTo(WARD_R, 5);
  });
});

describe("setup", () => {
  it("sanitizes options and seat counts", () => {
    expect(sanitizeOptions({ difficulty: "hard", ghost: 2 })).toEqual({ difficulty: "hard", ghost: 2 });
    expect(sanitizeOptions({ difficulty: "x" as never, ghost: 99 })).toEqual({ difficulty: "normal", ghost: "random" });
    expect(MIN_PLAYERS).toBe(3);
    expect(MAX_PLAYERS).toBe(6);
  });

  it("deals exactly `need` cursed objects and one ghost", () => {
    for (let n = 3; n <= 6; n++) {
      const s = createMatch(42 + n, seats(n), n - 1);
      expect(s.need).toBe(cursesFor(n - 1));
      expect(s.soulsNeed).toBe(soulsFor(n - 1));
      expect(s.contents.filter(isCurse).length).toBe(s.need);
      expect(s.players.filter((p) => p.role === "ghost").map((p) => p.seat)).toEqual([n - 1]);
      // 물건은 서로 다른 방부터
      const rooms = new Set(CONTAINERS.filter((c) => isCurse(s.contents[c.i])).map((c) => c.room));
      expect(rooms.size).toBe(s.need);
    }
  });

  it("spawns the ghost far from the hunters", () => {
    const s = createMatch(7, seats(5), 0);
    for (const p of s.players) if (p.role === "hunter") expect(Math.hypot(p.x - s.ghost.x, p.z - s.ghost.z)).toBeGreaterThan(8);
  });
});

describe("hidden information", () => {
  it("snapshots for other devices carry no ghost position and no unsearched contents", () => {
    const s = createMatch(9, seats(4), 3);
    s.ghost.x = 33.37;
    s.ghost.z = 7.71;
    const snap = makeSnap(s, 1, false);
    expect(snap.ghost.x).toBe(HIDDEN);
    expect(snap.ghost.z).toBe(HIDDEN);
    expect(snap.rng).toBe(0);
    expect(snap.contents.every((v) => v === -1)).toBe(true);
    const nums = numbers(JSON.parse(JSON.stringify(snap)));
    expect(nums).not.toContain(33.37);
    expect(nums).not.toContain(7.71);
    // 원귀 자신(판정 기기) 화면용은 다 들어 있다
    const own = makeSnap(s, 1, true);
    expect(own.ghost.x).toBe(33.37);
    expect(own.contents.filter(isCurse).length).toBe(s.need);
  });

  it("reveals the ghost only while it is visible", () => {
    const s = createMatch(9, seats(4), 3);
    const rt = createHost(s, null);
    step(rt, GRACE_MS + 100);
    s.ghost.energy = 100;
    expect(castPower(s, "manifest")).toBe(true);
    step(rt, 100);
    expect(s.ghostVis).toBe(2);
    expect(makeSnap(s, 2, false).ghost.x).not.toBe(HIDDEN);
    step(rt, 3000);
    // 멀리 떨어져 있으면 다시 안 보인다
    expect(s.ghostVis).toBe(0);
    expect(makeSnap(s, 3, false).ghost.x).toBe(HIDDEN);
  });

  it("a takeover from a stripped snapshot re-deals the secrets consistently", () => {
    const s = createMatch(11, seats(5), 4);
    s.searched[0] = true;
    s.contents[0] = 0;
    s.burned = 1;
    s.players[0].carry = [3];
    const snap = makeSnap(s, 5, false);
    const st = stateFromSnap(snap);
    expect(st.secret).toBe(false);
    rebuildSecrets(st);
    expect(st.secret).toBe(true);
    expect(st.ghost.x).not.toBe(HIDDEN);
    const left = st.contents.filter(isCurse);
    expect(left.length).toBe(st.need - 1 - 1);
    // 들고 있는 물건과 같은 것이 다시 숨겨지지 않는다
    expect(left).not.toContain(CURSE_BASE + 3);
  });
});

describe("fear and possession", () => {
  function setup() {
    const s = createMatch(21, seats(4), 3);
    const rt = createHost(s, null);
    step(rt, GRACE_MS + 50);
    // 0번은 안방 한가운데, 1·2번은 멀리 마당
    at(s, 0, centerOf(3 * COLS + 9).x, centerOf(3 * COLS + 9).z);
    at(s, 1, BRAZIER.x, BRAZIER.z + 2.5);
    at(s, 2, BRAZIER.x + 2, BRAZIER.z + 2.5);
    s.ghost.x = s.players[0].x + 1.2;
    s.ghost.z = s.players[0].z;
    s.ghost.energy = 100;
    return { s, rt };
  }

  it("cannot possess a calm hunter", () => {
    const { s } = setup();
    s.players[0].fear = POSSESS_FEAR - 5;
    expect(possessTarget(s)).toBe(-1);
    expect(powerCheck(s, "possess").ok).toBe(false);
  });

  it("possesses a frightened lone hunter, counting a soul and dropping carried objects", () => {
    const { s } = setup();
    s.players[0].fear = POSSESS_FEAR + 5;
    s.players[0].carry = [2];
    expect(canBePossessed(s, s.players[0])).toBe(true);
    expect(castPower(s, "possess")).toBe(true);
    expect(s.players[0].st).toBe("possessed");
    expect(s.souls).toBe(1);
    expect(s.players[0].carry).toEqual([]);
    expect(s.ground.map((g) => g.curse)).toEqual([2]);
  });

  it("a buddy protects unless the hunter panics", () => {
    const { s } = setup();
    at(s, 1, s.players[0].x + 1, s.players[0].z + 0.5);
    s.players[0].fear = 90;
    expect(canBePossessed(s, s.players[0])).toBe(false);
    s.players[0].panic = true;
    expect(canBePossessed(s, s.players[0])).toBe(true);
  });

  it("possessed hunters are freed by a teammate or wake by themselves", () => {
    const { s, rt } = setup();
    s.players[0].fear = 90;
    castPower(s, "possess");
    s.ghost.x = 5;
    s.ghost.z = 5;
    // 동료가 와서 퇴마
    at(s, 1, s.players[0].x + 1, s.players[0].z);
    applyReport(rt, 1, { x: s.players[1].x, z: s.players[1].z, yaw: 0, pitch: 0, mv: 0, light: true, use: "r0" });
    step(rt, 4200);
    expect(s.players[0].st).toBe("alive");
    // 다시 씌고, 이번엔 아무도 안 온다
    s.players[0].safeUntil = 0;
    s.players[0].fear = 95;
    applyReport(rt, 1, { x: BRAZIER.x, z: BRAZIER.z + 2.5, yaw: 0, pitch: 0, mv: 0, light: true, use: null });
    s.ghost.x = s.players[0].x + 1;
    s.ghost.z = s.players[0].z;
    s.ghost.energy = 100;
    s.ghost.ready.possess = 0;
    expect(castPower(s, "possess")).toBe(true);
    s.ghost.x = 5;
    step(rt, selfWakeMs(3) + 200);
    expect(s.players[0].st).toBe("alive");
    expect(s.souls).toBe(2);
  });

  it("whispers frighten only the nearest hunter, more when alone", () => {
    const { s } = setup();
    const before = s.players[0].fear;
    expect(castPower(s, "whisper")).toBe(true);
    expect(s.players[0].fear - before).toBeGreaterThanOrEqual(24);
    expect(s.players[1].fear).toBe(0);
    const ev = s.events.find((e) => e.k === "whisper");
    expect(ev?.to).toBe(0);
  });
});

describe("holy water", () => {
  it("stuns and reveals the ghost when splashed in front", () => {
    const s = createMatch(31, seats(3), 2);
    const rt = createHost(s, null);
    step(rt, GRACE_MS + 50);
    const p = s.players[0];
    p.x = BRAZIER.x;
    p.z = BRAZIER.z + 6;
    s.ghost.x = p.x;
    s.ghost.z = p.z + 3; // 뒤쪽(+z)
    applyAct(rt, 0, { k: "water", yaw: Math.PI, pitch: 0 }); // yaw π = +z를 본다
    expect(s.ghost.stunUntil).toBeGreaterThan(s.t);
    expect(s.players[2].ghost.hits).toBe(1);
    expect(p.hunter.waterHits).toBe(1);
    // 맞은 동안엔 힘을 못 쓴다
    s.ghost.energy = 100;
    expect(powerCheck(s, "whisper").ok).toBe(false);
  });

  it("misses when aimed away", () => {
    const s = createMatch(31, seats(3), 2);
    const rt = createHost(s, null);
    step(rt, GRACE_MS + 50);
    const p = s.players[0];
    p.x = BRAZIER.x;
    p.z = BRAZIER.z + 6;
    s.ghost.x = p.x;
    s.ghost.z = p.z + 3;
    p.water = 1;
    applyAct(rt, 0, { k: "water", yaw: 0, pitch: 0 });
    expect(s.ghost.stunUntil).toBe(0);
    expect(p.water).toBe(0);
  });
});

describe("endings", () => {
  it("burning every object starts the ritual and finishing it wins for the hunters", () => {
    const s = createMatch(41, seats(3), 2);
    const rt = createHost(s, null);
    s.ghost.x = 4;
    s.ghost.z = 4;
    s.players[0].carry = Array.from({ length: s.need }, (_, i) => i);
    at(s, 0, BRAZIER.x, BRAZIER.z + 1.6);
    at(s, 1, BRAZIER.x + 1.6, BRAZIER.z);
    applyReport(rt, 0, { x: s.players[0].x, z: s.players[0].z, yaw: 0, pitch: 0, mv: 0, light: true, use: "b" });
    step(rt, 2300 * s.need + 200);
    expect(s.burned).toBe(s.need);
    expect(s.ritual).toBeGreaterThanOrEqual(0);
    step(rt, 30_000);
    expect(s.phase).toBe("gameOver");
    expect(s.outcome?.winner).toBe("hunter");
    expect(s.ranks).toEqual([1, 1, 2]);
    expect(possessionNightStatDetails(s, 0).hunterWins).toBe(1);
    expect(possessionNightStatDetails(s, 2).ghostGames).toBe(1);
  });

  it("collecting every soul wins for the ghost", () => {
    const s = createMatch(43, seats(3), 2);
    const rt = createHost(s, null);
    s.souls = s.soulsNeed;
    step(rt, 100);
    expect(s.outcome?.winner).toBe("ghost");
    expect(s.outcome?.why).toBe("souls");
  });

  it("dawn wins for the ghost", () => {
    const s = createMatch(45, seats(3), 2);
    const rt = createHost(s, null);
    s.ghost.x = 4;
    s.ghost.z = 4;
    s.t = TIME_LIMIT_MS - 100;
    step(rt, 300);
    expect(s.outcome?.why).toBe("dawn");
    expect(s.outcome?.winner).toBe("ghost");
  });
});

describe("bots", () => {
  it("bot matches finish and the ghost bot uses its powers", () => {
    const s = createMatch(77, seats(4, true), 1);
    const rt = createHost(s, botThink);
    for (let i = 0; i < TIME_LIMIT_MS / TICK_MS + 10 && s.phase === "play"; i++) hostStep(rt, TICK_MS);
    expect(s.phase).toBe("gameOver");
    const g = s.players[1].ghost;
    expect(g.whispers + g.slams + g.snuffs + g.manifests + g.possessions).toBeGreaterThan(0);
    expect(s.players.filter((p) => p.role === "hunter").reduce((n, p) => n + p.hunter.searches, 0)).toBeGreaterThan(5);
  });
});
