import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import {
  BASE_R,
  BODY_R,
  BOUNCE_V,
  CAUGHT_DEPTH,
  COLLAPSE_DELAY_MS,
  COYOTE_MS,
  CRUMBLE_MS,
  FINAL_CALL_MUL,
  ICE_MS,
  JUMP_V,
  PILLAR_R,
  RESPAWN_MS,
  ROCK_WARN_MS,
  SAB_GAP,
  SHAKE_MS,
  SHOVE_CD_MS,
  STEP_MS,
  TOWER_H,
  WIND_WARN_MS,
  finishPoints,
  sanitizeOptions,
} from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import {
  applyInput,
  cardEligible,
  collapseSpeed,
  computeRanks,
  createHost,
  createMatch,
  leaderOf,
  playCard,
  setAway,
  spawnPoints,
  step,
  towerOf,
  type HostRuntime,
  type MatchState,
  type PlayerState,
} from "./sim";
import { crumbleClimbStatDetails } from "./stats";
import { buildTower, gapBetween, onPlatform, platPos, reachable, type Platform } from "./tower";
import { screenToWorld } from "./view";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function host(n = 2, opts: Parameters<typeof createMatch>[2] = { items: false, sabotage: false }, seed = 7): HostRuntime {
  return createHost(createMatch(seed, humans(n), opts));
}

/** 카운트다운을 건너뛰고 오르기 시작 (붕괴·아이템은 멈춰 둔다) */
function toClimb(rt: HostRuntime, { collapse = false } = {}) {
  const s = rt.state;
  while (s.phase !== "climb") step(rt);
  if (!collapse) s.collapseY = -1e9;
  s.nextItemAt = Infinity;
}

function run(rt: HostRuntime, ms: number, freezeCollapse = true) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) {
    step(rt);
    if (freezeCollapse) rt.state.collapseY = -1e9;
  }
}

/** 발판 위 한가운데 세우기 */
function standOn(s: MatchState, seat: number, pl: Platform) {
  const c = pl.kind === "base" ? { x: 4, z: 0 } : platPos(pl, s.t);
  Object.assign(s.players[seat], { x: c.x, z: c.z, y: pl.y, vx: 0, vy: 0, vz: 0, on: pl.i, airTop: pl.y });
}

function park(s: MatchState, seat: number) {
  // 방해 안 되게 바닥 반대편 구석에
  const p = s.players[seat];
  Object.assign(p, { x: -BASE_R + 1, z: 0, y: 0, vx: 0, vy: 0, vz: 0, on: 0 });
}

const press = (rt: HostRuntime, seat: number, what: "jump" | "shove", extra: Partial<{ mx: number; mz: number }> = {}) => {
  const cur = rt.inputs[seat];
  applyInput(rt, seat, { ...cur, ...extra, [what]: (cur[what] ?? 0) + 1 });
};

describe("옵션·점수표", () => {
  it("기본값과 이상한 값 정리", () => {
    expect(sanitizeOptions(undefined)).toEqual({ rounds: 3, items: true, sabotage: true });
    expect(sanitizeOptions({ rounds: 7 as never, items: false, sabotage: false })).toEqual({ rounds: 3, items: false, sabotage: false });
    expect(sanitizeOptions({ rounds: 5 })).toMatchObject({ rounds: 5 });
  });

  it("등정 순서 점수 6·4·3·2·1·1, 못 오르면 0", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 0].map(finishPoints)).toEqual([6, 4, 3, 2, 1, 1, 0, 0]);
  });
});

describe("탑 만들기", () => {
  const seeds = [1, 2, 3, 99, 12345, 777777];

  it("같은 씨앗이면 같은 탑", () => {
    const a = buildTower(424242);
    const b = JSON.parse(JSON.stringify(buildTower(424242)));
    expect(JSON.parse(JSON.stringify(a))).toEqual(b);
  });

  it.each(seeds)("씨앗 %i: 본길 이웃은 늘 점프 한 번에 닿고, 바닥에서 왕관까지 길이 있다", (seed) => {
    const t = buildTower(seed);
    for (let k = 0; k + 1 < t.mainPath.length; k++) {
      const a = t.platforms[t.mainPath[k]];
      const b = t.platforms[t.mainPath[k + 1]];
      expect(reachable(a, b)).toBe(true);
      expect(b.y - a.y).toBeLessThanOrEqual(1.0);
      if (a.kind !== "base") expect(gapBetween(a, b)).toBeLessThan(2.0);
    }
    expect(t.hops[0]).toBeLessThan(999);
    expect(t.top).toBeGreaterThan(TOWER_H - 1.5);
    expect(t.top).toBeLessThan(TOWER_H + 1.5);
    expect(t.platforms[t.crown].kind).toBe("crown");
    // 기둥을 파고드는 발판 없음
    for (const p of t.platforms) if (p.kind !== "base") expect(p.rad - p.r).toBeGreaterThan(PILLAR_R);
    // 샛길도 꽤 있다
    expect(t.platforms.filter((p) => !p.main).length).toBeGreaterThanOrEqual(5);
  });

  it("출발 자리는 모두 첫 발판 중심에서 같은 거리, 바닥 울타리 안", () => {
    for (const seed of seeds) {
      const t = buildTower(seed);
      const c = platPos(t.platforms[t.mainPath[1]], 0);
      const pts = spawnPoints(t, 6);
      const ds = pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z));
      for (const d of ds) expect(d).toBeCloseTo(ds[0], 5);
      for (const p of pts) {
        const r = Math.hypot(p.x, p.z);
        expect(r).toBeGreaterThan(PILLAR_R + 0.4);
        expect(r).toBeLessThan(BASE_R - BODY_R);
      }
      // 서로 겹치지 않음
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(BODY_R * 2);
    }
  });
});

describe("몸 · 점프 · 착지", () => {
  it("땅에서 점프하면 약 1.68m까지 올랐다가 다시 선다", () => {
    const rt = host();
    toClimb(rt);
    const p = rt.state.players[0];
    standOn(rt.state, 0, towerOf(rt.state).platforms[0]);
    press(rt, 0, "jump");
    let top = 0;
    for (let i = 0; i < 90; i++) {
      step(rt);
      rt.state.collapseY = -1e9;
      top = Math.max(top, p.y);
    }
    expect(top).toBeGreaterThan(1.55);
    expect(top).toBeLessThan(1.8);
    expect(p.on).toBe(0);
    expect(p.stats.jumps).toBe(1);
  });

  it("발판 끝에서 걸어 떨어진 직후(코요테 타임)에도 점프된다, 늦으면 안 된다", () => {
    for (const [delay, ok] of [
      [COYOTE_MS - 40, true],
      [COYOTE_MS + 60, false],
    ] as const) {
      const rt = host();
      toClimb(rt);
      const s = rt.state;
      const t = towerOf(s);
      const pl = t.platforms[t.mainPath[3]];
      standOn(s, 0, pl);
      park(s, 1);
      // 바깥쪽으로 달려 떨어지기
      const c = platPos(pl, s.t);
      const ux = c.x / pl.rad;
      const uz = c.z / pl.rad;
      applyInput(rt, 0, { mx: ux, mz: uz });
      let guard = 0;
      while (s.players[0].on >= 0 && guard++ < 200) run(rt, STEP_MS);
      run(rt, delay);
      press(rt, 0, "jump");
      run(rt, STEP_MS * 2);
      expect(s.players[0].vy > 5).toBe(ok);
    }
  });

  it("발판은 아래에서 뚫고 올라가고, 위에서 내려오면 선다", () => {
    const rt = host();
    toClimb(rt);
    const s = rt.state;
    const t = towerOf(s);
    const pl = t.platforms[t.mainPath[5]];
    const c = platPos(pl, s.t);
    park(s, 1);
    Object.assign(s.players[0], { x: c.x, z: c.z, y: pl.y - 0.6, vx: 0, vz: 0, vy: 7, on: -1 });
    run(rt, 200);
    expect(s.players[0].y).toBeGreaterThan(pl.y);
    run(rt, 1500);
    expect(s.players[0].on).toBe(pl.i);
    expect(s.players[0].y).toBeCloseTo(pl.y, 5);
  });

  it("기둥은 못 뚫는다", () => {
    const rt = host();
    toClimb(rt);
    const s = rt.state;
    Object.assign(s.players[0], { x: 3, z: 0, y: 0, on: 0 });
    park(s, 1);
    applyInput(rt, 0, { mx: -1, mz: 0 });
    run(rt, 1500);
    expect(Math.hypot(s.players[0].x, s.players[0].z)).toBeGreaterThanOrEqual(PILLAR_R + BODY_R - 1e-6);
  });

  it("바닥 원판 울타리: 바닥이 있는 동안은 밖으로 안 떨어진다", () => {
    const rt = host();
    toClimb(rt);
    const s = rt.state;
    Object.assign(s.players[0], { x: 5, z: 0, y: 0, on: 0 });
    park(s, 1);
    applyInput(rt, 0, { mx: 1, mz: 0 });
    run(rt, 2000);
    expect(s.players[0].on).toBe(0);
    expect(Math.hypot(s.players[0].x, s.players[0].z)).toBeLessThanOrEqual(BASE_R - BODY_R + 1e-6);
  });

  it("움직이는 발판은 위에 선 사람을 실어 나른다", () => {
    let found = false;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const rt = host(2, { items: false, sabotage: false }, seed);
      toClimb(rt);
      const s = rt.state;
      const pl = towerOf(s).platforms.find((p) => p.kind === "moving");
      if (!pl) continue;
      found = true;
      standOn(s, 0, pl);
      park(s, 1);
      for (let k = 0; k < 120; k++) {
        run(rt, STEP_MS);
        expect(s.players[0].on).toBe(pl.i);
      }
      const c = platPos(pl, s.t);
      expect(Math.hypot(s.players[0].x - c.x, s.players[0].z - c.z)).toBeLessThan(0.05);
    }
    expect(found).toBe(true);
  });
});

describe("발판 종류", () => {
  function find(kind: Platform["kind"]): { rt: HostRuntime; pl: Platform } {
    for (let seed = 1; seed < 80; seed++) {
      const rt = host(2, { items: false, sabotage: false }, seed);
      const pl = towerOf(rt.state).platforms.find((p) => p.kind === kind);
      if (pl) return { rt, pl };
    }
    throw new Error(`no ${kind}`);
  }

  it("금 간 발판: 밟고 0.9초 뒤 무너지고 3초 뒤 다시 생긴다", () => {
    const { rt, pl } = find("crumbly");
    toClimb(rt);
    const s = rt.state;
    const c = platPos(pl, s.t);
    park(s, 1);
    Object.assign(s.players[0], { x: c.x, z: c.z, y: pl.y + 0.3, vy: 0, on: -1 });
    run(rt, 200);
    expect(s.crumbleAt[pl.i]).toBeGreaterThan(0);
    run(rt, CRUMBLE_MS);
    expect(s.broke[pl.i]).toBeGreaterThan(0);
    expect(s.players[0].on).not.toBe(pl.i);
    run(rt, RESPAWN_MS + 50);
    expect(s.broke[pl.i]).toBe(0);
  });

  it("트램펄린: 밟으면 크게 튕겨 오른다", () => {
    const { rt, pl } = find("bouncy");
    toClimb(rt);
    const s = rt.state;
    const c = platPos(pl, s.t);
    park(s, 1);
    Object.assign(s.players[0], { x: c.x, z: c.z, y: pl.y + 0.2, vy: -1, on: -1 });
    let maxVy = 0;
    for (let i = 0; i < 30; i++) {
      run(rt, STEP_MS);
      maxVy = Math.max(maxVy, s.players[0].vy);
    }
    expect(maxVy).toBeGreaterThan(BOUNCE_V - 1);
    expect(s.players[0].stats.bounces).toBe(1);
  });

  it("왕관 발판에 닿으면 등정 — 순서대로 점수, 첫 등정 때 붕괴가 빨라진다", () => {
    const rt = host(3);
    toClimb(rt);
    const s = rt.state;
    const t = towerOf(s);
    const crown = t.platforms[t.crown];
    const c = platPos(crown, s.t);
    const before = collapseSpeed({ ...s, t: s.climbStart + COLLAPSE_DELAY_MS + 10_000, finalCall: false });
    for (const seat of [1, 0]) {
      Object.assign(s.players[seat], { x: c.x, z: c.z, y: crown.y + 0.2, vy: -1, on: -1 });
      run(rt, 100);
    }
    expect(s.players[1]).toMatchObject({ status: "done", place: 1, score: 6 });
    expect(s.players[0]).toMatchObject({ status: "done", place: 2, score: 4 });
    expect(s.finalCall).toBe(true);
    const after = collapseSpeed({ ...s, t: s.climbStart + COLLAPSE_DELAY_MS + 10_000 });
    expect(after / before).toBeCloseTo(FINAL_CALL_MUL, 5);
    expect(s.players[1].stats.roundWins).toBe(1);
  });
});

describe("붕괴", () => {
  it("출발 7초 동안은 안 오르고, 그 뒤 점점 빨라진다", () => {
    const rt = host();
    toClimb(rt, { collapse: true });
    const s = rt.state;
    const y0 = s.collapseY;
    run(rt, COLLAPSE_DELAY_MS - 100, false);
    expect(s.collapseY).toBe(y0);
    run(rt, 1000, false);
    expect(s.collapseY).toBeGreaterThan(y0);
    const at = (ms: number) => collapseSpeed({ ...s, t: s.climbStart + ms });
    expect(at(COLLAPSE_DELAY_MS - 1)).toBe(0);
    expect(at(COLLAPSE_DELAY_MS + 20_000)).toBeGreaterThan(at(COLLAPSE_DELAY_MS + 3000));
  });

  it("붕괴선 아래 발판은 영영 사라지고, 그 아래로 떨어진 사람은 휩쓸린다 (왕관은 안 사라짐)", () => {
    const rt = host(2);
    toClimb(rt, { collapse: true });
    const s = rt.state;
    const t = towerOf(s);
    s.collapseY = 5;
    standOn(s, 0, t.platforms[0]);
    standOn(s, 1, t.platforms[t.mainPath[t.mainPath.length - 2]]);
    step(rt);
    expect(s.gone[0]).toBe(1);
    for (const p of t.platforms) if (p.y < 5 && p.kind !== "crown") expect(s.gone[p.i]).toBe(1);
    let guard = 0;
    while (s.players[0].status === "climb" && guard++ < 200) step(rt);
    expect(s.players[0].status).toBe("out");
    expect(s.players[0].y).toBeLessThan(5 - CAUGHT_DEPTH + 0.5);
    s.collapseY = 999;
    step(rt);
    expect(s.gone[t.crown]).toBe(0);
    expect(s.collapseY).toBeLessThan(t.top);
  });

  it("모두 오르거나 휩쓸리면 라운드가 끝나고, 마지막 라운드 뒤 순위가 나온다", () => {
    const rt = host(2, { rounds: 1, items: false, sabotage: false });
    toClimb(rt);
    const s = rt.state;
    const t = towerOf(s);
    const crown = t.platforms[t.crown];
    const c = platPos(crown, s.t);
    Object.assign(s.players[1], { x: c.x, z: c.z, y: crown.y + 0.2, vy: -1, on: -1 });
    run(rt, 100);
    s.players[0].best = 12;
    s.collapseY = 40;
    let guard = 0;
    while (s.phase !== "gameOver" && guard++ < 60 * 30) step(rt);
    expect(s.phase).toBe("gameOver");
    expect(s.history[0].order).toEqual([1]);
    expect(s.history[0].outs).toEqual([0]);
    expect(s.ranks).toEqual([2, 1]);
  });

  it("최종 순위 동점: 점수 → 라운드 1등 → 높이 합", () => {
    const rt = host(3);
    const s = rt.state;
    const set = (p: PlayerState, score: number, wins: number, h: number) => {
      p.score = score;
      p.stats.roundWins = wins;
      p.stats.heightSum = h;
    };
    set(s.players[0], 10, 1, 50);
    set(s.players[1], 10, 1, 60);
    set(s.players[2], 10, 2, 10);
    expect(computeRanks(s)).toEqual([3, 2, 1]);
    set(s.players[0], 10, 2, 10);
    expect(computeRanks(s)).toEqual([1, 3, 1]);
  });
});

describe("밀치기", () => {
  function pair() {
    const rt = host(2);
    toClimb(rt);
    const s = rt.state;
    Object.assign(s.players[0], { x: 4, z: 0, y: 0, on: 0, face: Math.PI / 2 });
    Object.assign(s.players[1], { x: 4, z: 1, y: 0, on: 0 });
    return { rt, s };
  }

  it("바라보는 쪽 상대를 밀어 띄우고, 재사용 대기가 있다", () => {
    const { rt, s } = pair();
    press(rt, 0, "shove");
    step(rt);
    const o = s.players[1];
    expect(o.on).toBe(-1);
    expect(o.vz).toBeGreaterThan(4);
    expect(o.vy).toBeGreaterThan(2);
    expect(s.players[0].stats.shoveHits).toBe(1);
    expect(s.players[0].shoveCdAt - s.t).toBeGreaterThan(SHOVE_CD_MS - 50);
    // 대기 중엔 안 나감
    run(rt, 500);
    Object.assign(o, { x: 4, z: 1, y: 0, vx: 0, vz: 0, vy: 0, on: 0 });
    press(rt, 0, "shove");
    step(rt);
    expect(o.on).toBe(0);
  });

  it("등 뒤 사람은 안 밀린다 · 🛡 방패는 한 번 막는다", () => {
    const { rt, s } = pair();
    s.players[0].face = -Math.PI / 2;
    press(rt, 0, "shove");
    step(rt);
    expect(s.players[1].on).toBe(0);
    const b = pair();
    b.s.players[1].shieldUntil = b.s.t + 5000;
    press(b.rt, 0, "shove");
    step(b.rt);
    expect(b.s.players[1].on).toBe(0);
    expect(b.s.players[1].shieldUntil).toBe(0);
    expect(b.s.players[1].stats.blocks).toBe(1);
  });
});

describe("방해 카드", () => {
  function setup() {
    const rt = host(3, { items: false, sabotage: true });
    toClimb(rt);
    const s = rt.state;
    const t = towerOf(s);
    const hi = t.platforms[t.mainPath[14]];
    standOn(s, 0, hi);
    standOn(s, 1, t.platforms[t.mainPath[2]]);
    s.players[2].status = "out";
    s.t = s.climbStart + 20_000;
    return { rt, s, t, hi };
  }

  it("탈락자는 카드를 받고, 꼴찌는 선두보다 6m 이상 낮을 때만", () => {
    const { rt, s, t } = setup();
    expect(cardEligible(s, s.players[2])).toBe(true);
    expect(cardEligible(s, s.players[1])).toBe(s.players[0].y - s.players[1].y >= SAB_GAP);
    expect(cardEligible(s, s.players[0])).toBe(false);
    standOn(s, 1, t.platforms[t.mainPath[12]]);
    expect(cardEligible(s, s.players[1])).toBe(false);
    s.players[2].cardAt = 0;
    run(rt, 100);
    expect(s.players[2].card?.kinds.length).toBe(3);
    expect(new Set(s.players[2].card!.kinds).size).toBe(3);
  });

  it("🪨 낙석은 선두 머리 위에 떨어져 휘청이게 한다", () => {
    const { rt, s } = setup();
    s.players[2].card = { kinds: ["rocks", "ice", "wind"], until: s.t + 5000 };
    applyInput(rt, 2, { pick: 1, card: 0 });
    expect(s.rocks.length).toBe(3);
    expect(leaderOf(s, 2)).toBe(0);
    run(rt, ROCK_WARN_MS + 50);
    expect(s.players[0].on).toBe(-1);
    expect(s.players[0].lastHitBy).toBe(2);
    expect(s.players[2].stats.sabHits).toBe(1);
  });

  it("🧊 얼음판 · 🧱 흔들기 · 💨 돌풍", () => {
    {
      const { s, hi } = setup();
      s.players[2].card = { kinds: ["ice", "shake", "wind"], until: s.t + 5000 };
      playCard(s, 2, 0);
      expect(s.icyUntil[hi.i] - s.t).toBe(ICE_MS);
    }
    {
      const { rt, s, hi } = setup();
      s.players[2].card = { kinds: ["ice", "shake", "wind"], until: s.t + 5000 };
      playCard(s, 2, 1);
      expect(s.crumbleAt[hi.i] - s.t).toBe(SHAKE_MS);
      run(rt, SHAKE_MS + 50);
      expect(s.broke[hi.i]).toBeGreaterThan(0);
    }
    {
      const { rt, s } = setup();
      s.players[2].card = { kinds: ["ice", "shake", "wind"], until: s.t + 5000 };
      const p = s.players[0];
      const r0 = Math.hypot(p.x, p.z);
      playCard(s, 2, 2);
      run(rt, WIND_WARN_MS + 1500);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(r0 + 0.5);
    }
  });

  it("안 고르면 시간이 지나 무작위로 쓴다", () => {
    const { rt, s } = setup();
    s.players[2].card = { kinds: ["ice", "shake", "wind"], until: s.t + 200 };
    run(rt, 300);
    expect(s.players[2].card).toBeNull();
    expect(s.players[2].stats.cards).toBe(1);
  });
});

describe("아이템", () => {
  it("🪶 깃털: 공중에서 한 번 더 뛴다 (한 번만)", () => {
    const rt = host();
    toClimb(rt);
    const s = rt.state;
    const p = s.players[0];
    p.feather = true;
    Object.assign(p, { x: 4, z: 0, y: 5, vy: -2, on: -1 });
    press(rt, 0, "jump");
    step(rt);
    expect(p.vy).toBeGreaterThan(6);
    expect(p.feather).toBe(false);
    run(rt, 200);
    press(rt, 0, "jump");
    step(rt);
    expect(p.vy).toBeLessThan(6);
  });
});

describe("네트워크·기타", () => {
  it("스냅샷 왕복 · 모양 검사 · 이벤트 한 번만", () => {
    const rt = createHost(createMatch(5, [{ bot: false, level: 5 }, { bot: true, level: 5 }, { bot: true, level: 9 }], { rounds: 1 }), botThink);
    run(rt, 8000, false);
    const snap = makeSnap(rt.state, 3);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const back = stateFromSnap(snap);
    expect(back.towerSeed).toBe(rt.state.towerSeed);
    expect(back.idSeq).toBe(rt.state.idSeq);
    expect((back as unknown as { seq?: number }).seq).toBeUndefined();
    const b = new SnapBuffer();
    const e1 = b.push(snap, 0);
    expect(e1.length).toBe(snap.events.length);
    expect(b.push(makeSnap(rt.state, 4), 100).length).toBe(0);
    // 이어받은 상태로 계속 돌아간다
    const rt2 = createHost(back, botThink);
    run(rt2, 2000, false);
    expect(rt2.state.t).toBeGreaterThan(back.t - 1);
  });

  it("나가면 AI가 대신, 돌아오면 돌려준다", () => {
    const rt = host(2);
    setAway(rt, 1, true);
    expect(rt.state.players[1]).toMatchObject({ bot: true, away: true });
    setAway(rt, 1, false);
    expect(rt.state.players[1]).toMatchObject({ bot: false, away: false });
  });

  it("같은 씨앗·같은 봇이면 같은 결과 (재현)", () => {
    const go = () => {
      const s = createMatch(31, [3, 6, 9].map((level) => ({ bot: true, level })), { rounds: 1 });
      const rt = createHost(s, botThink);
      let guard = 0;
      while (s.phase !== "gameOver" && guard++ < 60 * 200) step(rt);
      return JSON.stringify({ h: s.history, r: s.ranks, y: s.players.map((p) => p.best) });
    };
    expect(go()).toEqual(go());
  });

  it("화면 방향 → 월드 방향: 카메라가 +x에 있으면 오른쪽 = −z, 위 = 기둥 쪽(−x)", () => {
    const r = screenToWorld(1, 0, 0);
    expect(r.mx).toBeCloseTo(0);
    expect(r.mz).toBeCloseTo(-1);
    const u = screenToWorld(0, -1, 0);
    expect(u.mx).toBeCloseTo(-1);
    expect(u.mz).toBeCloseTo(0);
  });

  it("기록 상세", () => {
    const rt = host(2, { rounds: 1, items: false, sabotage: false });
    const s = rt.state;
    s.players[0].stats.finishes = 1;
    s.players[0].stats.fastestMs = 33_400;
    s.players[0].stats.bestHeight = 29.7;
    const d = crumbleClimbStatDetails(s, 0);
    expect(d).toMatchObject({ finishes: 1, minClimbSec: 33, maxHeight: 30 });
    expect(crumbleClimbStatDetails(s, 1).minClimbSec).toBeUndefined();
  });

  it("발판 위 판정: 원판 반지름 + 여유", () => {
    const t = buildTower(9);
    const p = t.platforms[t.mainPath[4]];
    const c = platPos(p, 0);
    expect(onPlatform(p, c.x + p.r + 0.1, c.z, 0, 0.2)).toBe(true);
    expect(onPlatform(p, c.x + p.r + 0.3, c.z, 0, 0.2)).toBe(false);
    void JUMP_V;
  });
});
