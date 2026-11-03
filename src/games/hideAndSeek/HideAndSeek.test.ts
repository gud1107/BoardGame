import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { DIST, NEIGHBORS, ROOMS, SPOTS } from "./house";
import {
  applyAction,
  computeRankings,
  legalMoves,
  moveHash,
  pendingSeats,
  SCORE_CATCH,
  SCORE_HOME,
  SCORE_SURVIVE,
  startGame,
  type GameState,
  type Move,
  type SeatState,
} from "./engine";
import { belief, chooseBotMove } from "./bot";

/** Commit + reveal every pending seat's move and resolve the turn. */
function play(state: GameState, moves: Record<number, Move>): GameState {
  let s = state;
  const pick = (seat: number) => moves[seat] ?? legalMoves(s, seat)[0];
  const chosen: Record<number, Move> = {};
  for (const seat of pendingSeats(s)) {
    chosen[seat] = pick(seat);
    s = applyAction(s, { type: "COMMIT", seat, round: s.round, turn: s.turn, hash: moveHash(chosen[seat], `salt${seat}`) });
  }
  for (const seat of pendingSeats(s)) s = applyAction(s, { type: "REVEAL", seat, round: s.round, turn: s.turn, move: chosen[seat], salt: `salt${seat}` });
  return s;
}

function next(state: GameState): GameState {
  return state.phase === "resolved" ? applyAction(state, { type: "TIMEOUT", stage: state.stage }) : state;
}

function withSeats(state: GameState, patch: Partial<SeatState>[]): GameState {
  return { ...state, seats: state.seats.map((s, i) => ({ ...s, ...(patch[i] ?? {}) })) };
}

/** seed 0 → seeker of round 1 is seat 0 */
function hidden(spots: string[]): GameState {
  let s = startGame(spots.length + 1, 0);
  expect(s.seeker).toBe(0);
  const moves: Record<number, Move> = {};
  spots.forEach((sp, i) => (moves[i + 1] = { kind: "hide", spot: sp }));
  s = next(play(s, moves));
  expect(s.step).toBe("seek");
  return s;
}

describe("house map", () => {
  it("is connected and every room but the yard has a hiding spot", () => {
    for (const r of ROOMS) for (const o of ROOMS) expect(DIST[r.id][o.id]).toBeGreaterThanOrEqual(0);
    for (const r of ROOMS) if (r.id !== "yard") expect(SPOTS.some((s) => s.room === r.id)).toBe(true);
    expect(SPOTS.length).toBe(25);
    expect(NEIGHBORS.yard).toEqual(expect.arrayContaining(["hall", "garage", "living"]));
  });
});

describe("hide-and-seek engine", () => {
  it("rotates the seeker and only hiders act while hiding", () => {
    const s = startGame(4, 0);
    expect(pendingSeats(s)).toEqual([1, 2, 3]);
    expect(legalMoves(s, 0)).toEqual([]);
  });

  it("a search finds whoever is in that spot", () => {
    let s = hidden(["shoecab", "trunk"]);
    s = play(s, { 0: { kind: "search", spot: "shoecab" } });
    const ev = s.events.find((e) => e.t === "search");
    expect(ev && ev.t === "search" && ev.found).toEqual([1]);
    expect(s.seats[1].status).toBe("caught");
    expect(s.seats[0].roundScore).toBe(SCORE_CATCH);
    expect(s.seats[0].room).toBe("hall");
  });

  it("moving into the room the seeker stops in is a bump", () => {
    let s = hidden(["coats", "trunk"]);
    s = play(s, { 0: { kind: "move", room: "living" }, 1: { kind: "sneak", spot: "sofa" } });
    expect(s.seats[1].status).toBe("caught");
    expect(s.events.some((e) => e.t === "bump" && e.victim === 1)).toBe(true);
    // the noise is in the room the hider left
    expect(s.events.some((e) => e.t === "noise" && e.room === "hall" && e.count === 1)).toBe(true);
  });

  it("a still hider in the seeker's room is only sensed, not caught", () => {
    let s = hidden(["sofa", "trunk"]);
    s = play(s, { 0: { kind: "search", spot: "curtain" } });
    expect(s.seats[1].status).toBe("hiding");
    expect(s.events).toContainEqual({ t: "sense", room: "living", present: true });
  });

  it("running home works unless the seeker is at the base or in that room", () => {
    let s = hidden(["coats", "sofa"]);
    // seeker leaves the yard for the garage: both runners make it
    s = play(s, { 0: { kind: "move", room: "garage" }, 1: { kind: "home" }, 2: { kind: "home" } });
    expect(s.seats[1].status).toBe("home");
    expect(s.seats[2].status).toBe("home");
    expect(s.roundOver).toBe(true);
    expect(s.seats[1].score).toBe(SCORE_HOME);

    let t = hidden(["coats", "sofa"]);
    t = play(t, { 0: { kind: "move", room: "yard" }, 1: { kind: "home" } });
    expect(t.seats[1].status).toBe("caught");
    expect(t.events.some((e) => e.t === "blocked")).toBe(true);
  });

  it("caught hiders help search and score for their own catches", () => {
    let s = hidden(["shoecab", "coats"]);
    s = next(play(s, { 0: { kind: "search", spot: "shoecab" } }));
    expect(pendingSeats(s)).toEqual([0, 1, 2]);
    s = play(s, { 0: { kind: "move", room: "yard" }, 1: { kind: "search", spot: "coats" }, 2: { kind: "stay" } });
    expect(s.seats[2].status).toBe("caught");
    expect(s.seats[1].roundScore).toBe(1);
    expect(s.seats[0].roundScore).toBe(SCORE_CATCH * 2);
    expect(s.events.some((e) => e.t === "sweep")).toBe(true);
  });

  it("flash counts hiders in the next room and uses a charge", () => {
    let s = hidden(["sofa", "piano"]);
    s = play(s, { 0: { kind: "flash", room: "living" } });
    expect(s.events).toContainEqual({ t: "flash", seat: 0, room: "living", count: 2 });
    expect(s.flashes).toBe(1);
  });

  it("survivors score when the last turn ends and the game ends after every round", () => {
    let s = hidden(["trunk"]);
    for (;;) {
      s = play(s, { 0: { kind: "move", room: "yard" } });
      if (s.roundOver) break;
      s = next(s);
    }
    expect(s.seats[1].status).toBe("safe");
    expect(s.seats[1].score).toBe(SCORE_SURVIVE);
    // 2 players play 4 rounds (each is the seeker twice)
    let guard = 0;
    while (s.phase !== "ended" && guard++ < 200) s = play(next(s), {});
    expect(s.phase).toBe("ended");
    expect(s.round).toBe(4);
    expect(computeRankings(s)[0].rank).toBe(1);
  });

  it("a timeout hides idle hiders somewhere and keeps the turn moving", () => {
    let s = startGame(3, 5);
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("resolved");
    expect(s.seats.filter((x) => x.status === "hiding").every((x) => x.spot !== null)).toBe(true);
  });

  it("rejects a revealed move that doesn't match the commit", () => {
    let s = hidden(["sofa"]);
    s = applyAction(s, { type: "COMMIT", seat: 0, round: s.round, turn: s.turn, hash: moveHash({ kind: "search", spot: "coats" }, "a") });
    s = applyAction(s, { type: "COMMIT", seat: 1, round: s.round, turn: s.turn, hash: moveHash({ kind: "stay" }, "b") });
    s = applyAction(s, { type: "REVEAL", seat: 0, round: s.round, turn: s.turn, move: { kind: "search", spot: "piano" }, salt: "a" });
    s = applyAction(s, { type: "REVEAL", seat: 1, round: s.round, turn: s.turn, move: { kind: "stay" }, salt: "b" });
    // seat 0's lie became the default "stay put" — nothing searched
    expect(s.events.some((e) => e.t === "search")).toBe(false);
  });
});

describe("hide-and-seek bot", () => {
  it("never reads other hiders' secret spots: belief is the same whatever they hid in", () => {
    const a = hidden(["sofa", "trunk"]);
    const b = withSeats(a, [{}, { spot: "bed", room: "master" }, { spot: "tub", room: "bath" }]);
    expect(Array.from(belief(a))).toEqual(Array.from(belief(b)));
  });

  it("searches the spot a flash and a miss point to", () => {
    let s = hidden(["sofa"]);
    s = withSeats(s, [{ room: "hall" }]);
    s = { ...s, history: [{ turn: 1, events: [{ t: "flash", seat: 0, room: "living", count: 1 }, { t: "search", seat: 0, spot: "piano", found: [], helper: false }] }], turn: 2 };
    const m = chooseBotMove(s, 0, 10, seededRng(1));
    expect(m?.kind).toBe("search");
    expect(["sofa", "curtain"]).toContain(m?.spot);
  });

  it("plays a whole game with bots only", () => {
    for (const n of [2, 4, 6]) {
      const rng = seededRng(n);
      let s = startGame(n, 99 + n);
      let guard = 0;
      while (s.phase !== "ended" && guard++ < 500) {
        const moves: Record<number, Move> = {};
        for (const seat of pendingSeats(s)) moves[seat] = chooseBotMove(s, seat, 7, rng)!;
        s = next(play(s, moves));
      }
      expect(s.phase).toBe("ended");
    }
  });
});
