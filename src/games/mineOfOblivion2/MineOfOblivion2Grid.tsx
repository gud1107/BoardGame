"use client";

import { useState } from "react";
import ChessPawn from "./ChessPawn";
import { BombTickBadge } from "./MineOfOblivion2Effects";
import { BOARD_COLS, BOARD_ROWS, canPlaceHazard, isSafeZoneTile, TREASURE_TILES, type MineOfOblivion2State, type Seat, type TileId } from "./engine";

/**
 * The interactive 11×11 grid itself (zoom controls + pannable/scrollable
 * viewport + per-tile rendering) — extracted out of `MineOfOblivion2Board.tsx`
 * so the exact same tap-to-move/tap-to-place logic and tile art can be reused
 * by both the desktop tree and the new mobile compact tree
 * (`MineOfOblivion2MobileBoard.tsx`, 2026-09-07 모바일 제로 스크롤 레이아웃 요청)
 * without duplicating it. Only the surrounding *frame* differs between the
 * two: desktop gets a wide `max-h-[62vh]` scroll box, mobile gets a fixed
 * `aspect-square` box clipped to `min(vw, dvh)` so it can never push the page
 * into vertical scroll — confirmed with the user (AskUserQuestion) that
 * zoom/pan stays available *inside* that fixed box rather than being removed,
 * since 121 cells at a fully-visible size would otherwise be unreadably tiny
 * on a phone.
 */

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.15;

function countColor(n: number): string {
  if (n <= 0) return "text-white/25";
  if (n === 1) return "text-cyan-300";
  if (n === 2) return "text-emerald-300";
  if (n === 3) return "text-amber-300";
  return "text-rose-400";
}

export interface MineOfOblivion2GridProps {
  state: MineOfOblivion2State;
  viewerSeat: Seat;
  reachable: Set<TileId>;
  selectedMines: TileId[];
  selectedBombTiles: Set<TileId>;
  disarmedTiles: Set<TileId>;
  explodedBombTiles: Set<TileId>;
  myArmedMines: Set<TileId>;
  myBombByTile: Map<TileId, { remaining: number }>;
  myDangerZone: Set<TileId>;
  iAmReady: boolean;
  /** Whether it's the viewer's own PLAYER_MOVE turn — lets a tile holding one of the viewer's own still-armed bombs stay tappable (for remote detonation) even when it isn't currently adjacent/reachable. Defaults to false so existing callers that don't yet pass it keep today's reachable-only behavior. */
  isMyTurn?: boolean;
  onTap: (tile: TileId) => void;
  floatingReveal: { tile: TileId; scoreGained: number; nonce: number } | null;
  /** "desktop" = current wide scroll box (unchanged). "mobile" = fixed aspect-square clipped frame. */
  variant: "desktop" | "mobile";
  /** Base cell size in px at zoom=1. Mobile starts a bit smaller so the initial view roughly fills its fixed frame without needing to pan first. */
  cellPx?: number;
  defaultZoom?: number;
}

export default function MineOfOblivion2Grid({
  state,
  viewerSeat,
  reachable,
  selectedMines,
  selectedBombTiles,
  disarmedTiles,
  explodedBombTiles,
  myArmedMines,
  myBombByTile,
  myDangerZone,
  iAmReady,
  isMyTurn = false,
  onTap,
  floatingReveal,
  variant,
  cellPx = 34,
  defaultZoom = 1,
}: MineOfOblivion2GridProps) {
  const [zoom, setZoom] = useState(defaultZoom);
  const gridColPx = cellPx * zoom;
  const gutterPx = 22 * zoom;

  const frameClassName =
    variant === "mobile"
      ? "relative mx-auto aspect-square w-[min(88vw,42dvh)]"
      : "relative mx-auto w-full max-w-2xl";
  const scrollBoxClassName =
    variant === "mobile"
      ? "h-full w-full overflow-auto rounded-xl border border-white/10 bg-black/40 p-1"
      : "max-h-[62vh] w-full overflow-auto rounded-xl border border-white/10 bg-black/40 p-1.5";
  const zoomBtnSizeClassName = variant === "mobile" ? "h-6 w-6 text-xs" : "h-7 w-7 text-sm";

  return (
    <div className={frameClassName}>
      <div className="absolute right-1 top-1 z-10 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
          className={`flex items-center justify-center rounded-md border border-white/15 bg-black/70 text-white/80 backdrop-blur active:scale-90 ${zoomBtnSizeClassName}`}
          aria-label="확대"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
          className={`flex items-center justify-center rounded-md border border-white/15 bg-black/70 text-white/80 backdrop-blur active:scale-90 ${zoomBtnSizeClassName}`}
          aria-label="축소"
        >
          −
        </button>
      </div>

      <div className={scrollBoxClassName} style={{ touchAction: "pan-x pan-y" }}>
        <div className="grid" style={{ gridTemplateColumns: `${gutterPx}px repeat(${BOARD_COLS.length}, ${gridColPx}px)`, width: "max-content" }}>
          <div className="sticky left-0 top-0 z-[2] bg-black/40" />
          {BOARD_COLS.map((col) => (
            <div key={`h-${col}`} className="sticky top-0 z-[1] flex items-center justify-center bg-black/60 text-[10px] font-semibold text-white/40" style={{ height: gutterPx }}>
              {col}
            </div>
          ))}

          {BOARD_ROWS.map((row) => (
            <RowCells
              key={row}
              row={row}
              gridColPx={gridColPx}
              state={state}
              viewerSeat={viewerSeat}
              reachable={reachable}
              selectedMines={selectedMines}
              selectedBombTiles={selectedBombTiles}
              disarmedTiles={disarmedTiles}
              explodedBombTiles={explodedBombTiles}
              myArmedMines={myArmedMines}
              myBombByTile={myBombByTile}
              myDangerZone={myDangerZone}
              iAmReady={iAmReady}
              isMyTurn={isMyTurn}
              onTap={onTap}
              floatingReveal={floatingReveal}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RowCells({
  row,
  gridColPx,
  state,
  viewerSeat,
  reachable,
  selectedMines,
  selectedBombTiles,
  disarmedTiles,
  explodedBombTiles,
  myArmedMines,
  myBombByTile,
  myDangerZone,
  iAmReady,
  isMyTurn,
  onTap,
  floatingReveal,
}: {
  row: number;
  gridColPx: number;
  state: MineOfOblivion2State;
  viewerSeat: Seat;
  reachable: Set<TileId>;
  selectedMines: TileId[];
  selectedBombTiles: Set<TileId>;
  disarmedTiles: Set<TileId>;
  explodedBombTiles: Set<TileId>;
  myArmedMines: Set<TileId>;
  myBombByTile: Map<TileId, { remaining: number }>;
  myDangerZone: Set<TileId>;
  iAmReady: boolean;
  isMyTurn: boolean;
  onTap: (tile: TileId) => void;
  floatingReveal: { tile: TileId; scoreGained: number; nonce: number } | null;
}) {
  return (
    <>
      <div className="sticky left-0 z-[1] flex items-center justify-center bg-black/60 text-[10px] font-semibold text-white/40" style={{ height: gridColPx }}>
        {row}
      </div>
      {BOARD_COLS.map((col) => {
        const tile = `${col}${row}`;
        const isTreasureTile = TREASURE_TILES.includes(tile);
        const treasure = state.treasures.find((t) => t.tileId === tile);
        const isP1Here = state.players.p1.position === tile;
        const isP2Here = state.players.p2.position === tile;
        const isReachable = reachable.has(tile);
        const isHazardSelectable = state.phase === "SETUP_MINE" && !iAmReady && canPlaceHazard(viewerSeat, tile);
        const isHazardForbidden = state.phase === "SETUP_MINE" && !canPlaceHazard(viewerSeat, tile);
        const isSelectedMine = selectedMines.includes(tile);
        const isSelectedBomb = selectedBombTiles.has(tile);
        const isVisited = state.visitedTiles.includes(tile);
        const revealedCount = state.revealedCounts[tile];
        const isDisarmed = disarmedTiles.has(tile);
        const isExplodedBombGround = explodedBombTiles.has(tile);
        const isMyMine = myArmedMines.has(tile);
        const myBomb = myBombByTile.get(tile);
        const isInMyDangerZone = myDangerZone.has(tile) && !myBomb;
        const isSafeZone = isSafeZoneTile(tile);
        // A tile holding one of the viewer's OWN still-armed bombs stays tappable on
        // their own turn regardless of adjacency — remote detonation works anywhere
        // on the board (engine.ts module doc #5).
        const isMyBombTappable = !!myBomb && isMyTurn;
        const clickable = state.phase === "SETUP_MINE" ? isHazardSelectable : isReachable || isMyBombTappable;
        const isFloatingHere = floatingReveal?.tile === tile;

        return (
          <button
            key={tile}
            type="button"
            data-tile={tile}
            disabled={!clickable}
            onClick={() => onTap(tile)}
            className={`relative flex flex-col items-center justify-center border text-[9px] font-medium transition ${
              isSelectedMine
                ? "border-rose-400 bg-rose-500/25 ring-2 ring-rose-400/70"
                : isSelectedBomb
                  ? "border-amber-400 bg-amber-500/25 ring-2 ring-amber-400/70"
                  : isReachable
                    ? "moo2-tile-highlight-pulse border-emerald-300/70 bg-emerald-400/10"
                    : isMyBombTappable
                      ? "border-amber-400/70 bg-amber-500/10 ring-1 ring-amber-400/50"
                      : isSafeZone
                      ? "moo2-safezone-aura border-amber-300/60 bg-gradient-to-br from-emerald-400/15 via-amber-300/10 to-emerald-400/15"
                      : isInMyDangerZone
                        ? "moo2-danger-zone-pulse border-orange-400/50 bg-orange-500/5"
                        : isHazardForbidden
                          ? "border-white/5 bg-white/[0.01] opacity-40"
                          : isVisited
                            ? "border-white/10 bg-white/[0.06]"
                            : "border-white/10 bg-white/[0.03]"
            } ${clickable ? "cursor-pointer active:scale-95" : "cursor-default"}`}
            style={{ width: gridColPx, height: gridColPx }}
          >
            {isSafeZone && <span className="absolute left-0.5 top-0.5 text-[9px] drop-shadow-[0_0_3px_rgba(52,211,153,0.8)]" title="안전구역 · 매설 불가">🛡️</span>}
            {isHazardForbidden && !isSafeZone && <span className="absolute right-0.5 top-0.5 text-[9px] text-rose-400" title="상대/본인이 점유한 칸 · 매설 불가">🚫</span>}

            {isTreasureTile && treasure?.holder === null && <span className="text-base sm:text-lg">💎</span>}
            {isTreasureTile && treasure?.holder !== null && (
              <span className="flex flex-col items-center leading-none">
                <span className="text-xs text-white/15 sm:text-sm">◌</span>
                <span className="text-[7px] text-amber-300/70">+{treasure?.points}</span>
              </span>
            )}

            {!isTreasureTile && isVisited && revealedCount !== undefined && <span className={`text-sm font-black sm:text-base ${countColor(revealedCount)}`}>{revealedCount}</span>}

            {isDisarmed && <span className="absolute bottom-0.5 left-0.5 text-[9px]" title="폭발한 지뢰 · 이제 안전">🕳️</span>}
            {isExplodedBombGround && <span className="absolute bottom-0.5 left-0.5 text-[9px]" title="시한폭탄이 폭발한 칸">🌋</span>}
            {isMyMine && state.phase !== "SETUP_MINE" && (
              <span className="absolute bottom-0.5 right-0.5 text-[9px]" title="내가 묻은 지뢰">
                🔴
              </span>
            )}

            {/* 시한폭탄 틱톡 인디케이터 — 본인 폭탄에만, 남은 카운트다운 숫자가 째깍거린다. */}
            {myBomb && state.phase !== "SETUP_MINE" && (
              <div className="absolute right-0.5 top-0.5" style={{ width: Math.max(13, gridColPx * 0.4), height: Math.max(13, gridColPx * 0.4) }}>
                <BombTickBadge remaining={myBomb.remaining} size={Math.max(13, gridColPx * 0.4)} />
              </div>
            )}

            {isP1Here && <ChessPawn seat="p1" isViewer={viewerSeat === "p1"} isActive={state.phase === "PLAYER_MOVE" && state.activeSeat === "p1"} size={Math.max(14, gridColPx * 0.62)} className="absolute bottom-0 left-1/2 -translate-x-1/2" />}
            {isP2Here && <ChessPawn seat="p2" isViewer={viewerSeat === "p2"} isActive={state.phase === "PLAYER_MOVE" && state.activeSeat === "p2"} size={Math.max(14, gridColPx * 0.62)} className="absolute bottom-0 left-1/2 -translate-x-1/2" />}

            {isFloatingHere && (
              <span
                key={`float-${tile}-${floatingReveal!.nonce}`}
                aria-hidden
                className="pointer-events-none absolute -top-1 left-1/2 z-20 -translate-x-1/2 text-sm font-black text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.9)] sm:text-base"
                style={{ animation: "moo2-score-float-up 1.1s ease-out both" }}
              >
                +{floatingReveal!.scoreGained}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
