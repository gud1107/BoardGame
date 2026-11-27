import { describe, expect, it } from "vitest";
import { arenaGeo, postTiles, ringsFor, tileIndexAt } from "./arena";
import { botThink } from "./bot";
import {
  BIG_SCALE,
  COMEBACK_GAP,
  CREDIT_MS,
  CRUMBLE_START_MS,
  DASH_SPEED,
  FIGHT_MAX_MS,
  PTS_KO,
  PTS_RUNNER_UP,
  PTS_TIMEOUT,
  PTS_WIN,
  STEP_MS,
  WARN_MS,
  sanitizeOptions,
} from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import { applyInput, computeRanks, createHost, createMatch, radiusOf, setAway, setInput, solidAt, step, type HostRuntime, type MatchState } from "./sim";
import { bumperArenaStatDetails } from "./stats";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function host(n = 2, opts: Parameters<typeof createMatch>[2] = { items: false, ghosts: true }, seed = 7): HostRuntime {
  return createHost(createMatch(seed, humans(n), opts));
}

/** 카운트다운을 건너뛰고 싸움 시작 (무너짐·아이템은 멈춰 둔다) */
function toFight(rt: HostRuntime, crumble = false) {
  const s = rt.state;
  while (s.phase !== "fight") step(rt);
  if (!crumble) s.nextCrumbleAt = Infinity;
  s.nextItemAt = Infinity;
}

function place(s: MatchState, seat: number, x: number, z: number) {
  Object.assign(s.players[seat], { x, z, vx: 0, vz: 0 });
}

function run(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) step(rt);
}

describe("섬 (arena)", () => {
  it("인원별 링 수와 타일 수", () => {
    expect([2, 3, 4, 5, 6].map(ringsFor)).toEqual([3, 4, 4, 5, 5]);
    expect(arenaGeo(3).tiles.length).toBe(37);
    expect(arenaGeo(4).tiles.length).toBe(61);
    expect(arenaGeo(5).tiles.length).toBe(91);
  });

  it("타일 중심 → 같은 타일, 섬 밖 → -1", () => {
    for (const rings of [3, 4, 5]) {
      const geo = arenaGeo(rings);
      geo.tiles.forEach((t, i) => expect(tileIndexAt(geo, t.x, t.z)).toBe(i));
      expect(tileIndexAt(geo, geo.radius + 3, 0)).toBe(-1);
    }
  });

  it("범퍼 기둥: 3링 0개, 4링 2개, 5링 3개 (가운데 칸엔 없음)", () => {
    expect(postTiles(arenaGeo(3))).toHaveLength(0);
    expect(postTiles(arenaGeo(4))).toHaveLength(2);
    expect(postTiles(arenaGeo(5))).toHaveLength(3);
    for (const r of [4, 5]) for (const i of postTiles(arenaGeo(r))) expect(arenaGeo(r).tiles[i].ring).toBeGreaterThan(0);
  });
});

describe("시작", () => {
  it("모두 서로 떨어진 멀쩡한 칸에서 카운트다운으로 시작", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = createMatch(n * 11, humans(n));
      expect(s.phase).toBe("countdown");
      expect(s.round).toBe(1);
      for (const p of s.players) expect(solidAt(s, p.x, p.z)).toBe(true);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(s.players[i].x - s.players[j].x, s.players[i].z - s.players[j].z)).toBeGreaterThan(2);
    }
  });

  it("카운트다운 동안은 움직이지 않는다", () => {
    const rt = host();
    const p = rt.state.players[0];
    const x0 = p.x;
    setInput(rt, 0, { mx: 1, mz: 0, brace: false, dash: 1, jump: 0 });
    run(rt, 1000);
    expect(rt.state.phase).toBe("countdown");
    expect(p.x).toBe(x0);
  });

  it("옵션 정리: 이상한 값은 기본값", () => {
    expect(sanitizeOptions({ rounds: 4 as never })).toEqual({ rounds: 5, items: true, ghosts: true });
    expect(sanitizeOptions({ rounds: 7, items: false, ghosts: false })).toEqual({ rounds: 7, items: false, ghosts: false });
  });
});

describe("조작", () => {
  it("대시: 순간 속도 ≈ DASH_SPEED, 재사용 대기 중엔 안 나간다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 1, 0, 4);
    setInput(rt, 0, { mx: 1, mz: 0, brace: false, dash: 1, jump: 0 });
    step(rt);
    const p = s.players[0];
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(DASH_SPEED * 0.9);
    expect(s.events.some((e) => e.k === "dash" && e.s === 0)).toBe(true);
    run(rt, 400);
    const dashes = () => s.events.filter((e) => e.k === "dash" && e.s === 0).length;
    setInput(rt, 0, { mx: 1, mz: 0, brace: false, dash: 2, jump: 0 });
    step(rt);
    expect(dashes()).toBe(1);
  });

  it("점프하면 떠오르고, 0.65초 뒤 내려온다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    setInput(rt, 0, { mx: 0, mz: 0, brace: false, dash: 0, jump: 1 });
    run(rt, 300);
    expect(s.players[0].y).toBeGreaterThan(0.8);
    run(rt, 500);
    expect(s.players[0].y).toBe(0);
    expect(s.players[0].alive).toBe(true);
  });

  it("버티기는 힘을 쓰고, 다 쓰면 풀린다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    setInput(rt, 0, { mx: 0, mz: 0, brace: true, dash: 0, jump: 0 });
    step(rt);
    expect(s.players[0].bracing).toBe(true);
    run(rt, 2100);
    expect(s.players[0].bracing).toBe(false);
    // 계속 누르고 있으면 힘이 차도 다시 안 켜진다 — 한 번 떼야 함
    run(rt, 1500);
    expect(s.players[0].stamina).toBeGreaterThan(0.3);
    expect(s.players[0].bracing).toBe(false);
    setInput(rt, 0, { mx: 0, mz: 0, brace: false, dash: 0, jump: 0 });
    step(rt);
    setInput(rt, 0, { mx: 0, mz: 0, brace: true, dash: 0, jump: 0 });
    step(rt);
    expect(s.players[0].bracing).toBe(true);
  });

  it("손님 입력: 봇 자리·이상한 값은 무시", () => {
    const rt = createHost(createMatch(1, [{ bot: false, level: 5 }, { bot: true, level: 5 }]));
    applyInput(rt, 1, { mx: 1, mz: 0, brace: false, dash: 3, jump: 0 });
    expect(rt.inputs[1].mx).toBe(0);
    applyInput(rt, 9, { mx: 1 });
    applyInput(rt, 0, null);
    applyInput(rt, 0, { mx: 5, mz: 5 } as never);
    expect(Math.hypot(rt.inputs[0].mx, rt.inputs[0].mz)).toBeCloseTo(1, 5);
  });
});

/** 0번이 1번을 향해 대시로 박는 상황 */
function ram(heat1: number, brace1 = false) {
  const rt = host();
  toFight(rt);
  const s = rt.state;
  place(s, 0, -1.6, 0);
  place(s, 1, 0, 0);
  s.players[1].heat = heat1;
  setInput(rt, 1, { mx: 0, mz: 0, brace: brace1, dash: 0, jump: 0 });
  setInput(rt, 0, { mx: 1, mz: 0, brace: false, dash: 1, jump: 0 });
  let hitSpeed = 0;
  for (let i = 0; i < 30; i++) {
    step(rt);
    hitSpeed = Math.max(hitSpeed, s.players[1].vx);
  }
  return { rt, s, hitSpeed };
}

describe("부딪힘", () => {
  it("대시로 박으면 상대가 밀리고 열기가 오르고, 민 사람이 기록된다", () => {
    const { s, hitSpeed } = ram(0);
    expect(hitSpeed).toBeGreaterThan(4);
    expect(s.players[1].heat).toBeGreaterThan(5);
    expect(s.players[1].lastHitBy).toBe(0);
    expect(s.players[0].stats.dashHits).toBe(1);
    expect(s.events.some((e) => e.k === "hit" && e.a === 0 && e.b === 1)).toBe(true);
  });

  it("열기가 높을수록 멀리 날아간다 (100% ≈ 2배)", () => {
    const cold = ram(0).hitSpeed;
    const hot = ram(100).hitSpeed;
    expect(hot / cold).toBeGreaterThan(1.8);
    expect(hot / cold).toBeLessThan(2.2);
  });

  it("버티기는 넉백을 크게 줄인다", () => {
    const normal = ram(0).hitSpeed;
    const braced = ram(0, true).hitSpeed;
    expect(braced).toBeLessThan(normal * 0.5);
  });

  it("밀려서 떨어지면 민 사람이 KO +1, 혼자 떨어지면 아무도 점수 없음", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    const geo = arenaGeo(s.rings);
    const edge = geo.radius - 1.6;
    place(s, 1, edge, 0);
    place(s, 0, edge - 1.6, 0);
    place(s, 2, -edge + 2, 0);
    s.players[1].heat = 200;
    setInput(rt, 0, { mx: 1, mz: 0, brace: false, dash: 1, jump: 0 });
    run(rt, 250);
    // 민 쪽은 브레이크 (안 그러면 같이 떨어질 수 있다 — 대시의 위험)
    setInput(rt, 0, { mx: -1, mz: 0, brace: false, dash: 1, jump: 0 });
    run(rt, 1250);
    expect(s.players[0].alive).toBe(true);
    expect(s.players[1].alive).toBe(false);
    expect(s.players[0].score).toBe(PTS_KO);
    expect(s.players[0].stats.kos).toBe(1);
    expect(s.events.some((e) => e.k === "fall" && e.s === 1 && e.by === 0)).toBe(true);
    // 2번은 혼자 걸어 나감
    setInput(rt, 0, { mx: 0, mz: 0, brace: false, dash: 1, jump: 0 });
    setInput(rt, 2, { mx: -1, mz: 0, brace: false, dash: 0, jump: 0 });
    run(rt, 3000);
    expect(s.players[2].alive).toBe(false);
    expect(s.players[2].stats.selfFalls).toBe(1);
    expect(s.players[0].stats.kos).toBe(1);
  });

  it(`KO 인정은 마지막으로 민 뒤 ${CREDIT_MS / 1000}초까지`, () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    const p = s.players[1];
    p.lastHitBy = 0;
    p.lastHitAt = s.t - CREDIT_MS - 100;
    place(s, 1, arenaGeo(s.rings).radius + 2, 0);
    step(rt);
    expect(p.alive).toBe(false);
    expect(s.players[0].stats.kos).toBe(0);
  });
});

describe("라운드", () => {
  it(`마지막 생존 +${PTS_WIN}, 마지막에 떨어진 사람 +${PTS_RUNNER_UP}, 다음 라운드엔 열기 0`, () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    const far = arenaGeo(s.rings).radius + 2;
    s.players[0].heat = 80;
    place(s, 2, far, 0);
    run(rt, 50);
    place(s, 1, -far, 0);
    run(rt, 50);
    expect(s.phase).toBe("roundEnd");
    const h = s.history[0];
    expect(h.winner).toBe(0);
    expect(h.order).toEqual([2, 1]);
    expect(s.players[0].score).toBe(PTS_WIN);
    expect(s.players[1].score).toBe(PTS_RUNNER_UP);
    expect(s.players[2].score).toBe(0);
    while (s.phase === "roundEnd") step(rt);
    expect(s.round).toBe(2);
    expect(s.players.every((p) => p.alive && p.heat === 0)).toBe(true);
  });

  it(`${FIGHT_MAX_MS / 1000}초 동안 2명 이상 남으면 무승부 — 생존자 +${PTS_TIMEOUT}`, () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    run(rt, FIGHT_MAX_MS + 100);
    expect(s.phase).toBe("roundEnd");
    expect(s.history[0].draw).toBe(true);
    expect(s.players.map((p) => p.score)).toEqual([PTS_TIMEOUT, PTS_TIMEOUT]);
  });

  it("동시에 떨어지면 마지막 사람들끼리 +2씩", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    const far = arenaGeo(s.rings).radius + 2;
    place(s, 0, far, 0);
    place(s, 1, -far, 0);
    step(rt);
    expect(s.phase).toBe("roundEnd");
    expect(s.history[0].winner).toBe(-1);
    expect(s.players.map((p) => p.score)).toEqual([2, 2]);
  });

  it(`꼴찌 보호막: 1등보다 ${COMEBACK_GAP}점 이상 뒤지면 방패를 들고 시작`, () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    s.players[0].score = 6;
    s.players[1].score = 2;
    s.players[2].score = 4;
    const far = arenaGeo(s.rings).radius + 2;
    place(s, 1, far, 0);
    place(s, 2, -far, 0);
    while (s.phase !== "countdown") step(rt);
    expect(s.players[1].shield).toBe(true);
    expect(s.players[0].shield).toBe(false);
  });

  it("끝나면 점수 → 라운드 승 → KO 순으로 순위, 완전히 같으면 같은 등수", () => {
    const s = createMatch(1, humans(4));
    s.players[0].score = 5;
    s.players[1].score = 5;
    s.players[1].stats.roundWins = 1;
    s.players[2].score = 2;
    s.players[3].score = 2;
    expect(computeRanks(s)).toEqual([2, 1, 3, 3]);
  });

  it("라운드 수만큼 하고 끝난다 (봇끼리 끝까지)", () => {
    const s = createMatch(42, Array.from({ length: 4 }, () => ({ bot: true, level: 6 })), { rounds: 3 });
    const rt = createHost(s, botThink);
    let guard = 0;
    while (s.phase !== "gameOver" && guard++ < 60 * 60 * 10) step(rt);
    expect(s.phase).toBe("gameOver");
    expect(s.history).toHaveLength(3);
    expect(s.ranks).not.toBeNull();
    expect(s.events.some((e) => e.k === "over")).toBe(true);
  });
});

describe("무너지는 섬", () => {
  it(`${CRUMBLE_START_MS / 1000}초 뒤부터 바깥 링부터, ${WARN_MS / 1000}초 흔들리다 떨어지고, 가운데 칸은 안 무너진다`, () => {
    const rt = host(2);
    toFight(rt, true);
    const s = rt.state;
    // 사람들은 가운데에 가만히 (몸이 겹치지 않게)
    place(s, 0, -0.6, 0);
    place(s, 1, 0.6, 0);
    run(rt, CRUMBLE_START_MS - 200);
    expect(s.tiles.every((f) => f === 0)).toBe(true);
    run(rt, 400);
    const geo = arenaGeo(s.rings);
    const warned = s.tiles.map((f, i) => (f > 0 ? i : -1)).filter((i) => i >= 0);
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.every((i) => geo.tiles[i].ring === geo.rings)).toBe(true);
    expect(solidAt(s, geo.tiles[warned[0]].x, geo.tiles[warned[0]].z)).toBe(true);
    run(rt, WARN_MS + 50);
    expect(solidAt(s, geo.tiles[warned[0]].x, geo.tiles[warned[0]].z)).toBe(false);
    run(rt, 80_000);
    expect(s.tiles[0]).toBe(0);
  });

  it("발밑이 무너지면 떨어진다, 점프로 구멍을 건널 수 있다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    const geo = arenaGeo(s.rings);
    // 가운데 옆 칸 하나를 없애고, 그 너머로 점프
    const hole = geo.index.get("1,0")!;
    s.tiles[hole] = s.t - 1;
    place(s, 1, -3, 3);
    place(s, 0, 0.6, 0);
    s.players[0].vx = 5;
    setInput(rt, 0, { mx: 1, mz: 0, brace: false, dash: 0, jump: 1 });
    run(rt, 700);
    setInput(rt, 0, { mx: 0, mz: 0, brace: true, dash: 0, jump: 1 });
    run(rt, 800);
    const p = s.players[0];
    expect(p.x).toBeGreaterThan(geo.tiles[hole].x);
    expect(p.alive).toBe(true);
    // 걸어서 들어가면 떨어진다
    place(s, 1, geo.tiles[hole].x - 1.2, 0);
    setInput(rt, 1, { mx: 1, mz: 0, brace: false, dash: 0, jump: 0 });
    run(rt, 1500);
    expect(s.players[1].alive).toBe(false);
  });

  it("착지 충격파가 근처 사람을 밀어낸다", () => {
    const rt = host(2);
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 1, 1.8, 0);
    setInput(rt, 0, { mx: 0, mz: 0, brace: false, dash: 0, jump: 1 });
    run(rt, 700);
    expect(s.events.some((e) => e.k === "land" && e.s === 0 && e.n === 1)).toBe(true);
    expect(s.players[1].vx).toBeGreaterThan(2);
    expect(s.players[0].stats.pounds).toBe(1);
  });
});

describe("아이템", () => {
  function withItem(kind: "big" | "turbo" | "shield" | "shock") {
    const rt = host(2, { items: true });
    toFight(rt);
    const s = rt.state;
    place(s, 0, 0, 0);
    place(s, 1, 2.2, 0);
    s.items = [{ id: 1, kind, x: 0.3, z: 0, tile: 0, until: s.t + 9999 }];
    step(rt);
    return { rt, s };
  }

  it("지나가면 줍는다 — 거대화는 몸이 커진다", () => {
    const { s } = withItem("big");
    expect(s.items).toHaveLength(0);
    expect(radiusOf(s.players[0], s.t)).toBeCloseTo(0.62 * BIG_SCALE, 5);
    expect(s.players[0].stats.items).toBe(1);
  });

  it("방패는 다음 큰 충격을 막고 열기도 안 오른다", () => {
    const { rt, s } = withItem("shield");
    expect(s.players[0].shield).toBe(true);
    place(s, 0, 0, 0);
    place(s, 1, -1.6, 0);
    setInput(rt, 1, { mx: 1, mz: 0, brace: false, dash: 1, jump: 0 });
    run(rt, 300);
    expect(s.players[0].shield).toBe(false);
    // 막은 충격은 열기 0 — 그 뒤 살짝 밀어붙이는 접촉만 조금 (막지 않았으면 ≈20%)
    expect(s.players[0].heat).toBeLessThan(6);
    expect(s.players[0].stats.shieldBlocks).toBe(1);
    expect(s.players[0].vx).toBeLessThan(3);
  });

  it("충격파는 줍는 즉시 주변을 바깥으로 튕긴다", () => {
    const { s } = withItem("shock");
    expect(s.players[1].vx).toBeGreaterThan(5);
    expect(s.players[1].lastHitBy).toBe(0);
    expect(s.events.some((e) => e.k === "shock")).toBe(true);
  });

  it("아이템 끄기면 안 나온다", () => {
    const rt = host(2, { items: false });
    while (rt.state.phase !== "fight") step(rt);
    rt.state.nextCrumbleAt = Infinity;
    run(rt, 30_000);
    expect(rt.state.events.some((e) => e.k === "spawn")).toBe(false);
  });
});

describe("유령", () => {
  it("떨어지면 유령이 되고, 입김은 밀지만 KO 점수는 없다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    place(s, 2, arenaGeo(s.rings).radius + 2, 0);
    place(s, 0, 2, 0);
    place(s, 1, -3, -3);
    run(rt, 1500);
    expect(s.players[2].falling).toBe(false);
    const g = s.players[2].ghost!;
    expect(g).not.toBeNull();
    place(s, 0, 2, 0);
    place(s, 1, -3, -3);
    g.x = 1.2;
    g.z = 0;
    g.face = 0;
    g.cdAt = 0;
    setInput(rt, 2, { mx: 0, mz: 0, brace: false, dash: 1, jump: 0 });
    step(rt);
    expect(s.players[0].vx).toBeGreaterThan(3);
    expect(s.players[0].heat).toBe(0);
    expect(s.players[0].lastHitBy).toBe(-1);
    expect(s.players[2].stats.gusts).toBe(1);
  });

  it("유령 끄기면 떨어진 사람은 관전만", () => {
    const rt = host(3, { items: false, ghosts: false });
    toFight(rt);
    const s = rt.state;
    place(s, 2, arenaGeo(s.rings).radius + 2, 0);
    step(rt);
    expect(s.players[2].ghost).toBeNull();
  });
});

describe("끊김·방장 승계", () => {
  it("나간 사람은 AI가 대신하고, 돌아오면 돌려받는다", () => {
    const rt = host(2);
    setAway(rt, 1, true);
    expect(rt.state.players[1].bot).toBe(true);
    expect(rt.state.players[1].away).toBe(true);
    setAway(rt, 1, false);
    expect(rt.state.players[1].bot).toBe(false);
    expect(rt.state.players[1].away).toBe(false);
  });

  it("스냅샷만으로 판을 이어받아 끝까지 진행할 수 있다", () => {
    const s = createMatch(5, Array.from({ length: 3 }, () => ({ bot: true, level: 5 })), { rounds: 3 });
    const a = createHost(s, botThink);
    for (let i = 0; i < 60 * 20; i++) step(a);
    const snap = makeSnap(a.state, 99);
    expect(isSnap(JSON.parse(JSON.stringify(snap)))).toBe(true);
    const b = createHost(stateFromSnap(snap), botThink);
    expect(b.state.round).toBe(a.state.round);
    expect(b.state.players.map((p) => p.score)).toEqual(a.state.players.map((p) => p.score));
    let guard = 0;
    while (b.state.phase !== "gameOver" && guard++ < 60 * 60 * 10) step(b);
    expect(b.state.phase).toBe("gameOver");
    // 원본 상태는 건드리지 않는다
    expect(a.state.phase).not.toBe("gameOver");
  });

  it("버퍼: 같은 이벤트는 한 번만, 예전 스냅샷은 버린다", () => {
    const rt = host(2);
    toFight(rt);
    const buf = new SnapBuffer();
    const s1 = makeSnap(rt.state, 1);
    const first = buf.push(s1, 0);
    expect(first.some((e) => e.k === "go")).toBe(true);
    step(rt);
    const s2 = makeSnap(rt.state, 2);
    expect(buf.push(s2, 30).some((e) => e.k === "go")).toBe(false);
    expect(buf.push(s1, 60)).toEqual([]);
    expect(buf.latest()?.seq).toBe(2);
    expect(buf.body(0, 200)).not.toBeNull();
  });
});

describe("기록", () => {
  it("상세 기록 키", () => {
    const s = createMatch(3, humans(2));
    s.players[0].stats.kos = 4;
    s.players[0].score = 9;
    const d = bumperArenaStatDetails(s, 0);
    expect(d.kos).toBe(4);
    expect(d.maxScore).toBe(9);
    expect(Object.keys(d)).toEqual(expect.arrayContaining(["roundWins", "falls", "selfFalls", "maxKosRound", "maxHeatWin", "cleanWins", "pounds", "gusts"]));
    expect(bumperArenaStatDetails(s, 9)).toEqual({});
  });
});
