import { describe, expect, it } from "vitest";
import { applyAction, startGame, type Card, type RatATatCatState } from "./engine";
import { LOOP_STEPS, ratSoundCues, sneakEventsAt, sneakTempo, SNEAK_BPM, SNEAK_FINAL_BPM, STEPS_PER_BAR } from "./ratSneakScore";

/** A playing 2-seat state with seat 0 to move and `top` as the next deck card. */
function playing(top: Card): RatATatCatState {
  let s = startGame(2, 7);
  s = applyAction(s, { type: "INITIAL_PEEK_DONE", seat: 0 });
  s = applyAction(s, { type: "INITIAL_PEEK_DONE", seat: 1 });
  return { ...s, currentTurn: 0, turnPhase: "DRAW", deck: [top, ...s.deck.filter((c) => c.id !== top.id)] };
}

const kinds = (cues: ReturnType<typeof ratSoundCues>) => cues.map((c) => c.kind);

describe("sneak score", () => {
  it("tempo is 112 BPM, 126 once someone calls", () => {
    expect(sneakTempo(false)).toBe(SNEAK_BPM);
    expect(sneakTempo(true)).toBe(SNEAK_FINAL_BPM);
  });

  it("walking bass starts on D2 and the cat chime rings once per 4-bar loop", () => {
    expect(sneakEventsAt(0, false)).toContainEqual({ voice: "bass", freq: 73.42 });
    const chimes = Array.from({ length: LOOP_STEPS }, (_, s) => sneakEventsAt(s, false)).filter((ev) => ev.some((e) => e.voice === "chime"));
    expect(chimes).toHaveLength(1);
  });

  it("final lap chimes every bar and ticks the woodblock on eighth notes", () => {
    const chimes = Array.from({ length: LOOP_STEPS }, (_, s) => sneakEventsAt(s, true)).filter((ev) => ev.some((e) => e.voice === "chime"));
    expect(chimes).toHaveLength(LOOP_STEPS / STEPS_PER_BAR);
    const ticks = (finalLap: boolean) => Array.from({ length: STEPS_PER_BAR }, (_, s) => sneakEventsAt(s, finalLap)).filter((ev) => ev.some((e) => e.voice === "woodblock")).length;
    expect(ticks(false)).toBe(1);
    expect(ticks(true)).toBe(3);
  });

  it("loops", () => {
    expect(sneakEventsAt(LOOP_STEPS + 5, false)).toEqual(sneakEventsAt(5, false));
  });
});

describe("ratSoundCues", () => {
  it("a draw flutters for everyone", () => {
    const s0 = playing({ id: "x", kind: "number", value: 4 });
    const s1 = applyAction(s0, { type: "DRAW_CARD", seat: 0, source: "deck" });
    expect(kinds(ratSoundCues(s0, s1, 1))).toEqual(["draw"]);
  });

  it("replacing with a 0-2 rings the cat bell, 8-9 thuds, 3-7 is silent — and only for the replacer", () => {
    for (const [value, lowCat] of [[1, true], [9, false]] as const) {
      const s1 = applyAction(playing({ id: "x", kind: "number", value }), { type: "DRAW_CARD", seat: 0, source: "deck" });
      const s2 = applyAction(s1, { type: "REPLACE_CARD", seat: 0, slot: 1 });
      expect(ratSoundCues(s1, s2, 0)).toEqual([{ kind: "quality", lowCat }]);
      expect(ratSoundCues(s1, s2, 1)).toEqual([]);
    }
    const s1 = applyAction(playing({ id: "x", kind: "number", value: 5 }), { type: "DRAW_CARD", seat: 0, source: "deck" });
    expect(ratSoundCues(s1, applyAction(s1, { type: "REPLACE_CARD", seat: 0, slot: 1 }), 0)).toEqual([]);
  });

  it("using Swap / Draw 2 is heard, merely discarding them is not", () => {
    const swap = applyAction(playing({ id: "sw", kind: "swap" }), { type: "DRAW_CARD", seat: 0, source: "deck" });
    expect(kinds(ratSoundCues(swap, applyAction(swap, { type: "USE_SPECIAL_CARD", seat: 0, power: "swap", mySlot: 0, targetSeat: 1, targetSlot: 2 }), 1))).toEqual(["swap"]);
    expect(ratSoundCues(swap, applyAction(swap, { type: "DISCARD_CARD", seat: 0 }), 1)).toEqual([]);

    const d2 = applyAction(playing({ id: "d2", kind: "drawTwo" }), { type: "DRAW_CARD", seat: 0, source: "deck" });
    expect(kinds(ratSoundCues(d2, applyAction(d2, { type: "USE_SPECIAL_CARD", seat: 0, power: "drawTwo" }), 1))).toEqual(["drawTwo"]);
    expect(ratSoundCues(d2, applyAction(d2, { type: "DISCARD_CARD", seat: 0 }), 1)).toEqual([]);
  });

  it("the call is heard once", () => {
    const s1 = applyAction(playing({ id: "x", kind: "number", value: 5 }), { type: "DRAW_CARD", seat: 0, source: "deck" });
    const s2 = applyAction(s1, { type: "DISCARD_CARD", seat: 0 });
    const s3 = applyAction(s2, { type: "CALL_RAT_A_TAT_CAT", seat: 0 });
    expect(kinds(ratSoundCues(s2, s3, 1))).toEqual(["call"]);
    expect(ratSoundCues(s3, s3, 1)).toEqual([]);
  });
});
