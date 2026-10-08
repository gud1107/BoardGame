import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RankedSeat } from "./engine";
import MergeDefenseResults, { type WaveHistory } from "./MergeDefenseResults";
import WaitingRoomPanel from "./WaitingRoomPanel";
import WaveChart, { type WaveSeries } from "./WaveChart";

/**
 * Screen tests for the props-only UI pieces, rendered to HTML in Node (no DOM
 * library needed). They pin what each screen must show and the class hooks
 * that keep it inside a 375px phone (nowrap / truncate / break-keep) — the
 * pixel check itself was done in a real browser when these were written.
 */

const noop = () => {};
const settings = {
  mode: "versus" as const,
  onMode: noop,
  best: { easy: 0, normal: 31, hard: 0 },
  difficulty: "hard" as const,
  limit: null,
  playerCount: 4,
  onDifficulty: noop,
  onLimit: noop,
};
const names = { 0: "초록고양이", 1: "🤖 AI 2", 2: "길고긴닉네임플레이어", 3: "🤖 AI 4" };

function seat(seatNo: number, rank: number, extra: Partial<RankedSeat> = {}): RankedSeat {
  return {
    seat: seatNo,
    rank,
    wave: 30 - rank,
    kills: 600 - rank * 10,
    combo: 10 + seatNo,
    jamsSent: 3,
    jamsTaken: 2,
    jamsBlocked: 1,
    reflectsTaken: 0,
    lateWaves: 0,
    comboBonusWaves: 0,
    ...extra,
  };
}

const ramp = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
function history(waves: number): WaveHistory {
  return {
    limit: 45,
    bossEvery: 5,
    series: [0, 1, 2, 3].map((s) => ({
      seat: s,
      color: ["#3987e5", "#d95926", "#199e70", "#c98500"][s],
      out: s !== 3,
      load: ramp(waves - s, (i) => Math.min(45, 5 + i * 2)),
      gold: ramp(waves - s, (i) => i * 100),
      kills: ramp(waves - s, (i) => i * 20),
      upgrades:
        s === 0
          ? [{ wave: 8, kind: "focus" as const, level: 1 }, { wave: 12, kind: "brace" as const, level: 1 }]
          : s === 1
            ? [{ wave: 9, kind: "focus" as const, level: 1 }]
            : [],
      bossKills: s === 3 ? [{ wave: 5, at: 5 }, { wave: 10, at: 11 }] : [],
    })),
  };
}

function results(over: Partial<Parameters<typeof MergeDefenseResults>[0]> = {}) {
  return renderToStaticMarkup(
    h(MergeDefenseResults, {
      rankings: [seat(3, 1), seat(1, 2), seat(2, 3), seat(0, 4, { lateWaves: 14, comboBonusWaves: 5 })],
      names,
      mySeat: 0,
      mode: "versus",
      myRecord: { mode: "versus", difficulty: "hard", wave: 26, prev: 24 },
      history: history(26),
      isHost: true,
      settings,
      onLeave: noop,
      onRestart: noop,
      ...over,
    }),
  );
}

describe("merge defense screens", () => {
  it("results: winner, record banner, combo coverage, phone-safe table", () => {
    const html = results();
    expect(html).toContain("AI 4님 승리!");
    expect(html).toContain("최고 기록 갱신! WAVE 26");
    expect(html).toContain("8콤보 보너스");
    expect(html).toContain("(36%)"); // 5 / 14
    // Phone guards on the ranking table.
    expect(html).toMatch(/<table[^>]*whitespace-nowrap/);
    expect(html).toContain("truncate");
    expect(html).toContain("break-keep");
  });

  it("results: the 견제 column + legend only in 유닛 대결", () => {
    expect(results({ mode: "versus" })).toContain("견제 = ");
    const survival = results({ mode: "survival" });
    expect(survival).not.toContain("견제 = ");
    expect(survival).not.toContain(">견제<");
  });

  it("results: host gets next-round settings + 다시하기, guests a waiting note", () => {
    const host = results({ isHost: true });
    expect(host).toContain("다음 판 설정");
    expect(host).toContain("다시하기");
    const guest = results({ isHost: false });
    expect(guest).not.toContain("다음 판 설정");
    expect(guest).toContain("방장이 다시하기를 누르면 시작해요");
  });

  it("results: no chart until there are at least two waves", () => {
    expect(results({ history: history(1) })).not.toContain("tablist");
    expect(results({ history: null })).not.toContain("tablist");
  });

  it("chart: three tabs, a crown per boss wave, limit rule, my upgrade marks, readout below (no overlay)", () => {
    const series: WaveSeries[] = history(23).series.map((s) => ({ ...s, name: names[s.seat as 0 | 1 | 2 | 3], me: s.seat === 0 }));
    const html = renderToStaticMarkup(h(WaveChart, { series, limit: 45, bossEvery: 5 }));
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    // Waves 5, 10, 15, 20 → four crowns in the plot (the longest line is 23 waves).
    expect(html.match(/>👑</g)).toHaveLength(4);
    expect(html).toContain("탈락");
    expect(html).toContain("🎯");
    expect(html).toContain("🛡️");
    expect(html).toContain("그래프를 누르거나 올리면");
    expect(html).not.toContain("absolute top-1");
    // Table view carries the numbers without color.
    expect(html).toContain("표로 보기");
  });

  it("chart: others' upgrades stay hidden until the 강화 toggle; toggle only offered when they exist", () => {
    const series: WaveSeries[] = history(23).series.map((s) => ({ ...s, name: names[s.seat as 0 | 1 | 2 | 3], me: s.seat === 0 }));
    const html = renderToStaticMarkup(h(WaveChart, { series, limit: 45, bossEvery: 5 }));
    expect(html).toContain("강화 나만");
    // Default: only my two marks (🎯 W8, 🛡️ W12), not seat 1's 🎯 W9.
    expect(html.match(/>🎯</g)).toHaveLength(1);
    const solo = series.map((s) => (s.me ? s : { ...s, upgrades: [] }));
    expect(renderToStaticMarkup(h(WaveChart, { series: solo, limit: 45, bossEvery: 5 }))).not.toContain("강화 나만");
  });

  it("engine records which wave's boss each board killed", async () => {
    const { startGame, stepGame } = await import("./engine");
    let s = startGame(2, 5);
    while (s.wave < 5) {
      for (const b of s.boards) b.mobs = [];
      s = stepGame(s);
    }
    const boss = s.boards[0].mobs.find((m) => m.kind === "boss")!;
    expect(boss.bornWave).toBe(5);
    boss.hp = 0.01;
    boss.poisonT = 5;
    boss.poisonDps = 1e6;
    s = stepGame(s);
    expect(s.boards[0].bossKills).toEqual([{ wave: 5, at: 5 }]);
  });

  it("waiting room: host controls vs guest note, empty seats, long names truncated", () => {
    const base = {
      roomCode: "4821",
      shareUrl: "https://example.com",
      seats: ["초록고양이", "길고긴닉네임플레이어입니다", null, null],
      joined: 2,
      hostRules: { mode: "versus" as const, difficulty: "hard" as const, limit: 45 },
      settings,
      onFillWithAi: noop,
    };
    const host = renderToStaticMarkup(h(WaitingRoomPanel, { ...base, mySeat: 0, isHost: true }));
    expect(host).toContain("4821");
    expect(host).toContain("빈자리 AI로 채우고 시작");
    expect(host).toContain("방장 설정");
    expect(host).toContain("45마리에서 탈락");
    expect(host.match(/대기 중\.\.\./g)).toHaveLength(2);
    expect(host).toContain("truncate");
    const guest = renderToStaticMarkup(h(WaitingRoomPanel, { ...base, mySeat: 1, isHost: false }));
    expect(guest).not.toContain("빈자리 AI로 채우고 시작");
    expect(guest).toContain("방장이 시작 전까지");
    const full = renderToStaticMarkup(h(WaitingRoomPanel, { ...base, seats: ["a", "b", "c", "d"], joined: 4, mySeat: 0, isHost: true }));
    expect(full).not.toContain("빈자리 AI로 채우고 시작");
  });
});
