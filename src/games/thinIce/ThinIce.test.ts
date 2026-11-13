import { describe, expect, it } from "vitest";
import { lakeGeo, ringsFor, sectorAngle, sectorOf, sectorSpan, tileIndexAt } from "./lake";
import { botThink } from "./bot";
import {
  COMEBACK_GAP,
  CREDIT_MS,
  FROST_R,
  ICE_DRAIN,
  JUMP_MS,
  PTS_DRAW,
  PTS_FISH,
  PTS_KO,
  STEP_MS,
  STOMP_CENTER_DMG,
  STOMP_DMG,
  SUDDEN_MS,
  THAW_DAMAGE,
  THAW_FIRST_WARN_MS,
  THAW_WARN_MS,
  placePoints,
  sanitizeOptions,
} from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import { applyInput, chooseSector, computeRanks, createHost, createMatch, setAway, setInput, step, tileAt, tileSolid, type HostRuntime, type MatchState } from "./sim";
import { thinIceStatDetails } from "./stats";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function host(n = 2, opts: Parameters<typeof createMatch>[2] = { items: false, ghosts: true }, seed = 7): HostRuntime {
  return createHost(createMatch(seed, humans(n), opts));
}

/** 카운트다운을 건너뛰고 싸움 시작 (해빙·서든데스·아이템은 멈춰 둔다) */
function toFight(rt: HostRuntime, { thaw = false } = {}) {
  const s = rt.state;
  while (s.phase !== "fight") step(rt);
  if (!thaw) s.nextThawAt = Infinity;
  s.nextSuddenAt = Infinity;
  s.nextItemAt = Infinity;
}

function place(s: MatchState, seat: number, x: number, z: number) {
  Object.assign(s.players[seat], { x, z, vx: 0, vz: 0, y: 0, air: "none" });
}

/** 타일 i 한가운데 */
function at(s: MatchState, i: number): [number, number] {
  const t = lakeGeo(s.rings).tiles[i];
  return [t.x, t.z];
}

function tileOf(s: MatchState, q: number, r: number): number {
  return lakeGeo(s.rings).index.get(`${q},${r}`)!;
}

/** 가운데 칸을 매 스텝 다시 얼려 두고 진행 (가운데 선 사람이 안 빠지게) */
function runSafe(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  const c = lakeGeo(rt.state.rings).index.get("0,0")!;
  for (let i = 0; i < n; i++) {
    rt.state.hp[c] = 1;
    step(rt);
  }
}

function run(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) step(rt);
}

/** 사람 입력을 매 스텝 유지 (손님이 같은 입력을 계속 보낸다고 가정) */
function hold(rt: HostRuntime, seat: number, mx: number, mz: number, ms: number) {
  const n = Math.round(ms / STEP_MS);
  const cur = rt.inputs[seat];
  for (let i = 0; i < n; i++) {
    setInput(rt, seat, { ...cur, mx, mz });
    step(rt);
  }
}

describe("호수 (lake)", () => {
  it("인원별 고리 수와 칸 수", () => {
    expect([2, 3, 4, 5, 6].map(ringsFor)).toEqual([4, 5, 5, 6, 6]);
    expect(lakeGeo(4).tiles.length).toBe(61);
    expect(lakeGeo(5).tiles.length).toBe(91);
    expect(lakeGeo(6).tiles.length).toBe(127);
  });

  it("칸 중심 → 같은 칸, 호수 밖 → -1", () => {
    for (const rings of [4, 5, 6]) {
      const geo = lakeGeo(rings);
      geo.tiles.forEach((t, i) => expect(tileIndexAt(geo, t.x, t.z)).toBe(i));
      expect(tileIndexAt(geo, geo.radius + 3, 0)).toBe(-1);
    }
  });

  it("가운데 칸만 구역이 없고, 나머지는 6구역에 고르게 나뉜다", () => {
    for (const rings of [4, 5, 6]) {
      const geo = lakeGeo(rings);
      const counts = geo.bySector.map((l) => l.length);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(geo.tiles.length - 1);
      for (const c of counts) expect(c).toBe((geo.tiles.length - 1) / 6);
      geo.tiles.forEach((t) => {
        if (t.ring === 0) expect(t.sector).toBe(-1);
        else expect(sectorOf(t.x, t.z)).toBe(t.sector);
      });
    }
  });

  it("구역 가운데 방향은 그 구역 안에 있다", () => {
    for (let k = 0; k < 6; k++) {
      const a = sectorAngle(k);
      expect(sectorOf(Math.cos(a) * 5, Math.sin(a) * 5)).toBe(k);
      const [a0, a1] = sectorSpan(k);
      expect(a1 - a0).toBeCloseTo(Math.PI / 3);
    }
  });
});

describe("시작", () => {
  it("모두 서로 떨어진 멀쩡한 칸에서 카운트다운으로 시작", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = createMatch(n * 11, humans(n));
      expect(s.phase).toBe("countdown");
      expect(s.round).toBe(1);
      expect(s.hp.every((h) => h === 1)).toBe(true);
      for (const p of s.players) expect(tileSolid(s, tileAt(s, p.x, p.z))).toBe(true);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(s.players[i].x - s.players[j].x, s.players[i].z - s.players[j].z)).toBeGreaterThan(1.5);
    }
  });

  it("카운트다운 동안은 움직이지 않고 얼음도 안 깎인다", () => {
    const rt = host();
    const p = rt.state.players[0];
    const x0 = p.x;
    setInput(rt, 0, { mx: 1, mz: 0, jump: 1, stomp: 0, vote: -1 });
    run(rt, 1000);
    expect(rt.state.phase).toBe("countdown");
    expect(p.x).toBe(x0);
    expect(rt.state.hp.every((h) => h === 1)).toBe(true);
  });

  it("옵션 정리: 이상한 값은 기본값", () => {
    expect(sanitizeOptions({ rounds: 4 as never })).toEqual({ rounds: 3, items: true, ghosts: true });
    expect(sanitizeOptions({ rounds: 5, items: false, ghosts: false })).toEqual({ rounds: 5, items: false, ghosts: false });
    expect(sanitizeOptions(null)).toEqual({ rounds: 3, items: true, ghosts: true });
  });
});

describe("얼음", () => {
  it("혼자 서 있으면 약 2초 만에 깨지고 물에 빠진다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    const i = tileOf(s, 1, 0);
    place(s, 0, ...at(s, i));
    place(s, 1, ...at(s, tileOf(s, -3, 0)));
    run(rt, 1000);
    expect(s.hp[i]).toBeCloseTo(1 - ICE_DRAIN, 1);
    expect(s.players[0].alive).toBe(true);
    run(rt, 1100);
    expect(s.broke[i]).toBeGreaterThan(0);
    expect(s.players[0].alive).toBe(false);
    expect(s.events.some((e) => e.k === "break" && e.i === i)).toBe(true);
    expect(s.events.some((e) => e.k === "fall" && e.s === 0 && e.by === -1)).toBe(true);
    expect(s.players[0].stats.selfFalls).toBe(1);
  });

  it("두 명이 한 칸에 서면 두 배로 빨리 깎인다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    const i = tileOf(s, 0, 2);
    const [x, z] = at(s, i);
    place(s, 0, x - 0.4, z);
    place(s, 1, x + 0.4, z);
    place(s, 2, ...at(s, tileOf(s, 0, -3)));
    run(rt, 500);
    expect(s.hp[i]).toBeCloseTo(1 - ICE_DRAIN * 2 * 0.5, 1);
  });

  it("아무도 안 선 칸은 천천히 다시 언다 (깨진 칸은 그대로)", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    const i = tileOf(s, 2, 0);
    s.hp[i] = 0.5;
    const j = tileOf(s, -2, 0);
    s.hp[j] = 0;
    s.broke[j] = s.t;
    place(s, 0, ...at(s, tileOf(s, 0, 3)));
    place(s, 1, ...at(s, tileOf(s, 0, -3)));
    run(rt, 2000);
    expect(s.hp[i]).toBeGreaterThan(0.55);
    expect(s.hp[i]).toBeLessThan(0.65);
    expect(s.broke[j]).toBeGreaterThan(0);
  });

  it("깨진 칸 위로 걸어가면 빠진다, 호수 밖으로 나가도 빠진다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    const hole = tileOf(s, 1, 0);
    s.broke[hole] = s.t;
    s.hp[hole] = 0;
    place(s, 0, ...at(s, tileOf(s, 0, 0)));
    place(s, 1, ...at(s, tileOf(s, 4, -4)));
    place(s, 2, ...at(s, tileOf(s, -4, 4)));
    s.hp[tileOf(s, -4, 4)] = 1;
    hold(rt, 0, 1, 0, 900);
    expect(s.players[0].alive).toBe(false);
    hold(rt, 1, 1, 0, 1500);
    expect(s.players[1].alive).toBe(false);
  });
});

describe("점프 · 내려찍기", () => {
  it("점프하면 떠오르고, 그동안 얼음이 안 깎이며, 구멍 한 칸을 건넌다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    const hole = tileOf(s, 1, 0);
    s.broke[hole] = s.t;
    s.hp[hole] = 0;
    const start = tileOf(s, 0, 0);
    place(s, 0, ...at(s, start));
    place(s, 1, ...at(s, tileOf(s, -3, 3)));
    // 구멍 가장자리 근처까지 다가가서 점프
    s.players[0].x += 0.6;
    setInput(rt, 0, { mx: 1, mz: 0, jump: 1, stomp: 0, vote: -1 });
    step(rt);
    expect(s.players[0].air).toBe("jump");
    const hpStart = s.hp[start];
    run(rt, JUMP_MS * 0.5);
    expect(s.players[0].y).toBeGreaterThan(0.3);
    expect(s.hp[start]).toBe(hpStart);
    hold(rt, 0, 1, 0, JUMP_MS * 0.6);
    expect(s.players[0].air).toBe("none");
    expect(s.players[0].alive).toBe(true);
    expect(tileAt(s, s.players[0].x, s.players[0].z)).toBe(tileOf(s, 2, 0));
  });

  it("내려앉은 곳이 구멍이면 빠진다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    const i = tileOf(s, 0, 0);
    place(s, 0, ...at(s, i));
    place(s, 1, ...at(s, tileOf(s, -3, 3)));
    setInput(rt, 0, { mx: 0, mz: 0, jump: 1, stomp: 0, vote: -1 });
    step(rt);
    s.broke[i] = s.t;
    s.hp[i] = 0;
    run(rt, JUMP_MS + 50);
    expect(s.players[0].alive).toBe(false);
  });

  it("내려찍기: 내 칸·주변 칸 금 + 가까운 사람 밀쳐 휘청 + KO 기록", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    const c = tileOf(s, 0, 0);
    const nb = tileOf(s, 1, 0);
    place(s, 0, ...at(s, c));
    const [nx, nz] = at(s, nb);
    place(s, 1, nx, nz);
    setInput(rt, 0, { mx: 0, mz: 0, jump: 0, stomp: 1, vote: -1 });
    step(rt);
    expect(s.players[0].air).toBe("stomp");
    const hpC = s.hp[c];
    const hpN = s.hp[nb];
    run(rt, 450);
    const slam = s.events.find((e) => e.k === "slam");
    expect(slam).toBeTruthy();
    expect(hpC - s.hp[c]).toBeGreaterThanOrEqual(STOMP_CENTER_DMG - 0.02);
    expect(hpN - s.hp[nb]).toBeGreaterThanOrEqual(STOMP_DMG - 0.1);
    const o = s.players[1];
    expect(o.lastHitBy).toBe(0);
    expect(Math.hypot(o.vx, o.vz) > 1 || o.air === "stagger" || Math.hypot(o.x - nx, o.z - nz) > 0.5).toBe(true);
    expect(s.players[0].stats.stompHits).toBe(1);
    // 밀려서 빠지면 KO
    o.x = 99;
    o.air = "none";
    o.lastHitAt = s.t;
    step(rt);
    expect(o.alive).toBe(false);
    expect(s.players[0].stats.kos).toBe(1);
    expect(s.players[0].score).toBe(PTS_KO + placePoints(1, 2));
  });

  it(`밀친 지 ${CREDIT_MS / 1000}초가 지나서 빠지면 KO가 아니다`, () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    place(s, 0, ...at(s, tileOf(s, 0, 0)));
    place(s, 1, ...at(s, tileOf(s, 3, 0)));
    s.players[1].lastHitBy = 0;
    s.players[1].lastHitAt = s.t - CREDIT_MS - 100;
    s.players[1].x = 99;
    step(rt);
    expect(s.players[1].alive).toBe(false);
    expect(s.players[0].stats.kos).toBe(0);
  });

  it("재사용 대기 중엔 다시 안 나간다", () => {
    const rt = host();
    toFight(rt);
    const s = rt.state;
    place(s, 0, ...at(s, tileOf(s, 0, 0)));
    place(s, 1, ...at(s, tileOf(s, -3, 3)));
    setInput(rt, 0, { mx: 0, mz: 0, jump: 0, stomp: 1, vote: -1 });
    run(rt, 600);
    setInput(rt, 0, { mx: 0, mz: 0, jump: 0, stomp: 2, vote: -1 });
    run(rt, 300);
    expect(s.events.filter((e) => e.k === "stomp" && e.s === 0)).toHaveLength(1);
  });
});

describe("해빙 경보", () => {
  it(`${THAW_FIRST_WARN_MS / 1000}초에 경보, ${THAW_WARN_MS / 1000}초 뒤 그 구역 얼음이 ${THAW_DAMAGE * 100}% 녹는다`, () => {
    const rt = host(2, { items: false, ghosts: true }, 3);
    toFight(rt, { thaw: true });
    const s = rt.state;
    const geo = lakeGeo(s.rings);
    // 둘 다 가운데 칸 근처에 (구역 밖) 세워 두고 매 스텝 얼음을 채운다
    place(s, 0, 0, 0);
    place(s, 1, 0.5, 0);
    runSafe(rt, THAW_FIRST_WARN_MS + 50);
    expect(s.thaw).not.toBeNull();
    const sec = s.thaw!.sector;
    const weak = geo.bySector[sec][0];
    s.hp[weak] = THAW_DAMAGE - 0.1;
    const sample = geo.bySector[sec][1];
    s.players.forEach((p) => {
      p.x = 0;
      p.z = 0;
    });
    runSafe(rt, THAW_WARN_MS);
    expect(s.thaw).toBeNull();
    expect(s.broke[weak]).toBeGreaterThan(0);
    expect(s.hp[sample]).toBeLessThan(1 - THAW_DAMAGE + 0.1);
    expect(s.events.some((e) => e.k === "thaw" && e.sector === sec)).toBe(true);
  });

  it("유령 표가 가장 많은 구역이 골라진다, 표가 없으면 바로 전 구역은 피한다", () => {
    const rt = host(4);
    toFight(rt);
    const s = rt.state;
    for (const seat of [1, 2, 3]) {
      s.players[seat].alive = false;
      s.players[seat].ghost = true;
    }
    s.players[1].vote = 4;
    s.players[2].vote = 4;
    s.players[3].vote = 1;
    const pick = chooseSector(s);
    expect(pick.sector).toBe(4);
    expect(pick.by.sort()).toEqual([1, 2]);
    for (const seat of [1, 2, 3]) s.players[seat].vote = -1;
    s.lastSector = 2;
    for (let k = 0; k < 30; k++) expect(chooseSector(s).sector).not.toBe(2);
  });

  it("유령 표는 입력으로 들어오고, 살아 있는 사람 표는 무시된다", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    applyInput(rt, 0, { mx: 0, mz: 0, jump: 0, stomp: 0, vote: 3 });
    expect(s.players[0].vote).toBe(-1);
    s.players[1].alive = false;
    s.players[1].ghost = true;
    applyInput(rt, 1, { mx: 0, mz: 0, jump: 0, stomp: 0, vote: 3 });
    expect(s.players[1].vote).toBe(3);
    expect(s.events.some((e) => e.k === "vote" && e.s === 1 && e.sector === 3)).toBe(true);
    applyInput(rt, 1, { mx: 0, mz: 0, jump: 0, stomp: 0, vote: 9 });
    expect(s.players[1].vote).toBe(-1);
  });
});

describe("서든데스 · 아이템", () => {
  it(`${SUDDEN_MS / 1000}초부터 바깥 고리가 흔들리다 깨진다`, () => {
    const rt = host(2, { items: false, ghosts: false }, 5);
    toFight(rt);
    const s = rt.state;
    s.nextSuddenAt = s.fightStart + SUDDEN_MS;
    s.t = s.fightStart + SUDDEN_MS - STEP_MS;
    place(s, 0, 0, 0);
    place(s, 1, 0.5, 0);
    step(rt);
    expect(s.sudden).toBe(true);
    const outer = lakeGeo(s.rings).byRing[s.rings];
    expect(outer.every((i) => s.doom[i] > 0)).toBe(true);
    s.players.forEach((p) => (p.x = p.z = 0));
    runSafe(rt, 2000);
    expect(outer.every((i) => s.broke[i] > 0)).toBe(true);
  });

  it("🐟 +1점, ❄️ 주변 얼음 회복, 🥾 덜 깎임", () => {
    const rt = host(2, { items: true, ghosts: true });
    toFight(rt);
    const s = rt.state;
    const c = tileOf(s, 0, 0);
    place(s, 0, ...at(s, c));
    place(s, 1, ...at(s, tileOf(s, -3, 3)));
    s.items = [{ id: 1, kind: "fish", x: s.players[0].x, z: s.players[0].z, tile: c, until: s.t + 5000 }];
    step(rt);
    expect(s.players[0].score).toBe(PTS_FISH);
    const nb = tileOf(s, 1, 0);
    s.hp[nb] = 0.3;
    s.hp[c] = 0.4;
    s.items = [{ id: 2, kind: "frost", x: s.players[0].x, z: s.players[0].z, tile: c, until: s.t + 5000 }];
    step(rt);
    expect(s.hp[nb]).toBe(1);
    expect(Math.hypot(at(s, nb)[0], at(s, nb)[1])).toBeLessThan(FROST_R);
    s.items = [{ id: 3, kind: "spikes", x: s.players[0].x, z: s.players[0].z, tile: c, until: s.t + 5000 }];
    step(rt);
    const h0 = s.hp[c];
    run(rt, 1000);
    expect(h0 - s.hp[c]).toBeLessThan(ICE_DRAIN * 0.5);
  });
});

describe("점수 · 순위", () => {
  it("생존 순위 점수: 1등 3 · 2등 2(3인+) · 3등 1(4인+)", () => {
    expect([1, 2, 3, 4].map((r) => placePoints(r, 2))).toEqual([3, 0, 0, 0]);
    expect([1, 2, 3, 4].map((r) => placePoints(r, 3))).toEqual([3, 2, 0, 0]);
    expect([1, 2, 3, 4].map((r) => placePoints(r, 4))).toEqual([3, 2, 1, 0]);
  });

  it("마지막 한 명이 남으면 라운드 끝 + 점수", () => {
    const rt = host(4);
    toFight(rt);
    const s = rt.state;
    s.players.forEach((p, i) => place(s, i, ...at(s, tileOf(s, i - 1, 0))));
    s.players[3].x = 99;
    step(rt);
    s.players[1].x = 99;
    step(rt);
    s.players[2].x = 99;
    step(rt);
    expect(s.phase).toBe("roundEnd");
    const h = s.history[0];
    expect(h.winner).toBe(0);
    expect(h.order).toEqual([3, 1, 2]);
    expect(h.pts).toEqual([3, 1, 2, 0]);
  });

  it("마지막 두 명이 같은 순간 빠지면 무승부 +2씩", () => {
    const rt = host(3);
    toFight(rt);
    const s = rt.state;
    s.players[2].x = 99;
    step(rt);
    s.players[0].x = 99;
    s.players[1].x = -99;
    step(rt);
    expect(s.phase).toBe("roundEnd");
    expect(s.history[0].draw).toBe(true);
    expect(s.history[0].pts[0]).toBe(PTS_DRAW);
    expect(s.history[0].pts[1]).toBe(PTS_DRAW);
    expect(s.history[0].pts[2]).toBe(0);
  });

  it(`꼴찌 보호: 1등보다 ${COMEBACK_GAP}점 이상 뒤지면 다음 라운드 아이젠`, () => {
    const rt = host(2, { rounds: 3, items: false, ghosts: true });
    toFight(rt);
    const s = rt.state;
    s.players[0].score = 10;
    s.players[1].x = 99;
    step(rt);
    while (s.phase !== "countdown") step(rt);
    expect(s.round).toBe(2);
    expect(s.players[1].spikesUntil).toBeGreaterThan(s.fightStart);
    expect(s.players[0].spikesUntil).toBe(0);
  });

  it("최종 순위: 점수 → 라운드 1등 → KO → 버틴 시간, 같으면 같은 등수", () => {
    const s = createMatch(1, humans(3));
    s.players[0].score = 5;
    s.players[1].score = 5;
    s.players[2].score = 5;
    s.players[0].stats.roundWins = 1;
    s.players[1].stats.kos = 2;
    s.players[2].stats.kos = 2;
    expect(computeRanks(s)).toEqual([1, 2, 2]);
  });
});

describe("온라인 · 끊김", () => {
  it("스냅샷 왕복 + 이벤트는 한 번만", () => {
    const rt = host(3);
    toFight(rt);
    run(rt, 500);
    const snap = makeSnap(rt.state, 1);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const buf = new SnapBuffer();
    const first = buf.push(snap, 0);
    expect(buf.push(snap, 10)).toEqual([]);
    expect(first.length).toBe(snap.events.length);
    expect(buf.body(0, 50)).not.toBeNull();
  });

  it("방장 승계: 스냅샷으로 이어받아 끝까지 진행된다", () => {
    const s0 = createMatch(42, [5, 5, 5].map((level) => ({ bot: true, level })), { rounds: 1 });
    const rt0 = createHost(s0, botThink);
    run(rt0, 9000);
    const s1 = stateFromSnap(makeSnap(rt0.state, 9));
    const rt1 = createHost(s1, botThink);
    let guard = 0;
    while (s1.phase !== "gameOver" && guard++ < 60 * 60 * 3) step(rt1);
    expect(s1.phase).toBe("gameOver");
    expect(s1.ranks).not.toBeNull();
  });

  it("사람이 나가면 봇이 대신, 돌아오면 돌려준다 · 봇 자리 입력은 무시", () => {
    const rt = host(2);
    toFight(rt);
    setAway(rt, 1, true);
    expect(rt.state.players[1].bot).toBe(true);
    expect(rt.state.players[1].away).toBe(true);
    const x = rt.state.players[1].x;
    applyInput(rt, 1, { mx: 1, mz: 0, jump: 0, stomp: 0, vote: -1 });
    expect(rt.inputs[1].mx).toBe(0);
    setAway(rt, 1, false);
    expect(rt.state.players[1].bot).toBe(false);
    applyInput(rt, 7, { mx: 1, mz: 0, jump: 0, stomp: 0, vote: -1 });
    expect(rt.state.players[1].x).toBe(x);
  });

  it("상세 기록 키", () => {
    const s = createMatch(1, humans(2));
    const d = thinIceStatDetails(s, 0);
    for (const k of ["kos", "falls", "roundWins", "maxSurviveSec", "maxKosRound", "fish", "voteHits", "tilesBroken", "maxScore"]) expect(d).toHaveProperty(k);
    expect(thinIceStatDetails(s, 9)).toEqual({});
  });
});
