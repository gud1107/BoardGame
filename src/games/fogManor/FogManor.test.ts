import { describe, expect, it } from "vitest";
import { CARD_COUNT, ROOM_BASE, START_ROOM, WEAPON_BASE, cardsOf, matchesTrait, neighbors, reachable } from "./data";
import { deduce, FULL_DEDUCE } from "./deduce";
import {
  applyAction,
  computeRankings,
  fogView,
  handSize,
  mulberry32,
  pendingSeats,
  startGame,
  type EngineAction,
  type GameState,
} from "./engine";
import { botHasWork, chooseBotAction } from "./bot";
import { fogSecure } from "./secure";

function playOut(seed: number, n: number, levels: number[], maxSteps = 4000): GameState {
  let s = startGame(n, seed);
  const rng = mulberry32(seed + 7);
  for (let i = 0; i < maxSteps && s.phase !== "ended"; i++) {
    const seat = pendingSeats(s).find((p) => botHasWork(s, p));
    if (seat === undefined) break;
    const a = chooseBotAction(s, seat, levels[seat] ?? 5, rng);
    expect(a, `bot ${seat} has an action in ${s.phase}`).not.toBeNull();
    const next = applyAction(s, a!);
    expect(next, `action ${JSON.stringify(a)} changed state`).not.toBe(s);
    s = next;
  }
  return s;
}

describe("fog manor data", () => {
  it("map: doors + passages are symmetric, 1 step reaches the 4 neighbours of the hall", () => {
    for (let r = 0; r < 9; r++) for (const nb of neighbors(r)) expect(neighbors(nb)).toContain(r);
    expect(neighbors(0)).toContain(8);
    expect(neighbors(2)).toContain(6);
    expect(reachable(START_ROOM).size).toBe(4);
    expect(reachable(0).size).toBe(3);
  });

  it("suspect trait combos are unique and every trait splits 3/3", () => {
    const sus = cardsOf("suspect");
    const keys = new Set(sus.map((c) => [0, 1, 2].map((d) => (matchesTrait(c, { cat: "suspect", dim: d, value: 1 }) ? 1 : 0)).join("")));
    expect(keys.size).toBe(6);
    for (let d = 0; d < 3; d++) expect(sus.filter((c) => matchesTrait(c, { cat: "suspect", dim: d, value: 1 })).length).toBe(3);
  });
});

describe("fog manor engine", () => {
  it("deals the 18 non-solution cards, extras face-up", () => {
    for (let n = 2; n <= 6; n++) {
      const s = startGame(n, 42 + n);
      const sol = [s.solution!.suspect, s.solution!.weapon, s.solution!.room];
      const all = [...s.hands.flat(), ...s.vault, ...s.publicCards, ...sol].sort((a, b) => a - b);
      expect(all).toEqual(Array.from({ length: CARD_COUNT }, (_, i) => i));
      for (const h of s.hands) expect(h.length).toBe(handSize(n));
      expect(s.vault.length + s.publicCards.length).toBe(18 - n * handSize(n));
      expect(fogView(s, 0).vault).toEqual([]);
      expect(fogView(s, 0).vaultPlan).toEqual([]);
      expect(s.vaultPlan.length).toBe(0); // VAULT_REVEALS = 0 (§13)
    }
  });

  it("clues are always true", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = startGame(4, seed);
      const sol = s.solution!;
      const solCards = [sol.suspect, sol.weapon, sol.room];
      for (const clue of [...s.decks.flat(), ...s.bellPlan.map((b) => b.clue)]) {
        if (clue.kind === "alibi") expect(solCards).not.toContain(clue.card);
        else expect(solCards.some((c) => matchesTrait(c, clue.trait))).toBe(true);
      }
      expect(s.decks.every((d) => d.length === 2)).toBe(true);
    }
  });

  it("ask: public count, private card, respond phase when 2+", () => {
    let s = startGame(3, 9);
    const me = s.turn;
    const target = (me + 1) % 3;
    const hand = s.hands[target];
    const sus = hand.find((c) => c < WEAPON_BASE);
    const wep = hand.find((c) => c >= WEAPON_BASE && c < ROOM_BASE);
    // 상대가 가진 용의자+흉기로 물으면 최소 2장 → 고르기 단계
    if (sus !== undefined && wep !== undefined) {
      s = applyAction(s, { type: "ASK", seat: me, stage: s.stage, target, suspect: sus, weapon: wep });
      expect(s.phase).toBe("respond");
      expect(s.pending?.target).toBe(target);
      // 다른 사람 보기엔 장수만
      const other = (me + 2) % 3;
      const ask = fogView(s, other).log.find((e) => e.kind === "ask");
      expect(ask && ask.kind === "ask" && ask.count).toBeGreaterThanOrEqual(2);
      s = applyAction(s, { type: "SHOW", seat: target, stage: s.stage, card: wep });
      expect(s.phase).toBe("turn");
      const mine = fogView(s, me).log.find((e) => e.kind === "ask");
      const theirs = fogView(s, other).log.find((e) => e.kind === "ask");
      expect(mine?.kind === "ask" && mine.shown).toBe(wep);
      expect(theirs?.kind === "ask" && theirs.shown).toBe(-1);
    }
  });

  it("view hides solution, other hands, decks, others' clues; ended view reveals", () => {
    const s = playOut(5, 4, [5, 5, 5, 5], 30);
    const v = fogView(s, 0);
    expect(v.solution).toBeNull();
    expect(v.seed).toBe(0);
    expect(v.hands[1]).toEqual([]);
    expect(v.decks.flat()).toEqual([]);
    expect(v.bellPlan).toEqual([]);
    for (let p = 1; p < 4; p++) expect(v.clues[p]).toEqual([]);
    for (const e of v.log) if (e.kind === "search" && e.seat !== 0) expect(e.clue).toBe(-1);
    const end = playOut(5, 4, [8, 8, 8, 8]);
    expect(end.phase).toBe("ended");
    expect(fogView(end, 0).solution).not.toBeNull();
  });

  it("wrong accusation eliminates; all wrong → no winner", () => {
    let s = startGame(2, 3);
    const sol = s.solution!;
    const wrongGuess = { ...sol, suspect: (sol.suspect + 1) % 6 };
    s = applyAction(s, { type: "ACCUSE", seat: s.turn, stage: s.stage, guess: wrongGuess });
    expect(s.eliminated.filter(Boolean).length).toBe(1);
    s = applyAction(s, { type: "ACCUSE", seat: s.turn, stage: s.stage, guess: wrongGuess });
    expect(s.phase).toBe("ended");
    expect(s.outcome?.winners).toEqual([]);
    expect(computeRankings(s).every((r) => r.rank === 3)).toBe(true);
  });

  it("timeouts pass turns and lead to dawn, then abstain → rank 2", () => {
    let s = startGame(3, 11);
    for (let i = 0; i < 200 && s.phase !== "ended"; i++) s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("ended");
    expect(s.outcome?.reason).toBe("dawn");
    expect(computeRankings(s).every((r) => r.rank === 2)).toBe(true);
    expect(s.idleStreak.every((v) => v > 2)).toBe(true);
    expect(s.log.filter((e) => e.kind === "bell").length).toBe(2);
  });

  it("rejects stale stages and out-of-turn actions", () => {
    const s = startGame(3, 1);
    const other = (s.turn + 1) % 3;
    expect(applyAction(s, { type: "SEARCH", seat: other, stage: s.stage })).toBe(s);
    expect(applyAction(s, { type: "SEARCH", seat: s.turn, stage: s.stage + 1 })).toBe(s);
    expect(applyAction(s, { type: "MOVE", seat: s.turn, stage: s.stage, room: START_ROOM })).toBe(s);
  });
});

describe("fog manor deduction + bots", () => {
  it("full deduction never rules out the truth (owner or solution)", () => {
    for (let seed = 0; seed < 25; seed++) {
      let s = startGame(4, seed * 13 + 1);
      const rng = mulberry32(seed);
      for (let step = 0; step < 120 && s.phase !== "ended"; step++) {
        const seat = pendingSeats(s).find((p) => botHasWork(s, p))!;
        s = applyAction(s, chooseBotAction(s, seat, 9, rng)!);
        if (s.phase === "ended") break;
        for (let me = 0; me < 4; me++) {
          const k = deduce(fogView(s, me), me, FULL_DEDUCE);
          const sol = s.solution!;
          for (const c of [sol.suspect, sol.weapon, sol.room]) expect(k.dom[c] & k.sol, `sol card ${c}`).toBeTruthy();
          s.hands.forEach((h, p) => h.forEach((c) => expect(k.dom[c] & (1 << p), `card ${c} of ${p}`).toBeTruthy()));
          s.vault.forEach((c) => expect(k.dom[c] & k.vault, `vault card ${c}`).toBeTruthy());
        }
      }
    }
  });

  it("bot games always finish for every player count", () => {
    for (let n = 2; n <= 6; n++) {
      for (let seed = 0; seed < 6; seed++) {
        const s = playOut(seed * 31 + n, n, Array.from({ length: n }, (_, i) => 1 + ((i * 3 + seed) % 10)));
        expect(s.phase).toBe("ended");
      }
    }
  });

  it("bots act only from their own view (secure def wraps the same)", () => {
    const s = startGame(3, 77);
    const seat = s.turn;
    const a = chooseBotAction(fogView(s, seat), seat, 10, mulberry32(1));
    const b = chooseBotAction(s, seat, 10, mulberry32(1));
    expect(a).toEqual(b);
    expect(fogSecure.view(s, seat).solution).toBeNull();
  });

  it("secure clientAction rejects TIMEOUT and malformed input", () => {
    const s = startGame(3, 5);
    expect(fogSecure.clientAction(s, 0, { type: "TIMEOUT", stage: s.stage })).toBeNull();
    expect(fogSecure.clientAction(s, 0, { type: "ACCUSE", stage: s.stage, guess: { suspect: 9, weapon: 6, room: 12 } })).toBeNull();
    const ok = fogSecure.clientAction(s, s.turn, { type: "SEARCH", stage: s.stage }) as EngineAction;
    expect(ok).toEqual({ type: "SEARCH", seat: s.turn, stage: s.stage });
  });
});
