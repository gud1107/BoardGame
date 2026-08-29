"use client";

import { useEffect, useRef } from "react";

/**
 * Canvas-based particle engine behind the round-result celebration's visual
 * renewal (Strict-No-Assumption Q&A, 2026-08-29 "결과 정산 연출 리뉴얼"
 * session — user picked "Canvas 기반 파티클" over pure CSS keyframes or a new
 * Framer Motion dependency for this specific bundle). Everything else in this
 * overlay (the stamp emblem, the winning-line neon border/scan sweep, the
 * skip button) stays plain CSS/HTML — only the free-floating "레이저 빔 +
 * 골드&다이아몬드 파티클" layer that this replaces (the old `GoldSunburst` +
 * `ConfettiBurst` in RoundResultOverlay.tsx) benefits from a real per-frame
 * particle simulation instead of a fixed set of DOM nodes.
 *
 * Mounts only from inside RoundResultOverlay.tsx, which itself only renders
 * once `typeof document !== "undefined"` (see that file's own guard) — so
 * this component is never part of a server-rendered pass, and using
 * `Math.random()` freely below (unlike RoundResultOverlay.tsx's own
 * deterministic `CONFETTI_PIECES` layout, kept only for its own DOM-node
 * approach) can never cause a hydration mismatch.
 *
 * `highTier` (category >= 5, i.e. 플러시 and above — the same threshold
 * GridPokerEffects.tsx's `HandRankFloatingBadge` already uses for its ✨
 * sparkle, confirmed as the cutoff for this canvas's diamond burst too) adds
 * one extra explosive burst of diamond-shaped particles on top of the gold
 * laser beams + shimmer every winner already gets.
 */
export interface ScoreEffectCanvasProps {
  highTier: boolean;
}

type ParticleKind = "gold" | "diamond";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  vr: number;
  kind: ParticleKind;
}

interface Beam {
  angle: number;
  speed: number;
  length: number;
  width: number;
  phase: number;
}

const BEAM_COUNT = 6;
const INITIAL_GOLD_SPARKS = 46;
const INITIAL_DIAMOND_SPARKS = 34;
const AMBIENT_SPAWN_INTERVAL_S = 0.16;
const GRAVITY = 70; // px/s^2, gentle — this is a firework/shimmer, not confetti fall

function makeBeams(): Beam[] {
  return Array.from({ length: BEAM_COUNT }, (_, i) => ({
    angle: (i / BEAM_COUNT) * Math.PI * 2,
    speed: 0.18 + (i % 3) * 0.07,
    length: 0.62 + (i % 2) * 0.14,
    width: 10 + (i % 3) * 6,
    phase: i * 0.9,
  }));
}

/** A firework-style radial spark — used for both the ambient gold trickle and the initial burst. */
function spawnRadialSpark(cx: number, cy: number, kind: ParticleKind, forceOutward: boolean): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = forceOutward ? 220 + Math.random() * 260 : 40 + Math.random() * 90;
  const maxLife = kind === "diamond" ? 0.9 + Math.random() * 0.5 : 1.1 + Math.random() * 0.9;
  return {
    x: cx,
    y: cy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - (forceOutward ? 0 : 30),
    life: maxLife,
    maxLife,
    size: kind === "diamond" ? 5 + Math.random() * 4 : 3 + Math.random() * 3,
    rotation: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 6,
    kind,
  };
}

/** Ambient trickle spark — drifts in from just above the visible area, same falling-shimmer feel the old CSS `ConfettiBurst` had, but generated continuously for as long as the overlay stays open instead of one fixed batch. */
function spawnAmbientSpark(width: number): Particle {
  const maxLife = 1.8 + Math.random() * 1.4;
  return {
    x: Math.random() * width,
    y: -10,
    vx: (Math.random() - 0.5) * 40,
    vy: 60 + Math.random() * 60,
    life: maxLife,
    maxLife,
    size: 2.5 + Math.random() * 2.5,
    rotation: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 4,
    kind: "gold",
  };
}

function drawGoldSpark(ctx: CanvasRenderingContext2D, p: Particle, alpha: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size * 2.4);
  g.addColorStop(0, "rgba(255,250,220,1)");
  g.addColorStop(0.35, "rgba(251,191,36,0.9)");
  g.addColorStop(1, "rgba(251,191,36,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, p.size * 2.4, 0, Math.PI * 2);
  ctx.fill();
  // Four-point glint cross, the "shimmer" read this project's plain circles didn't have.
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-p.size * 1.6, 0);
  ctx.lineTo(p.size * 1.6, 0);
  ctx.moveTo(0, -p.size * 1.6);
  ctx.lineTo(0, p.size * 1.6);
  ctx.stroke();
  ctx.restore();
}

function drawDiamondSpark(ctx: CanvasRenderingContext2D, p: Particle, alpha: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(165,243,252,0.9)";
  ctx.shadowBlur = 10;
  const s = p.size;
  const g = ctx.createLinearGradient(-s, -s, s, s);
  g.addColorStop(0, "rgba(255,255,255,0.98)");
  g.addColorStop(0.5, "rgba(165,243,252,0.9)");
  g.addColorStop(1, "rgba(56,189,248,0.85)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.5);
  ctx.lineTo(s, 0);
  ctx.lineTo(0, s * 1.5);
  ctx.lineTo(-s, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(251,191,36,0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export default function ScoreEffectCanvas({ highTier }: ScoreEffectCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      if (!canvas) return;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const beams = makeBeams();
    let particles: Particle[] = [];
    const cx = width / 2;
    const cy = height * 0.42; // slightly above center, roughly where the stamp/headline sit

    for (let i = 0; i < INITIAL_GOLD_SPARKS; i++) particles.push(spawnRadialSpark(cx, cy, "gold", true));
    if (highTier) {
      for (let i = 0; i < INITIAL_DIAMOND_SPARKS; i++) particles.push(spawnRadialSpark(cx, cy, "diamond", true));
    }

    let rafId: number;
    let last = performance.now();
    let ambientAccumulator = 0;

    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ambientAccumulator += dt;
      while (ambientAccumulator >= AMBIENT_SPAWN_INTERVAL_S) {
        ambientAccumulator -= AMBIENT_SPAWN_INTERVAL_S;
        particles.push(spawnAmbientSpark(width));
      }

      ctx!.clearRect(0, 0, width, height);

      // Gold laser streak beams — additive-blended rotating blades from
      // center, replacing the old static `GoldSunburst` conic-gradient wheel
      // with something that actually reads as sweeping light.
      ctx!.save();
      ctx!.globalCompositeOperation = "lighter";
      for (const b of beams) {
        const angle = b.angle + now * 0.00012 * (1 + b.speed);
        const pulse = 0.35 + 0.35 * Math.sin(now * 0.0016 + b.phase);
        const len = Math.max(width, height) * b.length;
        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.rotate(angle);
        const grad = ctx!.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0, `rgba(255,238,180,${0.55 * pulse})`);
        grad.addColorStop(0.15, `rgba(251,191,36,${0.4 * pulse})`);
        grad.addColorStop(1, "rgba(251,191,36,0)");
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.moveTo(0, -b.width / 2);
        ctx!.lineTo(len, 0);
        ctx!.lineTo(0, b.width / 2);
        ctx!.closePath();
        ctx!.fill();
        ctx!.restore();
      }
      ctx!.restore();

      // Sparks — update, cull the dead, draw the living.
      const next: Particle[] = [];
      for (const p of particles) {
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.vr * dt;
        p.life -= dt;
        if (p.life <= 0 || p.y > height + 30) continue;
        const alpha = Math.min(1, p.life / (p.maxLife * 0.4));
        if (p.kind === "diamond") drawDiamondSpark(ctx!, p, alpha);
        else drawGoldSpark(ctx!, p, alpha);
        next.push(p);
      }
      particles = next;

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
    // Mount-only: this canvas lives exactly as long as RoundResultOverlay
    // does (unmounts the instant the phase leaves "round-result", whether via
    // the host's timer or the skip button/double-tap — see
    // RoundResultOverlay.tsx's module doc), so there is nothing to react to
    // mid-life; `highTier` is fixed for the whole mount (one canvas per round
    // result).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
