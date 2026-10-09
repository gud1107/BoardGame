"use client";

import { useEffect, useRef } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";

/**
 * Results-screen burst for a broken map record: two confetti cannons plus a
 * late gold-coin shot from the middle, and the shared finish fanfare. Canvas
 * overlay (click-through) that clears itself after ~3.5s; reduced motion keeps
 * only the sound.
 */
export default function RecordBurst() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    getSoundEngine().playFinishFanfare();
  }, []);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const COLORS = ["#facc15", "#fb923c", "#f472b6", "#a78bfa", "#38bdf8", "#4ade80", "#ffffff"];
    type P = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; color: string; coin: boolean; delay: number };
    const parts: P[] = [];
    const cannon = (x: number, dir: number, n: number, delay: number, coins: number) => {
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + dir * (0.2 + Math.random() * 0.5);
        const sp = 480 + Math.random() * 520;
        const coin = Math.random() < coins;
        parts.push({
          x,
          y: H + 10,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 14,
          w: coin ? 10 : 6 + Math.random() * 5,
          h: coin ? 10 : 3 + Math.random() * 4,
          color: coin ? "#facc15" : COLORS[Math.floor(Math.random() * COLORS.length)],
          coin,
          delay: delay + Math.random() * 0.15,
        });
      }
    };
    cannon(W * 0.08, 1, 80, 0, 0.1);
    cannon(W * 0.92, -1, 80, 0, 0.1);
    cannon(W * 0.5, Math.random() < 0.5 ? 1 : -1, 60, 0.45, 0.5);

    let raf = 0;
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const age = (now - start) / 1000;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        if (age < p.delay) {
          alive++;
          continue;
        }
        p.vy += 900 * dt;
        p.vx *= 1 - 1.2 * dt;
        p.vy *= 1 - 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 40 && p.vy > 0) continue;
        alive++;
        ctx.globalAlpha = Math.max(0, Math.min(1, 3.4 - age));
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.coin) {
          ctx.scale(Math.abs(Math.cos(p.rot)), 1);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#a16207";
          ctx.fillRect(-1, -p.w / 4, 2, p.w / 2);
        } else {
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (alive > 0 && age < 3.6) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full" />;
}
