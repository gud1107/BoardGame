import {
  COUNTDOWN_MS,
  GAUGE_GREAT,
  GAUGE_MAX,
  GAUGE_PERFECT,
  GOOD_MS,
  PRANK_BEATS,
  PRANK_KINDS,
  PRANK_LEAD_BEATS,
  PTS,
  COMBO_BONUS_MAX,
  ROUND_END_MS,
  SHIELD_COST,
  SONG_TAIL_MS,
  STEP_MS,
  accuracy,
  applyJudge,
  judgeOf,
  sanitizeOptions,
  zeroTally,
  type GameOptions,
  type Judge,
  type PrankKind,
  type StyleId,
  type Tally,
} from "./data";
import { buildSong, resolveStyle, type Song } from "./song";

/**
 * 박자 난장판 진행 — 방장 기기만 돌린다(손님은 스냅샷을 그린다).
 *
 * 판정은 **각자 기기에서** 한다(네트워크 지연이 박자에 끼어들지 않게). 손님은 지금까지의 누적 기록
 * (`PlayerInput`)을 보내고, 방장은 그걸 점수판에 옮기고 라운드 진행·장난(방해)·순위만 맡는다.
 * 장난은 "몇 박자부터 몇 박자까지"로 정해 4박자 뒤에 시작하므로, 지연이 있어도 모든 기기에서
 * 같은 곡 위치에 걸린다. 봇은 방장이 레벨별 정확도로 노트마다 판정을 뽑는다.
 *
 * `MatchState`는 순수 JSON — 방장이 나가면 손님 하나가 마지막 스냅샷으로 이어받는다.
 */

export type Phase = "countdown" | "play" | "roundEnd" | "gameOver";

export interface PlayerStats {
  perfects: number;
  greats: number;
  goods: number;
  misses: number;
  maxCombo: number;
  pranksSent: number;
  /** 날아온 장난을 게이지로 막음 */
  pranksBlocked: number;
  /** 장난에 걸림 */
  pranksTaken: number;
  /** 미스 없이 끝낸 곡 */
  fullCombos: number;
  roundWins: number;
  /** 한 곡 최고 정확도 (0~100) */
  bestAcc: number;
}

const zeroStats = (): PlayerStats => ({ perfects: 0, greats: 0, goods: 0, misses: 0, maxCombo: 0, pranksSent: 0, pranksBlocked: 0, pranksTaken: 0, fullCombos: 0, roundWins: 0, bestAcc: 0 });

export interface PlayerState extends Tally {
  seat: number;
  bot: boolean;
  lv: number;
  away: boolean;
  /** 이번 곡 전까지의 점수 */
  prev: number;
  /** 총점 (prev + 이번 곡 score) */
  total: number;
  /** 쓴 게이지 (쏜 장난 100 · 막은 장난 50 · 넘친 분) */
  spent: number;
  /** 지금 게이지 0~100 */
  gauge: number;
  stats: PlayerStats;
}

export interface Effect {
  id: number;
  kind: PrankKind;
  from: number;
  to: number;
  /** 시작·끝 박자 */
  b0: number;
  b1: number;
  /** 받는 사람이 게이지로 막았나 */
  blocked: boolean;
}

export type GameEvent = { id: number; at: number } & (
  | { k: "round"; round: number; style: StyleId }
  | { k: "go" }
  | { k: "prank"; from: number; to: number; kind: PrankKind; blocked: boolean; b0: number }
  | { k: "combo"; s: number; n: number }
  | { k: "end"; winners: number[] }
  | { k: "over" }
);

export interface RoundSummary {
  round: number;
  style: StyleId;
  /** 자리별 이번 곡 점수 */
  scores: number[];
  acc: number[];
  maxCombo: number[];
  winners: number[];
  notes: number;
}

export interface MatchState {
  v: 1;
  seed: number;
  rng: number;
  t: number;
  seatCount: number;
  options: GameOptions;
  round: number;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number;
  /** 곡 시각 0에 해당하는 시뮬 시각 */
  songAt: number;
  style: StyleId;
  effects: Effect[];
  effSeq: number;
  players: PlayerState[];
  events: GameEvent[];
  eventSeq: number;
  history: RoundSummary[];
  ranks: number[] | null;
}

export interface SeatSpec {
  bot: boolean;
  level: number;
}

export function rnd(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function emit(s: MatchState, ev: Record<string, unknown> & { k: GameEvent["k"] }) {
  s.events.push({ id: ++s.eventSeq, at: s.t, ...ev } as GameEvent);
  if (s.events.length > 60) s.events = s.events.filter((e) => e.at >= s.t - 5000);
}

export function songOf(s: MatchState): Song {
  return buildSong(s.seed, s.round, s.options.style, s.options.difficulty);
}

/** 지금 곡 시각 (ms) — 카운트다운 중엔 음수 */
export function songTime(s: MatchState): number {
  return s.t - s.songAt;
}

function syncGauge(p: PlayerState) {
  if (p.earned - p.spent > GAUGE_MAX) p.spent = p.earned - GAUGE_MAX;
  p.gauge = Math.max(0, Math.min(GAUGE_MAX, p.earned - p.spent));
}

/* ── 만들기 ─────────────────────────────────────────────────────────── */

export function createMatch(seed: number, seats: SeatSpec[], options: Partial<GameOptions> = {}): MatchState {
  const opts = sanitizeOptions(options);
  const s: MatchState = {
    v: 1,
    seed,
    rng: seed | 0,
    t: 0,
    seatCount: seats.length,
    options: opts,
    round: 0,
    phase: "countdown",
    phaseStart: 0,
    phaseEnd: 0,
    songAt: 0,
    style: resolveStyle(opts.style, seed, 1),
    effects: [],
    effSeq: 0,
    players: seats.map((spec, seat) => ({
      ...zeroTally(),
      seat,
      bot: spec.bot,
      lv: Math.max(1, Math.min(10, Math.round(spec.level) || 5)),
      away: false,
      prev: 0,
      total: 0,
      spent: 0,
      gauge: 0,
      stats: zeroStats(),
    })),
    events: [],
    eventSeq: 0,
    history: [],
    ranks: null,
  };
  startRound(s);
  return s;
}

function startRound(s: MatchState) {
  s.round += 1;
  s.phase = "countdown";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + COUNTDOWN_MS;
  s.songAt = s.phaseEnd;
  s.style = resolveStyle(s.options.style, s.seed, s.round);
  s.effects = [];
  for (const p of s.players) {
    p.prev = p.total;
    Object.assign(p, zeroTally());
    p.spent = 0;
    p.gauge = 0;
  }
  emit(s, { k: "round", round: s.round, style: s.style });
}

/* ── 입력 (누적 기록) ───────────────────────────────────────────────── */

export interface PlayerInput {
  /** 몇 번째 곡의 기록인가 */
  r: number;
  /** 판정이 끝난 노트 수 */
  n: number;
  /** 이번 곡 점수 */
  sc: number;
  cb: number;
  mc: number;
  /** 퍼펙트·그레이트·굿·미스 */
  j: number[];
  /** 모은 게이지 (누적) */
  e: number;
  /** ⚡ 장난 버튼을 누른 횟수 카운터 */
  atk: number;
}

export interface HostRuntime {
  state: MatchState;
  seenAtk: number[];
  acc: number;
  /** 봇이 장난을 쏠 시각 (0 = 아직 안 정함) */
  botAtkAt: number[];
  botRng: { rng: number };
}

export function createHost(state: MatchState): HostRuntime {
  const n = state.seatCount;
  return { state, seenAtk: Array(n).fill(0), acc: 0, botAtkAt: Array(n).fill(0), botRng: { rng: (state.seed ^ 0x2c1b3c6d) | 0 } };
}

const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));

/** 사람의 누적 기록 (방장 기기 자신 또는 손님이 보낸 `in`). 줄어드는 값·말이 안 되는 값은 버린다. */
export function applyInput(rt: HostRuntime, seat: number, inp: Partial<PlayerInput> | null | undefined) {
  const s = rt.state;
  if (!inp || !Number.isInteger(seat) || seat < 0 || seat >= s.seatCount) return;
  const p = s.players[seat];
  if (p.bot || inp.r !== s.round || (s.phase !== "play" && s.phase !== "countdown")) return;
  const total = songOf(s).notes.length;
  const n = int(inp.n, total);
  if (n >= p.judged) {
    const j = Array.isArray(inp.j) ? inp.j.slice(0, 4).map((v) => int(v, total)) : [0, 0, 0, n];
    while (j.length < 4) j.push(0);
    if (j[0] + j[1] + j[2] + j[3] === n) {
      const before = p.combo;
      p.judged = n;
      p.judges = [j[0], j[1], j[2], j[3]];
      p.combo = int(inp.cb, n);
      p.maxCombo = Math.max(p.maxCombo, int(inp.mc, n));
      p.score = Math.min(int(inp.sc, 1e9), (j[0] + j[1] + j[2]) * (PTS.perfect + COMBO_BONUS_MAX));
      p.earned = Math.min(int(inp.e, 1e9), j[0] * GAUGE_PERFECT + j[1] * GAUGE_GREAT);
      p.total = p.prev + p.score;
      syncGauge(p);
      for (const m of [50, 100, 200]) if (before < m && p.combo >= m) emit(s, { k: "combo", s: seat, n: m });
    }
  }
  const atk = Number(inp.atk) || 0;
  if (atk > rt.seenAtk[seat]) {
    rt.seenAtk[seat] = atk;
    tryPrank(s, seat);
  }
}

/** 장난을 받을 사람: 내 바로 위 등수, 내가 1등이면 2등 */
export function prankTarget(s: MatchState, seat: number): number {
  const order = [...s.players].sort((a, b) => b.total - a.total || a.seat - b.seat);
  const i = order.findIndex((p) => p.seat === seat);
  if (order.length < 2) return -1;
  return i === 0 ? order[1].seat : order[i - 1].seat;
}

/** 게이지가 다 찼으면 장난을 쏜다. 쐈으면 true */
export function tryPrank(s: MatchState, seat: number): boolean {
  const p = s.players[seat];
  if (!p || !s.options.mayhem || s.phase !== "play" || p.gauge < GAUGE_MAX) return false;
  const song = songOf(s);
  const b0 = Math.ceil(songTime(s) / song.beatMs) + PRANK_LEAD_BEATS;
  const b1 = b0 + PRANK_BEATS;
  // 곡이 거의 끝났으면 쏠 수 없다 (게이지는 그대로)
  if (b1 > song.totalBeats - 2) return false;
  const to = prankTarget(s, seat);
  if (to < 0) return false;
  const target = s.players[to];
  // 같은 사람에게 같은 구간에 겹쳐 걸리지 않게 뒤로 민다
  let start = b0;
  for (const e of s.effects) if (e.to === to && !e.blocked && e.b1 > start) start = e.b1;
  if (start + PRANK_BEATS > song.totalBeats - 2) return false;
  const kind = PRANK_KINDS[Math.floor(rnd(s) * PRANK_KINDS.length)];
  p.spent += GAUGE_MAX;
  syncGauge(p);
  p.stats.pranksSent++;
  const blocked = target.gauge >= SHIELD_COST;
  if (blocked) {
    target.spent += SHIELD_COST;
    syncGauge(target);
    target.stats.pranksBlocked++;
  } else target.stats.pranksTaken++;
  s.effects.push({ id: ++s.effSeq, kind, from: seat, to, b0: start, b1: start + PRANK_BEATS, blocked });
  emit(s, { k: "prank", from: seat, to, kind, blocked, b0: start });
  return true;
}

/** 이 사람에게 이 박자에 걸려 있는 장난 */
export function activePrank(s: MatchState, seat: number, beat: number): Effect | null {
  for (const e of s.effects) if (e.to === seat && !e.blocked && beat >= e.b0 && beat < e.b1) return e;
  return null;
}

export function setAway(rt: HostRuntime, seat: number, away: boolean) {
  const p = rt.state.players[seat];
  if (!p) return;
  if (away && !p.bot) {
    p.bot = true;
    p.away = true;
    // 지나간 노트는 놓친 것으로 치고 지금부터 봇이 친다
    const s = rt.state;
    if (s.phase === "play") {
      const song = songOf(s);
      const now = songTime(s);
      while (p.judged < song.notes.length && song.notes[p.judged].t < now - GOOD_MS) applyJudge(p, "miss");
      p.total = p.prev + p.score;
    }
  } else if (!away && p.away) {
    p.bot = false;
    p.away = false;
    rt.seenAtk[seat] = 0;
  }
}

/* ── 봇 ─────────────────────────────────────────────────────────────── */

/** 레벨별 타이밍 흔들림(표준편차 ms)과 놓칠 확률 */
export const BOT_SIGMA = [72, 62, 54, 46, 40, 34, 28, 23, 18, 14];
export const BOT_MISS = [0.2, 0.15, 0.11, 0.08, 0.055, 0.035, 0.022, 0.012, 0.006, 0.002];
/** 장난에 걸렸을 때: 흔들림 배수와 더 놓칠 확률 */
export const BOT_PRANK_SIGMA = [2, 2, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2];
export const BOT_PRANK_MISS = [0.25, 0.22, 0.19, 0.16, 0.13, 0.1, 0.08, 0.06, 0.04, 0.03];

function gauss(r: { rng: number }): number {
  const u = Math.max(1e-9, rnd(r));
  const v = rnd(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 봇이 노트 하나를 어떻게 쳤나 */
export function botJudge(r: { rng: number }, lv: number, pranked: boolean): Judge {
  const i = Math.max(0, Math.min(9, Math.round(lv) - 1));
  const miss = BOT_MISS[i] + (pranked ? BOT_PRANK_MISS[i] : 0);
  if (rnd(r) < miss) return "miss";
  const err = Math.abs(gauss(r) * BOT_SIGMA[i] * (pranked ? BOT_PRANK_SIGMA[i] : 1));
  return judgeOf(err);
}

function botsPlay(rt: HostRuntime, song: Song) {
  const s = rt.state;
  const now = songTime(s);
  const order = s.options.mayhem ? [...s.players].sort((a, b) => b.total - a.total || a.seat - b.seat) : [];
  for (const p of s.players) {
    if (!p.bot) continue;
    const before = p.combo;
    let moved = false;
    while (p.judged < song.notes.length && song.notes[p.judged].t <= now) {
      const note = song.notes[p.judged];
      applyJudge(p, botJudge(rt.botRng, p.lv, !!activePrank(s, p.seat, note.beat)));
      moved = true;
    }
    if (moved) {
      p.total = p.prev + p.score;
      syncGauge(p);
      for (const m of [50, 100, 200]) if (before < m && p.combo >= m) emit(s, { k: "combo", s: p.seat, n: m });
    }
    // 장난: 게이지가 차면 0.6~3초 뒤에 쏜다. Lv.7+ 1등은 방패로 아껴 둔다.
    if (s.options.mayhem && p.gauge >= GAUGE_MAX) {
      const keep = p.lv >= 7 && order[0]?.seat === p.seat && s.seatCount > 2;
      if (keep) rt.botAtkAt[p.seat] = 0;
      else if (rt.botAtkAt[p.seat] === 0) rt.botAtkAt[p.seat] = s.t + 600 + rnd(rt.botRng) * 2400;
      else if (s.t >= rt.botAtkAt[p.seat]) {
        rt.botAtkAt[p.seat] = 0;
        tryPrank(s, p.seat);
      }
    } else rt.botAtkAt[p.seat] = 0;
  }
}

/* ── 진행 ───────────────────────────────────────────────────────────── */

export function hostStep(rt: HostRuntime, dtMs: number) {
  rt.acc += Math.min(dtMs, 250);
  while (rt.acc >= STEP_MS) {
    rt.acc -= STEP_MS;
    step(rt);
  }
}

export function step(rt: HostRuntime) {
  const s = rt.state;
  if (s.phase === "gameOver") return;
  s.t += STEP_MS;
  if (s.phase === "countdown") {
    if (s.t >= s.phaseEnd) {
      const song = songOf(s);
      s.phase = "play";
      s.phaseStart = s.t;
      s.phaseEnd = s.songAt + song.lengthMs + SONG_TAIL_MS;
      emit(s, { k: "go" });
    }
  } else if (s.phase === "play") {
    const song = songOf(s);
    botsPlay(rt, song);
    if (s.effects.length) {
      const beat = songTime(s) / song.beatMs;
      s.effects = s.effects.filter((e) => e.b1 > beat - 1);
    }
    if (s.t >= s.phaseEnd) endRound(s, song);
  } else if (s.phase === "roundEnd") {
    if (s.t >= s.phaseEnd) {
      if (s.round >= s.options.rounds) finishMatch(s);
      else startRound(s);
    }
  }
}

function endRound(s: MatchState, song: Song) {
  const total = song.notes.length;
  for (const p of s.players) {
    // 기록이 덜 도착한 노트는 놓친 것으로
    while (p.judged < total) applyJudge(p, "miss");
    p.total = p.prev + p.score;
    const st = p.stats;
    st.perfects += p.judges[0];
    st.greats += p.judges[1];
    st.goods += p.judges[2];
    st.misses += p.judges[3];
    st.maxCombo = Math.max(st.maxCombo, p.maxCombo);
    if (p.judges[3] === 0 && total > 0) st.fullCombos++;
    st.bestAcc = Math.max(st.bestAcc, accuracy(p.judges, total));
  }
  const best = Math.max(...s.players.map((p) => p.score));
  const winners = best > 0 ? s.players.filter((p) => p.score === best).map((p) => p.seat) : [];
  for (const w of winners) s.players[w].stats.roundWins++;
  s.history.push({
    round: s.round,
    style: s.style,
    scores: s.players.map((p) => p.score),
    acc: s.players.map((p) => accuracy(p.judges, total)),
    maxCombo: s.players.map((p) => p.maxCombo),
    winners,
    notes: total,
  });
  s.effects = [];
  s.phase = "roundEnd";
  s.phaseStart = s.t;
  s.phaseEnd = s.t + ROUND_END_MS;
  emit(s, { k: "end", winners });
}

/** 최종 순위: 총점 → 퍼펙트 수 → 최대 콤보. 그래도 같으면 같은 등수. */
export function rankKey(p: PlayerState): number[] {
  return [p.total, p.stats.perfects, p.stats.maxCombo];
}

export function computeRanks(s: MatchState): number[] {
  const cmp = (a: PlayerState, b: PlayerState) => {
    const ka = rankKey(a);
    const kb = rankKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = [...s.players].sort(cmp);
  const ranks = s.players.map(() => 0);
  sorted.forEach((p, i) => {
    ranks[p.seat] = i > 0 && cmp(sorted[i - 1], p) === 0 ? ranks[sorted[i - 1].seat] : i + 1;
  });
  return ranks;
}

function finishMatch(s: MatchState) {
  s.phase = "gameOver";
  s.phaseStart = s.t;
  s.phaseEnd = s.t;
  s.ranks = computeRanks(s);
  emit(s, { k: "over" });
}
