"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { buildCourse } from "./course";
import { CRUMBLY, LEDGE, OVERHANG, ROPE_LEN, SEAT_COLORS, SEAT_SYMBOLS, SMOOTH, WALL_W } from "./data";
import type { SceneShared } from "./three/WallScene";

/**
 * 2D 정면 화면 — WebGL이 없거나 "2D 보기"를 고른 기기용 (룰북 §10).
 * 3D와 같은 스냅샷 버퍼를 읽어 캔버스에 그린다. 이름표는 보드의 DOM 이름표를 그대로 쓴다.
 * 색만으로 알리지 않는다: 매끈한 암반 = 빗금, 부서지는 바위 = ✕, 오버행 = ▼, 턱 = 굵은 선반.
 */
export default function Wall2D({ shared }: { shared: MutableRefObject<SceneShared> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const cam = { cx: 0, cy: 3, half: 6, init: false };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const sh = shared.current;
      const snap = sh.buf.latest();
      if (!cv || !snap) return;
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
      const course = buildCourse(snap.seed, snap.options.course);
      const pal =
        snap.options.course === "ice"
          ? { sky: "#bfe0f7", rock: "#7090a8", smooth: "#e6f7ff", ledge: "#ffffff", crumbly: "#a7bccb", over: "#42607a", hole: "#2c4256", ink: "#1f3447" }
          : snap.options.course === "volcano"
            ? { sky: "#6b3a30", rock: "#62504a", smooth: "#1c181a", ledge: "#d3623f", crumbly: "#8f5c3c", over: "#2e2523", hole: "#120e0e", ink: "#ffb27a" }
            : { sky: "#bfe6fb", rock: "#8f8477", smooth: "#d9d2c4", ledge: "#6aa84f", crumbly: "#a8744a", over: "#5f574f", hole: "#3b352f", ink: "#3a332b" };
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = pal.sky;
      g.fillRect(0, 0, w, h);
      // 카메라: 모두가 들어오게, 위쪽을 더 넓게
      const poses = snap.players.map((p) => sh.buf.pose(p.seat, sh.mySeat, now) ?? { x: p.x, y: p.y });
      const minY = Math.min(...poses.map((p) => p.y));
      const maxY = Math.max(...poses.map((p) => p.y));
      const minX = Math.min(...poses.map((p) => p.x));
      const maxX = Math.max(...poses.map((p) => p.x));
      const top = maxY + 4.2;
      const bottom = minY - 2.2;
      const half = Math.max(4.6, (top - bottom) / 2, (Math.max(4.2, (maxX - minX) / 2 + 2.6) * h) / Math.max(1, w));
      const k = cam.init ? 0.12 : 1;
      cam.init = true;
      cam.cx += ((minX + maxX) / 2 - cam.cx) * k;
      cam.cy += ((top + bottom) / 2 - cam.cy) * k;
      cam.half += (half - cam.half) * k;
      const scale = h / (cam.half * 2);
      const jx = sh.shake > 0 ? Math.sin(now * 0.09) * 6 * sh.shake : 0;
      sh.shake = Math.max(0, sh.shake - 0.03);
      const X = (x: number) => w / 2 + (x - cam.cx * 0.6) * scale + jx;
      const Y = (y: number) => h / 2 - (y - cam.cy) * scale;
      const gone = new Set(snap.gone);
      const crumb = new Set(snap.crumb.map((c) => c.i));
      const r0 = Math.max(0, Math.floor(cam.cy - cam.half) - 1);
      const r1 = Math.min(course.height, Math.ceil(cam.cy + cam.half) + 1);
      g.lineWidth = Math.max(1, scale * 0.05);
      for (let r = r0; r <= r1; r++)
        for (let c = 0; c < WALL_W; c++) {
          const i = r * WALL_W + c;
          const dead = gone.has(i);
          const v = dead ? SMOOTH : course.cells[i];
          const x = X(c - WALL_W / 2);
          const y = Y(r + 1);
          g.fillStyle = dead ? pal.hole : v === SMOOTH ? pal.smooth : v === CRUMBLY ? (crumb.has(i) ? "#e0603c" : pal.crumbly) : v === OVERHANG ? pal.over : pal.rock;
          g.fillRect(x, y, scale + 0.5, scale + 0.5);
          g.strokeStyle = "rgba(0,0,0,0.12)";
          g.strokeRect(x, y, scale, scale);
          g.strokeStyle = pal.ink;
          g.fillStyle = pal.ink;
          if (v === SMOOTH && !dead) {
            g.globalAlpha = 0.35;
            g.beginPath();
            g.moveTo(x + scale * 0.15, y + scale * 0.85);
            g.lineTo(x + scale * 0.85, y + scale * 0.15);
            g.stroke();
            g.globalAlpha = 1;
          } else if (v === CRUMBLY) {
            g.beginPath();
            g.moveTo(x + scale * 0.3, y + scale * 0.3);
            g.lineTo(x + scale * 0.7, y + scale * 0.7);
            g.moveTo(x + scale * 0.7, y + scale * 0.3);
            g.lineTo(x + scale * 0.3, y + scale * 0.7);
            g.stroke();
          } else if (v === OVERHANG) {
            g.beginPath();
            g.moveTo(x + scale * 0.28, y + scale * 0.35);
            g.lineTo(x + scale * 0.72, y + scale * 0.35);
            g.lineTo(x + scale * 0.5, y + scale * 0.7);
            g.closePath();
            g.fill();
          } else if (v === LEDGE) {
            g.fillStyle = pal.ledge;
            g.fillRect(x, y + scale * 0.8, scale + 0.5, scale * 0.2);
          }
        }
      // 정상 깃발
      g.fillStyle = "#ef4444";
      g.fillRect(X(0), Y(course.height + 1.9), scale * 0.8, scale * 0.5);
      g.fillStyle = "#f8fafc";
      g.fillRect(X(0) - 2, Y(course.height + 1.9), 3, scale * 1.75);
      // 별
      g.font = `${Math.round(scale * 0.7)}px sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      course.stars.forEach((s, i) => {
        if (!snap.stars[i]) g.fillText("⭐", X(s.x), Y(s.y));
      });
      // 낙석 (경고 기둥 + 돌)
      const simNow = sh.buf.simNow(now);
      for (const r of snap.rocks) {
        g.fillStyle = `rgba(255,59,48,${simNow >= r.fallAt ? 0.14 : 0.16 + 0.14 * Math.sin(now * 0.02)})`;
        g.fillRect(X(r.x - 0.55), 0, scale * 1.1, h);
        if (simNow >= r.fallAt) {
          g.fillStyle = pal.over;
          g.beginPath();
          g.arc(X(r.x), Y(r.y), scale * 0.5, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = "#fff";
          g.stroke();
        } else {
          g.fillStyle = "#ff3b30";
          g.font = `bold ${Math.round(scale * 0.9)}px sans-serif`;
          g.fillText("!", X(r.x), 22);
        }
      }
      // 줄
      for (let i = 0; i < snap.ropes.length; i++) {
        const a = poses[i];
        const b = poses[i + 1];
        const L = snap.ropes[i] ?? ROPE_LEN;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const sag = d < L - 0.05 ? Math.min(2.4, 0.45 * Math.sqrt(Math.max(0, L * L - d * d))) : 0;
        g.strokeStyle = snap.taut[i] ? "#ff7a2f" : "#f5e6c8";
        g.lineWidth = Math.max(2, scale * 0.09);
        if (snap.taut[i]) g.setLineDash([]);
        else g.setLineDash([scale * 0.25, scale * 0.12]);
        g.beginPath();
        g.moveTo(X(a.x), Y(a.y));
        g.quadraticCurveTo(X((a.x + b.x) / 2), Y((a.y + b.y) / 2 - sag), X(b.x), Y(b.y));
        g.stroke();
        g.setLineDash([]);
      }
      // 사람
      snap.players.forEach((p, i) => {
        const b = poses[i];
        g.fillStyle = SEAT_COLORS[p.seat % 4];
        g.beginPath();
        g.arc(X(b.x), Y(b.y), scale * 0.38, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = p.seat === sh.mySeat ? 3 : 1.5;
        g.strokeStyle = p.mode === "air" ? "#ff3b30" : "#fff";
        g.stroke();
        g.fillStyle = "#111";
        g.font = `bold ${Math.round(scale * 0.42)}px sans-serif`;
        g.fillText(SEAT_SYMBOLS[p.seat % 4], X(b.x), Y(b.y) + 1);
      });
      // 돌풍
      if (snap.wind && simNow >= snap.wind.from) {
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.lineWidth = 2;
        for (let i = 0; i < 10; i++) {
          const ph = (now * 0.0014 + i * 0.37) % 1;
          const x = snap.wind.dir > 0 ? ph * w : w - ph * w;
          const y = ((i * 97) % h) + 10;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - snap.wind.dir * 46, y);
          g.stroke();
        }
      }
      // 이름표
      for (let seat = 0; seat < sh.labels.length; seat++) {
        const el = sh.labels[seat];
        if (!el) continue;
        const b = poses[seat];
        if (!b) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.transform = `translate(${X(b.x).toFixed(1)}px, ${(Y(b.y) - scale * 0.5).toFixed(1)}px) translate(-50%, -100%)`;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shared]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
