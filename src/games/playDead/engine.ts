import { seededRng } from "@/lib/rng";

/**
 * 죽은척 기싸움 — 기 모으기(에너지파) 손놀이에 "죽은 척"을 얹은 2~6인 동시 행동 게임.
 * 룰 원전: boardGameRule/죽은척기싸움/죽은척기싸움.md (자체 창작 룰).
 *
 * 핵심
 * - 매 라운드 모두 비공개로 행동을 고르고(커밋) 동시에 공개(리빌)한다.
 * - 서 있으면: 기 모으기 / 막기 / 파(1기) / 장풍(2기) / 에네르기파(3기) / 쓰러진 사람에게 기 뺏기·확인사살.
 * - 피해를 받으면 살았든 죽었든 **무조건 쓰러진다**. 목숨은 모두 3(공개)이지만 장풍·에네르기파
 *   등의 피해량은 범위(예: 1~2)만 공개되고 실제 값은 맞은 사람만 안다 — 쓰러진 사람이 진짜
 *   죽었는지는 공개된 피해 범위로 추리할 수밖에 없다. (처음엔 목숨 카드 2/3을 비공개로 나눴지만
 *   셀프플레이에서 목숨 3 카드의 승률 비중이 4인 83%로 운 의존이 커서, 운을 매 타격에 나눴다.)
 * - 쓰러져 있으면: 숨죽이기 / 일어나기 / 벌떡 기습. 진짜 죽은 사람도 똑같은 메뉴를 받고
 *   (아무 효과 없음) 똑같이 제출해야 해서 타이밍으로도 정체가 새지 않는다.
 * - 3라운드를 연달아 누워 있으면 숨이 차서 강제로 일어난다(살아 있다는 게 드러남).
 * - 실제 생존자가 1명 이하가 되면(또는 최대 라운드) 끝, 모든 정체 공개.
 *
 * 신뢰 모델: 락스텝이라 각 기기가 전체 상태(목숨 포함)를 들고 있다 — 다른 락스텝 게임과 같은
 * 문서화된 한계(docs/architecture.md §2). 화면과 봇은 공개 정보만 쓴다(`publicView`).
 */

export type Seat = number;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_KI = 5;
export const MAX_BLOCK_STREAK = 1;
export const MAX_LIE = 3;
/**
 * "기 폭주": 8라운드부터 모든 피해 범위 +1, 이후 4라운드마다 +1 더. 판이 늘어지지 않게 —
 * 셀프플레이(레벨 7 봇)에서 폭주 없이는 6인전 99%가 최대 라운드까지 갔다.
 */
export const SURGE_ROUND = 8;
export const SURGE_STEP = 4;
export function surgeAt(round: number): number {
  return round < SURGE_ROUND ? 0 : 1 + Math.floor((round - SURGE_ROUND) / SURGE_STEP);
}

export type MoveKind = "charge" | "block" | "pa" | "jangpung" | "energy" | "loot" | "finish" | "hold" | "rise" | "ambush";
export interface Move {
  kind: MoveKind;
  target?: Seat;
}

export const START_HP = 3;
/** 공격 기술: 비용 = 등급(서로 쏘면 높은 등급이 이긴다) */
export const BLAST_TIER: Partial<Record<MoveKind, number>> = { pa: 1, jangpung: 2, energy: 3 };
export const FINISH_COST = 1;
export const LOOT_TAKE = 2;
/** 피해 범위 [최소, 최대] — 범위는 공개, 실제 값은 맞은 사람만 안다 */
export type DmgRange = readonly [number, number];
export const DMG: Record<"pa" | "jangpung" | "energy" | "pierce" | "ambush" | "ambushLooter" | "finish", DmgRange> = {
  pa: [1, 1],
  jangpung: [1, 2],
  energy: [2, 3],
  pierce: [1, 1],
  ambush: [1, 2],
  ambushLooter: [2, 3],
  finish: [1, 2],
};
const BLAST_DMG: Record<number, DmgRange> = { 1: DMG.pa, 2: DMG.jangpung, 3: DMG.energy };

export interface GameOptions {
  /** 행동 고르기 제한 시간(초). 0 = 무제한 */
  chooseSeconds: number;
  /** 0 = 인원에 맞춰 자동 (`maxRoundsFor`) */
  maxRounds: number;
}
export const DEFAULT_OPTIONS: GameOptions = { chooseSeconds: 15, maxRounds: 0 };

/** 인원이 많을수록 다 쓰러뜨리는 데 오래 걸린다 — 셀프플레이로 맞춘 최대 라운드 */
export function maxRoundsFor(seatCount: number): number {
  return seatCount <= 3 ? 15 : seatCount === 4 ? 18 : 20;
}

export interface SeatState {
  /** 비공개: 남은 목숨 */
  hp: number;
  ki: number;
  down: boolean;
  dead: boolean;
  /** 확인사살로 사망이 공개됨 — 더 이상 행동하지 않는다 */
  confirmed: boolean;
  /** 연달아 누워 있은 라운드 수(공개) */
  lie: number;
  blockStreak: number;
  /** 공개 정보: 지금까지 맞은 타격들의 피해 범위 */
  hits: DmgRange[];
  diedRound: number | null;
  /** 개인 기록용 집계 */
  tally: Tally;
}

export interface Tally {
  /** 내 타격이 들어간 라운드에 상대가 실제로 죽은 횟수 */
  kills: number;
  blastHits: number;
  ambushHits: number;
  /** 확인사살로 죽은 척을 폭로 */
  exposes: number;
  /** 기 뺏기로 가져온 기 */
  kiLooted: number;
  /** 살아서 누워 있던(연기한) 라운드 */
  fakeRounds: number;
}
const EMPTY_TALLY: Tally = { kills: 0, blastHits: 0, ambushHits: 0, exposes: 0, kiLooted: 0, fakeRounds: 0 };

export type RoundEvent =
  | { t: "charge"; seat: Seat }
  | { t: "block"; seat: Seat }
  | { t: "blast"; seat: Seat; target: Seat; tier: number; result: "hit" | "blocked" | "pierce" | "clash" | "overpowered"; hit?: Hit }
  | { t: "ambush"; seat: Seat; target: Seat; result: "hit" | "blocked" | "looter"; hit?: Hit }
  | { t: "loot"; seat: Seat; target: Seat; took: number; foiled: boolean }
  | { t: "finish"; seat: Seat; target: Seat; result: "dead" | "exposed" | "countered"; hit?: Hit }
  | { t: "rise"; seat: Seat; reason: "choice" | "breath" }
  | { t: "fall"; seats: Seat[] };

/** 한 번의 타격: 공개 범위 lo~hi, 실제 값 dmg(맞은 사람 화면에만 보여 준다) */
export interface Hit {
  lo: number;
  hi: number;
  dmg: number;
}

export type Phase = "choosing" | "revealing" | "resolved" | "ended";

export interface GameState {
  seed: number;
  seatCount: number;
  options: GameOptions;
  seats: SeatState[];
  round: number;
  phase: Phase;
  /** 단계가 바뀔 때마다 +1 — 타이머/재접속 판정용 */
  stage: number;
  commits: (string | null)[];
  moves: (Move | null)[];
  /** 직전 라운드에 공개된 행동(쓰러진 사람의 행동은 결과로만 드러난다) */
  lastMoves: (Move | null)[];
  events: RoundEvent[];
  ready: boolean[];
  idleStreak: number[];
}

export type EngineAction =
  | { type: "COMMIT"; seat: Seat; round: number; hash: string }
  | { type: "REVEAL"; seat: Seat; round: number; move: Move; salt: string }
  | { type: "READY"; seat: Seat; round: number }
  | { type: "TIMEOUT"; stage: number };

// ---------------------------------------------------------------------------
// 해시 (커밋-공개용, cyrb53)

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
  const body = `${move.kind}:${move.target ?? -1}`;
  return `${cyrb53(body + "|" + salt, 7)}${cyrb53(salt + "|" + body, 13)}`;
}

// ---------------------------------------------------------------------------
// 시작

export function startGame(seatCount: number, seed: number, options: GameOptions = DEFAULT_OPTIONS): GameState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, seatCount));
  return {
    seed,
    seatCount: n,
    options: { ...options, maxRounds: options.maxRounds > 0 ? options.maxRounds : maxRoundsFor(n) },
    seats: Array.from({ length: n }, () => ({ hp: START_HP, ki: 0, down: false, dead: false, confirmed: false, lie: 0, blockStreak: 0, hits: [], diedRound: null, tally: { ...EMPTY_TALLY } })),
    round: 1,
    phase: "choosing",
    stage: 0,
    commits: Array(n).fill(null),
    moves: Array(n).fill(null),
    lastMoves: Array(n).fill(null),
    events: [],
    ready: Array(n).fill(false),
    idleStreak: Array(n).fill(0),
  };
}

// ---------------------------------------------------------------------------
// 합법 행동

/** 행동을 제출해야 하는 자리: 사망이 공개된 자리만 빠진다(진짜 죽었어도 공개 전엔 제출한다) */
export function isActing(state: GameState, seat: Seat): boolean {
  const s = state.seats[seat];
  return !!s && !s.confirmed;
}

export function legalMoves(state: GameState, seat: Seat): Move[] {
  const me = state.seats[seat];
  if (!me || me.confirmed) return [];
  const others = state.seats.map((_, i) => i).filter((i) => i !== seat);
  const standing = others.filter((i) => !state.seats[i].down);
  const bodies = others.filter((i) => state.seats[i].down && !state.seats[i].confirmed);
  if (me.down) return [{ kind: "hold" }, { kind: "rise" }, ...standing.map((target) => ({ kind: "ambush" as const, target }))];
  const out: Move[] = [{ kind: "charge" }];
  if (me.blockStreak < MAX_BLOCK_STREAK) out.push({ kind: "block" });
  for (const kind of ["pa", "jangpung", "energy"] as const) {
    if (me.ki >= BLAST_TIER[kind]!) for (const target of standing) out.push({ kind, target });
  }
  for (const target of bodies) {
    out.push({ kind: "loot", target });
    if (me.ki >= FINISH_COST) out.push({ kind: "finish", target });
  }
  return out;
}

export function isLegal(state: GameState, seat: Seat, move: Move): boolean {
  return legalMoves(state, seat).some((m) => m.kind === move.kind && (m.target ?? -1) === (move.target ?? -1));
}

/** 시간 초과/무효 제출의 기본 행동 */
export function defaultMove(state: GameState, seat: Seat): Move {
  return state.seats[seat].down ? { kind: "hold" } : { kind: "charge" };
}

// ---------------------------------------------------------------------------
// 판정

function resolveRound(state: GameState): GameState {
  const n = state.seatCount;
  const moves: Move[] = state.seats.map((s, i) => {
    if (s.confirmed) return { kind: "hold" };
    const m = state.moves[i];
    return m && isLegal(state, i, m) ? m : defaultMove(state, i);
  });
  const seats = state.seats.map((s) => ({ ...s, tally: { ...s.tally } }));
  /** 이번 라운드에 누가 누구를 때렸나 (처치 집계용) */
  const strikers: Seat[][] = state.seats.map(() => []);
  const startDown = seats.map((s) => s.down);
  const events: RoundEvent[] = [];
  const dmg = Array(n).fill(0);
  const newHits: DmgRange[][] = seats.map(() => []);
  // 피해 굴림은 시드+라운드로 결정 — 모든 기기가 같은 값을 얻는다
  const roll = seededRng((state.seed ^ Math.imul(state.round, 2654435761)) >>> 0);
  const surge = surgeAt(state.round);
  const strike = (target: Seat, base: DmgRange, by: Seat): Hit => {
    strikers[target].push(by);
    const range: DmgRange = [base[0] + surge, base[1] + surge];
    const [lo, hi] = range;
    const value = lo + Math.floor(roll() * (hi - lo + 1));
    dmg[target] += value;
    newHits[target].push(range);
    return { lo, hi, dmg: value };
  };
  const rose = Array(n).fill(false);
  const blocking = moves.map((m, i) => !startDown[i] && m.kind === "block");
  // 진짜 죽은 사람(미공개)은 무엇을 골랐든 가만히 누워 있다
  const eff = moves.map((m, i) => (seats[i].dead ? ({ kind: "hold" } as Move) : m));

  // 비용 지불 (공개 정보)
  moves.forEach((m, i) => {
    if (startDown[i]) return;
    const tier = BLAST_TIER[m.kind];
    if (tier) seats[i].ki -= tier;
    if (m.kind === "finish") seats[i].ki -= FINISH_COST;
  });

  // 1) 쓰러진 사람을 둘러싼 일
  for (let k = 0; k < n; k++) {
    if (!startDown[k] || seats[k].confirmed) continue;
    const looters = moves.map((m, i) => (!startDown[i] && m.kind === "loot" && m.target === k ? i : -1)).filter((i) => i >= 0);
    const finishers = moves.map((m, i) => (!startDown[i] && m.kind === "finish" && m.target === k ? i : -1)).filter((i) => i >= 0);
    const fm = eff[k];
    if (seats[k].dead) {
      if (finishers.length) {
        seats[k].confirmed = true;
        for (const f of finishers) events.push({ t: "finish", seat: f, target: k, result: "dead" });
      }
      lootBody(seats, k, looters, events);
      continue;
    }
    if (fm.kind === "ambush" && finishers.includes(fm.target!)) {
      rose[k] = true;
      events.push({ t: "finish", seat: fm.target!, target: k, result: "countered", hit: strike(k, DMG.finish, fm.target!) });
      for (const l of looters) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
      continue;
    }
    if (fm.kind === "ambush" && looters.includes(fm.target!) && finishers.length === 0) {
      rose[k] = true;
      events.push({ t: "ambush", seat: k, target: fm.target!, result: "looter", hit: strike(fm.target!, DMG.ambushLooter, k) });
      seats[k].tally.ambushHits++;
      for (const l of looters) if (l !== fm.target) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
      continue;
    }
    if (finishers.length) {
      // 살아 있었다 — 정체 폭로, 맞고 다시 쓰러진다
      rose[k] = true;
      const hit = strike(k, DMG.finish, finishers[0]);
      for (const f of finishers) seats[f].tally.exposes++;
      finishers.forEach((f, idx) => events.push({ t: "finish", seat: f, target: k, result: "exposed", ...(idx === 0 ? { hit } : {}) }));
      for (const l of looters) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
      continue;
    }
    if (fm.kind === "hold") lootBody(seats, k, looters, events);
    else for (const l of looters) events.push({ t: "loot", seat: l, target: k, took: 0, foiled: true });
    if (fm.kind === "rise") {
      rose[k] = true;
      events.push({ t: "rise", seat: k, reason: "choice" });
    } else if (fm.kind === "ambush") {
      rose[k] = true;
      const t = fm.target!;
      if (blocking[t]) events.push({ t: "ambush", seat: k, target: t, result: "blocked" });
      else {
        events.push({ t: "ambush", seat: k, target: t, result: "hit", hit: strike(t, DMG.ambush, k) });
        seats[k].tally.ambushHits++;
      }
    }
  }

  // 2) 서 있는 사람들의 기술
  const blasts = moves.map((m, i) => (!startDown[i] && BLAST_TIER[m.kind] ? { seat: i, target: m.target!, tier: BLAST_TIER[m.kind]! } : null));
  const cancelled = Array(n).fill(false);
  for (const b of blasts) {
    if (!b || cancelled[b.seat]) continue;
    const back = blasts[b.target];
    if (!back || back.target !== b.seat || cancelled[b.target]) continue;
    if (back.tier === b.tier) {
      cancelled[b.seat] = cancelled[b.target] = true;
      events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "clash" });
    } else {
      const lo = back.tier < b.tier ? back : b;
      cancelled[lo.seat] = true;
      events.push({ t: "blast", seat: lo.seat, target: lo.target, tier: lo.tier, result: "overpowered" });
    }
  }
  for (const b of blasts) {
    if (!b || cancelled[b.seat]) continue;
    if (blocking[b.target] && b.tier >= 3) events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "pierce", hit: strike(b.target, DMG.pierce, b.seat) });
    else if (blocking[b.target]) events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "blocked" });
    else events.push({ t: "blast", seat: b.seat, target: b.target, tier: b.tier, result: "hit", hit: strike(b.target, BLAST_DMG[b.tier], b.seat) });
    if (!blocking[b.target] || b.tier >= 3) seats[b.seat].tally.blastHits++;
  }

  // 3) 기 모으기 / 막기 기록
  moves.forEach((m, i) => {
    if (startDown[i]) return;
    if (m.kind === "charge") {
      seats[i].ki = Math.min(MAX_KI, seats[i].ki + 1);
      events.push({ t: "charge", seat: i });
    }
    seats[i].blockStreak = m.kind === "block" ? seats[i].blockStreak + 1 : 0;
    if (m.kind === "block") events.push({ t: "block", seat: i });
  });

  // 4) 일어나기·숨 참기
  for (let i = 0; i < n; i++) {
    if (rose[i]) {
      seats[i].down = false;
      seats[i].lie = 0;
    } else if (startDown[i] && !seats[i].dead && !seats[i].confirmed) {
      seats[i].lie += 1;
      seats[i].tally.fakeRounds++;
      if (seats[i].lie >= MAX_LIE && dmg[i] === 0) {
        seats[i].down = false;
        seats[i].lie = 0;
        events.push({ t: "rise", seat: i, reason: "breath" });
      }
    } else if (startDown[i] && seats[i].dead) {
      // 진짜 시체도 공개 카운터는 똑같이 오른다
      seats[i].lie += 1;
    }
  }

  // 5) 피해 → 무조건 쓰러짐
  const fallen: Seat[] = [];
  for (let i = 0; i < n; i++) {
    if (dmg[i] <= 0) continue;
    seats[i].hits = [...seats[i].hits, ...newHits[i]];
    seats[i].hp = Math.max(0, seats[i].hp - dmg[i]);
    if (!seats[i].down) fallen.push(i);
    seats[i].down = true;
    seats[i].lie = 0;
    if (seats[i].hp <= 0 && !seats[i].dead) {
      seats[i].dead = true;
      seats[i].diedRound = state.round;
      for (const by of new Set(strikers[i])) if (by !== i) seats[by].tally.kills++;
    }
  }
  if (fallen.length) events.push({ t: "fall", seats: fallen });

  const lastMoves = moves.map((m, i) => (startDown[i] || state.seats[i].confirmed ? null : m));
  const alive = seats.filter((s) => !s.dead).length;
  const ended = alive <= 1 || state.round >= state.options.maxRounds;
  return {
    ...state,
    seats,
    moves: Array(n).fill(null),
    lastMoves,
    events,
    phase: ended ? "ended" : "resolved",
    stage: state.stage + 1,
    ready: seats.map((s) => s.confirmed),
  };
}

function lootBody(seats: SeatState[], k: Seat, looters: Seat[], events: RoundEvent[]) {
  for (const l of looters) {
    const took = Math.min(LOOT_TAKE, seats[k].ki, MAX_KI - seats[l].ki);
    seats[k].ki -= took;
    seats[l].ki += took;
    seats[l].tally.kiLooted += took;
    events.push({ t: "loot", seat: l, target: k, took, foiled: false });
  }
}

function toRevealing(state: GameState): GameState {
  return maybeResolve({ ...state, phase: "revealing", stage: state.stage + 1 });
}

function maybeResolve(state: GameState): GameState {
  // "x" = 커밋 없이 넘어간 자리(사망 공개 / 시간 초과 기본 행동)
  const waiting = state.commits.some((c, i) => c !== null && c !== "x" && state.moves[i] === null);
  return waiting ? state : resolveRound(state);
}

function nextRound(state: GameState): GameState {
  const n = state.seatCount;
  return {
    ...state,
    round: state.round + 1,
    phase: "choosing",
    stage: state.stage + 1,
    commits: state.seats.map((s) => (s.confirmed ? "x" : null)),
    moves: Array(n).fill(null),
    events: [],
    ready: Array(n).fill(false),
  };
}

export function applyAction(state: GameState, action: EngineAction): GameState {
  switch (action.type) {
    case "COMMIT": {
      if (state.phase !== "choosing" || action.round !== state.round) return state;
      if (!isActing(state, action.seat) || state.commits[action.seat] !== null) return state;
      const commits = state.commits.map((c, i) => (i === action.seat ? String(action.hash) : c));
      const idleStreak = state.idleStreak.map((v, i) => (i === action.seat ? 0 : v));
      const next = { ...state, commits, idleStreak };
      return commits.every((c) => c !== null) ? toRevealing(next) : next;
    }
    case "REVEAL": {
      if (state.phase !== "revealing" || action.round !== state.round) return state;
      const hash = state.commits[action.seat];
      if (!hash || hash === "x" || state.moves[action.seat] !== null) return state;
      const ok = moveHash(action.move, action.salt) === hash && isLegal(state, action.seat, action.move);
      const move = ok ? { kind: action.move.kind, ...(action.move.target !== undefined ? { target: action.move.target } : {}) } : defaultMove(state, action.seat);
      const moves = state.moves.map((m, i) => (i === action.seat ? move : m));
      return maybeResolve({ ...state, moves });
    }
    case "READY": {
      if (state.phase !== "resolved" || action.round !== state.round || state.ready[action.seat]) return state;
      const ready = state.ready.map((r, i) => (i === action.seat ? true : r));
      return ready.every(Boolean) ? nextRound({ ...state, ready }) : { ...state, ready };
    }
    case "TIMEOUT": {
      if (action.stage !== state.stage) return state;
      if (state.phase === "choosing") {
        const idleStreak = state.idleStreak.map((v, i) => (state.commits[i] === null ? v + 1 : v));
        const moves = state.moves.map((m, i) => (state.commits[i] === null ? defaultMove(state, i) : m));
        const commits = state.commits.map((c) => c ?? "x");
        return toRevealing({ ...state, idleStreak, moves, commits });
      }
      if (state.phase === "revealing") return resolveRound(state);
      if (state.phase === "resolved") return nextRound(state);
      return state;
    }
  }
  return state;
}

/** 지금 무언가를 기다리는 자리 */
export function pendingSeats(state: GameState): Seat[] {
  const all = state.seats.map((_, i) => i);
  switch (state.phase) {
    case "choosing":
      return all.filter((i) => state.commits[i] === null);
    case "revealing":
      return all.filter((i) => state.commits[i] !== null && state.commits[i] !== "x" && state.moves[i] === null);
    case "resolved":
      return all.filter((i) => !state.ready[i]);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// 공개 정보 / 결과

/** 맞은 타격들의 피해 범위로 본 "합계 < 목숨" 확률 (각 타격은 범위 안에서 균등) */
export function survivalChance(hits: readonly DmgRange[], hp = START_HP): number {
  let dist = new Map<number, number>([[0, 1]]);
  for (const [lo, hi] of hits) {
    const nextDist = new Map<number, number>();
    const w = 1 / (hi - lo + 1);
    for (const [sum, p] of dist) for (let d = lo; d <= hi; d++) nextDist.set(Math.min(hp, sum + d), (nextDist.get(Math.min(hp, sum + d)) ?? 0) + p * w);
    dist = nextDist;
  }
  let alive = 0;
  for (const [sum, p] of dist) if (sum < hp) alive += p;
  return alive;
}

/** 공개 정보만으로 본 "이 자리가 아직 살아 있을 확률" (viewer 자신은 자기 상태를 안다) */
export function aliveChance(state: GameState, seat: Seat, viewer?: Seat): number {
  const s = state.seats[seat];
  if (viewer === seat) return s.dead ? 0 : 1;
  if (s.confirmed) return 0;
  if (!s.down) return 1;
  // 살아 있으면 숨 참기 한도에서 강제로 일어난다 — 그 이상 누워 있으면 시체
  if (s.lie >= MAX_LIE) return 0;
  return survivalChance(s.hits);
}

/** 공개된 최소/최대 누적 피해 */
export function takenRange(s: SeatState): [number, number] {
  return [s.hits.reduce((a, h) => a + h[0], 0), s.hits.reduce((a, h) => a + h[1], 0)];
}

export function aliveCount(state: GameState): number {
  return state.seats.filter((s) => !s.dead).length;
}

export interface Ranking {
  seat: Seat;
  rank: number;
}

/** 생존자 1위(여럿이면 남은 목숨 → 기 순), 사망자는 늦게 죽을수록 위 */
export function computeRankings(state: GameState): Ranking[] {
  const key = (i: Seat) => {
    const s = state.seats[i];
    return s.dead ? -1000 + (s.diedRound ?? 0) : s.hp * 10 + s.ki;
  };
  const order = state.seats.map((_, i) => i).sort((a, b) => key(b) - key(a));
  const out: Ranking[] = [];
  order.forEach((seat, idx) => {
    const prev = out[idx - 1];
    const rank = prev && key(order[idx - 1]) === key(seat) ? prev.rank : idx + 1;
    out.push({ seat, rank });
  });
  return out;
}

export function winnerSeats(state: GameState): Seat[] {
  return computeRankings(state).filter((r) => r.rank === 1).map((r) => r.seat);
}
