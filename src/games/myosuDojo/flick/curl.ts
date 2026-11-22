/**
 * 🥌 컬링 마지막 스톤 — puzzle book on top of 컬링 파티's deterministic
 * sheet physics (curling/physics.ts + engine.ts `measure`, unchanged). One
 * delivery, no sweeping: broom position, weight and handle (curl) decide it.
 */

import { measure } from "@/games/curling/engine";
import { aimDir, BACK_Y, BUTTON_R, HOG_Y, HOUSE_R, RELEASE_Y, RING_4_R, RING_8_R, SHEET_HALF, STONE_R, TEE_Y, ThrowSim, type Stone } from "@/games/curling/physics";
import { starsFrom, type AimAdapter, type AimStage, type Body, type CondResult, type ParamSpec, type Params, type ShotRun } from "../aim/types";

/** Delivered stone id (resting stones use 1..). */
export const SHOT_ID = 99;

export type CurlCond =
  /** My side scores at least n if the end stopped now. */
  | { k: "score"; n: number }
  /** These rival stones end up out of play. */
  | { k: "out"; ids: number[] };

export interface CurlStage extends AimStage {
  /** side 0 = mine (red), 1 = rival (yellow). */
  stones: { id: number; side: 0 | 1; x: number; y: number }[];
  tiers: [CurlCond[], CurlCond[], CurlCond[]];
}

export const CURL_PARAMS: ParamSpec[] = [
  { key: "aim", label: "브룸 위치", min: -2.2, max: 2.2, step: 0.01, coarse: 0.1, unit: "m", fmt: (v) => (v === 0 ? "가운데" : v > 0 ? `오른쪽 ${v.toFixed(2)}` : `왼쪽 ${(-v).toFixed(2)}`) },
  { key: "weight", label: "세기", min: 0, max: 100, step: 0.5, coarse: 5, unit: "%", fmt: (v) => v.toFixed(1) },
  { key: "spin", label: "회전", min: -1, max: 1, step: 2, coarse: 2, toggle: ["↺ 왼쪽으로 휨", "↻ 오른쪽으로 휨"] },
];

export const curlParams = (p: Params) => ({ aim: p.aim ?? 0, weight: (p.weight ?? 0) / 100, spin: ((p.spin ?? 1) >= 0 ? 1 : -1) as 1 | -1, kind: null });

export function restingOf(stage: CurlStage): Stone[] {
  return stage.stones.map((s) => ({ id: s.id, side: s.side, x: s.x, y: s.y, angle: 0, kind: null }));
}

export function evalCurl(stage: CurlStage, sim: ThrowSim): CondResult[][] {
  const left = sim.restingStones();
  const m = measure(left);
  const mine = m.scorer === 0 ? m.points : 0;
  const check = (c: CurlCond): CondResult => {
    switch (c.k) {
      case "score":
        return { label: `${c.n}점 이상 따내기`, ok: mine >= c.n };
      case "out":
        return { label: c.ids.length > 1 ? "노란 스톤 모두 쳐내기" : "표시된 노란 스톤 쳐내기", ok: c.ids.every((id) => !left.some((s) => s.id === id)) };
    }
  };
  return stage.tiers.map((t) => t.map(check));
}

export function simulateCurl(stage: CurlStage, params: Params, record: boolean) {
  const sim = new ThrowSim(restingOf(stage), curlParams(params), 0, SHOT_ID);
  const order = [...stage.stones.map((s) => s.id), SHOT_ID];
  const frames: Float32Array[] = [];
  const snap = () => {
    const f = new Float32Array(order.length * 2);
    order.forEach((id, i) => {
      const s = sim.stones.find((x) => x.id === id)!;
      f[i * 2] = s.out === null ? s.x : NaN;
      f[i * 2 + 1] = s.out === null ? s.y : NaN;
    });
    frames.push(f);
  };
  if (record) snap();
  while (!sim.done) {
    sim.step(0, 0);
    if (record && sim.tick % 4 === 0) snap();
  }
  if (record) snap();
  return { sim, frames };
}

export function runCurl(stage: CurlStage, params: Params): ShotRun {
  const { sim, frames } = simulateCurl(stage, params, true);
  const tiers = evalCurl(stage, sim);
  const stars = starsFrom(tiers);
  const hits: ShotRun["hits"] = [];
  for (const e of sim.events) {
    if (e.kind === "hit") hits.push({ f: Math.floor(e.tick / 4), kind: "ball", power: Math.min(1, e.power / 2) });
    if (e.kind === "out") hits.push({ f: Math.floor(e.tick / 4), kind: "fall", power: 0.4 });
  }
  const m = measure(sim.restingStones());
  const fail = tiers[0].find((c) => !c.ok);
  const score = m.scorer === 0 ? `빨강 ${m.points}점` : m.scorer === 1 ? `노랑 ${m.points}점` : "득점 없음";
  return { frames, frameDt: 4 / 120, hits, outcome: { stars, tiers, summary: stars > 0 ? `⭐ ${stars}개! (${score})` : `${fail?.label ?? "실패"} — 실패 (${score})` } };
}

/** Where a lone stone would travel (dashed path guide). */
function lonePath(params: Params): [number, number][] {
  const sim = new ThrowSim([], curlParams(params), 0, SHOT_ID);
  const pts: [number, number][] = [];
  while (!sim.done) {
    sim.step(0, 0);
    if (sim.tick % 12 === 0) {
      const d = sim.deliveredStone();
      if (d.out !== null) break;
      if (d.y < VIEW_MAX_Y + 1) pts.push([d.x, d.y]);
    }
  }
  const d = sim.deliveredStone();
  if (d.out === null) pts.push([d.x, d.y]);
  return pts;
}

const VIEW_MAX_Y = HOG_Y + 2.4;

export const curlAdapter: AimAdapter<CurlStage> = {
  view: { minX: -SHEET_HALF - 0.15, maxX: SHEET_HALF + 0.15, minY: BACK_Y - 0.9, maxY: VIEW_MAX_Y },
  params: CURL_PARAMS,
  defaults: () => ({ aim: 0, weight: 30, spin: 1 }),
  bodies(stage): Body[] {
    const b: Body[] = stage.stones.map((s) => ({ id: s.id, x: s.x, y: s.y, r: STONE_R, color: s.side === 0 ? "#dc2626" : "#facc15", ring: "#475569" }));
    // the delivered stone enters from below the view
    b.push({ id: SHOT_ID, x: 0, y: RELEASE_Y, r: STONE_R, color: "#dc2626", ring: "#f59e0b" });
    return b;
  },
  run: runCurl,
  drawTable(ctx, _stage, px, scale) {
    const [x0, y0] = px(-SHEET_HALF, BACK_Y - 0.9);
    const [x1, y1] = px(SHEET_HALF, VIEW_MAX_Y);
    ctx.fillStyle = "#e0f2fe";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const [cx, cy] = px(0, TEE_Y);
    const rings: [number, string][] = [
      [HOUSE_R, "#1d4ed8"],
      [RING_8_R, "#f8fafc"],
      [RING_4_R, "#dc2626"],
      [BUTTON_R, "#f8fafc"],
    ];
    for (const [r, c] of rings) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = Math.max(1, scale * 0.02);
    for (const yy of [TEE_Y, BACK_Y]) {
      const [a, b] = px(-SHEET_HALF, yy);
      const [c] = px(SHEET_HALF, yy);
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(c, b);
      ctx.stroke();
    }
    const [m0, m1] = px(0, BACK_Y - 0.9);
    const [, m3] = px(0, VIEW_MAX_Y);
    ctx.beginPath();
    ctx.moveTo(m0, m1);
    ctx.lineTo(m0, m3);
    ctx.stroke();
    const [h0, h1] = px(-SHEET_HALF, HOG_Y);
    const [h2] = px(SHEET_HALF, HOG_Y);
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = Math.max(2, scale * 0.06);
    ctx.beginPath();
    ctx.moveTo(h0, h1);
    ctx.lineTo(h2, h1);
    ctx.stroke();
  },
  guide(_stage, params) {
    const dir = aimDir(params.aim ?? 0);
    const t = (VIEW_MAX_Y + 1 - RELEASE_Y) / dir.y;
    const entry: [number, number] = [dir.x * t, VIEW_MAX_Y + 1];
    return [
      { pts: [entry, [params.aim ?? 0, TEE_Y]], color: "rgba(30,41,59,0.55)" },
      { pts: lonePath(params), dashed: true, color: "rgba(220,38,38,0.85)" },
    ];
  },
  dragTo(_stage, params, wx) {
    const v = Math.max(-2.2, Math.min(2.2, Math.round(wx * 100) / 100));
    return { ...params, aim: v };
  },
};
