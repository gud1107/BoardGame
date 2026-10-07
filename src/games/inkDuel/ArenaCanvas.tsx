"use client";

import { useEffect, useRef } from "react";
import { INK_COLORS, MAX_POINTS_PER_STROKE, strokeInk, totalInk, type InkColor, type Stroke } from "./analyze";
import { WALL_RANGE, type InkDuelState, type InkEvent } from "./engine";
import { GRAVITY, launchVelocity, MUZZLE_Y, surfaceY, WORLD_H, WORLD_W, type Wall } from "./physics";
import { playImpactSound, playLaunchSound } from "./inkDuelAudio";

export const SEAT_COLORS = ["#7c3aed", "#ea580c", "#0d9488", "#db2777"];
export const CARD_MS = 1300;
const FRAME_MS = 12;
const IMPACT_MS = 1400;

type ShotEvent = Extract<InkEvent, { kind: "shot" }>;

export interface ArenaAnim {
  event: ShotEvent;
  base: InkDuelState;
  target: InkDuelState;
}

export interface WallDraft {
  strokes: Stroke[];
  color: InkColor;
  budget: number;
  error: string | null;
  onChange: (strokes: Stroke[]) => void;
}

interface Props {
  view: InkDuelState;
  anim: ArenaAnim | null;
  onAnimDone: () => void;
  names: Record<number, string>;
  turnSeat: number | null;
  /** Aim preview for the seat about to fire (viewer's own turn, weapon mode). */
  aim: { seat: number; angle: number; power: number; speedMul: number } | null;
  onAim?: (angle: number, power: number) => void;
  wallDraft: WallDraft | null;
}

function drawPaper(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#fbf8ef";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.strokeStyle = "rgba(96, 140, 210, 0.28)";
  ctx.lineWidth = 1;
  for (let y = 40; y < WORLD_H; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(230, 110, 110, 0.45)";
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, WORLD_H);
  ctx.stroke();
}

function sketchPath(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string, width: number, alpha = 1) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  for (const [dx, dy, w, a] of [
    [0, 0, width, alpha],
    [0.7, -0.5, Math.max(1, width * 0.45), alpha * 0.45],
  ] as const) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0] + dx, pts[1] + dy);
    if (pts.length === 2) ctx.lineTo(pts[0] + dx + 0.1, pts[1] + dy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + dx, pts[i + 1] + dy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrain(ctx: CanvasRenderingContext2D, terrain: readonly number[]) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, WORLD_H);
  for (let x = 0; x <= WORLD_W; x += 8) ctx.lineTo(x, surfaceY(terrain, x));
  ctx.lineTo(WORLD_W, WORLD_H);
  ctx.closePath();
  ctx.fillStyle = "#f1ece0";
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = "rgba(75, 85, 99, 0.35)";
  ctx.lineWidth = 1.2;
  for (let x = -WORLD_H; x < WORLD_W; x += 11) {
    ctx.beginPath();
    ctx.moveTo(x, WORLD_H);
    ctx.lineTo(x + WORLD_H, 0);
    ctx.stroke();
  }
  ctx.restore();
  const top: number[] = [];
  for (let x = 0; x <= WORLD_W; x += 8) top.push(x, surfaceY(terrain, x));
  sketchPath(ctx, top, "#374151", 3);
}

function drawWalls(ctx: CanvasRenderingContext2D, walls: readonly Wall[]) {
  for (const w of walls) {
    const ratio = Math.max(0.25, Math.min(1, w.hp / w.maxHp));
    for (const s of w.strokes) sketchPath(ctx, s, INK_COLORS[w.color] ?? INK_COLORS[0], 6, 0.35 + 0.65 * ratio);
  }
}

function drawPlayers(ctx: CanvasRenderingContext2D, state: InkDuelState, names: Record<number, string>, hp: readonly number[], turnSeat: number | null, now: number) {
  for (const p of state.players) {
    const color = SEAT_COLORS[p.seat % SEAT_COLORS.length];
    const x = p.x;
    const y = p.y;
    if (!p.alive) {
      // Tombstone doodle.
      sketchPath(ctx, [x - 11, y, x - 11, y - 20, x - 6, y - 26, x + 6, y - 26, x + 11, y - 20, x + 11, y, x - 11, y], "#6b7280", 2.5);
      sketchPath(ctx, [x, y - 21, x, y - 7], "#6b7280", 2);
      sketchPath(ctx, [x - 5, y - 16, x + 5, y - 16], "#6b7280", 2);
      continue;
    }
    const bob = turnSeat === p.seat ? Math.sin(now / 180) * 1.5 : 0;
    // Stick figure: legs, body, head.
    sketchPath(ctx, [x - 7, y, x, y - 10 + bob, x + 7, y], color, 3);
    sketchPath(ctx, [x, y - 10 + bob, x, y - 22 + bob], color, 3);
    sketchPath(ctx, [x - 8, y - 17 + bob, x + 8, y - 17 + bob], color, 3);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.fillStyle = "#fffdf7";
    ctx.beginPath();
    ctx.arc(x, y - 29 + bob, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - 3.5, y - 31 + bob, 2, 2);
    ctx.fillRect(x + 1.5, y - 31 + bob, 2, 2);
    if (p.frozen) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#60a5fa";
      ctx.fillRect(x - 12, y - 40, 24, 40);
    }
    ctx.restore();
    // Name + HP bar.
    const h = hp[p.seat] ?? p.hp;
    ctx.save();
    ctx.font = "bold 13px 'Gaegu', 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(names[p.seat] ?? `P${p.seat + 1}`, x, y - 58);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(x - 22, y - 52, 44, 6);
    ctx.fillStyle = h > 50 ? "#16a34a" : h > 25 ? "#eab308" : "#dc2626";
    ctx.fillRect(x - 22, y - 52, (44 * Math.max(0, h)) / 100, 6);
    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 22, y - 52, 44, 6);
    const icons = `${p.burn > 0 ? "🔥" : ""}${p.poison > 0 ? "☠️" : ""}${p.frozen ? "❄️" : ""}`;
    if (icons) {
      ctx.font = "12px sans-serif";
      ctx.fillText(icons, x, y - 70);
    }
    ctx.restore();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, ev: ShotEvent, x: number, y: number, c: number, s: number) {
  for (const st of ev.stats.shape) {
    const pts: number[] = [];
    for (let i = 0; i < st.p.length; i += 2) pts.push(x + st.p[i] * c - st.p[i + 1] * s, y + st.p[i] * s + st.p[i + 1] * c);
    sketchPath(ctx, pts, INK_COLORS[st.c], 3);
  }
}

function drawBoom(ctx: CanvasRenderingContext2D, ev: ShotEvent, t: number, target: InkDuelState) {
  if (!ev.impact) return;
  const { x, y } = ev.impact;
  const k = Math.min(1, t / 420);
  const fade = 1 - Math.max(0, (t - 700) / 700);
  const r = Math.max(16, ev.stats.blastRadius) * (0.4 + 0.6 * k);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  // Scribbled burst.
  const spikes = 14;
  const pts: number[] = [];
  for (let i = 0; i <= spikes; i++) {
    const a = (i / spikes) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.6;
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  const fill = ev.stats.element === "fire" ? "#fb923c" : ev.stats.element === "ice" ? "#93c5fd" : ev.stats.element === "poison" ? "#86efac" : ev.stats.element === "shock" ? "#fde047" : "#d1d5db";
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.globalAlpha = Math.max(0, fade) * 0.55;
  ctx.fill();
  ctx.globalAlpha = Math.max(0, fade);
  sketchPath(ctx, pts, "#1f2937", 2.5, Math.max(0, fade));
  ctx.font = "bold 22px 'Gaegu', 'Comic Sans MS', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  const word = ev.hits.length === 0 ? "퍽" : ev.crit ? "콰광!!" : ev.stats.kind === "spear" ? "푹!" : ev.stats.kind === "lightning" ? "지직!" : "쾅!";
  ctx.fillText(word, x, y - r - 8);
  // Lightning chain.
  if (ev.chainPath.length >= 4) {
    for (let i = 2; i < ev.chainPath.length; i += 2) {
      const ax = ev.chainPath[i - 2];
      const ay = ev.chainPath[i - 1];
      const bx = ev.chainPath[i];
      const by = ev.chainPath[i + 1];
      const zz: number[] = [ax, ay];
      for (let j = 1; j < 6; j++) {
        const tt = j / 6;
        zz.push(ax + (bx - ax) * tt + (j % 2 === 0 ? 8 : -8), ay + (by - ay) * tt + (j % 2 === 0 ? -6 : 6));
      }
      zz.push(bx, by);
      sketchPath(ctx, zz, "#eab308", 4, Math.max(0, fade));
    }
  }
  ctx.restore();
  // Damage popups.
  ctx.save();
  ctx.textAlign = "center";
  for (const h of ev.hits) {
    const p = target.players[h.seat];
    const rise = Math.min(1, t / 900) * 30;
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, (t - 900) / 500));
    ctx.font = `bold ${ev.crit ? 26 : 20}px 'Gaegu', 'Comic Sans MS', sans-serif`;
    ctx.fillStyle = ev.crit ? "#d97706" : "#dc2626";
    ctx.fillText(`${h.chain ? "⚡" : ""}-${h.dmg}`, p.x, p.y - 80 - rise);
  }
  ctx.restore();
}

export default function ArenaCanvas({ view, anim, onAnimDone, names, turnSeat, aim, onAim, wallDraft }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ view, anim, names, turnSeat, aim, wallDraft });
  useEffect(() => {
    propsRef.current = { view, anim, names, turnSeat, aim, wallDraft };
  });
  const onAnimDoneRef = useRef(onAnimDone);
  useEffect(() => {
    onAnimDoneRef.current = onAnimDone;
  }, [onAnimDone]);
  const animClockRef = useRef<{ id: number; start: number; launched: boolean; impacted: boolean; done: boolean } | null>(null);
  const drawingRef = useRef<number[] | null>(null);
  const aimDragRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WORLD_W * dpr;
    canvas.height = WORLD_H * dpr;
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const { view, anim, names, turnSeat, aim, wallDraft } = propsRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPaper(ctx);

      let clock = animClockRef.current;
      if (anim && (!clock || clock.id !== anim.event.id)) {
        clock = { id: anim.event.id, start: now, launched: false, impacted: false, done: false };
        animClockRef.current = clock;
      }
      const ev = anim?.event ?? null;
      const t = clock && anim ? now - clock.start : 0;
      const flightT = t - CARD_MS;
      const frameCount = ev ? ev.frames.length / 4 : 0;
      const flightDur = frameCount * FRAME_MS;
      const impactT = flightT - flightDur;
      const inImpact = !!anim && impactT >= 0;
      const scene = anim ? (inImpact ? anim.target : anim.base) : view;
      const hp = anim ? (inImpact ? anim.target.players.map((p) => p.hp) : anim.event.hpBefore) : view.players.map((p) => p.hp);

      // Wall-zone hint while drawing walls.
      if (wallDraft && turnSeat !== null) {
        const me = scene.players[turnSeat];
        ctx.save();
        ctx.fillStyle = wallDraft.error ? "rgba(220, 38, 38, 0.07)" : "rgba(37, 99, 235, 0.07)";
        ctx.fillRect(me.x - WALL_RANGE, 0, WALL_RANGE * 2, WORLD_H);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(37, 99, 235, 0.45)";
        ctx.strokeRect(me.x - WALL_RANGE, 2, WALL_RANGE * 2, WORLD_H - 4);
        ctx.restore();
      }

      drawTerrain(ctx, scene.terrain);
      drawWalls(ctx, scene.walls);
      drawPlayers(ctx, scene, names, hp, anim ? anim.event.seat : turnSeat, now);

      if (wallDraft) {
        for (const s of wallDraft.strokes) sketchPath(ctx, s.p, wallDraft.error ? "#dc2626" : INK_COLORS[s.c], 6, 0.85);
        const live = drawingRef.current;
        if (live) sketchPath(ctx, live, INK_COLORS[wallDraft.color], 6, 0.85);
      }

      // Aim preview: first stretch of the arc only — reading the rest is the skill.
      if (aim && !anim) {
        const me = view.players[aim.seat];
        let x = me.x;
        let y = me.y - MUZZLE_Y;
        let { vx, vy } = launchVelocity(aim.angle, aim.power, aim.speedMul);
        ctx.save();
        ctx.fillStyle = SEAT_COLORS[aim.seat % SEAT_COLORS.length];
        for (let tick = 1; tick <= 42; tick++) {
          vx += view.wind;
          vy += GRAVITY;
          x += vx;
          y += vy;
          if (tick % 3 === 0) {
            ctx.globalAlpha = 1 - tick / 50;
            ctx.beginPath();
            ctx.arc(x, y, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      if (anim && ev && clock) {
        if (flightT >= 0 && !clock.launched) {
          clock.launched = true;
          playLaunchSound();
        }
        if (flightT >= 0 && impactT < 0 && frameCount > 0) {
          const idx = Math.min(frameCount - 1, Math.floor(flightT / FRAME_MS));
          // Pencil trail.
          ctx.save();
          ctx.fillStyle = "rgba(55, 65, 81, 0.35)";
          for (let i = 0; i < idx; i += 3) {
            ctx.beginPath();
            ctx.arc(ev.frames[i * 4], ev.frames[i * 4 + 1], 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
          drawShape(ctx, ev, ev.frames[idx * 4], ev.frames[idx * 4 + 1], ev.frames[idx * 4 + 2], ev.frames[idx * 4 + 3]);
        }
        if (inImpact) {
          if (!clock.impacted) {
            clock.impacted = true;
            playImpactSound(ev);
          }
          drawBoom(ctx, ev, impactT, anim.target);
          if (impactT >= IMPACT_MS && !clock.done) {
            clock.done = true;
            onAnimDoneRef.current();
          }
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function toWorld(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - rect.left) / rect.width) * WORLD_W), Math.round(((e.clientY - rect.top) / rect.height) * WORLD_H)];
  }

  function aimFrom(x: number, y: number) {
    if (!aim || !onAim) return;
    const me = view.players[aim.seat];
    const dx = x - me.x;
    const dy = me.y - MUZZLE_Y - y;
    let angle = Math.round((Math.atan2(Math.max(0, dy), dx) * 180) / Math.PI);
    angle = Math.max(0, Math.min(180, angle));
    const power = Math.round(Math.max(10, Math.min(100, Math.sqrt(dx * dx + dy * dy) / 2.6)));
    onAim(angle, power);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (anim) return;
    const [x, y] = toWorld(e);
    if (wallDraft) {
      if (wallDraft.strokes.length >= 16) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drawingRef.current = [Math.max(0, Math.min(WORLD_W, x)), Math.max(0, Math.min(WORLD_H, y))];
      return;
    }
    if (aim && onAim) {
      e.currentTarget.setPointerCapture(e.pointerId);
      aimDragRef.current = true;
      aimFrom(x, y);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const [x, y] = toWorld(e);
    const pts = drawingRef.current;
    if (pts && wallDraft) {
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      const cx = Math.max(0, Math.min(WORLD_W, x));
      const cy = Math.max(0, Math.min(WORLD_H, y));
      const dx = cx - lx;
      const dy = cy - ly;
      if (dx * dx + dy * dy < 16 || pts.length >= MAX_POINTS_PER_STROKE * 2) return;
      const candidate = { c: wallDraft.color, p: [...pts, cx, cy] };
      if (totalInk(wallDraft.strokes) + strokeInk(candidate) > wallDraft.budget) return;
      pts.push(cx, cy);
      return;
    }
    if (aimDragRef.current) aimFrom(x, y);
  }

  function onPointerUp() {
    aimDragRef.current = false;
    const pts = drawingRef.current;
    drawingRef.current = null;
    if (pts && wallDraft) {
      const p = pts.length === 2 ? [...pts, pts[0], pts[1]] : pts;
      wallDraft.onChange([...wallDraft.strokes, { c: wallDraft.color, p }]);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="block aspect-[16/9] w-full touch-none select-none rounded-xl border-2 border-slate-700/60 shadow-lg"
      style={{ cursor: wallDraft ? "crosshair" : aim ? "pointer" : "default" }}
    />
  );
}
