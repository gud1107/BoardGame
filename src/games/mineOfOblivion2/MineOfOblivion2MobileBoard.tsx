"use client";

import MineOfOblivion2Grid from "./MineOfOblivion2Grid";
import { SeatHud } from "./MineOfOblivion2Effects";
import { MINES_PER_PLAYER, TIME_BOMBS_PER_PLAYER, TIME_BOMB_FUSE_OPTIONS, type BombPlacement, type MineOfOblivion2State, type Seat, type TileId, type TimeBombFuse } from "./engine";

/**
 * Mobile zero-scroll 3-tier dashboard (2026-09-07 요청) — content-sized, NOT
 * pinned to a hard `100dvh`: this renders *inside* the shared
 * `/games/[gameId]` page template (site header + game-title block + page
 * padding sit above it), so a hard 100dvh here would overflow past the real
 * viewport the same way `century/useIsMobile.ts`'s and
 * `lasVegas/CompactCasinoBoard.tsx`'s compact dashboards found and fixed —
 * see their doc comments for the concrete bug. Instead every section here is
 * tuned to a small fixed/compact size, and the grid frame itself is capped by
 * `min(vw, dvh)` (see `MineOfOblivion2Grid`'s "mobile" variant) so the whole
 * stack comfortably fits a typical phone viewport's remaining space under
 * that chrome without ever forcing page-level scroll.
 *
 * Confirmed decisions (AskUserQuestion, 2026-09-07):
 *  - Movement stays direct-tap-on-grid (8-directional, diagonals included) —
 *    no D-Pad. Adding one would either duplicate the input path or silently
 *    drop diagonal moves, which are a real rule the engine supports.
 *  - Zoom/pan (±buttons + pinch/pan) stays available, clipped inside the
 *    fixed aspect-square frame — not removed — since 121 cells at a
 *    fully-visible size would be unreadably tiny on a phone otherwise.
 */

export interface MineOfOblivion2MobileBoardProps {
  state: MineOfOblivion2State;
  viewerSeat: Seat;
  opponentSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  iAmReady: boolean;
  opponentReady: boolean;
  isMyTurn: boolean;
  statusText: string;
  placeMode: "mine" | "bomb";
  setPlaceMode: (mode: "mine" | "bomb") => void;
  pendingFuse: TimeBombFuse;
  setPendingFuse: (fuse: TimeBombFuse) => void;
  selectedMines: TileId[];
  selectedBombs: BombPlacement[];
  confirmSetup: () => void;
  reachable: Set<TileId>;
  disarmedTiles: Set<TileId>;
  explodedBombTiles: Set<TileId>;
  myArmedMines: Set<TileId>;
  myBombByTile: Map<TileId, { remaining: number }>;
  myDangerZone: Set<TileId>;
  onTap: (tile: TileId) => void;
  floatingReveal: { tile: TileId; scoreGained: number; nonce: number } | null;
  /** One-line "즉시 격발" rule reminder — null when the viewer has no live bomb to act on. */
  bombGuideText: string | null;
}

export default function MineOfOblivion2MobileBoard({
  state,
  viewerSeat,
  opponentSeat,
  names,
  opponentConnected,
  iAmReady,
  opponentReady,
  isMyTurn,
  statusText,
  placeMode,
  setPlaceMode,
  pendingFuse,
  setPendingFuse,
  selectedMines,
  selectedBombs,
  confirmSetup,
  reachable,
  disarmedTiles,
  explodedBombTiles,
  myArmedMines,
  myBombByTile,
  myDangerZone,
  onTap,
  floatingReveal,
  bombGuideText,
}: MineOfOblivion2MobileBoardProps) {
  const showSetupControls = state.phase === "SETUP_MINE" && !iAmReady;

  return (
    <div className="flex w-full max-w-[100vw] flex-col gap-1.5 overflow-x-hidden">
      {/* 상단: 상대방 상태 */}
      <SeatHud
        seat={opponentSeat}
        name={names[opponentSeat]}
        score={state.players[opponentSeat].score}
        treasuresClaimed={state.players[opponentSeat].treasuresClaimed}
        mineHitsTaken={state.players[opponentSeat].mineHitsTaken}
        bombHitsTaken={state.players[opponentSeat].bombHitsTaken}
        bombsSafelyDetonated={state.players[opponentSeat].bombsSafelyDetonated}
        isActive={state.phase === "PLAYER_MOVE" && state.activeSeat === opponentSeat}
        connected={opponentConnected}
        compact
      />

      <p className={`text-center text-[11px] break-keep ${isMyTurn ? "text-orange-300" : "text-white/50"}`}>{statusText}</p>

      {showSetupControls && (
        <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPlaceMode("mine")}
              className={`flex-1 rounded-lg py-1 text-[11px] font-semibold transition ${placeMode === "mine" ? "bg-rose-500 text-white" : "border border-white/10 text-white/60"}`}
            >
              💣 {selectedMines.length}/{MINES_PER_PLAYER}
            </button>
            <button
              type="button"
              onClick={() => setPlaceMode("bomb")}
              className={`flex-1 rounded-lg py-1 text-[11px] font-semibold transition ${placeMode === "bomb" ? "bg-orange-500 text-white" : "border border-white/10 text-white/60"}`}
            >
              🧨 {selectedBombs.length}/{TIME_BOMBS_PER_PLAYER}
            </button>
          </div>
          {placeMode === "bomb" && (
            <div className="flex items-center justify-center gap-1 text-[10px] text-white/60">
              <span className="break-keep">퓨즈:</span>
              {TIME_BOMB_FUSE_OPTIONS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPendingFuse(f)}
                  className={`rounded-full px-2 py-0.5 font-bold transition ${pendingFuse === f ? "bg-amber-400 text-black" : "border border-white/15 text-white/60"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 중앙: 정사각형 반응형 그리드 보드 */}
      <MineOfOblivion2Grid
        state={state}
        viewerSeat={viewerSeat}
        reachable={reachable}
        selectedMines={selectedMines}
        selectedBombTiles={new Set(selectedBombs.map((b) => b.tile))}
        disarmedTiles={disarmedTiles}
        explodedBombTiles={explodedBombTiles}
        myArmedMines={myArmedMines}
        myBombByTile={myBombByTile}
        myDangerZone={myDangerZone}
        iAmReady={iAmReady}
        isMyTurn={isMyTurn}
        onTap={onTap}
        floatingReveal={floatingReveal}
        variant="mobile"
        cellPx={30}
        defaultZoom={0.75}
      />

      {bombGuideText && <p className="rounded-lg border border-amber-400/15 bg-amber-400/5 px-2 py-1 text-center text-[10px] text-amber-200/80 break-keep">{bombGuideText}</p>}

      {/* 하단: 내 상태 */}
      <SeatHud
        seat={viewerSeat}
        name={`${names[viewerSeat]} (나)`}
        score={state.players[viewerSeat].score}
        treasuresClaimed={state.players[viewerSeat].treasuresClaimed}
        mineHitsTaken={state.players[viewerSeat].mineHitsTaken}
        bombHitsTaken={state.players[viewerSeat].bombHitsTaken}
        bombsSafelyDetonated={state.players[viewerSeat].bombsSafelyDetonated}
        isActive={isMyTurn}
        connected
        compact
      />

      {showSetupControls && (
        <button
          type="button"
          disabled={selectedMines.length !== MINES_PER_PLAYER || selectedBombs.length !== TIME_BOMBS_PER_PLAYER}
          onClick={confirmSetup}
          className="rounded-xl bg-orange-500 py-2 text-xs font-semibold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-30"
        >
          💣🧨 매설 확정 ({selectedMines.length}/{MINES_PER_PLAYER} · {selectedBombs.length}/{TIME_BOMBS_PER_PLAYER})
        </button>
      )}

      {!showSetupControls && state.phase !== "SETUP_MINE" && <p className="text-center text-[10px] text-white/30">보물 {state.treasureClaimCount}/3 획득됨</p>}
      {state.phase === "SETUP_MINE" && iAmReady && !opponentReady && <p className="text-center text-[10px] text-white/30">상대({names[opponentSeat]}) 매설 대기 중...</p>}
    </div>
  );
}
