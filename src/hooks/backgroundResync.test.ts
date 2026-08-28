import { describe, expect, it } from "vitest";
import { INITIAL_BACKGROUND_RESYNC_STATE, LONG_ABSENCE_MS, reduceBackgroundResync } from "./backgroundResync";

describe("reduceBackgroundResync", () => {
  it("does not resync on hidden", () => {
    const r = reduceBackgroundResync(INITIAL_BACKGROUND_RESYNC_STATE, { type: "hidden", at: 1000 });
    expect(r.shouldResync).toBe(false);
    expect(r.state.hiddenAt).toBe(1000);
  });

  it("resyncs on visible after a short absence, not flagged as long", () => {
    const hidden = reduceBackgroundResync(INITIAL_BACKGROUND_RESYNC_STATE, { type: "hidden", at: 1000 }).state;
    const r = reduceBackgroundResync(hidden, { type: "visible", at: 1000 + 5_000 });
    expect(r.shouldResync).toBe(true);
    expect(r.longAbsence).toBe(false);
    expect(r.state.hiddenAt).toBe(null);
  });

  it("flags a long absence at exactly the threshold", () => {
    const hidden = reduceBackgroundResync(INITIAL_BACKGROUND_RESYNC_STATE, { type: "hidden", at: 0 }).state;
    const r = reduceBackgroundResync(hidden, { type: "visible", at: LONG_ABSENCE_MS });
    expect(r.shouldResync).toBe(true);
    expect(r.longAbsence).toBe(true);
  });

  it("flags a long absence well past the threshold", () => {
    const hidden = reduceBackgroundResync(INITIAL_BACKGROUND_RESYNC_STATE, { type: "hidden", at: 0 }).state;
    const r = reduceBackgroundResync(hidden, { type: "visible", at: LONG_ABSENCE_MS + 60_000 });
    expect(r.longAbsence).toBe(true);
  });

  it("ignores a visible event when never marked hidden (duplicate focus)", () => {
    const r = reduceBackgroundResync(INITIAL_BACKGROUND_RESYNC_STATE, { type: "visible", at: 100 });
    expect(r.shouldResync).toBe(false);
    expect(r.state).toEqual(INITIAL_BACKGROUND_RESYNC_STATE);
  });

  it("keeps the earliest hiddenAt across duplicate hidden signals (visibilitychange + blur)", () => {
    const first = reduceBackgroundResync(INITIAL_BACKGROUND_RESYNC_STATE, { type: "hidden", at: 500 }).state;
    const second = reduceBackgroundResync(first, { type: "hidden", at: 800 });
    expect(second.state.hiddenAt).toBe(500);
    expect(second.shouldResync).toBe(false);
  });

  it("ignores a duplicate visible signal after the first already resynced (visibilitychange + focus)", () => {
    const hidden = reduceBackgroundResync(INITIAL_BACKGROUND_RESYNC_STATE, { type: "hidden", at: 0 }).state;
    const first = reduceBackgroundResync(hidden, { type: "visible", at: 100 });
    const second = reduceBackgroundResync(first.state, { type: "visible", at: 150 });
    expect(second.shouldResync).toBe(false);
  });
});
