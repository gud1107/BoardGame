import { describe, expect, it } from "vitest";
import { slot, tokenBox } from "./oxLayout";

// 광장 실제 크기: 휴대폰 390px 화면(양옆 여백 뺀 폭 ~354px, h-72) · PC(폭 ~716px, sm:h-80)
const FIELDS: [number, number][] = [
  [354, 288],
  [716, 320],
];

const overlap = (a: ReturnType<typeof tokenBox>, b: ReturnType<typeof tokenBox>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

describe("OX plaza layout — 8 players never overlap (§4)", () => {
  for (const [w, h] of FIELDS) {
    for (const zone of [0, 1, null] as const) {
      it(`all 8 in ${zone === null ? "the middle" : zone === 0 ? "⭕" : "❌"} at ${w}×${h}, whichever seat is me`, () => {
        for (let me = 0; me < 8; me++) {
          const boxes = Array.from({ length: 8 }, (_, s) => tokenBox(slot(s, zone), w, h, s === me));
          for (const b of boxes) {
            expect(b.t).toBeGreaterThanOrEqual(0);
            expect(b.b).toBeLessThanOrEqual(h);
            expect(b.l).toBeGreaterThanOrEqual(0);
            expect(b.r).toBeLessThanOrEqual(w);
          }
          // 구역 안 말은 가운데 선을 넘지 않는다(어느 쪽인지 헷갈리지 않게)
          if (zone !== null) for (const b of boxes) expect(zone === 0 ? b.r <= w / 2 : b.l >= w / 2).toBe(true);
          for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) expect(overlap(boxes[i], boxes[j]), `seat ${i} vs ${j} (me ${me})`).toBe(false);
        }
      });
    }
  }
});
