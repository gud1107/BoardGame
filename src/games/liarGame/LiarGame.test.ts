import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  currentDescriber,
  currentPlan,
  getValidMoves,
  isCorrectGuess,
  normalize,
  pendingSeats,
  rejectReason,
  startGame,
  visibleDescriptions,
  type EngineAction,
  type GameState,
} from "./engine";
import { CATEGORIES, GENERIC_HINTS } from "./words";
import { CATEGORY_BROAD, WORD_KEYS } from "./lexicon";
import { wordEvidence } from "./engine";

function describeAll(state: GameState): GameState {
  let s = state;
  let i = 0;
  while (s.phase === "describe") {
    const seat = currentDescriber(s)!;
    s = applyAction(s, { type: "DESCRIBE", seat, text: `설명 ${i++} 번째` });
  }
  return s;
}

function readyAll(state: GameState): GameState {
  let s = state;
  for (let seat = 0; seat < s.seatCount; seat++) s = applyAction(s, { type: "READY", seat });
  return s;
}

function voteAll(state: GameState, target: (seat: number) => number): GameState {
  let s = state;
  for (const seat of [...s.voters]) s = applyAction(s, { type: "VOTE", seat, target: target(seat) });
  return s;
}

describe("words data", () => {
  it("never puts the word inside its own hints and has enough choices", () => {
    for (const cat of CATEGORIES) {
      expect(cat.words.length).toBeGreaterThanOrEqual(6);
      const names = new Set(cat.words.map((w) => w.word));
      expect(names.size).toBe(cat.words.length);
      for (const w of cat.words) {
        expect(w.hints.length).toBeGreaterThanOrEqual(4);
        for (const h of w.hints) expect(normalize(h).includes(normalize(w.word))).toBe(false);
        if (w.pair) expect(names.has(w.pair)).toBe(true);
      }
    }
  });

  it("every word has a lexicon entry and every broad phrase fits 2+ words of its category", () => {
    const misses: string[] = [];
    for (const cat of CATEGORIES) {
      for (const w of cat.words) expect(WORD_KEYS[`${cat.id}:${w.word}`], w.word).toBeTruthy();
      for (const line of CATEGORY_BROAD[cat.id] ?? []) {
        const hits = cat.words.filter((w) => wordEvidence(cat.id, w.word, line) > 0).length;
        if (hits < 2) misses.push(`${cat.id}: ${line} (${hits})`);
        for (const w of cat.words) expect(normalize(line).includes(normalize(w.word))).toBe(false);
      }
    }
    expect(misses).toEqual([]);
  });

  it("generic hints never leak any word", () => {
    for (const cat of CATEGORIES)
      for (const w of cat.words) for (const h of GENERIC_HINTS) expect(normalize(h).includes(normalize(w.word))).toBe(false);
  });
});

describe("startGame", () => {
  it("is deterministic per seed and rotates the liar", () => {
    const a = startGame(5, 42, { rounds: 5 });
    const b = startGame(5, 42, { rounds: 5 });
    expect(a.plan).toEqual(b.plan);
    expect(new Set(a.plan.map((p) => p.liarSeat)).size).toBe(5);
    for (const p of a.plan) {
      expect(p.options).toContain(p.word);
      expect(p.options.length).toBe(6);
      expect(p.fakeWord).toBeNull();
    }
  });

  it("fool mode gives the liar a different word from the same category, excluded from choices", () => {
    const s = startGame(6, 7, { rounds: 6, mode: "fool" });
    for (const p of s.plan) {
      expect(p.fakeWord).not.toBeNull();
      expect(p.fakeWord).not.toBe(p.word);
      const cat = CATEGORIES.find((c) => c.id === p.categoryId)!;
      expect(cat.words.some((w) => w.word === p.fakeWord)).toBe(true);
      expect(p.options).not.toContain(p.fakeWord);
    }
  });

  it("fixed category is respected and words don't repeat", () => {
    const s = startGame(4, 3, { rounds: 8, category: "animal" });
    expect(s.plan.every((p) => p.categoryId === "animal")).toBe(true);
    expect(new Set(s.plan.map((p) => p.word)).size).toBe(8);
  });
});

describe("describe phase", () => {
  it("hides other players' lap descriptions until everyone has written", () => {
    let s = startGame(3, 8, { laps: 2 });
    s = applyAction(s, { type: "DESCRIBE", seat: 0, text: "가나다" });
    expect(visibleDescriptions(s, 1)).toHaveLength(0);
    expect(visibleDescriptions(s, 0)).toHaveLength(1);
    s = applyAction(s, { type: "DESCRIBE", seat: 1, text: "라마바" });
    s = applyAction(s, { type: "DESCRIBE", seat: 2, text: "사아자" });
    expect(visibleDescriptions(s, 1)).toHaveLength(3);
    s = applyAction(s, { type: "DESCRIBE", seat: 2, text: "차카타" });
    expect(visibleDescriptions(s, 0).map((d) => d.text)).not.toContain("차카타");
  });

  it("goes clockwise from the first seat for the configured laps", () => {
    const s0 = startGame(4, 1, { laps: 2 });
    const first = currentPlan(s0).firstSeat;
    let s = s0;
    const order: number[] = [];
    for (let i = 0; i < 8; i++) {
      const seat = currentDescriber(s)!;
      order.push(seat);
      s = applyAction(s, { type: "DESCRIBE", seat, text: `말 ${i}` });
    }
    expect(order).toEqual([0, 1, 2, 3, 0, 1, 2, 3].map((i) => (first + i) % 4));
    expect(s.phase).toBe("discuss");
    expect(s.descriptions.filter((d) => d.lap === 2)).toHaveLength(4);
  });

  it("rejects double submits, the word itself, its chosung, and visible duplicates", () => {
    const s = startGame(4, 2, { laps: 2 });
    const plan = currentPlan(s);
    const seat = currentDescriber(s)!;
    const citizen = seat === plan.liarSeat ? (seat + 1) % 4 : seat;
    const once = applyAction(s, { type: "DESCRIBE", seat, text: "안녕" });
    expect(applyAction(once, { type: "DESCRIBE", seat, text: "또 안녕" })).toBe(once);
    expect(rejectReason(s, citizen, `완전 ${plan.word} 같아요`, "describe")).not.toBeNull();
    expect(rejectReason(s, citizen, plan.word.split("").join(" "), "describe")).not.toBeNull();
    const cho = plan.word
      .split("")
      .map((ch) => "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor((ch.charCodeAt(0) - 0xac00) / 588)])
      .join("");
    expect(rejectReason(s, citizen, cho, "describe")).not.toBeNull();
    // 같은 바퀴의 남의 설명은 아직 안 보이므로 중복으로 막지 않고, 다음 바퀴에선 막는다.
    let s2 = applyAction(s, { type: "DESCRIBE", seat, text: "따뜻해요" });
    const other = (seat + 1) % 4;
    expect(rejectReason(s2, other, "따뜻 해요!", "describe")).toBeNull();
    for (let i = 1; i < 4; i++) s2 = applyAction(s2, { type: "DESCRIBE", seat: (seat + i) % 4, text: `말 ${i}` });
    expect(s2.phase).toBe("describe");
    expect(rejectReason(s2, other, "따뜻 해요!", "describe")).not.toBeNull();
    // the classic-mode liar doesn't know the word, so it isn't blocked for them
    expect(rejectReason(s, plan.liarSeat, plan.word, "describe")).toBeNull();
  });

  it("timeout auto-passes everyone who hasn't written this lap; stale timeouts are ignored", () => {
    const s0 = startGame(3, 5);
    const writer = currentDescriber(s0)!;
    const s = applyAction(s0, { type: "DESCRIBE", seat: writer, text: "따뜻해요" });
    expect(s.stage).toBe(s0.stage); // 바퀴가 다 차기 전에는 단계(타이머)가 그대로
    const t = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(t.descriptions.filter((d) => d.auto)).toHaveLength(2);
    expect(t.idleStreak[writer]).toBe(0);
    expect(t.phase).toBe("discuss");
    expect(applyAction(t, { type: "TIMEOUT", stage: s.stage })).toBe(t);
  });
});

describe("discussion and voting", () => {
  it("all ready moves to vote; chat is kept", () => {
    let s = describeAll(startGame(4, 9));
    s = applyAction(s, { type: "CHAT", seat: 0, text: "누구지?" });
    expect(s.chat).toHaveLength(1);
    s = readyAll(s);
    expect(s.phase).toBe("vote");
  });

  it("accusing a citizen gives the liar 3 points", () => {
    let s = readyAll(describeAll(startGame(4, 11)));
    const liar = currentPlan(s).liarSeat;
    const victim = (liar + 1) % 4;
    s = voteAll(s, (seat) => (seat === victim ? (victim + 1) % 4 : victim));
    expect(s.phase).toBe("roundEnd");
    expect(s.outcome).toMatchObject({ winner: "liar", reason: "wrongAccuse", accused: victim });
    expect(s.scores[liar]).toBe(3);
  });

  it("catching the liar → guess; wrong guess gives citizens 1 + 1 bonus for liar-voters", () => {
    let s = readyAll(describeAll(startGame(5, 13)));
    const plan = currentPlan(s);
    const liar = plan.liarSeat;
    const other = (liar + 1) % 5;
    s = voteAll(s, (seat) => (seat === liar ? other : liar));
    expect(s.phase).toBe("guess");
    expect(pendingSeats(s)).toEqual([liar]);
    const wrong = plan.options.find((o) => o !== plan.word)!;
    s = applyAction(s, { type: "GUESS", seat: liar, text: wrong });
    expect(s.outcome).toMatchObject({ winner: "citizens", reason: "missed" });
    expect(s.scores[liar]).toBe(0);
    for (let seat = 0; seat < 5; seat++) if (seat !== liar) expect(s.scores[seat]).toBe(2);
  });

  it("correct guess (spacing ignored) gives the liar 2 points", () => {
    let s = readyAll(describeAll(startGame(4, 17)));
    const plan = currentPlan(s);
    s = voteAll(s, (seat) => (seat === plan.liarSeat ? (seat + 1) % 4 : plan.liarSeat));
    s = applyAction(s, { type: "GUESS", seat: plan.liarSeat, text: ` ${plan.word.split("").join(" ")} ` });
    expect(s.outcome).toMatchObject({ winner: "liar", reason: "guessed" });
    expect(s.scores[plan.liarSeat]).toBe(2);
    expect(isCorrectGuess("김치찌개", "김치 찌개!")).toBe(true);
    expect(isCorrectGuess("김치찌개", "찌개")).toBe(false);
  });

  it("tie → revote among tied by the rest; revote tie is a liar win with reason tie", () => {
    let s = readyAll(describeAll(startGame(4, 23)));
    // 0,1 → 2 ; 2,3 → 1  => 1 and 2 tied
    s = voteAll(s, (seat) => (seat < 2 ? 2 : 1));
    expect(s.phase).toBe("vote");
    expect(s.voteRound).toBe(2);
    expect([...s.candidates].sort()).toEqual([1, 2]);
    expect([...s.voters].sort()).toEqual([0, 3]);
    s = applyAction(s, { type: "VOTE", seat: 0, target: 1 });
    s = applyAction(s, { type: "VOTE", seat: 3, target: 2 });
    expect(s.phase).toBe("roundEnd");
    expect(s.outcome).toMatchObject({ winner: "liar", reason: "tie", accused: null });
  });

  it("vote timeout counts missing votes as invalid; no valid votes = liar wins", () => {
    let s = readyAll(describeAll(startGame(3, 29)));
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.outcome).toMatchObject({ winner: "liar", reason: "tie" });
  });

  it("self-votes are rejected", () => {
    const s = readyAll(describeAll(startGame(3, 31)));
    expect(applyAction(s, { type: "VOTE", seat: 1, target: 1 })).toBe(s);
  });
});

describe("rounds and ranking", () => {
  it("NEXT advances rounds and the last round ends the game", () => {
    let s = startGame(3, 37, { rounds: 2 });
    for (let r = 0; r < 2; r++) {
      s = readyAll(describeAll(s));
      s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
      expect(s.phase).toBe("roundEnd");
      s = applyAction(s, { type: "NEXT", stage: s.stage });
    }
    expect(s.phase).toBe("ended");
    expect(s.history).toHaveLength(2);
    const rk = computeRankings(s);
    expect(rk[0].rank).toBe(1);
  });

  it("ranking shares ranks on equal scores", () => {
    const s = { ...startGame(4, 1), scores: [3, 5, 3, 1] };
    expect(computeRankings(s).map((r) => [r.seat, r.rank])).toEqual([
      [1, 1],
      [0, 2],
      [2, 2],
      [3, 4],
    ]);
  });
});

describe("bots", () => {
  function runBots(seed: number, count: number, opts: Parameters<typeof startGame>[2], level = 5, liarLevel = level): GameState {
    let s = startGame(count, seed, opts);
    const rng = seededRng(seed + 1);
    for (let guard = 0; guard < 2000 && s.phase !== "ended"; guard++) {
      if (s.phase === "roundEnd") {
        s = applyAction(s, { type: "NEXT", stage: s.stage });
        continue;
      }
      const seat = pendingSeats(s)[0];
      const action = chooseBotAction(s, seat, seat === currentPlan(s).liarSeat ? liarLevel : level, rng);
      expect(action).not.toBeNull();
      const next = applyAction(s, action as EngineAction);
      expect(next).not.toBe(s);
      s = next;
    }
    return s;
  }

  it("bots finish whole games in every mode without stalling", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const count = 3 + (seed % 8);
      const s = runBots(seed, count, {
        rounds: 4,
        laps: seed % 2 === 0 ? 2 : 1,
        mode: seed % 3 === 0 ? "fool" : "classic",
        guessMode: seed % 4 === 0 ? "text" : "choice",
      });
      expect(s.phase).toBe("ended");
      expect(s.history).toHaveLength(4);
    }
  });

  it("Lv.10 citizen bots catch the same Lv.5 bot liar more often than Lv.1 citizens", () => {
    let caught10 = 0;
    let caught1 = 0;
    for (let seed = 1; seed <= 24; seed++) {
      for (const h of runBots(seed, 6, { rounds: 3, laps: 2 }, 10, 5).history) if (h.accused === h.liarSeat) caught10++;
      for (const h of runBots(seed, 6, { rounds: 3, laps: 2 }, 1, 5).history) if (h.accused === h.liarSeat) caught1++;
    }
    expect(caught10).toBeGreaterThan(caught1);
  }, 60_000);

  it("Lv.1 and Lv.10 diverge with the same rng", () => {
    let seed = 41;
    let s = readyAll(describeAll(startGame(5, seed)));
    while (currentPlan(s).liarSeat === 0) s = readyAll(describeAll(startGame(5, ++seed)));
    const plan = currentPlan(s);
    const liar = plan.liarSeat;
    const hints = CATEGORIES.find((c) => c.id === plan.categoryId)!.words.find((w) => w.word === plan.word)!.hints;
    // citizens described with real hints, the liar timed out → Lv.10 must pick the liar
    s = { ...s, descriptions: s.descriptions.map((d, i) => (d.seat === liar ? { ...d, auto: true } : { ...d, text: hints[i % hints.length] })) };
    const voter = (liar + 1) % 5;
    const zero = () => 0;
    const v10 = chooseBotAction(s, voter, 10, zero) as Extract<EngineAction, { type: "VOTE" }>;
    const v1 = chooseBotAction(s, voter, 1, zero) as Extract<EngineAction, { type: "VOTE" }>;
    const first = s.candidates.filter((c) => c !== voter)[0];
    expect(v10.target).toBe(liar);
    expect(v1.target).toBe(first);
    expect(first).not.toBe(liar);
  });

  it("getValidMoves is empty for seats that aren't pending", () => {
    const s = startGame(4, 43);
    const describer = currentDescriber(s)!;
    expect(getValidMoves(s, describer).length).toBeGreaterThan(0);
    for (const m of getValidMoves(s, describer)) expect(applyAction(s, m)).not.toBe(s);
    const after = applyAction(s, getValidMoves(s, describer)[0]);
    expect(getValidMoves(after, describer)).toEqual([]);
  });
});
