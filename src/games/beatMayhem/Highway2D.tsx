"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { GOOD_MS, JUDGE_INFO, LANES, LANE_COLORS } from "./data";
import type { StageShared } from "./three/StageScene";
import { BEAM_MS, FX_LIFE_MS, RING_MS, WAVE_MS, latestPerLane, latestWave, spark, sparkCount } from "./hitFx";

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
      // 판정 효과 — 칠 때마다: 빛기둥 + 고리 + 불꽃 + 판정선 번쩍 + 25콤보 물결
      sh.bursts = sh.bursts.filter((b) => now - b.at < WAVE_MS).slice(-12);
      const fx = sh.fx;
      if (fx !== "off") {
        const per = latestPerLane(sh.bursts, LANES);
        g.globalCompositeOperation = "lighter";
        for (let l = 0; l < LANES; l++) {
          const b = per[l];
          if (!b) continue;
          const k = (now - b.at) / BEAM_MS;
          if (k >= 1) continue;
          const tall = (b.judge === "perfect" ? 1 : b.judge === "great" ? 0.75 : 0.5) * hitY * 0.85 * (0.6 + k * 0.6);
          const bw = laneW * 0.8 * (1 - k * 0.5);
          const cx = x0 + (l + 0.5) * laneW;
          const grad = g.createLinearGradient(0, hitY, 0, hitY - tall);
          grad.addColorStop(0, JUDGE_INFO[b.judge].color);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = grad;
          g.globalAlpha = 0.6 * (1 - k) * (fx === "lite" ? 0.6 : 1);
          g.fillRect(cx - bw / 2, hitY - tall, bw, tall);
        }
        g.globalAlpha = 1;
        const last = sh.bursts[sh.bursts.length - 1];
        const lk = last ? Math.max(0, 1 - (now - last.at) / 180) : 0;
        if (lk > 0) {
          g.fillStyle = JUDGE_INFO[last.judge].color;
          g.globalAlpha = 0.7 * lk;
          g.fillRect(x0, hitY - 2 - lk * 5, trackW, 4 + lk * 10);
          g.globalAlpha = 1;
        }
        g.globalCompositeOperation = "source-over";
      }
      for (const b of sh.bursts) {
        const k = (now - b.at) / RING_MS;
        if (k >= 1) continue;
        g.strokeStyle = JUDGE_INFO[b.judge].color;
        g.globalAlpha = 1 - k;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x0 + (b.lane + 0.5) * laneW, hitY, (14 + k * 30) * (b.judge === "perfect" && fx === "full" ? 1.25 : 1), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      if (fx === "full") {
        for (const b of sh.bursts) {
          const k = (now - b.at) / FX_LIFE_MS;
          if (k >= 1) continue;
          const cx = x0 + (b.lane + 0.5) * laneW;
          g.fillStyle = JUDGE_INFO[b.judge].color;
          for (let i = 0; i < sparkCount(b.judge); i++) {
            const p = spark(b, i, k);
            g.globalAlpha = Math.min(1, p.s * 1.4);
            g.beginPath();
            g.arc(cx + p.x * laneW, hitY - p.y * laneW * 1.1, 1.5 + p.s * 3.5, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.globalAlpha = 1;
      }
      const wv = fx === "off" ? null : latestWave(sh.bursts, now);
      if (wv) {
        const k = (now - wv.at) / WAVE_MS;
        g.strokeStyle = "#fde047";
        g.globalAlpha = 0.8 * (1 - k);
        g.lineWidth = 5 * (1 - k) + 1;
        g.beginPath();
        g.ellipse(x0 + trackW / 2, hitY, 20 + k * trackW * 0.9, 8 + k * hitY * 0.5, 0, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
