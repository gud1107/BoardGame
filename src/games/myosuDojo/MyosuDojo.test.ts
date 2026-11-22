import { describe, expect, it } from "vitest";
import { legalMoves, makeMove, moveToSan, parseFen } from "@/games/chess/core";
import { topple } from "@/games/dominoChain/engine";
import { ALL_IDS, BOOKS } from "./books";
import { CHESS_PUZZLES } from "./chess/puzzles";
import { bestDefence, mateIn, winningMoves } from "./chess/solver";
import { runCue } from "./cue/cue";
import { CUE_STAGES } from "./cue/stages";
import { baseCells, reach, runDomino, solveDomino, withPlaced } from "./domino/puzzle";
import { DOMINO_STAGES } from "./domino/stages";
import { runCurl } from "./flick/curl";
import { runFlick } from "./flick/flick";
import { CURL_STAGES, FLICK_STAGES } from "./flick/stages";
import { applyRun, freshSave, isUnlocked } from "./save";

describe("묘수 도장 — ♟️ chess puzzles", () => {
  for (const p of CHESS_PUZZLES) {
    it(`${p.id} ${p.title}: mate in exactly ${p.n}, single key ${p.key}`, () => {
      const pos = parseFen(p.fen);
      expect(mateIn(pos, p.n)).toBe(true);
      if (p.n > 1) expect(mateIn(pos, p.n - 1)).toBe(false);
      const keys = winningMoves(pos, p.n);
      expect(keys.map((m) => moveToSan(pos, m, legalMoves(pos)))).toEqual([p.key]);
    });
  }

  it("the defender refutes a wrong first move and answers a right one", () => {
    const p = CHESS_PUZZLES.find((x) => x.id === "c7")!;
    const pos = parseFen(p.fen);
    const legal = legalMoves(pos);
    const wrong = legal.find((m) => moveToSan(pos, m, legal) === "Nf7+")!;
    makeMove(pos, wrong);
    expect(bestDefence(pos, p.n - 1)!.refutes).toBe(true);
    const right = parseFen(p.fen);
    const rl = legalMoves(right);
    makeMove(right, rl.find((m) => moveToSan(right, m, rl) === p.key)!);
    expect(bestDefence(right, p.n - 1)!.refutes).toBe(false);
  });
});

/** ⭐⭐⭐ must survive small input errors so the answer is findable by hand. */
const near = (base: Record<string, number>, deltas: Record<string, number[]>) => {
  const out: Record<string, number>[] = [base];
  for (const [k, ds] of Object.entries(deltas)) for (const d of ds) out.push({ ...base, [k]: base[k] + d });
  return out;
};

describe("묘수 도장 — 🎱 billiards stages", () => {
  for (const st of CUE_STAGES) {
    it(`${st.id} ${st.title}: solution earns ⭐⭐⭐ with a ±0.1° / ±1% margin`, () => {
      for (const p of near(st.solution, { angle: [-0.1, 0.1], power: [-1, 1] })) expect(runCue(st, p).outcome.stars, JSON.stringify(p)).toBe(3);
    });
  }
});

describe("묘수 도장 — 🥏 alkkagi stages", () => {
  for (const st of FLICK_STAGES) {
    it(`${st.id} ${st.title}: solution earns ⭐⭐⭐ with a margin`, () => {
      for (const p of near(st.solution, { angle: [-0.1, 0.1], power: [-1, 1] })) expect(runFlick(st, p).outcome.stars, JSON.stringify(p)).toBe(3);
    });
  }
});

describe("묘수 도장 — 🥌 curling stages", () => {
  for (const st of CURL_STAGES) {
    it(`${st.id} ${st.title}: solution earns ⭐⭐⭐ with a margin`, () => {
      for (const p of near(st.solution, { aim: [-0.01, 0.01], weight: [-0.5, 0.5] })) expect(runCurl(st, p).outcome.stars, JSON.stringify(p)).toBe(3);
    });
  }
});

describe("묘수 도장 — 🁢 domino stages", () => {
  for (const st of DOMINO_STAGES) {
    it(`${st.id} ${st.title}: solution rings every bell with par ${st.par}`, () => {
      expect(st.solution).toHaveLength(st.par);
      const o = runDomino(st, st.solution);
      expect(o.rung).toBe(o.bells);
      expect(o.stars).toBe(3);
      expect(st.solution.filter((p) => p.kind === "split").length).toBeLessThanOrEqual(st.splits);
      expect(st.solution.filter((p) => p.kind === "domino").length).toBeLessThanOrEqual(st.dominoes);
    });

    it(`${st.id}: the flood-fill reach agrees with dominoChain's topple`, () => {
      const cells = withPlaced(baseCells(st), st.solution);
      const r = reach(st.size, cells);
      const res = topple(cells, st.size, 1, 0, 0);
      const fell = new Set(res.events.filter((e) => e.kind === "fall").map((e) => e.cell));
      const rang = new Set(res.events.filter((e) => e.kind === "ring").map((e) => e.cell));
      cells.forEach((_, i) => {
        expect(!!r.fallen[i], `fall ${i}`).toBe(fell.has(i));
        expect(!!r.rung[i], `ring ${i}`).toBe(rang.has(i));
      });
      expect(r.booms).toBe(res.events.filter((e) => e.kind === "boom").length);
    });
  }

  // exhaustive "nothing cheaper" proof for the quick boards (the big ones were proven offline)
  for (const st of DOMINO_STAGES.filter((s) => s.par <= 5)) {
    it(`${st.id}: no design with ${st.par - 1} pieces rings every bell`, () => {
      expect(solveDomino(st, st.par - 1, { noBomb: st.noBomb })).toBeNull();
    });
  }
});

describe("묘수 도장 — books and save", () => {
  it("stage ids are unique across books", () => {
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
    expect(BOOKS).toHaveLength(4);
  });

  it("unlocks chapter by chapter and caps a peeked stage at ⭐", () => {
    let s = freshSave();
    expect(isUnlocked(s, "c1")).toBe(true);
    expect(isUnlocked(s, "c2")).toBe(false);
    expect(isUnlocked(s, "c7")).toBe(true);
    s = applyRun(s, "c1", 3, false);
    expect(isUnlocked(s, "c2")).toBe(true);
    s = applyRun(s, "c2", 3, true);
    expect(s.records.c2.stars).toBe(1);
    s = applyRun(s, "c1", 0, false);
    expect(s.records.c1.stars).toBe(3);
  });
});
