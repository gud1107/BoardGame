"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * The "playing"-phase mobile layout — rewritten 2026-09-09 (스크롤-투-플레이어현황
 * 개편 세션, AskUserQuestion-confirmed 3-for-3: replace the 2026-09-08 toggle
 * drawer outright rather than keep both; measure page chrome and size Section
 * 1 to `calc(100dvh - chromeTop)` rather than a raw 100dvh; player rows as a
 * single vertical list rather than a 2-col grid). All game state and handlers
 * (bid-composer draft, colorway picker, action dispatch) live in the parent
 * `PerudoBoard` — this component is pure presentation, mounted instead of
 * (never alongside) the desktop tree via `useIsMobile`.
 *
 * **Two-section structure** (this session's actual ask, replacing the prior
 * "everything in one card + toggle drawer" shape):
 * - **Section 1** (`arenaRef`): the betting arena — turn banner, graveyard,
 *   expectation bar, the physical `RectBidTrack` + bid composer, my dice
 *   tray, action buttons. Sized to fill exactly the viewport height still
 *   available below whatever page chrome sits above this component (site
 *   header + the `/games/[gameId]` page's own title block) — measured via
 *   `arenaRef.getBoundingClientRect().top` rather than a literal
 *   `h-[100dvh]`, which would overflow past the real viewport by however
 *   tall that chrome is (confirmed live via Playwright at 390×844 in the
 *   2026-09-08 session that first tried the literal-100dvh approach; this
 *   file was rewritten to content-sized as a result). Re-measured on
 *   resize/orientation change, not just mount, since rotating the device or
 *   the browser chrome collapsing (URL bar auto-hide) shifts the same
 *   offset.
 * - **Section 2**: below Section 1 in normal document flow (reached by the
 *   page's own scroll, not a nested scroll container) — full player roster
 *   (avatar-less colorway dot + name + dice count + turn-focus glow, one per
 *   row) and the dice-colorway picker. Replaces the 2026-09-08 right-edge
 *   toggle drawer entirely (AskUserQuestion-confirmed) rather than keeping
 *   both — the same two pieces of info (colors, survival counts) just moved
 *   from an on-demand overlay to an always-reachable scroll section.
 *
 * No avatar imagery: the request's mockup mentions a `/user.png` fallback
 * profile photo, but no Perudo surface (desktop board included) has ever
 * rendered player avatars — survival status here reuses the same colored
 * colorway-dot + name convention `PerudoBoard.tsx`'s desktop roster and the
 * prior drawer both already used, rather than introducing new avatar
 * plumbing nothing else in this game has (another instance of the
 * request-premise-mismatch pattern this project keeps running into).
 *
 * Reuses the exact same `TABLE_PANEL`/`TableTexture` chrome as the desktop
 * board (`PerudoSharedUI.tsx`) for Section 1 — this matters beyond visual
 * consistency: `RectBidTrack`'s own `--perudo-cell` width formula
 * (`PerudoBidTrack.tsx`'s `BOARD_CELL_SIZE_CSS`) is baked in assuming this
 * exact panel's `p-3 sm:p-4` padding stacked under the page template's own
 * `px-4 sm:px-6` — a different wrapper here would silently throw that
 * formula off and reopen the horizontal-fit bug the 2026-09-07 session
 * fixed.
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

  // Same "누구 주사위 색상 이미 사용 중" lookup as the desktop picker
  // (`PerudoBoard.tsx`) — duplicated rather than threaded through props
  // since it's derived purely from `colorways`/`viewerSeat`, already
  // available here.
  const takenColorwaySeat = (colorwayId: string): SeatIndex | undefined => {
    const entry = Object.entries(colorways).find(([seat, cw]) => Number(seat) !== viewerSeat && cw.id === colorwayId);
    return entry ? (Number(entry[0]) as SeatIndex) : undefined;
  };

  // Section-1 zero-scroll fit (요구사항 ①③, AskUserQuestion-confirmed "JS로
  // 상단 여백 측정 후 calc 핏"): measure how far this element's top sits from
  // the real viewport top (site header + page title block above it) and size
  // Section 1 to exactly the remaining height, instead of a literal
  // `h-[100dvh]` that would double-count that chrome and overflow past what's
  // actually visible. Falls back to a bare `100dvh` for the very first paint
  // (before the effect has measured anything) — briefly too tall rather than
  // too short, so nothing clips before the real value lands.
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const [arenaMinHeight, setArenaMinHeight] = useState<string>("100dvh");
  useEffect(() => {
    const measure = () => {
      const el = arenaRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setArenaMinHeight(`calc(100dvh - ${Math.max(top, 0)}px)`);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  return (
    <div className="w-full max-w-[100vw] overflow-x-hidden">
      {/* [섹션 1] 배팅 전용 메인 아레나 — 스크롤 없이 남은 뷰포트 높이에 정확히 맞춤. */}
      <div
        ref={arenaRef}
        style={{ minHeight: arenaMinHeight }}
        className={`${TABLE_PANEL} flex flex-col justify-between gap-2 p-3 sm:p-4`}
      >
        <MyTurnOverlay isMyTurn={isMyTurn && iAmAlive} />
        <TableTexture />

        {/* 상단 정보 계층 (요구사항 ①): 인원/라운드 정보 → 턴 배너 → 무덤 → 기대값 바. */}
        <header className="relative z-10 flex shrink-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-1.5 text-xs text-rose-100/60">
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
          {/* Safety-net scroll (not the main "보드는 스크롤 없음" area) — a late-game
              table with many losses across up to 8 seats can grow taller than
              this strip has room for. */}
          <div className="max-h-16 overflow-y-auto">
            <LostDiceTray state={state} colorways={colorways} />
          </div>
          <ExpectationBar totalActiveDice={totalDiceInPlay(state)} />
        </header>

        {/* 중앙 보드: 물리 사각형 트랙 — hollow center엔 배팅 선언/조작 패널이
            들어간다. `flex-1 min-h-0`로 위/아래 고정 영역을 뺀 나머지를 전부
            차지하고, 아주 좁은 기기에서만 안전장치로 내부 스크롤을 허용한다. */}
        <main className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-auto">
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
        </main>

        {/* 최하단: 내 주사위 상시 표시 바 + 스크롤 안내 인디케이터. */}
        <footer className="relative z-10 flex shrink-0 flex-col items-center gap-1.5">
          <div className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-amber-900/40 bg-gradient-to-b from-black/25 to-black/35 p-2.5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]">
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
          <div className="flex animate-bounce items-center justify-center gap-1 text-[10px] text-amber-200/50">
            <span>↓ 아래로 스크롤하여 플레이어 현황 보기</span>
          </div>
        </footer>
      </div>

      {/* [섹션 2] 하단 스크롤 영역: 플레이어별 주사위 잔여량, 턴, 색상 변경. */}
      <div className="mt-3 flex w-full flex-col gap-3 rounded-3xl border border-amber-500/15 bg-gradient-to-b from-[#1d130d] to-[#0d0805] p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-amber-400">👥 플레이어 주사위 현황 & 턴 순서</h3>

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
                className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition ${
                  isActive ? "border-amber-300/60 bg-amber-400/10 shadow-[0_0_0_1px_rgba(251,191,36,0.25)]" : "border-white/10 bg-black/20"
                } ${eliminated ? "opacity-40" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-white/90">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-white/30"
                    style={{ backgroundColor: seatColorway.body }}
                  />
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`}
                    title={connectedSeats.has(seat) ? "접속 중" : "연결 끊김"}
                  />
                  {isActive && <span title="차례">👉</span>}
                  {eliminated && <span title="탈락">💀</span>}
                  <span className="truncate break-keep">{names[seat]}</span>
                  {isSelf && <span className="shrink-0 text-amber-200">(나)</span>}
                </span>
                <span className="shrink-0 text-[11px] text-white/70">
                  {eliminated ? "탈락" : `🎲 ${player.diceCount}개`}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3">
          <span className="text-[11px] font-semibold text-amber-300/80">🎨 내 주사위 색상 변경</span>
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
                  className={`mx-auto h-7 w-7 rounded-full border-2 transition ${
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
      </div>

      {rulebookOpen && <RulebookModal onClose={onCloseRulebook} />}
    </div>
  );
}
