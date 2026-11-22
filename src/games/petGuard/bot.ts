import { seededRng } from "@/lib/rng";
import { canBuild, H, layoutCost, petOf, PIECES, roundScore, runSim, sanitizeLayout, W, type Piece, type Scenario } from "./sim";

/**
 * 멍냥 방어선 AI: a hill-climbing search that literally runs the simulator.
 * It starts from a few hand-made shapes (a wooden box, a stone box, nothing)
 * and mutates them — add / remove / move / swap a piece — keeping any layout
 * that scores at least as well. Higher levels search longer and (Lv.7+) also
 * test against a mirrored hazard so a 🔀 역방향 twist hurts less.
 * Lv.1–3 additionally forget a piece now and then.
 */

const ITERS = [3, 8, 14, 22, 34, 50, 70, 95, 125, 160];

function boxCells(sc: Scenario, corners: boolean): { x: number; y: number; top: boolean }[] {
  const p = petOf(sc);
  const out: { x: number; y: number; top: boolean }[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      // lower corners rarely matter (liquids leak through upper diagonal gaps)
      if (Math.abs(dx) === 2 && (dy === 2 || (!corners && dy === -2))) continue;
      const x = p.x + dx;
      const y = p.y + dy;
      if (canBuild(sc, x, y)) out.push({ x, y, top: dy < 0 });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

function seeds(sc: Scenario): Piece[][] {
  const out: Piece[][] = [[]];
  for (const corners of [false, true]) {
    const box = boxCells(sc, corners);
    out.push(
      sanitizeLayout(sc, box.map((c) => ({ x: c.x, y: c.y, k: 0 }))),
      sanitizeLayout(sc, box.map((c) => ({ x: c.x, y: c.y, k: c.top ? 1 : 0 }))),
      sanitizeLayout(sc, box.map((c) => ({ x: c.x, y: c.y, k: 1 }))),
    );
  }
  // stone roof + wooden upper corners + drains beside the pet (beats pooling liquids)
  const p = petOf(sc);
  const shelter: Piece[] = [];
  for (const dx of [-1, 0, 1]) shelter.push({ x: p.x + dx, y: p.y - 2, k: 1 });
  for (const dx of [-2, 2]) shelter.push({ x: p.x + dx, y: p.y - 2, k: 0 }, { x: p.x + dx, y: p.y, k: 2 });
  out.push(sanitizeLayout(sc, shelter));
  return out;
}

export function evaluate(sc: Scenario, layout: readonly Piece[], seed: number, robust: boolean): number {
  const spent = layoutCost(layout);
  const a = runSim(sc, layout, -1, seed);
  let v = roundScore(sc, a, spent) * 1000 + (a.hitTick ?? a.ticks);
  if (robust) {
    const b = runSim(sc, layout, 1, seed);
    v = (v + roundScore(sc, b, spent) * 1000 + (b.hitTick ?? b.ticks)) / 2;
  }
  return v;
}

function mutate(sc: Scenario, layout: Piece[], rng: () => number): Piece[] {
  const p = petOf(sc);
  const out = layout.map((q) => ({ ...q }));
  const r = rng();
  const randCell = () => {
    // mostly near the pet, sometimes anywhere
    for (let t = 0; t < 30; t++) {
      const near = rng() < 0.7;
      const x = near ? p.x + Math.floor(rng() * 9) - 4 : Math.floor(rng() * W);
      const y = near ? p.y + Math.floor(rng() * 9) - 4 : 1 + Math.floor(rng() * (H - 1));
      if (canBuild(sc, x, y) && !out.some((q) => q.x === x && q.y === y)) return { x, y };
    }
    return null;
  };
  const kind = () => {
    const r2 = rng();
    return r2 < 0.38 ? 0 : r2 < 0.66 ? 1 : r2 < 0.78 ? 2 : r2 < 0.86 ? 3 : r2 < 0.94 ? 4 + Math.floor(rng() * 3) : 7;
  };
  if (r < 0.35 || out.length === 0) {
    const c = randCell();
    if (c) out.push({ ...c, k: kind() });
  } else if (r < 0.55) {
    out.splice(Math.floor(rng() * out.length), 1);
  } else if (r < 0.8) {
    const i = Math.floor(rng() * out.length);
    const c = randCell();
    if (c) out[i] = { ...out[i], ...c };
  } else {
    const i = Math.floor(rng() * out.length);
    out[i] = { ...out[i], k: kind() };
  }
  // over budget → drop random pieces until it fits
  while (layoutCost(out) > sc.budget && out.length) out.splice(Math.floor(rng() * out.length), 1);
  return sanitizeLayout(sc, out);
}

export function designLayout(sc: Scenario, level: number, roundSeed: number, botSeed: number): Piece[] {
  const lv = Math.max(1, Math.min(10, Math.round(level)));
  const rng = seededRng((botSeed ^ 0x2545f491) | 0);
  const robust = lv >= 7;
  let best: Piece[] = [];
  let bestV = -Infinity;
  for (const s of seeds(sc)) {
    const v = evaluate(sc, s, roundSeed, robust);
    if (v > bestV) {
      bestV = v;
      best = s;
    }
  }
  let cur = best;
  let curV = bestV;
  for (let i = 0; i < ITERS[lv - 1]; i++) {
    const cand = mutate(sc, cur, rng);
    const v = evaluate(sc, cand, roundSeed, robust);
    if (v >= curV) {
      cur = cand;
      curV = v;
      if (v > bestV) {
        bestV = v;
        best = cand;
      }
    }
  }
  // low levels slip up
  if (lv <= 3 && best.length > 0 && rng() < 0.55 - lv * 0.12) {
    best = best.filter((_, i) => i !== Math.floor(rng() * best.length));
  }
  return best;
}

/** Which of my 3 twist cards to send: Lv.6+ tries each against its own layout as a stand-in for the target's. */
export function chooseTwist(sc: Scenario, hand: readonly number[], level: number, roundSeed: number, botSeed: number, myLayout: readonly Piece[]): number {
  const rng = seededRng((botSeed ^ 0x68e31da4) | 0);
  if (level < 6 || hand.length === 0) return hand[Math.floor(rng() * hand.length)] ?? 0;
  const spent = layoutCost(myLayout);
  let best = hand[0];
  let bestV = Infinity;
  for (const t of hand) {
    const o = runSim(sc, myLayout, t, roundSeed);
    const v = roundScore(sc, o, spent) * 1000 + (o.hitTick ?? o.ticks);
    if (v < bestV) {
      bestV = v;
      best = t;
    }
  }
  return best;
}

export { PIECES };
