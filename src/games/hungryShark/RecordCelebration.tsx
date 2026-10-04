"use client";

import { useEffect, useRef } from "react";
import { SharkAudio } from "./audio";

/**
 * Results-screen celebration when a dive breaks a record (or clears every
 * mission): a confetti + coin burst over the panel and a synthesized fanfare.
 * `big` = new map record (longer, three cannons + gold coins), otherwise a
 * shark personal best / all-missions clear. `missions` tints the confetti
 * mission-green and adds the mission chime.
 * Canvas-only overlay (pointer-events: none), cleaned up after ~3.5s.
 */
export default function RecordCelebration({ big, muted, missions = false }: { big: boolean; muted: boolean; missions?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (muted) return;
    // The dive's own audio context is gone with the canvas; the player has interacted, so a fresh one may start.
    const a = new SharkAudio();
    a.unlock(false);
    if (missions) a.mission();
    const f = window.setTimeout(() => a.fanfare(big), missions ? 320 : 0);
    const t = window.setTimeout(() => a.dispose(), 4000);
    return () => {
      window.clearTimeout(f);
      window.clearTimeout(t);
      a.dispose();
    };
  }, [big, muted, missions]);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const COLORS = missions && !big
      ? ["#4ade80", "#86efac", "#22c55e", "#facc15", "#ffffff", "#34d399"]
      : ["#facc15", "#38bdf8", "#f472b6", "#4ade80", "#fb923c", "#a78bfa", "#ffffff"];
    type P = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; color: string; coin: boolean; delay: number };
    const parts: P[] = [];
    const cannon = (x: number, dir: number, n: number, delay: number) => {
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + dir * (0.25 + Math.random() * 0.55);
        const sp = 520 + Math.random() * 520;
        const coin = big && Math.random() < 0.22;
        parts.push({
          x, y: H + 10, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 14,
          w: coin ? 9 : 6 + Math.random() * 5, h: coin ? 9 : 3 + Math.random() * 4,
          color: coin ? "#facc15" : COLORS[Math.floor(Math.random() * COLORS.length)], coin, delay: delay + Math.random() * 0.15,
        });
      }
    };
    cannon(W * 0.08, 1, big ? 90 : 60, 0);
    cannon(W * 0.92, -1, big ? 90 : 60, 0);
    if (big) cannon(W * 0.5, Math.random() < 0.5 ? 1 : -1, 70, 0.45);

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
        if (age < p.delay) { alive++; continue; }
        p.vy += 900 * dt;
        p.vx *= 1 - 1.2 * dt;
        p.vy *= 1 - 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 40 && p.vy > 0) continue;
        alive++;
        const fade = Math.max(0, Math.min(1, 3.4 - age));
        ctx.globalAlpha = fade;
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
  }, [big, missions]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full" />;
}
