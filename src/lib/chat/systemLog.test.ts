import { describe, expect, it } from "vitest";
import { formatDalmutiTributeLog, formatPerudoRaiseLog } from "./systemLog";

describe("formatPerudoRaiseLog", () => {
  it("formats a raise into the spec's example line", () => {
    expect(formatPerudoRaiseLog("지수", 3, 1)).toBe("지수님이 1번 주사위를 3개 베팅했습니다");
  });
});

describe("formatDalmutiTributeLog", () => {
  it("formats a tribute exchange into the spec's example line", () => {
    expect(formatDalmutiTributeLog("민준", "거지", "지수", "왕")).toBe(
      "거지(민준)와 왕(지수)가 카드를 교환했습니다",
    );
  });
});
