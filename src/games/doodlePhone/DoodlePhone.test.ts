import { describe, expect, it } from "vitest";
import { seededRng, shuffle } from "@/lib/rng";
import { addToDrawing, chooseBotAction, getValidMoves, guessFromDrawing, botDrawingFor, inkByColor, nextBotActor, redrawDrawing } from "./bot";
import {
  EMPTY_DRAWING,
  MAX_DRAWING_CHARS,
  PALETTE,
  SHAPE_REPLAY_STEPS,
  decodePoints,
  encodePoints,
  fillOp,
  isBlankDrawing,
  isValidDrawing,
  nearestPaletteIndex,
  normalizeColor,
  opAlpha,
  opCost,
  pointCount,
  shapeOp,
  strokeOp,
  type DrawOp,
  type Drawing,
} from "./drawing";
import {
  MAX_REACTIONS_PER_PAGE,
  albumFor,
  applyAction,
  computeRankings,
  consecutiveTimeouts,
  currentTurn,
  fallbackPrompt,
  gamePhase,
  isValidText,
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
import { boxFrom, handleAt, handlesFor, hitTest, hitsOp, opsInBox, pasteOps, reorderOps, resizeShape, restyleOps, translateGroup, translateOp, unionBounds } from "./editing";
import { CHORDS, LOOP_STEPS, STEPS_PER_BAR, lofiEventsAt, midiToHz } from "./lofiPattern";
import { GAME_MODES, ICEBREAKER_QUESTIONS, icebreakerQuestion, openingChoices, sanitizeOptions, turnKindFor, turnSecondsFor, type GameMode } from "./modes";
import { THEME_BANK, themeChoices } from "./themes";

const doodle = (seat: number): Drawing => ({ v: 1, ops: [strokeOp(1, 1, [{ x: 10 + seat, y: 10 }, { x: 100, y: 120 }])] });

/** The action a well-behaved human in `seat` would send for `turn`. */
function humanSubmit(seat: number, turn: number, state?: DoodlePhoneState): EngineAction {
  const kind = state ? turnKind(state, turn) : turnKindFor("NORMAL", turn, 4);
  return kind === "text"
    ? { type: "SUBMIT_TEXT", seat, turn, text: `좌석${seat} 턴${turn}` }
    : { type: "SUBMIT_DRAWING", seat, turn, drawing: doodle(seat) };
}

function playAllTurns(state: DoodlePhoneState): DoodlePhoneState {
  let s = state;
  for (let turn = 1; turn <= s.playerCount; turn++) {
    for (let seat = 0; seat < s.playerCount; seat++) s = applyAction(s, humanSubmit(seat, turn, s));
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
    expect([1, 2, 3, 4, 5].map((t) => turnKindFor("NORMAL", t, 5))).toEqual(["text", "drawing", "text", "drawing", "text"]);
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

describe("lo-fi BGM score (lofiPattern.ts)", () => {
  const loop = (pass: number) => Array.from({ length: LOOP_STEPS }, (_, i) => lofiEventsAt(pass * LOOP_STEPS + i));

  it("strikes each chord of the loop once, on the downbeat of its bar", () => {
    const chords = loop(0).flatMap((events, step) => events.filter((e) => e.voice === "chord").map((e) => ({ step, notes: e.notes })));
    expect(chords).toEqual(CHORDS.map((notes, bar) => ({ step: bar * STEPS_PER_BAR, notes })));
  });

  it("is deterministic per pass but varies the arpeggio between passes", () => {
    expect(loop(3)).toEqual(loop(3));
    const arps = (pass: number) => loop(pass).map((events) => events.filter((e) => e.voice === "arp").map((e) => e.notes[0]).join());
    expect(arps(0)).not.toEqual(arps(1));
  });

  it("keeps every pitched note in a soft, audible range", () => {
    const notes = [0, 1, 2, 3].flatMap((pass) => loop(pass).flat().flatMap((e) => e.notes));
    expect(Math.min(...notes)).toBeGreaterThanOrEqual(40);
    expect(Math.max(...notes)).toBeLessThanOrEqual(84);
    expect(midiToHz(69)).toBe(440);
  });
});

describe("game modes (modes.ts, rulebook §9)", () => {
  const kinds = (mode: GameMode, n: number) => Array.from({ length: n }, (_, i) => turnKindFor(mode, i + 1, n));

  it("routes each mode's turns to the right kind", () => {
    expect(kinds("NORMAL", 4)).toEqual(["text", "drawing", "text", "drawing"]);
    expect(kinds("SANDWICH", 4)).toEqual(["text", "drawing", "drawing", "text"]);
    expect(kinds("SANDWICH", 6)).toEqual(["text", "drawing", "drawing", "drawing", "drawing", "text"]);
    for (const mode of ["KNOCK_OFF", "ANIMATION", "COMPLEMENT"] as const) expect(new Set(kinds(mode, 5))).toEqual(new Set(["drawing"]));
    for (const mode of ["SECRET", "ICEBREAKER", "SCORE", "SPEEDRUN"] as const) expect(kinds(mode, 4)).toEqual(kinds("NORMAL", 4));
  });

  it("computes turn times per mode, with speedrun accelerating and the host multiplier applied", () => {
    const opts = (mode: GameMode, timeMultiplier = 1) => sanitizeOptions({ mode, timeMultiplier });
    expect(turnSecondsFor(opts("NORMAL"), 1, 6)).toBe(60);
    expect(turnSecondsFor(opts("NORMAL"), 2, 6)).toBe(90);
    expect(turnSecondsFor(opts("KNOCK_OFF"), 3, 6)).toBe(80);
    expect(turnSecondsFor(opts("SPEEDRUN"), 1, 6)).toBe(18);
    expect(turnSecondsFor(opts("SPEEDRUN"), 2, 6)).toBe(31);
    expect(turnSecondsFor(opts("SPEEDRUN"), 7, 8)).toBe(10);
    expect(turnSecondsFor(opts("NORMAL", 1.5), 2, 6)).toBe(135);
    expect(turnSecondsFor(opts("NORMAL", 0.7), 2, 6)).toBe(63);
  });

  it("clamps untrusted host options", () => {
    expect(sanitizeOptions({ mode: "HACK", timeMultiplier: 9, ghostFrames: "yes", theme: "NSFW" })).toEqual({ mode: "NORMAL", timeMultiplier: 1.5, ghostFrames: true, allowUndo: true, theme: "FREE" });
    expect(sanitizeOptions(null).timeMultiplier).toBe(1);
  });

  it("an all-bot game finishes in every mode", () => {
    for (const mode of GAME_MODES) {
      for (const n of [4, 5]) {
        let s = startGame(n, 40 + n, { mode });
        const bots = new Set(Array.from({ length: n }, (_, i) => i));
        const rng = seededRng(n * 13);
        for (let guard = 0; guard < 200 && gamePhase(s) === "turns"; guard++) {
          const actor = nextBotActor(s, bots);
          const action = actor === null ? null : chooseBotAction(s, actor, 6, rng);
          expect(action, `${mode} n=${n}`).not.toBeNull();
          const next = applyAction(s, action!);
          expect(next, `${mode} n=${n}`).not.toBe(s);
          s = next;
        }
        expect(gamePhase(s), mode).toBe("showcase");
        expect(s.albums.flat().every((p) => p !== null && !p.auto), mode).toBe(true);
      }
    }
  });

  it("complement bots keep the whole previous picture and add to it", () => {
    const base = botDrawingFor("고양이", seededRng(1), 10).understood;
    const added = addToDrawing(base, seededRng(2), 10);
    expect(added.ops.slice(0, base.ops.length)).toEqual(base.ops);
    expect(added.ops.length).toBeGreaterThan(base.ops.length);
    expect(isValidDrawing(added)).toBe(true);
  });

  it("animation bots redraw the previous frame shifted, so the flipbook moves", () => {
    const frame = botDrawingFor("자동차", seededRng(3), 10).understood;
    const next = redrawDrawing(frame, seededRng(4), 10, 12, 0);
    expect(next.ops.length).toBe(frame.ops.length);
    expect(next).not.toEqual(frame);
    expect(isValidDrawing(next)).toBe(true);
  });

  it("gives icebreaker albums a deterministic question and bots answer it", () => {
    const s = startGame(4, 77, { mode: "ICEBREAKER" });
    expect(icebreakerQuestion(77, 2)).toBe(icebreakerQuestion(77, 2));
    expect(ICEBREAKER_QUESTIONS).toContain(icebreakerQuestion(77, 2));
    const action = chooseBotAction(s, 0, 10, seededRng(1));
    expect(action?.type).toBe("SUBMIT_TEXT");
  });
});

describe("score mode voting", () => {
  it("accepts one vote per seat per album, never for your own page, and only in score mode", () => {
    const normal = playAllTurns(startGame(4, 50));
    expect(applyAction(normal, { type: "VOTE", seat: 0, album: 1, turn: 1 })).toBe(normal);

    let s = playAllTurns(startGame(4, 50, { mode: "SCORE" }));
    const own = receiverOf(4, 1, 2);
    expect(applyAction(s, { type: "VOTE", seat: own, album: 1, turn: 2 })).toBe(s);
    const voter = (own + 1) % 4;
    s = applyAction(s, { type: "VOTE", seat: voter, album: 1, turn: 2 });
    expect(applyAction(s, { type: "VOTE", seat: voter, album: 1, turn: 3 })).toBe(s);
    expect(computeRankings(s)[0]).toEqual({ seat: own, rank: 1, score: 1 });
  });

  it("counts a reaction or vote even if it arrives before the page itself", () => {
    const early = startGame(4, 60, { mode: "SCORE" });
    const author = receiverOf(4, 0, 1);
    const fan = (author + 1) % 4;
    const reacted = applyAction(early, { type: "REACT", seat: fan, album: 0, turn: 1, emoji: "👏" });
    expect(reacted.reactions["0:1"]).toEqual({ "👏": 1 });
    const voted = applyAction(early, { type: "VOTE", seat: fan, album: 0, turn: 1 });
    expect(voted.votes["0:" + fan]).toBe(1);
  });
});

describe("theme packs (themes.ts, rulebook §10)", () => {
  const packs = Object.keys(THEME_BANK) as (keyof typeof THEME_BANK)[];

  it("offers 3 distinct in-pack keywords per album, the same on every device", () => {
    for (const theme of packs) {
      const a = themeChoices(theme, 99, 2);
      expect(a).toEqual(themeChoices(theme, 99, 2));
      expect(new Set(a).size).toBe(3);
      expect(a.every((w) => THEME_BANK[theme].includes(w))).toBe(true);
    }
    expect(themeChoices("FREE", 99, 2)).toEqual([]);
  });

  it("every keyword is a valid prompt (2~35 chars)", () => {
    for (const theme of packs) for (const word of THEME_BANK[theme]) expect(isValidText(word), word).toBe(true);
  });

  it("is ignored in icebreaker mode, where the opening is an answer", () => {
    expect(openingChoices(sanitizeOptions({ mode: "ICEBREAKER", theme: "MOVIE" }), 1, 0)).toEqual([]);
    expect(openingChoices(sanitizeOptions({ mode: "KNOCK_OFF", theme: "MOVIE" }), 1, 0)).toHaveLength(3);
  });

  it("keeps a timed-out themed opening on theme", () => {
    let s = startGame(4, 21, { theme: "PROVERB" });
    s = applyAction(s, { type: "TIMEOUT", turn: 1, seats: [0, 1, 2, 3] });
    const page = pageAt(s, 1, 1);
    expect(page?.kind === "text" && THEME_BANK.PROVERB.includes(page.text)).toBe(true);
  });

  it("bots open with one of the offered keywords", () => {
    const s = startGame(4, 22, { theme: "ANIME" });
    const action = chooseBotAction(s, 0, 10, seededRng(5));
    expect(action?.type === "SUBMIT_TEXT" && themeChoices("ANIME", 22, 0).includes(action.text)).toBe(true);
  });

  it("any mode × theme combination plays through with bots", () => {
    for (const mode of GAME_MODES) {
      let s = startGame(4, 31, { mode, theme: "MOVIE" });
      const bots = new Set([0, 1, 2, 3]);
      const rng = seededRng(9);
      for (let guard = 0; guard < 100 && gamePhase(s) === "turns"; guard++) s = applyAction(s, chooseBotAction(s, nextBotActor(s, bots)!, 6, rng)!);
      expect(gamePhase(s), mode).toBe("showcase");
    }
  });
});

describe("shape tools + opacity (drawing.ts)", () => {
  const box = (k: "l" | "r" | "e", filled = false, opacity = 100) => shapeOp(k, 5, 2, { x: 40, y: 50 }, { x: 200, y: 180 }, { filled, opacity });

  it("encodes line/rect/ellipse as absolute corners and validates them", () => {
    for (const k of ["l", "r", "e"] as const) {
      const op = box(k, true);
      expect(op).toMatchObject({ k, c: 5, w: 2, p: [40, 50, 200, 180] });
      expect(isValidDrawing({ v: 1, ops: [op] })).toBe(true);
    }
    expect(box("l", true)).not.toHaveProperty("f"); // a line has no inside to fill
    expect(box("r", true)).toHaveProperty("f", 1);
    const bad = [
      { k: "r", c: 1, w: 1, p: [0, 0, 999, 10] },
      { k: "e", c: 1, w: 1, p: [0, 0, 10] },
      { k: "r", c: 1, w: 1, p: [0, 0, 10, 10], f: 2 },
      { k: "s", c: 1, w: 1, p: [1, 1], a: 5 },
    ];
    for (const op of bad) expect(isValidDrawing({ v: 1, ops: [op] } as unknown as Drawing), JSON.stringify(op)).toBe(false);
  });

  it("stores opacity only when translucent, so opaque drawings stay byte-identical", () => {
    expect(strokeOp(1, 1, [{ x: 1, y: 1 }])).not.toHaveProperty("a");
    expect(strokeOp(1, 1, [{ x: 1, y: 1 }], 25)).toHaveProperty("a", 25);
    expect(fillOp(3, { x: 10, y: 10 }, 3)).toHaveProperty("a", 10); // clamped to the minimum
    expect(opAlpha(box("e", false, 40))).toBeCloseTo(0.4);
    expect(opCost(box("r"))).toBe(SHAPE_REPLAY_STEPS); // shapes replay progressively in the showcase
    expect(pointCount({ v: 1, ops: [box("l"), fillOp(1, { x: 1, y: 1 })] })).toBe(SHAPE_REPLAY_STEPS + 1);
  });

  it("the engine accepts a drawing made with every tool", () => {
    let s = startGame(4, 70);
    for (let seat = 0; seat < 4; seat++) s = applyAction(s, humanSubmit(seat, 1, s));
    const drawing: Drawing = { v: 1, ops: [strokeOp(1, 1, [{ x: 5, y: 5 }, { x: 50, y: 60 }], 30), box("l"), box("r", true, 60), box("e"), fillOp(7, { x: 300, y: 300 }, 50)] };
    const next = applyAction(s, { type: "SUBMIT_DRAWING", seat: 0, turn: 2, drawing });
    expect(pageAt(next, albumFor(4, 0, 2), 2)).toMatchObject({ kind: "drawing", drawing });
  });

  it("bots copy shapes correctly and count their ink when guessing", () => {
    const source: Drawing = { v: 1, ops: [box("r", true), box("e", false, 50)] };
    const copy = redrawDrawing(source, seededRng(8), 10, 12, 0);
    expect(isValidDrawing(copy)).toBe(true);
    expect(copy.ops.map((o) => o.k)).toEqual(["r", "e"]);
    expect(copy.ops[0]).toHaveProperty("f", 1);
    expect(copy.ops[1]).toHaveProperty("a", 50);
    expect(inkByColor(source).get(5)).toBeGreaterThan(0);
  });
});

describe("free colors — picker & eyedropper (drawing.ts)", () => {
  it("accepts palette indices and #rrggbb, rejects anything else", () => {
    const ok = (c: unknown) => isValidDrawing({ v: 1, ops: [{ k: "s", c, w: 1, p: [1, 1] }] } as unknown as Drawing);
    expect(ok(3)).toBe(true);
    expect(ok("#12ab9f")).toBe(true);
    for (const bad of [20, -1, "#12AB9", "red", "#12ab9fz", null]) expect(ok(bad), String(bad)).toBe(false);
  });

  it("stores a picked palette color as its index and lowercases free hex", () => {
    expect(normalizeColor(PALETTE[5].toUpperCase())).toBe(5);
    expect(strokeOp("#12AB9F", 1, [{ x: 1, y: 1 }])).toHaveProperty("c", "#12ab9f");
    expect(shapeOp("r", PALETTE[13], 1, { x: 1, y: 1 }, { x: 9, y: 9 })).toHaveProperty("c", 13);
  });

  it("maps free colors to the nearest palette entry and treats picked white as paper", () => {
    expect(nearestPaletteIndex("#ee4040")).toBe(5); // ≈ red
    expect(isBlankDrawing({ v: 1, ops: [strokeOp("#ffffff", 1, [{ x: 1, y: 1 }])] })).toBe(true);
    const custom: Drawing = { v: 1, ops: [shapeOp("r", "#1f9a45", 2, { x: 10, y: 10 }, { x: 300, y: 300 }, { filled: true })] };
    expect([...inkByColor(custom).keys()]).toEqual([nearestPaletteIndex("#1f9a45")]);
  });
});

describe("select / move / resize geometry (editing.ts)", () => {
  const rect = shapeOp("r", 1, 1, { x: 100, y: 100 }, { x: 200, y: 180 });
  const filledRect = shapeOp("r", 1, 1, { x: 100, y: 100 }, { x: 200, y: 180 }, { filled: true });
  const ellipse = shapeOp("e", 1, 1, { x: 100, y: 100 }, { x: 300, y: 200 });
  const line = shapeOp("l", 1, 1, { x: 10, y: 10 }, { x: 110, y: 10 });
  const stroke = strokeOp(1, 1, [{ x: 50, y: 300 }, { x: 80, y: 310 }, { x: 120, y: 305 }]);

  it("hits outlines, not the hollow inside; filled shapes hit anywhere inside", () => {
    expect(hitsOp(rect, { x: 100, y: 140 })).toBe(true);
    expect(hitsOp(rect, { x: 150, y: 140 })).toBe(false);
    expect(hitsOp(filledRect, { x: 150, y: 140 })).toBe(true);
    expect(hitsOp(ellipse, { x: 300, y: 150 })).toBe(true);
    expect(hitsOp(ellipse, { x: 200, y: 150 })).toBe(false);
    expect(hitsOp(line, { x: 60, y: 14 })).toBe(true);
    expect(hitsOp(stroke, { x: 80, y: 312 })).toBe(true);
  });

  it("picks the topmost selectable op, skips fills and anything before `from`", () => {
    const ops = [rect, filledRect, fillOp(3, { x: 150, y: 140 })];
    expect(hitTest(ops, { x: 150, y: 140 })).toBe(1);
    expect(hitTest(ops, { x: 150, y: 140 }, 2)).toBe(-1);
    expect(hitTest(ops, { x: 400, y: 20 })).toBe(-1);
  });

  it("moves shapes but keeps them on the sheet", () => {
    expect(translateOp(rect, 20, -30)).toMatchObject({ p: [120, 70, 220, 150] });
    expect(translateOp(rect, 1000, 1000)).toMatchObject({ p: [380, 280, 480, 360] });
    expect(isValidDrawing({ v: 1, ops: [translateOp(ellipse, -999, 0)] })).toBe(true);
  });

  it("moves a stroke by shifting only its absolute first point", () => {
    const moved = translateOp(stroke, 10, 5);
    expect(decodePoints((moved as unknown as { p: number[] }).p)).toEqual([{ x: 60, y: 305 }, { x: 90, y: 315 }, { x: 130, y: 310 }]);
  });

  it("resizes from a handle, keeping the opposite corner / endpoint fixed", () => {
    expect(handleAt(rect, { x: 199, y: 181 })).toBe("se");
    expect(resizeShape(rect, "se", { x: 260, y: 240 })).toMatchObject({ p: [100, 100, 260, 240] });
    expect(resizeShape(rect, "nw", { x: 40, y: 50 })).toMatchObject({ p: [200, 180, 40, 50] });
    expect(resizeShape(line, "p2", { x: 999, y: 50 })).toMatchObject({ p: [10, 10, 480, 50] });
    expect(handlesFor(stroke)).toEqual([]);
    expect(resizeShape(stroke, "se", { x: 1, y: 1 })).toBe(stroke);
  });
});

describe("multi-selection (editing.ts)", () => {
  const a = shapeOp("r", 1, 1, { x: 10, y: 10 }, { x: 60, y: 60 });
  const b = shapeOp("e", 1, 1, { x: 100, y: 20 }, { x: 160, y: 80 });
  const c = strokeOp(1, 1, [{ x: 300, y: 300 }, { x: 350, y: 320 }]);
  const ops = [a, b, fillOp(2, { x: 30, y: 30 }), c];

  it("marquee selects every selectable op it touches, skipping fills and anything before `from`", () => {
    expect(opsInBox(ops, boxFrom({ x: 0, y: 0 }, { x: 110, y: 40 }))).toEqual([0, 1]);
    expect(opsInBox(ops, boxFrom({ x: 480, y: 360 }, { x: 0, y: 0 }))).toEqual([0, 1, 3]);
    expect(opsInBox(ops, boxFrom({ x: 0, y: 0 }, { x: 480, y: 360 }), 2)).toEqual([3]);
  });

  it("moves a group together and leaves the rest untouched", () => {
    const moved = translateGroup(ops, [0, 1], 20, 5);
    expect(moved[0]).toMatchObject({ p: [30, 15, 80, 65] });
    expect(moved[1]).toMatchObject({ p: [120, 25, 180, 85] });
    expect(moved[2]).toBe(ops[2]);
    expect(moved[3]).toBe(ops[3]);
  });

  it("clamps the group as a whole at the sheet edge, keeping the spacing between pieces", () => {
    const moved = translateGroup(ops, [0, 1], -500, 0); // group minX is 10 → can only move 10 left
    expect(moved[0]).toMatchObject({ p: [0, 10, 50, 60] });
    expect(moved[1]).toMatchObject({ p: [90, 20, 150, 80] });
    expect(unionBounds([moved[0], moved[1]])).toEqual({ minX: 0, minY: 10, maxX: 150, maxY: 80 });
  });
});

describe("restyle / duplicate / reorder a selection (editing.ts)", () => {
  const ink = strokeOp(1, 1, [{ x: 10, y: 10 }, { x: 40, y: 20 }]);
  const eraser = strokeOp(0, 3, [{ x: 20, y: 20 }, { x: 60, y: 20 }]);
  const box = shapeOp("r", 13, 2, { x: 100, y: 100 }, { x: 200, y: 150 });
  const fill = fillOp(7, { x: 150, y: 120 });

  it("recolors strokes and shapes but never turns an eraser stroke into ink; size applies to all", () => {
    const out = restyleOps([ink, eraser, box, fill], [0, 1, 2, 3], { color: "#12ab9f", size: 4 });
    expect(out[0]).toMatchObject({ c: "#12ab9f", w: 4 });
    expect(out[1]).toMatchObject({ c: 0, w: 4 });
    expect(out[2]).toMatchObject({ c: "#12ab9f", w: 4 });
    expect(out[3]).toBe(fill);
    expect(restyleOps([ink], [0], { color: PALETTE[5] })[0]).toHaveProperty("c", 5);
  });

  it("pastes offset copies on top and reports their indices", () => {
    const { ops, indices } = pasteOps([ink, box], [box]);
    expect(indices).toEqual([2]);
    expect(ops[2]).toMatchObject({ p: [116, 116, 216, 166] });
    const edge = shapeOp("r", 1, 1, { x: 400, y: 300 }, { x: 480, y: 360 });
    expect(pasteOps([], [edge]).ops[0]).toMatchObject({ p: [384, 284, 464, 344] }); // nudged back inside
  });

  it("sends to front/back keeping the pieces' order, and never below the last clear", () => {
    const a = strokeOp(1, 1, [{ x: 1, y: 1 }]);
    const b = strokeOp(2, 1, [{ x: 2, y: 2 }]);
    const c = strokeOp(3, 1, [{ x: 3, y: 3 }]);
    const clear: DrawOp = { k: "x" };
    expect(reorderOps([a, b, c], [0, 1], "front")).toEqual({ ops: [c, a, b], indices: [1, 2] });
    expect(reorderOps([a, b, c], [2], "back")).toEqual({ ops: [c, a, b], indices: [0] });
    expect(reorderOps([a, clear, b, c], [3], "back", 2)).toEqual({ ops: [a, clear, c, b], indices: [2] });
  });
});
