import { heelDeg, limitOf, torqueOf, type CargoState, type Departure, type Placed, type Spilled, type TurnEvent } from "./engine";

/**
 * The shared animation timeline (2D and 3D views both sample it): the last
 * turn's crate dropping in, the spills sliding off one by one, a capsize,
 * then the departure's rocking and storm spills. Pure — `frameAt(state, t)`
 * with t = ms since this client saw the state change; Infinity = settled.
 */

export const DROP_MS = 380;
export const SETTLE_MS = 220;
export const SPILL_GAP_MS = 320;
export const SPILL_MS = 680;
export const CAPSIZE_MS = 1900;
export const HORN_MS = 600;
export const ROCK_MS = 2600;
export const DEPART_SPILL_AT = 1100;
export const DEPART_SPILL_GAP = 420;

export interface DisplayCrate {
  c: Placed;
  /** Column / tier in deck units (fractional while moving). */
  x: number;
  y: number;
  /** Roll in radians (falling crates tumble). */
  rot: number;
  opacity: number;
  falling: boolean;
  /** Still dropping from the crane (draw the cable). */
  dropping: boolean;
}

export interface Splash {
  /** Deck column where it hits the water. */
  x: number;
  /** 0..1 progress. */
  u: number;
}

export interface Frame {
  crates: DisplayCrate[];
  /** Target heel in degrees (renderers smooth toward it). */
  heel: number;
  /** Extra rocking (deg) from the departure waves. */
  rock: number;
  /** Ship has gone over (0..1). */
  capsize: number;
  splashes: Splash[];
  /** Still animating. */
  busy: boolean;
  /** Departure horn / sailing — the ship drifts out (0..1). */
  sail: number;
}

const ease = (u: number) => 1 - (1 - u) * (1 - u);
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

function eventMs(ev: TurnEvent): number {
  const spills = ev.spilled.length ? (ev.spilled.length - 1) * SPILL_GAP_MS + SPILL_MS : 0;
  return (ev.act === "place" ? DROP_MS : 0) + SETTLE_MS + spills + (ev.capsized ? CAPSIZE_MS : 0);
}

function departMs(d: Departure): number {
  if (d.capsized) return 0;
  return HORN_MS + ROCK_MS + Math.max(0, d.spilled.length - 1) * DEPART_SPILL_GAP;
}

/** Total length of the animation that follows this state change. */
export function timelineMs(state: CargoState): number {
  const ev = state.lastEvent;
  const dep = currentDeparture(state);
  let ms = 0;
  if (ev && ev.voyage === state.voyage) ms += eventMs(ev);
  if (dep) ms += departMs(dep);
  return ms;
}

export function currentDeparture(state: CargoState): Departure | null {
  return state.phase !== "load" && state.departure && state.departure.voyage === state.voyage ? state.departure : null;
}

function fallCrate(s: Spilled, u: number): DisplayCrate {
  const e = clamp01(u);
  const slide = e < 0.35 ? (e / 0.35) * 0.9 : 0.9 + (e - 0.35) * 3.4;
  const drop = e < 0.35 ? 0 : ((e - 0.35) / 0.65) ** 2 * (s.y + 3.2);
  return { c: s, x: s.x + s.side * slide, y: s.y - drop, rot: -s.side * Math.max(0, e - 0.2) * 1.6, opacity: e > 0.8 ? 1 - (e - 0.8) / 0.2 : 1, falling: true, dropping: false };
}

const still = (c: Placed): DisplayCrate => ({ c, x: c.x, y: c.y, rot: 0, opacity: 1, falling: false, dropping: false });

/** Sample the timeline `t` ms after this client saw `state` arrive. */
export function frameAt(state: CargoState, t: number): Frame {
  const ev = state.lastEvent && state.lastEvent.voyage === state.voyage ? state.lastEvent : null;
  const dep = currentDeparture(state);
  // the deck right after the last turn (before the departure check took crates off)
  const afterTurn: Placed[] = dep ? [...dep.deck, ...dep.spilled] : state.deck;
  const ballast = dep ? dep.ballast : state.ballast;
  const evDur = ev ? eventMs(ev) : 0;
  const total = evDur + (dep ? departMs(dep) : 0);
  const settledHeel = heelDeg(torqueOf(state.deck, state.ballast), limitOf(state.deck));

  if (!Number.isFinite(t) || t >= total) {
    const capsized = !!(dep?.capsized || (ev?.capsized && state.phase !== "load"));
    return { crates: capsized ? [] : state.deck.map(still), heel: capsized ? (ev && ev.T < 0 ? -78 : 78) : settledHeel, rock: 0, capsize: capsized ? 1 : 0, splashes: [], busy: false, sail: dep && !dep.capsized ? 1 : 0 };
  }

  // ── the turn ──
  if (ev && t < evDur) {
    const crates: DisplayCrate[] = [];
    const splashes: Splash[] = [];
    const spillStart = (ev.act === "place" ? DROP_MS : 0) + SETTLE_MS;
    const ballastBefore = ev.act === "ballast" ? ballast - (ev.dir ?? 0) * 3 : ballast;
    const withSpilled = [...afterTurn, ...ev.spilled];
    for (const c of afterTurn) {
      if (ev.placed && c.id === ev.placed.id && t < DROP_MS) {
        const u = ease(t / DROP_MS);
        crates.push({ ...still(c), y: c.y + (1 - u) * (7 - c.y), dropping: true });
      } else crates.push(still(c));
    }
    let gone = 0;
    ev.spilled.forEach((s, i) => {
      const st = spillStart + i * SPILL_GAP_MS;
      if (t < st) crates.push(still(s));
      else {
        const u = (t - st) / SPILL_MS;
        if (u < 1) crates.push(fallCrate(s, u));
        if (u > 0.55 && u < 1.6) splashes.push({ x: s.side > 0 ? 9.3 : -1.3, u: clamp01((u - 0.55) / 1.05) });
        if (u >= 0.4) gone++;
      }
      // a crate that just landed on the spilled pile shows only before its fall
    });
    if (ev.placed && t < DROP_MS && ev.spilled.some((s) => s.id === ev.placed!.id)) {
      // the new crate itself spills: draw it dropping (it's in `spilled`, not `afterTurn`)
      const idx = crates.findIndex((d) => d.c.id === ev.placed!.id && !d.falling);
      const u = ease(t / DROP_MS);
      if (idx >= 0) crates[idx] = { ...crates[idx], y: ev.placed.y + (1 - u) * (7 - ev.placed.y), dropping: true };
    }
    // heel: before the drop → with everything aboard → each spill takes its weight off
    let heel: number;
    if (ev.act === "place" && t < DROP_MS * 0.85) {
      const before = withSpilled.filter((c) => c.id !== ev.placed?.id);
      heel = heelDeg(torqueOf(before, ballastBefore), limitOf(before));
    } else {
      const rest = [...afterTurn, ...ev.spilled.slice(gone)];
      heel = heelDeg(torqueOf(rest, ballast), limitOf(rest));
    }
    let capsize = 0;
    if (ev.capsized) {
      const cs = spillStart + (ev.spilled.length ? (ev.spilled.length - 1) * SPILL_GAP_MS + SPILL_MS : 0);
      if (t >= cs) {
        capsize = clamp01((t - cs) / CAPSIZE_MS);
        const side = ev.T < 0 ? -1 : 1;
        heel = side * (18 + 60 * ease(capsize));
        for (let i = 0; i < crates.length; i++) {
          const d = crates[i];
          if (d.falling) continue;
          const u = clamp01(capsize * 1.4 - d.c.y * 0.05);
          crates[i] = { ...fallCrate({ ...d.c, side }, u * 0.9 + 0.1), falling: u > 0 };
        }
        if (capsize > 0.3) splashes.push({ x: side > 0 ? 9.5 : -1.5, u: clamp01((capsize - 0.3) / 0.7) });
      }
    }
    return { crates, heel, rock: 0, capsize, splashes, busy: true, sail: 0 };
  }

  // ── the departure ──
  if (dep) {
    const td = t - evDur;
    const crates: DisplayCrate[] = dep.deck.map(still);
    const splashes: Splash[] = [];
    let gone = 0;
    dep.spilled.forEach((s, i) => {
      const st = DEPART_SPILL_AT + i * DEPART_SPILL_GAP;
      if (td < st) crates.push(still(s));
      else {
        const u = (td - st) / SPILL_MS;
        if (u < 1) crates.push(fallCrate(s, u));
        if (u > 0.55 && u < 1.6) splashes.push({ x: s.side > 0 ? 9.3 : -1.3, u: clamp01((u - 0.55) / 1.05) });
        if (u >= 0.4) gone++;
      }
    });
    const rest = [...dep.deck, ...dep.spilled.slice(gone)];
    const base = heelDeg(torqueOf(rest, dep.ballast), limitOf(rest));
    const env = Math.sin(Math.PI * clamp01((td - HORN_MS * 0.5) / ROCK_MS));
    const rock = (2 + dep.wave * 1.4) * env * Math.sin((td / 1300) * Math.PI * 2);
    return { crates, heel: base, rock, capsize: 0, splashes, busy: true, sail: clamp01(td / (HORN_MS + ROCK_MS)) };
  }
  return { crates: state.deck.map(still), heel: settledHeel, rock: 0, capsize: 0, splashes: [], busy: false, sail: 0 };
}
