import { pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { BASE, DIST, NEIGHBORS, SPOTS, spot, type RoomId } from "./house";
import { ITCH_AT, legalMoves, SCORE_HOME, SCORE_SURVIVE, type GameState, type Move, type Seat } from "./engine";

/**
 * 한밤의 숨바꼭질 봇 — 공개 정보(이번 라운드 기록 `history`, 술래 편 위치, 남은 인원)와
 * 자기 자리만 본다. 다른 숨은 사람의 spot/room은 절대 읽지 않는다(ARCHITECTURE.md §7.1).
 *
 * 술래 편은 `belief`(숨을 곳마다 "여기 숨어 있을 기대 인원")를 기록에서 다시 계산해 가장 그럴듯한
 * 곳을 뒤진다. 숨은 사람은 같은 belief로 "술래가 나를 의심하는 정도"를 재고 위험을 피한다.
 * 레벨별 실수/오차는 공용 `pickByLevel`이 맡는다.
 */

const SPOT_IDS = SPOTS.map((s) => s.id);
const SPOT_INDEX = new Map(SPOT_IDS.map((id, i) => [id, i]));
const SPOTS_OF: Record<RoomId, number[]> = (() => {
  const out = {} as Record<RoomId, number[]>;
  SPOTS.forEach((s, i) => (out[s.room] ??= []).push(i));
  for (const r of Object.keys(DIST) as RoomId[]) out[r] ??= [];
  return out;
})();

function roomMass(b: Float64Array, r: RoomId): number {
  let m = 0;
  for (const i of SPOTS_OF[r]) m += b[i];
  return m;
}

function scaleRoom(b: Float64Array, r: RoomId, to: number) {
  const m = roomMass(b, r);
  const ids = SPOTS_OF[r];
  if (ids.length === 0) return;
  if (m <= 1e-9) for (const i of ids) b[i] = to / ids.length;
  else for (const i of ids) b[i] *= to / m;
}

function takeFromRoom(b: Float64Array, r: RoomId, amount: number) {
  const m = roomMass(b, r);
  if (m <= 1e-9) return;
  const k = Math.max(0, m - amount) / m;
  for (const i of SPOTS_OF[r]) b[i] *= k;
}

function normalize(b: Float64Array, total: number, excludeRoom?: RoomId, fixed?: number) {
  // 고정한 방(손전등·인기척)은 그대로 두고 나머지를 맞춘다
  let rest = 0;
  for (let i = 0; i < b.length; i++) if (SPOTS[i].room !== excludeRoom) rest += b[i];
  const want = Math.max(0, total - (fixed ?? 0));
  if (rest <= 1e-9) {
    const free = SPOTS.map((s, i) => i).filter((i) => SPOTS[i].room !== excludeRoom);
    for (const i of free) b[i] = want / Math.max(1, free.length);
    return;
  }
  for (let i = 0; i < b.length; i++) if (SPOTS[i].room !== excludeRoom) b[i] *= want / rest;
}

/** 이번 라운드의 공개 기록만으로 계산한 "숨을 곳마다 기대 인원" */
export function belief(state: GameState): Float64Array {
  const b = new Float64Array(SPOTS.length);
  let hiders = state.seats.filter((_, i) => i !== state.seeker).length;
  // 처음엔 마당에서 멀수록 조금 더 숨어 있을 법하다
  let w = 0;
  SPOTS.forEach((s, i) => {
    b[i] = 1 + 0.2 * DIST[BASE][s.room];
    w += b[i];
  });
  for (let i = 0; i < b.length; i++) b[i] *= hiders / w;

  for (const turn of state.history) {
    const hunterEnd = new Set<RoomId>();
    let fixedRoom: RoomId | undefined;
    let fixedMass = 0;
    for (const e of turn.events) if (e.t === "move") hunterEnd.add(e.to);
    for (const e of turn.events) {
      switch (e.t) {
        case "home":
        case "blocked":
          takeFromRoom(b, e.from, 1);
          hiders--;
          break;
        case "noise": {
          const m = Math.min(e.count, roomMass(b, e.room));
          takeFromRoom(b, e.room, m);
          const dests = SPOTS.map((_, i) => i).filter((i) => {
            const r = SPOTS[i].room;
            return DIST[e.room][r] <= 1 && r !== BASE && !hunterEnd.has(r);
          });
          for (const i of dests) b[i] += e.count / Math.max(1, dests.length);
          break;
        }
        case "bump":
          hiders--;
          break;
        case "rustle":
          scaleRoom(b, e.room, Math.max(e.count, roomMass(b, e.room)));
          break;
        case "search": {
          hiders -= e.found.length;
          b[SPOT_INDEX.get(e.spot)!] = 0;
          break;
        }
        case "flash":
          scaleRoom(b, e.room, e.count);
          fixedRoom = e.room;
          fixedMass = e.count;
          break;
        case "sense": {
          const m = roomMass(b, e.room);
          const to = e.present ? Math.max(1, m) : 0;
          scaleRoom(b, e.room, to);
          if (fixedRoom === undefined) {
            fixedRoom = e.room;
            fixedMass = to;
          }
          break;
        }
      }
    }
    // 이번 턴에 뒤진 곳은 비어 있었다(또는 잡혀서 빠졌다)
    for (const e of turn.events) if (e.t === "search") b[SPOT_INDEX.get(e.spot)!] = 0;
    hiders = Math.max(0, hiders);
    if (fixedRoom !== undefined) normalize(b, hiders, fixedRoom, Math.min(hiders, fixedMass));
    else normalize(b, hiders);
  }
  return b;
}

/** 이 방에서 다음 턴에 뒤질 수 있는 곳 중 가장 그럴듯한 곳의 기대 인원과 합 */
function reachValue(b: Float64Array, r: RoomId): { max: number; sum: number } {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < SPOTS.length; i++) {
    if (DIST[r][SPOTS[i].room] > 1) continue;
    max = Math.max(max, b[i]);
    sum += b[i];
  }
  return { max, sum };
}

function nearBaseMass(b: Float64Array): number {
  return NEIGHBORS[BASE].reduce((a, r) => a + roomMass(b, r), 0);
}

export function scoreHunterMove(state: GameState, seat: Seat, m: Move, b: Float64Array): number {
  const me = state.seats[seat];
  const turnsLeft = state.seekTurns - state.turn;
  const helper = seat !== state.seeker;
  switch (m.kind) {
    case "search": {
      const i = SPOT_INDEX.get(m.spot!)!;
      const r = spot(m.spot!)!.room;
      const after = reachValue(b, r);
      const hit = Math.min(1, b[i]);
      return hit * 3 + (turnsLeft > 1 ? 0.35 * (after.max - b[i] * 0.5) : 0) + (!helper && NEIGHBORS[BASE].includes(r) ? 0.15 * roomMass(b, r) : 0);
    }
    case "move": {
      const r = m.room!;
      const after = reachValue(b, r);
      let v = turnsLeft > 1 ? 0.55 * after.max + 0.05 * after.sum : 0;
      if (!helper && r === BASE) v += 0.35 * nearBaseMass(b) * (turnsLeft <= 2 ? 1.6 : 0.8);
      if (!helper && NEIGHBORS[BASE].includes(r)) v += 0.2 * roomMass(b, r);
      return v - (r === me.room ? 0.1 : 0);
    }
    case "flash": {
      if (turnsLeft <= 1) return -1;
      const p = 1 - Math.exp(-roomMass(b, m.room!));
      const stay = reachValue(b, me.room);
      return 1.4 * p * (1 - p) + 0.35 * stay.max + 0.1;
    }
    default:
      return 0;
  }
}

/** 술래가 이번 턴에 각 방에서 멈출 대략의 확률 (공개 정보로 추정) */
function seekerEndOdds(state: GameState, b: Float64Array): Map<RoomId, number> {
  const from = state.seats[state.seeker].room;
  const odds = new Map<RoomId, number>();
  let total = 0;
  for (const r of Object.keys(DIST[from]) as RoomId[]) {
    const d = DIST[from][r];
    if (d > 2) continue;
    let w = r === BASE ? 0.3 + 0.4 * nearBaseMass(b) : 0.15 + (d <= 1 ? roomMass(b, r) * 1.2 : reachValue(b, r).max * 0.6);
    if (r === from) w += 0.2;
    odds.set(r, w);
    total += w;
  }
  for (const [r, w] of odds) odds.set(r, w / total);
  return odds;
}

/** 술래 편이 이번 턴에 이 숨을 곳을 뒤질 대략의 확률 */
function searchOdds(state: GameState, b: Float64Array, spotIdx: number): number {
  let miss = 1;
  state.seats.forEach((s, h) => {
    if (s.status !== "seeker" && s.status !== "caught") return;
    let sum = 0;
    for (let i = 0; i < SPOTS.length; i++) if (DIST[s.room][SPOTS[i].room] <= 1) sum += b[i] + 0.05;
    if (DIST[s.room][SPOTS[spotIdx].room] > 1 || sum <= 0) return;
    const p = Math.min(0.95, ((b[spotIdx] + 0.05) / sum) * (h === state.seeker ? 0.9 : 0.6));
    miss *= 1 - p;
  });
  return 1 - miss;
}

export function scoreHiderMove(state: GameState, seat: Seat, m: Move, b: Float64Array): number {
  const me = state.seats[seat];
  const turnsLeft = state.seekTurns - state.turn;
  const ends = seekerEndOdds(state, b);
  const helperRooms = new Set(state.seats.filter((s) => s.status === "caught").map((s) => s.room));
  const future = (idx: number) => SCORE_SURVIVE * Math.max(0.1, 1 - Math.min(0.9, b[idx] * 0.18 * turnsLeft));
  switch (m.kind) {
    case "stay": {
      const i = SPOT_INDEX.get(me.spot!)!;
      // 다리가 저리면 내 방이 드러난다
      const itch = me.still + 1 >= ITCH_AT ? 0.35 : 0;
      return (1 - searchOdds(state, b, i)) * future(i) * (1 - itch);
    }
    case "sneak": {
      const sp = spot(m.spot!)!;
      const i = SPOT_INDEX.get(sp.id)!;
      const bump = (ends.get(sp.room) ?? 0) + (helperRooms.has(sp.room) ? 0.5 : 0);
      const risk = Math.min(1, bump + searchOdds(state, b, i) * 0.7);
      // 떠난 방엔 소리가 나서 다음 의심이 옮겨온다
      const heat = b[i] + 0.3;
      return (1 - risk) * SCORE_SURVIVE * Math.max(0.1, 1 - Math.min(0.9, heat * 0.18 * turnsLeft)) - 0.05;
    }
    case "home": {
      const risk = Math.min(1, (ends.get(BASE) ?? 0) + (ends.get(me.room) ?? 0));
      return (1 - risk) * SCORE_HOME;
    }
    default:
      return 0;
  }
}

/** 숨기 단계: 마당에서 멀고 덜 붐빌 법한 곳 — 레벨이 높을수록 덜 뻔한 곳을 고른다 */
function scoreHide(m: Move, level: BotLevel, rng: () => number): number {
  const sp = spot(m.spot!)!;
  const d = DIST[BASE][sp.room];
  // 너무 멀면 찜하러 나오기 어렵고, 너무 가까우면 금방 들킨다
  const shape = level >= 6 ? 1 - Math.abs(d - 2.2) * 0.25 : 0.4 + d * 0.15;
  return shape + rng() * 0.9;
}

export function chooseBotMove(state: GameState, seat: Seat, level: BotLevel, rng: () => number = Math.random): Move | null {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return null;
  if (state.step === "hide") return pickByLevel(moves.map((move) => ({ move, score: scoreHide(move, level, rng) })), level, rng);
  const b = belief(state);
  const hunter = state.seats[seat].status !== "hiding";
  const scored = moves.map((move) => ({ move, score: (hunter ? scoreHunterMove(state, seat, move, b) : scoreHiderMove(state, seat, move, b)) + rng() * 0.12 }));
  return pickByLevel(scored, level, rng);
}
