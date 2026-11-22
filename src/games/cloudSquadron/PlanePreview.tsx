"use client";

import { useEffect, useRef } from "react";
import { drawEngines, drawSprite, planeSprite } from "./art";
import type { PilotId } from "./data";

/** 조종사 고르기 화면의 기체 미리보기 (살짝 떠다니며 엔진이 타오른다) */
export default function PlanePreview({ id, size = 72, still = false }: { id: PilotId; size?: number; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * d;
    cv.height = size * d;
    let raf = 0;
    const draw = (now: number) => {
      g.setTransform((size * d) / 90, 0, 0, (size * d) / 90, 0, 0);
      g.clearRect(0, 0, 90, 90);
      const bob = still ? 0 : Math.sin(now * 0.002) * 2;
      drawEngines(g, id, 45, 42 + bob, now);
      drawSprite(g, planeSprite(id), 45, 42 + bob, 1);
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [id, size, still]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}
