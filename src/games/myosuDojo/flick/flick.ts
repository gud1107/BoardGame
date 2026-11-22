/**
 * 🥏 알까기 한 수 — puzzle book on top of 알까기 대전's deterministic disc
 * physics (alkkagi/physics.ts, unchanged). You pick one of your stones and
 * flick it once; star tiers check which stones fell.
 */

import { EDGE, firstContact, KING_GRIP, KING_MASS, KING_R, simulate, speedForPower, STONE_MASS, STONE_R, type SimResult, type SimStone } from "@/games/alkkagi/physics";
import { normParam, rad, starsFrom, type AimAdapter, type AimStage, type Body, type CondResult, type ParamSpec, type Params, type ShotRun } from "../aim/types";

export interface FlickStone {
  id: number;
  x: number;
  y: number;
  /** 0 = mine (white), 1 = rival (black). */
  side: 0 | 1;
  king?: boolean;
}

export type FlickCond =
  /** At least n rival stones fall. */
  | { k: "knock"; n: number }
  /** These ids must fall. */
  | { k: "fall"; ids: number[] }
  /** None of my stones fall (shooter included). */
  | { k: "safe" }
  /** The shooter stays on the board. */
  | { k: "shooterStays" }
  /** Only these of my stones may shoot (for "this stone only" stages, checked on the shooter). */
  | { k: "shooter"; id: number };

export interface FlickStage extends AimStage {
  stones: FlickStone[];
  /** Stones you may flick (default: all of yours). */
  shooters?: number[];
  tiers: [FlickCond[], FlickCond[], FlickCond[]];
}

export const FLICK_PARAMS: ParamSpec[] = [
  { key: "angle", label: "방향", min: 0, max: 360, step: 0.1, coarse: 1, wrap: true, unit: "°", fmt: (v) => v.toFixed(1) },
  { key: "power", label: "힘", min: 0, max: 100, step: 0.5, coarse: 5, unit: "%", fmt: (v) => v.toFixed(1) },
];

export function simStones(stage: FlickStage): SimStone[] {
  return stage.stones.map((s) => (s.king ? { id: s.id, x: s.x, y: s.y, r: KING_R, m: KING_MASS, mu: KING_GRIP } : { id: s.id, x: s.x, y: s.y, r: STONE_R, m: STONE_MASS }));
}

export function flickVel(params: Params) {
  const a = rad(params.angle);
  const s = speedForPower((params.power ?? 0) / 100);
  return { vx: Math.cos(a) * s, vy: Math.sin(a) * s };
}

export function shootersOf(stage: FlickStage): number[] {
  return stage.shooters ?? stage.stones.filter((s) => s.side === 0).map((s) => s.id);
}

export function evalFlick(stage: FlickStage, shooter: number, r: SimResult): CondResult[][] {
  const fell = new Set(r.falls.map((f) => f.id));
  const rivals = stage.stones.filter((s) => s.side === 1);
  const knocked = rivals.filter((s) => fell.has(s.id)).length;
  const check = (c: FlickCond): CondResult => {
    switch (c.k) {
      case "knock":
        return { label: c.n >= rivals.length ? `검은 알 ${c.n}개 모두 떨어뜨리기` : `검은 알 ${c.n}개 이상 떨어뜨리기`, ok: knocked >= c.n };
      case "fall":
        return { label: c.ids.some((id) => stage.stones.find((s) => s.id === id)?.king) ? "검은 왕 떨어뜨리기" : "표시된 알 떨어뜨리기", ok: c.ids.every((id) => fell.has(id)) };
      case "safe":
        return { label: "내 알은 하나도 안 떨어지기", ok: stage.stones.every((s) => s.side === 1 || !fell.has(s.id)) };
      case "shooterStays":
        return { label: "튕긴 알은 판 위에 남기", ok: !fell.has(shooter) };
      case "shooter":
        return { label: "정해진 알로 튕기기", ok: shooter === c.id };
    }
  };
  return stage.tiers.map((t) => t.map(check));
}

export function runFlick(stage: FlickStage, params: Params): ShotRun {
  const shooter = params.shooter ?? shootersOf(stage)[0];
  const { vx, vy } = flickVel(params);
  const r = simulate(simStones(stage), shooter, vx, vy, true);
  const tiers = evalFlick(stage, shooter, r);
  const stars = starsFrom(tiers);
  const hits: ShotRun["hits"] = [];
  for (const c of r.collisions ?? []) hits.push({ f: Math.floor(c.step / 2), kind: "ball", power: Math.min(1, c.impulse / 8) });
  for (const f of r.falls) hits.push({ f: Math.floor(f.step / 2), kind: "fall", power: 0.7 });
  const fail = tiers[0].find((c) => !c.ok);
  return { frames: r.frames ?? [], frameDt: 1 / 60, hits, outcome: { stars, tiers, summary: stars > 0 ? `⭐ ${stars}개!` : (fail?.label ?? "실패") + " — 실패" } };
}

export const flickAdapter: AimAdapter<FlickStage> = {
  view: { minX: -EDGE - 0.6, maxX: EDGE + 0.6, minY: -EDGE - 0.6, maxY: EDGE + 0.6 },
  params: FLICK_PARAMS,
  defaults: (stage) => ({ angle: 270, power: 50, shooter: shootersOf(stage)[0] }),
  bodies(stage, params): Body[] {
    const can = new Set(shootersOf(stage));
    return stage.stones.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      r: s.king ? KING_R : STONE_R,
      color: s.side === 0 ? "#f8fafc" : "#111827",
      label: s.king ? "王" : undefined,
      ring: s.id === params.shooter ? "#f59e0b" : can.has(s.id) ? "#38bdf8" : undefined,
      pickable: can.has(s.id),
    }));
  },
  run: runFlick,
  drawTable(ctx, _stage, px, scale) {
    const [x0, y0] = px(-EDGE, -EDGE);
    const [x1, y1] = px(EDGE, EDGE);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "#e9c77b");
    g.addColorStop(1, "#c99a4b");
    ctx.fillStyle = "#3f2a14";
    ctx.fillRect(x0 - scale * 0.5, y0 - scale * 0.5, x1 - x0 + scale, y1 - y0 + scale);
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = "rgba(60,35,10,0.55)";
    ctx.lineWidth = Math.max(1, scale * 0.04);
    for (let i = -9; i <= 9; i++) {
      const [a, b] = px(i, -9);
      const [c, d] = px(i, 9);
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
      ctx.stroke();
      const [e, f] = px(-9, i);
      const [h, j] = px(9, i);
      ctx.beginPath();
      ctx.moveTo(e, f);
      ctx.lineTo(h, j);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(60,35,10,0.8)";
    for (const sx of [-6, 0, 6])
      for (const sy of [-6, 0, 6]) {
        const [a, b] = px(sx, sy);
        ctx.beginPath();
        ctx.arc(a, b, scale * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
  },
  guide(stage, params) {
    const me = stage.stones.find((s) => s.id === params.shooter);
    if (!me) return [];
    const a = rad(params.angle);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const hit = firstContact(simStones(stage), me.id, dx, dy);
    if (hit) {
      const t = stage.stones.find((s) => s.id === hit.id)!;
      const nx = t.x - hit.cx;
      const ny = t.y - hit.cy;
      const nl = Math.hypot(nx, ny) || 1;
      return [
        { pts: [[me.x, me.y], [hit.cx, hit.cy]] },
        { pts: [[t.x, t.y], [t.x + (nx / nl) * 3, t.y + (ny / nl) * 3]], dashed: true, color: "rgba(250,204,21,0.9)" },
      ];
    }
    return [{ pts: [[me.x, me.y], [me.x + dx * 4, me.y + dy * 4]] }];
  },
  dragTo(stage, params, wx, wy) {
    const me = stage.stones.find((s) => s.id === params.shooter);
    if (!me) return params;
    const d = (Math.atan2(wy - me.y, wx - me.x) * 180) / Math.PI;
    return { ...params, angle: normParam(FLICK_PARAMS[0], d) };
  },
  pick(stage, params, id) {
    if (!shootersOf(stage).includes(id)) return null;
    return { ...params, shooter: id };
  },
};
