"use client";

import { useState } from "react";
import Avatar from "@/components/common/Avatar";
import { CasinoTile, hexToRgba, money, CASINO_ACCENTS } from "./CasinoTile";
import { DiceFace, diceColorForSeat, NEUTRAL_DICE_COLOR } from "./DiceIcon";
import {
  NEUTRAL_OWNER,
  tallyDiceGroups,
  type CasinoNumber,
  type CasinoState,
  type Face,
  type LasVegasState,
  type SeatIndex,
} from "./engine";

/**
 * Mobile zero-scroll compact dashboard (2026-09-07 요청) — the whole in-play
 * screen (turn status + player strip + all 6 casinos + dice tray) fits one
 * phone viewport with no vertical scrolling, replacing `LasVegasBoard.tsx`'s
 * desktop tree only on mobile (see `useIsMobile.ts`'s doc for why exactly one
 * of the two trees mounts). Deliberately content-sized, not pinned to a hard
 * `100dvh` — this renders *inside* the shared `/games/[gameId]` page
 * template (site header + game-title block + page padding sit above it), so
 * a hard 100dvh here would overflow past the real viewport by however tall
 * that chrome is and clip the bottom sections out of view instead of fitting
 * the screen (the exact bug `century/useIsMobile.ts`'s compact dashboard hit
 * and fixed — same lesson applied here up front). Every section below is
 * tuned to a small fixed/compact size so the whole stack comfortably fits a
 * typical phone viewport's remaining space under that chrome.
 *
 * Confirmed decisions (AskUserQuestion, 2026-09-07):
 *  - 6-casino grid is 3 columns × 2 rows (wide cards), not 2×3.
 *  - Tapping a compact casino tile opens a detail bottom-sheet reusing the
 *    exact desktop-fidelity `CasinoTile` (full theme art + per-owner dice
 *    rows + full money stack) for that one casino — the mini tile itself
 *    only ever shows a total-$ badge + per-owner mini dice-count chips.
 *  - Scope is mobile-only; desktop/tablet keep `LasVegasBoard.tsx`'s
 *    existing scrollable layout completely unchanged.
 */

export interface CompactCasinoBoardProps {
  state: LasVegasState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  isMyTurn: boolean;
  myDiceInHand: number;
  seatOrder: number[];
  rollGroups: { face: Face; ownCount: number; neutralCount: number }[];
  existingOwnCounts: Partial<Record<Face, number>>;
  rollFlashId: number;
  impactKeys: Partial<Record<CasinoNumber, number>>;
  clashKeys: Partial<Record<CasinoNumber, number>>;
  onRoll: () => void;
  onPlace: (face: Face) => void;
  setCasinoTileRef: (n: CasinoNumber) => (el: HTMLDivElement | null) => void;
  setRollPanelRef: (el: HTMLDivElement | null) => void;
  onOpenRulebook: () => void;
}

/**
 * One 3×2-grid cell — number badge, total-bill-value badge, and a row of
 * per-owner mini dice-count chips (colored by seat, tied groups shown
 * struck-through/dimmed live via `tallyDiceGroups`, same provisional read
 * `LasVegasBoard.tsx`'s desktop tile already uses). No theme art and no
 * individual dice icons here — those live in the tap-to-open detail sheet
 * (see `CompactCasinoBoard`) so this stays small enough for 6 to fit at once.
 * `tileRef` is the SAME per-casino ref the desktop tile registers, so the
 * shared `FlyingDicePlacement`/impact-ring FX still target the right on-screen
 * element while this tree is the one mounted.
 */
function CompactCasinoTile({
  casino,
  viewerSeat,
  isRollDestination,
  impactKey,
  clashKey,
  onOpen,
  tileRef,
}: {
  casino: CasinoState;
  viewerSeat: SeatIndex;
  isRollDestination: boolean;
  impactKey: number;
  clashKey: number;
  onOpen: () => void;
  tileRef: (el: HTMLDivElement | null) => void;
}) {
  const accent = CASINO_ACCENTS[casino.number];
  const groups = tallyDiceGroups(casino.diceCounts).sort((a, b) => b.count - a.count);
  const total = casino.bills.reduce((s, v) => s + v, 0);
  const liveLeader = groups.find((g) => !g.tied);
  const leaderColor = liveLeader && liveLeader.owner !== NEUTRAL_OWNER ? diceColorForSeat(liveLeader.owner) : null;
  const iHaveDiceHere = groups.some((g) => g.owner !== NEUTRAL_OWNER && g.owner === viewerSeat);

  return (
    <div
      ref={tileRef}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className={`relative flex cursor-pointer flex-col justify-between gap-1 rounded-xl border-2 ${
        leaderColor ? "" : accent.border
      } bg-black/30 p-1.5 text-left transition active:scale-[0.96]`}
      style={{
        ...(isRollDestination ? { animation: "lasvegas-mat-glow-pulse 1.6s ease-in-out infinite" } : {}),
        ...(leaderColor
          ? { borderColor: leaderColor, boxShadow: `0 0 10px -2px ${hexToRgba(leaderColor, 0.85)}, inset 0 0 0 1px ${hexToRgba(leaderColor, 0.5)}` }
          : {}),
      }}
    >
      {/* Same impact-ring / tie-clash flourishes as the desktop tile, key-remounted per event. */}
      {impactKey > 0 && (
        <div
          key={impactKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-xl"
          style={{ animation: "lasvegas-tile-shake 0.32s ease-out" }}
        >
          <div className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full border-amber-300" style={{ animation: "lasvegas-impact-ring 0.55s ease-out forwards" }} />
        </div>
      )}
      {clashKey > 0 && (
        <div key={clashKey} aria-hidden className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <span className="text-2xl font-black text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.9)]" style={{ animation: "lasvegas-tie-clash-x 0.9s ease-out forwards" }}>
            ✕
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          <DiceFace face={casino.number} color="#f4f4f5" size="h-4 w-4" />
          <span className="text-[11px] font-black text-white">{casino.number}번</span>
        </span>
        {iHaveDiceHere && <span className="text-[9px]" title="내 주사위 있음">🎯</span>}
      </div>

      <span className="truncate text-[11px] font-bold text-emerald-200">💰 {money(total)}</span>

      <div className="flex min-h-[18px] flex-wrap items-center gap-1">
        {groups.length === 0 ? (
          <span className="text-[9px] text-white/30">주사위 없음</span>
        ) : (
          groups.map((g) => (
            <span
              key={g.owner}
              className={`grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[9px] leading-none font-black text-black transition-opacity ${
                g.tied ? "opacity-40 line-through decoration-2" : ""
              }`}
              style={{ background: g.owner === NEUTRAL_OWNER ? NEUTRAL_DICE_COLOR : diceColorForSeat(g.owner) }}
              title={g.tied ? "동수 상쇄 잠정" : undefined}
            >
              {g.count}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** Ultra-condensed player strip — colored seat ring, connection dot, remaining-dice count, money total. Wraps to a 2nd row instead of scrolling if 5 players don't fit one line. */
function CompactPlayersSummary({
  state,
  seatOrder,
  names,
  connectedSeats,
  viewerSeat,
}: {
  state: LasVegasState;
  seatOrder: number[];
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  viewerSeat: SeatIndex;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {seatOrder.map((seat) => {
        const p = state.players.find((pl) => pl.seat === seat)!;
        const isActive = state.activeSeat === seat;
        const isSelf = seat === viewerSeat;
        const total = p.money.reduce((s, v) => s + v, 0);
        const seatColor = diceColorForSeat(seat);
        return (
          <div
            key={seat}
            className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px]"
            style={{ borderColor: seatColor, background: isActive ? hexToRgba(seatColor, 0.18) : "rgba(0,0,0,0.25)" }}
          >
            <Avatar size={14} />
            <span className={`h-1 w-1 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
            {isActive && <span title="차례">👉</span>}
            <span className="max-w-[42px] truncate font-semibold text-white/90">
              {names[seat]}
              {isSelf && "(나)"}
            </span>
            <span className="text-white/60">🎲{p.ownDiceInHand + p.neutralDiceInHand}</span>
            <span className="font-bold text-emerald-200">{money(total)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Bottom footer — roll trigger, or (once rolled) the current roll grouped by
 * face with one tap-to-place chip each (rulebook §3: a chosen face commits
 * ALL dice showing it, all at once — so one tap already IS "전량 배치", no
 * separate confirm step needed). Trims the desktop `RollViewerPanel`'s extra
 * "every individual die, tumbling" row — the grouped chips already convey
 * exactly the same count — to keep this footer short on a phone screen.
 * `panelRef` is the flight-FX source, same role as the desktop roll panel's.
 */
function CompactDiceTray({
  roll,
  activeSeat,
  isMyTurn,
  names,
  rollGroups,
  existingOwnCounts,
  myDiceInHand,
  onRoll,
  onPlace,
  rollFlashId,
  panelRef,
}: {
  roll: LasVegasState["currentRoll"];
  activeSeat: SeatIndex;
  isMyTurn: boolean;
  names: Record<SeatIndex, string>;
  rollGroups: { face: Face; ownCount: number; neutralCount: number }[];
  existingOwnCounts: Partial<Record<Face, number>>;
  myDiceInHand: number;
  onRoll: () => void;
  onPlace: (face: Face) => void;
  rollFlashId: number;
  panelRef: (el: HTMLDivElement | null) => void;
}) {
  const rollerColor = diceColorForSeat(activeSeat);
  return (
    <section
      ref={panelRef}
      className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-amber-300/20 p-2"
      style={{ background: "linear-gradient(160deg,#332008 0%,#1c1204 55%,#0a0601 100%)" }}
    >
      {roll ? (
        <div key={rollFlashId} className="flex w-full flex-col items-center gap-1.5">
          <p className="text-center text-[10px] font-semibold tracking-wide uppercase" style={{ color: rollerColor }}>
            {isMyTurn ? `🫵 배치할 눈금을 터치하세요 (${roll.length}개)` : `🎲 ${names[activeSeat]}님이 굴린 주사위 (${roll.length}개)`}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {rollGroups.map((g) => {
              const incoming = g.ownCount + g.neutralCount;
              const existing = existingOwnCounts[g.face] ?? 0;
              return (
                <button
                  key={g.face}
                  type="button"
                  disabled={!isMyTurn}
                  onClick={() => onPlace(g.face)}
                  className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                    isMyTurn
                      ? "border-amber-300/50 bg-amber-400/10 text-amber-100 active:scale-95"
                      : "border-white/10 bg-white/5 text-white/50"
                  }`}
                >
                  <DiceFace face={g.face} color={isMyTurn ? "#f4f4f5" : NEUTRAL_DICE_COLOR} size="h-5 w-5" />
                  <span className="flex flex-col items-start leading-tight">
                    <span>{incoming}개</span>
                    {existing > 0 && <span className="text-[9px] font-normal text-amber-200/70">기존{existing}+신규{incoming}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : myDiceInHand === 0 ? (
        <p className="text-xs text-white/30">{isMyTurn ? "배치할 주사위가 없어 자동 패스됩니다." : `${names[activeSeat]}님 차례를 기다리는 중...`}</p>
      ) : isMyTurn ? (
        <button onClick={onRoll} className="rounded-full bg-amber-500 px-6 py-2.5 text-sm font-semibold text-black transition active:scale-95">
          🎲 주사위 굴리기 ({myDiceInHand}개)
        </button>
      ) : (
        <p className="text-xs text-white/30">{names[activeSeat]}님 차례를 기다리는 중...</p>
      )}
    </section>
  );
}

export function CompactCasinoBoard({
  state,
  viewerSeat,
  names,
  connectedSeats,
  isMyTurn,
  myDiceInHand,
  seatOrder,
  rollGroups,
  existingOwnCounts,
  rollFlashId,
  impactKeys,
  clashKeys,
  onRoll,
  onPlace,
  setCasinoTileRef,
  setRollPanelRef,
  onOpenRulebook,
}: CompactCasinoBoardProps) {
  const [detailCasino, setDetailCasino] = useState<CasinoNumber | null>(null);
  const detail = detailCasino !== null ? (state.casinos.find((c) => c.number === detailCasino) ?? null) : null;

  return (
    <div
      className="flex w-full flex-col gap-1.5 rounded-2xl border border-black/60 p-2 select-none"
      style={{ background: "linear-gradient(160deg,#1b1004 0%,#120b03 45%,#080502 100%)" }}
    >
      <div className="flex items-center justify-between gap-1.5">
        <p className={`flex-1 text-center text-[11px] font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
          {isMyTurn ? (state.currentRoll ? "🫵 배치할 눈금을 선택하세요" : "🫵 주사위를 굴리세요!") : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
        </p>
        <button
          onClick={onOpenRulebook}
          className="shrink-0 rounded-full border border-white/15 px-2 py-1 text-[10px] whitespace-nowrap text-white/60"
        >
          📖 룰북
        </button>
      </div>

      <CompactPlayersSummary state={state} seatOrder={seatOrder} names={names} connectedSeats={connectedSeats} viewerSeat={viewerSeat} />

      {/* 3열 × 2행 컴팩트 카지노 그리드 — 확인된 결정(2026-09-07 AskUserQuestion). */}
      <div className="grid grid-cols-3 grid-rows-2 gap-1.5">
        {state.casinos.map((casino) => (
          <CompactCasinoTile
            key={casino.number}
            casino={casino}
            viewerSeat={viewerSeat}
            isRollDestination={isMyTurn && rollGroups.some((g) => g.face === casino.number)}
            impactKey={impactKeys[casino.number] ?? 0}
            clashKey={clashKeys[casino.number] ?? 0}
            onOpen={() => setDetailCasino(casino.number)}
            tileRef={setCasinoTileRef(casino.number)}
          />
        ))}
      </div>

      <CompactDiceTray
        roll={state.currentRoll}
        activeSeat={state.activeSeat}
        isMyTurn={isMyTurn}
        names={names}
        rollGroups={rollGroups}
        existingOwnCounts={existingOwnCounts}
        myDiceInHand={myDiceInHand}
        onRoll={onRoll}
        onPlace={onPlace}
        rollFlashId={rollFlashId}
        panelRef={setRollPanelRef}
      />

      {/* Tap-to-open detail bottom-sheet — confirmed decision (2026-09-07 AskUserQuestion): reuses the exact desktop-fidelity `CasinoTile` (theme art + full per-owner dice rows + full money stack) for whichever casino was tapped. */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 sm:items-center"
          onClick={() => setDetailCasino(null)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-sm overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: "lasvegas-sheet-rise 0.2s ease-out" }}
          >
            <CasinoTile
              casino={detail}
              viewerSeat={viewerSeat}
              names={names}
              isRollDestination={isMyTurn && rollGroups.some((g) => g.face === detail.number)}
              impactKey={0}
              clashKey={0}
              tileRef={() => {}}
            />
            <button
              onClick={() => setDetailCasino(null)}
              className="mt-2 w-full rounded-full bg-white/10 py-2.5 text-xs font-semibold text-white/80"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
