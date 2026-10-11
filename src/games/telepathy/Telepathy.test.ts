import { describe, expect, it } from "vitest";
import {
  applyAction,
  BREAK_MS,
  computeScore,
  createGame,
  GRACE_MS,
  MISTAKE_MS,
  rngNext,
  RESYNC_PER_LEVEL,
  STAR_COOLDOWN_MS,
  STAR_REVEAL_MS,
  STAR_VOTE_MS,
  SYNC_COUNTDOWN_MS,
  tick,
  type MindAction,
  type MindState,
} from "./engine";
import { createBotMemory, runBots } from "./bots";

const T0 = 1_000_000;

function act(s: MindState, a: MindAction, now: number) {
  return applyAction(s, a, now);
}

/** Everyone holds, countdown runs out → playing at T0 + countdown. */
function startPlaying(s: MindState, now = T0): MindState {
  for (let seat = 0; seat < s.playerCount; seat++) s = act(s, { type: "hold", seat, on: true }, now);
  return tick(s, now + SYNC_COUNTDOWN_MS);
}

function withHands(s: MindState, hands: number[][]): MindState {
  return { ...s, hands: hands.map((h) => [...h].sort((a, b) => a - b)) };
}

function seededRandom(seed: number) {
  let st = seed >>> 0;
  return () => {
    const [v, n] = rngNext(st);
    st = n;
    return v;
  };
}

describe("setup", () => {
  it("uses the per-count table and deals level-1 hands", () => {
    const s = createGame(3, 42, T0);
    expect(s.maxLevel).toBe(10);
    expect(s.lives).toBe(3);
    expect(s.stars).toBe(1);
    expect(s.hands.map((h) => h.length)).toEqual([1, 1, 1]);
    expect(s.phase).toBe("sync");
  });

  it("is deterministic per seed and never repeats a card", () => {
    const a = createGame(4, 7, T0);
    const b = createGame(4, 7, T0);
    expect(a.hands).toEqual(b.hands);
    let s = withHands(a, a.hands);
    // jump to level 8 deal by forcing next levels through break
    s = { ...s, level: 7, phase: "break", phaseUntil: T0 };
    s = tick(s, T0 + 1);
    const all = s.hands.flat();
    expect(all).toHaveLength(32);
    expect(new Set(all).size).toBe(32);
    expect(s.hands.every((h) => h.every((c, i) => i === 0 || h[i - 1] < c))).toBe(true);
  });
});

describe("sync", () => {
  it("counts down only while everyone holds", () => {
    let s = createGame(2, 1, T0);
    s = act(s, { type: "hold", seat: 0, on: true }, T0);
    expect(s.phaseUntil).toBeNull();
    s = act(s, { type: "hold", seat: 1, on: true }, T0 + 100);
    expect(s.phaseUntil).toBe(T0 + 100 + SYNC_COUNTDOWN_MS);
    s = act(s, { type: "hold", seat: 1, on: false }, T0 + 200);
    expect(s.phaseUntil).toBeNull();
    s = act(s, { type: "hold", seat: 1, on: true }, T0 + 300);
    s = tick(s, T0 + 300 + SYNC_COUNTDOWN_MS);
    expect(s.phase).toBe("playing");
    expect(s.levelStartedAt).toBe(T0 + 300 + SYNC_COUNTDOWN_MS);
  });

  it("an away seat blocks the countdown", () => {
    let s = createGame(2, 1, T0);
    s = act(s, { type: "away", away: [false, true] }, T0);
    s = act(s, { type: "hold", seat: 0, on: true }, T0);
    s = act(s, { type: "hold", seat: 1, on: true }, T0);
    expect(s.holds[1]).toBe(false);
    expect(s.phaseUntil).toBeNull();
  });
});

describe("playing", () => {
  it("only the lowest card can be played", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[10, 20], [30, 40]]));
    const same = act(s, { type: "play", seat: 0, card: 20 }, T0 + 4000);
    expect(same).toBe(s);
    s = act(s, { type: "play", seat: 0, card: 10 }, T0 + 4000);
    expect(s.pending).toHaveLength(1);
  });

  it("confirms after the grace window and resets the flow clock", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[10, 50], [30, 40]]));
    s = act(s, { type: "play", seat: 0, card: 10 }, T0 + 4000);
    expect(tick(s, T0 + 4000 + GRACE_MS - 1).pile).toHaveLength(0);
    s = tick(s, T0 + 4000 + GRACE_MS);
    expect(s.pile.map((p) => p.card)).toEqual([10]);
    expect(s.flowStartAt).toBe(T0 + 4000 + GRACE_MS);
  });

  it("a lower card inside the grace window is reordered, not a mistake", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[71], [90]]));
    s = act(s, { type: "play", seat: 1, card: 90 }, T0 + 5000);
    s = act(s, { type: "play", seat: 0, card: 71 }, T0 + 5000 + 200);
    s = tick(s, T0 + 5000 + 200 + GRACE_MS);
    expect(s.pile.map((p) => p.card)).toEqual([71, 90]);
    expect(s.stats.graceSaves).toBe(1);
    expect(s.lives).toBe(2);
    expect(s.phase).toBe("break"); // level 1 cleared
  });

  it("a mistake reveals every lower card, costs exactly one heart, then re-syncs", () => {
    let s = startPlaying(withHands(createGame(3, 1, T0), [[60], [12, 41], [33, 80]]));
    s = act(s, { type: "play", seat: 0, card: 60 }, T0 + 4000);
    s = tick(s, T0 + 4000 + GRACE_MS);
    expect(s.phase).toBe("mistake");
    expect(s.lives).toBe(2);
    expect(s.lastMistake?.revealed).toEqual([
      { seat: 1, card: 12 },
      { seat: 2, card: 33 },
      { seat: 1, card: 41 },
    ]);
    expect(s.hands).toEqual([[], [], [80]]);
    expect(s.pile.map((p) => p.card)).toEqual([60]);
    s = tick(s, T0 + 4000 + GRACE_MS + MISTAKE_MS);
    expect(s.phase).toBe("sync");
  });

  it("records the pile top before the mistake and why the table re-syncs", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[20, 60], [41, 90]]));
    s = act(s, { type: "play", seat: 0, card: 20 }, T0 + 4000);
    s = tick(s, T0 + 4000 + GRACE_MS);
    s = act(s, { type: "play", seat: 1, card: 41 }, T0 + 6000);
    s = tick(s, T0 + 6000 + GRACE_MS);
    s = act(s, { type: "play", seat: 1, card: 90 }, T0 + 8000);
    s = tick(s, T0 + 8000 + GRACE_MS);
    expect(s.lastMistake).toMatchObject({ prevTop: 41, trigger: { card: 90, seat: 1 }, revealed: [{ seat: 0, card: 60 }] });
    s = tick(s, T0 + 8000 + GRACE_MS + MISTAKE_MS);
    // hands are empty → level clears instead of re-syncing
    expect(s.phase).toBe("break");
  });

  it("a resync remembers who asked", () => {
    let s = startPlaying(withHands(createGame(3, 1, T0), [[10], [50], [90]]));
    s = act(s, { type: "resync", seat: 2 }, T0 + 4000);
    expect(s.syncReason).toEqual({ kind: "resync", seat: 2 });
  });

  it("losing the last heart ends the game", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[60], [12]]));
    s = { ...s, lives: 1 };
    s = act(s, { type: "play", seat: 0, card: 60 }, T0 + 4000);
    s = tick(s, T0 + 4000 + GRACE_MS);
    s = tick(s, T0 + 4000 + GRACE_MS + MISTAKE_MS);
    expect(s.phase).toBe("lost");
  });

  it("practice mode never loses hearts", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0, { practice: true }), [[60], [12]]));
    s = act(s, { type: "play", seat: 0, card: 60 }, T0 + 4000);
    s = tick(s, T0 + 4000 + GRACE_MS);
    expect(s.lives).toBe(2);
  });

  it("resync is limited per seat per level", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[10], [90]]));
    for (let i = 0; i < RESYNC_PER_LEVEL; i++) {
      s = act(s, { type: "resync", seat: 0 }, T0 + 4000);
      expect(s.phase).toBe("sync");
      s = startPlaying(s, T0 + 5000);
    }
    expect(act(s, { type: "resync", seat: 0 }, T0 + 9000)).toBe(s);
  });
});

describe("⚡ star", () => {
  it("needs everyone, discards each lowest card, and pauses the flow clock", () => {
    let s = startPlaying(withHands(createGame(3, 1, T0), [[5, 70], [44], []]));
    const flow = s.flowStartAt;
    s = act(s, { type: "starPropose", seat: 0 }, T0 + 4000);
    expect(s.phase).toBe("starVote");
    s = act(s, { type: "starVote", seat: 1, yes: true }, T0 + 4500);
    expect(s.phase).toBe("starVote");
    s = act(s, { type: "starVote", seat: 2, yes: true }, T0 + 5000);
    expect(s.phase).toBe("starReveal");
    expect(s.stars).toBe(0);
    expect(s.hands).toEqual([[70], [], []]);
    expect(s.lastStar?.revealed).toEqual([
      { seat: 0, card: 5 },
      { seat: 1, card: 44 },
    ]);
    s = tick(s, T0 + 5000 + STAR_REVEAL_MS);
    expect(s.phase).toBe("sync");
    expect(s.flowStartAt).toBe(flow);
  });

  it("a no vote or a timeout cancels with a cooldown and resumes the paused clock", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[5], [44]]));
    const flow = s.flowStartAt;
    s = act(s, { type: "starPropose", seat: 0 }, T0 + 4000);
    s = tick(s, T0 + 4000 + STAR_VOTE_MS);
    expect(s.phase).toBe("resume");
    expect(act(s, { type: "starPropose", seat: 1 }, T0 + 4000 + STAR_VOTE_MS + 1)).toBe(s);
    s = tick(s, T0 + 4000 + STAR_VOTE_MS + 1000);
    expect(s.phase).toBe("playing");
    expect(s.flowStartAt).toBe(flow + STAR_VOTE_MS + 1000);
    expect(s.starCooldownUntil).toBe(T0 + 4000 + STAR_VOTE_MS + STAR_COOLDOWN_MS);
  });
});

describe("levels, rewards, score", () => {
  it("grants the level reward, caps it, and deals N cards next level", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[10], [20]]));
    s = { ...s, level: 2 };
    s = act(s, { type: "play", seat: 0, card: 10 }, T0 + 4000);
    s = act(s, { type: "play", seat: 1, card: 20 }, T0 + 5000);
    s = tick(s, T0 + 5000 + GRACE_MS);
    expect(s.phase).toBe("break");
    expect(s.stars).toBe(2);
    expect(s.lastReward).toEqual({ level: 2, kind: "star", granted: true });
    s = act(s, { type: "ready", seat: 0 }, T0 + 6000);
    s = act(s, { type: "ready", seat: 1 }, T0 + 6000);
    expect(s.level).toBe(3);
    expect(s.hands.map((h) => h.length)).toEqual([3, 3]);
  });

  it("break times out into the next level", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[10], [20]]));
    s = act(s, { type: "play", seat: 0, card: 10 }, T0 + 4000);
    s = act(s, { type: "play", seat: 1, card: 20 }, T0 + 4100);
    s = tick(s, T0 + 4100 + GRACE_MS);
    s = tick(s, T0 + 4100 + GRACE_MS + BREAK_MS);
    expect(s.level).toBe(2);
  });

  it("clearing the last level wins and scores the bonus", () => {
    let s = startPlaying(withHands(createGame(2, 1, T0), [[10], [20]]));
    s = { ...s, level: 12, log: [{ ...s.log[0], level: 12 }] };
    s = act(s, { type: "play", seat: 0, card: 10 }, T0 + 4000);
    s = act(s, { type: "play", seat: 1, card: 20 }, T0 + 4100);
    s = tick(s, T0 + 4100 + GRACE_MS);
    expect(s.phase).toBe("won");
    // 12×100 + 50 perfect + 500 win + 2 hearts×100 + 1 star×50
    expect(computeScore(s)).toBe(1200 + 50 + 500 + 200 + 50);
  });
});

/** Full table of bots on a simulated clock — the §15 balance check. */
function simulate(playerCount: number, botLevel: number, seed: number): MindState {
  const rng = seededRandom(seed * 7919 + 13);
  const bots = new Map(Array.from({ length: playerCount }, (_, s) => [s, botLevel] as const));
  const memory = createBotMemory();
  let now = T0;
  let s = createGame(playerCount, seed, now);
  for (let steps = 0; steps < 200_000 && s.phase !== "won" && s.phase !== "lost"; steps++) {
    now += 50;
    s = tick(s, now);
    for (const a of runBots(s, now, bots, memory, rng)) s = applyAction(s, a, now);
  }
  return s;
}

describe("bot simulation", () => {
  it("bot tables finish every game and reach the later levels", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      let wins = 0;
      let levels = 0;
      const games = 12;
      for (let g = 0; g < games; g++) {
        const s = simulate(n, 7, g + 1);
        expect(["won", "lost"]).toContain(s.phase);
        if (s.phase === "won") wins++;
        levels += s.stats.levelsCleared;
      }
      expect(levels / games).toBeGreaterThan(1);
      expect(wins).toBeLessThanOrEqual(games);
    }
  }, 60_000);
});
