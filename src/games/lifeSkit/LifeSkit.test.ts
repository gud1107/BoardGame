import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLES, ROLE_BY_ID, SCENE_COUNT, STATS, TRAITS } from "./data";
import { chooseBotAction } from "./bot";
import { applyAction, choicesFor, computeRankings, endingFor, pendingSeats, resolveChoice, scoreOf, seatDetails, startGame, winnerSeats, STAT_MAX, type EngineAction, type GameState } from "./engine";

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(state: GameState, level: number, rand: () => number, roles?: string[]): GameState {
  let s = state;
  let guard = 0;
  while (s.phase !== "ended" && guard++ < 2000) {
    const seat = pendingSeats(s)[0];
    const a: EngineAction | null = s.phase === "cast" && roles ? { type: "PICK_ROLE", seat, role: roles[seat] } : chooseBotAction(s, seat, level, rand);
    expect(a).not.toBeNull();
    s = applyAction(s, a!);
  }
  expect(s.phase).toBe("ended");
  return s;
}

describe("인생 상황극 대본", () => {
  it("배역 10개, 장면 7개, 선택지 3개씩", () => {
    expect(ROLES.length).toBe(10);
    expect(new Set(ROLES.map((r) => r.id)).size).toBe(ROLES.length);
    for (const r of ROLES) {
      expect(r.scenes.length, r.id).toBe(SCENE_COUNT);
      expect(r.start.length).toBe(STATS.length);
      for (const sc of r.scenes) {
        expect(sc.choices.length, `${r.id} ${sc.title}`).toBe(3);
        expect(sc.choices.filter((c) => c.fast).length, `${r.id} ${sc.title} ⚡`).toBe(1);
      }
    }
  });

  it("성격·나비효과·바뀌는 선택지가 모두 정의된 성격을 가리키고, 실제로 얻을 수 있다", () => {
    for (const r of ROLES) {
      r.scenes.forEach((sc, i) => {
        const earlier = new Set(r.scenes.slice(0, i).flatMap((s) => s.choices.flatMap((c) => [...(c.tags ?? []), ...(c.swap?.tags ?? [])])));
        for (const c of sc.choices) {
          for (const t of [...(c.tags ?? []), ...(c.swap?.tags ?? [])]) expect(TRAITS[t], `${r.id} ${t}`).toBeDefined();
          if (c.swap) expect(earlier.has(c.swap.tag), `${r.id} ${sc.title} swap ${c.swap.tag}`).toBe(true);
        }
        for (const e of sc.echoes ?? []) expect(earlier.has(e.tag), `${r.id} ${sc.title} echo ${e.tag}`).toBe(true);
      });
    }
  });

  it("엔딩: 마지막은 조건 없는 기본 엔딩, 모든 엔딩에 도달하는 길이 있다", () => {
    for (const r of ROLES) {
      const last = r.endings[r.endings.length - 1];
      expect(last.tags, r.id).toBeUndefined();
      expect(last.min, r.id).toBeUndefined();
      expect(last.max, r.id).toBeUndefined();
      const seen = new Set<string>();
      // 3^7 = 2187 가지 인생을 전부 살아 본다
      for (let code = 0; code < 3 ** SCENE_COUNT; code++) {
        let s = applyAction(startGame(1, 1), { type: "PICK_ROLE", seat: 0, role: r.id });
        let k = code;
        for (let i = 0; i < SCENE_COUNT; i++) {
          s = applyAction(s, { type: "CHOOSE", seat: 0, scene: i, choice: k % 3 });
          s = applyAction(s, { type: "READY", seat: 0, scene: i });
          k = Math.floor(k / 3);
        }
        expect(s.phase).toBe("ended");
        seen.add(s.seats[0].ending!);
        for (const v of s.seats[0].stats) expect(v >= 0 && v <= STAT_MAX).toBe(true);
      }
      for (const e of r.endings) expect(seen.has(e.id), `${r.id} 엔딩 ${e.id}`).toBe(true);
    }
  });
});

describe("인생 상황극 엔진", () => {
  it("모두 배역을 고르면 첫 장면, 모두 고르면 공개, 모두 준비하면 다음 장면", () => {
    let s = startGame(2, 7);
    expect(s.phase).toBe("cast");
    s = applyAction(s, { type: "PICK_ROLE", seat: 0, role: "ceo" });
    expect(s.phase).toBe("cast");
    s = applyAction(s, { type: "PICK_ROLE", seat: 1, role: "nobi" });
    expect(s.phase).toBe("choose");
    expect(s.seats[0].stats).toEqual(ROLE_BY_ID.ceo.start);
    s = applyAction(s, { type: "CHOOSE", seat: 0, scene: 0, choice: 1 });
    expect(s.phase).toBe("choose");
    expect(applyAction(s, { type: "CHOOSE", seat: 0, scene: 0, choice: 2 })).toBe(s);
    s = applyAction(s, { type: "CHOOSE", seat: 1, scene: 0, choice: 0 });
    expect(s.phase).toBe("reveal");
    expect(s.seats[0].tags).toContain("greedy");
    expect(s.seats[0].log[0].gained).toEqual(["greedy"]);
    s = applyAction(s, { type: "CLAP", seat: 1, scene: 0, to: 0 });
    expect(s.seats[0].log[0].claps).toEqual([1]);
    expect(applyAction(s, { type: "CLAP", seat: 1, scene: 0, to: 0 })).toBe(s);
    expect(applyAction(s, { type: "CLAP", seat: 0, scene: 0, to: 0 })).toBe(s);
    s = applyAction(s, { type: "READY", seat: 0, scene: 0 });
    s = applyAction(s, { type: "READY", seat: 1, scene: 0 });
    expect(s.phase).toBe("choose");
    expect(s.scene).toBe(1);
    expect(s.seats[0].pending).toBeNull();
  });

  it("무심해진 CEO는 딸 생일 선택지가 바뀌고, 나비효과가 터진다", () => {
    let s = applyAction(startGame(1, 3), { type: "PICK_ROLE", seat: 0, role: "ceo" });
    const pick = (choice: number) => {
      s = applyAction(s, { type: "CHOOSE", seat: 0, scene: s.scene, choice });
      s = applyAction(s, { type: "READY", seat: 0, scene: s.scene });
    };
    pick(0);
    pick(0);
    pick(1); // 결혼기념일에 회사로 — 무심함
    expect(s.seats[0].tags).toContain("cold");
    pick(0);
    const birthday = choicesFor(s, 0);
    expect(birthday[1].swappedBy).toBe("cold");
    expect(birthday[1].label).toContain("무슨 날");
    pick(1);
    expect(s.seats[0].log[4].swapped).toBe(true);
    const before = s.seats[0].stats[1];
    pick(2); // 상장 전날 — "손님" 나비효과
    expect(s.seats[0].log[5].echoes).toEqual([0]);
    expect(s.seats[0].stats[1]).toBe(Math.max(0, before + 1 - 2));
    // 성격이 없으면 원래 선택지
    expect(resolveChoice(ROLE_BY_ID.ceo.scenes[4].choices[1], []).swappedBy).toBeNull();
  });

  it("시간 초과: 배역·선택을 대신 고르고 무응답을 센다, 지난 단계의 TIMEOUT은 무시", () => {
    let s = startGame(2, 11);
    expect(applyAction(s, { type: "TIMEOUT", stage: 5 })).toBe(s);
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("choose");
    expect(s.seats.every((x) => x.role !== null)).toBe(true);
    s = applyAction(s, { type: "CHOOSE", seat: 0, scene: 0, choice: 0 });
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("reveal");
    expect(s.idleStreak).toEqual([0, 1]);
    expect(s.seats[1].log[0].auto).toBe(true);
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("choose");
    expect(s.scene).toBe(1);
  });

  it("같은 시드·같은 행동이면 같은 결과, 순위와 기록이 나온다", () => {
    const a = play(startGame(4, 99), 6, rng(5));
    const b = play(startGame(4, 99), 6, rng(5));
    expect(a).toEqual(b);
    const ranks = computeRankings(a);
    expect(ranks.length).toBe(4);
    expect(ranks[0].rank).toBe(1);
    expect(winnerSeats(a).length).toBeGreaterThan(0);
    for (let seat = 0; seat < 4; seat++) {
      const d = seatDetails(a, seat);
      expect(d.scenes).toBe(SCENE_COUNT);
      expect(d.maxScore).toBe(a.seats[seat].score);
      expect(a.seats[seat].score).toBe(scoreOf(ROLE_BY_ID[a.seats[seat].role!], a.seats[seat]));
      expect(endingFor(ROLE_BY_ID[a.seats[seat].role!], a.seats[seat]).id).toBe(a.seats[seat].ending);
    }
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe("인생 상황극 밸런스 (셀프플레이)", () => {
  const avg = (level: number, role: string) => {
    const rand = rng(level * 1000 + role.length * 77 + role.charCodeAt(0));
    let sum = 0;
    const n = 300;
    for (let i = 0; i < n; i++) sum += play(startGame(1, i + 1), level, rand, [role]).seats[0].score;
    return sum / n;
  };

  it("배역별 평균 점수 편차가 크지 않고, 높은 레벨 봇이 더 잘 산다", () => {
    const rows = ROLES.map((r) => ({ id: r.id, lo: avg(1, r.id), mid: avg(5, r.id), hi: avg(10, r.id) }));
    // vitest가 통과한 테스트의 console.log를 삼키는 환경이라, 표가 필요하면 파일로 받는다
    if (process.env.LIFE_SKIT_SIM_OUT) writeFileSync(process.env.LIFE_SKIT_SIM_OUT, rows.map((r) => `${r.id.padEnd(16)} Lv1 ${r.lo.toFixed(1)}  Lv5 ${r.mid.toFixed(1)}  Lv10 ${r.hi.toFixed(1)}`).join("\n"));
    for (const key of ["lo", "mid", "hi"] as const) {
      const vals = rows.map((r) => r[key]);
      expect(Math.max(...vals) - Math.min(...vals), key).toBeLessThan(12);
    }
    for (const r of rows) expect(r.hi, r.id).toBeGreaterThan(r.lo + 8);
  });
});
