"use client";

import { useEffect, useRef } from "react";
import { INK_COLORS, MAX_POINTS_PER_STROKE, MAX_STROKES, strokeInk, totalInk, type InkColor, type Stroke } from "./analyze";
import {
  Ambient,
  characterFor,
  crayon,
  drawAimArrow,
  drawBolt,
  drawCharacter,
  drawComicText,
  drawDamageNumber,
  drawNameplate,
  drawProjectile,
  drawShieldArt,
  drawTombstone,
  drawTurnMarker,
  drawWallArt,
  Fx,
  renderBackground,
  renderTerrain,
  WindStreaks,
} from "./arenaArt";
import { WALL_RANGE, type InkDuelState, type InkEvent, type Player } from "./engine";
import type { MapId } from "./maps";
import { activeStatuses } from "./status";
import { playImpactSound, playLaunchSound } from "./inkDuelAudio";
import { GRAVITY, launchVelocity, MUZZLE_Y, surfaceY, WORLD_H, WORLD_W, type Wall } from "./physics";

/** Seat accent colors (HUD chips etc.) — the character body colors. */
export const SEAT_COLORS = ["#8b5cf6", "#fb923c", "#14b8a6", "#f472b6"];
export const CARD_MS = 1300;
const FRAME_MS = 12;
const IMPACT_MS = 1500;
const HURT_MS = 750;

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
  /** Aim preview for the seat about to act. `noArc` (shield mode) keeps the drag-to-aim but hides the trajectory. */
  aim: { seat: number; angle: number; power: number; speedMul: number; noArc?: boolean } | null;
  onAim?: (angle: number, power: number) => void;
  wallDraft: WallDraft | null;
  /** While previewing a walk: where the walker started (drawn as a faint ghost + footprints). */
  walkFrom?: { seat: number; x: number } | null;
  /** Shield being drawn this turn, shown as a dashed bubble. */
  shieldPreview?: Wall | null;
}

function nearestEnemy(players: readonly Player[], seat: number): Player | null {
  const me = players[seat];
  let best: Player | null = null;
  for (const p of players) {
    if (!p.alive || p.seat === seat) continue;
    if (!best || Math.abs(p.x - me.x) < Math.abs(best.x - me.x)) best = p;
  }
  return best;
}

const WORD: Record<ShotEvent["stats"]["kind"], string> = {
  spear: "푸욱!",
  bomb: "콰광!",
  rocket: "슈우웅 쾅!",
  anvil: "쿠웅!!",
  shuriken: "슈슉!",
  lightning: "지지직!",
  boomerang: "휘리릭 퍽!",
  drill: "드드드 쾅!",
  wave: "철썩!",
  cluster: "파파팡!",
  club: "빠악!",
};

/** Character art index for a seat (older states without `characters` fall back to the seat). */
function charOf(state: InkDuelState, seat: number): number {
  return state.characters?.[seat] ?? seat;
}

export default function ArenaCanvas({ view, anim, onAnimDone, names, turnSeat, aim, onAim, wallDraft, walkFrom = null, shieldPreview = null }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ view, anim, names, turnSeat, aim, wallDraft, walkFrom, shieldPreview });
  useEffect(() => {
    propsRef.current = { view, anim, names, turnSeat, aim, wallDraft, walkFrom, shieldPreview };
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
    const backgrounds = new Map<MapId, HTMLCanvasElement>();
    const backgroundFor = (map: MapId) => {
      let bg = backgrounds.get(map);
      if (!bg) {
        bg = renderBackground(dpr, map);
        backgrounds.set(map, bg);
      }
      return bg;
    };
    let ambient: Ambient | null = null;
    let ambientMap: MapId | null = null;
    const terrainCache = new Map<readonly number[], HTMLCanvasElement>();
    const terrainLayer = (terrain: readonly number[], map: MapId) => {
      let layer = terrainCache.get(terrain);
      if (!layer) {
        layer = renderTerrain(terrain, dpr, map);
        terrainCache.set(terrain, layer);
        if (terrainCache.size > 4) terrainCache.delete(terrainCache.keys().next().value!);
      }
      return layer;
    };
    const fx = new Fx();
    const wind = new WindStreaks();
    const ghostHp: number[] = [];
    let lastNow = 0;
    let raf = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016;
      lastNow = now;
      const { view, anim, names, turnSeat, aim, wallDraft, walkFrom, shieldPreview } = propsRef.current;
      const map: MapId = view.map ?? "meadow";
      if (ambientMap !== map) {
        ambient = new Ambient(map);
        ambientMap = map;
      }
      fx.update(now);

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
      const inFlight = !!anim && flightT >= 0 && !inImpact && frameCount > 0;
      const idx = inFlight ? Math.min(frameCount - 1, Math.floor(flightT / FRAME_MS)) : frameCount - 1;
      let scene = anim ? (inImpact ? anim.target : anim.base) : view;
      // Walk the shooter from its old spot during the reveal card (anim.base is pre-move).
      if (anim && ev?.move && !inImpact) {
        const k = Math.max(0, Math.min(1, t / (CARD_MS * 0.85)));
        const x = ev.move.from + (ev.move.to - ev.move.from) * k;
        scene = { ...scene, players: scene.players.map((p) => (p.seat === ev.seat ? { ...p, x, y: surfaceY(scene.terrain, x) } : p)) };
      }
      const hp = anim ? (inImpact ? anim.target.players.map((p) => p.hp) : anim.event.hpBefore) : view.players.map((p) => p.hp);
      for (let i = 0; i < hp.length; i++) {
        if (ghostHp[i] === undefined || ghostHp[i] < hp[i]) ghostHp[i] = hp[i];
        else if (!inImpact || impactT > 450) ghostHp[i] = Math.max(hp[i], ghostHp[i] - dt * 45);
      }

      // Impact moment: sound + particles (once).
      if (anim && ev && clock && inImpact && !clock.impacted) {
        clock.impacted = true;
        playImpactSound(ev);
        if (ev.impact) {
          const ink = INK_COLORS[ev.stats.shape[0]?.c ?? 0];
          const power = ev.hits.reduce((s, h) => s + h.dmg, 0);
          const pts = ev.pelletPoints?.length ? ev.pelletPoints : [ev.impact.x, ev.impact.y];
          for (let k = 0; k < pts.length; k += 2) {
            fx.explode(pts[k], pts[k + 1], Math.max(18, ev.stats.blastRadius), ev.stats.element, ink, { dirt: ev.craterRadius > 0, power: pts.length > 2 ? power / 3 : power });
          }
        }
      }
      if (anim && clock && inFlight && !clock.launched) {
        clock.launched = true;
        playLaunchSound();
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (fx.shake > 0) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
      ctx.drawImage(backgroundFor(map), -8, -8, WORLD_W + 16, WORLD_H + 16);
      wind.draw(ctx, scene.wind, now);

      // Wall-zone hint while drawing walls.
      if (wallDraft && turnSeat !== null) {
        const me = scene.players[turnSeat];
        ctx.save();
        ctx.fillStyle = wallDraft.error ? "rgba(220, 38, 38, 0.08)" : "rgba(37, 99, 235, 0.08)";
        ctx.fillRect(me.x - WALL_RANGE, 0, WALL_RANGE * 2, WORLD_H);
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -now / 50;
        ctx.strokeStyle = wallDraft.error ? "rgba(220, 38, 38, 0.6)" : "rgba(37, 99, 235, 0.55)";
        ctx.lineWidth = 2;
        ctx.strokeRect(me.x - WALL_RANGE, 2, WALL_RANGE * 2, WORLD_H - 4);
        ctx.restore();
      }

      ctx.drawImage(terrainLayer(scene.terrain, map), 0, 0, WORLD_W, WORLD_H);
      fx.drawSplats(ctx);
      drawWallArt(ctx, scene.walls, now);
      if (shieldPreview && !anim) drawShieldArt(ctx, shieldPreview, 1, true, now);

      // Walk preview: translucent ghost at the start + footprints.
      if (walkFrom && !anim) {
        const gx = walkFrom.x;
        const tx = scene.players[walkFrom.seat].x;
        ctx.save();
        ctx.globalAlpha = 0.32;
        drawCharacter(ctx, { seat: walkFrom.seat, char: charOf(scene, walkFrom.seat), x: gx, y: surfaceY(scene.terrain, gx), now, facing: tx > gx ? 1 : -1 });
        ctx.restore();
        ctx.save();
        ctx.fillStyle = characterFor(charOf(scene, walkFrom.seat)).dark;
        ctx.globalAlpha = 0.45;
        const step = tx > gx ? 10 : -10;
        let n = 0;
        for (let x = gx + step; step > 0 ? x < tx - 6 : x > tx + 6; x += step, n++) {
          ctx.beginPath();
          ctx.ellipse(x, surfaceY(scene.terrain, x) - 2 + (n % 2) * 2, 3, 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Characters.
      const projX = inFlight && ev ? ev.frames[idx * 4] : null;
      const projY = inFlight && ev ? ev.frames[idx * 4 + 1] : null;
      for (const p of scene.players) {
        if (!p.alive && !(anim && inImpact && ev?.killed.includes(p.seat) && impactT < HURT_MS)) {
          drawTombstone(ctx, p.x, p.y, charOf(scene, p.seat), now);
          continue;
        }
        const enemy = nearestEnemy(scene.players, p.seat);
        let facing: 1 | -1 = enemy && enemy.x < p.x ? -1 : 1;
        let holdAngle: number | null = null;
        let look: { x: number; y: number } | null = enemy ? { x: enemy.x, y: enemy.y - 20 } : null;
        if (aim && !anim && aim.seat === p.seat) {
          holdAngle = aim.angle;
          facing = aim.angle > 90 ? -1 : 1;
          const a = (aim.angle * Math.PI) / 180;
          look = { x: p.x + Math.cos(a) * 200, y: p.y - MUZZLE_Y - Math.sin(a) * 200 };
        }
        if (anim && ev && ev.seat === p.seat && !inImpact) {
          // Wind-up during the card, then follow-through.
          const k = Math.min(1, t / CARD_MS);
          const target = ev.angle;
          holdAngle = flightT < 0 ? target + (1 - k) * (target > 90 ? -40 : 40) * Math.sin(k * Math.PI) : target;
          facing = target > 90 ? -1 : 1;
        }
        if (projX !== null && projY !== null) look = { x: projX, y: projY };
        const hit = anim && ev && inImpact ? ev.hits.find((h) => h.seat === p.seat) : undefined;
        const hurt = hit ? Math.max(0, 1 - impactT / HURT_MS) : 0;
        drawCharacter(ctx, {
          seat: p.seat,
          char: charOf(scene, p.seat),
          x: p.x,
          y: p.y,
          now,
          facing,
          look,
          hurt,
          holdAngle,
          active: !anim && turnSeat === p.seat,
          frozen: (p.status?.freeze ?? 0) > 0,
          burn: (p.status?.burn ?? 0) > 0,
          poison: (p.status?.poison ?? 0) > 0,
          statuses: activeStatuses(p.status),
        });
      }
      for (const p of scene.players) {
        if (!p.alive) continue;
        drawNameplate(ctx, p.x, p.y, charOf(scene, p.seat), names[p.seat] ?? `P${p.seat + 1}`, hp[p.seat] ?? p.hp, ghostHp[p.seat] ?? p.hp, activeStatuses(p.status));
        if (!anim && turnSeat === p.seat) drawTurnMarker(ctx, p.x, p.y, now, activeStatuses(p.status).length > 0 ? 20 : 0);
      }

      ambient?.draw(ctx, scene.wind, now);

      // Wall drafts in progress.
      if (wallDraft) {
        const col = (c: InkColor) => (wallDraft.error ? "#dc2626" : INK_COLORS[c]);
        for (const s of wallDraft.strokes) crayon(ctx, s.p, col(s.c), 7, () => 0.5, 0.85);
        const live = drawingRef.current;
        if (live && live.length >= 4) crayon(ctx, live, col(wallDraft.color), 7, () => 0.5, 0.85);
      }

      // Aim: short dotted arc + arrow.
      if (aim && !anim && !aim.noArc) {
        const me = view.players[aim.seat];
        let x = me.x;
        let y = me.y - MUZZLE_Y;
        let { vx, vy } = launchVelocity(aim.angle, aim.power, aim.speedMul);
        ctx.save();
        for (let tick = 1; tick <= 42; tick++) {
          vx += view.wind;
          vy += GRAVITY;
          x += vx;
          y += vy;
          if (tick % 3 === 0) {
            ctx.globalAlpha = 1 - tick / 50;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = characterFor(charOf(view, aim.seat)).dark;
            ctx.beginPath();
            ctx.arc(x, y, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
        drawAimArrow(ctx, me.x, me.y - MUZZLE_Y, aim.angle, aim.power, characterFor(charOf(view, aim.seat)).base, now);
      }

      // Projectile in flight: afterimages + glowing doodle + element trail.
      if (inFlight && ev) {
        for (const back of [9, 6, 3]) {
          const j = idx - back;
          if (j < 0) continue;
          drawProjectile(ctx, ev.stats.shape, ev.stats.element, ev.frames[j * 4], ev.frames[j * 4 + 1], ev.frames[j * 4 + 2], ev.frames[j * 4 + 3], 0.12 + (9 - back) * 0.04, false);
        }
        const px = ev.frames[idx * 4];
        const py = ev.frames[idx * 4 + 1];
        drawProjectile(ctx, ev.stats.shape, ev.stats.element, px, py, ev.frames[idx * 4 + 2], ev.frames[idx * 4 + 3]);
        fx.trail(px, py, ev.stats.element, INK_COLORS[ev.stats.shape[0]?.c ?? 0]);
      }

      fx.draw(ctx);

      // Impact overlays.
      if (anim && ev && inImpact) {
        if (ev.chainPath.length >= 4 && impactT < 900) {
          for (let i = 2; i < ev.chainPath.length; i += 2) {
            drawBolt(ctx, ev.chainPath[i - 2], ev.chainPath[i - 1], ev.chainPath[i], ev.chainPath[i + 1], 1 - impactT / 900);
          }
        }
        if (ev.impact) {
          const word = ev.hits.length === 0 ? "퍽!" : ev.crit ? "크리티컬!!" : WORD[ev.stats.kind];
          drawComicText(ctx, word, ev.impact.x, Math.min(WORLD_H - 30, ev.impact.y + Math.max(26, ev.stats.blastRadius * 0.6) + 14), impactT, ev.hits.length === 0 ? "#9ca3af" : ev.crit ? "#f59e0b" : "#ef4444", ev.crit ? 36 : 30);
        } else if (ev.caught) {
          const me = anim.target.players[ev.seat];
          drawComicText(ctx, "탁! 받았다", me.x, me.y - 130, impactT, "#0ea5e9", 24);
        } else {
          const lx = Math.max(60, Math.min(WORLD_W - 60, ev.frames[(frameCount - 1) * 4]));
          drawComicText(ctx, "휘익~ 빗나감", lx, 90, impactT, "#94a3b8", 24);
        }
        for (const h of ev.hits) {
          const p = anim.target.players[h.seat];
          drawDamageNumber(ctx, `${h.chain ? "⚡" : ""}-${h.dmg}`, p.x, p.y - 112, impactT, ev.crit);
        }
        if (impactT >= IMPACT_MS && !clock!.done) {
          clock!.done = true;
          onAnimDoneRef.current();
        }
      }
      ctx.restore();

      if (fx.flash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${fx.flash})`;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
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
      if (wallDraft.strokes.length >= MAX_STROKES) return;
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
      className="block aspect-[16/9] w-full touch-none select-none rounded-2xl shadow-[0_10px_30px_-8px_rgba(60,40,10,0.45)] ring-1 ring-black/10"
      style={{ cursor: wallDraft ? "crosshair" : aim ? "pointer" : "default" }}
    />
  );
}

/** Static character portrait for HUD chips and result cards. */
export function CharacterAvatar({ char, size = 32, dead = false }: { char: number; size?: number; dead?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const k = (size / 50) * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, 50, 50);
    ctx.globalAlpha = dead ? 0.4 : 1;
    // Frame the head/body: character spans roughly y-48..y and x±22.
    drawCharacter(ctx, { seat: char, char, x: 25, y: 50, now: 1000, facing: 1, look: { x: 60, y: 30 }, scale: 1 });
  }, [char, size, dead]);
  return <canvas ref={ref} style={{ width: size, height: size }} className={dead ? "grayscale" : ""} />;
}
