import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";

/**
 * 백 개의 괴담 — pure rules (rulebook: boardGameRule/백개의괴담/백개의괴담.md).
 *
 * Everyone shares one ring of candles. On your turn you tell tales (draw
 * cards): every ghost tale snuffs candles equal to its fear and adds that
 * many points to your unbanked story. Stop to bank them — but tell the same
 * ghost twice in one turn and you're 씌임 (possessed): the story is lost. The
 * game ends the moment the last candle goes out, and whoever snuffed it takes
 * the 백 번째 이야기 curse.
 *
 * Every card is public (the 🪞 mirror shows the next one to the whole
 * table), so the only secret is the deck order, derived from the shared seed
 * like every other lockstep game here.
 */

export type Seat = number;
export type Ghost = "maiden" | "dokkaebi" | "fox" | "reaper" | "egg";
export type Special = "salt" | "candle" | "mirror";
export type CardKind = Ghost | Special;

export interface TaleCard {
  id: number;
  kind: CardKind;
  /** Candles snuffed = points added (ghosts only; specials are 0). */
  fear: number;
}

export const GHOSTS: Ghost[] = ["maiden", "dokkaebi", "fox", "reaper", "egg"];
export const GHOST_FEARS = [1, 1, 2, 2, 3, 3, 4] as const;
export const SPECIAL_COUNTS: Record<Special, number> = { salt: 4, candle: 3, mirror: 3 };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** 🕯️ 새 초 relights this many candles (never above the starting count). */
export const RELIGHT = 5;
/** Most 🧂 salt charms one seat can hold. */
export const SALT_MAX = 2;
/** All five ghosts in one story: banked automatically with this bonus. */
export const PERFECT_BONUS = 5;
/** Snuffing the last candle: the story is lost and half your score (rounded up, at least this much) goes with it. */
export const CURSE_FINE = 10;
export const curseFine = (score: number) => Math.max(CURSE_FINE, Math.ceil(Math.max(0, score) / 2));
/** Later seats start with this many points per place after the first teller (the first teller gets the most turns). */
export const SEAT_HANDICAP = 1;
export const TURN_TIMEOUT_MS = 25_000;

export type CandleCount = 60 | 100;
export const CANDLE_CHOICES: CandleCount[] = [60, 100];

export interface GameOptions {
  candles: CandleCount;
  /** 🔰 show the possession chance and the expected gain before each choice. */
  helper: boolean;
}
export const DEFAULT_OPTIONS: GameOptions = { candles: 100, helper: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  return { candles: o?.candles === 60 ? 60 : 100, helper: o?.helper !== false };
}

export const GHOST_LABEL: Record<CardKind, string> = {
  maiden: "처녀귀신",
  dokkaebi: "도깨비",
  fox: "구미호",
  reaper: "저승사자",
  egg: "달걀귀신",
  salt: "소금 부적",
  candle: "새 초",
  mirror: "거울",
};
export const GHOST_EMOJI: Record<CardKind, string> = {
  maiden: "👻",
  dokkaebi: "👹",
  fox: "🦊",
  reaper: "💀",
  egg: "🥚",
  salt: "🧂",
  candle: "🕯️",
  mirror: "🪞",
};

export const isGhost = (k: CardKind): k is Ghost => (GHOSTS as string[]).includes(k);

/** The full 45-card tale deck (35 ghosts + 10 specials). */
export function fullDeck(): TaleCard[] {
  const out: TaleCard[] = [];
  let id = 1;
  for (const g of GHOSTS) for (const f of GHOST_FEARS) out.push({ id: id++, kind: g, fear: f });
  for (const [k, n] of Object.entries(SPECIAL_COUNTS) as [Special, number][]) for (let i = 0; i < n; i++) out.push({ id: id++, kind: k, fear: 0 });
  return out;
}

export type TaleEvent =
  | { act: "draw"; seat: Seat; card: TaleCard; salted: boolean; turn: number }
  | { act: "bust"; seat: Seat; card: TaleCard; lost: number; turn: number }
  | { act: "stop"; seat: Seat; gained: number; auto: boolean; turn: number }
  | { act: "perfect"; seat: Seat; card: TaleCard; gained: number; turn: number }
  | { act: "curse"; seat: Seat; card: TaleCard; lost: number; turn: number };

export interface TalesState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  phase: "play" | "ended";
  deck: TaleCard[];
  discard: TaleCard[];
  reshuffles: number;
  candles: number;
  candlesMax: number;
  /** Increments on every accepted action — stale actions are rejected by it. */
  turn: number;
  seat: Seat;
  /** Ghost cards told this turn (unbanked). */
  story: TaleCard[];
  /** Cards drawn this turn (any kind). */
  told: number;
  /** 🪞 the next card is face up for everyone. */
  peek: boolean;
  salts: number[];
  scores: number[];
  busts: number[];
  cursedSeat: Seat | null;
  /** Newest first, at most 12. */
  log: TaleEvent[];
  lastEvent: TaleEvent | null;
  statTally?: StatTally;
}

export type EngineAction = { type: "draw"; seat: Seat; turn: number } | { type: "stop"; seat: Seat; turn: number } | { type: "timeout"; seat: Seat; turn: number };

function reshuffled(seed: number, n: number, cards: TaleCard[]): TaleCard[] {
  return shuffle(cards, seededRng((seed ^ Math.imul(n + 1, 0x9e3779b1)) | 0));
}

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): TalesState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts = sanitizeOptions(options);
  const first = Math.floor(seededRng(seed ^ 0x51ed)() * n);
  return {
    seed,
    playerCount: n,
    options: opts,
    phase: "play",
    deck: reshuffled(seed, 0, fullDeck()),
    discard: [],
    reshuffles: 0,
    candles: opts.candles,
    candlesMax: opts.candles,
    turn: 0,
    seat: first,
    story: [],
    told: 0,
    peek: false,
    salts: Array(n).fill(0),
    scores: Array.from({ length: n }, (_, i) => ((i - first + n) % n) * SEAT_HANDICAP),
    busts: Array(n).fill(0),
    cursedSeat: null,
    log: [],
    lastEvent: null,
    statTally: {},
  };
}

export function currentActor(s: TalesState): Seat | null {
  return s.phase === "play" ? s.seat : null;
}

export const storyPoints = (story: readonly TaleCard[]) => story.reduce((a, c) => a + c.fear, 0);

/** The top card (deck[0]), reshuffling the discard in when the deck ran out. */
function topOf(s: TalesState): { card: TaleCard; deck: TaleCard[]; discard: TaleCard[]; reshuffles: number } {
  let deck = s.deck;
  let discard = s.discard;
  let reshuffles = s.reshuffles;
  if (deck.length === 0) {
    reshuffles += 1;
    deck = reshuffled(s.seed, reshuffles, discard);
    discard = [];
  }
  return { card: deck[0], deck: deck.slice(1), discard, reshuffles };
}

/** The card the 🪞 mirror shows (also what a draw would take). */
export function nextCard(s: TalesState): TaleCard | null {
  if (s.deck.length > 0) return s.deck[0];
  if (s.discard.length === 0) return null;
  return reshuffled(s.seed, s.reshuffles + 1, s.discard)[0];
}

function pushLog(s: TalesState, ev: TaleEvent): Pick<TalesState, "log" | "lastEvent"> {
  return { log: [ev, ...s.log].slice(0, 12), lastEvent: ev };
}

function passTurn(s: TalesState): TalesState {
  return { ...s, seat: (s.seat + 1) % s.playerCount, story: [], told: 0, peek: false };
}

function bank(s: TalesState, seat: Seat, bonus: number): { s: TalesState; gained: number } {
  const gained = storyPoints(s.story) + bonus;
  const scores = s.scores.map((v, i) => (i === seat ? v + gained : v));
  let t = tallyAdd(s.statTally, seat, "banked", gained);
  t = tallyAdd(t, seat, "stories");
  t = tallyMax(t, seat, "maxStory", gained);
  t = tallyMax(t, seat, "maxChain", s.story.length);
  return { s: { ...s, scores, discard: [...s.discard, ...s.story], statTally: t }, gained };
}

function draw(s: TalesState): TalesState {
  const seat = s.seat;
  const top = topOf(s);
  const card = top.card;
  let st: TalesState = { ...s, deck: top.deck, discard: top.discard, reshuffles: top.reshuffles, told: s.told + 1, turn: s.turn + 1, peek: false };
  let t = tallyAdd(st.statTally, seat, "told");
  t = tallyAdd(t, seat, "snuffed", Math.min(card.fear, st.candles));
  st = { ...st, statTally: t, candles: Math.max(0, st.candles - card.fear) };

  // the last candle goes out — 백 번째 이야기
  if (card.fear > 0 && st.candles <= 0) {
    const lost = storyPoints(st.story) + card.fear;
    const scores = st.scores.map((v, i) => (i === seat ? v - curseFine(v) : v));
    const ev: TaleEvent = { act: "curse", seat, card, lost, turn: st.turn };
    return { ...st, ...pushLog(st, ev), phase: "ended", scores, cursedSeat: seat, discard: [...st.discard, ...st.story, card], story: [], statTally: tallyAdd(st.statTally, seat, "curses") };
  }

  if (card.kind === "salt") {
    const salts = st.salts.map((v, i) => (i === seat ? Math.min(SALT_MAX, v + 1) : v));
    return { ...st, salts, discard: [...st.discard, card], ...pushLog(st, { act: "draw", seat, card, salted: false, turn: st.turn }) };
  }
  if (card.kind === "candle") {
    const candles = Math.min(st.candlesMax, st.candles + RELIGHT);
    return { ...st, candles, discard: [...st.discard, card], statTally: tallyAdd(st.statTally, seat, "relit"), ...pushLog(st, { act: "draw", seat, card, salted: false, turn: st.turn }) };
  }
  if (card.kind === "mirror") {
    return { ...st, peek: true, discard: [...st.discard, card], statTally: tallyAdd(st.statTally, seat, "mirrors"), ...pushLog(st, { act: "draw", seat, card, salted: false, turn: st.turn }) };
  }

  const dup = st.story.some((c) => c.kind === card.kind);
  if (dup) {
    if (st.salts[seat] > 0) {
      const salts = st.salts.map((v, i) => (i === seat ? v - 1 : v));
      return { ...st, salts, discard: [...st.discard, card], statTally: tallyAdd(st.statTally, seat, "saltSaves"), ...pushLog(st, { act: "draw", seat, card, salted: true, turn: st.turn }) };
    }
    const lost = storyPoints(st.story) + card.fear;
    const busts = st.busts.map((v, i) => (i === seat ? v + 1 : v));
    const ev: TaleEvent = { act: "bust", seat, card, lost, turn: st.turn };
    const next: TalesState = { ...st, busts, discard: [...st.discard, ...st.story, card], statTally: tallyAdd(tallyAdd(st.statTally, seat, "busts"), seat, "lostToBust", lost), ...pushLog(st, ev) };
    return passTurn(next);
  }

  const story = [...st.story, card];
  st = { ...st, story };
  if (story.length === GHOSTS.length) {
    const b = bank(st, seat, PERFECT_BONUS);
    const ev: TaleEvent = { act: "perfect", seat, card, gained: b.gained, turn: st.turn };
    return passTurn({ ...b.s, statTally: tallyAdd(b.s.statTally, seat, "perfects"), ...pushLog(b.s, ev) });
  }
  return { ...st, ...pushLog(st, { act: "draw", seat, card, salted: false, turn: st.turn }) };
}

function stop(s: TalesState, auto: boolean): TalesState {
  const seat = s.seat;
  const b = bank(s, seat, 0);
  const st = { ...b.s, turn: s.turn + 1 };
  const t = auto ? tallyAdd(st.statTally, seat, "timeouts") : st.statTally;
  return passTurn({ ...st, statTally: t, ...pushLog(st, { act: "stop", seat, gained: b.gained, auto, turn: st.turn }) });
}

export const canStop = (s: TalesState) => s.phase === "play" && s.told > 0;

export function applyAction(s: TalesState, a: EngineAction): TalesState {
  if (s.phase !== "play" || a.seat !== s.seat || a.turn !== s.turn) return s;
  if (a.type === "draw") return draw(s);
  if (a.type === "stop") return canStop(s) ? stop(s, false) : s;
  // timeout: tell the one required tale if none yet, then stop
  let st = s;
  if (st.told === 0) {
    st = draw(st);
    if (st.phase !== "play" || st.seat !== s.seat) return st;
  }
  return stop(st, true);
}

/** Cards still unseen (deck + what a reshuffle would bring back) — public card counting. */
export function unseenCards(s: TalesState): TaleCard[] {
  return s.deck.length > 0 ? s.deck : s.discard;
}

/**
 * Odds for the next draw from public information only (the deck order is not
 * used unless the mirror shows the top card): possession chance, curse chance
 * and the expected change of this turn's unbanked story.
 */
export function drawOdds(s: TalesState, seat: Seat = s.seat): { bust: number; curse: number; gain: number; perfect: number } {
  const pool = s.peek ? [nextCard(s)!].filter(Boolean) : unseenCards(s);
  if (pool.length === 0) return { bust: 0, curse: 0, gain: 0, perfect: 0 };
  const inStory = new Set(s.story.map((c) => c.kind));
  const salts = s.salts[seat] ?? 0;
  const sum = storyPoints(s.story);
  let bust = 0;
  let curse = 0;
  let perfect = 0;
  let gain = 0;
  for (const c of pool) {
    if (c.fear > 0 && c.fear >= s.candles) {
      curse++;
      gain -= sum + curseFine(s.scores[seat] ?? 0);
      continue;
    }
    if (isGhost(c.kind) && inStory.has(c.kind)) {
      if (salts > 0) continue;
      bust++;
      gain -= sum;
      continue;
    }
    if (isGhost(c.kind)) {
      gain += c.fear;
      if (inStory.size === GHOSTS.length - 1) {
        perfect++;
        gain += PERFECT_BONUS;
      }
    }
  }
  const n = pool.length;
  return { bust: bust / n, curse: curse / n, gain: gain / n, perfect: perfect / n };
}

export function computeRankings(s: TalesState): { seat: Seat; rank: number; score: number }[] {
  const rows = s.scores.map((score, seat) => ({ seat, score, busts: s.busts[seat] }));
  rows.sort((a, b) => b.score - a.score || a.busts - b.busts || a.seat - b.seat);
  return rows.map((r) => ({ seat: r.seat, score: r.score, rank: 1 + rows.filter((o) => o.score > r.score || (o.score === r.score && o.busts < r.busts)).length }));
}
