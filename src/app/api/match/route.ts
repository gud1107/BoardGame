import { createHash, randomBytes, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { act, advance, createMatch, seatAllowed, setBots, viewFor, type MatchRecord } from "@/lib/secureMatch/core";
import { SECURE_GAMES } from "@/lib/secureMatch/games";
import { StoreUnavailable, insertMatch, loadMatch, saveMatch } from "@/lib/secureMatch/store";

/**
 * Server-authoritative match API (src/lib/secureMatch/core.ts). Every op is a
 * POST so nothing is cached:
 * - start  { game, playerCount, options, seatHashes, bots } → { matchId }
 * - view   { matchId, seat, token }                         → this seat's view (also fires due timers/bots)
 * - act    { matchId, seat, token, action }                 → this seat's view after the action
 * - bots   { matchId, seat, token, bots }                   → replace the bot roster (takeover / reclaim)
 * 503 means "not set up yet" — the client then falls back to lockstep.
 */

const MAX_RETRIES = 4;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function isHash(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

function seatMap<T>(raw: unknown, ok: (v: unknown) => v is T): Record<string, T> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{1,2}$/.test(k) || !ok(v)) return null;
    out[k] = v;
  }
  return out;
}

const isLevel = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "bad json");
  }
  try {
    if (body.op === "start") return await start(body);
    if (body.op === "view" || body.op === "act" || body.op === "bots") return await mutate(body);
    return fail(400, "unknown op");
  } catch (e) {
    if (e instanceof StoreUnavailable) return fail(503, "unavailable");
    console.error("[api/match]", e);
    return fail(500, "server error");
  }
}

async function start(body: Record<string, unknown>) {
  const game = typeof body.game === "string" ? body.game : "";
  const def = SECURE_GAMES[game];
  if (!def) return fail(400, "unknown game");
  const playerCount = typeof body.playerCount === "number" ? Math.floor(body.playerCount) : NaN;
  const seatHashes = seatMap(body.seatHashes, isHash);
  const bots = seatMap(body.bots ?? {}, isLevel);
  if (!Number.isFinite(playerCount) || !seatHashes || !bots) return fail(400, "bad start");
  const rec = createMatch(def, {
    id: `${game}:${randomBytes(12).toString("hex")}`,
    game,
    playerCount,
    options: body.options ?? {},
    seatHashes,
    bots,
    seed: randomInt(1_000_000_000),
    now: Date.now(),
  });
  await insertMatch(rec);
  return NextResponse.json({ matchId: rec.id });
}

async function mutate(body: Record<string, unknown>) {
  const matchId = typeof body.matchId === "string" ? body.matchId : "";
  const seat = typeof body.seat === "number" ? body.seat : -1;
  const token = typeof body.token === "string" ? body.token : "";
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const rec = await loadMatch(matchId);
    if (!rec) return fail(404, "no match");
    const def = SECURE_GAMES[rec.game];
    if (!def) return fail(404, "no match");
    if (!seatAllowed(rec, seat, sha256(token))) return fail(401, "not your seat");
    const now = Date.now();
    let next: { rec: MatchRecord; changed: boolean };
    if (body.op === "act") {
      const res = act(def, rec, seat, body.action, now, Math.random);
      if (!res.ok) return fail(400, "bad action");
      next = res;
    } else if (body.op === "bots") {
      const bots = seatMap(body.bots, isLevel);
      if (!bots) return fail(400, "bad bots");
      // A human seat that still holds its token can always be handed to a bot (takeover) and back (reclaim).
      const roster = setBots(rec, bots);
      next = roster.changed ? advance(def, roster.rec, now, Math.random) : roster;
      if (roster.changed) next = { rec: { ...next.rec, version: rec.version + 1 }, changed: true };
    } else {
      next = advance(def, rec, now, Math.random);
    }
    if (next.changed && !(await saveMatch(next.rec, rec.version))) continue;
    return NextResponse.json(viewFor(def, next.rec, seat, now));
  }
  return fail(409, "busy");
}
