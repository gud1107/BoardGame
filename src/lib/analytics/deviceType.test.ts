import { describe, expect, it } from "vitest";
import { detectDeviceType } from "./deviceType";

describe("detectDeviceType", () => {
  it("returns 'unknown' for a missing user-agent", () => {
    expect(detectDeviceType(undefined)).toBe("unknown");
    expect(detectDeviceType(null)).toBe("unknown");
    expect(detectDeviceType("")).toBe("unknown");
  });

  it("classifies iPhone/Android-mobile user-agents as 'mobile'", () => {
    expect(detectDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(detectDeviceType("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
  });

  it("classifies iPad/tablet-Android user-agents as 'tablet'", () => {
    expect(detectDeviceType("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(detectDeviceType("Mozilla/5.0 (Linux; Android 14; SM-X910) Safari")).toBe("tablet");
  });

  it("classifies a plain desktop user-agent as 'desktop'", () => {
    expect(detectDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0")).toBe("desktop");
  });
});
