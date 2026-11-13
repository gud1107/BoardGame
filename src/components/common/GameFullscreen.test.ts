import { describe, expect, it } from "vitest";
import { fullscreenZoom } from "./GameFullscreen";

describe("fullscreenZoom", () => {
  it("never shrinks below 1 (phones, small windows)", () => {
    expect(fullscreenZoom(390, 844, 672)).toBe(1);
    expect(fullscreenZoom(844, 390, 672)).toBe(1);
    expect(fullscreenZoom(1280, 720, 672)).toBe(1);
  });
  it("scales with resolution, bounded by height", () => {
    expect(fullscreenZoom(1920, 1080, 672)).toBeCloseTo(1.38, 2);
    expect(fullscreenZoom(2560, 1440, 672)).toBeCloseTo(1.84, 2);
    expect(fullscreenZoom(1440, 900, 672)).toBeCloseTo(1.15, 2);
  });
  it("is bounded by width for wide columns and capped at 2", () => {
    expect(fullscreenZoom(1920, 1080, 1536)).toBeCloseTo(1.23, 2);
    expect(fullscreenZoom(5120, 2880, 672)).toBe(2);
  });
});
