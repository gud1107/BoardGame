/**
 * 시대의 진격 online driver — host-authoritative command replay.
 *
 * The engine is deterministic (fixed ticks, seeded rng in the state, units in
 * id order), so instead of streaming whole snapshots like mergeDefense, the
 * authority streams *what it applied*: every ~200 ms one `batch` carrying the
 * commands of each tick in (from, to]. The other client steps the same engine
 * with the same commands on the same ticks and ends up with the same match —
 * units, effects and sounds included. Full state only travels on join /
 * reconnect (`state-request` → `state-sync`), and each batch carries a
 * checksum of the authority's state at `to` so a drift (it shouldn't happen)
 * heals itself with a resync.
 *
 * The follower plays a little behind the authority: it only steps ticks it
 * has commands for and speeds up when it falls more than a few ticks back.
 *
 * Authority = the room host, until the host's seat is taken over by a bot
 * (it left); then the other client promotes itself with its own up-to-date
 * state and keeps the match running (`becomeAuthority`). Taken-over seats
 * are played by the authority's bot (Lv.5).
 *
 * Pure logic — the React room wires `emit` to the Supabase channel; tests
 * wire two drivers together in memory.
 */

import { botThink, newBotMemory, type BotMemory } from "./ai";
import { TICK_MS, type Loadout } from "./data";
import { startGame, stepGame, type Command, type EraMarchState, type SeatCommand, type Side } from "./engine";
import type { MatchDriver, TickHooks } from "./driver";

export const BATCH_MS = 200;
const TAKEOVER_LEVEL = 5;

export interface TickCmd {
  tick: number;
  side: Side;
  cmd: Command;
}

export interface Batch {
  from: number;
  to: number;
  cmds: TickCmd[];
  /** Authority checksum at `to`. */
  sum: number;
}

export type OnlineEmit = (event: "input" | "batch" | "state-request", payload: unknown) => void;

/** Cheap fingerprint of everything that matters for sync. */
export function checksum(s: EraMarchState): number {
  let h = (s.tick * 31 + s.rng) | 0;
  const mix = (v: number) => {
    h = (Math.imul(h ^ Math.round(v * 16), 0x01000193) + 0x9e3779b9) | 0;
  };
  for (const p of s.players) {
    mix(p.gold);
    mix(p.xp);
    mix(p.baseHp);
    mix(p.era);
    mix(p.queue.length);
    mix(p.specialCd);
    mix((p.augments ?? []).length);
    mix(p.offer ? p.offer.cards.length : -1);
  }
  for (const u of s.units) {
    mix(u.id);
    mix(u.x);
    mix(u.hp);
  }
  return h >>> 0;
}

const VALID_CMDS = new Set(["train", "cancel", "evolve", "turret", "sell", "slot", "special", "augment", "reroll"]);

/** Shape check for a command that came over the network (the engine validates the rest). */
export function sanitizeCommand(v: unknown): Command | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.t !== "string" || !VALID_CMDS.has(c.t)) return null;
  if ("index" in c && typeof c.index !== "number") return null;
  if ("slot" in c && typeof c.slot !== "number") return null;
  if ("pick" in c && typeof c.pick !== "number") return null;
  if ("kind" in c && typeof c.kind !== "string") return null;
  if ("doctrine" in c && c.doctrine !== undefined && typeof c.doctrine !== "string") return null;
  return c as unknown as Command;
}

export class OnlineDriver implements MatchDriver {
  readonly online = true;
  names: [string, string];
  private s: EraMarchState;
  private acc = 0;
  authority: boolean;
  /** Sides the authority's bot plays (taken over). */
  private bots = new Set<Side>();
  private botMem: [BotMemory, BotMemory];
  // authority side
  private local: Command[] = [];
  private remote: SeatCommand[] = [];
  private out: TickCmd[] = [];
  private sentTo: number;
  private lastFlush = 0;
  // follower side
  private inbox = new Map<number, SeatCommand[]>();
  private confirmedTo = 0;
  private sums = new Map<number, number>();
  private resyncAsked = 0;
  /** Set when a resync replaced the state, so the board can clear stale effects. */
  replaced = false;

  constructor(
    readonly mySide: Side,
    seed: number,
    authority: boolean,
    names: [string, string],
    private emit: OnlineEmit,
    private now: () => number = () => Date.now(),
    loadouts?: readonly [Loadout, Loadout],
  ) {
    this.s = startGame(seed, loadouts);
    this.authority = authority;
    this.names = names;
    this.botMem = [newBotMemory(seed + 11), newBotMemory(seed + 23)];
    this.sentTo = 0;
  }

  state() {
    return this.s;
  }

  alpha() {
    return Math.min(1, this.acc / TICK_MS);
  }

  /** How far the follower trails the authority, in ticks (0 on the authority). */
  lag(): number {
    return this.authority ? 0 : Math.max(0, this.confirmedTo - this.s.tick);
  }

  send(cmd: Command) {
    if (this.authority) this.local.push(cmd);
    else this.emit("input", { side: this.mySide, cmd });
  }

  setBot(side: Side, on: boolean) {
    if (on) this.bots.add(side);
    else this.bots.delete(side);
  }

  isBot(side: Side) {
    return this.bots.has(side);
  }

  /** Authority: a command from the other client. */
  onInput(side: Side, raw: unknown) {
    if (!this.authority || side === this.mySide || this.bots.has(side)) return;
    const cmd = sanitizeCommand(raw);
    if (cmd) this.remote.push({ side, cmd });
  }

  /** Follower: the authority's next commands. */
  onBatch(b: Batch) {
    if (this.authority) return;
    if (b.to <= this.confirmedTo) return;
    if (b.from > this.confirmedTo) {
      // missed a batch — the commands in between are gone; resync
      this.requestSync();
      return;
    }
    for (const c of b.cmds) {
      if (c.tick <= this.s.tick) continue;
      const cmd = sanitizeCommand(c.cmd);
      if (!cmd) continue;
      const list = this.inbox.get(c.tick) ?? [];
      list.push({ side: c.side, cmd });
      this.inbox.set(c.tick, list);
    }
    this.confirmedTo = b.to;
    this.sums.set(b.to, b.sum);
  }

  /** Any client: a full state from the authority (join / reconnect / drift). */
  onSync(state: EraMarchState) {
    if (this.authority) return;
    this.s = state;
    this.confirmedTo = state.tick;
    this.inbox.clear();
    this.sums.clear();
    this.acc = 0;
    this.replaced = true;
  }

  /** Authority: the full state for `state-sync`. */
  snapshot(): EraMarchState {
    return this.s;
  }

  /** The authority left — continue from our own state. */
  becomeAuthority() {
    if (this.authority) return;
    this.authority = true;
    // play out everything already confirmed, drop the rest
    this.inbox.clear();
    this.sentTo = this.s.tick;
    this.out = [];
  }

  private requestSync() {
    const t = this.now();
    if (t - this.resyncAsked < 1500) return;
    this.resyncAsked = t;
    this.emit("state-request", {});
  }

  pump(dtMs: number, hooks: TickHooks) {
    const s = this.s;
    if (this.authority) {
      if (s.winner === null) {
        this.acc += dtMs;
        let steps = 0;
        while (this.acc >= TICK_MS && steps < 8) {
          this.acc -= TICK_MS;
          steps++;
          const tick = s.tick + 1;
          const cmds: SeatCommand[] = [...this.local.splice(0).map((cmd) => ({ side: this.mySide, cmd })), ...this.remote.splice(0)];
          for (const side of this.bots) for (const cmd of botThink(s, side, TAKEOVER_LEVEL, this.botMem[side])) cmds.push({ side, cmd });
          for (const c of cmds) this.out.push({ tick, side: c.side, cmd: c.cmd });
          hooks.before(s);
          stepGame(s, cmds);
          hooks.after(s);
          if (s.winner !== null) break;
        }
        if (steps === 8) this.acc = 0;
      }
      const t = this.now();
      if (s.tick > this.sentTo && (t - this.lastFlush >= BATCH_MS || s.winner !== null)) {
        this.lastFlush = t;
        this.emit("batch", { from: this.sentTo, to: s.tick, cmds: this.out, sum: checksum(s) } satisfies Batch);
        this.out = [];
        this.sentTo = s.tick;
      }
      return;
    }
    // follower: replay confirmed ticks, catching up when behind
    const behind = this.confirmedTo - s.tick;
    const rate = behind > 16 ? 3 : behind > 8 ? 1.5 : 1;
    this.acc += dtMs * rate;
    let steps = 0;
    while (this.acc >= TICK_MS && s.tick < this.confirmedTo && steps < 24) {
      this.acc -= TICK_MS;
      steps++;
      const tick = s.tick + 1;
      const cmds = this.inbox.get(tick) ?? [];
      this.inbox.delete(tick);
      hooks.before(s);
      stepGame(s, cmds);
      hooks.after(s);
      const want = this.sums.get(tick);
      if (want !== undefined) {
        this.sums.delete(tick);
        if (want !== checksum(s)) this.requestSync();
      }
    }
    if (s.tick >= this.confirmedTo) this.acc = Math.min(this.acc, TICK_MS);
  }
}
