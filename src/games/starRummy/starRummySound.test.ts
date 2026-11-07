import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { applyAction, currentActor, startGame } from "./engine";
import { chooseBotAction } from "./bot";
import { starRummyIntensity, starRummySoundCues } from "./starRummySound";

describe("star-rummy sound cues", () => {
  it("every bot move makes exactly one move sound, and the game ends on victory", () => {
    let s = startGame(2, 7, 1);
    const rng = seededRng(7);
    const all: string[] = [];
    for (let i = 0; i < 2000 && s.phase === "playing"; i++) {
      const next = applyAction(s, chooseBotAction(s, currentActor(s)!, 5, rng)!);
      const cues = starRummySoundCues(s, next).map((c) => (typeof c === "string" ? c : c.name));
      expect(cues.filter((c) => ["meld", "draw", "pass", "out"].includes(c)).length).toBe(1);
      all.push(...cues);
      s = next;
    }
    expect(s.phase).toBe("gameOver");
    expect(all.at(-1)).toBe("victory");
    expect(all).toContain("draw");
  });

  it("raises BGM intensity when a hand is down to 3 tiles", () => {
    const s = startGame(2, 1, 1);
    expect(starRummyIntensity(s)).toBe(0);
    expect(starRummyIntensity({ ...s, hands: [s.hands[0].slice(0, 3), s.hands[1]] })).toBe(1);
  });
});
