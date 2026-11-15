import { describe, expect, it } from "vitest";
import { COMBO_BONUS_MAX, GAUGE_MAX, GAUGE_PERFECT, GOOD_MS, GREAT_MS, LANES, PERFECT_MS, PRANK_BEATS, PRANK_LEAD_BEATS, PTS, SHIELD_COST, STEP_MS, STYLE_IDS, accuracy, applyJudge, judgeOf, sanitizeOptions, zeroTally, type Judge } from "./data";
import { isSnap, makeSnap, SnapBuffer, stateFromSnap } from "./net";
import { activePrank, applyInput, computeRanks, createHost, createMatch, prankTarget, setAway, songOf, songTime, step, tryPrank, type HostRuntime, type MatchState, type PlayerInput } from "./sim";
import { beatMayhemStatDetails } from "./stats";
import { STYLES, buildSong, resolveStyle, sectionAt } from "./song";

const humans = (n: number) => Array.from({ length: n }, () => ({ bot: false, level: 5 }));

function start(n = 2, opts: Parameters<typeof createMatch>[2] = {}, seed = 7): { s: MatchState; rt: HostRuntime } {
  const s = createMatch(seed, humans(n), opts);
  const rt = createHost(s);
  while (s.phase === "countdown") step(rt);
  return { s, rt };
}

const run = (rt: HostRuntime, ms: number) => {
  for (let i = 0; i < Math.round(ms / STEP_MS); i++) step(rt);
};

/** 노트 n개를 모두 같은 판정으로 친 누적 기록 */
function reportOf(round: number, judges: Judge[], atk = 0): PlayerInput {
  const t = zeroTally();
  for (const j of judges) applyJudge(t, j);
  return { r: round, n: t.judged, sc: t.score, cb: t.combo, mc: t.maxCombo, j: [...t.judges], e: t.earned, atk };
}

describe("박자 난장판 — 곡과 채보", () => {
  it("같은 씨앗·라운드면 같은 곡, 라운드가 다르면 다른 곡", () => {
    const a = buildSong(5, 1, "polka", "normal");
    expect(buildSong(5, 1, "polka", "normal").notes).toEqual(a.notes);
    expect(buildSong(5, 2, "polka", "normal").notes).not.toEqual(a.notes);
  });

  it("노트는 시간순이고, 줄은 0~3, 카운트인 마디에는 노트가 없다", () => {
    for (const style of STYLE_IDS)
      for (const diff of ["easy", "normal", "hard"] as const) {
        const song = buildSong(11, 1, style, diff);
        expect(song.notes.length).toBeGreaterThan(40);
        for (let i = 0; i < song.notes.length; i++) {
          const n = song.notes[i];
          expect(n.lane).toBeGreaterThanOrEqual(0);
          expect(n.lane).toBeLessThan(LANES);
          expect(n.t).toBeGreaterThanOrEqual(song.barMs);
          expect(n.t).toBeLessThan(song.lengthMs);
          if (i > 0) expect(n.t).toBeGreaterThanOrEqual(song.notes[i - 1].t);
        }
      }
  });

  it("같은 순간 같은 줄에 노트가 겹치지 않는다", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const song = buildSong(seed, 1, "random", "hard");
      const seen = new Set<string>();
      for (const n of song.notes) {
        const k = `${Math.round(n.t)}:${n.lane}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });

  it("쉬움 < 보통 < 어려움 순으로 노트가 많고, 쉬움은 8분음표 격자만 쓴다", () => {
    for (const style of STYLE_IDS) {
      const e = buildSong(3, 1, style, "easy");
      const n = buildSong(3, 1, style, "normal");
      const h = buildSong(3, 1, style, "hard");
      expect(e.notes.length).toBeLessThan(n.notes.length);
      expect(n.notes.length).toBeLessThan(h.notes.length);
      const eighth = e.beatMs / 2;
      for (const note of e.notes) expect(Math.abs(note.t / eighth - Math.round(note.t / eighth))).toBeLessThan(1e-6);
    }
  });

  it("곡 길이는 45~90초, 소리 이벤트는 시간순이고 드럼은 음높이 배수(작은 수)를 쓴다", () => {
    for (const style of STYLE_IDS) {
      const song = buildSong(9, 1, style, "normal");
      expect(song.lengthMs).toBeGreaterThan(45_000);
      expect(song.lengthMs).toBeLessThan(90_000);
      expect(song.bpm).toBe(STYLES[style].bpm);
      for (let i = 1; i < song.audio.length; i++) expect(song.audio[i].t).toBeGreaterThanOrEqual(song.audio[i - 1].t);
      for (const ev of song.audio) if (["kick", "softKick", "snare", "rim", "hat", "shaker", "clap", "tom", "woodblock"].includes(ev.inst)) expect(ev.freq).toBeLessThan(2);
    }
  });

  it("무작위 스타일은 곡마다 바뀌고, 구간 이름을 알려 준다", () => {
    const styles = [1, 2, 3].map((r) => resolveStyle("random", 42, r));
    expect(new Set(styles).size).toBe(3);
    expect(resolveStyle("city", 42, 2)).toBe("city");
    const song = buildSong(1, 1, "polka", "normal");
    expect(sectionAt(song, 0)).toBe("카운트인");
    expect(sectionAt(song, song.barMs * 1.5)).toBe("인트로");
    expect(sectionAt(song, song.lengthMs - 10)).toBe("B′");
  });
});

describe("박자 난장판 — 판정과 점수", () => {
  it("판정 창: ±45 퍼펙트, ±90 그레이트, ±135 굿, 그 밖은 미스", () => {
    expect(judgeOf(PERFECT_MS)).toBe("perfect");
    expect(judgeOf(PERFECT_MS + 1)).toBe("great");
    expect(judgeOf(GREAT_MS + 1)).toBe("good");
    expect(judgeOf(GOOD_MS + 1)).toBe("miss");
  });

  it("콤보 보너스는 콤보만큼 붙다가 40에서 멈추고, 미스는 콤보를 끊는다", () => {
    const t = zeroTally();
    applyJudge(t, "perfect");
    expect(t.score).toBe(PTS.perfect + 1);
    for (let i = 0; i < 60; i++) applyJudge(t, "perfect");
    const before = t.score;
    applyJudge(t, "perfect");
    expect(t.score - before).toBe(PTS.perfect + COMBO_BONUS_MAX);
    applyJudge(t, "miss");
    expect(t.combo).toBe(0);
    expect(t.maxCombo).toBe(62);
    applyJudge(t, "good");
    expect(t.combo).toBe(1);
    expect(t.judges).toEqual([62, 0, 1, 1]);
  });

  it("정확도는 퍼펙트 1 · 그레이트 0.7 · 굿 0.4", () => {
    expect(accuracy([10, 0, 0, 0], 10)).toBe(100);
    expect(accuracy([0, 10, 0, 0], 10)).toBe(70);
    expect(accuracy([5, 0, 5, 0], 10)).toBe(70);
    expect(accuracy([0, 0, 0, 0], 0)).toBe(0);
  });

  it("옵션은 이상한 값을 기본값으로 고친다", () => {
    expect(sanitizeOptions({ rounds: 9 as never, difficulty: "x" as never, style: "jazz" as never })).toEqual({ rounds: 2, difficulty: "normal", mayhem: true, style: "random" });
    expect(sanitizeOptions({ rounds: 3, difficulty: "hard", mayhem: false, style: "rush" })).toEqual({ rounds: 3, difficulty: "hard", mayhem: false, style: "rush" });
  });
});

describe("박자 난장판 — 진행", () => {
  it("카운트다운이 끝나는 순간이 곡 시각 0", () => {
    const { s } = start(2);
    expect(s.phase).toBe("play");
    expect(s.round).toBe(1);
    expect(Math.abs(songTime(s))).toBeLessThan(STEP_MS + 1);
  });

  it("누적 기록을 받아 점수판에 옮긴다 — 줄어드는 기록·다른 곡 기록·개수가 안 맞는 기록은 버린다", () => {
    const { s, rt } = start(2);
    applyInput(rt, 0, reportOf(1, Array(10).fill("perfect")));
    const p = s.players[0];
    expect(p.judged).toBe(10);
    expect(p.total).toBe(p.score);
    expect(p.combo).toBe(10);
    const score = p.score;
    applyInput(rt, 0, reportOf(1, Array(5).fill("perfect")));
    expect(p.judged).toBe(10);
    applyInput(rt, 0, reportOf(2, Array(30).fill("perfect")));
    expect(p.score).toBe(score);
    applyInput(rt, 0, { r: 1, n: 20, sc: 99999, cb: 20, mc: 20, j: [1, 0, 0, 0], e: 80, atk: 0 });
    expect(p.judged).toBe(10);
  });

  it("점수와 게이지는 판정 수로 낼 수 있는 최댓값을 넘지 못한다", () => {
    const { s, rt } = start(2);
    applyInput(rt, 0, { r: 1, n: 10, sc: 9_999_999, cb: 10, mc: 10, j: [10, 0, 0, 0], e: 5000, atk: 0 });
    expect(s.players[0].score).toBe(10 * (PTS.perfect + COMBO_BONUS_MAX));
    expect(s.players[0].gauge).toBe(10 * GAUGE_PERFECT);
  });

  it("곡이 끝나면 덜 온 기록은 미스로 채우고 라운드 결과를 낸다, 마지막 곡 뒤엔 최종 순위", () => {
    const { s, rt } = start(2, { rounds: 1 });
    const total = songOf(s).notes.length;
    applyInput(rt, 0, reportOf(1, Array(total).fill("perfect")));
    applyInput(rt, 1, reportOf(1, Array(20).fill("good")));
    let guard = 0;
    while (s.phase === "play" && guard++ < 30 * 200) step(rt);
    expect(s.phase).toBe("roundEnd");
    expect(s.players[1].judged).toBe(total);
    expect(s.players[1].judges[3]).toBe(total - 20);
    expect(s.history[0].winners).toEqual([0]);
    expect(s.history[0].acc[0]).toBe(100);
    expect(s.players[0].stats.fullCombos).toBe(1);
    expect(s.players[0].stats.roundWins).toBe(1);
    while (s.phase === "roundEnd") step(rt);
    expect(s.phase).toBe("gameOver");
    expect(s.ranks).toEqual([1, 2]);
    const d = beatMayhemStatDetails(s, 0);
    expect(d.songs).toBe(1);
    expect(d.perfects).toBe(total);
    expect(d.maxAcc).toBe(100);
    expect(d.maxScore).toBe(s.players[0].total);
  });

  it("여러 곡이면 점수가 이어지고 곡마다 기록은 새로 시작한다", () => {
    const { s, rt } = start(2, { rounds: 2 });
    applyInput(rt, 0, reportOf(1, Array(30).fill("perfect")));
    const first = s.players[0].score;
    let guard = 0;
    while (s.round === 1 && guard++ < 30 * 300) step(rt);
    expect(s.round).toBe(2);
    expect(s.players[0].prev).toBe(first);
    expect(s.players[0].score).toBe(0);
    expect(s.players[0].judged).toBe(0);
    expect(s.players[0].total).toBe(first);
  });

  it("동점이면 같은 등수", () => {
    const { s } = start(3);
    s.players[0].total = 500;
    s.players[1].total = 500;
    s.players[2].total = 100;
    expect(computeRanks(s)).toEqual([1, 1, 3]);
    s.players[1].stats.perfects = 3;
    expect(computeRanks(s)).toEqual([2, 1, 3]);
  });
});

describe("박자 난장판 — 장난", () => {
  const FULL = Math.ceil(GAUGE_MAX / GAUGE_PERFECT);
  const SHIELD_N = Math.ceil(SHIELD_COST / GAUGE_PERFECT) + 2;
  const full = (rt: HostRuntime, seat: number) => applyInput(rt, seat, reportOf(1, Array(FULL).fill("perfect")));

  it("받는 사람은 바로 위 등수, 1등이면 2등", () => {
    const { s } = start(3);
    s.players[0].total = 300;
    s.players[1].total = 200;
    s.players[2].total = 100;
    expect(prankTarget(s, 2)).toBe(1);
    expect(prankTarget(s, 1)).toBe(0);
    expect(prankTarget(s, 0)).toBe(1);
  });

  it("게이지 100이면 쏠 수 있고 4박자 뒤부터 8박자 동안 걸린다", () => {
    const { s, rt } = start(2);
    run(rt, 3000);
    expect(tryPrank(s, 0)).toBe(false);
    full(rt, 0);
    expect(s.players[0].gauge).toBe(GAUGE_MAX);
    const beat = songTime(s) / songOf(s).beatMs;
    applyInput(rt, 0, reportOf(1, Array(FULL).fill("perfect"), 1));
    expect(s.effects.length).toBe(1);
    const e = s.effects[0];
    expect(e.from).toBe(0);
    expect(e.to).toBe(1);
    expect(e.blocked).toBe(false);
    expect(e.b0).toBeGreaterThanOrEqual(beat + PRANK_LEAD_BEATS);
    expect(e.b1 - e.b0).toBe(PRANK_BEATS);
    expect(s.players[0].gauge).toBe(0);
    expect(s.players[0].stats.pranksSent).toBe(1);
    expect(s.players[1].stats.pranksTaken).toBe(1);
    expect(activePrank(s, 1, e.b0 - 0.1)).toBeNull();
    expect(activePrank(s, 1, e.b0 + 1)?.id).toBe(e.id);
    expect(activePrank(s, 0, e.b0 + 1)).toBeNull();
    // 같은 카운터로는 다시 안 쏜다
    applyInput(rt, 0, reportOf(1, Array(FULL).fill("perfect"), 1));
    expect(s.effects.length).toBe(1);
  });

  it("게이지가 방패 값 이상인 사람은 자동으로 막고 그만큼 쓴다", () => {
    const { s, rt } = start(2);
    run(rt, 3000);
    full(rt, 0);
    applyInput(rt, 1, reportOf(1, Array(SHIELD_N).fill("perfect")));
    expect(s.players[1].gauge).toBe(SHIELD_N * GAUGE_PERFECT);
    applyInput(rt, 0, reportOf(1, Array(FULL).fill("perfect"), 1));
    expect(s.effects[0].blocked).toBe(true);
    expect(s.players[1].gauge).toBe(SHIELD_N * GAUGE_PERFECT - SHIELD_COST);
    expect(s.players[1].stats.pranksBlocked).toBe(1);
    expect(activePrank(s, 1, s.effects[0].b0 + 1)).toBeNull();
  });

  it("같은 사람에게 겹치면 뒤로 줄을 서고, 장난을 끈 방에선 못 쏜다", () => {
    const { s, rt } = start(3);
    run(rt, 3000);
    s.players[0].total = 9999;
    full(rt, 1);
    full(rt, 2);
    s.players[1].total = 5000;
    s.players[2].total = 5000;
    // 둘 다 0번을 노리게 순위를 맞춘다 (2번의 바로 위는 1번이라 1번을 0점으로 내린다)
    s.players[1].gauge = GAUGE_MAX;
    expect(tryPrank(s, 1)).toBe(true);
    s.players[1].total = 0;
    s.players[2].gauge = GAUGE_MAX;
    expect(tryPrank(s, 2)).toBe(true);
    const mine = s.effects.filter((e) => e.to === 0);
    expect(mine.length).toBe(2);
    expect(mine[1].b0).toBe(mine[0].b1);
    const off = start(2, { mayhem: false });
    run(off.rt, 3000);
    applyInput(off.rt, 0, reportOf(1, Array(FULL).fill("perfect"), 1));
    expect(off.s.effects.length).toBe(0);
  });

  it("곡이 거의 끝나면 쏠 수 없다 (게이지는 그대로)", () => {
    const { s, rt } = start(2);
    const song = songOf(s);
    run(rt, song.lengthMs - song.beatMs * 8);
    full(rt, 0);
    applyInput(rt, 0, reportOf(1, Array(FULL).fill("perfect"), 1));
    expect(s.effects.length).toBe(0);
    expect(s.players[0].gauge).toBe(GAUGE_MAX);
  });
});

describe("박자 난장판 — 봇 대체·스냅샷·시계", () => {
  it("나간 사람 자리는 봇이 이어서 치고, 돌아오면 다시 기록을 받는다", () => {
    const { s, rt } = start(2);
    run(rt, 8000);
    setAway(rt, 1, true);
    expect(s.players[1].bot).toBe(true);
    const missed = s.players[1].judges[3];
    expect(missed).toBeGreaterThan(0);
    run(rt, 6000);
    expect(s.players[1].judged).toBeGreaterThan(missed);
    applyInput(rt, 1, reportOf(1, Array(60).fill("perfect")));
    expect(s.players[1].judges[0]).toBeLessThan(60);
    setAway(rt, 1, false);
    expect(s.players[1].bot).toBe(false);
    const n = s.players[1].judged + 5;
    applyInput(rt, 1, { r: 1, n, sc: 100, cb: 1, mc: 1, j: [1, 0, 0, n - 1], e: 4, atk: 0 });
    expect(s.players[1].judged).toBe(n);
  });

  it("스냅샷으로 판을 그대로 이어받을 수 있다 (방장 승계)", () => {
    const s = createMatch(9, [{ bot: true, level: 9 }, { bot: true, level: 3 }], { rounds: 1 });
    const rt = createHost(s);
    for (let i = 0; i < 30 * 20; i++) step(rt);
    const snap = makeSnap(s, 5);
    expect(isSnap(snap)).toBe(true);
    expect(isSnap({ v: 1, players: [] })).toBe(false);
    const s2 = stateFromSnap(JSON.parse(JSON.stringify(snap)));
    const rt2 = createHost(s2);
    let guard = 0;
    while (s2.phase !== "gameOver" && guard++ < 30 * 200) step(rt2);
    expect(s2.phase).toBe("gameOver");
    expect(s2.players[0].total).toBeGreaterThan(s.players[0].total);
    expect(s2.ranks).toEqual([1, 2]);
  });

  it("곡 시계는 가장 덜 늦게 온 스냅샷을 기준으로 내 시계를 따라 흐른다", () => {
    const { s, rt } = start(2);
    const buf = new SnapBuffer();
    buf.push(makeSnap(s, 1), 10_000 + 80); // 80ms 늦게 도착
    run(rt, 1000);
    buf.push(makeSnap(s, 2), 11_000 + 20); // 20ms 늦게 도착 → 이쪽이 기준
    run(rt, 1000);
    buf.push(makeSnap(s, 3), 12_000 + 150); // 많이 늦어도 시계는 안 밀린다
    const at = buf.songNow(12_000 + 150);
    expect(Math.abs(at - (songTime(s) + 130))).toBeLessThan(STEP_MS * 2);
    // 스냅샷이 없어도 내 시계로 계속 흐른다
    expect(buf.songNow(12_650) - at).toBeCloseTo(500, 5);
    // 새 판(씨앗이 다름)이면 기준을 다시 잡는다
    const next = createMatch(999, humans(2));
    buf.push(makeSnap(next, 1), 50_000);
    expect(buf.simNow(50_000)).toBeCloseTo(0, 5);
  });
});
