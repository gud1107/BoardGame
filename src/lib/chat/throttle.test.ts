import { describe, expect, it } from "vitest";
import {
  checkThrottle,
  recordSend,
  INITIAL_THROTTLE_STATE,
  type ThrottleState,
} from "./throttle";

function sendN(state: ThrottleState, times: number[]): ThrottleState {
  let s = state;
  for (const t of times) s = recordSend(s, t);
  return s;
}

describe("checkThrottle / recordSend", () => {
  it("allows sends with no history", () => {
    expect(checkThrottle(INITIAL_THROTTLE_STATE, 0).ok).toBe(true);
  });

  it("allows up to 2 rapid sends within 1s", () => {
    const s = sendN(INITIAL_THROTTLE_STATE, [0, 200]);
    expect(checkThrottle(s, 250).ok).toBe(true);
  });

  it("locks out for 3s after a 3rd send within 1s", () => {
    const s = sendN(INITIAL_THROTTLE_STATE, [0, 200, 400]);
    const check = checkThrottle(s, 401);
    expect(check.ok).toBe(false);
    expect(check.lockedUntil).toBe(400 + 3_000);
  });

  it("unlocks once the 3s lockout elapses", () => {
    const s = sendN(INITIAL_THROTTLE_STATE, [0, 200, 400]);
    expect(checkThrottle(s, 400 + 3_000).ok).toBe(true);
  });

  it("does not trigger when 3 sends are spread out beyond the 1s window", () => {
    const s = sendN(INITIAL_THROTTLE_STATE, [0, 600, 1300]);
    expect(checkThrottle(s, 1301).ok).toBe(true);
  });
});
