"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import { DieFace } from "./DieFace";
import { TileFace } from "./TileFace";
import { detectClaimFlightEvent, FlyingTile, type ClaimFlightEvent } from "./WormEffects";
import {
  computeRankings,
  ownerOfTile,
  sumKept,
  TILES,
  totalWorms,
  wormsOnTile,
  type EngineAction,
  type Face,
  type SeatIndex,
  type TurnEvent,
  type WormState,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state per the project's
 * lockstep trust model — nothing here is hidden information (unlike a card
 * hand), so every seat simply sees the same board.
 */
export interface WormBoardProps {
  state: WormState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function bustMessage(event: Extract<TurnEvent, { kind: `busted${string}` }>, names: Record<SeatIndex, string>): string {
  const who = names[event.seat] ?? "상대";
  if (event.kind === "bustedNoMoves") return `💥 ${who}님 실패! (남은 주사위로 킵할 수 있는 눈금이 없음)`;
  if (event.kind === "bustedNoWorm") return `💥 ${who}님 실패! (합계 ${event.sum} — 지렁이 주사위를 못 얻음)`;
  return `💥 ${who}님 실패! (합계 ${event.sum}에 해당하는 타일이 없음)`;
}

export default function WormBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: WormBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  // Diff consecutive lockstep snapshots to drive transient FX — same pattern
  // as five-cucumbers/NoThanks/SplendorBoard, since this component never
  // mutates state itself and the caller owns the network sync.
  const [trackedState, setTrackedState] = useState(state);
  const [eventFlash, setEventFlash] = useState<TurnEvent | null>(null);
  const [flightEvents, setFlightEvents] = useState<ClaimFlightEvent[]>([]);
  const [rollFlourish, setRollFlourish] = useState(0);

  if (trackedState !== state) {
    const newEvent = state.lastEvent !== trackedState.lastEvent ? state.lastEvent : null;
    const flight = detectClaimFlightEvent(trackedState, state);
    const rerolled = state.currentRoll.length > 0 && state.currentRoll !== trackedState.currentRoll;
    setTrackedState(state);
    if (newEvent) setEventFlash(newEvent);
    if (flight) setFlightEvents((prev) => [...prev, { ...flight, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    if (rerolled) setRollFlourish((n) => n + 1);
  }
  useEffect(() => {
    if (!eventFlash) return;
    const t = setTimeout(() => setEventFlash(null), 3200);
    return () => clearTimeout(t);
  }, [eventFlash]);
  const handleFlightDone = useCallback((id: number) => {
    setFlightEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Persistent flight source/target anchors — same Map-of-refs technique as
  // FiveCucumbersBoard's seatRowRefs/trickSlotRefs. Center slots are keyed by
  // tile number and always render a container (even once claimed/removed) so
  // a flight's source ref is never lost the instant a tile leaves the center.
  const centerSlotRefs = useRef(new Map<number, HTMLElement>());
  const stackRefs = useRef(new Map<SeatIndex, HTMLElement>());
  function setCenterSlotRef(tileNumber: number) {
    return (el: HTMLElement | null) => {
      if (el) centerSlotRefs.current.set(tileNumber, el);
      else centerSlotRefs.current.delete(tileNumber);
    };
  }
  function setStackRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) stackRefs.current.set(seat, el);
      else stackRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 지렁이 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    const tied = rankings.filter((r) => r.rank === 1).length > 1;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#1a2e05 0%,#101d03 55%,#070c01 100%)" }}
      >
        <span className="text-5xl">{tied ? "🪱" : "🏆"}</span>
        <h2 className="text-2xl font-bold text-lime-100">
          {tied ? "공동 우승!" : `${names[winner.seat]}님 승리!`}
        </h2>
        <p className="text-xs text-white/50">중앙 타일이 모두 소진되었습니다 — 지렁이 개수가 가장 많은 사람이 승리합니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[380px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">획득 지렁이</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, worms }) => (
                <tr key={seat} className={rank === 1 ? "bg-lime-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-lime-200">{rank === 1 ? "🏆 1" : rank}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-lime-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">
                    <span className="inline-flex items-center justify-end gap-1 text-lime-200">🪱 {worms}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-lime-600 px-8 py-3 font-medium text-white transition hover:bg-lime-500">
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const isMyTurn = state.activeSeat === viewerSeat;
  const usedFacesSet = new Set(state.usedFaces);
  const keptSum = sumKept(state.keptDice);
  const hasWorm = state.keptDice.includes("worm");
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  const rollGroups: [Face, number][] = [];
  {
    const groups = new Map<Face, number>();
    for (const f of state.currentRoll) groups.set(f, (groups.get(f) ?? 0) + 1);
    rollGroups.push(...groups.entries());
  }

  function handleRoll() {
    if (!isMyTurn || state.currentRoll.length > 0 || state.diceRemaining <= 0) return;
    onAction({ type: "roll", seat: viewerSeat, seed: randomSeed() });
  }
  function handleKeep(face: Face) {
    if (!isMyTurn || usedFacesSet.has(face)) return;
    onAction({ type: "keep", seat: viewerSeat, face });
  }
  function handleStop() {
    if (!isMyTurn || state.currentRoll.length > 0 || state.usedFaces.length === 0) return;
    onAction({ type: "stop", seat: viewerSeat });
  }

  const statusText = eventFlash
    ? eventFlash.kind === "claimed"
      ? `🪱 ${names[eventFlash.seat]}님이 ${eventFlash.tileNumber}번 타일을 획득했습니다!`
      : eventFlash.kind === "stolen"
        ? `🦹 ${names[eventFlash.seat]}님이 ${names[eventFlash.fromSeat]}님의 ${eventFlash.tileNumber}번 타일을 뺏었습니다!`
        : bustMessage(eventFlash, names)
    : isMyTurn
      ? state.currentRoll.length > 0
        ? "🫵 킵할 눈금을 하나 선택하세요."
        : state.usedFaces.length === 0
          ? "🫵 당신 차례입니다! 주사위 8개를 굴려주세요."
          : "🫵 계속 굴리거나 스톱을 선언하세요."
      : `${names[state.activeSeat]}님 차례를 기다리는 중...`;

  const isEventBust = eventFlash?.kind.startsWith("busted") ?? false;

  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#182a10 0%,#101c0a 45%,#060b04 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-lime-100/70">
        <span>
          {state.playerCount}인 · {state.turnNumber}번째 턴 · 남은 타일 {state.centerTiles.length}개
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      <p
        key={eventFlash ? `${eventFlash.kind}-${eventFlash.seat}-${state.turnNumber}` : "idle"}
        className={`rounded-xl border px-3 py-2 text-center text-xs font-semibold ${
          isEventBust
            ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
            : eventFlash
              ? "border-amber-300/40 bg-amber-400/10 text-amber-100"
              : isMyTurn
                ? "border-lime-300/30 bg-lime-400/10 text-lime-100"
                : "border-white/10 bg-black/20 text-white/50"
        }`}
        style={eventFlash ? { animation: "worm-bust-flash 0.4s ease-out" } : undefined}
      >
        {statusText}
      </p>

      {/* Center tiles 21-36 — a fixed 16-slot grid so flight-source refs never disappear when a tile leaves. */}
      <section className="rounded-2xl border border-white/10 bg-black/25 p-2.5">
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-lime-200/80 uppercase">🌱 중앙 타일 (21~36)</h3>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {TILES.map((t) => {
            const inCenter = state.centerTiles.includes(t.number);
            const isRemoved = state.removedTiles.includes(t.number);
            const owner = !inCenter && !isRemoved ? ownerOfTile(state, t.number) : null;
            return (
              <div key={t.number} ref={setCenterSlotRef(t.number)} className="flex justify-center">
                {inCenter ? (
                  <TileFace tileNumber={t.number} worms={t.worms} size="h-16 w-14" />
                ) : isRemoved ? (
                  <TileFace tileNumber={t.number} worms={t.worms} size="h-16 w-14" faceDown />
                ) : (
                  <div className="flex h-16 w-14 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 text-[9px] text-white/25">
                    <span>{t.number}</span>
                    <span className="mt-0.5 max-w-full truncate px-0.5">{owner !== null ? names[owner] : "?"}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Player stacks — top tile only, per rule brief. */}
      <section className="flex flex-wrap gap-1.5">
        {seatOrder.map((seat) => {
          const stack = state.stacks[seat];
          const top = stack.length > 0 ? stack[stack.length - 1] : null;
          const isActive = state.activeSeat === seat;
          const isSelf = seat === viewerSeat;
          return (
            <div
              key={seat}
              ref={setStackRef(seat)}
              className={`flex min-w-[128px] flex-1 items-center gap-2 rounded-xl border p-2 text-xs transition ${
                isActive ? "border-lime-300/60 bg-lime-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              {top !== null ? (
                <TileFace tileNumber={top} worms={wormsOnTile(top)} size="h-14 w-12" />
              ) : (
                <div className="flex h-14 w-12 items-center justify-center rounded-lg border border-dashed border-white/10 text-[9px] text-white/20">
                  없음
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 font-semibold text-white/90">
                  <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                  {isActive && <span title="차례">👉</span>}
                  {names[seat]}
                  {isSelf && <span className="text-lime-200">(나)</span>}
                </span>
                <span className="text-white/60">스택 {stack.length}장</span>
                <span className="flex items-center gap-1 font-bold text-lime-200">🪱 {totalWorms(state, seat)}</span>
              </div>
            </div>
          );
        })}
      </section>

      {/* Dice tray */}
      <section className="rounded-2xl border border-amber-300/20 p-2.5 sm:p-3" style={{ background: "linear-gradient(160deg,#2c2410 0%,#1a1608 55%,#0d0b04 100%)" }}>
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-amber-200/90 uppercase">🎲 주사위 (남은 {state.diceRemaining}개)</h3>

        {state.keptDice.length > 0 && (
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 p-2">
            <span className="mr-1 text-[10px] text-white/50">킵한 주사위:</span>
            {state.keptDice.map((f, i) => (
              <DieFace key={i} face={f} size="h-7 w-7" />
            ))}
            <span className={`ml-auto text-xs font-bold ${hasWorm ? "text-lime-300" : "text-rose-300"}`}>
              합계 {keptSum} {hasWorm ? "🪱✅" : "🪱❌"}
            </span>
          </div>
        )}

        {state.currentRoll.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {rollGroups.map(([face, count]) => {
              const used = usedFacesSet.has(face);
              return (
                <button
                  key={String(face)}
                  disabled={!isMyTurn || used}
                  onClick={() => handleKeep(face)}
                  className={`flex items-center gap-1 rounded-xl border p-1.5 transition ${
                    !isMyTurn || used
                      ? "cursor-not-allowed border-white/10 opacity-40"
                      : "cursor-pointer border-amber-300/40 hover:-translate-y-0.5 hover:border-amber-300/80"
                  }`}
                >
                  {Array.from({ length: count }, (_, i) => (
                    <DieFace key={`${rollFlourish}-${i}`} face={face} size="h-9 w-9" dimmed={used} className="animate-[worm-dice-tumble_0.5s_ease-out]" />
                  ))}
                  {!used && isMyTurn && <span className="ml-1 text-[10px] font-semibold text-amber-200">킵</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-2 text-center text-[11px] text-white/30">
            {state.diceRemaining > 0 ? "아직 굴리지 않았습니다." : "더 굴릴 주사위가 없습니다 — 스톱해야 합니다."}
          </p>
        )}

        {isMyTurn && (
          <div className="mt-2.5 flex gap-2">
            {state.currentRoll.length === 0 && state.diceRemaining > 0 && (
              <button onClick={handleRoll} className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500">
                🎲 주사위 굴리기
              </button>
            )}
            {state.currentRoll.length === 0 && state.usedFaces.length > 0 && (
              <button onClick={handleStop} className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500">
                🛑 스톱 (합계 {keptSum})
              </button>
            )}
          </div>
        )}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* Tile claim/steal flight FX. */}
      {flightEvents.map((event) => (
        <FlyingTile
          key={event.id}
          event={event}
          getSourceEl={() =>
            event.source === "center"
              ? (centerSlotRefs.current.get(event.tileNumber) ?? null)
              : (stackRefs.current.get(event.source) ?? null)
          }
          getTargetEl={() => stackRefs.current.get(event.seat) ?? null}
          onDone={handleFlightDone}
        />
      ))}
    </div>
  );
}
