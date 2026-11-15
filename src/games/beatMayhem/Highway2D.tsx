"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { GOOD_MS, JUDGE_INFO, LANES, LANE_COLORS } from "./data";
import type { StageShared } from "./three/StageScene";

/**
 * 2D 화면 — WebGL이 없거나 "2D 보기"를 고른 기기용 (룰북 §10).
 * 위에서 아래로 떨어지는 노트 4줄. 3D와 같은 `StageShared`를 읽는다.
 * 줄은 색뿐 아니라 위치와 아래 키 글자로 구분되고, 박자선이 한 박마다 내려온다.
 */
export default function Highway2D({ shared }: { shared: MutableRefObject<StageShared> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const sh = shared.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      if (!g) return;
      const now = performance.now();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#0b1020";
      g.fillRect(0, 0, w, h);
      const song = sh.song;
      const t = sh.time();
      const prank = sh.prank;
      const wob = prank?.kind === "wobble" ? Math.sin(now * 0.0052) * 0.12 * w * prank.k : 0;
      const trackW = Math.min(w * 0.92, 420);
      const laneW = trackW / LANES;
      const x0 = (w - trackW) / 2 + wob;
      const hitY = h * 0.78;
      const look = sh.lookahead * (prank?.kind === "rush" ? 1 - 0.42 * prank.k : 1);
      const yOf = (dt: number) => hitY - (dt / look) * hitY;
      // 줄
      for (let l = 0; l < LANES; l++) {
        const age = now - (sh.pressAt[l] ?? -1e9);
        const k = Math.max(0, 1 - age / 160);
        g.fillStyle = l % 2 ? "#111a33" : "#0e1630";
        g.fillRect(x0 + l * laneW, 0, laneW, h);
        if (k > 0) {
          g.fillStyle = LANE_COLORS[l];
          g.globalAlpha = 0.28 * k;
          g.fillRect(x0 + l * laneW, 0, laneW, h);
          g.globalAlpha = 1;
        }
      }
      g.strokeStyle = "rgba(255,255,255,0.25)";
      g.lineWidth = 1;
      for (let l = 0; l <= LANES; l++) {
        g.beginPath();
        g.moveTo(x0 + l * laneW, 0);
        g.lineTo(x0 + l * laneW, h);
        g.stroke();
      }
      if (song) {
        // 박자선
        const b0 = Math.max(0, Math.floor(t / song.beatMs));
        for (let b = b0; b < b0 + 12; b++) {
          const dt = b * song.beatMs - t;
          if (dt > look) break;
          g.strokeStyle = b % 4 === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.12)";
          g.beginPath();
          g.moveTo(x0, yOf(dt));
          g.lineTo(x0 + trackW, yOf(dt));
          g.stroke();
        }
        // 노트
        const tiny = prank?.kind === "tiny" ? prank.k : 0;
        const nh = Math.max(10, h * 0.03) * (1 - 0.6 * tiny);
        const nw = laneW * 0.84 * (1 - 0.6 * tiny);
        for (let i = 0; i < song.notes.length; i++) {
          const note = song.notes[i];
          const dt = note.t - t;
          if (dt < -GOOD_MS - 60) continue;
          if (dt > look) break;
          if (sh.hit[i] === 1) continue;
          const lane = sh.laneOf(i);
          const cx = x0 + (lane + 0.5) * laneW;
          g.fillStyle = LANE_COLORS[lane];
          g.globalAlpha = sh.hit[i] === 2 ? 0.3 : 1;
          g.beginPath();
          g.roundRect(cx - nw / 2, yOf(dt) - nh / 2, nw, nh, 5);
          g.fill();
          g.globalAlpha = 1;
        }
      }
      // 안개 장난
      if (prank?.kind === "fog") {
        g.fillStyle = `rgba(203,213,225,${0.97 * prank.k})`;
        g.fillRect(x0 - 6, 0, trackW + 12, hitY * 0.7);
      }
      // 판정선과 받침
      g.fillStyle = "#ffffff";
      g.fillRect(x0, hitY - 2, trackW, 4);
      for (let l = 0; l < LANES; l++) {
        const age = now - (sh.pressAt[l] ?? -1e9);
        const k = Math.max(0, 1 - age / 160);
        g.strokeStyle = LANE_COLORS[l];
        g.lineWidth = 3 + k * 4;
        g.strokeRect(x0 + l * laneW + 5, hitY - 14, laneW - 10, 28);
      }
      // 판정 효과
      sh.bursts = sh.bursts.filter((b) => now - b.at < 380).slice(-8);
      for (const b of sh.bursts) {
        const k = (now - b.at) / 380;
        g.strokeStyle = JUDGE_INFO[b.judge].color;
        g.globalAlpha = 1 - k;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x0 + (b.lane + 0.5) * laneW, hitY, 14 + k * 30, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
