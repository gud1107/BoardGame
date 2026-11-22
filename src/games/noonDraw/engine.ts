import { shuffle } from "@/lib/rng";
import {
  ARRIVAL_GRACE_MS,
  BETWEEN_MS,
  BRAWL_MAX_ROUNDS,
  brawlHearts,
  brawlSlowLosers,
  DRAW_LIMIT_MS,
  FEINT_GAP_MS,
  FEINT_INFO,
  FEINT_KINDS,
  feintRange,
  INTRO_MS,
  MAX_PLAYERS,
  MIN_HUMAN_RT_MS,
  MIN_PLAYERS,
  READY_MS,
  RESULT_MS,
  STALL_LIMIT,
  SWIFT_RT_MS,
  WAIT_MAX_MS,
  WAIT_MIN_MS,
  WAIT_SPAN_MS,
  WAIT_SPAN_PER_HEAT,
  WINS_FINAL,
  WINS_TO_ADVANCE,
  type FeintKind,
  type Mode,
} from "./data";

/**
 * 정오의 발도 엔진 (룰북 §3~§9). 방장 권위 실시간 — 텔레파시처럼 방장이 50ms마다 `tick`을 돌리고 입력은 도착하는 대로
 * `applyAction`. 순수 함수: 같은 객체를 돌려주면 "바뀐 것 없음".
 *
 * 공정성의 핵심:
 * - **신호 시각은 비밀.** 방장만 가진 `HostSecret`(신호 시각·가짜 신호 계획)은 상태에 들어가지 않는다. 상태에는 이미 일어난
 *   가짜 신호와, 진짜 신호가 터진 뒤에만 `signalAt`이 실린다 — 네트워크를 엿봐도 미리 알 수 없다.
 * - **반응 시간은 각자 기기에서 잰다.** 신호가 내 화면에 뜬 순간부터 내가 누른 순간까지(ms)를 보낸다 → 방장과의 핑 차이가
 *   승부에 들어가지 않는다. 100ms 미만은 사람이 볼 수 없는 속도라 부정 출발(육상 규칙).
 * - 방장 기준으로 신호 전(wait)에 도착한 입력은 무조건 부정 출발.
 */

export type SeatIndex = number;

export type DrawKind = "valid" | "early" | "late";
export interface DrawRec {
  kind: DrawKind;
  /** 반응 시간 ms (valid만) */
  rt: number | null;
  /** 너무 빨라서(100ms 미만) 부정 출발이 된 경우 */
  tooFast?: boolean;
  /** 방장 시각 */
  at: number;
}

export type Verdict = "valid" | "early" | "miss";

export type PointReason = "faster" | "early" | "miss" | "double-early" | "double-miss" | "tie";

export interface Match {
  a: SeatIndex;
  /** null = 부전승 */
  b: SeatIndex | null;
  winsA: number;
  winsB: number;
  target: number;
  winner: SeatIndex | null;
  /** 점수 없이 지나간 합이 이어진 수 */
  stall: number;
  rtA: number[];
  rtB: number[];
  earlyA: number;
  earlyB: number;
  decidedBy?: "bye" | "points" | "judge";
}

export interface BoutResult {
  verdicts: Record<number, { v: Verdict; rt: number | null }>;
  /** 토너먼트: 경기별 이 합의 승자 */
  points?: { match: number; winner: SeatIndex | null; reason: PointReason }[];
  /** 난투: 하트를 잃은 사람 */
  hits?: { seat: SeatIndex; reason: "early" | "miss" | "slow" }[];
  /** 가장 빠른 정상 발도 */
  fastest: SeatIndex | null;
}

export interface Bout {
  id: number;
  phase: "ready" | "wait" | "draw" | "result";
  phaseAt: number;
  heat: number;
  participants: SeatIndex[];
  feints: { kind: FeintKind; at: number }[];
  signalAt: number | null;
  draws: Record<number, DrawRec>;
  /** 🔮 예측: 구경하는 자리 → 고른 자리 */
  picks: Record<number, SeatIndex>;
  result: BoutResult | null;
}

export interface SeatStats {
  bouts: number;
  valid: number;
  rtSum: number;
  /** 가장 빠른 정상 반응 (없으면 0) */
  minRt: number;
  early: number;
  tooFast: number;
  misses: number;
  feintsFaced: number;
  /** 가짜 신호가 있었던 합에서 속지 않은 수 */
  feintsResisted: number;
  swift: number;
  boutWins: number;
  matchWins: number;
  predictions: number;
  predictHits: number;
}

export interface LogEntry {
  bout: number;
  heat: number;
  /** 신호까지 걸린 시간 (wait 시작부터) */
  delay: number;
  feints: FeintKind[];
  result: BoutResult;
}

export interface NoonState {
  mode: Mode;
  playerCount: number;
  practice: boolean;
  phase: "intro" | "bout" | "between" | "finished";
  phaseAt: number;
  /** 토너먼트: 대진표 단계 / 난투: 지난 합 수 */
  round: number;
  bracket: Match[][];
  hearts: number[];
  alive: boolean[];
  /** 난투 탈락 순서 (그룹 = 같은 합에 탈락, 그룹 안은 그 합 성적 순) */
  outOrder: SeatIndex[][];
  bout: Bout | null;
  boutSeq: number;
  stats: SeatStats[];
  log: LogEntry[];
  /** 끝났을 때 1등부터 자리 순서 */
  ranking: SeatIndex[] | null;
}

/** 방장만 가진 비밀 — 절대 방송하지 않는다. */
export interface HostSecret {
  boutId: number;
  signalAt: number;
  plan: { kind: FeintKind; at: number }[];
}

export type NoonAction =
  | { type: "draw"; seat: SeatIndex; early?: boolean; rt?: number }
  | { type: "pick"; seat: SeatIndex; target: SeatIndex };

const LOG_KEEP = 24;

function emptyStats(): SeatStats {
  return { bouts: 0, valid: 0, rtSum: 0, minRt: 0, early: 0, tooFast: 0, misses: 0, feintsFaced: 0, feintsResisted: 0, swift: 0, boutWins: 0, matchWins: 0, predictions: 0, predictHits: 0 };
}

function newMatch(a: SeatIndex, b: SeatIndex | null, target: number): Match {
  const m: Match = { a, b, winsA: 0, winsB: 0, target, winner: null, stall: 0, rtA: [], rtB: [], earlyA: 0, earlyB: 0 };
  if (b === null) {
    m.winner = a;
    m.decidedBy = "bye";
  }
  return m;
}

/** 첫 단계 대진 — 2의 거듭제곱이 아니면 부전승이 생긴다. 부전승끼리 맞붙지 않는다. */
export function firstStage(n: number, rng: () => number): Match[] {
  const seats = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng,
  );
  let size = 1;
  while (size < n) size *= 2;
  const count = size / 2;
  const real = n - count;
  const target = count === 1 ? WINS_FINAL : WINS_TO_ADVANCE;
  const out: Match[] = [];
  let i = 0;
  for (let k = 0; k < real; k++) {
    out.push(newMatch(seats[i], seats[i + 1], target));
    i += 2;
  }
  for (let k = real; k < count; k++) out.push(newMatch(seats[i++], null, target));
  return shuffle(out, rng);
}

function nextStage(prev: Match[]): Match[] {
  const count = prev.length / 2;
  const target = count === 1 ? WINS_FINAL : WINS_TO_ADVANCE;
  const out: Match[] = [];
  for (let k = 0; k < count; k++) out.push(newMatch(prev[2 * k].winner!, prev[2 * k + 1].winner!, target));
  return out;
}

export function createGame(opts: { playerCount: number; mode: Mode; seed: number; now: number; practice?: boolean; rng: () => number }): NoonState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, opts.playerCount));
  const hearts = opts.mode === "brawl" ? brawlHearts(n) : 0;
  return {
    mode: opts.mode,
    playerCount: n,
    practice: !!opts.practice,
    phase: "intro",
    phaseAt: opts.now,
    round: 0,
    bracket: opts.mode === "tournament" ? [firstStage(n, opts.rng)] : [],
    hearts: Array.from({ length: n }, () => hearts),
    alive: Array.from({ length: n }, () => true),
    outOrder: [],
    bout: null,
    boutSeq: 0,
    stats: Array.from({ length: n }, emptyStats),
    log: [],
    ranking: null,
  };
}

export function isFinished(s: NoonState): boolean {
  return s.phase === "finished";
}

export function currentStage(s: NoonState): Match[] {
  return s.bracket[s.round] ?? [];
}

/** 지금 칼을 맞대는 자리들. */
export function activeParticipants(s: NoonState): SeatIndex[] {
  if (s.mode === "brawl") return s.alive.flatMap((a, seat) => (a ? [seat] : []));
  return currentStage(s).flatMap((m) => (m.winner === null && m.b !== null ? [m.a, m.b] : []));
}

/** 이 자리가 들어간 이번 단계 경기 번호 (없으면 -1). */
export function matchIndexOf(s: NoonState, seat: SeatIndex): number {
  return currentStage(s).findIndex((m) => m.a === seat || m.b === seat);
}

export function boutHeat(s: NoonState): number {
  if (s.mode === "brawl") return Math.min(3, Math.floor(s.round / 3));
  const final = currentStage(s).length === 1;
  return Math.min(3, s.round + (final ? 1 : 0));
}

function startBout(s: NoonState, now: number): NoonState {
  const id = s.boutSeq + 1;
  return {
    ...s,
    phase: "bout",
    phaseAt: now,
    boutSeq: id,
    bout: { id, phase: "ready", phaseAt: now, heat: boutHeat(s), participants: activeParticipants(s), feints: [], signalAt: null, draws: {}, picks: {}, result: null },
  };
}

/** 신호 시각과 가짜 신호 계획 (방장 전용). */
export function planBout(boutId: number, heat: number, now: number, rng: () => number): HostSecret {
  const delay = Math.round(Math.min(WAIT_MAX_MS, WAIT_MIN_MS + rng() * (WAIT_SPAN_MS + heat * WAIT_SPAN_PER_HEAT)));
  const [lo, hi] = feintRange(heat);
  const want = lo + Math.floor(rng() * (hi - lo + 1));
  const kinds = FEINT_KINDS.filter((k) => FEINT_INFO[k].minHeat <= heat);
  const plan: { kind: FeintKind; at: number }[] = [];
  const earliest = 650;
  const latest = delay - FEINT_GAP_MS;
  for (let tries = 0; plan.length < want && tries < 40; tries++) {
    if (latest <= earliest) break;
    const at = Math.round(earliest + rng() * (latest - earliest));
    if (plan.some((p) => Math.abs(p.at - at) < FEINT_GAP_MS)) continue;
    let kind = kinds[Math.floor(rng() * kinds.length)];
    if (plan.length > 0 && kinds.length > 1) {
      // 같은 종류가 연달아 나오지 않게
      const last = [...plan].sort((x, y) => y.at - x.at)[0].kind;
      if (kind === last) kind = kinds[(kinds.indexOf(kind) + 1) % kinds.length];
    }
    plan.push({ kind, at });
  }
  plan.sort((x, y) => x.at - y.at);
  return { boutId, signalAt: now + delay, plan: plan.map((p) => ({ kind: p.kind, at: now + p.at })) };
}

/* ── 판정 ─────────────────────────────────────────────────────────── */

function verdictOf(rec: DrawRec | undefined): { v: Verdict; rt: number | null } {
  if (!rec) return { v: "miss", rt: null };
  if (rec.kind === "early") return { v: "early", rt: null };
  if (rec.kind === "late") return { v: "miss", rt: null };
  return { v: "valid", rt: rec.rt };
}

/** 정상 발도가 앞, 그다음 못 뽑음, 부정 출발이 맨 뒤 — 같은 칸은 반응이 빠른 순. */
function perfOrder(verdicts: BoutResult["verdicts"], seats: SeatIndex[]): SeatIndex[] {
  const rank = (v: Verdict) => (v === "valid" ? 0 : v === "miss" ? 1 : 2);
  return [...seats].sort((x, y) => {
    const a = verdicts[x];
    const b = verdicts[y];
    if (rank(a.v) !== rank(b.v)) return rank(a.v) - rank(b.v);
    return (a.rt ?? 0) - (b.rt ?? 0) || x - y;
  });
}

function pointOf(va: { v: Verdict; rt: number | null }, vb: { v: Verdict; rt: number | null }): { side: "a" | "b" | null; reason: PointReason } {
  if (va.v === "early" && vb.v === "early") return { side: null, reason: "double-early" };
  if (va.v === "early") return { side: "b", reason: "early" };
  if (vb.v === "early") return { side: "a", reason: "early" };
  if (va.v === "miss" && vb.v === "miss") return { side: null, reason: "double-miss" };
  if (va.v === "miss") return { side: "b", reason: "miss" };
  if (vb.v === "miss") return { side: "a", reason: "miss" };
  if (va.rt === vb.rt) return { side: null, reason: "tie" };
  return { side: (va.rt ?? 0) < (vb.rt ?? 0) ? "a" : "b", reason: "faster" };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : Infinity);

/** 점수 없는 합이 STALL_LIMIT번 이어지면 심판 판정: 이 경기 평균 반응 → 부정 출발 적은 쪽 → 대진표 위쪽. */
function judge(m: Match): SeatIndex {
  const a = avg(m.rtA);
  const b = avg(m.rtB);
  if (a !== b) return a < b ? m.a : m.b!;
  if (m.earlyA !== m.earlyB) return m.earlyA < m.earlyB ? m.a : m.b!;
  return m.a;
}

function resolveBout(s: NoonState, now: number): NoonState {
  const bout = s.bout!;
  const verdicts: BoutResult["verdicts"] = {};
  for (const seat of bout.participants) verdicts[seat] = verdictOf(bout.draws[seat]);
  const validSeats = bout.participants.filter((p) => verdicts[p].v === "valid");
  const fastest = validSeats.length ? validSeats.reduce((best, p) => ((verdicts[p].rt ?? 0) < (verdicts[best].rt ?? 0) ? p : best)) : null;

  const stats = s.stats.map((st) => ({ ...st }));
  const feintCount = bout.feints.length;
  for (const seat of bout.participants) {
    const st = stats[seat];
    const v = verdicts[seat];
    st.bouts++;
    st.feintsFaced += feintCount;
    if (v.v === "valid") {
      st.valid++;
      st.rtSum += v.rt!;
      st.minRt = st.minRt === 0 ? v.rt! : Math.min(st.minRt, v.rt!);
      if (v.rt! < SWIFT_RT_MS) st.swift++;
      if (feintCount > 0) st.feintsResisted++;
    } else if (v.v === "early") {
      st.early++;
      if (bout.draws[seat]?.tooFast) st.tooFast++;
    } else st.misses++;
  }

  let next: NoonState = { ...s, stats };
  const result: BoutResult = { verdicts, fastest };

  if (s.mode === "tournament") {
    const stage = currentStage(s).map((m) => ({ ...m, rtA: [...m.rtA], rtB: [...m.rtB] }));
    const points: NonNullable<BoutResult["points"]> = [];
    stage.forEach((m, idx) => {
      if (m.winner !== null || m.b === null || !(m.a in verdicts) || !(m.b in verdicts)) return;
      const va = verdicts[m.a];
      const vb = verdicts[m.b];
      if (va.v === "valid") m.rtA.push(va.rt!);
      if (vb.v === "valid") m.rtB.push(vb.rt!);
      if (va.v === "early") m.earlyA++;
      if (vb.v === "early") m.earlyB++;
      const p = pointOf(va, vb);
      let winner: SeatIndex | null = null;
      if (p.side === "a") {
        m.winsA++;
        winner = m.a;
      } else if (p.side === "b") {
        m.winsB++;
        winner = m.b;
      }
      if (winner === null) m.stall++;
      else {
        m.stall = 0;
        stats[winner].boutWins++;
      }
      points.push({ match: idx, winner, reason: p.reason });
      if (m.winsA >= m.target) {
        m.winner = m.a;
        m.decidedBy = "points";
      } else if (m.winsB >= m.target) {
        m.winner = m.b;
        m.decidedBy = "points";
      } else if (m.stall >= STALL_LIMIT) {
        m.winner = judge(m);
        m.decidedBy = "judge";
      }
      if (m.winner !== null) stats[m.winner].matchWins++;
    });
    // 🔮 예측 채점
    for (const [specStr, pick] of Object.entries(bout.picks)) {
      const spec = Number(specStr);
      stats[spec].predictions++;
      const idx = stage.findIndex((m) => m.a === pick || m.b === pick);
      if (points.some((p) => p.match === idx && p.winner === pick)) stats[spec].predictHits++;
    }
    result.points = points;
    const bracket = [...s.bracket];
    bracket[s.round] = stage;
    next = { ...next, bracket };
  } else {
    const failed = bout.participants.filter((p) => verdicts[p].v !== "valid");
    const hits: NonNullable<BoutResult["hits"]> = failed.map((seat) => ({ seat, reason: verdicts[seat].v === "early" ? "early" : "miss" }));
    const slowCount = Math.max(0, brawlSlowLosers(bout.participants.length) - failed.length);
    if (slowCount > 0 && validSeats.length >= 2) {
      const bySpeed = [...validSeats].sort((x, y) => (verdicts[y].rt ?? 0) - (verdicts[x].rt ?? 0) || y - x);
      // 1등(가장 빠른 사람)은 절대 잃지 않는다
      for (const seat of bySpeed.slice(0, Math.min(slowCount, validSeats.length - 1))) hits.push({ seat, reason: "slow" });
    }
    const hearts = [...s.hearts];
    const alive = [...s.alive];
    for (const h of hits) hearts[h.seat] = Math.max(0, hearts[h.seat] - 1);
    const outNow = bout.participants.filter((p) => hearts[p] === 0);
    for (const p of outNow) alive[p] = false;
    for (const p of validSeats) if (p === fastest) stats[p].boutWins++;
    result.hits = hits;
    next = { ...next, hearts, alive, outOrder: outNow.length ? [...s.outOrder, perfOrder(verdicts, outNow)] : s.outOrder };
  }

  const delay = bout.signalAt !== null ? bout.signalAt - bout.phaseAt : now - bout.phaseAt;
  const log = [...s.log, { bout: bout.id, heat: bout.heat, delay, feints: bout.feints.map((f) => f.kind), result }].slice(-LOG_KEEP);
  return { ...next, log, round: s.mode === "brawl" ? s.round + 1 : s.round, bout: { ...bout, phase: "result", phaseAt: now, result } };
}

/** 끝났을 때 순위 (1등부터). */
export function computeRanking(s: NoonState): SeatIndex[] {
  const seats = Array.from({ length: s.playerCount }, (_, i) => i);
  const avgRt = (p: SeatIndex) => (s.stats[p].valid ? s.stats[p].rtSum / s.stats[p].valid : Infinity);
  if (s.mode === "brawl") {
    const survivors = seats.filter((p) => s.alive[p]).sort((x, y) => s.hearts[y] - s.hearts[x] || avgRt(x) - avgRt(y) || x - y);
    return [...survivors, ...[...s.outOrder].reverse().flat()];
  }
  const out: SeatIndex[] = [];
  const placed = new Set<SeatIndex>();
  const tb = (x: SeatIndex, y: SeatIndex) => {
    const mx = s.stats[x].minRt || Infinity;
    const my = s.stats[y].minRt || Infinity;
    return mx - my || s.stats[y].predictHits - s.stats[x].predictHits || x - y;
  };
  for (let r = s.bracket.length - 1; r >= 0; r--) {
    const stage = s.bracket[r];
    if (r === s.bracket.length - 1 && stage.length === 1 && stage[0].winner !== null) {
      out.push(stage[0].winner);
      placed.add(stage[0].winner);
    }
    const losers = stage.flatMap((m) => (m.winner !== null && m.b !== null ? [m.winner === m.a ? m.b : m.a] : [])).filter((p) => !placed.has(p));
    losers.sort(tb);
    for (const p of losers) {
      out.push(p);
      placed.add(p);
    }
  }
  for (const p of seats) if (!placed.has(p)) out.push(p);
  return out;
}

function afterResult(s: NoonState, now: number): NoonState {
  if (s.mode === "brawl") {
    const alive = s.alive.filter(Boolean).length;
    if (alive <= 1 || s.round >= BRAWL_MAX_ROUNDS) return finish(s, now);
    return startBout(s, now);
  }
  const stage = currentStage(s);
  if (stage.some((m) => m.winner === null)) return startBout(s, now);
  if (stage.length === 1) return finish(s, now);
  return { ...s, phase: "between", phaseAt: now, bout: null, bracket: [...s.bracket, nextStage(stage)] };
}

function finish(s: NoonState, now: number): NoonState {
  const done: NoonState = { ...s, phase: "finished", phaseAt: now, bout: s.bout };
  return { ...done, ranking: computeRanking(done) };
}

/**
 * 시간 진행. 방장만 호출한다. `secret`은 방장 손에만 있는 신호 계획 — 새 합이 기다림에 들어갈 때 새로 짠다.
 */
export function tick(s: NoonState, secret: HostSecret | null, now: number, rng: () => number): { state: NoonState; secret: HostSecret | null } {
  if (s.phase === "finished") return { state: s, secret };
  if (s.phase === "intro") {
    if (now - s.phaseAt >= INTRO_MS) return { state: startBout(s, now), secret: null };
    return { state: s, secret };
  }
  if (s.phase === "between") {
    if (now - s.phaseAt >= BETWEEN_MS) return { state: startBout({ ...s, round: s.round + 1 }, now), secret: null };
    return { state: s, secret };
  }
  const bout = s.bout;
  if (!bout) return { state: startBout(s, now), secret: null };
  const allIn = bout.participants.every((p) => bout.draws[p]);

  switch (bout.phase) {
    case "ready": {
      if (now - bout.phaseAt < READY_MS) return { state: s, secret };
      const sec = planBout(bout.id, bout.heat, now, rng);
      return { state: { ...s, bout: { ...bout, phase: "wait", phaseAt: now } }, secret: sec };
    }
    case "wait": {
      // 모두 이미 부정 출발 → 기다릴 것 없이 판정
      if (allIn) return { state: resolveBout(s, now), secret };
      let sec = secret;
      if (!sec || sec.boutId !== bout.id) sec = planBout(bout.id, bout.heat, now, rng);
      let feints = bout.feints;
      const due = sec.plan.filter((p) => p.at <= now);
      if (due.length > feints.length) feints = due.map((p) => ({ kind: p.kind, at: p.at }));
      if (now >= sec.signalAt) return { state: { ...s, bout: { ...bout, feints, phase: "draw", signalAt: now } }, secret: sec };
      if (feints !== bout.feints) return { state: { ...s, bout: { ...bout, feints } }, secret: sec };
      return { state: s, secret: sec };
    }
    case "draw": {
      if (allIn || now >= (bout.signalAt ?? now) + DRAW_LIMIT_MS + ARRIVAL_GRACE_MS) return { state: resolveBout(s, now), secret };
      return { state: s, secret };
    }
    case "result": {
      if (now - bout.phaseAt >= RESULT_MS) return { state: afterResult(s, now), secret: null };
      return { state: s, secret };
    }
  }
}

/** 입력 적용 (도착 순서대로). */
export function applyAction(s: NoonState, a: NoonAction, now: number): NoonState {
  const bout = s.bout;
  if (s.phase !== "bout" || !bout) return s;
  if (a.type === "pick") {
    if (s.mode !== "tournament") return s;
    if (bout.phase !== "ready" && bout.phase !== "wait") return s;
    if (bout.participants.includes(a.seat) || !bout.participants.includes(a.target)) return s;
    if (a.seat < 0 || a.seat >= s.playerCount || bout.picks[a.seat] === a.target) return s;
    return { ...s, bout: { ...bout, picks: { ...bout.picks, [a.seat]: a.target } } };
  }
  if (!bout.participants.includes(a.seat) || bout.draws[a.seat]) return s;
  if (bout.phase === "ready" || bout.phase === "result") return s;
  let rec: DrawRec;
  if (bout.phase === "wait" || a.early) rec = { kind: "early", rt: null, at: now };
  else {
    const rt = typeof a.rt === "number" && Number.isFinite(a.rt) ? Math.round(a.rt) : null;
    if (rt === null) return s;
    if (rt < MIN_HUMAN_RT_MS) rec = { kind: "early", rt: null, tooFast: true, at: now };
    else if (rt > DRAW_LIMIT_MS) rec = { kind: "late", rt: null, at: now };
    else rec = { kind: "valid", rt, at: now };
  }
  return { ...s, bout: { ...bout, draws: { ...bout.draws, [a.seat]: rec } } };
}

/** 평균 반응 (정상 발도만, 없으면 null). */
export function avgRt(st: SeatStats): number | null {
  return st.valid ? Math.round(st.rtSum / st.valid) : null;
}
