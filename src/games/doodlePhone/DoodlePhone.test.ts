import { describe, expect, it } from "vitest";
import { seededRng, shuffle } from "@/lib/rng";
import { chooseBotAction, getValidMoves, guessFromDrawing, botDrawingFor, nextBotActor } from "./bot";
import { EMPTY_DRAWING, MAX_DRAWING_CHARS, decodePoints, encodePoints, isValidDrawing, strokeOp, type Drawing } from "./drawing";
import {
  MAX_REACTIONS_PER_PAGE,
  albumFor,
  applyAction,
  computeRankings,
  consecutiveTimeouts,
  currentTurn,
  fallbackPrompt,
  gamePhase,
  mergeStates,
  pageAt,
  pendingSeats,
  promptFor,
  receiverOf,
  startGame,
  turnKind,
  type DoodlePhoneState,
  type EngineAction,
} from "./engine";
import { FALLBACK_PROMPTS } from "./prompts";
import { ChunkAssembler, splitIntoChunks } from "./syncChunks";

const doodle = (seat: number): Drawing => ({ v: 1, ops: [strokeOp(1, 1, [{ x: 10 + seat, y: 10 }, { x: 100, y: 120 }])] });

/** The action a well-behaved human in `seat` would send for `turn`. */
function humanSubmit(seat: number, turn: number): EngineAction {
  return turnKind(turn) === "text"
    ? { type: "SUBMIT_TEXT", seat, turn, text: `좌석${seat} 턴${turn}` }
    : { type: "SUBMIT_DRAWING", seat, turn, drawing: doodle(seat) };
}

function playAllTurns(state: DoodlePhoneState): DoodlePhoneState {
  let s = state;
  for (let turn = 1; turn <= s.playerCount; turn++) {
    for (let seat = 0; seat < s.playerCount; seat++) s = applyAction(s, humanSubmit(seat, turn));
  }
  return s;
}

function revealEverything(state: DoodlePhoneState): DoodlePhoneState {
  let s = state;
  while (gamePhase(s) === "showcase") s = applyAction(s, { type: "SHOWCASE_NEXT", from: s.showcase });
  return s;
}

describe("routing (rulebook §3)", () => {
  it("receiverOf is the inverse of albumFor", () => {
    for (const n of [4, 7, 14]) {
      for (let seat = 0; seat < n; seat++) {
        for (let turn = 1; turn <= n; turn++) expect(receiverOf(n, albumFor(n, seat, turn), turn)).toBe(seat);
      }
    }
  });

  it("every seat works on every album exactly once, starting with its own", () => {
    const n = 6;
    for (let seat = 0; seat < n; seat++) {
      const albums = Array.from({ length: n }, (_, i) => albumFor(n, seat, i + 1));
      expect(albums[0]).toBe(seat);
      expect(new Set(albums).size).toBe(n);
    }
  });

  it("alternates text and drawing turns, starting with text", () => {
    expect([1, 2, 3, 4, 5].map(turnKind)).toEqual(["text", "drawing", "text", "drawing", "text"]);
  });
});

describe("turn flow", () => {
  it("advances once every seat submits, and runs exactly N turns", () => {
    let s = startGame(4, 1);
    expect(currentTurn(s)).toBe(1);
    for (let seat = 0; seat < 3; seat++) s = applyAction(s, humanSubmit(seat, 1));
    expect(currentTurn(s)).toBe(1);
    expect(pendingSeats(s)).toEqual([3]);
    s = applyAction(s, humanSubmit(3, 1));
    expect(currentTurn(s)).toBe(2);
    s = playAllTurns(s);
    expect(currentTurn(s)).toBe(5);
    expect(gamePhase(s)).toBe("showcase");
  });

  it("builds each album from consecutive seats", () => {
    const s = playAllTurns(startGame(5, 2));
    for (let album = 0; album < 5; album++) {
      for (let turn = 1; turn <= 5; turn++) expect(pageAt(s, album, turn)?.author).toBe(receiverOf(5, album, turn));
    }
  });

  it("shows only the previous page of the held album", () => {
    let s = startGame(4, 3);
    for (let seat = 0; seat < 4; seat++) s = applyAction(s, humanSubmit(seat, 1));
    expect(promptFor(s, 0, 1)).toBeNull();
    // Turn 2: seat 1 holds album 0, whose turn-1 page seat 0 wrote.
    const prompt = promptFor(s, 1, 2);
    expect(prompt?.kind).toBe("text");
    expect(prompt?.kind === "text" && prompt.text).toBe("좌석0 턴1");
  });

  it("rejects wrong page kinds, invalid text and double submissions", () => {
    const s = startGame(4, 4);
    expect(applyAction(s, { type: "SUBMIT_DRAWING", seat: 0, turn: 1, drawing: doodle(0) })).toBe(s);
    expect(applyAction(s, { type: "SUBMIT_TEXT", seat: 0, turn: 1, text: " 가 " })).toBe(s);
    expect(applyAction(s, { type: "SUBMIT_TEXT", seat: 0, turn: 1, text: "가".repeat(36) })).toBe(s);
    const once = applyAction(s, { type: "SUBMIT_TEXT", seat: 0, turn: 1, text: "  우주   고양이 " });
    expect(pageAt(once, 0, 1)).toMatchObject({ kind: "text", text: "우주 고양이", auto: false });
    expect(applyAction(once, { type: "SUBMIT_TEXT", seat: 0, turn: 1, text: "다른 답" })).toBe(once);
  });

  it("rejects malformed and oversized drawings", () => {
    const s = startGame(4, 5);
    const bad = { v: 1, ops: [{ k: "s", c: 99, w: 0, p: [1, 2] }] } as unknown as Drawing;
    const huge: Drawing = { v: 1, ops: Array.from({ length: 4000 }, () => strokeOp(1, 1, [{ x: 100, y: 100 }, { x: 300, y: 300 }])) };
    expect(isValidDrawing(bad)).toBe(false);
    expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_DRAWING_CHARS);
    expect(isValidDrawing(huge)).toBe(false);
    const afterTurn1 = [0, 1, 2, 3].reduce((acc, seat) => applyAction(acc, humanSubmit(seat, 1)), s);
    expect(applyAction(afterTurn1, { type: "SUBMIT_DRAWING", seat: 0, turn: 2, drawing: bad })).toBe(afterTurn1);
  });
});

describe("timeouts (rulebook §5)", () => {
  it("fills missing seats with deterministic fallback and closes the turn", () => {
    let s = startGame(4, 6);
    s = applyAction(s, humanSubmit(0, 1));
    s = applyAction(s, { type: "TIMEOUT", turn: 1, seats: [1, 2, 3] });
    expect(currentTurn(s)).toBe(2);
    const page = pageAt(s, 2, 1);
    expect(page).toMatchObject({ kind: "text", auto: true, text: fallbackPrompt(6, 2, 1) });
    expect(FALLBACK_PROMPTS).toContain(fallbackPrompt(6, 2, 1));
  });

  it("uses a blank canvas for a timed-out drawing turn", () => {
    let s = startGame(4, 7);
    for (let seat = 0; seat < 4; seat++) s = applyAction(s, humanSubmit(seat, 1));
    s = applyAction(s, { type: "TIMEOUT", turn: 2, seats: [0, 1, 2, 3] });
    expect(pageAt(s, 3, 2)).toMatchObject({ kind: "drawing", auto: true, drawing: EMPTY_DRAWING });
  });

  it("locks timed-out slots so a late submission loses on every device", () => {
    const start = startGame(4, 8);
    const late = humanSubmit(2, 1);
    const timeout: EngineAction = { type: "TIMEOUT", turn: 1, seats: [2] };
    const a = applyAction(applyAction(start, late), timeout);
    const b = applyAction(applyAction(start, timeout), late);
    expect(a).toEqual(b);
    expect(pageAt(a, 2, 1)?.auto).toBe(true);
  });

  it("counts consecutive timeouts per seat", () => {
    let s = startGame(4, 9);
    s = applyAction(s, { type: "TIMEOUT", turn: 1, seats: [0, 1, 2, 3] });
    s = applyAction(s, { type: "TIMEOUT", turn: 2, seats: [1] });
    for (const seat of [0, 2, 3]) s = applyAction(s, humanSubmit(seat, 3));
    s = applyAction(s, { type: "TIMEOUT", turn: 3, seats: [1] });
    expect(consecutiveTimeouts(s, 1)).toBe(3);
    expect(consecutiveTimeouts(s, 0)).toBe(0);
  });
});

describe("order independence (the lockstep guarantee this engine is built on)", () => {
  it("any delivery order of the same actions yields the same state", () => {
    const n = 5;
    const actions: EngineAction[] = [];
    for (let turn = 1; turn <= n; turn++) {
      for (let seat = 0; seat < n; seat++) if (!(turn === 2 && seat === 3)) actions.push(humanSubmit(seat, turn));
    }
    actions.push({ type: "TIMEOUT", turn: 2, seats: [3, 4] });
    actions.push(humanSubmit(3, 2)); // arrives after the host gave up on seat 3
    const reference = actions.reduce(applyAction, startGame(n, 10));
    for (let trial = 0; trial < 25; trial++) {
      const shuffled = shuffle(actions, seededRng(trial + 1));
      expect(shuffled.reduce(applyAction, startGame(n, 10))).toEqual(reference);
    }
    expect(gamePhase(reference)).toBe("showcase");
  });

  it("mergeStates unions two partial views into the full one", () => {
    const n = 4;
    const all: EngineAction[] = [];
    for (let turn = 1; turn <= 2; turn++) for (let seat = 0; seat < n; seat++) all.push(humanSubmit(seat, turn));
    all.push({ type: "TIMEOUT", turn: 3, seats: [0, 1, 2, 3] });
    const full = all.reduce(applyAction, startGame(n, 11));
    const left = all.filter((_, i) => i % 2 === 0).reduce(applyAction, startGame(n, 11));
    const right = all.filter((_, i) => i % 2 === 1).reduce(applyAction, startGame(n, 11));
    expect(mergeStates(left, right)).toEqual(full);
    expect(mergeStates(right, left)).toEqual(full);
    expect(mergeStates(full, full)).toEqual(full);
  });

  it("mergeStates ignores a snapshot from another match", () => {
    const mine = startGame(4, 1);
    expect(mergeStates(mine, playAllTurns(startGame(4, 2)))).toBe(mine);
  });
});

describe("showcase + reactions (rulebook §6)", () => {
  it("reveals page by page, album by album, then finishes", () => {
    let s = playAllTurns(startGame(4, 12));
    expect(s.showcase).toEqual({ album: 0, revealed: 0 });
    s = applyAction(s, { type: "SHOWCASE_NEXT", from: s.showcase });
    expect(s.showcase).toEqual({ album: 0, revealed: 1 });
    // A duplicate of the same click is ignored.
    expect(applyAction(s, { type: "SHOWCASE_NEXT", from: { album: 0, revealed: 0 } })).toBe(s);
    s = revealEverything(s);
    expect(gamePhase(s)).toBe("finished");
  });

  it("does not open the showcase while turns are still running", () => {
    const s = startGame(4, 13);
    expect(applyAction(s, { type: "SHOWCASE_NEXT", from: s.showcase })).toBe(s);
  });

  it("caps reactions per viewer per page, forbids self-reactions, and ranks by reactions received", () => {
    let s = playAllTurns(startGame(4, 14));
    const author = pageAt(s, 0, 2)!.author;
    const fan = (author + 1) % 4;
    expect(applyAction(s, { type: "REACT", seat: author, album: 0, turn: 2, emoji: "😂" })).toBe(s);
    for (let i = 0; i < MAX_REACTIONS_PER_PAGE + 2; i++) s = applyAction(s, { type: "REACT", seat: fan, album: 0, turn: 2, emoji: "😂" });
    expect(s.reactions["0:2"]).toEqual({ "😂": MAX_REACTIONS_PER_PAGE });
    const ranking = computeRankings(s);
    expect(ranking[0]).toEqual({ seat: author, rank: 1, score: MAX_REACTIONS_PER_PAGE });
    expect(ranking.slice(1).every((r) => r.rank === 2 && r.score === 0)).toBe(true);
  });
});

describe("drawing codec + sync chunks", () => {
  it("round-trips points through delta encoding", () => {
    const points = [{ x: 3, y: 4 }, { x: 10, y: 2 }, { x: 480, y: 360 }];
    expect(decodePoints(encodePoints(points))).toEqual(points);
  });

  it("reassembles out-of-order chunks", () => {
    const payload = JSON.stringify(playAllTurns(startGame(6, 15)));
    const chunks = splitIntoChunks(payload, "dev", "sync-1", 500);
    expect(chunks.length).toBeGreaterThan(2);
    const assembler = new ChunkAssembler();
    const results = shuffle(chunks, seededRng(3)).map((c) => assembler.accept(c));
    expect(results.filter((r) => r !== null)).toEqual([payload]);
  });
});

describe("AI bots (ARCHITECTURE.md §7)", () => {
  it("only offers moves to seats that still owe a page", () => {
    let s = startGame(4, 16);
    s = applyAction(s, humanSubmit(0, 1));
    expect(getValidMoves(s, 0)).toEqual([]);
    expect(getValidMoves(s, 1).length).toBeGreaterThan(0);
  });

  it("an all-bot game plays to the showcase with only accepted moves", () => {
    for (const seed of [1, 2, 3]) {
      let s = startGame(6, seed);
      const bots = new Set([0, 1, 2, 3, 4, 5]);
      const rng = seededRng(seed * 7);
      for (let guard = 0; guard < 100 && gamePhase(s) === "turns"; guard++) {
        const actor = nextBotActor(s, bots);
        expect(actor).not.toBeNull();
        const action = chooseBotAction(s, actor!, 5, rng);
        expect(action).not.toBeNull();
        const next = applyAction(s, action!);
        expect(next).not.toBe(s);
        s = next;
      }
      expect(gamePhase(s)).toBe("showcase");
      expect(s.albums.flat().every((p) => p !== null && !p.auto)).toBe(true);
    }
  });

  it("draws recognisable templates and guesses from ink colors", () => {
    const { understood } = botDrawingFor("모자를 쓴 고양이", seededRng(1), 10);
    expect(isValidDrawing(understood)).toBe(true);
    expect(understood.ops.length).toBeGreaterThan(5);
    const heart = botDrawingFor("사랑의 하트", seededRng(2), 10).understood;
    expect(["사과", "하트", "딸기", "빨간 자동차", "문어"].some((w) => guessFromDrawing(heart, seededRng(4)).includes(w))).toBe(true);
    expect(guessFromDrawing(EMPTY_DRAWING, seededRng(5)).length).toBeGreaterThanOrEqual(2);
  });

  it("Lv.1 and Lv.10 diverge under the same rng", () => {
    const s = startGame(4, 17);
    const always0 = () => 0;
    const novice = chooseBotAction(s, 0, 1, always0);
    const expert = chooseBotAction(s, 0, 10, always0);
    expect(novice).not.toEqual(expert);
  });
});
