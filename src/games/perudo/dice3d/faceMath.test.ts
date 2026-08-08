import { describe, expect, it } from "vitest";
import { isFaceUp, quaternionForFaceUp } from "./faceMath";

describe("quaternionForFaceUp", () => {
  it("puts every face (1-6) up under its own forced quaternion", () => {
    for (let face = 1; face <= 6; face++) {
      expect(isFaceUp(face, quaternionForFaceUp(face))).toBe(true);
    }
  });

  it("still puts the face up after an arbitrary yaw spin (yaw only rotates around the vertical axis)", () => {
    for (let face = 1; face <= 6; face++) {
      for (const yaw of [0.3, Math.PI / 2, Math.PI, 4.2]) {
        expect(isFaceUp(face, quaternionForFaceUp(face, yaw))).toBe(true);
      }
    }
  });

  it("does not also put a different face up", () => {
    const quat = quaternionForFaceUp(3);
    expect(isFaceUp(3, quat)).toBe(true);
    for (const other of [1, 2, 4, 5, 6]) {
      expect(isFaceUp(other, quat)).toBe(false);
    }
  });

  it("rejects an invalid face", () => {
    expect(() => quaternionForFaceUp(0)).toThrow();
    expect(() => quaternionForFaceUp(7)).toThrow();
  });
});
