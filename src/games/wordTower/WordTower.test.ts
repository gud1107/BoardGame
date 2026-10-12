import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import {
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
