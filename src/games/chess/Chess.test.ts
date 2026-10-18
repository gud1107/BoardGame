import { describe, expect, it } from "vitest";
import { boardString, genPseudo, hashKey, legalMoves, makeMove, parseFen, toFen, unmakeMove, computeHash, moveToSan, findUci, type Pos } from "./core";
import {
  applyAction,
  canOffer,
  chooseBotAction,
  currentActor,
  getValidMoves,
  materialSummary,
  positionsAfterEach,
  startGame,
  toPgn,
  turnSeat,
  type ChessState,
  type CorePosition,
  type EngineAction,
  type Seat,
} from "./engine";
import { chessStatDetails } from "./stats";

function perft(pos: Pos, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const u = makeMove(pos, m);
    n += perft(pos, depth - 1);
    unmakeMove(pos, u);
  }
  return n;
}

/** Fresh game with p1 = white. */
const fresh = (tc = "none"): ChessState => startGame(1, { hostColor: "w", timeControlId: tc });

function play(state: ChessState, ...ucis: string[]): ChessState {
  let s = state;
  for (const uci of ucis) {
    const seat = turnSeat(s);
    const next = applyAction(s, { type: "move", seat, uci });
    if (next === s) throw new Error(`illegal ${uci} at ply ${s.moves.length}`);
    s = next;
  }
  return s;
}

/** Game state starting from a FEN (white = p1). */
function fromFen(fen: string): ChessState {
  const pos = parseFen(fen);
  const core: CorePosition = {
    board: boardString(pos),
    turn: pos.turn === 0 ? "w" : "b",
    castling: pos.castling,
    ep: pos.ep,
    half: pos.half,
    full: pos.full,
  };
  const base = fresh();
  return { ...base, start: core, pos: core, repetition: {} };
}

describe("move generation (perft)", () => {
  it("start position", () => {
    const pos = parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect([1, 2, 3, 4].map((d) => perft(pos, d))).toEqual([20, 400, 8902, 197281]);
  });
  it("kiwipete (castling, en passant, promotions, pins)", () => {
    const pos = parseFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    expect([1, 2, 3].map((d) => perft(pos, d))).toEqual([48, 2039, 97862]);
  });
  it("position 3 (en passant discovered checks)", () => {
    const pos = parseFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
    expect([1, 2, 3, 4].map((d) => perft(pos, d))).toEqual([14, 191, 2812, 43238]);
  });
  it("position 4 (promotion + castling edge cases)", () => {
    const pos = parseFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1");
    expect([1, 2, 3].map((d) => perft(pos, d))).toEqual([6, 264, 9467]);
  });
  it("make/unmake restores position and incremental hash", () => {
    const pos = parseFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    const fen = toFen(pos);
    const key = hashKey(pos);
    const moves: number[] = [];
    genPseudo(pos, moves);
    for (const m of moves) {
      const u = makeMove(pos, m);
      const check = { ...pos, b: pos.b.slice(), k: [pos.k[0], pos.k[1]] as [number, number] };
      computeHash(check);
      expect(check.h1).toBe(pos.h1);
      expect(check.h2).toBe(pos.h2);
      unmakeMove(pos, u);
      expect(toFen(pos)).toBe(fen);
      expect(hashKey(pos)).toBe(key);
    }
  });
});

describe("SAN (§14)", () => {
  it("disambiguates, marks captures/checks/mates/promotions/castling", () => {
    const san = (fen: string, uci: string) => {
      const pos = parseFen(fen);
      const legal = legalMoves(pos);
      return moveToSan(pos, findUci(legal, uci)!, legal);
    };
    expect(san("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "g1f3")).toBe("Nf3");
    expect(san("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1g1")).toBe("O-O");
    expect(san("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1c1")).toBe("O-O-O");
    expect(san("4k3/8/8/8/8/8/4K3/R6R w - - 0 1", "a1d1")).toBe("Rad1");
    expect(san("4k3/8/8/8/8/R7/8/R3K3 w Q - 0 1", "a1a2")).toBe("R1a2");
    expect(san("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6")).toBe("exd6");
    expect(san("8/P3k3/8/8/8/8/8/4K3 w - - 0 1", "a7a8q")).toBe("a8=Q");
    expect(san("8/P7/8/8/8/8/8/k3K3 w - - 0 1", "a7a8q")).toBe("a8=Q+");
    expect(san("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2", "d8h4")).toBe("Qh4#");
  });
});

describe("special moves (§6~§8)", () => {
  it("castling both sides moves the rook and kills rights", () => {
    let s = play(fresh(), "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1");
    expect(s.moves.at(-1)!.kind).toBe("castleK");
    expect(s.pos.board[6]).toBe("K");
    expect(s.pos.board[5]).toBe("R");
    expect(s.pos.castling & 3).toBe(0);
    s = play(s, "d7d6", "d2d3", "c8g4", "b1c3", "d8d7", "c1e3", "e8c8");
    expect(s.moves.at(-1)!.san).toBe("O-O-O");
    expect(s.pos.board[58]).toBe("k");
    expect(s.pos.board[59]).toBe("r");
  });
  it("cannot castle out of, through or into check", () => {
    // Black rook on f8 attacks f1: king may not pass through.
    const s = fromFen("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    const moves = getValidMoves(s, "p1").map((a) => (a as { uci: string }).uci);
    expect(moves).not.toContain("e1g1");
    expect(moves).toContain("e1c1");
    const inCheckState = fromFen("4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    const moves2 = getValidMoves(inCheckState, "p1").map((a) => (a as { uci: string }).uci);
    expect(moves2).not.toContain("e1g1");
    expect(moves2).not.toContain("e1c1");
    // b1 attacked is fine for O-O-O.
    const b1 = fromFen("1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1");
    expect(getValidMoves(b1, "p1").map((a) => (a as { uci: string }).uci)).toContain("e1c1");
  });
  it("en passant only right after the double push", () => {
    let s = play(fresh(), "e2e4", "a7a6", "e4e5", "d7d5");
    expect(getValidMoves(s, "p1").map((a) => (a as { uci: string }).uci)).toContain("e5d6");
    const ep = play(s, "e5d6");
    expect(ep.moves.at(-1)!.kind).toBe("ep");
    expect(ep.moves.at(-1)!.capSq).toBe(35); // d5
    expect(ep.pos.board[35]).toBe(".");
    s = play(s, "h2h3", "h7h6");
    expect(getValidMoves(s, "p1").map((a) => (a as { uci: string }).uci)).not.toContain("e5d6");
  });
  it("promotion requires a piece choice; underpromotion works", () => {
    const s = fromFen("8/P6k/8/8/8/8/8/4K3 w - - 0 1");
    expect(applyAction(s, { type: "move", seat: "p1", uci: "a7a8" })).toBe(s);
    const n = applyAction(s, { type: "move", seat: "p1", uci: "a7a8n" });
    expect(n.pos.board[56]).toBe("N");
    expect(n.moves.at(-1)!.promo).toBe("N");
  });
  it("pinned piece cannot leave the pin line", () => {
    const s = fromFen("4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1");
    expect(getValidMoves(s, "p1").some((a) => (a as { uci: string }).uci.startsWith("e2"))).toBe(false);
  });
});

describe("game end (§10, §11)", () => {
  it("fool's mate", () => {
    const s = play(fresh(), "f2f3", "e7e5", "g2g4", "d8h4");
    expect(s.phase).toBe("gameOver");
    expect(s.result).toEqual({ winner: "b", reason: "checkmate" });
    expect(s.moves.at(-1)!.mate).toBe(true);
  });
  it("stalemate", () => {
    const s = play(fromFen("7k/8/6Q1/8/8/8/8/K7 w - - 0 1"), "g6f7");
    expect(s.result).toEqual({ winner: null, reason: "stalemate" });
  });
  it("insufficient material after capture", () => {
    const s = play(fromFen("8/8/4k3/8/4n3/8/3B4/4K3 b - - 0 1"), "e4d2"); // N takes B → K+N v K
    expect(s.result?.reason).toBe("insufficient");
  });
  it("same-colour bishops are insufficient, opposite colours are not", () => {
    const same = play(fromFen("8/8/3bk3/8/8/8/1B6/K7 w - - 0 1"), "a1a2");
    expect(same.result?.reason).toBe("insufficient");
    const opposite = play(fromFen("8/8/2b1k3/8/8/8/1B6/K7 w - - 0 1"), "a1a2");
    expect(opposite.result).toBeNull();
  });
  it("threefold repetition", () => {
    let s = fresh();
    s = play(s, "g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1");
    expect(s.result).toBeNull();
    s = play(s, "f6g8");
    expect(s.result?.reason).toBe("threefold");
  });
  it("fifty-move rule", () => {
    const s = fromFen("4k3/8/8/8/8/8/8/R3K3 w - - 99 80");
    const after = play(s, "a1a2");
    expect(after.result?.reason).toBe("fifty");
  });
  it("mate beats the fifty-move rule", () => {
    const s = play(fromFen("k7/8/1K6/8/8/8/8/7R w - - 99 80"), "h1h8");
    expect(s.result?.reason).toBe("checkmate");
  });
  it("resign at any time", () => {
    const s = applyAction(fresh(), { type: "resign", seat: "p2" });
    expect(s.result).toEqual({ winner: "w", reason: "resign" });
  });
});

describe("clock (§12)", () => {
  it("first move each is free, then time and increment apply", () => {
    let s = fresh("3+2");
    s = applyAction(s, { type: "move", seat: "p1", uci: "e2e4", spentMs: 50_000 });
    s = applyAction(s, { type: "move", seat: "p2", uci: "e7e5", spentMs: 50_000 });
    expect(s.remainingMs).toEqual({ w: 180_000, b: 180_000 });
    s = applyAction(s, { type: "move", seat: "p1", uci: "g1f3", spentMs: 10_000 });
    expect(s.remainingMs.w).toBe(172_000);
    expect(s.moves.at(-1)!.clockAfter).toBe(172_000);
  });
  it("a move that took all the remaining time loses on time", () => {
    let s = play(fresh("1+0"), "e2e4", "e7e5");
    s = applyAction(s, { type: "move", seat: "p1", uci: "g1f3", spentMs: 60_000 });
    expect(s.result).toEqual({ winner: "b", reason: "timeout" });
    expect(s.moves.length).toBe(2);
  });
  it("flag claims need the time to really be gone", () => {
    const s = play(fresh("1+0"), "e2e4", "e7e5");
    expect(applyAction(s, { type: "flag", seat: "p2", spentMs: 59_000 })).toBe(s);
    expect(applyAction(s, { type: "flag", seat: "p2", spentMs: 60_000 }).result?.reason).toBe("timeout");
  });
  it("timeout against a bare king is a draw (§12.4)", () => {
    let s = fromFen("4k3/8/8/8/8/8/PPP5/4K3 w - - 0 1");
    s = { ...s, clock: { baseMs: 60_000, incMs: 0 }, remainingMs: { w: 60_000, b: 60_000 } };
    s = play(s, "a2a3", "e8d8");
    s = applyAction(s, { type: "flag", seat: "p1", spentMs: 60_000 });
    expect(s.result).toEqual({ winner: null, reason: "timeoutVsInsufficient" });
  });
  it("no clock → flag ignored", () => {
    const s = play(fresh("none"), "e2e4", "e7e5");
    expect(applyAction(s, { type: "flag", seat: "p1", spentMs: 1e9 })).toBe(s);
  });
});

describe("offers (§13)", () => {
  it("draw offer accepted → agreement", () => {
    let s = play(fresh(), "e2e4");
    s = applyAction(s, { type: "offer", seat: "p1", kind: "draw" });
    expect(currentActor(s)).toBe("p2");
    s = applyAction(s, { type: "respond", seat: "p2", accept: true });
    expect(s.result?.reason).toBe("agreement");
  });
  it("draw offer: one per position, three per game, cleared when the responder moves", () => {
    let s = fresh();
    s = applyAction(s, { type: "offer", seat: "p1", kind: "draw" });
    s = applyAction(s, { type: "respond", seat: "p2", accept: false });
    expect(canOffer(s, "p1", "draw")).toBe(false);
    s = play(s, "e2e4");
    s = applyAction(s, { type: "offer", seat: "p1", kind: "draw" });
    s = play(s, "e7e5");
    expect(s.offer).toBeNull();
    s = applyAction(s, { type: "offer", seat: "p1", kind: "draw" });
    s = applyAction(s, { type: "respond", seat: "p2", accept: false });
    s = play(s, "g1f3");
    expect(canOffer(s, "p1", "draw")).toBe(false); // 3 used
  });
  it("takeback undoes to the requester's last move", () => {
    let s = play(fresh(), "e2e4", "e7e5", "g1f3");
    // white just moved → 1 ply back
    let t = applyAction(s, { type: "offer", seat: "p1", kind: "takeback" });
    t = applyAction(t, { type: "respond", seat: "p2", accept: true });
    expect(t.moves.map((m) => m.uci)).toEqual(["e2e4", "e7e5"]);
    expect(turnSeat(t)).toBe("p1");
    // black asks after white replied → 2 plies back
    s = play(s, "b8c6", "f1b5");
    t = applyAction(s, { type: "offer", seat: "p2", kind: "takeback" });
    t = applyAction(t, { type: "respond", seat: "p1", accept: true });
    expect(t.moves.map((m) => m.uci)).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(turnSeat(t)).toBe("p2");
    expect(t.repetition).toEqual(play(fresh(), "e2e4", "e7e5", "g1f3").repetition);
  });
  it("cannot request a takeback before moving", () => {
    const s = play(fresh(), "e2e4");
    expect(canOffer(s, "p2", "takeback")).toBe(false);
  });
});

describe("helpers", () => {
  it("material summary, positions, PGN", () => {
    const s = play(fresh(), "e2e4", "d7d5", "e4d5", "d8d5");
    const mat = materialSummary(s);
    expect(mat.capturedBy.w).toEqual(["p"]);
    expect(mat.capturedBy.b).toEqual(["P"]);
    expect(mat.whiteLead).toBe(0);
    expect(positionsAfterEach(s)).toHaveLength(5);
    const pgn = toPgn(s, { p1: "앨리스", p2: "봇" });
    expect(pgn).toContain("1. e4 d5 2. exd5 Qxd5 *");
    expect(pgn).toContain('[White "앨리스"]');
  });
  it("stats count special moves for a colour", () => {
    let s = play(fresh(), "e2e4", "d7d5", "e4d5", "c7c5", "d5c6", "b8c6");
    s = applyAction(s, { type: "resign", seat: "p2" });
    const d = chessStatDetails(s, "p1");
    expect(d.enPassants).toBe(1);
    expect(d.captures).toBe(2);
    expect(d.moves).toBe(3);
  });
  it("host colour from seed when random, rematch keeps JSON round-trip", () => {
    const a = startGame(42, { hostColor: "random" });
    const b = startGame(42, { hostColor: "random" });
    expect(a.colors).toEqual(b.colors);
    const s = play(fresh(), "e2e4");
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("bots (§18)", () => {
  it("valid moves only for the side to move, respond for offers", () => {
    const s = fresh();
    expect(getValidMoves(s, "p1")).toHaveLength(20);
    expect(getValidMoves(s, "p2")).toHaveLength(0);
    const o = applyAction(s, { type: "offer", seat: "p1", kind: "draw" });
    expect(getValidMoves(o, "p2").every((a) => a.type === "respond")).toBe(true);
  });
  it("finds mate in one at Lv.4+", () => {
    const s = fromFen("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
    for (const lv of [4, 7, 10]) {
      const a = chooseBotAction(s, "p1", lv, Math.random, { budgetMs: 200 }) as { uci: string };
      expect(a.uci).toBe("a1a8");
    }
  });
  it("expert takes a hanging queen", () => {
    const s = fromFen("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1");
    const a = chooseBotAction(s, "p1", 9, Math.random, { budgetMs: 200 }) as { uci: string };
    expect(a.uci).toBe("d1d5");
  });
  it("takeback acceptance by level", () => {
    let s = play(fresh(), "e2e4");
    s = applyAction(s, { type: "offer", seat: "p1", kind: "takeback" });
    expect(chooseBotAction(s, "p2", 3)).toEqual({ type: "respond", seat: "p2", accept: true });
    expect(chooseBotAction(s, "p2", 8)).toEqual({ type: "respond", seat: "p2", accept: false });
  });
  it("bot vs bot plays legal moves to a finish", () => {
    for (const [l1, l2] of [[1, 3], [5, 2]] as const) {
      let s = startGame(7, { hostColor: "w" });
      let guard = 0;
      while (s.phase === "playing" && guard++ < 400) {
        const seat = currentActor(s) as Seat;
        const action = chooseBotAction(s, seat, seat === "p1" ? l1 : l2) as EngineAction;
        expect(action).not.toBeNull();
        const next = applyAction(s, action);
        expect(next).not.toBe(s);
        s = next;
      }
      if (s.phase === "playing") s = applyAction(s, { type: "resign", seat: "p1" });
      expect(s.result).not.toBeNull();
    }
  }, 60_000);
});
