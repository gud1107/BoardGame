import { describe, expect, it } from "vitest";
import { applyAction, moveHash, pendingSeats, startGame, type GameState, type Move } from "./engine";
import { playDeadSoundCues } from "./playDeadSound";

function commitAll(state: GameState, moves: Record<number, Move>): GameState[] {
  const frames = [state];
  let s = state;
  for (const seat of pendingSeats(s)) {
    s = applyAction(s, { type: "COMMIT", seat, round: s.round, hash: moveHash(moves[seat], `salt${seat}`) });
    frames.push(s);
  }
  for (const seat of pendingSeats(s)) {
    s = applyAction(s, { type: "REVEAL", seat, round: s.round, move: moves[seat], salt: `salt${seat}` });
    frames.push(s);
  }
  return frames;
}

const cuesOf = (frames: GameState[]) => frames.slice(1).flatMap((f, i) => playDeadSoundCues(frames[i], f));
const names = (cues: ReturnType<typeof playDeadSoundCues>) => cues.map((c) => (typeof c === "string" ? c : c.name));

describe("play-dead sound cues", () => {
  it("clicks per commit, then one chant + outcome per reveal", () => {
    const s0 = startGame(2, 1);
    const frames = commitAll(s0, { 0: { kind: "reload" }, 1: { kind: "cover" } });
    const cues = names(cuesOf(frames));
    expect(cues.filter((c) => c === "commit")).toHaveLength(2);
    expect(cues.filter((c) => c === "chant")).toHaveLength(1);
    expect(cues).toEqual(expect.arrayContaining(["reload", "cover"]));
  });

  it("a shot into cover sounds as fire + blocked, never as a hit", () => {
    let s = startGame(2, 1);
    s = { ...s, seats: s.seats.map((x, i) => (i === 0 ? { ...x, ammo: 2 } : x)) };
    const cues = cuesOf(commitAll(s, { 0: { kind: "shot", target: 1 }, 1: { kind: "cover" } }));
    expect(cues).toContainEqual({ name: "fire", arg: 1 });
    expect(names(cues)).toContain("blocked");
    expect(names(cues)).not.toContain("hit");
  });

  it("the same state twice plays nothing (reconnect re-render)", () => {
    const s = startGame(3, 2);
    expect(playDeadSoundCues(s, s)).toEqual([]);
  });
});

describe("play-dead augment sound cues", () => {
  it("a pick only clicks (never says which card), the last pick blows the reveal call", () => {
    let s = startGame(2, 5, { chooseSeconds: 15, maxRounds: 0, augments: true });
    const a = applyAction(s, { type: "AUG_PICK", seat: 0, round: 1, id: s.aug!.offers[0][0] });
    expect(names(playDeadSoundCues(s, a))).toEqual(["commit"]);
    s = applyAction(a, { type: "AUG_PICK", seat: 1, round: 1, id: a.aug!.offers[1][0] });
    expect(names(playDeadSoundCues(a, s))).toEqual(["augReveal"]);
  });

  it("augment triggers in a reveal get their own sound", () => {
    let s = startGame(3, 6);
    s = { ...s, seats: s.seats.map((x, i) => (i === 0 ? { ...x, augs: ["tripwire" as const], down: true, ammo: 2 } : x)) };
    const cues = names(cuesOf(commitAll(s, { 0: { kind: "hold" }, 1: { kind: "loot", target: 0 }, 2: { kind: "reload" } })));
    expect(cues).toContain("augTrap");
  });
});
