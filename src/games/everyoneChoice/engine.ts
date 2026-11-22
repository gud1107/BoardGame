import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";
import { QUESTIONS } from "./data";

/**
 * 모두의 선택 — pure rules (rulebook: boardGameRule/모두의선택/모두의선택.md).
 *
 * 4–12 players. Each round shows one question with 2–4 options and a round
 * type. Everyone secretly picks an option and bets 1–3 confidence chips
 * (commit = hash, then reveal), then all picks are shown at once:
 *
 *  - 👥 다수파 (major) / ✨ 두 배 (double): the biggest group wins.
 *  - 🔄 반전 (reverse): the smallest non-empty group wins.
 *  - 🐺 외톨이 (lone): whoever is alone on an option scores big and nobody
 *    else scores; with no loner it falls back to 👥.
 *
 * A winning bet of b chips earns +b; a losing one costs LOSS[b] (0 / 1 / 3),
 * so 2 chips pay off above a 1/2 chance and 3 chips above 2/3 (rulebook §4).
 * Highest score after the last round wins.
 */

export type Seat = number;
export type Bet = 1 | 2 | 3;
export const BETS: Bet[] = [1, 2, 3];
/** Points lost by a losing bet of b chips. */
export const LOSS: Record<Bet, number> = { 1: 0, 2: 1, 3: 3 };
/** A lone wolf alone on its option (the only one that round) gets bet + LONE_BONUS. */
export const LONE_BONUS = 2;

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;
export const CHOOSE_MS = 25_000;
export const REVEAL_MS = 5_000;
export const RESOLVED_MS = 8_000;

export type RoundKind = "major" | "reverse" | "lone" | "double";
export const KIND_INFO: Record<RoundKind, { icon: string; label: string; rule: string }> = {
  major: { icon: "👥", label: "다수파", rule: "가장 많은 사람이 고른 쪽이 이겨요" },
  reverse: { icon: "🔄", label: "반전", rule: "가장 적은 사람이 고른 쪽이 이겨요 (아무도 안 고른 선택지는 빼고)" },
  lone: { icon: "🐺", label: "외톨이", rule: "혼자만 고른 사람이 대박! 외톨이가 없으면 다수파 규칙" },
  double: { icon: "✨", label: "두 배", rule: "다수파 규칙 · 얻는 점수와 잃는 점수 모두 두 배" },
};

export type RoundCount = 8 | 12;
export const ROUND_CHOICES: RoundCount[] = [8, 12];
export interface GameOptions {
  rounds: RoundCount;
}
export const DEFAULT_OPTIONS: GameOptions = { rounds: 8 };
export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  return { rounds: o?.rounds === 12 ? 12 : 8 };
}

export type Move = { pick: number; bet: Bet };

export interface RoundReport {
  round: number;
  q: number;
  kind: RoundKind;
  /** Option each seat picked (null = no answer). */
  picks: (number | null)[];
  bets: number[];
  counts: number[];
  /** Winning option indices (empty = nobody won). */
  winners: number[];
  /** Seats that were alone on their option (🐺 rounds only). */
  loners: Seat[];
  deltas: number[];
  /** Why the round went the way it did, for the board's headline. */
  note: "majority" | "tie" | "unanimous" | "minority" | "no-minority" | "lone" | "lones" | "no-lone" | "empty";
}

export interface ChoiceState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  /** Question index (into QUESTIONS) per round. */
  questions: number[];
  kinds: RoundKind[];
  round: number;
  phase: "choose" | "reveal" | "resolved" | "ended";
  step: number;
  /** Hash, or "x" = no commit (timed out → no answer). */
  commits: (string | null)[];
  moves: (Move | null)[];
  scores: number[];
  /** Rounds each seat ended on the winning side. */
  wins: number[];
  last: RoundReport | null;
  history: RoundReport[];
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "commit"; seat: Seat; step: number; hash: string }
  | { type: "reveal"; seat: Seat; step: number; move: Move; salt: string }
  | { type: "advance"; step: number };

/* ── helpers ──────────────────────────────────────────────────────── */

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function moveHash(move: Move, salt: string): string {
  const body = `${move.pick}:${move.bet}`;
  return `${cyrb53(body + "|" + salt, 7)}${cyrb53(salt + "|" + body, 13)}`;
}

export const questionOf = (s: ChoiceState, round = s.round) => QUESTIONS[s.questions[round - 1]];
export const kindOf = (s: ChoiceState, round = s.round) => s.kinds[round - 1];

/**
 * Round types: the first two rounds are plain 👥 so the table learns the
 * game, the last is ✨ double, and the middle mixes 🔄 and 🐺 in (rulebook §3).
 */
export function roundKinds(rounds: RoundCount, rng: () => number): RoundKind[] {
  const majors = rounds === 12 ? 5 : 2;
  const specials = shuffle<RoundKind>(rounds === 12 ? ["reverse", "reverse", "lone", "lone"] : ["reverse", "reverse", "lone"], rng);
  // no two specials back to back: each special takes its own gap around the middle 👥 rounds
  const gaps = shuffle(
    Array.from({ length: majors + 1 }, (_, i) => i),
    rng,
  )
    .slice(0, specials.length)
    .sort((a, b) => a - b);
  const mid: RoundKind[] = [];
  for (let g = 0; g <= majors; g++) {
    if (gaps.includes(g)) mid.push(specials.pop()!);
    if (g < majors) mid.push("major");
  }
  return ["major", "major", ...mid, "double"];
}

/* ── setup ─────────────────────────────────────────────────────────── */

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): ChoiceState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts = sanitizeOptions(options);
  const rng = seededRng((seed ^ 0x7c41) | 0);
  const kinds = roundKinds(opts.rounds, rng);
  // 🐺 rounds need 3+ options (on a 2-option question a loner is just "the minority")
  const deck = shuffle(
    QUESTIONS.map((_, i) => i),
    rng,
  );
  const questions: number[] = [];
  for (const kind of kinds) {
    const idx = deck.findIndex((qi) => !questions.includes(qi) && (kind !== "lone" || QUESTIONS[qi].opts.length >= 3));
    questions.push(deck[idx >= 0 ? idx : questions.length]);
  }
  return {
    seed,
    playerCount: n,
    options: opts,
    questions,
    kinds,
    round: 1,
    phase: "choose",
    step: 0,
    commits: Array(n).fill(null),
    moves: Array(n).fill(null),
    scores: Array(n).fill(0),
    wins: Array(n).fill(0),
    last: null,
    history: [],
    statTally: {},
  };
}

export function isLegal(s: ChoiceState, m: Move): boolean {
  if (!m || typeof m !== "object") return false;
  const q = questionOf(s);
  return Number.isInteger(m.pick) && m.pick >= 0 && m.pick < q.opts.length && (m.bet === 1 || m.bet === 2 || m.bet === 3);
}

/* ── scoring ──────────────────────────────────────────────────────── */

/** Pure round scoring — shared by the engine and the bots' look-ahead. */
export function scoreRound(kind: RoundKind, optionCount: number, picks: (number | null)[], bets: number[]): Omit<RoundReport, "round" | "q" | "kind" | "picks" | "bets"> {
  const counts = Array(optionCount).fill(0);
  for (const p of picks) if (p !== null) counts[p]++;
  const answered = picks.filter((p) => p !== null).length;
  const nonEmpty = counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
  const mult = kind === "double" ? 2 : 1;
  const deltas = picks.map(() => 0);
  if (answered === 0) return { counts, winners: [], loners: [], deltas, note: "empty" };

  const settle = (winners: number[]) =>
    picks.forEach((p, seat) => {
      if (p === null) return;
      const b = bets[seat] as Bet;
      deltas[seat] = winners.includes(p) ? b * mult : LOSS[b] ? -LOSS[b] * mult : 0;
    });

  if (kind === "lone") {
    const loners = picks.map((p, seat) => (p !== null && counts[p] === 1 ? seat : -1)).filter((seat) => seat >= 0);
    // a "loner" among only one or two answers isn't alone in any meaningful way
    if (loners.length > 0 && answered >= 3) {
      for (const seat of loners) deltas[seat] = bets[seat] + (loners.length === 1 ? LONE_BONUS : 0);
      return { counts, winners: loners.map((seat) => picks[seat]!), loners, deltas, note: loners.length === 1 ? "lone" : "lones" };
    }
  }

  let winners: number[];
  let note: RoundReport["note"];
  if (kind === "reverse") {
    if (nonEmpty.length < 2) {
      winners = [];
      note = "no-minority";
    } else {
      const min = Math.min(...nonEmpty.map((i) => counts[i]));
      winners = nonEmpty.filter((i) => counts[i] === min);
      note = winners.length > 1 ? "tie" : "minority";
    }
  } else {
    const max = Math.max(...counts);
    winners = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    note = nonEmpty.length === 1 ? "unanimous" : winners.length > 1 ? "tie" : kind === "lone" ? "no-lone" : "majority";
  }
  settle(winners);
  return { counts, winners, loners: [], deltas, note };
}

function resolve(s: ChoiceState): ChoiceState {
  const q = questionOf(s);
  const kind = kindOf(s);
  const picks = s.moves.map((m) => (m ? m.pick : null));
  const bets = s.moves.map((m) => (m ? m.bet : 0));
  const r = scoreRound(kind, q.opts.length, picks, bets);
  let t = s.statTally;
  const scores = s.scores.map((x, seat) => x + r.deltas[seat]);
  const wins = s.wins.map((x, seat) => x + (picks[seat] !== null && r.deltas[seat] > 0 ? 1 : 0));
  const answered = picks.filter((p) => p !== null).length;
  picks.forEach((p, seat) => {
    if (p === null) {
      t = tallyAdd(t, seat, "skips");
      return;
    }
    t = tallyAdd(t, seat, "answers");
    const won = r.deltas[seat] > 0;
    if (won) t = tallyAdd(t, seat, "roundWins");
    if (won && bets[seat] === 3) t = tallyAdd(t, seat, "allInWins");
    if (!won && bets[seat] === 3) t = tallyAdd(t, seat, "allInLosses");
    if (won && kind === "reverse") t = tallyAdd(t, seat, "reverseWins");
    if (r.loners.includes(seat)) t = tallyAdd(t, seat, "loneWolves");
    if (answered >= 3 && r.counts[p] * 2 < answered) t = tallyAdd(t, seat, "minorityPicks");
    t = tallyMax(t, seat, "maxRound", r.deltas[seat]);
  });
  const report: RoundReport = { round: s.round, q: s.questions[s.round - 1], kind, picks, bets, ...r };
  return { ...s, phase: "resolved", step: s.step + 1, scores, wins, last: report, history: [...s.history, report], statTally: t };
}

function toReveal(s: ChoiceState): ChoiceState {
  const waiting = s.commits.some((c, i) => c !== "x" && s.moves[i] === null);
  if (!waiting) return resolve({ ...s, phase: "reveal" });
  return { ...s, phase: "reveal", step: s.step + 1 };
}

function finish(s: ChoiceState): ChoiceState {
  let t = s.statTally;
  for (const r of computeRankings(s)) {
    t = tallyMax(t, r.seat, "maxScore", s.scores[r.seat]);
    if (r.rank === 1) t = tallyAdd(t, r.seat, "wins");
  }
  return { ...s, phase: "ended", step: s.step + 1, statTally: t };
}

export function applyAction(s: ChoiceState, a: EngineAction): ChoiceState {
  if (s.phase === "ended" || a.step !== s.step) return s;
  if (a.type === "commit") {
    if (s.phase !== "choose" || a.seat < 0 || a.seat >= s.playerCount || s.commits[a.seat] !== null) return s;
    const commits = s.commits.map((c, i) => (i === a.seat ? String(a.hash) : c));
    const next = { ...s, commits };
    return commits.every((c) => c !== null) ? toReveal(next) : next;
  }
  if (a.type === "reveal") {
    if (s.phase !== "reveal" || a.seat < 0 || a.seat >= s.playerCount) return s;
    const hash = s.commits[a.seat];
    if (!hash || hash === "x" || s.moves[a.seat] !== null) return s;
    const ok = !!a.move && moveHash(a.move, a.salt) === hash && isLegal(s, a.move);
    // a reveal that doesn't match its hash counts as no answer (the "x" marker keeps it out of the wait)
    const moves = s.moves.map((m, i) => (i === a.seat && ok ? { pick: a.move.pick, bet: a.move.bet } : m));
    const commits = ok ? s.commits : s.commits.map((c, i) => (i === a.seat ? "x" : c));
    const next = { ...s, moves, commits };
    return moves.every((m, i) => m !== null || commits[i] === "x") ? resolve(next) : next;
  }
  // advance: time's up
  if (s.phase === "choose") return toReveal({ ...s, commits: s.commits.map((c) => c ?? "x") });
  if (s.phase === "reveal") return resolve(s);
  if (s.round >= s.options.rounds) return finish(s);
  return { ...s, round: s.round + 1, phase: "choose", step: s.step + 1, commits: Array(s.playerCount).fill(null), moves: Array(s.playerCount).fill(null) };
}

export function phaseMs(s: ChoiceState): number {
  return s.phase === "choose" ? CHOOSE_MS : s.phase === "reveal" ? REVEAL_MS : s.phase === "resolved" ? RESOLVED_MS : 0;
}

/** Score, then rounds won; equal on both = shared rank. */
export function computeRankings(s: ChoiceState): { seat: Seat; rank: number; score: number }[] {
  const rows = s.scores.map((score, seat) => ({ seat, score, wins: s.wins[seat] }));
  rows.sort((a, b) => b.score - a.score || b.wins - a.wins || a.seat - b.seat);
  return rows.map((r) => ({ seat: r.seat, score: r.score, rank: 1 + rows.filter((o) => o.score > r.score || (o.score === r.score && o.wins > r.wins)).length }));
}

/** End-of-game titles: who matched the crowd most, who went their own way most. */
export function titles(s: ChoiceState): { mainstream: Seat | null; maverick: Seat | null } {
  const minority = Array(s.playerCount).fill(0);
  const majority = Array(s.playerCount).fill(0);
  for (const r of s.history) {
    const answered = r.picks.filter((p) => p !== null).length;
    if (answered < 3) continue;
    const max = Math.max(...r.counts);
    r.picks.forEach((p, seat) => {
      if (p === null) return;
      if (r.counts[p] === max) majority[seat]++;
      if (r.counts[p] * 2 < answered) minority[seat]++;
    });
  }
  const top = (arr: number[]) => {
    const m = Math.max(...arr);
    const who = arr.map((v, i) => (v === m ? i : -1)).filter((i) => i >= 0);
    return m > 0 && who.length === 1 ? who[0] : null;
  };
  return { mainstream: top(majority), maverick: top(minority) };
}
