import { describe, expect, it } from "vitest";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyAction,
  lanternView,
  litBy,
  monsterCell,
  pendingSeats,
  startGame,
  type EngineAction,
  type GameState,
} from "./engine";
import { FORESTS, T_FLOOR, T_RAVINE, T_TREE, T_UNKNOWN, bfs, generateForest, mulberry32 } from "./forest";
import { botHasWork, chooseBotAction } from "./bot";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { lanternSecure } from "./secure";

function playBots(n: number, forest: string, level: BotLevel, seed: number): GameState {
  let s = startGame(n, seed, { forest: forest as never, turnSeconds: 60 });
  const rng = mulberry32(seed ^ 0x5eed);
  let guard = 0;
  while (s.phase !== "ended" && guard++ < 2000) {
    const seat = Array.from({ length: n }, (_, i) => i).find((i) => botHasWork(s, i));
    if (seat === undefined) {
      s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
      continue;
    }
    const a = chooseBotAction(s, seat, level, rng);
    const next = a ? applyAction(s, a) : s;
    if (next === s) throw new Error(`bot ${seat} stalled: ${JSON.stringify(a)}`);
    s = next;
  }
  return s;
}

/** 테스트용 숲: 직접 그린 지도로 상태를 덮어쓴다 */
function customState(rows: string[], patch: Partial<GameState> = {}, n = 2): GameState {
  const base = startGame(n, 1);
  const w = rows[0].length;
  const h = rows.length;
  const tiles = rows.join("").replace(/[SA]/g, T_FLOOR);
  const start = rows.join("").indexOf("S");
  const altar = rows.join("").indexOf("A");
  const cells = w * h;
  return {
    ...base,
    w,
    h,
    tiles,
    start,
    altar,
    traps: [],
    bridges: [],
    monsters: [],
    shards: [],
    jars: [],
    need: 0,
    pings: [],
    explored: "1".repeat(cells),
    seenBy: Array(n).fill("1".repeat(cells)),
    checked: Array(cells).fill((1 << n) - 1),
    players: base.players.map((p) => ({ ...p, pos: start })),
    ...patch,
  };
}

function act(s: GameState, a: EngineAction): GameState {
  return applyAction(s, a);
}

describe("lantern keepers forest", () => {
  it("every preset × player count builds a reachable forest with all colors present", () => {
    for (const f of FORESTS) {
      for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
        for (let seed = 1; seed <= 25; seed++) {
          const g = generateForest(f.id, n, seed * 101);
          expect(g.tiles.length).toBe(g.w * g.h);
          expect(g.shards.length).toBe(f.shards);
          const bridged = new Set(g.bridges.map((b) => b.cell));
          const cross = (c: number) => g.tiles[c] === T_FLOOR || (g.tiles[c] === T_RAVINE && bridged.has(c));
          const d = bfs(g.w, g.h, g.start, cross).dist;
          for (const goal of [...g.shards, ...g.jars, g.altar]) expect(d[goal], `${f.id} n${n} seed${seed}`).toBeGreaterThanOrEqual(0);
          for (const b of g.bridges) expect(g.tiles[b.cell]).toBe(T_RAVINE);
          for (const t of g.traps) expect(g.tiles[t.cell]).toBe(T_FLOOR);
          const colors = new Set([...g.traps, ...g.bridges, ...g.monsters].map((x) => x.color));
          for (const c of colors) expect(c).toBeLessThan(n);
          // 인원이 적당하면 모든 색이 적어도 하나는 맡을 물건이 있다
          expect(colors.size).toBe(n);
        }
      }
    }
  });

  it("same seed → same forest", () => {
    expect(generateForest("deep", 4, 77)).toEqual(generateForest("deep", 4, 77));
  });
});

describe("lantern keepers view", () => {
  it("hides other colors' hazards, unexplored terrain and the seed", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = playBots(3, "deep", 6, seed);
      for (let seat = 0; seat < 3; seat++) {
        const v = lanternView(s, seat);
        expect(v.seed).toBe(0);
        expect(v.viewer).toBe(seat);
        for (let c = 0; c < v.tiles.length; c++) if (s.explored[c] !== "1") expect(v.tiles[c]).toBe(T_UNKNOWN);
        for (const t of v.traps) expect(t.state !== "armed" || t.color === seat).toBe(true);
        for (const b of v.bridges) expect(b.revealed || b.color === seat).toBe(true);
        for (const m of v.monsters) expect(m.gone || m.revealed || m.color === seat).toBe(true);
        v.seenBy.forEach((bits, i) => (i === seat ? expect(bits.length).toBeGreaterThan(0) : expect(bits).toBe("")));
      }
    }
  });

  it("a fresh view at the start shows no armed trap of another color anywhere", () => {
    const s = startGame(5, 9, { forest: "shadow" });
    const v = lanternView(s, 2);
    const leak = s.traps.filter((t) => t.color !== 2).map((t) => t.cell);
    expect(v.traps.some((t) => leak.includes(t.cell))).toBe(false);
    // 숨은 칸 — 탐험 안 된 칸의 지형 문자가 하나도 남지 않는다
    expect(v.tiles.split("").filter((t) => t !== T_UNKNOWN).length).toBe(s.explored.split("").filter((b) => b === "1").length);
  });

  it("secure view strips the full map (no leaf equals a hidden trap cell of another color)", () => {
    const s = startGame(4, 3, { forest: "deep" });
    const v = lanternSecure.view(s, 0);
    const hidden = s.traps.filter((t) => t.color !== 0).map((t) => t.cell);
    expect(v.traps.map((t) => t.cell).filter((c) => hidden.includes(c))).toEqual([]);
    expect(lanternSecure.clientAction(s, 0, { type: "TIMEOUT", stage: 0 })).toBeNull();
    expect(lanternSecure.clientAction(s, 0, { type: "PLAN", round: 1, steps: ["X"], flare: false })).toBeNull();
    expect(lanternSecure.clientAction(s, 1, { type: "PLAN", round: 1, steps: ["E"], flare: false })).toEqual({ type: "PLAN", seat: 1, round: 1, steps: ["E"], flare: false });
  });
});

describe("lantern keepers rules", () => {
  const rows = [
    "#########", //
    "#S...~..#",
    "#.#####.#",
    "#......A#",
    "#########",
  ];
  const ravine = 9 + 5;

  it("stepping into a ravine without a bridge costs a heart and stops the walk", () => {
    let s = customState(rows);
    const hearts = s.hearts;
    s = act(s, { type: "TURN", seat: 0, round: 1, steps: ["E", "E", "E"], flare: false });
    s = act(s, { type: "TURN", seat: 1, round: 1, steps: [], flare: false });
    expect(s.round).toBe(2);
    expect(s.players[0].pos).toBe(9 + 4);
    s = act(s, { type: "TURN", seat: 0, round: 2, steps: ["E", "E"], flare: false });
    s = act(s, { type: "TURN", seat: 1, round: 2, steps: [], flare: false });
    expect(s.hearts).toBe(hearts - 1);
    expect(s.players[0].pos).toBe(9 + 4);
    expect(s.noBridge).toContain(ravine);
    expect(s.log.some((e) => e.kind === "fall")).toBe(true);
  });

  it("a bridge carries anyone, and crossing someone else's bridge reveals it", () => {
    let s = customState(rows, { bridges: [{ cell: ravine, color: 1, revealed: false }] });
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, pos: 9 + 4 } : p)) };
    expect(lanternView(s, 0).bridges).toEqual([]);
    expect(lanternView(s, 1).bridges.length).toBe(1);
    s = act(s, { type: "TURN", seat: 0, round: 1, steps: ["E", "E"], flare: false });
    s = act(s, { type: "TURN", seat: 1, round: 1, steps: [], flare: false });
    expect(s.players[0].pos).toBe(9 + 6);
    expect(lanternView(s, 0).bridges.length).toBe(1);
  });

  it("someone else's trap springs; your own color disarms", () => {
    let s = customState(rows, { traps: [{ cell: 9 + 2, color: 1, state: "armed" }] });
    const hearts = s.hearts;
    s = act(s, { type: "TURN", seat: 0, round: 1, steps: ["E", "E", "E"], flare: false });
    s = act(s, { type: "TURN", seat: 1, round: 1, steps: [], flare: false });
    expect(s.hearts).toBe(hearts - 1);
    expect(s.players[0].pos).toBe(9 + 2);
    expect(s.traps[0].state).toBe("sprung");
    let t = customState(rows, { traps: [{ cell: 9 + 2, color: 1, state: "armed" }] });
    t = act(t, { type: "TURN", seat: 0, round: 1, steps: [], flare: false });
    t = act(t, { type: "TURN", seat: 1, round: 1, steps: ["E", "E", "E"], flare: false });
    expect(t.hearts).toBe(hearts);
    expect(t.players[1].pos).toBe(9 + 4);
    expect(t.traps[0].state).toBe("disarmed");
  });

  it("walking into a monster bites: heart, knock back, stunned next round; the owner banishes it from next door", () => {
    const m = { id: 0, color: 1, path: [30, 29, 28], idx: 0, dir: 1 as const, sated: 0, gone: false, revealed: false, spotted: true };
    // 셋째 줄 "#......A#" — 칸 28..34
    let s = customState(rows, { monsters: [m] });
    s = { ...s, players: [{ ...s.players[0], pos: 32 }, { ...s.players[1], pos: 10 }] };
    const hearts = s.hearts;
    s = act(s, { type: "TURN", seat: 0, round: 1, steps: ["W", "W"], flare: false });
    s = act(s, { type: "TURN", seat: 1, round: 1, steps: [], flare: false });
    expect(s.hearts).toBe(hearts - 1);
    expect(s.players[0].pos).toBe(31);
    expect(s.players[0].stunned).toBe(1);
    expect(s.monsters[0].revealed).toBe(true);
    expect(pendingSeats(s)).toEqual([1]);
    // 다음 라운드: 0번은 못 움직이고(기절 풀림) — 주인(1번)이 괴물 옆으로 와서 퇴치
    let b = customState(rows, { monsters: [m] });
    b = { ...b, players: [{ ...b.players[0], pos: 10 }, { ...b.players[1], pos: 33 }] };
    b = act(b, { type: "TURN", seat: 0, round: 1, steps: [], flare: false });
    b = act(b, { type: "TURN", seat: 1, round: 1, steps: ["W", "W"], flare: false });
    expect(b.monsters[0].gone).toBe(true);
    expect(b.tally[1].banishes).toBe(1);
    expect(b.hearts).toBe(hearts);
  });

  it("a monster moving onto someone bites them", () => {
    const m = { id: 0, color: 0, path: [30, 29, 28], idx: 0, dir: 1 as const, sated: 0, gone: false, revealed: false, spotted: false };
    let s = customState(rows, { monsters: [m] });
    s = { ...s, players: [{ ...s.players[0], pos: 10 }, { ...s.players[1], pos: 29 }] };
    s = act(s, { type: "TURN", seat: 0, round: 1, steps: [], flare: false });
    s = act(s, { type: "TURN", seat: 1, round: 1, steps: [], flare: false });
    expect(monsterCell(s.monsters[0])).toBe(29);
    expect(s.players[1].stunned).toBe(1);
    expect(s.log.some((e) => e.kind === "bite" && e.seat === 1)).toBe(true);
  });

  it("collect every shard, then everyone on the altar wins; running out of rounds loses", () => {
    let s = customState(rows, { shards: [{ cell: 9 + 3, taken: false, by: -1 }], need: 1, maxRounds: 10 });
    const go = (steps0: string[], steps1: string[]) => {
      s = act(s, { type: "TURN", seat: 0, round: s.round, steps: steps0 as never, flare: false });
      s = act(s, { type: "TURN", seat: 1, round: s.round, steps: steps1 as never, flare: false });
    };
    go(["E", "E"], ["S", "S"]);
    expect(s.shards[0].taken).toBe(true);
    go(["W", "W", "S"], ["E", "E", "E"]);
    go(["S", "E", "E"], ["E", "E", "E"]);
    go(["E", "E", "E"], []);
    go(["E"], []);
    expect(s.phase).toBe("ended");
    expect(s.outcome?.won).toBe(true);
    expect(s.outcome?.stars).toBeGreaterThanOrEqual(2);

    let t = customState(rows, { maxRounds: 2 });
    t = act(t, { type: "TIMEOUT", stage: t.stage });
    t = act(t, { type: "TIMEOUT", stage: t.stage });
    expect(t.outcome).toMatchObject({ won: false, reason: "oil" });
    expect(t.idleStreak).toEqual([2, 2]);
  });

  it("pings cost one of two per round, toggle off for free, and stay on explored cells only", () => {
    let s = startGame(2, 5);
    const lit = [...litBy(s, 0)].find((c) => s.tiles[c] !== T_TREE)!;
    s = act(s, { type: "SIGNAL", seat: 0, round: 1, ping: { cell: lit, mark: "danger" } });
    expect(s.pings.length).toBe(1);
    expect(s.pingsLeft[0]).toBe(1);
    s = act(s, { type: "SIGNAL", seat: 0, round: 1, ping: { cell: lit, mark: "danger" } });
    expect(s.pings.length).toBe(0);
    const dark = s.explored.indexOf("0");
    expect(act(s, { type: "SIGNAL", seat: 0, round: 1, ping: { cell: dark, mark: "here" } })).toBe(s);
    s = act(s, { type: "SIGNAL", seat: 0, round: 1, word: 0 });
    expect(s.words.at(-1)).toMatchObject({ seat: 0, word: 0 });
    expect(act(s, { type: "SIGNAL", seat: 0, round: 1, word: 1 })).toBe(s);
  });

  it("plans are validated against the real map", () => {
    const s = customState(rows);
    expect(act(s, { type: "PLAN", seat: 0, round: 1, steps: ["N"], flare: false })).toBe(s);
    expect(act(s, { type: "PLAN", seat: 0, round: 1, steps: ["E", "E", "E", "E"], flare: false })).toBe(s);
    const p = act(s, { type: "PLAN", seat: 0, round: 1, steps: ["E", "E"], flare: true });
    expect(p.plans[0]).toEqual({ steps: ["E", "E"], flare: true, ready: false, planned: true, rev: 1 });
    // 늦게 도착한 옛 수정은 무시된다 (출발 뒤에 도착한 초안이 출발을 취소하지 않게)
    const turned = act(p, { type: "TURN", seat: 0, round: 1, steps: ["E"], flare: false, rev: 50 });
    expect(act(turned, { type: "PLAN", seat: 0, round: 1, steps: ["E", "E", "E"], flare: false, rev: 40 })).toBe(turned);
  });
});

describe("lantern keepers bots", () => {
  it("bots never stall and always finish", () => {
    for (const f of FORESTS) {
      for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
        for (const lv of [1, 5, 10] as BotLevel[]) {
          const s = playBots(n, f.id, lv, 1000 + n * 13 + lv);
          expect(s.phase).toBe("ended");
        }
      }
    }
  });

  it("Lv.10 teams escape most forests; Lv.1 teams escape less often", () => {
    const rate = (forest: string, n: number, lv: BotLevel, games: number) => {
      let won = 0;
      for (let g = 0; g < games; g++) if (playBots(n, forest, lv, 5000 + g * 31 + n).outcome?.won) won++;
      return won / games;
    };
    const rows: string[] = [];
    for (const f of FORESTS) {
      for (const n of [2, 3, 5]) {
        const hi = rate(f.id, n, 10, 20);
        const lo = rate(f.id, n, 1, 20);
        rows.push(`${f.id} n${n}: Lv10 ${(hi * 100).toFixed(0)}% / Lv1 ${(lo * 100).toFixed(0)}%`);
        expect(hi, `${f.id} n${n}`).toBeGreaterThanOrEqual(f.id === "trail" ? 0.7 : 0.4);
        expect(hi, `${f.id} n${n}`).toBeGreaterThanOrEqual(lo);
      }
    }
    console.log(rows.join("\n"));
  }, 120_000);
});
