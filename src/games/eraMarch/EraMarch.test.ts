import { describe, expect, it } from "vitest";
import { botThink, newBotMemory, type AiLevel } from "./ai";
import { ERAS, MATCH_TICKS, UNITS } from "./data";
import { commandError, startGame, stepGame, type SeatCommand } from "./engine";

function play(seed: number, l0: AiLevel, l1: AiLevel, maxTicks = MATCH_TICKS + 2400) {
  const s = startGame(seed);
  const m0 = newBotMemory(seed * 3 + 1);
  const m1 = newBotMemory(seed * 7 + 2);
  const log: string[] = [];
  while (s.winner === null && s.tick < maxTicks) {
    const cmds: SeatCommand[] = [...botThink(s, 0, l0, m0).map((cmd) => ({ side: 0 as const, cmd })), ...botThink(s, 1, l1, m1).map((cmd) => ({ side: 1 as const, cmd }))];
    stepGame(s, cmds);
    for (const e of s.events) if (e.t === "evolve") log.push(`${s.tick}:${e.side}->${e.era}`);
  }
  return { s, log };
}

describe("era march engine", () => {
  it("is deterministic for the same seed and commands", () => {
    const a = play(42, 6, 6, 4000).s;
    const b = play(42, 6, 6, 4000).s;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("validates commands", () => {
    const s = startGame(1);
    expect(commandError(s, 0, { t: "train", kind: "club" })).toBeNull();
    expect(commandError(s, 0, { t: "train", kind: "legion" })).not.toBeNull();
    expect(commandError(s, 0, { t: "evolve" })).toBe("경험치 부족");
    s.players[0].gold = 0;
    expect(commandError(s, 0, { t: "train", kind: "club" })).toBe("골드 부족");
  });

  it("trains, spawns and marches a unit", () => {
    const s = startGame(3);
    stepGame(s, [{ side: 0, cmd: { t: "train", kind: "club" } }]);
    expect(s.players[0].gold).toBe(175 - UNITS.club.cost);
    for (let i = 0; i < 60; i++) stepGame(s, []);
    expect(s.units.length).toBe(1);
    expect(s.units[0].x).toBeGreaterThan(60);
  });

  it("evolving raises max HP and picks a doctrine", () => {
    const s = startGame(5);
    s.players[0].xp = ERAS[1].xpNeed;
    s.players[0].gold = 1000;
    stepGame(s, [{ side: 0, cmd: { t: "evolve", doctrine: "chariot" } }]);
    expect(s.players[0].era).toBe(1);
    expect(s.players[0].doctrines).toEqual(["chariot"]);
    expect(s.players[0].baseMax).toBe(ERAS[1].baseHp);
    expect(s.players[0].specialCd).toBe(0);
  });

  it("bot matches finish, higher level wins more", () => {
    let hiWins = 0;
    const lengths: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const swap = seed % 2 === 0;
      const { s } = play(seed, swap ? 2 : 8, swap ? 8 : 2);
      expect(s.winner).not.toBeNull();
      if (s.winner === (swap ? 1 : 0)) hiWins++;
      lengths.push(s.tick / 20);
    }
    expect(hiWins).toBeGreaterThanOrEqual(9);
  }, 60_000);
});

describe("era march sound", async () => {
  const { compileTrack } = await import("@/lib/audio/proceduralScore");
  const { INSTRUMENTS } = await import("@/lib/audio/proceduralSuite");
  const audio = await import("./eraMarchAudio");
  it("every era score is a clean 4-bar loop on known instruments", () => {
    for (const tracks of audio.ERA_MARCH_BGM_TRACKS) {
      for (const tr of tracks) {
        expect(INSTRUMENTS[tr.voice], tr.voice).toBeDefined();
        expect(compileTrack(tr).length, `${tr.voice} ${tr.pattern}`).toBe(64);
      }
    }
  });
  it("has a cue for every era-specific name the event mapper builds", () => {
    const names = new Set(audio.ERA_MARCH_SFX_NAMES);
    for (let e = 0; e <= 4; e++) {
      expect(names.has(`spawn${e}`)).toBe(true);
      expect(names.has(`sp${e}`)).toBe(true);
      if (e > 0) expect(names.has(`evolve${e}`)).toBe(true);
    }
  });
});
