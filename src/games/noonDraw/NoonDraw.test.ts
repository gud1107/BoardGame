import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { ARRIVAL_GRACE_MS, BRAWL_MAX_ROUNDS, DRAW_LIMIT_MS, INTRO_MS, READY_MS, RESULT_MS, STALL_LIMIT, WAIT_MAX_MS, WINS_FINAL, WINS_TO_ADVANCE, type Mode } from "./data";
import { activeParticipants, applyAction, computeRanking, createGame, firstStage, planBout, tick, type HostSecret, type NoonAction, type NoonState } from "./engine";
import { botMeanRt, createBotMemory, runBots, sampleBotRt } from "./bots";

const T0 = 1_000_000;

/** Drives the host loop at 50ms with the given bots (seat → level); humans never act unless `onTick` does. */
function run(s: NoonState, bots: Map<number, number>, opts: { seed?: number; maxMs?: number; onTick?: (s: NoonState, now: number) => NoonAction[] } = {}) {
  const rng = seededRng(opts.seed ?? 7);
  const mem = createBotMemory();
  let secret: HostSecret | null = null;
  let now = s.phaseAt;
  const end = now + (opts.maxMs ?? 30 * 60_000);
  const secrets: HostSecret[] = [];
  while (s.phase !== "finished" && now < end) {
    now += 50;
    const r = tick(s, secret, now, rng);
    s = r.state;
    if (r.secret && r.secret !== secret) secrets.push(r.secret);
    secret = r.secret;
    for (const a of runBots(s, now, bots, mem, rng)) s = applyAction(s, a, now);
    for (const a of opts.onTick?.(s, now) ?? []) s = applyAction(s, a, now);
  }
  return { s, now, secrets };
}

/** Advances to the first bout's wait phase. */
function toWait(s: NoonState, rng = seededRng(1)) {
  let r = tick(s, null, T0 + INTRO_MS, rng);
  r = tick(r.state, r.secret, T0 + INTRO_MS + READY_MS, rng);
  return r;
}

const allBots = (n: number, level = 5) => new Map(Array.from({ length: n }, (_, i) => [i, level]));

describe("bracket", () => {
  it.each([2, 3, 4, 5, 6, 7, 8])("%i players: everyone placed once, byes never meet byes", (n) => {
    const st = firstStage(n, seededRng(n));
    const seats = st.flatMap((m) => (m.b === null ? [m.a] : [m.a, m.b]));
    expect(new Set(seats).size).toBe(n);
    expect(st.length & (st.length - 1)).toBe(0);
    expect(st.every((m) => m.b !== null || m.winner === m.a)).toBe(true);
    expect(st[0].target).toBe(st.length === 1 ? WINS_FINAL : WINS_TO_ADVANCE);
  });
});

describe("signal secrecy & timing", () => {
  it("state never carries the planned signal time or future feints", () => {
    const s = createGame({ playerCount: 2, mode: "tournament", seed: 1, now: T0, rng: seededRng(1) });
    const { state, secret } = toWait(s);
    expect(state.bout!.phase).toBe("wait");
    expect(state.bout!.signalAt).toBeNull();
    expect(JSON.stringify(state)).not.toContain(String(secret!.signalAt));
    for (const f of secret!.plan) expect(JSON.stringify(state)).not.toContain(String(f.at));
  });

  it("plan stays inside the window, feints keep their gap before the signal", () => {
    const rng = seededRng(3);
    for (let i = 0; i < 400; i++) {
      const heat = i % 4;
      const p = planBout(i, heat, 0, rng);
      expect(p.signalAt).toBeGreaterThanOrEqual(1800);
      expect(p.signalAt).toBeLessThanOrEqual(WAIT_MAX_MS);
      for (const f of p.plan) expect(p.signalAt - f.at).toBeGreaterThanOrEqual(500);
      if (heat === 0) expect(p.plan.every((f) => f.kind === "bird" || f.kind === "leaf")).toBe(true);
    }
  });

  it("feints become public only once they happen; signal fires at the secret time", () => {
    const rng = seededRng(9);
    let s = createGame({ playerCount: 8, mode: "brawl", seed: 9, now: T0, rng });
    let secret: HostSecret | null = null;
    let now = T0;
    let checked = false;
    while (!checked) {
      now += 50;
      const r = tick(s, secret, now, rng);
      s = r.state;
      secret = r.secret;
      if (s.bout?.phase === "wait" && secret) for (const f of s.bout.feints) expect(f.at).toBeLessThanOrEqual(now);
      if (s.bout?.phase === "draw") {
        expect(s.bout.signalAt! - secret!.signalAt).toBeLessThan(50);
        expect(s.bout.signalAt!).toBeGreaterThanOrEqual(secret!.signalAt);
        checked = true;
      }
    }
  });
});

describe("drawing", () => {
  it("drawing during ready is ignored, during wait is a false start", () => {
    let s = createGame({ playerCount: 2, mode: "tournament", seed: 2, now: T0, rng: seededRng(2) });
    s = tick(s, null, T0 + INTRO_MS, seededRng(2)).state;
    expect(applyAction(s, { type: "draw", seat: 0, rt: 300 }, T0 + INTRO_MS + 10)).toBe(s);
    const w = toWait(createGame({ playerCount: 2, mode: "tournament", seed: 2, now: T0, rng: seededRng(2) })).state;
    // claiming a reaction time before the host fired the signal is still early
    const e = applyAction(w, { type: "draw", seat: 0, rt: 250 }, T0 + 6000);
    expect(e.bout!.draws[0].kind).toBe("early");
    // one draw per bout
    expect(applyAction(e, { type: "draw", seat: 0, rt: 250 }, T0 + 6001)).toBe(e);
  });

  it("under 100ms is a false start, over the limit is a miss", () => {
    const base = toWait(createGame({ playerCount: 2, mode: "tournament", seed: 4, now: T0, rng: seededRng(4) })).state;
    const drawing = { ...base, bout: { ...base.bout!, phase: "draw" as const, signalAt: T0 + 9000 } };
    expect(applyAction(drawing, { type: "draw", seat: 0, rt: 90 }, T0 + 9100).bout!.draws[0]).toMatchObject({ kind: "early", tooFast: true });
    expect(applyAction(drawing, { type: "draw", seat: 0, rt: DRAW_LIMIT_MS + 1 }, T0 + 9100).bout!.draws[0].kind).toBe("late");
    expect(applyAction(drawing, { type: "draw", seat: 0, rt: 240 }, T0 + 9300).bout!.draws[0]).toMatchObject({ kind: "valid", rt: 240 });
  });

  it("faster valid draw takes the point; false start hands it over; nobody drawing times out", () => {
    const mk = () => {
      const w = toWait(createGame({ playerCount: 2, mode: "tournament", seed: 5, now: T0, rng: seededRng(5) })).state;
      return { ...w, bout: { ...w.bout!, phase: "draw" as const, signalAt: T0 + 9000 } };
    };
    const m = mk().bracket[0][0];
    let s = applyAction(mk(), { type: "draw", seat: m.a, rt: 310 }, T0 + 9400);
    s = applyAction(s, { type: "draw", seat: m.b!, rt: 260 }, T0 + 9350);
    s = tick(s, null, T0 + 9401, seededRng(1)).state;
    expect(s.bout!.phase).toBe("result");
    expect(s.bracket[0][0].winsB).toBe(1);
    expect(s.bout!.result!.points![0]).toMatchObject({ winner: m.b, reason: "faster" });

    let e = applyAction(mk(), { type: "draw", seat: m.a, early: true }, T0 + 8990);
    e = tick(e, null, T0 + 9000 + DRAW_LIMIT_MS + ARRIVAL_GRACE_MS, seededRng(1)).state;
    expect(e.bracket[0][0].winsB).toBe(1);
    expect(e.bout!.result!.points![0].reason).toBe("early");

    const none = tick(mk(), null, T0 + 9000 + DRAW_LIMIT_MS + ARRIVAL_GRACE_MS, seededRng(1)).state;
    expect(none.bout!.result!.points![0]).toMatchObject({ winner: null, reason: "double-miss" });
    expect(none.bracket[0][0].stall).toBe(1);
  });

  it("everyone false-starting resolves right away without waiting for the signal", () => {
    let w = toWait(createGame({ playerCount: 2, mode: "tournament", seed: 6, now: T0, rng: seededRng(6) }));
    let s = applyAction(w.state, { type: "draw", seat: 0, early: true }, T0 + 5300);
    s = applyAction(s, { type: "draw", seat: 1, early: true }, T0 + 5310);
    w = tick(s, w.secret, T0 + 5350, seededRng(6));
    expect(w.state.bout!.phase).toBe("result");
    expect(w.state.bout!.result!.points![0].reason).toBe("double-early");
  });

  it("a match stuck on pointless bouts goes to the judge", () => {
    let s = createGame({ playerCount: 2, mode: "tournament", seed: 8, now: T0, rng: seededRng(8) });
    // nobody ever draws: every bout is a double miss
    const r = run(s, new Map(), { maxMs: 10 * 60_000 });
    s = r.s;
    expect(s.phase).toBe("finished");
    expect(s.bracket[0][0].decidedBy).toBe("judge");
    expect(s.log.length).toBe(STALL_LIMIT);
  });
});

describe("predictions", () => {
  it("only spectators can pick, only before the signal, and correct picks score", () => {
    let s = createGame({ playerCount: 3, mode: "tournament", seed: 11, now: T0, rng: seededRng(11) });
    const m = s.bracket[0].find((x) => x.b !== null)!;
    const spec = [0, 1, 2].find((p) => p !== m.a && p !== m.b)!;
    s = toWait(s).state;
    expect(applyAction(s, { type: "pick", seat: m.a, target: m.b! }, T0 + 5000)).toBe(s);
    s = applyAction(s, { type: "pick", seat: spec, target: m.a }, T0 + 5000);
    expect(s.bout!.picks[spec]).toBe(m.a);
    s = { ...s, bout: { ...s.bout!, phase: "draw", signalAt: T0 + 6000 } };
    expect(applyAction(s, { type: "pick", seat: spec, target: m.b! }, T0 + 6010)).toBe(s);
    s = applyAction(s, { type: "draw", seat: m.a, rt: 200 }, T0 + 6300);
    s = applyAction(s, { type: "draw", seat: m.b!, rt: 400 }, T0 + 6500);
    s = tick(s, null, T0 + 6501, seededRng(1)).state;
    expect(s.stats[spec]).toMatchObject({ predictions: 1, predictHits: 1 });
  });
});

describe("brawl", () => {
  it("false starts and the slowest lose hearts; the fastest never does", () => {
    const w = toWait(createGame({ playerCount: 6, mode: "brawl", seed: 12, now: T0, rng: seededRng(12) })).state;
    let s: NoonState = { ...w, bout: { ...w.bout!, phase: "draw", signalAt: T0 + 9000 } };
    const rts = [210, 250, 300, 350, 400, 450];
    rts.forEach((rt, seat) => (s = applyAction(s, { type: "draw", seat, rt }, T0 + 9000 + rt)));
    s = tick(s, null, T0 + 9500, seededRng(1)).state;
    // 6 alive → slowest two lose
    expect(s.bout!.result!.hits!.map((h) => h.seat).sort()).toEqual([4, 5]);
    expect(s.hearts[0]).toBe(2);
    expect(s.hearts[5]).toBe(1);
  });

  it("with a false start the slow penalty shrinks", () => {
    const w = toWait(createGame({ playerCount: 6, mode: "brawl", seed: 13, now: T0, rng: seededRng(13) })).state;
    let s = applyAction(w, { type: "draw", seat: 2, early: true }, T0 + 5000);
    s = { ...s, bout: { ...s.bout!, phase: "draw", signalAt: T0 + 9000 } };
    [0, 1, 3, 4, 5].forEach((seat, i) => (s = applyAction(s, { type: "draw", seat, rt: 200 + i * 40 }, T0 + 9400)));
    s = tick(s, null, T0 + 9500, seededRng(1)).state;
    expect(s.bout!.result!.hits!.map((h) => `${h.seat}:${h.reason}`).sort()).toEqual(["2:early", "5:slow"]);
  });

  it("ranks survivors first, then the latest knocked out", () => {
    const r = run(createGame({ playerCount: 5, mode: "brawl", seed: 14, now: T0, rng: seededRng(14) }), allBots(5));
    expect(r.s.phase).toBe("finished");
    expect(r.s.ranking).toHaveLength(5);
    expect(new Set(r.s.ranking).size).toBe(5);
    const champ = r.s.ranking![0];
    expect(r.s.alive[champ] || r.s.round >= BRAWL_MAX_ROUNDS || r.s.alive.every((a) => !a)).toBe(true);
  });
});

describe("full games with bots", () => {
  it.each<[Mode, number]>([
    ["tournament", 2],
    ["tournament", 3],
    ["tournament", 5],
    ["tournament", 8],
    ["brawl", 2],
    ["brawl", 4],
    ["brawl", 8],
  ])("%s %ip finishes with a full ranking in a sane time", (mode, n) => {
    for (let seed = 1; seed <= 4; seed++) {
      const start = createGame({ playerCount: n, mode, seed, now: T0, rng: seededRng(seed) });
      const { s, now } = run(start, allBots(n, 1 + ((seed * 3) % 10)), { seed });
      expect(s.phase).toBe("finished");
      expect([...s.ranking!].sort()).toEqual(Array.from({ length: n }, (_, i) => i));
      // 8명도 7분 안에
      expect(now - T0).toBeLessThan(7 * 60_000);
      if (mode === "tournament") expect(s.ranking![0]).toBe(s.bracket[s.bracket.length - 1][0].winner);
    }
  });

  it("higher level bots win clearly more often", () => {
    let hiWins = 0;
    const games = 60;
    for (let seed = 1; seed <= games; seed++) {
      const start = createGame({ playerCount: 2, mode: "tournament", seed, now: T0, rng: seededRng(seed) });
      const { s } = run(start, new Map([[0, 9], [1, 4]]), { seed: seed * 31 });
      if (s.ranking![0] === 0) hiWins++;
    }
    expect(hiWins / games).toBeGreaterThan(0.75);
  });

  it("bot reaction times follow the level curve", () => {
    const rng = seededRng(5);
    for (const lv of [1, 5, 10]) {
      const xs = Array.from({ length: 3000 }, () => sampleBotRt(lv, rng));
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(Math.abs(mean - botMeanRt(lv))).toBeLessThan(25);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(125);
    }
  });

  it("a human answering every signal at 230ms beats a Lv.5 bot", () => {
    const start = createGame({ playerCount: 2, mode: "tournament", seed: 21, now: T0, rng: seededRng(21) });
    const { s } = run(start, new Map([[1, 5]]), {
      onTick: (st, now) => (st.bout?.phase === "draw" && !st.bout.draws[0] && now - st.bout.signalAt! >= 230 ? [{ type: "draw", seat: 0, rt: 230 }] : []),
    });
    expect(s.ranking![0]).toBe(0);
    expect(activeParticipants(s)).toEqual([]);
    expect(computeRanking(s)).toEqual(s.ranking);
  });

  it("result screen lasts RESULT_MS before the next bout", () => {
    const start = createGame({ playerCount: 2, mode: "brawl", seed: 3, now: T0, rng: seededRng(3) });
    let s = start;
    let secret: HostSecret | null = null;
    const rng = seededRng(3);
    let now = T0;
    let resultAt = 0;
    while (true) {
      now += 50;
      const r = tick(s, secret, now, rng);
      if (r.state.bout?.phase === "result" && s.bout?.phase !== "result") resultAt = now;
      if (resultAt && r.state.bout && r.state.bout.id !== s.bout?.id) {
        expect(now - resultAt).toBeGreaterThanOrEqual(RESULT_MS);
        break;
      }
      s = r.state;
      secret = r.secret;
    }
  });
});
