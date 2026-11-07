import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import * as coup from "@/games/coup/engine";
import * as perudo from "@/games/perudo/engine";
import * as dalmuti from "@/games/dalmuti/engine";
import * as loveLetter from "@/games/loveLetter/engine";
import * as avalon from "@/games/avalon/engine";
import * as bang from "@/games/bang/engine";
import * as bluffRoulette from "@/games/bluffRoulette/engine";
import * as century from "@/games/century/engine";
import * as coyote from "@/games/coyote/engine";
import * as forSale from "@/games/forSale/engine";
import * as lasVegas from "@/games/lasVegas/engine";
import * as noThanks from "@/games/no-thanks/engine";
import * as ratATatCat from "@/games/ratATatCat/engine";
import * as splendor from "@/games/splendor/engine";
import * as summonersRift from "@/games/summonersRift/engine";
import * as wobbleTower from "@/games/wobbleTower/engine";
import {
  DesyncMonitor,
  MAX_RESYNCS,
  QUIET_MS,
  RESYNC_COOLDOWN_MS,
  SETTLE_MS,
  canonicalJson,
  stateDigest,
} from "./useDesyncGuard";

describe("stateDigest", () => {
  it("ignores key order and wire-invisible fields", () => {
    expect(stateDigest({ a: 1, b: [1, { y: 2, x: 1 }] })).toBe(stateDigest({ b: [1, { x: 1, y: 2 }], a: 1 }));
    expect(stateDigest({ a: 1, gone: undefined })).toBe(stateDigest({ a: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("changes when any value changes", () => {
    expect(stateDigest({ hand: [1, 2, 3] })).not.toBe(stateDigest({ hand: [1, 3, 2] }));
    expect(stateDigest({ n: 1 })).not.toBe(stateDigest({ n: 2 }));
  });
});

describe("DesyncMonitor", () => {
  it("host sends one digest per settled state", () => {
    const m = new DesyncMonitor();
    const s = { v: 1 };
    m.noteState(s, 0);
    expect(m.hostTick(SETTLE_MS - 1)).toBeNull();
    expect(m.hostTick(SETTLE_MS)).toBe(stateDigest(s));
    expect(m.hostTick(SETTLE_MS + 500)).toBeNull();
    m.noteState({ v: 2 }, 5000);
    expect(m.hostTick(5000 + SETTLE_MS)).toBe(stateDigest({ v: 2 }));
  });

  it("matches, skips while an action is in flight, resyncs on real drift", () => {
    const m = new DesyncMonitor();
    m.noteState({ v: 1 }, 0);
    expect(m.onDigest(stateDigest({ v: 1 }), QUIET_MS)).toBe("match");
    m.noteState({ v: 2 }, 10_000);
    expect(m.onDigest(stateDigest({ v: 1 }), 10_000 + QUIET_MS - 1)).toBe("skip");
    expect(m.onDigest(stateDigest({ v: 1 }), 10_000 + QUIET_MS)).toBe("resync");
    expect(m.onDigest(stateDigest({ v: 1 }), 10_000 + QUIET_MS + 10)).toBe("skip"); // cooldown
  });

  it("switches itself off when resyncs never converge", () => {
    const m = new DesyncMonitor();
    m.noteState({ local: "only" }, 0);
    let t = 1000;
    for (let i = 0; i < MAX_RESYNCS; i++, t += RESYNC_COOLDOWN_MS) expect(m.onDigest("ffff", t)).toBe("resync");
    expect(m.onDigest("ffff", t)).toBe("skip");
    expect(m.disabled).toBe(true);
  });
});

/**
 * The guard is only safe if two honest clients replaying the same actions
 * land on byte-identical digests — otherwise it would resync forever. Replay
 * each engine twice (one copy round-tripped through JSON like a state-sync)
 * and compare after every step.
 */
type Engine<S, A> = {
  startGame(playerCount: number, seed: number): S;
  applyAction(state: S, action: A): S;
  chooseBotAction(state: S, seat: number, level: 5, rng: () => number): A | null;
};

function replayTwice<S, A>(engine: Engine<S, A>, players: number, seed: number) {
  const rng = seededRng(seed);
  let a = engine.startGame(players, seed);
  let b = JSON.parse(JSON.stringify(engine.startGame(players, seed))) as S;
  let steps = 0;
  for (; steps < 400; steps++) {
    let action: A | null = null;
    for (let seat = 0; seat < players && !action; seat++) action = engine.chooseBotAction(a, seat, 5, rng);
    if (!action) break;
    const wire = JSON.parse(JSON.stringify(action)) as A;
    a = engine.applyAction(a, action);
    b = engine.applyAction(b, wire);
    expect(stateDigest(b)).toBe(stateDigest(a));
  }
  return steps;
}

describe("lockstep engines replay to identical digests", () => {
  const engines = { coup, perudo, dalmuti, loveLetter, avalon, bang, bluffRoulette, century, coyote, forSale, lasVegas, noThanks, ratATatCat, splendor, summonersRift, wobbleTower } as unknown as Record<string, Engine<unknown, unknown>>;
  const players: Record<string, number> = { avalon: 5 };
  for (const [name, engine] of Object.entries(engines)) {
    it(name, () => {
      for (const seed of [1, 2, 3]) // Engines whose round break / reveal is a host action (Coyote, Bluff Roulette) stop early — still compared up to there.
      expect(replayTwice(engine, players[name] ?? 4, seed)).toBeGreaterThanOrEqual(2);
    }, 60_000);
  }
});
