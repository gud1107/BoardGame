import { describe, expect, it } from "vitest";
import { analyzeDrop } from "./DropOffTab";
import { roomStatus } from "./RoomsTab";

describe("analyzeDrop", () => {
  it("finds the step that loses the largest share", () => {
    expect(analyzeDrop([100, 40, 30])).toEqual({ worstStep: 1, worstLossPct: 0.6 });
    expect(analyzeDrop([10, 9, 3]).worstStep).toBe(2);
  });

  it("ignores steps with nobody before them", () => {
    expect(analyzeDrop([0, 0, 0])).toEqual({ worstStep: -1, worstLossPct: 0 });
  });
});

describe("roomStatus", () => {
  it("labels rooms by how far they got", () => {
    expect(roomStatus({ starts: 0, ends: 0 })).toBe("시작 안 함");
    expect(roomStatus({ starts: 2, ends: 2 })).toBe("완료");
    expect(roomStatus({ starts: 2, ends: 1 })).toBe("진행 중/중단");
  });
});
