import { describe, expect, it } from "vitest";
import { BADGE_BOTTOM_PX, slot, tokenBox } from "./oxLayout";

// 광장 실제 크기(운영 캡처 실측): 휴대폰 390px 화면 358×288(h-72) · PC 716×320(sm:h-80)
const FIELDS: [number, number][] = [
  [358, 288],
  [716, 320],
];

const overlap = (a: ReturnType<typeof tokenBox>, b: ReturnType<typeof tokenBox>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

describe("OX plaza layout — 8 players never overlap (§4)", () => {
  for (const [w, h] of FIELDS) {
    it(`every mix of ⭕ / ❌ / undecided for 8 players at ${w}×${h}, whichever seat is me`, () => {
      // 3^8 = 6561가지 배치 × 내 자리 8곳
      for (let code = 0; code < 3 ** 8; code++) {
        const zones = Array.from({ length: 8 }, (_, s) => {
          const d = Math.floor(code / 3 ** s) % 3;
          return d === 2 ? null : d;
        });
        for (let me = 0; me < 8; me++) {
          const boxes = zones.map((z, s) => tokenBox(slot(s, z), w, h, s === me));
          for (let i = 0; i < 8; i++) {
            const b = boxes[i];
            if (b.t < BADGE_BOTTOM_PX || b.b > h || b.l < 0 || b.r > w) throw new Error(`seat ${i} out of bounds (zones ${zones.join()} me ${me})`);
            // 구역 안 말은 가운데 선을 넘지 않는다(어느 쪽인지 헷갈리지 않게)
            if (zones[i] === 0 && b.r > w / 2) throw new Error(`seat ${i} crosses the line`);
            if (zones[i] === 1 && b.l < w / 2) throw new Error(`seat ${i} crosses the line`);
            for (let j = i + 1; j < 8; j++) if (overlap(b, boxes[j])) throw new Error(`seat ${i} vs ${j} overlap (zones ${zones.join()} me ${me})`);
          }
        }
      }
      expect(true).toBe(true);
    });
  }
});
