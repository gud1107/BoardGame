import { clampBotLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { ROOM_BASE, ROOM_COUNT, cardsOf, reachable } from "./data";
import { bestGuess, deduce, solLikelihood, uncertain, type DeduceOptions, type Knowledge } from "./deduce";
import { fogView, showableCards, type EngineAction, type GameState, type Guess, type Seat } from "./engine";

/**
 * 안개 저택 AI (규칙서 §12). 언제나 자기 좌석의 `fogView`만 보고 판단한다.
 *
 * - 추리: deduce.ts (레벨별로 쓰는 제약이 다르다)
 * - 이동: 갈 수 있는 방마다 "거기서 할 수 있는 가장 좋은 행동"의 값을 매겨 가장 좋은 방으로
 * - 행동: 확신하면 고발, 아니면 수색(단서가 남았으면)과 심문(정보량 최대 조합) 중 값이 큰 쪽
 */

const MISTAKE = [0.45, 0.35, 0.25, 0.16, 0.1, 0.07, 0.05, 0.02, 0, 0];

export function deduceOptionsFor(level: BotLevel): DeduceOptions {
  const lv = clampBotLevel(level);
  if (lv <= 3) return { counts: false, fullCounts: false, handSizes: false, wrongAccusations: false, forget: [0.3, 0.15, 0.05][lv - 1] };
  if (lv <= 5) return { counts: true, fullCounts: lv === 5, handSizes: false, wrongAccusations: false, forget: 0 };
  if (lv <= 7) return { counts: true, fullCounts: true, handSizes: true, wrongAccusations: false, forget: 0 };
  return { counts: true, fullCounts: true, handSizes: true, wrongAccusations: true, forget: 0 };
}

interface AskPick {
  target: Seat;
  suspect: number;
  weapon: number;
  value: number;
}

/** 카드 하나를 target에게 물었을 때의 정보 가치 */
function cardInfo(k: Knowledge, card: number, target: Seat, smart: boolean): number {
  if (!uncertain(k, card)) return 0;
  const could = (k.dom[card] >> target) & 1;
  const solBonus = k.dom[card] & k.sol ? (smart ? 0.6 : 0.3) : 0;
  return could ? 1 + solBonus : smart ? 0.1 : 0.4;
}

function bestAsk(view: GameState, me: Seat, k: Knowledge, room: number, level: number, rng: () => number): AskPick | null {
  const smart = level >= 6;
  const roomCard = ROOM_BASE + room;
  let best: AskPick | null = null;
  for (let t = 0; t < view.seatCount; t++) {
    if (t === me || view.handCount[t] === 0) continue;
    const rc = cardInfo(k, roomCard, t, smart);
    for (const s of cardsOf("suspect")) {
      const sv = cardInfo(k, s, t, smart);
      for (const w of cardsOf("weapon")) {
        const value = sv + cardInfo(k, w, t, smart) + rc + rng() * (smart ? 0.05 : 0.6);
        if (!best || value > best.value) best = { target: t, suspect: s, weapon: w, value };
      }
    }
  }
  return best;
}

/** 이 방에서 수색할 가치 */
function searchValue(view: GameState, room: number, k: Knowledge, level: number): number {
  if (view.deckCount[room] === 0) return 0;
  // 괘종 뒤로 아무도 안 뒤진 방 — 맨 위가 괘종 단서
  let bellFresh = false;
  for (const e of view.log) {
    if (e.kind === "bell" && e.room === room) bellFresh = true;
    if (e.kind === "search" && e.room === room) bellFresh = false;
  }
  if (bellFresh) return level >= 4 ? 3.2 : 1.6;
  // 남은 정답 후보가 적을수록 무작위 알리바이의 가치는 떨어진다
  const unresolved = k.candidates.suspect.length + k.candidates.weapon.length + k.candidates.room.length - 3;
  // 금고에 있을지도 모르는 정답 후보는 심문으로는 못 지운다 — 수색만이 답
  const vaultish = level >= 4 && k.vault ? [...k.candidates.suspect, ...k.candidates.weapon, ...k.candidates.room].filter((c) => k.dom[c] & k.vault).length : 0;
  return 0.6 + Math.min(1.2, unresolved * 0.1) + Math.min(1.5, vaultish * 0.35);
}

function roomValue(view: GameState, me: Seat, k: Knowledge, room: number, level: number, rng: () => number): number {
  const ask = bestAsk(view, me, k, room, level, rng)?.value ?? 0;
  return Math.max(ask, searchValue(view, room, k, level));
}

function shouldAccuse(view: GameState, k: Knowledge, level: number, rng: () => number): boolean {
  if (k.combos === 1) return true;
  const lastRound = view.round >= view.maxRounds;
  if (level <= 3) {
    const limit = level === 1 ? 4 : 2;
    return k.combos <= limit && rng() < (level === 3 ? 0.25 : 0.45);
  }
  if (level >= 8 && lastRound && k.combos <= 2) return true;
  if (level >= 6 && lastRound && k.combos === 2) return rng() < 0.5;
  return false;
}

function pickShow(view: GameState, me: Seat, level: number, rng: () => number): number {
  const options = showableCards(view);
  if (options.length <= 1 || level <= 2) return options[Math.floor(rng() * options.length)] ?? options[0];
  const asker = view.pending!.asker;
  const shownToAsker = new Set<number>();
  const shownToAnyone = new Set<number>();
  for (const e of view.log) {
    if (e.kind === "ask" && e.target === me && e.shown !== null && e.shown >= 0) {
      shownToAnyone.add(e.shown);
      if (e.seat === asker) shownToAsker.add(e.shown);
    }
  }
  const again = options.find((c) => shownToAsker.has(c));
  if (again !== undefined) return again;
  if (level >= 7) {
    const used = options.find((c) => shownToAnyone.has(c));
    if (used !== undefined) return used;
  }
  return options[Math.floor(rng() * options.length)];
}

function finalGuess(k: Knowledge, level: number, rng: () => number): Guess | null {
  if (level <= 3) return bestGuess(k, rng);
  return k.combos <= 3 ? bestGuess(k, rng) : null;
}

/** 이 좌석이 지금 할 일이 있나 */
export function botHasWork(full: GameState, seat: Seat): boolean {
  if (full.phase === "turn") return full.turn === seat;
  if (full.phase === "respond") return full.pending?.target === seat;
  if (full.phase === "dawn") return !full.finalIn[seat];
  return false;
}

export function chooseBotAction(full: GameState, seat: Seat, levelIn: BotLevel, rng: () => number = Math.random): EngineAction | null {
  if (!botHasWork(full, seat)) return null;
  const level = clampBotLevel(levelIn);
  const view = full.viewer === seat ? full : fogView(full, seat);
  const stage = view.stage;

  if (view.phase === "respond") return { type: "SHOW", seat, stage, card: pickShow(view, seat, level, rng) };

  const k = deduce(view, seat, deduceOptionsFor(level));
  if (view.phase === "dawn") return { type: "FINAL", seat, stage, guess: finalGuess(k, level, rng) };

  if (shouldAccuse(view, k, level, rng)) return { type: "ACCUSE", seat, stage, guess: k.solved ?? bestGuess(k, rng) };

  const mistake = rng() < MISTAKE[level - 1];
  const here = view.pos[seat];

  if (!view.moved) {
    const options = [...reachable(here).keys()];
    let dest = here;
    if (mistake) {
      dest = rng() < 0.5 ? here : options[Math.floor(rng() * options.length)];
    } else {
      let bestV = roomValue(view, seat, k, here, level, rng) + 0.05;
      for (const r of options) {
        // 정답일 수도 있는 방 카드는 그 방에서만 물을 수 있다 — 높은 레벨일수록 그쪽으로
        const v = roomValue(view, seat, k, r, level, rng) + (level >= 6 ? solLikelihood(k, ROOM_BASE + r) * 0.3 : 0);
        if (v > bestV) {
          bestV = v;
          dest = r;
        }
      }
    }
    if (dest !== here && dest >= 0 && dest < ROOM_COUNT) return { type: "MOVE", seat, stage, room: dest };
  }

  const ask = bestAsk(view, seat, k, here, mistake ? 1 : level, rng);
  const search = searchValue(view, here, k, level);
  if (search > 0 && (search >= (ask?.value ?? 0) || (mistake && rng() < 0.5))) return { type: "SEARCH", seat, stage };
  if (ask) return { type: "ASK", seat, stage, target: ask.target, suspect: ask.suspect, weapon: ask.weapon };
  return { type: "PASS", seat, stage };
}
