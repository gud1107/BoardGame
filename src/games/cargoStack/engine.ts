/**
 * Pure "화물선 쌓기(Cargo Stack)" rules engine — no React, no I/O.
 * Implements boardGameRule/화물선쌓기/화물선쌓기.md (section numbers below
 * refer to it): one cargo ship, 9 columns × 6 tiers, players take turns
 * dropping containers from a 3-slot crane queue. Score = weight × tier, but
 * the ship's heel (Σ weight × offset + ballast) must stay inside a limit
 * that shrinks as the stack's centre of gravity rises — past it, exposed
 * containers on the low side slide into the sea (§6), and if that's not
 * enough the ship capsizes. Each voyage ends with a weather check (§7).
 *
 * Lockstep like every other online game here: every client replays the same
 * seed + `EngineAction`s; everything is integer / exact-half arithmetic or
 * the same float ops in the same order, so all clients agree.
 */

import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, tallyOf, type StatTally } from "@/games/shared/statTally";

export type Seat = number;

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 6;
/** §2 — deck columns (index 0..8, centre = 4) and tiers (0..5). */
export const COLS = 9;
export const TIERS = 6;
export const CENTER = 4;
/** §3 — a turn must be taken within this. */
export const TURN_TIMEOUT_MS = 30_000;
/** §7 — the voyage result screen waits this long before sailing on. */
export const SAIL_TIMEOUT_MS = 12_000;
export const BALLAST_STEP = 3;
export const BALLAST_MAX = 6;
/** §5 fines and bonuses. */
export const SPILL_FINE = 2;
export const CRUSH_FINE = 2;
export const CAPSIZE_FINE = 10;
export const PASS_FINE = 1;
export const FRAGILE_BONUS = 4;
/** A fragile crate breaks under a crate this heavy (t) placed right on top. */
export const CRUSH_WEIGHT = 3;
/** §6 — at most this many slide off per turn before the ship capsizes; §7 at departure. */
export const MAX_SPILL = 3;
export const MAX_DEPART_SPILL = 4;
/** §6 — limit = LIMIT_BASE − LIMIT_PER_HEIGHT × COG height, floored at LIMIT_MIN. */
export const LIMIT_BASE = 15;
export const LIMIT_PER_HEIGHT = 2;
export const LIMIT_MIN = 6;
export const DOCK_SIZE = 3;
export const VOYAGE_CHOICES = [1, 2, 3] as const;
export type VoyageCount = (typeof VOYAGE_CHOICES)[number];

export type Forecast = "calm" | "swell" | "storm";
export const WAVE: Record<Forecast, number> = { calm: 0, swell: 3, storm: 5 };
export const FORECAST_LABEL: Record<Forecast, string> = { calm: "☀️ 잔잔", swell: "🌊 너울", storm: "⛈️ 폭풍" };

export type Kind = "box" | "steel" | "fragile" | "gold";
export const KIND_LABEL: Record<Kind, string> = { box: "📦 일반", steel: "⚙️ 철강", fragile: "🥚 유리", gold: "💎 귀중품" };
export const KIND_EMOJI: Record<Kind, string> = { box: "📦", steel: "⚙️", fragile: "🥚", gold: "💎" };

export interface Crate {
  id: number;
  kind: Kind;
  len: 1 | 2 | 3;
  /** tonnes */
  w: number;
}

export interface Placed extends Crate {
  /** Leftmost column. */
  x: number;
  /** Tier, 0 = deck. */
  y: number;
  owner: Seat;
  /** Points this crate is currently worth to its owner (lost if it falls). */
  pts: number;
  crushed?: boolean;
}

/** A crate that slid off — `side` is the side it fell from (−1 left / +1 right). */
export interface Spilled extends Placed {
  side: -1 | 1;
}

export interface GameOptions {
  voyages: VoyageCount;
  /** §7 — weather forecasts; off = always calm. */
  weather: boolean;
  /** §10 — 🔰 preview heel / score / spill on the ghost. */
  helper: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { voyages: 3, weather: true, helper: true };

export interface TurnEvent {
  turn: number;
  seat: Seat;
  act: "place" | "ballast" | "pass";
  /** Timed out — the engine picked the move. */
  auto: boolean;
  placed?: Placed;
  slot?: number;
  dir?: -1 | 1;
  crushed: Placed[];
  spilled: Spilled[];
  capsized: boolean;
  /** Fines this seat paid this turn (positive number). */
  fine: number;
  /** The seat's score change this turn (all effects). */
  delta: number;
  T: number;
  lim: number;
  voyage: number;
}

export interface Departure {
  voyage: number;
  forecast: Forecast;
  wave: number;
  capsized: boolean;
  spilled: Spilled[];
  /** Fragile crates delivered intact (+FRAGILE_BONUS each to the owner). */
  fragile: Placed[];
  /** Score change per seat over the whole voyage (departure included). */
  gains: number[];
  /** The deck as it sailed (after the departure spill). */
  deck: Placed[];
  ballast: number;
}

export type Phase = "load" | "depart" | "ended";

export interface CargoState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  /** 0-based voyage index. */
  voyage: number;
  forecasts: Forecast[];
  phase: Phase;
  deck: Placed[];
  pile: Crate[];
  dock: (Crate | null)[];
  ballast: number;
  ballastUsed: boolean[];
  turnsLeft: number[];
  active: Seat;
  startSeat: Seat;
  /** In "depart": who starts the next voyage (and presses ⚓ 다음 항해). */
  nextStart: Seat | null;
  scores: number[];
  voyageStart: number[];
  turn: number;
  lastEvent: TurnEvent | null;
  departure: Departure | null;
  /** Every departure so far (results table). */
  departures: Departure[];
  /** Recent turns, newest last (capped). */
  log: TurnEvent[];
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "place"; seat: Seat; slot: number; x: number }
  | { type: "ballast"; seat: Seat; dir: -1 | 1 }
  | { type: "pass"; seat: Seat }
  | { type: "sail"; seat: Seat }
  | { type: "timeout"; seat: Seat; turn: number };

const LOG_CAP = 40;

// ---------------------------------------------------------------------------
// Setup (§2, §3)
// ---------------------------------------------------------------------------

/** §3 — turns per seat per voyage. */
export function turnsFor(n: number): number {
  if (n <= 1) return 10;
  if (n === 2) return 8;
  if (n === 3) return 6;
  if (n === 4) return 5;
  return 4;
}

type Template = Omit<Crate, "id">;
/** §2 — the 20-crate bag: 📦13 · ⚙️3 · 🥚2 · 💎2. */
export const BAG: Template[] = [
  { kind: "box", len: 1, w: 1 },
  { kind: "box", len: 1, w: 1 },
  { kind: "box", len: 1, w: 2 },
  { kind: "box", len: 1, w: 2 },
  { kind: "box", len: 2, w: 2 },
  { kind: "box", len: 2, w: 2 },
  { kind: "box", len: 2, w: 3 },
  { kind: "box", len: 2, w: 3 },
  { kind: "box", len: 2, w: 3 },
  { kind: "box", len: 3, w: 3 },
  { kind: "box", len: 3, w: 3 },
  { kind: "box", len: 3, w: 4 },
  { kind: "box", len: 3, w: 4 },
  { kind: "steel", len: 1, w: 4 },
  { kind: "steel", len: 2, w: 6 },
  { kind: "steel", len: 2, w: 6 },
  { kind: "fragile", len: 1, w: 1 },
  { kind: "fragile", len: 2, w: 1 },
  { kind: "gold", len: 1, w: 2 },
  { kind: "gold", len: 1, w: 2 },
];

function voyageRng(seed: number, voyage: number) {
  return seededRng(((seed >>> 0) + Math.imul(voyage + 1, 0x9e3779b1)) | 0);
}

/** The voyage's crates: shuffled bags back to back, enough for every turn + the dock. */
export function deckFor(seed: number, voyage: number, playerCount: number): Crate[] {
  const need = playerCount * turnsFor(playerCount) + DOCK_SIZE;
  const rng = voyageRng(seed, voyage);
  const out: Crate[] = [];
  while (out.length < need) for (const t of shuffle(BAG, rng)) out.push({ ...t, id: (voyage + 1) * 1000 + out.length });
  return out.slice(0, need);
}

/** §7 — one forecast per voyage; the last voyage is at least a swell. */
export function forecastsFor(seed: number, voyages: number, weather: boolean): Forecast[] {
  if (!weather) return Array.from({ length: voyages }, () => "calm");
  const rng = seededRng((seed ^ 0x5eadbeef) | 0);
  return Array.from({ length: voyages }, (_, v) => {
    const r = rng();
    const f: Forecast = r < 0.4 ? "calm" : r < 0.8 ? "swell" : "storm";
    return v === voyages - 1 && f === "calm" ? "swell" : f;
  });
}

function voyageState(state: CargoState, voyage: number, startSeat: Seat): CargoState {
  const n = state.playerCount;
  const crates = deckFor(state.seed, voyage, n);
  return {
    ...state,
    voyage,
    phase: "load",
    deck: [],
    dock: crates.slice(0, DOCK_SIZE),
    pile: crates.slice(DOCK_SIZE),
    ballast: 0,
    ballastUsed: Array(n).fill(false),
    turnsLeft: Array(n).fill(turnsFor(n)),
    active: startSeat,
    startSeat,
    nextStart: null,
    voyageStart: [...state.scores],
    departure: null,
  };
}

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): CargoState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount) || 1));
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!VOYAGE_CHOICES.includes(opts.voyages)) opts.voyages = DEFAULT_OPTIONS.voyages;
  const base: CargoState = {
    seed,
    playerCount: n,
    options: opts,
    voyage: 0,
    forecasts: forecastsFor(seed, opts.voyages, opts.weather),
    phase: "load",
    deck: [],
    pile: [],
    dock: [],
    ballast: 0,
    ballastUsed: [],
    turnsLeft: [],
    active: 0,
    startSeat: 0,
    nextStart: null,
    scores: Array(n).fill(0),
    voyageStart: Array(n).fill(0),
    turn: 0,
    lastEvent: null,
    departure: null,
    departures: [],
    log: [],
  };
  return voyageState(base, 0, 0);
}

// ---------------------------------------------------------------------------
// Geometry (§4) and balance (§6)
// ---------------------------------------------------------------------------

export function centerOf(c: { x: number; len: number }): number {
  return c.x + (c.len - 1) / 2;
}

/** Height of the stack in column `c` (0 = empty deck). */
export function colTop(deck: readonly Placed[], c: number): number {
  let top = 0;
  for (const p of deck) if (c >= p.x && c < p.x + p.len && p.y + 1 > top) top = p.y + 1;
  return top;
}

/** The tier a crate of `len` dropped at `x` lands on. */
export function landingTier(deck: readonly Placed[], len: number, x: number): number {
  let y = 0;
  for (let c = x; c < x + len; c++) y = Math.max(y, colTop(deck, c));
  return y;
}

/** §4 — the crate's centre must lie within its supporting columns' span (± half a column). */
export function isSupported(deck: readonly Placed[], len: number, x: number, y: number): boolean {
  if (y === 0) return true;
  let lo = Infinity;
  let hi = -Infinity;
  for (let c = x; c < x + len; c++) {
    if (colTop(deck, c) === y) {
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
  }
  if (lo === Infinity) return false;
  const cx = x + (len - 1) / 2;
  return cx >= lo - 0.5 && cx <= hi + 0.5;
}

export type PlaceCheck = { ok: true; y: number } | { ok: false; y: number; why: "edge" | "full" | "unsupported" };

export function checkPlace(deck: readonly Placed[], len: number, x: number): PlaceCheck {
  if (!Number.isInteger(x) || x < 0 || x + len > COLS) return { ok: false, y: 0, why: "edge" };
  const y = landingTier(deck, len, x);
  if (y >= TIERS) return { ok: false, y, why: "full" };
  if (!isSupported(deck, len, x, y)) return { ok: false, y, why: "unsupported" };
  return { ok: true, y };
}

/** §6 — heel torque: Σ weight × centre offset + ballast. Positive = leaning right. */
export function torqueOf(deck: readonly Placed[], ballast: number): number {
  let t = ballast;
  for (const p of deck) t += p.w * (centerOf(p) - CENTER);
  return t;
}

/** Weighted centre-of-gravity height in tiers (0 for an empty deck). */
export function cogHeight(deck: readonly Placed[]): number {
  let m = 0;
  let h = 0;
  for (const p of deck) {
    m += p.w;
    h += p.w * (p.y + 0.5);
  }
  return m > 0 ? h / m : 0;
}

/** §6 — how much heel the ship can take. */
export function limitOf(deck: readonly Placed[]): number {
  return Math.max(LIMIT_MIN, LIMIT_BASE - LIMIT_PER_HEIGHT * cogHeight(deck));
}

function restsOn(top: { x: number; y: number; len: number }, under: { x: number; y: number; len: number }): boolean {
  return top.y === under.y + 1 && top.x < under.x + under.len && under.x < top.x + top.len;
}

/** Crates with nothing resting on them. */
export function exposedOf(deck: readonly Placed[]): Placed[] {
  return deck.filter((a) => !deck.some((b) => b !== a && restsOn(b, a)));
}

/** §6 — which crate slides off a ship leaning to `side`. */
export function spillPick(deck: readonly Placed[], side: -1 | 1): Placed | null {
  const exp = exposedOf(deck);
  if (exp.length === 0) return null;
  const low = exp.filter((p) => side * (centerOf(p) - CENTER) > 0);
  if (low.length > 0) {
    return [...low].sort((a, b) => b.y - a.y || side * (centerOf(b) - centerOf(a)) || b.id - a.id)[0];
  }
  return [...exp].sort((a, b) => side * (centerOf(b) - centerOf(a)) || b.y - a.y || b.id - a.id)[0];
}

export interface SpillResult {
  deck: Placed[];
  spilled: Spilled[];
  /** Still past the limit after `max` crates fell (→ capsize during loading). */
  over: boolean;
  T: number;
  lim: number;
}

/** Slide crates off until the heel is within `limit − wave`, at most `max`. */
export function resolveSpill(deck: readonly Placed[], ballast: number, wave: number, max: number): SpillResult {
  let cur = [...deck];
  const spilled: Spilled[] = [];
  for (;;) {
    const T = torqueOf(cur, ballast);
    const lim = limitOf(cur);
    if (Math.abs(T) <= lim - wave) return { deck: cur, spilled, over: false, T, lim };
    if (spilled.length >= max) return { deck: cur, spilled, over: true, T, lim };
    const side: -1 | 1 = T > 0 ? 1 : -1;
    const p = spillPick(cur, side);
    if (!p) return { deck: cur, spilled, over: true, T, lim };
    cur = cur.filter((c) => c !== p);
    spilled.push({ ...p, side });
  }
}

export function pointsFor(crate: Pick<Crate, "kind" | "w">, y: number): number {
  return crate.w * (y + 1) * (crate.kind === "gold" ? 2 : 1);
}

// ---------------------------------------------------------------------------
// Move outcomes — shared by the engine, the 🔰 helper preview and the bots
// ---------------------------------------------------------------------------

export interface Outcome {
  ok: boolean;
  placed: Placed | null;
  crushed: Placed[];
  spilled: Spilled[];
  capsized: boolean;
  /** Score change per seat. */
  deltas: number[];
  fine: number;
  deck: Placed[];
  ballast: number;
  T: number;
  lim: number;
}

function settle(state: CargoState, seat: Seat, deck: Placed[], ballast: number, placed: Placed | null, crushed: Placed[]): Outcome {
  const deltas = Array(state.playerCount).fill(0);
  let fine = 0;
  if (placed) deltas[seat] += placed.pts;
  for (const c of crushed) {
    deltas[c.owner] -= c.pts;
    deltas[seat] -= CRUSH_FINE;
    fine += CRUSH_FINE;
  }
  const res = resolveSpill(deck, ballast, 0, MAX_SPILL);
  for (const s of res.spilled) {
    deltas[s.owner] -= s.pts;
    deltas[seat] -= SPILL_FINE;
    fine += SPILL_FINE;
  }
  if (res.over) {
    deltas[seat] -= CAPSIZE_FINE;
    fine += CAPSIZE_FINE;
  }
  return { ok: true, placed, crushed, spilled: res.spilled, capsized: res.over, deltas, fine, deck: res.deck, ballast, T: res.T, lim: res.lim };
}

const BAD: Outcome = { ok: false, placed: null, crushed: [], spilled: [], capsized: false, deltas: [], fine: 0, deck: [], ballast: 0, T: 0, lim: 0 };

export function previewPlace(state: CargoState, seat: Seat, slot: number, x: number): Outcome {
  const crate = state.dock[slot];
  if (!crate) return BAD;
  const chk = checkPlace(state.deck, crate.len, x);
  if (!chk.ok) return BAD;
  const placed: Placed = { ...crate, x, y: chk.y, owner: seat, pts: pointsFor(crate, chk.y) };
  const crushed: Placed[] = [];
  const deck = state.deck.map((a) => {
    if (crate.w >= CRUSH_WEIGHT && a.kind === "fragile" && !a.crushed && restsOn(placed, a)) {
      crushed.push(a);
      return { ...a, crushed: true, pts: 0 };
    }
    return a;
  });
  deck.push(placed);
  return settle(state, seat, deck, state.ballast, placed, crushed);
}

export function canBallast(state: CargoState, seat: Seat, dir: -1 | 1): boolean {
  if (state.phase !== "load" || state.active !== seat || state.ballastUsed[seat]) return false;
  const nb = Math.max(-BALLAST_MAX, Math.min(BALLAST_MAX, state.ballast + dir * BALLAST_STEP));
  return nb !== state.ballast;
}

export function previewBallast(state: CargoState, seat: Seat, dir: -1 | 1): Outcome {
  if (!canBallast(state, seat, dir)) return BAD;
  const nb = Math.max(-BALLAST_MAX, Math.min(BALLAST_MAX, state.ballast + dir * BALLAST_STEP));
  return settle(state, seat, [...state.deck], nb, null, []);
}

export interface Move {
  slot: number;
  x: number;
}

/** Every legal (slot, column) for the current dock. */
export function legalPlacements(state: CargoState): Move[] {
  const out: Move[] = [];
  state.dock.forEach((c, slot) => {
    if (!c) return;
    for (let x = 0; x + c.len <= COLS; x++) if (checkPlace(state.deck, c.len, x).ok) out.push({ slot, x });
  });
  return out;
}

/** §3 — passing is free only when nothing fits and the ballast is spent. */
export function passCost(state: CargoState, seat: Seat): number {
  return legalPlacements(state).length === 0 && state.ballastUsed[seat] ? 0 : PASS_FINE;
}

/** §3 timeout — the safest placement: least lost, then the widest margin, then the lowest slot / column. */
export function autoMove(state: CargoState, seat: Seat): Move | null {
  let best: { m: Move; loss: number; margin: number } | null = null;
  for (const m of legalPlacements(state)) {
    const o = previewPlace(state, seat, m.slot, m.x);
    const own = o.placed ? o.placed.pts : 0;
    const loss = (o.capsized ? 1000 : 0) + Math.max(0, own - o.deltas[seat]);
    const margin = o.lim - Math.abs(o.T);
    if (!best || loss < best.loss || (loss === best.loss && margin > best.margin + 1e-9)) best = { m, loss, margin };
  }
  return best?.m ?? null;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export function currentActor(state: CargoState): Seat | null {
  if (state.phase === "load") return state.active;
  if (state.phase === "depart") return state.nextStart;
  return null;
}

export function remainingTurns(state: CargoState): number {
  return state.turnsLeft.reduce((a, b) => a + b, 0);
}

function nextActive(state: CargoState, after: Seat): Seat | null {
  const n = state.playerCount;
  for (let k = 1; k <= n; k++) {
    const s = (after + k) % n;
    if (state.turnsLeft[s] > 0) return s;
  }
  return null;
}

function tallyTurn(t: StatTally | undefined, seat: Seat, ev: TurnEvent): StatTally | undefined {
  if (ev.act === "place" && ev.placed) {
    const p = ev.placed;
    t = tallyAdd(t, seat, "placed");
    t = tallyAdd(t, seat, "points", p.pts);
    t = tallyMax(t, seat, "maxTier", p.y + 1);
    t = tallyMax(t, seat, "maxPlace", p.pts);
    if (p.kind === "gold") t = tallyAdd(t, seat, "golds");
    if (p.kind === "steel") t = tallyAdd(t, seat, "steel");
  }
  if (ev.act === "ballast") t = tallyAdd(t, seat, "ballasts");
  if (ev.act === "pass") t = tallyAdd(t, seat, "passes");
  if (ev.auto) t = tallyAdd(t, seat, "timeouts");
  if (ev.crushed.length) t = tallyAdd(t, seat, "crushes", ev.crushed.length);
  if (ev.spilled.length) t = tallyAdd(t, seat, "spills", ev.spilled.length);
  for (const s of ev.spilled) t = tallyAdd(t, s.owner, "lost");
  if (ev.capsized) t = tallyAdd(t, seat, "capsizes");
  return t;
}

function commit(state: CargoState, seat: Seat, o: Outcome, ev: Omit<TurnEvent, "crushed" | "spilled" | "capsized" | "fine" | "delta" | "T" | "lim" | "turn" | "voyage">): CargoState {
  const scores = state.scores.map((s, i) => s + (o.deltas[i] ?? 0));
  const event: TurnEvent = {
    ...ev,
    turn: state.turn,
    voyage: state.voyage,
    crushed: o.crushed,
    spilled: o.spilled,
    capsized: o.capsized,
    fine: o.fine,
    delta: o.deltas[seat] ?? 0,
    T: o.T,
    lim: o.lim,
  };
  const turnsLeft = [...state.turnsLeft];
  turnsLeft[seat] = Math.max(0, turnsLeft[seat] - 1);
  let next: CargoState = {
    ...state,
    deck: o.deck,
    ballast: o.ballast,
    scores,
    turnsLeft,
    turn: state.turn + 1,
    lastEvent: event,
    log: [...state.log, event].slice(-LOG_CAP),
    statTally: tallyTurn(state.statTally, seat, event),
  };
  const after = nextActive(next, seat);
  const dockEmpty = next.dock.every((c) => c === null);
  if (o.capsized || after === null || dockEmpty) return endVoyage(next, o.capsized);
  next = { ...next, active: after };
  return next;
}

/** §7 — the weather check, fragile bonus, then the result screen (or the end). */
function endVoyage(state: CargoState, capsized: boolean): CargoState {
  const n = state.playerCount;
  const forecast = state.forecasts[state.voyage] ?? "calm";
  const wave = WAVE[forecast];
  const scores = [...state.scores];
  let tally = state.statTally;
  let deck = state.deck;
  let spilled: Spilled[] = [];
  const fragile: Placed[] = [];
  if (!capsized) {
    const res = resolveSpill(deck, state.ballast, wave, MAX_DEPART_SPILL);
    deck = res.deck;
    spilled = res.spilled;
    for (const s of spilled) {
      scores[s.owner] -= s.pts;
      tally = tallyAdd(tally, s.owner, "lost");
      tally = tallyAdd(tally, s.owner, "stormLost");
    }
    for (const p of deck) {
      if (p.kind === "fragile" && !p.crushed) {
        scores[p.owner] += FRAGILE_BONUS;
        fragile.push(p);
        tally = tallyAdd(tally, p.owner, "fragileSaved");
      }
    }
  }
  const gains = scores.map((s, i) => s - (state.voyageStart[i] ?? 0));
  // §13 cleanVoyages — placed something this voyage and lost nothing.
  const voyageEvents = state.log.filter((e) => e.voyage === state.voyage);
  for (let s = 0; s < n; s++) {
    const placedAny = voyageEvents.some((e) => e.seat === s && e.act === "place");
    const lostAny = voyageEvents.some((e) => e.spilled.some((c) => c.owner === s) || e.crushed.some((c) => c.owner === s)) || spilled.some((c) => c.owner === s);
    if (placedAny && !lostAny && !capsized) tally = tallyAdd(tally, s, "cleanVoyages");
    tally = tallyAdd(tally, s, "voyages");
    tally = tallyMax(tally, s, "maxVoyage", Math.max(0, gains[s]));
  }
  const departure: Departure = { voyage: state.voyage, forecast, wave, capsized, spilled, fragile, gains, deck, ballast: state.ballast };
  const last = state.voyage >= state.options.voyages - 1;
  const base: CargoState = { ...state, deck, scores, statTally: tally, departure, departures: [...state.departures, departure] };
  if (last) return { ...base, phase: "ended", nextStart: null };
  return { ...base, phase: "depart", nextStart: lowestScorer(base) };
}

/** §3 — the lowest score starts the next voyage; ties go to the nearest seat after the last starter. */
export function lowestScorer(state: CargoState): Seat {
  const n = state.playerCount;
  let best = (state.startSeat + 1) % n;
  for (let k = 1; k <= n; k++) {
    const s = (state.startSeat + k) % n;
    if (state.scores[s] < state.scores[best]) best = s;
  }
  return best;
}

function refill(dock: (Crate | null)[], pile: Crate[], slot: number): { dock: (Crate | null)[]; pile: Crate[] } {
  const d = [...dock];
  const p = [...pile];
  d[slot] = p.shift() ?? null;
  return { dock: d, pile: p };
}

function doPlace(state: CargoState, seat: Seat, slot: number, x: number, auto = false): CargoState {
  if (state.phase !== "load" || seat !== state.active) return state;
  if (!Number.isInteger(slot) || slot < 0 || slot >= DOCK_SIZE) return state;
  const o = previewPlace(state, seat, slot, x);
  if (!o.ok || !o.placed) return state;
  const { dock, pile } = refill(state.dock, state.pile, slot);
  return commit({ ...state, dock, pile }, seat, o, { seat, act: "place", auto, placed: o.placed, slot });
}

function doBallast(state: CargoState, seat: Seat, dir: -1 | 1, auto = false): CargoState {
  if (dir !== -1 && dir !== 1) return state;
  const o = previewBallast(state, seat, dir);
  if (!o.ok) return state;
  const ballastUsed = [...state.ballastUsed];
  ballastUsed[seat] = true;
  return commit({ ...state, ballastUsed }, seat, o, { seat, act: "ballast", auto, dir });
}

function doPass(state: CargoState, seat: Seat, auto = false): CargoState {
  if (state.phase !== "load" || seat !== state.active) return state;
  const cost = auto ? 0 : passCost(state, seat);
  const deltas = Array(state.playerCount).fill(0);
  deltas[seat] = -cost;
  const o: Outcome = { ok: true, placed: null, crushed: [], spilled: [], capsized: false, deltas, fine: cost, deck: state.deck, ballast: state.ballast, T: torqueOf(state.deck, state.ballast), lim: limitOf(state.deck) };
  return commit(state, seat, o, { seat, act: "pass", auto });
}

function doSail(state: CargoState, seat: Seat): CargoState {
  if (state.phase !== "depart" || state.nextStart === null) return state;
  if (seat !== state.nextStart) return state;
  return voyageState(state, state.voyage + 1, state.nextStart);
}

function doTimeout(state: CargoState, seat: Seat, turn: number): CargoState {
  if (turn !== state.turn) return state;
  if (state.phase === "depart") return seat === state.nextStart ? voyageState(state, state.voyage + 1, state.nextStart!) : state;
  if (state.phase !== "load" || seat !== state.active) return state;
  const m = autoMove(state, seat);
  if (m) return doPlace(state, seat, m.slot, m.x, true);
  return doPass(state, seat, true);
}

export function applyAction(state: CargoState, action: EngineAction): CargoState {
  switch (action?.type) {
    case "place":
      return doPlace(state, action.seat, action.slot, action.x);
    case "ballast":
      return doBallast(state, action.seat, action.dir);
    case "pass":
      return doPass(state, action.seat);
    case "sail":
      return doSail(state, action.seat);
    case "timeout":
      return doTimeout(state, action.seat, action.turn);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Rankings (§8)
// ---------------------------------------------------------------------------

export interface RankedSeat {
  seat: Seat;
  rank: number;
}

export function lostOf(state: CargoState, seat: Seat): number {
  return tallyOf(state.statTally, seat).lost ?? 0;
}

export function capsizesOf(state: CargoState, seat: Seat): number {
  return tallyOf(state.statTally, seat).capsizes ?? 0;
}

export function computeRankings(state: CargoState): RankedSeat[] {
  const seats = Array.from({ length: state.playerCount }, (_, s) => s);
  const key = (s: Seat) => [state.scores[s], -lostOf(state, s), -capsizesOf(state, s)];
  const cmp = (a: Seat, b: Seat) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...seats].sort((a, b) => cmp(a, b) || a - b);
  const out: RankedSeat[] = [];
  sorted.forEach((s, i) => {
    const prev = out[i - 1];
    out.push({ seat: s, rank: prev && cmp(sorted[i - 1], s) === 0 ? prev.rank : i + 1 });
  });
  return out;
}

/** Heel in degrees for display: ±12° at the limit, capped at ±20°. */
export function heelDeg(T: number, lim: number): number {
  if (lim <= 0) return 0;
  return Math.max(-20, Math.min(20, (T / lim) * 12));
}
