import { clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { ROOM_COUNT, TICKS } from "./data";
import { caseLog, cctvView, checkedCell, contradictionsOf, footageCount, pendingSeats, type EngineAction, type GameState, type LogEntry, type Seat } from "./engine";
import { claimPossible, deduce, mismatchChance, type DeduceOptions, type Knowledge } from "./deduce";
import { culpritAutoPlan, guestAutoRoute, type Plan } from "./planner";

/**
 * CCTV 알리바이 AI (규칙서 §10). 언제나 자기 좌석의 `cctvView`만 보고 판단한다.
 *
 * 손님: 목격했으면 증언 → 그 뒤엔 어긋날 확률이 가장 높은 칸을 센서로 대조 → 가장 의심스러운 사람에게 투표.
 * 범인: 조작 구간은 짧게, 대조는 아무것도 안 드러나는 칸에, 지목당하면 맞증언, 표는 남들이 가장 의심하는 사람에게.
 */

const MISTAKE = [0.5, 0.4, 0.3, 0.22, 0.15, 0.1, 0.06, 0.03, 0.01, 0];

export function deduceOptionsFor(level: BotLevel): DeduceOptions {
  const lv = clampBotLevel(level);
  if (lv <= 1) return { opportunity: false, checks: false, pair: false, sight: false, claims: false };
  if (lv <= 2) return { opportunity: false, checks: true, pair: true, sight: false, claims: false };
  if (lv <= 4) return { opportunity: true, checks: true, pair: true, sight: false, claims: false };
  if (lv <= 6) return { opportunity: true, checks: true, pair: true, sight: true, claims: false };
  return { opportunity: true, checks: true, pair: true, sight: true, claims: true };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function argmax(values: number[], allowed: (s: number) => boolean, rng: () => number): number {
  let best = -1;
  let bestV = -Infinity;
  for (let s = 0; s < values.length; s++) {
    if (!allowed(s)) continue;
    const v = values[s] + rng() * 1e-6;
    if (v > bestV) {
      bestV = v;
      best = s;
    }
  }
  return best;
}

/** 범인의 밤 계획 */
export function botCulpritPlan(start: number, level: number, rng: () => number): Plan {
  if (level <= 3) return culpritAutoPlan(start, rng, 0.2);
  if (level <= 6) return culpritAutoPlan(start, rng, 0.7);
  // 여러 번 짜 보고 조작 구간이 가장 짧은 계획을 고른다
  let best = culpritAutoPlan(start, rng, 1);
  for (let i = 0; i < 7; i++) {
    const p = culpritAutoPlan(start, rng, 1);
    if ((p.forge?.rooms.length ?? 9) < (best.forge?.rooms.length ?? 9)) best = p;
  }
  return best;
}

interface Cell {
  t: number;
  room: number;
}

function openCells(view: GameState, occupiedOnly: boolean): Cell[] {
  const out: Cell[] = [];
  for (let t = 1; t <= TICKS; t++) {
    for (let room = 0; room < ROOM_COUNT; room++) {
      if (checkedCell(view, t, room)) continue;
      if (occupiedOnly && footageCount(view, t, room) === 0) continue;
      out.push({ t, room });
    }
  }
  return out;
}

function bestCheck(view: GameState, k: Knowledge, rng: () => number, want: "max" | "min", skip?: (c: Cell) => boolean): { cell: Cell; value: number } | null {
  let best: { cell: Cell; value: number } | null = null;
  for (const cell of openCells(view, want === "min")) {
    if (skip?.(cell)) continue;
    const occ = footageCount(view, cell.t, cell.room);
    // 찍힌 사람이 적은 칸일수록 어긋났을 때 범인이 좁혀진다
    const value = mismatchChance(k, cell.t, cell.room) * (1 + 0.4 / Math.max(1, occ)) + rng() * 1e-4;
    if (!best || (want === "max" ? value > best.value : value < best.value)) best = { cell, value };
  }
  return best;
}

type Claim = Extract<LogEntry, { kind: "testify" }>;

function guestTurn(view: GameState, seat: Seat, level: number, rng: () => number): EngineAction {
  const stage = view.stage;
  const seen = contradictionsOf(view, seat);
  if (seen.length > 0 && !view.testified[seat] && (level >= 2 || rng() < 0.6)) {
    const c = pick(seen, rng);
    return { type: "TESTIFY", seat, stage, target: c.target, t: c.t };
  }
  const k = deduce(view, seat, deduceOptionsFor(level as BotLevel));
  const mistake = rng() < MISTAKE[level - 1];
  if (mistake || level <= 2) {
    const cells = openCells(view, true);
    if (cells.length === 0) return { type: "PASS", seat, stage };
    const c = pick(cells, rng);
    return { type: "CHECK", seat, stage, t: c.t, room: c.room };
  }
  const best = bestCheck(view, k, rng, "max");
  if (!best || best.value < 1e-3) return { type: "PASS", seat, stage };
  return { type: "CHECK", seat, stage, t: best.cell.t, room: best.cell.room };
}

/** 범인이 target에게 뒤집어씌울 수 있는(영상과 모순되지 않는) 증언 시각 */
function frameTick(view: GameState, me: Seat, target: Seat, prefer: number | null, rng: () => number): number | null {
  const ok: number[] = [];
  for (let t = 1; t <= TICKS; t++) {
    const room = view.footage[me][t];
    const together = view.footage[target][t] === room;
    // 영상에서 같이 있으면 "없었다", 아니면 "여기 있었다"고 말하게 된다
    if (claimPossible(view, target, t, room, !together)) ok.push(t);
  }
  if (ok.length === 0) return null;
  return prefer !== null && ok.includes(prefer) ? prefer : pick(ok, rng);
}

function culpritTurn(view: GameState, seat: Seat, level: number, rng: () => number): EngineAction {
  const stage = view.stage;
  const opts = deduceOptionsFor(level as BotLevel);
  const pub = deduce(view, -1, opts);
  const accusers = (caseLog(view).filter((e) => e.kind === "testify") as Claim[]).filter((c) => c.target === seat);

  if (!view.testified[seat]) {
    if (accusers.length > 0 && level >= 3) {
      // 맞증언: 나를 지목한 사람을 같은 장면으로 되받는다
      const a = accusers[0];
      const t = frameTick(view, seat, a.seat, a.t, rng);
      if (t !== null) return { type: "TESTIFY", seat, stage, target: a.seat, t };
    } else if (level <= 2 && rng() < 0.2) {
      // 서툰 범인은 괜히 거짓말을 해서 용의자를 둘로 좁혀 버린다
      const target = pick(
        Array.from({ length: view.seatCount }, (_, s) => s).filter((s) => s !== seat),
        rng,
      );
      return { type: "TESTIFY", seat, stage, target, t: 1 + Math.floor(rng() * TICKS) };
    } else if (level >= 6 && pub.prob[seat] > 0.5) {
      // 이미 나에게 의심이 몰렸다 — 두 번째로 의심받는 사람에게 뒤집어씌운다
      const target = argmax(pub.prob, (s) => s !== seat && pub.prob[s] > 0, rng);
      const t = target >= 0 ? frameTick(view, seat, target, null, rng) : null;
      if (t !== null) return { type: "TESTIFY", seat, stage, target, t };
    }
  }

  const mine = view.truth[seat];
  const fake = view.footage[seat];
  const exposes = (c: Cell) => fake[c.t] !== mine[c.t] && (c.room === fake[c.t] || c.room === mine[c.t]);
  if (level <= 2) {
    const cells = openCells(view, true).filter((c) => rng() < 0.5 || !exposes(c));
    if (cells.length === 0) return { type: "PASS", seat, stage };
    const c = pick(cells, rng);
    return { type: "CHECK", seat, stage, t: c.t, room: c.room };
  }
  if (level <= 5) {
    const cells = openCells(view, true).filter((c) => !exposes(c));
    if (cells.length === 0) return { type: "PASS", seat, stage };
    const c = pick(cells, rng);
    return { type: "CHECK", seat, stage, t: c.t, room: c.room };
  }
  // 수사하는 척하되 아무도 풀려나지 않는(어긋날 가능성이 가장 낮아 보이는) 칸을 고른다
  const best = bestCheck(view, pub, rng, "min", exposes);
  if (!best) return { type: "PASS", seat, stage };
  return { type: "CHECK", seat, stage, t: best.cell.t, room: best.cell.room };
}

function voteTarget(view: GameState, seat: Seat, level: number, rng: () => number): Seat | null {
  const others = Array.from({ length: view.seatCount }, (_, s) => s).filter((s) => s !== seat);
  const opts = deduceOptionsFor(level as BotLevel);
  if (view.culprit === seat) {
    const accuser = (caseLog(view).filter((e) => e.kind === "testify") as Claim[]).find((c) => c.target === seat);
    if (accuser) return accuser.seat;
    const pub = deduce(view, -1, opts);
    const t = argmax(pub.prob, (s) => s !== seat && pub.prob[s] > 0, rng);
    return t >= 0 ? t : pick(others, rng);
  }
  const k = deduce(view, seat, opts);
  if (k.certain !== null) return k.certain;
  const alive = others.filter((s) => k.weight[s] > 0);
  if (alive.length === 0) return pick(others, rng);
  if (level <= 2 || rng() < MISTAKE[level - 1]) return pick(alive, rng);
  return argmax(k.prob, (s) => s !== seat, rng);
}

/** 이 좌석이 지금 할 일이 있나 */
export function botHasWork(full: GameState, seat: Seat): boolean {
  return full.phase !== "ended" && pendingSeats(full).includes(seat);
}

export function chooseBotAction(full: GameState, seat: Seat, levelIn: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (!botHasWork(full, seat)) return null;
  const level = clampBotLevel(levelIn);
  const view = full.viewer === seat ? full : cctvView(full, seat);
  const stage = view.stage;
  switch (view.phase) {
    case "night": {
      const start = view.starts[seat];
      if (view.culprit === seat) return { type: "PLAN", seat, stage, plan: botCulpritPlan(start, level, rng) };
      return { type: "PLAN", seat, stage, plan: { route: guestAutoRoute(start, view.errands[seat] ?? [], rng), forge: null } };
    }
    case "watch":
    case "result":
      return { type: "READY", seat, stage };
    case "investigate":
      return view.culprit === seat ? culpritTurn(view, seat, level, rng) : guestTurn(view, seat, level, rng);
    case "vote":
      return { type: "VOTE", seat, stage, target: voteTarget(view, seat, level, rng) };
  }
  return null;
}
