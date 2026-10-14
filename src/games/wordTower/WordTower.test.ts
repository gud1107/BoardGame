import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
  CLOSED_BLOCKS,
  COMPLETE_BONUS,
  applyAction,
  blocksFor,
  checkWord,
  chooseBotWord,
  computeRankings,
  currentLeaders,
  normalizeWord,
  reviewComplete,
  startGame,
  towerHeight,
  winnerSeats,
  type EngineAction,
  type GameState,
} from "./engine";
import { TOPICS, topicDictionary, topicWordList } from "./words";
import { CLOSED_TOPICS, closedAnswerFor } from "./closedTopics";
import { wordTowerCues } from "./wordTowerSound";
import { acceptSync, judgeOrdered, type OrderedCursor } from "./actionOrder";

const act = (s: GameState, a: EngineAction) => applyAction(s, a);
const timeout = (s: GameState) => act(s, { type: "TIMEOUT", stage: s.stage });

function building(seats = 3, seed = 7): GameState {
  return timeout(startGame(seats, seed, { rounds: 3, buildSeconds: 60 }));
}

function dictWord(s: GameState, i = 0): string {
  return topicWordList(s.topics[s.roundIndex])[i];
}

function offTopicWord(s: GameState): string {
  const dict = topicDictionary(s.topics[s.roundIndex]);
  return TOPICS.flatMap((t) => t.words).find((w) => !dict.has(w) && w.length >= 2)!;
}

describe("dictionary", () => {
  it("has 25 topics of pure-Hangul 1~8 syllable words", () => {
    expect(TOPICS.length).toBe(25);
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(25);
    for (const t of TOPICS) {
      expect(topicWordList(t.id).length, t.id).toBeGreaterThanOrEqual(60);
      for (const w of t.words) expect(w, `${t.id}:${w}`).toMatch(/^[가-힣]{1,8}$/);
    }
  });

  it("animal includes birds, sea life and insects", () => {
    const d = topicDictionary("animal");
    expect(d.has("참새")).toBe(true);
    expect(d.has("고등어")).toBe(true);
    expect(d.has("개미")).toBe(true);
  });
});

describe("word check", () => {
  it("normalizes spaces and punctuation", () => {
    expect(normalizeWord(" 아이스 크림! ")).toBe("아이스크림");
  });

  it("caps blocks at 4", () => {
    expect(blocksFor("배")).toBe(1);
    expect(blocksFor("사과")).toBe(2);
    expect(blocksFor("남아프리카공화국")).toBe(4);
  });

  it("rejects non-Hangul, too long, profanity, and own repeats", () => {
    const s = building();
    expect(checkWord(s, 0, "apple").ok).toBe(false);
    expect(checkWord(s, 0, "ㅅㄱ").ok).toBe(false);
    expect(checkWord(s, 0, "가나다라마바사아자").ok).toBe(false);
    expect(checkWord(s, 0, "개새끼").ok).toBe(false);
    const w = dictWord(s);
    const s2 = act(s, { type: "SUBMIT", seat: 0, text: w });
    expect(checkWord(s2, 0, w).ok).toBe(false);
    // 다른 사람은 같은 단어를 써도 된다
    expect(checkWord(s2, 1, w).ok).toBe(true);
  });

  it("is closed outside the build phase", () => {
    const s = startGame(2, 1);
    expect(s.phase).toBe("intro");
    expect(checkWord(s, 0, "사과").ok).toBe(false);
  });

  it("limits pending words per round", () => {
    let s = building();
    const dict = topicDictionary(s.topics[0]);
    const off = TOPICS.flatMap((t) => t.words).filter((w) => !dict.has(w));
    for (let i = 0; i < 6; i++) s = act(s, { type: "SUBMIT", seat: 0, text: off[i] });
    expect(s.entries.filter((e) => e.status === "pending").length).toBe(6);
    expect(checkWord(s, 0, off[6]).ok).toBe(false);
    expect(checkWord(s, 0, dictWord(s)).ok).toBe(true);
  });
});

describe("round flow", () => {
  it("dictionary words stack instantly; no pending → straight to result", () => {
    let s = building();
    s = act(s, { type: "SUBMIT", seat: 0, text: dictWord(s, 0) });
    s = act(s, { type: "SUBMIT", seat: 0, text: dictWord(s, 1) });
    s = act(s, { type: "SUBMIT", seat: 1, text: dictWord(s, 0) });
    expect(currentLeaders(s)).toEqual([0]);
    s = timeout(s);
    expect(s.phase).toBe("result");
    expect(s.history[0].winners).toEqual([0]);
    expect(s.wins).toEqual([1, 0, 0]);
    expect(s.streak[0]).toBe(1);
  });

  it("pending words go to review; majority approves, tie or silence rejects with -1", () => {
    let s = building(4);
    const off = offTopicWord(s);
    s = act(s, { type: "SUBMIT", seat: 0, text: dictWord(s, 0) });
    s = act(s, { type: "SUBMIT", seat: 0, text: off });
    s = act(s, { type: "SUBMIT", seat: 1, text: off });
    s = act(s, { type: "SUBMIT", seat: 2, text: off });
    expect(towerHeight(s.entries, 0, true)).toBe(blocksFor(dictWord(s, 0)) + blocksFor(off));
    s = timeout(s);
    expect(s.phase).toBe("review");
    const [p0, p1] = s.entries.filter((e) => e.status === "pending");
    // 자기 단어에는 투표할 수 없다
    expect(act(s, { type: "VOTE", seat: 0, id: p0.id, approve: true })).toBe(s);
    s = act(s, { type: "VOTE", seat: 1, id: p0.id, approve: true });
    s = act(s, { type: "VOTE", seat: 2, id: p0.id, approve: true });
    s = act(s, { type: "VOTE", seat: 3, id: p0.id, approve: false });
    s = act(s, { type: "VOTE", seat: 0, id: p1.id, approve: true });
    s = act(s, { type: "VOTE", seat: 2, id: p1.id, approve: false });
    expect(reviewComplete(s, [0, 1, 2, 3])).toBe(false);
    s = timeout(s);
    expect(s.phase).toBe("result");
    const by = (seat: number) => s.history[0].entries.find((e) => e.seat === seat && e.word === off)!.status;
    expect(by(0)).toBe("approved");
    expect(by(1)).toBe("rejected"); // 1:1 동점 → 거절
    expect(by(2)).toBe("rejected"); // 아무도 투표 안 함 → 거절
    expect(s.history[0].heights[1]).toBe(0);
    expect(s.history[0].rejected[1]).toBe(1);
  });

  it("review completes early when every voter has voted", () => {
    let s = building(2);
    s = act(s, { type: "SUBMIT", seat: 0, text: offTopicWord(s) });
    s = timeout(s);
    const id = s.entries[0].id;
    expect(reviewComplete(s, [0, 1])).toBe(false);
    s = act(s, { type: "VOTE", seat: 1, id, approve: true });
    expect(reviewComplete(s, [0, 1])).toBe(true);
  });

  it("ties: fewer rejected wins, then more words, else co-winners", () => {
    let s = building(3);
    const words = topicWordList(s.topics[0]);
    const two = words.filter((w) => w.length === 2);
    s = act(s, { type: "SUBMIT", seat: 0, text: two[0] });
    s = act(s, { type: "SUBMIT", seat: 1, text: two[0] });
    s = timeout(s);
    expect(s.history[0].winners).toEqual([0, 1]);
    expect(s.wins).toEqual([1, 1, 0]);
  });

  it("nobody wins a round where every tower is 0", () => {
    let s = building(2);
    s = timeout(s);
    expect(s.history[0].winners).toEqual([]);
    expect(s.idleStreak).toEqual([1, 1]);
  });

  it("plays through all rounds to ended with rankings by wins then totals", () => {
    let s = building(3);
    for (let r = 0; r < 3; r++) {
      if (r > 0) s = timeout(s); // intro
      s = act(s, { type: "SUBMIT", seat: r === 2 ? 1 : 0, text: dictWord(s, 0) });
      s = timeout(s); // build → result
      s = act(s, { type: "NEXT", stage: s.stage });
    }
    expect(s.phase).toBe("ended");
    expect(winnerSeats(s)).toEqual([0]);
    expect(computeRankings(s).find((r) => r.seat === 1)!.rank).toBe(2);
    expect(s.bestStreak[0]).toBe(2);
    expect(s.used[0].length).toBe(2);
  });

  it("ignores stale timeouts", () => {
    const s = building();
    expect(act(s, { type: "TIMEOUT", stage: s.stage - 1 })).toBe(s);
  });
});

describe("bots", () => {
  it("only submit valid words and stronger bots build taller towers", () => {
    const heights: Record<number, number> = { 1: 0, 10: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      let s = building(2, seed);
      const rng = seededRng(seed);
      const levels = [1, 10];
      const clock = [0, 0];
      // 60초 시뮬레이션
      for (;;) {
        const seat = clock[0] <= clock[1] ? 0 : 1;
        clock[seat] += 8000 - ((levels[seat] - 1) * 5700) / 9;
        if (clock[seat] > 60_000) break;
        const word = chooseBotWord(s, seat, levels[seat], rng);
        if (!word) continue;
        expect(checkWord(s, seat, word).ok).toBe(true);
        s = act(s, { type: "SUBMIT", seat, text: word });
      }
      heights[1] += towerHeight(s.entries, 0);
      heights[10] += towerHeight(s.entries, 1);
    }
    expect(heights[10]).toBeGreaterThan(heights[1] * 2);
  });
});

describe("🎯 정답 모으기 mode", () => {
  function closedBuilding(seats = 3, seed = 11): GameState {
    return timeout(startGame(seats, seed, { rounds: 3, buildSeconds: 45, mode: "closed" }));
  }
  const topicOf = (s: GameState) => CLOSED_TOPICS.find((t) => t.id === s.topics[s.roundIndex])!;

  it("closed topics have 4~10 Hangul answers and no clashing aliases", () => {
    expect(CLOSED_TOPICS.length).toBeGreaterThanOrEqual(50);
    for (const t of CLOSED_TOPICS) {
      expect(t.answers.length, t.id).toBeGreaterThanOrEqual(4);
      expect(t.answers.length, t.id).toBeLessThanOrEqual(10);
      const seen = new Map<string, string>();
      for (const ans of t.answers) {
        for (const w of [ans.word, ...(ans.aliases ?? [])]) {
          expect(w, `${t.id}:${w}`).toMatch(/^[가-힣]{1,8}$/);
          expect(seen.has(w), `${t.id}: ${w} used twice`).toBe(false);
          seen.set(w, ans.word);
          expect(closedAnswerFor(t.id, w)).toBe(ans.word);
        }
      }
    }
  });

  it("draws only closed topics", () => {
    const s = startGame(2, 5, { rounds: 7, mode: "closed" });
    expect(s.topics.every((id) => CLOSED_TOPICS.some((t) => t.id === id))).toBe(true);
    expect(startGame(2, 5).options.mode).toBe("open");
  });

  it("aliases count as the same answer; wrong answers cost a floor without review", () => {
    let s = closedBuilding();
    const t = topicOf(s);
    const withAlias = t.answers.find((x) => x.aliases?.length) ?? t.answers[0];
    const alias = withAlias.aliases?.[0] ?? withAlias.word;
    s = act(s, { type: "SUBMIT", seat: 0, text: alias });
    expect(s.entries[0]).toMatchObject({ word: withAlias.word, status: "ok", blocks: CLOSED_BLOCKS });
    expect(checkWord(s, 0, withAlias.word).ok).toBe(false); // 이미 찾은 정답
    s = act(s, { type: "SUBMIT", seat: 0, text: "가나다" });
    expect(s.entries[1].status).toBe("rejected");
    expect(towerHeight(s.entries, 0)).toBe(CLOSED_BLOCKS - 1);
    s = timeout(s);
    expect(s.phase).toBe("result"); // 심사 없음
  });

  it("answers are first come, first served; a simultaneous loser is logged as late with no penalty", () => {
    let s = closedBuilding(3);
    const t = topicOf(s);
    const first = t.answers[0].word;
    s = act(s, { type: "SUBMIT", seat: 0, text: first });
    // 이미 차지된 정답은 다른 사람이 낼 수 없다(입력 단계에서 막힘)
    const c = checkWord(s, 1, first);
    expect(c.ok).toBe(false);
    // 거의 동시에 보내 엔진에 도착한 경우: 한발 늦음 기록, 0층
    s = act(s, { type: "SUBMIT", seat: 1, text: first });
    expect(s.entries[1]).toMatchObject({ seat: 1, word: first, status: "late", blocks: 0 });
    expect(towerHeight(s.entries, 1)).toBe(0);
    // 같은 늦음은 한 번만 기록
    expect(act(s, { type: "SUBMIT", seat: 1, text: first }).entries.length).toBe(2);
  });

  it("the round ends as soon as every answer is claimed; one player taking all gets the sweep bonus", () => {
    let s = closedBuilding(2);
    const t = topicOf(s);
    for (const ans of t.answers) s = act(s, { type: "SUBMIT", seat: 0, text: ans.word });
    expect(s.phase).toBe("result");
    const rec = s.history[0];
    expect(rec.heights[0]).toBe(t.answers.length * CLOSED_BLOCKS + COMPLETE_BONUS);
    expect(rec.accepted[0]).toBe(t.answers.length);
    expect(rec.entries.filter((e) => e.bonus).length).toBe(1);
    expect(rec.winners).toEqual([0]);
  });

  it("sound cues: another player's claim rings an alert, the last open answer gets a sting", () => {
    let s = closedBuilding(2);
    const t = topicOf(s);
    const cues = wordTowerCues(0);
    const names = (prev: GameState, next: GameState) => cues(prev, next).map((c) => (typeof c === "string" ? c : c.name));
    // 남의 정답 → claimed, 내 정답 → place
    let next = act(s, { type: "SUBMIT", seat: 1, text: t.answers[0].word });
    expect(names(s, next)).toEqual(["claimed"]);
    s = next;
    next = act(s, { type: "SUBMIT", seat: 0, text: t.answers[1].word });
    expect(names(s, next)).toEqual(["place"]);
    s = next;
    // 정답이 하나 남는 순간 lastOne — 그 전에는 없음
    for (let i = 2; i < t.answers.length - 1; i++) {
      next = act(s, { type: "SUBMIT", seat: 1, text: t.answers[i].word });
      expect(names(s, next).includes("lastOne")).toBe(i === t.answers.length - 2);
      s = next;
    }
  });

  it("split answers end the round too, without a sweep bonus", () => {
    let s = closedBuilding(2);
    const t = topicOf(s);
    t.answers.forEach((ans, i) => {
      s = act(s, { type: "SUBMIT", seat: i % 2, text: ans.word });
    });
    expect(s.phase).toBe("result");
    expect(s.history[0].entries.some((e) => e.bonus)).toBe(false);
  });

  it("the same answer is allowed again in a later round (e.g. 도 in 계이름 and 윷놀이)", () => {
    const yut = CLOSED_TOPICS.find((t) => t.id === "c-yut")!;
    const sol = CLOSED_TOPICS.find((t) => t.id === "c-solfege")!;
    expect(closedAnswerFor(yut.id, "도")).toBe("도");
    expect(closedAnswerFor(sol.id, "도")).toBe("도");
  });

  it("bots only submit answers or plain wrong guesses, and Lv.10 finds more", () => {
    const found: Record<number, number> = { 1: 0, 10: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      let s = closedBuilding(2, seed);
      const rng = seededRng(seed);
      for (let i = 0; i < 14; i++) {
        for (const [seat, level] of [[0, 1], [1, 10]] as const) {
          const w = chooseBotWord(s, seat, level, rng);
          if (!w) continue;
          expect(checkWord(s, seat, w).ok).toBe(true);
          s = act(s, { type: "SUBMIT", seat, text: w });
        }
      }
      found[1] += s.entries.filter((e) => e.seat === 0 && e.status === "ok").length;
      found[10] += s.entries.filter((e) => e.seat === 1 && e.status === "ok").length;
    }
    expect(found[10]).toBeGreaterThan(found[1]);
  });
});

describe("closed topic notes", () => {
  it("every closed topic has a short note shown after the round", async () => {
    const { CLOSED_BY_ID } = await import("./closedTopics");
    for (const t of CLOSED_TOPICS) {
      const note = CLOSED_BY_ID.get(t.id)?.note ?? "";
      expect(note.length, t.id).toBeGreaterThan(10);
      expect(note.length, t.id).toBeLessThanOrEqual(90);
    }
  });
});

describe("topic categories", () => {
  it("every topic belongs to exactly one category of its mode", async () => {
    const { CATEGORIES } = await import("./categories");
    for (const [mode, ids] of [["open", TOPICS.map((t) => t.id)], ["closed", CLOSED_TOPICS.map((t) => t.id)]] as const) {
      const cats = CATEGORIES.filter((c) => c.mode === mode);
      for (const id of ids) expect(cats.filter((c) => c.topicIds.includes(id)).length, `${mode}:${id}`).toBe(1);
      for (const c of cats) for (const id of c.topicIds) expect(ids, `${c.id}:${id}`).toContain(id);
    }
  });

  it("draws only from the chosen categories and caps rounds at the pool size", async () => {
    const { CATEGORIES } = await import("./categories");
    const geo = CATEGORIES.find((c) => c.id === "c-geo")!;
    const s = startGame(2, 9, { mode: "closed", rounds: 7, categories: ["c-geo"] });
    expect(s.options.rounds).toBe(geo.topicIds.length);
    expect(s.topics.every((id) => geo.topicIds.includes(id))).toBe(true);
    expect(new Set(s.topics).size).toBe(s.topics.length);
    // 다른 모드의 카테고리는 무시 → 전체
    const t = startGame(2, 9, { mode: "open", rounds: 5, categories: ["c-geo"] });
    expect(t.options.categories).toEqual([]);
    expect(t.topics.length).toBe(5);
    // 여러 카테고리
    const u = startGame(2, 3, { mode: "open", rounds: 7, categories: ["o-food", "o-life"] });
    const allowed = CATEGORIES.filter((c) => c.id === "o-food" || c.id === "o-life").flatMap((c) => c.topicIds);
    expect(u.topics.every((id) => allowed.includes(id))).toBe(true);
  });
});

describe("answer count scales with players (정답 모으기)", () => {
  it("big tables only get topics with many answers when enough exist", async () => {
    const { minAnswersFor } = await import("./engine");
    const { CLOSED_BY_ID } = await import("./closedTopics");
    expect([2, 3, 4, 5, 6, 7, 8].map(minAnswersFor)).toEqual([4, 4, 5, 6, 7, 8, 8]);
    for (let seed = 1; seed <= 20; seed++) {
      const s = startGame(8, seed, { mode: "closed", rounds: 7 });
      expect(s.topics.every((id) => CLOSED_BY_ID.get(id)!.answers.length >= 8)).toBe(true);
      expect(new Set(s.topics).size).toBe(7);
    }
    // 2명이면 정답 4개짜리도 나올 수 있다
    const small = Array.from({ length: 30 }, (_, i) => startGame(2, i + 1, { mode: "closed", rounds: 7 })).flatMap((s) => s.topics);
    expect(small.some((id) => CLOSED_BY_ID.get(id)!.answers.length === 4)).toBe(true);
  });

  it("falls back to the largest topics when the categories are too small", async () => {
    const { CLOSED_BY_ID } = await import("./closedTopics");
    const s = startGame(8, 4, { mode: "closed", rounds: 5, categories: ["c-east"] });
    expect(s.topics.length).toBe(5);
    const sizes = s.topics.map((id) => CLOSED_BY_ID.get(id)!.answers.length).sort((a, b) => b - a);
    expect(sizes[0]).toBe(10); // 십간
    expect(sizes).toEqual([10, 5, 5, 4, 4]);
  });
});

describe("방장 판정 순서 (actionOrder)", () => {
  it("applies host numbers strictly in order and asks for a resync on a gap", () => {
    const c: OrderedCursor = { game: 42, applied: 0 };
    expect(judgeOrdered(c, 42, 1)).toBe("apply");
    c.applied = 1;
    expect(judgeOrdered(c, 42, 1)).toBe("duplicate");
    expect(judgeOrdered(c, 42, 3)).toBe("gap");
    expect(judgeOrdered(c, 7, 2)).toBe("other-game");
    expect(acceptSync(c, 42, 1)).toBe(false);
    expect(acceptSync(c, 42, 5)).toBe(true);
    expect(acceptSync(null, 42, 0)).toBe(true);
  });

  it("two devices receiving the same host-numbered stream end up identical even when packets arrive shuffled", () => {
    // 거의 동시에 같은 정답을 낸 두 사람 — 방장이 정한 번호대로만 적용하면 기기 간 결과가 같다.
    const base = timeout(startGame(3, 11, { rounds: 3, buildSeconds: 45, mode: "closed" }));
    const t = CLOSED_TOPICS.find((x) => x.id === base.topics[0])!;
    const stream = [
      { seq: 1, action: { type: "SUBMIT", seat: 2, text: t.answers[0].word } as EngineAction },
      { seq: 2, action: { type: "SUBMIT", seat: 1, text: t.answers[0].word } as EngineAction },
      { seq: 3, action: { type: "SUBMIT", seat: 1, text: t.answers[1].word } as EngineAction },
    ];
    const replay = (arrival: typeof stream) => {
      const cur: OrderedCursor = { game: 1, applied: 0 };
      let s = base;
      const pending = [...arrival];
      // 도착 순서가 섞여도 번호가 맞을 때까지 기다렸다 적용(실제 코드는 빠지면 재동기화)
      while (pending.length) {
        const i = pending.findIndex((m) => judgeOrdered(cur, 1, m.seq) === "apply");
        const [m] = pending.splice(i, 1);
        s = applyAction(s, m.action);
        cur.applied += 1;
      }
      return s;
    };
    const a = replay(stream);
    const b = replay([stream[2], stream[1], stream[0]]);
    expect(a.entries).toEqual(b.entries);
    expect(a.entries[0]).toMatchObject({ seat: 2, status: "ok" });
    expect(a.entries[1]).toMatchObject({ seat: 1, status: "late" });
  });
});
