"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RevealOverlay, { SeatHud } from "./MineOfOblivion2Effects";
import MineOfOblivion2Grid from "./MineOfOblivion2Grid";
import MineOfOblivion2MobileBoard from "./MineOfOblivion2MobileBoard";
import { useCountdown } from "./useCountdown";
import { useIsMobile } from "./useIsMobile";
import {
  blastZone,
  canPlaceHazard,
  eightDirectionNeighbors,
  MINES_PER_PLAYER,
  otherSeat,
  ownArmedMines,
  ownArmedTimeBombs,
  publiclyDisarmedTiles,
  publiclyExplodedBombTiles,
  TIME_BOMBS_PER_PLAYER,
  TIME_BOMB_FUSE_OPTIONS,
  type BombPlacement,
  type EngineAction,
  type MineOfOblivion2State,
  type Seat,
  type TileId,
  type TimeBombFuse,
} from "./engine";

/** Minimum on-screen hold for the REVEAL_STEP overlay. */
const REVEAL_SECONDS = 3;

export interface MineOfOblivion2BoardProps {
  state: MineOfOblivion2State;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
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
  const isMobile = useIsMobile();

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

  const selectedBombTiles = new Set(selectedBombs.map((b) => b.tile));

  return (
    <div className="flex w-full flex-col gap-2 sm:gap-3">
      <MyTurnOverlay isMyTurn={isMyTurn} />

      {isMobile ? (
        <MineOfOblivion2MobileBoard
          state={state}
          viewerSeat={viewerSeat}
          opponentSeat={opponentSeat}
          names={names}
          opponentConnected={opponentConnected}
          iAmReady={iAmReady}
          opponentReady={opponentReady}
          isMyTurn={isMyTurn}
          statusText={statusText}
          placeMode={placeMode}
          setPlaceMode={setPlaceMode}
          pendingFuse={pendingFuse}
          setPendingFuse={setPendingFuse}
          selectedMines={selectedMines}
          selectedBombs={selectedBombs}
          confirmSetup={confirmSetup}
          reachable={reachable}
          disarmedTiles={disarmedTiles}
          explodedBombTiles={explodedBombTiles}
          myArmedMines={myArmedMines}
          myBombByTile={myBombByTile}
          myDangerZone={myDangerZone}
          onTap={handleTileTap}
          floatingReveal={floatingReveal}
        />
      ) : (
        <>
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

          <MineOfOblivion2Grid
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
            onTap={handleTileTap}
            floatingReveal={floatingReveal}
            variant="desktop"
          />

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
        </>
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
