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

describe("era march online replay", async () => {
  const { OnlineDriver, checksum } = await import("./online");
  type Msg = { at: number; to: "host" | "guest"; event: string; payload: unknown };

  /** Two drivers over an in-memory "network" with `latency` ms delay; both sides driven by bots through send(). */
  function room(latency: number, opts: { dropBatchAt?: number } = {}) {
    let now = 0;
    const queue: Msg[] = [];
    let batches = 0;
    const host = new OnlineDriver(0, 99, true, ["A", "B"], (event, payload) => {
      if (event === "batch" && ++batches === opts.dropBatchAt) return;
      queue.push({ at: now + latency, to: "guest", event, payload: structuredClone(payload) });
    }, () => now);
    const guest = new OnlineDriver(1, 99, false, ["A", "B"], (event, payload) => queue.push({ at: now + latency, to: "host", event, payload: structuredClone(payload) }), () => now);
    const deliver = () => {
      for (let i = 0; i < queue.length; ) {
        const m = queue[i];
        if (m.at > now) { i++; continue; }
        queue.splice(i, 1);
        if (m.to === "guest" && m.event === "batch") guest.onBatch(m.payload as never);
        if (m.to === "host" && m.event === "input") { const p = m.payload as { side: 0 | 1; cmd: unknown }; host.onInput(p.side, p.cmd); }
        if (m.to === "host" && m.event === "state-request") queue.push({ at: now + latency, to: "guest", event: "sync", payload: structuredClone(host.snapshot()) });
        if (m.to === "guest" && m.event === "sync") guest.onSync(m.payload as never);
      }
    };
    const mh = newBotMemory(5), mg = newBotMemory(6);
    const hooks = { before: () => {}, after: () => {} };
    /** `hostRuns: false` = the authority stops ticking and only flushes what it already played. */
    const run = (ms: number, hostRuns = true) => {
      for (let t = 0; t < ms; t += 16) {
        now += 16;
        if (hostRuns) {
          for (const c of botThink(host.state(), 0, 7, mh)) host.send(c);
          for (const c of botThink(guest.state(), 1, 7, mg)) guest.send(c);
        }
        host.pump(hostRuns ? 16 : 0, hooks);
        deliver();
        guest.pump(16, hooks);
      }
    };
    return { host, guest, run };
  }

  it("the follower replays the authority's match exactly, despite latency", () => {
    const { host, guest, run } = room(90);
    run(60_000);
    run(2000, false); // let the follower drain
    expect(guest.state().tick).toBeGreaterThan(1000);
    const h = host.state();
    const g = guest.state();
    expect(g.tick).toBe(h.tick);
    expect(checksum(g)).toBe(checksum(h));
    expect(h.units.length + h.players[1].stats.trained).toBeGreaterThan(5); // the guest's commands really reached the host
  }, 30_000);

  it("a lost batch triggers a resync and the follower converges again", () => {
    const { host, guest, run } = room(60, { dropBatchAt: 20 });
    run(30_000);
    run(2000, false);
    expect(guest.replaced).toBe(true);
    expect(checksum(guest.state())).toBe(checksum(host.state()));
  }, 30_000);

  it("the follower can take over authority and keep the match going", () => {
    const { host, guest, run } = room(60);
    run(10_000);
    run(1000, false);
    const t = guest.state().tick;
    guest.becomeAuthority();
    guest.setBot(0, true);
    let sent = 0;
    const g2 = guest as unknown as { emit: (e: string, p: unknown) => void };
    g2.emit = () => { sent++; };
    for (let i = 0; i < 400; i++) guest.pump(16, { before: () => {}, after: () => {} });
    expect(guest.state().tick).toBeGreaterThan(t + 100);
    expect(sent).toBeGreaterThan(0);
    void host;
  });
});
