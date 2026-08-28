import { describe, expect, it } from "vitest";
import { reduceGameLeaveGuard, type GameLeaveGuardState } from "./gameLeaveGuard";

function run(state: GameLeaveGuardState, events: Parameters<typeof reduceGameLeaveGuard>[1][]): GameLeaveGuardState {
  let s = state;
  for (const e of events) s = reduceGameLeaveGuard(s, e);
  return s;
}

describe("reduceGameLeaveGuard", () => {
  it("opens on a popstate (intercepted back gesture)", () => {
    expect(reduceGameLeaveGuard("closed", "popstate")).toBe("open");
  });

  it("closes again on cancel (계속하기)", () => {
    expect(run("closed", ["popstate", "cancel"])).toBe("closed");
  });

  it("closes on confirm (나가기) — caller fires onLeave separately", () => {
    expect(run("closed", ["popstate", "confirm"])).toBe("closed");
  });

  it("repeated popstates while already open stay open", () => {
    expect(run("closed", ["popstate", "popstate"])).toBe("open");
  });
});
