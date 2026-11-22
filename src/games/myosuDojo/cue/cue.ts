/**
 * 🎱 당구 한 큐 — puzzle book on top of 당구 파티's deterministic table
 * physics (billiards/physics.ts, unchanged). One cue per attempt; star
 * tiers are checked on the shot's contact / cushion / pot log.
 */

import { firstContact, HALF_H, HALF_W, POCKETS, R, railDistance, simulate, speedForPower, type SimBall, type SimResult } from "@/games/billiards/physics";
import { normParam, rad, starsFrom, type AimAdapter, type AimStage, type Body, type CondResult, type ParamSpec, type Params, type ShotRun } from "../aim/types";

export type CueCond =
  | { k: "pot"; id: number; pocket?: number }
  | { k: "noPot"; id: number }
  | { k: "first"; id: number }
  | { k: "noTouch"; id: number }
  /** Cue ball touches every listed ball. */
  | { k: "carom"; ids: number[] }
  /** …with at least n cushions before it touches the last of them. */
  | { k: "rails"; ids: number[]; n: number }
  | { k: "rest"; id: number; x: number; y: number; r: number };

export interface CueStage extends AimStage {
  pockets: boolean;
  balls: SimBall[];
  tiers: [CueCond[], CueCond[], CueCond[]];
}

export const BALL_COLOR: Record<number, string> = { 0: "#f8fafc", 1: "#facc15", 2: "#2563eb", 3: "#dc2626", 4: "#7c3aed", 5: "#f97316", 6: "#16a34a", 8: "#111827", 9: "#ef4444" };
const POCKET_NAME = ["왼쪽 위", "위 가운데", "오른쪽 위", "오른쪽 아래", "아래 가운데", "왼쪽 아래"];

export const CUE_PARAMS: ParamSpec[] = [
  { key: "angle", label: "방향", min: 0, max: 360, step: 0.1, coarse: 1, wrap: true, unit: "°", fmt: (v) => v.toFixed(1) },
  { key: "power", label: "힘", min: 0, max: 100, step: 0.5, coarse: 5, unit: "%", fmt: (v) => v.toFixed(1) },
  { key: "spin", label: "당점 ↕", min: -1, max: 1, step: 0.25, coarse: 0.5, fmt: (v) => (v === 0 ? "가운데" : v > 0 ? `밀어치기 ${v}` : `끌어치기 ${-v}`) },
  { key: "side", label: "당점 ↔", min: -1, max: 1, step: 0.25, coarse: 0.5, fmt: (v) => (v === 0 ? "가운데" : v > 0 ? `오른쪽 ${v}` : `왼쪽 ${-v}`) },
];

export function cueShot(params: Params) {
  const a = rad(params.angle);
  const s = speedForPower((params.power ?? 0) / 100);
  return { cue: 0, vx: Math.cos(a) * s, vy: Math.sin(a) * s, spin: params.spin ?? 0, side: params.side ?? 0 };
}

export function evalCue(stage: CueStage, r: SimResult): CondResult[][] {
  const potted = new Map(r.pots.map((p) => [p.id, p]));
  const cueContacts = r.contacts.filter((c) => c.a === 0 || c.b === 0);
  const other = (c: { a: number; b: number }) => (c.a === 0 ? c.b : c.a);
  const name = (id: number) => (id === 0 ? "흰 공" : `${id}번 공`);
  const check = (c: CueCond): CondResult => {
    switch (c.k) {
      case "pot": {
        const p = potted.get(c.id);
        return { label: `${name(c.id)} ${c.pocket !== undefined ? `${POCKET_NAME[c.pocket]} 포켓에 ` : ""}넣기`, ok: !!p && (c.pocket === undefined || p.pocket === c.pocket) };
      }
      case "noPot":
        return { label: c.id === 0 ? "흰 공은 빠지면 안 돼요" : `${name(c.id)}은 넣으면 안 돼요`, ok: !potted.has(c.id) };
      case "first":
        return { label: `흰 공이 ${name(c.id)}부터 맞히기`, ok: cueContacts.length > 0 && other(cueContacts[0]) === c.id };
      case "noTouch":
        return { label: `${name(c.id)}은 건드리지 않기`, ok: !r.contacts.some((x) => x.a === c.id || x.b === c.id) };
      case "carom": {
        const ok = c.ids.every((id) => cueContacts.some((x) => other(x) === id));
        return { label: `흰 공으로 ${c.ids.map(name).join("·")} 모두 맞히기`, ok };
      }
      case "rails": {
        let done = -1;
        const seen = new Set<number>();
        for (const x of cueContacts) {
          const o = other(x);
          if (c.ids.includes(o)) seen.add(o);
          if (seen.size === c.ids.length) {
            done = x.step;
            break;
          }
        }
        const rails = done < 0 ? 0 : r.rails.filter((x) => x.id === 0 && x.step <= done).length;
        return { label: `마지막 공 맞히기 전에 쿠션 ${c.n}번 이상`, ok: done >= 0 && rails >= c.n };
      }
      case "rest": {
        const b = r.rest.find((x) => x.id === c.id);
        const ok = !!b && (b.x - c.x) ** 2 + (b.y - c.y) ** 2 <= c.r * c.r;
        return { label: `${name(c.id)}을 동그라미 안에 세우기`, ok };
      }
    }
  };
  return stage.tiers.map((t) => t.map(check));
}

export function runCue(stage: CueStage, params: Params): ShotRun {
  const r = simulate(stage.balls, cueShot(params), stage.pockets, true);
  const tiers = evalCue(stage, r);
  const stars = starsFrom(tiers);
  const hits: ShotRun["hits"] = [];
  for (const c of r.contacts) hits.push({ f: Math.floor(c.step / 2), kind: "ball", power: Math.min(1, c.impulse / 10) });
  for (const c of r.rails) hits.push({ f: Math.floor(c.step / 2), kind: "rail", power: Math.min(1, c.impulse / 12) });
  for (const p of r.pots) hits.push({ f: Math.floor(p.step / 2), kind: "pot", power: 0.8 });
  const fail = tiers[0].find((c) => !c.ok);
  return {
    frames: r.frames ?? [],
    frameDt: 1 / 60,
    hits,
    outcome: { stars, tiers, summary: stars > 0 ? `⭐ ${stars}개!` : (fail?.label ?? "실패") + " — 실패" },
  };
}

function bodiesOf(stage: CueStage): Body[] {
  return stage.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, r: R, color: BALL_COLOR[b.id] ?? "#94a3b8", label: b.id === 0 ? undefined : String(b.id), ring: b.id === 0 ? "#0f172a" : undefined }));
}

export const cueAdapter: AimAdapter<CueStage> = {
  view: { minX: -HALF_W - 1.1, maxX: HALF_W + 1.1, minY: -HALF_H - 1.1, maxY: HALF_H + 1.1 },
  params: CUE_PARAMS,
  defaults: () => ({ angle: 0, power: 40, spin: 0, side: 0 }),
  bodies: (stage) => bodiesOf(stage),
  run: runCue,
  drawTable(ctx, stage, px, scale) {
    const [x0, y0] = px(-HALF_W - 1, -HALF_H - 1);
    const [x1, y1] = px(HALF_W + 1, HALF_H + 1);
    ctx.fillStyle = "#5b3215";
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, scale * 0.8);
    ctx.fill();
    const [cx0, cy0] = px(-HALF_W, -HALF_H);
    const [cx1, cy1] = px(HALF_W, HALF_H);
    const g = ctx.createRadialGradient((cx0 + cx1) / 2, (cy0 + cy1) / 2, scale, (cx0 + cx1) / 2, (cy0 + cy1) / 2, (cx1 - cx0) * 0.7);
    g.addColorStop(0, stage.pockets ? "#15803d" : "#1d4ed8");
    g.addColorStop(1, stage.pockets ? "#14532d" : "#1e3a8a");
    ctx.fillStyle = g;
    ctx.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
    // diamonds
    ctx.fillStyle = "#fde68a";
    for (let i = 1; i < 8; i++) {
      const x = -HALF_W + (i * 2 * HALF_W) / 8;
      for (const yy of [-HALF_H - 0.55, HALF_H + 0.55]) {
        const [a, b] = px(x, yy);
        ctx.beginPath();
        ctx.arc(a, b, scale * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 1; i < 4; i++) {
      const y = -HALF_H + (i * 2 * HALF_H) / 4;
      for (const xx of [-HALF_W - 0.55, HALF_W + 0.55]) {
        const [a, b] = px(xx, y);
        ctx.beginPath();
        ctx.arc(a, b, scale * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (stage.pockets) {
      ctx.fillStyle = "#020617";
      for (const p of POCKETS) {
        const [a, b] = px(p.x, p.y);
        ctx.beginPath();
        ctx.arc(a, b, p.r * scale * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // target circles of "rest" conditions
    for (const t of stage.tiers) {
      for (const c of t) {
        if (c.k !== "rest") continue;
        const [a, b] = px(c.x, c.y);
        ctx.strokeStyle = "rgba(253,224,71,0.9)";
        ctx.setLineDash([scale * 0.25, scale * 0.18]);
        ctx.lineWidth = Math.max(1.5, scale * 0.08);
        ctx.beginPath();
        ctx.arc(a, b, c.r * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  },
  guide(stage, params) {
    const cue = stage.balls.find((b) => b.id === 0)!;
    const a = rad(params.angle);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const hit = firstContact(stage.balls, 0, dx, dy);
    if (hit) {
      return [
        { pts: [[cue.x, cue.y], [hit.cx, hit.cy]] },
        { pts: [[hit.cx + hit.nx * 2 * R, hit.cy + hit.ny * 2 * R], [hit.cx + hit.nx * 4.5, hit.cy + hit.ny * 4.5]], dashed: true, color: "rgba(253,224,71,0.85)" },
      ];
    }
    const t = railDistance(cue.x, cue.y, dx, dy);
    const ex = cue.x + dx * t;
    const ey = cue.y + dy * t;
    const rx = Math.abs(ex) >= HALF_W - R - 1e-6 ? -dx : dx;
    const ry = Math.abs(ey) >= HALF_H - R - 1e-6 ? -dy : dy;
    return [{ pts: [[cue.x, cue.y], [ex, ey]] }, { pts: [[ex, ey], [ex + rx * 3, ey + ry * 3]], dashed: true }];
  },
  dragTo(stage, params, wx, wy) {
    const cue = stage.balls.find((b) => b.id === 0)!;
    const d = (Math.atan2(wy - cue.y, wx - cue.x) * 180) / Math.PI;
    return { ...params, angle: normParam(CUE_PARAMS[0], d) };
  },
};

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
