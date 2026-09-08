"use client";

import type { ReactNode } from "react";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import { DiceRollTray } from "./dice/PerudoDie";
import { PLAYER_COLORWAYS, playerColorwayForSeat, type DiceColorway } from "./dice/colorways";
import { ExpectationBar, faceLabel, FacePicker, LostDiceTray } from "./PerudoSharedUI";
import { totalDiceInPlay, type EngineAction, type Face, type PerudoState, type PlayerState, type SeatIndex } from "./engine";

/**
 * The "playing"-phase mobile layout (2026-09-08 모바일 화이트 오버스크롤 차단 +
 * 상단 무덤/기대값 재배치 + 우측 사이드 패널 개편 세션, AskUserQuestion-confirmed
 * scope: 모바일 전용 — 데스크톱/태블릿은 `PerudoBoard.tsx`의 기존 사각형 물리
 * 보드(`RectBidTrack`) 레이아웃을 그대로 유지). All game state and handlers
 * (bid-composer draft, colorway picker, action dispatch) live in the parent
 * `PerudoBoard` — this component is pure presentation, mounted instead of
 * (never alongside) the desktop tree via `useIsMobile`.
 *
 * Three deliberate departures from the desktop layout, each confirmed via
 * AskUserQuestion before implementation:
 *   1. The desktop board's physical rectangular 30-cell track
 *      (`RectBidTrack`) is dropped entirely here — the FacePicker/quantity
 *      steppers already are the primary bid-composer input on desktop too
 *      (tapping a track cell was always just an alternate shortcut to the
 *      same `pickFace`/`stepQuantity` state), and the track's own real
 *      width floor (9 cells × a 30px tap-target minimum, see
 *      `PerudoBoard.tsx`'s `BOARD_CELL_SIZE_CSS` doc comment) would have
 *      directly competed with this layout's right-hand sidebar for the same
 *      scarce horizontal space on a narrow phone. Replaced with a plain
 *      "current bid" hero card, matching the request's own
 *      `PerudoCenterBoard` example.
 *   2. "내 주사위" and "주사위 색상 변경" — kept inside the desktop board's
 *      hollow center by two earlier (2026-08-20/08-21) sessions — move out
 *      to the right sidebar here, reversing that decision for mobile only.
 *   3. The desktop board's full "🏆 스코어보드" section (name + full dice-back
 *      row per seat) is replaced by a compact icon-only roster in the same
 *      sidebar (colored dot + connection dot + remaining-dice digit, full
 *      name only as a tooltip) — a 76px-wide rail has no room to print
 *      Korean nicknames, and a lengthy scrollable list below the fold would
 *      have broken the "메인 보드는 스크롤 없음" goal (요구사항 4).
 *
 * Deliberately content-sized, NOT pinned to a hard `100dvh`: this renders
 * *inside* the shared `/games/[gameId]` page template (site header +
 * game-title block + page padding sit above it), so a hard 100dvh here would
 * overflow past the real viewport by however tall that chrome is and clip
 * the bottom of the action dock/sidebar out of view instead of fitting the
 * screen — confirmed live via a Playwright screenshot at 390×844 before this
 * was fixed (the action dock and the lower half of the sidebar were
 * completely invisible below the fold). Same lesson already documented in
 * `century/useIsMobile.ts`, `lasVegas/CompactCasinoBoard.tsx`, and
 * `mineOfOblivion2/MineOfOblivion2MobileBoard.tsx` — every section below is
 * tuned to a small fixed/compact size instead so the whole stack comfortably
 * fits a typical phone viewport's remaining space under that chrome.
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
  muteButton,
  rulebookButton,
  rulebookOpen,
  onCloseRulebook,
}: PerudoMobileBoardProps) {
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  // Same "누구 주사위 색상 이미 사용 중" lookup as the desktop picker
  // (`PerudoBoard.tsx`) — duplicated rather than threaded through props
  // since it's derived purely from `colorways`/`viewerSeat`, already
  // available here.
  const takenColorwaySeat = (colorwayId: string): SeatIndex | undefined => {
    const entry = Object.entries(colorways).find(([seat, cw]) => Number(seat) !== viewerSeat && cw.id === colorwayId);
    return entry ? (Number(entry[0]) as SeatIndex) : undefined;
  };

  return (
    <div className="relative flex w-full max-w-[100vw] flex-col overflow-x-hidden rounded-2xl bg-slate-950 text-white [touch-action:pan-y]">
      <MyTurnOverlay isMyTurn={isMyTurn && iAmAlive} />

      {/* Top information hierarchy (요구사항 2): 턴 배너 → 무덤 → 기대값 바, 이 순서 그대로 수직 정렬. */}
      <header className="relative z-10 flex flex-col gap-1.5 rounded-t-2xl border-b border-amber-900/40 bg-gradient-to-b from-[#1d130d] to-[#120a04] px-2.5 pt-2 pb-2">
        <div className="flex items-center justify-between gap-1.5 text-[10px] text-rose-100/60">
          <span>
            {state.playerCount}인 · {state.roundNumber}라운드
          </span>
          <div className="flex gap-1.5">
            {muteButton}
            {rulebookButton}
          </div>
        </div>
        <p className={`text-center text-sm font-bold break-keep ${isMyTurn ? "text-amber-200" : "text-xs font-medium text-white/50"}`}>
          {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
        </p>
        {/* Safety-net scroll (not the primary "메인 보드는 스크롤 없음" area) —
            a late-game table with many losses across up to 8 seats can grow
            taller than this header has room for; better to scroll this one
            secondary strip than to blow out the whole zero-scroll frame. */}
        <div className="max-h-16 overflow-y-auto">
          <LostDiceTray state={state} colorways={colorways} />
        </div>
        <ExpectationBar totalActiveDice={totalDiceInPlay(state)} />
      </header>

      {/* Body: 좌측 베팅 메인 보드 + 우측 유틸리티 사이드 패널 (요구사항 3/4). Both
          columns are content-sized (no `flex-1`/`min-h-0` viewport-filling
          trick — see this file's header doc comment for why) and simply
          align to their own natural top edge, so a taller sidebar (e.g. an
          8-player roster) never stretches the shorter main column into
          empty dead space. */}
      <div className="relative z-10 flex items-start gap-2 rounded-b-2xl p-2">
        <main className="flex min-w-0 flex-1 flex-col gap-2">
          {/* 현재 베팅 대형 카드 — 컴팩트한 고정 높이, 스크롤 없이 항상 노출. */}
          <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-amber-800/60 bg-gradient-to-b from-[#241609] to-[#120a04] px-3 py-5 text-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]">
            {state.currentBid ? (
              <>
                <span className="text-[10px] text-amber-200/50">{names[state.currentBid.seat]}님의 선언</span>
                <span className="text-3xl font-black text-amber-100 drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]">
                  {faceLabel(state.currentBid.face)} × {state.currentBid.quantity}개↑
                </span>
              </>
            ) : (
              <p className="px-2 text-xs text-amber-100/60 break-keep">
                {names[state.activeSeat]}님이 이번 라운드를 엽니다 — 첫 선언 대기 중
              </p>
            )}
          </div>

          {/* 하단 액션 독 — 눈금 키패드, 수량 조절, 베팅/페루도!/맞아! (요구사항 4). */}
          <div className="shrink-0 flex flex-col items-center gap-1.5 rounded-2xl border-4 border-amber-800 bg-amber-100/90 p-2 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)]">
            {isMyTurn && iAmAlive && (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-violet-900/25 bg-violet-950/5 px-1.5 py-1.5">
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
        </main>

        {/* 우측 사이드 패널 (요구사항 3) — 내 주사위 상시 뷰 + 색상 팔레트, 스크롤 없이 즉시 조작. */}
        <aside className="flex w-[76px] shrink-0 flex-col gap-2 rounded-2xl border border-amber-500/20 bg-black/30 p-1.5">
          <div className="flex flex-col items-center gap-1">
            <span className="text-center text-[9px] leading-tight font-bold text-amber-300/80 break-keep">
              🎲 내 주사위
              <br />
              {me.diceCount}개
            </span>
            {!iAmAlive ? (
              <span className="text-[9px] text-rose-300/70">탈락 · 관전 중</span>
            ) : (
              <DiceRollTray
                dice={me.dice}
                colorway={myColorway}
                rollToken={state.roundNumber}
                size="sm"
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

          {/* 플레이어 현황 요약 — 76px 폭엔 닉네임을 인쇄할 공간이 없어 색상 점 +
              접속 점 + 남은 주사위 숫자만 표시하고, 전체 이름은 title 툴팁으로.
              `max-h` (not `flex-1`, this column is content-sized now) is a
              safety net for a full 8-player table, not the common case. */}
          <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto border-t border-white/10 pt-1.5">
            {seatOrder.map((seat) => {
              const player = state.players.find((p) => p.seat === seat)!;
              const isSelf = seat === viewerSeat;
              const isActive = state.activeSeat === seat && state.phase === "playing";
              const eliminated = player.diceCount <= 0;
              const seatColorway = colorways[seat] ?? playerColorwayForSeat(seat);
              return (
                <div
                  key={seat}
                  title={`${names[seat]}${isSelf ? " (나)" : ""} · 주사위 ${player.diceCount}개`}
                  className={`flex shrink-0 items-center justify-center gap-1 rounded-lg border px-1 py-1 text-[10px] font-bold transition ${
                    isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-white/[0.03]"
                  } ${eliminated ? "opacity-35" : ""}`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full border border-white/30"
                    style={{ backgroundColor: seatColorway.body }}
                  />
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`}
                  />
                  <span className="text-white/80">{eliminated ? "💀" : player.diceCount}</span>
                </div>
              );
            })}
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-1 border-t border-white/10 pt-1.5">
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
                  className={`mx-auto h-4 w-4 rounded-full border-2 transition ${
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
        </aside>
      </div>

      {rulebookOpen && <RulebookModal onClose={onCloseRulebook} />}
    </div>
  );
}
