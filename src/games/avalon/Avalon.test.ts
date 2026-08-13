import { describe, expect, it } from "vitest";
import {
  applyAction,
  chooseBotAction,
  failThreshold,
  getKnowledge,
  getValidMoves,
  ROLE_SETS,
  startGame,
  TEAM_SIZE_TABLE,
  teamForRole,
  type AvalonState,
  type EngineAction,
  type PlayerState,
  type Role,
  type SeatIndex,
} from "./engine";

function makePlayers(roles: Role[]): PlayerState[] {
  return roles.map((role, seat) => ({ seat, role, team: teamForRole(role) }));
}

function makeState(overrides: Partial<AvalonState> = {}): AvalonState {
  const players = makePlayers(["merlin", "percival", "loyalist", "morgana", "assassin"]);
  return {
    playerCount: 5,
    players,
    round: 1,
    teamSizes: TEAM_SIZE_TABLE[5],
    leader: 0,
    proposedTeam: [],
    phase: "team-proposal",
    votes: {},
    consecutiveRejects: 0,
    questResults: [],
    questCards: {},
    questSuccesses: 0,
    questFails: 0,
    winner: null,
    winReason: null,
    ...overrides,
  };
}

describe("role composition", () => {
  it.each([5, 6, 7, 8, 9, 10])("assigns the correct role multiset for %i players", (n) => {
    const state = startGame(n, 12345);
    const roles = state.players.map((p) => p.role).sort();
    expect(roles).toEqual([...ROLE_SETS[n]].sort());
  });

  it("matches the exact good/evil counts per the rulebook table", () => {
    const expected: Record<number, [number, number]> = {
      5: [3, 2],
      6: [4, 2],
      7: [4, 3],
      8: [5, 3],
      9: [6, 3],
      10: [6, 4],
    };
    for (const [n, [good, evil]] of Object.entries(expected)) {
      const state = startGame(Number(n), 1);
      expect(state.players.filter((p) => p.team === "good").length).toBe(good);
      expect(state.players.filter((p) => p.team === "evil").length).toBe(evil);
    }
  });

  it("always prefers Mordred over Oberon at 7 players (resolving the rulebook's ambiguity)", () => {
    const state = startGame(7, 1);
    expect(state.players.some((p) => p.role === "mordred")).toBe(true);
    expect(state.players.some((p) => p.role === "oberon")).toBe(false);
  });

  it("throws for unsupported player counts", () => {
    expect(() => startGame(4, 1)).toThrow();
    expect(() => startGame(11, 1)).toThrow();
  });

  it("is deterministic for a given seed", () => {
    const a = startGame(8, 42);
    const b = startGame(8, 42);
    expect(a).toEqual(b);
  });

  it("picks a leader seat within range and a full teamSizes table", () => {
    const state = startGame(6, 999);
    expect(state.leader).toBeGreaterThanOrEqual(0);
    expect(state.leader).toBeLessThan(6);
    expect(state.teamSizes).toEqual(TEAM_SIZE_TABLE[6]);
  });
});

describe("quest team size table", () => {
  it("matches the exact rulebook table for every player count", () => {
    expect(TEAM_SIZE_TABLE[5]).toEqual([2, 3, 2, 3, 3]);
    expect(TEAM_SIZE_TABLE[6]).toEqual([2, 3, 4, 3, 4]);
    expect(TEAM_SIZE_TABLE[7]).toEqual([2, 3, 3, 4, 4]);
    expect(TEAM_SIZE_TABLE[8]).toEqual([3, 4, 4, 5, 5]);
    expect(TEAM_SIZE_TABLE[9]).toEqual([3, 4, 4, 5, 5]);
    expect(TEAM_SIZE_TABLE[10]).toEqual([3, 4, 4, 5, 5]);
  });
});

describe("failThreshold", () => {
  it("is 1 fail card for every round except round 4 at 7+ players", () => {
    expect(failThreshold(5, 4)).toBe(1);
    expect(failThreshold(6, 4)).toBe(1);
    expect(failThreshold(7, 1)).toBe(1);
    expect(failThreshold(7, 2)).toBe(1);
    expect(failThreshold(7, 3)).toBe(1);
    expect(failThreshold(7, 5)).toBe(1);
    expect(failThreshold(10, 1)).toBe(1);
  });

  it("is 2 fail cards for round 4 when playerCount >= 7", () => {
    expect(failThreshold(7, 4)).toBe(2);
    expect(failThreshold(8, 4)).toBe(2);
    expect(failThreshold(9, 4)).toBe(2);
    expect(failThreshold(10, 4)).toBe(2);
  });
});

describe("getKnowledge", () => {
  it("Merlin sees all Evil seats except Mordred, and DOES see Oberon", () => {
    const state = makeState({
      players: makePlayers(["merlin", "mordred", "oberon", "morgana", "assassin", "loyalist"]),
      playerCount: 6,
    });
    const k = getKnowledge(state, 0);
    expect(k.evilSeatsKnown.sort()).toEqual([2, 3, 4]); // oberon, morgana, assassin — not mordred (seat 1)
  });

  it("Percival sees exactly the Merlin + Morgana seats, unlabeled", () => {
    const state = makeState({
      players: makePlayers(["loyalist", "percival", "merlin", "morgana", "assassin"]),
    });
    const k = getKnowledge(state, 1);
    expect(k.merlinPercivalCandidates.sort()).toEqual([2, 3]);
    expect(k.evilSeatsKnown).toEqual([]);
  });

  it("Evil non-Oberon roles see each other but not Oberon, and Oberon sees nobody", () => {
    const state = makeState({
      players: makePlayers(["merlin", "percival", "loyalist", "mordred", "morgana", "assassin", "oberon"]),
      playerCount: 7,
    });
    const mordred = getKnowledge(state, 3);
    expect(mordred.evilSeatsKnown.sort()).toEqual([4, 5]); // morgana, assassin — not self, not oberon

    const morgana = getKnowledge(state, 4);
    expect(morgana.evilSeatsKnown.sort()).toEqual([3, 5]);

    const oberon = getKnowledge(state, 6);
    expect(oberon.evilSeatsKnown).toEqual([]);
  });

  it("Loyalists and Percival get no evil knowledge", () => {
    const state = makeState();
    const loyalist = getKnowledge(state, 2);
    expect(loyalist.evilSeatsKnown).toEqual([]);
    expect(loyalist.merlinPercivalCandidates).toEqual([]);
  });
});

describe("team proposal", () => {
  it("rejects a proposal with the wrong number of seats", () => {
    const state = makeState({ round: 1 }); // round 1 for 5p needs 2 seats
    const rejected = applyAction(state, { type: "propose-team", seats: [0, 1, 2] });
    expect(rejected).toEqual(state);
  });

  it("rejects a proposal with duplicate seats", () => {
    const state = makeState();
    const rejected = applyAction(state, { type: "propose-team", seats: [0, 0] });
    expect(rejected).toEqual(state);
  });

  it("accepts a correctly-sized proposal and transitions to voting", () => {
    const state = makeState();
    const next = applyAction(state, { type: "propose-team", seats: [0, 1] });
    expect(next.phase).toBe("voting");
    expect(next.proposedTeam).toEqual([0, 1]);
  });
});

describe("voting", () => {
  it("approves with a strict majority and moves to quest, keeping the same leader", () => {
    const state = makeState({ phase: "voting", proposedTeam: [0, 1], leader: 2 });
    let s = state;
    for (const seat of [0, 1, 2]) s = applyAction(s, { type: "vote", seat, vote: "approve" });
    s = applyAction(s, { type: "vote", seat: 3, vote: "reject" });
    s = applyAction(s, { type: "vote", seat: 4, vote: "reject" });
    expect(s.phase).toBe("quest");
    expect(s.leader).toBe(2); // unchanged until the quest resolves
  });

  it("a tie counts as rejected", () => {
    const state = makeState({
      phase: "voting",
      proposedTeam: [0, 1],
      playerCount: 4,
      players: makePlayers(["merlin", "percival", "morgana", "assassin"]),
    });
    let s = state;
    s = applyAction(s, { type: "vote", seat: 0, vote: "approve" });
    s = applyAction(s, { type: "vote", seat: 1, vote: "approve" });
    s = applyAction(s, { type: "vote", seat: 2, vote: "reject" });
    s = applyAction(s, { type: "vote", seat: 3, vote: "reject" });
    expect(s.phase).toBe("team-proposal");
    expect(s.consecutiveRejects).toBe(1);
  });

  it("rejection advances the leader and returns to team-proposal", () => {
    const state = makeState({ phase: "voting", proposedTeam: [0, 1], leader: 0 });
    let s = state;
    for (const seat of [0, 1, 2, 3, 4]) s = applyAction(s, { type: "vote", seat, vote: "reject" });
    expect(s.phase).toBe("team-proposal");
    expect(s.leader).toBe(1);
    expect(s.consecutiveRejects).toBe(1);
    expect(s.proposedTeam).toEqual([]);
  });

  it("ignores a duplicate vote from the same seat", () => {
    const state = makeState({ phase: "voting", proposedTeam: [0, 1] });
    const once = applyAction(state, { type: "vote", seat: 0, vote: "approve" });
    const twice = applyAction(once, { type: "vote", seat: 0, vote: "reject" });
    expect(twice).toEqual(once);
  });

  it("5 consecutive rejects in one round ends the game immediately with an Evil win", () => {
    let s = makeState({ phase: "voting", proposedTeam: [0, 1], leader: 0, consecutiveRejects: 4 });
    for (const seat of [0, 1, 2, 3, 4]) s = applyAction(s, { type: "vote", seat, vote: "reject" });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("evil");
    expect(s.winReason).toBe("five-rejects");
  });
});

describe("quest resolution", () => {
  it("forces Good players' fail submissions to be ignored (no-op)", () => {
    const state = makeState({ phase: "quest", proposedTeam: [0, 1] }); // seats 0,1 = merlin, percival (both good)
    const rejected = applyAction(state, { type: "play-quest-card", seat: 0, card: "fail" });
    expect(rejected).toEqual(state);
  });

  it("lets Evil players submit fail, and resolves once every team member has submitted", () => {
    const state = makeState({ phase: "quest", proposedTeam: [3, 4] }); // seats 3,4 = morgana, assassin (both evil)
    let s = applyAction(state, { type: "play-quest-card", seat: 3, card: "fail" });
    expect(s.phase).toBe("quest"); // still waiting on seat 4
    s = applyAction(s, { type: "play-quest-card", seat: 4, card: "success" });
    expect(s.phase).toBe("team-proposal"); // resolved: 1 fail, default threshold 1 -> quest failed, but game continues
    expect(s.questFails).toBe(1);
    expect(s.questResults[0].success).toBe(false);
    expect(s.questResults[0].failCount).toBe(1);
  });

  it("a quest with zero fails succeeds", () => {
    const state = makeState({ phase: "quest", proposedTeam: [0, 1] });
    let s = applyAction(state, { type: "play-quest-card", seat: 0, card: "success" });
    s = applyAction(s, { type: "play-quest-card", seat: 1, card: "success" });
    expect(s.questResults[0].success).toBe(true);
    expect(s.questSuccesses).toBe(1);
  });

  it("advances round and leader after a resolved quest that doesn't end the game", () => {
    const state = makeState({ phase: "quest", proposedTeam: [0, 1], round: 1, leader: 2 });
    let s = applyAction(state, { type: "play-quest-card", seat: 0, card: "success" });
    s = applyAction(s, { type: "play-quest-card", seat: 1, card: "success" });
    expect(s.round).toBe(2);
    expect(s.leader).toBe(3);
    expect(s.phase).toBe("team-proposal");
  });

  it("round 4 at 7+ players requires 2 fail cards — a single fail still succeeds", () => {
    const state = makeState({
      phase: "quest",
      playerCount: 7,
      players: makePlayers(["merlin", "percival", "loyalist", "loyalist", "morgana", "assassin", "mordred"]),
      teamSizes: TEAM_SIZE_TABLE[7],
      round: 4,
      proposedTeam: [4, 5, 6, 0], // morgana, assassin, mordred, merlin
    });
    let s = state;
    s = applyAction(s, { type: "play-quest-card", seat: 4, card: "fail" });
    s = applyAction(s, { type: "play-quest-card", seat: 5, card: "success" });
    s = applyAction(s, { type: "play-quest-card", seat: 6, card: "success" });
    s = applyAction(s, { type: "play-quest-card", seat: 0, card: "success" });
    expect(s.questResults[0].success).toBe(true); // only 1 fail, needs 2 at round 4 / 7+ players
    expect(s.questResults[0].failCount).toBe(1);
  });

  it("round 4 at 7+ players fails once 2 fail cards are in", () => {
    const state = makeState({
      phase: "quest",
      playerCount: 7,
      players: makePlayers(["merlin", "percival", "loyalist", "loyalist", "morgana", "assassin", "mordred"]),
      teamSizes: TEAM_SIZE_TABLE[7],
      round: 4,
      proposedTeam: [4, 5, 6, 0],
    });
    let s = state;
    s = applyAction(s, { type: "play-quest-card", seat: 4, card: "fail" });
    s = applyAction(s, { type: "play-quest-card", seat: 5, card: "fail" });
    s = applyAction(s, { type: "play-quest-card", seat: 6, card: "success" });
    s = applyAction(s, { type: "play-quest-card", seat: 0, card: "success" });
    expect(s.questResults[0].success).toBe(false);
    expect(s.questResults[0].failCount).toBe(2);
  });

  it("ignores a duplicate submission from the same seat", () => {
    const state = makeState({ phase: "quest", proposedTeam: [3, 4] });
    const once = applyAction(state, { type: "play-quest-card", seat: 3, card: "fail" });
    const twice = applyAction(once, { type: "play-quest-card", seat: 3, card: "success" });
    expect(twice).toEqual(once);
  });
});

describe("win-condition priority", () => {
  it("3 accumulated fails ends the game as an immediate Evil win, skipping assassination", () => {
    const state = makeState({ questFails: 2, questSuccesses: 0, phase: "quest", proposedTeam: [3, 4] });
    let s = applyAction(state, { type: "play-quest-card", seat: 3, card: "fail" });
    s = applyAction(s, { type: "play-quest-card", seat: 4, card: "success" });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("evil");
    expect(s.winReason).toBe("three-fails");
  });

  it("3 accumulated successes transitions to assassination WITHOUT setting a winner yet", () => {
    const state = makeState({ questFails: 0, questSuccesses: 2, phase: "quest", proposedTeam: [0, 1] });
    let s = applyAction(state, { type: "play-quest-card", seat: 0, card: "success" });
    s = applyAction(s, { type: "play-quest-card", seat: 1, card: "success" });
    expect(s.phase).toBe("assassination");
    expect(s.winner).toBeNull();
    expect(s.winReason).toBeNull();
  });

  it("assassinating Merlin flips the game to an Evil win", () => {
    const state = makeState({ phase: "assassination" }); // seat 0 = merlin
    const s = applyAction(state, { type: "assassinate", targetSeat: 0 });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("evil");
    expect(s.winReason).toBe("assassin-correct");
  });

  it("assassinating a non-Merlin seat confirms the Good win", () => {
    const state = makeState({ phase: "assassination" });
    const s = applyAction(state, { type: "assassinate", targetSeat: 2 }); // loyalist
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("good");
    expect(s.winReason).toBe("three-successes");
  });

  it("assassinate is a no-op outside the assassination phase", () => {
    const state = makeState({ phase: "team-proposal" });
    const s = applyAction(state, { type: "assassinate", targetSeat: 0 });
    expect(s).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7 / Level 1–10 difficulty)
// ---------------------------------------------------------------------------

describe("getValidMoves (AI bot support, ARCHITECTURE.md §7)", () => {
  it("team-proposal: only the leader gets candidates, one per valid-size team", () => {
    const state = makeState(); // leader 0, round 1 -> team size 2
    const moves = getValidMoves(state, 0);
    expect(moves).toHaveLength(10); // C(5,2)
    expect(moves.every((m) => m.type === "propose-team" && m.seats.length === 2)).toBe(true);
    expect(getValidMoves(state, 1)).toEqual([]);
  });

  it("voting: every not-yet-voted seat gets approve/reject, a voted seat gets none", () => {
    const state = makeState({ phase: "voting", proposedTeam: [0, 1], votes: { 2: "approve" } });
    expect(getValidMoves(state, 0)).toEqual([
      { type: "vote", seat: 0, vote: "approve" },
      { type: "vote", seat: 0, vote: "reject" },
    ]);
    expect(getValidMoves(state, 2)).toEqual([]);
  });

  it("quest: only proposed-team seats decide; Good is restricted to 'success', Evil gets both", () => {
    const state = makeState({ phase: "quest", proposedTeam: [0, 3] }); // 0=merlin(good), 3=morgana(evil)
    expect(getValidMoves(state, 0)).toEqual([{ type: "play-quest-card", seat: 0, card: "success" }]);
    const evilMoves = getValidMoves(state, 3);
    expect(evilMoves.map((m) => (m as { card: string }).card).sort()).toEqual(["fail", "success"]);
    expect(getValidMoves(state, 1)).toEqual([]); // not on the team
  });

  it("assassination: only the Assassin gets candidates, one per other seat", () => {
    const state = makeState({ phase: "assassination" });
    const moves = getValidMoves(state, 4); // assassin
    expect(moves).toHaveLength(4);
    expect(moves.every((m) => m.type === "assassinate" && m.targetSeat !== 4)).toBe(true);
    expect(getValidMoves(state, 0)).toEqual([]);
  });

  it("returns [] in gameOver", () => {
    const state = makeState({ phase: "gameOver" });
    expect(getValidMoves(state, 0)).toEqual([]);
  });
});

describe("chooseBotAction (AI bot support, Level 1–10)", () => {
  it("returns null for a seat with nothing to decide", () => {
    const state = makeState(); // team-proposal, leader 0
    expect(chooseBotAction(state, 1, 5)).toBeNull();
  });

  it("always returns a legal move regardless of level", () => {
    const state = makeState({ phase: "assassination" });
    for (let level = 1; level <= 10; level++) {
      const action = chooseBotAction(state, 4, level, () => 0.5);
      expect(action).not.toBeNull();
      expect(getValidMoves(state, 4)).toContainEqual(action);
    }
  });

  it("Level 1 (forced onto its mistake path) approves a team with Merlin's known Evil on it, while Level 10 correctly rejects", () => {
    // Seat 0 is Merlin and knows seat 3 (Morgana) is Evil. getValidMoves
    // lists approve before reject, so Level 1's forced-random path (rng
    // always 0 -> candidates[0]) lands on approve.
    const state = makeState({ phase: "voting", proposedTeam: [1, 3], votes: {} });

    const level1Action = chooseBotAction(state, 0, 1, () => 0);
    expect(level1Action).toEqual({ type: "vote", seat: 0, vote: "approve" });

    const level10Action = chooseBotAction(state, 0, 10, () => 0);
    expect(level10Action).toEqual({ type: "vote", seat: 0, vote: "reject" });
  });
});

function avalonCurrentActorForTest(state: AvalonState): SeatIndex | null {
  if (state.phase === "team-proposal") return state.leader;
  if (state.phase === "voting") {
    for (let s = 0; s < state.playerCount; s++) if (state.votes[s] === undefined) return s;
    return null;
  }
  if (state.phase === "quest") {
    const pending = state.proposedTeam.filter((s) => state.questCards[s] === undefined);
    return pending.length > 0 ? Math.min(...pending) : null;
  }
  if (state.phase === "assassination") {
    const assassin = state.players.find((p) => p.role === "assassin");
    return assassin ? assassin.seat : null;
  }
  return null;
}

function playFullBotGame(roles: Role[], seed: number, levelOf: (seat: SeatIndex) => number): AvalonState {
  let state: AvalonState = { ...makeState(), players: makePlayers(roles), playerCount: roles.length, teamSizes: TEAM_SIZE_TABLE[roles.length] };
  let guard = 0;
  while (state.phase !== "gameOver" && guard < 2000) {
    guard++;
    const seat = avalonCurrentActorForTest(state);
    if (seat === null) break;
    const action = chooseBotAction(state, seat, levelOf(seat), seededSequenceRng(seed + guard));
    expect(action).not.toBeNull();
    state = applyAction(state, action as EngineAction);
  }
  return state;
}

/** A tiny deterministic rng so full-game simulations stay reproducible across runs (ties/mistake-rolls still exercised, just not flaky). */
function seededSequenceRng(seed: number): () => number {
  let x = seed % 2147483647 || 1;
  return () => {
    x = (x * 48271) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

describe("Level 10 고수 AI끼리 풀 시뮬레이션 (버그 없이 gameOver까지 완주)", () => {
  for (const roles of [
    ["merlin", "percival", "loyalist", "morgana", "assassin"] as Role[],
    ["merlin", "percival", "loyalist", "loyalist", "morgana", "assassin"] as Role[],
    ["merlin", "percival", "loyalist", "loyalist", "morgana", "assassin", "mordred"] as Role[],
  ]) {
    it(`completes a ${roles.length}-player all-Level-10 game with a winner declared`, () => {
      const state = playFullBotGame(roles, 100 + roles.length, () => 10);
      expect(state.phase).toBe("gameOver");
      expect(state.winner).not.toBeNull();
    });
  }

  it("also completes with a mixed Level 1 / Level 10 table (no crash, no infinite loop)", () => {
    const roles: Role[] = ["merlin", "percival", "loyalist", "loyalist", "morgana", "assassin"];
    const state = playFullBotGame(roles, 999, (seat) => (seat % 2 === 0 ? 1 : 10));
    expect(state.phase).toBe("gameOver");
    expect(state.winner).not.toBeNull();
  });
});
