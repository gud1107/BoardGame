import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { chooseBotAction, chooseBotPlan } from "./bot";
import {
  applyAction,
  computeRankings,
  pendingSeats,
  planHash,
  previewDay,
  sanitizePlan,
  scoreBreakdown,
  simulateDay,
  startGame,
  type Cell,
  type GameState,
  type Plan,
  type ResolvedPlan,
} from "./engine";
import { CHALLENGES, LIFE_GOALS, OPPORTUNITIES, TEMPTATION_DECK } from "./data";
import { situationNotes } from "./guide";

const cells = (s: string): Cell[] =>
  s.split(" ").map((c) => ({ 수: "sleep", 공: "study", 운: "exercise", 일: "work", 약: "meet", 휴: "rest", "·": "empty", 유: "temptation" })[c] as Cell);

function planning(seatCount: number, seed = 1): GameState {
  let s = startGame(seatCount, seed);
  for (let i = 0; i < seatCount; i++) s = applyAction(s, { type: "CHOOSE_GOAL", seat: i, pick: 0 });
  return s;
}

/** 오늘 상태를 원하는 값으로 맞춘다(규칙 예시 재현용). */
function setup(state: GameState, opts: { event: GameState["events"][number]; temptations?: string[]; friend?: number | null; hp?: number[]; mp?: number[] }): GameState {
  const events = [...state.events];
  events[state.day] = opts.event;
  const temptations = state.temptations.map((d) => [...d]);
  if (opts.temptations) temptations[state.day] = opts.temptations;
  const friendBlocks = [...state.friendBlocks];
  friendBlocks[state.day] = opts.friend ?? null;
  const seats = state.seats.map((s, i) => ({ ...s, hp: opts.hp?.[i] ?? s.hp, mp: opts.mp?.[i] ?? s.mp }));
  return { ...state, events, temptations, friendBlocks, seats };
}

function resolved(state: GameState, seat: number, plan: Plan): ResolvedPlan {
  return sanitizePlan(state, seat, plan);
}

function playFull(seatCount: number, seed: number, level = 5): GameState {
  const rng = seededRng(seed * 7 + 1);
  let s = startGame(seatCount, seed);
  let guard = 0;
  while (s.phase !== "ended" && guard++ < 500) {
    if (s.phase === "planning") {
      const plans = Array.from({ length: seatCount }, (_, i) => chooseBotPlan(s, i, level, rng));
      const salts = plans.map((_, i) => `salt${i}-${s.day}`);
      for (let i = 0; i < seatCount; i++) s = applyAction(s, { type: "COMMIT_PLAN", seat: i, day: s.day, hash: planHash(plans[i], salts[i]) });
      expect(s.phase).toBe("revealing");
      for (let i = 0; i < seatCount; i++) s = applyAction(s, { type: "REVEAL_PLAN", seat: i, day: s.day, plan: plans[i], salt: salts[i] });
      expect(s.phase).toBe("dayResult");
    } else {
      for (const seat of pendingSeats(s)) {
        const a = chooseBotAction(s, seat, level, rng);
        if (a) s = applyAction(s, a);
      }
    }
  }
  return s;
}

describe("데이터", () => {
  it("카드 장수가 룰북과 같다", () => {
    expect(OPPORTUNITIES).toHaveLength(18);
    expect(TEMPTATION_DECK).toHaveLength(20);
    expect(LIFE_GOALS).toHaveLength(12);
    expect(CHALLENGES).toHaveLength(10);
  });

  it("같은 시드는 같은 준비 결과를 만든다", () => {
    expect(startGame(4, 99)).toEqual(startGame(4, 99));
    expect(startGame(4, 99).events).not.toEqual(startGame(4, 100).events);
  });

  it("7일 게임은 평일 이벤트 5장 + 토·일, 짧은 게임은 5일", () => {
    const s = startGame(3, 5);
    expect(s.events).toHaveLength(7);
    expect(s.events.slice(5)).toEqual(["SAT", "SUN"]);
    expect(new Set(s.events.slice(0, 5)).size).toBe(5);
    expect(startGame(3, 5, { days: 5, planSeconds: 90, hard: false, sns: false, easyHabit: false }).events).toHaveLength(5);
  });

  it("인생 목표 후보는 6인까지 서로 겹치지 않는다", () => {
    const s = startGame(6, 3);
    expect(new Set(s.goalOptions.flat()).size).toBe(12);
  });
});

describe("룰북 §18.1 평범한 하루", () => {
  it("화요일 맑은 날 — 끝 체력 6 · 멘탈 2, 성장 13", () => {
    let s = planning(2);
    s = setup(s, { event: "E3", temptations: ["T1", "T1"], hp: [6, 7], mp: [5, 7] });
    const plans = [
      resolved(s, 0, { cells: cells("수 수 운 일 공 일 약 수"), temptation: "resist", opportunityId: null }),
      resolved(s, 1, { cells: cells("수 수 휴 일 공 일 약 수"), temptation: "resist", opportunityId: null }),
    ];
    const { seats } = simulateDay(s, plans);
    const day = seats[0].days[0];
    expect(day.endHp).toBe(6);
    expect(day.endMp).toBe(2);
    expect(day.growth).toBe(13);
    expect(seats[0].tracks).toEqual({ knowledge: 2, body: 4, wealth: 4, social: 3 });
    expect(day.outcomes[6].matched).toBe(true);
    expect(seats[0].resists).toBe(1);
  });
});

describe("룰북 §18.2 붕괴", () => {
  it("축 처지는 날: B5 공부 실패 → 번아웃, B6 무효, B7 약속 펑크, B8 수면은 정상", () => {
    let s = planning(1);
    s = setup(s, { event: "E1", temptations: ["T7"], hp: [7], mp: [2] });
    const plan = resolved(s, 0, { cells: cells("수 수 유 일 공 일 약 수"), temptation: "yield", opportunityId: null });
    const { seats } = simulateDay(s, [plan]);
    const day = seats[0].days[0];
    expect(day.outcomes[4].kind).toBe("fail");
    expect(day.burnout).toBe(true);
    expect(day.outcomes[5].kind).toBe("void");
    expect(day.outcomes[6].kind).toBe("void");
    expect(day.outcomes[6].noShow).toBe(true);
    expect(day.outcomes[7].kind).toBe("ok");
    expect(day.endHp).toBe(10);
    expect(day.endMp).toBe(0);
    expect(seats[0].collapses).toBe(1);
    expect(seats[0].pendingApathy).toBe(true);
  });

  it("체력 1로 운동하면 실패 — 성장도 멘탈 회복도 없이 탈진, 남은 블록은 낮잠", () => {
    let s = planning(1);
    s = setup(s, { event: "E8", temptations: ["T5"], hp: [1], mp: [6] });
    const plan = resolved(s, 0, { cells: cells("· · 운 일 · · · ·"), temptation: "resist", opportunityId: null });
    const { seats } = simulateDay(s, [plan]);
    const day = seats[0].days[0];
    expect(day.outcomes[2].kind).toBe("fail");
    expect(day.exhausted).toBe(true);
    expect(seats[0].tracks.body).toBe(0);
    expect(day.outcomes[3].kind).toBe("nap");
  });

  it("다음 날 응급 회복으로 게이지가 3까지 오르고 무기력이면 공부·일을 못 넣는다", () => {
    let s = planning(1);
    s = setup(s, { event: "E1", temptations: ["T7"], hp: [7], mp: [2] });
    const plan: Plan = { cells: cells("수 수 유 일 공 일 약 수"), temptation: "yield", opportunityId: null };
    s = applyAction(s, { type: "COMMIT_PLAN", seat: 0, day: 0, hash: planHash(plan, "x") });
    s = applyAction(s, { type: "REVEAL_PLAN", seat: 0, day: 0, plan, salt: "x" });
    s = applyAction(s, { type: "READY", seat: 0 });
    expect(s.day).toBe(1);
    expect(s.seats[0].mp).toBeGreaterThanOrEqual(3);
    expect(s.seats[0].apathy).toBe(true);
    const fixed = sanitizePlan(s, 0, { cells: cells("수 수 공 일 공 일 휴 수"), temptation: "resist", opportunityId: null });
    expect(fixed.cells.includes("study")).toBe(false);
    expect(fixed.cells.includes("work")).toBe(false);
    expect(fixed.temptation).toBe("yield");
  });
});

describe("습관 §11", () => {
  it("3일 연속 B3 운동 → 수요일 마감에 형성, 목요일엔 비용 −1·성장 +1, 빠지면 흔들림, 이틀 빠지면 상실", () => {
    let s = planning(1);
    const run = (st: GameState, c: string, ev: GameState["events"][number] = "E8") => {
      const prepared = setup(st, { event: ev, temptations: ["T5"], hp: [10], mp: [10] });
      const plan: Plan = { cells: cells(c), temptation: "resist", opportunityId: null };
      let n = applyAction(prepared, { type: "COMMIT_PLAN", seat: 0, day: prepared.day, hash: planHash(plan, "s") });
      n = applyAction(n, { type: "REVEAL_PLAN", seat: 0, day: prepared.day, plan, salt: "s" });
      return n;
    };
    s = applyAction(run(s, "수 수 운 · · · · 수"), { type: "READY", seat: 0 });
    s = applyAction(run(s, "수 수 운 · · · · 수"), { type: "READY", seat: 0 });
    s = run(s, "수 수 운 · · · · 수");
    expect(s.seats[0].habits.some((h) => h.block === 2 && h.activity === "exercise")).toBe(true);
    s = applyAction(s, { type: "READY", seat: 0 });
    const preview = previewDay(setup(s, { event: "E8", temptations: ["T5"], hp: [10], mp: [10] }), 0, {
      cells: cells("수 수 운 · · · · 수"),
      temptation: "resist",
      opportunityId: null,
    });
    // 운동: 체력 2−1(습관)=1, 몸 2+1(골든)+1(습관)=4
    expect(preview.record.outcomes[2].gains.body).toBe(4);
    s = run(s, "수 수 · · · · · 수");
    expect(s.seats[0].habits.find((h) => h.block === 2)?.shaken).toBe(true);
    s = applyAction(s, { type: "READY", seat: 0 });
    s = run(s, "수 수 · · · · · 수");
    expect(s.seats[0].habits.find((h) => h.block === 2)).toBeUndefined();
  });
});

describe("약속·기회·유혹", () => {
  it("혼자 한 약속은 성사가 아니고, 단체 회식 날 B7은 혼자여도 성사", () => {
    let s = planning(4);
    s = setup(s, { event: "E2", temptations: ["T5", "T5", "T5", "T5"] });
    const p = (c: string) => resolved(s, 0, { cells: cells(c), temptation: "resist", opportunityId: null });
    const alone = simulateDay(s, [p("수 수 휴 휴 휴 휴 약 수"), null, null, null]);
    expect(alone.seats[0].days[0].outcomes[6].matched).toBeUndefined();
    const party = setup(s, { event: "E6", temptations: ["T5", "T5", "T5", "T5"] });
    const r = simulateDay(party, [resolved(party, 0, { cells: cells("수 수 휴 휴 휴 휴 약 수"), temptation: "resist", opportunityId: null }), null, null, null]);
    expect(r.seats[0].days[0].outcomes[6].matched).toBe(true);
  });

  it("정원 1 기회 카드는 성장 합이 낮은 사람이 받는다", () => {
    let s = planning(4);
    s = setup(s, { event: "E2", temptations: ["T5", "T5", "T5", "T5"] });
    s = { ...s, markets: s.markets.map((m, d) => (d === s.day ? ["O4", "O1", "O2"] : m)) };
    s = { ...s, seats: s.seats.map((x, i) => (i === 0 ? { ...x, tracks: { ...x.tracks, body: 5 } } : x)) };
    const plan = (seat: number) => resolved(s, seat, { cells: cells("수 수 휴 휴 일 휴 휴 수"), temptation: "resist", opportunityId: "O4" });
    const r = simulateDay(s, [plan(0), plan(1), null, null]);
    expect(r.seats[0].days[0].outcomes[4].opp).toBeUndefined();
    expect(r.seats[1].days[0].outcomes[4].opp).toBe("O4");
  });

  it("잘못 놓은 유혹은 허용 블록으로 옮기고, 저항 불가 멘탈이면 강제 굴복", () => {
    let s = planning(1);
    s = setup(s, { event: "E2", temptations: ["T2"], mp: [1] });
    const p = sanitizePlan(s, 0, { cells: cells("유 수 휴 휴 휴 휴 휴 수"), temptation: "resist", opportunityId: null });
    expect(p.temptation).toBe("yield");
    expect(p.cells[0]).toBe("empty");
    expect(p.cells[6]).toBe("temptation");
  });

  it("갑작스런 야근 날 B7은 일로 강제되고 술자리는 B8 한 블록만 차지", () => {
    let s = planning(1);
    s = setup(s, { event: "E7", temptations: ["T9"] });
    const p = sanitizePlan(s, 0, { cells: cells("수 수 휴 휴 휴 휴 유 유"), temptation: "yield", opportunityId: null });
    expect(p.cells[6]).toBe("work");
    expect(p.cells[7]).toBe("temptation");
  });
});

describe("커밋-공개", () => {
  it("해시가 안 맞으면 기본 계획, 시간 초과면 남은 자리 기본 계획", () => {
    let s = planning(2);
    const good: Plan = { cells: cells("수 수 운 일 공 일 약 수"), temptation: "yield", opportunityId: null };
    s = applyAction(s, { type: "COMMIT_PLAN", seat: 0, day: 0, hash: planHash(good, "a") });
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("revealing");
    expect(s.plans[1]?.auto).toBe(true);
    expect(s.idleStreak[1]).toBe(1);
    s = applyAction(s, { type: "REVEAL_PLAN", seat: 0, day: 0, plan: { ...good, cells: cells("공 공 공 공 공 공 공 공") }, salt: "a" });
    expect(s.phase).toBe("dayResult");
    expect(s.plans[0]?.auto).toBe(true);
  });

  it("늦게 온 TIMEOUT(옛 stage)은 무시", () => {
    const s = planning(2);
    expect(applyAction(s, { type: "TIMEOUT", stage: s.stage - 1 })).toBe(s);
  });
});

describe("봇 완주 · 점수", () => {
  it.each([1, 2, 4, 6])("%i인 봇 게임이 끝까지 진행되고 순위가 나온다", (n) => {
    const s = playFull(n, 11 + n);
    expect(s.phase).toBe("ended");
    expect(s.seats[0].days).toHaveLength(7);
    const r = computeRankings(s);
    expect(r).toHaveLength(n);
    expect(r[0].rank).toBe(1);
    for (let i = 0; i < n; i++) {
      const b = scoreBreakdown(s, i);
      expect(b.total).toBe(b.growth + b.balance + b.habits + b.goal + b.challenges + b.condition - b.penalty);
      // 결과 화면 "오늘 달라진 점" — 마지막 날 마감 점수 = 최종 점수, 날 사이 트랙·습관은 이어진다
      const days = s.seats[i].days;
      expect(days[6].scoreAfter!.total).toBe(b.total);
      for (let d = 0; d + 1 < days.length; d++) {
        expect(days[d + 1].scoreBefore!.growth).toBe(days[d].scoreAfter!.growth);
        expect(days[d + 1].scoreBefore!.habits).toBe(days[d].scoreAfter!.habits);
      }
    }
  });

  it("Lv.10 봇이 Lv.1 봇보다 평균 점수가 높다", () => {
    let hi = 0;
    let lo = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const a = playFull(1, seed, 10);
      const b = playFull(1, seed, 1);
      hi += scoreBreakdown(a, 0).total;
      lo += scoreBreakdown(b, 0).total;
    }
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("상황 안내", () => {
  it("몸살·무기력·위험 게이지·저항 불가·마지막 날을 짚어 준다", () => {
    let s = planning(2);
    s = { ...s, day: 6, seats: s.seats.map((x, i) => (i === 0 ? { ...x, sick: true, apathy: true, hp: 2, mp: 1 } : x)) };
    const titles = situationNotes(s, 0).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["몸살", "무기력", "체력 2 — 위험", "멘탈 1 — 위험", "유혹을 참을 수 없어요", "마지막 날"]));
    expect(situationNotes(s, 1).map((n) => n.title)).not.toContain("몸살");
  });

  it("2일 연속한 블록은 오늘 하면 습관이 된다고 알려 준다", () => {
    let s = planning(1);
    const streak = s.seats[0].streak.map((x, b) => (b === 2 ? { activity: "exercise" as const, count: 2 } : x));
    s = { ...s, day: 2, seats: [{ ...s.seats[0], streak }] };
    expect(situationNotes(s, 0).some((n) => n.title.includes("B3") && n.title.includes("습관"))).toBe(true);
  });
});
