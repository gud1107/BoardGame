import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { botThink } from "./bot";
import type { GameMode, Level } from "./data";
import { createHost, createMatch, step, starsFor, type MatchState } from "./sim";

/**
 * 셀프플레이 밸런스 측정 (룰북 §13 표). 봇끼리 근무를 끝까지 돌려 처리량·놓친 비율·별·역할별 기여를 잰다.
 * `PP_SIM_OUT=경로`를 주면 표를 파일로 쓴다(vitest가 console.log를 삼켜서).
 */

function run(seed: number, n: number, lv: number | number[], mode: GameMode = "coop", level: Level = "normal", seconds: 120 | 180 | 240 = 180, incidents = true): MatchState {
  const seats = Array.from({ length: n }, (_, i) => ({ bot: true, level: Array.isArray(lv) ? lv[i % lv.length] : lv }));
  const s = createMatch(seed, seats, { mode, level, seconds, incidents, roles: true });
  const rt = createHost(s, botThink);
  let guard = 0;
  while (s.phase !== "gameOver" && guard++ < 60 * 400) step(rt);
  return s;
}

interface Row {
  n: number;
  lv: number;
  score: number;
  stars: number;
  loaded: number;
  missRate: number;
  shots: number;
  duo: number;
}

function measure(n: number, lv: number, games: number, level: Level = "normal"): Row {
  let score = 0;
  let stars = 0;
  let loaded = 0;
  let lost = 0;
  let spawned = 0;
  let shots = 0;
  let duo = 0;
  for (let g = 0; g < games; g++) {
    const s = run(1000 + g * 7919 + n * 31 + lv, n, lv, "coop", level);
    score += s.teamScore;
    stars += starsFor(s);
    loaded += s.loaded;
    lost += s.missed + s.broken + s.melted;
    spawned += s.spawned;
    shots += s.players.reduce((a, p) => a + p.stats.shots, 0);
    duo += s.players.reduce((a, p) => a + p.stats.heavyDuo, 0) / 2;
  }
  return { n, lv, score: score / games, stars: stars / games, loaded: loaded / games, missRate: lost / Math.max(1, spawned), shots: shots / games, duo: duo / games };
}

describe("parcel panic self-play balance", () => {
  it("bot teams finish shifts, levels matter, Lv.5 lands around 2 stars", () => {
    const rows: Row[] = [];
    for (const n of [1, 2, 4, 6]) for (const lv of [2, 5, 9]) rows.push(measure(n, lv, 4));
    const out = process.env.PP_SIM_OUT;
    if (out) writeFileSync(out, rows.map((r) => `${r.n}p Lv${r.lv}: score ${r.score.toFixed(0)} ★${r.stars.toFixed(2)} loaded ${r.loaded.toFixed(1)} lost ${(r.missRate * 100).toFixed(0)}% shots ${r.shots.toFixed(1)} duo ${r.duo.toFixed(1)}`).join("\n"));
    for (const n of [1, 2, 4, 6]) {
      const lo = rows.find((r) => r.n === n && r.lv === 2)!;
      const hi = rows.find((r) => r.n === n && r.lv === 9)!;
      expect(hi.score).toBeGreaterThan(lo.score);
      const mid = rows.find((r) => r.n === n && r.lv === 5)!;
      expect(mid.stars).toBeGreaterThanOrEqual(1);
      expect(mid.stars).toBeLessThanOrEqual(3);
    }
  }, 240_000);

  it("roles: every role contributes (no dead role)", () => {
    const sum: Record<string, { v: number; n: number }> = {};
    for (let g = 0; g < 12; g++) {
      const s = run(3000 + g * 17, 4, 6);
      for (const p of s.players) {
        const r = (sum[p.role] ??= { v: 0, n: 0 });
        r.v += p.stats.loadValue;
        r.n += 1;
      }
    }
    const avg = Object.fromEntries(Object.entries(sum).map(([k, r]) => [k, r.v / r.n]));
    const out = process.env.PP_SIM_OUT;
    if (out) writeFileSync(out + ".roles", JSON.stringify(avg));
    const vals = Object.values(avg);
    expect(Math.min(...vals) / Math.max(...vals)).toBeGreaterThan(0.6);
  }, 120_000);

  it("versus: higher level bots outscore lower ones", () => {
    let hiWins = 0;
    const games = 8;
    for (let g = 0; g < games; g++) {
      const s = run(500 + g * 131, 4, [8, 3, 8, 3], "versus");
      const hi = s.players.filter((p) => p.lv === 8).reduce((a, p) => a + p.score, 0);
      const lo = s.players.filter((p) => p.lv === 3).reduce((a, p) => a + p.score, 0);
      if (hi > lo) hiWins++;
    }
    expect(hiWins).toBeGreaterThanOrEqual(6);
  }, 120_000);
});
