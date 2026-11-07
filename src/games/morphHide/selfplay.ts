import { HIDER_RANGE, NAIVE_HIDER, NAIVE_SEEKER, SEEKER_RANGE, type HiderParams, type SeekerParams } from "./botParams";
import type { GameOptions } from "./data";
import { createHost, createMatch, hostStep, mulberry } from "./sim";

/**
 * 셀프플레이 학습 — OpenAI "Emergent Tool Use from Multi-Agent Autocurricula"(2019)의 구조를 따른다.
 *
 * - 숨는 쪽·찾는 쪽 두 정책이 **번갈아** 상대를 이기도록 학습한다 (한쪽이 강해지면 다른 쪽에
 *   새 과제가 생기는 자동 커리큘럼).
 * - 상대는 최신 챔피언(80%)과 **과거 챔피언들**(20%)에서 고른다 — 한 상대에만 맞춰진 전략으로
 *   빙빙 도는 것(전략 순환)을 막는 OpenAI의 opponent sampling.
 * - 신경망 PPO 대신, `botParams.ts`의 파라미터 벡터를 **교차 엔트로피 방법(CEM)**으로 최적화한다:
 *   가우시안에서 후보를 뽑아 같은 시드들(공통 난수)로 대전 → 상위 몇 개로 평균·분산 갱신.
 * - 세대마다 전략 지표(움직이다 들킨 횟수·분신 사용·헛손질 등)를 기록해, 어떤 전략이 언제
 *   나타났는지 볼 수 있다.
 */

export interface RoundStats {
  catchFrac: number;
  seekerWin: number;
  seekerDown: number;
  escapes: number;
  wrongHits: number;
  decoys: number;
  /** 술래 시야에서 움직이다 잡힌 비율 같은 세부 지표용 */
  caughtMoving: number;
}

const EVAL_OPTS: Partial<GameOptions> = { huntSec: 180, rounds: 1, goalMode: false };

/** 한 라운드 (5인: 술래 1 · 숨는 4), 정책을 강제로 지정 */
export function evalRound(seed: number, hider: HiderParams, seeker: SeekerParams, opts: Partial<GameOptions> = EVAL_OPTS, players = 5, forceAugs?: string[]): RoundStats {
  const m = createMatch(
    seed,
    Array.from({ length: players }, () => ({ bot: true, level: 10 })),
    { ...EVAL_OPTS, ...opts, rounds: 1 },
  );
  const rt = createHost(m);
  rt.overrides = { hider, seeker };
  if (forceAugs) rt.forceAugs = forceAugs;
  let guard = 0;
  let caughtMoving = 0;
  const seen = new Set<number>();
  while (rt.state.phase !== "roundEnd" && rt.state.phase !== "gameOver" && guard++ < 20 * 60 * 12) {
    hostStep(rt, 50);
    for (const e of rt.state.events) {
      if (e.type !== "catch" || seen.has(e.id)) continue;
      seen.add(e.id);
      if (rt.state.t - (rt.movedAt.get(e.target) ?? -1e9) < 1500) caughtMoving++;
    }
  }
  const h = rt.state.history[rt.state.history.length - 1];
  const hiders = h?.hiders ?? [];
  const caught = hiders.filter((x) => x.result === "caught").length;
  return {
    catchFrac: hiders.length ? caught / hiders.length : 0,
    seekerWin: h?.winner === "seekers" ? 1 : 0,
    seekerDown: rt.state.players.filter((p) => p.role === "seeker" && !p.alive).length,
    escapes: hiders.filter((x) => x.result === "escaped").length,
    wrongHits: rt.state.players.reduce((a, p) => a + p.stats.wrongHits, 0),
    decoys: rt.state.players.reduce((a, p) => a + p.stats.decoys, 0),
    caughtMoving,
  };
}

export function evalMany(seeds: number[], hider: HiderParams, seeker: SeekerParams, opts?: Partial<GameOptions>, players?: number, forceAugs?: string[]): RoundStats {
  const sum: RoundStats = { catchFrac: 0, seekerWin: 0, seekerDown: 0, escapes: 0, wrongHits: 0, decoys: 0, caughtMoving: 0 };
  for (const sd of seeds) {
    const r = evalRound(sd, hider, seeker, opts, players, forceAugs);
    for (const k of Object.keys(sum) as (keyof RoundStats)[]) sum[k] += r[k];
  }
  for (const k of Object.keys(sum) as (keyof RoundStats)[]) sum[k] /= seeds.length;
  return sum;
}

// ---------------------------------------------------------------------------
// CEM

type Vec = Record<string, number>;

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function clampTo<T extends Vec>(v: T, range: Record<string, [number, number]>): T {
  const out = { ...v } as Vec;
  for (const k of Object.keys(range)) out[k] = Math.max(range[k][0], Math.min(range[k][1], out[k]));
  return out as T;
}

interface Dist {
  mean: Vec;
  std: Vec;
}

function initDist(start: Vec, range: Record<string, [number, number]>): Dist {
  const std: Vec = {};
  for (const k of Object.keys(range)) std[k] = (range[k][1] - range[k][0]) * 0.25;
  return { mean: { ...start }, std };
}

function sample(d: Dist, range: Record<string, [number, number]>, rng: () => number): Vec {
  const v: Vec = {};
  for (const k of Object.keys(range)) v[k] = d.mean[k] + d.std[k] * gauss(rng);
  return clampTo(v, range);
}

function refit(d: Dist, elite: Vec[], range: Record<string, [number, number]>) {
  for (const k of Object.keys(range)) {
    const m = elite.reduce((a, v) => a + v[k], 0) / elite.length;
    const sd = Math.sqrt(elite.reduce((a, v) => a + (v[k] - m) ** 2, 0) / elite.length);
    d.mean[k] = d.mean[k] * 0.3 + m * 0.7;
    // 최소 분산을 남겨 너무 일찍 굳지 않게
    d.std[k] = Math.max((range[k][1] - range[k][0]) * 0.03, d.std[k] * 0.3 + sd * 0.7);
  }
}

export interface TrainLog {
  gen: number;
  side: "hider" | "seeker";
  bestFitness: number;
  /** 챔피언끼리 붙였을 때 */
  vsChamp: RoundStats;
}

export interface TrainResult {
  hider: HiderParams;
  seeker: SeekerParams;
  log: TrainLog[];
}

/**
 * 번갈아 학습. `gens` = 한쪽당 세대 수, `pop` = 세대당 후보 수, `seeds` = 후보마다 대전 수.
 */
export function train({ gens = 6, pop = 10, seedsPer = 6, elite = 3, seed = 1, onLog }: { gens?: number; pop?: number; seedsPer?: number; elite?: number; seed?: number; onLog?: (l: TrainLog) => void } = {}): TrainResult {
  const rng = mulberry(seed);
  let hider: HiderParams = { ...NAIVE_HIDER };
  let seeker: SeekerParams = { ...NAIVE_SEEKER };
  const hDist = initDist(hider as unknown as Vec, HIDER_RANGE);
  const sDist = initDist(seeker as unknown as Vec, SEEKER_RANGE);
  const hArchive: HiderParams[] = [hider];
  const sArchive: SeekerParams[] = [seeker];
  const log: TrainLog[] = [];
  let seedBase = 1000;
  const opponent = <T>(latest: T, archive: T[]) => (rng() < 0.8 || archive.length < 2 ? latest : archive[Math.floor(rng() * (archive.length - 1))]);

  for (let g = 0; g < gens * 2; g++) {
    const side: "hider" | "seeker" = g % 2 === 0 ? "seeker" : "hider";
    const seeds = Array.from({ length: seedsPer }, (_, i) => seedBase + i);
    seedBase += seedsPer;
    const cands: { v: Vec; f: number }[] = [];
    // 지금 챔피언도 후보에 넣어 퇴보를 막는다
    const champ = (side === "hider" ? hider : seeker) as unknown as Vec;
    for (let i = 0; i < pop; i++) {
      const v = i === 0 ? { ...champ } : sample(side === "hider" ? hDist : sDist, side === "hider" ? HIDER_RANGE : SEEKER_RANGE, rng);
      let f = 0;
      for (const sd of seeds) {
        if (side === "seeker") {
          const r = evalRound(sd, opponent(hider, hArchive), v as unknown as SeekerParams);
          f += r.catchFrac - 0.15 * r.seekerDown;
        } else {
          const r = evalRound(sd, v as unknown as HiderParams, opponent(seeker, sArchive));
          f += 1 - r.catchFrac + 0.3 * r.seekerDown;
        }
      }
      cands.push({ v, f: f / seeds.length });
    }
    cands.sort((a, b) => b.f - a.f);
    refit(side === "hider" ? hDist : sDist, cands.slice(0, elite).map((c) => c.v), side === "hider" ? HIDER_RANGE : SEEKER_RANGE);
    if (side === "hider") {
      hider = cands[0].v as unknown as HiderParams;
      hArchive.push(hider);
    } else {
      seeker = cands[0].v as unknown as SeekerParams;
      sArchive.push(seeker);
    }
    const vsChamp = evalMany(
      Array.from({ length: seedsPer }, (_, i) => 90000 + g * 100 + i),
      hider,
      seeker,
    );
    const l: TrainLog = { gen: Math.floor(g / 2) + 1, side, bestFitness: cands[0].f, vsChamp };
    log.push(l);
    onLog?.(l);
  }
  return { hider, seeker, log };
}
