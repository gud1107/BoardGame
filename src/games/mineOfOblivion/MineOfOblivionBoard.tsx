"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RevealOverlay, { SeatHud } from "./MineOfOblivionEffects";
import { useCountdown } from "./useCountdown";
import {
  BOARD_COLS,
  BOARD_ROWS,
  canPlaceMine,
  eightDirectionNeighbors,
  MINES_PER_PLAYER,
  otherSeat,
  ownArmedMines,
  publiclyDisarmedTiles,
  START_TILE,
  TREASURE_TILES,
  type EngineAction,
  type MineOfOblivionState,
  type Seat,
  type TileId,
} from "./engine";

/** Minimum on-screen hold for the REVEAL_STEP overlay — the task brief's "연출 최소 3초 유지" requirement. */
const REVEAL_SECONDS = 3;

/** Pixel size of one grid cell at zoom 1 — 11 columns × this + the row-label gutter is the board's natural width; smaller viewports pan/scroll via the wrapper's native touch scrolling, and the zoom buttons let a player shrink it further to see more of the map at once (모바일 줌·팬 요구사항). */
const CELL_PX = 34;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.15;

export interface MineOfOblivionBoardProps {
  state: MineOfOblivionState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
}

/** Number color ramp for a revealed adjacent-mine-count tile — mirrors classic minesweeper's escalating alarm, restyled for this game's dark-cyber palette. */
function countColor(n: number): string {
  if (n <= 0) return "text-white/25";
  if (n === 1) return "text-cyan-300";
  if (n === 2) return "text-emerald-300";
  if (n === 3) return "text-amber-300";
  return "text-rose-400";
}

function ResultModal({ state, names, viewerSeat, onLeave, onRematch }: { state: MineOfOblivionState; names: Record<Seat, string>; viewerSeat: Seat; onLeave: () => void; onRematch: () => void }) {
  const iWon = state.winner === viewerSeat;
  return (
    <div className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/85 p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a0a0e] via-[#12070a] to-black p-6 text-center">
        <span className="text-5xl">{state.isDraw ? "🤝" : iWon ? "🏆" : "💀"}</span>
        <h2 className="text-xl font-black text-white">{state.isDraw ? "무승부" : `${names[state.winner as Seat]}님 최종 승리`}</h2>
        <div className="flex w-full items-center justify-center gap-6">
          {(["p1", "p2"] as const).map((seat) => (
            <div key={seat} className="flex flex-col items-center gap-1">
              <Avatar size={36} className={seat === state.winner ? "ring-2 ring-amber-300/80" : undefined} />
              <span className="text-xs text-white/70">
                {names[seat]}
                {seat === viewerSeat && <span className="text-emerald-300"> (나)</span>}
              </span>
              <span className={`text-sm font-black ${state.players[seat].score < 0 ? "text-rose-300" : "text-amber-200"}`}>🏅 {state.players[seat].score}점</span>
              <span className="text-xs text-cyan-200">💎 {state.players[seat].treasuresClaimed}/3</span>
              <span className="text-xs text-rose-300/80">💥 {state.players[seat].mineHitsTaken}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex w-full gap-2">
          <button onClick={onLeave} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
            나가기
          </button>
          <button onClick={onRematch} className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-semibold text-white hover:bg-rose-400">
            🔁 재대결
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MineOfOblivionBoard({ state, viewerSeat, names, opponentConnected, onAction, onLeave, onRematch }: MineOfOblivionBoardProps) {
  const opponentSeat = otherSeat(viewerSeat);
  const [selectedMines, setSelectedMines] = useState<TileId[]>([]);
  const [zoom, setZoom] = useState(1);

  const iAmReady = state.mineReady[viewerSeat];
  const opponentReady = state.mineReady[opponentSeat];
  const isMyTurn = state.phase === "PLAYER_MOVE" && state.activeSeat === viewerSeat;

  const { timeLeft } = useCountdown(REVEAL_SECONDS, state.actionsPlayed, state.phase === "REVEAL_STEP");

  // Fire the matching SFX exactly once per REVEAL_STEP episode (keyed to
  // actionsPlayed, which only changes when a fresh reveal starts).
  const lastPlayedForRef = useRef<number>(-1);
  useEffect(() => {
    if (state.phase !== "REVEAL_STEP" || !state.lastEvent) return;
    if (lastPlayedForRef.current === state.actionsPlayed) return;
    lastPlayedForRef.current = state.actionsPlayed;
    const engine = getSoundEngine();
    switch (state.lastEvent.kind) {
      case "mine":
        engine.playMineBlast();
        break;
      case "treasure":
        engine.playTreasureGrab();
        break;
      case "reveal":
        if (!state.lastEvent.alreadyVisited) engine.playSafeStepChime();
        break;
    }
  }, [state.phase, state.actionsPlayed, state.lastEvent]);

  // Reset local mine-selection UI state the instant the engine phase moves
  // past where it's meaningful — React's documented "adjusting state when a
  // prop changes" pattern (compared during render, not inside an effect).
  const [prevPhase, setPrevPhase] = useState(state.phase);
  if (state.phase !== prevPhase) {
    setPrevPhase(state.phase);
    if (state.phase !== "SETUP_MINE" && selectedMines.length > 0) setSelectedMines([]);
  }

  const myPos = state.players[viewerSeat].position;
  const reachable = new Set(isMyTurn ? eightDirectionNeighbors(myPos).filter((t) => state.players[opponentSeat].position !== t) : []);

  function toggleMineTile(tile: TileId) {
    if (state.phase !== "SETUP_MINE" || iAmReady) return;
    if (!canPlaceMine(viewerSeat, tile)) return;
    setSelectedMines((prev) => {
      if (prev.includes(tile)) return prev.filter((t) => t !== tile);
      if (prev.length >= MINES_PER_PLAYER) return prev;
      return [...prev, tile];
    });
  }

  function confirmMines() {
    if (selectedMines.length !== MINES_PER_PLAYER) return;
    getSoundEngine().playMineBury();
    onAction({ type: "SET_MINE_POSITION", seat: viewerSeat, tiles: selectedMines });
  }

  function handleTileTap(tile: TileId) {
    if (state.phase === "SETUP_MINE") {
      toggleMineTile(tile);
      return;
    }
    if (!isMyTurn || !reachable.has(tile)) return;
    onAction({ type: "SELECT_TILE_STEP", seat: viewerSeat, tile });
  }

  const disarmedTiles = new Set(publiclyDisarmedTiles(state));
  const myArmedMines = new Set(ownArmedMines(state, viewerSeat));

  const statusText =
    state.phase === "SETUP_MINE"
      ? iAmReady
        ? opponentReady
          ? "매설 완료 · 시작합니다..."
          : `상대(${names[opponentSeat]})가 지뢰를 매설하는 중...`
        : `가림판 뒤에서 지뢰 ${MINES_PER_PLAYER}개를 배치하세요 (${selectedMines.length}/${MINES_PER_PLAYER})`
      : state.phase === "GAME_OVER"
        ? "게임 종료"
        : isMyTurn
          ? "내 차례 · 이동할 인접 칸(8방향)을 선택하세요"
          : `${names[opponentSeat]}님의 차례`;

  const gridColPx = CELL_PX * zoom;
  const gutterPx = 22 * zoom;

  return (
    <div className="flex w-full flex-col gap-2 sm:gap-3">
      <SeatHud
        seat={opponentSeat}
        name={names[opponentSeat]}
        score={state.players[opponentSeat].score}
        treasuresClaimed={state.players[opponentSeat].treasuresClaimed}
        mineHitsTaken={state.players[opponentSeat].mineHitsTaken}
        isActive={state.phase === "PLAYER_MOVE" && state.activeSeat === opponentSeat}
        connected={opponentConnected}
      />

      <div className="relative mx-auto w-full max-w-2xl">
        {/* Zoom controls — 모바일 줌 요구사항. Panning is native touch/scroll on the wrapper below. */}
        <div className="absolute right-1.5 top-1.5 z-10 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/70 text-sm text-white/80 backdrop-blur active:scale-90"
            aria-label="확대"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/70 text-sm text-white/80 backdrop-blur active:scale-90"
            aria-label="축소"
          >
            −
          </button>
        </div>

        <div className="max-h-[62vh] w-full overflow-auto rounded-xl border border-white/10 bg-black/40 p-1.5" style={{ touchAction: "pan-x pan-y" }}>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `${gutterPx}px repeat(${BOARD_COLS.length}, ${gridColPx}px)`,
              width: "max-content",
            }}
          >
            {/* Column header row (A..K) — sticky so it stays visible while panning vertically. */}
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
                disarmedTiles={disarmedTiles}
                myArmedMines={myArmedMines}
                iAmReady={iAmReady}
                onTap={handleTileTap}
              />
            ))}
          </div>
        </div>
      </div>

      <SeatHud
        seat={viewerSeat}
        name={`${names[viewerSeat]} (나)`}
        score={state.players[viewerSeat].score}
        treasuresClaimed={state.players[viewerSeat].treasuresClaimed}
        mineHitsTaken={state.players[viewerSeat].mineHitsTaken}
        isActive={isMyTurn}
        connected
      />

      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className={`text-xs ${isMyTurn ? "text-rose-300" : "text-white/50"}`}>{statusText}</span>
        {state.phase !== "SETUP_MINE" && <span className="text-[10px] text-white/30">보물 {state.treasureClaimCount}/3 획득됨</span>}
      </div>

      {state.phase === "SETUP_MINE" && !iAmReady && (
        <button
          type="button"
          disabled={selectedMines.length !== MINES_PER_PLAYER}
          onClick={confirmMines}
          className="rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-30"
        >
          💣 지뢰 매설 확정 ({selectedMines.length}/{MINES_PER_PLAYER})
        </button>
      )}

      {state.phase === "REVEAL_STEP" &&
        state.lastEvent &&
        typeof document !== "undefined" &&
        createPortal(
          <RevealOverlay
            event={state.lastEvent}
            names={names}
            viewerSeat={viewerSeat}
            isGameOver={state.pendingGameOver}
            winner={state.winner}
            isDraw={state.isDraw}
            timeLeft={timeLeft}
            secondsTotal={REVEAL_SECONDS}
            onSkip={() => onAction({ type: "READY_NEXT_ROUND" })}
          />,
          document.body,
        )}

      {state.phase === "GAME_OVER" && typeof document !== "undefined" && createPortal(<ResultModal state={state} names={names} viewerSeat={viewerSeat} onLeave={onLeave} onRematch={onRematch} />, document.body)}
    </div>
  );
}

/** One board row — split out so the big per-tile computation stays readable. */
function RowCells({
  row,
  gridColPx,
  state,
  viewerSeat,
  reachable,
  selectedMines,
  disarmedTiles,
  myArmedMines,
  iAmReady,
  onTap,
}: {
  row: number;
  gridColPx: number;
  state: MineOfOblivionState;
  viewerSeat: Seat;
  reachable: Set<TileId>;
  selectedMines: TileId[];
  disarmedTiles: Set<TileId>;
  myArmedMines: Set<TileId>;
  iAmReady: boolean;
  onTap: (tile: TileId) => void;
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
        const isMineSelectable = state.phase === "SETUP_MINE" && !iAmReady && canPlaceMine(viewerSeat, tile);
        const isMineForbidden = state.phase === "SETUP_MINE" && !canPlaceMine(viewerSeat, tile);
        const isSelectedMine = selectedMines.includes(tile);
        const isVisited = state.visitedTiles.includes(tile);
        const revealedCount = state.revealedCounts[tile];
        const isDisarmed = disarmedTiles.has(tile);
        const isMyMine = myArmedMines.has(tile);
        const isStart = tile === START_TILE.p1 || tile === START_TILE.p2;
        const clickable = state.phase === "SETUP_MINE" ? isMineSelectable : isReachable;

        return (
          <button
            key={tile}
            type="button"
            disabled={!clickable}
            onClick={() => onTap(tile)}
            className={`relative flex flex-col items-center justify-center border text-[9px] font-medium transition ${
              isSelectedMine
                ? "border-rose-400 bg-rose-500/25 ring-2 ring-rose-400/70"
                : isReachable
                  ? "moo-tile-highlight-pulse border-emerald-300/70 bg-emerald-400/10"
                  : isMineForbidden
                    ? "border-white/5 bg-white/[0.01] opacity-40"
                    : isVisited
                      ? "border-white/10 bg-white/[0.06]"
                      : "border-white/10 bg-white/[0.03]"
            } ${clickable ? "cursor-pointer active:scale-95" : "cursor-default"}`}
            style={{ width: gridColPx, height: gridColPx }}
          >
            {isStart && <span className="absolute left-0.5 top-0.5 text-[8px] text-white/25">🚩</span>}

            {isTreasureTile && treasure?.holder === null && <span className="text-base sm:text-lg">💎</span>}
            {isTreasureTile && treasure?.holder !== null && (
              <span className="flex flex-col items-center leading-none">
                <span className="text-xs text-white/15 sm:text-sm">◌</span>
                <span className="text-[7px] text-amber-300/70">+{treasure?.points}</span>
              </span>
            )}

            {!isTreasureTile && isVisited && revealedCount !== undefined && <span className={`text-sm font-black sm:text-base ${countColor(revealedCount)}`}>{revealedCount}</span>}

            {isDisarmed && <span className="absolute bottom-0.5 left-0.5 text-[9px]" title="폭발한 지뢰 · 이제 안전">🕳️</span>}
            {isMyMine && state.phase !== "SETUP_MINE" && (
              <span className="absolute bottom-0.5 right-0.5 text-[9px]" title="내가 묻은 지뢰">
                🔴
              </span>
            )}

            {(isP1Here || isP2Here) && (
              <div className="absolute -bottom-1 flex gap-0.5">
                {isP1Here && (
                  <div className={`rounded-full ${viewerSeat === "p1" ? "ring-2 ring-rose-400" : "ring-1 ring-rose-400/50"}`}>
                    <Avatar size={14} />
                  </div>
                )}
                {isP2Here && (
                  <div className={`rounded-full ${viewerSeat === "p2" ? "ring-2 ring-fuchsia-400" : "ring-1 ring-fuchsia-400/50"}`}>
                    <Avatar size={14} />
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </>
  );
}
