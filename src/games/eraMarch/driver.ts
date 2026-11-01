/**
 * What drives a match for EraMarchBoard. The board renders and collects
 * commands; a driver owns the simulation clock:
 *
 * - `SoloDriver`: local engine + bot on the other side (offline, pausable).
 * - `OnlineDriver` (online.ts): host-authoritative replay over the network.
 *
 * `pump` advances real time and calls `before`/`after` around every engine
 * tick, so the board can keep the previous positions for interpolation and
 * hand each tick's events to the 3D scene and the sound layer.
 */

import { botThink, newBotMemory, type AiLevel, type BotMemory } from "./ai";
import { TICK_MS, type Loadout } from "./data";
import { startGame, stepGame, type Command, type EraMarchState, type SeatCommand, type Side } from "./engine";

export interface TickHooks {
  before: (s: EraMarchState) => void;
  after: (s: EraMarchState) => void;
}

export interface MatchDriver {
  readonly mySide: Side;
  readonly online: boolean;
  /** Names shown on the base cards, by side. */
  names: [string, string];
  state(): EraMarchState;
  /** Advance by real milliseconds (already speed-scaled by the caller). */
  pump(dtMs: number, hooks: TickHooks): void;
  /** Fraction into the next tick, for interpolation. */
  alpha(): number;
  send(cmd: Command): void;
}

export class SoloDriver implements MatchDriver {
  readonly mySide: Side = 0;
  readonly online = false;
  names: [string, string];
  private s: EraMarchState;
  private acc = 0;
  private pending: Command[] = [];
  private mem: BotMemory;

  constructor(seed: number, private level: AiLevel, myName: string, foeName: string, loadouts?: readonly [Loadout, Loadout]) {
    this.s = startGame(seed, loadouts);
    this.mem = newBotMemory(seed);
    this.names = [myName, foeName];
  }

  state() {
    return this.s;
  }

  alpha() {
    return Math.min(1, this.acc / TICK_MS);
  }

  send(cmd: Command) {
    this.pending.push(cmd);
  }

  pump(dtMs: number, hooks: TickHooks) {
    const s = this.s;
    if (s.winner !== null) return;
    this.acc += dtMs;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 8) {
      this.acc -= TICK_MS;
      steps++;
      const cmds: SeatCommand[] = this.pending.splice(0).map((cmd) => ({ side: 0 as Side, cmd }));
      for (const cmd of botThink(s, 1, this.level, this.mem)) cmds.push({ side: 1, cmd });
      hooks.before(s);
      stepGame(s, cmds);
      hooks.after(s);
      if (s.winner !== null) break;
    }
    if (steps === 8) this.acc = 0;
  }
}
