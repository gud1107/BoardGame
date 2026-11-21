import { describe, expect, it } from "vitest";
import { WAVE_EVERY, WAVE_MS, latestPerLane, latestWave, spark, sparkCount, type Burst } from "./hitFx";

const b = (lane: number, judge: Burst["judge"], at: number, combo = 1): Burst => ({ lane, judge, at, combo });

describe("박자 난장판 타격 이펙트", () => {
  it("판정이 좋을수록 불꽃이 많고, 미스는 없다", () => {
    expect(sparkCount("perfect")).toBeGreaterThan(sparkCount("great"));
    expect(sparkCount("great")).toBeGreaterThan(sparkCount("good"));
    expect(sparkCount("miss")).toBe(0);
  });

  it("같은 버스트는 같은 불꽃 모양 (난수 없음), 끝에선 크기 0", () => {
    const x = b(1, "perfect", 1234.5);
    expect(spark(x, 3, 0.4)).toEqual(spark({ ...x }, 3, 0.4));
    const start = spark(x, 0, 0);
    expect(Math.abs(start.x) + Math.abs(start.y)).toBe(0);
    expect(spark(x, 5, 1).s).toBe(0);
  });

  it("줄마다 가장 최근 버스트를 고른다", () => {
    const per = latestPerLane([b(0, "good", 10), b(0, "perfect", 20), b(2, "great", 15)], 4);
    expect(per[0]?.judge).toBe("perfect");
    expect(per[1]).toBeNull();
    expect(per[2]?.judge).toBe("great");
  });

  it(`${WAVE_EVERY}콤보마다 물결, 수명이 지나면 사라짐`, () => {
    const list = [b(0, "perfect", 100, WAVE_EVERY - 1), b(1, "perfect", 200, WAVE_EVERY)];
    expect(latestWave(list, 300)?.combo).toBe(WAVE_EVERY);
    expect(latestWave(list, 200 + WAVE_MS + 1)).toBeNull();
    expect(latestWave([b(0, "great", 100, WAVE_EVERY + 1)], 150)).toBeNull();
  });
});
