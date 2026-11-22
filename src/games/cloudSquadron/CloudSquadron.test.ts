import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import { DIFF, INVULN_MS, PICK_MS, PILOTS, PILOT_IDS, REVIVE_MS, SELF_REVIVE_MS, STEP_MS } from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap } from "./net";
import {
  activeZones,
  applyInput,
  castSkill,
  castUlt,
  choosePilot,
  createHost,
  createMatch,
  fireVolley,
  hitPlayer,
  inZone,
  step,
  type HostRuntime,
  type MatchState,
} from "./sim";
import { cloudSquadronStatDetails } from "./stats";

function run(rt: HostRuntime, ms: number) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) step(rt);
}

/** 사람 n명이 조종사를 고르고 비행 단계까지 */
function flyingMatch(pilots: (typeof PILOT_IDS)[number][], opts = {}): { s: MatchState; rt: HostRuntime } {
  const s = createMatch(42, pilots.map(() => ({ bot: false, level: 5 })), opts);
  const rt = createHost(s, botThink);
  pilots.forEach((id, i) => {
    applyInput(rt, i, { pick: id });
    applyInput(rt, i, { ready: true });
  });
  step(rt);
  run(rt, 3400);
  expect(s.phase).toBe("play");
  return { s, rt };
}

describe("구름 편대 — 준비", () => {
  it("고르기 단계로 시작하고 난이도별 이어 하기 수가 정해진다", () => {
    for (const d of ["easy", "normal", "hard"] as const) {
      const s = createMatch(1, [{ bot: false, level: 5 }], { difficulty: d });
      expect(s.phase).toBe("pick");
      expect(s.continues).toBe(DIFF[d].continues);
    }
  });

  it("같은 조종사는 한 명만 고를 수 있다", () => {
    const s = createMatch(1, [
      { bot: false, level: 5 },
      { bot: false, level: 5 },
    ]);
    expect(choosePilot(s, 0, "bolt")).toBe(true);
    expect(choosePilot(s, 1, "bolt")).toBe(false);
    expect(s.players[1].pilot).toBeNull();
  });

  it("시간이 지나면 못 고른 자리는 남은 조종사로 채우고 출격한다", () => {
    const s = createMatch(3, [
      { bot: false, level: 5 },
      { bot: false, level: 5 },
      { bot: true, level: 5 },
    ]);
    const rt = createHost(s, botThink);
    choosePilot(s, 0, "wind");
    run(rt, PICK_MS + 100);
    expect(s.phase).toBe("intro");
    const picked = s.players.map((p) => p.pilot);
    expect(picked.every(Boolean)).toBe(true);
    expect(new Set(picked).size).toBe(3);
    expect(s.players[0].pilot).toBe("wind");
    for (const p of s.players) expect(p.hp).toBe(PILOTS[p.pilot!].maxHp);
  });

  it("모두 준비하면 바로 출격한다", () => {
    const { s } = flyingMatch(["iron", "firefly"]);
    expect(s.stage).toBe(0);
  });
});

describe("구름 편대 — 비행·피격", () => {
  it("사람 위치는 받아들이되 속도 한도를 넘는 순간이동은 막는다", () => {
    const { s, rt } = flyingMatch(["iron"]);
    const p = s.players[0];
    const x0 = p.x;
    rt.posAt[0] = s.t - 50;
    applyInput(rt, 0, { x: x0 + 300, y: p.y });
    expect(p.x - x0).toBeLessThan(60);
    expect(p.x).toBeGreaterThan(x0);
  });

  it("맞은 보고 한 번에 체력 1칸, 무적 동안은 더 안 깎인다", () => {
    const { s, rt } = flyingMatch(["bolt"]);
    s.players[0].invulnUntil = 0;
    applyInput(rt, 0, { hits: 1 });
    expect(s.players[0].hp).toBe(2);
    applyInput(rt, 0, { hits: 2 });
    expect(s.players[0].hp).toBe(2);
    run(rt, INVULN_MS + 50);
    applyInput(rt, 0, { hits: 3 });
    expect(s.players[0].hp).toBe(1);
  });

  it("은신 중 첫 피격은 스쳐 지나간다", () => {
    const { s, rt } = flyingMatch(["shadow"]);
    const p = s.players[0];
    p.invulnUntil = 0;
    expect(castSkill(rt, 0)).toBe(true);
    hitPlayer(s, p);
    expect(p.hp).toBe(2);
    expect(p.stealthUsed).toBe(true);
  });

  it("쓰러진 동료 곁에 머물면 부활하고, 아무도 안 오면 스스로 복귀한다", () => {
    const { s, rt } = flyingMatch(["iron", "wind"]);
    const [a, b] = s.players;
    a.invulnUntil = 0;
    a.hp = 1;
    hitPlayer(s, a);
    expect(a.st).toBe("down");
    // 곁으로
    b.x = a.x;
    b.y = a.y;
    b.bot = true;
    rt.bots[1].mx = 0;
    rt.bots[1].my = 0;
    rt.bots[1].nextThinkAt = 1e12;
    s.bullets = [];
    for (let i = 0; i < Math.round((REVIVE_MS + 300) / STEP_MS) && a.st === "down"; i++) {
      b.x = a.x;
      b.y = a.y;
      b.invulnUntil = s.t + 1000;
      step(rt);
    }
    expect(a.st).toBe("fly");
    expect(b.stats.revives).toBe(1);
    // 혼자 남으면 15초 뒤 복귀
    a.invulnUntil = 0;
    a.hp = 1;
    hitPlayer(s, a);
    b.x = 20;
    b.y = 40;
    const downAt = s.t;
    while (a.st === "down" && s.t - downAt < SELF_REVIVE_MS + 500) {
      b.x = 20;
      b.y = 40;
      b.invulnUntil = s.t + 1000;
      step(rt);
    }
    expect(a.st).toBe("fly");
  });

  it("전원이 쓰러지면 이어 하기, 없으면 실패", () => {
    const { s } = flyingMatch(["wind"], { difficulty: "normal" });
    const p = s.players[0];
    p.invulnUntil = 0;
    p.hp = 1;
    hitPlayer(s, p);
    expect(s.continues).toBe(0);
    expect(p.st).toBe("fly");
    expect(p.hp).toBe(3);
    p.invulnUntil = 0;
    p.hp = 1;
    hitPlayer(s, p);
    expect(s.phase).toBe("gameOver");
    expect(s.result).toBe("fail");
    expect(s.ranks).toEqual([2]);
  });
});

describe("구름 편대 — 스킬·궁극기", () => {
  it("파워가 오를수록 탄이 늘거나 굵어진다", () => {
    for (const id of PILOT_IDS) {
      const d1 = fireVolley(id, 1, 100, 300).reduce((a, v) => a + v.dmg, 0);
      const d4 = fireVolley(id, 4, 100, 300).reduce((a, v) => a + v.dmg, 0);
      expect(d4).toBeGreaterThan(d1 * 1.5);
    }
  });

  it("방패 앞쪽 적탄은 지워지고, 방장과 손님이 같은 구역을 계산한다", () => {
    const { s, rt } = flyingMatch(["iron"]);
    const p = s.players[0];
    castSkill(rt, 0);
    s.bullets = [
      { id: 900001, x: p.x, y: p.y - 36, vx: 0, vy: 0, k: 0, r: 5 },
      { id: 900002, x: p.x, y: p.y + 36, vx: 0, vy: 0, k: 0, r: 5 },
    ];
    const zones = activeZones(makeSnap(s, 1) as unknown as MatchState, s.t);
    expect(zones.some((z) => inZone(z, p.x, p.y - 36))).toBe(true);
    step(rt);
    expect(s.bullets.map((b) => b.id)).toEqual([900002]);
  });

  it("게이지가 차야 궁극기를 쓸 수 있고, 2초 안에 둘이 쓰면 합동 궁극기", () => {
    const { s, rt } = flyingMatch(["shadow", "flame"]);
    expect(castUlt(rt, 0)).toBe(false);
    s.players[0].gauge = 100;
    s.players[1].gauge = 100;
    expect(castUlt(rt, 0)).toBe(true);
    expect(s.slowUntil).toBeGreaterThan(s.t);
    run(rt, 500);
    expect(castUlt(rt, 1)).toBe(true);
    expect(s.events.some((e) => e.k === "combo")).toBe(true);
    expect(s.players[0].comboUntil).toBeGreaterThan(s.t);
  });

  it("반디 신호탄은 쓰러진 동료를 모두 일으킨다", () => {
    const { s, rt } = flyingMatch(["firefly", "bolt", "wind"]);
    for (const i of [1, 2]) {
      s.players[i].invulnUntil = 0;
      s.players[i].hp = 1;
      hitPlayer(s, s.players[i]);
    }
    expect(s.players.filter((p) => p.st === "down").length).toBe(2);
    s.players[0].gauge = 100;
    castUlt(rt, 0);
    expect(s.players.every((p) => p.st === "fly")).toBe(true);
  });
});

describe("구름 편대 — 스냅샷", () => {
  it("스냅샷 ↔ 상태 왕복 (방장 승계)", () => {
    const s = createMatch(77, [
      { bot: true, level: 7 },
      { bot: true, level: 7 },
    ]);
    const rt = createHost(s, botThink);
    run(rt, 20000);
    for (let i = 0; i < 6000 && s.bullets.length < 5; i++) step(rt);
    expect(s.bullets.length).toBeGreaterThan(0);
    const snap = makeSnap(s, 5);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1 })).toBe(false);
    const back = stateFromSnap(snap);
    expect(back.bullets.length).toBe(s.bullets.length);
    expect(back.bullets[0].id).toBe(s.bullets[0].id);
    expect(Math.abs(back.bullets[0].x - s.bullets[0].x)).toBeLessThanOrEqual(0.5);
    expect(back.players.map((p) => p.pilot)).toEqual(s.players.map((p) => p.pilot));
    // 이어받은 판도 끝까지 돈다
    const rt2 = createHost(back, botThink);
    run(rt2, 5000);
    expect(back.t).toBeGreaterThan(s.t);
    // 스냅샷은 넉넉히 작다 (손님 대역폭)
    expect(JSON.stringify(snap).length).toBeLessThan(40000);
  });

  it("받는 쪽은 적탄을 지금 위치로 이어 그린다", () => {
    const s = createMatch(9, [{ bot: true, level: 5 }]);
    const rt = createHost(s, botThink);
    run(rt, 30000);
    s.bullets = [{ id: 1, x: 100, y: 100, vx: 50, vy: 100, k: 0, r: 5 }];
    s.slowUntil = 0;
    const buf = new SnapBuffer();
    buf.push(makeSnap(s, 1), 1000);
    const out = buf.bulletsAt(1200, []);
    expect(out[0].x).toBeCloseTo(110, 0);
    expect(out[0].y).toBeCloseTo(120, 0);
  });
});

describe("구름 편대 — 한 판", () => {
  it("봇끼리 한 판이 끝까지 끝나고 같은 씨앗이면 같은 결과", () => {
    const play = () => {
      const s = createMatch(1234, [
        { bot: true, level: 8 },
        { bot: true, level: 8 },
      ], { stages: 1 });
      const rt = createHost(s, botThink);
      let g = 0;
      while (s.phase !== "gameOver" && g++ < 60 * 60 * 8) step(rt);
      return s;
    };
    const a = play();
    const b = play();
    expect(a.phase).toBe("gameOver");
    expect(a.result).toBe(b.result);
    expect(a.players.map((p) => p.score)).toEqual(b.players.map((p) => p.score));
    const d = cloudSquadronStatDetails(a, 0);
    expect(d.clears).toBe(a.result === "clear" ? 1 : 0);
    expect(d[`pilot_${a.players[0].pilot}`]).toBe(1);
  }, 30000);
});
