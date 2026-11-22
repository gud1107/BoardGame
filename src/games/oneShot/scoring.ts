import { TPS, type Shot, type StageDef } from "./sim";

export interface RunFacts {
  won: boolean;
  bullets: number;
  /** 🔥 실전 (real-time trigger) rather than 🧩 연습 (reserved shots). */
  live: boolean;
  /** Hint 3 (answer ghost) was opened for this stage. */
  ghost: boolean;
}

/** ⭐ clear · ⭐⭐ par or better · ⭐⭐⭐ par or better in 실전 without the answer ghost. */
export function starsFor(st: StageDef, r: RunFacts): 0 | 1 | 2 | 3 {
  if (!r.won) return 0;
  if (r.bullets > st.par) return 1;
  return r.live && !r.ghost ? 3 : 2;
}

export function isMyosu(st: StageDef, r: RunFacts): boolean {
  return r.won && st.myosu !== undefined && r.bullets <= st.myosu;
}

/**
 * "생각을 틀렸나, 손이 늦었나" — compares each fired shot with the reference
 * answer that used the same number of bullets.
 */
export function feedbackFor(st: StageDef, shots: Shot[]): string[] {
  if (!shots.length) return [];
  const ref = st.myosu !== undefined && shots.length <= st.myosu && st.myosuSolution ? st.myosuSolution : st.solution;
  const n = Math.min(ref.length, shots.length);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const dt = (shots[i].tick - ref[i].tick) / TPS;
    const da = shots[i].angle - ref[i].angle;
    const time = Math.abs(dt) < 0.02 ? "타이밍 정확" : `${Math.abs(dt).toFixed(2)}초 ${dt > 0 ? "늦게" : "빨리"}`;
    const aim = Math.abs(da) < 0.3 ? "각도 정확" : `${Math.abs(da).toFixed(1)}° ${da < 0 ? "높게" : "낮게"}`;
    out.push(`${i + 1}발째: ${time} · ${aim}`);
  }
  return out;
}
