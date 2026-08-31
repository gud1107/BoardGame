"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RevealOverlay, { SeatHud } from "./MineOfOblivionEffects";
import { useCountdown } from "./useCountdown";
import {
  armedMineOwnersAt,
  BOARD_COLS,
  BOARD_ROWS,
  canPlaceMine,
  MINES_PER_PLAYER,
  ownArmedMines,
  orthogonalNeighbors,
  otherSeat,
  publiclyDisarmedTiles,
  START_TILE,
  TREASURE_TILES,
  TURN_CAP,
  type EngineAction,
  type MineOfOblivionState,
  type Seat,
  type TileId,
} from "./engine";

/** Minimum on-screen hold for the REVEAL_STEP overlay — the task brief's "연출 최소 3초 유지" requirement. */
const REVEAL_SECONDS = 3;

export interface MineOfOblivionBoardProps {
  state: MineOfOblivionState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
}

/** Tile a fair viewer of `viewerSeat` may render danger/safety info for — own armed mines, or a tile that seat's own one-time radar charge already checked. Anything else stays visually blank, even though the full mine layout technically sits inside `state` (see engine.ts's info-fairness note). */
function knownTileStatus(state: MineOfOblivionState, viewerSeat: Seat, tile: TileId): "own-mine" | "radar-mine" | "radar-safe" | null {
  if (ownArmedMines(state, viewerSeat).includes(tile)) return "own-mine";
  if (state.players[viewerSeat].radarRevealed.includes(tile)) {
    return armedMineOwnersAt(state, tile).length > 0 ? "radar-mine" : "radar-safe";
  }
  return null;
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
              <span className="text-sm font-bold text-amber-200">💎 {state.players[seat].treasureCount}</span>
              <span className="text-xs text-rose-300">💥 {state.players[seat].mineHitsTaken}</span>
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
  const [radarMode, setRadarMode] = useState(false);

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
      case "safe":
        engine.playSafeStepChime();
        break;
      case "radar-mine":
      case "radar-safe":
        engine.playRadarPing();
        break;
    }
  }, [state.phase, state.actionsPlayed, state.lastEvent]);

  // Reset the local mine-selection/radar-mode UI state the instant the
  // engine phase moves past where they're meaningful — React's documented
  // "adjusting state when a prop changes" pattern (compared during render,
  // not inside an effect), same idiom `useCountdown.ts` in this same folder
  // uses for its own resetKey.
  const [prevPhase, setPrevPhase] = useState(state.phase);
  if (state.phase !== prevPhase) {
    setPrevPhase(state.phase);
    if (state.phase !== "SETUP_MINE" && selectedMines.length > 0) setSelectedMines([]);
    if (state.phase !== "PLAYER_MOVE" && radarMode) setRadarMode(false);
  }

  const myPos = state.players[viewerSeat].position;
  const reachable = new Set(isMyTurn ? orthogonalNeighbors(myPos) : []);

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
    if (radarMode) {
      onAction({ type: "USE_RADAR_ITEM", seat: viewerSeat, tile });
      setRadarMode(false);
    } else {
      onAction({ type: "SELECT_TILE_STEP", seat: viewerSeat, tile });
    }
  }

  const disarmedTiles = new Set(publiclyDisarmedTiles(state));

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
          ? radarMode
            ? "🔭 정찰할 인접 칸을 선택하세요"
            : "내 차례 · 이동할 인접 칸을 선택하세요"
          : `${names[opponentSeat]}님의 차례`;

  return (
    <div className="flex w-full flex-col gap-2 sm:gap-3">
      <SeatHud
        seat={opponentSeat}
        name={names[opponentSeat]}
        treasureCount={state.players[opponentSeat].treasureCount}
        mineHitsTaken={state.players[opponentSeat].mineHitsTaken}
        isActive={state.phase === "PLAYER_MOVE" && state.activeSeat === opponentSeat}
        connected={opponentConnected}
      />

      <div className="mx-auto grid w-full max-w-md grid-cols-5 gap-1 rounded-xl border border-white/10 bg-black/30 p-1.5 sm:gap-1.5 sm:p-2">
        {BOARD_ROWS.flatMap((row) =>
          BOARD_COLS.map((col) => {
            const tile = `${col}${row}`;
            const isTreasureTile = TREASURE_TILES.includes(tile);
            const treasure = state.treasures.find((t) => t.tileId === tile);
            const isP1Here = state.players.p1.position === tile;
            const isP2Here = state.players.p2.position === tile;
            const isReachable = reachable.has(tile);
            const isMineSelectable = state.phase === "SETUP_MINE" && !iAmReady && canPlaceMine(viewerSeat, tile);
            const isMineForbidden = state.phase === "SETUP_MINE" && !canPlaceMine(viewerSeat, tile);
            const isSelectedMine = selectedMines.includes(tile);
            const status = state.phase !== "SETUP_MINE" ? knownTileStatus(state, viewerSeat, tile) : null;
            const isDisarmed = disarmedTiles.has(tile);
            const isStart = tile === START_TILE.p1 || tile === START_TILE.p2;

            const clickable = state.phase === "SETUP_MINE" ? isMineSelectable : isReachable;

            return (
              <button
                key={tile}
                type="button"
                disabled={!clickable}
                onClick={() => handleTileTap(tile)}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-md border text-[9px] font-medium transition sm:text-[10px] ${
                  isSelectedMine
                    ? "border-rose-400 bg-rose-500/25 ring-2 ring-rose-400/70"
                    : isReachable
                      ? `moo-tile-highlight-pulse border-cyan-300/70 ${radarMode ? "bg-cyan-400/10" : "bg-cyan-400/5"}`
                      : isMineForbidden
                        ? "border-white/5 bg-white/[0.01] opacity-40"
                        : "border-white/10 bg-white/[0.03]"
                } ${clickable ? "cursor-pointer active:scale-95" : "cursor-default"}`}
              >
                <span className="absolute left-0.5 top-0.5 text-white/20">{tile}</span>
                {isStart && <span className="absolute right-0.5 top-0.5 text-white/25">🚩</span>}

                {isTreasureTile && treasure?.holder === null && <span className="text-lg sm:text-xl">💎</span>}
                {isTreasureTile && treasure?.holder !== null && <span className="text-sm text-white/15 sm:text-base">◌</span>}

                {isDisarmed && <span className="absolute bottom-0.5 left-0.5 text-[10px]" title="폭발한 지뢰 · 이제 안전">🕳️</span>}
                {status === "own-mine" && <span className="absolute bottom-0.5 right-0.5 text-[10px]" title="내가 묻은 지뢰">🔴</span>}
                {status === "radar-mine" && <span className="absolute bottom-0.5 right-0.5 text-[10px]" title="정찰: 지뢰 감지">📡🔴</span>}
                {status === "radar-safe" && <span className="absolute bottom-0.5 right-0.5 text-[10px]" title="정찰: 안전 확인">📡🟢</span>}

                <div className="mt-3 flex gap-0.5">
                  {isP1Here && (
                    <div className={`rounded-full ${viewerSeat === "p1" ? "ring-2 ring-rose-400" : "ring-1 ring-rose-400/50"}`}>
                      <Avatar size={16} />
                    </div>
                  )}
                  {isP2Here && (
                    <div className={`rounded-full ${viewerSeat === "p2" ? "ring-2 ring-fuchsia-400" : "ring-1 ring-fuchsia-400/50"}`}>
                      <Avatar size={16} />
                    </div>
                  )}
                </div>
              </button>
            );
          }),
        )}
      </div>

      <SeatHud
        seat={viewerSeat}
        name={`${names[viewerSeat]} (나)`}
        treasureCount={state.players[viewerSeat].treasureCount}
        mineHitsTaken={state.players[viewerSeat].mineHitsTaken}
        isActive={isMyTurn}
        connected
      />

      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className={`text-xs ${isMyTurn ? "text-rose-300" : "text-white/50"}`}>{statusText}</span>
        {state.phase === "PLAYER_MOVE" && (
          <span className="text-[10px] text-white/30">
            턴 {state.actionsPlayed}/{TURN_CAP}
          </span>
        )}
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

      {isMyTurn && state.phase === "PLAYER_MOVE" && !state.players[viewerSeat].radarUsed && (
        <button
          type="button"
          onClick={() => setRadarMode((v) => !v)}
          className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
            radarMode ? "border-cyan-400 bg-cyan-400/15 text-cyan-200" : "border-white/15 text-white/70 hover:border-white/30"
          }`}
        >
          🔭 정찰 {radarMode ? "(선택 중 · 다시 눌러 취소)" : "사용 (게임당 1회)"}
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
