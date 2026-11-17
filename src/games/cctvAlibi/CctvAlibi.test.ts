import { describe, expect, it } from "vitest";
import { ROOM_COUNT, ROUNDS_BY_PLAYERS, TICKS, VAULT, VAULT_DOORS, canStep, dist, guestDist, hasStairs, neighbors, timeLabel } from "./data";
import { culpritAutoPlan, footageOf, forgeOptions, fullRoute, guestAutoRoute, validCulpritRoute, validForge, validGuestRoute, vaultTicks } from "./planner";
import {
  SCORE_ESCAPE,
  SCORE_GUEST_CATCH,
  SCORE_VOTE_BONUS,
  applyAction,
  autoPlan,
  cctvView,
  claimKind,
  computeRankings,
  contradictionsOf,
  isCaught,
  mulberry32,
  pendingSeats,
  planError,
  startGame,
  type EngineAction,
  type GameState,
} from "./engine";
import { botHasWork, chooseBotAction } from "./bot";
import { FULL_DEDUCE, deduce, hypothesesOf } from "./deduce";
import { cctvSecure } from "./secure";
import { cctvStats } from "./stats";

function step(s: GameState, a: EngineAction): GameState {
  const next = applyAction(s, a);
  expect(next, `action ${JSON.stringify(a)} changed state`).not.toBe(s);
  return next;
}

function playOut(seed: number, levels: number[], options = {}, until?: (s: GameState) => boolean): GameState {
  let s = startGame(levels.length, seed, options);
  const rng = mulberry32(seed + 7);
  for (let i = 0; i < 4000 && s.phase !== "ended"; i++) {
    if (until?.(s)) break;
    const seat = pendingSeats(s).find((p) => botHasWork(s, p));
    if (seat === undefined) break;
    const a = chooseBotAction(s, seat, (levels[seat] ?? 5) as never, rng);
    expect(a, `bot ${seat} has an action in ${s.phase}`).not.toBeNull();
    s = step(s, a!);
  }
  return s;
}

/** 모든 좌석이 자동 계획을 내 밤을 끝낸다 */
function throughNight(seed: number, n: number): GameState {
  let s = startGame(n, seed);
  for (let seat = 0; seat < n; seat++) s = step(s, { type: "PLAN", seat, stage: s.stage, plan: autoPlan(s, seat) });
  expect(s.phase).toBe("watch");
  return s;
}

function toInvestigation(seed: number, n: number): GameState {
  let s = throughNight(seed, n);
  for (let seat = 0; seat < n; seat++) s = step(s, { type: "READY", seat, stage: s.stage });
  expect(s.phase).toBe("investigate");
  return s;
}

describe("cctv alibi map", () => {
  it("doors are symmetric; the vault opens only onto the five stair rooms", () => {
    for (let r = 0; r <= VAULT; r++) for (const nb of neighbors(r)) expect(neighbors(nb)).toContain(r);
    expect(neighbors(VAULT)).toEqual(VAULT_DOORS);
    for (const corner of [0, 2, 6, 8]) {
      expect(hasStairs(corner)).toBe(false);
      expect(canStep(corner, VAULT)).toBe(false);
    }
    expect(canStep(4, 4)).toBe(true);
    expect(canStep(0, 4)).toBe(false);
  });

  it("guests never get a shortcut through the vault", () => {
    expect(dist(1, 7)).toBe(2);
    expect(guestDist(1, 7)).toBe(2);
    expect(guestDist(0, 8)).toBe(4);
    for (let a = 0; a < ROOM_COUNT; a++) for (let b = 0; b < ROOM_COUNT; b++) expect(guestDist(a, b)).toBe(Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) + Math.abs((a % 3) - (b % 3)));
    expect(timeLabel(0)).toBe("21:00");
    expect(timeLabel(TICKS)).toBe("01:00");
  });
});

describe("cctv alibi planner", () => {
  it("auto routes are always legal", () => {
    for (let seed = 0; seed < 300; seed++) {
      const rng = mulberry32(seed);
      const start = seed % ROOM_COUNT;
      const errands = [(start + 1 + (seed % 3)) % ROOM_COUNT, (start + 5) % ROOM_COUNT];
      const route = guestAutoRoute(start, errands, rng);
      expect(validGuestRoute(start, route, errands)).toBe(true);
      expect(route).not.toContain(VAULT);
      const plan = culpritAutoPlan(start, rng, seed % 2);
      expect(validCulpritRoute(start, plan.route)).toBe(true);
      const full = fullRoute(start, plan.route);
      expect(validForge(full, plan.forge)).toBe(true);
      const footage = footageOf(full, plan.forge);
      expect(footage).not.toContain(VAULT);
      for (let t = 1; t <= TICKS; t++) expect(canStep(footage[t - 1], footage[t])).toBe(true);
      // 조작 구간 밖은 실제와 같다
      const f = plan.forge!;
      for (let t = 0; t <= TICKS; t++) if (t < f.from || t >= f.from + f.rooms.length) expect(footage[t]).toBe(full[t]);
      expect(vaultTicks(full).every((t) => t >= f.from && t < f.from + f.rooms.length)).toBe(true);
    }
  });

  it("forge options are all valid, distinct and cover the vault visit", () => {
    const full = [0, 1, VAULT, 4, 5, 5, 8, 8, 8];
    const options = forgeOptions(full);
    expect(options.length).toBeGreaterThan(3);
    const seen = new Set<string>();
    for (const o of options) {
      expect(validForge(full, o)).toBe(true);
      const key = footageOf(full, o).join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // 금고실에 네 시각 머물면 가릴 수 없다
    expect(forgeOptions([1, VAULT, VAULT, VAULT, VAULT, 1, 1, 1, 1])).toEqual([]);
    expect(validCulpritRoute(1, [VAULT, VAULT, VAULT, VAULT, 1, 1, 1, 1])).toBe(false);
    expect(validCulpritRoute(0, [0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
    expect(validGuestRoute(1, [VAULT, 1, 1, 1, 1, 1, 1, 1], [])).toBe(false);
  });
});

describe("cctv alibi engine", () => {
  it("deals distinct starts, errands away from the start, one culprit without errands", () => {
    for (let n = 3; n <= 6; n++) {
      const s = startGame(n, 77 + n);
      expect(new Set(s.starts).size).toBe(n);
      expect(s.rounds).toBe(ROUNDS_BY_PLAYERS[n]);
      s.errands.forEach((e, seat) => {
        if (seat === s.culprit) expect(e).toEqual([]);
        else {
          expect(e.length).toBe(2);
          expect(e).not.toContain(s.starts[seat]);
        }
      });
    }
  });

  it("rejects illegal plans and plans for the wrong role", () => {
    const s = startGame(4, 5);
    const guest = (s.culprit + 1) % 4;
    const good = autoPlan(s, guest);
    expect(planError(s, guest, good)).toBeNull();
    expect(planError(s, guest, { route: good.route, forge: { from: 1, rooms: [0] } })).not.toBeNull();
    expect(planError(s, s.culprit, { route: Array(TICKS).fill(s.starts[s.culprit]), forge: null })).not.toBeNull();
    expect(applyAction(s, { type: "PLAN", seat: guest, stage: s.stage, plan: { route: [9, 9, 9, 9, 9, 9, 9, 9], forge: null } })).toBe(s);
    const once = step(s, { type: "PLAN", seat: guest, stage: s.stage, plan: good });
    expect(applyAction(once, { type: "PLAN", seat: guest, stage: once.stage, plan: good })).toBe(once);
    expect(applyAction(once, { type: "PLAN", seat: s.culprit, stage: once.stage - 1, plan: autoPlan(s, s.culprit) })).toBe(once);
  });

  it("after the night only the culprit footage differs from the truth, and sight is the truth", () => {
    for (let seed = 1; seed < 40; seed++) {
      const n = 3 + (seed % 4);
      const s = throughNight(seed, n);
      for (let seat = 0; seat < n; seat++) {
        if (seat === s.culprit) {
          expect(s.footage[seat]).not.toEqual(s.truth[seat]);
          expect(s.truth[seat]).toContain(VAULT);
        } else expect(s.footage[seat]).toEqual(s.truth[seat]);
        expect(s.footage[seat]).not.toContain(VAULT);
        for (let t = 0; t <= TICKS; t++) {
          for (let x = 0; x < n; x++) {
            if (x === seat) continue;
            expect(s.sight[seat][t].includes(x)).toBe(s.truth[x][t] === s.truth[seat][t]);
          }
        }
        // 손님의 기억과 영상이 어긋나는 상대는 언제나 범인
        if (seat !== s.culprit) for (const c of contradictionsOf(cctvView(s, seat), seat)) expect(c.target).toBe(s.culprit);
      }
    }
  });

  it("views hide the culprit, other routes, errands, plans and votes, and keep the viewer own", () => {
    const s = toInvestigation(11, 5);
    for (let seat = 0; seat < 5; seat++) {
      const v = cctvView(s, seat);
      expect(v.seed).toBe(0);
      expect(v.culpritOrder).toEqual([]);
      expect(v.culprit).toBe(seat === s.culprit ? seat : -1);
      expect(v.footage).toEqual(s.footage);
      for (let x = 0; x < 5; x++) {
        if (x === seat) {
          expect(v.truth[x]).toEqual(s.truth[x]);
          expect(v.plans[x]).toEqual(s.plans[x]);
        } else {
          expect(v.truth[x]).toEqual([]);
          expect(v.sight[x]).toEqual([]);
          expect(v.errands[x]).toEqual([]);
          expect(v.plans[x]).toBeNull();
        }
      }
      // 손님의 보기 어디에도 금고실(9)이 든 동선이 없다
      if (seat !== s.culprit) expect(JSON.stringify([v.truth, v.plans, v.footage])).not.toContain(String(VAULT));
    }
    const viaSecure = cctvSecure.view(s, (s.culprit + 1) % 5);
    expect(viaSecure.culprit).toBe(-1);
  });

  it("sensor check reports the true head count, once per cell, and moves the turn", () => {
    let s = toInvestigation(21, 4);
    const forge = s.plans[s.culprit]!.forge!;
    const t = forge.from;
    const fakeRoom = s.footage[s.culprit][t];
    const first = s.turn;
    expect(applyAction(s, { type: "CHECK", seat: (first + 1) % 4, stage: s.stage, t, room: fakeRoom })).toBe(s);
    expect(applyAction(s, { type: "CHECK", seat: first, stage: s.stage, t: 0, room: fakeRoom })).toBe(s);
    expect(applyAction(s, { type: "CHECK", seat: first, stage: s.stage, t, room: VAULT })).toBe(s);
    s = step(s, { type: "CHECK", seat: first, stage: s.stage, t, room: fakeRoom });
    const e = s.log[s.log.length - 1];
    expect(e.kind).toBe("check");
    if (e.kind === "check") {
      expect(e.footage - e.truth).toBe(1);
      expect(s.tally[first].hits).toBe(1);
    }
    expect(s.turn).toBe((first + 1) % 4);
    expect(applyAction(s, { type: "CHECK", seat: s.turn, stage: s.stage, t, room: fakeRoom })).toBe(s);
  });

  it("guests can only testify to what they really saw; the culprit can say anything, once", () => {
    let found = 0;
    for (let seed = 1; seed < 80 && found < 5; seed++) {
      let s = toInvestigation(seed, 5);
      const witness = [0, 1, 2, 3, 4].find((x) => x !== s.culprit && contradictionsOf(s, x).length > 0);
      if (witness === undefined) continue;
      found++;
      while (s.turn !== witness) s = step(s, { type: "PASS", seat: s.turn, stage: s.stage });
      const innocent = [0, 1, 2, 3, 4].find((x) => x !== s.culprit && x !== witness)!;
      expect(applyAction(s, { type: "TESTIFY", seat: witness, stage: s.stage, target: innocent, t: 3 })).toBe(s);
      expect(applyAction(s, { type: "TESTIFY", seat: witness, stage: s.stage, target: witness, t: 3 })).toBe(s);
      const c = contradictionsOf(s, witness)[0];
      const after = step(s, { type: "TESTIFY", seat: witness, stage: s.stage, target: c.target, t: c.t });
      const e = after.log[after.log.length - 1];
      expect(e.kind === "testify" && e.claim).toBe(claimKind(s, witness, c.target, c.t));
      expect(after.testified[witness]).toBe(true);
    }
    expect(found).toBeGreaterThan(0);

    let s = toInvestigation(4, 4);
    while (s.turn !== s.culprit) s = step(s, { type: "PASS", seat: s.turn, stage: s.stage });
    const victim = (s.culprit + 1) % 4;
    s = step(s, { type: "TESTIFY", seat: s.culprit, stage: s.stage, target: victim, t: 2 });
    // 한 사건에 한 번
    while (s.phase === "investigate" && s.turn !== s.culprit) s = step(s, { type: "PASS", seat: s.turn, stage: s.stage });
    expect(s.phase).toBe("investigate");
    expect(applyAction(s, { type: "TESTIFY", seat: s.culprit, stage: s.stage, target: victim, t: 3 })).toBe(s);
  });

  it("investigation lasts seats x rounds turns, then a secret vote", () => {
    for (const n of [3, 6]) {
      let s = toInvestigation(31, n);
      let turns = 0;
      while (s.phase === "investigate") {
        s = step(s, { type: "PASS", seat: s.turn, stage: s.stage });
        turns++;
      }
      expect(turns).toBe(n * ROUNDS_BY_PLAYERS[n]);
      expect(s.phase).toBe("vote");
      s = step(s, { type: "VOTE", seat: 0, stage: s.stage, target: 1 });
      expect(applyAction(s, { type: "VOTE", seat: 0, stage: s.stage, target: 2 })).toBe(s);
      expect(applyAction(s, { type: "VOTE", seat: 1, stage: s.stage, target: 1 })).toBe(s);
      expect(cctvView(s, 1).votes[0]).toBeUndefined();
      expect(cctvView(s, 0).votes[0]).toBe(1);
    }
  });

  it("culprit is caught only with strictly the most votes", () => {
    expect(isCaught([1, 0, 1, 1], 1, 4)).toBe(true);
    expect(isCaught([1, 0, 0, 1], 1, 4)).toBe(false);
    expect(isCaught([null, null, null], 0, 3)).toBe(false);
    expect(isCaught([2, 2, 0], 2, 3)).toBe(true);
    expect(isCaught([2, 0, 0], 2, 3)).toBe(false);
  });

  it("scores: guests share the catch, right votes get a bonus, an escape pays the culprit", () => {
    const vote = (from: GameState, pickFor: (seat: number) => number | null) => {
      let s = from;
      for (let seat = 0; seat < s.seatCount; seat++) s = step(s, { type: "VOTE", seat, stage: s.stage, target: pickFor(seat) });
      return s;
    };
    let s = toInvestigation(8, 4);
    while (s.phase === "investigate") s = step(s, { type: "PASS", seat: s.turn, stage: s.stage });
    const c = s.culprit;
    const g = [0, 1, 2, 3].filter((x) => x !== c);
    const caught = vote(s, (seat) => (seat === c ? g[0] : seat === g[2] ? g[1] : c));
    expect(caught.phase).toBe("ended");
    expect(caught.cases[0].caught).toBe(true);
    expect(caught.scores[c]).toBe(0);
    expect(caught.scores[g[0]]).toBe(SCORE_GUEST_CATCH + SCORE_VOTE_BONUS);
    expect(caught.scores[g[2]]).toBe(SCORE_GUEST_CATCH);
    expect([...caught.outcome!.winners].sort()).toEqual([g[0], g[1]].sort());
    expect(computeRankings(caught).find((r) => r.seat === c)!.rank).toBe(3);
    expect(cctvView(caught, g[0]).culprit).toBe(c);
    expect(cctvView(caught, g[0]).truth[c]).toContain(VAULT);

    const escaped = vote(s, (seat) => (seat === c ? g[0] : seat === g[0] ? c : null));
    expect(escaped.cases[0].caught).toBe(false);
    expect(escaped.scores[c]).toBe(SCORE_ESCAPE);
    expect(escaped.scores[g[0]]).toBe(SCORE_VOTE_BONUS);
    expect(escaped.outcome!.winners).toEqual([c]);
    const st = cctvStats(cctvView(escaped, c), c);
    expect(st.wins).toBe(1);
    expect(st.escapes).toBe(1);
    expect(st.cleanEscapes).toBe(0);
  });

  it("timeouts move every phase along and count idle streaks", () => {
    let s = startGame(3, 3, { cases: 2 });
    s = step(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("watch");
    expect(s.idleStreak).toEqual([1, 1, 1]);
    expect(applyAction(s, { type: "TIMEOUT", stage: s.stage - 1 })).toBe(s);
    s = step(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("investigate");
    while (s.phase === "investigate") s = step(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.idleStreak.every((v) => v >= 2)).toBe(true);
    s = step(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("result");
    expect(s.cases[0].caught).toBe(false);
    const firstCulprit = s.culprit;
    s = step(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("night");
    expect(s.caseIndex).toBe(1);
    expect(s.culprit).not.toBe(firstCulprit);
    expect(s.planned).toEqual([false, false, false]);
  });
});

describe("cctv alibi deduction", () => {
  it("every culprit footage has at least one hypothesis; a corner stay leaves no one-tick window", () => {
    for (let seed = 0; seed < 200; seed++) {
      const plan = culpritAutoPlan(seed % ROOM_COUNT, mulberry32(seed), 0.5);
      const footage = footageOf(fullRoute(seed % ROOM_COUNT, plan.route), plan.forge);
      expect(hypothesesOf(footage).length).toBeGreaterThan(0);
    }
    // 구석 방에서는 계단까지 한 걸음이 더 든다 — 한 시각짜리 틈은 없다
    const corner = hypothesesOf([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(corner.length).toBeGreaterThan(0);
    expect(corner.every((h) => h.truth.length >= 2)).toBe(true);
    // 계단 방에 머문 영상은 한 시각짜리 틈도 있다
    expect(hypothesesOf([4, 4, 4, 4, 4, 4, 4, 4, 4]).some((h) => h.truth.length === 1)).toBe(true);
  });

  it("never rules out the real culprit, whatever was checked or said", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const n = 3 + (seed % 4);
      const levels = Array.from({ length: n }, (_, i) => 1 + ((seed + i * 3) % 10));
      const s = playOut(seed, levels, {}, (st) => st.phase === "vote");
      expect(s.phase).toBe("vote");
      for (let seat = 0; seat < n; seat++) {
        if (seat === s.culprit) continue;
        const k = deduce(cctvView(s, seat), seat, FULL_DEDUCE);
        expect(k.weight[s.culprit], `seed ${seed} seat ${seat}`).toBeGreaterThan(0);
        expect(k.weight[seat]).toBe(0);
        if (k.certain !== null) expect(k.certain).toBe(s.culprit);
      }
    }
  });
});

describe("cctv alibi bots + secure match", () => {
  it.each([3, 4, 5, 6])("%d bots finish a 2-case game at mixed levels", (n) => {
    for (let seed = 1; seed <= 12; seed++) {
      const levels = Array.from({ length: n }, (_, i) => 1 + ((seed * 3 + i * 4) % 10));
      const s = playOut(seed * 13, levels, { cases: 2 });
      expect(s.phase).toBe("ended");
      expect(s.cases.length).toBe(2);
      expect(s.cases[0].culprit).not.toBe(s.cases[1].culprit);
      expect(s.outcome!.winners.length).toBeGreaterThan(0);
      for (let seat = 0; seat < n; seat++) expect(Object.values(cctvStats(s, seat)).every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it("server parses client actions strictly", () => {
    const s = startGame(4, 1);
    const stage = s.stage;
    expect(cctvSecure.clientAction(s, 0, { type: "TIMEOUT", stage })).toBeNull();
    expect(cctvSecure.clientAction(s, 0, { type: "PLAN", stage, plan: { route: [1, 2] } })).toBeNull();
    expect(cctvSecure.clientAction(s, 0, { type: "PLAN", stage, plan: { route: [1, 1, 1, 1, 1, 1, 1, 1], forge: { from: 1, rooms: [1, 1, 1, 1] } } })).toBeNull();
    expect(cctvSecure.clientAction(s, 9, { type: "READY", stage })).toBeNull();
    // 좌석은 서버가 정한다 — 보낸 seat은 무시
    const a = cctvSecure.clientAction(s, 2, { type: "VOTE", seat: 0, stage, target: null });
    expect(a).toEqual({ type: "VOTE", seat: 2, stage, target: null });
    const p = cctvSecure.clientAction(s, 1, { type: "PLAN", seat: 3, stage, plan: autoPlan(s, 1) });
    expect(p && p.type === "PLAN" && p.seat).toBe(1);
    expect(cctvSecure.timeoutAction(s)).toEqual({ type: "TIMEOUT", stage });
    expect(cctvSecure.pendingBot(s, new Set([3, 1]))).toBe(1);
  });
});
