import type { ChessState, Seat } from "./engine";

/**
 * Per-match detail stats (rulebook §20; merge rule: `max*` keep the highest,
 * others sum). Derived from the move list — nothing is tallied separately.
 */
export function chessStatDetails(state: ChessState, seat: Seat): Record<string, number> {
  const color = state.colors[seat];
  const mine = state.moves.filter((m) => m.color === color);
  const won = state.result?.winner === color;
  const mateWin = won && state.result?.reason === "checkmate";
  return {
    moves: mine.length,
    captures: mine.filter((m) => m.captured).length,
    maxCaptures: mine.filter((m) => m.captured).length,
    checks: mine.filter((m) => m.check).length,
    castles: mine.filter((m) => m.kind === "castleK" || m.kind === "castleQ").length,
    enPassants: mine.filter((m) => m.kind === "ep").length,
    promotions: mine.filter((m) => m.promo).length,
    underPromotions: mine.filter((m) => m.promo && m.promo.toLowerCase() !== "q").length,
    mateWins: mateWin ? 1 : 0,
    quickMates: mateWin && state.moves.length <= 20 ? 1 : 0,
    draws: state.result && state.result.winner === null ? 1 : 0,
  };
}
