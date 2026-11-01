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
  OX_CORRECT,
  OX_SURVIVE,
  allAnswered,
  bankOrder,
  phaseDurationMs,
  chooseBotOxPlan,
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
    s = act(s, { type: "ANSWER", seat: 3, q: 0, choice: q.answer }); // 같은 답 다시 = 무시(순서 유지)
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: q.answer });
    expect(allAnswered(s)).toBe(true);
    s = timeout(s);
    expect(s.phase).toBe("reveal");
    expect(s.gained).toEqual([0, CHOICE_POINTS[2], CHOICE_POINTS[0], CHOICE_POINTS[1]]);
  });

  it("공개 전엔 답을 바꿀 수 있고, 바꾸면 선착순 줄의 맨 뒤로", () => {
    let s = only("nonsense", 3);
    const q = currentQuestion(s)!;
    const wrong = (q.answer + 1) % 4;
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: wrong });
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: q.answer });
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: q.answer }); // 오답 → 정답으로 바꿈
    s = act(s, { type: "ANSWER", seat: 2, q: 0, choice: q.answer });
    s = act(s, { type: "ANSWER", seat: 2, q: 0, choice: wrong }); // 정답 → 오답으로 바꿈
    expect(s.answers[0]?.correct).toBe(true);
    expect(s.answers[2]?.correct).toBe(false);
    s = timeout(s);
    // 1등은 처음부터 정답이던 1번, 0번은 바꾼 시점 순서라 2등
    expect(s.gained).toEqual([CHOICE_POINTS[1], CHOICE_POINTS[0], 0]);
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

describe("OX ghosts (§4)", () => {
  it("eliminated players predict as ghosts — counted per OX game, never scored", () => {
    let s = only("ox", 3);
    let a = currentQuestion(s)!.answer;
    // 1번: 0번 탈락
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: 1 - a });
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: a });
    s = act(s, { type: "ANSWER", seat: 2, q: 0, choice: a });
    // 산 사람은 유령 행동을 못 한다
    expect(act(s, { type: "GHOST", seat: 1, q: 0, choice: a })).toBe(s);
    s = timeout(s);
    expect(s.alive).toEqual([false, true, true]);
    s = timeout(s); // 2번 문제
    a = currentQuestion(s)!.answer;
    s = act(s, { type: "GHOST", seat: 0, q: s.qIndex, choice: 1 - a });
    s = act(s, { type: "GHOST", seat: 0, q: s.qIndex, choice: a }); // 유령도 옮겨 다닌다
    expect(act(s, { type: "GHOST", seat: 0, q: s.qIndex, choice: a })).toBe(s);
    expect(act(s, { type: "GHOST", seat: 0, q: s.qIndex, choice: 5 })).toBe(s);
    s = act(s, { type: "ANSWER", seat: 1, q: s.qIndex, choice: a });
    s = act(s, { type: "ANSWER", seat: 2, q: s.qIndex, choice: a });
    const before = s.miniScores[0];
    s = timeout(s);
    expect(s.ghostHits[0]).toBe(1);
    expect(s.ghostTries[0]).toBe(1);
    expect(s.miniScores[0]).toBe(before);
    expect(s.alive[0]).toBe(false);
    s = timeout(s); // 3번 — 유령 자리는 새 문제마다 비운다
    expect(s.ghosts).toEqual({});
  });
});

describe("OX free movement (§4)", () => {
  it("lets players switch sides until time runs out — where they stand at the end counts", () => {
    let s = only("ox", 2);
    const a = currentQuestion(s)!.answer;
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: a });
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: a });
    // 모두 자리를 잡아도 시간이 끝날 때까지 기다린다
    expect(allAnswered(s)).toBe(false);
    s = act(s, { type: "ANSWER", seat: 0, q: 0, choice: 1 - a });
    expect(s.answers[0].correct).toBe(false);
    const same = act(s, { type: "ANSWER", seat: 0, q: 0, choice: 1 - a });
    expect(same).toBe(s);
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: 1 - a });
    s = act(s, { type: "ANSWER", seat: 1, q: 0, choice: a });
    s = timeout(s);
    expect(s.eliminated).toEqual([0]);
    expect(s.alive).toEqual([false, true]);
  });

  it("bot plans end on the bot's final choice", () => {
    const s = only("ox", 2);
    for (let i = 0; i < 50; i++) {
      const plan = chooseBotOxPlan(s, 5);
      expect(plan.length).toBeGreaterThan(0);
      for (const c of plan) expect([0, 1]).toContain(c);
    }
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
    expect(s.hp).toEqual([2, 3, 3]); // 틀린 0번은 바로 하트 −1
    expect(s.missed).toEqual([0]);
    expect(act(s, { type: "FIRE", seat: 2, target: 0 })).toBe(s); // 쏠 사람이 아님
    expect(act(s, { type: "FIRE", seat: 1, target: 1 })).toBe(s); // 자기 자신
    s = act(s, { type: "FIRE", seat: 1, target: 0 });
    expect(s.phase).toBe("reveal");
    expect(s.hp).toEqual([1, 3, 3]);
    expect(s.gained).toEqual([0, MISSILE_HIT, MISSILE_DEFEND]);
  });

  it("안 고르면 틀린 것 — 하트 −1, 자동 조준, 0이 되면 탈락하고 최후의 생존자 보너스", () => {
    let s = startGame(2, 5, { minis: ["missile"], rounds: 1 });
    s = timeout(s);
    // 1번: 0번만 맞힘, 1번 무응답 → 1번 하트 −1, 0번 조준
    s = act(s, { type: "ANSWER", seat: 0, q: s.qIndex, choice: currentQuestion(s)!.answer });
    s = timeout(s);
    expect(s.phase).toBe("aim");
    expect(s.hp).toEqual([MISSILE_HP, MISSILE_HP - 1]);
    expect(s.missed).toEqual([1]);
    expect(autoTarget(s, 0)).toBe(1);
    s = timeout(s);
    expect(s.shot?.auto).toBe(true);
    expect(s.hp).toEqual([MISSILE_HP, MISSILE_HP - 2]);
    s = timeout(s);
    // 2번: 또 무응답 → 하트 0 탈락, 쏠 상대가 없어 조준 없이 공개
    s = act(s, { type: "ANSWER", seat: 0, q: s.qIndex, choice: currentQuestion(s)!.answer });
    s = timeout(s);
    expect(s.phase).toBe("reveal");
    expect(s.shooter).toBeNull();
    expect(s.eliminated).toEqual([1]);
    s = timeout(s);
    expect(s.phase).toBe("miniEnd");
    expect(s.alive).toEqual([true, false]);
    expect(s.miniScores[0]).toBe(MISSILE_HIT + MISSILE_HP * MISSILE_HP_POINTS + LAST_SURVIVOR);
  });

  it("남은 사람이 모두 틀려 한꺼번에 쓰러질 땐 마지막 하트 하나씩 남긴다", () => {
    let s = only("missile", 2);
    for (let i = 0; i < MISSILE_HP - 1; i++) {
      s = answerAll(s, (_, a) => wrongOf(s, a));
      s = timeout(s);
      s = timeout(s);
    }
    expect(s.hp).toEqual([1, 1]);
    s = answerAll(s, (_, a) => wrongOf(s, a));
    s = timeout(s);
    expect(s.revived).toBe(true);
    expect(s.hp).toEqual([1, 1]);
    expect(s.alive).toEqual([true, true]);
  });

  it("goes straight to reveal when nobody is right", () => {
    let s = only("missile", 2);
    s = answerAll(s, (_, a) => wrongOf(s, a));
    s = timeout(s);
    expect(s.phase).toBe("reveal");
    expect(s.shot).toBeNull();
    expect(s.hp).toEqual([MISSILE_HP - 1, MISSILE_HP - 1]);
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

describe("문제 난이도", () => {
  /** 사칙연산 식을 그대로 계산(× ÷ 먼저, 괄호·제곱·퍼센트 포함). */
  function evalPrompt(prompt: string): number {
    const pct = prompt.match(/^(\d+)의 (\d+)% = \?$/);
    if (pct) return (Number(pct[1]) * Number(pct[2])) / 100;
    const expr = prompt.replace(" = ?", "").replace(/(\d+)²/g, "($1*$1)").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
    expect(expr).toMatch(/^[\d+\-*/() ]+$/);
    return Function(`return (${expr})`)() as number;
  }

  it("보통·어려움 올라올라는 정답이 맞고, 두 자리 덧셈·구구단·짝수 같은 쉬운 셈이 없다", () => {
    for (const level of ["normal", "hard"] as const) {
      for (const seed of [1, 7, 42, 999]) {
        const qs = buildClimbQuestions(seed, 80, level);
        expect(qs).toEqual(buildClimbQuestions(seed, 80, level));
        for (const q of qs) {
          expect(q.choices.length).toBe(3);
          expect(new Set(q.choices).size).toBe(3);
          expect(q.choices.every((c) => Number.isInteger(Number(c)) && Number(c) >= 0)).toBe(true);
          expect(Number(q.choices[q.answer])).toBe(evalPrompt(q.prompt));
          expect(q.prompt).not.toMatch(/짝수|가장 큰/);
          // 한 자리 × 한 자리(구구단) 금지
          expect(q.prompt).not.toMatch(/^\d × \d = \?$/);
          expect(q.d).toBe(level === "normal" ? 2 : 3);
        }
      }
    }
  });

  it("쉬움은 예전 문제 그대로(기본값 호환)", () => {
    expect(buildClimbQuestions(5, 80, "easy")).toEqual(buildClimbQuestions(5));
    expect(bankOrder(3, "general", "easy")).toEqual(bankOrder(3, "general"));
  });

  it("보통은 쉬운(d=1) 문제를 어려운 문제 뒤로, 어려움은 d=3부터", () => {
    const normal = bankOrder(11, "ox", "normal");
    const hard = bankOrder(11, "general", "hard");
    expect(new Set(normal).size).toBe(OX_BANK.length);
    const firstEasy = normal.findIndex((i) => OX_BANK[i].d === 1);
    expect(normal.slice(firstEasy).every((i) => OX_BANK[i].d === 1)).toBe(true);
    expect(firstEasy).toBe(OX_BANK.filter((it) => it.d >= 2).length);
    const ds = hard.map((i) => GENERAL_BANK[i].d);
    expect([...ds].sort((a, b) => b - a)).toEqual(ds);
  });

  it("방 옵션: 기본 보통, 보통 판의 첫 OX 문제들엔 쉬운 문제가 없다, 올라올라 시간이 늘어난다", () => {
    const s = startGame(4, 77, { minis: ["ox"], rounds: 1, length: "normal" });
    expect(s.options.level).toBe("normal");
    expect(s.questions.every((q) => q.d >= 2)).toBe(true);
    const easy = startGame(4, 77, { minis: ["ox"], rounds: 1, length: "normal", level: "easy" });
    expect(easy.options.level).toBe("easy");
    const climb = (level: "easy" | "normal" | "hard") => phaseDurationMs({ ...startGame(2, 1, { minis: ["climb"], rounds: 1, length: "normal", level }), phase: "climb" });
    expect([climb("easy"), climb("normal"), climb("hard")]).toEqual([60_000, 75_000, 90_000]);
  });
});
