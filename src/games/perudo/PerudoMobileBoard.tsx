"use client";

import { useState, type ReactNode } from "react";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import RectBidTrack, { OverflowBadge, stripLength } from "./PerudoBidTrack";
import { DiceRollTray } from "./dice/PerudoDie";
import { PLAYER_COLORWAYS, playerColorwayForSeat, type DiceColorway } from "./dice/colorways";
import { ExpectationBar, faceLabel, FacePicker, LostDiceTray, TABLE_PANEL, TableTexture } from "./PerudoSharedUI";
import {
  totalDiceInPlay,
  type EngineAction,
  type Face,
  type PerudoState,
  type PlayerState,
  type SeatIndex,
  type TrackCell,
} from "./engine";

/**
 * The "playing"-phase mobile layout (2026-09-08 모바일 화이트 오버스크롤 차단 세션,
 * AskUserQuestion-confirmed scope: 모바일 전용 — 데스크톱/태블릿은
 * `PerudoBoard.tsx`의 기존 레이아웃 그대로 유지). All game state and handlers
 * (bid-composer draft, colorway picker, action dispatch) live in the parent
 * `PerudoBoard` — this component is pure presentation, mounted instead of
 * (never alongside) the desktop tree via `useIsMobile`.
 *
 * **Revision history within this same session** (both AskUserQuestion-
 * confirmed): the first pass dropped the physical rectangular 30-cell track
 * (`RectBidTrack`) entirely in favor of a plain "current bid" summary card,
 * on the theory that tapping a track cell was always just an alternate
 * shortcut to the same `pickFace`/`stepQuantity` state the FacePicker/
 * steppers already drive. The user reported this back as "the board
 * disappeared" and asked for it back — this revision restores
 * `RectBidTrack` as the mobile board's actual center, and resolves the
 * width-vs-sidebar conflict that motivated dropping it in the first place by
 * replacing the old ALWAYS-VISIBLE 76px right sidebar with a **toggleable
 * slide-in drawer** (color picker + compact survival roster) that only
 * claims screen space while open, plus moving "내 주사위" to a bottom-pinned
 * horizontal bar instead — neither competes with the track's own width floor
 * at rest anymore.
 *
 * Reuses the exact same `TABLE_PANEL`/`TableTexture` chrome as the desktop
 * board (`PerudoSharedUI.tsx`) rather than a bespoke wrapper — this matters
 * beyond visual consistency: `RectBidTrack`'s own `--perudo-cell` width
 * formula (`PerudoBidTrack.tsx`'s `BOARD_CELL_SIZE_CSS`) is baked in
 * assuming this exact panel's `p-3 sm:p-4` padding stacked under the page
 * template's own `px-4 sm:px-6` — a different wrapper here would silently
 * throw that formula off and reopen the horizontal-fit bug the 2026-09-07
 * session fixed.
 *
 * Content-sized, NOT pinned to a hard `100dvh`: this renders *inside* the
 * shared `/games/[gameId]` page template (site header + game-title block +
 * page padding sit above it), so a hard 100dvh here would overflow past the
 * real viewport by however tall that chrome is — confirmed live via a
 * Playwright screenshot at 390×844 earlier this session (the action dock and
 * sidebar were clipped out of view). Same lesson already documented in
 * `century/useIsMobile.ts`, `lasVegas/CompactCasinoBoard.tsx`, and
 * `mineOfOblivion2/MineOfOblivion2MobileBoard.tsx`.
 */
export interface PerudoMobileBoardProps {
  state: PerudoState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  colorways: Record<SeatIndex, DiceColorway>;
  myColorway: DiceColorway;
  onColorwayChange: (colorwayId: string) => void;
  onAction: (action: EngineAction) => void;
  isMyTurn: boolean;
  iAmAlive: boolean;
  me: PlayerState;
  pendingFace: Face;
  pendingQuantity: number;
  pendingFloor: number;
  canConfirmBet: boolean;
  isIdenticalToCurrentBid: boolean;
  pickFace: (face: Face) => void;
  stepQuantity: (delta: number) => void;
  /** Physical-track props — identical contract to `PerudoBoard.tsx`'s own `<RectBidTrack>` call site; see `PerudoBidTrack.tsx`. */
  currentCell: TrackCell | null;
  pendingCell: TrackCell;
  laneOffset: number;
  cellEnabled: (cell: TrackCell) => boolean;
  onCellClick: (cell: TrackCell) => void;
  showBettingMarker: boolean;
  currentOverflows: boolean;
  pendingOverflows: boolean;
  muteButton: ReactNode;
  rulebookButton: ReactNode;
  rulebookOpen: boolean;
  onCloseRulebook: () => void;
}

export default function PerudoMobileBoard({
  state,
  viewerSeat,
  names,
  connectedSeats,
  colorways,
  myColorway,
  onColorwayChange,
  onAction,
  isMyTurn,
  iAmAlive,
  me,
  pendingFace,
  pendingQuantity,
  pendingFloor,
  canConfirmBet,
  isIdenticalToCurrentBid,
  pickFace,
  stepQuantity,
  currentCell,
  pendingCell,
  laneOffset,
  cellEnabled,
  onCellClick,
  showBettingMarker,
  currentOverflows,
  pendingOverflows,
  muteButton,
  rulebookButton,
  rulebookOpen,
  onCloseRulebook,
}: PerudoMobileBoardProps) {
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  // Right slide-in drawer — purely local UI state (never synced, nothing
  // about game rules depends on whether it's open), unlike every other piece
  // of state this component receives as props. Defaults closed
  // (AskUserQuestion-confirmed) so the board is the first thing a player
  // sees; a floating toggle button opens it on demand.
  const [isNavOpen, setIsNavOpen] = useState(false);

  // Same "누구 주사위 색상 이미 사용 중" lookup as the desktop picker
  // (`PerudoBoard.tsx`) — duplicated rather than threaded through props
  // since it's derived purely from `colorways`/`viewerSeat`, already
  // available here.
  const takenColorwaySeat = (colorwayId: string): SeatIndex | undefined => {
    const entry = Object.entries(colorways).find(([seat, cw]) => Number(seat) !== viewerSeat && cw.id === colorwayId);
    return entry ? (Number(entry[0]) as SeatIndex) : undefined;
  };

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-2 p-3 sm:p-4`}>
      <MyTurnOverlay isMyTurn={isMyTurn && iAmAlive} />
      <TableTexture />

      {/* 상단 정보 계층 (요구사항 ①): 인원/라운드 정보 → 턴 배너 → 무덤 → 기대값 바. */}
      <div className="relative z-10 flex items-center justify-between gap-1.5 text-xs text-rose-100/60">
        <span>
          {state.playerCount}인 · {state.roundNumber}라운드
        </span>
        <div className="flex gap-1.5">
          {muteButton}
          {rulebookButton}
        </div>
      </div>
      <p className={`relative z-10 text-center text-sm font-bold break-keep ${isMyTurn ? "text-amber-200" : "text-xs font-medium text-white/50"}`}>
        {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>
      {/* Safety-net scroll (not the main "보드는 스크롤 없음" area) — a late-game
          table with many losses across up to 8 seats can grow taller than
          this strip has room for. */}
      <div className="relative z-10 max-h-16 overflow-y-auto">
        <LostDiceTray state={state} colorways={colorways} />
      </div>
      <ExpectationBar totalActiveDice={totalDiceInPlay(state)} />

      {/* 중앙 보드: 물리 사각형 트랙 복원 (요구사항 ④) — hollow center엔 이제
          배팅 선언/조작 패널만 들어간다 (무덤·내 주사위·색상 변경은 위/아래/드로어로
          이동했으므로). `overflow-x-auto` 래퍼는 데스크톱과 동일한 안전장치 —
          아주 좁은(~320px) 구형 기기에서만 실제로 작동. */}
      <div className="relative z-10 w-full overflow-x-auto">
        <RectBidTrack
          currentCell={currentCell}
          pendingCell={pendingCell}
          pendingFace={pendingFace}
          showMarker={showBettingMarker}
          laneOffset={laneOffset}
          cellEnabled={cellEnabled}
          onCellClick={onCellClick}
        >
          <div className="flex w-full flex-col items-center gap-2 p-1.5 sm:p-2.5" style={{ maxWidth: stripLength(7) }}>
            {(currentOverflows || (isMyTurn && iAmAlive && pendingOverflows)) && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {currentOverflows && state.currentBid && (
                  <OverflowBadge label="확정" tone="amber" quantity={state.currentBid.quantity} face={state.currentBid.face} />
                )}
                {isMyTurn && iAmAlive && pendingOverflows && (
                  <OverflowBadge label="내 초안" tone="violet" quantity={pendingQuantity} face={pendingFace} />
                )}
              </div>
            )}

            <div className="flex w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] border-4 border-amber-800 bg-amber-100/90 p-2 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)]">
              {state.currentBid ? (
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className="text-[10px] text-amber-900/70">{names[state.currentBid.seat]}님의 선언</span>
                  <span className="text-2xl font-black text-red-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]">
                    {faceLabel(state.currentBid.face)} × {state.currentBid.quantity}개↑
                  </span>
                </div>
              ) : (
                <p className="px-2 text-center text-xs text-amber-900/70">
                  {names[state.activeSeat]}님이 이번 라운드를 엽니다 — 첫 선언 대기 중
                </p>
              )}

              {isMyTurn && iAmAlive && (
                <div className="flex flex-col items-center gap-1.5 rounded-xl border border-violet-900/25 bg-violet-950/5 px-1.5 py-2">
                  <p className="text-center text-[10px] font-semibold text-violet-900/70">
                    🟣 눈금을 고르고 개수를 정하거나, 트랙 칸을 눌러 이동하세요
                  </p>
                  <FacePicker selected={pendingFace} onSelect={pickFace} />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => stepQuantity(-1)}
                      disabled={pendingQuantity <= pendingFloor}
                      title="개수 줄이기"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="min-w-[3ch] text-center text-lg font-black text-violet-950">{pendingQuantity}개</span>
                    <button
                      type="button"
                      onClick={() => stepQuantity(1)}
                      title="개수 늘리기"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!canConfirmBet}
                    onClick={() => onAction({ type: "raise", seat: viewerSeat, quantity: pendingQuantity, face: pendingFace })}
                    className="rounded-full bg-violet-700 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_2px_rgba(168,85,247,0.3)] transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 disabled:shadow-none"
                  >
                    ✅ {faceLabel(pendingFace)} × {pendingQuantity}개로 베팅 확정
                  </button>
                  {isIdenticalToCurrentBid && (
                    <p className="max-w-[220px] text-center text-[10px] font-medium text-rose-700">
                      ⚠️ 동일한 배팅은 할 수 없습니다. 눈금을 올리거나 수량을 올려주세요.
                    </p>
                  )}
                </div>
              )}

              {iAmAlive && (
                <div className="flex gap-2">
                  <button
                    disabled={!isMyTurn || !state.currentBid}
                    onClick={() => onAction({ type: "dudo", seat: viewerSeat })}
                    className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30"
                  >
                    🚨 페루도!
                  </button>
                  <button
                    disabled={!state.currentBid}
                    onClick={() => onAction({ type: "calza", seat: viewerSeat })}
                    title="차례와 상관없이 외칠 수 있어요"
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30"
                  >
                    🎯 맞아!
                  </button>
                </div>
              )}
            </div>
          </div>
        </RectBidTrack>
      </div>

      {/* 최하단: 내 주사위 상시 표시 바 (요구사항 ③) — 상대 턴에도 항상 노출, 컵/타이머로 가려지지 않음. */}
      <div className="relative z-10 flex shrink-0 flex-col items-center gap-1 rounded-2xl border-2 border-amber-900/40 bg-gradient-to-b from-black/25 to-black/35 p-2.5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]">
        <span className="text-[11px] font-semibold text-amber-100/70">🎲 내 주사위 ({me.diceCount}개)</span>
        {!iAmAlive ? (
          <p className="text-xs text-rose-300/70">탈락했습니다 — 관전 중</p>
        ) : (
          <DiceRollTray
            dice={me.dice}
            colorway={myColorway}
            rollToken={state.roundNumber}
            size="md"
            ringForIndex={(i) => {
              const d = me.dice[i];
              const matchesBid = state.currentBid ? d === state.currentBid.face : false;
              if (matchesBid) return "match";
              if (state.currentBid && state.currentBid.face !== 1 && d === 1) return "wild";
              return undefined;
            }}
            onRollStart={() => {
              const engine = getSoundEngine();
              engine.unlock();
              engine.playDiceRattle(600);
            }}
            onSettled={() => getSoundEngine().playCupThud()}
          />
        )}
      </div>

      {/* 우측 토글 네비바 (요구사항 ②) — 색상 변경 + 통계 현황판(생존 주사위 수만,
          두도/칼자 성공률·액션 로그는 별도 엔진 작업이 필요해 이번 범위에서 제외 —
          AskUserQuestion-confirmed). */}
      {!isNavOpen && (
        <button
          type="button"
          onClick={() => setIsNavOpen(true)}
          className="absolute top-3 right-3 z-30 flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-2 py-1.5 text-[11px] font-bold text-amber-300 backdrop-blur-sm"
        >
          📊 통계/설정
        </button>
      )}

      {isNavOpen && (
        <div
          className="absolute inset-0 z-30 bg-black/60"
          onClick={() => setIsNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`absolute inset-y-0 right-0 z-40 flex w-[78%] max-w-[280px] flex-col gap-3 overflow-y-auto border-l border-amber-500/30 bg-gradient-to-b from-[#1d130d] to-[#0d0805] p-3 shadow-[-8px_0_24px_rgba(0,0,0,0.5)] transition-transform duration-300 ${
          isNavOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-amber-200">통계 / 설정</span>
          <button
            type="button"
            onClick={() => setIsNavOpen(false)}
            aria-label="닫기"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-white/70 hover:border-white/30"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-amber-300/80">🎨 주사위 색상</span>
          <div className="grid grid-cols-5 gap-2">
            {PLAYER_COLORWAYS.map((c) => {
              const heldBySeat = takenColorwaySeat(c.id);
              const isMine = myColorway.id === c.id;
              const isTaken = heldBySeat !== undefined && !isMine;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={isTaken}
                  onClick={() => onColorwayChange(c.id)}
                  title={isTaken ? `${names[heldBySeat]}님이 사용 중` : `내 주사위 색상: ${c.label}`}
                  aria-label={`주사위 색상: ${c.label}`}
                  className={`mx-auto h-6 w-6 rounded-full border-2 transition ${
                    isMine
                      ? "scale-110 border-white"
                      : isTaken
                        ? "cursor-not-allowed border-white/10 opacity-35"
                        : "border-white/25 hover:border-white/60"
                  }`}
                  style={{ backgroundColor: c.body }}
                />
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3">
          <span className="text-[11px] font-semibold text-amber-300/80">📊 통계 현황판 — 생존 주사위</span>
          <div className="flex flex-col gap-1.5">
            {seatOrder.map((seat) => {
              const player = state.players.find((p) => p.seat === seat)!;
              const isSelf = seat === viewerSeat;
              const isActive = state.activeSeat === seat && state.phase === "playing";
              const eliminated = player.diceCount <= 0;
              const seatColorway = colorways[seat] ?? playerColorwayForSeat(seat);
              return (
                <div
                  key={seat}
                  className={`flex items-center justify-between gap-2 rounded-xl border p-2 transition ${
                    isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
                  } ${eliminated ? "opacity-40" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-white/90">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30"
                      style={{ backgroundColor: seatColorway.body }}
                    />
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`}
                    />
                    {isActive && <span title="차례">👉</span>}
                    {eliminated && <span title="탈락">💀</span>}
                    <span className="truncate break-keep">{names[seat]}</span>
                    {isSelf && <span className="shrink-0 text-amber-200">(나)</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-white/70">
                    {eliminated ? "탈락" : `${player.diceCount}개`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {rulebookOpen && <RulebookModal onClose={onCloseRulebook} />}
    </div>
  );
}
