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

import { monthOverMonth } from "./MonthlyTab";

describe("monthOverMonth", () => {
  it("formats the change against last month", () => {
    expect(monthOverMonth(15, 10)).toEqual({ text: "▲ 50%", up: true });
    expect(monthOverMonth(5, 10)).toEqual({ text: "▼ 50%", up: false });
    expect(monthOverMonth(10, 10)).toEqual({ text: "±0%", up: null });
  });

  it("marks a first month as new and an empty pair as nothing", () => {
    expect(monthOverMonth(3, 0)).toEqual({ text: "신규", up: true });
    expect(monthOverMonth(0, 0)).toBeNull();
  });
});

import { timeAgo } from "../LabeledActivityPanel";

describe("timeAgo", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("reads like a notification", () => {
    expect(timeAgo("2026-10-02T11:59:40Z", now)).toBe("방금");
    expect(timeAgo("2026-10-02T11:48:00Z", now)).toBe("12분 전");
    expect(timeAgo("2026-10-02T09:00:00Z", now)).toBe("3시간 전");
  });
});

import { makeTopic } from "../AlertSettingsPanel";

describe("makeTopic", () => {
  it("makes a long random topic the database will accept", () => {
    const a = makeTopic();
    expect(a).toMatch(/^bghub-[a-z0-9]{20}$/);
    expect(a).toMatch(/^[A-Za-z0-9_-]{12,64}$/);
    expect(makeTopic()).not.toBe(a);
  });
});
