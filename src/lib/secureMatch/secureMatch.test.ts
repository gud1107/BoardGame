import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, advance, createMatch, seatAllowed, setBots, viewFor, type MatchRecord } from "./core";
import { liarSecure, liarView } from "@/games/liarGame/secure";
import { applyAction, currentPlan, startGame, type GameState } from "@/games/liarGame/engine";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe("liar view hides secrets", () => {
  it("a liar (classic) never receives the word, the choices or later rounds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = startGame(5, seed, { rounds: 3 });
      const plan = currentPlan(s);
      const v = liarView(s, plan.liarSeat);
      expect(strings(v)).not.toContain(plan.word);
      expect(v.plan[0].liarSeat).toBe(plan.liarSeat);
      expect(v.plan[0].options).toEqual([]);
      for (const later of s.plan.slice(1)) expect(strings(v)).not.toContain(later.word);
    }
  });

  it("citizens don't learn who the liar is", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = startGame(6, seed, { rounds: 2 });
      const liar = currentPlan(s).liarSeat;
      for (let seat = 0; seat < 6; seat++) {
        if (seat === liar) continue;
        const v = liarView(s, seat);
        expect(v.plan.every((p) => p.liarSeat === -1)).toBe(true);
        expect(v.plan[0].word).toBe(currentPlan(s).word);
      }
    }
  });

  it("a fool-mode liar gets the fake word as their own and doesn't know they're the liar", () => {
    const s = startGame(4, 7, { mode: "fool" });
    const plan = currentPlan(s);
    const v = liarView(s, plan.liarSeat);
    expect(v.plan[0].word).toBe(plan.fakeWord);
    expect(v.plan[0].liarSeat).toBe(-1);
    expect(strings(v)).not.toContain(plan.word);
    for (let seat = 0; seat < 4; seat++) if (seat !== plan.liarSeat) expect(strings(liarView(s, seat))).not.toContain(plan.fakeWord);
  });

  it("others' descriptions this lap and votes in progress stay hidden", () => {
    let s = startGame(4, 3);
    s = applyAction(s, { type: "DESCRIBE", seat: 1, text: "아주 비밀스러운 설명" });
    expect(strings(liarView(s, 0))).not.toContain("아주 비밀스러운 설명");
    expect(strings(liarView(s, 1))).toContain("아주 비밀스러운 설명");
    for (const seat of [0, 2, 3]) s = applyAction(s, { type: "DESCRIBE", seat, text: `설명 ${seat}번 좌석` });
    expect(s.phase).toBe("discuss");
    expect(strings(liarView(s, 0))).toContain("아주 비밀스러운 설명");
    for (let seat = 0; seat < 4; seat++) s = applyAction(s, { type: "READY", seat });
    s = applyAction(s, { type: "VOTE", seat: 2, target: 1 });
    expect(liarView(s, 0).votes[2]).toBeNull();
    expect(2 in liarView(s, 0).votes).toBe(true); // "투표 완료" 표시는 그대로
    expect(liarView(s, 2).votes[2]).toBe(1);
  });

  it("everything is revealed at round end", () => {
    let s = startGame(3, 5, { rounds: 2 });
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    s = applyAction(s, { type: "TIMEOUT", stage: s.stage });
    expect(s.phase).toBe("roundEnd");
    const plan = currentPlan(s);
    const v = liarView(s, plan.liarSeat);
    expect(v.plan[0]).toEqual(s.plan[0]);
    expect(strings(v)).not.toContain(s.plan[1].word);
  });
});

function newMatch(bots: Record<string, number>, seatHashes: Record<string, string>, now = 0): MatchRecord {
  return createMatch(liarSecure as never, { id: "m1", game: "liar-game", playerCount: 4, options: { rounds: 2 }, seatHashes, bots, seed: 42, now });
}

describe("secure match core", () => {
  it("runs a whole game on the server clock with bots and an idle human", () => {
    let rec = newMatch({ 1: 5, 2: 5, 3: 5 }, { 0: sha("t0") });
    let now = 0;
    let version = rec.version;
    for (let i = 0; i < 4000 && (rec.state as GameState).phase !== "ended"; i++) {
      now += 500;
      rec = advance(liarSecure as never, rec, now, Math.random).rec;
      expect(rec.version).toBeGreaterThanOrEqual(version);
      version = rec.version;
    }
    expect((rec.state as GameState).phase).toBe("ended");
    expect(viewFor(liarSecure as never, rec, 0, now).deadlineInMs).toBeNull();
  });

  it("waits for the bot's thinking delay instead of moving instantly", () => {
    const rec = newMatch({ 1: 5, 2: 5, 3: 5 }, { 0: sha("t0") });
    expect(rec.botDueAt).not.toBeNull();
    const before = rec.state;
    const early = advance(liarSecure as never, rec, rec.botDueAt! - 1, Math.random);
    expect(early.rec.state).toBe(before);
    expect(advance(liarSecure as never, rec, rec.botDueAt!, Math.random).rec.state).not.toBe(before);
  });

  it("acts only as the caller's own seat and never lets a client send TIMEOUT", () => {
    const rec = newMatch({}, { 0: sha("a"), 1: sha("b"), 2: sha("c"), 3: sha("d") });
    expect(act(liarSecure as never, rec, 0, { type: "TIMEOUT", stage: 1 }, 0, Math.random)).toEqual({ ok: false, reason: "rejected" });
    const res = act(liarSecure as never, rec, 0, { type: "DESCRIBE", seat: 3, text: "남의 자리로 설명" }, 0, Math.random);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const descs = (res.rec.state as GameState).descriptions;
    expect(descs).toHaveLength(1);
    expect(descs[0].seat).toBe(0);
  });

  it("checks the seat token hash", () => {
    const rec = newMatch({}, { 0: sha("a") });
    expect(seatAllowed(rec, 0, sha("a"))).toBe(true);
    expect(seatAllowed(rec, 0, sha("b"))).toBe(false);
    expect(seatAllowed(rec, 1, sha("a"))).toBe(false); // bot/empty seats can't be claimed
  });

  it("takes over a seat with a bot and gives it back", () => {
    const rec = newMatch({}, { 0: sha("a"), 1: sha("b"), 2: sha("c") });
    const on = setBots(rec, { 2: 5 });
    expect(on.changed).toBe(true);
    expect(setBots(on.rec, { 2: 5 }).changed).toBe(false);
    expect(advance(liarSecure as never, on.rec, 1, Math.random).rec.botDueAt).not.toBeNull();
    expect(setBots(on.rec, {}).rec.bots).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Route handler over an in-memory store
// ---------------------------------------------------------------------------

const rows = new Map<string, MatchRecord>();
vi.mock("./store", () => ({
  StoreUnavailable: class extends Error {},
  loadMatch: async (id: string) => structuredClone(rows.get(id) ?? null),
  insertMatch: async (rec: MatchRecord) => void rows.set(rec.id, structuredClone(rec)),
  saveMatch: async (rec: MatchRecord, prev: number) => {
    if (rows.get(rec.id)?.version !== prev) return false;
    rows.set(rec.id, structuredClone(rec));
    return true;
  },
}));

describe("/api/match", () => {
  beforeEach(() => rows.clear());

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/match/route");
    const res = await POST(new Request("http://x/api/match", { method: "POST", body: JSON.stringify(body) }) as never);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it("starts a match, serves per-seat views and rejects a wrong token", async () => {
    const start = await post({ op: "start", game: "liar-game", playerCount: 3, options: { rounds: 1 }, seatHashes: { 0: sha("a"), 1: sha("b"), 2: sha("c") }, bots: {} });
    expect(start.status).toBe(200);
    const matchId = start.json.matchId as string;
    const stored = rows.get(matchId)!.state as GameState;
    const liar = currentPlan(stored).liarSeat;
    const tokens = ["a", "b", "c"];

    const mine = await post({ op: "view", matchId, seat: liar, token: tokens[liar] });
    expect(strings(mine.json.view)).not.toContain(currentPlan(stored).word);
    expect(JSON.stringify(mine.json)).not.toContain('"seatHashes"');

    expect((await post({ op: "view", matchId, seat: liar, token: "wrong" })).status).toBe(401);

    const other = (liar + 1) % 3;
    const moved = await post({ op: "act", matchId, seat: other, token: tokens[other], action: { type: "DESCRIBE", text: "평범한 설명입니다" } });
    expect(moved.status).toBe(200);
    expect((moved.json.version as number) > (mine.json.version as number)).toBe(true);
  });

  it("answers 400 for unknown games and bad actions", async () => {
    expect((await post({ op: "start", game: "nope", playerCount: 3, seatHashes: {}, bots: {} })).status).toBe(400);
    const start = await post({ op: "start", game: "liar-game", playerCount: 3, seatHashes: { 0: sha("a") }, bots: { 1: 3, 2: 3 } });
    const matchId = start.json.matchId as string;
    expect((await post({ op: "act", matchId, seat: 0, token: "a", action: { type: "TIMEOUT", stage: 1 } })).status).toBe(400);
  });
});
