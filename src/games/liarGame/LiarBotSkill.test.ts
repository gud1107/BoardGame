/**
 * 라이어 봇 실력 평가 — 사람 말투(humanCorpus.ts, 봇 데이터와 분리된 표현)로 채운 판에서
 * 봇이 얼마나 잘 추리·지목하는지 잰다. 숫자는 `LIAR_EVAL=1`일 때 임시 폴더 JSON으로 남고,
 * 테스트는 회귀 방지용 최소 기준만 건다.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seededRng, shuffle } from "@/lib/rng";
import { applyAction, chooseBotAction, pendingSeats, startGame, type EngineAction, type GameState, type RoundPlan } from "./engine";
import { CATEGORIES, getCategory } from "./words";
import { HUMAN_CITIZEN_LINES, HUMAN_LIAR_GENERIC } from "./humanCorpus";

const N = 6;

function planFor(categoryId: string, word: string, liarSeat: number, rng: () => number): RoundPlan {
  const cat = getCategory(categoryId)!;
  const decoys = shuffle(cat.words.map((w) => w.word).filter((w) => w !== word), rng).slice(0, 5);
  return { categoryId, category: cat.name, word, fakeWord: null, liarSeat, firstSeat: 0, options: shuffle([word, ...decoys], rng) };
}

/** 설명이 끝난 투표 직전 상태(설명은 좌석 순서대로 하나씩). */
function stateWith(plan: RoundPlan, texts: string[], guessMode: "choice" | "text" = "choice"): GameState {
  const base = startGame(N, 1, { rounds: 1, laps: 1, guessMode });
  const all = Array.from({ length: N }, (_, i) => i);
  return {
    ...base,
    plan: [plan],
    phase: "vote",
    candidates: all,
    voters: all,
    descriptions: texts.map((text, seat) => ({ seat, lap: 1, text, auto: false })),
  };
}

const CASES = Object.entries(HUMAN_CITIZEN_LINES).flatMap(([categoryId, words]) => Object.keys(words).map((word) => ({ categoryId, word })));

function humanLines(categoryId: string, word: string, count: number, rng: () => number): string[] {
  return shuffle(HUMAN_CITIZEN_LINES[categoryId][word], rng).slice(0, count);
}

/** 사람 라이어: 절반은 무난한 말, 절반은 "이거겠지" 하고 찍은 단어의 사람 말투(40%는 정답 단어). */
function humanLiarLine(categoryId: string, word: string, rng: () => number): string {
  if (rng() < 0.5) return HUMAN_LIAR_GENERIC[Math.floor(rng() * HUMAN_LIAR_GENERIC.length)];
  const pool = Object.keys(HUMAN_CITIZEN_LINES[categoryId]);
  const guess = rng() < 0.4 ? word : pool.filter((w) => w !== word)[Math.floor(rng() * (pool.length - 1))];
  const lines = HUMAN_CITIZEN_LINES[categoryId][guess];
  return lines[Math.floor(rng() * lines.length)];
}

export function measureSkill(level: number, trials = 4) {
  const rng = seededRng(2026 + level);
  let guessChoice = 0, guessText = 0, guessN = 0;
  let caught = 0, falseAcc = 0, voteN = 0;
  for (const { categoryId, word } of CASES) {
    for (let t = 0; t < trials; t++) {
      // M1: 봇 라이어(좌석 0)가 사람 시민 5명 설명을 듣고 제시어 맞히기.
      const plan = planFor(categoryId, word, 0, rng);
      const lines = humanLines(categoryId, word, 4, rng);
      const texts = ["음 자주 봐요", ...lines, lines[0] + " 진짜"];
      for (const mode of ["choice", "text"] as const) {
        const st: GameState = { ...stateWith(plan, texts, mode), phase: "guess", accused: 0 };
        const a = chooseBotAction(st, 0, level, rng) as Extract<EngineAction, { type: "GUESS" }>;
        if (a.text === word) {
          if (mode === "choice") guessChoice++;
          else guessText++;
        }
      }
      guessN++;
      // M2: 봇 시민(좌석 1)이 사람 라이어(좌석 0) + 사람 시민 4명 사이에서 라이어 지목.
      const liarSeat = Math.floor(rng() * N);
      const viewer = (liarSeat + 1 + Math.floor(rng() * (N - 1))) % N;
      const plan2 = planFor(categoryId, word, liarSeat, rng);
      const cit = humanLines(categoryId, word, 4, rng);
      let ci = 0;
      const texts2 = Array.from({ length: N }, (_, s) => (s === liarSeat ? humanLiarLine(categoryId, word, rng) : s === viewer ? "제 생각엔 다들 아실 거예요" : cit[ci++ % cit.length]));
      const st2 = stateWith(plan2, texts2);
      const v = chooseBotAction(st2, viewer, level, rng) as Extract<EngineAction, { type: "VOTE" }>;
      if (v.target === liarSeat) caught++;
      else falseAcc++;
      voteN++;
    }
  }
  return {
    level,
    liarGuessChoice: guessChoice / guessN,
    liarGuessText: guessText / guessN,
    citizenCatch: caught / voteN,
    falseAccuse: falseAcc / voteN,
  };
}

/** 봇끼리 한 라운드씩 — 시민 승률(라이어 지목 후 정답 실패). */
export function selfPlay(level: number, games = 150) {
  const r: Record<string, number> = {};
  for (let seed = 1; seed <= games; seed++) {
    let s = startGame(N, seed * 37, { rounds: 1, laps: 1 });
    const rng = seededRng(seed);
    while (s.phase !== "roundEnd") s = applyAction(s, chooseBotAction(s, pendingSeats(s)[0], level, rng) as EngineAction);
    r[s.outcome!.reason] = (r[s.outcome!.reason] ?? 0) + 1;
  }
  return { level, citizenWin: (r.missed ?? 0) / games, caught: ((r.missed ?? 0) + (r.guessed ?? 0)) / games, ...r };
}

describe("liar bot skill vs human-style play", () => {
  it("human corpus never leaks into bot code", () => {
    for (const f of ["engine.ts", "words.ts", "lexicon.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(/from\s+["']\.\/humanCorpus["']/.test(src)).toBe(false);
    }
    for (const { categoryId, word } of CASES) expect(CATEGORIES.find((c) => c.id === categoryId)?.words.some((w) => w.word === word)).toBe(true);
  });

  it("measures skill (writes metrics when LIAR_EVAL=1) and keeps minimum bars", () => {
    const rows = [1, 5, 10].map((l) => ({ ...measureSkill(l), self: selfPlay(l) }));
    if (process.env.LIAR_EVAL) fs.writeFileSync(path.join(os.tmpdir(), "liar-eval.json"), JSON.stringify(rows, null, 2));
    const lv10 = rows[2];
    const lv1 = rows[0];
    // 회귀 기준 — 2026-10-11 연상어 사전·확률 추론 도입 후 실측(Lv.10: 사람 라이어 지목 81%,
    // 6지선다 정답 89%, 직접 입력 78% / 도입 전 22%·35%·25%)보다 여유 있게 잡았다.
    const lv5 = rows[1];
    expect(lv10.citizenCatch).toBeGreaterThan(0.65);
    expect(lv5.citizenCatch).toBeGreaterThan(0.55);
    expect(lv10.liarGuessChoice).toBeGreaterThan(0.7);
    expect(lv10.liarGuessText).toBeGreaterThan(0.6);
    expect(lv10.liarGuessChoice).toBeGreaterThan(lv1.liarGuessChoice);
    expect(lv10.citizenCatch).toBeGreaterThan(lv1.citizenCatch);
    // 봇끼리: 중간 레벨은 팽팽하게(시민 승률 30~65%).
    expect(lv5.self.citizenWin).toBeGreaterThan(0.3);
    expect(lv5.self.citizenWin).toBeLessThan(0.65);
  }, 120_000);
});
