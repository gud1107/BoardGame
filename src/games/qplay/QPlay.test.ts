import { describe, expect, it } from "vitest";
import {
  CHOICE_POINTS,
  CHOSUNG_POINTS,
  CLIMB_TOP,
  LAST_SURVIVOR,
  MINI_IDS,
  MISSILE_DEFEND,
  MISSILE_HIT,
  MISSILE_HP,
  MISSILE_HP_POINTS,
  MISSILE_KILL,
  OX_CORRECT,
  OX_SURVIVE,
  allAnswered,
  applyAction,
  autoTarget,
  buildClimbQuestions,
  buildQuestion,
  chooseBotChoice,
  chooseBotClimb,
  chooseBotTarget,
  chooseBotTyping,
  computeRankings,
  currentMini,
  currentQuestion,
  startGame,
  toChosung,
  winnerSeats,
  type EngineAction,
  type GameState,
  type MiniId,
} from "./engine";
import { GENERAL_BANK, IDIOM_BANK, NONSENSE_BANK, OX_BANK, PROVERB_BANK } from "./questions";
import { qplayCues } from "./qplaySound";

const act = (s: GameState, a: EngineAction) => applyAction(s, a);
const timeout = (s: GameState) => act(s, { type: "TIMEOUT", stage: s.stage });

/** 그 미니 게임 하나만 하는 판을 만들어 문제 단계까지 진행. */
function only(mini: MiniId, seats = 3, seed = 11): GameState {
  return timeout(startGame(seats, seed, { minis: [mini], rounds: 1, length: "normal" }));
}

function answerAll(s: GameState, pick: (seat: number, answer: number) => number): GameState {
  const q = currentQuestion(s)!;
  let next = s;
  for (let seat = 0; seat < s.seatCount; seat++) next = act(next, { type: "ANSWER", seat, q: s.qIndex, choice: pick(seat, q.answer) });
  return next;
}

const wrongOf = (s: GameState, answer: number) => (answer + 1) % currentQuestion(s)!.choices.length;

describe("question bank", () => {
  it("has enough unique items with 3 distinct distractors", () => {
    expect(OX_BANK.length).toBeGreaterThanOrEqual(60);
    expect(PROVERB_BANK.length).toBeGreaterThanOrEqual(60);
    expect(IDIOM_BANK.length).toBeGreaterThanOrEqual(50);
    expect(NONSENSE_BANK.length).toBeGreaterThanOrEqual(35);
    expect(GENERAL_BANK.length).toBeGreaterThanOrEqual(70);
    expect(new Set(OX_BANK.map((q) => q.q)).size).toBe(OX_BANK.length);
    expect(new Set(PROVERB_BANK.map((q) => q.back)).size).toBe(PROVERB_BANK.length);
    expect(new Set(IDIOM_BANK.map((q) => q.word)).size).toBe(IDIOM_BANK.length);
    for (const it of IDIOM_BANK) expect(it.word, it.word).toMatch(/^[가-힣]{4}$/);
    for (const it of [...NONSENSE_BANK, ...GENERAL_BANK]) {
      expect(new Set([it.a, ...it.wrong]).size, it.q).toBe(4);
    }
  });

  it("builds choice questions whose answer index points to the right text", () => {
    for (let i = 0; i < PROVERB_BANK.length; i++) {
      const q = buildQuestion("proverb", i, 0, () => 0.42);
      expect(q.choices[q.answer]).toBe(PROVERB_BANK[i].back);
      expect(new Set(q.choices).size).toBe(4);
    }
    for (let i = 0; i < IDIOM_BANK.length; i++) {
      const a = buildQuestion("idiom", i, 0, Math.random);
      expect(a.choices[a.answer]).toBe(IDIOM_BANK[i].word);
      const b = buildQuestion("idiom", i, 1, Math.random);
      expect(b.choices[b.answer]).toBe(IDIOM_BANK[i].mean);
    }
  });

  it("never offers a same-group proverb/idiom as a distractor", () => {
    for (let i = 0; i < PROVERB_BANK.length; i++) {
      const g = PROVERB_BANK[i].g;
      if (!g) continue;
      for (let t = 0; t < 20; t++) {
        const q = buildQuestion("proverb", i, 0, Math.random);
        const groups = q.choices.map((c) => PROVERB_BANK.find((p) => p.back === c)?.g);
        expect(groups.filter((x) => x === g).length).toBe(1);
      }
    }
  });

  it("computes chosung and accepts every same-chosung word of the topic", () => {
    expect(toChosung("사과")).toBe("ㅅㄱ");
    expect(toChosung("까치")).toBe("ㄲㅊ");
    const q = buildQuestion("chosung", 0, 0, Math.random);
    expect(q.accepted).toContain(q.word);
    for (const w of q.accepted!) expect(toChosung(w)).toBe(q.chosung);
  });

  it("climb questions are deterministic 3-choice with a single right answer", () => {
    const a = buildClimbQuestions(5);
    expect(a).toEqual(buildClimbQuestions(5));
    expect(a.length).toBe(80);
    for (const q of a) {
      expect(q.choices.length).toBe(3);
      expect(new Set(q.choices).size).toBe(3);
      const nums = q.choices.map(Number);
      const right = nums[q.answer];
      const m = q.prompt.match(/^(\d+) ([+−×]) (\d+)/);
      if (m) {
        const [x, op, y] = [Number(m[1]), m[2], Number(m[3])];
        expect(right).toBe(op === "+" ? x + y : op === "−" ? x - y : x * y);
      } else if (q.prompt === "가장 큰 수는?") expect(right).toBe(Math.max(...nums));
      else {
        expect(right % 2).toBe(0);
        expect(nums.filter((v) => v % 2 === 0).length).toBe(1);
      }
    }
  });
});

describe("game setup", () => {
  it("is deterministic per seed and plays every chosen mini", () => {
    const a = startGame(4, 99, { rounds: 8 });
    expect(a).toEqual(startGame(4, 99, { rounds: 8 }));
    expect(new Set(a.plan)).toEqual(new Set(MINI_IDS));
  });

  it("repeats minis when rounds exceed the pool without repeating questions", () => {
    let s = startGame(2, 3, { minis: ["general"], rounds: 3, length: "long" });
    const seen = new Set<string>();
    while (s.phase !== "ended") {
      for (const q of s.questions) {
        if (s.phase === "intro" && s.qIndex === 0) {
          expect(seen.has(q.prompt)).toBe(false);
          seen.add(q.prompt);
        }
      }
      s = timeout(s);
    }
    expect(seen.size).toBe(24);
  });
});

describe("speed choice scoring (§3)", () => {
  it("awards 30/25/20 by answer order and nothing for wrong", () => {
    let s = only("nonsense", 4);
    const q = currentQuestion(s)!;
    const wrong = (q.answer + 1) % 4;
    s = act(s, { type: "ANSWER", seat: 2, q: 0, choice: q.answer });
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: wrong });
    s = act(s, { type: "ANSWER", seat: 3, q: 0, choice: q.answer });
    s = act(s, { type: "ANSWER", seat: 3, q: 0, choice: wrong }); // 중복은 무시
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: q.answer });
    expect(allAnswered(s)).toBe(true);
    s = timeout(s);
    expect(s.phase).toBe("reveal");
    expect(s.gained).toEqual([0, CHOICE_POINTS[2], CHOICE_POINTS[0], CHOICE_POINTS[1]]);
  });

  it("ignores answers for an old question or bad choice", () => {
    const s = only("general", 2);
    expect(act(s, { type: "ANSWER", seat: 0, q: 5, choice: 0 })).toBe(s);
    expect(act(s, { type: "ANSWER", seat: 0, q: 0, choice: 9 })).toBe(s);
  });
});

describe("OX survival (§4)", () => {
  it("eliminates the wrong, revives when everyone is wrong, pays survivors", () => {
    let s = only("ox", 3);
    // 1번 문제: 0번만 오답 → 탈락
    s = answerAll(s, (seat, a) => (seat === 0 ? 1 - a : a));
    s = timeout(s);
    expect(s.eliminated).toEqual([0]);
    expect(s.alive).toEqual([false, true, true]);
    expect(s.gained).toEqual([0, OX_CORRECT, OX_CORRECT]);
    s = timeout(s);
    // 탈락자 답은 무시
    expect(act(s, { type: "ANSWER", seat: 0, q: s.qIndex, choice: 0 })).toBe(s);
    // 2번 문제: 살아 있는 둘 다 오답 → 전원 부활
    s = answerAll(s, (_, a) => 1 - a);
    s = timeout(s);
    expect(s.revived).toBe(true);
    expect(s.alive).toEqual([false, true, true]);
    s = timeout(s);
    // 3번 문제: 2번 무응답 → 탈락, 1명 남아 끝
    s = act(s, { type: "ANSWER", seat: 1, q: s.qIndex, choice: currentQuestion(s)!.answer });
    s = timeout(s);
    expect(s.alive).toEqual([false, true, false]);
    s = timeout(s);
    expect(s.phase).toBe("miniEnd");
    expect(s.miniScores[1]).toBe(OX_CORRECT * 2 + OX_SURVIVE);
    expect(s.history[0].winners).toEqual([1]);
    expect(s.stats.oxSurvived).toEqual([0, 1, 0]);
  });
});

describe("chosung (§9)", () => {
  it("allows 3 wrong tries, ranks correct typers and ends early", () => {
    let s = only("chosung", 3);
    const q = currentQuestion(s)!;
    s = act(s, { type: "TYPE", seat: 0, q: 0, text: "가나다라" });
    s = act(s, { type: "TYPE", seat: 0, q: 0, text: "가나다라" }); // 같은 오답은 시도로 안 침
    expect(s.answers[0].wrongs).toEqual(["가나다라"]);
    s = act(s, { type: "TYPE", seat: 1, q: 0, text: ` ${q.word} ` });
    s = act(s, { type: "TYPE", seat: 0, q: 0, text: q.accepted![q.accepted!.length - 1] });
    expect(allAnswered(s)).toBe(false);
    for (const t of ["뷁", "뷀", "뷂"]) s = act(s, { type: "TYPE", seat: 2, q: 0, text: t });
    expect(allAnswered(s)).toBe(true);
    s = timeout(s);
    expect(s.gained).toEqual([CHOSUNG_POINTS[1], CHOSUNG_POINTS[0], 0]);
    expect(s.stats.chosungFirst).toEqual([0, 1, 0]);
  });
});

describe("climb (§10)", () => {
  it("moves up on right, down on wrong (not below 0), finishes at the top", () => {
    let s = only("climb", 2);
    expect(s.phase).toBe("climb");
    const step = (st: GameState, seat: number, right: boolean) => {
      const q = st.questions[st.climbIdx[seat]];
      return act(st, { type: "CLIMB", seat, idx: st.climbIdx[seat], choice: right ? q.answer : (q.answer + 1) % 3 });
    };
    s = step(s, 1, false);
    expect(s.floor[1]).toBe(0);
    expect(act(s, { type: "CLIMB", seat: 1, idx: 0, choice: 0 })).toBe(s); // 옛 번호
    for (let i = 0; i < CLIMB_TOP; i++) s = step(s, 0, true);
    expect(s.finishOrder).toEqual([0]);
    s = step(s, 1, true);
    s = step(s, 1, true);
    s = step(s, 1, false);
    expect(s.floor[1]).toBe(1);
    s = timeout(s);
    expect(s.phase).toBe("miniEnd");
    expect(s.miniScores).toEqual([CLIMB_TOP * 5 + 40, 5]);
    expect(s.stats.climbFirst).toEqual([1, 0]);
  });

  it("ends early when everyone reaches the top", () => {
    let s = only("climb", 2);
    for (const seat of [0, 1]) for (let i = 0; i < CLIMB_TOP; i++) s = act(s, { type: "CLIMB", seat, idx: s.climbIdx[seat], choice: s.questions[s.climbIdx[seat]].answer });
    expect(s.phase).toBe("miniEnd");
    expect(s.miniScores).toEqual([CLIMB_TOP * 5 + 40, CLIMB_TOP * 5 + 25]);
  });
});

describe("missile (§11)", () => {
  it("first correct aims and fires; others defend; kills eliminate", () => {
    let s = only("missile", 3);
    expect(s.hp).toEqual([MISSILE_HP, MISSILE_HP, MISSILE_HP]);
    const q = currentQuestion(s)!;
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: q.answer });
    s = act(s, { type: "ANSWER", seat: 2, q: 0, choice: q.answer });
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: wrongOf(s, q.answer) });
    s = timeout(s);
    expect(s.phase).toBe("aim");
    expect(s.shooter).toBe(1);
    expect(act(s, { type: "FIRE", seat: 2, target: 0 })).toBe(s); // 쏠 사람이 아님
    expect(act(s, { type: "FIRE", seat: 1, target: 1 })).toBe(s); // 자기 자신
    s = act(s, { type: "FIRE", seat: 1, target: 0 });
    expect(s.phase).toBe("reveal");
    expect(s.hp).toEqual([2, 3, 3]);
    expect(s.gained).toEqual([0, MISSILE_HIT, MISSILE_DEFEND]);
  });

  it("auto-targets the most hearts on timeout and pays the last survivor", () => {
    let s = startGame(2, 5, { minis: ["missile"], rounds: 1 });
    s = timeout(s);
    for (let i = 0; i < MISSILE_HP; i++) {
      s = act(s, { type: "ANSWER", seat: 0, q: s.qIndex, choice: currentQuestion(s)!.answer });
      s = timeout(s);
      expect(s.phase).toBe("aim");
      expect(autoTarget(s, 0)).toBe(1);
      s = timeout(s);
      expect(s.shot?.auto).toBe(true);
      s = timeout(s);
    }
    expect(s.phase).toBe("miniEnd");
    expect(s.alive).toEqual([true, false]);
    expect(s.miniScores[0]).toBe(MISSILE_HIT * 3 + MISSILE_KILL + MISSILE_HP * MISSILE_HP_POINTS + LAST_SURVIVOR);
    expect(s.stats.kills).toEqual([1, 0]);
  });

  it("goes straight to reveal when nobody is right", () => {
    let s = only("missile", 2);
    s = answerAll(s, (_, a) => wrongOf(s, a));
    s = timeout(s);
    expect(s.phase).toBe("reveal");
    expect(s.shot).toBeNull();
  });
});

describe("bots", () => {
  it("bots finish a full 8-mini game at every level without stalling", () => {
    for (const level of [1, 5, 10]) {
      let s = startGame(4, 1000 + level, { rounds: 8, length: "short" });
      let guard = 0;
      while (s.phase !== "ended" && guard++ < 5000) {
        if (s.phase === "question") {
          for (let seat = 0; seat < s.seatCount; seat++) {
            if (currentMini(s) === "chosung") {
              const t = chooseBotTyping(s, seat, level);
              if (t) s = act(s, { type: "TYPE", seat, q: s.qIndex, text: t });
            } else {
              const c = chooseBotChoice(s, level);
              if (c !== null) s = act(s, { type: "ANSWER", seat, q: s.qIndex, choice: c });
            }
          }
        } else if (s.phase === "aim") {
          s = act(s, { type: "FIRE", seat: s.shooter!, target: chooseBotTarget(s, s.shooter!)! });
          continue;
        } else if (s.phase === "climb") {
          for (let k = 0; k < 40 && s.phase === "climb"; k++) {
            for (let seat = 0; seat < s.seatCount && s.phase === "climb"; seat++) {
              const m = chooseBotClimb(s, seat, level);
              if (m) s = act(s, { type: "CLIMB", seat, ...m });
            }
          }
          if (s.phase !== "climb") continue;
        }
        s = timeout(s);
      }
      expect(s.phase).toBe("ended");
      expect(s.history.length).toBe(8);
      expect(winnerSeats(s).length).toBeGreaterThanOrEqual(1);
      expect(computeRankings(s)[0].score).toBeGreaterThan(0);
    }
  });

  it("higher level bots are more accurate", () => {
    const s = only("general", 2);
    const q = currentQuestion(s)!;
    const rate = (level: number) => {
      let ok = 0;
      for (let i = 0; i < 2000; i++) if (chooseBotChoice(s, level) === q.answer) ok++;
      return ok / 2000;
    };
    expect(rate(10)).toBeGreaterThan(rate(5) + 0.15);
    expect(rate(5)).toBeGreaterThan(rate(1) + 0.15);
  });

  it("bot targets a one-heart player to finish them", () => {
    let s = only("missile", 3);
    s = { ...s, hp: [3, 3, 1], scores: [0, 100, 0], phase: "aim", shooter: 0 };
    expect(chooseBotTarget(s, 0)).toBe(2);
    s = { ...s, hp: [3, 3, 3] };
    expect(chooseBotTarget(s, 0)).toBe(1);
  });
});

describe("ranking & sound cues", () => {
  it("ties on score break by mini wins, then shared", () => {
    const s = { ...startGame(3, 1), scores: [50, 50, 10], miniWins: [1, 2, 0] };
    expect(computeRankings(s).map((r) => [r.seat, r.rank])).toEqual([
      [1, 1],
      [0, 2],
      [2, 3],
    ]);
    const t = { ...s, miniWins: [1, 1, 0] };
    expect(winnerSeats(t)).toEqual([0, 1]);
  });

  it("plays correct/wrong for the viewer and a fire cue on a missile hit", () => {
    let s = only("missile", 2);
    const q = currentQuestion(s)!;
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: q.answer });
    const aim = timeout(s);
    expect(qplayCues(0)(s, aim)).toEqual(["correct", "aim"]);
    expect(qplayCues(1)(s, aim)).toEqual(["wrong", "aim"]);
    const hit = act(aim, { type: "FIRE", seat: 0, target: 1 });
    expect(qplayCues(1)(aim, hit)).toContain("fire");
  });
});
