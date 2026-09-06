"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import ChessPawn from "./ChessPawn";
import RevealOverlay, { BombTickBadge, SeatHud } from "./MineOfOblivion2Effects";
import { useCountdown } from "./useCountdown";
import {
  BOARD_COLS,
  BOARD_ROWS,
  blastZone,
  canPlaceHazard,
  eightDirectionNeighbors,
  isSafeZoneTile,
  MINES_PER_PLAYER,
  otherSeat,
  ownArmedMines,
  ownArmedTimeBombs,
  publiclyDisarmedTiles,
  publiclyExplodedBombTiles,
  TIME_BOMBS_PER_PLAYER,
  TIME_BOMB_FUSE_OPTIONS,
  TREASURE_TILES,
  type BombPlacement,
  type EngineAction,
  type MineOfOblivion2State,
  type Seat,
  type TileId,
  type TimeBombFuse,
} from "./engine";

/** Minimum on-screen hold for the REVEAL_STEP overlay. */
const REVEAL_SECONDS = 3;

const CELL_PX = 34;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.15;

export interface MineOfOblivion2BoardProps {
  state: MineOfOblivion2State;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
}

function countColor(n: number): string {
  if (n <= 0) return "text-white/25";
  if (n === 1) return "text-cyan-300";
  if (n === 2) return "text-emerald-300";
  if (n === 3) return "text-amber-300";
  return "text-rose-400";
}

function ResultModal({ state, names, viewerSeat, onLeave, onRematch }: { state: MineOfOblivion2State; names: Record<Seat, string>; viewerSeat: Seat; onLeave: () => void; onRematch: () => void }) {
  const iWon = state.winner === viewerSeat;
  return (
    <div className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/85 p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a0e05] via-[#120a04] to-black p-6 text-center">
        <span className="text-5xl">{state.isDraw ? "🤝" : iWon ? "🏆" : "💀"}</span>
        <h2 className="text-xl font-black text-white break-keep">{state.isDraw ? "무승부" : `${names[state.winner as Seat]}님 최종 승리`}</h2>
        <div className="flex w-full items-center justify-center gap-6">
          {(["p1", "p2"] as const).map((seat) => (
            <div key={seat} className="flex flex-col items-center gap-1">
              <Avatar size={36} className={seat === state.winner ? "ring-2 ring-amber-300/80" : undefined} />
              <span className="text-xs text-white/70 break-keep">
                {names[seat]}
                {seat === viewerSeat && <span className="text-emerald-300"> (나)</span>}
              </span>
              <span className={`text-sm font-black ${state.players[seat].score < 0 ? "text-rose-300" : "text-amber-200"}`}>🏅 {state.players[seat].score}점</span>
              <span className="text-xs text-cyan-200">💎 {state.players[seat].treasuresClaimed}/3</span>
              <span className="text-xs text-rose-300/80">💥 {state.players[seat].mineHitsTaken}</span>
              <span className="text-xs text-orange-300/80">🧨 {state.players[seat].bombHitsTaken}</span>
              <span className="text-xs text-emerald-300/80">🛡️ {state.players[seat].bombsSafelyDetonated}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex w-full gap-2">
          <button onClick={onLeave} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
            나가기
          </button>
          <button onClick={onRematch} className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-400">
            🔁 재대결
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MineOfOblivion2Board({ state, viewerSeat, names, opponentConnected, onAction, onLeave, onRematch }: MineOfOblivion2BoardProps) {
  const opponentSeat = otherSeat(viewerSeat);
  const [selectedMines, setSelectedMines] = useState<TileId[]>([]);
  const [selectedBombs, setSelectedBombs] = useState<BombPlacement[]>([]);
  const [placeMode, setPlaceMode] = useState<"mine" | "bomb">("mine");
  const [pendingFuse, setPendingFuse] = useState<TimeBombFuse>(4);
  const [zoom, setZoom] = useState(1);

  const iAmReady = state.mineReady[viewerSeat];
  const opponentReady = state.mineReady[opponentSeat];
  const isMyTurn = state.phase === "PLAYER_MOVE" && state.activeSeat === viewerSeat;

  const { timeLeft } = useCountdown(REVEAL_SECONDS, state.actionsPlayed, state.phase === "REVEAL_STEP");

  // Non-blocking "+N" score cue for a plain land reveal — mirrors 1편's
  // 2026-09-01 popup-removal follow-up. A mine hit, treasure claim, or ANY
  // time-bomb detonation this move still routes through the full-screen
  // RevealOverlay below.
  const [floatingReveal, setFloatingReveal] = useState<{ tile: TileId; scoreGained: number; nonce: number } | null>(null);
  const [lastFloatFor, setLastFloatFor] = useState(-1);
  if (
    state.lastEvent?.kind === "reveal" &&
    !state.lastEvent.alreadyVisited &&
    (state.lastEvent.scoreGained ?? 0) > 0 &&
    state.lastBombEvents.length === 0 &&
    lastFloatFor !== state.actionsPlayed
  ) {
    setLastFloatFor(state.actionsPlayed);
    setFloatingReveal({ tile: state.lastEvent.tile, scoreGained: state.lastEvent.scoreGained ?? 0, nonce: state.actionsPlayed });
  }

  useEffect(() => {
    if (!floatingReveal) return;
    const id = setTimeout(() => setFloatingReveal(null), 1100);
    return () => clearTimeout(id);
  }, [floatingReveal]);

  // SFX — exactly once per resolved move, keyed to actionsPlayed.
  const lastPlayedForRef = useRef<number>(-1);
  useEffect(() => {
    if (!state.lastEvent) return;
    if (lastPlayedForRef.current === state.actionsPlayed) return;
    lastPlayedForRef.current = state.actionsPlayed;
    const engine = getSoundEngine();
    if (state.lastBombEvents.length > 0) {
      engine.playTimeBombBlast();
    } else {
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
    }
  }, [state.actionsPlayed, state.lastEvent, state.lastBombEvents]);

  // Soft tick-tock cue for the viewer's own bombs once their fuse gets low (≤2) — plays at most once per move.
  const lastTickForRef = useRef<number>(-1);
  useEffect(() => {
    if (lastTickForRef.current === state.actionsPlayed) return;
    const urgentOwn = ownArmedTimeBombs(state, viewerSeat).some((b) => b.remaining <= 2);
    if (!urgentOwn) return;
    lastTickForRef.current = state.actionsPlayed;
    getSoundEngine().playBombTick();
  }, [state, viewerSeat]);

  const [prevPhase, setPrevPhase] = useState(state.phase);
  if (state.phase !== prevPhase) {
    setPrevPhase(state.phase);
    if (state.phase !== "SETUP_MINE") {
      if (selectedMines.length > 0) setSelectedMines([]);
      if (selectedBombs.length > 0) setSelectedBombs([]);
    }
  }

  const myPos = state.players[viewerSeat].position;
  const reachable = new Set(isMyTurn ? eightDirectionNeighbors(myPos).filter((t) => state.players[opponentSeat].position !== t) : []);

  const occupiedSetupTiles = new Set([...selectedMines, ...selectedBombs.map((b) => b.tile)]);

  function toggleMineTile(tile: TileId) {
    if (state.phase !== "SETUP_MINE" || iAmReady) return;
    if (!canPlaceHazard(viewerSeat, tile)) return;
    setSelectedMines((prev) => {
      if (prev.includes(tile)) return prev.filter((t) => t !== tile);
      if (occupiedSetupTiles.has(tile) || prev.length >= MINES_PER_PLAYER) return prev;
      return [...prev, tile];
    });
  }

  function toggleBombTile(tile: TileId) {
    if (state.phase !== "SETUP_MINE" || iAmReady) return;
    if (!canPlaceHazard(viewerSeat, tile)) return;
    setSelectedBombs((prev) => {
      if (prev.some((b) => b.tile === tile)) return prev.filter((b) => b.tile !== tile);
      if (occupiedSetupTiles.has(tile) || prev.length >= TIME_BOMBS_PER_PLAYER) return prev;
      return [...prev, { tile, fuseTurns: pendingFuse }];
    });
  }

  function confirmSetup() {
    if (selectedMines.length !== MINES_PER_PLAYER || selectedBombs.length !== TIME_BOMBS_PER_PLAYER) return;
    getSoundEngine().playMineBury();
    onAction({ type: "SET_SETUP", seat: viewerSeat, mines: selectedMines, bombs: selectedBombs });
  }

  function handleTileTap(tile: TileId) {
    if (state.phase === "SETUP_MINE") {
      if (placeMode === "mine") toggleMineTile(tile);
      else toggleBombTile(tile);
      return;
    }
    if (!isMyTurn || !reachable.has(tile)) return;
    onAction({ type: "SELECT_TILE_STEP", seat: viewerSeat, tile });
  }

  const disarmedTiles = new Set(publiclyDisarmedTiles(state));
  const explodedBombTiles = new Set(publiclyExplodedBombTiles(state));
  const myArmedMines = new Set(ownArmedMines(state, viewerSeat));
  const myArmedBombs = ownArmedTimeBombs(state, viewerSeat);
  const myBombByTile = new Map(myArmedBombs.map((b) => [b.tile, b] as const));
  // "위험 반경(Danger Zone) 가이드라인" — every tile inside the blast radius of any of the viewer's OWN still-armed bombs (opponent's bombs stay fully secret, see engine.ts).
  const myDangerZone = new Set(myArmedBombs.flatMap((b) => blastZone(b.tile)));

  const statusText =
    state.phase === "SETUP_MINE"
      ? iAmReady
        ? opponentReady
          ? "매설 완료 · 시작합니다..."
          : `상대(${names[opponentSeat]})가 매설하는 중...`
        : placeMode === "mine"
          ? `일반 지뢰 ${selectedMines.length}/${MINES_PER_PLAYER}개 배치 중 (탭해서 배치/해제)`
          : `시한폭탄 ${selectedBombs.length}/${TIME_BOMBS_PER_PLAYER}개 배치 중 · 퓨즈 ${pendingFuse}턴`
      : state.phase === "GAME_OVER"
        ? "게임 종료"
        : isMyTurn
          ? "내 차례 · 이동할 인접 칸(8방향)을 선택하세요"
          : `${names[opponentSeat]}님의 차례`;

  const gridColPx = CELL_PX * zoom;
  const gutterPx = 22 * zoom;

  return (
    <div className="flex w-full flex-col gap-2 sm:gap-3">
      <MyTurnOverlay isMyTurn={isMyTurn} />

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
      />

      {state.phase === "SETUP_MINE" && !iAmReady && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setPlaceMode("mine")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${placeMode === "mine" ? "bg-rose-500 text-white" : "border border-white/10 text-white/60"}`}
            >
              💣 일반 지뢰 ({selectedMines.length}/{MINES_PER_PLAYER})
            </button>
            <button
              type="button"
              onClick={() => setPlaceMode("bomb")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${placeMode === "bomb" ? "bg-orange-500 text-white" : "border border-white/10 text-white/60"}`}
            >
              🧨 시한폭탄 ({selectedBombs.length}/{TIME_BOMBS_PER_PLAYER})
            </button>
          </div>
          {placeMode === "bomb" && (
            <div className="flex items-center gap-1.5 text-xs text-white/60">
              <span className="break-keep">다음 폭탄 퓨즈:</span>
              {TIME_BOMB_FUSE_OPTIONS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPendingFuse(f)}
                  className={`rounded-full px-2.5 py-1 font-bold transition ${pendingFuse === f ? "bg-amber-400 text-black" : "border border-white/15 text-white/60"}`}
                >
                  {f}턴
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="relative mx-auto w-full max-w-2xl">
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
                selectedBombTiles={new Set(selectedBombs.map((b) => b.tile))}
                disarmedTiles={disarmedTiles}
                explodedBombTiles={explodedBombTiles}
                myArmedMines={myArmedMines}
                myBombByTile={myBombByTile}
                myDangerZone={myDangerZone}
                iAmReady={iAmReady}
                onTap={handleTileTap}
                floatingReveal={floatingReveal}
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
        bombHitsTaken={state.players[viewerSeat].bombHitsTaken}
        bombsSafelyDetonated={state.players[viewerSeat].bombsSafelyDetonated}
        isActive={isMyTurn}
        connected
      />

      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className={`text-xs break-keep ${isMyTurn ? "text-orange-300" : "text-white/50"}`}>{statusText}</span>
        {state.phase !== "SETUP_MINE" && <span className="text-[10px] text-white/30">보물 {state.treasureClaimCount}/3 획득됨</span>}
      </div>

      {state.phase === "SETUP_MINE" && !iAmReady && (
        <button
          type="button"
          disabled={selectedMines.length !== MINES_PER_PLAYER || selectedBombs.length !== TIME_BOMBS_PER_PLAYER}
          onClick={confirmSetup}
          className="rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-30"
        >
          💣🧨 매설 확정 (지뢰 {selectedMines.length}/{MINES_PER_PLAYER} · 폭탄 {selectedBombs.length}/{TIME_BOMBS_PER_PLAYER})
        </button>
      )}

      {state.phase === "REVEAL_STEP" &&
        state.lastEvent &&
        typeof document !== "undefined" &&
        createPortal(
          <RevealOverlay
            event={state.lastEvent}
            bombEvents={state.lastBombEvents}
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
        const clickable = state.phase === "SETUP_MINE" ? isHazardSelectable : isReachable;
        const isFloatingHere = floatingReveal?.tile === tile;

        return (
          <button
            key={tile}
            type="button"
            disabled={!clickable}
            onClick={() => onTap(tile)}
            className={`relative flex flex-col items-center justify-center border text-[9px] font-medium transition ${
              isSelectedMine
                ? "border-rose-400 bg-rose-500/25 ring-2 ring-rose-400/70"
                : isSelectedBomb
                  ? "border-amber-400 bg-amber-500/25 ring-2 ring-amber-400/70"
                  : isReachable
                    ? "moo2-tile-highlight-pulse border-emerald-300/70 bg-emerald-400/10"
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
